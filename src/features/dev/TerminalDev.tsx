// src/features/dev/TerminalDev.tsx — DEV-only isolation route for Terminal.
//
// Phase 7 Plan 07-07 Task 1. Mounts <Terminal/> inside the main-window route
// tree so Playwright can assert the SC-1 falsifier (Terminal routes bash
// through native_tools.rs::run_shell and echoes output into the scrollback)
// without needing a live shell backend.
//
// The Playwright shim (tests/e2e/dev-tools-terminal.spec.ts) intercepts
// `run_shell` / `run_code_block` / `ask_ai` invokes via the addInitScript
// `__TAURI_INTERNALS__.invoke` shim and returns canned shell output. The dev
// route body is a passthrough; all mocking lives in the test shim — same
// pattern as Phase 6 HealthViewDev / CharacterBibleDev.
//
// @see tests/e2e/dev-tools-terminal.spec.ts
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1
// @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 1 (pattern)

import { Terminal } from '@/features/dev-tools/Terminal';

export function TerminalDev() {
  return <Terminal />;
}
