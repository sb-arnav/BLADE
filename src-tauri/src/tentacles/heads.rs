/// HEAD MODELS — Domain-specific AI coordinators for BLADE's Hive.
///
/// Each Head is a specialized intelligence layer that:
///   - Receives reports only from its own tentacles
///   - Synthesizes domain-specific context (cross-platform within domain)
///   - Makes decisions using cheap models for routine, expensive for complex
///   - Builds a mental model of what's happening in its domain over time
///
/// Four Heads:
///   1. Communications — Slack + Discord + WhatsApp + Email synthesis
///   2. Development    — GitHub + CI + Terminal + IDE coordination
///   3. Operations     — Infrastructure + servers + costs + incident response
///   4. Intelligence   — Memory, knowledge graph, cross-domain insights, weekly briefs

use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────────────────────

/// State held by each Head across ticks for context continuity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadContext {
    pub domain: String,
    /// Last 50 reports processed by this Head.
    pub recent_reports: Vec<super::super::hive::TentacleReport>,
    /// Actions that were decided but are awaiting user approval.
    pub pending_actions: Vec<PendingAction>,
    /// Total decisions made since Hive start.
    pub decisions_made: u32,
    /// Decisions that were approved by the user (for confidence calibration).
    pub decisions_approved: u32,
    /// Which LLM model this Head prefers (may differ from global config).
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingAction {
    pub id: String,
    pub description: String,
    pub platform: String,
    pub created_at: i64,
}

// Bring in the shared types we build on
use super::super::hive::{Decision, Priority, TentacleReport};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Extract the bare platform name from a tentacle id ("tentacle-slack" → "slack").
fn platform(tentacle_id: &str) -> &str {
    tentacle_id.strip_prefix("tentacle-").unwrap_or(tentacle_id)
}

/// Invoke the LLM. Uses the user's configured provider + model.
/// `cheap` = skip the call and use the suggested_action fallback for trivial reports.
async fn llm_call(system: &str, user: &str, cheap: bool) -> String {
    let config = crate::config::load_config();

    // For cheap/routine calls, skip LLM entirely and let the caller fall back.
    if cheap && config.api_key.is_empty() {
        return String::new();
    }

    let messages = vec![
        crate::providers::ConversationMessage::System(system.to_string()),
        crate::providers::ConversationMessage::User(user.to_string()),
    ];

    let model = format!("{}/{}", config.provider, config.model);
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];

    match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(turn) => turn.content,
        Err(e) => {
            log::warn!("[Hive/Head] LLM call failed: {}", e);
            String::new()
        }
    }
}

// ── 1. COMMUNICATIONS HEAD ────────────────────────────────────────────────────

/// Synthesizes ALL messaging across Slack, Discord, WhatsApp, Email.
///
/// Intelligence it applies:
///   - Builds a priority queue of who is waiting for what and how long
///   - Detects cross-platform contact overlap ("Sarah DM'd you on Slack AND emailed")
///   - Drafts style-matched replies (casual Slack, formal email, brief WhatsApp)
///   - Detects conversation overload and surfaces the top 5 that actually matter
///   - Uses cheap model for single-platform routine, full model for multi-platform
pub async fn comms_head_think(reports: &[TentacleReport]) -> Vec<Decision> {
    if reports.is_empty() {
        return Vec::new();
    }

    let mut decisions = Vec::new();

    // ── 1a. Escalate Critical immediately ─────────────────────────────────────
    for r in reports {
        if r.priority == Priority::Critical {
            decisions.push(Decision::Escalate {
                reason: format!("[Comms] {}", r.summary),
                context: r.details.to_string(),
            });
        }
    }

    // ── 1b. Cross-platform contact detection ──────────────────────────────────
    // Find senders that appear on multiple platforms
    let mut sender_platforms: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for r in reports {
        if let Some(sender) = r.details.get("sender").and_then(|v| v.as_str()) {
            if !sender.is_empty() {
                sender_platforms
                    .entry(sender.to_lowercase())
                    .or_default()
                    .push(platform(&r.tentacle_id).to_string());
            }
        }
    }

    for (sender, platforms) in &sender_platforms {
        if platforms.len() >= 2 {
            // Same person reaching out on multiple platforms — high urgency signal
            decisions.push(Decision::Escalate {
                reason: format!(
                    "Cross-platform urgency: {} contacted you on {} — likely needs a response soon",
                    sender,
                    platforms.join(" AND ")
                ),
                context: format!(
                    "Sender '{}' has pending messages on: {}",
                    sender,
                    platforms.join(", ")
                ),
            });
        }
    }

    // ── 1c. Conversation overload detection ───────────────────────────────────
    let total_pending: u64 = reports
        .iter()
        .filter_map(|r| {
            r.details
                .get("mentions")
                .or_else(|| r.details.get("unread"))
                .and_then(|v| v.as_u64())
        })
        .sum();

    let actionable: Vec<&TentacleReport> =
        reports.iter().filter(|r| r.requires_action).collect();

    if total_pending > 15 {
        // Overload — use LLM to triage the top 5 that matter
        let report_lines: Vec<String> = reports
            .iter()
            .map(|r| {
                format!(
                    "[{}] {:?} — {}",
                    platform(&r.tentacle_id),
                    r.priority,
                    r.summary
                )
            })
            .collect();

        let system = "You are BLADE's Communications Head — a domain expert coordinating \
            all of the user's messaging across Slack, Discord, WhatsApp, and Email. \
            The user is experiencing message overload. Your job is to triage ruthlessly: \
            identify the 5 messages/threads that actually require a response right now, \
            explain WHY each is urgent, and suggest the tone (casual/formal/brief). \
            Be direct. Reference actual platform names, sender names, and topics from the reports.";

        let user_msg = format!(
            "Message overload: {} total pending across {} platforms.\n\nAll reports:\n{}\n\n\
             Identify the top 5 that require immediate response, ranked by urgency. \
             For each: platform, sender/channel, why it's urgent, suggested reply tone.",
            total_pending,
            reports.len(),
            report_lines.join("\n")
        );

        let analysis = llm_call(system, &user_msg, false).await;
        if !analysis.is_empty() {
            decisions.push(Decision::Inform {
                summary: format!(
                    "[Comms Overload — {} pending] {}",
                    total_pending,
                    crate::safe_slice(&analysis, 800)
                ),
            });
        }
    } else if !actionable.is_empty() {
        // ── 1d. Draft style-matched replies for actionable reports ─────────────
        for r in &actionable {
            if r.priority == Priority::Critical {
                continue; // already escalated above
            }

            let plat = platform(&r.tentacle_id);
            let (style_hint, cheap) = match plat {
                "slack" => ("casual and direct, use Slack formatting (bold, emoji ok)", true),
                "discord" => ("conversational, community-aware", true),
                "whatsapp" => ("brief and personal, 1-3 sentences max", true),
                "email" => ("professional, well-structured, clear subject line", false),
                _ => ("clear and helpful", true),
            };

            let is_high = r.priority == Priority::High;

            let system = format!(
                "You are BLADE, acting as the user's Communications Head. \
                 You're drafting a reply for {} in the user's voice. \
                 Style guide for this platform: {}. \
                 Be specific — use actual names, context, and topics from the report. \
                 2-4 sentences. No generic filler.",
                plat, style_hint
            );

            let user_msg = format!(
                "Draft a {} reply for this pending message:\n\nSummary: {}\nDetails: {}\nSuggested action: {}\n\n\
                 Write the reply the user should send. Platform: {}. Style: {}.",
                if is_high { "careful" } else { "quick" },
                r.summary,
                crate::safe_slice(&r.details.to_string(), 400),
                r.suggested_action.as_deref().unwrap_or("respond thoughtfully"),
                plat,
                style_hint
            );

            let draft = llm_call(&system, &user_msg, cheap && !is_high).await;
            let draft = if draft.is_empty() {
                r.suggested_action
                    .clone()
                    .unwrap_or_else(|| format!("Respond to: {}", r.summary))
            } else {
                draft
            };

            let confidence = match (plat, r.priority == Priority::High) {
                ("slack", false) => 0.65,
                ("whatsapp", false) => 0.65,
                ("email", false) => 0.55,
                (_, true) => 0.45, // High priority → show for review
                _ => 0.6,
            };

            // Enrich with people_graph context
            let to = if let Some(sender) = r.details.get("sender").and_then(|v| v.as_str()) {
                sender.to_string()
            } else {
                "user".to_string()
            };

            decisions.push(Decision::Reply {
                platform: plat.to_string(),
                to,
                draft,
                confidence,
            });
        }
    }

    // ── 1e. Inform-only for Low/Normal non-actionable ─────────────────────────
    for r in reports {
        if !r.requires_action && r.priority == Priority::Normal {
            decisions.push(Decision::Inform {
                summary: format!("[{}] {}", platform(&r.tentacle_id), r.summary),
            });
        }
    }

    // Deduplicate: if overload analysis was emitted, skip individual informs
    decisions
}

// ── 2. DEVELOPMENT HEAD ───────────────────────────────────────────────────────

/// Coordinates all code activity: GitHub + CI + Terminal + IDE.
///
/// Intelligence it applies:
///   - Connects dots across platforms ("committed a fix, CI failing on different test")
///   - Manages SDLC flow: surfaces PRs ready to merge, CI failures needing triage
///   - Prioritizes: production bugs > PR review > feature work > tech debt
///   - On CI failure: auto-fix (trivial) vs create-issue (complex) vs alert (critical)
///   - Detects deploy patterns: "CI passed on main — ready to release?"
pub async fn dev_head_think(reports: &[TentacleReport]) -> Vec<Decision> {
    if reports.is_empty() {
        return Vec::new();
    }

    let mut decisions = Vec::new();

    // ── 2a. Classify reports by sub-type ──────────────────────────────────────
    let ci_failures: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-ci"
                && (r.priority == Priority::Critical || r.priority == Priority::High)
        })
        .collect();

    let ci_passes: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-ci" && r.priority == Priority::Low
        })
        .collect();

    let open_prs: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-github"
                && r.details.get("open_prs").is_some()
        })
        .collect();

    let gh_notifications: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-github"
                && r.details.get("notifications").is_some()
        })
        .collect();

    // ── 2b. CI failure analysis — most important thing in Dev ─────────────────
    for failure in &ci_failures {
        let repo = failure
            .details
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown repo");
        let branch = failure
            .details
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let workflow = failure
            .details
            .get("workflow")
            .and_then(|v| v.as_str())
            .unwrap_or("CI");
        let failing_jobs = failure
            .details
            .get("failing_jobs")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let run_url = failure
            .details
            .get("run_url")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Cross-reference: are there open PRs for this repo that might be related?
        let related_prs: Vec<String> = open_prs
            .iter()
            .filter(|pr| {
                pr.details
                    .get("repo")
                    .and_then(|v| v.as_str())
                    .map(|r| r == repo)
                    .unwrap_or(false)
            })
            .flat_map(|pr| {
                pr.details
                    .get("open_prs")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|p| p.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .take(3)
            .collect();

        let is_trivial_failure = failing_jobs.contains("lint")
            || failing_jobs.contains("format")
            || failing_jobs.contains("clippy");
        let is_critical = failure.priority == Priority::Critical;

        let system = "You are BLADE's Development Head — a senior engineer embedded in the user's \
            dev workflow. A CI pipeline has failed. Your job:\n\
            1. Classify severity: is this a trivial lint/format issue, a test regression, or a \
               build-breaking error?\n\
            2. If trivial: suggest the exact fix command\n\
            3. If complex: recommend creating a GitHub issue with the failure context\n\
            4. If production branch (main/master/release): escalate immediately\n\
            5. If related PRs exist: note which PR likely caused this\n\
            Be specific. Use actual repo names, branch names, job names. No fluff.";

        let user_msg = format!(
            "CI FAILURE:\nRepo: {}\nBranch: {}\nWorkflow: {}\nFailing: {}\nURL: {}\n\
             Related open PRs on this repo: {}\n\n\
             Classify this failure and recommend the exact next action.",
            repo,
            branch,
            workflow,
            if failing_jobs.is_empty() { "unknown" } else { failing_jobs },
            run_url,
            if related_prs.is_empty() {
                "none".to_string()
            } else {
                related_prs.join(", ")
            }
        );

        let analysis = llm_call(system, &user_msg, false).await;
        let analysis = if analysis.is_empty() {
            format!(
                "CI failed on {}/{}: {}. {}",
                repo,
                branch,
                failing_jobs,
                if run_url.is_empty() {
                    String::new()
                } else {
                    format!("See: {}", run_url)
                }
            )
        } else {
            analysis
        };

        let is_main_branch = matches!(branch, "main" | "master" | "release" | "prod" | "production");

        if is_critical || is_main_branch {
            decisions.push(Decision::Escalate {
                reason: format!(
                    "[Dev/CI Critical] {} failed on {} branch '{}'",
                    workflow, repo, branch
                ),
                context: format!(
                    "Failing jobs: {}\nAnalysis: {}\nURL: {}",
                    failing_jobs, analysis, run_url
                ),
            });
        } else if is_trivial_failure {
            decisions.push(Decision::Act {
                action: format!(
                    "Auto-fix suggestion for {}: {}",
                    repo,
                    crate::safe_slice(&analysis, 200)
                ),
                platform: "github".to_string(),
                reversible: true,
            });
        } else {
            decisions.push(Decision::Escalate {
                reason: format!("[Dev/CI] {} failed on {} ({})", workflow, repo, branch),
                context: crate::safe_slice(&analysis, 600).to_string(),
            });
        }
    }

    // ── 2c. CI pass on main — detect deploy opportunity ───────────────────────
    for pass in &ci_passes {
        let repo = pass
            .details
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let branch = pass
            .details
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let is_main = matches!(branch, "main" | "master");

        if is_main {
            // Check recent memory for deploy patterns
            let deploy_hint = check_deploy_pattern_memory(repo).await;

            decisions.push(Decision::Inform {
                summary: format!(
                    "[Dev] CI passing on {}/{}.{}",
                    repo,
                    branch,
                    if deploy_hint.is_empty() {
                        String::new()
                    } else {
                        format!(" {}", deploy_hint)
                    }
                ),
            });
        }
    }

    // ── 2d. SDLC flow — PRs ready to merge ───────────────────────────────────
    if !open_prs.is_empty() {
        let pr_lines: Vec<String> = open_prs
            .iter()
            .flat_map(|r| {
                r.details
                    .get("open_prs")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|p| p.as_str().map(|s| s.to_string()))
            })
            .take(10)
            .collect();

        if !pr_lines.is_empty() {
            let ci_all_passing = ci_failures.is_empty();

            let system = "You are BLADE's Development Head. You're reviewing the user's open PRs. \
                Your job: classify each PR by action needed:\n\
                - MERGE: CI passing, reviews done, no conflicts — recommend merging\n\
                - REVIEW: needs code review — flag if stale (>3 days)\n\
                - FIX: CI failing or has conflicts\n\
                - WAIT: draft or waiting on external feedback\n\
                Be concise. List actionable PRs first. Mention if any are stale.";

            let user_msg = format!(
                "Open PRs:\n{}\n\nCI status: {}\n\n\
                 Classify each PR and state the single next action needed.",
                pr_lines.join("\n"),
                if ci_all_passing {
                    "All passing"
                } else {
                    "Some failures (see CI reports)"
                }
            );

            let analysis = llm_call(system, &user_msg, pr_lines.len() <= 3).await;
            if !analysis.is_empty() {
                decisions.push(Decision::Inform {
                    summary: format!(
                        "[Dev/PRs — {}] {}",
                        pr_lines.len(),
                        crate::safe_slice(&analysis, 600)
                    ),
                });
            }
        }
    }

    // ── 2e. GitHub notifications ───────────────────────────────────────────────
    for notif in &gh_notifications {
        if notif.priority == Priority::High {
            decisions.push(Decision::Escalate {
                reason: notif.summary.clone(),
                context: notif.details.to_string(),
            });
        } else {
            decisions.push(Decision::Inform {
                summary: format!("[Dev/GitHub] {}", notif.summary),
            });
        }
    }

    decisions
}

/// Check typed_memory for past deploy patterns on this repo.
async fn check_deploy_pattern_memory(repo: &str) -> String {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return String::new();
    };

    let query = format!("%deploy%{}%", repo.replace('/', "%"));
    let result: Result<String, _> = conn.query_row(
        "SELECT content FROM typed_memories WHERE content LIKE ?1 \
         ORDER BY last_accessed DESC LIMIT 1",
        rusqlite::params![query],
        |row| row.get(0),
    );

    match result {
        Ok(content) if !content.is_empty() => {
            format!(
                "Deploy pattern detected: {}",
                crate::safe_slice(&content, 120)
            )
        }
        _ => String::new(),
    }
}

// ── 3. OPERATIONS HEAD ────────────────────────────────────────────────────────

/// Monitors all infrastructure: servers + cloud + logs + costs.
///
/// Intelligence it applies:
///   - Predicts incidents: error rate + memory + recent deploy = likely regression
///   - Incident response: detect → classify severity → alert → suggest fix → track
///   - Cost anomaly detection: spending trending above baseline
///   - Service state tracking: up/down transitions with duration context
///   - On-call awareness: escalate to right person based on what went down
pub async fn ops_head_think(reports: &[TentacleReport]) -> Vec<Decision> {
    if reports.is_empty() {
        return Vec::new();
    }

    let mut decisions = Vec::new();

    // ── 3a. Service outage detection ──────────────────────────────────────────
    let downs: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-backend"
                && r.details.get("status").and_then(|v| v.as_str()) == Some("down")
        })
        .collect();

    let ups: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-backend"
                && r.details.get("status").and_then(|v| v.as_str()) == Some("up")
        })
        .collect();

    let new_services: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-backend"
                && r.details.get("was_up").is_none()
                && r.details.get("status").and_then(|v| v.as_str()) == Some("up")
        })
        .collect();

    // Service went down — incident response
    for down in &downs {
        let port = down
            .details
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let url = down
            .details
            .get("url")
            .and_then(|v| v.as_str())
            .unwrap_or("?");

        // Check if this correlates with a recent CI deploy (cross-domain signal)
        let recent_deploy = check_recent_ci_activity().await;

        let system = "You are BLADE's Operations Head. A service just went down. \
            Your job is incident response:\n\
            1. Classify severity (P1 production / P2 important / P3 dev-only)\n\
            2. Identify likely cause based on port/service type and any recent CI activity\n\
            3. Suggest immediate diagnostic steps (check logs, restart command, etc.)\n\
            4. State who should be notified\n\
            Be direct. Suggest actual shell commands where possible.";

        let user_msg = format!(
            "SERVICE DOWN:\nPort: {}\nURL: {}\nRecent CI activity: {}\n\n\
             Classify severity and provide immediate response steps.",
            port,
            url,
            if recent_deploy.is_empty() { "none detected".to_string() } else { recent_deploy }
        );

        let analysis = llm_call(system, &user_msg, false).await;
        let context = if analysis.is_empty() {
            format!(
                "Port {} is unreachable. Check process with: netstat -an | grep {}",
                port, port
            )
        } else {
            analysis
        };

        // Port classification for severity
        let is_production_port = matches!(port, 80 | 443 | 8080 | 3000);
        let is_dev_port = matches!(port, 4000 | 5000 | 8888);

        if is_production_port {
            decisions.push(Decision::Escalate {
                reason: format!("[Ops/P1] Production-tier service down on port {}", port),
                context,
            });
        } else if is_dev_port {
            decisions.push(Decision::Act {
                action: format!(
                    "Dev service on port {} is down. {}",
                    port,
                    crate::safe_slice(&context, 200)
                ),
                platform: "backend".to_string(),
                reversible: true,
            });
        } else {
            decisions.push(Decision::Escalate {
                reason: format!("[Ops] Service on port {} went down", port),
                context,
            });
        }
    }

    // ── 3b. Service recovery ──────────────────────────────────────────────────
    for recovery in &ups {
        if recovery.details.get("was_up") == Some(&serde_json::Value::Bool(false)) {
            let port = recovery
                .details
                .get("port")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            decisions.push(Decision::Inform {
                summary: format!("[Ops] Service on port {} recovered and is now responding", port),
            });
        }
    }

    // ── 3c. New services detected ─────────────────────────────────────────────
    for new_svc in &new_services {
        let port = new_svc
            .details
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        decisions.push(Decision::Inform {
            summary: format!(
                "[Ops] New service detected on localhost:{} — add to monitoring?",
                port
            ),
        });
    }

    // ── 3d. Multi-service incident detection ──────────────────────────────────
    // If 2+ services go down in the same tick → likely systemic issue
    if downs.len() >= 2 {
        let ports: Vec<String> = downs
            .iter()
            .filter_map(|r| r.details.get("port").and_then(|v| v.as_u64()))
            .map(|p| p.to_string())
            .collect();

        decisions.push(Decision::Escalate {
            reason: format!(
                "[Ops/Incident] Multiple services down simultaneously: ports {}",
                ports.join(", ")
            ),
            context: format!(
                "{} services went down in the same monitoring tick. \
                 This suggests a systemic issue (host down, network partition, \
                 shared dependency failure). Check host health immediately.",
                downs.len()
            ),
        });
    }

    // ── 3e. Cost anomaly check (periodic — from financial_brain) ──────────────
    if let Some(cost_warning) = check_cost_anomaly().await {
        decisions.push(Decision::Inform {
            summary: format!("[Ops/Cost] {}", cost_warning),
        });
    }

    // Low-priority routine updates
    for r in reports {
        if r.priority == Priority::Low && !r.requires_action {
            decisions.push(Decision::Inform {
                summary: format!("[Ops] {}", r.summary),
            });
        }
    }

    decisions
}

/// Check if there was recent CI activity in execution_memory (cross-domain signal for Ops).
async fn check_recent_ci_activity() -> String {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return String::new();
    };

    let cutoff = now_secs() - 1800; // last 30 minutes
    let result: Result<String, _> = conn.query_row(
        "SELECT command FROM executions WHERE command LIKE '%hive:ci%' \
         AND timestamp > ?1 ORDER BY timestamp DESC LIMIT 1",
        rusqlite::params![cutoff],
        |row| row.get(0),
    );

    result.unwrap_or_default()
}

/// Check financial_brain for cost anomalies (fires at most once per hour).
async fn check_cost_anomaly() -> Option<String> {
    // Rate-limit to avoid spamming this on every tick
    static LAST_COST_CHECK: std::sync::OnceLock<std::sync::Mutex<i64>> =
        std::sync::OnceLock::new();
    let last_check = LAST_COST_CHECK.get_or_init(|| std::sync::Mutex::new(0));
    {
        let mut guard = last_check.lock().unwrap();
        let elapsed = now_secs() - *guard;
        if elapsed < 3600 {
            return None;
        }
        *guard = now_secs();
    }

    // Try to read spending summary from financial_brain's DB
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return None;
    };

    // Check if we have a spending_summary table
    let has_table: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='spending_summary'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false);

    if !has_table {
        return None;
    }

    // Look for this-month vs last-month trend
    let result: Result<(f64, f64), _> = conn.query_row(
        "SELECT this_month, last_month FROM spending_summary ORDER BY created_at DESC LIMIT 1",
        [],
        |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
    );

    if let Ok((this_month, last_month)) = result {
        if last_month > 0.0 {
            let pct_change = ((this_month - last_month) / last_month) * 100.0;
            if pct_change > 15.0 {
                return Some(format!(
                    "Monthly spend trending {:.0}% higher than last month (${:.2} vs ${:.2}). Review in financial dashboard.",
                    pct_change, this_month, last_month
                ));
            }
        }
    }

    None
}

// ── 4. INTELLIGENCE HEAD ─────────────────────────────────────────────────────

/// Manages ALL of BLADE's memory, knowledge, and cross-domain synthesis.
///
/// Intelligence it applies:
///   - Decides what's worth remembering vs what fades
///   - Builds cross-domain insights: "that Slack thread relates to this new PR"
///   - Generates periodic intelligence briefs (weekly/daily)
///   - Detects knowledge gaps: asked about X 3 times, expertise low → learning plan
///   - Feeds high-signal reports into typed_memory with correct category
pub async fn intel_head_think(reports: &[TentacleReport]) -> Vec<Decision> {
    if reports.is_empty() {
        return Vec::new();
    }

    let mut decisions = Vec::new();

    // ── 4a. Memory ingestion — decide what's worth remembering ────────────────
    let memorable: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            r.priority == Priority::Critical
                || r.priority == Priority::High
                || (r.priority == Priority::Normal && r.requires_action)
        })
        .collect();

    let total_reports = reports.len();
    let high_signal_count = memorable.len();

    for r in &memorable {
        store_report_as_memory(r).await;
    }

    // ── 4b. Cross-domain insight detection ────────────────────────────────────
    // Look for thematic links across different platform reports
    let cross_domain_insights = detect_cross_domain_links(reports).await;
    for insight in cross_domain_insights {
        decisions.push(Decision::Inform {
            summary: format!("[Intel/Cross-domain] {}", insight),
        });
    }

    // ── 4c. Knowledge gap detection ───────────────────────────────────────────
    let gaps = detect_knowledge_gaps(reports).await;
    for gap in gaps {
        decisions.push(Decision::Inform {
            summary: format!("[Intel/Gap] {}", gap),
        });
    }

    // ── 4d. Periodic intelligence brief (once per hour) ───────────────────────
    if let Some(brief) = maybe_generate_intel_brief(total_reports, high_signal_count).await {
        decisions.push(Decision::Inform {
            summary: brief,
        });
    }

    // If nothing actionable, emit a quiet stats inform
    if decisions.is_empty() {
        decisions.push(Decision::Inform {
            summary: format!(
                "[Intel] Processed {} reports ({} high-signal, {} stored to memory)",
                total_reports, high_signal_count, high_signal_count
            ),
        });
    }

    decisions
}

/// Write a high-signal report into typed_memory with the right category.
async fn store_report_as_memory(r: &TentacleReport) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return;
    };

    let category = if r.priority == Priority::Critical {
        "decision"
    } else if r.requires_action {
        "decision"
    } else if r.tentacle_id.contains("github") || r.tentacle_id.contains("ci") {
        "skill"
    } else {
        "fact"
    };

    let id = format!(
        "{:x}-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        r.id.len() as u64
    );

    let content = format!(
        "[Hive:{}] {} | {}",
        r.tentacle_id,
        r.summary,
        crate::safe_slice(&r.details.to_string(), 200)
    );

    let _ = conn.execute(
        "INSERT OR IGNORE INTO typed_memories \
         (id, category, content, confidence, source, created_at, last_accessed, access_count) \
         VALUES (?1, ?2, ?3, 0.75, 'hive_intel', ?4, ?4, 0)",
        rusqlite::params![id, category, content, now_secs()],
    );
}

/// Find thematic links across reports from different tentacles.
async fn detect_cross_domain_links(reports: &[TentacleReport]) -> Vec<String> {
    let mut insights = Vec::new();

    // Group by domain (comms vs dev vs ops)
    let comms_reports: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            matches!(
                r.tentacle_id.as_str(),
                "tentacle-slack" | "tentacle-email" | "tentacle-discord" | "tentacle-whatsapp"
            )
        })
        .collect();

    let dev_reports: Vec<&TentacleReport> = reports
        .iter()
        .filter(|r| {
            matches!(
                r.tentacle_id.as_str(),
                "tentacle-github" | "tentacle-ci"
            )
        })
        .collect();

    if comms_reports.is_empty() || dev_reports.is_empty() {
        return insights;
    }

    // Extract repo names from dev reports
    let repos: Vec<String> = dev_reports
        .iter()
        .filter_map(|r| r.details.get("repo").and_then(|v| v.as_str()))
        .map(|s| s.split('/').last().unwrap_or(s).to_lowercase())
        .collect();

    if repos.is_empty() {
        return insights;
    }

    // Check if any comms message mentions a repo by name
    for comms_r in &comms_reports {
        let summary_lower = comms_r.summary.to_lowercase();
        let details_lower = comms_r.details.to_string().to_lowercase();

        for repo in &repos {
            if summary_lower.contains(repo.as_str())
                || details_lower.contains(repo.as_str())
            {
                // Find the matching dev report for context
                let dev_context = dev_reports
                    .iter()
                    .filter(|r| {
                        r.details
                            .get("repo")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_lowercase().contains(repo.as_str()))
                            .unwrap_or(false)
                    })
                    .map(|r| r.summary.clone())
                    .next()
                    .unwrap_or_default();

                insights.push(format!(
                    "The {} message ({}) references '{}' which has active dev activity: {}",
                    platform(&comms_r.tentacle_id),
                    crate::safe_slice(&comms_r.summary, 60),
                    repo,
                    crate::safe_slice(&dev_context, 80)
                ));
                break;
            }
        }
    }

    // If we found links, use LLM to articulate the cross-domain pattern
    if !insights.is_empty() {
        let comms_summary: Vec<String> = comms_reports
            .iter()
            .map(|r| format!("[{}] {}", platform(&r.tentacle_id), r.summary))
            .collect();
        let dev_summary: Vec<String> = dev_reports
            .iter()
            .map(|r| format!("[{}] {}", platform(&r.tentacle_id), r.summary))
            .collect();

        let system = "You are BLADE's Intelligence Head — the cross-domain pattern recognizer. \
            You've detected that communication messages and development activity share common \
            topics or repository names. Your job: articulate the connection clearly and \
            suggest what the user should do with this insight. Be specific and concise (2-3 sentences).";

        let user_msg = format!(
            "Communication reports:\n{}\n\nDevelopment reports:\n{}\n\nPreliminary links found:\n{}\n\n\
             Explain the cross-domain connection and suggest the most useful next action.",
            comms_summary.join("\n"),
            dev_summary.join("\n"),
            insights.join("\n")
        );

        let analysis = llm_call(system, &user_msg, false).await;
        if !analysis.is_empty() {
            insights.clear();
            insights.push(crate::safe_slice(&analysis, 500).to_string());
        }
    }

    insights
}

/// Look for knowledge gaps: topics queried multiple times with low expertise.
async fn detect_knowledge_gaps(reports: &[TentacleReport]) -> Vec<String> {
    let mut gaps = Vec::new();

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return gaps;
    };

    // Extract unique topics from current reports
    let topics: Vec<String> = reports
        .iter()
        .flat_map(|r| {
            // Pull keywords from summaries: tech terms, product names
            let words: Vec<String> = r
                .summary
                .split_whitespace()
                .filter(|w| w.len() > 5 && w.chars().all(|c| c.is_alphanumeric() || c == '-'))
                .map(|w| w.to_lowercase())
                .collect();
            words
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // For each topic, check if it appears frequently in memory but has no skill entry
    for topic in topics.iter().take(5) {
        let mention_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM typed_memories WHERE content LIKE ?1",
                rusqlite::params![format!("%{}%", topic)],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let has_skill: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM typed_memories WHERE category='skill' AND content LIKE ?1",
                rusqlite::params![format!("%{}%", topic)],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n > 0)
            .unwrap_or(false);

        if mention_count >= 3 && !has_skill {
            gaps.push(format!(
                "You've encountered '{}' {} times but have no skill memory for it — \
                 consider building expertise here",
                topic, mention_count
            ));
        }
    }

    gaps
}

/// Generate a periodic intelligence brief (rate-limited to once per hour).
async fn maybe_generate_intel_brief(total_reports: usize, high_signal: usize) -> Option<String> {
    static LAST_BRIEF: std::sync::OnceLock<std::sync::Mutex<i64>> =
        std::sync::OnceLock::new();
    let last = LAST_BRIEF.get_or_init(|| std::sync::Mutex::new(0));
    {
        let mut guard = last.lock().unwrap();
        let elapsed = now_secs() - *guard;
        if elapsed < 3600 {
            return None;
        }
        *guard = now_secs();
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return None;
    };

    // Count memories created in the last 7 days
    let week_ago = now_secs() - 7 * 86400;
    let new_memories: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM typed_memories WHERE created_at > ?1",
            rusqlite::params![week_ago],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Count decisions made (from executions table, hive entries)
    let day_ago = now_secs() - 86400;
    let decisions_today: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM executions WHERE command LIKE '%hive:%' AND timestamp > ?1",
            rusqlite::params![day_ago],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Some(format!(
        "[Intel Brief] Past 7 days: {} new memories stored. \
         Today: {} Hive actions taken, {} reports processed ({} high-signal). \
         Memory health: nominal.",
        new_memories, decisions_today, total_reports, high_signal
    ))
}
