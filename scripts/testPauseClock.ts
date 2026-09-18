import assert from 'node:assert/strict';
import { getCase } from '../src/data/cases';
import { getQueryDraft, saveQueryDraft } from '../src/state/queryDrafts';
import { elapsedRunMs, mergePersistedState, scoreRun, useStore } from '../src/state/store';

const minute = 60_000;
const originalNow = Date.now;
let now = 1_000_000;
let passed = 0;
const failures: string[] = [];

function start(at = 1_000_000) {
  now = at;
  useStore.getState().resetProfile();
  useStore.getState().startRun(10, 2, '001', 'beginner');
  return useStore.getState().run;
}

function pause(paused: boolean) {
  const { run, setRunPaused } = useStore.getState();
  setRunPaused(paused, run.runId);
}

function finish() {
  const { run } = useStore.getState();
  const caseDef = getCase(run.caseId, run.difficulty);
  for (const challenge of caseDef.challenges) {
    useStore.getState().solveChallenge(challenge.id, challenge.solution);
  }
  const verdict = caseDef.rootCauses.find((option) => option.correct);
  assert.ok(verdict);
  useStore.getState().submitVerdict(verdict.id, true);
  return verdict.id;
}

function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

try {
  Date.now = () => now;

  check('initial clock and legacy literals without pause fields', () => {
    const run = start();
    assert.equal(run.pauseStartedAt, null);
    assert.equal(run.pausedDurationMs, 0);
    assert.equal(elapsedRunMs(run), 0);
    now += 2 * minute;
    assert.equal(elapsedRunMs(run), 2 * minute);
    const legacy = { startedAt: run.startedAt, finishedAt: null };
    assert.equal(elapsedRunMs(legacy), 2 * minute);
    assert.equal(elapsedRunMs({ ...legacy, finishedAt: run.startedAt + minute }), minute);
  });

  check('repeated calls are idempotent and multiple pauses accumulate only once', () => {
    start();
    const initial = useStore.getState();
    pause(false);
    assert.equal(useStore.getState(), initial);
    now += 2 * minute;
    pause(true);
    const paused = useStore.getState();
    now += 10 * minute;
    pause(true);
    assert.equal(useStore.getState(), paused);
    assert.equal(elapsedRunMs(paused.run), 2 * minute);
    pause(false);
    const resumed = useStore.getState();
    assert.equal(resumed.run.pauseStartedAt, null);
    assert.equal(resumed.run.pausedDurationMs, 10 * minute);
    now += minute;
    pause(false);
    assert.equal(useStore.getState(), resumed);
    assert.equal(elapsedRunMs(resumed.run), 3 * minute);
    pause(true);
    now += 4 * minute;
    pause(false);
    assert.equal(useStore.getState().run.pausedDurationMs, 14 * minute);
    assert.equal(elapsedRunMs(useStore.getState().run), 3 * minute);
  });

  check('active pause freezes score time and resumed completion earns Quickdraw', () => {
    start();
    now += 6 * minute;
    const score = scoreRun(useStore.getState().run);
    assert.equal(score.time, 93);
    pause(true);
    now += 20 * minute;
    assert.deepEqual(scoreRun(useStore.getState().run), score);
    assert.equal(elapsedRunMs(useStore.getState().run), 6 * minute);
    pause(false);
    assert.deepEqual(scoreRun(useStore.getState().run), score);
    now += minute;
    finish();
    const state = useStore.getState();
    assert.equal(elapsedRunMs(state.run), 7 * minute);
    assert.equal(scoreRun(state.run).time, 87);
    assert.ok(state.profile.achievements.includes('quickdraw'));
    assert.equal(state.profile.lifetimeScore, scoreRun(state.run).total);
  });

  check('completion during an active pause freezes permanently and cleanup is ignored', () => {
    start();
    now += minute;
    pause(true);
    now += 2 * minute;
    pause(false);
    now += 6 * minute;
    pause(true);
    now += 30 * minute;
    const verdictId = finish();
    const finished = useStore.getState();
    const score = scoreRun(finished.run);
    assert.equal(finished.run.finishedAt, now);
    assert.equal(elapsedRunMs(finished.run), 7 * minute);
    assert.ok(finished.profile.achievements.includes('quickdraw'));
    now += 100 * minute;
    pause(false);
    pause(true);
    useStore.getState().submitVerdict(verdictId, true);
    assert.equal(useStore.getState(), finished);
    assert.equal(elapsedRunMs(finished.run), 7 * minute);
    assert.deepEqual(scoreRun(finished.run), score);
    assert.equal(elapsedRunMs(finished.run, -1), 7 * minute);
  });

  check('Quickdraw remains strictly under eight active minutes even when paused', () => {
    start();
    now += 8 * minute;
    pause(true);
    now += 30 * minute;
    finish();
    assert.equal(elapsedRunMs(useStore.getState().run), 8 * minute);
    assert.ok(!useStore.getState().profile.achievements.includes('quickdraw'));
  });

  check('dev completion while paused preserves profile and elapsed time', () => {
    start();
    now += 2 * minute;
    pause(true);
    now += 20 * minute;
    const profile = useStore.getState().profile;
    useStore.getState().devSolve('all');
    finish();
    assert.equal(useStore.getState().profile, profile);
    assert.equal(elapsedRunMs(useStore.getState().run), 2 * minute);
    now += minute;
    pause(false);
    assert.equal(elapsedRunMs(useStore.getState().run), 2 * minute);
  });

  check('replay, new case and difficulty reset clocks; stale cleanup cannot resume a new pause', () => {
    const old = start();
    pause(true);
    now += minute;
    pause(false);
    now += minute;
    pause(true);
    finish();
    now += minute;
    useStore.getState().startRun(10, 2, old.caseId, old.difficulty);
    const replay = useStore.getState().run;
    assert.notEqual(replay.runId, old.runId);
    assert.equal(replay.pauseStartedAt, null);
    assert.equal(replay.pausedDurationMs, 0);
    assert.equal(elapsedRunMs(replay), 0);
    pause(true);
    now += minute;
    const pausedReplay = useStore.getState();
    pausedReplay.setRunPaused(false, old.runId);
    pausedReplay.setRunPaused(true, old.runId);
    assert.equal(useStore.getState(), pausedReplay);
    assert.equal(elapsedRunMs(useStore.getState().run), 0);

    useStore.getState().setScreen('menu');
    useStore.getState().selectCase('002');
    const newCase = useStore.getState().run;
    assert.notEqual(newCase.runId, replay.runId);
    assert.equal(newCase.pauseStartedAt, null);
    assert.equal(newCase.pausedDurationMs, 0);
    assert.equal(elapsedRunMs(newCase), 0);
    pause(true);
    now += minute;
    const pausedCase = useStore.getState();
    pausedCase.setRunPaused(false, replay.runId);
    assert.equal(useStore.getState(), pausedCase);
    useStore.getState().selectDifficulty('expert');
    assert.equal(useStore.getState().run.pauseStartedAt, null);
    assert.equal(useStore.getState().run.pausedDurationMs, 0);
    assert.equal(elapsedRunMs(useStore.getState().run), 0);
  });

  check('zero is a valid pause and finish timestamp', () => {
    start(0);
    pause(true);
    assert.equal(useStore.getState().run.pauseStartedAt, 0);
    now = minute;
    assert.equal(elapsedRunMs(useStore.getState().run), 0);
    pause(false);
    assert.equal(useStore.getState().run.pausedDurationMs, minute);
    now += minute;
    assert.equal(elapsedRunMs(useStore.getState().run), minute);
    start(0);
    finish();
    const finished = useStore.getState();
    now = minute;
    pause(true);
    assert.equal(useStore.getState(), finished);
    assert.equal(elapsedRunMs(finished.run), 0);
  });

  check('backward clocks and negative accounting never produce negative elapsed or pause duration', () => {
    const run = start(1_000);
    now = 500;
    assert.equal(elapsedRunMs(run), 0);
    pause(true);
    now = 400;
    assert.equal(elapsedRunMs(useStore.getState().run), 0);
    pause(false);
    assert.equal(useStore.getState().run.pausedDurationMs, 0);
    now = 1_100;
    pause(true);
    now = 1_300;
    pause(false);
    assert.equal(useStore.getState().run.pausedDurationMs, 200);
    pause(true);
    now = 1_200;
    pause(false);
    assert.equal(useStore.getState().run.pausedDurationMs, 200);
    assert.equal(elapsedRunMs(useStore.getState().run), 0);
    now = 1_500;
    assert.equal(elapsedRunMs(useStore.getState().run), 300);
    assert.equal(elapsedRunMs({ ...run, pausedDurationMs: -500 }, 1_500), 500);
    assert.equal(elapsedRunMs({ ...run, pausedDurationMs: 1_000 }, 1_500), 0);
    assert.equal(elapsedRunMs({
      startedAt: -1_000, finishedAt: 0, pauseStartedAt: 500, pausedDurationMs: 200,
    }, 5_000), 800);
    assert.equal(elapsedRunMs({
      startedAt: 0, finishedAt: 500, pauseStartedAt: 1_000,
    }, 5_000), 500);
  });

  check('pause changes only clock fields, preserving profile, drafts and progress references', () => {
    const run = start();
    const challenge = getCase(run.caseId, run.difficulty).challenges[0];
    useStore.getState().registerAttempt(challenge.id);
    useStore.getState().useHint(challenge.id);
    useStore.getState().setHud({ fragments: 3, deaths: 1 });
    saveQueryDraft(run.runId, run.caseId, challenge.id, 'unfinished query');
    const before = useStore.getState();
    const profileSnapshot = structuredClone(before.profile);
    pause(true);
    now += 10 * minute;
    pause(false);
    const after = useStore.getState();
    assert.deepEqual(after, {
      ...before,
      run: { ...before.run, pauseStartedAt: null, pausedDurationMs: 10 * minute },
    });
    assert.equal(after.profile, before.profile);
    assert.deepEqual(after.profile, profileSnapshot);
    assert.equal(after.toasts, before.toasts);
    assert.equal(after.run.challenges, before.run.challenges);
    assert.equal(after.run.evidence, before.run.evidence);
    assert.equal(after.run.openGates, before.run.openGates);
    assert.equal(after.run.notesRead, before.run.notesRead);
    assert.equal(getQueryDraft(run.runId, run.caseId, challenge.id), 'unfinished query');
    // The Node-resolved store lacks persist; real saved-profile isolation is
    // exercised in the browser test, while this verifies the hydration merge.
    const merged = mergePersistedState({ profile: profileSnapshot, run: before.run }, after);
    assert.equal(merged.run, after.run);
    assert.deepEqual(merged.profile, profileSnapshot);
  });

  check('terminal and note reading still count without an explicit manual pause', () => {
    const run = start();
    const caseDef = getCase(run.caseId, run.difficulty);
    const caseNow = caseDef.now;
    now += 4 * minute;
    useStore.getState().readNote(caseDef.level.notes[0].id);
    useStore.getState().registerAttempt(caseDef.challenges[0].id);
    now += 5 * minute;
    useStore.getState().useHint(caseDef.challenges[0].id);
    assert.equal(useStore.getState().run.pauseStartedAt, null);
    assert.equal(useStore.getState().run.pausedDurationMs, 0);
    assert.equal(elapsedRunMs(useStore.getState().run), 9 * minute);
    assert.equal(caseDef.now.getTime(), caseNow.getTime());
    finish();
    const finished = useStore.getState();
    assert.equal(scoreRun(finished.run).time, 73);
    assert.ok(!finished.profile.achievements.includes('quickdraw'));
    now += 30 * minute;
    assert.equal(elapsedRunMs(finished.run), 9 * minute);
    assert.equal(scoreRun(finished.run).time, 73);
  });
} finally {
  Date.now = originalNow;
}

console.log(`${passed} pause clock checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exitCode = 1;
}
