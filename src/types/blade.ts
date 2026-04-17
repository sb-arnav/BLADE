/**
 * Types mirroring Rust structs in src-tauri/src/. Hand-maintained — if the Rust
 * struct changes, update here. We intentionally keep these narrow: only the
 * fields the frontend actually reads.
 *
 * Rust snake_case field names stay on the wire (serde default). Do NOT rename
 * to camelCase unless the Rust side has #[serde(rename_all = "camelCase")].
 */

/** providers/mod.rs:114  struct ChatMessage */
export type ChatRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** serde optional; omit when absent (do not send null). */
  image_base64?: string;
}

/** config.rs:225  struct BladeConfig — trimmed to the subset the frontend reads. */
export interface BladeConfig {
  provider: string;
  /** Redacted server-side to "••••••••" by commands.rs::get_config. */
  api_key: string;
  model: string;
  onboarded: boolean;
  token_efficient: boolean;

  user_name: string;
  work_mode: string;
  response_style: string;
  blade_email: string;

  god_mode: boolean;
  god_mode_tier: string;

  voice_mode: string;
  tts_voice: string;

  quick_ask_shortcut: string;
  voice_shortcut: string;

  screen_timeline_enabled: boolean;
  timeline_capture_interval: number;
  timeline_retention_days: number;

  wake_word_enabled: boolean;
  wake_word_phrase: string;
  wake_word_sensitivity: number;

  active_role: string;
  blade_source_path: string;
  obsidian_vault_path: string;
  base_url: string | null;
}

/* ── Event payloads ──────────────────────────────────────────────────────── */

/** commands.rs:640  app.emit("chat_routing", { provider, model, hive_active }) */
export interface ChatRoutingPayload {
  provider: string;
  model: string;
  hive_active: boolean;
}

/** commands.rs:681  app.emit("chat_ack", ack) — shape is a pre-LLM ack object.
 *  Kept loose until we grep the exact shape; narrow once wired. */
export type ChatAckPayload = unknown;

/** Union of the high-level lifecycle states. */
export type BladeStatus = "processing" | "idle" | "error";
