---
phase: 02-onboarding-shell
plan: 04
subsystem: onboarding
tags: [onboarding, react, tauri-event, deep-scan, persona, provider-picker, ui]

# Dependency graph
requires:
  - phase: 02-onboarding-shell
    plan: 01
    provides: "PROVIDERS registry + useOnboardingState hook + DEEP_SCAN_PHASES + deepScanPercent + testProvider/storeProviderKey/switchProvider/setConfig/completeOnboarding wrappers + deepScanStart wrapper + corrected DeepScanProgressPayload"
  - phase: 02-onboarding-shell
    plan: 02
    provides: "ToastProvider + useToast + BackendToastBridge (SHELL-04)"
  - phase: 01-foundation
    provides: "9 primitives (Button/Input/GlassPanel/Dialog/GlassSpinner/...), invokeTyped + TauriError, useTauriEvent + BLADE_EVENTS, ConfigProvider + useConfig, RouteDefinition + ROUTE_MAP, design tokens"
provides:
  - "4-step onboarding wizard (OnboardingFlow) — provider picker → API key entry → deep scan → persona questions (D-47)"
  - "ProviderPicker step — 6-provider radiogroup with Anthropic default-selected, gradient-tinted logos, selected-state check badge"
  - "ApiKeyEntry step — masked Input with Show/Hide toggle; Test & continue runs D-50 composition (testProvider → storeProviderKey → switchProvider → advance) with toast + inline error surfacing"
  - "DeepScanStep — ref-guarded single-invocation of deep_scan_start; useTauriEvent subscription to DEEP_SCAN_PROGRESS feeds observePhase; SVG ring + 10-scanner label list; Continue CTA disabled until scanComplete"
  - "PersonaQuestions step — 5 Input fields, allFilled gate, Enter BLADE runs completeOnboarding → setConfig({apiKey:''}) → useConfig.reload → onComplete (ONBD-05, ONBD-06)"
  - "Steps — shared 4-pill progress row with active/done/idle states + a11y role=list"
  - "onboarding.css — step pills, brand mark, provider grid, progress ring, persona form (all tokenized except provider gradients from PROVIDERS data)"
  - "useResetOnboarding — forward-declaration hook (throws in Phase 2; Phase 3 Settings swaps body to call Rust reset_onboarding)"
  - "src/features/onboarding/index.tsx — onboarding route now renders OnboardingFlow (lazy) with window.location.reload fallback; re-exports OnboardingFlow + useResetOnboarding for Plan 06 MainShell gate"
affects:
  - "02-05 CommandPalette: unaffected (onboarding route still paletteHidden=true; palette filter unchanged)"
  - "02-06 MainShell gate: imports OnboardingFlow (non-lazy) + useResetOnboarding directly from @/features/onboarding; passes custom onComplete that flips the gate status back to 'checking'"
  - "02-07 Playwright onboarding-boot.spec.ts: has falsifiable UI to assert against (step pills + provider radiogroup + Test button + deep scan ring + persona inputs)"

# Tech tracking
tech-stack:
  added: []  # Pure React + Phase 1 primitives + Plan 02-01/02-02 artefacts — no new deps
  patterns:
    - "Ref-guarded single-invocation for effect-triggered Tauri commands — `startedRef` in DeepScanStep prevents StrictMode double-mount or re-render churn from firing deep_scan_start twice (T-02-04-07 mitigation)"
    - "D-50 composed persistence — test_provider → store_provider_key → switch_provider → advance; setConfig with empty apiKey runs at Step 4 close to flip config.onboarded=true without touching the keyring"
    - "Single useOnboardingState instance at container; each step component receives state + atomic setters via props (no prop-drilling past the step)"
    - "Lazy route + non-lazy re-export — feature index's routes array references a lazy LazyOnboardingFlow, but also re-exports the non-lazy OnboardingFlow symbol so the MainShell gate can mount it directly with a real onComplete callback"

key-files:
  created:
    - "src/features/onboarding/Steps.tsx (48 lines) — 4-pill progress row"
    - "src/features/onboarding/ProviderPicker.tsx (97 lines) — Step 1"
    - "src/features/onboarding/ApiKeyEntry.tsx (137 lines) — Step 2"
    - "src/features/onboarding/DeepScanStep.tsx (148 lines) — Step 3"
    - "src/features/onboarding/PersonaQuestions.tsx (106 lines) — Step 4"
    - "src/features/onboarding/OnboardingFlow.tsx (66 lines) — 4-step container"
    - "src/features/onboarding/useResetOnboarding.ts (26 lines) — Phase-3 forward-declaration"
    - "src/features/onboarding/onboarding.css (307 lines) — step pills + provider grid + ring + persona form"
  modified:
    - "src/features/onboarding/index.tsx — route now renders OnboardingFlow (lazy) instead of ComingSoonSkeleton; adds non-lazy OnboardingFlow + useResetOnboarding re-exports"

key-decisions:
  - "D-47 honored — 4 explicit steps (provider/apikey/scan/persona); no implicit 'next' helper because each step's advance condition differs"
  - "D-50 honored — test_provider → store_provider_key → switch_provider composition in ApiKeyEntry; setConfig({apiKey:''}) in PersonaQuestions flips config.onboarded side-effect without clobbering keyring"
  - "D-48 cooperation — OnboardingFlow accepts `onComplete` prop so Plan 06 MainShell gate can pass its own re-evaluation callback. The route-mounted fallback uses window.location.reload() which is an acceptable last-resort and runs only when Settings invokes openRoute('onboarding') in Phase 3 (paletteHidden keeps it off the palette)"
  - "T-02-04-07 mitigated — `startedRef` sentinel guarantees deep_scan_start fires exactly once even under React Strict Mode double-mount"
  - "`.at(-1)` replaced with `parts[parts.length - 1]` — tsconfig `lib` does not include the ES2022 Array.prototype.at surface; the plan snippet used `.at(-1)` which would have failed tsc. Picked the positional fallback over a tsconfig widen to keep the diff minimal"
  - "useResetOnboarding throws in Phase 2 rather than silently no-op — accidental wiring from Phase 3 Settings during a rebase would surface immediately instead of producing a confused user who thinks 'Reset onboarding' is broken"

patterns-established:
  - "Step components take {state, ...setters} props (no full hook object) so each component's prop shape advertises exactly the state/setter subset it touches — simpler test mocks than passing the entire hook result"
  - "`onComplete` callback prop for plan-boundary handoff — Phase 2 Plan 02-04 owns the flow, Plan 02-06 owns the gate; the prop is the seam"

requirements-completed: [ONBD-02, ONBD-03, ONBD-04, ONBD-05, ONBD-06]

# Metrics
duration: ~8min
completed: 2026-04-18
---

# Phase 2 Plan 04: OnboardingFlow 4-step wizard Summary

**4-step onboarding wizard with D-50 provider persistence composition — ProviderPicker + ApiKeyEntry + DeepScanStep + PersonaQuestions, all wired through useOnboardingState, consuming Plan 02-01 wrappers/hook and Plan 02-02 toast, replacing the ComingSoonSkeleton on `/onboarding`. ONBD-02..06 closed.**

## Performance

- **Duration:** ~8 min (code-heavy, but substrate from Plan 02-01 meant most work was visual + glue)
- **Started:** 2026-04-18T21:30:56Z
- **Completed:** 2026-04-18T21:35:58Z
- **Tasks:** 2
- **Files created:** 8
- **Files modified:** 1

## Accomplishments

- Shipped the Phase 2 flagship UI deliverable: a 4-step onboarding wizard that wires every Plan 02-01 wrapper + the Plan 02-02 toast surface.
- Step 1 (`ProviderPicker`): 6 provider cards in a 2-column radiogroup with Anthropic default-selected; gradient logos come from the PROVIDERS registry (no hardcoded provider hex in CSS); hover/select states match `docs/design/onboarding-01-provider.html`.
- Step 2 (`ApiKeyEntry`): masked `<Input type="password">` with Show/Hide toggle, placeholder derived from `provider.needsKey`, full D-50 composition on Test & continue (`test_provider` → `store_provider_key` → `switch_provider` → advance); success path lands a toast + inline `.onb-ok` row; failure path surfaces `TauriError.rustMessage` via both toast and `.onb-error` role="alert" row.
- Step 3 (`DeepScanStep`): ref-guarded `deepScanStart()` invocation inside `useEffect([], …)` (T-02-04-07); `useTauriEvent(DEEP_SCAN_PROGRESS)` drives `observePhase`; SVG ring uses `deepScanPercent(state.scanProgress)` for the visual; 10 scanner labels derive from `DEEP_SCAN_PHASES.filter(p => p !== 'starting' && p !== 'complete')`; Continue CTA disabled until `state.scanComplete`.
- Step 4 (`PersonaQuestions`): 5 `<Input>` rows backed by the `setAnswer(0|1|2|3|4, value)` typed setter; `allFilled` gate keeps Enter BLADE disabled until every answer trimmed non-empty; on submit → `completeOnboarding(state.personaAnswers)` → `setConfig({apiKey:''})` (D-50 side-effect flip of `onboarded=true`) → `useConfig().reload()` → `onComplete()` — exactly 4 awaited calls, well under the "≤10 lines of happy-path" success criterion.
- `Steps` — the shared 4-pill progress row is a 48-line standalone component used by every step so the visual contract lives in one place.
- `OnboardingFlow` — 66-line container mounts `useOnboardingState` once and renders whichever step matches `state.step`; imports `./onboarding.css` so the CSS loads regardless of which step renders first.
- `useResetOnboarding` — forward-declaration hook that throws in Phase 2 (no Rust `reset_onboarding` command yet). Phase 3 Settings swaps the body to call the Rust command once that ships. Throwing surfaces early wiring mistakes instantly in dev.
- `src/features/onboarding/index.tsx` — swapped `ComingSoonSkeleton` for a lazy-loaded `OnboardingFlow` wrapper with a `window.location.reload()` fallback `onComplete`. Also re-exports the non-lazy `OnboardingFlow` + `useResetOnboarding` symbols for Plan 06 MainShell gate consumption.
- All 5 `npm run verify:all` gates pass on first attempt; `npx tsc --noEmit` clean after the one `.at(-1)` fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Steps + ProviderPicker + ApiKeyEntry + onboarding.css** — `d9e8c76` (feat)
2. **Task 2: DeepScanStep + PersonaQuestions + OnboardingFlow + useResetOnboarding + index.tsx swap** — `c4b4e3d` (feat)

_Plan metadata commit (SUMMARY.md + state updates) follows separately per execute-plan.md._

## Files Created

- `src/features/onboarding/Steps.tsx` (48 lines) — `<Steps current={step} />` renders 4 pills; derives `idle | active | done` from position; `role=list` + `aria-current="step"`.
- `src/features/onboarding/ProviderPicker.tsx` (97 lines) — Step 1; `PROVIDERS` grid + brand mark + Continue CTA; ProviderCard is an inner component with `role=radio` + `aria-checked`; gradient via inline `style={{ background: ... }}`.
- `src/features/onboarding/ApiKeyEntry.tsx` (137 lines) — Step 2; D-50 composition + Show/Hide reveal toggle; success + error toasts via `useToast().show(...)`; `TauriError.rustMessage` extraction for readable inline error.
- `src/features/onboarding/DeepScanStep.tsx` (148 lines) — Step 3; ref-guarded effect; SVG ring with `strokeDasharray` + `strokeDashoffset` math derived from `deepScanPercent`; 10 scanner phase labels via `DEEP_SCAN_PHASES.filter(...)`.
- `src/features/onboarding/PersonaQuestions.tsx` (106 lines) — Step 4; 5-row grid, `setAnswer(i as 0|1|2|3|4, ...)` assertion to narrow the index type, `allFilled` gate, full completion chain.
- `src/features/onboarding/OnboardingFlow.tsx` (66 lines) — container; `useOnboardingState()` mount + switch-by-step render; imports `./onboarding.css` at the container boundary.
- `src/features/onboarding/useResetOnboarding.ts` (26 lines) — forward-declaration hook; body throws with a clear TODO message.
- `src/features/onboarding/onboarding.css` (307 lines) — step pill, brand, provider grid, API-key row, scan ring + phase list, persona form, `.onb-surface` wrapper.

## Files Modified

- `src/features/onboarding/index.tsx` — swapped ComingSoonSkeleton for a lazy `OnboardingFlow` wrapper that supplies `onComplete={() => window.location.reload()}` as the route-mount fallback. Added two re-exports: `OnboardingFlow` (non-lazy, for Plan 06 gate) and `useResetOnboarding` (for Phase 3 Settings). Route still `paletteHidden: true`, `phase: 2`, `section: 'core'`.

## Decisions Made

- **`.at(-1)` replaced with `parts[parts.length - 1]`** — the first `npx tsc --noEmit` ran after Task 1 surfaced `error TS2550: Property 'at' does not exist on type 'string[]'`. The tsconfig `lib` targets a pre-ES2022 surface for runtime compatibility. Rather than widen the tsconfig (a cross-cutting change) I took the positional fallback. Same behaviour, zero tsconfig churn. Committed as part of Task 1.
- **useResetOnboarding throws instead of no-op.** The plan drafted two options — throw or silently log a TODO. Chose throw because Phase 3 Settings will wire a Settings button to this hook; if someone accidentally pre-wires before the Rust command lands, a silent no-op would produce a confusing user-facing bug ("I clicked Reset Onboarding and nothing happened"). A thrown error is loud and immediate in dev.
- **Each step receives a narrowed prop shape instead of the full hook result.** `OnboardingFlow` destructures `hook.setStep`, `hook.setProvider`, etc., into each step's props. This makes each step's surface grep-able and keeps test fixtures tight — e.g. ProviderPicker tests only mock `{state, setProvider, setStep}` not the full 11-field hook result.
- **`onboarding.css` imported at OnboardingFlow.tsx top, not at index.tsx.** Reasoning: the CSS applies only when the flow renders. Importing in the lazy boundary means the CSS ships in the onboarding chunk, not in the main bundle. Phase 1 ships no global `@import './onboarding.css'` in `src/styles/index.css` so this is the correct pairing.
- **Provider gradient stays inline on the `<span>` element, not in CSS.** `PROVIDERS` is the single registry for provider identity (including color); adding a second mapping in CSS (e.g. `.p-logo.anthropic { background: ... }`) would double the edit cost when adding a provider. Inline `style={{ background: ... }}` reads the registry directly. Consistent with plan §11 guidance.
- **Did NOT touch 02-05's lane.** `src/design-system/shell/{CommandPalette,NavRail,index.ts}`, `src/hooks/{useRouter,useGlobalShortcuts}`, `src/styles/index.css` `@import` for `shell.css` — all untouched. Verified via `git status` that only my 8 new files + 1 modified `index.tsx` were staged per commit.

## Deviations from Plan

- **[Rule 1 - Bug] `.at(-1)` replaced with positional fallback.** The plan snippet used `p.defaultModel.split('/').at(-1)` in `ProviderPicker.tsx`. `npx tsc --noEmit` rejected this with TS2550 because the project's tsconfig `lib` does not include ES2022. Rewrote as `const parts = p.defaultModel.split('/'); const modelSuffix = parts[parts.length - 1] ?? p.defaultModel;`. Same behaviour, tsc-clean. No tsconfig widen — the fix is local. Found during Task 1 `npx tsc --noEmit` verification step. Committed as part of `d9e8c76`.

Otherwise the plan executed verbatim: all 9 artefacts match the plan's exports + prop shapes + behaviour; all 10 truth statements in `must_haves.truths` hold; every `key_link` is present in the code (grep confirmed `testProvider|storeProviderKey|switchProvider|setConfig` in `ApiKeyEntry`, `DEEP_SCAN_PROGRESS` + `useTauriEvent` in `DeepScanStep`, `completeOnboarding` + `setConfig` + `useConfig` in `PersonaQuestions`, `lazy.*OnboardingFlow` in `index.tsx`).

## Issues Encountered

- **Observed (not a deviation):** when I started this plan, the working tree contained untracked files from sibling agents working on 02-05 (`src/design-system/shell/CommandPalette.tsx`, `NavRail.tsx`, `navrail-icons.tsx`, `src/hooks/useGlobalShortcuts.ts`, `src/hooks/useRouter.ts`, modified `src/design-system/shell/index.ts`). These were left alone per the parallel-execution discipline — my per-commit `git add <specific files>` never touched them. `git status` after each commit confirms my staging was pristine.

## Verification

### Automated checks (plan `<verification>` block)

- **`npx tsc --noEmit`** — exit 0 after Task 1 (post `.at(-1)` fix); exit 0 after Task 2; exit 0 at plan close.
- **`npm run verify:all`** — all 5 gates green at plan close:
  - `verify:entries` — 5 entries present on disk.
  - `verify:no-raw-tauri` — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths.
  - `verify:migration-ledger` — 5 referenced ids tracked (of 82 rows).
  - `verify:emit-policy` — 58 broadcast emits match cross-window allowlist.
  - `verify:contrast` — all strict pairs ≥ 4.5:1 on dark wallpaper baseline.
- **Raw invoke/listen grep** — `grep -nE "from '@tauri-apps/api/(core|event)'" src/features/onboarding/` returns zero matches (confirmed via Grep tool).
- **Required-symbol grep** — the 9 symbols `testProvider|storeProviderKey|switchProvider|completeOnboarding|setConfig|deepScanStart|useTauriEvent|useToast|useConfig` are all used across 6 onboarding files (confirmed via Grep tool).

### Falsifiable SC-1 / SC-2 checks (Plan 02-07 Playwright will assert)

| Claim | Where proven |
|-------|--------------|
| `/onboarding` route → OnboardingFlow (not ComingSoonSkeleton) | `src/features/onboarding/index.tsx:20-32` (`LazyOnboardingFlow`) |
| Provider Picker shows 6 options, Anthropic default-selected | `ProviderPicker.tsx:15` (`PROVIDERS[0] = Anthropic`); `OnbState.providerId = DEFAULT_PROVIDER.id` |
| API Key Entry: test → store → switch → advance | `ApiKeyEntry.tsx:47-62` (4 awaited calls in sequence; `setStep('scan')` last) |
| Deep Scan: subscribes DEEP_SCAN_PROGRESS, derives percent client-side | `DeepScanStep.tsx:40-42` + `deepScanPercent(state.scanProgress)` |
| Persona: `Enter BLADE` disabled until all 5 inputs non-empty | `PersonaQuestions.tsx:39` (`allFilled`) + `:92` (`disabled={!allFilled \|\| submitting}`) |
| Completion chain | `PersonaQuestions.tsx:45-53` — `completeOnboarding → setConfig → reload → onComplete` |
| useResetOnboarding exported | `src/features/onboarding/index.tsx:42` (`export { useResetOnboarding }`) |

## User Setup Required

None. No external service configuration, no Rust additions. Phase 2 sidesteps the `save_config_cmd` Rust gap per D-50 by using only commands already registered in `generate_handler![]`.

## Next Phase Readiness

### What Plan 05/06 Consume

- **Plan 02-05 CommandPalette:** unaffected. `onboarding` route remains `paletteHidden: true`, so the same palette filter that hid the Phase 1 ComingSoonSkeleton continues to hide the swapped OnboardingFlow.
- **Plan 02-06 MainShell:** imports `OnboardingFlow` (non-lazy) + `useResetOnboarding` directly from `@/features/onboarding`. The gate code is:
  ```tsx
  const { status, reEvaluate } = useOnboardingGate();
  if (status === 'needs_onboarding') {
    return <OnboardingFlow onComplete={reEvaluate} />;
  }
  ```
  The non-lazy import is the critical path — the MainShell gate must NOT route through the lazy registry (that would re-introduce the Phase 1 ComingSoonSkeleton load delay).
- **Plan 02-07 Playwright `onboarding-boot.spec.ts`:** has a concrete DOM to assert against. Selector cheat-sheet for the spec author:
  - Step 1: `role=radiogroup[aria-label="AI providers"]`, `role=radio[aria-checked=true]` (Anthropic default)
  - Step 2: `id=onb-api-key`, `button:has-text("Test & continue")`
  - Step 3: `role=progressbar[aria-label^="Deep scan progress"]`
  - Step 4: `id=persona-0..4`, `button:has-text("Enter BLADE")`

### Requirements closed

| Id | Title | Where closed |
|----|-------|--------------|
| ONBD-02 | Provider Picker (A-01) | `ProviderPicker.tsx` (6-provider radiogroup, Anthropic default) |
| ONBD-03 | API Key Entry (A-02) + test_provider validation | `ApiKeyEntry.tsx` (D-50 composition) |
| ONBD-04 | Deep Scan Progress (A-03) with deep_scan_progress listener | `DeepScanStep.tsx` (useTauriEvent + ring + labels) |
| ONBD-05 | complete_onboarding with 5 persona answers | `PersonaQuestions.tsx` (allFilled gate + completeOnboarding call) |
| ONBD-06 | Redirect to default route after complete_onboarding | `PersonaQuestions.tsx` (onComplete()); gate wiring in Plan 06 |

No blockers. No scope concerns.

## Self-Check: PASSED

- `src/features/onboarding/Steps.tsx` — FOUND
- `src/features/onboarding/ProviderPicker.tsx` — FOUND
- `src/features/onboarding/ApiKeyEntry.tsx` — FOUND
- `src/features/onboarding/DeepScanStep.tsx` — FOUND
- `src/features/onboarding/PersonaQuestions.tsx` — FOUND
- `src/features/onboarding/OnboardingFlow.tsx` — FOUND
- `src/features/onboarding/useResetOnboarding.ts` — FOUND
- `src/features/onboarding/onboarding.css` — FOUND
- `src/features/onboarding/index.tsx` — MODIFIED (ComingSoonSkeleton → lazy OnboardingFlow + re-exports)
- Commit `d9e8c76` — FOUND (Task 1)
- Commit `c4b4e3d` — FOUND (Task 2)

---
*Phase: 02-onboarding-shell*
*Completed: 2026-04-18*
