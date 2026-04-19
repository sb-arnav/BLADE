// src/types/routing.ts — DTO for src-tauri/src/config.rs TaskRouting.
//
// Each Rust field is `Option<String>` — becomes `string | null` on the wire
// (serde JSON renders `None` as `null`). Snake_case fields per D-38.
//
// @see src-tauri/src/config.rs:17  (pub struct TaskRouting)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-83

export interface TaskRouting {
  /** Provider for code tasks (code gen, debugging, refactoring). */
  code: string | null;
  /** Provider for vision tasks (screenshots, images). */
  vision: string | null;
  /** Provider for fast/simple tasks (one-liner answers, classification). */
  fast: string | null;
  /** Provider for creative tasks (writing, brainstorming). */
  creative: string | null;
  /** Fallback provider when the primary fails (rate limit, outage, quota). */
  fallback: string | null;
}
