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

    let prompt = format!(
        "You are an expert programmer. Write a {language} script that implements this capability:\n\n\
         {capability}\n\n\
         Requirements:\n\
         - Accept arguments from the command line ({lang_notes})\n\
         - Print results to stdout (one result per line, or JSON)\n\
         - Handle errors gracefully (print to stderr, exit code 1)\n\
         - Be self-contained (no external dependencies except standard library + common packages like requests, pathlib)\n\
         - Be production-quality: handle edge cases, validate inputs\n\n\
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

    let turn = crate::providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .map_err(|e| format!("LLM call failed: {}", e))?;

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
    let language = choose_language(capability).to_string();

    // Generate script via LLM (or budget-refuse if pathological prompt)
    let (script_code, description, usage_template, parameters) =
        generate_tool_script(capability, &language).await?;

    persist_forged_tool(
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
        return Err(format!(
            "[tool_forge] DB insert error after script write (script rolled back): {e}"
        ));
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
