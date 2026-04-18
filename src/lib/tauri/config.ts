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
