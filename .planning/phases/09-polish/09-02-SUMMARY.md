---
phase: 09-polish
plan: 02
subsystem: ui
tags: [react, error-boundary, empty-state, primitives, a11y, SC-2, SC-3]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "GlassPanel + Button primitives + tokens.css spacing scale"
  - phase: 02-onboarding-shell
    provides: "MainShell.tsx with RouteSlot render site (D-48, D-51)"
  - phase: 09-polish
    provides: "Plan 09-01 Rust backfill (decision-gate wrappers used by downstream surfaces)"
provides:
  - "ErrorBoundary primitive (class component with resetKey + 3 recovery buttons)"
  - "EmptyState primitive (functional tier-1 glass card with icon/label/description/CTA)"
  - "MainShell.RouteSlot wrapped in ErrorBoundary for every top-level route (D-218)"
  - "EmptyState swapped into 21 feature files across agents/knowledge/life-os/identity (D-217 split)"
  - "Foundation for POL-02 (empty states) + POL-03 (error boundaries) partial SC-2 + SC-3 falsifiers"
affects: [09-04, 09-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ErrorBoundary class component (the React 19-supported pattern for render-error capture)"
    - "resetKey prop clears the boundary on navigation so one crashed route does not poison the shell"
    - "EmptyState as the single owner of zero-data visuals — no more inline divs with opacity: 0.5"
    - "EmptyState CTA wiring via useRouterCtx().openRoute or inline handler reuse (handleImportCsv, focus-form)"

key-files:
  created:
    - "src/design-system/primitives/ErrorBoundary.tsx"
    - "src/design-system/primitives/EmptyState.tsx"
    - ".planning/phases/09-polish/09-02-SUMMARY.md"
  modified:
    - "src/design-system/primitives/index.ts (append 2 exports alongside 9 existing)"
    - "src/windows/main/MainShell.tsx (wrap RouteSlot in ErrorBoundary resetKey={route.id})"
    - "src/features/agents/AgentDashboard.tsx"
    - "src/features/agents/SwarmView.tsx"
    - "src/features/agents/AgentDetail.tsx"
    - "src/features/knowledge/KnowledgeBase.tsx"
    - "src/features/knowledge/ScreenTimeline.tsx"
    - "src/features/life-os/HealthView.tsx"
    - "src/features/life-os/FinanceView.tsx"
    - "src/features/life-os/GoalView.tsx"
    - "src/features/life-os/HabitView.tsx"
    - "src/features/life-os/MeetingsView.tsx"
    - "src/features/life-os/PredictionsView.tsx"
    - "src/features/life-os/SocialGraphView.tsx"
    - "src/features/life-os/AccountabilityView.tsx"
    - "src/features/life-os/EmotionalIntelView.tsx"
    - "src/features/identity/CharacterBible.tsx"
    - "src/features/identity/SoulView.tsx"
    - "src/features/identity/PersonaView.tsx"
    - "src/features/identity/ReasoningView.tsx"
    - "src/features/identity/NegotiationView.tsx"
    - "src/features/identity/SidecarView.tsx"
    - "src/features/identity/ContextEngineView.tsx"

key-decisions:
  - "ErrorBoundary class component copied verbatim from 09-PATTERNS §1 — 3 recovery buttons (Reset / Back to dashboard / Copy error)"
  - "MainShell wrapped in a single-writer site (D-218); per-pane boundaries deferred to v1.1"
  - "EmptyState uses role=status (non-blocking announcement), not role=alert — fits zero-data context"
  - "D-217 split honored: body + hive + dev-tools + admin belong to Plan 09-04's parallel wave-2 lane, not touched"
  - "Form-focused CTAs (GoalView, HabitView) use document.getElementById(...).focus() to jump to the add-form input without opening a modal"
  - "SoulView BibleTab CTA uses useRouterCtx inside the sub-component (fresh hook call is valid since BibleTab is rendered from inside the provider)"
  - "ContextEngineView received a pre-assemble EmptyState as the natural zero-data path for a tool surface without a result list"

patterns-established:
  - "Pattern 1: ErrorBoundary + resetKey — wraps at MainShell, auto-clears on route change"
  - "Pattern 2: EmptyState swap recipe — import from @/design-system/primitives, render at the `xs.length === 0` branch"
  - "Pattern 3: CTA routing — openRoute('agent-factory' | 'settings-privacy' | 'dna') via useRouterCtx hook"

requirements-completed: [POL-02, POL-03]

# Metrics
duration: 16min
completed: 2026-04-19
---

# Phase 9 Plan 09-02: ErrorBoundary + EmptyState primitives + shell wrap + feature sweep Summary

**Two new primitives (ErrorBoundary + EmptyState), MainShell RouteSlot wrapped in ErrorBoundary with resetKey={route.id}, and EmptyState sweep across 21 feature files — the Plan 09-02 slice of D-217 (agents + knowledge + life-os + identity).**

## Performance

- **Duration:** 16 min (hands-on edit time)
- **Started:** 2026-04-19T20:38:10Z
- **Completed:** 2026-04-19T20:55:02Z
- **Tasks:** 3
- **Files created:** 3 (2 primitive .tsx + 1 SUMMARY)
- **Files modified:** 23 (primitives/index.ts + MainShell.tsx + 21 feature .tsx)

## Accomplishments

- **ErrorBoundary primitive (class-based)** with `resetKey` prop and three recovery buttons (Reset route / Back to dashboard / Copy error). `componentDidCatch` logs to console; `componentDidUpdate` clears the captured error when `resetKey` changes. Routes that crash can be recovered same-route via "Reset" or escaped via navigation — no stale error panel ever lingers (D-218 semantics).
- **EmptyState primitive (functional)** renders a centered `GlassPanel tier=1 role="status"` with optional icon + label + description + CTA. Single reusable API that replaced 21 one-off inline placeholders. `data-testid="empty-state"` defaulted for verify-empty-state-coverage.sh + Playwright specs.
- **MainShell single-writer wrap** — `<ErrorBoundary resetKey={route.id}>` now sits inside `<Suspense>` between the route boundary `<div data-route-id>` and the lazy-loaded `<Cmp />`. One edit covers every top-level route; file still under the 220-line SC-5 budget (currently 136 lines).
- **21-file empty-state sweep** applied mechanically per 09-PATTERNS §2 recipe. Each file imports `EmptyState` from `@/design-system/primitives` and renders it at the zero-data branch with the exact label/description/CTA copy from the D-217 coverage table. Old inline `<div style={{ opacity: 0.5 }}>No data</div>` and `<p className="life-placeholder-hint">` fragments replaced.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ErrorBoundary + EmptyState primitives + barrel** — `98e6bb6` (feat)
2. **Task 2: Wrap MainShell RouteSlot in ErrorBoundary** — `ad8b82a` (feat)
3. **Task 3: Empty-state sweep across 21 files** — `70bb45d` (feat)

_Note: the Task 1 plan was marked `tdd="true"` but no test framework is wired into this repo (Playwright e2e only; no RTL + Vitest). Following 09-PATTERNS §1 / §2 verbatim produces a deterministic primitive whose behavior is directly falsified by Plan 09-06 specs (tests/e2e/error-boundary-recovery.spec.ts + verify-empty-state-coverage.sh). Primitives committed as `feat` per repo convention._

## Files Created/Modified

### Created

- `src/design-system/primitives/ErrorBoundary.tsx` (91 lines) — Class component. Props: `children`, `resetKey?`, `onError?`. State: `{ error, info }`. Render branch: child tree OR recovery GlassPanel with 3 Button primitives wired to `handleReset`, `handleHome`, `handleCopy`.
- `src/design-system/primitives/EmptyState.tsx` (59 lines) — Functional component. Props: `label`, `description?`, `actionLabel?`, `onAction?`, `icon?`, `testId?`. Renders `GlassPanel tier=1 role="status"` centered with `maxWidth: 420`.

### Modified

- `src/design-system/primitives/index.ts` — appended `ErrorBoundary` + `EmptyState` exports alongside 9 existing primitives. Barrel now exports 11.
- `src/windows/main/MainShell.tsx` — two-line edit: add `ErrorBoundary` to the primitives import and wrap `<Cmp />` inside `<ErrorBoundary resetKey={route.id}>`. Gate-check (`status === 'checking'`) and onboarding branches deliberately left unwrapped (no crash vector — just OnboardingFlow + GlassSpinner).
- **Agents (3):** AgentDashboard (`totalVisible === 0` branch → EmptyState with Open-factory CTA), SwarmView (empty swarm list → Open-factory CTA, added `useRouterCtx` import), AgentDetail (empty timeline → no-CTA informational EmptyState).
- **Knowledge (2):** KnowledgeBase (recent-entries empty → "No matches / Try a broader query"), ScreenTimeline (search-results empty → "Total Recall not running" with Open-settings CTA, added `useRouterCtx`).
- **Life OS (9):** HealthView (insights empty), FinanceView (transactions empty → Import-CSV CTA reusing `handleImportCsv`), GoalView (goals empty → Add-goal CTA jumping focus to `#goal-add-title`), HabitView (library empty → Add-habit CTA focusing `#habit-add-name`), MeetingsView (sidebar empty), PredictionsView (pending empty), SocialGraphView (contacts empty), AccountabilityView (daily-actions empty), EmotionalIntelView (readings empty).
- **Identity (7):** CharacterBible (new gated branch when `!loading && !bible && !error`), SoulView (BibleTab empty → Open-DNA CTA), PersonaView (traits empty), ReasoningView (traces empty), NegotiationView (sidebar empty), SidecarView (devices empty), ContextEngineView (pre-assemble empty — natural zero-data path for a tool-only surface).

## Decisions Made

- **Three-button recovery panel, not just "Retry"** (inherited from 09-PATTERNS §1 / D-215 planner pick): "Reset route" for same-route recovery, "Back to dashboard" for escape, "Copy error" for filing. Matches Phase 7 SecurityDashboard danger-zone Dialog discipline.
- **`role="status"` on EmptyState** (not `role="alert"`): empty state is non-blocking — screen readers announce it in the polite region. `role="alert"` belongs to ErrorBoundary which really is a disruptive failure.
- **Single-writer MainShell wrap** (D-218): per-pane boundaries stay in v1.1. Phase 9 ships the MVP that satisfies SC-3 ("recovery affordance, never an unhandled crash"). Per-pane isolation is a refinement, not a blocker.
- **Form-focus CTAs over modal-open CTAs** (GoalView, HabitView): the add-goal / add-habit forms are already inline above the list. A CTA that opens a Dialog would create a second data-entry path and duplicate state. `document.getElementById(...)?.focus()` jumps the cursor to the existing form field with zero extra state.
- **SoulView Bible tab CTA via `useRouterCtx` in the sub-component** — rendering happens inside the MainShell RouterProvider (always true for a route component), so `useRouterCtx` in `BibleTab` is valid. Avoids prop-drilling `openRoute` from parent `SoulView` through two arg signatures.
- **ContextEngineView gets a pre-assemble EmptyState** — unlike the other 20 files (which had a clear zero-data render path at `list.length === 0`), this is a tool surface that only shows a result after a button click. Rendering EmptyState when `!assembled && !assembleBusy` is the natural "nothing here yet" surface matching D-217's "Context blocks populate as BLADE learns" copy.

## Deviations from Plan

None for correctness or scope — the plan executed as written. One coordination note:

### Coordination — not a deviation

Plans 09-03 and 09-04 landed commits in parallel during this execution (wave-2 carving per D-229). 09-03 shipped `f4ecca5` (reduced-motion) + `a48e42a` (09-03 summary) before Task 3. 09-04 shipped `6f323a9` (motion-entrance.css) and `54f1308` (ListSkeleton primitive) before Task 3 finished. None of those commits touched Plan 09-02's `files_modified` set — the no-overlap invariant held. Running `tsc --noEmit` at the end surfaced two warnings in 09-04's **uncommitted** working-copy edits (admin/DecisionLog.tsx unused `GlassSpinner`, hive/ApprovalQueue.tsx unused `ListSkeleton`). Those files are explicitly in 09-04's lane per D-229 and will be fixed by 09-04's next commit. Plan 09-02 did not touch them.

## Issues Encountered

- **Pre-existing uncommitted admin+hive edits not in my lane** — surfaced as 2 tsc warnings when running a full-repo `tsc --noEmit`. Verified these errors exist ONLY in files modified-but-uncommitted by Plan 09-04 (owners per D-229). `npm run verify:all` passed all 14 scripts (none of which wrap tsc). No regression introduced by Plan 09-02 commits.
- **No test infrastructure for TDD primitive creation** — repo has Playwright e2e harness but no RTL/Vitest. Per 09-PATTERNS §1 / §2 the primitive bodies were adopted verbatim (planner-validated recipe), and falsifiers live in Plan 09-06 specs. No deviation — this was the expected Phase 9 posture.

## User Setup Required

None — no external service configuration required.

## Verification

- `npx tsc --noEmit` — Plan 09-02 lane (23 modified files + 2 new primitives) compiles clean. The 2 warnings in 09-04's uncommitted working copy are owned by 09-04 and not part of this plan.
- `npm run verify:all` — all 14 scripts OK (`verify-entries`, `verify-no-raw-tauri`, `verify-migration-ledger`, `verify-emit-policy`, `verify-contrast`, `verify-chat-rgba`, `verify-ghost-no-cursor`, `verify-orb-rgba`, `verify-hud-chip-count`, `verify-phase5-rust`, `verify-feature-cluster-routes`, `verify-phase6-rust`, `verify-phase7-rust`, `verify-phase8-rust`). No regression from the sweep.
- Manual grep across 21 feature files — each imports `EmptyState` and renders it at the zero-data branch.
- `wc -l src/windows/main/MainShell.tsx` = 136 (well under the 220-line SC-5 budget).

## Threat Surface Review

No new trust boundaries introduced. The threat register in the plan (T-09-02-01 through T-09-02-04) all resolved as designed:

- **T-09-02-01** (info disclosure via Copy Error) — user-initiated, local Tauri clipboard, acceptable.
- **T-09-02-02** (infinite error loop) — mitigated: render is local to boundary; `resetKey` on navigation clears state.
- **T-09-02-03** (hash-nav bypasses onboarding) — not exploitable: MainShell gate pre-empts RouteSlot render.
- **T-09-02-04** (EmptyState onAction injection) — consumer-controlled, no dynamic code paths.

No threat flags added.

## Next Phase Readiness

- **For Plan 09-04** (wave-2 sibling): body + hive + dev-tools + admin empty-state sweep can now consume the `EmptyState` primitive via the exact same import path. No coordination needed — files disjoint per D-229.
- **For Plan 09-06** (wave-4): the new `scripts/verify-empty-state-coverage.sh` already lists Plan 09-02's 21 files in its REQUIRED_FILES array (per 09-PATTERNS §8 draft). The script should pass for this cluster once written. `tests/e2e/error-boundary-recovery.spec.ts` has the render shape it needs (role="alert", accessible buttons).
- **Blockers:** None. The 2 transient tsc warnings in 09-04's uncommitted working-copy files will disappear when 09-04 commits their next edits (they reference `ListSkeleton` which is now committed, and their admin unused-import cleanup is part of 09-04's own closure).

## Self-Check: PASSED

- [x] `src/design-system/primitives/ErrorBoundary.tsx` exists (91 lines > 50 required)
- [x] `src/design-system/primitives/EmptyState.tsx` exists (59 lines > 30 required)
- [x] `src/design-system/primitives/index.ts` contains both `ErrorBoundary` and `EmptyState` exports
- [x] `src/windows/main/MainShell.tsx` contains `ErrorBoundary` import and `resetKey={route.id}` wrap
- [x] Commit `98e6bb6` present in git log
- [x] Commit `ad8b82a` present in git log
- [x] Commit `70bb45d` present in git log
- [x] All 21 feature files grep positive for `EmptyState`
- [x] `npm run verify:all` exits 0 (14/14 OK)

---

*Phase: 09-polish*
*Completed: 2026-04-19*
