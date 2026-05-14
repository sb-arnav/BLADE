// src/features/agents/index.tsx — Phase 5 Plan 05-02 rewrite (D-122 single-writer)
// Phase 1 ComingSoonSkeleton stubs replaced with lazy imports of real per-route
// components. Plans 05-03 + 05-04 fill in the placeholder bodies WITHOUT editing
// this file (D-122 single-writer invariant on shared registry files).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-122, §D-131
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §5
// @see .planning/REQUIREMENTS.md §AGENT-01..09

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const AgentDashboard   = lazy(() => import('./AgentDashboard').then((m) => ({ default: m.AgentDashboard })));
const AgentDetail      = lazy(() => import('./AgentDetail').then((m) => ({ default: m.AgentDetail })));
const AgentFactory     = lazy(() => import('./AgentFactory').then((m) => ({ default: m.AgentFactory })));
const AgentTeam        = lazy(() => import('./AgentTeam').then((m) => ({ default: m.AgentTeam })));
const AgentTimeline    = lazy(() => import('./AgentTimeline').then((m) => ({ default: m.AgentTimeline })));
const BackgroundAgents = lazy(() => import('./BackgroundAgents').then((m) => ({ default: m.BackgroundAgents })));
const TaskAgents       = lazy(() => import('./TaskAgents').then((m) => ({ default: m.TaskAgents })));
const SwarmView        = lazy(() => import('./SwarmView').then((m) => ({ default: m.SwarmView })));
const AgentPixelWorld  = lazy(() => import('./AgentPixelWorld').then((m) => ({ default: m.AgentPixelWorld })));

export const routes: RouteDefinition[] = [
  { id: 'agents',            label: 'Agents',            section: 'agents', component: AgentDashboard,   phase: 5, description: 'Running + idle agents' },
  { id: 'agent-detail',      label: 'Agent Detail',      section: 'agents', component: AgentDetail,      phase: 5 },
  { id: 'agent-factory',     label: 'Agent Factory',     section: 'agents', component: AgentFactory,     phase: 5 },
  { id: 'agent-team',        label: 'Agent Team',        section: 'agents', component: AgentTeam,        phase: 5 },
  { id: 'agent-timeline',    label: 'Agent Timeline',    section: 'agents', component: AgentTimeline,    phase: 5 },
  { id: 'background-agents', label: 'Background Agents', section: 'agents', component: BackgroundAgents, phase: 5 },
  { id: 'task-agents',       label: 'Task Agents',       section: 'agents', component: TaskAgents,       phase: 5 },
  { id: 'swarm-view',        label: 'Swarm',             section: 'agents', component: SwarmView,        phase: 5 },
  // Phase 59 Plan 59-02 (TRIO-DEMOTE-NAV) — Pixel World is part of the v2.0-held
  // trio; demoted from ⌘K + NavRail. Surfaced inside /dev-tools.
  { id: 'agent-pixel-world', label: 'Pixel World',       section: 'agents', component: AgentPixelWorld,  phase: 5, paletteHidden: true, description: 'Held-trio — surfaced inside /dev-tools.' },
  // Phase 11 Plan 11-05 — tools capability-gap alias route. SwarmView surfaces
  // CapabilityGap when no tool-calling model is configured; CAPABILITY_SURFACES
  // references this alias so openRoute('agents-swarm') lands in the same place.
  { id: 'agents-swarm',      label: 'Multi-agent Swarm', section: 'agents', component: SwarmView,        phase: 11, paletteHidden: true },
];
