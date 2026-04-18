# Phase 2 Discussion Log — Auto-Mode Defaults

**Mode:** `/gsd-plan-phase 2 --auto --chain` (no interactive operator questions)
**Date:** 2026-04-18
**Planner:** claude-opus-4-7 (1M context)

Arnav delegated to auto mode. The planner picked defensible defaults that match Phase 1's aesthetic (Liquid Glass dark, self-built, zero new deps). Every default below could plausibly have gone another way; the chosen path + its alternatives + the pick rationale are documented so Arnav can override at any point.

---

## D-46 — Two-signal onboarding check

**Default:** Check BOTH `config.onboarded` AND `get_onboarding_status()`.

**Alternatives considered:**
- (a) Use only `config.onboarded`. Pro: simpler. Con: RECOVERY_LOG §3.1 explicitly separates general vs persona onboarding; reintroduces the old bug.
- (b) Use only `get_onboarding_status()`. Pro: single source. Con: a user who completes persona but has no API key would boot into a broken shell.

**Pick:** two-signal. Rationale: matches the documented contract, avoids regressions.

---

## D-47 — 4-step onboarding (added persona step)

**Default:** Provider → Key → Scan → Persona.

**Alternatives considered:**
- (a) 3-step, matching prototype. Pro: one-to-one with `docs/design/onboarding-0{1,2,3}-*.html`. Con: the persona questionnaire IS the contract of `complete_onboarding(answers: Vec<String>)`, which requires 5 answers — we MUST ask them somewhere.
- (b) Skip persona and pass 5 empty strings. Pro: matches prototype exactly. Con: seeds a useless persona.md, defeats the purpose of persona-driven identity tuning.

**Pick:** 4-step. Persona step visual language mirrors onboarding-01 but uses an Input-stacked form. Cost: one extra screen.

---

## D-48 — Gate enforcement at shell layer, not route

**Default:** `MainShell` renders `<OnboardingFlow/>` directly when gate is pending; the `onboarding` route remains palette-hidden and only openable via `openRoute('onboarding')`.

**Alternatives considered:**
- (a) Gate inside the `/onboarding` route's component. Pro: less coupling. Con: user can ⌘K → "dashboard" mid-flow and end up on a blank dashboard with no API key.
- (b) Disable ⌘K during onboarding. Pro: bulletproof. Con: hides SC-3 from testing during onboarding; also hides `Esc` escape hatch if onboarding softlocks.

**Pick:** (a hybrid) — gate at shell AND keep route hidden. Arnav gets full palette elsewhere; onboarding can't be navigated away from until complete.

---

## D-49 — Correct `DeepScanProgressPayload` to match Rust

**Default:** Redefine the payload type to `{phase: string, found: number}`; derive UI percent client-side.

**Alternatives considered:**
- (a) Change Rust to emit `{step, total, label, percent}`. Pro: richer payload. Con: scope creep into backend; 12 scanners complete in parallel, so `step/total` is misleading (the emit pattern is phase-ticks, not ordered steps).
- (b) Keep the TS declaration wrong, runtime-cast and hope. Con: no.

**Pick:** fix TS. Phase 3 can revisit Rust if the UI ever needs a richer payload.

---

## D-50 — 4-command composition instead of `saveConfig` wrapper

**Default:** `test_provider` → `store_provider_key` → `switch_provider` → `set_config(onboarded=true, empty api_key)`.

**Alternatives considered:**
- (a) Add `save_config_cmd` to Rust (STATE.md blocker fix). Pro: cleanest. Con: Rust PR for a one-off is out of Phase 2 scope; Arnav flagged `save_config` as a Phase 2 maybe-fix — planner picks the no-Rust path to keep scope tight.
- (b) Use `save_config_field` in a loop. Con: 40+ fields, chatty, error-prone.

**Pick:** 4-command composition. All commands already registered in `lib.rs:457-470`.

---

## D-51 — Shell composition split

**Default:** `main.tsx` thin bootstrap; `MainShell.tsx` owns layout; `useRouter.ts` + `useOnboardingGate.ts` own logic.

**Alternatives considered:**
- (a) One big `MainShell` file. Pro: fewer files. Con: breaks SC-5 (300-line budget) the moment we add palette + toast + overlays.
- (b) Per-component files (TitleBarContainer, NavRailContainer, …) with their own hooks. Pro: max decomposition. Con: over-engineering for Phase 2 scope.

**Pick:** 4-file split. Enough to hit SC-5 without over-fragmenting.

---

## D-52 — In-memory history only

**Default:** `useRouter.history` is a session stack; cleared on app restart.

**Alternatives considered:**
- (a) Persist history in prefs. Pro: nice-to-have. Con: storage cost, prefs write churn, tiny value.
- (b) Hash routing + real URL. Pro: standard. Con: Tauri main window has no URL to share; D-05 bans react-router.

**Pick:** in-memory. Phase 9 can revisit if operator demands.

---

## D-53 — Vanilla `<Suspense>` + GlassSpinner

**Default:** Use the Phase 1 Suspense fallback unchanged. No per-route loading UIs.

**Alternatives considered:**
- (a) Route-specific skeleton pass. Pro: polish. Con: Phase 9 scope.

**Pick:** defer polish.

---

## D-54 — TitleBar strips role switcher

**Default:** 34px bar with traffic-light spacer + title + blade_status pill + ⌘K hint. No role switcher.

**Alternatives considered:**
- (a) Port the role switcher from `src.bak/TitleBar.tsx`. Pro: feature parity. Con: roles are Phase 6 (IDEN cluster) scope; shipping it here couples Phase 2 to a backend we haven't audited.

**Pick:** strip role switcher. Phase 6 adds when identity views land.

---

## D-55 — NavRail is derived from PALETTE_COMMANDS

**Default:** Nav items sourced from `PALETTE_COMMANDS` (Phase 1 export), grouped by `section`. Icons are inline SVG in `NavRail.tsx`.

**Alternatives considered:**
- (a) Hardcoded nav list. Pro: simple. Con: duplicates route registry; violates FOUND-08 spirit (1 edit to add a route).
- (b) Central icon registry file. Pro: DRY if we ship many icons. Con: Phase 2 has ~12 icons — premature centralization.

**Pick:** derived nav + inline icons. Phase 9 can extract the registry once the count ≥20.

---

## D-56 — NavRail reuses `paletteHidden` as its filter

**Default:** Same filter surfaces for Palette and Nav.

**Alternatives considered:**
- Add a separate `navHidden` flag. Con: doubles the RouteDefinition surface for identical semantics (onboarding is hidden from both).

**Pick:** one flag.

---

## D-57 — Palette reads live from `PALETTE_COMMANDS`

**Default:** No static registration. Palette imports `PALETTE_COMMANDS` and renders directly.

**Alternatives considered:**
- Pass a commands array prop from MainShell. Pro: testable. Con: indirection without purpose; the palette already owns its input.

**Pick:** live read. Tests mock the module import if needed.

---

## D-58 — Palette uses native `<dialog>` primitive

**Default:** Render Palette inside `Dialog` from `@/design-system/primitives`. Gets focus trap + ESC close natively.

**Alternatives considered:**
- (a) `react-focus-lock`. Con: new dep (D-01 bans).
- (b) Custom focus trap. Con: hand-rolling accessibility; browser does it correctly.

**Pick:** `<dialog>`.

---

## D-59 — Toast context + ToastViewport portal

**Default:** React Context provider + bottom-right viewport portal + auto-dismiss 4s/7s.

**Alternatives considered:**
- (a) `react-hot-toast` or similar library. Con: new dep, style mismatch.
- (b) Event bus without React state. Pro: simpler. Con: harder to test, no declarative children.

**Pick:** Context.

---

## D-60 — BackendToastBridge component

**Default:** Single component mounts 3 `useTauriEvent` hooks for `BLADE_NOTIFICATION`, `BLADE_TOAST`, `SHORTCUT_REGISTRATION_FAILED`. Pipes to `useToast().show(...)`.

**Alternatives considered:**
- Inline the subscriptions inside ToastProvider. Pro: fewer files. Con: couples Toast to BLADE_EVENTS; splitting makes the bridge test-mockable.

**Pick:** bridge component.

---

## D-61 — GlobalOverlays are stubs in Phase 2

**Default:** Mount + subscribe + render placeholder pills. Real UI in Phase 3 Dashboard plan.

**Alternatives considered:**
- Ship fully designed overlays now. Con: Phase 3 owns Dashboard's ambient strip; building the full overlay twice is waste.

**Pick:** stubs.

---

## D-62 — Single `useGlobalShortcuts` hook

**Default:** One hook owns all keyboard captures; reads RouteDefinition.shortcut automatically.

**Alternatives considered:**
- Per-component shortcut registration. Pro: locality. Con: listener leak risk + duplicate handler risk.

**Pick:** centralized.

---

## D-63 — 2 new Playwright specs reusing Phase 1 harness

**Default:** `onboarding-boot.spec.ts` + `shell.spec.ts`. No new test deps.

**Alternatives considered:**
- Vitest unit tests for hooks. Pro: faster feedback. Con: Phase 1 picked Playwright as the harness; adding Vitest is scope creep.

**Pick:** Playwright specs only.

---

## Escalation triggers (when auto-mode should have paused)

None reached. Every decision had a clearly defensible default. If Arnav disagrees with any, override in `/gsd-execute-phase` with a `context-reset` note.

---

*Log finalized: 2026-04-18 during /gsd-plan-phase 2 --auto --chain*
