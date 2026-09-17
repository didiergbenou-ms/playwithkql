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
  { label: 'project-away', kind: 'operator', detail: 'remove columns', doc: 'Removes columns matching names or wildcard patterns.' },
  { label: 'project-keep', kind: 'operator', detail: 'keep columns', doc: 'Keeps columns matching names or wildcard patterns.' },
  { label: 'project-rename', kind: 'operator', detail: 'rename columns', doc: 'Renames columns with NewName = OldName, keeping the rest.' },
  { label: 'extend', kind: 'operator', detail: 'add column', doc: 'Adds a computed column, keeping the rest.' },
  { label: 'summarize', kind: 'operator', detail: 'aggregate', doc: 'Collapses rows into groups.' },
  { label: 'distinct', kind: 'operator', detail: 'unique rows', doc: 'Unique combinations of the given columns.' },
  { label: 'count', kind: 'operator', detail: 'row count', doc: 'Returns a single Count column.' },
  { label: 'take', kind: 'operator', detail: 'limit rows', doc: 'Returns up to N rows, no ordering promised.' },
  { label: 'top', kind: 'operator', detail: 'N by expr', doc: 'Top N rows by an expression.', insert: 'top 5 by ' },
  { label: 'sort by', kind: 'operator', detail: 'order rows', doc: 'Orders rows. Descending by default.', insert: 'sort by ' },
  { label: 'order by', kind: 'operator', detail: 'order rows', doc: 'Alias of sort by.', insert: 'order by ' },
  { label: 'render', kind: 'operator', detail: 'visualize results', doc: 'Ends the query with a timechart or columnchart.', insert: 'render ' },
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
  fn('case', 'cond, value, ..., else', 'Returns the value for the first true condition, or the final fallback.'),
  fn('datetime', 'literal -> datetime', 'A datetime literal, e.g. datetime(2026-03-11 09:15:00).'),
  fn('datetime_diff', 'period, datetime1, datetime2 -> int', 'Counts UTC boundaries from datetime2 to datetime1. Period: day, hour, minute, second or millisecond.'),
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
  { label: 'between', kind: 'keyword', doc: 'Inclusive range test: value between (low .. high).' },
  { label: '!between', kind: 'keyword', doc: 'Outside an inclusive range: value !between (low .. high).' },
];

export type Context =
  | { at: 'table' }
  | { at: 'operator' }
  | { at: 'search' }
  | { at: 'render' }
  | { at: 'end' }
  | { at: 'expression'; table?: string; search?: boolean }
  | { at: 'aggregate'; table?: string; search?: boolean }
  | { at: 'groupBy'; table?: string; search?: boolean };

/** Word immediately before the caret, which is what we filter on. */
export function prefixAt(src: string, caret: number): string {
  const before = src.slice(0, caret);
  const project = /\|\s*(project-[A-Za-z]*)$/i.exec(blankStrings(before));
  if (project) return project[1];
  const m = /(?:\$[A-Za-z0-9_]*|!?[A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  return m ? m[0] : '';
}

/** Masks literals and comments without moving the caret or hiding line breaks. */
function blankStrings(s: string): string {
  return s.replace(/\/\/[^\r\n]*|"(\\.|[^"\\])*"?|'(\\.|[^'\\])*'?/g, (m) => m.replace(/[^\r\n]/g, ' '));
}

export function contextAt(src: string, caret: number): Context {
  const raw = src.slice(0, caret);
  const before = blankStrings(raw);
  const search = /^\s*search\b/i.test(before);

  const lastPipe = before.lastIndexOf('|');
  if (lastPipe === -1) {
    if (search && !/^\s*search$/i.test(raw)) return { at: 'search' };
    // still naming the table, unless they already typed one and a space
    const head = before.trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(head) || head === '' ? { at: 'table' } : { at: 'expression' };
  }

  const tableMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(before);
  const source = search ? { search: true } : { table: tableMatch?.[1] };
  if (/\|\s*render\b/i.test(before.slice(0, lastPipe))) return { at: 'end' };

  const segment = before.slice(lastPipe + 1);
  const opMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z]*)?)/.exec(segment);

  // nothing after the pipe yet, or still typing the operator name
  if (!opMatch || /^\s*[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z]*)?$/.test(segment)) {
    return { at: 'operator' };
  }

  const op = opMatch[1].toLowerCase();
  const rest = segment.slice(opMatch[0].length);

  if (op === 'render') {
    return /^\s*(timechart|columnchart)\s+$/i.test(rest) ? { at: 'end' } : { at: 'render' };
  }
  if (op === 'summarize') {
    // once `by` appears we are naming grouping columns
    return /(^|\s)by(\s|$)/i.test(rest) ? { at: 'groupBy', ...source } : { at: 'aggregate', ...source };
  }
  if (op === 'sort' || op === 'order' || op === 'distinct' || op === 'project' || op.startsWith('project-') || op === 'extend') {
    return { at: 'groupBy', ...source };
  }
  return { at: 'expression', ...source };
}

function columnsOf(meta: TableMeta[], table?: string, search = false): Completion[] {
  const chosen = table ? meta.filter((t) => t.name.toLowerCase() === table.toLowerCase()) : meta;
  const source = chosen.length ? chosen : meta;
  const seen = new Set<string>();
  const out: Completion[] = [];
  if (search) {
    seen.add('$table');
    out.push({ label: '$table', kind: 'column', detail: 'string', doc: 'Source table for each search result.' });
  }
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

/**
 * Ranked, context-filtered suggestions for the caret position.
 * Pass the current database's metadata; search uses its union schema plus $table.
 * Column suggestions describe the source, not schema changes from earlier ops.
 */
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
      pool.push({
        label: 'search',
        kind: 'keyword',
        detail: 'search all tables',
        doc: 'Search supplied tables for one quoted ASCII letter/digit/underscore term, using case-insensitive has semantics. No wildcards or compound predicates.',
        insert: 'search ""',
        caretOffset: -1,
      });
      break;
    case 'search':
    case 'end':
      pool = [];
      break;
    case 'render':
      pool = [
        { label: 'timechart', kind: 'keyword', doc: 'Plots results over time. Must be the final operator.' },
        { label: 'columnchart', kind: 'keyword', doc: 'Plots results as columns. Must be the final operator.' },
      ];
      break;
    case 'operator':
      pool = OPERATORS;
      break;
    case 'aggregate':
      pool = [...AGGREGATES, ...columnsOf(meta, context.table, context.search), ...FUNCTIONS];
      break;
    case 'groupBy':
      pool = [...columnsOf(meta, context.table, context.search), ...FUNCTIONS, ...KEYWORDS];
      break;
    default:
      pool = [...columnsOf(meta, context.table, context.search), ...FUNCTIONS, ...KEYWORDS];
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
