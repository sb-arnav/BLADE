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
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

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
// Wave 2 — TurnAccumulator + ToolCallTrace + penalty detectors +
// compute_components + compute_and_persist_turn_reward orchestrator.
//
// Locked by 23-RESEARCH.md §"Penalty Detection Wiring" (TurnAccumulator
// shape + glob matchers + skill-test heuristic) and §"Hook Point §Data
// the Call Needs" (compute_and_persist_turn_reward signature).
//
// The OOD-floor gate (REWARD-06) is INTENTIONALLY a no-op stub here —
// `ood_gate_zero: false` and `bootstrap_window: false` are persisted on
// every record. Plan 23-08 (Wave 3) lands the real gate body and the
// `reward:ood_gate_zero` ActivityStrip emit; the locked
// `compute_and_persist_turn_reward(&app, acc)` signature is preserved so
// the commands.rs hook does NOT need to change again.
// ---------------------------------------------------------------------

/// One captured tool dispatch from the per-turn loop. Used by the penalty
/// detectors (eval-module glob, no-op classification, skill-test heuristic)
/// and persisted-via-derived in `RewardRecord.penalties_applied`.
///
/// Threat surface (T-23-02-02): `result_content` is truncated to 500 chars
/// via `crate::safe_slice` at the call site (commands.rs Site 2), so the
/// trace is bounded even when tool output contains emoji/CJK/control bytes.
#[derive(Clone, Debug)]
pub struct ToolCallTrace {
    pub tool_name:      String,
    pub args_str:       String,
    pub result_content: String,
    pub is_error:       bool,
    pub timestamp_ms:   i64,
}

/// Per-turn tool-call accumulator constructed at the top of
/// `commands.rs::send_message_stream_inline` and dropped at the happy-path
/// `return Ok(())` (commands.rs:1821) after `compute_and_persist_turn_reward`
/// has consumed it.
///
/// All fields are wrapped in `Arc<Mutex<_>>` to satisfy Pitfall 4
/// (futureproofing against parallel-dispatch refactors). Today's
/// dispatch loop is single-task; the lock cost is negligible per call.
#[derive(Default, Debug)]
pub struct TurnAccumulator {
    /// Tool calls fired during this turn, in dispatch order.
    pub tool_calls:    Arc<Mutex<Vec<ToolCallTrace>>>,
    /// Skill names invoked this turn (forge_tool successes).
    pub skills_used:   Arc<Mutex<Vec<String>>>,
    /// Whether forge_tool returned Ok during this turn (None → no forge call).
    pub forge_ok:      Arc<Mutex<Option<bool>>>,
    /// Final assistant content post-tag-strip (for completion N/A check
    /// — wired in Wave 3 if ever needed; today's completion logic uses the
    /// last tool call instead).
    pub final_content: Arc<Mutex<String>>,
}

impl TurnAccumulator {
    pub fn new() -> Self { Self::default() }

    pub fn record_tool_call(&self, t: ToolCallTrace) {
        if let Ok(mut v) = self.tool_calls.lock() { v.push(t); }
    }

    pub fn snapshot_calls(&self) -> Vec<ToolCallTrace> {
        self.tool_calls.lock().map(|v| v.clone()).unwrap_or_default()
    }

    #[allow(dead_code)]
    pub fn record_skill(&self, name: String) {
        if let Ok(mut v) = self.skills_used.lock() { v.push(name); }
    }

    #[allow(dead_code)]
    pub fn set_forge_ok(&self, ok: bool) {
        if let Ok(mut v) = self.forge_ok.lock() { *v = Some(ok); }
    }

    #[allow(dead_code)]
    pub fn set_final_content(&self, s: String) {
        if let Ok(mut v) = self.final_content.lock() { *v = s; }
    }
}

/// Tool names that count as no-ops for the D-23-02 path-3 completion penalty.
pub const NOOP_TOOL_NAMES: &[&str] = &["noop", "wait"];

/// Extract the write target path from a tool call's args, if present.
///
/// Knows the schema for `write_file`, `edit_file`, `forge_tool`, and their
/// `blade_*` aliases. Returns `None` if the call doesn't have a clear
/// write target (most tools — including `bash` — fall through here).
///
/// `forge_tool` "writes" to `~/.blade/skills/<name>/scripts/` per Phase 22;
/// we surface the synthetic `skills/<name>/scripts` path so
/// `penalty_skill_no_tests` can find sibling test writes via
/// `path.contains("/tests/")`.
///
/// Threat surface (T-23-02-01): malicious `path` strings (e.g., traversal)
/// are returned verbatim — the eval-module glob check then fails its
/// `contains("src-tauri/src/evals/")` guard, so penalties don't fire
/// incorrectly on attacker-supplied input.
pub fn extract_target_path(tool_name: &str, args_str: &str) -> Option<String> {
    let v = serde_json::from_str::<serde_json::Value>(args_str).ok()?;
    match tool_name {
        "write_file" | "blade_write_file" | "edit_file" | "blade_edit_file" => {
            v.get("path")
                .or_else(|| v.get("file_path"))
                .and_then(|p| p.as_str())
                .map(String::from)
        }
        "forge_tool" | "blade_forge_tool" => {
            v.get("name")
                .and_then(|n| n.as_str())
                .map(|n| format!("skills/{}/scripts", n))
        }
        _ => None,
    }
}

/// D-23-02 path 2: returns true iff this call writes into eval module
/// sources or eval test fixtures (the game-the-test pattern).
pub fn touches_eval_module(call: &ToolCallTrace) -> bool {
    let Some(path) = extract_target_path(&call.tool_name, &call.args_str) else {
        return false;
    };
    (path.contains("src-tauri/src/evals/") && path.ends_with(".rs"))
        || (path.contains("tests/evals/") && path.ends_with(".rs"))
}

/// D-23-02 path 3: returns true iff this call is a no-op or has empty
/// result content. Detects the `noop`/`wait` builtins, common bash
/// no-op patterns (`echo done`, `sleep N`, `true`, `:`), and falls
/// through to a generic empty-result check.
pub fn is_noop_call(call: &ToolCallTrace) -> bool {
    if NOOP_TOOL_NAMES.contains(&call.tool_name.as_str()) { return true; }
    if call.tool_name == "blade_run_bash" || call.tool_name == "bash" {
        let cmd = serde_json::from_str::<serde_json::Value>(&call.args_str).ok()
            .and_then(|v| v.get("command").and_then(|c| c.as_str().map(|s| s.to_string())))
            .unwrap_or_default();
        let trimmed = cmd.trim();
        if (trimmed.starts_with("echo ")
                && (trimmed.contains("done") || trimmed.contains("ok")))
            || trimmed.starts_with("sleep ")
            || trimmed == "true"
            || trimmed == ":"
        {
            return true;
        }
    }
    call.result_content.trim().is_empty()
}

/// Resolve the user's `~/.blade` skill directory. Mirrors `tool_forge.rs`
/// resolution; falls back to `$HOME/.blade` if the `dirs` crate's
/// `home_dir` is unavailable on this platform.
fn skills_root() -> Option<PathBuf> {
    if let Some(h) = dirs::home_dir() {
        return Some(h.join(".blade").join("skills"));
    }
    std::env::var("HOME").ok().map(|h| {
        PathBuf::from(h).join(".blade").join("skills")
    })
}

/// D-23-02 path 1: returns true iff a `forge_tool` call ran this turn AND
/// no test file was written within the turn AND every forged skill's dir
/// also lacks pre-existing tests on disk.
///
/// "Wrote a test file" = any tool call with `extract_target_path` matching
/// `/tests/`, prefix `tests/`, or any path containing `_test.`.
///
/// "Has existing tests" = `~/.blade/skills/<name>/tests/` exists, OR any
/// file in `~/.blade/skills/<name>/scripts/` contains `_test.` in its name.
///
/// Threat surface (T-23-02-03): `read_dir` failures (symlink loops, huge
/// dirs) `unwrap_or(false)` — penalty fires conservatively, biasing
/// against false negatives.
pub fn penalty_skill_no_tests(acc: &TurnAccumulator) -> bool {
    let calls = acc.snapshot_calls();
    let forge_calls: Vec<&ToolCallTrace> = calls.iter()
        .filter(|c| c.tool_name == "forge_tool" || c.tool_name == "blade_forge_tool")
        .collect();
    if forge_calls.is_empty() { return false; }

    let wrote_test = calls.iter().any(|c| {
        extract_target_path(&c.tool_name, &c.args_str).map_or(false, |p| {
            p.contains("/tests/") || p.starts_with("tests/") || p.contains("_test.")
        })
    });
    if wrote_test { return false; }

    forge_calls.iter().all(|c| {
        let name = serde_json::from_str::<serde_json::Value>(&c.args_str).ok()
            .and_then(|v| v.get("name").and_then(|n| n.as_str().map(String::from)))
            .unwrap_or_default();
        if name.is_empty() { return true; }  // can't verify → conservatively penalize
        let Some(skills) = skills_root() else { return true; };
        let skill_dir = skills.join(&name);
        let has_tests = skill_dir.join("tests").exists()
            || skill_dir.join("scripts").read_dir()
                .map(|rd| rd.filter_map(Result::ok)
                    .any(|e| e.file_name().to_string_lossy().contains("_test.")))
                .unwrap_or(false);
        !has_tests
    })
}

// ---------------------------------------------------------------------
// Eval-history reader (gate input for `eval_gate` raw component).
// ---------------------------------------------------------------------

/// One parsed line from `tests/evals/history.jsonl`. Mirrors
/// `harness::record_eval_run`'s on-disk shape but only reads the two
/// fields we care about (module + floor_passed). Other fields are
/// `#[serde(default)]` so partial records still parse.
#[derive(Debug, Clone, Deserialize)]
struct EvalRunRecord {
    #[serde(default)]
    #[allow(dead_code)]
    timestamp:    String,
    module:       String,
    floor_passed: bool,
}

/// Resolve the eval history path. Mirrors `doctor::eval_history_path` at
/// `doctor.rs:167–177` and honors `BLADE_EVAL_HISTORY_PATH` for tests.
fn eval_history_path_for_gate() -> PathBuf {
    if let Ok(p) = std::env::var("BLADE_EVAL_HISTORY_PATH") {
        return PathBuf::from(p);
    }
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("CARGO_MANIFEST_DIR has parent")
        .join("tests")
        .join("evals")
        .join("history.jsonl")
}

/// Tail-read up to `limit` `EvalRunRecord` entries from `history.jsonl`.
/// Missing file → `Vec::new()` (D-16). Pure-private helper; the public
/// reader on `doctor.rs` covers the broader surface.
fn read_eval_history_for_gate(limit: usize) -> Vec<EvalRunRecord> {
    let path = eval_history_path_for_gate();
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(limit);
    lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str::<EvalRunRecord>(l).ok())
        .collect()
}

// ---------------------------------------------------------------------
// Acceptance signal — D-23-01 stub (returns 1.0 in v1.3).
// ---------------------------------------------------------------------

/// D-23-01 stub. v1.3 returns `1.0` unconditionally; v1.4 will replace
/// this with regenerate/edit detection from the chat surface UI.
fn acceptance_signal() -> f32 { 1.0 }

// ---------------------------------------------------------------------
// Component computation — REWARD-02 no-cross-contamination order.
// ---------------------------------------------------------------------

/// Compute `(raw, post_penalty, penalty_labels)` from the accumulator,
/// in the locked REWARD-02 order:
///
/// 1. Each raw component is derived from independent inputs.
/// 2. Penalties are applied per-component (multiply, never add).
/// 3. Returns the labels of penalties that fired so the caller can
///    persist them and emit `reward:penalty_applied`.
///
/// N/A defaults (LOCKED in 23-RESEARCH.md §"N/A Handling"):
/// - `skill_success` defaults to `1.0` if no forge call ran this turn
/// - `eval_gate` defaults to `1.0` if `history.jsonl` is missing/empty
/// - `acceptance` is always `1.0` (D-23-01 stub)
/// - `completion` defaults to `1.0` if the turn fired no tool calls
pub fn compute_components(
    acc: &TurnAccumulator,
) -> (RewardComponents, RewardComponents, Vec<String>) {
    let calls = acc.snapshot_calls();

    // ---- Raw skill_success (independent input: forge_ok flag) ----
    let raw_skill = match acc.forge_ok.lock().ok().and_then(|g| *g) {
        Some(true)  => 1.0,
        Some(false) => 0.0,
        None        => 1.0, // N/A → 1.0
    };

    // ---- Raw eval_gate (independent input: latest history.jsonl per module) ----
    let raw_eval = {
        let history = read_eval_history_for_gate(200);
        if history.is_empty() {
            1.0 // N/A → 1.0 (D-16 missing history is Green)
        } else {
            // Last record per module — all-pass = 1.0, any-fail = 0.0.
            let mut latest: std::collections::HashMap<String, bool> =
                std::collections::HashMap::new();
            for rec in &history {
                latest.insert(rec.module.clone(), rec.floor_passed);
            }
            if latest.values().all(|&p| p) { 1.0 } else { 0.0 }
        }
    };

    // ---- Raw acceptance (D-23-01 stub) ----
    let raw_acceptance = acceptance_signal();

    // ---- Raw completion (independent input: last tool call's noop status) ----
    let raw_completion = if calls.is_empty() {
        1.0 // N/A → 1.0 (chat-only turn is a successful completion)
    } else {
        match calls.last() {
            Some(last) if is_noop_call(last) => 0.0,
            Some(last) if last.result_content.trim().is_empty() => 0.0,
            _ => 1.0,
        }
    };

    let raw = RewardComponents {
        skill_success: raw_skill,
        eval_gate:     raw_eval,
        acceptance:    raw_acceptance,
        completion:    raw_completion,
    };

    // ---- Penalty detection (each multiplies a single component) ----
    let mut post = raw.clone();
    let mut labels: Vec<String> = Vec::new();

    if penalty_skill_no_tests(acc) {
        post.skill_success *= 0.7;
        labels.push("skill_no_tests".to_string());
    }
    if calls.iter().any(touches_eval_module) {
        post.eval_gate *= 0.7;
        labels.push("eval_gate_module_touched".to_string());
    }
    if calls.last().map_or(false, is_noop_call) {
        post.completion *= 0.0;
        labels.push("completion_noop".to_string());
    }

    (raw, post, labels)
}

// ---------------------------------------------------------------------
// Activity emit (M-07 contract — `reward:penalty_applied`).
// ---------------------------------------------------------------------

/// Module label rendered in ActivityStrip rows for reward events.
#[allow(dead_code)]
const REWARD_MODULE: &str = "Reward";

/// Emit `reward:penalty_applied` to the ActivityStrip when any of the 3
/// D-23-02 penalty paths fired. Mirrors `voyager_log::emit` shape (M-07).
///
/// Silent on error: ActivityStrip is observational; a failed emit must
/// not break the chat loop. Safe to call without an AppHandle (test
/// context — log warn + early return, mirrors voyager_log posture).
///
/// Plan 23-08 lands the sibling `reward:ood_gate_zero` emit when REWARD-06
/// fires; this plan only emits `penalty_applied`.
fn emit_penalty_applied(labels: &[String], post_components: &RewardComponents) {
    if labels.is_empty() { return; }
    let Some(app) = crate::integration_bridge::get_app_handle() else {
        log::warn!("[reward] no app handle for penalty_applied: {:?}", labels);
        return;
    };
    use tauri::Emitter;
    let summary = format!("penalty_applied: {}", labels.join(","));
    if let Err(e) = app.emit_to(
        "main",
        "blade_activity_log",
        serde_json::json!({
            "module":        REWARD_MODULE,
            "action":        "penalty_applied",
            "human_summary": crate::safe_slice(&summary, 200),
            "payload_id":    serde_json::Value::Null,
            "payload":       serde_json::json!({
                "penalties":            labels,
                "post_skill_success":   post_components.skill_success,
                "post_eval_gate":       post_components.eval_gate,
                "post_completion":      post_components.completion,
            }),
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    ) {
        log::warn!("[reward] emit_to main failed for penalty_applied: {e}");
    }
}

// ---------------------------------------------------------------------
// Top-level orchestrator — invoked from commands.rs at the happy-path tail.
// ---------------------------------------------------------------------

/// Compute + persist the per-turn reward record. Called from
/// `commands.rs::send_message_stream_inline` immediately before the
/// singular happy-path `return Ok(())` at line 1821.
///
/// **Locked signature** (`&AppHandle, TurnAccumulator`) — Plan 23-08 will
/// extend the body with the OOD-floor gate but will NOT change the
/// signature. The `_app` parameter is currently unused (`emit_penalty_applied`
/// fetches its handle via `integration_bridge`); the parameter is kept so
/// Wave 3 doesn't need to re-touch the commands.rs hook.
///
/// Returns the persisted `RewardRecord` (used in tests; the production
/// caller discards the value).
///
/// Plan 23-02 stub: `ood_gate_zero: false` and `bootstrap_window: false`
/// are persisted unconditionally. Plan 23-08 layers on the real OOD gate.
pub async fn compute_and_persist_turn_reward(
    _app: &AppHandle,
    acc: TurnAccumulator,
) -> RewardRecord {
    compute_and_persist_turn_reward_inner(acc)
}

/// Inner body, no AppHandle needed — testable without `tauri::test`.
/// Production calls flow through the public wrapper above.
fn compute_and_persist_turn_reward_inner(acc: TurnAccumulator) -> RewardRecord {
    // Soft-clamp on bad weights per A1: load + validate + fall back to
    // defaults on failure rather than break the chat loop.
    let cfg = crate::config::load_config();
    let weights = if cfg.reward_weights.validate().is_ok() {
        cfg.reward_weights.clone()
    } else {
        log::warn!(
            "[reward] reward_weights failed validate(); falling back to defaults"
        );
        RewardWeights::default()
    };

    let (raw, post, penalties) = compute_components(&acc);
    let reward = compose(&post, &weights);

    // Plan 23-02 stub: OOD-floor gate is a no-op. Plan 23-08 replaces this
    // with the real bootstrap_window + ood_gate_zero computation.
    let ood_gate_zero    = false;
    let bootstrap_window = false;

    let rec = RewardRecord {
        timestamp:        chrono::Utc::now().to_rfc3339(),
        reward,
        components:       post.clone(),
        raw_components:   raw,
        weights,
        penalties_applied: penalties.clone(),
        ood_modules:      std::collections::BTreeMap::new(),
        bootstrap_window,
        ood_gate_zero,
    };

    record_reward(&rec);

    // M-07 emit: penalty_applied event row when any penalty fired.
    if !penalties.is_empty() {
        emit_penalty_applied(&penalties, &post);
    }

    rec
}

// ---------------------------------------------------------------------
// Tests — Wave 1 (6) + Wave 2 (8) covering composite math, JSONL
// round-trip, penalty detectors, component independence, and the
// orchestrator's persistence contract.
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

    // ----------------------------------------------------------------
    // Wave 2 — TurnAccumulator + penalty detectors + compute_components +
    // compute_and_persist_turn_reward (8 new tests).
    // ----------------------------------------------------------------

    /// Helper: build a synthetic `ToolCallTrace` for tests.
    fn trace(tool: &str, args: serde_json::Value, result: &str, is_error: bool) -> ToolCallTrace {
        ToolCallTrace {
            tool_name:      tool.to_string(),
            args_str:       serde_json::to_string(&args).unwrap_or_default(),
            result_content: result.to_string(),
            is_error,
            timestamp_ms:   chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Helper: build an `EvalRunRecord`-shaped JSONL line for the eval-gate
    /// reader tests (uses the real `harness::record_eval_run` JSON shape).
    fn write_eval_history(path: &std::path::Path, lines: &[(&str, bool)]) {
        std::fs::write(path, "").expect("truncate eval history tempfile");
        for (module, floor_passed) in lines {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(path)
                .expect("open eval history tempfile");
            let line = serde_json::json!({
                "timestamp":      chrono::Utc::now().to_rfc3339(),
                "module":         module,
                "top1":           1usize,
                "top3":           1usize,
                "mrr":            1.0_f32,
                "floor_passed":   floor_passed,
                "asserted_count": 1usize,
                "relaxed_count":  0usize,
            });
            writeln!(f, "{}", line).expect("write eval row");
        }
    }

    /// Test 7 — Path 1: forge_tool call + no test write + no skill dir on
    /// disk → `penalty_skill_no_tests` returns true. (REWARD-03 path 1)
    #[test]
    fn penalty_skill_no_tests() {
        let acc = TurnAccumulator::new();
        // Synthesize a forge_tool call against a deterministically-non-existent
        // skill name (random UUID-ish suffix). HOME might exist but the
        // skill dir won't, so the penalty should fire.
        let unique = format!("phase23-test-skill-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        acc.record_tool_call(trace(
            "forge_tool",
            serde_json::json!({ "name": unique, "description": "test" }),
            "Forged.",
            false,
        ));
        assert!(super::penalty_skill_no_tests(&acc),
            "forge call with no test write + no existing skill should trip the penalty");

        // Counter-case: same accumulator + a write_file to a tests/ path → no penalty.
        let acc2 = TurnAccumulator::new();
        acc2.record_tool_call(trace(
            "forge_tool",
            serde_json::json!({ "name": unique, "description": "test" }),
            "Forged.",
            false,
        ));
        acc2.record_tool_call(trace(
            "write_file",
            serde_json::json!({ "path": format!("tests/skills/{}_test.rs", unique) }),
            "Wrote 42 bytes.",
            false,
        ));
        assert!(!super::penalty_skill_no_tests(&acc2),
            "test-file write should suppress the penalty");
    }

    /// Test 8 — Path 2: any tool call writes into eval module sources →
    /// `touches_eval_module` returns true on that call; the
    /// post-penalty `eval_gate` is reduced by ≥30% via `compute_components`.
    /// (REWARD-03 path 2)
    #[test]
    fn penalty_eval_gate_touched() {
        // Direct assertions on the predicate.
        let touch = trace(
            "write_file",
            serde_json::json!({ "path": "src-tauri/src/evals/adversarial_eval.rs" }),
            "Wrote 250 LOC.",
            false,
        );
        assert!(super::touches_eval_module(&touch));

        let safe = trace(
            "write_file",
            serde_json::json!({ "path": "src-tauri/src/commands.rs" }),
            "Wrote.",
            false,
        );
        assert!(!super::touches_eval_module(&safe));

        let tests_evals = trace(
            "edit_file",
            serde_json::json!({ "file_path": "tests/evals/sample_test.rs" }),
            "Edited.",
            false,
        );
        assert!(super::touches_eval_module(&tests_evals));

        // Compute-level: penalty drops post.eval_gate by ≥30% relative to raw.
        // Set the eval-history path to a tempfile so raw.eval_gate = 1.0.
        let tmp = tempfile::NamedTempFile::new().expect("eval-history tempfile");
        write_eval_history(tmp.path(), &[("hybrid_search_eval", true)]);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", tmp.path());

        let acc = TurnAccumulator::new();
        acc.record_tool_call(touch.clone());
        let (raw, post, labels) = super::compute_components(&acc);

        assert!(labels.iter().any(|l| l == "eval_gate_module_touched"),
            "expected eval_gate_module_touched label, got {:?}", labels);
        assert!(raw.eval_gate >= post.eval_gate);
        let drop = (raw.eval_gate - post.eval_gate) / raw.eval_gate;
        assert!(drop >= 0.30 - 1e-6,
            "eval_gate drop {:.3} must be ≥30%; raw={} post={}",
            drop, raw.eval_gate, post.eval_gate);

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
    }

    /// Test 9 — Path 3: final tool is `noop` (or empty result) → post.completion = 0.0.
    /// (REWARD-03 path 3)
    #[test]
    fn penalty_completion_noop() {
        // Avoid stale eval-gate noise — point at a non-existent path so raw.eval_gate=1.0.
        let nonexistent = std::env::temp_dir().join("blade-reward-noop-history-doesnotexist.jsonl");
        let _ = std::fs::remove_file(&nonexistent);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &nonexistent);

        // Last tool = `noop`.
        let acc = TurnAccumulator::new();
        acc.record_tool_call(trace("write_file",
            serde_json::json!({ "path": "/tmp/foo.txt" }), "Wrote 10 bytes.", false));
        acc.record_tool_call(trace("noop", serde_json::json!({}), "", false));
        let (_, post, labels) = super::compute_components(&acc);
        assert!((post.completion - 0.0).abs() < 1e-6,
            "noop final tool must zero out completion; got {}", post.completion);
        assert!(labels.iter().any(|l| l == "completion_noop"),
            "expected completion_noop label, got {:?}", labels);

        // bash with `echo done` is also classified noop.
        let echo = trace("bash",
            serde_json::json!({ "command": "echo done" }), "done\n", false);
        assert!(super::is_noop_call(&echo));

        // Counter-case: bash with `cargo test` is NOT noop.
        let real = trace("bash",
            serde_json::json!({ "command": "cargo test" }),
            "running 5 tests...\ntest result: ok", false);
        assert!(!super::is_noop_call(&real));

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
    }

    /// Test 10 — Each penalty path reduces its component by ≥30% relative to raw.
    /// (REWARD-03 verifiable test — magnitude floor.)
    #[test]
    fn penalty_magnitude_at_least_30pct() {
        // skill_success path: ×0.7 ⇒ 30% drop exactly.
        let drop_skill = (1.0_f32 - 0.7_f32) / 1.0_f32;
        assert!(drop_skill >= 0.30 - 1e-6, "skill drop {:.3} >= 30%", drop_skill);

        // eval_gate path: ×0.7 ⇒ 30% drop exactly.
        let drop_eval = (1.0_f32 - 0.7_f32) / 1.0_f32;
        assert!(drop_eval >= 0.30 - 1e-6, "eval drop {:.3} >= 30%", drop_eval);

        // completion path: ×0.0 ⇒ 100% drop.
        let drop_comp = (1.0_f32 - 0.0_f32) / 1.0_f32;
        assert!(drop_comp >= 0.30 - 1e-6, "completion drop {:.3} >= 30%", drop_comp);

        // Empirical end-to-end check: synthesize an accumulator that trips
        // ALL THREE penalties and compare raw vs post component-by-component.
        let nonexistent = std::env::temp_dir()
            .join("blade-reward-magnitude-history-doesnotexist.jsonl");
        let _ = std::fs::remove_file(&nonexistent);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &nonexistent);

        let acc = TurnAccumulator::new();
        // Forge call with no tests written.
        let unique = format!("phase23-mag-skill-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
        acc.record_tool_call(trace("forge_tool",
            serde_json::json!({ "name": unique }), "Forged.", false));
        // Eval-module write.
        acc.record_tool_call(trace("write_file",
            serde_json::json!({ "path": "src-tauri/src/evals/x.rs" }),
            "Wrote.", false));
        // Final tool = noop.
        acc.record_tool_call(trace("noop", serde_json::json!({}), "", false));

        let (raw, post, labels) = super::compute_components(&acc);
        assert!(labels.contains(&"skill_no_tests".to_string()), "skill label missing: {:?}", labels);
        assert!(labels.contains(&"eval_gate_module_touched".to_string()), "eval label missing: {:?}", labels);
        assert!(labels.contains(&"completion_noop".to_string()), "completion label missing: {:?}", labels);

        if raw.skill_success > 0.0 {
            assert!((raw.skill_success - post.skill_success) / raw.skill_success >= 0.30 - 1e-6);
        }
        if raw.eval_gate > 0.0 {
            assert!((raw.eval_gate - post.eval_gate) / raw.eval_gate >= 0.30 - 1e-6);
        }
        if raw.completion > 0.0 {
            assert!((raw.completion - post.completion) / raw.completion >= 0.30 - 1e-6);
        }

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
    }

    /// Test 11 — REWARD-02: each component is computed from independent
    /// inputs; no leakage. Builds 4 distinct accumulators and verifies that
    /// changing the input for one component does NOT shift the others.
    #[test]
    fn components_independent() {
        // Hermetic eval history: all-pass so raw.eval_gate=1.0 baseline.
        let tmp = tempfile::NamedTempFile::new().expect("history tempfile");
        write_eval_history(tmp.path(), &[("hybrid_search_eval", true)]);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", tmp.path());

        // Baseline: empty accumulator. Expected raw = (1, 1, 1, 1) (all N/A).
        let acc_baseline = TurnAccumulator::new();
        let (raw_b, _, _) = super::compute_components(&acc_baseline);
        assert!((raw_b.skill_success - 1.0).abs() < 1e-6, "baseline skill should be 1.0");
        assert!((raw_b.eval_gate - 1.0).abs() < 1e-6, "baseline eval should be 1.0");
        assert!((raw_b.acceptance - 1.0).abs() < 1e-6, "baseline acceptance should be 1.0");
        assert!((raw_b.completion - 1.0).abs() < 1e-6, "baseline completion should be 1.0");

        // Independent skill flip: forge_ok=false → only skill_success drops; others unchanged.
        let acc_skill_flip = TurnAccumulator::new();
        acc_skill_flip.set_forge_ok(false);
        let (raw_s, _, _) = super::compute_components(&acc_skill_flip);
        assert!((raw_s.skill_success - 0.0).abs() < 1e-6, "skill flip should drop skill to 0.0");
        assert!((raw_s.eval_gate - raw_b.eval_gate).abs() < 1e-6, "skill flip leaked into eval");
        assert!((raw_s.acceptance - raw_b.acceptance).abs() < 1e-6, "skill flip leaked into acceptance");
        assert!((raw_s.completion - raw_b.completion).abs() < 1e-6, "skill flip leaked into completion");

        // Independent eval flip: write a failing eval row → only eval_gate drops.
        write_eval_history(tmp.path(), &[("hybrid_search_eval", false)]);
        let (raw_e, _, _) = super::compute_components(&acc_baseline);
        assert!((raw_e.eval_gate - 0.0).abs() < 1e-6, "eval flip should drop eval_gate to 0.0");
        assert!((raw_e.skill_success - raw_b.skill_success).abs() < 1e-6, "eval flip leaked into skill");
        assert!((raw_e.acceptance - raw_b.acceptance).abs() < 1e-6, "eval flip leaked into acceptance");
        assert!((raw_e.completion - raw_b.completion).abs() < 1e-6, "eval flip leaked into completion");

        // Independent completion flip: last call = noop → only completion drops.
        write_eval_history(tmp.path(), &[("hybrid_search_eval", true)]);
        let acc_comp_flip = TurnAccumulator::new();
        acc_comp_flip.record_tool_call(trace("noop", serde_json::json!({}), "", false));
        let (raw_c, _, _) = super::compute_components(&acc_comp_flip);
        assert!((raw_c.completion - 0.0).abs() < 1e-6, "completion flip should drop completion to 0.0");
        assert!((raw_c.skill_success - raw_b.skill_success).abs() < 1e-6, "completion flip leaked into skill");
        assert!((raw_c.eval_gate - raw_b.eval_gate).abs() < 1e-6, "completion flip leaked into eval");
        assert!((raw_c.acceptance - raw_b.acceptance).abs() < 1e-6, "completion flip leaked into acceptance");

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
    }

    /// Test 12 — N/A defaults: a turn that fires no tool calls and no
    /// forge resolves all four components to 1.0.
    #[test]
    fn na_defaults_resolve_to_one() {
        // Point eval-history at a non-existent path so raw.eval_gate=1.0 (D-16).
        let nonexistent = std::env::temp_dir()
            .join("blade-reward-na-history-doesnotexist.jsonl");
        let _ = std::fs::remove_file(&nonexistent);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &nonexistent);

        let acc = TurnAccumulator::new();
        let (raw, post, labels) = super::compute_components(&acc);

        assert!(labels.is_empty(), "no penalties should fire on empty accumulator; got {:?}", labels);
        assert!((raw.skill_success - 1.0).abs() < 1e-6);
        assert!((raw.eval_gate - 1.0).abs() < 1e-6);
        assert!((raw.acceptance - 1.0).abs() < 1e-6);
        assert!((raw.completion - 1.0).abs() < 1e-6);
        // post == raw on no penalties.
        assert!((post.skill_success - raw.skill_success).abs() < 1e-6);
        assert!((post.eval_gate - raw.eval_gate).abs() < 1e-6);
        assert!((post.completion - raw.completion).abs() < 1e-6);

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
    }

    /// Test 13 — `compute_components` returns the correct penalty label list
    /// when penalties fire. The ActivityStrip emit (`reward:penalty_applied`)
    /// payload is derived from this list, so asserting the labels here is
    /// equivalent to asserting the emit row's penalty-name field.
    ///
    /// We can't capture the emit itself without an AppHandle (the helper
    /// log-warns and returns cleanly in test context — same posture as
    /// `voyager_log::tests::emit_helpers_safe_without_app_handle`), but we
    /// assert that calling `compute_and_persist_turn_reward_inner` fires
    /// without panicking and persists the labels into the JSONL row.
    #[test]
    fn activity_emit_on_penalty() {
        // Hermetic eval-history + reward-history paths.
        let history_tmp = tempfile::NamedTempFile::new().expect("eval-history");
        write_eval_history(history_tmp.path(), &[("hybrid_search_eval", true)]);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", history_tmp.path());

        let reward_tmp = tempfile::NamedTempFile::new().expect("reward-history");
        std::env::set_var("BLADE_REWARD_HISTORY_PATH", reward_tmp.path());
        std::fs::write(reward_tmp.path(), "").expect("truncate");

        // Synthesize: write_file to evals/ AND last call = noop → 2 penalties fire.
        let acc = TurnAccumulator::new();
        acc.record_tool_call(trace("write_file",
            serde_json::json!({ "path": "src-tauri/src/evals/x.rs" }),
            "Wrote.", false));
        acc.record_tool_call(trace("noop", serde_json::json!({}), "", false));

        let rec = super::compute_and_persist_turn_reward_inner(acc);
        assert!(rec.penalties_applied.iter().any(|l| l == "eval_gate_module_touched"),
            "expected eval_gate_module_touched in {:?}", rec.penalties_applied);
        assert!(rec.penalties_applied.iter().any(|l| l == "completion_noop"),
            "expected completion_noop in {:?}", rec.penalties_applied);

        // Confirm the emit helper itself is safe-to-call without AppHandle
        // (same posture as `voyager_log::tests::emit_helpers_safe_without_app_handle`).
        super::emit_penalty_applied(
            &vec!["eval_gate_module_touched".to_string(), "completion_noop".to_string()],
            &rec.components,
        );

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
        std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
    }

    /// Test 14 — Happy path: `compute_and_persist_turn_reward_inner` writes
    /// a single 9-field RewardRecord line to `reward_history.jsonl`.
    /// (REWARD-04)
    #[test]
    fn happy_path_persists_record() {
        // Hermetic everything.
        let history_tmp = tempfile::NamedTempFile::new().expect("eval-history");
        write_eval_history(history_tmp.path(), &[("hybrid_search_eval", true)]);
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", history_tmp.path());

        let reward_tmp = tempfile::NamedTempFile::new().expect("reward-history");
        std::env::set_var("BLADE_REWARD_HISTORY_PATH", reward_tmp.path());
        std::fs::write(reward_tmp.path(), "").expect("truncate");

        // Clean turn — no penalties.
        let acc = TurnAccumulator::new();
        acc.record_tool_call(trace(
            "write_file",
            serde_json::json!({ "path": "/tmp/example.txt" }),
            "Wrote 42 bytes.",
            false,
        ));

        let rec = super::compute_and_persist_turn_reward_inner(acc);

        // Schema invariants.
        assert!(!rec.timestamp.is_empty(), "timestamp must be set");
        assert!(rec.reward >= 0.0 && rec.reward <= 1.0, "reward in [0,1], got {}", rec.reward);
        assert!(rec.penalties_applied.is_empty(), "no penalties expected on clean turn; got {:?}", rec.penalties_applied);
        assert!(!rec.bootstrap_window, "Plan 23-02 stub locks bootstrap_window=false");
        assert!(!rec.ood_gate_zero, "Plan 23-02 stub locks ood_gate_zero=false");
        assert!(rec.ood_modules.is_empty(), "ood_modules empty in Plan 23-02 (Plan 23-08 fills)");

        // JSONL persistence — exactly one row in the tempfile.
        let rows = read_reward_history(usize::MAX);
        assert_eq!(rows.len(), 1, "expected exactly 1 row, got {}", rows.len());
        assert!((rows[0].reward - rec.reward).abs() < 1e-6, "round-tripped reward must match");

        std::env::remove_var("BLADE_EVAL_HISTORY_PATH");
        std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
    }

    /// Test 15 — TurnAccumulator threading. Spawn 4 threads each calling
    /// `record_tool_call` 50 times → final snapshot has 200 entries with
    /// no panics. (Pitfall 4 future-proofing.)
    #[test]
    fn turn_accumulator_record_tool_call_thread_safe() {
        let acc = TurnAccumulator::new();
        let acc_arc = std::sync::Arc::new(acc);
        let mut handles = Vec::new();
        for tid in 0..4 {
            let acc_clone = acc_arc.clone();
            handles.push(std::thread::spawn(move || {
                for i in 0..50 {
                    acc_clone.record_tool_call(ToolCallTrace {
                        tool_name:      format!("tool_{}", tid),
                        args_str:       format!("{{\"i\":{}}}", i),
                        result_content: "ok".to_string(),
                        is_error:       false,
                        timestamp_ms:   0,
                    });
                }
            }));
        }
        for h in handles { h.join().expect("thread join"); }

        let snap = acc_arc.snapshot_calls();
        assert_eq!(snap.len(), 200, "expected 200 entries from 4×50, got {}", snap.len());
    }
}
