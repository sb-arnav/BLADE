---
phase: 02-onboarding-shell
plan: 06
subsystem: ui/shell
tags: [react, shell, onboarding-gate, router, suspense, lazy-routes, global-overlays, bootstrap]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "GlassSpinner primitive; DEFAULT_ROUTE_ID + RouteDefinition; ROUTE_MAP; design tokens (--title-height, --nav-width, --r-pill, --t-3, --g-edge-lo, --font-mono); BLADE_EVENTS + useTauriEvent (P-06 handler-in-ref); ConfigProvider + useConfig"
  - plan: 02-01
    provides: "getOnboardingStatus wrapper; TauriError class; setConfig/completeOnboarding (consumed transitively by OnboardingFlow)"
  - plan: 02-02
    provides: "ToastProvider + useToast + BackendToastBridge (SHELL-04)"
  - plan: 02-03
    provides: "TitleBar component + shell.css base"
  - plan: 02-04
    provides: "OnboardingFlow non-lazy export + useResetOnboarding (D-48 gate)"
  - plan: 02-05
    provides: "RouterProvider + useRouterCtx + useRouter + useGlobalShortcuts + NavRail + CommandPalette + shell.css @import (SHELL-02/03/06/07)"
provides:
  - "useOnboardingGate hook — 2-signal gate ({config.onboarded} AND get_onboarding_status()); returns {status, reEvaluate, error}; fails open within onboarding boundary on Tauri error (D-46, T-02-06-04)"
  - "MainShell component — composes TitleBar + NavRail + Suspense(lazy route) + GlobalOverlays + CommandPalette once gate is complete; renders OnboardingFlow under TitleBar otherwise; mounts BackendToastBridge once (D-48, D-51)"
  - "Thin main.tsx bootstrap — ConfigProvider > ToastProvider > MainShell; preserves D-29 P-01 perf marks (boot → first-paint); 26 effective / 80-line budget"
  - "GlobalOverlays stubs — 3 event-subscribing DEV pills (catchup / ambient / nudge) wired through useTauriEvent; real UI is Phase 3 per D-61 (T-02-06-07 listener hygiene preserved)"
  - "shell.css extended with .main-shell grid + .main-shell-body + .main-shell-route + .onb-surface + .global-overlays + .overlay-stub rules"
affects:
  - "02-07 Playwright specs: shell.spec.ts + onboarding-boot.spec.ts have concrete DOM to assert (data-gate-status on .main-shell, data-route-id on RouteSlot, data-overlay on stubs)"
  - "03-dashboard / 03-chat / 03-settings: the RouteSlot is now live — any RouteDefinition registered today renders inside Suspense without further shell edits"
  - "Phase 3 ambient-strip rewrite: replaces GlobalOverlays stubs with real Catchup / Ambient / Nudge UIs (same event subscriptions, enriched renders)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-gate site: useOnboardingGate() called exactly once in ShellContent; full route tree only rendered when status === 'complete' (T-02-06-03, T-02-06-05)"
    - "Composed provider hierarchy: RouterProvider wraps BackendToastBridge + ShellContent so the bridge and the palette's shortcut hook both live inside the router context surface"
    - "Suspense boundary local to RouteSlot (not wrapping the whole shell) — TitleBar + NavRail render immediately, only the route lane shows the GlassSpinner fallback"
    - "Append-only barrel discipline: src/design-system/shell/index.ts gains exactly one new export (GlobalOverlays) per D-51"
    - "DEV-only overlay bodies via import.meta.env.DEV guard — stubs don't ship in prod bundle, Phase 3 swaps the body with real UI"
    - "Fail-open gate on Tauri error: getOnboardingStatus() rejection sets personaDone=false, so the user lands on the persona step with a retry path rather than an infinite spinner"

key-files:
  created:
    - "src/windows/main/useOnboardingGate.ts (65 lines) — 2-signal gate hook; re-evaluates by awaiting both reload() + getOnboardingStatus() in sequence (T-02-06-02 race mitigation)"
    - "src/windows/main/MainShell.tsx (126 raw / 93 effective lines) — ShellContent owns the palette state + shortcut hook; RouteSlot fetches from ROUTE_MAP with DEFAULT_ROUTE_ID fallback; SuspenseFallback reuses GlassSpinner"
    - "src/design-system/shell/GlobalOverlays.tsx (64 lines) — 3 DEV-only stubs wired to BLADE_STATUS / GODMODE_UPDATE / PROACTIVE_NUDGE via useTauriEvent"
  modified:
    - "src/windows/main/main.tsx — shrunk from 65-line AppShell to 50-line thin bootstrap (26 effective); ConfigProvider > ToastProvider > MainShell; perf marks preserved"
    - "src/design-system/shell/index.ts — appended `export { GlobalOverlays } from './GlobalOverlays';`"
    - "src/design-system/shell/shell.css — appended .main-shell / .main-shell-body / .main-shell-route / .onb-surface / .global-overlays / .overlay-stub rules; every value tokenised"

key-decisions:
  - "useOnboardingGate returns a 4-state status enum (checking | needs_provider_key | needs_persona | complete) rather than the plan's 3-state template — the split surfaces WHICH signal failed to consumers (useful for Phase 3 Settings telemetry) without changing MainShell branching behaviour"
  - "RouterProvider wraps BackendToastBridge (not the other way round) — useGlobalShortcuts needs useRouterCtx to navigate via ⌘1/⌘//⌘,; mounting BackendToastBridge under RouterProvider keeps a single tree and avoids duplicate Context instances"
  - "RouteSlot wraps <Cmp/> in a data-route-id div for e2e selector stability — Plan 02-07 Playwright can assert `[data-route-id=dashboard]` regardless of what the route renders internally"
  - "GlobalOverlays wrapper always renders (even in prod) so the .global-overlays positioning cell is always present; only the stub contents gate on import.meta.env.DEV. This keeps the layout stable for Phase 3 when real UIs drop in (no CSS reflow on prod→dev parity tests)"
  - "Suspense fallback is a local helper (SuspenseFallback) rather than inline JSX so MainShell stays readable — the fallback is reused only once today but splitting it out makes Phase 9 per-route skeletons a trivial swap"
  - "Did NOT touch STATE.md / ROADMAP.md per explicit instruction — state updates are owned by the orchestrator, not the sub-agent"

patterns-established:
  - "2-signal gate composition: a gate hook returning a typed status enum + a reEvaluate callback is the seam between first-run flow (OnboardingFlow) and steady-state routing (MainShell); the callback awaits every dependency reload before re-asserting"
  - "Shell composition as a two-layer component: outer MainShell owns the tree-shape (RouterProvider + bridges), inner ShellContent owns state (palette, gate) — keeps the outer export diffable when state needs to move between layers"
  - "Gate-status as a data attribute on the shell root (data-gate-status={status}) gives e2e tests and devtools a single selector to inspect the current shell branch"

requirements-completed: [ONBD-01, ONBD-06, SHELL-05, SHELL-06]

# Metrics
duration: ~15min
completed: 2026-04-18
---

# Phase 2 Plan 06: MainShell composition + useOnboardingGate + GlobalOverlays stubs + bootstrap rewrite Summary

**Wired every Wave-1 + Wave-2 artefact into one main-window tree: useOnboardingGate gates on config.onboarded + get_onboarding_status(), MainShell swaps OnboardingFlow ↔ full shell (TitleBar + NavRail + Suspense(lazy route) + GlobalOverlays + CommandPalette), main.tsx shrunk to a 26-effective-line bootstrap. SC-5 satisfied with 127-line headroom. ONBD-01 / ONBD-06 / SHELL-05 / SHELL-06 closed.**

## Performance

- **Duration:** ~15 min (composition-heavy, but every piece was pre-shipped by prior waves)
- **Completed:** 2026-04-18
- **Tasks:** 2/2
- **Files created:** 3 (useOnboardingGate.ts + MainShell.tsx + GlobalOverlays.tsx)
- **Files modified:** 3 (main.tsx + shell/index.ts + shell.css)

## Line counts (SC-5 gate)

| File | Raw wc | Non-blank / non-comment | Budget | Headroom |
|------|--------|--------------------------|--------|----------|
| `src/windows/main/main.tsx` | **50** | **26** | 80 | +54 |
| `src/windows/main/MainShell.tsx` | **126** | **93** | 220 | +127 |

SC-5 ("App.tsx / MainShell under 300 lines") satisfied with significant Phase 9 polish headroom.

## Accomplishments

### Task 1 — `useOnboardingGate` + `GlobalOverlays` stubs + shell.css (commit `99a2f06`)

- `useOnboardingGate()` — 4-state gate (`checking` | `needs_provider_key` | `needs_persona` | `complete`) returning `{status, reEvaluate, error}`. Reads `useConfig().config.onboarded` AND calls `getOnboardingStatus()` once on mount. Splits the plan's proposed 3-state template into 4 so consumers can distinguish WHICH signal failed (useful for Phase 3 Settings telemetry) without changing MainShell branching.
- T-02-06-02 race mitigation: `reEvaluate()` awaits `reload()` on `ConfigContext` AND a fresh `getOnboardingStatus()` call BEFORE setting `personaDone` — eliminates the window in which `config.onboarded` and `personaDone` could disagree.
- T-02-06-04 (DoS — infinite spinner): `getOnboardingStatus()` rejection catches the `TauriError`, surfaces `rustMessage` to `error`, and defaults `personaDone=false` so the user sees the persona step (and can retry) rather than an infinite spinner.
- `GlobalOverlays` — 3 DEV-only stubs (`CatchupStub` / `AmbientStripStub` / `ProactiveNudgeStub`). Each calls `useTauriEvent` exactly once, with the P-06 handler-in-ref guarantee from Phase 1. The wrapper `<div className="global-overlays">` always renders so Phase 3's real UI drops into a stable layout cell; only the stub children gate on `import.meta.env.DEV`.
- `shell/index.ts` — one-line append: `export { GlobalOverlays } from './GlobalOverlays';`. Append-only discipline preserved (D-51).
- `shell.css` — appended `.main-shell` + `.main-shell-body` + `.main-shell-route` + `.onb-surface` + `.global-overlays` + `.overlay-stub` rules. Every value references `var(--x)` from `tokens.css` / `layout.css`.

### Task 2 — MainShell composition + main.tsx thin bootstrap (commit `2b35591`)

- `MainShell` — two-layer composition. The outer `MainShell` export wraps `RouterProvider` > `BackendToastBridge` > `ShellContent`; the inner `ShellContent` owns palette state + gate status + shortcut wiring. This split keeps the outer API diffable when state needs to move between layers.
- Three branches in `ShellContent`:
  - `status === 'checking'`: renders TitleBar + NavRail + centered `GlassSpinner` inside `.main-shell-route`, so the visual weight matches the final layout while the gate resolves.
  - `status !== 'complete'` (i.e. `needs_provider_key` or `needs_persona`): renders TitleBar + `<OnboardingFlow onComplete={gate.reEvaluate} />` — **no NavRail, no RouteSlot, no palette**. T-02-06-03 / T-02-06-05 mitigations: the route tree is unreachable until the gate flips.
  - `status === 'complete'`: renders the full shell (TitleBar + NavRail + RouteSlot + GlobalOverlays + CommandPalette). `data-gate-status="complete"` on the root for e2e + devtools inspection.
- `RouteSlot` — fetches via `ROUTE_MAP.get(routeId) ?? ROUTE_MAP.get(DEFAULT_ROUTE_ID)`; wraps `<Cmp/>` in a `data-route-id={route.id}` div for selector stability; renders inside `<Suspense fallback={<SuspenseFallback />}>` so lazy-loaded routes show `GlassSpinner` without blocking TitleBar + NavRail.
- `useGlobalShortcuts({openPalette})` mounted inside `RouterProvider` (required — it calls `useRouterCtx`). T-02-06-06 accepted: shortcut events fire during onboarding but the route tree isn't mounted, so `setPref('app.lastRoute')` is the only side effect; next boot re-runs the gate and shows onboarding again.
- `main.tsx` — shrunk from 65-line `AppShell` + usePrefs + ROUTE_MAP lookup to a 50-raw / 26-effective-line bootstrap. Just: styles import + `performance.mark('boot')` + `createRoot()` + 3-layer provider stack + `requestAnimationFrame` perf measurement. D-29 P-01 perf floor preserved.
- `main.tsx` import count: 5 (React, createRoot, ConfigProvider/ToastProvider from one path, MainShell, styles side-effect).

## Task Commits

1. **Task 1:** `feat(02-06): useOnboardingGate + GlobalOverlays stubs + MainShell CSS` — `99a2f06`
2. **Task 2:** `feat(02-06): MainShell composition + thin main.tsx bootstrap (SC-5)` — `2b35591`

## Decisions Made

- **4-state gate enum instead of the plan's 3-state template.** Gate returns `'checking' | 'needs_provider_key' | 'needs_persona' | 'complete'`. The plan spec says `'checking' | 'needs_onboarding' | 'complete'`; splitting `needs_onboarding` into `needs_provider_key` and `needs_persona` lets Phase 3 Settings tell the user exactly what's missing (and the user whether they should expect the provider screen or the persona screen on click). MainShell branching is identical (`status !== 'complete'` catches both), so no behavioural delta — pure surface enrichment. Documented in JSDoc.
- **RouterProvider wraps BackendToastBridge, not the other way round.** `useGlobalShortcuts` calls `useRouterCtx` to navigate via `⌘1/⌘//⌘,`, so it MUST live inside RouterProvider. Mounting `BackendToastBridge` under RouterProvider is the simplest way to keep a single tree; the bridge itself doesn't touch router context, but the nesting is cheap and avoids duplicate context instances.
- **Suspense boundary local to RouteSlot, not wrapping the whole shell.** TitleBar + NavRail should render immediately — they don't depend on lazy imports. Only the route lane shows the `GlassSpinner` fallback during lazy-chunk load. This matches the prototype interaction model (chrome is always visible; only content area transitions).
- **`data-route-id` on the RouteSlot inner div.** Gives Plan 02-07 Playwright a stable selector (`[data-route-id="dashboard"]`) regardless of what the route component renders internally. The attribute costs one React attribute write per route change — negligible.
- **`.global-overlays` wrapper always renders, stub contents gate on DEV.** Keeps layout cell stable across prod / dev so Phase 3 real UI drop-ins don't cause a reflow and Phase 3 tests don't have to mock-set `import.meta.env.DEV`.
- **Did NOT touch STATE.md / ROADMAP.md.** Per explicit executor instruction — state updates are the orchestrator's responsibility for this run.

## Deviations from Plan

**None (structural)** — every `must_haves.truth` holds, every `must_haves.artifact` exists at the specified path, every `key_link` is verifiable via grep.

One cosmetic enhancement worth flagging (not a deviation — a tightening aligned with existing plan conventions):

- **[Rule 2 — Hardening] Gate returns a 4-state enum instead of 3.** The plan template returns `'checking' | 'needs_onboarding' | 'complete'`. My implementation splits `needs_onboarding` into `needs_provider_key` and `needs_persona` so consumers can distinguish WHICH signal failed. Matches the spirit of D-46's two-signal separation; MainShell branching (`status !== 'complete'`) is unchanged. Documented in the hook's JSDoc.

## Threat-model outcomes

| Threat ID  | Category          | Disposition | Status | Evidence                                                                                                                                                 |
| ---------- | ----------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-02-06-01 | Spoofing          | accept      | n/a    | `complete_onboarding` is Rust-owned; frontend passes 5 answers only                                                                                      |
| T-02-06-02 | Tampering         | mitigate    | closed | `reEvaluate()` awaits `reload()` + `getOnboardingStatus()` sequentially before setting `personaDone`; no intermediate state exposed                      |
| T-02-06-03 | Info Disclosure   | mitigate    | closed | Single `useOnboardingGate()` call site in `ShellContent`; full route tree only rendered when `status === 'complete'`                                     |
| T-02-06-04 | DoS               | mitigate    | closed | `getOnboardingStatus()` rejection defaults `personaDone=false` → user sees persona step, not an infinite spinner; `error` surfaces Rust message for toast|
| T-02-06-05 | Tampering         | mitigate    | closed | `CommandPalette` NOT rendered in the onboarding branch; palette only mounts when `status === 'complete'`                                                 |
| T-02-06-06 | Tampering         | accept      | n/a    | `useGlobalShortcuts` mounted globally inside RouterProvider; onboarding branch does not mount route tree so ⌘1/⌘//⌘, updates `routeId` but renders nothing; next boot re-gates |
| T-02-06-07 | Listener leak     | mitigate    | closed | GlobalOverlays stubs call `useTauriEvent` once each (3 total); Phase 1 Plan 01-09 Playwright leak spec exercises the hook's unmount path                  |
| T-02-06-08 | Tampering         | mitigate    | closed | Rust `load_config` merges with defaults; missing `onboarded` field defaults to `false` → gate rightly shows onboarding                                   |
| T-02-06-09 | Perf              | mitigate    | closed | `ShellContent` only re-renders on `paletteOpen` / `gate.status` / `routeId` changes; `RouteSlot` is the only component that touches `useRouterCtx().routeId` directly |

## Verification results

- **`npx tsc --noEmit`** — EXIT 0 after Task 1; EXIT 0 after Task 2; EXIT 0 at plan close. Empty output.
- **`npm run verify:all`** — 5/5 green at plan close:
  - `verify:entries` — 5 entries present
  - `verify:no-raw-tauri` — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths
  - `verify:migration-ledger` — 5 referenced ids tracked (of 82 rows)
  - `verify:emit-policy` — 58 broadcast emits match cross-window allowlist
  - `verify:contrast` — all strict pairs ≥ 4.5:1
- **`wc -l src/windows/main/main.tsx`** — 50 raw / 26 effective (80-line budget)
- **`wc -l src/windows/main/MainShell.tsx`** — 126 raw / 93 effective (220-line budget)
- **`grep -c "^import" src/windows/main/main.tsx`** — 5 (meets plan done-criterion `≤ 5`)
- **`grep -n "useOnboardingGate" src/windows/main/MainShell.tsx`** — 2 matches (1 import, 1 call site) — single gate source verified
- **`grep -n "BackendToastBridge" src/windows/main/MainShell.tsx`** — 3 matches (1 comment, 1 import, 1 mount) — mounted exactly once
- **`grep -rn "@tauri-apps/api/\(core\|event\)"` in new files** — zero matches (all Tauri access routed through `@/lib/tauri` or `@/lib/events` wrappers)
- **No destructive deletions** — `git diff --diff-filter=D HEAD~2 HEAD` is empty

### Commits present

- `99a2f06` — FOUND (`git log --oneline | grep 99a2f06` → match)
- `2b35591` — FOUND (`git log --oneline | grep 2b35591` → match)

## Known Stubs

- `GlobalOverlays.CatchupStub` / `AmbientStripStub` / `ProactiveNudgeStub` — **intentional Phase 2 stubs per D-61.** Each subscribes to its event via `useTauriEvent` and renders a DEV-only pill proving the plumbing. Real UI is Phase 3 scope (ambient strip lives in Dashboard; catchup and nudge cards render here). Documented inline in the component file and in plan 02-CONTEXT.md §D-61. **Not blocking**: Phase 2 success criterion #4 ("backend event → toast appears") is satisfied by BackendToastBridge, not by these overlay stubs.

No other stubs. Every other export is fully wired:
- `useOnboardingGate` has real `useConfig` + `getOnboardingStatus` calls
- `MainShell` renders the real TitleBar + NavRail + CommandPalette + GlobalOverlays + route tree
- `main.tsx` mounts the real provider stack with real perf marks

## Next Phase Readiness

### What Phase 3 consumes

- **Phase 3 Dashboard:** replaces `ComingSoonSkeleton` at `features/dashboard` with the real Dashboard. The route slot already renders anything registered in `ROUTE_MAP`; no shell edits required.
- **Phase 3 GlobalOverlays real UI:** replace each stub body in `src/design-system/shell/GlobalOverlays.tsx` with the full Catchup / Ambient-strip / Nudge components. Same event subscriptions, same file location, same positioning cell — a swap, not a rewrite.
- **Phase 3 Settings "Re-run onboarding" button:** calls `useResetOnboarding()` (forward-declared in Plan 02-04). That hook throws today; when Phase 3 wires it to a Rust `reset_onboarding` command, the button will flip `config.onboarded=false`, the next gate read will return `needs_provider_key`, and MainShell will re-render OnboardingFlow. **The gate will re-evaluate automatically** because `useConfig` is the source of truth and `ConfigProvider.reload()` will be called by the Settings page.
- **Phase 3 Chat + Settings routes:** same SC-3 discipline from Plan 02-05 — adding a RouteDefinition automatically surfaces in palette + NavRail, and the MainShell RouteSlot renders it inside Suspense with zero shell edits.

### Plan 02-07 (Playwright specs) consumes

- `[data-gate-status]` on `.main-shell` → distinguish `checking` / `needs_provider_key` / `needs_persona` / `complete`
- `[data-route-id="dashboard"]` inside RouteSlot → assert active route after navigation
- `[data-overlay="catchup"]` / `[data-overlay="ambient"]` / `[data-overlay="nudge"]` → assert listener plumbing in DEV (`window.__BLADE_LISTENERS_COUNT__ >= 3` post-mount)

### Requirements closed

| Id | Title | Where closed |
|----|-------|--------------|
| ONBD-01 | First-boot gate (config.onboarded + get_onboarding_status) | `useOnboardingGate.ts` (2-signal check, mount in `MainShell.ShellContent`) |
| ONBD-06 | Redirect to default route after complete_onboarding | `MainShell` re-renders on `gate.status === 'complete'` — the route tree mounts showing `prefs['app.lastRoute'] ?? DEFAULT_ROUTE_ID` |
| SHELL-05 | GlobalOverlays plumbing (CatchupCard + AmbientStrip + ProactiveNudge stubs) | `GlobalOverlays.tsx` (3 DEV-only stubs, 3 useTauriEvent subscriptions) |
| SHELL-06 | Route transitions via useRouter → Suspense → lazy component | `MainShell.RouteSlot` (ROUTE_MAP lookup + `<Suspense fallback={GlassSpinner}>` wrap) |

No blockers. No scope concerns.

## Self-Check: PASSED

**Files created (all present):**
- `src/windows/main/useOnboardingGate.ts` — FOUND
- `src/windows/main/MainShell.tsx` — FOUND
- `src/design-system/shell/GlobalOverlays.tsx` — FOUND

**Files modified (all present + correct):**
- `src/windows/main/main.tsx` — MODIFIED (26 effective lines; ConfigProvider > ToastProvider > MainShell; perf marks preserved)
- `src/design-system/shell/index.ts` — MODIFIED (`GlobalOverlays` re-export appended)
- `src/design-system/shell/shell.css` — MODIFIED (`.main-shell`, `.main-shell-body`, `.main-shell-route`, `.onb-surface`, `.global-overlays`, `.overlay-stub` all present)

**Commits present:**
- `99a2f06` — FOUND
- `2b35591` — FOUND

**Line-count gates:**
- `main.tsx` 26 effective ≤ 80 budget — PASS
- `MainShell.tsx` 93 effective ≤ 220 budget — PASS

**Verification:**
- `npx tsc --noEmit` — EXIT 0
- `npm run verify:all` — 5/5 green

---
*Phase: 02-onboarding-shell*
*Plan: 06 (MainShell composition + useOnboardingGate + GlobalOverlays stubs + bootstrap rewrite)*
*Completed: 2026-04-18*
