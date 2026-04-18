// src/features/identity/index.tsx — Identity cluster (7 routes, Phase 6).
// Phase 1 stubs per IDEN-01..07.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §IDEN-01..07

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'soul',           label: 'Soul',            section: 'identity', component: skeleton('Soul', 6),            phase: 6 },
  { id: 'persona',        label: 'Persona',         section: 'identity', component: skeleton('Persona', 6),         phase: 6 },
  { id: 'character',      label: 'Character Bible', section: 'identity', component: skeleton('Character Bible', 6), phase: 6 },
  { id: 'negotiation',    label: 'Negotiation',     section: 'identity', component: skeleton('Negotiation', 6),     phase: 6 },
  { id: 'reasoning',      label: 'Reasoning',       section: 'identity', component: skeleton('Reasoning', 6),       phase: 6 },
  { id: 'context-engine', label: 'Context Engine',  section: 'identity', component: skeleton('Context Engine', 6),  phase: 6 },
  { id: 'sidecar',        label: 'Sidecar',         section: 'identity', component: skeleton('Sidecar', 6),         phase: 6 },
];
