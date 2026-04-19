// src/features/dashboard/index.tsx — Dashboard feature route entry (Phase 3).
//
// Phase 1 shipped a ComingSoonSkeleton stub here; Phase 3 Plan 03-05 replaces
// it with the real Dashboard surface (DASH-01..08). Route id stays
// 'dashboard' — NavRail + ⌘K palette + DEFAULT_ROUTE_ID all derive from this,
// so renaming would cascade the prefs blob default-route resolver and the
// migration ledger.
//
// The dashboard.css side-effect import is intentionally colocated with the
// route module — Vite bundles it with the lazy chunk so route slot hydration
// brings styles automatically. This keeps the main bundle free of
// dashboard-only rules (P-01 first-paint discipline).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-76
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';
import './dashboard.css';

const Dashboard = lazy(() =>
  import('./Dashboard').then((m) => ({ default: m.Dashboard })),
);

export const routes: RouteDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    section: 'core',
    component: Dashboard,
    phase: 3,
    shortcut: 'Mod+1',
    description: 'Ambient home view',
  },
];
