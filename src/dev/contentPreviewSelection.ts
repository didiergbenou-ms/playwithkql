import { CASES, DEFAULT_CASE_ID, getCaseVariants } from '../data/cases';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../data/difficulties';
import type { CaseDefinition } from '../data/cases/types';
import type { ChallengeSpec } from '../kql/challenge';
import { AUTHORING_CASES } from '../authoring/catalog';

export const PREVIEW_CASES = AUTHORING_CASES;
export const PREVIEW_VIEWS = ['overview', 'briefing', 'terminal', 'verdict'] as const;
export type PreviewView = (typeof PREVIEW_VIEWS)[number];

export interface PreviewSelection {
  caseDef: CaseDefinition;
  terminal: ChallengeSpec;
  view: PreviewView;
}

export type PreviewRoute = { selection: PreviewSelection; error?: never } |
  { error: string; selection?: never };

export function previewVariants(caseDef: CaseDefinition): readonly CaseDefinition[] {
  return CASES.some(item => item.id === caseDef.id) ? getCaseVariants(caseDef.id) : [caseDef];
}

export function parsePreviewSearch(search: string): PreviewRoute {
  const params = new URLSearchParams(search);
  for (const name of ['author', 'case', 'difficulty', 'terminal', 'view']) {
    if (params.getAll(name).length > 1) return { error: `Duplicate "${name}" parameter. Keep one value.` };
  }
  if (params.get('author') !== '1') return { error: 'Content preview requires author=1.' };

  const caseId = params.get('case') ?? DEFAULT_CASE_ID;
  const base = PREVIEW_CASES.find((candidate) => candidate.id === caseId);
  if (!base) return { error: `Unknown case "${caseId}". Choose a case below.` };
  const requestedDifficulty = params.get('difficulty') ?? base.difficulty ?? DEFAULT_DIFFICULTY;
  if (!DIFFICULTIES.some(item => item.id === requestedDifficulty)) {
    return { error: `Unknown difficulty "${requestedDifficulty}". Choose beginner, intermediate, or expert.` };
  }
  const caseDef = previewVariants(base).find(item => (item.difficulty ?? DEFAULT_DIFFICULTY) === requestedDifficulty);
  if (!caseDef) return { error: `Case "${caseId}" has no ${requestedDifficulty} question set.` };

  const terminalId = params.get('terminal') ?? caseDef.challenges[0]?.id;
  const terminal = caseDef.challenges.find((candidate) => candidate.id === terminalId);
  if (!terminal) return { error: `Unknown or missing terminal "${terminalId ?? ''}" for case ${caseId}.` };

  const requestedView = params.get('view') ?? 'overview';
  const view = PREVIEW_VIEWS.find((candidate) => candidate === requestedView);
  if (!view) {
    return { error: `Unknown view "${requestedView}". Use overview, briefing, terminal, or verdict.` };
  }
  return { selection: { caseDef, terminal, view } };
}

export function previewSearch({ caseDef, terminal, view }: PreviewSelection): string {
  return `?${new URLSearchParams({
    author: '1', case: caseDef.id, difficulty: caseDef.difficulty ?? DEFAULT_DIFFICULTY, terminal: terminal.id, view,
  })}`;
}

export function previewSessionKey(selection: PreviewSelection, reset: number): string {
  return JSON.stringify([selection.caseDef.id, selection.caseDef.difficulty ?? DEFAULT_DIFFICULTY, selection.terminal.id, selection.view, reset]);
}

export function shouldClosePreview(event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'isComposing'>): boolean {
  return event.key === 'Escape' && !event.defaultPrevented && !event.isComposing;
}
