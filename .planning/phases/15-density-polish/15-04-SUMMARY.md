---
phase: 15-density-polish
plan: "04"
subsystem: ui
tags: [react, tauri, dashboard, density, glass, spacing, playwright]

requires:
  - phase: 12-smart-deep-scan
    provides: deepScanResults() wrapper + profileGetRendered() backing
  - phase: 13-self-configuring-ecosystem
    provides: ecosystemListTentacles() + TentacleRecord type
  - phase: 03-dashboard-chat-settings
    provides: perceptionGetLatest / perceptionUpdate + RightNowHero shell
  - phase: 14-wiring-accessibility-pass
    provides: Dashboard.tsx live cards (TentacleSignalsCard, CalendarCard, IntegrationsCard)
  - phase: 15-density-polish
    provides: verify:spacing-ladder gate (Plan 15-01), --s-* tokens documented

provides:
  - RightNowHero that carries 4 data-signal chips (active-app + scan-repos + tentacles + user-state)
  - DENSITY-03 inline policy block in dashboard.css
  - Tokenized dashboard.css — zero raw rgba(255,255,255,*) backgrounds remain; 4 off-ladder gap/padding fixes
  - tests/e2e/phase15/dashboard-hero-signals.spec.ts — cold-install Playwright spec (5 assertions)

affects:
  - 15-05 (UAT verifier — hero cold-install signal coverage now measurable)
  - verify:spacing-ladder (0 dashboard-scope violations)
  - audit-contrast (tokens bind the 5-wallpaper baseline)

tech-stack:
  added: []
  patterns:
    - "Parallel fetch in useEffect with silent-degrade .catch per source (T-15-04-02 mitigation)"
    - "Defensive shape narrowing against Record<string, unknown> IPC DTOs — repos / repos_found / repo_count fallback chain"
    - "data-signal='<id>' attribute as Playwright counting surface for live-data coverage"
    - "DENSITY-03 glass-fill tokenization: raw rgba(255,255,255,*) replaced with --g-fill / --g-fill-weak so the contrast audit binds every dashboard surface"

key-files:
  created:
    - tests/e2e/phase15/dashboard-hero-signals.spec.ts
  modified:
    - src/features/dashboard/RightNowHero.tsx
    - src/features/dashboard/dashboard.css
    - src/features/dashboard/IntegrationsCard.tsx

key-decisions:
  - "DeepScanResults is typed as Record<string, unknown> on the TS side; hero reads r.repos / r.repos_found / r.repo_count with defensive Array.isArray fallback rather than inventing a narrower type — future Rust schema renames degrade to 0 instead of crashing"
  - "null deep_scan_results on cold install sets scanRepoCount to 0 (a truthful live signal) rather than hiding the chip — matches DENSITY-07 premise that 0 IS a signal"
  - "4 dashboard spacing violations (6px / 8px gaps + '4px 0' padding) retokenized to --s-2 / --s-1 rather than widening the ladder whitelist — keeps the ladder tight per SPACING-LADDER.md"
  - "hormone-chip.is-dominant 0.06 alpha rounded UP to --g-fill (0.07) rather than adding a new 0.06 token — the 4 canonical glass fills (weak 0.04 / fill 0.07 / strong 0.11 / heavy 0.16) stay authoritative"
  - "IntegrationsCard pill padding tokenized 2px 8px -> 2px 6px (chip whitelist) and rgba(255,255,255,0.07) -> var(--g-fill) as opportunistic DENSITY-03 prep for Plan 15-05 sweep"
  - "Playwright spec uses Tauri invoke shim from dashboard-paint.spec pattern with empty ecosystem_list_tentacles + null deep_scan_results — asserts hero paints ≥ 3 signals even under worst-case cold install"

patterns-established:
  - "3-source hero signal fan-in: perception + ecosystem + deep_scan each fetch independently, silent-degrade on error, render placeholder glyph when null"
  - "data-signal attribute contract for e2e signal-count assertions (>= 3 signals = DENSITY-07 satisfied)"
  - "DENSITY-03 inline doc block in feature CSS explaining the glass-fill token contract + audit script link"

requirements-completed:
  - DENSITY-07
  - DENSITY-02
  - DENSITY-03

duration: 35min
completed: 2026-04-24
---

# Phase 15 Plan 04: Dashboard Hero Signals + Glass-Fill Tokenization Summary

**RightNowHero now paints 4 labelled live signals from 3 independent backends (perception + ecosystem + deep_scan) with graceful cold-install fallback, and every Dashboard glass surface resolves through --g-fill / --g-fill-weak tokens so the 5-wallpaper contrast audit binds.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-04-24T08:34:00Z
- **Completed:** 2026-04-24T09:09:00Z
- **Tasks:** 2
- **Files modified:** 3 (+1 created)

## Accomplishments

- RightNowHero now imports `ecosystemListTentacles` and `deepScanResults` in addition to `perceptionGetLatest` / `perceptionUpdate`. Three parallel `.then/.catch` fetches keep the paint budget unchanged while adding two independent signal sources.
- Four `data-signal` attributes on the hero: `active-app` (h2), `scan-repos`, `tentacles`, `user-state` — cold-install Playwright assertion counts `[data-signal]` >= 3 on a worst-case baseline (no scan run, no tentacles enabled).
- `dashboard.css` DENSITY-03 inline doc block added + every raw `rgba(255, 255, 255, *)` background replaced with `var(--g-fill)` (tier-2) or `var(--g-fill-weak)` (tier-1). Token count in file: 7 `var(--g-fill*)` uses.
- Four dashboard spacing-ladder violations fixed (6px gaps on `.dash-hero-state` + `.dash-hero-chip`, 8px gap on `.hormone-chip`, `4px 0` padding on `.dash-hero-errors summary`) — all retokenized to `--s-2` / `--s-1` rather than widening the whitelist. `verify:spacing-ladder` now reports 0 dashboard-scope violations.
- `IntegrationsCard.tsx` pill padding tokenized (`2px 8px` off-whitelist -> `2px 6px` chip-whitelisted) and `rgba(255,255,255,0.07)` -> `var(--g-fill)` for DENSITY-03 continuity.
- Cold-install Playwright spec at `tests/e2e/phase15/dashboard-hero-signals.spec.ts` — 5 tests: signal count >= 3, 4 labelled attributes visible, hero background alpha >= 0.04, no "No data" text, no horizontal overflow at 1280px. Uses synthetic Tauri invoke shim matching `dashboard-paint.spec.ts`.

## Task Commits

1. **Task 1: RightNowHero +3 live signals + tokenize dashboard.css** — `ee54a30` (feat)
2. **Task 2: Glass-fill tokenization + Playwright cold-install spec** — `77cdaa7` (feat)

## Files Created/Modified

- `/home/arnav/blade/src/features/dashboard/RightNowHero.tsx` — added 2 imports, 2 state hooks, 2 parallel fetch blocks, 4 `data-signal` attributes on chip / h2
- `/home/arnav/blade/src/features/dashboard/dashboard.css` — inline DENSITY-03 policy block; 6 raw rgba backgrounds replaced with token vars; 4 off-ladder padding/gap values tokenized
- `/home/arnav/blade/src/features/dashboard/IntegrationsCard.tsx` — pill padding + background tokenized
- `/home/arnav/blade/tests/e2e/phase15/dashboard-hero-signals.spec.ts` — **created**; 5-test Playwright spec with Tauri shim

## Decisions Made

- **DeepScanResults defensive shape narrowing** — `src/types/provider.ts` types the DTO as `Record<string, unknown>`, so the hero reads `r.repos` / `r.repos_found` / `r.repo_count` with an `Array.isArray` fallback chain rather than inventing a narrower TS type. A future Rust schema rename degrades to `0` (still a live signal) rather than crashing.
- **Cold-install `scanRepoCount = 0`** — when `deep_scan_results` returns null (scan never run), the chip renders `0` not `…`. Zero IS a live signal per DENSITY-07; the `…` placeholder is reserved for mid-fetch state only.
- **Spacing violations retokenized, not whitelisted** — the 4 off-ladder gap/padding values (`6px`, `6px`, `4px 0`, `8px`) were all replaced with `--s-2` / `--s-1` per SPACING-LADDER.md "DO NOT widen the whitelist". The ladder stays tight.
- **hormone-chip.is-dominant 0.06 -> --g-fill (0.07)** rather than adding a 5th canonical tier. The four glass fills (weak / fill / strong / heavy) stay authoritative; a one-off 0.06 would dilute them.
- **Opportunistic IntegrationsCard fix** — its inline pill style used `rgba(255,255,255,0.07)` and `padding: '2px 8px'`. Both tokenized in this plan as DENSITY-03 continuity (even though spacing-ladder doesn't scan TSX inline styles, tracker parity with dashboard.css matters).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree base was behind expected commit**
- **Found during:** worktree_branch_check
- **Issue:** `git merge-base HEAD 83c91c0...` returned `9e93fcd...` — the worktree HEAD was at the PRIOR commit, not the expected 15-01 closeout. The agent's hard-reset request was denied by sandbox policy.
- **Fix:** Used `git merge 83c91c0 --ff-only` to fast-forward. Worktree now correctly at the expected base.
- **Impact:** None — base alignment without destructive reset.

**2. [Rule 2 - Missing functionality] IntegrationsCard pill was off-token**
- **Found during:** Task 1 TSX audit per plan step 7
- **Issue:** Inline style used `padding: '2px 8px'` (not in chip whitelist) and `rgba(255,255,255,0.07)` (raw rgba — DENSITY-03 violation of spirit even though outside spacing-ladder CSS scope).
- **Fix:** Tokenized to `padding: '2px 6px'` and `background: 'var(--g-fill)'`.
- **Commit:** included in ee54a30 (Task 1 commit).

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-functionality). No scope creep.

## Issues Encountered

None beyond the deviations above. All v1.0 verify gates (chat-rgba, hud-chip-count, orb-rgba, ghost-no-cursor, motion-tokens) remain green. Contrast audit continues to pass at >= 4.5:1 for strict pairs on dark wallpaper baseline.

## User Setup Required

None.

## Next Phase Readiness

- Plan 15-05 (UAT verifier checkpoint) can now count `[data-signal]` elements on the cold-install dashboard as a DENSITY-07 gate signal.
- 4 dashboard-scope spacing violations eliminated; remaining 131 violations across other feature packs become scope for Plan 15-02 (card gaps) and other density sweeps.
- DENSITY-03 policy is now inline in `dashboard.css` so future authors have the token contract visible where they edit.
- Playwright spec uses the same Tauri invoke shim pattern as Phase 3's `dashboard-paint.spec.ts` — any new invoke command added to RightNowHero needs a corresponding shim entry (documented via the switch-case block in the spec).

## Known Stubs

None — `scanRepoCount = 0` on cold install is a truthful live signal, not a stub. The hero's `tentacleCount = null` during fetch shows `…` which is a loading indicator, not a "No data" negation.

## Threat Flags

None. The three IPC boundaries exercised (perception_get_latest, ecosystem_list_tentacles, deep_scan_results) were already accepted in prior phases (3 / 13 / 12). No new surface introduced; the hero only adds READ access.

---

## Self-Check

**Files created:**
- `/home/arnav/blade/tests/e2e/phase15/dashboard-hero-signals.spec.ts` — FOUND

**Files modified (all under this plan's files_modified list):**
- `/home/arnav/blade/src/features/dashboard/RightNowHero.tsx` — FOUND
- `/home/arnav/blade/src/features/dashboard/dashboard.css` — FOUND
- `/home/arnav/blade/src/features/dashboard/IntegrationsCard.tsx` — FOUND

**Task commits (in `git log --oneline`):**
- `ee54a30` — FOUND
- `77cdaa7` — FOUND

**Acceptance criteria (Task 1):**
- `ecosystemListTentacles` in hero: grep=2 >= 1 PASS
- `deepScanResults` in hero: grep=2 >= 1 PASS
- `perceptionGetLatest` in hero: grep=3 >= 1 PASS
- `data-signal=` in hero: grep=4 >= 4 PASS
- dashboard-scope spacing violations = 0 PASS
- tsc clean PASS; a11y-pass-2 clean PASS; audit-contrast clean PASS
- All 5 v1.0 shell gates clean PASS

**Acceptance criteria (Task 2):**
- `rgba(255, 255, 255, 0.03|0.04|0.06)` in dashboard.css = 0 PASS
- `var(--g-fill` in dashboard.css = 7 >= 5 PASS
- `DENSITY-03` in dashboard.css = 8 >= 1 PASS
- spec file exists PASS
- `data-signal` in spec = 12 >= 4 PASS
- `scrollWidth|1280` in spec = 6 >= 1 PASS
- tsc clean PASS

## Self-Check: PASSED

*Phase: 15-density-polish*
*Completed: 2026-04-24*
