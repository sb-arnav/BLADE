---
phase: 02-onboarding-shell
plan: 03
subsystem: ui/shell
tags: [react, tauri-drag-region, titlebar, shell, css-motion, blade-status]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "design tokens (--title-height from layout.css, --t-1/2/3, --g-fill, --g-edge-lo, --r-pill, --r-sm, --dur-fast, --ease-smooth, --a-cool, --line, --font-mono); BLADE_EVENTS + useTauriEvent hook (P-06 handler-in-ref) from Plan 01-06"
  - plan: 02-01
    provides: "minimizeWindow / closeWindow / toggleMaximize wrappers under @/lib/tauri (via src/lib/tauri/window.ts)"
provides:
  - "TitleBar component — 40px drag region, macOS-style traffic lights, center title + live blade_status pill, right-side ⌘K hint chip"
  - "shell.css base — .titlebar, .titlebar-traffic, .tlight*, .titlebar-title, .titlebar-brand, .titlebar-status*, .titlebar-status-dot, .titlebar-hint; @keyframes titlebar-pulse"
  - "src/design-system/shell/index.ts — append-only barrel (Plans 02-05 / 02-06 add NavRail, CommandPalette, GlobalOverlays)"
affects: [02-05 (NavRail + CommandPalette append to this barrel and append rules to shell.css; also OWNS the @import of shell.css into src/styles/index.css per hand-off below), 02-06 (MainShell mounts TitleBar as first child of main-window layout)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tauri custom-decorations drag region (tauri.conf.json decorations:false + transparent:true) — data-tauri-drag-region on the header root; interactive children opt out via data-tauri-drag-region=\"false\" to defeat T-02-03-01 (drag-over-click)"
    - "Defensive payload narrowing at useTauriEvent boundary — literal-string check before setState so future Rust drift can't inject unknown status values into UI state (T-02-03-02 mitigation)"
    - "Token-only visual surface with deliberate system-native exception — traffic-light accents (#ff5f57 / #febc2e / #28c840) are platform convention and intentionally not tokenised"
    - "Colocated CSS (shell.css sits next to TitleBar.tsx under src/design-system/shell/) mirroring Phase 1 primitives.css colocation discipline (D-35)"
    - "Append-only shell barrel — each subsequent plan adds one line, never reshapes the API (D-51 shell-line-count budget)"

key-files:
  created:
    - "src/design-system/shell/TitleBar.tsx (128 lines) — header with 3-column grid, traffic lights, title + status pill, ⌘K hint; useTauriEvent(BLADE_STATUS) with literal-narrowing"
    - "src/design-system/shell/shell.css (142 lines) — .titlebar + .tlight* + .titlebar-status-{processing|thinking|idle|error} + .titlebar-hint; pure-CSS pulse animation; all values via var(--x) except 3 system-native traffic-light hexes"
    - "src/design-system/shell/index.ts (8 lines) — barrel exporting TitleBar; comment-documents the Plan 02-05 / 02-06 extension points"
  modified: []

key-decisions:
  - "shell.css @import in src/styles/index.css is deliberately DEFERRED to Plan 02-05 (explicit hand-off) — editing index.css here would collide with Plan 02-02 which already added the toast.css @import in the same Wave-1. Plan 02-05 owns the one-line append: @import '../design-system/shell/shell.css'; after the primitives.css line and before 'tailwindcss'"
  - "Window controls route through @/lib/tauri (minimizeWindow/closeWindow/toggleMaximize from Plan 02-01) instead of raw getCurrentWindow() — keeps a single wrappable surface for future mocking and matches D-36 file-per-cluster. The no-raw-tauri ESLint rule does NOT ban @tauri-apps/api/window, but the wrapper is preferred anyway."
  - "No role switcher (D-54) — role-switching is Phase 6 IDEN cluster; src.bak/TitleBar.tsx RoleSwitcher deliberately not ported (D-17 src.bak is dead reference)"
  - "blade_status pill state held in component-local useState, not context — TitleBar is the sole consumer; hoisting to context is deferred until a second consumer appears (YAGNI)"
  - "Traffic lights are <button type=\"button\"> with aria-label — native focus + keyboard activation for free; tlight:focus-visible ring uses --a-cool token (T-02-03-05 mitigation)"

requirements-completed: [SHELL-01]

# Metrics
duration: ~10min
completed: 2026-04-18
---

# Phase 2 Plan 03: TitleBar + shell.css Base Summary

**34px drag-region TitleBar with traffic lights, live blade_status pill, and ⌘K hint — SHELL-01 closed, shell-scope CSS base seeded for Plans 02-05 / 02-06 to append.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-04-18
- **Tasks:** 1/1
- **Files created:** 3 (TitleBar.tsx + shell.css + index.ts)
- **Files modified:** 0 (src/styles/index.css deliberately not touched — hand-off to Plan 02-05)

## Accomplishments

- `TitleBar` is a 3-column header (auto / 1fr / auto) with `data-tauri-drag-region` on the root so the whole bar drags the window. Traffic lights, the status pill, and the ⌘K hint opt out via `data-tauri-drag-region="false"` so clicks don't initiate drags (T-02-03-01 mitigation).
- Height sourced from `var(--title-height)` (40px in Phase 1 `layout.css`) — single source of truth; any shell-height retune is a one-line token edit.
- Traffic-light buttons call the `minimizeWindow` / `closeWindow` / `toggleMaximize` wrappers from `@/lib/tauri` (Plan 02-01). No raw `invoke` / `listen` imports.
- `blade_status` subscription via `useTauriEvent(BLADE_EVENTS.BLADE_STATUS, ...)` with a literal-check narrowing before `setState` — future Rust drift can't inject unknown strings into UI state (T-02-03-02 mitigation). Pill text toggles between `Working` / `Thinking` / `Ready` / `Error` with color-tinted dot + pulse animation on processing / thinking.
- `shell.css` ships the TitleBar visual surface only — `.titlebar`, `.titlebar-traffic`, `.tlight*`, `.titlebar-title`, `.titlebar-brand`, `.titlebar-status*`, `.titlebar-status-dot`, `.titlebar-hint`, plus `@keyframes titlebar-pulse`. Every value references `var(--x)` from `tokens.css` / `layout.css` / `motion.css` except the three macOS traffic-light hexes (#ff5f57 / #febc2e / #28c840) which are deliberate system-native accents.
- `index.ts` barrel exports `TitleBar`. Comment-documents Plan 02-05 (NavRail + CommandPalette) and Plan 02-06 (GlobalOverlays) as append-only extensions.

## Task Commits

1. **Task 1: TitleBar component + shell.css base + shell barrel** — `46c90f4` (feat)

## Explicit Hand-off: Plan 02-05

> **Plan 02-05 must add `@import '../design-system/shell/shell.css';` to `src/styles/index.css`** — insert after the `primitives.css` @import (line 19) and before `'tailwindcss'` (line 21). Plan 02-02's `toast.css` @import already occupies line 20, so the shell.css @import becomes line 21 (tailwindcss shifts to line 22).

### Why deferred

Plan 02-03 runs Wave-1 parallel with Plan 02-02 (Toast). Plan 02-02 edits `src/styles/index.css` to add the `toast.css` @import. Two Wave-1 plans editing the same file = intra-wave conflict. Plan 02-03's PLAN.md explicitly resolves this by handing the `shell.css` @import to Plan 02-05 (which already owns shell-scope CSS expansion for NavRail / CommandPalette).

### What Plan 02-05 does on its first task

```css
/* src/styles/index.css — add this line after primitives.css, before tailwindcss */
@import '../design-system/shell/shell.css';      /* Plans 02-03 + 02-05 + 02-06 — shell-scope rules */
```

Until that @import lands, `.titlebar` and its children render un-styled. Plan 02-06 (MainShell) is the first plan that actually mounts `<TitleBar/>` — Plan 02-05 is sequenced ahead of 02-06 in Wave 2, so the @import is in place before the component mounts.

## Deviations from Plan

### None — plan executed exactly as written.

The PLAN's `<action>` block lays out a Plan-B fallback ("if Plan 02-01 has not merged… inline the 3-line direct calls"). At execution time Plan 02-01 had in fact merged (`aa490c8 feat(02-01): add Tauri wrappers for provider setup + deep scan; fix DeepScanProgressPayload`), so the preferred path was taken: import from `@/lib/tauri`. No inline `getCurrentWindow()` fallback needed, no deviation against the plan.

## Threat-model outcomes

| Threat ID     | Category | Disposition | Status | Evidence                                                                                                            |
| ------------- | -------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| T-02-03-01    | Tampering | mitigate    | closed | `data-tauri-drag-region="false"` on `.titlebar-traffic`, the status pill `<span>`, and the `.titlebar-hint` wrapper |
| T-02-03-02    | Tampering | mitigate    | closed | Literal-check narrowing in `useTauriEvent` handler — unknown strings are ignored, not passed to `setState`          |
| T-02-03-03    | Elevation | accept      | n/a    | Tauri wrapper is the only window-control surface; user owns the window                                              |
| T-02-03-04    | DoS       | accept      | n/a    | React `setState` short-circuits when next === current; no infinite loop surface                                     |
| T-02-03-05    | Tampering | mitigate    | closed | `<button type="button">` with `aria-label` + `:focus-visible` ring using `var(--a-cool)` — keyboard + screen-reader reachable |

## Verification results

- `npx tsc --noEmit` — clean (no output)
- `npm run verify:all` — all 5 verify scripts green (entries, no-raw-tauri, migration-ledger, emit-policy, contrast)
- `grep @tauri-apps/api/(core|event|window) src/design-system/shell/` — no matches (only the wrapper import from `@/lib/tauri`)
- No files outside `src/design-system/shell/` modified

## Known Stubs

None — `TitleBar` is fully wired. The ⌘K hint chip is intentionally *visual-only* in this plan (Plan 02-05 wires the actual keyboard capture and palette open), which is explicit plan scope, not a stub.

## Self-Check: PASSED

**Files created (all present):**
- `src/design-system/shell/TitleBar.tsx` — FOUND
- `src/design-system/shell/shell.css` — FOUND
- `src/design-system/shell/index.ts` — FOUND

**Commits present:**
- `46c90f4` — FOUND (`git log --oneline | grep 46c90f4` → match)
