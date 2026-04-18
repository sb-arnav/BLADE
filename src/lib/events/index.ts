// src/lib/events/index.ts
//
// Event registry (FOUND-05) + useTauriEvent hook (FOUND-06).
// The ONLY permitted listen() surface in the codebase per D-13 and D-34;
// raw `listen` imports outside this file are banned by Plan 09 ESLint rule.
//
// The hook is the P-06 prevention substrate: Chat→Dashboard×5 route churn
// must leave exactly 1 consumed handler per backend emission. The dev-only
// `window.__BLADE_LISTENERS_COUNT__` counter is the assertion hook for the
// Plan 09 Playwright leak spec.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-13, §D-38-evt, §D-38-payload, §D-38-hook
// @see .planning/research/PITFALLS.md §P-06 (listener leak prevention)

import { useEffect, useRef } from 'react';
import { listen, type EventCallback, type Event } from '@tauri-apps/api/event';

// Re-export hand-written payload interfaces.
export type * from './payloads';

// ---------------------------------------------------------------------------
// BLADE_EVENTS — flat frozen registry (D-38-evt).
//
// 29 LIVE events (backend emits today, per .planning/RECOVERY_LOG.md §4)
// + 5 WIRE-REQUIRED forward declarations (Phase 3 emit targets; payload
//   interfaces in ./payloads.ts so the type surface is complete Day 1).
// + supporting voice / ghost / agents subset needed by Phase 4–5 consumers.
// ---------------------------------------------------------------------------

export const BLADE_EVENTS = {
  // ───── Chat pipeline (LIVE — src-tauri/src/commands.rs) ──────────────────
  CHAT_TOKEN: 'chat_token',
  CHAT_DONE: 'chat_done',
  CHAT_ACK: 'chat_ack',
  CHAT_ROUTING: 'chat_routing',
  CHAT_CANCELLED: 'chat_cancelled',
  CHAT_THINKING: 'chat_thinking',
  CHAT_THINKING_DONE: 'chat_thinking_done',
  BLADE_STATUS: 'blade_status',
  BLADE_PLANNING: 'blade_planning',
  BLADE_NOTIFICATION: 'blade_notification',
  BLADE_ROUTING_SWITCHED: 'blade_routing_switched',

  // ───── WIRE-REQUIRED forward declarations (Phase 3 emit targets) ─────────
  // Payload interfaces in ./payloads.ts; consumers can subscribe Day 1 and
  // see an empty stream until the Rust emit site lands.
  BLADE_MESSAGE_START: 'blade_message_start',       // WIRE-03
  BLADE_THINKING_CHUNK: 'blade_thinking_chunk',     // WIRE-04
  BLADE_TOKEN_RATIO: 'blade_token_ratio',           // WIRE-06
  BLADE_QUICKASK_BRIDGED: 'blade_quickask_bridged', // WIRE-01
  HORMONE_UPDATE: 'hormone_update',                 // WIRE-02 — Phase 3 rename of HOMEOSTASIS_UPDATE

  // ───── Tool + approval (LIVE) ────────────────────────────────────────────
  TOOL_APPROVAL_NEEDED: 'tool_approval_needed',
  TOOL_RESULT: 'tool_result',
  AI_DELEGATE_APPROVED: 'ai_delegate_approved',
  AI_DELEGATE_DENIED: 'ai_delegate_denied',
  BRAIN_GREW: 'brain_grew',
  CAPABILITY_GAP_DETECTED: 'capability_gap_detected',
  RESPONSE_IMPROVED: 'response_improved',

  // ───── Voice (LIVE — voice_global.rs + wake_word.rs) ─────────────────────
  VOICE_CONVERSATION_LISTENING: 'voice_conversation_listening',
  VOICE_CONVERSATION_THINKING: 'voice_conversation_thinking',
  VOICE_CONVERSATION_SPEAKING: 'voice_conversation_speaking',
  VOICE_CONVERSATION_ENDED: 'voice_conversation_ended',
  VOICE_GLOBAL_STARTED: 'voice_global_started',
  VOICE_GLOBAL_TRANSCRIBING: 'voice_global_transcribing',
  VOICE_GLOBAL_ERROR: 'voice_global_error',
  VOICE_TRANSCRIPT_READY: 'voice_transcript_ready',
  VOICE_EMOTION_DETECTED: 'voice_emotion_detected',
  VOICE_LANGUAGE_DETECTED: 'voice_language_detected',
  VOICE_USER_MESSAGE: 'voice_user_message',
  VOICE_SESSION_SAVED: 'voice_session_saved',
  VOICE_CHAT_SUBMIT: 'voice_chat_submit',
  WAKE_WORD_DETECTED: 'wake_word_detected',
  TTS_INTERRUPTED: 'tts_interrupted',

  // ───── System / background (LIVE) ────────────────────────────────────────
  DEEP_SCAN_PROGRESS: 'deep_scan_progress',
  HOMEOSTASIS_UPDATE: 'homeostasis_update', // legacy; HORMONE_UPDATE is Phase 3 rename target
  HUD_DATA_UPDATED: 'hud_data_updated',
  BLADE_TOAST: 'blade_toast',
  GODMODE_UPDATE: 'godmode_update',
  PROACTIVE_NUDGE: 'proactive_nudge',
  SHORTCUT_REGISTRATION_FAILED: 'shortcut_registration_failed',

  // ───── Ghost (LIVE — ghost_mode.rs) ──────────────────────────────────────
  GHOST_MEETING_STATE: 'ghost_meeting_state',
  GHOST_MEETING_ENDED: 'ghost_meeting_ended',
  GHOST_SUGGESTION_READY_TO_SPEAK: 'ghost_suggestion_ready_to_speak',

  // ───── Agents (LIVE emit; Phase 5 consumers) ─────────────────────────────
  BLADE_AGENT_EVENT: 'blade_agent_event',     // WIRE-05 emit exists; UI in Phase 5
  AGENT_STEP_STARTED: 'agent_step_started',
  AGENT_STEP_RESULT: 'agent_step_result',
  SWARM_PROGRESS: 'swarm_progress',
  SWARM_COMPLETED: 'swarm_completed',
  SWARM_CREATED: 'swarm_created',
  AGENT_STARTED: 'agent_started',
  AGENT_OUTPUT: 'agent_output',
  AGENT_COMPLETED: 'agent_completed',
  AGENT_EVENT: 'agent_event',
} as const;

/** Literal union of every string in BLADE_EVENTS. */
export type BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS];

// ---------------------------------------------------------------------------
// Dev-only listener counter — Plan 09 Playwright leak test hook (P-06).
// Lives on `window` so the test runner can read it across route churn without
// importing hook internals.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __BLADE_LISTENERS_COUNT__?: number;
  }
}

// ---------------------------------------------------------------------------
// useTauriEvent — the ONLY permitted event subscription surface (D-13, D-38-hook).
//
// Handler-in-ref pattern: updating `handler` between renders does NOT
// resubscribe. The effect depends only on `[name]`, which means subscription
// happens once per mount / name change. This is the P-06 prevention: callers
// can pass an inline arrow function without churning listeners.
//
// `cancelled` flag guards the async race where listen() resolves after unmount:
// if cleanup runs before the promise resolves, we call the returned unlistenFn
// immediately in the .then branch rather than leaking it.
// ---------------------------------------------------------------------------

/**
 * Subscribe to a Tauri event with automatic cleanup.
 *
 * @example
 *   const onToken = (e: Event<string>) => setContent(c => c + e.payload);
 *   useTauriEvent(BLADE_EVENTS.CHAT_TOKEN, onToken);
 *
 * @param name     — event name from BLADE_EVENTS (literal union enforces catalog).
 * @param handler  — callback receiving Event<T>; stored in a ref so identity
 *                   changes don't re-subscribe (stale-closure-safe).
 */
export function useTauriEvent<T>(
  name: BladeEventName,
  handler: EventCallback<T>,
): void {
  const handlerRef = useRef(handler);
  // Keep ref current without depending on handler identity in the effect.
  handlerRef.current = handler;

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    if (import.meta.env.DEV) {
      const w = window as Window & { __BLADE_LISTENERS_COUNT__?: number };
      w.__BLADE_LISTENERS_COUNT__ = (w.__BLADE_LISTENERS_COUNT__ ?? 0) + 1;
    }

    listen<T>(name, (event: Event<T>) => {
      if (!cancelled) handlerRef.current(event);
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFn = fn;
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
      if (import.meta.env.DEV) {
        const w = window as Window & { __BLADE_LISTENERS_COUNT__?: number };
        w.__BLADE_LISTENERS_COUNT__ = Math.max(
          0,
          (w.__BLADE_LISTENERS_COUNT__ ?? 1) - 1,
        );
      }
    };
    // handler deliberately omitted — the ref pattern handles identity changes
    // without re-subscribing (P-06 prevention).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}
