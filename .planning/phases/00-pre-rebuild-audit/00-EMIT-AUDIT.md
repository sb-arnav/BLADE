# Phase 0 — emit_all Classification Audit (resolves WIRE-08)

> Scanned: `src-tauri/src/**/*.rs` for `app.emit(`, `emit_all(`, `emit_to(` patterns.
> Policy: D-14 — `emit_to(label, ...)` for single-window; `emit_all` / `app.emit()` (broadcast) for cross-window only.
> Note: In Tauri 2, `app.emit(event, payload)` broadcasts to ALL windows (equivalent to emit_all). `app.emit_to(label, event, payload)` targets a single window.

## Summary

- Total emit sites scanned: 247
- **cross-window:** 42 (events legitimately needed by multiple windows)
- **single-window:** 142 (events consumed by exactly one window — should convert to `emit_to`)
- **ambiguous:** 63 (cannot determine single consumer from emit site alone)

## Classification Table

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

---

## Window Label Reference

| Label | Window | Notes |
|-------|--------|-------|
| `"main"` | Main window | Chat, dashboard, settings, all standard routes |
| `"quickask"` | QuickAsk popup | Small floating input window |
| `"hud"` | HUD bar | Persistent bottom/side status bar |
| `"ghost_overlay"` | Ghost overlay | Meeting whisper overlay |
| `"overlay"` | Voice orb overlay | Voice conversation orb |

*Extract produced: 2026-04-18. No `src.bak/` referenced. No files in `src/` or `src-tauri/` modified.*
