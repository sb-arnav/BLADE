// src/features/dev/SecurityDashboardDev.tsx — DEV-only isolation route for SecurityDashboard.
//
// Phase 7 Plan 07-07 Task 1. Mounts <SecurityDashboard/> inside the main-window
// route tree so Playwright can assert the SC-4 falsifier (SecurityDashboard
// surfaces active alerts from security_monitor::security_overview with hero
// + 4 tabs + ALL-CAPS pentest danger banner) without needing a live
// security_monitor.rs backend.
//
// The Playwright shim (tests/e2e/admin-security-dashboard.spec.ts) intercepts
// `security_overview` / `security_scan_network` / `symbolic_list_policies` /
// `pentest_list_auth` / `pentest_check_auth` / `pentest_check_model_safety`
// invokes via the addInitScript `__TAURI_INTERNALS__.invoke` shim and returns
// canned rows matching the Rust wire shapes. The dev route body is a
// passthrough; all mocking lives in the test shim.
//
// @see tests/e2e/admin-security-dashboard.spec.ts
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1

import { SecurityDashboard } from '@/features/admin/SecurityDashboard';

export function SecurityDashboardDev() {
  return <SecurityDashboard />;
}
