// src/types/config.ts
//
// Mirrors src-tauri/src/config.rs `BladeConfig` struct.
//
// NOTE: The Rust struct has 30+ fields; Phase 1 declares only the subset that
// downstream wrappers + components consume. Later phases EXTEND this interface
// as they wrap new Rust endpoints. The index signature at the bottom keeps the
// type permissive for raw pass-through of fields not yet explicitly modeled.
//
// Field names are snake_case — matching the Rust struct verbatim (D-38, P-04
// prevention). Never transform keys between TS and Rust.
//
// @see src-tauri/src/config.rs:225  (pub struct BladeConfig)
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-38

export interface BladeConfig {
  /** Active provider identifier (e.g. "anthropic", "openai", "gemini", "groq",
   *  "openrouter", "ollama"). @see src-tauri/src/config.rs:226 */
  provider: string;

  /** Active model identifier for the selected provider.
   *  @see src-tauri/src/config.rs:228 */
  model: string;

  /** True once the user has completed initial setup.
   *  @see src-tauri/src/config.rs:229 */
  onboarded: boolean;

  /** True once the persona/onboarding flow (Phase 2) has captured identity.
   *  @see src-tauri/src/config.rs:285 */
  persona_onboarding_complete: boolean;

  /** Unix timestamp (seconds) of the last completed deep scan. 0 = never.
   *  @see src-tauri/src/config.rs:298 */
  last_deep_scan: number;

  /** God-mode tier: "normal" | "intermediate" | "extreme".
   *  @see src-tauri/src/config.rs:249 */
  god_mode_tier: string;

  /** Voice mode: "off" | "push_to_talk" | "conversational" | etc.
   *  @see src-tauri/src/config.rs:251 */
  voice_mode: string;

  /** Selected TTS voice identifier (e.g. "system", "alloy").
   *  @see src-tauri/src/config.rs:255 */
  tts_voice: string;

  /** Whether always-on wake-word detection is enabled.
   *  @see src-tauri/src/config.rs:267 */
  wake_word_enabled: boolean;

  /** Catch-all for Rust fields not yet explicitly modeled here. Later phases
   *  replace `unknown` entries with concrete typed fields as wrappers land. */
  [k: string]: unknown;
}
