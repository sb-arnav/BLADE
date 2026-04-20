// src/windows/main/router.ts — main window route aggregator.
//
// Explicit imports, explicit concat — grep-able, diffable (D-40). No glob /
// filesystem auto-discovery. Adding a new cluster = 1 import line + 1 spread
// entry. Adding a route within an existing cluster = 1 entry in that cluster's
// index.tsx (FOUND-08 acceptance).
//
// Dev-only surfaces use a STATIC import with a runtime `import.meta.env.DEV`
// filter (W6 remediation: top-level await is unnecessary and pessimizes dev
// builds). Vite's build-time constant folding converts `import.meta.env.DEV` to
// a literal `false` in prod; the spread becomes `...[]` and tree-shaking drops
// the dev feature module entirely from the prod bundle.
//
// Registered dev route ids (all gated on import.meta.env.DEV via the
// `devRoutes` spread below; definitions live in src/features/dev/index.tsx):
//   - primitives           (Phase 1)
//   - wrapper-smoke        (Phase 1)
//   - diagnostics-dev      (Phase 1)
//   - dev-voice-orb        (Phase 4 Plan 04-07 — SC-2 isolation)
//   - dev-ghost            (Phase 4 Plan 04-07 — SC-3 / D-10 isolation)
//   - dev-hud              (Phase 4 Plan 04-07 — SC-4 isolation)
//   - dev-agent-detail     (Phase 5 Plan 05-07 — SC-2 real-time timeline)
//   - dev-swarm-view       (Phase 5 Plan 05-07 — SC-1 DAG render)
//   - dev-knowledge-base   (Phase 5 Plan 05-07 — SC-4 D-138 grouped search)
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40, §D-40-palette
// @see .planning/phases/04-overlay-windows/04-07-PLAN.md (dev-voice-orb, dev-ghost, dev-hud)
// @see .planning/research/ARCHITECTURE.md §"route registry + aggregator"

import type { RouteDefinition } from '@/lib/router';

import { routes as dashboardRoutes }  from '@/features/dashboard';
import { routes as chatRoutes }       from '@/features/chat';
import { routes as settingsRoutes }   from '@/features/settings';
import { routes as agentRoutes }      from '@/features/agents';
import { routes as knowledgeRoutes }  from '@/features/knowledge';
import { routes as lifeOsRoutes }     from '@/features/life-os';
import { routes as identityRoutes }   from '@/features/identity';
import { routes as devToolsRoutes }   from '@/features/dev-tools';
import { routes as adminRoutes }      from '@/features/admin';
import { routes as bodyRoutes }       from '@/features/body';
import { routes as hiveRoutes }       from '@/features/hive';
import { routes as onboardingRoutes } from '@/features/onboarding';
// Phase 11 Plan 11-05 — capability-gap consumer surfaces reachable via
// openRoute('voice-orb'|'meeting-ghost'|'quickask'). These are main-window
// gate views that pair with overlay-window implementations elsewhere.
import { routes as voiceOrbRoutes }   from '@/features/voice-orb';
import { routes as ghostRoutes }      from '@/features/ghost';
import { routes as quickaskRoutes }   from '@/features/quickask';
import { routes as devRoutes }        from '@/features/dev';

export const ALL_ROUTES: RouteDefinition[] = [
  ...dashboardRoutes,
  ...chatRoutes,
  ...settingsRoutes,
  ...agentRoutes,
  ...knowledgeRoutes,
  ...lifeOsRoutes,
  ...identityRoutes,
  ...devToolsRoutes,
  ...adminRoutes,
  ...bodyRoutes,
  ...hiveRoutes,
  ...onboardingRoutes,
  ...voiceOrbRoutes,
  ...ghostRoutes,
  ...quickaskRoutes,
  ...(import.meta.env.DEV ? devRoutes : []),
];

/** Route id → RouteDefinition lookup. ROUTE_MAP.get(id) is the sole resolver. */
export const ROUTE_MAP = new Map(ALL_ROUTES.map(r => [r.id, r]));

/** Routes that surface in the ⌘K palette (paletteHidden filtered out). */
export const PALETTE_COMMANDS: RouteDefinition[] = ALL_ROUTES.filter(r => !r.paletteHidden);
