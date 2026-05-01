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
use std::path::PathBuf;

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
        );",
    )
    .map_err(|e| format!("DB schema error: {}", e))
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

/// Forge a new tool from a natural-language capability description.
/// Generates script, writes it to disk, tests it, and saves to DB.
pub async fn forge_tool(capability: &str) -> Result<ForgedTool, String> {
    let language = choose_language(capability).to_string();
    let base_name = capability_to_name(capability);
    let ext = extension(&language);

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

    // Generate script via LLM
    let (script_code, description, usage_template, parameters) =
        generate_tool_script(capability, &language).await?;

    // Substitute the real filename in the usage string
    let usage = usage_template.replace("tool.py", &format!("{}.{}", name, ext));

    // Write script to disk
    std::fs::write(&script_path, &script_code)
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
    let test_output = test_tool(&script_path_str, &language)
        .await
        .unwrap_or_else(|e| format!("Test failed: {}", e));

    // Persist to DB
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let params_json = serde_json::to_string(&parameters).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO forged_tools \
         (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 0, ?10)",
        params![
            id,
            name,
            description,
            language,
            script_path_str,
            usage,
            params_json,
            test_output,
            now,
            capability,
        ],
    )
    .map_err(|e| format!("DB insert error: {}", e))?;

    log::info!("Tool Forge: created '{}' ({})", name, language);

    let forged = ForgedTool {
        id,
        name,
        description,
        language,
        script_path: script_path_str,
        usage,
        parameters,
        test_output,
        created_at: now,
        last_used: None,
        use_count: 0,
        forged_from: capability.to_string(),
    };

    // Phase 22 (v1.3) Plan 22-01 — export to agentskills.io SKILL.md at the
    // user tier so the Phase 21 Catalog::resolve path can find this skill +
    // ecosystem validators can ingest it. Coexists with the existing
    // <blade_config_dir>/tools/<name>.<ext> artifact + forged_tools row.
    //
    // Non-fatal: a name that doesn't sanitize to agentskills.io-compliant
    // form (or a missing source script — shouldn't happen here since we
    // just wrote it) logs a warning and the loop continues. The forge
    // succeeded; the SKILL.md export is a discoverability bonus.
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

    // Phase 22 (v1.3) — Voyager loop step 3 of 4: skill is now resolvable
    // (DB row + optional SKILL.md). Emits AFTER the export attempt so the
    // payload can carry skill_md_path on success.
    crate::voyager_log::skill_registered(&forged.name, &forged.id, skill_md_path.as_deref());

    Ok(forged)
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

/// Increment `use_count` and set `last_used` timestamp for the named tool.
///
/// Phase 22 (v1.3) — also emits the Voyager loop step 4 of 4 (`skill_used`)
/// to ActivityStrip per the M-07 contract. Currently called by zero
/// internal sites; tracked as a forward-pointer for the chat tool-loop
/// branch to call when a forged tool is actually invoked.
#[allow(dead_code)]
pub fn record_tool_use(name: &str) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    ensure_table(&conn).ok();
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE forged_tools SET use_count = use_count + 1, last_used = ?1 WHERE name = ?2",
        params![now, name],
    )
    .ok();

    crate::voyager_log::skill_used(name);
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
