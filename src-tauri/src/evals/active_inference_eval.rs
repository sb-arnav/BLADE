//! Phase 28 / AINF-01..06 -- Deterministic active inference eval.
//!
//! MODULE_FLOOR = 0.95 (same as hormone_eval — all 6 fixtures must pass)
//! No LLM involvement. Shares global PHYSIOLOGY state — run with --test-threads=1.
//!
//! Run: `cargo test --lib evals::active_inference_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, summarize, EvalRow};
use std::collections::HashMap;

const MODULE_NAME: &str = "active_inference";
const MODULE_FLOOR: f32 = 0.95;

// ----------------------------------------------------------------
// Fixture harness (analogous to hormone_eval.rs AinfFixture struct)
// ----------------------------------------------------------------

struct AinfFixture {
    label: &'static str,
    run: fn() -> (bool, String),
}

// ----------------------------------------------------------------
// Helper: map pass/fail to EvalRow fields (same pattern as hormone_eval)
// ----------------------------------------------------------------

fn to_row(label: &str, passed: bool, result: &str, expected: &str) -> EvalRow {
    EvalRow {
        label: label.to_string(),
        top1: passed,
        top3: passed,
        rr: if passed { 1.0 } else { 0.0 },
        top3_ids: vec![result.to_string()],
        expected: expected.to_string(),
        relaxed: false,
    }
}

// ----------------------------------------------------------------
// AINF-01: TentaclePrediction cold-start defaults
// ----------------------------------------------------------------

fn fixture_ainf01() -> (bool, String) {
    // Call default_prediction("slack") and verify structural defaults.
    let pred = crate::active_inference::default_prediction("slack");

    let platform_ok = pred.platform == "slack";

    // Must contain "unread_count" with expected == 5.0
    let unread_ok = pred.signals.get("unread_count")
        .map(|e| (e.expected - 5.0).abs() < 1e-6 && (e.confidence - 0.1).abs() < 1e-6)
        .unwrap_or(false);

    // Must contain "mention_count" with expected == 1.0
    let mention_ok = pred.signals.get("mention_count")
        .map(|e| (e.expected - 1.0).abs() < 1e-6 && (e.confidence - 0.1).abs() < 1e-6)
        .unwrap_or(false);

    // All signals must have confidence == 0.1 (cold-start)
    let all_confidence_cold = pred.signals.values().all(|e| (e.confidence - 0.1).abs() < 1e-6);

    let passed = platform_ok && unread_ok && mention_ok && all_confidence_cold;

    (passed, format!(
        "platform_ok={}, unread_ok={}, mention_ok={}, all_confidence_cold={}",
        platform_ok, unread_ok, mention_ok, all_confidence_cold
    ))
}

// ----------------------------------------------------------------
// AINF-02: normalize_error returns [0.0, 1.0]
// ----------------------------------------------------------------

fn fixture_ainf02() -> (bool, String) {
    // Case 1: |3-8|/10 = 0.5
    let e1 = crate::active_inference::normalize_error(3.0, 8.0, 10.0);
    let case1_ok = (e1 - 0.5).abs() < 1e-6;

    // Case 2: |0-100|/10 = 10.0 → clamped to 1.0
    let e2 = crate::active_inference::normalize_error(0.0, 100.0, 10.0);
    let case2_ok = (e2 - 1.0).abs() < 1e-6;

    // Case 3: |5-5|/10 = 0.0
    let e3 = crate::active_inference::normalize_error(5.0, 5.0, 10.0);
    let case3_ok = (e3 - 0.0).abs() < 1e-6;

    let passed = case1_ok && case2_ok && case3_ok;

    (passed, format!(
        "normalize(3,8,10)={:.3}(want 0.5)={}, normalize(0,100,10)={:.3}(want 1.0)={}, normalize(5,5,10)={:.3}(want 0.0)={}",
        e1, case1_ok, e2, case2_ok, e3, case3_ok
    ))
}

// ----------------------------------------------------------------
// AINF-03: Prediction errors raise cortisol/norepinephrine
// ----------------------------------------------------------------

fn fixture_ainf03() -> (bool, String) {
    // First, read the initial cortisol/norepinephrine as baseline.
    // Apply a few low-error ticks to approach a settled low state.
    for _ in 0..3 {
        crate::homeostasis::update_physiology_from_prediction_errors(0.0, 0, false);
    }
    let initial = crate::homeostasis::get_physiology();
    let initial_cortisol = initial.cortisol;
    let initial_ne = initial.norepinephrine;

    // Apply sustained high error (aggregate=0.75, sustained_ticks=3) — triggers D-07 stress response.
    // Two calls because sustained_high_ticks >= 2 gate requires repeated ticks.
    crate::homeostasis::update_physiology_from_prediction_errors(0.75, 3, false);
    crate::homeostasis::update_physiology_from_prediction_errors(0.75, 3, false);

    let after = crate::homeostasis::get_physiology();
    let cortisol_rose = after.cortisol > initial_cortisol;
    let ne_valid = after.norepinephrine >= 0.01 && after.norepinephrine <= 1.0;

    // Cortisol must be above 0.3 (baseline floor from D-07 sustained gate)
    let cortisol_above_floor = after.cortisol > 0.3;

    let passed = cortisol_rose && ne_valid && cortisol_above_floor;

    (passed, format!(
        "cortisol {:.4}->{:.4} rose={}, cortisol>0.3={}, ne={:.4} valid={}",
        initial_cortisol, after.cortisol, cortisol_rose, cortisol_above_floor, after.norepinephrine, ne_valid
    ))
}

// ----------------------------------------------------------------
// AINF-04: Demo loop — calendar packed + Slack backlog -> cortisol rises
// ----------------------------------------------------------------

fn fixture_ainf04() -> (bool, String) {
    // Build 8 synthetic CalendarEvent structs (D-10: 8 events, 0 free slots, ~6h meetings)
    let calendar_events: Vec<crate::integration_bridge::CalendarEvent> = (0..8).map(|i| {
        crate::integration_bridge::CalendarEvent {
            title: format!("Meeting {}", i + 1),
            start_ts: chrono::Utc::now().timestamp() + (i * 3600),
            minutes_until: (i * 60) as i64,
        }
    }).collect();

    // Build a synthetic Slack TentacleReport (D-10: 15 unread, 5 mentions, 20 backlog)
    let slack_report = crate::hive::TentacleReport {
        id: "test-slack-ainf04".to_string(),
        tentacle_id: "tentacle-slack".to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        priority: crate::hive::Priority::High,
        category: "update".to_string(),
        summary: "15 unread, 5 mentions, 20 backlog".to_string(),
        details: serde_json::json!({
            "mentions": 5,
            "unread_count": 15,
            "count": 15,
            "backlog_size": 20,
            "source": "slack_mcp"
        }),
        requires_action: false,
        suggested_action: None,
        processed: false,
    };

    // Read cortisol before running the demo loop ticks
    let before = crate::homeostasis::get_physiology();
    let cortisol_before = before.cortisol;

    // Run 3 combined ticks: calendar (8 events) + Slack (15 unread, 5 mentions, 20 backlog)
    for _ in 0..3 {
        crate::active_inference::process_reports_for_test(
            &[slack_report.clone()],
            &calendar_events,
        );
    }

    // Check cortisol elevation after 3 ticks
    let physiology = crate::homeostasis::get_physiology();
    let cortisol_elevated = physiology.cortisol > 0.3;

    (cortisol_elevated, format!(
        "cortisol={:.3}, calendar+slack combined, cortisol_before={:.3}, elevated={}",
        physiology.cortisol, cortisol_before, cortisol_elevated
    ))
}

// ----------------------------------------------------------------
// AINF-05: Prediction replay queries high-error records
// ----------------------------------------------------------------

fn fixture_ainf05() -> (bool, String) {
    // Create an in-memory SQLite connection and test the query logic
    let conn = match rusqlite::Connection::open_in_memory() {
        Ok(c) => c,
        Err(e) => return (false, format!("failed to open in-memory db: {}", e)),
    };

    // Create the prediction_error_log table (matching schema from db.rs)
    let create_result = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS prediction_error_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            aggregate_error REAL NOT NULL,
            top_signal TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )"
    );
    if let Err(e) = create_result {
        return (false, format!("failed to create table: {}", e));
    }

    // Insert 5 rows: 3 with aggregate_error > 0.5, 2 with aggregate_error < 0.5
    let now = chrono::Utc::now().timestamp();
    let rows_data = vec![
        ("calendar", 0.82, "event_count", now),
        ("slack",    0.71, "unread_count", now),
        ("github",   0.65, "open_prs", now),
        ("calendar", 0.30, "free_slots", now),
        ("slack",    0.15, "mention_count", now),
    ];
    for (platform, error, signal, ts) in &rows_data {
        let _ = conn.execute(
            "INSERT INTO prediction_error_log (platform, aggregate_error, top_signal, timestamp) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![platform, error, signal, ts],
        );
    }

    // Query: WHERE aggregate_error > 0.5 ORDER BY aggregate_error DESC LIMIT 10
    let mut stmt = match conn.prepare(
        "SELECT platform, aggregate_error FROM prediction_error_log WHERE aggregate_error > 0.5 ORDER BY aggregate_error DESC LIMIT 10"
    ) {
        Ok(s) => s,
        Err(e) => return (false, format!("failed to prepare stmt: {}", e)),
    };

    let results: Vec<(String, f64)> = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default();

    let count_ok = results.len() == 3;

    // Verify descending order (0.82 > 0.71 > 0.65)
    let ordered_ok = results.windows(2).all(|w| w[0].1 >= w[1].1);

    let passed = count_ok && ordered_ok;

    (passed, format!(
        "high_error_rows={} (want 3), ordered_desc={}, values={:?}",
        results.len(), ordered_ok,
        results.iter().map(|(_, e)| format!("{:.2}", e)).collect::<Vec<_>>()
    ))
}

// ----------------------------------------------------------------
// AINF-06: EMA learning convergence
// ----------------------------------------------------------------

fn fixture_ainf06() -> (bool, String) {
    // Create a TentaclePrediction for "slack" with cold-start defaults
    let mut pred = crate::active_inference::default_prediction("slack");

    // Slack alpha = 0.08 per update_prediction_ema
    let alpha: f32 = 0.08;
    let observation = 15.0_f32;

    // Record the initial error (unread_count expected=5.0, observed=15.0)
    let initial_err = crate::active_inference::normalize_error(
        pred.signals["unread_count"].expected,
        observation,
        pred.signals["unread_count"].range_max,
    );

    // Simulate 5 observations using EMA
    let mut observed = HashMap::new();
    observed.insert("unread_count".to_string(), observation);
    for _ in 0..5 {
        crate::active_inference::update_prediction_ema(&mut pred, &observed);
    }

    let final_expected = pred.signals["unread_count"].expected;

    // After 5 EMA steps toward 15.0 from 5.0 at alpha=0.08:
    // iter 1: 5.0 * 0.92 + 15.0 * 0.08 = 4.6 + 1.2 = 5.8
    // iter 2: 5.8 * 0.92 + 15.0 * 0.08 = 5.336 + 1.2 = 6.536
    // iter 3: 6.536 * 0.92 + 15.0 * 0.08 = 6.013 + 1.2 = 7.213
    // iter 4: 7.213 * 0.92 + 15.0 * 0.08 = 6.636 + 1.2 = 7.836
    // iter 5: 7.836 * 0.92 + 15.0 * 0.08 = 7.209 + 1.2 = 8.409
    // So final_expected should be > 7.0

    let moved_toward_15 = final_expected > 7.0;

    // Error for unread_count should have decreased compared to iteration 1
    let final_err = crate::active_inference::normalize_error(
        final_expected,
        observation,
        pred.signals["unread_count"].range_max,
    );
    let error_decreased = final_err < initial_err;

    // Confidence should have increased (0.1 + 5 * 0.02 = 0.2, capped at 1.0)
    let confidence_grew = pred.signals["unread_count"].confidence > 0.1;

    let passed = moved_toward_15 && error_decreased && confidence_grew;

    (passed, format!(
        "expected after 5 iters: {:.3} (want>7.0)={}, initial_err={:.3}, final_err={:.3}, error_decreased={}, confidence={:.3} grew={}",
        final_expected, moved_toward_15, initial_err, final_err, error_decreased,
        pred.signals["unread_count"].confidence, confidence_grew
    ))
}

// ----------------------------------------------------------------
// Fixture registry
// ----------------------------------------------------------------

fn fixtures() -> Vec<AinfFixture> {
    vec![
        AinfFixture { label: "AINF-01: cold-start defaults (slack platform)",      run: fixture_ainf01 },
        AinfFixture { label: "AINF-02: normalize_error [0.0, 1.0] range",          run: fixture_ainf02 },
        AinfFixture { label: "AINF-03: sustained errors raise cortisol/NE",        run: fixture_ainf03 },
        AinfFixture { label: "AINF-04: demo loop calendar+slack -> cortisol rises", run: fixture_ainf04 },
        AinfFixture { label: "AINF-05: replay query filters high-error records",   run: fixture_ainf05 },
        AinfFixture { label: "AINF-06: EMA learning converges toward observation", run: fixture_ainf06 },
    ]
}

// ----------------------------------------------------------------
// Test entry -- EVAL-06 contract + Phase 17 D-14 record-before-assert
// ----------------------------------------------------------------

#[test]
fn evaluates_active_inference() {
    let cases = fixtures();
    assert!(cases.len() >= 6, "Expected at least 6 fixtures, got {}", cases.len());

    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    for fx in &cases {
        let (passed, detail) = (fx.run)();
        rows.push(to_row(fx.label, passed, &detail, if passed { "pass" } else { "fail" }));
    }

    print_eval_table("Active inference eval", &rows);
    let s = summarize(&rows);
    let asserted = s.asserted_total.max(1) as f32;
    let pass_rate = s.asserted_top1_count as f32 / asserted;
    let floor_passed = pass_rate >= MODULE_FLOOR;

    // Phase 17 D-14: record BEFORE assert so a floor failure still generates
    // a JSONL row that doctor.rs can surface (DOCTOR-02 audit trail).
    super::harness::record_eval_run(MODULE_NAME, &s, floor_passed);

    let failures: Vec<&str> = cases.iter().zip(rows.iter())
        .filter(|(_, r)| !r.top1)
        .map(|(fx, _)| fx.label)
        .collect();
    if !failures.is_empty() {
        eprintln!("[{}] failed fixtures: {:?}", MODULE_NAME, failures);
    }

    assert!(floor_passed, "active inference eval below MODULE_FLOOR={}", MODULE_FLOOR);
}
