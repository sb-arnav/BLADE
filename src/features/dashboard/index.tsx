// src/features/dashboard/index.tsx — Dashboard feature routes.
// Phase 1 stub per D-26 step 7, D-44. Phase 3 replaces the skeleton with the
// real Dashboard (DASH-01..08, WIRE-02 consumer).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    section: 'core',
    component: skeleton('Dashboard', 3),
    phase: 3,
    shortcut: 'Mod+1',
    description: 'Ambient home view',
  },
];
