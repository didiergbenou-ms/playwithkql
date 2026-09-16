import assert from 'node:assert/strict';
import { CASES, getCase } from '../src/data/cases';
import { caseDifficultyKey, DEFAULT_DIFFICULTY, DIFFICULTIES, type Difficulty } from '../src/data/difficulties';
import { parseLevel } from '../src/game/levels/heartbeatHills';
import { gradeChallenge } from '../src/kql/challenge';
import { getQueryDraft, saveQueryDraft } from '../src/state/queryDrafts';
import {
  caseCompletionKey, currentObjective, evidenceById, getCaseResult, mergePersistedState, roomProgress, scoreRun, useStore,
} from '../src/state/store';

let passed = 0;
const failures: string[] = [];
async function check(name: string, test: () => void | Promise<void>) {
  try {
    await test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

function start(caseId: string, difficulty: Difficulty) {
  useStore.getState().setScreen('menu');
  useStore.getState().selectCase(caseId);
  useStore.getState().setScreen('difficulty');
  useStore.getState().selectDifficulty(difficulty);
  const caseDef = getCase(caseId, difficulty);
  const level = parseLevel(caseDef.level);
  useStore.getState().startRun(level.totalFragments, level.totalCrystals);
  return caseDef;
}

function solveAll() {
  const { run } = useStore.getState();
  const caseDef = getCase(run.caseId, run.difficulty);
  const db = caseDef.database();
  assert.equal(caseDef.challenges.length, 5);
  for (const challenge of caseDef.challenges) {
    assert.equal(
      gradeChallenge(challenge, challenge.solution, db, caseDef.now).status,
      'correct',
      `${run.caseId}:${run.difficulty}:${challenge.id}`,
    );
    useStore.getState().registerAttempt(challenge.id);
    useStore.getState().solveChallenge(challenge.id, challenge.solution);
  }
  useStore.getState().setHud({ fragments: run.totalFragments, crystals: run.totalCrystals });
  return caseDef;
}

function finish() {
  const { run } = useStore.getState();
  const caseDef = getCase(run.caseId, run.difficulty);
  const correct = caseDef.rootCauses.find(option => option.correct)!;
  assert.ok(correct);
  useStore.getState().submitVerdict(correct.id, true);
  return correct.id;
}

const originalNow = Date.now;
try {
  Date.now = () => 1800000000000;
  useStore.getState().resetProfile();

  await check('the state suite covers three cases and three difficulties', () => {
    assert.equal(CASES.length, 3);
    assert.deepEqual(DIFFICULTIES.map(d => d.id), ['beginner', 'intermediate', 'expert']);
  });

  for (const base of CASES) {
    for (const { id: difficulty } of DIFFICULTIES) {
      await check(`${base.id}:${difficulty}: five graded queries award the unchanged 1000-point score`, () => {
        const before = structuredClone(useStore.getState().profile);
        const caseDef = start(base.id, difficulty);
        assert.equal(useStore.getState().selectedDifficulty, difficulty);
        assert.equal(useStore.getState().run.difficulty, difficulty);
        assert.equal(useStore.getState().run.caseId, base.id);
        assert.deepEqual(Object.keys(useStore.getState().run.challenges), caseDef.challenges.map(c => c.id));
        assert.throws(() => finish(), /terminals/);
        solveAll();
        for (const note of caseDef.level.notes) useStore.getState().readNote(note.id);
        const verdictId = finish();
        const { run, profile } = useStore.getState();
        assert.equal(run.queriesRun, 5);
        assert.deepEqual(scoreRun(run), { completion: 500, accuracy: 300, clues: 100, time: 100, total: 1000 });
        assert.deepEqual(new Set(run.evidence), new Set(caseDef.evidence.map(e => e.id)));
        assert.deepEqual(new Set(run.openGates), new Set(Object.values(caseDef.level.gateChars)));
        assert.deepEqual(getCaseResult(profile, base.id, difficulty), { completions: 1, bestScore: 1000 });
        assert.equal(profile.lifetimeScore, before.lifetimeScore + 1000);
        assert.equal(profile.casesClosed, before.casesClosed + 1);
        assert.equal(profile.totalQueries, before.totalQueries + 5);
        assert.equal(profile.bestScore, 1000);
        assert.ok(profile.achievements.includes('kusto-master'));
        assert.ok(profile.achievements.includes('librarian'));
        assert.ok(profile.achievements.includes('no-hints'));
        for (const [key, result] of Object.entries(before.caseResults ?? {})) {
          assert.deepEqual(profile.caseResults?.[key], result);
        }
        const finishedProfile = structuredClone(profile);
        useStore.getState().submitVerdict(verdictId, true);
        assert.deepEqual(useStore.getState().profile, finishedProfile);
      });

      await check(`${base.id}:${difficulty}: objectives, room counts and evidence resolve the variant`, () => {
        const caseDef = getCase(base.id, difficulty);
        const foreign = getCase(base.id, difficulty === 'beginner' ? 'expert' : 'beginner');
        const foreignIds = foreign.challenges.map(c => c.id);
        const empty = currentObjective(foreignIds, base.id, difficulty);
        assert.equal(empty.challengeId, caseDef.challenges[0].id);
        assert.equal(empty.solved, 0);
        assert.equal(empty.total, 5);
        assert.equal(roomProgress(foreignIds, base.id, difficulty).reduce((n, r) => n + r.solved, 0), 0);
        const ids = caseDef.challenges.map(c => c.id);
        for (let count = 0; count <= ids.length; count++) {
          const solved = ids.slice(0, count);
          const objective = currentObjective(solved, base.id, difficulty);
          assert.equal(objective.solved, count);
          assert.equal(objective.finale, count === ids.length);
          assert.equal(objective.challengeId, ids[count]);
          const rooms = roomProgress(solved, base.id, difficulty);
          assert.equal(rooms.reduce((n, r) => n + r.solved, 0), count);
          assert.equal(rooms.reduce((n, r) => n + r.total, 0), 5);
          assert.deepEqual(rooms.map(r => r.name), caseDef.level.rooms.map(r => r.name));
        }
        for (const evidence of caseDef.evidence) {
          assert.equal(evidenceById(evidence.id, base.id, difficulty), evidence);
        }
        assert.equal(evidenceById('missing', base.id, difficulty), undefined);
        if (difficulty === DEFAULT_DIFFICULTY) {
          assert.deepEqual(currentObjective(ids, base.id), currentObjective(ids, base.id, difficulty));
          assert.deepEqual(roomProgress(ids, base.id), roomProgress(ids, base.id, difficulty));
        }
      });

      await check(`${base.id}:${difficulty}: selecting another tier resets run and rejects stale work`, () => {
        const caseDef = start(base.id, difficulty);
        const old = useStore.getState().run;
        const challenge = caseDef.challenges[0];
        saveQueryDraft(old.runId, base.id, challenge.id, 'unfinished');
        useStore.getState().setHud({ fragments: 1, crystals: 2, deaths: 2, health: 1 });
        useStore.getState().spendCrystal(challenge.id);
        useStore.getState().useHint(challenge.id);
        useStore.getState().revealSolution(challenge.id);
        useStore.getState().registerAttempt(challenge.id);
        useStore.getState().readNote(caseDef.level.notes[0].id);
        useStore.getState().devSolve('all');
        finish();
        useStore.getState().pushToast('old run');
        useStore.getState().setScreen('difficulty');
        const nextDifficulty = difficulty === 'expert' ? 'beginner' : 'expert';
        const profile = structuredClone(useStore.getState().profile);
        useStore.getState().selectDifficulty(nextDifficulty);
        const state = useStore.getState();
        const fresh = state.run;
        const nextCase = getCase(base.id, nextDifficulty);
        assert.notEqual(fresh.runId, old.runId);
        assert.equal(fresh.startedAt, old.startedAt);
        assert.equal(fresh.difficulty, nextDifficulty);
        assert.equal(fresh.caseId, base.id);
        assert.equal(fresh.room, nextCase.level.rooms[0].name);
        assert.equal(fresh.fragments, 0);
        assert.equal(fresh.crystals, 0);
        assert.equal(fresh.crystalsSpent, 0);
        assert.equal(fresh.health, 3);
        assert.equal(fresh.deaths, 0);
        assert.equal(fresh.queriesRun, 0);
        assert.equal(fresh.cleanStreak, 0);
        assert.equal(fresh.verdictId, null);
        assert.equal(fresh.verdictCorrect, false);
        assert.equal(fresh.finishedAt, null);
        assert.equal(fresh.devUsed, false);
        assert.deepEqual(fresh.notesRead, []);
        assert.deepEqual(fresh.evidence, []);
        assert.deepEqual(fresh.openGates, []);
        assert.deepEqual(state.toasts, []);
        assert.deepEqual(state.profile, profile);
        assert.deepEqual(Object.keys(fresh.challenges), nextCase.challenges.map(c => c.id));
        for (const progress of Object.values(fresh.challenges)) {
          assert.deepEqual(progress, {
            attempts: 0, hintsUsed: 0, crystalHints: 0, solutionRevealed: false, solved: false,
          });
        }
        assert.equal(getQueryDraft(fresh.runId, base.id, challenge.id), undefined);
        assert.equal(getQueryDraft(old.runId, base.id, challenge.id), undefined);
        assert.throws(() => saveQueryDraft(old.runId, base.id, challenge.id, 'late'), /inactive/);
        assert.throws(() => saveQueryDraft(fresh.runId, 'foreign', challenge.id, 'late'), /inactive/);
        assert.throws(() => state.registerAttempt(challenge.id), /active case/);
        assert.throws(() => state.solveChallenge(challenge.id, challenge.solution), /active case/);
        assert.throws(() => state.useHint(challenge.id), /active case/);
        assert.throws(() => state.spendCrystal(challenge.id), /active case/);
        assert.throws(() => state.revealSolution(challenge.id), /active case/);
        assert.equal(useStore.getState(), state);
      });
    }
  }

  await check('beginner completion never credits other tiers; replay updates only its own count and maximum', () => {
    useStore.getState().resetProfile();
    start('001', 'beginner');
    solveAll();
    finish();
    assert.equal(getCaseResult(useStore.getState().profile, '001', 'intermediate'), undefined);
    assert.equal(getCaseResult(useStore.getState().profile, '001', 'expert'), undefined);
    assert.equal(getCaseResult(useStore.getState().profile, '002', 'beginner'), undefined);
    start('001', 'expert');
    solveAll();
    finish();
    const expert = structuredClone(getCaseResult(useStore.getState().profile, '001', 'expert'));
    const caseDef = start('001', 'beginner');
    useStore.getState().useHint(caseDef.challenges[0].id);
    solveAll();
    const verdict = finish();
    assert.ok(scoreRun(useStore.getState().run).total < 1000);
    const profile = structuredClone(useStore.getState().profile);
    assert.deepEqual(getCaseResult(profile, '001', 'beginner'), { completions: 2, bestScore: 1000 });
    assert.deepEqual(getCaseResult(profile, '001', 'expert'), expert);
    assert.equal(getCaseResult(profile, '001', 'intermediate'), undefined);
    useStore.getState().submitVerdict(verdict, true);
    assert.deepEqual(useStore.getState().profile, profile);
  });

  await check('developer and incorrect finishes never create variant results', () => {
    useStore.getState().resetProfile();
    for (const { id: difficulty } of DIFFICULTIES) {
      for (const shortcut of ['solve', 'taint', 'grant'] as const) {
        start('002', difficulty);
        const profile = structuredClone(useStore.getState().profile);
        if (shortcut === 'solve') useStore.getState().devSolve('all');
        else if (shortcut === 'taint') useStore.getState().devTaint();
        else useStore.getState().devGrant({ crystals: 3 });
        solveAll();
        finish();
        assert.deepEqual(useStore.getState().profile, profile);
      }
      const caseDef = start('002', difficulty);
      solveAll();
      const profile = structuredClone(useStore.getState().profile);
      const incorrect = caseDef.rootCauses.find(option => !option.correct)!;
      assert.ok(incorrect);
      useStore.getState().submitVerdict(incorrect.id, false);
      assert.deepEqual(useStore.getState().profile, profile);
      assert.equal(getCaseResult(useStore.getState().profile, '002', difficulty), undefined);
    }
  });

  await check('invalid difficulty and mid-game selections are atomic, including draft identity', () => {
    const caseDef = start('003', 'expert');
    const before = useStore.getState();
    const { run } = before;
    const challenge = caseDef.challenges[0];
    saveQueryDraft(run.runId, run.caseId, challenge.id, 'keep');
    const invalid = 'nightmare' as Difficulty;
    assert.throws(() => before.startRun(1, 1, '001', invalid));
    assert.throws(() => before.selectDifficulty(invalid));
    assert.throws(() => before.selectDifficulty('beginner'), /menu/);
    assert.throws(() => before.selectDifficulty('expert'), /menu/);
    assert.throws(() => before.selectCase('001'), /menu/);
    assert.equal(useStore.getState(), before);
    assert.equal(getQueryDraft(run.runId, run.caseId, challenge.id), 'keep');
    before.setScreen('difficulty');
    const menu = useStore.getState();
    assert.throws(() => menu.selectDifficulty(invalid));
    assert.equal(useStore.getState(), menu);
    assert.equal(getQueryDraft(run.runId, run.caseId, challenge.id), 'keep');
  });

  await check('same-case selection resets to beginner; starts respect explicit and compatible defaults', () => {
    start('003', 'expert');
    useStore.getState().setScreen('menu');
    const old = useStore.getState().run;
    saveQueryDraft(old.runId, old.caseId, getCase('003', 'expert').challenges[0].id, 'old');
    useStore.getState().selectCase('003');
    const selected = useStore.getState();
    assert.equal(selected.selectedDifficulty, 'beginner');
    assert.equal(selected.run.difficulty, 'beginner');
    assert.notEqual(selected.run.runId, old.runId);
    assert.throws(() => saveQueryDraft(old.runId, old.caseId, 'old', 'late'), /inactive/);
    selected.selectDifficulty('intermediate');
    const ready = useStore.getState().run;
    useStore.getState().startRun(8, 2);
    const first = useStore.getState().run;
    assert.equal(first.difficulty, 'intermediate');
    assert.notEqual(first.runId, ready.runId);
    useStore.getState().startRun(8, 2, '003');
    const second = useStore.getState().run;
    assert.equal(second.difficulty, 'intermediate');
    assert.notEqual(second.runId, first.runId);
    assert.equal(second.startedAt, first.startedAt);
    useStore.getState().startRun(8, 2, '001');
    assert.equal(useStore.getState().run.difficulty, 'beginner');
    useStore.getState().startRun(8, 2, '002', 'expert');
    assert.equal(useStore.getState().selectedCaseId, '002');
    assert.equal(useStore.getState().selectedDifficulty, 'expert');
    assert.equal(useStore.getState().run.difficulty, 'expert');
    assert.equal(useStore.getState().run.totalFragments, 8);
    assert.equal(useStore.getState().run.totalCrystals, 2);
  });

  // The Node-resolved Zustand build does not expose persist. Exercise the exact
  // merge used by hydration here; the browser suite covers real storage/reloads.
  await check('hydration merge preserves legacy history without inferring tier completions', () => {
    const legacy = {
      lifetimeScore: 12000, bestScore: 950, casesClosed: 18,
      achievements: ['first-query', 'case-closed'], totalQueries: 140, character: 'ember',
    };
    const active = useStore.getState();
    const saved = { profile: legacy, screen: 'debrief', selectedDifficulty: 'beginner', run: { runId: -1 } };
    const before = JSON.stringify(saved);
    useStore.setState(mergePersistedState(saved, active));
    assert.deepEqual(useStore.getState().profile, { ...legacy, caseResults: {} });
    assert.equal(useStore.getState().run, active.run);
    assert.equal(useStore.getState().screen, active.screen);
    assert.equal(useStore.getState().selectedDifficulty, active.selectedDifficulty);
    assert.equal(JSON.stringify(saved), before, 'Hydration mutated saved input');
    for (const base of CASES) {
      for (const { id } of DIFFICULTIES) assert.equal(getCaseResult(useStore.getState().profile, base.id, id), undefined);
    }
    start('001', 'intermediate');
    solveAll();
    finish();
    const expected = structuredClone(useStore.getState().profile);
    assert.equal(expected.lifetimeScore, legacy.lifetimeScore + 1000);
    assert.equal(expected.bestScore, 1000);
    assert.equal(expected.casesClosed, legacy.casesClosed + 1);
    assert.equal(expected.totalQueries, legacy.totalQueries + 5);
    assert.equal(expected.character, legacy.character);
    for (const achievement of legacy.achievements) assert.ok(expected.achievements.includes(achievement));
    assert.deepEqual(expected.caseResults, {
      [caseCompletionKey('001', 'intermediate')]: { completions: 1, bestScore: 1000 },
    });
    const run = useStore.getState().run;
    useStore.setState(mergePersistedState({ profile: expected }, useStore.getState()));
    assert.deepEqual(useStore.getState().profile, expected);
    assert.equal(useStore.getState().run, run);
  });

  await check('malformed new results are discarded without erasing the legacy profile; reset is fresh', () => {
    const legacy = {
      lifetimeScore: 4500, bestScore: 900, casesClosed: 6,
      achievements: ['first-query'], totalQueries: 88, character: 'quill',
    };
    const valid = { completions: 2, bestScore: 875 };
    useStore.setState(mergePersistedState({
        profile: {
          ...legacy,
          caseResults: {
            '001:beginner': valid,
            '001:expert': null,
            '001:intermediate': { completions: -1, bestScore: 900 },
            '002:beginner': { completions: '1', bestScore: 900 },
            '002:expert': { completions: 1.5, bestScore: 900 },
            '003:beginner': { completions: 1, bestScore: '900' },
            '003:expert': { completions: 1, bestScore: -1 },
          },
        },
    }, useStore.getState()));
    assert.deepEqual(useStore.getState().profile, { ...legacy, caseResults: { '001:beginner': valid } });
    for (const malformed of [null, [], 'invalid']) {
      useStore.setState(mergePersistedState({ profile: { ...legacy, caseResults: malformed } }, useStore.getState()));
      assert.deepEqual(useStore.getState().profile, { ...legacy, caseResults: {} });
    }
    useStore.getState().resetProfile();
    const first = useStore.getState().profile;
    assert.deepEqual(first, {
      lifetimeScore: 0, bestScore: 0, casesClosed: 0, achievements: [], totalQueries: 0,
      character: 'quill', caseResults: {},
    });
    useStore.getState().resetProfile();
    const second = useStore.getState().profile;
    assert.notEqual(second, first);
    assert.notEqual(second.achievements, first.achievements);
    assert.notEqual(second.caseResults, first.caseResults);
    useStore.setState(mergePersistedState({ profile: second }, useStore.getState()));
    assert.deepEqual(useStore.getState().profile, second);
  });
} finally {
  Date.now = originalNow;
  useStore.getState().setScreen('menu');
  useStore.getState().selectCase('001');
}

console.log(`Difficulty state: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
