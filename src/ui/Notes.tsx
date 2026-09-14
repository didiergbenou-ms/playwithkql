import type { CaseDefinition } from '../data/cases/types';
import { useStore } from '../state/store';
import { getCase } from '../data/cases';

function useActiveCase(caseDef?: CaseDefinition) {
  const runCaseId = useStore((s) => s.run.caseId);
  return caseDef ?? getCase(runCaseId);
}

export function NoteModal({
  caseDef,
  noteId,
  onClose,
}: {
  caseDef?: CaseDefinition;
  noteId: string;
  onClose: () => void;
}) {
  const activeCase = useActiveCase(caseDef);
  const note = activeCase.level.notes.find((item) => item.id === noteId);
  if (!note) return null;
  return (
    <div className="modal note-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-amber">FIELD NOTE</span>
          <h2>{note.title}</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>
      <pre className="note-body">{note.body}</pre>
      <footer className="modal-foot">
        <button className="primary" onClick={onClose}>
          Pocket it
        </button>
      </footer>
    </div>
  );
}

export function Notebook({ caseDef, onClose }: { caseDef?: CaseDefinition; onClose: () => void }) {
  const activeCase = useActiveCase(caseDef);
  const run = useStore((s) => s.run);
  return (
    <NotebookView
      caseDef={activeCase}
      notesRead={run.notesRead}
      evidenceIds={run.evidence}
      onClose={onClose}
    />
  );
}

export function NotebookView({
  caseDef, notesRead, evidenceIds, onClose,
}: {
  caseDef: CaseDefinition;
  notesRead: readonly string[];
  evidenceIds: readonly string[];
  onClose: () => void;
}) {
  const fieldNotes = caseDef.level.notes.filter((note) => notesRead.includes(note.id));
  const collected = caseDef.evidence.filter((evidence) => evidenceIds.includes(evidence.id));
  const knownSteps = new Set(collected.map((evidence) => evidence.chainIndex));

  return (
    <div className="modal notebook-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">INVESTIGATION NOTES</span>
          <h2>
            CASE {caseDef.id} · Notebook
          </h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>

      <section aria-label="Pocketed field notes">
        <h3>Field notes · {fieldNotes.length} of {caseDef.level.notes.length} pocketed</h3>
        {fieldNotes.length === 0 ? (
          <p className="muted">No field notes pocketed yet. Read a note in the world to keep it here.</p>
        ) : (
          <ul className="evidence-list field-notes-list">
            {fieldNotes.map((note) => (
              <li key={note.id}>
                <strong>{note.title}</strong>
                <pre className="note-body">{note.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Filed query evidence">
        <h3>Query evidence · {collected.length} of {caseDef.evidence.length} filed</h3>
        {collected.length === 0 ? (
          <p className="muted">No query evidence yet. Solve a terminal to file evidence.</p>
        ) : (
          <ul className="evidence-list">
            {collected.map((e) => (
              <li key={e.id}>
                <strong>{e.title}</strong>
                <p>{e.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="chain">
        <h3>Working theory</h3>
        <p className="muted">These steps unlock from terminal evidence, not field notes.</p>
        <ol>
          {caseDef.causalChain.map((step, i) => (
            <li key={step} className={knownSteps.has(i) ? 'lit' : ''}>
              {knownSteps.has(i) ? step : 'Awaiting query evidence'}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
