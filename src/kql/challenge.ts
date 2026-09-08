import { runQuery, formatError, tableSignature } from './index';
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
    const msg = err instanceof KqlError ? err.message : String(err);
    return { status: 'error', message: `Terminal malfunction (bad reference query): ${msg}` };
  }

  const ordered = spec.ordered ?? false;
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
}

function describeDiff(actual: Table, expected: Table, ordered: boolean): string[] {
  const notes: string[] = [];

  const actualCols = ordered ? actual.columns : [...actual.columns].sort();
  const expectedCols = ordered ? expected.columns : [...expected.columns].sort();
  if (actualCols.join(',') !== expectedCols.join(',')) {
    notes.push(`Expected columns: ${expected.columns.join(', ')}`);
    notes.push(`Your columns:     ${actual.columns.join(', ')}`);
  }

  if (actual.rows.length !== expected.rows.length) {
    notes.push(
      `Expected ${expected.rows.length} row${expected.rows.length === 1 ? '' : 's'}, got ${actual.rows.length}.`,
    );
    if (actual.rows.length > expected.rows.length) {
      notes.push('Too many rows — are you missing a filter or an aggregation?');
    } else {
      notes.push('Too few rows — is your filter too narrow?');
    }
  } else if (notes.length === 0) {
    notes.push('Same shape, different values. Check your filter bounds and column choice.');
    if (ordered) notes.push('This terminal cares about row order.');
  }

  return notes;
}
