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

// Re-export Tauri event types so consumers in src/ can import from @/lib/events
// without importing directly from @tauri-apps/api/event (D-34 boundary).
export type { Event, EventCallback };

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
  CHAT_ERROR: 'chat_error',
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
  /** Phase 11 Plan 11-04 (D-55) — router emits when a task requires a
   *  capability (vision / audio / long_context / tools) but none of the
   *  user's configured providers support it. Fires ONCE per
   *  send_message_stream call (no retry loop per 4ab464c posture).
   *  Payload: RoutingCapabilityMissingPayload (see payloads.ts).
   *
   *  NOTE: This is DIFFERENT from CAPABILITY_GAP_DETECTED above (which is
   *  a Phase-10 legacy constant for self_upgrade). Subscribers of
   *  ROUTING_CAPABILITY_MISSING will NOT receive CAPABILITY_GAP_DETECTED
   *  events and vice-versa — the two literals are disjoint. */
  ROUTING_CAPABILITY_MISSING: 'blade_routing_capability_missing',

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
  BLADE_ROUTE_REQUEST: 'blade_route_request',

  // ───── Ghost (LIVE — ghost_mode.rs) ──────────────────────────────────────
  GHOST_MEETING_STATE: 'ghost_meeting_state',
  GHOST_MEETING_ENDED: 'ghost_meeting_ended',
  GHOST_SUGGESTION_READY_TO_SPEAK: 'ghost_suggestion_ready_to_speak',
  /** Phase 4 Plan 04-04 (D-112) — Ctrl+G shortcut emit, Rust src-tauri/src/lib.rs:326.
   *  Toggles GhostOverlayWindow card visibility; payload is `{}` (treated as null). */
  GHOST_TOGGLE_CARD: 'ghost_toggle_card',

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

  // ───── Agent step events (executor.rs fine-grained lifecycle — Phase 5 consumer) ─
  // Plan 05-01 (D-121, D-125) — closes the gap between 4 shipped constants and
  // the 10-subscriber surface AgentDetail needs (D-129). Values match the Rust
  // emit strings verbatim at `src-tauri/src/agents/executor.rs` line offsets.
  AGENT_STEP_RETRYING:          'agent_step_retrying',          // executor.rs:177
  AGENT_STEP_TOOL_FALLBACK:     'agent_step_tool_fallback',     // executor.rs:243
  AGENT_STEP_PROVIDER_FALLBACK: 'agent_step_provider_fallback', // executor.rs:267
  AGENT_STEP_PARTIAL:           'agent_step_partial',           // executor.rs:314
  AGENT_STEP_COMPLETED:         'agent_step_completed',         // executor.rs:335
  AGENT_STEP_FAILED:            'agent_step_failed',            // executor.rs:349

  // ───── Phase 6 — Life OS + Identity lifecycle (Plan 06-01 audit additions) ─
  // All 9 events below fire from scheduled/background loops or streaming
  // long-running commands (not simple request-response). Phase 6 consumers
  // benefit from subscribing vs polling. Values match Rust emit strings verbatim.
  BLADE_HEALTH_NUDGE:     'blade_health_nudge',     // health_tracker.rs:416,450,469 — scheduled nudge loop
  HEALTH_BREAK_REMINDER:  'health_break_reminder',  // health_guardian.rs:150,160,180 — scheduled break loop
  BLADE_EMOTION_DETECTED: 'blade_emotion_detected', // emotional_intelligence.rs:753 — fires on valence shift during detection
  ACCOUNTABILITY_NUDGE:   'accountability_nudge',   // accountability.rs:755,777 — scheduled check-in + behind-KR alerts
  BLADE_PREDICTION:       'blade_prediction',       // prediction_engine.rs:589 — high-confidence predictions fired during background generation
  BLADE_HABIT_REMINDER:   'blade_habit_reminder',   // habit_engine.rs:760 — scheduled habit reminder loop
  GOAL_PROGRESS:          'goal_progress',          // goal_engine.rs:810,975 — emitted during async goal_pursue_now loop
  GOAL_SUBTASK_UPDATE:    'goal_subtask_update',    // goal_engine.rs:389,403 — per-subtask streaming during pursue
  GOAL_COMPLETED:         'goal_completed',         // goal_engine.rs:623 — emitted when pursue loop reaches verification success
  BLADE_DEBATE_UPDATE:    'blade_debate_update',    // negotiation_engine.rs:519 — streaming per-round during async debate
  BLADE_REASONING_STEP:   'blade_reasoning_step',   // reasoning_engine.rs:645,667 — streaming per-step during multi-step reasoning

  // ───── Phase 7 — Dev Tools + Admin lifecycle (Plan 07-01 audit additions) ─
  // All 8 emits below are emit_to("main", ...) calls from either streaming
  // long-running loops OR scheduled background tasks — NOT simple
  // request-response. Phase 7 consumers (WebAutomation, CapabilityReports,
  // Diagnostics, SecurityDashboard) benefit from subscribing vs polling.
  // Constant values mirror the Rust emit strings verbatim; the grep audit
  // confirmed every site at the file:line annotation below. Phase 7 consumers
  // MUST subscribe via useTauriEvent per D-13 / D-38-hook.
  //
  // Notes on events considered but rejected:
  // - workflow_run_started / workflow_run_completed / integration_status_changed
  //   DO NOT exist in Rust (D-167 audit). Phase 7 plans that referenced these
  //   speculative names fall back to polling on action completion, per the
  //   "if constant exists" guard in Plan 07-03 + 07-06.
  // - browser_agent_event (speculative name in Plan 07-04) — real emit is
  //   browser_agent_step; Plan 07-04 should subscribe to BROWSER_AGENT_STEP.
  // - blade_workflow_notification (workflow_builder.rs:466) — fires inside a
  //   workflow's "notify" node (user-facing toast), NOT workflow lifecycle;
  //   duplicates the blade_toast/blade_notification surface. Not useful for
  //   WorkflowBuilder status; skipped.
  BROWSER_AGENT_STEP:    'browser_agent_step',    // browser_agent.rs:268,284 — streaming per-step during browser_agent_loop (DEV-06 WebAutomation)
  BLADE_EVOLVING:        'blade_evolving',        // immune_system.rs:31,45,78,85,97 — multi-step capability-resolution status (Admin CapabilityReports)
  BLADE_AUTO_UPGRADED:   'blade_auto_upgraded',   // evolution.rs:792 — scheduled evolution loop auto-install notification (Admin CapabilityReports)
  EVOLUTION_SUGGESTION:  'evolution_suggestion',  // evolution.rs:800,945 — scheduled evolution-loop suggestion (Admin CapabilityReports)
  BLADE_LEVELED_UP:      'blade_leveled_up',      // evolution.rs:812 — background evolution level-up milestone (Admin CapabilityReports)
  SERVICE_CRASHED:       'service_crashed',       // supervisor.rs:144 — background watchdog when a managed service crashes (Admin Diagnostics + SecurityDashboard)
  SERVICE_DEAD:          'service_dead',          // supervisor.rs:156 — background watchdog after MAX_RESTARTS crashes (Admin Diagnostics + SecurityDashboard)
  WATCHER_ALERT:         'watcher_alert',         // watcher.rs:212 — background URL-watcher change detection (Admin SecurityDashboard / Reports)

  // ───── Phase 8 — Body + Hive lifecycle (Plan 08-01 audit additions) ──────
  // All 10 emits confirmed by grep audit at
  // .planning/phases/08-body-hive/08-CONTEXT.md §code_context.
  // Constant values mirror the Rust emit strings verbatim; file:line cites
  // inline. Phase 8 consumers subscribe via useTauriEvent per D-13 / D-38-hook.
  //
  // Already-existing constants Phase 8 consumers re-use (NOT re-added):
  //   - HORMONE_UPDATE / HOMEOSTASIS_UPDATE (HormoneBus BODY-03)
  //   - AI_DELEGATE_APPROVED / AI_DELEGATE_DENIED (AiDelegate HIVE-06)
  HIVE_TICK:              'hive_tick',              // hive.rs:2600 — 30s status refresh (HiveMesh HIVE-01)
  HIVE_ACTION:            'hive_action',            // hive.rs:2723, 2780 — hive action (HiveMesh + ApprovalQueue)
  HIVE_ESCALATE:          'hive_escalate',          // hive.rs:2813 — hive needs user decision (ApprovalQueue HIVE-04)
  HIVE_INFORM:            'hive_inform',            // hive.rs:2686 — hive info surfacing (HiveMesh HIVE-01)
  HIVE_PENDING_DECISIONS: 'hive_pending_decisions', // hive.rs:2603 — pending decisions changed (ApprovalQueue HIVE-04)
  HIVE_CI_FAILURE:        'hive_ci_failure',        // hive.rs:2509 — CI failure detected (HiveMesh HIVE-01)
  HIVE_AUTO_FIX_STARTED:  'hive_auto_fix_started',  // hive.rs:2530 — auto-fix started (HiveMesh HIVE-01)
  HIVE_ACTION_DEFERRED:   'hive_action_deferred',   // hive.rs:2763 — hive action deferred (ApprovalQueue HIVE-04)
  TENTACLE_ERROR:         'tentacle_error',         // hive.rs:2304 — tentacle Error status (HiveMesh + TentacleDetail)
  WORLD_STATE_UPDATED:    'world_state_updated',    // world_model.rs:869 — background world refresh (WorldModel BODY-06)

  // ───── Phase 14 — Activity Log (Plan 14-01, LOG-01..05) ──────────────────
  // Emitted by ecosystem.rs emit_activity_with_id() on every observer tick.
  // Payload: ActivityLogEntry (see src/features/activity-log/index.tsx).
  ACTIVITY_LOG: 'blade_activity_log',

  // ───── Phase 17 — Doctor Module (DOCTOR-06) ──────────────────────────────
  // Emitted by doctor.rs::emit_doctor_event() on severity transitions
  // (NOT same-severity; emit ONLY when new severity ∈ {amber, red}).
  // Payload: DoctorEventPayload (see ./payloads.ts).
  DOCTOR_EVENT: 'doctor_event',

  // ───── Phase 18 — JARVIS Chat → Cross-App Action (JARVIS-11) ─────────────
  // Emitted by ego.rs::emit_jarvis_intercept (single-window via emit_to("main", ...))
  // on capability_gap / refusal / retry / hard_refused state transitions in the
  // tool-loop branch only. Fast-streaming branch is ego-blind (RESEARCH Pitfall 3).
  // Payload: JarvisInterceptPayload (see ./payloads.ts).
  JARVIS_INTERCEPT: 'jarvis_intercept',

  // ───── Phase 29 — Vitality Engine (VITA-05) ──────────────────────────────
  // Emitted by vitality_engine.rs on band transitions, significant scalar
  // changes, dormancy initiation, and reincarnation completion. Values match
  // the Rust emit strings verbatim.
  BLADE_VITALITY_UPDATE: 'blade_vitality_update',   // vitality_engine.rs — scalar/band/trend tick
  BLADE_DORMANCY:        'blade_dormancy',           // vitality_engine.rs — dormancy sequence initiated
  BLADE_REINCARNATION:   'blade_reincarnation',      // vitality_engine.rs — reincarnation completed on startup

  // ───── Phase 18 — JARVIS Consent Request (JARVIS-05) ─────────────────────
  // Emitted by jarvis_dispatch::emit_consent_request when consent_check returns
  // NeedsPrompt for a (intent_class, target_service) tuple. ChatPanel opens
  // ConsentDialog and awaits user decision (max 60s, then assumed deny).
  // Payload: ConsentRequestPayload (see ./payloads.ts).
  CONSENT_REQUEST: 'consent_request',

  // ───── Phase 33 — Agentic Loop lifecycle (LOOP-01..06) ───────────────────
  // Emitted by src-tauri/src/loop_engine.rs on verification_fired (33-04),
  // replanning (33-05), token_escalated (33-06), and halted (33-08).
  // Payload: BladeLoopEventPayload (see ./payloads.ts).
  // ActivityStrip subscribes via useActivityLog (see src/features/activity-log/index.tsx).
  BLADE_LOOP_EVENT: 'blade_loop_event',
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
