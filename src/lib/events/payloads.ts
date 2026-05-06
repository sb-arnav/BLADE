// src/lib/events/payloads.ts
//
// Hand-written TypeScript interfaces keyed by event name (D-38-payload).
// No runtime schema validation and no Rust-side codegen — drift detection is
// human code-review for now (revisit in Phase 5 if shape bugs accumulate).
//
// Every WIRE-REQUIRED forward declaration (see BLADE_EVENTS in ./index.ts) has
// a payload interface here so the TypeScript surface is complete Day 1 even
// before Rust emits the event. Drift is caught in code review; runtime cast
// of e.payload is acknowledged unsafe (D-38-payload, T-06-05 accept).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-38-payload
// @see .planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md (247 emit sites)
// @see .planning/RECOVERY_LOG.md §4 (29 LIVE events catalogue)

// ---------------------------------------------------------------------------
// Chat pipeline (src-tauri/src/commands.rs)
// ---------------------------------------------------------------------------

export type ChatTokenPayload = string;
export type ChatDonePayload = null;
export type ChatAckPayload = string;
export type ChatCancelledPayload = null;

export interface ChatRoutingPayload {
  provider: string;
  model: string;
  hive_active: boolean;
}

export interface ChatErrorPayload {
  provider: string;
  model: string;
  message: string;
}

export type BladeStatusPayload = 'processing' | 'thinking' | 'idle' | 'error';

export interface BladePlanningPayload {
  query: string;
  mode?: string;
  step_count?: number;
}

export interface BladeNotificationPayload {
  type: 'info' | 'warn' | 'error';
  message: string;
}

export interface BladeRoutingSwitchedPayload {
  from_provider: string;
  from_model: string;
  to_provider: string;
  to_model: string;
  reason: string;
}

/** Phase 11 Plan 11-04 (D-55) — router emits when a task requires a
 *  capability (vision / audio / long_context / tools) but none of the
 *  user's configured providers support it.
 *
 *  Shape matches the serde_json::json!() emit site in
 *  src-tauri/src/commands.rs::send_message_stream. Emitted ONCE per
 *  send_message_stream call (4ab464c posture: no retry loop); graceful
 *  degrade means the request still runs on the user's primary provider
 *  after the event fires. No api_key / no user-content carried
 *  (T-11-24 information-disclosure threat mitigated). */
export interface RoutingCapabilityMissingPayload {
  capability: 'vision' | 'audio' | 'long_context' | 'tools';
  task_type: string;
  primary_provider: string;
  primary_model: string;
  message: string;
}

export type ChatThinkingPayload = string;
export type ChatThinkingDonePayload = null;

// ---------------------------------------------------------------------------
// WIRE-REQUIRED forward declarations (Phase 3 emit targets)
// ---------------------------------------------------------------------------

/** WIRE-01 — src-tauri/src/commands.rs (Phase 3 stub target).
 *  Emit site TBD; payload frozen here so consumers type-check Day 1. */
export interface BladeQuickAskBridgedPayload {
  query: string;
  response: string;
  conversation_id: string;
  mode: 'text' | 'voice';
  timestamp: number;
}

/** WIRE-02 — mirrors src-tauri/src/homeostasis.rs:28 HormoneState
 *  (Phase 3 rename target of `homeostasis_update`). Field names match Rust
 *  struct verbatim; snake_case serde passthrough. */
export interface HormoneUpdatePayload {
  arousal: number;
  energy_mode: number;
  exploration: number;
  trust: number;
  urgency: number;
  hunger: number;
  thirst: number;
  insulin: number;
  adrenaline: number;
  leptin: number;
}

/** WIRE-03 — src-tauri/src/commands.rs (Phase 3).
 *  Emitted when the assistant starts a new streamed message. */
export interface BladeMessageStartPayload {
  message_id: string;
  role: 'assistant';
}

/** WIRE-04 — src-tauri/src/commands.rs (Phase 3).
 *  Streamed reasoning/thinking chunks prior to the visible answer. */
export interface BladeThinkingChunkPayload {
  chunk: string;
  message_id: string;
}

/** WIRE-06 — src-tauri/src/commands.rs (Phase 3).
 *  Fraction of context window consumed; drives the chat token-ratio HUD pill. */
export interface BladeTokenRatioPayload {
  ratio: number;
  tokens_used: number;
  context_window: number;
}

// ---------------------------------------------------------------------------
// Tool / approval
// ---------------------------------------------------------------------------

export interface ToolApprovalNeededPayload {
  tool_name: string;
  args: Record<string, unknown>;
  context: string;
  request_id: string;
}

export interface ToolResultPayload {
  tool_name: string;
  result: unknown;
}

export interface AiDelegatePayload {
  tool_name: string;
}

export interface BrainGrewPayload {
  new_entities: number;
}

export interface CapabilityGapPayload {
  user_request: string;
}

export interface ResponseImprovedPayload {
  improved: string;
}

// ---------------------------------------------------------------------------
// Voice (src-tauri/src/voice_global.rs + wake_word.rs)
// ---------------------------------------------------------------------------

export interface VoiceConversationListeningPayload {
  active: boolean;
}

export interface VoiceConversationThinkingPayload {
  text: string;
}

export interface VoiceConversationSpeakingPayload {
  text: string;
}

export interface VoiceConversationEndedPayload {
  reason: 'stopped' | 'no_mic' | string;
}

export interface VoiceTranscriptReadyPayload {
  text: string;
}

export interface VoiceEmotionDetectedPayload {
  emotion: string;
  transcript: string;
}

export interface VoiceLanguageDetectedPayload {
  language: string;
}

export interface VoiceUserMessagePayload {
  content: string;
}

export interface VoiceSessionSavedPayload {
  conversation_id: string;
  turn_count: number;
}

export interface VoiceChatSubmitPayload {
  content: string;
  voice_mode: true;
  history: Array<{ role: string; content: string }>;
}

export interface WakeWordDetectedPayload {
  phrase: string;
  play_chime: boolean;
}

// ---------------------------------------------------------------------------
// Onboarding / background
// ---------------------------------------------------------------------------

/**
 * Emitted by src-tauri/src/deep_scan.rs:1325 during `deep_scan_start`. Shape:
 * `{phase, found}` — the Rust emit fires once per scanner completion, producing
 * ~11 distinct phase names per run: `starting`, `installed_apps`, `git_repos`,
 * `ides`, `ai_tools`, `wsl_distros`, `ssh_keys`, `package_managers`, `docker`,
 * `bookmarks`, `complete`.
 *
 * The UI derives a display percent client-side; see
 * `src/features/onboarding/deepScanPhases.ts` for the enumeration and helper.
 *
 * Phase 2 D-49 correction of the prior Plan 01-06 shape (`{step, total, label,
 * percent}`), which did NOT match the Rust emit at deep_scan.rs:1325. Rust is
 * the authoritative source per D-38-payload.
 */
export interface DeepScanProgressPayload {
  phase: string;
  found: number;
}

export interface GodmodeUpdatePayload {
  tier: 'Normal' | 'Intermediate' | 'Extreme' | string;
  [k: string]: unknown;
}

export interface ProactiveNudgePayload {
  message: string;
  action?: string;
}

export interface BladeToastPayload {
  type?: 'info' | 'success' | 'warn' | 'error';
  message: string;
  duration_ms?: number;
}

export interface ShortcutRegistrationFailedPayload {
  shortcut: string;
  error: string;
  /** Phase 4 Plan 04-01 (D-94) additive — optional human-readable shortcut name. */
  name?: string;
  /** Phase 4 Plan 04-01 (D-94) additive — list of candidates tried before the
   *  emit fired (either fallbacks that also failed, or all three on a full failure). */
  attempted?: string[];
  /** Phase 4 Plan 04-01 (D-94) additive — the shortcut that ultimately
   *  registered; present on `severity: "warning"` only. */
  fallback_used?: string;
  /** Phase 4 Plan 04-01 (D-94) additive — `"warning"` means a fallback
   *  succeeded (surface a non-fatal toast); `"error"` means every candidate
   *  failed (surface a stranded-state card). Undefined on Phase 3 emits —
   *  treat as `"error"` for back-compat. */
  severity?: 'error' | 'warning';
}

/** Phase 4 Plan 04-01 (D-114) — cross-window route request.
 *  HUD right-click menu / Phase 7 admin surfaces emit via `emit_route_request`;
 *  main's `useRouter` subscribes and calls `openRoute(route_id)` after
 *  validating against the ALL_ROUTES whitelist. */
export interface BladeRouteRequestPayload {
  route_id: string;
}

/** Mirrors src-tauri/src/ghost_mode.rs GhostMeetingState — exact shape pending
 *  Phase 4 implementation; index signature keeps forward-compatibility. */
export interface GhostMeetingStatePayload {
  active: boolean;
  confidence?: number;
  last_transcript_words?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentEventPayload {
  step_id?: string;
  tool_name?: string;
  status?: 'pending' | 'running' | 'complete' | 'error';
  result_preview?: string;
  [k: string]: unknown;
}

export interface AgentLifecyclePayload {
  id: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Phase 5 Plan 05-01 additions — typed subtypes for the 6 new agent step
// events + swarm lifecycle payloads. Every interface keeps an index signature
// `[k: string]: unknown` for forward-compat with Rust shape drift
// (D-38-payload accepted risk + D-125 AgentDetail consumer).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-125
// @see src-tauri/src/agents/executor.rs:99,178,240,265,313,335,349
// ---------------------------------------------------------------------------

/** Mirrors Rust emit at `src-tauri/src/agents/executor.rs:99` (agent_step_started).
 *  Subscribed by AgentDetail to seed timeline rows when a step begins. */
export interface AgentStepStartedPayload {
  step_id: string;
  agent_id: string;
  tool_name?: string;
  role?: string;
  input_preview?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/agents/executor.rs:335` (agent_step_completed).
 *  Carries duration and a preview of the step's result. */
export interface AgentStepCompletedPayload {
  step_id: string;
  agent_id: string;
  duration_ms?: number;
  result_preview?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/swarm_commands.rs:452` (swarm_progress).
 *  SwarmView subscribes to drive the DAG's per-step status + progress bar. */
export interface SwarmProgressPayload {
  swarm_id: string;
  completed_steps: number;
  total_steps: number;
  current_step_id?: string;
  status?: 'pending' | 'running' | 'paused' | 'complete' | 'failed';
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/swarm_commands.rs:524` (swarm_created).
 *  Fired when a swarm DAG is materialised; SwarmView inserts the new row. */
export interface SwarmCreatedPayload {
  swarm_id: string;
  total_steps: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/swarm_commands.rs:390` (swarm_completed).
 *  `error` is populated on failed runs only; success leaves it undefined. */
export interface SwarmCompletedPayload {
  swarm_id: string;
  duration_ms?: number;
  error?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/background_agent.rs:236` (agent_output).
 *  BackgroundAgents subscribes and appends the `output` chunk to the live log. */
export interface AgentOutputPayload {
  id: string;
  output: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Phase 6 Plan 06-01 additions — Life OS + Identity lifecycle payloads.
//
// Every interface below matches the exact JSON shape emitted by a scheduled
// Rust loop or a streaming Rust command (NOT simple request-response).
// Phase 6 consumers (HealthView, EmotionalIntelView, AccountabilityView,
// PredictionsView, HabitView, GoalView, NegotiationView, ReasoningView)
// subscribe via `useTauriEvent<TPayload>(BLADE_EVENTS.XXX, …)`.
//
// Every interface carries `[k: string]: unknown` per D-38-payload accepted
// drift risk. Field names mirror Rust `#[serde]` output verbatim (snake_case).
//
// @see src-tauri/src/health_tracker.rs:416,450,469
// @see src-tauri/src/health_guardian.rs:150,160,180
// @see src-tauri/src/emotional_intelligence.rs:753
// @see src-tauri/src/accountability.rs:755,777
// @see src-tauri/src/prediction_engine.rs:589
// @see src-tauri/src/habit_engine.rs:760
// @see src-tauri/src/goal_engine.rs:389,403,623,810,975
// @see src-tauri/src/negotiation_engine.rs:519
// @see src-tauri/src/reasoning_engine.rs:645,667
// ---------------------------------------------------------------------------

/** Mirrors Rust emit at `src-tauri/src/health_tracker.rs:416,450,469`
 *  (blade_health_nudge). Scheduled nudges emitted by `start_health_nudge_loop`. */
export interface BladeHealthNudgePayload {
  type: 'missing_log' | 'poor_sleep_alert' | 'low_energy_day' | string;
  message: string;
  sleep_hours?: number;
  energy?: number;
  mood?: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/health_guardian.rs:150,160,180`
 *  (health_break_reminder). Scheduled break-reminder loop. */
export interface HealthBreakReminderPayload {
  urgency: 'warning' | 'critical' | 'wind_down' | string;
  streak_minutes: number;
  message: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/emotional_intelligence.rs:753`
 *  (blade_emotion_detected). Fires only on significant valence shifts. */
export interface BladeEmotionDetectedPayload {
  emotion: string;
  valence: number;
  arousal: number;
  confidence: number;
  signals?: unknown;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/accountability.rs:755,777`
 *  (accountability_nudge). Scheduled check-in + behind-KR alerts. */
export interface AccountabilityNudgePayload {
  type: 'checkin' | 'objective_behind' | string;
  message: string;
  objective_id?: string;
  objective_title?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/prediction_engine.rs:589`
 *  (blade_prediction). High-confidence (>0.75) predictions emitted during
 *  background generation. Full Prediction struct mirror. */
export interface BladePredictionPayload {
  id: string;
  prediction_type: string; // "resource_needed" | "task_due" | "pattern_alert" | "suggestion" | "reminder"
  title: string;
  description: string;
  action?: string;
  confidence: number;
  time_window: string;     // "now" | "next_hour" | "today" | "this_week"
  was_helpful?: boolean | null;
  created_at: number;
  shown_at?: number | null;
  accepted: boolean;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/habit_engine.rs:760`
 *  (blade_habit_reminder). Scheduled habit reminder loop. */
export interface BladeHabitReminderPayload {
  id: string;
  name: string;
  category?: string;
  streak?: number;
  target_time?: string;
  cue?: string;
  reward?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/goal_engine.rs:810,975`
 *  (goal_progress). Emitted during async `goal_pursue_now` loop. */
export interface GoalProgressPayload {
  id: string;
  title: string;
  status: string;
  attempts: number;
  subtasks_done: number;
  subtasks_total: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/goal_engine.rs:389,403`
 *  (goal_subtask_update). Per-subtask streaming during pursue. */
export interface GoalSubtaskUpdatePayload {
  goal_id: string;
  subtask_description: string;
  result: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/goal_engine.rs:623`
 *  (goal_completed). Fires when pursue loop verification succeeds. */
export interface GoalCompletedPayload {
  id: string;
  title: string;
  result: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/negotiation_engine.rs:519`
 *  (blade_debate_update). Streaming per-round during async debate. Shape of
 *  `round` mirrors `DebateRound` struct at negotiation_engine.rs; left loose
 *  here per D-38-payload. */
export interface BladeDebateUpdatePayload {
  session_id: string;
  round_num: number;
  round: {
    user_argument?: string;
    opponent_argument?: string;
    blade_coaching?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/reasoning_engine.rs:645,667`
 *  (blade_reasoning_step). Streaming per-step progress during multi-step
 *  reasoning; payload shape = `StepEvent { trace_id, step: ReasoningStep }`. */
export interface BladeReasoningStepPayload {
  trace_id: string;
  step: {
    step_num: number;
    thought: string;
    confidence: number;
    step_type: string; // "decompose" | "analyze" | "hypothesize" | "verify" | "conclude"
    critiques: string[];
    revised?: string | null;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Phase 7 Plan 07-01 additions — Dev Tools + Admin lifecycle payloads.
//
// Every interface below matches a Rust emit_to("main", ...) call from either
// a streaming loop or a scheduled background task (NOT request-response).
// Phase 7 consumers subscribe via `useTauriEvent<TPayload>(BLADE_EVENTS.XXX, …)`.
//
// Every interface carries `[k: string]: unknown` per D-38-payload accepted
// drift risk. Field names mirror Rust `serde_json::json!` keys verbatim.
//
// @see src-tauri/src/browser_agent.rs:268,284
// @see src-tauri/src/immune_system.rs:31,45,78,85,97
// @see src-tauri/src/evolution.rs:792,800,812,945
// @see src-tauri/src/supervisor.rs:144,156
// @see src-tauri/src/watcher.rs:212
// ---------------------------------------------------------------------------

/** Mirrors Rust emit at `src-tauri/src/browser_agent.rs:268,284`
 *  (browser_agent_step). Streaming per-step during `browser_agent_loop`.
 *  On the final step, `done: true` and `result` carries the summary. */
export interface BrowserAgentStepPayload {
  step: number;
  action: string;
  result: string;
  screenshot_b64?: string | null;
  done: boolean;
  is_error?: boolean;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/immune_system.rs:31,45,78,85,97`
 *  (blade_evolving). Multi-step capability-resolution status ticker;
 *  `status` transitions roughly: searching → installing|forging → forged|failed. */
export interface BladeEvolvingPayload {
  capability: string;
  status: 'searching' | 'installing' | 'forging' | 'forged' | 'failed' | string;
  solution?: string;
  tool_name?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/evolution.rs:792`
 *  (blade_auto_upgraded). Scheduled evolution loop auto-install notification. */
export interface BladeAutoUpgradedPayload {
  installed: string[];
  message: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/evolution.rs:800,945`
 *  (evolution_suggestion). Scheduled evolution-loop suggestion record; full
 *  Suggestion struct mirror (shape loose per D-38-payload accepted drift). */
export interface EvolutionSuggestionPayload {
  id?: string;
  category?: string;
  title?: string;
  description?: string;
  severity?: string;
  created_at?: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/evolution.rs:812`
 *  (blade_leveled_up). Background evolution level-up milestone. */
export interface BladeLeveledUpPayload {
  level: number;
  score: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/supervisor.rs:144`
 *  (service_crashed). Background watchdog when a managed service crashes. */
export interface ServiceCrashedPayload {
  service: string;
  crash_count: number;
  error: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/supervisor.rs:156`
 *  (service_dead). Emitted after MAX_RESTARTS crashes; service permanently
 *  dead until manual restart. */
export interface ServiceDeadPayload {
  service: string;
  crash_count: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/watcher.rs:212`
 *  (watcher_alert). Background URL-watcher change detection; SecurityDashboard
 *  + Reports consume for autonomous monitoring feed. */
export interface WatcherAlertPayload {
  watcher_id: string;
  url: string;
  label: string;
  summary: string;
  timestamp: number;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Phase 8 Plan 08-01 additions — Body + Hive lifecycle payloads.
//
// Every interface below matches a Rust emit site confirmed by grep audit at
// .planning/phases/08-body-hive/08-CONTEXT.md §code_context. Field names
// mirror Rust `serde_json::json!` / struct keys verbatim (snake_case).
//
// Every interface carries `[k: string]: unknown` per D-38-payload accepted
// drift risk.
//
// @see src-tauri/src/hive.rs:2304,2509,2530,2600,2603,2686,2723,2763,2780,2813
// @see src-tauri/src/world_model.rs:869
// ---------------------------------------------------------------------------

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2600` (hive_tick).
 *  Fires every 30s on hive tick cadence; HiveMesh subscribes to refresh
 *  status indicators without full reload (D-204). */
export interface HiveTickPayload {
  running: boolean;
  last_tick: number;
  total_reports_processed: number;
  total_actions_taken: number;
  pending_decisions: number;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2723,2780` (hive_action).
 *  Fires when the hive executes an action (reply/post/create/etc.); HiveMesh
 *  + ApprovalQueue subscribe for toast + optimistic queue removal (D-204, D-205). */
export interface HiveActionPayload {
  action: string;
  platform: string;
  head_id?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2813` (hive_escalate).
 *  Fires when hive needs user decision; ApprovalQueue subscribes + surfaces
 *  a cross-window toast (D-205). */
export interface HiveEscalatePayload {
  reason: string;
  context: string;
  head_id?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2686` (hive_inform).
 *  Fires when hive surfaces informational content to the user; HiveMesh
 *  subscribes for non-blocking info toast (D-204). */
export interface HiveInformPayload {
  summary: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2603` (hive_pending_decisions).
 *  Fires when the pending-decisions count changes on any head; ApprovalQueue
 *  subscribes to refresh its queue view (D-205). */
export interface HivePendingDecisionsPayload {
  count: number;
  head_id?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2509` (hive_ci_failure).
 *  Fires on CI failure detection; HiveMesh subscribes for alert toast (D-204). */
export interface HiveCiFailurePayload {
  repo?: string;
  branch?: string;
  error?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2530` (hive_auto_fix_started).
 *  Fires when the auto-fix pipeline kicks off after a detected CI failure;
 *  HiveMesh subscribes for pipeline status toast (D-204). */
export interface HiveAutoFixStartedPayload {
  pipeline_id?: string;
  repo?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2763` (hive_action_deferred).
 *  Fires when hive defers an action (awaiting approval or downgraded autonomy);
 *  ApprovalQueue subscribes to insert deferred entries (D-205). */
export interface HiveActionDeferredPayload {
  action: string;
  platform: string;
  reason?: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/hive.rs:2304` (tentacle_error).
 *  Fires when a tentacle enters Error status; HiveMesh + TentacleDetail
 *  subscribe to update status chip + surface error context (D-204). */
export interface TentacleErrorPayload {
  tentacle_id: string;
  platform: string;
  error: string;
  [k: string]: unknown;
}

/** Mirrors Rust emit at `src-tauri/src/world_model.rs:869` (world_state_updated).
 *  Fires on background world-model refresh loop; WorldModel subscribes to
 *  pull fresh snapshot without manual refresh click (D-203). Rust emits a
 *  short summary string (world_get_summary()); payload kept generic. */
export interface WorldStateUpdatedPayload {
  summary?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Phase 17 Plan 17-05 — Doctor Module (DOCTOR-06).
//
// Emitted by `src-tauri/src/doctor.rs::emit_doctor_event` on signal-class
// severity transitions where new severity is amber or red. Same-severity and
// recovery (→ green) transitions do NOT emit per CONTEXT.md D-20.
//
// Wire form: SignalClass is `#[serde(rename_all = "snake_case")]` and
// Severity is `#[serde(rename_all = "lowercase")]` — these literal unions
// MUST match exactly. Drift detection is human code-review (D-38-payload).
//
// @see src-tauri/src/doctor.rs::doctor_run_full_check (orchestrator emit site)
// @see .planning/phases/17-doctor-module/17-CONTEXT.md §D-20 (transition rules)
// @see .planning/phases/17-doctor-module/17-CONTEXT.md §D-21 (ActivityStrip line format)
// ---------------------------------------------------------------------------

export interface DoctorEventPayload {
  class: 'eval_scores' | 'capability_gaps' | 'tentacle_health' | 'config_drift' | 'auto_update' | 'reward_trend';
  severity: 'green' | 'amber' | 'red';
  prior_severity: 'green' | 'amber' | 'red';
  last_changed_at: number;  // unix milliseconds
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Phase 18 Plan 18-04 — JARVIS Chat → Cross-App Action.
//
// Wire form: Rust side emits with `#[serde(rename_all = "snake_case")]`; field
// names below mirror that exactly. Drift detection is human code-review per
// D-38-payload (no runtime schema validation, no codegen). Phase 17
// PATTERNS.md ghost-snake_case landmine documented; Plan 17 frontend consumer
// (MessageList JarvisPill + ChatPanel ConsentDialog) imports these verbatim.
//
// @see src-tauri/src/ego.rs::emit_jarvis_intercept (Plan 18-08 emit site)
// @see src-tauri/src/jarvis_dispatch.rs::emit_consent_request (Plan 18-14 emit site)
// @see .planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md §D-18, §D-19
// ---------------------------------------------------------------------------

/** Mirrors Rust emit at `src-tauri/src/ego.rs::emit_jarvis_intercept`.
 *  Fires when ego intercepts an assistant turn (capability gap detected,
 *  retry in flight, or hard refusal). MessageList renders an inline pill
 *  (JarvisPill.tsx) until the next assistant message lands or user dismisses.
 *  Wire form: #[serde(rename_all = "snake_case")] on the Rust side. */
export interface JarvisInterceptPayload {
  intent_class: string;                                // e.g. "action_required" / "chat_only"
  action: 'intercepting' | 'installing' | 'retrying' | 'hard_refused';
  capability?: string;                                 // present for installing/retrying
  reason?: string;                                     // present for hard_refused
}

/** Mirrors Rust emit at `src-tauri/src/jarvis_dispatch::emit_consent_request`.
 *  Fires when dispatch_action determines consent is required for a (intent_class,
 *  target_service) tuple with no prior decision in `consent_decisions`. ChatPanel
 *  opens ConsentDialog showing target / action / content preview / 3 buttons.
 *  Wire form: #[serde(rename_all = "snake_case")] on the Rust side. */
export interface ConsentRequestPayload {
  intent_class: string;                                // e.g. "action_required"
  target_service: string;                              // e.g. "slack" / "linear"
  action_verb: string;                                 // human-readable, e.g. "Post message to #team"
  action_kind: string;                                 // Plan 18-14 — original verb token (e.g. "post" / "create" / "send")
  content_preview: string;                             // safe_slice'd to 200 chars Rust-side
  request_id: string;                                  // correlation id for the consent response channel
  safety_override?: boolean;                           // Phase 26 — when true, AllowAlways must NOT be offered
}

// ---------------------------------------------------------------------------
// Vitality engine (src-tauri/src/vitality_engine.rs -- Phase 29)
// ---------------------------------------------------------------------------

/** Mirrors Rust emit at `src-tauri/src/vitality_engine.rs` (blade_vitality_update).
 *  Fires on band transitions or significant scalar changes (delta > 0.05).
 *  VitalityIndicator in chat header subscribes for at-a-glance organism health.
 *  @see .planning/phases/29-vitality-engine/29-CONTEXT.md §D-22 */
export interface BladeVitalityUpdatePayload {
  scalar: number;
  band: 'Thriving' | 'Waning' | 'Declining' | 'Critical' | 'Dormant';
  trend: number;
  top_factor: string;
}

/** Mirrors Rust emit at `src-tauri/src/vitality_engine.rs` (blade_dormancy).
 *  Fires when vitality reaches 0.0 and dormancy sequence initiates.
 *  @see .planning/phases/29-vitality-engine/29-CONTEXT.md §D-17 */
export interface BladeDormancyPayload {
  reincarnation_count: number;
  top_drain_factors: string[];
  total_uptime_secs: number;
  vitality_at_dormancy: number;
}

/** Mirrors Rust emit at `src-tauri/src/vitality_engine.rs` (blade_reincarnation).
 *  Fires on next launch after dormancy when reincarnation path completes.
 *  Chat injects system message per D-23: "BLADE has reincarnated."
 *  @see .planning/phases/29-vitality-engine/29-CONTEXT.md §D-18, §D-23 */
export interface BladeReincarnationPayload {
  reincarnation_count: number;
  vitality_start: number;  // always 0.3
  memories_intact: boolean;
}

// ---------------------------------------------------------------------------
// Phase 33 — Agentic Loop events (LOOP-01..06)
// ---------------------------------------------------------------------------

/** Phase 33 / LOOP-01..06 + Phase 34 / RES-01..05 + SESS-01..04 — agentic
 *  loop + resilience lifecycle events.
 *
 *  Discriminated union over `kind`. ActivityStrip subscribes via the
 *  existing useActivityLog hook and renders chips with short labels:
 *  "verifying" | "replanning" | "token bump" | "halted: cost cap" |
 *  "halted: iteration cap" | "stuck: <pattern>" |
 *  "circuit open: <error_kind>" | "cost 80% ($X / $Y)".
 *  cost_update does NOT render a chip — consumed by cost-meter widget only
 *  (ChatComposer / InputBar live tick subscription, Plan 34-11).
 *
 *  Most-recent-only display per CONTEXT lock §ActivityStrip; no new timer
 *  system — entries flow through the same activity-log ring buffer that
 *  blade_status / blade_notification use.
 *
 *  See `src-tauri/src/loop_engine.rs` + `src-tauri/src/resilience/*` +
 *  `src-tauri/src/session/log.rs` for the emit sites:
 *    Phase 33:
 *      - verification_fired   — verify_progress() result (Plan 33-04)
 *      - replanning           — third-same-tool reject_plan trigger (Plan 33-05)
 *      - token_escalated      — max_tokens doubled retry fires (Plan 33-06)
 *      - halted               — loop exits on cost cap or iteration cap (Plan 33-08)
 *    Phase 34:
 *      - stuck_detected       — RES-01 5-pattern detect_stuck (Plan 34-04)
 *      - circuit_open         — RES-02 N-consecutive-same-kind failures (Plan 34-05)
 *      - cost_warning         — RES-04 80% threshold latch (Plan 34-06)
 *      - cost_update          — RES-03 live cost-meter tick (Plan 34-06; every iter)
 *  Plan 34-06 also mutates `halted` to optionally carry
 *  `scope: 'PerLoop' | 'PerConversation'` (per-conversation cap is a new
 *  halt scope distinct from Phase 33-08's per-loop cap).
 *
 *  @see .planning/phases/33-agentic-loop/33-CONTEXT.md §ActivityStrip Integration
 *  @see .planning/phases/34-resilience-session/34-CONTEXT.md §ActivityStrip Integration
 */
export type BladeLoopEventPayload =
  | { kind: 'verification_fired'; verdict: 'YES' | 'NO' | 'REPLAN' }
  | { kind: 'replanning'; count: number }
  | { kind: 'token_escalated'; new_max: number }
  | {
      kind: 'halted';
      reason: 'cost_exceeded' | 'iteration_cap';
      spent_usd?: number;
      cap_usd?: number;
      // Plan 34-06 (RES-04) — distinguishes per-loop vs per-conversation halt
      scope?: 'PerLoop' | 'PerConversation';
    }
  // ───── Phase 34 additions ─────
  | {
      kind: 'stuck_detected';
      pattern:
        | 'RepeatedActionObservation'
        | 'MonologueSpiral'
        | 'ContextWindowThrashing'
        | 'NoProgress'
        | 'CostRunaway';
    }
  | { kind: 'circuit_open'; error_kind: string; attempts: number }
  | { kind: 'cost_warning'; percent: 80; spent_usd: number; cap_usd: number }
  | { kind: 'cost_update'; spent_usd: number; cap_usd: number; percent: number };

