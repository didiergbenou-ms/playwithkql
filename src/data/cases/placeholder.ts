import type { ChallengeSpec } from '../../kql/challenge';
import type { Database, KValue, Row, Table } from '../../kql/types';
import { ROOM_TRACKS, type TrackId } from '../../game/music';
import { ROWS, parseLevel, type LevelDefinition } from '../../game/levels/heartbeatHills';
import {
  CASE_NOW,
  CAUSAL_CHAIN,
  CHALLENGES,
  CUSTOMER_EMAIL,
  EVIDENCE,
  MACHINES,
  ROOT_CAUSES,
  TABLE_META,
  buildDatabase,
  type Evidence,
  type RootCauseOption,
  type TableMeta,
} from '../case001';
import type { CaseDefinition } from './types';

const REQUIRED_ROOM_SEQUENCE = '0,1,2,2,3';

export function cloneKValue(value: KValue): KValue {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map((entry) => cloneKValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneKValue(entry as KValue)]),
    );
  }
  return value;
}

function cloneRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cloneKValue(value)]));
}

export function cloneDatabase(database: Database = buildDatabase()): Database {
  return Object.fromEntries(
    Object.entries(database).map(([name, table]): [string, Table] => [
      name,
      {
        name: table.name,
        columns: [...table.columns],
        rows: table.rows.map(cloneRow),
      },
    ]),
  );
}

export function cloneTableMeta(meta: TableMeta[]): TableMeta[] {
  return meta.map((table) => ({
    name: table.name,
    doc: table.doc,
    columns: table.columns.map((column) => ({ ...column })),
  }));
}

export function cloneChallenges(challenges: ChallengeSpec[]): ChallengeSpec[] {
  return structuredClone(challenges);
}

export function cloneEvidence(evidence: Evidence[]): Evidence[] {
  return evidence.map((item) => ({ ...item }));
}

export function cloneRootCauses(rootCauses: RootCauseOption[]): RootCauseOption[] {
  return rootCauses.map((option) => ({ ...option }));
}

export function cloneLevel(level: LevelDefinition): LevelDefinition {
  return {
    rooms: level.rooms.map((room) => ({ ...room, rows: [...room.rows] })),
    notes: level.notes.map((note) => ({ ...note })),
    gateChars: { ...level.gateChars },
  };
}

export function buildCaseSkills(challenges: ChallengeSpec[]): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const challenge of challenges) {
    for (const op of challenge.requiredOperators ?? []) {
      if (seen.has(op)) continue;
      seen.add(op);
      skills.push(op);
    }
  }
  return skills;
}

function expectPrefixed(values: string[], prefix: string, label: string) {
  for (const value of values) {
    if (!value.startsWith(prefix)) throw new Error(`${label}: "${value}" must start with "${prefix}"`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label}: ids must be unique`);
}

function validatePlaceholderCase(definition: CaseDefinition, prefix: string) {
  if (!definition.placeholder) throw new Error(`${definition.id}: placeholder cases must set placeholder=true`);
  if (!definition.placeholderNotice) throw new Error(`${definition.id}: placeholder notice is required`);
  if (!definition.placeholderNotice.includes('Case 001')) {
    throw new Error(`${definition.id}: placeholder notice must name the reused Case 001 content`);
  }

  const rooms = definition.challenges.map((challenge) => challenge.room).join(',');
  if (rooms !== REQUIRED_ROOM_SEQUENCE) {
    throw new Error(`${definition.id}: expected room sequence ${REQUIRED_ROOM_SEQUENCE}, got ${rooms}`);
  }

  expectPrefixed(definition.challenges.map((challenge) => challenge.id), prefix, `${definition.id} challenge ids`);
  expectPrefixed(definition.evidence.map((item) => item.id), prefix, `${definition.id} evidence ids`);
  expectPrefixed(definition.rootCauses.map((option) => option.id), prefix, `${definition.id} root cause ids`);
  expectPrefixed(definition.level.notes.map((note) => note.id), prefix, `${definition.id} note ids`);
  expectPrefixed(Object.values(definition.level.gateChars), prefix, `${definition.id} gate ids`);

  const evidenceIds = new Set(definition.evidence.map((item) => item.id));
  const gateIds = new Set(Object.values(definition.level.gateChars));
  for (const challenge of definition.challenges) {
    if (challenge.evidenceId && !evidenceIds.has(challenge.evidenceId)) {
      throw new Error(`${definition.id}: ${challenge.id} points at missing evidence ${challenge.evidenceId}`);
    }
    if (challenge.unlocksGate && !gateIds.has(challenge.unlocksGate)) {
      throw new Error(`${definition.id}: ${challenge.id} points at missing gate ${challenge.unlocksGate}`);
    }
  }

  const parsed = parseLevel(definition.level);
  if (parsed.terminals.length !== definition.challenges.length) {
    throw new Error(`${definition.id}: expected ${definition.challenges.length} terminals, got ${parsed.terminals.length}`);
  }
  const challengeIndices = parsed.terminals
    .map((terminal) => terminal.challengeIndex)
    .sort((a, b) => a - b)
    .join(',');
  if (challengeIndices !== '0,1,2,3,4') {
    throw new Error(`${definition.id}: terminal challenge indices are ${challengeIndices}`);
  }
  if (parsed.notes.length !== definition.level.notes.length) {
    throw new Error(`${definition.id}: note markers (${parsed.notes.length}) do not match note definitions (${definition.level.notes.length})`);
  }
  if (parsed.verdict === null) throw new Error(`${definition.id}: verdict console is missing`);

  const checkpointRooms = new Set(parsed.checkpoints.map((checkpoint) => checkpoint.roomIndex));
  if (checkpointRooms.size !== definition.level.rooms.length) {
    throw new Error(`${definition.id}: every room needs a checkpoint`);
  }

  const gatesById = new Map<string, number[]>();
  for (const gate of parsed.gates) {
    const rows = gatesById.get(gate.gateId);
    if (rows) rows.push(gate.row);
    else gatesById.set(gate.gateId, [gate.row]);
  }
  for (const [gateId, rowsForGate] of gatesById) {
    const uniqueRows = [...new Set(rowsForGate)].sort((a, b) => a - b);
    if (uniqueRows[0] !== 0) throw new Error(`${definition.id}: ${gateId} must start at row 0`);
    const bottom = uniqueRows[uniqueRows.length - 1];
    if (bottom >= ROWS - 1) throw new Error(`${definition.id}: ${gateId} must end at the floor, not below it`);
    for (let row = 0; row <= bottom; row++) {
      if (!uniqueRows.includes(row)) throw new Error(`${definition.id}: ${gateId} has a gap at row ${row}`);
    }
  }
}

function prefixedEmail(subject: string, body: string) {
  return {
    from: 'prototype.range@kingdom-of-signals.invalid',
    subject,
    body,
  };
}

export interface PlaceholderCaseOptions {
  id: string;
  title: string;
  customer: string;
  summary: string;
  placeholderNotice: string;
  level: LevelDefinition;
  emailSubject: string;
  emailBody: string;
  debriefTitle: string;
  debriefBody: string;
  debriefFollowUp: string;
  musicTracks?: TrackId[];
}

export function createPlaceholderCase(options: PlaceholderCaseOptions): CaseDefinition {
  const prefix = `case${options.id}-`;

  const challenges = cloneChallenges(CHALLENGES).map((challenge) => ({
    ...challenge,
    id: `${prefix}${challenge.id}`,
    evidenceId: challenge.evidenceId ? `${prefix}${challenge.evidenceId}` : undefined,
    unlocksGate: challenge.unlocksGate ? `${prefix}${challenge.unlocksGate}` : undefined,
  }));

  const evidence = cloneEvidence(EVIDENCE).map((item) => ({
    ...item,
    id: `${prefix}${item.id}`,
  }));

  const rootCauses = cloneRootCauses(ROOT_CAUSES).map((option) => ({
    ...option,
    id: `${prefix}${option.id}`,
  }));

  const definition: CaseDefinition = {
    id: options.id,
    title: options.title,
    customer: options.customer,
    summary: options.summary,
    placeholder: true,
    placeholderNotice: options.placeholderNotice,
    now: new Date(CASE_NOW.getTime()),
    database: () => cloneDatabase(buildDatabase()),
    tableMeta: cloneTableMeta(TABLE_META),
    challenges,
    evidence,
    rootCauses,
    causalChain: [...CAUSAL_CHAIN],
    email: prefixedEmail(options.emailSubject, options.emailBody),
    fleetSize: MACHINES.length,
    skills: buildCaseSkills(challenges),
    debrief: {
      title: options.debriefTitle,
      body: options.debriefBody,
      followUp: options.debriefFollowUp,
    },
    level: cloneLevel(options.level),
    musicTracks: [...(options.musicTracks ?? ROOM_TRACKS)],
  };

  validatePlaceholderCase(definition, prefix);
  return definition;
}

export function createCase001Email() {
  return { ...CUSTOMER_EMAIL };
}
