import type { Difficulty } from '../difficulties';
import type { QuestionLesson, QuestionSet, TerminalSlot } from '../questions/types';
import { buildCurriculumDatabase, curriculumNow, curriculumTableMeta } from './dataset';

export type CurriculumValidation =
  | { mode: 'rowCount'; expectedRowCount: number }
  | { mode: 'schema'; expectedColumns: string[]; expectedRowCount?: number }
  | { mode: 'orderedBy'; column: string; direction: 'asc' | 'desc'; expectedRowCount?: number; expectedColumns?: string[] };

export interface LessonDraft {
  title: string;
  prompt: string;
  body: string;
  pattern: string;
  example: { query: string; explain: string; allowEmpty?: boolean };
  solution: string;
  hints: [string, string];
  operators?: string[];
  forbidden?: string[];
  ordered?: boolean;
  validation?: CurriculumValidation;
  sourceIds: string[];
  sourceTerminalId: string | null;
  adaptation?: string;
  evidence: { title: string; detail: string; chainIndex: number };
}

export function authoredSet(caseId: string, difficulty: Difficulty, drafts: LessonDraft[]): QuestionSet {
  if (drafts.length !== 5) throw new Error(`${caseId}:${difficulty} requires five lessons`);
  return {
    id: `${caseId}:${difficulty}`, caseId, difficulty,
    revision: 'march-2026-v1',
    questionSetStatus: 'ready', questionSetNotice: null,
    dataset: { database: buildCurriculumDatabase, tableMeta: curriculumTableMeta(), get now() { return curriculumNow(); } },
    slots: drafts.map((draft, index) => {
      const lesson: QuestionLesson = {
        prompt: draft.prompt,
        flavour: `${draft.title} — March 11 incident desk. Query time is fixed at 12:00Z.`,
        concept: { title: draft.title, body: draft.body, pattern: draft.pattern, example: { ...draft.example } },
        teaches: `${draft.body}\n\nFinding: ${draft.evidence.detail}`,
        starter: '',
        solution: draft.solution,
        hints: [...draft.hints, draft.solution],
        requiredOperators: [...(draft.operators ?? [])],
        forbiddenOperators: [...(draft.forbidden ?? [])],
        ordered: draft.ordered ?? false,
        ...(draft.validation ? { validation: draft.validation } : {}),
        sourceIds: [...draft.sourceIds],
        ...(draft.sourceTerminalId ? { sourceTerminalId: draft.sourceTerminalId } : {}),
        contentNote: [
          'Adapted from provided curriculum; provisional review. Ready means runnable, not editorial approval.',
          draft.sourceTerminalId ? `Pack topic ${draft.sourceTerminalId}.` : 'Locally authored fifth terminal; sourceTerminalId: null.',
          draft.adaptation ?? 'Reworded for the three-map, five-terminal-per-difficulty adaptation.',
        ].join(' '),
      };
      return { slot: (index + 1) as TerminalSlot, source: 'authored', lesson, evidence: { ...draft.evidence } };
    }),
  };
}
