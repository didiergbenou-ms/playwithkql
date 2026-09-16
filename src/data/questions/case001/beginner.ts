import type { QuestionSet } from '../types';
import { QUESTION_SET_PLACEHOLDER_NOTICE, reusedQuestion } from '../seed';

/**
 * All five slots reuse existing lessons, including beginner; no new questions or
 * increased difficulty are claimed. Each seed call deep-clones its slot.
 * Replace each lesson's prompt, solution, hints, starter, teaches, and concept
 * (including its example), review remaining lesson fields, and replace evidence.
 * Set each slot's source to 'authored' after replacement. Only after all five
 * slots are reviewed, set questionSetStatus to 'ready' and questionSetNotice to null.
 */
const seeds = [
  reusedQuestion(1),
  reusedQuestion(2),
  reusedQuestion(3),
  reusedQuestion(4),
  reusedQuestion(5),
];

export const QUESTION_SET: QuestionSet = {
  id: '001:beginner',
  caseId: '001',
  difficulty: 'beginner',
  questionSetStatus: 'placeholder',
  questionSetNotice: QUESTION_SET_PLACEHOLDER_NOTICE,
  slots: [
    {
      slot: 1,
      source: 'reused',
      lesson: {
        ...seeds[0].lesson,
        prompt: seeds[0].lesson.prompt,
        solution: seeds[0].lesson.solution,
        hints: seeds[0].lesson.hints,
        starter: seeds[0].lesson.starter,
        teaches: seeds[0].lesson.teaches,
        concept: {
          ...seeds[0].lesson.concept,
          example: { ...seeds[0].lesson.concept.example },
        },
      },
      evidence: { ...seeds[0].evidence },
    },
    {
      slot: 2,
      source: 'reused',
      lesson: {
        ...seeds[1].lesson,
        prompt: seeds[1].lesson.prompt,
        solution: seeds[1].lesson.solution,
        hints: seeds[1].lesson.hints,
        starter: seeds[1].lesson.starter,
        teaches: seeds[1].lesson.teaches,
        concept: {
          ...seeds[1].lesson.concept,
          example: { ...seeds[1].lesson.concept.example },
        },
      },
      evidence: { ...seeds[1].evidence },
    },
    {
      slot: 3,
      source: 'reused',
      lesson: {
        ...seeds[2].lesson,
        prompt: seeds[2].lesson.prompt,
        solution: seeds[2].lesson.solution,
        hints: seeds[2].lesson.hints,
        starter: seeds[2].lesson.starter,
        teaches: seeds[2].lesson.teaches,
        concept: {
          ...seeds[2].lesson.concept,
          example: { ...seeds[2].lesson.concept.example },
        },
      },
      evidence: { ...seeds[2].evidence },
    },
    {
      slot: 4,
      source: 'reused',
      lesson: {
        ...seeds[3].lesson,
        prompt: seeds[3].lesson.prompt,
        solution: seeds[3].lesson.solution,
        hints: seeds[3].lesson.hints,
        starter: seeds[3].lesson.starter,
        teaches: seeds[3].lesson.teaches,
        concept: {
          ...seeds[3].lesson.concept,
          example: { ...seeds[3].lesson.concept.example },
        },
      },
      evidence: { ...seeds[3].evidence },
    },
    {
      slot: 5,
      source: 'reused',
      lesson: {
        ...seeds[4].lesson,
        prompt: seeds[4].lesson.prompt,
        solution: seeds[4].lesson.solution,
        hints: seeds[4].lesson.hints,
        starter: seeds[4].lesson.starter,
        teaches: seeds[4].lesson.teaches,
        concept: {
          ...seeds[4].lesson.concept,
          example: { ...seeds[4].lesson.concept.example },
        },
      },
      evidence: { ...seeds[4].evidence },
    },
  ],
};
