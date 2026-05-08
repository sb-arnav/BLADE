//! Phase 37 / EVAL-01..05 — Capstone intelligence eval.
//!
//! MODULE_FLOOR = 1.0 (capstone gate — no relaxed fixtures per CONTEXT lock
//! §intelligence_eval.rs Module Layout)
//! No live LLM involvement. Uses ScriptedProvider for EVAL-01 + mocked
//! summaries for EVAL-04. EVAL-02 inspects LAST_BREAKDOWN; EVAL-03 calls
//! resilience::stuck::detect_stuck directly.
//! Run with --test-threads=1 (shares process-global state — EVAL_FORCE_PROVIDER
//! thread_local, BLADE_CONFIG_DIR env var, LAST_BREAKDOWN accumulator).
//!
//! Run: `cargo test --lib evals::intelligence_eval -- --nocapture --test-threads=1`
//!
//! Banners (in order — emit-order matches the v1.5 phase narrative):
//!   - EVAL-02: context efficiency        (Phase 32) — Plan 37-04
//!   - EVAL-03: stuck detection           (Phase 34) — Plan 37-05
//!   - EVAL-04: compaction fidelity       (Phase 32 prompt) — Plan 37-06
//!   - EVAL-01: multi-step task completion (Phase 33+34+35+36 all-stack) — Plan 37-03

use super::harness::{print_eval_table, summarize, EvalRow};

const MODULE_NAME: &str = "intelligence";
const MODULE_FLOOR: f32 = 1.0;

// ── Fixture harness ────────────────────────────────────────────────────────────

#[allow(dead_code)] // Plans 37-03..37-06 instantiate these
struct IntelligenceFixture {
    label: &'static str,
    requirement: &'static str,
    run: fn() -> (bool, String),
}

#[allow(dead_code)] // Plans 37-03..37-06 invoke this via the driver
fn to_row(label: &str, requirement: &str, passed: bool, result: &str, expected: &str) -> EvalRow {
    EvalRow {
        label: format!("{}: {}", requirement, label),
        top1: passed,
        top3: passed,
        rr: if passed { 1.0 } else { 0.0 },
        top3_ids: vec![result.to_string()],
        expected: expected.to_string(),
        relaxed: false, // MODULE_FLOOR=1.0 means NEVER relaxed
    }
}

// ── Fixture registry ──────────────────────────────────────────────────────────
//
// Plans 37-03..37-06 fill the four sub-fixture functions referenced below.
// Plan 37-02 ships only the empty aggregator — the driver tolerates empty
// rows by skipping the floor assertion when rows.is_empty().

fn fixtures() -> Vec<IntelligenceFixture> {
    let v = Vec::new();
    // Plan 37-04 wires this:
    // v.extend(fixtures_eval_02_context_efficiency());
    // Plan 37-05 wires this:
    // v.extend(fixtures_eval_03_stuck_detection());
    // Plan 37-06 wires this:
    // v.extend(fixtures_eval_04_compaction_fidelity());
    // Plan 37-03 wires this:
    // v.extend(fixtures_eval_01_multi_step_tasks());
    v
}

// ── Driver test ────────────────────────────────────────────────────────────────

#[test]
fn run_intelligence_eval_driver() {
    let mut rows: Vec<EvalRow> = Vec::new();
    for fix in fixtures() {
        let (passed, result) = (fix.run)();
        rows.push(to_row(fix.label, fix.requirement, passed, &result, "passes"));
    }
    let sum = summarize(&rows);
    // NOTE: harness::print_eval_table takes (title, rows) — it computes its
    // own summary internally and emits the EVAL-06 box-drawing table. The
    // plan's pseudocode passed (title, rows, &sum, MODULE_FLOOR) but the
    // upstream harness signature is 2-arg only (verified via
    // src-tauri/src/evals/harness.rs:135). Title carries the module + floor
    // for visibility in the captured stdout.
    print_eval_table(
        &format!("{} eval (floor={:.2})", MODULE_NAME, MODULE_FLOOR),
        &rows,
    );

    // Plan 37-02 ships an empty fixture list. Plans 37-03..37-06 fill it.
    // When rows is empty, summarize().asserted_mrr = 0.0 < 1.0 — the floor
    // assertion would fail. Guard the assertion until the registry is populated.
    if !rows.is_empty() {
        assert!(sum.asserted_mrr >= MODULE_FLOOR,
            "intelligence eval below floor (asserted_mrr={} < {})",
            sum.asserted_mrr, MODULE_FLOOR);
    }

    // Plan 37-05 will append: EVAL-03 aggregate accuracy assertion at this point.
    // Plan 37-02 ships only the table emit + floor guard.
}

// ── Phase 37 / EVAL-01 — ScriptedProvider (test-only) ─────────────────────────

#[cfg(test)]
#[derive(Clone)]
#[allow(dead_code)] // Plan 37-03 instantiates these fields
pub(crate) struct ScriptedToolCall {
    pub tool_name: &'static str,
    pub args_json: &'static str,
    pub response: &'static str,
}

#[cfg(test)]
#[derive(Clone)]
#[allow(dead_code)] // Plan 37-03 instantiates these fields
pub(crate) struct ScriptedResponse {
    pub tool_call: Option<ScriptedToolCall>,
    pub assistant_text: &'static str,
    pub truncated: bool,
}

#[cfg(test)]
#[allow(dead_code)] // Plan 37-03 instantiates these fields
pub(crate) struct ScriptedProvider {
    pub script: Vec<ScriptedResponse>,
    pub cursor: std::sync::Mutex<usize>,
}

#[cfg(test)]
impl ScriptedProvider {
    #[allow(dead_code)] // Plan 37-03 calls this from EVAL-01 fixtures
    pub fn new(script: &'static [ScriptedResponse]) -> Self {
        Self {
            script: script.to_vec(),
            cursor: std::sync::Mutex::new(0),
        }
    }

    /// Yield the next scripted response and advance the cursor.
    /// Returns Err("script exhausted") when called after the script's end —
    /// EVAL-01 fixtures expect script length to bound the loop iterations.
    #[allow(dead_code)] // Plan 37-03 invokes this inside the EVAL_FORCE_PROVIDER closure
    pub fn next_response(&self) -> Result<ScriptedResponse, String> {
        let mut cur = self.cursor.lock().map_err(|_| "cursor poisoned".to_string())?;
        let resp = self.script.get(*cur).cloned().ok_or_else(|| "script exhausted".to_string())?;
        *cur += 1;
        Ok(resp)
    }
}

// ── Phase 37 / EVAL-01 — setup_scripted_provider helper ─────────────────────

/// Install a ScriptedProvider into the loop_engine::EVAL_FORCE_PROVIDER thread-local.
/// Plan 37-03's per-fixture run functions call this before invoking run_loop,
/// then call teardown_scripted_provider in a defer-style block.
///
/// The closure builds an AssistantTurn from the next scripted response. Tool-call
/// shape conversion (ScriptedToolCall -> AssistantTurn.tool_calls[i]) is Plan
/// 37-03's responsibility — Plan 37-02 ships only the seam wiring.
#[cfg(test)]
#[allow(dead_code)] // Plan 37-03 activates the call sites
pub(crate) fn setup_scripted_provider(_provider: ScriptedProvider) {
    // Plan 37-03 implements the body — converting each ScriptedResponse into
    // an AssistantTurn shape that providers::AssistantTurn expects, and
    // installing the closure via:
    //   crate::loop_engine::EVAL_FORCE_PROVIDER.with(|cell| {
    //       *cell.borrow_mut() = Some(Box::new(move |_msgs, _tools| {
    //           let resp = provider.next_response()?;
    //           Ok(AssistantTurn {
    //               content: resp.assistant_text.to_string(),
    //               tool_calls: <map from resp.tool_call>,
    //               stop_reason: if resp.truncated { Some("length".into()) } else { Some("stop".into()) },
    //               tokens_in: 0,
    //               tokens_out: 0,
    //           })
    //       }));
    //   });
    // Plan 37-02 ships the empty stub.
}

#[cfg(test)]
#[allow(dead_code)] // Plan 37-03 activates the call sites
pub(crate) fn teardown_scripted_provider() {
    crate::loop_engine::EVAL_FORCE_PROVIDER.with(|cell| {
        *cell.borrow_mut() = None;
    });
}

// ── Phase 37 / EVAL-02 — smoke test (driver runs without panic) ──────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase37_eval_scaffold_emits_empty_table() {
        // The driver test (run_intelligence_eval_driver) is the canonical
        // entry point. This smoke test independently confirms the harness
        // emits the U+250C box-drawing header even with an empty fixture set
        // — required by scripts/verify-intelligence.sh (Plan 37-07) which
        // greps for that delimiter.
        let rows: Vec<EvalRow> = Vec::new();
        let _sum = summarize(&rows);
        // print_eval_table prints to stdout; we just verify it doesn't panic.
        // The verify-intelligence.sh gate captures stdout from the cargo test
        // invocation and counts the U+250C delimiter.
        print_eval_table(
            &format!("{} eval (floor={:.2})", MODULE_NAME, MODULE_FLOOR),
            &rows,
        );
    }
}
