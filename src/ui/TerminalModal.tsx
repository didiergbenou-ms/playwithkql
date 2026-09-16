import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseDefinition } from '../data/cases/types';
import type { ChallengeSpec } from '../kql/challenge';
import type { GradeResult } from '../kql/challenge';
import { toDisplayString } from '../kql/evaluator';
import { collectFeatures, KqlError, parse } from '../kql/index';
import { gradeInWorker, queryInWorker, type WorkerTask } from '../kql/workerClient';
import { formatKql, withSourceTable } from '../kql/format';
import type { Table } from '../kql/types';
import { KqlEditor } from './KqlEditor';
import { Collapsible } from './Collapsible';
import { audio } from '../game/audio';
import { DEFAULT_CASE_ID, getCase } from '../data/cases';

interface Props {
  caseDef?: CaseDefinition;
  spec: ChallengeSpec;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  alreadySolved: boolean;
  /**
   * Hints already revealed for this challenge, however they were paid for.
   * Seeded from the store rather than local state alone, or closing the
   * terminal would spend a crystal and then hide the hint it bought.
   */
  hintsUsed: number;
  crystalsLeft: number;
  onAttempt: () => void;
  onHint: () => void;
  onSpendCrystal: () => boolean;
  /** Records that the reference answer was revealed, so it counts as help. */
  onRevealSolution: () => void;
  /** True when it was already revealed on a previous visit. */
  solutionRevealed: boolean;
  onSolved: (query: string) => void;
  onClose: () => void;
}

const MAX_ROWS_SHOWN = 50;

export function getLiveQueryFeatures(query: string): Set<string> {
  if (!query.trim()) return new Set<string>();
  try {
    return collectFeatures(parse(query));
  } catch (err) {
    if (err instanceof KqlError) return new Set<string>();
    throw err;
  }
}

function ResultTable({
  table,
  meta,
  showTypes,
}: {
  table: Table;
  meta: CaseDefinition['tableMeta'];
  showTypes?: boolean;
}) {
  const rows = table.rows.slice(0, MAX_ROWS_SHOWN);
  const tableMeta = meta.find((item) => item.name.toLowerCase() === table.name.toLowerCase());

  if (!table.rows.length) {
    return <p className="result-empty">0 rows. The query is valid — it just matched nothing.</p>;
  }
  return (
    <>
      <p className="result-meta">
        {table.rows.length} row{table.rows.length === 1 ? '' : 's'} · {table.columns.length} column
        {table.columns.length === 1 ? '' : 's'}
        {table.rows.length > MAX_ROWS_SHOWN ? ` · showing first ${MAX_ROWS_SHOWN}` : ''}
      </p>
      <div className="result-wrap">
        <table className="result">
          <thead>
            <tr>
              {table.columns.map((c) => {
                const col = tableMeta?.columns.find((m) => m.name === c);
                return (
                  <th key={c}>
                    {c}
                    {showTypes && col && <em>{col.type}</em>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {table.columns.map((c) => {
                  const text = toDisplayString(r[c] ?? null);
                  // Long values (log messages) must wrap, not ellipsis — the
                  // text is often the actual evidence the player needs to read.
                  return (
                    <td key={c} className={text.length > 60 ? 'wrap' : ''} title={text}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function TerminalModal({
  caseDef = getCase(DEFAULT_CASE_ID),
  spec,
  initialQuery,
  onQueryChange,
  alreadySolved,
  hintsUsed,
  crystalsLeft,
  onAttempt,
  onHint,
  onSpendCrystal,
  onRevealSolution,
  solutionRevealed,
  onSolved,
  onClose,
}: Props) {
  const db = useMemo(() => caseDef.database(), [caseDef]);
  const [query, setQuery] = useState(() => initialQuery ?? formatKql(spec.starter));
  const queryRef = useRef(query);
  const [result, setResult] = useState<{ query: string; grade: GradeResult } | null>(null);
  const [running, setRunning] = useState(false);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);
  const pending = useRef<WorkerTask<GradeResult> | null>(null);
  const [revealed, setRevealed] = useState(hintsUsed);
  const [showSolution, setShowSolution] = useState(false);
  const [solvedNow, setSolvedNow] = useState(alreadySolved);
  /** New terminals open on Learn; revisits go straight to the task. */
  const [pane, setPane] = useState<'learn' | 'task'>(
    alreadySolved || initialQuery !== undefined ? 'task' : 'learn',
  );
  const [exampleResult, setExampleResult] = useState<Table | null>(null);
  const [exampleError, setExampleError] = useState<string | null>(null);

  useEffect(() => () => {
    const task = pending.current;
    pending.current = null;
    task?.cancel();
  }, []);

  const cancelRun = (message: string | null) => {
    const task = pending.current;
    pending.current = null;
    task?.cancel();
    setRunning(false);
    setExecutionMessage(message);
  };

  const changeQuery = (next: string) => {
    if (next === queryRef.current) return;
    if (pending.current) cancelRun('Query changed. Run it again to get a current result.');
    else setExecutionMessage(null);
    queryRef.current = next;
    setQuery(next);
    onQueryChange?.(next);
  };

  const resetQuery = () => {
    cancelRun(null);
    const starter = formatKql(spec.starter);
    queryRef.current = starter;
    setQuery(starter);
    onQueryChange?.(starter);
    setResult(null);
  };

  /** The table this challenge is really about — drives the preview panel. */
  const focusTable = useMemo(() => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(spec.solution);
    return m?.[1] ?? 'Heartbeat';
  }, [spec.solution]);

  const preview = useMemo(() => {
    const source = db[focusTable];
    return source ? { ...source, rows: source.rows.slice(0, 8) } : null;
  }, [focusTable, db]);

  const focusMeta = caseDef.tableMeta.find((table) => table.name.toLowerCase() === focusTable.toLowerCase());
  const evidence = spec.evidenceId
    ? caseDef.evidence.find((item) => item.id === spec.evidenceId)
    : undefined;

  const run = () => {
    if (pending.current) return;
    const submittedQuery = queryRef.current;
    const task = gradeInWorker(spec, submittedQuery, db, caseDef.now);
    pending.current = task;
    setRunning(true);
    setExecutionMessage(null);
    task.promise.then((graded) => {
      if (pending.current !== task) return;
      pending.current = null;
      setRunning(false);
      setResult({ query: submittedQuery, grade: graded });
      if (graded.errorSource === 'reference' || graded.errorSource === 'comparison') {
        setExecutionMessage('The terminal could not grade this query. No attempt recorded.');
        return;
      }
      onAttempt();
      if (graded.status === 'correct' && !solvedNow) {
        setSolvedNow(true);
        onSolved(submittedQuery);
      } else if (graded.status !== 'correct') {
        audio.play('wrong');
      }
    }, (error: unknown) => {
      if (pending.current !== task) return;
      pending.current = null;
      setRunning(false);
      setExecutionMessage(`${error instanceof Error ? error.message : String(error)} No attempt recorded.`);
    });
  };

  const revealHint = () => {
    if (revealed >= spec.hints.length) return;
    setRevealed(revealed + 1);
    // a crystal buys the hint outright; otherwise it costs score
    if (!onSpendCrystal()) onHint();
  };

  useEffect(() => {
    if (pane !== 'learn') return;
    setExampleResult(null);
    setExampleError(null);
    let current = true;
    const task = queryInWorker(spec.concept.example.query, db, caseDef.now);
    task.promise.then(({ table }) => {
      if (current) setExampleResult(table);
    }, (error: unknown) => {
      if (current) setExampleError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      current = false;
      task.cancel();
    };
  }, [caseDef, spec, db, pane]);

  // live check state, shown before the player runs anything
  const usedOps = useMemo(() => {
    return getLiveQueryFeatures(query);
  }, [query]);

  const graded = result?.grade;
  const resultCurrent = result !== null && result.query === query && !running;
  const checks = [
    ...(spec.requiredOperators ?? []).map((op) => ({
      label: (
        <>
          Uses the <code>{op}</code> operator
        </>
      ),
      done: usedOps.has(op.toLowerCase()),
    })),
    {
      label: <>Result matches the expected answer</>,
      done: resultCurrent && graded?.status === 'correct',
    },
  ];

  return (
    <div className="modal terminal-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-amber">KQL TERMINAL</span>
          <h2>{spec.flavour ?? 'Query terminal'}</h2>
          <p className="modal-subtitle">
            CASE {caseDef.id} · {caseDef.title}
          </p>
        </div>
        <button className="ghost" onClick={onClose}>
          Close (Esc)
        </button>
      </header>

      <div className="pane-tabs">
        <button className={pane === 'learn' ? 'on' : ''} onClick={() => setPane('learn')}>
          1 · Learn
        </button>
        <button className={pane === 'task' ? 'on' : ''} onClick={() => setPane('task')}>
          2 · Solve it
        </button>
      </div>

      {caseDef.placeholderNotice && <p className="case-notice compact">{caseDef.placeholderNotice}</p>}

      {pane === 'learn' ? (
        <div className="learn-pane">
          <h2 className="learn-title">{spec.concept.title}</h2>
          {spec.concept.body.split('\n\n').map((p, i) => (
            <p key={i} className="learn-body">
              {p}
            </p>
          ))}

          <h3>The shape</h3>
          <pre className="learn-pattern">{spec.concept.pattern}</pre>

          <h3>Worked example</h3>
          <pre className="learn-example">{formatKql(spec.concept.example.query)}</pre>
          <p className="learn-body">{spec.concept.example.explain}</p>
          <p className="example-caption">What that example returns:</p>
          {exampleResult ? <ResultTable table={exampleResult} meta={caseDef.tableMeta} showTypes />
            : exampleError ? <p role="alert" className="hint-line">Example could not run: {exampleError}</p>
              : <p role="status" className="muted">Loading example result...</p>}

          <div className="learn-actions">
            <button
              className="ghost"
              onClick={() => {
                changeQuery(formatKql(spec.concept.example.query));
                setPane('task');
              }}
            >
              Try this example myself
            </button>
            <button className="primary big" onClick={() => setPane('task')}>
              Got it — show me the task
            </button>
          </div>
        </div>
      ) : (
        <div className="terminal-body">
        <aside className="brief-col">
          <div className="step-block">
            <span className="step-label">Step 1 · Your task</span>
            <p className="objective">{spec.prompt}</p>
          </div>

          <ul className="checks">
            {checks.map((c, i) => (
              <li key={i} className={c.done ? 'done' : ''}>
                <i>{c.done ? '\u25C9' : '\u25CB'}</i>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>

          {/* Column names stay visible even when the schema is collapsed — you
              cannot write the query without them, so hiding them would just
              make people open the panel every time. Types and docs are the
              bulk, and those do collapse. */}
          {focusMeta && (
            <div className="focus-cols">
              <span className="focus-cols-label">
                Columns in <button className="schema-name" onClick={() => changeQuery(withSourceTable(query, focusTable))}>{focusTable}</button>
              </span>
              <div className="schema-cols">
                {focusMeta.columns.map((c) => (
                  <span key={c.name} className="col-chip" title={`${c.type} — ${c.doc}`}>
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Collapsible title="Full schema" badge={`${caseDef.tableMeta.length} tables`}>
            {caseDef.tableMeta.map((t) => (
              <div key={t.name} className={`schema-table ${t.name === focusTable ? 'focus' : ''}`}>
                <div className="schema-head">
                  <button className="schema-name" onClick={() => changeQuery(withSourceTable(query, t.name))}>
                    {t.name}
                  </button>
                  <span className="schema-rows">{db[t.name]?.rows.length ?? 0} rows</span>
                </div>
                <p className="schema-doc">{t.doc}</p>
                <div className="schema-cols">
                  {t.columns.map((c) => (
                    <span key={c.name} className="col-chip" title={c.doc}>
                      {c.name}
                      <em>{c.type}</em>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </Collapsible>

          <Collapsible
            title="Stuck?"
            badge={revealed > 0 ? `${revealed} hint${revealed > 1 ? 's' : ''} used` : undefined}
          >
            <div className="assist">
              <button className="ghost small" onClick={revealHint} disabled={revealed >= spec.hints.length}>
                {revealed >= spec.hints.length
                  ? 'No hints left'
                  : crystalsLeft > 0
                    ? `Hint ${revealed + 1}/${spec.hints.length} — free (uses a crystal)`
                    : `Hint ${revealed + 1}/${spec.hints.length} — costs 20%`}
              </button>
              <button className="ghost small" onClick={() => setPane('learn')}>
                Re-read the lesson
              </button>
              <button
                className="ghost small"
                onClick={() => {
                  // Record before showing. Revealing the answer is assistance,
                  // and unrecorded it let a player reveal, paste and submit
                  // while still collecting the unaided-solve rewards.
                  if (!showSolution) onRevealSolution();
                  setShowSolution((s) => !s);
                }}
              >
                {showSolution
                  ? 'Hide solution'
                  : solutionRevealed
                    ? 'Show solution'
                    : 'Show solution — counts as help'}
              </button>
            </div>

            {revealed > 0 && (
              <ul className="hints">
                {spec.hints.slice(0, revealed).map((h, i) => (
                  <li key={i}>
                    <code>{formatKql(h)}</code>
                  </li>
                ))}
              </ul>
            )}

            {showSolution && (
              <div className="solution">
                <strong>Reference solution</strong>
                <code>{formatKql(spec.solution)}</code>
                <button className="ghost small" onClick={() => changeQuery(formatKql(spec.solution))}>
                  Copy into editor
                </button>
              </div>
            )}
          </Collapsible>
        </aside>

        <div className="editor-col">
          <span className="step-label">Step 2 · Write the query</span>
          <KqlEditor value={query} onChange={changeQuery} onRun={run} meta={caseDef.tableMeta} autoFocus />

          <div className="editor-actions">
            <button className="primary big" onClick={run} disabled={running}>
              Run query <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
            </button>
            {running && <button className="ghost small" onClick={() => cancelRun('Query cancelled. No attempt recorded.')}>Cancel query</button>}
            <button className="ghost small" onClick={resetQuery}>
              Reset
            </button>
            <button
              className="ghost small"
              onClick={() => changeQuery(formatKql(query))}
              title="One operator per line"
            >
              Format
            </button>
          </div>
          <span className="editor-tip">
            <kbd>Ctrl</kbd>+<kbd>Space</kbd> suggestions · wrong answers cost nothing
          </span>

          {running && <p role="status">Running query... You can cancel without losing your draft.</p>}
          {executionMessage && <p role="alert" className="hint-line">{executionMessage}</p>}
          {result && graded && (
            <div className={`verdict-box ${resultCurrent ? graded.status : 'stale'}`}>
              <strong>
                {!resultCurrent
                  ? 'PREVIOUS RESULT'
                  : graded.errorSource === 'reference' || graded.errorSource === 'comparison'
                    ? 'TERMINAL ERROR'
                    : graded.status === 'correct'
                  ? 'ACCEPTED'
                  : graded.status === 'error'
                    ? 'QUERY ERROR'
                    : 'NOT QUITE'}
              </strong>
              {!resultCurrent && <p role="status">This result is from the previous run, not a new evaluation of the editor. Run query to update it.</p>}
              <p>{graded.message}</p>
              {graded.caret && <pre className="caret">{graded.caret}</pre>}
              {graded.hint && <p className="hint-line">{graded.hint}</p>}
              {graded.diff?.map((d, i) => (
                <p key={i} className="hint-line">
                  {d}
                </p>
              ))}
              {resultCurrent && graded.status === 'correct' && (
                <>
                  <p className="teaches">
                    <span className="tag tag-cyan">WHY IT WORKS</span> {spec.teaches}
                  </p>
                  {evidence && (
                    <p className="teaches">
                      <span className="tag tag-amber">WHAT IT PROVES</span> {evidence.detail}
                    </p>
                  )}
                  <p className="read-result">
                    Your result is below — read it before you move on. That table is the evidence.
                  </p>
                </>
              )}
            </div>
          )}

          {/* No tabs here any more. The old version defaulted to a sample-data
              tab rendered with this same table component, so an untouched
              terminal looked like it had already produced a result. Your
              result now has one fixed home that stays empty until you run
              something, and sample data is a separate, clearly-marked box. */}
          <div className="step-block result-block">
            <span className="step-label">Step 3 · Your result</span>
            {graded?.table ? (
              <>
                {!resultCurrent && <p className="sample-warn">Previous run output - it does not describe the current editor.</p>}
                <ResultTable table={graded.table} meta={caseDef.tableMeta} showTypes />
              </>
            ) : (
              <p className="result-empty">
                Nothing yet — press <strong>Run query</strong> and the rows land here.
              </p>
            )}
          </div>

          <Collapsible
            title={`Peek at ${focusTable}`}
            badge={`sample of ${db[focusTable]?.rows.length ?? 0} rows`}
          >
            {focusMeta && <p className="preview-doc">{focusMeta.doc}</p>}
            <p className="sample-warn">
              This is raw sample data to show you the shape of the table. It is not your query
              result.
            </p>
            {preview && <ResultTable table={preview} meta={caseDef.tableMeta} showTypes />}
          </Collapsible>
        </div>
        </div>
      )}

      {solvedNow && (
        <footer className="modal-foot">
          <span className="solved-flag">Lock disengaged — evidence filed.</span>
          <button className="primary" onClick={onClose}>
            Back to the field
          </button>
        </footer>
      )}
    </div>
  );
}
