import { GameAudio } from '../src/game/audio';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type TimerCallback = () => void;

interface TimerTask {
  id: number;
  at: number;
  cb: TimerCallback;
  interval: number | null;
  active: boolean;
}

class FakeClock {
  private nowMs = 0;
  private nextId = 1;
  private tasks = new Map<number, TimerTask>();

  get nowSeconds() {
    return this.nowMs / 1000;
  }

  setTimeout = (cb: TimerCallback, delay = 0): number => {
    const id = this.nextId++;
    this.tasks.set(id, { id, at: this.nowMs + Math.max(0, delay), cb, interval: null, active: true });
    return id;
  };

  clearTimeout = (id: number) => {
    const task = this.tasks.get(id);
    if (!task) return;
    task.active = false;
    this.tasks.delete(id);
  };

  setInterval = (cb: TimerCallback, delay = 0): number => {
    const every = Math.max(1, delay);
    const id = this.nextId++;
    this.tasks.set(id, { id, at: this.nowMs + every, cb, interval: every, active: true });
    return id;
  };

  clearInterval = (id: number) => this.clearTimeout(id);

  advance(ms: number) {
    const target = this.nowMs + Math.max(0, ms);
    for (;;) {
      const next = this.nextDue(target);
      if (!next) break;
      // A delayed callback fires at the current time, not back in the past.
      // Missed setInterval ticks are not replayed one by one after a stall.
      this.nowMs = Math.max(this.nowMs, next.at);
      if (next.interval === null) {
        this.tasks.delete(next.id);
      } else {
        next.at = this.nowMs + next.interval;
      }
      next.cb();
      if (!next.active) this.tasks.delete(next.id);
    }
    this.nowMs = target;
  }

  skip(ms: number) {
    this.nowMs += Math.max(0, ms);
  }

  private nextDue(target: number): TimerTask | null {
    let next: TimerTask | null = null;
    for (const task of this.tasks.values()) {
      if (!task.active || task.at > target) continue;
      if (!next || task.at < next.at || (task.at === next.at && task.id < next.id)) next = task;
    }
    return next;
  }
}

class FakeAudioParam {
  value = 0;

  setValueAtTime(value: number) {
    this.value = value;
  }

  linearRampToValueAtTime(value: number) {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }

  cancelScheduledValues() {}
}

class FakeAudioNode {
  connect(_destination: object) {}

  disconnect() {}
}

class FakeAudioScheduledSourceNode extends FakeAudioNode {
  onended: (() => void) | null = null;
  private endTask: number | null = null;

  constructor(private readonly clock: FakeClock) {
    super();
  }

  start(_at = 0) {}

  stop(at = 0) {
    if (this.endTask !== null) this.clock.clearTimeout(this.endTask);
    const whenMs = Math.max(this.clock.nowSeconds * 1000, at * 1000);
    this.endTask = this.clock.setTimeout(() => {
      this.endTask = null;
      this.onended?.();
    }, whenMs - this.clock.nowSeconds * 1000);
  }
}

class FakeOscillatorNode extends FakeAudioScheduledSourceNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam();

  setPeriodicWave(_wave: object) {}
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
}

class FakeAudioBuffer {
  private readonly channels: Float32Array[];

  constructor(channels: number, length: number) {
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(index: number) {
    return this.channels[index];
  }
}

class FakeBufferSourceNode extends FakeAudioScheduledSourceNode {
  buffer: FakeAudioBuffer | null = null;
}

class FakeAudioContext {
  static clock: FakeClock | null = null;
  static instances: FakeAudioContext[] = [];

  readonly destination = new FakeAudioNode();
  readonly sampleRate = 48_000;
  state: AudioContextState | 'interrupted' = 'running';
  oscillatorCount = 0;
  bufferSourceCount = 0;
  resumeCalls = 0;
  resumeError: Error | null = null;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  get currentTime() {
    return FakeAudioContext.clock?.nowSeconds ?? 0;
  }

  createGain() {
    return new FakeGainNode();
  }

  createOscillator() {
    this.oscillatorCount++;
    const clock = FakeAudioContext.clock;
    assert(!!clock, 'fake clock was not installed');
    return new FakeOscillatorNode(clock);
  }

  createBufferSource() {
    this.bufferSourceCount++;
    const clock = FakeAudioContext.clock;
    assert(!!clock, 'fake clock was not installed');
    return new FakeBufferSourceNode(clock);
  }

  createBiquadFilter() {
    return new FakeBiquadFilterNode();
  }

  createPeriodicWave(..._args: object[]) {
    return {};
  }

  createBuffer(channels: number, length: number) {
    return new FakeAudioBuffer(channels, length);
  }

  resume() {
    this.resumeCalls++;
    if (this.resumeError) return Promise.reject(this.resumeError);
    this.state = 'running';
    return Promise.resolve();
  }

  suspendForTest() {
    this.state = 'suspended';
  }
}

class FakeStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

interface Harness {
  audio: GameAudio;
  clock: FakeClock;
  ctx: FakeAudioContext;
}

function withHarness(run: (h: Harness) => void) {
  const originals = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
    setInterval: Object.getOwnPropertyDescriptor(globalThis, 'setInterval'),
    clearInterval: Object.getOwnPropertyDescriptor(globalThis, 'clearInterval'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };

  const clock = new FakeClock();
  FakeAudioContext.clock = clock;
  FakeAudioContext.instances = [];

  Object.defineProperty(globalThis, 'setTimeout', {
    value: clock.setTimeout as typeof setTimeout,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'clearTimeout', {
    value: clock.clearTimeout as typeof clearTimeout,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'setInterval', {
    value: clock.setInterval as typeof setInterval,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'clearInterval', {
    value: clock.clearInterval as typeof clearInterval,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { AudioContext: FakeAudioContext },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: new FakeStorage(),
    configurable: true,
    writable: true,
  });

  const audio = new GameAudio();
  audio.unlock();
  const ctx = FakeAudioContext.instances[0];
  assert(!!ctx, 'audio context was not created');

  try {
    run({ audio, clock, ctx });
  } finally {
    audio.stopMusic();
    restoreProperty('setTimeout', originals.setTimeout);
    restoreProperty('clearTimeout', originals.clearTimeout);
    restoreProperty('setInterval', originals.setInterval);
    restoreProperty('clearInterval', originals.clearInterval);
    restoreProperty('window', originals.window);
    restoreProperty('localStorage', originals.localStorage);
  }
}

function restoreProperty(name: 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'window' | 'localStorage', descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  delete (globalThis as Record<string, unknown>)[name];
}

const totalSources = (ctx: FakeAudioContext) => ctx.oscillatorCount + ctx.bufferSourceCount;

check('cancelled focus fade-stop does not kill resumed scheduling', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.playTrack('office');
    clock.advance(200);
    const beforeFade = totalSources(ctx);
    assert(beforeFade > 0, 'music never started scheduling');

    audio.setFocusMode(true);
    assert(audio.getDebugState().focusStopPending, 'focus stop was not armed');

    clock.advance(800);
    audio.setFocusMode(false);
    assert(!audio.getDebugState().focusStopPending, 'focus stop was not cancelled');

    const resumedBefore = totalSources(ctx);
    clock.advance(1_000);
    const state = audio.getDebugState();
    assert(state.schedulerRunning, 'scheduler stopped after the cancelled fade-stop');
    assert(totalSources(ctx) > resumedBefore, 'music did not keep scheduling after focus resumed');
  });
});

check('focus pause preserves track and step without silent backlog', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.playTrack('office');
    clock.advance(250);
    const beforePause = audio.getDebugState();
    assert(beforePause.schedulerRunning, 'scheduler never started');

    audio.setFocusMode(true);
    clock.advance(1_800);
    const paused = audio.getDebugState();
    assert(!paused.schedulerRunning, 'scheduler did not stop after the fade completed');
    assert(paused.currentTrack === 'office', 'current track changed during focus pause');

    const pausedStep = paused.step;
    const pausedSources = totalSources(ctx);
    clock.advance(1_000);
    const stillPaused = audio.getDebugState();
    assert(stillPaused.step === pausedStep, 'step advanced while music was paused');
    assert(totalSources(ctx) === pausedSources, 'paused music kept creating silent sources');

    audio.setFocusMode(false);
    const resumed = audio.getDebugState();
    assert(resumed.schedulerRunning, 'scheduler did not resume when focus ended');
    assert(resumed.currentTrack === 'office', 'resume swapped to the wrong track');
    assert(resumed.step === pausedStep, 'resume reset the track position');
  });
});

check('track changes while focused stay prepared but do not schedule silently', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.playTrack('office');
    clock.advance(200);
    audio.setFocusMode(true);
    clock.advance(1_800);

    const beforeSwitch = totalSources(ctx);
    audio.playTrack('closed');
    const focused = audio.getDebugState();
    assert(focused.currentTrack === 'closed', 'track switch did not update the prepared track');
    assert(!focused.schedulerRunning, 'focused track switch restarted the scheduler');

    clock.advance(600);
    assert(totalSources(ctx) === beforeSwitch, 'focused track switch created silent music sources');

    audio.setFocusMode(false);
    clock.advance(60);
    assert(audio.getDebugState().schedulerRunning, 'track did not resume after leaving focus');
    assert(audio.getDebugState().currentTrack === 'closed', 'resume lost the switched track');
    assert(totalSources(ctx) > beforeSwitch, 'resumed switched track never scheduled audio');
  });
});

check('zero music volume does not synthesize background music', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.update({ musicVolume: 0 });
    const beforeTrack = totalSources(ctx);
    audio.playTrack('office');
    clock.advance(500);
    assert(!audio.getDebugState().schedulerRunning, 'zero-volume music still started the scheduler');
    assert(totalSources(ctx) === beforeTrack, 'zero-volume music still created sources');
  });
});

check('stopping music leaves the shared sfx path working', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.playTrack('office');
    clock.advance(200);
    audio.setFocusMode(true);
    clock.advance(1_800);
    assert(!audio.getDebugState().schedulerRunning, 'music scheduler was still running');

    const beforeCue = totalSources(ctx);
    audio.play('gate');
    assert(totalSources(ctx) > beforeCue, 'gate cue did not play after music stopped');
  });
});

check('scheduler rebases after a long stall instead of catching up forever', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.playTrack('office');
    clock.advance(200);
    const before = totalSources(ctx);

    clock.skip(10_000);
    clock.advance(25);

    const after = totalSources(ctx) - before;
    assert(after > 0, 'stalled scheduler did not recover');
    assert(after < 20, `stalled scheduler created too many catch-up sources: ${after}`);
  });
});

check('unlock resumes audio without restarting inaudible music', () => {
  withHarness(({ audio, clock, ctx }) => {
    audio.playTrack('office');
    clock.advance(200);
    audio.setFocusMode(true);
    clock.advance(1_800);

    audio.update({ musicOn: false });
    audio.update({ musicOn: true });
    ctx.suspendForTest();
    const resumesBefore = ctx.resumeCalls;

    audio.unlock();
    assert(ctx.resumeCalls === resumesBefore + 1, 'unlock did not resume the suspended context');
    assert(!audio.getDebugState().schedulerRunning, 'unlock restarted music while focus was still active');

    audio.setFocusMode(false);
    clock.advance(60);
    assert(audio.getDebugState().schedulerRunning, 'music did not resume after focus ended');
  });
});

check('Safari interrupted state resumes on a later gesture', () => {
  withHarness(({ audio, ctx }) => {
    ctx.state = 'interrupted';
    const before = ctx.resumeCalls;
    void audio.unlock();
    assert(ctx.resumeCalls === before + 1, 'interrupted context was not resumed');
    assert(String(ctx.state) === 'running', 'context did not recover from interruption');
    ctx.suspendForTest();
    void audio.unlock();
    assert(ctx.resumeCalls === before + 2, 'later gesture did not retry the suspended context');
  });
});

async function checkAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; }
  catch (err) { failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`); }
}

await checkAsync('a rejected resume is reported, resolves false and can be retried', async () => {
  let first = Promise.resolve(true);
  let retry = () => Promise.resolve(false);
  const warnings: unknown[][] = [];
  const oldWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    withHarness(({ audio, ctx }) => {
      ctx.suspendForTest();
      ctx.resumeError = new Error('Gesture required');
      first = audio.unlock();
      retry = () => {
        ctx.resumeError = null;
        return audio.unlock();
      };
    });
    assert(await first === false, 'rejected resume reported success');
    assert(warnings.length === 1, 'resume failure was silently swallowed');
    assert(await retry() === true, 'later resume could not recover');
  } finally {
    console.warn = oldWarn;
  }
});

console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  throw new Error(`${failures.length} audio scheduling tests failed`);
}
