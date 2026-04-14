/// Perception Fusion — BLADE's sensory integration layer.
///
/// Every God Mode tick calls `update_perception()` which fuses all available
/// signals (active window, clipboard, screen OCR, system vitals, idle state)
/// into a single `PerceptionState` snapshot. The latest state is stored in a
/// static `OnceLock<Mutex<Option<PerceptionState>>>` so any module can call
/// `get_latest()` without re-running the expensive collection.
///
/// The `get_delta()` helper produces a human-readable change summary that is
/// injected into the God Mode intelligence brief so BLADE knows what is NEW.

use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};

// ── State ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerceptionState {
    pub timestamp: i64,
    pub active_app: String,
    pub active_title: String,
    pub screen_ocr_text: String,
    pub visible_errors: Vec<String>,
    pub context_tags: Vec<String>,      // e.g. ["coding", "rust", "debugging"]
    pub clipboard_type: String,         // "error" | "url" | "code" | "command" | "text"
    pub clipboard_preview: String,
    pub delta_summary: String,          // what changed since last tick
    pub disk_free_gb: f64,
    pub ram_used_gb: f64,
    pub top_cpu_process: String,
    pub user_state: String,             // "focused" | "idle" | "away"
}

impl Default for PerceptionState {
    fn default() -> Self {
        Self {
            timestamp: 0,
            active_app: String::new(),
            active_title: String::new(),
            screen_ocr_text: String::new(),
            visible_errors: Vec::new(),
            context_tags: Vec::new(),
            clipboard_type: "text".to_string(),
            clipboard_preview: String::new(),
            delta_summary: String::new(),
            disk_free_gb: 0.0,
            ram_used_gb: 0.0,
            top_cpu_process: String::new(),
            user_state: "focused".to_string(),
        }
    }
}

// ── Static storage ────────────────────────────────────────────────────────────

static LATEST_PERCEPTION: OnceLock<Mutex<Option<PerceptionState>>> = OnceLock::new();

fn perception_store() -> &'static Mutex<Option<PerceptionState>> {
    LATEST_PERCEPTION.get_or_init(|| Mutex::new(None))
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Gather all signals and return a fresh `PerceptionState`.
/// The result is also stored internally for `get_latest()`.
pub fn update_perception() -> PerceptionState {
    let now = chrono::Utc::now().timestamp();

    // Pull previous state for delta computation
    let previous = get_latest();

    // ── Active window ─────────────────────────────────────────────────────────
    let (active_app, active_title) = match crate::context::get_active_window() {
        Ok(w) => (w.app_name.clone(), w.window_title.clone()),
        Err(_) => (String::new(), String::new()),
    };

    // ── Clipboard ─────────────────────────────────────────────────────────────
    let (clipboard_type, clipboard_preview) = read_clipboard_signal();

    // ── System vitals ─────────────────────────────────────────────────────────
    let (disk_free_gb, ram_used_gb, top_cpu_process) = collect_vitals();

    // ── Idle detection (approximation via window poll) ───────────────────────
    // We use last-input-info on Windows; fall back to heuristic on other platforms.
    let idle_secs = get_idle_seconds();

    // ── OCR (best-effort; only when screen_timeline screenshots exist) ────────
    let screen_ocr_text = try_read_ocr_from_latest_screenshot();

    // ── Derived fields ────────────────────────────────────────────────────────
    let visible_errors = extract_visible_errors(&active_title, &screen_ocr_text, &clipboard_preview, &clipboard_type);
    let context_tags = extract_context_tags(&active_app, &active_title, &screen_ocr_text);
    let user_state = classify_user_state(&active_app, idle_secs);

    let mut state = PerceptionState {
        timestamp: now,
        active_app,
        active_title,
        screen_ocr_text,
        visible_errors,
        context_tags,
        clipboard_type,
        clipboard_preview,
        delta_summary: String::new(),
        disk_free_gb,
        ram_used_gb,
        top_cpu_process,
        user_state,
    };

    // Compute delta against previous state
    if let Some(ref prev) = previous {
        state.delta_summary = get_delta(&state, prev);
    } else {
        state.delta_summary = "Initial perception snapshot".to_string();
    }

    // Persist latest
    if let Ok(mut guard) = perception_store().lock() {
        *guard = Some(state.clone());
    }

    state
}

/// Return the last computed `PerceptionState`, if any.
pub fn get_latest() -> Option<PerceptionState> {
    perception_store().lock().ok().and_then(|g| g.clone())
}

/// Produce a human-readable summary of what changed between two snapshots.
/// Empty string means nothing notable changed.
pub fn get_delta(current: &PerceptionState, previous: &PerceptionState) -> String {
    let mut changes: Vec<String> = Vec::new();

    if current.active_app != previous.active_app && !current.active_app.is_empty() {
        changes.push(format!(
            "Switched app: {} → {}",
            previous.active_app, current.active_app
        ));
    } else if current.active_title != previous.active_title && !current.active_title.is_empty() {
        // Same app, different window/file
        let prev_short = crate::safe_slice(&previous.active_title, 40);
        let curr_short = crate::safe_slice(&current.active_title, 40);
        if prev_short != curr_short {
            changes.push(format!("Window changed: \"{}\"", curr_short));
        }
    }

    if current.clipboard_preview != previous.clipboard_preview
        && !current.clipboard_preview.is_empty()
    {
        changes.push(format!(
            "Clipboard updated ({}): {}",
            current.clipboard_type,
            crate::safe_slice(&current.clipboard_preview, 60)
        ));
    }

    if current.user_state != previous.user_state {
        changes.push(format!(
            "User state: {} → {}",
            previous.user_state, current.user_state
        ));
    }

    // New errors surfaced
    let new_errors: Vec<&String> = current
        .visible_errors
        .iter()
        .filter(|e| !previous.visible_errors.contains(e))
        .collect();
    if !new_errors.is_empty() {
        changes.push(format!("New error: {}", crate::safe_slice(new_errors[0], 80)));
    }

    // Context shift
    let prev_tags: std::collections::HashSet<&String> =
        previous.context_tags.iter().collect();
    let curr_tags: std::collections::HashSet<&String> =
        current.context_tags.iter().collect();
    let added: Vec<&&String> = curr_tags.difference(&prev_tags).collect();
    if !added.is_empty() {
        let tag_list: Vec<String> = added.iter().map(|t| t.to_string()).collect();
        changes.push(format!("New context: [{}]", tag_list.join(", ")));
    }

    // Disk space warning
    if current.disk_free_gb < 5.0 && previous.disk_free_gb >= 5.0 {
        changes.push(format!("Disk low: {:.1}GB free", current.disk_free_gb));
    }

    if changes.is_empty() {
        "No significant changes".to_string()
    } else {
        changes.join("; ")
    }
}

// ── Classify user state ───────────────────────────────────────────────────────

pub fn classify_user_state(active_app: &str, idle_secs: u64) -> String {
    if idle_secs >= 600 {
        // 10+ minutes with no input → away
        return "away".to_string();
    }
    if idle_secs >= 120 {
        // 2-10 minutes → idle
        return "idle".to_string();
    }

    // Under 2 minutes — check if in a focus-worthy app
    let app = active_app.to_lowercase();
    let focus_apps = [
        "code", "cursor", "vim", "neovim", "nvim", "idea", "webstorm",
        "rider", "clion", "pycharm", "terminal", "powershell", "cmd",
        "wt", "kitty", "alacritty", "wezterm", "zed", "helix",
    ];
    if focus_apps.iter().any(|a| app.contains(a)) {
        return "focused".to_string();
    }

    "focused".to_string()
}

// ── Context tag extraction ────────────────────────────────────────────────────

pub fn extract_context_tags(app: &str, title: &str, ocr: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let app_l = app.to_lowercase();
    let title_l = title.to_lowercase();
    let ocr_l = ocr.to_lowercase();

    // Activity type
    if app_l.contains("code") || app_l.contains("cursor") || app_l.contains("vim")
        || app_l.contains("zed") || app_l.contains("helix") || app_l.contains("idea")
    {
        tags.push("coding".to_string());
    }
    if app_l.contains("terminal") || app_l.contains("powershell") || app_l.contains("cmd")
        || app_l.contains("wt") || app_l.contains("kitty") || app_l.contains("alacritty")
    {
        tags.push("terminal".to_string());
    }
    if app_l.contains("chrome") || app_l.contains("firefox") || app_l.contains("edge")
        || app_l.contains("brave") || app_l.contains("safari")
    {
        tags.push("browsing".to_string());
    }
    if app_l.contains("slack") || app_l.contains("discord") || app_l.contains("teams")
        || app_l.contains("telegram")
    {
        tags.push("communication".to_string());
    }
    if app_l.contains("figma") || app_l.contains("sketch") || app_l.contains("photoshop")
        || app_l.contains("illustrator") || app_l.contains("affinity")
    {
        tags.push("design".to_string());
    }
    if app_l.contains("notion") || app_l.contains("obsidian") || app_l.contains("roam")
        || app_l.contains("logseq")
    {
        tags.push("notes".to_string());
    }

    // Language / tech from title/OCR
    if title_l.contains(".rs") || ocr_l.contains("fn ") || ocr_l.contains("pub struct") {
        tags.push("rust".to_string());
    }
    if title_l.contains(".ts") || title_l.contains(".tsx")
        || (ocr_l.contains("const ") && (ocr_l.contains(": string") || ocr_l.contains(": number") || ocr_l.contains("interface ") || ocr_l.contains("type ") || title_l.contains(".ts")))
    {
        tags.push("typescript".to_string());
    }
    if title_l.contains(".py") || ocr_l.contains("def ") || ocr_l.contains("import ") {
        tags.push("python".to_string());
    }
    if title_l.contains(".go") || ocr_l.contains("func ") || ocr_l.contains("package ") {
        tags.push("go".to_string());
    }
    if title_l.contains(".js") && !title_l.contains(".ts") {
        tags.push("javascript".to_string());
    }

    // Activity sub-type
    let combined = format!("{} {}", title_l, ocr_l);
    if combined.contains("error") || combined.contains("traceback") || combined.contains("panic") {
        tags.push("debugging".to_string());
    }
    if combined.contains("test") || combined.contains("spec") || combined.contains("assert") {
        tags.push("testing".to_string());
    }
    if title_l.contains("github") || title_l.contains("pull request") || title_l.contains("pr #") {
        tags.push("code-review".to_string());
    }
    if combined.contains("docs") || combined.contains("readme") || combined.contains("documentation") {
        tags.push("documentation".to_string());
    }
    if combined.contains("cargo") || combined.contains("npm") || combined.contains("pip") {
        tags.push("build".to_string());
    }

    tags.dedup();
    tags
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn read_clipboard_signal() -> (String, String) {
    // Try via arboard directly (same as godmode/clipboard.rs)
    let mut cb = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(_) => return ("text".to_string(), String::new()),
    };
    let text = match cb.get_text() {
        Ok(t) => t,
        Err(_) => return ("text".to_string(), String::new()),
    };
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return ("text".to_string(), String::new());
    }

    // Classify using the same logic as crate::clipboard
    let lower = trimmed.to_lowercase();
    let kind = if lower.starts_with("http://") || lower.starts_with("https://") {
        "url"
    } else if lower.contains("traceback") || lower.contains("error:") || lower.contains("panicked at")
        || lower.contains("exception:") || lower.contains("typeerror:") || lower.contains("syntaxerror:")
    {
        "error"
    } else if (trimmed.starts_with("$ ") || trimmed.starts_with("> ")) && !trimmed.contains('\n') {
        "command"
    } else {
        let code_signals = ["fn ", "def ", "class ", "const ", "let ", "import ", "function ", "=>", "->", "{"];
        let score = code_signals.iter().filter(|s| trimmed.contains(*s)).count();
        if score >= 2 { "code" } else { "text" }
    };

    let preview: String = trimmed.chars().take(120).collect();
    (kind.to_string(), preview)
}

fn collect_vitals() -> (f64, f64, String) {
    let mut disk_free_gb = 0.0f64;
    let mut ram_used_gb = 0.0f64;
    let mut top_cpu = String::new();

    #[cfg(target_os = "windows")]
    {
        // Disk free
        if let Ok(out) = crate::cmd_util::silent_cmd("powershell")
            .args(["-Command", "(Get-PSDrive C).Free / 1GB"])
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(v) = s.parse::<f64>() {
                    disk_free_gb = v;
                }
            }
        }

        // RAM used
        if let Ok(out) = crate::cmd_util::silent_cmd("powershell")
            .args(["-Command",
                "[math]::Round((Get-Process | Measure-Object WorkingSet64 -Sum).Sum / 1GB, 2)"])
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(v) = s.parse::<f64>() {
                    ram_used_gb = v;
                }
            }
        }

        // Top CPU process
        if let Ok(out) = crate::cmd_util::silent_cmd("powershell")
            .args(["-Command",
                "Get-Process | Sort-Object CPU -Descending | Select-Object -First 1 -ExpandProperty ProcessName"])
            .output()
        {
            if out.status.success() {
                top_cpu = String::from_utf8_lossy(&out.stdout).trim().to_string();
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // df -h / — disk free on the root partition
        if let Ok(out) = std::process::Command::new("df")
            .args(["-BG", "/"])
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = text.lines().nth(1) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 4 {
                        let avail = cols[3].trim_end_matches('G');
                        if let Ok(v) = avail.parse::<f64>() {
                            disk_free_gb = v;
                        }
                    }
                }
            }
        }

        // free -b — RAM used
        if let Ok(out) = std::process::Command::new("free")
            .arg("-b")
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                for line in text.lines() {
                    if line.starts_with("Mem:") {
                        let cols: Vec<&str> = line.split_whitespace().collect();
                        if cols.len() >= 3 {
                            if let Ok(used_bytes) = cols[2].parse::<f64>() {
                                ram_used_gb = used_bytes / (1024.0 * 1024.0 * 1024.0);
                            }
                        }
                        break;
                    }
                }
            }
        }

        // Top CPU process via ps
        if let Ok(out) = std::process::Command::new("ps")
            .args(["aux", "--sort=-%cpu"])
            .output()
        {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = text.lines().nth(1) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 11 {
                        top_cpu = cols[10..].join(" ");
                    }
                }
            }
        }
    }

    (disk_free_gb, ram_used_gb, top_cpu)
}

/// Estimate idle seconds using platform APIs.
/// On Windows: GetLastInputInfo. On others: falls back to 0 (always "focused").
fn get_idle_seconds() -> u64 {
    #[cfg(target_os = "windows")]
    {
        use std::mem;

        #[repr(C)]
        struct LastInputInfo {
            cb_size: u32,
            dw_time: u32,
        }

        extern "system" {
            fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
            fn GetTickCount() -> u32;
        }

        unsafe {
            let mut lii = LastInputInfo {
                cb_size: mem::size_of::<LastInputInfo>() as u32,
                dw_time: 0,
            };
            if GetLastInputInfo(&mut lii) != 0 {
                let tick_now = GetTickCount();
                let elapsed_ms = tick_now.wrapping_sub(lii.dw_time) as u64;
                return elapsed_ms / 1000;
            }
        }
        0
    }

    #[cfg(not(target_os = "windows"))]
    {
        0
    }
}

/// Best-effort OCR text from the most recent Total Recall screenshot.
/// Returns empty string if not available (no crash, just no data).
fn try_read_ocr_from_latest_screenshot() -> String {
    // screen_timeline writes screenshots to a known dir; OCR text is stored in DB
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    // The screen_timeline table stores ocr_text
    let result: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT ocr_text FROM screen_timeline ORDER BY captured_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    );

    result.unwrap_or_default()
}

/// Scan multiple sources for error-like strings. Returns deduplicated list.
fn extract_visible_errors(title: &str, ocr: &str, clipboard_preview: &str, clipboard_type: &str) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();

    // Title bar error
    let title_l = title.to_lowercase();
    if title_l.contains("error") || title_l.contains("failed") || title_l.contains("panic") {
        errors.push(crate::safe_slice(title, 120).to_string());
    }

    // Clipboard error
    if clipboard_type == "error" && !clipboard_preview.is_empty() {
        errors.push(crate::safe_slice(clipboard_preview, 200).to_string());
    }

    // OCR-detected errors
    if !ocr.is_empty() {
        let ocr_l = ocr.to_lowercase();
        if ocr_l.contains("error:") || ocr_l.contains("traceback") || ocr_l.contains("panicked at") {
            // Find the error line in OCR
            for line in ocr.lines() {
                let ll = line.to_lowercase();
                if ll.contains("error:") || ll.contains("traceback") || ll.contains("panicked at") {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !errors.iter().any(|e| e.contains(trimmed)) {
                        errors.push(crate::safe_slice(trimmed, 150).to_string());
                        break;
                    }
                }
            }
        }
    }

    errors.dedup();
    errors
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Return the latest perception snapshot (for UI display / debugging).
#[tauri::command]
pub fn perception_get_latest() -> Option<PerceptionState> {
    get_latest()
}

/// Force a fresh perception update and return it. Used by God Mode tick and tests.
#[tauri::command]
pub async fn perception_update() -> PerceptionState {
    tokio::task::spawn_blocking(update_perception)
        .await
        .unwrap_or_default()
}
