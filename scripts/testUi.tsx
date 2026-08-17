/**
 * Renders the terminal to static HTML and asserts what a player actually sees
 * when it first opens.
 *
 * This exists because of a real bug: the result panel used to default to a
 * "sample data" tab rendered with the *same* table component as query output,
 * so an untouched terminal looked like it had already produced a result. A
 * test that only checked "does the component render" would have sailed past
 * that, so these assertions are about visible content, not about mounting.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { TerminalModal } from '../src/ui/TerminalModal';
import { VerdictModal } from '../src/ui/VerdictModal';
import { CHALLENGES } from '../src/data/case001';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const noop = () => {};

/** `alreadySolved` is the supported way to open straight on the solve pane. */
function renderTerminal(opts: { solved: boolean }) {
  return renderToStaticMarkup(
    <TerminalModal
      spec={CHALLENGES[0]}
      alreadySolved={opts.solved}
      hintsUsed={0}
      crystalsLeft={0}
      onAttempt={noop}
      onHint={noop}
      onSpendCrystal={() => false}
      onSolved={noop}
      onClose={noop}
    />,
  );
}

const countTables = (html: string) => (html.match(/<table class="result"/g) ?? []).length;

// ---- the reported bug ------------------------------------------------------

check('solve pane shows no result table before the player runs anything', () => {
  const html = renderTerminal({ solved: true });
  assert(
    countTables(html) === 0,
    `expected zero result tables on an untouched solve pane, found ${countTables(html)} — ` +
      'sample data is being rendered where the result goes',
  );
});

check('solve pane tells the player the result is still empty', () => {
  const html = renderTerminal({ solved: true });
  assert(html.includes('Nothing yet'), 'missing the empty-state prompt for the result panel');
  assert(html.includes('Your result'), 'result panel is not labelled');
});

check('sample data is collapsed, not shown alongside the result slot', () => {
  const html = renderTerminal({ solved: true });
  // The collapsible renders its body only when open, so the warning text is
  // absent until the player asks for it.
  assert(
    !html.includes('It is not your query'),
    'sample data body is expanded by default — it should be behind a show/hide',
  );
  assert(html.includes('Peek at'), 'no way to reach the sample data at all');
});

// ---- tidiness --------------------------------------------------------------

check('schema detail is behind a show/hide', () => {
  const html = renderTerminal({ solved: true });
  assert(html.includes('Full schema'), 'schema section is missing');
  assert(
    !html.includes('schema-doc'),
    'full schema is expanded by default — that is the bulk of the clutter',
  );
});

check('column names stay visible even with the schema collapsed', () => {
  const html = renderTerminal({ solved: true });
  // You cannot write the query without knowing the column names, so those are
  // the one part of the schema that must not be hidden.
  assert(html.includes('focus-cols'), 'focus column strip is missing');
  assert(html.includes('Computer'), 'column names are not visible anywhere');
});

check('hints and solution are behind a show/hide', () => {
  const html = renderTerminal({ solved: true });
  assert(html.includes('Stuck?'), 'no help affordance');
  assert(!html.includes('Reference solution'), 'the solution is on screen by default');
});

check('the three steps are numbered so the flow is obvious', () => {
  const html = renderTerminal({ solved: true });
  for (const step of ['Step 1', 'Step 2', 'Step 3']) {
    assert(html.includes(step), `missing ${step} label`);
  }
});

// ---- the learn pane still teaches -----------------------------------------

check('a new terminal opens on the lesson, not the editor', () => {
  const html = renderTerminal({ solved: false });
  assert(html.includes('Worked example'), 'lesson pane is not shown first');
});

check('the worked example labels its output as the example result', () => {
  const html = renderTerminal({ solved: false });
  // The lesson does show a table, which is fine - but it must be captioned, or
  // it is the same ambiguity in a different place.
  assert(
    html.includes('What that example returns'),
    'the example output table is unlabelled, so it reads as the player result',
  );
});

// ---- verdict console -------------------------------------------------------

const verdictHtml = () => renderToStaticMarkup(<VerdictModal onClose={noop} onResolved={noop} />);

check('submit verdict is pinned, not floated at the end of a long scroll', () => {
  const html = verdictHtml();
  assert(html.includes('Submit verdict'), 'submit button missing');
  assert(
    html.includes('verdict-foot'),
    'the footer is not the sticky variant, so it scrolls away with the evidence',
  );
});

check('the sticky rule actually exists in the stylesheet', () => {
  // The class name alone proves nothing if the rule was never written.
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rule = /\.verdict-foot\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
  assert(rule !== '', '.verdict-foot has no rule at all');
  assert(/position:\s*sticky/.test(rule), '.verdict-foot is not position: sticky');
  assert(/bottom:/.test(rule), '.verdict-foot has no bottom offset to stick to');
  assert(/background:/.test(rule), '.verdict-foot is transparent, content will show through it');
});

check('the verdict console says what to do before you scroll', () => {
  const html = verdictHtml();
  assert(html.includes('then submit'), 'no instruction at the top of the console');
  assert(
    html.includes('Choose a theory above to enable submit'),
    'the disabled submit button does not explain why it is disabled',
  );
});

check('evidence detail and the causal chain are collapsed by default', () => {
  const html = verdictHtml();
  assert(html.includes('titles-only'), 'evidence detail is expanded, which is what buried submit');
  assert(html.includes('Chain so far'), 'chain section missing');
  // Collapsible renders no body while closed, so no list items should exist.
  assert(!html.includes('chain-list'), 'the causal chain is expanded by default');
});

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
