import { CHALLENGES, EVIDENCE } from '../case001';
import type { QuestionSlot, TerminalSlot } from './types';

export const QUESTION_SET_PLACEHOLDER_NOTICE = 'Difficulty questions pending; currently reuses existing lessons';

/** Copies the existing corpus, not a new lesson or a claim of increased difficulty. */
export function reusedQuestion(slot: TerminalSlot): QuestionSlot {
  const challenge = CHALLENGES[slot - 1];
  if (!challenge) throw new Error(`Unknown terminal slot "${slot}"`);
  const evidence = EVIDENCE.find(item => item.id === challenge.evidenceId);
  if (!evidence) throw new Error(`Missing seed evidence for slot ${slot}`);
  return {
    slot,
    source: 'reused',
    lesson: {
      prompt: challenge.prompt,
      flavour: challenge.flavour,
      teaches: challenge.teaches,
      starter: challenge.starter,
      solution: challenge.solution,
      hints: [...challenge.hints],
      requiredOperators: challenge.requiredOperators ? [...challenge.requiredOperators] : undefined,
      evidenceTokens: challenge.evidenceTokens ? [...challenge.evidenceTokens] : undefined,
      ordered: challenge.ordered,
      concept: { ...challenge.concept, example: { ...challenge.concept.example } },
    },
    evidence: { title: evidence.title, detail: evidence.detail, chainIndex: evidence.chainIndex },
  };
}
