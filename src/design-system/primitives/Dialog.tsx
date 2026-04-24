import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Dialog — native `<dialog>` modal (D-01, STACK.md §Area 4).
 *
 * Browser handles focus trap + ESC close natively via showModal(), so no
 * Radix / library is needed.
 *
 * A11Y2-04 additions (Phase 14 Plan 14-04):
 *   - aria-modal="true" on the dialog element (screen reader modal semantics)
 *   - On open: captures document.activeElement (prevFocusRef) BEFORE showModal(),
 *     then moves focus to the first interactive child inside the dialog.
 *   - On close: restores focus to prevFocusRef so keyboard users return to
 *     their context after dismissing the dialog.
 *   - Optional triggerRef prop: if provided, focus is restored to that element
 *     on close (useful when the trigger is not document.activeElement at the
 *     time the dialog opens).
 *
 * `ariaLabel` is required for screen readers when the dialog has no visible
 * heading (T-04-04 mitigation).
 *
 * Styling rides on `.glass .glass-1 .dialog` + `dialog.glass` rules in
 * primitives.css.
 */

/** Selector for the first focusable child inside the dialog. */
const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** aria-label for screen readers; required when no visible heading */
  ariaLabel?: string;
  /**
   * Optional ref to the element that triggered the dialog open. When provided,
   * focus is restored to this element on close instead of to the element that
   * was active before showModal() was called.
   */
  triggerRef?: React.RefObject<HTMLElement>;
}

export function Dialog({ open, onClose, children, ariaLabel, triggerRef }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Holds the element that was focused before the dialog opened. */
  const prevFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open && !el.open) {
      // Capture the currently focused element BEFORE showModal() moves focus.
      prevFocusRef.current = document.activeElement;
      el.showModal();
      // Move focus to the first interactive child inside the dialog.
      // showModal() may not do this automatically in all WebView2 versions.
      const firstFocusable = el.querySelector<HTMLElement>(FOCUSABLE);
      if (firstFocusable) {
        firstFocusable.focus();
      }
    } else if (!open && el.open) {
      el.close();
      // Restore focus to trigger ref if provided, otherwise to the element
      // that was focused before the dialog opened.
      const restoreTarget = triggerRef?.current ?? (prevFocusRef.current as HTMLElement | null);
      restoreTarget?.focus();
      prevFocusRef.current = null;
    }
  }, [open, triggerRef]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={ariaLabel}
      aria-modal="true"
      className="glass glass-1 dialog"
    >
      {children}
    </dialog>
  );
}
