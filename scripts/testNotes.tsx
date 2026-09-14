import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CASES } from '../src/data/cases';
import { parseLevel } from '../src/game/levels/heartbeatHills';
import { useStore } from '../src/state/store';
import { NotebookView } from '../src/ui/Notes';

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void) {
  try { test(); passed++; } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function start(caseId: string) {
  useStore.getState().setScreen('menu');
  useStore.getState().selectCase(caseId);
  const definition = CASES.find(item => item.id === caseId)!;
  const level = parseLevel(definition.level);
  useStore.getState().startRun(level.totalFragments, level.totalCrystals);
  return definition;
}
function escaped(text: string) {
  return text.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
  })[character]!);
}
function render(caseDef: (typeof CASES)[number], notesRead = useStore.getState().run.notesRead,
  evidenceIds = useStore.getState().run.evidence) {
  return renderToStaticMarkup(
    <NotebookView caseDef={caseDef} notesRead={notesRead} evidenceIds={evidenceIds} onClose={() => {}} />,
  );
}

for (const caseDef of CASES) {
  check(`${caseDef.id}: fresh notebook hides unread note contents and explains both collection types`, () => {
    start(caseDef.id);
    const html = render(caseDef);
    assert(html.includes('No field notes pocketed yet'));
    assert(html.includes('No query evidence yet'));
    assert(!html.includes('???'));
    for (const note of caseDef.level.notes) {
      assert(!html.includes(escaped(note.title)));
      assert(!html.includes(escaped(note.body)));
    }
  });

  for (const note of caseDef.level.notes) {
    check(`${caseDef.id}/${note.id}: reading displays the exact title and body without filing evidence`, () => {
      start(caseDef.id);
      const profile = structuredClone(useStore.getState().profile);
      useStore.getState().readNote(note.id);
      const html = render(caseDef);
      assert(html.includes(escaped(note.title)));
      assert(html.includes(escaped(note.body)));
      assert(html.includes(`Field notes · 1 of ${caseDef.level.notes.length} pocketed`));
      assert(html.includes('No query evidence yet'));
      assert.equal((html.match(/Awaiting query evidence/g) ?? []).length, caseDef.causalChain.length);
      assert.deepEqual(useStore.getState().run.evidence, []);
      assert.deepEqual(useStore.getState().profile, profile);
      for (const unread of caseDef.level.notes.filter(item => item.id !== note.id)) {
        assert(!html.includes(escaped(unread.title)));
      }
      useStore.getState().readNote(note.id);
      assert.deepEqual(useStore.getState().run.notesRead, [note.id]);
      assert.equal(render(caseDef), html, 'Reopening the notebook or rereading a note must not duplicate it');
    });
  }

  check(`${caseDef.id}: all pocketed notes remain visible after query evidence arrives`, () => {
    start(caseDef.id);
    for (const note of caseDef.level.notes) useStore.getState().readNote(note.id);
    const challenge = caseDef.challenges[0];
    useStore.getState().solveChallenge(challenge.id, challenge.solution);
    const html = render(caseDef);
    for (const note of caseDef.level.notes) assert(html.includes(escaped(note.body)));
    assert(html.includes(escaped(caseDef.evidence.find(e => e.id === challenge.evidenceId)!.title)));
    assert.equal((html.match(/class="lit"/g) ?? []).length, 1);
  });

  check(`${caseDef.id}: working theory uses authored evidence links, not collected count`, () => {
    start(caseDef.id);
    const evidence = caseDef.evidence.at(-1)!;
    const html = render(caseDef, [], [evidence.id]);
    assert(html.includes(escaped(caseDef.causalChain[evidence.chainIndex])));
    assert.equal((html.match(/class="lit"/g) ?? []).length, 1);
    for (const [index, step] of caseDef.causalChain.entries()) {
      if (index !== evidence.chainIndex) assert(!html.includes(escaped(step)));
    }
    const sameStep = caseDef.evidence.filter(e => e.chainIndex === caseDef.evidence[0].chainIndex);
    assert.equal((render(caseDef, [], sameStep.map(e => e.id)).match(/class="lit"/g) ?? []).length, 1);
    assert.equal((render(caseDef, [], caseDef.evidence.map(e => e.id)).match(/class="lit"/g) ?? []).length,
      new Set(caseDef.evidence.map(e => e.chainIndex)).size);
  });

  check(`${caseDef.id}: fresh replay clears the notebook and foreign note IDs do not reveal notes`, () => {
    start(caseDef.id);
    for (const note of caseDef.level.notes) useStore.getState().readNote(note.id);
    start(caseDef.id);
    assert.deepEqual(useStore.getState().run.notesRead, []);
    assert(render(caseDef).includes('No field notes pocketed yet'));
    const foreignIds = CASES.filter(c => c.id !== caseDef.id).flatMap(c => c.level.notes.map(n => n.id));
    assert(render(caseDef, foreignIds, []).includes('No field notes pocketed yet'));
  });
}

check('multiple evidence items for one later step never unlock earlier steps', () => {
  const original = CASES[0];
  const fixture = {
    ...original,
    causalChain: ['First fixture step', 'Second fixture step', 'Third fixture step'],
    evidence: original.evidence.map(item => ({ ...item, chainIndex: 2 })),
  };
  const html = render(fixture, [], fixture.evidence.map(item => item.id));
  assert(html.includes('Third fixture step'));
  assert(!html.includes('First fixture step'));
  assert(!html.includes('Second fixture step'));
  assert.equal((html.match(/class="lit"/g) ?? []).length, 1);
});

check('switching cases clears previously pocketed notes', () => {
  const previous = start('001');
  useStore.getState().readNote(previous.level.notes[0].id);
  const next = start('002');
  assert.deepEqual(useStore.getState().run.notesRead, []);
  assert(render(next).includes('No field notes pocketed yet'));
});

console.log(`Notes: ${passed} passed, ${failures.length} failed`);
failures.forEach(failure => console.error(failure));
if (failures.length) process.exit(1);
