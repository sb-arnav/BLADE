use crate::agent_commands;
use crate::agents::queue::SharedAgentQueue;
use crate::commands::SharedMcpManager;
use crate::db;
use crate::db_commands::SharedDb;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct RuntimeTaskHandle {
    runtime_id: String,
    child: Arc<Mutex<Child>>,
}

pub type SharedRuntimeRegistry = Arc<Mutex<HashMap<String, RuntimeTaskHandle>>>;
pub type SharedTaskGraphRegistry = Arc<Mutex<HashMap<String, TaskGraph>>>;
pub type SharedMissionRegistry = Arc<Mutex<HashMap<String, StoredMission>>>;
pub type SharedCompanyObjectRegistry = Arc<Mutex<HashMap<String, CompanyObject>>>;
pub type SharedSecurityEngagementRegistry = Arc<Mutex<HashMap<String, SecurityEngagement>>>;

#[derive(Clone)]
pub struct RuntimeServerHandle {
    runtime_id: String,
    url: String,
    child: Arc<Mutex<Child>>,
}

pub type SharedRuntimeServerRegistry = Arc<Mutex<HashMap<String, RuntimeServerHandle>>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCapability {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSessionRef {
    pub runtime_id: String,
    pub session_id: String,
    pub cwd: Option<String>,
    pub title: String,
    pub resumable: bool,
    pub last_active_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallRequirement {
    pub runtime_id: String,
    pub kind: String,
    pub title: String,
    pub message: String,
    pub command: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeDescriptor {
    pub id: String,
    pub name: String,
    pub source: String,
    pub installed: bool,
    pub authenticated: bool,
    pub version: Option<String>,
    pub capabilities: Vec<RuntimeCapability>,
    pub platforms: Vec<String>,
    pub sessions: Vec<RuntimeSessionRef>,
    pub active_tasks: usize,
    pub server_url: Option<String>,
    pub install_requirement: Option<InstallRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCheckpoint {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub status: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskArtifact {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskGraph {
    pub id: String,
    pub goal: String,
    pub operator_type: String,
    pub preferred_runtime: Option<String>,
    pub preferred_substrate: Option<String>,
    pub security_engagement_id: Option<String>,
    pub mission_id: Option<String>,
    pub stage_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub handoff_note: Option<String>,
    pub checkpoints: Vec<TaskCheckpoint>,
    pub artifacts: Vec<TaskArtifact>,
    pub approvals: Vec<String>,
    pub status: String,
    pub session: Option<RuntimeSessionRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeRouteRecommendation {
    pub runtime_id: String,
    pub operator_type: String,
    pub preferred_substrate: Option<String>,
    pub rationale: String,
    pub confidence: f32,
    pub prefers_warm_runtime: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionStage {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub depends_on: Vec<String>,
    pub runtime: RuntimeRouteRecommendation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorMission {
    pub id: String,
    pub goal: String,
    pub summary: String,
    pub stages: Vec<MissionStage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedMissionStage {
    pub stage: MissionStage,
    pub parent_task_id: Option<String>,
    pub handoff_note: Option<String>,
    pub resume_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionRunResult {
    pub launched: Vec<TaskGraph>,
    pub blocked: bool,
    pub completed: bool,
    pub next_stage_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMission {
    pub mission: OperatorMission,
    pub status: String,
    pub last_run_at: Option<i64>,
    pub next_stage_id: Option<String>,
    pub auto_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyObject {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub owner: Option<String>,
    pub linked_mission_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityEngagement {
    pub id: String,
    pub title: String,
    pub owner_name: String,
    pub contact: String,
    pub scope: String,
    pub asset_kind: String,
    pub verification_method: String,
    pub challenge_token: String,
    pub proof_instructions: String,
    pub proof_value: Option<String>,
    pub status: String,
    pub verified_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityBlueprint {
    pub id: String,
    pub title: String,
    pub category: String,
    pub summary: String,
    pub goal_template: String,
    pub runtime_hint: Option<String>,
    pub install_command: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RunnerEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    payload: Value,
}

#[derive(Debug, Deserialize)]
struct CodexHistoryLine {
    session_id: String,
    ts: Option<i64>,
    text: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum RuntimeParserKind {
    ClaudeAgentSdk,
    ClaudeCode,
    CodexCli,
    PlainText,
}

fn timestamp_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn file_timestamp_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_else(timestamp_ms)
}

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(PathBuf::from)
        .ok_or("Blade could not resolve its repository root.".to_string())
}

fn current_platforms() -> Vec<String> {
    vec!["windows".into(), "macos".into(), "linux".into()]
}

fn runtime_capability(id: &str, label: &str, description: &str) -> RuntimeCapability {
    RuntimeCapability {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
    }
}

fn runtime_capabilities(runtime_id: &str) -> Vec<RuntimeCapability> {
    match runtime_id {
        "blade-native" => vec![
            runtime_capability("desktop", "Native desktop control", "Uses Blade's native operator loop, browser-native control, and desktop automation."),
            runtime_capability("browser", "Browser-native control", "Can route browser-heavy work through Blade's CDP-backed browser substrate."),
            runtime_capability("memory", "Local context", "Understands local files, windows, and Blade's memory/context systems."),
        ],
        "claude-agent-sdk" => vec![
            runtime_capability("code", "Coding agent", "Strong codebase editing, tool use, and structured subagent workflows via the Claude Agent SDK."),
            runtime_capability("delegation", "Subagent delegation", "Supports custom agents and higher-agency managed runs."),
            runtime_capability("mcp", "MCP ecosystem", "Can connect to MCP servers and use tool ecosystems already configured for Claude."),
        ],
        "claude-code" => vec![
            runtime_capability("code", "Code runtime", "Launches installed Claude Code sessions directly through the local CLI."),
            runtime_capability("resume", "Session resumption", "Can resume local Claude Code sessions and reuse project memories."),
            runtime_capability("mcp", "MCP import", "Can see Claude's MCP config and runtime session store."),
        ],
        "codex-cli" => vec![
            runtime_capability("code", "OpenAI coding runtime", "Runs installed Codex CLI tasks for repo work, review, and execution."),
            runtime_capability("resume", "Resume sessions", "Can resume previous Codex sessions instead of starting from scratch."),
            runtime_capability("search", "Web search", "Supports Codex's live web search option when available."),
        ],
        "google-gemma-local" => vec![
            runtime_capability("offline", "Offline local inference", "Runs a local Gemma model on your own machine through Ollama."),
            runtime_capability("privacy", "Privacy-first lane", "Useful for sensitive or local-only tasks where you do not want to leave the device."),
            runtime_capability("edge", "On-device Google model", "Uses Google's open Gemma model family for local reasoning and agent support."),
        ],
        "open-interpreter" => vec![
            runtime_capability("desktop", "Local computer interpreter", "Uses Open Interpreter's local computer interface and code execution loop."),
            runtime_capability("shell", "Local code execution", "Can run Python, shell, and other code locally through the interpreter runtime."),
            runtime_capability("opensource", "Open-source operator", "Lets Blade federate work into the open-source Open Interpreter runtime."),
        ],
        "aider-cli" => vec![
            runtime_capability("code", "Terminal pair programmer", "Uses aider's terminal coding workflow for repo editing and implementation."),
            runtime_capability("git", "Repo-aware edits", "Designed around git-backed code editing and iterative patch application."),
            runtime_capability("opensource", "Open-source coding lane", "Lets Blade route code work into an open-source terminal coding agent."),
        ],
        "browser-use" => vec![
            runtime_capability("browser", "Browser agent", "Uses browser-use's browser automation CLI for web-native operator work."),
            runtime_capability("web", "DOM-first automation", "Good fit for website navigation, form filling, extraction, and repetitive web actions."),
            runtime_capability("opensource", "Open-source browser lane", "Lets Blade federate browser work into a GitHub-native browser agent."),
        ],
        "openhands-cli" => vec![
            runtime_capability("code", "Open-source coding agent", "Uses the OpenHands CLI for software engineering tasks in the terminal."),
            runtime_capability("background", "Longer coding runs", "Good fit for longer implementation or verification loops when you want an open-source lane."),
            runtime_capability("opensource", "GitHub-native dev runtime", "Lets Blade federate work into the OpenHands CLI from the unified operator center."),
        ],
        "opencode-cli" => vec![
            runtime_capability("code", "Open source coding agent", "Uses OpenCode as an open-source terminal coding runtime."),
            runtime_capability("agents", "Built-in agent modes", "Can use OpenCode's own coding and planning agent patterns."),
            runtime_capability("opensource", "Legit GitHub coding lane", "Lets Blade federate work into the OpenCode CLI from the operator center."),
        ],
        "tavily-backend" => vec![
            runtime_capability("search", "Research search backend", "Provides strong search and research retrieval for agentic web intelligence."),
            runtime_capability("extract", "Structured extraction", "Can support extract-style workflows for deeper research synthesis."),
            runtime_capability("web-intelligence", "Web intelligence substrate", "A backend Blade can route search-heavy research work through."),
        ],
        "firecrawl-backend" => vec![
            runtime_capability("crawl", "Crawl and map backend", "Provides stronger crawl and scrape primitives for dynamic websites and collection workflows."),
            runtime_capability("extract", "Web extract backend", "Good fit for extracting content from complex pages and multi-page flows."),
            runtime_capability("web-intelligence", "Web intelligence substrate", "A backend Blade can route crawl/extract-heavy work through."),
        ],
        _ => vec![runtime_capability("general", "General runtime", "General-purpose AI runtime.")],
    }
}

fn command_in_path(name: &str) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    for entry in std::env::split_paths(&path_var) {
        for candidate_name in executable_names(name) {
            let candidate = entry.join(&candidate_name);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn executable_names(name: &str) -> Vec<OsString> {
    #[cfg(not(windows))]
    let names = vec![OsString::from(name)];
    #[cfg(windows)]
    {
        let mut names = vec![OsString::from(name)];
        names.push(OsString::from(format!("{name}.exe")));
        names.push(OsString::from(format!("{name}.cmd")));
        names.push(OsString::from(format!("{name}.bat")));
        return names;
    }
    #[cfg(not(windows))]
    names
}

fn version_from_command(binary: &str, args: &[&str]) -> Option<String> {
    crate::cmd_util::silent_cmd(binary)
        .args(args)
        .output()
        .ok()
        .and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !stdout.is_empty() {
                Some(stdout)
            } else if !stderr.is_empty() {
                Some(stderr)
            } else {
                None
            }
        })
}

fn command_succeeds(binary: &str, args: &[&str]) -> bool {
    crate::cmd_util::silent_cmd(binary)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn first_non_empty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn extract_working_directory(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Working directory: ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn claude_home() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude"))
}

fn codex_home() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex"))
}

fn claude_agent_sdk_installed() -> bool {
    repo_root()
        .ok()
        .map(|root| {
            root.join("node_modules")
                .join("@anthropic-ai")
                .join("claude-agent-sdk")
                .exists()
        })
        .unwrap_or(false)
}

fn claude_agent_sdk_version() -> Option<String> {
    let package_path = repo_root()
        .ok()?
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-agent-sdk")
        .join("package.json");
    let content = fs::read_to_string(package_path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn claude_authenticated() -> bool {
    claude_home()
        .map(|home| home.join(".credentials.json").exists())
        .unwrap_or(false)
}

fn codex_authenticated() -> bool {
    codex_home()
        .map(|home| home.join("auth.json").exists())
        .unwrap_or(false)
}

fn open_interpreter_installed() -> bool {
    command_in_path("interpreter").is_some()
}

fn aider_installed() -> bool {
    command_in_path("aider").is_some()
}

fn browser_use_installed() -> bool {
    command_in_path("browser-use").is_some()
}

fn openhands_installed() -> bool {
    command_in_path("openhands").is_some() || command_in_path("uvx").is_some()
}

fn opencode_home() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".config").join("opencode"))
}

fn opencode_share_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".local").join("share").join("opencode"))
}

fn opencode_binary_path() -> Option<PathBuf> {
    if let Some(path) = command_in_path("opencode") {
        return Some(PathBuf::from(path));
    }
    let home = dirs::home_dir()?;
    let direct = home
        .join(".nvm")
        .join("versions")
        .join("node")
        .join("v20.20.1")
        .join("lib")
        .join("node_modules")
        .join("opencode-ai")
        .join("bin")
        .join(".opencode");
    if direct.exists() {
        return Some(direct);
    }
    None
}

fn opencode_installed() -> bool {
    opencode_binary_path().is_some()
        || opencode_home().map(|path| path.exists()).unwrap_or(false)
        || opencode_share_dir()
            .map(|path| path.exists())
            .unwrap_or(false)
}

fn setting_or_env(db_state: &SharedDb, setting_key: &str, env_key: &str) -> Option<String> {
    if let Some(env_value) = std::env::var(env_key)
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(env_value);
    }
    let conn = db_state.lock().ok()?;
    db::get_setting(&conn, setting_key)
        .ok()
        .flatten()
        .filter(|value| !value.trim().is_empty())
}

fn tavily_available_with_db(db_state: &SharedDb) -> bool {
    setting_or_env(db_state, "web.tavily_api_key", "TAVILY_API_KEY").is_some()
}

fn firecrawl_available_with_db(db_state: &SharedDb) -> bool {
    setting_or_env(db_state, "web.firecrawl_api_key", "FIRECRAWL_API_KEY").is_some()
        || setting_or_env(db_state, "web.firecrawl_api_url", "FIRECRAWL_API_URL").is_some()
}

fn ollama_installed() -> bool {
    command_in_path("ollama").is_some()
}

fn list_ollama_models() -> Vec<String> {
    let output = crate::cmd_util::silent_cmd("ollama").arg("list").output();
    let Ok(output) = output else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().next())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

fn list_gemma_models() -> Vec<String> {
    list_ollama_models()
        .into_iter()
        .filter(|model| model.to_lowercase().contains("gemma"))
        .collect()
}

fn preferred_gemma_model() -> Option<String> {
    let models = list_gemma_models();
    if models.is_empty() {
        return None;
    }
    models
        .iter()
        .find(|model| model.starts_with("gemma4"))
        .cloned()
        .or_else(|| {
            models
                .iter()
                .find(|model| model.starts_with("gemma3"))
                .cloned()
        })
        .or_else(|| models.first().cloned())
}

fn collect_files_recursively(root: &Path, extension: &str, limit: usize) -> Vec<PathBuf> {
    fn walk(dir: &Path, extension: &str, output: &mut Vec<PathBuf>, limit: usize) {
        if output.len() >= limit {
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, extension, output, limit);
            } else if path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(extension))
                .unwrap_or(false)
            {
                output.push(path);
                if output.len() >= limit {
                    return;
                }
            }
        }
    }

    let mut files = Vec::new();
    walk(root, extension, &mut files, limit);
    files
}

fn list_claude_sessions(limit: usize) -> Vec<RuntimeSessionRef> {
    let Some(home) = claude_home() else {
        return Vec::new();
    };
    let projects_dir = home.join("projects");
    if !projects_dir.exists() {
        return Vec::new();
    }

    let mut sessions = collect_files_recursively(&projects_dir, "jsonl", limit * 4)
        .into_iter()
        .filter_map(|path| {
            let session_id = path.file_stem()?.to_string_lossy().to_string();
            let content = fs::read_to_string(&path).ok()?;
            let cwd = extract_working_directory(&content);
            let title = first_non_empty_line(&content)
                .map(|line| line.chars().take(90).collect::<String>())
                .unwrap_or_else(|| {
                    format!(
                        "Claude session {}",
                        session_id.chars().take(8).collect::<String>()
                    )
                });
            Some(RuntimeSessionRef {
                runtime_id: "claude-code".into(),
                session_id,
                cwd,
                title,
                resumable: true,
                last_active_at: file_timestamp_ms(&path),
            })
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
    sessions.truncate(limit);
    sessions
}

fn list_codex_sessions(limit: usize) -> Vec<RuntimeSessionRef> {
    let Some(home) = codex_home() else {
        return Vec::new();
    };
    let history_path = home.join("history.jsonl");
    if !history_path.exists() {
        return Vec::new();
    }

    let content = match fs::read_to_string(&history_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let mut seen = HashSet::new();
    let mut sessions = Vec::new();
    for line in content.lines().rev() {
        if sessions.len() >= limit {
            break;
        }
        let Ok(entry) = serde_json::from_str::<CodexHistoryLine>(line) else {
            continue;
        };
        if !seen.insert(entry.session_id.clone()) {
            continue;
        }
        sessions.push(RuntimeSessionRef {
            runtime_id: "codex-cli".into(),
            session_id: entry.session_id.clone(),
            cwd: None,
            title: entry
                .text
                .as_deref()
                .and_then(first_non_empty_line)
                .map(|line| line.chars().take(90).collect::<String>())
                .unwrap_or_else(|| {
                    format!(
                        "Codex session {}",
                        entry.session_id.chars().take(8).collect::<String>()
                    )
                }),
            resumable: true,
            last_active_at: entry
                .ts
                .map(|value| value.saturating_mul(1000))
                .unwrap_or_else(timestamp_ms),
        });
    }
    sessions
}

fn list_open_interpreter_sessions(limit: usize) -> Vec<RuntimeSessionRef> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let profiles_dir = home
        .join(".config")
        .join("open-interpreter")
        .join("profiles");
    if !profiles_dir.exists() {
        return Vec::new();
    }

    let mut sessions = collect_files_recursively(&profiles_dir, "yaml", limit * 2)
        .into_iter()
        .filter_map(|path| {
            let session_id = path.file_stem()?.to_string_lossy().to_string();
            Some(RuntimeSessionRef {
                runtime_id: "open-interpreter".into(),
                session_id: session_id.clone(),
                cwd: None,
                title: format!("Open Interpreter profile {}", session_id),
                resumable: true,
                last_active_at: file_timestamp_ms(&path),
            })
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
    sessions.truncate(limit);
    sessions
}

fn list_opencode_sessions(limit: usize) -> Vec<RuntimeSessionRef> {
    if let Some(binary) = opencode_binary_path() {
        if let Ok(output) = crate::cmd_util::silent_cmd(&binary)
            .arg("session")
            .arg("list")
            .arg("--format")
            .arg("json")
            .arg("-n")
            .arg(limit.to_string())
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(value) = serde_json::from_str::<Value>(&stdout) {
                if let Some(items) = value.as_array() {
                    let sessions = items
                        .iter()
                        .filter_map(|item| {
                            let session_id = item
                                .get("id")
                                .or_else(|| item.get("sessionID"))
                                .or_else(|| item.get("session_id"))
                                .and_then(Value::as_str)?
                                .to_string();
                            let cwd = item
                                .get("directory")
                                .or_else(|| item.get("cwd"))
                                .and_then(Value::as_str)
                                .map(str::to_string);
                            let title = item
                                .get("title")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .or_else(|| {
                                    cwd.as_ref()
                                        .map(|directory| format!("OpenCode in {}", directory))
                                })
                                .unwrap_or_else(|| format!("OpenCode session {}", session_id));
                            let last_active_at = item
                                .get("updatedAt")
                                .or_else(|| item.get("lastActiveAt"))
                                .and_then(Value::as_i64)
                                .unwrap_or_else(timestamp_ms);
                            Some(RuntimeSessionRef {
                                runtime_id: "opencode-cli".into(),
                                session_id,
                                cwd,
                                title,
                                resumable: true,
                                last_active_at,
                            })
                        })
                        .collect::<Vec<_>>();
                    if !sessions.is_empty() {
                        return sessions;
                    }
                }
            }
        }
    }

    let Some(log_dir) = opencode_share_dir().map(|dir| dir.join("log")) else {
        return Vec::new();
    };
    if !log_dir.exists() {
        return Vec::new();
    }

    let mut sessions = collect_files_recursively(&log_dir, "log", limit * 3)
        .into_iter()
        .filter_map(|path| {
            let session_id = path.file_stem()?.to_string_lossy().to_string();
            let content = fs::read_to_string(&path).ok();
            let cwd = content.as_deref().and_then(|text| {
                text.lines().find_map(|line| {
                    line.split("directory=")
                        .nth(1)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
            });
            let title = cwd
                .as_ref()
                .map(|directory| format!("OpenCode in {}", directory))
                .unwrap_or_else(|| format!("OpenCode session {}", session_id));
            Some(RuntimeSessionRef {
                runtime_id: "opencode-cli".into(),
                session_id,
                cwd,
                title,
                resumable: true,
                last_active_at: file_timestamp_ms(&path),
            })
        })
        .collect::<Vec<_>>();
    sessions.sort_by(|a, b| b.last_active_at.cmp(&a.last_active_at));
    sessions.truncate(limit);
    sessions
}

fn derive_opencode_agent(goal: &str) -> &'static str {
    let normalized = goal.to_lowercase();
    if [
        "plan",
        "review",
        "analyze",
        "analyse",
        "inspect",
        "audit",
        "investigate",
        "debug",
        "summarize",
        "explain",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
    {
        "plan"
    } else {
        "build"
    }
}

fn build_install_requirement(
    runtime_id: &str,
    installed: bool,
    authenticated: bool,
) -> Option<InstallRequirement> {
    match runtime_id {
        "claude-agent-sdk" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install Claude Agent SDK".into(),
            message: "Blade found no local Claude Agent SDK package in this workspace. Install it in the Blade repo before using this runtime.".into(),
            command: Some("npm install @anthropic-ai/claude-agent-sdk".into()),
            url: Some("https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk".into()),
        }),
        "claude-code" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install Claude Code".into(),
            message: "Blade could not find the local Claude Code CLI. Install Claude Code, then reopen Operator Center.".into(),
            command: Some("claude install".into()),
            url: Some("https://claude.com/download".into()),
        }),
        "claude-code" | "claude-agent-sdk" if installed && !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "authenticate".into(),
            title: "Authenticate Claude".into(),
            message: "Blade found Claude on this machine, but it does not see a usable Claude auth state yet.".into(),
            command: Some("claude auth login".into()),
            url: Some("https://docs.anthropic.com/".into()),
        }),
        "codex-cli" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install Codex CLI".into(),
            message: "Blade could not find the local Codex CLI. Install Codex on this machine before using this runtime.".into(),
            command: Some("npm install -g @openai/codex".into()),
            url: Some("https://openai.com/".into()),
        }),
        "codex-cli" if installed && !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "authenticate".into(),
            title: "Authenticate Codex".into(),
            message: "Blade found Codex CLI, but it does not see a valid local auth.json yet.".into(),
            command: Some("codex login".into()),
            url: None,
        }),
        "google-gemma-local" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install Ollama for Gemma".into(),
            message: "Blade needs Ollama on this machine before it can run a local Gemma model.".into(),
            command: Some("Install Ollama, then run: ollama pull gemma4".into()),
            url: Some("https://ollama.com/library/gemma4".into()),
        }),
        "google-gemma-local" if installed && !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Pull a Gemma model".into(),
            message: "Blade found Ollama, but no local Gemma model is installed yet.".into(),
            command: Some("ollama pull gemma4".into()),
            url: Some("https://ollama.com/library/gemma4".into()),
        }),
        "open-interpreter" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install Open Interpreter".into(),
            message: "Blade could not find the Open Interpreter CLI on this machine yet.".into(),
            command: Some("pipx install open-interpreter".into()),
            url: Some("https://github.com/openinterpreter/open-interpreter".into()),
        }),
        "open-interpreter" if installed && !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "repair".into(),
            title: "Repair Open Interpreter".into(),
            message: "Blade found Open Interpreter, but the local CLI is not healthy yet. Repair the environment, then retry.".into(),
            command: Some("pipx inject open-interpreter setuptools".into()),
            url: Some("https://github.com/openinterpreter/open-interpreter".into()),
        }),
        "aider-cli" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install aider".into(),
            message: "Blade could not find aider on this machine yet.".into(),
            command: Some("python -m pip install aider-install && aider-install".into()),
            url: Some("https://github.com/Aider-AI/aider".into()),
        }),
        "browser-use" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install browser-use".into(),
            message: "Blade could not find the browser-use CLI on this machine yet.".into(),
            command: Some("uvx browser-use@latest init --help".into()),
            url: Some("https://github.com/browser-use/browser-use".into()),
        }),
        "tavily-backend" if !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "configure".into(),
            title: "Connect Tavily".into(),
            message: "Blade needs a Tavily API key in its environment before it can use Tavily as a research/search substrate.".into(),
            command: Some("export TAVILY_API_KEY=...".into()),
            url: Some("https://docs.tavily.com/".into()),
        }),
        "firecrawl-backend" if !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "configure".into(),
            title: "Connect Firecrawl".into(),
            message: "Blade needs FIRECRAWL_API_KEY or a self-hosted FIRECRAWL_API_URL before it can use Firecrawl as a crawl/extract substrate.".into(),
            command: Some("export FIRECRAWL_API_KEY=...".into()),
            url: Some("https://docs.firecrawl.dev/".into()),
        }),
        "openhands-cli" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install OpenHands CLI".into(),
            message: "Blade could not find the OpenHands CLI or uvx launcher on this machine yet.".into(),
            command: Some("pip install openhands-ai  OR  uvx --python 3.12 --from openhands-ai openhands".into()),
            url: Some("https://github.com/OpenHands/OpenHands".into()),
        }),
        "opencode-cli" if !installed => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "install".into(),
            title: "Install OpenCode".into(),
            message: "Blade could not find a runnable OpenCode CLI on this machine yet.".into(),
            command: Some("npm i -g opencode-ai@latest".into()),
            url: Some("https://github.com/anomalyco/opencode".into()),
        }),
        "opencode-cli" if installed && !authenticated => Some(InstallRequirement {
            runtime_id: runtime_id.into(),
            kind: "repair".into(),
            title: "Repair OpenCode".into(),
            message: "Blade found OpenCode state on this machine, but it cannot find a runnable CLI entrypoint right now.".into(),
            command: Some("npm i -g opencode-ai@latest  OR  ensure the opencode binary is on PATH".into()),
            url: Some("https://github.com/anomalyco/opencode".into()),
        }),
        _ => None,
    }
}

async fn active_task_counts(registry: &SharedRuntimeRegistry) -> HashMap<String, usize> {
    let registry = registry.lock().await;
    let mut counts = HashMap::new();
    for handle in registry.values() {
        *counts.entry(handle.runtime_id.clone()).or_insert(0) += 1;
    }
    counts
}

async fn active_server_urls(registry: &SharedRuntimeServerRegistry) -> HashMap<String, String> {
    let registry = registry.lock().await;
    registry
        .values()
        .map(|handle| (handle.runtime_id.clone(), handle.url.clone()))
        .collect()
}

fn build_runtime_descriptors(
    counts: &HashMap<String, usize>,
    server_urls: &HashMap<String, String>,
    tavily_ready: bool,
    firecrawl_ready: bool,
) -> Vec<RuntimeDescriptor> {
    let claude_cli_path = command_in_path("claude");
    let codex_cli_path = command_in_path("codex");
    let blade_installed = true;
    let claude_sdk_installed = claude_agent_sdk_installed();
    let claude_code_installed =
        claude_cli_path.is_some() || claude_home().map(|path| path.exists()).unwrap_or(false);
    let codex_installed =
        codex_cli_path.is_some() || codex_home().map(|path| path.exists()).unwrap_or(false);
    let ollama_available = ollama_installed();
    let gemma_models = list_gemma_models();
    let gemma_installed = !gemma_models.is_empty();
    let claude_auth = claude_authenticated();
    let codex_auth = codex_authenticated();
    let open_interpreter_available = open_interpreter_installed();
    let open_interpreter_ready =
        open_interpreter_available && command_succeeds("interpreter", &["--version"]);
    let aider_available = aider_installed();
    let browser_use_available = browser_use_installed();
    let openhands_available = openhands_installed();
    let opencode_available = opencode_installed();
    let opencode_ready = opencode_binary_path().is_some();

    vec![
        RuntimeDescriptor {
            id: "blade-native".into(),
            name: "Blade Native".into(),
            source: "blade".into(),
            installed: blade_installed,
            authenticated: true,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            capabilities: runtime_capabilities("blade-native"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: *counts.get("blade-native").unwrap_or(&0),
            server_url: None,
            install_requirement: None,
        },
        RuntimeDescriptor {
            id: "claude-agent-sdk".into(),
            name: "Claude Agent SDK".into(),
            source: "anthropic".into(),
            installed: claude_sdk_installed,
            authenticated: claude_auth,
            version: claude_agent_sdk_version(),
            capabilities: runtime_capabilities("claude-agent-sdk"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: *counts.get("claude-agent-sdk").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "claude-agent-sdk",
                claude_sdk_installed,
                claude_auth,
            ),
        },
        RuntimeDescriptor {
            id: "claude-code".into(),
            name: "Claude Code".into(),
            source: "anthropic".into(),
            installed: claude_code_installed,
            authenticated: claude_auth,
            version: claude_cli_path
                .as_deref()
                .and_then(|_| version_from_command("claude", &["--version"])),
            capabilities: runtime_capabilities("claude-code"),
            platforms: current_platforms(),
            sessions: if claude_code_installed {
                list_claude_sessions(8)
            } else {
                Vec::new()
            },
            active_tasks: *counts.get("claude-code").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "claude-code",
                claude_code_installed,
                claude_auth,
            ),
        },
        RuntimeDescriptor {
            id: "codex-cli".into(),
            name: "Codex CLI".into(),
            source: "openai".into(),
            installed: codex_installed,
            authenticated: codex_auth,
            version: codex_cli_path
                .as_deref()
                .and_then(|_| version_from_command("codex", &["--version"])),
            capabilities: runtime_capabilities("codex-cli"),
            platforms: current_platforms(),
            sessions: if codex_installed {
                list_codex_sessions(8)
            } else {
                Vec::new()
            },
            active_tasks: *counts.get("codex-cli").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "codex-cli",
                codex_installed,
                codex_auth,
            ),
        },
        RuntimeDescriptor {
            id: "google-gemma-local".into(),
            name: "Gemma Local".into(),
            source: "google".into(),
            installed: ollama_available,
            authenticated: gemma_installed,
            version: if ollama_available {
                version_from_command("ollama", &["--version"])
            } else {
                None
            },
            capabilities: runtime_capabilities("google-gemma-local"),
            platforms: current_platforms(),
            sessions: gemma_models
                .iter()
                .enumerate()
                .map(|(index, model)| RuntimeSessionRef {
                    runtime_id: "google-gemma-local".into(),
                    session_id: model.clone(),
                    cwd: None,
                    title: format!("Local model {}", model),
                    resumable: false,
                    last_active_at: timestamp_ms() - ((index as i64) * 1000),
                })
                .collect(),
            active_tasks: *counts.get("google-gemma-local").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "google-gemma-local",
                ollama_available,
                gemma_installed,
            ),
        },
        RuntimeDescriptor {
            id: "open-interpreter".into(),
            name: "Open Interpreter".into(),
            source: "github/openinterpreter".into(),
            installed: open_interpreter_available,
            authenticated: open_interpreter_ready,
            version: if open_interpreter_available {
                version_from_command("interpreter", &["--version"])
            } else {
                None
            },
            capabilities: runtime_capabilities("open-interpreter"),
            platforms: current_platforms(),
            sessions: if open_interpreter_available {
                list_open_interpreter_sessions(6)
            } else {
                Vec::new()
            },
            active_tasks: *counts.get("open-interpreter").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "open-interpreter",
                open_interpreter_available,
                open_interpreter_ready,
            ),
        },
        RuntimeDescriptor {
            id: "aider-cli".into(),
            name: "Aider".into(),
            source: "github/Aider-AI".into(),
            installed: aider_available,
            authenticated: aider_available,
            version: if aider_available {
                version_from_command("aider", &["--version"])
            } else {
                None
            },
            capabilities: runtime_capabilities("aider-cli"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: *counts.get("aider-cli").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "aider-cli",
                aider_available,
                aider_available,
            ),
        },
        RuntimeDescriptor {
            id: "browser-use".into(),
            name: "Browser Use".into(),
            source: "github/browser-use".into(),
            installed: browser_use_available,
            authenticated: browser_use_available,
            version: if browser_use_available {
                version_from_command("browser-use", &["--version"])
            } else {
                None
            },
            capabilities: runtime_capabilities("browser-use"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: *counts.get("browser-use").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "browser-use",
                browser_use_available,
                browser_use_available,
            ),
        },
        RuntimeDescriptor {
            id: "tavily-backend".into(),
            name: "Tavily".into(),
            source: "tavily".into(),
            installed: true,
            authenticated: tavily_ready,
            version: None,
            capabilities: runtime_capabilities("tavily-backend"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: 0,
            server_url: None,
            install_requirement: build_install_requirement("tavily-backend", true, tavily_ready),
        },
        RuntimeDescriptor {
            id: "firecrawl-backend".into(),
            name: "Firecrawl".into(),
            source: "firecrawl".into(),
            installed: true,
            authenticated: firecrawl_ready,
            version: None,
            capabilities: runtime_capabilities("firecrawl-backend"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: 0,
            server_url: None,
            install_requirement: build_install_requirement(
                "firecrawl-backend",
                true,
                firecrawl_ready,
            ),
        },
        RuntimeDescriptor {
            id: "openhands-cli".into(),
            name: "OpenHands CLI".into(),
            source: "github/OpenHands".into(),
            installed: openhands_available,
            authenticated: openhands_available,
            version: if command_in_path("openhands").is_some() {
                version_from_command("openhands", &["--version"])
            } else {
                None
            },
            capabilities: runtime_capabilities("openhands-cli"),
            platforms: current_platforms(),
            sessions: Vec::new(),
            active_tasks: *counts.get("openhands-cli").unwrap_or(&0),
            server_url: None,
            install_requirement: build_install_requirement(
                "openhands-cli",
                openhands_available,
                openhands_available,
            ),
        },
        RuntimeDescriptor {
            id: "opencode-cli".into(),
            name: "OpenCode".into(),
            source: "github/anomalyco".into(),
            installed: opencode_available,
            authenticated: opencode_ready,
            version: opencode_binary_path().as_ref().and_then(|path| {
                version_from_command(path.to_string_lossy().as_ref(), &["--version"])
            }),
            capabilities: runtime_capabilities("opencode-cli"),
            platforms: current_platforms(),
            sessions: if opencode_available {
                list_opencode_sessions(8)
            } else {
                Vec::new()
            },
            active_tasks: *counts.get("opencode-cli").unwrap_or(&0),
            server_url: server_urls.get("opencode-cli").cloned(),
            install_requirement: build_install_requirement(
                "opencode-cli",
                opencode_available,
                opencode_ready,
            ),
        },
    ]
}

#[tauri::command]
pub async fn discover_ai_runtimes(
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    db_state: tauri::State<'_, SharedDb>,
) -> Result<Vec<RuntimeDescriptor>, String> {
    let counts = active_task_counts(registry.inner()).await;
    let server_urls = active_server_urls(servers.inner()).await;
    Ok(build_runtime_descriptors(
        &counts,
        &server_urls,
        tavily_available_with_db(db_state.inner()),
        firecrawl_available_with_db(db_state.inner()),
    ))
}

#[tauri::command]
pub async fn runtime_list_task_graphs(
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
) -> Result<Vec<TaskGraph>, String> {
    let mut entries = tasks.lock().await.values().cloned().collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        let a_ts = a
            .checkpoints
            .last()
            .map(|checkpoint| checkpoint.timestamp)
            .unwrap_or(0);
        let b_ts = b
            .checkpoints
            .last()
            .map(|checkpoint| checkpoint.timestamp)
            .unwrap_or(0);
        b_ts.cmp(&a_ts)
    });
    Ok(entries)
}

#[tauri::command]
pub fn runtime_list_sessions(runtime_id: String) -> Result<Vec<RuntimeSessionRef>, String> {
    let sessions = match runtime_id.as_str() {
        "claude-code" => list_claude_sessions(20),
        "codex-cli" => list_codex_sessions(20),
        "google-gemma-local" => list_gemma_models()
            .into_iter()
            .enumerate()
            .map(|(index, model)| RuntimeSessionRef {
                runtime_id: "google-gemma-local".into(),
                session_id: model.clone(),
                cwd: None,
                title: format!("Local model {}", model),
                resumable: false,
                last_active_at: timestamp_ms() - ((index as i64) * 1000),
            })
            .collect(),
        "open-interpreter" => list_open_interpreter_sessions(20),
        "opencode-cli" => list_opencode_sessions(20),
        "claude-agent-sdk" => Vec::new(),
        "blade-native" => Vec::new(),
        "aider-cli" => Vec::new(),
        "browser-use" => Vec::new(),
        "openhands-cli" => Vec::new(),
        _ => return Err(format!("Unknown runtime `{runtime_id}`.")),
    };
    Ok(sessions)
}

#[tauri::command]
pub fn runtime_prepare_install(
    db_state: tauri::State<'_, SharedDb>,
    runtime_id: String,
) -> Result<InstallRequirement, String> {
    let descriptors = build_runtime_descriptors(
        &HashMap::new(),
        &HashMap::new(),
        tavily_available_with_db(db_state.inner()),
        firecrawl_available_with_db(db_state.inner()),
    );
    descriptors
        .into_iter()
        .find(|descriptor| descriptor.id == runtime_id)
        .and_then(|descriptor| descriptor.install_requirement)
        .ok_or_else(|| {
            format!("Blade does not have install guidance for `{runtime_id}` right now.")
        })
}

#[tauri::command]
pub async fn runtime_start_server(
    runtime_id: String,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
) -> Result<String, String> {
    match runtime_id.as_str() {
        "opencode-cli" => ensure_opencode_server(servers.inner().clone()).await,
        _ => Err(format!(
            "Blade does not support a warm server for `{runtime_id}` right now."
        )),
    }
}

#[tauri::command]
pub async fn runtime_stop_server(
    runtime_id: String,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
) -> Result<(), String> {
    let handle = servers.lock().await.remove(&runtime_id);
    let Some(handle) = handle else {
        return Err(format!(
            "Blade could not find a running server for `{runtime_id}`."
        ));
    };
    let result = {
        let mut child = handle.child.lock().await;
        child.kill().await
    };
    result.map_err(|error| format!("Blade could not stop the `{runtime_id}` server: {error}"))
}

fn build_task_graph(
    id: String,
    goal: String,
    operator_type: String,
    preferred_runtime: Option<String>,
    preferred_substrate: Option<String>,
    security_engagement_id: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    session: Option<RuntimeSessionRef>,
    artifacts: Vec<TaskArtifact>,
    status: &str,
) -> TaskGraph {
    TaskGraph {
        id: id.clone(),
        goal,
        operator_type,
        preferred_runtime,
        preferred_substrate,
        security_engagement_id,
        mission_id,
        stage_id,
        parent_task_id,
        handoff_note,
        checkpoints: vec![TaskCheckpoint {
            id: format!("{id}-bootstrap"),
            title: "Task created".into(),
            detail: "Blade registered this task in the operator control plane.".into(),
            status: "completed".into(),
            timestamp: timestamp_ms(),
        }],
        artifacts,
        approvals: Vec::new(),
        status: status.into(),
        session,
    }
}

fn task_artifacts(parent_task_id: Option<&str>, handoff_note: Option<&str>) -> Vec<TaskArtifact> {
    let mut artifacts = Vec::new();
    if let Some(parent_task_id) = parent_task_id.filter(|value| !value.trim().is_empty()) {
        artifacts.push(TaskArtifact {
            id: format!("artifact-parent-{parent_task_id}"),
            label: "Source task".into(),
            kind: "task_ref".into(),
            value: parent_task_id.to_string(),
        });
    }
    if let Some(handoff_note) = handoff_note.filter(|value| !value.trim().is_empty()) {
        artifacts.push(TaskArtifact {
            id: format!("artifact-handoff-{}", uuid::Uuid::new_v4()),
            label: "Handoff context".into(),
            kind: "summary".into(),
            value: handoff_note.to_string(),
        });
    }
    artifacts
}

fn security_engagement_artifacts(engagement: &SecurityEngagement) -> Vec<TaskArtifact> {
    vec![
        TaskArtifact {
            id: format!("artifact-security-engagement-{}", engagement.id),
            label: "Security engagement".into(),
            kind: "security_engagement".into(),
            value: engagement.id.clone(),
        },
        TaskArtifact {
            id: format!("artifact-security-scope-{}", engagement.id),
            label: "Approved security scope".into(),
            kind: "scope".into(),
            value: engagement.scope.clone(),
        },
        TaskArtifact {
            id: format!("artifact-security-proof-{}", engagement.id),
            label: "Verification proof".into(),
            kind: "verification".into(),
            value: format!(
                "{}\n{}\n{}",
                engagement.verification_method,
                engagement.challenge_token,
                engagement.proof_value.clone().unwrap_or_default()
            ),
        },
    ]
}

fn resolve_security_engagement_for_goal(
    goal: &str,
    explicit_id: Option<&str>,
    engagements: &HashMap<String, SecurityEngagement>,
) -> Result<Option<SecurityEngagement>, String> {
    if !security_keywords(&goal.to_lowercase()) {
        return Ok(None);
    }

    let engagement = if let Some(engagement_id) =
        explicit_id.filter(|value| !value.trim().is_empty())
    {
        engagements.get(engagement_id).cloned().ok_or_else(|| {
            format!("Blade could not find the requested security engagement `{engagement_id}`.")
        })?
    } else {
        active_verified_engagement(engagements).ok_or_else(|| {
            "Blade requires a verified security engagement before launching scoped security work.".to_string()
        })?
    };

    if engagement.status != "verified" {
        return Err(
            "Blade requires a verified security engagement before launching scoped security work."
                .into(),
        );
    }

    Ok(Some(engagement))
}

fn lineage_session_for_runtime(
    tasks: &HashMap<String, TaskGraph>,
    parent_task_id: Option<&str>,
    runtime_id: &str,
) -> Option<RuntimeSessionRef> {
    let mut cursor = parent_task_id
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty());

    while let Some(task_id) = cursor {
        let task = tasks.get(&task_id)?;
        if task
            .preferred_runtime
            .as_deref()
            .map(|value| value == runtime_id)
            .unwrap_or(false)
        {
            if let Some(session) = task.session.as_ref().filter(|session| session.resumable) {
                return Some(session.clone());
            }
        }
        cursor = task.parent_task_id.clone();
    }

    None
}

async fn persist_task_graph(store: &SharedTaskGraphRegistry, graph: &TaskGraph) {
    store.lock().await.insert(graph.id.clone(), graph.clone());
}

async fn update_task_graph_state(
    store: &SharedTaskGraphRegistry,
    task_id: &str,
    status: Option<&str>,
    session_id: Option<&str>,
) {
    if let Some(task) = store.lock().await.get_mut(task_id) {
        if let Some(status) = status {
            task.status = status.to_string();
        }
        if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
            let session = task.session.get_or_insert(RuntimeSessionRef {
                runtime_id: task
                    .preferred_runtime
                    .clone()
                    .unwrap_or_else(|| "unknown".into()),
                session_id: session_id.to_string(),
                cwd: None,
                title: task.goal.chars().take(90).collect(),
                resumable: true,
                last_active_at: timestamp_ms(),
            });
            session.session_id = session_id.to_string();
            session.last_active_at = timestamp_ms();
        }
    }
}

async fn append_task_checkpoint(
    store: &SharedTaskGraphRegistry,
    task_id: &str,
    title: &str,
    detail: &str,
    status: &str,
) {
    if let Some(task) = store.lock().await.get_mut(task_id) {
        task.checkpoints.push(TaskCheckpoint {
            id: format!("{}-{}", task_id, uuid::Uuid::new_v4()),
            title: title.to_string(),
            detail: detail.to_string(),
            status: status.to_string(),
            timestamp: timestamp_ms(),
        });
    }
}

async fn append_task_summary_artifact(
    store: &SharedTaskGraphRegistry,
    task_id: &str,
    summary: &str,
) {
    if summary.trim().is_empty() {
        return;
    }
    if let Some(task) = store.lock().await.get_mut(task_id) {
        task.artifacts.push(TaskArtifact {
            id: format!("artifact-summary-{}", uuid::Uuid::new_v4()),
            label: "Runtime summary".into(),
            kind: "summary".into(),
            value: summary.to_string(),
        });
    }
}

async fn upsert_mission_record(
    store: &SharedMissionRegistry,
    mission: &OperatorMission,
    status: &str,
    next_stage_id: Option<String>,
    auto_run: bool,
) {
    store.lock().await.insert(
        mission.id.clone(),
        StoredMission {
            mission: mission.clone(),
            status: status.to_string(),
            last_run_at: Some(timestamp_ms()),
            next_stage_id,
            auto_run,
        },
    );
}

fn latest_task_timestamp(task: &TaskGraph) -> i64 {
    task.checkpoints
        .last()
        .map(|checkpoint| checkpoint.timestamp)
        .unwrap_or(0)
}

fn compact_multiline(value: &str, max_chars: usize) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        normalized
    } else {
        let compact = normalized.chars().take(max_chars).collect::<String>();
        format!("{compact}...")
    }
}

fn artifact_digest_lines(task: &TaskGraph, limit: usize) -> Vec<String> {
    task.artifacts
        .iter()
        .rev()
        .filter(|artifact| {
            matches!(
                artifact.kind.as_str(),
                "summary"
                    | "web_results"
                    | "crawl_results"
                    | "search_results"
                    | "result"
                    | "scope"
                    | "verification"
            )
        })
        .take(limit)
        .map(|artifact| {
            format!(
                "{} [{}]: {}",
                artifact.label,
                artifact.kind,
                compact_multiline(&artifact.value, 320)
            )
        })
        .collect::<Vec<_>>()
}

fn build_handoff_note_from_task(task: &TaskGraph) -> String {
    let latest_checkpoint = task.checkpoints.last();
    let latest_summary = task
        .artifacts
        .iter()
        .rev()
        .find(|artifact| artifact.kind == "summary")
        .map(|artifact| artifact.value.clone());
    let artifact_digest = artifact_digest_lines(task, 3);

    [
        task.preferred_runtime
            .as_ref()
            .map(|runtime| format!("Source runtime: {runtime}")),
        task.session
            .as_ref()
            .map(|session| format!("Source session: {}", session.session_id)),
        Some(format!("Task goal: {}", task.goal)),
        latest_checkpoint.map(|checkpoint| {
            format!(
                "Latest checkpoint: {}{}",
                checkpoint.title,
                if checkpoint.detail.is_empty() {
                    String::new()
                } else {
                    format!(" — {}", checkpoint.detail)
                }
            )
        }),
        latest_summary.map(|summary| format!("Latest output:\n{summary}")),
        (!artifact_digest.is_empty()).then(|| {
            format!(
                "Relevant artifacts:\n{}",
                artifact_digest
                    .into_iter()
                    .map(|line| format!("- {line}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn apply_handoff_context(goal: &str, handoff_note: Option<&str>) -> String {
    match handoff_note.filter(|value| !value.trim().is_empty()) {
        Some(note) => format!(
            "{goal}\n\nHandoff context from the previous operator/runtime:\n{note}\n\nContinue from that state instead of starting from scratch."
        ),
        None => goal.to_string(),
    }
}

fn runtime_available(runtime_id: &str, descriptors: &[RuntimeDescriptor]) -> bool {
    descriptors.iter().any(|runtime| {
        runtime.id == runtime_id
            && runtime.installed
            && (runtime.authenticated || runtime_id == "blade-native")
    })
}

fn runtime_is_warm(runtime_id: &str, descriptors: &[RuntimeDescriptor]) -> bool {
    descriptors
        .iter()
        .any(|runtime| runtime.id == runtime_id && runtime.server_url.as_ref().is_some())
}

fn coding_keywords(goal: &str) -> bool {
    [
        "code",
        "repo",
        "repository",
        "refactor",
        "test",
        "build",
        "compile",
        "pr",
        "pull request",
        "fix",
        "typescript",
        "rust",
        "debug",
        "review",
        "commit",
        "branch",
        "file",
        "implement",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn browser_keywords(goal: &str) -> bool {
    [
        "browser", "website", "web", "youtube", "gmail", "chrome", "edge", "tab", "page", "login",
        "upload", "navigate", "click", "selector", "url",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn browser_agent_keywords(goal: &str) -> bool {
    [
        "form",
        "fill out",
        "submit",
        "scrape",
        "extract",
        "crawl",
        "apply",
        "checkout",
        "signup",
        "sign up",
        "log in",
        "login",
        "dashboard",
        "portal",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn desktop_keywords(goal: &str) -> bool {
    [
        "desktop",
        "window",
        "app",
        "screen",
        "mouse",
        "keyboard",
        "clipboard",
        "focus window",
        "open app",
        "drag",
        "scroll",
        "computer",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn research_keywords(goal: &str) -> bool {
    [
        "research",
        "summarize",
        "document",
        "write",
        "draft",
        "compare",
        "analyze",
        "study",
        "brainstorm",
        "plan",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn local_privacy_keywords(goal: &str) -> bool {
    [
        "local",
        "offline",
        "private",
        "privacy",
        "on-device",
        "on device",
        "without internet",
        "no cloud",
        "sensitive",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn security_keywords(goal: &str) -> bool {
    [
        "pentest",
        "penetration test",
        "security test",
        "security assessment",
        "bug bounty",
        "red team",
        "vulnerability",
        "vuln",
        "exploit",
        "recon",
        "enumerate",
        "enumeration",
        "scan",
        "nmap",
        "burp",
        "xss",
        "sql injection",
        "rce",
    ]
    .iter()
    .any(|keyword| goal.contains(keyword))
}

fn active_verified_engagement(
    engagements: &HashMap<String, SecurityEngagement>,
) -> Option<SecurityEngagement> {
    engagements
        .values()
        .filter(|engagement| engagement.status == "verified")
        .max_by_key(|engagement| engagement.updated_at)
        .cloned()
}

fn proof_instructions(method: &str, token: &str) -> String {
    match method {
        "dns_txt" => format!("Add a DNS TXT record on the target domain with this exact value: {token}"),
        "repo_file" => format!(
            "Create a plain text file named `blade-security-proof.txt` in the target repository root containing this exact token: {token}"
        ),
        "host_file" => format!(
            "Create a plain text file named `blade-security-proof.txt` in the target system root or approved proof path containing this exact token: {token}"
        ),
        _ => format!(
            "Record and retain an owner attestation referencing this exact challenge token before Blade performs scoped security work: {token}"
        ),
    }
}

fn capability_blueprints() -> Vec<CapabilityBlueprint> {
    vec![
        CapabilityBlueprint {
            id: "system-wsl".into(),
            title: "WSL workstation bootstrap".into(),
            category: "system".into(),
            summary: "Prepare Windows for deeper local agent work by installing or hardening WSL, shell tooling, and repo bridges.".into(),
            goal_template: "Set up WSL and a clean Linux-side developer workspace for Blade, verify the shell/toolchain, and summarize what changed.".into(),
            runtime_hint: Some("blade-native".into()),
            install_command: Some("wsl --install".into()),
            source_url: Some("https://learn.microsoft.com/windows/wsl/install".into()),
        },
        CapabilityBlueprint {
            id: "creator-obs".into(),
            title: "OBS creator automation".into(),
            category: "creator".into(),
            summary: "Prepare OBS scenes, recording defaults, and a repeatable capture workflow so Blade can help with content production.".into(),
            goal_template: "Set up OBS for content recording, create a sane default scene/recording workflow, and verify that recording is ready to use.".into(),
            runtime_hint: Some("blade-native".into()),
            install_command: None,
            source_url: Some("https://obsproject.com/".into()),
        },
        CapabilityBlueprint {
            id: "web-tavily".into(),
            title: "Tavily research backend".into(),
            category: "web-intelligence".into(),
            summary: "Give Blade a strong research/search substrate for agentic search and extraction workflows.".into(),
            goal_template: "Connect Tavily as a research backend for Blade, verify credentials/config, and document how Blade should route deep research work through it.".into(),
            runtime_hint: Some("blade-native".into()),
            install_command: None,
            source_url: Some("https://docs.tavily.com/".into()),
        },
        CapabilityBlueprint {
            id: "web-firecrawl".into(),
            title: "Firecrawl crawl and extract backend".into(),
            category: "web-intelligence".into(),
            summary: "Give Blade a stronger crawl/extract substrate for dynamic sites and web-scale collection.".into(),
            goal_template: "Connect Firecrawl as a crawl/extract backend for Blade, verify credentials/config, and define when Blade should prefer it over simple browser automation.".into(),
            runtime_hint: Some("blade-native".into()),
            install_command: None,
            source_url: Some("https://docs.firecrawl.dev/".into()),
        },
        CapabilityBlueprint {
            id: "toolsmith-pack".into(),
            title: "Toolsmith capability pack".into(),
            category: "self-upgrade".into(),
            summary: "Create a Blade plugin/package workflow for generating scripts, commands, and reusable operator helpers.".into(),
            goal_template: "Design and scaffold a Blade capability pack that can register reusable commands, scripts, and setup helpers, then document how Blade should use it for future self-upgrades.".into(),
            runtime_hint: Some("opencode-cli".into()),
            install_command: None,
            source_url: Some("https://pi.dev/".into()),
        },
        CapabilityBlueprint {
            id: "security-lab".into(),
            title: "Owned security lab".into(),
            category: "security".into(),
            summary: "Prepare a safe owned-asset security workspace with explicit scope, logging, and repeatable assessment workflows.".into(),
            goal_template: "Prepare a safe owned security lab workflow for Blade, including engagement verification, logging, reporting, and scoped assessment execution.".into(),
            runtime_hint: Some("blade-native".into()),
            install_command: None,
            source_url: None,
        },
    ]
}

fn recommend_route_from_goal(
    goal: &str,
    descriptors: &[RuntimeDescriptor],
    verified_engagement: Option<&SecurityEngagement>,
) -> RuntimeRouteRecommendation {
    let normalized = goal.to_lowercase();
    if security_keywords(&normalized) {
        let rationale = if let Some(engagement) = verified_engagement {
            format!(
                "This looks like security assessment work. Blade should keep it inside its native operator/runtime fabric and stay scoped to the verified engagement `{}` covering {}.",
                engagement.title, engagement.scope
            )
        } else {
            "This looks like security assessment work, but Blade should not move into offensive security execution until the user creates and verifies a scoped security engagement for the owned asset.".into()
        };
        return RuntimeRouteRecommendation {
            runtime_id: "blade-native".into(),
            operator_type: if verified_engagement.is_some() {
                "security_operator".into()
            } else {
                "governed_security_operator".into()
            },
            preferred_substrate: if browser_keywords(&normalized) {
                Some("browser-native".into())
            } else if desktop_keywords(&normalized) {
                Some("windows-native".into())
            } else {
                None
            },
            rationale,
            confidence: if verified_engagement.is_some() {
                0.9
            } else {
                0.98
            },
            prefers_warm_runtime: false,
        };
    }

    if normalized.contains("open interpreter") && runtime_available("open-interpreter", descriptors)
    {
        return RuntimeRouteRecommendation {
            runtime_id: "open-interpreter".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/computer".into()),
            rationale: "You explicitly asked for Open Interpreter, so Blade should delegate into that open-source computer runtime.".into(),
            confidence: 0.95,
            prefers_warm_runtime: false,
        };
    }

    if normalized.contains("aider") && runtime_available("aider-cli", descriptors) {
        return RuntimeRouteRecommendation {
            runtime_id: "aider-cli".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/git".into()),
            rationale: "You explicitly asked for aider, so Blade should delegate into the open-source terminal coding runtime.".into(),
            confidence: 0.95,
            prefers_warm_runtime: false,
        };
    }

    if (normalized.contains("openhands") || normalized.contains("open hands"))
        && runtime_available("openhands-cli", descriptors)
    {
        return RuntimeRouteRecommendation {
            runtime_id: "openhands-cli".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/code-agent".into()),
            rationale: "You explicitly asked for OpenHands, so Blade should delegate into that open-source coding runtime.".into(),
            confidence: 0.95,
            prefers_warm_runtime: false,
        };
    }

    if normalized.contains("opencode") && runtime_available("opencode-cli", descriptors) {
        let warm = runtime_is_warm("opencode-cli", descriptors);
        return RuntimeRouteRecommendation {
            runtime_id: "opencode-cli".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/code-agent".into()),
            rationale: if warm {
                "You explicitly asked for OpenCode, and Blade already has a warm OpenCode backend ready to reuse.".into()
            } else {
                "You explicitly asked for OpenCode, so Blade should delegate into that open-source coding runtime.".into()
            },
            confidence: if warm { 0.98 } else { 0.95 },
            prefers_warm_runtime: warm,
        };
    }

    if (normalized.contains("browser-use") || normalized.contains("browser use"))
        && runtime_available("browser-use", descriptors)
    {
        return RuntimeRouteRecommendation {
            runtime_id: "browser-use".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("browser-agent".into()),
            rationale: "You explicitly asked for browser-use, so Blade should route the web task into that open-source browser agent.".into(),
            confidence: 0.95,
            prefers_warm_runtime: false,
        };
    }

    if local_privacy_keywords(&normalized) && runtime_available("google-gemma-local", descriptors) {
        return RuntimeRouteRecommendation {
            runtime_id: "google-gemma-local".into(),
            operator_type: "local_reasoning".into(),
            preferred_substrate: Some("local-ollama".into()),
            rationale: "This looks privacy-first or offline-first, so Blade should route it to a local Gemma runtime on this machine.".into(),
            confidence: 0.86,
            prefers_warm_runtime: false,
        };
    }

    if research_keywords(&normalized)
        && normalized.contains("crawl")
        && runtime_available("firecrawl-backend", descriptors)
    {
        return RuntimeRouteRecommendation {
            runtime_id: "firecrawl-backend".into(),
            operator_type: "web_intelligence".into(),
            preferred_substrate: Some("crawl-extract".into()),
            rationale: "This looks like crawl-heavy research or extraction work, so Firecrawl is the strongest configured web-intelligence backend.".into(),
            confidence: 0.84,
            prefers_warm_runtime: false,
        };
    }

    if research_keywords(&normalized) && runtime_available("tavily-backend", descriptors) {
        return RuntimeRouteRecommendation {
            runtime_id: "tavily-backend".into(),
            operator_type: "web_intelligence".into(),
            preferred_substrate: Some("search-extract".into()),
            rationale: "This looks like search-heavy research work, so Tavily is a strong configured web-intelligence backend for Blade to lean on.".into(),
            confidence: 0.82,
            prefers_warm_runtime: false,
        };
    }

    if browser_keywords(&normalized) || desktop_keywords(&normalized) {
        if browser_keywords(&normalized)
            && browser_agent_keywords(&normalized)
            && runtime_available("browser-use", descriptors)
        {
            return RuntimeRouteRecommendation {
                runtime_id: "browser-use".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("browser-agent".into()),
                rationale: "This looks like structured website navigation or form/extraction work, so browser-use is a strong open-source browser agent lane.".into(),
                confidence: 0.83,
                prefers_warm_runtime: false,
            };
        }
        let substrate = if browser_keywords(&normalized) {
            Some("browser-native".to_string())
        } else {
            Some("windows-native".to_string())
        };
        return RuntimeRouteRecommendation {
            runtime_id: "blade-native".into(),
            operator_type: "desktop_operator".into(),
            preferred_substrate: substrate.clone(),
            rationale: if substrate.as_deref() == Some("browser-native") {
                "This looks browser-heavy, so Blade should own the task with its browser-native and desktop control substrates.".into()
            } else {
                "This looks like native desktop/computer-use work, so Blade should own it with desktop control.".into()
            },
            confidence: 0.88,
            prefers_warm_runtime: false,
        };
    }

    if coding_keywords(&normalized) {
        if runtime_available("opencode-cli", descriptors)
            && runtime_is_warm("opencode-cli", descriptors)
        {
            return RuntimeRouteRecommendation {
                runtime_id: "opencode-cli".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/code-agent".into()),
                rationale: "This looks like coding work, and Blade already has a warm OpenCode backend running, so reusing it is the fastest path.".into(),
                confidence: 0.92,
                prefers_warm_runtime: true,
            };
        }
        if runtime_available("aider-cli", descriptors) {
            return RuntimeRouteRecommendation {
                runtime_id: "aider-cli".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/git".into()),
                rationale: "This looks like repo/code work, and aider is available locally as an open-source terminal coding runtime.".into(),
                confidence: 0.82,
                prefers_warm_runtime: false,
            };
        }
        if runtime_available("openhands-cli", descriptors) {
            return RuntimeRouteRecommendation {
                runtime_id: "openhands-cli".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/code-agent".into()),
                rationale: "This looks like repo/code work, and OpenHands CLI is available locally as another open-source engineering runtime.".into(),
                confidence: 0.79,
                prefers_warm_runtime: false,
            };
        }
        if runtime_available("opencode-cli", descriptors) {
            return RuntimeRouteRecommendation {
                runtime_id: "opencode-cli".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/code-agent".into()),
                rationale: "This looks like repo/code work, and OpenCode is available as another open-source coding runtime.".into(),
                confidence: 0.77,
                prefers_warm_runtime: false,
            };
        }
        if runtime_available("claude-code", descriptors) {
            return RuntimeRouteRecommendation {
                runtime_id: "claude-code".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/mcp".into()),
                rationale: "This looks like repo/code work, and Claude Code is available locally with resumable sessions and coding tools.".into(),
                confidence: 0.84,
                prefers_warm_runtime: false,
            };
        }
        if runtime_available("codex-cli", descriptors) {
            return RuntimeRouteRecommendation {
                runtime_id: "codex-cli".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/file".into()),
                rationale: "This looks like repo/code work, and Codex CLI is available locally for coding and review tasks.".into(),
                confidence: 0.8,
                prefers_warm_runtime: false,
            };
        }
        if runtime_available("claude-agent-sdk", descriptors) {
            return RuntimeRouteRecommendation {
                runtime_id: "claude-agent-sdk".into(),
                operator_type: "delegated_operator".into(),
                preferred_substrate: Some("shell/mcp".into()),
                rationale: "This looks like code work, so Blade should hand it to the strongest installed delegated coding runtime.".into(),
                confidence: 0.76,
                prefers_warm_runtime: false,
            };
        }
    }

    if research_keywords(&normalized) && runtime_available("claude-agent-sdk", descriptors) {
        return RuntimeRouteRecommendation {
            runtime_id: "claude-agent-sdk".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/mcp".into()),
            rationale: "This looks like research or document work, so Claude Agent SDK is a strong delegated runtime for long-form reasoning and tool use.".into(),
            confidence: 0.77,
            prefers_warm_runtime: false,
        };
    }

    if (desktop_keywords(&normalized) || normalized.contains("computer"))
        && runtime_available("open-interpreter", descriptors)
    {
        return RuntimeRouteRecommendation {
            runtime_id: "open-interpreter".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/computer".into()),
            rationale: "Open Interpreter is available locally and can act as an open-source computer runtime for machine-control tasks.".into(),
            confidence: 0.71,
            prefers_warm_runtime: false,
        };
    }

    RuntimeRouteRecommendation {
        runtime_id: "blade-native".into(),
        operator_type: "general_operator".into(),
        preferred_substrate: None,
        rationale: "Blade-native is the best fallback because it can observe local context, route later, and stay in the loop when other runtimes are missing.".into(),
        confidence: 0.62,
        prefers_warm_runtime: false,
    }
}

fn mission_stage(
    id: &str,
    title: &str,
    goal: String,
    depends_on: Vec<String>,
    descriptors: &[RuntimeDescriptor],
) -> MissionStage {
    MissionStage {
        id: id.to_string(),
        title: title.to_string(),
        runtime: recommend_route_from_goal(&goal, descriptors, None),
        goal,
        depends_on,
    }
}

fn fixed_runtime_stage(
    id: &str,
    title: &str,
    goal: String,
    depends_on: Vec<String>,
    runtime: RuntimeRouteRecommendation,
) -> MissionStage {
    MissionStage {
        id: id.to_string(),
        title: title.to_string(),
        runtime,
        goal,
        depends_on,
    }
}

fn preferred_synthesis_runtime(descriptors: &[RuntimeDescriptor]) -> RuntimeRouteRecommendation {
    if runtime_available("claude-agent-sdk", descriptors) {
        RuntimeRouteRecommendation {
            runtime_id: "claude-agent-sdk".into(),
            operator_type: "delegated_operator".into(),
            preferred_substrate: Some("shell/mcp".into()),
            rationale: "Claude Agent SDK is the strongest installed synthesis lane for research-heavy deliverables.".into(),
            confidence: 0.86,
            prefers_warm_runtime: false,
        }
    } else {
        RuntimeRouteRecommendation {
            runtime_id: "blade-native".into(),
            operator_type: "general_operator".into(),
            preferred_substrate: None,
            rationale: "Blade-native will synthesize the collected material because no stronger delegated research synthesizer is available.".into(),
            confidence: 0.7,
            prefers_warm_runtime: false,
        }
    }
}

fn design_operator_mission_internal(
    goal: &str,
    descriptors: &[RuntimeDescriptor],
    verified_engagement: Option<&SecurityEngagement>,
) -> OperatorMission {
    let mission_id = uuid::Uuid::new_v4().to_string();
    let normalized = goal.to_lowercase();
    let mut stages = Vec::new();

    if security_keywords(&normalized) {
        if verified_engagement.is_none() {
            stages.push(MissionStage {
                id: "stage-1".into(),
                title: "Create and verify engagement".into(),
                goal: format!(
                    "Before touching the target, create a scoped security engagement, verify ownership of the asset, and capture explicit proof.\n\nGoal:\n{goal}"
                ),
                depends_on: Vec::new(),
                runtime: RuntimeRouteRecommendation {
                    runtime_id: "blade-native".into(),
                    operator_type: "governed_security_operator".into(),
                    preferred_substrate: None,
                    rationale: "Blade must establish scope and ownership proof before performing any security work.".into(),
                    confidence: 0.99,
                    prefers_warm_runtime: false,
                },
            });
            stages.push(MissionStage {
                id: "stage-2".into(),
                title: "Plan the scoped assessment".into(),
                goal: format!(
                    "Read the verified scope, identify allowed techniques, and produce a safe scoped security plan.\n\nGoal:\n{goal}"
                ),
                depends_on: vec!["stage-1".into()],
                runtime: RuntimeRouteRecommendation {
                    runtime_id: "blade-native".into(),
                    operator_type: "governed_security_operator".into(),
                    preferred_substrate: None,
                    rationale: "Blade should plan security work only after ownership and scope are verified.".into(),
                    confidence: 0.92,
                    prefers_warm_runtime: false,
                },
            });
        } else {
            stages.push(mission_stage(
                "stage-1",
                "Plan the scoped assessment",
                format!("Read the verified engagement, enumerate the approved scope, and plan the safest next security steps.\n\nGoal:\n{goal}"),
                Vec::new(),
                descriptors,
            ));
            stages.push(mission_stage(
                "stage-2",
                "Execute scoped security work",
                format!("Carry out the approved security assessment only within the verified engagement scope.\n\nGoal:\n{goal}"),
                vec!["stage-1".into()],
                descriptors,
            ));
            stages.push(mission_stage(
                "stage-3",
                "Document findings and evidence",
                format!("Summarize evidence, findings, impact, and remediation for the verified engagement.\n\nGoal:\n{goal}"),
                vec!["stage-2".into()],
                descriptors,
            ));
        }
    } else if browser_keywords(&normalized) && coding_keywords(&normalized) {
        stages.push(mission_stage(
            "stage-1",
            "Prepare assets and instructions",
            format!("Analyze this goal and prepare the content, code, or assets needed before the browser workflow begins.\n\nGoal:\n{goal}"),
            Vec::new(),
            descriptors,
        ));
        stages.push(mission_stage(
            "stage-2",
            "Execute the browser workflow",
            format!("Carry out the browser/web part of this mission and use the prepared assets or instructions from stage 1.\n\nGoal:\n{goal}"),
            vec!["stage-1".into()],
            descriptors,
        ));
        stages.push(mission_stage(
            "stage-3",
            "Verify and report back",
            format!("Verify the result of the mission, summarize what happened, and produce a clean handoff/report.\n\nGoal:\n{goal}"),
            vec!["stage-2".into()],
            descriptors,
        ));
    } else if browser_keywords(&normalized) || desktop_keywords(&normalized) {
        stages.push(mission_stage(
            "stage-1",
            "Prepare the operator plan",
            format!("Read the mission and decide the safest, clearest next actions before touching the machine.\n\nGoal:\n{goal}"),
            Vec::new(),
            descriptors,
        ));
        stages.push(mission_stage(
            "stage-2",
            "Operate the machine",
            format!("Execute the machine/browser workflow for this mission.\n\nGoal:\n{goal}"),
            vec!["stage-1".into()],
            descriptors,
        ));
    } else if coding_keywords(&normalized) {
        stages.push(mission_stage(
            "stage-1",
            "Inspect and plan code work",
            format!("Inspect the repo and form a plan for this coding mission.\n\nGoal:\n{goal}"),
            Vec::new(),
            descriptors,
        ));
        stages.push(mission_stage(
            "stage-2",
            "Implement changes",
            format!("Execute the coding work and make the required changes.\n\nGoal:\n{goal}"),
            vec!["stage-1".into()],
            descriptors,
        ));
        stages.push(mission_stage(
            "stage-3",
            "Verify and summarize",
            format!(
                "Run checks, verify results, and summarize the implementation.\n\nGoal:\n{goal}"
            ),
            vec!["stage-2".into()],
            descriptors,
        ));
    } else if research_keywords(&normalized) {
        let tavily_ready = runtime_available("tavily-backend", descriptors);
        let firecrawl_ready = runtime_available("firecrawl-backend", descriptors);
        if tavily_ready && firecrawl_ready {
            stages.push(fixed_runtime_stage(
                "stage-1",
                "Search the landscape",
                format!("Use Tavily to search the topic, identify the strongest sources, and capture the key threads worth pursuing.\n\nGoal:\n{goal}"),
                Vec::new(),
                RuntimeRouteRecommendation {
                    runtime_id: "tavily-backend".into(),
                    operator_type: "web_intelligence".into(),
                    preferred_substrate: Some("search-extract".into()),
                    rationale: "Tavily is the best configured search substrate for the first-pass landscape scan.".into(),
                    confidence: 0.9,
                    prefers_warm_runtime: false,
                },
            ));
            stages.push(fixed_runtime_stage(
                "stage-2",
                "Crawl and extract source depth",
                format!("Use Firecrawl to deepen the research, extract the most relevant source content, and pull structured detail from the strongest pages found in stage 1.\n\nGoal:\n{goal}"),
                vec!["stage-1".into()],
                RuntimeRouteRecommendation {
                    runtime_id: "firecrawl-backend".into(),
                    operator_type: "web_intelligence".into(),
                    preferred_substrate: Some("crawl-extract".into()),
                    rationale: "Firecrawl is the strongest configured crawl/extract substrate for deeper source collection.".into(),
                    confidence: 0.89,
                    prefers_warm_runtime: false,
                },
            ));
            stages.push(fixed_runtime_stage(
                "stage-3",
                "Synthesize the deliverable",
                format!("Synthesize the Tavily and Firecrawl findings into a strong final deliverable, including the most important takeaways, supporting evidence, and any remaining uncertainty.\n\nGoal:\n{goal}"),
                vec!["stage-2".into()],
                preferred_synthesis_runtime(descriptors),
            ));
        } else if tavily_ready {
            stages.push(fixed_runtime_stage(
                "stage-1",
                "Search and gather context",
                format!("Use Tavily to research the topic and gather the most useful source material.\n\nGoal:\n{goal}"),
                Vec::new(),
                RuntimeRouteRecommendation {
                    runtime_id: "tavily-backend".into(),
                    operator_type: "web_intelligence".into(),
                    preferred_substrate: Some("search-extract".into()),
                    rationale: "Tavily is available and is the best configured research search substrate.".into(),
                    confidence: 0.87,
                    prefers_warm_runtime: false,
                },
            ));
            stages.push(fixed_runtime_stage(
                "stage-2",
                "Synthesize output",
                format!("Turn the gathered context into a useful deliverable.\n\nGoal:\n{goal}"),
                vec!["stage-1".into()],
                preferred_synthesis_runtime(descriptors),
            ));
        } else if firecrawl_ready {
            stages.push(fixed_runtime_stage(
                "stage-1",
                "Crawl and extract context",
                format!("Use Firecrawl to gather and extract the most useful source material for this topic.\n\nGoal:\n{goal}"),
                Vec::new(),
                RuntimeRouteRecommendation {
                    runtime_id: "firecrawl-backend".into(),
                    operator_type: "web_intelligence".into(),
                    preferred_substrate: Some("crawl-extract".into()),
                    rationale: "Firecrawl is available and is the strongest configured crawl/extract substrate.".into(),
                    confidence: 0.85,
                    prefers_warm_runtime: false,
                },
            ));
            stages.push(fixed_runtime_stage(
                "stage-2",
                "Synthesize output",
                format!("Turn the gathered context into a useful deliverable.\n\nGoal:\n{goal}"),
                vec!["stage-1".into()],
                preferred_synthesis_runtime(descriptors),
            ));
        } else {
            stages.push(mission_stage(
                "stage-1",
                "Gather context",
                format!("Research the topic and gather the most useful source material.\n\nGoal:\n{goal}"),
                Vec::new(),
                descriptors,
            ));
            stages.push(mission_stage(
                "stage-2",
                "Synthesize output",
                format!("Turn the gathered context into a useful deliverable.\n\nGoal:\n{goal}"),
                vec!["stage-1".into()],
                descriptors,
            ));
        }
    } else {
        stages.push(mission_stage(
            "stage-1",
            "Primary execution",
            goal.to_string(),
            Vec::new(),
            descriptors,
        ));
    }

    OperatorMission {
        id: mission_id,
        goal: goal.to_string(),
        summary: if stages.len() > 1 {
            format!("Blade decomposed this mission into {} stages so different runtimes can own the parts they are best at.", stages.len())
        } else {
            "Blade recommends a single-stage execution path for this mission.".into()
        },
        stages,
    }
}

#[tauri::command]
pub async fn route_operator_task(
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    db_state: tauri::State<'_, SharedDb>,
    goal: String,
) -> Result<RuntimeRouteRecommendation, String> {
    let counts = active_task_counts(registry.inner()).await;
    let server_urls = active_server_urls(servers.inner()).await;
    let descriptors = build_runtime_descriptors(
        &counts,
        &server_urls,
        tavily_available_with_db(db_state.inner()),
        firecrawl_available_with_db(db_state.inner()),
    );
    let engagement_snapshot = engagements.lock().await.clone();
    let verified = active_verified_engagement(&engagement_snapshot);
    Ok(recommend_route_from_goal(
        &goal,
        &descriptors,
        verified.as_ref(),
    ))
}

#[tauri::command]
pub async fn design_operator_mission(
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    db_state: tauri::State<'_, SharedDb>,
    goal: String,
) -> Result<OperatorMission, String> {
    let counts = active_task_counts(registry.inner()).await;
    let server_urls = active_server_urls(servers.inner()).await;
    let descriptors = build_runtime_descriptors(
        &counts,
        &server_urls,
        tavily_available_with_db(db_state.inner()),
        firecrawl_available_with_db(db_state.inner()),
    );
    let engagement_snapshot = engagements.lock().await.clone();
    let verified = active_verified_engagement(&engagement_snapshot);
    Ok(design_operator_mission_internal(
        &goal,
        &descriptors,
        verified.as_ref(),
    ))
}

#[tauri::command]
pub async fn runtime_save_mission(
    missions: tauri::State<'_, SharedMissionRegistry>,
    mission: OperatorMission,
    auto_run: Option<bool>,
) -> Result<StoredMission, String> {
    let record = StoredMission {
        mission: mission.clone(),
        status: "planned".into(),
        last_run_at: Some(timestamp_ms()),
        next_stage_id: mission.stages.first().map(|stage| stage.id.clone()),
        auto_run: auto_run.unwrap_or(false),
    };
    missions
        .lock()
        .await
        .insert(mission.id.clone(), record.clone());
    Ok(record)
}

#[tauri::command]
pub async fn runtime_list_missions(
    missions: tauri::State<'_, SharedMissionRegistry>,
) -> Result<Vec<StoredMission>, String> {
    let mut items = missions.lock().await.values().cloned().collect::<Vec<_>>();
    items.sort_by(|a, b| b.last_run_at.unwrap_or(0).cmp(&a.last_run_at.unwrap_or(0)));
    Ok(items)
}

#[tauri::command]
pub async fn runtime_save_company_object(
    objects: tauri::State<'_, SharedCompanyObjectRegistry>,
    kind: String,
    title: String,
    summary: String,
    status: Option<String>,
    owner: Option<String>,
    linked_mission_id: Option<String>,
) -> Result<CompanyObject, String> {
    let trimmed_kind = kind.trim().to_lowercase();
    let allowed = ["goal", "project", "kpi", "decision", "sop"];
    if !allowed.contains(&trimmed_kind.as_str()) {
        return Err(format!("Unsupported company object kind `{kind}`."));
    }
    let now = timestamp_ms();
    let object = CompanyObject {
        id: uuid::Uuid::new_v4().to_string(),
        kind: trimmed_kind,
        title: title.trim().to_string(),
        summary: summary.trim().to_string(),
        status: status.unwrap_or_else(|| "active".into()),
        owner,
        linked_mission_id,
        created_at: now,
        updated_at: now,
    };
    objects
        .lock()
        .await
        .insert(object.id.clone(), object.clone());
    Ok(object)
}

#[tauri::command]
pub async fn runtime_list_company_objects(
    objects: tauri::State<'_, SharedCompanyObjectRegistry>,
) -> Result<Vec<CompanyObject>, String> {
    let mut items = objects.lock().await.values().cloned().collect::<Vec<_>>();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
pub fn runtime_list_capability_blueprints() -> Result<Vec<CapabilityBlueprint>, String> {
    Ok(capability_blueprints())
}

#[tauri::command]
pub async fn security_create_engagement(
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    title: String,
    owner_name: String,
    contact: String,
    scope: String,
    asset_kind: String,
    verification_method: String,
) -> Result<SecurityEngagement, String> {
    let trimmed_method = verification_method.trim().to_lowercase();
    let allowed_methods = ["dns_txt", "repo_file", "host_file", "manual_attestation"];
    if !allowed_methods.contains(&trimmed_method.as_str()) {
        return Err(format!(
            "Unsupported verification method `{verification_method}`."
        ));
    }
    let now = timestamp_ms();
    let token = format!("blade-proof-{}", uuid::Uuid::new_v4().simple());
    let engagement = SecurityEngagement {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.trim().to_string(),
        owner_name: owner_name.trim().to_string(),
        contact: contact.trim().to_string(),
        scope: scope.trim().to_string(),
        asset_kind: asset_kind.trim().to_string(),
        verification_method: trimmed_method.clone(),
        challenge_token: token.clone(),
        proof_instructions: proof_instructions(&trimmed_method, &token),
        proof_value: None,
        status: "awaiting_verification".into(),
        verified_at: None,
        created_at: now,
        updated_at: now,
    };
    engagements
        .lock()
        .await
        .insert(engagement.id.clone(), engagement.clone());
    Ok(engagement)
}

#[tauri::command]
pub async fn security_list_engagements(
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
) -> Result<Vec<SecurityEngagement>, String> {
    let mut items = engagements
        .lock()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
pub async fn security_mark_engagement_verified(
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    engagement_id: String,
    proof_value: String,
) -> Result<SecurityEngagement, String> {
    let mut guard = engagements.lock().await;
    let engagement = guard
        .get_mut(&engagement_id)
        .ok_or_else(|| "Security engagement not found.".to_string())?;
    engagement.proof_value = Some(proof_value.trim().to_string());
    engagement.status = "verified".into();
    engagement.verified_at = Some(timestamp_ms());
    engagement.updated_at = timestamp_ms();
    Ok(engagement.clone())
}

#[tauri::command]
pub async fn runtime_plan_next_mission_stage(
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
    mission: OperatorMission,
) -> Result<Option<PlannedMissionStage>, String> {
    let snapshot = tasks.lock().await.clone();
    Ok(plan_next_mission_stage_from_snapshot(&snapshot, &mission))
}

fn plan_next_mission_stage_from_snapshot(
    snapshot: &HashMap<String, TaskGraph>,
    mission: &OperatorMission,
) -> Option<PlannedMissionStage> {
    let mission_tasks = snapshot
        .values()
        .filter(|task| task.mission_id.as_deref() == Some(mission.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    let task_for_stage = |stage_id: &str| {
        mission_tasks
            .iter()
            .filter(|task| task.stage_id.as_deref() == Some(stage_id))
            .max_by_key(|task| latest_task_timestamp(task))
            .cloned()
    };

    for stage in &mission.stages {
        if task_for_stage(&stage.id).is_some() {
            continue;
        }

        let dependency_tasks = stage
            .depends_on
            .iter()
            .filter_map(|dependency_id| task_for_stage(dependency_id))
            .collect::<Vec<_>>();

        if dependency_tasks.len() != stage.depends_on.len() {
            continue;
        }

        if dependency_tasks
            .iter()
            .any(|task| task.status != "completed")
        {
            continue;
        }

        let handoff_note = if dependency_tasks.is_empty() {
            None
        } else {
            Some(
                dependency_tasks
                    .iter()
                    .map(build_handoff_note_from_task)
                    .filter(|note| !note.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n\n---\n\n"),
            )
            .filter(|value| !value.trim().is_empty())
        };

        let parent_task_id = dependency_tasks.last().map(|task| task.id.clone());
        let resume_session_id = lineage_session_for_runtime(
            snapshot,
            parent_task_id.as_deref(),
            &stage.runtime.runtime_id,
        )
        .map(|session| session.session_id);

        return Some(PlannedMissionStage {
            stage: stage.clone(),
            parent_task_id,
            handoff_note,
            resume_session_id,
        });
    }

    None
}

fn emit_runtime_state(
    app: &tauri::AppHandle,
    task_id: &str,
    runtime_id: &str,
    status: &str,
    session_id: Option<&str>,
    error: Option<&str>,
) {
    let _ = app.emit(
        "runtime_state_changed",
        serde_json::json!({
            "taskId": task_id,
            "runtimeId": runtime_id,
            "status": status,
            "sessionId": session_id,
            "error": error,
            "timestamp": timestamp_ms(),
        }),
    );
}

fn emit_runtime_message(
    app: &tauri::AppHandle,
    task_id: &str,
    runtime_id: &str,
    session_id: Option<&str>,
    message_type: &str,
    role: &str,
    content: String,
    metadata: Value,
) {
    let _ = app.emit(
        "runtime_message",
        serde_json::json!({
            "taskId": task_id,
            "runtimeId": runtime_id,
            "sessionId": session_id,
            "type": message_type,
            "role": role,
            "content": content,
            "timestamp": timestamp_ms(),
            "metadata": metadata,
        }),
    );
}

fn emit_task_checkpoint(
    app: &tauri::AppHandle,
    task_id: &str,
    runtime_id: &str,
    title: &str,
    detail: &str,
    status: &str,
) {
    let _ = app.emit(
        "task_checkpoint",
        serde_json::json!({
            "taskId": task_id,
            "runtimeId": runtime_id,
            "checkpoint": {
                "id": format!("{}-{}", task_id, uuid::Uuid::new_v4()),
                "title": title,
                "detail": detail,
                "status": status,
                "timestamp": timestamp_ms(),
            }
        }),
    );
}

fn emit_task_done(
    app: &tauri::AppHandle,
    task_id: &str,
    runtime_id: &str,
    status: &str,
    session_id: Option<&str>,
    summary: Option<&str>,
    error: Option<&str>,
) {
    let _ = app.emit(
        "task_done",
        serde_json::json!({
            "taskId": task_id,
            "runtimeId": runtime_id,
            "status": status,
            "sessionId": session_id,
            "summary": summary,
            "error": error,
            "timestamp": timestamp_ms(),
        }),
    );
}

fn extract_text_from_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    for key in [
        "content", "text", "message", "result", "summary", "stderr", "stdout", "error",
    ] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    if let Some(message) = value.get("message") {
        if let Some(text) = message.get("content").and_then(Value::as_str) {
            return Some(text.to_string());
        }
        if let Some(text) = message.get("text").and_then(Value::as_str) {
            return Some(text.to_string());
        }
        if let Some(array) = message.get("content").and_then(Value::as_array) {
            let joined = array
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n\n");
            if !joined.trim().is_empty() {
                return Some(joined);
            }
        }
    }
    if let Some(output) = value.get("output").and_then(Value::as_array) {
        let joined = output
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("\n");
        if !joined.trim().is_empty() {
            return Some(joined);
        }
    }
    None
}

fn extract_session_id(value: &Value) -> Option<String> {
    for key in ["sessionId", "session_id"] {
        if let Some(session_id) = value.get(key).and_then(Value::as_str) {
            if !session_id.trim().is_empty() {
                return Some(session_id.to_string());
            }
        }
    }
    if let Some(metadata) = value.get("metadata") {
        for key in ["sessionId", "session_id"] {
            if let Some(session_id) = metadata.get(key).and_then(Value::as_str) {
                if !session_id.trim().is_empty() {
                    return Some(session_id.to_string());
                }
            }
        }
    }
    None
}

async fn parse_runtime_stdout_line(
    app: &tauri::AppHandle,
    tasks: &SharedTaskGraphRegistry,
    task_id: &str,
    runtime_id: &str,
    parser_kind: RuntimeParserKind,
    line: &str,
    shared_session_id: &Arc<Mutex<Option<String>>>,
) {
    match parser_kind {
        RuntimeParserKind::ClaudeAgentSdk => {
            let Ok(envelope) = serde_json::from_str::<RunnerEnvelope>(line) else {
                emit_runtime_message(
                    app,
                    task_id,
                    runtime_id,
                    None,
                    "error",
                    "system",
                    format!("Blade could not parse Claude Agent SDK output: {line}"),
                    serde_json::json!({ "subtype": "parse_error" }),
                );
                return;
            };

            if let Some(session_id) = extract_session_id(&envelope.payload) {
                *shared_session_id.lock().await = Some(session_id.clone());
                update_task_graph_state(tasks, task_id, None, Some(&session_id)).await;
            }

            match envelope.event_type.as_str() {
                "message" => {
                    let message_type = envelope
                        .payload
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("message");
                    let role = match message_type {
                        "assistant" | "result" => "assistant",
                        "error" => "system",
                        "tool_use" | "tool_result" => "tool",
                        _ => "system",
                    };
                    let content = envelope
                        .payload
                        .get("content")
                        .and_then(Value::as_str)
                        .unwrap_or("Managed agent event")
                        .to_string();
                    emit_runtime_message(
                        app,
                        task_id,
                        runtime_id,
                        shared_session_id.lock().await.as_deref(),
                        message_type,
                        role,
                        content.clone(),
                        envelope
                            .payload
                            .get("metadata")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({})),
                    );
                    if message_type == "tool_use" {
                        append_task_checkpoint(
                            tasks,
                            task_id,
                            "Claude tool use",
                            &content,
                            "running",
                        )
                        .await;
                        emit_task_checkpoint(
                            app,
                            task_id,
                            runtime_id,
                            "Claude tool use",
                            &content,
                            "running",
                        );
                    }
                }
                "done" => {
                    let is_error = envelope
                        .payload
                        .get("isError")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let session_id = extract_session_id(&envelope.payload);
                    if let Some(session_id) = session_id.as_ref() {
                        *shared_session_id.lock().await = Some(session_id.clone());
                    }
                    emit_runtime_state(
                        app,
                        task_id,
                        runtime_id,
                        if is_error { "error" } else { "completed" },
                        session_id.as_deref(),
                        None,
                    );
                    update_task_graph_state(
                        tasks,
                        task_id,
                        Some(if is_error { "error" } else { "completed" }),
                        session_id.as_deref(),
                    )
                    .await;
                    emit_task_done(
                        app,
                        task_id,
                        runtime_id,
                        if is_error { "error" } else { "completed" },
                        session_id.as_deref(),
                        None,
                        None,
                    );
                }
                "error" => {
                    let message = envelope
                        .payload
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Claude Agent SDK runtime failed.");
                    emit_runtime_message(
                        app,
                        task_id,
                        runtime_id,
                        shared_session_id.lock().await.as_deref(),
                        "error",
                        "system",
                        message.to_string(),
                        serde_json::json!({ "subtype": "runner_error" }),
                    );
                }
                _ => {}
            }
        }
        RuntimeParserKind::ClaudeCode | RuntimeParserKind::CodexCli => {
            let parsed = serde_json::from_str::<Value>(line).ok();
            let metadata = parsed
                .clone()
                .unwrap_or_else(|| serde_json::json!({ "raw": line }));
            if let Some(value) = parsed.as_ref() {
                if let Some(session_id) = extract_session_id(value) {
                    *shared_session_id.lock().await = Some(session_id);
                    update_task_graph_state(
                        tasks,
                        task_id,
                        None,
                        shared_session_id.lock().await.as_deref(),
                    )
                    .await;
                }
            }
            let content = parsed
                .as_ref()
                .and_then(extract_text_from_value)
                .unwrap_or_else(|| line.to_string());
            let message_type = parsed
                .as_ref()
                .and_then(|value| value.get("type").and_then(Value::as_str))
                .unwrap_or("message");
            let role = if message_type.contains("error") {
                "system"
            } else if message_type.contains("tool") {
                "tool"
            } else {
                "assistant"
            };
            emit_runtime_message(
                app,
                task_id,
                runtime_id,
                shared_session_id.lock().await.as_deref(),
                message_type,
                role,
                content.clone(),
                metadata,
            );
            if role == "tool" {
                append_task_checkpoint(tasks, task_id, "Tool activity", &content, "running").await;
                emit_task_checkpoint(
                    app,
                    task_id,
                    runtime_id,
                    "Tool activity",
                    &content,
                    "running",
                );
            }
        }
        RuntimeParserKind::PlainText => {
            emit_runtime_message(
                app,
                task_id,
                runtime_id,
                shared_session_id.lock().await.as_deref(),
                "message",
                "assistant",
                line.to_string(),
                serde_json::json!({}),
            );
        }
    }
}

async fn spawn_runtime_process(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    runtime_id: String,
    mut child: Child,
    parser_kind: RuntimeParserKind,
    session_id: Option<String>,
) -> Result<(), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Blade could not read stdout for runtime `{runtime_id}`."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Blade could not read stderr for runtime `{runtime_id}`."))?;
    let child = Arc::new(Mutex::new(child));
    registry.lock().await.insert(
        task_id.clone(),
        RuntimeTaskHandle {
            runtime_id: runtime_id.clone(),
            child: child.clone(),
        },
    );

    let shared_session_id = Arc::new(Mutex::new(session_id));

    let app_stdout = app.clone();
    let task_id_stdout = task_id.clone();
    let runtime_id_stdout = runtime_id.clone();
    let tasks_stdout = tasks.clone();
    let session_stdout = shared_session_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            parse_runtime_stdout_line(
                &app_stdout,
                &tasks_stdout,
                &task_id_stdout,
                &runtime_id_stdout,
                parser_kind,
                &line,
                &session_stdout,
            )
            .await;
        }
    });

    let app_stderr = app.clone();
    let task_id_stderr = task_id.clone();
    let runtime_id_stderr = runtime_id.clone();
    let session_stderr = shared_session_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            emit_runtime_message(
                &app_stderr,
                &task_id_stderr,
                &runtime_id_stderr,
                session_stderr.lock().await.as_deref(),
                "system",
                "system",
                line,
                serde_json::json!({ "subtype": "stderr" }),
            );
        }
    });

    let app_wait = app.clone();
    let task_id_wait = task_id.clone();
    let runtime_id_wait = runtime_id.clone();
    let registry_wait = registry.clone();
    let tasks_wait = tasks.clone();
    let session_wait = shared_session_id.clone();
    tokio::spawn(async move {
        let status = {
            let mut guard = child.lock().await;
            guard.wait().await
        };
        registry_wait.lock().await.remove(&task_id_wait);
        match status {
            Ok(code) if code.success() => {
                if !matches!(parser_kind, RuntimeParserKind::ClaudeAgentSdk) {
                    let session = session_wait.lock().await.clone();
                    update_task_graph_state(
                        &tasks_wait,
                        &task_id_wait,
                        Some("completed"),
                        session.as_deref(),
                    )
                    .await;
                    emit_runtime_state(
                        &app_wait,
                        &task_id_wait,
                        &runtime_id_wait,
                        "completed",
                        session.as_deref(),
                        None,
                    );
                    emit_task_done(
                        &app_wait,
                        &task_id_wait,
                        &runtime_id_wait,
                        "completed",
                        session.as_deref(),
                        None,
                        None,
                    );
                }
            }
            Ok(code) => {
                let session = session_wait.lock().await.clone();
                let message = format!("Runtime exited with code {}.", code.code().unwrap_or(-1));
                update_task_graph_state(
                    &tasks_wait,
                    &task_id_wait,
                    Some("error"),
                    session.as_deref(),
                )
                .await;
                append_task_summary_artifact(&tasks_wait, &task_id_wait, &message).await;
                emit_runtime_state(
                    &app_wait,
                    &task_id_wait,
                    &runtime_id_wait,
                    "error",
                    session.as_deref(),
                    Some(&message),
                );
                emit_task_done(
                    &app_wait,
                    &task_id_wait,
                    &runtime_id_wait,
                    "error",
                    session.as_deref(),
                    None,
                    Some(&message),
                );
            }
            Err(error) => {
                let session = session_wait.lock().await.clone();
                let message = format!("Blade lost the runtime process: {error}");
                update_task_graph_state(
                    &tasks_wait,
                    &task_id_wait,
                    Some("error"),
                    session.as_deref(),
                )
                .await;
                append_task_summary_artifact(&tasks_wait, &task_id_wait, &message).await;
                emit_runtime_state(
                    &app_wait,
                    &task_id_wait,
                    &runtime_id_wait,
                    "error",
                    session.as_deref(),
                    Some(&message),
                );
                emit_task_done(
                    &app_wait,
                    &task_id_wait,
                    &runtime_id_wait,
                    "error",
                    session.as_deref(),
                    None,
                    Some(&message),
                );
            }
        }
    });

    Ok(())
}

async fn ensure_opencode_server(servers: SharedRuntimeServerRegistry) -> Result<String, String> {
    if let Some(existing) = servers.lock().await.get("opencode-cli").cloned() {
        return Ok(existing.url);
    }

    let binary = opencode_binary_path().ok_or_else(|| {
        "Blade found OpenCode state, but could not resolve a runnable OpenCode binary.".to_string()
    })?;

    let mut child = Command::new(binary)
        .arg("serve")
        .arg("--hostname=127.0.0.1")
        .arg("--port=4096")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch OpenCode server: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Blade could not read OpenCode server stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Blade could not read OpenCode server stderr.".to_string())?;

    let child = Arc::new(Mutex::new(child));
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();
    let start_deadline = tokio::time::sleep(std::time::Duration::from_secs(6));
    tokio::pin!(start_deadline);

    let mut captured = String::new();
    let url = loop {
        tokio::select! {
            _ = &mut start_deadline => {
                return Err(format!("Timed out waiting for OpenCode server to start. Output: {captured}"));
            }
            line = stdout_lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        captured.push_str(&line);
                        captured.push('\n');
                        if line.starts_with("opencode server listening") {
                            if let Some(parsed) = line.split(" on ").nth(1) {
                                break parsed.trim().to_string();
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(error) => return Err(format!("Failed reading OpenCode server stdout: {error}")),
                }
            }
            line = stderr_lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        captured.push_str(&line);
                        captured.push('\n');
                    }
                    Ok(None) => {}
                    Err(error) => return Err(format!("Failed reading OpenCode server stderr: {error}")),
                }
            }
        }
    };

    let handle = RuntimeServerHandle {
        runtime_id: "opencode-cli".into(),
        url: url.clone(),
        child: child.clone(),
    };
    servers.lock().await.insert("opencode-cli".into(), handle);

    let server_registry = servers.clone();
    tokio::spawn(async move {
        {
            let mut guard = child.lock().await;
            let _ = guard.wait().await;
        }
        server_registry.lock().await.remove("opencode-cli");
    });

    Ok(url)
}

fn managed_runner_script_path() -> Result<PathBuf, String> {
    Ok(repo_root()?
        .join("scripts")
        .join("claude_managed_agent_runner.mjs"))
}

async fn start_claude_agent_sdk_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    session_id: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    permission_mode: Option<String>,
    max_turns: Option<u32>,
    tools: Option<Vec<String>>,
) -> Result<TaskGraph, String> {
    let script_path = managed_runner_script_path()?;
    if !script_path.exists() {
        return Err(format!(
            "Blade could not find the Claude managed agent runner at `{}`.",
            script_path.display()
        ));
    }

    let run_session_id = session_id.clone();
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let payload = serde_json::json!({
        "runId": task_id,
        "prompt": effective_goal,
        "tools": tools.unwrap_or_else(|| vec!["Read".into(), "Edit".into(), "Bash".into(), "Glob".into(), "Grep".into()]),
        "mcpServers": serde_json::Value::Null,
        "permissionMode": permission_mode.unwrap_or_else(|| "acceptEdits".into()),
        "maxTurns": max_turns.unwrap_or(30),
        "sessionId": run_session_id,
        "workingDirectory": cwd,
        "subagents": serde_json::Value::Null,
    });
    let payload_b64 = BASE64_STANDARD.encode(
        serde_json::to_vec(&payload)
            .map_err(|error| format!("Failed to encode Claude Agent SDK payload: {error}"))?,
    );

    let working_dir = payload
        .get("workingDirectory")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root().unwrap_or_else(|_| PathBuf::from(".")));

    emit_runtime_state(
        &app,
        &task_id,
        "claude-agent-sdk",
        "starting",
        session_id.as_deref(),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "claude-agent-sdk",
        "Launch Claude Agent SDK",
        "Blade started a managed Claude agent run through the local SDK.",
        "running",
    );

    let child = Command::new("node")
        .arg(&script_path)
        .arg(payload_b64)
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch Claude Agent SDK runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "claude-agent-sdk".into(),
        child,
        RuntimeParserKind::ClaudeAgentSdk,
        session_id.clone(),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "claude-agent-sdk",
        "running",
        session_id.as_deref(),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal,
        "delegated_operator".into(),
        Some("claude-agent-sdk".into()),
        Some("shell/mcp".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        session_id.map(|id| RuntimeSessionRef {
            runtime_id: "claude-agent-sdk".into(),
            session_id: id,
            cwd: payload
                .get("workingDirectory")
                .and_then(Value::as_str)
                .map(str::to_string),
            title: "Claude Agent SDK session".into(),
            resumable: true,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_claude_code_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    session_id: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    tools: Option<Vec<String>>,
) -> Result<TaskGraph, String> {
    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    emit_runtime_state(
        &app,
        &task_id,
        "claude-code",
        "starting",
        Some(&session_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "claude-code",
        "Launch Claude Code",
        "Blade started a local Claude Code task through the installed CLI.",
        "running",
    );

    let mut command = Command::new("claude");
    command
        .arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--permission-mode")
        .arg(permission_mode.unwrap_or_else(|| "acceptEdits".into()))
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(model) = model {
        if !model.trim().is_empty() {
            command.arg("--model").arg(model);
        }
    }
    if let Some(tools) = tools {
        if !tools.is_empty() {
            command.arg("--tools").arg(tools.join(","));
        }
    }
    if cwd.is_some() {
        command.arg("--add-dir").arg(&working_dir);
    }
    if session_id.is_empty() {
        command.arg(&effective_goal);
    } else {
        command
            .arg("--session-id")
            .arg(&session_id)
            .arg(&effective_goal);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to launch Claude Code runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "claude-code".into(),
        child,
        RuntimeParserKind::ClaudeCode,
        Some(session_id.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "claude-code",
        "running",
        Some(&session_id),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("claude-code".into()),
        Some("shell/mcp".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "claude-code".into(),
            session_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: true,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn resume_claude_code_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    session_id: String,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    tools: Option<Vec<String>>,
) -> Result<TaskGraph, String> {
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    emit_runtime_state(
        &app,
        &task_id,
        "claude-code",
        "starting",
        Some(&session_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "claude-code",
        "Resume Claude Code",
        "Blade resumed a local Claude Code session.",
        "running",
    );

    let mut command = Command::new("claude");
    command
        .arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--permission-mode")
        .arg(permission_mode.unwrap_or_else(|| "acceptEdits".into()))
        .arg("--resume")
        .arg(&session_id)
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(model) = model {
        if !model.trim().is_empty() {
            command.arg("--model").arg(model);
        }
    }
    if let Some(tools) = tools {
        if !tools.is_empty() {
            command.arg("--tools").arg(tools.join(","));
        }
    }
    if cwd.is_some() {
        command.arg("--add-dir").arg(&working_dir);
    }
    command.arg(&effective_goal);

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to resume Claude Code runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "claude-code".into(),
        child,
        RuntimeParserKind::ClaudeCode,
        Some(session_id.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "claude-code",
        "running",
        Some(&session_id),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("claude-code".into()),
        Some("shell/mcp".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "claude-code".into(),
            session_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: true,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_codex_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    session_id: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    model: Option<String>,
) -> Result<TaskGraph, String> {
    emit_runtime_state(
        &app,
        &task_id,
        "codex-cli",
        "starting",
        session_id.as_deref(),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "codex-cli",
        "Launch Codex CLI",
        "Blade started a local Codex CLI task.",
        "running",
    );
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let mut command = Command::new("codex");
    command.current_dir(&working_dir);

    if let Some(session_id) = session_id.as_ref() {
        command
            .arg("exec")
            .arg("resume")
            .arg(session_id)
            .arg(&effective_goal);
    } else {
        command.arg("exec").arg(&effective_goal);
    }

    command
        .arg("--json")
        .arg("--skip-git-repo-check")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(model) = model {
        if !model.trim().is_empty() {
            command.arg("--model").arg(model);
        }
    }
    if cwd.is_some() {
        command.arg("--cd").arg(&working_dir);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to launch Codex CLI runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "codex-cli".into(),
        child,
        RuntimeParserKind::CodexCli,
        session_id.clone(),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "codex-cli",
        "running",
        session_id.as_deref(),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("codex-cli".into()),
        Some("shell/file".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        session_id.map(|id| RuntimeSessionRef {
            runtime_id: "codex-cli".into(),
            session_id: id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: true,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_google_gemma_local_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    session_id: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
) -> Result<TaskGraph, String> {
    let model = session_id
        .filter(|value| !value.trim().is_empty())
        .or_else(preferred_gemma_model)
        .ok_or_else(|| {
            "Blade found no local Gemma model yet. Pull one with `ollama pull gemma4` first."
                .to_string()
        })?;
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    emit_runtime_state(
        &app,
        &task_id,
        "google-gemma-local",
        "starting",
        Some(&model),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "google-gemma-local",
        "Launch local Gemma",
        &format!("Blade started the local Google Gemma runtime with `{model}` through Ollama."),
        "running",
    );

    let child = Command::new("ollama")
        .arg("run")
        .arg(&model)
        .arg(&effective_goal)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch local Gemma runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "google-gemma-local".into(),
        child,
        RuntimeParserKind::PlainText,
        Some(model.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "google-gemma-local",
        "running",
        Some(&model),
        None,
    );
    Ok(build_task_graph(
        task_id,
        goal,
        "local_reasoning".into(),
        Some("google-gemma-local".into()),
        Some("local-ollama".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "google-gemma-local".into(),
            session_id: model.clone(),
            cwd: None,
            title: format!("Local Gemma {}", model),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_open_interpreter_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
) -> Result<TaskGraph, String> {
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    emit_runtime_state(
        &app,
        &task_id,
        "open-interpreter",
        "starting",
        Some(&task_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "open-interpreter",
        "Launch Open Interpreter",
        "Blade started an Open Interpreter task through the local CLI.",
        "running",
    );

    let child = Command::new("interpreter")
        .arg("-y")
        .arg(&effective_goal)
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch Open Interpreter runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "open-interpreter".into(),
        child,
        RuntimeParserKind::PlainText,
        Some(task_id.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "open-interpreter",
        "running",
        Some(&task_id),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("open-interpreter".into()),
        Some("shell/computer".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "open-interpreter".into(),
            session_id: task_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_aider_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    model: Option<String>,
) -> Result<TaskGraph, String> {
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    emit_runtime_state(
        &app,
        &task_id,
        "aider-cli",
        "starting",
        Some(&task_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "aider-cli",
        "Launch aider",
        "Blade started aider through the local CLI.",
        "running",
    );

    let mut command = Command::new("aider");
    command
        .arg("--message")
        .arg(&effective_goal)
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(model) = model {
        if !model.trim().is_empty() {
            command.arg("--model").arg(model);
        }
    }

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to launch aider runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "aider-cli".into(),
        child,
        RuntimeParserKind::PlainText,
        Some(task_id.clone()),
    )
    .await?;

    emit_runtime_state(&app, &task_id, "aider-cli", "running", Some(&task_id), None);
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("aider-cli".into()),
        Some("shell/git".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "aider-cli".into(),
            session_id: task_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_browser_use_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
) -> Result<TaskGraph, String> {
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    emit_runtime_state(
        &app,
        &task_id,
        "browser-use",
        "starting",
        Some(&task_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "browser-use",
        "Launch browser-use",
        "Blade started browser-use through the local CLI.",
        "running",
    );

    let child = Command::new("browser-use")
        .arg("run")
        .arg(&effective_goal)
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch browser-use runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "browser-use".into(),
        child,
        RuntimeParserKind::PlainText,
        Some(task_id.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "browser-use",
        "running",
        Some(&task_id),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("browser-use".into()),
        Some("browser-agent".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "browser-use".into(),
            session_id: task_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_openhands_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
) -> Result<TaskGraph, String> {
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    emit_runtime_state(
        &app,
        &task_id,
        "openhands-cli",
        "starting",
        Some(&task_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "openhands-cli",
        "Launch OpenHands",
        "Blade started an OpenHands CLI task.",
        "running",
    );

    let child = if command_in_path("openhands").is_some() {
        let mut command = Command::new("openhands");
        command
            .arg(&effective_goal)
            .current_dir(&working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        command
            .spawn()
            .map_err(|error| format!("Failed to launch OpenHands CLI runtime: {error}"))?
    } else {
        let mut command = Command::new("uvx");
        command
            .arg("--python")
            .arg("3.12")
            .arg("--from")
            .arg("openhands-ai")
            .arg("openhands")
            .arg(&effective_goal)
            .current_dir(&working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        command.spawn().map_err(|error| {
            format!("Failed to launch OpenHands CLI runtime through uvx: {error}")
        })?
    };

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "openhands-cli".into(),
        child,
        RuntimeParserKind::PlainText,
        Some(task_id.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "openhands-cli",
        "running",
        Some(&task_id),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("openhands-cli".into()),
        Some("shell/code-agent".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "openhands-cli".into(),
            session_id: task_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
        "running",
    ))
}

async fn start_opencode_runtime(
    app: tauri::AppHandle,
    registry: SharedRuntimeRegistry,
    tasks: SharedTaskGraphRegistry,
    servers: SharedRuntimeServerRegistry,
    task_id: String,
    goal: String,
    cwd: Option<String>,
    session_id: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    model: Option<String>,
) -> Result<TaskGraph, String> {
    let binary = opencode_binary_path().ok_or_else(|| {
        "Blade found OpenCode state, but could not resolve a runnable OpenCode binary.".to_string()
    })?;
    let server_url = ensure_opencode_server(servers).await?;
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    let working_dir = cwd.clone().unwrap_or_else(|| ".".into());
    let opencode_session_id = session_id.clone().unwrap_or_else(|| task_id.clone());
    let agent_name = derive_opencode_agent(&goal);
    let mut artifacts = task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref());
    artifacts.push(TaskArtifact {
        id: format!("artifact-opencode-server-{task_id}"),
        label: "Attached runtime server".into(),
        kind: "runtime_server".into(),
        value: server_url.clone(),
    });
    emit_runtime_state(
        &app,
        &task_id,
        "opencode-cli",
        "starting",
        Some(&opencode_session_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "opencode-cli",
        "Launch OpenCode",
        &format!(
            "Blade started an OpenCode task through the local CLI using the `{agent_name}` agent."
        ),
        "running",
    );

    let mut command = Command::new(binary);
    command
        .arg("run")
        .arg("--format")
        .arg("json")
        .arg("--agent")
        .arg(agent_name)
        .arg("--attach")
        .arg(&server_url)
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(model) = model {
        if !model.trim().is_empty() {
            command.arg("--model").arg(model);
        }
    }
    if let Some(session_id) = session_id.as_ref().filter(|value| !value.trim().is_empty()) {
        command.arg("--session").arg(session_id);
    }
    command.arg(&effective_goal);

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to launch OpenCode runtime: {error}"))?;

    spawn_runtime_process(
        app.clone(),
        registry,
        tasks,
        task_id.clone(),
        "opencode-cli".into(),
        child,
        RuntimeParserKind::CodexCli,
        Some(opencode_session_id.clone()),
    )
    .await?;

    emit_runtime_state(
        &app,
        &task_id,
        "opencode-cli",
        "running",
        Some(&opencode_session_id),
        None,
    );
    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "delegated_operator".into(),
        Some("opencode-cli".into()),
        Some("shell/code-agent".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id.clone(),
        handoff_note.clone(),
        Some(RuntimeSessionRef {
            runtime_id: "opencode-cli".into(),
            session_id: opencode_session_id,
            cwd,
            title: goal.chars().take(90).collect(),
            resumable: true,
            last_active_at: timestamp_ms(),
        }),
        artifacts,
        "running",
    ))
}

async fn start_tavily_runtime(
    app: tauri::AppHandle,
    db_state: SharedDb,
    task_id: String,
    goal: String,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
) -> Result<TaskGraph, String> {
    let api_key =
        setting_or_env(&db_state, "web.tavily_api_key", "TAVILY_API_KEY").ok_or_else(|| {
            "Blade could not find a Tavily API key in settings or environment.".to_string()
        })?;
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    emit_runtime_state(
        &app,
        &task_id,
        "tavily-backend",
        "starting",
        Some(&task_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "tavily-backend",
        "Query Tavily",
        "Blade is querying Tavily for search-heavy web intelligence.",
        "running",
    );

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.tavily.com/search")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&serde_json::json!({
            "query": effective_goal,
            "search_depth": "advanced",
            "topic": "general",
            "max_results": 5,
            "include_answer": "advanced",
            "include_raw_content": "markdown",
        }))
        .send()
        .await
        .map_err(|error| format!("Blade could not reach Tavily: {error}"))?;

    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Blade could not decode Tavily response: {error}"))?;

    if !status.is_success() {
        return Err(format!("Tavily returned {}: {}", status, payload));
    }

    let answer = payload
        .get("answer")
        .and_then(Value::as_str)
        .unwrap_or("Tavily returned search results without a synthesized answer.")
        .to_string();
    let results = payload
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let result_lines = results
        .iter()
        .take(5)
        .filter_map(|result| {
            let title = result
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled");
            let url = result.get("url").and_then(Value::as_str).unwrap_or("");
            if url.is_empty() {
                Some(title.to_string())
            } else {
                Some(format!("{title} — {url}"))
            }
        })
        .collect::<Vec<_>>();
    let summary = if result_lines.is_empty() {
        answer.clone()
    } else {
        format!("{answer}\n\nTop results:\n- {}", result_lines.join("\n- "))
    };
    let mut artifacts = task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref());
    artifacts.push(TaskArtifact {
        id: format!("artifact-tavily-answer-{task_id}"),
        label: "Tavily answer".into(),
        kind: "summary".into(),
        value: answer.clone(),
    });
    artifacts.push(TaskArtifact {
        id: format!("artifact-tavily-results-{task_id}"),
        label: "Tavily results".into(),
        kind: "web_results".into(),
        value: serde_json::to_string_pretty(&results).unwrap_or_else(|_| "[]".into()),
    });

    emit_runtime_message(
        &app,
        &task_id,
        "tavily-backend",
        Some(&task_id),
        "result",
        "assistant",
        summary.clone(),
        serde_json::json!({ "resultCount": results.len() }),
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "tavily-backend",
        "Tavily search completed",
        &format!("Blade collected {} Tavily results.", results.len()),
        "completed",
    );
    emit_runtime_state(
        &app,
        &task_id,
        "tavily-backend",
        "completed",
        Some(&task_id),
        None,
    );
    emit_task_done(
        &app,
        &task_id,
        "tavily-backend",
        "completed",
        Some(&task_id),
        Some(&summary),
        None,
    );

    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "web_intelligence".into(),
        Some("tavily-backend".into()),
        Some("search-extract".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id,
        handoff_note,
        Some(RuntimeSessionRef {
            runtime_id: "tavily-backend".into(),
            session_id: task_id,
            cwd: None,
            title: goal.chars().take(90).collect(),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        artifacts,
        "completed",
    ))
}

async fn start_firecrawl_runtime(
    app: tauri::AppHandle,
    db_state: SharedDb,
    task_id: String,
    goal: String,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
) -> Result<TaskGraph, String> {
    let api_key = setting_or_env(&db_state, "web.firecrawl_api_key", "FIRECRAWL_API_KEY");
    let api_url = setting_or_env(&db_state, "web.firecrawl_api_url", "FIRECRAWL_API_URL")
        .unwrap_or_else(|| "https://api.firecrawl.dev".into())
        .trim_end_matches('/')
        .to_string();
    if api_key.is_none() && api_url == "https://api.firecrawl.dev" {
        return Err("Blade could not find FIRECRAWL_API_KEY for the hosted Firecrawl API.".into());
    }
    let effective_goal = apply_handoff_context(&goal, handoff_note.as_deref());
    emit_runtime_state(
        &app,
        &task_id,
        "firecrawl-backend",
        "starting",
        Some(&task_id),
        None,
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "firecrawl-backend",
        "Query Firecrawl",
        "Blade is querying Firecrawl for crawl and extraction-heavy web intelligence.",
        "running",
    );

    let client = reqwest::Client::new();
    let mut request = client
        .post(format!("{api_url}/v2/search"))
        .json(&serde_json::json!({
            "query": effective_goal,
            "limit": 5,
            "sources": ["web"],
            "scrapeOptions": {
                "formats": ["markdown"],
                "onlyMainContent": true
            }
        }));
    if let Some(api_key) = api_key {
        request = request.header("Authorization", format!("Bearer {api_key}"));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Blade could not reach Firecrawl: {error}"))?;
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Blade could not decode Firecrawl response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Firecrawl returned {}: {}", status, payload));
    }

    let results = payload
        .get("data")
        .and_then(|value| value.get("web").or_else(|| value.get("data")))
        .and_then(Value::as_array)
        .cloned()
        .or_else(|| payload.get("data").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let result_lines = results
        .iter()
        .take(5)
        .filter_map(|result| {
            let title = result
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled");
            let url = result.get("url").and_then(Value::as_str).unwrap_or("");
            let snippet = result
                .get("description")
                .and_then(Value::as_str)
                .or_else(|| result.get("markdown").and_then(Value::as_str))
                .unwrap_or("")
                .chars()
                .take(220)
                .collect::<String>();
            Some(format!("{title} — {url}\n{snippet}"))
        })
        .collect::<Vec<_>>();
    let summary = if result_lines.is_empty() {
        "Firecrawl completed, but returned no web results.".to_string()
    } else {
        format!(
            "Firecrawl gathered {} results.\n\n{}",
            result_lines.len(),
            result_lines.join("\n\n")
        )
    };
    let mut artifacts = task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref());
    artifacts.push(TaskArtifact {
        id: format!("artifact-firecrawl-results-{task_id}"),
        label: "Firecrawl results".into(),
        kind: "web_results".into(),
        value: serde_json::to_string_pretty(&results).unwrap_or_else(|_| "[]".into()),
    });

    emit_runtime_message(
        &app,
        &task_id,
        "firecrawl-backend",
        Some(&task_id),
        "result",
        "assistant",
        summary.clone(),
        serde_json::json!({ "resultCount": results.len() }),
    );
    emit_task_checkpoint(
        &app,
        &task_id,
        "firecrawl-backend",
        "Firecrawl search completed",
        &format!("Blade collected {} Firecrawl results.", results.len()),
        "completed",
    );
    emit_runtime_state(
        &app,
        &task_id,
        "firecrawl-backend",
        "completed",
        Some(&task_id),
        None,
    );
    emit_task_done(
        &app,
        &task_id,
        "firecrawl-backend",
        "completed",
        Some(&task_id),
        Some(&summary),
        None,
    );

    Ok(build_task_graph(
        task_id.clone(),
        goal.clone(),
        "web_intelligence".into(),
        Some("firecrawl-backend".into()),
        Some("crawl-extract".into()),
        None,
        mission_id,
        stage_id,
        parent_task_id,
        handoff_note,
        Some(RuntimeSessionRef {
            runtime_id: "firecrawl-backend".into(),
            session_id: task_id,
            cwd: None,
            title: goal.chars().take(90).collect(),
            resumable: false,
            last_active_at: timestamp_ms(),
        }),
        artifacts,
        "completed",
    ))
}

#[tauri::command]
pub async fn runtime_start_task(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
    _missions: tauri::State<'_, SharedMissionRegistry>,
    db_state: tauri::State<'_, SharedDb>,
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    runtime_id: String,
    goal: String,
    cwd: Option<String>,
    session_id: Option<String>,
    operator_type: Option<String>,
    preferred_substrate: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    security_engagement_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    max_turns: Option<u32>,
    tools: Option<Vec<String>>,
) -> Result<TaskGraph, String> {
    let task_id = uuid::Uuid::new_v4().to_string();
    let inherited_session = if session_id.is_none() {
        let snapshot = tasks.inner().lock().await.clone();
        lineage_session_for_runtime(&snapshot, parent_task_id.as_deref(), &runtime_id)
    } else {
        None
    };
    let inherited_session_id = inherited_session
        .as_ref()
        .map(|session| session.session_id.clone());
    let effective_session_id = session_id.clone().or(inherited_session_id);
    let effective_cwd = cwd
        .clone()
        .or_else(|| inherited_session.and_then(|session| session.cwd));
    let engagement_snapshot = engagements.inner().lock().await.clone();
    let effective_security_engagement = resolve_security_engagement_for_goal(
        &goal,
        security_engagement_id.as_deref(),
        &engagement_snapshot,
    )?;

    let result = match runtime_id.as_str() {
        "blade-native" => {
            let operator_type = operator_type.unwrap_or_else(|| {
                if preferred_substrate.is_some() {
                    "desktop_operator".into()
                } else {
                    "general_operator".into()
                }
            });
            emit_runtime_state(
                &app,
                &task_id,
                "blade-native",
                "starting",
                Some(&task_id),
                None,
            );
            let session = if operator_type == "desktop_operator" {
                let execution_mode = match permission_mode.as_deref() {
                    Some("auto") => "auto".to_string(),
                    _ => "supervised".to_string(),
                };
                let agent_id = agent_commands::agent_create_desktop(
                    app.clone(),
                    queue,
                    goal.clone(),
                    max_turns,
                    Some(execution_mode),
                )
                .await?;
                RuntimeSessionRef {
                    runtime_id: "blade-native".into(),
                    session_id: agent_id,
                    cwd: effective_cwd.clone(),
                    title: goal.chars().take(90).collect(),
                    resumable: true,
                    last_active_at: timestamp_ms(),
                }
            } else {
                let agent_id =
                    agent_commands::agent_create(app.clone(), queue, mcp, goal.clone()).await?;
                RuntimeSessionRef {
                    runtime_id: "blade-native".into(),
                    session_id: agent_id,
                    cwd: effective_cwd.clone(),
                    title: goal.chars().take(90).collect(),
                    resumable: true,
                    last_active_at: timestamp_ms(),
                }
            };
            emit_task_checkpoint(
                &app,
                &task_id,
                "blade-native",
                "Blade-native task created",
                "Blade handed this task to its local operator runtime.",
                "completed",
            );
            emit_runtime_state(
                &app,
                &task_id,
                "blade-native",
                "running",
                Some(&session.session_id),
                None,
            );
            Ok(build_task_graph(
                task_id,
                goal,
                operator_type,
                Some("blade-native".into()),
                preferred_substrate,
                None,
                mission_id,
                stage_id,
                parent_task_id.clone(),
                handoff_note.clone(),
                Some(session),
                task_artifacts(parent_task_id.as_deref(), handoff_note.as_deref()),
                "running",
            ))
        }
        "claude-agent-sdk" => {
            start_claude_agent_sdk_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                effective_session_id,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                permission_mode,
                max_turns,
                tools,
            )
            .await
        }
        "claude-code" => {
            start_claude_code_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                effective_session_id,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                model,
                permission_mode,
                tools,
            )
            .await
        }
        "codex-cli" => {
            start_codex_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                effective_session_id,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                model,
            )
            .await
        }
        "google-gemma-local" => {
            start_google_gemma_local_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_session_id,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
            )
            .await
        }
        "open-interpreter" => {
            start_open_interpreter_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
            )
            .await
        }
        "aider-cli" => {
            start_aider_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                model,
            )
            .await
        }
        "browser-use" => {
            start_browser_use_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
            )
            .await
        }
        "tavily-backend" => {
            start_tavily_runtime(
                app,
                db_state.inner().clone(),
                task_id,
                goal,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
            )
            .await
        }
        "firecrawl-backend" => {
            start_firecrawl_runtime(
                app,
                db_state.inner().clone(),
                task_id,
                goal,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
            )
            .await
        }
        "openhands-cli" => {
            start_openhands_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
            )
            .await
        }
        "opencode-cli" => {
            start_opencode_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                servers.inner().clone(),
                task_id,
                goal,
                effective_cwd,
                effective_session_id,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                model,
            )
            .await
        }
        _ => Err(format!("Blade does not know runtime `{runtime_id}`.")),
    };

    if let Ok(graph) = result {
        let mut graph = graph;
        if let Some(engagement) = effective_security_engagement.as_ref() {
            graph.security_engagement_id = Some(engagement.id.clone());
            graph
                .artifacts
                .extend(security_engagement_artifacts(engagement));
        }
        persist_task_graph(tasks.inner(), &graph).await;
        return Ok(graph);
    }
    result
}

#[tauri::command]
pub async fn runtime_resume_session(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
    missions: tauri::State<'_, SharedMissionRegistry>,
    db_state: tauri::State<'_, SharedDb>,
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    runtime_id: String,
    session_id: String,
    goal: String,
    cwd: Option<String>,
    operator_type: Option<String>,
    preferred_substrate: Option<String>,
    mission_id: Option<String>,
    stage_id: Option<String>,
    parent_task_id: Option<String>,
    handoff_note: Option<String>,
    security_engagement_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    max_turns: Option<u32>,
    tools: Option<Vec<String>>,
) -> Result<TaskGraph, String> {
    match runtime_id.as_str() {
        "claude-code" => {
            let task_id = uuid::Uuid::new_v4().to_string();
            resume_claude_code_runtime(
                app,
                registry.inner().clone(),
                tasks.inner().clone(),
                task_id,
                goal,
                cwd,
                session_id,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                model,
                permission_mode,
                tools,
            )
            .await
        }
        "codex-cli" | "claude-agent-sdk" | "blade-native" | "google-gemma-local"
        | "open-interpreter" | "aider-cli" | "browser-use" | "openhands-cli" | "opencode-cli" => {
            runtime_start_task(
                app,
                registry,
                tasks,
                missions,
                db_state,
                engagements,
                servers,
                queue,
                mcp,
                runtime_id,
                goal,
                cwd,
                Some(session_id),
                operator_type,
                preferred_substrate,
                mission_id,
                stage_id,
                parent_task_id,
                handoff_note,
                security_engagement_id,
                model,
                permission_mode,
                max_turns,
                tools,
            )
            .await
        }
        _ => Err(format!("Blade does not know runtime `{runtime_id}`.")),
    }
}

#[tauri::command]
pub async fn runtime_continue_mission(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
    missions: tauri::State<'_, SharedMissionRegistry>,
    db_state: tauri::State<'_, SharedDb>,
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    mission: OperatorMission,
) -> Result<Option<TaskGraph>, String> {
    let snapshot = tasks.inner().lock().await.clone();
    let Some(plan) = plan_next_mission_stage_from_snapshot(&snapshot, &mission) else {
        upsert_mission_record(missions.inner(), &mission, "completed", None, false).await;
        return Ok(None);
    };

    let graph = if let Some(session_id) = plan.resume_session_id.clone() {
        runtime_resume_session(
            app,
            registry,
            tasks,
            missions.clone(),
            db_state.clone(),
            engagements.clone(),
            servers,
            queue,
            mcp,
            plan.stage.runtime.runtime_id.clone(),
            session_id,
            plan.stage.goal.clone(),
            None,
            Some(plan.stage.runtime.operator_type.clone()),
            plan.stage.runtime.preferred_substrate.clone(),
            Some(mission.id.clone()),
            Some(plan.stage.id.clone()),
            plan.parent_task_id.clone(),
            plan.handoff_note.clone(),
            None,
            None,
            None,
            None,
            None,
        )
        .await?
    } else {
        runtime_start_task(
            app,
            registry,
            tasks,
            missions.clone(),
            db_state.clone(),
            engagements.clone(),
            servers,
            queue,
            mcp,
            plan.stage.runtime.runtime_id.clone(),
            plan.stage.goal.clone(),
            None,
            None,
            Some(plan.stage.runtime.operator_type.clone()),
            plan.stage.runtime.preferred_substrate.clone(),
            Some(mission.id.clone()),
            Some(plan.stage.id.clone()),
            plan.parent_task_id.clone(),
            plan.handoff_note.clone(),
            None,
            None,
            None,
            None,
            None,
        )
        .await?
    };

    upsert_mission_record(
        missions.inner(),
        &mission,
        "running",
        Some(plan.stage.id.clone()),
        false,
    )
    .await;
    Ok(Some(graph))
}

#[tauri::command]
pub async fn runtime_run_mission(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
    missions: tauri::State<'_, SharedMissionRegistry>,
    db_state: tauri::State<'_, SharedDb>,
    engagements: tauri::State<'_, SharedSecurityEngagementRegistry>,
    servers: tauri::State<'_, SharedRuntimeServerRegistry>,
    queue: tauri::State<'_, SharedAgentQueue>,
    mcp: tauri::State<'_, SharedMcpManager>,
    mission: OperatorMission,
    max_stages: Option<u32>,
) -> Result<MissionRunResult, String> {
    let mut launched = Vec::new();
    let limit = max_stages.unwrap_or(8).max(1);

    for _ in 0..limit {
        let snapshot = tasks.inner().lock().await.clone();
        let Some(plan) = plan_next_mission_stage_from_snapshot(&snapshot, &mission) else {
            upsert_mission_record(missions.inner(), &mission, "completed", None, true).await;
            return Ok(MissionRunResult {
                launched,
                blocked: false,
                completed: true,
                next_stage_id: None,
            });
        };

        let stage_id = plan.stage.id.clone();
        upsert_mission_record(
            missions.inner(),
            &mission,
            "running",
            Some(stage_id.clone()),
            true,
        )
        .await;
        let graph = if let Some(session_id) = plan.resume_session_id.clone() {
            runtime_resume_session(
                app.clone(),
                registry.clone(),
                tasks.clone(),
                missions.clone(),
                db_state.clone(),
                engagements.clone(),
                servers.clone(),
                queue.clone(),
                mcp.clone(),
                plan.stage.runtime.runtime_id.clone(),
                session_id,
                plan.stage.goal.clone(),
                None,
                Some(plan.stage.runtime.operator_type.clone()),
                plan.stage.runtime.preferred_substrate.clone(),
                Some(mission.id.clone()),
                Some(stage_id.clone()),
                plan.parent_task_id.clone(),
                plan.handoff_note.clone(),
                None,
                None,
                None,
                None,
                None,
            )
            .await?
        } else {
            runtime_start_task(
                app.clone(),
                registry.clone(),
                tasks.clone(),
                missions.clone(),
                db_state.clone(),
                engagements.clone(),
                servers.clone(),
                queue.clone(),
                mcp.clone(),
                plan.stage.runtime.runtime_id.clone(),
                plan.stage.goal.clone(),
                None,
                None,
                Some(plan.stage.runtime.operator_type.clone()),
                plan.stage.runtime.preferred_substrate.clone(),
                Some(mission.id.clone()),
                Some(stage_id.clone()),
                plan.parent_task_id.clone(),
                plan.handoff_note.clone(),
                None,
                None,
                None,
                None,
                None,
            )
            .await?
        };

        launched.push(graph);

        let snapshot = tasks.inner().lock().await.clone();
        let next_plan = plan_next_mission_stage_from_snapshot(&snapshot, &mission);
        if let Some(next_plan) = next_plan {
            if !next_plan.stage.depends_on.is_empty() {
                return Ok(MissionRunResult {
                    launched,
                    blocked: true,
                    completed: false,
                    next_stage_id: Some(next_plan.stage.id),
                });
            }
        } else {
            upsert_mission_record(missions.inner(), &mission, "completed", None, true).await;
            return Ok(MissionRunResult {
                launched,
                blocked: false,
                completed: true,
                next_stage_id: None,
            });
        }
    }

    let snapshot = tasks.inner().lock().await.clone();
    let next_plan = plan_next_mission_stage_from_snapshot(&snapshot, &mission);
    upsert_mission_record(
        missions.inner(),
        &mission,
        if next_plan.is_none() {
            "completed"
        } else if next_plan
            .as_ref()
            .map(|plan| !plan.stage.depends_on.is_empty())
            .unwrap_or(false)
        {
            "blocked"
        } else {
            "running"
        },
        next_plan.as_ref().map(|plan| plan.stage.id.clone()),
        true,
    )
    .await;
    Ok(MissionRunResult {
        launched,
        blocked: next_plan
            .as_ref()
            .map(|plan| !plan.stage.depends_on.is_empty())
            .unwrap_or(false),
        completed: next_plan.is_none(),
        next_stage_id: next_plan.map(|plan| plan.stage.id),
    })
}

#[tauri::command]
pub async fn runtime_stop_task(
    app: tauri::AppHandle,
    registry: tauri::State<'_, SharedRuntimeRegistry>,
    tasks: tauri::State<'_, SharedTaskGraphRegistry>,
    task_id: String,
) -> Result<(), String> {
    let handle = registry.lock().await.remove(&task_id);
    let Some(handle) = handle else {
        return Err(format!("Blade could not find runtime task `{task_id}`."));
    };
    let runtime_id = handle.runtime_id.clone();
    let result = {
        let mut child = handle.child.lock().await;
        child.kill().await
    };
    match result {
        Ok(_) => {
            if let Some(task) = tasks.lock().await.get_mut(&task_id) {
                task.status = "cancelled".into();
            }
            emit_runtime_state(&app, &task_id, &runtime_id, "cancelled", None, None);
            emit_task_done(
                &app,
                &task_id,
                &runtime_id,
                "cancelled",
                None,
                Some("Task cancelled"),
                None,
            );
            Ok(())
        }
        Err(error) => Err(format!(
            "Blade could not stop runtime task `{task_id}`: {error}"
        )),
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Mission Spec file management (templates stored in ~/.blade/missions/*.json)
// ──────────────────────────────────────────────────────────────────────────────

fn mission_specs_dir() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("missions")
}

#[tauri::command]
pub fn list_mission_specs() -> Vec<serde_json::Value> {
    let dir = mission_specs_dir();
    if !dir.exists() { return Vec::new(); }
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        out.push(val);
                    }
                }
            }
        }
    }
    // Sort by title
    out.sort_by(|a, b| {
        let ta = a.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let tb = b.get("title").and_then(|v| v.as_str()).unwrap_or("");
        ta.cmp(tb)
    });
    out
}

#[tauri::command]
pub fn save_mission_spec(spec: serde_json::Value) -> Result<(), String> {
    let id = spec.get("id")
        .and_then(|v| v.as_str())
        .ok_or("spec missing id")?
        .to_string();
    let dir = mission_specs_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.json"));
    let content = serde_json::to_string_pretty(&spec).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_mission_spec(id: String) -> Result<(), String> {
    let path = mission_specs_dir().join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────────
// Brain-Mission integration: learn from completed mission stages
// ──────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn learn_from_mission_stage(
    mission_id: String,
    stage_id: String,
    stage_title: String,
    stage_summary: String,
    artifacts_json: String,
) -> Result<String, String> {
    use crate::memory::uuid_v4;

    if stage_summary.trim().is_empty() {
        return Ok("No summary to learn from.".to_string());
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Write a brain memory for this stage outcome
    let memory_text = format!(
        "[Mission {mission_id} / {stage_title}] {stage_summary}"
    );
    let id = uuid_v4();
    crate::db::brain_add_memory(&conn, &id, &memory_text, &mission_id, &artifacts_json, 0.8, None)
        .map_err(|e| e.to_string())?;

    Ok(format!("Learned from stage {stage_id}."))
}

/// Check for scheduled missions and return any that are due
#[tauri::command]
pub fn get_due_scheduled_missions() -> Vec<serde_json::Value> {
    use chrono::Utc;

    let dir = mission_specs_dir();
    if !dir.exists() { return Vec::new(); }

    let now = Utc::now();
    let mut due = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        // Only scheduled missions with a cron-like schedule field
                        if let Some(schedule) = val.get("schedule").and_then(|s| s.as_str()) {
                            // Simple daily/weekly check: "daily@HH:MM" or "weekly@DOW@HH:MM"
                            let is_due = check_schedule(schedule, &now);
                            if is_due {
                                due.push(val);
                            }
                        }
                    }
                }
            }
        }
    }
    due
}

fn check_schedule(schedule: &str, now: &chrono::DateTime<chrono::Utc>) -> bool {
    use chrono::Timelike;
    // Format: "daily@HH:MM" — check if current UTC hour:minute matches
    if let Some(rest) = schedule.strip_prefix("daily@") {
        let parts: Vec<&str> = rest.splitn(2, ':').collect();
        if parts.len() == 2 {
            let h: u32 = parts[0].parse().unwrap_or(99);
            let m: u32 = parts[1].parse().unwrap_or(99);
            return now.hour() == h && now.minute() < m + 5 && now.minute() >= m;
        }
    }
    false
}
