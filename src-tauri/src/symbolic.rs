/// SYMBOLIC REASONING LAYER — deterministic logic that LLMs can't be trusted with.
///
/// Neuro-symbolic architecture: the LLM (neural) handles perception, language,
/// and creative synthesis. The symbolic layer handles rules, constraints, state
/// transitions, and policies. They work together:
///
///   User message → Neural (understand intent)
///                → Symbolic (validate constraints, check policies, resolve state)
///                → Neural (generate response within symbolic bounds)
///                → Symbolic (verify output satisfies constraints)
///
/// What belongs here (NOT in an LLM):
///   - Policy rules: "never deploy on Fridays after 5pm"
///   - State machines: "task is in state X, valid transitions are Y and Z"
///   - Constraint satisfaction: "this plan needs tools A, B, C — are they available?"
///   - Temporal reasoning: "X happened before Y, so Z must be true"
///   - Math: precise calculations (LLMs hallucinate arithmetic)
///   - Access control: deterministic permission checks

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

// ── Policy Engine ────────────────────────────────────────────────────────────
//
// Hard rules that NEVER go through an LLM. Deterministic, auditable, fast.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    pub id: String,
    pub name: String,
    /// The condition expression: "day == friday AND hour >= 17"
    pub condition: String,
    /// What to do when the condition matches: "block" | "warn" | "require_approval"
    pub action: String,
    /// Human-readable reason
    pub reason: String,
    /// Whether this policy is active
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyCheckResult {
    pub allowed: bool,
    pub triggered_policies: Vec<String>,
    pub action: String, // "allow" | "block" | "warn" | "require_approval"
    pub reason: String,
}

static POLICIES: OnceLock<Mutex<Vec<Policy>>> = OnceLock::new();

fn policies() -> &'static Mutex<Vec<Policy>> {
    POLICIES.get_or_init(|| Mutex::new(load_policies()))
}

fn load_policies() -> Vec<Policy> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return default_policies(),
    };

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS symbolic_policies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            condition TEXT NOT NULL,
            action TEXT NOT NULL DEFAULT 'warn',
            reason TEXT NOT NULL DEFAULT '',
            enabled INTEGER DEFAULT 1
        );"
    );

    let mut stmt = match conn.prepare(
        "SELECT id, name, condition, action, reason, enabled FROM symbolic_policies"
    ) {
        Ok(s) => s,
        Err(_) => return default_policies(),
    };

    let loaded: Vec<Policy> = stmt.query_map([], |row| {
        Ok(Policy {
            id: row.get(0)?,
            name: row.get(1)?,
            condition: row.get(2)?,
            action: row.get(3)?,
            reason: row.get(4)?,
            enabled: row.get::<_, i32>(5)? != 0,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default();

    if loaded.is_empty() {
        let defaults = default_policies();
        for p in &defaults {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO symbolic_policies (id, name, condition, action, reason, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![p.id, p.name, p.condition, p.action, p.reason, p.enabled as i32],
            );
        }
        defaults
    } else {
        loaded
    }
}

fn default_policies() -> Vec<Policy> {
    vec![
        Policy {
            id: "no_friday_deploy".to_string(),
            name: "No Friday deploys".to_string(),
            condition: "action_contains:deploy AND day_of_week:friday AND hour >= 17".to_string(),
            action: "warn".to_string(),
            reason: "Deploying on Friday evening is risky — issues won't be caught until Monday".to_string(),
            enabled: true,
        },
        Policy {
            id: "no_force_push".to_string(),
            name: "No force push to main".to_string(),
            condition: "action_contains:force push AND branch:main".to_string(),
            action: "block".to_string(),
            reason: "Force pushing to main destroys team history".to_string(),
            enabled: true,
        },
        Policy {
            id: "no_drop_database".to_string(),
            name: "No DROP DATABASE".to_string(),
            condition: "action_contains:drop database OR action_contains:DROP TABLE".to_string(),
            action: "block".to_string(),
            reason: "Database destruction requires manual confirmation outside BLADE".to_string(),
            enabled: true,
        },
        Policy {
            id: "budget_guard".to_string(),
            name: "API budget guard".to_string(),
            condition: "insulin > 0.8".to_string(),
            action: "warn".to_string(),
            reason: "API budget is critically low — consider switching to a cheaper model".to_string(),
            enabled: true,
        },
        Policy {
            id: "late_night_guard".to_string(),
            name: "Late night destructive action guard".to_string(),
            condition: "hour >= 1 AND hour <= 5 AND action_is_destructive:true".to_string(),
            action: "require_approval".to_string(),
            reason: "Destructive actions between 1-5 AM require explicit approval".to_string(),
            enabled: true,
        },
    ]
}

/// Check a proposed action against all active policies.
/// Called BEFORE tool execution in commands.rs.
pub fn check_policies(action_description: &str, context: &ActionContext) -> PolicyCheckResult {
    let policy_list = policies().lock()
        .map(|p| p.clone())
        .unwrap_or_default();

    let mut triggered = Vec::new();
    let mut worst_action = "allow".to_string();
    let mut reasons = Vec::new();

    for policy in &policy_list {
        if !policy.enabled { continue; }
        if evaluate_condition(&policy.condition, action_description, context) {
            triggered.push(policy.name.clone());
            reasons.push(policy.reason.clone());
            // Escalate: block > require_approval > warn > allow
            let severity = match policy.action.as_str() {
                "block" => 3,
                "require_approval" => 2,
                "warn" => 1,
                _ => 0,
            };
            let current = match worst_action.as_str() {
                "block" => 3,
                "require_approval" => 2,
                "warn" => 1,
                _ => 0,
            };
            if severity > current {
                worst_action = policy.action.clone();
            }
        }
    }

    PolicyCheckResult {
        allowed: worst_action == "allow" || worst_action == "warn",
        triggered_policies: triggered,
        action: worst_action,
        reason: reasons.join("; "),
    }
}

/// Context for policy evaluation — deterministic facts, not LLM guesses.
#[derive(Debug, Clone)]
pub struct ActionContext {
    pub hour: u32,
    pub day_of_week: String, // "monday" ... "sunday"
    pub is_destructive: bool,
    pub branch: String,
    pub insulin: f32,
}

impl ActionContext {
    pub fn current() -> Self {
        let now = chrono::Local::now();
        let hormones = crate::homeostasis::get_hormones();
        Self {
            hour: now.hour(),
            day_of_week: now.format("%A").to_string().to_lowercase(),
            is_destructive: false, // caller sets this
            branch: String::new(), // caller sets this
            insulin: hormones.insulin,
        }
    }
}

/// Evaluate a simple condition expression against context.
/// NOT a full expression parser — uses simple keyword matching for safety.
fn evaluate_condition(condition: &str, action: &str, ctx: &ActionContext) -> bool {
    let parts: Vec<&str> = condition.split(" AND ").collect();
    let action_lower = action.to_lowercase();

    for part in parts {
        let part = part.trim();
        let matches = if part.starts_with("action_contains:") {
            let keyword = part.strip_prefix("action_contains:").unwrap_or("").to_lowercase();
            action_lower.contains(&keyword)
        } else if part.starts_with("day_of_week:") {
            let day = part.strip_prefix("day_of_week:").unwrap_or("");
            ctx.day_of_week == day
        } else if part.starts_with("branch:") {
            let branch = part.strip_prefix("branch:").unwrap_or("");
            ctx.branch == branch
        } else if part.starts_with("action_is_destructive:") {
            ctx.is_destructive
        } else if part.starts_with("hour >= ") {
            let val: u32 = part.strip_prefix("hour >= ").unwrap_or("0").parse().unwrap_or(0);
            ctx.hour >= val
        } else if part.starts_with("hour <= ") {
            let val: u32 = part.strip_prefix("hour <= ").unwrap_or("24").parse().unwrap_or(24);
            ctx.hour <= val
        } else if part.starts_with("insulin > ") {
            let val: f32 = part.strip_prefix("insulin > ").unwrap_or("1.0").parse().unwrap_or(1.0);
            ctx.insulin > val
        } else if part.contains(" OR ") {
            // Simple OR: any sub-condition matches
            part.split(" OR ").any(|sub| {
                let sub = sub.trim();
                if sub.starts_with("action_contains:") {
                    let kw = sub.strip_prefix("action_contains:").unwrap_or("").to_lowercase();
                    action_lower.contains(&kw)
                } else {
                    false
                }
            })
        } else {
            false // unknown condition → doesn't match (safe default)
        };

        if !matches { return false; } // AND: all must match
    }

    true // all parts matched
}

// ── Constraint Checker ───────────────────────────────────────────────────────
//
// Verify that a plan's requirements are satisfiable BEFORE executing.
// Symbolic, not neural — checks hard constraints, not vibes.

/// Check if all tools referenced in a brain plan are actually available.
pub fn verify_plan_constraints(plan_text: &str) -> Vec<String> {
    let mut warnings = Vec::new();

    // Check if plan references organs that aren't active
    let hive_status = crate::hive::get_hive_status();
    let active_organs: Vec<String> = hive_status.tentacles.iter()
        .filter(|t| t.status == crate::hive::TentacleStatus::Active)
        .map(|t| t.platform.clone())
        .collect();

    let plan_lower = plan_text.to_lowercase();

    // Check for organ references in the plan
    let organ_refs = ["slack", "github", "email", "discord", "calendar", "linear", "jira"];
    for organ in organ_refs {
        if plan_lower.contains(organ) && !active_organs.iter().any(|o| o.to_lowercase() == organ) {
            warnings.push(format!(
                "Plan references '{}' but that organ is not active. Connect it first or use an alternative.",
                organ
            ));
        }
    }

    // Check for tool references
    if plan_lower.contains("deploy") || plan_lower.contains("push to production") {
        let ctx = ActionContext::current();
        let policy = check_policies(&plan_lower, &ctx);
        if !policy.allowed {
            warnings.push(format!("Policy violation: {}", policy.reason));
        }
    }

    // Check homeostasis constraints
    let hormones = crate::homeostasis::get_hormones();
    if hormones.insulin > 0.8 && plan_lower.contains("research") {
        warnings.push("API budget is critically low — research steps may fail".to_string());
    }

    warnings
}

// ── State Machine ────────────────────────────────────────────────────────────
//
// Track task states with deterministic transitions.
// Unlike the LLM's fuzzy understanding of "what step are we on,"
// this provides guaranteed state tracking.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskState {
    Planning,
    Executing,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

impl TaskState {
    /// Valid transitions from this state. Symbolic — no ambiguity.
    pub fn valid_transitions(&self) -> Vec<TaskState> {
        match self {
            TaskState::Planning => vec![TaskState::Executing, TaskState::Cancelled],
            TaskState::Executing => vec![TaskState::WaitingApproval, TaskState::Completed, TaskState::Failed, TaskState::Cancelled],
            TaskState::WaitingApproval => vec![TaskState::Executing, TaskState::Cancelled],
            TaskState::Completed => vec![], // terminal
            TaskState::Failed => vec![TaskState::Planning], // can retry by re-planning
            TaskState::Cancelled => vec![], // terminal
        }
    }

    pub fn can_transition_to(&self, target: &TaskState) -> bool {
        self.valid_transitions().contains(target)
    }
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn symbolic_check_policy(action: String) -> PolicyCheckResult {
    let ctx = ActionContext::current();
    check_policies(&action, &ctx)
}

#[tauri::command]
pub fn symbolic_list_policies() -> Vec<Policy> {
    policies().lock().map(|p| p.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn symbolic_add_policy(
    id: String, name: String, condition: String,
    action: String, reason: String,
) -> Result<(), String> {
    let policy = Policy {
        id: id.clone(), name, condition, action, reason, enabled: true,
    };

    // Save to DB
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO symbolic_policies (id, name, condition, action, reason, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        rusqlite::params![policy.id, policy.name, policy.condition, policy.action, policy.reason],
    ).map_err(|e| e.to_string())?;

    // Update in-memory
    if let Ok(mut list) = policies().lock() {
        list.retain(|p| p.id != id);
        list.push(policy);
    }

    Ok(())
}

#[tauri::command]
pub fn symbolic_verify_plan(plan: String) -> Vec<String> {
    verify_plan_constraints(&plan)
}

use chrono::Timelike;
