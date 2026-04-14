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

    // Stream stdout lines as events
    loop {
        if cancel.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = child.kill().await;
            update_agent_status(&id, AgentStatus::Cancelled, None, None);
            let _ = app.emit("agent_cancelled", serde_json::json!({"id": id}));
            return;
        }

        tokio::select! {
            line = stdout_lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        append_agent_output(&id_for_stdout, &l);
                        let _ = app_for_stdout.emit("agent_stdout", serde_json::json!({
                            "id": &id_for_stdout,
                            "line": &l,
                        }));
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            line = stderr_lines.next_line() => {
                if let Ok(Some(l)) = line {
                    append_agent_output(&id_for_stdout, &format!("[err] {}", l));
                    let _ = app_for_stdout.emit("agent_stderr", serde_json::json!({
                        "id": &id_for_stdout,
                        "line": l,
                    }));
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

    let _ = app.emit(
        "agent_complete",
        serde_json::json!({
            "id": id,
            "exit_code": code,
            "status": if code == 0 { "completed" } else { "failed" },
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
