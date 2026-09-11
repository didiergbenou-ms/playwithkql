import { gradeChallenge } from '../src/kql/challenge';
import { runQuery } from '../src/kql/index';
import { CHARACTERS } from '../src/game/characters';
import { analyse } from '../src/game/reach';
import {
  HEARTBEAT_HILLS,
  ROOM_WIDTH,
  ROWS,
  parseLevel,
} from '../src/game/levels/heartbeatHills';
import { SIGNAL_HARBOR } from '../src/game/levels/signalHarbor';
import { RELAY_RUINS } from '../src/game/levels/relayRuins';
import { CASE001 } from '../src/data/cases/case001';
import { CASE002 } from '../src/data/cases/case002';
import { CASE003 } from '../src/data/cases/case003';
import { CASES, DEFAULT_CASE_ID, getCase } from '../src/data/cases';

let passed = 0;
const failures: string[] = [];
const reachReports: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const CASE_LIST = [CASE001, CASE002, CASE003] as const;

function roomSignature(rows: string[]) {
  return rows.map((row) => row.padEnd(ROOM_WIDTH, ' ')).join('\n');
}

check('registry: exposes three case ids and keeps 001 as default', () => {
  eq(DEFAULT_CASE_ID, '001', 'default case');
  eq(CASES.length, 3, 'case count');
  eq(CASES.map((item) => item.id).join(','), '001,002,003', 'case ids');
});

check('registry: getCase throws on an unknown id', () => {
  try {
    getCase('999');
    throw new Error('should have thrown');
  } catch (err) {
    assert(String(err).includes('Unknown case id'), 'missing unknown-id error');
  }
});

check('registry: definitions are stable and cases do not share mutable lesson state', () => {
  const a = getCase('002');
  const b = getCase('003');
  assert(a === getCase('002'), 'case identity changes on every lookup');
  assert(a.challenges !== b.challenges, 'challenge array is shared');
  assert(a.level !== b.level, 'level object is shared');
  for (let i = 0; i < a.challenges.length; i++) {
    assert(a.challenges[i].concept !== b.challenges[i].concept, 'concept objects are shared');
    assert(a.challenges[i].hints !== b.challenges[i].hints, 'hints are shared');
    assert(a.challenges[i].requiredOperators !== b.challenges[i].requiredOperators, 'operator arrays are shared');
    assert(a.challenges[i].evidenceTokens !== b.challenges[i].evidenceTokens, 'evidence tokens are shared');
  }

  const db = a.database();
  const rowCount = db.Heartbeat.rows.length;
  db.Heartbeat.rows.pop();
  eq(getCase('002').database().Heartbeat.rows.length, rowCount, 'database clone row count');
});

check('case001 adapter: preserves shipped flags and debrief intent', () => {
  eq(CASE001.placeholder, false, 'case001 placeholder');
  eq(CASE001.placeholderNotice, null, 'case001 placeholder notice');
  eq(CASE001.email.from, 'j.alvarez@contoso.com', 'case001 email from');
  assert(CASE001.debrief.title.includes('Proxy'), 'case001 debrief title');
  assert(!CASE001.debrief.followUp.includes('that is Case 002'), 'follow-up must not claim case002 already teaches parse_json');
});

for (const item of [CASE002, CASE003]) {
  check(`${item.id}: placeholder metadata is explicit and honest`, () => {
    assert(item.placeholder, 'placeholder flag should be true');
    assert(item.placeholderNotice?.includes('Case 001'), 'placeholder notice must name the reused Case 001 content');
    assert(item.summary.includes('Case 001') || item.summary.includes('Heartbeat Hills'), 'summary must mention the reuse');
    assert(!item.debrief.followUp.includes('that is Case 002'), 'follow-up must not claim case002 already teaches parse_json');
  });
}

check('levels: parseLevel() default is unchanged', () => {
  const legacy = parseLevel();
  const explicit = parseLevel(HEARTBEAT_HILLS);
  eq(legacy.width, explicit.width, 'width');
  eq(legacy.totalFragments, explicit.totalFragments, 'fragments');
  eq(legacy.totalCrystals, explicit.totalCrystals, 'crystals');
  eq(legacy.spawn.x, explicit.spawn.x, 'spawn.x');
  eq(legacy.spawn.y, explicit.spawn.y, 'spawn.y');
  eq(legacy.rooms.map((room) => room.name).join(','), explicit.rooms.map((room) => room.name).join(','), 'room names');
  eq(legacy.gates.map((gate) => gate.gateId).join(','), explicit.gates.map((gate) => gate.gateId).join(','), 'gate ids');
  eq(legacy.notes.map((note) => note.noteId).join(','), explicit.notes.map((note) => note.noteId).join(','), 'note ids');
});

for (const item of CASE_LIST) {
  check(`${item.id}: reference queries, examples, and final hints all work`, () => {
    const db = item.database();
    for (const challenge of item.challenges) {
      const solved = gradeChallenge(challenge, challenge.solution, db, item.now);
      eq(solved.status, 'correct', `${challenge.id} reference solution`);

      const finalHint = challenge.hints[challenge.hints.length - 1];
      const hinted = gradeChallenge(challenge, finalHint, db, item.now);
      eq(hinted.status, 'correct', `${challenge.id} final hint`);

      const example = runQuery(challenge.concept.example.query, db, { now: item.now }).table;
      assert(example.columns.length > 0, `${challenge.id} example returned no columns`);
    }
  });

  check(`${item.id}: ids, links, and room sequence stay consistent`, () => {
    eq(item.challenges.map((challenge) => challenge.room).join(','), '0,1,2,2,3', 'room indices');
    eq(item.rootCauses.filter((option) => option.correct).length, 1, 'correct root cause count');

    const evidenceIds = new Set(item.evidence.map((evidence) => evidence.id));
    const gateIds = new Set(Object.values(item.level.gateChars));
    for (const challenge of item.challenges) {
      if (challenge.evidenceId) assert(evidenceIds.has(challenge.evidenceId), `${challenge.id} missing evidence`);
      if (challenge.unlocksGate) assert(gateIds.has(challenge.unlocksGate), `${challenge.id} missing gate`);
    }
  });

  check(`${item.id}: authored map stays within limits and keeps expected markers`, () => {
    const level = parseLevel(item.level);
    eq(item.level.rooms.length, 4, 'room count');
    eq(level.terminals.length, 5, 'terminal count');
    eq(level.checkpoints.length, item.id === '001' ? 3 : 4, 'checkpoint count');
    eq(level.notes.length, 3, 'note marker count');
    assert(level.verdict !== null, 'verdict console missing');
    eq(new Set(level.gates.map((gate) => gate.gateId)).size, 5, 'unique gate count');
    eq(
      level.terminals
        .slice()
        .sort((left, right) => left.challengeIndex - right.challengeIndex)
        .map((terminal) => terminal.roomIndex)
        .join(','),
      '0,1,2,2,3',
      'terminal room sequence',
    );
    eq(level.notes.map((note) => note.noteId).join(','), item.level.notes.map((note) => note.id).join(','), 'note ids');

    for (const room of item.level.rooms) {
      eq(room.rows.length, ROWS, `${room.name} row count`);
      for (const row of room.rows) {
        assert(row.length <= ROOM_WIDTH, `${room.name} has an overlong row (${row.length})`);
      }
    }
  });

  check(`${item.id}: interactables and checkpoints sit directly on a surface`, () => {
    const level = parseLevel(item.level);
    const surfaces = new Set([...level.solids, ...level.platforms].map(c => `${c.col},${c.row}`));
    const important = [
      ...level.checkpoints,
      ...level.terminals,
      ...level.notes,
      ...(level.verdict ? [level.verdict] : []),
    ];
    for (const target of important) {
      assert(
        surfaces.has(`${target.col},${target.row + 1}`),
        `${target.char} at ${target.col},${target.row} has no surface directly underneath`,
      );
    }
  });

  check(`${item.id}: each gate is a continuous column sealed to the floor`, () => {
    const level = parseLevel(item.level);
    const solids = new Set(level.solids.map(c => `${c.col},${c.row}`));
    for (const challenge of item.challenges) {
      const gate = level.gates.filter(g => g.gateId === challenge.unlocksGate);
      assert(gate.length > 0, `${challenge.id}: missing gate`);
      eq(new Set(gate.map(g => g.col)).size, 1, `${challenge.id}: gate column alignment`);
      const rows = gate.map(g => g.row).sort((a,b) => a-b);
      eq(rows[0], 0, `${challenge.id}: gate must reach ceiling`);
      for (let i = 0; i < rows.length; i++) eq(rows[i], i, `${challenge.id}: gap in gate`);
      assert(solids.has(`${gate[0].col},${rows.at(-1)! + 1}`), `${challenge.id}: gate has no sealed floor`);
      const terminal = level.terminals.find(t => item.challenges[t.challengeIndex].id === challenge.id)!;
      assert(terminal.x < gate[0].x, `${challenge.id}: terminal is behind its own gate`);
    }
    assert(
      level.verdict!.x > Math.max(...level.gates.map(g => g.x)),
      `${item.id}: verdict is not beyond the final gate`,
    );
  });
}

check('geometry: both new cases differ from Heartbeat Hills and from each other', () => {
  const baseRooms = HEARTBEAT_HILLS.rooms.map((room) => roomSignature(room.rows));
  const harborRooms = SIGNAL_HARBOR.rooms.map((room) => roomSignature(room.rows));
  const ruinsRooms = RELAY_RUINS.rooms.map((room) => roomSignature(room.rows));

  for (let i = 0; i < 4; i++) {
    assert(harborRooms[i] !== baseRooms[i], `Signal Harbor room ${i + 1} matches Heartbeat Hills`);
    assert(ruinsRooms[i] !== baseRooms[i], `Relay Ruins room ${i + 1} matches Heartbeat Hills`);
    assert(ruinsRooms[i] !== harborRooms[i], `new cases share room ${i + 1} geometry`);
  }
});

check('reachability: every shipped character can clear the new placeholder cases', () => {
  for (const item of [CASE002, CASE003]) {
    const level = parseLevel(item.level);
    for (const character of CHARACTERS) {
      const report = analyse(`${item.id}-${character.id}`, character.stats.jump, character.stats.speed, level);
      reachReports.push(`${item.id}/${character.id}: ${report.unreachableItems.length} unreachable items`);
      assert(
        report.unreachableItems.length === 0,
        `${item.id}/${character.id} cannot reach ${report.unreachableItems.map((entry) => entry.label).join(', ')}`,
      );
    }
  }
});

if (reachReports.length) {
  console.log('\n  Reachability report:');
  for (const line of reachReports) console.log(`  - ${line}`);
  console.log('  Caveat: item checks are heuristic, not proof of collision-free access; browser playtests are also required.\n');
}

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exit(1);
}
