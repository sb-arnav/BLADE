/// PREFRONTAL WORKING MEMORY — the Brain's active task scratchpad.
///
/// In neuroscience, the prefrontal cortex holds the current task in working
/// memory while you execute it. This is NOT long-term memory (hippocampus) —
/// it's the thing that says "I'm currently on step 3 of deploying, steps 1-2
/// are done, step 4 is next."
///
/// Without this, every message is processed independently. The user says
/// "deploy this" → brain plans and executes → user says "also notify the team"
/// → brain has no idea a deployment just happened.
///
/// The working memory auto-updates:
///   - brain_planner produces a plan → stored as current_plan
///   - tool loop executes successfully → steps_completed updated
///   - conversation ends → active_task cleared or summarized
///   - next message → brain_planner reads working memory and knows the state
///
/// Storage: single static (RAM only — this is transient by design, not persisted).
/// Clears when BLADE restarts. That's correct — working memory is volatile.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkingMemory {
    /// The user's original request that started this task
    pub task_request: String,
    /// The brain planner's structured plan (if any)
    pub plan: String,
    /// Number of tool calls completed in this task
    pub steps_completed: u32,
    /// Names of tools used so far
    pub tools_used: Vec<String>,
    /// Whether the task is still in progress
    pub active: bool,
    /// Timestamp when the task started
    pub started_at: i64,
    /// Brief summary of what's been accomplished so far
    pub progress_summary: String,
    /// The last tool result (brief) — helps the Brain understand current state
    pub last_result_preview: String,
}

static WORKING_MEMORY: OnceLock<Mutex<WorkingMemory>> = OnceLock::new();

fn store() -> &'static Mutex<WorkingMemory> {
    WORKING_MEMORY.get_or_init(|| Mutex::new(WorkingMemory::default()))
}

// ── Write API (called by commands.rs and brain_planner.rs) ───────────────────

/// Start a new task. Called when brain_planner produces a plan.
pub fn begin_task(request: &str, plan: &str) {
    if let Ok(mut wm) = store().lock() {
        *wm = WorkingMemory {
            task_request: crate::safe_slice(request, 200).to_string(),
            plan: crate::safe_slice(plan, 500).to_string(),
            steps_completed: 0,
            tools_used: Vec::new(),
            active: true,
            started_at: chrono::Utc::now().timestamp(),
            progress_summary: String::new(),
            last_result_preview: String::new(),
        };
    }
}

/// Record a tool execution. Called from the tool loop in commands.rs.
pub fn record_step(tool_name: &str, result_preview: &str) {
    if let Ok(mut wm) = store().lock() {
        if !wm.active { return; }
        wm.steps_completed += 1;
        if !wm.tools_used.contains(&tool_name.to_string()) {
            wm.tools_used.push(tool_name.to_string());
        }
        wm.last_result_preview = crate::safe_slice(result_preview, 150).to_string();
    }
}

/// Complete the current task with a summary. Called when the tool loop finishes.
pub fn complete_task(summary: &str) {
    if let Ok(mut wm) = store().lock() {
        wm.active = false;
        wm.progress_summary = crate::safe_slice(summary, 300).to_string();
    }
}

/// Clear working memory entirely. Called when starting a fresh conversation.
pub fn clear() {
    if let Ok(mut wm) = store().lock() {
        *wm = WorkingMemory::default();
    }
}

// ── Read API (called by brain.rs / brain_planner.rs) ─────────────────────────

/// Get the current working memory state.
pub fn get() -> WorkingMemory {
    store().lock().map(|wm| wm.clone()).unwrap_or_default()
}

/// Get a compact injection for the system prompt.
/// Returns empty string if no active task.
/// When active, returns a 2-4 line summary of what's in progress.
pub fn get_injection() -> String {
    let wm = get();

    if !wm.active && wm.progress_summary.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();

    if wm.active {
        lines.push(format!("**Active task:** {}", wm.task_request));
        if wm.steps_completed > 0 {
            lines.push(format!(
                "Progress: {} steps done (tools: {})",
                wm.steps_completed,
                wm.tools_used.join(", ")
            ));
        }
        if !wm.last_result_preview.is_empty() {
            lines.push(format!("Last result: {}", wm.last_result_preview));
        }
        if !wm.plan.is_empty() {
            lines.push(format!("Plan: {}", crate::safe_slice(&wm.plan, 200)));
        }
    } else if !wm.progress_summary.is_empty() {
        // Task just completed — include summary so follow-up messages have context
        let age = chrono::Utc::now().timestamp() - wm.started_at;
        if age < 300 {
            // Only show for 5 minutes after completion
            lines.push(format!(
                "**Just completed:** {} → {}",
                wm.task_request,
                wm.progress_summary
            ));
        }
    }

    if lines.is_empty() {
        return String::new();
    }

    format!("## Working Memory\n\n{}", lines.join("\n"))
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn prefrontal_get() -> WorkingMemory {
    get()
}

#[tauri::command]
pub fn prefrontal_clear() {
    clear();
}
