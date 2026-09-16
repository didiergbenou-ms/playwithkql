import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CASES, getCase, getCaseVariants } from '../src/data/cases';
import { DIFFICULTIES } from '../src/data/difficulties';
import { DifficultySelect } from '../src/ui/DifficultySelect';
import { CaseDifficulty } from '../src/ui/CaseDifficulty';
import ContentPreview from '../src/dev/ContentPreview';
import { parsePreviewSearch, previewSearch, previewSessionKey } from '../src/dev/contentPreviewSelection';

let passed = 0;
const failures: string[] = [];
function check(name: string, test: () => void) {
  try { test(); passed++; } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const noop = () => {};

for (const base of CASES) {
  check(`${base.id}: selection offers exactly three independently selectable difficulties`, () => {
    const html = renderToStaticMarkup(
      <DifficultySelect caseDef={getCase(base.id, 'intermediate')} selected="intermediate"
        onSelect={noop} onContinue={noop} onBack={noop} />,
    );
    assert(html.includes('Choose difficulty'));
    assert(html.includes('Choose recruit'));
    assert(html.includes('Back to cases'));
    assert.equal((html.match(/aria-pressed=/g) ?? []).length, 3);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    for (const { label } of DIFFICULTIES) assert(html.includes(`Select ${label} difficulty`));
    if (getCaseVariants(base.id).some(item => item.questionSetStatus === 'placeholder')) {
      assert(html.includes('final content pending'));
    }
    assert(html.includes('Same map and investigation'));
  });

  for (const variant of getCaseVariants(base.id)) {
    check(`${base.id}/${variant.difficulty}: every terminal has a stable authoring deep link`, () => {
      for (const terminal of variant.challenges) {
        const selection = { caseDef: variant, terminal, view: 'terminal' as const };
        const url = previewSearch(selection);
        assert(url.includes(`difficulty=${variant.difficulty}`));
        const route = parsePreviewSearch(url);
        assert(!route.error, route.error);
        assert.equal(route.selection?.caseDef, variant);
        assert.equal(route.selection?.terminal.id, terminal.id);
        const markup = renderToStaticMarkup(<ContentPreview initialSearch={url} />);
        if (variant.questionSetStatus === 'placeholder') assert(markup.includes('Questions pending'));
        assert(markup.includes('No progress, profile changes, or achievements saved.'));
      }
    });

    check(`${base.id}/${variant.difficulty}: badge clearly separates pending question content from mechanics`, () => {
      const html = renderToStaticMarkup(<CaseDifficulty caseDef={variant} notice />);
      assert(html.includes(DIFFICULTIES.find(item => item.id === variant.difficulty)!.label));
      assert.equal(html.includes('Questions pending'), variant.questionSetStatus === 'placeholder');
    });
  }
}

check('difficulty is included in preview session identity and reset', () => {
  const beginner = getCase('001', 'beginner');
  const expert = getCase('001', 'expert');
  const a = { caseDef: beginner, terminal: beginner.challenges[0], view: 'terminal' as const };
  const b = { caseDef: expert, terminal: expert.challenges[0], view: 'terminal' as const };
  assert.notEqual(previewSessionKey(a, 0), previewSessionKey(b, 0));
  assert.notEqual(previewSessionKey(b, 0), previewSessionKey(b, 1));
});

for (const query of [
  '?author=1&difficulty=unknown',
  '?author=1&difficulty=',
  '?author=1&difficulty=beginner&difficulty=expert',
  '?author=1&case=starter&difficulty=expert',
  `?author=1&case=001&difficulty=expert&terminal=${getCase('001', 'beginner').challenges[0].id}`,
]) {
  check(`invalid difficulty routing does not silently show another set: ${query}`, () => {
    const route = parsePreviewSearch(query);
    assert(route.error);
    assert.equal(route.selection, undefined);
    const html = renderToStaticMarkup(<ContentPreview initialSearch={query} />);
    assert(html.includes('role="alert"'));
  });
}

console.log(`Difficulty UI: ${passed} passed, ${failures.length} failed`);
failures.forEach(failure => console.error(failure));
if (failures.length) process.exit(1);
