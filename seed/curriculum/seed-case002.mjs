// ds-case002-vaults — Case 002 "The Search Vaults"
// Spec: KQL-Detective-Implementation-Spec.md §7.2
//
// Planted facts (asserted by verify.mjs):
//   Syslog rows ................................... 780
//   Syslog rows containing "MTU_MISMATCH" ......... 6    (5 dark machines + PRD-NET-FW01)
//   Syslog rows containing "mismatch" (any case) .. 20   (6 planted + 14 decoys)
//   AzureActivity rows ............................ 200
//   distinct AzureActivity OperationNameValue ..... 7
//   SECURITYRULES/WRITE rows ...................... 1    @ 2026-03-11T09:12:00Z
//
// Depends on ds-case001-heartbeat — run seed-case001.mjs first.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATASETS_ROOT, QUERY_TIME, iso, mulberry32, parseUtc, writeDataset } from './lib.mjs';

const SPAN_START = '2026-03-11T06:00:00Z';
const SPAN_END = '2026-03-11T11:55:00Z';
const RULE_CHANGE_AT = '2026-03-11T09:12:00Z';

const rand = mulberry32(20260311);

// ---------------------------------------------------------------- Heartbeat (reused)

const hbPath = resolve(DATASETS_ROOT, 'ds-case001-heartbeat', 'data.json');
if (!existsSync(hbPath)) {
  throw new Error('Run seed-case001.mjs before seed-case002.mjs (ds-case001-heartbeat/data.json missing).');
}
const heartbeatRows = JSON.parse(readFileSync(hbPath, 'utf8')).Heartbeat;

const HEARTBEAT_COLUMNS = [
  { name: 'TimeGenerated', type: 'datetime' },
  { name: 'Computer', type: 'string' },
  { name: 'OSType', type: 'string' },
  { name: 'Version', type: 'string' },
  { name: 'ComputerEnvironment', type: 'string' },
  { name: 'RemoteIPCountry', type: 'string' },
  { name: 'ResourceGroup', type: 'string' },
];

// ---------------------------------------------------------------- Syslog

const DARK_MACHINES = ['PRD-WEB-01', 'PRD-WEB-02', 'PRD-APP-01', 'PRD-APP-02', 'PRD-SQL-01'];
const ALL_HOSTS = [
  ...DARK_MACHINES,
  'PRD-WEB-03', 'PRD-SQL-02', 'PRD-CACHE-01', 'PRD-MON-01',
  'DEV-WEB-01', 'DEV-APP-01', 'UAT-APP-01', 'PRD-NET-FW01',
];

const SYSLOG_COLUMNS = [
  { name: 'TimeGenerated', type: 'datetime' },
  { name: 'Computer', type: 'string' },
  { name: 'Facility', type: 'string' },
  { name: 'SeverityLevel', type: 'string' },
  { name: 'ProcessName', type: 'string' },
  { name: 'SyslogMessage', type: 'string' },
];

// 6 planted rows carrying the exact token the case is about.
const MTU_MESSAGE = 'kernel: eth0: MTU_MISMATCH detected, dropping oversized frames';
const PLANTED = [
  ['PRD-WEB-01', '2026-03-11T09:13:47Z'],
  ['PRD-NET-FW01', '2026-03-11T09:13:51Z'],
  ['PRD-APP-01', '2026-03-11T09:14:02Z'],
  ['PRD-WEB-02', '2026-03-11T09:14:20Z'],
  ['PRD-APP-02', '2026-03-11T09:15:09Z'],
  ['PRD-SQL-01', '2026-03-11T09:15:44Z'],
];

// 14 decoys containing the word "mismatch" but NOT the MTU_MISMATCH token.
// These make `contains "mismatch"` return 20 while `has "MTU_MISMATCH"` returns 6. That IS the lesson.
const DECOY_MESSAGES = [
  'sshd: certificate mismatch in trust store, falling back to password auth',
  'chronyd: clock mismatch of 0.42s corrected against ntp.contoso.com',
  'rpm: package signature mismatch, skipping optional dependency',
  'nginx: upstream host header mismatch, request rewritten',
];

const FILLER_MESSAGES = [
  'systemd: Started Session c2 of user svc-deploy.',
  'CRON: (root) CMD (/usr/local/bin/collect-metrics.sh)',
  'sshd: Accepted publickey for svc-deploy from 203.0.113.44 port 51022',
  'kernel: EXT4-fs (sda1): mounted filesystem with ordered data mode',
  'systemd: Starting Cleanup of Temporary Directories...',
  'nginx: 203.0.113.17 - - "GET /healthz HTTP/1.1" 200 2',
  'dhclient: DHCPACK of 198.51.100.23 from 198.51.100.1',
  'auditd: node=contoso type=SERVICE_START msg=audit(1773): unit=collectd',
];

const FACILITIES = ['kern', 'daemon', 'auth', 'cron', 'user'];
const SEVERITIES = ['info', 'notice', 'warning', 'err'];

function randomTimeInSpan() {
  const start = parseUtc(SPAN_START).getTime();
  const end = parseUtc(SPAN_END).getTime();
  // Snap to whole seconds so output stays stable and readable.
  return new Date(start + Math.floor(rand() * (end - start)) / 1000 * 1000);
}

const syslogRows = [];

for (const [computer, time] of PLANTED) {
  syslogRows.push({
    TimeGenerated: time,
    Computer: computer,
    Facility: 'kern',
    SeverityLevel: 'err',
    ProcessName: 'kernel',
    SyslogMessage: MTU_MESSAGE,
  });
}

for (let i = 0; i < 14; i++) {
  syslogRows.push({
    TimeGenerated: iso(randomTimeInSpan()),
    Computer: ALL_HOSTS[i % ALL_HOSTS.length],
    Facility: 'daemon',
    SeverityLevel: 'warning',
    ProcessName: 'systemd',
    SyslogMessage: DECOY_MESSAGES[i % DECOY_MESSAGES.length],
  });
}

for (let i = 0; i < 760; i++) {
  syslogRows.push({
    TimeGenerated: iso(randomTimeInSpan()),
    Computer: ALL_HOSTS[i % ALL_HOSTS.length],
    Facility: FACILITIES[i % FACILITIES.length],
    SeverityLevel: SEVERITIES[i % SEVERITIES.length],
    ProcessName: 'systemd',
    SyslogMessage: FILLER_MESSAGES[i % FILLER_MESSAGES.length],
  });
}

syslogRows.sort((a, b) => a.TimeGenerated.localeCompare(b.TimeGenerated));

// ---------------------------------------------------------------- AzureActivity

const ACTIVITY_COLUMNS = [
  { name: 'TimeGenerated', type: 'datetime' },
  { name: 'OperationNameValue', type: 'string' },
  { name: 'Caller', type: 'string' },
  { name: 'ActivityStatusValue', type: 'string' },
  { name: 'ResourceGroup', type: 'string' },
  { name: '_ResourceId', type: 'string' },
];

// 6 routine operations (199 rows) + 1 planted operation (1 row) = 7 distinct, 200 rows.
const ROUTINE_OPS = [
  ['MICROSOFT.COMPUTE/VIRTUALMACHINES/READ', 68],
  ['MICROSOFT.OPERATIONALINSIGHTS/WORKSPACES/READ', 45],
  ['MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/READ', 32],
  ['MICROSOFT.RESOURCES/DEPLOYMENTS/WRITE', 24],
  ['MICROSOFT.COMPUTE/VIRTUALMACHINES/RESTART/ACTION', 18],
  ['MICROSOFT.STORAGE/STORAGEACCOUNTS/LISTKEYS/ACTION', 12],
];

const CALLERS = [
  'j.reyes@contoso.com',
  'svc-deploy@contoso.com',
  'a.lindqvist@contoso.com',
  'ops-automation@contoso.com',
];
const RESOURCE_GROUPS = ['rg-prod-web', 'rg-prod-app', 'rg-prod-data', 'rg-prod-mon', 'rg-dev'];

const activityRows = [];

for (const [op, count] of ROUTINE_OPS) {
  for (let i = 0; i < count; i++) {
    const rg = RESOURCE_GROUPS[i % RESOURCE_GROUPS.length];
    activityRows.push({
      TimeGenerated: iso(randomTimeInSpan()),
      OperationNameValue: op,
      Caller: CALLERS[i % CALLERS.length],
      ActivityStatusValue: 'Succeeded',
      ResourceGroup: rg,
      _ResourceId: `/subscriptions/00000000-0000-0000-0000-000000000001/resourcegroups/${rg}`,
    });
  }
}

// The one row the whole case is pointing at.
activityRows.push({
  TimeGenerated: RULE_CHANGE_AT,
  OperationNameValue: 'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/SECURITYRULES/WRITE',
  Caller: 'dana.whitfield@contoso.com',
  ActivityStatusValue: 'Succeeded',
  ResourceGroup: 'rg-prod-network',
  _ResourceId:
    '/subscriptions/00000000-0000-0000-0000-000000000001/resourcegroups/rg-prod-network/providers/microsoft.network/networksecuritygroups/nsg-prod-outbound',
});

activityRows.sort((a, b) => a.TimeGenerated.localeCompare(b.TimeGenerated));

// ---------------------------------------------------------------- write

writeDataset({
  datasetId: 'ds-case002-vaults',
  tables: { Syslog: syslogRows, AzureActivity: activityRows, Heartbeat: heartbeatRows },
  columns: {
    Syslog: SYSLOG_COLUMNS,
    AzureActivity: ACTIVITY_COLUMNS,
    Heartbeat: HEARTBEAT_COLUMNS,
  },
  readme: `
# ds-case002-vaults

Generated by \`seed/seed-case002.mjs\`. Do not edit by hand.
Depends on \`ds-case001-heartbeat\` (Heartbeat rows are reused verbatim).

- **queryTime:** ${QUERY_TIME}
- **Syslog / AzureActivity span:** ${SPAN_START} to ${SPAN_END}

## Planted facts

| Fact | Value |
|------|-------|
| \`Syslog\` rows | 780 |
| Rows containing \`MTU_MISMATCH\` | 6 |
| Rows matching \`contains "mismatch"\` | 20 (6 planted + 14 decoys) |
| Hosts with the MTU message | PRD-WEB-01, PRD-WEB-02, PRD-APP-01, PRD-APP-02, PRD-SQL-01, PRD-NET-FW01 |
| MTU message window | 09:13:47Z to 09:15:44Z |
| \`AzureActivity\` rows | 200 |
| Distinct \`OperationNameValue\` | 7 |
| \`SECURITYRULES/WRITE\` rows | 1, at ${RULE_CHANGE_AT} |
| Caller on that row | dana.whitfield@contoso.com |

## Terminal answers

| Terminal | Query | Expected |
|----------|-------|----------|
| T-002-01 | \`search "MTU_MISMATCH"\` | 6 rows, all from Syslog |
| T-002-02 | \`Syslog \\| where SyslogMessage has "MTU_MISMATCH"\` | 6 rows |
| T-002-03 | \`AzureActivity \\| distinct OperationNameValue\` | 7 rows |
| T-002-04 | \`AzureActivity \\| where TimeGenerated between (datetime(2026-03-11 09:00) .. datetime(2026-03-11 09:20)) \\| where OperationNameValue has "SECURITYRULES/WRITE" \\| project TimeGenerated, Caller, ActivityStatusValue\` | 1 row: ${RULE_CHANGE_AT}, dana.whitfield@contoso.com, Succeeded |

## Engine note

The \`has\` vs \`contains\` contrast is the point of this case. If the engine tokenizes \`MTU_MISMATCH\` into
\`MTU\` + \`MISMATCH\`, \`has "MTU_MISMATCH"\` must still behave as a phrase match and return exactly 6.
Verify this before shipping T-002-02.
`,
});
