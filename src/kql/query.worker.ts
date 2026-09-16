import { executeWorkerRequest } from './workerHandler';
import type { WorkerRequest, WorkerResponse } from './workerProtocol';

// DOM and worker globals overlap here; no WebWorker lib or Window-wide cast needed.
const workerScope: {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
} = globalThis;

workerScope.addEventListener('message', (event) => {
  // Keep posting outside the handler's catch: serialization failures are worker errors.
  workerScope.postMessage(executeWorkerRequest(event.data));
});
workerScope.postMessage({ kind: 'ready' });
