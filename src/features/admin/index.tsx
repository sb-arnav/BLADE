// src/features/admin/index.tsx — Phase 7 rewrite (Plan 07-02, D-170 single-writer)
// 10 ADMIN requirements + 1 synthetic `reports` route (P-03 src.bak coverage
// for backend-pushed capability_gap_detected → openRoute('reports')).
// Plans 07-05 and 07-06 REPLACE the placeholder bodies with real feature UIs.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-170
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §ADMIN-01..10
// @see .planning/research/PITFALLS.md §P-03

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const Analytics         = lazy(() => import('./Analytics').then((m) => ({ default: m.Analytics })));
const CapabilityReports = lazy(() => import('./CapabilityReports').then((m) => ({ default: m.CapabilityReports })));
const Reports           = lazy(() => import('./Reports').then((m) => ({ default: m.Reports })));
const DecisionLog       = lazy(() => import('./DecisionLog').then((m) => ({ default: m.DecisionLog })));
const SecurityDashboard = lazy(() => import('./SecurityDashboard').then((m) => ({ default: m.SecurityDashboard })));
const Temporal          = lazy(() => import('./Temporal').then((m) => ({ default: m.Temporal })));
const Diagnostics       = lazy(() => import('./Diagnostics').then((m) => ({ default: m.Diagnostics })));
const IntegrationStatus = lazy(() => import('./IntegrationStatus').then((m) => ({ default: m.IntegrationStatus })));
const McpSettings       = lazy(() => import('./McpSettings').then((m) => ({ default: m.McpSettings })));
const ModelComparison   = lazy(() => import('./ModelComparison').then((m) => ({ default: m.ModelComparison })));
const KeyVault          = lazy(() => import('./KeyVault').then((m) => ({ default: m.KeyVault })));

export const routes: RouteDefinition[] = [
  { id: 'analytics',          label: 'Analytics',          section: 'admin', component: Analytics,         phase: 7 },
  { id: 'capability-reports', label: 'Capability Reports', section: 'admin', component: CapabilityReports, phase: 7 },
  { id: 'reports',            label: 'Reports',            section: 'admin', component: Reports,           phase: 7, description: 'Backend openRoute target for capability_gap_detected' },
  { id: 'decision-log',       label: 'Decision Log',       section: 'admin', component: DecisionLog,       phase: 7 },
  { id: 'security-dashboard', label: 'Security',           section: 'admin', component: SecurityDashboard, phase: 7 },
  { id: 'temporal',           label: 'Temporal',           section: 'admin', component: Temporal,          phase: 7 },
  { id: 'diagnostics',        label: 'Diagnostics',        section: 'admin', component: Diagnostics,       phase: 7 },
  { id: 'integration-status', label: 'Integration Status', section: 'admin', component: IntegrationStatus, phase: 7 },
  { id: 'mcp-settings',       label: 'MCP Servers',        section: 'admin', component: McpSettings,       phase: 7 },
  { id: 'model-comparison',   label: 'Model Comparison',   section: 'admin', component: ModelComparison,   phase: 7 },
  { id: 'key-vault',          label: 'Key Vault',          section: 'admin', component: KeyVault,          phase: 7 },
];
