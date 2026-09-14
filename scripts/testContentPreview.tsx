import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ContentPreview from '../src/dev/ContentPreview';
import {
  parsePreviewSearch, PREVIEW_CASES, PREVIEW_VIEWS, previewSearch, previewSessionKey,
  shouldClosePreview, type PreviewSelection,
} from '../src/dev/contentPreviewSelection';
import { CASES, DEFAULT_CASE_ID } from '../src/data/cases';
import { CASE_STARTER } from '../src/authoring/caseStarter';
import { AUTHORING_CASES } from '../src/authoring/catalog';
import { validateCase } from '../src/authoring/validateCase';
import { VerdictView } from '../src/ui/VerdictView';

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
function selectionFor(search: string): PreviewSelection {
  const result = parsePreviewSearch(search);
  if (!result.selection) throw new Error(result.error);
  return result.selection;
}
function render(search: string): string {
  return renderToStaticMarkup(<ContentPreview initialSearch={search} />);
}
function escaped(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
  })[character]!);
}

check('preview and CLI use the same authoring catalog without modifying playable cases', () => {
  assert.equal(PREVIEW_CASES, AUTHORING_CASES);
  for (const item of CASES) assert(PREVIEW_CASES.includes(item));
  assert(PREVIEW_CASES.includes(CASE_STARTER));
  assert(!CASES.includes(CASE_STARTER));
  assert.equal(new Set(PREVIEW_CASES.map((item) => item.id)).size, PREVIEW_CASES.length);
});

check('missing parameters have explicit, stable defaults', () => {
  const selection = selectionFor('?author=1');
  assert.equal(selection.caseDef.id, DEFAULT_CASE_ID);
  assert.equal(selection.terminal, selection.caseDef.challenges[0]);
  assert.equal(selection.view, 'overview');
  const html = render('?author=1');
  assert(html.includes('Content workbench'));
  assert(html.includes('PREVIEW ONLY'));
  assert(html.includes('No progress, profile changes, or achievements saved.'));
  assert(html.includes(`Missing parameters default to case ${DEFAULT_CASE_ID}`));
  assert(!html.includes('<canvas'));
  assert(!html.includes('class="stage"'));
  for (const id of ['preview-case', 'preview-terminal', 'preview-surface']) {
    assert(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), `Missing explicit label for ${id}`);
  }
});

for (const search of [
  '?author=0', '?case=002', '?author=1&case=unknown', '?author=1&case=',
  '?author=1&terminal=unknown', '?author=1&terminal=', '?author=1&view=unknown',
  '?author=1&view=', '?author=1&case=001&case=002', '?author=1&author=0',
  '?author=1&terminal=a&terminal=b', '?author=1&view=terminal&view=verdict',
]) {
  check(`invalid route reports an error, not another case: ${search}`, () => {
    const result = parsePreviewSearch(search);
    assert(result.error);
    assert.equal(result.selection, undefined);
    const html = render(search);
    assert(html.includes('role="alert"'));
    assert(html.includes('Recover by opening a known case'));
    assert(!html.includes('aria-label="Case validation"'));
    assert(!html.includes('class="modal '));
  });
}

for (const caseDef of PREVIEW_CASES) {
  check(`case ${caseDef.id}: briefing and verdict use the selected corpus`, () => {
    const selection: PreviewSelection = { caseDef, terminal: caseDef.challenges[0], view: 'briefing' };
    const briefing = render(previewSearch(selection));
    assert(briefing.includes(escaped(caseDef.email.subject)));
    assert(briefing.includes(escaped(caseDef.email.from)));
    assert(briefing.includes('Begin investigation'));
    const verdict = render(previewSearch({ ...selection, view: 'verdict' }));
    assert(verdict.includes('Full evidence corpus supplied locally.'));
    for (const evidence of caseDef.evidence) assert(verdict.includes(escaped(evidence.title)));
    for (const option of caseDef.rootCauses) assert(verdict.includes(escaped(option.label)));
    assert(verdict.includes('Submit verdict'));
    assert(verdict.includes('Overview / close surface'));
  });

  check(`case ${caseDef.id}: validator output is visible`, () => {
    const html = render(`?author=1&case=${encodeURIComponent(caseDef.id)}`);
    const issues = validateCase(caseDef);
    for (const issue of issues) assert(html.includes(escaped(issue)));
    if (!issues.length) assert(html.includes('No validator errors.'));
  });

  for (const terminal of caseDef.challenges) {
    check(`case ${caseDef.id}, terminal ${terminal.id}: exact deep link and original lesson`, () => {
      const selection: PreviewSelection = { caseDef, terminal, view: 'terminal' };
      assert.deepEqual(selectionFor(previewSearch(selection)), selection);
      const html = render(previewSearch(selection));
      for (const paragraph of terminal.concept.body.split('\n\n')) {
        assert(html.includes(escaped(paragraph)));
      }
      assert(html.includes('class="modal terminal-modal"'));
      assert(html.includes('Attempts: 0'));
      assert(html.includes('Hints: 0'));
      assert(html.includes('Solution hidden'));
      assert(html.includes('Not solved'));
      assert(html.includes('Reset preview'));
      assert(!html.includes('Terminal solved — no progress saved.'));
    });
  }
}

check('surface, terminal, case, and reset each remount all local state', () => {
  const selection = selectionFor('?author=1');
  const initialKey = previewSessionKey(selection, 0);
  const keys = PREVIEW_VIEWS.map((view) => previewSessionKey({ ...selection, view }, 0));
  assert.equal(new Set(keys).size, PREVIEW_VIEWS.length);
  assert.notEqual(initialKey, previewSessionKey(selection, 1));
  assert.notEqual(initialKey, previewSessionKey({
    ...selection, terminal: selection.caseDef.challenges[1],
  }, 0));
  assert.notEqual(initialKey, previewSessionKey({
    ...selection, caseDef: PREVIEW_CASES[1],
  }, 0));
});

check('Escape respects editor completion, composition, and other keys', () => {
  assert(shouldClosePreview({ key: 'Escape', defaultPrevented: false, isComposing: false }));
  assert(!shouldClosePreview({ key: 'Escape', defaultPrevented: true, isComposing: false }));
  assert(!shouldClosePreview({ key: 'Escape', defaultPrevented: false, isComposing: true }));
  assert(!shouldClosePreview({ key: 'Enter', defaultPrevented: false, isComposing: false }));
});

check('pure verdict still filters evidence according to caller-supplied IDs', () => {
  const caseDef = PREVIEW_CASES[0];
  const html = renderToStaticMarkup(
    <VerdictView caseDef={caseDef} evidenceIds={[caseDef.evidence[0].id]} onCorrect={() => {}} onClose={() => {}} />,
  );
  assert(html.includes(escaped(caseDef.evidence[0].title)));
  for (const evidence of caseDef.evidence.slice(1)) assert(!html.includes(escaped(evidence.title)));
  assert(html.includes('Choose a theory above to enable submit.'));
});

check('preview and pure verdict never import persistence, bus, App, or dev unlocks', () => {
  for (const parts of [
    ['src', 'dev', 'ContentPreview.tsx'],
    ['src', 'dev', 'contentPreviewSelection.ts'],
    ['src', 'ui', 'VerdictView.tsx'],
  ]) {
    const source = readFileSync(resolve(...parts), 'utf8');
    assert(!/from\s+['"][^'"]*(?:state\/store|game\/bus|PhaserGame|\/App|\/secret)['"]/.test(source));
    assert(!/\b(?:useStore|submitVerdict|localStorage|sessionStorage)\b/.test(source));
  }
  const main = readFileSync(resolve('src', 'main.tsx'), 'utf8');
  assert(main.includes('import.meta.env.DEV'));
  assert(main.includes("return import('./dev/ContentPreview')"));
  assert(!/from\s+['"]\.\/(?:App|state\/store)['"]/.test(main));
});

console.log(`Content preview: ${passed} passed, ${failures.length} failed.`);
for (const failure of failures) console.error(failure);
if (failures.length) process.exit(1);
