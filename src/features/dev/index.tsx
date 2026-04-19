// src/features/dev/index.tsx — DEV-only surfaces (9 routes, palette-hidden).
//
// Phase 1 wiring: real components. Aggregator at src/windows/main/router.ts
// gates this entire module on import.meta.env.DEV (W6 remediation: static
// import + runtime filter; Vite constant-folds in prod → tree-shaken).
//
//   - primitives      → ./Primitives (design-system showcase, P-08 surface)
//   - wrapper-smoke   → ./WrapperSmoke (P-04 harness)
//   - diagnostics-dev → ./Diagnostics (listener counter + perf marks, P-01/P-06)
//
// Phase 4 Plan 04-07 adds 3 more isolation routes so Playwright specs can
// mount Phase 4 windows inside the main webview without spinning up the real
// Tauri overlay/hud/ghost windows:
//   - dev-voice-orb   → ./VoiceOrbDev  (SC-2 phase transitions falsifier)
//   - dev-ghost       → ./GhostDev     (SC-3 + D-10 headline falsifier)
//   - dev-hud         → ./HudDev       (SC-4 render + right-click menu falsifier)
//
// Phase 5 Plan 05-07 adds 3 more isolation routes for the agents + knowledge
// Playwright specs (no backend state required — test shim mocks invokes):
//   - dev-agent-detail   → ./AgentDetailDev   (SC-2 real-time timeline + WIRE-05)
//   - dev-swarm-view     → ./SwarmViewDev     (SC-1 explicit DAG render)
//   - dev-knowledge-base → ./KnowledgeBaseDev (SC-4 D-138 grouped search)
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-21, §D-30, §D-40-palette
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md Sub-task 1f
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 1

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
const VoiceOrbDev = lazy(() =>
  import('./VoiceOrbDev').then((m) => ({ default: m.VoiceOrbDev })),
);
const GhostDev = lazy(() =>
  import('./GhostDev').then((m) => ({ default: m.GhostDev })),
);
const HudDev = lazy(() =>
  import('./HudDev').then((m) => ({ default: m.HudDev })),
);
const AgentDetailDev = lazy(() =>
  import('./AgentDetailDev').then((m) => ({ default: m.AgentDetailDev })),
);
const SwarmViewDev = lazy(() =>
  import('./SwarmViewDev').then((m) => ({ default: m.SwarmViewDev })),
);
const KnowledgeBaseDev = lazy(() =>
  import('./KnowledgeBaseDev').then((m) => ({ default: m.KnowledgeBaseDev })),
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
  {
    id: 'dev-voice-orb',
    label: 'DEV: Voice Orb',
    section: 'dev',
    component: VoiceOrbDev,
    phase: 4,
    paletteHidden: true,
    description: 'DEV: Voice Orb isolation (SC-2 phase transitions)',
  },
  {
    id: 'dev-ghost',
    label: 'DEV: Ghost',
    section: 'dev',
    component: GhostDev,
    phase: 4,
    paletteHidden: true,
    description: 'DEV: Ghost overlay isolation (SC-3 + D-10 headline)',
  },
  {
    id: 'dev-hud',
    label: 'DEV: HUD',
    section: 'dev',
    component: HudDev,
    phase: 4,
    paletteHidden: true,
    description: 'DEV: HUD bar isolation (SC-4 render + menu)',
  },
  {
    id: 'dev-agent-detail',
    label: 'DEV: AgentDetail',
    section: 'dev',
    component: AgentDetailDev,
    phase: 5,
    paletteHidden: true,
    description: 'DEV: AgentDetail isolation (SC-2 real-time timeline, WIRE-05)',
  },
  {
    id: 'dev-swarm-view',
    label: 'DEV: SwarmView',
    section: 'dev',
    component: SwarmViewDev,
    phase: 5,
    paletteHidden: true,
    description: 'DEV: SwarmView isolation (SC-1 explicit DAG render)',
  },
  {
    id: 'dev-knowledge-base',
    label: 'DEV: KnowledgeBase',
    section: 'dev',
    component: KnowledgeBaseDev,
    phase: 5,
    paletteHidden: true,
    description: 'DEV: KnowledgeBase isolation (SC-4 D-138 grouped search)',
  },
];
