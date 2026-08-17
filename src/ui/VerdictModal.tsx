import { useState } from 'react';
import { CAUSAL_CHAIN, EVIDENCE, ROOT_CAUSES } from '../data/case001';
import { useStore } from '../state/store';

interface Props {
  onClose: () => void;
  onResolved: () => void;
}

export function VerdictModal({ onClose, onResolved }: Props) {
  const run = useStore((s) => s.run);
  const submitVerdict = useStore((s) => s.submitVerdict);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);

  const collected = EVIDENCE.filter((e) => run.evidence.includes(e.id));

  const submit = () => {
    if (!picked) return;
    const option = ROOT_CAUSES.find((o) => o.id === picked);
    if (!option) return;
    if (option.correct) {
      submitVerdict(option.id, true);
      onResolved();
    } else {
      setWrong((w) => [...new Set([...w, option.id])]);
      setPicked(null);
    }
  };

  return (
    <div className="modal verdict-modal">
      <header className="modal-head">
        <div>
          <span className="tag tag-magenta">VERDICT CONSOLE</span>
          <h2>Name the root cause</h2>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>

      <div className="verdict-body">
        <aside>
          <h3>Evidence on file</h3>
          <ul className="evidence-list compact">
            {collected.map((e) => (
              <li key={e.id}>
                <strong>{e.title}</strong>
                <p>{e.detail}</p>
              </li>
            ))}
          </ul>
          <h3>Chain</h3>
          <ol className="chain-list">
            {CAUSAL_CHAIN.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </aside>

        <div className="options">
          {ROOT_CAUSES.map((o) => {
            const ruledOut = wrong.includes(o.id);
            return (
              <button
                key={o.id}
                className={`option ${picked === o.id ? 'picked' : ''} ${ruledOut ? 'ruled-out' : ''}`}
                onClick={() => !ruledOut && setPicked(o.id)}
                disabled={ruledOut}
              >
                <strong>{o.label}</strong>
                <span>{o.detail}</span>
                {ruledOut && <em className="rebuttal">Ruled out — {o.rebuttal}</em>}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="modal-foot">
        <span className="muted">
          {wrong.length > 0
            ? `${wrong.length} theor${wrong.length === 1 ? 'y' : 'ies'} ruled out. Wrong answers cost you nothing but time.`
            : 'Read the evidence. Pick the one theory the evidence cannot contradict.'}
        </span>
        <button className="primary" onClick={submit} disabled={!picked}>
          Submit verdict
        </button>
      </footer>
    </div>
  );
}
