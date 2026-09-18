import { useLayoutEffect, useRef } from 'react';

/** Keyboard viewport measurements belong to overlays, never to the Phaser host. */
export function useModalViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const node = ref.current;
    if (!viewport || !node) return;
    const update = () => {
      // Following pinch zoom would shrink content instead of magnifying it.
      if (Math.abs(viewport.scale - 1) > 0.01) return;
      node.style.setProperty('--modal-viewport-height', `${viewport.height}px`);
      node.style.setProperty('--modal-viewport-top', `${viewport.offsetTop}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      node.style.removeProperty('--modal-viewport-height');
      node.style.removeProperty('--modal-viewport-top');
    };
  }, []);
  return ref;
}
