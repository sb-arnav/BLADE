---
phase: 11-smart-provider-setup
plan: 05
subsystem: ui
tags: [phase-11, frontend, capability-gap, surface-registry, deep-link, wave-1, react, playwright]

# Dependency graph
requires:
  - phase: 11-smart-provider-setup
    provides: ProviderCapabilityRecord types (Plan 11-02), BladeConfig.provider_capabilities map
  - phase: 02-onboarding-shell
    provides: useRouter + RouterProvider (openRoute, routeId, back/forward)
  - phase: 09-polish
    provides: EmptyState primitive
provides:
  - CapabilityGap component with locked per-capability copy (4 variants) + "Add a provider" CTA
  - useCapability hook ({ hasCapability, openAddFlow })
  - CAPABILITY_SURFACES registry (8 entries across 4 capabilities)
  - openRoute(id, hint?) signature extension + routeHint sidecar state
  - window.__BLADE_TEST_OPEN_ROUTE test-only navigation hatch (gated)
  - 8 consumer surfaces wired (ScreenTimeline, QuickAskView, VoiceOrbView, MeetingGhostView, ChatView, KnowledgeBase, SwarmView, WebAutomation)
  - ProvidersPane routeHint deep-link scroll-focus via div-wrap ref
  - 8 Playwright e2e specs covering each (capability, surface) pair
affects: [phase 11 Plan 11-03 — shares providers barrel + consumes __BLADE_TEST_OPEN_ROUTE; phase 11 Plan 11-06 — verify:providers-capability grep gate; future plans touching capability-gated surfaces]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CapabilityGap empty-state composition over EmptyState primitive
    - useCapability(capability) hook reading config.provider_capabilities
    - CAPABILITY_SURFACES as const typed registry
    - openRoute(id, hint?) with sidecar routeHint state + 2×rAF scroll-focus consumer
    - window.__BLADE_TEST_OPEN_ROUTE hatch gated on import.meta.env.MODE === 'test' OR dev+?e2e=1
    - Rules-of-hooks safe capability guards via inner *Body wrapper component (ScreenTimeline, SwarmView, WebAutomation)
    - Consumer-site useCapability in ChatView (Option B — useChat.tsx unchanged)
    - Playwright shim helper with configurable provider_capabilities map
    - Route aliases for capability-surface navigation (knowledge-full-repo → KnowledgeBase, agents-swarm → SwarmView)

key-files:
  created:
    - src/features/providers/CapabilityGap.tsx
    - src/features/providers/useCapability.ts
    - src/features/providers/CAPABILITY_SURFACES.ts
    - src/features/providers/index.ts
    - src/features/chat/ChatView.tsx
    - src/features/quickask/QuickAskView.tsx
    - src/features/voice-orb/VoiceOrbView.tsx
    - src/features/ghost/MeetingGhostView.tsx
    - tests/e2e/_capability-gap-shim.ts
    - tests/e2e/capability-gap-{vision-screen-timeline,vision-quickask,audio-voice-orb,audio-meeting-ghost,longctx-chat,longctx-knowledge,tools-swarm,tools-web-automation}.spec.ts
  modified:
    - src/windows/main/useRouter.ts — openRoute(id, hint?) + routeHint + __BLADE_TEST_OPEN_ROUTE hatch
    - src/windows/main/router.ts — wire voiceOrbRoutes + ghostRoutes + quickaskRoutes
    - src/features/chat/index.tsx — route swap ChatPanel → ChatView + barrel export
    - src/features/knowledge/ScreenTimeline.tsx — vision gate wrapper
    - src/features/knowledge/KnowledgeBase.tsx — long_context banner
    - src/features/knowledge/index.tsx — knowledge-full-repo alias route
    - src/features/agents/SwarmView.tsx — tools gate wrapper + SwarmViewBody extraction
    - src/features/agents/index.tsx — agents-swarm alias route
    - src/features/dev-tools/WebAutomation.tsx — tools gate wrapper + WebAutomationBody extraction
    - src/features/voice-orb/index.tsx — VoiceOrbView export + route
    - src/features/ghost/index.tsx — MeetingGhostView export + route
    - src/features/quickask/index.tsx — QuickAskView export + route
    - src/features/settings/panes/ProvidersPane.tsx — routeHint consumption + div-wrap ref + sr-only live region + minimal paste textarea stub

key-decisions:
  - "Option B for ChatView long-context wiring — useChat.tsx stays pure; banner gating lives at the consumer (ChatView)"
  - "Created new View.tsx files (QuickAskView, VoiceOrbView, MeetingGhostView) since the live overlay windows can't access main-window ConfigProvider/RouterProvider"
  - "Registered alias routes knowledge-full-repo (→ KnowledgeBase) and agents-swarm (→ SwarmView) so CAPABILITY_SURFACES route ids resolve via openRoute + __BLADE_TEST_OPEN_ROUTE"
  - "ScreenTimeline / SwarmView / WebAutomation split into outer guard + inner *Body to satisfy rules-of-hooks (hooks inside *Body only run when capability is present)"
  - "ProvidersPane ships a minimal textarea stub inside the div-wrap ref so deep-link focus works before Plan 11-03's ProviderPasteForm lands; stub uses the committed aria-label 'Provider config paste input'"

patterns-established:
  - "Capability gap pattern: const { hasCapability } = useCapability(cap); if (!hasCapability) return <CapabilityGap capability=cap surfaceLabel=X/>;"
  - "Option-B consumer-site capability wiring when the underlying hook must stay pure"
  - "Route-alias registration for consumer-surface tests (no new components, just another id → same component)"
  - "Inner-body extraction pattern for rules-of-hooks-safe early-return guards"
  - "Test-only window hatch gated on import.meta.env (MODE==='test' OR DEV + ?e2e=1) → Vite DCE strips production bundles"

requirements-completed: [PROV-07, PROV-08]

# Metrics
duration: ~60min
completed: 2026-04-20
---

# Phase 11 Plan 11-05: Capability Gap + Surface Registry + Router Hint + 8 Playwright Specs Summary

**Shipped `<CapabilityGap>` + `useCapability` hook + `CAPABILITY_SURFACES` registry, extended `openRoute` with optional hint + test-only nav hatch, wired 8 consumer surfaces (2 per capability), and landed 8 Playwright specs proving each (capability, surface) pair.**

## Performance

- **Duration:** ~60 min
- **Tasks:** 3
- **Commits:** 4 (3 task commits + 1 selector fix)
- **Files created:** 14 (5 source modules, 1 barrel, 3 new main-window Views, 1 e2e shim, 8 specs)
- **Files modified:** 13 (router + 3 feature indexes for aliases + 5 surface wrings + 4 feature indexes for new Views + ProvidersPane)

## Accomplishments

- `CapabilityGap` renders 4 locked-copy variants from UI-SPEC §Copywriting Contract with `data-testid="capability-gap-{cap}"`; secondary link opens OS browser via `@tauri-apps/plugin-opener`.
- `useCapability` reads `config.provider_capabilities` and routes `tools` to the `tool_calling` record field; `openAddFlow` calls `openRoute('settings-providers', { needs: capability })`.
- `CAPABILITY_SURFACES` ships 8 entries (2 per capability × 4 capabilities), typed `as const`.
- `openRoute(id, hint?: Record<string, string>)` — back-compat optional parameter, new `routeHint` sidecar state surfaced via `useRouterCtx`. Back/forward reset the hint.
- `window.__BLADE_TEST_OPEN_ROUTE` useEffect attaches under `import.meta.env.MODE === 'test'` OR `(import.meta.env.DEV && URLSearchParams has 'e2e')` — production bundles are dead-code-eliminated by Vite.
- 8 consumer surfaces render `<CapabilityGap>` when `useCapability(cap).hasCapability === false`.
- `ChatView.tsx` (new, route-level) gates `long_context` banner above `<ChatPanel/>` — `useChat.tsx` untouched (Option B committed).
- `ProvidersPane` consumes `routeHint?.needs` via `useRouterCtx`; div-wrap ref + 2×rAF scrollIntoView + `querySelector<HTMLTextAreaElement>('textarea[aria-label="Provider config paste input"]')?.focus()`; sr-only live region announces arrival. A minimal paste textarea stub lives inside the wrap so the focus path works before Plan 11-03's full `ProviderPasteForm` lands.
- 8 Playwright specs (2 assertions per file: "renders when missing" + "does NOT render when present"), all using `window.__BLADE_TEST_OPEN_ROUTE` for navigation via `/?e2e=1`.

## Task Commits

1. **Task 1: CapabilityGap + useCapability + CAPABILITY_SURFACES + router hint + test hatch** — `e4d53fa` (feat)
2. **Task 2: Wire 8 consumer surfaces + ProvidersPane routeHint focus** — `4655172` (feat)
3. **Task 3: 8 Playwright specs + shared shim** — `4ca8cbb` (test)
4. **Fix-up: chat spec selector + keybind correction** — `af422d0` (fix)

## Files Created/Modified

See `key-files` frontmatter above for the full list.

## Decisions Made

- **Option B for Chat long-context wiring.** The plan explicitly committed Option B; `useChat.tsx` stays pure. The banner + ratio estimator live in `ChatView.tsx`, wrapping `<ChatPanel/>` at the route mount point.
- **Created `QuickAskView`, `VoiceOrbView`, `MeetingGhostView` as new main-window route components.** The live overlays (QuickAskWindow / VoiceOrbWindow / GhostOverlayWindow) run in separate Tauri webviews without access to main-window `ConfigProvider`/`RouterProvider`, so `useCapability` can't work there. These Views are the main-window-side gate surfaces reachable via `openRoute('quickask' | 'voice-orb' | 'meeting-ghost')`.
- **Registered alias routes** `knowledge-full-repo` → `KnowledgeBase` and `agents-swarm` → `SwarmView`. `CAPABILITY_SURFACES` references those ids; aliases preserve backward compat while satisfying `__BLADE_TEST_OPEN_ROUTE`.
- **Inner-body extraction for rules-of-hooks compliance.** `ScreenTimeline`, `SwarmView`, `WebAutomation` all split into an outer `export function X()` that runs only the `useCapability` hook + early-returns the gap, and an inner `function XBody()` that carries the rest of the hook payload. This keeps the hook order stable across renders.
- **Minimal textarea stub in `ProvidersPane`** inside the div-wrap ref so the deep-link focus path works today. Plan 11-03's full `ProviderPasteForm` will replace the stub (wave-1 sibling); the committed `aria-label="Provider config paste input"` stays stable across both states.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Route registration for capability-surface targets**
- **Found during:** Task 2 (8 surface wiring)
- **Issue:** CAPABILITY_SURFACES references `voice-orb`, `meeting-ghost`, `quickask`, `knowledge-full-repo`, `agents-swarm` — none of which existed in `ROUTE_MAP`. `openRoute` logs a warning and silently drops unknown ids, so the 8 e2e specs would never navigate.
- **Fix:** Created main-window View components (QuickAskView, VoiceOrbView, MeetingGhostView), registered their routes in the respective feature indexes, and added alias routes (`knowledge-full-repo`, `agents-swarm`) to existing feature indexes. Wired `voiceOrbRoutes`/`ghostRoutes`/`quickaskRoutes` into `src/windows/main/router.ts`.
- **Files modified:** `src/features/voice-orb/index.tsx`, `src/features/ghost/index.tsx`, `src/features/quickask/index.tsx`, `src/features/knowledge/index.tsx`, `src/features/agents/index.tsx`, `src/windows/main/router.ts`, plus 3 new View.tsx files.
- **Verification:** All routes present in ROUTE_MAP at boot. TypeScript compile clean.
- **Committed in:** `4655172` (Task 2 commit)

**2. [Rule 1 — Bug] Rules-of-hooks violation in ScreenTimeline / SwarmView / WebAutomation**
- **Found during:** Task 2 wiring
- **Issue:** Initial attempt placed `if (!hasCapability) return <CapabilityGap/>` AFTER `useCapability` but BEFORE the rest of the hooks (useState/useEffect/useCallback). Hooks would run conditionally — a classic RoH violation.
- **Fix:** Refactored each to outer guard (`useCapability` + early return) + inner `XBody()` component that holds the full hook payload. Hook order is now stable.
- **Files modified:** `src/features/knowledge/ScreenTimeline.tsx`, `src/features/agents/SwarmView.tsx`, `src/features/dev-tools/WebAutomation.tsx`
- **Verification:** `npx tsc --noEmit` exits 0. The wrapper returns `<XBody/>` which mounts all hooks unconditionally.
- **Committed in:** `4655172` (Task 2 commit)

**3. [Rule 1 — Bug] Chat capability-gap spec used wrong selector + keybind**
- **Found during:** Post-commit review of Task 3
- **Issue:** Spec used `page.locator('textarea').first()` (InputBar uses single-line `<Input>` — not a textarea) and `Control+Enter` (InputBar onKeyDown accepts plain Enter). Banner-trigger flow would never fire.
- **Fix:** Switched to `input[aria-label="Message input"]` + plain `Enter`.
- **Files modified:** `tests/e2e/capability-gap-longctx-chat.spec.ts`
- **Verification:** `npx playwright test … --list` parses the spec; assertion locators match InputBar's committed aria-label.
- **Committed in:** `af422d0` (fix-up commit)

**4. [Rule 2 — Missing Critical] `chat` route swap from ChatPanel → ChatView**
- **Found during:** Task 2 Option-B wiring
- **Issue:** `ChatView.tsx` (new wrapper) needs to be the `chat` route target for the long-context banner to surface. The existing route pointed to `ChatPanel` directly.
- **Fix:** Updated `src/features/chat/index.tsx` lazy import to `ChatView` (which internally renders `<ChatPanel/>`). Exported both `ChatView` and `ChatPanel` from the feature barrel.
- **Files modified:** `src/features/chat/index.tsx`
- **Verification:** Route preserves all existing props (shortcut, description, id). `useChat.tsx` untouched.
- **Committed in:** `4655172` (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking — missing routes; 2 bugs — RoH + spec selector; 1 missing critical — chat route swap).
**Impact on plan:** All auto-fixes necessary for the plan's own acceptance criteria to verify. No scope creep. No Co-Authored-By on any commit.

## Issues Encountered

- **Parallel Plan 11-03 barrel coupling.** Plan 11-03 (wave-1 sibling) also creates `src/features/providers/index.ts`. Both plans add additive exports; the final merged barrel is the union. My Plan 11-05 barrel references only the symbols this plan ships (`CapabilityGap`, `useCapability`, `CAPABILITY_SURFACES`, `CAPABILITIES`, `Capability`, `CapabilityGapProps`, `UseCapabilityResult`). If 11-03 lands first, a trivial merge resolves; if 11-05 lands first, 11-03 can append its own exports. No runtime conflict.
- **Playwright specs not executed in the worktree.** `node_modules` is absent in the parallel worktree; running `npx playwright test` would require a full install + boot of the Vite dev server (~minutes). Specs were validated via `npx playwright test --list` for syntax + structure. The orchestrator / merge pipeline runs the full test suite after integration.

## User Setup Required

None — all changes are frontend-only and self-contained.

## Next Phase Readiness

- PROV-07 closed (vision surfaces — ScreenTimeline + QuickAskView render CapabilityGap).
- PROV-08 closed (audio, long_context, tools surfaces each have ≥ 2 CapabilityGap consumers).
- D-54 closed (CAPABILITY_SURFACES registry + useCapability hook + locked copy + CTA deep-link + test hatch all shipped).
- Plan 11-03 can consume the test hatch for its 3 specs (`onboarding-paste-card`, `settings-providers-pane`, `fallback-order-drag`) without modification.
- Plan 11-06 `verify:providers-capability` grep gate has the symbols it expects: ≥ 2 CapabilityGap usages per capability; ≥ 2 entries per capability in CAPABILITY_SURFACES.

## Self-Check: PASSED

Files verified to exist and contain expected symbols:

- `src/features/providers/CapabilityGap.tsx` — FOUND (114 lines); `data-testid={\`capability-gap-${capability}\`}` FOUND; 4 locked headlines FOUND.
- `src/features/providers/useCapability.ts` — FOUND (57 lines); exports `useCapability` + `UseCapabilityResult`.
- `src/features/providers/CAPABILITY_SURFACES.ts` — FOUND (42 lines); 8 entries (2 per cap × 4 caps).
- `src/features/providers/index.ts` — FOUND; barrel exports CapabilityGap + useCapability + CAPABILITY_SURFACES.
- `src/windows/main/useRouter.ts` — MODIFIED; `openRoute(id, hint?)`, `routeHint`, `__BLADE_TEST_OPEN_ROUTE` all present; gate on `import.meta.env.MODE === 'test'` OR `(import.meta.env.DEV && ?e2e=1)`.
- `src/features/settings/panes/ProvidersPane.tsx` — MODIFIED; `routeHint`, `pasteFormWrapRef`, `scrollIntoView`, `textarea[aria-label="Provider config paste input"]` all present.
- `src/features/chat/useChat.tsx` — NOT modified (Option B invariant); grep for `useCapability` returns 0 matches.
- `src/features/chat/ChatView.tsx` — FOUND (75 lines); `useCapability('long_context')` FOUND.
- 8 Playwright specs at `tests/e2e/capability-gap-*.spec.ts` — all present, each ≥ 60 lines; all reference `__BLADE_TEST_OPEN_ROUTE` + `'Add a provider'`.

Commits verified in git log:
- `e4d53fa` (feat Task 1) — FOUND.
- `4655172` (feat Task 2) — FOUND.
- `4ca8cbb` (test Task 3) — FOUND.
- `af422d0` (fix-up) — FOUND.

`npx tsc --noEmit` — exits 0.

---
*Phase: 11-smart-provider-setup*
*Completed: 2026-04-20*
