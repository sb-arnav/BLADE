---
phase: 03-dashboard-chat-settings
plan: 06
subsystem: settings-ui
tags: [react, settings, providers, routing, voice, personality, iot, privacy, diagnostics, about, tabs, lazy-suspense]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: 9 primitives (Button, Card, Input, Pill, Dialog, GlassSpinner, …), tokens.css, RouteDefinition, MainShell suspense slot, useRouterCtx
  - phase: 02-onboarding-shell
    provides: PROVIDERS registry (src/features/onboarding/providers.ts), Phase 2 config wrappers (testProvider/storeProviderKey/switchProvider/setConfig), useToast, ToastContext, useOnboardingGate
  - phase: 03-dashboard-chat-settings
    provides: 03-02 wrappers (getTaskRouting/setTaskRouting/resetOnboarding/saveConfigField/debugConfig/historyList/Delete/iotListEntities/iotSetState/iotSpotifyNowPlaying)
provides:
  - SettingsShell — tabbed shell with 10 lazy-loaded panes
  - 10 functional Settings panes (Providers/Models/Routing/Voice/Personality/Appearance/IoT/Privacy/Diagnostics/About)
  - 11 RouteDefinition entries (parent settings + 10 children) all wired to SettingsShell
  - settings.css — flat (no backdrop-filter) tab + pane layout
affects:
  - Phase 3 SC-4 substrate (Settings saves a provider key; persists after restart; routing grid reflects updated config) — ProvidersPane + RoutingPane round-trip ready for Plan 03-07 Playwright spec
  - Phase 4 (Voice toggle wiring picks up where wake_word_enabled is currently read-only)
  - Phase 7 (Admin Diagnostics consumes the SET-09 doorway)
  - Phase 9 polish (IoT/HA token setter, "Reveal config dir" button, accent removal already locked)

# Tech tracking
tech-stack:
  added: []  # Pure UI plan — composes existing primitives + Phase 3 wrappers
  patterns:
    - "Tab router via useRouterCtx — single SettingsShell component referenced by 11 RouteDefinitions; pane derived from routeId"
    - "Lazy-loaded pane modules (lazy() + Suspense) — only the active pane parses + mounts; tab switch loads target pane on demand"
    - "Critical Rust write-surface enforcement — voice fields go via setConfig (commands.rs:1944), NOT save_config_field; ha_base_url goes via save_config_field (config.rs:737); ha_token + wake_word_enabled have NO Rust setter and are read-only"
    - "Destructive actions gated by Dialog confirmation (Re-run onboarding, Reset prefs, Clear history)"
    - "Fail-soft on missing wrappers — TauriError.kind === 'not_found' check in IoTPane shows 'unavailable' notice instead of breaking the pane"

key-files:
  created:
    - src/features/settings/SettingsShell.tsx                         # Tabbed shell (10 lazy panes)
    - src/features/settings/settings.css                              # Tab + pane layout — zero backdrop-filter
    - src/features/settings/panes/ProvidersPane.tsx                   # SET-01
    - src/features/settings/panes/ModelsPane.tsx                      # SET-02
    - src/features/settings/panes/RoutingPane.tsx                     # SET-03
    - src/features/settings/panes/VoicePane.tsx                       # SET-04
    - src/features/settings/panes/PersonalityPane.tsx                 # SET-05
    - src/features/settings/panes/AppearancePane.tsx                  # SET-06
    - src/features/settings/panes/IoTPane.tsx                         # SET-07
    - src/features/settings/panes/PrivacyPane.tsx                     # SET-08
    - src/features/settings/panes/DiagnosticsEntryPane.tsx            # SET-09
    - src/features/settings/panes/AboutPane.tsx                       # SET-10
  modified:
    - src/features/settings/index.tsx                                 # 11 RouteDefinitions all → SettingsShell (was 10 ComingSoonSkeleton stubs)
    - .planning/migration-ledger.md                                   # 5 new rows (settings-models/routing/appearance/privacy/diagnostics) + 2 renames (integrations→iot, ambient→personality) + 7 status flips to Shipped

key-decisions:
  - "VoicePane uses setConfig (commands.rs:1944) for voice_mode/tts_voice/voice_shortcut/quick_ask_shortcut — save_config_field's allow-list at config.rs:728-752 does NOT include these fields; calling saveConfigField('voice_mode', …) throws 'Unknown config field' at runtime. Plan checker iter 2 caught this; fix is encoded in the pane + comment block."
  - "wake_word_enabled is read-only display in Phase 3 — no Rust setter exists (set_config and save_config_field both reject it). VoicePane shows current value as a Pill + 'Phase 4 will add toggle' notice. Same for ha_token in IoTPane (read from HA_TOKEN env var; no Rust setter)."
  - "PROVIDERS registry from src/features/onboarding/providers.ts is reused verbatim by ProvidersPane and RoutingPane (D-81 — no duplication). Adds a card-based grid wrapping the same data the onboarding picker exposes."
  - "Settings tab id scheme matches D-79 exactly: settings-providers / -models / -routing / -voice / -personality / -appearance / -iot / -privacy / -diagnostics / -about. Legacy ids settings-integrations and settings-ambient renamed (kept as Deferred ledger rows with cross_refs); legacy paletteHidden routes (settings-ghost / settings-autonomy / settings-shortcuts / settings-advanced) dropped from Phase 3 top-level tabs and marked Deferred."
  - "All 10 panes share a single SettingsShell component — 11 RouteDefinition entries point at the SAME lazy-loaded shell; activeId is derived from routeId. Tab clicks call openRoute(tabId) which both navigates and triggers the lazy import."
  - "Destructive actions (Re-run onboarding, Reset prefs, Clear conversation history) gated by Dialog confirmation — T-03-06-03 / T-03-06-06 mitigations from the plan threat register."
  - "ProvidersPane clears pending key from component state IMMEDIATELY after successful storeProviderKey — T-03-06-02 mitigation; no API key sits in React state after save."
  - "IoTPane HA token surfaces as an env-var instructional notice — Phase 3 deliberately does NOT add a token setter (would require Rust 6-place rule violation per D-66). Phase 4 or later adds the setter command."
  - "DiagnosticsEntryPane DEV/PROD bifurcated — DEV path opens diagnostics-dev + wrapper-smoke + dumps debug_config(); PROD shows 'Phase 7 admin' notice. T-03-06-08 mitigation (debug_config output potentially-sensitive, DEV-only)."
  - "AppearancePane is a static readout per D-15 (no light theme, no accent picker permanently out of scope). Only action is usePrefs().resetPrefs() with confirmation."

patterns-established:
  - "Tab-router-per-feature: a single Shell component referenced by N RouteDefinitions; activeId derived from routeId. Rectangle-grid alternative to nested route trees that doesn't require react-router-dom (D-05 retained)."
  - "Rust write-surface comment block at the top of every save-touching pane — explicitly cites the Rust file:line allow-list and the consequence of using the wrong wrapper. Future executors maintaining these panes have the gotcha in their face."
  - "Fail-soft via TauriError.kind === 'not_found' for optional integrations (IoTPane) — pane stays mounted and useful even when the wrapper isn't registered."

requirements-completed:
  - SET-01  # ProvidersPane — 6 cards (Test + Save & switch); reuses PROVIDERS registry
  - SET-02  # ModelsPane — provider/model picker (per-provider hardcoded model menus + token-efficient toggle)
  - SET-03  # RoutingPane — 5-row grid (code/vision/fast/creative/fallback); inline "No key" warning
  - SET-04  # VoicePane — voice_mode/tts_voice/voice_shortcut/quick_ask_shortcut via setConfig; wake_word_enabled read-only
  - SET-05  # PersonalityPane — name/work_mode/response_style/email + Re-run onboarding (Dialog-gated)
  - SET-06  # AppearancePane — locked dark theme + typography readout + Reset prefs
  - SET-07  # IoTPane — HA URL save + entities list + Spotify; HA_TOKEN env-var notice
  - SET-08  # PrivacyPane — local-first readout + Clear conversation history (Dialog-gated loop)
  - SET-09  # DiagnosticsEntryPane — DEV doorway + debugConfig dump; PROD Phase-7 notice
  - SET-10  # AboutPane — version + Tauri runtime + GitHub + credit

# Metrics
duration: ~10min
completed: 2026-04-19
---

# Phase 3 Plan 06: Settings Shell + 10 Panes Summary

**Replaces the 10 Phase 1 ComingSoonSkeleton stubs at `settings-*` with a working SettingsShell + 10 functional panes. Hits SET-01..10 verbatim. Critical Rust write-surface invariants enforced (VoicePane uses setConfig — not save_config_field — for voice fields per checker iter 2 fix; wake_word_enabled and ha_token are read-only because no Rust setter exists). Plan ran in Wave 3 alongside 03-03 (chat) and 03-05 (dashboard) on disjoint feature directories — zero touch to src/features/chat/ or src/features/dashboard/.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-19T10:18:07Z (immediately after Wave 3 spawn)
- **Completed:** 2026-04-19T10:27:36Z
- **Tasks:** 2 (both auto, no checkpoints)
- **Files created:** 12 (SettingsShell + 10 panes + settings.css)
- **Files modified:** 2 (index.tsx route registration + migration-ledger.md)
- **Net new lines:** ~1900 LoC TS/CSS + JSDoc cites
- **No new dependencies; no Rust touched.**

## Accomplishments

### Task 1 — SettingsShell + 5 admin-style panes (commit `96b2003`)

Replaced the Phase 1 stubs with a real tabbed shell + 5 panes:

| Component | Closes | Save surface | Notes |
| --------- | ------ | ------------ | ----- |
| `SettingsShell.tsx` | — | — | Tab nav + lazy Suspense pane; activeId derived from `useRouterCtx().routeId` |
| `settings.css` | — | — | Zero backdrop-filter (D-07 cap); 220px nav + 1fr pane grid |
| `ModelsPane` | SET-02 | `switchProvider` + `setConfig` (token-efficient) | Per-provider hardcoded model menus; preserves out-of-list model |
| `RoutingPane` | SET-03 | `setTaskRouting` | 5-row grid; inline "No key stored" warning via `getAllProviderKeys` cross-check |
| `VoicePane` | SET-04 | `setConfig` (voice_mode / tts_voice / voice_shortcut / quick_ask_shortcut) — **NOT** `saveConfigField` | wake_word_enabled read-only display; "Phase 4 toggle" notice |
| `PersonalityPane` | SET-05 | `setConfig` (user_name / work_mode / response_style / blade_email) + `resetOnboarding` (Dialog-gated) | |
| `AppearancePane` | SET-06 | `usePrefs().resetPrefs` (Dialog-gated) | Static readout per D-15; no theme/accent options |

Route registration: `src/features/settings/index.tsx` now exports 11 `RouteDefinition` entries (parent `settings` + 10 children), all pointing at the SAME lazy-loaded `SettingsShell`. Legacy ids `settings-integrations`, `settings-ambient`, `settings-ghost`, `settings-autonomy`, `settings-shortcuts`, `settings-advanced` are no longer top-level tabs (per D-79).

### Task 2 — 5 remaining panes (commit `cfc3885`)

| Component | Closes | Save surface | Notes |
| --------- | ------ | ------------ | ----- |
| `ProvidersPane` | SET-01 | `testProvider` + `storeProviderKey` + `switchProvider` | Reuses PROVIDERS registry from onboarding; pending key cleared post-save (T-03-06-02) |
| `IoTPane` | SET-07 | `saveConfigField('ha_base_url', …)` + `iotSetState` | HA_TOKEN env-var notice; fail-soft on `kind === 'not_found'` (T-03-06-07) |
| `PrivacyPane` | SET-08 | `historyDeleteConversation` loop | Dialog-gated; partial-failure path reports ok/fail counts |
| `DiagnosticsEntryPane` | SET-09 | `debugConfig` (DEV-only) | DEV path opens diagnostics-dev + wrapper-smoke; PROD shows Phase 7 notice |
| `AboutPane` | SET-10 | — (static) | Version via `__APP_VERSION__` define with fallback constant |

Migration ledger updated: 5 new rows for the new tab ids, 2 renames (settings-integrations → settings-iot, settings-ambient → settings-personality), 4 legacy rows flipped to Deferred, 6 settings rows flipped to Shipped.

## Task Commits

| # | Task | Commit | Files Changed |
| - | ---- | ------ | ------------- |
| 1 | SettingsShell + index.tsx + css + 5 admin panes | `96b2003` | 8 files (1166 insertions, 19 deletions) |
| 2 | 5 remaining panes (Providers/IoT/Privacy/Diagnostics/About) + ledger | `cfc3885` | 6 files (776 insertions, 10 deletions) |

## Critical Rust Write-Surface Invariants (Enforced)

These were the checker iter 2 corrections — the plan was tightened before execution and the implementation respects them verbatim:

1. **`save_config_field` allow-list (config.rs:728-752):** ONLY `blade_source_path`, `user_name`, `obsidian_vault_path`, `work_mode`, `response_style`, `trusted_ai_delegate`, `ha_base_url`, `screen_timeline_enabled`, `timeline_capture_interval`, `timeline_retention_days`. Anything else throws `Unknown config field: {key}` at runtime.
2. **`set_config` (commands.rs:1944):** Accepts the voice-related fields (`voice_mode`, `tts_voice`, `voice_shortcut`, `quick_ask_shortcut`) plus most user-facing personality fields. Used by VoicePane + PersonalityPane + ModelsPane (token-efficient).
3. **No Rust setter for `wake_word_enabled` or `ha_token`:** Phase 3 honors this — VoicePane shows wake_word as a read-only Pill + "Phase 4 toggle" notice; IoTPane shows `HA_TOKEN` as an env-var instructional notice.

Verification grep confirms zero bad calls:

```
$ grep -rE "saveConfigField\(['\"](wake_word|ha_token|voice_mode|tts_voice|voice_shortcut|quick_ask_shortcut)" src/features/settings/
# only matches inside the WARNING comment block in VoicePane.tsx
```

## Decisions Made

1. **Tab router via single SettingsShell + 11 RouteDefinitions.** Each child id has its own RouteDefinition (so ⌘K palette, NavRail, and direct openRoute('settings-routing') all work) but they all reference the same lazy-loaded SettingsShell. The shell derives the active pane from `routeId`. Avoids nested route trees + react-router-dom (D-05 retained).

2. **Lazy-load each pane.** Each pane is a separate `lazy(() => import('./panes/X'))` so tab switching parses + mounts only the target pane on demand. Initial Settings load = SettingsShell + ProvidersPane (the default). Other panes lazy-load on first click.

3. **Reuse PROVIDERS registry verbatim** (D-81) — ProvidersPane and RoutingPane both import from `src/features/onboarding/providers.ts`. No duplication. If a 7th provider is added, both surfaces pick it up automatically.

4. **Per-provider model menus hardcoded inline** in ModelsPane (D-82). Phase 7 may swap to a live `list_models_for_provider` wrapper. The hardcoded menu always preserves the currently-saved model in the dropdown even if outside the menu (prevents silent reset on save).

5. **Re-run onboarding bounces via gate, not direct route push.** PersonalityPane calls `resetOnboarding()` then `useConfig().reload()` — `MainShell.useOnboardingGate()` re-evaluates and routes the user back to the persona step. The pane never directly mutates router state.

6. **HA token surfaced as an env-var notice, not a save form.** Phase 3 deliberately does NOT add a Rust token setter (would force a 6-place-rule expansion per D-66). The IoTPane Connect-HA section shows `HA_TOKEN` as an instructional notice with the trade-off documented in the comment block.

7. **DiagnosticsEntryPane is intentionally minimal.** Per D-89 it's a "doorway" — the full Diagnostics view is Phase 7 (Admin cluster). DEV path opens diagnostics-dev + wrapper-smoke; PROD shows a Phase-7 notice.

8. **Migration ledger renames recorded with cross_refs.** `settings-integrations` and `settings-ambient` rows kept as Deferred with cross_refs pointing at their replacements. `settings-iot` and `settings-personality` rows added with reciprocal cross_refs back to the legacy ids. Verifier passes.

## Files Created (12)

```
src/features/settings/SettingsShell.tsx                  (~75 lines)
src/features/settings/settings.css                       (~210 lines)
src/features/settings/panes/ProvidersPane.tsx            (~165 lines)
src/features/settings/panes/ModelsPane.tsx               (~175 lines)
src/features/settings/panes/RoutingPane.tsx              (~155 lines)
src/features/settings/panes/VoicePane.tsx                (~175 lines)
src/features/settings/panes/PersonalityPane.tsx          (~210 lines)
src/features/settings/panes/AppearancePane.tsx           (~125 lines)
src/features/settings/panes/IoTPane.tsx                  (~210 lines)
src/features/settings/panes/PrivacyPane.tsx              (~175 lines)
src/features/settings/panes/DiagnosticsEntryPane.tsx     (~120 lines)
src/features/settings/panes/AboutPane.tsx                (~75 lines)
```

## Files Modified (2)

```
src/features/settings/index.tsx                          (10 stubs → 11 SettingsShell entries)
.planning/migration-ledger.md                            (+5 new rows; 4 deferred-renames; 6 status flips to Shipped)
```

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | **0 errors** ✓ |
| `npm run verify:entries` | OK — 5 entries on disk ✓ |
| `npm run verify:no-raw-tauri` | OK — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths ✓ |
| `npm run verify:migration-ledger` | OK — 7 referenced ids tracked of 89 ledger rows ✓ |
| `npm run verify:emit-policy` | OK — all 59 broadcast emits match cross-window allowlist ✓ |
| `npm run verify:contrast` | OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline ✓ |
| `npm run verify:all` | **5 of 5 gates pass** ✓ |
| Inline grep: `saveConfigField('wake_word\|ha_token\|voice_mode\|tts_voice\|voice_shortcut\|quick_ask_shortcut')` against panes | **ZERO** matches outside warning comments ✓ |
| Inline grep: `backdrop-filter` against `settings.css` | **ZERO** matches outside comment ✓ |
| `grep -nE "id: 'settings-(models\|routing\|appearance\|privacy\|diagnostics)'" src/features/settings/index.tsx` | **5 matches** ✓ |
| `grep -nE "id: 'settings-(integrations\|ambient)'" src/features/settings/index.tsx` | **0 matches** (legacy ids removed from active routes) ✓ |
| `grep -nE "PROVIDERS" src/features/settings/panes/{Providers,Routing}Pane.tsx` | matches in both ✓ |

## Deviations from Plan

### Auto-applied (Rule 1/2/3)

**1. [Rule 2 — Auto-add critical functionality] Migration ledger updated to record renames + new tab ids**

- **Found during:** Task 2 wrap-up.
- **Issue:** Plan §1c instructs the executor to record the `settings-integrations → settings-iot` and `settings-ambient → settings-personality` renames in the migration ledger; verify:migration-ledger script doesn't strictly require it (it only flags `openRoute('id')` literals), but the ledger is the project's traceability record per P-03.
- **Fix:** Added 5 new rows for the new tab ids (settings-models / -routing / -appearance / -privacy / -diagnostics), recorded the 2 renames as Deferred rows with `cross_refs` columns pointing at their replacements, and flipped 6 settings rows to Shipped.
- **Files:** .planning/migration-ledger.md
- **Commit:** cfc3885

**2. [Rule 2 — Auto-add critical functionality] Per-provider model dropdown preserves out-of-list model**

- **Found during:** Task 1d (ModelsPane).
- **Issue:** Plan instructed "if not in list, use config.model as the only option" but a literal interpretation would silently reset other dropdown options. Cleaner: include the saved model AT THE TOP of the existing menu so the user sees both their current pick and the standard alternates.
- **Fix:** `useMemo` builds the option list, prepending `config.model` when it's outside the hardcoded menu.
- **Files:** src/features/settings/panes/ModelsPane.tsx
- **Commit:** 96b2003

**3. [Rule 1 — Bug] AboutPane version sourcing**

- **Found during:** Task 2e (AboutPane).
- **Issue:** Plan suggested `import.meta.env.PACKAGE_VERSION` — that's not a default Vite-injected variable. Defining `__APP_VERSION__` in vite.config.ts is the standard pattern.
- **Fix:** AboutPane uses `declare const __APP_VERSION__: string | undefined` with a typeof guard + fallback constant. If a future Vite config wires `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` the version becomes live; otherwise the constant ships. Documented in the file header.
- **Files:** src/features/settings/panes/AboutPane.tsx
- **Commit:** cfc3885

### No Rule 4 (architectural) issues encountered.

The plan's checker iter 2 fix (VoicePane uses setConfig, not save_config_field) was applied verbatim — no further architectural decisions needed.

## Issues Encountered

- None blocking. Pure additive UI plan; no Rust changes; no event surface changes; reuses Phase 2 wrappers (Phase 3 Plan 02 shipped them).
- The `verify:emit-policy` warning that Plan 03-02 SUMMARY documented (homeostasis.rs:444 hormone_update broadcast) was already resolved in commit `26c1268` ("fix(03): allowlist hormone_update + reword executor.rs WIRE-05 comment") so all 5 verify gates pass cleanly here.

## User Setup Required

**None.** Pure UI plan — runs against the existing Phase 2 backend and Phase 3 wrapper surface. No env vars, no auth, no infra changes.

The Phase 3 SC-4 spec (Plan 03-07) will manually verify provider key persistence end-to-end in `npm run tauri dev`.

## Next Phase Readiness

**Plan 03-07 (specs) unblocked:** ProvidersPane round-trip ready for the Playwright `settings-provider.spec.ts` per D-91. RoutingPane round-trip ready for SC-4 falsifiability. SettingsShell tabs reachable via openRoute or palette for the 10-tab smoke walk per D-92.

**Phase 4 (overlays + voice orb) unblocked:** VoicePane displays current `voice_mode` / `tts_voice` / `voice_shortcut` / `quick_ask_shortcut`. When Phase 4 wires the voice orb + adds a `set_wake_word_enabled` Rust command, only VoicePane needs an edit — no shell or routing surgery.

**Phase 7 (Admin cluster) unblocked:** `DiagnosticsEntryPane` is the doorway; full Diagnostics view at `diagnostics-dev` already exists for DEV. Phase 7 ADMIN-* will replace the PROD-side "Phase 7 admin" notice with a real link to the admin diagnostics route.

**No new blockers introduced.**

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already enumerated (T-03-06-01..12). The plan's threat register accurately describes the wrapper surface; no new endpoints, no new auth paths, no new file-access patterns. All wrappers compose existing Rust commands that were already analyzed in Phase 1+2 + Plan 03-01 + Plan 03-02.

The "Clear conversation history" loop (PrivacyPane) is destructive but gated by Dialog confirmation; the loop runs sequentially, ok/fail counts surfaced in toast (T-03-06-06 mitigation in place).

## Self-Check: PASSED

- File `src/features/settings/SettingsShell.tsx` exists — confirmed (`ls`).
- File `src/features/settings/settings.css` exists — confirmed.
- File `src/features/settings/panes/ProvidersPane.tsx` exists — confirmed.
- File `src/features/settings/panes/ModelsPane.tsx` exists — confirmed.
- File `src/features/settings/panes/RoutingPane.tsx` exists — confirmed.
- File `src/features/settings/panes/VoicePane.tsx` exists — confirmed.
- File `src/features/settings/panes/PersonalityPane.tsx` exists — confirmed.
- File `src/features/settings/panes/AppearancePane.tsx` exists — confirmed.
- File `src/features/settings/panes/IoTPane.tsx` exists — confirmed.
- File `src/features/settings/panes/PrivacyPane.tsx` exists — confirmed.
- File `src/features/settings/panes/DiagnosticsEntryPane.tsx` exists — confirmed.
- File `src/features/settings/panes/AboutPane.tsx` exists — confirmed.
- File `src/features/settings/index.tsx` modified (11 RouteDefinitions, all → SettingsShell) — confirmed.
- File `.planning/migration-ledger.md` modified (5 new rows + 2 renames + 6 status flips) — confirmed.
- Commit `96b2003` exists in git log — confirmed (`feat(03-06): SettingsShell + 5 admin panes …`).
- Commit `cfc3885` exists in git log — confirmed (`feat(03-06): 5 remaining settings panes …`).
- `npx tsc --noEmit` returns 0 errors — confirmed.
- `npm run verify:all` returns OK on all 5 gates — confirmed.

---
*Phase: 03-dashboard-chat-settings*
*Plan: 06*
*Completed: 2026-04-19*
