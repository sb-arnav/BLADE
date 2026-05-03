# Phase 28: Active Inference Loop - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 7 new/modified files
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src-tauri/src/active_inference.rs` | service | batch + event-driven | `src-tauri/src/homeostasis.rs` | role-match |
| `src-tauri/src/homeostasis.rs` | service (extend) | event-driven | `src-tauri/src/homeostasis.rs` (self) | exact |
| `src-tauri/src/hive.rs` | service (extend hook) | event-driven | `src-tauri/src/hive.rs` (self) | exact |
| `src-tauri/src/dream_mode.rs` | service (extend) | batch | `src-tauri/src/dream_mode.rs` (self) | exact |
| `src-tauri/src/doctor.rs` | service (extend) | request-response | `src-tauri/src/doctor.rs` (self) | exact |
| `src-tauri/src/db.rs` | config (extend) | CRUD | `src-tauri/src/db.rs` (self) | exact |
| `src-tauri/src/evals/active_inference_eval.rs` | test | batch | `src-tauri/src/evals/hormone_eval.rs` | exact |
| `scripts/verify-inference.sh` | utility | — | `scripts/verify-hormone.sh` | exact |

---

## Pattern Assignments

### `src-tauri/src/active_inference.rs` (service, batch + event-driven)

**Primary analog:** `src-tauri/src/homeostasis.rs`

**Imports pattern** — copy from homeostasis.rs lines 19-21:
```rust
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
// also needed:
use std::collections::HashMap;
use tauri::Emitter;
```

**OnceLock global state pattern** — copy from homeostasis.rs lines 200-210:
```rust
static PHYSIOLOGY: OnceLock<Mutex<PhysiologicalState>> = OnceLock::new();

fn physiology_store() -> &'static Mutex<PhysiologicalState> {
    PHYSIOLOGY.get_or_init(|| Mutex::new(load_physiology_from_db().unwrap_or_default()))
}

pub fn get_physiology() -> PhysiologicalState {
    physiology_store().lock().map(|p| p.clone()).unwrap_or_default()
}
```
Adapt: replace `PhysiologicalState` with `HashMap<String, TentaclePrediction>`, replace `PHYSIOLOGY` with `PREDICTIONS`, `physiology_store` with `predictions_store`, `load_physiology_from_db` with `load_predictions_from_db`.

**AtomicI64 tick-counter pattern** — copy from homeostasis.rs lines 636-656 (ADRENALINE_SPIKE_AT):
```rust
static ADRENALINE_SPIKE_AT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
// increment/reset/load with Ordering::SeqCst
```
Adapt for `SUSTAINED_HIGH_TICKS: AtomicU32` — increment when aggregate_error > 0.6, reset when below. The sustained-error detection for D-07 requires this counter; passing only the current-tick aggregate to `update_physiology_from_prediction_errors()` is insufficient.

**EMA smoothing pattern** — copy from homeostasis.rs lines 377-404 (update_physiology_from_classifier):
```rust
pub fn update_physiology_from_classifier(output: &ClassifierOutput) {
    const ALPHA: f32 = 0.05;
    // ...
    let smooth = |current: f32, delta: f32| -> f32 {
        let target = if delta >= 0.0 { delta } else { 0.0 };
        let raw = current * (1.0 - ALPHA) + target * ALPHA;
        raw.clamp(0.01, 1.0)
    };
    // ...
    state.last_updated = chrono::Utc::now().timestamp();
}
```
Adapt: per-tentacle-type alpha (calendar=0.1, slack=0.08, github=0.05). Pattern is `expected = expected * (1 - alpha) + observed * alpha`.

**SQLite load/persist pattern** — copy from homeostasis.rs lines 1027-1049:
```rust
fn load_physiology_from_db() -> Option<PhysiologicalState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'physiology'",
        [],
        |row| row.get(0),
    ).ok()?;
    serde_json::from_str(&json).ok()
}

fn persist_physiology_to_db(state: &PhysiologicalState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('physiology', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}
```
Adapt for `tentacle_predictions` table: use `INSERT ... ON CONFLICT(platform) DO UPDATE ...` instead of settings k-v. For `prediction_error_log`: prune BEFORE insert (DELETE WHERE rowid NOT IN (SELECT rowid ORDER BY timestamp DESC LIMIT 999)), then INSERT.

**ActivityStrip threshold-crossing emit pattern** — copy from homeostasis.rs lines 1051-1061:
```rust
fn emit_hormone_threshold(app: &tauri::AppHandle, hormone: &str, value: f32, direction: &str, reason: &str) {
    let summary = format!("{} {} {:.2} -- {}", hormone, direction, value, reason);
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "homeostasis.physiology",
        "action":        "threshold_crossing",
        "human_summary": crate::safe_slice(&summary, 200),
        "payload_id":    serde_json::Value::Null,
        "timestamp":     chrono::Utc::now().timestamp(),
    }));
}
```
Adapt: module = `"active_inference"`, action = `"prediction_error_threshold"`. Use `crate::safe_slice(...)` — never raw string slicing.

**TentacleReport struct** — already exists in hive.rs lines 76-116. The `details: serde_json::Value` field is what active_inference extraction functions parse. Slack reports carry `"mentions"` key; GitHub carries `"count"` + `"open_prs"`.

---

### `src-tauri/src/homeostasis.rs` — extend: add `update_physiology_from_prediction_errors()`

**Analog:** Existing `update_physiology_from_classifier()` at lines 377-404 — identical signature shape.

**Function to add** (after line 404, before `apply_physiology_decay`):
```rust
/// Apply prediction error aggregate to PhysiologicalState — second input channel.
/// Additive with update_physiology_from_classifier (per D-06). Same α=0.05 smoothing.
/// sustained_high_ticks: how many consecutive ticks had aggregate_error > 0.6.
pub fn update_physiology_from_prediction_errors(
    aggregate_error: f32,
    sustained_high_ticks: u32,
    is_single_spike: bool,
) {
    const ALPHA: f32 = 0.05;
    if let Ok(mut state) = physiology_store().lock() {
        let smooth = |current: f32, target: f32| -> f32 {
            (current * (1.0 - ALPHA) + target * ALPHA).clamp(0.01, 1.0)
        };

        if sustained_high_ticks >= 2 && aggregate_error > 0.6 {
            // Sustained high error → cortisol↑ + norepinephrine↑ (D-07)
            state.cortisol       = smooth(state.cortisol,       aggregate_error);
            state.norepinephrine = smooth(state.norepinephrine, aggregate_error * 0.8);
        } else if aggregate_error < 0.2 && sustained_high_ticks == 0 {
            // Sustained low error → serotonin↑ (D-07)
            state.serotonin = smooth(state.serotonin, 0.7);
        }

        if is_single_spike {
            // Novel single-tentacle spike → norepinephrine↑ specifically (D-07)
            state.norepinephrine = smooth(state.norepinephrine, 0.9);
        }

        state.last_updated = chrono::Utc::now().timestamp();
    }
}
```

---

### `src-tauri/src/hive.rs` — extend: hook after people enrichment block

**Insertion point:** after line 2464 (end of people enrichment `for` loop), before line 2466 (CI auto-fix pipeline).

**Hook pattern** — modeled on the existing conditional-block style in hive_tick:
```rust
// ── Active inference: compute prediction errors from this tick's reports ──
if !all_reports.is_empty() {
    crate::active_inference::compute_prediction_errors(app, &all_reports).await;
}
```
This matches the existing early-return guard at line 2323 (`if active_tentacles.is_empty() { return; }`). The `compute_prediction_errors` call is async because it does SQLite writes — use `.await` here, not `tokio::spawn`, to keep ordering deterministic (errors computed before emit/log calls that follow).

---

### `src-tauri/src/dream_mode.rs` — extend: add `task_prediction_replay()` at position 5

**run_task! macro pattern** — copy from lines 576-602:
```rust
macro_rules! run_task {
    ($name:expr, $fut:expr) => {{
        let task_name = $name;
        let _ = app.emit_to("main", "dream_task_start", serde_json::json!({ "task": task_name }));
        let result: String =
            match tokio::time::timeout(tokio::time::Duration::from_secs(120), $fut).await {
                Ok(insight) => insight,
                Err(_) => format!("{} timed out", task_name),
            };
        let _ = app.emit_to("main", "dream_task_complete",
            serde_json::json!({ "task": task_name, "insight": result }),
        );
        tasks_completed.push(task_name.to_string());
        insights.push(result);

        if !DREAMING.load(Ordering::Relaxed) {
            return DreamSession { /* interrupted */ };
        }
    }};
}
```

**DREAMING checkpoint pattern** — copy from task_skill_prune (lines 266-292):
```rust
async fn task_skill_prune(_app: tauri::AppHandle) -> String {
    // ...
    if !DREAMING.load(Ordering::Relaxed) {
        break;
    }
    // ...
}
```
Apply inside `task_prediction_replay()` when iterating over high-error records.

**task_memory_consolidation SQLite pattern** — copy from lines 112-119:
```rust
let db_path = crate::config::blade_config_dir().join("blade.db");
if let Ok(conn) = rusqlite::Connection::open(&db_path) {
    let cutoff = chrono::Utc::now().timestamp() - (90 * 86400);
    let pruned = conn.execute(
        "DELETE FROM typed_memories WHERE created_at < ?1 AND ...",
        rusqlite::params![cutoff],
    ).unwrap_or(0);
}
```
Adapt: query `prediction_error_log WHERE aggregate_error > 0.5 ORDER BY aggregate_error DESC LIMIT 10`. Then re-consolidate via `crate::typed_memory::store_typed_memory(...)` for each.

**Insertion in run_dream_session** — after `skill_synthesis` (line 615), before `skill_prune` (line 619):
```rust
// Task 4 — Skill synthesis
run_task!("skill_synthesis", task_skill_synthesis(app.clone()));

// [NEW] Task 5 — Prediction replay (hippocampal analog — high-error events → memory)
run_task!("prediction_replay", task_prediction_replay());

// Phase 24 — Voyager forgetting half
run_task!("skill_prune",       task_skill_prune(app.clone()));
```
The `task_prediction_replay()` function signature is `async fn task_prediction_replay() -> String` (no app handle needed — SQLite only, no app.emit inside the task itself; emit is handled by the run_task! macro).

---

### `src-tauri/src/doctor.rs` — extend: SignalClass::ActiveInference

**SignalClass enum addition** — copy from lines 34-43:
```rust
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
    RewardTrend,
    Metacognitive,
    Hormones,
    ActiveInference,   // Phase 28 / AINF-06 — add here
}
```

**suggested_fix arms** — copy the Hormones block at lines 153-158 as template. Add after the Hormones arm:
```rust
// Active Inference -- Phase 28 AINF-06
(SignalClass::ActiveInference, Severity::Green) =>
    "Prediction errors are low across all tentacles. BLADE's world-model is well-calibrated.",
(SignalClass::ActiveInference, Severity::Amber) =>
    "Aggregate prediction error elevated (>0.4). One or more tentacles showing unexpected activity. Check the payload for top_tentacle.",
(SignalClass::ActiveInference, Severity::Red) =>
    "Sustained high prediction error (>0.6, 2+ ticks). Cortisol and norepinephrine are rising. Review the active tentacles and allow idle time for EMA recalibration.",
```
CRITICAL: also update the `suggested_fix_table_is_exhaustive` test at lines 1146-1164 — add `SignalClass::ActiveInference` to the class array and update the comment from `8×3 = 24` to `9×3 = 27`.

**compute_hormones_signal pattern** — copy lines 989-1014 as the template for `compute_active_inference_signal()`:
```rust
fn compute_hormones_signal() -> Result<DoctorSignal, String> {
    let p = crate::homeostasis::get_physiology();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let severity = if p.cortisol > 0.7 && p.norepinephrine > 0.7 {
        Severity::Red
    } else if p.cortisol > 0.6 || p.norepinephrine > 0.6 || p.mortality_salience > 0.6 {
        Severity::Amber
    } else {
        Severity::Green
    };
    Ok(DoctorSignal {
        class: SignalClass::Hormones,
        severity,
        payload: serde_json::json!({ /* fields */ }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::Hormones, severity).to_string(),
    })
}
```
Adapt: call `crate::active_inference::get_active_inference_state()`, use `state.aggregate_error` for severity thresholds (>0.7 = Red, >0.4 = Amber), payload = `{aggregate_error, top_tentacle, tracked_count, demo_loop_active}`.

**tokio::join! addition** — copy lines 1032-1041 and add the ninth arm:
```rust
let (eval, capgap, tentacle, drift, autoupdate, reward_trend, metacognitive, hormones, active_inference) = tokio::join!(
    async { compute_eval_signal() },
    // ... existing 7 ...
    async { compute_hormones_signal() },
    async { compute_active_inference_signal() },  // NEW
);
```
Then add to the signals Vec and the suggested_fix test class list.

---

### `src-tauri/src/db.rs` — extend: two new tables in run_migrations()

**execute_batch pattern** — copy from lines 185-261. Tables are added inside the single `conn.execute_batch("...")` call. Rules: NO double quotes inside SQL strings (use single quotes); `CREATE TABLE IF NOT EXISTS` is idempotent.

**New tables to append** (inside the execute_batch string, after the last existing table):
```sql
-- Active inference: per-tentacle prediction state (Phase 28 / AINF-01)
CREATE TABLE IF NOT EXISTS tentacle_predictions (
    platform   TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Active inference: historical prediction error log, capped at 1000 rows (Phase 28 / AINF-05)
CREATE TABLE IF NOT EXISTS prediction_error_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL,
    aggregate_error REAL NOT NULL,
    top_signal      TEXT NOT NULL DEFAULT '',
    timestamp       INTEGER NOT NULL
);
```
Note: FIFO pruning (DELETE WHERE rowid NOT IN (SELECT rowid FROM prediction_error_log ORDER BY timestamp DESC LIMIT 999)) must run BEFORE each INSERT into prediction_error_log, not after.

---

### `src-tauri/src/evals/active_inference_eval.rs` (test, batch)

**Primary analog:** `src-tauri/src/evals/hormone_eval.rs` — exact structural match.

**Module header and imports** — copy from hormone_eval.rs lines 1-23:
```rust
//! Phase 28 / AINF-01..06 -- Deterministic active inference eval.
//!
//! MODULE_FLOOR = 0.95
//! No LLM involvement. No SQLite (except AINF-05 which uses in-memory fixture).
//!
//! Run: `cargo test --lib evals::active_inference_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, summarize, EvalRow};

const MODULE_NAME: &str = "active_inference";
const MODULE_FLOOR: f32 = 0.95;
```

**Fixture struct + helper** — copy from hormone_eval.rs lines 28-47:
```rust
struct AinfFixture {
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
```

**Test entry point** — copy from hormone_eval.rs lines 473-510:
```rust
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
```

**Six fixture functions (AINF-01 through AINF-06):**
- `fixture_ainf01`: verify `TentaclePrediction::default("slack")` has expected signals + confidence=0.1
- `fixture_ainf02`: verify `normalize_error(3.0, 8.0, 10.0)` returns 0.5 (|3-8|/10); verify clamped to [0.0, 1.0]
- `fixture_ainf03`: call `update_physiology_from_prediction_errors(0.75, 3, false)` × 2, assert `get_physiology().cortisol > 0.3`
- `fixture_ainf04`: build synthetic TentacleReport for slack (mentions=15) + iterate 3 prediction-error passes, assert cortisol > 0.3 (the DEMO LOOP test — use `process_reports_for_test()` public test-only fn)
- `fixture_ainf05`: insert fake rows into prediction_error_log (in-memory SQLite), call `task_prediction_replay()`, assert returned count > 0
- `fixture_ainf06`: run 5 EMA update cycles with observed=8.0 against expected=3.0, assert expected converges toward 8.0 (error decreases)

Note: `--test-threads=1` is MANDATORY (fixtures share global PHYSIOLOGY state, same as hormone_eval).

---

### `scripts/verify-inference.sh` (utility)

**Primary analog:** `scripts/verify-hormone.sh` — copy verbatim, change 3 strings:
1. `verify-hormone` → `verify-inference` (script name in comments + echo)
2. `HORM-01..09` → `AINF-01..06`
3. `evals::hormone_eval` → `evals::active_inference_eval`
4. Gate number: `Gate 35` → `Gate 36`
5. `hormone physiology eval` → `active inference eval`

Full pattern from verify-hormone.sh lines 1-41:
```bash
#!/usr/bin/env bash
# scripts/verify-inference.sh -- Phase 28 / AINF-01..06 invariant.
# Gate 36: all active inference eval scenarios must pass (MODULE_FLOOR = 0.95).

set -uo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-inference] ERROR: cargo not on PATH" >&2
  exit 3
fi

STDOUT=$(cd src-tauri && cargo test --lib evals::active_inference_eval --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-inference] FAIL: active inference eval exited $RC"
  exit 1
fi

TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)

if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "$STDOUT"
  echo "[verify-inference] FAIL: no scored table emitted"
  exit 2
fi

echo "$STDOUT" | grep -E '^\xe2\x94' || true
echo "[verify-inference] OK -- all active inference scenarios passed"
exit 0
```

---

## Shared Patterns

### OnceLock Global State
**Source:** `src-tauri/src/homeostasis.rs` lines 200-210
**Apply to:** `active_inference.rs` PREDICTIONS global map
```rust
static STATE: OnceLock<Mutex<T>> = OnceLock::new();
fn store() -> &'static Mutex<T> {
    STATE.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}
pub fn get_state() -> T { store().lock().map(|s| s.clone()).unwrap_or_default() }
```

### SQLite Open Pattern
**Source:** `src-tauri/src/homeostasis.rs` lines 1028-1049
**Apply to:** All new SQLite reads/writes in `active_inference.rs` and `dream_mode.rs`
```rust
let db_path = crate::config::blade_config_dir().join("blade.db");
if let Ok(conn) = rusqlite::Connection::open(&db_path) { /* ... */ }
```

### ActivityStrip Emission
**Source:** `src-tauri/src/homeostasis.rs` lines 1051-1061
**Apply to:** `active_inference.rs` threshold-crossing events
- Module field: `"active_inference"`
- Action field: `"prediction_error_threshold"`
- Always use `crate::safe_slice(&summary, 200)` for human_summary

### EMA Smoothing
**Source:** `src-tauri/src/homeostasis.rs` lines 382-387 (the `smooth` closure)
**Apply to:** `active_inference.rs` expected-state updates and `homeostasis.rs` new function
```rust
let smooth = |current: f32, target: f32| -> f32 {
    (current * (1.0 - alpha) + target * alpha).clamp(0.01, 1.0)
};
```

### DREAMING Checkpoint
**Source:** `src-tauri/src/dream_mode.rs` lines 277-280
**Apply to:** `task_prediction_replay()` inner loop
```rust
if !DREAMING.load(Ordering::Relaxed) { break; }
```

### AtomicI64/AtomicU32 Spike Tracker
**Source:** `src-tauri/src/homeostasis.rs` lines 636-656 (ADRENALINE_SPIKE_AT)
**Apply to:** `active_inference.rs` sustained-high-tick counter
Pattern: static atomic, store on condition, load and compare in update function.

---

## Critical Pitfalls (from RESEARCH.md — enforce in all plans)

| Pitfall | Impact | Guard |
|---------|--------|-------|
| Calendar tentacle does not exist in hive.rs | Demo loop breaks if plan adds `poll_tentacle("calendar")` arm | Read calendar from `integration_bridge::get_integration_state().upcoming_events` instead |
| Sustained-error needs tick counter | `update_physiology_from_prediction_errors(aggregate_error)` alone can't implement D-07 | Pass `sustained_high_ticks: u32` parameter; use `SUSTAINED_HIGH_TICKS: AtomicU32` static |
| `suggested_fix_table_is_exhaustive` test fails | Adding `SignalClass::ActiveInference` without 3 fix strings breaks the test | Add all 3 arms and update the test array + comment (8→9 classes, 24→27 total) |
| dream task order | prediction_replay after skill_from_trace can't inform skill generation | Insert BEFORE skill_prune (position 5 in the 10-task sequence) |
| FIFO pruning: prune after insert | Rapid ticks could exceed 1000-row cap | Prune BEFORE insert in prediction_error_log writes |
| No `start_active_inference()` call needed | OnceLock is self-initializing on first access via hive_tick | Do NOT add a startup call to lib.rs |
| Double quotes in execute_batch SQL | Macro breaks silently | Use only single quotes inside SQL strings in db.rs `execute_batch!` |

---

## Module Registration (lib.rs)

**Source:** `src-tauri/src/lib.rs` lines showing existing registrations.

Add to lib.rs (copy pattern from existing `mod homeostasis;` at line 70):
```rust
mod active_inference;   // Phase 28 / AINF-01..06
```

Add to `evals/mod.rs` (copy from line 20 pattern):
```rust
#[cfg(test)] mod active_inference_eval;   // Phase 28 / AINF-01..06
```

Add to `package.json` verify:all chain (append after `verify:hormone`):
```json
"verify:inference": "bash scripts/verify-inference.sh"
```
And append `&& npm run verify:inference` to the end of the `verify:all` command.

No Tauri commands needed for Phase 28 (DoctorPane coverage through `doctor_run_full_check` is sufficient per RESEARCH.md open question 3). If any command is added later, verify no naming collision in the flat `generate_handler![]` namespace.

---

## No Analog Found

All files have strong analogs. No gaps requiring fallback to RESEARCH.md reference patterns only.

---

## Metadata

**Analog search scope:** `src-tauri/src/` (homeostasis.rs, hive.rs, dream_mode.rs, doctor.rs, db.rs), `src-tauri/src/evals/` (hormone_eval.rs, harness.rs), `scripts/` (verify-hormone.sh)
**Files scanned:** 8 primary analog files read in full or targeted sections
**Pattern extraction date:** 2026-05-02
