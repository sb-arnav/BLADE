// src/windows/main/router.ts — main window route aggregator.
//
// Explicit imports, explicit concat — grep-able, diffable (D-40). No glob /
// filesystem auto-discovery. Adding a new cluster = 1 import line + 1 spread
// entry. Adding a route within an existing cluster = 1 entry in that cluster's
// index.tsx (FOUND-08 acceptance).
//
// Dev-only surfaces (/primitives, /wrapper-smoke, /diagnostics-dev) use a
// STATIC import with a runtime `import.meta.env.DEV` filter (W6 remediation:
// top-level await is unnecessary and pessimizes dev builds). Vite's build-time
// constant folding converts `import.meta.env.DEV` to a literal `false` in prod;
// the spread becomes `...[]` and tree-shaking drops the dev feature module
// entirely from the prod bundle.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40, §D-40-palette
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
  ...(import.meta.env.DEV ? devRoutes : []),
];

/** Route id → RouteDefinition lookup. ROUTE_MAP.get(id) is the sole resolver. */
export const ROUTE_MAP = new Map(ALL_ROUTES.map(r => [r.id, r]));

/** Routes that surface in the ⌘K palette (paletteHidden filtered out). */
export const PALETTE_COMMANDS: RouteDefinition[] = ALL_ROUTES.filter(r => !r.paletteHidden);
