import { runQuery, formatError, tableSignature } from './index';
import { comparisonType, ResultComparisonError, rowSignature } from './comparison';
import { KqlError, type Database, type Table } from './types';

export interface ChallengeConcept {
  /** Short name of the idea being taught. */
  title: string;
  /** Plain-English explanation, written for someone who has never seen KQL. */
  body: string;
  /** The shape of the query, as a template. */
  pattern: string;
  /** A worked example that really runs — the Learn tab shows its output. */
  example: { query: string; explain: string };
}

/**
 * A terminal challenge. Content designers author these declaratively:
 * they write the reference `solution` query and the engine grades by
 * comparing the player's result table against it.
 */
export interface ChallengeSpec {
  id: string;
  /** Shown as the terminal's objective. */
  prompt: string;
  /** In-fiction flavour above the prompt. */
  flavour?: string;
  /** Taught BEFORE the task is attempted. */
  concept: ChallengeConcept;
  /** Concept recap — shown after a correct answer. */
  teaches: string;
  /** Progressive hints, revealed one at a time (each costs score). */
  hints: string[];
  /** Pre-filled editor content. */
  starter: string;
  /** Reference query used to compute the expected result. */
  solution: string;
  /** Operators/functions the player must use, e.g. ['summarize','count']. */
  requiredOperators?: string[];
  /** Compare row order too? Only for "sort/top" style challenges. */
  ordered?: boolean;
  /** Evidence unlocked when solved. */
  evidenceId?: string;
  /**
   * Strings that must actually appear in the result of the reference solution.
   *
   * Guards against the terminal claiming more than it shows — an early version
   * asserted "TLS handshake failed" in the evidence panel while the query only
   * returned a list of machine names.
   */
  evidenceTokens?: string[];
  /** Gate opened in the Phaser world when solved. */
  unlocksGate?: string;
  /** Index of the room this terminal sits in — drives the objective tracker. */
  room: number;
  /** Points awarded for a first-try correct answer. */
  points: number;
}

export type GradeStatus = 'error' | 'incorrect' | 'correct';

export interface GradeResult {
  status: GradeStatus;
  /** Content/comparison failures are terminal faults, not scored player mistakes. */
  errorSource?: 'query' | 'reference' | 'comparison';
  /** The player's result table, when the query at least ran. */
  table?: Table;
  message: string;
  hint?: string;
  caret?: string;
  /** Diff summary shown on an incorrect-but-valid query. */
  diff?: string[];
}

function missingOperators(features: Set<string>, required: string[] | undefined): string[] {
  if (!required?.length) return [];
  return required.filter((r) => !features.has(r.toLowerCase()));
}

export function gradeChallenge(
  spec: ChallengeSpec,
  userQuery: string,
  db: Database,
  now: Date,
): GradeResult {
  const trimmed = userQuery.trim();
  if (!trimmed) {
    return { status: 'error', message: 'The terminal is empty. Type a query and hit Run.' };
  }

  let result;
  try {
    result = runQuery(trimmed, db, { now });
  } catch (err) {
    if (!(err instanceof KqlError)) throw err;
    const f = formatError(err, trimmed);
    return {
      status: 'error',
      message: f.message,
      hint: f.hint,
      caret: f.caret,
    };
  }

  const missing = missingOperators(result.features, spec.requiredOperators);
  if (missing.length) {
    return {
      status: 'incorrect',
      table: result.table,
      message: `That runs, but this terminal needs you to use: ${missing.join(', ')}.`,
      hint: 'The lock is keyed to a specific operator — the right answer by the wrong route will not turn it.',
    };
  }

  // Compute the expected result from the reference solution.
  let expected: Table;
  try {
    expected = runQuery(spec.solution, db, { now }).table;
  } catch (err) {
    // A broken reference query is a content bug, not a player mistake.
    if (!(err instanceof KqlError)) throw err;
    return { status: 'error', errorSource: 'reference', message: `Terminal malfunction (bad reference query): ${err.message}` };
  }

  const ordered = spec.ordered ?? false;
  try {
    if (tableSignature(result.table, ordered) === tableSignature(expected, ordered)) {
      return {
        status: 'correct',
        table: result.table,
        message: 'Query accepted. Lock disengaged.',
      };
    }

    return {
      status: 'incorrect',
      table: result.table,
      message: 'The query ran, but the result is not what the terminal expects.',
      diff: describeDiff(result.table, expected, ordered),
    };
  } catch (err) {
    if (!(err instanceof ResultComparisonError)) throw err;
    return { status: 'error', errorSource: 'comparison', message: `Terminal malfunction (result comparison): ${err.message}` };
  }
}

function counts(keys: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of keys) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

function describeDiff(actual: Table, expected: Table, ordered: boolean): string[] {
  const notes: string[] = [];
  const actualCols = [...actual.columns].sort();
  const expectedCols = [...expected.columns].sort();
  const sameColumns = JSON.stringify(actualCols) === JSON.stringify(expectedCols);
  if (!sameColumns) {
    notes.push(`Expected columns: ${expected.columns.map(c => JSON.stringify(c)).join(', ')}`);
    notes.push(`Your columns:     ${actual.columns.map(c => JSON.stringify(c)).join(', ')}`);
  } else if (ordered && JSON.stringify(actual.columns) !== JSON.stringify(expected.columns)) {
    notes.push('Column order differs; this terminal checks column order.');
  }

  if (actual.rows.length !== expected.rows.length) {
    notes.push(
      `Expected ${expected.rows.length} row${expected.rows.length === 1 ? '' : 's'}, got ${actual.rows.length}.`,
    );
  }
  if (!sameColumns) return notes;

  const actualKeys = actual.rows.map(row => rowSignature(row, actualCols));
  const expectedKeys = expected.rows.map(row => rowSignature(row, actualCols));
  const actualCounts = counts(actualKeys);
  const expectedCounts = counts(expectedKeys);
  let matched = 0;
  let repeatedRowsDiffer = false;
  for (const [key, count] of actualCounts) {
    const expectedCount = expectedCounts.get(key) ?? 0;
    matched += Math.min(count, expectedCount);
    if (expectedCount > 0 && count !== expectedCount && Math.max(count, expectedCount) > 1) {
      repeatedRowsDiffer = true;
    }
  }

  if (matched === actual.rows.length && matched === expected.rows.length) {
    if (ordered && actualKeys.some((key, i) => key !== expectedKeys[i])) {
      notes.push('Rows match, but their order differs. This terminal checks row order.');
    }
    return notes;
  }

  const actualDuplicates = actual.rows.length - actualCounts.size;
  const expectedDuplicates = expected.rows.length - expectedCounts.size;
  if (actualDuplicates !== expectedDuplicates) {
    notes.push(
      `Repeated row occurrences beyond the first: expected ${expectedDuplicates}, got ${actualDuplicates}. Duplicate counts matter.`,
    );
  } else if (repeatedRowsDiffer) {
    notes.push('Some matching rows have different repetition counts. Duplicate counts matter.');
  }

  // Compare column-wide type distributions, not arbitrarily paired rows.
  // Reordering mixed-type rows or swapping values is not evidence of a type error.
  for (const column of actualCols) {
    if (notes.length >= 3) break;
    const actualTypes = counts(actual.rows.map(row => comparisonType(row[column] ?? null)));
    const expectedTypes = counts(expected.rows.map(row => comparisonType(row[column] ?? null)));
    if (!actualTypes.size || !expectedTypes.size) continue;
    const unexpected = [...actualTypes.keys()].filter(type => !expectedTypes.has(type)).sort();
    if (unexpected.length) {
      notes.push(
        `Column ${JSON.stringify(column)} has incompatible types: ${unexpected.join(', ')}; expected ${[...expectedTypes.keys()].sort().join(', ')}.`,
      );
    } else if (actual.rows.length === expected.rows.length
      && [...expectedTypes].some(([type, count]) => actualTypes.get(type) !== count)) {
      const summarize = (types: Map<string, number>) =>
        [...types].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
          .map(([type, count]) => `${type}: ${count}`).join(', ');
      notes.push(
        `Column ${JSON.stringify(column)} has different type counts: expected ${summarize(expectedTypes)}; got ${summarize(actualTypes)}.`,
      );
    }
  }

  notes.push(
    `${matched} of ${actual.rows.length} returned rows match (including duplicate counts); ${expected.rows.length - matched} expected rows are missing.`,
  );
  return notes.slice(0, 4);
}
