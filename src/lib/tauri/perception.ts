// src/lib/tauri/perception.ts — Wrappers for src-tauri/src/perception_fusion.rs.
// Phase 3 D-74 RightNowHero (DASH-01) consumes these.
//
// Names verified against src-tauri/src/lib.rs:1048-1049 (registered handlers).
// Snake_case verbatim at the IPC boundary per D-38.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-74
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-13, §D-38

import { invokeTyped } from './_base';
import type { PerceptionState } from '@/types/perception';

/**
 * @see src-tauri/src/perception_fusion.rs:607
 *   `pub fn perception_get_latest() -> Option<PerceptionState>`
 *
 * Returns null when the perception loop hasn't produced a snapshot yet
 * (cold boot before the 30s tick — D-74 mount path then calls
 * `perceptionUpdate()` to force a fresh capture).
 */
export function perceptionGetLatest(): Promise<PerceptionState | null> {
  return invokeTyped<PerceptionState | null>('perception_get_latest');
}

/**
 * @see src-tauri/src/perception_fusion.rs:613
 *   `pub async fn perception_update() -> PerceptionState`
 *
 * Forces a fresh snapshot (spawn_blocking inside Rust). Backend caches
 * for 30s — repeated calls are cheap. Always returns a value.
 */
export function perceptionUpdate(): Promise<PerceptionState> {
  return invokeTyped<PerceptionState>('perception_update');
}
