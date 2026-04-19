// src/lib/tauri/window.ts — Window-control thin wrappers.
//
// The no-raw-tauri ESLint rule bans `@tauri-apps/api/core.invoke` and
// `@tauri-apps/api/event.listen` outside their allowed paths — but NOT
// `@tauri-apps/api/window`. We still wrap here so TitleBar consumes a single
// named surface (matches D-36 discipline), and any future replacement (e.g.
// mocking in tests) touches one file instead of every call site.
//
// Phase 4 Plan 04-01 additions (D-95, D-114, D-115, D-106):
//   - `toggleMainWindow()` wraps the Rust `toggle_window` command for HUD
//     click targets and the QuickAsk bridge (Plan 04-05, Plan 04-06).
//   - `getCurrentWebviewWindow` is re-exported from `@tauri-apps/api/webviewWindow`
//     so Phase 4 overlay windows (quickask / overlay / ghost_overlay /
//     blade_hud) consume a single named surface for hide/show/position.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-54 (TitleBar)
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36 (file-per-cluster)
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-95, §D-114, §D-115

import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebviewWindow as _getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invokeTyped } from './_base';

/** Minimise the main window. Maps to Tauri's `getCurrentWindow().minimize()`. */
export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

/** Close the main window (triggers app exit if this is the last window). */
export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

/** Toggle maximise / restore. Idempotent — safe to fire on double-click of the TitleBar drag region. */
export function toggleMaximize(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

/**
 * @see src-tauri/src/lib.rs:187 `pub(crate) fn toggle_window(app: &tauri::AppHandle)`
 *       registered as `toggle_window` in generate_handler!
 *
 * Phase 4 Plan 04-01 (D-114): HUD click and Plan 04-06 bridge both call this
 * to open-or-focus the main window without needing a dedicated open/show pair.
 * Idempotent — safe to fire from any overlay window.
 */
export function toggleMainWindow(): Promise<void> {
  return invokeTyped<void>('toggle_window');
}

/**
 * Re-export of `@tauri-apps/api/webviewWindow.getCurrentWebviewWindow` so the
 * Phase 4 overlay windows (quickask, overlay/voice-orb, ghost_overlay,
 * blade_hud) have a single named surface for `.hide()` / `.show()` /
 * `.setPosition()` calls. Mirrors the Phase 1 wrapper pattern (D-36).
 */
export const getCurrentWebviewWindow = _getCurrentWebviewWindow;
