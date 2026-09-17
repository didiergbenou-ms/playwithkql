import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runQuery } from '../src/kql';
import { gradeChallenge } from '../src/kql/challenge';
import type { KValue, Row, Table } from '../src/kql/types';
import { createCaseVariant } from '../src/data/questions/compose';
import { QUESTION_SET as B1 } from '../src/data/questions/case001/beginner';
import { QUESTION_SET as I1 } from '../src/data/questions/case001/intermediate';
import { QUESTION_SET as E1 } from '../src/data/questions/case001/expert';
import { QUESTION_SET as B2 } from '../src/data/questions/case002/beginner';
import { QUESTION_SET as I2 } from '../src/data/questions/case002/intermediate';
import { QUESTION_SET as E2 } from '../src/data/questions/case002/expert';
import { QUESTION_SET as B3 } from '../src/data/questions/case003/beginner';
import { QUESTION_SET as I3 } from '../src/data/questions/case003/intermediate';
import { QUESTION_SET as E3 } from '../src/data/questions/case003/expert';
import { CASE001 } from '../src/data/cases/case001';
import { CASE002 } from '../src/data/cases/case002';
import { CASE003 } from '../src/data/cases/case003';
import { HEARTBEAT_HILLS } from '../src/game/levels/heartbeatHills';
import { SIGNAL_HARBOR } from '../src/game/levels/signalHarbor';
import { RELAY_RUINS } from '../src/game/levels/relayRuins';
import { CHALLENGES as LEGACY_CHALLENGES } from '../src/data/case001';
import { buildCurriculumDatabase, curriculumNow, curriculumTableMeta } from '../src/data/curriculum/dataset';

// These expectations are hand-authored from the reviewed seed facts and explicit
// supplement fixtures. They are never calculated with a reference KQL query.
const dana = 'dana.whitfield@contoso.com';
const ops = 'ops-automation@contoso.com';
const resource = '/subscriptions/00000000-0000-0000-0000-000000000001/resourcegroups/rg-prod-network/providers/microsoft.network/networksecuritygroups/nsg-prod-outbound';
const operation = 'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/SECURITYRULES/WRITE';
const denyMessage = 'changed outbound access=Deny port=443';
const at = (time: string) => new Date(`2026-03-11T${time}Z`);
const dark = ['PRD-WEB-01', 'PRD-WEB-02', 'PRD-APP-01', 'PRD-APP-02', 'PRD-SQL-01'];
const healthy = ['PRD-WEB-03', 'PRD-SQL-02', 'PRD-CACHE-01', 'PRD-MON-01', 'DEV-WEB-01', 'DEV-APP-01', 'UAT-APP-01'];
const hbColumns = ['TimeGenerated', 'Computer', 'OSType', 'Version', 'ComputerEnvironment', 'RemoteIPCountry', 'ResourceGroup'];
const syslogColumns = ['TimeGenerated', 'Computer', 'Facility', 'SeverityLevel', 'ProcessName', 'SyslogMessage'];
const peaks: Row[] = [
  { Computer: 'PRD-SQL-01', TimeGenerated: at('09:15:00'), CounterValue: 99.87 },
  { Computer: 'PRD-APP-01', TimeGenerated: at('09:15:00'), CounterValue: 98.41 },
  { Computer: 'PRD-WEB-01', TimeGenerated: at('09:00:00'), CounterValue: 97.62 },
  { Computer: 'PRD-APP-02', TimeGenerated: at('09:15:00'), CounterValue: 96.15 },
  { Computer: 'PRD-WEB-02', TimeGenerated: at('09:00:00'), CounterValue: 95.33 },
];
const symptomHosts = ['PRD-WEB-01', 'PRD-NET-FW01', 'PRD-APP-01', 'PRD-WEB-02', 'PRD-APP-02', 'PRD-SQL-01'];
const symptomTimes = ['09:13:47', '09:13:51', '09:14:02', '09:14:20', '09:15:09', '09:15:44'];
interface Golden {
  count: number;
  columns?: string[];
  contains?: Row[];
  every?: Row;
  ordered?: Row[];
  chart?: 'timechart' | 'columnchart';
}
const golden = (count: number, columns?: string[], contains?: Row[]): Golden => ({ count, columns, contains });
const fixtures: Record<string, Golden> = {
  '001:beginner:1': golden(10, hbColumns),
  '001:beginner:2': golden(260, hbColumns, [
    { Computer: 'PRD-WEB-01', TimeGenerated: at('09:05:00') },
    { Computer: 'PRD-WEB-03', TimeGenerated: at('11:55:00') },
  ]),
  '001:beginner:3': golden(12, ['Computer', 'Beats'], [
    ...dark.map(Computer => ({ Computer, Beats: 3 })),
    ...healthy.map(Computer => ({ Computer, Beats: 35 })),
  ]),
  '001:beginner:4': golden(5, ['Computer', 'LastSeen'], dark.map(Computer => ({ Computer, LastSeen: at('09:15:00') }))),
  '001:beginner:5': golden(1, ['TimeGenerated', 'Caller', 'Ticket', 'Message'], [
    { TimeGenerated: at('09:12:00'), Caller: dana, Ticket: 'CHG-4471', Message: denyMessage },
  ]),
  '002:beginner:1': {
    count: 6, every: { $table: 'Syslog' },
    contains: symptomHosts.map((Computer, index) => ({ Computer, TimeGenerated: at(symptomTimes[index]) })),
  },
  '002:beginner:2': golden(6, syslogColumns, symptomHosts.map((Computer, index) => ({
    Computer, TimeGenerated: at(symptomTimes[index]), SyslogMessage: 'kernel: eth0: MTU_MISMATCH detected, dropping oversized frames',
  }))),
  '002:beginner:3': golden(7, ['OperationNameValue'], [
    'MICROSOFT.COMPUTE/VIRTUALMACHINES/READ', 'MICROSOFT.OPERATIONALINSIGHTS/WORKSPACES/READ',
    'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/READ', 'MICROSOFT.RESOURCES/DEPLOYMENTS/WRITE',
    'MICROSOFT.COMPUTE/VIRTUALMACHINES/RESTART/ACTION', 'MICROSOFT.STORAGE/STORAGEACCOUNTS/LISTKEYS/ACTION', operation,
  ].map(OperationNameValue => ({ OperationNameValue }))),
  '002:beginner:4': golden(1, ['TimeGenerated', 'Caller', 'ActivityStatusValue'], [
    { TimeGenerated: at('09:12:00'), Caller: dana, ActivityStatusValue: 'Succeeded' },
  ]),
  '002:beginner:5': golden(1, ['_ResourceId', 'Ticket', 'Message'], [
    { _ResourceId: resource, Ticket: 'CHG-4471', Message: denyMessage },
  ]),
  '003:beginner:1': golden(3456, ['TimeGenerated', 'Computer', 'CounterName', 'CounterValue'], [
    { Computer: 'PRD-SQL-01', TimeGenerated: at('09:15:00'), CounterName: '% Processor Time', CounterValue: 99.87 },
  ]),
  '003:beginner:2': golden(3456, ['TimeGenerated', 'Computer', 'CounterName', 'Value'], [
    { Computer: 'PRD-SQL-01', TimeGenerated: at('09:15:00'), CounterName: '% Processor Time', Value: 99.87 },
  ]),
  '003:beginner:3': golden(1152, ['TimeGenerated', 'Computer', 'CounterValue'], peaks),
  '003:beginner:4': { count: 5, columns: ['Computer', 'TimeGenerated', 'CounterValue'], ordered: peaks },
  '003:beginner:5': golden(1, ['TimeGenerated', 'Ticket', 'Message'], [
    { TimeGenerated: at('09:12:00'), Ticket: 'CHG-4471', Message: denyMessage },
  ]),
  '001:intermediate:1': golden(3, ['ComputerEnvironment', 'Machines', 'Beats'], [
    { ComputerEnvironment: 'Production', Machines: 9, Beats: 2432 },
    { ComputerEnvironment: 'Development', Machines: 2, Beats: 576 },
    { ComputerEnvironment: 'UAT', Machines: 1, Beats: 288 },
  ]),
  '001:intermediate:2': golden(2, ['OSType', 'Machines', 'Silent'], [
    { OSType: 'Linux', Machines: 9, Silent: 4 }, { OSType: 'Windows', Machines: 3, Silent: 1 },
  ]),
  '001:intermediate:3': golden(5, ['Computer', 'TimeGenerated', 'OSType', 'ResourceGroup'], [
    { Computer: 'PRD-WEB-01', TimeGenerated: at('09:15:00'), OSType: 'Linux', ResourceGroup: 'rg-prod-web' },
    { Computer: 'PRD-WEB-02', TimeGenerated: at('09:15:00'), OSType: 'Linux', ResourceGroup: 'rg-prod-web' },
    { Computer: 'PRD-APP-01', TimeGenerated: at('09:15:00'), OSType: 'Linux', ResourceGroup: 'rg-prod-app' },
    { Computer: 'PRD-APP-02', TimeGenerated: at('09:15:00'), OSType: 'Linux', ResourceGroup: 'rg-prod-app' },
    { Computer: 'PRD-SQL-01', TimeGenerated: at('09:15:00'), OSType: 'Windows', ResourceGroup: 'rg-prod-data' },
  ]),
  '001:intermediate:4': golden(6, ['ResourceGroup', 'Machines', 'Beats'], [
    { ResourceGroup: 'rg-prod-web', Machines: 3, Beats: 41 },
    { ResourceGroup: 'rg-prod-app', Machines: 3, Beats: 41 },
    { ResourceGroup: 'rg-prod-data', Machines: 2, Beats: 38 },
    { ResourceGroup: 'rg-prod-mon', Machines: 1, Beats: 35 },
    { ResourceGroup: 'rg-dev', Machines: 2, Beats: 70 },
    { ResourceGroup: 'rg-uat', Machines: 1, Beats: 35 },
  ]),
  '001:intermediate:5': golden(1, ['ResourceGroup', 'TimeGenerated', 'ChangeId', 'Message'], [
    { ResourceGroup: 'rg-prod-network', TimeGenerated: at('09:12:00'), ChangeId: 'CHG-4471', Message: denyMessage },
  ]),
  '002:intermediate:1': {
    count: 3, columns: ['TimeGenerated', 'Beats'], ordered: [
      { TimeGenerated: at('09:00:00'), Beats: 104 },
      { TimeGenerated: at('10:00:00'), Beats: 84 }, { TimeGenerated: at('11:00:00'), Beats: 84 },
    ],
  },
  '002:intermediate:2': {
    count: 3, columns: ['TimeGenerated', 'Messages'], chart: 'timechart', ordered: [
      { TimeGenerated: at('09:13:00'), Messages: 2 }, { TimeGenerated: at('09:14:00'), Messages: 2 },
      { TimeGenerated: at('09:15:00'), Messages: 2 },
    ],
  },
  '002:intermediate:3': {
    count: 9, columns: ['TimeGenerated', 'ComputerEnvironment', 'Beats'], chart: 'columnchart', ordered: [
      { TimeGenerated: at('09:00:00'), ComputerEnvironment: 'Development', Beats: 24 },
      { TimeGenerated: at('09:00:00'), ComputerEnvironment: 'Production', Beats: 68 },
      { TimeGenerated: at('09:00:00'), ComputerEnvironment: 'UAT', Beats: 12 },
      { TimeGenerated: at('10:00:00'), ComputerEnvironment: 'Development', Beats: 24 },
      { TimeGenerated: at('10:00:00'), ComputerEnvironment: 'Production', Beats: 48 },
      { TimeGenerated: at('10:00:00'), ComputerEnvironment: 'UAT', Beats: 12 },
      { TimeGenerated: at('11:00:00'), ComputerEnvironment: 'Development', Beats: 24 },
      { TimeGenerated: at('11:00:00'), ComputerEnvironment: 'Production', Beats: 48 },
      { TimeGenerated: at('11:00:00'), ComputerEnvironment: 'UAT', Beats: 12 },
    ],
  },
  '002:intermediate:4': golden(2, ['Computer', 'Beats'], [
    { Computer: 'PRD-SQL-01', Beats: 1 }, { Computer: 'PRD-SQL-02', Beats: 4 },
  ]),
  '002:intermediate:5': golden(1, ['TimeGenerated', 'ChangeId', 'MinutesToLastBeat', 'Message'], [
    { TimeGenerated: at('09:12:00'), ChangeId: 'CHG-4471', MinutesToLastBeat: 3, Message: denyMessage },
  ]),
  '003:intermediate:1': golden(1152, ['TimeGenerated', 'Computer', 'AvailableGB'], [
    { TimeGenerated: new Date('2026-03-10T12:00:00Z'), Computer: 'DEV-APP-01', AvailableGB: 15539.74 / 1024 },
    { TimeGenerated: new Date('2026-03-10T12:00:00Z'), Computer: 'DEV-WEB-01', AvailableGB: 10012.45 / 1024 },
  ]),
  '003:intermediate:2': {
    count: 5, columns: ['Computer', 'TimeGenerated', 'CounterValue', 'MinutesFromChange'],
    ordered: peaks.map((row, index) => ({ ...row, MinutesFromChange: [3, 3, -12, 3, -12][index] })),
  },
  '003:intermediate:3': golden(2, ['Band', 'Samples'], [
    { Band: 'Review', Samples: 5 }, { Band: 'Baseline', Samples: 1147 },
  ]),
  '003:intermediate:4': golden(1, ['Headline'], [
    { Headline: 'dana.whitfield@contoso.com applied CHG-4471: changed outbound access=Deny port=443' },
  ]),
  '003:intermediate:5': golden(1, ['Machines', 'Samples', 'LatestGapMinutes'], [
    { Machines: 5, Samples: 50, LatestGapMinutes: 150 },
  ]),
  '001:expert:1': golden(3, ['ChangeId', 'FirstRule', 'FirstAccess'], [
    { ChangeId: 'BASELINE-0800', FirstRule: 'allow-oms-outbound', FirstAccess: 'Allow' },
    { ChangeId: 'CHG-4471', FirstRule: 'allow-oms-outbound', FirstAccess: 'Allow' },
    { ChangeId: 'CHG-4472', FirstRule: 'allow-oms-outbound', FirstAccess: 'Allow' },
  ]),
  '001:expert:2': golden(1, ['ChangeId', 'Before', 'After', 'Port', 'Priority'], [
    { ChangeId: 'CHG-4471', Before: 'Allow', After: 'Deny', Port: 443, Priority: 100 },
  ]),
  '001:expert:3': golden(3, ['ChangeId', 'RuleEntries', 'ConfiguredHosts'], [
    { ChangeId: 'BASELINE-0800', RuleEntries: 1, ConfiguredHosts: 0 },
    { ChangeId: 'CHG-4471', RuleEntries: 2, ConfiguredHosts: 5 },
    { ChangeId: 'CHG-4472', RuleEntries: 1, ConfiguredHosts: 1 },
  ]),
  '001:expert:4': golden(1, ['ChangeId', 'FirstHost', 'LastHost', 'Approved'], [
    { ChangeId: 'CHG-4471', FirstHost: 'PRD-WEB-01', LastHost: 'PRD-SQL-01', Approved: true },
  ]),
  '001:expert:5': golden(1, ['ChangeId', 'BlockedPort'], [{ ChangeId: 'CHG-4471', BlockedPort: 443 }]),
  '002:expert:1': golden(2, ['TimeGenerated', 'UserPrincipalName', 'OS', 'Managed', 'Method'], [
    { TimeGenerated: at('08:42:00'), UserPrincipalName: dana, OS: 'Windows', Managed: true, Method: 'MFA' },
    { TimeGenerated: at('09:05:00'), UserPrincipalName: dana, OS: 'Windows', Managed: true, Method: 'MFA' },
  ]),
  '002:expert:2': golden(2, ['UserPrincipalName', 'Attempts', 'Failures', 'Addresses'], [
    { UserPrincipalName: dana, Attempts: 4, Failures: 1, Addresses: 1 },
    { UserPrincipalName: ops, Attempts: 2, Failures: 0, Addresses: 1 },
  ]),
  '002:expert:3': golden(2, ['UserPrincipalName', 'TimeGenerated', 'IPAddress', 'IsApprovedAdmin'], [
    { UserPrincipalName: dana, TimeGenerated: at('09:05:00'), IPAddress: '198.51.100.10', IsApprovedAdmin: true },
    { UserPrincipalName: ops, TimeGenerated: at('08:00:00'), IPAddress: '198.51.100.20', IsApprovedAdmin: true },
  ]),
  '002:expert:4': golden(1, ['Caller', '_ResourceId', 'Writes'], [{ Caller: dana, _ResourceId: resource, Writes: 1 }]),
  '002:expert:5': golden(1, ['TimeGenerated', 'Account', 'AzureResource', 'ChangeId', 'Port'], [
    { TimeGenerated: at('09:12:00'), Account: dana, AzureResource: resource, ChangeId: 'CHG-4471', Port: 443 },
  ]),
  '003:expert:1': golden(1, ['FirstSymptom', 'LastSymptom', 'Messages', 'BurstSeconds'], [
    { FirstSymptom: at('09:13:47'), LastSymptom: at('09:15:44'), Messages: 6, BurstSeconds: 117 },
  ]),
  '003:expert:2': golden(1, ['Account', 'Resource', 'ChangedAt', 'Operation'], [
    { Account: dana, Resource: resource, ChangedAt: at('09:12:00'), Operation: operation },
  ]),
  '003:expert:3': golden(1, ['Ticket', 'OldRule', 'NewRule', 'Port', 'ConfiguredHosts'], [
    { Ticket: 'CHG-4471', OldRule: 'allow-oms-outbound', NewRule: 'deny-all-outbound', Port: 443, ConfiguredHosts: 5 },
  ]),
  '003:expert:4': golden(1, ['AffectedMachines', 'FirstLastSeen', 'LastLastSeen', 'SilenceMinutes'], [
    { AffectedMachines: 5, FirstLastSeen: at('09:15:00'), LastLastSeen: at('09:15:00'), SilenceMinutes: 165 },
  ]),
  '003:expert:5': golden(1, ['Resource', 'Ticket', 'Caller', 'Access', 'Port', 'RollbackRecorded'], [
    { Resource: resource, Ticket: 'CHG-4471', Caller: dana, Access: 'Deny', Port: 443, RollbackRecorded: false },
  ]),
};

function sameCell(actual: KValue, expected: KValue): boolean {
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (typeof expected === 'number') return typeof actual === 'number' && Math.abs(actual - expected) < 1e-9;
  return actual === expected;
}
function matches(actual: Row, expected: Row): boolean {
  return Object.entries(expected).every(([column, expectedCell]) => Object.hasOwn(actual, column) && sameCell(actual[column], expectedCell));
}
function checkGolden(label: string, table: Table, fixture: Golden) {
  assert.equal(table.rows.length, fixture.count, `${label}: independent row count`);
  if (fixture.columns) assert.deepEqual(table.columns, fixture.columns, `${label}: independent column order`);
  const unused = [...table.rows];
  for (const row of fixture.contains ?? []) {
    const index = unused.findIndex(actual => matches(actual, row));
    assert.ok(index >= 0, `${label}: missing independent expected cells ${JSON.stringify(row)}`);
    unused.splice(index, 1);
  }
  if (fixture.every) assert.ok(table.rows.every(row => matches(row, fixture.every!)), `${label}: every-row invariant`);
  fixture.ordered?.forEach((row, index) => assert.ok(matches(table.rows[index], row), `${label}: independent ordered row ${index}`));
}

const database = buildCurriculumDatabase();
assert.deepEqual(Object.fromEntries(Object.entries(database).map(([name, table]) => [name, table.rows.length])), {
  Heartbeat: 3296, Syslog: 780, AzureActivity: 200, Perf: 3456, NetworkChanges: 3, SigninLogs: 6,
});
assert.equal(curriculumNow().toISOString(), '2026-03-11T12:00:00.000Z');
for (const table of curriculumTableMeta()) {
  for (const column of table.columns) {
    for (const row of database[table.name].rows) {
      const value = row[column.name];
      if (column.type === 'datetime') assert.ok(value instanceof Date && Number.isFinite(value.getTime()));
      if (column.type === 'real' || column.type === 'int') assert.equal(typeof value, 'number');
      if (column.type === 'bool') assert.equal(typeof value, 'boolean');
    }
  }
}
const beats = database.Heartbeat.rows;
assert.equal(new Set(beats.map(row => row.Computer)).size, 12);
assert.equal(beats.filter(row => (row.TimeGenerated as Date) > at('09:00:00')).length, 260);
for (const host of [...dark, ...healthy]) {
  const rows = beats.filter(row => row.Computer === host);
  assert.equal(rows.length, dark.includes(host) ? 256 : 288, `${host}: supplied seed cardinality`);
  const last = Math.max(...rows.map(row => (row.TimeGenerated as Date).getTime()));
  assert.equal(last, (dark.includes(host) ? at('09:15:00') : at('11:55:00')).getTime(), `${host}: supplied last seen`);
}
assert.equal(database.Syslog.rows.filter(row => String(row.SyslogMessage).includes('MTU_MISMATCH')).length, 6);
assert.equal(database.Syslog.rows.filter(row => String(row.SyslogMessage).toLowerCase().includes('mismatch')).length, 20);
assert.equal(new Set(database.AzureActivity.rows.map(row => row.OperationNameValue)).size, 7);
const writes = database.AzureActivity.rows.filter(row => row.OperationNameValue === operation);
assert.equal(writes.length, 1);
assert.equal(writes[0].Caller, dana);
assert.equal((writes[0].TimeGenerated as Date).getTime(), at('09:12:00').getTime());
const cpu = database.Perf.rows.filter(row => row.CounterName === '% Processor Time');
assert.equal(cpu.length, 1152);
assert.equal(new Set(cpu.map(row => row.CounterValue)).size, 1152);
checkGolden('seed CPU peaks', {
  name: 'independent seed check', columns: [],
  rows: [...cpu].sort((a, b) => Number(b.CounterValue) - Number(a.CounterValue)).slice(0, 5),
}, { count: 5, ordered: peaks });
const enriched = database.NetworkChanges.rows.find(row => row.ChangeId === 'CHG-4471')!;
assert.equal(enriched.Caller, writes[0].Caller);
assert.equal(enriched._ResourceId, writes[0]._ResourceId);
assert.equal((enriched.TimeGenerated as Date).getTime(), (writes[0].TimeGenerated as Date).getTime());
assert.deepEqual(JSON.parse(String(enriched.Properties)).affectedHosts, dark);
assert.equal(JSON.parse(String(enriched.Properties)).after.access, 'Deny');
assert.equal(JSON.parse(String(enriched.Properties)).after.port, 443);

const isolated = buildCurriculumDatabase();
(isolated.Heartbeat.rows[0].TimeGenerated as Date).setUTCFullYear(1999);
isolated.Heartbeat.rows[0].Computer = 'mutated';
((isolated.NetworkChanges.rows[1].Changes as KValue[])[0] as Row).access = 'mutated';
(isolated.SigninLogs.rows[0].DeviceDetail as Row).operatingSystem = 'mutated';
const fresh = buildCurriculumDatabase();
assert.notEqual(fresh.Heartbeat.rows[0].Computer, 'mutated');
assert.equal((fresh.Heartbeat.rows[0].TimeGenerated as Date).getUTCFullYear(), 2026);
assert.equal(((fresh.NetworkChanges.rows[1].Changes as KValue[])[0] as Row).access, 'Allow');
assert.equal((fresh.SigninLogs.rows[0].DeviceDetail as Row).operatingSystem, 'Windows');

const bases = [CASE001, CASE002, CASE003];
const maps = [HEARTBEAT_HILLS, SIGNAL_HARBOR, RELAY_RUINS];
assert.deepEqual(bases.map(base => base.title), ['Heartbeat Hills', 'Signal Harbor', 'Relay Ruins']);
bases.forEach((base, index) => {
  const prefix = index === 0 ? '' : `case${base.id}-`;
  assert.equal(base.fleetSize, 12);
  assert.equal(base.placeholder, false);
  assert.deepEqual(base.level.rooms.map(room => room.rows), maps[index].rooms.map(room => room.rows));
  assert.deepEqual(base.level.notes.map(note => note.id), maps[index].notes.map(note => note.id));
  assert.deepEqual(base.level.gateChars, maps[index].gateChars);
  assert.equal(base.rootCauses.find(option => option.correct)?.id, `${prefix}rc-proxy`);
  assert.match(base.rootCauses.find(option => option.correct)!.label, /NSG/);
  base.challenges.forEach((challenge, slot) => {
    assert.equal(challenge.id, `${prefix}${LEGACY_CHALLENGES[slot].id}`);
    assert.equal(challenge.room, LEGACY_CHALLENGES[slot].room);
    assert.equal(challenge.points, LEGACY_CHALLENGES[slot].points);
    assert.equal(challenge.evidenceId, `${prefix}${LEGACY_CHALLENGES[slot].evidenceId}`);
    assert.equal(challenge.unlocksGate, `${prefix}${LEGACY_CHALLENGES[slot].unlocksGate}`);
  });
});

const sets = [B1, I1, E1, B2, I2, E2, B3, I3, E3];
const sourceLedger = readFileSync('SOURCES.md', 'utf8');
const ids = new Set<string>();
const queries = new Set<string>();
const challengeIds = new Set<string>();
let verifiedLessons = 0;
for (const set of sets) {
  assert.equal(set.questionSetStatus, 'ready', set.id);
  assert.equal(set.questionSetNotice, null, set.id);
  assert.equal(set.slots.length, 5, set.id);
  assert.ok(set.dataset?.now instanceof Date, `${set.id}: Date clock`);
  const clock = set.dataset!.now;
  clock.setUTCFullYear(1999);
  assert.equal(set.dataset!.now.toISOString(), '2026-03-11T12:00:00.000Z', `${set.id}: independent clock`);
  const base = bases.find(item => item.id === set.caseId)!;
  const variant = createCaseVariant(base, set);
  assert.deepEqual(variant.rootCauses, base.rootCauses, `${set.id}: same root cause across tiers`);
  for (const slot of set.slots) {
    const id = `${set.id}:${slot.slot}`;
    assert.ok(!ids.has(id), `${id}: unique identity`);
    ids.add(id);
    assert.equal(slot.source, 'authored', id);
    assert.ok(slot.lesson.sourceIds?.length, `${id}: sources required`);
    for (const source of slot.lesson.sourceIds!) assert.ok(sourceLedger.includes(`\`${source}\``), `${id}: unknown ledger source ${source}`);
    assert.match(slot.lesson.contentNote ?? '', /provisional review/, `${id}: review status is disclosed`);
    if (slot.lesson.sourceTerminalId) assert.match(slot.lesson.sourceTerminalId, /^T-\d{3}-0[1-5]$/);
    else assert.match(slot.lesson.contentNote ?? '', /sourceTerminalId: null/, `${id}: local fifth-slot provenance`);
    const normalized = slot.lesson.solution.replace(/\s+/g, ' ').trim().toLowerCase();
    assert.ok(!queries.has(normalized), `${id}: repeated query task`);
    queries.add(normalized);
    const challenge = variant.challenges[slot.slot - 1];
    assert.ok(!challengeIds.has(challenge.id), `${id}: repeated playable challenge id`);
    challengeIds.add(challenge.id);
    assert.ok(fixtures[id], `${id}: independent fixture missing`);
    const result = runQuery(challenge.solution, variant.database(), { now: variant.now });
    checkGolden(id, result.table, fixtures[id]);
    if (fixtures[id].chart) assert.equal(result.visualization?.kind, fixtures[id].chart, `${id}: render metadata`);
    const grade = gradeChallenge(challenge, challenge.solution, variant.database(), variant.now);
    assert.equal(grade.status, 'correct', `${id}: reference grade: ${grade.message}`);
    const example = runQuery(challenge.concept.example.query, variant.database(), { now: variant.now });
    assert.ok(Array.isArray(example.table.columns) && Array.isArray(example.table.rows), `${id}: runnable worked example`);
    assert.equal(challenge.hints.length, 3, `${id}: hint contract`);
    const fullHint = challenge.hints[2];
    const hintResult = runQuery(fullHint, variant.database(), { now: variant.now });
    checkGolden(`${id} full hint`, hintResult.table, fixtures[id]);
    const hintGrade = gradeChallenge(challenge, fullHint, variant.database(), variant.now);
    assert.equal(hintGrade.status, 'correct', `${id}: full hint grade: ${hintGrade.message}`);
    assert.notEqual(gradeChallenge(challenge, challenge.starter, variant.database(), variant.now).status, 'correct', `${id}: starter must not solve the task`);
    verifiedLessons++;
  }
}
assert.equal(sets.length, 9);
assert.equal(verifiedLessons, 45);
assert.equal(ids.size, 45);
assert.equal(queries.size, 45);
assert.equal(Object.keys(fixtures).length, 45);

const sortedCpu = runQuery(B3.slots[2].lesson.solution, database, { now: curriculumNow() }).table;
assert.equal((sortedCpu.rows[0].TimeGenerated as Date).getTime(), at('11:45:00').getTime());
for (let index = 1; index < sortedCpu.rows.length; index++) {
  assert.ok((sortedCpu.rows[index - 1].TimeGenerated as Date) >= (sortedCpu.rows[index].TimeGenerated as Date));
}
assert.equal(runQuery(I2.slots[3].lesson.concept.example.query, database, { now: curriculumNow() }).table.rows.length, 0,
  'Missing buckets must remain absent, not fabricated zero rows');
console.log(`Curriculum content: ${verifiedLessons} independent goldens, references, examples and full hints checked; nine ready sets; data types, clock, snapshots, identities and geometry checked.`);
