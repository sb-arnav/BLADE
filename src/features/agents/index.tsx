// src/features/agents/index.tsx — Agents cluster (9 routes, Phase 5).
// Phase 1 stubs per AGENT-01..09. Phase 5 replaces with real surfaces
// (WIRE-05 blade_agent_event consumer for AgentDetail timeline).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §AGENT-01..09

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'agents',            label: 'Agents',            section: 'agents', component: skeleton('Agents', 5),            phase: 5, description: 'Running + idle agents' },
  { id: 'agent-detail',      label: 'Agent Detail',      section: 'agents', component: skeleton('Agent Detail', 5),      phase: 5 },
  { id: 'agent-factory',     label: 'Agent Factory',     section: 'agents', component: skeleton('Agent Factory', 5),     phase: 5 },
  { id: 'agent-team',        label: 'Agent Team',        section: 'agents', component: skeleton('Agent Team', 5),        phase: 5 },
  { id: 'agent-timeline',    label: 'Agent Timeline',    section: 'agents', component: skeleton('Agent Timeline', 5),    phase: 5 },
  { id: 'background-agents', label: 'Background Agents', section: 'agents', component: skeleton('Background Agents', 5), phase: 5 },
  { id: 'task-agents',       label: 'Task Agents',       section: 'agents', component: skeleton('Task Agents', 5),       phase: 5 },
  { id: 'swarm-view',        label: 'Swarm',             section: 'agents', component: skeleton('Swarm', 5),             phase: 5 },
  { id: 'agent-pixel-world', label: 'Pixel World',       section: 'agents', component: skeleton('Agent Pixel World', 5), phase: 5 },
];
