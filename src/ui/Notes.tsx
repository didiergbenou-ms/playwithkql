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
  const collected = activeCase.evidence.filter((evidence) => run.evidence.includes(evidence.id));

  return (
    <div className="modal notebook-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">INVESTIGATION NOTES</span>
          <h2>
            CASE {activeCase.id} · {collected.length} of {activeCase.evidence.length} filed
          </h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>

      {collected.length === 0 ? (
        <p className="muted pad">
          Nothing filed yet. Solve a terminal to add evidence to the case.
        </p>
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

      <section className="chain">
        <h3>Working theory</h3>
        <ol>
          {activeCase.causalChain.map((step, i) => (
            <li key={step} className={i < collected.length ? 'lit' : ''}>
              {i < collected.length ? step : '???'}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
