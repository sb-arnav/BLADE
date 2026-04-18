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

export interface DeepScanProgressPayload {
  step: number;
  total: number;
  label: string;
  percent: number;
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
