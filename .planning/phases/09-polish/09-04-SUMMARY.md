---
phase: 09-polish
plan: 04
subsystem: ui
tags: [motion, a11y, empty-states, skeletons, primitives, css, design-system]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: design tokens, motion.css, primitives barrel, GlassPanel/Button/GlassSpinner
  - phase: 09-polish/plan-02
    provides: EmptyState + ErrorBoundary primitives, barrel exports
provides:
  - src/styles/motion-entrance.css with .list-entrance + @keyframes blade-enter
  - src/design-system/primitives/ListSkeleton.tsx (shimmer loader for async lists)
  - Shimmer CSS appended to primitives.css (prefers-reduced-motion aware)
  - EmptyState sweep across 20 feature files (body + hive + dev-tools + admin clusters — the second half of D-217)
  - GlassSpinner → ListSkeleton swap on 6 async-list panels
  - Motion audit verified clean (0 rogue transition: linear matches)
affects:
  - 09-05 perf harness (consumes polished surfaces)
  - 09-06 Playwright a11y + empty-state coverage verify script

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling motion-*.css files — Plan 09-03/09-04 disjoint ownership on top of motion.css (D-229)"
    - "Empty-state swap: zero-data placeholder <div>/<p> → <EmptyState label=... description=... actionLabel=... onAction=...> (D-217)"
    - "List-loading swap: <GlassSpinner> → <ListSkeleton rows={N} /> for list-shaped data (D-220)"
    - "Cluster CSS adopts .list-entrance via @import '../../styles/motion-entrance.css' (D-219)"

key-files:
  created:
    - src/styles/motion-entrance.css
    - src/design-system/primitives/ListSkeleton.tsx
  modified:
    - src/design-system/primitives/primitives.css
    - src/features/dashboard/dashboard.css
    - src/features/agents/agents.css
    - src/features/body/body.css
    - src/features/hive/hive.css
    - src/features/dev-tools/dev-tools.css
    - src/features/admin/admin.css
    - src/features/knowledge/knowledge.css
    - src/features/life-os/life-os.css
    - src/features/dev-tools/FileBrowser.tsx
    - src/features/admin/Analytics.tsx
    - src/features/admin/CapabilityReports.tsx
    - src/features/admin/DecisionLog.tsx
    - src/features/admin/SecurityDashboard.tsx
    - src/features/admin/Diagnostics.tsx
    - src/features/admin/IntegrationStatus.tsx
    - src/features/admin/McpSettings.tsx
    - src/features/admin/ModelComparison.tsx
    - src/features/admin/KeyVault.tsx
    - src/features/admin/Reports.tsx
    - src/features/admin/Temporal.tsx
    - src/features/body/BodySystemDetail.tsx
    - src/features/body/OrganRegistry.tsx
    - src/features/body/DNA.tsx
    - src/features/body/WorldModel.tsx
    - src/features/hive/HiveMesh.tsx
    - src/features/hive/TentacleDetail.tsx
    - src/features/hive/ApprovalQueue.tsx
    - src/features/hive/AiDelegate.tsx

key-decisions:
  - "Imported EmptyState from the primitives barrel (09-02 shipped it in `index.ts`) while ListSkeleton imports direct from './ListSkeleton' to honour D-229 (Plan 09-06 adds ListSkeleton to barrel)"
  - "Motion-entrance lives in a sibling file rather than extending motion.css — keeps Plan 09-03 (reduced-motion in motion.css) and Plan 09-04 (list-entrance class) disjoint per D-229"
  - "Empty-state CTAs wire to existing router ids: settings-iot for IntegrationStatus, settings-providers for KeyVault, hive-mesh hiveStart for HiveMesh, deepScanStart for Diagnostics"
  - "ApprovalQueue added initial-loading boolean — the 6th ListSkeleton consumer required a loading signal that didn't exist before Plan 09-04"
  - "SecurityDashboard renders EmptyState in 'all-clear' state rather than when overview is null, matching the user-visible semantics from D-217 'No security alerts' label"

patterns-established:
  - "Pattern: .list-entrance class consumed via @import in cluster CSS — no per-cluster duplication of @keyframes blade-enter"
  - "Pattern: ListSkeleton for list-shaped async state, GlassSpinner retained for single-value / form-submit / non-list pending states"
  - "Pattern: EmptyState CTAs use router.openRoute() or inline handlers — no route-id drift from the router definition set"

requirements-completed:
  - POL-01  # Motion audit — 0 rogue linear transitions in src/**/*.css (script verified)
  - POL-02  # Empty-state coverage (body + hive + dev-tools + admin — second half of D-217; Plan 09-02 closed the first half)
  - POL-05  # Skeletons — ListSkeleton primitive + 6 async-panel applications
  - POL-10  # Cross-route consistency — motion token discipline preserved; lightweight consistency sweep passed

# Metrics
duration: 55min
completed: 2026-04-19
---

# Phase 9 Plan 04: Motion, Skeletons, and the Body/Hive/Dev-Tools/Admin Empty-State Sweep

**Added a cross-cluster `.list-entrance` entrance animation file, shipped a shimmer `ListSkeleton` primitive, and swept `<EmptyState>` across 20 feature surfaces (body + hive + dev-tools + admin) with 6 of them also switching their async loading state to the new skeleton.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-04-19T20:03:00Z (approx)
- **Completed:** 2026-04-19T20:57:17Z
- **Tasks:** 4 (merged Task 3 and Task 4 edits at commit time to keep EmptyState + ListSkeleton swaps per-file atomic)
- **Files modified:** 31 (2 new + 29 modified)

## Accomplishments

- Created `src/styles/motion-entrance.css` with a token-driven `.list-entrance` class + `@keyframes blade-enter` + `prefers-reduced-motion` override. All 8 cluster CSS files (dashboard / agents / body / hive / dev-tools / admin / knowledge / life-os) now `@import` it.
- Added `ListSkeleton` primitive + shimmer CSS; keeps barrel untouched per D-229 so consumers import directly from `./ListSkeleton`.
- Swept EmptyState across the 20 feature files this plan owns. Every file in the D-217 body/hive/dev-tools/admin block now imports `EmptyState` from `@/design-system/primitives` and renders it where the component previously showed a zero-data placeholder.
- Swapped GlassSpinner → ListSkeleton on 6 list-shaped async panels (BodySystemDetail module list, OrganRegistry organ list, HiveMesh tentacle grid, ApprovalQueue pending decisions, Diagnostics supervisor health grid, DecisionLog decisions list). Added `.list-entrance` class to four list containers (module list, organ list, tentacle grid, supervisor grid).
- Motion audit is clean: `grep -rnE 'transition:[^;]*\\blinear\\b' src/ | grep -v 'ease-linear'` returns zero results. The `animation: * linear *` hits in voice-orb + spinner + chat countdown are intentional (continuous rotation / countdown per D-22).

## Task Commits

1. **Task 1: motion-entrance.css + 8 cluster CSS imports** — `6f323a9` (feat)
2. **Task 2: ListSkeleton primitive + shimmer CSS** — `54f1308` (feat)
3. **Task 3+4: EmptyState sweep + ListSkeleton swaps across 20 files** — `002b6f2` (feat)

Tasks 3 and 4 were bundled into a single commit because every file that received a ListSkeleton swap also received an EmptyState swap — splitting them would have doubled the per-file touch count.

## Files Created/Modified

- `src/styles/motion-entrance.css` — new; `.list-entrance` + `@keyframes blade-enter` + reduced-motion override
- `src/design-system/primitives/ListSkeleton.tsx` — new; functional component, 5 placeholder rows by default, role=status
- `src/design-system/primitives/primitives.css` — appended `.list-skeleton-row` shimmer + `@keyframes list-skeleton-shimmer` + prefers-reduced-motion disable
- 8 cluster CSS files — each prepended `@import '../../styles/motion-entrance.css';`
- 20 feature .tsx files — imported EmptyState, swapped zero-data placeholders, 6 of them also added ListSkeleton for list loading

## Decisions Made

- **D-229 compliance:** honoured the Wave 2 disjoint-files invariant — motion.css was not touched (Plan 09-03's lane); primitives/index.ts was not touched (Plan 09-02 already shipped EmptyState / ErrorBoundary there and barreled ListSkeleton is deferred to Plan 09-06). ListSkeleton imports are direct (`@/design-system/primitives/ListSkeleton`).
- **Consistency audit lightweight:** the plan's "no raw padding: 20px / font-size: 28px literals" target is already satisfied by Phase 1–8 discipline (grep for `padding: 28px` / `font-size: 28px` in feature CSS returns zero). No further token swaps required. Plan 09-06 will wire `verify-tokens-consistency.mjs` as the regression gate.
- **SecurityDashboard "all clear" rendering:** rather than rendering the EmptyState when the overview hasn't loaded (which would be a data-fetching loading state, not a truly empty result), rendered it when `overview` is present AND `activeAlerts === 0`. This matches the user-visible semantics of D-217 "No security alerts" / "BLADE runs background scans periodically".
- **ApprovalQueue initialLoading:** the file had no loading flag before this plan — rows started empty and got filled by `refresh()`. Added a local `initialLoading` boolean that flips to false in the `finally` of `refresh()`. This gives ListSkeleton a real target and keeps the empty state from flashing before data arrives.
- **CTA wiring:** used `useRouterCtx().openRoute('settings-iot')` for IntegrationStatus and `useRouterCtx().openRoute('settings-providers')` for KeyVault — both route ids verified in `src/features/settings/index.tsx`. HiveMesh's "Start hive" CTA invokes the existing `hiveStart()` wrapper and feeds the result straight into `setStatus`. Diagnostics DeepScan's "Run deep scan" CTA reuses the component's existing `runNow` callback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Initial unused-import TS6133 errors in DecisionLog.tsx + ApprovalQueue.tsx**
- **Found during:** Task 3+4 final tsc pass
- **Issue:** After swapping GlassSpinner → ListSkeleton in DecisionLog.tsx, the `GlassSpinner` import became unused (TS6133). ApprovalQueue.tsx imported ListSkeleton but had no loading flag to render it with (TS6133).
- **Fix:** Removed the `GlassSpinner` import from DecisionLog's primitives destructure; added a local `initialLoading` state to ApprovalQueue so the ListSkeleton has a real trigger.
- **Files modified:** src/features/admin/DecisionLog.tsx, src/features/hive/ApprovalQueue.tsx
- **Verification:** `npx tsc --noEmit` clean
- **Committed in:** `002b6f2` (Task 3+4 commit — fix baked into the same commit)

---

**Total deviations:** 1 auto-fixed (1 compile-error bug)
**Impact on plan:** Trivial. The fix was purely mechanical — removing a newly-unused import and giving the newly-introduced ListSkeleton a legitimate loading trigger. No scope creep.

## Issues Encountered

- None. The plan's scope was large (~30 file edits) but each edit was mechanical. Per-file edits came back slightly scrambled in pretooluse-hook snapshots (Read-before-Edit reminders fired on files I had already read earlier in the conversation) — no actual work lost, each edit went through on first attempt.

## User Setup Required

None — no external configuration.

## Verification Evidence

- `npx tsc --noEmit` → clean (exits 0)
- `npm run verify:all` → 14/14 verify scripts OK (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, phase6-rust, phase7-rust, phase8-rust, feature-cluster-routes)
- `grep -rnE 'transition:[^;]*\\blinear\\b' src/ | grep -v 'ease-linear'` → empty (motion audit baseline clean)
- `grep -l EmptyState` across the 20 feature files in scope → 20/20 hit
- `grep -l ListSkeleton` across the 6 async-panel files in scope → 6/6 hit
- `git diff` touched zero Plan 09-02 files (agents/knowledge/life-os/identity, MainShell, primitives/index.ts, primitives/ErrorBoundary.tsx, primitives/EmptyState.tsx)

## Next Phase Readiness

- Plan 09-05 (Wave 3 — perf harness + prod build + shortcut help) can run: motion tokens, skeleton primitive, empty-state primitive, and entrance class are all in place.
- Plan 09-06 (Wave 4 — Playwright a11y + CHANGELOG + final verify scripts) can add the ListSkeleton barrel export and the `verify-tokens-consistency.mjs` / `verify-motion-tokens.sh` / `verify-empty-state-coverage.sh` scripts, all of which will find green ground.
- Combined with Plan 09-02, the D-217 empty-state coverage is fully closed — 41 feature files across 10 clusters.

## Self-Check: PASSED

File existence:
- `src/styles/motion-entrance.css` — FOUND
- `src/design-system/primitives/ListSkeleton.tsx` — FOUND

Commit existence:
- `6f323a9` (motion-entrance + 8 imports) — FOUND
- `54f1308` (ListSkeleton primitive) — FOUND
- `002b6f2` (EmptyState + ListSkeleton sweeps) — FOUND

Coverage claims:
- EmptyState on 20 feature files — VERIFIED via grep
- ListSkeleton on 6 async-panel files — VERIFIED via grep
- Motion audit clean — VERIFIED via grep (zero transition: linear matches)
- 14/14 verify:all scripts — VERIFIED via npm run verify:all output

---
*Phase: 09-polish*
*Completed: 2026-04-19*
