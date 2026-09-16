import assert from 'node:assert/strict';
import { gradeChallenge, type ChallengeSpec, type GradeResult } from '../src/kql/challenge';
import { runQuery, type QueryResult } from '../src/kql/index';
import { isTimespan, KqlError, timespan, type Database } from '../src/kql/types';
import {
  gradeInWorker,
  queryInWorker,
  WORKER_EXECUTION_TIMEOUT_MS,
  WORKER_STARTUP_TIMEOUT_MS,
  WorkerTaskError,
  type WorkerPort,
  type WorkerTask,
  type WorkerTaskErrorCode,
  type WorkerTaskOptions,
  type WorkerTaskPhase,
  type WorkerTimers,
} from '../src/kql/workerClient';
import { executeWorkerRequest } from '../src/kql/workerHandler';
import { isWorkerResponse, type WorkerRequest, type WorkerResponse } from '../src/kql/workerProtocol';

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (error) {
    failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface TimerEntry {
  id: number;
  at: number;
  milliseconds: number;
  callback: () => void;
}

class FakeTimers implements WorkerTimers {
  now = 0;
  private nextId = 1;
  readonly pending = new Map<number, TimerEntry>();
  readonly scheduled: TimerEntry[] = [];

  setTimeout = (callback: () => void, milliseconds: number): number => {
    const entry = { id: this.nextId++, at: this.now + milliseconds, milliseconds, callback };
    this.pending.set(entry.id, entry);
    this.scheduled.push(entry);
    return entry.id;
  };

  clearTimeout = (handle: number): void => {
    this.pending.delete(handle);
  };

  advance(milliseconds: number) {
    assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0);
    const target = this.now + milliseconds;
    for (;;) {
      const next = [...this.pending.values()]
        .filter(entry => entry.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.now = next.at;
      this.pending.delete(next.id);
      next.callback();
    }
    this.now = target;
  }
}

function messageEvent(data: unknown): MessageEvent<unknown> {
  return { data: structuredClone(data) } as MessageEvent<unknown>;
}

function errorEvent(message = 'worker exploded') {
  let prevented = 0;
  return {
    event: { message, preventDefault: () => { prevented++; } } as ErrorEvent,
    prevented: () => prevented,
  };
}

class FakeWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  readonly requests: WorkerRequest[] = [];
  postAttempts = 0;
  terminateCount = 0;

  postMessage(request: WorkerRequest) {
    this.postAttempts++;
    this.requests.push(structuredClone(request));
  }

  terminate() {
    this.terminateCount++;
  }

  emit(data: unknown) {
    this.onmessage?.(messageEvent(data));
  }

  ready() {
    this.emit({ kind: 'ready' });
  }

  request(): WorkerRequest {
    assert.equal(this.requests.length, 1, 'exactly one job must be posted');
    return this.requests[0];
  }

  respond(): WorkerResponse {
    const response = executeWorkerRequest(this.request());
    assert.ok(isWorkerResponse(response), 'real handler must return a valid response');
    this.emit(response);
    return response;
  }

  capture() {
    const { onmessage, onerror, onmessageerror } = this;
    assert.ok(onmessage && onerror && onmessageerror, 'all callback properties must be installed');
    return { onmessage, onerror, onmessageerror };
  }
}

function harness(overrides: Pick<WorkerTaskOptions, 'startupTimeoutMs' | 'executionTimeoutMs'> = {}) {
  const timers = new FakeTimers();
  const workers: FakeWorker[] = [];
  const options: WorkerTaskOptions = {
    ...overrides,
    timers,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  };
  return {
    timers,
    workers,
    options,
    worker: () => {
      assert.equal(workers.length, 1);
      return workers[0];
    },
  };
}

type Outcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

function observe<T>(task: WorkerTask<T>): Outcome<T>[] {
  const outcomes: Outcome<T>[] = [];
  // Attach both handlers immediately, including for synchronously rejected tasks.
  void task.promise.then(
    value => { outcomes.push({ status: 'fulfilled', value }); },
    reason => { outcomes.push({ status: 'rejected', reason }); },
  );
  return outcomes;
}

async function pending<T>(outcomes: Outcome<T>[]) {
  await Promise.resolve();
  assert.equal(outcomes.length, 0, 'task must still be pending');
}

async function fulfilled<T>(outcomes: Outcome<T>[]): Promise<T> {
  // Inspect after a microtask rather than awaiting a possibly never-settling task.
  await Promise.resolve();
  assert.equal(outcomes.length, 1, 'task must settle exactly once');
  const outcome = outcomes[0];
  assert.equal(outcome.status, 'fulfilled');
  assert.ok(outcome.status === 'fulfilled');
  return outcome.value;
}

async function rejected<T>(outcomes: Outcome<T>[]): Promise<unknown> {
  await Promise.resolve();
  assert.equal(outcomes.length, 1, 'task must settle exactly once');
  const outcome = outcomes[0];
  assert.equal(outcome.status, 'rejected');
  assert.ok(outcome.status === 'rejected');
  return outcome.reason;
}

async function taskError<T>(
  outcomes: Outcome<T>[], code: WorkerTaskErrorCode, phase: WorkerTaskPhase,
): Promise<WorkerTaskError> {
  const error = await rejected(outcomes);
  assert.ok(error instanceof WorkerTaskError, 'infrastructure failures are not grading results');
  assert.equal(error.name, 'WorkerTaskError');
  assert.equal(error.code, code);
  assert.equal(error.phase, phase);
  return error;
}

function cleaned(worker: FakeWorker, timers: FakeTimers) {
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
  assert.equal(worker.terminateCount, 1, 'terminate must run exactly once');
  assert.equal(timers.pending.size, 0, 'no timer may survive settlement');
}

const NOW = new Date('2026-09-16T09:45:00.000Z');

function database(): Database {
  return {
    Events: {
      name: 'Events',
      columns: ['Id', 'When', 'Duration', 'Details'],
      rows: [
        { Id: 2, When: new Date(NOW.getTime() - 30_000), Duration: timespan(1_500), Details: { tags: ['b'], optional: null } },
        { Id: 1, When: new Date(NOW.getTime() - 90_000), Duration: timespan(2_500), Details: { tags: ['a'], optional: null } },
        { Id: 3, When: new Date(NOW.getTime() - 7_200_000), Duration: timespan(3_500), Details: { tags: [], optional: null } },
      ],
    },
  };
}

function challenge(overrides: Partial<ChallengeSpec> = {}): ChallengeSpec {
  return {
    id: 'worker-test',
    prompt: 'Return event IDs in ascending order.',
    concept: {
      title: 'Ordering',
      body: 'Order event IDs.',
      pattern: 'Events | sort by Id asc',
      example: { query: 'Events | sort by Id asc', explain: 'Ascending event IDs.' },
    },
    teaches: 'Ordering',
    hints: [],
    starter: 'Events',
    solution: 'Events | project Id | sort by Id asc',
    room: 0,
    points: 1,
    ...overrides,
  };
}

function queryResponse(id: string): WorkerResponse {
  return {
    kind: 'query-result',
    id,
    result: { table: { name: 'Events', columns: ['Id'], rows: [{ Id: 1 }] }, features: new Set(['project']) },
  };
}

function gradeResponse(id: string): WorkerResponse {
  return { kind: 'grade-result', id, result: { status: 'correct', message: 'Accepted' } };
}

await check('startup defaults to 10000ms; no job or execution timer before ready', async () => {
  assert.equal(WORKER_STARTUP_TIMEOUT_MS, 10_000);
  assert.equal(WORKER_EXECUTION_TIMEOUT_MS, 2_000);
  const h = harness();
  const task = queryInWorker('Events', database(), NOW, h.options);
  const outcomes = observe(task);
  const worker = h.worker();
  worker.capture();
  assert.deepEqual(h.timers.scheduled.map(timer => timer.milliseconds), [10_000]);
  h.timers.advance(2_000);
  await pending(outcomes);
  assert.equal(worker.postAttempts, 0);
  h.timers.advance(7_999);
  await pending(outcomes);
  h.timers.advance(1);
  await taskError(outcomes, 'timeout', 'startup');
  assert.equal(worker.postAttempts, 0);
  cleaned(worker, h.timers);
  task.cancel();
  cleaned(worker, h.timers);
});

await check('delayed ready receives the full 2000ms execution window', async () => {
  const h = harness();
  const task = queryInWorker('Events', database(), NOW, h.options);
  const outcomes = observe(task);
  const worker = h.worker();
  h.timers.advance(9_999);
  await pending(outcomes);
  worker.ready();
  assert.equal(worker.request().kind, 'query');
  assert.deepEqual(h.timers.scheduled.map(timer => timer.milliseconds), [10_000, 2_000]);
  assert.equal(h.timers.pending.size, 1);
  assert.equal([...h.timers.pending.values()][0].at, 11_999);
  h.timers.advance(1);
  await pending(outcomes);
  h.timers.advance(1_998);
  await pending(outcomes);
  h.timers.advance(1);
  await taskError(outcomes, 'timeout', 'execution');
  cleaned(worker, h.timers);
});

await check('custom deadlines apply independently to startup and execution', async () => {
  const h = harness({ startupTimeoutMs: 50, executionTimeoutMs: 80 });
  const task = queryInWorker('Events', database(), NOW, h.options);
  const outcomes = observe(task);
  h.timers.advance(49);
  h.worker().ready();
  h.timers.advance(79);
  await pending(outcomes);
  assert.deepEqual(h.timers.scheduled.map(timer => timer.milliseconds), [50, 80]);
  h.timers.advance(1);
  await taskError(outcomes, 'timeout', 'execution');
  cleaned(h.worker(), h.timers);
});

for (const field of ['startupTimeoutMs', 'executionTimeoutMs'] as const) {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    await check(`${field} rejects invalid deadline ${value} before creating a worker`, async () => {
      const h = harness({ [field]: value });
      const outcomes = observe(queryInWorker('Events', database(), NOW, h.options));
      await taskError(outcomes, 'protocol', 'startup');
      assert.equal(h.workers.length, 0);
      assert.equal(h.timers.scheduled.length, 0);
      assert.equal(h.timers.pending.size, 0);
    });
  }
}

await check('real query round-trip clones Date, Timespan, nested values and feature Set', async () => {
  const h = harness();
  const db = database();
  const before = structuredClone(db);
  const now = new Date(NOW);
  const query = 'Events | where When > ago(1h) | extend CapturedNow = now(), Elapsed = now() - When';
  const expected = runQuery(query, db, { now });
  const task = queryInWorker(query, db, now, h.options);
  const outcomes = observe(task);
  const worker = h.worker();
  const late = worker.capture();
  h.timers.advance(9_500);
  worker.ready();
  const request = worker.request();
  assert.equal(request.query, query);
  assert.ok(request.id.length > 0);
  assert.deepEqual(request.database, db);
  assert.notEqual(request.database, db);
  assert.notEqual(request.database.Events.rows[0], db.Events.rows[0]);
  assert.ok(request.now instanceof Date);
  assert.notEqual(request.now, now);
  assert.equal(request.now.getTime(), now.getTime());
  assert.ok(request.database.Events.rows[0].When instanceof Date);
  assert.ok(isTimespan(request.database.Events.rows[0].Duration));
  assert.notEqual(request.database.Events.rows[0].Duration, db.Events.rows[0].Duration);
  h.timers.advance(1_999);
  await pending(outcomes);
  const response = worker.respond();
  assert.equal(response.kind, 'query-result');
  assert.ok(response.kind === 'query-result');
  assert.equal(response.id, request.id);
  const result = await fulfilled(outcomes);
  assert.deepEqual(result, expected);
  assert.notEqual(result, response.result);
  assert.notEqual(result.table, response.result.table);
  assert.notEqual(result.features, response.result.features);
  assert.ok(result.features instanceof Set);
  assert.ok(result.features.has('where') && result.features.has('ago') && result.features.has('now'));
  assert.deepEqual(result.table.rows.map(row => row.Id), [2, 1]);
  const row = result.table.rows[0];
  assert.ok(row.When instanceof Date);
  assert.ok(row.CapturedNow instanceof Date);
  assert.equal(row.CapturedNow.getTime(), now.getTime());
  assert.deepEqual(row.Duration, timespan(1_500));
  assert.deepEqual(row.Elapsed, timespan(30_000));
  assert.deepEqual(row.Details, { tags: ['b'], optional: null });
  assert.notEqual(row.When, response.result.table.rows[0].When);
  assert.notEqual(row.Duration, response.result.table.rows[0].Duration);
  assert.notEqual(row.Details, response.result.table.rows[0].Details);
  assert.deepEqual(db, before);
  cleaned(worker, h.timers);
  task.cancel();
  task.cancel();
  late.onmessage(messageEvent({ kind: 'ready' }));
  late.onmessage(messageEvent(queryResponse(request.id)));
  late.onerror(errorEvent().event);
  late.onmessageerror(messageEvent(null));
  for (const timer of h.timers.scheduled) timer.callback();
  h.timers.advance(20_000);
  assert.equal(await fulfilled(outcomes), result);
  assert.equal(worker.postAttempts, 1);
  cleaned(worker, h.timers);
});

for (const kind of ['query', 'grade'] as const) {
  for (const phase of ['startup', 'execution'] as const) {
    await check(`${kind} cancellation during ${phase} is idempotent and ignores captured late callbacks`, async () => {
      const h = harness();
      const task: WorkerTask<QueryResult | GradeResult> = kind === 'query'
        ? queryInWorker('Events', database(), NOW, h.options)
        : gradeInWorker(challenge(), 'Events', database(), NOW, h.options);
      const outcomes = observe(task);
      const worker = h.worker();
      if (phase === 'execution') worker.ready();
      const late = worker.capture();
      const lateTimers = [...h.timers.pending.values()];
      const request = worker.requests[0];
      const posts = worker.postAttempts;
      await pending(outcomes);
      task.cancel();
      task.cancel();
      const cancellation = await taskError(outcomes, 'cancelled', phase);
      cleaned(worker, h.timers);
      const lateResponse = request
        ? executeWorkerRequest(request)
        : kind === 'query' ? queryResponse('late') : gradeResponse('late');
      late.onmessage(messageEvent({ kind: 'ready' }));
      late.onmessage(messageEvent(lateResponse));
      late.onmessage(messageEvent(null));
      late.onerror(errorEvent().event);
      late.onmessageerror(messageEvent(null));
      for (const timer of lateTimers) timer.callback();
      h.timers.advance(30_000);
      task.cancel();
      assert.equal(await rejected(outcomes), cancellation);
      assert.equal(worker.postAttempts, posts, 'cancelled startup must not dispatch a late job');
      cleaned(worker, h.timers);
    });
  }
}

await check('independent query and grade tasks use distinct workers, IDs and timers', async () => {
  const h = harness();
  const first = queryInWorker('Events', database(), NOW, h.options);
  const firstOutcomes = observe(first);
  const second = gradeInWorker(challenge(), 'Events | project Id | sort by Id asc', database(), NOW, h.options);
  const secondOutcomes = observe(second);
  assert.equal(h.workers.length, 2);
  const [one, two] = h.workers;
  assert.notEqual(one, two);
  assert.equal(h.timers.pending.size, 2);
  one.ready();
  two.ready();
  assert.notEqual(one.request().id, two.request().id);
  first.cancel();
  await taskError(firstOutcomes, 'cancelled', 'execution');
  assert.equal(one.terminateCount, 1);
  assert.equal(h.timers.pending.size, 1);
  assert.equal(two.terminateCount, 0);
  await pending(secondOutcomes);
  h.timers.advance(1_999);
  two.respond();
  assert.equal((await fulfilled(secondOutcomes)).status, 'correct');
  cleaned(one, h.timers);
  cleaned(two, h.timers);
});

for (const phase of ['startup', 'execution'] as const) {
  await check(`grade ${phase} timeout rejects rather than reporting an incorrect answer`, async () => {
    const h = harness();
    const task = gradeInWorker(challenge(), 'Events | take 1', database(), NOW, h.options);
    const outcomes = observe(task);
    const worker = h.worker();
    if (phase === 'execution') worker.ready();
    const late = worker.capture();
    h.timers.advance(phase === 'startup' ? 10_000 : 2_000);
    const error = await taskError(outcomes, 'timeout', phase);
    assert.match(error.message, /No grading result was produced/i);
    assert.equal('status' in error, false);
    late.onmessage(messageEvent(gradeResponse(worker.requests[0]?.id ?? 'late')));
    assert.equal(await rejected(outcomes), error);
    cleaned(worker, h.timers);
  });

  await check(`onerror during ${phase} rejects as crashed and suppresses the browser error`, async () => {
    const h = harness();
    const outcomes = observe(queryInWorker('Events', database(), NOW, h.options));
    const worker = h.worker();
    if (phase === 'execution') worker.ready();
    const event = errorEvent();
    worker.capture().onerror(event.event);
    const error = await taskError(outcomes, 'crashed', phase);
    assert.match(error.message, /worker exploded/);
    assert.equal(event.prevented(), 1);
    cleaned(worker, h.timers);
  });

  await check(`messageerror during ${phase} rejects as protocol failure`, async () => {
    const h = harness();
    const outcomes = observe(queryInWorker('Events', database(), NOW, h.options));
    const worker = h.worker();
    if (phase === 'execution') worker.ready();
    worker.capture().onmessageerror(messageEvent(undefined));
    await taskError(outcomes, 'protocol', phase);
    cleaned(worker, h.timers);
  });
}

const malformed: [string, (id: string) => unknown][] = [
  ['null', () => null],
  ['undefined', () => undefined],
  ['primitive', () => 'ready'],
  ['array', () => []],
  ['empty object', () => ({})],
  ['unknown kind', id => ({ kind: 'done', id })],
  ['missing id', () => ({ kind: 'query-result', result: {} })],
  ['numeric id', () => ({ ...queryResponse('job'), id: 42 })],
  ['empty id', () => queryResponse('')],
  ['missing result', id => ({ kind: 'query-result', id })],
  ['null result', id => ({ kind: 'query-result', id, result: null })],
  ['missing table', id => ({ kind: 'query-result', id, result: { features: new Set() } })],
  ['invalid table name', id => ({
    kind: 'query-result', id, result: { table: { name: 7, columns: [], rows: [] }, features: new Set() },
  })],
  ['invalid columns', id => ({
    kind: 'query-result', id, result: { table: { name: 'Events', columns: [7], rows: [] }, features: new Set() },
  })],
  ['invalid rows', id => ({
    kind: 'query-result', id, result: { table: { name: 'Events', columns: [], rows: [null] }, features: new Set() },
  })],
  ['features array instead of Set', id => ({
    kind: 'query-result', id, result: { table: database().Events, features: ['where'] },
  })],
  ['non-string feature', id => ({
    kind: 'query-result', id, result: { table: database().Events, features: new Set([42]) },
  })],
  ['unknown grade status', id => ({ kind: 'grade-result', id, result: { status: 'timeout', message: 'bad' } })],
  ['coercible but non-string grade status', id => ({ kind: 'grade-result', id, result: { status: ['correct'], message: 'bad' } })],
  ['missing grade message', id => ({ kind: 'grade-result', id, result: { status: 'correct' } })],
  ['invalid grade table', id => ({ kind: 'grade-result', id, result: { status: 'correct', message: 'ok', table: null } })],
  ['invalid grade hint', id => ({ kind: 'grade-result', id, result: { status: 'error', message: 'bad', hint: 7 } })],
  ['invalid grade caret', id => ({ kind: 'grade-result', id, result: { status: 'error', message: 'bad', caret: 7 } })],
  ['invalid grade diff', id => ({ kind: 'grade-result', id, result: { status: 'incorrect', message: 'bad', diff: [7] } })],
  ['unknown error code', id => ({ kind: 'error', id, code: 'timeout', error: { name: 'Error', message: 'bad' } })],
  ['missing error name', id => ({ kind: 'error', id, code: 'crashed', error: { message: 'bad' } })],
  ['missing error message', id => ({ kind: 'error', id, code: 'crashed', error: { name: 'Error' } })],
  ['fractional error pos', id => ({ kind: 'error', id, code: 'kql', error: { name: 'KqlError', message: 'bad', pos: 0.5 } })],
  ['non-finite error pos', id => ({ kind: 'error', id, code: 'kql', error: { name: 'KqlError', message: 'bad', pos: NaN } })],
  ['non-string error hint', id => ({ kind: 'error', id, code: 'kql', error: { name: 'KqlError', message: 'bad', hint: 7 } })],
];

for (const [name, envelope] of malformed) {
  await check(`malformed envelope: ${name}`, async () => {
    const h = harness();
    const outcomes = observe(queryInWorker('Events', database(), NOW, h.options));
    const worker = h.worker();
    worker.ready();
    const response = envelope(worker.request().id);
    assert.equal(isWorkerResponse(structuredClone(response)), false);
    worker.emit(response);
    await taskError(outcomes, 'protocol', 'execution');
    cleaned(worker, h.timers);
  });
}

await check('malformed startup response rejects without posting a job', async () => {
  const h = harness();
  const outcomes = observe(queryInWorker('Events', database(), NOW, h.options));
  h.worker().emit({ kind: 'unknown' });
  await taskError(outcomes, 'protocol', 'startup');
  assert.equal(h.worker().postAttempts, 0);
  cleaned(h.worker(), h.timers);
});

for (const kind of ['query', 'grade'] as const) {
  await check(`${kind} rejects a matching-shape response with a mismatching ID`, async () => {
    const h = harness();
    const task: WorkerTask<QueryResult | GradeResult> = kind === 'query'
      ? queryInWorker('Events', database(), NOW, h.options)
      : gradeInWorker(challenge(), 'Events', database(), NOW, h.options);
    const outcomes = observe(task);
    const worker = h.worker();
    worker.ready();
    const id = `${worker.request().id}-other`;
    worker.emit(kind === 'query' ? queryResponse(id) : gradeResponse(id));
    await taskError(outcomes, 'protocol', 'execution');
    cleaned(worker, h.timers);
  });

  await check(`${kind} rejects a valid response of the wrong result kind`, async () => {
    const h = harness();
    const task: WorkerTask<QueryResult | GradeResult> = kind === 'query'
      ? queryInWorker('Events', database(), NOW, h.options)
      : gradeInWorker(challenge(), 'Events', database(), NOW, h.options);
    const outcomes = observe(task);
    const worker = h.worker();
    worker.ready();
    const id = worker.request().id;
    const response = kind === 'query' ? gradeResponse(id) : queryResponse(id);
    assert.ok(isWorkerResponse(response));
    worker.emit(response);
    await taskError(outcomes, 'protocol', 'execution');
    cleaned(worker, h.timers);
  });
}

await check('a response before ready rejects without posting a job', async () => {
  const h = harness();
  const task = queryInWorker('Events', database(), NOW, h.options);
  const outcomes = observe(task);
  const worker = h.worker();
  const late = worker.capture();
  worker.emit(queryResponse('premature'));
  await taskError(outcomes, 'protocol', 'startup');
  assert.equal(worker.postAttempts, 0);
  late.onmessage(messageEvent({ kind: 'ready' }));
  assert.equal(worker.postAttempts, 0);
  cleaned(worker, h.timers);
});

await check('duplicate ready rejects without reposting the request or restarting the deadline', async () => {
  const h = harness();
  const outcomes = observe(queryInWorker('Events', database(), NOW, h.options));
  const worker = h.worker();
  worker.ready();
  h.timers.advance(500);
  worker.ready();
  await taskError(outcomes, 'protocol', 'execution');
  assert.equal(worker.postAttempts, 1);
  assert.deepEqual(h.timers.scheduled.map(timer => timer.milliseconds), [10_000, 2_000]);
  cleaned(worker, h.timers);
});

await check('worker constructor failure rejects as unavailable without scheduling timers', async () => {
  const timers = new FakeTimers();
  const cause = new Error('constructor unavailable');
  let calls = 0;
  const task = queryInWorker('Events', database(), NOW, {
    timers,
    workerFactory: () => { calls++; throw cause; },
  });
  const outcomes = observe(task);
  const error = await taskError(outcomes, 'unavailable', 'startup');
  assert.equal(error.cause, cause);
  task.cancel();
  task.cancel();
  assert.equal(await rejected(outcomes), error);
  assert.equal(calls, 1);
  assert.equal(timers.scheduled.length, 0);
  assert.equal(timers.pending.size, 0);
});

await check('postMessage DataCloneError rejects and cleans up the execution timer and worker', async () => {
  const h = harness();
  const db = database();
  Object.assign(db.Events.rows[0], { uncloneable: () => 'not transferable' });
  const task = queryInWorker('Events', db, NOW, h.options);
  const outcomes = observe(task);
  const worker = h.worker();
  worker.ready();
  const error = await taskError(outcomes, 'protocol', 'execution');
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.name, 'DataCloneError');
  assert.equal(worker.postAttempts, 1);
  assert.equal(worker.requests.length, 0);
  assert.deepEqual(h.timers.scheduled.map(timer => timer.milliseconds), [10_000, 2_000]);
  cleaned(worker, h.timers);
  task.cancel();
  cleaned(worker, h.timers);
});

await check('missing global Worker rejects query and grade without a synchronous engine fallback', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let databaseAccesses = 0;
  const db = new Proxy(database(), {
    get(target, key, receiver) {
      databaseAccesses++;
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) {
      databaseAccesses++;
      return Reflect.ownKeys(target);
    },
  });
  try {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: undefined });
    for (const kind of ['query', 'grade'] as const) {
      const timers = new FakeTimers();
      const task: WorkerTask<QueryResult | GradeResult> = kind === 'query'
        ? queryInWorker('Events', db, NOW, { timers })
        : gradeInWorker(challenge(), 'Events', db, NOW, { timers });
      const outcomes = observe(task);
      const error = await taskError(outcomes, 'unavailable', 'startup');
      assert.match(error.message, /No query was run/i);
      task.cancel();
      assert.equal(await rejected(outcomes), error);
      assert.equal(timers.scheduled.length, 0);
      assert.equal(timers.pending.size, 0);
    }
    assert.equal(databaseAccesses, 0, 'neither API may run the synchronous engine as a fallback');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else assert.ok(Reflect.deleteProperty(globalThis, 'Worker'));
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'Worker'), descriptor);
});

await check('real query KqlError is serialized and reconstructed with position and hint', async () => {
  const h = harness();
  const query = 'Events | where Idd == 1';
  const outcomes = observe(queryInWorker(query, database(), NOW, h.options));
  const worker = h.worker();
  worker.ready();
  const response = worker.respond();
  assert.ok(response.kind === 'error');
  assert.equal(response.id, worker.request().id);
  assert.equal(response.code, 'kql');
  assert.deepEqual(response.error, {
    name: 'KqlError',
    message: "Unknown column 'Idd'.",
    pos: query.indexOf('Idd'),
    hint: "Did you mean 'Id'?",
  });
  assert.equal(response.error instanceof Error, false, 'wire errors must be plain cloneable data');
  const error = await rejected(outcomes);
  assert.ok(error instanceof KqlError);
  assert.equal(error instanceof WorkerTaskError, false);
  assert.equal(error.name, response.error.name);
  assert.equal(error.message, response.error.message);
  assert.equal(error.pos, response.error.pos);
  assert.equal(error.hint, response.error.hint);
  cleaned(worker, h.timers);
});

for (const thrown of [new TypeError('unexpected database failure'), 'non-Error failure']) {
  await check(`pure query handler serializes non-KQL exception: ${String(thrown)}`, () => {
    const db: Database = {};
    let reads = 0;
    // Direct handler only: getters are deliberately not sent through structuredClone.
    Object.defineProperty(db, 'Events', {
      enumerable: true,
      get() { reads++; throw thrown; },
    });
    const response = executeWorkerRequest({ kind: 'query', id: 'crash', query: 'Events', database: db, now: NOW });
    assert.equal(reads, 1);
    assert.deepEqual(response, {
      kind: 'error',
      id: 'crash',
      code: 'crashed',
      error: {
        name: thrown instanceof Error ? thrown.name : 'Error',
        message: thrown instanceof Error ? thrown.message : String(thrown),
      },
    });
    assert.ok(isWorkerResponse(structuredClone(response)));
  });
}

await check('pure grade handler does not disguise unexpected query failures as player errors', () => {
  const db = database();
  Object.defineProperty(db, 'Events', {
    get() { throw new TypeError('query execution failed internally'); },
  });
  const response = executeWorkerRequest({
    kind: 'grade', id: 'inner-crash', spec: challenge(), query: 'Events', database: db, now: NOW,
  });
  assert.equal(response.kind, 'error');
  if (response.kind !== 'error') throw new Error('Expected a worker fault');
  assert.equal(response.code, 'crashed');
  assert.match(response.error.message, /failed internally/);
});

await check('pure grade handler serializes unexpected grading exceptions as crashes', () => {
  const spec = challenge();
  Object.defineProperty(spec, 'requiredOperators', {
    get() { throw new TypeError('unexpected grading failure'); },
  });
  const response = executeWorkerRequest({
    kind: 'grade', id: 'grade-crash', spec, query: 'Events', database: database(), now: NOW,
  });
  assert.deepEqual(response, {
    kind: 'error',
    id: 'grade-crash',
    code: 'crashed',
    error: { name: 'TypeError', message: 'unexpected grading failure' },
  });
  assert.ok(isWorkerResponse(structuredClone(response)));
});

for (const kind of ['query', 'grade'] as const) {
  await check(`${kind} receives serialized crashed error as WorkerTaskError, not a grade`, async () => {
    const h = harness();
    const task: WorkerTask<QueryResult | GradeResult> = kind === 'query'
      ? queryInWorker('Events', database(), NOW, h.options)
      : gradeInWorker(challenge(), 'Events', database(), NOW, h.options);
    const outcomes = observe(task);
    const worker = h.worker();
    worker.ready();
    const wireError = { name: 'TypeError', message: 'unexpected engine failure' };
    worker.emit({ kind: 'error', id: worker.request().id, code: 'crashed', error: wireError });
    const error = await taskError(outcomes, 'crashed', 'execution');
    assert.match(error.message, /unexpected engine failure/);
    assert.deepEqual(error.cause, wireError);
    assert.notEqual(error.cause, wireError);
    assert.equal('status' in error, false);
    cleaned(worker, h.timers);
  });
}

await check('raw KQL error envelope for grading is a protocol failure, not an incorrect grade', async () => {
  const h = harness();
  const outcomes = observe(gradeInWorker(challenge(), 'Events', database(), NOW, h.options));
  const worker = h.worker();
  worker.ready();
  worker.emit({
    kind: 'error',
    id: worker.request().id,
    code: 'kql',
    error: { name: 'KqlError', message: 'should have been a grade-result', pos: 0 },
  });
  await taskError(outcomes, 'protocol', 'execution');
  cleaned(worker, h.timers);
});

const gradeCases: {
  name: string;
  query: string;
  overrides?: Partial<ChallengeSpec>;
  status: GradeResult['status'];
  message?: RegExp;
  diff?: RegExp;
}[] = [
  { name: 'empty input', query: '   ', status: 'error', message: /empty/i },
  { name: 'invalid syntax', query: 'Events | where', status: 'error' },
  { name: 'unknown column', query: 'Events | where Idd == 1', status: 'error', message: /Unknown column/ },
  { name: 'bad reference query', query: 'Events', overrides: { solution: 'MissingTable' }, status: 'error', message: /bad reference query/i },
  { name: 'correct answer', query: 'Events | project Id | sort by Id asc', status: 'correct' },
  { name: 'incorrect rows', query: 'Events | take 1 | project Id', status: 'incorrect', diff: /Expected 3 rows, got 1/ },
  {
    name: 'required operator missing despite matching rows',
    query: 'Events | project Id',
    overrides: { requiredOperators: ['sort'] },
    status: 'incorrect',
    message: /needs you to use: sort/,
  },
  {
    name: 'required operator satisfied case-insensitively',
    query: 'Events | project Id | sort by Id asc',
    overrides: { requiredOperators: ['SORT'] },
    status: 'correct',
  },
  {
    name: 'unordered rows may be reversed',
    query: 'Events | project Id | sort by Id desc',
    overrides: { ordered: false },
    status: 'correct',
  },
  {
    name: 'ordered reversed rows are incorrect',
    query: 'Events | project Id | sort by Id desc',
    overrides: { ordered: true },
    status: 'incorrect',
    diff: /order differs/,
  },
  {
    name: 'ordered matching rows are correct',
    query: 'Events | project Id | sort by Id asc',
    overrides: { ordered: true },
    status: 'correct',
  },
  {
    name: 'ordered column order is enforced',
    query: 'Events | project When, Id | sort by Id asc',
    overrides: { solution: 'Events | project Id, When | sort by Id asc', ordered: true },
    status: 'incorrect',
    diff: /Column order differs/,
  },
  {
    name: 'fixed now and Timespan survive grading',
    query: 'Events | where When > ago(1h) | project Id, When, Duration',
    overrides: { solution: 'Events | where When > ago(1h) | project Id, When, Duration' },
    status: 'correct',
  },
];

for (const example of gradeCases) {
  await check(`real grade dispatch matches synchronous grade: ${example.name}`, async () => {
    const h = harness();
    const db = database();
    const spec = challenge(example.overrides);
    const before = structuredClone({ db, spec });
    const expected = gradeChallenge(spec, example.query, db, NOW);
    assert.equal(expected.status, example.status, 'fixture must exercise the intended grading branch');
    const task = gradeInWorker(spec, example.query, db, NOW, h.options);
    const outcomes = observe(task);
    const worker = h.worker();
    worker.ready();
    const request = worker.request();
    assert.ok(request.kind === 'grade');
    assert.deepEqual(request.spec, spec);
    assert.notEqual(request.spec, spec);
    assert.notEqual(request.spec.concept, spec.concept);
    assert.notEqual(request.database, db);
    assert.ok(request.now instanceof Date);
    assert.equal(request.now.getTime(), NOW.getTime());
    const response = worker.respond();
    assert.ok(response.kind === 'grade-result', 'invalid KQL must produce an error grade, not reject');
    assert.equal(response.id, request.id);
    const result = await fulfilled(outcomes);
    assert.deepEqual(result, expected);
    assert.notEqual(result, response.result);
    assert.equal(result.status, example.status);
    if (example.message) assert.match(result.message, example.message);
    if (example.diff) assert.match(result.diff?.join('\n') ?? '', example.diff);
    if (example.name === 'unknown column') {
      assert.equal(result.hint, "Did you mean 'Id'?");
      assert.match(result.caret ?? '', /\^/);
    }
    if (example.name === 'fixed now and Timespan survive grading') {
      assert.ok(result.table);
      assert.equal(result.table.rows.length, 2);
      assert.ok(result.table.rows[0].When instanceof Date);
      assert.ok(isTimespan(result.table.rows[0].Duration));
      assert.deepEqual(result.table.rows[0].Duration, timespan(1_500));
    }
    assert.deepEqual({ db, spec }, before);
    cleaned(worker, h.timers);
    task.cancel();
    h.timers.advance(20_000);
    assert.equal(await fulfilled(outcomes), result);
    cleaned(worker, h.timers);
  });
}

console.log(`Worker tests: ${passed} passed, ${failures.length} failed.`);
for (const failure of failures) console.error(`FAIL ${failure}`);
if (failures.length) process.exitCode = 1;
