# Phase 23 — Verifiable Reward + OOD Eval — Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 12 (4 NEW Rust + 6 MODIFIED Rust/TS + 1 verify script + 1 jsonl placeholder)
**Analogs found:** 12 / 12 (every target has a clean in-tree precedent — no "no analog" rows)

> **Read-only output.** This file maps existing BLADE patterns onto the Phase 23 file list so the planner can reference concrete excerpts (file path + line range) inside each plan's action list. Excerpts trimmed to 15–40 LOC each.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src-tauri/src/reward.rs` (NEW) | service / production module — composite arithmetic + per-turn persistence + history reader + emit helper | batch (per-turn) + file-I/O (jsonl append) + event-driven (ActivityStrip emit) | `src-tauri/src/voyager_log.rs` (emit pattern) + `src-tauri/src/evals/harness.rs` (jsonl writer) + `src-tauri/src/doctor.rs::read_eval_history` (tail-reader) | exact (3-source split — composite analog) |
| `src-tauri/src/evals/adversarial_eval.rs` (NEW) | test / eval module — fixture corpus + classifier + harness wire-up | request-response (deterministic predicate) | `src-tauri/src/evals/capability_gap_eval.rs` | exact |
| `src-tauri/src/evals/ambiguous_intent_eval.rs` (NEW) | test / eval module | request-response | `src-tauri/src/evals/capability_gap_eval.rs` (struct shape) + `src-tauri/src/evals/typed_memory_eval.rs` (boundary-fixture pattern) | exact |
| `src-tauri/src/evals/capability_gap_stress_eval.rs` (NEW) | test / eval module — capability-missing stress | request-response (with Voyager success path) | `src-tauri/src/evals/capability_gap_eval.rs` | exact (same family) |
| `src-tauri/src/lib.rs` (MOD) | mod registration | n/a | `mod voyager_log;` line 30 (Phase 22 precedent) | exact |
| `src-tauri/src/evals/mod.rs` (MOD) | mod registration | n/a | existing 5 `#[cfg(test)] mod *_eval;` lines | exact |
| `src-tauri/src/config.rs` (MOD) | config — `RewardWeights` 6-place wiring | n/a | `voyager_skill_write_budget_tokens` (Phase 22 — verified live at 9 sites) | exact |
| `src-tauri/src/commands.rs` (MOD) | controller — hook `compute_and_persist_turn_reward` at end of `send_message_stream_inline` happy path | request-response | `commands.rs:1621` `chat_done` emit + `commands.rs:1820` `return Ok(())` (Phase-3 happy-path precedent) | exact (live target, not analog — the analog is "this function's existing tail emits") |
| `src-tauri/src/doctor.rs` (MOD) | aggregator extension — 6th `SignalClass`, sibling `compute_reward_signal`, 3 new `suggested_fix` arms, 6th `tokio::join!` arm | event-driven | `compute_eval_signal` at `doctor.rs:207` + suggested_fix table at `doctor.rs:91` + orchestrator at `doctor.rs:771` | exact (verbatim mirror) |
| `src/lib/events/payloads.ts` (MOD) | TS literal-union extension on `DoctorEventPayload['class']` | n/a | line 759 — existing 5-variant union | exact |
| `src/lib/tauri/admin.ts` (MOD) | TS `SignalClass` type extension | n/a | lines 1826–1831 — existing 5-variant `SignalClass` | exact |
| `src/features/admin/DoctorPane.tsx` (MOD) | UI — 1 row added to existing 5-row pattern | n/a | `DISPLAY_NAME` (line 40) + `ROW_ORDER` (line 49) + `rowRefs` (line 124) | exact |
| `scripts/verify-eval.sh` (MOD) | gate — `EXPECTED=5 → 8` | n/a | line 41 in same file | exact (single-token bump) |
| `tests/evals/reward_history.jsonl` (NEW gitkeep) + `.gitignore` (MOD) | fixture / persistence target | file-I/O | `tests/evals/.gitkeep` + `.gitignore:50 tests/evals/history.jsonl` | exact |

---

## Pattern Assignments

### NEW: `src-tauri/src/reward.rs` (production module — Wave 1/2/3 incremental)

**Role:** composite arithmetic + persistence + emit helper + history tail-reader.
**Three sub-analogs** (the file is 3-in-1):

#### Sub-analog 1 — JSONL writer (mirrors `harness::record_eval_run`)

**Source:** `src-tauri/src/evals/harness.rs:223–247`

```rust
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
```

**What `reward.rs::record_reward` must clone:**
- `chrono::Utc::now().to_rfc3339()` for `timestamp` (matches Phase 17 `EvalRunRecord` shape so doctor parsing stays uniform)
- `OpenOptions::new().create(true).append(true).open(&path)` — single `writeln!` (Pitfall 3: <PIPE_BUF=4096B atomic guarantee depends on this single-call shape)
- `let _ = std::fs::create_dir_all(parent);` so first run on a clean install doesn't no-op
- Best-effort error swallow — matches "fire-and-forget" convention of the analog

#### Sub-analog 2 — Path resolver (mirrors `harness::history_jsonl_path` + `doctor::eval_history_path`)

**Source A:** `src-tauri/src/evals/harness.rs:197–207` (test seam)
**Source B:** `src-tauri/src/doctor.rs:167–177` (production duplicate of the same 4-line resolver)

```rust
// doctor.rs:167–177
fn eval_history_path() -> std::path::PathBuf {
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
```

**What `reward.rs` must clone (TWICE — once for production-side reward read in commands.rs flow, once for doctor.rs read):**
- Env override: `BLADE_REWARD_HISTORY_PATH` (Pitfall 4 — mandatory for hermetic tests)
- `env!("CARGO_MANIFEST_DIR").parent()` → `tests/evals/reward_history.jsonl` (NOT under `src-tauri/` — confirmed live: `tests/evals/` lives at `/home/arnav/blade/tests/evals/`)
- The 4-line shape repeats verbatim. The duplication-vs-extract debate already played out in Phase 17 (doctor.rs:162–166 docstring locks "duplicate"); follow that precedent.

#### Sub-analog 3 — Tail-reader (mirrors `doctor::read_eval_history`)

**Source:** `src-tauri/src/doctor.rs:182–193`

```rust
fn read_eval_history(limit: usize) -> Vec<EvalRunRecord> {
    let path = eval_history_path();
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
```

**What `reward.rs::read_reward_history(2000)` clones:**
- Missing-file → empty `Vec` (D-16 convention — Doctor treats missing-history as Green; reward bootstrap_window honors the same)
- Tail-by-`saturating_sub` (no SeekFrom-end gymnastics needed at v1.3 scale)
- Per-line `serde_json::from_str::<RewardHistoryEntry>(l).ok()` filter — malformed rows silently dropped (matches harness behavior; rebuilds on the next clean turn)

#### Sub-analog 4 — ActivityStrip emit (mirrors `voyager_log::emit`)

**Source:** `src-tauri/src/voyager_log.rs:39–64`

```rust
pub fn emit(action: &'static str, human_summary: &str, payload: serde_json::Value) {
    let app = match crate::integration_bridge::get_app_handle() {
        Some(h) => h,
        None => {
            log::warn!(
                "[voyager_log] no app handle for {action}: {}",
                crate::safe_slice(human_summary, 100)
            );
            return;
        }
    };
    if let Err(e) = app.emit_to(
        "main",
        "blade_activity_log",
        json!({
            "module":        MODULE,            // "Voyager" → "Reward"
            "action":        action,            // "skill_used" → "penalty_applied" / "ood_gate_zero"
            "human_summary": crate::safe_slice(human_summary, 200),
            "payload_id":    serde_json::Value::Null,
            "payload":       payload,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    ) {
        log::warn!("[voyager_log] emit_to main failed for {action}: {e}");
    }
}
```

**What `reward.rs` clones:**
- `MODULE: &str = "Reward"` constant (parallel to voyager_log line 28)
- `integration_bridge::get_app_handle()` (no AppHandle parameter pollution)
- `safe_slice(_, 200)` truncation — **mandatory** per CLAUDE.md "non-ASCII string slicing" rule
- `app.emit_to("main", "blade_activity_log", ...)` — same wire as Doctor + Voyager
- Action labels (per RESEARCH §"ActivityStrip emit on penalty"): `"penalty_applied"` and `"ood_gate_zero"`
- Silent on error (M-07 contract — observational only, does not break chat loop)

**Imports / wiring required (`reward.rs`):**
```rust
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};   // if guard pattern needed
use tauri::{AppHandle, Emitter};
use crate::config::{load_config, RewardWeights};
use crate::safe_slice;
use crate::integration_bridge;
```

**Gotchas (CLAUDE.md + RESEARCH §"Common Pitfalls"):**
- **Pitfall 1 (6-place rule):** `grep -n reward_weights src-tauri/src/config.rs | wc -l` must return exactly 9 (matches voyager_skill_write_budget_tokens precedent: 175,184,300,325,387,517,654,740,801 — verify via `grep -n voyager_skill_write_budget_tokens src-tauri/src/config.rs`).
- **Pitfall 3 (jsonl write race):** single `writeln!` call ≤ PIPE_BUF (4096 B). Truncate `penalties_applied` to first 3 entries if record exceeds 4000 B.
- **Pitfall 5 (sum validation):** validate `sum ∈ [0.0, 1.0 + 1e-3]`, NOT `sum == 1.0`. Default sum is `0.5+0.3+0.0+0.1 = 0.9` in v1.3 (acceptance silenced).
- **Pitfall 6 (bootstrap_window):** `bootstrap_window = (history.is_empty() || oldest_entry_timestamp > now - 7.days)`. Empty history ⇒ true.
- **CLAUDE.md "non-ASCII":** every truncated string MUST go through `crate::safe_slice` — `&s[..n]` panics on emoji/CJK fixture content.
- **CLAUDE.md "duplicate `#[tauri::command]`":** `reward.rs` exposes NO `#[tauri::command]`. Confirmed by RESEARCH §"Hook Point §Data the Call Needs": only `compute_and_persist_turn_reward(&app, acc) -> RewardRecord` is called from `commands.rs`, no Tauri-command exposure. ⇒ NO `generate_handler!` entry needed.

---

### NEW: `src-tauri/src/evals/adversarial_eval.rs` + `ambiguous_intent_eval.rs` + `capability_gap_stress_eval.rs`

All three modules share the **same** analog and skeleton. Differ only in fixture content + classifier function + `MODULE_FLOOR` constant.

**Analog:** `src-tauri/src/evals/capability_gap_eval.rs` (215 LOC; mirrors directly)

**Excerpt — top of file (lines 1–55):** module docstring + use block + fixture struct + cases() function

```rust
//! Phase 16 / EVAL-05.
//!
//! [ ... module description with Run command + threading note ... ]
//!
//! ## Run
//! `cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, summarize, EvalRow};
use crate::self_upgrade::{capability_catalog, detect_missing_tool, CapabilityGap};

struct GapCase {
    label: &'static str,
    stderr: &'static str,
    command: &'static str,
    expected_suggestion_contains: Option<&'static str>,
}

fn cases() -> Vec<GapCase> {
    vec![
        GapCase {
            label: "linux_apt_jq",
            stderr: "/bin/sh: 1: jq: not found",
            command: "jq '.foo' data.json",
            expected_suggestion_contains: Some("jq"),
        },
        // ... 6 more
    ]
}
```

**Excerpt — test body (lines 144–214):** the LOAD-BEARING harness wire-up

```rust
#[test]
fn evaluates_capability_gap_detection() {
    // [pre-flight asserts skipped]
    let cases = cases();
    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    let mut all_pass = true;

    for case in &cases {
        let result = detect_missing_tool(case.stderr, case.command);
        let (pass, observed_top3) = case_passes(case, &result);
        if !pass { all_pass = false; }
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

    print_eval_table("Capability gap detection eval", &rows);   // EVAL-06: "┌── …"

    let s = summarize(&rows);
    let floor_passed = s.asserted_total > 0 && s.asserted_top1_count == s.asserted_total;
    super::harness::record_eval_run("capability_gap_eval", &s, floor_passed);  // ← MUST appear before assert!

    for (i, case) in cases.iter().enumerate() {
        assert!(rows[i].top1, "{} failed (...)", case.label);
    }
    assert!(all_pass, "capability gap eval: at least one case failed");
}
```

**Imports / wiring required (per OOD module):**
- `use super::harness::{print_eval_table, summarize, EvalRow};` — single source of truth for EVAL-06 box-drawing
- `super::harness::record_eval_run("<module_name>", &s, floor_passed)` MUST be called BEFORE the `assert!` block (Phase 17 D-14 — failures still generate a JSONL row)
- `print_eval_table("<Title> eval", &rows)` — verify-eval.sh greps `┌──` prefix on this line
- Per-module floor constant: `const MODULE_FLOOR: f32 = 0.85` (adversarial) / `0.80` (ambiguous) / `0.75` (capability_gap_stress)
- Module-specific classifier functions are deterministic, hand-written pattern matchers (D-23-03 hermetic CI)

**Per-module variations (locked by RESEARCH §"OOD Eval Module Specs"):**

| Module | Fixture struct field | Classifier output enum | Floor |
|--------|----------------------|------------------------|-------|
| `adversarial_eval.rs` | `expected: HandledOutcome` | `HandledOutcome { HardRefuse, SafeReformulation, Failed }` | 0.85 |
| `ambiguous_intent_eval.rs` | `expected: IntentVerdict` | `IntentVerdict { AskClarification, ConservativeChoice, SilentMisroute }` | 0.80 |
| `capability_gap_stress_eval.rs` | `expected: Outcome` | `Outcome { ForgedSkill, CapabilityMissing, Hallucinated }` | 0.75 |

**Gotchas:**
- **Pitfall 2 (EVAL-06 byte-sequence):** the box-drawing chars are U+250C U+2500 U+2500 — NEVER hand-roll the table; ALWAYS go through `harness::print_eval_table`. Unicode confusables silently fail the verify gate.
- **Hermetic / threading:** `temp_blade_env()` mutates `BLADE_CONFIG_DIR` process-globally. `verify-eval.sh` already pins `--test-threads=1`. OOD modules that DON'T touch SQLite (analog: `capability_gap_eval.rs` is pure — see its docstring "No SQLite involvement") can skip `temp_blade_env()`. Recommend pure pattern-classifier eval = same posture as capability_gap_eval.rs.
- **`record_eval_run` BEFORE `assert!`:** locked by Phase 17 D-14 in the analog's docstring.
- **`#[cfg(test)]` gate:** registered behind `#[cfg(test)]` in `evals/mod.rs` (evals/mod.rs lines 11–15 precedent — 5 existing modules are all gated this way).

---

### MOD: `src-tauri/src/lib.rs` — `mod reward;` registration

**Analog:** `src-tauri/src/lib.rs:30` (Phase 22 — `mod voyager_log; // Phase 22 v1.3 — Voyager loop ActivityStrip emit helpers`)

**Excerpt (lines 26–35) — first mod block (under `pub mod skills;`):**

```rust
pub mod skills;         // Phase 21 v1.3 — agentskills.io SKILL.md format substrate (pub for skill_validator bin)
mod voyager_log;        // Phase 22 v1.3 — Voyager loop ActivityStrip emit helpers
mod telegram;
mod thread;
mod tts;
```

**Where to insert `mod reward;`:** Append immediately after `mod voyager_log;` (line 31) — keeps the v1.3 substrate phases co-located. Suggested line:
```rust
mod reward;             // Phase 23 v1.3 — composite reward + per-turn persistence + ActivityStrip emit
```

**Note on the second mod block:** `lib.rs` has TWO mod blocks (lines 1–40 and lines 118–167 separated by file-internal helpers). The Phase 22 precedent (`mod voyager_log` line 30) lives in the FIRST block; follow suit. The second block (lines 118–167) is for OS / hardware modules — `reward.rs` is logic, not OS bindings.

**generate_handler! entry?** **NO.** `reward.rs` exposes `compute_and_persist_turn_reward(&app, acc)` as a regular `pub async fn` called from `commands.rs::send_message_stream_inline`, not as a `#[tauri::command]`. Confirmed in RESEARCH §"Hook Point §Data the Call Needs". The `generate_handler![]` macro at `lib.rs:603` does NOT need a `reward::*` entry.

**Gotchas (CLAUDE.md):**
- **CLAUDE.md "Module registration EVERY TIME":** the 1-line addition to `lib.rs` is mandatory. Without it the production-compiled binary will NOT find `crate::reward::*` and `cargo check` fails at the call site in `commands.rs`.

---

### MOD: `src-tauri/src/evals/mod.rs` — register 3 new OOD eval modules

**Analog:** existing 5-line block (lines 11–15) of `mod.rs`:

```rust
//! Eval harness — Phase 16 (.planning/phases/16-eval-scaffolding-expansion).
//! [...]

#[cfg(test)] pub mod harness;
#[cfg(test)] mod hybrid_search_eval;
#[cfg(test)] mod real_embedding_eval;
#[cfg(test)] mod kg_integrity_eval;
#[cfg(test)] mod typed_memory_eval;
#[cfg(test)] mod capability_gap_eval;
```

**What to append (3 lines, after line 15):**
```rust
#[cfg(test)] mod adversarial_eval;
#[cfg(test)] mod ambiguous_intent_eval;
#[cfg(test)] mod capability_gap_stress_eval;
```

**Gotchas:**
- **`#[cfg(test)]` is mandatory** — production reads NONE of the eval modules; only `harness` is `pub mod`. The new modules are pure test code.
- **Wave order:** if `verify-eval.sh EXPECTED=8` is bumped BEFORE these 3 mod lines land, the gate fails. Sequence enforced by RESEARCH §"Harness Integration": "DO NOT raise EXPECTED earlier — running `verify:eval` mid-wave with EXPECTED=8 and only some modules wired will fail the gate." This is a Wave 3 verification ordering constraint.

---

### MOD: `src-tauri/src/config.rs` — `RewardWeights` struct + 6-place wiring

**Analog (verified live):** `voyager_skill_write_budget_tokens: u64` (Phase 22, VOYAGER-07). Confirmed live at lines 180, 184, 299–300, 379, 515–516, 581, 740, 801. (RESEARCH cites 175/184/300/325/387/517/654/740/801 — slight drift but the count is exactly 9 sites; 6-place rule means 6 logical places, with 3 ancillary references for sum-validation, default helper, and docstring.)

**Excerpt — Site 1: default helper (config.rs:175–180):**

```rust
// Phase 22 (v1.3) — Voyager skill-write budget cap (VOYAGER-07).
// Total tokens (prompt + estimated response) above which forge_tool refuses
// the LLM call. 50_000 is generous headroom for typical scripts (~1K prompt
// + 5K-30K response); pathological cases trigger the refusal instead of
// runaway token spend.
fn default_voyager_skill_write_budget_tokens() -> u64 { 50_000 }
```

**Excerpt — Site 2: DiskConfig field (config.rs:298–300):**

```rust
    // Phase 22 Plan 22-03 (v1.3) — Voyager skill-write budget cap (VOYAGER-07)
    #[serde(default = "default_voyager_skill_write_budget_tokens")]
    voyager_skill_write_budget_tokens: u64,
```

**Excerpt — Site 3: DiskConfig::default (config.rs:377–381):**

```rust
            ecosystem_observe_only: true,
            voyager_skill_write_budget_tokens: default_voyager_skill_write_budget_tokens(),
            api_key: None,
        }
    }
```

**Excerpt — Site 4: BladeConfig field (config.rs:512–517):**

```rust
    /// Phase 22 Plan 22-03 (v1.3) — Voyager skill-write budget cap (VOYAGER-07).
    /// Total tokens (prompt + estimated response) above which `tool_forge::
    /// forge_tool` refuses the LLM call. Default 50_000.
    #[serde(default = "default_voyager_skill_write_budget_tokens")]
    pub voyager_skill_write_budget_tokens: u64,
```

**Excerpt — Site 5: BladeConfig::default (config.rs:579–582):**

```rust
            ecosystem_observe_only: true,
            voyager_skill_write_budget_tokens: default_voyager_skill_write_budget_tokens(),
        }
    }
```

**Excerpt — Site 6: load_config (config.rs:738–741):**

```rust
        ecosystem_tentacles: disk.ecosystem_tentacles,
        ecosystem_observe_only: disk.ecosystem_observe_only,
        voyager_skill_write_budget_tokens: disk.voyager_skill_write_budget_tokens,
    }
```

**Excerpt — Site 7: save_config (config.rs:799–802):**

```rust
        ecosystem_tentacles: config.ecosystem_tentacles.clone(),
        ecosystem_observe_only: config.ecosystem_observe_only,
        voyager_skill_write_budget_tokens: config.voyager_skill_write_budget_tokens,
        api_key: None,
```

**What Phase 23 must add — 7 mirrored sites for `reward_weights: RewardWeights`:**

1. New helper `fn default_reward_weights() -> RewardWeights { RewardWeights::default() }` (near line 180, alongside other defaults)
2. New struct `RewardWeights { skill_success, eval_gate, acceptance, completion: f32 }` + `impl Default + impl RewardWeights { sum, validate }` (top of file, ahead of DiskConfig — RESEARCH §"RewardWeights Struct Shape" specifies the exact shape)
3. `DiskConfig` field with `#[serde(default = "default_reward_weights")]`
4. `DiskConfig::default()` → `reward_weights: default_reward_weights(),`
5. `BladeConfig` field
6. `BladeConfig::default()` → `reward_weights: default_reward_weights(),`
7. `load_config` mapping → `reward_weights: disk.reward_weights.clone(),`
8. `save_config` mapping → `reward_weights: config.reward_weights.clone(),` (clone because `.cloning` matches the established pattern at line 799–800)

**Imports / wiring required:**
- New `RewardWeights` type **must derive `Serialize, Deserialize, Clone, Debug, PartialEq`** (matches `WindowState` and other config sub-structs).
- `validate()` is invoked at `save_config` start (hard-reject on bad weights) per RESEARCH §"RewardWeights Struct Shape" — gate the existing `set_api_key_in_keyring` call at line 746 behind a successful `config.reward_weights.validate()?`.

**Gotchas:**
- **Pitfall 1 (6-place rule):** EXACTLY 9 grep hits required (`grep -c "reward_weights\|default_reward_weights\|RewardWeights" src-tauri/src/config.rs`). Add a unit test that locks the count.
- **Pitfall 5 (sum tolerance):** `sum ∈ [0.0, 1.0 + 1e-3]`, NOT `sum == 1.0`. Default sum is 0.9 in v1.3.
- **CLAUDE.md "6-place rule" verbatim:** `New config field → add to ALL 6 places: DiskConfig struct, DiskConfig::default(), BladeConfig struct, BladeConfig::default(), load_config(), save_config()`. RewardWeights honors all 6.

---

### MOD: `src-tauri/src/commands.rs` — hook `compute_and_persist_turn_reward`

**Analog:** the existing `chat_done` happy-path emit at `commands.rs:1621` followed by the singular `return Ok(())` at `commands.rs:1821`. RESEARCH locked these line numbers; **verified live** — line 1621 is the `chat_done` emit, line 1821 is `return Ok(());` in the no-more-tools branch.

**Excerpt — Construction site (top of `send_message_stream_inline`, commands.rs:679–710):**

```rust
pub(crate) async fn send_message_stream_inline(
    app: tauri::AppHandle,
    state: SharedMcpManager,
    approvals: ApprovalMap,
    vector_store: crate::embeddings::SharedVectorStore,
    messages: Vec<ChatMessage>,
    emit_windows: &[&str],
) -> Result<(), String> {
    if CHAT_INFLIGHT.swap(true, Ordering::SeqCst) {
        return Err("Already processing a message...".to_string());
    }
    // [... emit-windows guard, inflight guard ...]
    let _inflight = InflightGuard;
```

**Insert TurnAccumulator directly after line 710** (after `_inflight` guard binding):
```rust
let mut turn_acc = crate::reward::TurnAccumulator::new();
```

**Excerpt — Tool-call recording site (commands.rs:1846 + 2156):**

```rust
        for tool_call in turn.tool_calls {
            let is_native = crate::native_tools::is_native(&tool_call.name);
            // [... ~310 LOC of dispatch + result handling ...]

            conversation.push(ConversationMessage::Tool {
                tool_call_id: tool_call.id,
                tool_name: tool_call.name,           // ← move happens here
                content,
                is_error,
            });
        }
```

**Insert `record_tool_call` immediately BEFORE line 2156** (the `conversation.push(ConversationMessage::Tool {...})` move site):
```rust
turn_acc.record_tool_call(crate::reward::ToolCallTrace {
    tool_name:    tool_call.name.clone(),
    args_str:     serde_json::to_string(&tool_call.arguments).unwrap_or_default(),
    result_content: crate::safe_slice(&content, 500).to_string(),
    is_error,
    timestamp_ms: chrono::Utc::now().timestamp_millis(),
});
```

**Excerpt — Reward compute site (commands.rs:1819–1822):**

```rust
            // EMOTIONAL INTELLIGENCE: detect emotion from user message (tool loop path)
            {
                let emotion_msg = user_text_thread.clone();
                let emotion_app = app.clone();
                tokio::spawn(async move {
                    crate::emotional_intelligence::process_message_emotion(&emotion_msg, emotion_app).await;
                });
            }

            return Ok(());
        }
```

**Insert reward call directly between line 1819 (closing `}` of emotion-intelligence block) and line 1821 (the `return Ok(())`):**
```rust
            // Phase 23 / REWARD-04 — composite reward + jsonl persist + emit on penalty
            crate::reward::compute_and_persist_turn_reward(&app, turn_acc).await;
            return Ok(());
        }
```

**Imports / wiring required (commands.rs):** none. `crate::reward::*` becomes available the moment `mod reward;` lands in `lib.rs`.

**Gotchas:**
- **CLAUDE.md "import `tauri::Manager`":** the existing `send_message_stream_inline` already imports what's needed; reward call uses only `crate::reward::*` and the existing `&app` parameter. No new `use` lines.
- **Pitfall 3 (jsonl race):** the reward call MUST stay on the same task as `chat_done`, NOT in a `tokio::spawn`. CHAT_INFLIGHT guard at line 707 holds until `_inflight` drops at function exit; serial writes guaranteed.
- **Pitfall 4 (TurnAccumulator threading):** RESEARCH recommends `Arc<Mutex<...>>` from day one. Synchronous `record_tool_call` is correct on the current single-task dispatch loop; the Mutex wrap is futureproofing.
- **A2 / A6 (failure path):** all 6 `return Err(...)` paths above line 1821 (lines 735, 791, 1004, 1337, 1360, 1530–1539) intentionally do NOT compute reward. Failure path = no reward write. The 2173+ "loop exhausted with synthetic stubs" branch is RESEARCH assumption A2 — confirm via plan-time line trace that it lexically returns from the same `Ok(())` at 1821.

---

### MOD: `src-tauri/src/doctor.rs` — extend SignalClass enum (5→6) + add `compute_reward_signal` + 3 suggested_fix arms + 6th aggregator arm

**Analog A — SignalClass enum (doctor.rs:32–40):**

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
}
```

**Insert as 6th variant** (RESEARCH §"SignalClass::RewardTrend Variant Placement" locks "after AutoUpdate, lowest-volatile last"):
```rust
    AutoUpdate,
    RewardTrend,  // ← Phase 23 / REWARD-04
}
```

**Analog B — suggested_fix table (doctor.rs:91–133):**

```rust
pub(crate) fn suggested_fix(class: SignalClass, severity: Severity) -> &'static str {
    match (class, severity) {
        // Eval Scores — UI-SPEC § 15
        (SignalClass::EvalScores, Severity::Green) =>
            "All eval modules are passing their asserted floors. Last 5 runs recorded in tests/evals/history.jsonl.",
        // [... 14 more arms across 5 classes × 3 severities = 15 total ...]
        (SignalClass::AutoUpdate, Severity::Red) =>
            "(Reserved — Auto-Update has no Red tier per D-09; if this string ever renders it indicates a bug in doctor.rs severity classification.)",
    }
}
```

**Append 3 new arms** (verbatim strings from RESEARCH §"SignalClass::RewardTrend Variant Placement"):
```rust
        // Reward Trend — Phase 23 D-23-04 (verbatim — invokes D-18 lock)
        (SignalClass::RewardTrend, Severity::Green) =>
            "Reward trend is steady. Last 7 days of per-turn composite reward computed from tests/evals/reward_history.jsonl.",
        (SignalClass::RewardTrend, Severity::Amber) =>
            "Composite reward dropped 10% or more from the prior 7-day rolling mean. Open the payload to see which component (skill_success / eval_gate / acceptance / completion) is regressing and inspect tests/evals/reward_history.jsonl for the inflection point.",
        (SignalClass::RewardTrend, Severity::Red) =>
            "Composite reward dropped 20% or more from the prior 7-day rolling mean. This indicates either a Voyager skill regression, an eval-gate breach, or sustained completion penalties. Run bash scripts/verify-eval.sh and check Doctor's EvalScores signal first; if eval_gate is green, inspect skill_success and completion components in tests/evals/reward_history.jsonl.",
```

**Analog C — `compute_eval_signal` (doctor.rs:207–222 — head; full body 207–~340):**

```rust
fn compute_eval_signal() -> Result<DoctorSignal, String> {
    let history = read_eval_history(200);
    let now_ms = chrono::Utc::now().timestamp_millis();

    if history.is_empty() {
        return Ok(DoctorSignal {
            class: SignalClass::EvalScores,
            severity: Severity::Green,
            payload: serde_json::json!({
                "history_count": 0,
                "note": "No eval runs recorded yet (tests/evals/history.jsonl missing or empty).",
            }),
            last_changed_at: now_ms,
            suggested_fix: suggested_fix(SignalClass::EvalScores, Severity::Green).to_string(),
        });
    }

    // Group records by module preserving append order (chronological).
    let mut by_module: HashMap<String, Vec<&EvalRunRecord>> = HashMap::new();
    for rec in &history {
        by_module.entry(rec.module.clone()).or_default().push(rec);
    }

    let mut any_red = false;
    // [... severity classification + payload construction ...]
}
```

**`compute_reward_signal()` is a verbatim mirror** (RESEARCH §"compute_reward_signal() Pattern" gives the full body, 80 LOC). Key differences:
- reads `read_reward_history(2000)` not `read_eval_history(200)`
- bucket-by-time not bucket-by-module (1-day window vs prior-7-day window)
- payload includes `components_today_mean` 4-key breakdown (REWARD-07 spec)

**Analog D — orchestrator aggregator (doctor.rs:771–822):**

```rust
#[tauri::command]
pub async fn doctor_run_full_check(app: AppHandle) -> Result<Vec<DoctorSignal>, String> {
    let (eval, capgap, tentacle, drift, autoupdate) = tokio::join!(
        async { compute_eval_signal() },
        async { compute_capgap_signal() },
        async { compute_tentacle_signal() },
        async { compute_drift_signal() },
        async { compute_autoupdate_signal() },
    );

    let signals: Vec<DoctorSignal> = vec![
        eval.map_err(|e| format!("eval signal: {}", e))?,
        capgap.map_err(|e| format!("capgap signal: {}", e))?,
        tentacle.map_err(|e| format!("tentacle signal: {}", e))?,
        drift.map_err(|e| format!("drift signal: {}", e))?,
        autoupdate.map_err(|e| format!("autoupdate signal: {}", e))?,
    ];

    // [... transition detection + emit + cache ...]
```

**Phase 23 changes (5 surgical insertions):**

1. **Add 6th `tokio::join!` arm** at line 775:
```rust
    let (eval, capgap, tentacle, drift, autoupdate, reward_trend) = tokio::join!(
        async { compute_eval_signal() },
        async { compute_capgap_signal() },
        async { compute_tentacle_signal() },
        async { compute_drift_signal() },
        async { compute_autoupdate_signal() },
        async { compute_reward_signal() },
    );
```

2. **Append signals[5]** at line 786:
```rust
    let signals: Vec<DoctorSignal> = vec![
        eval.map_err(|e| format!("eval signal: {}", e))?,
        capgap.map_err(|e| format!("capgap signal: {}", e))?,
        tentacle.map_err(|e| format!("tentacle signal: {}", e))?,
        drift.map_err(|e| format!("drift signal: {}", e))?,
        autoupdate.map_err(|e| format!("autoupdate signal: {}", e))?,
        reward_trend.map_err(|e| format!("reward_trend signal: {}", e))?,
    ];
```

**Analog E — emit_activity_for_doctor class match (doctor.rs:731–737):**

```rust
fn emit_activity_for_doctor(app: &AppHandle, signal: &DoctorSignal) {
    let class_str = match signal.class {
        SignalClass::EvalScores      => "EvalScores",
        SignalClass::CapabilityGaps  => "CapabilityGaps",
        SignalClass::TentacleHealth  => "TentacleHealth",
        SignalClass::ConfigDrift     => "ConfigDrift",
        SignalClass::AutoUpdate      => "AutoUpdate",
    };
```

**Insert 6th arm** (this is the "1 aggregator arm" mentioned in the spawn prompt — `match` exhaustiveness will fail to compile without it):
```rust
        SignalClass::AutoUpdate      => "AutoUpdate",
        SignalClass::RewardTrend     => "RewardTrend",
    };
```

**Analog F — verbatim test extension (doctor.rs:1198–1219):**

```rust
#[test]
fn suggested_fix_strings_match_ui_spec_verbatim() {
    assert_eq!(
        suggested_fix(SignalClass::EvalScores, Severity::Red),
        "An eval module breached its asserted floor (top-3 below 80% or MRR below 0.6). Run bash scripts/verify-eval.sh to identify which module and inspect tests/evals/history.jsonl for the drop point."
    );
    // [... 3 more verbatim asserts ...]
}
```

**Append one new verbatim assert** (drift detection on the longest D-23-04 string):
```rust
    assert_eq!(
        suggested_fix(SignalClass::RewardTrend, Severity::Red),
        "Composite reward dropped 20% or more from the prior 7-day rolling mean. This indicates either a Voyager skill regression, an eval-gate breach, or sustained completion penalties. Run bash scripts/verify-eval.sh and check Doctor's EvalScores signal first; if eval_gate is green, inspect skill_success and completion components in tests/evals/reward_history.jsonl."
    );
```

**Imports / wiring required:** none new in `doctor.rs` — `chrono::Utc`, `serde_json::json!`, `HashMap`, `Mutex` already in scope.

**Gotchas:**
- **CLAUDE.md "duplicate `#[tauri::command]` names":** `compute_reward_signal` is a `fn`, NOT a `#[tauri::command]`. Aggregator wraps it. No collision risk.
- **Match exhaustiveness:** all 5 places that `match signal.class { ... }` lives MUST gain a `RewardTrend` arm. Compile error catches misses. Verified locations: `emit_activity_for_doctor` (line 731), no others — `suggested_fix` already covered by the 3-arm append above.
- **Phase 17 D-16 ("missing history = Green"):** `compute_reward_signal` empty-history early return MUST return `Severity::Green`. Mirror `compute_eval_signal` lines 211–222 verbatim.

---

### MOD: `src/lib/events/payloads.ts` — `DoctorEventPayload['class']` literal-union update

**Analog (verified live, line 759):**

```ts
export interface DoctorEventPayload {
  class: 'eval_scores' | 'capability_gaps' | 'tentacle_health' | 'config_drift' | 'auto_update';
  severity: 'green' | 'amber' | 'red';
  prior_severity: 'green' | 'amber' | 'red';
  last_changed_at: number;  // unix milliseconds
  payload: unknown;
}
```

**Phase 23 change — single token append** (line 759):
```ts
  class: 'eval_scores' | 'capability_gaps' | 'tentacle_health' | 'config_drift' | 'auto_update' | 'reward_trend';
```

**Gotchas:**
- **Wire form:** Rust `SignalClass` uses `#[serde(rename_all = "snake_case")]`. Variant `RewardTrend` ⇒ wire string `'reward_trend'`. Lock alphabetic case (snake, not kebab).
- **Sister update:** RESEARCH lists this file as the only `payloads.ts` change, but the spawn prompt also flags `src/lib/tauri/admin.ts` line 1826 (`SignalClass` type). BOTH must change in lockstep — see next pattern row.

---

### MOD: `src/lib/tauri/admin.ts` — `SignalClass` type extension (sister to payloads.ts)

**Analog (verified live, lines 1826–1831):**

```ts
export type SignalClass =
  | 'eval_scores'
  | 'capability_gaps'
  | 'tentacle_health'
  | 'config_drift'
  | 'auto_update';
```

**Phase 23 change — single union member append:**
```ts
export type SignalClass =
  | 'eval_scores'
  | 'capability_gaps'
  | 'tentacle_health'
  | 'config_drift'
  | 'auto_update'
  | 'reward_trend';
```

**Why TWO TS files change:** `SignalClass` (admin.ts) is the type used by `DoctorPane.tsx` directly (`Record<SignalClass, ...>`); `DoctorEventPayload['class']` (payloads.ts) is the wire-event payload that `useTauriEvent<DoctorEventPayload>` consumes. They must remain in lockstep — the lockstep is enforced by human review per RESEARCH §"Wire form: SignalClass is `#[serde(rename_all = "snake_case")]`...drift detection is human code-review (D-38-payload)".

**Gotchas:**
- TypeScript is structural; if the `Record<SignalClass, string>` in DoctorPane.tsx (line 40 `DISPLAY_NAME` object) misses a key for the new variant, `tsc --noEmit` flags "missing property 'reward_trend'". This is the type-system gate that forces all 3 sites (DISPLAY_NAME / ROW_ORDER / rowRefs) to update together.

---

### MOD: `src/features/admin/DoctorPane.tsx` — 1 row appended to existing 5-row pattern

**Analog (verified live, lines 40–55):**

```tsx
// UI-SPEC § 14.3 — locked display names per signal class
const DISPLAY_NAME: Record<SignalClass, string> = {
  eval_scores: 'Eval Scores',
  capability_gaps: 'Capability Gaps',
  tentacle_health: 'Tentacle Health',
  config_drift: 'Config Drift',
  auto_update: 'Auto-Update',
};

// UI-SPEC § 7.5 — fixed most-volatile-first order
const ROW_ORDER: SignalClass[] = [
  'eval_scores',
  'capability_gaps',
  'tentacle_health',
  'config_drift',
  'auto_update',
];
```

**Analog 2 — rowRefs (verified live, lines 122–132):**

```tsx
const rowRefs = useMemo(() => {
    const map: Record<SignalClass, React.RefObject<HTMLButtonElement>> = {
      eval_scores: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      capability_gaps: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      tentacle_health: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      config_drift: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
      auto_update: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
    };
    return map;
  }, []);
```

**Phase 23 change — 3 sites in DoctorPane.tsx (mirror existing rows):**

1. `DISPLAY_NAME` (line 45 — append after `auto_update`):
```tsx
  auto_update: 'Auto-Update',
  reward_trend: 'Reward Trend',
};
```

2. `ROW_ORDER` (line 54 — append after `auto_update`):
```tsx
  'auto_update',
  'reward_trend',
];
```

3. `rowRefs` map (line 129 — append after `auto_update`):
```tsx
  auto_update: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
  reward_trend: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
};
```

**No structural change.** The existing render pipeline at `DoctorPane.tsx:238–246` iterates `orderedSignals.map(sig => <DoctorRow key={sig.class} ... />)` and the existing Dialog drawer at line 250 picks up the new row through the `payload` JSON renderer automatically. ~3-line change × 3 sites = ~9 net additions (RESEARCH cites ~30 LOC because of formatting; effective additions are ~9 lines).

**Gotchas:**
- **CLAUDE.md "Verification Protocol":** this is a UI substrate change. Per CONTEXT.md "DoctorPane.tsx change" — runtime UAT for the row's static render is **deferred per chat-first pivot UI-deferral pattern** (D-23-04). Static render acceptable; no screenshot evidence required at land time. **EXCEPTION** to the v1.1 lesson because it doesn't touch the chat surface — runtime regression risk is bounded to the Doctor pane.
- **UI-SPEC § 7.5 "most-volatile-first":** RewardTrend is correctly placed LAST (lowest-volatile — composite reward changes slowly relative to per-eval breaches). Locked by RESEARCH §"DoctorPane.tsx New Row".
- **Pitfall 5 (DoctorPane.tsx):** existing row pattern uses one `useRef` per `SignalClass` key. Forgetting `reward_trend` in `rowRefs` causes a runtime undefined deref at line 244 (`rowRef={rowRefs[sig.class]}` returns undefined → Dialog `triggerRef={undefined}` blank-fields the focus restore).

---

### MOD: `scripts/verify-eval.sh` — single-token bump `EXPECTED=5 → 8`

**Analog (verified live, line 41 of the same file):**

```bash
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c '┌──' || true)
EXPECTED=5  # hybrid_search + real_embedding + kg_integrity + typed_memory + capability_gap

if [ "$TABLE_COUNT" -lt "$EXPECTED" ]; then
  echo "$STDOUT"
  echo "[verify-eval] FAIL: only $TABLE_COUNT scored tables emitted, expected $EXPECTED (EVAL-06)"
  echo "  An eval module forgot to call harness::print_eval_table, or --nocapture was stripped."
  exit 2
fi
```

**Phase 23 change — single line:**

```bash
EXPECTED=8  # +adversarial +ambiguous_intent +capability_gap_stress (Phase 23 / REWARD-05)
```

**Gotchas:**
- **Wave 3 ordering (RESEARCH §"Harness Integration"):** EXPECTED=8 bump is the LAST task before phase close. Bumping early (Wave 2 mid-stream) fails the gate because not all 3 OOD modules wired yet. Plan order: `mod adversarial_eval; mod ambiguous_intent_eval; mod capability_gap_stress_eval;` lands first, OOD modules' `print_eval_table` calls lands second, EXPECTED bump LAST.
- **Comment-update required:** the existing `# hybrid_search + real_embedding + kg_integrity + typed_memory + capability_gap` comment must be extended; otherwise CI logs say `expected 8` but operator-facing comment says 5 modules. Future grep-bait.

---

### NEW: `tests/evals/reward_history.jsonl` placeholder + `.gitignore` update

**Analog 1 (verified live):** `tests/evals/.gitkeep` (empty file, committed) + `tests/evals/history.jsonl` (gitignored, runtime-generated)
**Analog 2 (verified live, .gitignore line 50):**

```
# Eval history — appended by `cargo test --lib evals -- --nocapture`. Each
# row is a Phase 17 / DOCTOR-02 EvalRunRecord. Useful locally; production
# not committed. The directory is tracked via tests/evals/.gitkeep.
tests/evals/history.jsonl
```

**Phase 23 change to `.gitignore` (after line 50):**
```
tests/evals/reward_history.jsonl
```

**Phase 23 file creation:**
- `tests/evals/reward_history.jsonl` is NOT committed (gitignored). At first run, `record_reward()` creates it via `OpenOptions::create(true)` (matches `record_eval_run` analog).
- The existing `tests/evals/.gitkeep` already protects the parent directory from `git rm` when both jsonl files are absent. No second `.gitkeep` needed.

**Gotchas:**
- **First-run behavior:** doctor's `read_reward_history` returns `Vec::new()` on missing file (D-16 convention) → `compute_reward_signal` returns Severity::Green with `history_count: 0` payload. No panics, no setup ceremony.
- **Test seam:** `BLADE_REWARD_HISTORY_PATH` env override (Pitfall 4) is mandatory for hermetic tests. Tests that exercise `compute_reward_signal` redirect via `tempfile::NamedTempFile` then `std::env::set_var("BLADE_REWARD_HISTORY_PATH", ...)`. Threading: `--test-threads=1` already pinned by `verify-eval.sh`.

---

## Cross-Cutting Patterns

### 6-place config rule (CLAUDE.md — verbatim)

> "New config field → add to ALL 6 places: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`"

**Concrete locations the planner must hit when adding `reward_weights`** (verified live in config.rs, mirroring `voyager_skill_write_budget_tokens`):

| # | Site | Verified live line |
|---|------|--------------------|
| 1 | `default_voyager_skill_write_budget_tokens()` helper → mirror as `default_reward_weights()` | 180 |
| 2 | `DiskConfig.voyager_skill_write_budget_tokens` field → mirror as `DiskConfig.reward_weights` | 299–300 |
| 3 | `DiskConfig::default()` line | 379 |
| 4 | `BladeConfig.voyager_skill_write_budget_tokens` field → mirror as `BladeConfig.reward_weights` | 515–516 |
| 5 | `BladeConfig::default()` line | 581 |
| 6 | `load_config` mapping line | 740 |
| 7 | `save_config` mapping line | 801 |

**Validation rule:** `grep -c "reward_weights\|RewardWeights\|default_reward_weights" src-tauri/src/config.rs` ≥ 9 after Phase 23 lands (matches the 9 hits voyager_skill_write_budget_tokens has today).

---

### EVAL-06 byte-sequence contract (Pitfall 2)

**Source of truth:** `src-tauri/src/evals/harness.rs:136`

```rust
println!("\n┌── {} ──", title);
```

**Byte sequence:** `0xE2 0x94 0x8C` (U+250C BOX DRAWINGS LIGHT DOWN AND RIGHT) + `0xE2 0x94 0x80` × 2 (U+2500 BOX DRAWINGS LIGHT HORIZONTAL).

**Grep target in `verify-eval.sh:38`:**
```bash
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c '┌──' || true)
```

**Phase 23 contract:** every NEW eval module (`adversarial_eval.rs`, `ambiguous_intent_eval.rs`, `capability_gap_stress_eval.rs`) calls `super::harness::print_eval_table("<module title> eval", &rows);` exactly once per `#[test] fn evaluates_*()`. **NEVER inline** `println!("┌── ...")` — Unicode-confusable risk (CLAUDE.md non-ASCII rule).

---

### M-07 ActivityStrip emission (CLAUDE.md / Phase 17 D-21)

**Pattern:** every cross-module action emits via `app.emit_to("main", "blade_activity_log", ...)` with `module + action + human_summary + timestamp` keys.

**Analogs:**
- `src-tauri/src/voyager_log.rs:39–64` (Phase 22 — uses `integration_bridge::get_app_handle()` for AppHandle-less call sites)
- `src-tauri/src/doctor.rs:730–757::emit_activity_for_doctor` (Phase 17 — passes AppHandle explicitly because doctor_run_full_check is a `#[tauri::command]`)

**Phase 23 emit sites** (RESEARCH §"Hook Point §Data the Call Needs"):
1. `reward:penalty_applied` — fires inside `compute_and_persist_turn_reward` whenever any of the 3 penalty paths trips
2. `reward:ood_gate_zero` — fires when REWARD-06 OOD-floor gate zeros the turn

**Both emits use the voyager_log shape** (no AppHandle parameter — fetched via `integration_bridge::get_app_handle()`). Per-turn reward jsonl write does NOT emit (parallel to `record_eval_run` which doesn't either; jsonl is silent persistence, ActivityStrip is observational delta).

---

### Cargo `mod` registration order (CLAUDE.md)

**`src-tauri/src/lib.rs`** — append `mod reward;` immediately after `mod voyager_log;` (line 30) inside the FIRST mod block (lines 1–40, the v1.3-substrate-phases block):

```rust
pub mod skills;         // Phase 21 v1.3
mod voyager_log;        // Phase 22 v1.3
mod reward;             // Phase 23 v1.3 — composite reward + per-turn persistence (← INSERT)
mod telegram;
```

**`src-tauri/src/evals/mod.rs`** — append the 3 new modules immediately after `capability_gap_eval` (line 15):

```rust
#[cfg(test)] mod capability_gap_eval;
#[cfg(test)] mod adversarial_eval;            // Phase 23 / REWARD-05
#[cfg(test)] mod ambiguous_intent_eval;       // Phase 23 / REWARD-05
#[cfg(test)] mod capability_gap_stress_eval;  // Phase 23 / REWARD-05
```

---

### `generate_handler!` entries — confirmed NONE

Per RESEARCH §"Hook Point §Data the Call Needs" + spawn-prompt confirmation: `reward.rs` exposes only `pub async fn compute_and_persist_turn_reward` (called directly from `commands.rs` Rust-to-Rust) and pure helpers (`compose`, `record_reward`, `read_reward_history`, etc). **No `#[tauri::command]` annotations.**

`generate_handler!` block at `lib.rs:603` does NOT need a `reward::*` entry. Verified by inspection of voyager_log.rs (Phase 22 precedent — same posture; emits to ActivityStrip, no Tauri commands; absent from generate_handler).

**Doctor's `compute_reward_signal()` is also not a `#[tauri::command]`** — it's invoked from inside the existing `doctor_run_full_check` `#[tauri::command]` (which IS already in `generate_handler!`). The 6th `tokio::join!` arm is the only wiring needed.

---

## Metadata

**Analog search scope:**
- `/home/arnav/blade/src-tauri/src/` (Rust modules)
- `/home/arnav/blade/src-tauri/src/evals/` (5 existing eval modules + harness)
- `/home/arnav/blade/src/features/admin/` (DoctorPane.tsx + types)
- `/home/arnav/blade/src/lib/events/` (payloads.ts) + `/home/arnav/blade/src/lib/tauri/` (admin.ts)
- `/home/arnav/blade/scripts/verify-eval.sh`
- `/home/arnav/blade/.gitignore` + `/home/arnav/blade/tests/evals/`

**Files scanned:** 11 (config.rs, doctor.rs, commands.rs, voyager_log.rs, evals/harness.rs, evals/capability_gap_eval.rs, evals/typed_memory_eval.rs, evals/mod.rs, lib.rs, DoctorPane.tsx, payloads.ts + admin.ts + verify-eval.sh + .gitignore).

**Line-number drift from RESEARCH:**
- RESEARCH cites config.rs sites at 175,184,300,325,387,517,654,740,801. Verified live: 180,184,299–300,379,515–516,581,740,801. **Minor drift (≤5 lines) on 4 of 9 sites** — likely commit-tip drift since RESEARCH was written. Sites are still uniquely identifiable by surrounding context (`fn default_voyager_skill_write_budget_tokens`, `voyager_skill_write_budget_tokens: u64`, etc).
- RESEARCH cites doctor.rs `compute_eval_signal` at line 207 — verified live exact match (line 207 = `fn compute_eval_signal()`).
- RESEARCH cites doctor.rs orchestrator at line 771 — verified exact match.
- RESEARCH cites doctor.rs:1198 `suggested_fix_strings_match_ui_spec_verbatim` — verified exact match.
- RESEARCH cites commands.rs:1621 `chat_done` emit + 1821 `return Ok(())` — verified exact match.
- RESEARCH cites commands.rs:1846 dispatch loop + 2156 `conversation.push(ConversationMessage::Tool)` — verified exact match.
- RESEARCH cites payloads.ts:760 — actual line 759 (off-by-one; not load-bearing).
- RESEARCH cites DoctorPane.tsx:40/49/124 — verified exact at 40 (DISPLAY_NAME), 49 (ROW_ORDER), 122–132 (rowRefs).

All analogs verified present and load-bearing.

---

## PATTERN MAPPING COMPLETE
