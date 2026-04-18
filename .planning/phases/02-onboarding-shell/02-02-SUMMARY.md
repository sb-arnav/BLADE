---
phase: 02-onboarding-shell
plan: 02
subsystem: ui
tags: [react, context, portal, tauri-events, toast, css-motion]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "BLADE_EVENTS registry + useTauriEvent hook (P-06 handler-in-ref); glass.css .glass/.glass-1 base; design tokens (--r-md, --t-1/2/3, --g-shadow-sm, --dur-enter, --ease-out); primitives.css layered classes"
provides:
  - "ToastProvider + useToast() hook — sole toast surface, 5-concurrent cap, 4s info/success + 7s warn/error auto-dismiss, timer cleanup on unmount"
  - "ToastViewport — bottom-right portal to document.body with glass-1 + colored left bar + icon + dismiss button (survives Dialog z-index stacking)"
  - "BackendToastBridge — single useTauriEvent per blade_notification / blade_toast / shortcut_registration_failed (D-60), mount-once component"
  - "toast.css — pure CSS @keyframes enter, tokens only, sky/emerald/amber/red type tints, clamped 3-line message, z-index 1000 above Dialog backdrop"
  - "Barrel re-exports from @/lib/context (ToastProvider, useToast, BackendToastBridge, ToastType, ToastItem)"
affects: [02-04 onboarding (surfaces test-provider failures as error toasts), 02-05 CommandPalette (uses useToast for feedback), 02-06 MainShell (mounts ToastProvider + BackendToastBridge in one line), 03-chat (future retry toasts), 03-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "React Context + portal viewport: provider owns state/timers, viewport is a pure render function portaled to document.body so Dialog z-index stacking is a non-issue"
    - "Timer-map ref pattern: timeouts stored by id in useRef<Map<string, number>>; cleared on dismiss AND on provider unmount to eliminate late-fire setItems after teardown"
    - "Single-listen-per-event discipline via useTauriEvent (P-06): BackendToastBridge is the sole subscriber to blade_notification/blade_toast/shortcut_registration_failed"
    - "CSS @import chain after primitives.css, before Tailwind directives — keeps cascade deterministic (D-23)"
    - "Type-token mapping via CSS class selector (.toast-{info|success|warn|error}): no runtime style objects, no inline styles, all visuals via CSS"

key-files:
  created:
    - "src/lib/context/ToastContext.tsx (110 lines) — provider + useToast hook + DEFAULT_DURATION map"
    - "src/lib/context/ToastViewport.tsx (71 lines) — portal-rendered bottom-right viewport"
    - "src/lib/context/BackendToastBridge.tsx (62 lines) — 3 useTauriEvent subscribers → show()"
    - "src/lib/context/toast.css (137 lines) — .toast-viewport, .toast, .toast-bar, .toast-icon, .toast-{type} tints + toast-in @keyframes"
  modified:
    - "src/lib/context/index.ts — appended ToastProvider, useToast, ToastType, ToastItem, BackendToastBridge re-exports"
    - "src/styles/index.css — added @import '../lib/context/toast.css' after primitives.css, before Tailwind"

key-decisions:
  - "Timer-cleanup Map lives in a ref (not state) so dismiss doesn't trigger re-render just to free a timeout — keeps the setItems path and the timer path orthogonal"
  - "normaliseType() accepts string | undefined and collapses 'warning' → 'warn' at the bridge boundary (not in the provider) so backend payload drift doesn't leak into UI types"
  - "CSS-only motion via toast-in @keyframes — D-02 compliance (no Framer Motion added); uses var(--dur-enter)/var(--ease-out) with safe fallbacks"
  - "Portal target is document.body (not a named mount node) — survives Dialog teardown and avoids coupling to a specific shell layout"
  - "ShowInput overlay type keeps the public signature shape-stable: consumers pass {type, title, message?, durationMs?} and receive the generated id back"

patterns-established:
  - "Context-provider split across 3 files: ToastContext.tsx (state+API), ToastViewport.tsx (render strategy), BackendToastBridge.tsx (event plumbing). Plan 06 mounts all three in one line."
  - "SSR-safe portal guard: useState(false)→useEffect(()=>setMounted(true)) + typeof document !== 'undefined' lets the viewport short-circuit in any non-DOM test harness"

requirements-completed: [SHELL-04]

# Metrics
duration: 4min
completed: 2026-04-18
---

# Phase 2 Plan 02: Toast Context + Viewport + BackendToastBridge Summary

**React-context toast system with portal viewport and a single-subscription Rust-event bridge — SHELL-04 closed, ready for Plan 06 MainShell to mount.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-18T21:16:04Z
- **Completed:** 2026-04-18T21:20:00Z (approx)
- **Tasks:** 1/1
- **Files modified:** 6 (4 created + 2 edited)

## Accomplishments

- `ToastProvider` / `useToast()` with 5-concurrent cap and per-type auto-dismiss (4s info/success, 7s warn/error) — all magic numbers encoded in `DEFAULT_DURATION` map (success criterion satisfied).
- `ToastViewport` renders via `createPortal(..., document.body)` so Dialog (CommandPalette) z-index stacking is a non-issue.
- `BackendToastBridge` subscribes `blade_notification` + `blade_toast` + `shortcut_registration_failed` via three `useTauriEvent` hooks — P-06 single-listen discipline preserved.
- `toast.css` defines the full visual surface (viewport, panel, bar, icon, body, title, message, dismiss, type-specific tints) using design tokens and a pure CSS `@keyframes toast-in` entry animation — no Framer Motion added (D-02).
- Barrel `src/lib/context/index.ts` re-exports everything; `src/styles/index.css` pulls `toast.css` into the cascade chain at the correct position (after primitives, before Tailwind).

## Task Commits

1. **Task 1: Toast Context + Viewport + CSS + backend bridge** — `f404929` (feat)

_No TDD gates — plan is type=execute, not type=tdd._

## Files Created/Modified

- `src/lib/context/ToastContext.tsx` (created, 110 lines) — ToastProvider, useToast hook, ToastType/ToastItem types, DEFAULT_DURATION map, MAX_CONCURRENT=5 cap, timer-map ref with unmount cleanup.
- `src/lib/context/ToastViewport.tsx` (created, 71 lines) — portal to document.body, glass-1 panels, ICONS map, SSR-safe mount guard.
- `src/lib/context/BackendToastBridge.tsx` (created, 62 lines) — 3× `useTauriEvent` subscriptions mapped to `show()`, `normaliseType()` folds 'warning' → 'warn' at the bridge boundary.
- `src/lib/context/toast.css` (created, 137 lines) — viewport layout, panel grid, type-specific bar/icon tints (sky/emerald/amber/red), toast-in @keyframe.
- `src/lib/context/index.ts` (modified) — appended ToastProvider/useToast/ToastType/ToastItem/BackendToastBridge re-exports.
- `src/styles/index.css` (modified) — added `@import '../lib/context/toast.css';` after primitives.css import and before `@import 'tailwindcss';`.

## Decisions Made

- **Timer cleanup lives in a ref, not state.** `useRef<Map<string, number>>` holds the active `setTimeout` handles so `dismiss()` can clear both the visual state and the pending timer in a single call without triggering an extra re-render.
- **Bridge normalises type at the boundary.** `normaliseType()` in BackendToastBridge accepts `string | undefined` (not a narrowed union) so any future Rust-side payload drift surfaces as `'info'` instead of a TS compile error at the call site — keeps the hot path resilient.
- **Portal target is `document.body`, not a named mount node.** Survives Dialog teardown and decouples the toast surface from any particular shell layout (Plan 06 can reshape MainShell without touching this).
- **`DEFAULT_DURATION` map instead of inline ternaries.** The success criterion "auto-dismiss default encoded as a map (not scattered magic numbers)" is enforced by a single `Record<ToastType, number>` at module scope.
- **CSS-only motion.** `@keyframes toast-in` on the panel + `transition`s on hover — no Framer import added, D-02 preserved.

## Deviations from Plan

None — plan executed exactly as written. The planner provided complete file bodies in the `<action>` block; implementation transcribed them with only cosmetic formatting (Prettier-style line breaks on long function signatures, and a slight JSDoc/comment expansion on `normaliseType` for readability).

## Issues Encountered

- **Transient `tsc` false positive.** On the first `npx tsc --noEmit` run, the compiler flagged `ProviderKeyList` in `src/lib/tauri/config.ts` as unused — but that file is in Plan 02-01's lane (modified on disk by the parallel executor) and the import IS used on the same file. Re-running `tsc` immediately resolved to exit 0. Attributed to a stale `tsbuildinfo`-level cache interaction with in-flight file writes; not a defect introduced by this plan and not acted on (Rule: do not touch parallel lane files).

## Self-Check

Verified:

- `src/lib/context/ToastContext.tsx` — FOUND (exports `ToastProvider`, `useToast`, `ToastType`, `ToastItem`)
- `src/lib/context/ToastViewport.tsx` — FOUND (imports `createPortal` from `react-dom`, targets `document.body`)
- `src/lib/context/BackendToastBridge.tsx` — FOUND (3 `useTauriEvent` call sites confirmed via grep)
- `src/lib/context/toast.css` — FOUND (all required classes present: `.toast-viewport`, `.toast`, `.toast-bar`, `.toast-info`, `.toast-success`, `.toast-warn`, `.toast-error`)
- `src/lib/context/index.ts` — UPDATED (re-exports ToastProvider, useToast, ToastType, ToastItem, BackendToastBridge)
- `src/styles/index.css` — UPDATED (`@import '../lib/context/toast.css'` present after primitives.css, before tailwindcss)
- Commit `f404929` — FOUND in `git log --oneline`
- `npx tsc --noEmit` — EXIT 0
- `npm run verify:all` — EXIT 0 (verify:entries, verify:no-raw-tauri, verify:migration-ledger, verify:emit-policy, verify:contrast all PASS)
- No destructive deletions in the commit (`git diff --diff-filter=D HEAD~1 HEAD` empty)

## Self-Check: PASSED

## Next Phase Readiness

- **Plan 02-05 (CommandPalette):** can import `useToast` from `@/lib/context` for palette-action feedback.
- **Plan 02-06 (MainShell):** mounts `<ToastProvider>` at the shell root and drops `<BackendToastBridge />` inside it — one line each, no other wiring required.
- **Plan 02-04 (Onboarding):** can surface `test_provider` failures as `show({ type: 'error', title, message })`.
- **No blockers.** Toast system is fully standalone and does not depend on CommandPalette, NavRail, or onboarding surfaces (per plan must-have truth).

---
*Phase: 02-onboarding-shell*
*Plan: 02 (Toast Context + Viewport + BackendToastBridge)*
*Completed: 2026-04-18*
