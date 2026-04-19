// src/lib/tauri/config.ts
//
// Wrappers for src-tauri/src/config.rs + commands.rs config-related commands.
// All arg keys are snake_case verbatim — matching Rust parameter names exactly
// (D-38, P-04 prevention). Never transform keys between TS and Rust.
//
// Scope: Phase 1 ships the 4 wrappers needed by ConfigContext boot (Plan 02)
// and the Plan 09 wrapper-smoke harness. Later phases extend this file as
// additional config-related Rust commands are wrapped.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36, §D-38
// @see .planning/research/PITFALLS.md §P-04

import { invokeTyped } from './_base';
import type { BladeConfig } from '@/types/config';
import type { ProviderKeyList } from '@/types/provider';
import type { TaskRouting } from '@/types/routing';

/** @see src-tauri/src/commands.rs:1899 `pub fn get_config() -> BladeConfig` */
export function getConfig(): Promise<BladeConfig> {
  return invokeTyped<BladeConfig>('get_config');
}

/**
 * @see src-tauri/src/config.rs:514 `pub fn save_config(config: &BladeConfig) -> Result<(), String>`
 *
 * Note: `save_config` is an internal Rust helper in `config.rs` (not a
 * `#[tauri::command]`). This wrapper assumes a matching Tauri command is
 * registered that accepts `{ config: BladeConfig }` verbatim. Plan 09
 * WrapperSmoke.tsx is the P-04 gate that will surface drift here.
 */
export function saveConfig(config: BladeConfig): Promise<void> {
  return invokeTyped<void, { config: BladeConfig }>('save_config', { config });
}

/** @see src-tauri/src/commands.rs:2312 `pub fn get_onboarding_status() -> bool` */
export function getOnboardingStatus(): Promise<boolean> {
  return invokeTyped<boolean>('get_onboarding_status');
}

/** @see src-tauri/src/commands.rs:2325 `pub async fn complete_onboarding(answers: Vec<String>) -> Result<(), String>` */
export function completeOnboarding(answers: string[]): Promise<void> {
  return invokeTyped<void, { answers: string[] }>('complete_onboarding', { answers });
}

// ---------------------------------------------------------------------------
// Phase 2 additions — provider setup + deep-scan composition (D-50, D-38).
//
// These wrappers compose the 4-command onboarding persistence sequence per
// D-50 (test_provider → store_provider_key → switch_provider → set_config).
// Each wrapper has a JSDoc `@see` cite to Rust file:line — drift between TS
// and Rust signatures is surfaced in PR review.
// ---------------------------------------------------------------------------

/**
 * @see src-tauri/src/commands.rs:2025 `pub async fn test_provider(provider: String, api_key: String, model: String, base_url: Option<String>) -> Result<String, String>`
 *
 * Validates `api_key` against the provider's real endpoint. Returns a
 * short human-readable result on success (e.g. "Connection OK"). Throws
 * TauriError on auth/network failure — the UI surfaces the `rustMessage`.
 */
export function testProvider(args: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Promise<string> {
  return invokeTyped<string, { provider: string; api_key: string; model: string; base_url?: string }>(
    'test_provider',
    { provider: args.provider, api_key: args.apiKey, model: args.model, base_url: args.baseUrl },
  );
}

/** @see src-tauri/src/config.rs:605 `pub fn get_all_provider_keys() -> serde_json::Value` */
export function getAllProviderKeys(): Promise<ProviderKeyList> {
  return invokeTyped<ProviderKeyList>('get_all_provider_keys');
}

/** @see src-tauri/src/config.rs:636 `pub fn store_provider_key(provider: String, api_key: String) -> Result<(), String>` */
export function storeProviderKey(provider: string, apiKey: string): Promise<void> {
  return invokeTyped<void, { provider: string; api_key: string }>(
    'store_provider_key',
    { provider, api_key: apiKey },
  );
}

/** @see src-tauri/src/config.rs:645 `pub fn switch_provider(provider: String, model: Option<String>) -> Result<BladeConfig, String>` */
export function switchProvider(provider: string, model?: string): Promise<BladeConfig> {
  return invokeTyped<BladeConfig, { provider: string; model?: string }>(
    'switch_provider',
    { provider, model },
  );
}

/**
 * @see src-tauri/src/commands.rs:1944 `set_config(provider, api_key, model, token_efficient?, user_name?, work_mode?, response_style?, blade_email?, base_url?, god_mode?, god_mode_tier?, voice_mode?, obsidian_vault_path?, tts_voice?, quick_ask_shortcut?, voice_shortcut?) -> Result<(), String>`
 *
 * Pass `apiKey: ''` after a successful `storeProviderKey` — Rust guards
 * against empty/masked keys clobbering the keyring (commands.rs:1967).
 * `onboarded` is flipped to true as a side effect (commands.rs:1972).
 */
export function setConfig(args: {
  provider: string;
  /** Pass '' to preserve keyring; Rust guards against clobber (commands.rs:1967). */
  apiKey: string;
  model: string;
  tokenEfficient?: boolean;
  userName?: string;
  workMode?: string;
  responseStyle?: string;
  bladeEmail?: string;
  baseUrl?: string;
  godMode?: boolean;
  godModeTier?: string;
  voiceMode?: string;
  obsidianVaultPath?: string;
  ttsVoice?: string;
  quickAskShortcut?: string;
  voiceShortcut?: string;
}): Promise<void> {
  return invokeTyped<void, {
    provider: string;
    api_key: string;
    model: string;
    token_efficient?: boolean;
    user_name?: string;
    work_mode?: string;
    response_style?: string;
    blade_email?: string;
    base_url?: string;
    god_mode?: boolean;
    god_mode_tier?: string;
    voice_mode?: string;
    obsidian_vault_path?: string;
    tts_voice?: string;
    quick_ask_shortcut?: string;
    voice_shortcut?: string;
  }>('set_config', {
    provider: args.provider,
    api_key: args.apiKey,
    model: args.model,
    token_efficient: args.tokenEfficient,
    user_name: args.userName,
    work_mode: args.workMode,
    response_style: args.responseStyle,
    blade_email: args.bladeEmail,
    base_url: args.baseUrl,
    god_mode: args.godMode,
    god_mode_tier: args.godModeTier,
    voice_mode: args.voiceMode,
    obsidian_vault_path: args.obsidianVaultPath,
    tts_voice: args.ttsVoice,
    quick_ask_shortcut: args.quickAskShortcut,
    voice_shortcut: args.voiceShortcut,
  });
}

// ---------------------------------------------------------------------------
// Phase 3 additions — task routing, generic field save, persona reset, debug.
// All snake_case at the IPC boundary (D-38, P-04 prevention). Names verified
// against src-tauri/src/lib.rs:463-467 (registered handlers).
// ---------------------------------------------------------------------------

/**
 * @see src-tauri/src/config.rs:713 `pub fn get_task_routing() -> TaskRouting`
 *
 * Returns the per-task-type provider routing (code/vision/fast/creative/
 * fallback). Each field is null when unset (Rust Option::None → JSON null).
 * D-83 Routing pane (Plan 03-06) consumes this for the routing grid.
 */
export function getTaskRouting(): Promise<TaskRouting> {
  return invokeTyped<TaskRouting>('get_task_routing');
}

/**
 * @see src-tauri/src/config.rs:719
 *   `pub fn set_task_routing(routing: TaskRouting) -> Result<(), String>`
 *
 * Replaces the routing block wholesale. Pass the existing TaskRouting with the
 * single field updated; the Rust side does not merge — the whole struct is
 * persisted.
 */
export function setTaskRouting(routing: TaskRouting): Promise<void> {
  return invokeTyped<void, { routing: TaskRouting }>('set_task_routing', { routing });
}

/**
 * @see src-tauri/src/config.rs:728
 *   `pub fn save_config_field(key: String, value: String) -> Result<(), String>`
 *
 * Generic single-field save — the Voice pane (D-84) and IoT pane (D-87) use
 * this for `voice_shortcut`, `wake_word`, `ha_base_url`, `ha_token`, etc. Key
 * names match BladeConfig field names (snake_case).
 */
export function saveConfigField(key: string, value: string): Promise<void> {
  return invokeTyped<void, { key: string; value: string }>(
    'save_config_field',
    { key, value },
  );
}

/**
 * @see src-tauri/src/commands.rs:1989 `pub fn reset_onboarding() -> Result<(), String>`
 *
 * Wipes `persona_onboarding_complete` so the next MainShell mount routes the
 * user back to the persona-onboarding step. D-85 Personality pane (Plan 03-06)
 * exposes this behind a confirmation dialog.
 */
export function resetOnboarding(): Promise<void> {
  return invokeTyped<void>('reset_onboarding');
}

/**
 * @see src-tauri/src/commands.rs:1969 `pub fn debug_config() -> serde_json::Value`
 *
 * Returns the raw config blob (including non-typed fields not surfaced on
 * BladeConfig). Used by D-89 Diagnostics Entry pane (Plan 03-06) for the
 * developer config dump.
 */
export function debugConfig(): Promise<Record<string, unknown>> {
  return invokeTyped<Record<string, unknown>>('debug_config');
}
