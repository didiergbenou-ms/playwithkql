/**
 * Core value + table types for the mini-KQL engine.
 * The engine runs over static JSON "tables" shipped with each case.
 */

export interface Timespan {
  readonly kind: 'timespan';
  readonly ms: number;
}

export const timespan = (ms: number): Timespan => ({ kind: 'timespan', ms });

export const isTimespan = (v: unknown): v is Timespan =>
  typeof v === 'object' && v !== null && (v as Timespan).kind === 'timespan';

export type KValue =
  | string
  | number
  | boolean
  | Date
  | null
  | Timespan
  | KValue[]
  | { [key: string]: KValue };

export type Row = Record<string, KValue>;

export interface Table {
  /** Table name, e.g. "Heartbeat". */
  name: string;
  /** Ordered column headers. Survives even when rows is empty. */
  columns: string[];
  rows: Row[];
}

export type Database = Record<string, Table>;

/** Columns listed here are parsed into real Date objects when a case loads. */
export interface TableSchema {
  name: string;
  columns: string[];
  datetimeColumns?: string[];
  dynamicColumns?: string[];
}

export class KqlError extends Error {
  readonly pos: number;
  readonly hint?: string;

  constructor(message: string, pos = -1, hint?: string) {
    super(message);
    this.name = 'KqlError';
    this.pos = pos;
    this.hint = hint;
  }
}

/** Levenshtein distance, used for "did you mean" hints on typo'd columns. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Returns the closest candidate within a sane distance, or undefined. */
export function didYouMean(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = editDistance(word, c);
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  const tolerance = Math.max(2, Math.floor(word.length / 3));
  return best !== undefined && bestScore <= tolerance ? best : undefined;
}
