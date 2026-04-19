---
phase: 08-body-hive
plan: 03
subsystem: body-cluster-ui
tags: [body, ui, routes, phase-8, sc-1, sc-2]
dependency_graph:
  requires:
    - src/lib/tauri/body.ts (Plan 08-02 — 22 wrappers across 10 Rust modules)
    - src/lib/tauri/homeostasis.ts (Phase 3 + Plan 08-02 — 4 wrappers incl. homeostasisRelearnCircadian)
    - src/lib/tauri/admin.ts (Phase 7 — supervisorGetHealth cross-cluster read)
    - src/types/hormones.ts (Phase 3 — 10-field HormoneState + ModuleDirective)
    - src/lib/events/index.ts (Phase 1/7/8 — HORMONE_UPDATE, WORLD_STATE_UPDATED)
    - src/hooks/usePrefs.ts (body.activeSystem + body.dna.activeDoc from Plan 08-01)
    - src/design-system/primitives/* (Button, Dialog, GlassPanel, GlassSpinner, Input, Pill)
    - src/windows/main/useRouter.ts (useRouterCtx + openRoute for SC-1 drill-in)
  provides:
    - "BodyMap (BODY-01, SC-1) — responsive 12-card grid from bodyGetSummary; card click persists prefs.body.activeSystem and openRoute('body-system-detail')"
    - "BodySystemDetail (BODY-02) — prefs-driven system read via bodyGetSystem; 3 tabs (Modules/Vitals/Events); Vitals branches cardiovascular/immune/urinary/identity/skeleton; cardio cross-imports supervisorGetHealth"
    - "HormoneBus (BODY-03, SC-2) — 10 hormone bar meters + HORMONE_UPDATE live sub; dominant-hormone chip; 24-bar circadian with current-hour highlight; Dialog-gated homeostasisRelearnCircadian; module-directive lookup"
    - "OrganRegistry (BODY-04) — organGetRegistry list with expandable rows; per-capability autonomy slider (0-5); level >= 4 Dialog-gated organSetAutonomy; View-roster Dialog via organGetRoster"
    - "DNA (BODY-05) — 4 pill tabs persisted via prefs.body.dna.activeDoc; Identity edit copies to clipboard (honest deferral); Query tab calls dnaQuery"
    - "WorldModel (BODY-06) — worldGetState hero (workspace/window/network + CPU/RAM/disk bars); 5 tabs (Git/Processes/Ports/File changes/Todos); WORLD_STATE_UPDATED live refresh; Refresh + Summary buttons"
  affects:
    - Plan 08-05 Playwright specs — data-testid roots preserved from Plan 08-02 seeds; body-map-root, body-system-detail-root, hormone-bus-root, organ-registry-root, dna-root, world-model-root all retained verbatim
    - ROADMAP Phase 8 SC-1 (BodyMap interactive) — falsifiable via bodyGetSummary cards + openRoute handoff
    - ROADMAP Phase 8 SC-2 (hormone dashboard live) — falsifiable via 10-row meter grid + HORMONE_UPDATE sub
tech-stack:
  added: []
  patterns:
    - "D-201 12-card responsive grid: grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) with cards as <button>, keyboard-a11y focus ring via --status-running"
    - "D-202 system branching: BodySystemDetail Vitals tab switch on activeSystem with honest empty state for systems lacking drill-in"
    - "D-203 HormoneBus recipe from 08-PATTERNS §3: HORMONES array = 10 hormones (arousal/energy_mode/exploration/trust/urgency/hunger/thirst/insulin/adrenaline/leptin) with accent classes driven by status tokens; 24-bar circadian via CSS flex + height: {value*100}%"
    - "D-204 Dialog-gated destructive ops: organ_set_autonomy level >= 4, homeostasis_relearn_circadian, reproductive_spawn, urinary_flush"
    - "D-196 last bullet cross-cluster read: supervisorGetHealth imported from @/lib/tauri/admin (Phase 7) with soft-fail (.catch(() => null)) so body cluster stays resilient"
    - "06-PATTERNS §3 tabbed surface: role=tablist + role=tab + aria-selected + data-active; persistence via prefs for DNA (body.dna.activeDoc); local state for BodySystemDetail (intentional — transient nav state) and WorldModel (intentional — no pref defined in Plan 08-01)"
    - "08-PATTERNS §9 CSS: @layer features-body scoping preserved; all values resolve to Phase 1 tokens (--glass-*-bg, --status-*, --space-*, --radius-*, --font-mono); only non-token color is rgba(239, 68, 68, 0.08) for error panels (inherits Phase 7 D-183)"
    - "Event handler pattern: useTauriEvent with inline arrow closures — safe under the handler-in-ref pattern from src/lib/events/index.ts:225 (P-06 prevention)"
key-files:
  created: []
  modified:
    - src/features/body/BodyMap.tsx (~170 lines; placeholder replaced with live summary grid + drill-in handler)
    - src/features/body/BodySystemDetail.tsx (~720 lines; placeholder replaced with tabs + 4 vitals branches + events table)
    - src/features/body/HormoneBus.tsx (~315 lines; placeholder replaced with 10-meter grid + circadian + directive lookup + relearn Dialog)
    - src/features/body/OrganRegistry.tsx (~340 lines; placeholder replaced with expandable rows + autonomy sliders + roster Dialog)
    - src/features/body/DNA.tsx (~300 lines; placeholder replaced with 4-tab surface + Identity edit-via-clipboard + dnaQuery)
    - src/features/body/WorldModel.tsx (~395 lines; placeholder replaced with hero + 5 tabs + live refresh + Summary Dialog)
    - src/features/body/body.css (+810 lines net; adds surfaces, tabs, hormone grid, organ list, dna pre/textarea, world hero/tabs/tables)
decisions:
  - "BodyMap refresh button exposed explicitly so operators can re-trigger bodyGetSummary + bodyGetMap without router navigation — helpful during Mac session M-35 verification when the registry is still warming up after boot."
  - "Used Pill tones for organ health as the closest available semantic mapping (free=active, new=error, pro=disconnected, default=dormant) since Pill doesn't expose a 'status' tone variant; status-* CSS classes are separately available for any future richer chip — for now Pill tones keep the primitive surface in use (D-20 preserved)."
  - "BodySystemDetail Vitals 'cardiovascular' branch calls supervisorGetHealth() with a soft-fail (.catch(() => null)) because the admin command can fail independently of body cluster readiness — failing hard would take down the cardiovascular vitals panel. Error is surfaced inline as 'Supervisor read unavailable'."
  - "urinaryFlush is Dialog-gated even though the plan left it optional — Rust doc string explicitly calls the op destructive (invalidates cache/state). Added inline dialog + confirm/cancel buttons consistent with other destructive surfaces."
  - "reproductive_spawn signature is {agentType, task, workingDir?} as shipped by Plan 08-02 (corrected from the pattern-file example which had {agentType, initialTask?}). Dialog collects agentType + task; workingDir omitted from V1 (Phase 9 polish could add an optional path chooser)."
  - "HormoneBus dominant-hormone chip rendered with Pill tone='new' (warm accent) rather than a bespoke token — consistent with how other badges signal 'attention worth drawing' across Phase 5/6/7."
  - "HormoneBus uses inline arrow handler for useTauriEvent(HORMONE_UPDATE, (e) => setState(e.payload)). The handler-in-ref pattern in src/lib/events/index.ts ensures subscribing once per mount, so inline closures don't cause listener leaks (P-06 prevention)."
  - "DNA Identity tab renders 'Copy proposed edits' + 'Cancel'; no 'Save' button because no backend write exists. The honest-deferral card is part of the tab, not a modal — keeps the gap visible instead of hidden."
  - "WorldModel 'tab' state is local (not persisted) because the plan never declared a prefs key for it — and the routes list feels transient enough that remembering the last tab across navigations would be more surprising than refreshing to Git each visit. If needed, a later polish can wire a 'world.activeTab' pref."
  - "WorldModel event subscription refetches worldGetState rather than using the WorldStateUpdatedPayload directly — the payload is only the summary string, so a full snapshot needs a second roundtrip. Tolerable because the emit cadence is background-scheduled (~15s), not high-frequency."
metrics:
  duration_seconds: 780
  tasks_completed: 3
  files_changed: 7
  lines_added: 2997
  lines_removed: 48
  completed_date: 2026-04-18
---

# Phase 8 Plan 08-03: Body Cluster UI — Summary

Ships the 6 Body routes (BodyMap, BodySystemDetail, HormoneBus, OrganRegistry,
DNA, WorldModel) with live Tauri wiring on top of the Plan 08-02 wrapper +
placeholder surface. Every route now renders real data; the two ROADMAP
falsifiers (SC-1 BodyMap drill-in + SC-2 hormone dashboard live) are
observable in dev. Zero Rust changes (D-196). Zero touches to `src/lib/tauri/*`
wrapper files (Plan 08-02 shipped them all). Zero file conflicts with the
08-04 Hive cluster running in parallel.

## Objective Delivered

- **BODY-01 / SC-1:** `BodyMap` renders `bodyGetSummary()` as a responsive
  card grid (Phase 1 token-driven glass cards, 220px minmax, `@layer
  features-body`). Each card is a real `<button>` with focus ring via
  `--status-running`, `data-testid="body-system-card-{system}"`, up to 3
  module names previewed from `bodyGetMap()`. Click fires
  `setPref('body.activeSystem', system)` + `router.openRoute('body-system-detail')` —
  the exact handoff the Plan 08-05 Playwright spec will assert.
- **BODY-02:** `BodySystemDetail` reads `prefs['body.activeSystem']` (default
  `'nervous'`), fetches `bodyGetSystem(system)`, renders 3 tabs
  (`role="tablist"` + `aria-selected`) — **Modules** (list with per-row
  `data-testid="module-row-{mod}"`), **Vitals** (system-specific drill-in),
  **Events** (`cardioGetEventRegistry` table for cardiovascular, empty state
  elsewhere). Vitals branches:
  - `cardiovascular` → `cardioGetBloodPressure` + `bladeVitalSigns` +
    cross-cluster `supervisorGetHealth()` (`.catch(() => null)` soft-fail).
  - `immune` / `urinary` → `immuneGetStatus` + Dialog-gated `urinaryFlush`.
  - `identity` → `reproductiveGetDna` card + Dialog-gated `reproductiveSpawn`
    (agent type + task inputs).
  - `skeleton` → `jointsListProviders` + `jointsListStores` as Pill chips.
  - Other systems → honest "No per-system vitals available" empty state.
- **BODY-03 / SC-2:** `HormoneBus` renders 10 hormone bar meters
  (`data-testid="hormone-row-{key}"`) from `homeostasisGet()` with 5-accent
  color mapping via Phase 1 status tokens. `useTauriEvent(HORMONE_UPDATE)`
  pushes live updates (WIRE-02 live). Dominant-hormone Pill chip
  (`data-testid="hormone-dominant"`) recomputes on every render. 24-bar
  circadian grid (`data-testid="circadian-grid"`) renders
  `homeostasisGetCircadian()` with the current hour highlighted via
  `.current-hour` class. Module-directive lookup (`homeostasisGetDirective`)
  renders as a JSON-style table. "Relearn circadian" button opens Dialog
  before calling `homeostasisRelearnCircadian()`.
- **BODY-04:** `OrganRegistry` renders `organGetRegistry()` as expandable
  list. Each row (`data-testid="organ-row-{name}"`) shows name + health
  Pill + summary + observations count + capabilities count; expand reveals
  recent observations + capabilities table. Per-capability autonomy slider
  (0-5, integer step) with guarded write: level ≥ 4 opens a confirm Dialog
  before `organSetAutonomy`. "View roster" button opens Dialog with
  `organGetRoster()` in a `<pre>`.
- **BODY-05:** `DNA` shows 4 pill tabs (Identity/Goals/Patterns/Query)
  persisted via `prefs['body.dna.activeDoc']` (default 'identity'). Identity
  tab renders `dnaGetIdentity()` in a `<pre>`; "Edit" opens a textarea with
  "Copy proposed edits" → `navigator.clipboard.writeText` + toast; an honest-
  deferral `GlassPanel` explains why direct write is deferred to Phase 9.
  Goals + Patterns render `dnaGetGoals()` / `dnaGetPatterns()` verbatim.
  Query tab = `<Input>` + "Ask" button (or Enter) → `dnaQuery({ query })`
  → result rendered inside a `GlassPanel`.
- **BODY-06:** `WorldModel` renders `worldGetState()` with a hero section
  (6 cards: workspace_cwd, active_window, network_activity, CPU cores, RAM
  used/total with progress bar, disk free with progress bar). 5 pill tabs
  (Git / Processes / Ports / File changes / Todos) rendered as monospace
  `world-table` rows. `useTauriEvent(WORLD_STATE_UPDATED)` triggers
  `worldGetState().then(setState)` (payload is summary-only; full state
  re-fetch is intentional). Refresh button calls `worldRefresh()`; Summary
  button opens Dialog with `worldGetSummary()` in `<pre>`.
- **BODY-07 (wiring/coverage):** satisfied collectively by this plan +
  Plan 08-02's `body.ts` wrapper. Every cluster Rust command is called by
  at least one route; cross-cluster reads (`supervisorGetHealth`) are
  flagged in code comments per D-196.

## Requirements — Status

| ID      | Description                                                        | Plan 08-03 contribution                                                                                  |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| BODY-01 | BodyMap — 12 system cards + drill-in (SC-1)                        | **Shipped** — responsive grid + card click handler + openRoute(body-system-detail) + prefs handoff.      |
| BODY-02 | BodySystemDetail — modules list + per-system drill-ins             | **Shipped** — Modules/Vitals/Events tabs with cardio/urinary/identity/skeleton vitals branches.          |
| BODY-03 | HormoneBus — 10 hormones + circadian + live update (SC-2)          | **Shipped** — 10-row meter grid + HORMONE_UPDATE sub + 24-bar circadian + relearn Dialog + directive UI. |
| BODY-04 | OrganRegistry — list + autonomy controls                           | **Shipped** — expandable list + per-capability autonomy slider + Dialog-gate for level >= 4 + roster.    |
| BODY-05 | DNA — Identity/Goals/Patterns/Query                                | **Shipped** — 4 pill tabs + prefs persistence + clipboard-based identity edit + dnaQuery surface.        |
| BODY-06 | WorldModel — world state tabs + live refresh                       | **Shipped** — hero + 5 tabs + WORLD_STATE_UPDATED sub + Refresh + Summary Dialog.                        |
| BODY-07 | Body cluster wiring (coverage)                                     | **Satisfied collectively** — all routes import body.ts wrappers + cross-cluster admin.ts (D-196).        |

## Task Breakdown

### Task 1 — BodyMap + BodySystemDetail (commit 01a8aa3)

Replaced both Plan 08-02 placeholders with live wiring:

- **BodyMap.tsx** (~170 lines): hero + header with Refresh button;
  `bodyGetSummary()` + `bodyGetMap()` parallel-fetched on mount;
  summary sum computed client-side for "12 body systems · N modules";
  preview map (Map<string, string[]>) derived from bodyGetMap()
  per-system (up to 3 names). Click handler sets pref + navigates.
- **BodySystemDetail.tsx** (~720 lines): prefs-driven system read;
  3 tab state machine; 4 vitals components (CardioVitals, UrinaryImmuneVitals,
  IdentityVitals, SkeletonVitals) + EventsTab; DialogS for flush + spawn.
- **body.css** (+~300 lines): body-map-surface, body-map-header,
  body-system-card (button-based with focus ring), body-system-detail-tabs,
  body-module-list/row, body-vitals-grid/card/stats/services/chips,
  body-events-table, body-dialog-label/actions.

Verify: `npx tsc --noEmit` clean.

### Task 2 — HormoneBus + OrganRegistry + DNA (commit 0fcd2da)

- **HormoneBus.tsx** (~315 lines): 10 hormones in a typed array (keys
  match `HormoneState` exactly — verified against `src/types/hormones.ts`);
  clampValue helper for 0-1 normalization; dominant-hormone useMemo;
  24-bar circadian grid with current-hour class; directive lookup via
  Input + Button + result table (rendering `ModuleDirective` fields
  `model_tier` / `poll_rate` / `allow_expensive_ops` / `autonomous` /
  `reason`); Dialog-gated relearn.
- **OrganRegistry.tsx** (~340 lines): list with `expanded` Set<string>
  state; per-capability slider bound to a local `Map<string, number>`
  keyed by `${organ}::${action}` for immediate UI feedback; Dialog flow
  for level ≥ 4; roster Dialog with lazy-load on first open.
- **DNA.tsx** (~300 lines): 4-tab surface via prefs persistence;
  IdentityTab with edit-via-clipboard + honest deferral GlassPanel;
  DnaTextTab generic over `fetcher: () => Promise<string>` to reuse
  for Goals + Patterns; QueryTab with Enter-to-submit + Ask button.
- **body.css** (+~360 lines): hormone-bus-surface grid, organ-list/row
  with expanded modifier, organ-caps-table, dna-tabs pill surface,
  dna-text pre + dna-edit-textarea + dna-deferral + dna-query-input.

Verify: `npx tsc --noEmit` clean.

### Task 3 — WorldModel + final verify:all (commit 102ec3a)

- **WorldModel.tsx** (~395 lines): hero grid of 6 cards with progress
  bars for CPU/RAM/disk; 5 pill tabs (GitTab / ProcessesTab / PortsTab
  / FileChangesTab / TodosTab) rendering the Rust struct shapes
  verbatim (snake_case fields preserved in the typed interfaces);
  `formatRelative` helper for both seconds-since-epoch and
  milliseconds timestamps (auto-detect via `> 1e12` heuristic);
  WORLD_STATE_UPDATED subscription with refetch flow; Summary Dialog.
- **body.css** (+~150 lines): world-model-surface, world-hero-card,
  world-load-bar, world-tabs pill surface, world-table (monospace),
  world-todos-list, world-summary-pre.

Verify: `npx tsc --noEmit` clean + `npm run verify:all` — **13/13 green**
(entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba,
ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes,
phase6-rust, phase7-rust).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Correctness] urinaryFlush Dialog-gated despite plan silence.**
- **Found during:** Task 1 BodySystemDetail VitalsTab (urinary branch).
- **Issue:** The plan's D-202 spec just lists `urinaryFlush()` as the vital
  surface for urinary + immune systems. Reading the Rust wrapper JSDoc
  showed `urinary_flush` is explicitly documented as destructive (drops
  expired cache + stale state). Per D-204/D-205 destructive-op discipline,
  every destructive action should be Dialog-gated.
- **Fix:** Added Dialog confirm + cancel buttons before calling
  `urinaryFlush()`. Consistent with `organSetAutonomy` (level ≥ 4),
  `reproductiveSpawn`, and `homeostasisRelearnCircadian` gating in the
  same plan.
- **Files modified:** `src/features/body/BodySystemDetail.tsx`
- **Commit:** 01a8aa3

**2. [Rule 3 — Blocking resolution] `reproductiveSpawn` call shape uses
`task` not `initialTask`.**
- **Found during:** Task 1 BodySystemDetail IdentityVitals spawn flow.
- **Issue:** The plan's D-202 + 08-PATTERNS.md §1 show
  `reproductiveSpawn({ agentType, initialTask? })`. But Plan 08-02's
  summary (already committed) corrected this to `{ agentType, task,
  workingDir? }` to match the real Rust signature at
  `src-tauri/src/reproductive.rs:222`. If I had called the pattern-file
  shape, tsc would reject `initialTask` (not in the wrapper signature).
- **Fix:** Called with `{ agentType: agentType.trim(), task: task.trim() }`.
  `workingDir` omitted from the V1 UI (Phase 9 polish could add a path
  chooser).
- **Files modified:** `src/features/body/BodySystemDetail.tsx`
- **Commit:** 01a8aa3

**3. [Rule 1 — Bug prevention] Cross-cluster `supervisorGetHealth` uses
`.catch(() => null)` for soft-fail.**
- **Found during:** Task 1 BodySystemDetail cardiovascular branch.
- **Issue:** Plan calls for `Promise.all([cardioGetBloodPressure(),
  bladeVitalSigns(), supervisorGetHealth()])`. A hard `Promise.all` means
  a single supervisor failure (e.g., services module still warming up at
  boot) would blank the entire cardiovascular vitals panel. That's a
  cross-cluster read (D-194 + D-196 last bullet) — it should never take
  down the owning cluster.
- **Fix:** Wrapped supervisor call in `.catch(() => null)` so it resolves
  to `null` on error; UI renders "Supervisor read unavailable" inline in
  that case without breaking blood pressure + vitals readings. Consistent
  with how Phase 6 `temporal_meeting_prep` is used cross-cluster (D-148
  resilient-read pattern).
- **Files modified:** `src/features/body/BodySystemDetail.tsx`
- **Commit:** 01a8aa3

### Intentional minor extensions

- BodyMap added a Refresh button beyond the plan's mount-only spec — cheap
  UX win for Mac-session M-35 verification when the registry is still
  warming up at first boot.
- OrganRegistry added a Refresh button for the same reason.
- Organs track autonomy level in a local `Map` keyed by `${organ}::${action}`
  so slider changes render immediately without waiting for a full
  `organGetRegistry()` refetch.

## Cross-cluster import inventory (D-196 audit trail)

This plan's cross-cluster reads — logged so Plan 08-05 retrospective can
audit:

- `@/lib/tauri/admin` → `BodySystemDetail.tsx` (CardioVitals component
  calls `supervisorGetHealth` with soft-fail). One cross-cluster import
  total in Plan 08-03.
- `@/lib/tauri/homeostasis` → `HormoneBus.tsx` (4 wrappers:
  `homeostasisGet`, `homeostasisGetDirective`, `homeostasisGetCircadian`,
  `homeostasisRelearnCircadian`). This is the canonical path per D-194 —
  `body.ts` re-exports the namespace for convenience but the direct
  import is clearer for readers following the Phase 3 trail.
- `@/types/hormones` → `HormoneBus.tsx` (HormoneState + ModuleDirective).
  Type-only import; not a cluster boundary crossing.

No feature-folder-to-feature-folder imports (strict D-194/D-196
enforcement).

## Zero-Rust invariant (D-196)

Verified by commit-range diff — `src-tauri/` is not touched by any of
01a8aa3 / 0fcd2da / 102ec3a:

```
$ for c in 01a8aa3 0fcd2da 102ec3a; do git show --stat --format='' $c; done
 src/features/body/BodyMap.tsx          | 171 +
 src/features/body/BodySystemDetail.tsx | 718 +
 src/features/body/body.css             | 302 +
 src/features/body/DNA.tsx              | 299 +
 src/features/body/HormoneBus.tsx       | 317 +
 src/features/body/OrganRegistry.tsx    | 338 +
 src/features/body/body.css             | 356 +
 src/features/body/WorldModel.tsx       | 394 +
 src/features/body/body.css             | 150 +
```

## Parallel wave invariant (08-04 lane)

Verified — zero overlap with Plan 08-04 commits interleaved on master:

- Plan 08-03 commits: 01a8aa3 (BodyMap+Detail), 0fcd2da (HormoneBus+Organ+DNA),
  102ec3a (WorldModel).
- Plan 08-04 commits (observed interleaved): 399bc08, 968a789, ce12eaa —
  all touching `src/features/hive/*` + `src/features/hive/hive.css`.
- No file conflicts, no merge issues — D-199 single-writer invariant held.

## Pre-existing issues NOT caused by this plan

`npm run lint` still surfaces the pre-existing ESLint TypeScript parser
errors flagged in Plan 08-02's SUMMARY — not this plan's responsibility
and unchanged by body-cluster work. `npm run verify:all` (the project's
canonical gate, which includes `no-raw-tauri`) is clean.

## Next Steps

- **Plan 08-05** (wave 3): Playwright specs for body-map + hormone-bus
  (SC-1, SC-2 falsifiers); verify-phase8-rust-surface.sh; Mac-operator
  M-35..M-40 handoff for end-to-end body-cluster smoke.
- **Phase 9 polish items discovered in this plan:**
  - `dna_set_identity` + `dna_set_goals` + `dna_set_patterns` Rust
    commands so the DNA identity-edit Save path isn't clipboard-only.
  - Per-system vital-signs color on BodyMap cards (currently neutral
    cards — D-201 already deferred this to Phase 9).
  - SVG anatomical body diagram (D-201 deferred).
  - Reject command for `reproductiveSpawn` flow (unlikely needed — spawn
    is opt-in already).
  - Optional `prefs['world.activeTab']` for WorldModel tab persistence.

## Self-Check: PASSED

- **src/features/body/BodyMap.tsx**: FOUND (live summary grid + openRoute
  handoff — verified via `grep -q "bodyGetSummary" && grep -q
  "body-system-card-" && grep -q "router.openRoute('body-system-detail')"`).
- **src/features/body/BodySystemDetail.tsx**: FOUND (live system read
  + 3 tabs + 4 vitals branches + events table; verified `bodyGetSystem`,
  `cardioGetBloodPressure`, `supervisorGetHealth` all referenced).
- **src/features/body/HormoneBus.tsx**: FOUND (HORMONE_UPDATE, homeostasisGet,
  homeostasisRelearnCircadian, 10 hormone rows, circadian grid, directive
  input all present).
- **src/features/body/OrganRegistry.tsx**: FOUND (organGetRegistry, organ-row-,
  organ-autonomy-, organSetAutonomy, organGetRoster all present).
- **src/features/body/DNA.tsx**: FOUND (body.dna.activeDoc, dnaGetIdentity,
  dnaGetGoals, dnaGetPatterns, dnaQuery all present; 4 tabs with
  role=tablist + aria-selected).
- **src/features/body/WorldModel.tsx**: FOUND (worldGetState, worldRefresh,
  worldGetSummary, WORLD_STATE_UPDATED, 5 tabs, live refresh).
- **src/features/body/body.css**: FOUND (+810 lines net; all @layer
  features-body scoped).
- **Commits in git log**:
  - 01a8aa3 — feat(08-03): BodyMap + BodySystemDetail live wiring (BODY-01/02, SC-1)
  - 0fcd2da — feat(08-03): HormoneBus + OrganRegistry + DNA live wiring (BODY-03/04/05, SC-2)
  - 102ec3a — feat(08-03): WorldModel — 5 tabs + WORLD_STATE_UPDATED live refresh (BODY-06)
- **`npx tsc --noEmit`**: exit 0 (verified after each task).
- **`npm run verify:all`**: 13/13 green (verified after Task 3).
- **Zero Rust changes**: verified — commit-range diff against `src-tauri/`
  returns no files.
- **Zero 08-04 lane overlap**: verified — my 3 commits touch only
  `src/features/body/*`; the 08-04 commits (399bc08, 968a789, ce12eaa)
  touch only `src/features/hive/*` + `src/features/hive/hive.css`.
- **data-testid roots preserved**: body-map-root, body-system-detail-root,
  hormone-bus-root, organ-registry-root, dna-root, world-model-root — all
  verbatim from Plan 08-02 placeholders so Plan 08-05 Playwright specs
  don't have to change selectors.
