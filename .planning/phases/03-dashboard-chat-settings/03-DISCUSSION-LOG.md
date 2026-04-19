# Phase 3 Discussion Log — Auto-Mode Defaults

**Mode:** `/gsd-plan-phase 3 --auto --chain` (no interactive operator questions)
**Date:** 2026-04-18
**Planner:** claude-opus-4-7 (1M context)

Arnav delegated to auto mode. The planner picked defensible defaults that match Phase 1+2 aesthetic (Liquid Glass dark, self-built, zero new deps). Every default below could plausibly have gone another way; the chosen path + its alternatives + the pick rationale are documented so Arnav can override at any point.

---

## D-64 — All WIRE emits close in one Rust plan (parallel-emit for rename)

**Default:** Plan 03-01 adds emits for WIRE-03/04/06 and a stub for WIRE-01; parallel-emits for WIRE-02 (adds `hormone_update` beside existing `homeostasis_update`); verifies WIRE-05 `blade_agent_event` already uses `emit_to("main", ...)`.

**Alternatives considered:**
- (a) Rename `homeostasis_update` → `hormone_update` destructively. Pro: cleaner. Con: existing legacy consumers (HUD bar in Phase 4) might still subscribe to the old name before the migration ships. Parallel-emit is zero-risk.
- (b) Defer WIRE-03/04/06 to individual Chat tasks each touching Rust. Con: Chat work becomes Rust-blocking repeatedly; Plan 03-01 consolidates the Rust surface so subsequent Plans are pure TS.
- (c) Create a dedicated `blade_events.rs` module for WIRE emits. Con: over-factoring; the emits live next to the function that produces them (commands.rs + providers/anthropic.rs).

**Pick:** all-in-one Rust plan with parallel-emit. Rationale: minimum-surprise rename + one cargo-check cycle.

---

## D-65 — Rust plan runs `cargo check` but operator re-verifies on libclang host

**Default:** Plan 03-01 `autonomous: true`; verify step runs `cargo check --manifest-path src-tauri/Cargo.toml` in the executor sandbox. If libclang absent (STATE.md Phase 1 blocker), the verify is informational; operator re-runs during the Plan 03-07 smoke checkpoint.

**Alternatives considered:**
- (a) Gate plan 03-01 behind a human checkpoint. Con: blocks the whole Phase on an infra issue the executor can't solve.
- (b) Skip cargo check. Con: ship-undetected Rust breakage. Unacceptable.

**Pick:** automated verify + operator backstop. Same pattern as Phase 1 WIRE-08.

---

## D-66 — No new config fields in Phase 3

**Default:** Settings panes write through existing commands (`set_config`, `save_config_field`, `set_task_routing`, `store_provider_key`). No additions to the 6-place rule surface.

**Alternatives considered:**
- (a) Add `ui_accent: Option<String>` / `ui_density: Option<String>` for Appearance. Con: D-15 locks dark-only; Appearance is a readout pane, not a control surface.
- (b) Add `last_route: Option<String>` to BladeConfig. Con: D-12 prefs blob already handles this; moving to Rust config adds round-trip cost.

**Pick:** zero new fields. Keep the Rust config surface frozen during skin work.

---

## D-67 — `useChat` is a React Context, not a standalone hook

**Default:** `ChatProvider` + `useChatCtx()` mounted inside the `chat` route. MessageList, InputBar, ToolApprovalDialog, CompactingIndicator all read via context.

**Alternatives considered:**
- (a) Standalone `useChat()` — each consumer calls the hook. Con: rAF streaming state must be singleton; duplicate instances fork state.
- (b) Zustand. Con: D-04 bans; one cross-route state carrier doesn't warrant a lib.

**Pick:** Context. Mounted only in chat route (not MainShell) so unmount-on-navigate is clean.

---

## D-68 — Streaming via rAF-flushed ref buffer (SC-2 falsifier)

**Default:** `streamBufferRef = useRef('')` receives synchronous chunk appends; a single `requestAnimationFrame` loop commits to state. Max 1 commit/frame ≈ 60/s ceiling.

**Alternatives considered:**
- (a) `setState` per token. Con: Profiler will crack at ≥20 tok/sec.
- (b) `useDeferredValue` / React Concurrent features. Con: concurrent mode has batched commit semantics but the event burst still fires N callbacks; ref buffer is simpler and directly satisfies SC-2.
- (c) Web Worker message marshalling. Con: massive over-engineering.

**Pick:** rAF ref. Tested by Playwright spec dispatching 50 synthetic events over 1000ms and asserting ≤60 commits.

---

## D-69 — No React.memo; rely on scope discipline

**Default:** `useChat` context is mounted INSIDE the chat route. MainShell never sees streaming state. No memoization layer required.

**Alternatives considered:**
- (a) `React.memo(MainShell)`. Con: implies MainShell would otherwise re-render; it wouldn't. Cosmetic.
- (b) `React.memo(ChatPanel)`. Con: ChatPanel re-render is the entire point — that's where the stream lives.

**Pick:** neither. Scope the state to the subtree that owns it.

---

## D-70 — Chat bubbles use rgba, never backdrop-filter

**Default:** `.chat-bubble` CSS uses `background: rgba(255,255,255,0.08)` (assistant) / `rgba(255,255,255,0.14)` (user). Zero `backdrop-filter` property in any chat stylesheet.

**Alternatives considered:**
- (a) `backdrop-filter: blur(8px)` per bubble. Con: D-07 blur cap 3 per viewport; N bubbles × blur = layout-thrash.
- (b) Single backdrop on ChatPanel container. Con: chat is a full-route view on glass-1 panel already; adding a second blur layer inside blows the cap.

**Pick:** rgba. Grep regression in CI.

---

## D-71 — Tool approval dialog uses 500ms countdown ring

**Default:** Approve + Deny buttons render a CSS ring animating 0→100 over 500ms; buttons `pointer-events: none` until animation completes.

**Alternatives considered:**
- (a) No delay. Con: RECOVERY_LOG + ROADMAP SC #2 both cite 500ms explicitly.
- (b) Modal "type YES to confirm". Con: theatrics; 500ms is the agreed floor.

**Pick:** 500ms ring.

---

## D-72 — Thinking section uses native `<details>`

**Default:** `<details><summary>Thinking</summary><div>{thinkingContent}</div></details>` with custom summary styling.

**Alternatives considered:**
- (a) Custom Disclosure component. Con: native `<details>` gives keyboard / aria for free.
- (b) Always expanded. Con: walls of thinking text dwarf the answer.

**Pick:** native details, closed by default after `chat_thinking_done`.

---

## D-73 — Compacting indicator uses CSS pulse + threshold > 0.65

**Default:** Pill with label `"Compacting… N%"` visible when `tokenRatio.ratio > 0.65`. CSS `@keyframes compactPulse 1.6s ease-in-out infinite`.

**Alternatives considered:**
- (a) Different threshold (0.7? 0.8?). Con: D-16 locked 0.65.
- (b) Toast on crossing threshold. Con: toast is transient; user needs a persistent badge while the risk is live.

**Pick:** persistent pill, locked threshold.

---

## D-74 — Right Now hero = perception_fusion consumer

**Default:** `perception_get_latest()` on mount → fallback `perception_update()` if null → 30s setInterval for refresh.

**Alternatives considered:**
- (a) Subscribe to a perception_update event (doesn't exist today). Con: requires Rust change; D-66.
- (b) Poll faster (5s). Con: backend already caches 30s; shorter interval wastes cycles.

**Pick:** 30s poll matches backend cadence.

---

## D-75 — Ambient strip = HORMONE_UPDATE subscriber (WIRE-02 live)

**Default:** Subscribe to `HORMONE_UPDATE` (the Phase 3 rename target) + call `homeostasis_get()` on mount for the first-paint population (backend only emits every 60s per homeostasis.rs:418).

**Alternatives considered:**
- (a) Subscribe to legacy `HOMEOSTASIS_UPDATE`. Con: Phase 3 rename lands; we want new consumers on the new name.
- (b) Poll `homeostasis_get` only. Con: misses the reactive push the event gives.

**Pick:** push + initial-pull.

---

## D-76 — Dashboard ships with 3 skeleton sub-cards for later-phase clusters

**Default:** Phase 3 Dashboard = RightNowHero + AmbientStrip + 3 stubs ("Hive signals (Phase 5)", "Calendar (Phase 6)", "Integrations (Phase 7)").

**Alternatives considered:**
- (a) Minimal dashboard (just hero + strip). Con: Phase 3 dashboard looks barren; operator smoke impression matters.
- (b) Render live Hive/Calendar/Integrations. Con: Phases 5–7 scope; we'd be faking content.

**Pick:** honest stubs with phase labels. Same discipline as Phase 1 ComingSoonSkeleton.

---

## D-77 — Dashboard first-paint perf gate via performance.mark

**Default:** `performance.mark('dashboard-paint')` in `RightNowHero`'s first effect; measure against the `boot` mark already set by main.tsx. DEV log + Playwright headless assertion < 400ms.

**Alternatives considered:**
- (a) About:tracing manual check. Con: not reproducible in CI.
- (b) React Profiler commit timing. Con: measures React work, not paint.

**Pick:** performance.mark (same as Phase 1 P-01 gate).

---

## D-78 — Chat as its own full-route view (not side panel yet)

**Default:** `routeId === 'chat'` renders standalone ChatPanel. Dashboard panel overlay is Phase 9 polish.

**Alternatives considered:**
- (a) Build side-panel layout now. Con: doubles ChatPanel layout code; Phase 3 SCs don't require it.
- (b) Overlay dashboard with chat as a drawer. Con: same — Phase 9.

**Pick:** full-route Chat; Phase 9 refactors to overlay.

---

## D-79 — Settings tabs: rename 2, add 5 to match ROADMAP SET-01..10

**Default:** Keep 10 child route ids; relabel `settings-integrations` → IoT; `settings-ambient` → Personality; ADD `settings-models`, `settings-routing`, `settings-appearance`, `settings-privacy`, `settings-diagnostics`. Final 10-tab order: Providers, Models, Routing, Voice, Personality, Appearance, IoT, Privacy, Diagnostics, About.

**Alternatives considered:**
- (a) Keep existing 10 with current names. Con: doesn't match ROADMAP SET-* labels; SC-4 falsifiable test can't find "Models" tab.
- (b) Nuke and rebuild the route list. Con: loses the 2 already-correct (Providers, About); churn.

**Pick:** surgical rename + add. Migration-ledger still honest — mark renames as cross-references.

---

## D-80 — Settings saves via existing commands only

**Default:** `set_config`, `store_provider_key`, `set_task_routing`, `save_config_field` are the four write paths. No new Rust.

**Alternatives considered:**
- (a) Add `save_config_cmd`. Con: STATE.md blocker; scope.
- (b) Add bulk-update command. Con: YAGNI.

**Pick:** existing 4.

---

## D-81 — Providers pane reuses PROVIDERS registry from onboarding

**Default:** `src/features/onboarding/providers.ts:PROVIDERS` imported directly by `ProvidersPane.tsx`.

**Alternatives considered:**
- (a) Duplicate the registry in settings. Con: drift risk; the provider list IS a single source.
- (b) Move the registry to a shared `src/config/providers.ts`. Pro: cleaner. Con: adds a refactor churning Phase 2 code; defer to Phase 9.

**Pick:** reuse. Phase 9 can move.

---

## D-82–D-90 — Settings pane choices (consolidated)

Individual panes picked minimal behaviour:
- Models (D-82): hardcoded per-provider list; `switchProvider` saves
- Routing (D-83): 5-row grid; new `getTaskRouting` / `setTaskRouting` wrappers in Plan 03-02
- Voice (D-84): wire existing fields via `save_config_field`
- Personality (D-85): re-run onboarding via `reset_onboarding` + reEvaluate gate
- Appearance (D-86): readout-only + prefs reset
- IoT (D-87): new `iot.ts` wrapper module; 3 commands
- Privacy (D-88): read-only + conversation history clear
- Diagnostics (D-89): entry doorway, not full view
- About (D-90): static content

Alternatives across all panes: "build the full thing" — rejected as scope creep into Phase 7 Admin. Phase 3 Settings is the minimum viable SET-01..10 tabs.

---

## D-91 — 4 new Playwright specs (chat stream, tool approval, dashboard paint, settings provider)

**Default:** Extend Phase 1+2 harness with 4 focused specs; no new test deps.

**Alternatives considered:**
- (a) One giant e2e spec. Con: harder to locate failures.
- (b) Unit tests via Vitest. Con: new dep; behavioural-surface tests are the priority.

**Pick:** 4 specs, each mapping to a Phase 3 SC.

---

## D-92 — Non-autonomous operator smoke at end of phase

**Default:** Plan 03-07 Task 3 is a `checkpoint:human-verify` task waiting for operator to run `npm run tauri dev` and walk through the 3 core surfaces.

**Alternatives considered:**
- (a) Fully automate via headless Tauri. Con: visual + ambient strip perception aren't headless-testable without a real screen; the point of the check is end-to-end reality.
- (b) Skip operator smoke. Con: breaks the Phase 1+2 cadence.

**Pick:** checkpoint task. Matches Phase 1 WCAG + Phase 2 onboarding smoke pattern.

---

## Escalation triggers (when auto-mode should have paused)

None reached. Every decision had a clearly defensible default consistent with D-01..D-63. If Arnav disagrees with any, override in `/gsd-execute-phase 3` with a `context-reset` note.

---

*Log finalized: 2026-04-18 during /gsd-plan-phase 3 --auto --chain*
