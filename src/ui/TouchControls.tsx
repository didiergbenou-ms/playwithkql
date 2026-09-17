import {
  useId, useLayoutEffect, useRef, useSyncExternalStore,
  type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { touchInput, type TouchAction, type TouchPress } from '../game/inputBridge';

const COARSE_POINTER = '(any-pointer: coarse)';
let touchObserved = false;

function touchAvailable() {
  return typeof window !== 'undefined' && (
    touchObserved || window.matchMedia?.(COARSE_POINTER).matches === true ||
    (!window.matchMedia && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
}

function subscribeTouchAvailability(listener: () => void) {
  const media = window.matchMedia?.(COARSE_POINTER);
  const pointer = (event: globalThis.PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    touchObserved = true;
    listener();
  };
  media?.addEventListener('change', listener);
  window.addEventListener('focus', listener);
  window.addEventListener('pageshow', listener);
  window.addEventListener('resize', listener);
  window.addEventListener('pointerdown', pointer);
  return () => {
    media?.removeEventListener('change', listener);
    window.removeEventListener('focus', listener);
    window.removeEventListener('pageshow', listener);
    window.removeEventListener('resize', listener);
    window.removeEventListener('pointerdown', pointer);
  };
}

export function useTouchControlsEnabled(): boolean {
  return useSyncExternalStore(subscribeTouchAvailability, touchAvailable, () => false);
}

type CapturedPress = { press: TouchPress; button: HTMLButtonElement };
const ACTIONS: Record<TouchAction, { label: string; glyph: string; text: string }> = {
  left: { label: 'Move left', glyph: '◀', text: 'LEFT' },
  right: { label: 'Move right', glyph: '▶', text: 'RIGHT' },
  jump: { label: 'Jump', glyph: '↑', text: 'JUMP' },
  interact: { label: 'Interact', glyph: '◇', text: 'USE' },
};
const VIRTUAL_IDS: Record<TouchAction, number> = { left: -2, right: -3, jump: -4, interact: -5 };

function unavailablePointer(error: unknown) {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'InvalidStateError');
}

export function TouchControls({ disabled, runId }: { disabled: boolean; runId: number }) {
  const held = useSyncExternalStore(touchInput.subscribe, touchInput.getSnapshot, touchInput.getSnapshot);
  const captured = useRef(new Map<number, CapturedPress>());
  const activated = useRef(new Map<TouchAction, TouchPress>());
  const helpId = useId();

  useLayoutEffect(() => {
    const captures = captured.current;
    const releaseCapture = ({ press, button }: CapturedPress) => {
      try {
        if (button.hasPointerCapture(press.pointerId)) button.releasePointerCapture(press.pointerId);
      } catch (error: unknown) {
        if (!unavailablePointer(error)) throw error;
        // The UA may already have discarded a cancelled pointer or detached button.
      }
    };
    const clearCaptures = () => {
      const previous = [...captures.values()];
      captures.clear();
      activated.current.clear();
      previous.forEach(releaseCapture);
    };
    const offReset = touchInput.subscribeReset(clearCaptures);
    const release = (event: PointerEvent) => {
      const capture = captures.get(event.pointerId);
      if (!capture) return;
      captures.delete(event.pointerId);
      if (event.type === 'pointercancel') touchInput.cancel(capture.press);
      else touchInput.release(capture.press);
      releaseCapture(capture);
    };
    const reset = () => touchInput.reset();
    const visibility = () => { if (document.hidden) reset(); };

    touchInput.setEnabled(!disabled);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', reset);
    window.addEventListener('pagehide', reset);
    window.addEventListener('orientationchange', reset);
    return () => {
      touchInput.setEnabled(false);
      offReset();
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', reset);
      window.removeEventListener('pagehide', reset);
      window.removeEventListener('orientationchange', reset);
    };
  }, [disabled, runId]);

  const press = (action: TouchAction, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || document.hidden || event.button !== 0) return;
    event.preventDefault();
    const token = touchInput.press(action, event.pointerId);
    if (!token) return;
    const button = event.currentTarget;
    captured.current.set(event.pointerId, { press: token, button });
    try {
      button.setPointerCapture(event.pointerId);
    } catch (error: unknown) {
      if (!unavailablePointer(error)) throw error;
      // Document-level releases still work if pointer capture is unavailable.
    }
  };

  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const capture = captured.current.get(event.pointerId);
    if (!capture) return;
    if (event.type === 'lostpointercapture' && event.currentTarget.hasPointerCapture(event.pointerId)) return;
    captured.current.delete(event.pointerId);
    if (event.type === 'pointerup') touchInput.release(capture.press);
    else touchInput.cancel(capture.press);
  };

  const releaseActivation = (action: TouchAction) => {
    const token = activated.current.get(action);
    if (!token) return;
    activated.current.delete(action);
    touchInput.release(token);
  };

  const key = (action: TouchAction, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    // Keep Space on a focused movement button out of Phaser's jump listener.
    event.stopPropagation();
    if (event.type === 'keyup') releaseActivation(action);
    else if (!event.repeat && !activated.current.has(action)) {
      const token = touchInput.press(action, VIRTUAL_IDS[action]);
      if (token) activated.current.set(action, token);
    }
  };

  const activate = (action: TouchAction) => {
    if (disabled || document.hidden) return;
    if (activated.current.has(action)) {
      releaseActivation(action);
      return;
    }
    const token = touchInput.press(action, VIRTUAL_IDS[action]);
    if (!token) return;
    if (action === 'left' || action === 'right') activated.current.set(action, token);
    else touchInput.release(token);
  };

  const button = (action: TouchAction) => (
    <button
      key={action}
      type="button"
      className={`touch-button touch-${action}${!disabled && held[action] ? ' is-held' : ''}`}
      aria-label={ACTIONS[action].label}
      aria-pressed={!disabled && held[action]}
      aria-describedby={helpId}
      disabled={disabled}
      onPointerDown={(event) => press(action, event)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => key(action, event)}
      onKeyUp={(event) => key(action, event)}
      onBlur={() => releaseActivation(action)}
      onClick={(event) => { if (event.detail === 0) activate(action); }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span aria-hidden="true">{ACTIONS[action].glyph}</span>
      <span aria-hidden="true">{ACTIONS[action].text}</span>
    </button>
  );

  return (
    <div className="touch-controls" role="group" aria-label="Touch controls">
      <span id={helpId} hidden>
        Hold a direction and Jump together. With a focused button, hold Enter or Space.
        Assistive activation toggles a direction; activate it again to stop.
      </span>
      <div className="touch-move" role="group" aria-label="Movement">
        {button('left')}{button('right')}
      </div>
      <div className="touch-actions" role="group" aria-label="Actions">
        {button('jump')}{button('interact')}
      </div>
    </div>
  );
}
