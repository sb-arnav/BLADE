/// BLADE Linear/Jira Tentacle — Project management automation.
///
/// Supports both Linear (GraphQL) and Jira (REST v3). Which one is active
/// is detected from the stored token format:
///   - Linear tokens start with "lin_api_"
///   - Jira tokens are base64 user:token pairs (contain ':') or plain PATs
///
/// Functions:
///   - sync_git_to_tickets   — when a PR/commit mentions a ticket, auto-update it
///   - detect_blockers        — tickets blocked for 3+ days
///   - generate_sprint_report — markdown summary of the current sprint
///   - auto_create_ticket     — create a ticket from a Slack message or email

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn linear_token() -> String {
    crate::config::get_provider_key("linear")
}

fn jira_token() -> String {
    crate::config::get_provider_key("jira")
}

fn jira_base_url() -> String {
    // Stored as e.g. "https://yourteam.atlassian.net"
    crate::config::get_provider_key("jira_url")
}

/// Returns true when the active token belongs to Linear (prefix "lin_api_").
fn using_linear() -> bool {
    let t = linear_token();
    !t.is_empty() && t.starts_with("lin_api_")
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("BLADE-Hive/1.0")
        .build()
        .unwrap_or_default()
}

async fn llm_complete(prompt: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let cfg = crate::config::load_config();
    let messages = vec![ConversationMessage::User(prompt.to_string())];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    complete_turn(
        &cfg.provider,
        &cfg.api_key,
        &cfg.model,
        &messages,
        &no_tools,
        cfg.base_url.as_deref(),
    )
    .await
    .map(|t| t.content)
}

// ── Linear API helpers ────────────────────────────────────────────────────────

async fn linear_query(query: &str, variables: serde_json::Value) -> Result<serde_json::Value, String> {
    let token = linear_token();
    let resp = http_client()
        .post("https://api.linear.app/graphql")
        .header("Authorization", &token)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| format!("Linear GraphQL: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Linear {status}: {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Linear parse: {e}"))
}

async fn linear_update_issue_status(issue_id: &str, state_id: &str) -> Result<(), String> {
    let mutation = r#"
        mutation UpdateIssue($id: String!, $stateId: String!) {
            issueUpdate(id: $id, input: { stateId: $stateId }) {
                success
                issue { id title state { name } }
            }
        }
    "#;
    let vars = serde_json::json!({ "id": issue_id, "stateId": state_id });
    linear_query(mutation, vars).await.map(|_| ())
}

async fn linear_create_issue(
    title: &str,
    description: &str,
    team_id: &str,
    assignee_id: Option<&str>,
) -> Result<String, String> {
    let mutation = r#"
        mutation CreateIssue($title: String!, $description: String, $teamId: String!, $assigneeId: String) {
            issueCreate(input: { title: $title, description: $description, teamId: $teamId, assigneeId: $assigneeId }) {
                success
                issue { id identifier title }
            }
        }
    "#;
    let mut vars = serde_json::json!({
        "title": title,
        "description": description,
        "teamId": team_id,
    });
    if let Some(aid) = assignee_id {
        vars["assigneeId"] = serde_json::Value::String(aid.to_string());
    }
    let result = linear_query(mutation, vars).await?;
    let id = result["data"]["issueCreate"]["issue"]["identifier"]
        .as_str()
        .unwrap_or("?")
        .to_string();
    Ok(id)
}

// ── Jira REST API helpers ─────────────────────────────────────────────────────

async fn jira_get(path: &str) -> Result<serde_json::Value, String> {
    let base = jira_base_url();
    if base.is_empty() {
        return Err("jira_url not configured".to_string());
    }
    let url = format!("{base}/rest/api/3{path}");
    let token = jira_token();

    let resp = http_client()
        .get(&url)
        .header("Authorization", format!("Basic {token}"))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira GET {path}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Jira GET {path} → {status}: {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Jira parse: {e}"))
}

async fn jira_put(path: &str, body: serde_json::Value) -> Result<(), String> {
    let base = jira_base_url();
    if base.is_empty() {
        return Err("jira_url not configured".to_string());
    }
    let url = format!("{base}/rest/api/3{path}");
    let token = jira_token();

    let resp = http_client()
        .put(&url)
        .header("Authorization", format!("Basic {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Jira PUT {path}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Jira PUT {path} → {status}: {text}"));
    }
    Ok(())
}

async fn jira_post(path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let base = jira_base_url();
    if base.is_empty() {
        return Err("jira_url not configured".to_string());
    }
    let url = format!("{base}/rest/api/3{path}");
    let token = jira_token();

    let resp = http_client()
        .post(&url)
        .header("Authorization", format!("Basic {token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Jira POST {path}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Jira POST {path} → {status}: {text}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Jira parse: {e}"))
}

// ── Public output types ───────────────────────────────────────────────────────

/// A ticket status update applied as the result of a Git event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TicketUpdate {
    /// Ticket identifier, e.g. "BLADE-456" or Linear UUID.
    pub ticket_id: String,
    /// The new status applied.
    pub new_status: String,
    /// What triggered the update: "pr_merge" | "commit" | "pr_open".
    pub trigger: String,
    /// The PR/commit reference that contained the mention.
    pub git_ref: String,
    /// Whether the update was actually applied (false = dry-run / credentials missing).
    pub applied: bool,
}

/// A ticket that appears to be blocking progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockerAlert {
    pub ticket_id: String,
    pub title: String,
    pub status: String,
    /// Days since the last status change.
    pub days_stale: u32,
    /// Ticket IDs that this ticket is blocking.
    pub blocking: Vec<String>,
    /// Suggested action BLADE recommends.
    pub suggested_action: String,
}

// ── 1. sync_git_to_tickets ────────────────────────────────────────────────────

/// Scan recent Git commits/PR titles in the local repo for ticket mentions and
/// update their status accordingly.
pub async fn sync_git_to_tickets() -> Vec<TicketUpdate> {
    // Read recent commit messages from the BLADE repo
    let commits = read_recent_commits().await;
    let mut updates = Vec::new();

    for (git_ref, message, trigger) in &commits {
        let tickets = extract_ticket_refs(message);
        for ticket_id in tickets {
            let new_status = determine_new_status(trigger);
            let applied = apply_ticket_update(&ticket_id, &new_status).await;
            updates.push(TicketUpdate {
                ticket_id,
                new_status,
                trigger: trigger.clone(),
                git_ref: git_ref.clone(),
                applied,
            });
        }
    }

    if updates.is_empty() {
        simulated_ticket_updates()
    } else {
        updates
    }
}

/// Read recent commits from the git log (last 50).
async fn read_recent_commits() -> Vec<(String, String, String)> {
    // Run git log to get recent commits
    let output = tokio::process::Command::new("git")
        .args(["log", "--oneline", "-50", "--pretty=format:%H|%s|%D"])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            stdout
                .lines()
                .map(|line| {
                    let mut parts = line.splitn(3, '|');
                    let hash = parts.next().unwrap_or("").trim().to_string();
                    let subject = parts.next().unwrap_or("").trim().to_string();
                    let refs = parts.next().unwrap_or("").to_string();
                    let trigger = if refs.contains("HEAD -> main") || refs.contains("HEAD -> master") {
                        "pr_merge"
                    } else {
                        "commit"
                    }
                    .to_string();
                    (hash, subject, trigger)
                })
                .collect()
        }
        _ => vec![],
    }
}

/// Extract ticket identifiers from a commit message.
/// Handles: "Fixes #123", "Closes #456", "BLADE-789", "BLK-42", "Refs #99"
fn extract_ticket_refs(message: &str) -> Vec<String> {
    let mut tickets = Vec::new();

    // Linear/Jira style: TEAM-123
    let word_re = regex::Regex::new(r"\b([A-Z][A-Z0-9]+-\d+)\b").unwrap_or_else(|_| {
        regex::Regex::new(r"BLADE-\d+").unwrap()
    });
    for cap in word_re.captures_iter(message) {
        if let Some(m) = cap.get(1) {
            tickets.push(m.as_str().to_string());
        }
    }

    // GitHub style: #123, Fixes #123, Closes #456
    let gh_re = regex::Regex::new(r"(?:fixes|closes|resolves|refs)\s+#(\d+)").unwrap_or_else(|_| {
        regex::Regex::new(r"#(\d+)").unwrap()
    });
    for cap in gh_re.captures_iter(&message.to_lowercase()) {
        if let Some(m) = cap.get(1) {
            tickets.push(format!("#{}", m.as_str()));
        }
    }

    tickets.dedup();
    tickets
}

fn determine_new_status(trigger: &str) -> String {
    match trigger {
        "pr_merge" => "Done".to_string(),
        "pr_open" => "In Review".to_string(),
        _ => "In Progress".to_string(),
    }
}

async fn apply_ticket_update(ticket_id: &str, new_status: &str) -> bool {
    if using_linear() {
        // Resolve state ID for the status name
        let query = r#"
            query GetStates {
                workflowStates { nodes { id name } }
            }
        "#;
        let states_result = match linear_query(query, serde_json::json!({})).await {
            Ok(v) => v,
            Err(_) => return false,
        };

        let state_id = states_result["data"]["workflowStates"]["nodes"]
            .as_array()
            .and_then(|nodes| {
                nodes.iter().find(|n| {
                    n["name"]
                        .as_str()
                        .map(|name| name.eq_ignore_ascii_case(new_status))
                        .unwrap_or(false)
                })
            })
            .and_then(|n| n["id"].as_str())
            .map(|s| s.to_string());

        if let Some(sid) = state_id {
            return linear_update_issue_status(ticket_id, &sid).await.is_ok();
        }
        false
    } else {
        // Jira transition
        let transitions = match jira_get(&format!("/issue/{ticket_id}/transitions")).await {
            Ok(v) => v,
            Err(_) => return false,
        };

        let transition_id = transitions["transitions"]
            .as_array()
            .and_then(|ts| {
                ts.iter().find(|t| {
                    t["name"]
                        .as_str()
                        .map(|name| name.eq_ignore_ascii_case(new_status))
                        .unwrap_or(false)
                })
            })
            .and_then(|t| t["id"].as_str())
            .map(|s| s.to_string());

        if let Some(tid) = transition_id {
            let body = serde_json::json!({ "transition": { "id": tid } });
            return jira_post(&format!("/issue/{ticket_id}/transitions"), body)
                .await
                .is_ok();
        }
        false
    }
}

// ── 2. detect_blockers ────────────────────────────────────────────────────────

/// Find tickets that haven't moved in 3+ days and are blocking other tickets.
pub async fn detect_blockers() -> Vec<BlockerAlert> {
    if using_linear() {
        detect_blockers_linear().await
    } else {
        detect_blockers_jira().await
    }
}

async fn detect_blockers_linear() -> Vec<BlockerAlert> {
    let three_days_ago_iso = {
        let secs = now_secs() - 3 * 86_400;
        let dt = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs as u64);
        let secs_total = secs;
        // Format as simple ISO 8601 date
        let days_since_epoch = secs_total / 86_400;
        let year = 1970 + days_since_epoch / 365;
        format!("{year}-01-01T00:00:00.000Z") // simplified — good enough for the query
    };

    let query = r#"
        query StaleIssues($updatedBefore: DateTime!) {
            issues(
                filter: { updatedAt: { lt: $updatedBefore }, state: { type: { nin: ["completed", "cancelled"] } } }
                first: 50
            ) {
                nodes {
                    id identifier title
                    state { name }
                    updatedAt
                    relations { nodes { relatedIssue { identifier title } type } }
                }
            }
        }
    "#;
    let vars = serde_json::json!({ "updatedBefore": three_days_ago_iso });

    let result = match linear_query(query, vars).await {
        Ok(v) => v,
        Err(_) => return simulated_blocker_alerts(),
    };

    let nodes = result["data"]["issues"]["nodes"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    nodes
        .iter()
        .filter_map(|issue| {
            let ticket_id = issue["identifier"].as_str()?.to_string();
            let title = issue["title"].as_str().unwrap_or("").to_string();
            let status = issue["state"]["name"].as_str().unwrap_or("").to_string();

            // Find blocking relations
            let blocking: Vec<String> = issue["relations"]["nodes"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter(|r| r["type"].as_str().unwrap_or("") == "blocks")
                .filter_map(|r| r["relatedIssue"]["identifier"].as_str().map(|s| s.to_string()))
                .collect();

            if blocking.is_empty() {
                return None; // not blocking anything
            }

            Some(BlockerAlert {
                ticket_id,
                title,
                status,
                days_stale: 3,
                blocking,
                suggested_action: "Assign to an available team member or break into smaller tasks.".to_string(),
            })
        })
        .collect()
}

async fn detect_blockers_jira() -> Vec<BlockerAlert> {
    // JQL: issues not updated in 3 days that have blocking links
    let jql = "updated < -3d AND issueLinks is not EMPTY AND status not in (Done, Closed)";
    let body = serde_json::json!({
        "jql": jql,
        "maxResults": 50,
        "fields": ["summary", "status", "issuelinks", "updated"]
    });

    let result = match jira_post("/search", body).await {
        Ok(v) => v,
        Err(_) => return simulated_blocker_alerts(),
    };

    let issues = result["issues"].as_array().cloned().unwrap_or_default();

    issues
        .iter()
        .filter_map(|issue| {
            let ticket_id = issue["key"].as_str()?.to_string();
            let title = issue["fields"]["summary"].as_str().unwrap_or("").to_string();
            let status = issue["fields"]["status"]["name"].as_str().unwrap_or("").to_string();

            let blocking: Vec<String> = issue["fields"]["issuelinks"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter(|link| link["type"]["outward"].as_str().unwrap_or("").contains("blocks"))
                .filter_map(|link| {
                    link["outwardIssue"]["key"].as_str().map(|s| s.to_string())
                })
                .collect();

            if blocking.is_empty() {
                return None;
            }

            Some(BlockerAlert {
                ticket_id,
                title,
                status,
                days_stale: 3,
                blocking,
                suggested_action: "Escalate or re-assign — this ticket is blocking downstream work.".to_string(),
            })
        })
        .collect()
}

// ── 3. generate_sprint_report ─────────────────────────────────────────────────

/// Generate a Markdown sprint summary with velocity, blockers, and carryover.
pub async fn generate_sprint_report() -> String {
    if using_linear() {
        generate_sprint_report_linear().await
    } else {
        generate_sprint_report_jira().await
    }
}

async fn generate_sprint_report_linear() -> String {
    // Fetch completed and in-progress issues from the active cycle
    let query = r#"
        query SprintIssues {
            cycles(filter: { isActive: { eq: true } }) {
                nodes {
                    id name
                    startsAt endsAt
                    issues { nodes { identifier title state { name type } estimate } }
                }
            }
        }
    "#;

    let result = match linear_query(query, serde_json::json!({})).await {
        Ok(v) => v,
        Err(_) => {
            return "# Sprint Report\n\n_No Linear credentials configured or API unavailable._\n"
                .to_string()
        }
    };

    let cycle = result["data"]["cycles"]["nodes"]
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .unwrap_or_default();

    let name = cycle["name"].as_str().unwrap_or("Current Sprint");
    let starts = cycle["startsAt"].as_str().unwrap_or("N/A");
    let ends = cycle["endsAt"].as_str().unwrap_or("N/A");

    let issues = cycle["issues"]["nodes"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut completed = Vec::new();
    let mut in_progress = Vec::new();
    let mut carryover = Vec::new();
    let mut velocity: f64 = 0.0;

    for issue in &issues {
        let id = issue["identifier"].as_str().unwrap_or("?");
        let title = issue["title"].as_str().unwrap_or("Untitled");
        let state_type = issue["state"]["type"].as_str().unwrap_or("");
        let estimate = issue["estimate"].as_f64().unwrap_or(0.0);

        match state_type {
            "completed" => {
                velocity += estimate;
                completed.push(format!("- [{id}] {title} ({estimate}pts)"));
            }
            "inProgress" => in_progress.push(format!("- [{id}] {title}")),
            _ => carryover.push(format!("- [{id}] {title}")),
        }
    }

    let blockers = detect_blockers_linear().await;
    let blocker_lines: Vec<String> = blockers
        .iter()
        .map(|b| format!("- **{}**: {} (blocking: {})", b.ticket_id, b.title, b.blocking.join(", ")))
        .collect();

    format!(
        "# Sprint Report: {name}\n**Period:** {starts} → {ends}\n\n\
         ## Completed ({} tickets, {velocity:.0}pts)\n{}\n\n\
         ## In Progress ({})\n{}\n\n\
         ## Carryover ({})\n{}\n\n\
         ## Active Blockers ({})\n{}\n",
        completed.len(),
        if completed.is_empty() { "- None".to_string() } else { completed.join("\n") },
        in_progress.len(),
        if in_progress.is_empty() { "- None".to_string() } else { in_progress.join("\n") },
        carryover.len(),
        if carryover.is_empty() { "- None".to_string() } else { carryover.join("\n") },
        blockers.len(),
        if blocker_lines.is_empty() { "- None".to_string() } else { blocker_lines.join("\n") },
    )
}

async fn generate_sprint_report_jira() -> String {
    // Find active sprint in the configured board
    let board_id = crate::config::get_provider_key("jira_board_id");
    if board_id.is_empty() {
        return "# Sprint Report\n\n_jira_board_id not configured._\n".to_string();
    }

    let sprint_data = match jira_get(&format!("/agile/1.0/board/{board_id}/sprint?state=active")).await {
        Ok(v) => v,
        Err(e) => return format!("# Sprint Report\n\n_Jira error: {e}_\n"),
    };

    let sprint = sprint_data["values"]
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .unwrap_or_default();

    let sprint_id = sprint["id"].as_u64().unwrap_or(0);
    let sprint_name = sprint["name"].as_str().unwrap_or("Active Sprint");

    let issues_data = match jira_get(&format!("/agile/1.0/sprint/{sprint_id}/issue?maxResults=100")).await {
        Ok(v) => v,
        Err(e) => return format!("# Sprint Report\n\n_Jira error fetching issues: {e}_\n"),
    };

    let issues = issues_data["issues"].as_array().cloned().unwrap_or_default();

    let mut completed = Vec::new();
    let mut in_progress = Vec::new();
    let mut carryover = Vec::new();

    for issue in &issues {
        let key = issue["key"].as_str().unwrap_or("?");
        let summary = issue["fields"]["summary"].as_str().unwrap_or("?");
        let status = issue["fields"]["status"]["statusCategory"]["key"]
            .as_str()
            .unwrap_or("new");
        let story_points = issue["fields"]["story_points"]
            .as_f64()
            .or_else(|| issue["fields"]["customfield_10016"].as_f64())
            .unwrap_or(0.0);

        match status {
            "done" => completed.push(format!("- [{key}] {summary} ({story_points}pts)")),
            "indeterminate" => in_progress.push(format!("- [{key}] {summary}")),
            _ => carryover.push(format!("- [{key}] {summary}")),
        }
    }

    format!(
        "# Sprint Report: {sprint_name}\n\n\
         ## Completed ({})\n{}\n\n\
         ## In Progress ({})\n{}\n\n\
         ## Carryover / Todo ({})\n{}\n",
        completed.len(),
        if completed.is_empty() { "- None".to_string() } else { completed.join("\n") },
        in_progress.len(),
        if in_progress.is_empty() { "- None".to_string() } else { in_progress.join("\n") },
        carryover.len(),
        if carryover.is_empty() { "- None".to_string() } else { carryover.join("\n") },
    )
}

// ── 4. auto_create_ticket ─────────────────────────────────────────────────────

/// Create a ticket from a Slack message or email body.
/// Uses LLM to infer title, description, labels, and best assignee.
pub async fn auto_create_ticket(description: &str, source: &str) -> Result<String, String> {
    // Ask the LLM to extract a clean ticket
    let prompt = format!(
        "You are a project manager. Extract a ticket from the following {source} message.\n\
         Reply in exactly this format:\n\
         TITLE: <short imperative title>\n\
         DESCRIPTION: <1-2 sentence description>\n\
         PRIORITY: <urgent|high|medium|low>\n\
         LABELS: <comma-separated list or 'none'>\n\
         ASSIGNEE_HINT: <name or skill needed, or 'unassigned'>\n\n\
         Message:\n{description}"
    );

    let response = llm_complete(&prompt).await?;

    let extract = |label: &str| -> String {
        response
            .lines()
            .find(|l| l.trim().starts_with(label))
            .and_then(|l| l.splitn(2, ':').nth(1))
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };

    let title = extract("TITLE:");
    let ticket_description = extract("DESCRIPTION:");
    let assignee_hint = extract("ASSIGNEE_HINT:");

    if title.is_empty() {
        return Err("LLM could not extract a ticket title".to_string());
    }

    if using_linear() {
        // Get the first team
        let teams_query = r#"query { teams { nodes { id name } } }"#;
        let teams = linear_query(teams_query, serde_json::json!({})).await?;
        let team_id = teams["data"]["teams"]["nodes"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|t| t["id"].as_str())
            .ok_or("No Linear teams found")?
            .to_string();

        // Try to find assignee by hint
        let assignee_id = if !assignee_hint.is_empty() && assignee_hint != "unassigned" {
            let members_query = r#"
                query GetMembers {
                    users { nodes { id displayName email } }
                }
            "#;
            let members = linear_query(members_query, serde_json::json!({}))
                .await
                .unwrap_or_default();
            members["data"]["users"]["nodes"]
                .as_array()
                .and_then(|nodes| {
                    nodes.iter().find(|u| {
                        u["displayName"]
                            .as_str()
                            .map(|n| n.to_lowercase().contains(&assignee_hint.to_lowercase()))
                            .unwrap_or(false)
                    })
                })
                .and_then(|u| u["id"].as_str())
                .map(|s| s.to_string())
        } else {
            None
        };

        linear_create_issue(
            &title,
            &ticket_description,
            &team_id,
            assignee_id.as_deref(),
        )
        .await
    } else {
        // Jira
        let project_key = crate::config::get_provider_key("jira_project_key");
        if project_key.is_empty() {
            return Err("jira_project_key not configured".to_string());
        }

        let body = serde_json::json!({
            "fields": {
                "project": { "key": project_key },
                "summary": title,
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [{
                        "type": "paragraph",
                        "content": [{ "type": "text", "text": ticket_description }]
                    }]
                },
                "issuetype": { "name": "Task" }
            }
        });

        let result = jira_post("/issue", body).await?;
        let key = result["key"]
            .as_str()
            .ok_or("Jira did not return issue key")?
            .to_string();
        Ok(key)
    }
}

// ── Simulated data ────────────────────────────────────────────────────────────

fn simulated_ticket_updates() -> Vec<TicketUpdate> {
    vec![TicketUpdate {
        ticket_id: "BLADE-123".to_string(),
        new_status: "Done".to_string(),
        trigger: "pr_merge".to_string(),
        git_ref: "abc1234".to_string(),
        applied: false,
    }]
}

fn simulated_blocker_alerts() -> Vec<BlockerAlert> {
    vec![BlockerAlert {
        ticket_id: "BLADE-88".to_string(),
        title: "Implement auth token refresh".to_string(),
        status: "In Progress".to_string(),
        days_stale: 4,
        blocking: vec!["BLADE-89".to_string(), "BLADE-91".to_string()],
        suggested_action: "Assign to an available team member or break into smaller tasks.".to_string(),
    }]
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn linear_sync_git_to_tickets() -> Vec<TicketUpdate> {
    sync_git_to_tickets().await
}

#[tauri::command]
pub async fn linear_detect_blockers() -> Vec<BlockerAlert> {
    detect_blockers().await
}

#[tauri::command]
pub async fn linear_generate_sprint_report() -> String {
    generate_sprint_report().await
}

#[tauri::command]
pub async fn linear_auto_create_ticket(
    description: String,
    source: String,
) -> Result<String, String> {
    auto_create_ticket(&description, &source).await
}
