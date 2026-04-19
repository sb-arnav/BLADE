// src/features/dev/ApprovalQueueDev.tsx — DEV-only isolation route for ApprovalQueue.
//
// Phase 8 Plan 08-05 Task 3. Mounts <ApprovalQueue/> inside the main-window
// route tree so Playwright can assert the SC-4 falsifier (ApprovalQueue
// renders pending decisions from recent_decisions + Approve fires
// hive_approve_decision) without needing a live hive.rs backend.
//
// The Playwright shim (tests/e2e/approval-queue.spec.ts) intercepts
// `hive_get_status` / `hive_approve_decision` invokes via the addInitScript
// `__TAURI_INTERNALS__.invoke` shim and returns canned rows matching the Rust
// wire shapes (HiveStatus with 3 Decision entries: Reply/Escalate/Act). The
// dev route body is a passthrough; all mocking lives in the test shim — same
// pattern as Phase 5-7 dev routes.
//
// @see tests/e2e/approval-queue.spec.ts
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 3
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1 (pattern)

import { ApprovalQueue } from '@/features/hive/ApprovalQueue';

export function ApprovalQueueDev() {
  return <ApprovalQueue />;
}
