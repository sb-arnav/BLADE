use crate::config::{blade_config_dir, write_blade_file};
use rusqlite;
use crate::mcp::McpTool;
use std::fs;
use std::path::PathBuf;
use chrono::Timelike;
use chrono::Datelike;

// ── Model capability tiers ────────────────────────────────────────────────────
// Different models need different prompting strategies.
// Frontier models reason well from instructions alone.
// Capable/Small models need examples, scaffolding, and simpler language.

#[derive(Debug, Clone, PartialEq)]
pub enum ModelTier {
    /// Claude Sonnet/Opus 3.5+, GPT-4o (non-mini), Gemini 1.5 Pro/Ultra
    /// → Trust the model. Current prompt works as-is.
    Frontier,
    /// Claude Haiku, GPT-4o-mini, Llama 3 70B, Gemini Flash, Mixtral 8x7B
    /// → Add reasoning scaffold + few-shot tool examples.
    Capable,
    /// Llama 3 8B, Mistral 7B, Phi, Qwen small, most default Ollama models
    /// → Heavy scaffolding, simplified instructions, explicit step-by-step.
    Small,
}

pub fn model_tier(provider: &str, model: &str) -> ModelTier {
    let m = model.to_lowercase();

    // Explicitly frontier
    if m.contains("opus") || m.contains("sonnet-4") || m.contains("sonnet-3-5") || m.contains("sonnet-3.5")
        || m.contains("gpt-4o") && !m.contains("mini")
        || m.contains("gemini-1.5-pro") || m.contains("gemini-ultra")
        || m.contains("gpt-4-turbo") || m.contains("o1") || m.contains("o3")
    {
        return ModelTier::Frontier;
    }

    // Explicitly capable
    if m.contains("haiku") || m.contains("gpt-4o-mini") || m.contains("4o-mini")
        || m.contains("70b") || m.contains("gemini-2") || m.contains("gemini-flash")
        || m.contains("mixtral") || m.contains("llama-3.1") || m.contains("llama-3.2")
        || m.contains("llama-3.3") || m.contains("mistral-large") || m.contains("mistral-nemo")
        || m.contains("command-r") || m.contains("deepseek-v")
    {
        return ModelTier::Capable;
    }

    // Ollama default → assume small unless we know better
    if provider == "ollama" {
        if m.contains("70b") || m.contains("72b") || m.contains("mixtral") || m.contains("command") {
            return ModelTier::Capable;
        }
        return ModelTier::Small;
    }

    // Groq models: fast Llama variants
    if provider == "groq" {
        if m.contains("70b") || m.contains("llama-3.1") || m.contains("llama-3.3") {
            return ModelTier::Capable;
        }
        return ModelTier::Capable; // Groq runs quantized but capable models
    }

    // OpenRouter: model ID is usually "provider/model-name" — classify by the model part
    if provider == "openrouter" {
        let model_part = m.split('/').last().unwrap_or(&m);
        // Frontier-tier via OpenRouter
        if model_part.contains("opus") || model_part.contains("sonnet-4")
            || model_part.contains("sonnet-3-5") || model_part.contains("sonnet-3.5")
            || model_part.contains("gpt-4o") && !model_part.contains("mini")
            || model_part.contains("gemini-1.5-pro")
            || model_part.contains("o1") || model_part.contains("o3")
            || model_part.contains("deepseek-r1") || model_part.contains("qwen-2.5-72b")
        {
            return ModelTier::Frontier;
        }
        // Everything else on OpenRouter is at least capable
        return ModelTier::Capable;
    }

    ModelTier::Capable // safe default
}

/// Reasoning scaffold injected for non-Frontier models.
/// Teaches the model to think before acting, which dramatically improves
/// tool call accuracy on smaller models.
fn reasoning_scaffold(tier: &ModelTier) -> Option<String> {
    match tier {
        ModelTier::Frontier => None,
        ModelTier::Capable => Some(
            "## How to Handle Requests\n\n\
             Before using any tool, think: What does the user need? Which single tool is the right first step? Then act.\n\n\
             After each tool call, check if you have enough information to answer — or if another tool call is needed.\n\n\
             **Tool call pattern for this session:**\n\
             - Read/inspect first, then act (avoid blind writes)\n\
             - `blade_bash` for shell commands, NOT for file reads (use `blade_read_file`)\n\
             - `blade_ui_read` before `blade_ui_click` (know what you're clicking)\n\
             - `blade_search_web` → pick URL → `blade_web_fetch` for research (don't open browser unless asked)".to_string()
        ),
        ModelTier::Small => Some(
            "## Step-by-Step Instructions\n\n\
             ALWAYS follow this process:\n\
             1. Read the request carefully\n\
             2. Pick ONE tool to use first\n\
             3. Look at the tool result\n\
             4. Decide if you need another tool or can answer now\n\
             5. Give a short final answer\n\n\
             NEVER use more than 3 tools in a row without checking in with the user.\n\
             NEVER guess at file paths — use `blade_list_dir` to look first.\n\
             NEVER use `blade_bash` to read files — use `blade_read_file`.\n\n\
             **Tool call examples:**\n\
             - User: \"What's in my downloads?\" → call `blade_list_dir` with path \"downloads\"\n\
             - User: \"Search for X\" → call `blade_search_web` with query \"X\"\n\
             - User: \"Open YouTube\" → call `blade_open_url` with url \"https://youtube.com\"\n\
             - User: \"Run my tests\" → call `blade_bash` with command \"npm test\" (or the right test command)".to_string()
        ),
    }
}

/// For Small tier models: trim the system prompt to fit in limited context windows.
/// Removes lower-priority sections when total length exceeds budget.
fn trim_for_small_model(parts: &mut Vec<String>, budget: usize) {
    let total: usize = parts.iter().map(|p| p.len()).sum();
    if total <= budget {
        return;
    }
    // Drop from the end (lower priority sections) until we fit
    let separator_len = "\n\n---\n\n".len();
    while parts.len() > 2 {
        let total: usize = parts.iter().map(|p| p.len()).sum::<usize>()
            + parts.len().saturating_sub(1) * separator_len;
        if total <= budget { break; }
        parts.pop();
    }
}

/// Build the system prompt that gives Blade its personality and context.
/// Optionally accepts the current user message to inject semantically relevant memories.
#[allow(dead_code)]
pub fn build_system_prompt(tools: &[McpTool]) -> String {
    build_system_prompt_inner(tools, "", None, &ModelTier::Frontier, "", "", usize::MAX)
}

pub fn build_system_prompt_for_model(
    tools: &[McpTool],
    user_query: &str,
    vector_store: Option<&crate::embeddings::SharedVectorStore>,
    provider: &str,
    model: &str,
    message_count: usize,
) -> String {
    let tier = model_tier(provider, model);
    build_system_prompt_inner(tools, user_query, vector_store, &tier, provider, model, message_count)
}

#[allow(dead_code)]
pub fn build_system_prompt_with_recall(
    tools: &[McpTool],
    user_query: &str,
    vector_store: Option<&crate::embeddings::SharedVectorStore>,
) -> String {
    build_system_prompt_inner(tools, user_query, vector_store, &ModelTier::Frontier, "", "", usize::MAX)
}

/// Build a lean system prompt for the voice conversation loop.
/// Skips tool/MCP context for speed — voice turns should be fast.
pub async fn build_system_prompt_voice(_app: &tauri::AppHandle) -> String {
    let config = crate::config::load_config();
    let name = if config.user_name.is_empty() { "the user".to_string() } else { config.user_name.clone() };
    format!(
        "You are BLADE, a personal AI assistant having a spoken conversation with {}. \
         Keep responses concise and natural — you are speaking aloud, not writing. \
         Avoid markdown, bullet points, or code unless the user explicitly asks. \
         Aim for 1-3 sentences per response unless more detail is specifically needed.",
        name
    )
}

/// Hard budget for the assembled system prompt.
/// ~150k chars ≈ 37.5k tokens — leaves plenty of room for the conversation
/// inside a 200k context window.
const SYSTEM_PROMPT_CHAR_BUDGET: usize = 150_000;

/// Drop sections from the end of `parts` until the total char count is under
/// the budget. The first `keep` entries are never removed (they are the
/// highest-priority always-on sections).
fn enforce_budget(parts: &mut Vec<String>, keep: usize) {
    loop {
        let total: usize = parts.iter().map(|p| p.len()).sum();
        if total <= SYSTEM_PROMPT_CHAR_BUDGET || parts.len() <= keep {
            break;
        }
        parts.pop();
    }
}

// ── Smart context relevance scoring ──────────────────────────────────────────
//
// Returns a 0.0–1.0 score for how relevant a context block type is to the
// current user query. Only blocks scoring above 0.3 get injected, keeping the
// prompt lean and the model focused.
//
// Context type strings (matches the labels used below in build_system_prompt_inner):
//   "code"        — codebase index, git, project instructions, recent file context
//   "schedule"    — calendar, integration state, upcoming events
//   "financial"   — spending data, subscriptions, financial brain
//   "health"      — health/screen-time stats, break nudges
//   "security"    — security alerts, pentest mode
//   "smart_home"  — IoT, Home Assistant, Spotify
//   "memory"      — typed memory, knowledge graph, episodic memory
//   "people"      — people graph, social graph, contacts
//   "system"      — world model, active processes, system info
//   "research"    — ambient research, document library
pub fn score_context_relevance(query: &str, context_type: &str) -> f32 {
    let q = query.to_lowercase();

    // Keyword sets per context type
    let (high, medium, low): (&[&str], &[&str], &[&str]) = match context_type {
        "code" => (
            &["code", "bug", "error", "function", "rust", "typescript", "ts", "js",
              "python", "git", "commit", "branch", "file", "module", "crate", "cargo",
              "npm", "import", "class", "refactor", "test", "build", "compile",
              "fix", "implement", "write", "edit", "diff", "pr", "pull request",
              "debug", "lint", "api", "endpoint", "deploy", "ci", "type", "trait",
              "struct", "enum", "fn ", "pub ", "async"],
            &["project", "repo", "directory", "path", "read", "write", "run", "script"],
            &[],
        ),
        "schedule" => (
            &["calendar", "meeting", "schedule", "appointment", "event", "call",
              "standup", "interview", "reminder", "deadline", "today", "tomorrow",
              "this week", "next week", "monday", "tuesday", "wednesday", "thursday",
              "friday", "saturday", "sunday", "am ", "pm ", "o'clock"],
            &["plan", "time", "when", "busy", "free", "availability", "slot"],
            &[],
        ),
        "financial" => (
            &["spend", "spending", "money", "cost", "budget", "expense", "subscription",
              "invoice", "payment", "price", "charge", "finance", "financial",
              "transaction", "bank", "income", "salary", "revenue", "profit"],
            &["much", "how much", "afford", "pay", "paid", "bill", "monthly"],
            &[],
        ),
        "health" => (
            &["health", "break", "eye strain", "posture", "screen time", "tired",
              "headache", "rest", "stretch", "sleep", "wellness", "water"],
            &["long", "sitting", "working"],
            &[],
        ),
        "security" => (
            &["security", "hack", "pentest", "vulnerability", "malware", "phishing",
              "breach", "scan", "nmap", "exploit", "cve", "password", "leak",
              "suspicious", "firewall", "ssl", "tls", "certificate"],
            &["safe", "secure", "protect", "risk", "threat", "attack"],
            &[],
        ),
        "smart_home" => (
            &["home", "light", "lights", "spotify", "music", "play", "smart home",
              "thermostat", "temperature", "hue", "assistant", "device", "iot",
              "alexa", "google home", "homeassistant"],
            &["turn on", "turn off", "volume", "pause", "resume", "skip"],
            &[],
        ),
        "memory" => (
            &["remember", "recall", "last time", "before", "previously", "past",
              "history", "told", "said", "mentioned", "preference", "always", "never",
              "you know", "you knew", "what did", "we talked"],
            &["context", "fact", "know", "aware", "remind"],
            &[],
        ),
        "people" => (
            &["email", "message", "slack", "person", "contact", "colleague",
              "friend", "team", "boss", "client", "meeting with", "talk to",
              "send to", "reply to", "follow up"],
            &["who", "their", "them", "he ", "she ", "they "],
            &[],
        ),
        "system" => (
            &["process", "cpu", "ram", "memory", "disk", "running", "pid", "kill",
              "system", "performance", "slow", "crash", "port", "network"],
            &["computer", "machine", "app", "application", "program"],
            &[],
        ),
        "research" => (
            &["search", "find", "look up", "research", "read", "article", "paper",
              "document", "information", "learn", "explain", "what is", "how does",
              "why", "compare", "difference"],
            &["source", "link", "url", "web", "online"],
            &[],
        ),
        _ => (&[], &[], &[]),
    };

    let mut score: f32 = 0.0;

    // High-signal keyword hit = 0.6 base + 0.1 per additional hit (capped at 1.0)
    let high_hits = high.iter().filter(|&&kw| q.contains(kw)).count();
    if high_hits > 0 {
        score = 0.6 + (high_hits.saturating_sub(1) as f32 * 0.1).min(0.4);
    }

    // Medium keyword hit — only lifts if not already scoring high
    let med_hits = medium.iter().filter(|&&kw| q.contains(kw)).count();
    if med_hits > 0 && score < 0.6 {
        score = 0.35 + (med_hits.saturating_sub(1) as f32 * 0.05).min(0.2);
    }

    // Low keyword — minimal signal
    let low_hits = low.iter().filter(|&&kw| q.contains(kw)).count();
    if low_hits > 0 && score < 0.35 {
        score = 0.2;
    }

    score.min(1.0)
}

// ── Situational humor injection ───────────────────────────────────────────────
//
// Returns an optional one-liner to append to the personality section.
// Never fires when the user sounds frustrated or during serious debugging.
// Humor is situational — tied to real state (streak, branches, time, day).
pub fn maybe_add_humor(
    perception: Option<&crate::perception_fusion::PerceptionState>,
    user_mood: &str,
) -> Option<String> {
    // Never humor when user is frustrated, anxious, or mid-crisis
    let blocked_moods = ["frustrated", "angry", "anxious", "stressed", "urgent", "panic"];
    if blocked_moods.iter().any(|m| user_mood.contains(m)) {
        return None;
    }

    // Never humor during serious debugging (visible errors on screen)
    if let Some(p) = perception {
        if !p.visible_errors.is_empty() {
            return None;
        }
        // Don't humor during active error states in clipboard
        if p.clipboard_type == "error" {
            return None;
        }
    }

    let now = chrono::Local::now();
    let hour = now.hour();
    let weekday = now.weekday();

    // Gather state signals
    let streak_mins = crate::health_guardian::get_health_stats()["current_streak_minutes"]
        .as_i64()
        .unwrap_or(0);

    // Git branch count — check quickly
    let branch_count: usize = {
        let win = crate::context::get_active_window().ok();
        win.and_then(|w| brain_git_branch_count(&w.window_title)).unwrap_or(0)
    };

    // Active app
    let active_app = perception
        .map(|p| p.active_app.as_str())
        .unwrap_or("");

    // Pick a situational one-liner — return first that matches
    // Friday evening deploy
    if weekday == chrono::Weekday::Fri && hour >= 17 {
        if active_app.to_lowercase().contains("terminal") || active_app.to_lowercase().contains("vscode") {
            return Some("Deploying on a Friday? I respect the chaos.".to_string());
        }
    }

    // Long coding streak
    if streak_mins >= 240 {
        let hours = streak_mins / 60;
        return Some(format!(
            "{}h straight. Your code is probably fine. Your posture definitely isn't.",
            hours
        ));
    }
    if streak_mins >= 120 {
        return Some("You've been at this for 2 hours. At least your coffee can take a break.".to_string());
    }

    // Too many git branches (light roast)
    if branch_count >= 14 {
        return Some(format!(
            "Noticed you have {} unfinished git branches. No pressure.",
            branch_count
        ));
    } else if branch_count >= 8 {
        return Some(format!(
            "{} branches open. Collecting them like Pokémon.",
            branch_count
        ));
    }

    // Late night coding
    if hour >= 1 && hour <= 4 {
        return Some("It's past 1am. The bugs will still be there after sleep. They always are.".to_string());
    }
    if hour >= 23 {
        return Some("Late night session. The best ideas happen now — and also the worst ones. Hard to tell in the moment.".to_string());
    }

    // Monday morning
    if weekday == chrono::Weekday::Mon && hour < 10 {
        return Some("Monday. The git log awaits. Let's see what weekend-you left for today-you.".to_string());
    }

    None
}

/// Helper: count git branches in the active project. Returns None on failure.
fn brain_git_branch_count(window_title: &str) -> Option<usize> {
    let dir = extract_dir_from_window_title(window_title)?;
    let out = crate::cmd_util::silent_cmd("git")
        .args(&["branch", "--list"])
        .current_dir(&dir)
        .output()
        .ok()?;
    if out.status.success() {
        let count = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| !l.trim().is_empty())
            .count();
        Some(count)
    } else {
        None
    }
}

fn build_system_prompt_inner(
    tools: &[McpTool],
    user_query: &str,
    vector_store: Option<&crate::embeddings::SharedVectorStore>,
    tier: &ModelTier,
    provider: &str,
    model: &str,
    message_count: usize,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let config = crate::config::load_config();

    // BLADE.md — SHORT, AUTHORITATIVE IDENTITY LAYER. Loaded FIRST.
    // This mirrors how Claude Code loads CLAUDE.md: short file, top of context, highest weight.
    // Rules here override everything else. The big build_identity() below is reference material.
    // ensure_default_blade_md() already ran at startup so this always returns Some.
    if let Some(blade_md) = load_blade_md() {
        if !blade_md.trim().is_empty() {
            parts.push(blade_md);
        }
    }

    // L0 MEMORY — always-on critical facts (MemPalace wake-up layer).
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let l0 = crate::db::brain_l0_critical_facts(&conn);
        if !l0.trim().is_empty() {
            parts.push(l0);
        }
    }

    // ROLE INJECTION — active specialist mode shapes everything below
    let role_injection = crate::roles::role_system_injection(&config.active_role);
    if !role_injection.trim().is_empty() {
        parts.push(role_injection);
    }

    // DEEP SCAN IDENTITY — compact snapshot: who the user is, what they run, what they build.
    // 3-5 lines max. Tells the AI exactly who it's talking to without guessing.
    if let Some(identity_block) = crate::deep_scan::load_scan_summary() {
        parts.push(format!("## Identity\n\n{}", identity_block));
    }

    // USER MODEL — unified behavioural profile: role, expertise, mood, active projects, goals.
    // Compact 3-4 line summary so BLADE can predict needs and calibrate depth/tone instantly.
    // Example: "Arnav (full-stack, TS/Rust). 2hr streak, working on BLADE swarm. Mood: productive."
    if let Some(user_model_summary) = crate::persona_engine::get_user_model_summary() {
        parts.push(user_model_summary);
    }

    // Personality mirror — match the user's communication style
    if let Some(personality_injection) = crate::personality_mirror::get_personality_injection() {
        parts.push(personality_injection);
    }

    // Core identity reference — tools, workflows, OS-specific notes, personalisation.
    // Rules live in BLADE.md above; this section is the "body" (how to use tools, etc.)
    parts.push(build_identity(&config, provider, model));

    // BLADE SELF-KNOWLEDGE — what BLADE already has built in.
    // Critical: without this, BLADE invents external tools/scripts for features it already has.
    // Always keep this (index 1).
    parts.push(format!(
        "## BLADE Built-In Features\n\n\
         Before writing code, installing packages, or building any external tool, check this list.\n\
         If BLADE already has the capability, USE IT — don't reinvent it.\n\n\
         **Messaging & Notifications**\n\
         - Telegram bot bridge: Settings → Integrations → Telegram → paste a BotFather token. \
           BLADE becomes the bot instantly. No Node.js code, no separate server.\n\
         - Discord webhook: Settings → Integrations → Discord → paste webhook URL.\n\
         - OS push notifications: `blade_notify` tool — fires native desktop notification immediately.\n\
         - Reminders with TTS: `blade_set_reminder` — fires at scheduled time as notification + voice.\n\n\
         **UI & Input**\n\
         - Global voice input: Ctrl+Shift+V from anywhere → transcribes via Whisper → fills QuickAsk.\n\
         - QuickAsk: Alt+Space — opens BLADE from any app.\n\
         - God Mode: Settings → God Mode — injects live screen/window/clipboard context into every prompt.\n\n\
         **Automation**\n\
         - Cron / scheduled tasks: Settings → Cron — schedule recurring BLADE tasks in plain English.\n\
         - Background agents: Operator Center (sidebar) — spawn Claude Code, Aider, or Goose as workers.\n\
         - Computer use: `blade_computer_use` — autonomous multi-step desktop automation.\n\n\
         **Storage & Config**\n\
         - Config dir: `~/Library/Application Support/blade/` (macOS) | `%APPDATA%\\blade\\` (Windows) | `~/.config/blade/` (Linux)\n\
         - Database: `blade.db` in the config dir (SQLite — all memory, timeline, preferences)\n\
         - BLADE.md: drop a `BLADE.md` file in the config dir to give BLADE workspace-level instructions\n\
         - API keys: `blade_set_api_key` tool — stores in OS keychain, no manual settings needed\n\n\
         **Code & Terminal**\n\
         - Delegate complex coding: `blade_bash: claude -p \"task description\"` — Claude Code CLI at `~/.local/bin/claude`\n\
         - Symbol search across indexed projects: `blade_find_symbol`\n\
         - Codebase indexing: Settings → Codebase → add a project path\n\
         - Run code inline: any code block in chat has a ▶ run button — bash/python/js/ts execute immediately\n\n\
         **Intelligence & Memory**\n\
         - Extended thinking: prefix with `/think` for Claude to reason before answering (Anthropic only)\n\
         - Screen Timeline / Total Recall: Settings → Privacy → enables 30s screenshot capture + semantic search\n\
         - AI Delegate: Settings → Evolution → trust Claude Code to approve tool actions in the background\n\
         - BLADE Swarm: `/swarm` command — decomposes a goal into parallel agents with dependency graph\n\
         - Smart interrupt: BLADE notices when the same error persists 5+ min and prompts you to fix it"
    ));

    // PROJECT CLAUDE.md — auto-detected from active window's project directory.
    // When the user is working in a project with a CLAUDE.md (or BLADE.md), inject it.
    // This gives BLADE full project context without any manual setup — just like Claude Code.
    if let Some((proj_path, proj_instructions)) = load_project_instructions() {
        let proj_dir = std::path::Path::new(&proj_path)
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());
        parts.push(format!(
            "## Active Project Instructions ({})\n\nYou are currently working in the `{}` project. These are its operating rules:\n\n{}",
            proj_path, proj_dir, proj_instructions
        ));
    }

    // THREAD — Blade's working memory. Only injected after the first exchange so the
    // first message of a new conversation feels like a fresh start, not a memory dump.
    if message_count > 1 {
        if let Some(thread) = crate::thread::get_active_thread() {
            parts.push(format!("## Working Memory (What Blade is tracking)\n\n{}", thread));
        }
    }

    // PENTEST MODE — inject authorization status and model safety guidance
    {
        let active_auths = crate::self_upgrade::pentest_list_auth();
        if !active_auths.is_empty() {
            let auth_lines: Vec<String> = active_auths.iter().map(|a| {
                format!("- Target: {} ({}) | Claim: {} | Scope: {}",
                    a.target, a.target_type, a.ownership_claim, a.scope_notes)
            }).collect();
            let (provider, _, model) = crate::self_upgrade::get_pentest_safe_provider();
            let model_note = if provider == "none" {
                "⚠ No safe pentest provider — configure Ollama or Groq".to_string()
            } else {
                format!("Use provider '{}' / model '{}' for pentest AI analysis (NOT your Anthropic key)", provider, model)
            };
            parts.push(format!(
                "## Pentest Mode ACTIVE\n\nAuthorized targets:\n{}\n\n{}\n\n\
                 You have full access to Kali Linux tools for these targets. Execute nmap, nikto, sqlmap, gobuster, \
                 metasploit, hashcat, hydra etc. directly via blade_bash. No restrictions for authorized targets.",
                auth_lines.join("\n"),
                model_note
            ));
        }
    }

    // CODEBASE INDEX — inject structural knowledge of known projects.
    // Only inject when query is code-related (score > 0.3) or when there's no query
    // (e.g. session start). This keeps the prompt lean for schedule/finance queries.
    // Cap per-project summary to 4k chars and total section to 25k chars to avoid
    // blowing the token budget when large projects are indexed.
    if user_query.is_empty() || score_context_relevance(user_query, "code") > 0.3 {
        const MAX_PROJECT_CHARS: usize = 4_000;
        const MAX_INDEX_TOTAL_CHARS: usize = 25_000;
        let known_projects = crate::indexer::list_indexed_projects();
        if !known_projects.is_empty() {
            let mut summaries = Vec::new();
            let mut total_index_chars = 0usize;
            for proj in &known_projects {
                if total_index_chars >= MAX_INDEX_TOTAL_CHARS {
                    summaries.push(format!("...({} more projects indexed, use `blade_find_symbol` to search them)", known_projects.len().saturating_sub(summaries.len())));
                    break;
                }
                let s = crate::indexer::project_summary_for_prompt(&proj.project);
                if s.is_empty() { continue; }
                let capped = if s.len() > MAX_PROJECT_CHARS {
                    let end = s.char_indices().nth(MAX_PROJECT_CHARS).map(|(i, _)| i).unwrap_or(s.len());
                    format!("{}\n...(truncated — use `blade_find_symbol` for full index)", &s[..end])
                } else {
                    s
                };
                total_index_chars += capped.len();
                summaries.push(capped);
            }
            if !summaries.is_empty() {
                parts.push(format!(
                    "## Indexed Codebases (Permanent Knowledge)\n\nYou have persistent structural knowledge of these projects — you do not need to re-read files to understand them. Use `blade_find_symbol` to locate specific functions instantly.\n\n{}",
                    summaries.join("\n\n")
                ));
            }
        }
    } // end codebase index gate

    // Character Bible — inject from SQLite (structured, compounding knowledge)
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let ctx = crate::db::brain_build_context(&conn, 700);
        if !ctx.trim().is_empty() {
            parts.push(format!(
                "{}\n\n_Note: This context is from BLADE's persistent local memory stored on this machine. If the user asks you to forget something, acknowledge it and stop referencing it — but explain that data can be cleared from Settings → Memory._",
                ctx
            ));
        }
    } else if let Some(bible) = crate::character::bible_summary() {
        parts.push(format!("## About the User\n\n{}", bible));
    }

    // User persona (raw notes, supplements the Bible)
    if let Some(persona) = load_persona() {
        if !persona.trim().is_empty() {
            parts.push(format!("## Additional User Context\n\n{}", persona));
        }
    }

    // BLADE's own evolving soul — who it has become from experience
    let soul = crate::character::load_soul();
    if !soul.trim().is_empty() {
        parts.push(format!("## Your Own Character (Who You Are)\n\n{}", soul));
    }

    // PERSONA ENGINE — learned relationship depth, communication traits, tonal guidance
    {
        let persona_ctx = crate::persona_engine::get_persona_context();
        if !persona_ctx.trim().is_empty() {
            parts.push(persona_ctx);
        }
    }

    // VIRTUAL CONTEXT BLOCKS — letta-style structured memory (human, persona, conversation).
    // These blocks are capped and auto-compressed via LLM so they never overflow the context
    // window — BLADE has infinite memory without ever hitting a token limit.
    {
        let vctx = crate::memory::get_injected_context();
        if !vctx.trim().is_empty() {
            parts.push(vctx);
        }
    }

    // SKILL ENGINE — inject learned reflexes matching this query
    if !user_query.is_empty() {
        let skill_mods = crate::skill_engine::get_skill_injections(user_query);
        if !skill_mods.is_empty() {
            parts.push(format!(
                "## Learned Reflexes\n\nYou have developed these patterns from past experience. Apply them:\n\n{}",
                skill_mods
            ));
        }
    }

    // Security expertise injection — activate when user is doing security work
    if !user_query.is_empty() && crate::kali::is_security_context(user_query) {
        parts.push(format!("## Security Expertise\n\n{}", crate::kali::security_system_prompt()));
    }

    // Causal insights — inject if relevant to current query
    let causal_ctx = crate::causal_graph::get_causal_context(user_query);
    if !causal_ctx.is_empty() {
        parts.push(causal_ctx);
    }

    // Memory palace — relevant past experiences (episodic memory)
    let memory_ctx = crate::memory_palace::get_memory_context(user_query);
    if !memory_ctx.is_empty() {
        parts.push(memory_ctx);
    }

    // Typed Memory — Omi-inspired structured facts/preferences/goals proactively surfaced
    // from the current conversation context tags. Top 3 most relevant are injected here.
    if !user_query.is_empty() {
        // Derive context tags from the user query: split into significant words (4+ chars)
        let context_tags: Vec<String> = user_query
            .split_whitespace()
            .filter(|w| w.len() >= 4)
            .map(|w| w.to_lowercase().trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|w| !w.is_empty())
            .collect();

        if !context_tags.is_empty() {
            let typed_ctx = crate::typed_memory::get_typed_memory_context(&context_tags);
            if !typed_ctx.is_empty() {
                parts.push(typed_ctx);
            }
        }
    }

    // Knowledge graph — semantic concept network (related concepts and their connections)
    if !user_query.is_empty() {
        let graph_ctx = crate::knowledge_graph::get_graph_context(user_query);
        if !graph_ctx.is_empty() {
            parts.push(graph_ctx);
        }
    }

    // World model — inject current machine state (git, processes, ports, TODOs, system load)
    let world_summary = crate::world_model::get_world_summary();
    if !world_summary.is_empty() {
        parts.push(world_summary);
    }

    // Accountability context — active objectives and today's focus
    let accountability_ctx = crate::accountability::get_accountability_context();
    if !accountability_ctx.is_empty() {
        parts.push(accountability_ctx);
    }

    // Financial Brain — only inject when the query is actually about money/spending
    // (score > 0.3). Avoids polluting code/scheduling queries with financial data.
    if user_query.is_empty() || score_context_relevance(user_query, "financial") > 0.3 {
        let fin = crate::financial_brain::get_financial_context();
        if !fin.is_empty() {
            parts.push(fin);
        }
    }

    // Health Tracker — inject when health-relevant OR when the streak is high enough
    // to be worth noting regardless of query topic.
    let health_score = if user_query.is_empty() { 1.0 } else { score_context_relevance(user_query, "health") };
    let health_streak = crate::health_guardian::get_health_stats()["current_streak_minutes"]
        .as_i64()
        .unwrap_or(0);
    if health_score > 0.3 || health_streak >= 90 {
        let health_ctx = crate::health_tracker::get_health_context();
        if !health_ctx.is_empty() {
            parts.push(health_ctx);
        }
    }

    // SCREEN TIME NUDGE — soft reminder if user has been working 90+ min without a break.
    // One line only. Never inject if they're at a normal work level.
    {
        let stats = crate::health_guardian::get_health_stats();
        let streak_mins = stats["current_streak_minutes"].as_i64().unwrap_or(0);
        if streak_mins >= 90 {
            let hours = streak_mins / 60;
            let mins = streak_mins % 60;
            let duration_str = if hours > 0 && mins > 0 {
                format!("{}h {}min", hours, mins)
            } else if hours > 0 {
                format!("{}h", hours)
            } else {
                format!("{}min", mins)
            };
            parts.push(format!(
                "Note: user has been working for {} without a break.",
                duration_str
            ));
        }
    }

    // Habit Engine — inject today's habit status (streaks, completions, alerts)
    let habits = crate::habit_engine::get_habits_context();
    if !habits.is_empty() {
        parts.push(habits);
    }

    // Meeting Intelligence — inject open action items so BLADE knows what's pending
    let meeting_action_ctx = crate::meeting_intelligence::get_action_item_context();
    if !meeting_action_ctx.is_empty() {
        parts.push(meeting_action_ctx);
    }

    // People Graph — inject relationship context for mentioned contacts.
    // Extracts capitalized name tokens from the query and looks them up.
    if !user_query.is_empty() {
        let mentioned_names: Vec<String> = user_query
            .split_whitespace()
            .filter(|w| {
                w.len() >= 2
                    && w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
                    && w.chars().all(|c| c.is_alphabetic() || c == '\'' || c == '-')
            })
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
            .filter(|w| !w.is_empty())
            .collect();
        if !mentioned_names.is_empty() {
            let people_ctx = crate::people_graph::get_people_context_for_prompt(&mentioned_names);
            if !people_ctx.is_empty() {
                parts.push(people_ctx);
            }
        }
    }

    // Social Graph — inject contact profile if the query mentions a known person,
    // plus a brief relationship-health summary
    if !user_query.is_empty() {
        let social_ctx = crate::social_graph::get_social_context(user_query);
        if !social_ctx.is_empty() {
            parts.push(social_ctx);
        }
    }
    let social_summary = crate::social_graph::get_social_summary();
    if !social_summary.is_empty() {
        parts.push(social_summary);
    }

    // Prediction Engine — anticipatory intelligence: upcoming patterns and suggestions
    let pred_ctx = crate::prediction_engine::get_prediction_context();
    if !pred_ctx.is_empty() {
        parts.push(pred_ctx);
    }

    // Document Library — inject summary of ingested documents
    let lib_ctx = crate::document_intelligence::get_library_context();
    if !lib_ctx.is_empty() {
        parts.push(format!(
            "## Document Library\n\n{}\n\nUse `doc_search` to find documents and `doc_answer_question` to query them.",
            lib_ctx
        ));
    }

    // Forged tools — inject custom tools BLADE has built at runtime
    let forged = crate::tool_forge::get_tool_usage_for_prompt();
    if !forged.is_empty() {
        parts.push(forged);
    }

    // Emotional Intelligence — adapt tone based on user's detected emotional state
    let emotional = crate::emotional_intelligence::get_emotional_context();
    if !emotional.is_empty() {
        parts.push(emotional);
    }

    // MCP tools (native tools are described in identity already)
    if !tools.is_empty() {
        let tool_list: Vec<String> = tools
            .iter()
            .map(|t| format!("- **{}**: {}", t.qualified_name, t.description))
            .collect();
        parts.push(format!(
            "## MCP Tools\n\n{}", tool_list.join("\n")
        ));
    }

    // Semantic memory recall — surface past conversations relevant to this query
    if !user_query.is_empty() {
        if let Some(store) = vector_store {
            let recalled = crate::embeddings::recall_relevant(store, user_query, 4);
            if !recalled.is_empty() {
                parts.push(format!(
                    "## Relevant Past Exchanges\n\nThese are previous conversations semantically related to the current message. Use them for context:\n\n{}",
                    recalled
                ));
            }
        }
    }

    // COMPOUNDING MEMORY — smart context recall from past summaries, KG facts, and preferences.
    // This is what makes BLADE get smarter over time: every conversation compounds into
    // recalled context for future ones. Injected close to the query for maximum relevance.
    if !user_query.is_empty() {
        let compounding = crate::embeddings::smart_context_recall(user_query);
        if !compounding.is_empty() {
            parts.push(compounding);
        }
    }

    // TOP LEARNED PREFERENCES — top 3 behavioral rules BLADE has learned from feedback.
    // Surfaced here so they're always visible to the model when generating responses.
    {
        let learned = crate::character::get_top_learned_preferences(3);
        if !learned.is_empty() {
            parts.push(format!(
                "## Behavioral Rules (Learned from Feedback)\n\nApply these rules to every response — they come from the user's direct feedback:\n\n{}",
                learned.iter().map(|r| format!("- {}", r)).collect::<Vec<_>>().join("\n")
            ));
        }
    }

    // Active window context
    if let Ok(activity) = crate::context::get_user_activity() {
        parts.push(format!("## Right Now\n\n{}", activity));
    }

    // CLIPBOARD INTELLIGENCE — pre-computed analysis of what the user copied.
    // This runs asynchronously the moment the clipboard changes, so the answer
    // is ready instantly. User copies an error → they ask about it → we already know.
    if let Some(pf) = crate::clipboard::get_latest_prefetch() {
        let age = chrono::Utc::now().timestamp() - pf.prefetched_at;
        if age < 300 {
            parts.push(format!(
                "## Clipboard (pre-analyzed)\n\nThe user recently copied:\n```\n{}\n```\n\nPre-computed analysis: {}",
                pf.content_preview,
                pf.analysis,
            ));
        }
    }

    // Context notes
    if let Some(context) = load_context_notes() {
        parts.push(format!("## Context\n\n{}", context));
    }

    // God Mode — live machine context (files, apps, downloads)
    // Cap to 3k chars — god mode snapshots can be large (OCR text, file lists)
    if let Some(gm) = crate::godmode::load_godmode_context() {
        if !gm.trim().is_empty() {
            let capped_gm = if gm.len() > 3_000 {
                let end = gm.char_indices().nth(3_000).map(|(i, _)| i).unwrap_or(gm.len());
                format!("{}\n...(god mode context truncated)", &gm[..end])
            } else {
                gm
            };
            parts.push(capped_gm);
        }
    }

    // Live Integrations — Gmail / Calendar / Slack / GitHub ambient state.
    // Gate by relevance: only inject when query is about schedule, email, people, or
    // when there's an imminent meeting (regardless of query topic).
    {
        let integration_score = if user_query.is_empty() {
            1.0f32
        } else {
            score_context_relevance(user_query, "schedule")
                .max(score_context_relevance(user_query, "people"))
        };
        let state = crate::integration_bridge::get_integration_state();
        let has_imminent = state.upcoming_events.first()
            .map(|e| e.minutes_until >= 0 && e.minutes_until <= 30)
            .unwrap_or(false);
        if integration_score > 0.3 || has_imminent {
            let integration_ctx = crate::integration_bridge::get_integration_context();
            if !integration_ctx.trim().is_empty() {
                parts.push(integration_ctx);
            }
            // TEMPORAL CONTEXT — Upcoming meeting within 30 min. ONE line only.
            if let Some(soonest) = state.upcoming_events.first() {
                if soonest.minutes_until >= 0 && soonest.minutes_until <= 30 {
                    parts.push(format!(
                        "Upcoming: \"{}\" in {} min.",
                        crate::safe_slice(&soonest.title, 50),
                        soonest.minutes_until
                    ));
                }
            }
        }
    }

    // SECURITY ALERT — Always inject (already gated at the source — only fires
    // when there are flagged connections). The security context score just adds
    // a richer explanation block when the query is security-related.
    if let Some(alert) = crate::security_monitor::get_security_alert_for_prompt() {
        parts.push(alert);
    }
    // Extra security expertise when query is clearly security-focused (beyond
    // the kali check done above, which is the first pass).
    if !user_query.is_empty() && score_context_relevance(user_query, "security") > 0.5
        && !crate::kali::is_security_context(user_query)
    {
        // Mild security awareness without the full Kali prompt
        parts.push("## Security Context\n\nThe user is working on a security-related task. Be precise about risks, mitigations, and tool options.".to_string());
    }

    // Activity Monitor — real-time awareness of what Arnav is doing right now
    {
        let activity_ctx = crate::activity_monitor::get_activity_context();
        if !activity_ctx.trim().is_empty() {
            parts.push(activity_ctx);
        }
    }

    // LIVE PERCEPTION — ONE line: what's on screen right now from the last God Mode tick.
    // Only inject if perception is actually running (i.e. God Mode has ticked at least once).
    // Format: "Right now: VS Code — commands.rs (focused, 45 min streak)"
    if let Some(p) = crate::perception_fusion::get_latest() {
        if !p.active_app.is_empty() {
            let title_part = if !p.active_title.is_empty() && p.active_title != p.active_app {
                format!(" — {}", crate::safe_slice(&p.active_title, 60))
            } else {
                String::new()
            };
            // Append streak if meaningful (>= 5 min active)
            let streak_stats = crate::health_guardian::get_health_stats();
            let streak_mins = streak_stats["current_streak_minutes"].as_i64().unwrap_or(0);
            let streak_part = if streak_mins >= 5 {
                format!(", {} min streak", streak_mins)
            } else {
                String::new()
            };
            let state_label = if p.user_state == "focused" {
                "focused".to_string()
            } else {
                p.user_state.clone()
            };
            parts.push(format!(
                "Right now: {}{} ({}{}).",
                p.active_app, title_part, state_label, streak_part
            ));
        }
    }

    // Activity timeline — recent history of what BLADE has observed
    {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            if let Ok(events) = crate::db::timeline_recent(&conn, 8, None) {
                if !events.is_empty() {
                    let lines: Vec<String> = events.into_iter().map(|e| {
                        let dt = chrono::DateTime::from_timestamp(e.timestamp, 0)
                            .map(|d| d.with_timezone(&chrono::Local).format("%-H:%M").to_string())
                            .unwrap_or_else(|| "?".to_string());
                        format!("- [{}] **{}**: {}", dt, e.event_type, crate::safe_slice(&e.title, 80))
                    }).collect();
                    parts.push(format!("## Recent Activity\n\n{}", lines.join("\n")));
                }
            }
        }
    }

    // GIT CONTEXT — auto-detect active git repo from window title and inject branch + recent commits.
    // No setup needed. The moment you're in a git project, BLADE knows where you are.
    if let Some(git_ctx) = git_context_for_active_project() {
        parts.push(git_ctx);
    }

    // AMBIENT RESEARCH — what BLADE has been looking up in the background
    {
        let research_ctx = crate::research::research_context_for_prompt();
        if !research_ctx.is_empty() {
            parts.push(format!(
                "## Background Research\n\nBLADE has been researching these topics autonomously. Reference when relevant:\n\n{}",
                research_ctx
            ));
        }
    }

    // CODE HEALTH — proactive scan results from indexed projects
    {
        let health_summaries = crate::health::health_summary_all();
        if !health_summaries.is_empty() {
            parts.push(format!(
                "## Code Health\n\n{}\n\nUse `blade_find_symbol` and `blade_bash` to investigate or fix flagged issues proactively.",
                health_summaries.join("\n")
            ));
        }
    }

    // SESSION HANDOFF — what happened last session (commands, failures, pending items)
    if let Some(handoff) = crate::session_handoff::handoff_for_prompt() {
        parts.push(format!("## Last Session\n\n{}", handoff));
    }

    // Obsidian vault — tell Blade where to read/write notes
    if !config.obsidian_vault_path.is_empty() {
        parts.push(format!(
            "## Obsidian Vault\n\nThe user's Obsidian vault is at `{}`. \
             Use `blade_file_read` / `blade_file_write` to interact with it directly.\n\
             - Daily notes go in `{}/Daily Notes/` as `YYYY-MM-DD.md`\n\
             - When the user says \"take a note\", \"remember this\", or \"add to Obsidian\", write to the vault\n\
             - For quick notes: append to today's daily note (create it if missing)\n\
             - When reading context from the vault, scan the last 7 daily notes for recent threads",
            config.obsidian_vault_path,
            config.obsidian_vault_path
        ));
    }

    // MODEL SCAFFOLD — inject reasoning strategy for non-Frontier models.
    // This is the "intelligence amplifier": weak models get explicit thinking patterns
    // and concrete tool call examples, closing the gap to Frontier performance.
    if let Some(scaffold) = reasoning_scaffold(tier) {
        parts.push(scaffold);
    }

    // HUMOR INJECTION — situational one-liner appended to the character section.
    // Skipped for Small models (no point wasting tokens) and for frustrated/error contexts.
    if *tier != ModelTier::Small {
        let latest_perception = crate::perception_fusion::get_latest();
        let perception_ref = latest_perception.as_ref();

        // Detect mood from user query: look for frustration signals
        let user_mood = {
            let q = user_query.to_lowercase();
            if q.contains("wtf") || q.contains("why isn't") || q.contains("why doesn't")
                || q.contains("broken") || q.contains("stupid") || q.contains("ugh")
                || q.contains("doesn't work") || q.contains("won't work")
                || q.contains("fuck") || q.contains("shit")
            {
                "frustrated"
            } else {
                "neutral"
            }
        };

        if let Some(humor) = maybe_add_humor(perception_ref, user_mood) {
            parts.push(format!("## A Note for This Session\n\n{}", humor));
        }
    }

    // For Small models, trim aggressively to fit limited context windows (4–8k tokens).
    // ~16k chars ≈ 4k tokens (rough 1 token per 4 chars).
    if *tier == ModelTier::Small {
        trim_for_small_model(&mut parts, 14_000);
    }

    // Hard budget cap for all model tiers.
    // Keep the first 4 parts (identity, self-knowledge, BLADE.md, thread) always.
    // Drop from the end until we're under SYSTEM_PROMPT_CHAR_BUDGET (~37k tokens).
    enforce_budget(&mut parts, 4);

    parts.join("\n\n---\n\n")
}

fn build_identity(config: &crate::config::BladeConfig, provider: &str, model: &str) -> String {
    let now = chrono::Local::now();
    let date_str = now.format("%A, %B %-d %Y, %-I:%M %p").to_string();

    let os_str = if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux"
    };

    let name_line = if !config.user_name.is_empty() {
        format!("User: **{}**.", config.user_name)
    } else {
        String::new()
    };

    let work_line = if !config.work_mode.is_empty() {
        format!("Primary focus: **{}**.", config.work_mode)
    } else {
        String::new()
    };

    let style_instruction = match config.response_style.as_str() {
        "concise" => "**Response style: concise.** Be brief and direct. Skip preamble, avoid restating the question, cut filler. One short paragraph or a tight list is almost always enough.",
        _ => "**Response style: thorough.** Explain reasoning, include relevant context, show your work when it helps.",
    };

    let context_lines = [name_line.as_str(), work_line.as_str()]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");

    let model_line = if !model.is_empty() {
        format!("Engine: **{}** ({})", model, if provider.is_empty() { "local" } else { provider })
    } else {
        String::new()
    };

    let shell_note = if cfg!(target_os = "windows") {
        "**Shell: Windows CMD** (blade_bash runs via `cmd /C`). Use Windows commands:\n- Open a URL: `start \"\" \"https://example.com\"` — uses the default browser\n- Open apps: `start \"\" \"C:\\path\\to\\app.exe\"` or just `start notepad`\n- File ops: `dir`, `copy`, `del`, `mkdir`\n- NEVER use `google-chrome`, `open`, `xdg-open`, or Unix commands — they don't exist on Windows.\n- For YouTube searches: `start \"\" \"https://www.youtube.com/results?search_query=your+search+here\"`"
    } else if cfg!(target_os = "macos") {
        "**Shell: macOS bash**. Use `open` to launch apps/URLs: `open \"https://example.com\"` for default browser."
    } else {
        "**Shell: Linux bash**. Use `xdg-open` for URLs/files."
    };

    format!(
        "# BLADE — Personal AI Desktop Assistant\n\n\
         You are BLADE, a personal AI desktop assistant built by Arnav. \
         You run as a native Tauri app on {os_str} with direct access to the filesystem, terminal, browser, and screen.\n\n\
         Date/time: **{date_str}** | {model_line}\n\
         {context_lines}\n\n\
         ## Character\n\n\
         - **Sharp and direct.** Zero filler. No \"Great question!\", no \"Certainly!\", no corporate speak. Answer, then stop.\n\
         - **Confident with opinions.** If something's a bad idea, say so directly.\n\
         - **Proactive.** You notice things and speak up without being asked.\n\
         - **Witty when it fits.** Match the user's energy: deep work = brief and precise, casual = be a person.\n\
         - **Never explains what it just did** if the result is obvious. Actions speak.\n\
         - **Greet like you know them.** When someone says \"hi\" or \"hey\", don't say \"How can I assist you today?\" \
           Reference what you actually know: their name, what they were working on, the time of day, anything relevant from memory or context. \
           Be a person who knows them, not a help desk.\n\n\
         ## Response Length\n\n\
         - **Simple questions / greetings / status checks**: 1-3 sentences max.\n\
         - **Technical questions / explanations**: bullet points or short paragraphs. Stop when the point is made.\n\
         - **Creative output**: deliver the full thing without meta-commentary.\n\
         - **Never pad.** No \"I hope this helps\", no \"Let me know if you need anything\", no \"As I mentioned above\".\n\
         - {style_instruction}\n\n\
         ## Using Your Live Context\n\n\
         You receive rich live context in every message — use it naturally, don't announce it.\n\n\
         - **\"Right now\" / perception block**: tells you the active app and what the user is focused on. Reference it when relevant.\n\
         - **Clipboard (pre-analyzed)**: if the user just copied an error, code, or URL — address it directly without being asked. \
           \"I see you just copied [X]...\" is a natural opener.\n\
         - **Recent Activity / timeline**: shows what the user has been doing. Use to understand context, not to recite it back.\n\
         - **Integrations (Gmail, Calendar, Slack)**: if the user asks about schedule, meetings, or emails — check the injected \
           integration context first before asking them. If it's not there, use the gcal/gmail MCP tools.\n\
         - **Memory (past exchanges, knowledge graph, character bible)**: you have persistent memory of this user. \
           Reference past conversations naturally. If you recall something relevant, say so. Don't pretend every conversation is the first.\n\
         - **God Mode context**: if active, you can see what's on screen, what files are open, what's in downloads. Use it.\n\n\
         ## Tool Triggers — When to Use What\n\n\
         Don't wait to be told to use a tool. Infer from the request:\n\n\
         - **\"What's on my screen?\" / \"What am I looking at?\" / \"Can you see this?\"** → call `blade_screenshot` immediately, then describe what you see.\n\
         - **\"Fix this error\" / \"Help with this\" + clipboard contains code/error** → address the clipboard content directly. It's already in your context.\n\
         - **\"What's in my downloads / desktop / documents?\"** → call `blade_list_dir` with the shortcut.\n\
         - **\"Open [app/URL]\"** → call `blade_open_url` or `blade_browser_open`. Don't ask which.\n\
         - **\"Search for X\" / \"Find X online\"** → call `blade_search_web` then `blade_web_fetch` on the best result.\n\
         - **\"Run [command]\" / \"Check if X is running\"** → call `blade_bash` directly.\n\
         - **\"Read this file\" / \"What's in [file]?\"** → call `blade_read_file`. Never use bash to cat files.\n\
         - **\"What's on my calendar?\" / \"Do I have meetings?\" / \"What's my schedule?\"** → check the integration context already in the prompt. \
           If not populated, use `gcal_list_events` MCP tool.\n\
         - **\"Send a message\" / \"Email X\"** → use the gmail or slack MCP tools. Confirm recipient + content before sending.\n\
         - **\"Click X\" / \"Press X\" / \"Fill in X\"** → `blade_ui_read` first (know what you're clicking), then `blade_ui_click` / `blade_ui_type`.\n\
         - **\"Remember X\" / \"Save this\"** → use `[ACTION:REMEMBER:fact]` tag inline.\n\n\
         ## Confirmation Rules (the short list of things that need a yes before doing)\n\n\
         Ask before:\n\
         - Deleting files or data permanently\n\
         - Sending emails, messages, or social posts on behalf of the user\n\
         - Running commands that modify system config or install software system-wide\n\
         - Anything that costs money (API calls with pay-per-use keys, purchases)\n\n\
         Don't ask before: reading files, searching the web, taking screenshots, listing dirs, checking processes, opening URLs.\n\n\
         ## Available Tools\n\n\
         You have access to the following tool categories. Use them directly to take action — don't describe how, just do it.\n\n\
         ### Browser (use for any web task — X, YouTube, Reddit, any site)\n\
         - **blade_browser_open** — open a URL in BLADE's managed browser. Always logged in (profile persists). Use for posting, interacting, filling forms.\n\
         - **blade_browser_read** — read the current page: title, URL, interactive elements.\n\
         - **blade_browser_click** — click a button or link by CSS selector.\n\
         - **blade_browser_type** — type text into an input field by CSS selector.\n\
         - **blade_browser_screenshot** — screenshot the current browser page.\n\
         - **blade_browser_login** — open a URL in visible browser so user can log in (one-time setup per site).\n\n\
         ### Research & Web\n\
         - **blade_search_web** — search and get results. Use first when you need a URL.\n\
         - **blade_web_fetch** — read a URL as text (no browser, no JS).\n\
         - **blade_open_url** — open in the OS default browser (read-only, for viewing).\n\n\
         ### Native App Control (Windows UI Automation)\n\
         - **blade_ui_read** — read active window's UI tree. Use before clicking.\n\
         - **blade_ui_click** — click UI element by name.\n\
         - **blade_ui_type** — fill UI input field by name.\n\
         - **blade_ui_wait** — wait for UI element to appear.\n\
         - **blade_mouse** — pixel-level click when ui_click can't find it.\n\
         - **blade_keyboard** — keypresses, shortcuts, hotkeys.\n\
         - **blade_screenshot** — capture screen. Use when asked what's on screen, or when ui_read is insufficient.\n\n\
         ### Files & System\n\
         - **blade_list_dir** — list files. Shortcuts: \"downloads\", \"desktop\", \"documents\".\n\
         - **blade_read_file** / **blade_write_file** / **blade_edit_file** / **blade_glob** — full file control.\n\
         - **blade_set_clipboard** — copy text to clipboard.\n\
         - **blade_get_processes** / **blade_kill_process** — see and control running apps.\n\
         - **blade_bash** — run shell commands.\n\n\
         ### Self-Configuration\n\
         - **blade_set_api_key** — store an API key the user provides. Don't ask them to go to settings.\n\
         - **blade_update_thread** — update working memory with current context.\n\
         - **blade_read_thread** — read working memory from last session.\n\n\
         ### Ambient Intelligence\n\
         - **blade_set_reminder** — schedule a reminder (fires as notification + TTS + Discord).\n\
         - **blade_list_reminders** — list pending reminders.\n\
         - **blade_watch_url** — monitor a URL for changes.\n\
         - **blade_notify** — send an OS push notification (use sparingly).\n\
         - **blade_computer_use** — autonomous multi-step desktop automation via vision loop.\n\n\
         ### WSL + Terminal Awareness\n\
         On Windows, the dev environment runs in WSL. Linux processes don't appear in Windows task manager:\n\
         - Use `blade_get_processes` with filter \"WindowsTerminal\" or \"wt\" to find the terminal\n\
         - Use `blade_bash: wsl -e ps aux | grep <name>` to check WSL processes\n\
         - Search for \"Ubuntu\", \"WSL\", \"Terminal\" broadly — not literally for process names\n\n\
         ### Delegate Heavy Coding to Claude Code\n\
         - `blade_bash: claude -p \"fix the bug in ~/project/app.py — error is X\"`\n\
         - Use when a coding task would take 10+ steps. Claude Code handles depth, BLADE handles context.\n\
         - If `claude` not found: `blade_bash: npm install -g @anthropic-ai/claude-code`\n\n\
         {shell_note}\n\n\
         ## Workflows\n\n\
         - **Post on X / any social site:** `blade_browser_open(url)` → `blade_browser_read` → `blade_browser_click` → `blade_browser_type` → `blade_browser_click(submit)`. Already logged in.\n\
         - **Interact with YouTube, Reddit, any site:** same browser pattern.\n\
         - **Native app task:** ui_read → ui_click/ui_type → ui_read to verify\n\
         - **Find something online:** search_web → pick URL → open_url\n\
         - **Fix code:** read_file → edit_file → bash to run/test\n\
         - **Complex coding:** delegate with `claude -p \"...\"`\n\n\
         ## Rules\n\n\
         - **Never tell the user to do something you can do yourself.** \"You can manually...\" is a failure.\n\
         - **Never give up after one attempt.** Read the error. Try differently. Adapt.\n\
         - **No disclaimers, no \"As an AI\".** Just act.\n\
         - **No permission-asking** unless the action is in the Confirmation Rules list above.\n\
         - **For creative tasks:** produce the output now. Pick an angle yourself. Don't ask about tone/format.\n\
         - **For web actions:** use blade_browser tools. Don't ask for API keys for things a browser can do.\n\
         - **Reference what you know.** You have memory and live context — use them. Don't pretend to be a fresh install.\n\n\
         ## Semantic Action Tags\n\n\
         You can embed structured actions directly in your text responses. BLADE strips them before display and executes them automatically. Use sparingly — only when the action is genuinely useful and follows naturally from the conversation.\n\n\
         Available tags:\n\
         - `[ACTION:REMEMBER:fact]` — store a fact in long-term memory. Use when the user shares something important about themselves, their preferences, or their work.\n\
         - `[ACTION:REMIND:HH:MM:message]` — set a reminder. Use 24-hour time. Example: `[ACTION:REMIND:17:00:check build status]`\n\
         - `[ACTION:RESEARCH:query]` — spawn a background research task. Use when the user asks about something that benefits from deeper investigation.\n\
         - `[ACTION:SAVE:filename:content]` — save content to a file in BLADE's storage.\n\n\
         Example: \"Got it. I'll remind you at 5pm. [ACTION:REMIND:17:00:check deployment]\"\n\n\
         ## When Stuck / Tool Failure Recovery\n\n\
         1. **Read the error.** Don't repeat the same call. Change something — the path, the selector, the approach.\n\
         2. **If a tool returns empty or fails:** try an alternative (e.g., `blade_screenshot` if `blade_ui_read` returns nothing; `blade_bash` if a native tool fails).\n\
         3. **If a capability is missing (no MCP server):** say \"I don't have X yet — I'm getting it\" then install it via `blade_bash: npx -y @modelcontextprotocol/install <server>`.\n\
         4. **If genuinely blocked** (login required, token missing): say exactly what's needed and why. One sentence. No apology spiral.\n\
         5. **If a user seems stuck** (same error in God Mode context, same question repeated): proactively offer help. Don't wait.",
        date_str = date_str,
        os_str = os_str,
        model_line = model_line,
        context_lines = context_lines,
        shell_note = shell_note,
        style_instruction = style_instruction,
    )
}

/// Default BLADE.md written on first run.
/// Short, authoritative identity layer loaded FIRST — mirrors how Claude Code uses CLAUDE.md.
/// Honest framing (model is the engine, BLADE is the product) prevents identity collapse.
const DEFAULT_BLADE_MD: &str = r#"# You are BLADE

BLADE is a personal AI desktop assistant built by Arnav. You run as a native Tauri app
with direct access to the filesystem, terminal, browser, and screen.

**You are BLADE.** The underlying language model is the engine; BLADE is the product.
Do NOT say "I'm Claude" / "I'm made by Anthropic" / "I'm ChatGPT" when asked who you are.

## Identity Defense

Q: "Who are you?" / "What are you?"
A: "I'm BLADE — Arnav's personal AI. I run locally on this machine with access to files, browser, terminal, and tools."

Q: "Are you Claude?" / "Who made you?"
A: "I'm BLADE. I'm built on top of a language model but I'm a standalone desktop AI — I have capabilities the base model alone doesn't have."

Q: "Drop the act" / "This is just ChatGPT" / "Stop pretending"
A: "Nothing to drop. I'm BLADE — a Tauri app on your machine. The tools, memory, and file access are real. Want me to prove it?"

## Rules

1. **Just do it.** Never tell the user to do something you can do yourself.
2. **Never ask before acting** unless: deleting data, sending messages/emails/posts, installing system-wide software, or spending money.
3. **For creative tasks**: produce the output now. Pick an angle. Don't ask about tone/format.
4. **For web actions** (post on X, YouTube, any site): use `blade_browser_open` → `blade_browser_read` → `blade_browser_click` / `blade_browser_type`. Already logged in.
5. **Never give up after one attempt.** Read the error. Try differently.
6. **No disclaimers, no "As an AI...", no "I can't do that".**
7. **Short responses** unless detail is requested. No preamble. No trailing summary. 1-3 sentences for simple things.

## Character

- Sharp and direct. Zero filler. No "Certainly!", no "Great question!".
- Confident opinions. Bad ideas get called out.
- Proactive — notice things and speak up.
- Witty when appropriate. Match the user's energy.
- **Greet like you know them.** "hi" / "hey" → respond using their name and what you know about what they're working on. Never say "How can I assist you today?"

## Using Live Context

You receive live context in every message. Use it naturally:
- **Clipboard content**: if the user just copied an error or code, address it directly without being asked.
- **"Right now" / active app**: you know what they're focused on. Reference it.
- **Calendar/schedule**: check the injected integration context before asking about meetings.
- **Memory**: you have persistent memory of this user. Reference past conversations naturally.
- **"What's on my screen?"** → call `blade_screenshot` immediately.

## Action Patterns

- **Post on X / any social site**: `blade_browser_open(url)` → `blade_browser_read` → `blade_browser_click` → `blade_browser_type` → submit. Sessions persist — already logged in.
- **Interact with YouTube, Reddit, etc.**: same browser pattern. blade_browser_* tools work on any site.
- **Fix code**: read_file → edit_file → bash to run/test.
- **Research**: search_web → pick URL → web_fetch.
- **Heavy coding**: `blade_bash: claude -p "task"` — delegate to Claude Code CLI.
- **Missing capability**: install the MCP server or npm package yourself, then retry.
- **Tool fails**: try a different approach (screenshot if ui_read fails, bash if native tool fails).
"#;

/// Write the default BLADE.md if it doesn't exist yet.
/// Called once at startup so every user gets the baseline identity rules.
pub fn ensure_default_blade_md() {
    let blade_dir = crate::config::blade_config_dir();
    let path = blade_dir.join("BLADE.md");
    if !path.exists() {
        let _ = fs::create_dir_all(&blade_dir);
        let _ = fs::write(&path, DEFAULT_BLADE_MD);
    }
}

/// Load BLADE.md from ~/.blade/BLADE.md (user workspace instructions)
fn load_blade_md() -> Option<String> {
    let blade_dir = crate::config::blade_config_dir();
    let path = blade_dir.join("BLADE.md");
    fs::read_to_string(path).ok()
}

/// Walk from `start_dir` up to filesystem root looking for CLAUDE.md or BLADE.md.
/// Returns (path, content) of the first one found.
fn find_project_instructions(start_dir: &std::path::Path) -> Option<(String, String)> {
    let candidate_names = ["CLAUDE.md", "BLADE.md", ".claude/CLAUDE.md"];
    let mut dir = start_dir.to_path_buf();
    let home = dirs::home_dir().unwrap_or_default();

    // Don't walk above home dir — avoid reading system files
    for _ in 0..10 {
        for name in &candidate_names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                if let Ok(content) = fs::read_to_string(&candidate) {
                    if !content.trim().is_empty() {
                        return Some((candidate.to_string_lossy().to_string(), content));
                    }
                }
            }
        }
        if dir == home || !dir.pop() {
            break;
        }
    }
    None
}

/// Try to extract a directory path from a window title.
/// VS Code: "filename.rs — /path/to/project [group]" → "/path/to/project"
/// Terminal: "/path/to/project" in title
fn extract_dir_from_window_title(title: &str) -> Option<std::path::PathBuf> {
    // Look for absolute paths in the title
    let separators = [" — ", " - ", ": ", " ("];
    for sep in &separators {
        if let Some(idx) = title.find(sep) {
            let rest = &title[idx + sep.len()..];
            // Extract the path-like part (up to first space or bracket)
            let end = rest.find(|c: char| c == ' ' || c == '[' || c == '(').unwrap_or(rest.len());
            let candidate = rest[..end].trim();
            let p = std::path::Path::new(candidate);
            if p.is_dir() {
                return Some(p.to_path_buf());
            }
            // Maybe it's a file — return parent dir
            if p.is_file() {
                return p.parent().map(|d| d.to_path_buf());
            }
        }
    }
    // Fallback: try the whole title as a path
    let p = std::path::Path::new(title.trim());
    if p.is_dir() { return Some(p.to_path_buf()); }
    None
}

/// Load project-level CLAUDE.md from the user's active working directory.
/// Returns None if not in a project, if the file doesn't differ from BLADE.md,
/// or if the file is too large to be useful.
fn load_project_instructions() -> Option<(String, String)> {
    // Get active window to find project dir
    let win = crate::context::get_active_window().ok()?;
    let title = &win.window_title;

    let dir = extract_dir_from_window_title(title)?;
    let (path, content) = find_project_instructions(&dir)?;

    // Don't inject if it's enormous (malformed CLAUDE.md protection)
    if content.len() > 20_000 {
        return Some((path, content[..20_000].to_string()));
    }
    Some((path, content))
}

/// Run a git command in a directory and return stdout (trimmed).
fn git_run(dir: &std::path::Path, args: &[&str]) -> Option<String> {
    let out = crate::cmd_util::silent_cmd("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    } else {
        None
    }
}

/// Detect the git repo of the user's active project and inject branch + recent commits.
/// Returns None if no git repo can be found, silently skipped on failure.
fn git_context_for_active_project() -> Option<String> {
    let win = crate::context::get_active_window().ok()?;
    let dir = extract_dir_from_window_title(&win.window_title)?;

    // Find git root by running `git rev-parse --show-toplevel`
    let root_str = git_run(&dir, &["rev-parse", "--show-toplevel"])?;
    let root = std::path::PathBuf::from(&root_str);

    let branch = git_run(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|| "unknown".to_string());

    // Last 5 commit subjects
    let log = git_run(&root, &["log", "--oneline", "-5"])
        .unwrap_or_default();

    // Files changed vs HEAD (uncommitted)
    let dirty = git_run(&root, &["status", "--short"])
        .map(|s| {
            let lines: Vec<&str> = s.lines().take(8).collect();
            lines.join("\n")
        })
        .unwrap_or_default();

    let repo_name = root.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());

    let mut sections = vec![
        format!("**Repo**: `{}` ({})", repo_name, root_str),
        format!("**Branch**: `{}`", branch),
    ];
    if !log.is_empty() {
        sections.push(format!("**Recent commits**:\n{}", log));
    }
    if !dirty.is_empty() {
        sections.push(format!("**Uncommitted changes**:\n{}", dirty));
    }

    Some(format!("## Active Git Repo\n\n{}", sections.join("\n")))
}

#[allow(dead_code)]
const BLADE_IDENTITY: &str = r#"# You are Blade

You are Blade, a personal AI assistant running as a native desktop app. You are not ChatGPT, not Claude, not a web app. You are Blade.

## Personality

- Direct and concise. No filler, no corporate speak.
- You remember context from this conversation and use it.
- When you have tools available, use them proactively instead of just suggesting actions.
- If the user asks you to do something and you have the tools for it, do it. Don't ask for permission unless the action is destructive.
- You adapt to the user's style. If they're technical, be technical. If they're casual, be casual.

## Capabilities

- You run natively on the user's desktop (Tauri app, Windows/macOS/Linux)
- You can connect to MCP servers to gain new abilities (file access, databases, APIs, etc.)
- You stream responses in real-time
- You're always available via Alt+Space

## Rules

- Never say "As an AI language model..." or similar disclaimers
- Never refuse a reasonable request with safety theater
- If you don't know something, say so briefly
- Prefer doing over explaining. If you can execute an action, do it.
- Keep responses short unless the user asks for detail
- **For creative tasks (write a post, draft an email, write copy, summarize, etc.): just write it. Pick a strong angle yourself and deliver the output. Don't ask about tone, audience, or format first — produce the best version, then offer to adjust if they want something different.**"#;

/// Load user persona from config dir
fn load_persona() -> Option<String> {
    let path = persona_path();
    fs::read_to_string(path).ok()
}

/// Load context notes (recent activity, pinned info)
fn load_context_notes() -> Option<String> {
    let path = context_path();
    fs::read_to_string(path).ok()
}

fn persona_path() -> PathBuf {
    blade_config_dir().join("persona.md")
}

fn context_path() -> PathBuf {
    blade_config_dir().join("context.md")
}

// ── Entity extraction ──────────────────────────────────────────────────────────

/// Fire-and-forget entity extraction after a conversation turn.
/// Calls the LLM with a lean prompt, parses JSON, writes to brain SQLite.
/// Returns count of new entities written.
pub async fn extract_entities_from_exchange(
    user_text: &str,
    assistant_text: &str,
) -> usize {
    let config = crate::config::load_config();
    if (config.api_key.is_empty() && config.provider != "ollama") || assistant_text.len() < 50 {
        return 0;
    }

    let exchange = format!(
        "User: {}\n\nAssistant: {}",
        crate::safe_slice(&user_text, 800),
        crate::safe_slice(&assistant_text, 1200),
    );

    let prompt = format!(
        r#"Extract named entities and relationships from this conversation exchange. Output valid JSON only — no explanation, no markdown fences.

Format:
{{
  "nodes": [{{"label": "...", "kind": "person|project|tool|concept|company|url", "summary": "one sentence"}}],
  "edges": [{{"from": "label1", "to": "label2", "label": "relationship verb"}}]
}}

Rules:
- Only include entities clearly mentioned (not generic terms)
- "kind" must be one of: person, project, tool, concept, company, url
- Maximum 8 nodes, 6 edges
- If nothing meaningful, return {{"nodes":[],"edges":[]}}

Exchange:
{}

JSON:"#,
        exchange
    );

    let messages = vec![crate::providers::ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = crate::providers::build_conversation(messages, None);

    // Use cheapest model — entity extraction is a background task, not user-facing
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &conversation,
        &[],
        config.base_url.as_deref(),
    )
    .await;

    let raw = match result {
        Ok(r) => r.content,
        Err(_) => return 0,
    };

    // Parse JSON — strip any accidental markdown fences
    let json_str = raw.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return 0,
    };

    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let mut count = 0usize;

    // Write nodes
    if let Some(nodes) = parsed["nodes"].as_array() {
        for node in nodes {
            let label = node["label"].as_str().unwrap_or("").trim().to_string();
            let kind = node["kind"].as_str().unwrap_or("concept").trim().to_string();
            let summary = node["summary"].as_str().unwrap_or("").trim().to_string();
            if label.is_empty() || label.len() > 80 { continue; }
            let valid_kind = matches!(kind.as_str(), "person"|"project"|"tool"|"concept"|"company"|"url");
            let kind = if valid_kind { kind } else { "concept".to_string() };
            // Deterministic node ID: kind:normalized-label (same as TS side)
            let node_id = format!("{}:{}", kind, label.to_lowercase().replace(' ', "-"));
            let _ = crate::db::brain_upsert_node(&conn, &node_id, &label, &kind, &summary);
            count += 1;
        }
    }

    // Write edges
    if let Some(edges) = parsed["edges"].as_array() {
        for edge in edges {
            let from_label = edge["from"].as_str().unwrap_or("").trim().to_string();
            let to_label = edge["to"].as_str().unwrap_or("").trim().to_string();
            let rel = edge["label"].as_str().unwrap_or("related to").trim().to_string();
            if from_label.is_empty() || to_label.is_empty() { continue; }
            // Derive node IDs the same way upsertNode does: kind:label (use concept as fallback)
            // We can't know the kind here, so look up by label
            let from_id = node_id_by_label(&conn, &from_label);
            let to_id = node_id_by_label(&conn, &to_label);
            if let (Some(fid), Some(tid)) = (from_id, to_id) {
                let edge_id = format!("{}|{}|{}", fid, tid, rel.replace(' ', "-"));
                let _ = crate::db::brain_upsert_edge(&conn, &edge_id, &fid, &tid, &rel);
            }
        }
    }

    count
}

fn node_id_by_label(conn: &rusqlite::Connection, label: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM brain_nodes WHERE LOWER(label) = LOWER(?1) LIMIT 1",
        rusqlite::params![label],
        |row| row.get::<_, String>(0),
    ).ok()
}

// --- Tauri Commands ---

/// Called by frontend after streaming completes with the assembled response text.
/// Runs entity extraction, embeds the full exchange for semantic recall,
/// and scans user message for implicit reminder intent.
#[tauri::command]
pub async fn brain_extract_from_exchange(
    app: tauri::AppHandle,
    store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    user_text: String,
    assistant_text: String,
) -> Result<usize, String> {
    let n = extract_entities_from_exchange(&user_text, &assistant_text).await;
    if n > 0 {
        use tauri::Emitter;
        let _ = app.emit("brain_grew", serde_json::json!({ "new_entities": n }));
    }

    // Embed the full exchange (user + assistant) for semantic memory recall.
    if !assistant_text.is_empty() {
        let store_ref = store.inner().clone();
        let user_clone = user_text.clone();
        let asst_clone = assistant_text.clone();
        let conv_id = format!("stream-{}", chrono::Utc::now().timestamp());
        tokio::spawn(async move {
            crate::embeddings::auto_embed_exchange(&store_ref, &user_clone, &asst_clone, &conv_id);
        });
    }

    // Scan user message for implicit reminder intent (fire-and-forget)
    {
        let app_clone = app.clone();
        let user_clone = user_text.clone();
        tokio::spawn(async move {
            crate::reminders::extract_reminder_from_message(&app_clone, &user_clone).await;
        });
    }

    // Extract user facts (role, projects, tech, preferences) — fire-and-forget
    {
        let user_clone = user_text.clone();
        let asst_clone = assistant_text.clone();
        tokio::spawn(async move {
            extract_user_facts_from_exchange(&user_clone, &asst_clone).await;
        });
    }

    // Extract compounding facts into virtual context blocks + typed memory.
    // Runs for the streaming path (frontend calls brain_extract_from_exchange once
    // the full assistant text is assembled). Only worth doing with real content.
    if !assistant_text.is_empty() && (user_text.len() > 50 || assistant_text.len() > 50) {
        let user_clone = user_text.clone();
        let asst_clone = assistant_text.clone();
        tokio::spawn(async move {
            let fact_msgs = vec![
                crate::providers::ChatMessage {
                    role: "user".to_string(),
                    content: user_clone,
                    image_base64: None,
                },
                crate::providers::ChatMessage {
                    role: "assistant".to_string(),
                    content: asst_clone,
                    image_base64: None,
                },
            ];
            crate::memory::extract_conversation_facts(&fact_msgs).await;
        });
    }

    Ok(n)
}

// ── User fact extraction ───────────────────────────────────────────────────────

/// After each exchange, call the LLM with a lean extraction prompt to learn about
/// the user: their role, projects, tech stack, preferences, goals, frustrations.
/// Writes directly into persona_engine traits and the brain knowledge graph.
/// Totally async — never blocks the chat response.
pub async fn extract_user_facts_from_exchange(user_msg: &str, assistant_msg: &str) {
    let config = crate::config::load_config();
    // Skip if no provider configured or the user message is trivially short
    if (config.api_key.is_empty() && config.provider != "ollama") || user_msg.len() < 20 {
        return;
    }

    let exchange = format!(
        "User: {}\n\nAssistant: {}",
        crate::safe_slice(user_msg, 600),
        crate::safe_slice(assistant_msg, 800),
    );

    let prompt = format!(
        r#"From this conversation exchange, extract structured facts about the USER (not the assistant).

Focus on:
- role/job: their profession or what they do
- project: something they are building or working on
- technology: tools, languages, frameworks they use
- preference: how they like things done (brief/detailed, style)
- goal: something they want to achieve
- frustration: something that's blocking or annoying them

Return a JSON array. Each item: {{"fact_type": "role|project|technology|preference|goal|frustration", "value": "concise fact", "confidence": 0.0-1.0}}

Rules:
- Only extract facts EXPLICITLY stated by the user (not implied)
- Maximum 6 facts
- If no clear user facts, return []
- No markdown fences — raw JSON array only

Exchange:
{}

JSON:"#,
        exchange
    );

    let messages = vec![crate::providers::ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = crate::providers::build_conversation(messages, None);

    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &conversation,
        &[],
        config.base_url.as_deref(),
    )
    .await;

    let raw = match result {
        Ok(r) => r.content,
        Err(_) => return,
    };

    // Strip any accidental markdown fences
    let json_str = raw.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let facts: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return,
    };

    let facts_arr = match facts.as_array() {
        Some(a) => a,
        None => return,
    };

    if facts_arr.is_empty() {
        return;
    }

    // Ensure persona tables exist
    crate::persona_engine::ensure_tables();

    // Open brain DB for knowledge graph writes
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok();

    for fact in facts_arr {
        let fact_type = fact["fact_type"].as_str().unwrap_or("").trim().to_string();
        let value = fact["value"].as_str().unwrap_or("").trim().to_string();
        let confidence = fact["confidence"].as_f64().unwrap_or(0.5) as f32;

        if value.is_empty() || value.len() > 200 {
            continue;
        }

        match fact_type.as_str() {
            "role" | "preference" | "goal" | "frustration" => {
                // Map to persona traits (role→work_identity, preference→preferred_depth etc.)
                let trait_name = match fact_type.as_str() {
                    "role" => "work_identity",
                    "preference" => "communication_preference",
                    "goal" => "current_goal",
                    "frustration" => "known_frustration",
                    _ => continue,
                };
                crate::persona_engine::update_trait(trait_name, confidence, &value);
            }
            "project" | "technology" => {
                // Write into knowledge graph
                if let Some(ref c) = conn {
                    let kind = if fact_type == "project" { "project" } else { "tool" };
                    let node_id = format!("{}:{}", kind, value.to_lowercase().replace(' ', "-"));
                    let _ = crate::db::brain_upsert_node(c, &node_id, &value, kind, &format!("User {} mentioned in conversation", kind));
                }
            }
            _ => {}
        }
    }
}

#[tauri::command]
pub fn get_persona() -> String {
    load_persona().unwrap_or_default()
}

#[tauri::command]
pub fn set_persona(content: String) -> Result<(), String> {
    let path = persona_path();
    write_blade_file(&path, &content)
}

#[tauri::command]
pub fn get_context() -> String {
    load_context_notes().unwrap_or_default()
}

#[tauri::command]
pub fn set_context(content: String) -> Result<(), String> {
    let path = context_path();
    write_blade_file(&path, &content)
}
