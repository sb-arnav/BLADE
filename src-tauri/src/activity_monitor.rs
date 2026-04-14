/// Activity Monitor — BLADE's passive user awareness layer.
///
/// Runs two background loops:
///   - Window poller (every 30s): captures the foreground app + window title
///     via PowerShell and writes it to the activity_monitor SQLite table.
///   - File scanner (every 5 min): scans Documents, Desktop, and home dir
///     for files modified in the last hour and derives work patterns.
///
/// Also feeds the persona engine: if Arnav spends >2h/day in VS Code on .rs
/// files, `developer` and `rust_user` traits get upserted at 0.9. Chrome
/// time increases `researcher` etc.
///
/// `get_activity_context()` returns a Markdown summary injected into the
/// system prompt by brain.rs.

use rusqlite::params;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

// ── Global stop flag ──────────────────────────────────────────────────────────

static MONITOR_ACTIVE: AtomicBool = AtomicBool::new(false);

// ── DB helpers ────────────────────────────────────────────────────────────────

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&path).map_err(|e| format!("ActivityMonitor DB: {e}"))
}

/// Ensure the activity_monitor table exists.
pub fn ensure_table() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => { eprintln!("activity_monitor: {e}"); return; }
    };
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_monitor (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp       INTEGER NOT NULL,
            app_name        TEXT    NOT NULL DEFAULT '',
            window_title    TEXT    NOT NULL DEFAULT '',
            duration_secs   INTEGER NOT NULL DEFAULT 30
        );
        CREATE INDEX IF NOT EXISTS idx_am_ts ON activity_monitor(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_am_app ON activity_monitor(app_name);"
    );
}

/// Insert a window observation.
fn record_window(app_name: &str, window_title: &str, duration_secs: i64) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    let ts = chrono::Utc::now().timestamp();
    let _ = conn.execute(
        "INSERT INTO activity_monitor (timestamp, app_name, window_title, duration_secs)
         VALUES (?1, ?2, ?3, ?4)",
        params![ts, app_name, window_title, duration_secs],
    );
    // Mirror to the unified activity_timeline so brain.rs can see it
    let _ = crate::db::timeline_record(
        &conn,
        "window_switch",
        window_title,
        "",
        app_name,
        "{}",
    );
    // Prune rows older than 7 days from activity_monitor to prevent unbounded growth
    let cutoff = ts - 7 * 86400;
    let _ = conn.execute(
        "DELETE FROM activity_monitor WHERE timestamp < ?1",
        params![cutoff],
    );
}

// ── PowerShell helpers ────────────────────────────────────────────────────────

/// Returns (app_name, window_title) of the current foreground window.
fn get_foreground_window() -> Option<(String, String)> {
    // Use PowerShell to get the foreground window process + title in one call.
    // We ask for the top process by CPU whose MainWindowTitle is non-empty.
    let output = crate::cmd_util::silent_cmd("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"
$hwnd = (Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -Name WinUser -Namespace Win32 -PassThru)::GetForegroundWindow()
$procs = Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1
if ($procs) {
    "$($procs.ProcessName)|$($procs.MainWindowTitle)"
} else {
    Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Sort-Object CPU -Descending | Select-Object -First 1 | ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" }
}
"#,
        ])
        .output()
        .ok()?;

    let raw = String::from_utf8_lossy(&output.stdout);
    let line = raw.trim();
    if line.is_empty() { return None; }
    let parts: Vec<&str> = line.splitn(2, '|').collect();
    let app = parts.first().unwrap_or(&"").trim().to_string();
    let title = parts.get(1).unwrap_or(&"").trim().to_string();
    if app.is_empty() { return None; }
    Some((app, title))
}

/// Returns a list of recently modified file paths (within `within_secs`).
fn recent_modified_files(within_secs: u64) -> Vec<String> {
    // Ask PowerShell to list files modified in the last N seconds across
    // common work directories (Documents, Desktop, home).
    let script = format!(
        r#"
$cutoff = (Get-Date).AddSeconds(-{within})
$paths = @(
    [System.Environment]::GetFolderPath('MyDocuments'),
    [System.Environment]::GetFolderPath('Desktop'),
    $env:USERPROFILE
)
$paths | ForEach-Object {{
    if (Test-Path $_) {{
        Get-ChildItem -Path $_ -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object {{ $_.LastWriteTime -gt $cutoff -and $_.Length -gt 0 }} |
            Select-Object -ExpandProperty FullName
    }}
}} | Select-Object -Unique | Select-Object -First 40
"#,
        within = within_secs
    );

    let output = crate::cmd_util::silent_cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();

    match output {
        Ok(o) => {
            let raw = String::from_utf8_lossy(&o.stdout);
            raw.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        }
        Err(_) => Vec::new(),
    }
}

/// Classify a file extension into a work category label.
fn classify_file(path: &str) -> Option<&'static str> {
    let lower = path.to_lowercase();
    if lower.ends_with(".rs") { return Some("Rust dev"); }
    if lower.ends_with(".tsx") || lower.ends_with(".ts") { return Some("TypeScript/React dev"); }
    if lower.ends_with(".jsx") || lower.ends_with(".js") { return Some("JavaScript dev"); }
    if lower.ends_with(".py") { return Some("Python dev"); }
    if lower.ends_with(".go") { return Some("Go dev"); }
    if lower.ends_with(".cpp") || lower.ends_with(".cc") || lower.ends_with(".c") || lower.ends_with(".h") { return Some("C/C++ dev"); }
    if lower.ends_with(".java") || lower.ends_with(".kt") { return Some("JVM dev"); }
    if lower.ends_with(".md") || lower.ends_with(".txt") { return Some("writing/notes"); }
    if lower.ends_with(".toml") || lower.ends_with(".yaml") || lower.ends_with(".yml") || lower.ends_with(".json") { return Some("config/infra"); }
    if lower.ends_with(".sql") { return Some("database work"); }
    None
}

// ── Persona feed ──────────────────────────────────────────────────────────────

/// Map app name patterns to broad activity categories.
fn classify_app(app: &str) -> Option<&'static str> {
    let lower = app.to_lowercase();
    if lower.contains("code") || lower.contains("cursor") || lower.contains("nvim") || lower.contains("vim") || lower.contains("emacs") || lower.contains("sublime") || lower.contains("rider") || lower.contains("clion") || lower.contains("goland") || lower.contains("webstorm") || lower.contains("pycharm") || lower.contains("intellij") { return Some("coding"); }
    if lower.contains("chrome") || lower.contains("firefox") || lower.contains("edge") || lower.contains("brave") || lower.contains("safari") { return Some("browser"); }
    if lower.contains("terminal") || lower.contains("powershell") || lower.contains("cmd") || lower.contains("wt") || lower.contains("bash") || lower.contains("alacritty") || lower.contains("wezterm") { return Some("terminal"); }
    if lower.contains("slack") || lower.contains("discord") || lower.contains("teams") || lower.contains("zoom") || lower.contains("telegram") { return Some("communication"); }
    if lower.contains("figma") || lower.contains("photoshop") || lower.contains("illustrator") || lower.contains("sketch") || lower.contains("canva") { return Some("design"); }
    if lower.contains("notion") || lower.contains("obsidian") || lower.contains("roam") || lower.contains("logseq") { return Some("notes"); }
    None
}

/// Look at the last 24h of activity_monitor rows, tally seconds per app,
/// then upsert relevant persona traits.
fn feed_persona_from_activity() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    let cutoff = chrono::Utc::now().timestamp() - 86400;
    let mut stmt = match conn.prepare(
        "SELECT app_name, window_title, duration_secs FROM activity_monitor WHERE timestamp > ?1"
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    let rows: Vec<(String, String, i64)> = match stmt.query_map(params![cutoff], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    }) {
        Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
        Err(_) => return,
    };

    // Accumulate seconds per category
    let mut category_secs: HashMap<&'static str, i64> = HashMap::new();
    let mut rs_title_secs: i64 = 0;

    for (app, title, secs) in &rows {
        if let Some(cat) = classify_app(app) {
            *category_secs.entry(cat).or_insert(0) += secs;
            // Track Rust-specific coding time (window titles often show .rs filenames)
            if cat == "coding" {
                let t = title.to_lowercase();
                if t.contains(".rs") || t.contains("rust") || t.contains("cargo") {
                    rs_title_secs += secs;
                }
            }
        }
    }

    let coding_secs = *category_secs.get("coding").unwrap_or(&0);
    let browser_secs = *category_secs.get("browser").unwrap_or(&0);
    let terminal_secs = *category_secs.get("terminal").unwrap_or(&0);

    // >2h coding → developer trait
    if coding_secs > 7200 {
        let score = (coding_secs as f32 / 14400.0).min(1.0); // saturates at 4h
        crate::persona_engine::update_trait(
            "developer",
            score,
            &format!("Spent {}min coding today", coding_secs / 60),
        );
    }
    // >1h Rust-specific → rust_user
    if rs_title_secs > 3600 {
        crate::persona_engine::update_trait(
            "rust_user",
            0.9,
            &format!("{}min in Rust files today", rs_title_secs / 60),
        );
    }
    // >1.5h browser → researcher tendency
    if browser_secs > 5400 {
        let existing = crate::persona_engine::get_all_traits()
            .into_iter()
            .find(|t| t.trait_name == "researcher")
            .map(|t| t.score)
            .unwrap_or(0.3);
        let new_score = (existing + 0.05).min(1.0);
        crate::persona_engine::update_trait(
            "researcher",
            new_score,
            &format!("{}min browsing today", browser_secs / 60),
        );
    }
    // Terminal heavy → power user
    if terminal_secs > 3600 {
        crate::persona_engine::update_trait(
            "power_user",
            0.85,
            &format!("{}min in terminal today", terminal_secs / 60),
        );
    }
}

// ── Public context API ────────────────────────────────────────────────────────

/// Returns a Markdown summary of what the user has been doing — injected into
/// the brain.rs system prompt so BLADE always knows the current work context.
pub fn get_activity_context() -> String {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    let now = chrono::Utc::now().timestamp();
    let cutoff_24h = now - 86400;
    let cutoff_1h  = now - 3600;

    // ── Latest window observation ─────────────────────────────────────────────
    let latest: Option<(String, String, i64)> = conn.query_row(
        "SELECT app_name, window_title, timestamp FROM activity_monitor ORDER BY timestamp DESC LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)?)),
    ).ok();

    // ── App usage breakdown for today ─────────────────────────────────────────
    let mut stmt = match conn.prepare(
        "SELECT app_name, SUM(duration_secs) as total FROM activity_monitor
         WHERE timestamp > ?1 GROUP BY app_name ORDER BY total DESC LIMIT 8"
    ) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let app_rows: Vec<(String, i64)> = match stmt.query_map(params![cutoff_24h], |r| {
        Ok((r.get(0)?, r.get(1)?))
    }) {
        Ok(m) => m.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    };

    let total_tracked_secs: i64 = app_rows.iter().map(|(_, s)| s).sum();

    // ── Coding time this session (since last window we actually saw) ───────────
    let coding_secs: i64 = app_rows.iter()
        .filter(|(app, _)| classify_app(app) == Some("coding"))
        .map(|(_, s)| s)
        .sum();

    // ── Recent files in the last hour ─────────────────────────────────────────
    // We pull from the timeline (file events logged during scans), not PowerShell,
    // so this is fast and doesn't block the prompt builder.
    let recent_files: Vec<String> = match conn.prepare(
        "SELECT title FROM activity_timeline WHERE event_type = 'file_scan'
         AND timestamp > ?1 ORDER BY timestamp DESC LIMIT 20"
    ) {
        Err(_) => Vec::new(),
        Ok(mut s) => {
            // Collect immediately so MappedRows (borrows `s`) is dropped before `s` is.
            let collected: Vec<String> = match s.query_map(params![cutoff_1h], |r| r.get::<_, String>(0)) {
                Ok(m) => m.filter_map(|r| r.ok()).collect(),
                Err(_) => Vec::new(),
            };
            collected
        }
    };

    build_context_string(&latest, &app_rows, total_tracked_secs, coding_secs, &recent_files, cutoff_1h)
}

fn build_context_string(
    latest: &Option<(String, String, i64)>,
    app_rows: &[(String, i64)],
    total_tracked_secs: i64,
    coding_secs: i64,
    recent_files: &[String],
    _cutoff_1h: i64,
) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push("## What Arnav is doing right now".to_string());

    // Active app
    if let Some((app, title, ts)) = latest {
        let age_secs = chrono::Utc::now().timestamp() - ts;
        let age_str = if age_secs < 120 {
            format!("{}s ago", age_secs)
        } else {
            format!("{}min ago", age_secs / 60)
        };
        lines.push(format!("- **Active app**: {} (seen {})", app, age_str));
        if !title.is_empty() && title != app {
            lines.push(format!("- **Window**: {}", crate::safe_slice(title, 100)));
        }
    } else {
        lines.push("- Active app: (not yet observed)".to_string());
    }

    // Coding time today
    if coding_secs > 0 {
        let h = coding_secs / 3600;
        let m = (coding_secs % 3600) / 60;
        let time_str = if h > 0 { format!("{}h {}min", h, m) } else { format!("{}min", m) };
        lines.push(format!("- **Coding time today**: {}", time_str));
    }

    // App breakdown with percentages
    if total_tracked_secs > 0 && !app_rows.is_empty() {
        let top: Vec<String> = app_rows.iter().take(5).map(|(app, secs)| {
            let pct = (*secs as f64 / total_tracked_secs as f64 * 100.0).round() as i64;
            format!("{} ({}%)", app, pct)
        }).collect();
        lines.push(format!("- **Most-used apps today**: {}", top.join(", ")));
    }

    // Recent files (deduplicated basenames)
    if !recent_files.is_empty() {
        let basenames: Vec<String> = {
            let mut seen = std::collections::HashSet::new();
            recent_files.iter()
                .filter_map(|p| {
                    let base = p.rsplit(['/', '\\']).next().unwrap_or(p.as_str()).to_string();
                    if seen.insert(base.clone()) { Some(base) } else { None }
                })
                .take(8)
                .collect()
        };
        if !basenames.is_empty() {
            lines.push(format!("- **Recently modified files**: {}", basenames.join(", ")));
        }
    }

    // Work pattern tags from file classifications
    let mut work_cats: Vec<&'static str> = recent_files.iter()
        .filter_map(|f| classify_file(f))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    work_cats.sort();
    if !work_cats.is_empty() {
        lines.push(format!("- **Work patterns**: {}", work_cats.join(", ")));
    }

    lines.join("\n")
}

// ── Background loops ──────────────────────────────────────────────────────────

/// Start both monitoring loops. Safe to call multiple times — will only start once.
pub fn start_activity_monitor() {
    if MONITOR_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    ensure_table();
    crate::persona_engine::ensure_tables();

    // Loop 1: window poller every 30s
    tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if !MONITOR_ACTIVE.load(Ordering::SeqCst) { break; }

            // Run the blocking PowerShell call on a thread pool thread
            let result = tokio::task::spawn_blocking(|| get_foreground_window()).await;
            if let Ok(Some((app, title))) = result {
                record_window(&app, &title, 30);
            }
        }
    });

    // Loop 2: file scanner every 5 minutes
    tauri::async_runtime::spawn(async {
        // Wait 2 minutes before the first scan so startup isn't burdened
        tokio::time::sleep(Duration::from_secs(120)).await;
        loop {
            if !MONITOR_ACTIVE.load(Ordering::SeqCst) { break; }

            let files = tokio::task::spawn_blocking(|| recent_modified_files(3600)).await;
            if let Ok(files) = files {
                if !files.is_empty() {
                    // Persist file list to timeline so it shows up in get_activity_context
                    if let Ok(conn) = open_db() {
                        let summary = files.iter()
                            .take(20)
                            .map(|f| f.rsplit(['/', '\\']).next().unwrap_or(f.as_str()))
                            .collect::<Vec<_>>()
                            .join(", ");
                        let _ = crate::db::timeline_record(
                            &conn,
                            "file_scan",
                            &summary,
                            "",
                            "",
                            "{}",
                        );
                    }
                }
            }

            // Feed persona engine every 5 min (cheap — just DB reads)
            tokio::task::spawn_blocking(feed_persona_from_activity).await.ok();

            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
}
