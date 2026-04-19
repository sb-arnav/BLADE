// src/lib/tauri/homeostasis.ts — Wrappers for src-tauri/src/homeostasis.rs.
// Phase 3 D-75 AmbientStrip (DASH-02) uses homeostasisGet for the first-paint
// snapshot — the HORMONE_UPDATE event only fires on the 60s tick, so the
// ambient strip would render empty for up to a minute without this fetch.
//
// Names verified against src-tauri/src/lib.rs:1198-1200 (registered handlers).
// Snake_case verbatim at the IPC boundary per D-38.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-75
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-13, §D-38

import { invokeTyped } from './_base';
import type { HormoneState, ModuleDirective } from '@/types/hormones';

/**
 * @see src-tauri/src/homeostasis.rs:842
 *   `pub fn homeostasis_get() -> HormoneState`
 *
 * Returns the full 11-field hormone snapshot (10 scalars + last_updated).
 * Always succeeds — falls back to Default::default() on lock poisoning.
 */
export function homeostasisGet(): Promise<HormoneState> {
  return invokeTyped<HormoneState>('homeostasis_get');
}

/**
 * @see src-tauri/src/homeostasis.rs:847
 *   `pub fn homeostasis_get_directive(module: String) -> ModuleDirective`
 *
 * Pituitary translation of raw hormones → per-module concrete settings.
 * Known modules: "evolution" | "hive" | "tentacle" | "brain_planner" |
 * "decision_gate" | "dream_mode" | "persona" | "communication" | "research".
 * Unknown module names return a balanced default directive.
 */
export function homeostasisGetDirective(module: string): Promise<ModuleDirective> {
  return invokeTyped<ModuleDirective, { module: string }>(
    'homeostasis_get_directive',
    { module },
  );
}

/**
 * @see src-tauri/src/homeostasis.rs:855
 *   `pub fn homeostasis_get_circadian() -> Vec<f32>`
 *
 * Returns the learned 24-hour circadian profile — array of length 24, each
 * element is the probability (0.0–1.0) the user is active at that hour.
 * Index 0 = midnight, 12 = noon, 23 = 11pm.
 */
export function homeostasisGetCircadian(): Promise<number[]> {
  return invokeTyped<number[]>('homeostasis_get_circadian');
}

/**
 * @see src-tauri/src/homeostasis.rs:862
 *   `pub fn homeostasis_relearn_circadian() -> Vec<f32>`
 *
 * Recomputes the circadian profile from recent activity and returns the fresh
 * 24-hour array. This OVERWRITES the cached profile — Dialog-gate at the call
 * site (D-205 destructive-op discipline). Phase 8 HormoneBus "Relearn" button.
 *
 * @see .planning/phases/08-body-hive/08-CONTEXT.md §D-194
 */
export function homeostasisRelearnCircadian(): Promise<number[]> {
  return invokeTyped<number[]>('homeostasis_relearn_circadian');
}
