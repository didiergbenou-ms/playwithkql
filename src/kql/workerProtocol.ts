import type { ChallengeSpec, GradeResult } from './challenge';
import type { QueryResult } from './index';
import type { Database } from './types';

interface Job {
  id: string;
  query: string;
  database: Database;
  now: Date;
}

export type WorkerRequest =
  | (Job & { kind: 'query' })
  | (Job & { kind: 'grade'; spec: ChallengeSpec });

export interface SerializedWorkerError {
  name: string;
  message: string;
  pos?: number;
  hint?: string;
}

export type WorkerResponse =
  | { kind: 'ready' }
  | { kind: 'query-result'; id: string; result: QueryResult }
  | { kind: 'grade-result'; id: string; result: GradeResult }
  | { kind: 'error'; id: string; code: 'kql' | 'crashed'; error: SerializedWorkerError };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function table(value: unknown): boolean {
  return record(value) && typeof value.name === 'string'
    && strings(value.columns) && Array.isArray(value.rows) && value.rows.every(record);
}

// The worker is trusted; validate the envelope and result shape, not every cell.
export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!record(value)) return false;
  if (value.kind === 'ready') return true;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (value.kind === 'error') {
    const error = value.error;
    return (value.code === 'kql' || value.code === 'crashed')
      && record(error) && typeof error.name === 'string' && typeof error.message === 'string'
      && (error.pos === undefined || (typeof error.pos === 'number' && Number.isInteger(error.pos)))
      && (error.hint === undefined || typeof error.hint === 'string');
  }
  if (!record(value.result)) return false;
  const result = value.result;
  if (result.visualization !== undefined &&
    (!record(result.visualization) ||
      (result.visualization.kind !== 'timechart' && result.visualization.kind !== 'columnchart'))) return false;
  if (value.kind === 'query-result') {
    return table(result.table) && result.features instanceof Set
      && [...result.features].every(feature => typeof feature === 'string');
  }
  if (value.kind === 'grade-result') {
    return (result.status === 'correct' || result.status === 'incorrect' || result.status === 'error')
      && typeof result.message === 'string'
      && (result.errorSource === undefined || (result.status === 'error'
        && (result.errorSource === 'query' || result.errorSource === 'reference' || result.errorSource === 'comparison')))
      && (result.table === undefined || table(result.table))
      && (result.hint === undefined || typeof result.hint === 'string')
      && (result.caret === undefined || typeof result.caret === 'string')
      && (result.diff === undefined || strings(result.diff));
  }
  return false;
}
