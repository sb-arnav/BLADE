/// TENTACLE: terminal_watch.rs — Watches terminal activity and provides intelligent assistance.
///
/// Polls PowerShell history every 10 s. Classifies commands as routine/interesting/failed.
/// Detects retry patterns that signal failures, tracks command frequency, and spots
/// loops like "npm install ran 3 times in 10 min — node_modules might be corrupted".
/// Exposes `suggest_better_command()` for common shell anti-patterns.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ── Static state ──────────────────────────────────────────────────────────────

static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WatcherState {
    /// Last count of lines seen in the history file.
    last_line_count: usize,
    /// Ring buffer: (command, unix_ts) — keeps last 200 entries.
    recent_commands: Vec<(String, i64)>,
    /// Frequency map: command_root → count.
    frequency: HashMap<String, u32>,
}

static WATCHER_STATE: OnceLock<Mutex<WatcherState>> = OnceLock::new();

fn watcher_state() -> &'static Mutex<WatcherState> {
    WATCHER_STATE.get_or_init(|| Mutex::new(WatcherState::default()))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Return the path to PowerShell's ConsoleHost_history.txt.
fn history_file_path() -> Option<std::path::PathBuf> {
    dirs::data_local_dir().map(|d| {
        d.join("Microsoft")
            .join("Windows")
            .join("PowerShell")
            .join("PSReadLine")
            .join("ConsoleHost_history.txt")
    })
}

/// Read the history file and return all lines.
fn read_history_lines() -> Vec<String> {
    let path = match history_file_path() {
        Some(p) => p,
        None => return Vec::new(),
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => content.lines().map(|l| l.to_string()).collect(),
        Err(_) => Vec::new(),
    }
}

// ── Command classification ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CommandClass {
    Routine,
    Interesting,
    Failed,
}

/// Heuristically classify a single command string.
fn classify_command(cmd: &str) -> CommandClass {
    let c = cmd.trim().to_lowercase();

    // Likely error-related patterns in the command itself
    let error_indicators = [
        "error", "fail", "exception", "denied", "not found",
        "cannot", "could not", "unable to",
    ];
    for ind in &error_indicators {
        if c.contains(ind) {
            return CommandClass::Failed;
        }
    }

    // Interesting: git operations, builds, installs, deploys
    let interesting_prefixes = [
        "git commit", "git push", "git merge", "git rebase",
        "cargo build", "cargo run", "npm run", "yarn build",
        "docker", "kubectl", "terraform", "ansible",
        "ssh ", "scp ", "rsync",
        "curl ", "wget ",
    ];
    for prefix in &interesting_prefixes {
        if c.starts_with(prefix) {
            return CommandClass::Interesting;
        }
    }

    CommandClass::Routine
}

/// Detect whether two commands look like a retry of the same operation
/// (same root command, within a short window — we check this across the
/// recent_commands ring buffer, not here directly).
fn commands_look_like_retry(a: &str, b: &str) -> bool {
    let root_a = a.split_whitespace().next().unwrap_or("").to_lowercase();
    let root_b = b.split_whitespace().next().unwrap_or("").to_lowercase();
    root_a == root_b && !root_a.is_empty()
}

/// Return the root verb of a command (first word, ignoring sudo/env/etc.).
fn command_root(cmd: &str) -> String {
    let stripped = cmd.trim_start_matches("sudo ").trim_start_matches("env ");
    stripped
        .split_whitespace()
        .next()
        .unwrap_or(cmd)
        .to_lowercase()
}

// ── Loop detection ────────────────────────────────────────────────────────────

/// Check the ring buffer for a command root that appeared ≥ `threshold` times
/// within `window_secs`. Returns Some(message) if a loop is detected.
fn detect_loop_pattern(
    recent: &[(String, i64)],
    new_cmd: &str,
    window_secs: i64,
    threshold: u32,
) -> Option<String> {
    let root = command_root(new_cmd);
    if root.is_empty() {
        return None;
    }

    let now = now_secs();
    let count = recent
        .iter()
        .filter(|(cmd, ts)| command_root(cmd) == root && (now - ts) <= window_secs)
        .count() as u32;

    if count >= threshold {
        let suggestion = loop_suggestion(&root);
        return Some(format!(
            "You've run `{}` {} times in the last {} min.{}",
            root,
            count + 1,
            window_secs / 60,
            suggestion
                .map(|s| format!(" {}", s))
                .unwrap_or_default()
        ));
    }
    None
}

fn loop_suggestion(root: &str) -> Option<String> {
    match root {
        "npm" => Some("node_modules might be corrupted — try `rm -rf node_modules && npm install`.".to_string()),
        "cargo" => Some("Consider checking Cargo.lock or running `cargo clean`.".to_string()),
        "git" => Some("Check for merge conflicts or a detached HEAD state.".to_string()),
        "docker" => Some("Container might be stuck — try `docker system prune -f`.".to_string()),
        "pip" | "pip3" => Some("Virtual environment might be broken — try recreating it.".to_string()),
        _ => None,
    }
}

// ── Retry detection ───────────────────────────────────────────────────────────

/// Given the list of new commands in order, detect consecutive retries and
/// return suggested fixes.
fn detect_retries(new_cmds: &[String]) -> Vec<(String, Option<String>)> {
    let mut results = Vec::new();
    for window in new_cmds.windows(2) {
        if commands_look_like_retry(&window[0], &window[1]) {
            let fix = suggest_better_command(&window[1]);
            results.push((window[1].clone(), fix));
        }
    }
    results
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Suggest a better version of a known shell anti-pattern.
/// Returns `None` if no improvement is known.
pub fn suggest_better_command(cmd: &str) -> Option<String> {
    let c = cmd.trim();

    // git log --oneline | grep <pattern>  →  git log --grep=<pattern> --oneline
    if let Some(rest) = c.strip_prefix("git log") {
        if rest.contains("| grep ") {
            let grep_arg = rest
                .split("| grep ")
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_matches('"')
                .trim_matches('\'');
            return Some(format!(
                "git log --grep={} --oneline",
                grep_arg
            ));
        }
    }

    // find . -name "*.rs" | xargs grep  →  rg --type rust
    if c.contains("find ") && c.contains("-name") && c.contains("| xargs grep") {
        let ext = c
            .split("-name")
            .nth(1)
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim_start_matches("*.")
            .trim_end_matches('"')
            .trim_end_matches('\'');
        let rg_type = match ext {
            "rs" => "rust",
            "py" => "python",
            "js" => "js",
            "ts" => "ts",
            "go" => "go",
            "java" => "java",
            other => other,
        };
        return Some(format!("rg --type {}", rg_type));
    }

    // cat file | grep pattern  →  grep pattern file
    if c.starts_with("cat ") && c.contains("| grep ") {
        let parts: Vec<&str> = c.splitn(2, "| grep ").collect();
        if parts.len() == 2 {
            let file = parts[0].trim_start_matches("cat ").trim();
            let pattern = parts[1].trim();
            return Some(format!("grep {} {}", pattern, file));
        }
    }

    // ls -la | grep something  →  ls -la something*
    if (c.starts_with("ls -la") || c.starts_with("ls -al")) && c.contains("| grep ") {
        let pattern = c.split("| grep ").nth(1).unwrap_or("").trim();
        return Some(format!("ls -la {}*", pattern));
    }

    // cd foo && ls  →  ls foo/
    if c.starts_with("cd ") && c.contains("&& ls") {
        let dir = c
            .strip_prefix("cd ")
            .unwrap_or("")
            .split(" &&")
            .next()
            .unwrap_or("")
            .trim();
        return Some(format!("ls {}/", dir));
    }

    None
}

/// Return the top-20 most-used commands (root verb only), sorted descending.
pub fn get_command_frequency() -> Vec<(String, u32)> {
    let state = watcher_state().lock().unwrap();
    let mut freq: Vec<(String, u32)> = state.frequency.clone().into_iter().collect();
    freq.sort_by(|a, b| b.1.cmp(&a.1));
    freq.truncate(20);
    freq
}

// ── Background loop ───────────────────────────────────────────────────────────

/// Start the terminal watcher background loop.
/// Idempotent — second call is a no-op.
pub fn start_terminal_watcher(app: AppHandle) {
    if WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tick_terminal_watcher(&app);
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        }
    });

    log::info!("[TerminalWatch] Started.");
}

fn tick_terminal_watcher(app: &AppHandle) {
    let all_lines = read_history_lines();
    let total = all_lines.len();

    let last_count = {
        let state = watcher_state().lock().unwrap();
        state.last_line_count
    };

    if total <= last_count {
        // No new commands.
        return;
    }

    let new_cmds: Vec<String> = all_lines[last_count..].to_vec();
    let ts = now_secs();

    // Update state
    {
        let mut state = watcher_state().lock().unwrap();
        state.last_line_count = total;

        for cmd in &new_cmds {
            let root = command_root(cmd);
            *state.frequency.entry(root).or_insert(0) += 1;
            state.recent_commands.push((cmd.clone(), ts));
        }
        // Trim ring buffer to last 200 entries
        if state.recent_commands.len() > 200 {
            let overflow = state.recent_commands.len() - 200;
            state.recent_commands.drain(0..overflow);
        }
    }

    // Process each new command
    for cmd in &new_cmds {
        let class = classify_command(cmd);

        // Emit new command event
        let _ = app.emit(
            "terminal_new_command",
            serde_json::json!({
                "command": cmd,
                "class": class,
                "timestamp": ts,
            }),
        );

        // Suggest a better command if applicable
        if let Some(suggestion) = suggest_better_command(cmd) {
            let _ = app.emit(
                "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Better command available",
                    "body": format!("Instead of `{}`, try:\n`{}`", cmd, suggestion),
                    "action": suggestion,
                }),
            );
        }

        // Loop detection (≥3 times within 10 min)
        let loop_msg = {
            let state = watcher_state().lock().unwrap();
            detect_loop_pattern(&state.recent_commands, cmd, 600, 3)
        };
        if let Some(msg) = loop_msg {
            let _ = app.emit(
                "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Possible loop detected",
                    "body": msg,
                }),
            );
        }
    }

    // Retry detection across the new batch
    let retries = detect_retries(&new_cmds);
    for (cmd, fix) in retries {
        if let Some(fix_str) = fix {
            let _ = app.emit(
                "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Retry detected — better approach?",
                    "body": format!("You retried `{}`. Try: `{}`", cmd, fix_str),
                    "action": fix_str,
                }),
            );
        } else {
            let _ = app.emit(
                "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Retry detected",
                    "body": format!("You ran `{}` again. Check for errors above.", cmd),
                }),
            );
        }
    }
}
