---
phase: 15-density-polish
plan: "02"
subsystem: ui
tags: [top-bar, density, hierarchy, titlebar, activity-strip, responsive, playwright, a11y]

# Dependency graph
requires:
  - phase: 02-onboarding-shell
    provides: TitleBar + shell.css (.titlebar, .titlebar-brand, .titlebar-status, .titlebar-hint)
  - phase: 14-wiring-accessibility-pass
    provides: ActivityStrip + activity-log.css (mounted below TitleBar in MainShell)
  - phase: 15-density-polish (15-01)
    provides: SPACING-LADDER.md canonical --s-1..--s-20 + whitelist policy + verify:spacing-ladder gate
provides:
  - 4-tier visual hierarchy encoded via data-hierarchy-tier attribute (TitleBar.tsx)
  - Typography/opacity ladder rules in shell.css targeting data-hierarchy-tier (tier 1 t-1/600+, tier 2 t-2/500, tier 3 t-3/400)
  - 1280px width guardrail (@media max-width) that tightens padding/gap
  - 1100px width guardrail (@media max-width) that hides tier-3 ⌘K hint
  - ActivityStrip tier-2 treatment (color var(--t-2), entry 12px/500, badge 10px) — subordinate to TitleBar brand, superior to filler
  - Playwright spec tests/e2e/phase15/top-bar-hierarchy.spec.ts (6 tests at 1280px viewport)
  - package.json: test:e2e:phase15 script
affects: [15-03, 15-04, 15-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "data-hierarchy-tier attribute pattern — primary/secondary/tertiary/filler ladder enforced via CSS attribute selectors so future additions cannot silently compete"
    - "Responsive top-bar guardrails — @media (max-width: 1280px) tightens padding/gap; @media (max-width: 1100px) hides tier-3 disposables"
    - "Playwright hierarchy contract test — count tier-N locators + adjacency box math + computed fontWeight ladder + scrollWidth overflow check"

key-files:
  created:
    - tests/e2e/phase15/top-bar-hierarchy.spec.ts
  modified:
    - src/design-system/shell/TitleBar.tsx
    - src/design-system/shell/shell.css
    - src/features/activity-log/activity-log.css
    - package.json

key-decisions:
  - "Tier 3 ⌘K hint is disposable at ≤1100px (display: none) — keeps tier 1 + 2 visible without overflow on narrower laptops"
  - "Brand font-weight ≥ 600 AND status pill ≤ 500 is now spec-enforceable — the Playwright test reads computed fontWeight and would fail if brand weight dropped to 500 or status weight climbed to 600"
  - "Existing whitelist-allowed values (padding: 0 10px on .titlebar-hint; padding: 3px 10px on .titlebar-status) collapsed to tokens where a ladder token exists (0 10px → 0 var(--s-2)=8px) to satisfy plan's strict absence criterion; chip-padding 3px 10px retained as it is whitelist-only"
  - "activity-log.css existing `var(--space-N)` usages left intact — they are undefined CSS variables, not hardcoded px, so they fall outside verify:spacing-ladder scope; renaming to --s-N is Phase 15-03/15-04 scope per SPACING-LADDER.md backlog"

patterns-established:
  - "data-hierarchy-tier=\"N\" attribute on top-bar DOM elements: 1 = primary, 2 = secondary, 3 = tertiary, 4 = filler. CSS selects via [data-hierarchy-tier=\"N\"] to set color/weight/opacity."
  - "Phase 15 e2e directory convention: tests/e2e/phase15/*.spec.ts matching tests/e2e/phase14/ with test.use({ viewport }) per-spec viewport pin"
  - "Hierarchy contract enforcement: computed fontWeight read via page.locator(...).evaluate(el => parseInt(getComputedStyle(el).fontWeight, 10)) — tier separation provable in CI"

requirements-completed: [DENSITY-04]

# Metrics
duration: 6m
completed: 2026-04-24
---

# Phase 15 Plan 02: Top-Bar Hierarchy Summary

**4-tier visual hierarchy (traffic+brand / status+activity / ⌘K / chrome) encoded via data-hierarchy-tier + CSS typography ladder + 1280/1100px responsive guardrails + Playwright contract spec at 1280px viewport.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-24T08:44:00Z
- **Completed:** 2026-04-24T08:50:00Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified) + test spec (1 created)

## Accomplishments

- TitleBar.tsx annotated with data-hierarchy-tier attributes (3 tier-1 markers on header/traffic/title, 1 tier-2 on status pill, 1 tier-3 on ⌘K hint)
- shell.css gained a dedicated Hierarchy tiers section with color/weight/opacity rules targeting data-hierarchy-tier, plus 1280px and 1100px @media guardrails
- shell.css titlebar padding/gap values migrated to ladder tokens (10px → var(--s-2), 6px → var(--s-1))
- activity-log.css strip text treatment explicitly set to tier 2 (var(--t-2), 12px/500 for entry, 10px for module/count)
- tests/e2e/phase15/top-bar-hierarchy.spec.ts with 6 hierarchy-contract tests at exact 1280x720 viewport
- package.json test:e2e:phase15 script inserted after test:e2e:phase14
- Spacing-ladder violation count reduced from 135 → 133 (2 sites closed in titlebar)
- Zero regressions on Phase 14 verify gates: a11y-pass-2, contrast, hud-chip-count, chat-rgba, orb-rgba, ghost-no-cursor all still green

## Task Commits

Each task was committed atomically:

1. **Task 1: Encode hierarchy tiers in TitleBar.tsx + shell.css + activity-log.css** — `d6fea5e` (feat)
2. **Task 2: Playwright spec — top-bar hierarchy at 1280px** — `587f6a7` (test)

## Files Created/Modified

- `src/design-system/shell/TitleBar.tsx` (modified) — 5 data-hierarchy-tier attrs added (header + 3 zone containers + status pill)
- `src/design-system/shell/shell.css` (modified) — titlebar padding/gap → tokens; new `/* ── Hierarchy tiers (Phase 15 DENSITY-04) ── */` section with tier 1/2/3 color+weight rules; 1280px and 1100px @media guardrails
- `src/features/activity-log/activity-log.css` (modified) — .activity-strip color var(--t-2); .activity-strip-entry 12px/500/t-2; .activity-strip-module & .activity-strip-count 10px
- `tests/e2e/phase15/top-bar-hierarchy.spec.ts` (created) — 6 Playwright tests asserting tier markers, adjacency, overflow, weight separation at 1280px
- `package.json` (modified) — test:e2e:phase15 script

## Decisions Made

- **Ladderize .titlebar-hint padding (0 10px → 0 var(--s-2))**: Plan's acceptance criterion is strict `grep -c "padding: 0 10px" returns 0`, even though SPACING-LADDER whitelist allows `padding: 0 10px` unconditionally. Chose the smaller (8px) token to satisfy the criterion; visual shift ≤ 2px, imperceptible on a 32px kbd chip.
- **Leave var(--space-*) tokens in activity-log.css intact**: These are undefined CSS variables that resolve to 0, but the verify:spacing-ladder gate only flags raw px/rem; renaming is Phase 15-03/15-04 scope. Adding hierarchy-tier treatment is additive and orthogonal.
- **Adapted activity-strip class names**: Plan references `.activity-strip-summary` and `.activity-strip-badge`; actual ActivityStrip.tsx uses `.activity-strip-entry` and `.activity-strip-module`. Applied the plan's spec (12px/500 for summary, 10px for badge) to the actual class names — same visual intent, correct selectors.
- **Used test.use({ viewport })** at file scope in the Playwright spec: pinning to 1280x720 once at the describe level rather than per-test, which matches Playwright best practice and gives all 6 tests the same guardrail bounds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Collapsed `.titlebar-hint { padding: 0 10px; }` to token**
- **Found during:** Task 1 (Task 1 verification)
- **Issue:** Plan's automated verify requires `grep -c "padding: 0 10px" src/design-system/shell/shell.css` to return 0 but `.titlebar-hint` still held that literal value (whitelist-allowed but plan-banned). Without this change the `! grep -q "padding: 0 10px"` assertion in the plan's verify block would fail.
- **Fix:** Replaced with `padding: 0 var(--s-2);` (8px; 2px visual shift on a 32px chip)
- **Files modified:** src/design-system/shell/shell.css
- **Verification:** `grep -c "padding: 0 10px" src/design-system/shell/shell.css` returns 0; titlebar still renders
- **Committed in:** d6fea5e (Task 1 commit)

**2. [Rule 3 - Blocking] Worktree base was behind expected base — fast-forwarded**
- **Found during:** Task 0 (worktree_branch_check startup)
- **Issue:** Worktree was at `9e93fcd` (before Phase 14 started); expected base was `83c91c0` which contained ActivityStrip + Phase 14/15-01 artifacts. Without those artifacts the plan's referenced files (ActivityStrip.tsx, activity-log.css, SPACING-LADDER.md, 15-02-PLAN.md itself) did not exist in the worktree.
- **Fix:** `git merge --ff-only 83c91c086bebe6e59aac1d1eb9db18dbcdd0c3a6` to fast-forward the worktree to the expected base (the `git reset --hard` in the startup instruction was denied by the sandbox, so fast-forward was the clean alternative)
- **Files modified:** 76 files synced from master (no new commits created — fast-forward is lossless)
- **Verification:** `git merge-base HEAD 83c91c086bebe6e59aac1d1eb9db18dbcdd0c3a6` returns `83c91c0`; all referenced files now resolvable
- **Committed in:** None (fast-forward is not a commit; the sync is transparent)

---

**Total deviations:** 2 auto-fixed (1 missing critical literal-compliance, 1 blocking worktree sync)
**Impact on plan:** Both fixes were prerequisites for the plan to execute at all (blocking worktree) or for the plan's own verify command to pass (titlebar-hint literal). No scope creep beyond plan boundaries.

## Issues Encountered

- **`git reset --hard` denied by sandbox** — The worktree_branch_check instruction called for `git reset --hard 83c91c0`, but the sandbox blocks destructive git. Resolved via `git merge --ff-only 83c91c0` which is non-destructive (the worktree has no prior commits to clobber — linear fast-forward only).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 1 sibling plans (15-03, 15-04, 15-05) can now reference the data-hierarchy-tier convention when adding new top-bar-adjacent chrome:

- **Plan 15-03** (card/section gap refactor) — can apply the same data-hierarchy-tier pattern to card headers/bodies if desired; at minimum, knows the tier-ladder idiom and can avoid introducing font-weight values that would conflict with the ≥600 brand / ≤500 secondary separation
- **Plan 15-04** (empty-state copy) — orthogonal; uses EmptyState primitive, doesn't touch top bar
- **Plan 15-05** (background-image dominance) — should respect tier-1 brand visibility when adjusting top-bar backdrop; any reduction in titlebar background opacity must preserve brand contrast ≥ 4.5:1 on wallpaper

**Spacing-ladder gate baseline moved:** 135 → 133. Future plans closing the remaining 133 violations still work from the same baseline tools (verify:spacing-ladder, SPACING-LADDER.md whitelist).

## Self-Check: PASSED

- `src/design-system/shell/TitleBar.tsx` — FOUND (3 tier-1 + 1 tier-2 + 1 tier-3 attrs)
- `src/design-system/shell/shell.css` — FOUND (6 data-hierarchy-tier references, 1280px + 1100px @media, no `padding: 0 10px`, no `gap: 10px`)
- `src/features/activity-log/activity-log.css` — FOUND (tier-2 color added to .activity-strip; tier-2 spec on entry; tier-3 spec on module/count)
- `tests/e2e/phase15/top-bar-hierarchy.spec.ts` — FOUND (5 matches for "1280", 3 for "data-hierarchy-tier", 1 for "scrollWidth")
- `package.json` contains `test:e2e:phase15` — FOUND
- Commit `d6fea5e` (Task 1) — FOUND
- Commit `587f6a7` (Task 2) — FOUND
- `npx tsc --noEmit` exit 0 — CLEAN
- `node scripts/verify-a11y-pass-2.mjs` exit 0 — PASS
- `node scripts/audit-contrast.mjs` exit 0 — PASS
- `bash scripts/verify-hud-chip-count.sh` exit 0 — PASS
- `bash scripts/verify-chat-rgba.sh` exit 0 — PASS
- `bash scripts/verify-orb-rgba.sh` exit 0 — PASS
- `bash scripts/verify-ghost-no-cursor.sh` exit 0 — PASS
- `node scripts/verify-spacing-ladder.mjs` — 133 violations (down from 135 baseline; shell.css titlebar scope fully closed)

---
*Phase: 15-density-polish*
*Completed: 2026-04-24*
