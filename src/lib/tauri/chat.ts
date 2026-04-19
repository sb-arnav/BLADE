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
import type { ConversationSummary, StoredConversation } from '@/types/history';

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

// ---------------------------------------------------------------------------
// Phase 3 additions — tool approval, history surface, quickask bridge.
// All snake_case at the IPC boundary (D-38, P-04 prevention). Names verified
// against src-tauri/src/lib.rs:451, 482-488 (registered handlers).
// ---------------------------------------------------------------------------

/**
 * @see src-tauri/src/commands.rs:2226
 *   `pub async fn respond_tool_approval(approvals: State<ApprovalMap>, approval_id: String, approved: bool) -> Result<(), String>`
 *
 * Resolves a pending tool-approval request. The `approval_id` comes verbatim
 * from the `tool_approval_needed` event payload's `request_id` field. Throws
 * "No pending approval: {id}" if the id is unknown (D-71 dialog should only
 * fire from a live event, so this is defensive).
 */
export function respondToolApproval(args: { approvalId: string; approved: boolean }): Promise<void> {
  return invokeTyped<void, { approval_id: string; approved: boolean }>(
    'respond_tool_approval',
    { approval_id: args.approvalId, approved: args.approved },
  );
}

/**
 * @see src-tauri/src/commands.rs:2248
 *   `pub fn history_list_conversations() -> Result<Vec<ConversationSummary>, String>`
 *
 * Returns ALL conversations on disk (no pagination — D-88 Privacy pane
 * iterates the full list to drive the "Clear conversation history" button).
 */
export function historyListConversations(): Promise<ConversationSummary[]> {
  return invokeTyped<ConversationSummary[]>('history_list_conversations');
}

/**
 * @see src-tauri/src/commands.rs:2253
 *   `pub fn history_load_conversation(conversation_id: String) -> Result<StoredConversation, String>`
 */
export function historyLoadConversation(conversationId: string): Promise<StoredConversation> {
  return invokeTyped<StoredConversation, { conversation_id: string }>(
    'history_load_conversation',
    { conversation_id: conversationId },
  );
}

/**
 * @see src-tauri/src/commands.rs:2243
 *   `pub fn history_delete_conversation(conversation_id: String) -> Result<(), String>`
 */
export function historyDeleteConversation(conversationId: string): Promise<void> {
  return invokeTyped<void, { conversation_id: string }>(
    'history_delete_conversation',
    { conversation_id: conversationId },
  );
}

/**
 * @see src-tauri/src/commands.rs:2561 (Plan 03-01)
 *   `pub async fn quickask_submit(app, query: String, mode: String, source_window: String) -> Result<(), String>`
 *
 * Phase 3 stub — Rust emits `blade_quickask_bridged` to the main window with
 * the query echoed back (response empty). Phase 4 fills the provider call +
 * history persistence. See RECOVERY_LOG.md §1.1 for the bridge contract.
 */
export function quickaskSubmit(args: {
  query: string;
  mode: 'text' | 'voice';
  sourceWindow: string;
}): Promise<void> {
  return invokeTyped<void, { query: string; mode: string; source_window: string }>(
    'quickask_submit',
    { query: args.query, mode: args.mode, source_window: args.sourceWindow },
  );
}
