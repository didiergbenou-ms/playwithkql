import type { CaseDefinition } from '../data/cases/types';
import { useStore } from '../state/store';
import { VerdictView } from './VerdictView';

interface Props {
  caseDef: CaseDefinition;
  onClose: () => void;
  onResolved: () => void;
}

export function VerdictModal({ caseDef, onClose, onResolved }: Props) {
  const run = useStore((s) => s.run);
  const submitVerdict = useStore((s) => s.submitVerdict);

  return (
    <VerdictView
      caseDef={caseDef}
      evidenceIds={run.evidence}
      onClose={onClose}
      onCorrect={(optionId) => {
        submitVerdict(optionId, true);
        onResolved();
      }}
    />
  );
}
