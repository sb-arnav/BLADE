# Phase 4: Overlay Windows — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 04-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 4 --auto --chain` (planner-picked defaults)

<domain>
## Phase Boundary

Phase 4 replaces the four overlay-window bootstraps (placeholders shipped by Phase 1 Plan 01-01) with working surfaces:

1. **QuickAsk** — Spotlight-style floating input with streaming result + bridge to main chat history. (QUICK-01..07)
2. **Voice Orb** — OpenClaw-math ring orb with Idle / Listening / Thinking / Speaking phases at 60fps. (ORB-01..08)
3. **Ghost Mode** — Meeting assist card (content-protected on macOS/Windows; gated behind user warning on Linux). (GHOST-01..08)
4. **HUD bar** — Persistent status chip with god-mode tier + hormone dominant + click/right-click menus. (HUD-01..05)

Plus: the WIRE-07 backend gap (VAD-gated `audio_rms_tick` emit in `audio_timeline.rs` or an equivalent RMS pipe for the orb), the Phase 3 stub `quickask_submit` upgraded to a full bridge (provider call + main-window history append), a Phase 3-deferred `set_wake_word_enabled` runtime toggle, and the shortcut-fallback / CJK-IME-avoidance story that SC-5 demands (P-09 verified).

**In scope:** 29 requirements — QUICK-01..07, ORB-01..08, GHOST-01..08, HUD-01..05, WIRE-07.

**Out of scope for Phase 4:**
- Agents cluster (Phase 5)
- Knowledge cluster (Phase 5)
- Life OS / Identity (Phase 6)
- Dev Tools / Admin (Phase 7)
- Body visualization / Hive mesh (Phase 8)
- Polish pass — error boundaries everywhere, WCAG re-sweep, Voice Orb 60fps gate on every wallpaper (Phase 9 POL-10)
- macOS notarization / code-signing (project-level concern, not skin rebuild)

**Key Phase 1+2+3 substrate Phase 4 leans on (no drift permitted):**
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/chat.ts` — `sendMessageStream`, `cancelChat`, `respondToolApproval`, **`quickaskSubmit`** (already wired, Phase 3 stub — Phase 4 Plan 04-01 upgrades the Rust backing)
- `src/lib/tauri/config.ts` — `getConfig`, `saveConfigField`, plus Phase 4 extensions
- `src/lib/tauri/window.ts` — `getCurrentWebviewWindow()` wrapper (already live)
- `src/lib/events/index.ts` + `payloads.ts` — 49 events including `BLADE_QUICKASK_BRIDGED`, `VOICE_CONVERSATION_*`, `WAKE_WORD_DETECTED`, `GHOST_MEETING_STATE`, `GHOST_SUGGESTION_READY_TO_SPEAK`, `GHOST_MEETING_ENDED`, `HUD_DATA_UPDATED`, `GODMODE_UPDATE`, `HORMONE_UPDATE`, `SHORTCUT_REGISTRATION_FAILED`
- `src/design-system/primitives/*` — 9 primitives + `Dialog` (ghost Linux warning) + `GlassSpinner` (quickask streaming) + `Pill` (HUD status chips) + `Card` (ghost headline card)
- `src/features/chat/useChat.tsx` — `ChatProvider` + `useChatCtx` (main-window chat context; QuickAsk bridge appends to its `messages` via the `BLADE_QUICKASK_BRIDGED` handler)
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — design tokens, including D-07 blur caps 20/12/8 and D-18 QuickAsk voice blur(48px) override
- `docs/design/shared.css` + `docs/design/orb.css` + `docs/design/proto.css` — visual source of truth (Phase 4 re-expresses CSS in src using Phase 1 tokens; no `<link>` imports)

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering from STATE.md (D-01..D-92 locked through Phase 3). Phase 4 adds D-93..D-117.

### Rust WIRE closure + bridge upgrade (Plan 04-01 — earliest wave)

- **D-93:** **Phase 3 `quickask_submit` stub becomes a full bridge in Phase 4.** Today the stub (`commands.rs:2561`) just echoes the query back to main with an empty `response`. Phase 4 Plan 04-01 upgrades the implementation so it:
  1. Accepts `{query, mode, source_window}` as today.
  2. Generates `conversation_id` + `message_id` + timestamp (same shape).
  3. Emits `blade_quickask_bridged` to `main` with `{query, response: "", conversation_id, mode, timestamp, message_id, user_message}` — main window inserts the user turn into `useChat().messages` immediately (optimistic).
  4. Emits `blade_message_start` to `main` with the same `message_id` (re-using the Phase 3 WIRE-03 emit site via a small helper `fn emit_message_start(app, id)` extracted from `send_message_stream`).
  5. Spawns a task that calls `crate::commands::send_message_stream_inline(app, messages, conversation_id, message_id)` — **a new thin helper** that wraps the existing streaming pipeline and reuses the existing `chat_token`/`chat_done`/`chat_thinking` emits. No duplicate streaming code. Helper is NOT a `#[tauri::command]`; it's a pure Rust fn called from `quickask_submit`.
  6. On provider error, emits `blade_notification` with `{type: 'error', message: ...}` so the toast surface shows it.
  7. Hides the QuickAsk window via `app.get_webview_window("quickask").hide()` after emitting `blade_quickask_bridged`.
  8. **Does NOT persist to conversation history from Rust** — Phase 4 keeps history in memory (useChat state) and surfaces via the existing `history_*` commands on demand. Persistence-on-quickask is a Phase 5+ ergonomics pass.

  Rationale: the bridge contract from RECOVERY_LOG.md §1.1 is satisfied (query flows → chat panel receives conversation → streaming appears in main). The "message_id threading" reuse avoids adding a new event; the existing `blade_message_start` + `blade_thinking_chunk` + `chat_token` / `chat_done` chain handles the rest. Alternative considered: fire-and-forget the user's text into `send_message_stream` directly with a `skip_history: bool` flag — rejected because it creates a second entry point to chat streaming and doubles test surface.

- **D-94:** **Shortcut fallback + CJK IME avoidance (P-09).** `register_all_shortcuts()` in `lib.rs:268` currently:
  - Tries the configured `quick_ask_shortcut` (default `Ctrl+Space`).
  - On failure (`Err(e)`), emits `shortcut_registration_failed` to `main` and returns without registration.

  Phase 4 Plan 04-01 extends this to:
  1. Try the configured shortcut first (same).
  2. On failure, try the PLATFORM FALLBACK sequence: `Alt+Space` (Windows/Linux) or `Cmd+Option+Space` (macOS — avoids CJK IME conflict with plain `Ctrl+Space`/`Alt+Space` on macOS; see macOS Key Bindings reference).
  3. On second failure, try `Ctrl+Shift+Space`.
  4. On all failures, emit a single `shortcut_registration_failed` event with `{shortcut, error, attempted: string[]}` listing every try so the Settings pane can show "No shortcut registered — open QuickAsk from the dock icon or run `/quickask` from the command palette."
  5. When a fallback succeeds, ALSO emit `shortcut_registration_failed` with a non-fatal marker (`severity: 'warning'`) so the user sees "Shortcut registered to {fallback} because {configured} is in use." The UI (toast bridge) shows a warning.

  Extend `ShortcutRegistrationFailedPayload` to include `attempted: string[]` + `severity: 'error' | 'warning'` (payload is additive; existing subscribers keep working).

  Rationale: SC-5 requires "shortcut registration failure is logged and falls back gracefully." The Phase 3 logging is in place; Phase 4 adds the fallback sequence AND the warning path so users aren't stranded without a keyboard trigger. macOS CJK IME conflict with `Alt+Space` is documented (RECOVERY_LOG §1.4).

- **D-95:** **`set_wake_word_enabled(enabled: bool)` runtime toggle** (Phase 3 deferred per D-66 guard).
  - Add `pub async fn set_wake_word_enabled(app: AppHandle, enabled: bool) -> Result<(), String>` in `wake_word.rs`.
  - Implementation: calls the existing `save_config_field("wake_word_enabled", enabled)` (already a registered command), then calls `wake_word_start` if `enabled` else `wake_word_stop`.
  - Register in `lib.rs:785` immediately after `wake_word_status`.
  - Frontend wrapper in `src/lib/tauri/config.ts` as `setWakeWordEnabled(enabled: boolean)`.
  - Rationale: Phase 3 Voice settings pane needs a live toggle — saving the field without restarting the app should start/stop wake-word detection immediately. This is a 1-command Rust addition; keeps the 6-place-rule at bay because `wake_word_enabled` already exists in `BladeConfig`.

- **D-96:** **Ghost content-protection sanity check = read-only verification.** `ghost_mode.rs:481` already calls `.content_protected(true)` at window creation (locked since Phase 1 D-09). Phase 4 Plan 04-01 does NOT re-invoke content protection; it VERIFIES the call still exists via a grep in the verify script and a Playwright-side assertion that the `ghost_overlay` window is opaque to synthetic screenshots. The Linux-side limitation (`.content_protected(true)` is a no-op on Linux per Tauri docs — NSWindowSharingNone is macOS-only; WDA_EXCLUDEFROMCAPTURE is Windows-only) is acknowledged in the plan as a Linux warning (D-99). Rationale: D-09 is load-bearing; zero-change verification + a regression grep matches D-45's "regression allowlist" model.

- **D-97:** **HUD event emit sanity check.** `overlay_manager.rs:252,292` already emits `hud_data_updated` via `emit_to("hud", ...)`. Phase 4 Plan 04-01 does NOT touch these — it verifies via grep (`emit_to."hud".*hud_data_updated`) that both sites exist and uses the canonical window label `hud` (not `blade_hud`). **Deviation flag:** `create_hud_window` uses `"blade_hud"` as the label (line 66). Plan 04-01 adds a one-line shim: `app.emit_to("blade_hud", "hud_data_updated", &data)` parallel-emit at both sites so the HUD window (whichever label is live) receives the tick. Alternative: rename `blade_hud` → `hud` — rejected because `overlay_manager::create_hud_window` is called from god-mode + ghost-mode + pulse at multiple sites; renaming is risky. Parallel-emit for one release cycle keeps backward compat.

### QuickAsk window UI (Plan 04-02)

- **D-98:** **QuickAsk window shape — separate routes for text + voice sub-modes.** Phase 4 QuickAsk bootstrap (`src/windows/quickask/main.tsx`) mounts a single component `QuickAskWindow` that internally switches between two sub-views based on `data-mode`:
  - `text` mode (default) — wide input bar + streaming response + recent-history list (5 items from localStorage).
  - `voice` mode — mic orb (same OpenClaw math as Plan 04-03 Voice Orb) + transcript + submit button.
  Mode switch is local state (`useState<'text' | 'voice'>`), toggled via a tab button and Tab key. Tab from text → voice; Shift+Tab voice → text. Cmd+Enter / Ctrl+Enter from either mode submits.

  QuickAsk window receives a `wake_word_detected` event (cross-window, LIVE): it auto-switches to `voice` mode + calls `start_voice_conversation` if the wake word fires while QuickAsk is open.

  Rationale: the two design prototypes (`docs/design/quickask.html`, `docs/design/quickask-voice.html`) are genuinely two modes of the same window, not two windows. Single-component approach is cleaner than window-switching; matches the prototype's "tab to toggle" pattern.

- **D-99:** **QuickAsk history = the 5 most recent submitted queries per user, persisted in localStorage blob under `blade_quickask_history_v1`** (parallel key, NOT `blade_prefs_v1`, because it's scoped to this window only and has a higher turnover rate than user prefs). QuickAsk window's localStorage is isolated from main window's (different webviews), so reads are local. This matches the old `src.bak/components/QuickAsk.tsx` convention. Max 5 items; dedup on submit. Slash commands (`/screenshot`, `/voice`, `/lock`, `/break`) from src.bak: **deferred to Phase 9** (they're ergonomic extensions, not core QuickAsk). Phase 4 ships plain-text submission only.

- **D-100:** **QuickAsk streaming rendering lives INSIDE the QuickAsk window**, not in main. When the user submits:
  1. QuickAsk calls `quickaskSubmit({query, mode, sourceWindow: 'quickask'})`.
  2. QuickAsk subscribes to `chat_token` and `chat_done` events (cross-window — they `emit_to("main", ...)` but also broadcast in Phase 3; Phase 4 adds a parallel `emit_to("quickask", "chat_token", ...)` inside `send_message_stream_inline` so the QuickAsk window receives them too — see D-93 step 5).
  3. Streams the assistant reply into a live `<div>` under the query input.
  4. When `chat_done` fires, QuickAsk window auto-hides after 1500ms (configurable, default = auto-hide-on-done). The bridged conversation is now in main's `useChat()` state via the `BLADE_QUICKASK_BRIDGED` subscriber — user can expand main chat to see it.

  Rationale: user sees the response immediately in the floating window without needing to pop main open — that's the whole point of QuickAsk. Bridging is ALSO live so main has the conversation.

  Alternative considered: QuickAsk hides immediately after submit and streaming goes to main only. Rejected because that's a worse UX than Spotlight (user submits, sees nothing, has to switch apps to see the answer). Current decision matches macOS Spotlight where the answer appears inline.

- **D-101:** **QuickAsk auto-hide on Esc OR 2s idle after `chat_done`.** Hook ownership is the window itself (`useEffect` + `setTimeout`). Clicking outside the QuickAsk window ALSO hides (blur event on `window`). Esc always hides. The auto-hide timer can be paused by hovering over the response (future: cursor detection; Phase 4 ships timer-on-submit only).

- **D-102:** **Main-window bridge consumer.** In main, `ChatProvider` already subscribes `BLADE_MESSAGE_START`/`CHAT_TOKEN`/`CHAT_DONE` (Phase 3 substrate). Phase 4 Plan 04-06 adds a `<QuickAskBridge>` component mounted inside `MainShell` (below `GlobalOverlays`, above `CommandPalette`):
  - Subscribes `BLADE_QUICKASK_BRIDGED`.
  - On event, inserts the user-turn into `useChatCtx().messages` (needs a new `ChatProvider` action `injectUserMessage({message_id, content})`).
  - Routes the user to `/chat` if not already there (`openRoute('chat')`).
  - Shows a toast "Quick ask bridged." via `useToast().show(...)`.

  This closes SC-1: the bridged conversation appears in the main window's history drawer automatically (no click needed).

### Voice Orb window UI (Plan 04-03)

- **D-103:** **OpenClaw math lives in a single `useOrbPhase` hook** at `src/features/voice-orb/useOrbPhase.ts`. Inputs: current phase (`'idle' | 'listening' | 'thinking' | 'speaking'`), current mic RMS level (0..1). Output: CSS custom properties (`--ring-speed`, `--amp`, `--alpha`, `--orb-scale`) attached to the orb DOM via inline style. These CSS vars are consumed by the existing `docs/design/orb.css` patterns re-expressed in `src/features/voice-orb/orb.css` (ported verbatim, using tokens).

  Inside the hook, a `requestAnimationFrame` loop:
  1. Reads `micRmsRef.current` (latest level from the event stream, ref-backed so we don't re-render on each event).
  2. Applies EMA: `smoothed = 0.45 * prev + 0.55 * raw`.
  3. Writes CSS vars to a DOM node ref (`orbElRef.current.style.setProperty('--amp', String(amp))`).
  4. No React state updates per frame — purely DOM-direct. (CSS vars trigger paint-only, no recomposition.)

  Per spec `docs/design/voice-orb-states.html`: ring speed 0.6/0.9/0.6/1.4 for idle/listening/thinking/speaking; amplitude 0.35 idle → `0.5 + level*0.7` listening → 0.35 thinking → 0.95 speaking; alpha 0.40/0.58+level*0.28/0.40/0.72; orb scale 1.00/1+level*0.12/1.00/1+0.06*sin(t*6).

  Thinking phase ALSO activates two rotating arcs (`arc-1: +42°/s trim 0.08→0.26`, `arc-2: −35°/s trim 0.62→0.86`) — pure CSS `@keyframes`, toggled by `data-phase` attribute, no rAF recompute.

  Rationale: matches the canonical OpenClaw math verbatim (locked D-08 since Phase 1). rAF loop keeps 60fps on integrated GPU because we only write 4 CSS vars/frame. React state updates per frame would blow the budget (60×4 setStates/s + 60 commits).

- **D-104:** **Mic RMS source = synthesized client-side from Web Audio API.** The Voice Orb window acquires the mic via `navigator.mediaDevices.getUserMedia({audio: true})` + an `AnalyserNode` (Web Audio). The analyser runs a 2048-sample FFT → computes RMS on the time-domain data every frame → writes to `micRmsRef.current`. **WIRE-07 (VAD in `audio_timeline.rs`) is NOT repurposed for the orb** — the orb's UI needs sub-100ms latency, and routing mic bytes through Rust for RMS adds ≥60ms. WIRE-07 stays on the Rust side for `audio_timeline.rs` meeting detection (Ghost Mode only).

  - Mic permission: on first orb open, request via `navigator.mediaDevices.getUserMedia`. On permission denied, display a glass card "Grant microphone access in System Settings" + retry button (use existing Rust command `set_microphone_permission_prompt` if registered; else just show text).
  - Privacy: the orb window does NOT send audio anywhere. Raw samples → RMS → vars. Never logged.
  - When the orb is not in `listening` phase, the analyser is disconnected (`track.stop()`) to save battery.

  Rationale: Rust-based RMS would add IPC round-trip; Web Audio keeps mic handling in one window. D-09 content protection still applies (the orb window itself is not content-protected — it's meant to be seen — but the mic samples never leave the window).

- **D-105:** **Voice Orb window subscribes the 4 Rust conversation events** (`voice_conversation_listening`, `_thinking`, `_speaking`, `_ended` — all cross-window LIVE since before Phase 1). The orb's `phase` state machine reacts:
  - `voice_conversation_listening` → phase = `'listening'` + acquire mic.
  - `voice_conversation_thinking` → phase = `'thinking'` + stop mic.
  - `voice_conversation_speaking` → phase = `'speaking'` (mic stays stopped).
  - `voice_conversation_ended` → phase = `'idle'` + stop mic + ignore wake-word for 2s to prevent self-trigger.
  - `wake_word_detected` (cross-window LIVE) → if phase == 'idle', phase → 'listening' + call `invoke('start_voice_conversation')`.

  Rationale: this is the canonical state machine from RECOVERY_LOG §2. The orb drives phase from events, not from its own logic — the backend is the source of truth.

- **D-106:** **Voice Orb window WINDOW label is `overlay`** (not `voice_orb`; not a new label). The Phase 1 Rust code at `lib.rs:349-366` creates it with `label = "overlay"` and URL `overlay.html`. Phase 4 keeps this contract — the bootstrap at `src/windows/overlay/main.tsx` mounts `VoiceOrbWindow`. NOT renaming means all the existing `emit_to("overlay", ...)` sites (voice_conversation_*) continue to work. Rationale: D-40-renaming costs > benefit; one-window = one-label discipline preserved.

- **D-107:** **Orb positioning = centered on primary monitor, draggable to any corner, persisted to prefs under `voice_orb.corner`** (prefs key namespaced per D-12). Default: bottom-right corner. Drag follows `mousedown` + `mousemove` on the orb container; release snaps to nearest corner quadrant. Persistence uses `setPref('voice_orb.corner', 'bottom-right')` through `usePrefs`. The orb's window is NOT resizable, borderless, always-on-top — Rust's existing builder at `lib.rs:349-366` already configures this.

- **D-108:** **Orb exit transitions cross-fade over 180ms** (prototype spec). Phase transitions use a `transition: all var(--dur-enter) var(--ease-out)` on the orb container. Tokens from `motion.css`. Matches prototype `voice-orb-states.html` footnote exactly.

### Ghost Mode window UI (Plan 04-04)

- **D-109:** **Ghost overlay renders two visual states**: `idle` (subtle pill with "Ghost · ⌃G") and `card` (full suggestion card ≤480px wide). State flips on `ghost_toggle_card` event (Ctrl+G shortcut, registered Rust-side at `lib.rs:302-309`). Escape key hides the window. No cursor CSS on ANY element (D-09 discipline preserved).

  Card layout per D-10 (locked Phase 1):
  - Headline ≤6 words (assistant's response, first 6-word chunk).
  - 1–2 bullet points (next 1–2 supporting phrases).
  - Max 60 chars per line (enforced via `max-width: 60ch` CSS).
  - Speaker attribution + confidence dot (deterministic color from `src.bak/components/GhostOverlay.tsx` speakerColor recipe — retyped, not imported).

- **D-110:** **Linux content-protection warning Dialog** shown ONCE on first activation (tracked via `prefs.ghost.linuxWarningAcknowledged` per D-42 keys). Uses the `Dialog` primitive from Phase 1. Body text:

  > **Ghost Mode is visible on screen share on Linux.**
  >
  > On macOS and Windows, Ghost Mode is hidden from screen capture via `content_protected(true)`. Linux does not support this flag — anything you see in Ghost Mode, your meeting participants can also see.
  >
  > Consider using BLADE's voice-only responses (no visible overlay) on Linux.

  Buttons: "I understand, continue" → sets the pref, closes dialog, starts ghost mode. "Cancel" → closes dialog, does NOT start ghost mode. `ghostStart` command only invoked after acknowledgment.

  macOS + Windows: no warning. Start immediately.

  Rationale: SC-3 explicitly requires "Linux shows explicit content-protection warning before activation." Once-acknowledged design avoids warning fatigue.

- **D-111:** **Ghost card auto-reply + typed hints are out of scope.** The Rust `auto_reply` module and `enigo` keyboard injection (`ghost_mode.rs:515-544`) stay as-is; Phase 4 UI just renders the suggestion text — no "Send now" button. User reads, then types manually. Rationale: auto-send is a Phase 7 admin autonomy concern (ghost-mode autonomy sliders are part of HIVE-04 / Phase 8).

- **D-112:** **Ghost overlay subscribes three events**: `ghost_meeting_state` (emit_to ghost_overlay — live per Phase 3), `ghost_suggestion_ready_to_speak` (emit_to ghost_overlay — live), `ghost_meeting_ended` (emit_to ghost_overlay — live). On `ghost_meeting_ended`, the window hides itself after a 2s fade. The Phase 1 D-13 `useTauriEvent` hook is the ONLY subscription surface.

### HUD bar window UI (Plan 04-05)

- **D-113:** **HUD bar layout** — one horizontal row with 5 chips, left-to-right:
  1. **Time** (reads `HudData.time` — formatted `HH:MM`).
  2. **Active app** (reads `HudData.active_app`, falls back to `—` when empty).
  3. **God-mode tier chip** — reads either `HudData.god_mode_status` ("off"|"normal"|"intermediate"|"extreme") from `hud_data_updated`, or from a separate `godmode_update` event subscription (broadcast). Phase 4 subscribes BOTH and uses the most recent.
  4. **Hormone dominant chip** — reads from `hormone_update` event (broadcast). Client-side computes dominant of {arousal, exploration, urgency, trust, adrenaline}. Chip color keyed off hormone (adrenaline=#ff6b6b, arousal=#ffd2a6, etc. — same palette as Dashboard `AmbientStrip`; reuse `src/features/dashboard/hormoneChip.tsx`).
  5. **Meeting / next-meeting chip** — shows `next_meeting_secs` countdown if present, else "No meetings" placeholder (hidden if `hive_status_line` is empty).

  HUD window label: Phase 1 Rust code uses `"blade_hud"` as the real window label (overlay_manager.rs:66). Phase 4's React bootstrap already shipped at `src/windows/hud/main.tsx`. D-97 parallel-emit lets the `hud` label also receive data. Plan 04-05 subscribes both `hud_data_updated` AND `godmode_update` AND `hormone_update` on whichever window label renders.

- **D-114:** **HUD click + right-click behavior.**
  - **Click anywhere in HUD bar** → invokes `toggle_window` (existing Rust command at `lib.rs:187`) to open/focus main window. Frontend wrapper: add `toggleMainWindow()` to `src/lib/tauri/window.ts`.
  - **Right-click anywhere in HUD bar** → opens a mini CSS `<details>` menu inline (or a portal-mounted Dialog — planner picks a floating popover because right-click nav menus are canonical OS behavior). Menu items:
    - "Open BLADE" → `openMainWindow()` (same command).
    - "Open Chat" → `openMainWindow()` + emit `blade_route_request` with route id 'chat'.
    - "Hide HUD" → `overlay_hide_hud`.
    - "Settings" → `openMainWindow()` + emit `blade_route_request` route id 'settings-voice' (or similar).
  - New event `blade_route_request` is emitted cross-window from HUD to main. Main's `useRouter.ts` subscribes via `useTauriEvent` and calls `openRoute` when received. Register as new event in BLADE_EVENTS + payloads.

  Rationale: HUD is the always-on-top access surface; its primary affordances are "open main" + "jump to a specific route." Right-click menu follows macOS conventions.

- **D-115:** **macOS notch awareness — HUD positions below the notch on notched Macs.** Tauri exposes `tauri::NSScreen::safeAreaInsets` on macOS 12+. Plan 04-05 includes a small Rust helper that reads `NSScreen::safeAreaInsets.top`; if > 0 (notch present), HUD window position is offset by that amount. On Windows/Linux (and notch-less Macs), the helper returns 0. The HUD bootstrap reads a new `get_primary_safe_area_insets` command during mount and sets its own `top` position via `getCurrentWebviewWindow().setPosition`. If the command fails (e.g. Linux), fall back to `top = 0`.

  Alternative: pure CSS `env(safe-area-inset-top)` — rejected because Tauri WebViews don't consistently expose viewport insets for windows that are not the active frontmost window.

  Rationale: SC-4 says "HUD bar window appears on launch" — on notched Macs it MUST appear below the notch (SC is silent on this but the visual prototype shows it), so we handle it from Rust.

### Shortcut + bridge wiring (Plan 04-06)

- **D-116:** **QuickAsk bridge subscriber in main lives at `src/features/chat/QuickAskBridge.tsx`.** Uses `useTauriEvent<BladeQuickAskBridgedPayload>(BLADE_EVENTS.BLADE_QUICKASK_BRIDGED, ...)`. Calls into `useChatCtx()` via a new action `injectUserMessage({id, content})` on `ChatProvider` + fires `openRoute('chat')` via `useRouterCtx`. Also calls `useToast().show({type: 'info', title: 'Quick ask bridged', message: query})`.

  The `ChatProvider` (existing `src/features/chat/useChat.tsx`) gains one new action:
  ```ts
  injectUserMessage: (m: { id: string; content: string }) => void
  ```
  This appends to `messages` without invoking `sendMessageStream` (the Rust side already kicked it off).

  Rationale: SC-1 bridge is entirely frontend-driven after the Rust emit. Single component, one action. No refactor of `useChat`.

### Playwright + Mac operator smoke (Plan 04-07)

- **D-117:** **Phase 4 Playwright spec set** extends the Phase 1+2+3 harness with FIVE new specs:
  - `tests/e2e/quickask-bridge.spec.ts` — mock `quickask_submit`; emit synthetic `blade_quickask_bridged`; assert that the main window's ChatProvider messages grow by 1 (the user-turn); assert `openRoute('chat')` called.
  - `tests/e2e/voice-orb-phases.spec.ts` — render `<VoiceOrbWindow/>` in isolation (import the component directly, not the whole window); inject synthetic `voice_conversation_listening` → assert `[data-phase="listening"]` attribute appears; same for thinking, speaking, ended → idle.
  - `tests/e2e/ghost-overlay-headline.spec.ts` — render `<GhostOverlayWindow/>` in isolation; emit synthetic `ghost_suggestion_ready_to_speak` with a long response; assert the rendered headline is ≤6 words (`.ghost-headline` text word count) and body has 1–2 bullets (`.ghost-bullets li` count between 1 and 2).
  - `tests/e2e/hud-bar-render.spec.ts` — render `<HudWindow/>` in isolation; emit synthetic `hud_data_updated` + `godmode_update` + `hormone_update`; assert each chip renders. Test right-click → menu appears → "Open BLADE" invokes `toggle_window`.
  - `tests/e2e/shortcut-fallback.spec.ts` — emit synthetic `shortcut_registration_failed` with `severity: 'warning'` payload; assert toast appears with fallback message; emit a fatal variant with `severity: 'error'` + `attempted` list; assert different toast body.

  All specs reuse the Phase 1 `@tauri-apps/test` harness pattern (dev server + Playwright). No new test deps. Each spec falsifies exactly one SC.

  **Operator Mac-session checkpoint** (non-autonomous; Task 3 of Plan 04-07):
  - Run `npm run tauri dev` on macOS.
  - Verify all 5 windows launch without Rust panic.
  - Press the configured QuickAsk shortcut — QuickAsk window appears.
  - Submit a query — streaming response shows in QuickAsk; window auto-hides after `chat_done`; main window shows the bridged conversation in `/chat`.
  - Run `cd src-tauri && cargo check` — must return 0 errors. (D-65 inheritance; libclang-enabled host required.)
  - Launch a screen share (QuickTime → New Screen Recording, or OBS) and verify Ghost Mode overlay is invisible in the recording. Expected: overlay visually present on the screen to the user but NOT in the recorded video.
  - Verify notch positioning on a MacBook with a notch.
  - Verify Voice Orb 60fps: open Activity Monitor → GPU tab; voice orb listening phase (speaking into mic) should keep GPU usage below 20% on integrated GPU.
  - Test CJK IME: add a Chinese/Japanese IME in Keyboard settings; switch to it; press the QuickAsk shortcut — it should still fire (not eaten by IME).

  Mac-session checkpoint owned by the operator (Arnav's brother's Mac per STATE.md session continuity notes).

### Claude's Discretion

- Exact CSS keyframe values for ring animations within the prototype's constraints (0.6/0.9/0.6/1.4 speed, 0.35/0.5+level·0.7/0.35/0.95 amplitude, etc.) — planner picks closest integer/rational values that match the design within ±5%.
- Exact pixel positioning of the HUD bar (16px top margin below notch, 30px height) — planner picks; must not overlap menu bar.
- Exact Playwright harness choice for isolated component rendering — planner picks `@testing-library/react` for the voice orb and ghost overlay isolated specs (already used elsewhere? check repo); if not, use plain Playwright with `<script type="module">` injection.
- Exact toast copy for shortcut fallback warnings — planner picks short, actionable language.
- Whether `injectUserMessage` is a method on ChatProvider or a separate hook — planner picks method (simpler, one file touched).
- Whether the QuickAsk window's recent-history list is click-to-prefill or click-to-submit — planner picks click-to-prefill (safer UX; matches src.bak convention).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 4: Overlay Windows" — goal, 29 requirements, 5 success criteria
- `.planning/STATE.md` — current position, locked D-01..D-92, Phase 1+2+3 substrate inventory
- `.planning/RECOVERY_LOG.md` §1 (QuickAsk bridge contract — QUICK-01..07), §2 (Voice Orb state machine + OpenClaw math — ORB-01..08), §4 (event catalog — consumed events per window), §5 (emit_to policy)

### Phase 1 + 2 + 3 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45 (includes D-07/D-08/D-09/D-18)
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — D-64..D-92 (especially D-64 WIRE-01 quickask_submit stub definition, D-66 no-new-config-fields discipline)
- `.planning/phases/03-dashboard-chat-settings/03-01-SUMMARY.md` — exact Rust emit sites (`commands.rs:2561` quickask_submit, `commands.rs:663/774/1303` message_start / token_ratio, `homeostasis.rs:444` hormone_update, `providers/anthropic.rs:360` blade_thinking_chunk)
- `.planning/phases/03-dashboard-chat-settings/03-PATTERNS.md` — §1 Rust emit recipe, §2 wrapper recipe, §3 useChat Context skeleton, §11-14 Playwright recipes

### Phase 0 artifacts (inputs)
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — Ghost + Voice Orb + HUD command signatures
- `.planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md` — QuickAsk / Voice Orb / Ghost / HUD prototype flow maps (A-07..A-10)

### Code Phase 4 extends (read-only inputs)

**Frontend (substrate):**
- `src/windows/main/MainShell.tsx` — Phase 2 shell (mount QuickAskBridge component here)
- `src/windows/main/useRouter.ts` — `useRouterCtx` + `openRoute` (bridge uses this)
- `src/lib/router.ts` — `RouteDefinition`, `DEFAULT_ROUTE_ID`
- `src/lib/tauri/*.ts` — Phase 1+2+3 wrappers; Phase 4 extends `chat.ts` (quickaskSubmit already wired), `config.ts` (setWakeWordEnabled new), `window.ts` (toggleMainWindow new)
- `src/lib/events/index.ts` + `payloads.ts` — 49 events; Phase 4 adds `BLADE_ROUTE_REQUEST` + extends `ShortcutRegistrationFailedPayload` (additive)
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — used by bridge / warning flow
- `src/features/chat/useChat.tsx` — `ChatProvider`, gets new `injectUserMessage` action
- `src/features/chat/ChatPanel.tsx` + `MessageList.tsx` — no changes; QuickAsk bridged messages flow in via `injectUserMessage`
- `src/features/dashboard/hormoneChip.tsx` — reused in HUD chip rendering
- `src/design-system/primitives/*` — 9 primitives + Dialog (Linux warning)
- `src/design-system/shell/GlobalOverlays.tsx` — Phase 2 stub (extended — Plan 04-06 pops these stubs and replaces with live wiring where applicable)
- `src/hooks/usePrefs.ts` — `voice_orb.corner`, `ghost.linuxWarningAcknowledged`, existing `chat.*` keys

**Frontend (window bootstraps — Phase 1 placeholders, Phase 4 replaces):**
- `src/windows/quickask/main.tsx` (Phase 1 stub; Plan 04-02 replaces with `<QuickAskWindow/>`)
- `src/windows/overlay/main.tsx` (Phase 1 stub; Plan 04-03 replaces with `<VoiceOrbWindow/>`)
- `src/windows/ghost/main.tsx` (Phase 1 stub; Plan 04-04 replaces with `<GhostOverlayWindow/>`)
- `src/windows/hud/main.tsx` (Phase 1 stub; Plan 04-05 replaces with `<HudWindow/>`)

### Rust source (authoritative for new wrapper cites + WIRE closures)
- `src-tauri/src/lib.rs:187` — `toggle_window` (HUD click target)
- `src-tauri/src/lib.rs:198` — `toggle_quickask` (shortcut → window toggle)
- `src-tauri/src/lib.rs:213` — `parse_shortcut` (fallback extension site)
- `src-tauri/src/lib.rs:268-310` — `register_all_shortcuts` (D-94 fallback site)
- `src-tauri/src/lib.rs:349-366` — overlay (voice orb) window builder
- `src-tauri/src/lib.rs:451` — `commands::quickask_submit` registration (Phase 3 stub; unchanged Plan 04-01 — the Rust fn body is upgraded in place)
- `src-tauri/src/lib.rs:785` — `wake_word_status` (insert `set_wake_word_enabled` after this)
- `src-tauri/src/commands.rs:2561-2585` — `quickask_submit` Phase 3 stub (Plan 04-01 upgrades body)
- `src-tauri/src/commands.rs:559-1500` — `send_message_stream` (Plan 04-01 extracts helper `send_message_stream_inline`)
- `src-tauri/src/overlay_manager.rs:65-104` — `create_hud_window` (label `blade_hud`)
- `src-tauri/src/overlay_manager.rs:232-255` — `start_hud_update_loop` (D-97 parallel-emit site)
- `src-tauri/src/overlay_manager.rs:252,292` — `hud_data_updated` emits (D-97 sanity check)
- `src-tauri/src/ghost_mode.rs:450-508` — `create_ghost_overlay` (D-96 sanity check — `.content_protected(true)` at line 481)
- `src-tauri/src/ghost_mode.rs:859-873` — `ghost_start`, `ghost_stop`
- `src-tauri/src/ghost_mode.rs:930` — `ghost_get_status`
- `src-tauri/src/voice_global.rs:216` — `start_voice_conversation`
- `src-tauri/src/voice_global.rs:246` — `stop_voice_conversation`
- `src-tauri/src/wake_word.rs:356` — `wake_word_start` (D-95 sibling site)
- `src-tauri/src/wake_word.rs:366` — `wake_word_stop`
- `src-tauri/src/wake_word.rs:371` — `wake_word_status`
- `src-tauri/src/audio_timeline.rs:409` — VAD site (WIRE-07 foundation; see D-104 — we use Web Audio client-side, not this)

### Prototype / design authority
- `docs/design/quickask.html` — text mode visuals + layout
- `docs/design/quickask-voice.html` — voice mode card (D-18 `blur(48px)` override)
- `docs/design/voice-orb-states.html` — 4-phase visual + OpenClaw math source
- `docs/design/ghost-overlay.html` — idle pill + card (D-10 headline format)
- `docs/design/orb.css` — orb-specific CSS (port to `src/features/voice-orb/orb.css`)
- `docs/design/shared.css` — glass tier variables + motion tokens (already ported to `src/styles/` — Phase 1)

### Explicitly NOT to read (D-17 applies)
- `src.bak/components/QuickAsk.tsx` — dead reference. Planner MAY consult only as READ-ONLY pattern (history localStorage layout, input composition) — no imports. All typed in fresh.
- `src.bak/components/VoiceOrb.tsx` — dead reference. Consulted only for the `level` EMA detail (0.45 prev + 0.55 new, 12fps throttle) — already enshrined in D-08 / D-104.
- `src.bak/components/GhostOverlay.tsx` — dead reference. Consulted only for the speakerColor hash recipe — retyped, not imported.
- `src.bak/components/HudBar.tsx` — dead reference. Consulted only for the meeting-countdown formatter (`formatCountdown`) — retyped in Plan 04-05.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1+2+3 substrate Phase 4 extends

- `src/lib/tauri/chat.ts` — `quickaskSubmit` already shipped (Phase 3). Phase 4 does NOT extend this file; the Rust fn body is upgraded Plan 04-01 without touching the wrapper signature.
- `src/lib/tauri/config.ts` — Phase 4 Plan 04-01 adds `setWakeWordEnabled(enabled: boolean)` wrapper; Plan 04-05 optionally reads `quick_ask_shortcut` from config for HUD context.
- `src/lib/tauri/window.ts` — Phase 4 Plan 04-05 adds `toggleMainWindow()` wrapper; Plan 04-04 adds `hideGhostOverlay()` (or reuses `ghost_stop`).
- `src/lib/events/index.ts` — Phase 4 adds `BLADE_ROUTE_REQUEST` + keeps `BLADE_QUICKASK_BRIDGED` (already declared). No other new events.
- `src/lib/events/payloads.ts` — Phase 4 extends `ShortcutRegistrationFailedPayload` (add `attempted: string[]` + `severity: 'error' | 'warning'` — additive); adds `BladeRouteRequestPayload`.
- `src/features/chat/useChat.tsx` — gains one action (`injectUserMessage`); no other changes. Existing D-67 shape preserved.
- `src/features/dashboard/hormoneChip.tsx` — reused verbatim in HUD chips.

### Rust patterns Phase 4 extends (2 plans touch Rust)

**Plan 04-01 Rust changes:**
- `src-tauri/src/commands.rs` — upgrade `quickask_submit` body; extract `send_message_stream_inline` helper fn. Net: ~120-150 net new lines; touches one fn.
- `src-tauri/src/lib.rs` — extend `register_all_shortcuts` with fallback sequence (D-94); register `set_wake_word_enabled` (D-95); parallel-emit fallback label (D-97 — may not need a direct edit here, belongs in overlay_manager).
- `src-tauri/src/overlay_manager.rs` — add parallel `emit_to("hud", ...)` beside existing `emit_to("blade_hud", ...)` at lines 252, 292 (D-97).
- `src-tauri/src/wake_word.rs` — add `set_wake_word_enabled` Tauri command (D-95).

Cargo check gate inherits from Phase 3 D-65: sandbox lacks libclang → operator runs on libclang-enabled host as part of Plan 04-07 Mac-session smoke.

### Dev experience patterns Phase 4 leans on

- All dev-only routes stay palette-hidden + gated on `import.meta.env.DEV`.
- All CI verification scripts live in `scripts/` as Node ESM (`.mjs`); runnable via `npm run verify:<check>`.
- ESLint `no-raw-tauri` rule continues to apply — all new window bootstraps use `useTauriEvent` + typed wrappers, NOT raw `invoke()` / `listen()`.
- `__TAURI_EMIT__` + `__TAURI_INVOKE_HOOK__` test-harness hooks (Phase 1 + 2 + 3) extended for Phase 4 Playwright specs.
- Phase 4 adds two new bash/Node verify scripts: `verify:content-protect` (greps `ghost_mode.rs` for `.content_protected(true)` and fails if missing) + `verify:overlay-bootstraps` (checks all 4 overlay `main.tsx` files mount a real component, not the Phase 1 placeholder).

</code_context>

<specifics>
## Specific Ideas

**From the prototypes (directional):**
- QuickAsk glass blur at 48px is an INTENTIONAL D-07 exception (locked D-18). The sole backdrop-filter layer on the QuickAsk voice screen.
- Voice Orb OpenClaw math is locked per phase (D-08 + RECOVERY_LOG §2.3). No deviation.
- Ghost card ≤6-word headline, 1–2 bullets, ≤60 chars/line (D-10). Typography from Phase 1 tokens.
- HUD bar is 30px high full-width at top of primary monitor.

**From Rust reality:**
- `quickask_submit` command shape is LOCKED (Phase 3 shipped). Phase 4 upgrades the BODY, not the signature.
- Voice orb state events (`voice_conversation_*`) are CROSS-WINDOW broadcasts — the overlay subscribes them without a label-scope hint.
- Ghost overlay window label is `ghost_overlay` (not `ghost`). Rust code at `ghost_mode.rs:471` uses this; frontend bootstrap at `src/windows/ghost/main.tsx` runs in the `ghost_overlay` window context.
- HUD window label is `blade_hud` (not `hud`). Rust code at `overlay_manager.rs:66` uses this; frontend bootstrap at `src/windows/hud/main.tsx` runs in the `blade_hud` window context. D-97 parallel-emit ensures `emit_to("hud", ...)` also works for the forward-compat case.
- Voice orb window label is `overlay` (stays; D-106).
- QuickAsk window label is `quickask` (stays).

</specifics>

<deferred>
## Deferred Ideas

- **QuickAsk slash commands (`/screenshot`, `/voice`, `/lock`, `/break`).** Old `src.bak/components/QuickAsk.tsx` had these. Phase 4 ships plain text submission only; slash commands deferred to Phase 9 (or a dedicated QuickAsk UX pass).
- **HUD hive-status integration.** `HudData.hive_*` fields are computed in Rust but Phase 4 does NOT render them (hive cluster is Phase 8). Data flows through but is ignored frontend-side — no errors, just hidden chips.
- **Voice Orb hands-free visual emotion overlay.** `voice_emotion_detected` event is LIVE (Phase 0 extract) but Phase 4 orb doesn't render emotion-specific color gradients. Phase 9 polish can add this.
- **Ghost Mode auto-reply keyboard injection.** Rust `ghost_mode.rs:515-544` uses `enigo`. Phase 4 UI surfaces the suggestion text; auto-send gated by Phase 7 autonomy sliders.
- **HUD drag-to-reposition.** HUD bar position is notch-aware + top-fixed in Phase 4. Making it draggable is a Phase 9 ergonomic pass.
- **CJK IME PROGRAMMATIC detection on macOS.** D-94 uses a platform-default fallback sequence, not live IME detection. If CJK fallback still fails in practice, add TISCopyCurrentKeyboardInputSource FFI in a future phase.
- **Content-protection on Linux via Wayland-specific flags.** Wayland `wlr-screencopy-v1` exclusion is not in Tauri 2; Phase 4 D-99 ships the warning Dialog instead. Revisit if Tauri 2.11+ adds the protocol.
- **History persistence on QuickAsk submit.** Phase 4 keeps bridged conversations in `useChat().messages` (ephemeral). A Phase 5+ ergonomics plan can wire them to `history_*` commands.
- **Voice Orb on Windows/Linux.** OpenClaw is a macOS origin library. The CSS port works cross-platform; wake-word detection works cross-platform (porcupine-rs feature flag). No platform-specific orb code.

</deferred>

<mac_session_items>
## Mac-Session Verification Items (Operator Handoff)

These checks cannot be verified in the sandbox. Carry forward to the final operator checkpoint run (Plan 04-07 Task 3, bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3 Mac-smoke per STATE.md strategy).

- **M-01:** `cd src-tauri && cargo check` (or `cargo check --no-default-features`) returns 0 errors on libclang-enabled host. Plan 04-01 Rust edits verified.
- **M-02:** `npm run tauri dev` launches all 5 windows without Rust panic. Fresh config.
- **M-03:** Configured QuickAsk shortcut (default `Ctrl+Space`) triggers QuickAsk window. Submit → stream → auto-hide → conversation appears in main `/chat`.
- **M-04:** CJK IME — add Chinese/Japanese IME in Keyboard settings, switch to it, press QuickAsk shortcut — shortcut still fires (not consumed by IME). If it fails, fallback to `Alt+Space` (Windows/Linux) / `Cmd+Option+Space` (macOS) fires instead, and a warning toast shows.
- **M-05:** Voice Orb 60fps on integrated Intel GPU. Open Activity Monitor → GPU tab while orb transitions through 4 phases. GPU utilization < 20%.
- **M-06:** Ghost Mode overlay invisible in OBS / QuickTime screen capture on macOS. Overlay visible to user; absent from the recording.
- **M-07:** Ghost Mode overlay invisible in OBS / Windows Game Bar on Windows 11. Same as M-06 for Windows.
- **M-08:** Ghost Mode on Linux — first activation shows the warning Dialog (D-110). "I understand, continue" starts Ghost Mode; ghost overlay IS visible in a Linux screen capture (by design).
- **M-09:** HUD bar respects macOS notch — positioned below the notch on a MacBook with a notch; spans full width of non-notched region.
- **M-10:** HUD right-click menu appears at cursor; "Open BLADE" focuses the main window.
- **M-11:** Voice Orb draggable; drops into nearest corner; position persisted across restart.
- **M-12:** Wake word "Hey BLADE" starts Voice Orb listening phase; stopping voice conversation ignores wake word for 2s (prevents self-trigger).
- **M-13:** Voice Orb mic permission denied → shows glass card + retry button.

</mac_session_items>

---

*Phase: 04-overlay-windows*
*Context gathered: 2026-04-19 via /gsd-plan-phase 4 --auto --chain*
