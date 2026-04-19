// src/types/history.ts — DTOs for src-tauri/src/history.rs (re-exported via
// src-tauri/src/commands.rs history_* commands).
//
// All fields are concrete (no permissive index signature) — Rust struct shape
// is fully known and stable per D-38. timestamps are Rust u64 (ms-since-epoch).
//
// @see src-tauri/src/history.rs:7   (pub struct HistoryMessage)
// @see src-tauri/src/history.rs:15  (pub struct ConversationSummary)
// @see src-tauri/src/history.rs:24  (pub struct StoredConversation)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-88

export interface HistoryMessage {
  id: string;
  /** Author role: typically "user" | "assistant" | "system" | "tool". */
  role: string;
  content: string;
  /** ms-since-epoch (Rust u64). */
  timestamp: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  /** ms-since-epoch (Rust u64). */
  created_at: number;
  /** ms-since-epoch (Rust u64). */
  updated_at: number;
  /** Rust usize. */
  message_count: number;
}

export interface StoredConversation {
  id: string;
  title: string;
  /** ms-since-epoch (Rust u64). */
  created_at: number;
  /** ms-since-epoch (Rust u64). */
  updated_at: number;
  messages: HistoryMessage[];
}
