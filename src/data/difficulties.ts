export type Difficulty = 'beginner' | 'intermediate' | 'expert';

export const DEFAULT_DIFFICULTY: Difficulty = 'beginner';

export const DIFFICULTIES: readonly Readonly<{
  id: Difficulty;
  label: string;
  description: string;
}>[] = Object.freeze([
  Object.freeze({ id: 'beginner' as const, label: 'Beginner', description: 'Five terminal slots for beginner questions in this case.' }),
  Object.freeze({ id: 'intermediate' as const, label: 'Intermediate', description: 'Five terminal slots for intermediate questions in this case.' }),
  Object.freeze({ id: 'expert' as const, label: 'Expert', description: 'Five terminal slots for expert questions in this case.' }),
]);

export function requireDifficulty(value: string): Difficulty {
  const found = DIFFICULTIES.find(item => item.id === value);
  if (!found) throw new Error(`Unknown difficulty "${value}"`);
  return found.id;
}

export function caseDifficultyKey(caseId: string, difficulty: Difficulty): string {
  return `${caseId}:${requireDifficulty(difficulty)}`;
}
