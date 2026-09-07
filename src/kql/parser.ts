import { tokenize, type Token } from './lexer';
import { KqlError } from './types';

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'ts'; ms: number }
  | { k: 'col'; name: string; pos: number }
  | { k: 'star' }
  | { k: 'call'; name: string; args: Expr[]; pos: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; pos: number }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'member'; obj: Expr; name: string }
  | { k: 'index'; obj: Expr; idx: Expr }
  | { k: 'list'; items: Expr[] };

export interface NamedExpr {
  name?: string;
  expr: Expr;
}

export interface SortItem {
  expr: Expr;
  desc: boolean;
}

export type Op =
  | { kind: 'where'; expr: Expr }
  | { kind: 'project'; items: NamedExpr[] }
  | { kind: 'extend'; items: NamedExpr[] }
  | { kind: 'take'; n: number }
  | { kind: 'count' }
  | { kind: 'distinct'; items: NamedExpr[] }
  | { kind: 'summarize'; aggs: NamedExpr[]; by: NamedExpr[] }
  | { kind: 'sort'; items: SortItem[] }
  | { kind: 'top'; n: number; items: SortItem[] };

export interface Query {
  table: string;
  tablePos: number;
  ops: Op[];
}

/** Word-form comparison operators. */
const WORD_OPS = new Set([
  'contains',
  'contains_cs',
  '!contains',
  'has',
  'has_cs',
  '!has',
  'startswith',
  'endswith',
  'in',
  '!in',
  'in~',
  'matches',
]);

const KNOWN_OPERATORS = [
  'where',
  'project',
  'extend',
  'take',
  'limit',
  'count',
  'distinct',
  'summarize',
  'sort',
  'order',
  'top',
];

class Parser {
  private toks: Token[];
  private i = 0;
  /**
   * Recursive-descent depth guard. Without this, deeply nested parentheses
   * overflow the JS stack with a RangeError, which escapes as a non-KqlError
   * and surfaces to the player as an ugly internal message.
   */
  private depth = 0;
  private static readonly MAX_DEPTH = 120;

  constructor(src: string) {
    this.toks = tokenize(src);
  }

  private enter(pos: number) {
    if (++this.depth > Parser.MAX_DEPTH) {
      throw new KqlError(
        'Expression is nested too deeply.',
        pos,
        'Try simplifying — that many brackets is almost certainly a typo.',
      );
    }
  }

  private leave() {
    this.depth--;
  }

  private peek(offset = 0): Token {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)];
  }

  private next(): Token {
    return this.toks[this.i++];
  }

  private atPunc(v: string): boolean {
    const t = this.peek();
    return t.kind === 'punc' && t.value === v;
  }

  private atIdent(v: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.value.toLowerCase() === v;
  }

  private eatPunc(v: string): boolean {
    if (this.atPunc(v)) {
      this.i++;
      return true;
    }
    return false;
  }

  private eatIdent(v: string): boolean {
    if (this.atIdent(v)) {
      this.i++;
      return true;
    }
    return false;
  }

  private expectPunc(v: string): Token {
    if (!this.atPunc(v)) {
      const t = this.peek();
      throw new KqlError(`Expected '${v}' but found '${t.value}'.`, t.pos);
    }
    return this.next();
  }

  parseQuery(): Query {
    const first = this.peek();
    if (first.kind === 'eof') {
      throw new KqlError('Empty query.', 0, 'Start with a table name, e.g. Heartbeat');
    }
    if (first.kind !== 'ident') {
      throw new KqlError(
        `A query must start with a table name, but found '${first.value}'.`,
        first.pos,
      );
    }
    const table = this.next();
    const ops: Op[] = [];
    while (this.eatPunc('|')) {
      ops.push(this.parseOp());
    }
    const end = this.peek();
    if (end.kind !== 'eof') {
      throw new KqlError(
        `Unexpected '${end.value}' after the query.`,
        end.pos,
        "Each operator must be separated by a pipe '|'.",
      );
    }
    return { table: table.value, tablePos: table.pos, ops };
  }

  private parseOp(): Op {
    const t = this.peek();
    if (t.kind !== 'ident') {
      throw new KqlError(`Expected an operator after '|' but found '${t.value}'.`, t.pos);
    }
    const name = t.value.toLowerCase();

    switch (name) {
      case 'where':
      case 'filter':
        this.next();
        return { kind: 'where', expr: this.parseExpr() };

      case 'project':
        this.next();
        return { kind: 'project', items: this.parseNamedList() };

      case 'extend':
        this.next();
        return { kind: 'extend', items: this.parseNamedList() };

      case 'take':
      case 'limit': {
        this.next();
        const n = this.peek();
        if (n.kind !== 'num') {
          throw new KqlError(`'${name}' needs a row count, e.g. ${name} 10.`, n.pos);
        }
        this.next();
        return { kind: 'take', n: n.num! };
      }

      case 'count':
        this.next();
        return { kind: 'count' };

      case 'distinct':
        this.next();
        return { kind: 'distinct', items: this.parseNamedList() };

      case 'summarize': {
        this.next();
        const aggs: NamedExpr[] = [];
        // "summarize by X" (no aggregates) is legal KQL
        if (!this.atIdent('by')) {
          aggs.push(...this.parseNamedList(true));
        }
        const by: NamedExpr[] = [];
        if (this.eatIdent('by')) {
          by.push(...this.parseNamedList());
        }
        return { kind: 'summarize', aggs, by };
      }

      case 'sort':
      case 'order': {
        this.next();
        if (!this.eatIdent('by')) {
          const p = this.peek();
          throw new KqlError(`Expected 'by' after '${name}'.`, p.pos, `Try: ${name} by Column desc`);
        }
        return { kind: 'sort', items: this.parseSortList() };
      }

      case 'top': {
        this.next();
        const n = this.peek();
        if (n.kind !== 'num') {
          throw new KqlError("'top' needs a row count, e.g. top 5 by Count.", n.pos);
        }
        this.next();
        if (!this.eatIdent('by')) {
          const p = this.peek();
          throw new KqlError("Expected 'by' after 'top N'.", p.pos, 'Try: top 5 by Count desc');
        }
        return { kind: 'top', n: n.num!, items: this.parseSortList() };
      }

      default: {
        throw new KqlError(
          `Unknown operator '${t.value}'.`,
          t.pos,
          `Supported operators: ${KNOWN_OPERATORS.join(', ')}.`,
        );
      }
    }
  }

  /** `a, b = expr, c` — optional `name =` prefix on each item. */
  private parseNamedList(stopAtBy = false): NamedExpr[] {
    const items: NamedExpr[] = [];
    do {
      if (stopAtBy && this.atIdent('by')) break;
      items.push(this.parseNamedExpr());
    } while (this.eatPunc(','));
    return items;
  }

  private parseNamedExpr(): NamedExpr {
    // lookahead for `Name = ` (but not `Name ==`)
    const t = this.peek();
    const nxt = this.peek(1);
    if (t.kind === 'ident' && nxt.kind === 'punc' && nxt.value === '=') {
      this.next();
      this.next();
      return { name: t.value, expr: this.parseExpr() };
    }
    return { expr: this.parseExpr() };
  }

  private parseSortList(): SortItem[] {
    const items: SortItem[] = [];
    do {
      const expr = this.parseExpr();
      // KQL sorts descending by default
      let desc = true;
      if (this.eatIdent('asc')) desc = false;
      else if (this.eatIdent('desc')) desc = true;
      items.push({ expr, desc });
    } while (this.eatPunc(','));
    return items;
  }

  // ---- expressions, lowest precedence first -------------------------------

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let l = this.parseAnd();
    for (;;) {
      const t = this.peek();
      const isOr = (t.kind === 'punc' && t.value === '||') || this.atIdent('or');
      if (!isOr) return l;
      this.next();
      l = { k: 'bin', op: 'or', l, r: this.parseAnd(), pos: t.pos };
    }
  }

  private parseAnd(): Expr {
    let l = this.parseComparison();
    for (;;) {
      const t = this.peek();
      const isAnd = (t.kind === 'punc' && t.value === '&&') || this.atIdent('and');
      if (!isAnd) return l;
      this.next();
      l = { k: 'bin', op: 'and', l, r: this.parseComparison(), pos: t.pos };
    }
  }

  private parseComparison(): Expr {
    const l = this.parseAdditive();
    const t = this.peek();

    if (t.kind === 'punc' && ['==', '!=', '<', '<=', '>', '>=', '=~', '!~'].includes(t.value)) {
      this.next();
      return { k: 'bin', op: t.value, l, r: this.parseAdditive(), pos: t.pos };
    }

    // `!` followed by a word op, e.g. `!contains`
    if (t.kind === 'punc' && t.value === '!' && this.peek(1).kind === 'ident') {
      const word = '!' + this.peek(1).value.toLowerCase();
      if (WORD_OPS.has(word)) {
        this.next();
        this.next();
        return { k: 'bin', op: word, l, r: this.parseAdditive(), pos: t.pos };
      }
    }

    if (t.kind === 'ident' && WORD_OPS.has(t.value.toLowerCase())) {
      const op = t.value.toLowerCase();
      this.next();
      if (op === 'in' || op === '!in' || op === 'in~') {
        return { k: 'bin', op, l, r: this.parseListLiteral(), pos: t.pos };
      }
      return { k: 'bin', op, l, r: this.parseAdditive(), pos: t.pos };
    }

    return l;
  }

  private parseListLiteral(): Expr {
    const open = this.peek();
    this.expectPunc('(');
    this.enter(open.pos);
    try {
      const items: Expr[] = [];
      if (!this.atPunc(')')) {
        do {
          items.push(this.parseExpr());
        } while (this.eatPunc(','));
      }
      this.expectPunc(')');
      return { k: 'list', items };
    } finally {
      this.leave();
    }
  }

  private parseAdditive(): Expr {
    let l = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'punc' && (t.value === '+' || t.value === '-')) {
        this.next();
        l = { k: 'bin', op: t.value, l, r: this.parseMultiplicative(), pos: t.pos };
      } else return l;
    }
  }

  private parseMultiplicative(): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'punc' && ['*', '/', '%'].includes(t.value)) {
        this.next();
        l = { k: 'bin', op: t.value, l, r: this.parseUnary(), pos: t.pos };
      } else return l;
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'punc' && t.value === '-') {
      this.next();
      return { k: 'un', op: '-', e: this.parseUnary() };
    }
    if (t.kind === 'punc' && t.value === '!') {
      this.next();
      return { k: 'un', op: 'not', e: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.atPunc('.') && this.peek(1).kind === 'ident') {
        this.next();
        e = { k: 'member', obj: e, name: this.next().value };
      } else if (this.atPunc('[')) {
        this.next();
        const idx = this.parseExpr();
        this.expectPunc(']');
        e = { k: 'index', obj: e, idx };
      } else return e;
    }
  }

  private parsePrimary(): Expr {
    const t = this.next();

    if (t.kind === 'num') return { k: 'num', v: t.num! };
    if (t.kind === 'str') return { k: 'str', v: t.value };
    if (t.kind === 'timespan') return { k: 'ts', ms: t.ms! };

    if (t.kind === 'punc' && t.value === '(') {
      this.enter(t.pos);
      try {
        const e = this.parseExpr();
        this.expectPunc(')');
        return e;
      } finally {
        this.leave();
      }
    }

    // `*` is only meaningful inside arg_max(...) / count(*)
    if (t.kind === 'punc' && t.value === '*') return { k: 'star' };

    if (t.kind === 'ident') {
      const lower = t.value.toLowerCase();
      if (lower === 'true') return { k: 'bool', v: true };
      if (lower === 'false') return { k: 'bool', v: false };
      if (lower === 'null') return { k: 'null' };

      if (this.atPunc('(')) {
        this.next();
        this.enter(t.pos);
        try {
          const args: Expr[] = [];
          if (!this.atPunc(')')) {
            do {
              args.push(this.parseExpr());
            } while (this.eatPunc(','));
          }
          this.expectPunc(')');
          return { k: 'call', name: lower, args, pos: t.pos };
        } finally {
          this.leave();
        }
      }
      return { k: 'col', name: t.value, pos: t.pos };
    }

    throw new KqlError(`Unexpected '${t.value}' in expression.`, t.pos);
  }
}

export function parse(src: string): Query {
  return new Parser(src).parseQuery();
}
