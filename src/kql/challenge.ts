import { runQuery, formatError, tableSignature, type QueryResult } from './index';
import { comparisonType, ResultComparisonError, rowSignature, valueSignature } from './comparison';
import { KqlError, type Database, type KValue, type Table } from './types';

export interface ChallengeConcept {
  /** Short name of the idea being taught. */
  title: string;
  /** Plain-English explanation, written for someone who has never seen KQL. */
  body: string;
  /** The shape of the query, as a template. */
  pattern: string;
  /** A worked example that really runs — the Learn tab shows its output. */
  example: { query: string; explain: string; allowEmpty?: boolean };
}

export type ChallengeValidation =
  /** An optional independent fixture must also agree with the executed reference. */
  | { mode: 'resultSet'; expected?: Pick<Table, 'columns' | 'rows'> }
  /** Sampling only: count and reference column set, NOT row provenance or values. */
  | { mode: 'rowCount'; expectedRowCount: number }
  /** Exact column order AND the full typed, unordered reference multiset. */
  | { mode: 'schema'; expectedColumns: string[]; expectedRowCount?: number }
  /**
   * Full reference multiset; ties may appear in any order. Sort keys must share
   * one non-null scalar type (number, datetime, string, boolean). Nulls are allowed.
   * Optional expectations, and the sort itself, must hold for the reference.
   */
  | {
    mode: 'orderedBy';
    column: string;
    direction: 'asc' | 'desc';
    expectedRowCount?: number;
    expectedColumns?: string[];
    expectedFirstValue?: KValue;
  };

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
  /** AST features that must not occur. Only limit -> take and order -> sort are aliases. */
  forbiddenOperators?: string[];
  /** Omit to retain legacy result-set grading (including `ordered`). */
  validation?: ChallengeValidation;
  /** Authoring attribution only; these fields do not prove result provenance. */
  sourceIds?: string[];
  contentNote?: string;
  sourceTerminalId?: string;
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
  /** Passed through only from the player's executed query, never the reference. */
  visualization?: { kind: 'timechart' | 'columnchart' };
  message: string;
  hint?: string;
  caret?: string;
  /** Diff summary shown on an incorrect-but-valid query. */
  diff?: string[];
}

function normalizeOperator(operator: string): string {
  const name = operator.toLowerCase();
  return name === 'limit' ? 'take' : name === 'order' ? 'sort' : name;
}

function missingOperators(features: Set<string>, required: string[] | undefined): string[] {
  if (!required?.length) return [];
  return required.filter((r) => !features.has(normalizeOperator(r)));
}

class ValidationContractError extends Error {}

function contractAssert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ValidationContractError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validColumns(value: unknown): value is string[] {
  return Array.isArray(value) && Array.from(value).every(c => typeof c === 'string' && c.length > 0)
    && new Set(value).size === value.length;
}

function validateContract(validation: unknown): asserts validation is ChallengeValidation {
  contractAssert(isRecord(validation), 'Validation must be an object.');
  const fields: Record<string, string[]> = {
    resultSet: ['mode', 'expected'],
    rowCount: ['mode', 'expectedRowCount'],
    schema: ['mode', 'expectedColumns', 'expectedRowCount'],
    orderedBy: ['mode', 'column', 'direction', 'expectedRowCount', 'expectedColumns', 'expectedFirstValue'],
  };
  contractAssert(typeof validation.mode === 'string' && Object.hasOwn(fields, validation.mode),
    'Unknown validation mode.');
  contractAssert(Object.keys(validation).every(key => fields[validation.mode as string].includes(key)),
    'Unexpected validation field.');
  if (validation.mode === 'rowCount' || validation.expectedRowCount !== undefined) {
    contractAssert(typeof validation.expectedRowCount === 'number'
      && Number.isSafeInteger(validation.expectedRowCount) && validation.expectedRowCount >= 0,
    'Expected row count must be a nonnegative safe integer.');
  }
  if (validation.mode === 'schema' || validation.expectedColumns !== undefined) {
    contractAssert(validColumns(validation.expectedColumns), 'Expected columns must be unique, nonempty names.');
  }
  if (validation.mode === 'orderedBy') {
    contractAssert(typeof validation.column === 'string' && validation.column.length > 0,
      'A sort column is required.');
    contractAssert(validation.direction === 'asc' || validation.direction === 'desc',
      'Sort direction must be asc or desc.');
    if (Object.hasOwn(validation, 'expectedFirstValue')) {
      valueSignature(validation.expectedFirstValue as KValue);
    }
  }
  if (validation.mode === 'resultSet' && validation.expected !== undefined) {
    const fixture = validation.expected;
    contractAssert(isRecord(fixture) && validColumns(fixture.columns) && Array.isArray(fixture.rows),
      'Expected fixture must contain columns and rows.');
    contractAssert(Object.keys(fixture).every(key => key === 'columns' || key === 'rows')
      && Array.from(fixture.rows as unknown[]).every(row => isRecord(row)
        && Object.keys(row).every(key => (fixture.columns as string[]).includes(key))),
    'Expected fixture contains invalid rows or fields.');
  }
}

function sameColumns(a: string[], b: string[], ordered = false): boolean {
  return JSON.stringify(ordered ? a : [...a].sort()) === JSON.stringify(ordered ? b : [...b].sort());
}

// No date parsing or numeric coercion: sortable non-null cells share one scalar type.
// Nulls sort first ascending / last descending, matching the local evaluator.
function sortValue(value: KValue): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  throw new ValidationContractError('Sort keys must be numbers, valid datetimes, strings, booleans, or null.');
}

function isMonotonic(table: Table, validation: Extract<ChallengeValidation, { mode: 'orderedBy' }>): boolean {
  const values = table.rows.map(row => sortValue(row[validation.column] ?? null));
  return values.every((value, i) => {
    if (i === 0) return true;
    const previous = values[i - 1];
    const comparison = previous === value ? 0 : previous === null ? -1 : value === null ? 1
      : previous < value ? -1 : 1;
    return validation.direction === 'asc' ? comparison <= 0 : comparison >= 0;
  });
}

function validateReference(spec: ChallengeSpec, reference: Table, validation: ChallengeValidation): Table {
  const referenceSignature = tableSignature(reference, validation.mode === 'resultSet' && (spec.ordered ?? false));
  if (validation.mode === 'resultSet') {
    if (validation.expected === undefined) return reference;
    const fixture: Table = { name: reference.name, ...validation.expected };
    contractAssert(tableSignature(fixture, spec.ordered ?? false) === referenceSignature,
      'Reference result disagrees with the independent expected fixture.');
    return fixture;
  }
  if (validation.expectedRowCount !== undefined) {
    contractAssert(reference.rows.length === validation.expectedRowCount,
      'Reference result disagrees with expected row count.');
  }
  if (validation.mode === 'rowCount') return reference;
  if (validation.expectedColumns !== undefined) {
    contractAssert(sameColumns(reference.columns, validation.expectedColumns, true),
      'Reference result disagrees with expected column order.');
  }
  if (validation.mode === 'orderedBy') {
    contractAssert(reference.columns.includes(validation.column), 'Sort column is absent from the reference.');
    const types = new Set<string>();
    for (const row of reference.rows) {
      const value = row[validation.column] ?? null;
      sortValue(value);
      if (value !== null) types.add(comparisonType(value));
    }
    contractAssert(types.size <= 1, 'Reference sort keys must share one non-null scalar type.');
    contractAssert(isMonotonic(reference, validation), 'Reference result is not sorted as declared.');
    if (Object.hasOwn(validation, 'expectedFirstValue')) {
      contractAssert(reference.rows.length > 0
        && valueSignature(reference.rows[0][validation.column] ?? null) === valueSignature(validation.expectedFirstValue!),
      'Reference result disagrees with expected first sort value.');
    }
  }
  return reference;
}

export function gradeChallenge(
  spec: ChallengeSpec,
  userQuery: string,
  db: Database,
  now: Date,
): GradeResult {
  // Explicit contracts are author assertions. Check them before charging any player mistake.
  let validatedExpected: Table | undefined;
  let referenceResult: QueryResult | undefined;
  if (spec.validation !== undefined) {
    try {
      validateContract(spec.validation);
      referenceResult = runQuery(spec.solution, db, { now });
      validatedExpected = validateReference(spec, referenceResult.table, spec.validation);
    } catch (err) {
      if (!(err instanceof ValidationContractError || err instanceof ResultComparisonError || err instanceof KqlError)) {
        throw err;
      }
      return {
        status: 'error',
        errorSource: 'reference',
        message: err instanceof KqlError
          ? 'Terminal malfunction (bad reference query).'
          : err instanceof ResultComparisonError
            ? 'Terminal malfunction (invalid reference values).'
            : `Terminal malfunction (invalid validation contract): ${err.message}`,
      };
    }
  }

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

  const actual: Pick<GradeResult, 'table' | 'visualization'> = { table: result.table };
  const visualization = result.visualization;
  if (visualization !== undefined) actual.visualization = visualization;
  const features = new Set([...result.features].map(normalizeOperator));
  const missing = missingOperators(features, spec.requiredOperators);
  if (missing.length) {
    return {
      status: 'incorrect',
      ...actual,
      message: `That runs, but this terminal needs you to use: ${missing.join(', ')}.`,
      hint: 'The lock is keyed to a specific operator — the right answer by the wrong route will not turn it.',
    };
  }

  const forbidden = spec.forbiddenOperators?.filter(operator => features.has(normalizeOperator(operator))) ?? [];
  if (forbidden.length) {
    return {
      status: 'incorrect',
      ...actual,
      message: `That runs, but this terminal needs you to avoid: ${forbidden.join(', ')}.`,
      hint: 'Use the operators taught by this terminal.',
    };
  }

  // Compute the expected result from the reference solution.
  let expected: Table;
  try {
    referenceResult ??= runQuery(spec.solution, db, { now });
    expected = validatedExpected ?? referenceResult.table;
  } catch (err) {
    // A broken reference query is a content bug, not a player mistake.
    if (!(err instanceof KqlError)) throw err;
    return { status: 'error', errorSource: 'reference', message: `Terminal malfunction (bad reference query): ${err.message}` };
  }

  if (spec.requiredOperators?.some(operator => normalizeOperator(operator) === 'render') &&
    referenceResult.visualization?.kind !== result.visualization?.kind) {
    return {
      status: 'incorrect', ...actual,
      message: `This lesson needs render ${referenceResult.visualization?.kind ?? 'with the specified chart kind'}.`,
    };
  }

  const ordered = spec.ordered ?? false;
  try {
    const validation = spec.validation;
    let matches: boolean;
    let diff: string[] | undefined;
    if (validation === undefined || validation.mode === 'resultSet') {
      matches = tableSignature(result.table, ordered) === tableSignature(expected, ordered);
      if (!matches) diff = describeDiff(result.table, expected, ordered);
    } else if (validation.mode === 'rowCount') {
      matches = result.table.rows.length === validation.expectedRowCount
        && sameColumns(result.table.columns, expected.columns);
      if (!matches) {
        diff = [];
        if (!sameColumns(result.table.columns, expected.columns)) {
          diff.push(`Expected columns: ${expected.columns.map(c => JSON.stringify(c)).join(', ')}`);
        }
        if (result.table.rows.length !== validation.expectedRowCount) {
          diff.push(`Expected ${validation.expectedRowCount} rows, got ${result.table.rows.length}.`);
        }
      }
    } else {
      const sameRows = tableSignature(result.table, false) === tableSignature(expected, false);
      const columnsMatch = validation.expectedColumns === undefined
        || sameColumns(result.table.columns, validation.expectedColumns, true);
      const sorted = validation.mode !== 'orderedBy' || !sameRows || isMonotonic(result.table, validation);
      matches = sameRows && columnsMatch && sorted;
      if (!matches) {
        diff = describeDiff(result.table, expected, false);
        if (!columnsMatch) diff.unshift('Column order differs; this terminal checks column order.');
        if (!sorted) diff.unshift('Rows match, but the requested sort direction is not satisfied.');
        diff = diff.slice(0, 4);
      }
    }
    if (matches) {
      return {
        status: 'correct',
        ...actual,
        message: 'Query accepted. Lock disengaged.',
      };
    }

    return {
      status: 'incorrect',
      ...actual,
      message: 'The query ran, but the result is not what the terminal expects.',
      diff,
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
