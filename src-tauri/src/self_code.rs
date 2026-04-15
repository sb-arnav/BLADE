/// JITRO — BLADE codes itself.
///
/// BLADE spawns a Claude Code background agent on its own source repo
/// to implement new features autonomously. The agent reads CLAUDE.md
/// for project conventions, writes the code, and reports back.
///
/// Named after the concept: an AI that can code itself.
///
/// Flow:
///   blade_self_code("add a pomodoro timer to the dashboard")
///     → resolves source path
///     → spawns Claude Code agent on ~/blade/ (or configured path)
///     → Claude Code reads CLAUDE.md, implements the feature
///     → cargo check runs, result emitted as blade_self_code_result
#[allow(dead_code)]

use tauri::Emitter;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfCodeResult {
    pub agent_id: String,
    pub feature: String,
    pub source_path: String,
    pub status: String, // "spawned" | "completed" | "failed"
    pub message: String,
}

/// Resolve the BLADE source path.
/// Priority: 1) config field, 2) ~/blade, 3) current exe parent dir guess
fn resolve_source_path(configured: &str) -> Result<String, String> {
    if !configured.is_empty() {
        let p = std::path::PathBuf::from(configured);
        if p.exists() && p.join("CLAUDE.md").exists() {
            return Ok(configured.to_string());
        }
    }

    // Auto-detect: try common locations
    let candidates = vec![
        dirs::home_dir().map(|h| h.join("blade")),
        dirs::home_dir().map(|h| h.join("projects").join("blade")),
        dirs::home_dir().map(|h| h.join("dev").join("blade")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() && candidate.join("CLAUDE.md").exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    Err(
        "Could not locate BLADE source directory. \
         Set blade_source_path in Settings or ensure ~/blade/CLAUDE.md exists."
            .to_string(),
    )
}

/// Spawn a Claude Code agent on BLADE's own source repo to implement a feature.
///
/// The feature description is turned into a prompt that:
/// 1. Reads CLAUDE.md for conventions
/// 2. Implements the requested feature
/// 3. Runs cargo check to verify compilation
#[tauri::command]
pub async fn blade_self_code(
    app: tauri::AppHandle,
    feature: String,
    source_path: Option<String>,
) -> Result<SelfCodeResult, String> {
    let config = crate::config::load_config();
    let path_override = source_path.unwrap_or_default();
    let resolved_path = resolve_source_path(if !path_override.is_empty() {
        &path_override
    } else {
        &config.blade_source_path
    })?;

    // Build the Claude Code task prompt
    let task = format!(
        "You are working inside the BLADE desktop AI project. \
        Read CLAUDE.md first — it contains all architectural rules, patterns, and what NOT to do. \
        Then implement the following feature:\n\n\
        {feature}\n\n\
        Follow CLAUDE.md rules exactly:\n\
        - Register any new Tauri command in lib.rs invoke_handler\n\
        - Add any new module as `mod module_name;` in lib.rs\n\
        - For config changes, update DiskConfig, BladeConfig, both Defaults, load_config(), save_config()\n\
        - Use `pub(crate)` for cross-module functions\n\
        - No double quotes inside SQL execute_batch! strings\n\
        - New frontend routes: add to Route type union in App.tsx and fullPageRoutes\n\n\
        After implementing, run: cd src-tauri && cargo check\n\
        Report what you built and whether it compiled.",
        feature = feature
    );

    // Use existing background_agent infrastructure
    let agent_id = crate::background_agent::agent_spawn(
        app.clone(),
        "claude-code".to_string(),
        task,
        Some(resolved_path.clone()),
    )
    .await?;

    let result = SelfCodeResult {
        agent_id: agent_id.clone(),
        feature: feature.clone(),
        source_path: resolved_path.clone(),
        status: "spawned".to_string(),
        message: format!(
            "Claude Code is working on: \"{}\"\nSource: {}\nAgent ID: {}",
            crate::safe_slice(&feature, 80),
            resolved_path,
            agent_id
        ),
    };

    // Emit so the UI can surface progress
    let _ = app.emit("blade_self_code_started", serde_json::json!({
        "agent_id": &agent_id,
        "feature": &feature,
        "source_path": &resolved_path,
    }));

    Ok(result)
}

/// Get the configured or auto-detected BLADE source path.
/// Used by Settings to show where self-coding will run.
#[tauri::command]
pub fn blade_source_path_resolve() -> String {
    let config = crate::config::load_config();
    resolve_source_path(&config.blade_source_path).unwrap_or_else(|_| String::new())
}
