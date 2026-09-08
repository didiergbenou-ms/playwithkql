import { CAUSAL_CHAIN, EVIDENCE } from '../data/case001';
import { NOTES } from '../game/levels/heartbeatHills';
import { useStore } from '../state/store';

export function NoteModal({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const note = NOTES.find((n) => n.id === noteId);
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

export function Notebook({ onClose }: { onClose: () => void }) {
  const run = useStore((s) => s.run);
  const collected = EVIDENCE.filter((e) => run.evidence.includes(e.id));

  return (
    <div className="modal notebook-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">INVESTIGATION NOTES</span>
          <h2>
            {collected.length} of {EVIDENCE.length} filed
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
          {CAUSAL_CHAIN.map((step, i) => (
            <li key={step} className={i < collected.length ? 'lit' : ''}>
              {i < collected.length ? step : '???'}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
