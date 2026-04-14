/// HIVE — BLADE's distributed agent mesh across every platform the user touches.
///
/// BLADE becomes an organism. Lightweight "tentacle" agents live inside every
/// platform (Slack, Discord, WhatsApp, Email, GitHub, CI/backend). They monitor,
/// act, and report to "Head" agents that specialise in a domain. One "Big Agent"
/// coordinates everything and spots cross-domain patterns.
///
/// Topology:
///   Tentacles (6 platforms) → 3 Head models (Communications / Development / Operations)
///                           → Big Agent (cross-domain synthesis + decisions)
///
/// Tick: every 30 s the Hive wakes, collects reports, routes them, lets each Head
/// decide, and escalates anything critical to the Big Agent.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn uuid() -> String {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!(
        "{:x}-{:x}",
        now_secs(),
        nanos
    )
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
    pub platform: String,
    pub status: TentacleStatus,
    /// Which Head model this tentacle reports to (Head id).
    pub head: String,
    pub last_heartbeat: i64,
    pub messages_processed: u64,
    pub actions_taken: u64,
    pub pending_reports: Vec<TentacleReport>,
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

// ── Initialisation ────────────────────────────────────────────────────────────

/// Build the initial Hive: create the 3 domain heads, then register tentacles
/// for every platform that looks configured (based on integration_bridge state).
pub fn initialize_hive() -> Hive {
    let config = crate::config::load_config();

    // Determine which integrations are active by checking integration_bridge state.
    // We look for non-zero metric values as a proxy for "connected".
    let istate = crate::integration_bridge::get_integration_state();

    // ── 3 Head models ─────────────────────────────────────────────────────────
    // Communications head: Slack + Discord + WhatsApp + Email
    let comms_head = HeadModel::new(
        "head-communications",
        "communications",
        vec![
            "tentacle-slack".to_string(),
            "tentacle-discord".to_string(),
            "tentacle-whatsapp".to_string(),
            "tentacle-email".to_string(),
        ],
        // Cheap model for routine comms triage
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    // Development head: GitHub + CI
    let dev_head = HeadModel::new(
        "head-development",
        "development",
        vec![
            "tentacle-github".to_string(),
            "tentacle-ci".to_string(),
        ],
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    // Operations head: backend / server monitoring
    let ops_head = HeadModel::new(
        "head-operations",
        "operations",
        vec!["tentacle-backend".to_string()],
        format!("{}/{}", config.provider, config.model),
        config.hive_autonomy,
    );

    let mut heads = HashMap::new();
    heads.insert("head-communications".to_string(), comms_head);
    heads.insert("head-development".to_string(), dev_head);
    heads.insert("head-operations".to_string(), ops_head);

    // ── Tentacles — only spawn what appears configured ─────────────────────
    let mut tentacles: HashMap<String, Tentacle> = HashMap::new();

    // Email: always available if integration polling is on
    if config.integration_polling_enabled || istate.unread_emails > 0 {
        let t = Tentacle::new("email", "head-communications");
        tentacles.insert(t.id.clone(), t);
    }

    // Slack: configured if slack_mentions seen or config flag set
    if istate.slack_mentions > 0 || config.integration_polling_enabled {
        let t = Tentacle::new("slack", "head-communications");
        tentacles.insert(t.id.clone(), t);
    }

    // GitHub: configured if github_notifications seen
    if istate.github_notifications > 0 || config.integration_polling_enabled {
        let t = Tentacle::new("github", "head-development");
        tentacles.insert(t.id.clone(), t);
    }

    // CI: sibling to GitHub — always pair them
    if tentacles.contains_key("tentacle-github") {
        let t = Tentacle::new("ci", "head-development");
        tentacles.insert(t.id.clone(), t);
    }

    // Discord: always register, starts Dormant unless explicitly spawned
    {
        let mut t = Tentacle::new("discord", "head-communications");
        t.status = TentacleStatus::Dormant;
        tentacles.insert(t.id.clone(), t);
    }

    // WhatsApp: always register, starts Dormant (needs browser CDP)
    {
        let mut t = Tentacle::new("whatsapp", "head-communications");
        t.status = TentacleStatus::Dormant;
        tentacles.insert(t.id.clone(), t);
    }

    // Backend: operations head — starts Dormant until configured
    {
        let mut t = Tentacle::new("backend", "head-operations");
        t.status = TentacleStatus::Dormant;
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

// ── Tentacle platform polling ─────────────────────────────────────────────────

/// Poll the given tentacle's platform and produce any fresh reports.
/// For now each platform polls its integration_bridge equivalent or simulates data.
async fn poll_tentacle(platform: &str) -> Vec<TentacleReport> {
    let mut reports = Vec::new();
    let id = format!("tentacle-{}", platform);

    match platform {
        "email" => {
            let state = crate::integration_bridge::get_integration_state();
            if state.unread_emails > 0 {
                reports.push(TentacleReport::new(
                    &id,
                    if state.unread_emails > 10 { Priority::High } else { Priority::Normal },
                    "update",
                    format!("{} unread email(s) in inbox", state.unread_emails),
                    serde_json::json!({ "unread": state.unread_emails }),
                    state.unread_emails > 5,
                    if state.unread_emails > 5 {
                        Some("Review and triage inbox".to_string())
                    } else {
                        None
                    },
                ));
            }
        }

        "slack" => {
            let state = crate::integration_bridge::get_integration_state();
            if state.slack_mentions > 0 {
                reports.push(TentacleReport::new(
                    &id,
                    if state.slack_mentions > 3 { Priority::High } else { Priority::Normal },
                    "mention",
                    format!("{} unread Slack mention(s)", state.slack_mentions),
                    serde_json::json!({ "mentions": state.slack_mentions }),
                    true,
                    Some("Draft replies in user's voice".to_string()),
                ));
            }
        }

        "github" => {
            let state = crate::integration_bridge::get_integration_state();
            if state.github_notifications > 0 {
                reports.push(TentacleReport::new(
                    &id,
                    if state.github_notifications > 5 { Priority::High } else { Priority::Normal },
                    "update",
                    format!("{} GitHub notification(s)", state.github_notifications),
                    serde_json::json!({ "notifications": state.github_notifications }),
                    state.github_notifications > 0,
                    Some("Review PRs and issue comments".to_string()),
                ));
            }
        }

        "ci" => {
            // CI tentacle looks for recent execution memory for build failures
            // and surfaces them alongside GitHub reports for cross-domain insight.
            // In a future iteration this calls a real CI API endpoint.
        }

        "discord" | "whatsapp" | "backend" => {
            // These tentacles are Dormant until explicitly configured via spawn_tentacle.
            // Nothing to poll yet.
        }

        _ => {}
    }

    reports
}

// ── Head processing ───────────────────────────────────────────────────────────

/// A Head model processes its reports and produces decisions.
/// Trivial → auto-handle (Inform), important → decide (Reply/Act), critical → Escalate.
fn head_process_reports(
    head: &HeadModel,
    reports: &[TentacleReport],
) -> Vec<Decision> {
    let mut decisions = Vec::new();

    for report in reports {
        let decision = match report.priority {
            Priority::Low => Decision::Inform {
                summary: report.summary.clone(),
            },
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
                        Decision::Inform {
                            summary: report.summary.clone(),
                        }
                    }
                } else {
                    Decision::Inform {
                        summary: report.summary.clone(),
                    }
                }
            }
            Priority::High => {
                if head.autonomy_level >= 0.7 {
                    Decision::Act {
                        action: report.suggested_action
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

fn tentacle_platform_from_id(tentacle_id: &str) -> String {
    tentacle_id
        .strip_prefix("tentacle-")
        .unwrap_or(tentacle_id)
        .to_string()
}

// ── Big Agent ────────────────────────────────────────────────────────────────

/// The Big Agent sees ALL reports from ALL heads and can spot cross-domain patterns.
/// "Sarah asked about the API in Slack AND there is a failing CI build on that repo
///  → connect the dots and draft a reply that includes the CI error and a fix."
pub async fn big_agent_think(reports: Vec<TentacleReport>) -> Vec<Decision> {
    if reports.is_empty() {
        return Vec::new();
    }

    // Group reports by platform for cross-domain pattern matching.
    let mut by_platform: HashMap<String, Vec<&TentacleReport>> = HashMap::new();
    for r in &reports {
        let platform = tentacle_platform_from_id(&r.tentacle_id);
        by_platform.entry(platform).or_default().push(r);
    }

    let mut decisions = Vec::new();

    // ── People-graph enrichment ───────────────────────────────────────────────
    // For every report that mentions a person (Slack, email), look them up in
    // people_graph so cross-domain decisions can reference relationship context.
    let mut people_context: Vec<String> = Vec::new();
    for r in &reports {
        let platform = tentacle_platform_from_id(&r.tentacle_id);
        if platform == "slack" || platform == "email" || platform == "discord" {
            // Heuristic: the sender field if present in details, else skip.
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

    // Cross-domain pattern: Slack mention + GitHub/CI activity → connect them.
    let has_slack = by_platform.contains_key("slack");
    let has_github = by_platform.contains_key("github");
    let has_ci = by_platform.contains_key("ci");

    if has_slack && (has_github || has_ci) {
        // Build a synthesis prompt for the LLM.
        let slack_summaries: Vec<String> = by_platform
            .get("slack")
            .map(|rs| rs.iter().map(|r| r.summary.clone()).collect())
            .unwrap_or_default();
        let github_summaries: Vec<String> = by_platform
            .get("github")
            .map(|rs| rs.iter().map(|r| r.summary.clone()).collect())
            .unwrap_or_default();
        let ci_summaries: Vec<String> = by_platform
            .get("ci")
            .map(|rs| rs.iter().map(|r| r.summary.clone()).collect())
            .unwrap_or_default();

        let context = format!(
            "Slack: {}\nGitHub: {}\nCI: {}\nPeople: {}",
            slack_summaries.join("; "),
            github_summaries.join("; "),
            ci_summaries.join("; "),
            if people_context.is_empty() {
                "none identified".to_string()
            } else {
                people_context.join(", ")
            }
        );

        decisions.push(Decision::Inform {
            summary: format!(
                "[Big Agent cross-domain] Activity detected across Slack + \
                 Dev channels. Context: {}",
                crate::safe_slice(&context, 400)
            ),
        });
    }

    // Email + GitHub: someone emailed about a PR?
    if by_platform.contains_key("email") && by_platform.contains_key("github") {
        decisions.push(Decision::Inform {
            summary: "[Big Agent] Email and GitHub both active — check for \
                      related PR/issue discussion."
                .to_string(),
        });
    }

    // Critical escalation: any Critical-priority report goes straight to user.
    for r in &reports {
        if r.priority == Priority::Critical {
            decisions.push(Decision::Escalate {
                reason: format!("[Big Agent escalation] {}", r.summary),
                context: r.details.to_string(),
            });
        }
    }

    // If no cross-domain pattern found, fall back to a high-level Inform.
    if decisions.is_empty() {
        let count = reports.len();
        decisions.push(Decision::Inform {
            summary: format!(
                "Hive processed {} report(s) — no cross-domain patterns detected.",
                count
            ),
        });
    }

    decisions
}

// ── Hive tick ────────────────────────────────────────────────────────────────

/// Main 30-second Hive tick:
/// 1. Poll every active tentacle for fresh reports.
/// 2. Route each report to its head.
/// 3. Each head processes: trivial → auto-handle, important → decide, critical → escalate.
/// 4. Big Agent synthesises cross-domain patterns.
/// 5. Approved (high-confidence) decisions execute; rest queue for user.
pub async fn hive_tick(app: &AppHandle) {
    // Collect active tentacle platforms.
    let active_tentacles: Vec<String> = {
        let hive = hive_lock().lock().unwrap();
        hive.tentacles
            .values()
            .filter(|t| t.status == TentacleStatus::Active)
            .map(|t| t.platform.clone())
            .collect()
    };

    // Poll each tentacle.
    let mut all_reports: Vec<TentacleReport> = Vec::new();
    for platform in &active_tentacles {
        let reports = poll_tentacle(platform).await;
        all_reports.extend(reports.clone());

        // Store into tentacle's pending queue.
        let mut hive = hive_lock().lock().unwrap();
        let tid = format!("tentacle-{}", platform);
        if let Some(t) = hive.tentacles.get_mut(&tid) {
            t.last_heartbeat = now_secs();
            t.messages_processed += reports.len() as u64;
            t.pending_reports.extend(reports);
        }
    }

    if all_reports.is_empty() {
        let mut hive = hive_lock().lock().unwrap();
        hive.last_tick = now_secs();
        return;
    }

    // Route reports to heads.
    let mut head_reports: HashMap<String, Vec<TentacleReport>> = HashMap::new();
    {
        let hive = hive_lock().lock().unwrap();
        for report in &all_reports {
            if let Some(t) = hive.tentacles.get(&report.tentacle_id) {
                head_reports
                    .entry(t.head.clone())
                    .or_default()
                    .push(report.clone());
            }
        }
    }

    // Each head processes its slice.
    let mut all_decisions: Vec<Decision> = Vec::new();
    {
        let hive = hive_lock().lock().unwrap();
        for (head_id, reports) in &head_reports {
            if let Some(head) = hive.heads.get(head_id) {
                let decisions = head_process_reports(head, reports);
                all_decisions.extend(decisions);
            }
        }
    }

    // Big Agent sees everything.
    let big_decisions = big_agent_think(all_reports.clone()).await;
    all_decisions.extend(big_decisions);

    // Separate auto-executable from pending.
    let autonomy_level = {
        let hive = hive_lock().lock().unwrap();
        hive.autonomy
    };

    let mut to_execute: Vec<Decision> = Vec::new();
    let mut to_queue: Vec<Decision> = Vec::new();

    for decision in &all_decisions {
        let auto = match decision {
            Decision::Reply { confidence, .. } => *confidence >= autonomy_level,
            Decision::Inform { .. } => true,     // always auto: just surface info
            Decision::Act { reversible, .. } => *reversible && autonomy_level >= 0.7,
            Decision::Escalate { .. } => false,   // always show to user
        };
        if auto {
            to_execute.push(decision.clone());
        } else {
            to_queue.push(decision.clone());
        }
    }

    // Execute auto decisions.
    for decision in &to_execute {
        execute_decision(app, decision).await;
    }

    // Store pending decisions back on heads.
    {
        let mut hive = hive_lock().lock().unwrap();
        // Distribute queued decisions to the appropriate head based on platform.
        for decision in &to_queue {
            let target_head = decision_to_head(decision, &hive);
            if let Some(head) = hive.heads.get_mut(&target_head) {
                head.pending_decisions.push(decision.clone());
            }
        }

        hive.last_tick = now_secs();
        hive.total_reports_processed += all_reports.len() as u64;
        hive.total_actions_taken += to_execute.len() as u64;

        // Mark all tentacle pending_reports as processed.
        for t in hive.tentacles.values_mut() {
            for r in t.pending_reports.iter_mut() {
                r.processed = true;
            }
        }
    }

    // Feed important reports into typed_memory (Fact / Decision categories).
    feed_reports_to_memory(&all_reports);

    // Emit status update to frontend.
    let status = get_hive_status();
    let _ = app.emit("hive_tick", &status);

    // Emit pending decisions for UI approval.
    if !to_queue.is_empty() {
        let _ = app.emit("hive_pending_decisions", serde_json::json!({
            "count": to_queue.len(),
            "decisions": to_queue
        }));
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
async fn execute_decision(app: &AppHandle, decision: &Decision) {
    match decision {
        Decision::Inform { summary } => {
            log::debug!("[Hive] Inform: {}", summary);
            let _ = app.emit(
                "hive_inform",
                serde_json::json!({ "summary": summary }),
            );
        }
        Decision::Reply { platform, to, draft, confidence } => {
            log::info!(
                "[Hive] Auto-reply on {} to {}: {} (conf={:.2})",
                platform, to, crate::safe_slice(draft, 60), confidence
            );
            // Log action in execution memory.
            log_hive_action(
                platform,
                &format!("auto-reply to {}: {}", to, crate::safe_slice(draft, 80)),
            );
            let _ = app.emit("hive_action", serde_json::json!({
                "type": "reply",
                "platform": platform,
                "to": to,
                "draft": draft
            }));
        }
        Decision::Act { action, platform, reversible } => {
            // Route through decision_gate before executing — BLADE's safety layer.
            let signal = crate::decision_gate::Signal {
                source: format!("hive:{}", platform),
                description: action.clone(),
                confidence: 0.75,
                reversible: *reversible,
                time_sensitive: false,
            };
            let perception = crate::perception_fusion::get_latest()
                .unwrap_or_default();
            let gate_outcome = crate::decision_gate::evaluate(&signal, &perception).await;
            // Only execute if gate approves autonomously.
            let should_exec = matches!(
                gate_outcome,
                crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
            );
            if !should_exec {
                log::info!("[Hive] decision_gate deferred Act on {}: {}", platform, crate::safe_slice(action, 60));
                let _ = app.emit("hive_action_deferred", serde_json::json!({
                    "type": "act",
                    "platform": platform,
                    "action": action,
                    "reason": "decision_gate deferred"
                }));
                return;
            }
            log::info!(
                "[Hive] Act on {}: {} (reversible={})",
                platform, crate::safe_slice(action, 80), reversible
            );
            log_hive_action(platform, action);
            let _ = app.emit("hive_action", serde_json::json!({
                "type": "act",
                "platform": platform,
                "action": action,
                "reversible": reversible
            }));
        }
        Decision::Escalate { reason, context } => {
            log::warn!("[Hive] Escalate: {}", reason);
            let _ = app.emit("hive_escalate", serde_json::json!({
                "reason": reason,
                "context": context
            }));
        }
    }
}

/// Log a Hive action into execution_memory so BLADE learns over time.
fn log_hive_action(platform: &str, action: &str) {
    if let Ok(conn) = crate::execution_memory::open_db_pub() {
        let cmd = format!("[hive:{}] {}", platform, action);
        let _ = conn.execute(
            "INSERT INTO executions (command, cwd, stdout, stderr, exit_code, duration_ms, timestamp) \
             VALUES (?1, '', '', '', 0, 0, ?2)",
            rusqlite::params![cmd, now_secs()],
        );
    }
}

/// Feed high-priority reports into typed_memory so patterns are remembered.
fn feed_reports_to_memory(reports: &[TentacleReport]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else { return };

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
        return; // already running
    }

    let mut hive = initialize_hive();
    hive.running = true;
    hive.autonomy = autonomy;

    *hive_lock().lock().unwrap() = hive;

    tauri::async_runtime::spawn(async move {
        loop {
            // Check if we should keep running.
            let running = hive_lock().lock().unwrap().running;
            if !running {
                break;
            }

            hive_tick(&app).await;

            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        }

        HIVE_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        log::info!("[Hive] Tick loop stopped.");
    });

    log::info!("[Hive] Started with autonomy={:.2}", autonomy);
}

/// Stop the Hive tick loop.
pub fn stop_hive() {
    let mut hive = hive_lock().lock().unwrap();
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
        "slack" | "discord" | "whatsapp" | "email" => "head-communications",
        "github" | "ci" => "head-development",
        "backend" => "head-operations",
        other => return Err(format!("Unknown platform: {}", other)),
    };

    let mut hive = hive_lock().lock().unwrap();

    if let Some(existing) = hive.tentacles.get_mut(&tentacle_id) {
        existing.status = TentacleStatus::Active;
        existing.last_heartbeat = now_secs();
        log::info!("[Hive] Reactivated tentacle: {}", tentacle_id);
        return Ok(tentacle_id);
    }

    let mut t = Tentacle::new(platform, head_id);
    t.status = TentacleStatus::Active;

    // Store any platform-specific config as a note in details (unused for now).
    drop(config); // config reserved for future per-platform auth tokens etc.

    let id = t.id.clone();
    hive.tentacles.insert(id.clone(), t);

    // Ensure the head knows about this tentacle.
    if let Some(head) = hive.heads.get_mut(head_id) {
        if !head.tentacles.contains(&id) {
            head.tentacles.push(id.clone());
        }
    }

    log::info!("[Hive] Spawned tentacle: {}", id);
    Ok(id)
}

/// Return a serialisable snapshot of the Hive.
pub fn get_hive_status() -> HiveStatus {
    let hive = hive_lock().lock().unwrap();

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

    let pending_decisions: usize = hive
        .heads
        .values()
        .map(|h| h.pending_decisions.len())
        .sum();

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

/// Return all unprocessed reports across all tentacles.
pub fn get_all_reports() -> Vec<TentacleReport> {
    let hive = hive_lock().lock().unwrap();
    hive.tentacles
        .values()
        .flat_map(|t| t.pending_reports.iter().filter(|r| !r.processed).cloned())
        .collect()
}

/// Approve a pending decision (by head_id + decision index) and queue for execution.
pub fn approve_decision(head_id: &str, decision_index: usize) -> Result<Decision, String> {
    let mut hive = hive_lock().lock().unwrap();
    let head = hive
        .heads
        .get_mut(head_id)
        .ok_or_else(|| format!("Unknown head: {}", head_id))?;

    if decision_index >= head.pending_decisions.len() {
        return Err(format!("Decision index {} out of range", decision_index));
    }

    let decision = head.pending_decisions.remove(decision_index);
    hive.approved_queue.push((head_id.to_string(), decision.clone()));
    Ok(decision)
}

/// Set the global autonomy level for the Hive and all Heads.
pub fn set_autonomy(level: f32) {
    let clamped = level.clamp(0.0, 1.0);
    let mut hive = hive_lock().lock().unwrap();
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
    // Persist to config.
    let mut cfg = crate::config::load_config();
    cfg.hive_autonomy = level.clamp(0.0, 1.0);
    crate::config::save_config(&cfg)
}
