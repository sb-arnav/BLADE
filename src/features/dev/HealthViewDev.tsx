// src/features/dev/HealthViewDev.tsx — DEV-only isolation route for HealthView.
//
// Phase 6 Plan 06-07 Task 1. Mounts <HealthView/> in the main-window route tree
// so Playwright can assert the SC-1 falsifier (HealthView renders snapshot + 5
// stat cards + streak chip from streak_* commands) without needing a live
// health_tracker / streak_stats backend.
//
// The Playwright shim (tests/e2e/life-os-health-view.spec.ts) intercepts
// `health_get_today` / `health_get_stats` / `health_get_insights` /
// `health_streak_info` / `streak_get_stats` / `health_get_scan` invokes and
// returns canned rows matching the Rust wire shapes (HealthLog / HealthStats /
// HealthInsight / ProjectHealth / StreakStats — see src/lib/tauri/life_os.ts
// for the interface declarations). The dev route body is a passthrough; all
// mocking lives in the test shim (same pattern as Phase 5 SwarmViewDev /
// KnowledgeBaseDev).
//
// @see tests/e2e/life-os-health-view.spec.ts
// @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 1
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 1 (pattern)

import { HealthView } from '@/features/life-os/HealthView';

export function HealthViewDev() {
  return <HealthView />;
}
