# Phase 0 — Backend Contract Extract

> Sources: `src-tauri/src/commands.rs`, `src-tauri/src/voice_global.rs`, `src-tauri/src/wake_word.rs`, `src-tauri/src/config.rs`, `src-tauri/src/homeostasis.rs`, `src-tauri/src/voice.rs`, `src-tauri/src/voice_intelligence.rs`, `src-tauri/src/voice_local.rs`
> D-17 enforced: no reference to `src.bak/`. D-19 enforced: no RECOVERY_LOG here.

---

## 1. QuickAsk Submission Path

### Command: `send_message_stream`

- **File:Line:** `src-tauri/src/commands.rs:558`
- **Signature:**
  ```rust
  pub async fn send_message_stream(
      app: tauri::AppHandle,
      state: tauri::State<'_, SharedMcpManager>,
      approvals: tauri::State<'_, ApprovalMap>,
      vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
      messages: Vec<ChatMessage>,
  ) -> Result<(), String>
  ```
- **Args:**

  | Arg | Type | Notes |
  |-----|------|-------|
  | `app` | `tauri::AppHandle` | Required for emit |
  | `state` | `SharedMcpManager` | MCP tool registry |
  | `approvals` | `ApprovalMap` | Pending tool approval gates |
  | `vector_store` | `SharedVectorStore` | Semantic search store |
  | `messages` | `Vec<ChatMessage>` | `[{role: string, content: string, image_base64?: string}]` |

- **Emits (ordered):**

  | Event | File:Line | Payload | Notes |
  |-------|-----------|---------|-------|
  | `blade_status` | `commands.rs:581` | `"processing"` | Start of each request |
  | `blade_status` | `commands.rs:585` | `"error"` | No API key |
  | `chat_routing` | `commands.rs:640` | `{provider, model, hive_active}` | Which model is active for this request |
  | `chat_ack` | `commands.rs:681` | `string` | Fast acknowledgement (cheap model, fired async) |
  | `blade_status` | `commands.rs:725` | `"thinking"` | Deep reasoning path |
  | `blade_planning` | `commands.rs:726` | `{query, mode: "deep_reasoning"}` | Reasoning engine active |
  | `blade_planning` | `commands.rs:778` | `{query, step_count}` | Brain planner active |
  | `chat_token` | `commands.rs:742,1276,1284,1289` | `string` | Streaming text chunks |
  | `chat_done` | `commands.rs:745,1291` | `()` | Stream complete |
  | `blade_status` | `commands.rs:746,979,1292` | `"idle"` | Normal completion |
  | `blade_status` | `commands.rs:1038,1108,1135` | `"error"` | API/tool errors |
  | `blade_notification` | `commands.rs:1089,1117` | `{type, message}` | User-visible retry info |
  | `blade_routing_switched` | `commands.rs:315` | `{from_provider, from_model, to_provider, to_model, reason}` | Free model fallback |
  | `chat_cancelled` | `commands.rs:77,1060,1876` | `()` | Cancel request |
  | `brain_grew` | `commands.rs:989,1323` | `{new_entities: number}` | Entity extraction completed |
  | `capability_gap_detected` | `commands.rs:1371` | `{user_request}` | Gap detection fired |
  | `response_improved` | `commands.rs:1386` | `{improved}` | Self-critique improvement |
  | `tool_approval_needed` | `commands.rs:1631,1653` | `{tool_name, args, context, request_id}` | Human approval gate |
  | `ai_delegate_approved` | `commands.rs:1608` | `{tool_name}` | AI delegate approved |
  | `ai_delegate_denied` | `commands.rs:1616` | `{tool_name}` | AI delegate denied |

- **Streaming providers also emit:**

  | Event | File:Line | Payload |
  |-------|-----------|---------|
  | `chat_token` | `providers/anthropic.rs:236,248,348` | `string` |
  | `chat_done` | `providers/anthropic.rs:247,362` | `()` |
  | `chat_thinking` | `providers/anthropic.rs:344` | `string` (extended thinking) |
  | `chat_thinking_done` | `providers/anthropic.rs:337` | `()` |
  | `chat_token` | `providers/openai.rs:279` | `string` |
  | `chat_done` | `providers/openai.rs:289` | `()` |
  | `chat_token` | `providers/gemini.rs:224` | `string` |
  | `chat_done` | `providers/gemini.rs:234` | `()` |
  | `chat_token` | `providers/groq.rs:317` | `string` |
  | `chat_done` | `providers/groq.rs:327` | `()` |
  | `chat_token` | `providers/ollama.rs:129` | `string` |
  | `chat_done` | `providers/ollama.rs:139` | `()` |

### Command: `cancel_chat`

- **File:Line:** `src-tauri/src/commands.rs:70`
- **Signature:** `pub fn cancel_chat(app: tauri::AppHandle)`
- **Effect:** Sets `CHAT_CANCEL = true`; emits `chat_cancelled` + `blade_status: "idle"`

### Command: `quickask_submit`

- **Status:** `STATUS: WIRE REQUIRED` — per WIRE-01 in STATE.md. No command named `quickask_submit` exists in `commands.rs`. The QuickAsk → Main bridge must route through `send_message_stream` + emit `blade_quickask_bridged` (D-11). The event `blade_quickask_bridged` does NOT currently exist in the codebase. Phase 3 stub + Phase 4 test required.

---

## 2. Voice Orb Driving Events

### Voice Commands

| Command | File:Line | Args | Return | Notes |
|---------|-----------|------|--------|-------|
| `start_voice_conversation` | `voice_global.rs:216` | `app: AppHandle` | `Result<(), String>` | Enters conversational mode |
| `stop_voice_conversation` | `voice_global.rs:246` | — | `()` | Sets `CONV_ACTIVE = false` |
| `voice_conversation_active` | `voice_global.rs:254` | — | `bool` | Query active status |
| `wake_word_start` | `wake_word.rs:356` | `app: AppHandle` | `Result<(), String>` | Requires `wake_word_enabled: true` in config |
| `wake_word_stop` | `wake_word.rs:365` | — | `()` | Stops listener |
| `wake_word_status` | `wake_word.rs:371` | — | `bool` | Is listener running |

### Voice Events (Orb Phase State Mapping)

| Event | File:Line | Payload | Orb Phase Driven |
|-------|-----------|---------|-----------------|
| `voice_global_started` | `voice_global.rs:114` | `()` | → **Listening** (PTT start) |
| `voice_global_transcribing` | `voice_global.rs:119` | `()` | → **Thinking** (transcribing) |
| `voice_global_error` | `voice_global.rs:126,141,149,156,166,173` | `string` | → **Idle** (error) |
| `voice_transcript_ready` | `voice_global.rs:184` | `{text: string}` | → opens QuickAsk, not orb state |
| `voice_conversation_listening` | `voice_global.rs:223,538` | `{active: true}` | → **Listening** |
| `voice_conversation_thinking` | `voice_global.rs:693` | `{text: string}` | → **Thinking** |
| `voice_conversation_speaking` | `voice_global.rs:532` | `{text: string}` | → **Speaking** |
| `voice_conversation_ended` | `voice_global.rs:239` | `{reason: "stopped"\|"no_mic"}` | → **Idle** |
| `voice_emotion_detected` | `voice_global.rs:480` | `{emotion: string, transcript: string}` | ambiguous (orb color accent?) |
| `voice_language_detected` | `voice_global.rs:492` | `{language: string}` | ambiguous |
| `voice_user_message` | `voice_global.rs:508` | `{content: string}` | cross-window (chat display) |
| `voice_session_saved` | `voice_global.rs:663` | `{conversation_id, turn_count}` | → no state change |
| `wake_word_detected` | `wake_word.rs:274` | `{phrase: string, play_chime: true}` | → **Listening** (triggers `start_voice_conversation`) |
| `voice_chat_submit` | `voice_global.rs:767` | `{content, voice_mode: true, history}` | Internal—frontend must listen to route to `send_message_stream` |

### Phase State Machine (from code analysis)

```
IDLE ──[wake_word_detected]──────────────────────────────► LISTENING
IDLE ──[voice_global_started (PTT)]──────────────────────► LISTENING
LISTENING ──[end of utterance / VAD silence ≥ 1s]────────► THINKING
THINKING ──[voice_conversation_thinking emitted]─────────► THINKING
THINKING ──[voice_conversation_speaking emitted]─────────► SPEAKING
SPEAKING ──[TTS complete, voice_conversation_listening]──► LISTENING
SPEAKING ──[user interrupts (500ms grace period)]────────► LISTENING
LISTENING ──[30s silence]────────────────────────────────► IDLE
LISTENING ──[stop phrase / stop_voice_conversation]──────► IDLE
ANY ──[voice_conversation_ended]─────────────────────────► IDLE
```

---

## 3. Onboarding Backend Wiring

### Command: `get_onboarding_status`

- **File:Line:** `src-tauri/src/commands.rs:2312`
- **Signature:** `pub fn get_onboarding_status() -> bool`
- **Return:** `bool` — `true` = persona onboarding complete (`config.persona_onboarding_complete`)
- **Note:** This is the PERSONA onboarding (5 questions). Separate from provider/API key setup.

### Command: `complete_onboarding`

- **File:Line:** `src-tauri/src/commands.rs:2325`
- **Signature:** `pub async fn complete_onboarding(answers: Vec<String>) -> Result<(), String>`
- **Return:** `Result<(), String>` — `Ok(())` on success
- **Args:** `answers: Vec<String>` — requires exactly 5 elements:

  | Index | Content |
  |-------|---------|
  | 0 | Name + role |
  | 1 | Current project / what they're building |
  | 2 | Tools / languages / stack |
  | 3 | Biggest goal |
  | 4 | Communication preference |

- **Side effects:** Writes `persona.md`, extracts traits to `persona_engine`, adds KG nodes, seeds `memory_blocks.human_block`, marks `config.persona_onboarding_complete = true`
- **Events emitted:** None directly. Downstream persona/memory updated silently.

### Deep Scan Commands

| Command | File:Line | Signature | Notes |
|---------|-----------|-----------|-------|
| `deep_scan_*` | `src-tauri/src/deep_scan.rs` | Various | 12 parallel system scanners (see deep_scan.rs) |
| Deep scan progress event | `deep_scan.rs:1325` | `app.emit("deep_scan_progress", {step, total, label, percent})` | Emitted per scan step |

### Onboarding Frontend Call Sequence Contract

```
Screen 1 (Provider Picker):
  → User selects provider
  → invoke("switch_provider", { provider, model? })   [config.rs:645]
  → (no navigation event emitted — frontend manages state)

Screen 2 (API Key Entry):
  → User pastes API key
  → invoke("store_provider_key", { provider, api_key })   [config.rs:636]
  → OR invoke("switch_provider", { provider })
  → invoke("get_all_provider_keys")   [config.rs:604] — to verify storage

Screen 3 (Deep Scan Ready):
  → User clicks "Enter BLADE" / CTA
  → invoke("complete_onboarding", { answers: string[] })   [commands.rs:2325]
    (persona answers may be deferred or empty at this stage)
  → Backend triggers deep_scan automatically (see deep_scan.rs startup)
  → Frontend listens: on("deep_scan_progress", ...) to show scan progress
  → On complete → navigate to main shell / dashboard

Config fields involved:
  - config.onboarded: bool  (general onboarding — NOT the persona questions)
  - config.persona_onboarding_complete: bool  (5-answer persona onboarding)
  - config.provider: string
  - config.model: string
  - config.last_deep_scan: i64 (Unix timestamp)
```

### Key Config Commands

| Command | File:Line | Signature | Notes |
|---------|-----------|-----------|-------|
| `get_all_provider_keys` | `config.rs:604` | `() -> Value` | Returns `{providers: [{provider, has_key, masked, is_active}], active_provider}` |
| `store_provider_key` | `config.rs:636` | `(provider: String, api_key: String) -> Result<(), String>` | Stores in keyring |
| `switch_provider` | `config.rs:645` | `(provider: String, model: Option<String>) -> Result<BladeConfig, String>` | Switches active provider |
| `get_task_routing` | `config.rs:712` | `() -> TaskRouting` | Returns routing config |
| `set_task_routing` | `config.rs:718` | `(routing: TaskRouting) -> Result<(), String>` | Saves routing prefs |
| `save_config_field` | `config.rs:728` | `(key: String, value: String) -> Result<(), String>` | Single-field update |

---

## 4. Homeostasis Emit Surface

### Current Emit

| Event | File:Line | Payload | Frequency |
|-------|-----------|---------|-----------|
| `homeostasis_update` | `homeostasis.rs:424` | `{arousal, energy_mode, exploration, trust, urgency, hunger, thirst, insulin, adrenaline, leptin}` | Every 60s from background loop |

### The 10 Hormones (HormoneState struct, `homeostasis.rs:27`)

| Hormone | Field | Range | Default | Behavioral Effect |
|---------|-------|-------|---------|-------------------|
| Arousal | `arousal` | 0.0–1.0 | 0.3 | Organ poll frequency, notification urgency, response speed |
| Energy | `energy_mode` | 0.0–1.0 | 0.5 | Model quality (cheap/balanced/quality), API usage |
| Exploration | `exploration` | 0.0–1.0 | 0.3 | Exploit proven patterns vs. try new approaches |
| Trust | `trust` | 0.0–1.0 | 0.3 | Autonomous action vs. ask user |
| Urgency | `urgency` | 0.0–1.0 | 0.0 | Hive critical signals, deadline proximity |
| Hunger | `hunger` | 0.0–1.0 | 0.0 | Pending work queue depth |
| Thirst | `thirst` | 0.0–1.0 | 0.0 | Perception data staleness |
| Insulin | `insulin` | 0.0–1.0 | 0.0 | API token budget health (high = suppress spending) |
| Adrenaline | `adrenaline` | 0.0–1.0 | 0.0 | Emergency burst mode (overrides conservation, decays 5min) |
| Leptin | `leptin` | 0.0–1.0 | 0.3 | Knowledge satiety (high = stop researching) |

### Homeostasis Tauri Commands

| Command | File:Line | Returns |
|---------|-----------|---------|
| `homeostasis_get` | `homeostasis.rs:822` | `HormoneState` |
| `homeostasis_get_directive` | `homeostasis.rs:827` | `ModuleDirective {model_tier, poll_rate, allow_expensive_ops, autonomous, reason}` |
| `homeostasis_get_circadian` | `homeostasis.rs:835` | `Vec<f32>` (24-element hourly activity probability) |
| `homeostasis_relearn_circadian` | `homeostasis.rs:842` | `Vec<f32>` |

### WIRE-02 Design Notes (for Phase 3 `hormone_update` event)

Current state: Only ONE event (`homeostasis_update`) at 60s intervals. It already carries all 10 hormones as a flat JSON object.

**What needs to change for Phase 3:**
- Rename `homeostasis_update` → `hormone_update` OR add `hormone_update` as an alias/secondary emit (the D-16 STATE.md WIRE table calls it `hormone_update`)
- The HUD bar window and Body visualization (Phase 3/8) both subscribe to this
- The event is currently `app.emit()` (broadcast to all windows) — correct for cross-window (main + HUD + body overlay)
- Consider adding delta emission: only emit when a hormone changes by >0.05 (avoid 60s flood)

---

## 5. Streaming Event Inventory

| Event | File:Line | Payload Shape | Consumer Surface | Status |
|-------|-----------|---------------|-----------------|--------|
| `chat_token` | `commands.rs:742,1276,1284,1289` | `string` (word or short phrase) | Chat panel (main window) | ✓ EXISTS |
| `chat_done` | `commands.rs:745,1291` | `()` | Chat panel | ✓ EXISTS |
| `chat_ack` | `commands.rs:681` | `string` (fast ack text) | Chat panel (optimistic display) | ✓ EXISTS |
| `chat_routing` | `commands.rs:640` | `{provider: string, model: string, hive_active: bool}` | Chat panel header / model indicator | ✓ EXISTS |
| `chat_cancelled` | `commands.rs:77,1060,1876` | `()` | Chat panel | ✓ EXISTS |
| `blade_status` | `commands.rs:581,585,725,979,1062` | `"processing"\|"thinking"\|"idle"\|"error"` | Status bar / global indicator | ✓ EXISTS |
| `blade_planning` | `commands.rs:726,778` | `{query: string, mode?: string, step_count?: number}` | Chat panel (plan preview) | ✓ EXISTS |
| `chat_thinking` | `providers/anthropic.rs:344` | `string` (thinking text) | Chat panel (thinking indicator) | ✓ EXISTS (Anthropic only) |
| `chat_thinking_done` | `providers/anthropic.rs:337` | `()` | Chat panel | ✓ EXISTS (Anthropic only) |
| `blade_routing_switched` | `commands.rs:315` | `{from_provider, from_model, to_provider, to_model, reason}` | Notification toast | ✓ EXISTS |
| `blade_notification` | `commands.rs:1089,1117,1161,1187,1216` | `{type: "info"\|"warn"\|"error", message: string}` | Toast system | ✓ EXISTS |
| `brain_grew` | `commands.rs:989,1323` | `{new_entities: number}` | Dashboard/memory panel | ✓ EXISTS |
| `blade_message_start` | — | — | Chat panel (message begin indicator) | **STATUS: WIRE REQUIRED** (WIRE table) |
| `blade_thinking_chunk` | — | — | Chat panel (thinking chunks distinct from response) | **STATUS: WIRE REQUIRED** (WIRE table) |
| `blade_agent_event` | `agents/executor.rs` (various) | various | Agents cluster | **STATUS: WIRE REQUIRED** for frontend consumer |
| `blade_token_ratio` | — | — | Token ratio indicator (D-16) | **STATUS: WIRE REQUIRED** (WIRE table) |
| `blade_quickask_bridged` | — | — | Main window (from QuickAsk bridge) | **STATUS: WIRE REQUIRED** (WIRE-01, D-11) |
| `tool_approval_needed` | `commands.rs:1631,1653` | `{tool_name, args, context, request_id}` | Approval dialog overlay | ✓ EXISTS |
| `ai_delegate_approved` | `commands.rs:1608` | `{tool_name}` | Approval dialog | ✓ EXISTS |
| `ai_delegate_denied` | `commands.rs:1616` | `{tool_name}` | Approval dialog | ✓ EXISTS |
| `capability_gap_detected` | `commands.rs:1371` | `{user_request: string}` | Admin/diagnostics | ✓ EXISTS |
| `response_improved` | `commands.rs:1386` | `{improved: string}` | Chat panel (improved response) | ✓ EXISTS |

### Additional Background Events (discovered in codebase scan)

| Event | File:Line | Payload | Notes |
|-------|-----------|---------|-------|
| `homeostasis_update` | `homeostasis.rs:424` | `{10 hormones}` | Every 60s |
| `proactive_nudge` | `ambient.rs:145,227,247,283,312` | `{message, action?}` | Ambient monitoring |
| `proactive_action` | `proactive_engine.rs:607,652,933` | `action` | Proactive engine |
| `proactive_suggestion` | `godmode.rs:119` | task object | Godmode suggestions |
| `godmode_update` | `godmode.rs:233` | `{tier, ...}` | Godmode tier change |
| `hive_tick` | `hive.rs:2603` | status | Hive heartbeat |
| `hive_inform` | `hive.rs:2690` | `{summary}` | Hive action summary |
| `deep_scan_progress` | `deep_scan.rs:1325` | `{step, total, label, percent}` | Onboarding scan |
| `wake_word_detected` | `wake_word.rs:274` | `{phrase, play_chime}` | Wake word trigger |
| `dream_mode_start` | `dream_mode.rs:485,522` | `{idle_secs, manual?}` | Dream mode entered |
| `dream_mode_end` | `dream_mode.rs:475` | `{tasks_completed, ...}` | Dream mode exited |
| `blade_briefing` | `pulse.rs:647,683`, `cron.rs:602,683` | `{...}` | Morning briefing |
| `blade_pulse` | `pulse.rs:84,823` | `{...}` | Hourly pulse |
| `evolution_suggestion` | `evolution.rs:800,945` | suggestion | Evolution found |
| `blade_leveled_up` | `evolution.rs:812` | `{...}` | Level-up milestone |
| `skill_learned` | `skill_engine.rs:100` | `{skill_name, ...}` | New skill synthesized |
| `swarm_progress` | `swarm_commands.rs:452` | `{...}` | Swarm agent progress |
| `swarm_completed` | `swarm_commands.rs:390` | `{...}` | Swarm done |
| `hud_data_updated` | `overlay_manager.rs:252,292` | HUD data | HUD bar window |
| `blade_toast` | `overlay_manager.rs:323` | toast payload | Toast notification |
| `os_notification` | `notification_listener.rs:99` | notification | OS notification captured |
| `screenshot_taken` | `godmode.rs:215`, `screen_timeline.rs:293` | `()` | Screen capture |
| `thread_updated` | `thread.rs:92` | `{...}` | Working memory updated |
| `ghost_meeting_state` | `ghost_mode.rs:638,739` | `GhostMeetingState` | Ghost meeting state |
| `ghost_suggestion_ready_to_speak` | `ghost_mode.rs:522` | `{...}` | Ghost orb suggestion |

---

*Extract produced: 2026-04-18. No `src.bak/` referenced. No files in `src/` or `src-tauri/` modified.*
