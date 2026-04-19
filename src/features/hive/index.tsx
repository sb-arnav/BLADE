// src/features/hive/index.tsx — Hive Mesh cluster (5 routes, Phase 8).
// Plan 08-02 replaces Phase 1 ComingSoonSkeleton stubs with lazy imports of
// per-route components. Plan 08-02 is the SINGLE writer of this file (D-199);
// Plan 08-04 fills in each per-route component body without editing this file.
//
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-199, §D-210
// @see .planning/phases/08-body-hive/08-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §HIVE-01..06

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const HiveMesh         = lazy(() => import('./HiveMesh').then((m) => ({ default: m.HiveMesh })));
const TentacleDetail   = lazy(() => import('./TentacleDetail').then((m) => ({ default: m.TentacleDetail })));
const AutonomyControls = lazy(() => import('./AutonomyControls').then((m) => ({ default: m.AutonomyControls })));
const ApprovalQueue    = lazy(() => import('./ApprovalQueue').then((m) => ({ default: m.ApprovalQueue })));
const AiDelegate       = lazy(() => import('./AiDelegate').then((m) => ({ default: m.AiDelegate })));

export const routes: RouteDefinition[] = [
  { id: 'hive-mesh',           label: 'Hive',              section: 'hive', component: HiveMesh,         phase: 8, description: 'All tentacles overview' },
  { id: 'hive-tentacle',       label: 'Tentacle Detail',   section: 'hive', component: TentacleDetail,   phase: 8 },
  { id: 'hive-autonomy',       label: 'Autonomy Controls', section: 'hive', component: AutonomyControls, phase: 8 },
  { id: 'hive-approval-queue', label: 'Approval Queue',    section: 'hive', component: ApprovalQueue,    phase: 8 },
  { id: 'hive-ai-delegate',    label: 'AI Delegate',       section: 'hive', component: AiDelegate,       phase: 8 },
];
