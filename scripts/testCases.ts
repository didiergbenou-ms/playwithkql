import assert from 'node:assert/strict';
import { CASES, DEFAULT_CASE_ID, getCase } from '../src/data/cases';
import { parseLevel } from '../src/game/levels/heartbeatHills';
import { gradeChallenge } from '../src/kql/challenge';
import {
  currentObjective, evidenceById, hintsRevealed, roomProgress, scoreRun, useStore,
} from '../src/state/store';

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function start(caseId: string) {
  useStore.getState().setScreen('menu');
  useStore.getState().selectCase(caseId);
  const level = parseLevel(getCase(caseId).level);
  useStore.getState().startRun(level.totalFragments, level.totalCrystals);
  return getCase(caseId);
}

check('three selectable cases and explicit unknown-case errors', () => {
  assert.deepEqual(CASES.map(c => c.id), ['001', '002', '003']);
  assert.equal(DEFAULT_CASE_ID, '001');
  assert.throws(() => getCase('missing'));
  assert.equal(getCase('001').placeholder, false);
  for (const id of ['002', '003']) {
    assert.equal(getCase(id).placeholder, true);
    assert.ok(getCase(id).placeholderNotice);
  }
});

for (const caseDef of CASES) {
  check(`${caseDef.id}: real answers complete the active case, not Case 001`, () => {
    useStore.getState().resetProfile();
    start(caseDef.id);
    const db = caseDef.database();
    for (const challenge of caseDef.challenges) {
      assert.equal(
        gradeChallenge(challenge, challenge.solution, db, caseDef.now).status,
        'correct',
      );
      useStore.getState().registerAttempt(challenge.id);
      useStore.getState().solveChallenge(challenge.id, challenge.solution);
    }
    const run = useStore.getState().run;
    const solved = Object.keys(run.challenges).filter(id => run.challenges[id].solved);
    assert.equal(run.caseId, caseDef.id);
    assert.deepEqual(solved, caseDef.challenges.map(c => c.id));
    assert.deepEqual(new Set(run.evidence), new Set(caseDef.evidence.map(e => e.id)));
    assert.deepEqual(new Set(run.openGates), new Set(Object.values(caseDef.level.gateChars)));
    assert.ok(currentObjective(solved, caseDef.id).finale);
    assert.match(
      currentObjective(solved, caseDef.id).text,
      new RegExp(caseDef.level.rooms.at(-1)!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    assert.ok(roomProgress(solved, caseDef.id).every(room => room.solved === room.total));
    for (const evidence of caseDef.evidence) {
      assert.equal(evidenceById(evidence.id, caseDef.id)?.title, evidence.title);
    }
    const correct = caseDef.rootCauses.find(option => option.correct)!;
    assert.ok(correct);
    useStore.getState().submitVerdict(correct.id, true);
    assert.equal(useStore.getState().profile.casesClosed, 1);
    assert.equal(scoreRun(useStore.getState().run).accuracy, 300);
    const profile = { ...useStore.getState().profile };
    useStore.getState().submitVerdict(correct.id, true);
    assert.deepEqual(useStore.getState().profile, profile, 'Duplicate completion must not award twice');
  });

  check(`${caseDef.id}: replay clears hints, evidence, gates and dev state`, () => {
    start(caseDef.id);
    const challenge = caseDef.challenges[0];
    useStore.getState().setHud({ crystals: 2 });
    assert.equal(useStore.getState().spendCrystal(challenge.id), true);
    useStore.getState().revealSolution(challenge.id);
    useStore.getState().devSolve('all');
    const oldRunId = useStore.getState().run.runId;
    const profile = useStore.getState().profile;
    const level = parseLevel(caseDef.level);
    useStore.getState().startRun(level.totalFragments, level.totalCrystals);
    const run = useStore.getState().run;
    assert.equal(run.caseId, caseDef.id);
    assert.notEqual(run.runId, oldRunId);
    assert.deepEqual(run.openGates, []);
    assert.deepEqual(run.evidence, []);
    assert.deepEqual(run.notesRead, []);
    assert.equal(run.devUsed, false);
    assert.equal(run.fragments, 0);
    assert.equal(run.crystalsSpent, 0);
    assert.equal(run.verdictId, null);
    assert.equal(hintsRevealed(run.challenges[challenge.id]), 0);
    assert.equal(run.challenges[challenge.id].solutionRevealed, false);
    assert.deepEqual(useStore.getState().profile, profile);
  });

  check(`${caseDef.id}: developer completion does not persist rewards`, () => {
    useStore.getState().resetProfile();
    start(caseDef.id);
    const before = structuredClone(useStore.getState().profile);
    useStore.getState().devSolve('all');
    useStore.getState().registerAttempt(caseDef.challenges[0].id);
    useStore.getState().submitVerdict(caseDef.rootCauses.find(o => o.correct)!.id, true);
    assert.deepEqual(useStore.getState().profile, before);
    assert.equal(useStore.getState().run.devUsed, true);
  });
}

check('switching cases cannot retain or accept a previous case challenge', () => {
  start('001');
  const old = getCase('001').challenges[0];
  useStore.getState().registerAttempt(old.id);
  useStore.getState().solveChallenge(old.id, old.solution);
  useStore.getState().readNote(getCase('001').level.notes[0].id);
  assert.throws(() => useStore.getState().selectCase('002'), /menu/);
  const newCase = start('002');
  const run = useStore.getState().run;
  assert.equal(run.room, newCase.level.rooms[0].name);
  assert.deepEqual(run.evidence, []);
  assert.deepEqual(run.openGates, []);
  assert.deepEqual(run.notesRead, []);
  assert.equal(run.challenges[old.id], undefined);
  assert.throws(() => useStore.getState().registerAttempt(old.id), /active case/);
  assert.throws(() => useStore.getState().solveChallenge(old.id, old.solution), /active case/);
  assert.throws(() => useStore.getState().spendCrystal(old.id), /active case/);
  assert.throws(() => useStore.getState().revealSolution(old.id), /active case/);
  assert.throws(
    () => useStore.getState().submitVerdict(getCase('001').rootCauses.find(o => o.correct)!.id, true),
    /active case/,
  );
  assert.equal(useStore.getState().run, run, 'Rejected foreign actions must not mutate the run');
});

check('unknown case selection preserves current state', () => {
  useStore.getState().setScreen('menu');
  const before = useStore.getState();
  assert.throws(() => useStore.getState().selectCase('missing'));
  assert.equal(useStore.getState(), before);
});

check('two starts in the same millisecond still receive distinct scene identities', () => {
  const clock = Date.now;
  try {
    Date.now = () => 1800000000000;
    start('003');
    const first = useStore.getState().run;
    const level = parseLevel(getCase('003').level);
    useStore.getState().startRun(level.totalFragments, level.totalCrystals);
    const second = useStore.getState().run;
    assert.equal(first.startedAt, second.startedAt);
    assert.notEqual(first.runId, second.runId);
  } finally {
    Date.now = clock;
  }
});

useStore.getState().setScreen('menu');
useStore.getState().selectCase(DEFAULT_CASE_ID);
console.log(`Cases: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
