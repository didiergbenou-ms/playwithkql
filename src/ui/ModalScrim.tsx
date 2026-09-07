import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Modal scrim with real dialog semantics.
 *
 * Previously the overlay was a plain `div`: the page behind stayed in the tab
 * order, so keyboard and screen-reader users could tab straight out of the
 * terminal into the HUD and menu underneath, activating controls they could
 * not see. Nothing announced that a dialog had opened either.
 *
 * This adds the three things a modal owes its users:
 *   - `role="dialog"` + `aria-modal`, so assistive tech announces it and
 *     treats the rest of the page as inert
 *   - focus moved into the dialog on open and returned on close, so keyboard
 *     users are not dumped back at the top of the document
 *   - a focus trap, so Tab cycles within the dialog instead of escaping it
 *
 * `inert` on the background would be tidier, but browser support is still
 * uneven enough that the explicit trap is the dependable option.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ModalScrim({
  onDismiss,
  label,
  children,
}: {
  /** Called for a backdrop click. Pass undefined to make the modal sticky. */
  onDismiss?: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;

    // Prefer the first real control; fall back to the container itself, which
    // is why it carries tabIndex={-1}.
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === firstItem || active === node)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Returning focus matters as much as taking it: without this the caret
      // lands back at the top of the document on every close.
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="scrim-dialog"
      >
        {children}
      </div>
    </div>
  );
}
