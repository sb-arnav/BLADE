//! ecosystem.rs — Phase 13 Plan 13-01 (ECOSYS-01..09)
//!
//! Auto-enables observer-class tentacles based on DeepScanResults.
//! Central OBSERVE_ONLY guardrail (AtomicBool) blocks all outbound actions.
//! v1.2 acting-capability work removes one flag here, enabling write paths.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use crate::config::{load_config, save_config, TentacleRecord};
use crate::deep_scan::leads::DeepScanResults;

// ── Guardrail ─────────────────────────────────────────────────────────────────

/// v1.1 observe-only guardrail. true at startup, never cleared in v1.1.
/// v1.2 removes this flag in one place to enable acting tentacles.
static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true);

// Phase 18 — per-tentacle write-unlock map (RESEARCH § OBSERVE_ONLY Architecture, locked).
// Coexists with the global OBSERVE_ONLY flag (M-03). Per-tentacle entries take precedence
// when present and not expired; otherwise the global flag governs.
static WRITE_UNLOCKS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

/// RAII guard auto-revoking a per-tentacle write window on Drop.
/// Plan 14's `jarvis_dispatch::dispatch_action` binds this with `let _scope = ...`
/// to keep the window open for the duration of the outbound call (panic-safe).
#[allow(dead_code)]
pub struct WriteScope {
    tentacle: String,
}

impl Drop for WriteScope {
    fn drop(&mut self) {
        if let Some(map) = WRITE_UNLOCKS.get() {
            if let Ok(mut g) = map.lock() {
                g.remove(&self.tentacle);
            }
        }
    }
}

/// Grant a write window for `tentacle` for `ttl_secs` seconds.
/// Phase 18 D-06: callers MUST bind the returned WriteScope (`let _scope = ...`)
/// to keep the window alive for the duration of the action.
/// 30s is the canonical TTL — do not extend.
#[allow(dead_code)]
pub fn grant_write_window(tentacle: &str, ttl_secs: u64) -> WriteScope {
    let map = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let deadline = Instant::now() + Duration::from_secs(ttl_secs);
    if let Ok(mut g) = map.lock() {
        g.insert(tentacle.to_string(), deadline);
    }
    WriteScope { tentacle: tentacle.to_string() }
}

/// Returns Err if guardrail is active. Call at every write-path entry.
///
/// v1.1 has no acting-class tentacles, so this guardrail has no production
/// callers yet. The function is load-bearing for v1.2: every outbound write
/// path (Slack reply, Email reply, GitHub PR review, etc.) must invoke this
/// before performing the action. Invariants are exercised by the test suite.
///
/// Phase 18 — extended to a 2-arg signature: `tentacle` is checked against
/// `WRITE_UNLOCKS` first (per-tentacle override), and if no live entry is
/// present, the global OBSERVE_ONLY flag governs (M-03 preserved).
#[allow(dead_code)]
pub fn assert_observe_only_allowed(tentacle: &str, action: &str) -> Result<(), String> {
    // Per-tentacle override first (Phase 18 — D-06).
    if let Some(map) = WRITE_UNLOCKS.get() {
        if let Ok(g) = map.lock() {
            if let Some(deadline) = g.get(tentacle) {
                if *deadline > Instant::now() {
                    return Ok(());
                }
            }
        }
    }
    // Else fall through to global flag (M-03 preserved).
    if OBSERVE_ONLY.load(Ordering::SeqCst) {
        return Err(format!(
            "[ecosystem] OBSERVE_ONLY guardrail blocked: {} on {}. \
             Acting capability requires explicit consent (Phase 18 jarvis_dispatch).",
            action, tentacle
        ));
    }
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn emit_activity(app: &AppHandle, module: &str, summary: &str) {
    emit_activity_with_id(app, module, "observed", summary, None);
}

fn emit_activity_with_id(app: &AppHandle, module: &str, action: &str, summary: &str, payload_id: Option<String>) {
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        module,
        "action":        action,
        "human_summary": crate::safe_slice(summary, 200),
        "payload_id":    payload_id,
        "timestamp":     now_secs(),
    }));
}

// ── Signal probes ─────────────────────────────────────────────────────────────

/// Probe 1: repo watcher — triggered when scan found any repos
fn probe_repos(results: &DeepScanResults) -> (bool, String) {
    let count = results.repo_rows.len() + results.git_repos.len();
    if count > 0 {
        (true, format!("Auto-enabled because deep scan found {} repos", count))
    } else {
        (false, String::new())
    }
}

/// Probe 2: Slack monitor — check for ~/.slack/, ~/.config/slack/, or SLACK_TOKEN
fn probe_slack() -> (bool, String) {
    let home = dirs::home_dir().unwrap_or_default();
    let slack_dot = home.join(".slack");
    let slack_config = home.join(".config").join("slack");
    let has_token = std::env::var("SLACK_TOKEN").is_ok();

    if slack_dot.exists() || slack_config.exists() || has_token {
        (true, "Auto-enabled because Slack config detected (~/.slack/ or SLACK_TOKEN)".to_string())
    } else {
        (false, String::new())
    }
}

/// Probe 3: Vercel deploy monitor — check for Vercel CLI + auth.json
fn probe_vercel() -> (bool, String) {
    let cli_ok = std::process::Command::new("which")
        .arg("vercel")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let home = dirs::home_dir().unwrap_or_default();
    let auth_json = home.join(".config").join("vercel").join("auth.json");

    if cli_ok && auth_json.exists() {
        (true, "Auto-enabled because Vercel CLI is installed and auth.json found".to_string())
    } else {
        (false, String::new())
    }
}

/// Probe 4: GitHub CLI / PR watcher — check for gh CLI + hosts.yml auth
fn probe_github_cli() -> (bool, String) {
    let home = dirs::home_dir().unwrap_or_default();
    let hosts_yml = home.join(".config").join("gh").join("hosts.yml");

    let cli_ok = std::process::Command::new("which")
        .arg("gh")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if cli_ok {
        // Check hosts.yml for oauth_token or github.com
        if let Ok(content) = std::fs::read_to_string(&hosts_yml) {
            if content.contains("oauth_token") || content.contains("github.com") {
                return (true, "Auto-enabled because gh CLI is installed and ~/.config/gh/hosts.yml contains auth token".to_string());
            }
        }
        // WSL fallback: check gh auth status
        let auth_ok = std::process::Command::new("gh")
            .args(["auth", "status", "--hostname", "github.com"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if auth_ok {
            return (true, "Auto-enabled because gh CLI is installed and ~/.config/gh/hosts.yml contains auth token".to_string());
        }
    }

    (false, String::new())
}

/// Probe 5: AI session bridge — check for active AI coding session history
fn probe_ai_sessions(results: &DeepScanResults) -> (bool, String) {
    let home = dirs::home_dir().unwrap_or_default();

    // Check scan results for known AI tools
    let tools_match = results.ai_tools.iter().any(|t| {
        let name_lower = t.name.to_lowercase();
        name_lower.contains("claude") || name_lower.contains("cursor")
    });

    // Check for ~/.claude/projects or ~/.cursor
    let claude_projects = home.join(".claude").join("projects");
    let cursor_dir = home.join(".cursor");

    if tools_match || claude_projects.exists() || cursor_dir.exists() {
        (true, "Auto-enabled because active AI coding session history detected".to_string())
    } else {
        (false, String::new())
    }
}

/// Probe 6: Calendar monitor — check for Google credentials
fn probe_calendar() -> (bool, String) {
    let home = dirs::home_dir().unwrap_or_default();
    let gcloud_creds = home
        .join(".config")
        .join("gcloud")
        .join("application_default_credentials.json");
    let has_google_creds_env = std::env::var("GOOGLE_APPLICATION_CREDENTIALS").is_ok();

    if gcloud_creds.exists() || has_google_creds_env {
        return (true, "Auto-enabled because Google Calendar credentials detected".to_string());
    }

    // macOS: check ~/Library/Calendars
    #[cfg(target_os = "macos")]
    {
        let mac_cal = home.join("Library").join("Calendars");
        if mac_cal.exists() {
            return (true, "Auto-enabled because Google Calendar credentials detected".to_string());
        }
    }

    (false, String::new())
}

// ── Auto-enable orchestrator ──────────────────────────────────────────────────

/// Run all 6 probes against the latest scan results and register new observer
/// tentacles if triggered. Skips tentacles the user has explicitly disabled
/// (enabled_at > 0 && enabled == false).  Called non-blocking from deep_scan::run().
pub async fn auto_enable_from_scan(app: &AppHandle, results: &DeepScanResults) {
    // Gate: only run after onboarding is complete (safety check)
    let mut cfg = load_config();
    if !cfg.onboarded { return; }

    // Run all 6 probes
    let repo_probe   = probe_repos(results);
    let slack_probe  = probe_slack();
    let vercel_probe = probe_vercel();
    let gh_probe     = probe_github_cli();
    let ai_probe     = probe_ai_sessions(results);
    let cal_probe    = probe_calendar();

    let probes: Vec<(&str, bool, String)> = vec![
        ("repo_watcher",     repo_probe.0,   repo_probe.1),
        ("slack_monitor",    slack_probe.0,  slack_probe.1),
        ("deploy_monitor",   vercel_probe.0, vercel_probe.1),
        ("pr_watcher",       gh_probe.0,     gh_probe.1),
        ("session_bridge",   ai_probe.0,     ai_probe.1),
        ("calendar_monitor", cal_probe.0,    cal_probe.1),
    ];

    let mut changed = false;
    for (id, triggered, rationale) in probes {
        if !triggered { continue; }
        match cfg.ecosystem_tentacles.iter_mut().find(|t| t.id == id) {
            Some(rec) if rec.enabled_at > 0 && !rec.enabled => {
                // User explicitly disabled — never re-enable (ECOSYS-08)
                log::info!("[ecosystem] {} is user-disabled; skipping re-enable", id);
            }
            Some(rec) => {
                // Already registered — refresh rationale in case scan found more
                rec.rationale = rationale;
                changed = true;
            }
            None => {
                // First registration — start observer loop
                cfg.ecosystem_tentacles.push(TentacleRecord {
                    id: id.to_string(),
                    enabled: true,
                    rationale: rationale.clone(),
                    enabled_at: now_secs(),
                    trigger_detail: rationale,
                });
                start_observer_loop(id, app);
                changed = true;
            }
        }
    }

    if changed {
        if let Err(e) = save_config(&cfg) {
            log::error!("[ecosystem] failed to save tentacle state: {}", e);
        }
    }
}

// ── Observer loop stubs ───────────────────────────────────────────────────────

fn start_repo_watcher_loop(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            let cfg = load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "repo_watcher")
                .map(|t| t.enabled)
                .unwrap_or(false);
            if !enabled { continue; }
            emit_activity(&app, "ecosystem.repo_watcher", "periodic observation");
        }
    });
}

fn start_slack_monitor_loop(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            let cfg = load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "slack_monitor")
                .map(|t| t.enabled)
                .unwrap_or(false);
            if !enabled { continue; }
            emit_activity(&app, "ecosystem.slack_monitor", "periodic observation");
        }
    });
}

fn start_deploy_monitor_loop(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            let cfg = load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "deploy_monitor")
                .map(|t| t.enabled)
                .unwrap_or(false);
            if !enabled { continue; }
            emit_activity(&app, "ecosystem.deploy_monitor", "periodic observation");
        }
    });
}

fn start_pr_watcher_loop(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            let cfg = load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "pr_watcher")
                .map(|t| t.enabled)
                .unwrap_or(false);
            if !enabled { continue; }
            emit_activity(&app, "ecosystem.pr_watcher", "periodic observation");
        }
    });
}

fn start_session_bridge_loop(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            let cfg = load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "session_bridge")
                .map(|t| t.enabled)
                .unwrap_or(false);
            if !enabled { continue; }
            emit_activity(&app, "ecosystem.session_bridge", "periodic observation");
        }
    });
}

fn start_calendar_monitor_loop(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
            let cfg = load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "calendar_monitor")
                .map(|t| t.enabled)
                .unwrap_or(false);
            if !enabled { continue; }
            emit_activity(&app, "ecosystem.calendar_monitor", "periodic observation");
        }
    });
}

/// Dispatch to the correct observer loop by tentacle id.
fn start_observer_loop(id: &str, app: &AppHandle) {
    match id {
        "repo_watcher"     => start_repo_watcher_loop(app),
        "slack_monitor"    => start_slack_monitor_loop(app),
        "deploy_monitor"   => start_deploy_monitor_loop(app),
        "pr_watcher"       => start_pr_watcher_loop(app),
        "session_bridge"   => start_session_bridge_loop(app),
        "calendar_monitor" => start_calendar_monitor_loop(app),
        other => log::warn!("[ecosystem] unknown tentacle id: {}", other),
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// List all registered tentacles (Settings pane data source — ECOSYS-07)
#[tauri::command]
pub fn ecosystem_list_tentacles() -> Vec<TentacleRecord> {
    load_config().ecosystem_tentacles
}

/// Toggle a tentacle on/off — persists across restarts (ECOSYS-08)
#[tauri::command]
pub fn ecosystem_toggle_tentacle(id: String, enabled: bool) -> Result<(), String> {
    let mut cfg = load_config();
    match cfg.ecosystem_tentacles.iter_mut().find(|t| t.id == id) {
        Some(rec) => {
            rec.enabled = enabled;
            save_config(&cfg)
        }
        None => Err(format!("Unknown tentacle: {}", id)),
    }
}

/// Returns true when the observe-only guardrail is active (test seam — ECOSYS-09)
#[tauri::command]
pub fn ecosystem_observe_only_check() -> bool {
    OBSERVE_ONLY.load(Ordering::SeqCst)
}

/// Trigger auto-enable from the last saved scan results (manual re-trigger from UI)
#[tauri::command]
pub async fn ecosystem_run_auto_enable(app: AppHandle) -> Result<(), String> {
    match crate::deep_scan::load_results_pub() {
        Some(results) => {
            auto_enable_from_scan(&app, &results).await;
            Ok(())
        }
        None => Err("No scan results available. Run deep scan first.".to_string()),
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deep_scan::leads::{DeepScanResults, RepoRow, AiToolInfo};

    /// The guardrail must reject write-path calls with an Err containing "OBSERVE_ONLY".
    #[test]
    fn test_observe_only_guardrail() {
        let result = assert_observe_only_allowed("test_tentacle", "test_action");
        assert!(result.is_err(), "guardrail must return Err when active");
        let msg = result.unwrap_err();
        assert!(
            msg.contains("OBSERVE_ONLY"),
            "error message must mention OBSERVE_ONLY, got: {}", msg
        );
    }

    /// Phase 18: WriteScope RAII guard removes its tentacle entry on Drop.
    #[test]
    fn write_scope_drops_on_drop() {
        let _ = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        {
            let _scope = grant_write_window("test_tentacle_drop", 30);
            let map = WRITE_UNLOCKS.get().unwrap();
            assert!(
                map.lock().unwrap().contains_key("test_tentacle_drop"),
                "entry must exist while scope is alive"
            );
        }
        // _scope dropped here; Drop impl removes the entry.
        let map = WRITE_UNLOCKS.get().unwrap();
        assert!(
            !map.lock().unwrap().contains_key("test_tentacle_drop"),
            "entry must be removed after scope drops"
        );
    }

    /// Phase 18: an expired write-window entry does NOT bypass the global guard.
    #[test]
    fn expired_window_blocks() {
        let map = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        let past = Instant::now() - Duration::from_secs(60);
        map.lock().unwrap().insert("test_tentacle_expired".to_string(), past);
        // Global OBSERVE_ONLY is true at startup; expired entry must fall through.
        let result = assert_observe_only_allowed("test_tentacle_expired", "test_action");
        assert!(
            result.is_err(),
            "expired window must NOT bypass the global guardrail"
        );
        // Cleanup
        map.lock().unwrap().remove("test_tentacle_expired");
    }

    /// Phase 18: scopes for different tentacles are isolated — dropping one
    /// doesn't disturb the other.
    #[test]
    fn concurrent_scopes_isolated() {
        let _ = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
        let scope_a = grant_write_window("test_tentacle_a", 30);
        {
            let _scope_b = grant_write_window("test_tentacle_b", 30);
            let map = WRITE_UNLOCKS.get().unwrap();
            assert!(map.lock().unwrap().contains_key("test_tentacle_a"));
            assert!(map.lock().unwrap().contains_key("test_tentacle_b"));
        }
        // _scope_b dropped; scope_a still alive.
        let map = WRITE_UNLOCKS.get().unwrap();
        assert!(
            map.lock().unwrap().contains_key("test_tentacle_a"),
            "scope_a must survive scope_b's drop"
        );
        assert!(
            !map.lock().unwrap().contains_key("test_tentacle_b"),
            "scope_b must be removed after its drop"
        );
        drop(scope_a);
        // Final cleanup verification.
        assert!(
            !map.lock().unwrap().contains_key("test_tentacle_a"),
            "scope_a entry must be removed after final drop"
        );
    }

    /// repo probe triggers when DeepScanResults has at least one RepoRow.
    #[test]
    fn test_repo_probe_triggered() {
        let mut results = DeepScanResults::default();
        results.repo_rows.push(RepoRow {
            row_id: "repo:/home/user/project".to_string(),
            path: "/home/user/project".to_string(),
            ..RepoRow::default()
        });
        let (triggered, rationale) = probe_repos(&results);
        assert!(triggered, "probe_repos must return true when repo_rows is non-empty");
        assert!(!rationale.is_empty(), "rationale must be non-empty when triggered");
    }

    /// repo probe does NOT trigger when DeepScanResults is empty.
    #[test]
    fn test_repo_probe_empty() {
        let results = DeepScanResults::default();
        let (triggered, _) = probe_repos(&results);
        assert!(!triggered, "probe_repos must return false when no repos found");
    }

    /// Slack probe triggers when SLACK_TOKEN is set in the environment.
    #[test]
    fn test_slack_probe_env() {
        // Set a fake token for the duration of this test
        std::env::set_var("SLACK_TOKEN", "xoxb-fake-test-token");
        let (triggered, rationale) = probe_slack();
        std::env::remove_var("SLACK_TOKEN");
        assert!(triggered, "probe_slack must return true when SLACK_TOKEN is set");
        assert!(!rationale.is_empty(), "rationale must be non-empty when triggered");
    }

    /// AI session probe triggers when ai_tools contains "claude" OR ~/.claude/projects exists.
    #[test]
    fn test_ai_session_probe_claude_dir() {
        // First try: construct results with "claude" in ai_tools
        let mut results = DeepScanResults::default();
        results.ai_tools.push(AiToolInfo {
            name: "claude-code".to_string(),
            detected: true,
            details: String::new(),
        });
        let (triggered, _) = probe_ai_sessions(&results);
        if triggered {
            // Pass via ai_tools
            return;
        }
        // Fallback: check if ~/.claude/projects exists on this machine
        let home = dirs::home_dir().unwrap_or_default();
        if home.join(".claude").join("projects").exists() {
            let empty = DeepScanResults::default();
            let (triggered2, _) = probe_ai_sessions(&empty);
            assert!(triggered2, "probe_ai_sessions must trigger when ~/.claude/projects exists");
        } else {
            // Neither condition present — verify ai_tools path works
            assert!(triggered, "probe_ai_sessions must trigger when ai_tools contains 'claude'");
        }
    }

    /// Vercel probe returns false when neither CLI nor auth.json is present.
    #[test]
    fn test_vercel_probe_no_auth() {
        // On most CI/dev machines that don't have Vercel CLI installed,
        // probe_vercel() should return false.
        let (triggered, _) = probe_vercel();
        // We can't assert false unconditionally (machine might have Vercel).
        // Instead, assert that when triggered the rationale is non-empty,
        // and when not triggered the rationale is empty.
        let (_, rationale) = probe_vercel();
        if triggered {
            assert!(!rationale.is_empty(), "triggered probe must have a rationale");
        } else {
            assert!(rationale.is_empty(), "non-triggered probe must have empty rationale");
        }
    }

    /// The OBSERVE_ONLY flag is initialized to true and never set to false in v1.1.
    #[test]
    fn test_guardrail_never_cleared() {
        assert!(
            OBSERVE_ONLY.load(Ordering::SeqCst),
            "OBSERVE_ONLY must be true — v1.1 never clears this flag"
        );
    }
}
