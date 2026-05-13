// src/lib/tauri/ecosystem.ts — Phase 13 Plan 13-02 (ECOSYS-07, ECOSYS-08, ECOSYS-09)
//
// Wrappers for src-tauri/src/ecosystem.rs Tauri commands.
// D-36 file-per-cluster discipline: ecosystem.rs is its own module → own TS file.
//
// @see src-tauri/src/ecosystem.rs
// @see .planning/phases/13-self-configuring-ecosystem/13-RESEARCH.md

import { invokeTyped } from './_base';
import type { TentacleRecord } from '@/types/provider';

/**
 * @see ecosystem.rs `pub fn ecosystem_list_tentacles() -> Vec<TentacleRecord>`
 * Returns all registered tentacles including enabled/disabled state and rationale.
 */
export function ecosystemListTentacles(): Promise<TentacleRecord[]> {
  return invokeTyped<TentacleRecord[]>('ecosystem_list_tentacles');
}

/**
 * @see ecosystem.rs `pub fn ecosystem_toggle_tentacle(id: String, enabled: bool)`
 * Persists the enabled/disabled state of a tentacle (ECOSYS-08).
 */
export function ecosystemToggleTentacle(id: string, enabled: boolean): Promise<void> {
  return invokeTyped<void, { id: string; enabled: boolean }>(
    'ecosystem_toggle_tentacle',
    { id, enabled },
  );
}

/**
 * @see ecosystem.rs `pub fn ecosystem_observe_only_check() -> bool`
 * Returns true when the v1.1 observe-only guardrail is active (test seam).
 */
export function ecosystemObserveOnlyCheck(): Promise<boolean> {
  return invokeTyped<boolean>('ecosystem_observe_only_check');
}

// v1.6 narrowing — ecosystemRunAutoEnable cut (deep_scan removed).
