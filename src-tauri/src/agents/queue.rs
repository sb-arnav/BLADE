use super::{Agent, AgentStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Priority {
    Immediate,
    Normal,
    Low,
}

pub struct AgentQueue {
    agents: HashMap<String, Agent>,
    running: Vec<String>,
    max_concurrent: usize,
}

impl Default for AgentQueue {
    fn default() -> Self {
        Self {
            agents: HashMap::new(),
            running: Vec::new(),
            max_concurrent: 5,
        }
    }
}

impl AgentQueue {
    pub fn set_max_concurrent(&mut self, n: usize) {
        self.max_concurrent = n.max(1);
    }
}

impl AgentQueue {
    pub fn add(&mut self, agent: Agent) -> String {
        let id = agent.id.clone();
        self.agents.insert(id.clone(), agent);
        id
    }

    pub fn get(&self, id: &str) -> Option<&Agent> {
        self.agents.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Agent> {
        self.agents.get_mut(id)
    }

    pub fn list(&self) -> Vec<&Agent> {
        let mut agents: Vec<&Agent> = self.agents.values().collect();
        agents.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        agents
    }

    pub fn list_active(&self) -> Vec<&Agent> {
        self.agents
            .values()
            .filter(|a| {
                matches!(
                    a.status,
                    AgentStatus::Planning | AgentStatus::Executing | AgentStatus::WaitingApproval
                )
            })
            .collect()
    }

    pub fn can_run_more(&self) -> bool {
        self.running.len() < self.max_concurrent
    }

    pub fn mark_running(&mut self, id: &str) {
        if !self.running.contains(&id.to_string()) {
            self.running.push(id.to_string());
        }
    }

    pub fn mark_done(&mut self, id: &str) {
        self.running.retain(|r| r != id);
    }

    pub fn next_pending(&self) -> Option<String> {
        self.agents
            .values()
            .find(|a| a.status == AgentStatus::Planning || a.status == AgentStatus::Executing)
            .filter(|a| !self.running.contains(&a.id))
            .map(|a| a.id.clone())
    }

    pub fn pause(&mut self, id: &str) {
        if let Some(agent) = self.agents.get_mut(id) {
            if matches!(agent.status, AgentStatus::Executing | AgentStatus::Planning) {
                agent.status = AgentStatus::Paused;
                self.mark_done(id);
            }
        }
    }

    pub fn resume(&mut self, id: &str) {
        if let Some(agent) = self.agents.get_mut(id) {
            if agent.status == AgentStatus::Paused {
                agent.status = AgentStatus::Executing;
            }
        }
    }

    pub fn cancel(&mut self, id: &str) {
        if let Some(agent) = self.agents.get_mut(id) {
            agent.fail("Cancelled by user".to_string());
            self.mark_done(id);
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.agents.remove(id);
        self.mark_done(id);
    }
}

pub type SharedAgentQueue = Arc<Mutex<AgentQueue>>;
