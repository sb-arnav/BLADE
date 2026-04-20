// src/types/provider.ts — Phase 2 provider-related DTOs.
//
// Kept separate from src/types/config.ts (BladeConfig lives there) so onboarding
// doesn't pull the full config surface just to type a provider id. The
// ProviderId literal union is the canonical id set; PROVIDERS registry in
// src/features/onboarding/providers.ts re-uses it.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-50
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §11

/**
 * Canonical provider identifier literal union. Mirrors the 6 providers Rust
 * knows about (src-tauri/src/config.rs:606) — adding a new provider means
 * editing both this union and the Rust array.
 */
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'gemini'
  | 'groq'
  | 'ollama';

/** @see src-tauri/src/config.rs:605 `get_all_provider_keys() -> serde_json::Value` return shape */
export interface ProviderKeyList {
  providers: Array<{
    /** Provider id as returned by Rust (may be a future provider not in
     *  ProviderId yet — hence the `| string` widening). */
    provider: ProviderId | string;
    has_key: boolean;
    /** Masked preview like `"sk-a...1234"` when `has_key` is true, else `""`. */
    masked: string;
    is_active: boolean;
  }>;
  /** `config.active_model_for_display()` — a display string like
   *  `"anthropic / claude-sonnet-4-20250514"`, not a bare provider id. */
  active_provider: string;
}

/**
 * Opaque DTO for deep scan results. The Rust struct has ~12 fields nested
 * deep; the frontend only consumes a summary string today, so we type it as
 * a loose record and narrow in Phase 3 (Dashboard) if any field is rendered
 * directly.
 *
 * @see src-tauri/src/deep_scan.rs `DeepScanResults`
 */
export type DeepScanResults = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Phase 11 Plan 11-01 — ParsedProviderConfig
//
// TS mirror of the Rust `ParsedProviderConfig` struct. Returned by the
// `parse_provider_paste` Tauri command.
//
// @see src-tauri/src/provider_paste_parser.rs
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-51
// ---------------------------------------------------------------------------

/** Provider identity guessed from the paste — superset of `ProviderId` that
 *  adds `openrouter` and `custom` (custom base_url escape hatch per D-55). */
export type ProviderGuess =
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'custom';

/**
 * Result of parsing a provider-config paste (cURL / JSON / Python-SDK).
 *
 * Rust `Option<String>` fields cross the IPC boundary as `string | null`.
 * Consumers MUST treat empty values as "unknown — prompt the user" rather
 * than silently defaulting.
 *
 * @see src-tauri/src/provider_paste_parser.rs `pub struct ParsedProviderConfig`
 */
export interface ParsedProviderConfig {
  provider_guess: ProviderGuess;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Phase 11 Plan 11-02 — capability probe result.
//
// TS mirror of Rust `ProbeStatus` + `ProviderCapabilityRecord` types defined
// in src-tauri/src/config.rs near the TaskRouting struct. Returned by the
// `probe_provider_capabilities` Tauri command.
//
// @see src-tauri/src/config.rs
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-52 + §D-53
// ---------------------------------------------------------------------------

/** Outcome of a single capability probe — mirrors Rust `ProbeStatus` enum.
 *  `RateLimitedButValid` means the key is real but upstream is busy —
 *  UI should show a warning pill, not a red error. */
export type ProbeStatus =
  | 'NotProbed'
  | 'Active'
  | 'InvalidKey'
  | 'ModelNotFound'
  | 'RateLimitedButValid'
  | 'ProviderDown'
  | 'NetworkError';

/**
 * Result of a capability probe — persists on BladeConfig.provider_capabilities
 * and feeds the Settings capability-pill row.
 *
 * `long_context` is derived from `context_window >= 100_000` in Rust; the
 * frontend treats it as authoritative.
 *
 * @see src-tauri/src/config.rs `pub struct ProviderCapabilityRecord`
 */
export interface ProviderCapabilityRecord {
  provider: string;
  model: string;
  context_window: number;
  vision: boolean;
  audio: boolean;
  tool_calling: boolean;
  long_context: boolean;
  /** ISO-8601 / RFC 3339 timestamp — Rust `chrono::DateTime<Utc>`
   *  serializes this way. */
  last_probed: string;
  probe_status: ProbeStatus;
}
