import type { CaseDefinition, TableMeta } from '../data/cases/types';
import type { ChallengeSpec } from '../kql/challenge';
import type { Database } from '../kql/types';
import { HEARTBEAT_HILLS, parseLevel, type LevelDefinition } from '../game/levels/heartbeatHills';
import { ROOM_TRACKS } from '../game/music';

// Entirely fictional parcel simulator. Only the existing map geometry is reused.
// Copy this file to author a case; nothing here registers it in gameplay.
function database(): Database {
  const delivery = [
    ['11:20', 'packer-1', 'Live', 'Sent', 'Delivery accepted'],
    ['11:25', 'packer-2', 'Live', 'Sent', 'Delivery accepted'],
    ['11:40', 'packer-1', 'Archive', 'Failed', 'Unknown destination: Archive'],
    ['11:45', 'packer-2', 'Archive', 'Failed', 'Unknown destination: Archive'],
    ['11:50', 'packer-1', 'Archive', 'Failed', 'Unknown destination: Archive'],
    ['11:55', 'cart-1', 'Live', 'Sent', 'Delivery accepted'],
  ];
  return {
    DeliveryLog: {
      name: 'DeliveryLog',
      columns: ['TimeGenerated', 'Device', 'Route', 'Outcome', 'Detail'],
      rows: delivery.map(([time, Device, Route, Outcome, Detail]) => ({
        TimeGenerated: new Date(`2026-09-01T${time}:00Z`), Device, Route, Outcome, Detail,
      })),
    },
    ConfigLog: {
      name: 'ConfigLog',
      columns: ['TimeGenerated', 'Scope', 'Setting', 'Value', 'Actor'],
      rows: [
        { TimeGenerated: new Date('2026-09-01T11:00:00Z'), Scope: 'packers', Setting: 'Destination', Value: 'Live', Actor: 'setup-demo' },
        { TimeGenerated: new Date('2026-09-01T11:35:00Z'), Scope: 'packers', Setting: 'Destination', Value: 'Archive', Actor: 'ops-demo' },
      ],
    },
  };
}

const tableMeta: TableMeta[] = [
  {
    name: 'DeliveryLog', doc: 'Six synthetic delivery attempts from three toy devices.',
    columns: [
      { name: 'TimeGenerated', type: 'datetime', doc: 'UTC time of the attempt.' },
      { name: 'Device', type: 'string', doc: 'Toy device making the attempt.' },
      { name: 'Route', type: 'string', doc: 'Destination selected by the device.' },
      { name: 'Outcome', type: 'string', doc: 'Sent or Failed.' },
      { name: 'Detail', type: 'string', doc: 'Local diagnostic explaining the result.' },
    ],
  },
  {
    name: 'ConfigLog', doc: 'Complete destination-change history for the toy packers.',
    columns: [
      { name: 'TimeGenerated', type: 'datetime', doc: 'UTC time the change was applied.' },
      { name: 'Scope', type: 'string', doc: 'Devices affected; packers excludes cart-1.' },
      { name: 'Setting', type: 'string', doc: 'Name of the changed setting.' },
      { name: 'Value', type: 'string', doc: 'New setting value.' },
      { name: 'Actor', type: 'string', doc: 'Fictional operator identifier.' },
    ],
  },
];

const lessons: Omit<ChallengeSpec, 'id' | 'room' | 'unlocksGate' | 'evidenceId' | 'points'>[] = [
  {
    prompt: 'Sample the first two stored delivery attempts with take 2.',
    concept: {
      title: 'Start with a table and take',
      body: 'A table name selects the data. A pipe passes it to the next step. take limits the sample; it does not promise chronological order. This tiny fixture has a fixed stored order.',
      pattern: 'TableName | take Number',
      example: { query: 'ConfigLog | take 1', explain: 'One sample configuration row: the initial Live destination.' },
    },
    teaches: 'Use take to inspect a small sample before drawing conclusions.',
    hints: ['Use DeliveryLog, not ConfigLog.', 'Pipe the table to take and request two rows.', 'DeliveryLog | take 2'],
    starter: 'DeliveryLog', solution: 'DeliveryLog | take 2',
    requiredOperators: ['take'], evidenceTokens: ['packer-1', 'packer-2', 'Sent'],
  },
  {
    prompt: 'List every distinct Device that appears in DeliveryLog.',
    concept: {
      title: 'Find unique values',
      body: 'One device can log many attempts. distinct keeps each value once, so you can inventory devices without counting retries twice.',
      pattern: 'TableName | distinct Column',
      example: { query: 'DeliveryLog | distinct Outcome', explain: 'The two outcomes are Sent and Failed.' },
    },
    teaches: 'Repeated rows do not mean extra devices; distinct reveals the observed fleet.',
    hints: ['Look at the Device column.', 'Replace take with distinct and the column name.', 'DeliveryLog | distinct Device'],
    starter: 'DeliveryLog | take 2', solution: 'DeliveryLog | distinct Device',
    requiredOperators: ['distinct'], evidenceTokens: ['packer-1', 'packer-2', 'cart-1'],
  },
  {
    prompt: 'Find failed attempts in the last 30 minutes. Return only Device and Detail.',
    concept: {
      title: 'Filter rows, then select columns',
      body: 'where keeps rows matching a condition. ago(30m) means thirty minutes before the fixed case clock (12:00 UTC). project selects the columns you need.',
      pattern: 'TableName | where TimeGenerated > ago(30m) | where Column == "Value" | project Column',
      example: {
        query: 'DeliveryLog | where TimeGenerated > ago(30m) | where Outcome == "Sent" | project Device, Detail',
        explain: 'cart-1 still delivers successfully in the same time window.',
      },
    },
    teaches: 'A focused result preserves the diagnostic text that supports the evidence.',
    hints: ['Filter TimeGenerated and Outcome before projecting.', 'Use ago(30m), Outcome == "Failed", then project Device, Detail.', 'DeliveryLog | where TimeGenerated > ago(30m) | where Outcome == "Failed" | project Device, Detail'],
    starter: 'DeliveryLog | where Outcome == "Sent"',
    solution: 'DeliveryLog | where TimeGenerated > ago(30m) | where Outcome == "Failed" | project Device, Detail',
    requiredOperators: ['where', 'ago', 'project'], evidenceTokens: ['packer-1', 'packer-2', 'Unknown destination: Archive'],
  },
  {
    prompt: 'Count failed delivery attempts by Route. Name the count column Failures.',
    concept: {
      title: 'Count groups with summarize',
      body: 'summarize collapses rows into groups. count() counts attempts, not devices. An alias gives the resulting count a useful name.',
      pattern: 'TableName | summarize Total = count() by Column',
      example: {
        query: 'DeliveryLog | summarize Attempts = count() by Outcome',
        explain: 'There are three Sent and three Failed attempts, not six different devices.',
      },
    },
    teaches: 'Group failures by a shared attribute to test whether they have a common cause.',
    hints: ['First retain only Failed attempts.', 'Use summarize Failures = count() by Route.', 'DeliveryLog | where Outcome == "Failed" | summarize Failures = count() by Route'],
    starter: 'DeliveryLog | summarize Attempts = count() by Outcome',
    solution: 'DeliveryLog | where Outcome == "Failed" | summarize Failures = count() by Route',
    requiredOperators: ['where', 'summarize', 'count'], evidenceTokens: ['Archive', '3'],
  },
  {
    prompt: 'Show destination changes newest first: TimeGenerated, Scope, Value, Actor. Use ConfigLog and filter Setting to Destination.',
    concept: {
      title: 'Order the change history',
      body: 'sort by orders rows; desc puts the newest timestamp first. Compare the change history with the failure times yourself: this engine does not support joins.',
      pattern: 'TableName | sort by TimeGenerated desc',
      example: {
        query: 'DeliveryLog | project TimeGenerated, Device, Outcome | sort by TimeGenerated asc | take 2',
        explain: 'Explicit sorting makes the earliest two successes appear first.',
      },
    },
    teaches: 'A shared error plus a preceding scoped change is stronger evidence than timing alone.',
    hints: ['Switch to ConfigLog and filter Setting.', 'Project the four requested columns and sort by TimeGenerated desc.', 'ConfigLog | where Setting == "Destination" | project TimeGenerated, Scope, Value, Actor | sort by TimeGenerated desc'],
    starter: 'ConfigLog | take 1',
    solution: 'ConfigLog | where Setting == "Destination" | project TimeGenerated, Scope, Value, Actor | sort by TimeGenerated desc',
    requiredOperators: ['where', 'project', 'sort'], ordered: true, evidenceTokens: ['packers', 'Archive', 'ops-demo'],
  },
];

/** Fresh synthetic content on a cloned existing map (Heartbeat Hills by default).
 * Signal Harbor and Relay Ruins can be supplied without importing either case.
 * Each terminal must have its own gate to its right in the same room.
 */
export function createCaseStarter(
  { id = 'starter', level: source = HEARTBEAT_HILLS }: { id?: string; level?: LevelDefinition } = {},
): CaseDefinition {
  const level = structuredClone(source);
  level.gateChars = Object.fromEntries(
    Object.keys(level.gateChars).map((char, index) => [char, `${id}-gate-${index + 1}`]),
  );
  const boards = [
    { title: 'Synthetic exercise', body: 'All rows and operators are fictional. The packers stopped delivering; cart-1 still works. The clock is fixed at 12:00 UTC on 1 September 2026.' },
    { title: 'Query field card', body: 'Start with a table. take samples, distinct inventories, where filters, project selects columns, summarize counts, sort orders.' },
    { title: 'Evidence before verdict', body: 'Check the affected scope, the exact diagnostic, and the preceding configuration change. Do not infer a cause from a timestamp alone.' },
  ];
  level.notes = level.notes.map((_, index) => ({ id: `${id}-note-${index + 1}`, ...boards[index % boards.length] }));
  const parsed = parseLevel(level);
  if (parsed.terminals.map(t => t.challengeIndex).sort().join(',') !== '0,1,2,3,4') {
    throw new Error(`${id}: starter map needs exactly one of each terminal 1–5`);
  }
  const challenges = structuredClone(lessons).map((lesson, index): ChallengeSpec => {
    const terminal = parsed.terminals.find(t => t.challengeIndex === index)!;
    const gate = parsed.gates.filter(g => g.roomIndex === terminal.roomIndex && g.x > terminal.x)
      .sort((a, b) => a.x - b.x)[0];
    if (!gate) throw new Error(`${id}: challenge ${index + 1} needs a gate to its right in its room`);
    return { ...lesson, id: `${id}-lesson-${index + 1}`, room: terminal.roomIndex,
      unlocksGate: gate.gateId, evidenceId: `${id}-evidence-${index + 1}`, points: 60 };
  });
  if (new Set(challenges.map(c => c.unlocksGate)).size !== 5) {
    throw new Error(`${id}: starter map needs a separate gate for every challenge`);
  }
  return {
    id, title: 'Parcel Practice', customer: 'Toy Parcel Lab (synthetic)',
    summary: 'Two toy packers fail after a destination change; a cart still delivers. Independent training data on a reused map.',
    placeholder: false, placeholderNotice: null,
    now: new Date('2026-09-01T12:00:00Z'), database,
    tableMeta: structuredClone(tableMeta), challenges,
    evidence: [
      { title: 'The packers previously delivered', detail: 'The first two stored attempts show packer-1 and packer-2 sending successfully to Live.', chainIndex: 0 },
      { title: 'Three observed devices', detail: 'Two packers and cart-1 appear in the complete delivery fixture.', chainIndex: 0 },
      { title: 'A named destination is unknown', detail: 'Both packers report Unknown destination: Archive during the last thirty minutes.', chainIndex: 2 },
      { title: 'All failures use Archive', detail: 'Three failed attempts share the Archive route. This counts attempts, not devices.', chainIndex: 2 },
      { title: 'The packers were redirected', detail: 'ops-demo changed the packers destination from Live to Archive at 11:35, before the first failure at 11:40.', chainIndex: 1 },
    ].map((item, index) => ({ ...item, id: `${id}-evidence-${index + 1}` })),
    rootCauses: [
      { id: `${id}-cause-route`, label: 'Invalid destination change', correct: true,
        detail: 'The packers were redirected to the unknown Archive destination; Live deliveries still work.' },
      { id: `${id}-cause-offline`, label: 'Both packers lost power',
        detail: 'Powered-off packers cannot deliver.',
        rebuttal: 'Both packers continue writing failed delivery attempts with an explicit unknown-destination error.' },
      { id: `${id}-cause-outage`, label: 'Every delivery destination is down',
        detail: 'A simulator-wide delivery outage would affect all three devices.',
        rebuttal: 'cart-1 successfully delivers to Live at 11:55. Only Archive attempts fail.' },
    ],
    causalChain: ['Packers successfully use Live', 'Destination changed to Archive for packers at 11:35', 'Unknown destination errors stop packer deliveries'],
    email: { from: 'dispatcher@parcel-lab.invalid', subject: 'Training simulation: packers cannot deliver',
      body: 'Our two toy packers stopped delivering around 11:40 UTC. The cart still works. Use the small synthetic logs to identify what changed and explain the scope.' },
    fleetSize: 3, skills: ['take', 'distinct', 'where', 'ago', 'project', 'summarize', 'count', 'sort'],
    debrief: { title: 'Destination typo, not a power outage',
      body: 'Archive was applied only to the packers at 11:35. Subsequent attempts explicitly reject that destination; cart-1 still sends to Live. The scope and diagnostic corroborate the change history.',
      followUp: 'Restore the packers destination to Live in the fictional simulator, then verify fresh successful deliveries. In a real incident, obtain approval and verify recovery rather than assuming rollback worked.' },
    level, musicTracks: [...ROOM_TRACKS],
  };
}

export const CASE_STARTER: CaseDefinition = createCaseStarter();
