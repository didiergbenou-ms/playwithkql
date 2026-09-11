import { CASE001 } from './case001';
import { CASE002 } from './case002';
import { CASE003 } from './case003';

export type { CaseDefinition } from './types';

export const CASES = [CASE001, CASE002, CASE003];

export const DEFAULT_CASE_ID = '001';

export function getCase(id: string) {
  const found = CASES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown case id "${id}"`);
  // Definitions are authored once. Stable identity keeps React effects and
  // memoized databases from restarting on every HUD update.
  return found;
}
