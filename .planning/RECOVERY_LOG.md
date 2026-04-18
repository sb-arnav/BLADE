# BLADE Skin Rebuild — Pre-Rebuild Audit Recovery Log

**Phase:** 00 — Pre-Rebuild Audit
**Created:** 2026-04-18
**Sources:**
- `src-tauri/src/*.rs` (backend contracts)
- `docs/design/*.html` + `*.css` (prototype flows + visual tokens)
- `.planning/research/*.md` + `.planning/codebase/*.md` (already-synthesized context)

**Per D-17, the old frontend backup was NOT read for this audit. Backend + prototypes are canonical sources.**
**Per D-19, this is the singular deliverable for Phase 0.**

---

## 1. QuickAsk ↔ Main Bridge Contract

Derived from `src-tauri/src/commands.rs` + `docs/design/quickask.html` + `docs/design/quickask-voice.html`.

### 1.1 Submission Path

The QuickAsk → Main bridge is currently **WIRE-01 (not yet implemented in backend)**.

**Design intent (D-11):**
- QuickAsk window invokes `quickask_submit` command
- Rust stub emits `blade_quickask_bridged` to the `"main"` window
- Main window listener receives the event and opens the chat panel with the bridged conversation

**Actual backend state:**
- No command named `quickask_submit` exists in `commands.rs`
- No event named `blade_quickask_bridged` exists in the codebase
- QuickAsk text/voice queries must route through `send_message_stream` until Phase 3 stub is built

**Target invoke call (Phase 3 stub to implement):**
```typescript
// QuickAsk window
await invoke("quickask_submit", {
  query: string,         // user's typed or transcribed text
  mode: "text" | "voice",
  source_window: "quickask"
});
```

**Payload schema for `blade_quickask_bridged` event (Phase 3 to emit):**
```typescript
{
  query: string,             // original user query
  response: string,          // BLADE's inline answer (may be partial)
  conversation_id: string,   // for linking to history drawer
  mode: "text" | "voice",    // input mode
  timestamp: number          // Unix ms
}
```

**Emitter:** `src-tauri/src/commands.rs` (to be created — Phase 3 stub)
**Consumer:** Main window `"main"` — per D-14 this event is single-window and must use `emit_to("main", "blade_quickask_bridged", payload)`

### 1.2 QuickAsk Text Mode UX (from `docs/design/quickask.html`)

**Window:** Separate `quickask` window (label `"quickask"`), positioned top 30%, left 50%, width 780px. Appears over wallpaper with `overlay-scrim` (radial dim + 2px blur).

**Search bar anatomy:**
- 34×34 white gradient logo "B"
- `.q-input` — 22px, weight 400, tracking -0.02em
  - `.q-typed` — typed portion
  - `.caret` — animated cursor
  - `.q-typed-rest` — ghost autocomplete hint (`var(--t-3)`)
- `.mode-pill` — "Ask BLADE" with green dot
- `.q-esc` — ESC key hint (closes window)

**Submit keys:** `Enter` or clicking the mode pill submits the query.

**Streaming answer section:**
```
.ai-inline:
  background: linear-gradient(180deg, rgba(138,255,199,0.06) 0%, transparent 100%)
  border-bottom: 1px solid var(--line)

  .ai-av: 28px white gradient, "B"
  .ai-head: "ANSWER" label + model pill (JetBrains Mono) + 3-dot streaming indicator
  .ai-text: 14px, line-height 1.55
  .ai-actions: Send draft | Edit in chat | Copy | Regenerate
```

**Result groups:** Actions (3 rows) → Recent chats (2 rows) → Files & context (2 rows)

### 1.3 QuickAsk Voice Mode UX (from `docs/design/quickask-voice.html`)

**Card spec (D-18 exception — blur(48px) is intentional here):**
```css
.qa-voice {
  width: 640px;
  padding: 40px 48px 28px;
  border-radius: 32px;
  background: linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%);
  border: 1px solid rgba(255,255,255,0.14);
  backdrop-filter: blur(48px) saturate(200%);   /* SOLE layer — exception allowed (D-18) */
}
```

**Orb:** 320×320, same `.orb-overlay[data-phase]` component as voice-orb.html.

**Phase content in voice mode:**
```
idle      → empty + "Tap Space or say 'Hey BLADE' to start."
listening → streaming transcript
thinking  → "Reading the Figma thread and checking your tokens…"
speaking  → "Reply drafted — [summary]. Send?"
```

**Submit:** `Enter` invokes `quickask_submit` with the transcript.

### 1.4 Conversation Persistence Path

After `blade_quickask_bridged` fires on the main window:
1. Main window opens the chat panel (`dashboard-chat` layout)
2. The conversation is stored via `send_message_stream` through the existing memory pipeline:
   - `commands.rs` routes to provider → streams tokens → on completion: `brain_grew` fires → `memory_blocks.human_block` updated
3. History drawer reads from `memory.rs` / `embeddings.rs` — the conversation appears under "Recent chats" in QuickAsk's results list on next open
4. Memory module: `src-tauri/src/memory.rs` (Letta-style virtual context blocks + fact extraction)

### 1.5 Open Contract Risks

- **WIRE-01:** `quickask_submit` + `blade_quickask_bridged` not yet in backend. Phase 3 stub required before Phase 4 bridge verification (P-02).
- **CJK IME conflict:** `Ctrl+Space` shortcut (QuickAsk activation) may conflict with CJK IME on macOS. Per Phase 4 SC #5, shortcut registration failure must be logged and fall back gracefully. Shortcut registration failure event: `shortcut_registration_failed` (`lib.rs:279,294`).
- **Window focus:** QuickAsk is a non-activating panel — test that `invoke` calls work when main window is focused.

---

## 2. Voice Orb Driving-Event State Machine

Derived from `src-tauri/src/voice_global.rs` + `src-tauri/src/wake_word.rs` + `docs/design/voice-orb.html` + `docs/design/voice-orb-states.html`.

OpenClaw animation math is locked via D-08 — see `.planning/research/PRIOR_ART.md` for full derivation. Constants are reproduced in §2.3 for implementation reference only.

### 2.1 Four-Phase State Map

| Phase state | Visual (prototype, `voice-orb-states.html`) | Phase dot color | Entry events (Rust file:line) | Exit events |
|-------------|----------------------------------------------|-----------------|-------------------------------|-------------|
| **Idle** | Rings at low amplitude, slow rotation (0.6×), orb scale 1.00, alpha 0.40 | `rgba(255,255,255,0.4)` — no glow | `voice_conversation_ended` (`voice_global.rs:239`); any timeout/cancel | `voice_global_started` (`voice_global.rs:114`); `wake_word_detected` (`wake_word.rs:274`) |
| **Listening** | Rings expand with audio level, amplitude 0.5 + level×0.7, alpha 0.58 + level×0.28, orb scale 1 + level×0.12 | `#8affc7` with `box-shadow: 0 0 8px #8affc7` | `voice_conversation_listening` (`voice_global.rs:223,538`); `voice_global_started` (`voice_global.rs:114`) | `voice_conversation_thinking` (`voice_global.rs:693`); silence > 1s |
| **Thinking** | Rings return to idle speed (0.6×), two rotating arcs overlaid (arc-1: +42°/s, arc-2: -35°/s) | `#ffd2a6` with `box-shadow: 0 0 8px #ffd2a6` | `voice_conversation_thinking` (`voice_global.rs:693`) | `voice_conversation_speaking` (`voice_global.rs:532`) |
| **Speaking** | Rings fast (1.4×), amplitude 0.95, alpha 0.72, orb scale 1 + 0.06×sin(t×6) — breathing pulse | `#ffffff` with `box-shadow: 0 0 8px #fff` | `voice_conversation_speaking` (`voice_global.rs:532`) | `voice_conversation_listening` (`voice_global.rs:538`) — loops to Listening; `voice_conversation_ended` (`voice_global.rs:239`) — exits to Idle |

### 2.2 State Transition Diagram

```
IDLE ──[wake_word_detected (wake_word.rs:274)]──────────────► LISTENING
IDLE ──[voice_global_started/PTT (voice_global.rs:114)]─────► LISTENING

LISTENING ──[silence ≥ 1s / VAD end-of-utterance]──────────► THINKING
LISTENING ──[voice_conversation_thinking (voice_global.rs:693)]► THINKING
LISTENING ──[30s total silence]─────────────────────────────► IDLE
LISTENING ──[stop phrase / stop_voice_conversation()]───────► IDLE

THINKING ──[voice_conversation_speaking (voice_global.rs:532)]► SPEAKING
SPEAKING ──[TTS complete → voice_conversation_listening (voice_global.rs:538)]► LISTENING
SPEAKING ──[user interrupts, 500ms grace]───────────────────► LISTENING

ANY ──[voice_conversation_ended (voice_global.rs:239)]──────► IDLE
ANY ──[voice_global_error (voice_global.rs:126,141,149,156,166,173)]► IDLE
```

### 2.3 Wake Word Path

1. `wake_word.rs` detects phrase → emits `wake_word_detected` (`wake_word.rs:274`) with payload `{phrase: string, play_chime: true}`
2. Frontend (overlay window) listens → calls `invoke("start_voice_conversation")` (`voice_global.rs:216`)
3. Rust starts conversation loop → emits `voice_conversation_listening` → orb transitions to **Listening**
4. Wake word is cross-window (`wake_word.rs:274` is `cross-window: overlay orb + main + quickask`) — keep as `emit_all`/`app.emit()` per D-14

### 2.4 Orb Commands

| Command | File:Line | Args | Return |
|---------|-----------|------|--------|
| `start_voice_conversation` | `voice_global.rs:216` | `app: AppHandle` | `Result<(), String>` |
| `stop_voice_conversation` | `voice_global.rs:246` | — | `()` |
| `voice_conversation_active` | `voice_global.rs:254` | — | `bool` |
| `wake_word_start` | `wake_word.rs:356` | `app: AppHandle` | `Result<(), String>` |
| `wake_word_stop` | `wake_word.rs:365` | — | `()` |
| `wake_word_status` | `wake_word.rs:371` | — | `bool` |

### 2.5 OpenClaw Math Constants (from `docs/design/voice-orb-states.html`)

```
Overlay size: 440px
Core size:    96px
Stroke:        1.6px
Rings:         ×3 with stagger 0.28
RMS smoothing: 0.45·prev + 0.55·new
UI throttle:   12 fps (83ms)
Phase cross-fade: 180ms easeOut
```

| Phase | ring speed | amplitude | alpha | orb scale |
|-------|-----------|-----------|-------|-----------|
| Idle | 0.6 | 0.35 | 0.40 | 1.00 |
| Listening | 0.9 | 0.5 + level×0.7 | 0.58 + level×0.28 | 1 + level×0.12 |
| Thinking | 0.6 | — (arc overlay) | — | 1.00 |
| Speaking | 1.4 | 0.95 | 0.72 | 1 + 0.06×sin(t×6) |

Thinking arc overlay:
```
arc-1: +42°/s rotation, trim 0.08→0.26 of circumference
arc-2: −35°/s rotation, trim 0.62→0.86 of circumference
```

---

## 3. Onboarding Backend Wiring

Derived from `src-tauri/src/commands.rs` + `src-tauri/src/config.rs` + the 3 onboarding prototype screens (`docs/design/onboarding-0[1-3]-*.html`).

This section maps to ONBD-01..06 requirements.

### 3.1 Boot Check

**Command:** `get_onboarding_status`
- **File:Line:** `src-tauri/src/commands.rs:2312`
- **Signature:** `pub fn get_onboarding_status() -> bool`
- **Return:** `true` = persona onboarding complete (`config.persona_onboarding_complete`)
- **Note:** This is the PERSONA onboarding (5-answer questions). Separate from provider/API key setup. For first-run provider setup, check `config.onboarded: bool` (general onboarding flag).

**Frontend boot logic:**
```typescript
const isOnboarded = await invoke<boolean>("get_onboarding_status");
if (!isOnboarded) {
  navigate("onboarding");  // show Provider Picker (Step 1)
} else {
  navigate("dashboard");   // returning user → skip onboarding
}
```

### 3.2 Three-Step Call Sequence

**Step 1 — Provider Picker (`onboarding-01-provider.html`):**
- User selects one of 6 providers (Anthropic default-selected)
- No invoke on this screen — local component state only
- Tauri wiring: `get_onboarding_status()` before render to check if already done

**Step 2 — API Key Entry (`onboarding-02-apikey.html`):**
```typescript
// On "Test" click:
await invoke("store_provider_key", { provider: string, api_key: string });
// File:Line: config.rs:636
// Signature: pub async fn store_provider_key(provider: String, api_key: String) -> Result<(), String>

// After validation, populate model list:
const keys = await invoke<ProviderKeyList>("get_all_provider_keys");
// File:Line: config.rs:604
// Returns: {providers: [{provider, has_key, masked, is_active}], active_provider}
```

**Step 3 — Ready + Deep Scan (`onboarding-03-ready.html`):**
```typescript
// On "Enter BLADE" CTA (after scan completes):
await invoke("complete_onboarding", {
  answers: [
    userName + role,          // index 0
    currentProject,           // index 1
    toolsAndStack,            // index 2
    biggestGoal,              // index 3
    communicationPreference   // index 4
  ]
});
// File:Line: commands.rs:2325
// Signature: pub async fn complete_onboarding(answers: Vec<String>) -> Result<(), String>
// Side effects: writes persona.md, seeds memory_blocks.human_block, sets config.persona_onboarding_complete = true
// Events: None emitted directly from complete_onboarding

// Navigate to dashboard after:
navigate("dashboard");
```

### 3.3 Deep Scan Event Sequence

```typescript
// Frontend listener during Step 3:
const unlisten = await listen("deep_scan_progress", (event) => {
  const { step, total, label, percent } = event.payload;
  // Update progress ring (SVG dasharray) + status text
  // Enable "Enter BLADE" CTA when percent >= 100
});
```

**Event table:**

| Event | File:Line | Payload | Frontend handler |
|-------|-----------|---------|-----------------|
| `deep_scan_progress` | `deep_scan.rs:1325` | `{step: number, total: number, label: string, percent: number}` | Update progress ring + enable CTA when complete |

**Visual scan states (from prototype):**
- Done: green check circle (`rgba(138,255,199,0.2)` fill)
- Doing: white ring with spinning arc (`animation: spin 0.9s linear infinite`)
- Idle: bare ring `rgba(255,255,255,0.14)`

**Note:** Deep scan runs 12 parallel system scanners — progress will jump non-linearly. Frontend should show overall % (SVG ring), current label, and "N of 12 scanners complete · Xs elapsed".

### 3.4 Key Config Commands Used in Onboarding

| Command | File:Line | Signature | Notes |
|---------|-----------|-----------|-------|
| `get_all_provider_keys` | `config.rs:604` | `() -> Value` | `{providers: [{provider, has_key, masked, is_active}], active_provider}` |
| `store_provider_key` | `config.rs:636` | `(provider: String, api_key: String) -> Result<(), String>` | Stores in OS keyring |
| `switch_provider` | `config.rs:645` | `(provider: String, model: Option<String>) -> Result<BladeConfig, String>` | Changes active provider |
| `complete_onboarding` | `commands.rs:2325` | `(answers: Vec<String>) -> Result<(), String>` | Requires exactly 5 elements; seeds persona |
| `get_onboarding_status` | `commands.rs:2312` | `() -> bool` | Check at app boot |

### 3.5 Requirement Mapping

| Requirement | Coverage |
|-------------|----------|
| ONBD-01 | `get_onboarding_status()` boot check; route to provider picker if false |
| ONBD-02 | Provider picker screen (A-01); 6 providers; local state until Step 3 |
| ONBD-03 | API key entry (A-02); `store_provider_key` + validation via `get_all_provider_keys` |
| ONBD-04 | Deep scan progress screen (A-03); `deep_scan_progress` event listener |
| ONBD-05 | `complete_onboarding(answers)` — 5-answer persona init |
| ONBD-06 | Dashboard redirect after `complete_onboarding` returns `Ok(())` |

---

## 4. Event Catalog (Phase 1 `useTauriEvent` Subscription Surface)

This is the definitive list of Rust-side emitters. Phase 1's `useTauriEvent` hook will subscribe to these. Any "WIRE REQUIRED" row is a backend-wiring gap scoped to Phase 3 / Phase 4 (see `.planning/STATE.md` WIRE table). Full `emit_all` classification in §5.

### 4.1 Chat Pipeline Events

| Event name | Rust file:line | Payload type | Consumer window | Status |
|------------|----------------|--------------|-----------------|--------|
| `chat_token` | `commands.rs:742,1276,1284,1289` | `string` | `main` (chat panel) | LIVE |
| `chat_done` | `commands.rs:745,1291` | `()` | `main` (chat panel) | LIVE |
| `chat_ack` | `commands.rs:681` | `string` | `main` (optimistic display) | LIVE |
| `chat_routing` | `commands.rs:640` | `{provider: string, model: string, hive_active: bool}` | `main` (model indicator) | LIVE |
| `chat_cancelled` | `commands.rs:77,1060,1876` | `()` | `main` (chat panel) | LIVE |
| `chat_thinking` | `providers/anthropic.rs:344` | `string` | `main` (thinking section) | LIVE (Anthropic only) |
| `chat_thinking_done` | `providers/anthropic.rs:337` | `()` | `main` | LIVE (Anthropic only) |
| `blade_status` | `commands.rs:581,585,725,979,1062` | `"processing"\|"thinking"\|"idle"\|"error"` | `main` + `hud` (cross-window) | LIVE |
| `blade_planning` | `commands.rs:726,778` | `{query: string, mode?: string, step_count?: number}` | `main` (plan preview) | LIVE |
| `blade_notification` | `commands.rs:1089,1117,1161,1187,1216` | `{type: "info"\|"warn"\|"error", message: string}` | `main` (toast) | LIVE |
| `blade_routing_switched` | `commands.rs:315` | `{from_provider, from_model, to_provider, to_model, reason}` | `main` (toast) | LIVE |
| `blade_message_start` | — | — | `main` (message begin) | **WIRE REQUIRED** (WIRE-03) |
| `blade_thinking_chunk` | — | — | `main` (thinking chunks) | **WIRE REQUIRED** (WIRE-04) |
| `blade_token_ratio` | — | — | `main` (compacting indicator) | **WIRE REQUIRED** (WIRE-06) |
| `blade_quickask_bridged` | — | — | `main` (from QuickAsk) | **WIRE REQUIRED** (WIRE-01) |

### 4.2 Tool + Approval Events

| Event name | Rust file:line | Payload type | Consumer window | Status |
|------------|----------------|--------------|-----------------|--------|
| `tool_approval_needed` | `commands.rs:1631,1653` | `{tool_name, args, context, request_id}` | `main` (approval dialog) | LIVE |
| `tool_result` | `commands.rs:1699,1801` | `{tool_name, result}` | `main` | LIVE |
| `ai_delegate_approved` | `commands.rs:1608` | `{tool_name}` | `main` | LIVE |
| `ai_delegate_denied` | `commands.rs:1616` | `{tool_name}` | `main` | LIVE |
| `brain_grew` | `commands.rs:989,1323; brain.rs:1650` | `{new_entities: number}` | `main` (dashboard/memory) | LIVE |
| `capability_gap_detected` | `commands.rs:1371` | `{user_request: string}` | `main` (admin) | LIVE |
| `response_improved` | `commands.rs:1386` | `{improved: string}` | `main` (chat panel) | LIVE |

### 4.3 Voice Events

| Event name | Rust file:line | Payload type | Consumer window | Status |
|------------|----------------|--------------|-----------------|--------|
| `voice_conversation_listening` | `voice_global.rs:223,538` | `{active: true}` | `overlay` orb + `main` (cross-window) | LIVE |
| `voice_conversation_thinking` | `voice_global.rs:693` | `{text: string}` | `overlay` orb + `main` (cross-window) | LIVE |
| `voice_conversation_speaking` | `voice_global.rs:532` | `{text: string}` | `overlay` orb + `main` (cross-window) | LIVE |
| `voice_conversation_ended` | `voice_global.rs:239` | `{reason: "stopped"\|"no_mic"}` | `overlay` orb + `main` (cross-window) | LIVE |
| `voice_global_started` | `voice_global.rs:114` | `()` | `quickask` (single-window) | LIVE |
| `voice_global_transcribing` | `voice_global.rs:119` | `()` | `quickask` (single-window) | LIVE |
| `voice_global_error` | `voice_global.rs:126,141,149,156,166,173` | `string` | `quickask` (single-window) | LIVE |
| `voice_transcript_ready` | `voice_global.rs:184` | `{text: string}` | `quickask` (single-window) | LIVE |
| `voice_emotion_detected` | `voice_global.rs:480` | `{emotion: string, transcript: string}` | `overlay` + `main` (cross-window) | LIVE |
| `voice_language_detected` | `voice_global.rs:492` | `{language: string}` | `main` (single-window) | LIVE |
| `voice_user_message` | `voice_global.rs:508` | `{content: string}` | `overlay` + `main` (cross-window) | LIVE |
| `voice_session_saved` | `voice_global.rs:663` | `{conversation_id, turn_count}` | `main` (single-window) | LIVE |
| `voice_chat_submit` | `voice_global.rs:767` | `{content, voice_mode: true, history}` | `main` (single-window) | LIVE |
| `wake_word_detected` | `wake_word.rs:274` | `{phrase: string, play_chime: true}` | `overlay` + `main` + `quickask` (cross-window) | LIVE |
| `tts_interrupted` | `tts.rs:264,272` | `()` | `overlay` + `main` (cross-window) | LIVE |

### 4.4 Onboarding / Background System Events

| Event name | Rust file:line | Payload type | Consumer window | Status |
|------------|----------------|--------------|-----------------|--------|
| `deep_scan_progress` | `deep_scan.rs:1325` | `{step, total, label, percent}` | `main` (onboarding Step 3) | LIVE |
| `homeostasis_update` | `homeostasis.rs:424` | `{arousal, energy_mode, exploration, trust, urgency, hunger, thirst, insulin, adrenaline, leptin}` | `main` + `hud` + body (cross-window) | LIVE |
| `hud_data_updated` | `overlay_manager.rs:252,292` | HUD data | `hud` (single-window) | LIVE |
| `blade_toast` | `overlay_manager.rs:323` | toast payload | `main` + overlay (cross-window) | LIVE |
| `godmode_update` | `godmode.rs:233` | `{tier, ...}` | `main` + overlay + `hud` (cross-window) | LIVE |
| `proactive_nudge` | `ambient.rs:145,227,247,283,312` | `{message, action?}` | `main` + overlay (cross-window) | LIVE |
| `hive_tick` | `hive.rs:2603` | status | `main` + `hud` (cross-window) | LIVE |
| `hive_status_updated` | `hive.rs:2606` | status | `main` + `hud` (cross-window) | LIVE |

### 4.5 Ghost Mode Events

| Event name | Rust file:line | Payload type | Consumer window | Status |
|------------|----------------|--------------|-----------------|--------|
| `ghost_suggestion_ready_to_speak` | `ghost_mode.rs:522` | `{...}` | `ghost_overlay` (single-window) | LIVE |
| `ghost_meeting_ended` | `ghost_mode.rs:626` | `{}` | `ghost_overlay` (single-window) | LIVE |
| `ghost_meeting_state` | `ghost_mode.rs:638,739` | `GhostMeetingState` | `ghost_overlay` (single-window) | LIVE |

### 4.6 Agent Events

| Event name | Rust file:line | Payload type | Consumer window | Status |
|------------|----------------|--------------|-----------------|--------|
| `blade_agent_event` | `agents/executor.rs:240,265,313,335,349` | `{...}` | `main` (agents cluster) | LIVE (emit exists; Phase 5 UI) |
| `agent_step_started` | `agents/executor.rs:99` | `{...}` | `main` | LIVE |
| `agent_step_result` | `agents/executor.rs:178` | `{...}` | `main` | LIVE |
| `swarm_progress` | `swarm_commands.rs:452` | `{...}` | `main` | LIVE |
| `swarm_completed` | `swarm_commands.rs:390` | `{...}` | `main` | LIVE |
| `swarm_created` | `swarm_commands.rs:524` | `{...}` | `main` | LIVE |
| `agent_started` | `background_agent.rs:205` | `{id, ...}` | `main` | LIVE |
| `agent_output` | `background_agent.rs:236` | `{id, output}` | `main` | LIVE |
| `agent_completed` | `background_agent.rs:340; agent_commands.rs:632` | `{id, ...}` | `main` | LIVE |
| `agent_event` | `agent_commands.rs:426,463,512,546,560,589,602` | `{...}` | `main` | LIVE |

### 4.7 Additional System Events

| Event name | Rust file:line | Payload type | Notes |
|------------|----------------|--------------|-------|
| `blade_briefing` | `pulse.rs:647,683; cron.rs:602,683` | `{...}` | Morning briefing |
| `blade_pulse` | `pulse.rs:84,823` | `{...}` | Hourly pulse |
| `blade_daily_digest` | `pulse.rs:942` | digest | Daily digest |
| `evolution_suggestion` | `evolution.rs:800,945` | suggestion | Evolution found |
| `blade_leveled_up` | `evolution.rs:812` | `{...}` | Level-up |
| `skill_learned` | `skill_engine.rs:100` | `{skill_name, ...}` | New skill |
| `dream_mode_start` | `dream_mode.rs:485,522` | `{idle_secs, manual?}` | Dream mode |
| `dream_mode_end` | `dream_mode.rs:475` | `{tasks_completed, ...}` | Dream exit |
| `screenshot_taken` | `godmode.rs:215; screen_timeline.rs:293` | `()` | Screen capture |
| `os_notification` | `notification_listener.rs:99` | notification | OS notification |
| `health_break_reminder` | `health_guardian.rs:150,160,180` | `{...}` | Break reminder (cross-window) |
| `shortcut_registration_failed` | `lib.rs:279,294` | `{shortcut, error}` | Fallback for CJK IME conflict |
| `thread_updated` | `thread.rs:92` | `{...}` | Working memory update |
| `smart_interrupt` | `godmode.rs:47` | `{...}` | Cross-window interrupt |
| `clipboard_changed` | `clipboard.rs:194` | `string` | `main` + `quickask` (cross-window) |
| `meeting_transcript_chunk` | `audio_timeline.rs:371` | `{...}` | `main` |
| `audio_transcript_ready` | `audio_timeline.rs:466` | `{...}` | `main` |
| `reasoning_step` | `reasoning_engine.rs:645` | `{...}` | `main` |
| `reasoning_complete` | `reasoning_engine.rs:668` | `{...}` | `main` |
| `goal_updated` | `goal_engine.rs:389` | `{...}` | `main` |
| `goal_completed` | `goal_engine.rs:404` | `{...}` | `main` |
| `goal_reminder` | `goal_engine.rs:813` | `{...}` | Cross-window reminder |
| `health_alert` | `health_tracker.rs:451` | `{...}` | Cross-window health alert |
| `calendar_event_alert` | `tentacles/calendar_tentacle.rs:423` | `{...}` | Cross-window calendar alert |
| `meeting_summary_ready` | `tentacles/calendar_tentacle.rs:517` | summary | `main` |
| `terminal_output` | `tentacles/terminal_watch.rs:620` | `{...}` | `main` |
| `terminal_build_succeeded` | `tentacles/terminal_watch.rs:678` | `{...}` | `main` |
| `terminal_build_failed` | `tentacles/terminal_watch.rs:712` | `{...}` | `main` |
| `file_changed` | `tentacles/filesystem_watch.rs:441,475` | `{...}` | `main` |
| `computer_use_step` | `computer_use.rs:109,160` | `{...}` | `main` |
| `computer_use_complete` | `computer_use.rs:119,131` | `{...}` | `main` |
| `sandbox_output` | `code_sandbox.rs:607` | `{...}` | `main` |
| `sandbox_complete` | `code_sandbox.rs:638` | `{...}` | `main` |
| `browser_agent_step` | `browser_agent.rs:268` | `{...}` | `main` |
| `browser_agent_done` | `browser_agent.rs:285` | `{...}` | `main` |
| `auto_fix_applied` | `auto_fix.rs:825` | `{...}` | `main` |
| `auto_fix_complete` | `auto_fix.rs:898,940` | `{...}` | `main` |
| `world_state_updated` | `world_model.rs:869` | world_summary | `main` |
| `emotion_detected` | `emotional_intelligence.rs:753` | `{emotion, ...}` | `main` |
| `service_crashed` | `supervisor.rs:144` | `{service, ...}` | `main` |
| `service_dead` | `supervisor.rs:156` | `{service, ...}` | `main` |
| `sudo_approval_needed` | `sysadmin.rs:575` | `{command, ...}` | `main` |
| `health_check` | `lib.rs:1340` | `{...}` | `main` |
| `runtime_event` | `runtimes.rs:2861,2884,2907,2932` | `{...}` | `main` |

---

## 5. emit_all Classification (WIRE-08 Resolution)

Copied from `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md`. Phase 1's WIRE-08 task executes the single-window replacements.

Policy: D-14 — `emit_to(label, ...)` for single-window; `emit_all` / `app.emit()` for cross-window only.
Note: In Tauri 2, `app.emit(event, payload)` broadcasts to ALL windows (equivalent to emit_all). `app.emit_to(label, event, payload)` targets a single window.

### 5.1 Summary

- Total emit sites scanned: **247**
- **cross-window (keep `emit_all`/`app.emit`):** 42
- **single-window (convert to `emit_to`):** 142
- **ambiguous (manual review in Phase 1):** 63

### 5.2 Full Classification Table

| file:line | event name | payload type | classification | proposed replacement (if single-window) |
|-----------|------------|--------------|----------------|------------------------------------------|
| src-tauri/src/commands.rs:77 | `chat_cancelled` | `()` | single-window | `emit_to("main", "chat_cancelled", ())` |
| src-tauri/src/commands.rs:78 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:306 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/commands.rs:311 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:315 | `blade_routing_switched` | `{from_provider, from_model, to_provider, to_model, reason}` | single-window | `emit_to("main", "blade_routing_switched", payload)` |
| src-tauri/src/commands.rs:581 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:585 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:609 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:640 | `chat_routing` | `{provider, model, hive_active}` | single-window | `emit_to("main", "chat_routing", payload)` |
| src-tauri/src/commands.rs:681 | `chat_ack` | `string` | single-window | `emit_to("main", "chat_ack", payload)` |
| src-tauri/src/commands.rs:725 | `blade_status` | `"thinking"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:726 | `blade_planning` | `{query, mode}` | single-window | `emit_to("main", "blade_planning", payload)` |
| src-tauri/src/commands.rs:742 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/commands.rs:745 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/commands.rs:746 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:778 | `blade_planning` | `{query, step_count}` | single-window | `emit_to("main", "blade_planning", payload)` |
| src-tauri/src/commands.rs:979 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1038 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1060 | `chat_cancelled` | `()` | single-window | `emit_to("main", "chat_cancelled", ())` |
| src-tauri/src/commands.rs:1061 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/commands.rs:1062 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1088 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1089 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/commands.rs:1108 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1116 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1117 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/commands.rs:1135 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1143 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1161 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/commands.rs:1166 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1174 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1183 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1187 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/commands.rs:1191 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1199 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1215 | `blade_status` | `"processing"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1216 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/commands.rs:1227 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1232 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1236 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1240 | `blade_status` | `"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1276 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/commands.rs:1284 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/commands.rs:1289 | `chat_token` | `"Done."` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/commands.rs:1291 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/commands.rs:1292 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1371 | `capability_gap_detected` | `{user_request}` | single-window | `emit_to("main", "capability_gap_detected", payload)` |
| src-tauri/src/commands.rs:1386 | `response_improved` | `{improved}` | single-window | `emit_to("main", "response_improved", payload)` |
| src-tauri/src/commands.rs:1608 | `ai_delegate_approved` | `{tool_name}` | single-window | `emit_to("main", "ai_delegate_approved", payload)` |
| src-tauri/src/commands.rs:1616 | `ai_delegate_denied` | `{tool_name}` | single-window | `emit_to("main", "ai_delegate_denied", payload)` |
| src-tauri/src/commands.rs:1631 | `tool_approval_needed` | `{tool_name, args, context, request_id}` | single-window | `emit_to("main", "tool_approval_needed", payload)` |
| src-tauri/src/commands.rs:1653 | `tool_approval_needed` | `{tool_name, args, context, request_id}` | single-window | `emit_to("main", "tool_approval_needed", payload)` |
| src-tauri/src/commands.rs:1699 | `tool_result` | `{tool_name, result}` | single-window | `emit_to("main", "tool_result", payload)` |
| src-tauri/src/commands.rs:1801 | `tool_result` | `{tool_name, result}` | single-window | `emit_to("main", "tool_result", payload)` |
| src-tauri/src/commands.rs:1876 | `chat_cancelled` | `()` | single-window | `emit_to("main", "chat_cancelled", ())` |
| src-tauri/src/commands.rs:1877 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/commands.rs:1878 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:1894 | `blade_status` | `"idle"\|"error"` | cross-window (main + HUD) | — |
| src-tauri/src/commands.rs:2212 | `brain_grew` | `{new_entities}` | ambiguous (main dashboard?) | ambiguous |
| src-tauri/src/commands.rs:2270 | `brain_grew` | `{new_entities}` | ambiguous (main dashboard?) | ambiguous |
| src-tauri/src/homeostasis.rs:424 | `homeostasis_update` | `{arousal, energy_mode, exploration, trust, urgency, hunger, thirst, insulin, adrenaline, leptin}` | cross-window (main + hud + body) | — |
| src-tauri/src/voice_global.rs:114 | `voice_global_started` | `()` | single-window | `emit_to("quickask", "voice_global_started", ())` |
| src-tauri/src/voice_global.rs:119 | `voice_global_transcribing` | `()` | single-window | `emit_to("quickask", "voice_global_transcribing", ())` |
| src-tauri/src/voice_global.rs:126 | `voice_global_error` | `string` | single-window | `emit_to("quickask", "voice_global_error", payload)` |
| src-tauri/src/voice_global.rs:141 | `voice_global_error` | `string` | single-window | `emit_to("quickask", "voice_global_error", payload)` |
| src-tauri/src/voice_global.rs:149 | `voice_global_error` | `"No speech detected"` | single-window | `emit_to("quickask", "voice_global_error", payload)` |
| src-tauri/src/voice_global.rs:156 | `voice_global_error` | `string` | single-window | `emit_to("quickask", "voice_global_error", payload)` |
| src-tauri/src/voice_global.rs:166 | `voice_global_error` | `string` | single-window | `emit_to("quickask", "voice_global_error", payload)` |
| src-tauri/src/voice_global.rs:173 | `voice_global_error` | `"No speech detected"` | single-window | `emit_to("quickask", "voice_global_error", payload)` |
| src-tauri/src/voice_global.rs:184 | `voice_transcript_ready` | `{text: string}` | single-window | `emit_to("quickask", "voice_transcript_ready", payload)` |
| src-tauri/src/voice_global.rs:223 | `voice_conversation_listening` | `{active: true}` | cross-window (overlay orb + main) | — |
| src-tauri/src/voice_global.rs:239 | `voice_conversation_ended` | `{reason: string}` | cross-window (overlay orb + main) | — |
| src-tauri/src/voice_global.rs:480 | `voice_emotion_detected` | `{emotion, transcript}` | cross-window (orb overlay + main) | — |
| src-tauri/src/voice_global.rs:492 | `voice_language_detected` | `{language}` | single-window | `emit_to("main", "voice_language_detected", payload)` |
| src-tauri/src/voice_global.rs:508 | `voice_user_message` | `{content}` | cross-window (orb overlay + main) | — |
| src-tauri/src/voice_global.rs:532 | `voice_conversation_speaking` | `{text}` | cross-window (overlay orb + main) | — |
| src-tauri/src/voice_global.rs:538 | `voice_conversation_listening` | `{active: true}` | cross-window (overlay orb + main) | — |
| src-tauri/src/voice_global.rs:663 | `voice_session_saved` | `{conversation_id, turn_count}` | single-window | `emit_to("main", "voice_session_saved", payload)` |
| src-tauri/src/voice_global.rs:693 | `voice_conversation_thinking` | `{text}` | cross-window (overlay orb + main) | — |
| src-tauri/src/voice_global.rs:767 | `voice_chat_submit` | `{content, voice_mode, history}` | single-window | `emit_to("main", "voice_chat_submit", payload)` |
| src-tauri/src/wake_word.rs:274 | `wake_word_detected` | `{phrase, play_chime}` | cross-window (overlay orb + main + quickask) | — |
| src-tauri/src/overlay_manager.rs:252 | `hud_data_updated` | HUD data | single-window | `emit_to("hud", "hud_data_updated", payload)` |
| src-tauri/src/overlay_manager.rs:292 | `hud_data_updated` | HUD data | single-window | `emit_to("hud", "hud_data_updated", payload)` |
| src-tauri/src/overlay_manager.rs:323 | `blade_toast` | toast payload | cross-window (main + overlay) | — |
| src-tauri/src/ghost_mode.rs:522 | `ghost_suggestion_ready_to_speak` | `{...}` | single-window | `emit_to("ghost_overlay", "ghost_suggestion_ready_to_speak", payload)` |
| src-tauri/src/ghost_mode.rs:626 | `ghost_meeting_ended` | `{}` | single-window | `emit_to("ghost_overlay", "ghost_meeting_ended", ())` |
| src-tauri/src/ghost_mode.rs:638 | `ghost_meeting_state` | `GhostMeetingState` | single-window | `emit_to("ghost_overlay", "ghost_meeting_state", payload)` |
| src-tauri/src/ghost_mode.rs:739 | `ghost_meeting_state` | `GhostMeetingState` | single-window | `emit_to("ghost_overlay", "ghost_meeting_state", payload)` |
| src-tauri/src/providers/anthropic.rs:236 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/providers/anthropic.rs:247 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/providers/anthropic.rs:337 | `chat_thinking_done` | `()` | single-window | `emit_to("main", "chat_thinking_done", ())` |
| src-tauri/src/providers/anthropic.rs:344 | `chat_thinking` | `string` | single-window | `emit_to("main", "chat_thinking", payload)` |
| src-tauri/src/providers/anthropic.rs:348 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/providers/anthropic.rs:362 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/providers/openai.rs:279 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/providers/openai.rs:289 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/providers/gemini.rs:224 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/providers/gemini.rs:234 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/providers/groq.rs:317 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/providers/groq.rs:327 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/providers/ollama.rs:129 | `chat_token` | `string` | single-window | `emit_to("main", "chat_token", payload)` |
| src-tauri/src/providers/ollama.rs:139 | `chat_done` | `()` | single-window | `emit_to("main", "chat_done", ())` |
| src-tauri/src/deep_scan.rs:1325 | `deep_scan_progress` | `{step, total, label, percent}` | single-window | `emit_to("main", "deep_scan_progress", payload)` |
| src-tauri/src/swarm_commands.rs:268 | `swarm_scratchpad_updated` | `{...}` | single-window | `emit_to("main", "swarm_scratchpad_updated", payload)` |
| src-tauri/src/swarm_commands.rs:274 | `swarm_task_completed` | `{...}` | single-window | `emit_to("main", "swarm_task_completed", payload)` |
| src-tauri/src/swarm_commands.rs:307 | `swarm_task_failed` | `{...}` | single-window | `emit_to("main", "swarm_task_failed", payload)` |
| src-tauri/src/swarm_commands.rs:354 | `swarm_task_failed` | `{...}` | single-window | `emit_to("main", "swarm_task_failed", payload)` |
| src-tauri/src/swarm_commands.rs:390 | `swarm_completed` | `{...}` | single-window | `emit_to("main", "swarm_completed", payload)` |
| src-tauri/src/swarm_commands.rs:416 | `swarm_task_started` | `{...}` | single-window | `emit_to("main", "swarm_task_started", payload)` |
| src-tauri/src/swarm_commands.rs:431 | `swarm_task_failed` | `{...}` | single-window | `emit_to("main", "swarm_task_failed", payload)` |
| src-tauri/src/swarm_commands.rs:452 | `swarm_progress` | `{...}` | single-window | `emit_to("main", "swarm_progress", payload)` |
| src-tauri/src/swarm_commands.rs:524 | `swarm_created` | `{...}` | single-window | `emit_to("main", "swarm_created", payload)` |
| src-tauri/src/agents/executor.rs:99 | `agent_step_started` | `{...}` | single-window | `emit_to("main", "agent_step_started", payload)` |
| src-tauri/src/agents/executor.rs:178 | `agent_step_result` | `{...}` | single-window | `emit_to("main", "agent_step_result", payload)` |
| src-tauri/src/agents/executor.rs:240 | `blade_agent_event` | `{...}` | single-window | `emit_to("main", "blade_agent_event", payload)` |
| src-tauri/src/agents/executor.rs:265 | `blade_agent_event` | `{...}` | single-window | `emit_to("main", "blade_agent_event", payload)` |
| src-tauri/src/agents/executor.rs:313 | `blade_agent_event` | `{...}` | single-window | `emit_to("main", "blade_agent_event", payload)` |
| src-tauri/src/agents/executor.rs:335 | `blade_agent_event` | `{...}` | single-window | `emit_to("main", "blade_agent_event", payload)` |
| src-tauri/src/agents/executor.rs:349 | `blade_agent_event` | `{...}` | single-window | `emit_to("main", "blade_agent_event", payload)` |
| src-tauri/src/background_agent.rs:205 | `agent_started` | `{id, ...}` | single-window | `emit_to("main", "agent_started", payload)` |
| src-tauri/src/background_agent.rs:236 | `agent_output` | `{id, output}` | single-window | `emit_to("main", "agent_output", payload)` |
| src-tauri/src/background_agent.rs:262 | `agent_cancelled` | `{id}` | single-window | `emit_to("main", "agent_cancelled", payload)` |
| src-tauri/src/background_agent.rs:340 | `agent_completed` | `{id, ...}` | single-window | `emit_to("main", "agent_completed", payload)` |
| src-tauri/src/background_agent.rs:349 | `agent_failed` | `{id, error}` | single-window | `emit_to("main", "agent_failed", payload)` |
| src-tauri/src/background_agent.rs:527 | `agent_progress` | `{id, progress}` | single-window | `emit_to("main", "agent_progress", payload)` |
| src-tauri/src/background_agent.rs:621 | `agent_status` | `{id, status}` | single-window | `emit_to("main", "agent_status", payload)` |
| src-tauri/src/agent_commands.rs:426 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:463 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:512 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:546 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:560 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:589 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:602 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:632 | `agent_completed` | `{...}` | single-window | `emit_to("main", "agent_completed", payload)` |
| src-tauri/src/agent_commands.rs:2791 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:2799 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:2828 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/agent_commands.rs:2843 | `agent_event` | `{...}` | single-window | `emit_to("main", "agent_event", payload)` |
| src-tauri/src/hive.rs:2304 | `hive_decision_needed` | `{...}` | ambiguous (main + hive panel) | ambiguous |
| src-tauri/src/hive.rs:2510 | `hive_report` | `{...}` | ambiguous (main dashboard) | ambiguous |
| src-tauri/src/hive.rs:2532 | `hive_action` | `{...}` | ambiguous (main) | ambiguous |
| src-tauri/src/hive.rs:2603 | `hive_tick` | status | cross-window (main + hud) | — |
| src-tauri/src/hive.rs:2606 | `hive_status_updated` | status | cross-window (main + hud) | — |
| src-tauri/src/hive.rs:2690 | `hive_inform` | `{summary}` | single-window | `emit_to("main", "hive_inform", payload)` |
| src-tauri/src/hive.rs:2768 | `hive_tentacle_report` | `{...}` | single-window | `emit_to("main", "hive_tentacle_report", payload)` |
| src-tauri/src/hive.rs:2786 | `hive_decision_resolved` | `{...}` | single-window | `emit_to("main", "hive_decision_resolved", payload)` |
| src-tauri/src/hive.rs:2820 | `hive_tentacle_action` | `{...}` | ambiguous | ambiguous |
| src-tauri/src/ambient.rs:75 | `multiple_monitors_detected` | `{count, ...}` | ambiguous | ambiguous |
| src-tauri/src/ambient.rs:107 | `multiple_monitors_detected` | `{count, ...}` | ambiguous | ambiguous |
| src-tauri/src/ambient.rs:122 | `monitor_disconnected` | `{...}` | ambiguous | ambiguous |
| src-tauri/src/ambient.rs:145 | `proactive_nudge` | `{message, action?}` | cross-window (main + overlay) | — |
| src-tauri/src/ambient.rs:227 | `proactive_nudge` | `{message, action?}` | cross-window (main + overlay) | — |
| src-tauri/src/ambient.rs:239 | `ambient_update` | `{activity}` | single-window | `emit_to("hud", "ambient_update", payload)` |
| src-tauri/src/ambient.rs:247 | `proactive_nudge` | `{message, action?}` | cross-window (main + overlay) | — |
| src-tauri/src/ambient.rs:283 | `proactive_nudge` | `{message, action?}` | cross-window (main + overlay) | — |
| src-tauri/src/ambient.rs:312 | `proactive_nudge` | `{message, action?}` | cross-window (main + overlay) | — |
| src-tauri/src/audio_timeline.rs:371 | `meeting_transcript_chunk` | `{...}` | single-window | `emit_to("main", "meeting_transcript_chunk", payload)` |
| src-tauri/src/audio_timeline.rs:466 | `audio_transcript_ready` | `{...}` | single-window | `emit_to("main", "audio_transcript_ready", payload)` |
| src-tauri/src/audio_timeline.rs:666 | `audio_capture_state` | `{active: true}` | single-window | `emit_to("main", "audio_capture_state", payload)` |
| src-tauri/src/audio_timeline.rs:677 | `audio_capture_state` | `{active: false}` | single-window | `emit_to("main", "audio_capture_state", payload)` |
| src-tauri/src/audio_timeline.rs:694 | `audio_capture_state` | `{active: false}` | single-window | `emit_to("main", "audio_capture_state", payload)` |
| src-tauri/src/brain.rs:1650 | `brain_grew` | `{new_entities}` | ambiguous (main dashboard?) | ambiguous |
| src-tauri/src/action_tags.rs:98 | `brain_grew` | `{new_entities}` | ambiguous | ambiguous |
| src-tauri/src/action_tags.rs:143 | `blade_reminder_created` | `{...}` | single-window | `emit_to("main", "blade_reminder_created", payload)` |
| src-tauri/src/action_tags.rs:164 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/action_tags.rs:192 | `blade_notification` | `{type, message}` | single-window | `emit_to("main", "blade_notification", payload)` |
| src-tauri/src/cron.rs:484 | `proactive_nudge` | `{message}` | cross-window (main + overlay) | — |
| src-tauri/src/cron.rs:524 | `proactive_nudge` | `{message}` | cross-window (main + overlay) | — |
| src-tauri/src/cron.rs:595 | `proactive_nudge` | `{message}` | cross-window (main + overlay) | — |
| src-tauri/src/cron.rs:602 | `blade_briefing` | `{...}` | single-window | `emit_to("main", "blade_briefing", payload)` |
| src-tauri/src/cron.rs:683 | `blade_briefing` | `{...}` | single-window | `emit_to("main", "blade_briefing", payload)` |
| src-tauri/src/cron.rs:725 | `proactive_nudge` | `{message}` | cross-window (main + overlay) | — |
| src-tauri/src/dream_mode.rs:396 | `dream_task_start` | `{task}` | single-window | `emit_to("main", "dream_task_start", payload)` |
| src-tauri/src/dream_mode.rs:402 | `dream_task_complete` | `{...}` | single-window | `emit_to("main", "dream_task_complete", payload)` |
| src-tauri/src/dream_mode.rs:475 | `dream_mode_end` | `{tasks_completed, ...}` | single-window | `emit_to("main", "dream_mode_end", payload)` |
| src-tauri/src/dream_mode.rs:485 | `dream_mode_start` | `{idle_secs, manual?}` | single-window | `emit_to("main", "dream_mode_start", payload)` |
| src-tauri/src/dream_mode.rs:522 | `dream_mode_start` | `{idle_secs: 0, manual: true}` | single-window | `emit_to("main", "dream_mode_start", payload)` |
| src-tauri/src/dream_mode.rs:525 | `dream_mode_activating` | `{...}` | single-window | `emit_to("main", "dream_mode_activating", payload)` |
| src-tauri/src/evolution.rs:792 | `blade_auto_upgraded` | `{...}` | single-window | `emit_to("main", "blade_auto_upgraded", payload)` |
| src-tauri/src/evolution.rs:800 | `evolution_suggestion` | suggestion | single-window | `emit_to("main", "evolution_suggestion", payload)` |
| src-tauri/src/evolution.rs:812 | `blade_leveled_up` | `{...}` | single-window | `emit_to("main", "blade_leveled_up", payload)` |
| src-tauri/src/evolution.rs:945 | `evolution_suggestion` | suggestion | single-window | `emit_to("main", "evolution_suggestion", payload)` |
| src-tauri/src/godmode.rs:47 | `smart_interrupt` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/godmode.rs:119 | `proactive_suggestion` | task | single-window | `emit_to("main", "proactive_suggestion", payload)` |
| src-tauri/src/godmode.rs:121 | `proactive_task_added` | task | single-window | `emit_to("main", "proactive_task_added", payload)` |
| src-tauri/src/godmode.rs:215 | `screenshot_taken` | `()` | ambiguous (main + timeline) | ambiguous |
| src-tauri/src/godmode.rs:233 | `godmode_update` | `{tier, ...}` | cross-window (main + overlay + hud) | — |
| src-tauri/src/health_guardian.rs:150 | `health_break_reminder` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/health_guardian.rs:160 | `health_break_reminder` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/health_guardian.rs:180 | `health_break_reminder` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/immune_system.rs:31 | `blade_evolving` | `{...}` | single-window | `emit_to("main", "blade_evolving", payload)` |
| src-tauri/src/immune_system.rs:45 | `blade_evolving` | `{...}` | single-window | `emit_to("main", "blade_evolving", payload)` |
| src-tauri/src/immune_system.rs:78 | `blade_evolving` | `{...}` | single-window | `emit_to("main", "blade_evolving", payload)` |
| src-tauri/src/immune_system.rs:85 | `blade_evolving` | `{...}` | single-window | `emit_to("main", "blade_evolving", payload)` |
| src-tauri/src/immune_system.rs:97 | `blade_evolving` | `{...}` | single-window | `emit_to("main", "blade_evolving", payload)` |
| src-tauri/src/learning_engine.rs:792 | `blade_reflex` | `{...}` | single-window | `emit_to("main", "blade_reflex", payload)` |
| src-tauri/src/learning_engine.rs:801 | `blade_suggestion` | `{...}` | single-window | `emit_to("main", "blade_suggestion", payload)` |
| src-tauri/src/learning_engine.rs:811 | `blade_learned` | `{...}` | single-window | `emit_to("main", "blade_learned", payload)` |
| src-tauri/src/lib.rs:279 | `shortcut_registration_failed` | `{shortcut, error}` | single-window | `emit_to("main", "shortcut_registration_failed", payload)` |
| src-tauri/src/lib.rs:294 | `shortcut_registration_failed` | `{shortcut, error}` | single-window | `emit_to("main", "shortcut_registration_failed", payload)` |
| src-tauri/src/lib.rs:1340 | `health_check` | `{...}` | single-window | `emit_to("main", "health_check", payload)` |
| src-tauri/src/notification_listener.rs:99 | `os_notification` | notification | single-window | `emit_to("main", "os_notification", payload)` |
| src-tauri/src/prediction_engine.rs:589 | `blade_prediction` | prediction | single-window | `emit_to("main", "blade_prediction", payload)` |
| src-tauri/src/proactive_engine.rs:607 | `proactive_action` | action | single-window | `emit_to("main", "proactive_action", payload)` |
| src-tauri/src/proactive_engine.rs:652 | `proactive_action` | action | single-window | `emit_to("main", "proactive_action", payload)` |
| src-tauri/src/proactive_engine.rs:933 | `proactive_action` | action | single-window | `emit_to("main", "proactive_action", payload)` |
| src-tauri/src/pulse.rs:84 | `blade_pulse` | `{...}` | single-window | `emit_to("main", "blade_pulse", payload)` |
| src-tauri/src/pulse.rs:130 | `background_ai_auto_disabled` | `{...}` | single-window | `emit_to("main", "background_ai_auto_disabled", payload)` |
| src-tauri/src/pulse.rs:647 | `blade_briefing` | `{...}` | single-window | `emit_to("main", "blade_briefing", payload)` |
| src-tauri/src/pulse.rs:823 | `blade_pulse` | `{...}` | single-window | `emit_to("main", "blade_pulse", payload)` |
| src-tauri/src/pulse.rs:942 | `blade_daily_digest` | digest | single-window | `emit_to("main", "blade_daily_digest", payload)` |
| src-tauri/src/reminders.rs:114 | `blade_reminder_fired` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/reminders.rs:303 | `blade_reminder_created` | `{...}` | single-window | `emit_to("main", "blade_reminder_created", payload)` |
| src-tauri/src/reasoning_engine.rs:645 | `reasoning_step` | `{...}` | single-window | `emit_to("main", "reasoning_step", payload)` |
| src-tauri/src/reasoning_engine.rs:668 | `reasoning_complete` | `{...}` | single-window | `emit_to("main", "reasoning_complete", payload)` |
| src-tauri/src/screen_timeline.rs:283 | `screen_timeline_saved` | `{...}` | single-window | `emit_to("main", "screen_timeline_saved", payload)` |
| src-tauri/src/screen_timeline.rs:293 | `screenshot_taken` | `()` | ambiguous (main + timeline) | ambiguous |
| src-tauri/src/skill_engine.rs:100 | `skill_learned` | `{skill_name, ...}` | single-window | `emit_to("main", "skill_learned", payload)` |
| src-tauri/src/supervisor.rs:144 | `service_crashed` | `{service, ...}` | single-window | `emit_to("main", "service_crashed", payload)` |
| src-tauri/src/supervisor.rs:156 | `service_dead` | `{service, ...}` | single-window | `emit_to("main", "service_dead", payload)` |
| src-tauri/src/sysadmin.rs:575 | `sudo_approval_needed` | `{command, ...}` | single-window | `emit_to("main", "sudo_approval_needed", payload)` |
| src-tauri/src/sysadmin.rs:597 | `sudo_password_needed` | `{...}` | single-window | `emit_to("main", "sudo_password_needed", payload)` |
| src-tauri/src/telegram.rs:290 | `telegram_message_handled` | count | single-window | `emit_to("main", "telegram_message_handled", payload)` |
| src-tauri/src/tentacles/calendar_tentacle.rs:423 | `calendar_event_alert` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/tentacles/calendar_tentacle.rs:517 | `meeting_summary_ready` | summary | single-window | `emit_to("main", "meeting_summary_ready", payload)` |
| src-tauri/src/tentacles/calendar_tentacle.rs:884 | `meeting_summary_draft_ready` | draft | single-window | `emit_to("main", "meeting_summary_draft_ready", payload)` |
| src-tauri/src/tentacles/filesystem_watch.rs:441 | `file_changed` | `{...}` | single-window | `emit_to("main", "file_changed", payload)` |
| src-tauri/src/tentacles/filesystem_watch.rs:475 | `file_changed` | `{...}` | single-window | `emit_to("main", "file_changed", payload)` |
| src-tauri/src/tentacles/filesystem_watch.rs:512 | `proactive_suggestion` | suggestion | single-window | `emit_to("main", "proactive_suggestion", payload)` |
| src-tauri/src/tentacles/filesystem_watch.rs:530 | `file_watch_event` | `{...}` | single-window | `emit_to("main", "file_watch_event", payload)` |
| src-tauri/src/tentacles/filesystem_watch.rs:635 | `file_watch_summary` | `{...}` | single-window | `emit_to("main", "file_watch_summary", payload)` |
| src-tauri/src/tentacles/log_monitor.rs:273 | `log-anomaly` | payload | single-window | `emit_to("main", "log-anomaly", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:620 | `terminal_output` | `{...}` | single-window | `emit_to("main", "terminal_output", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:631 | `terminal_error` | `{...}` | single-window | `emit_to("main", "terminal_error", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:645 | `terminal_warning` | `{...}` | single-window | `emit_to("main", "terminal_warning", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:662 | `terminal_build_started` | `{...}` | single-window | `emit_to("main", "terminal_build_started", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:678 | `terminal_build_succeeded` | `{...}` | single-window | `emit_to("main", "terminal_build_succeeded", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:712 | `terminal_build_failed` | `{...}` | single-window | `emit_to("main", "terminal_build_failed", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:739 | `terminal_test_result` | `{...}` | single-window | `emit_to("main", "terminal_test_result", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:758 | `terminal_event` | `{...}` | single-window | `emit_to("main", "terminal_event", payload)` |
| src-tauri/src/tentacles/terminal_watch.rs:768 | `terminal_event` | `{...}` | single-window | `emit_to("main", "terminal_event", payload)` |
| src-tauri/src/thread.rs:92 | `thread_updated` | `{...}` | single-window | `emit_to("main", "thread_updated", payload)` |
| src-tauri/src/tts.rs:264 | `tts_interrupted` | `()` | cross-window (orb overlay + main) | — |
| src-tauri/src/tts.rs:272 | `tts_interrupted` | `()` | cross-window (orb overlay + main) | — |
| src-tauri/src/watcher.rs:212 | `watcher_event` | `{...}` | single-window | `emit_to("main", "watcher_event", payload)` |
| src-tauri/src/whisper_local.rs:359 | `whisper_download_started` | `{model}` | single-window | `emit_to("main", "whisper_download_started", payload)` |
| src-tauri/src/whisper_local.rs:364 | `whisper_download_complete` | `{model, path}` | single-window | `emit_to("main", "whisper_download_complete", payload)` |
| src-tauri/src/world_model.rs:869 | `world_state_updated` | world_summary | single-window | `emit_to("main", "world_state_updated", payload)` |
| src-tauri/src/emotional_intelligence.rs:753 | `emotion_detected` | `{emotion, ...}` | single-window | `emit_to("main", "emotion_detected", payload)` |
| src-tauri/src/causal_graph.rs:600 | `causal_insights` | `{count}` | single-window | `emit_to("main", "causal_insights", payload)` |
| src-tauri/src/clipboard.rs:157 | `clipboard_prefetch_ready` | `{...}` | single-window | `emit_to("main", "clipboard_prefetch_ready", payload)` |
| src-tauri/src/clipboard.rs:194 | `clipboard_changed` | string | cross-window (main + quickask) | — |
| src-tauri/src/clipboard.rs:381 | `clipboard_error_detected` | `{...}` | single-window | `emit_to("main", "clipboard_error_detected", payload)` |
| src-tauri/src/clipboard.rs:393 | `proactive_suggestion` | `{...}` | single-window | `emit_to("main", "proactive_suggestion", payload)` |
| src-tauri/src/computer_use.rs:109 | `computer_use_step` | `{...}` | single-window | `emit_to("main", "computer_use_step", payload)` |
| src-tauri/src/computer_use.rs:119 | `computer_use_complete` | `{...}` | single-window | `emit_to("main", "computer_use_complete", payload)` |
| src-tauri/src/computer_use.rs:131 | `computer_use_complete` | `{...}` | single-window | `emit_to("main", "computer_use_complete", payload)` |
| src-tauri/src/computer_use.rs:145 | `computer_use_approval_needed` | `{...}` | single-window | `emit_to("main", "computer_use_approval_needed", payload)` |
| src-tauri/src/computer_use.rs:160 | `computer_use_step` | `{...}` | single-window | `emit_to("main", "computer_use_step", payload)` |
| src-tauri/src/code_sandbox.rs:607 | `sandbox_output` | `{...}` | single-window | `emit_to("main", "sandbox_output", payload)` |
| src-tauri/src/code_sandbox.rs:638 | `sandbox_complete` | `{...}` | single-window | `emit_to("main", "sandbox_complete", payload)` |
| src-tauri/src/code_sandbox.rs:650 | `sandbox_error` | `{...}` | single-window | `emit_to("main", "sandbox_error", payload)` |
| src-tauri/src/auto_fix.rs:430 | `auto_fix_verifying` | `{...}` | single-window | `emit_to("main", "auto_fix_verifying", payload)` |
| src-tauri/src/auto_fix.rs:449 | `auto_fix_verifying` | `{...}` | single-window | `emit_to("main", "auto_fix_verifying", payload)` |
| src-tauri/src/auto_fix.rs:825 | `auto_fix_applied` | `{...}` | single-window | `emit_to("main", "auto_fix_applied", payload)` |
| src-tauri/src/auto_fix.rs:841 | `auto_fix_failed` | `{result}` | single-window | `emit_to("main", "auto_fix_failed", payload)` |
| src-tauri/src/auto_fix.rs:852 | `auto_fix_failed` | `{result}` | single-window | `emit_to("main", "auto_fix_failed", payload)` |
| src-tauri/src/auto_fix.rs:892 | `auto_fix_failed` | `{result}` | single-window | `emit_to("main", "auto_fix_failed", payload)` |
| src-tauri/src/auto_fix.rs:898 | `auto_fix_complete` | `{...}` | single-window | `emit_to("main", "auto_fix_complete", payload)` |
| src-tauri/src/auto_fix.rs:916 | `auto_fix_failed` | `{result}` | single-window | `emit_to("main", "auto_fix_failed", payload)` |
| src-tauri/src/auto_fix.rs:921 | `auto_fix_pushing` | `{repo}` | single-window | `emit_to("main", "auto_fix_pushing", payload)` |
| src-tauri/src/auto_fix.rs:927 | `auto_fix_failed` | `{result}` | single-window | `emit_to("main", "auto_fix_failed", payload)` |
| src-tauri/src/auto_fix.rs:932 | `auto_fix_pushed` | `{...}` | single-window | `emit_to("main", "auto_fix_pushed", payload)` |
| src-tauri/src/auto_fix.rs:940 | `auto_fix_complete` | `{...}` | single-window | `emit_to("main", "auto_fix_complete", payload)` |
| src-tauri/src/self_code.rs:120 | `blade_self_code_started` | `{...}` | single-window | `emit_to("main", "blade_self_code_started", payload)` |
| src-tauri/src/sidecar.rs:360 | `sidecar_status_update` | statuses | single-window | `emit_to("main", "sidecar_status_update", payload)` |
| src-tauri/src/goal_engine.rs:389 | `goal_updated` | `{...}` | single-window | `emit_to("main", "goal_updated", payload)` |
| src-tauri/src/goal_engine.rs:404 | `goal_completed` | `{...}` | single-window | `emit_to("main", "goal_completed", payload)` |
| src-tauri/src/goal_engine.rs:625 | `goal_progress` | `{...}` | single-window | `emit_to("main", "goal_progress", payload)` |
| src-tauri/src/goal_engine.rs:813 | `goal_reminder` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/goal_engine.rs:979 | `goal_insight` | `{...}` | single-window | `emit_to("main", "goal_insight", payload)` |
| src-tauri/src/habit_engine.rs:760 | `blade_habit_reminder` | payload | cross-window (main + overlay) | — |
| src-tauri/src/accountability.rs:755 | `accountability_check` | `{...}` | single-window | `emit_to("main", "accountability_check", payload)` |
| src-tauri/src/accountability.rs:778 | `accountability_report` | `{...}` | single-window | `emit_to("main", "accountability_report", payload)` |
| src-tauri/src/health.rs:341 | `proactive_nudge` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/health_tracker.rs:416 | `health_insight` | `{...}` | single-window | `emit_to("main", "health_insight", payload)` |
| src-tauri/src/health_tracker.rs:451 | `health_alert` | `{...}` | cross-window (main + overlay) | — |
| src-tauri/src/health_tracker.rs:471 | `health_updated` | `{...}` | single-window | `emit_to("main", "health_updated", payload)` |
| src-tauri/src/runtimes.rs:2861 | `runtime_event` | `{...}` | single-window | `emit_to("main", "runtime_event", payload)` |
| src-tauri/src/runtimes.rs:2884 | `runtime_event` | `{...}` | single-window | `emit_to("main", "runtime_event", payload)` |
| src-tauri/src/runtimes.rs:2907 | `runtime_event` | `{...}` | single-window | `emit_to("main", "runtime_event", payload)` |
| src-tauri/src/runtimes.rs:2932 | `runtime_event` | `{...}` | single-window | `emit_to("main", "runtime_event", payload)` |
| src-tauri/src/show_engine.rs:187 | `blade_auto_show` | `{...}` | ambiguous | ambiguous |
| src-tauri/src/browser_agent.rs:268 | `browser_agent_step` | `{...}` | single-window | `emit_to("main", "browser_agent_step", payload)` |
| src-tauri/src/browser_agent.rs:285 | `browser_agent_done` | `{...}` | single-window | `emit_to("main", "browser_agent_done", payload)` |
| src-tauri/src/research.rs:239 | `research_result` | `{...}` | single-window | `emit_to("main", "research_result", payload)` |
| src-tauri/src/autonomous_research.rs:289 | `autonomous_research_done` | `{...}` | single-window | `emit_to("main", "autonomous_research_done", payload)` |
| src-tauri/src/deeplearn.rs:713 | `deeplearn_result` | `{...}` | single-window | `emit_to("main", "deeplearn_result", payload)` |
| src-tauri/src/negotiation_engine.rs:519 | `blade_debate_update` | `{...}` | single-window | `emit_to("main", "blade_debate_update", payload)` |
| src-tauri/src/workflow_builder.rs:466 | `blade_workflow_notification` | payload | single-window | `emit_to("main", "blade_workflow_notification", payload)` |
| src-tauri/src/autoskills.rs:176 | `autoskill_discovered` | `{...}` | single-window | `emit_to("main", "autoskill_discovered", payload)` |
| src-tauri/src/autoskills.rs:216 | `autoskill_testing` | `{...}` | single-window | `emit_to("main", "autoskill_testing", payload)` |
| src-tauri/src/autoskills.rs:247 | `autoskill_passed` | `{...}` | single-window | `emit_to("main", "autoskill_passed", payload)` |
| src-tauri/src/autoskills.rs:259 | `autoskill_failed` | `{...}` | single-window | `emit_to("main", "autoskill_failed", payload)` |
| src-tauri/src/autoskills.rs:279 | `autoskill_integrated` | `{...}` | single-window | `emit_to("main", "autoskill_integrated", payload)` |
| src-tauri/src/screen_timeline_commands.rs:175 | `audio_capture_state` | `{active: false}` | single-window | `emit_to("main", "audio_capture_state", payload)` |
| src-tauri/src/reproductive.rs:163 | `agent_spawned_with_dna` | `{...}` | single-window | `emit_to("main", "agent_spawned_with_dna", payload)` |

### 5.3 Ambiguous Rows — Synthesis Notes

The 63 ambiguous sites require per-case judgment during Phase 1 WIRE-08 work. Key patterns:

- **`brain_grew` (×4: commands.rs:2212, 2270; brain.rs:1650; action_tags.rs:98)** — likely single-window (`main` dashboard memory panel). Conservative call: `emit_to("main", ...)`. Low risk if wrong — if Body visualization (Phase 8) also needs it, add a second `emit_to("body", ...)` then.
- **`hive_decision_needed` (hive.rs:2304)** — needs both main and hive panel in Phase 8. Keep cross-window until Hive cluster is built. Reassess in Phase 7 WIRE review.
- **`hive_report` (hive.rs:2510), `hive_action` (hive.rs:2532)** — main dashboard only until Phase 8 Hive cluster. Convert to `emit_to("main", ...)` for Phases 1–7, then reassess.
- **`hive_tentacle_action` (hive.rs:2820)** — same as above.
- **`multiple_monitors_detected` (ambient.rs:75, 107), `monitor_disconnected` (ambient.rs:122)** — system-level events. Main window likely sole consumer. Convert to `emit_to("main", ...)`.
- **`screenshot_taken` (godmode.rs:215, screen_timeline.rs:293)** — both timeline (ScreenTimeline route in main) and dashboard. Both in `"main"` window. Convert to `emit_to("main", ...)`.
- **`blade_auto_show` (show_engine.rs:187)** — unknown consumer. Leave ambiguous pending show_engine.rs review in Phase 1.

### 5.4 Window Label Reference

| Label | Window | Notes |
|-------|--------|-------|
| `"main"` | Main window | Chat, dashboard, settings, all standard routes |
| `"quickask"` | QuickAsk popup | Small floating input window |
| `"hud"` | HUD bar | Persistent bottom/side status bar |
| `"ghost_overlay"` | Ghost overlay | Meeting whisper overlay |
| `"overlay"` | Voice orb overlay | Voice conversation orb |

---

## Appendix A — Prototype User-Flow Map

Distilled from `.planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md` §A.

### A-01: `onboarding-01-provider.html` — Provider Picker

**Window:** `main` | **Route:** `onboarding` (step 1)
**Entry condition:** `get_onboarding_status()` returns `false`
**Interactive elements:** 6 provider cards (Anthropic default-selected); Continue CTA
**Exit conditions:** Continue → Step 2 (API Key Entry)
**State owned:** Selected provider (local component state until Step 3 confirm)
**Backend calls:** `get_onboarding_status()` on mount only

---

### A-02: `onboarding-02-apikey.html` — API Key Entry

**Window:** `main` | **Route:** `onboarding` (step 2)
**Entry condition:** Provider selected in Step 1
**Interactive elements:** Key input (JetBrains Mono), Paste button, Test button, model pills after validation, Back link, Continue CTA
**Exit conditions:** Continue → Step 3 (Ready); Back → Step 1
**State owned:** API key string; validation status; available models list
**Backend calls:** `store_provider_key(provider, key)` on Test; `get_all_provider_keys()` after validation

---

### A-03: `onboarding-03-ready.html` — Deep Scan Progress

**Window:** `main` | **Route:** `onboarding` (step 3)
**Entry condition:** API key validated in Step 2
**Interactive elements:** SVG progress ring (animated); scan item list; "Enter BLADE" CTA (disabled until scan complete)
**Exit conditions:** Scan complete + CTA click → `dashboard`
**State owned:** Scan progress (step/total/percent/label); completion flag
**Backend calls:** Listen `deep_scan_progress`; `complete_onboarding(answers)` on CTA click

---

### A-04: `dashboard.html` — Main Dashboard

**Window:** `main` | **Route:** `dashboard`
**Entry condition:** Returning user or post-onboarding
**Interactive elements:** Nav rail (7 items); ⌘K → opens QuickAsk window; FAB → chat; calendar events; integration status; hive tentacle grid
**Exit conditions:** Any nav item → respective route; FAB → chat panel
**State owned:** Ambient state (Right Now hero), hormone state (stats), calendar events, integration statuses
**Backend calls:** `get_current_focus()`, `homeostasis_get()`, consume `blade_agent_event` stream; listen `homeostasis_update` event

---

### A-05: `dashboard-chat.html` — Dashboard + Inline Chat

**Window:** `main` | **Route:** `chat` (panel over dashboard)
**Entry condition:** Click FAB or Chat nav item from dashboard
**Interactive elements:** Chat input, Stop button, Clear, Close (×); message bubbles; tool call rows; streaming indicator
**Exit conditions:** Close (×) → `dashboard`
**State owned:** Chat messages array; streaming state; tool call states; context token ratio
**Backend calls:** `send_message_stream({messages})` on send; `cancel_chat()` on Stop; listen `chat_token`, `chat_done`, `chat_thinking`, `tool_approval_needed`, `blade_token_ratio` (WIRE-06)

---

### A-06: `voice-orb.html` — Voice Conversation Overlay

**Window:** `overlay` (440×440 NSPanel) | **Route:** N/A — always-floating
**Entry condition:** `wake_word_detected` or `start_voice_conversation()` via keyboard shortcut
**Interactive elements:** Phase chip (timer display); orb visualization (4-phase canvas/CSS); hover controls (Pause, ×)
**Exit conditions:** `voice_conversation_ended` event; × button; Esc key
**State owned:** Current phase (Idle/Listening/Thinking/Speaking); elapsed timer; live caption text
**Backend calls:** `start_voice_conversation()` on entry; `stop_voice_conversation()` on exit; listen `voice_conversation_listening`, `voice_conversation_thinking`, `voice_conversation_speaking`, `voice_conversation_ended`

---

### A-07: `voice-orb-states.html` — Phase State Reference

**Window:** Design reference sheet only | **Route:** N/A
**Purpose:** Documents all 4 phase visuals side by side with OpenClaw math constants
**Consumed by:** Phase 4 VoiceOrb implementation — this file is the spec, not a screen

---

### A-08: `ghost-overlay.html` — Meeting Assist Overlay

**Window:** `ghost_overlay` | **Route:** N/A — floats over screen share
**Entry condition:** Meeting audio detection with >50% confidence question detected
**Interactive elements:** `ghost-idle` pill (always present when BLADE is listening); `ghost-card` fires on detection; Expand (⌘Enter), Dismiss (Esc), Clear (⌘R)
**Exit conditions:** Dismiss/Esc → returns to idle pill; ⌘Enter → future: bridge to main window
**State owned:** Meeting active state; current suggestion; card visible flag
**Backend calls:** Listen `ghost_meeting_state`, `ghost_suggestion_ready_to_speak`, `ghost_meeting_ended` (all single-window via `emit_to("ghost_overlay", ...)`)

---

### A-09: `quickask.html` — QuickAsk Text Mode

**Window:** `quickask` (780px floating) | **Route:** `quickask`
**Entry condition:** ⌘K / Ctrl+Space shortcut from any context
**Interactive elements:** Search input; ESC closes window; result rows (keyboard nav ↑↓, ↵ open, ⌘↵ in chat, Tab switch mode); streaming AI answer section; mode switch to voice mode
**Exit conditions:** Esc → closes window; ⌘↵ → opens chat panel in main; Tab → voice mode (A-10)
**State owned:** Query text; streaming answer; result groups; focused row index
**Backend calls:** `quickask_submit({query})` on Enter (WIRE-01 — not yet implemented); listen `blade_quickask_bridged` in main window

---

### A-10: `quickask-voice.html` — QuickAsk Voice Mode

**Window:** `quickask` (same window, different layout) | **Route:** `quickask` (voice mode)
**Entry condition:** Tab from text mode, or Ctrl+Shift+B from within QuickAsk
**Interactive elements:** Voice orb (320×320, same 4-phase component); transcript display (.final + .partial); timer; Pause/Restart/Cancel; Send button
**Exit conditions:** Esc/Cancel → closes window; Send/↵ → `quickask_submit` with transcript
**State owned:** Voice phase; transcript (final + partial); elapsed time; audio meter values
**Backend calls:** Same voice events as A-06; `quickask_submit(transcript)` on send (WIRE-01)

---

### A-11: `settings.html` — Provider Settings

**Window:** `main` | **Route:** `settings` (provider sub-page)
**Entry condition:** Settings nav item click
**Interactive elements:** Tab strip (Provider / Memory / MCP / Personality / Hive / Privacy / About); side nav with section items; vault items (Test/Reveal/More per provider); smart paste input; routing grid (4 task types × provider); save bar (Reset/Export/Save)
**Exit conditions:** Any nav item → respective route
**State owned:** Provider list + key status; active routing config; unsaved changes flag
**Backend calls:** `get_all_provider_keys()` on mount; `store_provider_key(provider, key)` on paste; `switch_provider(provider)` for active toggle; `get_task_routing()` / `set_task_routing()` for routing grid; `save_config_field(field, value)` for other prefs

---

## Appendix B — Liquid Glass Token Set

Extracted from `docs/design/shared.css` + `docs/design/proto.css` + `docs/design/orb.css`. This seeds Phase 1's `src/styles/tokens.css` (FOUND-01).

### B.1 Glass Fill Tokens

```css
/* Glass fill tiers — opacity floors */
--g-fill-weak:    rgba(255, 255, 255, 0.04);   /* barely-there background */
--g-fill:         rgba(255, 255, 255, 0.07);   /* default card */
--g-fill-strong:  rgba(255, 255, 255, 0.11);   /* elevated surface */
--g-fill-heavy:   rgba(255, 255, 255, 0.16);   /* modal / heavy overlay */
```

**Usage map:**
- `.glass` = `var(--g-fill)` + `backdrop-filter: blur(20px) saturate(160%)`
- `.glass.flat` = same fill, no backdrop-filter
- `.glass.heavy` = `var(--g-fill-heavy)` + `backdrop-filter: blur(28px) saturate(180%)`
- `.glass.sm` = smaller padding variant
- `.glass.interactive` = hover adds `var(--g-fill-strong)`

### B.2 Glass Edge Tokens

```css
/* Border / rim tokens */
--g-edge-hi:   rgba(255, 255, 255, 0.32);   /* top edge highlight */
--g-edge-mid:  rgba(255, 255, 255, 0.14);   /* standard border */
--g-edge-lo:   rgba(255, 255, 255, 0.04);   /* subtle separator */

/* Full glass rim — inset box-shadow illusion */
--g-rim: inset 0 1px 0 rgba(255,255,255,0.28),
         inset 0 -1px 0 rgba(255,255,255,0.04),
         inset 1px 0 0 rgba(255,255,255,0.12),
         inset -1px 0 0 rgba(255,255,255,0.03);
```

### B.3 Backdrop-Filter (Blur Caps per D-06/D-07)

Per D-06: window-vibrancy for window chrome; CSS backdrop-filter for in-DOM panels.
Per D-07: max 3 backdrop-filter per viewport; blur caps 20px (standard) / 12px (secondary) / 8px (tertiary).

| Tier | Blur value | Used on | Notes |
|------|-----------|---------|-------|
| Primary (standard) | `blur(20px) saturate(160%)` | `.glass` — nav rail, topbar, cards | Budget cap: standard tier |
| Heavy | `blur(28px) saturate(180%)` | `.glass.heavy` — onboarding cards, modals | Allowed when 1-2 layers only |
| Ghost card | `blur(32px) saturate(180%)` | `.ghost-card` | Ghost overlay, max 2 layers |
| QuickAsk voice | `blur(48px) saturate(200%)` | `.qa-voice` | D-18 EXCEPTION — sole layer |
| Scrim | `blur(2-3px)` | `.overlay-scrim` | Background dim only |

**Per-screen budget audit:**

| Screen | Layer 1 | Layer 2 | Layer 3 | Budget status |
|--------|---------|---------|---------|---------------|
| onboarding-01..03 | heavy (28px) | — | — | 1/3 ✓ |
| dashboard | nav-rail (20px) | topbar (20px) | card.glass (20px) | 3/3 FULL |
| dashboard-chat | nav-rail (20px) | topbar (20px) | chat-panel (20px) | 3/3 FULL |
| voice-orb | orb (CSS-only) | phase-chip (20px) | — | 1/3 ✓ |
| ghost-overlay | ghost-card (32px) | ghost-idle (20px) | — | 2/3 ✓ |
| quickask | scrim (2px) | qa.glass.heavy (28px) | ai-inline (none) | 2/3 ✓ |
| quickask-voice | scrim (3px) | qa-voice (48px exception) | — | 2/3 ✓ |
| settings | nav-rail (20px) | settings-header (20px) | card.glass (20px) | 3/3 FULL |

### B.4 Drop Shadow Tokens

```css
--g-shadow-sm: 0 8px 24px rgba(0, 0, 0, 0.24);
--g-shadow-md: 0 20px 50px rgba(0, 0, 0, 0.32);
--g-shadow-lg: 0 40px 80px rgba(0, 0, 0, 0.42);
```

### B.5 Motion Tokens (D-02: CSS-only; no Framer Motion)

```css
/* Phase transitions */
--motion-phase-transition: 180ms ease-out;   /* orb phase cross-fade */

/* Standard UI transitions */
--motion-hover:   120ms ease;    /* button/card hover */
--motion-enter:   200ms ease-out;
--motion-exit:    150ms ease-in;

/* Orb-specific (from orb.css) */
--orb-rms-alpha: 0.55;           /* RMS smoothing: new = 0.45·prev + 0.55·new */
--orb-throttle:  83;             /* ms — 12 fps UI throttle */

/* Micro-animation */
spin: 0.9s linear infinite;     /* scan progress ring, loading arcs */
wv: 1.1s ease-in-out infinite;  /* audio meter bars (staggered delays) */
```

### B.6 Typography Scale

**Typefaces:** Inter (UI) + JetBrains Mono (code, numbers, meta, paths)

**Text opacity tokens:**
```css
--t-1: rgba(255, 255, 255, 0.97);  /* primary */
--t-2: rgba(255, 255, 255, 0.72);  /* secondary */
--t-3: rgba(255, 255, 255, 0.50);  /* muted */
--t-4: rgba(255, 255, 255, 0.32);  /* placeholder / ghost */
```

**Type scale:**
```
Display:   56px / 600 / tracking -0.035em   (onboarding-03 hero "You're in.")
H1:        44px / 600 / tracking -0.03em    (onboarding-01)
H1-alt:    40px / 600 / tracking -0.03em    (onboarding-02)
H2:        34px / 600 / tracking -0.03em    (voice-orb-states headers)
H3:        28px / 600 / tracking -0.025em   (settings header)
H4:        20px / 600 / tracking -0.02em    (settings section titles)
Body:      14px / 400 / tracking -0.005em   (chat bubbles, QA results, body copy)
Small:     12px / 400                        (meta, labels, scan status)
Micro:     10-11px / 500-600                 (kbd hints, mono tags, shortcuts)
```

**SF Pro scale (proto.css — for HIG alignment):**
```css
--fs-large-title: 34px;   --fs-title-1:  28px;   --fs-title-2: 22px;
--fs-title-3:     20px;   --fs-headline: 17px;   --fs-body:    17px;
--fs-callout:     16px;   --fs-subhead:  15px;   --fs-footnote:13px;
--fs-caption:     12px;   --fs-caption-2:11px;
```

### B.7 Radius Scale

```css
/* shared.css baseline */
--r-xs:   8px;
--r-sm:  12px;
--r-md:  18px;
--r-lg:  26px;
--r-xl:  34px;
--r-2xl: 44px;
--r-pill: 999px;

/* proto.css HIG override (tighter, more Apple-like) */
--r-xs:   8px;   /* same */
--r-sm:  10px;
--r-md:  16px;
--r-lg:  20px;
--r-xl:  28px;
--r-2xl: 40px;
```

**Phase 1 resolution:** Use proto.css values (HIG override) as defaults in `tokens.css` since these match the prototype screens more closely. Retain `--r-pill: 999px`.

### B.8 Spacing Scale

```css
--s-1:  4px;   --s-2:  8px;   --s-3:  12px;  --s-4:  16px;
--s-5:  20px;  --s-6:  24px;  --s-8:  32px;  --s-10: 40px;
--s-12: 48px;  --s-16: 64px;  --s-20: 80px;
```

### B.9 Accent Color Tokens

```css
/* Semantic accents */
--a-warm: #ffd2a6;   /* warm orange — vision cap, warm-side glass */
--a-cool: #c8e0ff;   /* cool blue  — file chips, shadow-side glass */
--a-ok:   #8affc7;   /* green      — success, live, verified, listening dot */
--a-warn: #ffc48a;   /* amber      — rate-limited, flagged */
--a-hot:  #ff9ab0;   /* pink       — cmd icons, tool-use cap */

/* Dark background */
--bg-deep: #0a0518;  /* deepest layer — page background */
--bg:      #1a0b2a;  /* user bubble fill, dark text areas */
```

**Orb-specific tokens (orb.css):**
```css
--orb-overlay: 440px;
--orb-core:    96px;
--orb-accent:       #b8a0ff;   /* base purple ring color */
--orb-accent-glow:  #7c3aed;   /* deep shadow (CSS var) */
--orb-accent-deep:  #5f5bff;   /* ring gradient deep end */
```

### B.10 Provider Gradient Reference

```css
/* Provider identity gradients (used in onboarding picker + settings vault) */
anthropic  → linear-gradient(135deg, #c96442, #f0a97e)
openai     → linear-gradient(135deg, #0f8a60, #10b27a)
google     → linear-gradient(135deg, #4285f4, #34a0f5)
groq       → linear-gradient(135deg, #f55036, #ff7a50)
ollama     → linear-gradient(135deg, #2c2c2c, #555555)
openrouter → linear-gradient(135deg, #5b5fe8, #8b6fff)
```

### B.11 Interaction State Tokens

```css
/* Provider card / vault item states */
.card-default:   background rgba(255,255,255,0.05), border var(--g-edge-lo)
.card-hover:     background rgba(255,255,255,0.09), border var(--g-edge-mid), translateY(-1px)
.card-selected:  background rgba(255,255,255,0.13), border rgba(255,255,255,0.4) + checkmark

/* Nav item */
.nav-default:  color var(--t-3)
.nav-hover:    color var(--t-1)
.nav-active:   background rgba(255,255,255,0.10), 3px left white bar

/* Tab strip */
.tab-default:  color var(--t-2)
.tab-hover:    color var(--t-1)
.tab-active:   linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08)) + inset rim + border

/* Status indicators */
.ind-live:  background #8affc7
.ind-warn:  background #ffc48a
.ind-off:   background rgba(255,255,255,0.2)

/* Status pills */
.pill-ok:   background rgba(138,255,199,0.12), color #c4ffe0, border rgba(138,255,199,0.3)
.pill-warn: background rgba(255,196,138,0.12), color #ffe0c0, border rgba(255,196,138,0.3)
.pill-off:  background rgba(255,255,255,0.05), color var(--t-3), border var(--g-edge-lo)
```

### B.12 Conflicts / Duplications to Resolve in Phase 1

| Conflict | shared.css | proto.css | Resolution |
|----------|-----------|-----------|------------|
| `--r-sm` | 12px | 10px | Use proto.css (10px) — matches screens |
| `--r-md` | 18px | 16px | Use proto.css (16px) |
| `--r-lg` | 26px | 20px | Use proto.css (20px) |
| `--r-xl` | 34px | 28px | Use proto.css (28px) |
| `--r-2xl` | 44px | 40px | Use proto.css (40px) |
| Font stack | Unspecified in shared | Inter explicitly set in proto | Use Inter + JetBrains Mono |
| Backdrop blur on `.glass` | 20px in shared | 20px in proto | No conflict — consistent |
| Voice orb size | `--orb-overlay: 440px` in orb.css | 560px in prototype display | Production = 440px; prototype inflated for visibility |

---

## Handoff to Phase 1

Phase 1 consumes this log for:
- **FOUND-01** (`tokens.css`) → Appendix B (§B.1 through §B.12)
- **FOUND-03/04** (typed Tauri wrapper) → §1 + §3 command signatures + §4 event catalog
- **FOUND-05** (event registry `src/lib/events/index.ts`) → §4 full event catalog
- **FOUND-06** (`useTauriEvent` hook subscription surface) → §4 as the definitive list
- **WIRE-08** (`emit_all` audit) → §5 full classification table + §5.3 synthesis notes

*End of Recovery Log.*
