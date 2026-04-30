//! Shared eval harness — Phase 16 (.planning/phases/16-eval-scaffolding-expansion).
//!
//! Centralises helpers extracted from `embeddings.rs:586-601, 820-835, 870-899`
//! so all 5 eval modules emit the same EVAL-06 scored-table format.
//!
//! ## EVAL-06 contract
//! Every eval calls [`print_eval_table`] which leads with `┌──` (U+250C U+2500 U+2500).
//! `scripts/verify-eval.sh` greps stdout for that prefix to confirm tables emitted.
//!
//! ## `safe_slice` rule (CLAUDE.md)
//! Current label width is `{:32}` (left-pad — safe for any UTF-8 input).
//! If a future edit changes to `{:.32}` (byte-truncate), the unicode adversarial
//! fixture in `hybrid_search_eval` will panic. Use `crate::safe_slice` instead.
//!
//! ## Cargo parallelism (RESEARCH §10 R1)
//! [`temp_blade_env`] mutates the `BLADE_CONFIG_DIR` env var — a process-global.
//! `verify-eval.sh` and per-task commands MUST pin `--test-threads=1`.

use tempfile::TempDir;

use crate::embeddings::SearchResult;

/// Trait letting the same RR/top-k helpers work for `SearchResult` (embeddings)
/// and any custom result row a future eval invents (e.g. KG / typed_memory).
pub trait HasSourceId {
    fn source_id(&self) -> &str;
}

impl HasSourceId for SearchResult {
    fn source_id(&self) -> &str {
        &self.source_id
    }
}

/// One row in the scored-table output. Carries enough state for both the
/// per-row `│ ...` line and the summary roll-up.
#[derive(Debug, Clone)]
pub struct EvalRow {
    pub label: String,
    pub top1: bool,
    pub top3: bool,
    pub rr: f32,
    pub top3_ids: Vec<String>,
    pub expected: String,
    /// `true` → row surfaces in the table but is excluded from floor math.
    /// Used for adversarial fixtures (long content, unicode, near-duplicates)
    /// in their first iteration before promotion to asserted floor.
    pub relaxed: bool,
}

/// Roll-up over a slice of [`EvalRow`]. Computes both "all" and "asserted"
/// (gate-floor) statistics so evals can `assert!(summary.asserted_mrr >= 0.6)`
/// without re-doing the math.
#[derive(Debug, Clone, Copy)]
pub struct EvalSummary {
    pub total: usize,
    pub top1_count: usize,
    pub top3_count: usize,
    pub mrr: f32,
    pub asserted_total: usize,
    pub asserted_top1_count: usize,
    pub asserted_top3_count: usize,
    pub asserted_mrr: f32,
}

/// Reciprocal Rank: `1 / (1-indexed rank of expected source_id)` or `0` if absent.
/// Source: `embeddings.rs:586`.
pub fn reciprocal_rank<T: HasSourceId>(results: &[T], expected: &str) -> f32 {
    for (i, r) in results.iter().enumerate() {
        if r.source_id() == expected {
            return 1.0 / ((i + 1) as f32);
        }
    }
    0.0
}

/// `true` iff the first result's `source_id` matches `expected`.
/// Source: `embeddings.rs:595`.
pub fn top1_hit<T: HasSourceId>(results: &[T], expected: &str) -> bool {
    results.first().map(|r| r.source_id() == expected).unwrap_or(false)
}

/// `true` iff `expected` appears in the first `k` results.
/// Source: `embeddings.rs:599`.
pub fn topk_hit<T: HasSourceId>(results: &[T], expected: &str, k: usize) -> bool {
    results.iter().take(k).any(|r| r.source_id() == expected)
}

/// Compute "all" + "asserted" (i.e. non-relaxed-only) summaries from a row slice.
pub fn summarize(rows: &[EvalRow]) -> EvalSummary {
    let total = rows.len();
    let top1_count = rows.iter().filter(|r| r.top1).count();
    let top3_count = rows.iter().filter(|r| r.top3).count();
    let mrr = if total == 0 {
        0.0
    } else {
        rows.iter().map(|r| r.rr).sum::<f32>() / total as f32
    };

    let asserted: Vec<&EvalRow> = rows.iter().filter(|r| !r.relaxed).collect();
    let asserted_total = asserted.len();
    let asserted_top1_count = asserted.iter().filter(|r| r.top1).count();
    let asserted_top3_count = asserted.iter().filter(|r| r.top3).count();
    let asserted_mrr = if asserted_total == 0 {
        0.0
    } else {
        asserted.iter().map(|r| r.rr).sum::<f32>() / asserted_total as f32
    };

    EvalSummary {
        total,
        top1_count,
        top3_count,
        mrr,
        asserted_total,
        asserted_top1_count,
        asserted_top3_count,
        asserted_mrr,
    }
}

/// Print the EVAL-06 box-drawing scored table.
///
/// Format reference (`embeddings.rs:870-899`):
/// ```text
/// ┌── {title} ──
/// │ {label:32} top1=✓ top3=✓ rr=1.00 → top3=["a","b","c"] (want=mem_x)
/// ├─────────────────────────────────────────────────────────
/// │ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
/// └─────────────────────────────────────────────────────────
/// ```
///
/// If any row carries `relaxed: true`, prints both an "all" rollup and an
/// "asserted (gate floors)" rollup so the eval can floor on the asserted line.
pub fn print_eval_table(title: &str, rows: &[EvalRow]) {
    println!("\n┌── {} ──", title);
    for row in rows {
        println!(
            "│ {:32} top1={} top3={} rr={:.2} → top3={:?} (want={}){}",
            row.label,
            if row.top1 { "✓" } else { "✗" },
            if row.top3 { "✓" } else { "✗" },
            row.rr,
            row.top3_ids,
            row.expected,
            if row.relaxed { " (relaxed)" } else { "" },
        );
    }
    let s = summarize(rows);
    println!("├─────────────────────────────────────────────────────────");
    println!(
        "│ top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
        s.top1_count,
        s.total,
        if s.total == 0 { 0.0 } else { (s.top1_count as f32 / s.total as f32) * 100.0 },
        s.top3_count,
        s.total,
        if s.total == 0 { 0.0 } else { (s.top3_count as f32 / s.total as f32) * 100.0 },
        s.mrr,
    );
    if rows.iter().any(|r| r.relaxed) {
        println!(
            "│ asserted (gate floors): top-1: {}/{} ({:.0}%)  top-3: {}/{} ({:.0}%)  MRR: {:.3}",
            s.asserted_top1_count,
            s.asserted_total,
            if s.asserted_total == 0 { 0.0 } else { (s.asserted_top1_count as f32 / s.asserted_total as f32) * 100.0 },
            s.asserted_top3_count,
            s.asserted_total,
            if s.asserted_total == 0 { 0.0 } else { (s.asserted_top3_count as f32 / s.asserted_total as f32) * 100.0 },
            s.asserted_mrr,
        );
    }
    println!("└─────────────────────────────────────────────────────────\n");
}

/// Spin up an isolated temp config dir + initialised db for any eval that
/// touches SQLite-backed storage. **NOT thread-safe** — `BLADE_CONFIG_DIR`
/// is a process-global env var. Pin `cargo test --test-threads=1`.
///
/// Source: `embeddings.rs:570-572`.
pub fn temp_blade_env() -> TempDir {
    let temp = TempDir::new().expect("tempdir");
    std::env::set_var("BLADE_CONFIG_DIR", temp.path());
    let _ = crate::db::init_db();
    temp
}

/// Resolve the history.jsonl path. Honors the `BLADE_EVAL_HISTORY_PATH` env
/// var so unit tests can redirect to a tempdir without polluting the real
/// repo file (Phase 17 / Pitfall 4 — see `17-RESEARCH.md` § Pitfall 4).
///
/// Default: `<repo-root>/tests/evals/history.jsonl` resolved via
/// `CARGO_MANIFEST_DIR` (which points at `src-tauri/`) + `..` + `tests/evals`.
///
/// `env!("CARGO_MANIFEST_DIR")` is compile-time so the default cannot be
/// stubbed at test runtime; the env override is the test seam.
pub fn history_jsonl_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("BLADE_EVAL_HISTORY_PATH") {
        return std::path::PathBuf::from(p);
    }
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("CARGO_MANIFEST_DIR has parent")
        .join("tests")
        .join("evals")
        .join("history.jsonl")
}

/// Append a single JSONL line to `tests/evals/history.jsonl` recording one
/// eval run. Phase 17 / DOCTOR-02 source — `doctor.rs` reads the last 200
/// lines on `doctor_run_full_check` to compute eval-score severity (D-05).
///
/// The file is git-ignored (only `.gitkeep` is committed). On a fresh
/// install the file may not exist; `doctor.rs` treats "missing" as Green
/// (CONTEXT.md D-16).
///
/// Best-effort: errors are silently swallowed (matches `print_eval_table`
/// fire-and-forget convention). Per CONTEXT.md D-14 the call is added to
/// every Phase 16 eval module BEFORE the `assert!` block so failures still
/// generate a JSONL row (RESEARCH.md § B2 recommendation A1). Pitfall 1:
/// JSON is constructed inline via `serde_json::json!` — do NOT add a
/// serde derive to `EvalSummary`.
pub fn record_eval_run(module: &str, summary: &EvalSummary, floor_passed: bool) {
    use std::io::Write;
    let line = serde_json::json!({
        "timestamp":      chrono::Utc::now().to_rfc3339(),
        "module":         module,
        "top1":           summary.asserted_top1_count,
        "top3":           summary.asserted_top3_count,
        "mrr":            summary.asserted_mrr,
        "floor_passed":   floor_passed,
        "asserted_count": summary.asserted_total,
        "relaxed_count":  summary.total.saturating_sub(summary.asserted_total),
    });

    let path = history_jsonl_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{}", line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RAII guard that removes an env var when the test completes (or panics),
    /// so a failure inside the test does not leak the override to sibling tests
    /// even though the harness pins `--test-threads=1`.
    struct EnvGuard(&'static str);
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var(self.0);
        }
    }

    fn fixture_summary() -> EvalSummary {
        EvalSummary {
            total: 8,
            top1_count: 8,
            top3_count: 8,
            mrr: 1.0,
            asserted_total: 8,
            asserted_top1_count: 8,
            asserted_top3_count: 8,
            asserted_mrr: 1.0,
        }
    }

    #[test]
    fn record_eval_run_appends_jsonl() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let history = dir.path().join("history.jsonl");

        // Drop guard ensures cleanup even on panic.
        let _guard = EnvGuard("BLADE_EVAL_HISTORY_PATH");
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &history);

        // Sanity: helper resolves to the override path.
        assert_eq!(history_jsonl_path(), history);

        let s = fixture_summary();
        record_eval_run("hybrid_search_eval", &s, true);
        record_eval_run("hybrid_search_eval", &s, true);

        assert!(history.exists(), "history.jsonl should exist after record");
        let raw = std::fs::read_to_string(&history).expect("read history");
        let lines: Vec<&str> = raw.lines().filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 2, "exactly two JSONL lines expected, got {}: {:?}", lines.len(), lines);

        for line in &lines {
            let v: serde_json::Value = serde_json::from_str(line).expect("each line parses as JSON");
            assert_eq!(v["module"], "hybrid_search_eval");
            assert_eq!(v["top1"], 8);
            assert_eq!(v["top3"], 8);
            // mrr is a JSON number; compare via f64
            assert!((v["mrr"].as_f64().expect("mrr is number") - 1.0).abs() < f64::EPSILON);
            assert_eq!(v["floor_passed"], true);
            assert_eq!(v["asserted_count"], 8);
            assert_eq!(v["relaxed_count"], 0);
            let ts = v["timestamp"].as_str().expect("timestamp is string");
            assert!(!ts.is_empty(), "timestamp non-empty");
        }
    }
}
