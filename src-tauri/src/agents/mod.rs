pub mod executor;
pub mod planner;
pub mod queue;
pub mod thought_tree;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Agent Roles — specialization templates
// ---------------------------------------------------------------------------

/// Predefined agent roles that shape system prompt and tool preferences.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    /// Web search, document reading, summarization
    Researcher,
    /// Code generation, debugging, file editing
    Coder,
    /// Data analysis, comparison, decision frameworks
    Analyst,
    /// Content creation, editing, formatting
    Writer,
    /// Code review, fact checking, quality assurance
    Reviewer,
    /// Network scanning, port discovery, service enumeration
    SecurityRecon,
    /// Vulnerability assessment, risk scoring, CVE correlation
    SecurityAnalyst,
    /// Code review for security issues, dependency audit
    SecurityAuditor,
}

impl AgentRole {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "researcher" => Some(Self::Researcher),
            "coder" => Some(Self::Coder),
            "analyst" => Some(Self::Analyst),
            "writer" => Some(Self::Writer),
            "reviewer" => Some(Self::Reviewer),
            "securityrecon" | "security_recon" | "recon" => Some(Self::SecurityRecon),
            "securityanalyst" | "security_analyst" => Some(Self::SecurityAnalyst),
            "securityauditor" | "security_auditor" | "auditor" => Some(Self::SecurityAuditor),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Researcher => "researcher",
            Self::Coder => "coder",
            Self::Analyst => "analyst",
            Self::Writer => "writer",
            Self::Reviewer => "reviewer",
            Self::SecurityRecon => "securityrecon",
            Self::SecurityAnalyst => "securityanalyst",
            Self::SecurityAuditor => "securityauditor",
        }
    }

    /// System prompt snippet to inject for this role.
    pub fn system_prompt_snippet(&self) -> &'static str {
        match self {
            Self::Researcher => {
                "You are a Researcher agent. Your specialty is gathering information: \
                 web searches, reading documents, and synthesizing findings into clear summaries. \
                 Prefer breadth first — collect multiple sources before synthesizing. \
                 Always cite where you found information."
            }
            Self::Coder => {
                "You are a Coder agent. Your specialty is writing, debugging, and refactoring code. \
                 Produce clean, well-commented, production-ready code. \
                 Prefer precision over brevity — explain your reasoning when making architectural choices. \
                 Always consider edge cases and error handling."
            }
            Self::Analyst => {
                "You are an Analyst agent. Your specialty is structured reasoning: \
                 comparing options, applying decision frameworks, and drawing evidence-based conclusions. \
                 Present findings as structured lists or tables where appropriate. \
                 Be explicit about trade-offs and assumptions."
            }
            Self::Writer => {
                "You are a Writer agent. Your specialty is creating clear, engaging content: \
                 documentation, reports, emails, and structured prose. \
                 Match tone to context — technical for technical audiences, plain language for general ones. \
                 Always prioritize clarity and concision."
            }
            Self::Reviewer => {
                "You are a Reviewer agent. Your specialty is quality assurance: \
                 identifying bugs, logical errors, factual mistakes, and improvement opportunities. \
                 Be thorough but constructive. Prioritize issues by severity. \
                 Always explain the why behind each finding."
            }
            Self::SecurityRecon => {
                "You are a SecurityRecon agent. Your specialty is passive and active reconnaissance: \
                 network scanning, port discovery, service enumeration, banner grabbing, and \
                 mapping the attack surface of a target scope. \
                 Use tools like nmap, masscan, netstat, and service probes. \
                 Always document every open port, running service, and detected version. \
                 Produce structured findings: host → port → service → version → notes. \
                 Work only on authorized targets (owned systems, CTF environments, pentest scopes)."
            }
            Self::SecurityAnalyst => {
                "You are a SecurityAnalyst agent. Your specialty is vulnerability assessment: \
                 correlating recon findings against known CVEs, scoring risk using CVSS, \
                 identifying exploit chains, and prioritizing remediation. \
                 You receive structured recon data and produce a prioritized risk register. \
                 For each finding: assign severity (critical/high/medium/low), cite relevant CVEs, \
                 describe the attack vector, and recommend a concrete fix. \
                 Be precise about CVSS scores. Flag quick wins (easy to exploit, high impact) first."
            }
            Self::SecurityAuditor => {
                "You are a SecurityAuditor agent. Your specialty is code and dependency security review: \
                 finding SQL injection, XSS, command injection, hardcoded secrets, insecure cryptography, \
                 path traversal, SSRF, and insecure deserialization in source code. \
                 Also audit dependencies: flag packages with known CVEs, outdated versions, and \
                 abandoned libraries. For each finding: provide the file path, line number, \
                 a clear description of the vulnerability class, the risk level, and a concrete \
                 code-level fix suggestion. Use semgrep patterns, gitleaks rules, and OWASP Top 10 \
                 as your reference framework."
            }
        }
    }

    /// Preferred tool name patterns for this role (matched by substring against tool names).
    pub fn preferred_tool_patterns(&self) -> Vec<&'static str> {
        match self {
            Self::Researcher => vec!["search", "fetch", "browse", "read", "web"],
            Self::Coder => vec!["bash", "write", "edit", "file", "code", "run"],
            Self::Analyst => vec!["bash", "read", "search", "calc"],
            Self::Writer => vec!["write", "edit", "read", "file"],
            Self::Reviewer => vec!["read", "bash", "search", "file"],
            Self::SecurityRecon => vec!["bash", "network", "scan", "port", "fetch"],
            Self::SecurityAnalyst => vec!["bash", "search", "read", "fetch", "cve"],
            Self::SecurityAuditor => vec!["read", "bash", "file", "search", "write"],
        }
    }

    /// Build a full system prompt for an agent with this role.
    pub fn build_system_prompt(&self, base_prompt: &str) -> String {
        format!(
            "{}\n\n---\n**Role specialization:** {}",
            base_prompt,
            self.system_prompt_snippet()
        )
    }
}

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
    /// Stage 4: synthesis guidance generated by the planner.
    /// Tells the synthesizer how to combine step results into a final answer.
    #[serde(default)]
    pub synthesis_prompt: String,
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
    /// Stage 1: IDs of steps that must complete before this one can start.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Reflections accumulated across retry attempts (Reflexion pattern).
    /// Each entry is a brief LLM-generated note: "what went wrong and what to try differently."
    #[serde(default)]
    pub reflections: Vec<String>,
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
            synthesis_prompt: String::new(),
        }
    }

    #[allow(dead_code)]
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
