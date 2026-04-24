// src/lib/tauri/privacy.ts — Phase 14 Plan 14-02 (WIRE2-03)
//
// Wrappers for screen.rs, notification_listener.rs, clipboard.rs.
// D-36 file-per-cluster discipline: privacy/perception commands → own TS file.
// All commands are already registered in lib.rs — no Rust changes required.
//
// Security note (T-14-02-03): getClipboard returns clipboard contents to the
// caller. No clipboard data is emitted to the activity log or stored
// persistently by this wrapper — callers are responsible for handling data
// appropriately.
//
// @see src-tauri/src/screen_timeline.rs
// @see src-tauri/src/notification_listener.rs
// @see src-tauri/src/clipboard.rs
// @see .planning/phases/14-wiring-accessibility-pass/14-02-PLAN.md

import { invokeTyped } from './_base';

/** Notification record as returned by notification_listener.rs. */
export type Notification = {
  id: string;
  app: string;
  summary: string;
  body: string;
  timestamp: number;
};

/**
 * Capture the current screen and return a base64-encoded PNG.
 * Read-only — no blade_activity_log emission required (high-frequency operation).
 * @see screen_timeline.rs `pub async fn capture_screen() -> String`
 */
export function captureScreen(): Promise<string> {
  return invokeTyped<string>('capture_screen');
}

/**
 * Return the most recent OS notifications (default limit 20).
 * Read-only — no blade_activity_log emission required.
 * @see notification_listener.rs `pub fn notification_get_recent(limit: Option<usize>) -> Vec<NotificationRecord>`
 */
export function getNotificationRecent(limit?: number): Promise<Notification[]> {
  return invokeTyped<Notification[], { limit: number }>(
    'notification_get_recent',
    { limit: limit ?? 20 },
  );
}

/**
 * Return the current clipboard text content.
 * Read-only — see security note in file header.
 * @see clipboard.rs `pub fn get_clipboard() -> String`
 */
export function getClipboard(): Promise<string> {
  return invokeTyped<string>('get_clipboard');
}
