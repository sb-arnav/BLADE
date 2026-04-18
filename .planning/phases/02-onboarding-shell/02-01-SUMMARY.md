---
phase: 02-onboarding-shell
plan: 01
subsystem: infra
tags: [tauri, typescript, onboarding, deep-scan, provider-registry, state-machine]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "invokeTyped + TauriError + useTauriEvent + BLADE_EVENTS registry + payloads.ts + usePrefs single-blob pattern + @/types/config BladeConfig + no-raw-tauri ESLint gate"
provides:
  - "6 new typed Tauri wrappers (testProvider, getAllProviderKeys, storeProviderKey, switchProvider, setConfig, deepScanStart/Results/Summary) — all snake_case arg keys with Rust file:line JSDoc cites (D-38)"
  - "Window-control wrapper trio (minimizeWindow, closeWindow, toggleMaximize) — TitleBar's no-raw-invoke surface for @tauri-apps/api/window"
  - "Corrected DeepScanProgressPayload type: {phase: string, found: number} matching Rust deep_scan.rs:1325 emit (D-49)"
  - "PROVIDERS constant array (6 providers, Anthropic at index 0) + DEFAULT_PROVIDER export"
  - "useOnboardingState() — 4-step machine hook (provider/apikey/scan/persona) with atomic setters + fixed 5-tuple personaAnswers"
  - "DEEP_SCAN_PHASES ordered 11-phase tuple + deepScanPercent() helper + PHASE_LABEL map"
  - "Prefs extension: palette.recent (JSON-encoded string) + onboarding.deep_scan_completed"
  - "src/types/provider.ts: ProviderId literal union + ProviderKeyList + DeepScanResults DTO types"
affects: ["02-04 OnboardingFlow (consumes PROVIDERS, useOnboardingState, the 5 provider wrappers, deepScan wrappers, DEEP_SCAN_PHASES + deepScanPercent)", "02-03 TitleBar (consumes minimizeWindow/closeWindow/toggleMaximize)", "02-05 CommandPalette (consumes palette.recent pref)"]

# Tech tracking
tech-stack:
  added: []  # No new libraries or tools — pure additive wiring on Phase 1 substrate
  patterns:
    - "4-command provider-persistence composition (test_provider → store_provider_key → switch_provider → set_config) per D-50, working around the missing save_config_cmd"
    - "Phase enumeration + client-side percent derivation pattern — Rust emits {phase, found}, TS owns the 0-100 UI number"
    - "State-machine hook ships the surface, components compose — the hook has no render, no event subscription, no invoke call; Plan 02-04 wires both"
    - "JSON-encoded string in prefs blob as the escape hatch for array values without widening the Prefs index signature (applied to palette.recent)"

key-files:
  created:
    - "src/lib/tauri/deepscan.ts (35 lines) — deepScanStart/Results/Summary wrappers"
    - "src/lib/tauri/window.ts (27 lines) — minimizeWindow/closeWindow/toggleMaximize wrappers"
    - "src/types/provider.ts (48 lines) — ProviderId + ProviderKeyList + DeepScanResults DTOs"
    - "src/features/onboarding/providers.ts (94 lines) — PROVIDERS registry"
    - "src/features/onboarding/useOnboardingState.ts (158 lines) — 4-step state machine hook"
    - "src/features/onboarding/deepScanPhases.ts (70 lines) — DEEP_SCAN_PHASES + deepScanPercent + PHASE_LABEL"
  modified:
    - "src/lib/tauri/config.ts (+113 lines) — appended testProvider/getAllProviderKeys/storeProviderKey/switchProvider/setConfig wrappers"
    - "src/lib/tauri/index.ts (+8 lines) — barrel re-exports the 6 new wrappers"
    - "src/lib/events/payloads.ts (+16 lines, net) — DeepScanProgressPayload corrected from {step,total,label,percent} to {phase,found}"
    - "src/hooks/usePrefs.ts (+16 lines) — Prefs extended with palette.recent + onboarding.deep_scan_completed"

key-decisions:
  - "D-49 applied: DeepScanProgressPayload corrected to {phase: string, found: number} matching Rust emit (Rust authoritative per D-38-payload)"
  - "D-50 applied: ship testProvider/storeProviderKey/switchProvider/setConfig wrappers so Plan 02-04 can compose the 4-command persistence sequence without needing a new save_config_cmd"
  - "D-36 file partition respected: deep_scan.rs wrappers live in a dedicated deepscan.ts; window wrappers in window.ts — not tacked onto config.ts"
  - "D-38 arg-key discipline: every wrapper's invokeTyped object-literal passes snake_case keys verbatim (provider, api_key, model, base_url, token_efficient, user_name, work_mode, response_style, blade_email, god_mode, god_mode_tier, voice_mode, obsidian_vault_path, tts_voice, quick_ask_shortcut, voice_shortcut)"
  - "palette.recent stored as JSON-encoded string to avoid widening Prefs index signature (alternative rejected — would ripple through every Phase 1 consumer)"
  - "State machine ships state + setters only — no useTauriEvent subscription inside the hook; Plan 02-04 wires observePhase via useTauriEvent at the component layer to keep the hook testable without a live Tauri runtime"

patterns-established:
  - "Optional snake_case pass-through for multi-field Rust commands: TS wrapper takes a camelCase args object, invokeTyped's generic TArgs declares the snake_case shape, and the object literal is the single mapping point (applied to setConfig with 15 optional fields)"
  - "Phase enumeration lives next to the consumer hook in src/features/{domain}/{event}Phases.ts — not in src/lib/events — because the client-side percent derivation is a display concern, not a payload concern"
  - "ProviderId literal union is the single source of truth; both the Rust wrappers and the UI registry re-import from src/types/provider.ts"

requirements-completed: [ONBD-02, ONBD-03, ONBD-04, ONBD-05]

# Metrics
duration: ~25min
completed: 2026-04-18
---

# Phase 2 Plan 01: Tauri wrappers + onboarding state substrate Summary

**6 new Tauri wrappers (provider setup + deep scan) with snake_case discipline, corrected DeepScanProgressPayload to match Rust emit, PROVIDERS registry + useOnboardingState 4-step hook + DEEP_SCAN_PHASES enumeration — zero UI, pure wiring so Plan 02-04 consumes finished APIs**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-18T21:13:00Z (approx)
- **Completed:** 2026-04-18T21:24:00Z
- **Tasks:** 2
- **Files created:** 6
- **Files modified:** 4

## Accomplishments

- Extended `src/lib/tauri/config.ts` with 5 new wrappers composing the D-50 four-command onboarding persistence sequence (`test_provider` → `store_provider_key` → `switch_provider` → `set_config`) — each wrapper cites Rust file:line in JSDoc and passes snake_case keys verbatim per D-38.
- New `src/lib/tauri/deepscan.ts` — dedicated file for the three `deep_scan.rs` wrappers (ONBD-04) so `config.ts` doesn't balloon into a catch-all.
- New `src/lib/tauri/window.ts` — three window-control wrappers (minimise/close/toggleMaximize) giving TitleBar a single named surface for `@tauri-apps/api/window`.
- Fixed `DeepScanProgressPayload` in `src/lib/events/payloads.ts` to match the Rust emit at `deep_scan.rs:1325` (`{phase, found}`) — this is the D-49 correction Plan 01-06 was unable to make.
- Shipped `PROVIDERS` registry (6 providers, Anthropic default-selected) + `useOnboardingState()` 4-step state machine hook + `DEEP_SCAN_PHASES` enumeration with `deepScanPercent()` client-side percent helper + `PHASE_LABEL` UI-friendly map.
- Extended `Prefs` interface with `palette.recent` (JSON-encoded) and `onboarding.deep_scan_completed`, enabling Plan 02-05 CommandPalette recents + the Phase 3 Settings re-run-onboarding button.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wrappers + DeepScanProgressPayload fix + window control** — `aa490c8` (feat)
2. **Task 2: Onboarding state substrate (PROVIDERS + useOnboardingState + deepScanPhases + Prefs extension)** — `c99fa74` (feat)

_Plan metadata commit (SUMMARY.md + state updates) follows separately per execute-plan.md._

## Files Created

- `src/lib/tauri/deepscan.ts` — deepScanStart / deepScanResults / deepScanSummary wrappers; citation to `src-tauri/src/deep_scan.rs:1321/1425/1431`.
- `src/lib/tauri/window.ts` — minimizeWindow / closeWindow / toggleMaximize over `@tauri-apps/api/window.getCurrentWindow()`.
- `src/types/provider.ts` — `ProviderId` literal union (6 ids), `ProviderKeyList` (matches `get_all_provider_keys` return shape), `DeepScanResults` (opaque record pending a Phase 3 narrow).
- `src/features/onboarding/providers.ts` — `PROVIDERS` constant with Anthropic at index 0, `DEFAULT_PROVIDER` re-export, `ProviderDef` interface (id/name/defaultModel/tagline/keyUrl/needsKey/gradient).
- `src/features/onboarding/useOnboardingState.ts` — `useOnboardingState()` hook, `OnbStep` union, `OnbState` interface, atomic setters (`setStep`, `setProvider`, `setApiKey`, `beginTest`, `endTestOk`, `endTestErr`, `beginScan`, `observePhase`, `endScan`, `setAnswer`, `reset`).
- `src/features/onboarding/deepScanPhases.ts` — `DEEP_SCAN_PHASES` ordered tuple (11 phases), `DeepScanPhase` type, `deepScanPercent()` helper, `PHASE_LABEL` record.

## Files Modified

- `src/lib/tauri/config.ts` — appended `testProvider`, `getAllProviderKeys`, `storeProviderKey`, `switchProvider`, `setConfig`. Existing 4 wrappers untouched.
- `src/lib/tauri/index.ts` — barrel updated to re-export the 6 new wrappers alongside the existing 4.
- `src/lib/events/payloads.ts` — `DeepScanProgressPayload` replaced with `{phase: string; found: number}` + JSDoc documenting the D-49 correction.
- `src/hooks/usePrefs.ts` — `Prefs` interface extended with `palette.recent` (JSON-encoded string) + `onboarding.deep_scan_completed`; hook body unchanged.

## Decisions Made

- **Rust signature matches verified inline before writing wrappers.** Each of the 8 Rust entry points (`test_provider` at commands.rs:2025, `set_config` at commands.rs:1944, `store_provider_key` at config.rs:636, `switch_provider` at config.rs:645, `get_all_provider_keys` at config.rs:605, `deep_scan_start` at deep_scan.rs:1321, `deep_scan_results` at deep_scan.rs:1425, `deep_scan_summary` at deep_scan.rs:1431) was opened and the arg list cross-checked against the plan's `<interfaces>` block. Zero drift found — the plan's cited line numbers were accurate.
- **`setConfig` wrapper uses camelCase on the outside and snake_case on the inside.** The 15-field Rust signature has verbatim snake_case keys; forcing UI callers to write snake_case is awkward, so the wrapper accepts a camelCase args object and translates at the single object-literal mapping point. No runtime key transformation — the mapping is declared in the literal itself.
- **`useOnboardingState` hook is render-free and subscription-free.** It doesn't call `useTauriEvent` internally — Plan 02-04's component layer wires `observePhase` into a `useTauriEvent(BLADE_EVENTS.DEEP_SCAN_PROGRESS, ...)` handler. This keeps the hook trivially unit-testable without a Tauri runtime and matches the pattern Plan 02-04 needs (the hook owns state, the component owns side effects).
- **`palette.recent` stored as a JSON-encoded string, not as an array.** The existing `Prefs` index signature is `string | number | boolean | undefined`; widening to include `string[]` would ripple typechecks through every Phase 1 consumer. The 5-entry cap means the encoded string is ≤ ~80 bytes — negligible. CommandPalette (Plan 02-05) will JSON.parse/stringify around reads and writes.

## Deviations from Plan

None — plan executed exactly as written. All interfaces, task actions, and verification criteria matched the 02-01-PLAN.md specification. The one thing worth noting (not a deviation, just an observation): the pre-execution `git status` showed Plan 02-02's `src/lib/context/ToastContext.tsx`/`ToastViewport.tsx` and Plan 02-03's `src/design-system/shell/*` files had been committed concurrently by sibling agents (see commits `0ff3229` and `46c90f4` on the master branch); this changed the baseline between tasks 1 and 2 but did not affect any file in this plan's scope.

## Issues Encountered

None during planned work. Both tasks verified clean (`npx tsc --noEmit` exit 0, `npm run verify:all` all 5 gates green) on first pass.

## Verification

### Automated checks (plan `<verification>` block)

- **`npx tsc --noEmit`** — exit 0 after Task 1; exit 0 after Task 2; exit 0 at plan close.
- **`npm run verify:all`** — all 5 gates pass at plan close:
  - `verify:entries` — 5 entries present on disk.
  - `verify:no-raw-tauri` — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths (new wrappers correctly live under `src/lib/tauri/`).
  - `verify:migration-ledger` — 1 referenced id tracked (of 82 ledger rows).
  - `verify:emit-policy` — all 58 broadcast emits match the cross-window allowlist.
  - `verify:contrast` — all strict pairs ≥ 4.5:1.
- **D-38 grep** — `grep -n "test_provider|store_provider_key|switch_provider|set_config|deep_scan_start" src/lib/tauri/` returns matches with at least one `@see src-tauri/` citation per command.
- **DeepScanProgressPayload shape grep** — confirms `phase: string;` and `found: number;` (the old `{step, total, label, percent}` is gone).
- **PROVIDERS grep** — `grep -c "^  {" src/features/onboarding/providers.ts` returns `6`; first entry is `id: 'anthropic'`.

### Rust signature matches (cross-check before commit)

| TS wrapper | Rust command | File:line | Notes |
|------------|--------------|-----------|-------|
| `testProvider` | `test_provider` | `commands.rs:2025` | `(provider, api_key, model, base_url)` — matches |
| `getAllProviderKeys` | `get_all_provider_keys` | `config.rs:605` | no args — matches |
| `storeProviderKey` | `store_provider_key` | `config.rs:636` | `(provider, api_key)` — matches |
| `switchProvider` | `switch_provider` | `config.rs:645` | `(provider, model?)` — matches |
| `setConfig` | `set_config` | `commands.rs:1944` | 16 params (3 required + 13 optional) — matches verbatim |
| `deepScanStart` | `deep_scan_start` | `deep_scan.rs:1321` | `(app)` injected by Tauri, TS passes no args — matches |
| `deepScanResults` | `deep_scan_results` | `deep_scan.rs:1425` | no args — matches |
| `deepScanSummary` | `deep_scan_summary` | `deep_scan.rs:1431` | no args — matches |
| *(payload)* `DeepScanProgressPayload` | `deep_scan_progress` emit | `deep_scan.rs:1325` | `{phase: String, found: usize}` — corrected to `{phase: string; found: number}` (D-49) |

## User Setup Required

None — no external service configuration required. All changes are local wiring + types.

## Next Phase Readiness

Plan 02-04 (OnboardingFlow components) can now:

1. Import `PROVIDERS` and `DEFAULT_PROVIDER` from `@/features/onboarding/providers` for the picker grid.
2. Mount `useOnboardingState()` in the `OnboardingFlow` container and pass `state` + atomic setters to the 4 step components.
3. Call `testProvider → storeProviderKey → switchProvider → setConfig` from `@/lib/tauri` (or the barrel) in the API-key test handler per D-50.
4. Subscribe to `BLADE_EVENTS.DEEP_SCAN_PROGRESS` with `useTauriEvent<DeepScanProgressPayload>`, piping each payload into `observePhase(phase, found)`; render progress via `deepScanPercent(state.scanProgress)` and phase labels via `PHASE_LABEL[phase]`.
5. Call `completeOnboarding(state.personaAnswers)` at Step 4 "Enter BLADE" and flip `onboarding.deep_scan_completed` in prefs.

Plan 02-03 (TitleBar) can now import `minimizeWindow / closeWindow / toggleMaximize` from `@/lib/tauri/window` (already done in the concurrent commit `46c90f4`).

Plan 02-05 (CommandPalette) can read/write `palette.recent` via `usePrefs`.

No blockers. No scope concerns.

## Self-Check: PASSED

- `src/lib/tauri/deepscan.ts` — FOUND
- `src/lib/tauri/window.ts` — FOUND
- `src/types/provider.ts` — FOUND
- `src/features/onboarding/providers.ts` — FOUND
- `src/features/onboarding/useOnboardingState.ts` — FOUND
- `src/features/onboarding/deepScanPhases.ts` — FOUND
- `src/lib/tauri/config.ts` — MODIFIED (5 wrappers appended)
- `src/lib/tauri/index.ts` — MODIFIED (6 wrappers re-exported)
- `src/lib/events/payloads.ts` — MODIFIED (DeepScanProgressPayload corrected)
- `src/hooks/usePrefs.ts` — MODIFIED (Prefs extended)
- Commit `aa490c8` — FOUND (Task 1)
- Commit `c99fa74` — FOUND (Task 2)

---
*Phase: 02-onboarding-shell*
*Completed: 2026-04-18*
