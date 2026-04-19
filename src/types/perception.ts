// src/types/perception.ts — DTO for src-tauri/src/perception_fusion.rs PerceptionState.
// Field names + types match the Rust struct exactly so JSON round-trips serde-clean.
// Snake_case fields per D-38 (no key transformation across the IPC boundary).
//
// @see src-tauri/src/perception_fusion.rs:18  (pub struct PerceptionState)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-74
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-38

export interface PerceptionState {
  /** ms-since-epoch (Rust i64). 0 = never set. */
  timestamp: number;
  active_app: string;
  active_title: string;
  screen_ocr_text: string;
  visible_errors: string[];
  /** e.g. ["coding", "rust", "debugging"] */
  context_tags: string[];
  /** "error" | "url" | "code" | "command" | "text" */
  clipboard_type: string;
  clipboard_preview: string;
  /** Human-readable change summary since last tick. */
  delta_summary: string;
  /** Rust f64. */
  disk_free_gb: number;
  /** Rust f64. */
  ram_used_gb: number;
  top_cpu_process: string;
  /** "focused" | "idle" | "away" */
  user_state: string;
}
