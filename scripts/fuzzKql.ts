/**
 * Adversarial sweep over the KQL engine.
 *
 * The graded challenges only exercise five happy paths. Players will type all
 * sorts of things, and a crash in the engine breaks the whole modal. Every
 * query below must either return a table or throw a *friendly* KqlError —
 * never a raw TypeError, never a hang.
 */
import { runQuery, KqlError } from '../src/kql/index';
import { gradeChallenge } from '../src/kql/challenge';
import { completionsFor, applyCompletion } from '../src/kql/complete';
import { formatKql, pipeNeedsNewline } from '../src/kql/format';
import { buildHighlightSchema, highlightKql } from '../src/kql/highlight';
import { buildDatabase, CASE_NOW, CHALLENGES, TABLE_META } from '../src/data/case001';

const db = buildDatabase();
const opts = { now: CASE_NOW };
const schema = buildHighlightSchema(TABLE_META);

let ok = 0;
const problems: string[] = [];

/** Runs a query and classifies the outcome. */
function probe(label: string, q: string) {
  const started = Date.now();
  try {
    const r = runQuery(q, db, opts);
    const ms = Date.now() - started;
    if (ms > 2000) problems.push(`SLOW (${ms}ms) :: ${label} :: ${q}`);
    else ok++;
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof KqlError) {
      if (!err.message || err.message.length < 5) {
        problems.push(`EMPTY MESSAGE :: ${label} :: ${q}`);
      } else ok++;
    } else {
      problems.push(
        `CRASH (${(err as Error).constructor.name}: ${(err as Error).message}) :: ${label} :: ${q}`,
      );
    }
    if (ms > 2000) problems.push(`SLOW ERROR (${ms}ms) :: ${label} :: ${q}`);
  }
}

// ---- syntactically broken --------------------------------------------------

const broken = [
  '',
  '   ',
  '|',
  '||||',
  'Heartbeat |',
  'Heartbeat | |',
  '| where x == 1',
  'Heartbeat | where',
  'Heartbeat | where ==',
  'Heartbeat | where Computer ==',
  'Heartbeat | where Computer == "',
  "Heartbeat | where Computer == 'unclosed",
  'Heartbeat | summarize',
  'Heartbeat | summarize by',
  'Heartbeat | summarize count() by',
  'Heartbeat | project',
  'Heartbeat | take',
  'Heartbeat | take abc',
  'Heartbeat | take -5',
  'Heartbeat | top',
  'Heartbeat | top 5',
  'Heartbeat | top 5 by',
  'Heartbeat | sort',
  'Heartbeat | sort by',
  'Heartbeat | distinct',
  'Heartbeat | extend',
  'Heartbeat | extend x =',
  'Heartbeat | where (',
  'Heartbeat | where )',
  'Heartbeat | where ()',
  'Heartbeat | where ((((Computer))))',
  'Heartbeat | where [',
  'Heartbeat | where Computer[',
  'Heartbeat | where Computer in',
  'Heartbeat | where Computer in (',
  'Heartbeat | where Computer in ()',
  'Heartbeat where Computer == "x"',
  'Heartbeat || where Computer == "x"',
  'Heartbeat | | where Computer == "x"',
  '.show tables',
  'SELECT * FROM Heartbeat',
  'DROP TABLE Heartbeat',
  '{}',
  '<script>alert(1)</script>',
  '\\\\\\',
  '😀 | where x',
  'Heartbeat | where Computer == 😀',
];
for (const q of broken) probe('broken syntax', q);

// ---- semantically wrong ----------------------------------------------------

const wrong = [
  'NotATable | count',
  'Heartbeat | where NotAColumn == 1',
  'Heartbeat | project NotAColumn',
  'Heartbeat | summarize count() by NotAColumn',
  'Heartbeat | where count() > 1',
  'Heartbeat | summarize NotAnAggregate(Computer)',
  'Heartbeat | summarize Computer',
  'Heartbeat | where notafunction(Computer)',
  'Heartbeat | sort by NotAColumn',
  'Heartbeat | extend x = NotAColumn + 1',
  'Heartbeat | summarize arg_max()',
  'Heartbeat | summarize arg_max(NotAColumn, *) by Computer',
  'Heartbeat | project x = parse_json(Computer).a.b.c',
];
for (const q of wrong) probe('semantic error', q);

// ---- valid but unusual -----------------------------------------------------

const odd = [
  'Heartbeat',
  'Heartbeat | take 0',
  'Heartbeat | take 999999',
  'Heartbeat | where false',
  'Heartbeat | where true',
  'Heartbeat | where 1 == 2 | summarize count() by Computer',
  'Heartbeat | count | count',
  'Heartbeat | distinct Computer | distinct Computer',
  'Heartbeat | summarize count() by Computer | summarize count()',
  'Heartbeat | project Computer | project Computer',
  'Heartbeat | extend a = 1 | extend a = 2 | project a',
  'Heartbeat | where Computer == "NOPE" | summarize count() by Computer',
  'Heartbeat | where Computer == "NOPE" | summarize arg_max(TimeGenerated, *) by Computer',
  'Heartbeat | summarize dcount(Computer), min(TimeGenerated), max(TimeGenerated), avg(1)',
  'Heartbeat | where TimeGenerated > ago(0d)',
  'Heartbeat | where TimeGenerated > ago(99999d)',
  'Heartbeat | extend x = 1/0 | project x',
  'Heartbeat | extend x = 0/0 | project x',
  'Heartbeat | extend x = strcat(Computer, 1, true) | project x',
  'Heartbeat | summarize count() by bin(TimeGenerated, 1ms)',
  'Heartbeat | where Computer contains "" | count',
  'Heartbeat | where Computer has "" | count',
  'Heartbeat | where isnull(Computer) | count',
  'Heartbeat | sort by TimeGenerated asc, Computer desc | take 3',
  'AzureActivity | extend p = parse_json(Properties) | project p',
  'AzureActivity | extend p = parse_json(Properties) | project x = p.does.not.exist',
  'AzureActivity | where Properties contains "proxy" | count',
  'AmaDiagnostics | summarize make_set(Level)',
  'AmaDiagnostics | summarize make_list(EventId) | project x = array_length(list_EventId)',
  'Heartbeat | extend n = -1 | where n < 0 | count',
  'Heartbeat | where Computer =~ "contoso-dc-01" | count',
  'Heartbeat | where Computer !contains "CONTOSO" | count',
  'Heartbeat | where Computer !in ("A") | count',
  'heartbeat | count',
  'HEARTBEAT | COUNT',
  'Heartbeat|where Computer=="CONTOSO-DC-01"|count',
  'Heartbeat\n\n\n| count',
  'Heartbeat // comment\n| count',
  'Heartbeat | count // trailing comment',
];
for (const q of odd) probe('unusual but valid', q);

// ---- deep nesting / pathological -------------------------------------------

probe('long pipeline', 'Heartbeat' + ' | where true'.repeat(60) + ' | count');
probe('deep parens', `Heartbeat | where ${'('.repeat(80)}true${')'.repeat(80)} | count`);
probe('many extends', 'Heartbeat | take 5' + ' | extend z = 1'.repeat(80));
probe('huge string', `Heartbeat | where Computer == "${'x'.repeat(20000)}" | count`);
probe('many columns projected', `Heartbeat | project ${Array.from({ length: 60 }, (_, i) => `c${i} = ${i}`).join(', ')}`);
probe('unbalanced parens deep', `Heartbeat | where ${'('.repeat(200)}true`);

// Stack-overflow guards: these used to escape as a raw RangeError, which is
// not a KqlError and surfaced to the player as an internal message.
probe('parens 5000 balanced', `Heartbeat | where ${'('.repeat(5000)}true${')'.repeat(5000)}`);
probe('parens 5000 unbalanced', `Heartbeat | where ${'('.repeat(5000)}true`);
probe('nested calls 2000', `Heartbeat | where ${'abs('.repeat(2000)}1${')'.repeat(2000)} > 0`);
probe('nested in-lists', `Heartbeat | where Computer in (${'('.repeat(3000)}"a"${')'.repeat(3000)})`);
probe('pipeline 2000', 'Heartbeat' + ' | where true'.repeat(2000) + ' | count');
probe('giant in-list', `Heartbeat | where Computer in (${Array.from({ length: 5000 }, (_, i) => `"m${i}"`).join(',')}) | count`);
probe('catastrophic regex', 'AmaDiagnostics | where Message matches "(a+)+$" | count');
probe('invalid regex', 'AmaDiagnostics | where Message matches "([" | count');
probe('deep member access', `AzureActivity | extend p = parse_json(Properties) | project x = p${'.a'.repeat(500)}`);
probe('group by high-cardinality', 'Heartbeat | summarize count() by TimeGenerated');
probe('self-referential extend', 'Heartbeat | extend q = q');

// ---- grading robustness ----------------------------------------------------

for (const spec of CHALLENGES) {
  for (const q of ['', '|', 'NotATable', 'Heartbeat | where NotACol == 1', '😀', spec.starter]) {
    try {
      const r = gradeChallenge(spec, q, db, CASE_NOW);
      if (!['correct', 'incorrect', 'error'].includes(r.status)) {
        problems.push(`BAD STATUS ${r.status} :: ${spec.id} :: ${q}`);
      } else if (!r.message) {
        problems.push(`NO MESSAGE :: ${spec.id} :: ${q}`);
      } else ok++;
    } catch (err) {
      problems.push(`GRADER CRASH (${(err as Error).message}) :: ${spec.id} :: ${q}`);
    }
  }
}

// ---- completion + highlighter robustness -----------------------------------

const fragments = [
  '',
  ' ',
  '|',
  'Heartbeat |',
  'Heartbeat | wh',
  'Heartbeat | where "',
  'Heartbeat | where Computer == "a | b" and ',
  'Heartbeat | summarize ',
  'Heartbeat | summarize count() by ',
  '😀',
  '((((',
  '\n\n\n',
  'Heartbeat | project a, b, c, ',
  'x'.repeat(5000),
];
for (const f of fragments) {
  for (const caret of [0, Math.floor(f.length / 2), f.length]) {
    try {
      const res = completionsFor(f, caret, TABLE_META);
      if (res.items.length) applyCompletion(f, caret, res.items[0]);
      pipeNeedsNewline(f, caret);
      ok++;
    } catch (err) {
      problems.push(`COMPLETION CRASH (${(err as Error).message}) :: "${f.slice(0, 40)}" @${caret}`);
    }
  }
  try {
    const html = highlightKql(f, schema);
    if (html.includes('<script')) problems.push(`HIGHLIGHT XSS :: ${f.slice(0, 40)}`);
    else ok++;
  } catch (err) {
    problems.push(`HIGHLIGHT CRASH (${(err as Error).message}) :: ${f.slice(0, 40)}`);
  }
  try {
    // formatting must be lossless: the formatted query has to behave the same
    const once = formatKql(f);
    if (formatKql(once) !== once) problems.push(`FORMAT NOT IDEMPOTENT :: ${f.slice(0, 40)}`);
    else ok++;
  } catch (err) {
    problems.push(`FORMAT CRASH (${(err as Error).message}) :: ${f.slice(0, 40)}`);
  }
}

// Formatting must never change what a query does.
for (const q of [...odd, ...wrong]) {
  let before: string;
  let after: string;
  try {
    const t = runQuery(q, db, opts).table;
    before = `${t.columns.join(',')}|${t.rows.length}`;
  } catch (e) {
    before = `err:${(e as Error).message}`;
  }
  try {
    const t = runQuery(formatKql(q), db, opts).table;
    after = `${t.columns.join(',')}|${t.rows.length}`;
  } catch (e) {
    after = `err:${(e as Error).message}`;
  }
  if (before !== after) problems.push(`FORMAT CHANGED BEHAVIOUR :: ${q}\n    ${before}\n    ${after}`);
  else ok++;
}

// ---- report ----------------------------------------------------------------

console.log(`\n  fuzz: ${ok} probes handled cleanly, ${problems.length} problems\n`);
if (problems.length) {
  for (const p of problems) console.error(`  ISSUE  ${p}`);
  process.exit(1);
}
