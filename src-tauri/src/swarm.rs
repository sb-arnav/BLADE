/// BLADE Swarm — Parallel Multi-Agent Orchestration
///
/// Give BLADE a complex goal → it decomposes into a DAG of sub-tasks →
/// spawns multiple agents in parallel → coordinates dependencies → merges results.
///
/// Every AI coding tool runs one agent. BLADE runs 5 simultaneously.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SwarmTaskType {
    Code,
    Research,
    Desktop,
}

impl Default for SwarmTaskType {
    fn default() -> Self { SwarmTaskType::Code }
}

impl std::fmt::Display for SwarmTaskType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self { Self::Code => "code", Self::Research => "research", Self::Desktop => "desktop" };
        write!(f, "{}", s)
    }
}

impl SwarmTaskType {
    pub fn from_str(s: &str) -> Self {
        match s { "research" => Self::Research, "desktop" => Self::Desktop, _ => Self::Code }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SwarmTaskStatus {
    Pending,   // waiting for deps
    Blocked,   // explicit: has unfulfilled deps
    Ready,     // all deps done, waiting for slot
    Running,   // agent is executing
    Completed,
    Failed,
}

impl SwarmTaskStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Pending => "pending",
            Self::Blocked => "blocked",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "blocked" => Self::Blocked,
            "ready" => Self::Ready,
            "running" => Self::Running,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SwarmStatus {
    Planning,
    Running,
    Paused,
    Completed,
    Failed,
}

impl SwarmStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Planning => "planning",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "running" => Self::Running,
            "paused" => Self::Paused,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            _ => Self::Planning,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmTask {
    pub id: String,
    pub swarm_id: String,
    pub title: String,
    pub goal: String,
    pub task_type: SwarmTaskType,
    pub depends_on: Vec<String>,  // task IDs
    pub agent_id: Option<String>,
    pub status: SwarmTaskStatus,
    pub result: Option<String>,
    pub scratchpad_key: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Swarm {
    pub id: String,
    pub goal: String,
    pub status: SwarmStatus,
    pub scratchpad: HashMap<String, String>,
    pub final_result: Option<String>,
    pub tasks: Vec<SwarmTask>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

pub fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Option<rusqlite::Connection> {
    rusqlite::Connection::open(db_path()).ok()
}

pub fn save_swarm(swarm: &Swarm) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let scratchpad = serde_json::to_string(&swarm.scratchpad).unwrap_or_default();
    conn.execute(
        "INSERT OR REPLACE INTO swarms (id, goal, status, scratchpad, final_result, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            swarm.id, swarm.goal, swarm.status.as_str(), scratchpad,
            swarm.final_result, swarm.created_at, swarm.updated_at
        ],
    ).is_ok()
}

pub fn update_swarm_status(swarm_id: &str, status: &SwarmStatus, final_result: Option<&str>) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE swarms SET status = ?1, final_result = ?2, updated_at = ?3 WHERE id = ?4",
        params![status.as_str(), final_result, now, swarm_id],
    ).is_ok()
}

pub fn update_swarm_scratchpad(swarm_id: &str, scratchpad: &HashMap<String, String>) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let json = serde_json::to_string(scratchpad).unwrap_or_default();
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE swarms SET scratchpad = ?1, updated_at = ?2 WHERE id = ?3",
        params![json, now, swarm_id],
    ).is_ok()
}

pub fn save_swarm_task(task: &SwarmTask) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let depends_on = serde_json::to_string(&task.depends_on).unwrap_or_default();
    conn.execute(
        "INSERT OR REPLACE INTO swarm_tasks
         (id, swarm_id, title, goal, task_type, depends_on, agent_id, status, result,
          scratchpad_key, created_at, started_at, completed_at, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            task.id, task.swarm_id, task.title, task.goal,
            task.task_type.to_string(), depends_on,
            task.agent_id, task.status.as_str(), task.result,
            task.scratchpad_key, task.created_at, task.started_at,
            task.completed_at, task.error
        ],
    ).is_ok()
}

pub fn update_task_status(
    task_id: &str,
    status: &SwarmTaskStatus,
    agent_id: Option<&str>,
    result: Option<&str>,
    error: Option<&str>,
) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let now = chrono::Utc::now().timestamp();
    let (started_at, completed_at): (Option<i64>, Option<i64>) = match status {
        SwarmTaskStatus::Running => (Some(now), None),
        SwarmTaskStatus::Completed | SwarmTaskStatus::Failed => (None, Some(now)),
        _ => (None, None),
    };

    // Only update fields that are specified
    if matches!(status, SwarmTaskStatus::Running) {
        conn.execute(
            "UPDATE swarm_tasks SET status = ?1, agent_id = ?2, started_at = ?3 WHERE id = ?4",
            params![status.as_str(), agent_id, started_at, task_id],
        ).is_ok()
    } else {
        conn.execute(
            "UPDATE swarm_tasks SET status = ?1, result = ?2, error = ?3, completed_at = ?4 WHERE id = ?5",
            params![status.as_str(), result, error, completed_at, task_id],
        ).is_ok()
    }
}

pub fn load_swarm(swarm_id: &str) -> Option<Swarm> {
    let conn = open_db()?;
    let (goal, status_str, scratchpad_str, final_result, created_at, updated_at): (String, String, String, Option<String>, i64, i64) =
        conn.query_row(
            "SELECT goal, status, scratchpad, final_result, created_at, updated_at FROM swarms WHERE id = ?1",
            params![swarm_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        ).ok()?;

    let scratchpad: HashMap<String, String> = serde_json::from_str(&scratchpad_str).unwrap_or_default();
    let tasks = load_swarm_tasks(swarm_id);

    Some(Swarm {
        id: swarm_id.to_string(),
        goal,
        status: SwarmStatus::from_str(&status_str),
        scratchpad,
        final_result,
        tasks,
        created_at,
        updated_at,
    })
}

pub fn load_swarm_tasks(swarm_id: &str) -> Vec<SwarmTask> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, title, goal, task_type, depends_on, agent_id, status, result,
                scratchpad_key, created_at, started_at, completed_at, error
         FROM swarm_tasks WHERE swarm_id = ?1 ORDER BY created_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![swarm_id], |row| {
        let depends_on_str: String = row.get(4)?;
        let depends_on: Vec<String> = serde_json::from_str(&depends_on_str).unwrap_or_default();
        let task_type_str: String = row.get(3)?;
        let status_str: String = row.get(6)?;
        Ok(SwarmTask {
            id: row.get(0)?,
            swarm_id: swarm_id.to_string(),
            title: row.get(1)?,
            goal: row.get(2)?,
            task_type: SwarmTaskType::from_str(&task_type_str),
            depends_on,
            agent_id: row.get(5)?,
            status: SwarmTaskStatus::from_str(&status_str),
            result: row.get(7)?,
            scratchpad_key: row.get(8)?,
            created_at: row.get(9)?,
            started_at: row.get(10)?,
            completed_at: row.get(11)?,
            error: row.get(12)?,
        })
    })
    .ok()
    .map(|r| r.flatten().collect())
    .unwrap_or_default()
}

pub fn list_swarms(limit: usize) -> Vec<Swarm> {
    let conn = match open_db() {
        Some(c) => c,
        None => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id FROM swarms ORDER BY created_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![limit as i64], |row| {
        let id: String = row.get(0)?;
        Ok(id)
    })
    .ok()
    .map(|r| r.flatten().collect::<Vec<_>>())
    .unwrap_or_default()
    .into_iter()
    .filter_map(|id| load_swarm(&id))
    .collect()
}

// ---------------------------------------------------------------------------
// DAG utilities
// ---------------------------------------------------------------------------

/// Find tasks that are ready to run: status=pending/ready, all deps completed.
pub fn resolve_ready_tasks(tasks: &[SwarmTask]) -> Vec<String> {
    let completed_ids: std::collections::HashSet<&str> = tasks
        .iter()
        .filter(|t| t.status == SwarmTaskStatus::Completed)
        .map(|t| t.id.as_str())
        .collect();

    let running_count = tasks.iter().filter(|t| t.status == SwarmTaskStatus::Running).count();

    // Cap concurrent agents at 5
    if running_count >= 5 {
        return vec![];
    }

    tasks
        .iter()
        .filter(|t| {
            matches!(t.status, SwarmTaskStatus::Pending | SwarmTaskStatus::Ready)
                && t.depends_on.iter().all(|dep| completed_ids.contains(dep.as_str()))
        })
        .take(5 - running_count)
        .map(|t| t.id.clone())
        .collect()
}

/// Build context for a task by gathering results from its dependencies + scratchpad.
pub fn build_task_context(swarm: &Swarm, task: &SwarmTask) -> String {
    let mut parts: Vec<String> = vec![
        format!("# Swarm Goal\n{}", swarm.goal),
        format!("# This Task\n{}", task.goal),
    ];

    // Dep results
    let dep_results: Vec<String> = task
        .depends_on
        .iter()
        .filter_map(|dep_id| {
            swarm.tasks.iter().find(|t| &t.id == dep_id)
                .and_then(|t| t.result.as_ref())
                .map(|r| format!("## Result from '{}'\n{}", dep_id, &r[..r.len().min(800)]))
        })
        .collect();

    if !dep_results.is_empty() {
        parts.push(format!("# Context from prerequisite tasks\n{}", dep_results.join("\n\n")));
    }

    // Scratchpad
    if let Some(key) = &task.scratchpad_key {
        if let Some(val) = swarm.scratchpad.get(key) {
            parts.push(format!("# Shared scratchpad ({})\n{}", key, val));
        }
    }

    parts.join("\n\n")
}

/// Validate that the task graph is a DAG (no cycles) via topological sort.
pub fn validate_dag(tasks: &[SwarmTask]) -> Result<(), String> {
    let ids: std::collections::HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();

    // All depends_on IDs must exist
    for task in tasks {
        for dep in &task.depends_on {
            if !ids.contains(dep.as_str()) {
                return Err(format!("Task '{}' depends on unknown task '{}'", task.id, dep));
            }
        }
    }

    // Topological sort (Kahn's algorithm)
    let mut in_degree: HashMap<&str, usize> = tasks.iter().map(|t| (t.id.as_str(), 0)).collect();
    for task in tasks {
        for dep in &task.depends_on {
            *in_degree.get_mut(dep.as_str()).unwrap_or(&mut 0) += 0; // just ensure key exists
            // Increment in_degree of THIS task for each dep
        }
        *in_degree.entry(task.id.as_str()).or_insert(0) += task.depends_on.len();
    }

    let mut queue: Vec<&str> = in_degree.iter().filter(|(_, &d)| d == 0).map(|(&id, _)| id).collect();
    let mut processed = 0;

    while let Some(node) = queue.pop() {
        processed += 1;
        // Find tasks that depend on this node
        for task in tasks {
            if task.depends_on.iter().any(|d| d == node) {
                let count = in_degree.entry(task.id.as_str()).or_insert(0);
                if *count > 0 {
                    *count -= 1;
                    if *count == 0 {
                        queue.push(task.id.as_str());
                    }
                }
            }
        }
    }

    if processed < tasks.len() {
        Err("Swarm task graph contains a cycle".to_string())
    } else {
        Ok(())
    }
}
