// src/lib/context/ToastViewport.tsx — Portal-rendered bottom-right viewport.
//
// Separated from ToastContext.tsx so swapping render strategy (e.g. bottom-left
// on small windows) touches one file. Renders via React Portal to document.body
// so the viewport survives Dialog (CommandPalette) z-index stacking.
//
// Visual anatomy: glass-1 panel + colored left bar (per type) + icon + title
// + optional message + dismiss button. Pure CSS motion (D-02) — no Framer.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-59
// @see src/lib/context/toast.css

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToastItem } from './ToastContext';

interface Props {
  items: ToastItem[];
  dismiss: (id: string) => void;
}

const ICONS: Record<ToastItem['type'], string> = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '×',
};

export function ToastViewport({ items, dismiss }: Props) {
  // SSR-safe check — Tauri is CSR but we keep this for test harness safety.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="toast-viewport"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type} glass glass-1`}
          role="status"
          data-toast-type={t.type}
        >
          <div className="toast-bar" aria-hidden="true" />
          <div className="toast-icon" aria-hidden="true">
            {ICONS[t.type]}
          </div>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-message">{t.message}</div>}
          </div>
          <button
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
