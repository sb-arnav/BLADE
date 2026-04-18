---
phase: 02-onboarding-shell
plan: 07
subsystem: verification
tags: [playwright, e2e, phase2-verification, falsifiable, partial-complete]

# Dependency graph
requires:
  - phase: 01-foundation
    plan: 09
    provides: "Playwright harness — playwright.config.ts targeting http://localhost:1420, reuseExistingServer flag, tests/e2e/listener-leak.spec.ts reference spec, @playwright/test devDep (D-32, P-06 gate)"
  - phase: 02-onboarding-shell
    plan: 04
    provides: "OnboardingFlow 4-step wizard selectors — role=radiogroup[aria-label='AI providers'], #onb-api-key, heading /paste your .+ key/i, role=progressbar[aria-label^='Deep scan progress'], #persona-0..4, heading /a few quick questions/i"
  - phase: 02-onboarding-shell
    plan: 05
    provides: "CommandPalette + NavRail selectors — dialog[aria-label='Command palette'], [role='option'][data-route-id=X], textbox[aria-label='Search routes'], .navrail button[data-route-id=X]"
  - phase: 02-onboarding-shell
    plan: 06
    provides: "MainShell data attributes — [data-gate-status={checking|needs_provider_key|needs_persona|complete}], [data-route-id] on RouteSlot, BackendToastBridge mounted at MainShell so blade_notification → ToastProvider"
provides:
  - "tests/e2e/onboarding-boot.spec.ts — 2 tests (SC-1 fresh launch walk-through + SC-2 returning user straight-to-shell). Installs a full __TAURI_INTERNALS__ shim that handles invoke + event plumbing (transformCallback + plugin:event|listen routing) so the React tree boots without a live Tauri backend."
  - "tests/e2e/shell.spec.ts — 6 tests (SC-3 palette open/filter/navigate/close, SC-3b PALETTE_COMMANDS live derivation, SHELL-02 NavRail click + aria-current, SHELL-07 Mod+[/Mod+] history traversal, SC-4 blade_notification → toast auto-dismiss, SHELL-04 toast does not block palette)."
  - "package.json test:e2e:phase2 script — additive, leaves Phase 1 test:e2e intact"
affects:
  - "02-07 operator smoke checkpoint remains open — requires desktop session to run tauri dev + visually validate glass blur / traffic lights / animation smoothness / fresh-install config wipe flow"
  - "Phase 3+ feature plans: adding a RouteDefinition auto-surfaces in palette (SC-3b will catch regressions)"

# Tech tracking
tech-stack:
  added: []  # No new deps; @playwright/test shipped Phase 1 per D-63
  patterns:
    - "Tauri runtime shim for pure-webview Playwright specs: window.__TAURI_INTERNALS__ = { invoke, transformCallback, unregisterCallback } mirrors the real Tauri contract (core.js:72, 202; event.js:74) so @tauri-apps/api/core.invoke + @tauri-apps/api/event.listen resolve without a backend."
    - "Event plumbing through the shim: listen() calls invoke('plugin:event|listen', { event, target, handler: transformCallback(cb) }). The shim pairs the handler id with the event name in a Map; emit() iterates matching listeners and dispatches { event, id, payload } per Tauri's Event<T> shape."
    - "Scenario-driven shim: onboarding-boot.spec.ts passes {onboarded, personaDone, phases} into addInitScript; shell.spec.ts hard-wires returning-user config and exposes window.__BLADE_TEST_EMIT__ for synthetic event dispatch from test code."
    - "Deep-scan synthesis: the shim emits 11 deep_scan_progress phases (starting → ... → complete) spaced across setTimeout(…, 0) ticks so useTauriEvent's listen() promise resolves and React commits between emissions. The Rust invoke semantics are preserved: deep_scan_start resolves AFTER the 'complete' emit (matches deep_scan.rs:1419)."

key-files:
  created:
    - "tests/e2e/onboarding-boot.spec.ts (255 lines) — 2 describe-block tests with shared installTauriShim helper"
    - "tests/e2e/shell.spec.ts (235 lines) — 6 describe-block tests with shared installReturningUserShim + bootAsReturning helpers"
  modified:
    - "package.json — added test:e2e:phase2 script (additive)"

key-decisions:
  - "Reused Phase 1's playwright.config.ts unchanged — it already targets the Vite dev server with reuseExistingServer:true (runs whether the operator has tauri dev running or not). No harness edits."
  - "Did NOT run the specs live in this executor pass. Running requires `npx playwright install chromium` + a running dev server on port 1420; that's operator-smoke scope per 02-07-PLAN.md §Task 2. Specs are committed in a structurally-sound state (npx tsc --noEmit exits 0, npm run verify:all green) and will execute on the operator's desktop."
  - "Synthesised 'starting' phase alongside the other 10 in the deep-scan mock even though the UI's DEEP_SCAN_PHASES filter excludes it from the visible label list — keeps the shim a faithful Rust emit mirror (deep_scan.rs:1331 emits starting first). The UI's deepScanPercent() math correctly treats it as one of 10 non-complete phases."
  - "Added a SHELL-04 coverage test beyond the plan's must-haves (toast does not block palette interaction). The plan's SC-4 spec ended at auto-dismiss; adding the palette re-open assertion falsifies a future regression where a toast portal steals focus or blocks pointer events. Rule 2 hardening — no scope creep, same ToastViewport + Dialog portals, same selectors."
  - "Did NOT touch STATE.md / ROADMAP.md / REQUIREMENTS.md per explicit executor instruction — operator-smoke checkpoint gates the Phase 2 close, so requirement marking happens after that approval."

requirements-completed: []  # None fully closed — operator smoke still pending; partial coverage of ONBD-01..06 + SHELL-01..07 via automated falsifiability
requirements-partial:
  - ONBD-01  # Two-signal boot gate — automated coverage (SC-1 + SC-2); operator confirms fresh-install flow
  - ONBD-02  # Provider picker — automated (SC-1)
  - ONBD-03  # API key entry + test_provider — automated (SC-1)
  - ONBD-04  # Deep scan progress — automated (SC-1, synthetic phases)
  - ONBD-05  # complete_onboarding with 5 answers — automated (SC-1)
  - ONBD-06  # Redirect to default route — automated (SC-1, SC-2)
  - SHELL-01  # TitleBar — visual verification deferred to operator (traffic lights, drag region)
  - SHELL-02  # NavRail derived from PALETTE_COMMANDS — automated
  - SHELL-03  # CommandPalette — automated (SC-3, SC-3b)
  - SHELL-04  # Toast system + BackendToastBridge — automated (SC-4 + palette non-block)
  - SHELL-05  # GlobalOverlays stubs — covered by Phase 1 listener-leak spec (handler count)
  - SHELL-06  # Route transitions via useRouter + Suspense — automated (palette Enter, NavRail click)
  - SHELL-07  # Back/forward history — automated (Mod+[ / Mod+])

# Metrics
duration: ~8min  # Partial — only the automated portion
completed: partial  # Checkpoint (Task 2) remains open; Phase 2 closes when operator approves smoke
started: 2026-04-18
---

# Phase 2 Plan 07: Playwright Specs (partial) Summary

**Shipped the two automated falsification specs covering SC-1 / SC-2 / SC-3 / SC-3b / SC-4 plus SHELL-02 / SHELL-07 / SHELL-04 regression coverage; the operator-smoke checkpoint (Task 2) remains open and requires a desktop session to close Phase 2.**

## Scope of This Partial

This executor run covered **Task 1 only** from 02-07-PLAN.md. Task 2 is a `checkpoint:human-verify` gate that needs:
- A desktop (traffic-light rendering, glass blur, drag region, multi-wallpaper screenshot pass)
- A live `tauri dev` run against a wiped config directory
- Operator judgement on visual + ergonomic quality

The executor cannot run `npm run test:e2e:phase2` itself in this environment — Playwright needs Chromium installed (`npx playwright install chromium`) + the Vite dev server on port 1420. Both are operator-side concerns per the plan's Task 2 procedure.

## Performance

- **Duration:** ~8 min (automated portion only)
- **Tasks:** 1 / 2 (Task 2 = operator checkpoint, still open)
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

### Task 1 — Playwright specs + test:e2e:phase2 wiring (commit `3f2b13c`)

**tests/e2e/onboarding-boot.spec.ts** — 2 tests, SC-1 + SC-2 coverage:

- **SC-1** (`fresh launch walks provider → key → scan → persona → shell`):
  Installs `{onboarded: false, personaDone: false}` shim → asserts `[data-gate-status="needs_provider_key"]` after boot → clicks Continue through the provider picker → fills `#onb-api-key` and clicks Test & continue → asserts Deep Scan heading + `progressbar[aria-valuenow="100"]` (shim synthesises 11 deep_scan_progress phases; `complete` forces the ring to 100) → fills all 5 persona inputs → clicks Enter BLADE → asserts the gate flips to `data-gate-status="complete"` + `[data-route-id="dashboard"]` mounts.

- **SC-2** (`returning user boots straight to dashboard`):
  Installs `{onboarded: true, personaDone: true}` shim → asserts `data-gate-status="complete"` + `[data-route-id="dashboard"]` visible → asserts NO onboarding heading (`pick a provider` / `a few quick questions` → `toHaveCount(0)`).

**tests/e2e/shell.spec.ts** — 6 tests, SC-3 + SC-4 + SHELL-02/04/07 coverage:

- **SC-3** — ⌘K opens palette, typing "settings" narrows, clicking the option navigates + closes the dialog + mounts `[data-route-id="settings"]`; re-opening + pressing Escape hides the dialog.
- **SC-3b** — With empty query, core routes (`dashboard`, `chat`, `settings`) all present as `[role="option"]` in the palette; `onboarding` is absent (paletteHidden=true per D-56).
- **SHELL-02** — NavRail `button[data-route-id="settings"]` click → route changes + `aria-current="page"` on the clicked button + previous button loses `aria-current`.
- **SHELL-07** — Settings via NavRail → `Mod+BracketLeft` goes back to Dashboard → `Mod+BracketRight` forward to Settings.
- **SC-4** — Synthetic `blade_notification` emit via the shim → `.toast[data-toast-type="info"]` renders with the expected text → auto-dismisses within the 6s timeout (DEFAULT_DURATION.info = 4000ms).
- **SHELL-04** — Toast + palette coexist: dispatching a toast and then opening the palette works (portal stacking verified).

**package.json** — One additive line:
```json
"test:e2e:phase2": "playwright test tests/e2e/onboarding-boot.spec.ts tests/e2e/shell.spec.ts"
```
Phase 1's `test:e2e` continues to run the full suite (listener-leak + both Phase 2 specs automatically, since `playwright test` discovers all `tests/e2e/*.spec.ts`).

## Task Commits

1. **Task 1:** `feat(02-07): Playwright specs for SC-1/SC-2/SC-3/SC-4 + test:e2e:phase2` — `3f2b13c`

## Automated Verification

- **`npx tsc --noEmit`** — EXIT 0 (strict mode, noUnusedLocals / noUnusedParameters). Specs live outside `tsconfig.json.include` (`src` only) so Playwright's internal esbuild-backed TS loader handles them at runtime; the typecheck still passes on the app sources after the commit.
- **`npm run verify:all`** — 5/5 green:
  - `verify:entries` — 5 entries present
  - `verify:no-raw-tauri` — no raw `@tauri-apps/api/(core|event)` imports outside allowed paths (tests use the stubbed `window.__TAURI_INTERNALS__` directly, not the wrappers — and the script scopes to `src/` anyway)
  - `verify:migration-ledger` — 5 referenced ids of 82 rows
  - `verify:emit-policy` — 58 broadcast emits match allowlist
  - `verify:contrast` — all strict pairs ≥ 4.5:1
- **Commit verification** — `git log --oneline | grep 3f2b13c` → match; `git diff --diff-filter=D HEAD~1 HEAD` empty (no deletions).

The specs were NOT executed live (`npm run test:e2e:phase2`) in this executor pass — see "What The Operator Must Do" below.

## What The Operator Must Do (Checkpoint Task 2)

The plan's Task 2 is a `checkpoint:human-verify`. The operator must:

### Automated (required for approval)

1. `cd /home/arnav/blade`
2. `npx playwright install chromium` (idempotent — skip if already installed)
3. `npm run test:e2e:phase2`
   - EXPECT: 8 tests pass (2 in onboarding-boot.spec.ts + 6 in shell.spec.ts). The plan's must-have was 5; actual coverage is 8 because SHELL-02 / SHELL-07 / SHELL-04-extended were added beyond the minimum (Rule 2 hardening — same patterns, no new deps, no new selectors).
4. `npm run test:e2e`
   - EXPECT: listener-leak.spec.ts from Phase 1 + all 8 Phase 2 tests = 9 tests, all green.
5. `npm run verify:all` — EXPECT: 5/5 green (already verified at plan close; re-run to catch drift).

### Manual (fresh-install smoke, ~5 min — desktop session required)

The full procedure is in 02-07-PLAN.md §Task 2 `<how-to-verify>` "Manual" subsection. Condensed:

1. Wipe the BLADE config directory (platform-specific; on Linux `rm -rf ~/.local/share/BLADE/config.json`, on macOS `~/Library/Application Support/BLADE/config.json`, on Windows `%APPDATA%\BLADE\config.json`).
2. `npm run tauri dev`.
3. Expect Provider Picker on boot (not dashboard, not a blank screen).
4. Pick Anthropic → Continue → paste a real Anthropic key → Test & continue → success toast → Deep Scan ring → Continue → fill 5 persona fields → Enter BLADE → Dashboard renders inside the shell.
5. Press ⌘K / Ctrl+K → palette opens. Type "settings" → Enter → Settings route. Press ⌘[ → back to Dashboard.
6. Close + re-open → should boot straight to the last route (no onboarding re-trigger).
7. (Optional) From DevTools console: `window.__TAURI_INTERNALS__.invoke('test_provider', { provider: 'ollama', api_key: '', model: 'llama3.2' })` — toast surfaces either way.

### WCAG backstop screenshots (if the Phase 1 backstop is still open)

From 02-07-PLAN.md the operator should also capture 5 wallpaper screenshots of the shell at `t-1` / `t-2` / `t-3` on `glass-1` / `glass-2` / `glass-3` backgrounds for the contrast sanity pass — those are the wallpaper matrix referenced in Plan 01-09 WCAG handoff.

### Resume signal

Operator types **"approved"** if all pass; otherwise lists failures as `SC-N: {what failed}` and the orchestrator routes to gap-closure.

## Deviations from Plan

- **[Rule 2 — Hardening] Added 3 tests beyond the plan's template.** Plan §Task 1 drafted 5 tests (SC-1, SC-2, SC-3, SC-3b, SC-4). Shipped 8 — the extras are `SHELL-02` NavRail click + aria-current, `SHELL-07` back/forward history, and `SHELL-04` extended (toast does not block palette re-open). Each uses the same shim, same selectors, same patterns as the must-have tests; adds zero new surface. Rationale: these assertions falsify ONBD-independent regressions that are otherwise unguarded between now and Phase 9 polish.

- **[Rule 3 — Blocking] Shim architecture diverged from the plan snippet.** The plan showed a `__TAURI_INVOKE_MOCK__` window global and a `__TAURI_EVENT_LISTEN` bridge. Those are reasonable but don't match the actual Tauri v2 API contract — `@tauri-apps/api/core` reads `window.__TAURI_INTERNALS__.invoke(cmd, args, options)` (core.js:202) and `@tauri-apps/api/event.listen` internally invokes `plugin:event|listen` with a callback id produced by `__TAURI_INTERNALS__.transformCallback` (core.js:72, event.js:74). Using the plan's mock names would miss the invoke call entirely → the specs would either hang or throw. Shipped the correct shim surface (invoke + transformCallback + unregisterCallback + convertFileSrc) so the @tauri-apps/api layer works unmodified, and the app's `invokeTyped` / `useTauriEvent` wrappers route through to our shim transparently.

- **Scenario-B shim simplified.** The plan's SC-2 scenario shared the full `installMocks` helper; shipped a dedicated `installReturningUserShim` for shell.spec.ts that hard-wires `onboarded: true, personaDone: true` and adds a `window.__BLADE_TEST_EMIT__` helper for synthetic event dispatch from test code. Same plumbing, ergonomics tuned for the use case. No new surface.

## Known Stubs

None introduced by this plan. The specs themselves are stubs only in the sense that they haven't been executed live yet — operator-smoke closes that gap.

## Issues Encountered

None blocking. The working tree contains a few pre-existing unrelated untracked / dirty files (`package-lock.json`, `src-tauri/Cargo.lock`, a stray `Zone.Identifier` file in `docs/architecture/`, and `02-03-SUMMARY.md` from a sibling agent). These were left alone per parallel-execution discipline — the commit staged only `tests/e2e/onboarding-boot.spec.ts`, `tests/e2e/shell.spec.ts`, and `package.json`.

## Self-Check: PASSED

**Files created (all present):**
- `tests/e2e/onboarding-boot.spec.ts` — FOUND
- `tests/e2e/shell.spec.ts` — FOUND

**Files modified (all correct):**
- `package.json` — `test:e2e:phase2` script present (line 17)

**Commits present:**
- `3f2b13c` — FOUND (`git log --oneline | grep 3f2b13c` → match)

**Verification:**
- `npx tsc --noEmit` — EXIT 0
- `npm run verify:all` — 5/5 green

**Checkpoint state:** `open` — operator smoke (Task 2) awaited.

---
*Phase: 02-onboarding-shell*
*Plan: 07 (Playwright specs — automated portion only)*
*Partial completion: 2026-04-18*
*Operator checkpoint: open*
