/// BLADE Workflow Builder — Visual n8n-style automation engine
///
/// Chain triggers + nodes to automate complex multi-step tasks locally:
///   "When file X changes → summarize with LLM → post to Slack"
///   "Every morning → check weather API → generate briefing → notify"
///
/// All workflows run locally. No cloud dependency.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

// ── Static guard ─────────────────────────────────────────────────────────────

static SCHEDULER_RUNNING: AtomicBool = AtomicBool::new(false);

// ── Data structures ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    /// "trigger/schedule" | "trigger/file_change" | "llm" | "bash" | "http"
    /// | "file_write" | "notify" | "condition"
    pub node_type: String,
    /// Node-specific configuration (varies by type)
    pub config: Value,
    /// IDs of nodes to execute after this one succeeds
    pub next_nodes: Vec<String>,
    /// ID of node to execute when this one fails (optional)
    pub on_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub nodes: Vec<WorkflowNode>,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub run_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub workflow_id: String,
    pub run_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// "running" | "success" | "failed"
    pub status: String,
    pub node_outputs: HashMap<String, String>,
    pub error: Option<String>,
}

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("workflows.db")
}

fn open_db() -> Result<Connection, String> {
    let conn = Connection::open(db_path()).map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn ensure_tables() {
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                nodes_json TEXT NOT NULL DEFAULT '[]',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_run INTEGER,
                run_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_runs (
                run_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                status TEXT NOT NULL DEFAULT 'running',
                node_outputs_json TEXT NOT NULL DEFAULT '{}',
                error TEXT,
                FOREIGN KEY(workflow_id) REFERENCES workflows(id)
            );",
        );
    }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

pub fn save_workflow(w: &Workflow) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;
    let nodes_json = serde_json::to_string(&w.nodes).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO workflows
            (id, name, description, nodes_json, enabled, last_run, run_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            w.id,
            w.name,
            w.description,
            nodes_json,
            w.enabled as i64,
            w.last_run,
            w.run_count,
            w.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow(id: &str) -> Option<Workflow> {
    ensure_tables();
    let conn = open_db().ok()?;
    conn.query_row(
        "SELECT id, name, description, nodes_json, enabled, last_run, run_count, created_at
         FROM workflows WHERE id = ?1",
        params![id],
        row_to_workflow,
    )
    .ok()
}

pub fn list_workflows() -> Vec<Workflow> {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, name, description, nodes_json, enabled, last_run, run_count, created_at
         FROM workflows ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], row_to_workflow)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

pub fn delete_workflow(id: &str) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;
    conn.execute("DELETE FROM workflows WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workflow_runs WHERE workflow_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_workflow(row: &rusqlite::Row) -> rusqlite::Result<Workflow> {
    let nodes_json: String = row.get(3)?;
    let nodes: Vec<WorkflowNode> = serde_json::from_str(&nodes_json).unwrap_or_default();
    Ok(Workflow {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        nodes,
        enabled: row.get::<_, i64>(4)? != 0,
        last_run: row.get(5)?,
        run_count: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn get_workflow_runs(workflow_id: &str) -> Vec<WorkflowRun> {
    ensure_tables();
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT run_id, workflow_id, started_at, ended_at, status, node_outputs_json, error
         FROM workflow_runs WHERE workflow_id = ?1 ORDER BY started_at DESC LIMIT 50",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![workflow_id], row_to_run)
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

fn row_to_run(row: &rusqlite::Row) -> rusqlite::Result<WorkflowRun> {
    let node_outputs_json: String = row.get(5)?;
    let node_outputs: HashMap<String, String> =
        serde_json::from_str(&node_outputs_json).unwrap_or_default();
    Ok(WorkflowRun {
        run_id: row.get(0)?,
        workflow_id: row.get(1)?,
        started_at: row.get(2)?,
        ended_at: row.get(3)?,
        status: row.get(4)?,
        node_outputs,
        error: row.get(6)?,
    })
}

fn save_run(run: &WorkflowRun) -> Result<(), String> {
    ensure_tables();
    let conn = open_db()?;
    let node_outputs_json =
        serde_json::to_string(&run.node_outputs).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO workflow_runs
            (run_id, workflow_id, started_at, ended_at, status, node_outputs_json, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            run.run_id,
            run.workflow_id,
            run.started_at,
            run.ended_at,
            run.status,
            node_outputs_json,
            run.error,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Template substitution ─────────────────────────────────────────────────────

/// Replace `{{variable}}` placeholders with values from context.
fn apply_template(template: &str, context: &HashMap<String, String>) -> String {
    let mut result = template.to_string();
    for (key, value) in context {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}

// ── Node execution ────────────────────────────────────────────────────────────

async fn execute_node(
    node: &WorkflowNode,
    context: &mut HashMap<String, String>,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let node_type = node.node_type.as_str();
    match node_type {
        // ── LLM node ─────────────────────────────────────────────────────────
        "llm" => {
            use crate::providers::{complete_turn, ConversationMessage};

            let prompt_template = node
                .config
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("{{input}}");
            let prompt = apply_template(prompt_template, context);

            // Collect provider info before any await
            let config = crate::config::load_config();
            let task_type = crate::router::TaskType::Complex;
            let (provider, api_key, model) =
                crate::config::resolve_provider_for_task(&config, &task_type);

            // Optional system prompt
            let system_prompt = node
                .config
                .get("system_prompt")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let mut messages: Vec<ConversationMessage> = Vec::new();
            if !system_prompt.is_empty() {
                messages.push(ConversationMessage::System(system_prompt));
            }
            messages.push(ConversationMessage::User(prompt));

            let turn = complete_turn(&provider, &api_key, &model, &messages, &[], None).await?;
            Ok(turn.content)
        }

        // ── Bash node ─────────────────────────────────────────────────────────
        "bash" => {
            let cmd_template = node
                .config
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cmd = apply_template(cmd_template, context);
            if cmd.is_empty() {
                return Err("bash node: command is empty".to_string());
            }

            let cwd = node
                .config
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or(".")
                .to_string();

            let output = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
                .arg(if cfg!(windows) { "/C" } else { "-c" })
                .arg(&cmd)
                .current_dir(&cwd)
                .output()
                .await
                .map_err(|e| format!("bash node: {}", e))?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if !output.status.success() && !stderr.is_empty() {
                return Err(format!(
                    "bash node failed (exit {}): {}",
                    output.status.code().unwrap_or(-1),
                    crate::safe_slice(&stderr, 500)
                ));
            }
            Ok(stdout.trim().to_string())
        }

        // ── HTTP node ─────────────────────────────────────────────────────────
        "http" => {
            let url_template = node
                .config
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let url = apply_template(url_template, context);
            if url.is_empty() {
                return Err("http node: url is empty".to_string());
            }
            let method = node
                .config
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_uppercase();

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|e| e.to_string())?;

            let mut req = if method == "POST" {
                client.post(&url)
            } else {
                client.get(&url)
            };

            // Apply headers
            if let Some(headers_obj) = node.config.get("headers").and_then(|v| v.as_object()) {
                for (k, v) in headers_obj {
                    if let Some(val) = v.as_str() {
                        let val_applied = apply_template(val, context);
                        req = req.header(k.as_str(), val_applied);
                    }
                }
            }

            // Apply body for POST
            if method == "POST" {
                if let Some(body_template) =
                    node.config.get("body").and_then(|v| v.as_str())
                {
                    let body = apply_template(body_template, context);
                    req = req.body(body);
                }
            }

            let resp = req
                .send()
                .await
                .map_err(|e| format!("http node request error: {}", e))?;

            let status = resp.status();
            let text = resp
                .text()
                .await
                .map_err(|e| format!("http node read error: {}", e))?;

            if !status.is_success() {
                return Err(format!(
                    "http node: HTTP {} — {}",
                    status.as_u16(),
                    crate::safe_slice(&text, 300)
                ));
            }
            Ok(text)
        }

        // ── File write node ────────────────────────────────────────────────────
        "file_write" => {
            let path_template = node
                .config
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let path = apply_template(path_template, context);
            if path.is_empty() {
                return Err("file_write node: path is empty".to_string());
            }

            let content_template = node
                .config
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("{{output}}");
            let content = apply_template(content_template, context);

            let append = node
                .config
                .get("append")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let p = std::path::Path::new(&path);
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("file_write: cannot create dir: {}", e))?;
            }

            if append {
                use std::io::Write;
                let mut f = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                    .map_err(|e| format!("file_write: {}", e))?;
                writeln!(f, "{}", content).map_err(|e| format!("file_write: {}", e))?;
            } else {
                std::fs::write(&path, &content)
                    .map_err(|e| format!("file_write: {}", e))?;
            }

            Ok(format!("Written {} bytes to {}", content.len(), path))
        }

        // ── Notify node ───────────────────────────────────────────────────────
        "notify" => {
            let title_template = node
                .config
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("BLADE Workflow");
            let message_template = node
                .config
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("{{output}}");

            let title = apply_template(title_template, context);
            let message = apply_template(message_template, context);

            let payload = serde_json::json!({
                "title": title,
                "message": message,
            });
            app.emit("blade_workflow_notification", &payload)
                .map_err(|e| format!("notify node emit error: {}", e))?;

            Ok(format!("Notified: {}", crate::safe_slice(&message, 100)))
        }

        // ── Condition node ────────────────────────────────────────────────────
        "condition" => {
            // The condition node reads `input` from context, checks it against
            // a rule, and returns "true" or "false". The caller (run_workflow)
            // uses next_nodes[0] for true and next_nodes[1] for false.
            let input = context
                .get("output")
                .cloned()
                .unwrap_or_default();

            let op = node
                .config
                .get("operator")
                .and_then(|v| v.as_str())
                .unwrap_or("contains");
            let value_template = node
                .config
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let value = apply_template(value_template, context);

            let matched = match op {
                "contains" => input.contains(&value),
                "not_contains" => !input.contains(&value),
                "equals" => input.trim() == value.trim(),
                "not_equals" => input.trim() != value.trim(),
                "starts_with" => input.starts_with(&value),
                "ends_with" => input.ends_with(&value),
                "regex" => {
                    // Simple regex using contains for the match (avoid adding regex dep)
                    // For full regex support a dedicated crate would be needed.
                    // Here we do a case-insensitive substring match as a reasonable fallback.
                    input
                        .to_lowercase()
                        .contains(&value.to_lowercase())
                }
                "is_empty" => input.trim().is_empty(),
                "is_not_empty" => !input.trim().is_empty(),
                _ => false,
            };

            Ok(if matched { "true".to_string() } else { "false".to_string() })
        }

        // ── Trigger/schedule (used as a start node, output = trigger data) ────
        "trigger/schedule" | "trigger/file_change" => {
            // Trigger nodes are entry points; their output is the trigger payload
            Ok(context
                .get("trigger_data")
                .cloned()
                .unwrap_or_default())
        }

        _ => Err(format!("Unknown node type: {}", node_type)),
    }
}

// ── Workflow execution ────────────────────────────────────────────────────────

pub async fn run_workflow(
    workflow_id: &str,
    trigger_data: Value,
    app: tauri::AppHandle,
) -> Result<WorkflowRun, String> {
    // Load workflow from DB (sync, before any await)
    let workflow = get_workflow(workflow_id)
        .ok_or_else(|| format!("Workflow not found: {}", workflow_id))?;

    let run_id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().timestamp();

    let mut run = WorkflowRun {
        workflow_id: workflow_id.to_string(),
        run_id: run_id.clone(),
        started_at,
        ended_at: None,
        status: "running".to_string(),
        node_outputs: HashMap::new(),
        error: None,
    };
    let _ = save_run(&run);

    // Build a node index for fast lookup
    let node_map: HashMap<String, WorkflowNode> = workflow
        .nodes
        .iter()
        .map(|n| (n.id.clone(), n.clone()))
        .collect();

    // Find start node (trigger) — first trigger node, or first node
    let start_id = workflow
        .nodes
        .iter()
        .find(|n| n.node_type.starts_with("trigger/"))
        .map(|n| n.id.clone())
        .or_else(|| workflow.nodes.first().map(|n| n.id.clone()));

    let start_id = match start_id {
        Some(id) => id,
        None => {
            run.status = "failed".to_string();
            run.error = Some("Workflow has no nodes".to_string());
            run.ended_at = Some(chrono::Utc::now().timestamp());
            let _ = save_run(&run);
            return Err("Workflow has no nodes".to_string());
        }
    };

    // Execution context — carries outputs between nodes
    let mut context: HashMap<String, String> = HashMap::new();
    let trigger_str = trigger_data.to_string();
    context.insert("trigger_data".to_string(), trigger_str);

    // BFS/sequential traversal
    let mut queue: Vec<String> = vec![start_id];
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();

    while let Some(node_id) = queue.first().cloned() {
        queue.remove(0);

        if visited.contains(&node_id) {
            continue;
        }
        visited.insert(node_id.clone());

        let node = match node_map.get(&node_id) {
            Some(n) => n.clone(),
            None => continue,
        };

        match execute_node(&node, &mut context, &app).await {
            Ok(output) => {
                // Store output keyed by node id and as generic "output" for next node
                run.node_outputs.insert(node_id.clone(), output.clone());
                context.insert(node_id.clone(), output.clone());
                context.insert("output".to_string(), output.clone());

                // Condition node: branch on "true"/"false"
                if node.node_type == "condition" {
                    if output == "true" {
                        if let Some(next_id) = node.next_nodes.first() {
                            queue.push(next_id.clone());
                        }
                    } else {
                        // "false" branch — second entry in next_nodes
                        if node.next_nodes.len() > 1 {
                            queue.push(node.next_nodes[1].clone());
                        }
                    }
                } else {
                    for next_id in &node.next_nodes {
                        queue.push(next_id.clone());
                    }
                }
            }
            Err(e) => {
                // Route to error handler if specified
                if let Some(err_node_id) = &node.on_error {
                    context.insert("error".to_string(), e.clone());
                    queue.push(err_node_id.clone());
                } else {
                    run.status = "failed".to_string();
                    run.error = Some(format!("Node '{}' failed: {}", node_id, e));
                    run.ended_at = Some(chrono::Utc::now().timestamp());
                    let _ = save_run(&run);

                    // Update workflow stats
                    if let Ok(conn) = open_db() {
                        let now = chrono::Utc::now().timestamp();
                        let _ = conn.execute(
                            "UPDATE workflows SET last_run = ?1, run_count = run_count + 1 WHERE id = ?2",
                            params![now, workflow_id],
                        );
                    }
                    return Err(format!("Node '{}' failed: {}", node_id, e));
                }
            }
        }
    }

    run.status = "success".to_string();
    run.ended_at = Some(chrono::Utc::now().timestamp());
    let _ = save_run(&run);

    // Update workflow metadata
    if let Ok(conn) = open_db() {
        let now = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "UPDATE workflows SET last_run = ?1, run_count = run_count + 1 WHERE id = ?2",
            params![now, workflow_id],
        );
    }

    Ok(run)
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/// Computes next run timestamp for a schedule trigger node config.
/// Config fields: `interval_secs` (i64) or `time_of_day` + `day_of_week` strings.
fn compute_next_schedule_run(config: &Value, after: i64) -> i64 {
    if let Some(interval) = config.get("interval_secs").and_then(|v| v.as_i64()) {
        return after + interval;
    }
    // Default: run again in 60 minutes
    after + 3600
}

/// Background loop: every 60 seconds, check for scheduled workflows that are due.
pub fn start_workflow_scheduler(app: tauri::AppHandle) {
    if SCHEDULER_RUNNING.swap(true, Ordering::SeqCst) {
        return; // Already running
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

            // Collect due workflows synchronously before any await
            let due: Vec<(String, i64, Value)> = {
                let workflows = list_workflows();
                let now = chrono::Utc::now().timestamp();
                workflows
                    .into_iter()
                    .filter(|w| w.enabled)
                    .filter_map(|w| {
                        // Find the trigger/schedule node
                        let trigger = w.nodes.iter().find(|n| n.node_type == "trigger/schedule")?;
                        let next_run = trigger
                            .config
                            .get("next_run_at")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                        if next_run <= now {
                            Some((w.id.clone(), next_run, trigger.config.clone()))
                        } else {
                            None
                        }
                    })
                    .collect()
            };

            for (wf_id, _last_run, trigger_config) in due {
                let app_clone = app.clone();
                let wf_id_clone = wf_id.clone();

                tauri::async_runtime::spawn(async move {
                    let trigger_data = serde_json::json!({ "source": "scheduler" });
                    let _ = run_workflow(&wf_id_clone, trigger_data, app_clone).await;
                });

                // Update next_run_at in DB
                if let Ok(conn) = open_db() {
                    if let Some(wf) = get_workflow(&wf_id) {
                        let now = chrono::Utc::now().timestamp();
                        let next_run = compute_next_schedule_run(&trigger_config, now);
                        let mut updated_nodes = wf.nodes.clone();
                        for node in &mut updated_nodes {
                            if node.node_type == "trigger/schedule" {
                                node.config["next_run_at"] =
                                    serde_json::Value::Number(next_run.into());
                            }
                        }
                        if let Ok(nodes_json) = serde_json::to_string(&updated_nodes) {
                            let _ = conn.execute(
                                "UPDATE workflows SET nodes_json = ?1 WHERE id = ?2",
                                params![nodes_json, wf_id],
                            );
                        }
                    }
                }
            }
        }
    });
}

// ── LLM workflow generator ────────────────────────────────────────────────────

/// Ask the LLM to build a Workflow JSON from a natural language description.
pub async fn generate_workflow_from_description(description: &str) -> Result<Workflow, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let config = crate::config::load_config();
    let task_type = crate::router::TaskType::Complex;
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &task_type);

    let system = r#"You are a workflow automation expert. Given a description, produce a JSON object for a BLADE workflow.

The JSON must match this exact schema:
{
  "id": "<uuid>",
  "name": "<short name>",
  "description": "<what it does>",
  "enabled": true,
  "last_run": null,
  "run_count": 0,
  "created_at": <unix timestamp>,
  "nodes": [
    {
      "id": "<short-id>",
      "node_type": "<type>",
      "config": { ... },
      "next_nodes": ["<next-node-id>"],
      "on_error": null
    }
  ]
}

Available node types:
- trigger/schedule: config: { "interval_secs": 3600, "next_run_at": <unix ts> }
- trigger/file_change: config: { "path": "/some/file.txt" }
- llm: config: { "prompt": "Summarize: {{output}}", "system_prompt": "" }
- bash: config: { "command": "echo hello", "cwd": "." }
- http: config: { "url": "https://api.example.com", "method": "GET", "headers": {}, "body": "" }
- file_write: config: { "path": "/tmp/out.txt", "content": "{{output}}", "append": false }
- notify: config: { "title": "BLADE", "message": "{{output}}" }
- condition: config: { "operator": "contains", "value": "error" }
  (next_nodes[0] = true branch, next_nodes[1] = false branch)

Use {{output}} to pass the previous node's output. Use {{trigger_data}} for the initial trigger payload.
Return ONLY valid JSON with no markdown fences."#;

    let prompt = format!("Create a BLADE workflow for: {}", description);
    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(prompt),
    ];

    let turn = complete_turn(&provider, &api_key, &model, &messages, &[], None).await?;
    let raw = turn.content.trim();

    // Strip markdown fences if any
    let json_str = if raw.starts_with("```") {
        let after = raw.trim_start_matches('`');
        let after = after
            .trim_start_matches("json")
            .trim_start_matches('\n');
        if let Some(end) = after.rfind("```") {
            after[..end].trim()
        } else {
            after.trim()
        }
    } else {
        raw
    };

    let mut wf: Workflow =
        serde_json::from_str(json_str).map_err(|e| format!("LLM returned invalid JSON: {}", e))?;

    // Ensure ID and timestamps are set
    if wf.id.is_empty() {
        wf.id = uuid::Uuid::new_v4().to_string();
    }
    if wf.created_at == 0 {
        wf.created_at = chrono::Utc::now().timestamp();
    }

    Ok(wf)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn workflow_list() -> Vec<Workflow> {
    list_workflows()
}

#[tauri::command]
pub fn workflow_get(id: String) -> Option<Workflow> {
    get_workflow(&id)
}

#[tauri::command]
pub fn workflow_create(workflow: Workflow) -> Result<Workflow, String> {
    let mut wf = workflow;
    if wf.id.is_empty() {
        wf.id = uuid::Uuid::new_v4().to_string();
    }
    if wf.created_at == 0 {
        wf.created_at = chrono::Utc::now().timestamp();
    }
    save_workflow(&wf)?;
    Ok(wf)
}

#[tauri::command]
pub fn workflow_update(workflow: Workflow) -> Result<Workflow, String> {
    save_workflow(&workflow)?;
    Ok(workflow)
}

#[tauri::command]
pub fn workflow_delete(id: String) -> Result<(), String> {
    delete_workflow(&id)
}

#[tauri::command]
pub async fn workflow_run_now(
    workflow_id: String,
    app: tauri::AppHandle,
) -> Result<WorkflowRun, String> {
    let trigger_data = serde_json::json!({ "source": "manual" });
    run_workflow(&workflow_id, trigger_data, app).await
}

#[tauri::command]
pub fn workflow_get_runs(workflow_id: String) -> Vec<WorkflowRun> {
    get_workflow_runs(&workflow_id)
}

#[tauri::command]
pub async fn workflow_generate_from_description(
    description: String,
) -> Result<Workflow, String> {
    generate_workflow_from_description(&description).await
}
