import { parse, type Expr, type Query } from './parser';
import { evaluate, type EvalOptions } from './evaluator';
import { rowSignature } from './comparison';
import { KqlError, type Database, type Table } from './types';

export * from './types';
export { parse } from './parser';
export { evaluate, toDisplayString } from './evaluator';
export type { Expr, Query } from './parser';

export interface QueryResult {
  table: Table;
  /** Every operator + function the query used, e.g. {"where","summarize","arg_max"}. */
  features: Set<string>;
}

/** Parse + run in one go. Throws KqlError with a friendly message. */
export function runQuery(src: string, db: Database, opts?: EvalOptions): QueryResult {
  const ast = parse(src);
  const table = evaluate(ast, db, opts);
  return { table, features: collectFeatures(ast) };
}

/** Walks the AST collecting operator names and function names. */
export function collectFeatures(q: Query): Set<string> {
  const out = new Set<string>();

  const walkExpr = (e: Expr): void => {
    switch (e.k) {
      case 'call':
        out.add(e.name);
        e.args.forEach(walkExpr);
        break;
      case 'bin':
        out.add(e.op);
        walkExpr(e.l);
        walkExpr(e.r);
        break;
      case 'un':
        walkExpr(e.e);
        break;
      case 'member':
        walkExpr(e.obj);
        break;
      case 'index':
        walkExpr(e.obj);
        walkExpr(e.idx);
        break;
      case 'list':
        e.items.forEach(walkExpr);
        break;
      default:
        break;
    }
  };

  for (const op of q.ops) {
    out.add(op.kind);
    switch (op.kind) {
      case 'where':
        walkExpr(op.expr);
        break;
      case 'project':
      case 'extend':
      case 'distinct':
        op.items.forEach((i) => walkExpr(i.expr));
        break;
      case 'summarize':
        op.aggs.forEach((i) => walkExpr(i.expr));
        op.by.forEach((i) => walkExpr(i.expr));
        if (op.by.length) out.add('by');
        break;
      case 'sort':
      case 'top':
        op.items.forEach((i) => walkExpr(i.expr));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Renders a caret pointing at the offending token — shown in the game terminal. */
export function formatError(err: unknown, src: string): { message: string; hint?: string; caret?: string } {
  if (!(err instanceof KqlError)) {
    return { message: err instanceof Error ? err.message : String(err) };
  }
  if (err.pos < 0 || err.pos > src.length) {
    return { message: err.message, hint: err.hint };
  }

  const before = src.slice(0, err.pos);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = src.indexOf('\n', err.pos);
  const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
  const col = err.pos - lineStart;
  return {
    message: err.message,
    hint: err.hint,
    caret: `${line}\n${' '.repeat(Math.max(0, col))}^`,
  };
}

/** Type-aware answer signature. Unordered tables retain row multiplicities. */
export function tableSignature(t: Table, ordered: boolean): string {
  const cols = ordered ? t.columns : [...t.columns].sort();
  const keys = t.rows.map(row => rowSignature(row, cols));
  if (!ordered) keys.sort();
  return JSON.stringify([cols, keys]);
}
