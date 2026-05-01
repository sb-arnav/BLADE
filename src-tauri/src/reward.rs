//! Phase 23 Plan 23-01 (v1.3) — Composite reward + per-turn JSONL persistence.
//!
//! This module is the production-side substrate for the RLVR-style composite
//! reward landed at the agent layer per `open-questions-answered.md` Q1 and
//! locked by `.planning/phases/23-verifiable-reward-ood-eval/23-CONTEXT.md`
//! (decisions D-23-01..04).
//!
//! ## What lives here (Wave 1)
//!
//! - [`RewardComponents`] — the four named verifiable signal sources
//!   (skill_success / eval_gate / acceptance / completion), each `f32`.
//! - [`RewardRecord`] — the 9-field per-turn schema (timestamp, reward,
//!   components, raw_components, weights, penalties_applied, ood_modules,
//!   bootstrap_window, ood_gate_zero) — locked by 23-RESEARCH.md
//!   §"Per-Turn Reward Record Schema".
//! - [`compose`] — pure composite arithmetic: `Σ wᵢ·cᵢ` clamped to `[0, 1]`.
//! - [`record_reward`] — append a single ISO-8601 JSON line to
//!   `tests/evals/reward_history.jsonl` (mirrors
//!   `harness::record_eval_run` at `harness.rs:223–247`).
//! - [`read_reward_history`] — tail-read up to `limit` parsed records;
//!   returns `Vec::new()` on missing file (Doctor convention D-16).
//! - [`reward_history_path`] — env-overridable path resolver
//!   (`BLADE_REWARD_HISTORY_PATH` is the test seam) mirroring
//!   `doctor::eval_history_path` at `doctor.rs:167–177`.
//!
//! ## What does NOT live here (yet)
//!
//! Wave 2 / Plan 23-02 extends this module with `TurnAccumulator`,
//! `ToolCallTrace`, penalty-detection helpers, and the
//! `compute_and_persist_turn_reward` orchestrator. Wave 3 / Plan 23-03 wires
//! the OOD-gate-zero check + ActivityStrip emit on penalty/gate-fire. The
//! emit helper is intentionally absent here — Wave 1 is types + arithmetic
//! + persistence only.
//!
//! ## Test threading
//!
//! The unit tests in this module mutate `BLADE_REWARD_HISTORY_PATH`
//! process-globally; `verify-eval.sh` already pins `--test-threads=1`. Run
//! locally with:
//!
//! ```text
//! cargo test --lib reward -- --test-threads=1
//! ```

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::config::RewardWeights;

// ---------------------------------------------------------------------
// Types — RewardComponents + RewardRecord (9-field schema, LOCKED).
// ---------------------------------------------------------------------

/// The four verifiable component scores, each in `[0.0, 1.0]` after penalty
/// application. Each component is computed independently to satisfy
/// REWARD-02 ("no cross-contamination").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RewardComponents {
    pub skill_success: f32,
    pub eval_gate:     f32,
    pub acceptance:    f32,
    pub completion:    f32,
}

/// Per-turn reward record persisted as a single JSONL line in
/// `tests/evals/reward_history.jsonl`. Schema is the LOCKED 9-field shape
/// per 23-RESEARCH.md §"Per-Turn Reward Record Schema":
///
/// 1. `timestamp` — ISO-8601 (`chrono::Utc::now().to_rfc3339()`).
/// 2. `reward` — composite, post-everything, clamped to `[0, 1]`.
/// 3. `components` — post-penalty named scores (the values that drove `reward`).
/// 4. `raw_components` — pre-penalty named scores (audit trail).
/// 5. `weights` — snapshot of `RewardWeights` at the moment of compute
///    (so a future weight change doesn't retroactively reinterpret the row).
/// 6. `penalties_applied` — list of penalty-name labels that fired this turn.
/// 7. `ood_modules` — per-OOD-module floor scores (BTreeMap for deterministic
///    JSON ordering — matters for the round-trip unit test).
/// 8. `bootstrap_window` — `true` during the first 7 days of history (the
///    REWARD-06 OOD-floor gate is suppressed but logged).
/// 9. `ood_gate_zero` — `true` iff REWARD-06 zeroed the turn's reward.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardRecord {
    pub timestamp:        String,
    pub reward:           f32,
    pub components:       RewardComponents,
    pub raw_components:   RewardComponents,
    pub weights:          RewardWeights,
    #[serde(default)]
    pub penalties_applied: Vec<String>,
    #[serde(default)]
    pub ood_modules:      std::collections::BTreeMap<String, f32>,
    pub bootstrap_window: bool,
    pub ood_gate_zero:    bool,
}

// ---------------------------------------------------------------------
// Composite arithmetic.
// ---------------------------------------------------------------------

/// Compute the composite reward `Σ wᵢ · cᵢ` and clamp to `[0.0, 1.0]`.
///
/// Pure function — no I/O, no allocations, deterministic. The clamp is
/// load-bearing: even if a caller hands in pathological out-of-range
/// components or weights (e.g. corrupt `RewardWeights` that escaped
/// `validate()`), the returned value is bounded.
///
/// **REWARD-01 lock:** the formula is fixed; only the WEIGHTS are
/// configurable. v1.3 default weights `{0.5, 0.3, 0.0, 0.1}` make
/// `compose(all-ones, default) = 0.9` — acceptance silenced via
/// `acceptance_weight = 0.0`, NOT via formula change. v1.4 will flip
/// `acceptance` back to `0.1` and bring the all-ones composite to `1.0`.
pub fn compose(c: &RewardComponents, w: &RewardWeights) -> f32 {
    let raw = w.skill_success * c.skill_success
            + w.eval_gate     * c.eval_gate
            + w.acceptance    * c.acceptance
            + w.completion    * c.completion;
    raw.clamp(0.0, 1.0)
}

// ---------------------------------------------------------------------
// Persistence — path resolver + writer + tail-reader.
// ---------------------------------------------------------------------

/// Resolve the path to `tests/evals/reward_history.jsonl`.
///
/// Honors `BLADE_REWARD_HISTORY_PATH` env override for hermetic tests
/// (mirrors `BLADE_EVAL_HISTORY_PATH` at `doctor.rs:167–177` and
/// `harness.rs:197–207`). The compile-time `CARGO_MANIFEST_DIR` fallback
/// is the production code path.
///
/// Marked `pub(crate)` — only internal callers (this module's tests +
/// future doctor.rs `compute_reward_signal`) need to resolve the path.
pub(crate) fn reward_history_path() -> PathBuf {
    if let Ok(p) = std::env::var("BLADE_REWARD_HISTORY_PATH") {
        return PathBuf::from(p);
    }
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("CARGO_MANIFEST_DIR has parent")
        .join("tests")
        .join("evals")
        .join("reward_history.jsonl")
}

/// Append a single `RewardRecord` as a JSONL line.
///
/// Mirrors `harness::record_eval_run` at `harness.rs:223–247`:
/// `OpenOptions::new().create(true).append(true).open(&path)` followed by a
/// SINGLE `writeln!` call (Pitfall 3 — single-call shape guarantees
/// `≤ PIPE_BUF` (4096 B) atomicity for typical record size ~600 B).
///
/// Best-effort — errors are swallowed because reward persistence must NEVER
/// break the chat loop. The only exception is serialize failure, which
/// emits a `log::warn!` and returns early without touching the filesystem.
pub fn record_reward(rec: &RewardRecord) {
    use std::io::Write;
    let line = match serde_json::to_string(rec) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[reward] serialize failed: {e}");
            return;
        }
    };
    let path = reward_history_path();
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

/// Tail-read up to `limit` `RewardRecord` entries from the JSONL file.
///
/// Mirrors `doctor::read_eval_history` at `doctor.rs:182–193` verbatim:
///
/// - Missing file → `Vec::new()` (Doctor convention D-16: missing history
///   is Green; empty bootstrap window for reward trend).
/// - Tail-by-`saturating_sub` keeps the youngest `limit` rows when the
///   file is longer than `limit`.
/// - Per-line `serde_json::from_str::<RewardRecord>(_).ok()` filter —
///   malformed rows are silently dropped (matches harness convention).
pub fn read_reward_history(limit: usize) -> Vec<RewardRecord> {
    let path = reward_history_path();
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(limit);
    lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str::<RewardRecord>(l).ok())
        .collect()
}

// ---------------------------------------------------------------------
// Tests — 6 unit tests covering compose math + JSONL round-trip.
//
// IMPORTANT: tests mutate BLADE_REWARD_HISTORY_PATH process-globally.
// Run with `--test-threads=1` (already pinned by verify-eval.sh).
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a `RewardRecord` skeleton with all-1.0 components for the
    /// JSONL round-trip tests. The exact numeric content doesn't matter —
    /// only that serialize → deserialize is loss-less.
    fn sample_record(reward: f32) -> RewardRecord {
        RewardRecord {
            timestamp: chrono::Utc::now().to_rfc3339(),
            reward,
            components: RewardComponents {
                skill_success: 1.0, eval_gate: 1.0, acceptance: 1.0, completion: 1.0,
            },
            raw_components: RewardComponents {
                skill_success: 1.0, eval_gate: 1.0, acceptance: 1.0, completion: 1.0,
            },
            weights: RewardWeights::default(),
            penalties_applied: vec![],
            ood_modules: std::collections::BTreeMap::new(),
            bootstrap_window: true,
            ood_gate_zero: false,
        }
    }

    /// Test 1 — `compose(all-ones, default) == 0.9` because v1.3 default
    /// weights sum to 0.9 (acceptance silenced via weight=0). NOT 1.0.
    /// Locks the D-23-01 acceptance-via-weight-zero contract.
    #[test]
    fn composite_matches_hand_calc() {
        let c = RewardComponents {
            skill_success: 1.0, eval_gate: 1.0, acceptance: 1.0, completion: 1.0,
        };
        let w = RewardWeights::default();
        let r = compose(&c, &w);
        assert!(
            (r - 0.9).abs() < 1e-6,
            "compose(all-ones, default-weights) must equal 0.9 in v1.3 (acceptance silenced); got {}",
            r
        );

        // Weighted-sum sanity at non-uniform components:
        // 0.5*1.0 + 0.3*0.5 + 0.0*0.0 + 0.1*0.0 = 0.65
        let c2 = RewardComponents {
            skill_success: 1.0, eval_gate: 0.5, acceptance: 0.0, completion: 0.0,
        };
        let r2 = compose(&c2, &w);
        assert!((r2 - 0.65).abs() < 1e-6, "expected 0.65, got {}", r2);
    }

    /// Test 2 — clamp to `[0.0, 1.0]` even if components or weights are
    /// out of range. Defense-in-depth against corrupt configs that
    /// somehow escaped `RewardWeights::validate()` upstream.
    #[test]
    fn composite_clamps_to_unit_interval() {
        let huge_components = RewardComponents {
            skill_success: 100.0, eval_gate: 100.0, acceptance: 100.0, completion: 100.0,
        };
        let r_high = compose(&huge_components, &RewardWeights::default());
        assert!(r_high <= 1.0, "compose must clamp to <= 1.0, got {}", r_high);
        assert!(r_high >= 0.0, "clamp lower bound; got {}", r_high);

        let neg_components = RewardComponents {
            skill_success: -100.0, eval_gate: -100.0, acceptance: -100.0, completion: -100.0,
        };
        let r_low = compose(&neg_components, &RewardWeights::default());
        assert!(r_low >= 0.0, "compose must clamp to >= 0.0, got {}", r_low);
        assert!(r_low <= 1.0, "clamp upper bound; got {}", r_low);
    }

    /// Test 3 — `record_reward(&rec)` followed by `read_reward_history(usize::MAX)`
    /// returns a Vec containing the just-written record. Hermetic via
    /// `BLADE_REWARD_HISTORY_PATH` env override + `tempfile::NamedTempFile`.
    #[test]
    fn record_appends_jsonl() {
        let tmp = tempfile::NamedTempFile::new().expect("create tempfile");
        let path = tmp.path().to_path_buf();
        // Drop the file handle so record_reward can re-open in append mode.
        // The path remains valid (NamedTempFile keeps the inode until drop).
        std::env::set_var("BLADE_REWARD_HISTORY_PATH", &path);

        // Start clean — wipe any prior content (NamedTempFile creates an
        // empty file but `record_reward` opens with append, so a fresh
        // truncate makes the assertion below tight).
        std::fs::write(&path, "").expect("truncate tempfile");

        let rec = sample_record(0.42);
        record_reward(&rec);

        let read_back = read_reward_history(usize::MAX);
        assert_eq!(read_back.len(), 1, "exactly one record expected, got {}", read_back.len());
        assert!(
            (read_back[0].reward - 0.42).abs() < 1e-6,
            "round-tripped reward should match (got {})",
            read_back[0].reward
        );
        assert_eq!(read_back[0].penalties_applied, rec.penalties_applied);
        assert_eq!(read_back[0].bootstrap_window, rec.bootstrap_window);

        std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
    }

    /// Test 4 — `read_reward_history(2000)` returns `Vec::new()` on missing
    /// file (Doctor convention D-16: missing history is Green / empty).
    #[test]
    fn read_reward_history_returns_empty_on_missing() {
        // Point at a path that definitely does not exist.
        let nonexistent = std::env::temp_dir()
            .join("blade-reward-test-does-not-exist")
            .join("reward_history.jsonl");
        // Defensively ensure it is absent.
        let _ = std::fs::remove_file(&nonexistent);

        std::env::set_var("BLADE_REWARD_HISTORY_PATH", &nonexistent);

        let rows = read_reward_history(2000);
        assert!(rows.is_empty(), "expected empty Vec on missing file, got {} rows", rows.len());

        std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
    }

    /// Test 5 — Tail semantics: `read_reward_history(2)` on a 5-line file
    /// returns the LAST 2 records. Locks `saturating_sub`-based tail.
    #[test]
    fn read_reward_history_tails_correctly() {
        let tmp = tempfile::NamedTempFile::new().expect("create tempfile");
        let path = tmp.path().to_path_buf();
        std::env::set_var("BLADE_REWARD_HISTORY_PATH", &path);
        std::fs::write(&path, "").expect("truncate tempfile");

        // Write 5 records with distinct rewards so we can identify them.
        for i in 0..5 {
            let mut rec = sample_record(i as f32 * 0.1);
            // Stagger timestamps so the order is unambiguous.
            rec.timestamp = format!("2026-05-01T00:00:0{}Z", i);
            record_reward(&rec);
        }

        let tail = read_reward_history(2);
        assert_eq!(tail.len(), 2, "expected last 2 records, got {}", tail.len());
        // Last two rewards written were 0.3 and 0.4.
        assert!((tail[0].reward - 0.3).abs() < 1e-6, "tail[0] reward={}", tail[0].reward);
        assert!((tail[1].reward - 0.4).abs() < 1e-6, "tail[1] reward={}", tail[1].reward);

        std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
    }

    /// Test 6 — Malformed lines are silently skipped. Write 3 valid + 1
    /// garbage line and assert `read_reward_history` returns 3 records.
    /// Mirrors `doctor::read_eval_history` `.ok()` filter convention.
    #[test]
    fn read_reward_history_skips_malformed_lines() {
        let tmp = tempfile::NamedTempFile::new().expect("create tempfile");
        let path = tmp.path().to_path_buf();
        std::env::set_var("BLADE_REWARD_HISTORY_PATH", &path);
        std::fs::write(&path, "").expect("truncate tempfile");

        // 3 valid records.
        for i in 0..3 {
            let mut rec = sample_record(i as f32 * 0.1);
            rec.timestamp = format!("2026-05-01T00:00:0{}Z", i);
            record_reward(&rec);
        }
        // 1 garbage line (NOT valid JSON).
        {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .expect("open tempfile for append");
            writeln!(f, "{{ this is definitely not valid json }}").expect("write garbage");
        }

        let rows = read_reward_history(usize::MAX);
        assert_eq!(rows.len(), 3, "expected 3 valid rows after garbage skip, got {}", rows.len());

        std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
    }
}
