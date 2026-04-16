// src-tauri/src/notification_listener.rs
// Phase 5 (partial): OS Notification Listener — surface Windows (and macOS/Linux) notifications to BLADE.
//
// Strategy on Windows: poll the notification delivery database that the OS
// maintains for the Action Center. The WNS SQLite database lives at:
//   %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db
// We read the Notification table, parse the XML payload for title/body, and
// emit new entries to the frontend via a Tauri event.
//
// Fallback: if the DB is locked or inaccessible, we query the system event log
// for AppLocker/toast events via PowerShell.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

#[cfg(target_os = "windows")]
use rusqlite;

// ── Data model ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsNotification {
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub timestamp: i64,
    pub category: String, // "message", "reminder", "update", "alert", "other"
}

// ── In-memory store ────────────────────────────────────────────────────────────

static RECENT: OnceLock<Mutex<Vec<OsNotification>>> = OnceLock::new();

fn recent_store() -> &'static Mutex<Vec<OsNotification>> {
    RECENT.get_or_init(|| Mutex::new(Vec::new()))
}

const MAX_STORED: usize = 50;

fn store_notification(n: OsNotification) {
    let mut guard = recent_store().lock().unwrap_or_else(|e| e.into_inner());
    // Dedup by (app_name, title, body) within last 60s
    let already = guard.iter().any(|existing| {
        existing.app_name == n.app_name
            && existing.title == n.title
            && existing.body == n.body
            && (n.timestamp - existing.timestamp).abs() < 60
    });
    if !already {
        guard.push(n);
        if guard.len() > MAX_STORED {
            guard.remove(0);
        }
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Return the count of unread notifications seen in the current session.
/// Used by the HUD bar to show an unread badge.
pub fn get_unread_count() -> u32 {
    let guard = recent_store().lock().unwrap_or_else(|e| e.into_inner());
    // Count notifications from the last 30 minutes as "unread"
    let cutoff = chrono::Utc::now().timestamp() - 1800;
    guard.iter().filter(|n| n.timestamp >= cutoff).count() as u32
}

/// Return up to 20 most recent OS notifications.
#[tauri::command]
pub fn notification_get_recent() -> Vec<OsNotification> {
    let guard = recent_store().lock().unwrap_or_else(|e| e.into_inner());
    guard.iter().rev().take(20).cloned().collect::<Vec<_>>().into_iter().rev().collect()
}

/// Start the background notification polling loop.
#[tauri::command]
pub fn notification_listener_start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        start_notification_listener(app).await;
    });
}

// ── Core listener ──────────────────────────────────────────────────────────────

pub async fn start_notification_listener(app: tauri::AppHandle) {
    log::info!("[notification_listener] starting — polling every 30s");
    let mut last_seen_ts: i64 = chrono::Utc::now().timestamp() - 120; // seed: last 2 min

    loop {
        let fresh = poll_notifications(last_seen_ts).await;
        if !fresh.is_empty() {
            let mut max_ts = last_seen_ts;
            for n in &fresh {
                store_notification(n.clone());
                // Emit to frontend so it can surface in NotificationCenter
                let _ = app.emit("os_notification", n);
                if n.timestamp > max_ts {
                    max_ts = n.timestamp;
                }
            }
            // Advance the watermark to the newest notification we saw this batch
            last_seen_ts = max_ts;
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    }
}

/// Return the in-memory list (non-async, for internal use by brain/pulse)
pub fn get_recent_notifications() -> Vec<OsNotification> {
    let guard = recent_store().lock().unwrap_or_else(|e| e.into_inner());
    guard.iter().rev().take(20).cloned().collect::<Vec<_>>().into_iter().rev().collect()
}

// ── Platform implementations ───────────────────────────────────────────────────

#[cfg(target_os = "windows")]
async fn poll_notifications(since_ts: i64) -> Vec<OsNotification> {
    // Primary: read the WNS Action Center database
    match read_wpn_database(since_ts).await {
        Ok(notifs) if !notifs.is_empty() => return notifs,
        Ok(_) => {} // Empty, try fallback
        Err(e) => log::debug!("[notification_listener] WPN DB error: {}", e),
    }
    // Fallback: use PowerShell to query recent toast events from the event log
    powershell_fallback(since_ts).await
}

#[cfg(target_os = "windows")]
async fn read_wpn_database(since_ts: i64) -> Result<Vec<OsNotification>, String> {
    // The WPN database path
    let appdata = std::env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA not set".to_string())?;
    let db_path = std::path::Path::new(&appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Notifications")
        .join("wpndatabase.db");

    if !db_path.exists() {
        return Err("wpndatabase.db not found".to_string());
    }

    // The WPN database is held open (and locked) by the OS notification service.
    // We copy it to a temp file first so we can read it without hitting lock errors.
    let temp_path = std::env::temp_dir().join("blade_wpn_snapshot.db");
    std::fs::copy(&db_path, &temp_path)
        .map_err(|e| format!("Cannot copy WPN database (may be locked): {}", e))?;

    // Now query the temp copy using rusqlite (already a project dependency).
    // The DB is locked on the original but the copy is ours.
    let filetime_since = since_ts * 10_000_000 + 116_444_736_000_000_000i64; // Unix → FILETIME

    let temp_path_clone = temp_path.clone();
    let results = tokio::task::spawn_blocking(move || -> Result<Vec<OsNotification>, String> {
        let conn = rusqlite::Connection::open_with_flags(
            &temp_path_clone,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| format!("Cannot open WPN DB copy: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT Handler, Payload, ArrivalTime \
                 FROM Notification \
                 WHERE ArrivalTime > ?1 \
                 ORDER BY ArrivalTime DESC \
                 LIMIT 30",
            )
            .map_err(|e| format!("WPN DB prepare failed: {}", e))?;

        let rows = stmt
            .query_map(rusqlite::params![filetime_since], |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, i64>(2).unwrap_or(0),
                ))
            })
            .map_err(|e| format!("WPN DB query failed: {}", e))?;

        let mut results = Vec::new();
        for row in rows.flatten() {
            let (handler, payload, arrival) = row;
            // FILETIME → Unix timestamp
            let unix_ts = (arrival - 116_444_736_000_000_000i64) / 10_000_000;
            if unix_ts < since_ts {
                continue;
            }
            let app_name = extract_app_name_from_handler(&handler);
            let (title, body) = parse_toast_xml(&payload);
            if title.is_empty() && body.is_empty() {
                continue;
            }
            let category = classify_notification(&app_name, &title);
            results.push(OsNotification {
                app_name,
                title,
                body,
                timestamp: unix_ts,
                category,
            });
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("WPN read task panicked: {}", e))??;

    // Clean up temp file (best-effort)
    let _ = std::fs::remove_file(&temp_path);

    Ok(results)
}


#[cfg(target_os = "windows")]
fn extract_app_name_from_handler(handler: &str) -> String {
    // Handler format examples:
    //   "Windows.System.Toast!windows.immersivecontrolpanel_cw5n1h2txyewy!App"
    //   "Slack.exe"
    //   "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"
    if let Some(bang) = handler.find('!') {
        let pkg = &handler[..bang];
        // Package name is usually "Publisher.App_xxxx" — take the part before "_"
        let clean = pkg.split('_').next().unwrap_or(pkg);
        // Take the last segment after '.'
        clean.split('.').last().unwrap_or(clean).to_string()
    } else {
        // Bare executable
        handler
            .trim_end_matches(".exe")
            .split('\\')
            .last()
            .unwrap_or(handler)
            .to_string()
    }
}

#[cfg(target_os = "windows")]
async fn powershell_fallback(since_ts: i64) -> Vec<OsNotification> {
    // Query Application event log for toast-related events as a last resort
    let script = format!(
        r#"
$since = [DateTime]::FromFileTime({filetime})
$events = Get-WinEvent -FilterHashtable @{{LogName='Application'; StartTime=$since}} -MaxEvents 50 -ErrorAction SilentlyContinue
$results = @()
foreach ($e in $events) {{
    if ($e.Message -match 'toast|notification' -or $e.ProviderName -match 'toast') {{
        $results += [PSCustomObject]@{{
            Provider = $e.ProviderName
            Message  = ($e.Message -replace '\r?\n',' ')[0..200] -join ''
            TimeCreated = $e.TimeCreated.ToString('o')
        }}
    }}
}}
$results | ConvertTo-Json -Compress
"#,
        filetime = since_ts * 10_000_000 + 116_444_736_000_000_000i64
    );

    let out = crate::cmd_util::silent_tokio_cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .await;

    let out = match out {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "null" {
        return vec![];
    }

    let value: serde_json::Value = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(_) => return vec![],
    };

    let rows = if value.is_array() {
        value.as_array().cloned().unwrap_or_default()
    } else {
        vec![value]
    };

    let mut results = Vec::new();
    for row in rows {
        let app_name = row["Provider"].as_str().unwrap_or("System").to_string();
        let message = row["Message"].as_str().unwrap_or("").to_string();
        let time_str = row["TimeCreated"].as_str().unwrap_or("").to_string();
        let ts = chrono::DateTime::parse_from_rfc3339(&time_str)
            .map(|d| d.timestamp())
            .unwrap_or_else(|_| chrono::Utc::now().timestamp());

        if message.is_empty() {
            continue;
        }

        let category = classify_notification(&app_name, &message);
        results.push(OsNotification {
            app_name,
            title: crate::safe_slice(&message, 80).to_string(),
            body: crate::safe_slice(&message, 200).to_string(),
            timestamp: ts,
            category,
        });
    }

    results
}

#[cfg(target_os = "macos")]
async fn poll_notifications(since_ts: i64) -> Vec<OsNotification> {
    // macOS: use osascript to query Notification Center (limited access post-Catalina)
    // Best effort: show what we can from the user's notification preferences
    let script = r#"
tell application "System Events"
    -- macOS doesn't expose notification history via AppleScript easily
    -- return empty; user can see in Notification Center
end tell
"#;
    let _ = script; // suppress unused warning
    log::debug!("[notification_listener] macOS notification polling not fully supported — using event log");

    // Fallback: try reading macOS notification DB (Mojave+)
    read_macos_notification_db(since_ts).await
}

#[cfg(target_os = "macos")]
async fn read_macos_notification_db(since_ts: i64) -> Vec<OsNotification> {
    let home = std::env::var("HOME").unwrap_or_default();
    let db_path = format!(
        "{}/Library/Application Support/com.apple.notificationcenter/db2/db",
        home
    );

    if !std::path::Path::new(&db_path).exists() {
        return vec![];
    }

    // Use sqlite3 CLI — macOS ships it
    let query = format!(
        "SELECT app_id, title, subtitle, body, delivered_time FROM record WHERE delivered_time > {} ORDER BY delivered_time DESC LIMIT 20",
        since_ts
    );
    let out = crate::cmd_util::silent_tokio_cmd("sqlite3")
        .args([&db_path, "-separator", "|", &query])
        .output()
        .await;

    let out = match out {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut results = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(5, '|').collect();
        if parts.len() < 5 {
            continue;
        }
        let app_name = parts[0].to_string();
        let title = parts[1].to_string();
        let _subtitle = parts[2];
        let body = parts[3].to_string();
        let ts: i64 = parts[4].parse().unwrap_or(since_ts);
        // macOS stores time as seconds since 2001-01-01 (Core Data epoch)
        let unix_ts = ts + 978_307_200;
        let category = classify_notification(&app_name, &title);
        results.push(OsNotification {
            app_name,
            title,
            body,
            timestamp: unix_ts,
            category,
        });
    }
    results
}

#[cfg(target_os = "linux")]
async fn poll_notifications(_since_ts: i64) -> Vec<OsNotification> {
    // Linux: there is no universal notification history DB.
    // Best effort: tail the D-Bus session log or use notify-send --print-id
    // For now, return empty — BLADE can capture notifications via its own
    // tauri_plugin_notification when it fires them, and users can set up
    // dunst/mako history backends.
    log::debug!("[notification_listener] Linux notification polling not implemented — install dunst for history");
    vec![]
}

// ── XML payload parser ─────────────────────────────────────────────────────────

/// Parse a Windows toast XML payload and extract (title, body).
/// Toast XML looks like:
///   <toast><visual><binding><text id="1">Title</text><text id="2">Body</text></binding></visual></toast>
fn parse_toast_xml(xml: &str) -> (String, String) {
    if xml.is_empty() {
        return (String::new(), String::new());
    }

    let mut title = String::new();
    let mut body = String::new();

    // Simple regex-free extraction of <text> elements
    let mut remaining = xml;
    let mut texts: Vec<String> = Vec::new();

    while let Some(start) = remaining.find("<text") {
        let after_tag = &remaining[start..];
        // Find end of opening tag
        if let Some(close_bracket) = after_tag.find('>') {
            let content_start = close_bracket + 1;
            let content_section = &after_tag[content_start..];
            if let Some(end_tag) = content_section.find("</text>") {
                let text = content_section[..end_tag].trim();
                if !text.is_empty() {
                    texts.push(text.to_string());
                }
                remaining = &content_section[end_tag + 7..];
            } else {
                break;
            }
        } else {
            break;
        }
    }

    if !texts.is_empty() {
        title = texts[0].clone();
    }
    if texts.len() > 1 {
        body = texts[1..].join(" — ");
    }

    // HTML entity decode basics
    let title = title
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    let body = body
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");

    (title, body)
}

// ── Classification ─────────────────────────────────────────────────────────────

/// Classify a notification into a category string.
pub fn classify_notification(app_name: &str, title: &str) -> String {
    let app_lower = app_name.to_lowercase();
    let title_lower = title.to_lowercase();

    // Messaging apps
    if app_lower.contains("slack")
        || app_lower.contains("teams")
        || app_lower.contains("discord")
        || app_lower.contains("telegram")
        || app_lower.contains("whatsapp")
        || app_lower.contains("signal")
        || app_lower.contains("outlook")
        || app_lower.contains("gmail")
        || app_lower.contains("mail")
        || app_lower.contains("messages")
        || title_lower.contains("message")
        || title_lower.contains("dm")
        || title_lower.contains("chat")
        || title_lower.contains("reply")
        || title_lower.contains("mentioned you")
    {
        return "message".to_string();
    }

    // Reminders / calendar / task managers
    if app_lower.contains("reminder")
        || app_lower.contains("calendar")
        || app_lower.contains("todo")
        || app_lower.contains("task")
        || app_lower.contains("alarm")
        || app_lower.contains("notion")
        || app_lower.contains("linear")
        || app_lower.contains("jira")
        || title_lower.contains("reminder")
        || title_lower.contains("due")
        || title_lower.contains("meeting")
        || title_lower.contains("event")
        || title_lower.contains("appointment")
    {
        return "reminder".to_string();
    }

    // Updates / installs
    if app_lower.contains("update")
        || app_lower.contains("store")
        || app_lower.contains("winget")
        || app_lower.contains("defender")
        || app_lower.contains("security")
        || title_lower.contains("update")
        || title_lower.contains("upgrade")
        || title_lower.contains("install")
        || title_lower.contains("new version")
        || title_lower.contains("patch")
    {
        return "update".to_string();
    }

    // Alerts / errors / warnings
    if title_lower.contains("error")
        || title_lower.contains("warning")
        || title_lower.contains("alert")
        || title_lower.contains("failed")
        || title_lower.contains("critical")
        || title_lower.contains("urgent")
        || app_lower.contains("defender")
        || app_lower.contains("firewall")
    {
        return "alert".to_string();
    }

    "other".to_string()
}
