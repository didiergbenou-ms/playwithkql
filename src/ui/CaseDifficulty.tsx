import { DIFFICULTIES } from '../data/difficulties';
import type { CaseDefinition } from '../data/cases/types';

export function CaseDifficulty({ caseDef, notice = false }: { caseDef: CaseDefinition; notice?: boolean }) {
  const difficulty = DIFFICULTIES.find(item => item.id === caseDef.difficulty);
  if (!difficulty) return null;
  return (
    <div className="case-difficulty">
      <span className="tag tag-cyan">{difficulty.label}</span>
      {caseDef.questionSetStatus === 'placeholder' && <span className="muted"> Questions pending</span>}
      {notice && caseDef.questionSetNotice && <p className="case-notice compact">{caseDef.questionSetNotice}</p>}
    </div>
  );
}
