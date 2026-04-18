// src/features/onboarding/index.tsx — Onboarding (1 route, Phase 2).
// Palette-hidden per D-40-palette (first-run surface, not user-navigable).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40-palette
// @see .planning/REQUIREMENTS.md §ONBD-01..06

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  {
    id: 'onboarding',
    label: 'Onboarding',
    section: 'core',
    component: skeleton('Onboarding', 2),
    phase: 2,
    paletteHidden: true,
    description: 'First-run flow',
  },
];
