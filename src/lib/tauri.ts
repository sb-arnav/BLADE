/**
 * Typed Tauri invoke/listen wrappers — one place to verify every call against
 * the Rust surface in src-tauri/src/. Every function here maps to a verified
 * #[tauri::command] or app.emit() target.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BladeConfig,
  ChatMessage,
  ChatRoutingPayload,
  ChatAckPayload,
} from "../types/blade";

/* ── Config ──────────────────────────────────────────────────────────────── */

/** src-tauri/src/commands.rs:1899  fn get_config() -> BladeConfig  (api_key redacted) */
export const getConfig = () => invoke<BladeConfig>("get_config");

/* ── Onboarding ──────────────────────────────────────────────────────────── */

/** src-tauri/src/commands.rs:2312  fn get_onboarding_status() -> bool */
export const getOnboardingStatus = () => invoke<boolean>("get_onboarding_status");

/** src-tauri/src/commands.rs:2325  fn complete_onboarding(answers: Vec<String>) */
export const completeOnboarding = (answers: string[]) =>
  invoke<void>("complete_onboarding", { answers });

/* ── Chat streaming ──────────────────────────────────────────────────────── */

/**
 * src-tauri/src/commands.rs:557  fn send_message_stream(messages: Vec<ChatMessage>)
 * Streams tokens via "chat_token" events; completes with "chat_done" or "chat_cancelled".
 * Returns when the stream terminates; errors from the backend come back as rejected promise.
 */
export const sendMessageStream = (messages: ChatMessage[]) =>
  invoke<void>("send_message_stream", { messages });

/** src-tauri/src/commands.rs:71  fn cancel_chat() */
export const cancelChat = () => invoke<void>("cancel_chat");

/* ── Event helpers — wrappers that narrow payload types ──────────────────── */

/** Single string-token chunk from the LLM stream. */
export const onChatToken = (cb: (token: string) => void): Promise<UnlistenFn> =>
  listen<string>("chat_token", (e: Event<string>) => cb(e.payload));

/** Thinking-stream chunk (Anthropic extended thinking only). */
export const onChatThinking = (cb: (chunk: string) => void): Promise<UnlistenFn> =>
  listen<string>("chat_thinking", (e) => cb(e.payload));

export const onChatThinkingDone = (cb: () => void): Promise<UnlistenFn> =>
  listen<unknown>("chat_thinking_done", () => cb());

export const onChatDone = (cb: () => void): Promise<UnlistenFn> =>
  listen<unknown>("chat_done", () => cb());

export const onChatCancelled = (cb: () => void): Promise<UnlistenFn> =>
  listen<unknown>("chat_cancelled", () => cb());

/** Fast-ack before the LLM even starts — shape TBD by backend. */
export const onChatAck = (cb: (payload: ChatAckPayload) => void): Promise<UnlistenFn> =>
  listen<ChatAckPayload>("chat_ack", (e) => cb(e.payload));

/** Emitted after task routing picks provider + model for this request. */
export const onChatRouting = (cb: (payload: ChatRoutingPayload) => void): Promise<UnlistenFn> =>
  listen<ChatRoutingPayload>("chat_routing", (e) => cb(e.payload));

/** Global lifecycle: "processing" | "idle" | "error" */
export const onBladeStatus = (cb: (status: string) => void): Promise<UnlistenFn> =>
  listen<string>("blade_status", (e) => cb(e.payload));
