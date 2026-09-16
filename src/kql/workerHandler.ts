import { gradeChallenge } from './challenge';
import { runQuery } from './index';
import { KqlError } from './types';
import type { SerializedWorkerError, WorkerRequest, WorkerResponse } from './workerProtocol';

function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof KqlError) {
    return { name: error.name, message: error.message, pos: error.pos, hint: error.hint };
  }
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

/** Pure job dispatch, imported by the worker entry and Node tests only. */
export function executeWorkerRequest(request: WorkerRequest): WorkerResponse {
  try {
    switch (request.kind) {
      case 'query':
        return {
          kind: 'query-result',
          id: request.id,
          result: runQuery(request.query, request.database, { now: request.now }),
        };
      case 'grade':
        return {
          kind: 'grade-result',
          id: request.id,
          result: gradeChallenge(request.spec, request.query, request.database, request.now),
        };
      default:
        throw new Error('Unknown worker request kind.');
    }
  } catch (error) {
    return {
      kind: 'error',
      id: request.id,
      code: request.kind === 'query' && error instanceof KqlError ? 'kql' : 'crashed',
      error: serializeError(error),
    };
  }
}
