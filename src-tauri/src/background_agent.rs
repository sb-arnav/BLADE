/// BLADE BACKGROUND AGENT SPAWNER
///
/// BLADE orchestrates other AI coding agents — Claude Code, Aider, Codex CLI —
/// as subprocesses. You ask BLADE to refactor a 10k-line codebase. BLADE spawns
/// a Claude Code agent, monitors it, emits progress events, and reports back.
///
/// This is multi-agent orchestration from a desktop app.
/// BLADE becomes the meta-agent that delegates and supervises.
///
/// Event flow:
///   agent_spawn → [agent_stdout lines] → agent_complete | agent_error
///
/// Agents run in background threads. BLADE can run multiple simultaneously.
/// Each agent has a unique ID for tracking and cancellation.
///
/// Smart spawning: auto_spawn_agent() inspects the task description and
/// picks the right agent type automatically. The LLM never needs to know
/// which binary to invoke — it just describes the goal.
///
/// Multi-agent coordination: get_active_agents() returns all running agents.
/// When two agents share related tasks, context injection links them so each
/// one knows what the other has already done.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Emitter;
use std::sync::{Arc, Mutex};
use tokio::io::AsyncBufReadExt;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundAgent {
    pub id: String,
    pub agent_type: String, // "claude-code", "aider", "custom"
    pub task: String,
    pub cwd: String,
    pub status: AgentStatus,
    pub output: Vec<String>, // streamed stdout lines
    pub exit_code: Option<i32>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

pub type SharedAgentRegistry = Arc<Mutex<HashMap<String, BackgroundAgent>>>;

static AGENT_REGISTRY: std::sync::OnceLock<SharedAgentRegistry> = std::sync::OnceLock::new();
static CANCEL_FLAGS: std::sync::OnceLock<Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>> = std::sync::OnceLock::new();

fn registry() -> &'static SharedAgentRegistry {
    AGENT_REGISTRY.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn cancel_flags() -> &'static Arc<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> {
    CANCEL_FLAGS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// Detect which coding agents are available on this system
pub fn detect_available_agents() -> Vec<String> {
    let candidates = [
        ("claude", "claude"),     // Claude Code CLI
        ("aider", "aider"),       // Aider
        ("codex", "codex"),       // OpenAI Codex CLI
        ("goose", "goose"),       // Block's Goose
        ("continue", "continue"), // Continue.dev CLI
    ];

    candidates
        .iter()
        .filter(|(bin, _)| which_bin(bin))
        .map(|(_, name)| name.to_string())
        .collect()
}

fn which_bin(name: &str) -> bool {
    // Windows uses `where`, Unix uses `which`
    #[cfg(target_os = "windows")]
    let cmd = "where";
    #[cfg(not(target_os = "windows"))]
    let cmd = "which";

    crate::cmd_util::silent_cmd(cmd)
        .arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Build the command args for a given agent type + task
fn build_agent_command(agent_type: &str, task: &str, _cwd: &str) -> Option<(String, Vec<String>)> {
    match agent_type {
        "claude-code" | "claude" => {
            // Claude Code CLI: `claude -p "task" --output-format stream-json`
            Some((
                "claude".to_string(),
                vec![
                    "-p".to_string(),
                    task.to_string(),
                    "--output-format".to_string(),
                    "stream-json".to_string(),
                ],
            ))
        }
        "aider" => {
            // Aider: `aider --message "task" --yes`
            Some((
                "aider".to_string(),
                vec![
                    "--message".to_string(),
                    task.to_string(),
                    "--yes".to_string(),
                    "--no-pretty".to_string(),
                ],
            ))
        }
        "goose" => {
            // Block's Goose: `goose run --text "task"`
            Some((
                "goose".to_string(),
                vec!["run".to_string(), "--text".to_string(), task.to_string()],
            ))
        }
        "codex" => {
            // OpenAI Codex CLI: `codex -q "task"` (quiet / non-interactive)
            Some((
                "codex".to_string(),
                vec!["-q".to_string(), task.to_string()],
            ))
        }
        "bash" => {
            // Raw bash script — for when BLADE writes a script and runs it
            #[cfg(target_os = "windows")]
            return Some(("cmd".to_string(), vec!["/C".to_string(), task.to_string()]));
            #[cfg(not(target_os = "windows"))]
            Some(("bash".to_string(), vec!["-c".to_string(), task.to_string()]))
        }
        _ => None,
    }
}

/// Spawn a background coding agent. Returns agent ID immediately.
/// The agent runs in a background task, emitting events via Tauri.
#[tauri::command]
pub async fn agent_spawn(
    app: tauri::AppHandle,
    agent_type: String,
    task: String,
    cwd: Option<String>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let work_dir = cwd.clone().unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                #[cfg(target_os = "windows")]
                return std::env::var("TEMP").unwrap_or_else(|_| "C:\\Temp".to_string());
                #[cfg(not(target_os = "windows"))]
                "/tmp".to_string()
            })
    });

    let (cmd, args) = build_agent_command(&agent_type, &task, &work_dir)
        .ok_or_else(|| format!("Unknown agent type: {}", agent_type))?;

    let agent = BackgroundAgent {
        id: id.clone(),
        agent_type: agent_type.clone(),
        task: task.clone(),
        cwd: work_dir.clone(),
        status: AgentStatus::Running,
        output: Vec::new(),
        exit_code: None,
        started_at: chrono::Utc::now().timestamp(),
        finished_at: None,
    };

    {
        let mut registry = registry().lock().unwrap();
        registry.insert(id.clone(), agent);
    }

    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = cancel_flags().lock().unwrap();
        flags.insert(id.clone(), cancel_flag.clone());
    }

    let id_clone = id.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        run_agent(id_clone, cmd, args, work_dir, cancel_flag, app_clone).await;
    });

    // Emit spawn event
    let _ = app.emit(
        "agent_spawned",
        serde_json::json!({
            "id": id,
            "agent_type": agent_type,
            "task": crate::safe_slice(&task, 100),
        }),
    );

    Ok(id)
}

async fn run_agent(
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: String,
    cancel: Arc<std::sync::atomic::AtomicBool>,
    app: tauri::AppHandle,
) {
    let mut child = match crate::cmd_util::silent_tokio_cmd(&cmd)
        .args(&args)
        .current_dir(&cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Failed to spawn {}: {}", cmd, e);
            update_agent_status(&id, AgentStatus::Failed, None, Some(msg.clone()));
            let _ = app.emit(
                "agent_error",
                serde_json::json!({"id": id, "error": msg}),
            );
            return;
        }
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut stdout_lines = tokio::io::BufReader::new(stdout).lines();
    let mut stderr_lines = tokio::io::BufReader::new(stderr).lines();

    let id_for_stdout = id.clone();
    let app_for_stdout = app.clone();

    // Stream stdout and stderr as events.
    // We track whether each stream is still open; the loop exits when both close.
    let mut stdout_open = true;
    let mut stderr_open = true;

    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = child.kill().await;
            update_agent_status(&id, AgentStatus::Cancelled, None, None);
            let _ = app.emit("agent_cancelled", serde_json::json!({"id": id}));
            return;
        }

        // Exit when both streams have closed.
        if !stdout_open && !stderr_open {
            break;
        }

        tokio::select! {
            line = stdout_lines.next_line(), if stdout_open => {
                match line {
                    Ok(Some(l)) => {
                        append_agent_output(&id_for_stdout, &l);
                        let _ = app_for_stdout.emit("agent_stdout", serde_json::json!({
                            "id": &id_for_stdout,
                            "line": &l,
                        }));
                    }
                    // stdout closed — mark it done but keep draining stderr
                    Ok(None) | Err(_) => { stdout_open = false; }
                }
            }
            line = stderr_lines.next_line(), if stderr_open => {
                match line {
                    Ok(Some(l)) => {
                        append_agent_output(&id_for_stdout, &format!("[err] {}", l));
                        let _ = app_for_stdout.emit("agent_stderr", serde_json::json!({
                            "id": &id_for_stdout,
                            "line": l,
                        }));
                    }
                    // stderr closed
                    Ok(None) | Err(_) => { stderr_open = false; }
                }
            }
        }
    }

    let exit_status = child.wait().await.ok();
    let code = exit_status.and_then(|s| s.code()).unwrap_or(-1);

    let status = if code == 0 {
        AgentStatus::Completed
    } else {
        AgentStatus::Failed
    };
    update_agent_status(&id, status.clone(), Some(code), None);

    // Build completion summary and store in execution_memory
    let summary = {
        let reg = registry().lock().unwrap();
        reg.get(&id)
            .map(|a| extract_completion_summary(a))
            .unwrap_or_default()
    };

    // Store agent run in execution memory so BLADE can recall it later
    {
        let reg = registry().lock().unwrap();
        if let Some(agent) = reg.get(&id) {
            let full_output = agent.output.join("\n");
            let started = agent.started_at;
            let finished = agent.finished_at.unwrap_or_else(|| chrono::Utc::now().timestamp());
            let duration_ms = (finished - started) * 1000;
            let command_label = format!("[agent:{}] {}", agent.agent_type, crate::safe_slice(&agent.task, 200));
            crate::execution_memory::record(
                &command_label,
                &agent.cwd,
                &crate::safe_slice(&full_output, 6000),
                "",
                code,
                duration_ms,
            );
        }
    }

    // Emit both the legacy event (for existing listeners) and a richer one
    let _ = app.emit(
        "agent_complete",
        serde_json::json!({
            "id": id,
            "exit_code": code,
            "status": if code == 0 { "completed" } else { "failed" },
        }),
    );

    let _ = app.emit(
        "agent_completed",
        serde_json::json!({
            "id": id,
            "exit_code": code,
            "status": if code == 0 { "completed" } else { "failed" },
            "summary": summary,
        }),
    );
}

fn update_agent_status(id: &str, status: AgentStatus, code: Option<i32>, _error: Option<String>) {
    let mut registry = registry().lock().unwrap();
    if let Some(agent) = registry.get_mut(id) {
        agent.status = status;
        agent.exit_code = code;
        agent.finished_at = Some(chrono::Utc::now().timestamp());
    }
}

fn append_agent_output(id: &str, line: &str) {
    let mut registry = registry().lock().unwrap();
    if let Some(agent) = registry.get_mut(id) {
        agent.output.push(line.to_string());
        // Cap output at 500 lines to prevent memory blow-up
        if agent.output.len() > 500 {
            agent.output.drain(0..100);
        }
    }
}

/// List all background agents (running + recent)
#[tauri::command]
pub fn agent_list_background() -> Vec<BackgroundAgent> {
    let registry = registry().lock().unwrap();
    let mut agents: Vec<BackgroundAgent> = registry.values().cloned().collect();
    agents.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    agents
}

/// Get a specific agent's state including output
#[tauri::command]
pub fn agent_get_background(id: String) -> Option<BackgroundAgent> {
    let registry = registry().lock().unwrap();
    registry.get(&id).cloned()
}

/// Cancel a running background agent
#[tauri::command]
pub async fn agent_cancel_background(id: String) -> Result<(), String> {
    let flags = cancel_flags().lock().unwrap();
    if let Some(flag) = flags.get(&id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(format!("No agent with id: {}", id))
    }
}

/// Detect which coding agents are installed on this system
#[tauri::command]
pub fn agent_detect_available() -> Vec<String> {
    detect_available_agents()
}

/// Get the combined output of a completed agent as a single string
#[tauri::command]
pub fn agent_get_output(id: String) -> String {
    let registry = registry().lock().unwrap();
    registry
        .get(&id)
        .map(|a| a.output.join("\n"))
        .unwrap_or_default()
}

// ── Smart auto-spawning ────────────────────────────────────────────────────────

/// Classify a task description and return the best agent type + rationale.
/// This is the decision logic that lets BLADE autonomously choose a coding agent.
fn classify_task(task: &str) -> (&'static str, &'static str) {
    let t = task.to_lowercase();

    // Coding tasks → Claude Code (strongest editor) or Aider (git-native)
    let is_code_task = ["refactor", "implement", "build", "fix", "rewrite",
                        "add feature", "migrate", "upgrade", "debug", "test",
                        "create", "generate code", "scaffold", "port"]
        .iter().any(|kw| t.contains(kw));

    let multi_file = ["multiple files", "across files", "whole codebase",
                      "all files", "entire project", "every file"]
        .iter().any(|kw| t.contains(kw));

    let is_research = ["research", "find", "compare", "analyse", "analyze",
                       "summarize", "what is", "explain", "look up", "search for"]
        .iter().any(|kw| t.contains(kw));

    let is_design = ["generate image", "create design", "make image",
                     "design asset", "ui design", "logo", "mockup", "wireframe"]
        .iter().any(|kw| t.contains(kw));

    let prefers_aider = ["git commit", "apply patch", "write tests", "tdd",
                         "test-driven", "apply diff"]
        .iter().any(|kw| t.contains(kw));

    if is_design {
        return ("unsupported", "image-generation");
    }
    if is_research && !is_code_task {
        return ("swarm", "research");
    }
    if prefers_aider && !multi_file {
        return ("aider", "git-native edits");
    }
    if is_code_task || multi_file {
        return ("claude", "complex coding task");
    }
    // Default: Claude Code handles most things
    ("claude", "general coding")
}

/// Intelligently spawn the best coding agent for a task.
/// Returns the agent ID immediately; the agent runs in the background.
///
/// Decision logic:
/// - "refactor", "implement", "build", "fix across multiple files" → Claude Code
/// - "research", "find", "compare"                                 → BLADE swarm
/// - "generate image", "create design"                             → returns error (not supported)
/// - git-commit / patch tasks                                      → Aider
pub async fn auto_spawn_agent(
    app: &tauri::AppHandle,
    task: &str,
    project_dir: &str,
) -> Result<String, String> {
    let (agent_type, rationale) = classify_task(task);

    match agent_type {
        "unsupported" => {
            return Err(format!(
                "Image generation and design tasks are not supported by background coding agents. \
                 Use a dedicated image-generation service instead."
            ));
        }
        "swarm" => {
            // Research tasks delegate to BLADE's own swarm — just return a marker ID
            // so the caller knows we chose the swarm path.
            return Ok(format!("swarm:research:{}", Uuid::new_v4()));
        }
        _ => {}
    }

    // Confirm the chosen agent is actually installed; fall back gracefully.
    let available = detect_available_agents();
    let chosen = if available.contains(&agent_type.to_string()) {
        agent_type.to_string()
    } else if available.contains(&"claude".to_string()) {
        "claude".to_string()
    } else if available.contains(&"aider".to_string()) {
        "aider".to_string()
    } else {
        return Err(format!(
            "No coding agent found on this system. \
             Install Claude Code with: npm install -g @anthropic-ai/claude-code\n\
             Checked: claude, aider, goose"
        ));
    };

    // Inject context from sibling agents that are already running on related tasks
    let enriched_task = inject_sibling_context(task);

    let cwd = if project_dir.is_empty() {
        None
    } else {
        Some(project_dir.to_string())
    };

    let id = agent_spawn(app.clone(), chosen.clone(), enriched_task, cwd).await?;

    // Emit an auto-spawn event so the UI can surface why this agent was chosen
    let _ = app.emit(
        "agent_auto_spawned",
        serde_json::json!({
            "id": id,
            "agent_type": chosen,
            "rationale": rationale,
            "task_preview": crate::safe_slice(task, 120),
        }),
    );

    Ok(id)
}

/// Build a task string enriched with output snippets from related running agents.
/// Keeps the injection small — just the last 10 lines from each sibling.
fn inject_sibling_context(task: &str) -> String {
    let registry = registry().lock().unwrap();
    let running: Vec<&BackgroundAgent> = registry
        .values()
        .filter(|a| a.status == AgentStatus::Running)
        .collect();

    if running.is_empty() {
        return task.to_string();
    }

    let mut ctx_parts: Vec<String> = Vec::new();
    for sibling in running.iter().take(3) {
        // Only inject if task keywords overlap
        if tasks_are_related(task, &sibling.task) {
            let snippet: Vec<&String> = sibling.output.iter().rev().take(10).rev().collect();
            if !snippet.is_empty() {
                ctx_parts.push(format!(
                    "  [Sibling agent {} is working on: \"{}\"]\n  Recent output:\n{}",
                    &sibling.id[..8],
                    crate::safe_slice(&sibling.task, 80),
                    snippet.iter().map(|l| format!("    {}", l)).collect::<Vec<_>>().join("\n")
                ));
            }
        }
    }

    if ctx_parts.is_empty() {
        task.to_string()
    } else {
        format!(
            "{}\n\n--- Context from other agents working in parallel ---\n{}",
            task,
            ctx_parts.join("\n\n")
        )
    }
}

/// Rough keyword-overlap check to detect related tasks.
fn tasks_are_related(a: &str, b: &str) -> bool {
    let a_words: std::collections::HashSet<&str> = a.split_whitespace()
        .filter(|w| w.len() > 4)
        .collect();
    let b_words: std::collections::HashSet<&str> = b.split_whitespace()
        .filter(|w| w.len() > 4)
        .collect();
    let overlap = a_words.intersection(&b_words).count();
    overlap >= 2
}

// ── Codex / OpenAI Responses API ─────────────────────────────────────────────

/// Spawn a Codex CLI agent for a task.
/// Falls back to Claude Code if `codex` is not installed.
pub async fn spawn_codex_agent(
    app: &tauri::AppHandle,
    task: &str,
    project_dir: &str,
) -> Result<String, String> {
    let available = detect_available_agents();
    let use_codex = available.contains(&"codex".to_string());

    let (agent_type, final_task) = if use_codex {
        // Codex CLI: `codex -q "task"` or `codex exec "task"`
        ("codex", task.to_string())
    } else {
        // Fall back to Claude Code
        ("claude", task.to_string())
    };

    let cwd = if project_dir.is_empty() {
        None
    } else {
        Some(project_dir.to_string())
    };

    let id = agent_spawn(app.clone(), agent_type.to_string(), final_task, cwd).await?;

    if !use_codex {
        let _ = app.emit(
            "agent_fallback",
            serde_json::json!({
                "id": id,
                "requested": "codex",
                "used": "claude",
                "reason": "Codex CLI not installed — fell back to Claude Code",
            }),
        );
    }

    Ok(id)
}

// ── Build command — extended to support Codex ─────────────────────────────────

#[allow(dead_code)]
fn build_codex_command(task: &str) -> (String, Vec<String>) {
    // Codex CLI: `codex -q "task"` (quiet, non-interactive)
    (
        "codex".to_string(),
        vec!["-q".to_string(), task.to_string()],
    )
}

// ── Multi-agent coordination ──────────────────────────────────────────────────

/// Return all running (or recently finished) agents with their full state.
/// The Dashboard can display these to give the user situational awareness.
#[tauri::command]
pub fn get_active_agents() -> Vec<BackgroundAgent> {
    let registry = registry().lock().unwrap();
    let now = chrono::Utc::now().timestamp();
    let mut agents: Vec<BackgroundAgent> = registry
        .values()
        .filter(|a| {
            a.status == AgentStatus::Running
                || a.finished_at.map(|t| now - t < 300).unwrap_or(false)
        })
        .cloned()
        .collect();
    agents.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    agents
}

/// Extract a human-readable summary from a completed agent's output.
/// Looks for git commit messages, file change lists, and error summaries.
pub fn extract_completion_summary(agent: &BackgroundAgent) -> String {
    let output = agent.output.join("\n");
    let mut lines: Vec<String> = Vec::new();

    // Find git commit lines
    for line in agent.output.iter() {
        let l = line.trim();
        if l.starts_with("commit ") || l.contains("committed") || l.contains("[main ") || l.contains("[master ") {
            lines.push(format!("git: {}", l));
        }
    }

    // Find file edit lines (aider / claude-code patterns)
    let file_patterns = ["Wrote ", "Updated ", "Created ", "Deleted ", "Modified ",
                          "wrote ", "updated ", "created ", "- ", "+ "];
    for line in agent.output.iter().rev().take(50).rev() {
        let l = line.trim();
        if file_patterns.iter().any(|p| l.starts_with(p))
            && (l.contains(".rs") || l.contains(".ts") || l.contains(".py")
                || l.contains(".js") || l.contains(".go") || l.contains(".toml"))
        {
            lines.push(format!("file: {}", crate::safe_slice(l, 100)));
        }
    }

    // Fallback: last 5 non-empty lines
    if lines.is_empty() {
        lines = agent.output.iter().rev()
            .filter(|l| !l.trim().is_empty())
            .take(5)
            .rev()
            .cloned()
            .collect();
    }

    if lines.is_empty() {
        format!("Agent {} completed (no output captured).", &agent.id[..8])
    } else {
        format!(
            "Agent {} [{}] completed:\n{}",
            &agent.id[..8],
            agent.agent_type,
            lines.iter().take(15).cloned().collect::<Vec<_>>().join("\n")
        )
    }
}

/// Tauri command: auto-spawn the best agent for a task.
#[tauri::command]
pub async fn agent_auto_spawn(
    app: tauri::AppHandle,
    task: String,
    project_dir: String,
) -> Result<String, String> {
    auto_spawn_agent(&app, &task, &project_dir).await
}

/// Tauri command: spawn a Codex agent (falls back to Claude Code).
#[tauri::command]
pub async fn agent_spawn_codex(
    app: tauri::AppHandle,
    task: String,
    project_dir: String,
) -> Result<String, String> {
    spawn_codex_agent(&app, &task, &project_dir).await
}
