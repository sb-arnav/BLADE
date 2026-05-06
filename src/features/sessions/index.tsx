// src/features/sessions/index.tsx
//
// Phase 34 / Plan 34-11 — Sessions feature route registration.
//
// Mirrors the Phase 5 / Phase 11 pattern (agents/index.tsx, ghost/index.tsx):
// a tiny route aggregator that lazy-imports the SessionsView surface and
// exposes a `routes` array consumed by src/windows/main/router.ts.
//
// Adding a new route within this cluster = 1 entry below (FOUND-08 / D-40).
// Adding a new cluster file = 1 import + 1 spread in router.ts (it's a
// 3-place edit only when the cluster doesn't yet exist; this is that edit).

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const SessionsView = lazy(() =>
  import('./SessionsView').then((m) => ({ default: m.SessionsView })),
);

export const routes: RouteDefinition[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    section: 'core',
    component: SessionsView,
    phase: 34,
    description: 'Past conversations — resume, branch, archive',
  },
];

export { SessionsView };
