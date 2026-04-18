# Phase 2: Onboarding + Main Shell — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning (AUTO mode — no interactive discussion; defaults chosen by planner and logged in 02-DISCUSSION-LOG.md)
**Source:** /gsd-plan-phase 2 --auto --chain (planner-picked defaults)

<domain>
## Phase Boundary

Phase 2 builds the first-run onboarding flow and the main-window shell that wraps every subsequent surface. It consumes Phase 1 substrate verbatim: 9 primitives, `invokeTyped`, `useTauriEvent`, `usePrefs`, `ConfigContext`, `ROUTE_MAP`/`PALETTE_COMMANDS`, design tokens. It DOES NOT touch any feature route other than `/onboarding` (Phase 3+ owns those).

**In scope:** 13 requirements — ONBD-01..06 (onboarding), SHELL-01..07 (TitleBar, NavRail, CommandPalette, ToastContext, GlobalOverlays, route transitions, back/forward history).

**Out of scope for Phase 2:**
- Dashboard, Chat, Settings content (Phase 3)
- Overlay windows QuickAsk/Voice/Ghost/HUD (Phase 4)
- The `Re-run onboarding` Settings button's *rendering* (Phase 3 Settings owns the Settings UI); Phase 2 only ships the hook/invoke that re-triggers the flow so Phase 3 can wire the button in one line.
- WCAG manual checkpoint (still a Phase 1 operator task — not inherited)
- Animation polish across routes (Phase 9)
- Shortcut help panel (`⌘?`) — Phase 9 POL-04

**Key substrate Phase 2 leans on (all Phase 1 — no drift permitted):**
- `src/design-system/primitives/*` — Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/config.ts` — `getConfig`, `saveConfig`, `getOnboardingStatus`, `completeOnboarding` (already shipped)
- `src/lib/events/index.ts` — `BLADE_EVENTS`, `useTauriEvent` (D-13 only permitted listen surface)
- `src/lib/events/payloads.ts` — `DeepScanProgressPayload`, `BladeNotificationPayload`, `BladeToastPayload`, `ShortcutRegistrationFailedPayload`, etc.
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` blob with dotted keys (`app.lastRoute`, `app.defaultRoute`)
- `src/lib/context/ConfigContext.tsx` — main-window `BladeConfig` provider (already fail-closed on getConfig error)
- `src/lib/router.ts` — `RouteDefinition`, `DEFAULT_ROUTE_ID`
- `src/windows/main/router.ts` — `ALL_ROUTES`, `ROUTE_MAP`, `PALETTE_COMMANDS` (live — palette MUST read from this)
- `src/windows/main/main.tsx` — current minimal `AppShell` (Phase 2 replaces this with the full shell composition but keeps perf marks + ConfigProvider wrapping)
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — design tokens; layout.css already defines `--title-height`, `--nav-width`

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering from STATE.md (D-01..D-45 locked through Phase 1). Phase 2 adds D-46..D-63.

### Onboarding flow shape

- **D-46:** Two-signal onboarding check. First-run routing checks BOTH `config.onboarded` AND `get_onboarding_status()` (persona).
  - `config.onboarded=false` → Provider Picker (Step 1). User must choose provider + store key.
  - `config.onboarded=true` but `get_onboarding_status()=false` → persona step (Step 4 — the 5-question flow that calls `complete_onboarding`).
  - Both true → dashboard (skip onboarding).
  Rationale: RECOVERY_LOG §3.1 explicitly separates general onboarding (`config.onboarded`) from persona onboarding (`persona_onboarding_complete`). Treating them as one flag reintroduces the old bug.

- **D-47:** Onboarding is a 4-step wizard inside the single `/onboarding` route. Steps rendered conditionally by a `useOnboardingState` hook; no sub-route URLs. Steps:
  1. **Provider Picker** — 6 providers (Anthropic default-selected per docs/design prototype). Local state only.
  2. **API Key Entry** — masked input; "Test connection" button calls `test_provider`; on success persists via `store_provider_key` + `switch_provider`, then calls `set_config` to flip `config.onboarded=true`.
  3. **Deep Scan** — invokes `deep_scan_start`, subscribes to `deep_scan_progress` events, shows SVG progress ring + scanner labels, enables "Continue" CTA when scan completes.
  4. **Persona Questions** — 5 short text fields (name+role / current project / stack / biggest goal / communication style). "Enter BLADE" CTA calls `complete_onboarding(answers)`, then forces `reload()` on `ConfigContext` and the onboarding state machine exits to the default route.
  Rationale: prototype (`docs/design/onboarding-01/02/03-*.html`) shows 3 screens; RECOVERY_LOG §3.2 explicitly requires the 5-question persona step as Step 3 hand-off. Splitting into 4 logical steps keeps each screen single-concern and falsifiable.

- **D-48:** Returning user path is enforced at the main shell router, not inside the onboarding route. On boot, `MainShell` reads `useConfig().config.onboarded` + calls `getOnboardingStatus()` once, then renders `<OnboardingFlow/>` instead of the normal route tree until both checks pass. The onboarding route ID (`'onboarding'`) is kept palette-hidden and only reachable directly via `openRoute('onboarding')` from Settings (Phase 3 wires that). Rationale: prevents a user from accidentally navigating away from onboarding mid-flow via ⌘K and leaves no `onboarded=true` bypass if localStorage is cleared.

- **D-49:** `DeepScanProgressPayload` type in `src/lib/events/payloads.ts` is **wrong** today — it declares `{step, total, label, percent}` but the Rust emit at `deep_scan.rs:1325` emits `{phase: string, found: number}`. Phase 2 corrects the type to match Rust reality (`{phase: string, found: number}`) and derives a UI-side `progress` computation (enumerated phase-name → percent mapping; 12 known phases). Rationale: Rust is the authoritative source per D-38-payload comment. Changing Rust breaks backend tests; changing TS is zero-cost. Alternative considered: emit `{step, total, label, percent}` from Rust — rejected because that's a scope-expansion into backend for a pure display concern.

- **D-50:** Provider + API-key persistence uses the **already-registered** Rust commands only — no new Rust commands in Phase 2. The call sequence is:
  1. `test_provider({provider, api_key, model})` — checks key works
  2. `store_provider_key({provider, api_key})` — keyring write
  3. `switch_provider({provider, model})` — flip active + load key from keyring into config
  4. `set_config({provider, api_key: '', model, ...})` — sets `config.onboarded=true` as a side effect (see commands.rs:1972). Pass empty api_key so the keyring is not clobbered (commands.rs:1967 guards against masked values and empty values).
  Rationale: `save_config` is not a `#[tauri::command]` (STATE.md blocker notes this). The `saveConfig` TS wrapper ships but its first call will return `not_found`. Phase 2 sidesteps that entirely by composing the 4 commands above. A future Rust PR to add `save_config_cmd` is out of scope.

### Shell composition

- **D-51:** `MainShell` = the Phase 2 replacement for `AppShell` in `src/windows/main/main.tsx`. Responsibility split:
  - `src/windows/main/main.tsx` — thin bootstrap (ConfigProvider + ToastProvider + MainShell). Stays under 80 lines.
  - `src/windows/main/MainShell.tsx` — composed shell: `<TitleBar/>` + `<NavRail/>` + `<RouteContainer/>` + `<GlobalOverlays/>` + `<CommandPalette/>` (portaled). Mounts `useOnboardingGate()` to decide onboarding vs normal render. Target: ≤220 lines.
  - `src/windows/main/useRouter.ts` — `useRouter()` returns `{routeId, openRoute, back, forward, history}` backed by `useState`. Persists last route to prefs via `setPref('app.lastRoute', id)` on change (debounced by `usePrefs`). NOT reactive to localStorage changes from other tabs (there are no other tabs — single window).
  - `src/windows/main/useOnboardingGate.ts` — returns `{ready, status}` where `status ∈ {'checking'|'needs_onboarding'|'complete'}`. Calls `getOnboardingStatus()` once on mount and reads `useConfig().config.onboarded`.
  Rationale: keeps the success criterion "App.tsx under 300 lines" trivially satisfied and factors the shell into small testable units. The old `src.bak/App.tsx` was 1,300 lines — every decomposition here is a deliberate counter.

- **D-52:** **Back/forward history is in-memory only**, reset on app restart. SHELL-07 ("route transitions, back/forward history") is interpreted as session-scoped. `useRouter.history` is a stack of route ids; `back()` pops; `forward()` peeks the redo stack. No URL, no hash routing, no `popstate` — D-05 custom-registry discipline. Rationale: Tauri main window has no real URL; hash routing would add no value and break ⌘K's focus. Persisted history across restarts is YAGNI.

- **D-53:** Shell uses `<Suspense>` around the current route. Lazy-loaded `RouteDefinition.component` falls back to the existing `GlassSpinner size={32}` pattern from Phase 1. No custom loading UIs per route in Phase 2 — Phase 9 polish pass handles route-specific skeletons.

### TitleBar

- **D-54:** `TitleBar` is a 34px-tall drag region (`data-tauri-drag-region`) with:
  - Left: macOS traffic-light spacer (uses `getCurrentWindow().minimize()/close()/toggleMaximize()` via the typed wrapper shipped in Plan 02-02).
  - Center: window title (`"BLADE"`) + live `blade_status` pill (subscribes to `BLADE_STATUS` event).
  - Right: ⌘K shortcut hint chip.
  Height and drag behavior set from `layout.css --title-height` (already defined). **No role switcher** (the `src.bak/TitleBar.tsx` role switcher is Phase 6 `IDEN-*` scope — removed entirely from Phase 2 to preserve D-17 "src.bak is dead reference").
  Rationale: matches prototype visual weight; keeps TitleBar single-concern.

### NavRail

- **D-55:** `NavRail` is a fixed 62px-wide column on the left, below TitleBar. Renders icons for the 3 user-facing core routes (`dashboard`, `chat`, `settings`) + a divider + a cluster icon per non-core section (agents/knowledge/life/identity/dev-tools/admin/body/hive — Phase 3+ clusters). Clicking a cluster opens a flyout or navigates to the cluster's first route (Phase 2 just navigates; flyout is Phase 9).
  - Source: `PALETTE_COMMANDS` filtered by `section`. Nav is derived, never hardcoded — one RouteDefinition append in any feature index shows up automatically.
  - Active state: highlighted pill when `routeId === route.id` OR when `routeId.startsWith(${section}-)`.
  - Icons: Phase 2 ships **inline SVG glyphs** colocated in `NavRail.tsx` (not the Phase 1 icon registry — there is none yet). Phase 9 can hoist to a shared registry if the set grows.
  Rationale: derived nav is the whole point of SHELL-02 — adding a route must not require a NavRail edit. Exception for non-core sections is to keep the rail uncluttered; Phase 9 can change the policy without API break.

- **D-56:** The Onboarding route does NOT appear in NavRail (`paletteHidden=true` is reused as the filter). This is the same filter CommandPalette uses, so one rule governs both surfaces.

### CommandPalette

- **D-57:** `CommandPalette` reads directly from `PALETTE_COMMANDS` (live) — no static registration, no props array of `{label, action}`, no `App.tsx` edit required. Success criterion #3 is enforced by this. Navigation happens via `useRouter().openRoute(route.id)`.
  - `⌘K` / `Ctrl+K` opens (captured on `window.keydown`). `Esc` closes. `Enter` navigates to the highlighted row. Arrow keys move selection.
  - Fuzzy filter: substring match on `label`, fallback to char-order fuzzy, fallback to `description`. Recipe ported from `src.bak/CommandPalette.tsx` fuzzy scoring (same algorithm, re-typed, NOT import — D-17).
  - Recent route ids stored in `usePrefs` under `palette.recent` (max 5) so the palette surfaces recents at top when the query is empty.
  - DEV surfaces (`/primitives`, `/wrapper-smoke`, `/diagnostics-dev`) are `paletteHidden=true` and therefore do NOT appear (per Phase 1 D-40-palette). No "DEV" toggle in Phase 2.
  Rationale: derived palette + paletteHidden filter is exactly what Phase 1 D-40 was built for. Anything else would reintroduce the "App.tsx 3-edit cost" Arnav explicitly wants gone.

- **D-58:** CommandPalette is **portaled** to `document.body` and rendered via the native `<dialog>` primitive (`Dialog` from Phase 1) so focus trap + ESC close come for free. No custom focus-trap library. Rationale: D-01 — use Phase 1 primitives.

### Toast system

- **D-59:** `ToastProvider` is a React Context that owns a `ToastItem[]` state and renders a `ToastViewport` portal in the bottom-right. `useToast().show({type, title, message?, durationMs?})` is the sole API. Auto-dismiss after `durationMs` (default 4000 for info/success, 7000 for error/warn). Max 5 concurrent toasts; older ones slide out.
  - Types: `'info' | 'success' | 'warn' | 'error'` — matches `BladeNotificationPayload.type` (with `warn` alias for `warning` to align with `src.bak` convention).
  - Visual: glass-1 panel + colored left bar + icon + title + optional message. Pure CSS motion (D-02).
  - No action buttons in v1; "action" support deferred to Phase 3 when Chat needs "Retry" toasts.

- **D-60:** ToastProvider auto-bridges backend notification events. A single bridge component (`BackendToastBridge`) uses `useTauriEvent(BLADE_EVENTS.BLADE_NOTIFICATION, ...)`, `useTauriEvent(BLADE_EVENTS.BLADE_TOAST, ...)`, and `useTauriEvent(BLADE_EVENTS.SHORTCUT_REGISTRATION_FAILED, ...)`, mapping each to `toast.show(...)`. Mounted once at `MainShell` level. Rationale: success criterion #4 is "backend event arrives → toast appears without blocking". The bridge is that guarantee.

### Global overlays

- **D-61:** `GlobalOverlays` is a single component at `MainShell` that mounts three subscription-driven overlays: `<CatchupCard/>` (subscribes `BLADE_STATUS === 'processing'` when user was away), `<AmbientStrip/>` (subscribes `HOMEOSTASIS_UPDATE`; displays dominant hormone tier), `<ProactiveNudge/>` (subscribes `PROACTIVE_NUDGE`). All three are **stub implementations in Phase 2** — they mount, subscribe, and render placeholder pills. Real UI ships in Phase 3 alongside Dashboard's ambient strip; Phase 2 only proves the subscription plumbing works (no listener leak, no duplicate mounts).
  Rationale: success criterion #4 requires the shell plumbing for overlays to exist; without them the Phase 3 Dashboard has nowhere to wire. Keeping them as stubs prevents Phase 2 from bleeding into Phase 3 visual scope.

### Keyboard shortcuts

- **D-62:** A single `useGlobalShortcuts()` hook mounted in MainShell owns keydown capture for:
  - `Mod+K` → open palette
  - `Mod+1` → openRoute('dashboard')
  - `Mod+/` → openRoute('chat')
  - `Mod+,` → openRoute('settings')
  - `Mod+[` / `Mod+]` → back / forward
  - Routes with a `shortcut` property on their RouteDefinition auto-register (the hook reads `ALL_ROUTES` and attaches).
  Captured on `window` with `event.defaultPrevented` guards so inputs (palette search, onboarding text fields) don't swallow. Rationale: derived from RouteDefinition.shortcut, no per-route registration.

### Testing

- **D-63:** Phase 2 extends the Phase 1 Playwright harness with two new specs:
  - `tests/e2e/onboarding-boot.spec.ts` — empty config → provider picker shows → mock `test_provider`/`store_provider_key`/`deep_scan_start`/`complete_onboarding` → shell renders dashboard ComingSoonSkeleton.
  - `tests/e2e/shell.spec.ts` — ⌘K opens palette → type "settings" → Enter navigates → Esc closes → Rust emits `blade_notification` → toast appears → 4s later toast dismisses.
  Both specs use the Phase 1 `@tauri-apps/test` harness (the pattern Plan 01-09 shipped). No new test deps. Rationale: both success criteria #1, #3, #4 get automated falsifiable checks in one PR.

### Claude's Discretion

- Exact icon SVG glyphs in NavRail — planner picks; must be minimal line style matching prototype `docs/design/onboarding-*` iconography.
- Exact ring animation in deep-scan progress — match prototype `onboarding-03-ready.html` (spinning arc, `animation: spin 0.9s linear`).
- Exact toast placement offsets, padding — planner picks; must not conflict with NavRail (62px left) or trigger scrollbar.
- Exact phase → percent mapping in D-49 progress derivation — enumerate 12 known scanner phases in order they emit; assign equal 8.33% each.
- Whether `BackendToastBridge` is a component or a hook with `useEffect`s — planner picks (leaning component for easier test-harness mocking).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 2: Onboarding + Main Shell" — goal, requirements, success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-45, Phase 1 substrate inventory, `save_config` blocker notes
- `.planning/RECOVERY_LOG.md` §3 (Onboarding Backend Wiring, lines 208–317) — the contract this phase implements. **REQUIRED**.
- `.planning/RECOVERY_LOG.md` §4 (Event catalog) — `deep_scan_progress`, `blade_notification`, `blade_toast`, `shortcut_registration_failed` subscription sources
- `.planning/RECOVERY_LOG.md` §5 (emit_all classification) — confirms `blade_toast` is cross-window, `blade_notification` is single-window

### Phase 1 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45 (must not violate)
- `.planning/phases/01-foundation/01-01-SUMMARY.md` through `01-09-SUMMARY.md` — what actually shipped
- `.planning/phases/01-foundation/01-PATTERNS.md` — patterns to reuse (interface patterns, verify-script style, wrapper recipe)

### Code Phase 2 extends (read-only inputs)
- `src/windows/main/main.tsx` — current AppShell (Phase 2 wraps this)
- `src/windows/main/router.ts` — `ALL_ROUTES`, `ROUTE_MAP`, `PALETTE_COMMANDS` (live sources for palette + nav)
- `src/lib/router.ts` — `RouteDefinition`, `DEFAULT_ROUTE_ID`
- `src/hooks/usePrefs.ts` — `usePrefs()` + `Prefs` interface (extended keys add `palette.recent`, `onboarding.deep_scan_completed`)
- `src/lib/context/ConfigContext.tsx` — provider + `useConfig()` + `reload()`
- `src/lib/tauri/config.ts` — 4 wrappers live today (getConfig, saveConfig, getOnboardingStatus, completeOnboarding)
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`, `TauriErrorKind`
- `src/lib/events/index.ts` — `BLADE_EVENTS` + `useTauriEvent` hook
- `src/lib/events/payloads.ts` — `DeepScanProgressPayload` (currently wrong per D-49), `BladeNotificationPayload`, `BladeToastPayload`, `ShortcutRegistrationFailedPayload`
- `src/design-system/primitives/*` — 9 primitives + `primitives.css` (all styling layered on design tokens)
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — design tokens (layout.css defines `--title-height`, `--nav-width`)

### Rust source (authoritative for new wrapper cites)
- `src-tauri/src/commands.rs:2319` — `get_onboarding_status()`
- `src-tauri/src/commands.rs:2332` — `complete_onboarding(answers)`
- `src-tauri/src/commands.rs:1944` — `set_config(provider, api_key, model, ...)`
- `src-tauri/src/commands.rs:2025` — `test_provider(provider, api_key, model, base_url)`
- `src-tauri/src/config.rs:605` — `get_all_provider_keys()`
- `src-tauri/src/config.rs:636` — `store_provider_key(provider, api_key)`
- `src-tauri/src/config.rs:645` — `switch_provider(provider, model)`
- `src-tauri/src/deep_scan.rs:1321` — `deep_scan_start()` (emits `deep_scan_progress` with `{phase: string, found: number}`)
- `src-tauri/src/deep_scan.rs:1425` — `deep_scan_results()`
- `src-tauri/src/deep_scan.rs:1431` — `deep_scan_summary()`
- `src-tauri/src/lib.rs:457-470` — `generate_handler![]` confirming all above are registered commands

### Prototype + design authority (visual reference)
- `docs/design/onboarding-01-provider.html` — Provider Picker layout (6-provider 2-column grid, step pills, dark glass background)
- `docs/design/onboarding-02-apikey.html` — API Key Entry (masked input, test button, status pill)
- `docs/design/onboarding-03-ready.html` — Deep scan progress (SVG ring + 12 scanner labels + "Enter BLADE" CTA)
- Persona question screen is NOT in prototypes — planner derives layout consistent with onboarding-01 aesthetic

### Explicitly NOT to read (D-17 applies)
- `src.bak/components/Onboarding.tsx` — old code, scope-creep trap
- `src.bak/components/CommandPalette.tsx` — consult ONLY for fuzzy scoring algorithm (copy forward as ALGORITHM REFERENCE, do not import)
- `src.bak/components/TitleBar.tsx` — contains Phase 6 role-switcher; do not port
- `src.bak/components/NavRail.tsx` — old route union; use PALETTE_COMMANDS instead
- `src.bak/components/Toast.tsx` — algorithm reference OK; do not import

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1 substrate Phase 2 extends

- `src/windows/main/main.tsx` (65 lines) — minimal `AppShell`. Phase 2 replaces the `AppShell` function with `<MainShell/>` composition; keeps the 3 `performance.mark` calls (D-29 P-01 gate floor) and the `<ConfigProvider>` wrapper. `main.tsx` stays thin (bootstrap only).

- `src/windows/main/router.ts` (55 lines) — already exports `ALL_ROUTES`, `ROUTE_MAP`, `PALETTE_COMMANDS`. **No modification** in Phase 2; Phase 2 consumers import from here.

- `src/lib/events/payloads.ts:196` — `DeepScanProgressPayload` has the wrong shape (see D-49). Phase 2 Plan 02-04 corrects this.

- `src/lib/tauri/config.ts` — Phase 2 adds `testProvider`, `getAllProviderKeys`, `storeProviderKey`, `switchProvider`, `setConfig` wrappers alongside the existing 4. All arg keys verbatim snake_case (D-38). Cites Rust file:line in JSDoc.

### Patterns already established that Phase 2 MUST follow

- **Wrapper recipe:** `invokeTyped<TReturn, TArgs>(command, args)` + JSDoc `@see src-tauri/src/<file>.rs:<line>`. Never raw `invoke`. ESLint rule `no-raw-tauri` enforces.
- **Event subscription:** `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`. Handler-in-ref pattern; subscription keyed on `[name]` only (D-38-hook).
- **Pref writes:** `setPref('dotted.key', value)` — debounced 250ms, single localStorage blob. No scattered `localStorage.getItem`.
- **Styling:** compose `.glass .glass-1`/`.glass-2`/`.glass-3` + primitive classes from `primitives.css`; Tailwind utilities for spacing / layout only. No hardcoded hex colors.
- **Routes:** append a `RouteDefinition` to the feature index's `routes` array. Phase 2 does NOT add new routes beyond the existing `onboarding` stub (onboarding is already registered; Phase 2 just swaps its component).

### Test harness

- `playwright.config.ts` + `tests/e2e/listener-leak.spec.ts` already shipped in Plan 01-09. Phase 2 adds two specs reusing the same harness. `npm run test:e2e` runs them.

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 2 success criteria (must be falsifiable):**
- SC-1: Fresh launch → provider picker → Anthropic + valid key → deep scan → shell without errors (Plan 01 covers boot path; Plan 05 covers wiring; Plan 06 wires shell entry)
- SC-2: Returning user → straight to default route; onboarding not shown again (D-48 gate)
- SC-3: ⌘K palette opens, fuzzy filter on label, Enter navigates, Esc closes, NO App.tsx edit required to add a route (D-57 derived)
- SC-4: Backend event → toast appears → auto-dismisses (D-60 bridge)
- SC-5: App.tsx (MainShell) under 300 lines (D-51 split)

**From RECOVERY_LOG.md §3 (backend contract):**
- Deep scan emits 12 phase names per `deep_scan_start` run: `starting, installed_apps, git_repos, ides, ai_tools, wsl_distros, ssh_keys, package_managers, docker, bookmarks, complete` (11 named + 1 implicit "settle"). Phase 2 UI uses this enumeration.
- `complete_onboarding` requires exactly 5 answers; Rust errors if fewer. Phase 2 validates length on CTA enable.
- `blade_notification`, `blade_toast`, `shortcut_registration_failed` are the three toast-worthy events the shell must bridge.

**From prototype (docs/design/onboarding-*.html):**
- Step pills pattern: 3 pills, each with number circle; active pill white/dark-text, done pill green check. Phase 2 extends to 4 pills (adds persona step).
- Provider card: 2-column grid, hover translate-y-[-1], selected = white ring + check badge top-right.
- Deep scan: centered glass panel with large SVG ring (100px diameter, dasharray-progress), 12 scanner labels below, "Enter BLADE" CTA disabled until ring hits 100.

**Palette recent history:**
- Store `palette.recent` array in prefs. When query is empty, show recents first, then the rest alphabetically. When query is non-empty, use fuzzy score. Max 5 recents. Rationale: mirrors the `src.bak/CommandPalette.tsx` behavior without importing its code.

</specifics>

<deferred>
## Deferred Ideas

- **URL / deep linking** — D-52 rejects. Revisit in Phase 9 if operator wants shareable links.
- **Palette group headings** (Core / Agents / Life OS / ...) — Phase 9 polish pass; Phase 2 ships a flat sorted list.
- **Palette actions beyond routes** (e.g. "Toggle ghost mode", "Start voice") — Phase 3+ when backend commands for those stabilize.
- **NavRail flyouts for non-core sections** — Phase 9 polish; Phase 2 just navigates to the cluster's first route.
- **Animation polish for toast enter/exit** — Phase 2 uses a single CSS keyframe; Phase 9 gets the springy motion pass.
- **Toast action buttons** — Phase 3 (Chat retry needs this).
- **Re-run onboarding from Settings UI** — Phase 3 Settings. Phase 2 ships the `useResetOnboarding()` hook the Settings button will call.
- **`Mod+?` shortcut help panel** — Phase 9 POL-04.
- **Persistent route history (across restarts)** — not in backlog (D-52).
- **Custom focus-trap library** — D-58 uses `<dialog>`; no lib.
- **`save_config_cmd` Rust addition** — STATE.md blocker; not Phase 2 scope (Phase 2 works around via the 4-command composition in D-50).

</deferred>

---

*Phase: 02-onboarding-shell*
*Context captured: 2026-04-18 via /gsd-plan-phase --auto (no interactive discuss; defaults logged in 02-DISCUSSION-LOG.md)*
