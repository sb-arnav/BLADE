// src/lib/tauri/window.ts — Window-control thin wrappers.
//
// The no-raw-tauri ESLint rule bans `@tauri-apps/api/core.invoke` and
// `@tauri-apps/api/event.listen` outside their allowed paths — but NOT
// `@tauri-apps/api/window`. We still wrap here so TitleBar consumes a single
// named surface (matches D-36 discipline), and any future replacement (e.g.
// mocking in tests) touches one file instead of every call site.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-54 (TitleBar)
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36 (file-per-cluster)

import { getCurrentWindow } from '@tauri-apps/api/window';

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
