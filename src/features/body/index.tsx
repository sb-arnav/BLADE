// src/features/body/index.tsx — Body Visualization cluster (6 routes, Phase 8).
// Phase 1 stubs per BODY-01..07.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §BODY-01..07

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'body-map',           label: 'Body Map',           section: 'body', component: skeleton('Body Map', 8),           phase: 8 },
  { id: 'body-system-detail', label: 'Body System Detail', section: 'body', component: skeleton('Body System Detail', 8), phase: 8 },
  { id: 'hormone-bus',        label: 'Hormone Bus',        section: 'body', component: skeleton('Hormone Bus', 8),        phase: 8 },
  { id: 'organ-registry',     label: 'Organ Registry',     section: 'body', component: skeleton('Organ Registry', 8),     phase: 8 },
  { id: 'dna',                label: 'DNA',                section: 'body', component: skeleton('DNA', 8),                 phase: 8 },
  { id: 'world-model',        label: 'World Model',        section: 'body', component: skeleton('World Model', 8),        phase: 8 },
];
