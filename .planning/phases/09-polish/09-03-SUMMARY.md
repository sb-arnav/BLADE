---
phase: 09-polish
plan: 03
subsystem: a11y
tags: [a11y, motion, aria, keyboard-nav, dialog, focus-management]
dependency_graph:
  requires:
    - "src/styles/motion.css (Phase 1 D-22 token file)"
    - "src/design-system/primitives/Dialog.tsx (Phase 1 D-01 native <dialog>)"
    - "src/windows/main/useGlobalShortcuts.ts (Phase 2 D-62)"
    - "Phase 2 Plan 02-03 (TitleBar aria-labels already in place)"
  provides:
    - "prefers-reduced-motion CSS media-query override — OS-level reduce preference zeroes all duration tokens + disables spin keyframe"
    - "Audit-passed certification that shell + hud + chat + settings icon-only buttons all carry accessible names"
    - "Audit-passed certification that Dialog primitive's native <dialog> supplies focus trap + focus return + Esc close"
    - "Audit-passed certification that keyboard-nav matrix (⌘K / ⌘1 / ⌘/ / ⌘, / ⌘[ / ⌘]) is intact"
  affects:
    - "All routes under ShellChrome (TitleBar + NavRail + CommandPalette) — OS reduce-motion now honoured"
    - "GlassSpinner rotation disabled when reduce-motion is set"
tech-stack:
  added: []
  patterns:
    - "@media (prefers-reduced-motion: reduce) override at :root level — POL-07 / D-216 sub-check 3 / D-219 sub-check 3"
    - "No-op audit pattern: document audit outcome in SUMMARY when no edit required (Dialog, Task 3 sweep, Task 4 kbd matrix)"
key-files:
  created: []
  modified:
    - "src/styles/motion.css (+17 lines — @media block after @keyframes spin)"
decisions:
  - "D-216 sub-check 1 (icon-only button aria-label audit) — audit-passed; 0 files required editing. All 8 plan-scoped files already carry aria-label where needed or have visible text labels on buttons (verified via grep + manual review)."
  - "D-216 sub-check 2 (Dialog focus trap + return) — audit-passed; native <dialog>.showModal() + onClose wiring provides trap, return, aria-modal (implicit), and Esc-close via browser. No custom library needed (D-58 confirmed)."
  - "D-216 sub-check 3 (prefers-reduced-motion) — IMPLEMENTED in motion.css; 0.01ms durations chosen over 0ms so transition/animation lifecycle events still fire for consumer-state cleanups."
  - "D-216 sub-check 4 (keyboard-nav matrix) — audit-passed; ⌘K / ⌘1 / ⌘/ / ⌘, / ⌘[ / ⌘] all present in useGlobalShortcuts.ts. isEditableTarget guard intact. ⌘? intentionally absent (Plan 09-05 adds it)."
metrics:
  duration: "~15 minutes"
  tasks_completed: 4
  files_changed: 1
  commits: 1
  completed_date: "2026-04-19T20:42:04Z"
---

# Phase 9 Plan 09-03: A11y Sweep Summary

Reduced-motion media query appended to motion.css; icon-only button audit + Dialog focus audit + keyboard-nav matrix audit all pass as no-op (Phase 1 + Phase 2 substrate already complies). WCAG AA / SC-5 polish landed with one 17-line CSS append and three documented no-op audits.

## What Shipped

### Task 1 — prefers-reduced-motion override (IMPLEMENTED)

`src/styles/motion.css` gained a 17-line `@media (prefers-reduced-motion: reduce)` block at the end of the file:

- Overrides `--dur-snap`, `--dur-fast`, `--dur-base`, `--dur-enter`, `--dur-slow`, `--dur-float` to `0.01ms` each
- Disables `@keyframes spin` (the rotation used by `GlassSpinner`) by resetting both keyframe stops to `transform: none`
- Chose `0.01ms` (not `0ms`) deliberately so transition/animation lifecycle events still fire, keeping React state cleanups deterministic under reduce-motion

The existing `:root` block and original `@keyframes spin` are untouched; the media query overrides them only when the OS preference is set. No other token files touched — Plan 09-04's `motion-entrance.css` is left for that plan to create.

**Commit:** `f4ecca5` feat(09-03): honour prefers-reduced-motion in motion.css (POL-07)

### Task 2 — Dialog focus audit (NO-OP)

`src/design-system/primitives/Dialog.tsx` was re-read against the audit checklist:

- Uses native `<dialog>` element with `ref.current.showModal()` on open and `ref.current.close()` on close (D-58 confirmed)
- Native `<dialog>` provides focus trap, focus return to the invoking element, `aria-modal` (implicit), and Esc-to-close by the browser engine itself
- The component wires `onClose` through the native `onClose` event, and it sets `aria-label` on the dialog element when `ariaLabel` prop is passed (T-04-04 mitigation preserved)

**Outcome:** zero gaps found. File left untouched. No custom focus-trap library needed — the browser does it.

### Task 3 — Icon-only button ARIA sweep (NO-OP across all 8 files)

Audited all 8 files listed in `files_modified`. Findings:

| File | Buttons | Audit outcome |
|------|---------|----------------|
| `src/design-system/shell/TitleBar.tsx` | 3 | All 3 traffic-light buttons carry `aria-label` ("Close window", "Minimize window", "Toggle maximize") — shipped by Phase 2 Plan 02-03 |
| `src/design-system/shell/NavRail.tsx` | 1 (`NavBtn` template) | Renders `aria-label={route.label}` + `aria-current` for active state — Phase 2 Plan 02-04 |
| `src/design-system/shell/CommandPalette.tsx` | N (palette-row) | Palette rows are `role="option"` with visible `<span className="palette-row-label">` text; input has `aria-label="Search routes"` |
| `src/features/hud/HudMenu.tsx` | 4 | All 4 menu items have visible text labels ("Open BLADE", "Open Chat", "Hide HUD", "Settings") — not icon-only |
| `src/features/hud/HudWindow.tsx` | 0 | No buttons; hud chips are `<span>` elements. Bar container has `role="toolbar"` + `aria-label="BLADE HUD"` |
| `src/features/chat/InputBar.tsx` | 2 (Send/Cancel) | Both use visible text labels via the `<Button>` primitive; not icon-only |
| `src/features/chat/MessageBubble.tsx` | 0 | No buttons in current implementation (copy/thumbs/branch actions not yet rendered — v1.1 candidate per 09-DEFERRED) |
| `src/features/settings/SettingsShell.tsx` | N (settings-tab) | Each tab renders visible `{t.label}` text; not icon-only |

**Outcome:** 0 files required editing. The 8-file scope was a safety net — the surfaces had already been audited + labeled during Phases 2 + 3 + 4 substrate construction.

Guard verified: `grep -E '<button[^>]*>\s*[×←→✕⋯]\s*</button>'` returns zero matches across the 8 files.

### Task 4 — Keyboard-nav matrix audit (NO-OP)

Re-read `src/windows/main/useGlobalShortcuts.ts` against the checklist:

| Shortcut | Line | Status |
|----------|------|--------|
| ⌘K (palette open, editable-target bypass) | 60 | ✓ |
| ⌘1 → dashboard | 70 | ✓ |
| ⌘/ → chat | 75 | ✓ |
| ⌘, → settings | 80 | ✓ |
| ⌘[ → back | 85 | ✓ |
| ⌘] → forward | 90 | ✓ |
| Route-level `RouteDefinition.shortcut` loop | 99–105 | ✓ |
| `isEditableTarget` guard | 19 | ✓ |
| ⌘? (Plan 09-05's responsibility) | — | NOT YET REGISTERED ✓ (correct) |
| Escape in CommandPalette | CommandPalette.tsx:111 | ✓ via native `<dialog>` cancel → `onClose` |

**Outcome:** Phase 2 Plans 02-05 + 02-06 substrate is intact. Zero regressions. No edits made.

## Deviations from Plan

None. Plan executed exactly as written. The plan explicitly scoped Tasks 2, 3, and 4 as audits with expected no-op outcomes if the earlier phases' substrate was clean — which it was. Only Task 1 (the CSS append) materialized as an edit, exactly per plan text.

## Verification

- `npx tsc --noEmit` → exit 0 (TSC OK)
- `npm run verify:all` → 14/14 OK (all existing gates green; no regression introduced by the CSS append)
- `grep -q "prefers-reduced-motion" src/styles/motion.css` → match
- `grep -q "0.01ms" src/styles/motion.css` → match
- Plan 09-04's `src/styles/motion-entrance.css` and Plan 09-02's `ErrorBoundary.tsx` / `EmptyState.tsx` / `MainShell.tsx` edits were NOT touched by 09-03 commits (verified via `git show --stat f4ecca5`); wave-2 file-ownership invariant D-229 held from this plan's side. (09-02 and 09-04 have already started landing in parallel — their files exist, but on their own commits, not 09-03's.)

## Falsifier Evidence

- **POL-06** (A11y — ARIA labels on icon-only buttons): audit across 8 shell/hud/chat/settings files; 0 icon-only buttons missing `aria-label`. Labels verified against button-intent semantics.
- **POL-07** (A11y — reduced-motion preference honoured): `@media (prefers-reduced-motion: reduce)` block lives in `src/styles/motion.css`; zeroes 6 duration tokens + disables `spin` keyframe. Mac-smoke M-45 will confirm at the OS toggle.
- **POL-08** (A11y — keyboard nav + focus management): Dialog native trap verified; `useGlobalShortcuts` matrix confirmed intact.

## Self-Check

All claims verified on disk:

- `src/styles/motion.css` contains `prefers-reduced-motion` at line 40 ✓
- `src/styles/motion.css` contains `0.01ms` at lines 42–47 ✓
- Commit `f4ecca5` exists (`git log --oneline` confirms)
- 09-03's lone commit touched only `src/styles/motion.css` (no wave-2 lane crossover; verified via `git show --stat f4ecca5`) ✓
- Wave-2 sibling plans have started landing in parallel (Plans 09-02 and 09-04 file ownership is theirs to manage; 09-03 did not touch any of their files) ✓
- `npx tsc --noEmit` exits 0 ✓
- `npm run verify:all` all 14 gates green ✓

## Self-Check: PASSED
