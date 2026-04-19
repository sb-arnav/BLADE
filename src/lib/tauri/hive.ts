// src/lib/tauri/hive.ts
//
// Typed wrappers for the Hive Mesh cluster — one per registered Rust
// #[tauri::command] across hive.rs (8 commands) + ai_delegate.rs (2 commands)
// = 10 total (D-196 inventory).
//
// D-193: per-cluster wrapper module lives HERE (hive cluster only).
// D-195: per-tentacle command wrappers are NOT duplicated here — the 10
//        tentacles are Rust-internal organs; per-tentacle autonomy is read
//        via organ_get_autonomy / organ_set_autonomy in body.ts (cross-
//        cluster import — see 08-PATTERNS.md §6).
// D-196: zero Rust expansion in Phase 8 — every command below is already
//        registered in src-tauri/src/lib.rs generate_handler!.
// D-206: @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-38:  camelCase JS API, snake_case at the invoke boundary.
//        Return types mirror Rust #[derive(Serialize)] shape verbatim.
//
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-193..D-210
// @see .planning/phases/08-body-hive/08-PATTERNS.md §1
// @see src-tauri/src/lib.rs:1284-1338, 656-657 generate_handler!

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Enum types — Rust-side Serialize-as-string enums, mirrored as TS unions.
// @see src-tauri/src/hive.rs:46..70 (TentacleStatus, Priority enums)
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/hive.rs:46 TentacleStatus */
export type TentacleStatus = 'Active' | 'Dormant' | 'Error' | 'Disconnected';

/** @see src-tauri/src/hive.rs:56 Priority */
export type Priority = 'Critical' | 'High' | 'Normal' | 'Low';

// ═══════════════════════════════════════════════════════════════════════════
// Decision tagged union — matches #[serde(tag = "type", content = "data")]
// @see src-tauri/src/hive.rs (Decision enum, 4 variants)
// ═══════════════════════════════════════════════════════════════════════════

export type Decision =
  | {
      type: 'Reply';
      data: { platform: string; to: string; draft: string; confidence: number };
    }
  | {
      type: 'Escalate';
      data: { reason: string; context: string };
    }
  | {
      type: 'Act';
      data: { action: string; platform: string; reversible: boolean };
    }
  | {
      type: 'Inform';
      data: { summary: string };
    };

// ═══════════════════════════════════════════════════════════════════════════
// Supporting interfaces — mirror Rust struct shapes verbatim.
// Every interface carries [k: string]: unknown for forward-compat (D-207).
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/hive.rs:76 TentacleReport */
export interface TentacleReport {
  id: string;
  tentacle_id: string;
  timestamp: number;
  priority: Priority;
  /** "message" | "mention" | "alert" | "update" | "action_needed" */
  category: string;
  summary: string;
  /** Full platform-specific payload (serde_json::Value) */
  details: unknown;
  requires_action: boolean;
  suggested_action: string | null;
  processed: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/hive.rs:266 TentacleSummary */
export interface TentacleSummary {
  id: string;
  platform: string;
  status: TentacleStatus;
  head: string;
  last_heartbeat: number;
  messages_processed: number;
  actions_taken: number;
  pending_report_count: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/hive.rs:250 HiveStatus */
export interface HiveStatus {
  running: boolean;
  tentacle_count: number;
  active_tentacles: number;
  head_count: number;
  pending_decisions: number;
  pending_reports: number;
  last_tick: number;
  total_reports_processed: number;
  total_actions_taken: number;
  autonomy: number;
  tentacles: TentacleSummary[];
  recent_decisions: Decision[];
  [k: string]: unknown;
}

/**
 * @see src-tauri/src/ai_delegate.rs:177 ai_delegate_check return shape.
 * The Rust command returns serde_json::Value with name/available/reasoning.
 */
export interface AiDelegateInfo {
  name: string;
  available: boolean;
  reasoning?: string;
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hive wrappers (8 commands) — hive.rs
// Arg keys in invokeTyped payload MUST be snake_case (D-38).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/hive.rs:3296
 *   `pub async fn hive_start(app: AppHandle) -> Result<HiveStatus, String>`
 *
 * Starts the hive tick loop + spawns any configured tentacles. Idempotent —
 * second call while running returns the current status.
 */
export function hiveStart(): Promise<HiveStatus> {
  return invokeTyped<HiveStatus>('hive_start');
}

/**
 * @see src-tauri/src/hive.rs:3305
 *   `pub async fn hive_stop() -> Result<(), String>`
 *
 * Stops the hive tick loop + halts every tentacle.
 */
export function hiveStop(): Promise<void> {
  return invokeTyped<void>('hive_stop');
}

/**
 * @see src-tauri/src/hive.rs:3311
 *   `pub fn hive_get_status() -> HiveStatus`
 *
 * Snapshot of every tentacle + head + pending decision + tick stat.
 * HiveMesh renders from this; ApprovalQueue reads recent_decisions.
 */
export function hiveGetStatus(): Promise<HiveStatus> {
  return invokeTyped<HiveStatus>('hive_get_status');
}

/**
 * @see src-tauri/src/hive.rs:3252
 *   `pub fn hive_get_digest() -> String`
 *
 * Brain-style digest of recent hive activity — suitable for the system prompt
 * or a human-facing daily summary.
 */
export function hiveGetDigest(): Promise<string> {
  return invokeTyped<string>('hive_get_digest');
}

/**
 * @see src-tauri/src/hive.rs:3316
 *   `pub async fn hive_spawn_tentacle(platform: String, config: serde_json::Value) -> Result<(), String>`
 *
 * Spawns a new tentacle bound to `platform` with the given config payload.
 * Dialog-gate at the call site (D-205 destructive-op discipline — this boots
 * a new background task that may hit external APIs).
 */
export function hiveSpawnTentacle(args: {
  platform: string;
  config: unknown;
}): Promise<void> {
  return invokeTyped<void, { platform: string; config: unknown }>(
    'hive_spawn_tentacle',
    { platform: args.platform, config: args.config },
  );
}

/**
 * @see src-tauri/src/hive.rs:3324
 *   `pub fn hive_get_reports() -> Vec<TentacleReport>`
 *
 * Full (non-processed) report feed across every tentacle. TentacleDetail
 * filters this by tentacle_id.
 */
export function hiveGetReports(): Promise<TentacleReport[]> {
  return invokeTyped<TentacleReport[]>('hive_get_reports');
}

/**
 * @see src-tauri/src/hive.rs:3329
 *   `pub fn hive_approve_decision(head_id: String, decision_index: usize) -> Result<(), String>`
 *
 * Approves a pending decision at the given index within a head's queue.
 * ApprovalQueue "Approve" button calls this.
 */
export function hiveApproveDecision(args: {
  headId: string;
  decisionIndex: number;
}): Promise<void> {
  return invokeTyped<void, { head_id: string; decision_index: number }>(
    'hive_approve_decision',
    { head_id: args.headId, decision_index: args.decisionIndex },
  );
}

/**
 * @see src-tauri/src/hive.rs:3337
 *   `pub fn hive_set_autonomy(level: f32) -> Result<(), String>`
 *
 * Sets the global hive autonomy (0.0-1.0). Dialog-gate at the call site for
 * level >= 0.7 (D-204 — higher autonomy = hive acts without asking first).
 */
export function hiveSetAutonomy(args: { level: number }): Promise<void> {
  return invokeTyped<void, { level: number }>('hive_set_autonomy', {
    level: args.level,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AI Delegate wrappers (2 commands) — ai_delegate.rs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/ai_delegate.rs:167
 *   `pub async fn ai_delegate_introduce() -> Result<String, String>`
 *
 * Sends a canonical introduction prompt to the configured delegate (Claude
 * Code CLI, Aider, Goose, etc.) and returns the response text. Takes 10-30s
 * on Claude Code CLI — surface in UI with a spinner + toast.
 */
export function aiDelegateIntroduce(): Promise<string> {
  return invokeTyped<string>('ai_delegate_introduce');
}

/**
 * @see src-tauri/src/ai_delegate.rs:177
 *   `pub fn ai_delegate_check() -> serde_json::Value`
 *
 * Returns the configured delegate descriptor — name + available + optional
 * reasoning. AiDelegate route hero reads from this.
 */
export function aiDelegateCheck(): Promise<AiDelegateInfo> {
  return invokeTyped<AiDelegateInfo>('ai_delegate_check');
}
