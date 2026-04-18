// src/features/life-os/index.tsx — Life OS cluster (9 routes, Phase 6).
// Phase 1 stubs per LIFE-01..09.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §LIFE-01..09

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'health',          label: 'Health',                 section: 'life', component: skeleton('Health', 6),                 phase: 6 },
  { id: 'finance',         label: 'Finance',                section: 'life', component: skeleton('Finance', 6),                phase: 6 },
  { id: 'goals',           label: 'Goals',                  section: 'life', component: skeleton('Goals', 6),                  phase: 6 },
  { id: 'habits',          label: 'Habits',                 section: 'life', component: skeleton('Habits', 6),                 phase: 6 },
  { id: 'meetings',        label: 'Meetings',               section: 'life', component: skeleton('Meetings', 6),               phase: 6 },
  { id: 'social-graph',    label: 'Social Graph',           section: 'life', component: skeleton('Social Graph', 6),           phase: 6 },
  { id: 'predictions',     label: 'Predictions',            section: 'life', component: skeleton('Predictions', 6),            phase: 6 },
  { id: 'emotional-intel', label: 'Emotional Intelligence', section: 'life', component: skeleton('Emotional Intelligence', 6), phase: 6 },
  { id: 'accountability',  label: 'Accountability',         section: 'life', component: skeleton('Accountability', 6),         phase: 6 },
];
