// src/features/chat/SubagentProgressBubble.tsx
//
// Phase 35 / Plan 35-10 (DECOMP-05) — inline in-flight sub-agent indicator.
//
// Subscribes to BLADE_LOOP_EVENT (the only permitted listen surface per D-13)
// and renders one small chat-bubble per active sub-agent above/below the
// MessageList. Per Claude's discretion lock §Progress Visibility (CONTEXT
// 35), the chat-first pivot favors INLINE visibility for sub-agent activity
// over ActivityStrip-only chips: a user reading a streaming assistant turn
// shouldn't have to glance up to the strip to see decomposition progress.
//
// Lifecycle:
//   - subagent_started        → add {role, status: 'running'} to active map
//   - subagent_progress       → update status (+ optional detail) for matching step_index
//   - subagent_complete       → remove from active map (per-step settle)
//   - decomposition_complete  → schedule a 3s timeout that clears the entire
//                                map (catches any drift where a complete
//                                event was missed, AND gives the user a
//                                visible "all done" beat before the bubbles
//                                disappear). Clearing on the timeout's tick
//                                rather than immediately matches the chat-
//                                first pivot's preference for legible state
//                                transitions over abrupt cleanup.
//
// Listener-leak discipline: the timeout handle is held in a ref + cleared on
// unmount; the BLADE_LOOP_EVENT subscription routes through useTauriEvent so
// React StrictMode double-mount in dev doesn't strand a Tauri listen handle.
//
// Style: reuses the existing .chat-bubble + .chat-bubble-assistant tokens
// from chat.css (matching CompactingIndicator's "borrow established surface"
// pattern, no bespoke design-system work). Spacing is --s-N tokens only.
//
// @see .planning/phases/35-auto-decomposition/35-10-PLAN.md
// @see .planning/phases/35-auto-decomposition/35-CONTEXT.md §Progress Visibility
// @see src/lib/events/payloads.ts (BladeLoopEventPayload Phase 35 variants)

import { useCallback, useEffect, useRef, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';
import type { BladeLoopEventPayload } from '@/lib/events/payloads';

interface ActiveSubagent {
  role: string;
  status: 'running' | 'tool_call' | 'compacting' | 'verifying';
  detail?: string;
}

const POST_COMPLETE_CLEAR_MS = 3000;

/**
 * Plan 35-10 (DECOMP-05) — inline in-flight sub-agent indicator.
 *
 * Renders nothing when no sub-agents are active. Mounted by ChatPanel
 * between CompactingIndicator and MessageList so the bubble surface flows
 * with the streaming chat history rather than overlaying the InputBar.
 */
export function SubagentProgressBubble() {
  const [active, setActive] = useState<Map<number, ActiveSubagent>>(
    () => new Map(),
  );

  // Schedule + auto-clear after decomposition_complete. Held in a ref so the
  // event handler can supersede a prior timer if a second decomposition run
  // begins inside the 3s grace window (rare but possible).
  const clearTimerRef = useRef<number | null>(null);

  const handleLoopEvent = useCallback((e: Event<BladeLoopEventPayload>) => {
    const payload = e.payload;

    setActive((prev) => {
      switch (payload.kind) {
        case 'subagent_started': {
          const next = new Map(prev);
          next.set(payload.step_index, {
            role: payload.role,
            status: 'running',
          });
          return next;
        }
        case 'subagent_progress': {
          // Don't materialise a row if the started event was missed (rare —
          // the Rust executor emits started before the run_loop iterates,
          // but defensive): seed with role='unknown' so we still render.
          const next = new Map(prev);
          const existing = next.get(payload.step_index);
          next.set(payload.step_index, {
            role: existing?.role ?? 'unknown',
            status: payload.status,
            detail: payload.detail,
          });
          return next;
        }
        case 'subagent_complete': {
          if (!prev.has(payload.step_index)) return prev;
          const next = new Map(prev);
          next.delete(payload.step_index);
          return next;
        }
        default:
          return prev;
      }
    });

    // decomposition_complete is the pipeline-wide all-done signal. Schedule
    // a clear-everything timeout AFTER the 3s grace so the user sees a final
    // "wrapping up" beat. Re-schedule supersedes any prior pending timer.
    if (payload.kind === 'decomposition_complete') {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = window.setTimeout(() => {
        setActive(new Map());
        clearTimerRef.current = null;
      }, POST_COMPLETE_CLEAR_MS);
    }
  }, []);

  useTauriEvent<BladeLoopEventPayload>(
    BLADE_EVENTS.BLADE_LOOP_EVENT,
    handleLoopEvent,
  );

  // Listener-leak discipline — clear pending timer on unmount.
  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, []);

  if (active.size === 0) return null;

  // Stable order — sort by step_index ascending so step 0 always renders
  // above step 1, regardless of arrival order.
  const entries = Array.from(active.entries()).sort(([a], [b]) => a - b);

  return (
    <div
      className="subagent-progress-container"
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-2)',
        marginBottom: 'var(--s-2)',
      }}
    >
      {entries.map(([stepIndex, { role, status, detail }]) => (
        <div
          key={stepIndex}
          className="chat-bubble chat-bubble-assistant subagent-progress-bubble"
          style={{
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-2)',
            fontSize: 13,
            color: 'var(--t-2)',
            paddingTop: 'var(--s-2)',
            paddingBottom: 'var(--s-2)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 'var(--r-pill)',
              background: 'var(--status-running, #8affc7)',
              flexShrink: 0,
              animation: 'chatBubblePulse 1.6s ease-in-out infinite',
            }}
          />
          <span>
            <strong style={{ color: 'var(--t-1)' }}>
              Sub-agent {stepIndex} ({role})
            </strong>
            {': '}
            {status}
            {detail ? ` · ${detail}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
