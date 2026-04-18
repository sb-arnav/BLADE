// src/lib/context/ToastContext.tsx — Toast system (SHELL-04, D-59).
//
// Single permitted toast surface. Components call useToast().show(...); the
// provider owns state + auto-dismiss timers; viewport renders via a portal
// so z-index stacking with Dialog (CommandPalette) is a non-issue.
//
// Max 5 concurrent toasts; when a 6th arrives the oldest is dropped.
// Auto-dismiss: 4000ms for info/success; 7000ms for warn/error.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-59
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §5

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ToastViewport } from './ToastViewport';

export type ToastType = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  createdAt: number;
  durationMs: number;
}

type ShowInput = Omit<ToastItem, 'id' | 'createdAt' | 'durationMs'> & {
  durationMs?: number;
};

interface ToastContextValue {
  show: (t: ShowInput) => string; // returns id
  dismiss: (id: string) => void;
}

const Ctx = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastType, number> = {
  info: 4000,
  success: 4000,
  warn: 7000,
  error: 7000,
};

const MAX_CONCURRENT = 5;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Track active timeout ids so unmount clears them (listener-leak discipline).
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    const t = timers.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (t: ShowInput) => {
      const id = makeId();
      const durationMs = t.durationMs ?? DEFAULT_DURATION[t.type];
      const item: ToastItem = { ...t, id, createdAt: Date.now(), durationMs };
      setItems((prev) => [...prev, item].slice(-MAX_CONCURRENT));
      const handle = window.setTimeout(() => dismiss(id), durationMs);
      timers.current.set(id, handle);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    // Snapshot + clean on unmount to avoid late-fire setItems on a dead tree.
    const map = timers.current;
    return () => {
      map.forEach((h) => window.clearTimeout(h));
      map.clear();
    };
  }, []);

  return (
    <Ctx.Provider value={{ show, dismiss }}>
      {children}
      <ToastViewport items={items} dismiss={dismiss} />
    </Ctx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
