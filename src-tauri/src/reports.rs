// src-tauri/src/reports.rs
// Capability gap detection, local storage, webhook delivery, and self-improvement missions.

use crate::config::blade_config_dir;
use crate::db::{self, CapabilityReport};
use rusqlite;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

// ── Incapability signal detection ────────────────────────────────────────────

/// Patterns in AI responses that signal Blade couldn't fulfill the request.
const INCAPABILITY_PATTERNS: &[(&str, &str, &str)] = &[
    ("I don't have access to", "capability_gap", "missing_access"),
    ("I can't access", "capability_gap", "missing_access"),
    ("I'm unable to", "capability_gap", "missing_capability"),
    ("I cannot ", "capability_gap", "missing_capability"),
    ("I don't have the ability", "capability_gap", "missing_capability"),
    ("I'm not able to", "capability_gap", "missing_capability"),
    ("I don't have a way to", "capability_gap", "missing_tool"),
    ("there's no runtime", "missing_tool", "missing_runtime"),
    ("no tool available", "missing_tool", "missing_tool"),
    ("would need a", "missing_tool", "missing_tool"),
    ("not configured", "missing_tool", "not_configured"),
    ("API key", "missing_tool", "missing_credentials"),
    ("I can't execute", "capability_gap", "execution_blocked"),
    ("I can't run", "capability_gap", "execution_blocked"),
    ("I don't support", "capability_gap", "unsupported"),
];

/// Extracts a short title from the user's request.
fn derive_title(user_request: &str, blade_response: &str) -> String {
    // Find the first incapability phrase in the response and use the surrounding context
    for (pattern, _, _) in INCAPABILITY_PATTERNS {
        if let Some(idx) = blade_response.to_lowercase().find(&pattern.to_lowercase()) {
            let snippet = &blade_response[idx..];
            let end = snippet.find(['.', '!', '\n']).unwrap_or(80.min(snippet.len()));
            return format!("Gap: {}", snippet[..end].trim());
        }
    }
    // Fall back to first 60 chars of user request
    let req = user_request.trim();
    if req.len() > 60 {
        let end = req.char_indices().nth(57).map(|(i, _)| i).unwrap_or(req.len());
        format!("Gap: {}…", &req[..end])
    } else {
        format!("Gap: {req}")
    }
}

fn derive_category(blade_response: &str) -> &'static str {
    for (pattern, category, _) in INCAPABILITY_PATTERNS {
        if blade_response.to_lowercase().contains(&pattern.to_lowercase()) {
            return category;
        }
    }
    "capability_gap"
}

fn derive_severity(user_request: &str) -> &'static str {
    let lower = user_request.to_lowercase();
    if lower.contains("trade") || lower.contains("money") || lower.contains("pay") || lower.contains("send") {
        return "high";
    }
    if lower.contains("upload") || lower.contains("post") || lower.contains("publish") || lower.contains("deploy") {
        return "medium";
    }
    "low"
}

/// Called after every AI response. Returns true if a gap was detected and logged.
pub fn detect_and_log(
    user_request: &str,
    blade_response: &str,
) -> bool {
    if blade_response.len() < 30 { return false; }

    let lower = blade_response.to_lowercase();
    let is_gap = INCAPABILITY_PATTERNS
        .iter()
        .any(|(pat, _, _)| lower.contains(&pat.to_lowercase()));

    if !is_gap { return false; }

    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let id = crate::memory::uuid_v4();
    let category = derive_category(blade_response);
    let title = derive_title(user_request, blade_response);
    let severity = derive_severity(user_request);

    // Truncate fields to avoid huge DB entries
    let req_short = crate::safe_slice(&user_request, 500);
    let resp_short = crate::safe_slice(&blade_response, 800);

    let _ = db::report_capability_gap(
        &conn,
        &id,
        category,
        &title,
        blade_response.lines().next().unwrap_or("").trim(),
        req_short,
        resp_short,
        "",
        severity,
    );

    true
}

// ── Webhook delivery ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub username: String,
    pub content: String,
    pub embeds: Vec<WebhookEmbed>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookEmbed {
    pub title: String,
    pub description: String,
    pub color: u32,
    pub fields: Vec<WebhookField>,
    pub footer: WebhookFooter,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookField {
    pub name: String,
    pub value: String,
    pub inline: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookFooter {
    pub text: String,
}

fn severity_color(severity: &str) -> u32 {
    match severity {
        "critical" => 0xe74c3c,
        "high" => 0xe67e22,
        "medium" => 0xf1c40f,
        _ => 0x95a5a6,
    }
}

fn category_emoji(category: &str) -> &'static str {
    match category {
        "capability_gap" => "🚫",
        "missing_tool" => "🔧",
        "runtime_error" => "💥",
        "failed_mission" => "❌",
        "user_friction" => "😤",
        _ => "📋",
    }
}

async fn send_discord_webhook(url: &str, report: &CapabilityReport) -> Result<(), String> {
    let payload = WebhookPayload {
        username: "Blade Reports".to_string(),
        content: String::new(),
        embeds: vec![WebhookEmbed {
            title: format!("{} {}", category_emoji(&report.category), report.title),
            description: report.description.chars().take(200).collect::<String>(),
            color: severity_color(&report.severity),
            fields: vec![
                WebhookField {
                    name: "Category".to_string(),
                    value: report.category.replace('_', " "),
                    inline: true,
                },
                WebhookField {
                    name: "Severity".to_string(),
                    value: report.severity.clone(),
                    inline: true,
                },
                WebhookField {
                    name: "User asked".to_string(),
                    value: format!("`{}`", report.user_request.chars().take(120).collect::<String>()),
                    inline: false,
                },
                WebhookField {
                    name: "Blade said".to_string(),
                    value: format!("`{}`", report.blade_response.chars().take(200).collect::<String>()),
                    inline: false,
                },
            ],
            footer: WebhookFooter {
                text: format!("Blade · ID {}", &report.id[..8]),
            },
        }],
    };

    let client = reqwest::Client::new();
    client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Webhook error: {e}"))?;

    Ok(())
}

async fn send_slack_webhook(url: &str, report: &CapabilityReport) -> Result<(), String> {
    let text = format!(
        "{} *{}*\n*Category:* {} | *Severity:* {}\n*User asked:* `{}`\n*Blade said:* `{}`",
        category_emoji(&report.category),
        report.title,
        report.category.replace('_', " "),
        report.severity,
        report.user_request.chars().take(120).collect::<String>(),
        report.blade_response.chars().take(200).collect::<String>(),
    );

    let payload = serde_json::json!({ "text": text });
    let client = reqwest::Client::new();
    client
        .post(url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Webhook error: {e}"))?;

    Ok(())
}

pub async fn deliver_report(report: &CapabilityReport) {
    let config = crate::config::load_config();
    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) { Ok(c) => c, Err(_) => return };

    let webhook_url = db::get_setting(&conn, "reports.webhook_url").ok().flatten().unwrap_or_default();
    if webhook_url.trim().is_empty() { return; }

    let result = if webhook_url.contains("discord.com") || webhook_url.contains("discordapp.com") {
        send_discord_webhook(&webhook_url, report).await
    } else {
        // Assume Slack-compatible
        send_slack_webhook(&webhook_url, report).await
    };

    // Suppress any delivery errors — reporting should never break the main app
    let _ = result;
    let _ = config;
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn report_gap(
    app: tauri::AppHandle,
    category: String,
    title: String,
    description: String,
    user_request: String,
    blade_response: String,
    suggested_fix: String,
    severity: String,
) -> Result<String, String> {
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    let id = crate::memory::uuid_v4();
    db::report_capability_gap(
        &conn, &id, &category, &title, &description,
        &user_request, &blade_response, &suggested_fix, &severity,
    )?;

    // Emit event to frontend
    let _ = app.emit("capability_gap_detected", serde_json::json!({
        "id": &id,
        "category": &category,
        "title": &title,
        "severity": &severity,
    }));

    // Async webhook delivery
    let reports = db::get_capability_reports(&conn, 1)?;
    if let Some(report) = reports.into_iter().find(|r| r.id == id) {
        tokio::spawn(async move {
            deliver_report(&report).await;
        });
    }

    Ok(id)
}

#[tauri::command]
pub fn get_reports(limit: Option<usize>) -> Result<Vec<CapabilityReport>, String> {
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::get_capability_reports(&conn, limit.unwrap_or(100))
}

#[tauri::command]
pub fn update_report_status(id: String, status: String) -> Result<(), String> {
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::update_report_status(&conn, &id, &status)
}

#[tauri::command]
pub async fn set_report_webhook(url: String) -> Result<(), String> {
    let db_path = blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    db::set_setting(&conn, "reports.webhook_url", &url)
}

#[tauri::command]
pub fn get_report_webhook() -> String {
    let db_path = blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) { Ok(c) => c, Err(_) => return String::new() };
    db::get_setting(&conn, "reports.webhook_url").ok().flatten().unwrap_or_default()
}
