// src/lib/tauri/deepscan.ts — Wrappers for src-tauri/src/deep_scan.rs.
//
// D-36 file-per-cluster discipline: deep_scan.rs is its own Rust module, so
// its wrappers live in a dedicated TS file rather than being tacked onto
// config.ts. This keeps imports narrow (the onboarding Deep Scan step doesn't
// pull the config wrapper surface) and makes grep-by-command fast.
//
// @see src-tauri/src/deep_scan.rs
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36, §D-38
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-49 (progress payload correction)

import { invokeTyped } from './_base';
import type { DeepScanResults } from '@/types/provider';

/**
 * @see src-tauri/src/deep_scan.rs:1321 `pub async fn deep_scan_start(app) -> Result<DeepScanResults, String>`
 *
 * Kicks off a full 12-scanner pass. While running, Rust emits
 * `deep_scan_progress` events per `DeepScanProgressPayload` (see
 * src/lib/events/payloads.ts). The Promise resolves with the final
 * `DeepScanResults` struct after the `complete` phase tick.
 */
export function deepScanStart(): Promise<DeepScanResults> {
  return invokeTyped<DeepScanResults>('deep_scan_start');
}

/** @see src-tauri/src/deep_scan.rs:1425 `pub async fn deep_scan_results() -> Result<Option<DeepScanResults>, String>` */
export function deepScanResults(): Promise<DeepScanResults | null> {
  return invokeTyped<DeepScanResults | null>('deep_scan_results');
}

/** @see src-tauri/src/deep_scan.rs:1431 `pub async fn deep_scan_summary() -> Result<String, String>` */
export function deepScanSummary(): Promise<string> {
  return invokeTyped<string>('deep_scan_summary');
}

// ── Phase 12 Plan 12-03 — Profile overlay wrappers ───────────────────────────

import type { ProfileView, OverlayAction } from '@/types/provider';

/** @see src-tauri/src/deep_scan/profile.rs `pub async fn profile_get_rendered()` */
export function profileGetRendered(): Promise<ProfileView> {
  return invokeTyped<ProfileView>('profile_get_rendered');
}

/** @see src-tauri/src/deep_scan/profile.rs `pub async fn profile_overlay_upsert(...)` */
export function profileOverlayUpsert(
  rowId: string,
  action: OverlayAction,
  fields?: Record<string, unknown>,
): Promise<void> {
  return invokeTyped<void, { row_id: string; action: OverlayAction; fields: Record<string, unknown> | null }>(
    'profile_overlay_upsert',
    { row_id: rowId, action, fields: fields ?? null },
  );
}

/** @see src-tauri/src/deep_scan/profile.rs `pub async fn profile_overlay_reset(row_id: String)` */
export function profileOverlayReset(rowId: string): Promise<void> {
  return invokeTyped<void, { row_id: string }>('profile_overlay_reset', { row_id: rowId });
}

/** @see src-tauri/src/deep_scan/queue.rs SCAN_CANCEL — halts drain loop at next lead boundary */
export function scanCancel(): Promise<void> {
  return invokeTyped<void>('scan_cancel');
}

// ── Phase 12 Plan 12-04 — Privacy config wrapper ─────────────────────────────

export interface ScanClassesEnabled {
  fs_repos: boolean;
  git_remotes: boolean;
  ide_workspaces: boolean;
  ai_sessions: boolean;
  shell_history: boolean;
  mru: boolean;
  bookmarks: boolean;
  which_sweep: boolean;
}

/** @see src-tauri/src/config.rs `pub fn set_scan_classes_enabled(...)` */
export function setScanClassesEnabled(classes: ScanClassesEnabled): Promise<void> {
  return invokeTyped<void, Record<string, unknown>>('set_scan_classes_enabled', classes as unknown as Record<string, unknown>);
}
