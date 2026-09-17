import type { CaseDefinition } from '../data/cases/types';
import { getCase } from '../data/cases';
import { DIFFICULTIES, type Difficulty } from '../data/difficulties';
import { getCaseResult, useStore } from '../state/store';
import { CaseDifficulty } from './CaseDifficulty';
import { CompactMenuDetails } from './MainMenu';

interface Props {
  caseDef: CaseDefinition;
  selected: Difficulty;
  onSelect: (difficulty: Difficulty) => void;
  onContinue: () => void;
  onBack: () => void;
}

const compactDescriptions: Record<Difficulty, string> = {
  beginner: 'Start with query basics',
  intermediate: 'Build multi-step queries',
  expert: 'Take on advanced queries',
};

function completionText(record: ReturnType<typeof getCaseResult>) {
  return record
    ? `Completed ${record.completions} time${record.completions === 1 ? '' : 's'} · Best ${record.bestScore}/1000`
    : 'Not completed';
}

export function DifficultySelect({ caseDef, selected, onSelect, onContinue, onBack }: Props) {
  const profile = useStore(state => state.profile);
  const selectedVariant = getCase(caseDef.id, selected);
  const selectedDifficulty = DIFFICULTIES.find(difficulty => difficulty.id === selected)!;
  return (
    <div className="screen difficulty-screen compact-menu">
      <header className="select-head">
        <span className="tag tag-amber">CASE {caseDef.id} · {caseDef.title}</span>
        <h1>Choose difficulty</h1>
        <p className="muted compact-menu-desktop">Same map and investigation. Choose the question set for its five terminals.</p>
      </header>
      <div className="difficulty-grid" role="group" aria-label="Case difficulty">
        {DIFFICULTIES.map((difficulty, index) => {
          const variant = getCase(caseDef.id, difficulty.id);
          const record = getCaseResult(profile, caseDef.id, difficulty.id);
          return (
            <button
              key={difficulty.id}
              type="button"
              className={`panel difficulty-card ${selected === difficulty.id ? 'chosen' : ''}`}
              aria-label={`Select ${difficulty.label} difficulty`}
              aria-pressed={selected === difficulty.id}
              onClick={() => onSelect(difficulty.id)}
            >
              <span className="difficulty-number" aria-hidden="true">{['I', 'II', 'III'][index]}</span>
              <strong>{difficulty.label}</strong>
              <span className="compact-menu-desktop">{difficulty.description}</span>
              <span className="compact-menu-phone compact-menu-tier-description">{compactDescriptions[difficulty.id]}</span>
              <span className="tag tag-amber">5 terminals</span>
              {variant.questionSetStatus === 'placeholder' && (
                <span className="prototype-note">Placeholder questions · final content pending</span>
              )}
              <span className="difficulty-record">
                {completionText(record)}
              </span>
            </button>
          );
        })}
      </div>
      <section className="panel compact-menu-difficulty-footer">
        <CompactMenuDetails label="Difficulty details & record">
        <div className="compact-menu-phone">
          <h2>{selectedDifficulty.label}</h2>
          <p>{selectedDifficulty.description}</p>
          <p>{completionText(getCaseResult(profile, caseDef.id, selected))}</p>
          {selectedVariant.questionSetStatus === 'placeholder' && (
            <p className="prototype-note">Placeholder questions · final content pending</p>
          )}
          <p className="muted">Same map and investigation. Choose the question set for its five terminals.</p>
        </div>
        <CaseDifficulty caseDef={caseDef} notice />
        <p className="muted">Progress is tracked separately for each case and difficulty. Movement and character abilities do not change.</p>
        {caseDef.questionSetRevision && <p className="muted">Completion shown here is for these lesson versions. Earlier scores and completion history are preserved separately.</p>}
        </CompactMenuDetails>
        <footer className="brief-actions">
          <button className="ghost" onClick={onBack}>Back to cases</button>
          <button className="primary big" onClick={onContinue}>Choose recruit</button>
        </footer>
      </section>
    </div>
  );
}
