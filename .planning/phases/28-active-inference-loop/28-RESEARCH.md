# Phase 28: Active Inference Loop - Research

**Researched:** 2026-05-02
**Domain:** Rust cognitive architecture — active inference, prediction error computation, hormone bus integration, dream mode extension
**Confidence:** HIGH (all findings verified against live codebase)

## Summary

Phase 28 wires Friston-inspired active inference into BLADE's existing Hive mesh and hormone bus. The implementation is a new `active_inference.rs` module that sits between the Hive tick cycle and the PhysiologicalState hormone bus. It reads `TentacleReport` payloads produced by `hive_tick()`, computes per-signal prediction errors, aggregates them, and calls a new `update_physiology_from_prediction_errors()` in `homeostasis.rs` — a second input channel alongside the existing `update_physiology_from_classifier()`.

All five touch points (hive.rs, homeostasis.rs, dream_mode.rs, doctor.rs, db.rs) have been read in full. The patterns for OnceLock global state, SQLite persistence via settings key-value store, EMA smoothing at α=0.05, dream task insertion, and DoctorPane SignalClass extension are all well-established in the codebase. Phase 28 follows every one of them without deviation.

The demo loop (AINF-04) is the critical success criterion: inject synthetic Slack + calendar `TentacleReport` payloads, run 3 ticks of the prediction error pass, assert cortisol crosses 0.3 baseline. This must be a deterministic Rust unit test under `evals::active_inference_eval`, following the exact eval harness pattern established by `hormone_eval.rs` and `safety_eval.rs`.

**Primary recommendation:** New `active_inference.rs` module with `OnceLock<Mutex<HashMap<String, TentaclePrediction>>>` global state, hooked into `hive_tick()` after report collection (line ~2419 in hive.rs), with two new SQLite tables in db.rs and a new `SignalClass::ActiveInference` variant in doctor.rs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** New `active_inference.rs` module. Conceptually separate from hive.rs and homeostasis.rs. Reads both, maintains own state, writes prediction errors to hormone bus. Does NOT extend the `Tentacle` struct.

**D-02:** `TentaclePrediction` struct per tentacle type with named numeric signals (HashMap<String, f32>). Calendar: `{event_count, free_slots, meeting_hours}`. Slack: `{unread_count, mention_count, backlog_size}`. GitHub: `{open_prs, review_requests, ci_failures}`. Each signal has expected value and confidence weight.

**D-03:** Global `OnceLock<Mutex<HashMap<String, TentaclePrediction>>>` keyed by tentacle platform ID. Same pattern as `HORMONES` and `HIVE`. Loaded from SQLite on init, saved after each tick.

**D-04:** Per-tentacle-type normalization functions in `active_inference.rs`. Returns normalized error in [0.0, 1.0]. Error = weighted mean of per-signal |expected - observed| / range.

**D-05:** Observed state extracted from `TentacleReport` payloads after each `hive_tick()` poll. No new data collection — re-interprets existing report.details JSON.

**D-06:** New `update_physiology_from_prediction_errors()` in homeostasis.rs, alongside existing `update_physiology_from_classifier()`. Additive second input channel. Same α=0.05 smoothing.

**D-07:** Sustained high aggregate error (>0.6 across 3+ tentacles for 2+ ticks): cortisol + norepinephrine rise. Low aggregate error (<0.2 sustained): serotonin rises. Novel single-tentacle spike: norepinephrine rises specifically.

**D-08:** Aggregate prediction error = weighted mean across active tentacles; Error/Dormant tentacles contribute 0 weight. DoctorPane displays this aggregate.

**D-09:** Hook into `hive_tick()` — after all tentacle reports collected and routed to Heads, run prediction error computation pass.

**D-10:** Demo loop: inject synthetic TentacleReport payloads (calendar: 8 events, 0 free slots, 6 hours meetings; Slack: 15 unread, 5 mentions, 20 backlog). Assert cortisol > 0.3 after 3 ticks. Assert brain.rs system prompt contains terse/action-focused text. Deterministic integration test — no LLM needed.

**D-11:** Demo loop proves chain without live API connections. Fixture uses synthetic reports.

**D-12:** New `task_prediction_replay()` in dream_mode.rs as task 3 (before skill_prune). Order: prune → consolidate → prediction_replay → generate.

**D-13:** Queries prediction_error_log for events with error > 0.5, sorts by error magnitude descending, replays top-N through memory.rs consolidation. Emits `dream_mode:replay`.

**D-14:** Replay = re-extract facts/patterns from high-error context using typed_memory's extraction pipeline. Not literal replay — consolidation pass weighted by surprise.

**D-15:** EMA on expected state values: `expected = expected * (1 - α) + observed * α`. Calendar α=0.1, Slack α=0.08, GitHub α=0.05.

**D-16:** Learning at end of each prediction error computation inside hive_tick hook. Persisted to SQLite immediately.

**D-17:** Cold start: calendar defaults (3 events, 2 free slots, 2 meeting hours), etc. After ~10 observations (~5 minutes), predictions reflect user patterns.

**D-18:** New `SignalClass::ActiveInference` in doctor.rs. Shows: aggregate prediction error, tentacle with highest error, number of tentacles tracked, demo loop conditions active indicator.

**D-19:** Two new SQLite tables: `tentacle_predictions` (platform, signal_name, expected_value, confidence, updated_at) and `prediction_error_log` (platform, aggregate_error, top_signal, timestamp), capped at 1000 rows with FIFO pruning.

### Claude's Discretion

- Exact numeric defaults for cold-start expected states per tentacle type
- Signal extraction functions per tentacle report format (parsing report.details JSON)
- Error threshold for hippocampal replay (suggested 0.5, tune based on distribution)
- Top-N count for dream replay (suggested 10 per session)
- Exact per-signal normalization ranges (historical max-min, or fixed ranges)
- DoctorPane row formatting and which signals are most useful to surface
- Whether to emit `hive_prediction_error` event to frontend or only store in SQLite (ActivityStrip event on threshold crossings recommended)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AINF-01 | Each Hive tentacle stores expected state (prediction) alongside observed state | D-01..D-03: `TentaclePrediction` struct, OnceLock global map, initialized from SQLite cold-start defaults |
| AINF-02 | Prediction error calculated as delta between expected and observed; normalized per tentacle type | D-04..D-05: per-type normalization functions reading TentacleReport.details |
| AINF-03 | Prediction errors feed into hormone bus — sustained high error raises cortisol/NE; low error raises serotonin | D-06..D-08: `update_physiology_from_prediction_errors()`, α=0.05, weighted aggregate |
| AINF-04 | At least one closed loop demoable: calendar packed + Slack backlog → cortisol↑ → terse responses | D-09..D-11: hive_tick hook position identified (after line 2419 in hive.rs), deterministic eval fixture |
| AINF-05 | Prediction-error-weighted memory replay during dream_mode (hippocampal analog) | D-12..D-14: task_prediction_replay() as 4th task in run_dream_session(), queries prediction_error_log |
| AINF-06 | Tentacle predictions update based on observed patterns — BLADE learns what to expect | D-15..D-17: EMA per tentacle type, immediate SQLite persistence, cold-start defaults |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Prediction state storage | Backend (Rust) | SQLite | Global OnceLock mutex, same tier as HORMONES and HIVE |
| Prediction error computation | Backend (Rust) | — | Pure math functions on TentacleReport data |
| Error → hormone mapping | Backend (Rust/homeostasis.rs) | — | Writes to PhysiologicalState, same tier as classifier |
| Dream replay | Backend (Rust/dream_mode.rs) | SQLite | Queries prediction_error_log, runs in background |
| Prediction learning (EMA) | Backend (Rust) | SQLite | Runs at end of hive_tick, persisted immediately |
| DoctorPane display | Frontend → Backend read | doctor.rs compute | compute_active_inference_signal() called in doctor_run_full_check() |
| Demo loop verification | Rust test (evals::active_inference_eval) | — | Deterministic fixture, no LLM |

## Standard Stack

### Core (existing, no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rusqlite | existing | SQLite for prediction tables | Same as all other BLADE persistence |
| serde / serde_json | existing | TentacleReport.details parsing, struct serialization | Used throughout codebase |
| std::sync::OnceLock + Mutex | std | Global prediction state | Established pattern (HORMONES, HIVE) |
| chrono | existing | Timestamps for prediction_error_log | Used in homeostasis.rs and db.rs |

**No new Cargo dependencies required for this phase.** [VERIFIED: read Cargo.toml and reviewed all decision points]

### Installation

```bash
# No new packages needed — all deps are existing
```

## Architecture Patterns

### System Architecture Diagram

```
hive_tick() [30s loop]
    │
    ├─► poll_tentacle() × N
    │       └─► TentacleReport {details: JSON}
    │
    ├─► route reports to Heads (existing)
    │
    ├─► [NEW] active_inference::compute_prediction_errors(&all_reports)
    │       │
    │       ├─► extract_signals(platform, report.details)
    │       │       → ObservedSignals {signal_name: f32}
    │       │
    │       ├─► PREDICTIONS.get(platform) → TentaclePrediction
    │       │
    │       ├─► normalize_error(expected, observed) → f32 in [0,1]
    │       │
    │       ├─► update EMA: expected = expected*(1-α) + observed*α
    │       │
    │       ├─► persist TentaclePrediction → SQLite (tentacle_predictions)
    │       │
    │       ├─► log PredictionErrorRecord → SQLite (prediction_error_log)
    │       │
    │       └─► aggregate_error, top_tentacle, tick_count
    │
    └─► [NEW] homeostasis::update_physiology_from_prediction_errors(aggregate, tick_count)
            │
            ├─► sustained high (>0.6, 2+ ticks) → cortisol↑ + norepinephrine↑
            ├─► sustained low (<0.2) → serotonin↑
            └─► novel spike (single tentacle) → norepinephrine↑

dream_session [20min idle trigger]
    │
    ├─► task_memory_consolidation()     (existing)
    ├─► task_autonomous_research()      (existing)
    ├─► [NEW] task_prediction_replay()
    │       └─► query prediction_error_log WHERE error > 0.5 ORDER BY DESC LIMIT 10
    │           └─► typed_memory extraction pass (re-consolidate high-error contexts)
    ├─► task_goal_strategy_review()     (existing)
    └─► [existing skill tasks...]

doctor_run_full_check()
    └─► [NEW] compute_active_inference_signal()
            → DoctorSignal { class: ActiveInference, payload: {aggregate_error, top_tentacle, ...} }
```

### Recommended Project Structure

```
src-tauri/src/
├── active_inference.rs          # NEW — Phase 28 core module
│                                #   TentaclePrediction, PREDICTIONS OnceLock
│                                #   extract_signals_*, normalize_error_*
│                                #   compute_prediction_errors() — called from hive.rs
│                                #   get_active_inference_state() — called from doctor.rs
├── homeostasis.rs               # EXTEND — add update_physiology_from_prediction_errors()
├── hive.rs                      # EXTEND — hook active_inference::compute_prediction_errors
│                                #   after line 2438 (people enrichment block) before emit
├── dream_mode.rs                # EXTEND — add task_prediction_replay() as task 3
├── doctor.rs                    # EXTEND — SignalClass::ActiveInference + compute fn
├── db.rs                        # EXTEND — two new tables in run_migrations()
└── evals/
    └── active_inference_eval.rs # NEW — deterministic fixture tests for AINF-01..06
scripts/
└── verify-inference.sh          # NEW — Gate 36: verify:inference
```

### Pattern 1: Global OnceLock Prediction State (follows HIVE / HORMONES)

```rust
// Source: verified in homeostasis.rs (line 200) and hive.rs
static PREDICTIONS: OnceLock<Mutex<HashMap<String, TentaclePrediction>>> = OnceLock::new();

fn predictions_store() -> &'static Mutex<HashMap<String, TentaclePrediction>> {
    PREDICTIONS.get_or_init(|| Mutex::new(load_predictions_from_db().unwrap_or_default()))
}

pub fn get_predictions() -> HashMap<String, TentaclePrediction> {
    predictions_store().lock().map(|p| p.clone()).unwrap_or_default()
}
```

### Pattern 2: EMA Update (follows update_physiology_from_classifier alpha=0.05)

```rust
// Source: verified in homeostasis.rs::update_physiology_from_classifier (line 377)
// Phase 28 uses per-tentacle alpha instead of global 0.05
fn update_prediction_ema(prediction: &mut TentaclePrediction, observed: &HashMap<String, f32>) {
    let alpha = match prediction.platform.as_str() {
        "calendar" => 0.1,
        "slack"    => 0.08,
        "github"   => 0.05,
        _          => 0.07,
    };
    for (signal, obs_val) in observed {
        if let Some(entry) = prediction.signals.get_mut(signal) {
            entry.expected = entry.expected * (1.0 - alpha) + obs_val * alpha;
        }
    }
}
```

### Pattern 3: SQLite Key-Value Persist (follows homeostasis.rs persist_physiology_to_db)

```rust
// Source: verified in homeostasis.rs lines 1038-1049
fn persist_predictions_to_db(predictions: &HashMap<String, TentaclePrediction>) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        for (platform, pred) in predictions {
            if let Ok(json) = serde_json::to_string(pred) {
                let _ = conn.execute(
                    "INSERT INTO tentacle_predictions (platform, data, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(platform) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                    rusqlite::params![platform, json, chrono::Utc::now().timestamp()],
                );
            }
        }
    }
}
```

### Pattern 4: DoctorPane Signal (follows compute_hormones_signal / Phase 27)

```rust
// Source: verified in doctor.rs lines 989-1014
fn compute_active_inference_signal() -> Result<DoctorSignal, String> {
    let state = crate::active_inference::get_active_inference_state();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let severity = if state.aggregate_error > 0.7 {
        Severity::Red
    } else if state.aggregate_error > 0.4 {
        Severity::Amber
    } else {
        Severity::Green
    };
    Ok(DoctorSignal {
        class: SignalClass::ActiveInference,
        severity,
        payload: serde_json::json!({
            "aggregate_error": state.aggregate_error,
            "top_tentacle": state.top_tentacle,
            "tracked_count": state.tracked_count,
            "demo_loop_active": state.demo_loop_active,
        }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::ActiveInference, severity).to_string(),
    })
}
```

### Pattern 5: Dream Task Insertion (follows run_dream_session macro pattern)

```rust
// Source: verified in dream_mode.rs lines 557-631
// The run_task! macro handles timeout, event emission, early exit on user activity.
// NEW task added BEFORE skill_prune (changed order from CONTEXT D-12):
//   memory_consolidation → autonomous_research → goal_strategy_review →
//   skill_synthesis → [NEW] prediction_replay → skill_prune → skill_consolidate → skill_from_trace

run_task!("prediction_replay", task_prediction_replay());
```

**CRITICAL NOTE on dream task ordering:** The CONTEXT says D-12 places prediction_replay BEFORE skill_prune. But the current run_dream_session() has this order (verified at line 605-631):
1. memory_consolidation
2. autonomous_research
3. goal_strategy_review
4. skill_synthesis
5. skill_prune (Phase 24)
6. skill_consolidate (Phase 24)
7. skill_from_trace (Phase 24)
8. code_health_scan
9. prebuild_briefing
10. weekly_meta_critique

The planner should insert `prediction_replay` AFTER `skill_synthesis` and BEFORE `skill_prune`, matching D-12's intent (replay informs what to prune/consolidate). This is a position 5 insertion.

### Pattern 6: hive_tick Hook Position (verified in hive.rs)

The correct insertion point is after the "People enrichment" block (line 2464 in hive.rs) and before `store_decisions_to_memory()` (line 2594). Specifically, after line 2464 (end of the people enrichment tokio::spawn block), before line 2466 (CI auto-fix pipeline). This keeps prediction error computation after all reports are available and before the final emit/log calls.

```rust
// Source: verified in hive.rs lines 2419-2600
// Insert here:
if !all_reports.is_empty() {
    crate::active_inference::compute_prediction_errors(&app, &all_reports).await;
}
```

Making it conditional on `!all_reports.is_empty()` matches the existing early-return pattern at line 2323.

### Anti-Patterns to Avoid

- **Extending the `Tentacle` struct:** D-01 explicitly forbids this. 15+ consumers read `Tentacle` and would need updating. The PREDICTIONS global map is keyed by platform ID — fully decoupled.
- **Blocking hive_tick on SQLite writes:** Use the async pattern — spawn the persist as a background task or use a sync connection (hive_tick is already async but persistence calls are sync in this codebase; match the homeostasis pattern).
- **Replacing the classifier:** Prediction errors are ADDITIVE to the emotion classifier, not a replacement. Both `update_physiology_from_classifier` and `update_physiology_from_prediction_errors` must run; the pituitary blend already handles multi-source hormone inputs.
- **Using `&text[..n]` for signal extraction:** Use `crate::safe_slice(text, max_chars)` per CLAUDE.md. Signal names and summaries may contain non-ASCII.
- **Duplicate `#[tauri::command]` names:** If Phase 28 exposes commands, verify no naming collision with existing commands in any module (Tauri's macro namespace is flat per CLAUDE.md).
- **Double quotes inside execute_batch SQL:** Per CLAUDE.md pitfall — use single quotes in SQL strings inside `execute_batch!`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signal smoothing | Custom filter | EMA at α=0.05 (existing homeostasis pattern) | Already proven stable; consistent with classifier channel |
| Prediction persistence | Custom serialization | serde_json + settings table / OR dedicated table | Exact pattern in homeostasis.rs load/persist functions |
| Hormone update | Direct field mutation | `update_physiology_from_prediction_errors()` (same α smoothing as classifier) | Consistent smoothing prevents oscillation |
| Dream task timeout | Manual timeout logic | `run_task!` macro in dream_mode.rs | Macro handles 120s timeout + DREAMING check + events |
| Doctor signal | Custom cache | `DoctorSignal` + `LAST_RUN` cache via `last_run_cache()` | Signal transition detection and event emission already wired |
| Eval harness | Custom test runner | `evals::harness::{print_eval_table, summarize, EvalRow}` | Existing harness writes history.jsonl, compute `record_eval_run` |

**Key insight:** Every infrastructure concern (smoothing, persistence, dream timing, eval harness) is already solved by Phases 23-27. Phase 28 is composition, not construction.

## Common Pitfalls

### Pitfall 1: Calendar Tentacle Does Not Exist in hive.rs

**What goes wrong:** The CONTEXT refers to a "calendar tentacle" as a primary demo signal, but `poll_tentacle()` in hive.rs has NO calendar arm. There is no `"calendar"` case in the match — calendar data lives in `integration_bridge.rs` via `poll_calendar()`, not in the Hive mesh.

**Why it happens:** The integration_bridge polls calendar separately from the Hive. The Hive tentacles are: email, slack, discord, discord_deep, whatsapp, github, ci, linear, jira, backend, logs, cloud.

**How to avoid:** For the demo loop (AINF-04), use the Slack tentacle (which DOES exist) for the Slack half, and either: (a) extract calendar data from integration_bridge state during the prediction pass, OR (b) create a synthetic `TentacleReport` with platform="calendar" for the demo fixture but note it's a virtual tentacle. The planner should resolve this: calendar is not a real Hive tentacle; the prediction state for calendar should be seeded from `integration_bridge::get_integration_state().upcoming_events`.

**Warning signs:** If the plan creates a `poll_tentacle("calendar")` arm, it's duplicating integration_bridge functionality.

### Pitfall 2: Sustained Error Tracking Requires Tick Counter

**What goes wrong:** D-07 says "sustained high aggregate error (>0.6 across 3+ tentacles for 2+ ticks)" — but `update_physiology_from_prediction_errors()` only receives the current tick's aggregate value. It needs memory of prior ticks to implement "sustained."

**Why it happens:** The function signature needs a tick counter or rolling history, not just the single-tick value.

**How to avoid:** Add a `sustained_high_ticks: AtomicU32` static counter (same pattern as `ADRENALINE_SPIKE_AT` AtomicI64 in homeostasis.rs line 636). Increment when aggregate > 0.6, reset when below. Check `>= 2` before raising cortisol.

**Warning signs:** If the plan passes only `aggregate_error: f32` to the update function, the sustained-error logic cannot be implemented.

### Pitfall 3: Doctor Signal Exhaustiveness Test Will Fail

**What goes wrong:** `suggested_fix_table_is_exhaustive` test (doctor.rs line 1146) iterates ALL SignalClass variants and all Severity levels. Adding `SignalClass::ActiveInference` without adding 3 suggested_fix strings (Green/Amber/Red) will break this test.

**Why it happens:** The test at line 1148-1163 is exhaustive — it uses an explicit array. Phase 27 added Hormones (3 arms) and updated the comment to "8×3 = 24". Phase 28 adds ActiveInference (3 arms) → "9×3 = 27". Both the match arms and the test array must be updated simultaneously.

**How to avoid:** In the same task that adds `SignalClass::ActiveInference`, also add all 3 suggested_fix arms and update the test's class array.

### Pitfall 4: dream_mode Task Order Affects Replay Usefulness

**What goes wrong:** If prediction_replay runs AFTER skill_from_trace, the replay results cannot inform which skills to generate. D-12 says "replay informs what traces to generate skills from."

**How to avoid:** Insert `prediction_replay` BEFORE `skill_prune` (position 5 in the current 10-task sequence). This ensures high-error memories are consolidated before the skill lifecycle tasks run.

### Pitfall 5: prediction_error_log FIFO Pruning Must Be Done Before Writes

**What goes wrong:** D-19 caps prediction_error_log at 1000 rows with FIFO pruning. If pruning runs AFTER insert, a rapid burst of ticks could exceed 1000 before the prune fires.

**How to avoid:** Prune first (DELETE WHERE rowid NOT IN (SELECT rowid FROM prediction_error_log ORDER BY timestamp DESC LIMIT 999)), then insert. Or use a single SQL REPLACE that lets the cap handle naturally.

### Pitfall 6: OnceLock Init Race on First Tick

**What goes wrong:** If `predictions_store()` is called from `hive_tick()` before the module has been initialized (i.e., before `start_active_inference()` is called from lib.rs setup), the OnceLock will initialize with `load_predictions_from_db()` returning None → `unwrap_or_default()` giving cold-start defaults. This is actually CORRECT behavior — it's the designed cold-start path.

**How to avoid:** No explicit initialization call is needed. The OnceLock pattern is self-initializing on first access. Do NOT add a `start_active_inference()` call to lib.rs unless exposing background polling (which Phase 28 does not need — it's hive_tick-driven).

**Warning signs:** If a plan task adds `active_inference::start_active_inference(app)` to the lib.rs setup, that's unnecessary complexity.

## Code Examples

### Struct Design (TentaclePrediction)

```rust
// Informed by: D-02, D-15 decisions; verified EMA pattern in homeostasis.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalExpectation {
    pub expected: f32,       // EMA-updated expected value
    pub confidence: f32,     // 0.0–1.0; increases as variance decreases
    pub range_max: f32,      // historical max (used for normalization)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentaclePrediction {
    pub platform: String,
    pub signals: HashMap<String, SignalExpectation>,
    pub updated_at: i64,
}

// Cold-start defaults per D-17
fn default_prediction(platform: &str) -> TentaclePrediction {
    let signals = match platform {
        "calendar" => [
            ("event_count", 3.0, 10.0),
            ("free_slots",  2.0,  8.0),
            ("meeting_hours", 2.0, 8.0),
        ].iter().map(|(k, v, m)| (k.to_string(), SignalExpectation {
            expected: *v, confidence: 0.1, range_max: *m,
        })).collect(),
        "slack" => [
            ("unread_count",  5.0, 50.0),
            ("mention_count", 1.0, 20.0),
            ("backlog_size",  3.0, 30.0),
        ].iter().map(|(k, v, m)| (k.to_string(), SignalExpectation {
            expected: *v, confidence: 0.1, range_max: *m,
        })).collect(),
        "github" => [
            ("open_prs",          2.0, 20.0),
            ("review_requests",   1.0, 10.0),
            ("ci_failures",       0.0,  5.0),
        ].iter().map(|(k, v, m)| (k.to_string(), SignalExpectation {
            expected: *v, confidence: 0.1, range_max: *m,
        })).collect(),
        _ => HashMap::new(),
    };
    TentaclePrediction { platform: platform.to_string(), signals, updated_at: 0 }
}
```

### Signal Extraction from TentacleReport.details

```rust
// Source: informed by actual TentacleReport.details shapes verified in hive.rs
// Slack report.details example: {"mentions": 15, "source": "slack_mcp", "previews": [...]}
// GitHub report.details: {"count": N, "open_prs": [...], "source": "github_api"}

fn extract_signals_slack(details: &serde_json::Value) -> HashMap<String, f32> {
    let mut signals = HashMap::new();
    // "mentions" field from both MCP and integration_bridge paths
    if let Some(v) = details.get("mentions").and_then(|v| v.as_f64()) {
        signals.insert("mention_count".to_string(), v as f32);
    }
    // "unread_count" may be under different keys depending on source
    if let Some(v) = details.get("unread_count").or_else(|| details.get("count"))
                             .and_then(|v| v.as_f64()) {
        signals.insert("unread_count".to_string(), v as f32);
    }
    signals
}
```

### Normalization Function

```rust
// Error in [0.0, 1.0]; per D-04
fn normalize_error(expected: f32, observed: f32, range_max: f32) -> f32 {
    let range = range_max.max(1.0); // prevent div by zero
    ((expected - observed).abs() / range).min(1.0)
}

// Weighted mean across signals in a TentaclePrediction
fn prediction_error_for_tentacle(
    pred: &TentaclePrediction,
    observed: &HashMap<String, f32>,
) -> f32 {
    let mut total = 0.0f32;
    let mut count = 0u32;
    for (signal, obs_val) in observed {
        if let Some(exp) = pred.signals.get(signal) {
            let err = normalize_error(exp.expected, *obs_val, exp.range_max);
            total += err * exp.confidence; // weight by confidence
            count += 1;
        }
    }
    if count == 0 { 0.0 } else { total / count as f32 }
}
```

### Demo Loop Eval Fixture (deterministic)

```rust
// Source: pattern from hormone_eval.rs (lines 53-129) and D-10
fn fixture_ainf04_demo_loop() -> (bool, String) {
    // Build synthetic TentacleReport for calendar-packed state
    let calendar_report = crate::hive::TentacleReport {
        id: "test-cal".to_string(),
        tentacle_id: "tentacle-calendar".to_string(),
        timestamp: 0,
        priority: crate::hive::Priority::High,
        category: "update".to_string(),
        summary: "8 events, no free slots".to_string(),
        details: serde_json::json!({
            "event_count": 8,
            "free_slots": 0,
            "meeting_hours": 6.0
        }),
        requires_action: false,
        suggested_action: None,
        processed: false,
    };

    let slack_report = crate::hive::TentacleReport { /* ... mentions: 15, backlog_size: 20 */ };

    // Run 3 ticks of prediction error computation
    for _ in 0..3 {
        crate::active_inference::process_reports_for_test(&[calendar_report.clone(), slack_report.clone()]);
    }

    let physiology = crate::homeostasis::get_physiology();
    let cortisol_elevated = physiology.cortisol > 0.3;
    (cortisol_elevated, format!("cortisol={:.3}", physiology.cortisol))
}
```

### SQLite Table Schema (db.rs additions)

```sql
-- Per D-19 — tentacle_predictions
CREATE TABLE IF NOT EXISTS tentacle_predictions (
    platform TEXT PRIMARY KEY,
    data     TEXT NOT NULL,      -- JSON-serialized TentaclePrediction
    updated_at INTEGER NOT NULL
);

-- Per D-19 — prediction_error_log (capped at 1000 rows via FIFO)
CREATE TABLE IF NOT EXISTS prediction_error_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    platform       TEXT NOT NULL,
    aggregate_error REAL NOT NULL,
    top_signal     TEXT NOT NULL DEFAULT '',
    timestamp      INTEGER NOT NULL
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single hormone input (emotion classifier only) | Two parallel hormone inputs (classifier + prediction errors) | Phase 28 | BLADE now responds to both its own output quality AND external world-state mismatch |
| Memory replay is uniform | Memory replay weighted by prediction error (high-error events replayed first) | Phase 28 | BLADE's hippocampal analog prioritizes surprising events for consolidation |
| Static tentacle expectations | EMA-learned predictions per tentacle | Phase 28 | After ~10 observations, BLADE's expectations match the user's actual environment patterns |

**Deprecated/outdated:**
- Nothing deprecated in this phase — Phase 28 is purely additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Calendar tentacle is not a real Hive tentacle — it lives in integration_bridge.rs | Pitfall 1 | If someone adds a "calendar" arm to poll_tentacle() concurrently, the demo loop design changes |
| A2 | The "backlog_size" Slack signal can be inferred from the total unread minus mentions | Code Examples (signal extraction) | If backlog_size is not derivable from existing Slack report fields, a third Slack API call is needed |
| A3 | Adding `task_prediction_replay()` at position 5 (after skill_synthesis, before skill_prune) does not violate any task dependency within dream_mode | Architecture Patterns (dream task order) | Low risk — dream tasks are independent; the macro handles timeout/abort for each |

## Open Questions

1. **Calendar tentacle gap**
   - What we know: integration_bridge.rs has `poll_calendar()` returning `Vec<CalendarEvent>` with title, start_ts, minutes_until. IntegrationState has `upcoming_events: Vec<CalendarEvent>`.
   - What's unclear: Should the prediction pass read from `integration_bridge::get_integration_state().upcoming_events` to derive event_count/free_slots/meeting_hours? Or should the planner add a minimal "calendar" tentacle arm to hive.rs?
   - Recommendation: Read from integration_bridge state in the active_inference extraction function. This avoids adding a new Hive tentacle while still computing calendar predictions.

2. **"backlog_size" for Slack**
   - What we know: Existing Slack TentacleReport.details has `mentions` count from both MCP and fallback paths.
   - What's unclear: D-02 specifies `{unread_count, mention_count, backlog_size}` for Slack but current reports only expose `mentions`. `backlog_size` may need to be a derived metric (e.g., unread messages from integration_bridge + MCP) or the field name in the prediction struct should match what's actually available.
   - Recommendation: Use `mentions` as `mention_count`, derive `unread_count` from integration_bridge state, and treat `backlog_size` as the total mentions (merge the two or make backlog_size = unread_count for now). Leave a comment noting the simplification.

3. **Tauri command exposure for active_inference_get_state**
   - What we know: Doctor pane calls `compute_active_inference_signal()` internally. DoctorPane UI reads via `doctor_run_full_check`.
   - What's unclear: Is a dedicated `active_inference_get_state` Tauri command needed for any frontend surface beyond DoctorPane?
   - Recommendation: No separate command needed for Phase 28. DoctorPane integration covers AINF requirement D-18. Add only if a dedicated UI panel is planned.

## Environment Availability

This phase has no external dependencies beyond the existing Rust toolchain and SQLite. All required capabilities (rusqlite, serde_json, tokio, chrono) are already in Cargo.toml.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| cargo | Build + eval | ✓ | (project existing) | — |
| rusqlite | SQLite tables | ✓ | (project existing) | — |
| chrono | Timestamps | ✓ | (project existing) | — |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust `cargo test` + custom eval harness (`evals::harness`) |
| Config file | `src-tauri/Cargo.toml` (existing) |
| Quick run command | `cd src-tauri && cargo test --lib evals::active_inference_eval --quiet -- --nocapture --test-threads=1` |
| Full suite command | `npm run verify:inference` (new script, follows verify-hormone.sh pattern) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AINF-01 | TentaclePrediction struct initialized with cold-start defaults per platform | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf01` | ❌ Wave 0 |
| AINF-02 | normalize_error returns value in [0.0, 1.0]; weighted mean across signals | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf02` | ❌ Wave 0 |
| AINF-03 | After 2+ ticks with aggregate_error > 0.6, cortisol and norepinephrine are elevated | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf03` | ❌ Wave 0 |
| AINF-04 | Demo loop: synthetic calendar+Slack → cortisol > 0.3 after 3 ticks | integration (deterministic) | `cargo test --lib evals::active_inference_eval -- fixture_ainf04` | ❌ Wave 0 |
| AINF-05 | prediction_replay task queries error log, returns count of replayed events > 0 when high-error records exist | unit (SQLite fixture) | `cargo test --lib evals::active_inference_eval -- fixture_ainf05` | ❌ Wave 0 |
| AINF-06 | After 5 observations, EMA-updated expected value converges toward observed (error decreases) | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf06` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo check` (batch, not after every edit per CLAUDE.md)
- **Per wave merge:** `cd src-tauri && cargo test --lib evals::active_inference_eval -- --nocapture --test-threads=1`
- **Phase gate:** `npm run verify:all` (full verify chain) + `npx tsc --noEmit` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/src/evals/active_inference_eval.rs` — covers AINF-01..06 (6 fixtures, 1 per requirement)
- [ ] `src-tauri/src/evals/mod.rs` — add `pub mod active_inference_eval;` line
- [ ] `src-tauri/src/active_inference.rs` — stub with public API (TentaclePrediction, compute_prediction_errors, get_active_inference_state) to unblock eval compilation
- [ ] `scripts/verify-inference.sh` — Gate 36 script (follows verify-hormone.sh pattern verbatim)
- [ ] `package.json` — add `"verify:inference": "bash scripts/verify-inference.sh"` and append to `verify:all` chain

## Security Domain

Phase 28 is a pure internal Rust module. No network calls, no user input handling, no credentials. All data flows from existing TentacleReport payloads (already handled by hive.rs security surface) and writes only to local SQLite. No new ASVS threat surface introduced.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | minimal | prediction error values clamped to [0.0, 1.0] |
| V6 Cryptography | no | — |

The only validation concern: prediction signal values extracted from TentacleReport.details should be clamped (`.clamp(0.0, range_max)`) before error computation to prevent a malformed report from producing out-of-range errors.

## Project Constraints (from CLAUDE.md)

- **Module registration:** `mod active_inference;` in lib.rs. If exposing Tauri commands, add to `generate_handler![]`.
- **6-place config rule:** No new BladeConfig fields needed for Phase 28. All state is in SQLite or OnceLock.
- **`use tauri::Manager;`** — required if `app.state()` is used anywhere in active_inference.rs.
- **No `&text[..n]`** — use `crate::safe_slice(text, max_chars)` for any string slicing.
- **No duplicate command names** — verify before adding any `#[tauri::command]`.
- **Batch cargo check** — do not run `cargo check` after each individual edit.
- **Verification protocol** — UAT evidence (dev server + screenshot) required before any "phase complete" claim, but this is a backend-only phase; the DoctorPane UI surface (existing) showing the new signal row is the evidence surface.
- **No Co-Authored-By** in commits.

## Sources

### Primary (HIGH confidence)
- `src-tauri/src/homeostasis.rs` — verified PhysiologicalState, OnceLock pattern, update_physiology_from_classifier, EMA smoothing, persist_physiology_to_db, pituitary functions
- `src-tauri/src/hive.rs` — verified TentacleReport struct, hive_tick() full implementation (lines 2231-2617), poll_tentacle() per-platform shapes, hook insertion point
- `src-tauri/src/dream_mode.rs` — verified run_dream_session() task order, run_task! macro pattern, DREAMING AtomicBool checkpoint
- `src-tauri/src/doctor.rs` — verified SignalClass enum, compute_hormones_signal() pattern, doctor_run_full_check() tokio::join!, suggested_fix_table_is_exhaustive test
- `src-tauri/src/db.rs` — verified run_migrations() execute_batch pattern, settings key-value store
- `src-tauri/src/evals/hormone_eval.rs` — verified eval fixture structure, harness imports, MODULE_FLOOR constant
- `scripts/verify-hormone.sh` — verified gate script pattern for Phase 28 to replicate
- `src-tauri/src/integration_bridge.rs` — verified CalendarEvent struct, poll_calendar() data shape, IntegrationState fields

### Secondary (MEDIUM confidence)
- `.planning/phases/28-active-inference-loop/28-CONTEXT.md` — locked decisions D-01..D-19 from user discussion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all patterns verified in live code
- Architecture: HIGH — hook positions, struct shapes, and integration points all verified by reading the actual files
- Pitfalls: HIGH — calendar tentacle gap is a VERIFIED codebase fact (no "calendar" arm in poll_tentacle); other pitfalls are derived from established patterns

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (stable substrate; changes only if hive.rs or homeostasis.rs are refactored)
