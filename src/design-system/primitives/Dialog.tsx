import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Dialog — native `<dialog>` modal (D-01, STACK.md §Area 4).
 *
 * Browser handles focus trap + ESC close natively, so no Radix / library.
 * `ariaLabel` is required for screen readers when the dialog has no visible
 * heading (T-04-04 mitigation).
 *
 * Styling rides on `.glass .glass-1 .dialog` + `dialog.glass` rules in
 * primitives.css.
 */
interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** aria-label for screen readers; required when no visible heading */
  ariaLabel?: string;
}

export function Dialog({ open, onClose, children, ariaLabel }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={ariaLabel}
      className="glass glass-1 dialog"
    >
      {children}
    </dialog>
  );
}
