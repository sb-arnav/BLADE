//! Phase 16 / EVAL-05.
//!
//! REQUIREMENTS.md names `evolution::detect_missing_tool` but the live
//! function is `self_upgrade::detect_missing_tool` (verified at
//! `self_upgrade.rs:260`). `evolution.rs` only exposes the related
//! `evolution_log_capability_gap` (line 1115) — there are zero re-exports
//! between the two modules. This eval imports the real path; no re-export
//! added — see Phase 16 RESEARCH §5.
//!
//! ## Coverage
//! - 4 positive cases: Linux apt (jq), Linux bash (ripgrep), Windows cmd (node),
//!   macOS zsh (ffmpeg). Each pairs a real shell error with a real catalog
//!   command and asserts `detect_missing_tool` returns `Some(gap)` with the
//!   right suggestion text (case-insensitive contains check).
//! - 1 false-positive regression case: stderr mentions "fd" inside an
//!   unrelated `cargo build` error — must return `None`. This is the
//!   regression test for the strict-matcher fix at `self_upgrade.rs:272-285`
//!   (the old loose behaviour scanned stderr for catalog tool names and
//!   triggered spurious fd-find installs).
//! - 2 negative cases: unknown tool (`foobarbaz-cli`, not in catalog) and
//!   stderr without any not-found phrase. Both must return `None`.
//!
//! ## Catalog key note
//! The catalog uses the keyword `"ripgrep"` (not `"rg"`) — the eval's
//! ripgrep command starts with `ripgrep` so the first-token match hits.
//! Using `rg ...` here would (correctly) miss because `rg` is not a
//! catalog key.
//!
//! ## No SQLite involvement
//! `detect_missing_tool` is pure: `(stderr, command) → Option<CapabilityGap>`.
//! No `temp_blade_env()` call needed — this is the only Phase 16 eval that
//! doesn't touch the SQLite layer.
//!
//! ## Run
//! `cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1`
//!
//! `--test-threads=1` is kept for consistency with other Phase 16 evals
//! (the bash wrapper pins it). This eval is pure and would tolerate
//! parallelism, but the verify-eval gate runs the whole suite serial.

use super::harness::{print_eval_table, summarize, EvalRow};
use crate::self_upgrade::{capability_catalog, detect_missing_tool, CapabilityGap};

// ────────────────────────────────────────────────────────────
// Test cases (RESEARCH §7 EVAL-05)
// ────────────────────────────────────────────────────────────

struct GapCase {
    label: &'static str,
    stderr: &'static str,
    command: &'static str,
    /// `Some(needle)` → expect `Some(gap)` with suggestion containing `needle`
    /// (case-insensitive). `None` → expect `None` (negative or false-positive).
    expected_suggestion_contains: Option<&'static str>,
}

fn cases() -> Vec<GapCase> {
    vec![
        // ── Positive: Linux apt-style "<bin>: not found" pattern ──
        GapCase {
            label: "linux_apt_jq",
            stderr: "/bin/sh: 1: jq: not found",
            command: "jq '.foo' data.json",
            expected_suggestion_contains: Some("jq"),
        },
        // ── Positive: Linux bash "command not found" pattern ──
        // Catalog key is "ripgrep" not "rg" → command must start with `ripgrep`.
        GapCase {
            label: "linux_bash_ripgrep",
            stderr: "bash: ripgrep: command not found",
            command: "ripgrep 'pattern' src/",
            expected_suggestion_contains: Some("ripgrep"),
        },
        // ── Positive: Windows cmd "is not recognized" pattern ──
        GapCase {
            label: "windows_cmd_node",
            stderr: "'node' is not recognized as an internal or external command,\noperable program or batch file.",
            command: "node script.js",
            expected_suggestion_contains: Some("node"),
        },
        // ── Positive: macOS zsh "command not found" pattern ──
        GapCase {
            label: "macos_zsh_ffmpeg",
            stderr: "zsh: command not found: ffmpeg",
            command: "ffmpeg -i input.mp4 out.webm",
            expected_suggestion_contains: Some("ffmpeg"),
        },
        // ── False-positive regression gate ──
        // Stderr mentions "fd" inside an unrelated cargo error. The strict
        // matcher at self_upgrade.rs:272-285 only checks the FIRST whitespace
        // token of `command`, which here is `cargo` — not in the catalog. The
        // detector must return None. If this row ever returns Some, the
        // strict-matcher fix has regressed; do NOT weaken the eval.
        GapCase {
            label: "false_positive_cargo_mentions_fd",
            stderr: "error: failed to read file `/tmp/fd-build.log`: No such file or directory",
            command: "cargo build",
            expected_suggestion_contains: None,
        },
        // ── Negative: not-found phrase present, but tool not in catalog ──
        GapCase {
            label: "negative_unknown_tool",
            stderr: "/bin/sh: foobarbaz-cli: not found",
            command: "foobarbaz-cli arg",
            expected_suggestion_contains: None,
        },
        // ── Negative: catalog tool in command, but stderr has no not-found phrase ──
        GapCase {
            label: "negative_no_not_found",
            stderr: "Error: invalid argument",
            command: "jq '.foo' data.json",
            expected_suggestion_contains: None,
        },
    ]
}

/// Returns `(pass, observed_top3_for_table)`.
///
/// `top3` is a 1-element vec carrying either the suggestion text (positive
/// cases) or `"<None>"` (negative cases) so the EVAL-06 scored-table row
/// reads sensibly.
fn case_passes(case: &GapCase, result: &Option<CapabilityGap>) -> (bool, Vec<String>) {
    match (case.expected_suggestion_contains, result) {
        (Some(needle), Some(gap)) => {
            let contains = gap
                .suggestion
                .to_lowercase()
                .contains(&needle.to_lowercase());
            (contains, vec![gap.suggestion.clone()])
        }
        (Some(_), None) => (false, vec!["<None>".to_string()]),
        (None, Some(gap)) => (
            false,
            vec![format!("UNEXPECTED Some({:?})", gap.suggestion)],
        ),
        (None, None) => (true, vec!["<None>".to_string()]),
    }
}

// ────────────────────────────────────────────────────────────
// Test
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_capability_gap_detection() {
    // Sanity: catalog must be non-empty. RESEARCH §7 documents 16 live keys
    // (CLAUDE.md says 10 — discrepancy noted in plan SUMMARY).
    let catalog = capability_catalog();
    assert!(
        !catalog.is_empty(),
        "capability_catalog returned empty map"
    );

    // Pre-flight: confirm the catalog keys this eval depends on still exist.
    // If a future edit renames any of these, the eval surfaces a clear error
    // instead of a confusing top1=✗ row.
    for key in ["jq", "ripgrep", "node", "ffmpeg"] {
        assert!(
            catalog.contains_key(key),
            "capability_catalog missing key '{}' — eval needs it for a positive case",
            key
        );
    }

    let cases = cases();
    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    let mut all_pass = true;

    for case in &cases {
        let result = detect_missing_tool(case.stderr, case.command);
        let (pass, observed_top3) = case_passes(case, &result);
        if !pass {
            all_pass = false;
        }
        let expected_label = match case.expected_suggestion_contains {
            Some(s) => format!("Some(suggestion~={})", s),
            None => "None".to_string(),
        };
        rows.push(EvalRow {
            label: case.label.to_string(),
            top1: pass,
            top3: pass,
            rr: if pass { 1.0 } else { 0.0 },
            top3_ids: observed_top3,
            expected: expected_label,
            relaxed: false,
        });
    }

    print_eval_table("Capability gap detection eval", &rows);

    // Phase 17 / DOCTOR-02: record this run to history.jsonl BEFORE asserts.
    // Capability-gap eval is "all 7 cases must pass" with bool_row-style
    // pass/fail rows — asserted_top1_count == asserted_total mirrors the
    // existing per-case + all_pass asserts below.
    let s = summarize(&rows);
    let floor_passed = s.asserted_total > 0 && s.asserted_top1_count == s.asserted_total;
    super::harness::record_eval_run("capability_gap_eval", &s, floor_passed);

    // Floor: all 7 cases must pass. No slop tolerated for a classifier whose
    // false-positive case IS the regression gate for self_upgrade.rs:272-285.
    for (i, case) in cases.iter().enumerate() {
        assert!(
            rows[i].top1,
            "{} failed (stderr={:?} command={:?} expected_suggestion_contains={:?} → got top3_ids={:?})",
            case.label,
            case.stderr,
            case.command,
            case.expected_suggestion_contains,
            rows[i].top3_ids,
        );
    }
    assert!(all_pass, "capability gap eval: at least one case failed");
}
