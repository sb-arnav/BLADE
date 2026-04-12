/// God Mode — 24/7 background machine intelligence.
/// Three tiers:
///   Normal      — 5 min scan: recent files, downloads, running apps, monitors
///   Intermediate — 2 min scan: everything above + clipboard + active window
///   Extreme     — 1 min scan: everything above + proactive action suggestions injected into every prompt
///
/// Writes a live context file injected into every Blade conversation.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};

/// Tracks the last error signature seen by God Mode for smart interrupt detection.
struct StuckErrorState {
    fingerprint: String,     // hash/preview of the error
    first_seen: i64,         // unix timestamp when first detected
    scan_count: u32,         // how many consecutive scans with same error
    interrupted: bool,       // already fired interrupt for this session
}

static STUCK_ERROR: OnceLock<Mutex<Option<StuckErrorState>>> = OnceLock::new();

fn stuck_error() -> &'static Mutex<Option<StuckErrorState>> {
    STUCK_ERROR.get_or_init(|| Mutex::new(None))
}

/// Check if the user appears stuck on the same error and emit smart_interrupt if so.
/// Called after each god mode scan that found errors.
fn check_smart_interrupt(app: &tauri::AppHandle, error_preview: &str) {
    let now = chrono::Utc::now().timestamp();
    // Use first 120 chars as fingerprint
    let fingerprint = error_preview[..error_preview.len().min(120)].to_string();

    let mut guard = match stuck_error().lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    match guard.as_mut() {
        Some(state) if state.fingerprint == fingerprint => {
            state.scan_count += 1;
            let elapsed = now - state.first_seen;
            // Fire interrupt after 5+ minutes (300s) and at least 2 scans, once per error session
            if elapsed >= 300 && state.scan_count >= 2 && !state.interrupted {
                state.interrupted = true;
                let preview = error_preview[..error_preview.len().min(200)].to_string();
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
            // New error or different error — reset state
            *guard = Some(StuckErrorState {
                fingerprint,
                first_seen: now,
                scan_count: 1,
                interrupted: false,
            });
        }
    }
}

pub fn start_god_mode(app: tauri::AppHandle, tier: &str) {
    // Start Total Recall screen timeline if enabled
    {
        let config = crate::config::load_config();
        if config.screen_timeline_enabled {
            crate::screen_timeline::start_timeline_capture_loop(app.clone());
        }
    }

    let tier = tier.to_string();
    tauri::async_runtime::spawn(async move {
        let mut first_run = true;

        loop {
            if !first_run {
                let interval_secs = match tier.as_str() {
                    "extreme" => 60,
                    "intermediate" => 120,
                    _ => 300, // normal
                };
                tokio::time::sleep(Duration::from_secs(interval_secs)).await;
            }
            first_run = false;

            // Stop if god mode was disabled
            let config = crate::config::load_config();
            if !config.god_mode {
                let _ = app.emit("godmode_stopped", ());
                break;
            }

            let ctx = build_machine_context(&config.god_mode_tier);
            let path = crate::config::blade_config_dir().join("godmode_context.md");
            let _ = std::fs::write(&path, &ctx);

            // SMART INTERRUPT: detect if user is stuck on the same error
            if config.god_mode_tier == "intermediate" || config.god_mode_tier == "extreme" {
                if let Some(error_section) = extract_error_from_context(&ctx) {
                    check_smart_interrupt(&app, &error_section);
                } else {
                    // No current error — clear stuck state
                    if let Ok(mut guard) = stuck_error().lock() {
                        *guard = None;
                    }
                }
            }

            let _ = app.emit("godmode_update", serde_json::json!({
                "bytes": ctx.len(),
                "tier": &config.god_mode_tier,
            }));

            // SIGNAL BUS: embed interesting snapshots into vector store
            // so Blade can semantically recall "what was happening when X"
            if ctx.len() > 100 {
                let store = app.state::<crate::embeddings::SharedVectorStore>();
                let store_clone = store.inner().clone();
                let ctx_clone = ctx.clone();
                let ts = chrono::Utc::now().timestamp().to_string();
                tokio::spawn(async move {
                    crate::embeddings::auto_embed_exchange(
                        &store_clone,
                        &ctx_clone[..ctx_clone.len().min(800)],
                        "",
                        &format!("godmode-{}", ts),
                    );
                });
            }

            // ACTIVITY TIMELINE: persist this snapshot as a timeline event
            {
                let db_path = crate::config::blade_config_dir().join("blade.db");
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let title = ctx.lines()
                        .find(|l| l.starts_with("**Active:**") || l.contains("Active Window"))
                        .map(|l| l.replace("**Active:**", "").trim().to_string())
                        .unwrap_or_else(|| "Machine snapshot".to_string());
                    let snippet = &ctx[..ctx.len().min(1000)];
                    let _ = crate::db::timeline_record(
                        &conn,
                        "god_mode",
                        &title,
                        snippet,
                        "",
                        &format!("{{\"tier\":\"{}\"}}", config.god_mode_tier),
                    );
                }
            }

            // EVOLUTION: feed fresh god mode data into the evolution engine
            // Run async — don't block the god mode loop
            {
                let ev_app = app.clone();
                tokio::spawn(async move {
                    crate::evolution::run_evolution_cycle(&ev_app).await;
                });
            }
        }
    });
}

/// Extract the error preview from a godmode context string, if an error section exists.
fn extract_error_from_context(ctx: &str) -> Option<String> {
    if let Some(pos) = ctx.find("### Active Errors Detected") {
        let section = &ctx[pos..];
        let end = section.find("\n\n## ").unwrap_or(section.len());
        let content = section[..end].trim().to_string();
        if content.len() > 30 {
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

fn build_machine_context(tier: &str) -> String {
    let now = chrono::Local::now();
    let interval_label = match tier {
        "extreme" => "1 min",
        "intermediate" => "2 min",
        _ => "5 min",
    };
    let mut sections: Vec<String> = vec![
        format!(
            "## Live Machine Context\n_Tier: {} | Scan interval: {} | Last scan: {}_",
            tier, interval_label, now.format("%H:%M %p")
        )
    ];

    if let Some(s) = recent_files_section() { sections.push(s); }
    if let Some(s) = downloads_section() { sections.push(s); }
    if let Some(s) = running_apps_section() { sections.push(s); }
    if let Some(s) = monitor_section() { sections.push(s); }
    if let Some(s) = git_repos_section() { sections.push(s); }

    // Intermediate+ extras
    if tier == "intermediate" || tier == "extreme" {
        if let Some(s) = clipboard_section() { sections.push(s); }
        if let Some(s) = active_window_section() { sections.push(s); }
        if let Some(s) = active_errors_section() { sections.push(s); }
    }

    // Extreme: inject behavioral directive
    if tier == "extreme" {
        sections.push(
            "### Extreme Mode Directive\n\
             You are in JARVIS mode. You have full context of this machine. \
             For every user message, proactively suggest the single most valuable action you could take \
             right now based on what you can see — files, apps, clipboard, activity. \
             Do not wait to be asked. If you see something that needs doing, say so and offer to do it. \
             Execute tasks autonomously when the user approves. \
             You are not an assistant waiting for instructions. You are an active co-pilot."
                .to_string(),
        );
    }

    sections.join("\n\n")
}

fn recent_files_section() -> Option<String> {
    let home = dirs::home_dir()?;
    let cutoff = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(86400))
        .unwrap_or(std::time::UNIX_EPOCH);

    let search_dirs = vec![
        home.join("Desktop"),
        home.join("Documents"),
        home.join("Downloads"),
        home.join("projects"),
        home.join("dev"),
        home.join("code"),
    ];

    let mut files: Vec<(std::time::SystemTime, String)> = Vec::new();

    for dir in search_dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if modified >= cutoff && !meta.is_dir() {
                            let name = format!(
                                "{}/{}",
                                dir.file_name()?.to_string_lossy(),
                                entry.file_name().to_string_lossy()
                            );
                            files.push((modified, name));
                        }
                    }
                }
            }
        }
    }

    if files.is_empty() { return None; }

    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(12);

    let lines: Vec<String> = files.iter().map(|(t, name)| {
        let dt: chrono::DateTime<chrono::Local> = (*t).into();
        format!("- {} ({})", name, dt.format("%H:%M"))
    }).collect();

    Some(format!("### Modified in Last 24h\n{}", lines.join("\n")))
}

fn downloads_section() -> Option<String> {
    let dir = dirs::home_dir()?.join("Downloads");
    let cutoff = std::time::SystemTime::now()
        .checked_sub(Duration::from_secs(7 * 86400))
        .unwrap_or(std::time::UNIX_EPOCH);

    let mut files: Vec<(std::time::SystemTime, u64, String)> = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?;
            if modified < cutoff || meta.is_dir() { return None; }
            Some((modified, meta.len(), e.file_name().to_string_lossy().to_string()))
        })
        .collect();

    if files.is_empty() { return None; }

    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(8);

    let lines: Vec<String> = files.iter().map(|(t, size, name)| {
        let dt: chrono::DateTime<chrono::Local> = (*t).into();
        let sz = if *size >= 1_000_000 { format!("{:.1}MB", *size as f64 / 1_000_000.0) }
                 else if *size >= 1_000 { format!("{:.0}KB", *size as f64 / 1_000.0) }
                 else { format!("{}B", size) };
        format!("- {} — {} ({})", name, sz, dt.format("%b %d %H:%M"))
    }).collect();

    Some(format!("### Downloads (Last 7 Days)\n{}", lines.join("\n")))
}

fn running_apps_section() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let out = Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;

        let text = String::from_utf8_lossy(&out.stdout);
        let mut apps: std::collections::HashSet<String> = std::collections::HashSet::new();

        for line in text.lines() {
            let parts: Vec<&str> = line.splitn(2, "\",\"").collect();
            if let Some(name) = parts.first() {
                let clean = name.trim_matches('"');
                let lower = clean.to_lowercase();
                if lower.contains("system") || lower.contains("svchost") || lower.contains("runtime")
                    || lower.contains("ntoskrnl") || lower.contains("wininit") || lower.contains("csrss") {
                    continue;
                }
                let app = clean.trim_end_matches(".exe").to_string();
                if app.len() > 2 && app.len() < 30 {
                    apps.insert(app);
                }
            }
        }

        if apps.is_empty() { return None; }
        let mut sorted: Vec<String> = apps.into_iter().collect();
        sorted.sort();
        sorted.truncate(20);
        return Some(format!("### Running Apps\n{}", sorted.join(", ")));
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to get name of every process whose background only is false"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let apps: Vec<&str> = text.split(", ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        if apps.is_empty() { return None; }
        return Some(format!("### Running Apps\n{}", apps.join(", ")));
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let out = Command::new("ps")
            .args(["-eo", "comm="])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut apps: std::collections::HashSet<String> = text.lines()
            .map(|l| l.trim().to_string())
            .filter(|s| !s.is_empty() && s.len() < 30)
            .collect();
        let noise = ["sh", "bash", "zsh", "ps", "grep", "awk", "sed", "cat", "ls"];
        for n in &noise { apps.remove(*n); }
        if apps.is_empty() { return None; }
        let mut sorted: Vec<String> = apps.into_iter().collect();
        sorted.sort();
        sorted.truncate(20);
        return Some(format!("### Running Apps\n{}", sorted.join(", ")));
    }

    #[allow(unreachable_code)]
    None
}

fn monitor_section() -> Option<String> {
    let monitors = xcap::Monitor::all().ok()?;
    if monitors.is_empty() { return None; }

    let lines: Vec<String> = monitors.iter().enumerate().map(|(i, m)| {
        format!("- Monitor {}: {}x{}", i, m.width().unwrap_or(0), m.height().unwrap_or(0))
    }).collect();

    Some(format!("### Displays\n{}", lines.join("\n")))
}

fn clipboard_section() -> Option<String> {
    // Read clipboard via arboard (already a dep)
    let mut clipboard = arboard::Clipboard::new().ok()?;
    let text = clipboard.get_text().ok()?;
    if text.trim().is_empty() { return None; }
    // Truncate long content
    let preview = if text.len() > 400 {
        format!("{}...", &text[..400])
    } else {
        text.clone()
    };
    Some(format!("### Clipboard\n```\n{}\n```", preview))
}

fn active_window_section() -> Option<String> {
    let win = crate::context::get_active_window().ok()?;
    let mut parts = Vec::new();
    if !win.app_name.is_empty() { parts.push(format!("App: {}", win.app_name)); }
    if !win.window_title.is_empty() { parts.push(format!("Window: {}", win.window_title)); }
    if parts.is_empty() { return None; }
    Some(format!("### Active Window\n{}", parts.join("\n")))
}

/// Detect error/exception patterns in clipboard and active window title.
/// Surfaces active debugging context so BLADE can proactively help.
fn active_errors_section() -> Option<String> {
    let mut found: Vec<String> = Vec::new();

    // Check clipboard for error/traceback patterns
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            let lower = text.to_lowercase();
            let is_error = lower.contains("traceback") || lower.contains("error:") ||
                lower.contains("exception") || lower.contains("panicked at") ||
                lower.contains("cannot read") || lower.contains("typeerror") ||
                lower.contains("syntaxerror") || lower.contains("nameerror") ||
                lower.contains("valueerror") || lower.contains("attributeerror") ||
                lower.contains("nullpointerexception") || lower.contains("segfault") ||
                lower.contains("fatal:") || lower.contains("undefined is not");

            if is_error {
                let preview = &text[..text.len().min(300)];
                found.push(format!("**Clipboard contains error/traceback:**\n```\n{}\n```", preview));
            }
        }
    }

    // Check active window title for error signals
    if let Ok(win) = crate::context::get_active_window() {
        let title_lower = win.window_title.to_lowercase();
        if title_lower.contains("error") || title_lower.contains("failed") ||
            title_lower.contains("exception") || title_lower.contains("crash") {
            found.push(format!("**Active window suggests error:** {}", win.window_title));
        }
    }

    if found.is_empty() { return None; }

    Some(format!("### Active Errors Detected\n{}", found.join("\n\n")))
}

/// Scan common code directories for git repos and show their status.
/// Gives BLADE awareness of branches, dirty working trees, and ahead/behind state.
fn git_repos_section() -> Option<String> {
    use std::process::Command;

    let home = dirs::home_dir()?;
    // Common places devs keep repos
    let search_roots = [
        home.join("projects"),
        home.join("dev"),
        home.join("code"),
        home.join("src"),
        home.join("work"),
        home.join("repos"),
    ];

    let mut repo_lines: Vec<String> = Vec::new();

    for root in &search_roots {
        if !root.is_dir() { continue; }
        let entries = match std::fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten().take(8) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            let git_dir = path.join(".git");
            if !git_dir.exists() { continue; }

            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

            // Get branch
            let branch = Command::new("git")
                .args(["-C", &path.to_string_lossy(), "rev-parse", "--abbrev-ref", "HEAD"])
                .output()
                .ok()
                .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).trim().to_string()) } else { None })
                .unwrap_or_else(|| "unknown".to_string());

            // Dirty state: number of changed files
            let dirty_count = Command::new("git")
                .args(["-C", &path.to_string_lossy(), "status", "--porcelain"])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).lines().count())
                .unwrap_or(0);

            // Ahead/behind vs upstream
            let ahead_behind = Command::new("git")
                .args(["-C", &path.to_string_lossy(), "rev-list", "--count", "--left-right", "@{upstream}...HEAD"])
                .output()
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        let parts: Vec<&str> = s.split('\t').collect();
                        if parts.len() == 2 {
                            let behind: i32 = parts[0].parse().unwrap_or(0);
                            let ahead: i32 = parts[1].parse().unwrap_or(0);
                            Some((ahead, behind))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                });

            let mut status_parts = Vec::new();
            if dirty_count > 0 { status_parts.push(format!("{} changed", dirty_count)); }
            if let Some((ahead, behind)) = ahead_behind {
                if ahead > 0 { status_parts.push(format!("↑{}", ahead)); }
                if behind > 0 { status_parts.push(format!("↓{}", behind)); }
            }
            let status_str = if status_parts.is_empty() { "clean".to_string() } else { status_parts.join(", ") };

            repo_lines.push(format!("- **{}** `{}` — {}", name, branch, status_str));

            if repo_lines.len() >= 6 { break; }
        }
        if repo_lines.len() >= 6 { break; }
    }

    if repo_lines.is_empty() { return None; }

    Some(format!("### Git Repos\n{}", repo_lines.join("\n")))
}
