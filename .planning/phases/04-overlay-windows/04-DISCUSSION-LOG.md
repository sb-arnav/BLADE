# Phase 4 Discussion Log — Auto-Mode Defaults

**Mode:** `/gsd-plan-phase 4 --auto --chain` (no interactive operator questions)
**Date:** 2026-04-19
**Planner:** claude-opus-4-7 (1M context)

Arnav delegated to auto mode. The planner picked defensible defaults matching Phase 1/2/3's aesthetic (Liquid Glass dark, self-built, zero new deps, no src.bak imports). Every default below could plausibly have gone another way; the chosen path + alternatives + rationale are documented so Arnav can override at any point.

---

## D-93 — Upgrade `quickask_submit` stub with `send_message_stream_inline` helper

**Default:** Upgrade the Phase 3 stub body to call a new internal helper `send_message_stream_inline` that reuses the existing streaming pipeline. Keep the `#[tauri::command]` signature identical. Emit `blade_quickask_bridged` immediately (echo the user's query) so main UI gets the user-turn; then emit the normal `blade_message_start` → `chat_token*` → `chat_done` chain for the assistant response. Parallel-emit `chat_token` + `chat_done` + `blade_thinking_chunk` to BOTH `main` AND `quickask` windows so the QuickAsk popup can stream the answer inline.

**Alternatives considered:**
- (a) Add a brand-new `quickask_stream` command with its own streaming loop. Pro: fully isolated from `send_message_stream`. Con: duplicates 500+ lines of streaming code; two test surfaces; drift risk.
- (b) Frontend calls `send_message_stream` directly from QuickAsk with a `source_window: 'quickask'` arg and Rust routes emits based on that. Pro: no new Rust fn. Con: requires signature change to `send_message_stream` (breaks the Phase 3 contract); invoke payload pollution.
- (c) Keep the stub as-is; frontend handles everything. Pro: no Rust changes. Con: QuickAsk can't stream because `send_message_stream` is bound to the main window — emits only go to `main` without a `source_window` mechanism. Would force main to be visible to see the reply, defeating the whole "Spotlight" UX.

**Pick:** (a hybrid) — upgrade stub body, extract helper. Helper is internal (`pub(crate) fn send_message_stream_inline`), NOT a Tauri command. Reuses `send_message_stream`'s code path with a minor emit-to-both-windows path. Rust change is ~120-150 net new lines; one module. Matches Phase 3's "WIRE helpers live in commands.rs, single entry" discipline.

---

## D-94 — Shortcut fallback chain

**Default:** Try configured shortcut → platform-default fallback → secondary fallback → abort with fatal toast. Emit a warning toast when a fallback succeeds.

**Alternatives considered:**
- (a) Keep Phase 3 behavior (log error + return; no fallback). Pro: simplest. Con: SC-5 explicitly requires graceful fallback.
- (b) Hard-code a single universal shortcut (`F5`? `Cmd+;`?) as fallback. Pro: simple fallback. Con: breaks user expectation; F5 is already "refresh page" in web contexts.
- (c) Prompt user via Dialog to pick a shortcut on failure. Pro: user-driven. Con: adds a modal on boot; violates "zero friction" boot.

**Pick:** platform-default fallback sequence. macOS avoids `Alt+Space` (CJK IME conflict) with `Cmd+Option+Space`; Windows/Linux use `Alt+Space`; universal secondary is `Ctrl+Shift+Space`. The fallback succeeds silently with a non-fatal warning toast; full failure shows an error toast with all attempts listed. Extends `ShortcutRegistrationFailedPayload` additively (non-breaking).

---

## D-95 — `set_wake_word_enabled` runtime toggle

**Default:** Add a 1-command Rust helper wrapping `save_config_field` + conditional `wake_word_start`/`wake_word_stop`. Frontend wrapper in `config.ts`.

**Alternatives considered:**
- (a) Force restart to apply. Pro: no new command. Con: Voice settings pane UX regression.
- (b) Frontend composes `saveConfigField('wake_word_enabled', bool)` + `wakeWordStart()` or `wakeWordStop()`. Pro: no new Rust. Con: frontend shouldn't decide "if enabled, start; else stop" — it's domain logic that belongs in wake_word.rs.

**Pick:** new Rust command. Small (10 lines), single-concern, testable in isolation. Honors D-66 "no new config fields" (the field already exists in BladeConfig).

---

## D-96, D-97 — Content-protection and HUD-emit sanity checks

**Default:** Read-only verification via grep script + Playwright assertion. No modification to `ghost_mode.rs:481` (D-09 content-protected). Parallel-emit HUD data to both labels (`blade_hud` + `hud`) to cover the label-naming ambiguity.

**Alternatives considered:**
- (a) Rename `blade_hud` → `hud` across Rust. Pro: single label. Con: 6+ call sites, risky refactor, Phase 4 shouldn't touch overlay_manager beyond the single line addition.
- (b) Change frontend's bootstrap to subscribe `blade_hud`-scoped events. Pro: no Rust change. Con: frontend doesn't know its own label cleanly.

**Pick:** parallel-emit. One-line addition per site. Same pattern Phase 3 used for `homeostasis_update` → `hormone_update` rename (D-64).

---

## D-98 — QuickAsk window = single component with text / voice sub-modes

**Default:** `<QuickAskWindow/>` switches between `text` and `voice` sub-views via internal state.

**Alternatives considered:**
- (a) Two separate Tauri windows, one per mode. Pro: matches the two prototype files. Con: duplicate boot cost; weird UX "which window is active?"
- (b) Mode selector always visible (no toggle). Pro: explicit. Con: wastes vertical space on the floating window.
- (c) Per-mode routing within a single window (`/text` vs `/voice` sub-routes). Pro: URL-like clarity. Con: QuickAsk is not a route-based window; adds complexity.

**Pick:** single component + state toggle. Tab key switches modes. Matches the prototype intent (two modes of one window).

---

## D-99 — QuickAsk history in local localStorage

**Default:** Use `blade_quickask_history_v1` localStorage key, max 5 items, dedup on submit.

**Alternatives considered:**
- (a) Use `usePrefs` (blade_prefs_v1) with nested key. Pro: single prefs store. Con: QuickAsk window runs in its own webview with separate localStorage; cross-window prefs need events or IPC. Over-engineered for a 5-item list.
- (b) Persist in Rust via DB. Pro: canonical. Con: QuickAsk is ephemeral; each prefix-match search would need IPC; slow for typeahead.
- (c) Skip history entirely in Phase 4. Pro: minimal. Con: src.bak had it; removing is a visible regression.

**Pick:** local localStorage blob, named key. Matches old convention. No cross-window sync needed.

---

## D-100 — QuickAsk streams in-window AND bridges to main

**Default:** Parallel-emit `chat_token`/`chat_done`/`blade_thinking_chunk` to both `main` and `quickask`; QuickAsk window renders live streaming response; main also updates.

**Alternatives considered:**
- (a) Stream only to QuickAsk; bridge after `chat_done`. Pro: one rendering surface. Con: main doesn't see the conversation until after; bridging mid-stream is a race.
- (b) Stream only to main; QuickAsk doesn't render, it just submits and hides. Pro: simple QuickAsk. Con: user doesn't see the response without switching to main — bad Spotlight UX.

**Pick:** parallel-emit. Best UX; no extra state sync needed.

---

## D-101 — QuickAsk auto-hide on Esc OR 2s after chat_done

**Default:** Esc always hides; 2s timer after `chat_done` hides unless paused by hover (hover pause is Phase 9).

**Alternatives considered:**
- (a) Hide on Esc only; persist response until user dismisses. Pro: user-controlled. Con: stale window stays around; not Spotlight-like.
- (b) Auto-hide after 5s. Pro: more time to read. Con: feels laggy; 2s matches prototype intent.

**Pick:** 2s after done + Esc. Aligns with src.bak QuickAsk's dismissal behavior.

---

## D-102 — Main window bridge via `QuickAskBridge` component + `injectUserMessage` action

**Default:** New `<QuickAskBridge/>` in `MainShell` subscribes `BLADE_QUICKASK_BRIDGED`; calls new `ChatProvider.injectUserMessage({id, content})`; fires `openRoute('chat')`; shows toast.

**Alternatives considered:**
- (a) `ChatProvider` itself subscribes `BLADE_QUICKASK_BRIDGED`. Pro: one fewer component. Con: `ChatProvider` mounted only inside chat route; it's unmounted when on `/dashboard` or `/settings`; bridge wouldn't fire until user navigates.
- (b) Global listener in `useRouter`. Pro: always mounted. Con: chat-specific logic leaks into router.

**Pick:** dedicated component at MainShell level. Always mounted; calls into `ChatProvider` via context; minimal coupling.

---

## D-103 — OpenClaw math via `useOrbPhase` hook + rAF + CSS var DOM writes

**Default:** Single hook owns rAF loop; writes CSS vars directly to DOM (no React state updates per frame).

**Alternatives considered:**
- (a) React state + CSS vars via `style` prop. Pro: React-idiomatic. Con: state updates per frame → commits per frame → 60 renders/sec → won't hit 60fps on integrated GPU.
- (b) WebGL/Canvas orb. Pro: max performance. Con: weeks of work; OpenClaw CSS rings are already fine.

**Pick:** DOM-direct writes. Standard high-perf pattern for continuous animation. React owns mount/unmount + phase transitions (cross-fade); rAF owns per-frame vars.

---

## D-104 — Client-side Web Audio RMS instead of Rust VAD IPC

**Default:** Mic acquisition + RMS in the overlay window via `navigator.mediaDevices` + AnalyserNode. WIRE-07 (audio_timeline.rs VAD) stays for meeting detection; not repurposed for orb RMS.

**Alternatives considered:**
- (a) Rust emits `audio_rms_tick` every 83ms; orb consumes. Pro: single source of truth. Con: IPC round-trip adds ≥60ms latency; user perceives orb as laggy.
- (b) Skip mic feedback entirely; listen-phase amplitude is static. Pro: no mic permission dance. Con: breaks "orb breathes with voice" core UX.

**Pick:** Web Audio. 12fps throttle (EMA smoothing handles higher raw rates). Mic samples never leave the window.

---

## D-105 — Voice Orb driven by Rust conversation events (source of truth)

**Default:** Orb subscribes `voice_conversation_{listening,thinking,speaking,ended}` + `wake_word_detected`; phase state flips from events only (never from client-side inference).

**Alternatives considered:**
- (a) Orb infers phase from its own mic analysis. Pro: no event dependency. Con: divorces from actual conversation state (Rust tracks VAD + TTS progress); state drift.

**Pick:** Rust events. Canonical per RECOVERY_LOG §2.

---

## D-106 — Keep `overlay` window label (no rename to `voice_orb`)

**Default:** Reuse `overlay` label from Phase 1 D-43 HTML entry.

**Alternatives considered:**
- (a) Rename to `voice_orb`. Pro: clearer semantic. Con: breaks `emit_to("overlay", ...)` at voice_global.rs and elsewhere.

**Pick:** no rename. Discipline: labels are Rust contracts, stable across phases.

---

## D-107 — Voice Orb corner persistence via `usePrefs`

**Default:** Prefs key `voice_orb.corner`; default `bottom-right`.

**Alternatives considered:**
- (a) localStorage. Pro: window-local. Con: breaks cross-window sync if we ever want it; `usePrefs` is the canonical API.

**Pick:** prefs. Per D-12 discipline.

---

## D-108 — 180ms cross-fade between phases

**Default:** `transition: all 180ms var(--ease-out)` on orb container. Matches prototype footnote.

**Alternatives considered:**
- (a) 120ms snap. Pro: snappier. Con: prototype says 180ms.
- (b) 300ms smooth. Pro: smoother. Con: feels laggy.

**Pick:** 180ms. Prototype authority.

---

## D-109 — Ghost overlay two-state visual

**Default:** Idle pill (always rendered when active) + card (rendered on suggestion). Ctrl+G toggles card visibility.

**Alternatives considered:**
- (a) One state (card only, no idle). Pro: simpler. Con: empty card looks broken; idle pill shows active/ready status.
- (b) Fullscreen overlay. Pro: more room. Con: intrusive during meetings.

**Pick:** two-state. Matches prototype.

---

## D-110 — Linux warning Dialog on first ghost activation

**Default:** Once-acknowledged Dialog via `usePrefs`, uses `Dialog` primitive. "I understand" starts; "Cancel" aborts.

**Alternatives considered:**
- (a) Toast on every activation. Pro: persistent reminder. Con: fatigue.
- (b) No warning. Pro: simple. Con: SC-3 mandates it.
- (c) Block Linux entirely. Pro: safe. Con: strips a feature from Linux users; some may not care about screen-share privacy.

**Pick:** once-acknowledged Dialog. Informs user, respects decision, doesn't nag.

---

## D-111 — Ghost auto-reply deferred

**Default:** Ghost UI renders text only; no "Send now" button in Phase 4.

**Alternatives considered:**
- (a) Include a Send button that calls `auto_reply`. Pro: one-click reply. Con: auto-sending belongs in HIVE autonomy (Phase 8); security + UX risk.

**Pick:** defer. User types; agent suggests.

---

## D-112 — Ghost subscribes 3 events via `useTauriEvent`

**Default:** `ghost_meeting_state`, `ghost_suggestion_ready_to_speak`, `ghost_meeting_ended`. D-13 hook only.

**Alternatives considered:** none; this is mechanical.

---

## D-113 — HUD 5-chip layout

**Default:** Time, Active app, God-mode, Hormone, Meeting.

**Alternatives considered:**
- (a) Extend to 8 chips (add hive, decisions, unread). Pro: more info. Con: HUD bar width is limited; 5 is dense enough.
- (b) Minimal 3-chip (time, god-mode, hormone). Pro: cleanest. Con: misses meeting countdown which is high-value.

**Pick:** 5 chips. Matches canonical HudData priority.

---

## D-114 — HUD click = toggle_window; right-click = mini menu

**Default:** Click opens main; right-click opens popover menu with 4 items (Open BLADE / Open Chat / Hide HUD / Settings). New event `blade_route_request` for cross-window navigation.

**Alternatives considered:**
- (a) Click = open main + route to chat. Pro: opinionated default. Con: some users want dashboard.
- (b) Right-click → native context menu via Tauri. Pro: OS-native look. Con: Tauri 2 context menu API is less styled; design tokens would need duplication.

**Pick:** click opens main (default route); right-click = styled menu for explicit navigation. `blade_route_request` is a small event additive to `BLADE_EVENTS`.

---

## D-115 — macOS notch safe-area via Rust helper

**Default:** New Rust command `get_primary_safe_area_insets` → returns `{top, bottom, left, right}` from `NSScreen.safeAreaInsets`. HUD reads during mount, offsets position.

**Alternatives considered:**
- (a) Pure CSS `env(safe-area-inset-top)`. Pro: zero Rust. Con: unreliable in Tauri WebViews across platforms.
- (b) Ignore notch. Pro: simplest. Con: HUD bar hides behind notch on notched Macs.

**Pick:** Rust helper. Small (~20 lines), platform-gated, returns zero on non-mac.

---

## D-116 — Bridge subscriber = `QuickAskBridge` component at MainShell level

See D-102. Cross-cut with D-93 (Rust emits the event; frontend consumes).

---

## D-117 — 5 new Playwright specs + operator Mac smoke

**Default:** quickask-bridge, voice-orb-phases, ghost-overlay-headline, hud-bar-render, shortcut-fallback. Mac smoke (non-autonomous) bundled with cargo check.

**Alternatives considered:**
- (a) One spec per requirement (29 specs). Pro: max coverage. Con: test sprawl; overlap; slow CI.
- (b) No Playwright specs; rely on manual. Pro: speed. Con: SC falsifiability lost.

**Pick:** 5 focused specs, one per SC plus bridge. Matches Phase 3 cadence (4 specs + bash script).

---

*Log finalized: 2026-04-19*
