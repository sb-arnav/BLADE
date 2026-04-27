# Phase 10 — Inventory & Wiring Audit (resolves AUDIT-01..05)

> Scanned: `src-tauri/src/**/*.rs`, `src/windows/main/router.ts`, `src/features/*/index.tsx`, `src-tauri/src/config.rs`, `src-tauri/Cargo.toml`
> Policy: D-48 — ACTIVE (invoked + subscribed), WIRED-NOT-USED (UI exists, backend silent), NOT-WIRED (backend exists, no UI), DEAD (no callers + not in v1.1 or v1.2 roadmap)
> Note: Read-only audit. No code changes. `10-WIRING-AUDIT.json` sidecar is the machine-parseable source of truth; this Markdown is the human view.
> Sidecar: `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` (validates against `10-WIRING-AUDIT.schema.json` via `npm run verify:wiring-audit-shape`).

## Summary

- Total Rust modules classified: **178** (`src-tauri/src/**/*.rs`; excludes `build.rs`)
- Total prod routes classified: **80** (+ **20** ACTIVE (dev-only) routes gated on `import.meta.env.DEV`)
- Total config surfaces cataloged: **155** (90 struct fields + 34 statics + 16 env vars + 1 cargo feature + 14 keyring secrets)
- NOT-WIRED backlog: **99** items → Phase 14 consumes verbatim
- DEAD deletion plan: **1** items → Phase 14 removes safely
- Deferred-to-v1.2 (Appendix B): **2** items
- Classifications:
  - Modules: 129 ACTIVE, 0 WIRED-NOT-USED, 49 NOT-WIRED, 0 DEAD
  - Routes (prod): 80 ACTIVE, 0 WIRED-NOT-USED, 0 NOT-WIRED, 0 DEAD
  - Config: 104 ACTIVE, 49 WIRED-NOT-USED, 1 NOT-WIRED, 1 DEAD
- Cross-reference overrides: **0** modules reclassified from NOT-WIRED → ACTIVE via `verify-phase{5..8}-rust-surface.sh` command-set membership (Subagent A classifications were already accurate).

---

## 1. Module Catalog

Source: `10-WIRING-AUDIT.json::modules[]`. Every `.rs` file under `src-tauri/src/` (excluding `build.rs`). Nested `agents/`, `hormones/`, `plugins/`, `tentacles/` subdirectories flat-listed (sorted alphabetically by `file`).

| file | classification | purpose | trigger | ui_surface |
|------|----------------|---------|---------|------------|
| `src-tauri/src/accountability.rs` | ACTIVE | Tracks objectives, key results, and daily actions. BLADE doesn't just store | #[tauri::command] accountability_create_objective (+ others) | `src/lib/tauri/life_os.ts:1291` |
| `src-tauri/src/action_tags.rs` | ACTIVE | ACTION TAGS — Semantic action tags embedded in LLM responses. | internal — called by src-tauri/src/commands.rs:1461 | — |
| `src-tauri/src/activity_monitor.rs` | ACTIVE | Activity Monitor — BLADE's passive user awareness layer. | internal — called by src-tauri/src/brain.rs:1059 | — |
| `src-tauri/src/agent_commands.rs` | ACTIVE | Module agent_commands | #[tauri::command] agent_create (+ others) | `src/lib/tauri/agents.ts:182` |
| `src-tauri/src/agent_factory.rs` | ACTIVE | BLADE Agent Factory — NosShip-inspired "describe it, deploy it" agent generator. | #[tauri::command] factory_create_agent (+ others) | `src/lib/tauri/agents.ts:451` |
| `src-tauri/src/agents/executor.rs` | ACTIVE | Maximum number of retry attempts per step (including the first attempt). | internal — called by src-tauri/src/agent_commands.rs:1 | — |
| `src-tauri/src/agents/mod.rs` | ACTIVE | Agent Roles — specialization templates  | internal — called by src-tauri/src/agent_commands.rs:1 | — |
| `src-tauri/src/agents/planner.rs` | ACTIVE | Stage 1 output | internal — called by src-tauri/src/agent_commands.rs:1 | — |
| `src-tauri/src/agents/queue.rs` | ACTIVE | Module queue | internal — called by src-tauri/src/agent_commands.rs:1 | — |
| `src-tauri/src/agents/thought_tree.rs` | ACTIVE | Complexity detection | internal — called by src-tauri/src/agent_commands.rs:1 | — |
| `src-tauri/src/ai_delegate.rs` | ACTIVE | AI-to-AI Permission Delegation | #[tauri::command] ai_delegate_introduce (+ others) | `src/lib/tauri/hive.ts:282` |
| `src-tauri/src/ambient.rs` | ACTIVE | Ambient intelligence monitor — runs in background from app launch. | body_registry anatomy entry | — |
| `src-tauri/src/audio_timeline.rs` | ACTIVE | BLADE Audio Timeline — always-on audio capture + smart extraction | internal — called by src-tauri/src/brain.rs:666 | — |
| `src-tauri/src/audit.rs` | ACTIVE | AUDIT LOG — BLADE explains its decisions. | #[tauri::command] audit_get_log (+ others) | `src/lib/tauri/admin.ts:1219` |
| `src-tauri/src/authority_engine.rs` | ACTIVE | BLADE Authority Hierarchy — 9 specialist agents with defined scopes and explicitly denied actions. | #[tauri::command] authority_get_agents (+ others) | `src/lib/tauri/admin.ts:1143` |
| `src-tauri/src/auto_fix.rs` | NOT-WIRED | Auto-Fix Pipeline — BLADE's showcase autonomous CI repair engine. | #[tauri::command] auto_fix_analyze — registered but no invokeTyped consumer | — |
| `src-tauri/src/auto_reply.rs` | ACTIVE | BLADE Auto-Reply — drafts responses in your style when someone messages you. | #[tauri::command] auto_reply_draft (+ others) | `src/lib/tauri/dev_tools.ts:858` |
| `src-tauri/src/automation.rs` | ACTIVE | Module automation | #[tauri::command] auto_type_text (+ others) | `src/lib/tauri/dev_tools.ts:1021` |
| `src-tauri/src/autonomous_research.rs` | NOT-WIRED | BLADE identifies its own knowledge gaps and proactively researches them. | #[tauri::command] research_list_gaps — registered but no invokeTyped consumer | — |
| `src-tauri/src/autoskills.rs` | ACTIVE | AUTOSKILLS — Automatic capability acquisition. | internal — called by src-tauri/src/commands.rs:1930 | — |
| `src-tauri/src/background_agent.rs` | ACTIVE | BLADE BACKGROUND AGENT SPAWNER | #[tauri::command] agent_spawn (+ others) | `src/lib/tauri/agents.ts:273` |
| `src-tauri/src/body_registry.rs` | ACTIVE | BODY REGISTRY — maps every BLADE module to its biological body system. | #[tauri::command] body_get_map (+ others) | `src/lib/tauri/body.ts:208` |
| `src-tauri/src/brain_planner.rs` | ACTIVE | BRAIN PLANNER — BLADE's task decomposition layer. | internal — called by src-tauri/src/commands.rs:1303 | — |
| `src-tauri/src/brain.rs` | NOT-WIRED | Different models need different prompting strategies. | #[tauri::command] brain_extract_from_exchange — registered but no invokeTyped consumer | — |
| `src-tauri/src/browser_agent.rs` | ACTIVE | Browser automation agent for BLADE — Phase 1 of the JARVIS plan. | #[tauri::command] browser_action (+ others) | `src/lib/tauri/dev_tools.ts:772` |
| `src-tauri/src/browser_native.rs` | ACTIVE | Detect the user's default browser by reading the OS registry / settings. | #[tauri::command] connect_to_user_browser (+ others) | `src/lib/tauri/dev_tools.ts:841` |
| `src-tauri/src/cardiovascular.rs` | ACTIVE | CARDIOVASCULAR SYSTEM — BLADE's data flow monitoring and event registry. | #[tauri::command] cardio_get_blood_pressure (+ others) | `src/lib/tauri/body.ts:390` |
| `src-tauri/src/causal_graph.rs` | NOT-WIRED | CAUSAL GRAPH — BLADE's temporal reasoning engine. | #[tauri::command] causal_get_insights — registered but no invokeTyped consumer | — |
| `src-tauri/src/character.rs` | ACTIVE | Extract the first valid JSON object from LLM output. | #[tauri::command] consolidate_character (+ others) | `src/lib/tauri/identity.ts:312` |
| `src-tauri/src/clipboard.rs` | NOT-WIRED | Clipboard prefetch cache — one slot, keyed by content hash | #[tauri::command] get_clipboard — registered but no invokeTyped consumer | — |
| `src-tauri/src/cmd_util.rs` | ACTIVE | Utility for spawning subprocesses without a flash console window on Windows. | internal — called by src-tauri/src/activity_monitor.rs:137 | — |
| `src-tauri/src/code_sandbox.rs` | ACTIVE | BLADE Code Sandbox — safely execute code snippets in multiple languages. | #[tauri::command] sandbox_run (+ others) | `src/lib/tauri/dev_tools.ts:640` |
| `src-tauri/src/commands.rs` | ACTIVE | Global cancel flag — set to true to abort the current chat inference. | #[tauri::command] cancel_chat (+ others) | `src/lib/tauri/chat.ts:35` |
| `src-tauri/src/computer_use.rs` | ACTIVE | Computer Use — Blade's ability to operate the computer autonomously. | #[tauri::command] computer_use_task (+ others) | `src/lib/tauri/dev_tools.ts:986` |
| `src-tauri/src/config.rs` | ACTIVE | Per-task-type provider routing.  | #[tauri::command] get_all_provider_keys (+ others) | `src/lib/tauri/admin.ts:1660` |
| `src-tauri/src/consequence.rs` | NOT-WIRED | CONSEQUENCE ENGINE — predict outcomes before acting. | #[tauri::command] consequence_predict — registered but no invokeTyped consumer | — |
| `src-tauri/src/context_engine.rs` | ACTIVE | CONTEXT ENGINE — Smart RAG backbone for BLADE. | #[tauri::command] context_assemble (+ others) | `src/lib/tauri/identity.ts:792` |
| `src-tauri/src/context.rs` | NOT-WIRED | Get the currently focused window info | #[tauri::command] get_active_window — registered but no invokeTyped consumer | — |
| `src-tauri/src/cron.rs` | ACTIVE | BLADE CRON — Autonomous Scheduled Tasks | #[tauri::command] cron_add (+ others) | `src/lib/tauri/dev_tools.ts:1417` |
| `src-tauri/src/crypto.rs` | ACTIVE | Loads the encryption key from the OS keychain, or generates and stores a new one. | body_registry anatomy entry | — |
| `src-tauri/src/db_commands.rs` | ACTIVE | Tauri command wrappers for the SQLite database layer.  | #[tauri::command] db_list_conversations (+ others) | `src/features/knowledge/ConversationInsights.tsx:110` |
| `src-tauri/src/db.rs` | ACTIVE | Row types  | internal — called by src-tauri/src/activity_monitor.rs:447 | — |
| `src-tauri/src/decision_gate.rs` | ACTIVE | Decision Gate — BLADE's autonomous decision classifier. | #[tauri::command] get_decision_log (+ others) | `src/lib/tauri/admin.ts:1096` |
| `src-tauri/src/deep_scan.rs` | ACTIVE | Deep System Discovery — scans the user's machine on first run to build | #[tauri::command] deep_scan_start (+ others) | `src/lib/tauri/admin.ts:1462` |
| `src-tauri/src/deepgram.rs` | ACTIVE | BLADE Deepgram Streaming STT Client | internal — called by src-tauri/src/ghost_mode.rs:660 | — |
| `src-tauri/src/deeplearn.rs` | NOT-WIRED | Deep Learn — Blade's mission zero. | #[tauri::command] deeplearn_discover_sources — registered but no invokeTyped consumer | — |
| `src-tauri/src/discord.rs` | NOT-WIRED | BLADE Discord notifications — post pulse thoughts, briefings, and | #[tauri::command] discord_connect — registered but no invokeTyped consumer | — |
| `src-tauri/src/discovery.rs` | NOT-WIRED | Scans the user's machine for AI tools, code projects, dev environment, | #[tauri::command] run_discovery — registered but no invokeTyped consumer | — |
| `src-tauri/src/dna.rs` | ACTIVE | DNA — BLADE's shared knowledge query layer. | #[tauri::command] dna_get_identity (+ others) | `src/lib/tauri/body.ts:299` |
| `src-tauri/src/document_intelligence.rs` | ACTIVE | BLADE Document Intelligence | #[tauri::command] doc_ingest (+ others) | `src/lib/tauri/dev_tools.ts:907` |
| `src-tauri/src/dream_mode.rs` | NOT-WIRED | When the user is away for 20+ minutes, BLADE enters Dream Mode — processing, | #[tauri::command] dream_is_active — registered but no invokeTyped consumer | — |
| `src-tauri/src/embeddings.rs` | ACTIVE | Generate embeddings for a list of texts | #[tauri::command] semantic_search (+ others) | `src/lib/tauri/knowledge.ts:387` |
| `src-tauri/src/emotional_intelligence.rs` | ACTIVE | BLADE Emotional Intelligence — Adaptive Empathy Engine | #[tauri::command] emotion_get_current (+ others) | `src/lib/tauri/life_os.ts:1238` |
| `src-tauri/src/evolution.rs` | ACTIVE | EVOLUTION ENGINE — BLADE's self-improvement loop. | #[tauri::command] evolution_get_level (+ others) | `src/lib/tauri/admin.ts:1000` |
| `src-tauri/src/execution_memory.rs` | ACTIVE | BLADE EXECUTION MEMORY — every shell command BLADE has ever run, stored forever. | #[tauri::command] exmem_record (+ others) | `src/lib/tauri/admin.ts:1414` |
| `src-tauri/src/file_indexer.rs` | ACTIVE | FILE INDEXER — BLADE indexes ALL files on the user's machine, not just code. | #[tauri::command] file_index_scan_now (+ others) | `src/lib/tauri/dev_tools.ts:489` |
| `src-tauri/src/files.rs` | ACTIVE | Module files | #[tauri::command] file_read (+ others) | `src/lib/tauri/dev_tools.ts:429` |
| `src-tauri/src/financial_brain.rs` | ACTIVE | BLADE Financial Brain — Personal Finance Intelligence | #[tauri::command] finance_add_transaction (+ others) | `src/lib/tauri/life_os.ts:586` |
| `src-tauri/src/ghost_mode.rs` | NOT-WIRED | BLADE Ghost Mode — invisible AI overlay for meetings and chat | #[tauri::command] ghost_start — registered but no invokeTyped consumer | — |
| `src-tauri/src/git_style.rs` | ACTIVE | GIT STYLE — Learn your coding style from commit history. | #[tauri::command] git_style_mine (+ others) | `src/lib/tauri/dev_tools.ts:602` |
| `src-tauri/src/goal_engine.rs` | ACTIVE | Autonomous AGI goal pursuit. Goals never fail — they change strategy. | #[tauri::command] goal_add (+ others) | `src/lib/tauri/life_os.ts:755` |
| `src-tauri/src/godmode.rs` | NOT-WIRED | God Mode v2 — BLADE's ambient intelligence layer. | #[tauri::command] get_proactive_tasks — registered but no invokeTyped consumer | — |
| `src-tauri/src/habit_engine.rs` | ACTIVE | BLADE Habit Engine — Streak Tracking, Friction Analysis & Smart Reminders | #[tauri::command] habit_create (+ others) | `src/lib/tauri/life_os.ts:819` |
| `src-tauri/src/health_guardian.rs` | ACTIVE | BLADE Health Guardian — Screen Time & Wellbeing Monitor | #[tauri::command] health_guardian_stats (+ others) | `src/lib/tauri/life_os.ts:559` |
| `src-tauri/src/health_tracker.rs` | ACTIVE | BLADE Health Tracker — Wellbeing Intelligence Engine | #[tauri::command] health_log (+ others) | `src/lib/tauri/life_os.ts:446` |
| `src-tauri/src/health.rs` | ACTIVE | BLADE PROACTIVE CODE HEALTH SCANNER | #[tauri::command] health_get_scan (+ others) | `src/lib/tauri/life_os.ts:529` |
| `src-tauri/src/history.rs` | ACTIVE | Module history | internal — called by src-tauri/src/commands.rs:2393 | — |
| `src-tauri/src/hive.rs` | ACTIVE | HIVE — BLADE's distributed agent mesh across every platform the user touches. | #[tauri::command] hive_get_digest (+ others) | `src/lib/tauri/hive.ts:166` |
| `src-tauri/src/homeostasis.rs` | ACTIVE | HOMEOSTASIS — BLADE's hypothalamus + neuromodulatory hormone bus. | #[tauri::command] homeostasis_get (+ others) | `src/lib/tauri/homeostasis.ts:23` |
| `src-tauri/src/immune_system.rs` | ACTIVE | IMMUNE SYSTEM — BLADE's self-evolution coordinator. | #[tauri::command] immune_resolve_gap (+ others) | `src/lib/tauri/admin.ts:1075` |
| `src-tauri/src/indexer.rs` | ACTIVE | BLADE CODEBASE INDEXER — persistent living knowledge graph of every project. | #[tauri::command] blade_index_project (+ others) | `src/lib/tauri/dev_tools.ts:545` |
| `src-tauri/src/integration_bridge.rs` | ACTIVE | integration_bridge.rs — Phase 4 MCP Integration Polling | #[tauri::command] integration_get_state (+ others) | `src/lib/tauri/admin.ts:1622` |
| `src-tauri/src/iot_bridge.rs` | ACTIVE | IoT / Smart Home bridge — Home Assistant REST API + Spotify local control | #[tauri::command] iot_get_entities (+ others) | `src/lib/tauri/iot.ts:35` |
| `src-tauri/src/joints.rs` | ACTIVE | JOINTS — Trait-based contracts between BLADE modules. | #[tauri::command] joints_list_providers (+ others) | `src/lib/tauri/body.ts:484` |
| `src-tauri/src/journal.rs` | NOT-WIRED | BLADE's internal journal — written from BLADE's perspective, not for the user. | #[tauri::command] journal_get_recent — registered but no invokeTyped consumer | — |
| `src-tauri/src/kali.rs` | ACTIVE | BLADE Kali — world-class security intelligence module. | #[tauri::command] kali_recon (+ others) | `src/lib/tauri/identity.ts:935` |
| `src-tauri/src/knowledge_graph.rs` | ACTIVE | KNOWLEDGE GRAPH — BLADE's semantic concept network. | #[tauri::command] graph_add_node (+ others) | `src/lib/tauri/knowledge.ts:414` |
| `src-tauri/src/learning_engine.rs` | ACTIVE | BLADE Learning Engine — behavioral pattern detection and proactive prediction. | #[tauri::command] learning_get_predictions (+ others) | `src/lib/tauri/life_os.ts:1481` |
| `src-tauri/src/lib.rs` | ACTIVE | Module lib | Tauri entry point — generate_handler! + 35+ background task spawns | — |
| `src-tauri/src/main.rs` | ACTIVE | Prevents additional console window on Windows in release, DO NOT REMOVE!!  | binary shim — invokes blade_lib::run() | — |
| `src-tauri/src/managed_agents.rs` | ACTIVE | Module managed_agents | #[tauri::command] run_managed_agent (+ others) | `src/lib/tauri/agents.ts:511` |
| `src-tauri/src/mcp_fs_server.rs` | ACTIVE | Built-in MCP filesystem server — exposes safe file operations as MCP tools. | internal — called by src-tauri/src/mcp.rs:504 | — |
| `src-tauri/src/mcp_memory_server.rs` | ACTIVE | Built-in MCP memory server — exposes BLADE's brain knowledge graph as MCP tools. | internal — called by src-tauri/src/mcp.rs:503 | — |
| `src-tauri/src/mcp.rs` | ACTIVE | How often (seconds) the background health monitor checks for dead servers.  | internal — called by src-tauri/src/agent_commands.rs:8 | — |
| `src-tauri/src/meeting_intelligence.rs` | ACTIVE | BLADE Meeting Intelligence | #[tauri::command] meeting_process (+ others) | `src/lib/tauri/life_os.ts:944` |
| `src-tauri/src/memory_palace.rs` | ACTIVE | MEMORY PALACE — BLADE's episodic long-term memory system. | #[tauri::command] memory_search (+ others) | `src/lib/tauri/knowledge.ts:487` |
| `src-tauri/src/memory.rs` | ACTIVE | Three structured memory blocks, each capped and auto-compressed: | #[tauri::command] run_weekly_memory_consolidation (+ others) | `src/lib/tauri/knowledge.ts:850` |
| `src-tauri/src/metacognition.rs` | NOT-WIRED | METACOGNITION — BLADE's awareness of its own cognitive state. | #[tauri::command] metacognition_assess — registered but no invokeTyped consumer | — |
| `src-tauri/src/multimodal.rs` | NOT-WIRED | What's visible in the image — objects, scene, layout | #[tauri::command] multimodal_analyze_file — registered but no invokeTyped consumer | — |
| `src-tauri/src/native_tools.rs` | ACTIVE | Built-in AI tools — always available without MCP.  | #[tauri::command] run_code_block (+ others) | `src/lib/tauri/dev_tools.ts:409` |
| `src-tauri/src/negotiation_engine.rs` | ACTIVE | BLADE Negotiation Engine — Debate Coach + Negotiation Assistant | #[tauri::command] negotiation_build_argument (+ others) | `src/lib/tauri/identity.ts:565` |
| `src-tauri/src/notification_listener.rs` | NOT-WIRED | Phase 5 (partial): OS Notification Listener — surface Windows (and macOS/Linux) notifications to BLADE. | #[tauri::command] notification_get_recent — registered but no invokeTyped consumer | — |
| `src-tauri/src/obsidian.rs` | NOT-WIRED | BLADE × Obsidian — writes into your vault so everything BLADE knows | #[tauri::command] obsidian_ensure_daily_note — registered but no invokeTyped consumer | — |
| `src-tauri/src/organ.rs` | ACTIVE | ORGAN TRAIT — Standard interface for all BLADE organs. | #[tauri::command] organ_get_registry (+ others) | `src/lib/tauri/body.ts:243` |
| `src-tauri/src/overlay_manager.rs` | ACTIVE | BLADE Overlay Manager — HUD, toast notifications, and meeting overlay control. | #[tauri::command] overlay_hide_hud (+ others) | `src/features/hud/HudMenu.tsx:109` |
| `src-tauri/src/people_graph.rs` | ACTIVE | BLADE People Graph — knows the people in your life and how to talk to each of them differently. | #[tauri::command] people_list (+ others) | `src/lib/tauri/life_os.ts:1411` |
| `src-tauri/src/perception_fusion.rs` | ACTIVE | Perception Fusion — BLADE's sensory integration layer. | #[tauri::command] perception_get_latest (+ others) | `src/lib/tauri/perception.ts:22` |
| `src-tauri/src/permissions.rs` | ACTIVE | Tool risk level — determines whether user approval is needed | #[tauri::command] classify_mcp_tool (+ others) | `src/lib/tauri/admin.ts:749` |
| `src-tauri/src/persona_engine.rs` | ACTIVE | BLADE Persona Engine — "Soul Deepening" System | #[tauri::command] persona_get_context (+ others) | `src/lib/tauri/identity.ts:462` |
| `src-tauri/src/personality_mirror.rs` | ACTIVE | BLADE Personality Mirror — WeClone-inspired chat style extraction | #[tauri::command] personality_analyze (+ others) | `src/lib/tauri/identity.ts:900` |
| `src-tauri/src/plugins/loader.rs` | ACTIVE | Load all installed plugins from the plugins directory | internal — called by src-tauri/src/plugins/registry.rs:1 | — |
| `src-tauri/src/plugins/mod.rs` | ACTIVE | Plugin manifest (blade-plugin.json) | internal — called by src-tauri/src/plugins/loader.rs:1 | — |
| `src-tauri/src/plugins/registry.rs` | NOT-WIRED | Tauri commands for plugin management | #[tauri::command] plugin_list — registered but no invokeTyped consumer | — |
| `src-tauri/src/prediction_engine.rs` | ACTIVE | BLADE PREDICTION ENGINE — Anticipatory intelligence. | #[tauri::command] prediction_get_pending (+ others) | `src/lib/tauri/life_os.ts:1186` |
| `src-tauri/src/prefrontal.rs` | NOT-WIRED | PREFRONTAL WORKING MEMORY — the Brain's active task scratchpad. | #[tauri::command] prefrontal_get — registered but no invokeTyped consumer | — |
| `src-tauri/src/proactive_engine.rs` | NOT-WIRED | PROACTIVE ENGINE — BLADE's autonomous initiative layer. | #[tauri::command] proactive_get_pending — registered but no invokeTyped consumer | — |
| `src-tauri/src/proactive_vision.rs` | NOT-WIRED | PROACTIVE VISION — Omi-style assistants that analyze screen on context switch. | #[tauri::command] proactive_get_cards — registered but no invokeTyped consumer | — |
| `src-tauri/src/providers/anthropic.rs` | ACTIVE | Module anthropic | internal — called by src-tauri/src/accountability.rs:396 | — |
| `src-tauri/src/providers/gemini.rs` | ACTIVE | Module gemini | internal — called by src-tauri/src/accountability.rs:396 | — |
| `src-tauri/src/providers/groq.rs` | ACTIVE | Non-vision models reject array content — flatten image messages to text only | internal — called by src-tauri/src/accountability.rs:396 | — |
| `src-tauri/src/providers/mod.rs` | ACTIVE | Shared HTTP client with timeouts. Prevents permanent hangs when network drops.  | internal — called by src-tauri/src/accountability.rs:396 | — |
| `src-tauri/src/providers/ollama.rs` | ACTIVE | Module ollama | internal — called by src-tauri/src/accountability.rs:396 | — |
| `src-tauri/src/providers/openai.rs` | ACTIVE | Resolve a base_url (e.g. "https://openrouter.ai/api/v1") to a full | internal — called by src-tauri/src/accountability.rs:396 | — |
| `src-tauri/src/pulse.rs` | NOT-WIRED | PULSE — Blade's heartbeat. The thing that makes it alive. | #[tauri::command] pulse_get_digest — registered but no invokeTyped consumer | — |
| `src-tauri/src/rag.rs` | NOT-WIRED | Module rag | #[tauri::command] rag_ingest_file — registered but no invokeTyped consumer | — |
| `src-tauri/src/reasoning_engine.rs` | ACTIVE | BLADE System 2 — true multi-step reasoning. | #[tauri::command] reasoning_think (+ others) | `src/lib/tauri/identity.ts:723` |
| `src-tauri/src/reminders.rs` | ACTIVE | BLADE Reminders — time-based alerts with full context. | #[tauri::command] reminder_add (+ others) | `src/lib/tauri/dev_tools.ts:1298` |
| `src-tauri/src/reports.rs` | ACTIVE | Capability gap detection, local storage, webhook delivery, and self-improvement missions.  | #[tauri::command] report_gap (+ others) | `src/lib/tauri/admin.ts:846` |
| `src-tauri/src/reproductive.rs` | ACTIVE | REPRODUCTIVE SYSTEM — BLADE creates new life that inherits its DNA. | #[tauri::command] reproductive_get_dna (+ others) | `src/lib/tauri/body.ts:449` |
| `src-tauri/src/research.rs` | NOT-WIRED | BLADE AMBIENT RESEARCH ENGINE | #[tauri::command] research_get_recent — registered but no invokeTyped consumer | — |
| `src-tauri/src/roles.rs` | NOT-WIRED | BLADE ROLES — Specialist operating modes. | #[tauri::command] roles_list — registered but no invokeTyped consumer | — |
| `src-tauri/src/router.rs` | NOT-WIRED | Classify what kind of task a message is, to route to the right model | #[tauri::command] classify_message — registered but no invokeTyped consumer | — |
| `src-tauri/src/runtimes.rs` | NOT-WIRED | Module runtimes | #[tauri::command] discover_ai_runtimes — registered but no invokeTyped consumer | — |
| `src-tauri/src/screen_timeline_commands.rs` | ACTIVE | Tauri commands for the Total Recall screen timeline feature. | #[tauri::command] timeline_search_cmd (+ others) | `src/lib/tauri/knowledge.ts:609` |
| `src-tauri/src/screen_timeline.rs` | ACTIVE | BLADE Total Recall — Screen Timeline | internal — called by src-tauri/src/godmode.rs:150 | — |
| `src-tauri/src/screen.rs` | NOT-WIRED | Module screen | #[tauri::command] capture_screen — registered but no invokeTyped consumer | — |
| `src-tauri/src/security_monitor.rs` | ACTIVE | Phase 9 — Security Fortress | #[tauri::command] security_scan_network (+ others) | `src/lib/tauri/admin.ts:1234` |
| `src-tauri/src/self_code.rs` | NOT-WIRED | JITRO — BLADE codes itself. | #[tauri::command] blade_self_code — registered but no invokeTyped consumer | — |
| `src-tauri/src/self_critique.rs` | ACTIVE | SELF-CRITIQUE ENGINE — BLADE's build-roast-rebuild cycle. | #[tauri::command] self_critique_response (+ others) | `src/lib/tauri/admin.ts:1736` |
| `src-tauri/src/self_upgrade.rs` | ACTIVE | BLADE SELF-UPGRADE ENGINE | #[tauri::command] pentest_authorize (+ others) | `src/lib/tauri/admin.ts:946` |
| `src-tauri/src/session_handoff.rs` | NOT-WIRED | BLADE SESSION HANDOFF | #[tauri::command] session_handoff_clear — registered but no invokeTyped consumer | — |
| `src-tauri/src/show_engine.rs` | NOT-WIRED | SHOW ENGINE — BLADE proactively opens windows to show you things. | #[tauri::command] show_record_request — registered but no invokeTyped consumer | — |
| `src-tauri/src/sidecar.rs` | ACTIVE | Main BLADE acts as a hub: it registers sidecar devices (work laptop, home desktop, | #[tauri::command] sidecar_list_devices (+ others) | `src/lib/tauri/identity.ts:824` |
| `src-tauri/src/skeleton.rs` | ACTIVE | SKELETON — Central database schema initialization. | body_registry anatomy entry | — |
| `src-tauri/src/skill_engine.rs` | ACTIVE | SKILL ENGINE — Blade's self-improving reflex layer. | internal — called by src-tauri/src/brain.rs:770 | — |
| `src-tauri/src/social_cognition.rs` | NOT-WIRED | SOCIAL COGNITION — understanding social dynamics, not just individual people. | #[tauri::command] social_get_advice — registered but no invokeTyped consumer | — |
| `src-tauri/src/social_graph.rs` | ACTIVE | BLADE Social Graph — Personal CRM with Emotional Intelligence | #[tauri::command] social_add_contact (+ others) | `src/lib/tauri/life_os.ts:1050` |
| `src-tauri/src/soul_commands.rs` | ACTIVE | BLADE Soul — weekly character snapshot, diff, and transparency UI | #[tauri::command] soul_get_state (+ others) | `src/lib/tauri/identity.ts:391` |
| `src-tauri/src/streak_stats.rs` | ACTIVE | BLADE Streak & Stats — gamification layer that makes people not want to uninstall. | #[tauri::command] streak_get_stats (+ others) | `src/lib/tauri/life_os.ts:1380` |
| `src-tauri/src/supervisor.rs` | ACTIVE | SERVICE SUPERVISOR — keeps BLADE's background services alive. | #[tauri::command] supervisor_get_health (+ others) | `src/lib/tauri/admin.ts:1492` |
| `src-tauri/src/swarm_commands.rs` | ACTIVE | BLADE Swarm Commands — Tauri commands + coordinator loop | #[tauri::command] swarm_create (+ others) | `src/lib/tauri/agents.ts:346` |
| `src-tauri/src/swarm_planner.rs` | ACTIVE | BLADE Swarm Planner — LLM-based DAG decomposition | internal — called by src-tauri/src/swarm_commands.rs:377 | — |
| `src-tauri/src/swarm.rs` | ACTIVE | BLADE Swarm — Parallel Multi-Agent Orchestration | internal — called by src-tauri/src/swarm_commands.rs:13 | — |
| `src-tauri/src/symbolic.rs` | ACTIVE | SYMBOLIC REASONING LAYER — deterministic logic that LLMs can't be trusted with. | #[tauri::command] symbolic_check_policy (+ others) | `src/lib/tauri/admin.ts:1314` |
| `src-tauri/src/sysadmin.rs` | ACTIVE | SYSADMIN MODULE — Makes BLADE capable of complex system administration. | #[tauri::command] sysadmin_detect_hardware (+ others) | `src/lib/tauri/admin.ts:1527` |
| `src-tauri/src/system_control.rs` | NOT-WIRED | Phase 7: System Control — BLADE's autonomous desktop management layer. | #[tauri::command] lock_screen — registered but no invokeTyped consumer | — |
| `src-tauri/src/telegram.rs` | NOT-WIRED | BLADE Telegram bridge — lets users chat with BLADE through a Telegram bot. | #[tauri::command] telegram_start — registered but no invokeTyped consumer | — |
| `src-tauri/src/temporal_intel.rs` | ACTIVE | BLADE Temporal Intelligence — "What was I doing N hours ago?" | #[tauri::command] temporal_what_was_i_doing (+ others) | `src/lib/tauri/admin.ts:1367` |
| `src-tauri/src/tentacles/calendar_tentacle.rs` | NOT-WIRED | TENTACLE: calendar_tentacle.rs — Manages schedule, meeting prep, focus blocking, | #[tauri::command] calendar_get_today — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/cloud_costs.rs` | NOT-WIRED | BLADE Cloud Costs Tentacle — Cloud spend monitoring and optimisation. | #[tauri::command] cloud_check_aws_costs — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/discord_deep.rs` | NOT-WIRED | BLADE Discord Deep Tentacle — BLADE manages communities, not just watches them. | #[tauri::command] discord_process_mentions — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/email_deep.rs` | ACTIVE | BLADE Email Deep Tentacle — full email management, not just monitoring. | internal — called by src-tauri/src/brain.rs:1086 | — |
| `src-tauri/src/tentacles/filesystem_watch.rs` | NOT-WIRED | TENTACLE: filesystem_watch.rs — Proactive file-system management. | #[tauri::command] filesystem_approve_move — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/github_deep.rs` | NOT-WIRED | GITHUB DEEP TENTACLE — BLADE lives inside GitHub. | #[tauri::command] github_review_pr — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/heads.rs` | ACTIVE | HEAD MODELS — Domain-specific AI coordinators for BLADE's Hive. | internal — called by src-tauri/src/brain.rs:1086 | — |
| `src-tauri/src/tentacles/linear_jira.rs` | NOT-WIRED | BLADE Linear/Jira Tentacle — Project management automation. | #[tauri::command] linear_sync_git_to_tickets — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/log_monitor.rs` | NOT-WIRED | BLADE Log Monitor Tentacle — Production log intelligence. | #[tauri::command] log_start_tailing — registered but no invokeTyped consumer | — |
| `src-tauri/src/tentacles/mod.rs` | ACTIVE | TENTACLES — Platform-specific live agents that make up BLADE's Hive mesh. | internal — called by src-tauri/src/brain.rs:1086 | — |
| `src-tauri/src/tentacles/slack_deep.rs` | ACTIVE | BLADE Slack Deep Tentacle — BLADE lives in Slack, not just watches it. | internal — called by src-tauri/src/brain.rs:1086 | — |
| `src-tauri/src/tentacles/terminal_watch.rs` | ACTIVE | TENTACLE: terminal_watch.rs — Watches terminal activity and provides intelligent assistance. | internal — called by src-tauri/src/brain.rs:1086 | — |
| `src-tauri/src/thread.rs` | NOT-WIRED | THREAD — Blade's working memory layer. | #[tauri::command] blade_thread_update — registered but no invokeTyped consumer | — |
| `src-tauri/src/tool_forge.rs` | ACTIVE | BLADE Tool Forge — self-expanding capability engine. | #[tauri::command] forge_new_tool (+ others) | `src/lib/tauri/admin.ts:1787` |
| `src-tauri/src/trace.rs` | ACTIVE | Module trace | #[tauri::command] get_recent_traces (+ others) | `src/lib/tauri/admin.ts:1514` |
| `src-tauri/src/tray.rs` | NOT-WIRED | Module tray | #[tauri::command] set_tray_status — registered but no invokeTyped consumer | — |
| `src-tauri/src/tts.rs` | NOT-WIRED | BLADE Text-to-Speech — OS-native + OpenAI TTS. | #[tauri::command] tts_speak — registered but no invokeTyped consumer | — |
| `src-tauri/src/typed_memory.rs` | ACTIVE | TYPED MEMORY — Omi-inspired structured memory categories for BLADE. | #[tauri::command] memory_store_typed (+ others) | `src/lib/tauri/knowledge.ts:560` |
| `src-tauri/src/ui_automation.rs` | ACTIVE | Module ui_automation | #[tauri::command] uia_get_active_window_snapshot (+ others) | `src/lib/tauri/dev_tools.ts:1202` |
| `src-tauri/src/urinary.rs` | ACTIVE | URINARY SYSTEM — BLADE's waste filtration and excretion. | #[tauri::command] urinary_flush (+ others) | `src/lib/tauri/body.ts:426` |
| `src-tauri/src/vad.rs` | ACTIVE | BLADE VAD (Voice Activity Detection) Engine | internal — called by src-tauri/src/ghost_mode.rs:591 | — |
| `src-tauri/src/voice_global.rs` | ACTIVE | BLADE Global Voice Input — push-to-talk + conversational voice mode. | #[tauri::command] start_voice_conversation (+ others) | `src/features/voice-orb/VoiceOrbWindow.tsx:107` |
| `src-tauri/src/voice_intelligence.rs` | NOT-WIRED | VOICE INTELLIGENCE — Emotion-aware voice context for BLADE. | #[tauri::command] voice_intel_start_session — registered but no invokeTyped consumer | — |
| `src-tauri/src/voice_local.rs` | NOT-WIRED | voice_local — delegates to whisper_local for local Whisper.cpp inference. | #[tauri::command] whisper_model_available — registered but no invokeTyped consumer | — |
| `src-tauri/src/voice.rs` | NOT-WIRED | Start recording from the default microphone | #[tauri::command] voice_start_recording — registered but no invokeTyped consumer | — |
| `src-tauri/src/wake_word.rs` | ACTIVE | BLADE Wake Word Detection — "Hey BLADE" always-on voice activation | #[tauri::command] set_wake_word_enabled (+ others) | `src/lib/tauri/config.ts:239` |
| `src-tauri/src/watcher.rs` | ACTIVE | BLADE Resource Watcher — ambient intelligence for the web. | #[tauri::command] watcher_add (+ others) | `src/lib/tauri/dev_tools.ts:1363` |
| `src-tauri/src/whisper_local.rs` | NOT-WIRED | Local Whisper transcription via whisper-rs (whisper.cpp bindings) | #[tauri::command] whisper_transcribe_local — registered but no invokeTyped consumer | — |
| `src-tauri/src/workflow_builder.rs` | ACTIVE | BLADE Workflow Builder — Visual n8n-style automation engine | #[tauri::command] workflow_list (+ others) | `src/lib/tauri/dev_tools.ts:698` |
| `src-tauri/src/world_model.rs` | ACTIVE | Data structures | #[tauri::command] world_get_state (+ others) | `src/lib/tauri/body.ts:357` |

---

## 2. Route + Command-Palette Catalog

Source: `10-WIRING-AUDIT.json::routes[]` (80 prod rows) + `10-ROUTES.yaml::routes[]` (20 dev-only rows; not in JSON because the `...(import.meta.env.DEV ? devRoutes : [])` spread is parser-invisible to `verify-wiring-audit-shape`) + 4 non-main window shells (`10-ROUTES.yaml::windows[]`, also not in JSON).

Correction vs `10-CONTEXT.md §D-49`: CommandPalette is mounted ONLY in `src/windows/main/MainShell.tsx`. Palette entries = `ROUTE_MAP` filtered by `paletteHidden !== true`. The 4 non-main windows (quickask, hud, ghost, overlay) do not host palettes.

### 2a. Routes (prod — palette-eligible)

| id | file | classification | section | palette_visible | shortcut | data_shape | flow_status |
|----|------|----------------|---------|-----------------|----------|------------|-------------|
| `accountability` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Objective[] (records) + todays actions | data pipes |
| `agent-detail` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | AgentSummary + AgentTimeline rows (append-only) | data pipes |
| `agent-factory` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | FactoryAgent[] { spec, deployment_status } | data pipes |
| `agent-pixel-world` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | Agent[] grouped by role into a 3x3 emoji grid | data pipes |
| `agent-team` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | Agent[] grouped by role | data pipes |
| `agent-timeline` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | TimelineRow[] across all agents + swarms | data pipes |
| `agents` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | Agent[] { id, role, status, progress } + active count | data pipes |
| `analytics` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | AnalyticsSummary + Event[] | data pipes |
| `background-agents` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | BackgroundAgent[] { cli, pid, status, log lines } | data pipes |
| `body-map` | `src/features/body/index.tsx` | ACTIVE | body | ✓ | — | BodyMap + BodySummary | data pipes |
| `body-system-detail` | `src/features/body/index.tsx` | ACTIVE | body | ✓ | — | BodySystem + per-system details (cardio/immune/joints/reproductive/urinary) | data pipes |
| `canvas` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | SandboxResult { output, error, language } | data pipes |
| `capability-reports` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | EvolutionLevel + Suggestion[] + Forge tools + self-critique history | data pipes |
| `character` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | CharacterBible { sections[], reactions[] } | data pipes |
| `chat` | `src/features/chat/index.tsx` | ACTIVE | core | ✓ | `Mod+/` | ChatStateValue { messages[], status, error } via ChatProvider context | data pipes |
| `code-sandbox` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | SandboxResult + explain/fix output | data pipes |
| `codebase-explorer` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | Document[] + per-doc search + Q&A result | data pipes |
| `computer-use` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | ComputerUseTaskResult + screenshot | data pipes |
| `context-engine` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | ContextAssembly + chunk scores | data pipes |
| `conversation-insights` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | ConversationRow[] + semantic search hits | data pipes |
| `daily-log` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | MemoryEntry[] grouped by day | data pipes |
| `dashboard` | `src/features/dashboard/index.tsx` | ACTIVE | core | ✓ | `Mod+1` | PerceptionState + HormoneState (split across RightNowHero + AmbientStrip childr… | data pipes |
| `decision-log` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | DecisionLog + AuthorityAuditLog + AuditLog | data pipes |
| `diagnostics` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | SupervisorHealth + Trace[] + AuthorityAgents + DeepScanResult + Config | data pipes |
| `dna` | `src/features/body/index.tsx` | ACTIVE | body | ✓ | — | DnaIdentity + goals + patterns | data pipes |
| `document-generator` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | Document[] + generation outputs | data pipes |
| `email-assistant` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | AutoReplyDraft + ReminderParse | data pipes |
| `emotional-intel` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | EmotionalTrend + EmotionReading[] (limit=50) | data pipes |
| `file-browser` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | FileTree + IndexStats + SymbolHits | data pipes |
| `finance` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Transaction[] + Subscription[] + KPIs | data pipes |
| `git-panel` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | GitStyle + mined repo stats | data pipes |
| `goals` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Goal[] with progress | data pipes |
| `habits` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Habit[] + streak data | data pipes |
| `health` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | HealthSnapshot { today, stats, streak, insights } | data pipes |
| `hive-ai-delegate` | `src/features/hive/index.tsx` | ACTIVE | hive | ✓ | — | DelegateResult + feedback outcome | data pipes |
| `hive-approval-queue` | `src/features/hive/index.tsx` | ACTIVE | hive | ✓ | — | PendingDecision[] + escalation events | data pipes |
| `hive-autonomy` | `src/features/hive/index.tsx` | ACTIVE | hive | ✓ | — | HiveStatus + per-organ autonomy levels | data pipes |
| `hive-mesh` | `src/features/hive/index.tsx` | ACTIVE | hive | ✓ | — | HiveStatus { tentacles[], global_autonomy } | data pipes |
| `hive-tentacle` | `src/features/hive/index.tsx` | ACTIVE | hive | ✓ | — | TentacleSummary + TentacleReport[] + per-organ autonomy | data pipes |
| `hormone-bus` | `src/features/body/index.tsx` | ACTIVE | body | ✓ | — | HormoneState + CircadianDirective | data pipes |
| `integration-status` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | IntegrationState + McpServer health | data pipes |
| `key-vault` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | ProviderKeys (keyring-masked) + store/delete actions | data pipes |
| `knowledge-base` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | KnowledgeEntry[] grouped under Knowledge/Memory/Timeline columns | data pipes |
| `knowledge-graph` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | GraphNode[] + GraphStats; hash-based polar layout | data pipes |
| `live-notes` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | MemoryEntry[] (recent) + manual add form | data pipes |
| `mcp-settings` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | McpServer[] + tool trust flags | data pipes |
| `meetings` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Meeting[] + search hits; detail pane on selection | data pipes |
| `memory-palace` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | TypedMemory[] per category (7 tabs: fact/preference/decision/skill/goal/routine… | data pipes |
| `model-comparison` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | TaskRouting + Provider health | data pipes |
| `negotiation` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | NegotiationSession { prompts, drafts, decisions } | data pipes |
| `onboarding` | `src/features/onboarding/index.tsx` | ACTIVE | core | ✗ | — | OnboardingStep + PersonaAnswers + ApiKeys + DeepScanProgress | data pipes |
| `organ-registry` | `src/features/body/index.tsx` | ACTIVE | body | ✓ | — | Organ[] { name, status, capabilities, autonomy_level } | data pipes |
| `persona` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | UserModel + PersonaTraits + ExpertiseMap + Mood | data pipes |
| `predictions` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Prediction[] { topic, confidence, rationale } | data pipes |
| `reasoning` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | ReasoningTrace[] + prompt output | data pipes |
| `reports` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | Report[] + webhook config | data pipes |
| `rewind-timeline` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | TimelineEntry[] windowed by slider ts | data pipes |
| `screen-timeline` | `src/features/knowledge/index.tsx` | ACTIVE | knowledge | ✓ | — | TimelineEntry[] + TimelineStats | data pipes |
| `security-dashboard` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | SecurityOverview + tabs (policies/scans/alerts/pentest) | data pipes |
| `settings` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | `Mod+,` | tabbed shell; landing pane defaults to Providers | data pipes |
| `settings-about` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | app version + build info + license | data pipes |
| `settings-appearance` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | Theme + density + motion prefs | data pipes |
| `settings-diagnostics` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | Thin entry pane delegating to admin/Diagnostics route | data pipes |
| `settings-iot` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | IoT integration state (Home Assistant + Spotify tokens/endpoints) | data pipes |
| `settings-models` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | Model selection per provider | data pipes |
| `settings-personality` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | Persona traits + chat style + external style import | data pipes |
| `settings-privacy` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | Telemetry + screen-timeline + audio-timeline toggles | data pipes |
| `settings-providers` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | BladeConfig provider fields + keyring-stored secrets | data pipes |
| `settings-routing` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | TaskRouting table (task_type -> provider/model) | data pipes |
| `settings-voice` | `src/features/settings/index.tsx` | ACTIVE | core | ✓ | — | Voice config (tts_speed, whisper_model, wake_word_enabled, ...) | data pipes |
| `sidecar` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | SidecarDevice[] + Kali tool results | data pipes |
| `social-graph` | `src/features/life-os/index.tsx` | ACTIVE | life | ✓ | — | Person[] + relationship edges | data pipes |
| `soul` | `src/features/identity/index.tsx` | ACTIVE | identity | ✓ | — | SoulState + CharacterBible + UserProfile | data pipes |
| `swarm-view` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | SwarmDag { nodes, edges } + SwarmProgress | data pipes |
| `task-agents` | `src/features/agents/index.tsx` | ACTIVE | agents | ✓ | — | Task { prompt, cli_target, status } | data pipes |
| `temporal` | `src/features/admin/index.tsx` | ACTIVE | admin | ✓ | — | DailyStandup + TemporalPattern[] + ExecutionMemory | data pipes |
| `terminal` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | ShellResult { stdout, stderr, exit_code } | data pipes |
| `web-automation` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | BrowserSessionStatus + BrowserAgentStep[] | data pipes |
| `workflow-builder` | `src/features/dev-tools/index.tsx` | ACTIVE | dev | ✓ | — | Workflow[] + WorkflowRun[] | data pipes |
| `world-model` | `src/features/body/index.tsx` | ACTIVE | body | ✓ | — | WorldState + summary; refreshes on WORLD_STATE_UPDATED event | data pipes |

### 2b. Dev-only Routes (gated on `import.meta.env.DEV`)

Source: `10-ROUTES.yaml::routes[]` filtered to `classification: "ACTIVE (dev-only)"`. Tree-shaken from prod bundle; live in `src/features/dev/index.tsx`.

| id | component_file | section | phase | palette_visible | notes |
|----|----------------|---------|-------|-----------------|-------|
| `primitives` | `src/features/dev/Primitives.tsx` | dev | 1 | ✗ | DEV harness for P-08 eyeball surface; static component showcase; gated by import.meta.env.DEV |
| `wrapper-smoke` | `src/features/dev/WrapperSmoke.tsx` | dev | 1 | ✗ | DEV: P-04 invokeTyped harness; gated by import.meta.env.DEV |
| `diagnostics-dev` | `src/features/dev/Diagnostics.tsx` | dev | 1 | ✗ | DEV: listener counter + perf marks (P-01, P-06); gated by import.meta.env.DEV |
| `dev-voice-orb` | `src/features/dev/VoiceOrbDev.tsx` | dev | 4 | ✗ | DEV: Voice Orb isolation (SC-2 phase transitions falsifier); gated by import.meta.env.DEV; test shim mocks invokes |
| `dev-ghost` | `src/features/dev/GhostDev.tsx` | dev | 4 | ✗ | DEV: Ghost overlay isolation (SC-3 + D-10 headline falsifier); gated by import.meta.env.DEV |
| `dev-hud` | `src/features/dev/HudDev.tsx` | dev | 4 | ✗ | DEV: HUD bar isolation (SC-4 render + menu); gated by import.meta.env.DEV |
| `dev-agent-detail` | `src/features/dev/AgentDetailDev.tsx` | dev | 5 | ✗ | DEV: AgentDetail isolation (SC-2 real-time timeline, WIRE-05); gated by import.meta.env.DEV |
| `dev-swarm-view` | `src/features/dev/SwarmViewDev.tsx` | dev | 5 | ✗ | DEV: SwarmView isolation (SC-1 explicit DAG render); gated by import.meta.env.DEV |
| `dev-knowledge-base` | `src/features/dev/KnowledgeBaseDev.tsx` | dev | 5 | ✗ | DEV: KnowledgeBase isolation (SC-4 D-138 grouped search); gated by import.meta.env.DEV |
| `dev-health-view` | `src/features/dev/HealthViewDev.tsx` | dev | 6 | ✗ | DEV: HealthView isolation (SC-1 snapshot + streak + 5 stats); gated by import.meta.env.DEV |
| `dev-finance-view` | `src/features/dev/FinanceViewDev.tsx` | dev | 6 | ✗ | DEV: FinanceView isolation (SC-2 KPIs + CSV import affordance); gated by import.meta.env.DEV |
| `dev-character-bible` | `src/features/dev/CharacterBibleDev.tsx` | dev | 6 | ✗ | DEV: CharacterBible isolation (SC-4 bible content + honest log deferral); gated by import.meta.env.DEV |
| `dev-persona-view` | `src/features/dev/PersonaViewDev.tsx` | dev | 6 | ✗ | DEV: PersonaView isolation (SC-3 + SC-4 4-tab dossier); gated by import.meta.env.DEV |
| `dev-terminal` | `src/features/dev/TerminalDev.tsx` | dev | 7 | ✗ | DEV: Terminal isolation (SC-1 run_shell path); gated by import.meta.env.DEV |
| `dev-workflow-builder` | `src/features/dev/WorkflowBuilderDev.tsx` | dev | 7 | ✗ | DEV: WorkflowBuilder isolation (DEV-05 list + detail + tabs); gated by import.meta.env.DEV |
| `dev-security-dashboard` | `src/features/dev/SecurityDashboardDev.tsx` | dev | 7 | ✗ | DEV: SecurityDashboard isolation (SC-4 hero + 4 tabs + pentest warning); gated by import.meta.env.DEV |
| `dev-mcp-settings` | `src/features/dev/McpSettingsDev.tsx` | dev | 7 | ✗ | DEV: McpSettings isolation (ADMIN-09 CRUD + tool trust); gated by import.meta.env.DEV |
| `dev-body-map` | `src/features/dev/BodyMapDev.tsx` | dev | 8 | ✗ | DEV: BodyMap isolation (SC-1 grid + drill-in); gated by import.meta.env.DEV |
| `dev-hive-mesh` | `src/features/dev/HiveMeshDev.tsx` | dev | 8 | ✗ | DEV: HiveMesh isolation (SC-3 tentacle grid + autonomy Dialog); gated by import.meta.env.DEV |
| `dev-approval-queue` | `src/features/dev/ApprovalQueueDev.tsx` | dev | 8 | ✗ | DEV: ApprovalQueue isolation (SC-4 approve fires hive_approve_decision); gated by import.meta.env.DEV |

### 2c. Window Shells (no palette by design)

Source: `10-ROUTES.yaml::windows[]`. Not in JSON because they are shells, not routes. 4 non-main windows; CommandPalette is main-only per Pitfall 1.

| label | file | component | classification | notes |
|-------|------|-----------|----------------|-------|
| `quickask` | `src/windows/quickask/main.tsx` | `src/features/quickask/QuickAskWindow.tsx` | ACTIVE | Overlay window (QUICK-01..07); no palette by design. Mounts QuickAskWindow from @/features/quickask. Bridges to main chat via blade_quickask_bridged event. |
| `hud` | `src/windows/hud/main.tsx` | `src/features/hud/HudWindow.tsx` | ACTIVE | HUD strip; no palette by design. Rust label `blade_hud` (overlay_manager.rs). Subscribes hud_data_updated + hormone_update + godmode_update (D-13 cross-window … |
| `ghost` | `src/windows/ghost/main.tsx` | `src/features/ghost/GhostOverlayWindow.tsx` | ACTIVE | Content-protected overlay; no palette by design. Rust label `ghost_overlay` (ghost_mode.rs:471); .content_protected(true) set at window creation, not CSS. |
| `overlay` | `src/windows/overlay/main.tsx` | `src/features/voice-orb/VoiceOrbWindow.tsx` | ACTIVE | Voice orb overlay (label stays `overlay` per D-106 so existing emit_to('overlay', ...) sites keep working). No palette by design. Fullscreen transparent always… |

---

## 3. Config Surface Catalog

Source: `10-WIRING-AUDIT.json::config[]` (155 rows; folded representation of struct fields + statics + env vars + cargo features + keyring secrets) with non-struct surfaces surfaced in sub-tables 3b–3e below for readability.

### 3a. BladeConfig + DiskConfig struct fields

Source: `10-CONFIG.yaml::config[]` (90 fields). The `struct` column disambiguates in-memory `BladeConfig` from on-disk `DiskConfig` (both share many names; presence in both is the 6-place-rule contract).

| field | file:line | struct | disk_persisted | classification | ui_surface | control_type |
|-------|-----------|--------|----------------|----------------|------------|--------------|
| `BladeConfig.provider` | `src-tauri/src/config.rs:226` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/ProvidersPane.tsx` | string |
| `BladeConfig.api_key` | `src-tauri/src/config.rs:227` | BladeConfig | ✗ | ACTIVE | `src/features/settings/panes/ProvidersPane.tsx` | string |
| `BladeConfig.model` | `src-tauri/src/config.rs:228` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/ModelsPane.tsx` | string |
| `BladeConfig.onboarded` | `src-tauri/src/config.rs:229` | BladeConfig | ✓ | ACTIVE | `src/features/onboarding` | bool |
| `BladeConfig.mcp_servers` | `src-tauri/src/config.rs:231` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/ProvidersPane.tsx` | list |
| `BladeConfig.window_state` | `src-tauri/src/config.rs:233` | BladeConfig | ✓ | ACTIVE | — | map |
| `BladeConfig.token_efficient` | `src-tauri/src/config.rs:235` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/ModelsPane.tsx` | bool |
| `BladeConfig.user_name` | `src-tauri/src/config.rs:237` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `BladeConfig.work_mode` | `src-tauri/src/config.rs:239` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `BladeConfig.response_style` | `src-tauri/src/config.rs:241` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `BladeConfig.blade_email` | `src-tauri/src/config.rs:243` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `BladeConfig.base_url` | `src-tauri/src/config.rs:245` | BladeConfig | ✓ | ACTIVE | `src/features/onboarding` | string |
| `BladeConfig.god_mode` | `src-tauri/src/config.rs:247` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.god_mode_tier` | `src-tauri/src/config.rs:249` | BladeConfig | ✓ | WIRED-NOT-USED | — | enum |
| `BladeConfig.voice_mode` | `src-tauri/src/config.rs:251` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | enum |
| `BladeConfig.obsidian_vault_path` | `src-tauri/src/config.rs:253` | BladeConfig | ✓ | WIRED-NOT-USED | — | string |
| `BladeConfig.tts_voice` | `src-tauri/src/config.rs:255` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | string |
| `BladeConfig.quick_ask_shortcut` | `src-tauri/src/config.rs:257` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | string |
| `BladeConfig.voice_shortcut` | `src-tauri/src/config.rs:259` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | string |
| `BladeConfig.screen_timeline_enabled` | `src-tauri/src/config.rs:261` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.timeline_capture_interval` | `src-tauri/src/config.rs:263` | BladeConfig | ✓ | WIRED-NOT-USED | — | number |
| `BladeConfig.timeline_retention_days` | `src-tauri/src/config.rs:265` | BladeConfig | ✓ | WIRED-NOT-USED | — | number |
| `BladeConfig.wake_word_enabled` | `src-tauri/src/config.rs:267` | BladeConfig | ✓ | WIRED-NOT-USED | `src/features/settings/panes/VoicePane.tsx` | bool |
| `BladeConfig.wake_word_phrase` | `src-tauri/src/config.rs:269` | BladeConfig | ✓ | WIRED-NOT-USED | — | string |
| `BladeConfig.wake_word_sensitivity` | `src-tauri/src/config.rs:271` | BladeConfig | ✓ | WIRED-NOT-USED | — | number |
| `BladeConfig.active_role` | `src-tauri/src/config.rs:273` | BladeConfig | ✓ | WIRED-NOT-USED | — | string |
| `BladeConfig.blade_source_path` | `src-tauri/src/config.rs:275` | BladeConfig | ✓ | WIRED-NOT-USED | — | string |
| `BladeConfig.trusted_ai_delegate` | `src-tauri/src/config.rs:277` | BladeConfig | ✓ | WIRED-NOT-USED | — | enum |
| `BladeConfig.blade_dedicated_monitor` | `src-tauri/src/config.rs:279` | BladeConfig | ✓ | WIRED-NOT-USED | — | number |
| `BladeConfig.task_routing` | `src-tauri/src/config.rs:281` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/RoutingPane.tsx` | map |
| `BladeConfig.background_ai_enabled` | `src-tauri/src/config.rs:283` | BladeConfig | ✓ | ACTIVE | — | bool |
| `BladeConfig.persona_onboarding_complete` | `src-tauri/src/config.rs:285` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | bool |
| `BladeConfig.fallback_providers` | `src-tauri/src/config.rs:289` | BladeConfig | ✓ | WIRED-NOT-USED | — | list |
| `BladeConfig.use_local_whisper` | `src-tauri/src/config.rs:292` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.whisper_model` | `src-tauri/src/config.rs:295` | BladeConfig | ✓ | WIRED-NOT-USED | — | enum |
| `BladeConfig.last_deep_scan` | `src-tauri/src/config.rs:298` | BladeConfig | ✓ | ACTIVE | — | number |
| `BladeConfig.integration_polling_enabled` | `src-tauri/src/config.rs:301` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.tts_speed` | `src-tauri/src/config.rs:304` | BladeConfig | ✓ | WIRED-NOT-USED | — | number |
| `BladeConfig.ha_base_url` | `src-tauri/src/config.rs:307` | BladeConfig | ✓ | ACTIVE | `src/features/settings/panes/IoTPane.tsx` | string |
| `BladeConfig.audio_capture_enabled` | `src-tauri/src/config.rs:310` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.ghost_mode_enabled` | `src-tauri/src/config.rs:313` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.ghost_mode_position` | `src-tauri/src/config.rs:316` | BladeConfig | ✓ | WIRED-NOT-USED | — | enum |
| `BladeConfig.ghost_auto_reply` | `src-tauri/src/config.rs:319` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.hive_enabled` | `src-tauri/src/config.rs:322` | BladeConfig | ✓ | WIRED-NOT-USED | — | bool |
| `BladeConfig.hive_autonomy` | `src-tauri/src/config.rs:325` | BladeConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.provider` | `src-tauri/src/config.rs:56` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/ProvidersPane.tsx` | string |
| `DiskConfig.model` | `src-tauri/src/config.rs:57` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/ModelsPane.tsx` | string |
| `DiskConfig.onboarded` | `src-tauri/src/config.rs:58` | DiskConfig | ✓ | ACTIVE | `src/features/onboarding` | bool |
| `DiskConfig.mcp_servers` | `src-tauri/src/config.rs:60` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/ProvidersPane.tsx` | list |
| `DiskConfig.window_state` | `src-tauri/src/config.rs:62` | DiskConfig | ✓ | ACTIVE | — | map |
| `DiskConfig.token_efficient` | `src-tauri/src/config.rs:64` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/ModelsPane.tsx` | bool |
| `DiskConfig.user_name` | `src-tauri/src/config.rs:66` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `DiskConfig.work_mode` | `src-tauri/src/config.rs:68` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `DiskConfig.response_style` | `src-tauri/src/config.rs:70` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `DiskConfig.blade_email` | `src-tauri/src/config.rs:72` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | string |
| `DiskConfig.base_url` | `src-tauri/src/config.rs:74` | DiskConfig | ✓ | ACTIVE | `src/features/onboarding` | string |
| `DiskConfig.god_mode` | `src-tauri/src/config.rs:76` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.god_mode_tier` | `src-tauri/src/config.rs:78` | DiskConfig | ✓ | WIRED-NOT-USED | — | enum |
| `DiskConfig.voice_mode` | `src-tauri/src/config.rs:80` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | enum |
| `DiskConfig.obsidian_vault_path` | `src-tauri/src/config.rs:82` | DiskConfig | ✓ | WIRED-NOT-USED | — | string |
| `DiskConfig.tts_voice` | `src-tauri/src/config.rs:84` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | string |
| `DiskConfig.quick_ask_shortcut` | `src-tauri/src/config.rs:86` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | string |
| `DiskConfig.voice_shortcut` | `src-tauri/src/config.rs:88` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/VoicePane.tsx` | string |
| `DiskConfig.screen_timeline_enabled` | `src-tauri/src/config.rs:90` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.timeline_capture_interval` | `src-tauri/src/config.rs:92` | DiskConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.timeline_retention_days` | `src-tauri/src/config.rs:94` | DiskConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.wake_word_enabled` | `src-tauri/src/config.rs:96` | DiskConfig | ✓ | WIRED-NOT-USED | `src/features/settings/panes/VoicePane.tsx` | bool |
| `DiskConfig.wake_word_phrase` | `src-tauri/src/config.rs:98` | DiskConfig | ✓ | WIRED-NOT-USED | — | string |
| `DiskConfig.wake_word_sensitivity` | `src-tauri/src/config.rs:100` | DiskConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.active_role` | `src-tauri/src/config.rs:102` | DiskConfig | ✓ | WIRED-NOT-USED | — | string |
| `DiskConfig.blade_source_path` | `src-tauri/src/config.rs:104` | DiskConfig | ✓ | WIRED-NOT-USED | — | string |
| `DiskConfig.trusted_ai_delegate` | `src-tauri/src/config.rs:106` | DiskConfig | ✓ | WIRED-NOT-USED | — | enum |
| `DiskConfig.blade_dedicated_monitor` | `src-tauri/src/config.rs:108` | DiskConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.task_routing` | `src-tauri/src/config.rs:110` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/RoutingPane.tsx` | map |
| `DiskConfig.background_ai_enabled` | `src-tauri/src/config.rs:112` | DiskConfig | ✓ | ACTIVE | — | bool |
| `DiskConfig.persona_onboarding_complete` | `src-tauri/src/config.rs:114` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/PersonalityPane.tsx` | bool |
| `DiskConfig.fallback_providers` | `src-tauri/src/config.rs:118` | DiskConfig | ✓ | WIRED-NOT-USED | — | list |
| `DiskConfig.use_local_whisper` | `src-tauri/src/config.rs:120` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.whisper_model` | `src-tauri/src/config.rs:122` | DiskConfig | ✓ | WIRED-NOT-USED | — | enum |
| `DiskConfig.last_deep_scan` | `src-tauri/src/config.rs:125` | DiskConfig | ✓ | ACTIVE | — | number |
| `DiskConfig.integration_polling_enabled` | `src-tauri/src/config.rs:128` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.tts_speed` | `src-tauri/src/config.rs:130` | DiskConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.ha_base_url` | `src-tauri/src/config.rs:133` | DiskConfig | ✓ | ACTIVE | `src/features/settings/panes/IoTPane.tsx` | string |
| `DiskConfig.audio_capture_enabled` | `src-tauri/src/config.rs:135` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.ghost_mode_enabled` | `src-tauri/src/config.rs:137` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.ghost_mode_position` | `src-tauri/src/config.rs:139` | DiskConfig | ✓ | WIRED-NOT-USED | — | enum |
| `DiskConfig.ghost_auto_reply` | `src-tauri/src/config.rs:141` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.hive_enabled` | `src-tauri/src/config.rs:144` | DiskConfig | ✓ | WIRED-NOT-USED | — | bool |
| `DiskConfig.hive_autonomy` | `src-tauri/src/config.rs:147` | DiskConfig | ✓ | WIRED-NOT-USED | — | number |
| `DiskConfig.api_key` | `src-tauri/src/config.rs:150` | DiskConfig | ✗ | DEAD | — | string |

Rows with `disk_persisted: false` in `BladeConfig` that have a matching pub field in `DiskConfig` are flagged as 6-place-rule violations per Pitfall 8. Phase 14 WIRE2 agenda consumes them via `not_wired_backlog[item_type=config]`.

### 3b. Static AtomicBool / Lazy toggles (non-field config)

Source: `10-CONFIG.yaml::statics[]` (34 entries). Surfaced in `10-WIRING-AUDIT.json::config[]` as `field: "static::<NAME>"`. These are internal control-loop guards (see `notes/v1-1-milestone-shape.md` §"Why this framing" #4 — "Background terminal noise, no in-UI activity surface"); LOG-02 (Phase 14) will instrument emit coverage for them.

| name | file:line | type | default | toggled_by | classification |
|------|-----------|------|---------|------------|----------------|
| `HABIT_REMINDER_ACTIVE` | `src-tauri/src/habit_engine.rs:734` | AtomicBool | `false` | habit_engine::start_habit_reminder (habit_engine.rs) | ACTIVE (internal) |
| `TTS_ACTIVE` | `src-tauri/src/tts.rs:139` | AtomicBool | `false` | tts::speak / tts::stop | ACTIVE (internal) |
| `HUD_VISIBLE` | `src-tauri/src/overlay_manager.rs:17` | AtomicBool | `false` | overlay_manager::show_hud / hide_hud | ACTIVE (internal) |
| `CAUSAL_ENGINE_RUNNING` | `src-tauri/src/causal_graph.rs:605` | AtomicBool | `false` | causal_graph::start_engine | ACTIVE (internal) |
| `MONITOR_RUNNING` | `src-tauri/src/sidecar.rs:367` | AtomicBool | `false` | sidecar::start_monitor | ACTIVE (internal) |
| `SERVER_RUNNING` | `src-tauri/src/sidecar.rs:385` | AtomicBool | `false` | sidecar::start_server | ACTIVE (internal) |
| `ACCOUNTABILITY_ACTIVE` | `src-tauri/src/accountability.rs:795` | AtomicBool | `false` | accountability::start_check_in_loop | ACTIVE (internal) |
| `IS_RECORDING` | `src-tauri/src/voice_global.rs:31` | AtomicBool | `false` | voice_global::start_recording / stop_recording | ACTIVE (internal) |
| `TTS_INTERRUPT` | `src-tauri/src/voice_global.rs:35` | AtomicBool | `false` | voice_global::interrupt_tts (user input detected) | ACTIVE (internal) |
| `CONV_ACTIVE` | `src-tauri/src/voice_global.rs:38` | AtomicBool | `false` | voice_global::start_conversation / end_conversation | ACTIVE (internal) |
| `WAKE_ACTIVE` | `src-tauri/src/wake_word.rs:80` | AtomicBool | `false` | wake_word::start_wake_listener | ACTIVE (internal) |
| `ENGINE_RUNNING` | `src-tauri/src/goal_engine.rs:10` | AtomicBool | `false` | goal_engine::start | ACTIVE (internal) |
| `RESEARCH_RUNNING` | `src-tauri/src/autonomous_research.rs:12` | AtomicBool | `false` | autonomous_research::start | ACTIVE (internal) |
| `WATCHER_RUNNING` | `src-tauri/src/tentacles/terminal_watch.rs:19` | AtomicBool | `false` | tentacles::terminal_watch::start | ACTIVE (internal) |
| `HYPOTHALAMUS_RUNNING` | `src-tauri/src/homeostasis.rs:94` | AtomicBool | `false` | homeostasis::start_hypothalamus | ACTIVE (internal) |
| `TAILING_ACTIVE` | `src-tauri/src/tentacles/log_monitor.rs:26` | AtomicBool | `false` | tentacles::log_monitor::start_tail | ACTIVE (internal) |
| `FS_WATCHER_RUNNING` | `src-tauri/src/tentacles/filesystem_watch.rs:22` | AtomicBool | `false` | tentacles::filesystem_watch::start | ACTIVE (internal) |
| `DREAM_MONITOR_RUNNING` | `src-tauri/src/dream_mode.rs:12` | AtomicBool | `false` | dream_mode::start_monitor | ACTIVE (internal) |
| `DREAMING` | `src-tauri/src/dream_mode.rs:13` | AtomicBool | `false` | dream_mode::begin_dream / end_dream | ACTIVE (internal) |
| `SCANNING` | `src-tauri/src/file_indexer.rs:22` | AtomicBool | `false` | file_indexer::scan | ACTIVE (internal) |
| `STARTED` | `src-tauri/src/file_indexer.rs:404` | AtomicBool | `false` | file_indexer::start_background_indexer | ACTIVE (internal) |
| `GHOST_ACTIVE` | `src-tauri/src/ghost_mode.rs:42` | AtomicBool | `false` | ghost_mode::start / stop | ACTIVE (internal) |
| `MONITOR_ACTIVE` | `src-tauri/src/activity_monitor.rs:23` | AtomicBool | `false` | activity_monitor::start | ACTIVE (internal) |
| `WEEKLY_UPDATE_RUNNING` | `src-tauri/src/persona_engine.rs:571` | AtomicBool | `false` | persona_engine::weekly_update | ACTIVE (internal) |
| `ENGINE_RUNNING` | `src-tauri/src/proactive_engine.rs:21` | AtomicBool | `false` | proactive_engine::start | ACTIVE (internal) |
| `LEARNING_ACTIVE` | `src-tauri/src/learning_engine.rs:985` | AtomicBool | `false` | learning_engine::start | ACTIVE (internal) |
| `AUDIO_CAPTURE_ACTIVE` | `src-tauri/src/audio_timeline.rs:21` | AtomicBool | `false` | audio_timeline::start_capture / stop_capture | ACTIVE (internal) |
| `NUDGE_ACTIVE` | `src-tauri/src/health_tracker.rs:407` | AtomicBool | `false` | health_tracker::push_nudge | ACTIVE (internal) |
| `MONITOR_RUNNING` | `src-tauri/src/health_guardian.rs:36` | AtomicBool | `false` | health_guardian::start_monitor | ACTIVE (internal) |
| `DESCRIBE_NEXT_FRAME` | `src-tauri/src/screen_timeline.rs:21` | AtomicBool | `true` | screen_timeline::request_description / consumed in describe loop | ACTIVE (internal) |
| `CHAT_CANCEL` | `src-tauri/src/commands.rs:24` | AtomicBool | `false` | commands::cancel_chat (#[tauri::command]) | ACTIVE |
| `CHAT_INFLIGHT` | `src-tauri/src/commands.rs:25` | AtomicBool | `false` | commands::send_message_stream (enter/exit) | ACTIVE (internal) |
| `LOOP_RUNNING` | `src-tauri/src/perception_fusion.rs:58` | AtomicBool | `false` | perception_fusion::start_fusion | ACTIVE (internal) |
| `SCHEDULER_RUNNING` | `src-tauri/src/workflow_builder.rs:19` | AtomicBool | `false` | workflow_builder::start_scheduler | ACTIVE (internal) |

### 3c. Environment variables

Source: `10-CONFIG.yaml::env_vars[]` (16 entries). Surfaced in JSON as `field: "env::<NAME>"`.

| name | file:line | read_by | classification | ui_surface |
|------|-----------|---------|----------------|------------|
| `COMPUTERNAME` | `src-tauri/src/sidecar.rs:550` | sidecar::hostname (Windows host identification) | ACTIVE (internal) | — |
| `HOSTNAME` | `src-tauri/src/sidecar.rs:551` | sidecar::hostname (fallback after COMPUTERNAME) | ACTIVE (internal) | — |
| `TEMP` | `src-tauri/src/background_agent.rs:165` | background_agent::workspace_root (Windows temp dir) | ACTIVE (internal) | — |
| `BLADE_CURRENT_MSG_ID` | `src-tauri/src/providers/anthropic.rs:358` | providers::anthropic::stream_completion (thinking-block message id tag) | WIRED-NOT-USED | — |
| `TEMP` | `src-tauri/src/hive.rs:1285` | hive::workspace_root (Windows temp) | ACTIVE (internal) | — |
| `LOCALAPPDATA` | `src-tauri/src/notification_listener.rs:134` | notification_listener::windows_notification_history_path | ACTIVE (internal) | — |
| `HOME` | `src-tauri/src/notification_listener.rs:335` | notification_listener::macos_notification_path | ACTIVE (internal) | — |
| `TEMP` | `src-tauri/src/cron.rs:496` | cron::default_cwd (Windows temp for scheduled task fallback) | ACTIVE (internal) | — |
| `HISTFILE` | `src-tauri/src/deep_scan.rs:489` | deep_scan::zsh_history_path | ACTIVE (internal) | — |
| `USERNAME` | `src-tauri/src/persona_engine.rs:771` | persona_engine::detect_os_username (Windows) | ACTIVE (internal) | — |
| `USER` | `src-tauri/src/persona_engine.rs:772` | persona_engine::detect_os_username (Unix fallback) | ACTIVE (internal) | — |
| `HOME` | `src-tauri/src/world_model.rs:176` | world_model::home_dir (primary) | ACTIVE (internal) | — |
| `USERPROFILE` | `src-tauri/src/world_model.rs:177` | world_model::home_dir (Windows fallback) | ACTIVE (internal) | — |
| `HOME` | `src-tauri/src/world_model.rs:565` | world_model::resolve_user_paths (duplicate home-dir lookup) | ACTIVE (internal) | — |
| `USERPROFILE` | `src-tauri/src/world_model.rs:566` | world_model::resolve_user_paths (Windows fallback duplicate) | ACTIVE (internal) | — |
| `<dynamic env_key>` | `src-tauri/src/runtimes.rs:509` | runtimes::resolve_runtime_path (reads a runtime-configured env var name) | ACTIVE (internal) | — |

### 3d. Cargo feature flags

Source: `10-CONFIG.yaml::cargo_features[]` (1 entry). Surfaced in JSON as `field: "cargo_feature::<NAME>"`.

| name | file:line | default_enabled | gated_modules | classification |
|------|-----------|-----------------|----------------|----------------|
| `local-whisper` | `src-tauri/Cargo.toml:62` | ✗ | `src-tauri/src/whisper_local.rs`, `src-tauri/src/ghost_mode.rs` | NOT-WIRED |

### 3e. Keyring-stored secrets (location only)

Source: `10-CONFIG.yaml::keyring_secrets[]` (14 entries). Values never read; storage location only. Surfaced in JSON as `field: "keyring::<service>::<key>"`.

| service | key | file:line | storage_location |
|---------|-----|-----------|-------------------|
| `blade-ai` | `<provider>` | `src-tauri/src/config.rs:404` | keyring |
| `blade-ai` | `<provider>` | `src-tauri/src/config.rs:419` | keyring |
| `blade-ai` | `openai` | `src-tauri/src/tts.rs:299` | keyring |
| `blade-ai` | `groq-whisper` | `src-tauri/src/voice.rs:139` | keyring |
| `blade-ai` | `groq` | `src-tauri/src/voice.rs:144` | keyring |
| `blade-ai` | `groq-whisper` | `src-tauri/src/voice.rs:216` | keyring |
| `blade-ai` | `groq` | `src-tauri/src/voice.rs:221` | keyring |
| `blade-ai` | `encryption-key` | `src-tauri/src/crypto.rs:21` | keyring |
| `blade-ai` | `telegram_bot_token` | `src-tauri/src/telegram.rs:110` | keyring |
| `blade-ai` | `telegram_bot_token` | `src-tauri/src/telegram.rs:117` | keyring |
| `blade-ai` | `telegram_bot_token` | `src-tauri/src/telegram.rs:124` | keyring |
| `blade-ai` | `discord_webhook_url` | `src-tauri/src/discord.rs:22` | keyring |
| `blade-ai` | `discord_webhook_url` | `src-tauri/src/discord.rs:29` | keyring |
| `blade-ai` | `discord_webhook_url` | `src-tauri/src/discord.rs:36` | keyring |

---

## 4. NOT-WIRED Backlog

Source: `10-WIRING-AUDIT.json::not_wired_backlog[]` (99 rows). Phase 14 WIRE2 consumes verbatim.

| item_type | identifier | backend_entry_points | phase_14_owner | deferral_rationale |
|-----------|-----------|----------------------|-----------------|--------------------|
| module | `src-tauri/src/auto_fix.rs` | `src-tauri/src/auto_fix.rs:950`, `src-tauri/src/auto_fix.rs:955`, `src-tauri/src/auto_fix.rs:964` | WIRE2 | — |
| module | `src-tauri/src/autonomous_research.rs` | `src-tauri/src/autonomous_research.rs:387`, `src-tauri/src/autonomous_research.rs:418`, `src-tauri/src/autonomous_research.rs:424` | WIRE2 | — |
| module | `src-tauri/src/brain.rs` | `src-tauri/src/brain.rs:1641`, `src-tauri/src/brain.rs:1839`, `src-tauri/src/brain.rs:1844`, `src-tauri/src/brain.rs:1850`, `src-tauri/src/brain.rs:1855` | WIRE2 | — |
| module | `src-tauri/src/causal_graph.rs` | `src-tauri/src/causal_graph.rs:728`, `src-tauri/src/causal_graph.rs:763`, `src-tauri/src/causal_graph.rs:770`, `src-tauri/src/causal_graph.rs:777`, `src-tauri/src/causal_graph.rs:784` | WIRE2 | — |
| module | `src-tauri/src/clipboard.rs` | `src-tauri/src/clipboard.rs:414`, `src-tauri/src/clipboard.rs:421`, `src-tauri/src/clipboard.rs:429` | WIRE2 | — |
| module | `src-tauri/src/consequence.rs` | `src-tauri/src/consequence.rs:285` | WIRE2 | — |
| module | `src-tauri/src/context.rs` | `src-tauri/src/context.rs:21`, `src-tauri/src/context.rs:42`, `src-tauri/src/context.rs:64`, `src-tauri/src/context.rs:405` | WIRE2 | — |
| module | `src-tauri/src/deeplearn.rs` | `src-tauri/src/deeplearn.rs:35`, `src-tauri/src/deeplearn.rs:160` | WIRE2 | — |
| module | `src-tauri/src/discord.rs` | `src-tauri/src/discord.rs:156`, `src-tauri/src/discord.rs:183`, `src-tauri/src/discord.rs:190`, `src-tauri/src/discord.rs:201` | DEFERRED_V1_2 | deferred to v1.2 — acting capability (M-03 observe-only guardrail) |
| module | `src-tauri/src/discovery.rs` | `src-tauri/src/discovery.rs:62`, `src-tauri/src/discovery.rs:689` | WIRE2 | — |
| module | `src-tauri/src/dream_mode.rs` | `src-tauri/src/dream_mode.rs:511`, `src-tauri/src/dream_mode.rs:516`, `src-tauri/src/dream_mode.rs:534` | WIRE2 | — |
| module | `src-tauri/src/ghost_mode.rs` | `src-tauri/src/ghost_mode.rs:859`, `src-tauri/src/ghost_mode.rs:873`, `src-tauri/src/ghost_mode.rs:884`, `src-tauri/src/ghost_mode.rs:930` | WIRE2 | — |
| module | `src-tauri/src/godmode.rs` | `src-tauri/src/godmode.rs:125`, `src-tauri/src/godmode.rs:130`, `src-tauri/src/godmode.rs:139` | WIRE2 | — |
| module | `src-tauri/src/journal.rs` | `src-tauri/src/journal.rs:174`, `src-tauri/src/journal.rs:180` | WIRE2 | — |
| module | `src-tauri/src/metacognition.rs` | `src-tauri/src/metacognition.rs:373` | WIRE2 | — |
| module | `src-tauri/src/multimodal.rs` | `src-tauri/src/multimodal.rs:562`, `src-tauri/src/multimodal.rs:571`, `src-tauri/src/multimodal.rs:580`, `src-tauri/src/multimodal.rs:586`, `src-tauri/src/multimodal.rs:592`, `src-tauri/src/multimodal.rs:598`, `src-tauri/src/multimodal.rs:604` | WIRE2 | — |
| module | `src-tauri/src/notification_listener.rs` | `src-tauri/src/notification_listener.rs:73`, `src-tauri/src/notification_listener.rs:80` | WIRE2 | — |
| module | `src-tauri/src/obsidian.rs` | `src-tauri/src/obsidian.rs:171`, `src-tauri/src/obsidian.rs:181`, `src-tauri/src/obsidian.rs:192`, `src-tauri/src/obsidian.rs:213`, `src-tauri/src/obsidian.rs:222` | WIRE2 | — |
| module | `src-tauri/src/plugins/registry.rs` | `src-tauri/src/plugins/registry.rs:6`, `src-tauri/src/plugins/registry.rs:11`, `src-tauri/src/plugins/registry.rs:16`, `src-tauri/src/plugins/registry.rs:21`, `src-tauri/src/plugins/registry.rs:26` | WIRE2 | — |
| module | `src-tauri/src/prefrontal.rs` | `src-tauri/src/prefrontal.rs:152`, `src-tauri/src/prefrontal.rs:157` | WIRE2 | — |
| module | `src-tauri/src/proactive_engine.rs` | `src-tauri/src/proactive_engine.rs:779`, `src-tauri/src/proactive_engine.rs:814`, `src-tauri/src/proactive_engine.rs:820`, `src-tauri/src/proactive_engine.rs:826`, `src-tauri/src/proactive_engine.rs:858`, `src-tauri/src/proactive_engine.rs:875` | WIRE2 | — |
| module | `src-tauri/src/proactive_vision.rs` | `src-tauri/src/proactive_vision.rs:474`, `src-tauri/src/proactive_vision.rs:506`, `src-tauri/src/proactive_vision.rs:511` | WIRE2 | — |
| module | `src-tauri/src/pulse.rs` | `src-tauri/src/pulse.rs:327`, `src-tauri/src/pulse.rs:390`, `src-tauri/src/pulse.rs:766`, `src-tauri/src/pulse.rs:817`, `src-tauri/src/pulse.rs:1083`, `src-tauri/src/pulse.rs:1089` | WIRE2 | — |
| module | `src-tauri/src/rag.rs` | `src-tauri/src/rag.rs:31`, `src-tauri/src/rag.rs:78`, `src-tauri/src/rag.rs:184` | WIRE2 | — |
| module | `src-tauri/src/research.rs` | `src-tauri/src/research.rs:251`, `src-tauri/src/research.rs:257`, `src-tauri/src/research.rs:276` | WIRE2 | — |
| module | `src-tauri/src/roles.rs` | `src-tauri/src/roles.rs:298`, `src-tauri/src/roles.rs:303`, `src-tauri/src/roles.rs:310` | WIRE2 | — |
| module | `src-tauri/src/router.rs` | `src-tauri/src/router.rs:164` | WIRE2 | — |
| module | `src-tauri/src/runtimes.rs` | `src-tauri/src/runtimes.rs:1300`, `src-tauri/src/runtimes.rs:1316`, `src-tauri/src/runtimes.rs:1337`, `src-tauri/src/runtimes.rs:1366`, `src-tauri/src/runtimes.rs:1386`, `src-tauri/src/runtimes.rs:1399`, `src-tauri/src/runtimes.rs:2572`, `src-tauri/src/runtimes.rs:2597`, `src-tauri/src/runtimes.rs:2622`, `src-tauri/src/runtimes.rs:2642`, `src-tauri/src/runtimes.rs:2651`, `src-tauri/src/runtimes.rs:2685`, `src-tauri/src/runtimes.rs:2694`, `src-tauri/src/runtimes.rs:2699`, `src-tauri/src/runtimes.rs:2741`, `src-tauri/src/runtimes.rs:2755`, `src-tauri/src/runtimes.rs:2772`, `src-tauri/src/runtimes.rs:4967`, `src-tauri/src/runtimes.rs:5289`, `src-tauri/src/runtimes.rs:5371`, `src-tauri/src/runtimes.rs:5459`, `src-tauri/src/runtimes.rs:5610`, `src-tauri/src/runtimes.rs:5657`, `src-tauri/src/runtimes.rs:5682`, `src-tauri/src/runtimes.rs:5696`, `src-tauri/src/runtimes.rs:5709`, `src-tauri/src/runtimes.rs:5738` | WIRE2 | — |
| module | `src-tauri/src/screen.rs` | `src-tauri/src/screen.rs:100`, `src-tauri/src/screen.rs:173`, `src-tauri/src/screen.rs:194`, `src-tauri/src/screen.rs:232` | WIRE2 | — |
| module | `src-tauri/src/self_code.rs` | `src-tauri/src/self_code.rs:66`, `src-tauri/src/self_code.rs:132` | WIRE2 | — |
| module | `src-tauri/src/session_handoff.rs` | `src-tauri/src/session_handoff.rs:147`, `src-tauri/src/session_handoff.rs:153`, `src-tauri/src/session_handoff.rs:159` | DEFERRED_V1_2 | deferred to v1.2 — acting capability (M-03 observe-only guardrail) |
| module | `src-tauri/src/show_engine.rs` | `src-tauri/src/show_engine.rs:241`, `src-tauri/src/show_engine.rs:246`, `src-tauri/src/show_engine.rs:251` | WIRE2 | — |
| module | `src-tauri/src/social_cognition.rs` | `src-tauri/src/social_cognition.rs:148` | WIRE2 | — |
| module | `src-tauri/src/system_control.rs` | `src-tauri/src/system_control.rs:29`, `src-tauri/src/system_control.rs:64`, `src-tauri/src/system_control.rs:93`, `src-tauri/src/system_control.rs:137`, `src-tauri/src/system_control.rs:231`, `src-tauri/src/system_control.rs:303`, `src-tauri/src/system_control.rs:354`, `src-tauri/src/system_control.rs:433`, `src-tauri/src/system_control.rs:502`, `src-tauri/src/system_control.rs:545`, `src-tauri/src/system_control.rs:599` | WIRE2 | — |
| module | `src-tauri/src/telegram.rs` | `src-tauri/src/telegram.rs:373`, `src-tauri/src/telegram.rs:427`, `src-tauri/src/telegram.rs:444`, `src-tauri/src/telegram.rs:449`, `src-tauri/src/telegram.rs:462` | WIRE2 | — |
| module | `src-tauri/src/tentacles/calendar_tentacle.rs` | `src-tauri/src/tentacles/calendar_tentacle.rs:898`, `src-tauri/src/tentacles/calendar_tentacle.rs:903`, `src-tauri/src/tentacles/calendar_tentacle.rs:911`, `src-tauri/src/tentacles/calendar_tentacle.rs:916`, `src-tauri/src/tentacles/calendar_tentacle.rs:925`, `src-tauri/src/tentacles/calendar_tentacle.rs:930`, `src-tauri/src/tentacles/calendar_tentacle.rs:935`, `src-tauri/src/tentacles/calendar_tentacle.rs:943` | WIRE2 | — |
| module | `src-tauri/src/tentacles/cloud_costs.rs` | `src-tauri/src/tentacles/cloud_costs.rs:930`, `src-tauri/src/tentacles/cloud_costs.rs:935`, `src-tauri/src/tentacles/cloud_costs.rs:942`, `src-tauri/src/tentacles/cloud_costs.rs:947`, `src-tauri/src/tentacles/cloud_costs.rs:952` | WIRE2 | — |
| module | `src-tauri/src/tentacles/discord_deep.rs` | `src-tauri/src/tentacles/discord_deep.rs:665`, `src-tauri/src/tentacles/discord_deep.rs:670`, `src-tauri/src/tentacles/discord_deep.rs:675`, `src-tauri/src/tentacles/discord_deep.rs:684` | WIRE2 | — |
| module | `src-tauri/src/tentacles/filesystem_watch.rs` | `src-tauri/src/tentacles/filesystem_watch.rs:653` | WIRE2 | — |
| module | `src-tauri/src/tentacles/github_deep.rs` | `src-tauri/src/tentacles/github_deep.rs:1868`, `src-tauri/src/tentacles/github_deep.rs:1878`, `src-tauri/src/tentacles/github_deep.rs:1887`, `src-tauri/src/tentacles/github_deep.rs:1897`, `src-tauri/src/tentacles/github_deep.rs:1906`, `src-tauri/src/tentacles/github_deep.rs:1915`, `src-tauri/src/tentacles/github_deep.rs:1925`, `src-tauri/src/tentacles/github_deep.rs:1935`, `src-tauri/src/tentacles/github_deep.rs:1945` | WIRE2 | — |
| module | `src-tauri/src/tentacles/linear_jira.rs` | `src-tauri/src/tentacles/linear_jira.rs:837`, `src-tauri/src/tentacles/linear_jira.rs:842`, `src-tauri/src/tentacles/linear_jira.rs:847`, `src-tauri/src/tentacles/linear_jira.rs:852` | WIRE2 | — |
| module | `src-tauri/src/tentacles/log_monitor.rs` | `src-tauri/src/tentacles/log_monitor.rs:574`, `src-tauri/src/tentacles/log_monitor.rs:579`, `src-tauri/src/tentacles/log_monitor.rs:584`, `src-tauri/src/tentacles/log_monitor.rs:589`, `src-tauri/src/tentacles/log_monitor.rs:594` | WIRE2 | — |
| module | `src-tauri/src/thread.rs` | `src-tauri/src/thread.rs:153`, `src-tauri/src/thread.rs:169`, `src-tauri/src/thread.rs:179` | WIRE2 | — |
| module | `src-tauri/src/tray.rs` | `src-tauri/src/tray.rs:91` | WIRE2 | — |
| module | `src-tauri/src/tts.rs` | `src-tauri/src/tts.rs:638`, `src-tauri/src/tts.rs:645`, `src-tauri/src/tts.rs:656`, `src-tauri/src/tts.rs:662`, `src-tauri/src/tts.rs:690` | WIRE2 | — |
| module | `src-tauri/src/voice.rs` | `src-tauri/src/voice.rs:23`, `src-tauri/src/voice.rs:97`, `src-tauri/src/voice.rs:115`, `src-tauri/src/voice.rs:199` | WIRE2 | — |
| module | `src-tauri/src/voice_intelligence.rs` | `src-tauri/src/voice_intelligence.rs:640`, `src-tauri/src/voice_intelligence.rs:645`, `src-tauri/src/voice_intelligence.rs:650`, `src-tauri/src/voice_intelligence.rs:660`, `src-tauri/src/voice_intelligence.rs:668`, `src-tauri/src/voice_intelligence.rs:673`, `src-tauri/src/voice_intelligence.rs:678` | WIRE2 | — |
| module | `src-tauri/src/voice_local.rs` | `src-tauri/src/voice_local.rs:6`, `src-tauri/src/voice_local.rs:12`, `src-tauri/src/voice_local.rs:18` | WIRE2 | — |
| module | `src-tauri/src/whisper_local.rs` | `src-tauri/src/whisper_local.rs:395` | WIRE2 | — |
| config | `BladeConfig.god_mode` | `src-tauri/src/config.rs:247` | WIRE2 | 6-place-rule gap: No direct Settings toggle for bool; god_mode_tier is the user-facing control. This bool is derived from tier in backend. … |
| config | `BladeConfig.god_mode_tier` | `src-tauri/src/config.rs:249` | WIRE2 | 6-place-rule gap: Values: normal\|intermediate\|extreme. Drives godmode.rs ambient intelligence tier. No Settings surface — user cannot toggl… |
| config | `BladeConfig.obsidian_vault_path` | `src-tauri/src/config.rs:253` | WIRE2 | 6-place-rule gap: Read by knowledge/obsidian bridges. save_config_field allow-list includes it (config.rs:737) but no current Settings pane… |
| config | `BladeConfig.screen_timeline_enabled` | `src-tauri/src/config.rs:261` | WIRE2 | 6-place-rule gap: Gates screen_timeline.rs capture loop. Writable via save_config_field allow-list (config.rs:739). No Privacy/Perception p… |
| config | `BladeConfig.timeline_capture_interval` | `src-tauri/src/config.rs:263` | WIRE2 | 6-place-rule gap: Seconds between Total Recall screenshots. Writable via save_config_field. No UI slider/input. Phase 14 candidate. |
| config | `BladeConfig.timeline_retention_days` | `src-tauri/src/config.rs:265` | WIRE2 | 6-place-rule gap: Days of Total Recall retention. Writable via save_config_field. No UI exposure. Phase 14 candidate. |
| config | `BladeConfig.wake_word_enabled` | `src-tauri/src/config.rs:267` | WIRE2 | 6-place-rule gap: VoicePane SHOWS the state (config.wake_word_enabled) but has NO setter (neither set_config nor save_config_field accept i… |
| config | `BladeConfig.wake_word_phrase` | `src-tauri/src/config.rs:269` | WIRE2 | 6-place-rule gap: Wake-word phrase fed to wake_word.rs. No UI exposure. Phase 14 candidate. |
| config | `BladeConfig.wake_word_sensitivity` | `src-tauri/src/config.rs:271` | WIRE2 | 6-place-rule gap: u8 1-5 sensitivity. No UI slider. Phase 14 candidate. |
| config | `BladeConfig.active_role` | `src-tauri/src/config.rs:273` | WIRE2 | 6-place-rule gap: Active persona role; read by persona_engine.rs and brain.rs. No Settings pane exposes this selector. Phase 14 Personality… |
| config | `BladeConfig.blade_source_path` | `src-tauri/src/config.rs:275` | WIRE2 | 6-place-rule gap: Used by self_upgrade.rs to locate BLADE source checkout. save_config_field allow-list includes it (config.rs:731). No UI … |
| config | `BladeConfig.trusted_ai_delegate` | `src-tauri/src/config.rs:277` | WIRE2 | 6-place-rule gap: claude-code\|none\|empty. Used by background_agent.rs to spawn Claude Code/Aider workers. save_config_field allow-list (con… |
| config | `BladeConfig.blade_dedicated_monitor` | `src-tauri/src/config.rs:279` | WIRE2 | 6-place-rule gap: Monitor index for HUD placement. No UI monitor-picker. Phase 14 HUD settings candidate. |
| config | `BladeConfig.fallback_providers` | `src-tauri/src/config.rs:289` | WIRE2 | 6-place-rule gap: Ordered providers tried on 429/503/5xx. Read by providers/mod.rs fallback chain. No Settings UI for ordering. Phase 11 PR… |
| config | `BladeConfig.use_local_whisper` | `src-tauri/src/config.rs:292` | WIRE2 | 6-place-rule gap: Gates whisper_local.rs (feature-gated local-whisper). No Settings toggle; also requires rebuild with --features local-whi… |
| config | `BladeConfig.whisper_model` | `src-tauri/src/config.rs:295` | WIRE2 | 6-place-rule gap: tiny.en\|base.en\|small.en for local whisper. No UI. Phase 14 Voice pane candidate. |
| config | `BladeConfig.integration_polling_enabled` | `src-tauri/src/config.rs:301` | WIRE2 | 6-place-rule gap: Gates integration_bridge.rs Gmail/Calendar/Slack/GitHub polling. No Settings toggle. Phase 13 ECOSYS candidate. |
| config | `BladeConfig.tts_speed` | `src-tauri/src/config.rs:304` | WIRE2 | 6-place-rule gap: TTS playback multiplier 0.5..2.0. No UI slider. Phase 14 Voice pane candidate. |
| config | `BladeConfig.audio_capture_enabled` | `src-tauri/src/config.rs:310` | WIRE2 | 6-place-rule gap: Always-on audio capture toggle; read by audio_timeline.rs. No Privacy/Perception pane toggle. Phase 14 candidate. |
| config | `BladeConfig.ghost_mode_enabled` | `src-tauri/src/config.rs:313` | WIRE2 | 6-place-rule gap: Gates ghost_mode.rs overlay enrollment. No Settings toggle. Ghost route exists in routes but no config-side Settings bind… |
| config | `BladeConfig.ghost_mode_position` | `src-tauri/src/config.rs:316` | WIRE2 | 6-place-rule gap: bottom-right\|bottom-left\|top-right\|top-left. No position picker. Phase 14 candidate. |
| config | `BladeConfig.ghost_auto_reply` | `src-tauri/src/config.rs:319` | WIRE2 | 6-place-rule gap: Auto-type suggested reply into chat. Per v1.1 observe-only guardrail this stays disabled; Phase 14 may expose toggle but … |
| config | `BladeConfig.hive_enabled` | `src-tauri/src/config.rs:322` | WIRE2 | 6-place-rule gap: Opt-in HIVE distributed mesh. No Settings toggle. Phase 14 HIVE/Admin candidate. |
| config | `BladeConfig.hive_autonomy` | `src-tauri/src/config.rs:325` | WIRE2 | 6-place-rule gap: 0.0-1.0 autonomy level. No Settings slider. Phase 14 candidate if hive_enabled is surfaced. |
| config | `DiskConfig.god_mode` | `src-tauri/src/config.rs:76` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.god_mode; no Settings toggle. Phase 14 candidate. |
| config | `DiskConfig.god_mode_tier` | `src-tauri/src/config.rs:78` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.god_mode_tier; no Settings surface. Phase 14 candidate. |
| config | `DiskConfig.obsidian_vault_path` | `src-tauri/src/config.rs:82` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.obsidian_vault_path; save_config_field allow-listed but no UI picker. |
| config | `DiskConfig.screen_timeline_enabled` | `src-tauri/src/config.rs:90` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.screen_timeline_enabled; no UI exposure. |
| config | `DiskConfig.timeline_capture_interval` | `src-tauri/src/config.rs:92` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.timeline_capture_interval. |
| config | `DiskConfig.timeline_retention_days` | `src-tauri/src/config.rs:94` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.timeline_retention_days. |
| config | `DiskConfig.wake_word_enabled` | `src-tauri/src/config.rs:96` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.wake_word_enabled; VoicePane reads it but no setter exists. |
| config | `DiskConfig.wake_word_phrase` | `src-tauri/src/config.rs:98` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.wake_word_phrase. |
| config | `DiskConfig.wake_word_sensitivity` | `src-tauri/src/config.rs:100` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.wake_word_sensitivity. |
| config | `DiskConfig.active_role` | `src-tauri/src/config.rs:102` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.active_role. |
| config | `DiskConfig.blade_source_path` | `src-tauri/src/config.rs:104` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.blade_source_path; save_config_field allow-listed. |
| config | `DiskConfig.trusted_ai_delegate` | `src-tauri/src/config.rs:106` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.trusted_ai_delegate. |
| config | `DiskConfig.blade_dedicated_monitor` | `src-tauri/src/config.rs:108` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.blade_dedicated_monitor. |
| config | `DiskConfig.fallback_providers` | `src-tauri/src/config.rs:118` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.fallback_providers. |
| config | `DiskConfig.use_local_whisper` | `src-tauri/src/config.rs:120` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.use_local_whisper. |
| config | `DiskConfig.whisper_model` | `src-tauri/src/config.rs:122` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.whisper_model. |
| config | `DiskConfig.integration_polling_enabled` | `src-tauri/src/config.rs:128` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.integration_polling_enabled. |
| config | `DiskConfig.tts_speed` | `src-tauri/src/config.rs:130` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.tts_speed. |
| config | `DiskConfig.audio_capture_enabled` | `src-tauri/src/config.rs:135` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.audio_capture_enabled. |
| config | `DiskConfig.ghost_mode_enabled` | `src-tauri/src/config.rs:137` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.ghost_mode_enabled. |
| config | `DiskConfig.ghost_mode_position` | `src-tauri/src/config.rs:139` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.ghost_mode_position. |
| config | `DiskConfig.ghost_auto_reply` | `src-tauri/src/config.rs:141` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.ghost_auto_reply. |
| config | `DiskConfig.hive_enabled` | `src-tauri/src/config.rs:144` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.hive_enabled. |
| config | `DiskConfig.hive_autonomy` | `src-tauri/src/config.rs:147` | WIRE2 | 6-place-rule gap: Mirror of BladeConfig.hive_autonomy. |
| config | `cargo_feature::local-whisper` | `src-tauri/Cargo.toml:62` | WIRE2 | No Settings toggle — requires rebuild with --features local-whisper. Paired with BladeConfig.use_local_whisper runtime flag. Documented in … |
| config | `env::BLADE_CURRENT_MSG_ID` | `src-tauri/src/providers/anthropic.rs:358` | WIRE2 | BLADE-specific env var. Used to tag thinking-block events with the current message id, but BLADE never sets this env var in-process (verifi… |

Phase 14 owners:

- **WIRE2** — standard wiring task (add UI surface or fix broken invoke)
- **A11Y2** — accessibility-related (screen-reader label, focus trap)
- **LOG** — activity-log instrumentation (LOG-02)
- **DENSITY** — empty-state polish (DENSITY-05/06)
- **DEFERRED_V1_2** — deferred per M-03; do NOT wire in v1.1 (see Appendix B)

---

## 5. DEAD Deletion Plan

Source: `10-WIRING-AUDIT.json::dead_deletion_plan[]` (1 row). Phase 14 removal backlog.

DEAD classification per D-48: no `invoke` callers, no `listen` subscribers, no internal Rust callers, AND not referenced in roadmap/requirements for v1.1 **or** v1.2. Borderline items stay in §4 with a `deferred to v1.2` note — they are NOT listed here.

| identifier | callers | imports | safe_to_delete | deletion_note |
|-----------|---------|---------|----------------|----------------|
| `DiskConfig.api_key` | `src-tauri/src/config.rs:150` | — | ✓ | Legacy field with #[serde(default, skip_serializing)] — only read during load_config() to migrate plaintext keys into the keyring, then cleared. Never written. Kept for backwards compatibility; once … |

---

## Appendix A — Tester-Pass Evidence Map

Cross-references the 7 symptoms from `.planning/notes/v1-1-milestone-shape.md` §"Why this framing" (lines 26-39) to catalog rows above. Grounds the audit in falsifiable tester-observed reality — this is the gap-list seed per D-48.

| # | Symptom | Classification | Catalog row (§/table:row) | Rationale |
|---|---------|----------------|---------------------------|-----------|
| 1 | Chat broken for first message (silent failure, no error surfaced) | ACTIVE (post-fix) | §1 `src-tauri/src/commands.rs` (ACTIVE) | Fixed by commit `4ab464c` (tester-pass-1); `chat_error` BLADE_EVENTS key is present with frontend subscriber confirmed in `src/lib/events/` + `src/features/chat/useChat.tsx`. Audit keeps the module ACTIVE but the row is listed here so future regressions are checked against the symptom. |
| 2 | Deep scan found 1 repo (the scanner is dumb) | ACTIVE (but under-capability) | §1 `src-tauri/src/deep_scan.rs`, `indexer.rs`, `file_indexer.rs` (all ACTIVE — scan command is registered and invoked) | Scanner logic is single-source-class; Phase 12 "Smart Deep Scan" owns the upgrade. §1 surfaces the modules; Phase 12 planning uses §1 rows as its starting inventory. |
| 3 | Dashboard pages feel empty | WIRED-NOT-USED (data sparse) | §2a `dashboard` (ACTIVE — data pipes) + §1 `perception_fusion.rs` + `homeostasis.rs` + `typed_memory.rs` (all ACTIVE) | Backend exists and data pipes are connected, but upstream signal is sparse until Phase 12 scan ships. DENSITY-05/07 (Phase 15) + WIRE2-02 (Phase 14) consume empty-state rows from §3a. |
| 4 | Background terminal noise, no in-UI activity surface | NOT-WIRED (emit coverage) | §3b (34 `AtomicBool` / static control-loop guards) + §4 activity-log event entries | LOG-02 (Phase 14) consumes §3b row-by-row to instrument emit coverage; the Activity Log strip is load-bearing (M-07). Static guards toggle silently today — no emit, no UI surface. |
| 5 | UI cluttered, no pad, no breathing room | — (out of Phase 10 scope) | Phase 15 DENSITY pass | Phase 10 is read-only classification; DENSITY-01..08 in Phase 15 own the visual-language rework. No catalog row here by design. |
| 6 | Options the tester expected weren't reachable | NOT-WIRED (config) | §3a rows with `ui_surface: null` + §4 `item_type: config` rows (50 entries) | Subagent C primary finding set: 48 WIRED-NOT-USED `BladeConfig` fields have no Settings control. Phase 14 WIRE2 wires them into Settings panes. |
| 7 | Groq + llama produced nothing useful (no capability-aware routing) | WIRED-NOT-USED | §1 `src-tauri/src/router.rs` (ACTIVE — routing logic exists) + `providers/mod.rs` (ACTIVE) + §3a `BladeConfig.vision_provider` / `audio_provider` / `long_context_provider` / `tools_provider` (6-place gaps) | PROV-06/09 (Phase 11) consumes the 6-place-gap config rows as its pre-seeded backlog. Audit surfaces the surface; Phase 11 implements capability-aware routing. |

Verified: commit `4ab464c` (`fix(tester-pass-1): silence log spam, stop self_upgrade loop, surface chat errors`) is the tester-pass-1 remediation on master (confirmed via `git log --oneline --grep=tester-pass`).

---

## Appendix B — Deferred-to-v1.2 Rationale

Items marked `phase_14_owner: "DEFERRED_V1_2"` in §4 (2 rows). Phase 14 does NOT wire these in v1.1. Phase 14 planning refers to Appendix B by reference (no re-arguing scope).

| identifier | item_type | rationale | v1.1 policy |
|-----------|-----------|-----------|-------------|
| `src-tauri/src/discord.rs` | module | deferred to v1.2 — acting capability (M-03 observe-only guardrail) | NOT-WIRED in v1.1; M-03 observe-only guardrail enforces runtime block on acting-tentacle commands |
| `src-tauri/src/session_handoff.rs` | module | deferred to v1.2 — acting capability (M-03 observe-only guardrail) | NOT-WIRED in v1.1; M-03 observe-only guardrail enforces runtime block on acting-tentacle commands |

**Scope anchors:** M-03 is locked in `.planning/PROJECT.md` + `.planning/notes/v1-1-milestone-shape.md` §"What we're explicitly not doing in v1.1"; the runtime block will land in a Phase 11+ guard plan. v1.2 (`.planning/notes/v2-vision-tentacles.md`) is where acting-tentacle commands become user-reachable surfaces.

---

## Meta-findings

- **`./CLAUDE.md` is outdated (meta note, not in any backlog):** the "New route — 3 places in App.tsx" block at lines around 116-120 of the project CLAUDE.md predates the per-feature `routes: RouteDefinition[]` export + `src/windows/main/router.ts` aggregation pattern (FOUND-07, D-40). A one-line correction belongs in a Phase 14 doc-polish task; the audit flags it here so it's not lost.
- **Subagent A classifications were already accurate:** 0 modules needed reclassification after cross-referencing against `scripts/verify-phase{5..8}-rust-surface.sh` (458 unique ACTIVE commands across the four scripts). Every module Subagent A marked NOT-WIRED really is NOT-WIRED from the frontend's perspective.
- **CommandPalette is main-only** (Pitfall 1 verified): the 4 non-main window shells (quickask, hud, ghost, overlay) do not host palettes. §2c documents them separately from palette-eligible routes in §2a.
- **Single DEAD entry in the whole audit:** only `DiskConfig.api_key` qualifies as DEAD (legacy one-shot migration field; replaced by keyring storage). All other borderline modules stay NOT-WIRED with a deferred-to-v1.2 note per D-48. This tracks — v1.0 shipped 130+ modules and v1.1 is about wiring, not deleting.
- **Emit cross-reference (Pitfall 2):** the `00-EMIT-AUDIT.md` 247-site inventory has 42 cross-window emits + 142 single-window emits. Every module that emits a cross-window event was already classified ACTIVE by Subagent A (because its module also registers a `#[tauri::command]` invoked from `src/`); no additional upgrades were needed.

---

*Audit produced: 2026-04-20. No source code modified (read-only phase per D-50). 178 modules + 80 prod routes (+20 dev-only) + 155 config surfaces classified. Sidecar at `10-WIRING-AUDIT.json` (schema 1.0.0).*
