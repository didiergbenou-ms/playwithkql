export type TouchAction = 'left' | 'right' | 'jump' | 'interact';
export type TouchEdge = Extract<TouchAction, 'jump' | 'interact'>;
export type TouchHeld = Readonly<Record<TouchAction, boolean>>;
export type TouchPress = Readonly<{ action: TouchAction; pointerId: number }>;

const EMPTY_HELD: TouchHeld = Object.freeze({
  left: false, right: false, jump: false, interact: false,
});

/** Volatile input only: each press is a unique token, even when pointer IDs are reused. */
export function createTouchInput() {
  const pointers = new Map<number, TouchPress>();
  const edges = { jump: new Set<TouchPress>(), interact: new Set<TouchPress>() };
  const listeners = new Set<() => void>();
  const resetListeners = new Set<() => void>();
  let valid = new WeakSet<TouchPress>();
  let held = EMPTY_HELD;
  let enabled = false;
  let blocked = false;

  const publish = () => {
    const next = { ...EMPTY_HELD };
    for (const press of pointers.values()) next[press.action] = true;
    if ((Object.keys(next) as TouchAction[]).some((action) => next[action] !== held[action])) {
      held = Object.freeze(next);
      listeners.forEach((listener) => listener());
    }
  };

  const reset = () => {
    pointers.clear();
    edges.jump.clear();
    edges.interact.clear();
    valid = new WeakSet();
    publish();
    resetListeners.forEach((listener) => listener());
  };

  return {
    isEnabled: () => enabled,
    getSnapshot: (): TouchHeld => held,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeReset(listener: () => void) {
      resetListeners.add(listener);
      return () => { resetListeners.delete(listener); };
    },
    reset,
    // UI availability and scene pause are independent gates: neither can reopen the other.
    setEnabled(value: boolean) {
      enabled = value;
      reset();
    },
    setBlocked(value: boolean) {
      blocked = value;
      reset();
    },
    press(action: TouchAction, pointerId: number): TouchPress | null {
      if (!enabled || blocked || pointers.has(pointerId)) return null;
      const press = Object.freeze({ action, pointerId });
      pointers.set(pointerId, press);
      valid.add(press);
      if ((action === 'jump' || action === 'interact') && !held[action]) {
        edges[action].add(press);
      }
      publish();
      return press;
    },
    release(press: TouchPress) {
      if (pointers.get(press.pointerId) !== press) return;
      pointers.delete(press.pointerId);
      // A completed tap remains queued even when both events fall between frames.
      publish();
    },
    cancel(press: TouchPress) {
      if (pointers.get(press.pointerId) !== press) return;
      pointers.delete(press.pointerId);
      valid.delete(press);
      if (press.action === 'jump' || press.action === 'interact') {
        edges[press.action].delete(press);
      }
      publish();
    },
    isValidPress: (press: TouchPress) => valid.has(press),
    consumePress(action: TouchEdge): TouchPress | null {
      // Coalesce taps within one frame, never replay them on subsequent landings.
      let latest: TouchPress | null = null;
      for (const press of edges[action]) latest = press;
      edges[action].clear();
      return latest;
    },
  };
}

export const touchInput = createTouchInput();
