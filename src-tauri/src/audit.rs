/// AUDIT LOG — BLADE explains its decisions.
///
/// RICE Interpretability: every significant decision BLADE makes is
/// recorded with the reasoning behind it. The user can ask "why did
/// you do that?" and get a real answer, not a guess.
///
/// Also serves Controllability: the audit log shows what BLADE is doing
/// autonomously, so the user can intervene or adjust.
///
/// Lightweight: writes to a ring buffer (max 500 entries) + SQLite.
/// No LLM calls — just structured logging of decisions already being made.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::collections::VecDeque;

const MAX_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: i64,
    pub system: String,       // "homeostasis" | "brain_planner" | "decision_gate" | "hive" | "symbolic" | "proactive"
    pub decision: String,     // what was decided
    pub reasoning: String,    // why
    pub inputs: String,       // what data informed the decision
    pub outcome: String,      // "executed" | "blocked" | "deferred" | "user_asked"
}

static AUDIT_LOG: OnceLock<Mutex<VecDeque<AuditEntry>>> = OnceLock::new();

fn log_store() -> &'static Mutex<VecDeque<AuditEntry>> {
    AUDIT_LOG.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)))
}

/// Record a decision. Called from any system that makes autonomous decisions.
pub fn record(system: &str, decision: &str, reasoning: &str, inputs: &str, outcome: &str) {
    let entry = AuditEntry {
        timestamp: chrono::Utc::now().timestamp(),
        system: system.to_string(),
        decision: crate::safe_slice(decision, 200).to_string(),
        reasoning: crate::safe_slice(reasoning, 300).to_string(),
        inputs: crate::safe_slice(inputs, 200).to_string(),
        outcome: outcome.to_string(),
    };

    if let Ok(mut log) = log_store().lock() {
        if log.len() >= MAX_ENTRIES {
            log.pop_front();
        }
        log.push_back(entry);
    }
}

/// Get recent audit entries, optionally filtered by system.
pub fn get_recent(system_filter: Option<&str>, limit: usize) -> Vec<AuditEntry> {
    let log = match log_store().lock() {
        Ok(l) => l,
        Err(_) => return vec![],
    };

    let iter = log.iter().rev();
    let filtered: Vec<AuditEntry> = if let Some(sys) = system_filter {
        iter.filter(|e| e.system == sys).take(limit).cloned().collect()
    } else {
        iter.take(limit).cloned().collect()
    };

    filtered
}

/// Format recent decisions as context for the chat model.
/// When user asks "why did you do that?" this provides the answer.
pub fn get_audit_context(query: &str) -> String {
    let q = query.to_lowercase();
    let wants_audit = q.contains("why did you") || q.contains("why are you")
        || q.contains("what did you do") || q.contains("explain your")
        || q.contains("audit") || q.contains("decision log")
        || q.contains("why was") || q.contains("how did you decide");

    if !wants_audit { return String::new(); }

    let recent = get_recent(None, 10);
    if recent.is_empty() { return String::new(); }

    let mut lines = vec!["## Recent Decisions (audit log)".to_string()];
    for entry in &recent {
        let time = chrono::DateTime::from_timestamp(entry.timestamp, 0)
            .map(|d| d.with_timezone(&chrono::Local).format("%H:%M:%S").to_string())
            .unwrap_or_default();
        lines.push(format!(
            "[{}] **{}**: {} → {} (reason: {})",
            time, entry.system, entry.decision, entry.outcome, entry.reasoning
        ));
    }

    lines.join("\n")
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn audit_get_log(system: Option<String>, limit: Option<usize>) -> Vec<AuditEntry> {
    get_recent(system.as_deref(), limit.unwrap_or(50))
}
