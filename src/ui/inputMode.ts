import { useSyncExternalStore } from 'react';

export type InputMode = 'auto' | 'touch' | 'keyboard';
export interface PointerCapabilities {
  coarse: boolean;
  fine: boolean;
  hover: boolean;
}

export function prefersTouchControls(mode: InputMode, capabilities: PointerCapabilities): boolean {
  if (mode !== 'auto') return mode === 'touch';
  return capabilities.coarse && !capabilities.fine;
}

let mode: InputMode = 'auto';
const listeners = new Set<() => void>();
const queries = ['(pointer: coarse)', '(pointer: fine)', '(hover: hover)'];

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = queries.map((query) => window.matchMedia(query));
  media.forEach((query) => query.addEventListener('change', listener));
  window.addEventListener('pageshow', listener);
  return () => {
    listeners.delete(listener);
    media.forEach((query) => query.removeEventListener('change', listener));
    window.removeEventListener('pageshow', listener);
  };
}

function touchSnapshot() {
  if (typeof window === 'undefined') return false;
  return prefersTouchControls(mode, {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    fine: window.matchMedia('(pointer: fine)').matches,
    hover: window.matchMedia('(hover: hover)').matches,
  });
}

export function setInputMode(next: InputMode): void {
  if (next === mode) return;
  mode = next;
  listeners.forEach((listener) => listener());
}

/** Session-only override: no gameplay/profile state or per-pointer persistence. */
export function useInputMode(): InputMode {
  return useSyncExternalStore(subscribe, () => mode, () => 'auto');
}

export function useTouchControlsEnabled(): boolean {
  return useSyncExternalStore(subscribe, touchSnapshot, () => false);
}
