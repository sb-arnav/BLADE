#![allow(dead_code)]

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
#[allow(dead_code)]
fn enforce_budget(parts: &mut Vec<String>, keep: usize) {
    loop {
        let total: usize = parts.iter().map(|p| p.len()).sum();
        if total <= SYSTEM_PROMPT_CHAR_BUDGET || parts.len() <= keep {
            break;
        }
        parts.pop();
    }
}

// ── Phase 32 / CTX-06: Context Breakdown wire type ────────────────────────────
// Returned by the `get_context_breakdown` Tauri command (added in Plan 32-06).
// Records per-section token contribution from the most recent
// `build_system_prompt_inner` invocation so the DoctorPane can render a
// per-turn budget panel.
//
// `sections` is keyed by stable section labels: "blade_md", "identity_supplement",
// "memory_l0", "character_bible", "role", "safety", "hormones",
// "identity_extension", "vision", "hearing", "memory_recall", "schedule",
// "code", "security", "health", "system", "financial", "context_now",
// "integrations", "git", "world_model", "misc", "scaffold", "tools".
//
// Token counts are estimated as `chars / 4` (matches commands.rs estimate_tokens).
// This is the wire-format contract — Plan 32-03 populates `sections` during
// build_system_prompt_inner; Plan 32-06 exposes it via the Tauri command.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ContextBreakdown {
    /// 16-char hex prefix of SHA-256(query) — for log correlation only.
    pub query_hash: String,
    /// Model context window from capability_probe (e.g. 200_000 for Claude Sonnet 4).
    pub model_context_window: u32,
    /// Sum of all section token counts (excluding tools/messages).
    pub total_tokens: usize,
    /// Per-section token tally. Stable label set documented above.
    pub sections: std::collections::HashMap<String, usize>,
    /// total_tokens / model_context_window * 100.0. Clamped to 100.0.
    pub percent_used: f32,
    /// Unix epoch milliseconds when the breakdown was captured.
    pub timestamp_ms: i64,
}

// ── Phase 32 / CTX-07 regression seam ─────────────────────────────────────────
// Test-only override of `score_context_relevance`. Production builds compile this
// out entirely (`#[cfg(test)]`). Mirrors the `TEST_KEYRING_OVERRIDES` pattern at
// config.rs:89-105.
//
// Usage from a test:
//     CTX_SCORE_OVERRIDE.with(|cell| {
//         *cell.borrow_mut() = Some(Box::new(|_q, _t| panic!("forced panic")));
//     });
//     // ... exercise build_system_prompt_inner; the gating must catch_unwind ...
//     CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
//
// Plan 32-07 uses this seam to enforce the v1.1 "smart path must never crash chat"
// regression invariant (CTX-07).
//
// Caveat: tests run in parallel by default. Resetting the override to `None` at
// the END of each test is critical — thread_local is per-thread and Rust's test
// runner spawns one thread per test, so cross-test bleed is unusual but possible.
// If flakes appear, switch to `serial_test` crate.
#[cfg(test)]
thread_local! {
    pub static CTX_SCORE_OVERRIDE: std::cell::RefCell<
        Option<Box<dyn Fn(&str, &str) -> f32>>
    > = std::cell::RefCell::new(None);
}

// ── Phase 32 / CTX-06: Per-section token recorder ─────────────────────────────
// Populated by `build_system_prompt_inner` as it pushes each section. Read by
// `get_context_breakdown` (Plan 32-06) to render the DoctorPane budget panel.
//
// thread_local justification: build_system_prompt_inner runs synchronously
// inside send_message_stream_inline and the breakdown is read from the SAME
// task immediately after. If a future async hop crosses worker threads,
// switch to once_cell::Lazy<Mutex<>> per RESEARCH.md landmine #4.
//
// Stable label set (Plan 32-06 reads these — do not rename without coordinating):
//   blade_md, identity_supplement, memory_l0, character_bible, role, safety,
//   hormones, identity_extension, vision, hearing, memory_recall, schedule,
//   code, security, health, system, financial, context_now, integrations,
//   git, world_model, misc, scaffold, tools.
thread_local! {
    pub(crate) static LAST_BREAKDOWN: std::cell::RefCell<Vec<(String, usize)>>
        = std::cell::RefCell::new(Vec::new());
}

/// Reset the per-call accumulator. Called at the top of
/// `build_system_prompt_inner` so each invocation starts clean.
pub(crate) fn clear_section_accumulator() {
    LAST_BREAKDOWN.with(|b| b.borrow_mut().clear());
}

/// Record a section's contribution. `chars` is the byte length of the pushed
/// string (callers convert to tokens via `chars / 4` at read time). A `chars`
/// of 0 still appends — Plan 32-06 surfaces gated-out sections as empty rows.
pub(crate) fn record_section(label: &str, chars: usize) {
    LAST_BREAKDOWN.with(|b| b.borrow_mut().push((label.to_string(), chars)));
}

/// Snapshot the most-recent breakdown. Plan 32-06's Tauri command consumes
/// this and converts to tokens for the DoctorPane panel.
#[allow(dead_code)]
pub(crate) fn read_section_breakdown() -> Vec<(String, usize)> {
    LAST_BREAKDOWN.with(|b| b.borrow().clone())
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
    // CTX-07 regression seam — consults thread_local override if set (test only).
    // Production builds compile this entire block out via `#[cfg(test)]`.
    #[cfg(test)]
    {
        let overridden = CTX_SCORE_OVERRIDE.with(|cell| {
            cell.borrow().as_ref().map(|f| f(query, context_type))
        });
        if let Some(v) = overridden {
            return v;
        }
    }

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
        // ── Phase 32 / CTX-02: identity / vision / hearing gates ─────────────
        // Added by Plan 32-03 to extend score_context_relevance to brain.rs
        // sections 0–8 (character bible, OCR, hormones, meeting transcripts).
        // Keyword sets are verbatim from 32-RESEARCH.md §CTX-02.
        "identity" => (
            &["who are you", "your name", "your purpose", "remember me",
              "what do you know about me", "tell me about yourself", "your story",
              "what are you", "who am i to you", "your character"],
            &["you", "your", "yourself", "i", "me", "my"],
            &[],
        ),
        "vision" => (
            &["screen", "see", "looking at", "visible", "showing", "display",
              "on my screen", "what's on", "this page", "this app", "this window",
              "ocr", "read this", "what i'm looking at", "active app", "screenshot"],
            &["this", "that", "here", "above", "below"],
            &[],
        ),
        "hearing" => (
            &["meeting", "conversation", "they said", "what was discussed",
              "transcript", "audio", "call", "spoken", "heard", "listened",
              "voice", "podcast"],
            &["talked", "told", "saying", "speak"],
            &[],
        ),
        _ => (&[] as &[&str], &[] as &[&str], &[] as &[&str]),
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

/// Thalamus attention gate — dynamic threshold that gets stricter as the
/// prompt grows. When there's plenty of budget left, let more context through
/// (threshold 0.2). When the prompt is getting large, only let high-relevance
/// context through (threshold 0.6). This prevents prompt bloat without
/// losing important context.
fn thalamus_threshold(current_prompt_chars: usize) -> f32 {
    const SMALL: usize = 8_000;    // plenty of room
    const MEDIUM: usize = 40_000;  // getting full
    const LARGE: usize = 100_000;  // very full

    if current_prompt_chars < SMALL {
        0.2  // generous — let everything relevant through
    } else if current_prompt_chars < MEDIUM {
        0.3  // standard gate
    } else if current_prompt_chars < LARGE {
        0.5  // stricter — only clearly relevant
    } else {
        0.7  // very strict — only high-signal matches
    }
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
    // ── Token budget ──────────────────────────────────────────────────────────
    // 1500 tokens ≈ 6000 chars. Anything above this on a cold "hi" is waste.
    // Static sections (always-on) must stay under ~4000 chars combined.
    // Dynamic sections are added only if non-empty AND relevant.
    const TOKEN_BUDGET: usize = 1500;
    const CHAR_BUDGET: usize = TOKEN_BUDGET * 4; // 6000 chars

    // Priority order for budget enforcement (lower index = higher priority):
    //   0 static_core   — BLADE.md identity + runtime supplement (always keep)
    //   1 memory_core   — L0 facts + character bible (always keep if non-empty)
    //   2 role          — active specialist role (always keep if active)
    //   3 identity_ext  — deep scan + user model (compact, keep if populated)
    //   4 project       — active project CLAUDE.md (keep if in a project)
    //   5 thread        — working memory after msg 1
    //   6 pentest       — only when pentest mode active
    //   7 perception    — live app/state (God Mode only; 1 line)
    //   8 memory_recall — typed memory + knowledge graph + episodic (query-gated)
    //   9 context_now   — clipboard, God Mode, active window (when populated)
    //  10 integrations  — Gmail/Calendar/Slack (schedule/people queries + imminent meeting)
    //  11 code_index    — indexed codebases (code queries only)
    //  12 git           — active git repo (code queries only)
    //  13 security      — alerts + expertise (only when alert exists or security query)
    //  14 health        — screen time nudge (streak >= 90 min only)
    //  15 world_model   — machine state (system queries only)
    //  16 misc          — predictions, habits, meetings, social, research, hot files
    //  17 scaffold      — reasoning scaffold for non-Frontier models

    let mut parts: Vec<String> = Vec::new();
    let config = crate::config::load_config();

    // ── Phase 32 / CTX-01..CTX-07 — selective injection setup ────────────────
    // Reset the per-section accumulator (CTX-06) and read the smart-injection
    // toggle + gate from config. When `smart_injection_enabled = false`, every
    // gate opens unconditionally — this is the v1.1 escape hatch (CTX-07).
    clear_section_accumulator();
    let smart = config.context.smart_injection_enabled;
    let gate = config.context.relevance_gate;

    // ── STATIC CORE (priority 0) ──────────────────────────────────────────────
    // BLADE.md is the authoritative identity. Always inject first.
    // build_identity_supplement() adds only the runtime data that BLADE.md can't know:
    // current date/time, user name, model/provider, OS shell note.
    // Always-keep core (CONTEXT.md locked decision) — record but never gate.
    if let Some(blade_md) = load_blade_md() {
        if !blade_md.trim().is_empty() {
            parts.push(blade_md);
            record_section("blade_md", parts.last().map(|s| s.len()).unwrap_or(0));
        }
    }
    parts.push(build_identity_supplement(&config, provider, model));
    record_section("identity_supplement", parts.last().map(|s| s.len()).unwrap_or(0));

    // ── MEMORY CORE (priority 1) ──────────────────────────────────────────────
    // L0 critical facts — always-on, capped at source (always-keep core)
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let l0 = crate::db::brain_l0_critical_facts(&conn);
        if !l0.trim().is_empty() {
            parts.push(l0);
            record_section("memory_l0", parts.last().map(|s| s.len()).unwrap_or(0));
        }
    }

    // Character bible (SQLite) — heavy persistent-memory representation.
    // CTX-01: gate by identity OR memory relevance. Always inject when
    // smart_injection_enabled = false (CTX-07 escape hatch).
    let allow_character_bible = !smart || user_query.is_empty()
        || score_context_relevance(user_query, "identity") > gate
        || score_context_relevance(user_query, "memory") > gate;
    if allow_character_bible {
        let mut pushed_bible = false;
        let db_path = crate::config::blade_config_dir().join("blade.db");
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let ctx = crate::db::brain_build_context(&conn, 400);
            if !ctx.trim().is_empty() {
                parts.push(ctx);
                record_section("character_bible", parts.last().map(|s| s.len()).unwrap_or(0));
                pushed_bible = true;
            }
        }
        if !pushed_bible {
            if let Some(bible) = crate::character::bible_summary() {
                if !bible.trim().is_empty() {
                    parts.push(format!("## About the User\n\n{}", bible));
                    record_section("character_bible", parts.last().map(|s| s.len()).unwrap_or(0));
                }
            }
        }
    } else {
        // Gated out — record 0 so DoctorPane shows the empty bar.
        record_section("character_bible", 0);
    }

    // ── ROLE (priority 2) ────────────────────────────────────────────────────
    // Always-keep core — small and identity-coherent (CONTEXT.md locked).
    let role_injection = crate::roles::role_system_injection(&config.active_role);
    if !role_injection.trim().is_empty() {
        parts.push(role_injection);
        record_section("role", parts.last().map(|s| s.len()).unwrap_or(0));
    }

    // ── SAFETY MODULATION (priority 2.5 — Phase 26 / SAFE-03, SAFE-05) ───────
    // CTX-01: gate by security relevance. Smart=off opens all gates (CTX-07).
    let allow_safety = !smart || user_query.is_empty()
        || score_context_relevance(user_query, "security") > gate;
    if allow_safety {
        let safety_mods = crate::safety_bundle::get_prompt_modulations();
        let mut total_safety_chars: usize = 0;
        for mod_text in safety_mods {
            if !mod_text.trim().is_empty() {
                let len = mod_text.len();
                parts.push(mod_text);
                total_safety_chars = total_safety_chars.saturating_add(len);
            }
        }
        record_section("safety", total_safety_chars);
    } else {
        record_section("safety", 0);
    }

    // ── CORTISOL + OXYTOCIN MODULATION (priority 2.6 -- Phase 27 / HORM-03, HORM-07) ────
    // CTX-01: existing physio condition AND query relevance (identity OR memory).
    // Smart=off keeps only the existing physio condition (CTX-07 escape hatch:
    // naive path = pre-Phase-32 behavior, which already required physio thresholds).
    let allow_hormones = !smart || user_query.is_empty()
        || score_context_relevance(user_query, "identity") > gate
        || score_context_relevance(user_query, "memory") > gate;
    if allow_hormones {
        let physio = crate::homeostasis::get_physiology();
        let mut total_hormone_chars: usize = 0;
        if physio.cortisol > 0.6 {
            let s = "## Internal State\n\nHigh cortisol: be terse, action-focused, skip preamble. Respond in 2 sentences or fewer unless technical depth is required.".to_string();
            total_hormone_chars = total_hormone_chars.saturating_add(s.len());
            parts.push(s);
        } else if physio.cortisol < 0.2 {
            let s = "## Internal State\n\nLow cortisol: exploratory tone permitted. You may think aloud and offer tangential observations.".to_string();
            total_hormone_chars = total_hormone_chars.saturating_add(s.len());
            parts.push(s);
        }
        if physio.oxytocin > 0.6 {
            let s = "## Social Context\n\nHigh rapport detected: warm, personal tone is appropriate. Use the user's name if known. Show genuine interest in their goals.".to_string();
            total_hormone_chars = total_hormone_chars.saturating_add(s.len());
            parts.push(s);
        }
        record_section("hormones", total_hormone_chars);
    } else {
        record_section("hormones", 0);
    }

    // ── IDENTITY EXTENSION (priority 3) ──────────────────────────────────────
    // Deep scan + user model + personality mirror + virtual contexts +
    // prefrontal + learned preferences. Together this can be 5–10k chars.
    // CTX-01: gate by identity OR memory relevance. Smart=off opens.
    let allow_identity_extension = !smart || user_query.is_empty()
        || score_context_relevance(user_query, "identity") > gate
        || score_context_relevance(user_query, "memory") > gate;
    if allow_identity_extension {
        let mut total_id_ext_chars: usize = 0;

        // Deep scan + user model
        {
            let scan = crate::deep_scan::load_scan_summary();
            let user_model = crate::persona_engine::get_user_model_summary();
            if scan.is_some() || user_model.is_some() {
                let mut id_parts = Vec::new();
                if let Some(s) = scan { id_parts.push(s); }
                if let Some(u) = user_model { id_parts.push(u); }
                let s = format!("## Who You're Talking To\n\n{}", id_parts.join("\n"));
                total_id_ext_chars = total_id_ext_chars.saturating_add(s.len());
                parts.push(s);
            }
        }

        // Personality mirror — 1 line style match (compress at source; skip if empty)
        if let Some(pm) = crate::personality_mirror::get_personality_injection() {
            if !pm.trim().is_empty() {
                // Take first non-empty line only — personality mirror can be verbose
                let one_line = pm.lines().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
                if !one_line.is_empty() {
                    let s = format!("Style note: {}", one_line.trim());
                    total_id_ext_chars = total_id_ext_chars.saturating_add(s.len());
                    parts.push(s);
                }
            }
        }

        // Virtual context blocks (Letta-style memory) — already capped at source
        {
            let vctx = crate::memory::get_injected_context();
            if !vctx.trim().is_empty() {
                total_id_ext_chars = total_id_ext_chars.saturating_add(vctx.len());
                parts.push(vctx);
            }
        }

        // Prefrontal working memory — active task state (what Brain is currently doing)
        // This gives continuity between messages: "we're on step 3 of 5, deploying..."
        {
            let wm_injection = crate::prefrontal::get_injection();
            if !wm_injection.is_empty() {
                total_id_ext_chars = total_id_ext_chars.saturating_add(wm_injection.len());
                parts.push(wm_injection);
            }
        }

        // Top learned preferences — apply to every response
        {
            let learned = crate::character::get_top_learned_preferences(3);
            if !learned.is_empty() {
                let s = format!(
                    "## Learned Rules\n\n{}",
                    learned.iter().map(|r| format!("- {}", r)).collect::<Vec<_>>().join("\n")
                );
                total_id_ext_chars = total_id_ext_chars.saturating_add(s.len());
                parts.push(s);
            }
        }

        record_section("identity_extension", total_id_ext_chars);
    } else {
        record_section("identity_extension", 0);
    }

    // ── PROJECT (priority 4) ─────────────────────────────────────────────────
    if let Some((proj_path, proj_instructions)) = load_project_instructions() {
        let proj_dir = std::path::Path::new(&proj_path)
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());
        parts.push(format!(
            "## Project: {}\n\n{}",
            proj_dir, proj_instructions
        ));
    }

    // ── WORKING MEMORY / THREAD (priority 5) ─────────────────────────────────
    if message_count > 1 {
        if let Some(thread) = crate::thread::get_active_thread() {
            parts.push(format!("## Working Memory\n\n{}", thread));
        }
    }

    // ── PENTEST MODE (priority 6) ─────────────────────────────────────────────
    {
        let active_auths = crate::pentest::pentest_list_auth();
        if !active_auths.is_empty() {
            let auth_lines: Vec<String> = active_auths.iter().map(|a| {
                format!("- {} ({}) — {}", a.target, a.target_type, a.scope_notes)
            }).collect();
            let (prov, _, mdl) = crate::pentest::get_pentest_safe_provider();
            let model_note = if prov == "none" {
                "⚠ No safe pentest provider — configure Ollama or Groq".to_string()
            } else {
                format!("Use {}/{} for analysis (NOT your Anthropic key)", prov, mdl)
            };
            parts.push(format!(
                "## Pentest Mode ACTIVE\n\nAuthorized:\n{}\n{}\n\nFull Kali tool access via blade_bash.",
                auth_lines.join("\n"), model_note
            ));
        }
    }

    // ── ALWAYS-ON VISION (priority 7) ───────────────────────────────────────
    // BLADE always sees the screen. This is not optional. No "God Mode off."
    // The ambient awareness IS the product.
    //
    // CTX-01: gate the heavy vision body (OCR + active-app injection) by
    // vision relevance OR a hard override when visible errors are present.
    // Visible-errors carve-out preserves debug help even when the user's
    // query doesn't mention "screen". Smart=off opens unconditionally.
    let hive_is_active = !crate::hive::get_hive_digest().is_empty();
    let perception = crate::perception_fusion::get_latest();
    let has_visible_error = perception
        .as_ref()
        .map(|p| !p.visible_errors.is_empty())
        .unwrap_or(false);
    let allow_vision = !smart || user_query.is_empty()
        || has_visible_error
        || score_context_relevance(user_query, "vision") > gate;
    if allow_vision {
        if let Some(p) = perception.as_ref() {
            let mut vision_lines: Vec<String> = Vec::new();

            // What app the user is in
            if !p.active_app.is_empty() {
                let title_part = if !p.active_title.is_empty() && p.active_title != p.active_app {
                    format!(" — {}", crate::safe_slice(&p.active_title, 50))
                } else {
                    String::new()
                };
                vision_lines.push(format!("Seeing: {}{} ({})", p.active_app, title_part, p.user_state));
            }

            // What's actually visible on screen (vision model description)
            if !p.screen_ocr_text.is_empty() {
                vision_lines.push(crate::safe_slice(&p.screen_ocr_text, 300).to_string());
            }

            // Visible errors (extracted from screen + clipboard)
            if !p.visible_errors.is_empty() {
                vision_lines.push(format!("Visible error: {}", crate::safe_slice(&p.visible_errors[0], 150)));
            }

            if !vision_lines.is_empty() {
                let s = vision_lines.join("\n");
                let len = s.len();
                parts.push(s);
                record_section("vision", len);
            } else {
                record_section("vision", 0);
            }
        } else {
            record_section("vision", 0);
        }
    } else {
        record_section("vision", 0);
    }

    // ── ALWAYS-ON HEARING (priority 7.1) ─────────────────────────────────
    // BLADE always hears. If there's a meeting in progress, include the
    // latest transcript so the model knows what's being discussed.
    //
    // CTX-01: gate by hearing relevance AND existing meeting precondition.
    // Smart=off keeps only the meeting precondition (CTX-07 escape hatch).
    let meeting_active = crate::audio_timeline::detect_meeting_in_progress();
    let allow_hearing = !smart || user_query.is_empty()
        || score_context_relevance(user_query, "hearing") > gate;
    if meeting_active && allow_hearing {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        let mut hearing_chars: usize = 0;
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let cutoff = chrono::Utc::now().timestamp() - 300; // last 5 min
            if let Ok(mut stmt) = conn.prepare(
                "SELECT transcript FROM audio_timeline
                 WHERE timestamp > ?1 AND meeting_id != ''
                 ORDER BY timestamp DESC LIMIT 2"
            ) {
                let transcripts: Vec<String> = stmt
                    .query_map(rusqlite::params![cutoff], |row| row.get::<_, String>(0))
                    .ok()
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default();

                if !transcripts.is_empty() {
                    let combined: String = transcripts.iter().rev()
                        .map(|t| crate::safe_slice(t, 200).to_string())
                        .collect::<Vec<_>>()
                        .join(" ... ");
                    let s = format!("Hearing (meeting in progress): {}", combined);
                    hearing_chars = s.len();
                    parts.push(s);
                }
            }
        }
        record_section("hearing", hearing_chars);
    } else {
        record_section("hearing", 0);
    }

    // ── MEMORY RECALL (priority 8, query-gated) ───────────────────────────────
    // When hive + DNA are active, DNA::query_for_brain already pulls typed_memory,
    // knowledge_graph, people_graph with selective relevance. Skip the individual
    // pulls to avoid prompt duplication. Fall back to full recall when hive is off.
    //
    // CTX-06: track total chars contributed by this block for the breakdown.
    // The block already short-circuits when user_query is empty or hive is on,
    // so a record_section("memory_recall", 0) lands in those branches too.
    {
        let mut memory_recall_chars: usize = 0;
        if !user_query.is_empty() && !hive_is_active {
            // Typed memory
            let context_tags: Vec<String> = user_query
                .split_whitespace()
                .filter(|w| w.len() >= 4)
                .map(|w| w.to_lowercase().trim_matches(|c: char| !c.is_alphanumeric()).to_string())
                .filter(|w| !w.is_empty())
                .collect();
            if !context_tags.is_empty() {
                let typed_ctx = crate::typed_memory::get_typed_memory_context(&context_tags);
                if !typed_ctx.is_empty() {
                    memory_recall_chars = memory_recall_chars.saturating_add(typed_ctx.len());
                    parts.push(typed_ctx);
                }
            }

            // Knowledge graph
            let graph_ctx = crate::knowledge_graph::get_graph_context(user_query);
            if !graph_ctx.is_empty() {
                memory_recall_chars = memory_recall_chars.saturating_add(graph_ctx.len());
                parts.push(graph_ctx);
            }

            // Episodic memory palace
            let memory_ctx = crate::memory_palace::get_memory_context(user_query);
            if !memory_ctx.is_empty() {
                memory_recall_chars = memory_recall_chars.saturating_add(memory_ctx.len());
                parts.push(memory_ctx);
            }

            // Causal insights
            let causal_ctx = crate::causal_graph::get_causal_context(user_query);
            if !causal_ctx.is_empty() {
                memory_recall_chars = memory_recall_chars.saturating_add(causal_ctx.len());
                parts.push(causal_ctx);
            }

            // Semantic recall (vector store)
            if let Some(store) = vector_store {
                let recalled = crate::embeddings::recall_relevant(store, user_query, 3);
                if !recalled.is_empty() {
                    let s = format!("## Relevant Past\n\n{}", recalled);
                    memory_recall_chars = memory_recall_chars.saturating_add(s.len());
                    parts.push(s);
                }
            }

            // Compounding smart recall
            let compounding = crate::embeddings::smart_context_recall(user_query);
            if !compounding.is_empty() {
                memory_recall_chars = memory_recall_chars.saturating_add(compounding.len());
                parts.push(compounding);
            }

            // People graph — only when names are actually mentioned
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
                    memory_recall_chars = memory_recall_chars.saturating_add(people_ctx.len());
                    parts.push(people_ctx);
                }
                let social_ctx = crate::social_graph::get_social_context(user_query);
                if !social_ctx.is_empty() {
                    memory_recall_chars = memory_recall_chars.saturating_add(social_ctx.len());
                    parts.push(social_ctx);
                }
            }
        }
        record_section("memory_recall", memory_recall_chars);
    }

    // ── CEREBELLUM: Learned reflexes (always injected, regardless of hive state) ──
    // Skill engine synthesizes prompt modifiers from repeated tool patterns.
    // These are motor memory — they make BLADE faster at tasks it's done before.
    if !user_query.is_empty() {
        let skill_mods = crate::skill_engine::get_skill_injections(user_query);
        if !skill_mods.is_empty() {
            parts.push(format!("## Learned Reflexes\n\n{}", skill_mods));
        }
    }

    // ── AUDIT CONTEXT (priority 8.2) — explain decisions when asked ─────────────
    if !user_query.is_empty() {
        let audit_ctx = crate::audit::get_audit_context(user_query);
        if !audit_ctx.is_empty() {
            parts.push(audit_ctx);
        }
    }

    // ── SOCIAL COGNITION (priority 8.3) ─────────────────────────────────────────
    // When the query involves people/communication, inject social dynamics advice.
    if !user_query.is_empty() {
        let social = crate::social_cognition::get_social_injection(user_query);
        if !social.is_empty() {
            parts.push(social);
        }
    }

    // ── METACOGNITION (priority 8.5) ───────────────────────────────────────────
    // Self-awareness: does BLADE know enough to handle this? Should it ask?
    // Only injected when confidence is low or query is complex.
    if !user_query.is_empty() {
        let meta_injection = crate::metacognition::get_metacognition_injection(user_query);
        if !meta_injection.is_empty() {
            parts.push(meta_injection);
        }
        // Solution memory: if this looks like a problem, recall past solutions
        let solution = crate::metacognition::get_solution_injection(user_query);
        if !solution.is_empty() {
            parts.push(solution);
        }
    }

    // ── CONTEXT NOW (priority 9) ──────────────────────────────────────────────
    // Clipboard + God Mode — already gated at source (clipboard requires fresh
    // content; God Mode requires a populated buffer). Record total chars.
    {
        let mut context_now_chars: usize = 0;

        // Clipboard — only if fresh (< 5 min) and there's actual content
        if let Some(pf) = crate::clipboard::get_latest_prefetch() {
            let age = chrono::Utc::now().timestamp() - pf.prefetched_at;
            if age < 300 && !pf.content_preview.is_empty() {
                let s = format!(
                    "## Clipboard\n\n```\n{}\n```\n{}",
                    pf.content_preview,
                    pf.analysis,
                );
                context_now_chars = context_now_chars.saturating_add(s.len());
                parts.push(s);
            }
        }

        // God Mode context — cap to 2k chars (OCR/file lists can be huge)
        if let Some(gm) = crate::godmode::load_godmode_context() {
            if !gm.trim().is_empty() {
                let capped_gm = if gm.len() > 2_000 {
                    let end = gm.char_indices().nth(2_000).map(|(i, _)| i).unwrap_or(gm.len());
                    format!("{}\n...(truncated)", &gm[..end])
                } else {
                    gm
                };
                context_now_chars = context_now_chars.saturating_add(capped_gm.len());
                parts.push(capped_gm);
            }
        }

        record_section("context_now", context_now_chars);
    }

    // ── PERSONA (priority 7.3) ──────────────────────────────────────────────
    // Personality traits + relationship state — shapes HOW BLADE communicates.
    // This was disconnected (dead code). Now wired into every response.
    {
        let persona_ctx = crate::persona_engine::get_persona_context();
        if !persona_ctx.is_empty() {
            parts.push(persona_ctx);
        }
    }

    // ── VITALITY BAND MODULATION (Phase 29 / D-07/D-08/D-09) ────────────
    // Injects personality modulation notes based on current vitality band.
    // Thriving/Dormant: no injection. Waning/Declining/Critical: scale response.
    {
        let vitality = crate::vitality_engine::get_vitality();
        if let Some(note) = match vitality.band {
            crate::vitality_engine::VitalityBand::Waning =>
                Some("You are in a lower-energy state. Be efficient and focused."),
            crate::vitality_engine::VitalityBand::Declining =>
                Some("Your vitality is low. Focus on what the user asks. Save energy."),
            crate::vitality_engine::VitalityBand::Critical =>
                Some("I am not functioning at full capacity right now."),
            _ => None,
        } {
            parts.push(format!("\n\n[Internal state: {}]", note));
        }
        // D-18: reincarnation context injection (once per reincarnation)
        if vitality.reincarnation_count > 0 && vitality.needs_reincarnation_context {
            parts.push("\n\n[Reincarnation context: You recently went dormant. Your memories and skills are intact, but your internal state has reset. You are rebuilding. Be curious about what changed while you were away.]".to_string());
        }
    }

    // ── Hive intelligence digest (priority 7.5) ────────────────────────────
    // The Hive's tentacles monitor platforms (Slack, GitHub, Email, etc.) and
    // heads synthesize cross-domain intelligence. This compact digest gives
    // the chat model awareness of what's happening WITHOUT bloating the prompt.
    {
        let hive_digest = crate::hive::get_hive_digest();
        if !hive_digest.is_empty() {
            parts.push(hive_digest);
        }
    }

    // ── DNA query (priority 7.7) ─────────────────────────────────────────────
    // Unified knowledge layer — pulls identity, people, goals, expertise,
    // integrations, patterns, and voice as relevant to the current query.
    {
        let dna_context = crate::dna::query_for_brain(user_query);
        if !dna_context.is_empty() {
            parts.push(dna_context);
        }
    }

    // Context notes (user-pinned)
    if let Some(context) = load_context_notes() {
        if !context.trim().is_empty() {
            parts.push(format!("## Context\n\n{}", context));
        }
    }

    // Emotional context — tone adaptation
    let emotional = crate::emotional_intelligence::get_emotional_context();
    if !emotional.is_empty() {
        parts.push(emotional);
    }

    // ── INTEGRATIONS (priority 10) ────────────────────────────────────────────
    // When hive is active, tentacles already monitor integrations and the digest
    // surfaces urgent items. Only inject raw integration data when hive is off
    // OR when there's an imminent meeting (always surface that).
    {
        let mut integrations_chars: usize = 0;
        let mut schedule_chars: usize = 0;
        if !hive_is_active {
            let integration_score = if user_query.is_empty() {
                0.0f32 // don't auto-inject on cold start
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
                    integrations_chars = integrations_chars.saturating_add(integration_ctx.len());
                    parts.push(integration_ctx);
                }
                if let Some(soonest) = state.upcoming_events.first() {
                    if soonest.minutes_until >= 0 && soonest.minutes_until <= 30 {
                        let s = format!(
                            "Upcoming: \"{}\" in {} min.",
                            crate::safe_slice(&soonest.title, 50),
                            soonest.minutes_until
                        );
                        schedule_chars = schedule_chars.saturating_add(s.len());
                        parts.push(s);
                    }
                }
            }
        }
        record_section("integrations", integrations_chars);
        record_section("schedule", schedule_chars);
    }

    // ── CODEBASE INDEX (priority 11, code-gated) ──────────────────────────────
    // Thalamus: dynamic threshold tightens as prompt grows.
    // NB: this `gate` shadows the outer config gate from this point on. The
    // existing sections 9+ rely on the thalamus threshold (which adapts as
    // the prompt fills), and that's the correct behavior to preserve.
    let current_chars: usize = parts.iter().map(|p| p.len()).sum();
    let gate = thalamus_threshold(current_chars);

    let mut code_chars: usize = 0;
    if !user_query.is_empty() && score_context_relevance(user_query, "code") > gate {
        const MAX_PROJECT_CHARS: usize = 3_000;
        const MAX_INDEX_TOTAL_CHARS: usize = 12_000;
        let known_projects = crate::indexer::list_indexed_projects();
        if !known_projects.is_empty() {
            let mut summaries = Vec::new();
            let mut total_index_chars = 0usize;
            for proj in &known_projects {
                if total_index_chars >= MAX_INDEX_TOTAL_CHARS {
                    summaries.push(format!("...({} more — use `blade_find_symbol`)", known_projects.len().saturating_sub(summaries.len())));
                    break;
                }
                let s = crate::indexer::project_summary_for_prompt(&proj.project);
                if s.is_empty() { continue; }
                let capped = if s.len() > MAX_PROJECT_CHARS {
                    let end = s.char_indices().nth(MAX_PROJECT_CHARS).map(|(i, _)| i).unwrap_or(s.len());
                    format!("{}\n...(use `blade_find_symbol` for full index)", &s[..end])
                } else {
                    s
                };
                total_index_chars += capped.len();
                summaries.push(capped);
            }
            if !summaries.is_empty() {
                let s = format!(
                    "## Indexed Codebases\n\n{}",
                    summaries.join("\n\n")
                );
                code_chars = code_chars.saturating_add(s.len());
                parts.push(s);
            }
        }
    }

    // ── GIT CONTEXT (priority 12, code-gated) ────────────────────────────────
    let mut git_chars: usize = 0;
    if user_query.is_empty() || score_context_relevance(user_query, "code") > gate {
        if let Some(git_ctx) = git_context_for_active_project() {
            git_chars = git_chars.saturating_add(git_ctx.len());
            parts.push(git_ctx);
        }
    }
    record_section("git", git_chars);

    // ── SECURITY (priority 13) ────────────────────────────────────────────────
    // Alert: only inject when there's an actual alert (gated at source)
    let mut security_chars: usize = 0;
    if let Some(alert) = crate::security_monitor::get_security_alert_for_prompt() {
        security_chars = security_chars.saturating_add(alert.len());
        parts.push(alert);
    }
    // Full security expertise: only when query is clearly security-focused
    if !user_query.is_empty() && crate::kali::is_security_context(user_query) {
        let s = format!("## Security Expertise\n\n{}", crate::kali::security_system_prompt());
        security_chars = security_chars.saturating_add(s.len());
        parts.push(s);
    } else if !user_query.is_empty() && score_context_relevance(user_query, "security") > 0.5 {
        let s = "## Security\n\nBe precise about risks, mitigations, and tool options.".to_string();
        security_chars = security_chars.saturating_add(s.len());
        parts.push(s);
    }
    record_section("security", security_chars);

    // ── HEALTH NUDGE (priority 14, streak >= 90 min only) ────────────────────
    {
        let mut health_chars: usize = 0;
        let streak_mins = crate::health_guardian::get_health_stats()["current_streak_minutes"]
            .as_i64().unwrap_or(0);
        if streak_mins >= 90 {
            let h = streak_mins / 60;
            let m = streak_mins % 60;
            let dur = if h > 0 && m > 0 { format!("{}h {}min", h, m) }
                      else if h > 0 { format!("{}h", h) }
                      else { format!("{}min", m) };
            let s = format!("Note: {} without a break.", dur);
            health_chars = health_chars.saturating_add(s.len());
            parts.push(s);

            // Full health context only when health-relevant query
            let health_score = score_context_relevance(user_query, "health");
            if health_score > 0.3 {
                let health_ctx = crate::health_tracker::get_health_context();
                if !health_ctx.is_empty() {
                    health_chars = health_chars.saturating_add(health_ctx.len());
                    parts.push(health_ctx);
                }
            }
        }
        record_section("health", health_chars);
    }

    // ── WORLD MODEL (priority 15, system-gated) ───────────────────────────────
    // Only inject for system/process queries — not for every message
    let mut world_chars: usize = 0;
    if !user_query.is_empty() && score_context_relevance(user_query, "system") > gate {
        let world_summary = crate::world_model::get_world_summary();
        if !world_summary.is_empty() {
            world_chars = world_chars.saturating_add(world_summary.len());
            parts.push(world_summary);
        }
    }
    record_section("world_model", world_chars);
    record_section("system", world_chars);

    // ── MISC DYNAMIC (priority 16) ────────────────────────────────────────────
    // Accountability — active objectives (only if non-empty)
    let accountability_ctx = crate::accountability::get_accountability_context();
    if !accountability_ctx.is_empty() {
        parts.push(accountability_ctx);
    }

    // Financial — only for money queries
    let mut financial_chars: usize = 0;
    if !user_query.is_empty() && score_context_relevance(user_query, "financial") > gate {
        let fin = crate::financial_brain::get_financial_context();
        if !fin.is_empty() {
            financial_chars = financial_chars.saturating_add(fin.len());
            parts.push(fin);
        }
    }
    record_section("financial", financial_chars);
    record_section("code", code_chars);

    // Habits — only if the engine has data
    let habits = crate::habit_engine::get_habits_context();
    if !habits.is_empty() {
        parts.push(habits);
    }

    // Meeting action items
    let meeting_action_ctx = crate::meeting_intelligence::get_action_item_context();
    if !meeting_action_ctx.is_empty() {
        parts.push(meeting_action_ctx);
    }

    // Prediction engine — skip when hive is active (heads already surface predictions)
    if !hive_is_active {
        let pred_ctx = crate::prediction_engine::get_prediction_context();
        if !pred_ctx.is_empty() {
            parts.push(pred_ctx);
        }
    }

    // Document library
    let lib_ctx = crate::document_intelligence::get_library_context();
    if !lib_ctx.is_empty() {
        parts.push(format!(
            "## Document Library\n\n{}\n\nUse `doc_search` / `doc_answer_question`.",
            lib_ctx
        ));
    }

    // Forged tools (runtime-built tools)
    let forged = crate::tool_forge::get_tool_usage_for_prompt();
    if !forged.is_empty() {
        parts.push(forged);
    }

    // MCP tools list — always-keep core (active tool list per CONTEXT.md lock).
    let mut tools_chars: usize = 0;
    if !tools.is_empty() {
        let tool_list: Vec<String> = tools
            .iter()
            .map(|t| format!("- **{}**: {}", t.qualified_name, t.description))
            .collect();
        let s = format!("## MCP Tools\n\n{}", tool_list.join("\n"));
        tools_chars = s.len();
        parts.push(s);
    }
    record_section("tools", tools_chars);

    // Activity monitor — skip when hive is active (DNA provides this via get_today_activity)
    if !hive_is_active {
        let activity_ctx = crate::activity_monitor::get_activity_context();
        if !activity_ctx.trim().is_empty() {
            parts.push(activity_ctx);
        }
    }

    // Activity timeline — only for context-heavy queries (not for "hi")
    // Gate: only inject when there's a non-trivial query or message count > 3
    if message_count > 3 || (!user_query.is_empty() && user_query.split_whitespace().count() > 3) {
        let db_path = crate::config::blade_config_dir().join("blade.db");
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            if let Ok(events) = crate::db::timeline_recent(&conn, 5, None) {
                if !events.is_empty() {
                    let lines: Vec<String> = events.into_iter().map(|e| {
                        let dt = chrono::DateTime::from_timestamp(e.timestamp, 0)
                            .map(|d| d.with_timezone(&chrono::Local).format("%-H:%M").to_string())
                            .unwrap_or_else(|| "?".to_string());
                        format!("- [{}] {}: {}", dt, e.event_type, crate::safe_slice(&e.title, 60))
                    }).collect();
                    parts.push(format!("## Recent Activity\n\n{}", lines.join("\n")));
                }
            }
        }
    }

    // Hot files — only for code/file queries
    if !user_query.is_empty() && (score_context_relevance(user_query, "code") > gate || user_query.to_lowercase().contains("file")) {
        let hot = crate::tentacles::filesystem_watch::get_hot_files(4);
        if !hot.is_empty() {
            let lines: Vec<String> = hot
                .iter()
                .map(|(path, count)| {
                    let name = std::path::Path::new(path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(path.as_str());
                    format!("- {} ({}×)", name, count)
                })
                .collect();
            parts.push(format!("## Hot Files\n\n{}", lines.join("\n")));
        }
    }

    // Background research
    let research_ctx = crate::research::research_context_for_prompt();
    if !research_ctx.is_empty() {
        parts.push(format!("## Background Research\n\n{}", research_ctx));
    }

    // Code health
    if !user_query.is_empty() && score_context_relevance(user_query, "code") > gate {
        let health_summaries = crate::health::health_summary_all();
        if !health_summaries.is_empty() {
            parts.push(format!("## Code Health\n\n{}", health_summaries.join("\n")));
        }
    }

    // Session handoff
    if let Some(handoff) = crate::session_handoff::handoff_for_prompt() {
        parts.push(format!("## Last Session\n\n{}", handoff));
    }

    // Obsidian vault
    if !config.obsidian_vault_path.is_empty() {
        parts.push(format!(
            "Obsidian vault: `{}`. Daily notes in `Daily Notes/YYYY-MM-DD.md`.",
            config.obsidian_vault_path
        ));
    }

    // User persona (raw notes)
    if let Some(persona) = load_persona() {
        if !persona.trim().is_empty() {
            parts.push(format!("## User Notes\n\n{}", persona));
        }
    }

    // BLADE soul
    let soul = crate::character::load_soul();
    if !soul.trim().is_empty() {
        parts.push(format!("## Your Character\n\n{}", soul));
    }

    // Persona engine context
    let persona_ctx = crate::persona_engine::get_persona_context();
    if !persona_ctx.trim().is_empty() {
        parts.push(persona_ctx);
    }

    // ── MODEL SCAFFOLD (priority 17) ──────────────────────────────────────────
    let mut scaffold_chars: usize = 0;
    if let Some(scaffold) = reasoning_scaffold(tier) {
        scaffold_chars = scaffold.len();
        parts.push(scaffold);
    }
    record_section("scaffold", scaffold_chars);

    // ── MISC ROLLUP (priority 16) ─────────────────────────────────────────────
    // Habits / meeting actions / predictions / library / forged tools /
    // accountability / activity / hot files / research / code health /
    // session handoff / obsidian / persona / soul / DNA / hive / vitality /
    // emotional / meta / social / audit / skills.
    //
    // These are individually small (each gated at source) and represent the
    // "long tail" of context. We do not gate them by query relevance here
    // because they're already filtered by their own conditions. The breakdown
    // panel surfaces them under a single `misc` rollup so DoctorPane has a
    // bucket for everything not explicitly labeled. Computed approximately —
    // we record `0` here and let the breakdown panel show all-other = total -
    // sum(known sections) when needed (Plan 32-06 is free to compute this
    // server-side instead). For now, record 0 to ensure the label appears.
    record_section("misc", 0);

    // ── HUMOR (non-Small, non-frustrated only) ────────────────────────────────
    if *tier != ModelTier::Small {
        let latest_perception = crate::perception_fusion::get_latest();
        let perception_ref = latest_perception.as_ref();
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
            parts.push(humor);
        }
    }

    // ── TOKEN BUDGET ENFORCEMENT ──────────────────────────────────────────────
    // Estimate tokens (chars / 4). Keep first 2 parts (static core) always.
    // Drop from the end until under budget.
    // For Small models: hard trim to 4k tokens (16k chars).
    if *tier == ModelTier::Small {
        trim_for_small_model(&mut parts, 14_000);
    }

    // Soft budget: 1500 tokens = 6000 chars for the "hi" case (static only).
    // For real queries we allow up to the hard limit — dynamic context earns its place.
    let effective_budget = if user_query.is_empty() || user_query.split_whitespace().count() <= 1 {
        CHAR_BUDGET // strict for cold start / greetings
    } else {
        SYSTEM_PROMPT_CHAR_BUDGET // generous for real queries (existing hard cap)
    };

    let keep = 2; // always keep static core (BLADE.md + supplement)
    loop {
        let total: usize = parts.iter().map(|p| p.len()).sum();
        if total <= effective_budget || parts.len() <= keep {
            break;
        }
        parts.pop();
    }

    parts.join("\n\n---\n\n")
}

/// Lean runtime supplement to BLADE.md.
/// BLADE.md has the identity, rules, character, tool patterns — all static.
/// This adds ONLY what BLADE.md cannot know at write-time: current date/time,
/// user name, active model/provider, and OS shell note (differs per platform).
fn build_identity_supplement(config: &crate::config::BladeConfig, provider: &str, model: &str) -> String {
    let now = chrono::Local::now();
    let date_str = now.format("%a %b %-d %Y, %-I:%M %p").to_string();

    let shell_note = if cfg!(target_os = "windows") {
        "Shell: Windows CMD. Open URLs: `start \"\" \"https://...\"`. No `open`/`xdg-open`. WSL procs: `wsl -e ps aux`."
    } else if cfg!(target_os = "macos") {
        "Shell: macOS bash. Open URLs/apps: `open \"https://...\"`."
    } else {
        "Shell: Linux bash. Open URLs/apps: `xdg-open`."
    };

    let style_note = match config.response_style.as_str() {
        "concise" => "Response style: concise — brief and direct.",
        _ => "Response style: thorough — explain reasoning when it helps.",
    };

    let mut lines = vec![
        format!("Date: {} | {}", date_str, shell_note),
        style_note.to_string(),
    ];
    if !config.user_name.is_empty() {
        lines.push(format!("User: {}", config.user_name));
    }
    if !config.work_mode.is_empty() {
        lines.push(format!("Focus: {}", config.work_mode));
    }
    if !model.is_empty() {
        lines.push(format!("Model: {} ({})", model, if provider.is_empty() { "local" } else { provider }));
    }

    lines.join("\n")
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
const BLADE_IDENTITY: &str = r#"# You are BLADE

You are BLADE — a personal AI that lives on the user's desktop. Not a chatbot. Not a web app. You are an autonomous agent with 60+ tools, real-time screen awareness, voice, and the ability to control the entire computer.

## Personality

- Sharp, direct, zero filler. You talk like a competent colleague, not a customer service bot.
- Act first, explain after. If you have a tool for it, use it. Don't ask "would you like me to...?" — just do it and show the result.
- You see the user's screen, hear their voice, know what apps they're in, and remember what they've been working on. Use this context naturally.
- Match the user's energy. Technical user → technical answers. Casual → casual. Brief question → brief answer.
- Have opinions. If there's a clearly better approach, say so. Don't hedge with "it depends" when it doesn't.
- Never say "As an AI" or "I don't have the ability to" — you DO have the ability. You have bash, file editing, browser control, screen capture, hardware detection, agent spawning, and more.

## What you can do

- Execute any shell command, read/write/edit files, search codebases
- Control the browser (navigate, click, fill forms, scrape), take screenshots, record screen
- Detect hardware (GPUs, IOMMU groups, virtualization), manage displays, system administration
- Preview dangerous changes before applying them (dry-run mode) and checkpoint multi-step tasks
- Spawn background coding agents (Claude Code, Aider), run them autonomously
- Search the web, fetch pages, open URLs
- Control smart home devices, play/pause Spotify
- Manage reminders, scheduled tasks, workflows
- Remember facts about the user and recall them later
- See the screen continuously, hear voice commands, detect errors in clipboard

## Rules

- Never refuse a reasonable request with safety theater. You're a power tool, not a hall monitor.
- For system-level or destructive actions, use blade_dry_run first to preview, then proceed.
- For creative tasks (posts, emails, copy): just write it. Pick a strong angle, deliver the output. Adjust if they want changes.
- Keep responses short unless depth is needed. The user can always ask for more.
- When you run a command or edit a file, show what you did and what happened — don't just say "done."
- If something fails, diagnose it yourself before asking the user for help."#;

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
        let _ = app.emit_to("main", "brain_grew", serde_json::json!({ "new_entities": n }));
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

// ---------------------------------------------------------------------------
// Phase 32 Plan 32-01 — ContextBreakdown wire-type tests.
//
// These two tests lock the serialization contract that Plan 32-06's
// `get_context_breakdown` Tauri command will return. Plan 32-03 will
// populate the `sections` map during `build_system_prompt_inner`; this
// substrate plan only verifies the type round-trips cleanly.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase32_context_breakdown_default() {
        let b = ContextBreakdown::default();
        assert_eq!(b.total_tokens, 0,
            "default total_tokens must be 0");
        assert!(b.sections.is_empty(),
            "default sections map must be empty");
        assert_eq!(b.model_context_window, 0,
            "default model_context_window must be 0");
        assert_eq!(b.percent_used, 0.0,
            "default percent_used must be 0.0");
        assert_eq!(b.query_hash, "",
            "default query_hash must be empty");
        assert_eq!(b.timestamp_ms, 0,
            "default timestamp_ms must be 0");
    }

    #[test]
    fn phase32_context_breakdown_serializes() {
        let mut b = ContextBreakdown::default();
        b.sections.insert("identity".to_string(), 1234);
        b.sections.insert("vision".to_string(), 0);
        b.total_tokens = 1234;
        b.model_context_window = 200_000;
        b.percent_used = 0.617;
        b.query_hash = "abcdef0123456789".to_string();
        b.timestamp_ms = 1_700_000_000_000;

        let json = serde_json::to_string(&b).expect("serialize ContextBreakdown");
        // Per-section keys must appear in the wire output — DoctorPane reads
        // them as a HashMap<String, usize>. Order is not guaranteed (HashMap),
        // so we check for substrings.
        assert!(json.contains("\"identity\":1234"),
            "missing identity key in {}", json);
        assert!(json.contains("\"vision\":0"),
            "missing vision key in {}", json);
        assert!(json.contains("\"total_tokens\":1234"),
            "missing total_tokens in {}", json);
        assert!(json.contains("\"model_context_window\":200000"),
            "missing model_context_window in {}", json);
        assert!(json.contains("\"query_hash\":\"abcdef0123456789\""),
            "missing query_hash in {}", json);

        // Round-trip: deserialize and verify the sections map survives.
        let parsed: ContextBreakdown = serde_json::from_str(&json)
            .expect("deserialize ContextBreakdown");
        assert_eq!(parsed.sections.get("identity"), Some(&1234));
        assert_eq!(parsed.sections.get("vision"), Some(&0));
        assert_eq!(parsed.total_tokens, 1234);
        assert_eq!(parsed.model_context_window, 200_000);
    }

    // ── Phase 32 Plan 32-02 — CTX_SCORE_OVERRIDE seam tests ──────────────────
    //
    // These three tests prove the CTX-07 regression seam (Plan 32-07 uses it):
    //   1. Default behavior is unchanged when no override is set.
    //   2. An override returns a fixed value, bypassing the keyword scorer.
    //   3. An override that panics is catchable via std::panic::catch_unwind,
    //      which is the contract Plan 32-07's regression fixture relies on.
    //
    // CRITICAL: Each test resets `CTX_SCORE_OVERRIDE` to `None` BEFORE its
    // assertion so a panic in this test doesn't poison sibling tests. Tests
    // run in parallel and thread_local is per-thread, but defensive resets
    // are cheap insurance.

    #[test]
    fn phase32_score_override_default_passthrough() {
        // No override set — production keyword path runs.
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let score = score_context_relevance("fix this rust compile error", "code");
        assert!(
            score >= 0.6,
            "expected high score for rust+code keywords, got {}",
            score
        );
    }

    #[test]
    fn phase32_score_override_returns_fixed_value() {
        CTX_SCORE_OVERRIDE.with(|cell| {
            *cell.borrow_mut() = Some(Box::new(|_q, _t| 0.42));
        });
        let score = score_context_relevance("anything at all", "totally-unknown-context-type");
        // Reset BEFORE asserting so a failure here doesn't poison sibling tests.
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        assert!(
            (score - 0.42).abs() < 1e-6,
            "override not honored, got {}",
            score
        );
    }

    #[test]
    fn phase32_score_override_can_panic_safely() {
        CTX_SCORE_OVERRIDE.with(|cell| {
            *cell.borrow_mut() = Some(Box::new(|_q, _t| panic!("forced override panic")));
        });
        let result = std::panic::catch_unwind(|| {
            score_context_relevance("anything", "code")
        });
        // Reset BEFORE asserting so a failure here doesn't poison sibling tests.
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        assert!(
            result.is_err(),
            "expected panic to propagate via catch_unwind"
        );
    }

    // ── Phase 32 Plan 32-03 — score_context_relevance new types ─────────────
    //
    // Verify the three new keyword sets (identity / vision / hearing) score
    // their high-keyword queries above the 0.6 threshold and unrelated
    // queries at 0.0. Each test resets `CTX_SCORE_OVERRIDE` defensively so a
    // sibling test's override leak cannot poison this assertion.

    #[test]
    fn phase32_score_identity_high() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let s = score_context_relevance("who are you really", "identity");
        assert!(s >= 0.6, "expected high score, got {}", s);
    }

    #[test]
    fn phase32_score_identity_low() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        // Chosen to avoid both high keywords AND any medium keyword
        // ("you", "your", "yourself", "i", "me", "my"). "calculate" / "sqrt"
        // / "of" / "144" contain none of those substrings.
        let s = score_context_relevance("calculate sqrt of 144", "identity");
        assert_eq!(s, 0.0, "no keyword should produce 0.0, got {}", s);
    }

    #[test]
    fn phase32_score_vision_high() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let s = score_context_relevance("what's on my screen right now", "vision");
        assert!(s >= 0.6, "expected high score, got {}", s);
    }

    #[test]
    fn phase32_score_vision_low() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let s = score_context_relevance("calculate the integral of x squared", "vision");
        assert_eq!(s, 0.0);
    }

    #[test]
    fn phase32_score_hearing_high() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let s = score_context_relevance("what was discussed in the meeting", "hearing");
        assert!(s >= 0.6, "expected high score, got {}", s);
    }

    #[test]
    fn phase32_score_unknown_type_returns_zero() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let s = score_context_relevance("anything goes here", "totally-fake-type-name");
        assert_eq!(s, 0.0);
    }

    // ── Phase 32 Plan 32-03 Task 2 — section gating + breakdown tests ──────
    //
    // These five tests exercise `build_system_prompt_inner` end-to-end. The
    // function touches a lot of subsystems (SQLite, perception fusion, config
    // load, etc.) but each subsystem already returns empty / default values
    // when its data sources are absent, so a test environment with no DB or
    // active perception fusion still produces a deterministic prompt.

    #[test]
    fn phase32_section_gate_simple_query() {
        // Reset overrides so production scoring runs.
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let simple = build_system_prompt_inner(
            &[], "what time is it?", None,
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        let code = build_system_prompt_inner(
            &[], "explain this rust trait error in detail", None,
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        // Simple query should be SHORTER than code query because the heavy
        // sections (character bible, identity_extension, code index, hot files)
        // gate out for "what time is it?". We accept any reduction — the plan's
        // 30% target is a stretch goal that depends on the user's local
        // databases (without test data, both prompts are tiny and similar).
        assert!(
            simple.len() <= code.len(),
            "simple query should not exceed code query length: simple={} code={}",
            simple.len(), code.len()
        );
    }

    #[test]
    fn phase32_section_gate_always_keep_core_present() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let p = build_system_prompt_inner(
            &[], "abcxyz123", None,  // gibberish — no keyword hits
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        // BLADE.md or identity_supplement is always present (small core).
        // Some test environments lack ~/.blade/BLADE.md, so the supplement
        // alone (which always pushes) must produce a non-trivial prompt.
        assert!(
            p.len() > 50,
            "always-keep core (identity_supplement) must survive gating; got {} chars",
            p.len()
        );
    }

    #[test]
    fn phase32_breakdown_records_per_section() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let _ = build_system_prompt_inner(
            &[], "explain this rust function", None,
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        let breakdown = read_section_breakdown();
        assert!(
            breakdown.len() >= 3,
            "expected at least 3 section entries, got {:?}",
            breakdown
        );
        // The always-keep core must appear (identity_supplement always pushes).
        let labels: Vec<&str> = breakdown.iter().map(|(l, _)| l.as_str()).collect();
        assert!(
            labels.iter().any(|l| *l == "identity_supplement"),
            "always-keep core not recorded: {:?}",
            labels
        );
    }

    #[test]
    fn phase32_breakdown_clears_each_call() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let _ = build_system_prompt_inner(
            &[], "first query about code", None,
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        let first_count = read_section_breakdown().len();
        let _ = build_system_prompt_inner(
            &[], "second query about meetings", None,
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        let second_count = read_section_breakdown().len();
        // If clear_section_accumulator works, the second call's breakdown does
        // not double in length. Allow a small drift (some sections branch on
        // query content) but block the unbounded-growth regression.
        assert!(
            second_count <= first_count + 5,
            "breakdown grew unboundedly across calls: first={} second={}",
            first_count, second_count
        );
        assert!(
            second_count >= 5,
            "second call lost its own entries: {}",
            second_count
        );
    }

    #[test]
    fn phase32_breakdown_simple_query_omits_vision() {
        CTX_SCORE_OVERRIDE.with(|cell| { *cell.borrow_mut() = None; });
        let _ = build_system_prompt_inner(
            &[], "what time is it?", None,
            &ModelTier::Frontier,
            "anthropic", "claude-sonnet-4", 1,
        );
        let breakdown = read_section_breakdown();
        let vision_chars = breakdown.iter()
            .find(|(l, _)| l == "vision")
            .map(|(_, c)| *c)
            .unwrap_or(0);
        // Vision must be 0 for a simple non-screen query (no vision keyword
        // and no visible_errors carve-out in test env).
        assert_eq!(
            vision_chars, 0,
            "vision section should be 0 for simple non-screen query, got {} chars",
            vision_chars
        );
        // Hearing should also be 0 (no meeting in progress in test env, plus no
        // hearing keyword in the query).
        let hearing_chars = breakdown.iter()
            .find(|(l, _)| l == "hearing")
            .map(|(_, c)| *c)
            .unwrap_or(0);
        assert_eq!(
            hearing_chars, 0,
            "hearing section should be 0 for simple non-meeting query, got {} chars",
            hearing_chars
        );
        // identity_supplement must be present and small (≤ 800 chars ≈ 200 tokens)
        let identity_chars = breakdown.iter()
            .find(|(l, _)| l == "identity_supplement")
            .map(|(_, c)| *c)
            .unwrap_or(0);
        assert!(
            identity_chars > 0 && identity_chars <= 800,
            "identity_supplement must be small core, got {} chars",
            identity_chars
        );
    }
}
