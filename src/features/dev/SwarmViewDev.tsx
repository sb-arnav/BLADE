// src/features/dev/SwarmViewDev.tsx — DEV-only isolation route for SwarmView.
//
// Phase 5 Plan 05-07 Task 1. Mounts <SwarmView/> in the main-window route tree
// so Playwright can assert the DAG render surface (SC-1 explicit falsifier —
// "SwarmView renders a DAG from swarm_* commands") without needing a live
// Rust-orchestrated swarm.
//
// The Playwright shim (tests/e2e/swarm-view-render.spec.ts) intercepts
// `swarm_list` / `swarm_get` / `swarm_get_progress` invokes and returns a
// canned Swarm with 3 tasks + dependency edges, matching the wire shape
// (`tasks[]`, `depends_on[]` — src/lib/tauri/agents.ts SwarmTask/Swarm). The
// route body is just a passthrough; all mocking lives in the test shim (same
// pattern as Phase 4 HudDev + hud-bar-render.spec.ts).
//
// @see tests/e2e/swarm-view-render.spec.ts
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 1
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1f (pattern)

import { SwarmView } from '@/features/agents/SwarmView';

export function SwarmViewDev() {
  return <SwarmView />;
}
