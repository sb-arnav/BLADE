/// REPRODUCTIVE SYSTEM — BLADE creates new life that inherits its DNA.
///
/// Two reproductive strategies:
///   Quick spawn (tools, automations): fast, lightweight, single-purpose
///   Full gestation (agents, services): complete lifecycle, own state, persistent
///
/// The key innovation: INHERITANCE. Every child inherits the body's DNA:
///   - User identity (who they serve)
///   - Voice/personality (how they communicate)
///   - Trust levels (how much autonomy they have)
///   - Learned patterns (what works, what doesn't)
///   - Active context (what the user is working on right now)
///
/// This means a spawned Claude Code agent knows:
///   "I'm working for Arnav, he prefers direct communication, he's currently
///    working on the BLADE project in Rust, his coding conventions are in
///    CLAUDE.md, and he doesn't like over-explained code."
///
/// Without inheritance, spawned agents are blank slates that make generic
/// decisions instead of user-specific ones.

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// DNA package that gets injected into every spawned child.
/// Compact (~500-1000 chars) so it doesn't bloat the child's context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InheritedDna {
    /// Who the user is (from identity.md / persona)
    pub identity: String,
    /// How to communicate (from personality_mirror)
    pub voice: String,
    /// Current autonomy level (from homeostasis trust)
    pub trust_level: f32,
    /// What the user is working on right now (from perception + working memory)
    pub current_context: String,
    /// Key preferences learned from behavior
    pub preferences: Vec<String>,
    /// Active project (if any)
    pub active_project: String,
}

/// Build the DNA package for a child. Called before spawning any agent or tool.
pub fn build_dna_package() -> InheritedDna {
    // Identity: who is the user?
    let identity = crate::dna::get_identity();

    // Voice: how should the child communicate?
    let voice = crate::dna::get_voice()
        .unwrap_or_default();

    // Trust: how much autonomy does the child get?
    let trust = crate::homeostasis::trust();

    // Current context: what's happening right now?
    let perception_ctx = crate::perception_fusion::get_latest()
        .map(|p| {
            if !p.active_app.is_empty() {
                format!("User is in {} — {}", p.active_app, crate::safe_slice(&p.active_title, 50))
            } else {
                String::new()
            }
        })
        .unwrap_or_default();

    let wm = crate::prefrontal::get();
    let working_ctx = if wm.active {
        format!("Active task: {}", wm.task_request)
    } else if !wm.progress_summary.is_empty() {
        format!("Just completed: {}", crate::safe_slice(&wm.progress_summary, 80))
    } else {
        String::new()
    };

    let current_context = [perception_ctx, working_ctx]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join(". ");

    // Preferences: top learned rules
    let preferences = crate::character::get_top_learned_preferences(5);

    // Active project
    let active_project = std::env::current_dir()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_default();

    InheritedDna {
        identity: crate::safe_slice(&identity, 200).to_string(),
        voice: crate::safe_slice(&voice, 200).to_string(),
        trust_level: trust,
        current_context: crate::safe_slice(&current_context, 300).to_string(),
        preferences,
        active_project,
    }
}

/// Format the DNA package as a system prompt prefix for a child agent.
/// This gets prepended to whatever system prompt the child has.
pub fn dna_as_system_prompt(dna: &InheritedDna) -> String {
    let mut lines = Vec::new();

    lines.push("## Inherited Context (from BLADE)".to_string());
    lines.push(format!("You were spawned by BLADE, a personal AI agent. You inherit this context:"));

    if !dna.identity.is_empty() {
        lines.push(format!("\nUser: {}", dna.identity));
    }
    if !dna.voice.is_empty() {
        lines.push(format!("\nCommunication style: {}", dna.voice));
    }
    if !dna.current_context.is_empty() {
        lines.push(format!("\nCurrent situation: {}", dna.current_context));
    }
    if !dna.active_project.is_empty() {
        lines.push(format!("Active project: {}", dna.active_project));
    }
    if !dna.preferences.is_empty() {
        lines.push("\nLearned preferences:".to_string());
        for pref in &dna.preferences {
            lines.push(format!("- {}", crate::safe_slice(pref, 80)));
        }
    }

    let autonomy = if dna.trust_level > 0.7 {
        "You have high autonomy — act decisively without excessive confirmation."
    } else if dna.trust_level > 0.4 {
        "You have moderate autonomy — confirm before irreversible actions."
    } else {
        "You have low autonomy — ask before taking any significant action."
    };
    lines.push(format!("\n{}", autonomy));

    lines.join("\n")
}

/// Spawn a child agent with DNA inheritance.
/// Wraps background_agent but injects the DNA package into the system prompt.
pub async fn spawn_with_dna(
    app: &tauri::AppHandle,
    agent_type: &str,  // "claude_code" | "aider" | "codex"
    task: &str,
    working_dir: Option<&str>,
) -> Result<String, String> {
    let dna = build_dna_package();
    let dna_prompt = dna_as_system_prompt(&dna);

    // Build the full task with DNA context
    let enriched_task = format!(
        "{}\n\n---\n\nTask: {}",
        dna_prompt, task
    );

    // Log the birth
    log::info!(
        "[reproductive] Spawning {} with DNA (trust={:.1}, project={})",
        agent_type, dna.trust_level, dna.active_project
    );

    let _ = app.emit("agent_spawned_with_dna", serde_json::json!({
        "agent_type": agent_type,
        "task": crate::safe_slice(task, 100),
        "trust_level": dna.trust_level,
        "active_project": dna.active_project,
    }));

    // Record the birth in activity timeline
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::db::timeline_record(
            &conn,
            "agent_birth",
            &format!("Spawned {} for: {}", agent_type, crate::safe_slice(task, 60)),
            &crate::safe_slice(&dna_prompt, 500),
            agent_type,
            "{}",
        );
    }

    // Spawn via background_agent with the enriched task
    crate::background_agent::agent_spawn(
        app.clone(),
        agent_type.to_string(),
        enriched_task,
        working_dir.map(|s| s.to_string()),
    ).await
}

/// Spawn a tool with DNA context. When tool_forge creates a new tool,
/// inject user preferences so the tool behaves correctly.
pub fn get_forge_context() -> String {
    let dna = build_dna_package();
    let mut ctx = String::new();

    if !dna.identity.is_empty() {
        ctx.push_str(&format!("# User context\n{}\n\n", dna.identity));
    }
    if !dna.preferences.is_empty() {
        ctx.push_str("# Preferences\n");
        for pref in &dna.preferences {
            ctx.push_str(&format!("- {}\n", pref));
        }
    }
    if !dna.active_project.is_empty() {
        ctx.push_str(&format!("\n# Active project: {}\n", dna.active_project));
    }

    ctx
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn reproductive_get_dna() -> InheritedDna {
    build_dna_package()
}

#[tauri::command]
pub async fn reproductive_spawn(
    app: tauri::AppHandle,
    agent_type: String,
    task: String,
    working_dir: Option<String>,
) -> Result<String, String> {
    spawn_with_dna(&app, &agent_type, &task, working_dir.as_deref()).await
}
