// src/lib/tauri/system.ts — Phase 14 Plan 14-02 (WIRE2-04)
//
// Wrappers for system_control.rs, ghost_mode.rs, pulse.rs, roles.rs, tray.rs.
// D-36 file-per-cluster discipline: system-level commands → own TS file.
// All commands are already registered in lib.rs — no Rust changes required.
//
// @see src-tauri/src/system_control.rs
// @see src-tauri/src/ghost_mode.rs
// @see src-tauri/src/pulse.rs
// @see src-tauri/src/tray.rs
// @see .planning/phases/14-wiring-accessibility-pass/14-02-PLAN.md

import { invokeTyped } from './_base';

/** Role record as returned by roles.rs. */
export type Role = {
  id: string;
  name: string;
  description: string;
  active: boolean;
};

/**
 * Lock the screen immediately via the OS.
 * @see system_control.rs `pub async fn lock_screen()`
 */
export function lockScreen(): Promise<void> {
  return invokeTyped<void>('lock_screen');
}

/**
 * Start Ghost Mode — invisible AI meeting overlay.
 * @see ghost_mode.rs `pub async fn ghost_start()`
 */
export function ghostStart(): Promise<void> {
  return invokeTyped<void>('ghost_start');
}

/**
 * Return the latest morning briefing / daily digest as a markdown string.
 * Read-only.
 * @see pulse.rs `pub async fn pulse_get_digest() -> String`
 */
export function pulseGetDigest(): Promise<string> {
  return invokeTyped<string>('pulse_get_digest');
}

/**
 * Return all registered BLADE roles.
 * Read-only.
 * @see src-tauri (roles module) `pub fn roles_list() -> Vec<Role>`
 */
export function rolesList(): Promise<Role[]> {
  return invokeTyped<Role[]>('roles_list');
}

/**
 * Update the system tray status text/icon.
 * @see tray.rs `pub fn set_tray_status(status: String)`
 */
export function setTrayStatus(status: string): Promise<void> {
  return invokeTyped<void, { status: string }>('set_tray_status', { status });
}
