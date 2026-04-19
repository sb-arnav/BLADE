// src/features/dev/WorkflowBuilderDev.tsx — DEV-only isolation route for WorkflowBuilder.
//
// Phase 7 Plan 07-07 Task 1. Mounts <WorkflowBuilder/> inside the main-window
// route tree so Playwright can assert the DEV-05 falsifier (WorkflowBuilder
// renders list + detail + tabs sourced from workflow_list / workflow_get /
// workflow_get_runs) without needing a live workflow_builder.rs backend.
//
// The Playwright shim (tests/e2e/dev-tools-workflow-builder.spec.ts)
// intercepts `workflow_list` / `workflow_get` / `workflow_get_runs` /
// `workflow_run_now` / `workflow_create` / `workflow_generate_from_description` /
// `cron_list` invokes via the addInitScript `__TAURI_INTERNALS__.invoke` shim
// and returns canned workflow rows. The dev route body is a passthrough; all
// mocking lives in the test shim.
//
// @see tests/e2e/dev-tools-workflow-builder.spec.ts
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1

import { WorkflowBuilder } from '@/features/dev-tools/WorkflowBuilder';

export function WorkflowBuilderDev() {
  return <WorkflowBuilder />;
}
