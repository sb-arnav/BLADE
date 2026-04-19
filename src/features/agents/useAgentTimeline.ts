// src/features/agents/useAgentTimeline.ts
//
// Ref-buffer + rAF-flush event timeline for AgentDetail (Plan 05-03, Pattern §2).
// Subscribes to all 10 agent lifecycle events emitted by the Rust agent executor
// and swarm runner, consolidates them into a single client-side timeline, and
// flushes the accumulated rows to committed state on the next animation frame.
// Cap of 200 rows prevents unbounded memory growth under event floods (D-125);
// client-side agent-id filtering drops cross-agent noise (D-130). The
// subscription surface uses `useTauriEvent` verbatim — no raw `listen` (D-13).
//
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §2
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-125, §D-129, §D-130, §D-135
// @see src-tauri/src/agents/executor.rs:99,178,240,265,313,335,349 (7 step emit sites)

import { useCallback, useEffect, useRef, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  AgentEventPayload,
  AgentStepStartedPayload,
  AgentStepCompletedPayload,
} from '@/lib/events/payloads';
import type { TimelineRow } from './types';

/** Hard cap on retained timeline rows (D-125). */
const MAX_TIMELINE_ROWS = 200;

/** Payload preview length — matches Pattern §2 (80 chars). */
const PREVIEW_MAX_CHARS = 80;

type AnyPayload = Record<string, unknown> | null;

/** Extract the agent id from the heterogeneous Rust payload shapes (D-130). */
function extractAgentId(payload: AnyPayload): string {
  if (!payload) return '';
  const raw = payload.agent_id ?? payload.id ?? '';
  return typeof raw === 'string' ? raw : String(raw);
}

/** Build the 80-char preview safely (payload may legitimately be null). */
function buildPreview(payload: AnyPayload): string {
  if (!payload) return '';
  try {
    return JSON.stringify(payload).slice(0, PREVIEW_MAX_CHARS);
  } catch {
    // Circular or non-serialisable payload — still surface a placeholder.
    return '[unserialisable payload]';
  }
}

export interface UseAgentTimelineResult {
  rows: TimelineRow[];
  /** Reset the timeline (e.g. when switching agents). */
  clear: () => void;
}

/**
 * Ref-buffer + rAF-flush event timeline for AgentDetail. Mounts 10
 * `useTauriEvent` subscribers (D-129) that funnel into a shared ring buffer;
 * accumulated rows are committed on the next animation frame so React renders
 * at most once per frame even under a 50 event/s burst.
 *
 * @param currentAgentId  if non-empty, only events whose `payload.agent_id` /
 *                        `payload.id` matches are appended (D-130). Pass `null`
 *                        to disable filtering (AgentTimeline cross-agent view —
 *                        Plan 05-04 lane).
 */
export function useAgentTimeline(currentAgentId: string | null): UseAgentTimelineResult {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const bufferRef = useRef<TimelineRow[]>([]);
  const seqRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (bufferRef.current.length === 0) return;
      const incoming = bufferRef.current;
      bufferRef.current = [];
      setRows((prev) => {
        const next = prev.concat(incoming);
        return next.length > MAX_TIMELINE_ROWS
          ? next.slice(next.length - MAX_TIMELINE_ROWS)
          : next;
      });
    });
  }, []);

  const push = useCallback(
    (event: string, payload: AnyPayload) => {
      const agentId = extractAgentId(payload);
      // D-130 client-side filter. Events without an agent id are always dropped
      // when a specific agent is selected (noise reduction).
      if (currentAgentId) {
        if (!agentId || agentId !== currentAgentId) return;
      }
      const seq = ++seqRef.current;
      bufferRef.current.push({
        seq,
        ts: Date.now(),
        event,
        agentId,
        preview: buildPreview(payload),
      });
      scheduleFlush();
    },
    [currentAgentId, scheduleFlush],
  );

  const clear = useCallback(() => {
    setRows([]);
    bufferRef.current = [];
    seqRef.current = 0;
  }, []);

  // 10 subscriptions (D-129 — one per event name). Each handler is a thin
  // wrapper around `push`; the useTauriEvent hook stores handlers in a ref so
  // the inline-arrow identity does not churn listeners (P-06 prevention).
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.BLADE_AGENT_EVENT,
    (e) => push('blade_agent_event', e.payload ?? null),
  );
  useTauriEvent<AgentStepStartedPayload | null>(
    BLADE_EVENTS.AGENT_STEP_STARTED,
    (e) => push('agent_step_started', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_STEP_RESULT,
    (e) => push('agent_step_result', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_STEP_RETRYING,
    (e) => push('agent_step_retrying', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_STEP_TOOL_FALLBACK,
    (e) => push('agent_step_tool_fallback', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_STEP_PROVIDER_FALLBACK,
    (e) => push('agent_step_provider_fallback', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_STEP_PARTIAL,
    (e) => push('agent_step_partial', e.payload ?? null),
  );
  useTauriEvent<AgentStepCompletedPayload | null>(
    BLADE_EVENTS.AGENT_STEP_COMPLETED,
    (e) => push('agent_step_completed', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_STEP_FAILED,
    (e) => push('agent_step_failed', e.payload ?? null),
  );
  useTauriEvent<AgentEventPayload | null>(
    BLADE_EVENTS.AGENT_EVENT,
    (e) => push('agent_event', e.payload ?? null),
  );

  // Cancel any pending rAF on unmount (D-68 discipline + T-05-03-04 mitigation).
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { rows, clear };
}
