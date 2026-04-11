/// God Mode — 24/7 background machine intelligence.
/// Scans the user's filesystem, running apps, and recent activity every 5 min.
/// Writes a live context file that gets injected into every Blade conversation,
/// so short prompts work because Blade already knows what you're doing.

use std::time::Duration;
use tauri::Emitter;

pub fn start_god_mode(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut first_run = true;

        loop {
            if !first_run {
                tokio::time::sleep(Duration::from_secs(300)).await;
            }
            first_run = false;

            // Stop if god mode was disabled
            let config = crate::config::load_config();
            if !config.god_mode {
                let _ = app.emit("godmode_stopped", ());
                break;
            }

            let ctx = build_machine_context();
            let path = crate::config::blade_config_dir().join("godmode_context.md");
            let _ = std::fs::write(&path, &ctx);

            let _ = app.emit("godmode_update", serde_json::json!({
                "bytes": ctx.len()
            }));
        }
    });
}

pub fn stop_god_mode() {
    // Clearing the file signals the next cycle to stop
    let path = crate::config::blade_config_dir().join("godmode_context.md");
    let _ = std::fs::remove_file(path);
}

pub fn load_godmode_context() -> Option<String> {
    let path = crate::config::blade_config_dir().join("godmode_context.md");
    std::fs::read_to_string(path).ok()
}

fn build_machine_context() -> String {
    let now = chrono::Local::now();
    let mut sections: Vec<String> = vec![
        format!("## Live Machine Context\n_Last scanned: {}_", now.format("%H:%M %p"))
    ];

    if let Some(s) = recent_files_section() { sections.push(s); }
    if let Some(s) = downloads_section() { sections.push(s); }
    if let Some(s) = running_apps_section() { sections.push(s); }
    if let Some(s) = monitor_section() { sections.push(s); }

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
                // Skip system noise
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

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn monitor_section() -> Option<String> {
    let monitors = xcap::Monitor::all().ok()?;
    if monitors.is_empty() { return None; }

    let lines: Vec<String> = monitors.iter().enumerate().map(|(i, m)| {
        format!("- Monitor {}: {}x{}", i, m.width(), m.height())
    }).collect();

    Some(format!("### Displays\n{}", lines.join("\n")))
}
