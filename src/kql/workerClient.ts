import type { ChallengeSpec, GradeResult } from './challenge';
import type { QueryResult } from './index';
import { KqlError, type Database } from './types';
import { isWorkerResponse, type WorkerRequest, type WorkerResponse } from './workerProtocol';

export const WORKER_STARTUP_TIMEOUT_MS = 10_000;
export const WORKER_EXECUTION_TIMEOUT_MS = 2_000;

export type WorkerTaskErrorCode = 'cancelled' | 'timeout' | 'unavailable' | 'crashed' | 'protocol';
export type WorkerTaskPhase = 'startup' | 'execution';

export class WorkerTaskError extends Error {
  constructor(
    readonly code: WorkerTaskErrorCode,
    message: string,
    readonly phase?: WorkerTaskPhase,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'WorkerTaskError';
  }
}

export interface WorkerTask<T> {
  promise: Promise<T>;
  cancel(): void;
}

export interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface WorkerTimers {
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(handle: number): void;
}

export interface WorkerTaskOptions {
  startupTimeoutMs?: number;
  executionTimeoutMs?: number;
  workerFactory?: () => WorkerPort;
  timers?: WorkerTimers;
}

function createWorker(): WorkerPort {
  if (typeof Worker === 'undefined') {
    throw new WorkerTaskError('unavailable', 'Browser workers are unavailable. No query was run.', 'startup');
  }
  return new Worker(new URL('./query.worker.ts', import.meta.url), { type: 'module' });
}

let nextId = 0;

function startTask<T>(
  request: WorkerRequest,
  accept: (response: WorkerResponse) => T,
  options: WorkerTaskOptions = {},
): WorkerTask<T> {
  let worker: WorkerPort | undefined;
  let timer: number | undefined;
  let settled = false;
  let phase: WorkerTaskPhase = 'startup';
  let rejectTask: (error: Error) => void = () => {};
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle: number) => globalThis.clearTimeout(handle),
  };

  function cleanup() {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    }
  }

  const promise = new Promise<T>((resolve, reject) => {
    rejectTask = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    function deadline(milliseconds: number) {
      timer = timers.setTimeout(() => rejectTask(new WorkerTaskError(
        'timeout',
        phase === 'startup'
          ? 'The query worker could not start in time. No grading result was produced.'
          : 'The query worker exceeded its execution time limit. No grading result was produced.',
        phase,
      )), milliseconds);
    }

    const startupMs = options.startupTimeoutMs ?? WORKER_STARTUP_TIMEOUT_MS;
    const executionMs = options.executionTimeoutMs ?? WORKER_EXECUTION_TIMEOUT_MS;
    if (![startupMs, executionMs].every(ms => Number.isFinite(ms) && ms > 0)) {
      rejectTask(new WorkerTaskError('protocol', 'Worker deadlines must be positive finite milliseconds.', phase));
      return;
    }
    try {
      worker = (options.workerFactory ?? createWorker)();
    } catch (error) {
      rejectTask(error instanceof WorkerTaskError ? error : new WorkerTaskError(
        'unavailable', 'The query worker could not be created. No query was run.', phase, error,
      ));
      return;
    }

    worker.onerror = (event) => {
      event.preventDefault();
      rejectTask(new WorkerTaskError(
        'crashed', `The query worker failed${event.message ? `: ${event.message}` : '.'}`, phase,
      ));
    };
    worker.onmessageerror = () => rejectTask(new WorkerTaskError(
      'protocol', 'The query worker response could not be decoded.', phase,
    ));
    worker.onmessage = (event) => {
      if (settled) return;
      const response = event.data;
      if (!isWorkerResponse(response)) {
        rejectTask(new WorkerTaskError('protocol', 'The query worker sent a malformed response.', phase));
        return;
      }
      if (response.kind === 'ready') {
        if (phase !== 'startup') {
          rejectTask(new WorkerTaskError('protocol', 'The query worker sent duplicate readiness.', phase));
          return;
        }
        if (timer !== undefined) timers.clearTimeout(timer);
        phase = 'execution';
        deadline(executionMs);
        try {
          worker?.postMessage(request);
        } catch (error) {
          rejectTask(new WorkerTaskError(
            'protocol', 'The query job could not be sent to the worker (structured clone failed).', phase, error,
          ));
        }
        return;
      }
      if (phase !== 'execution' || response.id !== request.id) {
        rejectTask(new WorkerTaskError('protocol', 'The query worker sent an unexpected job response.', phase));
        return;
      }
      if (response.kind === 'error') {
        if (response.code === 'kql' && request.kind === 'query') {
          rejectTask(new KqlError(response.error.message, response.error.pos, response.error.hint));
        } else {
          rejectTask(new WorkerTaskError(
            response.code === 'kql' ? 'protocol' : 'crashed',
            `The query worker failed unexpectedly: ${response.error.message}`, phase, response.error,
          ));
        }
        return;
      }
      try {
        const result = accept(response);
        settled = true;
        cleanup();
        resolve(result);
      } catch (error) {
        rejectTask(error instanceof WorkerTaskError ? error : new WorkerTaskError(
          'protocol', 'The query worker returned an unexpected result.', phase, error,
        ));
      }
    };
    deadline(startupMs);
  });

  return {
    promise,
    cancel: () => rejectTask(new WorkerTaskError('cancelled', 'Query worker task cancelled.', phase)),
  };
}

export function queryInWorker(
  query: string, database: Database, now: Date, options?: WorkerTaskOptions,
): WorkerTask<QueryResult> {
  return startTask({ kind: 'query', id: String(++nextId), query, database, now }, response => {
    if (response.kind !== 'query-result') {
      throw new WorkerTaskError('protocol', 'Expected a query result from the worker.', 'execution');
    }
    return response.result;
  }, options);
}

export function gradeInWorker(
  spec: ChallengeSpec, query: string, database: Database, now: Date, options?: WorkerTaskOptions,
): WorkerTask<GradeResult> {
  return startTask({ kind: 'grade', id: String(++nextId), spec, query, database, now }, response => {
    if (response.kind !== 'grade-result') {
      throw new WorkerTaskError('protocol', 'Expected a grading result from the worker.', 'execution');
    }
    return response.result;
  }, options);
}
