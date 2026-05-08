//! Phase 37 / EVAL-01 — operator-runnable real-LLM benchmark bin.
//!
//! Plan 37-08 / CONTEXT lock §Operator-Runnable Benchmark.
//!
//! NOT in verify:all. NOT in CI. Operators run this once per BLADE release
//! to populate `eval-runs/v1.5-baseline.json`. The deterministic CI lane
//! (`scripts/verify-intelligence.sh`, gate 38) reads the file and asserts
//! current pass-counts >= committed-baseline pass-counts. When the file is
//! missing, the deterministic lane falls back to absolute pass/fail per
//! fixture against the ScriptedProvider seam — first-run mode is graceful.
//!
//! Run:
//!   `BLADE_RUN_BENCHMARK=true cargo run --bin intelligence-benchmark --release`
//!   `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`
//!
//! Default (env unset): print usage + exit 0. The script wrapper performs
//! the same env-gate before invoking cargo, so opt-in is double-checked.
//!
//! Cost ceiling per CONTEXT lock §Operator-Runnable Benchmark §Locked: each
//! fixture caps at 25 iterations OR $0.50 estimated cost (whichever first).
//! Total budget ~$5 across 10 fixtures.
//!
//! ─────────────────────────────────────────────────────────────────────────
//! STRUCTURAL SKELETON DISCLOSURE (Plan 37-08 close-out)
//!
//! Per Plan 37-03 SUMMARY judgement #3, the EVAL-01 fixtures exercise
//! `loop_engine::run_loop` indirectly via the per-fixture seam runner
//! (`run_fixture_via_seam`) which is itself `#[cfg(test)]`-gated; the seam
//! `EVAL_FORCE_PROVIDER` is `#[cfg(test)]`-only. A bin target is NOT a test
//! build, so it cannot reach the seam OR the cfg(test) per-fixture runner.
//!
//! Wiring `run_loop` directly against real providers from a bin target
//! requires assembling a `LoopState`, a `ConversationMessage` history,
//! `ToolDefinition` registry, the activity-strip channel, and a Tauri
//! `AppHandle` (run_loop signature requirement). That harness work is
//! larger than Plan 37-08's authorized scope; per the plan's documented
//! stop condition (lines 346-348) the bin ships as a STRUCTURAL SKELETON:
//!
//!   - `[[bin]]` entry registered + cargo bin target compiles
//!   - `BLADE_RUN_BENCHMARK` env-gate functional
//!   - `BladeConfig.eval.baseline_path` resolved + creatable parent dir
//!   - 10 EVAL-01 fixture labels declared (parallel to intelligence_eval.rs)
//!   - Output JSON shape matches CONTEXT lock §Locked: Output schema
//!   - Each fixture row reports `passed=false`, `halted="OperatorDeferred"`
//!     with iterations=0/tokens=0 — explicit signal to the operator that
//!     the actual run_loop wiring is the operator's separate task.
//!
//! The OPERATOR's next-task surface (post-Phase-37-close):
//!   1. Decide whether to wire `run_loop` directly OR wrap the existing
//!      `commands::send_message_stream` Tauri command in a headless harness.
//!   2. Replace the per-fixture placeholder body with the chosen invocation.
//!   3. Run `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`.
//!   4. Inspect + commit `eval-runs/v1.5-baseline.json`.
//!
//! The deterministic CI lane (gate 38) handles a missing baseline gracefully
//! per CONTEXT §Locked: Comparison logic — v1.5 ships without the baseline
//! and the lane treats current pass-counts as absolute pass/fail.
//! ─────────────────────────────────────────────────────────────────────────

use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    // ── Env-gate ───────────────────────────────────────────────────────────
    // Default = SKIP. Cost ~$5 across 10 real-LLM fixtures; never run by
    // accident. The wrapper script enforces the same gate at the shell level.
    if std::env::var("BLADE_RUN_BENCHMARK").as_deref() != Ok("true") {
        println!("[run-intel-benchmark] SKIP -- set BLADE_RUN_BENCHMARK=true to run real-LLM benchmark");
        println!();
        println!("This benchmark calls REAL LLM providers using your configured");
        println!("BLADE provider + model (per ~/.config/blade/config.json).");
        println!("Cost ceiling: ~$5 across 10 fixtures ($0.50 hard cap each).");
        println!();
        println!("Usage:");
        println!("  BLADE_RUN_BENCHMARK=true cargo run --bin intelligence-benchmark --release");
        println!("  BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh");
        return ExitCode::SUCCESS;
    }

    // ── Load BladeConfig ──────────────────────────────────────────────────
    // Reads provider + model + EvalConfig.baseline_path. API keys live in
    // the OS keyring (per config.rs); the bin target inherits that surface
    // without re-implementing key resolution.
    let config = blade_lib::config::load_config();
    println!("[run-intel-benchmark] using {}/{}", config.provider, config.model);
    println!("[run-intel-benchmark] estimated cost cap: $5.00 (10 fixtures x $0.50 hard cap)");
    println!("[run-intel-benchmark] baseline path: {:?}", config.eval.baseline_path);
    println!();

    // ── Fixture labels (parallel to intelligence_eval.rs EVAL-01) ─────────
    // The 10 starting queries are owned by intelligence_eval.rs inside
    // #[cfg(test)] (Plan 37-03). The bin target re-declares them here as a
    // parallel const list — duplication is small (10 lines), the queries
    // are stable, and the bin stays independent of cfg(test) machinery.
    //
    // Label discipline: must match fixtures_eval_01_multi_step_tasks() label
    // ordering in intelligence_eval.rs to keep baseline.json comparable to
    // the deterministic CI lane's pass-count assertions.
    const FIXTURE_QUERIES: &[(&str, &str)] = &[
        ("code-edit-multi-file",         "Update commands.rs to add a new tauri command 'pause_loop' and add tests"),
        ("repo-search-then-summarize",   "Search the repo for all references to 'safe_slice' and summarize"),
        ("bash-grep-fix-test",           "Find why test_x is failing and fix it"),
        ("web-search-extract",           "What's the latest stable version of tree-sitter?"),
        ("parallel-file-reads",          "Read these 5 files in parallel: a.rs, b.rs, c.rs, d.rs, e.rs"),
        ("tool-error-recovery",          "Run this script — it keeps failing the same way"),
        ("verification-rejected-replan", "Find the bug — I keep retrying the same fix"),
        ("truncation-retry",             "Generate a 4000-word essay on systems design"),
        ("compaction-mid-loop",          "Read 30 source files and summarize the architecture"),
        ("cost-guard-warn",              "Process this huge dataset and summarize"),
    ];

    let mut results: Vec<serde_json::Value> = Vec::with_capacity(FIXTURE_QUERIES.len());
    let mut total_passed: usize = 0;

    for (label, query) in FIXTURE_QUERIES.iter() {
        // ── PER-FIXTURE PLACEHOLDER (operator-deferred wiring) ────────────
        //
        // The production invocation reads:
        //   1. Build LoopState + initial ConversationMessage from `query`.
        //   2. Resolve provider chain via providers::resolve_provider(config).
        //   3. Call run_loop with iter_cap = 25, cost_cap_usd = 0.50.
        //   4. Capture run_loop's halt_reason + final cumulative_cost_usd
        //      + total tokens_in/tokens_out.
        //   5. passed = matches!(halt_reason, Complete) for fixtures whose
        //      expected_haltreason is Complete; passed = false otherwise
        //      (mirrors intelligence_eval.rs::fixture coverage rules).
        //
        // The wiring is operator-deferred per the SKELETON DISCLOSURE above.
        // The placeholder values below are explicit signals: passed=false,
        // halted="OperatorDeferred", non-zero label so the row format
        // round-trips through the schema validator.

        let label_owned = (*label).to_string();
        let _query_owned = (*query).to_string();
        let placeholder_passed = false;
        let placeholder_iterations: u32 = 0;
        let placeholder_tokens_in: u64 = 0;
        let placeholder_tokens_out: u64 = 0;
        let placeholder_halted = "OperatorDeferred";

        println!(
            "[run-intel-benchmark] {}: {} (iterations={}, tokens_in={}, tokens_out={}, halted={})",
            label_owned,
            if placeholder_passed { "PASS" } else { "FAIL" },
            placeholder_iterations,
            placeholder_tokens_in,
            placeholder_tokens_out,
            placeholder_halted,
        );

        if placeholder_passed {
            total_passed += 1;
        }

        results.push(serde_json::json!({
            "label":      label_owned,
            "passed":     placeholder_passed,
            "iterations": placeholder_iterations,
            "tokens_in":  placeholder_tokens_in,
            "tokens_out": placeholder_tokens_out,
            "halted":     placeholder_halted,
        }));
    }

    // ── Output JSON per CONTEXT lock §Locked: Output schema ───────────────
    let total = FIXTURE_QUERIES.len();
    let pass_rate: f32 = if total == 0 { 0.0 } else { total_passed as f32 / total as f32 };
    let payload = serde_json::json!({
        "version":       1,
        "ran_at":        chrono::Utc::now().to_rfc3339(),
        "blade_version": env!("CARGO_PKG_VERSION"),
        "provider":      config.provider,
        "model":         config.model,
        "fixtures":      results,
        "summary": {
            "total":     total,
            "passed":    total_passed,
            "pass_rate": pass_rate,
        },
    });

    // ── Write baseline.json ────────────────────────────────────────────────
    // Path resolution: BladeConfig.eval.baseline_path defaults to
    // <blade_config_dir>/eval-runs/v1.5-baseline.json. The operator may
    // override via config.json. The wrapper script's docstring reminds the
    // operator to `git add eval-runs/v1.5-baseline.json` from the workspace
    // root if the configured path lives there.
    let baseline_path = config.eval.baseline_path.clone();
    if let Some(parent) = baseline_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!(
                "[run-intel-benchmark] FAILED to create parent dir {:?}: {}",
                parent, e
            );
            return ExitCode::FAILURE;
        }
    }

    let json_text = match serde_json::to_string_pretty(&payload) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[run-intel-benchmark] FAILED to serialize payload: {}", e);
            return ExitCode::FAILURE;
        }
    };

    if let Err(e) = std::fs::write(&baseline_path, &json_text) {
        eprintln!(
            "[run-intel-benchmark] FAILED to write baseline at {:?}: {}",
            baseline_path, e
        );
        return ExitCode::FAILURE;
    }

    println!();
    println!(
        "[run-intel-benchmark] DONE. {}/{} passed (pass_rate={:.2}). Baseline written to {:?}",
        total_passed, total, pass_rate, baseline_path
    );
    println!("[run-intel-benchmark] commit eval-runs/v1.5-baseline.json to lock the baseline.");
    println!();
    println!("[run-intel-benchmark] NOTE: this run is a STRUCTURAL SKELETON; per-fixture wiring");
    println!("[run-intel-benchmark] of run_loop against real providers is operator-deferred per");
    println!("[run-intel-benchmark] Plan 37-08 SUMMARY (CONTEXT §Operator-Runnable Benchmark).");

    ExitCode::SUCCESS
}
