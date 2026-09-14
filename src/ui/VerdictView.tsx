import { useState } from 'react';
import type { CaseDefinition } from '../data/cases/types';
import { Collapsible } from './Collapsible';

interface Props {
  caseDef: CaseDefinition;
  evidenceIds: readonly string[];
  onClose: () => void;
  onCorrect: (optionId: string) => void;
}

export function VerdictView({ caseDef, evidenceIds, onClose, onCorrect }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);
  const [showDetail, setShowDetail] = useState(false);

  const collected = caseDef.evidence.filter((evidence) => evidenceIds.includes(evidence.id));
  const pickedOption = caseDef.rootCauses.find((option) => option.id === picked);

  const submit = () => {
    if (!picked) return;
    const option = caseDef.rootCauses.find((rootCause) => rootCause.id === picked);
    if (!option) return;
    if (option.correct) {
      onCorrect(option.id);
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
          <p className="modal-subtitle">
            CASE {caseDef.id} · {caseDef.title}
          </p>
        </div>
        <button className="ghost" onClick={onClose}>
          Esc
        </button>
      </header>

      {caseDef.placeholderNotice && <p className="case-notice compact">{caseDef.placeholderNotice}</p>}

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

          <Collapsible title="Chain so far" badge={`${caseDef.causalChain.length} steps`}>
            <ol className="chain-list">
              {caseDef.causalChain.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          </Collapsible>
        </aside>

        <div className="options">
          {caseDef.rootCauses.map((o) => {
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
