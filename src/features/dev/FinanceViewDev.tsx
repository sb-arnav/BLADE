// src/features/dev/FinanceViewDev.tsx — DEV-only isolation route for FinanceView.
//
// Phase 6 Plan 06-07 Task 1. Mounts <FinanceView/> in the main-window route tree
// so Playwright can assert the SC-2 falsifier (FinanceView renders KPIs loaded
// via financial_* commands + CSV import affordance is present) without needing
// a live financial_brain backend.
//
// The Playwright shim (tests/e2e/life-os-finance-view.spec.ts) intercepts
// `finance_get_snapshot` / `finance_get_transactions` / `finance_get_goals` /
// `finance_detect_subscriptions` / `finance_generate_insights` invokes and
// returns canned rows matching the Rust wire shapes (FinancialSnapshot /
// FinanceTransaction / FinancialGoal — see src/lib/tauri/life_os.ts for the
// interface declarations). The dev route body is a passthrough; all mocking
// lives in the test shim.
//
// @see tests/e2e/life-os-finance-view.spec.ts
// @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 1

import { FinanceView } from '@/features/life-os/FinanceView';

export function FinanceViewDev() {
  return <FinanceView />;
}
