/// active_inference.rs — Phase 28 / AINF-01..03, AINF-06
///
/// Active inference foundation for BLADE's Hive mesh.
/// Each tentacle type maintains a prediction of expected state; observations
/// produce prediction errors; errors modulate the hormone bus (homeostasis.rs).
///
/// Decision refs: D-01 through D-09, D-15 through D-17, D-19 (CONTEXT.md).
/// Security: T-28-01 (clamp extracted values), T-28-02 (FIFO prune log),
///            T-28-04 (aggregate clamped + sustained-tick gate).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

// ── Structs (D-02) ────────────────────────────────────────────────────────────

/// Expected value + confidence for a single named signal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalExpectation {
    /// The EMA-smoothed expected value.
    pub expected: f32,
    /// Confidence in this expectation (0.0 = cold-start, 1.0 = fully learned).
    pub confidence: f32,
    /// Maximum plausible value for this signal — used for normalization.
    pub range_max: f32,
}

/// Per-tentacle prediction state keyed by signal name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentaclePrediction {
    pub platform: String,
    pub signals: HashMap<String, SignalExpectation>,
    pub updated_at: i64,
}

/// Public summary snapshot for DoctorPane consumption (D-18).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveInferenceState {
    pub aggregate_error: f32,
    pub top_tentacle: String,
    pub tracked_count: usize,
    /// True when cortisol > 0.4 AND any tentacle error > 0.5.
    pub demo_loop_active: bool,
}

// ── Global state (D-03) ──────────────────────────────────────────────────────

static PREDICTIONS: OnceLock<Mutex<HashMap<String, TentaclePrediction>>> = OnceLock::new();

/// Counts consecutive ticks where aggregate_error > 0.6 (for D-07 sustained-high gate).
static SUSTAINED_HIGH_TICKS: AtomicU32 = AtomicU32::new(0);

/// Set to true after first call to compute_prediction_errors — lets demo_loop_active check work.
static INITIALIZED: AtomicBool = AtomicBool::new(false);

fn predictions_store() -> &'static Mutex<HashMap<String, TentaclePrediction>> {
    PREDICTIONS.get_or_init(|| Mutex::new(load_predictions_from_db()))
}

/// Clone of the current prediction map — safe to hold without lock.
pub fn get_predictions() -> HashMap<String, TentaclePrediction> {
    predictions_store()
        .lock()
        .map(|m| m.clone())
        .unwrap_or_default()
}

/// Snapshot summary for DoctorPane / StatusBar rendering.
pub fn get_active_inference_state() -> ActiveInferenceState {
    let preds = get_predictions();
    let tracked_count = preds.len();

    // Compute per-tentacle errors using stored expected values vs themselves
    // (approximate — only meaningful after observations have been ingested).
    let errors: HashMap<String, f32> = preds
        .iter()
        .map(|(platform, pred)| {
            // Use 0.0 as "no observed" — means we report 0 error when no tick yet.
            let err = prediction_error_for_tentacle(pred, &HashMap::new());
            (platform.clone(), err)
        })
        .collect();

    let (aggregate_error, top_tentacle) = compute_aggregate_error(&errors);

    let physiology = crate::homeostasis::get_physiology();
    let any_tentacle_high = errors.values().any(|&e| e > 0.5);
    let demo_loop_active = INITIALIZED.load(Ordering::SeqCst)
        && physiology.cortisol > 0.4
        && any_tentacle_high;

    ActiveInferenceState {
        aggregate_error,
        top_tentacle,
        tracked_count,
        demo_loop_active,
    }
}

// ── Cold-start defaults (D-17) ───────────────────────────────────────────────

/// Returns cold-start TentaclePrediction for a given platform.
/// Called when no persisted state exists (first run or new tentacle type).
pub(crate) fn default_prediction(platform: &str) -> TentaclePrediction {
    let mut signals = HashMap::new();
    match platform {
        "calendar" => {
            signals.insert("event_count".into(), SignalExpectation { expected: 3.0, confidence: 0.1, range_max: 10.0 });
            signals.insert("free_slots".into(), SignalExpectation { expected: 2.0, confidence: 0.1, range_max: 8.0 });
            signals.insert("meeting_hours".into(), SignalExpectation { expected: 2.0, confidence: 0.1, range_max: 8.0 });
        }
        "slack" => {
            signals.insert("unread_count".into(), SignalExpectation { expected: 5.0, confidence: 0.1, range_max: 50.0 });
            signals.insert("mention_count".into(), SignalExpectation { expected: 1.0, confidence: 0.1, range_max: 20.0 });
            signals.insert("backlog_size".into(), SignalExpectation { expected: 3.0, confidence: 0.1, range_max: 30.0 });
        }
        "github" => {
            signals.insert("open_prs".into(), SignalExpectation { expected: 2.0, confidence: 0.1, range_max: 20.0 });
            signals.insert("review_requests".into(), SignalExpectation { expected: 1.0, confidence: 0.1, range_max: 10.0 });
            signals.insert("ci_failures".into(), SignalExpectation { expected: 0.0, confidence: 0.1, range_max: 5.0 });
        }
        _ => {}
    }
    TentaclePrediction {
        platform: platform.to_string(),
        signals,
        updated_at: chrono::Utc::now().timestamp(),
    }
}

// ── Signal extraction (D-05) ─────────────────────────────────────────────────

/// Extract platform-specific signals from a TentacleReport payload.
/// All values are clamped to [0.0, range_max] per T-28-01 to prevent injection via malformed payloads.
fn extract_signals_from_report(report: &crate::hive::TentacleReport) -> HashMap<String, f32> {
    let mut signals = HashMap::new();
    let d = &report.details;

    if report.tentacle_id.starts_with("tentacle-slack") {
        let unread_count = d.get("count")
            .or_else(|| d.get("unread_count"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let mention_count = d.get("mentions")
            .or_else(|| d.get("mention_count"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        // backlog_size approximated from unread_count per RESEARCH open question 2
        let backlog_size = unread_count;

        signals.insert("unread_count".into(), unread_count.clamp(0.0, 50.0));
        signals.insert("mention_count".into(), mention_count.clamp(0.0, 20.0));
        signals.insert("backlog_size".into(), backlog_size.clamp(0.0, 30.0));
    } else if report.tentacle_id.starts_with("tentacle-github") {
        let open_prs = d.get("count")
            .or_else(|| d.get("open_prs"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let review_requests = d.get("review_requests")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let ci_failures = d.get("ci_failures")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;

        signals.insert("open_prs".into(), open_prs.clamp(0.0, 20.0));
        signals.insert("review_requests".into(), review_requests.clamp(0.0, 10.0));
        signals.insert("ci_failures".into(), ci_failures.clamp(0.0, 5.0));
    }
    // Other tentacle types: not tracked for prediction — return empty HashMap

    signals
}

/// Extract calendar signals from CalendarEvent slices.
///
/// PURE FUNCTION — accepts `&[CalendarEvent]` directly so both production code
/// and test fixtures can call it without touching global state.
///
/// Production: `extract_calendar_signals(&crate::integration_bridge::get_integration_state().upcoming_events)`
/// Tests: `extract_calendar_signals(&synthetic_events)`
pub(crate) fn extract_calendar_signals(events: &[crate::integration_bridge::CalendarEvent]) -> HashMap<String, f32> {
    let event_count = events.len() as f32;
    // Approximate: 0.75 hours per meeting on average
    let meeting_hours = (event_count * 0.75).clamp(0.0, 8.0);
    let free_slots = (8.0 - event_count).max(0.0).clamp(0.0, 8.0);

    let mut signals = HashMap::new();
    signals.insert("event_count".into(), event_count.clamp(0.0, 10.0));
    signals.insert("meeting_hours".into(), meeting_hours);
    signals.insert("free_slots".into(), free_slots);
    signals
}

// ── Normalization (D-04) ─────────────────────────────────────────────────────

/// Normalize a prediction error for a single signal to [0.0, 1.0].
/// `range_max` is the largest plausible value for this signal type.
pub fn normalize_error(expected: f32, observed: f32, range_max: f32) -> f32 {
    ((expected - observed).abs() / range_max.max(1.0)).min(1.0)
}

/// Compute a weighted prediction error for an entire tentacle.
/// Weights are the per-signal confidence values.
/// Returns 0.0 if no matching signals (cold-start or no observations).
pub fn prediction_error_for_tentacle(pred: &TentaclePrediction, observed: &HashMap<String, f32>) -> f32 {
    let mut weighted_sum = 0.0_f32;
    let mut total_weight = 0.0_f32;

    for (signal_name, expectation) in &pred.signals {
        if let Some(&obs_val) = observed.get(signal_name) {
            let err = normalize_error(expectation.expected, obs_val, expectation.range_max);
            weighted_sum += err * expectation.confidence;
            total_weight += expectation.confidence;
        }
    }

    if total_weight > 0.0 {
        (weighted_sum / total_weight).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

// ── EMA learning (D-15, D-16) ────────────────────────────────────────────────

/// Update prediction expectations using EMA after an observation.
/// Per-tentacle alpha: calendar=0.1, slack=0.08, github=0.05, default=0.07.
/// Confidence increases by 0.02 per observation (capped at 1.0).
pub(crate) fn update_prediction_ema(prediction: &mut TentaclePrediction, observed: &HashMap<String, f32>) {
    let alpha = match prediction.platform.as_str() {
        "calendar" => 0.1,
        "slack"    => 0.08,
        "github"   => 0.05,
        _          => 0.07,
    };

    for (signal_name, obs_val) in observed {
        if let Some(entry) = prediction.signals.get_mut(signal_name) {
            entry.expected = entry.expected * (1.0 - alpha) + obs_val * alpha;
            entry.confidence = (entry.confidence + 0.02).min(1.0);
        }
    }

    prediction.updated_at = chrono::Utc::now().timestamp();
}

// ── Aggregate computation (D-08) ─────────────────────────────────────────────

/// Compute the weighted aggregate prediction error across all tentacles.
/// Error/Dormant/Disconnected tentacles contribute 0 weight per D-08.
/// Calendar is treated as Active (it has no Hive tentacle entry).
///
/// Returns (aggregate_error, top_tentacle_platform).
fn compute_aggregate_error(errors: &HashMap<String, f32>) -> (f32, String) {
    let hive_status = crate::hive::get_hive_status();
    let status_map: HashMap<String, crate::hive::TentacleStatus> = hive_status
        .tentacles
        .iter()
        .map(|t| {
            // Strip "tentacle-" prefix to get platform key
            let platform = t.id.strip_prefix("tentacle-").unwrap_or(&t.id).to_string();
            (platform, t.status.clone())
        })
        .collect();

    compute_aggregate_error_with_statuses(errors, &status_map)
}

/// Same as compute_aggregate_error but accepts explicit statuses.
/// Used by test fixtures to control tentacle statuses without touching global state.
pub(crate) fn compute_aggregate_error_with_statuses(
    errors: &HashMap<String, f32>,
    statuses: &HashMap<String, crate::hive::TentacleStatus>,
) -> (f32, String) {
    if errors.is_empty() {
        return (0.0, "none".to_string());
    }

    let mut weighted_sum = 0.0_f32;
    let mut total_weight = 0.0_f32;
    let mut top_platform = "none".to_string();
    let mut top_error = -1.0_f32;

    for (platform, &err) in errors {
        // calendar has no Hive tentacle — always treated as Active
        let is_calendar = platform == "calendar";
        let weight = if is_calendar {
            1.0
        } else {
            match statuses.get(platform) {
                Some(crate::hive::TentacleStatus::Active) => 1.0,
                Some(crate::hive::TentacleStatus::Error)
                | Some(crate::hive::TentacleStatus::Dormant)
                | Some(crate::hive::TentacleStatus::Disconnected) => 0.0,
                None => 1.0, // unknown status → include (conservative)
            }
        };

        weighted_sum += err * weight;
        total_weight += weight;

        // Top tentacle is determined from ALL entries (including 0-weight)
        if err > top_error {
            top_error = err;
            top_platform = platform.clone();
        }
    }

    let aggregate = if total_weight > 0.0 {
        (weighted_sum / total_weight).clamp(0.0, 1.0)
    } else {
        0.0
    };

    (aggregate, top_platform)
}

// ── Main entry point (D-09) ──────────────────────────────────────────────────

/// Run one prediction error computation cycle.
/// Called from hive_tick() after reports are collected (Plan 02 wires this in).
///
/// Steps:
/// 1. Extract signals from each report by platform
/// 2. Extract calendar signals (pure function — reads integration_bridge global)
/// 3. For each platform: compute error, update EMA, collect (platform, error)
/// 4. Compute aggregate + top tentacle (D-08 weighting)
/// 5. Detect single-tentacle spike (novelty signal)
/// 6. Update SUSTAINED_HIGH_TICKS
/// 7. Call hormone bus update
/// 8. Persist predictions to SQLite
/// 9. Log error to prediction_error_log (prune first per T-28-02)
/// 10. Emit ActivityStrip event if threshold crossed
pub async fn compute_prediction_errors(
    app: &tauri::AppHandle,
    reports: &[crate::hive::TentacleReport],
) {
    INITIALIZED.store(true, Ordering::SeqCst);

    // Step 1: Extract signals from Hive reports, grouped by platform
    let mut observed_by_platform: HashMap<String, HashMap<String, f32>> = HashMap::new();
    for report in reports {
        let signals = extract_signals_from_report(report);
        if signals.is_empty() {
            continue;
        }
        let platform = if report.tentacle_id.starts_with("tentacle-slack") {
            "slack"
        } else if report.tentacle_id.starts_with("tentacle-github") {
            "github"
        } else {
            continue;
        };
        let entry = observed_by_platform.entry(platform.to_string()).or_default();
        for (k, v) in signals {
            entry.insert(k, v);
        }
    }

    // Step 2: Calendar signals (pure function, no lock dependency)
    let calendar_signals = extract_calendar_signals(
        &crate::integration_bridge::get_integration_state().upcoming_events,
    );
    if !calendar_signals.is_empty() {
        observed_by_platform.insert("calendar".to_string(), calendar_signals);
    }

    if observed_by_platform.is_empty() {
        return;
    }

    // Step 3: Compute errors, update EMA, collect results
    let mut errors: HashMap<String, f32> = HashMap::new();
    {
        let mut preds = predictions_store()
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        for (platform, observed) in &observed_by_platform {
            let pred = preds
                .entry(platform.clone())
                .or_insert_with(|| default_prediction(platform));

            let err = prediction_error_for_tentacle(pred, observed);
            errors.insert(platform.clone(), err);

            update_prediction_ema(pred, observed);
        }

        // Step 8: Persist predictions to SQLite (while still holding lock snapshot)
        let snapshot: HashMap<String, TentaclePrediction> = preds.clone();
        drop(preds); // release lock before DB IO
        persist_predictions_to_db(&snapshot);
    }

    // Step 4: Aggregate (D-08 weighting)
    let (aggregate_error, top_tentacle) = compute_aggregate_error(&errors);

    // Step 5: Detect single-tentacle spike
    let high_count = errors.values().filter(|&&e| e > 0.7).count();
    let low_count = errors.values().filter(|&&e| e < 0.3).count();
    let is_single_spike = high_count == 1 && low_count + 1 >= errors.len();

    // Step 6: Update SUSTAINED_HIGH_TICKS (T-28-04 gate)
    if aggregate_error > 0.6 {
        SUSTAINED_HIGH_TICKS.fetch_add(1, Ordering::SeqCst);
    } else {
        SUSTAINED_HIGH_TICKS.store(0, Ordering::SeqCst);
    }
    let sustained_ticks = SUSTAINED_HIGH_TICKS.load(Ordering::SeqCst);

    // Step 7: Hormone bus update
    crate::homeostasis::update_physiology_from_prediction_errors(
        aggregate_error,
        sustained_ticks,
        is_single_spike,
    );

    // Step 9: Log to prediction_error_log (prune before insert per T-28-02)
    let top_signal = errors
        .iter()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(k, _)| k.as_str())
        .unwrap_or("");
    log_prediction_error(&top_tentacle, aggregate_error, top_signal);

    // Step 10: Emit ActivityStrip threshold event
    if aggregate_error > 0.5 {
        let summary = format!(
            "prediction_error {:.2} top={} sustained={}",
            aggregate_error, top_tentacle, sustained_ticks
        );
        let _ = app.emit_to(
            "main",
            "blade_activity_log",
            serde_json::json!({
                "module":        "active_inference",
                "action":        "prediction_error_threshold",
                "human_summary": crate::safe_slice(&summary, 200),
                "payload_id":    serde_json::Value::Null,
                "timestamp":     chrono::Utc::now().timestamp(),
            }),
        );
    }
}

// ── Test-only entry point ─────────────────────────────────────────────────────

/// Synchronous test wrapper — no app handle, no SQLite, no emit.
/// Accepts synthetic TentacleReport AND CalendarEvent slices for full fixture control.
/// Uses all-Active statuses for test isolation (no Hive global state dependency).
pub fn process_reports_for_test(
    reports: &[crate::hive::TentacleReport],
    calendar_events: &[crate::integration_bridge::CalendarEvent],
) {
    INITIALIZED.store(true, Ordering::SeqCst);

    // Extract signals from Hive reports
    let mut observed_by_platform: HashMap<String, HashMap<String, f32>> = HashMap::new();
    for report in reports {
        let signals = extract_signals_from_report(report);
        if signals.is_empty() {
            continue;
        }
        let platform = if report.tentacle_id.starts_with("tentacle-slack") {
            "slack"
        } else if report.tentacle_id.starts_with("tentacle-github") {
            "github"
        } else {
            continue;
        };
        let entry = observed_by_platform.entry(platform.to_string()).or_default();
        for (k, v) in signals {
            entry.insert(k, v);
        }
    }

    // Inject synthetic calendar events (pure function)
    let calendar_signals = extract_calendar_signals(calendar_events);
    if !calendar_signals.is_empty() {
        observed_by_platform.insert("calendar".to_string(), calendar_signals);
    }

    if observed_by_platform.is_empty() {
        return;
    }

    // Compute errors + update EMA
    let mut errors: HashMap<String, f32> = HashMap::new();
    {
        let mut preds = predictions_store()
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        for (platform, observed) in &observed_by_platform {
            let pred = preds
                .entry(platform.clone())
                .or_insert_with(|| default_prediction(platform));

            let err = prediction_error_for_tentacle(pred, observed);
            errors.insert(platform.clone(), err);

            update_prediction_ema(pred, observed);
        }
    }

    // Use all-Active statuses for test isolation (no Hive global state)
    let all_active_statuses: HashMap<String, crate::hive::TentacleStatus> = errors
        .keys()
        .filter(|p| p.as_str() != "calendar")
        .map(|p| (p.clone(), crate::hive::TentacleStatus::Active))
        .collect();

    let (aggregate_error, _top_tentacle) =
        compute_aggregate_error_with_statuses(&errors, &all_active_statuses);

    let high_count = errors.values().filter(|&&e| e > 0.7).count();
    let low_count = errors.values().filter(|&&e| e < 0.3).count();
    let is_single_spike = high_count == 1 && low_count + 1 >= errors.len();

    if aggregate_error > 0.6 {
        SUSTAINED_HIGH_TICKS.fetch_add(1, Ordering::SeqCst);
    } else {
        SUSTAINED_HIGH_TICKS.store(0, Ordering::SeqCst);
    }
    let sustained_ticks = SUSTAINED_HIGH_TICKS.load(Ordering::SeqCst);

    crate::homeostasis::update_physiology_from_prediction_errors(
        aggregate_error,
        sustained_ticks,
        is_single_spike,
    );
}

// ── SQLite persistence (D-19) ────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

/// Load all TentaclePredictions from SQLite on module init.
/// Returns empty HashMap on any error (cold-start path).
fn load_predictions_from_db() -> HashMap<String, TentaclePrediction> {
    let path = db_path();
    let conn = match rusqlite::Connection::open(&path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT platform, data FROM tentacle_predictions",
    ) {
        Ok(s) => s,
        Err(_) => return HashMap::new(),
    };

    let rows = stmt.query_map([], |row| {
        let platform: String = row.get(0)?;
        let data: String = row.get(1)?;
        Ok((platform, data))
    });

    let mut map = HashMap::new();
    if let Ok(rows) = rows {
        for row in rows.flatten() {
            if let Ok(pred) = serde_json::from_str::<TentaclePrediction>(&row.1) {
                map.insert(row.0, pred);
            }
        }
    }
    map
}

/// Persist all predictions to SQLite after each tick (D-16 — no batching).
fn persist_predictions_to_db(predictions: &HashMap<String, TentaclePrediction>) {
    let path = db_path();
    let conn = match rusqlite::Connection::open(&path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let now = chrono::Utc::now().timestamp();
    for (platform, pred) in predictions {
        if let Ok(json) = serde_json::to_string(pred) {
            let _ = conn.execute(
                "INSERT INTO tentacle_predictions (platform, data, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(platform) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                rusqlite::params![platform, json, now],
            );
        }
    }
}

/// Log a prediction error entry. Prunes to 999 rows BEFORE inserting per T-28-02 / D-19.
fn log_prediction_error(platform: &str, aggregate_error: f32, top_signal: &str) {
    let path = db_path();
    let conn = match rusqlite::Connection::open(&path) {
        Ok(c) => c,
        Err(_) => return,
    };

    // Prune first: keep the 999 most recent rows
    let _ = conn.execute(
        "DELETE FROM prediction_error_log WHERE id NOT IN (SELECT id FROM prediction_error_log ORDER BY timestamp DESC LIMIT 999)",
        [],
    );

    let now = chrono::Utc::now().timestamp();
    let _ = conn.execute(
        "INSERT INTO prediction_error_log (platform, aggregate_error, top_signal, timestamp) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![platform, aggregate_error, top_signal, now],
    );
}
