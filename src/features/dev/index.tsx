// src/features/dev/index.tsx — DEV-only surfaces (3 routes, palette-hidden).
//
// Phase 1 initial wiring: all three stubs point to ComingSoonSkeleton. Plan 09
// REPLACES these with real components:
//   - primitives      → src/features/dev/Primitives.tsx (design-system showcase)
//   - wrapper-smoke   → src/features/dev/WrapperSmoke.tsx (P-04 harness)
//   - diagnostics-dev → src/features/dev/Diagnostics.tsx (listener counter + perf)
//
// Aggregator at src/windows/main/router.ts gates this entire module on
// import.meta.env.DEV (W6 remediation: static import + runtime filter; Vite
// constant-folds in prod → tree-shaken).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-21, §D-30, §D-40-palette

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
    id: 'primitives',
    label: 'Primitives Showcase',
    section: 'dev',
    component: skeleton('Primitives', 1),
    phase: 1,
    paletteHidden: true,
    description: 'DEV: design-system palette',
  },
  {
    id: 'wrapper-smoke',
    label: 'Wrapper Smoke',
    section: 'dev',
    component: skeleton('Wrapper Smoke', 1),
    phase: 1,
    paletteHidden: true,
    description: 'DEV: invokeTyped P-04 harness',
  },
  {
    id: 'diagnostics-dev',
    label: 'Diagnostics (dev)',
    section: 'dev',
    component: skeleton('Diagnostics (dev)', 1),
    phase: 1,
    paletteHidden: true,
    description: 'DEV: listener counter + perf marks',
  },
];
