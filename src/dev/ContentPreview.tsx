import { useEffect, useMemo, useRef, useState } from 'react';
import { validateCase } from '../authoring/validateCase';
import { DEFAULT_CASE_ID } from '../data/cases';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../data/difficulties';
import { CaseDifficulty } from '../ui/CaseDifficulty';
import { Briefing } from '../ui/Briefing';
import { TerminalModal } from '../ui/TerminalModal';
import { VerdictView } from '../ui/VerdictView';
import {
  parsePreviewSearch, PREVIEW_CASES, PREVIEW_VIEWS, previewSearch, previewSessionKey,
  shouldClosePreview, previewVariants, type PreviewSelection,
} from './contentPreviewSelection';

function PreviewSession({
  selection, navigate,
}: {
  selection: PreviewSelection;
  navigate: (selection: PreviewSelection) => void;
}) {
  const { caseDef, terminal, view } = selection;
  const [attempts, setAttempts] = useState(0);
  const [hints, setHints] = useState(0);
  const [solutionRevealed, setSolutionRevealed] = useState(false);
  const [solved, setSolved] = useState(false);
  const [verdict, setVerdict] = useState<string | null>(null);
  const region = useRef<HTMLElement>(null);
  const close = () => navigate({ ...selection, view: 'overview' });

  useEffect(() => {
    if (document.activeElement === document.body) region.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      className="content-preview-surface"
      aria-label={`${view} preview`}
      tabIndex={-1}
      ref={region}
      onKeyDown={(event) => {
        if (view !== 'overview' && shouldClosePreview({
          key: event.key,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.nativeEvent.isComposing,
        })) {
          event.preventDefault();
          close();
        }
      }}
    >
      {view === 'overview' && (
        <div className="panel">
          <h2>CASE {caseDef.id} · {caseDef.title}</h2>
          <CaseDifficulty caseDef={caseDef} notice />
          <p>{caseDef.summary}</p>
          {caseDef.placeholderNotice && <p className="case-notice">{caseDef.placeholderNotice}</p>}
          <p>Open any surface directly. Verdict preview includes the full evidence corpus.</p>
          <div className="content-preview-actions">
            {PREVIEW_VIEWS.filter((item) => item !== 'overview').map((item) => (
              <button key={item} className="primary" onClick={() => navigate({ ...selection, view: item })}>
                Open {item}
              </button>
            ))}
          </div>
        </div>
      )}
      {view === 'briefing' && (
        <Briefing
          caseDef={caseDef}
          onBack={close}
          onBegin={() => navigate({ ...selection, view: 'terminal' })}
        />
      )}
      {view === 'terminal' && (
        <>
          <p className="content-preview-status" role="status">
            Local only · Attempts: {attempts} · Hints: {hints} ·
            {' '}{solutionRevealed ? 'Solution revealed' : 'Solution hidden'} ·
            {' '}{solved ? 'Terminal solved — no progress saved.' : 'Not solved'}
          </p>
          <TerminalModal
            caseDef={caseDef}
            spec={terminal}
            alreadySolved={solved}
            hintsUsed={hints}
            crystalsLeft={0}
            onAttempt={() => setAttempts((value) => value + 1)}
            onHint={() => setHints((value) => value + 1)}
            onSpendCrystal={() => false}
            onRevealSolution={() => setSolutionRevealed(true)}
            solutionRevealed={solutionRevealed}
            onSolved={() => setSolved(true)}
            onClose={close}
          />
        </>
      )}
      {view === 'verdict' && (
        <>
          <p className="content-preview-status" role="status">
            {verdict
              ? `Correct verdict: ${caseDef.rootCauses.find((option) => option.id === verdict)?.label}. Preview only — no progress saved.`
              : 'Full evidence corpus supplied locally. Wrong answers show the original rebuttal.'}
          </p>
          <VerdictView
            caseDef={caseDef}
            evidenceIds={caseDef.evidence.map((evidence) => evidence.id)}
            onCorrect={setVerdict}
            onClose={close}
          />
        </>
      )}
    </section>
  );
}

export default function ContentPreview({ initialSearch }: { initialSearch?: string }) {
  const [search, setSearch] = useState(() => initialSearch ?? window.location.search);
  const [reset, setReset] = useState(0);
  const route = useMemo(() => parsePreviewSearch(search), [search]);
  const caseDef = route.selection?.caseDef;
  const issues = useMemo<string[]>(() => {
    if (!caseDef) return [];
    try {
      return validateCase(caseDef);
    } catch (error) {
      return [`Validator could not finish: ${error instanceof Error ? error.message : String(error)}`];
    }
  }, [caseDef]);

  useEffect(() => {
    const onPopState = () => {
      setSearch(window.location.search);
      setReset((value) => value + 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateSearch = (nextSearch: string) => {
    if (nextSearch !== window.location.search) window.history.pushState(null, '', nextSearch);
    setSearch(nextSearch);
    setReset((value) => value + 1);
  };
  const navigate = (next: PreviewSelection) => navigateSearch(previewSearch(next));
  const selection = route.selection;

  return (
    <main className="content-preview">
      <header className="panel content-preview-header">
        <span className="tag tag-amber">DEV · PREVIEW ONLY</span>
        <h1>Content workbench</h1>
        <p>No progress, profile changes, or achievements saved. No game world is running.</p>
        <p className="muted">
          Share the address bar URL. Missing parameters default to case {DEFAULT_CASE_ID}, Beginner, its first
          terminal, and overview. Unknown values are errors. Switching case or difficulty selects its first terminal.
          Switching any selection or resetting clears local attempts, hints, solution, and verdict.
        </p>
        {selection ? (
          <>
            <div className="content-preview-controls">
              <div className="content-preview-control">
                <label htmlFor="preview-case">Case</label>
                <select id="preview-case" value={selection.caseDef.id} onChange={(event) => {
                  navigateSearch(`?${new URLSearchParams({
                    author: '1', case: event.target.value, view: selection.view,
                  })}`);
                }}>
                  {PREVIEW_CASES.map((item) => (
                    <option key={item.id} value={item.id}>{item.id} · {item.title}</option>
                  ))}
                </select>
              </div>
              <div className="content-preview-control">
                <label htmlFor="preview-difficulty">Difficulty</label>
                <select
                  id="preview-difficulty"
                  value={selection.caseDef.difficulty ?? DEFAULT_DIFFICULTY}
                  onChange={(event) => {
                    const params = new URLSearchParams(previewSearch(selection));
                    params.set('difficulty', event.target.value);
                    params.delete('terminal');
                    navigateSearch(`?${params}`);
                  }}
                >
                  {DIFFICULTIES.filter(item => previewVariants(selection.caseDef)
                    .some(variant => (variant.difficulty ?? DEFAULT_DIFFICULTY) === item.id))
                    .map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <div className="content-preview-control">
                <label htmlFor="preview-terminal">Terminal</label>
                <select id="preview-terminal" value={selection.terminal.id} onChange={(event) => {
                  const params = new URLSearchParams(previewSearch(selection));
                  params.set('terminal', event.target.value);
                  navigateSearch(`?${params}`);
                }}>
                  {selection.caseDef.challenges.map((item, index) => (
                    <option key={item.id} value={item.id}>{index + 1} · {item.id} · {item.concept.title}</option>
                  ))}
                </select>
              </div>
              <div className="content-preview-control">
                <label htmlFor="preview-surface">Surface</label>
                <select id="preview-surface" value={selection.view} onChange={(event) => {
                  const params = new URLSearchParams(previewSearch(selection));
                  params.set('view', event.target.value);
                  navigateSearch(`?${params}`);
                }}>
                  {PREVIEW_VIEWS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>
            <div className="content-preview-actions">
              <button className="ghost" onClick={() => setReset((value) => value + 1)}>Reset preview</button>
              <button className="ghost" onClick={() => navigate({ ...selection, view: 'overview' })}>
                Overview / close surface
              </button>
              <a href={previewSearch(selection)}>Link to this preview</a>
              <a href="?">Open game</a>
            </div>
          </>
        ) : (
          <div>
            <p role="alert">{route.error}</p>
            <p>Recover by opening a known case:</p>
            <div className="content-preview-actions">
              {PREVIEW_CASES.map((item) => (
                <a key={item.id} href={`?${new URLSearchParams({ author: '1', case: item.id })}`}>
                  {item.id} · {item.title}
                </a>
              ))}
            </div>
          </div>
        )}
      </header>
      {selection && (
        <>
          <section className="panel content-preview-validation" aria-label="Case validation">
            <h2>Author validation · CASE {selection.caseDef.id}</h2>
            <CaseDifficulty caseDef={selection.caseDef} />
            {issues.length ? (
              <>
                <p>{issues.length} issue{issues.length === 1 ? '' : 's'} to review:</p>
                <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
              </>
            ) : <p>No validator errors.</p>}
          </section>
          <PreviewSession
            key={previewSessionKey(selection, reset)}
            selection={selection}
            navigate={navigate}
          />
        </>
      )}
    </main>
  );
}
