import type { ChallengeSpec } from '../kql/challenge';
import type { Database, KValue, Row, Table } from '../kql/types';
import type { Evidence, RootCauseOption, TableMeta } from './cases/types';
export type { ColumnMeta, Evidence, RootCauseOption, TableMeta } from './cases/types';

/**
 * Case 001 — "Heartbeat Hills".
 *
 * Everything is generated from these three fixed instants, so the world is
 * deterministic: every playthrough sees the same logs and the same answers.
 */
export const CASE_NOW = new Date('2026-08-14T12:00:00Z');
export const PROXY_CHANGE = new Date('2026-08-13T09:02:00Z');
export const OUTAGE_START = new Date('2026-08-13T09:15:00Z');

const MIN = 60_000;
const HOUR = 60 * MIN;

interface Machine {
  name: string;
  os: 'Windows' | 'Linux';
  version: string;
  rg: string;
  /** Silent machines lost their agent connection at OUTAGE_START. */
  silent: boolean;
}

export const MACHINES: Machine[] = [
  { name: 'CONTOSO-WEB-01', os: 'Windows', version: '1.29.4', rg: 'rg-contoso-edge', silent: false },
  // red herring: oldest agent in the fleet, yet perfectly healthy
  { name: 'CONTOSO-WEB-02', os: 'Windows', version: '1.24.1', rg: 'rg-contoso-edge', silent: false },
  { name: 'CONTOSO-DC-01', os: 'Windows', version: '1.29.4', rg: 'rg-contoso-core', silent: false },
  { name: 'CONTOSO-SQL-01', os: 'Windows', version: '1.29.4', rg: 'rg-contoso-prod', silent: true },
  { name: 'CONTOSO-SQL-02', os: 'Windows', version: '1.29.4', rg: 'rg-contoso-prod', silent: true },
  { name: 'CONTOSO-APP-01', os: 'Linux', version: '1.33.0', rg: 'rg-contoso-prod', silent: true },
  { name: 'CONTOSO-APP-02', os: 'Linux', version: '1.33.0', rg: 'rg-contoso-prod', silent: true },
  { name: 'CONTOSO-FS-01', os: 'Windows', version: '1.29.4', rg: 'rg-contoso-prod', silent: true },
];

export const PROXY_HOST = 'proxy-emea-01.contoso.local:8080';
export const CULPRIT = 'priya.nayar@contoso.com';

// ---- table builders --------------------------------------------------------

function buildHeartbeat(): Table {
  const rows: Row[] = [];
  const start = CASE_NOW.getTime() - 48 * HOUR;
  for (let t = start; t <= CASE_NOW.getTime(); t += 15 * MIN) {
    for (const m of MACHINES) {
      if (m.silent && t > OUTAGE_START.getTime()) continue;
      rows.push({
        TimeGenerated: new Date(t),
        Computer: m.name,
        Category: 'Direct Agent',
        OSType: m.os,
        Version: m.version,
        ResourceGroup: m.rg,
        ComputerEnvironment: 'Azure',
      });
    }
  }
  return {
    name: 'Heartbeat',
    columns: [
      'TimeGenerated',
      'Computer',
      'Category',
      'OSType',
      'Version',
      'ResourceGroup',
      'ComputerEnvironment',
    ],
    rows,
  };
}

function buildAmaDiagnostics(): Table {
  const rows: Row[] = [];
  const start = CASE_NOW.getTime() - 48 * HOUR;

  // Routine "everything is fine" chatter, every 2h, for everyone.
  for (let t = start; t <= CASE_NOW.getTime(); t += 2 * HOUR) {
    for (const m of MACHINES) {
      if (m.silent && t > OUTAGE_START.getTime()) continue;
      rows.push({
        TimeGenerated: new Date(t),
        Computer: m.name,
        Level: 'Information',
        EventId: 4500,
        Message: 'AMA: uploaded 1 batch to the ingestion endpoint.',
      });
    }
  }

  // The silent machines keep talking to themselves — this is the smoking gun.
  for (const m of MACHINES.filter((x) => x.silent)) {
    for (let t = OUTAGE_START.getTime() + 30 * MIN; t <= CASE_NOW.getTime(); t += 30 * MIN) {
      rows.push({
        TimeGenerated: new Date(t),
        Computer: m.name,
        Level: 'Error',
        EventId: 4502,
        Message: `AMA: TLS handshake failed contacting global handler through proxy ${PROXY_HOST}. The connection was closed before the certificate exchange completed.`,
      });
      rows.push({
        TimeGenerated: new Date(t + 5 * MIN),
        Computer: m.name,
        Level: 'Warning',
        EventId: 4506,
        Message: 'AMA: upload retry scheduled, local cache is filling up.',
      });
    }
  }

  // Harmless throttling warnings on healthy machines (red herring).
  for (const m of MACHINES.filter((x) => !x.silent)) {
    for (let t = start + 5 * HOUR; t <= CASE_NOW.getTime(); t += 11 * HOUR) {
      rows.push({
        TimeGenerated: new Date(t),
        Computer: m.name,
        Level: 'Warning',
        EventId: 4506,
        Message: 'AMA: transient throttling from the ingestion endpoint, retrying.',
      });
    }
  }

  rows.sort((a, b) => (a.TimeGenerated as Date).getTime() - (b.TimeGenerated as Date).getTime());
  return {
    name: 'AmaDiagnostics',
    columns: ['TimeGenerated', 'Computer', 'Level', 'EventId', 'Message'],
    rows,
  };
}

interface ActivityTemplate {
  op: string;
  caller: string;
  rg: string;
  status: string;
  props: Record<string, KValue>;
}

const NOISE_ACTIVITY: ActivityTemplate[] = [
  {
    op: 'MICROSOFT.COMPUTE/VIRTUALMACHINES/RESTART/ACTION',
    caller: 'ops-runbook@contoso.com',
    rg: 'rg-contoso-edge',
    status: 'Succeeded',
    props: { entity: 'CONTOSO-WEB-01', reason: 'scheduled patching' },
  },
  {
    op: 'MICROSOFT.NETWORK/NETWORKSECURITYGROUPS/SECURITYRULES/WRITE',
    caller: 'net.admin@contoso.com',
    rg: 'rg-contoso-core',
    status: 'Succeeded',
    props: { settings: { rule: 'AllowHttpsOut', direction: 'Outbound', access: 'Allow' } },
  },
  {
    op: 'MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE',
    caller: 'iam.admin@contoso.com',
    rg: 'rg-contoso-prod',
    status: 'Succeeded',
    props: { roleDefinition: 'Monitoring Reader' },
  },
  {
    op: 'MICROSOFT.INSIGHTS/DATACOLLECTIONRULES/WRITE',
    caller: 'monitoring.team@contoso.com',
    rg: 'rg-contoso-prod',
    status: 'Succeeded',
    props: { settings: { dataFlows: 1, streams: 'Microsoft-Perf' } },
  },
  {
    op: 'MICROSOFT.OPERATIONALINSIGHTS/WORKSPACES/WRITE',
    caller: 'monitoring.team@contoso.com',
    rg: 'rg-contoso-core',
    status: 'Succeeded',
    props: { settings: { retentionInDays: 30, dailyQuotaGb: -1 } },
  },
  {
    op: 'MICROSOFT.RESOURCES/DEPLOYMENTS/WRITE',
    caller: 'pipeline@contoso.com',
    rg: 'rg-contoso-prod',
    status: 'Succeeded',
    props: { template: 'app-tier', mode: 'Incremental' },
  },
  {
    op: 'MICROSOFT.COMPUTE/VIRTUALMACHINES/EXTENSIONS/WRITE',
    caller: 'pipeline@contoso.com',
    rg: 'rg-contoso-edge',
    status: 'Failed',
    props: { extensionName: 'CustomScriptExtension', error: 'transient' },
  },
];

function buildAzureActivity(): Table {
  const rows: Row[] = [];
  const start = CASE_NOW.getTime() - 48 * HOUR;

  NOISE_ACTIVITY.forEach((tpl, i) => {
    for (let k = 0; k < 4; k++) {
      rows.push({
        TimeGenerated: new Date(start + (i * 3 + k * 11) * HOUR + i * 17 * MIN),
        OperationNameValue: tpl.op,
        Caller: tpl.caller,
        ResourceGroup: tpl.rg,
        ActivityStatusValue: tpl.status,
        Properties: JSON.stringify(tpl.props),
      });
    }
  });

  // The one that matters: an AMA proxy pushed fleet-wide with a bypass list
  // that never mentions the Azure Monitor ingestion endpoints.
  rows.push({
    TimeGenerated: PROXY_CHANGE,
    OperationNameValue: 'MICROSOFT.HYBRIDCOMPUTE/MACHINES/EXTENSIONS/WRITE',
    Caller: CULPRIT,
    ResourceGroup: 'rg-contoso-prod',
    ActivityStatusValue: 'Succeeded',
    Properties: JSON.stringify({
      extensionName: 'AzureMonitorWindowsAgent',
      scope: 'rg-contoso-prod',
      settings: {
        proxy: {
          mode: 'Enabled',
          url: `http://${PROXY_HOST}`,
          bypassList: ['*.contoso.local', '169.254.169.254'],
        },
      },
    }),
  });

  rows.sort((a, b) => (a.TimeGenerated as Date).getTime() - (b.TimeGenerated as Date).getTime());
  return {
    name: 'AzureActivity',
    columns: [
      'TimeGenerated',
      'OperationNameValue',
      'Caller',
      'ResourceGroup',
      'ActivityStatusValue',
      'Properties',
    ],
    rows,
  };
}

let cached: Database | null = null;

export function buildDatabase(): Database {
  if (cached) return cached;
  const tables = [buildHeartbeat(), buildAmaDiagnostics(), buildAzureActivity()];
  cached = Object.fromEntries(tables.map((t) => [t.name, t]));
  return cached;
}

// ---- narrative content -----------------------------------------------------

export const EVIDENCE: Evidence[] = [
  {
    id: 'ev-table',
    title: 'The Heartbeat table is doing its job',
    detail:
      'Every machine checks in every 15 minutes and the record lands here, tagged with its name and OS. So an absence in this table is real, not a gap in collection.',
    chainIndex: 0,
  },
  {
    id: 'ev-fleet',
    title: 'Fleet size confirmed',
    detail: '8 machines are onboarded to this workspace. That is the full list we have to account for.',
    chainIndex: 0,
  },
  {
    id: 'ev-silent',
    title: 'Only 3 of 8 still reporting',
    detail:
      'In the last 24 hours only CONTOSO-WEB-01, WEB-02 and DC-01 sent a heartbeat. Five machines are dark — and the three survivors prove ingestion itself is healthy.',
    chainIndex: 3,
  },
  {
    id: 'ev-timestamp',
    title: 'All five stopped in the same minute',
    detail:
      'Last contact for every silent machine is 2026-08-13 09:15Z. A simultaneous stop means a config change, not five hardware faults. Agent version is not the pattern either — the oldest agent in the fleet (1.24.1) is one of the healthy ones.',
    chainIndex: 2,
  },
  {
    id: 'ev-tls',
    title: 'They are alive, and they are shouting about a proxy',
    detail: `There is exactly one distinct error across the whole fleet: "TLS handshake failed ... through proxy ${PROXY_HOST}". A switched-off machine could not have written it.`,
    chainIndex: 1,
  },
];

export const CAUSAL_CHAIN = [
  'Proxy setting pushed to rg-contoso-prod',
  'Agents forced through a proxy that cannot complete TLS',
  'Heartbeat uploads fail and cache locally',
  'Workspace shows no heartbeats for 5 machines',
];

export const ROOT_CAUSES: RootCauseOption[] = [
  {
    id: 'rc-cap',
    label: 'Log Analytics daily cap reached',
    detail: 'Ingestion stopped because the workspace hit its daily quota.',
    rebuttal: 'The workspace daily quota is -1 (unlimited) in the activity log, and three machines kept ingesting fine.',
  },
  {
    id: 'rc-deallocated',
    label: 'The machines were deallocated',
    detail: 'Someone shut down the VMs, so no agent is running.',
    rebuttal: 'Deallocated machines cannot write agent logs — yet all five keep logging EventId 4502 every 30 minutes.',
  },
  {
    id: 'rc-proxy',
    label: 'Proxy misconfiguration',
    detail: 'An AMA proxy setting routes agents through a proxy that cannot reach the Azure Monitor ingestion endpoints.',
    correct: true,
  },
  {
    id: 'rc-agent-version',
    label: 'Outdated agent version',
    detail: 'The agents are too old to talk to the current ingestion endpoint.',
    rebuttal: 'CONTOSO-WEB-02 runs the oldest agent in the fleet (1.24.1) and is perfectly healthy.',
  },
  {
    id: 'rc-dcr',
    label: 'Data collection rule deleted',
    detail: 'The DCR association was removed so nothing is collected.',
    rebuttal: 'The only DCR activity in the window is a successful write, and a missing DCR would not produce TLS handshake errors.',
  },
];

export const CUSTOMER_EMAIL = {
  from: 'j.alvarez@contoso.com',
  subject: 'URGENT — monitoring blind on production',
  body: `We lost monitoring on our production estate yesterday morning.

Five servers have no heartbeat in Azure Monitor since around 09:00 UTC on 13 August. The machines are up — I can RDP into them right now. Our edge web servers are still reporting fine.

Nothing was patched. Nobody rebooted anything. We need to know why before the audit on Monday.

Jordan Alvarez
Platform Operations, Contoso`,
};

// ---- terminals -------------------------------------------------------------

export const CHALLENGES: ChallengeSpec[] = [
  {
    id: 't1-look',
    room: 0,
    prompt:
      'Before anyone theorises, look at the data. Ask the Heartbeat table for any 10 rows.',
    flavour: 'A dusty terminal in the corner of the office. The cursor blinks expectantly.',
    concept: {
      title: 'Your first query',
      body:
        'A KQL query starts with a table name. That is already a valid query — it means "give me everything in here".\n\n' +
        'You then add steps with a pipe. Each "|" hands the rows from the step before into the next step. Nothing is ever nested; you just keep adding stages.\n\n' +
        'take is the gentlest step there is: "give me this many rows, any of them". It is what every engineer types first when they meet an unfamiliar table.',
      pattern: 'TableName\n| take 10',
      example: {
        query: 'AzureActivity | take 3',
        explain:
          'Three rows from a completely different table. Same shape — table, pipe, operator. Once you know that shape you can open any table in Azure.',
      },
    },
    teaches:
      'Every query is a table followed by steps joined with pipes. take shows you a sample so you can see what you are working with.',
    hints: [
      'The table is called Heartbeat. Typing just that is already a query.',
      'Add a step with a pipe, then the take operator and a number.',
      'Heartbeat | take 10',
    ],
    starter: '',
    solution: 'Heartbeat | take 10',
    requiredOperators: ['take'],
    evidenceId: 'ev-table',
    evidenceTokens: ['Direct Agent', 'CONTOSO'],
    unlocksGate: 'gate-office',
    points: 60,
  },
  {
    id: 't2-fleet',
    room: 1,
    prompt:
      'Contoso says "everything went quiet". Before we trust that, size the fleet: list every distinct Computer in the Heartbeat table.',
    flavour: 'A terminal grown into the trunk of a telemetry pine.',
    concept: {
      title: 'Unique values with distinct',
      body:
        'Heartbeat has over a thousand rows, but far fewer machines — each one checks in every 15 minutes, over and over.\n\n' +
        'distinct throws away the duplicates and leaves one row per unique value. It is the fastest way to answer "what is actually out there?" without scrolling through thousands of rows.',
      pattern: 'TableName\n| distinct ColumnName',
      example: {
        query: 'Heartbeat | distinct OSType',
        explain:
          'Over a thousand rows collapse to two: Windows and Linux. Swap the column and you ask a completely different question.',
      },
    },
    teaches:
      'distinct collapses a column down to its unique values — the fastest way to answer "what is actually out there?".',
    hints: [
      'Start from the Heartbeat table again.',
      'One operator does the whole job. It starts with "dis".',
      'Heartbeat | distinct Computer',
    ],
    starter: 'Heartbeat\n| take 10',
    solution: 'Heartbeat | distinct Computer',
    requiredOperators: ['distinct'],
    evidenceId: 'ev-fleet',
    evidenceTokens: ['CONTOSO-SQL-01', 'CONTOSO-WEB-02'],
    unlocksGate: 'gate-forest',
    points: 60,
  },
  {
    id: 't3-alive',
    room: 2,
    prompt:
      'Eight machines exist. Now find out how many are still talking: list the distinct Computers that sent a heartbeat in the last 24 hours.',
    flavour: 'The gate ahead is sealed by a timestamp lock.',
    concept: {
      title: 'Filtering with where',
      body:
        'where keeps only the rows that match a condition and drops the rest. Put it early in the pipeline and every later step has less to chew on.\n\n' +
        'For times, ago() is the tool. ago(24h) means "24 hours before now", so "TimeGenerated > ago(24h)" reads as "happened within the last day". Because it is relative to now, the query still works tomorrow without editing.\n\n' +
        'Then reuse distinct from the last terminal to collapse the survivors into a list.',
      pattern: 'TableName\n| where TimeColumn > ago(24h)\n| distinct ColumnName',
      example: {
        query: 'Heartbeat | where OSType == "Linux" | distinct Computer',
        explain:
          'Same two steps, a different filter: keep only the Linux rows, then list the machines that remain. Compare the answer with the full fleet and the gap is the story.',
      },
    },
    teaches:
      'where filters rows before anything else runs. ago(24h) is relative to now, so the query keeps working tomorrow.',
    hints: [
      'Filter first: where TimeGenerated > ago(24h).',
      'Then collapse to unique machines with distinct, exactly like last time.',
      'Heartbeat | where TimeGenerated > ago(24h) | distinct Computer',
    ],
    starter: 'Heartbeat\n| distinct Computer',
    solution: 'Heartbeat | where TimeGenerated > ago(24h) | distinct Computer',
    requiredOperators: ['where', 'distinct'],
    evidenceId: 'ev-silent',
    evidenceTokens: ['CONTOSO-WEB-01', 'CONTOSO-DC-01'],
    unlocksGate: 'gate-caverns',
    points: 60,
  },
  {
    id: 't4-lastseen',
    room: 2,
    prompt:
      'Five machines are dark. Find out when each one was last heard from — show the latest heartbeat per Computer, and bring the agent Version along too.',
    flavour: 'Deep in the caverns, a timestamp console flickers.',
    concept: {
      title: 'Grouping with summarize',
      body:
        'where removes rows. summarize is the opposite: it squashes rows together into groups and calculates something for each group.\n\n' +
        '"summarize max(TimeGenerated) by Computer" means "one row per Computer, and for each one give me the latest timestamp". max() picks the biggest value in the group.\n\n' +
        'You can group by more than one column: "by Computer, Version" makes a row per unique pairing, so the agent version travels alongside the answer.',
      pattern: 'TableName\n| summarize max(TimeColumn) by ColumnA, ColumnB',
      example: {
        query: 'Heartbeat | summarize max(TimeGenerated) by OSType',
        explain:
          'Two groups, two answers. Change the column after "by" and you re-slice the same data a different way — that is the whole trick with summarize.',
      },
    },
    teaches:
      'summarize squashes rows into groups and calculates per group. max() gives the latest value — the standard way to ask "when was this last seen?".',
    hints: [
      'The operator is summarize, and the aggregation is max(TimeGenerated).',
      'Group with by, and list both columns: by Computer, Version.',
      'Heartbeat | summarize max(TimeGenerated) by Computer, Version',
    ],
    starter: 'Heartbeat\n| where TimeGenerated > ago(24h)\n| distinct Computer',
    solution: 'Heartbeat | summarize max(TimeGenerated) by Computer, Version',
    requiredOperators: ['summarize', 'max'],
    evidenceId: 'ev-timestamp',
    evidenceTokens: ['2026-08-13 09:15', '1.24.1'],
    unlocksGate: 'gate-datacenter',
    points: 60,
  },
  {
    id: 't5-why',
    room: 3,
    prompt:
      'If those machines were switched off they could not log anything. Open the agent diagnostics and show the distinct Message of every Error.',
    flavour: 'The data centre core. One last lock between you and the verdict.',
    concept: {
      title: 'Turning a second table on your theory',
      body:
        'Good troubleshooting is not only collecting evidence for your theory — it is trying honestly to kill it. If the theory survives, you can trust it.\n\n' +
        'The theory is "the machines are switched off". That makes a prediction: a machine that is off cannot write logs. So look somewhere else and check.\n\n' +
        'No new operators here. You already have where and distinct — point them at a different table and read what comes back.',
      pattern: 'DifferentTable\n| where Level == "Error"\n| distinct Message',
      example: {
        query: 'AmaDiagnostics | where Level == "Warning" | distinct Message',
        explain:
          'The same two steps against the warnings instead. Using distinct on a message column is a quick way to see how many genuinely different problems you have, rather than how many times one problem repeated.',
      },
    },
    teaches:
      'Checking a second table is how you disprove a theory. Machines that are "off" do not write logs — and the message they wrote names the culprit.',
    hints: [
      'The table is AmaDiagnostics and the column is Level.',
      'Filter Level == "Error", then use distinct on Message.',
      'AmaDiagnostics | where Level == "Error" | distinct Message',
    ],
    starter: 'AmaDiagnostics\n| take 10',
    solution: 'AmaDiagnostics | where Level == "Error" | distinct Message',
    requiredOperators: ['where', 'distinct'],
    evidenceId: 'ev-tls',
    evidenceTokens: ['TLS handshake failed', 'proxy-emea-01.contoso.local:8080'],
    unlocksGate: 'gate-core',
    points: 60,
  },
];

export const CASE = {
  id: '001',
  title: 'Heartbeat Hills',
  customer: 'Contoso',
  summary: 'Five production machines stopped sending heartbeats at 09:15Z. The machines are up.',
  totalFragments: 24,
  totalCrystals: 5,
};

// ---- schema metadata -------------------------------------------------------

/** Drives the schema panel and the editor's autocomplete. */
export const TABLE_META: TableMeta[] = [
  {
    name: 'Heartbeat',
    doc: 'One record per agent check-in, every 15 minutes. The classic "is it alive?" table.',
    columns: [
      { name: 'TimeGenerated', type: 'datetime', doc: 'When the heartbeat was received.' },
      { name: 'Computer', type: 'string', doc: 'Machine name.' },
      { name: 'Category', type: 'string', doc: 'Agent category, e.g. Direct Agent.' },
      { name: 'OSType', type: 'string', doc: 'Windows or Linux.' },
      { name: 'Version', type: 'string', doc: 'Agent version.' },
      { name: 'ResourceGroup', type: 'string', doc: 'Azure resource group.' },
      { name: 'ComputerEnvironment', type: 'string', doc: 'Azure or Non-Azure.' },
    ],
  },
  {
    name: 'AmaDiagnostics',
    doc: 'Azure Monitor Agent self-diagnostics. A machine that is switched off cannot write here.',
    columns: [
      { name: 'TimeGenerated', type: 'datetime', doc: 'When the entry was logged.' },
      { name: 'Computer', type: 'string', doc: 'Machine name.' },
      { name: 'Level', type: 'string', doc: 'Information, Warning or Error.' },
      { name: 'EventId', type: 'int', doc: '4500 upload ok, 4502 TLS failure, 4506 retry.' },
      { name: 'Message', type: 'string', doc: 'Free-text detail.' },
    ],
  },
  {
    name: 'AzureActivity',
    doc: 'Control-plane audit log. Answers "what changed, and who changed it?".',
    columns: [
      { name: 'TimeGenerated', type: 'datetime', doc: 'When the operation ran.' },
      { name: 'OperationNameValue', type: 'string', doc: 'The ARM operation.' },
      { name: 'Caller', type: 'string', doc: 'Who performed it.' },
      { name: 'ResourceGroup', type: 'string', doc: 'Target resource group.' },
      { name: 'ActivityStatusValue', type: 'string', doc: 'Succeeded or Failed.' },
      { name: 'Properties', type: 'dynamic', doc: 'JSON payload — use parse_json() to walk it.' },
    ],
  },
];

export const tableMeta = (name: string): TableMeta | undefined =>
  TABLE_META.find((t) => t.name.toLowerCase() === name.toLowerCase());
