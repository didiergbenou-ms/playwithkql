import { caseDifficultyKey, requireDifficulty } from '../difficulties';
import type { CaseDefinition } from '../cases/types';
import type { QuestionSet } from './types';
import { QUESTION_SET_PLACEHOLDER_NOTICE } from './seed';

const LESSON_FIELDS = [
  'prompt', 'flavour', 'concept', 'teaches', 'hints', 'starter', 'solution',
  'requiredOperators', 'ordered', 'evidenceTokens', 'validation', 'forbiddenOperators',
  'sourceIds', 'sourceTerminalId', 'contentNote',
];

/** Cheap structural checks only. Run validateCase(createCaseVariant(base, set)) for executable checks. */
export function validateQuestionSet(set: QuestionSet, base?: CaseDefinition): string[] {
  const errors: string[] = [];
  const check = (ok: unknown, message: string) => { if (!ok) errors.push(message); };
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  try {
    requireDifficulty(set.difficulty);
    if (set.revision !== undefined) check(text(set.revision) && /^[a-z0-9-]+$/.test(set.revision), 'revision must be a nonempty lowercase identifier');
    check(text(set.caseId) && set.caseId === set.caseId.trim(), 'caseId must be nonempty text without surrounding whitespace');
    check(set.id === caseDifficultyKey(set.caseId, set.difficulty), 'id must match caseId:difficulty');
    if (base) {
      check(set.caseId === base.id, 'caseId must match the base case');
      check(base.challenges.length === 5, 'base case must supply exactly five challenges');
    }
    check(['placeholder', 'ready'].includes(set.questionSetStatus), 'questionSetStatus must be placeholder or ready');
    if (set.questionSetStatus === 'placeholder') {
      check(set.questionSetNotice === QUESTION_SET_PLACEHOLDER_NOTICE, 'placeholder questionSetNotice must disclose reused lessons');
    } else if (set.questionSetStatus === 'ready') {
      check(set.questionSetNotice === null, 'ready questionSetNotice must be null');
    }
    check(Array.isArray(set.slots) && set.slots.length === 5, 'exactly five slots are required');
    check(set.slots.map(item => item.slot).sort().join(',') === '1,2,3,4,5', 'slots must be unique 1..5');
    for (const item of set.slots) {
      const label = `slot ${item.slot}`;
      check(Number.isInteger(item.slot) && item.slot >= 1 && item.slot <= 5, `${label}: slot must be an integer number in 1..5`);
      check(['reused', 'authored'].includes(item.source), `${label}: source must be reused or authored`);
      if (set.questionSetStatus === 'ready') {
        check(item.source === 'authored', `${label}: ready sets require authored lessons, not reused seeds`);
      }
      const lesson = item.lesson;
      check(Object.keys(lesson).every(key => LESSON_FIELDS.includes(key)), `${label}: only lesson fields may be overlaid; wiring and points belong to the base case`);
      for (const key of ['prompt', 'solution', 'teaches'] as const) {
        check(Object.hasOwn(lesson, key) && text(lesson[key]), `${label}: explicit ${key} is required`);
      }
      check(Object.hasOwn(lesson, 'starter') && typeof lesson.starter === 'string', `${label}: explicit starter is required`);
      check(Object.hasOwn(lesson, 'hints') && Array.isArray(lesson.hints)
        && lesson.hints.length >= 3 && lesson.hints.every(text), `${label}: explicit progressive hints are required`);
      check(Object.hasOwn(lesson, 'concept'), `${label}: explicit concept is required`);
      for (const key of ['title', 'body', 'pattern'] as const) {
        check(Object.hasOwn(lesson.concept, key) && text(lesson.concept[key]), `${label}: explicit concept.${key} is required`);
      }
      check(Object.hasOwn(lesson.concept, 'example')
        && Object.hasOwn(lesson.concept.example, 'query') && text(lesson.concept.example.query)
        && Object.hasOwn(lesson.concept.example, 'explain') && text(lesson.concept.example.explain),
        `${label}: explicit worked example is required`);
      check(Object.keys(item.evidence).every(key => ['title', 'detail', 'chainIndex'].includes(key)),
        `${label}: evidence id is derived from the base case`);
      check(Object.hasOwn(item.evidence, 'title') && text(item.evidence.title)
        && Object.hasOwn(item.evidence, 'detail') && text(item.evidence.detail), `${label}: explicit evidence title and detail are required`);
      check(Object.hasOwn(item.evidence, 'chainIndex') && Number.isInteger(item.evidence.chainIndex) && item.evidence.chainIndex >= 0
        && (!base || item.evidence.chainIndex < base.causalChain.length), `${label}: evidence chainIndex must reference the shared causal chain`);
      if (base) {
        const challenge = base.challenges[item.slot - 1];
        check(challenge && base.evidence.some(e => e.id === challenge.evidenceId), `${label}: base challenge must link to evidence`);
      }
    }
    if (set.dataset !== undefined) {
      check(typeof set.dataset.database === 'function' && Array.isArray(set.dataset.tableMeta)
        && set.dataset.tableMeta.length > 0 && set.dataset.now instanceof Date
        && Number.isFinite(set.dataset.now.getTime()), 'dataset override requires database, tableMeta and valid now together');
    }
  } catch (error) {
    errors.push(`invalid question set structure: ${error instanceof Error ? error.message : String(error)}`);
  }
  return errors.map(error => `Question set ${set?.id ?? '<missing id>'}: ${error}`);
}
