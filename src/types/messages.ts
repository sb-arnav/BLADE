// src/types/messages.ts
//
// Mirrors src-tauri/src/providers/mod.rs:114 `ChatMessage` struct.
//
// The Rust struct is minimal (3 fields) — it is the canonical on-the-wire
// payload shape for both user-origin and assistant-origin chat turns. Tool
// calls, names, and structured content parts live on separate Rust enums
// (ConversationMessage) and are not shipped across the Tauri bridge in this
// form; when they cross, later phases will add optional fields here.
//
// Field names are snake_case — matching the Rust struct verbatim (D-38).
//
// @see src-tauri/src/providers/mod.rs:113  (pub struct ChatMessage)

export interface ChatMessage {
  /** Message author. Rust uses `String`; TypeScript narrows to the 4 known
   *  values. If a future Rust path emits a new role, the wrapper will need to
   *  widen this union rather than silently coerce. */
  role: 'user' | 'assistant' | 'system' | 'tool';

  /** Text content of the message. Always present; empty string is valid. */
  content: string;

  /** Base64-encoded image payload for vision-capable models. Absent for
   *  text-only turns. @see src-tauri/src/providers/mod.rs:117 */
  image_base64?: string;
}
