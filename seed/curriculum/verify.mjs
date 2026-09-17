// Asserts every planted fact from KQL-Detective-Implementation-Spec.md §7.
// Wire this into CI gate #2. Exits non-zero on drift.
//
// Run: node verify.mjs   (after the three seed scripts)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATASETS_ROOT, QUERY_TIME, assertEqual } from './lib.mjs';

function load(datasetId) {
  return {
    data: JSON.parse(readFileSync(resolve(DATASETS_ROOT, datasetId, 'data.json'), 'utf8')),
    schema: JSON.parse(readFileSync(resolve(DATASETS_ROOT, datasetId, 'schema.json'), 'utf8')),
  };
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
  } catch (err) {
    failures++;
    console.error(err.message);
  }
}

// ------------------------------------------------------------------ Case 001

console.log('\nds-case001-heartbeat');
const c1 = load('ds-case001-heartbeat');
const hb = c1.data.Heartbeat;

check('c1', () => assertEqual(c1.schema.queryTime, QUERY_TIME, 'queryTime is pinned'));
check('c1', () => assertEqual(hb.length, 3296, 'Heartbeat row count'));
check('c1', () =>
  assertEqual(new Set(hb.map((r) => r.Computer)).size, 12, 'distinct Computer')
);
check('c1', () =>
  assertEqual(c1.schema.tables[0].rowCount, hb.length, 'schema rowCount matches data')
);

// ago(3h) relative to the pinned queryTime
const threeHoursAgo = new Date(new Date(QUERY_TIME).getTime() - 3 * 3600_000).toISOString();
const recent = hb.filter((r) => r.TimeGenerated > threeHoursAgo.replace(/\.\d{3}Z$/, 'Z'));
check('c1', () => assertEqual(recent.length, 260, 'rows where TimeGenerated > ago(3h)'));

// Per-computer heartbeat counts in that window: 7 healthy at 35, 5 dark at 3.
const recentByComputer = {};
for (const r of recent) recentByComputer[r.Computer] = (recentByComputer[r.Computer] ?? 0) + 1;
const counts = Object.values(recentByComputer).sort((a, b) => a - b);
check('c1', () =>
  assertEqual(counts, [3, 3, 3, 3, 3, 35, 35, 35, 35, 35, 35, 35], 'T-001-03 per-computer counts')
);

// Last heartbeat per computer; the five dark machines stop at 09:15:00Z.
const lastSeen = {};
for (const r of hb) {
  if (!lastSeen[r.Computer] || r.TimeGenerated > lastSeen[r.Computer]) {
    lastSeen[r.Computer] = r.TimeGenerated;
  }
}
const dark = Object.entries(lastSeen)
  .filter(([, t]) => t <= '2026-03-11T09:15:00Z')
  .map(([c]) => c)
  .sort();
check('c1', () =>
  assertEqual(
    dark,
    ['PRD-APP-01', 'PRD-APP-02', 'PRD-SQL-01', 'PRD-WEB-01', 'PRD-WEB-02'],
    'T-001-04 dark machines'
  )
);
check('c1', () =>
  assertEqual(
    dark.every((c) => lastSeen[c] === '2026-03-11T09:15:00Z'),
    true,
    'all dark machines stop at exactly 09:15:00Z'
  )
);

// ------------------------------------------------------------------ Case 002

console.log('\nds-case002-vaults');
const c2 = load('ds-case002-vaults');
const syslog = c2.data.Syslog;
const activity = c2.data.AzureActivity;

check('c2', () => assertEqual(syslog.length, 780, 'Syslog row count'));
check('c2', () =>
  assertEqual(
    syslog.filter((r) => r.SyslogMessage.includes('MTU_MISMATCH')).length,
    6,
    'T-002-01/02 MTU_MISMATCH rows'
  )
);
check('c2', () =>
  assertEqual(
    syslog.filter((r) => /mismatch/i.test(r.SyslogMessage)).length,
    20,
    'contains "mismatch" rows (the has-vs-contains lesson)'
  )
);
check('c2', () =>
  assertEqual(
    [...new Set(syslog.filter((r) => r.SyslogMessage.includes('MTU_MISMATCH')).map((r) => r.Computer))].sort(),
    ['PRD-APP-01', 'PRD-APP-02', 'PRD-NET-FW01', 'PRD-SQL-01', 'PRD-WEB-01', 'PRD-WEB-02'],
    'MTU_MISMATCH hosts'
  )
);

check('c2', () => assertEqual(activity.length, 200, 'AzureActivity row count'));
check('c2', () =>
  assertEqual(
    new Set(activity.map((r) => r.OperationNameValue)).size,
    7,
    'T-002-03 distinct OperationNameValue'
  )
);

const ruleWrites = activity.filter((r) => r.OperationNameValue.includes('SECURITYRULES/WRITE'));
check('c2', () => assertEqual(ruleWrites.length, 1, 'T-002-04 SECURITYRULES/WRITE row count'));
check('c2', () =>
  assertEqual(
    [ruleWrites[0]?.TimeGenerated, ruleWrites[0]?.Caller, ruleWrites[0]?.ActivityStatusValue],
    ['2026-03-11T09:12:00Z', 'dana.whitfield@contoso.com', 'Succeeded'],
    'T-002-04 expected row'
  )
);

check('c2', () =>
  assertEqual(c2.data.Heartbeat.length, 3296, 'Heartbeat reused from case 001')
);

// ------------------------------------------------------------------ Case 003

console.log('\nds-case003-canyon');
const c3 = load('ds-case003-canyon');
const perf = c3.data.Perf;
const cpu = perf.filter((r) => r.CounterName === '% Processor Time');

check('c3', () => assertEqual(perf.length, 3456, 'Perf row count'));
check('c3', () => assertEqual(cpu.length, 1152, '% Processor Time reading count'));
check('c3', () =>
  assertEqual(new Set(cpu.map((r) => r.CounterValue)).size, 1152, 'CPU values unique to 2dp')
);

const top5 = [...cpu]
  .sort((a, b) => b.CounterValue - a.CounterValue)
  .slice(0, 5)
  .map((r) => [r.Computer, r.TimeGenerated, r.CounterValue]);
check('c3', () =>
  assertEqual(
    top5,
    [
      ['PRD-SQL-01', '2026-03-11T09:15:00Z', 99.87],
      ['PRD-APP-01', '2026-03-11T09:15:00Z', 98.41],
      ['PRD-WEB-01', '2026-03-11T09:00:00Z', 97.62],
      ['PRD-APP-02', '2026-03-11T09:15:00Z', 96.15],
      ['PRD-WEB-02', '2026-03-11T09:00:00Z', 95.33],
    ],
    'T-003-04 top 5 CPU readings'
  )
);

const sixth = [...cpu].sort((a, b) => b.CounterValue - a.CounterValue)[5];
check('c3', () =>
  assertEqual(sixth.CounterValue <= 94, true, '6th-highest CPU reading is <= 94.00')
);

const newest = [...cpu].sort((a, b) => b.TimeGenerated.localeCompare(a.TimeGenerated))[0];
check('c3', () =>
  assertEqual(newest.TimeGenerated, '2026-03-11T11:45:00Z', 'T-003-03 newest timestamp')
);

// ------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed. Seed data has drifted from the spec.`);
  process.exit(1);
}
console.log('\nAll planted facts verified.');
