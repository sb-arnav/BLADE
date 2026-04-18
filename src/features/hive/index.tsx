// src/features/hive/index.tsx — Hive Mesh cluster (5 routes, Phase 8).
// Phase 1 stubs per HIVE-01..06.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §HIVE-01..06

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'hive-mesh',           label: 'Hive',              section: 'hive', component: skeleton('Hive', 8),              phase: 8, description: 'All tentacles overview' },
  { id: 'hive-tentacle',       label: 'Tentacle Detail',   section: 'hive', component: skeleton('Tentacle Detail', 8),   phase: 8 },
  { id: 'hive-autonomy',       label: 'Autonomy Controls', section: 'hive', component: skeleton('Autonomy Controls', 8), phase: 8 },
  { id: 'hive-approval-queue', label: 'Approval Queue',    section: 'hive', component: skeleton('Approval Queue', 8),    phase: 8 },
  { id: 'hive-ai-delegate',    label: 'AI Delegate',       section: 'hive', component: skeleton('AI Delegate', 8),       phase: 8 },
];
