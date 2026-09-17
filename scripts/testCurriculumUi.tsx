import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildChartData } from '../src/ui/chartData';
import { ResultChart } from '../src/ui/ResultChart';
import { ContentSources } from '../src/ui/ContentSources';
import { isWorkerResponse } from '../src/kql/workerProtocol';
import type { Table } from '../src/kql/types';
import { caseCompletionKey, getCaseResult, mergePersistedState, useStore } from '../src/state/store';

let passed = 0;
const failures: string[] = [];
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const table: Table = {
  name: 'Signals', columns: ['TimeGenerated', 'Computer', 'Beats'],
  rows: [
    { TimeGenerated: new Date('2026-03-11T10:00:00Z'), Computer: 'one', Beats: 10 },
    { TimeGenerated: new Date('2026-03-11T09:00:00Z'), Computer: 'one', Beats: 8 },
    { TimeGenerated: new Date('2026-03-11T09:00:00Z'), Computer: 'two', Beats: 0 },
  ],
};

check('timechart uses actual date/value pairs and separates series without mutating data', () => {
  const original = structuredClone(table);
  const data = buildChartData(table, 'timechart');
  assert(!('error' in data));
  assert.equal(data.series.length, 2);
  assert.deepEqual(data.series[0].points.map(point => point.y), [8, 10]);
  assert.equal(data.minX, Date.parse('2026-03-11T09:00:00Z'));
  assert.equal(data.maxY, 10);
  assert.deepEqual(table, original);
});
check('timechart is accessible and explicitly points to underlying data', () => {
  const html = renderToStaticMarkup(<ResultChart table={table} kind="timechart" />);
  assert(html.includes('role="img"'));
  assert(html.includes('Time chart'));
  assert(html.includes('(UTC)'));
  assert(html.includes('Exact values are in the result table'));
  assert(html.includes('one'));
  assert(html.includes('two'));
  assert.equal((html.match(/<circle/g) ?? []).length, 3);
});
check('columnchart supports signed values and preserves category labels', () => {
  const values: Table = { name: 'Totals', columns: ['Category', 'Total'], rows: [
    { Category: 'A', Total: -5 }, { Category: 'B', Total: 7 },
  ] };
  const data = buildChartData(values, 'columnchart');
  assert(!('error' in data));
  assert.deepEqual(data.categories, ['A', 'B']);
  assert.equal(data.minY, -5);
  assert.equal(data.maxY, 7);
  const html = renderToStaticMarkup(<ResultChart table={values} kind="columnchart" />);
  assert.equal((html.match(/<rect /g) ?? []).length, 2);
  assert(html.includes('Column chart'));
});
check('null edge categories keep their own chart positions', () => {
  const data = buildChartData({
    name: 'Change', columns: ['ChangeId', 'Value'],
    rows: [{ ChangeId: 'BASELINE', Value: null }, { ChangeId: 'CHG-4471', Value: 10 },
      { ChangeId: 'CHG-4472', Value: 10 }, { ChangeId: 'LAST', Value: null }],
  }, 'columnchart');
  assert(!('error' in data));
  assert.equal(data.minX, 0);
  assert.equal(data.maxX, 3);
  assert.deepEqual(data.series[0].points.map(point => point.x), [1, 2]);
  assert.deepEqual(data.categories, ['BASELINE', 'CHG-4471', 'CHG-4472', 'LAST']);
});
check('replacement curriculum never inherits old placeholder completions', () => {
  const old = { ...useStore.getState().profile, lifetimeScore: 4321,
    caseResults: { '001:expert': { completions: 2, bestScore: 900 } } };
  const merged = mergePersistedState({ profile: old }, useStore.getState());
  assert.equal(merged.profile.lifetimeScore, 4321);
  assert.deepEqual(merged.profile.caseResults, old.caseResults);
  assert.equal(getCaseResult(merged.profile, '001', 'expert'), undefined);
  const key = caseCompletionKey('001', 'expert');
  assert.notEqual(key, '001:expert');
  const profile = { ...merged.profile, caseResults: { ...old.caseResults, [key]: { completions: 1, bestScore: 800 } } };
  assert.deepEqual(getCaseResult(profile, '001', 'expert'), { completions: 1, bestScore: 800 });
  assert.deepEqual(profile.caseResults['001:expert'], old.caseResults['001:expert']);
});
check('empty, malformed, duplicated and oversized chart data reports a readable limitation', () => {
  for (const fixture of [
    { ...table, rows: [] },
    { ...table, rows: [{ TimeGenerated: null, Computer: 'one', Beats: 1 }] },
    { ...table, rows: [table.rows[0], table.rows[0]] },
    { ...table, rows: Array.from({ length: 2001 }, () => table.rows[0]) },
    { name: 'Strings', columns: ['X', 'Y'], rows: [{ X: 'one', Y: 'two' }] },
  ]) assert('error' in buildChartData(fixture, 'timechart'));
});
check('chart response metadata is validated across the worker boundary', () => {
  for (const kind of ['timechart', 'columnchart']) {
    assert(isWorkerResponse({ kind: 'query-result', id: '1',
      result: { table, features: new Set(['render']), visualization: { kind } } }));
    assert(isWorkerResponse({ kind: 'grade-result', id: '2',
      result: { status: 'correct', message: 'ok', table, visualization: { kind } } }));
  }
  assert(!isWorkerResponse({ kind: 'grade-result', id: '2',
    result: { status: 'correct', message: 'ok', table, visualization: { kind: 'arbitrary-html' } } }));
});
check('content attribution includes actual notices and only requested source links', () => {
  const html = renderToStaticMarkup(<ContentSources ids={['MLKQL-Part09', 'MSLearn-common-operators']} />);
  assert(html.includes('Copyright (c) 2022 Rod Trent'));
  assert(html.includes('CC BY 4.0'));
  assert(html.includes('Changes include'));
  assert(html.includes('The Limit/Take Operators'));
  assert(!html.includes('Advanced KQL chapter'));
});
console.log(`Curriculum UI: ${passed} passed, ${failures.length} failed`);
failures.forEach(failure => console.error(failure));
if (failures.length) process.exit(1);
