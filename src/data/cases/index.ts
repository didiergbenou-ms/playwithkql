import { CASE001 } from './case001';
import { CASE002 } from './case002';
import { CASE003 } from './case003';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, caseDifficultyKey, requireDifficulty, type Difficulty } from '../difficulties';
import { QUESTION_SETS, createCaseVariant } from '../questions';
import type { CaseDefinition } from './types';

export type { CaseDefinition } from './types';

const BASE_CASES = [CASE001, CASE002, CASE003];
const variants = new Map<string, CaseDefinition>();
if (QUESTION_SETS.length !== BASE_CASES.length * DIFFICULTIES.length
  || new Set(QUESTION_SETS.map(set => set.id)).size !== QUESTION_SETS.length) {
  throw new Error('Question registry must contain exactly one set per case and difficulty');
}
for (const base of BASE_CASES) {
  for (const { id: difficulty } of DIFFICULTIES) {
    const key = caseDifficultyKey(base.id, difficulty);
    const set = QUESTION_SETS.find(candidate => candidate.id === key);
    if (!set || set.difficulty !== difficulty) throw new Error(`Missing or inconsistent question set "${key}"`);
    variants.set(key, createCaseVariant(base, set));
  }
}

export const DEFAULT_CASE_ID = '001';

/** Stable canonical identity; importing this registry never executes lesson queries. */
export function getCase(id: string, difficulty: Difficulty = DEFAULT_DIFFICULTY): CaseDefinition {
  requireDifficulty(difficulty);
  if (!BASE_CASES.some(base => base.id === id)) throw new Error(`Unknown case id "${id}"`);
  const found = variants.get(caseDifficultyKey(id, difficulty));
  if (!found) throw new Error(`Missing case variant "${id}:${difficulty}"`);
  return found;
}

export function getCaseVariants(id: string): CaseDefinition[] {
  return DIFFICULTIES.map(difficulty => getCase(id, difficulty.id));
}

export const CASE_VARIANTS: readonly CaseDefinition[] = Object.freeze([...variants.values()]);
// Keep the existing array type for menu consumers; the runtime registry is immutable.
export const CASES: CaseDefinition[] = BASE_CASES.map(base => getCase(base.id));
Object.freeze(CASES);
