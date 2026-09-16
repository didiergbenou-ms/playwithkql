import { CHALLENGES } from '../case001';
import type { CaseDefinition, RootCauseOption } from '../cases/types';
import { buildCaseSkills, cloneLevel } from '../cases/placeholder';
import type { QuestionSet } from '../questions/types';
import type { LevelDefinition } from '../../game/levels/heartbeatHills';
import { ROOM_TRACKS } from '../../game/music';
import { buildCurriculumDatabase, curriculumNow, curriculumTableMeta } from './dataset';

const briefs: Record<string, { summary: string; focus: string; debrief: string; boards: { title: string; body: string }[] }> = {
  '001': {
    summary: 'Five of twelve machines stop reporting after 09:15Z on March 11. Establish the scope and inspect the changed outbound path.',
    focus: 'Count observations carefully, separate missing telemetry from a stopped machine, and inspect the production network ticket.',
    debrief: 'Five machines share a final heartbeat at 09:15Z, while seven continue to 11:55Z. The supplied audit has a 09:12Z security-rule write. The explicitly synthetic ticket enrichment records the outbound Allow-to-Deny transition on port 443 for those five hosts.',
    boards: [
      { title: 'Dispatch — March 11 visibility gap', body: 'The investigation clock is fixed at 2026-03-11 12:00Z. Twelve machines belong to the Heartbeat fleet. The provided independent Perf export continues after heartbeat loss; that is not proof that workspace delivery recovered.' },
      { title: 'Observations are not machines', body: 'Heartbeat normally samples every five minutes. count() measures rows; dcount(Computer) measures identities. A host can appear in a three-hour window and still stop reporting near its beginning.' },
      { title: 'Ticket enrichment — explicitly synthetic', body: 'NetworkChanges is locally authored context around the supplied 09:12Z AzureActivity row. CHG-4471 replaces allow-oms-outbound with deny-all-outbound for port 443 in a five-host scope. Treat this as the lab’s configuration evidence, not a production packet capture.' },
    ],
  },
  '002': {
    summary: 'Trace a six-message network symptom back to the 09:12Z production NSG write without mistaking an approved administrator for an attacker.',
    focus: 'Locate the symptom, compare the timeline, and attribute the network change to the correct resource and account.',
    debrief: 'Six Syslog symptom records span 09:13:47Z–09:15:44Z. Dana’s successful security-rule write occurs at 09:12Z on nsg-prod-outbound; the synthetic ticket supplies the outbound Deny/443 mechanism. The sign-in enrichment is normal administrator context, not evidence of account compromise.',
    boards: [
      { title: 'Search, then narrow', body: 'A search can discover the table; a table-specific filter keeps the evidence precise. Here contains "mismatch" also matches fourteen decoys. The local tokenizer treats MTU_MISMATCH as one term; SECURITYRULES/WRITE is not one term.' },
      { title: 'Know the export boundary', body: 'PRD-NET-FW01 appears in Syslog but is not in the twelve-machine Heartbeat fleet. Do not claim the firewall kept sending heartbeats. The six symptom messages are clues, not a demonstrated MTU root cause.' },
      { title: 'Approved does not mean harmless', body: 'The synthetic sign-in and change-ticket enrichment marks Dana as an approved administrator. An approved action can still block the required outbound path. Match the account, timestamp and full resource identifier before escalating.' },
    ],
  },
  '003': {
    summary: 'Shape the independent performance export, challenge the CPU red herring, and close the same March 11 network-path incident.',
    focus: 'Keep counter units separate, preserve the order of events, and distinguish a measured visibility gap from application downtime.',
    debrief: 'The five largest CPU readings include two at 09:00Z, twelve minutes before the rule write. Those earlier peaks cannot be effects of that later change; the 09:15Z peaks alone do not prove retries or CPU starvation. The stronger evidence is the explicit outbound rule transition and matching five-host scope, followed by the shared heartbeat cutoff.',
    boards: [
      { title: 'Independent does not mean recovered', body: 'Perf contains 3,456 samples: twelve machines, three counters and 96 quarter-hour slots. It is an independent export. Its continued observations do not contradict a broken workspace heartbeat path.' },
      { title: 'Put timestamps before the verdict', body: 'PRD-WEB-01 and PRD-WEB-02 have their largest CPU samples at 09:00Z; the rule write is at 09:12Z. High CPU is not proof of a retry storm. Preserve negative time offsets and compare configuration evidence before assigning cause.' },
      { title: 'Close with a verification plan', body: 'The latest supplied production snapshot is CHG-4471, with Deny on port 443 and no recorded rollback. Recommend a reviewed restoration of required outbound access, then verify fresh heartbeats. The fixture contains no recovery test result.' },
    ],
  },
};

const rootOptions: RootCauseOption[] = [
  {
    id: 'rc-cap', label: 'A workspace-wide ingestion stop', detail: 'All telemetry delivery stopped because the workspace reached a cap.',
    rebuttal: 'Seven machines continue sending heartbeats to 11:55Z. This is a selective five-host gap, and the dataset does not provide a daily-cap setting.',
  },
  {
    id: 'rc-deallocated', label: 'All five machines powered off', detail: 'A simultaneous shutdown explains the missing heartbeats.',
    rebuttal: 'The independent Perf export continues for those machines after 09:15Z. Missing Heartbeat rows alone cannot establish power state.',
  },
  {
    // Preserve the stored choice identity; its old proxy label is deliberately replaced.
    id: 'rc-proxy', label: 'NSG change blocked the required outbound path',
    detail: 'The 09:12Z production security-rule write is linked to an authored Allow-to-Deny/443 ticket affecting the five hosts last seen at 09:15Z.',
    correct: true,
  },
  {
    id: 'rc-agent-version', label: 'The largest CPU readings prove CPU caused the gap',
    detail: 'High CPU values alone establish that the agents were starved.',
    rebuttal: 'Two of the largest readings precede the 09:12Z change. Ranking CPU does not establish causation; the ticket gives explicit network-path evidence.',
  },
  {
    id: 'rc-dcr', label: 'The data collection rule was deleted',
    detail: 'A collection-rule deletion removed the agents’ instructions.',
    rebuttal: 'The incident audit operation is a NETWORKSECURITYGROUPS/SECURITYRULES/WRITE, not a collection-rule deletion. The ticket describes an outbound deny rule.',
  },
];

/** Keep map geometry and persistent wiring identities; replace all playable legacy lesson/story text. */
export function createCurriculumCase(id: string, title: string, sourceLevel: LevelDefinition, beginner: QuestionSet): CaseDefinition {
  const brief = briefs[id];
  if (!brief || beginner.caseId !== id) throw new Error(`Missing curriculum narrative for ${id}`);
  const prefix = id === '001' ? '' : `case${id}-`;
  const level = cloneLevel(sourceLevel);
  level.notes = level.notes.map((note, index) => ({ id: note.id, ...brief.boards[index] }));
  level.rooms = level.rooms.map((room, index) => ({
    ...room,
    subtitle: [
      'March 11 — incident intake',
      'Separate observations from assumptions',
      'Correlate time, scope and configuration',
      'Review the path and verify recovery',
    ][index],
  }));
  const challenges = CHALLENGES.map((wiring, index) => ({
    ...structuredClone(beginner.slots[index].lesson),
    id: `${prefix}${wiring.id}`, room: wiring.room, points: wiring.points,
    evidenceId: `${prefix}${wiring.evidenceId}`,
    unlocksGate: wiring.unlocksGate ? `${prefix}${wiring.unlocksGate}` : undefined,
  }));
  return {
    id, title, customer: 'Contoso — synthetic incident lab',
    summary: brief.summary, placeholder: false, placeholderNotice: null,
    get now() { return curriculumNow(); },
    database: buildCurriculumDatabase, tableMeta: curriculumTableMeta(),
    challenges,
    evidence: beginner.slots.map((slot, index) => ({ ...slot.evidence, id: challenges[index].evidenceId })),
    rootCauses: rootOptions.map(option => ({ ...option, id: `${prefix}${option.id}` })),
    causalChain: [
      '09:12Z: production NSG write attributed to Dana',
      'Synthetic ticket: outbound Allow replaced by Deny on port 443 for five hosts',
      '09:15Z: shared last heartbeat; seven other hosts continue',
      'Independent performance evidence continues; restore the reviewed path and verify fresh heartbeats',
    ],
    email: {
      from: 'j.alvarez@contoso.com',
      subject: `${title} — March 11 monitoring visibility incident`,
      body: `Our twelve-machine fleet has a selective monitoring gap. Five machines have no heartbeat after 09:15Z on March 11, while seven continue reporting.\n\n${brief.focus}\n\nThe lab includes Heartbeat, Syslog, AzureActivity and an independent Perf export. NetworkChanges and SigninLogs are explicitly synthetic enrichment for this training adaptation. Do not infer a compromised account, a firewall crash or a tested recovery from these records.`,
    },
    fleetSize: 12, skills: buildCaseSkills(challenges),
    debrief: {
      title: 'Production NSG change blocked the outbound monitoring path',
      body: brief.debrief,
      followUp: 'Review CHG-4471 and restore the required outbound access through change control. Confirm new heartbeats for all twelve machines and inspect the exact affected NSG scope. No recovery has been executed or verified in this offline dataset.',
    },
    level, musicTracks: [...ROOM_TRACKS],
  };
}
