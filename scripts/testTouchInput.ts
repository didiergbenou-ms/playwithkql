import assert from 'node:assert/strict';
import { createTouchInput, type TouchAction, type TouchPress } from '../src/game/inputBridge.ts';

let passed = 0;
const failures: string[] = [];
const empty = { left: false, right: false, jump: false, interact: false };

function check(name: string, test: () => void) {
  try {
    test();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

function setup() {
  const input = createTouchInput();
  input.setEnabled(true);
  const press = (action: TouchAction, pointerId: number): TouchPress => {
    const token = input.press(action, pointerId);
    assert.ok(token);
    return token;
  };
  return { input, press };
}

function assertEmpty(input: ReturnType<typeof createTouchInput>) {
  assert.deepEqual(input.getSnapshot(), empty);
  assert.equal(input.consumePress('jump'), null);
  assert.equal(input.consumePress('interact'), null);
}

check('input begins disabled and has no queued actions', () => {
  const input = createTouchInput();
  for (const action of Object.keys(empty) as TouchAction[]) {
    assert.equal(input.press(action, 1), null);
  }
  assertEmpty(input);
});

check('two pointers on each action retain the hold until the last release', () => {
  for (const action of Object.keys(empty) as TouchAction[]) {
    const { input, press } = setup();
    const first = press(action, 1);
    const second = press(action, 2);
    assert.equal(input.getSnapshot()[action], true);
    input.release(first);
    assert.equal(input.getSnapshot()[action], true);
    input.release(first);
    assert.equal(input.getSnapshot()[action], true);
    input.release(second);
    assert.equal(input.getSnapshot()[action], false);
  }
});

check('movement, jumping and interacting are independently held and consumed', () => {
  const { input, press } = setup();
  const left = press('left', 1);
  const jump = press('jump', 2);
  const interact = press('interact', 3);
  assert.deepEqual(input.getSnapshot(), { ...empty, left: true, jump: true, interact: true });
  assert.equal(input.consumePress('jump'), jump);
  assert.equal(input.consumePress('jump'), null);
  assert.equal(input.consumePress('interact'), interact);
  assert.equal(input.consumePress('interact'), null);
  input.release(interact);
  assert.deepEqual(input.getSnapshot(), { ...empty, left: true, jump: true });
  input.release(left);
  assert.equal(input.getSnapshot().jump, true);
});

check('opposing directions remain visible to the existing neutral-direction physics policy', () => {
  const { input, press } = setup();
  const left = press('left', 1);
  press('right', 2);
  assert.deepEqual(input.getSnapshot(), { ...empty, left: true, right: true });
  input.release(left);
  assert.deepEqual(input.getSnapshot(), { ...empty, right: true });
});

check('held jump and interaction edges fire once, including a second overlapping finger', () => {
  for (const action of ['jump', 'interact'] as const) {
    const { input, press } = setup();
    const first = press(action, 1);
    assert.equal(input.consumePress(action), first);
    const second = press(action, 2);
    for (let frame = 0; frame < 120; frame++) assert.equal(input.consumePress(action), null);
    input.release(first);
    assert.equal(input.getSnapshot()[action], true);
    assert.equal(input.consumePress(action), null);
    input.release(second);
    const next = press(action, 3);
    assert.equal(input.consumePress(action), next);
    assert.equal(input.consumePress(action), null);
  }
});

check('completed short taps survive release between frames without being held', () => {
  for (const action of ['jump', 'interact'] as const) {
    const { input, press } = setup();
    const tap = press(action, 7);
    input.release(tap);
    assert.equal(input.getSnapshot()[action], false);
    assert.equal(input.consumePress(action), tap);
    assert.equal(input.isValidPress(tap), true);
    assert.equal(input.consumePress(action), null);
  }
});

check('multiple taps between frames coalesce without future ghost actions', () => {
  const { input, press } = setup();
  let last: TouchPress | null = null;
  for (let i = 0; i < 4; i++) {
    last = press('jump', 5);
    input.release(last);
  }
  assert.equal(input.consumePress('jump'), last);
  for (let frame = 0; frame < 120; frame++) assert.equal(input.consumePress('jump'), null);
});

check('pointercancel removes only the cancelled pointer and its unconsumed edge', () => {
  const { input, press } = setup();
  const left = press('left', 1);
  const jump = press('jump', 2);
  const interact = press('interact', 3);
  input.cancel(jump);
  assert.equal(input.isValidPress(jump), false);
  assert.deepEqual(input.getSnapshot(), { ...empty, left: true, interact: true });
  assert.equal(input.consumePress('jump'), null);
  assert.equal(input.consumePress('interact'), interact);
  input.cancel(left);
  assert.equal(input.getSnapshot().interact, true);
});

check('cancelled overlapping pointers do not clear another hold or manufacture an edge', () => {
  const { input, press } = setup();
  const first = press('jump', 1);
  const second = press('jump', 2);
  input.cancel(first);
  assert.equal(input.getSnapshot().jump, true);
  assert.equal(input.consumePress('jump'), null);
  input.cancel(second);
  assertEmpty(input);
});

check('cancellation revokes an already consumed press for the scene jump buffer', () => {
  const { input, press } = setup();
  const jump = press('jump', 1);
  assert.equal(input.consumePress('jump'), jump);
  assert.equal(input.isValidPress(jump), true);
  input.cancel(jump);
  assert.equal(input.isValidPress(jump), false);
  assertEmpty(input);
});

check('cancelled later tap does not discard a completed earlier tap', () => {
  const { input, press } = setup();
  const completed = press('interact', 1);
  input.release(completed);
  const cancelled = press('interact', 2);
  input.cancel(cancelled);
  assert.equal(input.consumePress('interact'), completed);
  assertEmpty(input);
});

check('automatic lost capture after a normal release cannot erase a completed tap', () => {
  const { input, press } = setup();
  const tap = press('jump', 1);
  input.release(tap);
  input.cancel(tap);
  assert.equal(input.consumePress('jump'), tap);
  assert.equal(input.isValidPress(tap), true);
});

check('duplicate pointerdown cannot change action or create another edge', () => {
  const { input, press } = setup();
  const first = press('jump', 1);
  assert.equal(input.press('jump', 1), null);
  assert.equal(input.press('interact', 1), null);
  assert.equal(input.consumePress('jump'), first);
  assert.equal(input.consumePress('interact'), null);
  assert.deepEqual(input.getSnapshot(), { ...empty, jump: true });
});

check('reset clears holds, both queued edges and consumed scene-buffer tokens', () => {
  const { input, press } = setup();
  press('left', 1);
  const oldJump = press('jump', 2);
  input.consumePress('jump');
  input.release(oldJump);
  press('jump', 3);
  press('interact', 4);
  input.reset();
  assertEmpty(input);
  assert.equal(input.isValidPress(oldJump), false);
  input.reset();
  assertEmpty(input);
});

check('disabled input discards taps and does not rearm an old finger when enabled', () => {
  const { input, press } = setup();
  const jump = press('jump', 1);
  const interact = press('interact', 2);
  input.setEnabled(false);
  assertEmpty(input);
  assert.equal(input.press('jump', 3), null);
  assert.equal(input.press('interact', 4), null);
  input.setEnabled(true);
  input.release(jump);
  input.cancel(interact);
  assertEmpty(input);
  assert.equal(input.isValidPress(jump), false);
  assert.ok(input.press('jump', 1));
});

check('scene pause and UI availability cannot accidentally enable each other', () => {
  const { input, press } = setup();
  press('jump', 1);
  press('interact', 2);
  input.setBlocked(true);
  input.setEnabled(true);
  assert.equal(input.press('jump', 3), null);
  assertEmpty(input);
  input.setEnabled(false);
  input.setBlocked(false);
  assert.equal(input.press('interact', 4), null);
  assertEmpty(input);
  input.setEnabled(true);
  assert.ok(input.press('jump', 5));
});

check('pause and resume both reset, even for repeated same-state events', () => {
  const { input, press } = setup();
  const beforePause = press('jump', 1);
  input.setBlocked(true);
  input.setBlocked(true);
  input.setBlocked(false);
  assertEmpty(input);
  assert.equal(input.isValidPress(beforePause), false);
  press('jump', 2);
  press('interact', 3);
  input.setBlocked(false);
  assertEmpty(input);
});

check('stale releases and cancellations cannot affect reused pointer IDs in a new run', () => {
  const { input, press } = setup();
  const oldJump = press('jump', 1);
  const oldInteract = press('interact', 2);
  input.reset();
  const jump = press('jump', 1);
  const interact = press('interact', 2);
  input.release(oldJump);
  input.cancel(oldJump);
  input.release(oldInteract);
  input.cancel(oldInteract);
  assert.deepEqual(input.getSnapshot(), { ...empty, jump: true, interact: true });
  assert.equal(input.consumePress('jump'), jump);
  assert.equal(input.consumePress('interact'), interact);
});

check('held snapshots are stable and consumption never causes per-frame visual writes', () => {
  const { input, press } = setup();
  let notifications = 0;
  const off = input.subscribe(() => { notifications++; });
  const initial = input.getSnapshot();
  const first = press('jump', 1);
  const held = input.getSnapshot();
  assert.notEqual(held, initial);
  assert.ok(Object.isFrozen(held));
  const second = press('jump', 2);
  assert.equal(input.getSnapshot(), held);
  input.consumePress('jump');
  input.release(first);
  assert.equal(input.getSnapshot(), held);
  assert.equal(notifications, 1);
  input.release(second);
  assert.equal(notifications, 2);
  off();
  off();
  press('left', 3);
  assert.equal(notifications, 2);
});

check('reset subscribers clear scene buffers even after a tap was consumed and released', () => {
  const { input, press } = setup();
  let queuedJump: TouchPress | null = null;
  let resets = 0;
  const off = input.subscribeReset(() => { queuedJump = null; resets++; });
  const tap = press('jump', 1);
  input.release(tap);
  queuedJump = input.consumePress('jump');
  assert.equal(queuedJump, tap);
  input.reset();
  assert.equal(queuedJump, null);
  assert.equal(resets, 1);
  off();
  off();
  input.reset();
  assert.equal(resets, 1);
});

console.log(`${passed} touch input checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exitCode = 1;
}
