import { useRef, type MouseEvent, type PointerEvent } from 'react';

/** HUD/dialog buttons must work while another finger holds a movement control. */
export function useSecondaryTouchActivation() {
  const activated = useRef<{ button: HTMLButtonElement; at: number } | null>(null);

  return {
    onPointerDown: () => { activated.current = null; },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.isPrimary ||
          (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!(button instanceof HTMLButtonElement) || button.disabled ||
          !event.currentTarget.contains(button)) return;
      const box = button.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom) return;
      // Some browsers only synthesize click for the primary pointer. Reuse the
      // button's ordinary action, but suppress a later native duplicate if any.
      event.preventDefault();
      activated.current = { button, at: performance.now() };
      button.click();
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      const previous = activated.current;
      if (!previous || !event.isTrusted || event.detail === 0) return;
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button === previous.button && performance.now() - previous.at < 1000) {
        activated.current = null;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
