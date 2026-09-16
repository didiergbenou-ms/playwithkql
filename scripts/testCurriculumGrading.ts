import assert from 'node:assert/strict';
import {
  gradeChallenge, type ChallengeSpec, type ChallengeValidation, type GradeResult,
} from '../src/kql/challenge';
import { runQuery } from '../src/kql/index';
import { timespan, type Database, type KValue, type Table } from '../src/kql/types';

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
const spec: ChallengeSpec = {
  id: 'curriculum-grading', prompt: 'Return the requested data.', teaches: '',
  concept: { title: '', body: '', pattern: '', example: { query: '', explain: '' } },
  hints: [], starter: 'Actual', solution: 'Reference', room: 0, points: 1,
};
const table = (values: KValue[]): Table => ({
  name: 'Values', columns: ['Value'], rows: values.map(Value => ({ Value })),
});
function grade(actual: Table, reference: Table, overrides: Partial<ChallengeSpec> = {}, query = 'Actual') {
  return gradeChallenge({ ...spec, ...overrides }, query, { Actual: actual, Reference: reference }, now);
}
function incorrect(result: GradeResult) {
  assert.equal(result.status, 'incorrect', result.message);
  assert.ok(result.diff?.length);
  assert.ok(result.diff.length <= 4);
  return result.diff.join('\n');
}
function contentError(result: GradeResult) {
  assert.equal(result.status, 'error', result.message);
  assert.equal(result.errorSource, 'reference');
  assert.equal(result.table, undefined);
  assert.equal(result.visualization, undefined);
}
const asc: ChallengeValidation = { mode: 'orderedBy', column: 'Value', direction: 'asc' };

check('a render lesson requires the requested chart kind, not only a render keyword', () => {
  const rows: Table = { name: 'Actual', columns: ['TimeGenerated', 'Value'], rows: [
    { TimeGenerated: now, Value: 1 },
  ] };
  const options = { solution: 'Actual | render timechart', requiredOperators: ['render'] };
  assert.equal(grade(rows, rows, options, 'Actual | render timechart').status, 'correct');
  const wrong = grade(rows, rows, options, 'Actual | render columnchart');
  assert.equal(wrong.status, 'incorrect');
  assert.equal(wrong.visualization?.kind, 'columnchart');
  assert.match(wrong.message, /timechart/);
});

check('omitting validation retains legacy unordered and ordered behavior', () => {
  const a: Table = { name: 'Actual', columns: ['B', 'A'], rows: [{ A: 1, B: 'x' }, { A: 2, B: 'y' }] };
  const b: Table = { name: 'Reference', columns: ['A', 'B'], rows: [...a.rows].reverse() };
  assert.equal(grade(a, b).status, 'correct');
  incorrect(grade(a, b, { ordered: true }));
  assert.equal(grade(a, b, { validation: { mode: 'resultSet' } }).status, 'correct');
  incorrect(grade(a, b, { ordered: true, validation: { mode: 'resultSet' } }));
});

check('resultSet fixture independently asserts the reference, including types and duplicate counts', () => {
  const validation: ChallengeValidation = {
    mode: 'resultSet', expected: { columns: ['Value'], rows: [{ Value: 1 }, { Value: 2 }, { Value: 1 }] },
  };
  assert.equal(grade(table([2, 1, 1]), table([1, 2, 1]), { validation }).status, 'correct');
  incorrect(grade(table([1, 2, 2]), table([1, 2, 1]), { validation }));
  incorrect(grade(table(['1', 2, 1]), table([1, 2, 1]), { validation }));
  contentError(grade(table([1, 1, 2]), table([1, 2, 2]), { validation }));
  contentError(grade(table([1, 1, 2]), table(['1', 2, 1]), { validation }));
  contentError(grade(table([2, 1, 1]), table([2, 1, 1]), { validation, ordered: true }));
});

check('rowCount accepts different samples and filters, not just reference row identities', () => {
  const source = table([1, 2, 3, 4]);
  const options: Partial<ChallengeSpec> = {
    solution: 'Actual | take 2', validation: { mode: 'rowCount', expectedRowCount: 2 },
    requiredOperators: ['take'],
  };
  const query = 'Actual | where Value > 2 | limit 2';
  const result = grade(source, table([]), options, query);
  assert.equal(result.status, 'correct');
  assert.deepEqual(result.table?.rows, [{ Value: 3 }, { Value: 4 }]);
  assert.equal(grade(source, table([]), options, 'Actual | where Value > 2').status, 'incorrect');
  incorrect(grade(source, table([]), options, 'Actual | take 1'));
  incorrect(grade(source, table([]), options, 'Actual | take 3'));
  incorrect(grade(source, table([]), options, 'Actual | take 2 | project Other = Value'));
});

check('rowCount is expressly not a value, type, or provenance assertion', () => {
  const options: Partial<ChallengeSpec> = {
    validation: { mode: 'rowCount', expectedRowCount: 2 }, requiredOperators: ['take'],
  };
  assert.equal(grade(table([3, 4]), table([1, 2]), options,
    'Actual | take 2 | project Value = "not-source-data"').status, 'correct');
  assert.equal(grade(table([]), table([]), { validation: { mode: 'rowCount', expectedRowCount: 0 } }).status, 'correct');
  contentError(grade(table([1, 2]), table([1]), options));
});

check('rowCount requires the reference column set but not column order', () => {
  const a: Table = { name: '', columns: ['B', 'A'], rows: [{ A: 9, B: 8 }] };
  const b: Table = { name: '', columns: ['A', 'B'], rows: [{ A: 1, B: 2 }] };
  assert.equal(grade(a, b, { validation: { mode: 'rowCount', expectedRowCount: 1 } }).status, 'correct');
});

check('schema requires exact column order and the full typed unordered data', () => {
  const a: Table = { name: '', columns: ['A', 'B'], rows: [{ A: 1, B: 'x' }, { A: 2, B: 'y' }] };
  for (const expectedRowCount of [undefined, 2]) {
    const validation: ChallengeValidation = { mode: 'schema', expectedColumns: ['A', 'B'], expectedRowCount };
    assert.equal(grade({ ...a, rows: [...a.rows].reverse() }, a, { validation, ordered: true }).status, 'correct');
    assert.match(incorrect(grade({ ...a, columns: ['B', 'A'] }, a, { validation })), /Column order/);
    incorrect(grade(a, a, { validation }, 'Actual | take 0'));
    incorrect(grade({ ...a, rows: [a.rows[0], a.rows[0]] }, a, { validation }));
    incorrect(grade({ ...a, rows: [{ A: '1', B: 'x' }, a.rows[1]] }, a, { validation }));
    incorrect(grade({ ...a, rows: [{ A: 999, B: 'x' }, a.rows[1]] }, a, { validation }));
    incorrect(grade(a, a, { validation }, 'Actual | project A'));
  }
  const empty = { ...a, rows: [] };
  assert.equal(grade(empty, empty, { validation: { mode: 'schema', expectedColumns: ['A', 'B'] } }).status, 'correct');
});

const tied: Table = {
  name: 'Tied', columns: ['Value', 'Id'],
  rows: [{ Value: 1, Id: 'a' }, { Value: 1, Id: 'b' }, { Value: 2, Id: 'c' }],
};
check('orderedBy accepts any order within ties but not wrong rows, types, duplicates, or direction', () => {
  const reordered = { ...tied, rows: [tied.rows[1], tied.rows[0], tied.rows[2]] };
  assert.equal(grade(reordered, tied, { validation: asc, ordered: true }).status, 'correct');
  const descending = { ...tied, rows: [tied.rows[2], tied.rows[0], tied.rows[1]] };
  assert.equal(grade(descending, { ...tied, rows: [...tied.rows].reverse() },
    { validation: { ...asc, direction: 'desc' } }).status, 'correct');
  incorrect(grade(descending, tied, { validation: asc }));
  incorrect(grade({ ...tied, rows: [tied.rows[0], tied.rows[0], tied.rows[2]] }, tied, { validation: asc }));
  incorrect(grade({ ...tied, rows: [{ Value: 1, Id: 'wrong' }, ...tied.rows.slice(1)] }, tied, { validation: asc }));
  incorrect(grade({ ...tied, rows: [{ Value: '1', Id: 'a' }, ...tied.rows.slice(1)] }, tied, { validation: asc }));
  incorrect(grade({ ...tied, rows: tied.rows.slice(1) }, tied, { validation: asc }));
});

check('orderedBy column order is optional; declared columns and first value are assertions', () => {
  const a = { ...tied, columns: ['Id', 'Value'] };
  assert.equal(grade(a, tied, { validation: asc }).status, 'correct');
  const validation: ChallengeValidation = {
    ...asc, expectedColumns: ['Value', 'Id'], expectedRowCount: 3, expectedFirstValue: 1,
  };
  incorrect(grade(a, tied, { validation }));
  assert.equal(grade(tied, tied, { validation }).status, 'correct');
  contentError(grade(tied, tied, { validation: { ...validation, expectedFirstValue: '1' } }));
  contentError(grade(tied, tied, { validation: { ...validation, expectedFirstValue: 2 } }));
  contentError(grade(tied, tied, { validation: { ...validation, expectedRowCount: 2 } }));
});

check('orderedBy handles numeric, datetime, lexical string, boolean and null keys without coercion', () => {
  const sortedCases: KValue[][] = [
    [null, -Infinity, -1, 0, 2, 10, Infinity],
    [null, new Date(now.getTime() - 1), now, new Date(now.getTime() + 1)],
    [null, '10', '2', 'A', 'a'],
    ['2026-01-01T00:00:00+02:00', '2026-01-01T00:00:00Z'],
    [null, false, true],
    [null, null],
  ];
  for (const values of sortedCases) {
    for (const direction of ['asc', 'desc'] as const) {
      const orderedValues = direction === 'asc' ? values : [...values].reverse();
      const reference = table(orderedValues);
      const validation: ChallengeValidation = { ...asc, direction, expectedFirstValue: orderedValues[0] };
      assert.equal(grade(reference, reference, { validation }).status, 'correct');
      assert.equal(grade(reference, reference, { validation }, `Actual | sort by Value ${direction}`).status, 'correct');
      if (values.some(value => value !== null)) {
        incorrect(grade(table([...orderedValues].reverse()), reference, { validation }));
      }
    }
  }
  assert.equal(grade(table([]), table([]), { validation: asc }).status, 'correct');
  contentError(grade(table([]), table([]), { validation: { ...asc, expectedFirstValue: null } }));
});

check('all value-checking modes reject equal-looking but differently typed values', () => {
  const pairs: [KValue, KValue][] = [
    [1, '1'], [true, 'true'], [null, ''], [now, now.toISOString()],
    [timespan(1000), '1000ms'], [{ nested: [1] }, { nested: ['1'] }],
  ];
  for (const [expected, actual] of pairs) {
    const validations: (ChallengeValidation | undefined)[] = [
      undefined, { mode: 'resultSet' }, { mode: 'schema', expectedColumns: ['Value'] },
    ];
    for (const validation of validations) {
      incorrect(grade(table([actual]), table([expected]), { validation }));
    }
    if (expected === null || expected instanceof Date || ['number', 'boolean'].includes(typeof expected)) {
      incorrect(grade(table([actual]), table([expected]), { validation: asc }));
    }
  }
});

check('required and forbidden operators normalize only the two parser aliases and casing', () => {
  for (const required of ['take', 'LIMIT', 'limit']) {
    assert.equal(grade(table([1]), table([1]), { requiredOperators: [required] }, 'Actual | take 1').status, 'correct');
    assert.equal(grade(table([1]), table([1]), { requiredOperators: [required] }, 'Actual | limit 1').status, 'correct');
  }
  for (const [forbidden, query] of [
    ['LIMIT', 'Actual | take 1'], ['take', 'Actual | limit 1'],
    ['ORDER', 'Actual | sort by Value asc'], ['sort', 'Actual | order by Value asc'],
    ['tostring', 'Actual | project Value = tostring(Value)'],
  ]) {
    const result = grade(table([1]), table([1]), { forbiddenOperators: [forbidden] }, query);
    assert.equal(result.status, 'incorrect');
    assert.match(result.message, /needs you to avoid:/);
    assert.ok(result.table);
  }
  assert.equal(grade(table([1]), table([1]), { requiredOperators: ['ORDER'] }, 'Actual | sort by Value asc').status,
    'correct');
  const missing = grade(table([1]), table([1]), { requiredOperators: ['where'] });
  assert.equal(missing.message, 'That runs, but this terminal needs you to use: where.');
  assert.equal(grade(table([1]), table([1]), { requiredOperators: ['project-away'] }, 'Actual | project Value').status,
    'incorrect');
  assert.equal(grade(table([1]), table([1]), { forbiddenOperators: ['project-away', 'project-keep', 'pack'] },
    'Actual | project Value').status, 'correct');
});

check('operator names in strings, identifiers, or comments are not AST features', () => {
  const text = 'take limit order sort tostring';
  const data = table([text]);
  const query = `Actual | where Value == "${text}" // take 0 | sort by Value`;
  assert.equal(grade(data, data, { forbiddenOperators: ['take', 'sort', 'tostring'] }, query).status, 'correct');
  assert.equal(grade(data, data, { requiredOperators: ['take'] }, query).status, 'incorrect');
  const identifiers: Table = { name: 'take', columns: ['sort'], rows: [{ sort: 1 }] };
  const db: Database = { take: identifiers, Reference: identifiers };
  assert.equal(gradeChallenge({ ...spec, forbiddenOperators: ['take', 'sort'] }, 'take | project sort', db, now).status,
    'correct');
});

check('invalid runtime contracts are reference errors, including when player input is empty or misses operators', () => {
  const invalid: unknown[] = [
    null, false, [], {}, { mode: 'unknown' }, { mode: 'constructor' },
    { mode: 'rowCount' }, { mode: 'rowCount', expectedRowCount: -1 },
    { mode: 'rowCount', expectedRowCount: 0.5 }, { mode: 'rowCount', expectedRowCount: NaN },
    { mode: 'rowCount', expectedRowCount: Infinity }, { mode: 'rowCount', expectedRowCount: '1' },
    { mode: 'rowCount', expectedRowCount: Number.MAX_SAFE_INTEGER + 1 },
    { mode: 'schema' }, { mode: 'schema', expectedColumns: 'Value' },
    { mode: 'schema', expectedColumns: ['Value', 'Value'] }, { mode: 'schema', expectedColumns: [''] },
    { mode: 'schema', expectedColumns: new Array(1) },
    { mode: 'orderedBy', column: 'Value', direction: 'up' },
    { mode: 'orderedBy', direction: 'asc' }, { ...asc, expectedFirstValue: undefined },
    { mode: 'resultSet', expected: null }, { mode: 'resultSet', expected: { columns: ['Value'] } },
    { mode: 'resultSet', expected: { columns: ['Value'], rows: [null] } },
    { mode: 'resultSet', expected: { columns: ['Value'], rows: [{ Wrong: 1 }] } },
    { mode: 'resultSet', expected: { columns: ['Value'], rows: new Array(1) } },
    { mode: 'schema', expectedColumns: ['Value'], validate: () => true },
  ];
  for (const validation of invalid) {
    for (const query of ['Actual', '']) {
      contentError(grade(table([1]), table([1]),
        { validation: validation as ChallengeValidation, requiredOperators: ['where'] }, query));
    }
  }
});

check('implausible reference assertions and unsupported sort keys are author faults', () => {
  for (const validation of [
    { mode: 'rowCount', expectedRowCount: 2 },
    { mode: 'schema', expectedColumns: ['Wrong'] },
    { mode: 'schema', expectedColumns: ['Value'], expectedRowCount: 0 },
    { mode: 'orderedBy', column: 'Wrong', direction: 'asc' },
  ] as ChallengeValidation[]) {
    contentError(grade(table([1]), table([1]), { validation }));
  }
  contentError(grade(table([1]), table([1]), { validation: asc, solution: 'MissingReference' }));
  contentError(grade(table([1, 2]), table([2, 1]), { validation: asc }));
  for (const values of [[1, '2'], [now, now.toISOString()], [NaN], [new Date(NaN)], [timespan(1)], [{}], [[1]]]) {
    contentError(grade(table(values), table(values), { validation: asc }));
  }
});

check('bad fixture values are reference errors while bad actual values remain comparison errors', () => {
  const cyclic: { [key: string]: KValue } = {};
  cyclic.self = cyclic;
  contentError(grade(table([1]), table([1]),
    { validation: { mode: 'resultSet', expected: { columns: ['Value'], rows: [{ Value: cyclic }] } } }));
  const result = grade(table([cyclic]), table([1]), { validation: { mode: 'schema', expectedColumns: ['Value'] } });
  assert.equal(result.status, 'error');
  assert.equal(result.errorSource, 'comparison');
  assert.equal(result.table, undefined);
});

check('unexpected implementation exceptions propagate rather than becoming a scored failure', () => {
  const error = new Error('unexpected getter');
  const value = Object.defineProperty({}, 'secret', { enumerable: true, get() { throw error; } });
  assert.throws(() => grade(table([value]), table([1]), { validation: { mode: 'resultSet' } }), e => e === error);
  assert.throws(() => grade(table([1]), table([value]), { validation: { mode: 'resultSet' } }), e => e === error);
});

check('feedback never includes hidden reference cells, fixtures, or attribution notes', () => {
  const secret = 'never-show-reference-content';
  for (const validation of [
    { mode: 'schema', expectedColumns: ['Value'] },
    { mode: 'resultSet', expected: { columns: ['Value'], rows: [{ Value: secret }] } },
    { mode: 'orderedBy', column: 'Value', direction: 'asc', expectedFirstValue: secret },
  ] as ChallengeValidation[]) {
    const result = grade(table(['wrong']), table([secret]), {
      validation, sourceIds: [secret], sourceTerminalId: secret, contentNote: secret,
    });
    incorrect(result);
    assert.deepEqual(result.table?.rows, [{ Value: 'wrong' }]);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  const fault = grade(table([1]), table([2]), {
    validation: { mode: 'orderedBy', column: 'Value', direction: 'asc', expectedFirstValue: secret },
  });
  contentError(fault);
  assert.ok(!JSON.stringify(fault).includes(secret));
});

check('successful and unsuccessful grades return the executed player table without invented visualization', () => {
  const source = table([1, 2]);
  for (const query of ['Actual', 'Actual | take 1']) {
    const executed = runQuery(query, { Actual: source }, { now });
    const result = grade(source, source, {}, query);
    assert.deepEqual(result.table, executed.table);
    assert.equal(result.visualization, undefined);
  }
});

console.log(`Curriculum grading: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
