import { QUESTION_SET as case001Beginner } from './case001/beginner';
import { QUESTION_SET as case001Intermediate } from './case001/intermediate';
import { QUESTION_SET as case001Expert } from './case001/expert';
import { QUESTION_SET as case002Beginner } from './case002/beginner';
import { QUESTION_SET as case002Intermediate } from './case002/intermediate';
import { QUESTION_SET as case002Expert } from './case002/expert';
import { QUESTION_SET as case003Beginner } from './case003/beginner';
import { QUESTION_SET as case003Intermediate } from './case003/intermediate';
import { QUESTION_SET as case003Expert } from './case003/expert';
import type { QuestionSet } from './types';

export const QUESTION_SETS: readonly QuestionSet[] = Object.freeze([
  case001Beginner, case001Intermediate, case001Expert,
  case002Beginner, case002Intermediate, case002Expert,
  case003Beginner, case003Intermediate, case003Expert,
]);

export type { QuestionSet, QuestionSlot, QuestionLesson, QuestionEvidence, TerminalSlot } from './types';
export { createCaseVariant } from './compose';
export { validateQuestionSet } from './validate';
