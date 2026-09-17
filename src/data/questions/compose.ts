import type { CaseDefinition } from '../cases/types';
import {
  buildCaseSkills, cloneChallenges, cloneDatabase, cloneEvidence, cloneLevel,
  cloneRootCauses, cloneTableMeta,
} from '../cases/placeholder';
import type { QuestionSet } from './types';
import { validateQuestionSet } from './validate';

function freezeContent<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeContent(child);
    Object.freeze(value);
  }
  return value;
}

/** No queries run here. Geometry, story, scoring and wiring always come from the base adapter. */
export function createCaseVariant(base: CaseDefinition, set: QuestionSet): CaseDefinition {
  const errors = validateQuestionSet(set, base);
  if (errors.length) throw new Error(errors.join('\n'));
  const evidence = cloneEvidence(base.evidence);
  const challenges = cloneChallenges(base.challenges).map((challenge, index) => {
    const slot = set.slots.find(item => item.slot === index + 1)!;
    Object.assign(evidence.find(item => item.id === challenge.evidenceId)!, slot.evidence);
    return {
      ...slot.lesson,
      id: set.difficulty === 'beginner' ? challenge.id : `${challenge.id}-${set.difficulty}`,
      room: challenge.room,
      unlocksGate: challenge.unlocksGate,
      evidenceId: challenge.evidenceId,
      points: challenge.points,
    };
  });
  const dataset = set.dataset ?? base;
  const timestamp = dataset.now.getTime();
  const database = dataset.database;
  const variant: CaseDefinition = {
    ...base,
    difficulty: set.difficulty,
    questionSetStatus: set.questionSetStatus,
    questionSetNotice: set.questionSetNotice,
    questionSetRevision: set.revision,
    // Object.freeze(Date) still permits setTime(). Expose a fresh clock instead.
    get now() { return new Date(timestamp); },
    database: () => cloneDatabase(database()),
    tableMeta: cloneTableMeta(dataset.tableMeta),
    challenges: cloneChallenges(challenges),
    evidence,
    rootCauses: cloneRootCauses(base.rootCauses),
    causalChain: [...base.causalChain],
    email: { ...base.email },
    debrief: { ...base.debrief },
    skills: buildCaseSkills(challenges),
    level: cloneLevel(base.level),
    musicTracks: [...base.musicTracks],
  };
  return freezeContent(variant);
}
