#![allow(dead_code, unused_variables, unused_assignments)] // Tentacle module — feature-complete, wired via hive

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
use tauri::{AppHandle, Emitter, Manager};

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
    /// Workflow pattern: (trigger_pattern, expected_followup, times_seen, times_skipped)
    workflow_patterns: Vec<(String, String, u32, u32)>,
    /// Consecutive build failure tracker: (error_snippet, count, first_seen_ts)
    build_failures: Vec<(String, u32, i64)>,
    /// Last sequence hint emitted — avoids re-firing the same hint every tick.
    last_sequence_hint: Option<String>,
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

// ── Intent understanding ──────────────────────────────────────────────────────

/// What the user is trying to do, inferred from a command pattern.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CommandIntent {
    FindTodos,
    InvestigatingHistory,
    Debugging,
    BuildingProject,
    DeployingCode,
    SearchingFiles,
    ManagingDependencies,
    Unknown,
}

/// Infer what the user is trying to accomplish from a command.
pub fn infer_intent(cmd: &str) -> CommandIntent {
    let c = cmd.trim().to_lowercase();

    if c.contains("grep") && (c.contains("todo") || c.contains("fixme") || c.contains("hack")) {
        return CommandIntent::FindTodos;
    }
    if c.starts_with("git log") || c.starts_with("git diff") || c.starts_with("git show") {
        return CommandIntent::InvestigatingHistory;
    }
    if c.starts_with("cargo build")
        || c.starts_with("cargo run")
        || c.starts_with("npm run build")
        || c.starts_with("yarn build")
        || c.starts_with("make ")
    {
        return CommandIntent::BuildingProject;
    }
    if c.contains("kubectl") || c.contains("docker push") || c.starts_with("git push") {
        return CommandIntent::DeployingCode;
    }
    if c.contains("grep -r") || c.contains("find .") || c.starts_with("rg ") {
        return CommandIntent::SearchingFiles;
    }
    if c.starts_with("npm install")
        || c.starts_with("yarn add")
        || c.starts_with("cargo add")
        || c.starts_with("pip install")
    {
        return CommandIntent::ManagingDependencies;
    }
    if c.starts_with("gdb") || c.contains("strace") || c.contains("lldb") || c.contains("valgrind") {
        return CommandIntent::Debugging;
    }

    CommandIntent::Unknown
}

/// Generate a context-aware suggestion based on inferred intent.
pub fn intent_suggestion(intent: &CommandIntent, cmd: &str) -> Option<String> {
    match intent {
        CommandIntent::FindTodos => Some(
            "You're looking for TODOs. Want me to compile a task list from these and add them to your memory?".to_string()
        ),
        CommandIntent::InvestigatingHistory => Some(
            "You're investigating the git history. Want me to summarise recent changes or find who last touched a specific file?".to_string()
        ),
        CommandIntent::BuildingProject => None, // handled by build failure detection
        CommandIntent::DeployingCode => Some(
            "You're deploying. Want me to check for any open issues or failing tests before this goes out?".to_string()
        ),
        CommandIntent::SearchingFiles => Some(
            format!("You're searching files. If you're looking for something specific in the codebase, I can run a semantic search across your project instead of grep.")
        ),
        CommandIntent::ManagingDependencies => Some(
            "You're installing dependencies. Want me to check for known vulnerabilities in the packages you're adding?".to_string()
        ),
        CommandIntent::Debugging => Some(
            "You're debugging. Want me to check the error logs or recent commits that might have introduced this issue?".to_string()
        ),
        CommandIntent::Unknown => None,
    }
}

// ── Multi-command sequence detection ─────────────────────────────────────────

/// A recognised sequence pattern: the list of command roots that define it,
/// the inferred investigation label, and the suggestion to surface.
#[allow(dead_code)]
struct SequencePattern {
    roots: &'static [&'static str],
    label: &'static str,
    suggestion: &'static str,
}

static SP_GIT: &[&str] = &["git", "git", "git"];
static SP_CARGO: &[&str] = &["cargo", "cargo", "cargo"];
static SP_GREP: &[&str] = &["grep", "grep", "grep"];
static SP_NPM: &[&str] = &["npm", "npm", "npm"];
static SP_DOCKER: &[&str] = &["docker", "docker"];

static SEQUENCE_PATTERNS: &[SequencePattern] = &[
    SequencePattern {
        roots: SP_GIT,
        label: "deep_git_investigation",
        suggestion: "You're doing a deep git investigation (log → diff → stash). \
                     Want me to summarise what changed, who touched it, and when?",
    },
    SequencePattern {
        roots: SP_CARGO,
        label: "iterative_rust_debug",
        suggestion: "You've run cargo multiple times in a row. \
                     Want me to look at the compiler errors and suggest a fix?",
    },
    SequencePattern {
        roots: SP_GREP,
        label: "code_spelunking",
        suggestion: "You're doing deep code search. \
                     Want me to run a semantic search across the codebase instead?",
    },
    SequencePattern {
        roots: SP_NPM,
        label: "npm_struggle",
        suggestion: "You've run npm multiple times. \
                     Common fixes: rm -rf node_modules && npm ci, or check for lockfile conflicts.",
    },
    SequencePattern {
        roots: SP_DOCKER,
        label: "docker_iteration",
        suggestion: "You're iterating on Docker. \
                     Want me to check the build context or Dockerfile for common issues?",
    },
];

/// Check the recent command history for known multi-step sequences.
/// Returns Some(suggestion) if the last N commands match a known pattern.
fn detect_command_sequence(
    recent: &[(String, i64)],
    window_secs: i64,
) -> Option<String> {
    let now = now_secs();

    // Collect command roots from within the window, most recent first
    let recent_roots: Vec<&str> = recent
        .iter()
        .rev()
        .filter(|(_, ts)| (now - ts) <= window_secs)
        .take(10)
        .map(|(cmd, _)| {
            cmd.split_whitespace()
                .next()
                .unwrap_or("")
        })
        .collect();

    for pattern in SEQUENCE_PATTERNS {
        let n = pattern.roots.len();
        if recent_roots.len() < n {
            continue;
        }
        // Check if the last N roots match the pattern
        let matches = pattern.roots.iter().rev()
            .zip(recent_roots.iter())
            .all(|(expected, actual)| actual.eq_ignore_ascii_case(*expected));
        if matches {
            return Some(pattern.suggestion.to_string());
        }
    }

    None
}

// ── Workflow pattern learning ─────────────────────────────────────────────────

/// Learn from (trigger, followup) pairs in the recent command history.
/// Called after each tick to record patterns like "edit src/ → run tests".
fn learn_workflow_pattern(recent: &mut Vec<(String, String, u32, u32)>, new_cmd: &str, prev_cmd: Option<&str>) {
    let known_workflows_arr: [(&str, &str); 6] = [
        ("edit", "cargo test"),
        ("edit", "npm test"),
        ("git commit", "git push"),
        ("cargo build", "cargo test"),
        ("npm run build", "npm test"),
        ("git add", "git commit"),
    ];
    let known_workflows: &[(&str, &str)] = known_workflows_arr.as_slice();

    let Some(prev) = prev_cmd else { return };

    for (trigger, followup) in known_workflows {
        let prev_matches = prev.to_lowercase().contains(trigger);
        let new_matches = new_cmd.to_lowercase().contains(followup);
        let new_is_different = !new_cmd.to_lowercase().contains(followup);

        if prev_matches {
            // Find or create pattern entry
            if let Some(entry) = recent.iter_mut().find(|(t, f, _, _)| t == trigger && f == followup) {
                if new_matches {
                    entry.2 += 1; // seen count
                } else if new_is_different {
                    entry.3 += 1; // skipped count
                }
            } else {
                let seen = if new_matches { 1 } else { 0 };
                let skipped = if !new_matches && new_is_different { 1 } else { 0 };
                recent.push((trigger.to_string(), followup.to_string(), seen, skipped));
            }
        }
    }
}

/// Check if the user is breaking a known workflow pattern (e.g. edited but didn't test).
/// Returns Some(reminder) if a pattern was broken.
fn check_workflow_deviation(
    patterns: &[(String, String, u32, u32)],
    recent: &[(String, i64)],
    new_cmd: &str,
) -> Option<String> {
    // Look at the last 5 commands
    let last_5: Vec<&str> = recent
        .iter()
        .rev()
        .take(5)
        .map(|(c, _)| c.as_str())
        .collect();

    for (trigger, followup, seen, skipped) in patterns {
        if *seen < 3 {
            continue; // not enough data
        }
        // If the trigger was recently run and current command is NOT the followup
        let trigger_found = last_5.iter().any(|c| c.to_lowercase().contains(trigger.as_str()));
        let followup_found = last_5.iter().any(|c| c.to_lowercase().contains(followup.as_str()));
        let current_is_followup = new_cmd.to_lowercase().contains(followup.as_str());

        if trigger_found && !followup_found && !current_is_followup {
            // User ran the trigger but skipped the followup
            return Some(format!(
                "You usually run `{followup}` after `{trigger}` (done so {seen}x) — you haven't this time."
            ));
        }
    }
    None
}

// ── Build failure tracking ────────────────────────────────────────────────────

/// Track consecutive build failures. Returns Some(alert) if same error repeats 3+ times.
fn track_build_failure(
    failures: &mut Vec<(String, u32, i64)>,
    cmd: &str,
    ts: i64,
) -> Option<String> {
    // Only track build commands
    let build_cmds = ["cargo build", "cargo run", "npm run", "yarn build", "make ", "python ", "go build"];
    if !build_cmds.iter().any(|b| cmd.to_lowercase().starts_with(b)) {
        return None;
    }

    // We can't read stdout here, so we track rapid retries of the same build command as proxy for failure
    let cmd_root = cmd.split_whitespace().take(3).collect::<Vec<_>>().join(" ");

    if let Some(entry) = failures.iter_mut().find(|(key, _, first_ts)| {
        key == &cmd_root && (ts - first_ts) < 600 // within 10 min
    }) {
        entry.1 += 1;
        if entry.1 >= 3 {
            return Some(format!(
                "This is the {}th time you've run `{}` in the last {} minutes. \
                 Want me to look at the error?",
                entry.1,
                cmd_root,
                (ts - entry.2) / 60
            ));
        }
    } else {
        // Clean up old entries
        failures.retain(|(_, _, first_ts)| (ts - first_ts) < 600);
        failures.push((cmd_root, 1, ts));
    }

    None
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
        if state.recent_commands.len() > 200 {
            let overflow = state.recent_commands.len() - 200;
            state.recent_commands.drain(0..overflow);
        }
    }

    for (i, cmd) in new_cmds.iter().enumerate() {
        let class = classify_command(cmd);

        let _ = app.emit_to("main", "terminal_new_command",
            serde_json::json!({
                "command": cmd,
                "class": class,
                "timestamp": ts,
            }),
        );

        // Better command suggestion
        if let Some(suggestion) = suggest_better_command(cmd) {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Better command available",
                    "body": format!("Instead of `{}`, try:\n`{}`", cmd, suggestion),
                    "action": suggestion,
                }),
            );
        }

        // Intent understanding — what is the user trying to do?
        let intent = infer_intent(cmd);
        if let Some(intent_hint) = intent_suggestion(&intent, cmd) {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "I noticed what you're doing",
                    "body": intent_hint,
                    "intent": format!("{:?}", intent),
                }),
            );
        }

        // Loop detection
        let loop_msg = {
            let state = watcher_state().lock().unwrap();
            detect_loop_pattern(&state.recent_commands, cmd, 600, 3)
        };
        if let Some(msg) = loop_msg {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Possible loop detected",
                    "body": msg,
                }),
            );
        }

        // Build failure tracking
        let build_alert = {
            let mut state = watcher_state().lock().unwrap();
            track_build_failure(&mut state.build_failures, cmd, ts)
        };
        if let Some(alert) = build_alert {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Repeated build failure",
                    "body": alert,
                    "action": "analyze_error",
                }),
            );
        }

        // Workflow pattern learning and deviation detection
        // Clone the string to avoid use-after-free from raw pointer across mutex release
        let prev_cmd_owned: Option<String> = if i > 0 {
            Some(new_cmds[i - 1].clone())
        } else {
            let state = watcher_state().lock().unwrap_or_else(|e| e.into_inner());
            state.recent_commands
                .iter()
                .rev()
                .nth(1)
                .map(|(c, _)| c.clone())
        };

        {
            let mut state = watcher_state().lock().unwrap_or_else(|e| e.into_inner());
            learn_workflow_pattern(&mut state.workflow_patterns, cmd, prev_cmd_owned.as_deref());
        }

        let workflow_reminder = {
            let state = watcher_state().lock().unwrap();
            check_workflow_deviation(&state.workflow_patterns, &state.recent_commands, cmd)
        };
        if let Some(reminder) = workflow_reminder {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Workflow pattern deviation",
                    "body": reminder,
                }),
            );
        }
    }

    // Multi-command sequence detection — runs once per tick across the full recent buffer.
    // Deduplicates: only emits when the detected hint changes from last tick.
    let sequence_hint = {
        let state = watcher_state().lock().unwrap();
        detect_command_sequence(&state.recent_commands, 300) // 5-min window
    };
    if let Some(ref hint) = sequence_hint {
        let already_fired = {
            let state = watcher_state().lock().unwrap();
            state.last_sequence_hint.as_deref() == Some(hint.as_str())
        };
        if !already_fired {
            {
                let mut state = watcher_state().lock().unwrap();
                state.last_sequence_hint = Some(hint.clone());
            }
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Command sequence detected",
                    "body": hint,
                }),
            );
        }
    } else {
        // Clear the last hint when no sequence is active (so it can re-fire next time)
        let mut state = watcher_state().lock().unwrap();
        state.last_sequence_hint = None;
    }

    // Retry detection across the new batch
    let retries = detect_retries(&new_cmds);
    for (cmd, fix) in retries {
        if let Some(fix_str) = fix {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Retry detected — better approach?",
                    "body": format!("You retried `{}`. Try: `{}`", cmd, fix_str),
                    "action": fix_str,
                }),
            );
        } else {
            let _ = app.emit_to("main", "proactive_suggestion",
                serde_json::json!({
                    "source": "terminal_watch",
                    "title": "Retry detected",
                    "body": format!("You ran `{}` again. Check for errors above.", cmd),
                }),
            );
        }
    }
}
