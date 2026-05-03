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

// ── Fixture stubs (Wave 0) ─────────────────────────────────────────────────────
// These establish the test contract. Plan 05 fills in real logic.

fn fixture_vitality_band() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();
    // VITA-01: 5 consecutive failures push vitality into Declining band
    (false, "STUB: not yet implemented".to_string())
}

fn fixture_sdt_replenishment() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();
    // VITA-02/03: competence replenishment increases scalar
    (false, "STUB: not yet implemented".to_string())
}

fn fixture_drain() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();
    // VITA-02/03: isolation drain reduces scalar
    (false, "STUB: not yet implemented".to_string())
}

fn fixture_dormancy() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();
    // VITA-04: dormancy serializes state without process exit (stub active)
    (false, "STUB: not yet implemented".to_string())
}

fn fixture_reincarnation() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();
    // VITA-04: reincarnation loads preserved identity and starts at 0.3
    (false, "STUB: not yet implemented".to_string())
}

fn fixture_band_effects() -> (bool, String) {
    crate::vitality_engine::enable_dormancy_stub();
    // VITA-01: hysteresis prevents oscillation at band boundaries
    (false, "STUB: not yet implemented".to_string())
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

    // Wave 0: stubs fail, so we do NOT assert floor_passed here.
    // Plan 05 will update this to assert!(floor_passed, ...) after filling in fixture logic.
    if !floor_passed {
        eprintln!(
            "[{}] WARN: stubs not yet implemented -- {}/{} passing",
            MODULE_NAME, s.asserted_top1_count, s.asserted_total
        );
    }
}
