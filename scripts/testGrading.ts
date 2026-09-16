import assert from 'node:assert/strict';
import { gradeChallenge, type ChallengeSpec, type GradeResult } from '../src/kql/challenge';
import { ResultComparisonError, valueSignature } from '../src/kql/comparison';
import { runQuery, tableSignature, timespan, type Database, type KValue, type Table } from '../src/kql/index';
import { buildDatabase, CASE_NOW, CHALLENGES } from '../src/data/case001';

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const now = new Date('2026-09-16T09:00:00.123Z');
const table = (values: KValue[], name = 'Actual'): Table => ({
  name, columns: ['Value'], rows: values.map(Value => ({ Value })),
});
const spec: ChallengeSpec = {
  id: 'grading-test', prompt: 'Match the requested result.', teaches: '',
  concept: { title: '', body: '', pattern: '', example: { query: '', explain: '' } },
  hints: [], starter: 'Actual', solution: 'Reference', room: 0, points: 1,
};
function grade(actual: Table, expected: Table, overrides: Partial<ChallengeSpec> = {}): GradeResult {
  return gradeChallenge({ ...spec, ...overrides }, 'Actual', { Actual: actual, Reference: expected }, now);
}
function diff(result: GradeResult): string {
  assert.equal(result.status, 'incorrect');
  assert.ok(result.diff?.length);
  assert.ok(result.diff.length <= 4, 'Feedback must fit in four lines');
  return result.diff.join('\n');
}
function different(a: KValue, b: KValue) {
  for (const ordered of [false, true]) {
    assert.notEqual(tableSignature(table([a]), ordered), tableSignature(table([b]), ordered));
  }
}

const collisions: [string, KValue, KValue][] = [
  ['number/string', 1, '1'],
  ['boolean/string', true, 'true'],
  ['boolean/number', false, 0],
  ['null/empty string', null, ''],
  ['datetime/display string', now, '2026-09-16 09:00:00.123Z'],
  ['datetime/ISO string', now, now.toISOString()],
  ['datetime/number', now, now.getTime()],
  ['timespan/display string', timespan(1000), '1000ms'],
  ['timespan/number', timespan(1000), 1000],
  ['timespan/property bag', timespan(1000), { ms: 1000 }],
  ['timespan/extended property bag', timespan(1000), { kind: 'timespan', ms: 1000, extra: true }],
  ['array/JSON string', [1, '1'], '[1,"1"]'],
  ['object/JSON string', { n: 1 }, '{"n":1}'],
  ['array/object', [1], { 0: 1 }],
  ['nested types', { a: [1] }, { a: ['1'] }],
  ['null/missing object property', { a: null }, {}],
];
for (const [name, actual, expected] of collisions) {
  check(`signature separates ${name}`, () => different(actual, expected));
  check(`valid queries grade ${name} as incorrect against independent tables`, () => {
    const result = grade(table([actual]), table([expected], 'Reference'));
    diff(result);
    assert.deepEqual(result.table, table([actual]), 'Only the player table is returned');
  });
}

check('special numbers have pairwise distinct, stable signatures', () => {
  const values: KValue[] = [NaN, Infinity, -Infinity, 0, null, 'NaN', 'Infinity', '-Infinity', '-0'];
  const signatures = values.map(valueSignature);
  assert.equal(new Set(signatures).size, values.length);
  assert.deepEqual(values.map(valueSignature), signatures);
  assert.equal(valueSignature(1.0), valueSignature(1));
  assert.equal(valueSignature(-0), valueSignature(0));
  assert.equal(grade(table([-0]), table([0])).status, 'correct');
  assert.equal(valueSignature(Number.NaN), valueSignature(0 / 0));
  different({ n: NaN }, { n: null });
  different(timespan(NaN), timespan(Infinity));
  assert.equal(valueSignature(timespan(-0)), valueSignature(timespan(0)));
});

check('dates retain milliseconds, normalize equal instants and handle invalid dates', () => {
  different(now, new Date(now.getTime() + 1));
  assert.equal(valueSignature(now), valueSignature(new Date('2026-09-16T10:00:00.123+01:00')));
  assert.equal(valueSignature(new Date(NaN)), valueSignature(new Date('invalid')));
  different(new Date(NaN), NaN);
  different(new Date(NaN), 'Invalid datetime');
  different(new Date(NaN), null);
  different(timespan(0.1), timespan(0.2));
});

check('engine structural timespan representation is explicit', () => {
  assert.equal(valueSignature(timespan(1000)), valueSignature({ ms: 1000, kind: 'timespan' }));
  different(timespan(1000), { kind: 'timespan', ms: '1000' });
});

check('property bags sort keys recursively but arrays retain order', () => {
  const a = { b: [1, { y: true, x: null }], a: now };
  const b = { a: new Date(now), b: [1, { x: null, y: true }] };
  assert.equal(valueSignature(a), valueSignature(b));
  assert.equal(grade(table([a]), table([b])).status, 'correct');
  different([1, 2], [2, 1]);
  different({ a: [1, 2] }, { a: [2, 1] });
  different([], [null]);
  assert.equal(valueSignature(Object.assign(Object.create(null), { a: 1 })), valueSignature({ a: 1 }));
});

check('shared dynamic references are not cycles and input is not mutated', () => {
  const child = Object.freeze({ z: 2, a: 1 });
  const value = Object.freeze({ y: child, x: child });
  assert.equal(valueSignature(value), valueSignature({ x: { a: 1, z: 2 }, y: { z: 2, a: 1 } }));
  assert.deepEqual(Object.keys(child), ['z', 'a']);
});

check('column, cell and row separator injection cannot alias a table', () => {
  const a: Table = { name: 'Actual', columns: ['a', 'b'], rows: [{ a: 'x\u0001b=y', b: 'z' }] };
  const b: Table = { name: 'Reference', columns: ['a', 'b'], rows: [{ a: 'x', b: 'y\u0001b=z' }] };
  for (const ordered of [false, true]) {
    assert.notEqual(tableSignature(a, ordered), tableSignature(b, ordered));
    assert.notEqual(
      tableSignature(table(['x\u0004Value=y']), ordered),
      tableSignature(table(['x', 'y']), ordered),
    );
    assert.notEqual(
      tableSignature({ name: '', columns: ['a\u0002b'], rows: [] }, ordered),
      tableSignature({ name: '', columns: ['a', 'b'], rows: [] }, ordered),
    );
  }
  different({ 'a=b\u0001c': '\u0002\u0003\u0004' }, { a: 'b\u0001c=\u0002\u0003\u0004' });
  different('["number","1"]', 1);
  diff(grade(a, b));
});

check('unordered ignores column and row order; ordered preserves both', () => {
  const a: Table = { name: 'Actual', columns: ['B', 'A'], rows: [{ A: 1, B: 'x' }, { A: 2, B: 'y' }] };
  const b: Table = { name: 'Other', columns: ['A', 'B'], rows: [...a.rows].reverse() };
  const before = JSON.stringify([a, b]);
  assert.equal(tableSignature(a, false), tableSignature(b, false));
  assert.notEqual(tableSignature(a, true), tableSignature(b, true));
  assert.equal(grade(a, b).status, 'correct');
  const notes = diff(grade(a, b, { ordered: true }));
  assert.match(notes, /Column order differs/);
  assert.match(notes, /Rows match, but their order differs/);
  assert.doesNotMatch(notes, /types|expected rows are missing/);
  assert.equal(JSON.stringify([a, b]), before);
  assert.equal(tableSignature(a, true), tableSignature({ ...a, name: 'Renamed' }, true));
});

check('empty tables preserve their schema and ordered column behavior', () => {
  const empty: Table = { name: '', columns: ['B', 'A'], rows: [] };
  const reversed: Table = { ...empty, columns: ['A', 'B'] };
  assert.equal(tableSignature(empty, false), tableSignature(reversed, false));
  assert.notEqual(tableSignature(empty, true), tableSignature(reversed, true));
  assert.match(diff(grade(empty, reversed, { ordered: true })), /Column order/);
  assert.equal(grade(empty, reversed).status, 'correct');
  assert.notEqual(tableSignature(empty, false), tableSignature({ ...empty, columns: [] }, false));
  assert.notEqual(
    tableSignature({ name: '', columns: [], rows: [] }, false),
    tableSignature({ name: '', columns: [], rows: [{}] }, false),
  );
  assert.match(diff(grade(table([]), table([1]))), /Expected 1 row, got 0/);
  assert.match(diff(grade(table([1]), table([]))), /Expected 0 rows, got 1/);
});

check('missing table cells equal null but never empty strings', () => {
  const absent: Table = { name: '', columns: ['Value'], rows: [{}] };
  const undefinedCell: Table = { ...absent, rows: [{ Value: undefined } as unknown as Table['rows'][number]] };
  assert.equal(tableSignature(absent, false), tableSignature(table([null]), false));
  assert.equal(tableSignature(undefinedCell, false), tableSignature(table([null]), false));
  assert.notEqual(tableSignature(absent, false), tableSignature(table(['']), false));
});

check('row comparison is a multiset, not a distinct set', () => {
  assert.equal(tableSignature(table([1, 2, 1]), false), tableSignature(table([2, 1, 1]), false));
  assert.notEqual(tableSignature(table([1, 1, 2]), false), tableSignature(table([1, 2, 2]), false));
  assert.notEqual(tableSignature(table([1, 1]), false), tableSignature(table([1]), false));
  const redistributed = diff(grade(table([1, 1, 2]), table([1, 2, 2])));
  assert.match(redistributed, /different repetition counts/);
  assert.match(redistributed, /2 of 3 returned rows match/);
  assert.match(diff(grade(table([1, 1]), table([1, 2]))), /expected 0, got 1. Duplicate counts matter/);
  assert.match(diff(grade(table([1, 2]), table([1, 1]))), /expected 1, got 0. Duplicate counts matter/);
});

check('ordered mixed-type rows are an ordering mismatch, never a type mismatch', () => {
  const actual = table(['1', 1, true, null]);
  const expected = table([null, true, 1, '1']);
  assert.equal(grade(actual, expected).status, 'correct');
  const notes = diff(grade(actual, expected, { ordered: true }));
  assert.match(notes, /Rows match, but their order differs/);
  assert.doesNotMatch(notes, /types|type counts/);
});

check('value swaps across mixed-type rows are not diagnosed as type errors', () => {
  const actual: Table = { name: 'Actual', columns: ['Key', 'Value'], rows: [{ Key: 'a', Value: 1 }, { Key: 'b', Value: '1' }] };
  const expected: Table = { name: 'Reference', columns: ['Key', 'Value'], rows: [{ Key: 'a', Value: '1' }, { Key: 'b', Value: 1 }] };
  for (const ordered of [false, true]) {
    const notes = diff(grade(actual, expected, { ordered }));
    assert.match(notes, /0 of 2 returned rows match/);
    assert.doesNotMatch(notes, /types|type counts|their order differs/);
  }
});

check('type feedback names the column and actual/expected types, including distribution', () => {
  assert.match(diff(grade(table(['1']), table([1]))), /Column "Value".*string; expected number/);
  assert.match(diff(grade(table(['1000ms']), table([timespan(1000)]))), /string; expected timespan/);
  assert.match(diff(grade(table([now.toISOString()]), table([now]))), /string; expected datetime/);
  assert.match(diff(grade(table(['']), table([null]))), /string; expected null/);
  const notes = diff(grade(table([1, 2, 'a']), table([1, 'a', 'b'])));
  assert.match(notes, /different type counts: expected number: 1, string: 2; got number: 2, string: 1/);
});

check('same types with wrong values report match counts rather than guesses', () => {
  const notes = diff(grade(table([1, 2, 3]), table([1, 4, 5])));
  assert.match(notes, /1 of 3 returned rows match.*2 expected rows are missing/);
  assert.doesNotMatch(notes, /types|filter|aggregation|their order differs/);
  const nested = diff(grade(table([{ a: ['1'] }]), table([{ a: [1] }])));
  assert.match(nested, /0 of 1 returned rows match/);
  assert.doesNotMatch(nested, /incompatible types/);
});

check('column comparison cannot be fooled by comma-joined names', () => {
  const actual: Table = { name: '', columns: ['a,b', 'c'], rows: [] };
  const expected: Table = { name: '', columns: ['a', 'b,c'], rows: [] };
  assert.match(diff(grade(actual, expected)), /Expected columns: "a", "b,c"/);
});

check('diffs are capped and do not return reference cells or the solution', () => {
  const secret = 'DO_NOT_REVEAL_REFERENCE_CELL';
  const expected: Table = {
    name: 'HiddenReferenceName', columns: ['Value', 'Count', 'When', 'Details'],
    rows: [{ Value: secret, Count: 8675309, When: new Date('2042-03-04T05:06:07.891Z'), Details: { secret } }],
  };
  const actual: Table = {
    name: 'Actual', columns: [...expected.columns],
    rows: Array.from({ length: 2 }, () => ({ Value: 1, Count: 'wrong', When: false, Details: null })),
  };
  const solution = 'Reference | project Value, Count, When, Details';
  const result = grade(actual, expected, { solution });
  diff(result);
  const serialized = JSON.stringify(result);
  for (const hidden of [secret, '8675309', '2042-03-04', solution, 'HiddenReferenceName']) {
    assert.ok(!serialized.includes(hidden), `Reference content leaked: ${hidden}`);
  }
});

check('actual conversion queries cannot pass merely by matching formatted strings', () => {
  for (const value of [1, true, null, now, timespan(1000)]) {
    const db: Database = { Actual: table([value]), Reference: table([value], 'Reference') };
    const query = 'Actual | project Value = tostring(Value)';
    assert.equal(typeof runQuery(query, db, { now }).table.rows[0].Value, 'string');
    assert.equal(gradeChallenge(spec, query, db, now).status, 'incorrect');
  }
});

check('equivalent operator queries still pass against independent expected tables', () => {
  const db: Database = { Actual: table([3, 1, 2, 1]), Reference: table([2, 3], 'Reference') };
  const query = 'Actual | where Value > 1 | project Value | sort by Value asc';
  assert.equal(gradeChallenge({ ...spec, ordered: true }, query, db, now).status, 'correct');
  assert.equal(gradeChallenge(spec, 'Actual | where Value > 1 | sort by Value desc', db, now).status, 'correct');
});

check('required operators, empty input, syntax errors and bad references retain their statuses', () => {
  const db: Database = { Actual: table([1]), Reference: table([1], 'Reference') };
  const missing = gradeChallenge({ ...spec, requiredOperators: ['where'] }, 'Actual', db, now);
  assert.equal(missing.status, 'incorrect');
  assert.match(missing.message, /needs you to use: where/);
  assert.equal(gradeChallenge({ ...spec, requiredOperators: ['WHERE'] }, 'Actual | where Value == 1', db, now).status, 'correct');
  assert.equal(gradeChallenge(spec, '   ', db, now).status, 'error');
  const syntax = gradeChallenge(spec, 'Actual | where |', db, now);
  assert.equal(syntax.status, 'error');
  assert.ok(syntax.caret);
  const badReference = gradeChallenge({ ...spec, solution: 'Nonexistent' }, 'Actual', db, now);
  assert.equal(badReference.status, 'error');
  assert.match(badReference.message, /Terminal malfunction \(bad reference query\)/);
});

check('cycles fail explicitly without stack overflow or returning cyclic tables', () => {
  const cyclic: { [key: string]: KValue } = {};
  cyclic.self = cyclic;
  const array: KValue[] = [];
  array.push(array);
  for (const value of [cyclic, array]) {
    assert.throws(() => valueSignature(value), ResultComparisonError);
    for (const [actual, expected] of [[value, null], [null, value]] as [KValue, KValue][]) {
      const result = grade(table([actual]), table([expected]));
      assert.equal(result.status, 'error');
      assert.match(result.message, /cyclic dynamic value/);
      assert.equal(result.table, undefined);
      assert.doesNotThrow(() => JSON.stringify(result));
    }
  }
});

check('deep authored dynamics are rejected explicitly before recursive stack overflow', () => {
  let value: KValue = 1;
  for (let i = 0; i < 10_000; i++) value = { child: value };
  assert.throws(() => valueSignature(value), ResultComparisonError);
  const result = grade(table([value]), table([null]));
  assert.equal(result.status, 'error');
  assert.match(result.message, /nested too deeply/);
  let supported: KValue = 1;
  for (let i = 0; i < 64; i++) supported = [supported];
  assert.doesNotThrow(() => valueSignature(supported));
});

check('unsupported authored values are not silently converted to null or empty bags', () => {
  for (const value of [undefined, 1n, () => 1, new Map(), { x: undefined }, new Array(1)]) {
    assert.throws(() => valueSignature(value as KValue), ResultComparisonError);
  }
});

check('unexpected exceptions are not hidden by a broad comparison fallback', () => {
  const failure = new Error('Unexpected getter failure');
  const value = Object.defineProperty({}, 'x', { enumerable: true, get() { throw failure; } });
  assert.throws(() => valueSignature(value), error => error === failure);
  assert.throws(() => grade(table([value]), table([null])), error => error === failure);
});

const caseDb = buildDatabase();
for (const challenge of CHALLENGES) {
  check(`existing authored solution still passes: ${challenge.id}`, () => {
    assert.equal(gradeChallenge(challenge, challenge.solution, caseDb, CASE_NOW).status, 'correct');
  });
}

console.log(`Grading: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
