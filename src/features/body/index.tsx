// src/features/body/index.tsx — Body Visualization cluster (6 routes, Phase 8).
// Plan 08-02 replaces Phase 1 ComingSoonSkeleton stubs with lazy imports of
// per-route components. Plan 08-02 is the SINGLE writer of this file (D-199);
// Plan 08-03 fills in each per-route component body without editing this file.
//
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-199, §D-210
// @see .planning/phases/08-body-hive/08-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §BODY-01..07

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const BodyMap          = lazy(() => import('./BodyMap').then((m) => ({ default: m.BodyMap })));
const BodySystemDetail = lazy(() => import('./BodySystemDetail').then((m) => ({ default: m.BodySystemDetail })));
const HormoneBus       = lazy(() => import('./HormoneBus').then((m) => ({ default: m.HormoneBus })));
const OrganRegistry    = lazy(() => import('./OrganRegistry').then((m) => ({ default: m.OrganRegistry })));
const DNA              = lazy(() => import('./DNA').then((m) => ({ default: m.DNA })));
const WorldModel       = lazy(() => import('./WorldModel').then((m) => ({ default: m.WorldModel })));

export const routes: RouteDefinition[] = [
  { id: 'body-map',           label: 'Body Map',           section: 'body', component: BodyMap,          phase: 8 },
  { id: 'body-system-detail', label: 'Body System Detail', section: 'body', component: BodySystemDetail, phase: 8 },
  { id: 'hormone-bus',        label: 'Hormone Bus',        section: 'body', component: HormoneBus,       phase: 8 },
  { id: 'organ-registry',     label: 'Organ Registry',     section: 'body', component: OrganRegistry,    phase: 8 },
  { id: 'dna',                label: 'DNA',                section: 'body', component: DNA,              phase: 8 },
  { id: 'world-model',        label: 'World Model',        section: 'body', component: WorldModel,       phase: 8 },
];
