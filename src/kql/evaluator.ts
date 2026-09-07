import type { Expr, NamedExpr, Query, SortItem } from './parser';
import {
  KqlError,
  didYouMean,
  isTimespan,
  timespan,
  type Database,
  type KValue,
  type Row,
  type Table,
} from './types';

/**
 * Guards for the user-supplied regex in `matches`.
 *
 * Both the pattern and the subject come from the player, so a catastrophically
 * backtracking pattern can lock the browser tab solid — the game freezes with
 * no error and no way back.
 *
 * Exponential blowup needs a *quantified group*: something like `(a+)+$` or
 * `(a|aa)+$`, where the group can match the same input more than one way and
 * the outer quantifier multiplies those choices. So rather than chase
 * individual bad shapes — an earlier attempt caught `(a+)+` but not the
 * alternation form, and hung the test run — the rule here is simply that a
 * group may not be quantified at all.
 *
 * Quantified *atoms* stay allowed, so ordinary patterns are unaffected:
 * `^CONTOSO-\d+$` and `WEB-0[12]$` both work. Only `(...)+`, `(...)*` and
 * `(...){n,}` are refused, which no query in a KQL teaching game needs.
 * Remaining polynomial cases are bounded by the subject length cap.
 */
const MAX_REGEX_PATTERN = 200;
const MAX_REGEX_SUBJECT = 2000;
const QUANTIFIED_GROUP = /\)\s*[+*{]/;

const AGGREGATES = new Set([
  'count',
  'countif',
  'dcount',
  'sum',
  'avg',
  'min',
  'max',
  'arg_max',
  'arg_min',
  'make_set',
  'make_list',
]);

export interface EvalOptions {
  /** Fixed "now" so cases are deterministic and replayable. */
  now?: Date;
  /** Safety valve against runaway queries. */
  maxRows?: number;
}

interface Ctx {
  now: Date;
  columns: string[];
}

// ---- value helpers ---------------------------------------------------------

const isDate = (v: unknown): v is Date => v instanceof Date;

function toNumber(v: KValue): number {
  if (v === null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isDate(v)) return v.getTime();
  if (isTimespan(v)) return v.ms;
  if (typeof v === 'string') return Number(v);
  return NaN;
}

export function toDisplayString(v: KValue): string {
  if (v === null || v === undefined) return '';
  if (isDate(v)) return v.toISOString().replace('T', ' ').replace('.000Z', 'Z');
  if (isTimespan(v)) return `${v.ms}ms`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function truthy(v: KValue): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return true;
}

/** Ordering comparison. null sorts lowest. */
function cmp(a: KValue, b: KValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (isDate(a) || isDate(b)) return toNumber(a) - toNumber(b);
  if (typeof a === 'number' || typeof b === 'number') return toNumber(a) - toNumber(b);
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const sa = toDisplayString(a);
  const sb = toDisplayString(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function eq(a: KValue, b: KValue): boolean {
  if (a === null || b === null) return a === b;
  if (isDate(a) || isDate(b)) return toNumber(a) === toNumber(b);
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

const s = (v: KValue) => toDisplayString(v);

/** KQL `has` is a whole-token, case-insensitive match. */
function hasToken(haystack: string, needle: string, caseSensitive: boolean): boolean {
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  if (!n) return false;
  return h.split(/[^A-Za-z0-9_]+/).includes(n);
}

// ---- scalar function library ----------------------------------------------

function callScalar(name: string, args: KValue[], ctx: Ctx, pos: number): KValue {
  const a0 = args[0];

  switch (name) {
    case 'now':
      return ctx.now;
    case 'ago': {
      const ms = isTimespan(a0) ? a0.ms : toNumber(a0);
      return new Date(ctx.now.getTime() - ms);
    }
    case 'bin':
    case 'floor_bin': {
      const step = isTimespan(args[1]) ? args[1].ms : toNumber(args[1]);
      if (!step) return a0;
      if (isDate(a0)) return new Date(Math.floor(a0.getTime() / step) * step);
      return Math.floor(toNumber(a0) / step) * step;
    }
    case 'startofday': {
      const d = new Date(toNumber(a0));
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'startofhour': {
      const d = new Date(toNumber(a0));
      d.setUTCMinutes(0, 0, 0);
      return d;
    }
    case 'hourofday':
      return new Date(toNumber(a0)).getUTCHours();
    case 'datetime':
    case 'todatetime': {
      const d = new Date(s(a0));
      return isNaN(d.getTime()) ? null : d;
    }
    case 'totimespan':
      return isTimespan(a0) ? a0 : timespan(toNumber(a0));
    case 'isempty':
      return a0 === null || a0 === '';
    case 'isnotempty':
      return !(a0 === null || a0 === '');
    case 'isnull':
      return a0 === null;
    case 'isnotnull':
      return a0 !== null;
    case 'not':
      return !truthy(a0);
    case 'strcat':
      return args.map(s).join('');
    case 'strlen':
      return s(a0).length;
    case 'tolower':
      return s(a0).toLowerCase();
    case 'toupper':
      return s(a0).toUpperCase();
    case 'tostring':
      return s(a0);
    case 'toint':
    case 'tolong':
      return Math.trunc(toNumber(a0));
    case 'todouble':
    case 'toreal':
      return toNumber(a0);
    case 'tobool':
      return truthy(a0);
    case 'substring': {
      const str = s(a0);
      const start = toNumber(args[1]);
      return args.length > 2 ? str.substr(start, toNumber(args[2])) : str.substring(start);
    }
    case 'indexof':
      return s(a0).indexOf(s(args[1]));
    case 'split': {
      const parts = s(a0).split(s(args[1]));
      return args.length > 2 ? (parts[toNumber(args[2])] ?? null) : parts;
    }
    case 'array_length':
      return Array.isArray(a0) ? a0.length : 0;
    case 'parse_json':
    case 'todynamic': {
      if (typeof a0 !== 'string') return a0;
      try {
        return JSON.parse(a0) as KValue;
      } catch {
        return null;
      }
    }
    case 'extract': {
      try {
        const re = new RegExp(s(a0));
        const m = re.exec(s(args[2]));
        if (!m) return null;
        return m[toNumber(args[1])] ?? null;
      } catch {
        return null;
      }
    }
    case 'iff':
    case 'iif':
      return truthy(a0) ? args[1] : args[2];
    case 'coalesce':
      return args.find((v) => v !== null && v !== '') ?? null;
    case 'abs':
      return Math.abs(toNumber(a0));
    case 'floor':
      return Math.floor(toNumber(a0));
    case 'round': {
      const digits = args.length > 1 ? toNumber(args[1]) : 0;
      const f = 10 ** digits;
      return Math.round(toNumber(a0) * f) / f;
    }
    case 'min_of':
      return args.reduce((m, v) => (cmp(v, m) < 0 ? v : m));
    case 'max_of':
      return args.reduce((m, v) => (cmp(v, m) > 0 ? v : m));
    default:
      throw new KqlError(
        `Unknown function '${name}()'.`,
        pos,
        AGGREGATES.has(name)
          ? `'${name}()' is an aggregation — use it inside 'summarize'.`
          : undefined,
      );
  }
}

// ---- expression evaluation -------------------------------------------------

function evalExpr(e: Expr, row: Row, ctx: Ctx): KValue {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'str':
      return e.v;
    case 'bool':
      return e.v;
    case 'null':
      return null;
    case 'ts':
      return timespan(e.ms);
    case 'star':
      return null;

    case 'col': {
      if (e.name in row) return row[e.name];
      const suggestion = didYouMean(e.name, ctx.columns);
      throw new KqlError(
        `Unknown column '${e.name}'.`,
        e.pos,
        suggestion
          ? `Did you mean '${suggestion}'?`
          : `Available columns: ${ctx.columns.join(', ')}.`,
      );
    }

    case 'call': {
      if (AGGREGATES.has(e.name)) {
        throw new KqlError(
          `'${e.name}()' can only be used inside 'summarize'.`,
          e.pos,
          `Try: | summarize ${e.name}(...) by SomeColumn`,
        );
      }
      const args = e.args.map((a) => evalExpr(a, row, ctx));
      return callScalar(e.name, args, ctx, e.pos);
    }

    case 'un': {
      const v = evalExpr(e.e, row, ctx);
      return e.op === '-' ? -toNumber(v) : !truthy(v);
    }

    case 'member': {
      const obj = evalExpr(e.obj, row, ctx);
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && !isDate(obj)) {
        return (obj as Record<string, KValue>)[e.name] ?? null;
      }
      return null;
    }

    case 'index': {
      const obj = evalExpr(e.obj, row, ctx);
      const idx = evalExpr(e.idx, row, ctx);
      if (Array.isArray(obj)) return obj[toNumber(idx)] ?? null;
      if (obj && typeof obj === 'object' && !isDate(obj)) {
        return (obj as Record<string, KValue>)[s(idx)] ?? null;
      }
      return null;
    }

    case 'list':
      return e.items.map((it) => evalExpr(it, row, ctx));

    case 'bin':
      return evalBinary(e, row, ctx);
  }
}

function evalBinary(e: Extract<Expr, { k: 'bin' }>, row: Row, ctx: Ctx): KValue {
  // short-circuit logical operators
  if (e.op === 'and') {
    return truthy(evalExpr(e.l, row, ctx)) && truthy(evalExpr(e.r, row, ctx));
  }
  if (e.op === 'or') {
    return truthy(evalExpr(e.l, row, ctx)) || truthy(evalExpr(e.r, row, ctx));
  }

  const l = evalExpr(e.l, row, ctx);
  const r = evalExpr(e.r, row, ctx);

  switch (e.op) {
    case '==':
      return eq(l, r);
    case '!=':
      return !eq(l, r);
    case '<':
      return cmp(l, r) < 0;
    case '<=':
      return cmp(l, r) <= 0;
    case '>':
      return cmp(l, r) > 0;
    case '>=':
      return cmp(l, r) >= 0;
    case '=~':
      return s(l).toLowerCase() === s(r).toLowerCase();
    case '!~':
      return s(l).toLowerCase() !== s(r).toLowerCase();
    case 'contains':
      return s(l).toLowerCase().includes(s(r).toLowerCase());
    case '!contains':
      return !s(l).toLowerCase().includes(s(r).toLowerCase());
    case 'contains_cs':
      return s(l).includes(s(r));
    case 'has':
      return hasToken(s(l), s(r), false);
    case '!has':
      return !hasToken(s(l), s(r), false);
    case 'has_cs':
      return hasToken(s(l), s(r), true);
    case 'startswith':
      return s(l).toLowerCase().startsWith(s(r).toLowerCase());
    case 'endswith':
      return s(l).toLowerCase().endsWith(s(r).toLowerCase());
    case 'matches': {
      // Both the pattern and the subject come from the player, so a
      // catastrophically backtracking pattern like `(a+)+$` against a long
      // near-match can lock the browser tab solid — the game would simply
      // freeze with no error and no way back.
      //
      // Rather than ship a second regex engine, the inputs are bounded. A
      // teaching query matches short machine names and error strings, so a
      // pattern or subject beyond these lengths is not a query anyone meant
      // to write, and refusing it costs nothing real.
      const pattern = s(r);
      const subject = s(l);
      if (pattern.length > MAX_REGEX_PATTERN || subject.length > MAX_REGEX_SUBJECT) return false;
      if (QUANTIFIED_GROUP.test(pattern)) return false;
      try {
        return new RegExp(pattern).test(subject);
      } catch {
        return false;
      }
    }
    case 'in':
      return Array.isArray(r) && r.some((v) => eq(l, v));
    case 'in~':
      return Array.isArray(r) && r.some((v) => s(l).toLowerCase() === s(v).toLowerCase());
    case '!in':
      return Array.isArray(r) && !r.some((v) => eq(l, v));
    case '+': {
      if (typeof l === 'string' || typeof r === 'string') return s(l) + s(r);
      if (isDate(l) && isTimespan(r)) return new Date(l.getTime() + r.ms);
      return toNumber(l) + toNumber(r);
    }
    case '-': {
      if (isDate(l) && isDate(r)) return timespan(l.getTime() - r.getTime());
      if (isDate(l) && isTimespan(r)) return new Date(l.getTime() - r.ms);
      return toNumber(l) - toNumber(r);
    }
    case '*':
      return toNumber(l) * toNumber(r);
    case '/': {
      const d = toNumber(r);
      return d === 0 ? null : toNumber(l) / d;
    }
    case '%':
      return toNumber(l) % toNumber(r);
    default:
      throw new KqlError(`Unsupported operator '${e.op}'.`, e.pos);
  }
}

// ---- naming ----------------------------------------------------------------

function defaultName(e: Expr, index: number): string {
  switch (e.k) {
    case 'col':
      return e.name;
    case 'member':
      return e.name;
    case 'call': {
      // bin(TimeGenerated, 1h) keeps the source column name, like real KQL
      if ((e.name === 'bin' || e.name === 'startofday' || e.name === 'startofhour') && e.args[0]) {
        return defaultName(e.args[0], index);
      }
      const inner = e.args[0] ? defaultName(e.args[0], index) : '';
      switch (e.name) {
        case 'count':
          return 'count_';
        case 'countif':
          return 'countif_';
        case 'dcount':
          return `dcount_${inner}`;
        case 'sum':
          return `sum_${inner}`;
        case 'avg':
          return `avg_${inner}`;
        case 'min':
          return `min_${inner}`;
        case 'max':
          return `max_${inner}`;
        case 'make_set':
          return `set_${inner}`;
        case 'make_list':
          return `list_${inner}`;
        default:
          return `${e.name}_${inner || index}`;
      }
    }
    default:
      return `Column${index + 1}`;
  }
}

const nameOf = (item: NamedExpr, index: number) => item.name ?? defaultName(item.expr, index);

// ---- aggregation -----------------------------------------------------------

interface AggOutput {
  columns: string[];
  compute: (group: Row[], out: Row) => void;
}

function buildAggregate(
  item: NamedExpr,
  index: number,
  ctx: Ctx,
  sourceCols: string[],
  byNames: string[],
): AggOutput {
  const e = item.expr;
  if (e.k !== 'call' || !AGGREGATES.has(e.name)) {
    throw new KqlError(
      `'summarize' expects an aggregation function, e.g. count() or arg_max().`,
      e.k === 'col' ? e.pos : -1,
      "Did you mean to put this after 'by'?",
    );
  }

  const argVals = (group: Row[], arg: Expr) => group.map((r) => evalExpr(arg, r, ctx));

  // arg_max / arg_min expand into several columns
  if (e.name === 'arg_max' || e.name === 'arg_min') {
    if (e.args.length < 1) {
      throw new KqlError(`'${e.name}' needs at least one argument.`, e.pos, `Try: ${e.name}(TimeGenerated, *)`);
    }
    const keyExpr = e.args[0];
    const keyName = item.name ?? defaultName(keyExpr, index);
    const rest = e.args.slice(1);
    const star = rest.some((a) => a.k === 'star') || rest.length === 0;
    const explicit = rest.filter((a) => a.k !== 'star');
    const explicitNames = explicit.map((a, i) => defaultName(a, i));
    // `*` carries every other column through, minus the key and the by-columns
    const projected = star
      ? sourceCols.filter((c) => c !== keyName && !byNames.includes(c))
      : explicitNames;
    const sign = e.name === 'arg_max' ? 1 : -1;

    return {
      columns: [keyName, ...projected],
      compute: (group, out) => {
        let bestRow: Row | null = null;
        let bestKey: KValue = null;
        for (const r of group) {
          const k = evalExpr(keyExpr, r, ctx);
          if (k === null) continue;
          if (bestRow === null || cmp(k, bestKey) * sign > 0) {
            bestRow = r;
            bestKey = k;
          }
        }
        out[keyName] = bestKey;
        if (star) {
          for (const c of projected) out[c] = bestRow ? (bestRow[c] ?? null) : null;
        } else {
          explicit.forEach((a, i) => {
            out[explicitNames[i]] = bestRow ? evalExpr(a, bestRow, ctx) : null;
          });
        }
      },
    };
  }

  const outName = nameOf(item, index);

  const compute: AggOutput['compute'] = (group, out) => {
    switch (e.name) {
      case 'count':
        out[outName] = group.length;
        return;
      case 'countif':
        out[outName] = group.filter((r) => truthy(evalExpr(e.args[0], r, ctx))).length;
        return;
      case 'dcount': {
        const seen = new Set(argVals(group, e.args[0]).map((v) => s(v)));
        out[outName] = seen.size;
        return;
      }
      case 'sum':
        out[outName] = argVals(group, e.args[0]).reduce<number>((t, v) => t + (toNumber(v) || 0), 0);
        return;
      case 'avg': {
        const nums = argVals(group, e.args[0]).map(toNumber).filter((n) => !isNaN(n));
        out[outName] = nums.length ? nums.reduce((t, v) => t + v, 0) / nums.length : null;
        return;
      }
      case 'min':
      case 'max': {
        const vals = argVals(group, e.args[0]).filter((v) => v !== null);
        if (!vals.length) {
          out[outName] = null;
          return;
        }
        const sign = e.name === 'max' ? 1 : -1;
        out[outName] = vals.reduce((m, v) => (cmp(v, m) * sign > 0 ? v : m));
        return;
      }
      case 'make_set': {
        const seen = new Map<string, KValue>();
        for (const v of argVals(group, e.args[0])) if (v !== null) seen.set(s(v), v);
        out[outName] = [...seen.values()];
        return;
      }
      case 'make_list':
        out[outName] = argVals(group, e.args[0]).filter((v) => v !== null);
        return;
      default:
        throw new KqlError(`Unsupported aggregation '${e.name}'.`, e.pos);
    }
  };

  return { columns: [outName], compute };
}

// ---- pipeline --------------------------------------------------------------

function applySort(rows: Row[], items: SortItem[], ctx: Ctx): Row[] {
  return [...rows].sort((a, b) => {
    for (const it of items) {
      const c = cmp(evalExpr(it.expr, a, ctx), evalExpr(it.expr, b, ctx));
      if (c !== 0) return it.desc ? -c : c;
    }
    return 0;
  });
}

export function evaluate(query: Query, db: Database, opts: EvalOptions = {}): Table {
  const now = opts.now ?? new Date();
  const maxRows = opts.maxRows ?? 20_000;

  const sourceKey = Object.keys(db).find(
    (k) => k.toLowerCase() === query.table.toLowerCase(),
  );
  if (!sourceKey) {
    const suggestion = didYouMean(query.table, Object.keys(db));
    throw new KqlError(
      `Unknown table '${query.table}'.`,
      query.tablePos,
      suggestion
        ? `Did you mean '${suggestion}'?`
        : `Available tables: ${Object.keys(db).join(', ')}.`,
    );
  }

  const source = db[sourceKey];
  let rows: Row[] = source.rows;
  let columns: string[] = [...source.columns];
  const ctx: Ctx = { now, columns };

  const setColumns = (cols: string[]) => {
    columns = cols;
    ctx.columns = cols;
  };

  for (const op of query.ops) {
    switch (op.kind) {
      case 'where':
        rows = rows.filter((r) => truthy(evalExpr(op.expr, r, ctx)));
        break;

      case 'take':
        rows = rows.slice(0, Math.max(0, op.n));
        break;

      case 'count':
        rows = [{ Count: rows.length }];
        setColumns(['Count']);
        break;

      case 'project': {
        const names = op.items.map(nameOf);
        rows = rows.map((r) => {
          const out: Row = {};
          op.items.forEach((it, i) => {
            out[names[i]] = evalExpr(it.expr, r, ctx);
          });
          return out;
        });
        setColumns(names);
        break;
      }

      case 'extend': {
        const names = op.items.map(nameOf);
        rows = rows.map((r) => {
          const out: Row = { ...r };
          op.items.forEach((it, i) => {
            out[names[i]] = evalExpr(it.expr, out, ctx);
          });
          return out;
        });
        setColumns([...columns, ...names.filter((n) => !columns.includes(n))]);
        break;
      }

      case 'distinct': {
        const names = op.items.map(nameOf);
        const seen = new Set<string>();
        const out: Row[] = [];
        for (const r of rows) {
          const projected: Row = {};
          op.items.forEach((it, i) => {
            projected[names[i]] = evalExpr(it.expr, r, ctx);
          });
          const key = names.map((n) => s(projected[n])).join('\u0001');
          if (!seen.has(key)) {
            seen.add(key);
            out.push(projected);
          }
        }
        rows = out;
        setColumns(names);
        break;
      }

      case 'summarize': {
        const byNames = op.by.map(nameOf);
        const sourceCols = columns;
        const aggs = op.aggs.map((it, i) => buildAggregate(it, i, ctx, sourceCols, byNames));

        const groups = new Map<string, { key: Row; rows: Row[] }>();
        for (const r of rows) {
          const key: Row = {};
          op.by.forEach((it, i) => {
            key[byNames[i]] = evalExpr(it.expr, r, ctx);
          });
          const k = byNames.map((n) => s(key[n])).join('\u0001');
          const existing = groups.get(k);
          if (existing) existing.rows.push(r);
          else groups.set(k, { key, rows: [r] });
        }

        // no `by` clause means one implicit group over everything
        if (op.by.length === 0 && groups.size === 0) {
          groups.set('', { key: {}, rows: [] });
        }

        const out: Row[] = [];
        for (const g of groups.values()) {
          const row: Row = { ...g.key };
          for (const agg of aggs) agg.compute(g.rows, row);
          out.push(row);
        }
        rows = out;
        setColumns([...byNames, ...aggs.flatMap((a) => a.columns)]);
        break;
      }

      case 'sort':
        rows = applySort(rows, op.items, ctx);
        break;

      case 'top':
        rows = applySort(rows, op.items, ctx).slice(0, Math.max(0, op.n));
        break;
    }

    if (rows.length > maxRows) {
      throw new KqlError(`Query produced more than ${maxRows} rows. Add a filter or 'take'.`);
    }
  }

  return { name: source.name, columns, rows };
}
