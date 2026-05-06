// src/lib/tauri/sessions.ts
//
// Phase 34 / Plan 34-11 — typed Tauri wrappers for the 4 session-persistence
// commands added in Plan 34-10:
//   - list_sessions          (SESS-03)
//   - resume_session         (SESS-02)
//   - fork_session           (SESS-04)
//   - get_conversation_cost  (RES-03)
//
// All wrappers route through `invokeTyped` per D-13 / D-34 (the only permitted
// invoke surface, enforced by eslint-rules/no-raw-tauri.js). Arg keys may use
// either snake_case or camelCase here — `_base.ts::toCamelArgs` normalises
// outgoing keys to camelCase before calling the underlying tauri invoke (the
// Rust side accepts both because Tauri 2 generates camelCase aliases via the
// #[tauri::command] macro). Keeping camelCase below mirrors the precedent set
// in chat.ts / config.ts for new wrappers added post-Mac-smoke (D-38 revised).
//
// @see src-tauri/src/session/list.rs (4 #[tauri::command] handlers)
// @see src-tauri/src/session/resume.rs (ResumedConversation type — IPC shape)
// @see .planning/phases/34-resilience-session/34-CONTEXT.md §SESS-03 / §RES-03

import { invokeTyped } from './_base';

/**
 * Mirrors `src-tauri/src/session/list.rs::SessionMeta`.
 *
 * `parent` is populated for forked sessions (SESS-04). `halt_reason` carries
 * the discriminant of the most-recent `HaltReason` event (`Stuck`,
 * `CostExceeded`, `IterationCap`, `CircuitOpen`, …) when the session ended
 * with a halt — `null` for naturally-completed sessions.
 */
export interface SessionMeta {
  id: string;
  started_at_ms: number;
  /** Count of UserMessage + AssistantTurn events in the JSONL. */
  message_count: number;
  /** safe_slice(first_user_message_content, 120). */
  first_message_excerpt: string;
  /** Sum of (tokens_in + tokens_out) across AssistantTurn events. */
  approximate_tokens: number;
  /** Reason from most-recent HaltReason event, or null. */
  halt_reason: string | null;
  /** Populated for forked sessions (SESS-04). */
  parent: string | null;
}

/**
 * Mirrors `src-tauri/src/session/resume.rs::ResumedConversation`.
 *
 * `messages` is `Vec<serde_json::Value>` on the Rust side (the IPC type was
 * frozen in Plan 34-03 so Wave 2-5 plans don't need to change the struct);
 * the elements are plain `{role, content}` objects matching the canonical
 * shape used by every Tauri stream emit site in commands.rs (L1235, L1681,
 * L2904). Typed as `unknown[]` here so the consumer can narrow with the
 * existing chat-history typings (`ChatMessage`).
 */
export interface ResumedConversation {
  session_id: string;
  messages: unknown[];
  last_compaction_boundary_at: number | null;
}

/**
 * Mirrors `src-tauri/src/session/list.rs::get_conversation_cost` return shape
 * (`serde_json::json!({spent_usd, cap_usd, percent})`).
 *
 * `percent` is computed Rust-side as `(100.0 * spent / cap) as u32` — saturates
 * at u32::MAX in pathological cases (cap < 0.0001) but in practice 0..=100+
 * with values >100 valid (the per-conversation halt fires on overage so a
 * cost-meter chip at 100% means the session is already halted).
 */
export interface ConversationCost {
  spent_usd: number;
  cap_usd: number;
  percent: number;
}

/**
 * SESS-03 — list past sessions sorted desc by `started_at_ms`. Walks
 * `BladeConfig.session.jsonl_log_dir`, parses each `*.jsonl`'s metadata, skips
 * corrupted files silently. Returns an empty Vec when the dir doesn't exist
 * (fresh install) or when JSONL logging is disabled and no historical files
 * remain.
 *
 * @see src-tauri/src/session/list.rs `pub async fn list_sessions() -> Result<Vec<SessionMeta>, String>`
 */
export function listSessions(): Promise<SessionMeta[]> {
  return invokeTyped<SessionMeta[]>('list_sessions');
}

/**
 * SESS-02 — resume a past session. Validates `session_id` (Crockford-base32
 * 26-char ULID; rejects path traversal etc.), reads
 * `{jsonl_log_dir}/{session_id}.jsonl`, replays events into messages halting
 * at the most-recent `CompactionBoundary`. Returns Err when JSONL logging
 * is disabled (nothing to resume from).
 *
 * @see src-tauri/src/session/list.rs `pub async fn resume_session(session_id: String) -> Result<ResumedConversation, String>`
 */
export function resumeSession(sessionId: string): Promise<ResumedConversation> {
  return invokeTyped<ResumedConversation, { session_id: string }>(
    'resume_session',
    { session_id: sessionId },
  );
}

/**
 * SESS-04 — fork a session at a chosen message index. The new session has
 * `parent` populated and inherits the first N UserMessage + AssistantTurn
 * events of the parent (CompactionBoundary, ToolCall, HaltReason, LoopEvent
 * pass through unconditionally so forensic continuity is preserved up to the
 * cut point). Shallow — child cannot itself be forked (one-level deep only;
 * v1.6+ may relax this).
 *
 * `forkAtMessageIndex` is CLAMPED to actual message count Rust-side; the
 * SessionMeta records the *clamped* value so the user sees the truth.
 * Returns the new session's ULID.
 *
 * @see src-tauri/src/session/list.rs `pub async fn fork_session(parent_id: String, fork_at_message_index: u32) -> Result<String, String>`
 */
export function forkSession(parentId: string, forkAtMessageIndex: number): Promise<string> {
  return invokeTyped<string, { parent_id: string; fork_at_message_index: number }>(
    'fork_session',
    { parent_id: parentId, fork_at_message_index: forkAtMessageIndex },
  );
}

/**
 * RES-03 — read current per-conversation spend. Used by the chat-input
 * cost-meter chip on session load (one-shot poll); live ticks come via
 * `blade_loop_event { kind: 'cost_update' }`. When the JSONL file has no
 * `cost_update` LoopEvent yet (brand-new session), returns `spent_usd = 0`.
 *
 * @see src-tauri/src/session/list.rs `pub async fn get_conversation_cost(session_id: String) -> Result<serde_json::Value, String>`
 */
export function getConversationCost(sessionId: string): Promise<ConversationCost> {
  return invokeTyped<ConversationCost, { session_id: string }>(
    'get_conversation_cost',
    { session_id: sessionId },
  );
}

/**
 * Mirrors `src-tauri/src/session/list.rs::MergeResult` (Plan 35-08, DECOMP-04).
 *
 * The Rust struct is:
 *   pub struct MergeResult {
 *       pub fork_id: String,
 *       pub parent_id: String,
 *       pub summary_text: String,
 *   }
 *
 * `summary_text` is the full distilled fork summary — the LoopEvent
 * `fork_merged` payload carries a safe_slice'd excerpt for the activity strip,
 * but the IPC return shape carries the full summary so the UI can show it
 * in a confirmation toast / SessionsView merge-result panel without a
 * second fetch.
 */
export interface MergeResult {
  fork_id: string;
  parent_id: string;
  summary_text: string;
}

/**
 * DECOMP-04 (Plan 35-08) — fold a fork's summary back into its parent
 * session. Validates `fork_id` (Crockford-base32 26-char ULID; rejects
 * path traversal etc.), confirms the JSONL records `parent` (i.e. the
 * session is actually a fork), distills the fork's transcript via the
 * cheap-model summary path, appends a synthetic
 * `[Branch merged from fork {id[..8]}…] {summary}` UserMessage to the
 * parent JSONL, and writes a `LoopEvent { kind: "fork_merged", … }` row
 * for forensic continuity.
 *
 * EXPLICIT user action only — no auto-merge. The SessionsView "Merge
 * back" button (Plan 35-10) is the sole call site.
 *
 * @see src-tauri/src/session/list.rs `pub async fn merge_fork_back(fork_id: String) -> Result<MergeResult, String>`
 */
export function mergeForkBack(forkId: string): Promise<MergeResult> {
  return invokeTyped<MergeResult, { fork_id: string }>(
    'merge_fork_back',
    { fork_id: forkId },
  );
}
