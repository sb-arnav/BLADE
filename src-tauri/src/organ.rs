/// ORGAN TRAIT — Standard interface for all BLADE organs.
///
/// Every organ (tentacle) in the Hive implements this trait so the Brain
/// can query any organ through a uniform API without knowing its internals.
///
/// An organ:
///   - Lives inside a specific platform or domain
///   - Is always running (polling, watching, maintaining)
///   - Has its own small, focused LLM prompt
///   - Contributes to DNA continuously
///   - Responds to Brain's queries with structured data
///   - Can act autonomously within its domain

use serde::{Deserialize, Serialize};

// ── Organ capability descriptor ──────────────────────────────────────────────

/// Describes one thing an organ can do. Brain reads these to know
/// what to delegate where.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganCapability {
    /// Machine-readable action name (e.g. "get_unread", "post_message", "review_pr")
    pub action: String,
    /// Human-readable description for Brain's prompt
    pub description: String,
    /// Whether this action modifies external state (vs read-only)
    pub mutating: bool,
    /// Current autonomy level for this specific action (0-5)
    pub autonomy_level: u8,
}

/// Compact status summary an organ reports to the Hive/Brain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganStatus {
    /// Organ name (matches tentacle platform)
    pub name: String,
    /// "active" | "dormant" | "error" | "disconnected"
    pub health: String,
    /// One-line summary of current state (e.g. "3 unread emails, 1 urgent")
    pub summary: String,
    /// What the organ has been doing (last 3 notable observations)
    pub recent_observations: Vec<String>,
    /// Full list of what this organ can do
    pub capabilities: Vec<OrganCapability>,
}

/// Result of an organ query — structured data for Brain to interpret.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganQueryResult {
    /// Whether the query succeeded
    pub success: bool,
    /// Structured data (organ-specific format)
    pub data: serde_json::Value,
    /// Human-readable summary for Brain's synthesis
    pub summary: String,
    /// If the query suggests a follow-up action
    pub suggested_action: Option<String>,
}

// ── Organ registry ───────────────────────────────────────────────────────────

/// Registry of all organs and their capabilities. Brain reads this
/// to build its anatomy awareness prompt section.
///
/// This pulls from the live Hive state + hardcoded capability definitions
/// for each tentacle type.
pub fn get_organ_registry() -> Vec<OrganStatus> {
    let hive_status = crate::hive::get_hive_status();
    let mut organs: Vec<OrganStatus> = Vec::new();

    for tentacle in &hive_status.tentacles {
        let health = match tentacle.status {
            crate::hive::TentacleStatus::Active => "active",
            crate::hive::TentacleStatus::Dormant => "dormant",
            crate::hive::TentacleStatus::Error => "error",
            crate::hive::TentacleStatus::Disconnected => "disconnected",
        };

        let capabilities = get_capabilities_for_platform(&tentacle.platform);

        let summary = if tentacle.pending_report_count > 0 {
            format!("{} pending reports", tentacle.pending_report_count)
        } else {
            format!("monitoring ({})", health)
        };

        organs.push(OrganStatus {
            name: tentacle.platform.clone(),
            health: health.to_string(),
            summary,
            recent_observations: Vec::new(), // Filled by hive digest
            capabilities,
        });
    }

    // Add built-in organs that aren't tentacles
    organs.push(OrganStatus {
        name: "screen".to_string(),
        health: "active".to_string(),
        summary: perception_summary(),
        recent_observations: Vec::new(),
        capabilities: vec![
            cap("get_current_activity", "What user is doing right now (app, window, file)", false),
            cap("get_screen_text", "OCR text visible on screen", false),
            cap("capture_screenshot", "Take a screenshot", false),
            cap("get_errors", "Detect visible errors on screen", false),
        ],
    });

    organs.push(OrganStatus {
        name: "browser".to_string(),
        health: "active".to_string(),
        summary: "browser automation available".to_string(),
        recent_observations: Vec::new(),
        capabilities: vec![
            cap("navigate", "Open a URL in the browser", true),
            cap("click", "Click an element on a page", true),
            cap("type_text", "Type text into a form field", true),
            cap("read_page", "Read the current page content", false),
            cap("take_screenshot", "Screenshot the current page", false),
        ],
    });

    organs.push(OrganStatus {
        name: "filesystem".to_string(),
        health: "active".to_string(),
        summary: "file system access available".to_string(),
        recent_observations: Vec::new(),
        capabilities: vec![
            cap("read_file", "Read a file's contents", false),
            cap("write_file", "Write content to a file", true),
            cap("search_files", "Search for files by pattern", false),
            cap("list_directory", "List directory contents", false),
        ],
    });

    organs.push(OrganStatus {
        name: "terminal".to_string(),
        health: "active".to_string(),
        summary: "shell access available".to_string(),
        recent_observations: Vec::new(),
        capabilities: vec![
            cap("run_command", "Execute a shell command", true),
            cap("get_history", "Recent command history", false),
        ],
    });

    organs
}

/// Build a compact organ roster string for Brain's system prompt.
pub fn get_organ_roster_for_brain() -> String {
    let organs = get_organ_registry();
    if organs.is_empty() {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push("## Available Organs".to_string());

    for organ in &organs {
        let cap_names: Vec<&str> = organ.capabilities.iter().map(|c| c.action.as_str()).collect();
        let cap_list = if cap_names.is_empty() {
            String::new()
        } else {
            format!(" — can: {}", cap_names.join(", "))
        };
        let status_icon = match organ.health.as_str() {
            "active" => "",
            "dormant" => " [dormant]",
            "error" => " [error]",
            _ => " [offline]",
        };
        lines.push(format!("- **{}**{}{}", organ.name, status_icon, cap_list));
    }

    lines.join("\n")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn cap(action: &str, description: &str, mutating: bool) -> OrganCapability {
    OrganCapability {
        action: action.to_string(),
        description: description.to_string(),
        mutating,
        autonomy_level: if mutating { 2 } else { 5 },
    }
}

fn perception_summary() -> String {
    match crate::perception_fusion::get_latest() {
        Some(p) if !p.active_app.is_empty() => {
            let title = if !p.active_title.is_empty() {
                format!(" — {}", crate::safe_slice(&p.active_title, 40))
            } else {
                String::new()
            };
            format!("{}{}, user {}", p.active_app, title, p.user_state)
        }
        _ => "no screen data".to_string(),
    }
}

fn get_capabilities_for_platform(platform: &str) -> Vec<OrganCapability> {
    match platform {
        "slack" => vec![
            cap("get_unread", "Get unread messages and mentions", false),
            cap("reply", "Send a message in a channel or DM", true),
            cap("summarize_channel", "Summarize recent activity in a channel", false),
            cap("find_messages", "Search for messages", false),
        ],
        "email" => vec![
            cap("get_inbox", "Get triaged inbox (critical/response/fyi/spam)", false),
            cap("draft_reply", "Draft a reply to an email", false),
            cap("send_email", "Send an email (requires approval)", true),
            cap("search_email", "Search emails", false),
        ],
        "github" => vec![
            cap("get_prs", "List open pull requests", false),
            cap("review_pr", "Review a pull request with code analysis", false),
            cap("get_issues", "List open issues", false),
            cap("get_ci_status", "Check CI/CD pipeline status", false),
            cap("merge_pr", "Merge a pull request (requires approval)", true),
            cap("create_issue", "Create a new issue", true),
        ],
        "ci" => vec![
            cap("get_builds", "List recent build results", false),
            cap("trigger_build", "Trigger a CI build", true),
            cap("get_failure_logs", "Get logs from a failed build", false),
        ],
        "discord" => vec![
            cap("get_mentions", "Get recent mentions", false),
            cap("reply", "Reply to a message", true),
            cap("moderate", "Apply moderation actions", true),
            cap("summarize", "Summarize channel activity", false),
        ],
        "cloud" => vec![
            cap("get_costs", "Current cloud spending and trends", false),
            cap("get_resources", "List active resources", false),
            cap("detect_anomalies", "Check for cost or usage anomalies", false),
        ],
        "linear" | "jira" => vec![
            cap("get_tickets", "List open tickets", false),
            cap("get_blockers", "Detect blocked tickets", false),
            cap("update_status", "Update ticket status", true),
            cap("create_ticket", "Create a new ticket", true),
        ],
        "logs" => vec![
            cap("tail_logs", "Recent application logs", false),
            cap("detect_anomalies", "Check for log anomalies", false),
            cap("search_logs", "Search logs for a pattern", false),
        ],
        "backend" => vec![
            cap("health_check", "Check service health on standard ports", false),
            cap("get_metrics", "Get basic server metrics", false),
        ],
        _ => vec![
            cap("query", "Query this organ for information", false),
        ],
    }
}

// ── Autonomy Gradient ────────────────────────────────────────────────────────

/// Autonomy levels map to decision_gate threshold ranges.
/// The decision_gate already supports per-source learned thresholds.
/// Organ autonomy is a convenience layer that sets the source key to
/// "organ:{platform}:{action}" so each organ+action pair gets its own
/// learned threshold.
///
/// Level 0 (Observe):     threshold = 1.0  (never act)
/// Level 1 (Inform):      threshold = 0.99 (only surface info)
/// Level 2 (Suggest):     threshold = 0.95 (suggest but don't execute)
/// Level 3 (Preview):     threshold = 0.85 (execute with preview/approval)
/// Level 4 (Act+Report):  threshold = 0.7  (execute, tell user after)
/// Level 5 (Silent):      threshold = 0.5  (execute silently)
pub fn autonomy_level_to_threshold(level: u8) -> f64 {
    match level {
        0 => 1.0,
        1 => 0.99,
        2 => 0.95,
        3 => 0.85,
        4 => 0.7,
        5 => 0.5,
        _ => 0.95, // default to suggest
    }
}

/// Build a decision_gate source key for an organ action.
/// This ensures each organ+action pair has its own learned threshold.
pub fn organ_source_key(organ: &str, action: &str) -> String {
    format!("organ:{}:{}", organ, action)
}

/// Set the autonomy level for a specific organ action.
/// This writes directly to decision_gate's per-source threshold map.
pub fn set_organ_autonomy(organ: &str, action: &str, level: u8) {
    let key = organ_source_key(organ, action);
    let threshold = autonomy_level_to_threshold(level);

    // Use decision_gate's internal threshold storage
    // We access the same static map it uses
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        // Load existing thresholds
        let existing: std::collections::HashMap<String, f64> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'decision_gate_thresholds'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();

        let mut updated = existing;
        updated.insert(key, threshold);

        if let Ok(json) = serde_json::to_string(&updated) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('decision_gate_thresholds', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}

/// Get the current autonomy level for a specific organ action.
pub fn get_organ_autonomy(organ: &str, action: &str) -> u8 {
    let key = organ_source_key(organ, action);
    let db_path = crate::config::blade_config_dir().join("blade.db");

    let threshold: f64 = rusqlite::Connection::open(&db_path)
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT value FROM settings WHERE key = 'decision_gate_thresholds'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .and_then(|json| serde_json::from_str::<std::collections::HashMap<String, f64>>(&json).ok())
        .and_then(|map| map.get(&key).copied())
        .unwrap_or(0.95); // default: suggest

    // Reverse map threshold to level
    if threshold >= 1.0 { 0 }
    else if threshold >= 0.99 { 1 }
    else if threshold >= 0.95 { 2 }
    else if threshold >= 0.85 { 3 }
    else if threshold >= 0.7 { 4 }
    else { 5 }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn organ_get_registry() -> Vec<OrganStatus> {
    get_organ_registry()
}

#[tauri::command]
pub fn organ_get_roster() -> String {
    get_organ_roster_for_brain()
}

#[tauri::command]
pub fn organ_set_autonomy(organ: String, action: String, level: u8) -> Result<(), String> {
    if level > 5 {
        return Err("Autonomy level must be 0-5".to_string());
    }
    set_organ_autonomy(&organ, &action, level);
    Ok(())
}

#[tauri::command]
pub fn organ_get_autonomy(organ: String, action: String) -> u8 {
    get_organ_autonomy(&organ, &action)
}
