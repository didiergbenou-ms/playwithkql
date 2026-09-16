interface DraftRun {
  runId: number;
  caseId: string;
  drafts: Map<string, string>;
}

// Kept outside the persisted store: typing must not rewrite the saved profile.
let active: DraftRun | undefined;

export function beginDraftRun(runId: number, caseId: string): void {
  active = { runId, caseId, drafts: new Map() };
}

export function getQueryDraft(runId: number, caseId: string, challengeId: string): string | undefined {
  return active?.runId === runId && active.caseId === caseId
    ? active.drafts.get(challengeId)
    : undefined;
}

export function saveQueryDraft(runId: number, caseId: string, challengeId: string, query: string): void {
  if (!active || active.runId !== runId || active.caseId !== caseId) {
    throw new Error('Cannot save a query draft for an inactive run.');
  }
  active.drafts.set(challengeId, query);
}
