// playwright.config.ts — Phase 1 harness config (D-32, P-06).
//
// Minimal config targeting the Vite dev server at http://localhost:1420.
// Phase 1 runs against the DEV webview directly (not the full Tauri runtime) —
// the listener-leak assertion reads window.__BLADE_LISTENERS_COUNT__ which
// exists in the browser build regardless.
//
// Phase 9 Polish can upgrade to tauri-driver / full Tauri harness; until then
// this setup catches listener leaks in the React layer cheaply (~10s runtime).
//
// `reuseExistingServer: true` lets the operator leave `npm run tauri dev`
// running in another terminal and have Playwright attach.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-32
// @see .planning/research/PITFALLS.md §P-06
// @see tests/e2e/listener-leak.spec.ts

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:1420',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 1420,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
