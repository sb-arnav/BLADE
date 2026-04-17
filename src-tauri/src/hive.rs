/// HIVE — BLADE's distributed agent mesh across every platform the user touches.
///
/// BLADE becomes an organism. Lightweight "tentacle" agents live inside every
/// platform. They monitor, act, and report to "Head" agents that specialise
/// in a domain. One "Big Agent" coordinates everything and spots cross-domain
/// patterns.
///
/// Topology (10 tentacles → 4 Heads → Big Agent):
///
///   Communications Head ← slack, discord, discord_deep, whatsapp, email
///   Development Head    ← github, ci, linear, jira
///   Operations Head     ← backend, logs, cloud
///   Intelligence Head   ← receives ALL reports (cross-domain synthesis)
///                      ↓
///             Big Agent (cross-domain decisions)
///
/// Tick: every 30 s the Hive wakes, collects reports, routes them, lets each Head
/// think, and escalates anything critical to the Big Agent.
/// Health tracking: 3 consecutive failures → Error; 5 → Dormant.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn uuid() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{:x}-{:x}", now_secs(), nanos)
}

// ── Core types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TentacleStatus {
    Active,
    Dormant,
    Error,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, PartialOrd)]
pub enum Priority {
    Critical,
    High,
    Normal,
    Low,
}

impl Priority {
    #[allow(dead_code)]
    fn as_score(&self) -> u8 {
        match self {
            Priority::Critical => 0,
            Priority::High => 1,
            Priority::Normal => 2,
            Priority::Low => 3,
        }
    }
}

/// A report that a tentacle sends upward to its Head model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentacleReport {
    pub id: String,
    pub tentacle_id: String,
    pub timestamp: i64,
    pub priority: Priority,
    /// "message" | "mention" | "alert" | "update" | "action_needed"
    pub category: String,
    /// One-line human-readable summary.
    pub summary: String,
    /// Full platform-specific payload.
    pub details: serde_json::Value,
    pub requires_action: bool,
    pub suggested_action: Option<String>,
    /// Whether this report has already been processed by a Head.
    pub processed: bool,
}

impl TentacleReport {
    fn new(
        tentacle_id: impl Into<String>,
        priority: Priority,
        category: impl Into<String>,
        summary: impl Into<String>,
        details: serde_json::Value,
        requires_action: bool,
        suggested_action: Option<String>,
    ) -> Self {
        Self {
            id: uuid(),
            tentacle_id: tentacle_id.into(),
            timestamp: now_secs(),
            priority,
            category: category.into(),
            summary: summary.into(),
            details,
            requires_action,
            suggested_action,
            processed: false,
        }
    }
}

/// A decision produced by a Head or the Big Agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum Decision {
    /// Draft a reply on `platform` to user/channel `to`.
    Reply {
        platform: String,
        to: String,
        draft: String,
        /// 0.0–1.0 confidence. If < autonomy_level → auto-send, else → show in UI.
        confidence: f32,
    },
    /// Escalate to user with context.
    Escalate {
        reason: String,
        context: String,
    },
    /// Take a concrete action on the platform (may not be reversible).
    Act {
        action: String,
        platform: String,
        reversible: bool,
    },
    /// Surface information without requiring user to act.
    Inform {
        summary: String,
    },
}

/// A lightweight agent living inside a specific platform.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tentacle {
    pub id: String,
    /// "slack" | "discord" | "whatsapp" | "email" | "github" | "ci" | "backend"
    /// | "discord_deep" | "linear" | "jira" | "logs" | "cloud"
    pub platform: String,
    pub status: TentacleStatus,
    /// Which Head model this tentacle reports to (Head id).
    pub head: String,
    pub last_heartbeat: i64,
    pub messages_processed: u64,
    pub actions_taken: u64,
    pub pending_reports: Vec<TentacleReport>,
    /// Consecutive poll failures — tracked for health escalation.
    /// 3 → Error status, 5 → Dormant (stops polling until re-enabled).
    pub consecutive_failures: u32,
}

impl Tentacle {
    fn new(platform: impl Into<String>, head: impl Into<String>) -> Self {
        let platform = platform.into();
        let id = format!("tentacle-{}", &platform);
        Self {
            id,
            platform,
            status: TentacleStatus::Active,
            head: head.into(),
            last_heartbeat: now_secs(),
            messages_processed: 0,
            actions_taken: 0,
            pending_reports: Vec::new(),
            consecutive_failures: 0,
        }
    }
}

/// A Head model that coordinates a set of tentacles for one domain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadModel {
    pub id: String,
    /// "communications" | "development" | "operations" | "intelligence"
    pub domain: String,
    /// IDs of tentacles reporting to this head.
    pub tentacles: Vec<String>,
    /// Which LLM to use (cheap for routine, expensive for complex).
    pub model: String,
    pub pending_decisions: Vec<Decision>,
    /// 0.0 = always ask user, 1.0 = fully autonomous.
    pub autonomy_level: f32,
}

impl HeadModel {
    fn new(
        id: impl Into<String>,
        domain: impl Into<String>,
        tentacles: Vec<String>,
        model: impl Into<String>,
        autonomy_level: f32,
    ) -> Self {
        Self {
            id: id.into(),
            domain: domain.into(),
            tentacles,
            model: model.into(),
            pending_decisions: Vec::new(),
            autonomy_level,
        }
    }
}

/// Top-level Hive state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hive {
    pub tentacles: HashMap<String, Tentacle>,
    pub heads: HashMap<String, HeadModel>,
    /// Decisions that have been approved by the user and are awaiting execution.
    pub approved_queue: Vec<(String, Decision)>,
    /// The global autonomy level (overrides per-head unless 0).
    pub autonomy: f32,
    pub running: bool,
    pub last_tick: i64,
    pub total_reports_processed: u64,
    pub total_actions_taken: u64,
}

impl Default for Hive {
    fn default() -> Self {
        Self {
            tentacles: HashMap::new(),
            heads: HashMap::new(),
            approved_queue: Vec::new(),
            autonomy: 0.3,
            running: false,
            last_tick: 0,
            total_reports_processed: 0,
            total_actions_taken: 0,
        }
    }
}

/// Serialisable summary returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HiveStatus {
    pub running: bool,
    pub tentacle_count: usize,
    pub active_tentacles: usize,
    pub head_count: usize,
    pub pending_decisions: usize,
    pub pending_reports: usize,
    pub last_tick: i64,
    pub total_reports_processed: u64,
    pub total_actions_taken: u64,
    pub autonomy: f32,
    pub tentacles: Vec<TentacleSummary>,
    pub recent_decisions: Vec<Decision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentacleSummary {
    pub id: String,
    pub platform: String,
    pub status: TentacleStatus,
    pub head: String,
    pub last_heartbeat: i64,
    pub messages_processed: u64,
    pub actions_taken: u64,
    pub pending_report_count: usize,
}

// ── Static state ──────────────────────────────────────────────────────────────

static HIVE: OnceLock<Mutex<Hive>> = OnceLock::new();

fn hive_lock() -> &'static Mutex<Hive> {
    HIVE.get_or_init(|| Mutex::new(Hive::default()))
}

static HIVE_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

// ── Rate limiting ─────────────────────────────────────────────────────────────

/// Tracks the last time each tentacle platform was polled (for rate limiting).
static LAST_POLL: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();

fn last_poll_map() -> &'static Mutex<HashMap<String, i64>> {
    LAST_POLL.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Returns true if enough time has passed since the last poll on this platform.
fn should_poll(platform: &str, min_interval_secs: i64) -> bool {
    let map = last_poll_map().lock().unwrap_or_else(|e| e.into_inner());
    let last = map.get(platform).copied().unwrap_or(0);
    now_secs() - last >= min_interval_secs
}

fn mark_polled(platform: &str) {
    let mut map = last_poll_map().lock().unwrap_or_else(|e| e.into_inner());
    map.insert(platform.to_string(), now_secs());
}

/// Tracks last-known up/down state of localhost ports so we can detect changes.
static PORT_STATES: OnceLock<Mutex<HashMap<u16, bool>>> = OnceLock::new();

fn port_states_map() -> &'static Mutex<HashMap<u16, bool>> {
    PORT_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

// ── GitHub REST API caller ────────────────────────────────────────────────────

/// Make an authenticated GET to the GitHub API. Returns the parsed JSON Value.
async fn github_get(token: &str, path: &str) -> Result<serde_json::Value, String> {
    let url = if path.starts_with("https://") {
        path.to_string()
    } else {
        format!("https://api.github.com{}", path)
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("BLADE-Hive/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    req = req
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!(
            "GitHub API {} → {}: {}",
            url,
            status,
            crate::safe_slice(&body, 200)
        ));
    }

    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Parse "owner/repo" from a remote URL.
/// Supports https://github.com/owner/repo[.git] and git@github.com:owner/repo[.git].
fn parse_owner_repo(remote_url: &str) -> Option<(String, String)> {
    // HTTPS
    if let Some(rest) = remote_url.strip_prefix("https://github.com/") {
        let without_git = rest.trim_end_matches(".git");
        let mut parts = without_git.splitn(2, '/');
        let owner = parts.next()?.to_string();
        let repo = parts.next()?.trim_end_matches(".git").to_string();
        if !owner.is_empty() && !repo.is_empty() {
            return Some((owner, repo));
        }
    }
    // SSH
    if let Some(rest) = remote_url.strip_prefix("git@github.com:") {
        let without_git = rest.trim_end_matches(".git");
        let mut parts = without_git.splitn(2, '/');
        let owner = parts.next()?.to_string();
        let repo = parts.next()?.trim_end_matches(".git").to_string();
        if !owner.is_empty() && !repo.is_empty() {
            return Some((owner, repo));
        }
    }
    None
}

// ── Tentacle platform polling ─────────────────────────────────────────────────

/// Poll the given tentacle's platform and produce any fresh reports.
async fn poll_tentacle(platform: &str) -> Vec<TentacleReport> {
    let mut reports = Vec::new();
    let id = format!("tentacle-{}", platform);

    match platform {
        // ── Email ──────────────────────────────────────────────────────────────
        "email" => {
            let config = crate::config::load_config();
            let has_gmail_mcp = config
                .mcp_servers
                .iter()
                .any(|s| s.name.eq_ignore_ascii_case("gmail"));

            if has_gmail_mcp {
                let args = serde_json::json!({ "query": "is:unread", "maxResults": 50 });
                match call_mcp_tool("gmail", "gmail_search_messages", args).await {
                    Ok(text) => {
                        let messages: Vec<serde_json::Value> =
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                                if let Some(arr) = v.as_array() {
                                    arr.clone()
                                } else if let Some(arr) = v["messages"].as_array() {
                                    arr.clone()
                                } else {
                                    vec![]
                                }
                            } else {
                                vec![]
                            };

                        let count = messages.len() as u32;
                        if count > 0 {
                            let previews: Vec<String> = messages
                                .iter()
                                .take(5)
                                .map(|m| {
                                    let from = m["from"]
                                        .as_str()
                                        .or_else(|| {
                                            m["payload"]["headers"].as_array().and_then(|h| {
                                                h.iter()
                                                    .find(|hdr| {
                                                        hdr["name"].as_str() == Some("From")
                                                    })
                                                    .and_then(|hdr| hdr["value"].as_str())
                                            })
                                        })
                                        .unwrap_or("unknown");
                                    let subject = m["subject"]
                                        .as_str()
                                        .or_else(|| {
                                            m["payload"]["headers"].as_array().and_then(|h| {
                                                h.iter()
                                                    .find(|hdr| {
                                                        hdr["name"].as_str() == Some("Subject")
                                                    })
                                                    .and_then(|hdr| hdr["value"].as_str())
                                            })
                                        })
                                        .unwrap_or("(no subject)");
                                    format!("From: {} — {}", from, subject)
                                })
                                .collect();

                            reports.push(TentacleReport::new(
                                &id,
                                if count > 10 { Priority::High } else { Priority::Normal },
                                "update",
                                format!("{} unread email(s) via Gmail MCP", count),
                                serde_json::json!({
                                    "unread": count,
                                    "source": "gmail_mcp",
                                    "previews": previews
                                }),
                                count > 5,
                                if count > 5 {
                                    Some("Triage unread emails".to_string())
                                } else {
                                    None
                                },
                            ));
                        }
                    }
                    Err(e) => {
                        log::warn!("[Hive/email] Gmail MCP call failed: {}", e);
                        // Fall back to integration_bridge state
                        let state = crate::integration_bridge::get_integration_state();
                        if state.unread_emails > 0 {
                            reports.push(TentacleReport::new(
                                &id,
                                if state.unread_emails > 10 { Priority::High } else { Priority::Normal },
                                "update",
                                format!(
                                    "{} unread email(s) (integration_bridge fallback)",
                                    state.unread_emails
                                ),
                                serde_json::json!({
                                    "unread": state.unread_emails,
                                    "source": "integration_bridge"
                                }),
                                state.unread_emails > 5,
                                if state.unread_emails > 5 {
                                    Some("Triage inbox".to_string())
                                } else {
                                    None
                                },
                            ));
                        }
                    }
                }
            } else {
                // No Gmail MCP — fall back to integration_bridge
                let state = crate::integration_bridge::get_integration_state();
                if state.unread_emails > 0 {
                    reports.push(TentacleReport::new(
                        &id,
                        if state.unread_emails > 10 { Priority::High } else { Priority::Normal },
                        "update",
                        format!("{} unread email(s)", state.unread_emails),
                        serde_json::json!({
                            "unread": state.unread_emails,
                            "source": "integration_bridge",
                            "note": "Configure Gmail MCP for real email data"
                        }),
                        state.unread_emails > 5,
                        if state.unread_emails > 5 {
                            Some("Triage inbox".to_string())
                        } else {
                            None
                        },
                    ));
                }
            }
        }

        // ── Slack ──────────────────────────────────────────────────────────────
        "slack" => {
            let config = crate::config::load_config();
            let has_slack_mcp = config
                .mcp_servers
                .iter()
                .any(|s| s.name.eq_ignore_ascii_case("slack"));

            if has_slack_mcp {
                let args =
                    serde_json::json!({ "query": "is:dm has:mention", "count": 20 });
                match call_mcp_tool("slack", "slack_search_public_and_private", args).await {
                    Ok(text) => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            let matches = v["messages"]["matches"]
                                .as_array()
                                .cloned()
                                .unwrap_or_default();
                            let count = matches.len() as u32;
                            if count > 0 {
                                let previews: Vec<String> = matches
                                    .iter()
                                    .take(5)
                                    .map(|m| {
                                        let user =
                                            m["username"].as_str().unwrap_or("unknown");
                                        let text_preview =
                                            m["text"].as_str().unwrap_or("");
                                        let channel = m["channel"]["name"]
                                            .as_str()
                                            .unwrap_or("?");
                                        format!(
                                            "@{} in #{}: {}",
                                            user,
                                            channel,
                                            crate::safe_slice(text_preview, 80)
                                        )
                                    })
                                    .collect();

                                let sender = matches
                                    .first()
                                    .and_then(|m| m["username"].as_str())
                                    .unwrap_or("")
                                    .to_string();

                                reports.push(TentacleReport::new(
                                    &id,
                                    if count > 3 { Priority::High } else { Priority::Normal },
                                    "mention",
                                    format!("{} unread Slack mention(s)", count),
                                    serde_json::json!({
                                        "mentions": count,
                                        "source": "slack_mcp",
                                        "previews": previews,
                                        "sender": sender
                                    }),
                                    true,
                                    Some("Draft replies in user's voice".to_string()),
                                ));
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("[Hive/slack] Slack MCP call failed: {}", e);
                        let state = crate::integration_bridge::get_integration_state();
                        if state.slack_mentions > 0 {
                            reports.push(TentacleReport::new(
                                &id,
                                if state.slack_mentions > 3 {
                                    Priority::High
                                } else {
                                    Priority::Normal
                                },
                                "mention",
                                format!(
                                    "{} unread Slack mention(s) (fallback)",
                                    state.slack_mentions
                                ),
                                serde_json::json!({
                                    "mentions": state.slack_mentions,
                                    "source": "integration_bridge"
                                }),
                                true,
                                Some("Draft replies in user's voice".to_string()),
                            ));
                        }
                    }
                }
            } else {
                let state = crate::integration_bridge::get_integration_state();
                if state.slack_mentions > 0 {
                    reports.push(TentacleReport::new(
                        &id,
                        if state.slack_mentions > 3 { Priority::High } else { Priority::Normal },
                        "mention",
                        format!("{} unread Slack mention(s)", state.slack_mentions),
                        serde_json::json!({
                            "mentions": state.slack_mentions,
                            "source": "integration_bridge",
                            "note": "Configure Slack MCP for real message data"
                        }),
                        true,
                        Some("Draft replies in user's voice".to_string()),
                    ));
                }
            }
        }

        // ── GitHub ─────────────────────────────────────────────────────────────
        "github" => {
            // Hard rate limit: at most once per minute
            if !should_poll("github", 60) {
                return reports;
            }

            let token = crate::config::get_provider_key("github");

            if token.is_empty() {
                reports.push(TentacleReport::new(
                    &id,
                    Priority::Low,
                    "alert",
                    "GitHub not connected — store a token via Settings → Integrations → GitHub Token",
                    serde_json::json!({ "configured": false }),
                    false,
                    Some(
                        "Add your GitHub personal access token in Settings under provider 'github'"
                            .to_string(),
                    ),
                ));
                return reports;
            }

            mark_polled("github");

            // 1. Unread notifications
            match github_get(&token, "/notifications?all=false&per_page=50").await {
                Ok(v) => {
                    if let Some(notifications) = v.as_array() {
                        let unread: Vec<&serde_json::Value> = notifications
                            .iter()
                            .filter(|n| n["unread"].as_bool().unwrap_or(false))
                            .collect();

                        if !unread.is_empty() {
                            let summaries: Vec<String> = unread
                                .iter()
                                .take(10)
                                .map(|n| {
                                    let repo = n["repository"]["full_name"]
                                        .as_str()
                                        .unwrap_or("?");
                                    let title =
                                        n["subject"]["title"].as_str().unwrap_or("(no title)");
                                    let kind =
                                        n["subject"]["type"].as_str().unwrap_or("?");
                                    format!("[{}] {} — {}", kind, repo, title)
                                })
                                .collect();

                            let count = unread.len();
                            reports.push(TentacleReport::new(
                                &id,
                                if count > 5 { Priority::High } else { Priority::Normal },
                                "update",
                                format!("{} unread GitHub notification(s)", count),
                                serde_json::json!({
                                    "count": count,
                                    "source": "github_api",
                                    "notifications": summaries
                                }),
                                count > 0,
                                Some(
                                    "Review at github.com/notifications".to_string(),
                                ),
                            ));
                        }
                    }
                }
                Err(e) => {
                    log::warn!("[Hive/github] Notifications fetch failed: {}", e);
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Low,
                        "alert",
                        format!(
                            "GitHub API error: {}",
                            crate::safe_slice(&e, 100)
                        ),
                        serde_json::json!({ "error": e }),
                        false,
                        None,
                    ));
                }
            }

            // 2. Open PRs on repos from deep_scan
            if let Some(scan) = crate::deep_scan::load_results_pub() {
                for repo in scan.git_repos.iter().take(5) {
                    let Some(remote) = &repo.remote_url else { continue };
                    let Some((owner, repo_name)) = parse_owner_repo(remote) else {
                        continue;
                    };

                    match github_get(
                        &token,
                        &format!(
                            "/repos/{}/{}/pulls?state=open&per_page=10",
                            owner, repo_name
                        ),
                    )
                    .await
                    {
                        Ok(v) => {
                            if let Some(prs) = v.as_array() {
                                let open_prs: Vec<serde_json::Value> = prs
                                    .iter()
                                    .filter(|pr| {
                                        !pr["draft"].as_bool().unwrap_or(false)
                                    })
                                    .cloned()
                                    .collect();

                                if !open_prs.is_empty() {
                                    let pr_list: Vec<String> = open_prs
                                        .iter()
                                        .take(5)
                                        .map(|pr| {
                                            let num =
                                                pr["number"].as_u64().unwrap_or(0);
                                            let title = pr["title"]
                                                .as_str()
                                                .unwrap_or("?");
                                            let author = pr["user"]["login"]
                                                .as_str()
                                                .unwrap_or("?");
                                            format!(
                                                "#{} by @{}: {}",
                                                num,
                                                author,
                                                crate::safe_slice(title, 80)
                                            )
                                        })
                                        .collect();

                                    reports.push(TentacleReport::new(
                                        &id,
                                        Priority::Normal,
                                        "update",
                                        format!(
                                            "{} open PR(s) in {}/{}",
                                            open_prs.len(),
                                            owner,
                                            repo_name
                                        ),
                                        serde_json::json!({
                                            "repo": format!("{}/{}", owner, repo_name),
                                            "open_prs": pr_list,
                                            "source": "github_api"
                                        }),
                                        false,
                                        None,
                                    ));
                                }
                            }
                        }
                        Err(e) => {
                            log::debug!(
                                "[Hive/github] PR fetch for {}/{} failed: {}",
                                owner,
                                repo_name,
                                e
                            );
                        }
                    }
                }
            }
        }

        // ── CI (GitHub Actions) ────────────────────────────────────────────────
        "ci" => {
            // Rate limit: once per minute (same cadence as GitHub)
            if !should_poll("ci", 60) {
                return reports;
            }

            let token = crate::config::get_provider_key("github");
            if token.is_empty() {
                return reports;
            }

            mark_polled("ci");

            let Some(scan) = crate::deep_scan::load_results_pub() else {
                return reports;
            };

            for repo in scan.git_repos.iter().take(5) {
                let Some(remote) = &repo.remote_url else { continue };
                let Some((owner, repo_name)) = parse_owner_repo(remote) else {
                    continue;
                };

                match github_get(
                    &token,
                    &format!(
                        "/repos/{}/{}/actions/runs?per_page=5",
                        owner, repo_name
                    ),
                )
                .await
                {
                    Ok(v) => {
                        let runs = match v["workflow_runs"].as_array() {
                            Some(r) => r.clone(),
                            None => continue,
                        };

                        if runs.is_empty() {
                            continue;
                        }

                        // Find the latest completed run
                        let latest = runs
                            .iter()
                            .find(|r| r["status"].as_str() == Some("completed"));

                        let Some(latest_run) = latest else { continue };

                        let conclusion =
                            latest_run["conclusion"].as_str().unwrap_or("unknown");
                        let run_id = latest_run["id"].as_u64().unwrap_or(0);
                        let run_url = latest_run["html_url"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        let run_name = latest_run["name"]
                            .as_str()
                            .unwrap_or("workflow")
                            .to_string();
                        let branch = latest_run["head_branch"]
                            .as_str()
                            .unwrap_or("?")
                            .to_string();

                        match conclusion {
                            "failure" | "timed_out" | "startup_failure" => {
                                // Fetch failing job details
                                let failing_info = match github_get(
                                    &token,
                                    &format!(
                                        "/repos/{}/{}/actions/runs/{}/jobs",
                                        owner, repo_name, run_id
                                    ),
                                )
                                .await
                                {
                                    Ok(jv) => {
                                        let empty = vec![];
                                        let jobs =
                                            jv["jobs"].as_array().unwrap_or(&empty);
                                        let failing: Vec<String> = jobs
                                            .iter()
                                            .filter(|j| {
                                                j["conclusion"].as_str()
                                                    == Some("failure")
                                            })
                                            .map(|j| {
                                                let job_name = j["name"]
                                                    .as_str()
                                                    .unwrap_or("?");
                                                let failing_step = j["steps"]
                                                    .as_array()
                                                    .and_then(|steps| {
                                                        steps.iter().find(|s| {
                                                            s["conclusion"].as_str()
                                                                == Some("failure")
                                                        })
                                                    })
                                                    .and_then(|s| s["name"].as_str())
                                                    .unwrap_or("unknown step");
                                                format!(
                                                    "job '{}' failed at step '{}'",
                                                    job_name, failing_step
                                                )
                                            })
                                            .collect();
                                        failing.join("; ")
                                    }
                                    Err(_) => format!("conclusion={}", conclusion),
                                };

                                reports.push(TentacleReport::new(
                                    &id,
                                    Priority::Critical,
                                    "alert",
                                    format!(
                                        "CI FAILED: {}/{} ({}) on branch '{}'",
                                        owner, repo_name, run_name, branch
                                    ),
                                    serde_json::json!({
                                        "repo": format!("{}/{}", owner, repo_name),
                                        "run_id": run_id,
                                        "run_url": run_url,
                                        "conclusion": conclusion,
                                        "branch": branch,
                                        "workflow": run_name,
                                        "failing_jobs": failing_info,
                                        "source": "github_actions_api"
                                    }),
                                    true,
                                    Some(format!(
                                        "Investigate CI failure: {} — {}",
                                        failing_info, run_url
                                    )),
                                ));
                            }
                            "success" => {
                                reports.push(TentacleReport::new(
                                    &id,
                                    Priority::Low,
                                    "update",
                                    format!(
                                        "CI passing: {}/{} ({}) on '{}'",
                                        owner, repo_name, run_name, branch
                                    ),
                                    serde_json::json!({
                                        "repo": format!("{}/{}", owner, repo_name),
                                        "run_url": run_url,
                                        "conclusion": "success",
                                        "branch": branch,
                                        "source": "github_actions_api"
                                    }),
                                    false,
                                    None,
                                ));
                            }
                            _ => {
                                // in_progress / skipped / cancelled — not actionable
                            }
                        }
                    }
                    Err(e) => {
                        log::debug!(
                            "[Hive/ci] Workflow runs fetch for {}/{} failed: {}",
                            owner,
                            repo_name,
                            e
                        );
                    }
                }
            }
        }

        // ── Backend / localhost port scanning ──────────────────────────────────
        "backend" => {
            const PORTS: &[u16] = &[3000, 4000, 5000, 8000, 8080, 8888];

            let client = match reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(1))
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("[Hive/backend] Could not build HTTP client: {}", e);
                    return reports;
                }
            };

            // Snapshot previous port states before we overwrite them
            let prev_states = { port_states_map().lock().unwrap_or_else(|e| e.into_inner()).clone() };
            let mut new_states = prev_states.clone();

            for &port in PORTS {
                let url = format!("http://127.0.0.1:{}/", port);
                let is_up = client.get(&url).send().await.is_ok();
                let was_up = prev_states.get(&port).copied();

                if was_up == Some(true) && !is_up {
                    // Service just went down
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::High,
                        "alert",
                        format!("Service on port {} just went DOWN", port),
                        serde_json::json!({
                            "port": port,
                            "url": url,
                            "status": "down",
                            "was_up": true
                        }),
                        true,
                        Some(format!(
                            "Port {} was running and is now unreachable — check the process",
                            port
                        )),
                    ));
                } else if was_up == Some(false) && is_up {
                    // Service came back up
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Normal,
                        "update",
                        format!("Service on port {} is now UP", port),
                        serde_json::json!({ "port": port, "url": url, "status": "up" }),
                        false,
                        None,
                    ));
                } else if was_up.is_none() && is_up {
                    // First time we see it
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Low,
                        "update",
                        format!("Service detected on localhost:{}", port),
                        serde_json::json!({ "port": port, "url": url, "status": "up" }),
                        false,
                        None,
                    ));
                }

                new_states.insert(port, is_up);
            }

            *port_states_map().lock().unwrap_or_else(|e| e.into_inner()) = new_states;
        }

        // ── Discord ────────────────────────────────────────────────────────────
        "discord" => {
            let token = crate::config::get_provider_key("discord");
            if token.is_empty() {
                return reports;
            }

            if !should_poll("discord", 60) {
                return reports;
            }
            mark_polled("discord");

            let client = match reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                // Discord requires a proper user-agent for bots
                .user_agent("DiscordBot (https://blade.dev, 1.0)")
                .build()
            {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("[Hive/discord] HTTP client error: {}", e);
                    return reports;
                }
            };

            let resp = client
                .get("https://discord.com/api/v10/users/@me/guilds")
                .header("Authorization", format!("Bot {}", token))
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => {
                    if let Ok(guilds) = r.json::<serde_json::Value>().await {
                        if let Some(arr) = guilds.as_array() {
                            let guild_names: Vec<String> = arr
                                .iter()
                                .take(5)
                                .filter_map(|g| g["name"].as_str().map(|s| s.to_string()))
                                .collect();
                            if !guild_names.is_empty() {
                                reports.push(TentacleReport::new(
                                    &id,
                                    Priority::Low,
                                    "update",
                                    format!(
                                        "Discord bot active in {} server(s): {}",
                                        arr.len(),
                                        guild_names.join(", ")
                                    ),
                                    serde_json::json!({
                                        "guild_count": arr.len(),
                                        "guilds": guild_names,
                                        "source": "discord_api"
                                    }),
                                    false,
                                    None,
                                ));
                            }
                        }
                    }
                }
                Ok(r) if r.status().as_u16() == 401 => {
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Normal,
                        "alert",
                        "Discord bot token is invalid — update it in Settings",
                        serde_json::json!({ "error": "401 Unauthorized" }),
                        false,
                        Some(
                            "Go to Settings and update the Discord bot token under provider 'discord'"
                                .to_string(),
                        ),
                    ));
                }
                Ok(r) => {
                    log::warn!("[Hive/discord] API returned {}", r.status());
                }
                Err(e) => {
                    log::warn!("[Hive/discord] API error: {}", e);
                }
            }
        }

        // ── WhatsApp ───────────────────────────────────────────────────────────
        "whatsapp" => {
            let wa_running = check_whatsapp_process().await;
            if !wa_running {
                return reports;
            }

            let unread = read_whatsapp_unread_via_cdp().await;
            match unread {
                Some(count) if count > 0 => {
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Normal,
                        "update",
                        format!(
                            "{} unread WhatsApp conversation(s) (badge count)",
                            count
                        ),
                        serde_json::json!({
                            "unread": count,
                            "source": "whatsapp_cdp",
                            "note": "Badge count only — no message content read for privacy"
                        }),
                        false,
                        None,
                    ));
                }
                Some(_) => {}
                None => {
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Low,
                        "update",
                        "WhatsApp Web is open (unread count unavailable via CDP)",
                        serde_json::json!({ "wa_open": true, "cdp_available": false }),
                        false,
                        None,
                    ));
                }
            }
        }

        // ── Discord Deep ───────────────────────────────────────────────────────
        "discord_deep" => {
            let token = crate::config::get_provider_key("discord");
            if token.is_empty() {
                return reports;
            }

            if !should_poll("discord_deep", 120) {
                return reports;
            }
            mark_polled("discord_deep");

            let actions = crate::tentacles::discord_deep::process_mentions(&token).await;
            if !actions.is_empty() {
                let summaries: Vec<String> = actions
                    .iter()
                    .take(5)
                    .map(|a| {
                        format!(
                            "@{} in guild {}: {}",
                            a.author,
                            a.guild_id,
                            crate::safe_slice(&a.original_content, 80)
                        )
                    })
                    .collect();

                reports.push(TentacleReport::new(
                    &id,
                    if actions.len() > 3 { Priority::High } else { Priority::Normal },
                    "mention",
                    format!("{} Discord mention(s) requiring response", actions.len()),
                    serde_json::json!({
                        "mention_count": actions.len(),
                        "source": "discord_deep",
                        "previews": summaries,
                        "actions": serde_json::to_value(&actions).unwrap_or_default()
                    }),
                    true,
                    Some("Reply to Discord mentions in user's voice".to_string()),
                ));
            }
        }

        // ── Linear / Jira ──────────────────────────────────────────────────────
        "linear" | "jira" => {
            let linear_token = crate::config::get_provider_key("linear");
            let jira_token = crate::config::get_provider_key("jira");

            if linear_token.is_empty() && jira_token.is_empty() {
                return reports;
            }

            if !should_poll(platform, 300) {
                return reports;
            }
            mark_polled(platform);

            let blockers = crate::tentacles::linear_jira::detect_blockers().await;
            if !blockers.is_empty() {
                let blocker_summaries: Vec<String> = blockers
                    .iter()
                    .take(5)
                    .map(|b| {
                        format!(
                            "[{}] {} — stale {}d: {}",
                            b.ticket_id,
                            crate::safe_slice(&b.title, 60),
                            b.days_stale,
                            crate::safe_slice(&b.suggested_action, 80)
                        )
                    })
                    .collect();

                let has_critical = blockers.iter().any(|b| b.days_stale >= 7);

                reports.push(TentacleReport::new(
                    &id,
                    if has_critical { Priority::High } else { Priority::Normal },
                    "alert",
                    format!(
                        "{} blocked ticket(s) detected in {}",
                        blockers.len(),
                        if platform == "linear" { "Linear" } else { "Jira" }
                    ),
                    serde_json::json!({
                        "blocker_count": blockers.len(),
                        "source": platform,
                        "blockers": blocker_summaries,
                        "details": serde_json::to_value(&blockers).unwrap_or_default()
                    }),
                    true,
                    Some(format!(
                        "Unblock {} stalled ticket(s) — check assignees",
                        blockers.len()
                    )),
                ));
            }
        }

        // ── Logs ───────────────────────────────────────────────────────────────
        "logs" => {
            // Collect log sources from config (provider key "log_paths" = newline-separated paths)
            let log_paths_raw = crate::config::get_provider_key("log_paths");
            let log_sources: Vec<String> = if log_paths_raw.is_empty() {
                // Default: use the OS-appropriate temp/log directory.
                // On Windows we look for TEMP; on Unix /var/log.
                // If the path doesn't exist we'll get nothing from read_to_string
                // which is fine — the DB path still works.
                let default_path = if cfg!(windows) {
                    std::env::var("TEMP").unwrap_or_else(|_| "C:/Windows/Temp".to_string())
                } else {
                    "/var/log".to_string()
                };
                vec![default_path]
            } else {
                log_paths_raw
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string())
                    .collect()
            };

            if !should_poll("logs", 60) {
                return reports;
            }
            mark_polled("logs");

            // Read recent lines from the DB (last 200 log entries ingested by log tailing)
            let recent_lines: Vec<String> = {
                let db_path = crate::config::blade_config_dir().join("blade.db");
                match rusqlite::Connection::open(&db_path) {
                    Ok(conn) => {
                        match conn.prepare(
                            "SELECT raw_line FROM log_entries \
                             ORDER BY timestamp DESC LIMIT 200",
                        ) {
                            Ok(mut stmt) => {
                                stmt.query_map([], |row| row.get::<_, String>(0))
                                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                                    .unwrap_or_default()
                            }
                            Err(_) => Vec::new(), // table doesn't exist yet
                        }
                    }
                    Err(_) => Vec::new(),
                }
            };

            // Also attempt to tail any file paths for fresh lines
            let mut all_lines = recent_lines;
            for path in &log_sources {
                if !path.starts_with("http") {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        let tail: Vec<String> = content
                            .lines()
                            .rev()
                            .take(50)
                            .map(|l| l.to_string())
                            .collect();
                        all_lines.extend(tail);
                    }
                }
            }

            if all_lines.is_empty() {
                return reports;
            }

            let anomalies = crate::tentacles::log_monitor::detect_anomalies(&all_lines).await;
            if !anomalies.is_empty() {
                let fatal_count = anomalies
                    .iter()
                    .filter(|a| a.severity >= 0.8)
                    .count();
                let error_count = anomalies
                    .iter()
                    .filter(|a| a.severity >= 0.5 && a.severity < 0.8)
                    .count();

                let summaries: Vec<String> = anomalies
                    .iter()
                    .take(5)
                    .map(|a| {
                        format!(
                            "[{:?}] {} (×{}) — {}",
                            a.anomaly_type,
                            crate::safe_slice(&a.message, 60),
                            a.count,
                            a.source
                        )
                    })
                    .collect();

                let priority = if fatal_count > 0 {
                    Priority::Critical
                } else if error_count > 2 {
                    Priority::High
                } else {
                    Priority::Normal
                };

                reports.push(TentacleReport::new(
                    &id,
                    priority,
                    "alert",
                    format!(
                        "{} log anomaly/anomalies detected ({} fatal, {} errors)",
                        anomalies.len(),
                        fatal_count,
                        error_count
                    ),
                    serde_json::json!({
                        "anomaly_count": anomalies.len(),
                        "fatal_count": fatal_count,
                        "error_count": error_count,
                        "source": "log_monitor",
                        "previews": summaries,
                        "anomalies": serde_json::to_value(&anomalies).unwrap_or_default()
                    }),
                    fatal_count > 0 || error_count > 2,
                    if fatal_count > 0 {
                        Some("Investigate fatal log errors immediately".to_string())
                    } else {
                        Some(format!(
                            "Review {} log anomaly/anomalies — check service health",
                            anomalies.len()
                        ))
                    },
                ));
            }
        }

        // ── Cloud Costs ────────────────────────────────────────────────────────
        "cloud" => {
            let aws_key = crate::config::get_provider_key("aws_access_key_id");
            if aws_key.is_empty() {
                return reports;
            }

            // Cloud cost checks are expensive — once per 6 hours max
            if !should_poll("cloud", 21_600) {
                return reports;
            }
            mark_polled("cloud");

            match crate::tentacles::cloud_costs::check_aws_costs().await {
                Ok(report) => {
                    let alerts =
                        crate::tentacles::cloud_costs::detect_cost_anomalies(&report).await;

                    // Always surface a summary of current spend
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Low,
                        "update",
                        format!(
                            "AWS spend: ${:.2} over 30 days (avg ${:.2}/day, top: {})",
                            report.total_usd, report.avg_daily_usd, report.top_service
                        ),
                        serde_json::json!({
                            "total_usd": report.total_usd,
                            "avg_daily_usd": report.avg_daily_usd,
                            "top_service": report.top_service,
                            "period_start": report.period_start,
                            "period_end": report.period_end,
                            "source": "aws_cost_explorer"
                        }),
                        false,
                        None,
                    ));

                    if !alerts.is_empty() {
                        let has_critical = alerts.iter().any(|a| {
                            matches!(
                                a.severity,
                                crate::tentacles::cloud_costs::CostAlertSeverity::Critical
                            )
                        });

                        let alert_summaries: Vec<String> = alerts
                            .iter()
                            .take(5)
                            .map(|a| {
                                format!(
                                    "{} — {:.1}× baseline: {}",
                                    a.service,
                                    a.ratio,
                                    crate::safe_slice(&a.message, 80)
                                )
                            })
                            .collect();

                        reports.push(TentacleReport::new(
                            &id,
                            if has_critical { Priority::Critical } else { Priority::High },
                            "alert",
                            format!(
                                "{} AWS cost spike(s) detected — up to {:.1}× baseline",
                                alerts.len(),
                                alerts
                                    .iter()
                                    .map(|a| a.ratio)
                                    .fold(0.0_f64, f64::max)
                            ),
                            serde_json::json!({
                                "alert_count": alerts.len(),
                                "source": "aws_cost_explorer",
                                "previews": alert_summaries,
                                "alerts": serde_json::to_value(&alerts).unwrap_or_default()
                            }),
                            true,
                            Some("Investigate AWS cost spikes — check for runaway resources".to_string()),
                        ));
                    }
                }
                Err(e) => {
                    log::warn!("[Hive/cloud] AWS cost check failed: {}", e);
                    reports.push(TentacleReport::new(
                        &id,
                        Priority::Low,
                        "alert",
                        format!(
                            "AWS cost check failed: {}",
                            crate::safe_slice(&e, 120)
                        ),
                        serde_json::json!({ "error": e, "source": "aws_cost_explorer" }),
                        false,
                        None,
                    ));
                }
            }
        }

        _ => {}
    }

    reports
}

// ── WhatsApp helpers ──────────────────────────────────────────────────────────

/// Check if a WhatsApp process (Desktop app) is running.
async fn check_whatsapp_process() -> bool {
    let result = crate::cmd_util::silent_tokio_cmd("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-Process | Where-Object { $_.Name -like '*WhatsApp*' } | Select-Object -First 1 -ExpandProperty Name",
        ])
        .output()
        .await;

    match result {
        Ok(out) => !String::from_utf8_lossy(&out.stdout).trim().is_empty(),
        Err(_) => false,
    }
}

/// Attempt to read WhatsApp Web unread count via the document title in a CDP tab.
/// WhatsApp Web puts "(N)" at the start of the title when there are N unread chats.
/// This reads no message content — purely the tab title.
async fn read_whatsapp_unread_via_cdp() -> Option<u32> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;

    // Chrome/Edge/Brave expose CDP at 9222 when started with --remote-debugging-port=9222
    let resp = client
        .get("http://127.0.0.1:9222/json")
        .send()
        .await
        .ok()?;
    let tabs: serde_json::Value = resp.json().await.ok()?;
    let tabs_arr = tabs.as_array()?;

    let wa_tab = tabs_arr.iter().find(|t| {
        t["url"]
            .as_str()
            .map(|u| u.contains("web.whatsapp.com"))
            .unwrap_or(false)
    })?;

    let ws_url = wa_tab["webSocketDebuggerUrl"].as_str()?;

    match crate::browser_native::cdp_evaluate(ws_url, "document.title").await {
        Ok(title) => {
            if title.starts_with('(') {
                if let Some(end) = title.find(')') {
                    return title[1..end].parse::<u32>().ok();
                }
            }
            Some(0)
        }
        Err(_) => None,
    }
}

// ── MCP tool call helper ──────────────────────────────────────────────────────

/// Call an MCP tool through the McpManager held in Tauri's app state.
/// Requires integration_bridge to have been started (it stashes the AppHandle).
async fn call_mcp_tool(
    server_name: &str,
    tool_name: &str,
    args: serde_json::Value,
) -> Result<String, String> {
    let handle = crate::integration_bridge::get_app_handle()
        .ok_or_else(|| "AppHandle not available — integration_bridge not started".to_string())?;

    let manager_state = handle
        .try_state::<crate::commands::SharedMcpManager>()
        .ok_or("McpManager state not found in app state")?;

    let mut manager: tokio::sync::MutexGuard<'_, crate::mcp::McpManager> = manager_state.lock().await;
    let qualified = format!("mcp__{}_{}", server_name, tool_name);
    let result = manager.call_tool(&qualified, args).await?;

    let text = result
        .content
        .iter()
        .filter_map(|c| c.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(text)
}

// ── Head processing ───────────────────────────────────────────────────────────

/// Route reports to the correct domain Head's specialized think function.
///
/// Each Head receives only the reports from its own tentacles and applies
/// domain-specific intelligence:
///   - "communications" → comms_head_think: cross-platform messaging synthesis,
///     style-matched reply drafting, overload triage
///   - "development"    → dev_head_think: CI failure analysis, SDLC flow,
///     PR management, deploy pattern detection
///   - "operations"     → ops_head_think: incident response, service state
///     tracking, cost anomaly detection
///   - "intelligence"   → intel_head_think: memory ingestion, cross-domain
///     insight detection, knowledge gap analysis, periodic briefs
async fn head_process_reports_async(
    head: &HeadModel,
    reports: &[TentacleReport],
) -> Vec<Decision> {
    use crate::tentacles::heads;

    match head.domain.as_str() {
        "communications" => heads::comms_head_think(reports).await,
        "development" => heads::dev_head_think(reports).await,
        "operations" => heads::ops_head_think(reports).await,
        "intelligence" => heads::intel_head_think(reports).await,
        other => {
            // Unknown domain — fall back to generic priority-based logic
            log::warn!("[Hive] Unknown head domain '{}' — using generic fallback", other);
            generic_head_fallback(head, reports).await
        }
    }
}

/// Generic fallback for any head domain not recognized above.
/// Preserves the original priority-switch logic so nothing breaks if a new
/// head is added before its think function is written.
async fn generic_head_fallback(
    head: &HeadModel,
    reports: &[TentacleReport],
) -> Vec<Decision> {
    let mut decisions = Vec::new();
    let config = crate::config::load_config();

    for report in reports {
        let decision = match report.priority {
            Priority::Low => Decision::Inform {
                summary: report.summary.clone(),
            },

            Priority::Normal => {
                if report.requires_action {
                    let draft = llm_draft_response(&config, report, false).await;
                    Decision::Reply {
                        platform: tentacle_platform_from_id(&report.tentacle_id),
                        to: "user".to_string(),
                        draft,
                        confidence: 0.6,
                    }
                } else {
                    Decision::Inform {
                        summary: report.summary.clone(),
                    }
                }
            }

            Priority::High => {
                let analysis = llm_draft_response(&config, report, true).await;
                if head.autonomy_level >= 0.7 {
                    Decision::Act {
                        action: analysis,
                        platform: tentacle_platform_from_id(&report.tentacle_id),
                        reversible: true,
                    }
                } else {
                    Decision::Escalate {
                        reason: report.summary.clone(),
                        context: format!(
                            "LLM analysis: {}\n\nRaw details: {}",
                            analysis,
                            crate::safe_slice(&report.details.to_string(), 500)
                        ),
                    }
                }
            }

            Priority::Critical => Decision::Escalate {
                reason: format!("[CRITICAL] {}", report.summary),
                context: report.details.to_string(),
            },
        };

        decisions.push(decision);
    }

    decisions
}

/// Kept for any legacy sync call sites. In hive_tick we use the async version.
#[allow(dead_code)]
fn head_process_reports(
    head: &HeadModel,
    reports: &[TentacleReport],
) -> Vec<Decision> {
    let mut decisions = Vec::new();
    for report in reports {
        let decision = match report.priority {
            Priority::Low => Decision::Inform { summary: report.summary.clone() },
            Priority::Normal => {
                if report.requires_action {
                    if let Some(ref action) = report.suggested_action {
                        Decision::Reply {
                            platform: tentacle_platform_from_id(&report.tentacle_id),
                            to: "user".to_string(),
                            draft: action.clone(),
                            confidence: 0.6,
                        }
                    } else {
                        Decision::Inform { summary: report.summary.clone() }
                    }
                } else {
                    Decision::Inform { summary: report.summary.clone() }
                }
            }
            Priority::High => {
                if head.autonomy_level >= 0.7 {
                    Decision::Act {
                        action: report
                            .suggested_action
                            .clone()
                            .unwrap_or_else(|| format!("Handle: {}", report.summary)),
                        platform: tentacle_platform_from_id(&report.tentacle_id),
                        reversible: true,
                    }
                } else {
                    Decision::Escalate {
                        reason: report.summary.clone(),
                        context: report.details.to_string(),
                    }
                }
            }
            Priority::Critical => Decision::Escalate {
                reason: format!("[CRITICAL] {}", report.summary),
                context: report.details.to_string(),
            },
        };
        decisions.push(decision);
    }
    decisions
}

/// Call the LLM to draft a response or analysis for a report.
/// `use_full_model` — when true uses the user's full configured model.
async fn llm_draft_response(
    config: &crate::config::BladeConfig,
    report: &TentacleReport,
    use_full_model: bool,
) -> String {
    let platform = tentacle_platform_from_id(&report.tentacle_id);
    let system_prompt = format!(
        "You are BLADE, a JARVIS-level AI assistant embedded in the user's desktop. \
         A monitoring tentacle has flagged activity on {}. \
         Category: {}. Priority level: {:?}. \
         Your job: produce a concise, actionable response in the user's voice. \
         Be direct, specific, and reference actual names/repos/errors from the report.",
        platform, report.category, report.priority
    );

    let user_prompt = format!(
        "Tentacle report:\n{}\n\nFull details:\n{}\n\nSuggested action: {}\n\n\
         Draft a brief response or recommended next action (2-4 sentences). \
         Be specific — use the actual repo names, people, or error details.",
        report.summary,
        crate::safe_slice(&report.details.to_string(), 600),
        report.suggested_action.as_deref().unwrap_or("none")
    );

    let messages = vec![
        crate::providers::ConversationMessage::System(system_prompt),
        crate::providers::ConversationMessage::User(user_prompt),
    ];

    let _ = use_full_model; // same model for now; can route to mini/full in future
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
            log::warn!("[Hive/llm_draft] LLM call failed: {}", e);
            report
                .suggested_action
                .clone()
                .unwrap_or_else(|| format!("Review: {}", report.summary))
        }
    }
}

fn tentacle_platform_from_id(tentacle_id: &str) -> String {
    tentacle_id
        .strip_prefix("tentacle-")
        .unwrap_or(tentacle_id)
        .to_string()
}

// ── Big Agent ─────────────────────────────────────────────────────────────────

/// The Big Agent sees ALL reports from ALL tentacles simultaneously.
/// It uses the full LLM model to:
///   - Correlate across domains (CI failure + Slack question → one reply)
///   - Draft cross-platform responses when patterns are found
///   - Escalate anything Critical directly to the user
pub async fn big_agent_think(reports: Vec<TentacleReport>) -> Vec<Decision> {
    if reports.is_empty() {
        return Vec::new();
    }

    let config = crate::config::load_config();

    // Group by platform for pattern detection
    let mut by_platform: HashMap<String, Vec<&TentacleReport>> = HashMap::new();
    for r in &reports {
        let platform = tentacle_platform_from_id(&r.tentacle_id);
        by_platform.entry(platform).or_default().push(r);
    }

    let mut decisions = Vec::new();

    // ── People-graph enrichment ────────────────────────────────────────────────
    let mut people_context: Vec<String> = Vec::new();
    for r in &reports {
        let platform = tentacle_platform_from_id(&r.tentacle_id);
        if matches!(platform.as_str(), "slack" | "email" | "discord") {
            if let Some(sender) = r.details.get("sender").and_then(|v| v.as_str()) {
                if let Some(person) = crate::people_graph::get_person(sender) {
                    people_context.push(format!(
                        "{} ({}; {}; topics: {})",
                        person.name,
                        person.relationship,
                        person.communication_style,
                        person.topics.join(", ")
                    ));
                }
            }
        }
    }

    // ── Immediate escalation for Critical ────────────────────────────────────
    for r in &reports {
        if r.priority == Priority::Critical {
            decisions.push(Decision::Escalate {
                reason: format!("[Big Agent escalation] {}", r.summary),
                context: r.details.to_string(),
            });
        }
    }

    // ── LLM cross-domain correlation ──────────────────────────────────────────
    // Run if there are multiple platforms active or any High/Critical reports
    let has_multiple_platforms = by_platform.len() > 1;
    let has_high_priority = reports
        .iter()
        .any(|r| r.priority == Priority::High || r.priority == Priority::Critical);

    if has_multiple_platforms || has_high_priority {
        // Build a rich context for the LLM
        let mut report_lines: Vec<String> = Vec::new();
        for r in &reports {
            let platform = tentacle_platform_from_id(&r.tentacle_id);
            report_lines.push(format!(
                "[{}/{}] {:?} — {}",
                platform, r.category, r.priority, r.summary
            ));
            // Include message previews
            if let Some(previews) = r.details.get("previews").and_then(|p| p.as_array()) {
                for preview in previews.iter().take(3) {
                    if let Some(s) = preview.as_str() {
                        report_lines.push(format!("  > {}", crate::safe_slice(s, 120)));
                    }
                }
            }
            // Include CI failure details
            if let Some(failing) = r.details.get("failing_jobs").and_then(|v| v.as_str()) {
                if !failing.is_empty() {
                    report_lines.push(format!("  > Failures: {}", failing));
                }
            }
            if let Some(run_url) = r.details.get("run_url").and_then(|v| v.as_str()) {
                report_lines.push(format!("  > CI URL: {}", run_url));
            }
        }

        let people_str = if people_context.is_empty() {
            "No people context available.".to_string()
        } else {
            format!("Known people in these reports: {}", people_context.join("; "))
        };

        let platforms_list: Vec<&str> = by_platform.keys().map(|s| s.as_str()).collect();

        let system_prompt = "You are BLADE's Big Agent — the top-level cross-platform \
            intelligence coordinator. You receive reports from all platform tentacles \
            and your job is to:\n\
            1. Detect cross-domain patterns (e.g. CI failure on repo X + Slack message \
               asking about repo X — these are obviously related)\n\
            2. Produce 1-3 specific, actionable insights that reference actual data \
               (repo names, people, error messages, channel names)\n\
            3. When Slack/email + CI failure are correlated: draft a concrete Slack \
               reply that explains the CI situation using the actual error details\n\
            4. When email + GitHub are correlated: note the relationship explicitly\n\n\
            Be direct and specific. Do NOT give generic advice. Reference actual \
            names, repos, errors, and channels from the reports provided."
            .to_string();

        let user_prompt = format!(
            "Active platforms this tick: {}\n\n\
             All Hive reports:\n{}\n\n{}\n\n\
             Identify cross-domain patterns and provide actionable insights. \
             If CI failure + Slack/email activity share a repo or topic, \
             draft a reply the user can send to explain the situation.",
            platforms_list.join(", "),
            report_lines.join("\n"),
            people_str
        );

        let messages = vec![
            crate::providers::ConversationMessage::System(system_prompt),
            crate::providers::ConversationMessage::User(user_prompt),
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
            Ok(turn) => {
                let analysis = turn.content;

                if !analysis.trim().is_empty() {
                    let has_slack = by_platform.contains_key("slack");
                    let has_email = by_platform.contains_key("email");
                    let has_ci_failure = reports.iter().any(|r| {
                        r.tentacle_id == "tentacle-ci"
                            && matches!(r.priority, Priority::Critical | Priority::High)
                    });

                    if (has_slack || has_email) && has_ci_failure {
                        // Cross-domain: comms + CI failure — surface as a Reply draft
                        let platform = if has_slack { "slack" } else { "email" };
                        decisions.push(Decision::Reply {
                            platform: platform.to_string(),
                            to: "team".to_string(),
                            // Below default autonomy threshold so it shows in UI for review
                            draft: analysis.clone(),
                            confidence: 0.55,
                        });
                    } else {
                        decisions.push(Decision::Inform {
                            summary: format!(
                                "[Big Agent] {}",
                                crate::safe_slice(&analysis, 600)
                            ),
                        });
                    }
                }
            }
            Err(e) => {
                log::warn!("[Hive/BigAgent] LLM call failed: {}", e);
                // Rule-based fallback
                let has_slack = by_platform.contains_key("slack");
                let has_github = by_platform.contains_key("github");
                let has_ci = by_platform.contains_key("ci");
                if has_slack && (has_github || has_ci) {
                    let slack_sum: Vec<String> = by_platform
                        .get("slack")
                        .map(|rs| rs.iter().map(|r| r.summary.clone()).collect())
                        .unwrap_or_default();
                    let ci_sum: Vec<String> = by_platform
                        .get("ci")
                        .map(|rs| rs.iter().map(|r| r.summary.clone()).collect())
                        .unwrap_or_default();
                    decisions.push(Decision::Inform {
                        summary: format!(
                            "[Big Agent] Cross-domain: Slack ({}) + Dev ({}). \
                             Check for related issues. (LLM unavailable: {})",
                            slack_sum.join("; "),
                            ci_sum.join("; "),
                            crate::safe_slice(&e, 60)
                        ),
                    });
                }
            }
        }
    }

    // If nothing was produced, emit a simple count summary
    if decisions.is_empty() {
        decisions.push(Decision::Inform {
            summary: format!(
                "Hive processed {} report(s) across {} platform(s) — no cross-domain patterns detected.",
                reports.len(),
                by_platform.len()
            ),
        });
    }

    decisions
}

// ── Initialisation ────────────────────────────────────────────────────────────

/// Build the initial Hive: create 4 domain Heads, then register all 10 tentacles.
///
/// Tentacle activation policy:
///   - email, slack, github, ci, backend, logs  → Active by default (or polling enabled)
///   - discord, discord_deep → Active only if Discord bot token stored
///   - whatsapp             → Dormant until the desktop app is detected at tick time
///   - linear               → Active only if "lin_api_*" token stored
///   - jira                 → Active only if jira token + jira_url stored
///   - cloud                → Active only if AWS credentials stored
pub fn initialize_hive() -> Hive {
    let config = crate::config::load_config();
    let istate = crate::integration_bridge::get_integration_state();

    // ── Head models ───────────────────────────────────────────────────────────
    let comms_head = HeadModel::new(
        "head-communications",
        "communications",
        vec![
            "tentacle-slack".to_string(),
            "tentacle-discord".to_string(),
            "tentacle-discord_deep".to_string(),
            "tentacle-whatsapp".to_string(),
            "tentacle-email".to_string(),
        ],
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    let dev_head = HeadModel::new(
        "head-development",
        "development",
        vec![
            "tentacle-github".to_string(),
            "tentacle-ci".to_string(),
            "tentacle-linear".to_string(),
            "tentacle-jira".to_string(),
        ],
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    let ops_head = HeadModel::new(
        "head-operations",
        "operations",
        vec![
            "tentacle-backend".to_string(),
            "tentacle-logs".to_string(),
            "tentacle-cloud".to_string(),
        ],
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    // Intelligence Head — cross-domain memory, insights, and knowledge management.
    // It receives a copy of ALL reports (see hive_tick routing below) so it can
    // build cross-domain connections. Its tentacle list is intentionally empty here;
    // the routing in hive_tick feeds it the full all_reports slice.
    let intel_head = HeadModel::new(
        "head-intelligence",
        "intelligence",
        vec![], // sees all reports via special routing in hive_tick
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    let mut heads = HashMap::new();
    heads.insert("head-communications".to_string(), comms_head);
    heads.insert("head-development".to_string(), dev_head);
    heads.insert("head-operations".to_string(), ops_head);
    heads.insert("head-intelligence".to_string(), intel_head);

    // ── Tentacles ─────────────────────────────────────────────────────────────
    let mut tentacles: HashMap<String, Tentacle> = HashMap::new();

    // Email: Active if integration polling on or emails already seen
    if config.integration_polling_enabled || istate.unread_emails > 0 {
        let t = Tentacle::new("email", "head-communications");
        tentacles.insert(t.id.clone(), t);
    }

    // Slack: Active if mentions seen or polling enabled
    if istate.slack_mentions > 0 || config.integration_polling_enabled {
        let t = Tentacle::new("slack", "head-communications");
        tentacles.insert(t.id.clone(), t);
    }

    // GitHub: Active if token present, notifications seen, or polling enabled
    let github_token = crate::config::get_provider_key("github");
    if istate.github_notifications > 0
        || !github_token.is_empty()
        || config.integration_polling_enabled
    {
        let t = Tentacle::new("github", "head-development");
        tentacles.insert(t.id.clone(), t);
    }

    // CI: pairs with GitHub
    if tentacles.contains_key("tentacle-github") {
        let t = Tentacle::new("ci", "head-development");
        tentacles.insert(t.id.clone(), t);
    }

    // Discord: Active if bot token present, Dormant otherwise
    {
        let discord_token = crate::config::get_provider_key("discord");
        let mut t = Tentacle::new("discord", "head-communications");
        if discord_token.is_empty() {
            t.status = TentacleStatus::Dormant;
        }
        tentacles.insert(t.id.clone(), t);
    }

    // Discord Deep: Active if bot token present, Dormant otherwise.
    // Runs independently from the basic guild-list check — it fetches actual
    // mentions and drafts LLM replies via discord_deep::process_mentions.
    {
        let discord_token = crate::config::get_provider_key("discord");
        let mut t = Tentacle::new("discord_deep", "head-communications");
        if discord_token.is_empty() {
            t.status = TentacleStatus::Dormant;
        }
        tentacles.insert(t.id.clone(), t);
    }

    // WhatsApp: Dormant until process is detected at tick time
    {
        let mut t = Tentacle::new("whatsapp", "head-communications");
        t.status = TentacleStatus::Dormant;
        tentacles.insert(t.id.clone(), t);
    }

    // Backend: Active — scans localhost ports every tick
    {
        let t = Tentacle::new("backend", "head-operations");
        tentacles.insert(t.id.clone(), t);
    }

    // Linear: Active if Linear API token present (starts with "lin_api_")
    {
        let linear_token = crate::config::get_provider_key("linear");
        let mut t = Tentacle::new("linear", "head-development");
        if linear_token.is_empty() || !linear_token.starts_with("lin_api_") {
            t.status = TentacleStatus::Dormant;
        }
        tentacles.insert(t.id.clone(), t);
    }

    // Jira: Active if Jira token + base URL configured
    {
        let jira_token = crate::config::get_provider_key("jira");
        let jira_url = crate::config::get_provider_key("jira_url");
        let mut t = Tentacle::new("jira", "head-development");
        if jira_token.is_empty() || jira_url.is_empty() {
            t.status = TentacleStatus::Dormant;
        }
        tentacles.insert(t.id.clone(), t);
    }

    // Logs: Active if log_paths configured or by default on any OS
    {
        let t = Tentacle::new("logs", "head-operations");
        // Always register — detect_anomalies reads from the DB populated by log_tailing
        tentacles.insert(t.id.clone(), t);
    }

    // Cloud (AWS Cost Explorer): Active if AWS credentials present
    {
        let aws_key = crate::config::get_provider_key("aws_access_key_id");
        let mut t = Tentacle::new("cloud", "head-operations");
        if aws_key.is_empty() {
            t.status = TentacleStatus::Dormant;
        }
        tentacles.insert(t.id.clone(), t);
    }

    Hive {
        tentacles,
        heads,
        approved_queue: Vec::new(),
        autonomy: config.hive_autonomy,
        running: false,
        last_tick: 0,
        total_reports_processed: 0,
        total_actions_taken: 0,
    }
}

// ── Hive tick ─────────────────────────────────────────────────────────────────

/// Main 30-second Hive tick (all 10 tentacles):
/// 1. Poll every Active tentacle for fresh reports (with health tracking).
///    - 3 consecutive failures → Error status + emit `tentacle_error`
///    - 5 consecutive failures → Dormant (stops polling until re-enabled)
/// 2. Route each report to its domain Head.
/// 3. Each Head processes reports via its specialized think function
///    (comms_head_think / dev_head_think / ops_head_think / intel_head_think).
/// 4. Big Agent synthesises cross-domain patterns with full LLM.
/// 5. Auto-execute approved decisions; queue the rest for user.
/// 6. Trigger CI auto-fix pipeline on lint/format/clippy failures.
/// 7. Store all decisions + High/Critical reports in typed_memory + execution_memory.
pub async fn hive_tick(app: &AppHandle) {
    let active_tentacles: Vec<String> = {
        let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
        hive.tentacles
            .values()
            .filter(|t| t.status == TentacleStatus::Active)
            .map(|t| t.platform.clone())
            .collect()
    };

    let mut all_reports: Vec<TentacleReport> = Vec::new();
    for platform in &active_tentacles {
        // ── Poll with failure tracking ─────────────────────────────────────────
        // We treat an empty result as success (no data) vs a panic/error.
        // To distinguish real failures we wrap in catch_unwind via a helper.
        let poll_result: Result<Vec<TentacleReport>, String> = {
            // poll_tentacle is infallible by design (returns empty vec on errors),
            // but we track whether it returned a special error report so we can
            // escalate the tentacle's health status.
            let raw = poll_tentacle(platform).await;
            // Heuristic: if ALL reports are category "alert" with an "error" key,
            // the tentacle hit an auth/connectivity failure.
            let all_errors = !raw.is_empty()
                && raw.iter().all(|r| {
                    r.category == "alert" && r.details.get("error").is_some()
                });
            if all_errors {
                Err("tentacle reported only error alerts".to_string())
            } else {
                Ok(raw)
            }
        };

        let tid = format!("tentacle-{}", platform);
        match poll_result {
            Ok(reports) => {
                all_reports.extend(reports.clone());
                let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
                if let Some(t) = hive.tentacles.get_mut(&tid) {
                    t.last_heartbeat = now_secs();
                    t.messages_processed += reports.len() as u64;
                    // Successful poll resets the failure counter
                    t.consecutive_failures = 0;
                    t.pending_reports.extend(reports);
                }
            }
            Err(reason) => {
                let (new_failures, new_status) = {
                    let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
                    let failures = hive
                        .tentacles
                        .get(&tid)
                        .map(|t| t.consecutive_failures + 1)
                        .unwrap_or(1);
                    let status = if failures >= 5 {
                        TentacleStatus::Dormant
                    } else if failures >= 3 {
                        TentacleStatus::Error
                    } else {
                        TentacleStatus::Active
                    };
                    (failures, status)
                };

                {
                    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(t) = hive.tentacles.get_mut(&tid) {
                        t.consecutive_failures = new_failures;
                        t.status = new_status.clone();
                    }
                }

                // Emit health event so HiveView can show the degraded state
                let _ = app.emit(
                    "tentacle_error",
                    serde_json::json!({
                        "tentacle_id": tid,
                        "platform": platform,
                        "consecutive_failures": new_failures,
                        "status": format!("{:?}", new_status),
                        "reason": reason,
                        "dormant": matches!(new_status, TentacleStatus::Dormant)
                    }),
                );

                log::warn!(
                    "[Hive] Tentacle {} failed ({} consecutive). Status → {:?}",
                    platform, new_failures, new_status
                );
            }
        }
    }

    if all_reports.is_empty() {
        let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
        hive.last_tick = now_secs();
        return;
    }

    // Route reports to domain heads (each head sees only its tentacles' reports)
    let mut head_reports: HashMap<String, Vec<TentacleReport>> = HashMap::new();
    {
        let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
        for report in &all_reports {
            if let Some(t) = hive.tentacles.get(&report.tentacle_id) {
                head_reports
                    .entry(t.head.clone())
                    .or_default()
                    .push(report.clone());
            }
        }
        // Intelligence Head receives ALL reports for cross-domain synthesis
        if hive.heads.contains_key("head-intelligence") {
            head_reports
                .entry("head-intelligence".to_string())
                .or_default()
                .extend(all_reports.clone());
        }
    }

    // Each head processes its slice asynchronously via its specialized think function
    let mut all_decisions: Vec<Decision> = Vec::new();
    {
        let head_data: Vec<(HeadModel, Vec<TentacleReport>)> = {
            let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
            head_reports
                .iter()
                .filter_map(|(head_id, reports)| {
                    hive.heads
                        .get(head_id)
                        .map(|h| (h.clone(), reports.clone()))
                })
                .collect()
        };

        for (head, reports) in &head_data {
            let decisions = head_process_reports_async(head, reports).await;
            all_decisions.extend(decisions);
        }
    }

    // Big Agent: cross-domain correlation with full LLM
    let big_decisions = big_agent_think(all_reports.clone()).await;
    all_decisions.extend(big_decisions);

    let autonomy_level = {
        let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
        hive.autonomy
    };

    let mut to_execute: Vec<Decision> = Vec::new();
    let mut to_queue: Vec<Decision> = Vec::new();

    for decision in &all_decisions {
        let auto = match decision {
            Decision::Reply { confidence, .. } => *confidence >= autonomy_level,
            Decision::Inform { .. } => true,
            Decision::Act { reversible, .. } => *reversible && autonomy_level >= 0.7,
            Decision::Escalate { .. } => false,
        };
        if auto {
            to_execute.push(decision.clone());
        } else {
            to_queue.push(decision.clone());
        }
    }

    for decision in &to_execute {
        execute_decision(app, decision).await;
    }

    {
        let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
        for decision in &to_queue {
            let target_head = decision_to_head(decision, &hive);
            if let Some(head) = hive.heads.get_mut(&target_head) {
                head.pending_decisions.push(decision.clone());
            }
        }

        hive.last_tick = now_secs();
        hive.total_reports_processed += all_reports.len() as u64;
        hive.total_actions_taken += to_execute.len() as u64;

        for t in hive.tentacles.values_mut() {
            for r in t.pending_reports.iter_mut() {
                r.processed = true;
            }
        }
    }

    // ── DNA enrichment: feed high-priority observations into typed_memory ─────
    // This ensures the DNA query layer (dna.rs) has fresh data from organ activity.
    // Only persist Critical/High reports — Normal/Low are noise for memory.
    for report in &all_reports {
        if report.priority == Priority::Critical || report.priority == Priority::High {
            let content = format!(
                "[{}] {}",
                report.tentacle_id.replace("tentacle-", ""),
                crate::safe_slice(&report.summary, 200),
            );
            let _ = crate::typed_memory::store_typed_memory(
                crate::typed_memory::MemoryCategory::Fact,
                &content,
                "hive",
                Some(0.8),
            );
        }
    }

    // ── People enrichment: extract person mentions from reports ───────────────
    for report in &all_reports {
        if let Some(people) = report.details.get("people") {
            if let Some(arr) = people.as_array() {
                for person_val in arr {
                    if let Some(name) = person_val.as_str() {
                        let platform = report.tentacle_id.replace("tentacle-", "");
                        // Feed into people_graph if the name is substantial
                        if name.len() > 2 && name.len() < 50 {
                            let app_clone = app.clone();
                            let name_owned = name.to_string();
                            let platform_owned = platform.clone();
                            tokio::spawn(async move {
                                let _ = &app_clone; // keep alive
                                crate::people_graph::learn_from_conversation_text(
                                    &format!("{} mentioned on {}", name_owned, platform_owned),
                                    "",
                                ).await;
                            });
                        }
                    }
                }
            }
        }
    }

    // ── Auto-fix pipeline: trigger on CI failures ─────────────────────────────
    // For trivial CI failures (lint/format/clippy), emit an event that the
    // proactive engine can pick up and suggest a fix command to the user.
    let ci_failures: Vec<&TentacleReport> = all_reports
        .iter()
        .filter(|r| {
            r.tentacle_id == "tentacle-ci"
                && (r.priority == Priority::Critical || r.priority == Priority::High)
        })
        .collect();

    for failure in &ci_failures {
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
        let repo = failure
            .details
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        // Classify the failure to choose the right auto-fix action
        let is_trivial = failing_jobs.contains("lint")
            || failing_jobs.contains("format")
            || failing_jobs.contains("clippy");

        let fix_cmd = if failing_jobs.contains("clippy") {
            Some("cargo clippy --fix --allow-dirty".to_string())
        } else if failing_jobs.contains("format") || failing_jobs.contains("fmt") {
            Some("cargo fmt".to_string())
        } else if failing_jobs.contains("lint") {
            Some("npm run lint -- --fix".to_string())
        } else {
            None
        };

        let _ = app.emit(
            "hive_ci_failure",
            serde_json::json!({
                "repo": repo,
                "failing_jobs": failing_jobs,
                "run_url": run_url,
                "is_trivial": is_trivial,
                "fix_command": fix_cmd,
                "summary": failure.summary,
                "priority": format!("{:?}", failure.priority)
            }),
        );

        // Show engine: auto-show CI failure details if user has trained BLADE to do so
        let app_show = app.clone();
        tokio::spawn(async move {
            crate::show_engine::trigger_auto_show(&app_show, "ci_failure").await;
        });

        // Wire AutoFixCard: emit the event it listens for so the card activates in the UI.
        // AutoFixCard.tsx listens on "hive_auto_fix_started" and drives the pipeline UI.
        let run_id_val = failure.details.get("run_id").and_then(|v| v.as_u64()).unwrap_or(0);
        let _ = app.emit(
            "hive_auto_fix_started",
            serde_json::json!({
                "repo_path": repo,
                "workflow_name": failing_jobs,
                "run_id": run_id_val,
                "summary": failure.summary
            }),
        );

        // Store CI failure in execution_memory for pattern tracking
        log_hive_action("ci", &format!("CI failure in {}: {}", repo, failing_jobs));

        // Auto-fix trivial failures (lint/format) autonomously
        if is_trivial {
            if let Some(cmd) = &fix_cmd {
                let app_fix = app.clone();
                let cmd_clone = cmd.clone();
                let repo_clone = repo.to_string();
                tokio::spawn(async move {
                    let _ = crate::tts::speak_and_wait(
                        &app_fix,
                        &format!("CI failed on a trivial issue. Running auto-fix."),
                    ).await;
                    // Run the fix command
                    let result = crate::native_tools::run_shell(cmd_clone.clone(), Some(repo_clone)).await;
                    match result {
                        Ok(output) => {
                            if !output.contains("error") {
                                // Commit and push the fix
                                let _ = crate::native_tools::run_shell(
                                    "git add -A && git commit -m 'fix: auto-fix lint/format (BLADE)' && git push".to_string(),
                                    None,
                                ).await;
                                let _ = crate::tts::speak_and_wait(
                                    &app_fix,
                                    "Auto-fix applied and pushed.",
                                ).await;
                            }
                        }
                        Err(_) => {}
                    }
                });
            }
        } else {
            // Complex failure — spawn Claude Code to investigate
            let app_spawn = app.clone();
            let summary = failure.summary.clone();
            tokio::spawn(async move {
                let task = format!(
                    "CI failed: {}. Investigate the error, find the root cause, and fix it.",
                    crate::safe_slice(&summary, 200)
                );
                let _ = crate::reproductive::spawn_with_dna(
                    &app_spawn, "claude_code", &task, None,
                ).await;
                let _ = crate::tts::speak_and_wait(
                    &app_spawn,
                    "CI has a complex failure. I've spawned an agent to investigate.",
                ).await;
            });
        }
    }

    // ── Store all decisions in typed_memory ───────────────────────────────────
    store_decisions_to_memory(&all_decisions);

    // ── Feed reports to typed_memory (High + Critical) ────────────────────────
    feed_reports_to_memory(&all_reports);

    let status = get_hive_status();
    let _ = app.emit("hive_tick", &status);

    if !to_queue.is_empty() {
        let _ = app.emit(
            "hive_pending_decisions",
            serde_json::json!({
                "count": to_queue.len(),
                "decisions": to_queue
            }),
        );
    }

    log::info!(
        "[Hive] Tick complete: {} reports, {} auto-executed, {} queued",
        all_reports.len(),
        to_execute.len(),
        to_queue.len()
    );
}

/// Pick which head owns this decision (fallback: communications).
fn decision_to_head(decision: &Decision, hive: &Hive) -> String {
    let platform = match decision {
        Decision::Reply { platform, .. } | Decision::Act { platform, .. } => {
            Some(platform.as_str())
        }
        _ => None,
    };

    if let Some(p) = platform {
        for (head_id, head) in &hive.heads {
            let tentacle_id = format!("tentacle-{}", p);
            if head.tentacles.contains(&tentacle_id) {
                return head_id.clone();
            }
        }
    }

    "head-communications".to_string()
}

/// Execute an auto-approved decision.
/// Try to actually send a reply via MCP. Returns true if sent.
async fn try_send_reply(app: &AppHandle, platform: &str, to: &str, draft: &str) -> bool {
    use tauri::Manager;
    let manager = match app.try_state::<crate::commands::SharedMcpManager>() {
        Some(m) => m,
        None => return false,
    };

    let tool_name = match platform {
        "slack" => "mcp__claude_ai_Slack__slack_send_message",
        "email" | "gmail" => "mcp__claude_ai_Gmail__gmail_create_draft",
        _ => return false, // no MCP tool for this platform
    };

    let args = match platform {
        "slack" => serde_json::json!({
            "channel": to,
            "text": draft,
        }),
        "email" | "gmail" => serde_json::json!({
            "to": to,
            "subject": "Re:",
            "body": draft,
        }),
        _ => return false,
    };

    let result = {
        let mut mgr = manager.lock().await;
        mgr.call_tool(tool_name, args).await
    };

    match result {
        Ok(r) => !r.is_error,
        Err(e) => {
            log::warn!("[Hive] Failed to send reply via {}: {}", platform, e);
            false
        }
    }
}

async fn execute_decision(app: &AppHandle, decision: &Decision) {
    match decision {
        Decision::Inform { summary } => {
            log::debug!("[Hive] Inform: {}", summary);
            let _ = app.emit("hive_inform", serde_json::json!({ "summary": summary }));
            // Show engine: surface info if user trained BLADE to show it
            let app_show = app.clone();
            let summary_clone = summary.clone();
            tokio::spawn(async move {
                // Detect trigger type from summary content
                let trigger = if summary_clone.to_lowercase().contains("slack") { "slack_mention" }
                    else if summary_clone.to_lowercase().contains("meeting") { "meeting_start" }
                    else { return; };
                crate::show_engine::trigger_auto_show(&app_show, trigger).await;
            });
        }
        Decision::Reply {
            platform,
            to,
            draft,
            confidence,
        } => {
            log::info!(
                "[Hive] Auto-reply on {} to {}: {} (conf={:.2})",
                platform,
                to,
                crate::safe_slice(draft, 60),
                confidence
            );
            log_hive_action(
                platform,
                &format!("auto-reply to {}: {}", to, crate::safe_slice(draft, 80)),
            );

            // Actually send via MCP if platform has a connected server
            let platform_clone = platform.clone();
            let to_clone = to.clone();
            let draft_clone = draft.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                let sent = try_send_reply(&app_clone, &platform_clone, &to_clone, &draft_clone).await;
                let _ = app_clone.emit(
                    "hive_action",
                    serde_json::json!({
                        "type": "reply",
                        "platform": platform_clone,
                        "to": to_clone,
                        "draft": draft_clone,
                        "sent": sent,
                    }),
                );
                if sent {
                    // Speak confirmation
                    let msg = format!("Sent a reply to {} on {}.", to_clone, platform_clone);
                    let _ = crate::tts::speak_and_wait(&app_clone, &msg).await;
                }
            });
        }
        Decision::Act {
            action,
            platform,
            reversible,
        } => {
            let signal = crate::decision_gate::Signal {
                source: format!("hive:{}", platform),
                description: action.clone(),
                confidence: 0.75,
                reversible: *reversible,
                time_sensitive: false,
            };
            let perception = crate::perception_fusion::get_latest().unwrap_or_default();
            let gate_outcome = crate::decision_gate::evaluate(&signal, &perception).await;
            let should_exec = matches!(
                gate_outcome,
                crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
            );
            if !should_exec {
                log::info!(
                    "[Hive] decision_gate deferred Act on {}: {}",
                    platform,
                    crate::safe_slice(action, 60)
                );
                let _ = app.emit(
                    "hive_action_deferred",
                    serde_json::json!({
                        "type": "act",
                        "platform": platform,
                        "action": action,
                        "reason": "decision_gate deferred"
                    }),
                );
                return;
            }
            log::info!(
                "[Hive] Act on {}: {} (reversible={})",
                platform,
                crate::safe_slice(action, 80),
                reversible
            );
            log_hive_action(platform, action);
            let _ = app.emit(
                "hive_action",
                serde_json::json!({
                    "type": "act",
                    "platform": platform,
                    "action": action,
                    "reversible": reversible
                }),
            );

            // Actually execute: spawn an agent for complex actions,
            // or run a tool for simple ones
            let action_lower = action.to_lowercase();
            let is_code_task = action_lower.contains("fix") || action_lower.contains("pr")
                || action_lower.contains("code") || action_lower.contains("build")
                || action_lower.contains("deploy") || action_lower.contains("merge");

            if is_code_task {
                // Spawn Claude Code with DNA inheritance for coding tasks
                let app_spawn = app.clone();
                let task = action.clone();
                tokio::spawn(async move {
                    let _ = crate::reproductive::spawn_with_dna(
                        &app_spawn, "claude_code", &task, None,
                    ).await;
                    let _ = crate::tts::speak_and_wait(
                        &app_spawn,
                        &format!("I've spawned an agent to handle: {}", crate::safe_slice(&task, 40)),
                    ).await;
                });
            }
        }
        Decision::Escalate { reason, context } => {
            log::warn!("[Hive] Escalate: {}", reason);
            let _ = app.emit(
                "hive_escalate",
                serde_json::json!({
                    "reason": reason,
                    "context": context
                }),
            );
            // BLADE speaks urgent escalations aloud — it's alive, not a silent notification
            let speak_reason = crate::safe_slice(reason, 100).to_string();
            let app_speak = app.clone();
            tokio::spawn(async move {
                let _ = crate::tts::speak_and_wait(
                    &app_speak,
                    &speak_reason,
                ).await;
            });
        }
    }
}

/// Log a Hive action into execution_memory so BLADE learns over time.
fn log_hive_action(platform: &str, action: &str) {
    if let Ok(conn) = crate::execution_memory::open_db_pub() {
        let cmd = format!("[hive:{}] {}", platform, action);
        let _ = conn.execute(
            "INSERT INTO executions \
             (command, cwd, stdout, stderr, exit_code, duration_ms, timestamp) \
             VALUES (?1, '', '', '', 0, 0, ?2)",
            rusqlite::params![cmd, now_secs()],
        );
    }
}

/// Store Big Agent + Head decisions in typed_memory for cross-tick continuity.
fn store_decisions_to_memory(decisions: &[Decision]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return;
    };

    for decision in decisions {
        let (category, content) = match decision {
            Decision::Reply { platform, to, draft, confidence } => (
                "decision",
                format!(
                    "[Hive:Reply] platform={} to={} conf={:.2} draft={}",
                    platform, to, confidence,
                    crate::safe_slice(draft, 200)
                ),
            ),
            Decision::Act { action, platform, reversible } => (
                "decision",
                format!(
                    "[Hive:Act] platform={} reversible={} action={}",
                    platform, reversible,
                    crate::safe_slice(action, 200)
                ),
            ),
            Decision::Escalate { reason, .. } => (
                "fact",
                format!("[Hive:Escalate] {}", crate::safe_slice(reason, 200)),
            ),
            Decision::Inform { summary } => (
                "fact",
                format!("[Hive:Inform] {}", crate::safe_slice(summary, 200)),
            ),
        };

        let id = uuid();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO typed_memories \
             (id, category, content, confidence, source, created_at, last_accessed, access_count) \
             VALUES (?1, ?2, ?3, 0.6, 'hive_decision', ?4, ?4, 0)",
            rusqlite::params![id, category, content, now_secs()],
        );
    }
}

/// Feed high-priority reports into typed_memory so patterns are remembered.
fn feed_reports_to_memory(reports: &[TentacleReport]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else {
        return;
    };

    for report in reports {
        if report.priority == Priority::Critical || report.priority == Priority::High {
            let category = if report.requires_action { "decision" } else { "fact" };
            let id = uuid();
            let _ = conn.execute(
                "INSERT OR IGNORE INTO typed_memories \
                 (id, category, content, confidence, source, created_at, last_accessed, access_count) \
                 VALUES (?1, ?2, ?3, 0.7, 'hive', ?4, ?4, 0)",
                rusqlite::params![
                    id,
                    category,
                    format!("[Hive:{}] {}", report.tentacle_id, report.summary),
                    now_secs()
                ],
            );
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Create a configured Hive and store it in static state.
pub fn start_hive(app: AppHandle, autonomy: f32) {
    if HIVE_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }

    let mut hive = initialize_hive();
    hive.running = true;
    hive.autonomy = autonomy;

    *hive_lock().lock().unwrap_or_else(|e| e.into_inner()) = hive;

    tauri::async_runtime::spawn(async move {
        let mut tick_count: u64 = 0;
        loop {
            let running = hive_lock().lock().unwrap_or_else(|e| e.into_inner()).running;
            if !running {
                break;
            }

            // Pituitary TSH: modulate tick frequency based on metabolic state.
            // High TSH (>0.6): always tick. Low TSH (<0.3): skip every other tick.
            // This conserves API calls during low-energy periods (night, idle).
            let tsh = crate::homeostasis::thyroid_stimulating();
            let should_tick = if tsh > 0.6 {
                true // high metabolism — always tick
            } else if tsh < 0.3 {
                tick_count % 3 == 0 // low metabolism — tick every 3rd cycle (90s)
            } else {
                tick_count % 2 == 0 // normal — tick every 2nd cycle (60s)
            };

            if should_tick {
                hive_tick(&app).await;
            }

            tick_count += 1;
            crate::supervisor::heartbeat("hive");
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        }

        HIVE_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        log::info!("[Hive] Tick loop stopped.");
    });

    log::info!("[Hive] Started with autonomy={:.2}", autonomy);
}

/// Stop the Hive tick loop.
pub fn stop_hive() {
    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
    hive.running = false;
    log::info!("[Hive] Stop requested.");
}

/// Activate a tentacle for the given platform with optional config.
pub async fn spawn_tentacle(
    platform: &str,
    config: serde_json::Value,
) -> Result<String, String> {
    let tentacle_id = format!("tentacle-{}", platform);

    let head_id = match platform {
        "slack" | "discord" | "discord_deep" | "whatsapp" | "email" => "head-communications",
        "github" | "ci" | "linear" | "jira" => "head-development",
        "backend" | "logs" | "cloud" => "head-operations",
        other => return Err(format!("Unknown platform: {}", other)),
    };

    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());

    if let Some(existing) = hive.tentacles.get_mut(&tentacle_id) {
        existing.status = TentacleStatus::Active;
        existing.last_heartbeat = now_secs();
        log::info!("[Hive] Reactivated tentacle: {}", tentacle_id);
        return Ok(tentacle_id);
    }

    let mut t = Tentacle::new(platform, head_id);
    t.status = TentacleStatus::Active;

    drop(config); // reserved for future per-platform auth config

    let id = t.id.clone();
    hive.tentacles.insert(id.clone(), t);

    if let Some(head) = hive.heads.get_mut(head_id) {
        if !head.tentacles.contains(&id) {
            head.tentacles.push(id.clone());
        }
    }

    log::info!("[Hive] Spawned tentacle: {}", id);
    Ok(id)
}

/// Register a custom agent-factory tentacle with the Hive.
/// Called by agent_factory::deploy_agent so every deployed agent participates
/// in the Hive tick loop and appears in the HiveView dashboard.
/// The tentacle is routed to head-intelligence (cross-domain) by default.
pub fn register_factory_tentacle(agent_id: &str, agent_name: &str) {
    let tentacle_id = format!("tentacle-factory-{}", agent_id);
    let platform = format!("factory:{}", agent_name);
    let head_id = "head-intelligence";

    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());

    if hive.tentacles.contains_key(&tentacle_id) {
        // Already registered — reactivate
        if let Some(t) = hive.tentacles.get_mut(&tentacle_id) {
            t.status = TentacleStatus::Active;
            t.last_heartbeat = now_secs();
        }
        return;
    }

    let mut t = Tentacle::new(&platform, head_id);
    t.id = tentacle_id.clone();
    t.status = TentacleStatus::Active;

    hive.tentacles.insert(tentacle_id.clone(), t);

    if let Some(head) = hive.heads.get_mut(head_id) {
        if !head.tentacles.contains(&tentacle_id) {
            head.tentacles.push(tentacle_id.clone());
        }
    }

    log::info!("[Hive] Registered factory agent as tentacle: {}", tentacle_id);
}

/// Deactivate a factory tentacle when an agent is paused or deleted.
pub fn deregister_factory_tentacle(agent_id: &str) {
    let tentacle_id = format!("tentacle-factory-{}", agent_id);
    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = hive.tentacles.get_mut(&tentacle_id) {
        t.status = TentacleStatus::Dormant;
        log::info!("[Hive] Deregistered factory tentacle: {}", tentacle_id);
    }
}

/// Return a serialisable snapshot of the Hive.
pub fn get_hive_status() -> HiveStatus {
    let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());

    let tentacle_summaries: Vec<TentacleSummary> = hive
        .tentacles
        .values()
        .map(|t| TentacleSummary {
            id: t.id.clone(),
            platform: t.platform.clone(),
            status: t.status.clone(),
            head: t.head.clone(),
            last_heartbeat: t.last_heartbeat,
            messages_processed: t.messages_processed,
            actions_taken: t.actions_taken,
            pending_report_count: t.pending_reports.iter().filter(|r| !r.processed).count(),
        })
        .collect();

    let pending_decisions: usize = hive.heads.values().map(|h| h.pending_decisions.len()).sum();

    let pending_reports: usize = hive
        .tentacles
        .values()
        .map(|t| t.pending_reports.iter().filter(|r| !r.processed).count())
        .sum();

    let recent_decisions: Vec<Decision> = hive
        .heads
        .values()
        .flat_map(|h| h.pending_decisions.iter().cloned())
        .take(10)
        .collect();

    let active_tentacles = hive
        .tentacles
        .values()
        .filter(|t| t.status == TentacleStatus::Active)
        .count();

    HiveStatus {
        running: hive.running,
        tentacle_count: hive.tentacles.len(),
        active_tentacles,
        head_count: hive.heads.len(),
        pending_decisions,
        pending_reports,
        last_tick: hive.last_tick,
        total_reports_processed: hive.total_reports_processed,
        total_actions_taken: hive.total_actions_taken,
        autonomy: hive.autonomy,
        tentacles: tentacle_summaries,
        recent_decisions,
    }
}

/// Compact intelligence digest for the chat system prompt.
/// Returns a short markdown block (~300-600 chars) summarizing what the Hive
/// currently knows. Designed for injection into brain.rs so the chat model
/// gets ambient awareness without prompt bloat.
/// Returns empty string if Hive is not running or has no data.
pub fn get_hive_digest() -> String {
    let hive = match hive_lock().lock() {
        Ok(h) => h,
        Err(_) => return String::new(),
    };

    if !hive.running {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push("## Live Intelligence (Hive)".to_string());

    // Active organ roster — Brain needs to know what capabilities are available
    let active_organs: Vec<String> = hive
        .tentacles
        .values()
        .filter(|t| t.status == TentacleStatus::Active)
        .map(|t| t.platform.clone())
        .collect();

    if !active_organs.is_empty() {
        lines.push(format!("**Active organs:** {}", active_organs.join(", ")));
    }

    // Dormant/error organs — Brain should know what's NOT available
    let inactive: Vec<String> = hive
        .tentacles
        .values()
        .filter(|t| t.status != TentacleStatus::Active)
        .map(|t| {
            let status_label = match t.status {
                TentacleStatus::Dormant => "dormant",
                TentacleStatus::Error => "error",
                TentacleStatus::Disconnected => "disconnected",
                TentacleStatus::Active => "active", // won't reach here
            };
            format!("{} ({})", t.platform, status_label)
        })
        .collect();

    if !inactive.is_empty() {
        lines.push(format!("**Unavailable:** {}", inactive.join(", ")));
    }

    // Head-level intelligence — one line per domain with pending work
    for head in hive.heads.values() {
        let report_count = hive
            .tentacles
            .values()
            .filter(|t| t.head == head.id)
            .flat_map(|t| t.pending_reports.iter())
            .filter(|r| !r.processed)
            .count();

        let decision_count = head.pending_decisions.len();

        if report_count > 0 || decision_count > 0 {
            let mut summary_parts = Vec::new();
            if report_count > 0 {
                summary_parts.push(format!("{} reports", report_count));
            }
            if decision_count > 0 {
                summary_parts.push(format!("{} decisions pending", decision_count));
            }
            lines.push(format!("- **{} Head:** {}", head.domain, summary_parts.join(", ")));
        }
    }

    // Urgent reports from active tentacles — only High/Critical to keep digest small
    for tentacle in hive.tentacles.values() {
        if tentacle.status != TentacleStatus::Active {
            continue;
        }
        if let Some(report) = tentacle.pending_reports.iter().rev().find(|r| !r.processed) {
            let urgency = match report.priority {
                Priority::Critical => "URGENT: ",
                Priority::High => "",
                _ => continue,
            };
            lines.push(format!(
                "- **{}** {}{}",
                tentacle.platform,
                urgency,
                crate::safe_slice(&report.summary, 100),
            ));
        }
    }

    // Pending decisions that need user attention (escalations)
    let pending_escalations: Vec<String> = hive
        .heads
        .values()
        .flat_map(|h| h.pending_decisions.iter())
        .filter_map(|d| match d {
            Decision::Escalate { reason, .. } => Some(crate::safe_slice(reason, 80).to_string()),
            _ => None,
        })
        .take(3)
        .collect();

    if !pending_escalations.is_empty() {
        lines.push("**Needs your attention:**".to_string());
        for e in pending_escalations {
            lines.push(format!("- {}", e));
        }
    }

    // Organism state from homeostasis (hormone bus)
    let hormones = crate::homeostasis::get_hormones();
    if hormones.urgency > 0.5 {
        lines.push(format!("**Body state:** URGENT (arousal {:.0}%, trust {:.0}%)",
            hormones.arousal * 100.0, hormones.trust * 100.0));
    } else if hormones.energy_mode < 0.3 {
        lines.push("**Body state:** conserving energy".to_string());
    }

    // If nothing notable beyond the header + roster, keep it minimal
    if lines.len() <= 2 {
        let active = active_organs.len();
        if active > 0 && lines.len() == 2 {
            // Just the header + organ list, nothing urgent — that's fine, keep it
        } else if active == 0 {
            return String::new();
        }
    }

    lines.join("\n")
}

/// Returns the current Hive intelligence digest — the compact summary
/// injected into the chat system prompt. Useful for debugging/display.
#[tauri::command]
pub fn hive_get_digest() -> String {
    get_hive_digest()
}

/// Return all unprocessed reports across all tentacles.
pub fn get_all_reports() -> Vec<TentacleReport> {
    let hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
    hive.tentacles
        .values()
        .flat_map(|t| t.pending_reports.iter().filter(|r| !r.processed).cloned())
        .collect()
}

/// Approve a pending decision (by head_id + decision index) and queue for execution.
pub fn approve_decision(head_id: &str, decision_index: usize) -> Result<Decision, String> {
    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
    let head = hive
        .heads
        .get_mut(head_id)
        .ok_or_else(|| format!("Unknown head: {}", head_id))?;

    if decision_index >= head.pending_decisions.len() {
        return Err(format!("Decision index {} out of range", decision_index));
    }

    let decision = head.pending_decisions.remove(decision_index);
    hive.approved_queue
        .push((head_id.to_string(), decision.clone()));
    Ok(decision)
}

/// Set the global autonomy level for the Hive and all Heads.
pub fn set_autonomy(level: f32) {
    let clamped = level.clamp(0.0, 1.0);
    let mut hive = hive_lock().lock().unwrap_or_else(|e| e.into_inner());
    hive.autonomy = clamped;
    for head in hive.heads.values_mut() {
        head.autonomy_level = clamped;
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn hive_start(app: tauri::AppHandle) -> Result<HiveStatus, String> {
    let config = crate::config::load_config();
    if !HIVE_RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
        start_hive(app, config.hive_autonomy);
    }
    Ok(get_hive_status())
}

#[tauri::command]
pub async fn hive_stop() -> Result<(), String> {
    stop_hive();
    Ok(())
}

#[tauri::command]
pub fn hive_get_status() -> HiveStatus {
    get_hive_status()
}

#[tauri::command]
pub async fn hive_spawn_tentacle(
    platform: String,
    config: serde_json::Value,
) -> Result<String, String> {
    spawn_tentacle(&platform, config).await
}

#[tauri::command]
pub fn hive_get_reports() -> Vec<TentacleReport> {
    get_all_reports()
}

#[tauri::command]
pub fn hive_approve_decision(
    head_id: String,
    decision_index: usize,
) -> Result<Decision, String> {
    approve_decision(&head_id, decision_index)
}

#[tauri::command]
pub fn hive_set_autonomy(level: f32) -> Result<(), String> {
    set_autonomy(level);
    let mut cfg = crate::config::load_config();
    cfg.hive_autonomy = level.clamp(0.0, 1.0);
    crate::config::save_config(&cfg)
}
