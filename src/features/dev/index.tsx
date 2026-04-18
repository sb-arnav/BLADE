// src/features/dev/index.tsx — DEV-only surfaces (3 routes, palette-hidden).
//
// Phase 1 final wiring: real components. Aggregator at src/windows/main/router.ts
// gates this entire module on import.meta.env.DEV (W6 remediation: static
// import + runtime filter; Vite constant-folds in prod → tree-shaken).
//
//   - primitives      → ./Primitives (design-system showcase, P-08 surface)
//   - wrapper-smoke   → ./WrapperSmoke (P-04 harness)
//   - diagnostics-dev → ./Diagnostics (listener counter + perf marks, P-01/P-06)
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-21, §D-30, §D-40-palette

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const Primitives = lazy(() =>
  import('./Primitives').then((m) => ({ default: m.Primitives })),
);
const WrapperSmoke = lazy(() =>
  import('./WrapperSmoke').then((m) => ({ default: m.WrapperSmoke })),
);
const Diagnostics = lazy(() =>
  import('./Diagnostics').then((m) => ({ default: m.Diagnostics })),
);

export const routes: RouteDefinition[] = [
  {
    id: 'primitives',
    label: 'Primitives Showcase',
    section: 'dev',
    component: Primitives,
    phase: 1,
    paletteHidden: true,
    description: 'DEV: design-system palette (P-08 eyeball surface)',
  },
  {
    id: 'wrapper-smoke',
    label: 'Wrapper Smoke',
    section: 'dev',
    component: WrapperSmoke,
    phase: 1,
    paletteHidden: true,
    description: 'DEV: P-04 invokeTyped harness',
  },
  {
    id: 'diagnostics-dev',
    label: 'Diagnostics (dev)',
    section: 'dev',
    component: Diagnostics,
    phase: 1,
    paletteHidden: true,
    description: 'DEV: listener counter + perf marks (P-01, P-06)',
  },
];
