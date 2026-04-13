/// BLADE SESSION HANDOFF
///
/// At the start of every conversation, BLADE synthesizes what happened last time:
/// - Which commands were run and whether they succeeded
/// - Which files were read or written
/// - What decisions were made (from the thread/working memory)
/// - What is still pending or blocked
///
/// This is injected into the system prompt as a "last session" briefing.
/// BLADE never loses the thread. Even after days away, it picks up exactly where
/// things were left off — without the user having to explain anything.
///
/// The handoff is generated once per session (first build_system_prompt call)
/// and cached. It clears when a new conversation starts.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandoff {
    pub summary: String,         // 2-4 sentence dense briefing
    pub last_commands: Vec<String>, // what was run
    pub pending_items: Vec<String>, // what was left open
    pub generated_at: i64,
}

fn handoff_path() -> PathBuf {
    crate::config::blade_config_dir().join("session_handoff.json")
}

// Cache the handoff for the current session (cleared on new conversation)
static HANDOFF_CACHE: OnceLock<String> = OnceLock::new();

/// Load the last session handoff if it exists and is recent enough (< 7 days)
pub fn load_last_handoff() -> Option<SessionHandoff> {
    let data = std::fs::read_to_string(handoff_path()).ok()?;
    let handoff: SessionHandoff = serde_json::from_str(&data).ok()?;

    // Only inject if last session was within 7 days
    let age = chrono::Utc::now().timestamp() - handoff.generated_at;
    if age > 7 * 86400 {
        return None;
    }

    Some(handoff)
}

/// Write a new session handoff synthesized from recent activity
pub fn write_session_handoff() {
    // Gather recent commands from execution memory
    let conn = crate::execution_memory::recent_for_handoff(20);
    let recent_executions = conn;

    // Get working thread
    let thread = crate::thread::get_active_thread();

    // Get recent journal
    let journal = crate::journal::read_recent_journal(1);

    if recent_executions.is_empty() && thread.is_none() && journal.is_empty() {
        return; // Nothing to synthesize
    }

    let mut cmd_summaries: Vec<String> = recent_executions.iter().map(|e| {
        let status = if e.exit_code == 0 { "ok" } else { "failed" };
        format!("{} [{}]", crate::safe_slice(&e.command, 60), status)
    }).collect();

    // Build a quick summary without LLM (instant, no API call needed)
    let failed: Vec<_> = recent_executions.iter().filter(|e| e.exit_code != 0).collect();
    let succeeded: Vec<_> = recent_executions.iter().filter(|e| e.exit_code == 0).collect();

    let mut summary_parts = Vec::new();

    if !recent_executions.is_empty() {
        summary_parts.push(format!(
            "Last session: {} commands ({} ok, {} failed).",
            recent_executions.len(), succeeded.len(), failed.len()
        ));
    }

    if let Some(ref t) = thread {
        let preview = crate::safe_slice(&t, 200);
        summary_parts.push(format!("Working memory: {}", preview));
    }

    if !failed.is_empty() {
        let last_fail = &failed[failed.len() - 1];
        let err_preview = crate::safe_slice(&last_fail.stderr, 100);
        summary_parts.push(format!("Last failure: `{}` — {}", crate::safe_slice(&last_fail.command, 40), err_preview));
    }

    let summary = summary_parts.join(" ");

    // Extract pending items from thread
    let pending: Vec<String> = thread.as_ref().map(|t| {
        t.lines()
            .filter(|l| l.contains("TODO") || l.contains("pending") || l.contains("blocked") || l.contains("next"))
            .take(5)
            .map(|l| l.trim().to_string())
            .collect()
    }).unwrap_or_default();

    let handoff = SessionHandoff {
        summary,
        last_commands: cmd_summaries.drain(..cmd_summaries.len().min(10)).collect(),
        pending_items: pending,
        generated_at: chrono::Utc::now().timestamp(),
    };

    if let Ok(json) = serde_json::to_string_pretty(&handoff) {
        let _ = std::fs::write(handoff_path(), json);
    }
}

/// Format the handoff as system prompt injection text
pub fn handoff_for_prompt() -> Option<String> {
    let handoff = load_last_handoff()?;

    if handoff.summary.is_empty() {
        return None;
    }

    let mut parts = vec![handoff.summary.clone()];

    if !handoff.last_commands.is_empty() {
        parts.push(format!(
            "Recent commands: {}",
            handoff.last_commands.join(", ")
        ));
    }

    if !handoff.pending_items.is_empty() {
        parts.push(format!(
            "Open items: {}",
            handoff.pending_items.join(" | ")
        ));
    }

    Some(parts.join("\n"))
}

/// Clear the handoff (call when conversation resets)
#[tauri::command]
pub fn session_handoff_clear() {
    let _ = std::fs::remove_file(handoff_path());
}

/// Manually write a handoff now
#[tauri::command]
pub fn session_handoff_write() {
    write_session_handoff();
}

/// Get the current handoff for display
#[tauri::command]
pub fn session_handoff_get() -> Option<SessionHandoff> {
    load_last_handoff()
}
