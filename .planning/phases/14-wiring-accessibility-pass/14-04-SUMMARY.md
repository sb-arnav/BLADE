---
phase: 14-wiring-accessibility-pass
plan: "04"
subsystem: verify-scripts, a11y, design-system
tags: [a11y, verify, dialog, focus-management, reduced-motion, WIRE2, A11Y2]
dependency_graph:
  requires: [14-01]
  provides: [verify-feature-reachability-hardened, verify-a11y-pass-2-hardened, dialog-focus-management]
  affects: [14-02, 14-03, verify:all]
tech_stack:
  added: []
  patterns:
    - prevFocusRef pattern for Dialog focus capture/restore
    - prefers-reduced-motion block extraction for CSS transitions
    - not_wired_backlog cross-reference for DEFERRED_V1_2 exclusion
key_files:
  created: []
  modified:
    - scripts/verify-feature-reachability.mjs
    - scripts/verify-a11y-pass-2.mjs
    - src/design-system/primitives/Dialog.tsx
    - src/features/dashboard/dashboard.css
decisions:
  - "DEFERRED_V1_2 exclusion reads from not_wired_backlog array (has phase_14_owner) not modules array (does not)"
  - "verify:a11y-pass-2 scope expanded to dashboard + settings panes, not just activity-log"
  - "dashboard.css transitions moved to prefers-reduced-motion blocks (Rule 1 auto-fix)"
metrics:
  duration: "5m"
  completed: "2026-04-24T07:52:29Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
---

# Phase 14 Plan 04: Verify Script Hardening + A11Y Pass Summary

**One-liner:** Hardened verify-feature-reachability (DEFERRED_V1_2 fix + --verbose/--summary flags) and verify-a11y-pass-2 (Phase 14 full scope), fixed Dialog focus management (aria-modal + prevFocusRef + first-child focus), and fixed 2 unconditional CSS transitions in dashboard.css.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Harden verify scripts + fix Dialog focus management | 8a301a9 | verify-feature-reachability.mjs, verify-a11y-pass-2.mjs, Dialog.tsx, dashboard.css |
| 2 | A11y audit and fixes on Phase 14 surfaces | (no-op — surfaces already compliant) | — |

---

## What Was Built

### verify-feature-reachability.mjs (hardened)

- **Bug fix (Rule 1):** Script was reading `phase_14_owner` from `audit.modules[]` — that field does not exist on modules. The canonical `phase_14_owner` lives in `audit.not_wired_backlog[]`. Fixed by building a `deferredFiles` Set from `not_wired_backlog` first, then cross-referencing when iterating `modules`.
- **--verbose flag:** Prints each item as `WIRED / MISSING / DEFERRED` with filename.
- **--summary flag:** Prints only counts (e.g. "2 wired, 45 missing, 2 deferred"). Default when no flag given.
- **Improved invokeTyped regex:** Now matches `invokeTyped<T>('cmd')` and `invokeTyped<T, U>('cmd')` in addition to the plain form.
- **Exit contract:** exit 0 = all WIRE2 module items have call sites; exit 1 = at least one missing. DEFERRED_V1_2 items (discord.rs, session_handoff.rs) are excluded from the check.

### verify-a11y-pass-2.mjs (hardened)

- **Scope expanded:** Was only scanning `src/features/activity-log/`. Now scans:
  - `src/features/activity-log/**/*.{tsx,css}` (activity log surfaces)
  - `src/features/dashboard/**/*.{tsx,css}` (WIRE2 dashboard additions)
  - `src/features/settings/panes/**/*.{tsx,css}` (Phase 14 settings additions)
  - `src/windows/main/MainShell.tsx` (if it imports activity-log)
- **Scan summary line:** Prints scanned file counts before pass/fail verdict.
- **Deduplication:** Files discovered via multiple paths are deduplicated before scanning.
- Scans 24 TSX + 2 CSS files total across Phase 14 surfaces.

### Dialog.tsx (A11Y2-04 focus management)

Added per A11Y2-04 requirement:
- `aria-modal="true"` on the `<dialog>` element (screen reader modal semantics)
- `prevFocusRef` that captures `document.activeElement` BEFORE calling `el.showModal()`
- After `showModal()`, focuses the first focusable child via `el.querySelector(FOCUSABLE)` where FOCUSABLE covers button, [href], input, select, textarea, [tabindex]:not(-1)
- On close (`open → false`), restores focus to `prevFocusRef.current` (or to `triggerRef.current` if the optional `triggerRef` prop is provided)
- New optional `triggerRef?: React.RefObject<HTMLElement>` prop for callers that maintain their own trigger ref

### dashboard.css (Rule 1 auto-fix — reduced-motion)

Two unconditional `transition:` declarations discovered by the expanded verify-a11y-pass-2 scan:
- `.hormone-chip { transition: background ... }` — moved inside `@media (prefers-reduced-motion: no-preference)`
- `.coming-soon-card { transition: opacity ... }` — moved inside `@media (prefers-reduced-motion: no-preference)`

Both were missed by the prior `verify:motion-tokens` script because that script uses a shell regex against `src/` and catches `linear` keyword specifically; these transitions used `ease-out` and slipped through. The new `verify-a11y-pass-2` CSS rule catches all `transition:` declarations outside reduced-motion blocks.

---

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS — 0 errors |
| `verify:feature-reachability --summary` | Runs without throw; shows counts correctly (2 wired, 45 missing, 2 deferred) |
| `verify:a11y-pass-2` | PASS — 0 violations, 24 TSX + 2 CSS files scanned |
| `verify:aria-icon-buttons` | PASS — 201 TSX files scanned, 0 violations |
| `verify:motion-tokens` | PASS — 0 rogue transitions |
| `verify:contrast` | PASS — all strict pairs ≥ 4.5:1 |
| `grep "aria-modal" Dialog.tsx` | FOUND |
| `grep "prevFocusRef" Dialog.tsx` | FOUND |

**Note on verify:feature-reachability exit code:** The script correctly exits 1 because 45 of 47 WIRE2 module wrappers have not yet been added. This is expected at Wave 1 — the wrappers are created by plans 14-02 and 14-03 running in parallel. The script's correctness contract (runs without throw, counts correctly, excludes DEFERRED_V1_2) is satisfied.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] verify-feature-reachability DEFERRED_V1_2 exclusion was broken**
- **Found during:** Task 1 analysis
- **Issue:** Script checked `mod.phase_14_owner === 'DEFERRED_V1_2'` on modules from `audit.modules[]`, but that field is not present on module objects — it only exists on `audit.not_wired_backlog[]` items. The DEFERRED check was silently always-false.
- **Fix:** Build `deferredFiles` Set by iterating `not_wired_backlog` first; cross-reference by filename when processing `modules`.
- **Files modified:** `scripts/verify-feature-reachability.mjs`
- **Commit:** 8a301a9

**2. [Rule 2 - Missing] verify:motion-tokens did not catch ease-out transitions**
- **Found during:** Task 1 (running expanded verify-a11y-pass-2)
- **Issue:** `verify:motion-tokens` script (shell-based) only flags transitions containing the word "linear". Two transitions in `dashboard.css` used `ease-out` and slipped through. They were unconditional and violate A11Y2-05.
- **Fix:** Added CSS Rule 3 to `verify-a11y-pass-2.mjs` that catches ALL `transition:` / `animation:` outside reduced-motion blocks regardless of easing keyword. Fixed the two violations in `dashboard.css`.
- **Files modified:** `scripts/verify-a11y-pass-2.mjs`, `src/features/dashboard/dashboard.css`
- **Commit:** 8a301a9

---

## Known Stubs

None — this plan creates no UI stubs. The verify scripts are production-ready gates.

---

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. The verify scripts are local build-time tools with read-only filesystem access.

---

## Self-Check: PASSED

- `scripts/verify-feature-reachability.mjs` — FOUND and runs: `node scripts/verify-feature-reachability.mjs --summary` → prints counts, exits 1 (expected pre-wiring)
- `scripts/verify-a11y-pass-2.mjs` — FOUND and exits 0
- `src/design-system/primitives/Dialog.tsx` — FOUND; contains aria-modal, prevFocusRef, querySelector
- `src/features/dashboard/dashboard.css` — FOUND; transitions moved to reduced-motion blocks
- Commit 8a301a9 — confirmed in `git log`
