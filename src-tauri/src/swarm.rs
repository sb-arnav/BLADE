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
// Scratchpad entry — typed, traceable agent findings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScratchpadEntry {
    pub key: String,
    pub value: String,
    pub source_task: String,
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Swarm progress snapshot
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmProgress {
    pub swarm_id: String,
    pub total: usize,
    pub completed: usize,
    pub running: usize,
    pub failed: usize,
    pub pending: usize,
    pub percent: usize,
    /// Rough estimate in seconds based on remaining tasks × average duration.
    pub estimated_seconds_remaining: Option<u64>,
}

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
    /// Agent role assigned to this task (researcher, coder, analyst, writer, reviewer)
    #[serde(default)]
    pub role: String,
    /// Tool names required by this task (from planner)
    #[serde(default)]
    pub required_tools: Vec<String>,
    /// Estimated execution time tier: "fast", "medium", "slow"
    #[serde(default = "default_medium")]
    pub estimated_duration: String,
}

fn default_medium() -> String { "medium".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Swarm {
    pub id: String,
    pub goal: String,
    pub status: SwarmStatus,
    /// Legacy flat map — kept for backward compat and failure annotations.
    pub scratchpad: HashMap<String, String>,
    /// Typed scratchpad entries with provenance — agents write here, synthesizer reads all.
    #[serde(default)]
    pub scratchpad_entries: Vec<ScratchpadEntry>,
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
    let entries_json = serde_json::to_string(&swarm.scratchpad_entries).unwrap_or_default();
    conn.execute(
        "INSERT OR REPLACE INTO swarms (id, goal, status, scratchpad, final_result, created_at, updated_at, scratchpad_entries)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            swarm.id, swarm.goal, swarm.status.as_str(), scratchpad,
            swarm.final_result, swarm.created_at, swarm.updated_at, entries_json
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

/// Write a typed ScratchpadEntry for a task completion.
/// Also writes to the flat scratchpad for backward compat.
pub fn write_scratchpad_entry(swarm_id: &str, entry: ScratchpadEntry) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let now = chrono::Utc::now().timestamp();

    // Load existing
    let result: Option<(String, String)> = conn.query_row(
        "SELECT scratchpad, scratchpad_entries FROM swarms WHERE id = ?1",
        params![swarm_id],
        |row| Ok((row.get(0)?, row.get::<_, String>(1).unwrap_or_default())),
    ).ok();

    let (mut flat, mut entries) = match result {
        Some((f, e)) => {
            let flat: HashMap<String, String> = serde_json::from_str(&f).unwrap_or_default();
            let entries: Vec<ScratchpadEntry> = serde_json::from_str(&e).unwrap_or_default();
            (flat, entries)
        }
        None => (HashMap::new(), Vec::new()),
    };

    // Update flat map
    flat.insert(entry.key.clone(), entry.value.clone());
    // Append typed entry (replace if same key+source exists)
    entries.retain(|e| !(e.key == entry.key && e.source_task == entry.source_task));
    entries.push(entry);

    let flat_json = serde_json::to_string(&flat).unwrap_or_default();
    let entries_json = serde_json::to_string(&entries).unwrap_or_default();

    conn.execute(
        "UPDATE swarms SET scratchpad = ?1, scratchpad_entries = ?2, updated_at = ?3 WHERE id = ?4",
        params![flat_json, entries_json, now, swarm_id],
    ).is_ok()
}

pub fn save_swarm_task(task: &SwarmTask) -> bool {
    let conn = match open_db() {
        Some(c) => c,
        None => return false,
    };
    let depends_on = serde_json::to_string(&task.depends_on).unwrap_or_default();
    let required_tools = serde_json::to_string(&task.required_tools).unwrap_or_default();
    conn.execute(
        "INSERT OR REPLACE INTO swarm_tasks
         (id, swarm_id, title, goal, task_type, depends_on, agent_id, status, result,
          scratchpad_key, created_at, started_at, completed_at, error,
          role, required_tools, estimated_duration)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            task.id, task.swarm_id, task.title, task.goal,
            task.task_type.to_string(), depends_on,
            task.agent_id, task.status.as_str(), task.result,
            task.scratchpad_key, task.created_at, task.started_at,
            task.completed_at, task.error,
            task.role, required_tools, task.estimated_duration
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
    // scratchpad_entries column may not exist in older DBs — use COALESCE fallback
    let (goal, status_str, scratchpad_str, entries_str, final_result, created_at, updated_at):
        (String, String, String, String, Option<String>, i64, i64) =
        conn.query_row(
            "SELECT goal, status, scratchpad,
                    COALESCE(scratchpad_entries, '[]'),
                    final_result, created_at, updated_at
             FROM swarms WHERE id = ?1",
            params![swarm_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        ).ok()?;

    let scratchpad: HashMap<String, String> = serde_json::from_str(&scratchpad_str).unwrap_or_default();
    let scratchpad_entries: Vec<ScratchpadEntry> = serde_json::from_str(&entries_str).unwrap_or_default();
    let tasks = load_swarm_tasks(swarm_id);

    Some(Swarm {
        id: swarm_id.to_string(),
        goal,
        status: SwarmStatus::from_str(&status_str),
        scratchpad,
        scratchpad_entries,
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
                scratchpad_key, created_at, started_at, completed_at, error,
                COALESCE(role, ''), COALESCE(required_tools, '[]'), COALESCE(estimated_duration, 'medium')
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
        let required_tools_str: String = row.get(14)?;
        let required_tools: Vec<String> = serde_json::from_str(&required_tools_str).unwrap_or_default();
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
            role: row.get(13)?,
            required_tools,
            estimated_duration: row.get(15)?,
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

/// Compute the transitive closure of a task's dependencies (all ancestors).
/// Returns a set of task IDs whose outputs are "visible" to this task.
fn collect_transitive_deps<'a>(swarm: &'a Swarm, task: &'a SwarmTask) -> std::collections::HashSet<&'a str> {
    let mut visited: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut queue: std::collections::VecDeque<&str> = task.depends_on.iter().map(|d| d.as_str()).collect();
    while let Some(dep_id) = queue.pop_front() {
        if visited.insert(dep_id) {
            // Also follow that task's own dependencies
            if let Some(dep_task) = swarm.tasks.iter().find(|t| t.id.as_str() == dep_id) {
                for transitive in &dep_task.depends_on {
                    queue.push_back(transitive.as_str());
                }
            }
        }
    }
    visited
}

/// Build context for a task by gathering results from its dependencies + scratchpad.
/// Downstream agents receive all upstream typed ScratchpadEntries as rich context.
pub fn build_task_context(swarm: &Swarm, task: &SwarmTask) -> String {
    let mut parts: Vec<String> = vec![
        format!("# Swarm Goal\n{}", swarm.goal),
        format!("# This Task\n{}", task.goal),
    ];

    // Include role/persona if set
    if !task.role.is_empty() {
        parts.push(format!("# Your Role\nYou are acting as a {} agent.", task.role));
    }

    // Dep results — direct output from predecessor tasks
    let dep_results: Vec<String> = task
        .depends_on
        .iter()
        .filter_map(|dep_id| {
            swarm.tasks.iter().find(|t| &t.id == dep_id)
                .and_then(|t| t.result.as_ref())
                .map(|r| format!("## Result from '{}'\n{}", dep_id, crate::safe_slice(r, 800)))
        })
        .collect();

    if !dep_results.is_empty() {
        parts.push(format!("# Context from prerequisite tasks\n{}", dep_results.join("\n\n")));
    }

    // Typed scratchpad entries from ALL upstream tasks (transitive closure of deps).
    // This gives downstream agents the full picture of what the swarm has discovered,
    // not just direct predecessor output.
    let upstream_ids = collect_transitive_deps(swarm, task);

    let typed_entries: Vec<String> = swarm
        .scratchpad_entries
        .iter()
        .filter(|e| upstream_ids.contains(e.source_task.as_str()))
        .map(|e| format!("### [{}] from task '{}'\n{}", e.key, e.source_task, crate::safe_slice(&e.value, 600)))
        .collect();

    if !typed_entries.is_empty() {
        parts.push(format!("# Shared findings from upstream agents\n{}", typed_entries.join("\n\n")));
    }

    // Failure annotations (evo-hq pattern) — warn about what other agents tried and failed,
    // so this agent doesn't repeat their mistakes
    let failures: Vec<String> = swarm.scratchpad
        .iter()
        .filter(|(k, _)| k.starts_with("_failed:"))
        .map(|(_, v)| format!("- {}", v))
        .collect();
    if !failures.is_empty() {
        parts.push(format!(
            "# Known failures to avoid\nOther agents in this swarm already tried these approaches and failed. Do NOT repeat them:\n{}",
            failures.join("\n")
        ));
    }

    parts.join("\n\n")
}

/// Compute a real-time progress snapshot for a swarm.
pub fn get_swarm_progress(swarm_id: &str) -> Option<SwarmProgress> {
    let swarm = load_swarm(swarm_id)?;
    let tasks = &swarm.tasks;
    let total = tasks.len();
    let completed = tasks.iter().filter(|t| t.status == SwarmTaskStatus::Completed).count();
    let running = tasks.iter().filter(|t| t.status == SwarmTaskStatus::Running).count();
    let failed = tasks.iter().filter(|t| t.status == SwarmTaskStatus::Failed).count();
    let pending = tasks.iter().filter(|t| matches!(t.status, SwarmTaskStatus::Pending | SwarmTaskStatus::Ready | SwarmTaskStatus::Blocked)).count();
    let percent = if total == 0 { 0 } else { (completed * 100) / total };

    // Estimate remaining time: average seconds per completed task * remaining tasks
    let estimated_seconds_remaining = if completed > 0 {
        let total_elapsed: i64 = tasks
            .iter()
            .filter(|t| t.status == SwarmTaskStatus::Completed)
            .filter_map(|t| t.started_at.zip(t.completed_at).map(|(s, c)| c - s))
            .sum();
        let avg_secs = total_elapsed / completed as i64;
        let remaining_tasks = (pending + running) as i64;
        // Account for parallelism (assume up to 5 concurrent)
        let effective_remaining = (remaining_tasks + 4) / 5;
        Some((avg_secs * effective_remaining).max(0) as u64)
    } else if pending + running > 0 {
        // No completed tasks yet — rough estimate based on duration tier
        let est: u64 = tasks
            .iter()
            .filter(|t| matches!(t.status, SwarmTaskStatus::Pending | SwarmTaskStatus::Ready | SwarmTaskStatus::Running))
            .map(|t| match t.estimated_duration.as_str() {
                "fast" => 15u64,
                "slow" => 120u64,
                _ => 45u64,
            })
            .sum();
        // Divide by concurrency factor
        Some(est / 5 + 10)
    } else {
        None
    };

    Some(SwarmProgress {
        swarm_id: swarm_id.to_string(),
        total,
        completed,
        running,
        failed,
        pending,
        percent,
        estimated_seconds_remaining,
    })
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

    // Topological sort (Kahn's algorithm) — count how many predecessors each task has
    let mut in_degree: HashMap<&str, usize> = tasks.iter().map(|t| (t.id.as_str(), 0)).collect();
    for task in tasks {
        // Each dependency adds one incoming edge to THIS task
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
