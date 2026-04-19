---
phase: 04-overlay-windows
plan: 07
subsystem: test-surface
status: PARTIAL
partial: true
awaiting: mac-operator-smoke
tags: [playwright, e2e, verify-scripts, dev-surfaces, sc-1, sc-2, sc-3, sc-4, sc-5, d-10, d-09, d-18, hud-02, checkpoint-pending]
requirements_completed: []  # finalised only after Mac smoke closes

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Playwright harness (playwright.config.ts), __TAURI_INTERNALS__ shim pattern (listener-leak.spec.ts model)
  - phase: 02-onboarding-shell
    provides: returning-user shim template (shell.spec.ts + onboarding-boot.spec.ts — transformCallback plumbing + __BLADE_TEST_EMIT__)
  - phase: 03-dashboard-chat-settings
    plan: 03-07
    provides: Phase 3 spec harness extensions (invoke-call log pattern), verify:all 6-gate chain, verify-chat-rgba.sh sibling
  - phase: 04-overlay-windows
    plans: [04-01, 04-02, 04-03, 04-04, 04-05, 04-06]
    provides: QuickAskBridge + BackendToastBridge.severity branch + VoiceOrbWindow phase machine + GhostOverlayWindow D-10 clip + HudWindow 5 chips + blade_route_request subscriber
provides:
  - tests/e2e/quickask-bridge.spec.ts         # SC-1 falsifier
  - tests/e2e/voice-orb-phases.spec.ts        # SC-2 falsifier + self-trigger avoidance
  - tests/e2e/ghost-overlay-headline.spec.ts  # SC-3 / D-10 falsifier
  - tests/e2e/hud-bar-render.spec.ts          # SC-4 falsifier
  - tests/e2e/shortcut-fallback.spec.ts       # SC-5 falsifier
  - scripts/verify-ghost-no-cursor.sh         # D-09 regression guard
  - scripts/verify-orb-rgba.sh                # D-07/D-18/SC-2 regression guard
  - scripts/verify-hud-chip-count.sh          # HUD-02 regression guard
  - src/features/dev/{VoiceOrbDev,GhostDev,HudDev}.tsx  # 3 dev isolation routes
  - package.json: test:e2e:phase4 script + verify:all 9/9 chain
affects:
  - Phase 4 closure gated on Mac-operator smoke (M-01..M-13) — this plan ships automated falsifiers; operator walk-through on desktop session still required
  - verify:all chain grows 6 → 9 gates; CI (.github/workflows/build.yml) inherits automatically — no CI edit needed
  - src/features/dev/index.tsx: route count grows 3 → 6 (all DEV-gated, palette-hidden, tree-shaken from prod bundle)

# Tech tracking
tech-stack:
  added: []   # Zero new deps — reuses @playwright/test + bash + __TAURI_INTERNALS__ shim
  patterns:
    - "blade_route_request-driven navigation to palette-hidden dev routes (Plan 04-05 subscriber reused)"
    - "per-cmd invokeCount on __BLADE_TEST_STATE__ for assertion-of-absence (wake-word self-trigger avoidance)"
    - "pre-seed localStorage blade_prefs_v1 via addInitScript to bypass Linux Ghost dialog"
    - "CSS property-grep with selector allowlist (.orb-mic-error) — flag rAF-path blurs only"
    - "className-count pinning as a layout-stability regression gate (HUD-02)"

key-files:
  created:
    - tests/e2e/quickask-bridge.spec.ts
    - tests/e2e/voice-orb-phases.spec.ts
    - tests/e2e/ghost-overlay-headline.spec.ts
    - tests/e2e/hud-bar-render.spec.ts
    - tests/e2e/shortcut-fallback.spec.ts
    - scripts/verify-ghost-no-cursor.sh
    - scripts/verify-orb-rgba.sh
    - scripts/verify-hud-chip-count.sh
    - src/features/dev/VoiceOrbDev.tsx
    - src/features/dev/GhostDev.tsx
    - src/features/dev/HudDev.tsx
  modified:
    - package.json                       # +4 scripts (3 verify + test:e2e:phase4); verify:all 6 → 9 gates
    - src/features/dev/index.tsx         # +3 lazy imports + 3 RouteDefinition entries (phase: 4, paletteHidden)
    - src/windows/main/router.ts         # comment block updated — no code change (devRoutes spread already present)

decisions:
  - "Regression-guard trio deviates from the PLAN's embedded Task 2 (which named verify-content-protect.sh + verify-overlay-bootstraps.sh): per the user's explicit instruction, this plan ships verify-ghost-no-cursor.sh (retained from plan) + verify-orb-rgba.sh + verify-hud-chip-count.sh. The net effect is broader coverage of D-07/D-18 (blur discipline) and HUD-02 (layout stability); content-protect and overlay-bootstrap guards are deferred to a follow-up if needed."
  - "Dev isolation routes navigate via synthetic blade_route_request event instead of __BLADE_OPEN_ROUTE__ global — the Phase 1 harness never exposed the latter, but Plan 04-05 D-114 added a main-window subscriber on blade_route_request for the HUD menu, so we reuse the live contract. Zero new navigation surface."
  - ".orb-mic-error is allow-listed in verify-orb-rgba.sh — it's a transient banner shown only on microphone permission-denied, not in the rAF render path. Adding backdrop-filter anywhere else under src/features/voice-orb/ fails CI."
  - "HUD chip-count guard pins `hud-chip hud-*` classNames at 4 (time/app/god/meet); the 5th chip (HormoneChip) uses a separate CSS class. HUD-02 requires exactly 5 rendered chips; this guard catches one vector of drift — the other vector (HormoneChip removed) would be caught by tests/e2e/hud-bar-render.spec.ts."
  - "Specs are NOT run live by this executor — they target Vite dev via __TAURI_INTERNALS__ shim. Operator runs `npm run test:e2e:phase4` during the Mac-session smoke."

metrics:
  duration_min: 12
  tasks_completed: 2           # of 3 total (Task 3 is operator checkpoint)
  checkpoint_deferred: 1
  completed_date: 2026-04-18
---

# Phase 4 Plan 07: Test Surface + Regression Guards — Provisional Summary (AUTOMATED TASKS COMPLETE)

**One-liner:** Shipped 5 Playwright specs (one per Phase 4 Success Criterion), 3 bash regression guards (D-09 ghost no-cursor, D-07/D-18 orb blur discipline, HUD-02 chip-count stability), 3 DEV-only isolation routes (palette-hidden, tree-shaken from prod), and wired `verify:all` from 6 → 9 gates. The Mac-session operator smoke (M-01..M-13) is reserved for operator execution outside this run.

## What Shipped (Tasks 1-2)

### Task 1 — 5 Playwright specs + 3 dev isolation routes

| Artifact | Target SC | Assertion |
|---|---|---|
| `tests/e2e/quickask-bridge.spec.ts` | SC-1 | Synthetic `blade_quickask_bridged` emit → `.main-shell-route [data-route-id="chat"]` visible; `[data-message-id="u-1"]` bubble contains the query; "Quick ask bridged" toast surfaces. Exercises D-93/D-102/D-116 in one pass. |
| `tests/e2e/voice-orb-phases.spec.ts` | SC-2 | 4 `voice_conversation_*` emits drive `[data-phase=...]` through idle → listening → thinking → speaking → idle. Plus a `wake_word_detected` emit INSIDE the 2s ignore window asserts `start_voice_conversation` invoke count does NOT increment (T-04-03-02 self-trigger avoidance). |
| `tests/e2e/ghost-overlay-headline.spec.ts` | SC-3 / D-10 | Pre-seeds `blade_prefs_v1: {ghost.linuxWarningAcknowledged: true}` via `addInitScript` so Linux CI bypasses the warning dialog. Long-response emit → `.ghost-headline` word count 1..6; `.ghost-bullets li` count 1..2. |
| `tests/e2e/hud-bar-render.spec.ts` | SC-4 | Mocks `get_primary_safe_area_insets` → zeros; emits `hud_data_updated` + `hormone_update`; asserts `.hud-time`, `.hud-app`, `.hud-god`, `.hud-bar .hormone-chip`, `.hud-meet`. Right-click → `.hud-menu` visible with 4 `[role=menuitem]`. |
| `tests/e2e/shortcut-fallback.spec.ts` | SC-5 / D-94 | Warning payload (`severity: 'warning'`) → `.toast[data-toast-type="warn"]` with "fell back"; error payload (`severity: 'error'` + `attempted: [3 shortcuts]`) → `.toast[data-toast-type="error"]` with "could not register any of" + every attempted combo in the body. |

All five specs follow the Phase 1-3 harness (`__TAURI_INTERNALS__` shim + `__BLADE_TEST_EMIT__` helper + `addInitScript` bootstrap). Zero new deps.

**Dev isolation routes** (`src/features/dev/{VoiceOrbDev,GhostDev,HudDev}.tsx`, registered in `src/features/dev/index.tsx`):

| Route id | Component | Phase | paletteHidden |
|---|---|---|---|
| `dev-voice-orb` | `<VoiceOrbWindow/>` | 4 | true |
| `dev-ghost` | `<GhostOverlayWindow/>` | 4 | true |
| `dev-hud` | `<HudWindow/>` | 4 | true |

All three mount their Phase 4 window component inside a padded container so the SC falsifier can address selectors. They ship only in `import.meta.env.DEV` builds (router aggregator at `src/windows/main/router.ts` spreads `devRoutes` behind the `DEV` flag; Vite constant-folds the branch to `[]` in prod → tree-shaken). Navigation from tests happens via a synthetic `blade_route_request` event — the main-window `RouterProvider` subscribes this for Plan 04-05 D-114 (HUD right-click menu), so we reuse the live contract instead of exposing a new global.

Commit: `b4f740d`

### Task 2 — 3 verify scripts + package.json wiring (verify:all now 9/9)

| Script | Guard | Mechanism | Status |
|---|---|---|---|
| `scripts/verify-ghost-no-cursor.sh` | D-09 | Greps `src/features/ghost/**` + `src/windows/ghost/**` for `cursor:` property (colon required; prose with "cursor" passes). Fails on any match. | PASS (0 hits) |
| `scripts/verify-orb-rgba.sh` | D-07 / D-18 / SC-2 | awk-parses CSS under `src/features/voice-orb/**`, records the containing selector for each `backdrop-filter:` occurrence, filters out the `.orb-mic-error` allow-listed selector (rare error banner, not in rAF path). Any hit on orb rendering surface (`.orb-overlay`, `.orb-rings`, `.orb-arcs`, `.orb-core`, `.ring`, `.arc`, `.orb-compact`) fails CI. | PASS (0 violations; `.orb-mic-error` blur(12px) correctly allowed) |
| `scripts/verify-hud-chip-count.sh` | HUD-02 | `grep -cE 'hud-chip hud-[a-z]+'` in `src/features/hud/HudWindow.tsx` must equal exactly **4** (time / app / god / meet). The 5th chip (HormoneChip) uses its own `.hormone-chip` class and is not counted. Any drift (add or remove) fails CI. | PASS (4 matches) |

**`package.json`** edits:

- New scripts: `verify:ghost-no-cursor`, `verify:orb-rgba`, `verify:hud-chip-count`, `test:e2e:phase4`.
- `verify:all` chain: 6 → 9 gates. Order: `entries → no-raw-tauri → migration-ledger → emit-policy → contrast → chat-rgba → ghost-no-cursor → orb-rgba → hud-chip-count`.

Commit: `22a2c8f`

## Verification Snapshot (recorded in this run)

```bash
# Full verify chain — 9 of 9 gates green
$ npm run verify:all
[verify-entries] OK — 5 entries present on disk
[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths
[verify-migration-ledger] OK — 7 referenced ids all tracked (of 89 ledger rows)
[verify-emit-policy] OK — all 59 broadcast emits match cross-window allowlist
[audit-contrast] OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline
[verify-chat-rgba] OK — no backdrop-filter property in src/features/chat (D-70 preserved)
[verify-ghost-no-cursor] OK — no cursor property in src/features/ghost/** or src/windows/ghost/** (D-09 preserved)
[verify-orb-rgba] OK — no backdrop-filter on orb visual surfaces (D-07/D-18/SC-2 preserved)
[verify-hud-chip-count] OK — `hud-chip hud-*` className count is exactly 4 (HUD-02 preserved)

# TypeScript clean
$ npx tsc --noEmit; echo $?
0

# Artifact presence
$ ls tests/e2e/{quickask-bridge,voice-orb-phases,ghost-overlay-headline,hud-bar-render,shortcut-fallback}.spec.ts
(all 5 FOUND)
$ ls src/features/dev/{VoiceOrbDev,GhostDev,HudDev}.tsx
(all 3 FOUND)
$ test -x scripts/verify-ghost-no-cursor.sh && test -x scripts/verify-orb-rgba.sh && test -x scripts/verify-hud-chip-count.sh && echo OK
OK
```

The 5 Playwright specs were **not executed live** — they target the Vite dev server via the `__TAURI_INTERNALS__` shim, and the operator runs `npm run test:e2e:phase4` during the Mac smoke per §Mac Operator Handoff.

## Deferred Manual Smoke Checks (Task 3 — M-01..M-13)

The plan's Task 3 is a `checkpoint:human-verify` with **13 operator verifications** that cannot be executed in the Linux sandbox. These mirror `04-CONTEXT.md §mac_session_items`:

1. **M-01 — Cargo check:** `cd src-tauri && cargo check` (or `cargo check --no-default-features`) on a libclang-enabled host returns 0 errors. Validates Plan 04-01 Rust edits (quickask_submit upgrade + `send_message_stream_inline` helper + `set_wake_word_enabled` command + shortcut-fallback sequence in `register_all_shortcuts`).
2. **M-02 — All 5 windows launch:** `npm run tauri dev` boots main + quickask + overlay (voice orb) + blade_hud + ghost_overlay without Rust panic. Log output contains no `panic!` strings.
3. **M-03 — QuickAsk end-to-end:** Press shortcut (default `Ctrl+Space`) → QuickAsk appears → type "what time is it?" → Cmd+Enter → streaming response inline → auto-hide 2s after `chat_done` → main window `/chat` shows the bridged conversation (user turn + assistant answer).
4. **M-04 — CJK IME non-interference:** Add Chinese/Japanese IME in macOS Keyboard settings; switch to it; press QuickAsk shortcut. Either the primary shortcut fires, OR a warning toast appears ("fell back to Alt+Space") and QuickAsk opens via the fallback. All good if QuickAsk opens one way or another with appropriate toast.
5. **M-05 — Voice Orb 60fps:** Activity Monitor → GPU tab. Trigger voice mode (QuickAsk → Tab to voice, or "Hey BLADE" wake word). During `listening` phase (speaking into mic), GPU utilization < 20% on integrated Intel Iris-class GPU (MacBook Air M1/M2/Pro 13"). No stuttering or dropped frames during phase transitions.
6. **M-06 — Ghost invisible in OBS (macOS):** QuickTime → New Screen Recording (or OBS → Display Capture). Start recording. Trigger Ghost Mode (meeting on Zoom/Meet/Teams, or `invoke('ghost_start')` from `/diagnostics-dev`). Ghost overlay visible on screen to user. Stop recording. Play back. **Expected:** Ghost overlay IS NOT in the recorded video — excluded by `content_protected(true)`.
7. **M-07 — Ghost invisible in Windows capture (SKIP IF MAC-ONLY SESSION):** Same as M-06 but with Windows Game Bar / OBS on Windows 11.
8. **M-08 — Ghost warning on Linux (SKIP IF MAC-ONLY SESSION):** Same but verify the Linux Dialog appears on first `ghost_start` with "I understand, continue" button; overlay IS visible in Linux screen capture (by design).
9. **M-09 — HUD notch aware:** On a MacBook with a notch: HUD bar sits BELOW the notch (not hidden behind it). Visually confirm HUD's left edge starts to the right of the notch's left edge.
10. **M-10 — HUD right-click menu:** Right-click on HUD bar. Popover menu appears with 4 items. Click "Open BLADE" → main window focuses.
11. **M-11 — Voice Orb drag + corner persist:** Drag the voice orb window to the top-left corner. Release. Kill `npm run tauri dev`. Restart. Orb appears in top-left corner (persisted via `voice_orb.corner` pref).
12. **M-12 — Wake word → Voice conversation:** Enable wake word (Settings → Voice pane → "Enable wake word"). Say "Hey BLADE". Voice Orb enters `listening` phase. After `voice_conversation_ended`, wait 2s, say "Hey BLADE" again — it should work (2s ignore window has passed).
13. **M-13 — Mic permission denied:** System Preferences → Privacy → Microphone → deny BLADE. Try to start a voice conversation. Voice Orb shows "Microphone access denied" banner + retry button. No crash.

Plus the automated trio must pass green on the operator's machine:
- `npm run verify:all` → 9/9 OK
- `npm run test:e2e:phase4` → 5 specs pass
- `npm run test:e2e` → all specs Phase 1 + 2 + 3 + 4 pass green

## Mac Operator Handoff

**This handoff script SUPERSEDES the Phase 3 `03-07-SUMMARY.md §Mac Operator Handoff` — it absorbs every Phase 3 step and appends the Phase 4 M-01..M-13 walk-through.** Run each block in order; record failures by listing the step number.

```bash
# ── Prerequisites (one-time per machine; skip if already installed) ──────────
#   - Xcode Command Line Tools
#   - Homebrew
#   - llvm@15 (libclang for cargo check — addresses Phase 3 Plan 03-01 + Phase 4 Plan 04-01 Rust edits)
brew install llvm@15
export LIBCLANG_PATH="$(brew --prefix llvm@15)/lib"

# ── 1. Clone + install (skip if already cloned) ──────────────────────────────
cd ~/projects   # or wherever you keep repos
git clone git@github.com:arnav/blade.git || true
cd blade
git fetch origin && git checkout master && git pull origin master

# ── 2. Baseline installs ─────────────────────────────────────────────────────
npm install
npx playwright install chromium

# ── 3. Cargo check (M-01) ────────────────────────────────────────────────────
cd src-tauri && cargo check && cd ..
# Expected: zero errors. If libclang errors persist:
#   export LIBCLANG_PATH="$(brew --prefix llvm@15)/lib"
# and retry, or fallback:
#   cd src-tauri && cargo check --no-default-features

# ── 4. Full verify chain (9 gates) ───────────────────────────────────────────
npm run verify:all
# Expected: all 9 OK, exit 0.
# (entries, no-raw-tauri, migration-ledger, emit-policy, contrast,
#  chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count)

# ── 5. Automated Phase 3 specs (existing Phase 3 regression) ─────────────────
npm run dev &                                # start Vite dev server in background
DEV_PID=$!
sleep 5                                      # let Vite warm up
npm run test:e2e:phase3
RC3=$?
kill $DEV_PID 2>/dev/null || true
[ "$RC3" -eq 0 ] || echo "FAIL: Phase 3 specs (step 5)"

# ── 6. Automated Phase 4 specs (SC-1..SC-5 falsifiers) ───────────────────────
npm run dev &
DEV_PID=$!
sleep 5
npm run test:e2e:phase4
RC4=$?
kill $DEV_PID 2>/dev/null || true
[ "$RC4" -eq 0 ] || echo "FAIL: Phase 4 specs (step 6)"
# Expected: 5 specs pass — quickask-bridge, voice-orb-phases,
# ghost-overlay-headline, hud-bar-render, shortcut-fallback.

# ── 7. Full e2e (Phase 1 + 2 + 3 + 4 specs) ──────────────────────────────────
npm run dev &
DEV_PID=$!
sleep 5
npm run test:e2e
RC_ALL=$?
kill $DEV_PID 2>/dev/null || true
[ "$RC_ALL" -eq 0 ] || echo "FAIL: full e2e (step 7)"

# ── 8. Manual Phase 3 smoke (18-point walk-through from 03-07-SUMMARY §D-92) ─
npm run tauri dev
# Walk through the 18 steps in Phase 3 §"Deferred Manual Smoke Checks":
#   Onboarding → Dashboard (hero + chips + errors collapsible + AmbientStrip)
#   → Chat (streaming + tool approval + reasoning + compacting pill)
#   → Settings (10 tabs + Providers round-trip + Routing + Personality + About)
# Record the `dashboard-first-paint: Xms` value from the DEV console.
# For the Providers step, use a REAL Groq key (https://console.groq.com/keys — free tier).

# ── 9. Manual Phase 4 smoke (M-01..M-13; with tauri dev still running) ───────
# Ensure `npm run tauri dev` from step 8 is still up. Then:

# M-02: confirm all 5 windows (main + quickask + overlay + blade_hud + ghost_overlay)
#       launched without Rust panic. Check terminal output — no `panic!` lines.

# M-03: press the configured QuickAsk shortcut (default Ctrl+Space).
#       → QuickAsk window appears centered.
#       → Type "what time is it?" → Cmd+Enter.
#       → Streaming response appears inline in QuickAsk window.
#       → After `chat_done`, QuickAsk auto-hides after ~2s.
#       → Switch to main window → /chat route shows the bridged conversation.

# M-04: System Preferences → Keyboard → Input Sources → add a Chinese / Japanese IME.
#       Switch to that IME. Press the QuickAsk shortcut.
#       → Either QuickAsk opens via primary shortcut, OR a warning toast appears
#         ("fell back to ...") and QuickAsk opens via the fallback. Both are valid.

# M-05: Activity Monitor → View → GPU tab.
#       Trigger voice mode (QuickAsk → Tab key, or "Hey BLADE").
#       During `listening` phase (speaking into mic), observe GPU utilization.
#       → Expect: < 20% on integrated Intel Iris-class GPU (MacBook Air M1/M2/Pro 13").
#       → Visually confirm no stuttering / no dropped frames during phase transitions.

# M-06: QuickTime Player → File → New Screen Recording (or OBS → Display Capture).
#       Start recording. Trigger Ghost Mode (meeting on Zoom/Meet/Teams, or
#       `invoke('ghost_start')` from /diagnostics-dev).
#       → Ghost overlay visible to user on screen.
#       → Stop recording. Play back.
#       → Expect: Ghost overlay IS NOT in the recorded video (content_protected(true)).

# M-07 (skip on mac-only session): Windows Game Bar / OBS on Windows 11 — same as M-06.
# M-08 (skip on mac-only session): Linux — first ghost_start shows Dialog with
#       "I understand, continue". Overlay IS visible in a Linux screen capture.

# M-09: On a MacBook with a notch: HUD bar sits BELOW the notch (not hidden behind it).
#       Visually verify HUD's left edge starts to the right of the notch's left edge.

# M-10: Right-click on the HUD bar. Popover menu appears with 4 items.
#       Click "Open BLADE" → main window focuses.

# M-11: Drag the voice orb window to the top-left corner. Release.
#       Kill `npm run tauri dev`. Restart. Orb appears in top-left corner.

# M-12: Enable wake word: Settings → Voice pane → "Enable wake word".
#       Say "Hey BLADE". Voice Orb enters listening phase.
#       After voice_conversation_ended, wait 2s, say "Hey BLADE" again → works.

# M-13: System Preferences → Privacy → Microphone → deny BLADE.
#       Try to start a voice conversation. Voice Orb shows "Microphone access
#       denied" banner + retry button. No crash.

# ── 10. Production bundle sanity ─────────────────────────────────────────────
npm run tauri build
# Run the produced bundle once — it should open, hit the dashboard, and
# still display ambient / perception data (background tasks intact).
# Confirm all 5 windows launch from the prod bundle as well.
```

If any step fails, reply in the plan thread with:

- the step number that failed (e.g. "M-05" or "step 6")
- the exact error output (copy from terminal)
- (for visual issues) a screenshot of the affected surface

The planner will route any failure via `/gsd-plan-phase --gaps` to a follow-up plan.

**If ALL steps 1-10 pass AND the Phase 1 WCAG 5-wallpaper eyeball is closed AND the Phase 2 operator smoke is closed, reply with the single word: `approved`** — Phase 1 (WCAG) + Phase 2 + Phase 3 + Phase 4 are then considered complete in one bundled session per `STATE.md` continuity plan.

## Deviations from Plan

### Rule 2 — User instruction supersedes plan artifact list

**1. Different regression-guard trio than PLAN Task 2 named**
- **Found during:** Task 2 execution.
- **Plan named:** `verify-ghost-no-cursor.sh`, `verify-content-protect.sh`, `verify-overlay-bootstraps.sh`.
- **User instruction named:** `verify-ghost-no-cursor.sh`, `verify-orb-rgba.sh`, `verify-hud-chip-count.sh`.
- **Resolution:** Shipped the user-specified trio. `verify-ghost-no-cursor.sh` is common to both lists and was built per the plan. `verify-orb-rgba.sh` + `verify-hud-chip-count.sh` replace content-protect + overlay-bootstraps guards.
- **Coverage trade-off:**
  - Gained: D-07/D-18 blur discipline (verify-orb-rgba) + HUD-02 chip-count stability (verify-hud-chip-count).
  - Deferred: D-96 content-protected-at-Rust-layer grep + Phase-1-placeholder detection in overlay bootstraps. Both of those checks are effectively covered by other signals:
    - D-96 is now verified by the M-06 / M-07 operator smoke (the only truthful test — does OBS actually exclude the overlay?).
    - Phase-1 placeholder detection is subsumed by `npx tsc --noEmit` + the existing `test:e2e:phase2` / `test:e2e:phase4` specs that mount real components via the dev isolation routes.
- **Follow-up:** If a future phase wants stricter CI coverage of D-96 + overlay bootstraps, add those two guards as new scripts without touching the existing trio.

### Rule 3 — Allow-list `.orb-mic-error` in verify-orb-rgba

- **Found during:** Task 2, initial run of `verify-orb-rgba.sh`.
- **Issue:** `src/features/voice-orb/orb.css:242` has `backdrop-filter: blur(12px)` on `.orb-mic-error` (the error banner shown only on microphone permission denial).
- **Fix:** Added `.orb-mic-error` to the awk-level allow list. Rationale: the banner appears ≤ once per session on permission denial and is not in the rAF render path, so it does not violate SC-2's ≥60fps budget. Added a clear comment in the script explaining the exemption + extension procedure.
- **Files modified:** `scripts/verify-orb-rgba.sh` (allow-list logic + comment).

### Rule 3 — dev-route navigation without `__BLADE_OPEN_ROUTE__`

- **Found during:** Task 1, while wiring specs.
- **Issue:** The PLAN snippet uses `(window as any).__BLADE_OPEN_ROUTE__?.('dev-voice-orb')` but the Phase 1-3 harness never exposed `__BLADE_OPEN_ROUTE__` on `window` — searching `src/` and `tests/` confirms it does not exist.
- **Fix:** Route navigation in all three dev-route specs (voice-orb-phases, ghost-overlay-headline, hud-bar-render) instead emits a synthetic `blade_route_request` event. Main-window `RouterProvider` already subscribes this event via `useTauriEvent` (D-114, see `src/windows/main/useRouter.ts:117-122`) and calls `openRoute(e.payload.route_id)` with the built-in `ROUTE_MAP.has` guard. Reuses the live contract; zero new navigation surface.

## TDD Gate Compliance

Plan `type: execute` (not `tdd`). No RED/GREEN gate requirement. Specs added are E2E falsifiers, not TDD-style unit tests — appropriate for SC-falsification.

## Threat Flags

None — no new security-relevant surface. Dev isolation routes (Phase 4) are DEV-gated + palette-hidden; `import.meta.env.DEV` constant-folds to `false` in prod builds and the full `devRoutes` module tree-shakes. Verify scripts are read-only greps with no user-controlled input paths.

## Phase 4 Completion Status

Plan 04-07's AUTOMATION-layer success criteria all satisfied. Remaining work bundled into the cross-phase Mac-operator session:

- [ ] Task 3 checkpoint (human-verify) — 13-point M-01..M-13 walk-through
- [ ] Bundled with Phase 1 WCAG 5-wallpaper eyeball + Phase 2 operator smoke + Phase 3 Mac smoke per STATE.md
- [ ] Operator runs the **supersede-all handoff script** above in a single session

Once the checkpoint closes with "approved", Phase 1 (WCAG) + Phase 2 + Phase 3 + Phase 4 are all complete and Phase 5 (Agents + Knowledge) unblocks.

## Self-Check: PASSED

Files (all 11 created artifacts exist; 3 modified):

- FOUND: tests/e2e/quickask-bridge.spec.ts
- FOUND: tests/e2e/voice-orb-phases.spec.ts
- FOUND: tests/e2e/ghost-overlay-headline.spec.ts
- FOUND: tests/e2e/hud-bar-render.spec.ts
- FOUND: tests/e2e/shortcut-fallback.spec.ts
- FOUND: scripts/verify-ghost-no-cursor.sh (executable)
- FOUND: scripts/verify-orb-rgba.sh (executable)
- FOUND: scripts/verify-hud-chip-count.sh (executable)
- FOUND: src/features/dev/VoiceOrbDev.tsx
- FOUND: src/features/dev/GhostDev.tsx
- FOUND: src/features/dev/HudDev.tsx
- FOUND (modified): package.json (+4 scripts, verify:all 6 → 9 gates)
- FOUND (modified): src/features/dev/index.tsx (+3 lazy imports + 3 RouteDefinition entries)
- FOUND (modified): src/windows/main/router.ts (comment block only; no code change)

Commits (2 task commits + this summary commit to follow):

- FOUND: b4f740d test(04-07): Phase 4 Playwright specs + 3 dev isolation routes
- FOUND: 22a2c8f build(04-07): 3 verify scripts + verify:all 9/9 + test:e2e:phase4
