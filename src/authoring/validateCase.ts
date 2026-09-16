import type { CaseDefinition, ColumnMeta } from '../data/cases/types';
import { requireDifficulty } from '../data/difficulties';
import { gradeChallenge } from '../kql/challenge';
import { runQuery, toDisplayString } from '../kql/index';
import type { Database } from '../kql/types';
import { parseLevel, ROOM_WIDTH, ROWS } from '../game/levels/heartbeatHills';
import { TRACKS } from '../game/music';
import { CURRICULUM_SOURCES } from '../data/curriculumSources';

function objectReferences(value: unknown, found = new Set<object>()): Set<object> {
  if (value === null || typeof value !== 'object' || found.has(value)) return found;
  found.add(value);
  for (const child of Object.values(value)) objectReferences(child, found);
  return found;
}

function validValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(child => validValue(child, ancestors));
  ancestors.delete(value);
  return valid;
}

function matchesType(value: unknown, type: ColumnMeta['type']): boolean {
  if (value === null) return true;
  switch (type) {
    case 'datetime': return value instanceof Date && Number.isFinite(value.getTime());
    case 'string': return typeof value === 'string';
    case 'int': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'real': return typeof value === 'number' && Number.isFinite(value);
    case 'bool': return typeof value === 'boolean';
    case 'dynamic': return validValue(value);
    default: return false;
  }
}

function snapshotSignature(value: unknown): string {
  // Plain JSON would make a Date indistinguishable from its ISO string.
  const encode = (entry: unknown): unknown => {
    if (entry instanceof Date) return ['date', entry.getTime()];
    if (Array.isArray(entry)) return ['array', entry.map(encode)];
    if (entry !== null && typeof entry === 'object') {
      return ['object', Object.entries(entry).map(([key, child]) => [key, encode(child)])];
    }
    return [typeof entry, entry];
  };
  return JSON.stringify(encode(value));
}

/** Validate trusted, locally authored content without changing it or the registry.
 * [] means no detected authoring errors, not proof of narrative truth or physics.
 * Queries execute in the shipped mini-engine; this is not a sandbox for untrusted code.
 */
export function validateCase(caseDef: CaseDefinition): string[] {
  const errors: string[] = [];
  const prefix = `Case ${caseDef?.id || '<missing id>'}${caseDef?.difficulty ? `:${caseDef.difficulty}` : ''}`;
  const check = (condition: unknown, message: string) => {
    if (!condition) errors.push(`${prefix}: ${message}`);
  };
  const text = (value: unknown, label: string) =>
    check(typeof value === 'string' && value.trim().length > 0, `${label} must be nonempty text`);
  const inspect = (label: string, fn: () => void) => {
    try { fn(); } catch (error) {
      errors.push(`${prefix}: ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const unique = (values: string[], label: string) => {
    values.forEach(value => {
      text(value, `${label} entry`);
      check(value === value.trim(), `${label} "${value}" must not have surrounding whitespace`);
    });
    check(new Set(values).size === values.length, `${label} must be unique`);
  };

  inspect('structure', () => {
    for (const key of ['id', 'title', 'customer', 'summary'] as const) text(caseDef[key], key);
    if (caseDef.difficulty !== undefined) requireDifficulty(caseDef.difficulty);
    if (caseDef.questionSetStatus !== undefined) {
      check(caseDef.difficulty !== undefined, 'questionSetStatus requires difficulty');
      check(['placeholder', 'ready'].includes(caseDef.questionSetStatus), 'questionSetStatus must be placeholder or ready');
      if (caseDef.questionSetStatus === 'placeholder') text(caseDef.questionSetNotice, 'questionSetNotice');
      if (caseDef.questionSetStatus === 'ready') check(caseDef.questionSetNotice === null, 'ready questionSetNotice must be null');
    } else {
      check(caseDef.questionSetNotice === undefined || caseDef.questionSetNotice === null, 'questionSetNotice requires questionSetStatus');
    }
    check(caseDef.id === caseDef.id.trim(), 'id must not have surrounding whitespace');
    check(typeof caseDef.placeholder === 'boolean', 'placeholder must be a boolean');
    if (caseDef.placeholder) text(caseDef.placeholderNotice, 'placeholderNotice');
    else check(caseDef.placeholderNotice === null, 'non-placeholder case must set placeholderNotice=null');
    for (const key of ['from', 'subject', 'body'] as const) text(caseDef.email[key], `email.${key}`);
    for (const key of ['title', 'body', 'followUp'] as const) text(caseDef.debrief[key], `debrief.${key}`);
    check(Number.isInteger(caseDef.fleetSize) && caseDef.fleetSize > 0, 'fleetSize must be a positive integer');
    check(caseDef.now instanceof Date && Number.isFinite(caseDef.now.getTime()), 'now must be a valid Date');
    check(caseDef.skills.length > 0, 'skills must not be empty');
    unique(caseDef.skills, 'skills');
    check(caseDef.causalChain.length > 0, 'causalChain must not be empty');
    caseDef.causalChain.forEach((value, index) => text(value, `causalChain[${index}]`));
    unique(caseDef.challenges.map(c => c.id), 'challenge ids');
    unique(caseDef.evidence.map(e => e.id), 'evidence ids');
    unique(caseDef.rootCauses.map(o => o.id), 'root cause ids');
    check(caseDef.challenges.length === 5, 'exactly five challenges are required: map terminals support only 1–5');
    check(caseDef.rootCauses.filter(o => o.correct === true).length === 1, 'exactly one root cause must be correct');
    check(caseDef.rootCauses.some(o => !o.correct), 'at least one incorrect root cause is required');
    for (const option of caseDef.rootCauses) {
      text(option.label, `root cause ${option.id} label`);
      text(option.detail, `root cause ${option.id} detail`);
      check(option.correct === undefined || typeof option.correct === 'boolean', `root cause ${option.id} correct must be a boolean`);
      if (!option.correct) text(option.rebuttal, `root cause ${option.id} rebuttal`);
    }
    for (const evidence of caseDef.evidence) {
      text(evidence.title, `evidence ${evidence.id} title`);
      text(evidence.detail, `evidence ${evidence.id} detail`);
      check(Number.isInteger(evidence.chainIndex) && evidence.chainIndex >= 0
        && evidence.chainIndex < caseDef.causalChain.length, `evidence ${evidence.id} chainIndex is outside causalChain`);
      check(caseDef.challenges.some(c => c.evidenceId === evidence.id), `evidence ${evidence.id} is not unlocked by any challenge`);
    }
  });

  inspect('level', () => {
    const { level } = caseDef;
    check(level.rooms.length > 0, 'level needs rooms');
    unique(level.rooms.map(r => r.name), 'room names');
    unique(level.notes.map(n => n.id), 'note ids');
    unique(Object.values(level.gateChars), 'gate ids');
    for (const [char] of Object.entries(level.gateChars)) {
      check(char.length === 1 && !' #=^fcE@VPn0123456789'.includes(char),
        `gate character "${char}" must be one nonreserved map character`);
    }
    const counts = new Map<string, number>();
    for (const room of level.rooms) {
      text(room.subtitle, `room ${room.name} subtitle`);
      check(Number.isInteger(room.tint) && room.tint >= 0 && room.tint <= 0xffffff, `room ${room.name} tint must be an RGB integer`);
      check(room.rows.length === ROWS, `room ${room.name} must have ${ROWS} rows`);
      for (const [rowIndex, row] of room.rows.entries()) {
        check(row.length <= ROOM_WIDTH, `room ${room.name} row ${rowIndex} exceeds ${ROOM_WIDTH} columns`);
        for (const char of row) {
          counts.set(char, (counts.get(char) ?? 0) + 1);
          check(' #=^fcE@VPn12345'.includes(char) || Object.hasOwn(level.gateChars, char),
            `room ${room.name} row ${rowIndex}: unsupported map character "${char}" (terminals are 1–5)`);
        }
      }
    }
    check(counts.get('P') === 1, 'map must contain exactly one spawn P');
    check(counts.get('V') === 1, 'map must contain exactly one verdict V');
    check((counts.get('n') ?? 0) === level.notes.length, 'note markers must match note definitions one-to-one');
    for (const note of level.notes) {
      text(note.title, `note ${note.id} title`);
      text(note.body, `note ${note.id} body`);
    }
    check(caseDef.musicTracks.length === level.rooms.length, 'musicTracks must supply one track per room');
    for (const track of caseDef.musicTracks) check(Object.hasOwn(TRACKS, track), `unknown music track "${track}"`);
    // Avoid parseLevel's note fallback masking a missing note definition.
    if ((counts.get('n') ?? 0) !== level.notes.length) return;
    const parsed = parseLevel(level);
    check(parsed.terminals.map(t => t.challengeIndex).sort().join(',') === '0,1,2,3,4',
      'map must contain exactly one of each terminal 1–5 (challenge indices 0–4)');
    for (const [index, challenge] of caseDef.challenges.entries()) {
      const label = `challenge ${challenge.id}`;
      const terminal = parsed.terminals.find(t => t.challengeIndex === index);
      check(terminal?.roomIndex === challenge.room, `${label} room must match terminal ${index + 1}`);
      const gates = parsed.gates.filter(g => g.gateId === challenge.unlocksGate);
      check(gates.length > 0, `${label} unlocksGate "${challenge.unlocksGate}" has no map cells`);
      check(gates.every(g => g.roomIndex === challenge.room), `${label} gate must be in its terminal's room`);
      if (terminal && gates.length) {
        const nextGate = parsed.gates.filter(g => g.roomIndex === terminal.roomIndex && g.x > terminal.x)
          .sort((a, b) => a.x - b.x)[0];
        check(nextGate?.gateId === challenge.unlocksGate, `${label} must unlock the next gate to the right of its terminal`);
      }
    }
    for (const gateId of Object.values(level.gateChars)) {
      check(parsed.gates.some(g => g.gateId === gateId), `gate ${gateId} has no map cells`);
      check(caseDef.challenges.filter(c => c.unlocksGate === gateId).length === 1,
        `gate ${gateId} must be unlocked by exactly one challenge`);
    }
  });

  let db: Database | undefined;
  let snapshot = '';
  inspect('database/schema', () => {
    const first = caseDef.database();
    const second = caseDef.database();
    check(first !== null && typeof first === 'object' && !Array.isArray(first), 'database() must return a table dictionary');
    const firstRefs = objectReferences(first);
    check(![...objectReferences(second)].some(ref => firstRefs.has(ref)),
      'database() must return fresh snapshots, including tables, columns, rows, Dates and dynamic values');
    check(!firstRefs.has(caseDef.now), 'database timestamps must not share the mutable case now Date');
    snapshot = snapshotSignature(first);
    check(snapshot === snapshotSignature(second), 'database() must return deterministic snapshots');
    const names = Object.keys(first);
    check(names.length > 0, 'database must contain at least one table');
    unique(caseDef.tableMeta.map(t => t.name), 'table metadata names');
    check(names.length === caseDef.tableMeta.length && names.every(name => caseDef.tableMeta.some(t => t.name === name)),
      'tableMeta must describe every database table exactly once');
    for (const [name, table] of Object.entries(first)) {
      text(name, 'database table name');
      check(table.name === name, `table ${name}: name must match its database key`);
      unique(table.columns, `table ${name} columns`);
      check(table.columns.length > 0, `table ${name}: columns must not be empty`);
      check(Array.isArray(table.rows), `table ${name}: rows must be an array`);
      const meta = caseDef.tableMeta.find(t => t.name === name);
      if (!meta) continue;
      text(meta.doc, `table ${name} doc`);
      unique(meta.columns.map(c => c.name), `table ${name} metadata columns`);
      check(meta.columns.length === table.columns.length && meta.columns.every(c => table.columns.includes(c.name)),
        `table ${name}: metadata columns must match database columns`);
      for (const column of meta.columns) {
        text(column.doc, `table ${name}.${column.name} doc`);
        check(['datetime', 'string', 'int', 'real', 'bool', 'dynamic'].includes(column.type), `table ${name}.${column.name}: unsupported metadata type "${column.type}"`);
      }
      for (const [index, row] of table.rows.entries()) {
        const label = `table ${name} row ${index}`;
        check(row !== null && typeof row === 'object' && !Array.isArray(row), `${label} must be a column/value object`);
        check(Object.keys(row).length === table.columns.length && table.columns.every(c => Object.hasOwn(row, c)),
          `${label}: keys must match declared columns (use null for missing values)`);
        for (const column of meta.columns) check(matchesType(row[column.name], column.type),
          `${label}.${column.name}: expected ${column.type} value (datetime values must be valid Dates)`);
      }
    }
    db = first;
  });

  inspect('challenges', () => {
    for (const challenge of caseDef.challenges) inspect(`challenge ${challenge.id}`, () => {
      const label = `challenge ${challenge.id}`;
      for (const key of ['prompt', 'teaches', 'solution'] as const) text(challenge[key], `${label} ${key}`);
      if (challenge.flavour !== undefined) text(challenge.flavour, `${label} flavour`);
      for (const key of ['title', 'body', 'pattern'] as const) text(challenge.concept[key], `${label} concept.${key}`);
      text(challenge.concept.example.query, `${label} worked example query`);
      text(challenge.concept.example.explain, `${label} worked example explanation`);
      check(typeof challenge.starter === 'string', `${label} starter must be text (empty is allowed)`);
      check(Number.isInteger(challenge.room) && challenge.room >= 0 && challenge.room < caseDef.level.rooms.length,
        `${label} room is outside the level`);
      check(Number.isInteger(challenge.points) && challenge.points > 0, `${label} points must be a positive integer`);
      check(challenge.ordered === undefined || typeof challenge.ordered === 'boolean', `${label} ordered must be a boolean`);
      check(challenge.hints.length >= 3, `${label} needs progressive hints ending in a complete query (at least three)`);
      unique(challenge.hints, `${label} hints`);
      if (challenge.requiredOperators) unique(challenge.requiredOperators, `${label} requiredOperators`);
      if (challenge.forbiddenOperators) unique(challenge.forbiddenOperators, `${label} forbiddenOperators`);
      if (challenge.evidenceTokens) unique(challenge.evidenceTokens, `${label} evidenceTokens`);
      if (challenge.sourceIds) {
        check(challenge.sourceIds.length > 0, `${label} sourceIds must not be empty`);
        unique(challenge.sourceIds, `${label} sourceIds`);
        for (const id of challenge.sourceIds) {
          check(CURRICULUM_SOURCES.some(source => source.id === id), `${label} unknown attribution source "${id}"`);
        }
      }
      check(caseDef.evidence.some(e => e.id === challenge.evidenceId), `${label} evidenceId "${challenge.evidenceId}" must link to evidence`);
      if (!db || !(caseDef.now instanceof Date) || !Number.isFinite(caseDef.now.getTime())) return;
      inspect(`${label} solution`, () => {
        const result = runQuery(challenge.solution, db!, { now: caseDef.now });
        check(result.table.columns.length > 0 && result.table.rows.length > 0, `${label} solution must return evidence rows and columns`);
        const grade = gradeChallenge(challenge, challenge.solution, db!, caseDef.now);
        check(grade.status === 'correct', `${label} solution is not accepted: ${grade.message}`);
        const cells = result.table.rows.flatMap(row => result.table.columns.map(c => toDisplayString(row[c] ?? null)));
        for (const token of challenge.evidenceTokens ?? []) {
          check(cells.some(cell => cell.includes(token)), `${label} evidence token "${token}" is absent from solution output values`);
        }
      });
      inspect(`${label} worked example`, () => {
        const example = runQuery(challenge.concept.example.query, db!, { now: caseDef.now }).table;
        check(challenge.concept.example.allowEmpty === undefined || typeof challenge.concept.example.allowEmpty === 'boolean',
          `${label} example allowEmpty must be a boolean`);
        check(example.columns.length > 0 && (example.rows.length > 0 || challenge.concept.example.allowEmpty === true),
          `${label} worked example must return rows and columns (or explicitly declare allowEmpty for a zero-row lesson)`);
      });
      inspect(`${label} final hint`, () => {
        const grade = gradeChallenge(challenge, challenge.hints.at(-1) ?? '', db!, caseDef.now);
        check(grade.status === 'correct', `${label} final hint is not accepted: ${grade.message}`);
      });
      inspect(`${label} starter`, () => {
        const grade = gradeChallenge(challenge, challenge.starter, db!, caseDef.now);
        check(grade.status !== 'correct', `${label} starter is already accepted; leave work for the learner`);
      });
    });
  });
  if (db) inspect('database after queries', () => {
    check(snapshotSignature(db) === snapshot, 'authoring queries must not mutate the database snapshot');
    check(snapshotSignature(caseDef.database()) === snapshot, 'database() changed after authoring queries');
  });
  return errors;
}
