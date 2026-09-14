import { DEFAULT_CASE_ID } from '../data/cases';
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

export function parsePreviewSearch(search: string): PreviewRoute {
  const params = new URLSearchParams(search);
  for (const name of ['author', 'case', 'terminal', 'view']) {
    if (params.getAll(name).length > 1) return { error: `Duplicate "${name}" parameter. Keep one value.` };
  }
  if (params.get('author') !== '1') return { error: 'Content preview requires author=1.' };

  const caseId = params.get('case') ?? DEFAULT_CASE_ID;
  const caseDef = PREVIEW_CASES.find((candidate) => candidate.id === caseId);
  if (!caseDef) return { error: `Unknown case "${caseId}". Choose a case below.` };

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
    author: '1', case: caseDef.id, terminal: terminal.id, view,
  })}`;
}

export function previewSessionKey(selection: PreviewSelection, reset: number): string {
  return JSON.stringify([selection.caseDef.id, selection.terminal.id, selection.view, reset]);
}

export function shouldClosePreview(event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'isComposing'>): boolean {
  return event.key === 'Escape' && !event.defaultPrevented && !event.isComposing;
}
