// src/features/activity-log/index.tsx
//
// Phase 14 Plan 14-01 (LOG-01..05).
// ActivityLogProvider + useActivityLog hook.
// Subscribes to blade_activity_log events via useTauriEvent (D-13).
// Persists ring buffer (MAX_ENTRIES=500) to localStorage "blade_activity_log_v1".

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityLogEntry {
  module: string;
  action: string;
  human_summary: string;
  payload_id: string | null;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 500;
const LS_KEY = 'blade_activity_log_v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFromStorage(): ActivityLogEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ActivityLogEntry[];
  } catch {
    return [];
  }
}

function saveToStorage(entries: ActivityLogEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    // Storage quota exceeded or unavailable — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ActivityLogCtx {
  log: ActivityLogEntry[];
  clearLog: () => void;
}

const ActivityLogContext = createContext<ActivityLogCtx | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ActivityLogProvider({ children }: { children: ReactNode }) {
  const [log, setLog] = useState<ActivityLogEntry[]>(() => loadFromStorage());

  // Keep a ref to the current log so the event handler always has latest value
  // without re-subscribing (stale-closure-safe pattern, mirrors useTauriEvent).
  const logRef = useRef(log);
  logRef.current = log;

  const handleEvent = useCallback((e: Event<ActivityLogEntry>) => {
    const entry = e.payload;
    const next = [entry, ...logRef.current].slice(0, MAX_ENTRIES);
    logRef.current = next;
    setLog(next);
    saveToStorage(next);
  }, []);

  useTauriEvent<ActivityLogEntry>(BLADE_EVENTS.ACTIVITY_LOG, handleEvent);

  const clearLog = useCallback(() => {
    setLog([]);
    logRef.current = [];
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <ActivityLogContext.Provider value={{ log, clearLog }}>
      {children}
    </ActivityLogContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useActivityLog(): ActivityLogCtx {
  const ctx = useContext(ActivityLogContext);
  if (!ctx) {
    throw new Error('useActivityLog must be used inside <ActivityLogProvider>');
  }
  return ctx;
}
