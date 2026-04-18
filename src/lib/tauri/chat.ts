// src/lib/tauri/chat.ts
//
// Wrappers for src-tauri/src/commands.rs chat pipeline commands.
// All arg keys are snake_case verbatim (D-38, P-04 prevention).
//
// Scope: Phase 1 ships the 2 wrappers needed by the Plan 09 wrapper-smoke
// harness. Later phases extend this file as additional chat-related Rust
// commands are wrapped (regenerate_response, edit_user_message, etc.).
//
// Streaming tokens arrive via `chat_token` / `chat_done` / `chat_thinking` /
// `blade_status` events — wired in Plan 06 (events.ts).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36, §D-38
// @see .planning/research/PITFALLS.md §P-04

import { invokeTyped } from './_base';
import type { ChatMessage } from '@/types/messages';

/**
 * @see src-tauri/src/commands.rs:558
 *   `pub async fn send_message_stream(app, state, approvals, vector_store, messages: Vec<ChatMessage>) -> Result<(), String>`
 *
 * Note: Rust accepts additional state params via #[tauri::command] injection —
 * TypeScript side only passes `messages`. Streaming tokens arrive via
 * `chat_token` / `chat_done` / `chat_thinking` / `blade_status` events
 * (wired in Plan 06).
 */
export function sendMessageStream(messages: ChatMessage[]): Promise<void> {
  return invokeTyped<void, { messages: ChatMessage[] }>('send_message_stream', { messages });
}

/** @see src-tauri/src/commands.rs:71 `pub fn cancel_chat(app: tauri::AppHandle)` */
export function cancelChat(): Promise<void> {
  return invokeTyped<void>('cancel_chat');
}
