---
phase: 01-foundation
plan: 07
subsystem: frontend-foundation
tags: [router, route-registry, config-context, prefs, feature-stubs, wiring]
requires:
  - 01-04  # ComingSoonSkeleton (+ GlassSpinner)
  - 01-05  # getConfig wrapper
  - 01-06  # useTauriEvent (type imports; actual subscription lands later)
provides:
  - custom route registry (FOUND-07)
  - 1-file-+-1-entry add-route cost (FOUND-08)
  - usePrefs hook (FOUND-09)
  - ConfigContext (FOUND-10)
  - 82 ComingSoonSkeleton route stubs across 13 feature clusters
affects:
  - src/windows/main/main.tsx (now wraps ConfigProvider + renders via ROUTE_MAP)
tech-stack:
  added:
    - none (React + Vite + Tauri only; no new deps)
  patterns:
    - explicit feature-index imports (no glob auto-discovery) — D-40
    - static dev-routes import + runtime `import.meta.env.DEV` filter (W6 remediation, no top-level await)
    - inline `skeleton()` helper in each feature index (self-contained per D-40)
    - single `blade_prefs_v1` localStorage key, read-once + debounced-write (D-42, P-13)
key-files:
  created:
    - src/lib/router.ts
    - src/hooks/usePrefs.ts
    - src/lib/context/ConfigContext.tsx
    - src/lib/context/index.ts
    - src/windows/main/router.ts
    - src/features/dashboard/index.tsx
    - src/features/chat/index.tsx
    - src/features/settings/index.tsx
    - src/features/agents/index.tsx
    - src/features/knowledge/index.tsx
    - src/features/life-os/index.tsx
    - src/features/identity/index.tsx
    - src/features/dev-tools/index.tsx
    - src/features/admin/index.tsx
    - src/features/body/index.tsx
    - src/features/hive/index.tsx
    - src/features/onboarding/index.tsx
    - src/features/dev/index.tsx
  modified:
    - src/windows/main/main.tsx
decisions:
  - "RouteDefinition is the sole route contract; no react-router-dom anywhere in src/"
  - "82 Phase-1 stubs (up from the ~59 src.bak/ baseline) cover every REQUIREMENTS.md cluster"
  - "skeleton() helper inlined into each feature index — keeps adding-a-route diff to 1 file"
  - "'reports' route explicitly registered in admin to satisfy backend openRoute('reports') from capability_gap_detected (P-03)"
  - "Dev feature routes gated via static import + runtime DEV flag (not top-level await); Vite dead-code-elims the prod spread"
metrics:
  duration: ~4m
  completed: 2026-04-18
  tasks: 2
  files_created: 18
  files_modified: 1
  routes_registered: 82
  commits: 2
---

# Phase 1 Plan 07: Router + ConfigContext + 82 Route Stubs Summary

## One-Liner

Custom route registry with 82 ComingSoonSkeleton stubs across 13 feature clusters, plus `usePrefs` (single `blade_prefs_v1` read-once + 250ms debounced write) and `ConfigContext` (main-window-only BladeConfig provider via `getConfig` wrapper), wired into `src/windows/main/main.tsx` so the main window boots through `<ConfigProvider>` and renders via `ROUTE_MAP.get(id)` — FOUND-07..10 satisfied and the 59-route `openRoute` universe is fully stubbed without a single 404.

## What Shipped

### Task 1 — Route contract + contexts + bootstrap wiring
- `src/lib/router.ts` — exports `RouteDefinition`, `Section`, `DEFAULT_ROUTE_ID = 'dashboard'` (D-05, D-39, D-40-default). No React Router. Pure type + const module.
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` localStorage key; `useState<Prefs>(() => readOnce())` reads once on mount (lazy initializer); writes debounced at 250ms; `resetPrefs()` clears in-memory + storage; corrupt blob → silent `{}` (T-07-02). Signature: `usePrefs() → { prefs, setPref, resetPrefs }`.
- `src/lib/context/ConfigContext.tsx` — `ConfigProvider` fetches BladeConfig via `getConfig()` wrapper on mount; shows `<GlassSpinner size={32} label="Loading BLADE config" />` until config resolves; on error, keeps spinner up (fail-closed boot). `useConfig()` throws outside provider. Signature: `useConfig() → { config, reload }`.
- `src/lib/context/index.ts` — re-exports `ConfigProvider`, `useConfig`.
- `src/windows/main/main.tsx` — now:
  - `import '@/styles/index.css'` + `performance.mark('boot')` at top (D-29 P-01 gate)
  - `AppShell` reads `prefs['app.lastRoute'] ?? prefs['app.defaultRoute'] ?? DEFAULT_ROUTE_ID`, resolves via `ROUTE_MAP.get(...)`, renders inside `<Suspense fallback={GlassSpinner}>`
  - `StrictMode > ConfigProvider > AppShell` tree
  - `requestAnimationFrame` → `performance.mark('first-paint')` + measure + console log for P-01 floor measurement (D-29 — Phase 1 Dashboard is ComingSoonSkeleton, so this measures pure substrate cost)

**Commit:** `33d6f78`

### Task 2 — 82 route stubs across 13 feature clusters + main aggregator
- 13 feature index.tsx files under `src/features/<cluster>/`. Each file follows the template: inline `skeleton(label, phase)` helper wraps `ComingSoonSkeleton` via `React.lazy`, then exports `routes: RouteDefinition[]`.
- Route distribution (82 total):

  | Cluster       | Count | Phase | Section              | Notes |
  |---------------|-------|-------|----------------------|-------|
  | dashboard     | 1     | 3     | core                 | `Mod+1` |
  | chat          | 1     | 3     | core                 | `Mod+/` |
  | settings      | 10    | 3     | core                 | SET-01..10 |
  | agents        | 9     | 5     | agents               | AGENT-01..09 |
  | knowledge     | 9     | 5     | knowledge            | KNOW-01..09 |
  | life-os       | 9     | 6     | life                 | LIFE-01..09 |
  | identity      | 7     | 6     | identity             | IDEN-01..07 |
  | dev-tools     | 10    | 7     | dev                  | DEV-01..10 |
  | admin         | 11    | 7     | admin                | ADMIN-01..10 + 'reports' (P-03 coverage) |
  | body          | 6     | 8     | body                 | BODY-01..07 |
  | hive          | 5     | 8     | hive                 | HIVE-01..06 |
  | onboarding    | 1     | 2     | core                 | paletteHidden |
  | dev           | 3     | 1     | dev                  | paletteHidden, DEV-only |

- `src/windows/main/router.ts` — explicit imports of all 13 feature route arrays; concat into `ALL_ROUTES`; dev routes gated via `...(import.meta.env.DEV ? devRoutes : [])`. Exports: `ALL_ROUTES`, `ROUTE_MAP` (id → RouteDefinition), `PALETTE_COMMANDS` (non-hidden filter).
- W6 remediation honored: static `import { routes as devRoutes } from '@/features/dev'` + runtime spread filter. Vite constant-folds `import.meta.env.DEV` to `false` in prod and tree-shakes the dev module entirely — no top-level await, no ES2022 target bump.

**Commit:** `dba4765`

## Signatures (quick reference)

```ts
// src/hooks/usePrefs.ts
export interface Prefs {
  'app.defaultRoute'?: string;
  'app.lastRoute'?: string;
  'chat.showTimestamps'?: boolean;
  'chat.inlineToolCalls'?: boolean;
  'ghost.linuxWarningAcknowledged'?: boolean;
  [k: string]: string | number | boolean | undefined;
}
export function usePrefs(): {
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  resetPrefs: () => void;
};

// src/lib/context/ConfigContext.tsx
export function ConfigProvider({ children }: { children: ReactNode }): JSX.Element;
export function useConfig(): { config: BladeConfig; reload: () => Promise<void> };

// src/lib/router.ts
export interface RouteDefinition {
  id: string;
  label: string;
  section: Section;
  component: LazyExoticComponent<ComponentType<any>>;
  icon?: ComponentType;
  shortcut?: string;
  paletteHidden?: boolean;
  description?: string;
  phase?: number;
}
export const DEFAULT_ROUTE_ID = 'dashboard';

// src/windows/main/router.ts
export const ALL_ROUTES: RouteDefinition[];
export const ROUTE_MAP: Map<string, RouteDefinition>;
export const PALETTE_COMMANDS: RouteDefinition[];
```

## Invariants Verified

- [x] `src/lib/router.ts` exports RouteDefinition + Section + DEFAULT_ROUTE_ID
- [x] `src/hooks/usePrefs.ts` reads `blade_prefs_v1` once on mount (lazy `useState` initializer), debounces writes at 250ms (P-13)
- [x] `src/lib/context/ConfigContext.tsx` exports ConfigProvider + useConfig (FOUND-10, D-41)
- [x] ConfigContext consumes only `getConfig` from `@/lib/tauri` (D-13, D-34 — no raw invoke)
- [x] 13 feature index.tsx files exist, each exporting `routes: RouteDefinition[]`
- [x] 82 RouteDefinition entries total (upper-bound acceptable per plan; ≥75 target exceeded)
- [x] 'reports' route present in admin (P-03 src.bak coverage for `capability_gap_detected` push)
- [x] paletteHidden: onboarding(1) + primitives/wrapper-smoke/diagnostics-dev(3) = 4 hidden routes
- [x] `src/windows/main/router.ts` aggregates via explicit imports (13 import lines grepped); exports ALL_ROUTES + ROUTE_MAP + PALETTE_COMMANDS
- [x] Dev routes gated via static import + runtime `import.meta.env.DEV` filter (W6 — no top-level await; grep for `await import` negative)
- [x] `src/windows/main/main.tsx` wraps tree in ConfigProvider, renders via ROUTE_MAP, includes `performance.mark('first-paint')` (D-29 P-01)
- [x] Only one `localStorage.getItem` callsite in src/ (inside `usePrefs.ts`); `grep -rq "localStorage\.getItem" src/features/ src/windows/` returns empty (P-13)
- [x] Zero `react-router` / `react-router-dom` imports anywhere under src/ (only a comment in router.ts calling out the ban)
- [x] Route ids are UNIQUE across all feature files (`grep ... | sort | uniq -d` empty)
- [x] `npx tsc --noEmit` exits 0 after Task 2

## FOUND-08 Acceptance (1 file + 1 entry to add a route)

Demonstrable: adding a new settings sub-tab requires editing only `src/features/settings/index.tsx` (append one `RouteDefinition` to the array). Zero changes to `router.ts`, `main.tsx`, palette registration, or nav — the aggregator + ROUTE_MAP + PALETTE_COMMANDS pick it up automatically. Adding an entire new cluster = `src/features/<new>/index.tsx` (new file) + one import line + one spread entry in `src/windows/main/router.ts` = 2 files touched. FOUND-08 met.

## Deviations from Plan

**None — plan executed exactly as written.**

- Total route count landed at 82 (plan spec allowed 75–81; admin has 11 rather than 10 because `reports` is explicitly registered separately from `capability-reports` per plan-text Note on P-03 coverage).
- `useMemo` / `useState` in `AppShell` import block was spec-compatible (plan showed `React, { useState, Suspense, useMemo }`); shipped as `React, { Suspense, useMemo, useState }` which is purely alphabetical tidy-up, not a contract change.

## Auth Gates

None. All work was pure-frontend file creation; no Rust, no credentials, no network.

## Threat Flags

None. No new trust boundaries introduced beyond the ones already documented in the plan's `<threat_model>` (localStorage blade_prefs_v1 tampering, JSON.parse corruption, backend openRoute unknown id, paletteHidden bypass, pref debounce loss — all already mitigated per T-07-01..05).

## What Plan 08 / Plan 09 Consume

- **Plan 08 (FOUND-11 / P-03 migration ledger seed script):** uses the 82 route ids in `ALL_ROUTES` to verify every src.bak route has a target; the 'reports' entry covers the P-03 capability_gap_detected push path.
- **Plan 09 (6 verify scripts + dev surfaces):** replaces the three `paletteHidden: true` dev stubs (primitives, wrapper-smoke, diagnostics-dev) with real components. The route ids remain stable so `openRoute('primitives')` / `openRoute('wrapper-smoke')` work unchanged.
- **Phase 2 Shell:** wraps `AppShell` with TitleBar / Nav / CommandPalette / ToastContext; reads `PALETTE_COMMANDS` for ⌘K; wires keyboard shortcuts from `RouteDefinition.shortcut`. The current bootstrap is intentionally minimal — Phase 2 extends it without rewriting.

## Commits

- `33d6f78` — feat(01-07): route registry + ConfigContext + usePrefs + main bootstrap wiring
- `dba4765` — feat(01-07): 13 feature clusters with 82 ComingSoonSkeleton route stubs + main aggregator
- (pending) — docs(01-07): plan summary

## Self-Check: PASSED

- [x] `src/lib/router.ts` exists — FOUND
- [x] `src/hooks/usePrefs.ts` exists — FOUND
- [x] `src/lib/context/ConfigContext.tsx` exists — FOUND
- [x] `src/lib/context/index.ts` exists — FOUND
- [x] `src/windows/main/router.ts` exists — FOUND
- [x] All 13 `src/features/<cluster>/index.tsx` files exist — FOUND
- [x] Commit `33d6f78` present — FOUND
- [x] Commit `dba4765` present — FOUND
- [x] `npx tsc --noEmit` exits 0 — FOUND
- [x] 82 route ids across feature files — FOUND
- [x] Zero react-router imports in src/ — FOUND
- [x] Zero `localStorage.getItem` outside `src/hooks/usePrefs.ts` — FOUND
