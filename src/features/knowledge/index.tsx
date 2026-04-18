// src/features/knowledge/index.tsx — Knowledge cluster (9 routes, Phase 5).
// Phase 1 stubs per KNOW-01..09.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §KNOW-01..09

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'knowledge-base',        label: 'Knowledge Base',        section: 'knowledge', component: skeleton('Knowledge Base', 5),        phase: 5 },
  { id: 'knowledge-graph',       label: 'Knowledge Graph',       section: 'knowledge', component: skeleton('Knowledge Graph', 5),       phase: 5 },
  { id: 'memory-palace',         label: 'Memory Palace',         section: 'knowledge', component: skeleton('Memory Palace', 5),         phase: 5 },
  { id: 'screen-timeline',       label: 'Screen Timeline',       section: 'knowledge', component: skeleton('Screen Timeline', 5),       phase: 5 },
  { id: 'rewind-timeline',       label: 'Rewind',                section: 'knowledge', component: skeleton('Rewind Timeline', 5),       phase: 5 },
  { id: 'live-notes',            label: 'Live Notes',            section: 'knowledge', component: skeleton('Live Notes', 5),            phase: 5 },
  { id: 'daily-log',             label: 'Daily Log',             section: 'knowledge', component: skeleton('Daily Log', 5),             phase: 5 },
  { id: 'conversation-insights', label: 'Conversation Insights', section: 'knowledge', component: skeleton('Conversation Insights', 5), phase: 5 },
  { id: 'codebase-explorer',     label: 'Codebase Explorer',     section: 'knowledge', component: skeleton('Codebase Explorer', 5),     phase: 5 },
];
