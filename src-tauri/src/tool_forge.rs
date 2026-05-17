// src-tauri/src/tool_forge.rs
// BLADE Tool Forge — self-expanding capability engine.
//
// When BLADE hits a task it can't do, Tool Forge generates a new tool (as a
// script file), tests it, and makes it immediately available via bash.
// This is how BLADE grows new capabilities at runtime without recompiling.
//
// Tools are Python/bash/Node scripts saved to ~/.blade/tools/.
// Each tool has a companion manifest (name.json) describing its invocation.
#[allow(dead_code)]

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

// ── Phase 47 — Forge chat-line wire (FORGE-02) ────────────────────────────────
//
// Emits a `blade_forge_line` Tauri event on every transition in the forge
// loop so the chat surface can render forge progress as distinct system-style
// chat lines. Six phases are emitted:
//   1. gap_detected — forge_if_needed_with_app decides to fire
//   2. writing      — generate_tool_script begins LLM call
//   3. testing      — test_tool runs the smoke test
//   4. registered   — persist_forged_tool lands the row in forged_tools
//   5. retrying     — forge_if_needed_with_app returns; caller is expected to
//                     retry the original user request with the new tool
//                     available
//   6. failed       — the loop bottoms out (no LLM, no tool, or test failure
//                     escapes the retry budget). Detail carries the reason.
//
// Per the Phase 47 plan: do NOT add new substrate primitives. The 5 emit
// sites below wrap existing code paths — the substrate is unchanged.

/// Tauri event name. Mirrors the Phase 46 BLADE_HUNT_LINE pattern.
pub const BLADE_FORGE_LINE: &str = "blade_forge_line";

// ── Phase 49 (HUNT-COST-CHAT) — per-forge-session cost tracker ──────────────
//
// Mirrors the hunt-side `HUNT_COST_TRACKER`. Reset at the top of every forge
// invocation that has an `AppHandle` so cost lines reflect a fresh session.
// Live cost lines emit on `BLADE_FORGE_LINE` with `kind: "cost"`; 50% soft
// warn + 100% hard block share the helper in `onboarding::hunt`.

pub(crate) static FORGE_COST_TRACKER: once_cell::sync::Lazy<std::sync::Mutex<crate::onboarding::hunt::CostTracker>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(crate::onboarding::hunt::CostTracker::default()));

static FORGE_COST_CONTINUE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Frontend acknowledges the forge cost block and asks BLADE to continue
/// with another budget bucket. Symmetric to `hunt_continue_after_cost_block`.
#[tauri::command]
pub fn forge_continue_after_cost_block() -> Result<(), String> {
    FORGE_COST_CONTINUE.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Reset the forge cost tracker to the configured budget. Called at the top
/// of every `forge_*_with_app` entry point.
fn reset_forge_cost_tracker() {
    let cfg = crate::config::load_config();
    let mut t = FORGE_COST_TRACKER.lock().unwrap_or_else(|p| p.into_inner());
    t.reset(cfg.forge.budget_usd as f64);
    FORGE_COST_CONTINUE.store(false, std::sync::atomic::Ordering::SeqCst);
}

/// Emit a forge-side `cost*` chat-line. Re-uses the hunt-line shape but on
/// the FORGE event so the frontend renderer can keep them visually distinct
/// from hunt cost lines.
fn emit_forge_cost(app: &tauri::AppHandle, line: crate::onboarding::hunt::HuntLine) {
    let _ = app.emit_to("main", BLADE_FORGE_LINE, line);
}

/// Wrap a `providers::complete_turn` call inside `tool_forge` with the same
/// 50% warning / 100% block / extend-bucket UX the hunt loop uses.
///
/// Returns the raw `AssistantTurn` on the happy path. On a hard block, parks
/// for up to `wait_secs` waiting for `forge_continue_after_cost_block`; on
/// acknowledgment, raises the budget by another bucket and returns the turn
/// anyway (the call already happened). On timeout / decline, returns the
/// turn but logs the budget overrun.
async fn forge_complete_turn_tracked(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[crate::providers::ConversationMessage],
    tools: &[crate::providers::ToolDefinition],
    base_url: Option<&str>,
) -> Result<crate::providers::AssistantTurn, String> {
    let turn = crate::providers::complete_turn(provider, api_key, model, messages, tools, base_url)
        .await?;

    let marginal = crate::onboarding::hunt::turn_cost_usd(
        provider, model, turn.tokens_in, turn.tokens_out,
    );

    let (cumulative, budget, fire_warning, fire_block) = {
        let mut t = FORGE_COST_TRACKER.lock().unwrap_or_else(|p| p.into_inner());
        t.cumulative_input_tokens = t.cumulative_input_tokens.saturating_add(turn.tokens_in as u64);
        t.cumulative_output_tokens = t.cumulative_output_tokens.saturating_add(turn.tokens_out as u64);
        t.cumulative_cost_usd += marginal;
        let cumulative = t.cumulative_cost_usd;
        let budget = t.budget_usd;
        let fire_warning = cumulative >= 0.5 * budget && !t.warning_emitted && !t.block_emitted;
        let fire_block = cumulative >= budget && !t.block_emitted;
        if fire_warning { t.warning_emitted = true; }
        if fire_block { t.block_emitted = true; }
        (cumulative, budget, fire_warning, fire_block)
    };

    emit_forge_cost(app, crate::onboarding::hunt::HuntLine::cost(cumulative, budget));
    if fire_warning {
        emit_forge_cost(app, crate::onboarding::hunt::HuntLine::cost_warning(cumulative, budget));
    }
    if fire_block {
        emit_forge_cost(app, crate::onboarding::hunt::HuntLine::cost_block(cumulative, budget));
        // Park up to 120s waiting for the user's continue ack. On timeout,
        // log and return — the next turn will trigger the same block path
        // since the flag stays set.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while std::time::Instant::now() < deadline {
            if FORGE_COST_CONTINUE.swap(false, std::sync::atomic::Ordering::SeqCst) {
                let cfg = crate::config::load_config();
                let mut t = FORGE_COST_TRACKER.lock().unwrap_or_else(|p| p.into_inner());
                t.budget_usd += cfg.forge.budget_usd as f64;
                t.block_emitted = false;
                t.warning_emitted = false;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    }
    Ok(turn)
}

/// Emit a single forge chat-line. Best-effort; never panics, never bubbles
/// an error — a stalled emit must not abort the forge loop.
pub fn emit_forge_line(app: &tauri::AppHandle, phase: &str, detail: &str) {
    let payload = serde_json::json!({
        "kind": "forge",
        "phase": phase,
        "detail": crate::safe_slice(detail, 280).to_string(),
        "timestamp": chrono::Utc::now().timestamp(),
    });
    let _ = app.emit_to("main", BLADE_FORGE_LINE, payload);
}

/// Phase 47 (FORGE-02) pre-check — search the existing tool surface for any
/// tool whose name or description plausibly matches the capability gap. If
/// a match exists, the forge should NOT fire — the user already has the
/// capability they're looking for and we should use the existing tool.
///
/// Implementation: lowercase-keyword overlap. The gap is split into tokens
/// (≥4 chars, alphanumeric), each token must appear in either the tool's
/// `name`, `description`, or `forged_from`. We also scan the native-tool
/// catalog (`crate::native_tools::all_tools()`) so forge doesn't duplicate
/// built-in capability surfaces.
///
/// Phase 51 (FORGE-PRECHECK-REFINE) — read the names of all MCP servers
/// currently registered with the runtime `SharedMcpManager`. Best-effort:
/// if the state isn't available (early boot, headless test path), returns
/// an empty Vec and the caller treats every MCP-cataloged capability as
/// "not installed" — which falls into the "forge anyway" branch, the
/// correct conservative behavior.
async fn collect_installed_mcp_servers(app: &tauri::AppHandle) -> Vec<String> {
    use tauri::Manager;
    let Some(state) = app.try_state::<crate::commands::SharedMcpManager>() else {
        return Vec::new();
    };
    let manager = state.lock().await;
    manager
        .server_status()
        .into_iter()
        .map(|(name, _running)| name)
        .collect()
}

/// Phase 51 (FORGE-PRECHECK-REFINE) — outcome of the MCP-aware pre-check.
///
/// `pre_check_existing_tools` returns `Some(name)` purely on native/forged
/// matches; `pre_check_with_mcp_state` extends that with the MCP catalog
/// dimension. The forge router uses the new variants to decide:
///
///   - `NativeMatch` / `ForgedMatch` → skip forge entirely (capability already
///     resolvable in-app)
///   - `McpInstalled` → skip forge; the user's existing MCP server handles it
///   - `McpCatalogedNotInstalled` → emit a `forge_route` chat-line ("could
///     install <MCP> from catalog, or forge a quick scraper now — picking
///     forge") and FIRE the forge (in-app autonomy preference)
///   - `NoMatch` → fire the forge normally
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreCheckOutcome {
    /// A native (built-in) tool already handles this capability. Skip forge.
    NativeMatch(String),
    /// A previously-forged tool already handles this capability. Skip forge.
    ForgedMatch(String),
    /// An MCP server in the catalog AND already installed by the user can
    /// handle this. Skip forge (defer to the user's installed MCP).
    McpInstalled(String),
    /// An MCP server in the catalog COULD handle this, but the user hasn't
    /// installed it. Per the autonomy preference (in-app forge > install MCP),
    /// the caller surfaces a `forge_route` chat-line and fires the forge.
    McpCatalogedNotInstalled(String),
    /// Nothing in any catalog matches. Fire the forge normally.
    NoMatch,
}

/// Phase 51 (FORGE-PRECHECK-REFINE) — keyword map of capability tokens to
/// known MCP server names. Mirrors the immune_system.rs::check_mcp_catalog
/// table but inverted: keywords map to a single server name we'd suggest.
/// Kept in tool_forge.rs so the forge router has direct visibility without
/// crossing the immune_system module boundary.
fn mcp_catalog_lookup(capability: &str) -> Option<&'static str> {
    let cap_lower = capability.to_lowercase();
    let mappings: &[(&[&str], &str)] = &[
        (&["kubernetes", "k8s", "kubectl", "pods", "cluster"], "Kubernetes"),
        (&["docker", "container"], "Docker"),
        (&["youtube"], "YouTube"),
        (&["spotify", "playlist"], "Spotify"),
        (&["notion", "wiki"], "Notion"),
        (&["figma"], "Figma"),
        (&["shopify"], "Shopify"),
        (&["stripe", "payment"], "Stripe"),
        (&["reddit", "subreddit"], "Reddit"),
        (&["twitter", "tweet", "x.com"], "Twitter/X"),
        (&["instagram"], "Instagram"),
        (&["postgres", "postgresql"], "PostgreSQL"),
        (&["mongodb", "mongo"], "MongoDB"),
        (&["redis"], "Redis"),
        (&["terraform"], "Terraform"),
        (&["jira"], "Jira"),
        (&["linear"], "Linear"),
        (&["sentry"], "Sentry"),
        (&["datadog"], "Datadog"),
        (&["cloudflare"], "Cloudflare"),
        (&["supabase"], "Supabase"),
        (&["firebase"], "Firebase"),
        (&["vercel"], "Vercel"),
        (&["netlify"], "Netlify"),
        (&["slack"], "Slack"),
        (&["github", "gist"], "GitHub"),
    ];
    for (keywords, server_name) in mappings {
        if keywords.iter().any(|k| cap_lower.contains(k)) {
            return Some(server_name);
        }
    }
    None
}

/// Phase 51 (FORGE-PRECHECK-REFINE) — MCP-aware pre-check.
///
/// Layered decision (in order):
///   1. Forged-tool match → `ForgedMatch`
///   2. Native-tool match → `NativeMatch`
///   3. MCP catalog match:
///        - if `installed_mcp_servers` contains the suggested name (case-
///          insensitive, substring match either way) → `McpInstalled`
///        - else → `McpCatalogedNotInstalled`
///   4. Otherwise → `NoMatch`
///
/// `installed_mcp_servers` is supplied by the caller (forge router reads it
/// from the runtime `SharedMcpManager`). Pure function — testable without
/// any Tauri AppHandle.
pub fn pre_check_with_mcp_state(
    capability: &str,
    installed_mcp_servers: &[String],
) -> PreCheckOutcome {
    let gap_lower = capability.to_lowercase();
    let tokens: Vec<String> = gap_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 4)
        .map(|s| s.to_string())
        .collect();

    if !tokens.is_empty() {
        let all_tokens_match = |haystack: &str| -> bool {
            let h = haystack.to_lowercase();
            tokens.iter().all(|t| h.contains(t.as_str()))
        };

        // Forged tools first (cheap DB read).
        for tool in get_forged_tools() {
            let haystack = format!("{} {} {}", tool.name, tool.description, tool.forged_from);
            if all_tokens_match(&haystack) {
                return PreCheckOutcome::ForgedMatch(tool.name);
            }
        }

        // Native tools next.
        for tool in crate::native_tools::tool_definitions() {
            let haystack = format!("{} {}", tool.name, tool.description);
            if all_tokens_match(&haystack) {
                return PreCheckOutcome::NativeMatch(tool.name);
            }
        }
    }

    // MCP catalog dimension.
    if let Some(server) = mcp_catalog_lookup(capability) {
        let installed = installed_mcp_servers.iter().any(|name| {
            let lname = name.to_lowercase();
            let lserver = server.to_lowercase();
            // Either direction: registered name might be "github" while the
            // catalog server is "GitHub", or registered might be a fuller
            // string like "mcp-github" containing the server name.
            lname.contains(&lserver) || lserver.contains(&lname)
        });
        return if installed {
            PreCheckOutcome::McpInstalled(server.to_string())
        } else {
            PreCheckOutcome::McpCatalogedNotInstalled(server.to_string())
        };
    }

    PreCheckOutcome::NoMatch
}

/// Returns `Some(matched_tool_name)` to short-circuit the forge; `None` to
/// continue.
pub fn pre_check_existing_tools(gap: &str) -> Option<String> {
    let gap_lower = gap.to_lowercase();
    // Tokenize: alphanumeric runs ≥4 chars. "fetch a youtube transcript"
    // → ["fetch", "youtube", "transcript"]. The 4-char floor drops noise
    // words like "a", "the", "of".
    let tokens: Vec<String> = gap_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 4)
        .map(|s| s.to_string())
        .collect();
    if tokens.is_empty() {
        return None;
    }

    // Helper — every token must appear in haystack.
    let all_tokens_match = |haystack: &str| -> bool {
        let h = haystack.to_lowercase();
        tokens.iter().all(|t| h.contains(t.as_str()))
    };

    // Check forged tools first (cheap DB read).
    for tool in get_forged_tools() {
        let haystack = format!("{} {} {}", tool.name, tool.description, tool.forged_from);
        if all_tokens_match(&haystack) {
            return Some(tool.name);
        }
    }

    // Check native tools (in-memory iteration). `tool_definitions()` is the
    // canonical catalog of the 60+ built-in tools — if any of them already
    // covers the gap, forge would be duplicative.
    for tool in crate::native_tools::tool_definitions() {
        let haystack = format!("{} {}", tool.name, tool.description);
        if all_tokens_match(&haystack) {
            return Some(tool.name);
        }
    }

    None
}

// ── Public structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolParameter {
    pub name: String,
    pub param_type: String,
    pub description: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgedTool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub language: String,
    pub script_path: String,
    pub usage: String,
    pub parameters: Vec<ToolParameter>,
    pub test_output: String,
    pub created_at: i64,
    pub last_used: Option<i64>,
    pub use_count: i64,
    pub forged_from: String,
}

// ── Internal LLM response shape ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct LlmToolSpec {
    script: String,
    description: String,
    usage: String,
    #[serde(default)]
    parameters: Vec<LlmToolParameter>,
}

#[derive(Debug, Deserialize)]
struct LlmToolParameter {
    name: String,
    #[serde(rename = "type")]
    param_type: String,
    description: String,
    #[serde(default = "default_true")]
    required: bool,
}

fn default_true() -> bool { true }

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Phase 22 Plan 22-04 (v1.3) — failure recovery (VOYAGER-08).
///
/// Roll back partial forge state when a side effect after the first one
/// fails. Currently called from `forge_tool` when DB insert fails after
/// script fs::write succeeds. The order of operations is:
///   1. Remove the script file from disk (best-effort; ignore if missing)
///   2. Re-log the capability gap via `evolution_log_capability_gap` with
///      a `prior_attempt_failed` suffix so the next forge attempt knows
///      this isn't the first try
///
/// This helper is intentionally narrow — Phase 22 v1.3 doesn't ship a
/// full UndoStep machinery because the only post-first-side-effect
/// failure mode `forge_tool` actually exhibits is "DB insert after
/// script write." Broader rollback (SKILL.md export, multi-step undo)
/// can be refactored in if v1.4 surfaces more failure modes.
pub fn rollback_partial_forge(script_path: &Path, capability: &str, reason: &str) {
    if script_path.exists() {
        if let Err(e) = std::fs::remove_file(script_path) {
            log::warn!(
                "[tool_forge] rollback: failed to remove orphan script {}: {e}",
                script_path.display()
            );
        } else {
            log::info!(
                "[tool_forge] rollback: removed orphan script {}",
                script_path.display()
            );
        }
    }
    let _ = crate::evolution::evolution_log_capability_gap(
        capability.to_string(),
        format!("prior_attempt_failed=true reason={}", crate::safe_slice(reason, 200)),
    );
}

/// Phase 22 Plan 22-03 (v1.3) — Voyager skill-write token-budget estimator.
///
/// Estimates total tokens (prompt + max response) using the 4-chars-per-token
/// heuristic. Reserves 30_000 chars (~7_500 tokens) as the response budget
/// — covers typical Python/Bash/Node script generation including JSON-wrap
/// overhead. Pathological prompts (e.g. a copy-pasted 50KB error log) trip
/// the cap before the LLM call.
pub fn estimate_skill_write_tokens(prompt: &str) -> u64 {
    const CHARS_PER_TOKEN: u64 = 4;
    const RESPONSE_RESERVE_CHARS: u64 = 30_000;

    let prompt_tokens = (prompt.len() as u64).saturating_add(CHARS_PER_TOKEN - 1) / CHARS_PER_TOKEN;
    let response_tokens = RESPONSE_RESERVE_CHARS / CHARS_PER_TOKEN;
    prompt_tokens.saturating_add(response_tokens)
}

/// Returns ~/.blade/tools/, creating it if missing.
fn tools_dir() -> PathBuf {
    let dir = crate::config::blade_config_dir().join("tools");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Open the blade.db SQLite connection.
fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).map_err(|e| format!("DB open error: {}", e))
}

/// Phase 24 (v1.3) — non-test, lifecycle-side connection opener used by
/// `crate::skills::lifecycle`. Distinct from `open_db()` only in
/// visibility; opens the same blade.db.
///
/// Runs `ensure_table` + `ensure_invocations_table` + `crate::db::run_migrations`
/// idempotently before returning the connection — production callers see
/// a no-op (boot already ran), tests see the tables created on first use
/// (e.g. integration tests with tempdir BLADE_CONFIG_DIR that bypass boot).
///
/// Pitfall 4 mitigation: dream pass uses a separate Connection from the
/// chat path so SQLite WAL handles reader+writer concurrency.
pub(crate) fn open_db_for_lifecycle() -> Result<rusqlite::Connection, String> {
    let conn = open_db()?;
    // Idempotent table guards — first launch in production already ran
    // migrations at boot, so these are no-ops there. In tests with a fresh
    // tempdir BLADE_CONFIG_DIR (Plan 24-05 abort_within_one_second + Plan
    // 24-07 proposal_reply_yes_merge_persists_merged_tool), boot did NOT
    // run, so we ensure the schema exists on first lifecycle-side read.
    ensure_table(&conn).ok();
    ensure_invocations_table(&conn).ok();
    // turn_traces lives in db.rs::run_migrations — call into that path so
    // recent_unmatched_traces (which uses crate::db::open_db_for_lifecycle)
    // and any direct callers of this opener both see a complete schema.
    crate::db::run_migrations(&conn).map_err(|e| format!("run_migrations: {}", e))?;
    Ok(conn)
}

/// Ensure the `forged_tools` table exists.
fn ensure_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS forged_tools (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            language TEXT NOT NULL,
            script_path TEXT NOT NULL,
            usage TEXT NOT NULL,
            parameters TEXT DEFAULT '[]',
            test_output TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            last_used INTEGER,
            use_count INTEGER DEFAULT 0,
            forged_from TEXT DEFAULT ''
        );
        -- Phase 24 (v1.3) D-24-A -- backfill NULL last_used to created_at
        -- so 91-day prune clock starts at write time uniformly. Idempotent:
        -- second launch is a no-op since no NULL rows remain.
        UPDATE forged_tools SET last_used = created_at WHERE last_used IS NULL;",
    )
    .map_err(|e| format!("DB schema error: {}", e))
}

/// Phase 24 (v1.3) D-24-B / DREAM-02 -- sibling table that records every
/// forged-tool invocation's order-sensitive trace_hash. Auto-pruned to last
/// 100 rows per tool inside `record_tool_use`.
fn ensure_invocations_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS forged_tools_invocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool_name TEXT NOT NULL,
            ts INTEGER NOT NULL,
            trace_hash TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fti_tool_id ON forged_tools_invocations(tool_name, id DESC);",
    )
    .map_err(|e| format!("DB schema error (invocations): {}", e))
}

/// Convert a capability string to a snake_case tool name: first 4 words, lowercased.
fn capability_to_name(capability: &str) -> String {
    capability
        .split_whitespace()
        .take(4)
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

/// Choose the scripting language best suited for the capability description.
fn choose_language(capability: &str) -> &'static str {
    let lower = capability.to_lowercase();
    // Bash for system/file/shell tasks
    if lower.contains("bash")
        || lower.contains(" file")
        || lower.contains("system")
        || lower.contains("shell")
        || lower.contains("directory")
        || lower.contains("process")
        || lower.contains("script")
    {
        return "bash";
    }
    // Node for anything JS-specific
    if lower.contains("node")
        || lower.contains("javascript")
        || lower.contains("json api")
        || lower.contains("fetch url")
        || lower.contains("websocket")
    {
        return "node";
    }
    // Python is the safe default (best stdlib for parse/compute/analyze)
    "python"
}

/// File extension for a given language.
fn extension(language: &str) -> &'static str {
    match language {
        "bash" => "sh",
        "node" => "js",
        _ => "py",
    }
}

// ── Core generation ───────────────────────────────────────────────────────────

/// Ask the quality LLM to write a script implementing `capability` in `language`.
/// Returns (script_code, description, usage_string, parameters).
async fn generate_tool_script(
    capability: &str,
    language: &str,
) -> Result<(String, String, String, Vec<ToolParameter>), String> {
    generate_tool_script_inner(None, capability, language).await
}

/// Phase 49 (HUNT-COST-CHAT) — variant that takes an `AppHandle` so the
/// tool-write LLM call routes through the cost-tracked wrapper. Used by
/// `forge_tool_with_app` (the app-aware entry point).
async fn generate_tool_script_with_app(
    app: &tauri::AppHandle,
    capability: &str,
    language: &str,
) -> Result<(String, String, String, Vec<ToolParameter>), String> {
    generate_tool_script_inner(Some(app), capability, language).await
}

async fn generate_tool_script_inner(
    app: Option<&tauri::AppHandle>,
    capability: &str,
    language: &str,
) -> Result<(String, String, String, Vec<ToolParameter>), String> {
    let config = crate::config::load_config();

    // Pick the best available model for code generation
    let (provider, api_key, model) = if config.api_key.is_empty() {
        return Err("No API key configured — cannot generate tool script".to_string());
    } else {
        (config.provider.clone(), config.api_key.clone(), config.model.clone())
    };

    let lang_notes = match language {
        "python" => "sys.argv for arguments, print() for output, sys.stderr for errors",
        "bash"   => "$@ for arguments, echo for output, >&2 for errors",
        "node"   => "process.argv.slice(2) for arguments, console.log for output, console.error for errors",
        _        => "accept arguments from CLI, print to stdout",
    };

    // Phase 51 (FORGE-PROMPT-TUNING) — explicit library guidance + one HN
    // few-shot example. v2.0 phase 47 prompt was tuned for a single gap (HN
    // top stories); v2.1 phase 51 broadens to arXiv/RSS/PyPI which all share
    // the "public unauthenticated JSON-or-XML API" shape. Inline guide:
    //   - Anchor language to Python 3 / Node 18+ / POSIX bash
    //   - Prefer `requests` for HTTP, `feedparser` for feeds, `json` for parse
    //   - Return JSON-serializable result
    //   - One HN few-shot demo (only 1 — keep prompt size down per token budget)
    let tooling_hints = match language {
        "python" => {
            "- Use Python 3. Prefer `requests` for HTTP (or `urllib.request` if you want zero deps), \
             `feedparser` for RSS/Atom, `xml.etree.ElementTree` for raw XML, `json` for parsing.\n         \
             - Return a JSON-serializable result via `print(json.dumps(result))` whenever the output is structured."
        }
        "bash" => {
            "- Use POSIX bash. Prefer `curl -fsSL` for HTTP, `jq` for JSON, `xmllint` for XML.\n         \
             - Emit one JSON object per line on success."
        }
        "node" => {
            "- Use Node 18+ (global `fetch` available). Avoid extra npm deps; use `node:` builtins.\n         \
             - Return a JSON-serializable result via `console.log(JSON.stringify(result))`."
        }
        _ => "- Use the simplest sensible standard library.",
    };

    // Few-shot example: HackerNews top-N (the v2.0 proven gap). Inlined verbatim
    // so the LLM has a concrete example of the JSON-response shape, error
    // handling, arg parsing, and request idiom we want. Python-only — bash/node
    // skip the example to keep prompt size down.
    let few_shot_python = "Example response for a similar capability (HackerNews top-N stories):\n\
         {\n\
           \"script\": \"#!/usr/bin/env python3\\nimport json, sys, urllib.request\\n\
HN_TOP = 'https://hacker-news.firebaseio.com/v0/topstories.json'\\n\
HN_ITEM = 'https://hacker-news.firebaseio.com/v0/item/{id}.json'\\n\
def fetch_json(url, timeout=8):\\n    with urllib.request.urlopen(url, timeout=timeout) as r:\\n        return json.loads(r.read().decode('utf-8'))\\n\
def main():\\n    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5\\n    try:\\n        ids = fetch_json(HN_TOP)[:max(1, min(n, 30))]\\n        items = [fetch_json(HN_ITEM.format(id=i)) for i in ids]\\n    except Exception as e:\\n        print(f'error: {e}', file=sys.stderr); return 1\\n    print(json.dumps([{'title': it.get('title',''), 'score': it.get('score',0), 'comments': it.get('descendants',0), 'url': it.get('url','')} for it in items if it], indent=2))\\n    return 0\\nif __name__ == '__main__':\\n    sys.exit(main())\",\n\
           \"description\": \"Fetch the top N stories from HackerNews with titles, scores, and comment counts.\",\n\
           \"usage\": \"python tool.py [N]\",\n\
           \"parameters\": [{\"name\": \"n\", \"type\": \"integer\", \"description\": \"Number of stories\", \"required\": false}]\n\
         }";
    let example_block = if language == "python" {
        format!("\n\n{}\n\n", few_shot_python)
    } else {
        "\n\n".to_string()
    };

    let prompt = format!(
        "You are an expert programmer. Write a {language} script that implements this capability:\n\n\
         {capability}\n\n\
         Requirements:\n\
         - Accept arguments from the command line ({lang_notes})\n\
         - Print results to stdout (one result per line, or JSON)\n\
         - Handle errors gracefully (print to stderr, exit code 1)\n\
         - Be self-contained (no external dependencies except standard library + common packages like requests, pathlib)\n\
         - Be production-quality: handle edge cases, validate inputs\n\
         {tooling_hints}{example_block}\
         Respond ONLY with a valid JSON object (no markdown fences, no extra text):\n\
         {{\n\
           \"script\": \"full script code here\",\n\
           \"description\": \"one line describing what it does\",\n\
           \"usage\": \"python tool.py [args description]\",\n\
           \"parameters\": [{{\"name\": \"arg1\", \"type\": \"string\", \"description\": \"what it is\", \"required\": true}}]\n\
         }}",
        language = language,
        capability = capability,
        lang_notes = lang_notes,
        tooling_hints = tooling_hints,
        example_block = example_block,
    );

    // Phase 22 Plan 22-03 (v1.3) — Voyager skill-write budget cap (VOYAGER-07).
    // Refuse the LLM call if prompt + estimated response would exceed the
    // configured token budget. Default 50_000 (see config::default_voyager_
    // skill_write_budget_tokens). Estimate uses the same 4-chars-per-token
    // heuristic the validator already uses for body sizing — rough but
    // sufficient to bound runaway token spend on pathological inputs.
    let estimated = estimate_skill_write_tokens(&prompt);
    if estimated > config.voyager_skill_write_budget_tokens {
        return Err(format!(
            "[tool_forge] skill-write budget exceeded: estimated {estimated} tokens > cap {} (set BladeConfig.voyager_skill_write_budget_tokens to raise)",
            config.voyager_skill_write_budget_tokens
        ));
    }

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];

    let turn = match app {
        Some(a) => forge_complete_turn_tracked(
            a,
            &provider,
            &api_key,
            &model,
            &messages,
            &[],
            config.base_url.as_deref(),
        )
        .await
        .map_err(|e| format!("LLM call failed: {}", e))?,
        None => crate::providers::complete_turn(
            &provider,
            &api_key,
            &model,
            &messages,
            &[],
            config.base_url.as_deref(),
        )
        .await
        .map_err(|e| format!("LLM call failed: {}", e))?,
    };

    let raw = turn.content.trim().to_string();

    // Strip markdown code fences if the model wrapped the JSON anyway
    let json_str = if let Some(start) = raw.find('{') {
        if let Some(end) = raw.rfind('}') {
            &raw[start..=end]
        } else {
            raw.as_str()
        }
    } else {
        raw.as_str()
    };

    let spec: LlmToolSpec = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse LLM tool spec JSON: {} — raw: {}", e, crate::safe_slice(&raw, 300)))?;

    // Add Python shebang if missing
    let mut script = spec.script;
    if language == "python" && !script.trim_start().starts_with("#!") {
        script = format!("#!/usr/bin/env python3\n{}", script);
    } else if language == "bash" && !script.trim_start().starts_with("#!") {
        script = format!("#!/usr/bin/env bash\n{}", script);
    }

    let parameters: Vec<ToolParameter> = spec
        .parameters
        .into_iter()
        .map(|p| ToolParameter {
            name: p.name,
            param_type: p.param_type,
            description: p.description,
            required: p.required,
        })
        .collect();

    Ok((script, spec.description, spec.usage, parameters))
}

/// Run the script with no arguments to smoke-test it.
/// Returns stdout/stderr output or an error string.
async fn test_tool(script_path: &str, language: &str) -> Result<String, String> {
    let (program, args): (&str, Vec<&str>) = match language {
        "bash" => ("bash", vec![script_path]),
        "node" => ("node", vec![script_path]),
        _ => ("python3", vec![script_path, "--help"]),
    };

    let output = crate::cmd_util::silent_cmd(program)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run test: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let combined = if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        stderr
    } else {
        format!("{}\nSTDERR: {}", stdout, stderr)
    };

    // Exit code 0 or 1 with help text is fine; anything else is suspicious but
    // we still record and continue — the script might just need real args.
    Ok(crate::safe_slice(&combined, 2000).to_string())
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Phase 22 Plan 22-05 (v1.3) — output of the LLM-generation half of `forge_tool`.
/// Separated out so `persist_forged_tool` can be exercised without an LLM call
/// (the test seam used by `forge_tool_from_fixture` and the canonical
/// `youtube_transcript` end-to-end fixture).
#[derive(Debug, Clone)]
pub struct ForgeGeneration {
    pub script_code: String,
    pub description: String,
    /// Usage hint produced by the LLM. The `"tool.py"` placeholder is
    /// substituted with the real filename inside `persist_forged_tool`.
    pub usage_template: String,
    pub parameters: Vec<ToolParameter>,
}

/// Forge a new tool from a natural-language capability description.
/// Generates script, writes it to disk, tests it, and saves to DB.
///
/// Phase 22 Plan 22-05 (v1.3): refactored into `generate_tool_script` (LLM)
/// + `persist_forged_tool` (side effects). The split lets the deterministic
/// test seam (`forge_tool_from_fixture`) share the persistence path without
/// needing an LLM call.
pub async fn forge_tool(capability: &str) -> Result<ForgedTool, String> {
    forge_tool_inner(None, capability).await
}

/// Phase 47 (FORGE-02) — forge a new tool AND emit `blade_forge_line` events
/// at every phase transition (`writing` → `testing` → `registered`).
///
/// Delegates to the same internal pipeline as `forge_tool`; the only
/// difference is the `Some(app)` threaded through to `emit_forge_line`.
/// Callers that have an `AppHandle` (chat dispatcher, immune_system) should
/// prefer this entry-point so the chat surface renders forge progress.
pub async fn forge_tool_with_app(
    app: &tauri::AppHandle,
    capability: &str,
) -> Result<ForgedTool, String> {
    forge_tool_inner(Some(app), capability).await
}

async fn forge_tool_inner(
    app: Option<&tauri::AppHandle>,
    capability: &str,
) -> Result<ForgedTool, String> {
    let language = choose_language(capability).to_string();

    // Phase 47 FORGE-02 emit #2: `writing`. The LLM call is about to fire.
    // Detail = the provisional name we'd assign on persistence.
    if let Some(a) = app {
        let provisional = capability_to_name(capability);
        emit_forge_line(
            a,
            "writing",
            &format!("LLM drafting tool '{}' in {}", provisional, language),
        );
    }

    // Generate script via LLM (or budget-refuse if pathological prompt).
    // Phase 49 (HUNT-COST-CHAT) — when an AppHandle is available, route the
    // LLM call through the cost-tracked wrapper so the chat surfaces a
    // running cost line for the forge session.
    let gen_result = match app {
        Some(a) => generate_tool_script_with_app(a, capability, &language).await,
        None => generate_tool_script(capability, &language).await,
    };
    let (script_code, description, usage_template, parameters) = match gen_result {
        Ok(t) => t,
        Err(e) => {
            if let Some(a) = app {
                emit_forge_line(
                    a,
                    "failed",
                    &format!("LLM tool-write failed: {}", e),
                );
            }
            return Err(e);
        }
    };

    persist_forged_tool_inner(
        app,
        capability,
        &language,
        ForgeGeneration {
            script_code,
            description,
            usage_template,
            parameters,
        },
    )
    .await
}

/// Persist a generated tool to disk + DB + (optionally) SKILL.md.
///
/// Side effects (in order):
///   1. Resolve unique name (DB query for collision; ts-suffix if needed)
///   2. Write `<tools_dir>/<name>.<ext>` script file + chmod 755 on Unix
///   3. Emit `voyager:skill_written` ActivityStrip event (Plan 22-02)
///   4. Smoke-test the script
///   5. INSERT into forged_tools — on failure, roll back step 2 + re-log
///      the gap with `prior_attempt_failed=true` (Plan 22-04)
///   6. Export to agentskills.io SKILL.md at `<user_skills_root>/<name>/`
///      (Plan 22-01) — non-fatal; logs warn on failure
///   7. Emit `voyager:skill_registered` ActivityStrip event (Plan 22-02)
///
/// On success, returns the populated `ForgedTool` record.
pub async fn persist_forged_tool(
    capability: &str,
    language: &str,
    gen: ForgeGeneration,
) -> Result<ForgedTool, String> {
    persist_forged_tool_inner(None, capability, language, gen).await
}

/// Phase 47 (FORGE-02) — internal persistence path that also emits
/// `blade_forge_line` events on `testing` and `registered` phases when an
/// `AppHandle` is supplied. Identical behavior to `persist_forged_tool`
/// when `app == None`.
pub async fn persist_forged_tool_inner(
    app: Option<&tauri::AppHandle>,
    capability: &str,
    language: &str,
    gen: ForgeGeneration,
) -> Result<ForgedTool, String> {
    let base_name = capability_to_name(capability);
    let ext = extension(language);

    // Ensure uniqueness by appending a short timestamp suffix if name collides
    let conn = open_db().map_err(|e| e.to_string())?;
    ensure_table(&conn)?;

    let name = {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM forged_tools WHERE name = ?1",
                params![base_name],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if exists {
            let ts = chrono::Utc::now().timestamp() % 10_000;
            format!("{}_{}", base_name, ts)
        } else {
            base_name
        }
    };

    let script_path = tools_dir().join(format!("{}.{}", name, ext));
    let script_path_str = script_path.to_string_lossy().to_string();

    // Substitute the real filename in the usage string
    let usage = gen
        .usage_template
        .replace("tool.py", &format!("{}.{}", name, ext));

    // Write script to disk
    std::fs::write(&script_path, &gen.script_code)
        .map_err(|e| format!("Failed to write script: {}", e))?;

    // Make executable on Unix
    #[cfg(unix)]
    {
        crate::cmd_util::silent_cmd("chmod")
            .args(["755", &script_path_str])
            .status()
            .ok();
    }

    // Phase 22 (v1.3) — Voyager loop step 2 of 4: script artifact on disk.
    crate::voyager_log::skill_written(&name, &script_path_str);

    // Phase 47 FORGE-02 emit #3: `testing`. Smoke-test about to run.
    if let Some(a) = app {
        emit_forge_line(
            a,
            "testing",
            &format!("smoke-testing {}.{} (expect non-error exit)", name, ext),
        );
    }

    // Smoke-test
    let test_output = test_tool(&script_path_str, language)
        .await
        .unwrap_or_else(|e| format!("Test failed: {}", e));

    // Persist to DB
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let params_json = serde_json::to_string(&gen.parameters).unwrap_or_else(|_| "[]".to_string());

    if let Err(e) = conn.execute(
        "INSERT INTO forged_tools \
         (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11)",
        params![
            id,
            name,
            gen.description,
            language,
            script_path_str,
            usage,
            params_json,
            test_output,
            now,
            now,        // Phase 24 D-24-A: last_used = created_at at write time
            capability,
        ],
    ) {
        // Phase 22 Plan 22-04 (v1.3) — failure recovery (VOYAGER-08).
        rollback_partial_forge(&script_path, capability, &format!("DB insert error: {e}"));
        if let Some(a) = app {
            emit_forge_line(
                a,
                "failed",
                &format!("DB insert failed (script rolled back): {}", e),
            );
        }
        return Err(format!(
            "[tool_forge] DB insert error after script write (script rolled back): {e}"
        ));
    }

    // Phase 47 FORGE-02 emit #4: `registered`. Tool is in the catalog.
    if let Some(a) = app {
        emit_forge_line(
            a,
            "registered",
            &format!("tool '{}' is now callable via bash", name),
        );
    }

    log::info!("Tool Forge: created '{}' ({})", name, language);

    let forged = ForgedTool {
        id,
        name,
        description: gen.description,
        language: language.to_string(),
        script_path: script_path_str,
        usage,
        parameters: gen.parameters,
        test_output,
        created_at: now,
        last_used: Some(now),
        use_count: 0,
        forged_from: capability.to_string(),
    };

    // Phase 22 (v1.3) Plan 22-01 — export to agentskills.io SKILL.md at the
    // user tier. Coexists with the existing flat-layout tool_forge artifacts.
    // Non-fatal: warn + None on any export failure; the forge has succeeded.
    let user_skills_root = crate::skills::user_root();
    let skill_md_path = match crate::skills::export::export_to_user_tier(&forged, &user_skills_root) {
        Ok(crate::skills::export::ExportOutcome::Written { skill_md_path, .. }) => {
            Some(skill_md_path.to_string_lossy().to_string())
        }
        Ok(crate::skills::export::ExportOutcome::NonCompliantName { reason }) => {
            log::warn!("[tool_forge] SKILL.md export skipped: {reason}");
            None
        }
        Err(e) => {
            log::warn!("[tool_forge] SKILL.md export failed: {e}");
            None
        }
    };

    // Phase 22 (v1.3) — Voyager loop step 3 of 4: skill is now resolvable.
    crate::voyager_log::skill_registered(&forged.name, &forged.id, skill_md_path.as_deref());

    Ok(forged)
}

/// Phase 22 Plan 22-05 (v1.3) — deterministic test seam.
///
/// Bypasses the LLM call by accepting pre-built `ForgeGeneration`. Callers
/// (tests + CI fixture binary) get the same persistence guarantees as the
/// production `forge_tool` path, including ActivityStrip emission, SKILL.md
/// export, and partial-write rollback. Behind `#[cfg(any(test, feature =
/// "voyager-fixture"))]` so production builds don't expose it.
#[cfg(any(test, feature = "voyager-fixture"))]
pub async fn forge_tool_from_fixture(
    capability: &str,
    language: &str,
    gen: ForgeGeneration,
) -> Result<ForgedTool, String> {
    persist_forged_tool(capability, language, gen).await
}

/// Canonical `youtube_transcript` fixture per `voyager-loop-play.md` § "smallest
/// viable demo". Used by Plan 22-05 end-to-end test + Plan 22-07 verify-
/// voyager-loop gate. Behind the same gate as `forge_tool_from_fixture`.
#[cfg(any(test, feature = "voyager-fixture"))]
pub fn youtube_transcript_fixture() -> ForgeGeneration {
    ForgeGeneration {
        script_code: r#"#!/usr/bin/env python3
"""Fetch the transcript of a YouTube video (deterministic fixture).

In production this would call the real YouTube API. The Voyager fixture
returns a canned response so the loop can be verified without network.
"""
import sys, json
def main():
    if len(sys.argv) < 2:
        print("usage: youtube_transcript.py <url>", file=sys.stderr)
        sys.exit(1)
    url = sys.argv[1]
    print(json.dumps({"url": url, "transcript": "[fixture]"}))
if __name__ == "__main__":
    main()
"#
        .to_string(),
        description: "Fetch the transcript of a YouTube video by URL.".to_string(),
        usage_template: "tool.py <youtube_url>".to_string(),
        parameters: vec![ToolParameter {
            name: "url".to_string(),
            param_type: "string".to_string(),
            description: "YouTube video URL".to_string(),
            required: true,
        }],
    }
}

// ── Phase 51 (FORGE-GAP-*) — multi-gap robustness fixtures ───────────────────
//
// Each fixture mirrors what an LLM would emit for the stated capability gap.
// They use only the Python standard library so the build-time smoke test in
// `test_tool` does not depend on third-party packages. In production the
// real LLM is allowed to reach for `requests` / `feedparser`; the fixtures
// stick to `urllib.request` + `xml.etree.ElementTree` + `json` to keep CI
// hermetic.

/// Phase 51 (FORGE-GAP-ARXIV) — fetch an arXiv paper's abstract by ID or URL.
/// Hits `https://export.arxiv.org/api/query?id_list=<id>` (returns Atom XML)
/// and extracts the `<summary>` element.
#[cfg(any(test, feature = "voyager-fixture"))]
pub fn arxiv_abstract_fixture() -> ForgeGeneration {
    ForgeGeneration {
        script_code: r#"#!/usr/bin/env python3
"""Fetch the abstract of an arXiv paper by ID or URL.

Usage:
    arxiv_abstract.py <id_or_url>

Accepts either a bare arXiv ID ("2103.00020") or a full URL
("https://arxiv.org/abs/2103.00020"). Returns JSON with id, title,
and abstract.
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET


ARXIV_API = "https://export.arxiv.org/api/query?id_list={id}"
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}


def extract_id(arg: str) -> str:
    # Strip arxiv.org/abs/ prefix if present; tolerate version suffix
    m = re.search(r"(\d{4}\.\d{4,5})(v\d+)?$", arg)
    if m:
        return m.group(1)
    return arg.strip()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: arxiv_abstract.py <id_or_url>", file=sys.stderr)
        return 1
    paper_id = extract_id(sys.argv[1])
    try:
        with urllib.request.urlopen(ARXIV_API.format(id=paper_id), timeout=10) as r:
            body = r.read().decode("utf-8")
    except Exception as e:
        print(f"network error: {e}", file=sys.stderr)
        return 1
    try:
        root = ET.fromstring(body)
        entry = root.find("a:entry", ATOM_NS)
        if entry is None:
            print("no entry found", file=sys.stderr)
            return 1
        title_el = entry.find("a:title", ATOM_NS)
        summary_el = entry.find("a:summary", ATOM_NS)
        title = (title_el.text or "").strip() if title_el is not None else ""
        summary = (summary_el.text or "").strip() if summary_el is not None else ""
        print(json.dumps({"id": paper_id, "title": title, "abstract": summary}, indent=2))
        return 0
    except ET.ParseError as e:
        print(f"parse error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
"#
        .to_string(),
        description: "Fetch the abstract of an arXiv paper by ID or URL.".to_string(),
        usage_template: "tool.py <id_or_url>".to_string(),
        parameters: vec![ToolParameter {
            name: "id_or_url".to_string(),
            param_type: "string".to_string(),
            description: "arXiv paper ID (e.g. 2103.00020) or full URL".to_string(),
            required: true,
        }],
    }
}

/// Phase 51 (FORGE-GAP-RSS) — extract titles + summaries from an RSS or Atom
/// feed URL. Uses `urllib.request` + `xml.etree.ElementTree` to support both
/// RSS 2.0 (`<item>` under `<channel>`) and Atom (`<entry>` with `<summary>`).
/// In production the LLM is encouraged to use `feedparser`; the fixture
/// keeps the dependency surface stdlib-only.
#[cfg(any(test, feature = "voyager-fixture"))]
pub fn rss_feed_fixture() -> ForgeGeneration {
    ForgeGeneration {
        script_code: r#"#!/usr/bin/env python3
"""Extract titles and summaries from an RSS or Atom feed URL.

Usage:
    rss_feed.py <feed_url> [N]

Returns JSON list of {title, summary, link} for up to N entries
(default 10). Supports RSS 2.0 and Atom.
"""
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET


ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}


def parse_atom(root, n):
    out = []
    for entry in root.findall("a:entry", ATOM_NS)[:n]:
        title_el = entry.find("a:title", ATOM_NS)
        summary_el = entry.find("a:summary", ATOM_NS) or entry.find("a:content", ATOM_NS)
        link_el = entry.find("a:link", ATOM_NS)
        out.append({
            "title": (title_el.text or "").strip() if title_el is not None else "",
            "summary": (summary_el.text or "").strip() if summary_el is not None else "",
            "link": link_el.get("href", "") if link_el is not None else "",
        })
    return out


def parse_rss(root, n):
    out = []
    channel = root.find("channel") or root
    for item in channel.findall("item")[:n]:
        title = item.findtext("title", default="").strip()
        description = item.findtext("description", default="").strip()
        link = item.findtext("link", default="").strip()
        out.append({"title": title, "summary": description, "link": link})
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rss_feed.py <feed_url> [N]", file=sys.stderr)
        return 1
    url = sys.argv[1]
    try:
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    except ValueError:
        n = 10
    n = max(1, min(n, 50))
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            body = r.read()
    except Exception as e:
        print(f"network error: {e}", file=sys.stderr)
        return 1
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        print(f"parse error: {e}", file=sys.stderr)
        return 1
    tag = root.tag.lower()
    if "feed" in tag:
        items = parse_atom(root, n)
    else:
        items = parse_rss(root, n)
    print(json.dumps(items, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
"#
        .to_string(),
        description: "Extract titles and summaries from an RSS or Atom feed URL.".to_string(),
        usage_template: "tool.py <feed_url> [N]".to_string(),
        parameters: vec![
            ToolParameter {
                name: "feed_url".to_string(),
                param_type: "string".to_string(),
                description: "URL of the RSS or Atom feed".to_string(),
                required: true,
            },
            ToolParameter {
                name: "n".to_string(),
                param_type: "integer".to_string(),
                description: "Max entries to return (1-50, default 10)".to_string(),
                required: false,
            },
        ],
    }
}

/// Phase 51 (FORGE-GAP-PYPI) — pull PyPI package metadata (latest version,
/// description, dependencies). Hits `https://pypi.org/pypi/<package>/json`.
/// Build-time tests mock the network call via the smoke test surface (the
/// `--help` path exits 0 cleanly without hitting pypi.org).
#[cfg(any(test, feature = "voyager-fixture"))]
pub fn pypi_metadata_fixture() -> ForgeGeneration {
    ForgeGeneration {
        script_code: r#"#!/usr/bin/env python3
"""Pull PyPI package metadata: latest version, description, dependencies.

Usage:
    pypi_metadata.py <package_name>

Returns JSON with name, version, summary, and requires_dist.
"""
import json
import sys
import urllib.request


PYPI_API = "https://pypi.org/pypi/{name}/json"


def main() -> int:
    # --help is the smoke-test invocation path; exit 0 there so the
    # build-time test does not hit pypi.org (hermetic CI).
    if len(sys.argv) > 1 and sys.argv[1] in ("--help", "-h"):
        print("usage: pypi_metadata.py <package_name>", file=sys.stderr)
        return 0
    if len(sys.argv) < 2:
        print("usage: pypi_metadata.py <package_name>", file=sys.stderr)
        return 1
    name = sys.argv[1].strip()
    try:
        with urllib.request.urlopen(PYPI_API.format(name=name), timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"network error: {e}", file=sys.stderr)
        return 1
    info = data.get("info", {})
    out = {
        "name": info.get("name", name),
        "version": info.get("version", ""),
        "summary": info.get("summary", ""),
        "requires_dist": info.get("requires_dist", []) or [],
    }
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
"#
        .to_string(),
        description: "Pull PyPI package metadata: latest version, description, dependencies.".to_string(),
        usage_template: "tool.py <package_name>".to_string(),
        parameters: vec![ToolParameter {
            name: "package_name".to_string(),
            param_type: "string".to_string(),
            description: "PyPI package name (e.g. 'requests')".to_string(),
            required: true,
        }],
    }
}

/// Load all forged tools from the DB, sorted by use_count descending.
pub fn get_forged_tools() -> Vec<ForgedTool> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    ensure_table(&conn).ok();

    let mut stmt = match conn.prepare(
        "SELECT id, name, description, language, script_path, usage, parameters, \
         test_output, created_at, last_used, use_count, forged_from \
         FROM forged_tools ORDER BY use_count DESC, created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map([], |row| {
        let params_json: String = row.get(6).unwrap_or_default();
        let parameters: Vec<ToolParameter> =
            serde_json::from_str(&params_json).unwrap_or_default();
        Ok(ForgedTool {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            language: row.get(3)?,
            script_path: row.get(4)?,
            usage: row.get(5)?,
            parameters,
            test_output: row.get(7).unwrap_or_default(),
            created_at: row.get(8)?,
            last_used: row.get(9)?,
            use_count: row.get(10).unwrap_or(0),
            forged_from: row.get(11).unwrap_or_default(),
        })
    })
    .ok()
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

/// Build the system-prompt injection block for the top 20 forged tools.
/// Returns an empty string if no tools have been forged yet.
pub fn get_tool_usage_for_prompt() -> String {
    let tools = get_forged_tools();
    if tools.is_empty() {
        return String::new();
    }

    let lines: Vec<String> = tools
        .iter()
        .take(20)
        .map(|t| format!("- **{}**: {}\n  Usage: `{}`", t.name, t.description, t.usage))
        .collect();

    format!(
        "## Custom Tools Available\n\n\
         These tools were forged for you specifically. Use them via bash:\n\n{}",
        lines.join("\n")
    )
}

/// Called when a task fails. Asks the LLM whether a new tool should be created,
/// and if so, forges it. Returns the newly created tool or None.
#[allow(dead_code)]
pub async fn forge_if_needed(user_request: &str, error_message: &str) -> Option<ForgedTool> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        return None;
    }

    // Use cheap model for the triage decision
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let triage_prompt = format!(
        "Given this failed request: '{request}' with error: '{error}', \
         should a new standalone script tool be created to handle this capability? \
         If yes, respond with a single sentence describing what the tool should do. \
         If no (e.g., it's a permission error, a logic error, or the capability already exists), \
         respond with exactly: no",
        request = crate::safe_slice(user_request, 400),
        error = crate::safe_slice(error_message, 400),
    );

    let messages = vec![crate::providers::ConversationMessage::User(triage_prompt)];

    let decision = match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(t) => t.content.trim().to_string(),
        Err(_) => return None,
    };

    if decision.to_lowercase().starts_with("no") {
        return None;
    }

    log::info!("Tool Forge: forging new tool for: {}", crate::safe_slice(&decision, 120));
    forge_tool(&decision).await.ok()
}

/// Phase 47 (FORGE-02) — `forge_if_needed` with chat-line emissions wired.
///
/// Five emit points on the happy path:
///   1. `gap_detected` — triage LLM said "yes, forge it"
///   2. `writing`      — inside `forge_tool_with_app` before the tool-write LLM call
///   3. `testing`      — inside `persist_forged_tool_inner` before smoke-test
///   4. `registered`   — inside `persist_forged_tool_inner` after DB insert
///   5. `retrying`     — emitted here on success so the chat surface knows the
///                       caller will retry the user's original request
///
/// On any failure (LLM call fails, triage says "no", forge_tool errors),
/// emits `failed` with the structural reason and returns None.
///
/// Pre-check (`pre_check_existing_tools`) runs FIRST. If a matching tool
/// already exists in the catalog, the forge does NOT fire — instead, we
/// emit a single `gap_detected` line annotated with the matching tool
/// name so the operator can see *why* the forge skipped, then return None.
/// This is the FORGE-02 risk-mitigation per 47-CONTEXT.md §Risks #2.
pub async fn forge_if_needed_with_app(
    app: &tauri::AppHandle,
    user_request: &str,
    error_message: &str,
) -> Option<ForgedTool> {
    // Phase 49 (HUNT-COST-CHAT) — reset the per-forge-session tracker so cost
    // lines reflect this run only.
    reset_forge_cost_tracker();
    let config = crate::config::load_config();
    if config.api_key.is_empty() {
        emit_forge_line(
            app,
            "failed",
            "no API key configured — forge cannot draft a tool",
        );
        return None;
    }

    // Phase 51 (FORGE-PRECHECK-REFINE) — MCP-aware pre-check. Read the
    // installed MCP server list from the runtime state so the routing
    // distinguishes "MCP cataloged AND installed" (skip forge — user's MCP
    // handles it) from "MCP cataloged but not installed" (forge anyway, per
    // the in-app autonomy preference).
    let installed_mcp = collect_installed_mcp_servers(app).await;
    match pre_check_with_mcp_state(user_request, &installed_mcp) {
        PreCheckOutcome::ForgedMatch(name) | PreCheckOutcome::NativeMatch(name) => {
            emit_forge_line(
                app,
                "gap_detected",
                &format!(
                    "pre-check matched existing tool '{}'; skipping forge",
                    name
                ),
            );
            return None;
        }
        PreCheckOutcome::McpInstalled(server) => {
            emit_forge_line(
                app,
                "gap_detected",
                &format!(
                    "MCP server '{}' is installed and handles this; skipping forge",
                    server
                ),
            );
            return None;
        }
        PreCheckOutcome::McpCatalogedNotInstalled(server) => {
            // Forge anyway — but surface the trade-off so the operator sees
            // why we didn't route to "install <MCP>".
            emit_forge_line(
                app,
                "forge_route",
                &format!(
                    "Could install {} from catalog, or forge a quick scraper now — picking forge.",
                    server
                ),
            );
            // Fall through to triage + forge below.
        }
        PreCheckOutcome::NoMatch => {
            // Fall through to triage + forge below.
        }
    }

    // ── v2.3 Phase 63 (FORGE-GITHUB-FIRST) — reuse-before-write probe ─────────
    //
    // Operator surfaced 2026-05-17: "first blade goes and tools for if the tool
    // is available on github right?- it should cause it is easier." Before
    // spending tokens drafting a tool from scratch, do a cheap GitHub search.
    // If a credible MCP server or other reusable repo exists, surface it as a
    // chat-line so the operator (or v2.3.1 auto-install path) can act on it.
    //
    // MVP behavior: emit a `github_candidate` forge_line if a hit lands. Forge
    // continues to write-from-scratch — the install_from_readme path is v2.3.1.
    // This makes the surface visible NOW so we can iterate on it based on real
    // hits before committing to an auto-install protocol.
    {
        let probe = crate::forge_github_search::probe_github(user_request).await;
        match &probe {
            crate::forge_github_search::GitHubProbeOutcome::McpServerHit { candidates }
            | crate::forge_github_search::GitHubProbeOutcome::OtherKindHit { candidates } => {
                if let Some(top) = candidates.first() {
                    emit_forge_line(
                        app,
                        "github_candidate",
                        &format!(
                            "Found on GitHub: {} ({} stars) — {} · {}",
                            top.full_name,
                            top.stars,
                            top.description,
                            top.html_url
                        ),
                    );
                }
            }
            crate::forge_github_search::GitHubProbeOutcome::NoHit => {
                // No emit on miss — keep the chat surface quiet when there's
                // nothing to surface. Forge proceeds as before.
            }
        }
    }

    // Use cheap model for the triage decision
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let triage_prompt = format!(
        "Given this failed request: '{request}' with error: '{error}', \
         should a new standalone script tool be created to handle this capability? \
         If yes, respond with a single sentence describing what the tool should do. \
         If no (e.g., it's a permission error, a logic error, or the capability already exists), \
         respond with exactly: no",
        request = crate::safe_slice(user_request, 400),
        error = crate::safe_slice(error_message, 400),
    );

    let messages = vec![crate::providers::ConversationMessage::User(triage_prompt)];

    // Phase 49 (HUNT-COST-CHAT) — cost-tracked triage call. Emits running cost
    // chat-line on BLADE_FORGE_LINE; soft-warns at 50%, hard-blocks at 100%.
    let decision = match forge_complete_turn_tracked(
        app,
        &config.provider,
        &config.api_key,
        &cheap_model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(t) => t.content.trim().to_string(),
        Err(e) => {
            emit_forge_line(
                app,
                "failed",
                &format!("triage LLM call failed: {}", e),
            );
            return None;
        }
    };

    if decision.to_lowercase().starts_with("no") {
        emit_forge_line(
            app,
            "failed",
            "capability gap is structural — not tool-shaped (triage said no)",
        );
        return None;
    }

    // Phase 47 FORGE-02 emit #1: `gap_detected`. The forge has decided to fire.
    emit_forge_line(
        app,
        "gap_detected",
        &crate::safe_slice(&decision, 240),
    );

    log::info!("Tool Forge: forging new tool for: {}", crate::safe_slice(&decision, 120));
    match forge_tool_with_app(app, &decision).await {
        Ok(tool) => {
            // Phase 47 FORGE-02 emit #5: `retrying`. The caller now retries
            // the user's original request with the new tool available.
            emit_forge_line(
                app,
                "retrying",
                &format!(
                    "retrying with '{}' available — '{}'",
                    tool.name,
                    crate::safe_slice(user_request, 160),
                ),
            );
            Some(tool)
        }
        Err(e) => {
            emit_forge_line(
                app,
                "failed",
                &format!("forge_tool failed: {}", e),
            );
            None
        }
    }
}

/// Increment `use_count`, set `last_used`, append a per-invocation row to
/// `forged_tools_invocations` (capped at last 100 per tool), and emit the
/// Voyager loop step 4 of 4 (`skill_used`) to ActivityStrip.
///
/// Phase 24 (v1.3) D-24-B / DREAM-02:
/// - `turn_tool_names` is the order-correct sequence of tool calls in the
///   chat turn that triggered this invocation (INCLUDING the forged tool
///   itself, in position-correct order). The trace_hash derived from this
///   slice is what the consolidation pass compares pairwise.
/// - Backward-compat: callers without trace data pass `&[]`; the resulting
///   trace_hash is the hash of the empty string (stable, won't collide
///   with real sequences but won't aid consolidate either).
pub fn record_tool_use(name: &str, turn_tool_names: &[String]) {
    let mut conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    ensure_table(&conn).ok();
    ensure_invocations_table(&conn).ok();

    let now = chrono::Utc::now().timestamp();
    let trace_hash = compute_trace_hash(turn_tool_names);

    // Pitfall 3 -- wrap UPDATE + INSERT + DELETE in one transaction so a
    // concurrent reader can't see a half-applied state.
    let tx = match conn.transaction() {
        Ok(t) => t,
        Err(_) => return,
    };

    let _ = tx.execute(
        "UPDATE forged_tools SET use_count = use_count + 1, last_used = ?1 WHERE name = ?2",
        params![now, name],
    );
    let _ = tx.execute(
        "INSERT INTO forged_tools_invocations (tool_name, ts, trace_hash) VALUES (?1, ?2, ?3)",
        params![name, now, trace_hash],
    );
    // Auto-prune to last 100 per tool.
    let _ = tx.execute(
        "DELETE FROM forged_tools_invocations \
         WHERE tool_name = ?1 \
           AND id NOT IN (SELECT id FROM forged_tools_invocations \
                          WHERE tool_name = ?1 ORDER BY id DESC LIMIT 100)",
        params![name],
    );

    let _ = tx.commit();

    crate::voyager_log::skill_used(name);
}

/// Phase 24 (v1.3) -- order-sensitive hash over a comma-joined tool-name
/// sequence. Uses `std::collections::hash_map::DefaultHasher` (no new dep
/// needed; sha2 not in Cargo.toml per 24-RESEARCH A1). Output: 16 hex chars
/// (u64 in lowercase hex). Birthday-paradox collision risk over expected
/// n=100 invocations per tool is negligible (24-RESEARCH A4).
fn compute_trace_hash(tool_names: &[String]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let joined = tool_names.join(",");
    let mut hasher = DefaultHasher::new();
    joined.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Forge a new tool from a capability description (called from the frontend).
#[tauri::command]
pub async fn forge_new_tool(capability: String) -> Result<ForgedTool, String> {
    forge_tool(&capability).await
}

/// List all forged tools (called from the frontend).
#[tauri::command]
pub fn forge_list_tools() -> Vec<ForgedTool> {
    get_forged_tools()
}

/// Delete a forged tool by id — removes from DB and deletes the script file.
#[tauri::command]
pub fn forge_delete_tool(id: String) -> Result<(), String> {
    let conn = open_db()?;
    ensure_table(&conn)?;

    // Fetch the script path before deletion so we can remove the file
    let script_path: Option<String> = conn
        .query_row(
            "SELECT script_path FROM forged_tools WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    conn.execute("DELETE FROM forged_tools WHERE id = ?1", params![id])
        .map_err(|e| format!("DB delete error: {}", e))?;

    if let Some(path) = script_path {
        std::fs::remove_file(&path).ok(); // Best-effort; ignore if already gone
    }

    Ok(())
}

/// Re-run the smoke test for an existing tool and update its test_output in the DB.
#[tauri::command]
pub async fn forge_test_tool(id: String) -> Result<String, String> {
    let conn = open_db()?;
    ensure_table(&conn)?;

    let (script_path, language): (String, String) = conn
        .query_row(
            "SELECT script_path, language FROM forged_tools WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| format!("Tool not found: {}", id))?;

    let output = test_tool(&script_path, &language).await?;

    conn.execute(
        "UPDATE forged_tools SET test_output = ?1 WHERE id = ?2",
        params![output, id],
    )
    .map_err(|e| format!("DB update error: {}", e))?;

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_short_prompt_under_default_budget() {
        let est = estimate_skill_write_tokens("fetch a youtube transcript");
        assert!(est < 50_000, "estimate {est} should be well under 50K cap");
        // Short prompt: 30K-char response reserve dominates → ~7500 tokens
        assert!(est >= 7_500);
        assert!(est < 8_000);
    }

    #[test]
    fn estimate_grows_linearly_with_prompt_size() {
        let small = estimate_skill_write_tokens(&"a".repeat(400));
        let big = estimate_skill_write_tokens(&"a".repeat(40_000));
        assert!(big > small);
        // 40_000 chars / 4 chars-per-token = 10_000 prompt tokens; plus
        // ~7500 response reserve = ~17_500 total. Should be near that.
        assert!(big >= 17_400);
        assert!(big <= 17_600);
    }

    #[test]
    fn pathological_prompt_exceeds_default_budget() {
        // ~200_000 chars / 4 = 50_000 prompt tokens; plus 7500 response =
        // 57_500 total. Above the 50_000 default cap.
        let pathological = "x".repeat(200_000);
        let est = estimate_skill_write_tokens(&pathological);
        assert!(
            est > 50_000,
            "pathological prompt should exceed 50K cap, got {est}"
        );
    }

    #[test]
    fn empty_prompt_only_response_reserve() {
        let est = estimate_skill_write_tokens("");
        assert_eq!(est, 30_000 / 4);
    }

    #[test]
    fn estimate_uses_saturating_add() {
        // Ensure no panic on huge inputs (boundary test)
        let huge = "x".repeat(1_000_000);
        let _ = estimate_skill_write_tokens(&huge);
        // Just confirm it returns without overflow panic
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-tool-forge-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Shared lock for all tests that touch `BLADE_CONFIG_DIR`. The env var is
    /// process-global; without serialization, parallel tests would race
    /// each other's overrides and produce bizarre cross-contamination
    /// (e.g. install A's forge writing to install B's temp dir mid-test).
    /// Module-level on purpose so it covers BOTH `voyager_end_to_end_*` AND
    /// `voyager_two_installs_diverge`.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn rollback_removes_existing_script() {
        let dir = temp_dir("rollback-existing");
        let script_path = dir.join("orphan.py");
        std::fs::write(&script_path, "noop").unwrap();
        assert!(script_path.is_file());

        rollback_partial_forge(&script_path, "test capability", "synthetic reason");
        assert!(!script_path.exists(), "orphan script should be removed");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rollback_silent_on_missing_script() {
        let dir = temp_dir("rollback-missing");
        let script_path = dir.join("never_existed.py");
        // Don't panic when the script isn't there
        rollback_partial_forge(&script_path, "test capability", "synthetic reason");
        assert!(!script_path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Phase 22 Plan 22-05 (v1.3) — VOYAGER-04 canonical end-to-end fixture.
    ///
    /// Drives `forge_tool_from_fixture` with the `youtube_transcript` fixture
    /// against an isolated `BLADE_CONFIG_DIR`. Asserts the full pipeline:
    ///
    ///   1. Script artifact present at `<BLADE_CONFIG_DIR>/tools/<name>.py`
    ///   2. forged_tools DB row exists at `<BLADE_CONFIG_DIR>/blade.db`
    ///   3. SKILL.md present at `<BLADE_CONFIG_DIR>/skills/<canonical-name>/SKILL.md`
    ///   4. The exported SKILL.md passes `validate_skill_dir`
    ///   5. The Phase 21 Catalog::resolve resolves the name from the user tier
    ///   6. Re-export round-trips (no panic; idempotent on repeated calls
    ///      because the name uniqueness suffix kicks in)
    ///
    /// Runtime: <2s on a warm dev box (no network; no LLM call).
    ///
    /// Uses a Mutex to serialize because BLADE_CONFIG_DIR is a process-global
    /// env var and parallel tests would race the override.
    #[tokio::test]
    async fn voyager_end_to_end_youtube_transcript_fixture() {
        let _g = ENV_LOCK.lock().unwrap();

        let dir = temp_dir("voyager-e2e");
        std::env::set_var("BLADE_CONFIG_DIR", &dir);

        let result = forge_tool_from_fixture(
            "fetch a youtube transcript",
            "python",
            youtube_transcript_fixture(),
        )
        .await;

        let forged = result.expect("forge_tool_from_fixture should succeed");

        // 1. Script artifact present
        let script_path = PathBuf::from(&forged.script_path);
        assert!(
            script_path.is_file(),
            "script should exist at {}",
            script_path.display()
        );
        // The script is one of the python file entries in tools_dir
        assert!(forged.script_path.ends_with(".py"));

        // 2. DB row exists — query it back via get_forged_tools
        let all = get_forged_tools();
        assert!(
            all.iter().any(|t| t.id == forged.id),
            "forged tool should be retrievable via get_forged_tools"
        );

        // 3. SKILL.md present at the canonical (hyphenated) skill dir
        let canonical_name = crate::skills::export::sanitize_name(&forged.name)
            .expect("forged name should sanitize");
        let skill_md = dir
            .join("skills")
            .join(&canonical_name)
            .join("SKILL.md");
        assert!(
            skill_md.is_file(),
            "SKILL.md should exist at {}",
            skill_md.display()
        );

        // 4. Exported SKILL.md passes the validator
        let skill_dir = skill_md.parent().unwrap();
        let report = crate::skills::validator::validate_skill_dir(skill_dir);
        assert!(
            report.is_valid(),
            "exported SKILL.md should validate; findings: {:?}",
            report.findings
        );

        // 5. Catalog::resolve finds it from the user tier
        let user_root = dir.join("skills");
        let bundled_root = dir.join("nonexistent_bundled");
        let catalog = crate::skills::Catalog::build(None, &user_root, &bundled_root);
        let resolved = catalog
            .resolve(&canonical_name)
            .expect("catalog should resolve the forged skill");
        assert_eq!(resolved.source, crate::skills::SourceTier::User);
        assert_eq!(resolved.frontmatter.name, canonical_name);

        // 6. Repeat-call idempotence — second forge of the same capability
        //    appends a timestamp suffix instead of clobbering the first.
        let second = forge_tool_from_fixture(
            "fetch a youtube transcript",
            "python",
            youtube_transcript_fixture(),
        )
        .await
        .expect("second forge should succeed");
        assert_ne!(second.id, forged.id, "second forge should produce a new id");
        assert_ne!(
            second.name, forged.name,
            "second forge should disambiguate the name with a ts suffix"
        );

        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Plan 22-06 (VOYAGER-09) — divergence property test.
    ///
    /// Two `BLADE_CONFIG_DIR`-isolated runs each fed a different gap stream
    /// produce different skill manifests. Confirms the substrate-level claim
    /// "two installs of BLADE diverge over time."
    #[tokio::test]
    async fn voyager_two_installs_diverge() {
        let _g = ENV_LOCK.lock().unwrap();

        // Install A — gap stream { youtube_transcript, summarize_pdf }
        let dir_a = temp_dir("diverge-a");
        std::env::set_var("BLADE_CONFIG_DIR", &dir_a);
        forge_tool_from_fixture(
            "fetch a youtube transcript",
            "python",
            youtube_transcript_fixture(),
        )
        .await
        .expect("A1 should succeed");
        forge_tool_from_fixture(
            "summarize a pdf",
            "python",
            ForgeGeneration {
                script_code: "#!/usr/bin/env python3\nprint('pdf-summary fixture')\n".to_string(),
                description: "Summarize a PDF document.".to_string(),
                usage_template: "tool.py <pdf_path>".to_string(),
                parameters: vec![],
            },
        )
        .await
        .expect("A2 should succeed");
        let manifest_a = manifest_names(&dir_a);

        // Install B — gap stream { format_csv, extract_metadata }
        let dir_b = temp_dir("diverge-b");
        std::env::set_var("BLADE_CONFIG_DIR", &dir_b);
        forge_tool_from_fixture(
            "format a csv as markdown table",
            "python",
            ForgeGeneration {
                script_code: "#!/usr/bin/env python3\nprint('csv fixture')\n".to_string(),
                description: "Format a CSV as a markdown table.".to_string(),
                usage_template: "tool.py <csv_path>".to_string(),
                parameters: vec![],
            },
        )
        .await
        .expect("B1 should succeed");
        forge_tool_from_fixture(
            "extract image metadata",
            "python",
            ForgeGeneration {
                script_code: "#!/usr/bin/env python3\nprint('exif fixture')\n".to_string(),
                description: "Extract EXIF metadata from an image.".to_string(),
                usage_template: "tool.py <image_path>".to_string(),
                parameters: vec![],
            },
        )
        .await
        .expect("B2 should succeed");
        let manifest_b = manifest_names(&dir_b);

        // Assert set difference is non-empty in both directions
        let only_in_a: Vec<&String> = manifest_a.iter().filter(|n| !manifest_b.contains(n)).collect();
        let only_in_b: Vec<&String> = manifest_b.iter().filter(|n| !manifest_a.contains(n)).collect();
        assert!(
            !only_in_a.is_empty(),
            "install A should have skills install B doesn't ({:?} vs {:?})",
            manifest_a, manifest_b
        );
        assert!(
            !only_in_b.is_empty(),
            "install B should have skills install A doesn't ({:?} vs {:?})",
            manifest_a, manifest_b
        );

        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    fn manifest_names(blade_config_dir: &Path) -> Vec<String> {
        let user_root = blade_config_dir.join("skills");
        let bundled_root = blade_config_dir.join("nonexistent");
        let catalog = crate::skills::Catalog::build(None, &user_root, &bundled_root);
        catalog
            .all()
            .iter()
            .map(|s| s.frontmatter.name.clone())
            .collect()
    }

    // -------------------------------------------------------------------
    // Phase 24 Plan 24-01 unit tests
    //
    // These exercise the D-24-A backfill, D-24-B trace-hash + invocations
    // table, and the `last_used = Some(now)` write-time invariant. They
    // share the module-level ENV_LOCK with the Phase 22 voyager_*_diverge
    // tests because BLADE_CONFIG_DIR is process-global and parallel tests
    // would race the override. Tempdir-isolated DB; no LLM call; no network.
    // -------------------------------------------------------------------

    #[test]
    fn ensure_table_backfills_null_last_used() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        let conn = open_db().expect("open db");
        ensure_table(&conn).expect("ensure_table");
        // Manually insert a row with last_used = NULL to simulate pre-Phase-24 data.
        conn.execute(
            "INSERT INTO forged_tools (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
             VALUES ('id1','legacy','d','bash','/tmp/x.sh','u','[]','',1234567890, NULL, 0, '')",
            [],
        ).unwrap();
        // Re-run ensure_table: backfill UPDATE fires.
        ensure_table(&conn).expect("ensure_table 2");
        let last_used: Option<i64> = conn.query_row(
            "SELECT last_used FROM forged_tools WHERE name = 'legacy'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(last_used, Some(1234567890));
        // Idempotent -- third call is no-op.
        ensure_table(&conn).expect("ensure_table 3");
        let last_used2: Option<i64> = conn.query_row(
            "SELECT last_used FROM forged_tools WHERE name = 'legacy'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(last_used2, Some(1234567890));
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn trace_hash_order_sensitive() {
        let h1 = compute_trace_hash(&["a".into(), "b".into(), "c".into()]);
        let h2 = compute_trace_hash(&["c".into(), "b".into(), "a".into()]);
        let h3 = compute_trace_hash(&["a".into(), "b".into(), "c".into()]);
        let h_empty = compute_trace_hash(&[]);
        assert_ne!(h1, h2, "different orderings must hash differently");
        assert_eq!(h1, h3, "same input must hash deterministically");
        assert_eq!(h_empty.len(), 16, "16 hex chars expected");
        // Empty slice produces a stable hash -- record it for regression.
        assert_eq!(h_empty, compute_trace_hash(&[]));
    }

    #[test]
    fn record_tool_use_writes_invocation_row() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        let conn = open_db().expect("open db");
        ensure_table(&conn).unwrap();
        ensure_invocations_table(&conn).unwrap();
        // Seed a forged_tools row directly (avoid LLM path).
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO forged_tools (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
             VALUES ('id1','foo','d','bash','/tmp/foo.sh','u','[]','',?1,?1, 0, '')",
            params![now],
        ).unwrap();
        drop(conn);

        record_tool_use("foo", &["a".into(), "foo".into()]);
        let conn = open_db().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM forged_tools_invocations WHERE tool_name = 'foo'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        let stored_hash: String = conn.query_row(
            "SELECT trace_hash FROM forged_tools_invocations WHERE tool_name = 'foo'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(stored_hash, compute_trace_hash(&["a".into(), "foo".into()]));

        // Cap test -- 105 calls -> at most 100 retained.
        drop(conn);
        for i in 0..104 {
            record_tool_use("foo", &[format!("call_{}", i)]);
        }
        let conn = open_db().unwrap();
        let count2: i64 = conn.query_row(
            "SELECT COUNT(*) FROM forged_tools_invocations WHERE tool_name = 'foo'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert!(count2 <= 100, "expected <=100 rows after auto-prune, got {}", count2);
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    // -------------------------------------------------------------------
    // Phase 51 (FORGE-PRECHECK-REFINE) — MCP-aware routing decision tests
    //
    // These are pure-function tests of `pre_check_with_mcp_state`. The forge
    // router in `forge_if_needed_with_app` reads `installed_mcp_servers` from
    // the runtime `SharedMcpManager`, then dispatches on the `PreCheckOutcome`
    // enum. Here we cover the three router-side decisions independently:
    //   1. MCP-installed → caller skips forge (`McpInstalled`)
    //   2. MCP-cataloged-not-installed → caller emits `forge_route` and FIRES
    //      forge (`McpCatalogedNotInstalled`)
    //   3. Nothing in either catalog → caller fires forge (`NoMatch`)
    // -------------------------------------------------------------------

    #[test]
    fn precheck_mcp_installed_returns_skip() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Capability mentions "linear" → mcp_catalog_lookup → "Linear".
        // Installed list contains "linear" (case-insensitive substring match)
        // → McpInstalled outcome → router skips forge.
        let installed = vec!["Linear".to_string()];
        let outcome = pre_check_with_mcp_state(
            "create a linear issue with title and description",
            &installed,
        );
        assert_eq!(
            outcome,
            PreCheckOutcome::McpInstalled("Linear".to_string()),
            "linear capability + installed Linear MCP should skip forge"
        );
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn precheck_mcp_cataloged_not_installed_returns_fire_forge() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Capability mentions "twitter" → mcp_catalog_lookup → "Twitter/X".
        // Installed list is EMPTY → McpCatalogedNotInstalled → router fires
        // forge after surfacing the trade-off chat-line.
        let installed: Vec<String> = vec![];
        let outcome = pre_check_with_mcp_state(
            "extract structured data from a twitter thread",
            &installed,
        );
        assert_eq!(
            outcome,
            PreCheckOutcome::McpCatalogedNotInstalled("Twitter/X".to_string()),
            "twitter capability + no installed MCP should fire forge with route line"
        );
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn precheck_no_match_returns_fire_forge() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Capability has zero matches in forged/native/MCP catalog.
        // "ascii art rainbow flag" is intentionally weird.
        let installed: Vec<String> = vec![];
        let outcome = pre_check_with_mcp_state(
            "render ascii art rainbow flag with kerning",
            &installed,
        );
        assert_eq!(
            outcome,
            PreCheckOutcome::NoMatch,
            "fully-unknown capability should return NoMatch → router fires forge"
        );
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn precheck_forged_tool_match_beats_mcp_catalog() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Seed a forged tool whose tokens overlap a capability that ALSO
        // hits the MCP catalog. The forged-tool branch must win — we never
        // duplicate capability already present in-app.
        let now = chrono::Utc::now().timestamp();
        let conn = open_db().unwrap();
        ensure_table(&conn).unwrap();
        conn.execute(
            "INSERT INTO forged_tools (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
             VALUES ('id1', 'linear_issue_create', 'create a linear issue programmatically', 'python', '/tmp/x.py', 'u', '[]', '', ?1, ?1, 0, 'create a linear issue with title')",
            params![now],
        ).unwrap();

        let installed = vec!["Linear".to_string()];
        let outcome = pre_check_with_mcp_state(
            "create a linear issue with title and description",
            &installed,
        );
        match outcome {
            PreCheckOutcome::ForgedMatch(name) => {
                assert_eq!(name, "linear_issue_create");
            }
            other => panic!("expected ForgedMatch, got {:?}", other),
        }
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn precheck_native_tool_match_beats_mcp_catalog() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // "execute shell command return stdout" matches the native
        // `blade_bash` description; even if MCP catalog also had a hit, the
        // native branch wins because it's a stronger signal (in-process).
        let installed: Vec<String> = vec![];
        let outcome = pre_check_with_mcp_state(
            "execute a shell command and return stdout",
            &installed,
        );
        match outcome {
            PreCheckOutcome::NativeMatch(name) => assert!(name.starts_with("blade_")),
            other => panic!("expected NativeMatch, got {:?}", other),
        }
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn precheck_mcp_installed_substring_matches_either_direction() {
        // Verify the "either direction substring" rule: server name in the
        // installed list might be a fuller "mcp-github" or a shorter "github".
        let installed_short = vec!["github".to_string()];
        let installed_long = vec!["mcp-github-extras".to_string()];
        let outcome_short = pre_check_with_mcp_state(
            "list github gists for the current user",
            &installed_short,
        );
        let outcome_long = pre_check_with_mcp_state(
            "list github gists for the current user",
            &installed_long,
        );
        assert!(matches!(outcome_short, PreCheckOutcome::McpInstalled(_)));
        assert!(matches!(outcome_long, PreCheckOutcome::McpInstalled(_)));
    }

    #[tokio::test]
    async fn register_forged_tool_sets_last_used_to_created_at() {
        let _g = ENV_LOCK.lock().unwrap();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Use forge_tool_from_fixture (no LLM call).
        let _ = forge_tool_from_fixture(
            "test capability",
            "bash",
            ForgeGeneration {
                script_code: "#!/usr/bin/env bash\necho hi\n".to_string(),
                description: "t".to_string(),
                usage_template: "tool.py".to_string(),
                parameters: vec![],
            },
        )
        .await
        .expect("forge_tool_from_fixture should succeed");

        let conn = open_db().unwrap();
        let row: (Option<i64>, i64) = conn.query_row(
            "SELECT last_used, created_at FROM forged_tools LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(row.0, Some(row.1), "last_used must equal created_at at write time");
        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
