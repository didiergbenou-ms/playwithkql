import assert from 'node:assert/strict';
import { beginDraftRun, getQueryDraft, saveQueryDraft } from '../src/state/queryDrafts';
import { useStore } from '../src/state/store';
import { getCase } from '../src/data/cases';
import { parseLevel } from '../src/game/levels/heartbeatHills';

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void) {
  try { test(); passed++; } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function start(id: string) {
  useStore.getState().setScreen('menu');
  useStore.getState().selectCase(id);
  const level = parseLevel(getCase(id).level);
  useStore.getState().startRun(level.totalFragments, level.totalCrystals);
  return useStore.getState().run;
}

check('drafts preserve raw formatting, empty text, and each terminal separately', () => {
  beginDraftRun(100, 'fixture');
  assert.equal(getQueryDraft(100, 'fixture', 'first'), undefined);
  const text = '  DeliveryLog\n | where Detail == "keep  spaces" // unfinished\n';
  saveQueryDraft(100, 'fixture', 'first', text);
  saveQueryDraft(100, 'fixture', 'second', '');
  assert.equal(getQueryDraft(100, 'fixture', 'first'), text);
  assert.equal(getQueryDraft(100, 'fixture', 'second'), '');
});

check('a new run clears drafts and rejects writes from stale or foreign runs', () => {
  beginDraftRun(101, '001');
  saveQueryDraft(101, '001', 'first', 'old');
  beginDraftRun(102, '002');
  assert.equal(getQueryDraft(102, '002', 'first'), undefined);
  assert.equal(getQueryDraft(101, '001', 'first'), undefined);
  assert.throws(() => saveQueryDraft(101, '001', 'first', 'late'), /inactive/);
  assert.throws(() => saveQueryDraft(102, '001', 'first', 'foreign'), /inactive/);
  saveQueryDraft(102, '002', 'first', 'new');
  assert.equal(getQueryDraft(102, '002', 'first'), 'new');
});

for (const caseId of ['001', '002', '003']) {
  check(`${caseId}: drafting never changes persisted state, scoring, hints or run state`, () => {
    const run = start(caseId);
    const state = useStore.getState();
    let changes = 0;
    const unsubscribe = useStore.subscribe(() => changes++);
    const challenge = getCase(caseId).challenges[0];
    try {
      saveQueryDraft(run.runId, caseId, challenge.id, 'unfinished');
      saveQueryDraft(run.runId, caseId, challenge.id, '');
      saveQueryDraft(run.runId, caseId, challenge.id, challenge.starter);
    } finally {
      unsubscribe();
    }
    assert.equal(changes, 0, 'Typing caused a persisted store update');
    assert.equal(useStore.getState(), state);
    assert.equal(getQueryDraft(run.runId, caseId, challenge.id), challenge.starter);
  });

  check(`${caseId}: fresh replay clears drafts even when restarted in the same millisecond`, () => {
    const originalNow = Date.now;
    try {
      Date.now = () => 1800000000000;
      const old = start(caseId);
      const challenge = getCase(caseId).challenges[0];
      saveQueryDraft(old.runId, caseId, challenge.id, 'old draft');
      const level = parseLevel(getCase(caseId).level);
      useStore.getState().startRun(level.totalFragments, level.totalCrystals);
      const fresh = useStore.getState().run;
      assert.notEqual(fresh.runId, old.runId);
      assert.equal(getQueryDraft(fresh.runId, caseId, challenge.id), undefined);
      assert.throws(() => saveQueryDraft(old.runId, caseId, challenge.id, 'late'), /inactive/);
    } finally {
      Date.now = originalNow;
    }
  });
}

console.log(`Drafts: ${passed} passed, ${failures.length} failed`);
failures.forEach(failure => console.error(failure));
if (failures.length) process.exit(1);
