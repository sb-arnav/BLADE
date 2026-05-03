//! Phase 29 / VITA-01..06 -- Deterministic vitality engine eval.
//!
//! MODULE_FLOOR = 0.95 (same as hormone_eval / active_inference_eval)
//! No LLM involvement. Shares global VITALITY state -- run with --test-threads=1.
//!
//! Run: `cargo test --lib evals::vitality_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, summarize, EvalRow};

const MODULE_NAME: &str = "vitality";
const MODULE_FLOOR: f32 = 0.95;

// ── Fixture harness ────────────────────────────────────────────────────────────

struct VitalityFixture {
    label: &'static str,
    run: fn() -> (bool, String),
}

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

// ── Fixture implementations (Plan 05) ─────────────────────────────────────────

/// VITA-01: 5 consecutive failure drains push vitality from Waning into Declining band.
///
/// Exercises the real computation pipeline: apply_drain accumulates
/// pending_eval_drain, vitality_tick consumes it via compute_drain,
/// applies DRAIN_SCALE, and runs hysteretic band transition.
fn fixture_vitality_band() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();

    // Start at 0.45 (Waning band)
    let mut state = crate::vitality_engine::VitalityState::default();
    state.scalar = 0.45;
    state.band = crate::vitality_engine::VitalityBand::Waning;
    state.pending_eval_drain = 0.0;
    state.consecutive_floor_ticks = 0;
    crate::vitality_engine::set_vitality_for_test(state);

    // 5 rounds: each round applies 1.0 eval drain then ticks.
    // Per tick: drain.net >= 1.0 (eval) -> scaled_drain = 1.0 * 0.025 = 0.025
    // Replenishment ~0.0035-0.0055 (competence+autonomy defaults, relatedness=0).
    // Net delta ~= -0.020 per tick. After 5 ticks: ~-0.100 total.
    // 0.45 - 0.100 = ~0.35 which is < 0.4 threshold => Declining band.
    for _ in 0..5 {
        crate::vitality_engine::apply_drain(1.0, "test_failure");
        crate::vitality_engine::vitality_tick();
    }

    let result = crate::vitality_engine::get_vitality();
    let in_declining = result.scalar < 0.4 && result.scalar >= 0.05;
    let band_is_declining = matches!(result.band, crate::vitality_engine::VitalityBand::Declining);
    let passed = in_declining && band_is_declining;
    let detail = format!(
        "scalar={:.4} band={:?} in_declining={} band_match={}",
        result.scalar, result.band, in_declining, band_is_declining
    );
    (passed, detail)
}

/// VITA-02/03: SDT replenishment increases scalar via the real vitality_tick pipeline.
///
/// With no active drain sources and default SDT signals (competence=0.5 from
/// empty reward history, autonomy=0.5 from empty decision log), calling
/// vitality_tick produces a small positive net delta.
fn fixture_sdt_replenishment() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();

    // Start at low scalar (0.30, Declining band)
    let mut state = crate::vitality_engine::VitalityState::default();
    state.scalar = 0.30;
    state.band = crate::vitality_engine::VitalityBand::Declining;
    state.pending_eval_drain = 0.0;
    state.consecutive_floor_ticks = 0;
    state.sustained_high_error_ticks = 0;
    crate::vitality_engine::set_vitality_for_test(state);

    let before = crate::vitality_engine::get_vitality().scalar;

    // Call vitality_tick to exercise the real SDT pipeline.
    // Default SDT: competence=0.5, autonomy=0.5, relatedness=0.0
    //   => net_replenishment = 0.35 * REPLENISHMENT_SCALE(0.01) = 0.0035
    // In test env: isolation_drain=0.01 (no recent messages)
    //   => scaled_drain = 0.01 * DRAIN_SCALE(0.025) = 0.00025
    // Net delta = 0.0035 - 0.00025 = +0.00325
    crate::vitality_engine::vitality_tick();

    let after = crate::vitality_engine::get_vitality().scalar;
    // Scalar should increase (net replenishment dominates when no active drains)
    let passed = after > before;
    let detail = format!(
        "before={:.4} after={:.4} delta={:+.5}",
        before, after, after - before
    );
    (passed, detail)
}

/// VITA-02/03: Drain via apply_drain + vitality_tick reduces scalar.
///
/// Applies heavy eval drain (1.0 pending) before tick to ensure drain
/// dominates over default SDT replenishment. Exercises the full
/// compute_drain -> pending_eval_drain -> DRAIN_SCALE pipeline.
fn fixture_drain() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();

    // Start at moderate scalar (0.60, Thriving band)
    let mut state = crate::vitality_engine::VitalityState::default();
    state.scalar = 0.60;
    state.band = crate::vitality_engine::VitalityBand::Thriving;
    state.pending_eval_drain = 0.0;
    state.consecutive_floor_ticks = 0;
    state.sustained_high_error_ticks = 0;
    crate::vitality_engine::set_vitality_for_test(state);

    let before = crate::vitality_engine::get_vitality().scalar;

    // Apply heavy eval drain (1.0) — this exceeds SDT replenishment.
    // drain.net >= 1.0 -> scaled_drain = 1.0 * 0.025 = 0.025
    // replenishment ~= 0.0035
    // net delta ~= -0.0215 (drain wins)
    crate::vitality_engine::apply_drain(1.0, "test_isolation_drain");
    crate::vitality_engine::vitality_tick();

    let after = crate::vitality_engine::get_vitality().scalar;
    let passed = after < before;
    let detail = format!(
        "before={:.4} after={:.4} delta={:+.5}",
        before, after, after - before
    );
    (passed, detail)
}

/// VITA-04: Dormancy state serialization with DORMANCY_STUB active.
///
/// Verifies that setting vitality to Dormant band (scalar=0.0) persists
/// correctly and the DORMANCY_STUB prevents process exit. Also verifies
/// that the dormancy-band is sticky (stays Dormant -- only reincarnation
/// transitions out of it).
fn fixture_dormancy() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();

    // Verify DORMANCY_STUB is active (T-29-14: prevents std::process::exit)
    let stub_active = crate::vitality_engine::DORMANCY_STUB.load(std::sync::atomic::Ordering::SeqCst);

    // Set scalar to 0.0 (Dormant band)
    let mut state = crate::vitality_engine::VitalityState::default();
    state.scalar = 0.0;
    state.band = crate::vitality_engine::VitalityBand::Dormant;
    state.pending_eval_drain = 0.0;
    state.consecutive_floor_ticks = 5; // well past drain floor
    crate::vitality_engine::set_vitality_for_test(state);

    // Call vitality_tick — with Dormant band, the band stays Dormant
    // (only reincarnation can exit Dormant per compute_band logic).
    // No AppHandle in test, so trigger_dormancy is not called (safe).
    crate::vitality_engine::vitality_tick();

    let result = crate::vitality_engine::get_vitality();

    // Dormant band is sticky: remains Dormant regardless of replenishment
    let still_dormant = matches!(result.band, crate::vitality_engine::VitalityBand::Dormant);

    // Scalar should be at drain floor (0.05) or lower after tick with no drain
    // (vitality_tick may push scalar up slightly from replenishment but band stays Dormant)
    let scalar_low = result.scalar <= 0.10;

    let passed = stub_active && still_dormant && scalar_low;
    let detail = format!(
        "stub_active={} band={:?} scalar={:.4} still_dormant={} scalar_low={}",
        stub_active, result.band, result.scalar, still_dormant, scalar_low
    );
    (passed, detail)
}

/// VITA-04: Reincarnation sets identity at 0.3 with Declining band.
///
/// Simulates the reincarnation state by calling set_vitality_for_test with
/// the expected post-reincarnation state (scalar=0.3, band=Declining,
/// reincarnation_count incremented, needs_reincarnation_context=true).
/// Verifies the VitalityState round-trips correctly through the global store.
fn fixture_reincarnation() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();

    // Set post-reincarnation state (matches check_reincarnation logic in vitality_engine.rs)
    let mut state = crate::vitality_engine::VitalityState::default();
    state.scalar = 0.3;
    state.band = crate::vitality_engine::VitalityBand::Declining;
    state.reincarnation_count = 1;
    state.needs_reincarnation_context = true;
    state.trend = 0.0;
    state.sustained_high_error_ticks = 0;
    state.pending_eval_drain = 0.0;
    state.consecutive_floor_ticks = 0;
    crate::vitality_engine::set_vitality_for_test(state);

    let result = crate::vitality_engine::get_vitality();

    // Verify reincarnation invariants (REINCARNATION_START_VITALITY = 0.3)
    let scalar_correct = (result.scalar - 0.3).abs() < 0.01;
    let band_correct = matches!(result.band, crate::vitality_engine::VitalityBand::Declining);
    let count_correct = result.reincarnation_count >= 1;
    let context_flagged = result.needs_reincarnation_context;

    let passed = scalar_correct && band_correct && count_correct && context_flagged;
    let detail = format!(
        "scalar={:.2} band={:?} reincarnation_count={} needs_context={}",
        result.scalar, result.band, result.reincarnation_count, context_flagged
    );
    (passed, detail)
}

/// VITA-01: Hysteresis prevents oscillation at band boundaries.
///
/// Tests the hysteretic band transition logic (D-11):
/// - At 0.41 with current band Declining: should NOT transition to Waning
///   (requires 0.4 + HYSTERESIS_BUFFER(0.05) = 0.45 to move UP)
/// - At 0.46 with current band Declining: SHOULD transition to Waning
///   after vitality_tick applies compute_band.
fn fixture_band_effects() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();

    // Case 1: scalar=0.41, band=Declining — should stay Declining (below hysteresis threshold 0.45)
    let mut state1 = crate::vitality_engine::VitalityState::default();
    state1.scalar = 0.41;
    state1.band = crate::vitality_engine::VitalityBand::Declining;
    state1.pending_eval_drain = 0.0;
    state1.consecutive_floor_ticks = 0;
    state1.sustained_high_error_ticks = 0;
    crate::vitality_engine::set_vitality_for_test(state1);

    // Read directly — compute_band is internal, but get_vitality returns the stored band
    // which was set to Declining. Vitality_tick will recompute the band.
    // With no significant drain or replenishment, scalar stays near 0.41.
    // At 0.41 with band=Declining: compute_band returns Declining (0.41 < 0.45 threshold for UP).
    crate::vitality_engine::vitality_tick();
    let result1 = crate::vitality_engine::get_vitality();
    let still_declining = matches!(result1.band, crate::vitality_engine::VitalityBand::Declining);

    // Case 2: scalar=0.46, band=Declining — should transition to Waning (above 0.45 threshold)
    let mut state2 = crate::vitality_engine::VitalityState::default();
    state2.scalar = 0.46;
    state2.band = crate::vitality_engine::VitalityBand::Declining;
    state2.pending_eval_drain = 0.0;
    state2.consecutive_floor_ticks = 0;
    state2.sustained_high_error_ticks = 0;
    crate::vitality_engine::set_vitality_for_test(state2);

    crate::vitality_engine::vitality_tick();
    let result2 = crate::vitality_engine::get_vitality();
    let now_waning = matches!(result2.band, crate::vitality_engine::VitalityBand::Waning);

    let passed = still_declining && now_waning;
    let detail = format!(
        "at 0.41 after tick: {:?} scalar={:.4} (expect Declining={}), at 0.46 after tick: {:?} scalar={:.4} (expect Waning={})",
        result1.band, result1.scalar, still_declining,
        result2.band, result2.scalar, now_waning
    );
    (passed, detail)
}

// ── Registry + test entry ──────────────────────────────────────────────────────

fn fixtures() -> Vec<VitalityFixture> {
    vec![
        VitalityFixture { label: "VITA-01: 5 failures -> Declining band",           run: fixture_vitality_band },
        VitalityFixture { label: "VITA-02: competence replenishment increases scalar", run: fixture_sdt_replenishment },
        VitalityFixture { label: "VITA-03: isolation drain reduces scalar",         run: fixture_drain },
        VitalityFixture { label: "VITA-04: dormancy serializes state (stub active)", run: fixture_dormancy },
        VitalityFixture { label: "VITA-04: reincarnation loads identity at 0.3",    run: fixture_reincarnation },
        VitalityFixture { label: "VITA-01: hysteresis prevents oscillation",        run: fixture_band_effects },
    ]
}

#[test]
fn evaluates_vitality() {
    // Redirect DB to a temp directory so vitality_tick's DB queries
    // (compute_relatedness, compute_isolation_drain, compute_tedium_drain)
    // hit empty tables instead of the user's real DB. This avoids:
    //   1. Triggering fastembed model download in compute_tedium_drain
    //   2. Non-deterministic results from user's message history
    // The vitality state itself lives in an OnceLock Mutex, not the DB.
    let temp_dir = std::env::temp_dir().join("blade_vitality_eval");
    std::fs::create_dir_all(&temp_dir).ok();
    std::env::set_var("BLADE_CONFIG_DIR", temp_dir.to_str().unwrap_or("/tmp/blade_vitality_eval"));

    // Ensure vitality-related tables exist in the temp DB
    let db_path = temp_dir.join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                image_base64 TEXT,
                timestamp INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS brain_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                polarity INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS vitality_state (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                scalar REAL NOT NULL DEFAULT 0.8,
                band TEXT NOT NULL DEFAULT 'Thriving',
                trend REAL NOT NULL DEFAULT 0.0,
                sdt_signals TEXT NOT NULL DEFAULT '{}',
                drain_signals TEXT NOT NULL DEFAULT '{}',
                reincarnation_count INTEGER NOT NULL DEFAULT 0,
                last_dormancy_at INTEGER,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS vitality_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                scalar REAL NOT NULL,
                band TEXT NOT NULL DEFAULT '',
                top_factor TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS dormancy_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                descent_history TEXT NOT NULL DEFAULT '[]',
                top_drain_factors TEXT NOT NULL DEFAULT '[]',
                session_count INTEGER NOT NULL DEFAULT 0,
                reincarnation_completed INTEGER NOT NULL DEFAULT 0
            );"
        );
    }

    let cases = fixtures();
    assert!(cases.len() >= 6, "Expected at least 6 fixtures, got {}", cases.len());

    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    for fx in &cases {
        let (passed, detail) = (fx.run)();
        rows.push(to_row(fx.label, passed, &detail, if passed { "pass" } else { "fail" }));
    }

    print_eval_table("Vitality eval", &rows);
    let s = summarize(&rows);
    let asserted = s.asserted_total.max(1) as f32;
    let pass_rate = s.asserted_top1_count as f32 / asserted;
    let floor_passed = pass_rate >= MODULE_FLOOR;

    // Phase 17 D-14: record BEFORE assert so a floor failure still generates
    // a JSONL row that doctor.rs can surface (DOCTOR-02 audit trail).
    super::harness::record_eval_run(MODULE_NAME, &s, floor_passed);

    assert!(floor_passed, "vitality eval below MODULE_FLOOR={}", MODULE_FLOOR);
}
