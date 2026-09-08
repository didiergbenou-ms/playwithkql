import { REFERENCE } from '../state/store';

/** Always-available syntax card, so nobody has to burn a hint on "what was the syntax again?". */
export function ReferenceCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal reference-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-cyan">FIELD CARD</span>
          <h2>KQL quick reference</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Close (Esc)
        </button>
      </header>

      <p className="muted pad-b">
        Free to open, any time. Looking something up costs you nothing — only hints do.
      </p>

      <div className="ref-grid">
        {REFERENCE.map((g) => (
          <section key={g.group} className="ref-group">
            <h3>{g.group}</h3>
            <ul>
              {g.entries.map((e) => (
                <li key={e.syntax}>
                  <code className="ref-syntax">{e.syntax}</code>
                  <span className="ref-what">{e.what}</span>
                  <code className="ref-example">{e.example}</code>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
