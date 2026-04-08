pub mod executor;
pub mod planner;
pub mod queue;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// An agent is a long-running task with a goal, plan, and tool access
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub goal: String,
    pub status: AgentStatus,
    pub steps: Vec<AgentStep>,
    pub current_step: usize,
    pub context: HashMap<String, String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Planning,
    Executing,
    WaitingApproval,
    Paused,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub id: String,
    pub description: String,
    pub tool_name: Option<String>,
    pub tool_args: Option<serde_json::Value>,
    pub status: StepStatus,
    pub result: Option<String>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

impl Agent {
    pub fn new(id: String, goal: String) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id,
            goal,
            status: AgentStatus::Planning,
            steps: Vec::new(),
            current_step: 0,
            context: HashMap::new(),
            created_at: now,
            updated_at: now,
            error: None,
        }
    }

    pub fn current_step_mut(&mut self) -> Option<&mut AgentStep> {
        self.steps.get_mut(self.current_step)
    }

    pub fn advance(&mut self) {
        self.current_step += 1;
        self.updated_at = chrono::Utc::now().timestamp_millis();
        if self.current_step >= self.steps.len() {
            self.status = AgentStatus::Completed;
        }
    }

    pub fn fail(&mut self, error: String) {
        self.status = AgentStatus::Failed;
        self.error = Some(error);
        self.updated_at = chrono::Utc::now().timestamp_millis();
    }
}
