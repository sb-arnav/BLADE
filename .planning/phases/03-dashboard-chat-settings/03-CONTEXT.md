# Phase 3: Dashboard + Chat + Settings — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 03-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 3 --auto --chain` (planner-picked defaults)

<domain>
## Phase Boundary

Phase 3 lights up the three highest-traffic surfaces — Dashboard, Chat, Settings — and closes the six Rust WIRE gaps they depend on. Phase 3 consumes the Phase 1 + 2 substrate verbatim (wrappers, events hook, router context, primitives, shell) and produces the first real content for the main route tree. It does NOT touch overlay windows (Phase 4) or any cluster beyond core.

**In scope:** 34 requirements.
- DASH-01..08 (Dashboard — live Right Now hero, ambient strip, perception_fusion consumer, homeostasis reflection, 200ms first paint)
- CHAT-01..10 (Chat — streaming, tool approval, reasoning thinking, compacting indicator, no-App re-render discipline)
- SET-01..10 (Settings — 10 tabs: Providers, Models, Routing, Voice, Personality, Appearance, IoT, Privacy, Diagnostics entry, About)
- WIRE-01..06 (6 backend wiring gaps — 3 new Rust event emits, 1 Rust command stub, 1 event rename, 1 cross-verify)

**Out of scope for Phase 3:**
- Overlay windows: QuickAsk body, Voice Orb, Ghost, HUD (Phase 4)
- AgentDetail timeline (Phase 5; WIRE-05 Rust emit in Phase 3 only)
- Body / Hive / Knowledge / Identity views (Phases 5–8)
- The dashboard Hive signals + Calendar rings — kept as ComingSoonSkeleton sub-cards with a dev label; real wiring is Phase 5/6 scope
- 5-wallpaper WCAG backstop (operator Phase 1 checkpoint)
- Phase 9 motion + a11y polish pass

**Key Phase 1+2 substrate Phase 3 leans on (no drift permitted):**
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/config.ts` — `getConfig`, `testProvider`, `storeProviderKey`, `switchProvider`, `setConfig`, `getAllProviderKeys`
- `src/lib/tauri/chat.ts` — `sendMessageStream`, `cancelChat` (already live)
- `src/lib/events/index.ts` — `BLADE_EVENTS`, `useTauriEvent` (D-13 only permitted listen surface)
- `src/lib/events/payloads.ts` — `BladeMessageStartPayload`, `BladeThinkingChunkPayload`, `BladeTokenRatioPayload`, `HormoneUpdatePayload`, `ToolApprovalNeededPayload`, `ChatTokenPayload`, `ChatRoutingPayload`, `BladePlanningPayload` (all forward-declared in Phase 1)
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` blob with dotted keys
- `src/lib/context/ConfigContext.tsx` — `useConfig()` + `reload()` (fail-closed on getConfig error)
- `src/lib/context/ToastContext.tsx` — `useToast().show(...)`
- `src/windows/main/MainShell.tsx` — gate-on-onboarding + suspense route slot
- `src/windows/main/useRouter.ts` — `RouterProvider`, `useRouterCtx`, `openRoute`
- `src/design-system/primitives/*` — 9 primitives + `primitives.css`
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css`

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering from STATE.md (D-01..D-63 locked through Phase 2). Phase 3 adds D-64..D-92.

### Rust WIRE closure (Plan 03-01 — earliest wave)

- **D-64:** The 6 WIRE requirements are closed by **adding new emit sites inside existing `#[tauri::command]` functions** rather than introducing new commands (except for WIRE-01 quickask_submit which is itself a new command stub). Specifically:
  - **WIRE-02:** `homeostasis.rs:424` already emits `homeostasis_update`. Phase 1's D-19 deferred the rename to `hormone_update`. Plan 03-01 adds a **parallel emit**: the existing `homeostasis_update` stays (don't break WIRE-02 legacy listeners in HUD + body dashboards) AND a new `hormone_update` emit fires the same payload. `BLADE_EVENTS.HORMONE_UPDATE` (already declared in Phase 1) is the Phase 3 Dashboard's canonical subscriber. `HOMEOSTASIS_UPDATE` stays declared and marked `@deprecated // use HORMONE_UPDATE` in payloads.ts.
    - Rationale: parallel-emit for one release cycle is the minimum-surprise path; Phase 4+ can drop the legacy emit once HUD migrates.
  - **WIRE-03:** Add `emit_to("main", "blade_message_start", {message_id, role: "assistant"})` inside `send_message_stream` (`commands.rs`) at the **first** point a new assistant turn is produced — immediately before the first `chat_token` / `chat_thinking` emit for that turn. Reuses the existing `id` produced around line 1249 (after `conversation.push(ConversationMessage::Assistant {...})`). Generate a ULID via `uuid::Uuid::new_v4().to_string()` and stash it in a local variable so subsequent thinking/token chunks tag the same id.
  - **WIRE-04:** Add `emit_to("main", "blade_thinking_chunk", {chunk, message_id})` inside the providers/anthropic.rs thinking emit site (currently `chat_thinking` at line 344). Parallel-emit: keep `chat_thinking` for compat, ADD `blade_thinking_chunk` with the new shape (chunk string + message_id tag). Other providers (openai/gemini/groq/ollama) don't emit thinking chunks yet — forward compat only.
  - **WIRE-05:** `agents/executor.rs` already emits `blade_agent_event` at lines 240, 265, 313, 335, 349. Plan 03-01 **verifies** each emit uses `emit_to("main", ...)` (per D-14; Phase 1 WIRE-08 should have converted these). No new emits; only a verification task. No UI consumer in this phase (Phase 5 scope).
  - **WIRE-06:** Add `emit_to("main", "blade_token_ratio", {ratio, tokens_used, context_window})` at the top of `send_message_stream` AFTER the rough token estimate block (commands.rs ~line 618-637). Compute ratio = rough_tokens / context_window; context_window pulled from `crate::router::context_window_for(&config.provider, &config.model)` (helper may not exist — if so, inline a match at the call site for the 4 known providers: anthropic=200k, openai=128k, gemini=1M, groq=131k, ollama=8k default).
  - **WIRE-01:** Add new `pub async fn quickask_submit(app, query: String, mode: String, source_window: String) -> Result<(), String>` in `commands.rs`. Stub body: log the call + emit `emit_to("main", "blade_quickask_bridged", {...})` with a synthetic `{query, response: "", conversation_id: generated, mode, timestamp}` payload. Full implementation (provider call + history persistence) is Phase 4. Register in `lib.rs` `generate_handler![]` macro. Also register `blade_quickask_bridged` is a frontend subscriber only — no Rust state.
  - Rationale: all 6 WIRE gaps close in one Rust plan (03-01) so all subsequent TS waves have a stable emit surface. Per CLAUDE.md "6-place rule" and "module registration 3-step rule" — any new `#[tauri::command]` is added to `lib.rs` handler; no `mod` changes needed because we edit existing modules (commands.rs, homeostasis.rs, providers/anthropic.rs, agents/executor.rs).

- **D-65:** Plan 03-01 is **`autonomous: true`** but flags `requires_cargo_check: true` in its frontmatter `user_setup` note. The Phase 1 blocker — libclang missing in the planning sandbox — still applies. Executor runs `cargo check --manifest-path src-tauri/Cargo.toml` as the automated verify; if libclang is absent the operator re-runs on a libclang-enabled host during smoke. The Rust code is semantically correct and deterministic; sandbox limitation is infrastructure, not risk.

- **D-66:** **No 6-place-rule config field additions in Phase 3.** Every Settings save goes through existing commands (`set_config`, `save_config_field`, `set_task_routing`, `store_provider_key`). The proposed `palette.recent`-style blade_prefs_v1 keys that Settings needs (accent? default view pref?) are pure frontend per D-12. Rationale: avoid Rust surface expansion when the frontend already has a prefs blob; mirrors D-50's composition-over-new-command discipline.

### Chat substrate (Plans 03-03, 03-04)

- **D-67:** `useChat()` hook is the **only** cross-route chat state carrier (D-04 retained). Lives at `src/features/chat/useChat.ts`. Shape:
  ```ts
  interface ChatState {
    messages: ChatMessage[];                  // persisted via history commands
    currentStreamId: string | null;           // from blade_message_start
    streamingContent: string;                 // concatenated chat_token chunks
    thinkingContent: string;                  // concatenated blade_thinking_chunk chunks
    status: 'idle' | 'streaming' | 'thinking' | 'awaiting_tool' | 'error';
    toolApprovalRequest: ToolApprovalNeededPayload | null;
    tokenRatio: { ratio: number; used: number; window: number } | null;
  }
  ```
  - Messages flushed to state only on `chat_done` (no per-token setState — see D-68).
  - Rationale: SC-2 requires React Profiler ≤16ms at 50 tok/sec. `setState` on every token at 50/sec = ≥50 renders/sec = will breach. Stream buffer lives in a **ref**, committed in batched animation frames.

- **D-68:** **Streaming buffer discipline — ref-driven, rAF-flushed** (SC-2 falsifiability).
  - A `streamBufferRef = useRef('')` accumulates `chat_token` chunks synchronously inside the event handler.
  - A `useEffect` / internal `flushOnFrame` closure uses `requestAnimationFrame` to copy the buffer into `streamingContent` state, then clear the ref. rAF effectively caps commit rate at display refresh (~60Hz = 16.67ms budget — the exact SC-2 target).
  - Same pattern for `thinkingContent` (separate ref, separate flush frame).
  - On `chat_done`: flush remaining buffer synchronously, append as a committed Message, clear refs.
  - Rationale: guarantees ≤1 React commit per frame regardless of emit cadence. Subscribers outside `useChat` (MessageList, CompactingIndicator) read the committed state; none listen to raw events.
  - Profiler assertion: Playwright spec mounts Chat, dispatches 50 synthetic `chat_token` events in 1000ms, asserts commit count ≤60. (Implemented in Plan 03-07.)

- **D-69:** **No `React.memo` on `ChatPanel` — App level never re-renders on stream** (SC-2 positive falsifier).
  - MainShell mounts `ChatPanel` as a Suspense child. Chat state lives entirely inside `useChat` + its descendants. MainShell references Chat only through `useRouterCtx().routeId === 'chat'`; route id doesn't change during streaming. So MainShell never receives a re-render trigger from chat at all.
  - Dev-only assertion: add a `console.count('[render] MainShell')` in DEV; manual smoke test observes the count is static during streaming. Playwright spec 03-07 uses a React Profiler onRender hook (dev-only wrapper around MainShell) and asserts MainShell commit count ≤2 during 1000-token stream.

- **D-70:** **Message bubbles use `rgba(...)` fills, NEVER `backdrop-filter`** (SC-5 guardrail).
  - Rationale: the backdrop-filter budget is 3 layers per viewport per D-07. Dashboard (Right Now hero + Ambient strip + NavRail) already uses 3. Adding `backdrop-filter` to each chat bubble during streaming blows past the cap and collapses first paint.
  - Implementation: `src/features/chat/chat.css` defines `.chat-bubble { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); }` for assistant, `rgba(255,255,255,0.14)` for user. No `backdrop-filter` property in that file. An ESLint-grep regression script (plan 03-07) verifies `grep -n "backdrop-filter" src/features/chat/*.css` returns empty.

- **D-71:** **Tool approval dialog: Dialog primitive + 500ms delay** (CHAT-07 / SC-2 tool-call surface).
  - Listens on `BLADE_EVENTS.TOOL_APPROVAL_NEEDED`; stores payload in `useChat.toolApprovalRequest`. Opens the Dialog primitive.
  - **Approve + Deny buttons are visually rendered disabled with a 500ms ms countdown ring** (CSS `@keyframes countdownFill` from 0→100 over 500ms). Buttons become interactive only after the delay. This is a **user protection** — prevents accidental click-through when the dialog pops during typing.
  - On Approve → `invokeTyped('respond_tool_approval', { approval_id, approved: true })` — the wrapper lives in `src/lib/tauri/chat.ts` as `respondToolApproval()` (new in Plan 03-02).
  - On Deny → same with `approved: false`.
  - The 500ms number comes from RECOVERY_LOG §1.4 / ROADMAP SC #2 language ("500ms button delay").
  - Rationale: D-58 reuses the `<Dialog>` primitive (ESC + focus trap native). No new focus lib.

- **D-72:** **Reasoning / thinking section = collapsible details** (CHAT-08).
  - Each assistant message that accumulated any `blade_thinking_chunk` content (by message_id tagging) renders a `<details><summary>Thinking</summary><div>{thinkingContent}</div></details>` above the answer.
  - Default **closed** for messages that completed; open only while streaming if user hasn't collapsed it.
  - Thinking text uses `.chat-thinking` class: `color: var(--t-3); font-size: 13px; white-space: pre-wrap;` — monochrome grey block, no bubble.
  - Rationale: native `<details>` gives keyboard accessibility for free.

- **D-73:** **Compacting indicator = pill rendered at top-right of ChatPanel when `tokenRatio.ratio > 0.65`** (CHAT-09).
  - Label: `"Compacting… N%"` where N = `Math.round(ratio * 100)`.
  - Pill animates a subtle pulse (CSS `@keyframes compactPulse` 1.6s ease-in-out infinite).
  - Hides when ratio ≤ 0.65 OR status=idle.
  - Rationale: D-16 locked the 0.65 threshold; the frontend surfaces it. No config — it's a wired indicator.

### Dashboard substrate (Plan 03-05)

- **D-74:** **Right Now Hero data source = `perception_get_latest` + `perception_update`** (DASH-01, DASH-03).
  - Component `RightNowHero` at `src/features/dashboard/RightNowHero.tsx`.
  - On mount: `perceptionGetLatest()` → render whatever's cached. If null, call `perceptionUpdate()` (the blocking variant) to force a fresh snapshot.
  - Auto-refresh every 30s via a single `setInterval` (`perceptionUpdate()` is backend-cached for 30s by `start_perception_loop` so the IPC call is cheap).
  - Surfaces: active app + window title, current user_state ("focused" / "idle" / "away"), top CPU process, disk + RAM pressure as subtle chips, up to 5 visible error lines as a collapsed list.
  - No `backdrop-filter` here (shared with Ambient strip budget).
  - Rationale: perception_fusion is already the single source of truth; D-74 just wires it. PerceptionState fields are exact Rust struct copy.

- **D-75:** **Ambient strip = `HORMONE_UPDATE` subscriber** (DASH-02, WIRE-02).
  - Component `AmbientStrip` at `src/features/dashboard/AmbientStrip.tsx`.
  - Mounts `useTauriEvent<HormoneUpdatePayload>(BLADE_EVENTS.HORMONE_UPDATE, ...)` — on first mount ALSO calls `homeostasisGet()` to populate immediately (event only fires on 60s tick per homeostasis.rs:418).
  - Renders 5 dominant hormones as small colored chips: arousal, energy_mode, exploration, urgency, trust. Each chip shows value (0–1 clamped to 0.00..1.00) and a color band keyed off the hormone category (e.g. adrenaline → red, exploration → green, trust → blue).
  - Dominant hormone computed client-side (`Math.max(...values)`) shown as a larger lead chip.
  - Legacy `HOMEOSTASIS_UPDATE` subscribers not mounted here (migrated to HORMONE_UPDATE under D-64).
  - Rationale: a HUD bar in Phase 4 will reuse this identical subscription; extracting the hormone-chip renderer into `src/features/dashboard/hormoneChip.tsx` lets Phase 4 reuse it verbatim.

- **D-76:** **Dashboard composition** (DASH-04..08).
  - `src/features/dashboard/Dashboard.tsx` = `GlassPanel tier=1` containing:
    1. `RightNowHero` (DASH-01)
    2. `AmbientStrip` (DASH-02)
    3. Three `ComingSoonSkeleton`-style sub-cards with inline labels: "Hive signals (Phase 5)", "Calendar (Phase 6)", "Integrations (Phase 7)"
  - 12-column CSS grid layout; RightNowHero spans 8, hero actions span 4 (first row); AmbientStrip 12 (second row); 3 sub-cards 4 each (third row).
  - `Dashboard.css` uses `grid-template-columns` tokens from `layout.css`; no hardcoded px widths.
  - Rationale: keeps Phase 3 Dashboard visually complete without false promises for later-phase clusters; stubs are honest placeholders.

- **D-77:** **First-paint perf gate** (DASH-07 / SC-5).
  - `performance.mark('dashboard-paint')` in `RightNowHero`'s first `useEffect` (post-commit).
  - Compare to `performance.mark('boot')` already marked in `src/windows/main/main.tsx`.
  - DEV console log: `[perf] dashboard-first-paint: Xms (budget 200ms)`.
  - Playwright spec (Plan 03-07) asserts the measurement < 400ms headless (budget 200ms on metal; headless has 2× overhead per research).

- **D-78:** **Chat panel is a side-drawer that renders over dashboard — no layout shift.**
  - When `routeId === 'chat'`, MainShell's `<RouteSlot>` renders `ChatPanel` in a **flex row next to** the existing dashboard snapshot (kept mounted in a frozen state for perf) OR a standalone Chat route depending on prefs.
  - Phase 3 default: `chat` is its own full-route view (own RouteDefinition id 'chat'). The "chat panel overlaying dashboard" pattern is **deferred to Phase 9 polish** — building the split layout now bloats Plan 03-03 and doesn't close a Phase 3 SC.
  - Rationale: SC-5 says "first paint ≤200ms with chat panel open" — interpreted as when user is on chat route, dashboard paint perf must still pass. Satisfied by D-70 rgba bubble discipline.

### Settings substrate (Plan 03-06)

- **D-79:** **Settings is a tabbed shell at the `settings` route with 10 child routes**.
  - `src/features/settings/SettingsShell.tsx` — vertical tab list on the left, tab body on the right.
  - The 10 existing child RouteDefinitions (`settings-providers`, `settings-integrations`, `settings-voice`, `settings-ghost`, `settings-ambient`, `settings-autonomy`, `settings-shortcuts`, `settings-advanced`, `settings-about`) — Phase 3 KEEPS the 10 child route ids but **renames/relabels two** to match ROADMAP scope:
    - `settings-integrations` → `settings-iot` label "IoT & Integrations" (per SET-07 "IoT")
    - `settings-ambient` → `settings-personality` label "Personality" (per SET-05 "Personality")
  - Adds 2 new child routes to hit all 10 ROADMAP tabs:
    - `settings-models` (SET-02 "Models") at `src/features/settings/panes/ModelsPane.tsx`
    - `settings-routing` (SET-03 "Routing") at `src/features/settings/panes/RoutingPane.tsx`
    - `settings-appearance` (SET-06 "Appearance") at `src/features/settings/panes/AppearancePane.tsx`
    - `settings-privacy` (SET-08 "Privacy") at `src/features/settings/panes/PrivacyPane.tsx`
    - `settings-diagnostics` (SET-09 "Diagnostics entry") at `src/features/settings/panes/DiagnosticsEntryPane.tsx`
  - Final 10 tabs in order: Providers, Models, Routing, Voice, Personality, Appearance, IoT, Privacy, Diagnostics, About.
  - `settings-shortcuts` and `settings-advanced` and `settings-ghost` stay as keyboard-hidden auxiliary routes — still reachable via ⌘K palette, not rendered as top-level tabs. They remain `phase: 3` to keep the migration ledger honest.
  - Rationale: matches ROADMAP SET-01..10 exactly. The 2 renames + 3 adds is a tighter alignment than leaving Phase 1's guesses intact.

- **D-80:** **Settings uses the existing `set_config`/`store_provider_key`/`set_task_routing`/`save_config_field` commands** (D-50 retained; D-66). Each pane imports the relevant typed wrapper. No new backend surface.

- **D-81:** **Providers pane** — reuses `PROVIDERS` registry from `src/features/onboarding/providers.ts` verbatim. Renders 6 provider cards + a "Test connection" button per card (wired to `testProvider`) + masked keys list (wired to `getAllProviderKeys`). Deleting a stored key: a new Rust command is NOT added; instead `storeProviderKey(provider, '')` is the delete path — **verify** this Rust semantic works (Plan 03-06 task reads config.rs:636 to confirm empty string clears the keyring entry). If not, document the gap and defer the Delete button to Phase 9. Rationale: zero new Rust in Plan 03-06.

- **D-82:** **Models pane** — lists the current active `config.provider + config.model` with a dropdown of the provider's default model list (hardcoded per-provider list inline at first — Phase 9 can centralise). `switchProvider(provider, model)` is the save path. Token-efficient toggle wired to `setConfig({ ...config, tokenEfficient: bool })`.

- **D-83:** **Routing pane** — reads `getTaskRouting()` (new wrapper — Plan 03-02) + writes `setTaskRouting(routing)` (new wrapper — Plan 03-02). Grid of 5 rows (code / vision / fast / creative / fallback) each with a provider dropdown. Shows "No key stored — configure in Providers" inline if the chosen provider has no key.

- **D-84:** **Voice pane** — `setConfig` writes to `voice_mode`, `tts_voice`, `voice_shortcut`. `quickask_submit` shortcut and wake-word toggle use `save_config_field`. Live preview of TTS text is deferred to Phase 4 (no TTS engine wired yet in frontend).

- **D-85:** **Personality pane** — exposes `user_name`, `work_mode`, `response_style` (from `config`) + a "Re-run persona onboarding" button that calls `resetOnboarding()` wrapper (new in Plan 03-02, wraps `reset_onboarding` from `commands.rs:1934`). Clicking it triggers `MainShell.useOnboardingGate().reEvaluate()` implicitly: the `reset_onboarding` Rust command wipes `config.persona_onboarding_complete` so the next gate check routes the user back to step 4.

- **D-86:** **Appearance pane** — minimal per D-15 (no light theme, no accent picker). Shows locked dark theme info + typography settings readout (sizes from tokens.css, not editable) + a "Reset prefs blob" button wired to `usePrefs().resetPrefs`. Rationale: satisfies SET-06 without reopening D-15.

- **D-87:** **IoT pane** — wraps 3 Home Assistant commands (registered in lib.rs from iot_bridge.rs): `iot_list_entities`, `iot_set_state`, `iot_spotify_now_playing`. New wrapper module `src/lib/tauri/iot.ts` (Plan 03-02). Pane renders a connection status banner + a "Configure HA URL & token" collapsible that calls `save_config_field('ha_base_url', url)` + `save_config_field('ha_token', token)`. If `ha_base_url` is empty, pane shows "Connect Home Assistant" CTA only; no entities fetch.

- **D-88:** **Privacy pane** — read-only surface that lists the local-first promises:
  - Config path (`~/.blade` typical)
  - Keys stored in OS keyring only (verified by showing "***stored in keyring***" strings from `getAllProviderKeys`)
  - "Zero telemetry" headline + a link pointing to `docs/architecture/*.md` for audit
  - "Clear conversation history" button → `history_list_conversations` + `history_delete_conversation` loop
  - Rationale: Privacy is an information surface in v1; actual controls (opt-out toggles) are Phase 7 Admin scope.

- **D-89:** **Diagnostics Entry pane** — small surface that:
  - Shows a `"Open full Diagnostics"` CTA that `openRoute('diagnostics-dev')` (Phase 1 dev-only route) when DEV, OR a "Diagnostics is Admin cluster (Phase 7)" message in prod
  - Lists last-emitted event counts (DEV only) read from the `window.__BLADE_LISTENERS_COUNT__` counter
  - Rationale: "Diagnostics entry" in ROADMAP means a doorway, not the full view (which is Phase 7 ADMIN-*).

- **D-90:** **About pane** — shows package.json version + Tauri version + build date + github link. Pure static content.

### Playwright specs (Plan 03-07)

- **D-91:** Phase 3 extends the Phase 1+2 Playwright harness with FOUR new specs:
  - `tests/e2e/chat-stream.spec.ts` — dispatch synthetic `chat_token` × 50 over 1000ms; assert profiler commit count ≤60; assert MainShell commit count ≤2 (D-68, D-69).
  - `tests/e2e/chat-tool-approval.spec.ts` — emit `tool_approval_needed` → dialog renders → attempt click at t=100ms (should be noop) → click at t=600ms (should succeed) → `respond_tool_approval` invoked with approved=true.
  - `tests/e2e/dashboard-paint.spec.ts` — boot → navigate to `/dashboard` → assert `performance.measure` from `boot` to `dashboard-paint` < 400ms headless.
  - `tests/e2e/settings-provider.spec.ts` — visit `/settings/providers` → enter Groq key + click Test → mock `test_provider` resolves ok → click Save → `storeProviderKey` invoked with `{provider: 'groq', api_key: '...'}`; reload → key remains listed as stored.
  - All specs use the Phase 1 `@tauri-apps/test` harness (the pattern Plan 01-09 + 02-07 shipped). No new test deps.

- **D-92:** **Operator smoke checkpoint at end of Phase 3** (non-autonomous — checkpoint plan 03-07 Task 3):
  - Operator runs `npm run tauri dev`, walks through: complete onboarding → land on dashboard → see Right Now hero with their real active app → open chat → send "hi" → see streamed response → ambient strip visible → open Settings → each of 10 tabs mounts without error → close and reopen app → key persists.
  - Matches Phase 1 WCAG checkpoint + Phase 2 operator walk-through cadence.

### Claude's Discretion

- Exact CSS grid template values in `Dashboard.css` — planner picks; must respect `--nav-width` + `--title-height` tokens.
- Exact hormone-color mapping palette — planner picks; must be colorblind-safe per WCAG 4.5:1 against glass-1 background.
- Whether `useChat` is a React Context or a standalone hook exported from `src/features/chat/useChat.ts` — planner picks Context (so MessageList + CompactingIndicator + InputBar share state without prop drilling). Phase 4 chat-panel-in-quickask can re-context if needed.
- Exact `respondToolApproval` wrapper signature — planner picks `{ approvalId: string, approved: boolean }` camelCase in → snake_case out.
- Whether settings tabs use URL-like ids (`settings-providers`) or nested routing — planner keeps the flat id scheme (current Phase 1 stubs use them); SettingsShell maps active child → pane.
- Exact thinking-section CSS (typewriter caret? just plain text?) — planner picks plain greyscale.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 3: Dashboard + Chat + Settings" — goal, requirements, success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-63, Phase 1+2 substrate inventory, `save_config` blocker notes
- `.planning/RECOVERY_LOG.md` §1 (QuickAsk bridge contract, WIRE-01 shape), §4 (event catalog — 29 LIVE + 6 WIRE targets), §5 (emit_all classification — confirms all single-window chat emits already use `emit_to("main", ...)` post Phase 1 WIRE-08)

### Phase 1 + 2 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/01-foundation/01-{01..09}-SUMMARY.md` + `02-{01..07}-SUMMARY.md` — actual shipped surface
- `.planning/phases/01-foundation/01-PATTERNS.md` — wrapper + useTauriEvent recipe
- `.planning/phases/02-onboarding-shell/02-PATTERNS.md` — shell composition, `useRouter`, toast, palette

### Phase 0 artifacts
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — WIRE-01..06 event definitions + commands that emit them
- `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` — cross-window vs single-window classification (confirms all chat emits are single-window → use `emit_to("main", ...)`)

### Code Phase 3 extends (read-only inputs)
- `src/windows/main/main.tsx` + `MainShell.tsx` — Phase 2 shell
- `src/windows/main/router.ts` — `ALL_ROUTES`, `ROUTE_MAP`, `PALETTE_COMMANDS` (Settings rename/adds flow through this)
- `src/lib/router.ts` — `RouteDefinition`, `DEFAULT_ROUTE_ID`
- `src/lib/tauri/*.ts` — Phase 1+2 wrappers (Phase 3 extends chat.ts + config.ts + adds iot.ts + perception.ts + homeostasis.ts)
- `src/lib/events/index.ts` + `payloads.ts` — already has `BLADE_MESSAGE_START`, `BLADE_THINKING_CHUNK`, `BLADE_TOKEN_RATIO`, `HORMONE_UPDATE`, `TOOL_APPROVAL_NEEDED` — Phase 3 consumes without modification
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — Phase 2 context
- `src/design-system/primitives/*` — 9 primitives + `Dialog` (tool approval)
- `src/design-system/shell/GlobalOverlays.tsx` — Phase 2 mounts stubs for ambient strip; Phase 3 keeps the stubs for HUD-bar reuse but the **actual** ambient strip lives in Dashboard per D-75
- `src/hooks/usePrefs.ts` — Phase 3 adds no new keys (D-66); existing keys suffice

### Rust source (authoritative for new wrapper cites + WIRE closures)
- `src-tauri/src/commands.rs:559` — `send_message_stream` (D-64 WIRE-03/06 emit site)
- `src-tauri/src/commands.rs:71` — `cancel_chat`
- `src-tauri/src/commands.rs:1944` — `set_config` (SET wiring)
- `src-tauri/src/commands.rs:1934` — `reset_onboarding` (D-85 Personality re-run)
- `src-tauri/src/commands.rs:2025` — `test_provider`
- `src-tauri/src/commands.rs:2171` — `respond_tool_approval` (D-71 Tool dialog)
- `src-tauri/src/config.rs:605` — `get_all_provider_keys`
- `src-tauri/src/config.rs:636` — `store_provider_key`
- `src-tauri/src/config.rs:645` — `switch_provider`
- `src-tauri/src/config.rs:713` — `get_task_routing` (D-83 Routing pane)
- `src-tauri/src/config.rs:719` — `set_task_routing` (D-83 Routing pane)
- `src-tauri/src/config.rs:728` — `save_config_field` (D-84 Voice pane, D-87 IoT pane)
- `src-tauri/src/homeostasis.rs:28` — `HormoneState` struct (HORMONE_UPDATE payload source)
- `src-tauri/src/homeostasis.rs:424` — `homeostasis_update` emit site (D-64 parallel-emit target)
- `src-tauri/src/homeostasis.rs:822` — `homeostasis_get` command (D-75 Ambient strip initial fetch)
- `src-tauri/src/perception_fusion.rs:19` — `PerceptionState` struct (D-74 data shape)
- `src-tauri/src/perception_fusion.rs:607` — `perception_get_latest` command
- `src-tauri/src/perception_fusion.rs:613` — `perception_update` command
- `src-tauri/src/providers/anthropic.rs:344` — `chat_thinking` emit (D-64 WIRE-04 parallel-emit target)
- `src-tauri/src/agents/executor.rs:240,265,313,335,349` — `blade_agent_event` emit sites (D-64 WIRE-05 verification)
- `src-tauri/src/iot_bridge.rs:469+` — Home Assistant commands (D-87 IoT pane)
- `src-tauri/src/lib.rs:448-708` — `generate_handler![]` — WIRE-01 `quickask_submit` registration target

### Prototype / design authority
- `docs/design/dashboard.html` + `dashboard-chat.html` — Right Now hero visual + ambient strip layout
- `docs/design/settings.html` — tabbed settings visual
- `docs/design/chat-*.html` if any — reasoning / thinking visual reference

### Explicitly NOT to read (D-17 applies)
- `src.bak/components/Dashboard.tsx, ChatPanel.tsx, MessageList.tsx, Settings.tsx, ModelComparison.tsx, McpSettings.tsx, KeyVault.tsx, AccentPicker.tsx, ThemePicker.tsx` — dead reference. Planner MAY consult ONLY as READ-ONLY pattern ground-truth (e.g. tool approval dialog layout, message bubble spacing) but no imports. Every rendered token / attribute retyped in the new code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1+2 substrate Phase 3 extends

- `src/lib/tauri/chat.ts` currently ships `sendMessageStream`, `cancelChat`. Phase 3 Plan 03-02 adds `respondToolApproval`, `historyListConversations`, `historyLoadConversation`, `historyDeleteConversation` (D-88 Privacy).
- `src/lib/tauri/config.ts` currently ships 9 wrappers (Phase 1+2). Phase 3 adds `getTaskRouting`, `setTaskRouting`, `saveConfigField`, `resetOnboarding`, `debugConfig`. All with JSDoc @see cites.
- `src/lib/tauri/homeostasis.ts` — NEW (Plan 03-02). Wraps `homeostasis_get`, `homeostasis_get_directive`, `homeostasis_get_circadian`.
- `src/lib/tauri/perception.ts` — NEW (Plan 03-02). Wraps `perception_get_latest`, `perception_update`.
- `src/lib/tauri/iot.ts` — NEW (Plan 03-02). Wraps `iot_list_entities`, `iot_set_state`, `iot_spotify_now_playing` (names per iot_bridge.rs — Plan 03-02 task reads lib.rs:448-708 for exact registered names).
- `src/features/chat/index.tsx` currently a stub (ComingSoonSkeleton phase=3). Plan 03-03 replaces.
- `src/features/dashboard/index.tsx` currently a stub. Plan 03-05 replaces.
- `src/features/settings/index.tsx` currently 10 child stub routes (wrong labels per D-79). Plan 03-06 replaces the tab labels + adds pane components.
- `src/design-system/shell/GlobalOverlays.tsx` already mounts a `AmbientStripStub` that subscribes `HOMEOSTASIS_UPDATE`. Plan 03-05 does NOT touch that file — the real AmbientStrip is inside Dashboard per D-75. The Phase 2 stub remains as a sanity check for the MainShell plumbing; Phase 9 can hide it.

### Patterns already established that Phase 3 MUST follow

- **Wrapper recipe:** `invokeTyped<TReturn, TArgs>(command, args)` + JSDoc `@see src-tauri/src/<file>.rs:<line>`. Never raw `invoke`. ESLint rule `no-raw-tauri` enforces.
- **Event subscription:** `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`. Handler-in-ref; subscription keyed on `[name]` only.
- **Style:** compose `.glass .glass-1/2/3` + primitive classes; Tailwind utilities for layout only. No hardcoded hex colors.
- **Routes:** append a `RouteDefinition` to the feature index's `routes` array. Phase 3 modifies `src/features/settings/index.tsx` routes array (rename 2 + add 5).

### Key files Rust plan 03-01 touches

- `src-tauri/src/commands.rs` — 3 new emit sites + 1 new `quickask_submit` command (~40 new lines)
- `src-tauri/src/homeostasis.rs:424` — parallel emit addition (~3 new lines)
- `src-tauri/src/providers/anthropic.rs:344` — parallel emit addition (~3 new lines)
- `src-tauri/src/agents/executor.rs:240,265,313,335,349` — verification only (0 new lines if already `emit_to`)
- `src-tauri/src/lib.rs:448-708` — 1 new handler entry for `quickask_submit` (~1 new line)

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 3 success criteria (MUST be falsifiable):**
- SC-1: Dashboard shows live Right Now hero from perception_fusion; ambient strip reflects homeostasis state (verified by Playwright `dashboard-paint.spec.ts` + manual smoke per D-92)
- SC-2: Chat streams without App-level re-renders; Profiler ≤16ms at 50 tok/sec; tool calls inline with approval dialog (verified by `chat-stream.spec.ts` + `chat-tool-approval.spec.ts` per D-91)
- SC-3: Reasoning-capable model → collapsible thinking section; compacting indicator at ratio > 0.65 (visible during manual smoke per D-92; D-72 + D-73 structurally enforce)
- SC-4: Settings saves a provider key; persists after restart; routing grid reflects updated config (verified by `settings-provider.spec.ts` per D-91)
- SC-5: Dashboard first paint ≤ 200ms with chat open; chat bubbles confirmed rgba not backdrop-filter (D-70 + D-77 grep-asserted by `npm run verify:all`; Playwright measures headless)

**From RECOVERY_LOG.md §1 (backend contract):**
- Plan 03-01 implements `quickask_submit` stub emitting `blade_quickask_bridged` (WIRE-01 — full bridge test is Phase 4 gate per P-02)
- Plan 03-01 implements `blade_message_start`/`blade_thinking_chunk`/`blade_token_ratio` emits (WIRE-03/04/06)
- Plan 03-05 subscribes `HORMONE_UPDATE` (WIRE-02 rename target) AND `HOMEOSTASIS_UPDATE` deprecated legacy — both can fire post-parallel-emit

**From prototype (`docs/design/dashboard.html`):**
- Right Now hero: big headline with active app icon + title + status chip; secondary row of 3 "chips" (disk / RAM / top CPU); errors collapsed by default
- Ambient strip: horizontal row of 5 hormone chips at the bottom, single "dominant" chip styled larger

**From prototype (`docs/design/settings.html`):**
- Left tab list (about 220px wide), active tab marker (left border + filled bg)
- Right content pane with section headers
- Save affordances (buttons) at the bottom-right of each pane or inline on change

**Phase 2 decision carry-over:**
- No Palette DEV toggle (palette-hidden + paletteHidden filter stays — D-57)
- All route IDs stay kebab-case (D-39)
- No new Rust commands except `quickask_submit` (D-50 discipline; D-66 retains)
- Toast system used for all user-visible feedback (settings save, test_provider result) — D-59 bridge mounted in MainShell

</specifics>

<deferred>
## Deferred Ideas

- **Chat panel as overlay on dashboard** — D-78 defers to Phase 9 polish. Phase 3 ships Chat as its own full-route view.
- **Accent picker / theme switcher** — permanently out (D-15).
- **Real agent timeline consumer (`BLADE_AGENT_EVENT` UI)** — Phase 5.
- **HUD bar consuming HORMONE_UPDATE** — Phase 4 (HUD-01..05).
- **Diagnostics full view** — Phase 7 (ADMIN-*).
- **Body hormone dashboard** — Phase 8 (BODY-*).
- **Live TTS preview in Voice pane** — Phase 4 (voice orb surface).
- **"Delete provider key" button if `storeProviderKey('')` doesn't clear keyring** — defer to Phase 9 unless trivially discovered during Plan 03-06.
- **Palette group headings** — Phase 9 (same as Phase 2 deferred).
- **`save_config_cmd` Rust addition** — still a STATE.md blocker; Phase 3 continues D-50 composition route.
- **Dropping legacy `homeostasis_update` emit** — kept under parallel-emit until Phase 4 HUD migrates. Cleanup Phase 4.
- **Models pane dynamic model listing** — hardcoded per-provider list in Plan 03-06; Phase 7 Admin might add live listing via `list_models_for_provider`.
- **Message pagination / infinite scroll** — Phase 9 polish; Phase 3 renders full history.
- **Streaming abort UI** — Plan 03-03 ships a Cancel button wired to `cancelChat`; full race-condition UX (e.g. "in-flight streaming was cancelled" toast) is Phase 9.

</deferred>

---

*Phase: 03-dashboard-chat-settings*
*Context captured: 2026-04-18 via /gsd-plan-phase 3 --auto --chain (no interactive discuss; defaults logged in 03-DISCUSSION-LOG.md)*
