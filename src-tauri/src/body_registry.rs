/// BODY REGISTRY — maps every BLADE module to its biological body system.
///
/// 149 modules organized into 12 body systems. This is the anatomy chart —
/// the complete map of what lives where in BLADE's body.
///
/// Used by: vital_signs (health check), supervisor (monitoring), dashboard (display)

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleMapping {
    pub module: &'static str,
    pub body_system: &'static str,
    pub organ: &'static str,
    pub description: &'static str,
}

/// Complete anatomy chart — every module mapped to its body system.
pub fn get_body_map() -> Vec<ModuleMapping> {
    vec![
        // ── BRAIN (Central Nervous System) ───────────────────────────────
        m("brain", "nervous", "cerebrum", "System prompt assembly, context orchestration"),
        m("brain_planner", "nervous", "prefrontal_cortex", "Task decomposition, plan generation + caching"),
        m("prefrontal", "nervous", "prefrontal_cortex", "Working memory — active task state between messages"),
        m("commands", "nervous", "cerebrum", "Main chat pipeline — tool loop, streaming, error recovery"),
        m("router", "nervous", "thalamus", "Task classification (Code/Vision/Simple/Complex/Creative)"),
        m("decision_gate", "nervous", "basal_ganglia", "Act/ask/queue/ignore classifier with learning"),
        m("reasoning_engine", "nervous", "cerebrum", "Multi-step reasoning: decompose→critique→revise→synthesize"),
        m("metacognition", "nervous", "prefrontal_cortex", "Self-awareness — confidence estimation, knowledge gaps"),
        m("consequence", "nervous", "prefrontal_cortex", "World model — predict outcomes before acting"),
        m("symbolic", "nervous", "cerebrum", "Neuro-symbolic policy engine, state machines, constraints"),
        m("learning_engine", "nervous", "cerebellum", "Behavioral pattern detection, proactive prediction"),
        m("skill_engine", "nervous", "cerebellum", "Tool sequence learning — motor memory reflexes"),
        m("prediction_engine", "nervous", "cerebellum", "User behavior prediction from patterns"),
        m("self_critique", "nervous", "cingulate_cortex", "Response quality scoring, auto-rebuild"),
        m("emotional_intelligence", "nervous", "amygdala", "Emotion detection from text/voice"),
        m("social_cognition", "nervous", "temporal_lobe", "Social dynamics, communication advice"),
        m("causal_graph", "nervous", "cerebrum", "Cause-and-effect tracking, insight derivation"),
        m("action_tags", "nervous", "motor_cortex", "Extract executable actions from responses"),
        m("roles", "nervous", "cerebrum", "Specialist role injection (coder, researcher, etc.)"),

        // ── EYES (Vision) ────────────────────────────────────────────────
        m("screen", "vision", "retina", "Screen capture — JPEG + fingerprint + multi-monitor"),
        m("screen_timeline", "vision", "visual_cortex", "Total Recall — 5s capture, vision model description"),
        m("screen_timeline_commands", "vision", "visual_cortex", "Timeline search/browse/cleanup commands"),
        m("perception_fusion", "vision", "visual_cortex", "Fused sensory state — window + clipboard + OCR + vitals"),
        m("proactive_vision", "vision", "visual_cortex", "Omi-style assistants — task/focus/insight/memory on context switch"),
        m("computer_use", "vision", "eye_muscles", "Vision-driven desktop automation loop"),
        m("browser_agent", "vision", "eye_muscles", "CDP browser vision loop"),

        // ── EARS (Audio) ─────────────────────────────────────────────────
        m("audio_timeline", "audio", "cochlea", "Always-on audio capture + transcription + meeting detection"),
        m("voice", "audio", "cochlea", "Basic voice recording + transcription"),
        m("voice_global", "audio", "cochlea", "Push-to-talk + conversational voice mode"),
        m("voice_local", "audio", "cochlea", "Local voice processing"),
        m("voice_intelligence", "audio", "auditory_cortex", "Emotion/language detection from voice"),
        m("wake_word", "audio", "cochlea", "Always-on 'Hey BLADE' detection"),
        m("whisper_local", "audio", "cochlea", "Local Whisper model (behind feature flag)"),
        m("vad", "audio", "cochlea", "Voice activity detection"),
        m("deepgram", "audio", "cochlea", "Deepgram STT integration"),
        m("tts", "audio", "larynx", "Text-to-speech output"),

        // ── MOUTH (Generation/Output) ────────────────────────────────────
        m("native_tools", "muscular", "hands", "37+ built-in tools — bash, files, web, browser, system"),
        m("browser_native", "muscular", "hands", "CDP browser control (Chrome/Edge/Brave)"),
        m("system_control", "muscular", "hands", "Lock, volume, brightness, apps, windows"),
        m("ui_automation", "muscular", "hands", "UI element interaction"),
        m("automation", "muscular", "hands", "Keyboard/mouse automation"),
        m("clipboard", "muscular", "hands", "Clipboard monitoring + manipulation"),
        m("auto_reply", "muscular", "mouth", "Draft replies in user's style"),
        m("auto_fix", "muscular", "hands", "Auto-fix CI failures"),

        // ── MEMORY (Hippocampus) ─────────────────────────────────────────
        m("memory", "memory", "hippocampus", "Letta-style virtual context blocks (working memory)"),
        m("memory_palace", "memory", "hippocampus", "Episodic long-term memory"),
        m("typed_memory", "memory", "hippocampus", "7-category semantic memory"),
        m("knowledge_graph", "memory", "hippocampus", "Entity-relationship graph"),
        m("embeddings", "memory", "hippocampus", "Vector search + semantic recall"),
        m("dna", "memory", "dna", "Unified knowledge query layer"),
        m("character", "memory", "hippocampus", "Feedback learning — character bible"),
        m("execution_memory", "memory", "hippocampus", "Action execution history"),
        m("context_engine", "memory", "hippocampus", "Smart RAG context assembly"),
        m("rag", "memory", "hippocampus", "Retrieval-augmented generation"),
        m("session_handoff", "memory", "hippocampus", "Cross-session working memory snapshot"),

        // ── IDENTITY (DNA) ───────────────────────────────────────────────
        m("persona_engine", "identity", "dna", "Personality traits + relationship state"),
        m("personality_mirror", "identity", "dna", "Chat style extraction + mirroring"),
        m("people_graph", "identity", "dna", "Contact knowledge + communication prefs"),
        m("social_graph", "identity", "dna", "Contact interactions + social network"),
        m("deep_scan", "identity", "dna", "PC discovery scanner — 12 system scanners"),
        m("discovery", "identity", "dna", "MCP server auto-import from Claude Code/Codex"),

        // ── ENDOCRINE (Hormones) ─────────────────────────────────────────
        m("homeostasis", "endocrine", "hypothalamus", "10 hormones + pituitary + circadian + battery"),

        // ── CARDIOVASCULAR (Data Flow) ───────────────────────────────────
        m("cardiovascular", "cardiovascular", "heart", "Event registry, blood pressure, vital signs"),

        // ── HIVE (Organs/Tentacles) ──────────────────────────────────────
        m("hive", "hive", "organism", "Distributed agent mesh — 10 tentacles, 4 heads, big agent"),
        m("integration_bridge", "hive", "nervous_connections", "Persistent MCP polling (Gmail/Calendar/Slack/GitHub)"),
        m("organ", "hive", "organism", "Standard organ interface + autonomy gradient"),

        // ── IMMUNE SYSTEM ────────────────────────────────────────────────
        m("immune_system", "immune", "adaptive", "Self-evolution coordinator — gap→search→acquire→integrate"),
        m("autoskills", "immune", "innate", "Auto-install MCP servers on tool failure"),
        m("evolution", "immune", "adaptive", "MCP catalog discovery + auto-install"),
        m("tool_forge", "immune", "adaptive", "Dynamic tool creation via Claude Code"),
        m("permissions", "immune", "skin_barrier", "Tool risk classification (Blocked/Ask/Allow)"),
        m("security_monitor", "immune", "lymph_nodes", "Network, phishing, breach, code scan"),
        m("kali", "immune", "lymph_nodes", "Security expertise + pentest mode"),

        // ── SKELETON (Structure) ─────────────────────────────────────────
        m("skeleton", "skeleton", "skull", "Central DB schema initialization"),
        m("joints", "skeleton", "joints", "Trait contracts — ContextProvider, BackgroundService, MemoryStore"),
        m("db", "skeleton", "spine", "Core database operations + migrations"),
        m("db_commands", "skeleton", "spine", "Database Tauri commands"),
        m("config", "skeleton", "spine", "BladeConfig + keyring + 6-place pattern"),
        m("lib", "skeleton", "spine", "Module registration + startup + generate_handler"),
        m("main", "skeleton", "spine", "Entry point"),

        // ── DIGESTIVE (Processing) ───────────────────────────────────────
        m("indexer", "digestive", "small_intestine", "Code symbol indexing (functions, classes, types)"),
        m("file_indexer", "digestive", "small_intestine", "All-file indexing (documents, images, etc.)"),
        m("document_intelligence", "digestive", "small_intestine", "Document library + Q&A"),

        // ── URINARY (Waste) ──────────────────────────────────────────────
        m("urinary", "urinary", "kidneys", "23 nephrons pruning 49 tables"),
        m("dream_mode", "urinary", "kidneys", "Deep sleep consolidation + pruning"),

        // ── REPRODUCTIVE ─────────────────────────────────────────────────
        m("reproductive", "reproductive", "gonads", "DNA inheritance for spawned agents"),
        m("agent_factory", "reproductive", "gonads", "Create agents from descriptions"),
        m("background_agent", "reproductive", "gonads", "Spawn Claude Code/Aider/Codex"),

        // ── SUPERVISOR (Life Support) ────────────────────────────────────
        m("supervisor", "supervisor", "life_support", "Crash recovery, heartbeats, service health"),
        m("audit", "supervisor", "life_support", "Decision transparency log"),

        // ── RESPIRATORY (I/O Exchange) ───────────────────────────────────
        m("mcp", "respiratory", "lungs", "MCP JSON-RPC client + health + reconnect"),
        m("mcp_fs_server", "respiratory", "lungs", "MCP filesystem server"),
        m("mcp_memory_server", "respiratory", "lungs", "MCP memory server"),

        // ── PROACTIVE (Ambient Intelligence) ─────────────────────────────
        m("godmode", "proactive", "ambient", "3-tier ambient intelligence (Normal/Intermediate/Extreme)"),
        m("ambient", "proactive", "ambient", "Background context monitor — idle/session/monitor"),
        m("proactive_engine", "proactive", "ambient", "5 signal detectors → stuck/workflow/deadline/context/energy"),
        m("pulse", "proactive", "ambient", "Heartbeat thoughts, morning briefing, daily digest"),
        m("ghost_mode", "proactive", "ambient", "Invisible meeting overlay with content protection"),

        // ── AGENTS (Swarm) ───────────────────────────────────────────────
        m("swarm", "agents", "swarm", "DAG-based parallel agent orchestration"),
        m("swarm_commands", "agents", "swarm", "Swarm Tauri commands"),
        m("swarm_planner", "agents", "swarm", "Task decomposition into DAG"),
        m("agent_commands", "agents", "swarm", "Agent management commands"),
        m("managed_agents", "agents", "swarm", "Agent lifecycle management"),
        m("ai_delegate", "agents", "swarm", "AI-to-AI delegation for tool approval"),
        m("self_code", "agents", "swarm", "BLADE modifying its own code"),

        // ── LIFESTYLE (User-Facing Features) ─────────────────────────────
        m("goal_engine", "lifestyle", "goals", "Goal tracking + autonomous pursuit"),
        m("accountability", "lifestyle", "goals", "Active objectives + checkins"),
        m("habit_engine", "lifestyle", "habits", "Habit tracking + reminders"),
        m("health_tracker", "lifestyle", "health", "Health nudges"),
        m("streak_stats", "lifestyle", "health", "Daily streaks + gamification"),
        m("cron", "lifestyle", "scheduler", "Task scheduler (morning briefing, weekly review)"),
        m("reminders", "lifestyle", "scheduler", "Reminder system"),
        m("watcher", "lifestyle", "scheduler", "URL/file watchers"),
        m("journal", "lifestyle", "journal", "Evening journal + weekly soul evolution"),
        m("obsidian", "lifestyle", "journal", "Obsidian vault integration"),
        m("temporal_intel", "lifestyle", "journal", "Activity recall, standup, pattern detection"),

        // ── COMMUNICATION (Tentacles) ────────────────────────────────────
        m("telegram", "communication", "tentacle", "Telegram bot integration"),
        m("discord", "communication", "tentacle", "Discord bot integration"),
        m("meeting_intelligence", "communication", "tentacle", "Meeting detection + notes + action items"),
        m("notification_listener", "communication", "tentacle", "OS notification monitoring"),

        // ── INFRASTRUCTURE ───────────────────────────────────────────────
        m("trace", "infrastructure", "logging", "Provider call tracing"),
        m("reports", "infrastructure", "logging", "Capability gap reporting"),
        m("cmd_util", "infrastructure", "utilities", "Silent command execution"),
        m("crypto", "infrastructure", "utilities", "Encryption utilities"),
        m("files", "infrastructure", "utilities", "File operation helpers"),
        m("history", "infrastructure", "utilities", "Conversation history persistence"),
        m("research", "infrastructure", "utilities", "Research logging"),
        m("multimodal", "infrastructure", "utilities", "Multi-modal processing"),
        m("world_model", "infrastructure", "utilities", "System state snapshot (processes, ports, git)"),
        m("context", "infrastructure", "utilities", "Active window detection"),
        m("git_style", "infrastructure", "utilities", "Git commit style learning"),
        m("code_sandbox", "infrastructure", "utilities", "Sandboxed code execution"),
        m("runtimes", "infrastructure", "utilities", "Runtime management"),
        m("sidecar", "infrastructure", "utilities", "Sidecar device monitoring"),

        // ── UI (Skin) ────────────────────────────────────────────────────
        m("overlay_manager", "skin", "epidermis", "HUD bar + toast notifications"),
        m("tray", "skin", "epidermis", "System tray"),
        m("soul_commands", "skin", "epidermis", "Soul/persona Tauri commands"),

        // ── PROVIDERS (Lungs — gas exchange) ─────────────────────────────
        m("deeplearn", "respiratory", "alveoli", "Deep learning model management"),
        m("negotiation_engine", "nervous", "cerebrum", "Debate coach + negotiation assistant"),
        m("authority_engine", "nervous", "cerebrum", "9 specialist agents with authority hierarchy"),
        m("self_upgrade", "immune", "adaptive", "Self-improvement + pentest capabilities"),
        m("autonomous_research", "immune", "adaptive", "Self-directed knowledge gap research"),
        m("workflow_builder", "lifestyle", "scheduler", "User-defined workflow automation"),
        m("iot_bridge", "muscular", "hands", "Home Assistant + Spotify control"),
    ]
}

fn m(module: &'static str, body_system: &'static str, organ: &'static str, description: &'static str) -> ModuleMapping {
    ModuleMapping { module, body_system, organ, description }
}

/// Get modules by body system.
pub fn get_system_modules(system: &str) -> Vec<ModuleMapping> {
    get_body_map().into_iter().filter(|m| m.body_system == system).collect()
}

/// Get all body systems with module counts.
pub fn get_system_summary() -> Vec<(String, usize)> {
    let map = get_body_map();
    let mut systems: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for m in &map {
        *systems.entry(m.body_system.to_string()).or_insert(0) += 1;
    }
    let mut sorted: Vec<(String, usize)> = systems.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn body_get_map() -> Vec<ModuleMapping> {
    get_body_map()
}

#[tauri::command]
pub fn body_get_system(system: String) -> Vec<ModuleMapping> {
    get_system_modules(&system)
}

#[tauri::command]
pub fn body_get_summary() -> Vec<(String, usize)> {
    get_system_summary()
}
