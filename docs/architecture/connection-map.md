# BLADE — Full Architecture Connection Map

> Generated: 2026-04-15  
> Covers: Tauri commands (invoke), events (emit/listen), background loops, and Rust inter-module calls.  
> All connections verified against source code — not inferred.

---

## Layer Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  FRONTEND  (React + TypeScript)                                       │
│                                                                       │
│  App.tsx · useChat · useVoiceConversation · HiveView · StatusBar     │
│  DashboardGlance · ChatWindow · GhostOverlay · VoiceOrb · ...        │
│                                                                       │
│              invoke("command") ▲▼ emit("event")                       │
└──────────────────────────────────────────────────────────────────────┘
                          │ Tauri IPC bridge │
┌──────────────────────────────────────────────────────────────────────┐
│  BACKEND  (Rust)                                                      │
│                                                                       │
│  commands · brain · providers · godmode · ghost_mode · hive          │
│  vad · deepgram · perception_fusion · decision_gate · proactive       │
│  memory · embeddings · swarm · agents · screen_timeline · ...        │
│                                                                       │
│  35 background threads  ·  130+ Rust modules  ·  ~500 commands       │
└──────────────────────────────────────────────────────────────────────┘
                                │
┌──────────────────────────────────────────────────────────────────────┐
│  PERSISTENCE                                                          │
│  SQLite (blade.db)  ·  Vector Store  ·  godmode_context.md           │
│  Keyring (API keys)  ·  Config dir files                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 1. Background Loops (started at app init)

These run forever in background threads/tasks. Started in the `setup` block of `lib.rs`.
Conditional entries only start if the corresponding config flag is enabled.

| Loop | Module | Interval | Purpose |
|------|--------|----------|---------|
| MCP health reconnect (inline) | `mcp.rs` | `RECONNECT_INTERVAL_SECS` | Dead server detection + auto-reconnect + tool re-discovery |
| `start_hud_update_loop` | `overlay_manager.rs` | 10s | HUD live data pushes when HUD is visible |
| `start_perception_loop` | `perception_fusion.rs` | 30s | Unified sensor fusion: window + clipboard + vitals → PerceptionState |
| `start_clipboard_watcher` | `clipboard.rs` | Continuous | Clipboard polling → classification → decision_gate routing |
| `start_ambient_monitor` | `ambient.rs` | 30s | Multi-monitor, idle nudges, ambient context (reads perception_fusion) |
| `start_pulse` | `pulse.rs` | Variable | Heartbeat thoughts, morning briefing, daily digest |
| Journal + soul + character (inline) | `journal.rs`, `character.rs` | Hourly | Evening journal, weekly soul evolution, daily character consolidation |
| `start_health_scanner` | `health.rs` | Periodic | Code health scanning for indexed projects |
| `start_cron_loop` | `cron.rs` | Scheduled | User-defined reminders, weekly review, inbox checks |
| Session handoff (inline) | `session_handoff.rs` | 15 min | Cross-session working memory snapshot |
| `start_god_mode` *(conditional)* | `godmode.rs` | 5/2/1 min | Perception fusion, smart interrupt, proactive task queue |
| `start_timeline_capture_loop` *(conditional)* | `screen_timeline.rs` | 30s | Total Recall screenshots + OCR + semantic index |
| `start_audio_timeline_capture` *(conditional)* | `audio_timeline.rs` | Continuous | Always-on mic → Whisper → meeting detection |
| `start_wake_word_listener` *(conditional)* | `wake_word.rs` | Always-on | "Hey BLADE" keyword detection |
| `start_evolution_loop` | `evolution.rs` | Daily | MCP catalog discovery, self-improvement suggestions |
| `start_goal_engine` | `goal_engine.rs` | Periodic | Goal progress nudges, autonomous pursuit |
| `start_learning_engine` | `learning_engine.rs` | 30 min | Behavioral pattern analysis + prediction engine tick (consolidated) |
| `start_causal_engine` | `causal_graph.rs` | Periodic | Event correlation, insight extraction |
| `start_watcher_loop` | `watcher.rs` | Continuous | File/URL watcher alerts |
| `start_reminder_loop` | `reminders.rs` | 30s | Due reminder firing + TTS |
| `start_world_model` | `world_model.rs` | Periodic | Global context state refresh |
| `start_autonomous_research` | `autonomous_research.rs` | Periodic | Background knowledge gap filling |
| `start_dream_monitor` | `dream_mode.rs` | On idle | Autonomous reflection while user is away |
| `start_accountability_loop` | `accountability.rs` | 6 hours | OKR nudges, overdue check-ins |
| `start_health_nudge_loop` | `health_tracker.rs` | 2 hours | Wellbeing nudges |
| `start_habit_reminder_loop` | `habit_engine.rs` | 15 min | Due habit reminders |
| `start_activity_monitor` | `activity_monitor.rs` | Continuous | Passive window + file watcher, feeds persona engine |
| `start_sidecar_monitor` | `sidecar.rs` | 5 min | Ping registered cross-devices |
| `start_proactive_engine` | `proactive_engine.rs` | Continuous | 5-signal detectors → decision_gate → action queue |
| ~~`start_prediction_loop`~~ | `prediction_engine.rs` | Removed (dead code) | Driven by `start_learning_engine` directly |
| `start_workflow_scheduler` | `workflow_builder.rs` | 60s | n8n-style scheduled workflow execution |
| Integration bridge (inline) *(conditional)* | `integration_bridge.rs` | Varies | Gmail / Calendar / Slack / GitHub MCP polling |
| `notification_listener_start` | `notification_listener.rs` | Continuous | OS notification interception |
| `start_health_monitor` | `health_guardian.rs` | 5 min | Screen time, break reminders, posture nudges |
| Security cache (inline) | `security_monitor.rs` | 5 min | Background netstat → suspicious connection count cache |
| `start_hive` *(conditional)* | `hive.rs` | 30s | Distributed agent mesh tick, tentacle polling, Head routing |
| `start_terminal_watcher` | `tentacles/terminal_watch.rs` | Continuous | Terminal command monitoring |
| `start_filesystem_watcher` | `tentacles/filesystem_watch.rs` | Continuous | Filesystem change detection → suggestions |

---

## 2. Frontend → Backend (invoke calls)

### App.tsx — Startup & Core
| Command | Purpose |
|---------|---------|
| `debug_config` | Load config for display |
| `get_config` | Fetch full BladeConfig |
| `get_onboarding_status` | Check first-run state |
| `capture_screen` | Screenshot for wallpaper/context |
| `move_to_monitor` | Position window to dedicated screen |
| `pulse_get_last_thought` | Load last heartbeat thought on startup |
| `pulse_now` | Trigger immediate pulse |
| `pulse_explain` | Explain current thought |
| `pulse_get_digest` | Digest of events while window was hidden |
| `journal_write_now` | Auto-write journal entry |
| `journal_get_recent` | Load recent journal entries |
| `blade_get_soul` | Load soul/character bible |
| `blade_self_code` | Trigger self-coding agent |
| `blade_thread_get` | Load current working thread |
| `computer_use_stop` | Stop active computer use task |
| `obsidian_save_conversation` | Save to Obsidian vault |
| `obsidian_ensure_daily_note` | Create today's daily note |

### useChat.ts — Core Chat Pipeline
| Command | Purpose |
|---------|---------|
| `send_message_stream` | Main chat — starts streaming response |
| `cancel_chat` | Cancel in-progress stream |
| `history_list_conversations` | Load conversation list |
| `history_load_conversation` | Load specific conversation |
| `history_save_conversation` | Persist conversation |
| `history_delete_conversation` | Delete conversation |
| `history_rename_conversation` | Rename conversation |
| `auto_title_conversation` | AI-generate title from first exchange |
| `brain_extract_from_exchange` | Extract facts from completed exchange |
| `learn_from_conversation` | Feed conversation to memory system |
| `respond_tool_approval` | Approve/deny pending MCP tool call |
| `blade_thread_auto_update` | Update working thread after exchange |
| `streak_record_activity` | Record chat activity for streak |

### HiveView.tsx — HIVE Mesh Control
| Command | Purpose |
|---------|---------|
| `hive_get_status` | Full mesh status on mount |
| `hive_get_reports` | Load tentacle reports |
| `hive_start` | Start the HIVE mesh |
| `hive_stop` | Stop the HIVE mesh |
| `hive_set_autonomy` | Set global autonomy level (0.0–1.0) |
| `hive_approve_decision` | Approve a pending Head decision |
| `hive_spawn_tentacle` | Spawn tentacle for a platform |

### StatusBar.tsx
| Command | Purpose |
|---------|---------|
| `god_mode_status` | Initial god mode tier |
| `hive_get_status` | Initial active tentacle count |

### DashboardGlance.tsx
| Command | Purpose |
|---------|---------|
| `perception_get_latest` | Current perception state |
| `integration_get_state` | Integration bridge health |
| `goal_list` | Active goals |
| `streak_get_stats` | Streak + stats summary |
| `get_proactive_tasks` | Pending god mode task queue |

### voice.rs — PTT Recording
| Command | Purpose |
|---------|---------|
| `voice_start_recording` | Start mic capture (cpal → WAV, non-blocking) |
| `voice_stop_recording` | Stop and return base64 WAV |
| `voice_transcribe` | Send base64 audio → Groq Whisper → text |
| `voice_transcribe_blob` | Transcribe raw audio blob (alternative path) |

### voice_global.rs + Ghost Mode
| Command | Purpose |
|---------|---------|
| `start_voice_conversation` | Begin conversational voice session |
| `stop_voice_conversation` | End voice session |
| `voice_conversation_active` | Query session state |
| `ghost_start` | Start ghost meeting overlay |
| `ghost_stop` | Stop ghost overlay |
| `ghost_set_position` | Reposition overlay |
| `ghost_get_status` | Query ghost state |
| `tts_speak` | Speak text via TTS |
| `tts_stop` | Stop TTS playback |
| `wake_word_start` | Enable wake word detection |
| `wake_word_stop` | Disable wake word detection |

### Screen & Memory
| Command | Purpose |
|---------|---------|
| `timeline_search_cmd` | Semantic search across screenshots |
| `timeline_browse_cmd` | Browse recent screenshots |
| `timeline_get_screenshot` | Fetch specific screenshot |
| `timeline_get_thumbnail` | Fetch screenshot thumbnail |
| `timeline_search_everything` | Full recall search |
| `timeline_meeting_summary` | Meeting summary from audio |
| `embed_and_store` | Add to vector store |
| `semantic_search` | Search vector store |
| `memory_search` | Search memory palace |
| `memory_recall` | Deep episodic recall |
| `memory_get_recent` | Recent memories |
| `memory_consolidate_now` | Force consolidation |
| `memory_store_typed` | Store typed memory (7 categories) |
| `memory_recall_category` | Recall by category |

### Agents & Automation
| Command | Purpose |
|---------|---------|
| `agent_create` | Create managed agent |
| `agent_create_desktop` | Create desktop automation agent |
| `agent_respond_desktop_action` | Handle desktop action approval |
| `agent_list` | List active agents |
| `swarm_create` | Create parallel agent swarm |
| `swarm_list` | List swarms |
| `swarm_get_progress` | Swarm progress |
| `agent_spawn` | Spawn background agent (Claude Code/Aider/Goose) |
| `agent_list_background` | List background agents |
| `computer_use_task` | Execute computer use task |
| `computer_use_screenshot` | Take computer use screenshot |

---

## 3. Backend → Frontend (emit events)

### Core Chat
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `chat_token` | `commands.rs`, `providers/*` | `useChat.ts`, `ChatWindow.tsx` |
| `chat_done` | `commands.rs`, `providers/*` | `useChat.ts`, `QuickAsk`, `useDocGenerator` |
| `chat_cancelled` | `commands.rs` | `useChat.ts` |
| `chat_ack` | `commands.rs` | `ChatWindow.tsx` (fast ack display) |
| `chat_thinking` | `providers/anthropic.rs` | `useChat.ts` |
| `chat_thinking_done` | `providers/anthropic.rs` | `useChat.ts` |
| `chat_routing` | `commands.rs` | diagnostics panel |
| `blade_planning` | `commands.rs` | chat planning indicator |
| `tool_approval_request` | `commands.rs` | `ToolApprovalModal` |
| `conversation_titled` | `commands.rs` | `useChat.ts` (update sidebar title) |
| `thread_updated` | `thread.rs` | thread indicator UI |

### God Mode & Ambient Intelligence
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `godmode_update` | `godmode.rs` | `StatusBar.tsx`, `DashboardGlance.tsx`, `ChatWindow.tsx` |
| `godmode_stopped` | `godmode.rs` | god mode UI |
| `screenshot_taken` | `godmode.rs`, `screen_timeline.rs` | HUD camera blink |
| `smart_interrupt` | `godmode.rs` | `App.tsx` (stuck-on-error notification) |
| `proactive_suggestion` | `godmode.rs`, `clipboard.rs`, `tentacles/filesystem_watch.rs` | `App.tsx` → notification + TTS |
| `proactive_task_added` | `godmode.rs` | `DashboardGlance.tsx` alerts panel |
| `ambient_update` | `ambient.rs` | _(no listener — low priority)_ |

### Proactive Engine
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `proactive_action` | `proactive_engine.rs` | `App.tsx` → notification |
| `proactive_nudge` | `ambient.rs`, `health.rs`, `cron.rs`, `tentacles/*` | `App.tsx` → notification + TTS |

### HIVE Mesh
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `hive_tick` | `hive.rs` | `HiveView.tsx` (full status), `StatusBar.tsx` (count) |
| `hive_pending_decisions` | `hive.rs` | `HiveView.tsx` → reload reports |
| `hive_inform` | `hive.rs` | `HiveView.tsx` → Big Agent feed |
| `hive_action` | `hive.rs` | `HiveView.tsx` → action feed with ⚡ |
| `hive_action_deferred` | `hive.rs` | `HiveView.tsx` → deferred action log |
| `hive_escalate` | `hive.rs` | `HiveView.tsx` → critical feed with 🚨, auto-switches to Feed tab |
| `tentacle_error` | `hive.rs` | `HiveView.tsx` → tentacle status → `degraded`/`dormant` |

### Voice & Audio
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `voice_global_started` | `voice_global.rs` | `VoiceOrb` |
| `voice_global_transcribing` | `voice_global.rs` | `VoiceOrb` state |
| `voice_global_error` | `voice_global.rs` | error handlers |
| `voice_transcript_ready` | `voice_global.rs` | input → chat |
| `voice_conversation_listening` | `voice_global.rs` | `VoiceOrb` → listening state |
| `voice_conversation_speaking` | `voice_global.rs` | `VoiceOrb` → speaking animation |
| `voice_conversation_thinking` | `voice_global.rs` | `VoiceOrb` → thinking state |
| `voice_conversation_ended` | `voice_global.rs` | session cleanup |
| `voice_emotion_detected` | `voice_global.rs` | voice analytics |
| `voice_mode_changed` | `voice_global.rs` | `StatusBar.tsx` |
| `tts_interrupted` | `tts.rs` | `useVoiceConversation` |
| `audio_capture_state` | `audio_timeline.rs`, `screen_timeline_commands.rs` | recording indicators |
| `wake_word_detected` | `wake_word.rs` | `App.tsx` → `blade_wake_word_triggered` CustomEvent → voice recording start |

### Ghost Mode
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `ghost_toggle_card` | `lib.rs` (shortcut) | `GhostOverlay`, `HudBar` |
| `ghost_suggestion_ready_to_speak` | `ghost_mode.rs` | ghost response card |
| `ghost_meeting_state` | `ghost_mode.rs` | meeting state UI |
| `ghost_meeting_ended` | `ghost_mode.rs` | `HudBar`, overlay cleanup |

### Blade System Signals
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `blade_pulse` | `pulse.rs` | `App.tsx` → notification + TTS |
| `blade_briefing` | `pulse.rs`, `cron.rs` | `App.tsx` |
| `blade_notification` | `commands.rs`, `clipboard.rs`, `ambient.rs` | `App.tsx` → notification |
| `blade_reminder_fired` | `reminders.rs` | `App.tsx` → notification + TTS |
| `blade_reminder_created` | `reminders.rs`, `action_tags.rs` | `App.tsx` → quiet toast |
| `blade_leveled_up` | `evolution.rs` | `App.tsx` → notification |
| `blade_auto_upgraded` | `evolution.rs` | `App.tsx` → notification |
| `evolution_suggestion` | `evolution.rs` | `App.tsx` → notification |
| `brain_grew` | `brain.rs`, `action_tags.rs` | `App.tsx`, activity feed |
| `skill_learned` | `skill_engine.rs` | `App.tsx` → notification |
| `autoskill_installed` | `autoskills.rs` | `App.tsx` → notification |
| `autoskill_suggestion` | `autoskills.rs` | `App.tsx` → notification |
| `background_ai_auto_disabled` | `config.rs` | `App.tsx` → warning notification |
| `shortcut_registration_failed` | `lib.rs` | `App.tsx` → warning notification |
| `monitor_disconnected` | `ambient.rs` | `App.tsx` → notification |
| `blade_self_code_started` | `self_code.rs` | `App.tsx` → notification |

### Clipboard
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `clipboard_prefetch_ready` | `clipboard.rs` | `App.tsx` → "ready to help" notification |
| `clipboard_changed` | `clipboard.rs` | context refresh |

### Agents & Compute
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `agent_completed` | `agent_commands.rs`, `background_agent.rs`, `runtimes.rs` | `useAgents.ts` |
| `agent_done` | `managed_agents.rs` | `useManagedAgents.ts` |
| `agent_cancelled` | `background_agent.rs` | `BackgroundAgentsPanel` |
| `ai_delegate_approved` | `commands.rs` | `App.tsx` → notification |
| `ai_delegate_denied` | `commands.rs` | `App.tsx` → notification |

### Swarm & Parallel Execution
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `swarm_created` | `swarm_commands.rs` | `SwarmView` |
| `swarm_progress` | `swarm_commands.rs` | `SwarmView` progress |
| `swarm_task_started` | `swarm_commands.rs` | task list |
| `swarm_task_completed` | `swarm_commands.rs` | completion animation |
| `swarm_task_failed` | `swarm_commands.rs` | error notification |
| `swarm_completed` | `swarm_commands.rs` | final summary |

### Auto-Fix Pipeline
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `auto_fix_analyzing` | `auto_fix.rs` | `AutoFixCard` |
| `auto_fix_verifying` | `auto_fix.rs` | `AutoFixCard` spinner |
| `auto_fix_pushing` | `auto_fix.rs` | `AutoFixCard` push phase |
| `auto_fix_failed` | `auto_fix.rs` | `AutoFixCard` error |

### Computer Use & UI Automation
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `computer_use_step` | `computer_use.rs` | action preview |
| `computer_use_complete` | `computer_use.rs` | success notification |
| `computer_use_approval_needed` | `computer_use.rs` | approval dialog |

### Overlay & HUD
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `hud_data_updated` | `overlay_manager.rs` | `HudBar` live data |
| `blade_toast` | `overlay_manager.rs` | floating toast |

### Deep Scan (First Run)
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `deep_scan_progress` | `deep_scan.rs` | first-run wizard |

### Misc
| Event | Emitter | Listener(s) |
|-------|---------|-------------|
| `watcher_alert` | `watcher.rs` | `App.tsx` → watch notification |
| `blade_habit_reminder` | `habit_engine.rs` | notifications |
| `goal_progress` | `goal_engine.rs` | `GoalView`, insights bar |
| `blade_prediction` | `prediction_engine.rs` | `PredictionView` |
| `causal_insights` | `causal_graph.rs` | insights bar |
| `sidecar_status_update` | `sidecar.rs` | `SidecarView` |
| `telegram_message_handled` | `telegram.rs` | integration status |
| `meeting_summary_ready` | `tentacles/calendar_tentacle.rs` | `MeetingView` |
| `whisper_download_started` | `whisper_local.rs` | download progress |
| `whisper_download_complete` | `whisper_local.rs` | model ready |
| `os_notification` | `notification_listener.rs` | OS notification listener |

---

## 4. Rust Inter-Module Connections

### commands.rs (core chat) → other modules
```
commands.rs
  → brain::build_system_prompt()        assemble identity + tools + memory
  → router::classify_message()          task routing (chat/code/search/agent)
  → providers::complete_turn()          unified LLM gateway
  → mcp::McpManager                     tool execution + validation
  → decision_gate::evaluate()           tool approval routing
  → embeddings::smart_context_recall()  hybrid BM25 + vector retrieval
  → memory::learn_from_conversation()   fact extraction
  → history::*                          conversation persistence
  → thread::auto_update_thread()        working memory update
  → ai_delegate::check()                Claude Code approval gate
```

### godmode.rs (ambient intelligence) → other modules
```
godmode.rs
  → perception_fusion::update_perception()  fuse screen + audio + clipboard
  → perception_fusion::get_latest()         read current state
  → decision_gate::evaluate()               route proactive signals
  → embeddings::auto_embed_exchange()       store brief to vector DB
  → evolution::run_evolution_cycle()        feed evolution engine
  → screen_timeline::start_loop()           start Total Recall
  → persona_engine::get_all_traits()        user identity for brief
  → context::get_active_window()            current app focus
  → db::timeline_record()                   persist scans to SQLite
```

### ghost_mode.rs (meeting overlay) → other modules
```
ghost_mode.rs
  → vad::VadConfig + start_vad_capture()    voice activity detection
  → deepgram::transcribe_with_fallback()    streaming STT (Deepgram → Groq Whisper)
  → config::get_provider_key("deepgram")    API key lookup
  → providers::complete_turn()              generate ghost response
  → context::get_active_window()            detect meeting platform
```

### vad.rs (voice activity detection) → other modules
```
vad.rs
  → cpal::default_host().default_input_device()   OS audio input
  → hound::WavWriter                               WAV encoding
  → mpsc::SyncSender<SpeechSegment>                segment delivery to caller
```

### deepgram.rs (streaming STT) → other modules
```
deepgram.rs
  → config::get_provider_key("deepgram")    API key
  → config::get_provider_key("groq")        Groq fallback key
  → tokio_tungstenite::connect_async()      WebSocket to api.deepgram.com
  → reqwest (Groq Whisper fallback)         batch transcription
```

### voice_global.rs (voice conversation) → other modules
```
voice_global.rs
  → vad::start_vad_capture()               voice activity detection
  → deepgram::transcribe_with_fallback()   speech-to-text
  → commands::send_message_stream()        pipe transcript to chat
  → tts::speak()                           play response audio
  → config::load_config()                  TTS + transcription settings
  → brain::build_system_prompt()           voice-optimized system prompt
```

### proactive_engine.rs (autonomous initiative) → other modules
```
proactive_engine.rs
  → decision_gate::evaluate()              signal approval/routing
  → perception_fusion::get_latest()        current context snapshot
  → context::get_active_window()           active app
  → persona_engine::build_user_model()     behavioral prediction
  → persona_engine::predict_next_need()    anticipatory suggestions
  → causal_graph::get_recent_events()      causal context
  → goal_engine::get_active_goals()        goal progress tracking
  → providers::complete_turn()             generate proactive actions
```

### perception_fusion.rs (fused sensory state) → other modules
```
perception_fusion.rs
  → context::get_active_window()           active app/window name
  → clipboard (state)                      clipboard content type
  → screen_timeline (queried)              screenshot OCR context
  → notification_listener (state)          OS notification context
  → system vitals                          disk, RAM, CPU
```

### hive.rs (distributed agent mesh) → other modules
```
hive.rs
  → config::get_provider_key("github")     GitHub token for tentacle
  → config::get_provider_key("discord")    Discord token for tentacle
  → mcp (slack tentacle)                   Slack MCP tool calls
  → providers::complete_turn()             Head model reasoning
  → decision_gate::evaluate()              autonomous action approval
  → perception_fusion::get_latest()        current user state
  → embeddings::auto_embed_exchange()      store decisions to vector DB
  → typed_memory::store()                  persist decisions by category
  → execution_memory::record()             action history log
  → auto_fix::*                            CI failure auto-repair
```

### ambient.rs (context monitor) → other modules
```
ambient.rs
  → perception_fusion::get_latest()       window + clipboard state (no direct polling)
  → clipboard::clipboard_auto_action()    route clipboard signals through decision_gate
  → health_guardian                       break reminders
```

### brain.rs (system prompt builder) → other modules
```
brain.rs
  → hive::get_hive_digest()               compact organ/head intelligence (priority 7.5)
  → memory::get_memory_blocks()           virtual context blocks
  → typed_memory::get_all()               structured memory categories
  → thread::get_active_thread()           working memory (injected first)
  → embeddings::smart_context_recall()    relevant past context
  → persona_engine::get_traits()          personality traits
  → goal_engine::get_active_goals()       active goals for prompt
  → people_graph::get_context()           relationship context
  → knowledge_graph::*                    entity relationships
  → config::load_config()                 model + provider settings
```

### hive.rs (distributed agent mesh) → other modules
```
hive.rs
  → brain.rs (via get_hive_digest)       system prompt injection
  → decision_gate                        autonomous action routing
  → typed_memory                         stores decisions + high-priority reports
  → execution_memory                     logs actions taken
  → people_graph                         enriches decisions with relationships
  → perception_fusion::get_latest()      screen awareness
  → integration_bridge                   email/slack/github state
  → providers::complete_turn()           LLM calls for head/big-agent thinking
```

### swarm_commands.rs (parallel agents) → other modules
```
swarm_commands.rs
  → swarm_planner::plan_dag()             decompose task into DAG
  → agents::executor::execute_step()      run each agent step
  → providers::complete_turn()            agent LLM calls
  → decision_gate::evaluate()             approval routing
  → embeddings::store()                   persist swarm outputs
```

---

## 5. Critical Paths (end-to-end flows)

### Chat (main pipeline)
```
User types → useChat.ts
  → invoke("send_message_stream")
  → commands.rs::send_message_stream()
    → brain::build_system_prompt()      (thread + memory + personality)
    → router::classify_message()        (which model/provider)
    → providers::complete_turn()        (streaming LLM)
      → emit "chat_token" (each token)
      → emit "chat_done" (when complete)
    → tool loop if tools called:
      → emit "tool_approval_request"
      → await invoke("respond_tool_approval")
      → mcp::call_tool() or native_tools::*
  → blade_thread_auto_update() (background)
  → brain_extract_from_exchange() (background)
  → learn_from_conversation() (background)
```

### Ghost Mode (meeting overlay)
```
invoke("ghost_start")
  → ghost_mode.rs::run_ghost_loop()
    → vad::start_vad_capture()          (mic → VAD segments)
    → [per utterance]
      → deepgram::transcribe_with_fallback()
        → WebSocket to api.deepgram.com (nova-2, diarize=true)
        → OR Groq Whisper fallback
      → detect platform (Zoom/Meet/Teams/etc.)
      → providers::complete_turn()      (ghost response)
      → emit "ghost_suggestion_ready_to_speak"
      → tts::speak() or show card
```

### Voice Conversation
```
invoke("start_voice_conversation")
  → voice_global.rs::run_voice_loop()
    → vad::start_vad_capture()          (mic → VAD segments)
    → [per utterance]
      → deepgram::transcribe_with_fallback()
      → emit "voice_conversation_listening" / "voice_conversation_thinking"
      → commands::send_message_stream() (full chat pipeline)
      → tts::speak(response)
      → emit "voice_conversation_speaking"
```

### God Mode (ambient intelligence)
```
start_god_mode() → every 5/2/1 min:
  → capture_screen() + OCR               (vision layer)
  → perception_fusion::update_perception()
    → context::get_active_window()
    → clipboard state
    → OS vitals
  → build_intelligence_brief()           (LLM: what matters now?)
  → store godmode_context.md
  → check_smart_interrupt()              (stuck on same error 5min+?)
  → evaluate_and_queue_proactive_actions()
    → decision_gate::evaluate()
    → IF approved: queue_proactive_task()
      → emit "proactive_suggestion"
      → emit "proactive_task_added"
  → embed brief to vector store
  → emit "godmode_update" { tier, delta, user_state, context_tags }
```

### HIVE Tick (distributed mesh)
```
hive tick every 30s:
  → poll each tentacle:
    │ email tentacle  → IMAP/Gmail check
    │ slack tentacle  → MCP slack tools
    │ github tentacle → GitHub REST API
    │ discord tentacle→ Discord token API
    │ ci tentacle     → port probe + log check
    └ ...
  → collect TentacleReport[]
  → route reports to domain Heads:
    │ Communications Head (claude-sonnet)
    │ Development Head    (gemini-pro)
    │ Operations Head     (claude-haiku)
    └ Intelligence Head   (all reports → cross-domain synthesis)
  → each Head produces Decision[]
  → foreach decision:
    │ confidence >= autonomy_level → execute_decision()
    │   → emit "hive_action" or "hive_inform" or "hive_escalate"
    └ confidence < autonomy_level  → queue for user approval
        → emit "hive_pending_decisions"
  → emit "hive_tick" { full HiveStatus }
```

### Proactive Engine
```
start_proactive_engine() → continuous:
  → run detectors:
    │ stuck_detection         (same error 5+ min)
    │ workflow_repetition     (repetitive task pattern)
    │ deadline_warning        (upcoming deadline)
    │ energy_check            (time-of-day based)
    └ user_model_prediction   (persona_engine prediction)
  → foreach signal above threshold:
    → decision_gate::evaluate(signal, perception)
      → IF ActAutonomously: execute + save + emit "proactive_action"
      → IF AskUser: queue + emit "proactive_action"
```

---

## 6. HIVE Topology

```
             BLADE Desktop App (Head)
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    COMMS Head     DEV Head      OPS Head
    (claude-sonnet) (gemini-pro) (claude-haiku)
    │  │  │  │       │  │  │      │  │  │
    │  │  │  │       │  │  │      │  │  │
   Slack Discord   GitHub  CI   Logs Cloud Backend
   Email WhatsApp  Linear Jira
                                      │
                              INTEL Head ←──── ALL reports
                              (cross-domain synthesis)
                                      │
                              Big Agent
                              (incident detection, pattern synthesis)
```

**Autonomy levels:**
- `0.0` — always ask user before any action
- `0.3` — default — auto-reply for high-confidence; ask for risky actions
- `1.0` — fully autonomous — all decisions auto-executed

---

## 7. Known Gaps & Dead Events (as of 2026-04-15)

### Fixed this session
| Issue | Fix |
|-------|-----|
| `godmode_update` mismatch → StatusBar/DashboardGlance used `god_mode_update` | Fixed — now `godmode_update` |
| `proactive_suggestion` fired into void | Wired to App.tsx notifications + TTS |
| `proactive_action` fired into void | Wired to App.tsx notifications |
| `proactive_task_added` never emitted | Now emitted from `queue_proactive_task` in godmode.rs |
| `hive_stats` doesn't exist (StatusBar) | Changed to `hive_get_status` → `.active_tentacles` |
| `hive_updated` never emitted (StatusBar) | Changed to `hive_tick` → `.active_tentacles` |
| HiveView reports missing fields | Full typed mapping: summary, priority, timestamp, needsApproval |
| HiveView decision approve local-only | Now calls `hive_approve_decision` backend command |
| HiveView: `hive_inform` / `hive_action` / `hive_escalate` / `tentacle_error` unlistened | All wired in HiveView.tsx |

### Remaining — no frontend surface
App.tsx has 55 routes; most backend modules are fully wired. The following are the genuine gaps.

**Tentacle commands (no UI route):**
| Module | Commands |
|--------|----------|
| `tentacles/terminal_watch.rs` | Background loop only |
| `tentacles/log_monitor.rs` | 5 commands (tail, anomaly, correlate, groups, search) |
| `tentacles/cloud_costs.rs` | 5 commands (AWS costs, anomalies, savings, reports) |
| `tentacles/linear_jira.rs` | 4 commands (sync, blockers, sprint report, auto-ticket) |
| `tentacles/discord_deep.rs` | 4 commands (mentions, moderate, summarize, welcome) |

**Background-only (autonomous, no UI trigger needed):**
| Module | Commands | Note |
|--------|----------|------|
| `dream_mode.rs` | `dream_is_active`, `dream_trigger_now`, `dream_record_activity` | Runs autonomously on idle |
| `world_model.rs` | `world_get_state`, `world_get_summary`, `world_refresh` | Infrastructure state cache |
| `causal_graph.rs` | 5 commands | Feeds insights bar |
| `autonomous_research.rs` | `research_list_gaps`, `research_add_gap`, `research_trigger_now` | Background gap filling |

**Internal infrastructure (no UI needed):**
`tool_forge.rs` (4 cmds), `self_upgrade.rs` (9 cmds), `self_critique.rs` (4 cmds), `indexer.rs` (5 cmds), `rag.rs` (3 cmds), `git_style.rs` (3 cmds), `crypto.rs` (utility), `cmd_util.rs` (utility), `mcp_fs_server.rs` (built-in MCP), `mcp_memory_server.rs` (built-in MCP)

**Dead event:**
`ambient_update` — emitted every 10 min, no listener. Polling fallback works.
