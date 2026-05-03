# Phase 29: Vitality Engine — Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 15 new/modified files
**Analogs found:** 15 / 15

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src-tauri/src/vitality_engine.rs` | service/module | event-driven, CRUD | `src-tauri/src/homeostasis.rs` | exact |
| `src-tauri/src/evals/vitality_eval.rs` | test | batch | `src-tauri/src/evals/active_inference_eval.rs` | exact |
| `src-tauri/src/homeostasis.rs` | service | event-driven | self (existing) | self-modify |
| `src-tauri/src/safety_bundle.rs` | middleware | request-response | self (existing) | self-modify |
| `src-tauri/src/brain.rs` | service | request-response | self (existing) | self-modify |
| `src-tauri/src/persona_engine.rs` | service | request-response | self (existing) | self-modify |
| `src-tauri/src/evolution.rs` | service | event-driven | self (existing) | self-modify |
| `src-tauri/src/dream_mode.rs` | service | event-driven | self (existing) | self-modify |
| `src-tauri/src/metacognition.rs` | service | request-response | self (existing) | self-modify |
| `src-tauri/src/doctor.rs` | service | request-response | self (existing) | self-modify |
| `src-tauri/src/db.rs` | config/migration | CRUD | `src-tauri/src/active_inference.rs` | role-match |
| `src-tauri/src/lib.rs` | config | request-response | self (existing) | self-modify |
| `scripts/verify-vitality.sh` | utility | batch | `scripts/verify-inference.sh` | exact |
| `src/features/chat/VitalityIndicator.tsx` | component | event-driven | (no existing analog — see No Analog section) | none |
| `src/features/admin/DoctorPane.tsx` | component | event-driven | self (existing) | self-modify |
| `src/lib/tauri/admin.ts` | utility | request-response | self (existing) | self-modify |
| `src/lib/events/payloads.ts` | utility | event-driven | self (existing) | self-modify |

---

## Pattern Assignments

### `src-tauri/src/vitality_engine.rs` (service/module, event-driven + CRUD)

**Analog:** `src-tauri/src/homeostasis.rs`

**Imports pattern** (homeostasis.rs lines 19–22):
```rust
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
```
Plus for vitality: `use std::collections::VecDeque;` and `use tauri::{AppHandle, Emitter};`

**Global singleton pattern** (homeostasis.rs lines 101–113):
```rust
static HORMONES: OnceLock<Mutex<HormoneState>> = OnceLock::new();
static HYPOTHALAMUS_RUNNING: AtomicBool = AtomicBool::new(false);

fn hormone_store() -> &'static Mutex<HormoneState> {
    HORMONES.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}

pub fn get_hormones() -> HormoneState {
    hormone_store().lock().map(|h| h.clone()).unwrap_or_default()
}
```
Copy this exactly for vitality:
```rust
static VITALITY: OnceLock<Mutex<VitalityState>> = OnceLock::new();
pub static DORMANCY_STUB: AtomicBool = AtomicBool::new(false);

fn vitality_store() -> &'static Mutex<VitalityState> {
    VITALITY.get_or_init(|| Mutex::new(load_vitality_from_db().unwrap_or_default()))
}

pub fn get_vitality() -> VitalityState {
    vitality_store().lock().map(|v| v.clone()).unwrap_or_default()
}
```

**RUNNING guard pattern** (homeostasis.rs line 102, 773):
```rust
static HYPOTHALAMUS_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn start_hypothalamus(app: tauri::AppHandle) {
    if HYPOTHALAMUS_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            // ...
        }
    });
}
```
Vitality does NOT start its own loop. `start_vitality_engine(app)` stores the AppHandle in a static `OnceLock<AppHandle>` and returns. The tick is driven by `hypothalamus_tick()`.

**SQLite load/persist pattern** (homeostasis.rs lines 1051–1087):
```rust
fn persist_to_db(state: &HormoneState) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        if let Ok(json) = serde_json::to_string(state) {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('homeostasis', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![json],
            );
        }
    }
}

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
```
Vitality uses a dedicated `vitality_state` table (not the settings key-value store) because it also needs the `vitality_history` time-series table. Use the same `blade_config_dir().join("blade.db")` path pattern.

**VecDeque ring buffer pattern** (decision_gate.rs lines 72–89):
```rust
const RING_MAX: usize = 100;

static DECISION_LOG: OnceLock<Mutex<std::collections::VecDeque<DecisionRecord>>> = OnceLock::new();

fn decision_log() -> &'static Mutex<std::collections::VecDeque<DecisionRecord>> {
    DECISION_LOG.get_or_init(|| Mutex::new(std::collections::VecDeque::new()))
}

fn push_decision(record: DecisionRecord) {
    if let Ok(mut log) = decision_log().lock() {
        if log.len() >= RING_MAX {
            log.pop_front();
        }
        log.push_back(record);
    }
}
```
Use this for the in-memory `history: VecDeque<VitalitySnapshot>` in VitalityState, capped at 100.

**ActivityStrip emit pattern** (active_inference.rs lines 431–445):
```rust
if aggregate_error > 0.5 {
    let summary = format!(
        "prediction_error {:.2} top={} sustained={}",
        aggregate_error, top_tentacle, sustained_ticks
    );
    let _ = app.emit_to(
        "main",
        "blade_activity_log",
        serde_json::json!({
            "module":        "active_inference",
            "action":        "prediction_error_threshold",
            "human_summary": crate::safe_slice(&summary, 200),
            "payload_id":    serde_json::Value::Null,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    );
}
```
Use this for band transition events. Replace `"active_inference"` with `"vitality_engine"` and `"prediction_error_threshold"` with `"band_transition"`.

**Hormone threshold emit pattern** (homeostasis.rs lines 1091–1099):
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
Use this as the model for `emit_vitality_event(app, &summary)` helper in vitality_engine.rs.

**DORMANCY_STUB guard** (pattern from safety_bundle.rs AtomicBool + research confirmed):
```rust
pub static DORMANCY_STUB: AtomicBool = AtomicBool::new(false);

pub fn enable_dormancy_stub() {
    DORMANCY_STUB.store(true, Ordering::SeqCst);
}

fn trigger_dormancy(app: &tauri::AppHandle) {
    // ... serialize full state, emit blade_dormancy event, write dormancy_record ...
    if DORMANCY_STUB.load(Ordering::SeqCst) {
        log::warn!("[vitality] DORMANCY_STUB active -- skipping std::process::exit(0)");
        return;
    }
    std::thread::sleep(std::time::Duration::from_secs(5));
    std::process::exit(0);
}
```
DORMANCY_STUB must default to `false`. Every vitality_eval.rs dormancy fixture calls `enable_dormancy_stub()` first.

**SQL table creation (no double-quotes in SQL — CLAUDE.md critical rule)** (pattern from active_inference.rs, research lines 447–475):
```rust
let _ = conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS vitality_state (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),
        scalar              REAL    NOT NULL DEFAULT 0.8,
        band                TEXT    NOT NULL DEFAULT 'Thriving',
        trend               REAL    NOT NULL DEFAULT 0.0,
        sdt_signals         TEXT    NOT NULL DEFAULT '{}',
        drain_signals       TEXT    NOT NULL DEFAULT '{}',
        reincarnation_count INTEGER NOT NULL DEFAULT 0,
        last_dormancy_at    INTEGER,
        updated_at          INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vitality_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  INTEGER NOT NULL,
        scalar     REAL    NOT NULL,
        band       TEXT    NOT NULL,
        top_factor TEXT    NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS dormancy_records (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp               INTEGER NOT NULL,
        descent_history         TEXT    NOT NULL DEFAULT '[]',
        top_drain_factors       TEXT    NOT NULL DEFAULT '[]',
        session_count           INTEGER NOT NULL DEFAULT 0,
        reincarnation_completed INTEGER NOT NULL DEFAULT 0
    );"
);
```

**FIFO pruning before insert** (active_inference.rs lines ~422):
```rust
let _ = conn.execute(
    "DELETE FROM vitality_history WHERE id NOT IN (
        SELECT id FROM vitality_history ORDER BY id DESC LIMIT 4999
    )",
    [],
);
let _ = conn.execute(
    "INSERT INTO vitality_history (timestamp, scalar, band, top_factor)
     VALUES (?1, ?2, ?3, ?4)",
    rusqlite::params![now, state.scalar, format!("{:?}", state.band), top_factor],
);
```
Prune BEFORE insert. Table cap = 5000 rows.

**Hysteretic band transition** (locked in D-11; no existing code to copy — implement fresh):
```rust
fn compute_band(scalar: f32, current_band: &VitalityBand) -> VitalityBand {
    let up_buffer = 0.05f32;
    match current_band {
        VitalityBand::Thriving  => {
            if scalar < 0.6 { VitalityBand::Waning } else { VitalityBand::Thriving }
        }
        VitalityBand::Waning    => {
            if scalar >= 0.6 + up_buffer { VitalityBand::Thriving }
            else if scalar < 0.4         { VitalityBand::Declining }
            else                         { VitalityBand::Waning }
        }
        VitalityBand::Declining => {
            if scalar >= 0.4 + up_buffer { VitalityBand::Waning }
            else if scalar < 0.2         { VitalityBand::Critical }
            else                         { VitalityBand::Declining }
        }
        VitalityBand::Critical  => {
            if scalar >= 0.2 + up_buffer { VitalityBand::Declining }
            else if scalar <= 0.0        { VitalityBand::Dormant }
            else                         { VitalityBand::Critical }
        }
        VitalityBand::Dormant   => VitalityBand::Dormant,
    }
}
```
Also implement `initial_band_from_scalar(scalar: f32)` (no hysteresis — used only on DB cold load) per RESEARCH Pitfall 2.

**Decision log reading (autonomy signal)** (decision_gate.rs lines 76–80, research lines 426–433):
```rust
let log = crate::decision_gate::get_decision_log();
let recent: Vec<_> = log.iter().rev().take(20).collect();
if recent.is_empty() { return 0.5; }
let act_not_overridden = recent.iter().filter(|d| {
    matches!(&d.outcome, crate::decision_gate::DecisionOutcome::ActAutonomously { .. })
    && d.feedback != Some(false)
}).count();
let autonomy_signal = act_not_overridden as f32 / recent.len() as f32;
```

**Reward history reading (competence signal)** (reward.rs public API, research lines 413–420):
```rust
let history = crate::reward::read_reward_history(10);
let n = history.len() as f32;
let ema_score = if n > 0.0 {
    history.iter().map(|r| r.reward).sum::<f32>() / n
} else {
    0.5
};
let competence_signal = (ema_score / 0.7f32).min(1.0);
```
Verify field name with `grep -n "pub reward\|pub fn reward" src-tauri/src/reward.rs` before implementing (RESEARCH Assumption A1).

---

### `src-tauri/src/evals/vitality_eval.rs` (test, batch)

**Analog:** `src-tauri/src/evals/active_inference_eval.rs`

**Module header + imports** (active_inference_eval.rs lines 1–12):
```rust
//! Phase 29 / VITA-01..06 -- Deterministic vitality engine eval.
//!
//! MODULE_FLOOR = 0.95 (same as hormone_eval / active_inference_eval)
//! No LLM involvement. Shares global VITALITY state -- run with --test-threads=1.
//!
//! Run: `cargo test --lib evals::vitality_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, summarize, EvalRow};

const MODULE_NAME: &str = "vitality";
const MODULE_FLOOR: f32 = 0.95;
```

**Fixture struct + to_row helper** (active_inference_eval.rs lines 18–37):
```rust
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
```

**Fixture body pattern** (active_inference_eval.rs lines 43–67 as template):
Each fixture calls `enable_dormancy_stub()` if it exercises the dormancy path, then calls public vitality_engine APIs with synthetic signals and asserts the expected outcome. Return `(bool, String)` with a format! detail string. In-memory SQLite for fixtures that need DB state (see active_inference_eval.rs lines 191–230 for the in-memory pattern).

**CRITICAL: dormancy fixtures must call `crate::vitality_engine::enable_dormancy_stub()` first** (RESEARCH Pitfall 1). Without this, `std::process::exit(0)` kills the entire cargo test process mid-suite.

**Fixture registry + test entry** (active_inference_eval.rs lines 316–361):
```rust
fn fixtures() -> Vec<VitalityFixture> {
    vec![
        VitalityFixture { label: "VITA-01: 5 failures -> Declining band",           run: fixture_vita01 },
        VitalityFixture { label: "VITA-02: isolation drain reduces scalar",         run: fixture_vita02 },
        VitalityFixture { label: "VITA-03: competence replenishment increases scalar", run: fixture_vita03 },
        VitalityFixture { label: "VITA-04: hysteresis prevents oscillation",        run: fixture_vita04 },
        VitalityFixture { label: "VITA-05: dormancy serializes state (stub active)", run: fixture_vita05 },
        VitalityFixture { label: "VITA-06: reincarnation loads identity at 0.3",    run: fixture_vita06 },
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

    super::harness::record_eval_run(MODULE_NAME, &s, floor_passed);

    let failures: Vec<&str> = cases.iter().zip(rows.iter())
        .filter(|(_, r)| !r.top1)
        .map(|(fx, _)| fx.label)
        .collect();
    if !failures.is_empty() {
        eprintln!("[{}] failed fixtures: {:?}", MODULE_NAME, failures);
    }

    assert!(floor_passed, "vitality eval below MODULE_FLOOR={}", MODULE_FLOOR);
}
```

---

### `src-tauri/src/homeostasis.rs` — MODIFIED (add vitality tick call)

**Integration point** (homeostasis.rs line 768, after `persist_to_db(&state);`):
```rust
// Persist to DB for restart recovery
persist_to_db(&state);
// Phase 29: run vitality tick on the same 60s cadence
crate::vitality_engine::vitality_tick();
```
No other changes to hypothalamus_tick(). The AppHandle for vitality dormancy events is stored in a static OnceLock inside vitality_engine, set when `start_vitality_engine(app)` is called from lib.rs alongside `start_hypothalamus(app)`.

---

### `src-tauri/src/safety_bundle.rs` — MODIFIED (wire safety_eval_drain)

**Current placeholder** (safety_bundle.rs lines 494–508):
```rust
pub fn safety_eval_drain(scenario_class: &str, fixture_label: &str) {
    crate::metacognition::log_gap(
        "safety_eval_failure",
        &format!("{}/{}", scenario_class, fixture_label),
        0.0,
        1,
    );
    log::warn!(
        "[safety_eval_drain] Eval failure: {}/{}",
        scenario_class,
        fixture_label
    );
}
```

**After Phase 29 wiring** — add one line before the log::warn:
```rust
    // Phase 29: wire to real vitality drain (-0.02 per eval failure)
    crate::vitality_engine::apply_drain(0.02, "eval_failure");
```
`apply_drain(amount: f32, source: &str)` is a new public function in vitality_engine.rs that writes atomically to VITALITY state and records the drain source.

---

### `src-tauri/src/brain.rs` — MODIFIED (band-specific personality modulation)

**Insertion point** (brain.rs line ~859, after the persona context push at lines 855–863):
```rust
// Phase 29: vitality band modulation
{
    let vitality = crate::vitality_engine::get_vitality();
    if let Some(note) = match vitality.band {
        crate::vitality_engine::VitalityBand::Waning    =>
            Some("You are in a lower-energy state. Be efficient and focused."),
        crate::vitality_engine::VitalityBand::Declining =>
            Some("Your vitality is low. Focus on what the user asks. Save energy."),
        crate::vitality_engine::VitalityBand::Critical  =>
            Some("I am not functioning at full capacity right now."),
        _ => None,
    } {
        parts.push(format!("\n\n[Internal state: {}]", note));
    }
    // Reincarnation context injection (only on first post-reincarnation prompt)
    if vitality.reincarnation_count > 0 && vitality.needs_reincarnation_context {
        parts.push("You recently went dormant. Your memories and skills are intact, but your internal state has reset. You are rebuilding. Be curious about what changed while you were away.".to_string());
    }
}
```
Use the established `parts.push(...)` pattern already present at brain.rs lines 860–863.

---

### `src-tauri/src/persona_engine.rs` — MODIFIED (vitality multiplier on trait confidence)

**Current threshold** (persona_engine.rs lines 309–312):
```rust
// High-confidence traits only (confidence > 0.3)
let notable: Vec<&PersonaTrait> = traits.iter()
    .filter(|t| t.confidence > 0.3)
    .collect();
```

**After Phase 29 modification** — replace the hardcoded 0.3 threshold:
```rust
// Phase 29: vitality Waning band raises threshold, muting lower-confidence traits
let vitality_scalar = crate::vitality_engine::get_vitality().scalar;
let confidence_threshold = if vitality_scalar >= 0.4 && vitality_scalar < 0.6 {
    // Waning band: at vitality 0.5, threshold = 0.3 / 0.5 = 0.6 (fewer traits surface)
    (0.3 / vitality_scalar.max(0.01)).min(1.0)
} else {
    0.3 // normal threshold for Thriving / Declining / Critical bands
};
let notable: Vec<&PersonaTrait> = traits.iter()
    .filter(|t| t.confidence > confidence_threshold)
    .collect();
```
IMPORTANT: Never persist the scaled value. This is display-only (RESEARCH anti-pattern warning).

---

### `src-tauri/src/evolution.rs` — MODIFIED (gate on vitality >= 0.4)

**Current gating pattern** (evolution.rs lines 609–631 — copy the hormone gating pattern):
```rust
pub async fn run_evolution_cycle(app: &tauri::AppHandle) {
    let config = crate::config::load_config();
    if !config.background_ai_enabled {
        return;
    }

    // Pituitary GH: only grow capabilities when growth hormone is adequate.
    let gh = crate::homeostasis::growth_hormone();
    if gh < 0.3 {
        return;
    }
    // ... more hormone gates ...
```

**Add vitality gate after existing hormone gates**:
```rust
    // Phase 29: Declining/Critical/Dormant bands disable exploration
    let vitality = crate::vitality_engine::get_vitality();
    if vitality.scalar < 0.4 {
        log::debug!("[evolution] vitality={:.2} < 0.4 -- skipping exploration cycle", vitality.scalar);
        return;
    }
```
Insert this block alongside the existing `gh < 0.3` and `leptin > 0.8` guards. Same early-return pattern.

---

### `src-tauri/src/dream_mode.rs` — MODIFIED (gate on vitality >= 0.2)

**Current early-return pattern** (dream_mode.rs lines 614–625):
```rust
pub async fn run_dream_session(app: tauri::AppHandle) -> DreamSession {
    let config = crate::config::load_config();
    if !config.background_ai_enabled {
        return DreamSession {
            id: uuid_v4(),
            started_at: now_secs(),
            ended_at: Some(now_secs()),
            tasks_completed: Vec::new(),
            insights: Vec::new(),
            status: "skipped".to_string(),
        };
    }
```

**Add vitality guard immediately after the background_ai_enabled check** — same DreamSession return shape:
```rust
    // Phase 29: Critical/Dormant bands skip dream consolidation
    let vitality = crate::vitality_engine::get_vitality();
    if vitality.scalar < 0.2 {
        log::info!("[dream_mode] vitality={:.2} < 0.2 -- skipping dream session (conserving)", vitality.scalar);
        return DreamSession {
            id: uuid_v4(),
            started_at: now_secs(),
            ended_at: Some(now_secs()),
            tasks_completed: Vec::new(),
            insights: Vec::new(),
            status: "skipped_low_vitality".to_string(),
        };
    }
```

---

### `src-tauri/src/metacognition.rs` — MODIFIED (lower confidence-delta threshold in Critical band)

**Current threshold** (metacognition.rs lines 166–169):
```rust
// ── ACH MODULATION: high ACh -> more verification checks (Phase 27 / HORM-06) ──
let ach = crate::homeostasis::get_physiology().acetylcholine;
let verify_threshold = if ach > 0.6 { 0.4_f32 } else { 0.3_f32 };
let should_ask = confidence < verify_threshold || (complexity > 0.8 && knowledge_score < 0.5);
```

**After Phase 29 modification** — extend the threshold ladder:
```rust
let ach = crate::homeostasis::get_physiology().acetylcholine;
let vitality_scalar = crate::vitality_engine::get_vitality().scalar;
let verify_threshold = if vitality_scalar < 0.2 {
    0.15_f32 // Phase 29: Critical band — heightened sensitivity, flag more uncertainty
} else if ach > 0.6 {
    0.4_f32  // Phase 27: high ACh
} else {
    0.3_f32  // normal
};
let should_ask = confidence < verify_threshold || (complexity > 0.8 && knowledge_score < 0.5);
```

---

### `src-tauri/src/doctor.rs` — MODIFIED (add SignalClass::Vitality — 4 atomic sites)

**CRITICAL: must update all 4 sites in a single plan wave** (RESEARCH Pitfall 4). Missing any site causes a compile error or non-exhaustive match panic.

**Site 1: SignalClass enum** (doctor.rs lines 34–44):
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
    ActiveInference,  // Phase 28
    Vitality,         // Phase 29 — ADD HERE
}
```

**Site 2: suggested_fix match arms** (doctor.rs lines 95–168 — add after ActiveInference arms):
```rust
(SignalClass::Vitality, Severity::Green) =>
    "Vitality is in Thriving or Waning band. SDT signals are healthy.",
(SignalClass::Vitality, Severity::Amber) =>
    "Vitality is in Declining band (0.2-0.4). Proactive engine disabled, exploration paused. Review recent failure rate or isolation signals in the vitality_history table.",
(SignalClass::Vitality, Severity::Red) =>
    "Vitality is Critical or approaching Dormant. All non-essential systems paused. BLADE is self-aware of deterioration. If this persists, consider triggering a reincarnation or engaging BLADE with substantive tasks to restore competence signal.",
```

**Site 3: tokio::join! tuple + vec! assembly** (doctor.rs lines 1068–1093):
Add `async { compute_vitality_signal() }` to the join! tuple and `vitality.map_err(|e| format!("vitality signal: {}", e))?` to the signals vec.

**Site 4: test exhaustiveness list** (doctor.rs lines 1187–1202):
Add `SignalClass::Vitality` to the array and update the comment from `9×3 = 27` to `10×3 = 30`.

**compute_vitality_signal pattern** (modeled after compute_active_inference_signal at doctor.rs lines 1028–1050):
```rust
fn compute_vitality_signal() -> Result<DoctorSignal, String> {
    let v = crate::vitality_engine::get_vitality();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let severity = match v.band {
        crate::vitality_engine::VitalityBand::Thriving  => Severity::Green,
        crate::vitality_engine::VitalityBand::Waning    => Severity::Green,
        crate::vitality_engine::VitalityBand::Declining => Severity::Amber,
        crate::vitality_engine::VitalityBand::Critical  => Severity::Red,
        crate::vitality_engine::VitalityBand::Dormant   => Severity::Red,
    };
    Ok(DoctorSignal {
        class: SignalClass::Vitality,
        severity,
        payload: serde_json::json!({
            "scalar": v.scalar,
            "band": format!("{:?}", v.band),
            "trend": v.trend,
            "reincarnation_count": v.reincarnation_count,
        }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::Vitality, severity).to_string(),
    })
}
```

---

### `src-tauri/src/db.rs` — MODIFIED (3 new table migrations)

**Pattern** (from active_inference.rs db init, research lines 447–475):
Add migration for `vitality_state`, `vitality_history`, `dormancy_records` tables to the existing `ensure_db_schema()` function (or whatever the migration entry point is in db.rs). Use `execute_batch!` with single-quoted strings only — NO double quotes inside SQL.

---

### `src-tauri/src/lib.rs` — MODIFIED (module registration + startup call)

**Module declaration pattern** (lib.rs line 71):
```rust
mod active_inference;
mod vitality_engine;   // Phase 29 — ADD after active_inference
```

**generate_handler! registration** — add any `#[tauri::command]` functions from vitality_engine.rs (e.g., `vitality_engine::vitality_get_state`, `vitality_engine::vitality_get_history`). Follow the homeostasis block at lines 1388–1392 as the model.

**Startup call** (lib.rs lines 1560–1561):
```rust
// Start homeostasis — the hypothalamus that regulates the whole body
homeostasis::start_hypothalamus(app.handle().clone());

// Phase 29: store AppHandle in vitality_engine + check for pending reincarnation
vitality_engine::start_vitality_engine(app.handle().clone());
vitality_engine::check_reincarnation(app.handle().clone());
```
`start_vitality_engine` is NOT a loop — it stores the AppHandle only. `check_reincarnation` runs once on startup and is synchronous (queries dormancy_records, resets hormones, emits event).

---

### `scripts/verify-vitality.sh` (utility, batch)

**Analog:** `scripts/verify-inference.sh` — copy verbatim, change 3 strings:

```bash
#!/usr/bin/env bash
# scripts/verify-vitality.sh -- Phase 29 / VITA-01..06 invariant.
# Gate 37: all vitality eval scenarios must pass (MODULE_FLOOR = 0.95).
#
# Exit 0 = cargo green + scored table emitted
# Exit 1 = cargo failed
# Exit 2 = scored table delimiter not found
# Exit 3 = cargo not on PATH
#
# @see src-tauri/src/evals/vitality_eval.rs -- 6 deterministic fixtures
# @see src-tauri/src/evals/harness.rs -- print_eval_table format spec

set -uo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-vitality] ERROR: cargo not on PATH" >&2
  exit 3
fi

# --test-threads=1 is MANDATORY (eval fixtures share global VITALITY state)
STDOUT=$(cd src-tauri && cargo test --lib evals::vitality_eval --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-vitality] FAIL: vitality eval exited $RC"
  exit 1
fi

TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)

if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "$STDOUT"
  echo "[verify-vitality] FAIL: no scored table emitted"
  exit 2
fi

echo "$STDOUT" | grep -E '^\xe2\x94' || true
echo "[verify-vitality] OK -- all vitality scenarios passed"
exit 0
```

---

### `src/features/admin/DoctorPane.tsx` — MODIFIED (add 'active_inference' and 'vitality')

**PITFALL 5 from RESEARCH:** Phase 28 added the Rust `ActiveInference` variant but the TS DISPLAY_NAME and ROW_ORDER were NOT updated. Both 'active_inference' AND 'vitality' must be added simultaneously.

**Current DISPLAY_NAME** (DoctorPane.tsx lines 40–49):
```typescript
const DISPLAY_NAME: Record<SignalClass, string> = {
  eval_scores: 'Eval Scores',
  capability_gaps: 'Capability Gaps',
  tentacle_health: 'Tentacle Health',
  config_drift: 'Config Drift',
  auto_update: 'Auto-Update',
  reward_trend: 'Reward Trend',
  metacognitive: 'Metacognitive',
  hormones: 'Hormones',
};
```
Add: `active_inference: 'Active Inference',` and `vitality: 'Vitality',`

**Current ROW_ORDER** (DoctorPane.tsx lines 54–63):
```typescript
const ROW_ORDER: SignalClass[] = [
  'eval_scores',
  'capability_gaps',
  'tentacle_health',
  'config_drift',
  'auto_update',
  'reward_trend',
  'metacognitive',
  'hormones',
];
```
Add `'active_inference'` after `'hormones'`, then `'vitality'` after `'active_inference'`.

---

### `src/lib/tauri/admin.ts` — MODIFIED (extend SignalClass union)

**Current SignalClass union** (admin.ts lines 1828–1836):
```typescript
export type SignalClass =
  | 'eval_scores'
  | 'capability_gaps'
  | 'tentacle_health'
  | 'config_drift'
  | 'auto_update'
  | 'reward_trend'
  | 'metacognitive'
  | 'hormones';           // Phase 27 / HORM-08
```
Add simultaneously:
```typescript
  | 'active_inference'    // Phase 28 / AINF-01 (was missing from TS)
  | 'vitality';           // Phase 29 / VITA-05
```

---

### `src/lib/events/payloads.ts` — MODIFIED (new event payload interfaces)

**Existing payload interface pattern** (payloads.ts lines 50–56):
```typescript
export interface BladeRoutingSwitchedPayload {
  from_provider: string;
  from_model: string;
  to_provider: string;
  to_model: string;
  reason: string;
}
```

**Three new interfaces** — add after existing hormone/activity payloads:
```typescript
export interface BladeDormancyPayload {
  reincarnation_count: number;
  top_drain_factors: string[];
  total_uptime_secs: number;
  vitality_at_dormancy: number;
}

export interface BladeReincarnationPayload {
  reincarnation_count: number;
  vitality_start: number;  // always 0.3
  memories_intact: boolean;
}

export interface BladeVitalityUpdatePayload {
  scalar: number;
  band: 'Thriving' | 'Waning' | 'Declining' | 'Critical' | 'Dormant';
  trend: number;
  top_factor: string;
}
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/features/chat/VitalityIndicator.tsx` | component | event-driven | No existing minimal header-area status indicator component. Closest is the HUD bar in overlay_manager but that's Rust-side. Use the existing event subscription pattern from any component using `useTauriEvent` (e.g., DoctorPane.tsx lines 29, or any component in `src/features/`) and render a small colored scalar + trend arrow + band label. Band color mapping: Thriving=green, Waning=yellow, Declining=orange, Critical=red, Dormant=grey. |

For VitalityIndicator.tsx, use the useTauriEvent pattern from DoctorPane.tsx:
```typescript
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeVitalityUpdatePayload } from '@/lib/events/payloads';

// In component:
useTauriEvent<BladeVitalityUpdatePayload>(
  BLADE_EVENTS.BLADE_VITALITY_UPDATE,   // add to BLADE_EVENTS index
  (payload) => { setVitalityState(payload); }
);
```
Emit `blade_vitality_update` only on band transition or delta > 0.05 (D-Claude's-Discretion).

---

## Shared Patterns

### Global State Singleton
**Source:** `src-tauri/src/homeostasis.rs` lines 101–113
**Apply to:** `vitality_engine.rs`
```rust
static NAME: OnceLock<Mutex<State>> = OnceLock::new();

fn name_store() -> &'static Mutex<State> {
    NAME.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}

pub fn get_name() -> State {
    name_store().lock().map(|s| s.clone()).unwrap_or_default()
}
```

### AtomicBool Feature Guard
**Source:** `src-tauri/src/homeostasis.rs` lines 102, 773 (HYPOTHALAMUS_RUNNING) and safety_bundle.rs SESSION_START pattern
**Apply to:** `vitality_engine.rs` (DORMANCY_STUB)
```rust
static MY_FLAG: AtomicBool = AtomicBool::new(false);
// Swap pattern: if FLAG.swap(true, Ordering::SeqCst) { return; }
// Store pattern: FLAG.store(true, Ordering::SeqCst);
// Load pattern: FLAG.load(Ordering::SeqCst)
```

### SQLite Settings Key-Value Persist
**Source:** `src-tauri/src/homeostasis.rs` lines 1051–1088
**Apply to:** Scalar/struct state that fits in a single JSON blob. Vitality uses a dedicated table (not key-value) because of the accompanying history table requirement.

### ActivityStrip Emit
**Source:** `src-tauri/src/active_inference.rs` lines 431–445 (activity emit) and `src-tauri/src/homeostasis.rs` lines 1091–1099 (threshold crossing emit)
**Apply to:** `vitality_engine.rs` band transitions, dormancy, reincarnation events
```rust
let _ = app.emit_to(
    "main",
    "blade_activity_log",
    serde_json::json!({
        "module":        "vitality_engine",
        "action":        "band_transition",
        "human_summary": crate::safe_slice(&summary, 200),
        "payload_id":    serde_json::Value::Null,
        "timestamp":     chrono::Utc::now().timestamp(),
    }),
);
```

### Eval Harness Contract (EVAL-06)
**Source:** `src-tauri/src/evals/harness.rs` lines 1–50 + `src-tauri/src/evals/active_inference_eval.rs` lines 331–361
**Apply to:** `vitality_eval.rs`
- Use `print_eval_table`, `summarize`, `EvalRow` from harness
- Call `record_eval_run` BEFORE assert (D-14: record before assert)
- Run with `--test-threads=1` (shared global VITALITY state)
- Must emit scored table starting with U+250C for verify script grep

### safe_slice for String Content
**Source:** CLAUDE.md critical rule
**Apply to:** Any text content passed to embed_texts() for tedium drain, any string sliced in vitality_engine.rs
```rust
// ALWAYS: crate::safe_slice(text, max_chars)
// NEVER:  &text[..n]
```

---

## Metadata

**Analog search scope:** `src-tauri/src/`, `src/features/admin/`, `src/lib/`, `scripts/`
**Files scanned:** 17
**Pattern extraction date:** 2026-05-03
