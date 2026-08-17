import { useState } from 'react';
import { CAUSAL_CHAIN, EVIDENCE, ROOT_CAUSES } from '../data/case001';
import { useStore } from '../state/store';
import { Collapsible } from './Collapsible';

interface Props {
  onClose: () => void;
  onResolved: () => void;
}

export function VerdictModal({ onClose, onResolved }: Props) {
  const run = useStore((s) => s.run);
  const submitVerdict = useStore((s) => s.submitVerdict);
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  const collected = EVIDENCE.filter((e) => run.evidence.includes(e.id));
  const pickedOption = ROOT_CAUSES.find((o) => o.id === picked);

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

      <p className="verdict-lede">
        Pick the one theory your evidence cannot contradict, then submit. Wrong answers cost
        nothing but time.
      </p>

      <div className="verdict-body">
        <aside>
          <div className="evidence-head">
            <h3>Evidence on file</h3>
            <button className="ghost small" onClick={() => setShowDetail((s) => !s)}>
              {showDetail ? 'Hide detail' : 'Show detail'}
            </button>
          </div>
          {/* Titles are the part you scan while comparing theories; the detail
              paragraphs are what pushed the submit button off screen. */}
          <ul className={`evidence-list compact ${showDetail ? '' : 'titles-only'}`}>
            {collected.map((e) => (
              <li key={e.id}>
                <strong>{e.title}</strong>
                {showDetail && <p>{e.detail}</p>}
              </li>
            ))}
          </ul>

          <Collapsible title="Chain so far" badge={`${CAUSAL_CHAIN.length} steps`}>
            <ol className="chain-list">
              {CAUSAL_CHAIN.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </Collapsible>
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

      {/* Sticky, because this modal scrolls and the button used to sit below
          six evidence cards and a causal chain - far past the fold. */}
      <footer className="modal-foot verdict-foot">
        <span className="muted">
          {pickedOption ? (
            <>
              Selected: <strong className="picked-name">{pickedOption.label}</strong>
            </>
          ) : wrong.length > 0 ? (
            `${wrong.length} theor${wrong.length === 1 ? 'y' : 'ies'} ruled out — pick another.`
          ) : (
            'Choose a theory above to enable submit.'
          )}
        </span>
        <button className="primary big" onClick={submit} disabled={!picked}>
          Submit verdict
        </button>
      </footer>
    </div>
  );
}
