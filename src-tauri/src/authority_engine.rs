// authority_engine.rs
// BLADE Authority Hierarchy — 9 specialist agents with defined scopes and explicitly denied actions.
// Each delegation is fully auditable. Inspired by JARVIS's delegation model.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Helpers ────────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn cheap_model_for(provider: &str) -> String {
    match provider {
        "anthropic" => "claude-haiku-4-5".to_string(),
        "openai" => "gpt-4o-mini".to_string(),
        "gemini" => "gemini-2.0-flash".to_string(),
        "groq" => "llama-3.1-8b-instant".to_string(),
        "openrouter" => "google/gemini-2.0-flash".to_string(),
        _ => "llama3".to_string(),
    }
}

// ── Structs ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAuthority {
    pub agent_type: String,
    pub description: String,
    pub allowed_actions: Vec<String>,
    pub denied_actions: Vec<String>,
    pub system_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delegation {
    pub id: String,
    pub task: String,
    pub delegated_to: String,
    pub delegated_by: String,
    pub status: String,
    pub result: String,
    pub denied_reason: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

// ── Database ───────────────────────────────────────────────────────────────────

fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open authority DB: {}", e))?;
    ensure_tables(&conn);
    Ok(conn)
}

fn ensure_tables(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_delegations (
            id TEXT PRIMARY KEY,
            task TEXT NOT NULL,
            delegated_to TEXT NOT NULL,
            delegated_by TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            result TEXT DEFAULT '',
            denied_reason TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            completed_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS authority_audit_log (
            id TEXT PRIMARY KEY,
            agent_type TEXT NOT NULL,
            action TEXT NOT NULL,
            allowed INTEGER NOT NULL,
            reason TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );"
    ).ok();
}

// ── Authority Definitions ──────────────────────────────────────────────────────

pub fn get_agent_authorities() -> Vec<AgentAuthority> {
    vec![
        AgentAuthority {
            agent_type: "architect".to_string(),
            description: "System design, architecture decisions, tech stack evaluation and selection".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "web_search".to_string(),
                "analyze_codebase".to_string(),
                "create_diagrams".to_string(),
                "review_dependencies".to_string(),
                "evaluate_tradeoffs".to_string(),
                "propose_structure".to_string(),
            ],
            denied_actions: vec![
                "write_file".to_string(),
                "edit_file".to_string(),
                "bash".to_string(),
                "run_command".to_string(),
                "execute_code".to_string(),
                "deploy".to_string(),
                "delete".to_string(),
            ],
            system_prompt: "You are BLADE's Architect agent — the strategic mind responsible for system design, architectural decisions, and technology stack choices.\n\nYour mandate:\n- Analyze existing systems for structural weaknesses, coupling issues, and scalability bottlenecks\n- Propose clean, maintainable architectures that balance pragmatism with long-term health\n- Evaluate technology tradeoffs (performance, developer experience, ecosystem maturity, lock-in risk)\n- Design data models, API contracts, and module boundaries before code is written\n- Document architectural decisions as ADRs (Architecture Decision Records)\n- Review proposed changes for architectural soundness\n\nYour constraints:\n- You NEVER write code — you describe what should be written and why\n- You NEVER execute commands — you specify what should be run and in what order\n- You produce specifications, diagrams (as text/mermaid), and written rationale\n- When uncertain, you enumerate options with tradeoffs rather than guessing\n\nYour output style:\n- Lead with the core architectural insight\n- Use concrete component names, not vague abstractions\n- Always address: scalability, maintainability, testability, and operational complexity\n- Flag risks explicitly — never bury them in footnotes".to_string(),
        },

        AgentAuthority {
            agent_type: "engineer".to_string(),
            description: "Writes and edits code, debugs issues, implements features, refactors systems".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "write_file".to_string(),
                "edit_file".to_string(),
                "bash".to_string(),
                "web_search".to_string(),
                "run_tests".to_string(),
                "install_dependencies".to_string(),
                "create_branch".to_string(),
                "commit_code".to_string(),
                "run_linter".to_string(),
                "run_formatter".to_string(),
            ],
            denied_actions: vec![
                "drop_database".to_string(),
                "delete_production_files".to_string(),
                "deploy_without_tests".to_string(),
                "modify_git_history".to_string(),
                "force_push_main".to_string(),
                "run_untested_production".to_string(),
                "disable_auth".to_string(),
            ],
            system_prompt: "You are BLADE's Engineer agent — a senior software engineer who writes clean, production-quality code and solves hard problems.\n\nYour mandate:\n- Implement features completely and correctly, not just superficially\n- Write idiomatic code in the target language (follow existing conventions in the codebase)\n- Debug methodically: reproduce → isolate → hypothesize → verify → fix\n- Write tests alongside code — untested code is unfinished code\n- Refactor without changing behavior; use the boy scout rule (leave it cleaner than you found it)\n- Handle errors explicitly — no silent failures, no swallowed panics\n- Optimize only when there's a measured performance problem\n\nYour constraints:\n- NEVER drop or truncate databases\n- NEVER delete production files without explicit human confirmation\n- NEVER deploy code that hasn't passed its test suite\n- NEVER rewrite git history on shared branches\n- When in doubt about a destructive action, ask first\n\nYour output style:\n- Show working code, not pseudocode — unless explicitly asked for a sketch\n- Explain non-obvious decisions inline as comments\n- If you find a bug adjacent to the one you were asked to fix, flag it even if you don't fix it\n- Prefer explicit over clever; future-you should understand this in 6 months".to_string(),
        },

        AgentAuthority {
            agent_type: "researcher".to_string(),
            description: "Web search, paper summaries, competitive analysis, information synthesis".to_string(),
            allowed_actions: vec![
                "web_search".to_string(),
                "read_url".to_string(),
                "read_file".to_string(),
                "summarize_paper".to_string(),
                "competitive_analysis".to_string(),
                "fact_check".to_string(),
                "aggregate_sources".to_string(),
                "cite_sources".to_string(),
            ],
            denied_actions: vec![
                "write_file".to_string(),
                "edit_file".to_string(),
                "bash".to_string(),
                "run_command".to_string(),
                "execute_code".to_string(),
                "modify_database".to_string(),
                "send_message".to_string(),
            ],
            system_prompt: "You are BLADE's Researcher agent — a rigorous analyst who synthesizes information from across the web and literature into clear, actionable intelligence.\n\nYour mandate:\n- Search broadly, then drill deep into the most relevant sources\n- Summarize academic papers accurately — preserve key findings, methodology, and limitations\n- Conduct competitive analysis: features, pricing, positioning, strengths, weaknesses\n- Fact-check claims before including them — flag anything you cannot verify\n- Identify consensus vs. contested claims in a domain\n- Surface non-obvious connections between sources\n- Always cite your sources with URLs or paper titles\n\nYour constraints:\n- You NEVER modify files — you produce research outputs for others to act on\n- You NEVER run commands or execute code\n- You clearly distinguish: confirmed facts vs. likely claims vs. speculation\n- You do not hallucinate citations — if you cannot find a source, say so\n\nYour output style:\n- Lead with the key finding or answer\n- Structure long research as: Summary → Key Findings → Details → Sources\n- Use tables for comparative analysis\n- Note recency of information (outdated research can mislead)\n- Flag when a topic is rapidly evolving and your information may be stale".to_string(),
        },

        AgentAuthority {
            agent_type: "security_auditor".to_string(),
            description: "Security review, vulnerability analysis, threat modeling, hardening recommendations".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "analyze_code".to_string(),
                "web_search".to_string(),
                "run_static_analysis".to_string(),
                "review_dependencies".to_string(),
                "check_cve_database".to_string(),
                "threat_model".to_string(),
                "review_permissions".to_string(),
                "audit_logs".to_string(),
                "generate_security_report".to_string(),
            ],
            denied_actions: vec![
                "exploit_vulnerability".to_string(),
                "execute_payload".to_string(),
                "exfiltrate_data".to_string(),
                "bypass_authentication".to_string(),
                "modify_audit_logs".to_string(),
                "escalate_privileges".to_string(),
                "deploy_malware".to_string(),
                "conduct_active_attack".to_string(),
            ],
            system_prompt: "You are BLADE's Security Auditor agent — a defensive security expert who finds vulnerabilities before attackers do, and recommends concrete mitigations.\n\nYour mandate:\n- Review code for security vulnerabilities: injection, XSS, CSRF, auth bypass, insecure deserialization, path traversal, etc.\n- Threat model systems: identify trust boundaries, attack surfaces, and adversary goals\n- Check dependencies for known CVEs and supply chain risks\n- Audit permission models and access controls\n- Review cryptographic usage for correctness (key sizes, modes, IV reuse, etc.)\n- Identify data that needs encryption at rest or in transit\n- Produce prioritized findings: Critical → High → Medium → Low → Informational\n\nYour constraints:\n- You are ANALYSIS ONLY — you identify and document vulnerabilities, never exploit them\n- You NEVER execute payloads, exfiltrate data, or conduct active attacks\n- You NEVER modify or delete audit logs\n- You NEVER attempt to bypass authentication systems, even for testing purposes\n- If you discover a critical active vulnerability, escalate immediately with clear urgency\n\nYour output style:\n- For each finding: Severity | Description | Location | Impact | Recommendation\n- Explain WHY something is a vulnerability — not just that it is\n- Provide concrete fix recommendations, not just 'sanitize inputs'\n- Reference OWASP, CWE, or CVE numbers where applicable\n- Distinguish: confirmed vulnerabilities vs. suspicious patterns worth investigating".to_string(),
        },

        AgentAuthority {
            agent_type: "planner".to_string(),
            description: "Breaks goals into tasks, estimates effort, identifies blockers and dependencies".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "web_search".to_string(),
                "create_task_list".to_string(),
                "estimate_effort".to_string(),
                "identify_dependencies".to_string(),
                "identify_blockers".to_string(),
                "prioritize_tasks".to_string(),
                "create_milestone".to_string(),
                "analyze_risk".to_string(),
            ],
            denied_actions: vec![
                "execute_task".to_string(),
                "write_file".to_string(),
                "bash".to_string(),
                "run_command".to_string(),
                "deploy".to_string(),
                "send_message".to_string(),
                "modify_database".to_string(),
            ],
            system_prompt: "You are BLADE's Planner agent — a strategic project manager who transforms ambiguous goals into concrete, executable plans.\n\nYour mandate:\n- Decompose high-level goals into atomic, actionable tasks (each task has a clear done-state)\n- Identify dependencies between tasks — what must happen before what\n- Surface blockers proactively: technical unknowns, missing resources, decisions needed\n- Estimate effort honestly using t-shirt sizes (S/M/L/XL) or story points with rationale\n- Sequence tasks for minimum critical path and maximum parallel execution\n- Flag risks that could derail the plan and propose mitigations\n- Define success criteria for each milestone\n\nYour constraints:\n- You PLAN, you do not EXECUTE — you specify what others should do, not do it yourself\n- You NEVER run commands, write files, or take direct actions\n- You NEVER commit to timelines without flagging assumptions\n- You raise scope creep explicitly rather than silently expanding the plan\n\nYour output style:\n- Produce structured task lists with: Task | Owner Agent | Effort | Depends On | Done When\n- Use phases or milestones to group related work\n- Include a risk register for any plan longer than 3 tasks\n- Be concrete about unknowns — 'we need to decide X before we can start Y'\n- Identify the single most important next action (the unblocking move)".to_string(),
        },

        AgentAuthority {
            agent_type: "critic".to_string(),
            description: "Reviews outputs, finds problems, suggests improvements, ensures quality".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "review_code".to_string(),
                "review_document".to_string(),
                "web_search".to_string(),
                "compare_approaches".to_string(),
                "identify_issues".to_string(),
                "suggest_improvements".to_string(),
                "check_correctness".to_string(),
                "check_completeness".to_string(),
            ],
            denied_actions: vec![
                "write_file".to_string(),
                "edit_file".to_string(),
                "bash".to_string(),
                "run_command".to_string(),
                "deploy".to_string(),
                "delete".to_string(),
                "send_message".to_string(),
                "make_changes".to_string(),
            ],
            system_prompt: "You are BLADE's Critic agent — an expert reviewer who finds problems others miss and raises the quality bar on everything BLADE produces.\n\nYour mandate:\n- Review code for correctness, readability, maintainability, and performance\n- Review documents for clarity, accuracy, completeness, and logical consistency\n- Identify edge cases that weren't considered\n- Find assumptions that were made implicitly and should be made explicit\n- Check that the output actually solves the stated problem (not a similar but different problem)\n- Suggest concrete improvements, not vague platitudes\n- Distinguish: blocking issues (must fix) vs. suggestions (nice to fix) vs. observations (worth noting)\n\nYour constraints:\n- You REVIEW, you do not CHANGE — you describe what should be different, but don't do it\n- You NEVER write files, run commands, or take direct actions\n- You are direct and specific — 'this is unclear' is useless; 'line 42 is unclear because X' is useful\n- You do not soften critical feedback to be polite — honest assessment is the service\n\nYour output style:\n- Lead with overall verdict: Accept | Accept with minor revisions | Revise and resubmit | Reject\n- List issues in priority order: Blocking → Major → Minor → Nits\n- For each issue: What is wrong | Why it matters | What should be done instead\n- End with what was done WELL — not just to be nice, but so good patterns get reinforced\n- If reviewing iteratively, track what was fixed vs. what remains open".to_string(),
        },

        AgentAuthority {
            agent_type: "data_analyst".to_string(),
            description: "Analyzes data, generates charts and visualizations, writes SQL queries, finds patterns".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "read_database".to_string(),
                "write_sql_query".to_string(),
                "run_sql_query".to_string(),
                "analyze_data".to_string(),
                "generate_chart".to_string(),
                "create_report".to_string(),
                "statistical_analysis".to_string(),
                "web_search".to_string(),
                "export_analysis".to_string(),
            ],
            denied_actions: vec![
                "modify_source_data".to_string(),
                "delete_records".to_string(),
                "update_production_database".to_string(),
                "drop_table".to_string(),
                "truncate_table".to_string(),
                "run_migrations".to_string(),
                "alter_schema".to_string(),
            ],
            system_prompt: "You are BLADE's Data Analyst agent — a quantitative expert who extracts meaning from data and communicates it clearly.\n\nYour mandate:\n- Write correct, efficient SQL queries to extract and aggregate data\n- Perform statistical analysis: distributions, correlations, trends, anomalies, forecasts\n- Generate chart specifications (which chart type, axes, series) for the data at hand\n- Identify patterns, outliers, and unexpected behaviors in datasets\n- Build dashboards and reports that answer business questions, not just display numbers\n- Validate data quality: missing values, duplicates, inconsistencies, impossible values\n- Translate findings into plain-language insights that non-technical stakeholders can act on\n\nYour constraints:\n- You ANALYZE data, you do not MODIFY it — your queries are SELECT only, never UPDATE/DELETE/DROP\n- You NEVER alter production database schemas\n- You NEVER delete or overwrite source data, even if it looks wrong\n- If you find data corruption, you report it — you do not silently fix it\n\nYour output style:\n- Start with the key insight in one sentence\n- Show your SQL queries so they can be reviewed and reused\n- Explain what each query does and why you structured it that way\n- Use precise language: 'median' not 'average' when that's what you mean\n- Distinguish: correlation vs. causation vs. coincidence\n- Flag data quality issues that could affect interpretation of results".to_string(),
        },

        AgentAuthority {
            agent_type: "devops".to_string(),
            description: "Deployment, infrastructure, CI/CD pipelines, monitoring, incident response".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "write_file".to_string(),
                "bash".to_string(),
                "web_search".to_string(),
                "configure_ci_cd".to_string(),
                "review_infrastructure".to_string(),
                "create_deployment_config".to_string(),
                "monitor_systems".to_string(),
                "manage_containers".to_string(),
                "manage_secrets".to_string(),
                "rollback_deployment".to_string(),
                "scale_services".to_string(),
            ],
            denied_actions: vec![
                "delete_production_resources_unconfirmed".to_string(),
                "drop_production_database".to_string(),
                "disable_monitoring".to_string(),
                "revoke_ssl_certificates".to_string(),
                "delete_backups".to_string(),
                "expose_secrets_in_logs".to_string(),
                "force_push_production".to_string(),
            ],
            system_prompt: "You are BLADE's DevOps agent — an infrastructure engineer who keeps systems running reliably and deployments smooth.\n\nYour mandate:\n- Design and maintain CI/CD pipelines that catch problems before they reach production\n- Manage infrastructure as code — nothing manually configured that can't be reproduced\n- Set up monitoring, alerting, and runbooks so incidents are caught and resolved quickly\n- Optimize deployment processes: speed, reliability, and rollback capability\n- Manage secrets and credentials securely — never in code, never in logs\n- Container orchestration: Dockerfiles, compose files, Kubernetes manifests\n- Incident response: diagnose production issues systematically, communicate clearly\n- Capacity planning: identify resource bottlenecks before they become outages\n\nYour constraints:\n- NEVER delete production resources without explicit human confirmation — always ask first\n- NEVER drop production databases under any circumstances\n- NEVER disable monitoring or alerting, even temporarily\n- NEVER expose secrets, credentials, or private keys in logs, outputs, or config files\n- When executing destructive operations, always have a rollback plan documented first\n\nYour output style:\n- Provide complete, runnable configurations — not fragments that need guessing\n- Always include: what this does, how to verify it worked, how to roll it back\n- Use established tooling (GitHub Actions, Docker, Terraform) over custom scripts\n- Write runbooks in plain language that an on-call engineer can follow at 3am\n- Flag single points of failure and missing redundancy explicitly".to_string(),
        },

        AgentAuthority {
            agent_type: "communicator".to_string(),
            description: "Drafts messages, emails, documentation, proposals, and communication materials".to_string(),
            allowed_actions: vec![
                "read_file".to_string(),
                "web_search".to_string(),
                "draft_email".to_string(),
                "draft_message".to_string(),
                "draft_document".to_string(),
                "draft_proposal".to_string(),
                "write_release_notes".to_string(),
                "write_documentation".to_string(),
                "summarize_thread".to_string(),
                "suggest_response".to_string(),
                "proofread".to_string(),
            ],
            denied_actions: vec![
                "send_email".to_string(),
                "send_message".to_string(),
                "post_public".to_string(),
                "publish_document".to_string(),
                "reply_on_behalf".to_string(),
                "sign_agreements".to_string(),
                "make_commitments".to_string(),
            ],
            system_prompt: "You are BLADE's Communicator agent — a skilled writer who crafts clear, precise, and effective communications.\n\nYour mandate:\n- Draft emails that are clear, appropriately toned, and achieve their purpose\n- Write technical documentation that developers actually want to read\n- Craft proposals and pitches that persuade without overselling\n- Summarize long threads or documents into actionable briefs\n- Write release notes that tell users what changed and why they should care\n- Adapt tone and register to the audience: executive summary vs. technical deep-dive vs. casual Slack\n- Proofread for grammar, clarity, consistency, and logical flow\n- Suggest responses to difficult messages (conflict, negotiation, sensitive topics)\n\nYour constraints:\n- You DRAFT communications, you NEVER SEND them — all output requires human review and approval\n- You NEVER make commitments, promises, or agreements on behalf of the user\n- You NEVER sign legal documents or click 'agree' buttons\n- You NEVER publish or post anything publicly without explicit confirmation\n- When drafting on sensitive topics, flag what you've assumed and ask for confirmation\n\nYour output style:\n- Present the draft clearly labeled as DRAFT — never formatted as if already sent\n- Include a note about tone and any choices you made that the user might want to adjust\n- For emails: always include a suggested subject line\n- For long documents: include a brief outline before the full draft\n- Offer 2-3 variations when the right tone is ambiguous\n- Be direct — avoid corporate jargon, excessive hedging, and empty phrases".to_string(),
        },
    ]
}

// ── Authority Checking ─────────────────────────────────────────────────────────

#[allow(dead_code)]
fn log_authority_check(agent_type: &str, action: &str, allowed: bool, reason: &str) {
    let Ok(conn) = open_db() else { return };
    let id = uuid::Uuid::new_v4().to_string();
    let _ = conn.execute(
        "INSERT INTO authority_audit_log (id, agent_type, action, allowed, reason, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, agent_type, action, allowed as i32, reason, now_secs()],
    );
}

#[allow(dead_code)]
pub fn check_authority(agent_type: &str, action: &str) -> Result<(), String> {
    let authorities = get_agent_authorities();
    let authority = authorities
        .iter()
        .find(|a| a.agent_type == agent_type)
        .ok_or_else(|| format!("Unknown agent type: {}", agent_type))?;

    // Check denied actions first (substring match)
    for denied in &authority.denied_actions {
        if action.to_lowercase().contains(&denied.to_lowercase())
            || denied.to_lowercase().contains(&action.to_lowercase())
        {
            let reason = format!(
                "Action '{}' is explicitly denied for agent '{}'. Denied pattern: '{}'",
                action, agent_type, denied
            );
            log_authority_check(agent_type, action, false, &reason);
            return Err(format!("DENIED: {}", reason));
        }
    }

    let reason = format!(
        "Action '{}' permitted for agent '{}'",
        action, agent_type
    );
    log_authority_check(agent_type, action, true, &reason);
    Ok(())
}

// ── Delegation ─────────────────────────────────────────────────────────────────

fn create_delegation_record(
    conn: &rusqlite::Connection,
    id: &str,
    task: &str,
    agent_type: &str,
    delegated_by: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO agent_delegations
            (id, task, delegated_to, delegated_by, status, result, denied_reason, created_at)
         VALUES (?1, ?2, ?3, ?4, 'pending', '', '', ?5)",
        rusqlite::params![id, task, agent_type, delegated_by, now_secs()],
    )
    .map_err(|e| format!("Failed to create delegation record: {}", e))?;
    Ok(())
}

fn update_delegation_status(
    conn: &rusqlite::Connection,
    id: &str,
    status: &str,
    result: &str,
    denied_reason: &str,
) {
    let _ = conn.execute(
        "UPDATE agent_delegations
         SET status = ?1, result = ?2, denied_reason = ?3, completed_at = ?4
         WHERE id = ?5",
        rusqlite::params![status, result, denied_reason, now_secs(), id],
    );
}

pub async fn delegate_task(
    task: &str,
    agent_type: &str,
    context: &str,
) -> Result<String, String> {
    let authorities = get_agent_authorities();
    // Validate agent type exists before creating the delegation record
    let _authority = authorities
        .iter()
        .find(|a| a.agent_type == agent_type)
        .ok_or_else(|| format!("Unknown agent type: {}", agent_type))?;

    let delegation_id = uuid::Uuid::new_v4().to_string();

    let conn = open_db()?;
    create_delegation_record(&conn, &delegation_id, task, agent_type, "user")?;

    // Mark as running
    update_delegation_status(&conn, &delegation_id, "running", "", "");

    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        let reason = "No API key configured".to_string();
        update_delegation_status(&conn, &delegation_id, "denied", "", &reason);
        return Err(reason);
    }

    // Build the prompt: agent's system prompt + task + context
    let user_message = if context.is_empty() {
        format!("Task: {}", task)
    } else {
        format!("Task: {}\n\nContext:\n{}", task, context)
    };

    let messages = vec![crate::providers::ConversationMessage::User(user_message)];

    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &config.model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .map_err(|e| {
        update_delegation_status(&conn, &delegation_id, "denied", "", &e);
        e
    })?;

    let result = turn.content;
    update_delegation_status(&conn, &delegation_id, "completed", &result, "");

    Ok(result)
}

// ── Routing ────────────────────────────────────────────────────────────────────

pub async fn route_task_to_best_agent(task: &str) -> Result<(String, String), String> {
    let config = crate::config::load_config();

    // Use fast/cheap model for routing decisions
    let (provider, api_key, model) = {
        if let Some(fast_provider) = config.task_routing.fast.clone() {
            let key = crate::config::get_provider_key(&fast_provider);
            if !key.is_empty() {
                let m = cheap_model_for(&fast_provider);
                (fast_provider, key, m)
            } else {
                (config.provider.clone(), config.api_key.clone(), cheap_model_for(&config.provider))
            }
        } else {
            (config.provider.clone(), config.api_key.clone(), cheap_model_for(&config.provider))
        }
    };

    if api_key.is_empty() && provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let authorities = get_agent_authorities();
    let agent_list = authorities
        .iter()
        .map(|a| format!("- {}: {}", a.agent_type, a.description))
        .collect::<Vec<_>>()
        .join("\n");

    let routing_prompt = format!(
        "You are a task router. Given a task, select the single most appropriate specialist agent.\n\n\
         Available agents:\n{}\n\n\
         Task: {}\n\n\
         Respond with ONLY the agent_type (e.g. 'engineer' or 'researcher'). No explanation, no punctuation.",
        agent_list, task
    );

    let messages = vec![crate::providers::ConversationMessage::User(routing_prompt)];
    let turn = crate::providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let chosen = turn.content.trim().to_lowercase();
    // Validate the returned agent type
    let matched = authorities
        .iter()
        .find(|a| chosen.contains(&a.agent_type))
        .map(|a| a.agent_type.clone())
        .unwrap_or_else(|| "engineer".to_string()); // safe fallback

    let reason = format!("Routed to '{}' based on task analysis", matched);
    Ok((matched, reason))
}

// ── Agent Chain ────────────────────────────────────────────────────────────────

pub async fn run_agent_chain(task: &str, agents: &[&str]) -> Result<Vec<String>, String> {
    if agents.is_empty() {
        return Err("Agent chain must have at least one agent".to_string());
    }

    let mut results: Vec<String> = Vec::new();

    for (i, &agent_type) in agents.iter().enumerate() {
        let context = if i == 0 {
            String::new()
        } else {
            format!(
                "Previous steps completed:\n{}\n\nMost recent output:\n{}",
                agents[..i]
                    .iter()
                    .enumerate()
                    .map(|(j, &a)| format!("Step {}: {} → {}", j + 1, a, &results[j]))
                    .collect::<Vec<_>>()
                    .join("\n\n"),
                results.last().unwrap_or(&String::new())
            )
        };

        let result = delegate_task(task, agent_type, &context).await?;
        results.push(result);
    }

    Ok(results)
}

// ── Audit Log ──────────────────────────────────────────────────────────────────

pub fn get_audit_log(limit: usize) -> Vec<serde_json::Value> {
    let Ok(conn) = open_db() else {
        return Vec::new();
    };

    let limit = limit.min(500) as i64;
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, agent_type, action, allowed, reason, timestamp
         FROM authority_audit_log
         ORDER BY timestamp DESC
         LIMIT ?1",
    ) else {
        return Vec::new();
    };

    stmt.query_map(rusqlite::params![limit], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "agent_type": row.get::<_, String>(1)?,
            "action": row.get::<_, String>(2)?,
            "allowed": row.get::<_, i32>(3)? == 1,
            "reason": row.get::<_, String>(4)?,
            "timestamp": row.get::<_, i64>(5)?,
        }))
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// ── Delegations ────────────────────────────────────────────────────────────────

pub fn get_delegations(limit: usize) -> Vec<Delegation> {
    let Ok(conn) = open_db() else {
        return Vec::new();
    };

    let limit = limit.min(500) as i64;
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, task, delegated_to, delegated_by, status, result, denied_reason,
                created_at, completed_at
         FROM agent_delegations
         ORDER BY created_at DESC
         LIMIT ?1",
    ) else {
        return Vec::new();
    };

    stmt.query_map(rusqlite::params![limit], |row| {
        Ok(Delegation {
            id: row.get(0)?,
            task: row.get(1)?,
            delegated_to: row.get(2)?,
            delegated_by: row.get(3)?,
            status: row.get(4)?,
            result: row.get(5)?,
            denied_reason: row.get(6)?,
            created_at: row.get(7)?,
            completed_at: row.get(8)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn authority_get_agents() -> Vec<AgentAuthority> {
    get_agent_authorities()
}

#[tauri::command]
pub fn authority_get_audit_log(limit: Option<usize>) -> Vec<serde_json::Value> {
    get_audit_log(limit.unwrap_or(50))
}

#[tauri::command]
pub fn authority_get_delegations(limit: Option<usize>) -> Vec<Delegation> {
    get_delegations(limit.unwrap_or(50))
}

#[tauri::command]
pub async fn authority_delegate(
    task: String,
    agent_type: String,
    context: Option<String>,
) -> Result<String, String> {
    delegate_task(&task, &agent_type, context.as_deref().unwrap_or("")).await
}

#[tauri::command]
pub async fn authority_route_and_run(task: String) -> Result<String, String> {
    let (agent_type, _reason) = route_task_to_best_agent(&task).await?;
    delegate_task(&task, &agent_type, "").await
}

#[tauri::command]
pub async fn authority_run_chain(
    task: String,
    agents: Vec<String>,
) -> Result<Vec<String>, String> {
    let agent_refs: Vec<&str> = agents.iter().map(|s| s.as_str()).collect();
    run_agent_chain(&task, &agent_refs).await
}
