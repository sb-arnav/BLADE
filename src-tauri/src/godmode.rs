/// God Mode v2 — JARVIS-level ambient intelligence.
///
/// Three tiers, each building on the previous:
///   Normal       — 5 min: intelligence brief (3 lines), system vitals, active context
///   Intermediate — 2 min: + clipboard intelligence, cross-session memory recall, error detection
///   Extreme      — 1 min: + screen vision (screenshot → understanding), proactive task queue
///
/// Key design principle: BRIEF, not dump. Every scan produces a concise intelligence
/// brief, not a 2000-char markdown wall. The model should read it in <2 seconds.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};

// ── Stuck Error Detection ───────────────────────────────────────────────────

struct StuckErrorState {
    fingerprint: String,
    first_seen: i64,
    scan_count: u32,
    interrupted: bool,
}

static STUCK_ERROR: OnceLock<Mutex<Option<StuckErrorState>>> = OnceLock::new();

fn stuck_error() -> &'static Mutex<Option<StuckErrorState>> {
    STUCK_ERROR.get_or_init(|| Mutex::new(None))
}

fn check_smart_interrupt(app: &tauri::AppHandle, error_preview: &str) {
    let now = chrono::Utc::now().timestamp();
    let fingerprint = crate::safe_slice(error_preview, 120).to_string();

    let mut guard = match stuck_error().lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    match guard.as_mut() {
        Some(state) if state.fingerprint == fingerprint => {
            state.scan_count += 1;
            let elapsed = now - state.first_seen;
            if elapsed >= 300 && state.scan_count >= 2 && !state.interrupted {
                state.interrupted = true;
                let preview = crate::safe_slice(error_preview, 200).to_string();
                let elapsed_min = elapsed / 60;
                let _ = app.emit("smart_interrupt", serde_json::json!({
                    "error_preview": preview,
                    "elapsed_minutes": elapsed_min,
                    "suggested_prompt": format!(
                        "I've been stuck on this for {} minutes — can you help?\n\n```\n{}\n```",
                        elapsed_min, preview
                    ),
                }));
            }
        }
        _ => {
            *guard = Some(StuckErrorState {
                fingerprint,
                first_seen: now,
                scan_count: 1,
                interrupted: false,
            });
        }
    }
}

// ── Proactive Task Queue ────────────────────────────────────────────────────

static PROACTIVE_TASKS: OnceLock<Mutex<Vec<ProactiveTask>>> = OnceLock::new();

fn proactive_tasks() -> &'static Mutex<Vec<ProactiveTask>> {
    PROACTIVE_TASKS.get_or_init(|| Mutex::new(Vec::new()))
}

#[derive(Clone, serde::Serialize)]
pub struct ProactiveTask {
    id: String,
    suggestion: String,
    category: String, // "error", "optimization", "reminder", "insight"
    created_at: i64,
}

fn queue_proactive_task(app: &tauri::AppHandle, suggestion: &str, category: &str) {
    let task = ProactiveTask {
        id: format!("pt-{}", chrono::Utc::now().timestamp_millis()),
        suggestion: suggestion.to_string(),
        category: category.to_string(),
        created_at: chrono::Utc::now().timestamp(),
    };

    if let Ok(mut tasks) = proactive_tasks().lock() {
        // Don't duplicate similar suggestions
        if tasks.iter().any(|t| t.suggestion == task.suggestion) {
            return;
        }
        tasks.push(task.clone());
        // Keep max 10 pending tasks
        if tasks.len() > 10 {
            tasks.remove(0);
        }
    }

    let _ = app.emit("proactive_suggestion", &task);
}

#[tauri::command]
pub fn get_proactive_tasks() -> Vec<ProactiveTask> {
    proactive_tasks().lock().map(|t| t.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn dismiss_proactive_task(task_id: String) {
    if let Ok(mut tasks) = proactive_tasks().lock() {
        tasks.retain(|t| t.id != task_id);
    }
}

// ── God Mode Loop ───────────────────────────────────────────────────────────

pub fn start_god_mode(app: tauri::AppHandle, tier: &str) {
    // Start Total Recall if enabled
    {
        let config = crate::config::load_config();
        if config.screen_timeline_enabled {
            crate::screen_timeline::start_timeline_capture_loop(app.clone());
        }
    }

    let tier = tier.to_string();
    tauri::async_runtime::spawn(async move {
        let mut first_run = true;
        let mut last_brief = String::new();

        loop {
            if !first_run {
                let interval_secs = match tier.as_str() {
                    "extreme" => 60,
                    "intermediate" => 120,
                    _ => 300,
                };
                tokio::time::sleep(Duration::from_secs(interval_secs)).await;
            }
            first_run = false;

            let config = crate::config::load_config();
            if !config.god_mode {
                let _ = app.emit("godmode_stopped", ());
                break;
            }

            // ── Run perception fusion first — all downstream uses share this snapshot ──
            let perception = tokio::task::spawn_blocking(
                crate::perception_fusion::update_perception
            )
            .await
            .unwrap_or_default();

            // Build the intelligence brief using the fresh perception state
            let brief = build_intelligence_brief(&tier, &last_brief, &perception);

            // Write context file for injection into chat
            let path = crate::config::blade_config_dir().join("godmode_context.md");
            let _ = std::fs::write(&path, &brief);

            // Smart interrupt: detect stuck errors (intermediate+)
            if tier == "intermediate" || tier == "extreme" {
                if let Some(error_section) = extract_error_from_context(&brief) {
                    check_smart_interrupt(&app, &error_section);
                } else {
                    if let Ok(mut guard) = stuck_error().lock() {
                        *guard = None;
                    }
                }
            }

            // Extreme: screen vision + decision gate for proactive actions
            if tier == "extreme" {
                if let Some(understanding) = screen_vision_snapshot() {
                    // Append vision context to the brief file
                    let path = crate::config::blade_config_dir().join("godmode_context.md");
                    if let Ok(mut contents) = std::fs::read_to_string(&path) {
                        contents.push_str(&format!("\n\n{}", understanding));
                        let _ = std::fs::write(&path, &contents);
                    }
                }

                // Route proactive signals through decision gate before acting
                let proactive_app = app.clone();
                let perception_clone = perception.clone();
                tokio::spawn(async move {
                    evaluate_and_queue_proactive_actions(&proactive_app, &perception_clone).await;
                });
            }

            // Emit update event — include perception delta for the UI
            let _ = app.emit("godmode_update", serde_json::json!({
                "bytes": brief.len(),
                "tier": &tier,
                "delta": &perception.delta_summary,
                "user_state": &perception.user_state,
                "context_tags": &perception.context_tags,
            }));

            // Embed into vector store for cross-session recall
            if brief.len() > 100 {
                let store = app.state::<crate::embeddings::SharedVectorStore>();
                let store_clone = store.inner().clone();
                let brief_clone = brief.clone();
                let ts = chrono::Utc::now().timestamp().to_string();
                tokio::spawn(async move {
                    crate::embeddings::auto_embed_exchange(
                        &store_clone,
                        crate::safe_slice(&brief_clone, 800),
                        "",
                        &format!("godmode-{}", ts),
                    );
                });
            }

            // Persist to activity timeline
            {
                let db_path = crate::config::blade_config_dir().join("blade.db");
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let title = brief.lines()
                        .find(|l| l.starts_with("**Doing:**") || l.starts_with("**Focus:**"))
                        .map(|l| l.trim().to_string())
                        .unwrap_or_else(|| "God Mode scan".to_string());
                    let snippet = crate::safe_slice(&brief, 1000);
                    let _ = crate::db::timeline_record(
                        &conn,
                        "god_mode",
                        &title,
                        snippet,
                        "",
                        &format!("{{\"tier\":\"{}\"}}", tier),
                    );
                }
            }

            // Evolution engine feed (async, non-blocking)
            {
                let ev_app = app.clone();
                tokio::spawn(async move {
                    crate::evolution::run_evolution_cycle(&ev_app).await;
                });
            }

            last_brief = brief;
        }
    });
}

/// Evaluate outstanding proactive signals through the decision gate.
/// Only signals cleared as ActAutonomously are queued for the frontend.
async fn evaluate_and_queue_proactive_actions(
    app: &tauri::AppHandle,
    perception: &crate::perception_fusion::PerceptionState,
) {
    use crate::decision_gate::{DecisionOutcome, Signal, evaluate_and_record};

    // Build signals from current perception state
    let mut signals: Vec<Signal> = Vec::new();

    // Error detected → high-confidence, reversible (just showing notification)
    if !perception.visible_errors.is_empty() {
        signals.push(Signal {
            source: "god_mode_error".to_string(),
            description: format!(
                "Error detected: {}",
                crate::safe_slice(&perception.visible_errors[0], 120)
            ),
            confidence: 0.88,
            reversible: true,
            time_sensitive: true,
        });
    }

    // Disk low warning
    if perception.disk_free_gb > 0.0 && perception.disk_free_gb < 5.0 {
        signals.push(Signal {
            source: "god_mode_vitals".to_string(),
            description: format!(
                "Disk space critically low: {:.1}GB free — consider cleanup",
                perception.disk_free_gb
            ),
            confidence: 0.95,
            reversible: true,
            time_sensitive: false,
        });
    }

    // Context shift worth noting
    if !perception.delta_summary.is_empty()
        && perception.delta_summary != "No significant changes"
        && !perception.delta_summary.starts_with("Initial")
    {
        signals.push(Signal {
            source: "god_mode_context".to_string(),
            description: format!("Context shift: {}", perception.delta_summary),
            confidence: 0.6,
            reversible: true,
            time_sensitive: false,
        });
    }

    for signal in signals {
        let (_, outcome) = evaluate_and_record(signal, perception).await;
        match outcome {
            DecisionOutcome::ActAutonomously { action, reasoning } => {
                queue_proactive_task(app, &action, "insight");
                log::debug!("[GodMode] Autonomous action queued: {} (reason: {})", action, reasoning);
            }
            DecisionOutcome::AskUser { question, .. } => {
                queue_proactive_task(app, &question, "reminder");
            }
            DecisionOutcome::QueueForLater { task, .. } => {
                queue_proactive_task(app, &task, "optimization");
            }
            DecisionOutcome::Ignore { .. } => {}
        }
    }
}

fn extract_error_from_context(ctx: &str) -> Option<String> {
    if let Some(pos) = ctx.find("ERROR DETECTED") {
        let section = &ctx[pos..];
        let end = section.find("\n\n").unwrap_or(section.len());
        let content = section[..end].trim().to_string();
        if content.len() > 20 {
            return Some(content);
        }
    }
    None
}

pub fn stop_god_mode() {
    let path = crate::config::blade_config_dir().join("godmode_context.md");
    let _ = std::fs::remove_file(path);
}

pub fn load_godmode_context() -> Option<String> {
    let path = crate::config::blade_config_dir().join("godmode_context.md");
    std::fs::read_to_string(path).ok()
}

// ── Intelligence Brief Builder ──────────────────────────────────────────────

fn build_intelligence_brief(
    tier: &str,
    last_brief: &str,
    perception: &crate::perception_fusion::PerceptionState,
) -> String {
    let now = chrono::Local::now();
    let mut lines: Vec<String> = Vec::new();

    // Header — one line, not a wall
    lines.push(format!("## God Mode | {} | {}", tier, now.format("%H:%M")));

    // ── Line 1: What you're doing right now (from fused perception) ──
    let focus = if !perception.active_app.is_empty() {
        if !perception.active_title.is_empty() {
            format!(
                "{} — {}",
                perception.active_app,
                crate::safe_slice(&perception.active_title, 60)
            )
        } else {
            perception.active_app.clone()
        }
    } else {
        get_current_focus()
    };
    lines.push(format!("**Focus:** {}", focus));

    // ── Line 2: What changed since last scan (perception delta) ──
    let delta = if !perception.delta_summary.is_empty()
        && perception.delta_summary != "No significant changes"
        && !perception.delta_summary.starts_with("Initial")
    {
        perception.delta_summary.clone()
    } else {
        get_delta_since_last(last_brief)
    };
    if !delta.is_empty() && delta != "No significant changes" {
        lines.push(format!("**Changed:** {}", delta));
    }

    // ── Line 3: System vitals from perception (falls back to live query) ──
    let vitals = if perception.disk_free_gb > 0.0 || perception.ram_used_gb > 0.0 {
        let mut parts: Vec<String> = Vec::new();
        if perception.disk_free_gb > 0.0 {
            let warn = if perception.disk_free_gb < 5.0 { " (LOW!)" } else { "" };
            parts.push(format!("Disk: {:.1}GB free{}", perception.disk_free_gb, warn));
        }
        if perception.ram_used_gb > 0.0 {
            parts.push(format!("RAM: {:.1}GB used", perception.ram_used_gb));
        }
        if !perception.top_cpu_process.is_empty() {
            parts.push(format!("Top CPU: {}", &perception.top_cpu_process));
        }
        parts.join(" | ")
    } else {
        get_system_vitals()
    };
    lines.push(format!("**System:** {}", vitals));

    // ── User state from perception ──
    lines.push(format!("**User:** {}", perception.user_state));

    // ── Context tags ──
    if !perception.context_tags.is_empty() {
        lines.push(format!("**Context:** {}", perception.context_tags.join(", ")));
    }

    // ── User identity (compact, always injected) ──
    if let Some(user) = who_is_the_user_compact() {
        lines.push(format!("\n{}", user));
    }

    // ── Intermediate+: clipboard intelligence + error detection + recall ──
    if tier == "intermediate" || tier == "extreme" {
        // Clipboard from perception state (already classified)
        if !perception.clipboard_preview.is_empty() {
            lines.push(format!(
                "\n**Clipboard ({}):** {}",
                perception.clipboard_type,
                crate::safe_slice(&perception.clipboard_preview, 120)
            ));
        }

        // Errors from perception (visible_errors already deduplicated)
        if !perception.visible_errors.is_empty() {
            let err_preview = crate::safe_slice(&perception.visible_errors[0], 200);
            lines.push(format!("\n**ERROR DETECTED:** {}", err_preview));
        } else if let Some(err) = detect_active_errors() {
            // Fallback to live detection if perception missed it
            lines.push(format!("\n**ERROR DETECTED:** {}", err));
        }

        // Cross-session recall — what were you doing at this time yesterday?
        if let Some(recall) = cross_session_recall() {
            lines.push(format!("\n**Yesterday at this time:** {}", recall));
        }
    }

    // ── Extreme: proactive directives ──
    if tier == "extreme" {
        lines.push("\n**Mode: JARVIS** — Proactive. Anticipate. Execute. Don't wait for instructions.".to_string());
    }

    lines.join("\n")
}

// ── Focus: What the user is doing RIGHT NOW ─────────────────────────────────

fn get_current_focus() -> String {
    // Active window (most important signal)
    if let Ok(win) = crate::context::get_active_window() {
        if !win.app_name.is_empty() {
            let title_preview = crate::safe_slice(&win.window_title, 60);
            if !title_preview.is_empty() {
                return format!("{} — {}", win.app_name, title_preview);
            } else {
                return win.app_name.clone();
            }
        }
    }

    "Unknown (no active window detected)".to_string()
}

// ── Delta: What changed since last scan ─────────────────────────────────────

fn get_delta_since_last(last_brief: &str) -> String {
    let mut changes: Vec<String> = Vec::new();

    // Check if active window changed
    let current_focus = get_current_focus();
    if !last_brief.is_empty() {
        let last_focus = last_brief.lines()
            .find(|l| l.starts_with("**Focus:**"))
            .map(|l| l.trim_start_matches("**Focus:**").trim().to_string())
            .unwrap_or_default();
        if !last_focus.is_empty() && last_focus != current_focus {
            changes.push(format!("Switched from {}", last_focus.split(" — ").next().unwrap_or(&last_focus)));
        }
    }

    // Recent file modifications (last N minutes based on tier)
    if let Some(recent) = get_recently_modified_files(5) {
        changes.push(recent);
    }

    if changes.is_empty() {
        "No significant changes".to_string()
    } else {
        changes.join("; ")
    }
}

fn get_recently_modified_files(minutes: u64) -> Option<String> {
    let home = dirs::home_dir()?;
    let cutoff = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(minutes * 60))
        .unwrap_or(std::time::UNIX_EPOCH);

    let search_dirs = vec![
        home.join("Desktop"),
        home.join("Documents"),
        home.join("Downloads"),
    ];

    let mut count = 0u32;
    let mut latest_name = String::new();

    for dir in search_dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten().take(50) {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if modified >= cutoff && !meta.is_dir() {
                            count += 1;
                            if latest_name.is_empty() {
                                latest_name = entry.file_name().to_string_lossy().to_string();
                            }
                        }
                    }
                }
            }
        }
    }

    if count == 0 { return None; }
    if count == 1 {
        Some(format!("{} modified", latest_name))
    } else {
        Some(format!("{} files modified (latest: {})", count, latest_name))
    }
}

// ── System Vitals ───────────────────────────────────────────────────────────

fn get_system_vitals() -> String {
    let mut parts: Vec<String> = Vec::new();

    // Disk space
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = crate::cmd_util::silent_cmd("powershell")
            .args(["-Command", "(Get-PSDrive C).Free / 1GB"])
            .output()
        {
            if out.status.success() {
                let free_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(free_gb) = free_str.parse::<f64>() {
                    let warning = if free_gb < 5.0 { " (LOW!)" } else { "" };
                    parts.push(format!("Disk: {:.1}GB free{}", free_gb, warning));
                }
            }
        }
    }

    // Memory usage
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = crate::cmd_util::silent_cmd("powershell")
            .args(["-Command", "[math]::Round((Get-Process | Measure-Object WorkingSet64 -Sum).Sum / 1GB, 1)"])
            .output()
        {
            if out.status.success() {
                let used_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(used_gb) = used_str.parse::<f64>() {
                    parts.push(format!("RAM: {:.1}GB used", used_gb));
                }
            }
        }
    }

    // CPU — top process
    #[cfg(target_os = "windows")]
    {
        if let Ok(out) = crate::cmd_util::silent_cmd("powershell")
            .args(["-Command", "Get-Process | Sort-Object CPU -Descending | Select-Object -First 1 -ExpandProperty ProcessName"])
            .output()
        {
            if out.status.success() {
                let top = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !top.is_empty() {
                    parts.push(format!("Top CPU: {}", top));
                }
            }
        }
    }

    // macOS / Linux fallbacks
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(out) = crate::cmd_util::silent_cmd("df")
            .args(["-h", "/"])
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = text.lines().nth(1) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 4 {
                        parts.push(format!("Disk: {} free", cols[3]));
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        "Vitals unavailable".to_string()
    } else {
        parts.join(" | ")
    }
}

// ── Clipboard Intelligence ──────────────────────────────────────────────────

#[allow(dead_code)]
fn clipboard_intelligence() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    let text = clipboard.get_text().ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() { return None; }

    // Suppress very short (≤3 chars) or purely numeric content (timestamps, IDs, etc.)
    if trimmed.len() <= 3 || trimmed.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '_') {
        return None;
    }

    let lower = trimmed.to_lowercase();

    // URL → note it for context
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let url_preview = crate::safe_slice(trimmed, 80);
        let suffix = if trimmed.len() > 80 { "..." } else { "" };
        return Some(format!("URL copied: {}{}", url_preview, suffix));
    }

    // Error/traceback → flag it
    if lower.contains("traceback") || lower.contains("error:") ||
       lower.contains("exception") || lower.contains("panicked at") ||
       lower.contains("typeerror") || lower.contains("syntaxerror") ||
       lower.contains("fatal:") || lower.contains("undefined is not") {
        let preview = crate::safe_slice(trimmed, 150);
        return Some(format!("Error copied: `{}`", preview));
    }

    // Code → note language hint
    if trimmed.contains("fn ") || trimmed.contains("pub ") || trimmed.contains("impl ") {
        return Some(format!("Rust code copied ({} chars)", trimmed.len()));
    }
    if trimmed.contains("export ") || (trimmed.contains("const ") && trimmed.contains(": ")) {
        return Some(format!("JS/TS code copied ({} chars)", trimmed.len()));
    }
    if trimmed.contains("import ") && trimmed.contains("def ") {
        return Some(format!("Python code copied ({} chars)", trimmed.len()));
    }

    // Long text → just note size
    if trimmed.len() > 200 {
        return Some(format!("Text copied ({} chars)", trimmed.len()));
    }

    // Short text → show it
    Some(format!("\"{}\"", crate::safe_slice(trimmed, 80)))
}

// ── Error Detection ─────────────────────────────────────────────────────────

fn detect_active_errors() -> Option<String> {
    // Check clipboard for errors
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            let lower = text.to_lowercase();
            let is_error = lower.contains("traceback") || lower.contains("error:") ||
                lower.contains("exception") || lower.contains("panicked at") ||
                lower.contains("fatal:") || lower.contains("undefined is not");

            if is_error {
                return Some(crate::safe_slice(&text, 200).to_string());
            }
        }
    }

    // Check window title
    if let Ok(win) = crate::context::get_active_window() {
        let title_lower = win.window_title.to_lowercase();
        if title_lower.contains("error") || title_lower.contains("failed") ||
           title_lower.contains("crash") {
            return Some(win.window_title);
        }
    }

    None
}

// ── Cross-Session Memory Recall ─────────────────────────────────────────────

fn cross_session_recall() -> Option<String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;

    // What was happening ~24h ago?
    let yesterday = chrono::Utc::now().timestamp() - 86400;
    let window = 1800; // 30 min window

    let result: Option<String> = conn.query_row(
        "SELECT snippet FROM timeline WHERE event_type = 'god_mode' AND created_at BETWEEN ?1 AND ?2 ORDER BY created_at DESC LIMIT 1",
        rusqlite::params![yesterday - window, yesterday + window],
        |row| row.get(0),
    ).ok();

    if let Some(snippet) = result {
        // Extract just the focus line from yesterday's brief
        let focus = snippet.lines()
            .find(|l| l.starts_with("**Focus:**"))
            .map(|l| l.trim_start_matches("**Focus:**").trim().to_string());

        if let Some(f) = focus {
            if !f.is_empty() && f != "Unknown (no active window detected)" {
                return Some(f);
            }
        }
    }

    None
}

// ── Screen Vision (Extreme only) ────────────────────────────────────────────

fn screen_vision_snapshot() -> Option<String> {
    // Guard: catch any panic from xcap (some GPU drivers can cause issues)
    let result = std::panic::catch_unwind(|| {
        let monitors = xcap::Monitor::all().ok()?;
        let monitor = monitors.into_iter().next()?;
        let image = monitor.capture_image().ok()?;

        // Save to temp for potential vision model analysis
        let temp_path = crate::config::blade_config_dir().join("godmode_screen.png");
        // save() can fail if path doesn't exist or disk is full — that's fine
        let saved = image.save(&temp_path).is_ok();

        let (w, h) = (image.width(), image.height());
        let save_note = if saved { "saved" } else { "capture failed to save" };
        Some(format!("**Screen:** {}x{} captured ({})", w, h, save_note))
    });

    match result {
        Ok(inner) => inner,
        Err(_) => {
            log::warn!("[GodMode] screen_vision_snapshot panicked (xcap failure) — skipping");
            None
        }
    }
}

// ── Compact User Identity ───────────────────────────────────────────────────

fn who_is_the_user_compact() -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    // Persona.md
    let persona_path = crate::config::blade_config_dir().join("persona.md");
    if let Ok(persona) = std::fs::read_to_string(&persona_path) {
        let trimmed = persona.trim();
        if !trimmed.is_empty() {
            // Just first 2 lines — enough to know who they are
            let preview: String = trimmed.lines()
                .take(2)
                .collect::<Vec<&str>>()
                .join(" | ");
            parts.push(preview);
        }
    }

    // Top traits (1-liner)
    let traits = crate::persona_engine::get_all_traits();
    let top_traits: Vec<String> = traits
        .iter()
        .filter(|t| t.confidence > 0.6 && t.score > 0.5)
        .take(3)
        .map(|t| t.trait_name.clone())
        .collect();
    if !top_traits.is_empty() {
        parts.push(format!("Traits: {}", top_traits.join(", ")));
    }

    if parts.is_empty() { return None; }

    Some(format!("**User:** {}", parts.join(" | ")))
}
