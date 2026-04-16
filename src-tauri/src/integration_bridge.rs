/// integration_bridge.rs — Phase 4 MCP Integration Polling
///
/// Manages persistent, always-on connections to real-world services
/// (Gmail, Google Calendar, Slack, GitHub) via MCP servers.
///
/// When a service's MCP server is configured, real calls are made.
/// When no server is configured, simulated data is used as a placeholder
/// so the infrastructure is live and swappable at any time.

use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::AppHandle;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub title: String,
    pub start_ts: i64,     // Unix timestamp
    pub minutes_until: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationConfig {
    pub service: String,         // "gmail" | "calendar" | "slack" | "github"
    pub enabled: bool,
    pub poll_interval_secs: u32,
    pub last_poll: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationState {
    pub unread_emails: u32,
    pub upcoming_events: Vec<CalendarEvent>,
    pub slack_mentions: u32,
    pub github_notifications: u32,
    pub last_updated: i64,
}

// ── Static state ──────────────────────────────────────────────────────────────

static INTEGRATION_STATE: OnceLock<Mutex<IntegrationState>> = OnceLock::new();

fn integration_state() -> &'static Mutex<IntegrationState> {
    INTEGRATION_STATE.get_or_init(|| Mutex::new(IntegrationState::default()))
}

// Per-service config (enabled flag + last-poll timestamp), guarded by a mutex.
static INTEGRATION_CONFIGS: OnceLock<Mutex<Vec<IntegrationConfig>>> = OnceLock::new();

fn integration_configs_lock() -> &'static Mutex<Vec<IntegrationConfig>> {
    INTEGRATION_CONFIGS.get_or_init(|| Mutex::new(default_configs()))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn default_configs() -> Vec<IntegrationConfig> {
    // Services default to enabled=true so simulated data populates immediately.
    // When a real MCP server is configured, the same poll path uses live data.
    // Users can disable individual services via integration_toggle().
    vec![
        IntegrationConfig {
            service: "gmail".to_string(),
            enabled: true,
            poll_interval_secs: 120,
            last_poll: 0,
        },
        IntegrationConfig {
            service: "calendar".to_string(),
            enabled: true,
            poll_interval_secs: 300,
            last_poll: 0,
        },
        IntegrationConfig {
            service: "slack".to_string(),
            enabled: true,
            poll_interval_secs: 60,
            last_poll: 0,
        },
        IntegrationConfig {
            service: "github".to_string(),
            enabled: true,
            poll_interval_secs: 300,
            last_poll: 0,
        },
    ]
}

fn get_configs() -> Vec<IntegrationConfig> {
    integration_configs_lock().lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn set_configs(configs: Vec<IntegrationConfig>) {
    *integration_configs_lock().lock().unwrap_or_else(|e| e.into_inner()) = configs;
}

// ── MCP-aware poll helpers ────────────────────────────────────────────────────

/// Returns true if a named MCP server is registered in the current config.
fn mcp_server_registered(server_name: &str) -> bool {
    let config = crate::config::load_config();
    config
        .mcp_servers
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case(server_name))
}

/// Poll Gmail via the real MCP server (`gmail` must be in mcp_servers).
/// Falls back to simulated data if the server is not configured.
async fn poll_gmail() -> u32 {
    if !mcp_server_registered("gmail") {
        // Simulated: rotate through a small set so the UI looks live in dev
        let base = (now_secs() / 120) % 7;
        return base as u32;
    }

    // Real MCP call: gmail_search_messages with query "is:unread"
    let args = serde_json::json!({ "query": "is:unread", "maxResults": 50 });
    match call_mcp_tool("gmail", "gmail_search_messages", args).await {
        Ok(text) => {
            // The tool returns a JSON list of messages; count them.
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(arr) = v.as_array() {
                    return arr.len() as u32;
                }
                // Some servers return {"messages": [...]}
                if let Some(arr) = v["messages"].as_array() {
                    return arr.len() as u32;
                }
            }
            0
        }
        Err(e) => {
            log::warn!("[integration_bridge] gmail poll failed: {}", e);
            0
        }
    }
}

/// Poll Google Calendar for events in the next 24 hours.
async fn poll_calendar() -> Vec<CalendarEvent> {
    if !mcp_server_registered("calendar") {
        // Simulated: one event ~20 minutes from now, one ~2 hours from now
        let now = now_secs();
        return vec![
            CalendarEvent {
                title: "Team Standup".to_string(),
                start_ts: now + 20 * 60,
                minutes_until: 20,
            },
            CalendarEvent {
                title: "Product Review".to_string(),
                start_ts: now + 120 * 60,
                minutes_until: 120,
            },
        ];
    }

    let now = now_secs();
    let time_min = chrono::DateTime::from_timestamp(now, 0)
        .map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default();
    let time_max = chrono::DateTime::from_timestamp(now + 86_400, 0)
        .map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_default();

    let args = serde_json::json!({
        "timeMin": time_min,
        "timeMax": time_max,
        "maxResults": 10,
    });

    match call_mcp_tool("calendar", "gcal_list_events", args).await {
        Ok(text) => {
            let mut events = Vec::new();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                let items = v["items"].as_array().or_else(|| v.as_array());
                if let Some(arr) = items {
                    for item in arr {
                        let title = item["summary"].as_str().unwrap_or("(no title)").to_string();
                        // Try dateTime, then date
                        let start_str = item["start"]["dateTime"]
                            .as_str()
                            .or_else(|| item["start"]["date"].as_str())
                            .unwrap_or("");
                        if let Ok(dt) =
                            chrono::DateTime::parse_from_rfc3339(start_str)
                        {
                            let start_ts = dt.timestamp();
                            let minutes_until = (start_ts - now) / 60;
                            if minutes_until >= 0 {
                                events.push(CalendarEvent {
                                    title,
                                    start_ts,
                                    minutes_until,
                                });
                            }
                        }
                    }
                }
            }
            events
        }
        Err(e) => {
            log::warn!("[integration_bridge] calendar poll failed: {}", e);
            Vec::new()
        }
    }
}

/// Poll Slack for direct-message mentions.
async fn poll_slack() -> u32 {
    if !mcp_server_registered("slack") {
        let base = (now_secs() / 60) % 4;
        return base as u32;
    }

    let args = serde_json::json!({ "query": "is:dm has:mention", "count": 20 });
    match call_mcp_tool("slack", "slack_search_public_and_private", args).await {
        Ok(text) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(arr) = v["messages"]["matches"].as_array() {
                    return arr.len() as u32;
                }
            }
            0
        }
        Err(e) => {
            log::warn!("[integration_bridge] slack poll failed: {}", e);
            0
        }
    }
}

/// Poll GitHub for unread notifications.
async fn poll_github() -> u32 {
    if !mcp_server_registered("github") {
        let base = (now_secs() / 300) % 5;
        return base as u32;
    }

    // GitHub MCP typically exposes a notifications tool; try a generic approach.
    let args = serde_json::json!({ "all": false, "participating": false });
    match call_mcp_tool("github", "list_notifications", args).await {
        Ok(text) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(arr) = v.as_array() {
                    return arr.len() as u32;
                }
            }
            0
        }
        Err(e) => {
            log::warn!("[integration_bridge] github poll failed: {}", e);
            0
        }
    }
}

/// Generic MCP tool call helper. Looks up the MCP manager from a thread-safe
/// global handle stashed at startup.
async fn call_mcp_tool(
    server_name: &str,
    tool_name: &str,
    args: serde_json::Value,
) -> Result<String, String> {
    let handle = APP_HANDLE
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("AppHandle not set")?
        .clone();

    let manager_state = handle
        .try_state::<crate::commands::SharedMcpManager>()
        .ok_or("McpManager state not found")?;

    let mut manager = manager_state.lock().await;

    // Build qualified name: mcp__{server}_{tool}
    let qualified = format!("mcp__{}_{}", server_name, tool_name);

    let result = manager.call_tool(&qualified, args).await?;

    // Concatenate text content parts
    let text = result
        .content
        .iter()
        .filter_map(|c| c.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(text)
}

// ── Global AppHandle stash ────────────────────────────────────────────────────

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

fn stash_app_handle(app: AppHandle) {
    let mut guard = APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some(app);
}

/// Return a clone of the stashed AppHandle if one has been set.
/// Used by hive.rs to call MCP tools without a direct AppHandle parameter.
pub fn get_app_handle() -> Option<AppHandle> {
    APP_HANDLE.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Spawns the background polling loop. Call once from lib.rs setup when
/// `config.integration_polling_enabled` is true.
pub async fn start_integration_polling(app: AppHandle) {
    stash_app_handle(app);

    // Run one initial poll immediately so simulated data is available on first
    // call to get_integration_context(), even before the first 15-second tick.
    run_due_polls().await;

    tauri::async_runtime::spawn(async move {
        loop {
            // Tick every 15 seconds — fine-grained enough for short intervals
            tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
            run_due_polls().await;
        }
    });
}

/// Poll every enabled service that is past its interval. Extracted so both the
/// startup eager-poll and the loop body share the same logic.
async fn run_due_polls() {
    let configs = get_configs();
    let now = now_secs();

    for cfg in &configs {
        if !cfg.enabled {
            continue;
        }
        let elapsed = now - cfg.last_poll;
        if elapsed < cfg.poll_interval_secs as i64 {
            continue;
        }

        poll_service(&cfg.service).await;

        // Update last_poll timestamp
        let mut all = get_configs();
        if let Some(entry) = all.iter_mut().find(|c| c.service == cfg.service) {
            entry.last_poll = now_secs();
        }
        set_configs(all);
    }
}

/// Poll a single service and store results. Used by both the loop and
/// `integration_poll_now`.
async fn poll_service(service: &str) {
    match service {
        "gmail" => {
            let count = poll_gmail().await;
            let mut state = integration_state().lock().unwrap_or_else(|e| e.into_inner());
            state.unread_emails = count;
            state.last_updated = now_secs();
        }
        "calendar" => {
            let events = poll_calendar().await;
            let mut state = integration_state().lock().unwrap_or_else(|e| e.into_inner());
            state.upcoming_events = events;
            state.last_updated = now_secs();
        }
        "slack" => {
            let count = poll_slack().await;
            let mut state = integration_state().lock().unwrap_or_else(|e| e.into_inner());
            state.slack_mentions = count;
            state.last_updated = now_secs();
        }
        "github" => {
            let count = poll_github().await;
            let mut state = integration_state().lock().unwrap_or_else(|e| e.into_inner());
            state.github_notifications = count;
            state.last_updated = now_secs();
        }
        _ => {
            log::warn!("[integration_bridge] unknown service: {}", service);
        }
    }
}

/// Returns a snapshot of the latest integration state.
pub fn get_integration_state() -> IntegrationState {
    integration_state().lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Returns a concise 2–3 line plain-text summary for injection into the
/// system prompt. Empty string if nothing noteworthy.
pub fn get_integration_context() -> String {
    let state = get_integration_state();

    // Nothing collected yet — poll hasn't run (all services may be disabled or
    // polling hasn't fired). Return empty so we don't surface stale zeros.
    if state.last_updated == 0
        && state.unread_emails == 0
        && state.upcoming_events.is_empty()
        && state.slack_mentions == 0
        && state.github_notifications == 0
    {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();

    if state.unread_emails > 0 {
        lines.push(format!("{} unread email{}", state.unread_emails, if state.unread_emails == 1 { "" } else { "s" }));
    }

    if !state.upcoming_events.is_empty() {
        // Show the soonest event
        let soonest = &state.upcoming_events[0];
        if soonest.minutes_until < 60 {
            lines.push(format!("\"{}\" in {} min", soonest.title, soonest.minutes_until));
        } else {
            let hours = soonest.minutes_until / 60;
            lines.push(format!("\"{}\" in {}h", soonest.title, hours));
        }
    }

    if state.slack_mentions > 0 {
        lines.push(format!("{} Slack DM{}", state.slack_mentions, if state.slack_mentions == 1 { "" } else { "s" }));
    }

    if state.github_notifications > 0 {
        lines.push(format!("{} GitHub notification{}", state.github_notifications, if state.github_notifications == 1 { "" } else { "s" }));
    }

    if lines.is_empty() {
        return String::new();
    }

    format!("## Live Integrations\n\n{}", lines.join(", "))
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Returns the current IntegrationState as a JSON-serializable value.
#[tauri::command]
pub fn integration_get_state() -> IntegrationState {
    get_integration_state()
}

/// Enable or disable a service by name.
#[tauri::command]
pub fn integration_toggle(service: String, enabled: bool) -> Result<(), String> {
    let mut configs = get_configs();
    let found = configs.iter_mut().find(|c| c.service == service);
    match found {
        Some(cfg) => {
            cfg.enabled = enabled;
            set_configs(configs);
            Ok(())
        }
        None => Err(format!("Unknown integration service: {}", service)),
    }
}

/// Force an immediate poll for a specific service.
/// Works regardless of the service's enabled flag — allows the UI to trigger
/// a one-off refresh without permanently enabling background polling.
#[tauri::command]
pub async fn integration_poll_now(service: String) -> Result<IntegrationState, String> {
    let known = ["gmail", "calendar", "slack", "github"];
    if !known.contains(&service.as_str()) {
        return Err(format!("Unknown integration service: {}", service));
    }
    poll_service(&service).await;
    // Update last_poll timestamp so the background loop doesn't immediately re-poll
    let mut all = get_configs();
    if let Some(entry) = all.iter_mut().find(|c| c.service == service) {
        entry.last_poll = now_secs();
    }
    set_configs(all);
    Ok(get_integration_state())
}
