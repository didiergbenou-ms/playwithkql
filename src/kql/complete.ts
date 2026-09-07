import type { TableMeta } from '../data/case001';

/**
 * Context-aware completion for the KQL terminal.
 *
 * The interesting part is `contextAt`: what you get offered depends on where
 * the caret is in the pipeline. After a `|` you want operators; after `where`
 * you want columns; after `summarize` you want aggregations. A flat
 * alphabetical list of everything is easy to build and much less useful.
 */

export type CompletionKind =
  | 'table'
  | 'operator'
  | 'column'
  | 'function'
  | 'aggregate'
  | 'keyword';

export interface Completion {
  label: string;
  kind: CompletionKind;
  /** Type or signature, shown right-aligned. */
  detail?: string;
  doc?: string;
  /** Text actually inserted; defaults to label. */
  insert?: string;
  /** Caret offset from the end of the inserted text (e.g. -1 to sit inside parens). */
  caretOffset?: number;
}

export const OPERATORS: Completion[] = [
  { label: 'where', kind: 'operator', detail: 'filter rows', doc: 'Keeps only rows matching a predicate.' },
  { label: 'project', kind: 'operator', detail: 'pick columns', doc: 'Selects, renames or computes columns.' },
  { label: 'extend', kind: 'operator', detail: 'add column', doc: 'Adds a computed column, keeping the rest.' },
  { label: 'summarize', kind: 'operator', detail: 'aggregate', doc: 'Collapses rows into groups.' },
  { label: 'distinct', kind: 'operator', detail: 'unique rows', doc: 'Unique combinations of the given columns.' },
  { label: 'count', kind: 'operator', detail: 'row count', doc: 'Returns a single Count column.' },
  { label: 'take', kind: 'operator', detail: 'limit rows', doc: 'Returns up to N rows, no ordering promised.' },
  { label: 'top', kind: 'operator', detail: 'N by expr', doc: 'Top N rows by an expression.', insert: 'top 5 by ' },
  { label: 'sort by', kind: 'operator', detail: 'order rows', doc: 'Orders rows. Descending by default.', insert: 'sort by ' },
  { label: 'order by', kind: 'operator', detail: 'order rows', doc: 'Alias of sort by.', insert: 'order by ' },
];

const fn = (label: string, detail: string, doc: string): Completion => ({
  label,
  kind: 'function',
  detail,
  doc,
  insert: `${label}(`,
});

export const FUNCTIONS: Completion[] = [
  fn('ago', 'timespan -> datetime', 'A time in the past, e.g. ago(24h).'),
  fn('now', '-> datetime', 'The current time.'),
  fn('bin', 'value, size', 'Rounds down into fixed buckets, e.g. bin(TimeGenerated, 1h).'),
  fn('parse_json', 'string -> dynamic', 'Parses JSON text so you can walk it with dot notation.'),
  fn('todynamic', 'string -> dynamic', 'Alias of parse_json.'),
  fn('isnotempty', 'value -> bool', 'True when the value is neither null nor empty.'),
  fn('isempty', 'value -> bool', 'True when the value is null or empty.'),
  fn('isnull', 'value -> bool', 'True when the value is null.'),
  fn('isnotnull', 'value -> bool', 'True when the value is not null.'),
  fn('strcat', '...values -> string', 'Concatenates its arguments.'),
  fn('tolower', 'string -> string', 'Lowercases a string.'),
  fn('toupper', 'string -> string', 'Uppercases a string.'),
  fn('tostring', 'value -> string', 'Converts to string.'),
  fn('toint', 'value -> int', 'Converts to integer.'),
  fn('substring', 'string, start, len', 'Extracts part of a string.'),
  fn('split', 'string, delim', 'Splits a string into an array.'),
  fn('extract', 'regex, n, text', 'Pulls a capture group out of text.'),
  fn('iff', 'cond, then, else', 'Conditional expression.'),
  fn('coalesce', '...values', 'First non-empty value.'),
  fn('startofday', 'datetime', 'Midnight of the given day.'),
  fn('array_length', 'array -> int', 'Number of elements.'),
  fn('abs', 'number', 'Absolute value.'),
  fn('round', 'number, digits', 'Rounds to N digits.'),
];

const agg = (label: string, detail: string, doc: string): Completion => ({
  label,
  kind: 'aggregate',
  detail,
  doc,
  insert: `${label}(`,
});

export const AGGREGATES: Completion[] = [
  agg('count', '-> int', 'Number of rows in each group. Usually written count().'),
  agg('dcount', 'column -> int', 'Number of distinct values.'),
  agg('sum', 'column', 'Adds up a numeric column.'),
  agg('avg', 'column', 'Mean of a numeric column.'),
  agg('min', 'column', 'Smallest value.'),
  agg('max', 'column', 'Largest value.'),
  agg('arg_max', 'expr, *', 'The whole row holding the maximum. The most useful idiom in support.'),
  agg('arg_min', 'expr, *', 'The whole row holding the minimum.'),
  agg('countif', 'predicate', 'Counts rows matching a condition.'),
  agg('make_set', 'column', 'Distinct values collected into an array.'),
  agg('make_list', 'column', 'All values collected into an array.'),
];

export const KEYWORDS: Completion[] = [
  { label: 'by', kind: 'keyword', doc: 'Groups a summarize by one or more columns.' },
  { label: 'asc', kind: 'keyword', doc: 'Ascending sort order.' },
  { label: 'desc', kind: 'keyword', doc: 'Descending sort order (the default).' },
  { label: 'and', kind: 'keyword', doc: 'Logical and.' },
  { label: 'or', kind: 'keyword', doc: 'Logical or.' },
  { label: 'contains', kind: 'keyword', doc: 'Case-insensitive substring match.' },
  { label: 'has', kind: 'keyword', doc: 'Case-insensitive whole-word match — faster than contains.' },
  { label: 'startswith', kind: 'keyword', doc: 'Prefix match.' },
  { label: 'endswith', kind: 'keyword', doc: 'Suffix match.' },
  { label: 'in', kind: 'keyword', doc: 'Membership test, e.g. in ("a", "b").' },
];

export type Context =
  | { at: 'table' }
  | { at: 'operator' }
  | { at: 'expression'; table?: string }
  | { at: 'aggregate'; table?: string }
  | { at: 'groupBy'; table?: string };

/** Word immediately before the caret, which is what we filter on. */
export function prefixAt(src: string, caret: number): string {
  const before = src.slice(0, caret);
  const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
  return m ? m[0] : '';
}

/** Strips string literals so their contents never affect context detection. */
function blankStrings(s: string): string {
  return s.replace(/"(\\.|[^"\\])*"?|'(\\.|[^'\\])*'?/g, (m) => ' '.repeat(m.length));
}

export function contextAt(src: string, caret: number): Context {
  const raw = src.slice(0, caret);
  const before = blankStrings(raw);

  const lastPipe = before.lastIndexOf('|');
  if (lastPipe === -1) {
    // still naming the table, unless they already typed one and a space
    const head = before.trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(head) || head === '' ? { at: 'table' } : { at: 'expression' };
  }

  const tableMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(before);
  const table = tableMatch?.[1];

  const segment = before.slice(lastPipe + 1);
  const opMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(segment);

  // nothing after the pipe yet, or still typing the operator name
  if (!opMatch || /^\s*[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
    return { at: 'operator' };
  }

  const op = opMatch[1].toLowerCase();
  const rest = segment.slice(opMatch[0].length);

  if (op === 'summarize') {
    // once `by` appears we are naming grouping columns
    return /(^|\s)by(\s|$)/i.test(rest) ? { at: 'groupBy', table } : { at: 'aggregate', table };
  }
  if (op === 'sort' || op === 'order' || op === 'distinct' || op === 'project' || op === 'extend') {
    return { at: 'groupBy', table };
  }
  return { at: 'expression', table };
}

function columnsOf(meta: TableMeta[], table?: string): Completion[] {
  const chosen = table ? meta.filter((t) => t.name.toLowerCase() === table.toLowerCase()) : meta;
  const source = chosen.length ? chosen : meta;
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const t of source) {
    for (const c of t.columns) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push({ label: c.name, kind: 'column', detail: c.type, doc: c.doc });
    }
  }
  return out;
}

const RANK: Record<CompletionKind, number> = {
  operator: 0,
  aggregate: 1,
  column: 2,
  table: 3,
  function: 4,
  keyword: 5,
};

/** Ranked, context-filtered suggestions for the caret position. */
export function completionsFor(
  src: string,
  caret: number,
  meta: TableMeta[],
  limit = 9,
): { items: Completion[]; prefix: string; context: Context } {
  const prefix = prefixAt(src, caret);
  const context = contextAt(src, caret);

  let pool: Completion[];
  switch (context.at) {
    case 'table':
      pool = meta.map((t) => ({
        label: t.name,
        kind: 'table' as const,
        detail: `${t.columns.length} cols`,
        doc: t.doc,
      }));
      break;
    case 'operator':
      pool = OPERATORS;
      break;
    case 'aggregate':
      pool = [...AGGREGATES, ...columnsOf(meta, context.table), ...FUNCTIONS];
      break;
    case 'groupBy':
      pool = [...columnsOf(meta, context.table), ...FUNCTIONS, ...KEYWORDS];
      break;
    default:
      pool = [...columnsOf(meta, context.table), ...FUNCTIONS, ...KEYWORDS];
      break;
  }

  const lower = prefix.toLowerCase();
  const scored = pool
    .map((c, index) => {
      const l = c.label.toLowerCase();
      if (!lower) return { c, score: 0, index };
      if (l.startsWith(lower)) return { c, score: 0, index };
      if (l.includes(lower)) return { c, score: 1, index };
      return null;
    })
    .filter((x): x is { c: Completion; score: number; index: number } => x !== null);

  // Ties break on authored order, not label length: the lists above are written
  // most-useful-first, so `where` should beat `top` after a pipe.
  scored.sort(
    (a, b) => a.score - b.score || RANK[a.c.kind] - RANK[b.c.kind] || a.index - b.index,
  );

  return { items: scored.slice(0, limit).map((s) => s.c), prefix, context };
}

/** Applies a completion, returning the new text and caret position. */
export function applyCompletion(
  src: string,
  caret: number,
  item: Completion,
): { text: string; caret: number } {
  const prefix = prefixAt(src, caret);
  const start = caret - prefix.length;
  const insert = item.insert ?? item.label;
  const text = src.slice(0, start) + insert + src.slice(caret);
  return { text, caret: start + insert.length + (item.caretOffset ?? 0) };
}
