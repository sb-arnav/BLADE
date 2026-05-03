# Phase 25: Metacognitive Controller - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 5 (3 Rust extensions + 1 TypeScript file + 1 TypeScript type file)
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src-tauri/src/metacognition.rs` | service (extend) | CRUD + event-driven | `src-tauri/src/homeostasis.rs` (OnceLock state) + `src-tauri/src/metacognition.rs` itself (solution_memory pattern) | exact |
| `src-tauri/src/reasoning_engine.rs` | service (extend) | transform + event-driven | `src-tauri/src/reasoning_engine.rs::reason_through` (step loop already there) | exact |
| `src-tauri/src/doctor.rs` | service (extend) | request-response | `src-tauri/src/doctor.rs::compute_reward_signal` (Phase 23 RewardTrend precedent) | exact |
| `src/features/admin/DoctorPane.tsx` | component (extend) | request-response | `src/features/admin/DoctorPane.tsx` itself (Phase 23 RewardTrend append precedent) | exact |
| `src/lib/tauri/admin.ts` | utility (extend) | request-response | `src/lib/tauri/admin.ts` itself (SignalClass union, lines 1826–1832) | exact |

---

## Pattern Assignments

### `src-tauri/src/metacognition.rs` (service, CRUD + state)

**Analogs:** `src-tauri/src/homeostasis.rs` (lines 93–106, 666–688), `src-tauri/src/metacognition.rs` (lines 273–311)

#### Global state holder pattern (copy from `homeostasis.rs` lines 93–106)

```rust
// homeostasis.rs lines 93-106
static HORMONES: OnceLock<Mutex<HormoneState>> = OnceLock::new();

fn hormone_store() -> &'static Mutex<HormoneState> {
    HORMONES.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}

pub fn get_hormones() -> HormoneState {
    hormone_store().lock().map(|h| h.clone()).unwrap_or_default()
}
```

Apply as:
```rust
static META_STATE: OnceLock<Mutex<MetacognitiveState>> = OnceLock::new();

fn meta_store() -> &'static Mutex<MetacognitiveState> {
    META_STATE.get_or_init(|| Mutex::new(load_meta_state().unwrap_or_default()))
}

pub fn get_state() -> MetacognitiveState {
    meta_store().lock().map(|s| s.clone()).unwrap_or_default()
}
```

#### DB persistence pattern — settings table upsert (copy from `homeostasis.rs` lines 666–688)

```rust
// homeostasis.rs lines 666-688
fn load_from_db() -> Option<HormoneState> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let json: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'homeostasis'",
        [],
        |row| row.get(0),
    ).ok()?;
    serde_json::from_str(&json).ok()
}

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
```

Apply with key `'metacognitive_state'` instead of `'homeostasis'`.

#### SQLite gap log table + insert pattern (copy from `metacognition.rs` lines 273–311)

```rust
// metacognition.rs lines 273-311 — solution_memory pattern
pub fn remember_solution(problem: &str, solution: &str, tools_used: &[String]) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS solution_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                problem_hash TEXT NOT NULL,
                ...
                created_at INTEGER NOT NULL,
                last_used INTEGER NOT NULL
            );"
        );
        // ... parameterized INSERT
        let _ = conn.execute(
            "INSERT INTO solution_memory (...) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            rusqlite::params![..., crate::safe_slice(problem, 200), ...],
        );
    }
}
```

For `ensure_gap_log_table()`, use the same `conn.execute_batch(...)` + single-connection pattern. For `log_gap()`, open a new connection per call (same as `remember_solution`). Always use `rusqlite::params![]` — never string interpolation in SQL. Always wrap user strings with `crate::safe_slice(topic, 120)`.

#### `evolution_log_capability_gap` call site (copy from `evolution.rs` lines 1115–1134)

```rust
// evolution.rs lines 1115-1134 — function signature
pub fn evolution_log_capability_gap(capability: String, user_request: String) -> String
```

Call after the SQLite gap-log INSERT succeeds:
```rust
let _ = crate::evolution::evolution_log_capability_gap(
    topic.to_string(),
    user_request.to_string(),
);
```

The return value is a suggested message string — it can be discarded with `let _`.

---

### `src-tauri/src/reasoning_engine.rs` (service, transform — confidence-delta extension)

**Analog:** `src-tauri/src/reasoning_engine.rs` itself, specifically the step loop in `reason_through` (lines 624–693)

#### Step loop integration point (lines 624–693)

```rust
// reasoning_engine.rs lines 624-693 — the loop to extend
let mut steps: Vec<ReasoningStep> = Vec::new();
let mut step_num = 1i32;

for sub_problem in &sub_problems {
    let mut step = analyze_step(&full_question, sub_problem, &steps, step_num).await;
    let critiques = critique_step(&step, &full_question).await;
    step.critiques = critiques.clone();
    if step.confidence < 0.6 || !critiques.is_empty() {
        let revised = revise_step(&step, &critiques).await;
        step.revised = Some(revised);
    }
    steps.push(step.clone());
    // ... emit step event
    step_num += 1;
}

let (final_answer, total_confidence) = synthesize_answer(&full_question, &steps).await;
```

**Extension points (add these to the loop body):**

1. After `steps.push(step.clone())`, before `step_num += 1`:
```rust
// META-01: confidence-delta detection
if let Some(prior_step) = steps.iter().rev().nth(1) {
    let delta = prior_step.confidence - step.confidence; // positive = dropped
    if delta > 0.3 {
        any_uncertainty_flag = true;
        crate::metacognition::record_uncertainty_marker(
            &step.thought,
            delta,
        );
    }
}
```

2. After `synthesize_answer` call, before saving trace:
```rust
// META-02 / META-03: secondary verifier + initiative phrasing
if any_uncertainty_flag || total_confidence < 0.5 {
    // gate prevents verifier on every response
}
```

**Cheap LLM call pattern** (copy from `decision_gate.rs` lines 274–318):

```rust
// decision_gate.rs lines 274-318 — cheap_model_for_provider + complete_turn
async fn llm_classify(...) -> Option<DecisionOutcome> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return None;
    }
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    // ...
    let msgs = vec![
        crate::providers::ConversationMessage::System(system_prompt.to_string()),
        crate::providers::ConversationMessage::User(user_prompt),
    ];
    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &msgs,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .ok()?;
    let response = turn.content.trim().to_string();
    // parse response...
}
```

Apply to the secondary verifier call:
```rust
async fn secondary_verifier_call(question: &str, answer: &str, concerns: &[String]) -> (bool, String) {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return (true, String::new()); // fail open — don't block chat on missing key
    }
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let system = "You are a strict answer verifier. Return JSON only: \
                  {\"verified\": true/false, \"concern\": \"one sentence if not verified\"}";
    let user_msg = format!(
        "Question: {}\nProposed answer: {}\nConcerns: {}",
        question, answer, concerns.join("; ")
    );
    let msgs = vec![
        crate::providers::ConversationMessage::System(system.to_string()),
        crate::providers::ConversationMessage::User(user_msg),
    ];
    let turn = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &msgs,
        &[],
        config.base_url.as_deref(),
    )
    .await
    .ok();
    // parse JSON from turn.content; return (verified, concern)
}
```

---

### `src-tauri/src/doctor.rs` (service, extend — new SignalClass arm)

**Analog:** `src-tauri/src/doctor.rs::compute_reward_signal` (lines 344–466) — Phase 23 RewardTrend precedent

#### SignalClass enum — how Phase 23 added a new variant (lines 34–41)

```rust
// doctor.rs lines 34-41 — Phase 23 added RewardTrend at the bottom
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
    RewardTrend,  // Phase 23 / REWARD-04 — D-23-04 LOCKED
    // ADD: Metacognitive — Phase 25
}
```

#### suggested_fix exhaustive match — pattern for adding 3 arms (lines 92–141)

```rust
// doctor.rs lines 92-141 — MUST add all three severity arms together
// (Amber+Green+Red or cargo check fails)
pub(crate) fn suggested_fix(class: SignalClass, severity: Severity) -> &'static str {
    match (class, severity) {
        // ... existing arms ...
        (SignalClass::RewardTrend, Severity::Green)  => "...",
        (SignalClass::RewardTrend, Severity::Amber)  => "...",
        (SignalClass::RewardTrend, Severity::Red)    => "...",
        // ADD three Metacognitive arms here
    }
}
```

#### emit_activity_for_doctor exhaustive match (lines 909–917)

```rust
// doctor.rs lines 909-917 — MUST add the new arm here too
fn emit_activity_for_doctor(app: &AppHandle, signal: &DoctorSignal) {
    let class_str = match signal.class {
        SignalClass::EvalScores      => "EvalScores",
        SignalClass::CapabilityGaps  => "CapabilityGaps",
        SignalClass::TentacleHealth  => "TentacleHealth",
        SignalClass::ConfigDrift     => "ConfigDrift",
        SignalClass::AutoUpdate      => "AutoUpdate",
        SignalClass::RewardTrend     => "RewardTrend",
        // ADD: SignalClass::Metacognitive => "Metacognitive",
    };
    // ...
}
```

#### compute_reward_signal — pattern to copy for compute_metacognitive_signal (lines 344–466)

```rust
// doctor.rs lines 344-466 — canonical compute_*_signal structure
fn compute_reward_signal() -> Result<DoctorSignal, String> {
    let history = read_reward_history_for_doctor(2000);
    let now_ms = chrono::Utc::now().timestamp_millis();

    if history.is_empty() {
        return Ok(DoctorSignal {
            class: SignalClass::RewardTrend,
            severity: Severity::Green,
            payload: serde_json::json!({ "note": "..." }),
            last_changed_at: now_ms,
            suggested_fix: suggested_fix(SignalClass::RewardTrend, Severity::Green).to_string(),
        });
    }

    // ... severity logic ...

    Ok(DoctorSignal {
        class: SignalClass::RewardTrend,
        severity,
        payload: serde_json::json!({ ... }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::RewardTrend, severity).to_string(),
    })
}
```

Apply for `compute_metacognitive_signal`:
```rust
fn compute_metacognitive_signal() -> Result<DoctorSignal, String> {
    let state = crate::metacognition::get_state();
    let now_ms = chrono::Utc::now().timestamp_millis();

    let severity = if state.gap_count >= 3 {
        Severity::Red
    } else if state.gap_count >= 1 || state.uncertainty_count >= 5 {
        Severity::Amber
    } else {
        Severity::Green
    };

    Ok(DoctorSignal {
        class: SignalClass::Metacognitive,
        severity,
        payload: serde_json::json!({
            "confidence": state.confidence,
            "uncertainty_count": state.uncertainty_count,
            "gap_count": state.gap_count,
            "last_updated": state.last_updated,
        }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::Metacognitive, severity).to_string(),
    })
}
```

#### doctor_run_full_check tokio::join! extension (lines 951–1004)

```rust
// doctor.rs lines 951-974 — Phase 23 added reward_trend as 6th source
let (eval, capgap, tentacle, drift, autoupdate, reward_trend) = tokio::join!(
    async { compute_eval_signal() },
    async { compute_capgap_signal() },
    async { compute_tentacle_signal() },
    async { compute_drift_signal() },
    async { compute_autoupdate_signal() },
    async { compute_reward_signal() },
);
let signals: Vec<DoctorSignal> = vec![
    eval.map_err(|e| format!("eval signal: {}", e))?,
    // ... all 6 ...
    reward_trend.map_err(|e| format!("reward_trend signal: {}", e))?,
];
```

Add `metacognitive` as a 7th source with the same pattern.

#### suggested_fix_table_is_exhaustive test (lines 1064–1081)

```rust
// doctor.rs lines 1064-1081 — must add SignalClass::Metacognitive to this test array
for class in [
    SignalClass::EvalScores,
    SignalClass::CapabilityGaps,
    SignalClass::TentacleHealth,
    SignalClass::ConfigDrift,
    SignalClass::AutoUpdate,
    SignalClass::RewardTrend,
    // ADD: SignalClass::Metacognitive,
] { ... }
```

Also update the comment count: `6×3 + 3 = 21` (was `5×3 + 3 = 18`).

---

### `src/features/admin/DoctorPane.tsx` (component, extend — DISPLAY_NAME + ROW_ORDER)

**Analog:** `src/features/admin/DoctorPane.tsx` itself, Phase 23 RewardTrend append (lines 40–58)

#### DISPLAY_NAME extension (lines 40–47)

```typescript
// DoctorPane.tsx lines 40-47 — Phase 23 added reward_trend at the bottom
const DISPLAY_NAME: Record<SignalClass, string> = {
  eval_scores: 'Eval Scores',
  capability_gaps: 'Capability Gaps',
  tentacle_health: 'Tentacle Health',
  config_drift: 'Config Drift',
  auto_update: 'Auto-Update',
  reward_trend: 'Reward Trend',
  // ADD: metacognitive: 'Metacognitive',
};
```

#### ROW_ORDER extension (lines 51–58)

```typescript
// DoctorPane.tsx lines 51-58 — Phase 23 appended reward_trend at tail
const ROW_ORDER: SignalClass[] = [
  'eval_scores',
  'capability_gaps',
  'tentacle_health',
  'config_drift',
  'auto_update',
  'reward_trend',
  // ADD: 'metacognitive',   ← append at tail (least volatile)
];
```

#### rowRefs useMemo (lines 126–136)

```typescript
// DoctorPane.tsx lines 126-136 — Phase 23 added reward_trend entry here too
const rowRefs = useMemo(() => {
  const map: Record<SignalClass, React.RefObject<HTMLButtonElement>> = {
    eval_scores: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
    // ...
    reward_trend: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
    // ADD: metacognitive: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
  };
  return map;
}, []);
```

---

### `src/lib/tauri/admin.ts` (utility, extend — SignalClass union type)

**Analog:** `src/lib/tauri/admin.ts` lines 1826–1832

#### SignalClass union type (lines 1826–1832)

```typescript
// admin.ts lines 1826-1832 — Phase 23 added '| reward_trend'
export type SignalClass =
  | 'eval_scores'
  | 'capability_gaps'
  | 'tentacle_health'
  | 'config_drift'
  | 'auto_update'
  | 'reward_trend';
  // ADD: | 'metacognitive'
```

The comment block above this type (lines 1818–1824) must also note the new variant to keep the lockstep documentation accurate.

---

## Shared Patterns

### SQLite parameterized writes
**Source:** `src-tauri/src/metacognition.rs` lines 273–311, `src-tauri/src/doctor.rs` lines 484–582
**Apply to:** `metacognition.rs::log_gap`, `metacognition.rs::ensure_gap_log_table`

```rust
// Always use rusqlite::params![] — never string interpolation in SQL values
// Always wrap user content: crate::safe_slice(topic, 120)
let _ = conn.execute(
    "INSERT INTO table (col1, col2) VALUES (?1, ?2)",
    rusqlite::params![value1, crate::safe_slice(user_text, 300)],
);
```

### execute_batch for table creation
**Source:** `src-tauri/src/metacognition.rs` lines 275–286, `src-tauri/src/reasoning_engine.rs` lines 60–75
**Apply to:** `metacognition.rs::ensure_gap_log_table`

```rust
// reasoning_engine.rs lines 60-75 — canonical ensure_tables pattern
pub fn ensure_tables() -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path())
        .map_err(|e| format!("DB open: {}", e))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reasoning_traces (
            id TEXT PRIMARY KEY,
            ...
        );"
    ).map_err(|e| format!("DB schema: {}", e))?;
    Ok(())
}
// RULE: No double quotes inside the SQL string inside execute_batch (breaks macro)
```

### safe_slice for all user content
**Source:** `src-tauri/src/metacognition.rs` lines 209, 309, 333, 347; `CLAUDE.md`
**Apply to:** All user-facing strings going into SQLite or emitted events

```rust
crate::safe_slice(text, max_chars)  // always — never &text[..n]
```

### cheap_model_for_provider for secondary LLM calls
**Source:** `src-tauri/src/decision_gate.rs` lines 280–318
**Apply to:** `reasoning_engine.rs::secondary_verifier_call`

```rust
let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);
// Use this model, not the frontier model, for the verifier call
```

### blade_activity_log emit format (M-07 contract)
**Source:** `src-tauri/src/doctor.rs` lines 905–937
**Apply to:** `doctor.rs::emit_activity_for_doctor` (already handles Metacognitive once the class_str arm is added)

```rust
let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
    "module":        "Doctor",
    "action":        "regression_detected",
    "human_summary": crate::safe_slice(&summary, 200),
    "payload_id":    serde_json::Value::Null,
    "timestamp":     chrono::Utc::now().timestamp(),
}));
```

---

## No Analog Found

All files have close analogs in the codebase. No greenfield patterns required.

---

## Critical Pitfall Reminders (from RESEARCH.md — planner must include in task acceptance gates)

1. **Three exhaustive match sites in doctor.rs** — `suggested_fix`, `emit_activity_for_doctor`, and the `#[test] suggested_fix_table_is_exhaustive` test all need `Metacognitive` arms. Missing any one causes a compile error.

2. **rowRefs in DoctorPane.tsx** — the `useMemo` Record at lines 126–136 must include `metacognitive` alongside DISPLAY_NAME and ROW_ORDER. TypeScript will catch this if `SignalClass` is updated first.

3. **MetacognitiveState persistence** — use the settings-table upsert pattern from `homeostasis.rs` (key `'metacognitive_state'`). Without this, gap_count resets to zero on every restart and DoctorPane is always Green after reboot.

4. **Verifier gate** — the secondary verifier call must be behind `any_uncertainty_flag || total_confidence < 0.5`. Do NOT call it unconditionally or it adds LLM latency to every chat response.

5. **doctor_run_full_check unit test** — `doctor_run_full_check_returns_six_signals` at line 1683 currently asserts `len() == 6`. After adding Metacognitive, it must assert 7 and check `signals[6].class == SignalClass::Metacognitive`.

---

## Metadata

**Analog search scope:** `src-tauri/src/` (metacognition.rs, doctor.rs, reasoning_engine.rs, homeostasis.rs, decision_gate.rs, evolution.rs) + `src/features/admin/DoctorPane.tsx` + `src/lib/tauri/admin.ts`
**Files read:** 8 source files
**Pattern extraction date:** 2026-05-02
