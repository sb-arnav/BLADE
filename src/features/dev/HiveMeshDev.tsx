// src/features/dev/HiveMeshDev.tsx — DEV-only isolation route for HiveMesh.
//
// Phase 8 Plan 08-05 Task 3. Mounts <HiveMesh/> inside the main-window route
// tree so Playwright can assert the SC-3 falsifier (HiveMesh renders the
// tentacle grid + Dialog-gated autonomy ≥ 0.7) without needing a live
// hive.rs backend.
//
// The Playwright shim (tests/e2e/hive-mesh.spec.ts) intercepts
// `hive_get_status` / `hive_set_autonomy` / `hive_get_reports` /
// `organ_get_autonomy` / `organ_set_autonomy` invokes via the addInitScript
// `__TAURI_INTERNALS__.invoke` shim and returns canned rows matching the Rust
// wire shapes. The dev route body is a passthrough; all mocking lives in the
// test shim — same pattern as Phase 5-7 dev routes.
//
// @see tests/e2e/hive-mesh.spec.ts
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 3
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1 (pattern)

import { HiveMesh } from '@/features/hive/HiveMesh';

export function HiveMeshDev() {
  return <HiveMesh />;
}
