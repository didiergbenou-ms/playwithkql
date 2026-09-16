import type { Difficulty } from '../difficulties';
import type { CaseDefinition, Evidence } from '../cases/types';
import type { ChallengeSpec } from '../../kql/challenge';

export type TerminalSlot = 1 | 2 | 3 | 4 | 5;
export type QuestionLesson = Omit<ChallengeSpec, 'id' | 'room' | 'unlocksGate' | 'evidenceId' | 'points'>;
export type QuestionEvidence = Omit<Evidence, 'id'>;

export interface QuestionSlot {
  /** Stable authoring identity is `${questionSet.id}:${slot}`. */
  slot: TerminalSlot;
  /** Change to authored only after replacing the complete lesson and reviewing its evidence. */
  source: 'reused' | 'authored';
  lesson: QuestionLesson;
  evidence: QuestionEvidence;
}

export interface QuestionSet {
  /** Must equal caseDifficultyKey(caseId, difficulty). */
  id: string;
  caseId: string;
  difficulty: Difficulty;
  questionSetStatus: 'placeholder' | 'ready';
  questionSetNotice: string | null;
  slots: QuestionSlot[];
  /** Atomic override: never change query data without its schema and reference clock. */
  dataset?: Pick<CaseDefinition, 'database' | 'tableMeta' | 'now'>;
}
