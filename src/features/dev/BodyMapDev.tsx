// src/features/dev/BodyMapDev.tsx — DEV-only isolation route for BodyMap.
//
// Phase 8 Plan 08-05 Task 3. Mounts <BodyMap/> inside the main-window route
// tree so Playwright can assert the SC-1 falsifier (BodyMap renders the 12
// body-system card grid + click drills into BodySystemDetail without error)
// without needing a live body_registry.rs backend.
//
// The Playwright shim (tests/e2e/body-map.spec.ts) intercepts
// `body_get_summary` / `body_get_map` / `body_get_system` invokes via the
// addInitScript `__TAURI_INTERNALS__.invoke` shim and returns canned rows
// matching the Rust wire shapes. The dev route body is a passthrough; all
// mocking lives in the test shim — same pattern as Phase 5-7 dev routes.
//
// @see tests/e2e/body-map.spec.ts
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 3
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1 (pattern)

import { BodyMap } from '@/features/body/BodyMap';

export function BodyMapDev() {
  return <BodyMap />;
}
