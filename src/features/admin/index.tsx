// src/features/admin/index.tsx — Admin cluster (11 routes, Phase 7).
// Phase 1 stubs per ADMIN-01..10 + 'reports' (P-03 src.bak coverage for
// backend-pushed capability_gap_detected → openRoute('reports')).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §ADMIN-01..10
// @see .planning/research/PITFALLS.md §P-03

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'analytics',          label: 'Analytics',          section: 'admin', component: skeleton('Analytics', 7),          phase: 7 },
  { id: 'capability-reports', label: 'Capability Reports', section: 'admin', component: skeleton('Capability Reports', 7), phase: 7 },
  { id: 'reports',            label: 'Reports',            section: 'admin', component: skeleton('Reports', 7),            phase: 7, description: 'Backend openRoute target for capability_gap_detected' },
  { id: 'decision-log',       label: 'Decision Log',       section: 'admin', component: skeleton('Decision Log', 7),       phase: 7 },
  { id: 'security-dashboard', label: 'Security',           section: 'admin', component: skeleton('Security', 7),           phase: 7 },
  { id: 'temporal',           label: 'Temporal',           section: 'admin', component: skeleton('Temporal', 7),           phase: 7 },
  { id: 'diagnostics',        label: 'Diagnostics',        section: 'admin', component: skeleton('Diagnostics', 7),        phase: 7 },
  { id: 'integration-status', label: 'Integration Status', section: 'admin', component: skeleton('Integration Status', 7), phase: 7 },
  { id: 'mcp-settings',       label: 'MCP Servers',        section: 'admin', component: skeleton('MCP Servers', 7),        phase: 7 },
  { id: 'model-comparison',   label: 'Model Comparison',   section: 'admin', component: skeleton('Model Comparison', 7),   phase: 7 },
  { id: 'key-vault',          label: 'Key Vault',          section: 'admin', component: skeleton('Key Vault', 7),          phase: 7 },
];
