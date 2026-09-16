/**
 * Standalone curriculum-language regressions, using only synthetic tables.
 * From playwithkql: node scripts\run.mjs scripts\testCurriculumLanguage.ts
 */
import { deepStrictEqual } from 'node:assert/strict';
import {
  collectFeatures, evaluate, formatError, KqlError, parse, runQuery, tableSignature,
  timespan, type Database, type KValue, type Row, type Table,
} from '../src/kql/index';
import { tokenize } from '../src/kql/lexer';
import { applyCompletion, completionsFor, contextAt, prefixAt } from '../src/kql/complete';
import { buildHighlightSchema, highlightKql } from '../src/kql/highlight';
import { formatKql, pipeNeedsNewline, withSourceTable } from '../src/kql/format';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function eq(actual: unknown, expected: unknown, label: string) {
  deepStrictEqual(actual, expected, label);
}

const now = new Date('2026-03-11T10:00:00.000Z');
const opts = { now };
const db: Database = {
  Alpha: {
    name: 'Alpha',
    columns: ['Id', 'Message', 'X', 'When', 'Debug', 'DebugCode', 'TailCode', 'A', 'B', 'C'],
    rows: [
      { Id: 1, Message: 'link MTU_MISMATCH!', X: 1, When: new Date('2026-03-11T09:15:00Z'), Debug: 'one', DebugCode: 10, TailCode: 20, A: 'a1', B: 'b1', C: 'c1' },
      { Id: 2, Message: 'mtu_mismatch', X: 2, When: new Date('2026-03-11T09:30:00Z'), Debug: 'two', DebugCode: 11, TailCode: 21, A: 'a2', B: 'b2', C: 'c2' },
      { Id: 3, Message: 'MTU_MISMATCH_extra', X: 3, When: new Date('2026-03-11T09:45:00Z'), Debug: 'three', DebugCode: 12, TailCode: 22, A: 'a3', B: 'b3', C: 'c3' },
      { Id: 4, Message: 'healthy', X: 4, When: new Date('2026-03-11T09:45:00.001Z'), Debug: 'four', DebugCode: 13, TailCode: 23, A: 'a4', B: 'b4', C: 'c4' },
    ],
  },
  Beta: {
    name: 'Beta',
    columns: ['Id', 'Message', 'Extra'],
    rows: [
      { Id: 5, Message: 'healthy', Extra: 'MTU_MISMATCH' },
      { Id: 6, Message: 'MTU_MISMATCH MTU_MISMATCH', Extra: 'mtu_mismatch' },
      { Id: 7, Message: 'preMTU_MISMATCH', Extra: null },
    ],
  },
  Empty: { name: 'Empty', columns: ['OnlyEmpty'], rows: [] },
  Unit: { name: 'Unit', columns: ['Seed'], rows: [{ Seed: 0 }] },
};
const originalDb = structuredClone(db);
const run = (query: string, database = db) => runQuery(query, database, opts);
const table = (query: string, database = db) => run(query, database).table;
const scalar = (expression: string, database = db): KValue =>
  table(`Unit | project V = ${expression}`, database).rows[0].V;
const ids = (query: string, database = db) => table(query, database).rows.map(row => row.Id);

function rejects(query: string, message?: RegExp, pos?: number, database = db): KqlError {
  try {
    run(query, database);
  } catch (err) {
    assert(err instanceof KqlError, `Expected KqlError, got ${String(err)}`);
    assert(Number.isInteger(err.pos) && err.pos >= 0 && err.pos <= query.length,
      `Error offset ${err.pos} is outside the query`);
    if (message) assert(message.test(err.message), `Unexpected error: ${err.message}`);
    if (pos !== undefined) eq(err.pos, pos, 'exact source offset');
    return err;
  }
  throw new Error(`Expected rejection: ${query}`);
}

function features(query: string, expected: string[]) {
  eq([...collectFeatures(parse(query))].sort(), [...expected].sort(), 'normalized features');
}

function sameTable(actual: Table, expected: Table) {
  // Do not use tableSignature as the only oracle: it intentionally ignores table names.
  eq(actual, expected, 'table name, ordered schema, typed cells and row order');
}

// ---- root search / hasToken -------------------------------------------------

check('search unions every supplied schema and fills absent cells with null', () => {
  const result = table('search "MTU_MISMATCH"');
  const columns = ['$table', ...db.Alpha.columns, 'Extra', 'OnlyEmpty', 'Seed'];
  const matches: [string, Row][] = [
    ['Alpha', db.Alpha.rows[0]], ['Alpha', db.Alpha.rows[1]],
    ['Beta', db.Beta.rows[0]], ['Beta', db.Beta.rows[1]],
  ];
  sameTable(result, {
    name: 'search', columns,
    rows: matches.map(([name, row]) => Object.fromEntries(columns.map(column =>
      [column, column === '$table' ? name : row[column] ?? null]))),
  });
});

check('search accepts uppercase keyword and single-quoted lowercase term', () => {
  sameTable(table("SEARCH 'mtu_mismatch'"), table('search "MTU_MISMATCH"'));
});

check('search supports ordinary following pipeline and provenance filtering', () => {
  eq(table('search "MTU_MISMATCH" | where $table == "Beta" | project Id, Extra | order by Id asc').rows,
    [{ Id: 5, Extra: 'MTU_MISMATCH' }, { Id: 6, Extra: 'mtu_mismatch' }], 'filtered rows');
});

check('search emits a row once even when multiple cells and tokens match', () => {
  eq(ids('search "MTU_MISMATCH"'), [1, 2, 5, 6], 'source order, no duplicated hits');
});

check('search uses changed supplied data, not a canned curriculum answer', () => {
  const custom: Database = {
    Fresh: { name: 'unrelated display name', columns: ['Text'], rows: [{ Text: 'other' }] },
  };
  eq(table('search "MTU_MISMATCH"', custom).rows, [], 'no fixture matches');
  custom.Fresh.rows.push({ Text: 'mtu_mismatch' });
  eq(table('search "MTU_MISMATCH"', custom).rows,
    [{ $table: 'Fresh', Text: 'mtu_mismatch' }], 'database key provenance');
  eq(table('search "other"', custom).rows, [{ $table: 'Fresh', Text: 'other' }], 'arbitrary term');
});

check('search over no tables retains only provenance schema', () => {
  sameTable(table('search "MTU_MISMATCH"', {}), { name: 'search', columns: ['$table'], rows: [] });
});

check('search with no hits retains the full union schema', () => {
  const miss = table('search "NEVER_PRESENT"');
  eq(miss.columns, table('search "MTU_MISMATCH"').columns, 'zero-hit schema');
  eq(miss.rows, [], 'zero hits');
});

check('search scans declared cells, not table names, column names or hidden properties', () => {
  const custom: Database = {
    MTU_MISMATCH: {
      name: 'MTU_MISMATCH', columns: ['MTU_MISMATCH', 'Text'],
      rows: [{ MTU_MISMATCH: 'healthy', Text: 'healthy', Hidden: 'MTU_MISMATCH' }],
    },
  };
  eq(table('search "MTU_MISMATCH"', custom).rows, [], 'schema and hidden fields are not hits');
});

check('search does not duplicate a supplied $table column or trust its value', () => {
  const custom: Database = {
    Source: { name: 'Source', columns: ['$table', 'Text'], rows: [{ $table: 'spoofed', Text: 'MTU_MISMATCH' }] },
  };
  sameTable(table('search "MTU_MISMATCH"', custom), {
    name: 'search', columns: ['$table', 'Text'], rows: [{ $table: 'Source', Text: 'MTU_MISMATCH' }],
  });
});

check('search null-fills undeclared and inherited union cells', () => {
  const custom: Database = {
    First: { name: 'First', columns: ['Text'], rows: [{ Text: 'hit', Secret: 'hidden' }] },
    Second: { name: 'Second', columns: ['Secret', 'constructor'], rows: [] },
  };
  eq(table('search "hit"', custom).rows,
    [{ $table: 'First', Text: 'hit', Secret: null, constructor: null }], 'source schema is authoritative');
  const inherited = Object.create({ Text: 'hit' }) as Row;
  custom.First.rows = [inherited];
  eq(table('search "hit"', custom).rows, [], 'inherited properties cannot match');
});

const tokenCases: [string, string, boolean][] = [
  ['MTU_MISMATCH', 'mtu_mismatch', true],
  ['mTu_MiSmAtCh', 'MTU_MISMATCH', true],
  ['[MTU_MISMATCH], next', 'MTU_MISMATCH', true],
  ['MTU-MISMATCH', 'MTU_MISMATCH', false],
  ['prefixMTU_MISMATCH', 'MTU_MISMATCH', false],
  ['MTU_MISMATCH_suffix', 'MTU_MISMATCH', false],
  ['_MTU_MISMATCH', 'MTU_MISMATCH', false],
  ['MTU_MISMATCH2', 'MTU_MISMATCH', false],
  ['MTU_MISMATCH', 'MTU', false],
  ['MTU_MISMATCH', 'MISMATCH', false],
  ['éMTU_MISMATCHé', 'MTU_MISMATCH', true],
  ['abc9_def', 'ABC9_DEF', true],
  ['_', '_', true],
  ['123', '123', true],
  ['', 'MTU_MISMATCH', false],
];
for (const [text, term, expected] of tokenCases) {
  check(`search and has share exact ASCII/underscore token semantics: ${JSON.stringify([text, term])}`, () => {
    const custom: Database = { Words: { name: 'Words', columns: ['Text'], rows: [{ Text: text }] } };
    eq(table(`search ${JSON.stringify(term)}`, custom).rows.length, expected ? 1 : 0, 'search hit');
    eq(table(`Words | where Text has ${JSON.stringify(term)}`, custom).rows.length,
      expected ? 1 : 0, 'has hit');
  });
}

const invalidSearch = [
  'search', 'search MTU_MISMATCH', 'search 123', 'search ""', 'search "*"',
  'search "MTU*"', 'search "*MTU_MISMATCH"', 'search "MTU MISMATCH"', 'search "MTU-MISMATCH"',
  'search "é"', 'search "a.b"', 'search "a?b"', 'search "a|b"', 'search "a\\nb"',
  'search kind=case_sensitive "MTU_MISMATCH"', 'search in (Alpha) "MTU_MISMATCH"',
  'search Message has "MTU_MISMATCH"', 'search ("MTU_MISMATCH")',
  'search "MTU_MISMATCH" or "healthy"', 'search "MTU_MISMATCH" and "healthy"',
  'search "MTU_MISMATCH" "healthy"', 'search "MTU_MISMATCH" in (Alpha)',
  'search "MTU_MISMATCH" kind=case_sensitive', 'search "MTU_MISMATCH" == true',
  'search "MTU_MISMATCH" nonsense', 'Alpha | search "MTU_MISMATCH"',
];
for (const query of invalidSearch) {
  check(`unsupported search syntax rejects: ${query}`, () => { rejects(query); });
}

check('search trailing syntax offset is not the beginning of the literal', () => {
  const query = '// prefix\nsearch "MTU_MISMATCH" or "healthy"';
  rejects(query, /search/i, query.indexOf('or "'));
});

// ---- project-away / project-keep -------------------------------------------

const patternCases: [string, string[]][] = [
  ['Debug', ['Debug']],
  ['Debug*', ['Debug', 'DebugCode']],
  ['*Code', ['DebugCode', 'TailCode']],
  ['D*g*e', ['DebugCode']],
  ['*Code, Id', ['Id', 'DebugCode', 'TailCode']],
  ['Debug*, Debug, Debug*', ['Debug', 'DebugCode']],
  ['*', db.Alpha.columns],
  ['**', db.Alpha.columns],
  ['NoSuch, Missing*', []],
  ['debug*', []],
  ['D*', ['Debug', 'DebugCode']],
  ['*a*', ['Message', 'TailCode']],
  ['A, C, B', ['A', 'B', 'C']],
];
for (const [patterns, kept] of patternCases) {
  for (const op of ['project-away', 'project-keep'] as const) {
    check(`${op} preserves complement schema/order/rows: ${patterns}`, () => {
      const columns = op === 'project-keep' ? kept : db.Alpha.columns.filter(name => !kept.includes(name));
      sameTable(table(`Alpha | ${op} ${patterns}`), {
        name: 'Alpha', columns,
        rows: db.Alpha.rows.map(row => Object.fromEntries(columns.map(name => [name, row[name]]))),
      });
    });
  }
}

for (const op of ['project-away', 'project-keep'] as const) {
  check(`${op} preserves zero-row schema`, () => {
    const result = table(`Alpha | take 0 | ${op} Debug*`);
    eq(result.columns, table(`Alpha | ${op} Debug*`).columns, 'schema without rows');
    eq(result.rows, [], 'still empty');
  });
  check(`${op} preserves row multiplicity with no remaining columns`, () => {
    const patterns = op === 'project-away' ? '*' : 'Missing*';
    eq(table(`Alpha | ${op} ${patterns} | count`).rows, [{ Count: 4 }], 'empty objects still count');
  });
  for (const suffix of ['', 'A,', 'A = B', 'A + B', '"A"', 'A?', 'A B', '[A]', 'A, | count']) {
    check(`${op} malformed patterns reject: ${JSON.stringify(suffix)}`, () => {
      rejects(`Alpha | ${op} ${suffix}`);
    });
  }
}

check('projection patterns are anchored and can contain digits after a star', () => {
  const custom: Database = {
    Digits: { name: 'Digits', columns: ['A1', 'A12', 'BA1'], rows: [{ A1: 1, A12: 2, BA1: 3 }] },
  };
  eq(table('Digits | project-keep A*1', custom).columns, ['A1'], 'anchored numeric suffix');
});

check('projection wildcard suffixes are column text, not scalar timespans', () => {
  const custom: Database = {
    Counters: {
      name: 'Counters', columns: ['Requests24h', 'Errors1m', 'Total'],
      rows: [{ Requests24h: 4, Errors1m: 2, Total: 6 }],
    },
  };
  eq(table('Counters | project-keep *24h, *1m', custom).columns, ['Requests24h', 'Errors1m'], 'keep suffixes');
  eq(table('Counters | project-away *24h, *1m', custom).columns, ['Total'], 'away suffixes');
});

check('hyphenated operators do not steal subtraction', () => {
  eq(scalar('9-4'), 5, 'ordinary subtraction');
  eq(table('Alpha | project-away Debug | project V = X-1').rows.map(row => row.V),
    [0, 1, 2, 3], 'subtraction following hyphenated operator');
});

// ---- project-rename --------------------------------------------------------

const renameCases: [string, Record<string, string>][] = [
  ['Renamed = A', { A: 'Renamed' }],
  ['NewB = B, NewA = A', { A: 'NewA', B: 'NewB' }],
  ['A = A', { A: 'A' }],
  ['B = A, A = B', { A: 'B', B: 'A' }],
  ['B = A, C = B, A = C', { A: 'B', B: 'C', C: 'A' }],
  ['Fresh = B, B = A', { A: 'B', B: 'Fresh' }],
];
for (const [clause, mapping] of renameCases) {
  check(`project-rename is simultaneous and order-preserving: ${clause}`, () => {
    const expected: Table = {
      name: 'Alpha', columns: db.Alpha.columns.map(name => mapping[name] ?? name),
      rows: db.Alpha.rows.map(row => Object.fromEntries(db.Alpha.columns.map(name =>
        [mapping[name] ?? name, row[name]]))),
    };
    sameTable(table(`Alpha | project-rename ${clause}`), expected);
    sameTable(table(`Alpha | take 0 | project-rename ${clause}`), { ...expected, rows: [] });
  });
}

const badRenames: [string, RegExp][] = [
  ['New = Missing', /unknown column/i],
  ['New = a', /unknown column/i],
  ['First = A, Second = A', /more than once|duplicate/i],
  ['A = A, New = A', /more than once|duplicate/i],
  ['New = A, New = B', /duplicate/i],
  ['B = A', /duplicate/i],
  ['New = A, C = B', /duplicate/i],
  ['New = A, Other = New', /unknown column/i],
];
for (const [clause, message] of badRenames) {
  for (const prefix of ['Alpha', 'Alpha | take 0']) {
    check(`project-rename validates schema even without rows: ${prefix} / ${clause}`, () => {
      rejects(`${prefix} | project-rename ${clause}`, message);
    });
  }
}

for (const clause of ['', 'New A', 'New == A', 'New =', '= A', 'New = A,', 'New = A + B', 'New = *', '* = A']) {
  check(`project-rename malformed clause rejects: ${JSON.stringify(clause)}`, () => {
    rejects(`Alpha | project-rename ${clause}`);
  });
}

check('project-rename missing-source error identifies the old-name token on its line', () => {
  const query = 'Alpha\n| project-rename New = Missing';
  const err = rejects(query, /unknown column/i, query.indexOf('Missing'));
  eq(formatError(err, query).caret,
    '| project-rename New = Missing\n' + ' '.repeat('| project-rename New = '.length) + '^', 'line-local caret');
});

check('renamed columns can be referenced by downstream operators', () => {
  eq(table('Alpha | project-rename Value = X | where Value between (2..3) | project Value').rows,
    [{ Value: 2 }, { Value: 3 }], 'downstream schema');
  rejects('Alpha | project-rename Value = X | project X', /unknown column/i);
});

// ---- between ---------------------------------------------------------------

const ranges: [string, KValue[]][] = [
  ['X between (1..3)', [1, 2, 3]],
  ['X !between (1..3)', [4]],
  ['X BETWEEN (2 .. 2)', [2]],
  ['X !BETWEEN (2 .. 2)', [1, 3, 4]],
  ['X between (3..1)', []],
  ['X !between (3..1)', [1, 2, 3, 4]],
  ['X + 1 between (2..4)', [1, 2, 3]],
  ['X between (1..3) and Id > 1', [2, 3]],
  ['X between (1..1) or X between (4..4)', [1, 4]],
  ['X between (abs(-1)..toint("3"))', [1, 2, 3]],
  ['When between (datetime(2026-03-11 09:15:00)..datetime(2026-03-11 09:45:00))', [1, 2, 3]],
  ['When !between (datetime(2026-03-11T09:15:00Z)..datetime("2026-03-11T09:45:00Z"))', [4]],
];
for (const [predicate, expected] of ranges) {
  check(`inclusive range/precedence: ${predicate}`, () => {
    eq(ids(`Alpha | where ${predicate}`), expected, 'matching Ids');
  });
}

for (const [expression, expected] of [
  ['-1.25 between (-1.5..-1)', true],
  ['0 between (-1..0)', true],
  ['0 !between (0..0)', false],
  ['1.5 between (1.5..1.5)', true],
] as [string, boolean][]) {
  check(`numeric range boundary: ${expression}`, () => { eq(scalar(expression), expected, 'predicate'); });
}

for (const value of [null, NaN, new Date(NaN)] as KValue[]) {
  for (const position of [0, 1, 2]) {
    for (const op of ['between', '!between']) {
      check(`${op} returns null for ${String(value)} at operand ${position}`, () => {
        const values: KValue[] = value instanceof Date
          ? [new Date(0), new Date(0), new Date(1000)]
          : [2, 1, 3];
        values[position] = value;
        const custom: Database = {
          Unit: { name: 'Unit', columns: ['V', 'Lo', 'Hi'], rows: [{ V: values[0], Lo: values[1], Hi: values[2] }] },
        };
        eq(scalar(`V ${op} (Lo..Hi)`, custom), null, 'three-valued predicate');
        eq(table(`Unit | where V ${op} (Lo..Hi)`, custom).rows, [], 'where drops null');
      });
    }
  }
}

const invalidRanges = [
  '"2" between (1..3)', '2 between ("1"..3)', '2 between (1.."3")',
  '"b" between ("a".."c")', 'true between (1..3)', '2 between (1s..3s)',
  '2s between (1s..3s)',
  'datetime(2026-03-11) between (datetime(2026-03-10)..1d)',
  'datetime(2026-03-11) between (1..3)', '2 between (datetime(2026-03-10)..datetime(2026-03-12))',
];
for (const expression of invalidRanges) {
  check(`range refuses coercion/timespans: ${expression}`, () => {
    const query = `Unit | project V = ${expression}`;
    rejects(query, /numeric|datetime|timespan/i, query.indexOf('between'));
  });
}

for (const expression of [
  'X between 1..3', 'X between (1,3)', 'X between (..3)', 'X between (1..)',
  'X between (1..3', 'X between (1....3)', 'X between (1..3..4)', 'X !between',
]) {
  check(`malformed range rejects: ${expression}`, () => { rejects(`Alpha | where ${expression}`); });
}

check('lexer keeps adjacent decimal/range tokens and original positions', () => {
  const src = 'X between (1.25..3.5)';
  eq(tokenize(src).filter(token => token.kind !== 'eof').map(({ kind, value, pos }) => [kind, value, pos]),
    [['ident', 'X', 0], ['ident', 'between', 2], ['punc', '(', 10], ['num', '1.25', 11],
      ['punc', '..', 15], ['num', '3.5', 17], ['punc', ')', 20]], 'range tokenization');
});

// ---- datetime literals -----------------------------------------------------

const validDates: [string, string][] = [
  ['2026-03-11 09:15:00', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11T09:15:00Z', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11T09:15:00', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11', '2026-03-11T00:00:00.000Z'],
  ['2026-03-11 09:15', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11T10:15:00+01:00', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11T04:15:00-05:00', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11t09:15:00z', '2026-03-11T09:15:00.000Z'],
  ['2026-03-11 09:15:00.1234567', '2026-03-11T09:15:00.123Z'],
  ['2024-02-29 23:59:59.9', '2024-02-29T23:59:59.900Z'],
  ['2000-02-29', '2000-02-29T00:00:00.000Z'],
  ['1969-12-31T23:59:59.999Z', '1969-12-31T23:59:59.999Z'],
];
for (const [literal, expected] of validDates) {
  check(`bare, single/double-quoted datetime agree in UTC: ${literal}`, () => {
    for (const argument of [literal, JSON.stringify(literal), `'${literal}'`]) {
      const value = scalar(`DATETIME(${argument})`);
      assert(value instanceof Date, 'datetime must remain typed, not a display string');
      eq(value.toISOString(), expected, argument);
    }
  });
}

for (const literal of [
  '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-11', '2026-13-11',
  '2026-03-00', '2026-03-32', '2026-03-11 24:00:00', '2026-03-11 09:60:00',
  '2026-03-11 09:15:60', '2026-03-11T09:15:00+25:00',
]) {
  check(`invalid calendar/time literal is null, not normalized: ${literal}`, () => {
    eq(scalar(`datetime(${literal})`), null, 'bare invalid date');
    eq(scalar(`datetime(${JSON.stringify(literal)})`), null, 'quoted invalid date');
  });
}

check('invalid quoted datetime text returns null', () => {
  eq(scalar('datetime("not-a-date")'), null, 'invalid quoted date');
});

for (const argument of [
  '2026-3-11', '2026-03', '2026-03-11 9:15:00', '2026-03-11 09:15:',
  '2026-03-11 nonsense', '2026-03-11T09:15:00Z garbage', '2026-03-11, 09',
]) {
  check(`malformed bare datetime rejects at its source offset: ${argument}`, () => {
    const query = `Unit | project V = datetime(${argument})`;
    rejects(query, /datetime/i, query.indexOf(argument));
  });
}

check('missing datetime closing parenthesis rejects at end of source', () => {
  const query = 'Unit | project V = datetime("2026-03-11"';
  rejects(query, /expected/i, query.length);
});

check('datetime scanning leaves strings and comments untouched', () => {
  const text = 'datetime(2026-03-11 09:15:00) | search "MTU_MISMATCH"';
  const query = `// datetime(2026-3-99 nonsense)\nUnit | project V = ${JSON.stringify(text)}`;
  eq(table(query).rows, [{ V: text }], 'literal source is not rewritten');
  eq(tokenize(query).filter(token => token.kind === 'datetime'), [], 'no datetime in comment or string');
});

check('bare datetime allows whitespace and line comments without moving offsets', () => {
  const query = 'Unit | project V = datetime(2026-03-11 09:15:00 // literal\n), Bad = Missing';
  const date = tokenize(query).find(token => token.kind === 'datetime');
  eq(date?.pos, query.indexOf('2026-'), 'literal starts at original offset');
  eq(date?.value, '2026-03-11 09:15:00', 'literal text');
  rejects(query, /unknown column/i, query.indexOf('Missing'));
});

check('datetime token recognizes only datetime arguments, not arithmetic or other calls', () => {
  eq(scalar('2026-3-11'), 2012, 'numeric subtraction');
  eq(tokenize('strcat(2026-03-11)').some(token => token.kind === 'datetime'), false, 'other function');
  eq(scalar('datetime(2026-03-11 09:15:00) + 1m'), new Date('2026-03-11T09:16:00Z'), 'date arithmetic');
});

// ---- case ------------------------------------------------------------------

const caseValues: [string, KValue][] = [
  ['case(true, "first", "else")', 'first'],
  ['case(false, "first", "else")', 'else'],
  ['case(false, 1, true, 2, 3)', 2],
  ['case(true, 1, true, 2, 3)', 1],
  ['case(false, 1, false, 2, 3)', 3],
  ['case(null, 1, 2)', 2],
  ['case(true, null, 2)', null],
  ['case(false, 1, null)', null],
  ['case(2 between (1..3), case(false, 1, 2), 3)', 2],
  ['CASE(true, datetime(2026-03-11), null)', new Date('2026-03-11T00:00:00Z')],
  ['case(true, 1, Missing)', 1],
  ['case(false, Missing, 2)', 2],
  ['case(true, 1, Missing > 0, Missing, 2)', 1],
  ['case(false, no_such_function(), true, 2, no_such_function())', 2],
  ['case(true, 1, datetime_diff("week", now(), now()))', 1],
];
for (const [expression, expected] of caseValues) {
  check(`case selects lazily: ${expression}`, () => { eq(scalar(expression), expected, 'selected value'); });
}

for (const args of ['', 'true', 'true, 1', 'true, 1, false, 2', 'false, 1, true, 2, false, 3']) {
  check(`case rejects non-odd/minimum arity even on an empty input: (${args})`, () => {
    const query = `Unit | take 0 | project V = case(${args})`;
    rejects(query, /case/i, query.indexOf('case('));
  });
}

for (const predicate of ['1', '0', '"true"', '""', 'now()', '1s', 'parse_json("[]")']) {
  check(`case rejects nonboolean predicate: ${predicate}`, () => {
    const query = `Unit | project V = case(${predicate}, 1, 2)`;
    rejects(query, /boolean/i, query.indexOf('case('));
  });
}

for (const expression of ['case(true, Missing, 2)', 'case(false, 1, Missing)', 'case(false, 1, 7, 2, 3)']) {
  check(`case still evaluates selected results and reached predicates: ${expression}`, () => {
    rejects(`Unit | project V = ${expression}`, /unknown column|boolean/i);
  });
}

check('case evaluates separately for each row', () => {
  eq(table('Alpha | project V = case(X between (1..2), "low", X == 3, "middle", "high")').rows,
    [{ V: 'low' }, { V: 'low' }, { V: 'middle' }, { V: 'high' }], 'row-local classification');
});

// ---- datetime_diff: deliberately straddle boundaries by only a millisecond --

const periods: [string, string, string][] = [
  ['day', '2026-03-12T00:00:00.000Z', '2026-03-11T23:59:59.999Z'],
  ['hour', '2026-03-11T10:00:00.000Z', '2026-03-11T09:59:59.999Z'],
  ['minute', '2026-03-11T09:16:00.000Z', '2026-03-11T09:15:59.999Z'],
  ['second', '2026-03-11T09:15:01.000Z', '2026-03-11T09:15:00.999Z'],
  ['millisecond', '2026-03-11T09:15:00.001Z', '2026-03-11T09:15:00.000Z'],
];
for (const [period, end, start] of periods) {
  check(`datetime_diff ${period} counts signed UTC boundaries, not elapsed truncation`, () => {
    for (const spelling of [period, period.toUpperCase()]) {
      eq(scalar(`datetime_diff("${spelling}", datetime(${end}), datetime(${start}))`), 1, 'forward boundary');
      eq(scalar(`datetime_diff("${spelling}", datetime(${start}), datetime(${end}))`), -1, 'reverse boundary');
      eq(scalar(`datetime_diff("${spelling}", datetime(${end}), datetime(${end}))`), 0, 'identical dates');
    }
  });
  check(`datetime_diff ${period} floors correctly across the epoch`, () => {
    eq(scalar(`datetime_diff("${period}", datetime(1970-01-01T00:00:00Z), datetime(1969-12-31T23:59:59.999Z))`),
      1, 'pre-epoch to epoch');
    eq(scalar(`datetime_diff("${period}", datetime(1969-12-31T23:59:59.999Z), datetime(1970-01-01T00:00:00Z))`),
      -1, 'epoch to pre-epoch');
  });
}

for (const [period, end, start, expected] of [
  ['day', '2026-03-11T23:59:59Z', '2026-03-11T00:00:01Z', 0],
  ['hour', '2026-03-11T09:59:59Z', '2026-03-11T09:00:01Z', 0],
  ['minute', '2026-03-11T09:15:59Z', '2026-03-11T09:15:01Z', 0],
  ['second', '2026-03-11T09:15:00.999Z', '2026-03-11T09:15:00.001Z', 0],
  ['day', '1969-12-31T00:00:00Z', '1969-12-30T23:59:59.999Z', 1],
  ['hour', '1969-12-31T23:00:00Z', '1969-12-31T22:59:59.999Z', 1],
  ['day', '2026-03-14T00:00:00Z', '2026-03-11T23:59:59Z', 3],
  ['minute', '2026-03-11T09:15:00Z', '2026-03-11T09:17:00Z', -2],
  ['hour', '2026-03-11T10:15:00+01:00', '2026-03-11T09:15:00Z', 0],
] as [string, string, string, number][]) {
  check(`datetime_diff explicit boundary oracle: ${period} / ${end} / ${start}`, () => {
    eq(scalar(`datetime_diff("${period}", datetime(${end}), datetime(${start}))`), expected, 'boundary count');
  });
}

for (const unit of ['week', 'month', 'year', 'microsecond', 'days', '', ' day', 'toString', '__proto__']) {
  check(`datetime_diff rejects unsupported period: ${JSON.stringify(unit)}`, () => {
    const query = `Unit | project V = datetime_diff(${JSON.stringify(unit)}, now(), now())`;
    rejects(query, /supports only/i, query.indexOf('datetime_diff'));
  });
}

for (const args of [
  '1, now(), now()', 'null, now(), now()', '"day", 0, now()', '"day", now(), 0',
  '"day", "2026-03-11", now()', '"day", now(), "2026-03-11"', '"day", 1d, now()',
  '"day", true, now()', '"day", parse_json("{}"), now()',
]) {
  check(`datetime_diff refuses incorrect argument types: ${args}`, () => {
    const query = `Unit | project V = datetime_diff(${args})`;
    rejects(query, /supports only|requires datetime/i, query.indexOf('datetime_diff'));
  });
}

for (const args of ['', '"day"', '"day", now()', '"day", now(), now(), now()']) {
  check(`datetime_diff rejects arity on zero rows: ${args}`, () => {
    const query = `Unit | take 0 | project V = datetime_diff(${args})`;
    rejects(query, /three arguments/i, query.indexOf('datetime_diff'));
  });
}

check('datetime_diff returns null for null/invalid datetimes in either date argument', () => {
  const custom: Database = {
    Unit: { name: 'Unit', columns: ['Bad', 'Good'], rows: [{ Bad: new Date(NaN), Good: now }] },
  };
  for (const expression of [
    'datetime_diff("day", null, Good)', 'datetime_diff("day", Good, null)',
    'datetime_diff("day", Bad, Good)', 'datetime_diff("day", Good, Bad)',
    'datetime_diff("day", datetime("invalid"), Good)',
  ]) eq(scalar(expression, custom), null, expression);
});

// ---- render and feature collection -----------------------------------------

for (const kind of ['timechart', 'columnchart'] as const) {
  for (const source of ['Alpha', 'Alpha | take 0', 'Alpha | summarize Total = count() by X', 'search "MTU_MISMATCH"']) {
    check(`terminal render ${kind} preserves the entire table: ${source}`, () => {
      const before = run(source);
      const after = run(`${source} | render ${kind}`);
      sameTable(after.table, before.table);
      eq(after.visualization, { kind }, 'visualization envelope');
      eq([...after.features].sort(), [...before.features, 'render'].sort(), 'render feature only');
      sameTable(evaluate(parse(`${source} | render ${kind}`), db, opts), before.table);
      assert(!Object.hasOwn(after.table, 'visualization'), 'metadata must not leak into Table');
    });
  }
}

check('render chart keyword normalizes casing and allows trailing comments', () => {
  eq(run('Alpha | RENDER TimeChart // final | not an operator').visualization,
    { kind: 'timechart' }, 'normalized chart');
});

check('queries without render have no visualization own property or feature', () => {
  for (const query of ['Alpha', 'Alpha | project-away Debug', 'search "MTU_MISMATCH" | count']) {
    const result = run(query);
    assert(!Object.hasOwn(result, 'visualization'), 'absent metadata, not undefined-valued property');
    assert(!result.features.has('render'), 'no render feature');
  }
});

for (const suffix of [
  '', 'piechart', 'barchart', 'linechart', 'table', '"timechart"',
  'timechart with (title="x")', 'columnchart with (xcolumn=X)', 'timechart title="x"',
  'timechart | take 1', 'columnchart | project X', 'timechart | render columnchart',
  'timechart |', 'timechart nonsense',
]) {
  check(`render rejects unsupported/nonterminal syntax: ${JSON.stringify(suffix)}`, () => {
    rejects(`Alpha | render ${suffix}`, /render/i);
  });
}

check('render properties and following-pipe errors retain exact original offsets', () => {
  for (const [query, marker] of [
    ['Alpha\n| render timechart with (title="x")', 'with'],
    ['Alpha\n| render timechart | take 1', '| take'],
    ['Alpha\n| render piechart', 'piechart'],
  ]) rejects(query, /render/i, query.indexOf(marker));
});

const featureCases: [string, string[]][] = [
  ['search "MTU_MISMATCH" | project-away Debug* | project-keep Id, X | project-rename Value=X | render columnchart',
    ['search', 'project-away', 'project-keep', 'project-rename', 'render']],
  ['Alpha | where abs(X) between (toint("1")..round(3))', ['where', 'between', 'abs', 'toint', 'round']],
  ['Alpha | extend Inside = abs(X) !between (toint("1")..round(3))',
    ['extend', '!between', 'abs', 'toint', 'round']],
  ['Alpha | summarize N=count() by Bucket=case(abs(X) between (toint("1")..round(3)), "in", "out")',
    ['summarize', 'count', 'by', 'case', 'abs', 'between', 'toint', 'round']],
  ['Alpha | summarize N=countif(X between (abs(-1)..round(3)))',
    ['summarize', 'countif', 'between', 'abs', 'round']],
  ['Alpha | project V=case(true, 1, datetime_diff("day", now(), datetime(2026-03-11)))',
    ['project', 'case', 'datetime_diff', 'now', 'datetime']],
  ['Alpha | sort by (abs(X) between (toint("1")..round(3)))',
    ['sort', 'between', 'abs', 'toint', 'round']],
  ['Alpha | distinct V=not(abs(X) !between (toint("1")..round(3)))',
    ['distinct', 'not', '!between', 'abs', 'toint', 'round']],
  ['Alpha | summarize N=count() by B=toint(tostring(abs(X))) between (toint(tostring(1))..round(abs(3)))',
    ['summarize', 'count', 'by', 'toint', 'tostring', 'abs', 'between', 'round']],
];
for (const [query, expected] of featureCases) {
  check(`collectFeatures traverses every expression and range bound: ${query}`, () => {
    features(query, expected);
    eq([...run(query).features].sort(), [...expected].sort(), 'runQuery agrees with AST traversal');
  });
}

// ---- legacy normalization and type-aware signatures ------------------------

for (const [left, right, expected] of [
  ['Alpha | take 2', 'Alpha | limit 2', ['take']],
  ['Alpha | sort by X', 'Alpha | order by X', ['sort']],
  ['Alpha | sort by X asc | take 2', 'Alpha | order by X asc | limit 2', ['sort', 'take']],
] as [string, string, string[]][]) {
  check(`aliases retain normalized AST/features and results: ${right}`, () => {
    sameTable(table(left), table(right));
    // Alias spellings have different lengths; source offsets are not semantic AST differences.
    const semanticOps = (query: string) =>
      JSON.stringify(parse(query).ops, (key, value: unknown) => key === 'pos' ? undefined : value);
    eq(semanticOps(left), semanticOps(right), 'normalized operator AST');
    features(left, expected);
    features(right, expected);
  });
}

check('sort/order default descending and take/limit retain first N rows', () => {
  eq(ids('Alpha | order by X | limit 2'), [4, 3], 'descending default');
  eq(ids('Alpha | sort by X asc | take 2'), [1, 2], 'explicit ascending');
  eq(ids('Alpha | limit 0'), [], 'zero limit');
});

const typedValues: KValue[] = [
  1, '1', true, 'true', null, 'null', new Date(0), '1970-01-01T00:00:00.000Z',
  timespan(1), { ms: 1 }, [1], ['1'], NaN, 'NaN',
];
check('tableSignature keeps runtime types distinct in ordered and unordered modes', () => {
  for (const ordered of [true, false]) {
    const signatures = typedValues.map(V => tableSignature({ name: 'typed', columns: ['V'], rows: [{ V }] }, ordered));
    eq(new Set(signatures).size, typedValues.length, 'no typed value collisions');
  }
});

check('tableSignature unordered comparison preserves row multiplicity and ignores row order', () => {
  const a: Table = { name: 'a', columns: ['V'], rows: [{ V: 1 }, { V: 2 }, { V: 1 }] };
  const b: Table = { ...a, rows: [a.rows[1], a.rows[0], a.rows[2]] };
  eq(tableSignature(a, false), tableSignature(b, false), 'multiset equality');
  assert(tableSignature(a, true) !== tableSignature(b, true), 'ordered rows remain ordered');
  assert(tableSignature(a, false) !== tableSignature({ ...a, rows: a.rows.slice(0, 2) }, false),
    'duplicate occurrence matters');
});

check('tableSignature respects ordered schemas and empty-result schemas', () => {
  const a: Table = { name: 'a', columns: ['A', 'B'], rows: [{ A: 1, B: '1' }] };
  const b: Table = { ...a, columns: ['B', 'A'] };
  eq(tableSignature(a, false), tableSignature(b, false), 'unordered schema');
  assert(tableSignature(a, true) !== tableSignature(b, true), 'ordered schema');
  assert(tableSignature({ ...a, rows: [] }, false) !== tableSignature({ name: 'a', columns: ['A'], rows: [] }, false),
    'empty schema still matters');
});

check('tableSignature remains typed after rename and unaffected by render metadata', () => {
  const before = table('Alpha | project When, X, Message | project-rename Time=When');
  const rendered = run('Alpha | project When, X, Message | project-rename Time=When | render timechart');
  for (const ordered of [true, false]) {
    eq(tableSignature(rendered.table, ordered), tableSignature(before, ordered), 'render is not a cell');
    const strings = { ...before, rows: before.rows.map(row => ({ ...row, Time: String(row.Time) })) };
    assert(tableSignature(before, ordered) !== tableSignature(strings, ordered), 'dates are not strings');
  }
});

// ---- completion / highlight / format, with minimal metadata only ------------

const meta: Parameters<typeof completionsFor>[2] = Object.values(db).map(source => ({
  name: source.name, doc: 'Synthetic regression fixture',
  columns: source.columns.map(name => ({ name, type: name === 'When' ? 'datetime' : 'string', doc: '' })),
}));
const schema = buildHighlightSchema(meta);
const complete = (query: string) => completionsFor(query, query.length, meta, 100);

for (const [query, label, kind] of [
  ['sea', 'search', 'keyword'],
  ['Alpha | project-a', 'project-away', 'operator'],
  ['Alpha | project-k', 'project-keep', 'operator'],
  ['Alpha | project-r', 'project-rename', 'operator'],
  ['Alpha | ren', 'render', 'operator'],
  ['Alpha | extend V=cas', 'case', 'function'],
  ['Alpha | extend V=datetime_d', 'datetime_diff', 'function'],
  ['Alpha | where X bet', 'between', 'keyword'],
  ['Alpha | where X !bet', '!between', 'keyword'],
  ['Alpha | render ti', 'timechart', 'keyword'],
  ['Alpha | render col', 'columnchart', 'keyword'],
] as const) {
  check(`completion suggests ${label} in context`, () => {
    assert(complete(query).items.some(item => item.label === label && item.kind === kind), 'expected completion');
  });
}

check('search completion inserts quotes and places caret inside', () => {
  const item = complete('sea').items.find(candidate => candidate.label === 'search');
  assert(item, 'search suggestion');
  eq(applyCompletion('sea', 3, item), { text: 'search ""', caret: 8 }, 'root insertion');
});

check('hyphenated operator completion replaces the entire prefix without touching suffix', () => {
  const prefix = 'Alpha | project-r';
  const item = complete(prefix).items.find(candidate => candidate.label === 'project-rename');
  assert(item, 'rename suggestion');
  eq(prefixAt(prefix, prefix.length), 'project-r', 'whole hyphenated prefix');
  eq(applyCompletion(prefix + ' New=A', prefix.length, item),
    { text: 'Alpha | project-rename New=A', caret: 'Alpha | project-rename'.length }, 'mid-query completion');
});

check('search expression completions expose union columns plus $table exactly once', () => {
  const result = complete('search "MTU_MISMATCH" | project ');
  eq(result.context, { at: 'groupBy', search: true }, 'search pipeline context');
  eq(result.items.filter(item => item.kind === 'column').map(item => item.label),
    ['$table', ...db.Alpha.columns, 'Extra', 'OnlyEmpty', 'Seed'], 'union column order');
  const query = 'search "MTU_MISMATCH" | where $ta';
  const item = complete(query).items.find(candidate => candidate.label === '$table');
  assert(item, 'provenance suggestion');
  eq(applyCompletion(query, query.length, item).text,
    'search "MTU_MISMATCH" | where $table', 'dollar prefix replacement');
});

check('source-table completion stays scoped for project operators', () => {
  for (const op of ['project-away', 'project-keep', 'project-rename']) {
    eq(complete(`Alpha | ${op} `).items.filter(item => item.kind === 'column').map(item => item.label),
      db.Alpha.columns, 'no unrelated source columns');
  }
});

for (const query of [
  'search ', 'search "MTU', 'search "MTU_MISMATCH" ',
  'Alpha | render timechart ', 'Alpha | render columnchart | ',
]) {
  check(`completion stays silent in literal/terminal context: ${query}`, () => {
    eq(complete(query).items, [], 'no unsupported syntax offered');
  });
}

check('render completion offers only supported chart kinds', () => {
  eq(complete('Alpha | render ').items.map(item => item.label), ['timechart', 'columnchart'], 'chart subset');
});

check('completion masks pipes/by/render appearing inside strings and comments', () => {
  const query = 'Alpha | extend S="| render timechart", T=" by "\n// | render columnchart\n| where ';
  eq(contextAt(query, query.length), { at: 'expression', table: 'Alpha' }, 'real last operator');
  assert(complete(query).items.some(item => item.label === 'X'), 'source columns remain available');
});

const highlightCases: [string, string][] = [
  ['search "MTU_MISMATCH"', '<span class="tk-operator">search</span>'],
  ['Alpha | project-away Debug*', '<span class="tk-operator">project-away</span>'],
  ['Alpha | project-keep X', '<span class="tk-operator">project-keep</span>'],
  ['Alpha | project-rename Value=X', '<span class="tk-operator">project-rename</span>'],
  ['Alpha | render timechart', '<span class="tk-keyword">timechart</span>'],
  ['Alpha | render columnchart', '<span class="tk-keyword">columnchart</span>'],
  ['Alpha | where X between (1..3)', '<span class="tk-keyword">between</span>'],
  ['Alpha | where X !between (1..3)', '<span class="tk-keyword">!between</span>'],
  ['Alpha | where X between (1..3)', '<span class="tk-op">..</span>'],
  ['search "MTU_MISMATCH" | project $table', '<span class="tk-column">$table</span>'],
  ['Unit | project V=case(true, 1, 2)', '<span class="tk-function">case</span>'],
  ['Unit | project V=datetime_diff("day", now(), now())', '<span class="tk-function">datetime_diff</span>'],
  ['Unit | project V=datetime(2026-03-11 09:15:00)', '<span class="tk-string">2026-03-11 09:15:00</span>'],
];

function unhighlight(html: string) {
  return html.replace(/<span class="tk-[^"]+">/g, '').replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

for (const [query, fragment] of highlightCases) {
  check(`highlight recognizes new syntax without changing source: ${query} / ${fragment}`, () => {
    const html = highlightKql(query, schema);
    assert(html.includes(fragment), `Missing ${fragment} in ${html}`);
    eq(unhighlight(html), query + '\n', 'lossless highlight');
  });
}

for (const query of [
  'search "MTU', 'Alpha | project-', 'Alpha | project-rename New=',
  'Alpha | where X between (1..', 'Unit | project V=datetime(2026-03-',
  'Unit | project V=case(', 'Alpha | render ',
  'Unit | project V="<script>& datetime(2026-03-11 09:15:00)" // | render timechart',
]) {
  check(`highlight tolerates incomplete/literal/comment syntax: ${query}`, () => {
    const html = highlightKql(query, schema);
    eq(unhighlight(html), query + '\n', 'all characters survive');
    assert(!html.includes('<script>'), 'HTML source must be escaped');
  });
}

check('highlight keeps subtraction separate from project operator tokens', () => {
  const html = highlightKql('Alpha | project V=X-1', schema);
  assert(html.includes('<span class="tk-column">X</span><span class="tk-op">-</span>'), 'subtraction token');
});

const formatCases = [
  'search "MTU_MISMATCH" | project-away Debug* | project-keep Id, X | project-rename Value=X | render columnchart',
  'Alpha | where X !between (1..3) | project X',
  'Alpha | where When between (datetime(2026-03-11 09:15:00)..datetime("2026-03-11T09:45:00Z")) | render timechart',
  'Alpha | project V=case(X between (1..3), " a  |  b ", "other") | render columnchart',
  'Alpha | project V=datetime_diff("minute", When, datetime(2026-03-11 09:15:00)) | order by V | limit 2',
  'search "MTU_MISMATCH" // datetime(2026-3-99) | fake\n| project Id, $table // preserve  spaces\n| render columnchart',
];
for (const query of formatCases) {
  check(`format is idempotent and execution/metadata/features preserving: ${query}`, () => {
    const formatted = formatKql(query);
    eq(formatKql(formatted), formatted, 'format idempotence');
    eq(run(formatted), run(query), 'same typed result and metadata');
    assert(formatted.includes('\n| '), 'one real pipeline operator per line');
  });
}

check('format never rewrites datetime-looking strings or comment content', () => {
  const query = 'Unit | project V = "datetime(2026-03-11  09:15:00) |  x" // datetime(2026-3) |  y\n| take 1';
  const formatted = formatKql(query);
  assert(formatted.includes('"datetime(2026-03-11  09:15:00) |  x"'), 'string whitespace survives');
  assert(formatted.includes('// datetime(2026-3) |  y\n'), 'comment survives');
  sameTable(table(formatted), table(query));
});

check('switching a search source removes the literal rather than leaving trailing syntax', () => {
  eq(withSourceTable('search "MTU_MISMATCH" | project Id', 'Alpha'), 'Alpha\n| project Id', 'search replacement');
  eq(withSourceTable("SEARCH 'MTU_MISMATCH' | render timechart", 'Alpha'), 'Alpha\n| render timechart', 'single quotes');
  eq(withSourceTable('Alpha | project-away Debug', 'Beta'), 'Beta\n| project-away Debug', 'table replacement');
});

check('switching sources preserves leading and interleaved search comments', () => {
  const query = '// lead\nsearch // reason\n"MTU_MISMATCH" | project Id';
  const changed = withSourceTable(query, 'Alpha');
  assert(changed.includes('// lead\n') && changed.includes('// reason\n'), 'source comments survive');
  sameTable(table(changed), table('Alpha | project Id'));
});

check('pipe newline helper stays stable for new source/operator syntax', () => {
  const query = 'search "MTU_MISMATCH"';
  eq(pipeNeedsNewline(query, query.length), true, 'after root search');
  eq(pipeNeedsNewline(query + '\n', query.length + 1), false, 'at empty next line');
});

check('all operators left synthetic database rows, values and schemas unmodified', () => {
  eq(db, originalDb, 'no input mutation across the regression harness');
});

console.log(`\n  ${passed} passed, ${failures.length} failed (${passed + failures.length} curriculum language tests)\n`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
