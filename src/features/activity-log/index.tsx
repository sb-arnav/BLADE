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
import type { BladeLoopEventPayload } from '@/lib/events/payloads';

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

/**
 * Phase 34 / Plan 34-11 — format a Rust StuckPattern discriminant
 * (PascalCase from `src-tauri/src/resilience/stuck.rs::StuckPattern::discriminant`)
 * into a chip-friendly lowercase + space-separated label.
 *
 *   RepeatedActionObservation → "repeated action observation"
 *   MonologueSpiral           → "monologue spiral"
 *   ContextWindowThrashing    → "context window thrashing"
 *   NoProgress                → "no progress"
 *   CostRunaway               → "cost runaway"
 */
function formatPatternLabel(pattern: string): string {
  return pattern
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
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

  // ─── Phase 33 / Plan 33-08 + Phase 34 / Plan 34-11 — agentic-loop +
  //     resilience lifecycle subscription ───────────────────────────────────
  //
  // Maps blade_loop_event into an ActivityLogEntry shape so it flows through
  // the same ring buffer + ActivityStrip surface as blade_activity_log.
  // Most-recent-only display is handled by ActivityStrip reading log[0].
  // No new timer system — the entry is a normal log row that ages out as
  // new entries arrive (matches CONTEXT lock §ActivityStrip Integration:
  // "no new timer; reuse existing toast-fade timing").
  //
  // human_summary maps the discriminated union:
  //   verification_fired → "verifying" / "verifying (off-track)" / "verifying (replan)"
  //   replanning         → "replanning (#N)"
  //   token_escalated    → "token bump → N"
  //   halted             → "halted: cost cap ($X of $Y)" / "halted: iteration cap"
  //                        (Plan 34-06 may carry scope: PerConversation — chip
  //                        text is the same; the JSONL-paired emit retains the
  //                        scope discriminant for forensics)
  // ─── Phase 34 additions ───────────────────────────────────────────────────
  //   stuck_detected     → "stuck: <pattern lowercased + spaced>"
  //   circuit_open       → "circuit open: <error_kind>"
  //   cost_warning       → "cost 80% ($X.XX / $Y.YY)"
  //   cost_update        → NO chip — consumed by cost-meter widget in
  //                        InputBar (early return below; no log row appended)
  const handleLoopEvent = useCallback((e: Event<BladeLoopEventPayload>) => {
    const payload = e.payload;
    let summary: string;
    let action: string;
    switch (payload.kind) {
      case 'verification_fired':
        action = 'verification_fired';
        summary =
          payload.verdict === 'YES'
            ? 'verifying'
            : payload.verdict === 'NO'
              ? 'verifying (off-track)'
              : 'verifying (replan)';
        break;
      case 'replanning':
        action = 'replanning';
        summary = `replanning (#${payload.count})`;
        break;
      case 'token_escalated':
        action = 'token_escalated';
        summary = `token bump → ${payload.new_max}`;
        break;
      case 'halted':
        action = 'halted';
        // Phase 34 / HI-01 (REVIEW finding) — Rust emits four halt reasons,
        // not two. Previously every non-cost_exceeded reason was rendered as
        // "halted: iteration cap" which silently mis-labeled circuit_breaker
        // and stuck halts. Branch explicitly so the operator-visible chip
        // matches what actually halted the loop.
        if (payload.reason === 'cost_exceeded') {
          summary = `halted: cost cap ($${(payload.spent_usd ?? 0).toFixed(2)} of $${(payload.cap_usd ?? 0).toFixed(2)})`;
        } else if (payload.reason === 'circuit_breaker') {
          summary = `halted: circuit open${payload.error_kind ? ` (${payload.error_kind})` : ''}`;
        } else if (typeof payload.reason === 'string' && payload.reason.startsWith('stuck:')) {
          // pattern is the suffix after `stuck:` — e.g. stuck:MonologueSpiral.
          const pattern = payload.reason.slice('stuck:'.length);
          summary = `halted: stuck (${formatPatternLabel(pattern)})`;
        } else if (payload.reason === 'fallback_exhausted') {
          summary = 'halted: fallback chain exhausted';
        } else if (payload.reason === 'iteration_cap') {
          summary = 'halted: iteration cap';
        } else {
          // Unknown reason string — surface it verbatim so the operator can
          // see what the Rust side emitted instead of mis-labeling as iter cap.
          summary = `halted: ${payload.reason}`;
        }
        break;
      // ─── Phase 34 / Plan 34-11 ────────────────────────────────────────────
      case 'stuck_detected':
        action = 'stuck_detected';
        summary = `stuck: ${formatPatternLabel(payload.pattern)}`;
        break;
      case 'circuit_open':
        action = 'circuit_open';
        summary = `circuit open: ${payload.error_kind}`;
        break;
      case 'cost_warning':
        action = 'cost_warning';
        summary = `cost 80% ($${payload.spent_usd.toFixed(2)} / $${payload.cap_usd.toFixed(2)})`;
        break;
      case 'cost_update':
        // Phase 34 — cost_update is the live cost-meter tick, fired every
        // iteration. It is NOT a chip event; the InputBar cost-meter chip
        // subscribes directly via useTauriEvent and renders the running
        // spend/cap. Bypass the activity-log ring buffer entirely so the
        // strip doesn't churn one row per iteration.
        return;
      // ─── Phase 35 / Plan 35-09 ─────────────────────────────────────────
      // Sub-agent + decomposition lifecycle variants land here so the
      // switch stays exhaustive over the BladeLoopEventPayload union
      // (otherwise TS reports `action`/`summary` as possibly unassigned at
      // the entry construction below). Plan 35-10 wires the actual
      // ActivityStrip chip switch + per-step throttling for these — for
      // now, suppress them from the activity ring buffer so they don't
      // surface as half-rendered rows. Deferred-consumer parity with
      // `cost_update` above.
      case 'subagent_started':
      case 'subagent_progress':
      case 'subagent_complete':
      case 'decomposition_complete':
        return;
    }
    const entry: ActivityLogEntry = {
      module: 'loop',
      action,
      human_summary: summary,
      payload_id: null,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const next = [entry, ...logRef.current].slice(0, MAX_ENTRIES);
    logRef.current = next;
    setLog(next);
    saveToStorage(next);
  }, []);

  useTauriEvent<BladeLoopEventPayload>(
    BLADE_EVENTS.BLADE_LOOP_EVENT,
    handleLoopEvent,
  );

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
