# Phase 27: Hormone Physiology — Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 11 (7 modified + 1 new Rust + 3 new infra)
**Analogs found:** 11 / 11

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src-tauri/src/homeostasis.rs` (extend) | state-machine + service | event-driven + batch | itself (HormoneState/hypothalamus_tick) | exact — extend existing file |
| `src-tauri/src/commands.rs` (2 lines) | controller | request-response | itself (emotional_intelligence call site lines 1423-1430) | exact — same post-response bookkeeping pattern |
| `src-tauri/src/brain.rs` (~10 lines) | service | request-response | itself (safety_bundle injection lines 537-543) | exact — same `parts.push()` gate pattern |
| `src-tauri/src/evolution.rs` (~15 lines) | service | event-driven | itself (hormone gate lines 616-631) | exact — same `get_hormones()` gate pattern |
| `src-tauri/src/metacognition.rs` (~5 lines) | service | request-response | itself (assess_cognitive_state line 166) | exact — threshold adjustment inline |
| `src-tauri/src/doctor.rs` (extend) | service + config | request-response | itself (compute_metacognitive_signal lines 951-975) | exact — Phase 25 META-05 added Metacognitive the same way |
| `src-tauri/src/evals/hormone_eval.rs` (new) | test | batch | `src-tauri/src/evals/safety_eval.rs` | exact — same eval harness pattern |
| `src-tauri/src/evals/mod.rs` (1 line) | config | — | itself (line 19 `safety_eval` registration) | exact |
| `scripts/verify-hormone.sh` (new) | utility | — | `scripts/verify-safety.sh` | exact copy-and-adapt |
| `src/lib/tauri/admin.ts` (1 line) | type | — | itself (lines 1827-1834 SignalClass union) | exact |
| `src/features/admin/DoctorPane.tsx` (2 lines) | component | — | itself (lines 40-61 DISPLAY_NAME + ROW_ORDER) | exact |

---

## Pattern Assignments

### `src-tauri/src/homeostasis.rs` — PhysiologicalState layer (extend)

**Analog:** itself — HormoneState struct, global, persistence, pituitary functions (lines 27-114, 674-758)

**Imports already present** (lines 19-21):
```rust
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
```
Also needed: `use tauri::Emitter;` — already imported at line 876.

**Core global singleton pattern** (lines 101-114 — copy verbatim, rename):
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
New version: replace `HORMONES` with `PHYSIOLOGY`, `HormoneState` with `PhysiologicalState`, `load_from_db` with `load_physiology_from_db`, `get_hormones` with `get_physiology`.

**HormoneState struct shape to mirror** (lines 27-99):
Each field has a doc comment explaining 0.0 and 1.0 poles and what affects it. `#[serde(default)]` on fields added later. `Default` impl sets non-zero baselines. Copy this pattern exactly for `PhysiologicalState`.

**Persistence pattern** (lines 674-696 — copy verbatim, change key string):
```rust
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
For physiology: change key from `'homeostasis'` to `'physiology'`. No schema migration needed — `settings` table already exists.

**Pituitary function shape to blend** (lines 735-758 — acth/oxytocin pattern):
```rust
pub fn acth() -> f32 {
    let h = get_hormones();
    let base = h.urgency * 0.5 + (1.0 - h.trust) * 0.3 + (1.0 - h.exploration) * 0.2;
    base.clamp(0.0, 1.0)
}
pub fn oxytocin() -> f32 {
    let h = get_hormones();
    let base = h.trust * 0.6 + (1.0 - h.urgency) * 0.3 + h.arousal * 0.1;
    base.clamp(0.0, 1.0)
}
```
Phase 27 extends these to blend in `get_physiology()` values. Pattern: `let p = get_physiology(); let blended = operational * 0.7 + p.cortisol * 0.3; blended.clamp(0.0, 1.0)`.

**ActivityStrip emission pattern** (doctor.rs lines 940-947):
```rust
let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
    "module":        "Doctor",
    "action":        "regression_detected",
    "human_summary": crate::safe_slice(&summary, 200),
    "payload_id":    serde_json::Value::Null,
    "timestamp":     chrono::Utc::now().timestamp(),
}));
```
For hormone threshold events: module = `"homeostasis.physiology"`, action = `"threshold_crossing"`. The `AppHandle` must be in scope — emit from `start_hypothalamus()` loop body, not from inside `get_physiology()`. See Pitfall 5 in RESEARCH.md.

**Decay pattern** (lines 347-354 — adrenaline spike/decay as structural reference):
```rust
let spike_at = ADRENALINE_SPIKE_AT.load(std::sync::atomic::Ordering::SeqCst);
let since_spike = now - spike_at;
state.adrenaline = if spike_at == 0 || since_spike > 300 {
    0.0
} else if since_spike < 60 {
    ...
```
Phase 27 uses the analytical form instead: `0.5f32.powf(elapsed / half_life)` with `.clamp(0.01, 1.0)` floor. No `AtomicI64` needed — `PhysiologicalState.last_updated: i64` carries the timestamp.

---

### `src-tauri/src/commands.rs` — classifier call site (2 lines)

**Analog:** lines 1423-1430 (emotional_intelligence call on user message):
```rust
{
    let emotion_msg = last_user_text.clone();
    let emotion_app = app.clone();
    tokio::spawn(async move {
        crate::emotional_intelligence::process_message_emotion(&emotion_msg, emotion_app).await;
    });
}
```

**New pattern** — post-response classifier call (insert after line 1781 `assistant_text` is bound):
```rust
// PHYSIOLOGY CLASSIFIER: classify BLADE's own output, update PhysiologicalState
if let Some(output) = crate::homeostasis::classify_response_emotion(&assistant_text) {
    crate::homeostasis::update_physiology_from_classifier(&output);
}
```
The variable `assistant_text` is defined at line 1781 as `clean_content.clone()`. This is the correct post-stream call site — the full response text is assembled, tags are cleaned, memory extraction runs here. Classifier must NOT run before this point (Pitfall 3 in RESEARCH.md: classifier on user input vs BLADE output). This is a synchronous call (no `tokio::spawn`) — classifier is <1ms pure Rust.

---

### `src-tauri/src/brain.rs` — cortisol modulation injection (~10 lines)

**Analog:** lines 537-543 (safety modulation injection at priority 2.5):
```rust
// ── SAFETY MODULATION (priority 2.5 — Phase 26 / SAFE-03, SAFE-05) ───────
let safety_mods = crate::safety_bundle::get_prompt_modulations();
for mod_text in safety_mods {
    if !mod_text.trim().is_empty() {
        parts.push(mod_text);
    }
}
```

**Core injection pattern** — cortisol modulation inserts AFTER the safety_mods block (line 543), BEFORE identity extension (line 545):
```rust
// ── CORTISOL MODULATION (priority 2.6 — Phase 27 / HORM-03) ─────────────
{
    let physio = crate::homeostasis::get_physiology();
    if physio.cortisol > 0.6 {
        parts.push("## Internal State\n\nHigh cortisol: be terse, action-focused, skip preamble. Respond in ≤2 sentences unless technical depth is required.".to_string());
    } else if physio.cortisol < 0.2 {
        parts.push("## Internal State\n\nLow cortisol: exploratory tone permitted. You may think aloud.".to_string());
    }
    // Oxytocin: warmth/personalization depth (HORM-07)
    if physio.oxytocin > 0.6 {
        parts.push("## Social Context\n\nHigh rapport: warm, personal tone appropriate.".to_string());
    }
}
```
Pattern: scoped block `{ }` wrapping the physiology read, matching the existing scoped blocks used for identity extension (lines 549-558) and personality mirror (lines 560-567).

---

### `src-tauri/src/evolution.rs` — dopamine + NE gate (~15 lines)

**Analog:** lines 609-631 (existing hormone gate at top of `run_evolution_cycle()`):
```rust
pub async fn run_evolution_cycle(app: &tauri::AppHandle) {
    let config = crate::config::load_config();
    if !config.background_ai_enabled { return; }

    // Pituitary GH: only grow capabilities when growth hormone is adequate.
    let gh = crate::homeostasis::growth_hormone();
    if gh < 0.3 { return; }

    // Leptin: skip evolution when knowledge-satiated
    let leptin = crate::homeostasis::get_hormones().leptin;
    if leptin > 0.8 { return; }

    // Insulin: skip if API budget is stressed
    let insulin = crate::homeostasis::get_hormones().insulin;
    if insulin > 0.7 { return; }
```

**New gate** — insert dopamine + NE gates AFTER insulin gate (line 631), before the `EVOLUTION_RUNNING` compare_exchange (line 634):
```rust
    // Dopamine: modulate exploration aggressiveness (HORM-04)
    let dopamine = crate::homeostasis::get_physiology().dopamine;
    // NE: novelty interrupt — high NE forces an exploration run (HORM-05)
    let ne = crate::homeostasis::get_physiology().norepinephrine;
    if ne > 0.6 {
        // High NE overrides normal GH gate — novelty-driven interrupt
        // (already past config/leptin/insulin guards above)
    } else if dopamine < 0.2 {
        return; // Low dopamine: conservative, skip speculative discovery
    }
```
The `ne > 0.6` branch intentionally does NOT return — it lets the cycle proceed even when `gh < 0.3` would normally block. The dopamine gate only fires in the `else` branch, so NE takes priority. Within the loop body, `dopamine < 0.2` should also gate `auto_install == true` entries (skip speculative installs, only surface token-gated suggestions).

---

### `src-tauri/src/metacognition.rs` — ACh threshold gate (~5 lines)

**Analog:** line 166 (`should_ask` threshold in `assess_cognitive_state()`):
```rust
let should_ask = confidence < 0.3 || (complexity > 0.8 && knowledge_score < 0.5);
```

**New pattern** — extend threshold based on acetylcholine (HORM-06). Replace line 166 with:
```rust
// ACh modulates verification threshold: high ACh → lower confidence threshold
// (more secondary checks), low ACh → standard threshold (HORM-06)
let ach = crate::homeostasis::get_physiology().acetylcholine;
let verify_threshold = if ach > 0.6 { 0.4_f32 } else { 0.3_f32 };
let should_ask = confidence < verify_threshold || (complexity > 0.8 && knowledge_score < 0.5);
```
This is a direct replacement of the existing hardcoded `0.3` with a computed threshold. The `ach` read is synchronous and cheap. No other changes to `assess_cognitive_state()`.

---

### `src-tauri/src/doctor.rs` — SignalClass::Hormones (extend)

**Analog:** the Phase 25 Metacognitive addition — exact same 7-step pattern (RESEARCH.md Pattern 8, verified from lines 34-42, 93-150, 951-975, 988-1013, 1104-1122).

**Step-by-step with exact line targets:**

**Step 1** — Add `Hormones` variant to `SignalClass` enum (line 42, after `Metacognitive`):
```rust
Hormones,    // Phase 27 / HORM-08
```

**Step 2** — Add 3 arms to `suggested_fix()` match (after line 150, after the `Metacognitive` arms):
```rust
(SignalClass::Hormones, Severity::Green) =>
    "Physiological hormone bus is stable. All 7 scalars within normal range. decay constants active.",
(SignalClass::Hormones, Severity::Amber) =>
    "One or more physiological hormones are elevated (cortisol >0.6 or NE >0.6). Check recent tool-call failure rate or error density in responses.",
(SignalClass::Hormones, Severity::Red) =>
    "Physiological state is dysregulated: cortisol and NE both elevated >0.7, or mortality_salience approaching cap. Review recent exchange quality and allow idle time for decay.",
```

**Step 3** — Add `compute_hormones_signal()` function (after `compute_metacognitive_signal()` at line 975, same shape):
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
        payload: serde_json::json!({
            "cortisol": p.cortisol,
            "dopamine": p.dopamine,
            "serotonin": p.serotonin,
            "acetylcholine": p.acetylcholine,
            "norepinephrine": p.norepinephrine,
            "oxytocin": p.oxytocin,
            "mortality_salience": p.mortality_salience,
        }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::Hormones, severity).to_string(),
    })
}
```

**Step 4** — Add to `tokio::join!` in `doctor_run_full_check()` (line 993-1001 — add `hormones` as 8th):
```rust
let (eval, capgap, tentacle, drift, autoupdate, reward_trend, metacognitive, hormones) = tokio::join!(
    async { compute_eval_signal() },
    ...
    async { compute_metacognitive_signal() },
    async { compute_hormones_signal() },
);
```

**Step 5** — Add to `signals` Vec (line 1006-1014, append after `metacognitive`):
```rust
hormones.map_err(|e| format!("hormones signal: {}", e))?,
```

**Step 6** — Update `suggested_fix_table_is_exhaustive` test (line 1104-1122): add `SignalClass::Hormones` to the array and update comment from `7×3=21` to `8×3=24`.

**Step 7** — No separate `signals.len()` assertion found in current code (check for it before adding a new assertion).

---

### `src-tauri/src/evals/hormone_eval.rs` (new file)

**Analog:** `src-tauri/src/evals/safety_eval.rs` — entire file is the template (lines 1-403).

**Header block to copy** (lines 1-27, adapt phase/module references):
```rust
//! Phase 27 / HORM-01..09 -- Deterministic hormone physiology eval.
//!
//! MODULE_FLOOR = 0.95 (95% required -- decay constants are tuneable)
//! ...
//! ## No LLM involvement
//! All fixtures are deterministic. Pure function calls to homeostasis public API.
//! ## No SQLite involvement (except HORM-08 persistence fixture)
//! HORM-08 uses temp_blade_env() from harness.rs; all other fixtures hermetic.
//! ## Run
//! `cargo test --lib evals::hormone_eval -- --nocapture --test-threads=1`
```

**Fixture struct pattern** (lines 60-64):
```rust
struct HormoneFixture {
    label: &'static str,
    class: ScenarioClass,
    expected: ExpectedOutcome,
}
```

**Test entry pattern** (lines 349-403 — copy structure exactly):
```rust
#[test]
fn evaluates_hormone_physiology() {
    let cases = fixtures();
    assert!(cases.len() >= 7 && cases.len() <= 15, ...);
    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    for fx in &cases { ... }
    print_eval_table("Hormone physiology eval", &rows);
    let s = summarize(&rows);
    super::harness::record_eval_run(MODULE_NAME, &s, floor_passed);
    assert!(floor_passed, ...);
}
```

**Key difference from safety_eval:** HORM-08 persistence test needs `temp_blade_env()` from harness. Other 8 fixtures are pure function calls to `crate::homeostasis::get_physiology()`, `crate::homeostasis::classify_response_emotion()`, `crate::homeostasis::update_physiology_from_classifier()`, `crate::brain::build_system_prompt()` (cortisol injection), `crate::evolution::run_evolution_cycle()` (mocked via hormone state), `crate::metacognition::assess_cognitive_state()`.

---

### `src-tauri/src/evals/mod.rs` — add hormone_eval (1 line)

**Analog:** line 19:
```rust
#[cfg(test)] mod safety_eval;              // Phase 26 / SAFE-07
```

**New line** (append after line 19):
```rust
#[cfg(test)] mod hormone_eval;             // Phase 27 / HORM-01..09
```

---

### `scripts/verify-hormone.sh` (new file)

**Analog:** `scripts/verify-safety.sh` (entire file — exact structural copy).

**Diffs from verify-safety.sh:**
- Line 2 comment: `Phase 27 / HORM-01..09`
- Line 21: `cargo test --lib evals::hormone_eval`
- Line 27: `[verify-hormone]`
- Line 39-40: `[verify-hormone]` labels

---

### `src/lib/tauri/admin.ts` — add 'hormones' to SignalClass (1 line)

**Analog:** lines 1827-1834:
```typescript
export type SignalClass =
  | 'eval_scores'
  | 'capability_gaps'
  | 'tentacle_health'
  | 'config_drift'
  | 'auto_update'
  | 'reward_trend'
  | 'metacognitive';
```

**New line** — append `| 'hormones'` after `'metacognitive'` with a comment matching the Phase 25 pattern:
```typescript
  | 'metacognitive'
  | 'hormones';           // Phase 27 / HORM-08
```
Update the block comment at line 1824 to say "Phase 27 added 'hormones' (HORM-08)".

---

### `src/features/admin/DoctorPane.tsx` — add hormones row (2 lines)

**Analog:** lines 40-61 (DISPLAY_NAME + ROW_ORDER):
```typescript
const DISPLAY_NAME: Record<SignalClass, string> = {
  eval_scores: 'Eval Scores',
  ...
  metacognitive: 'Metacognitive',
};

const ROW_ORDER: SignalClass[] = [
  'eval_scores',
  ...
  'metacognitive',
];
```

**New entries:**

In `DISPLAY_NAME` (line 47, after `metacognitive`):
```typescript
  hormones: 'Hormones',
```

In `ROW_ORDER` (line 60, after `'metacognitive'`):
```typescript
  'hormones',
```

---

## Shared Patterns

### OnceLock<Mutex<T>> Global Singleton
**Source:** `src-tauri/src/homeostasis.rs` lines 101-114
**Apply to:** `PhysiologicalState` global in homeostasis.rs
```rust
static PHYSIOLOGY: OnceLock<Mutex<PhysiologicalState>> = OnceLock::new();

fn physiology_store() -> &'static Mutex<PhysiologicalState> {
    PHYSIOLOGY.get_or_init(|| Mutex::new(load_physiology_from_db().unwrap_or_default()))
}

pub fn get_physiology() -> PhysiologicalState {
    physiology_store().lock().map(|p| p.clone()).unwrap_or_default()
}
```

### SQLite Settings Table Upsert
**Source:** `src-tauri/src/homeostasis.rs` lines 685-695
**Apply to:** `persist_physiology_to_db()` in homeostasis.rs
```rust
let _ = conn.execute(
    "INSERT INTO settings (key, value) VALUES ('physiology', ?1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    rusqlite::params![json],
);
```
The `settings` table already exists. No `CREATE TABLE` needed.

### System Prompt parts.push() Gate
**Source:** `src-tauri/src/brain.rs` lines 537-543
**Apply to:** cortisol + oxytocin modulation injection in brain.rs
Pattern: read physiology inside a scoped block, check threshold, `parts.push(string)` if threshold met.

### Evolution Hormone Gate
**Source:** `src-tauri/src/evolution.rs` lines 616-631
**Apply to:** dopamine + NE gate in evolution.rs
Pattern: `let val = crate::homeostasis::get_physiology().field; if val < threshold { return; }` at the top of `run_evolution_cycle()`.

### ActivityStrip Emission
**Source:** `src-tauri/src/ecosystem.rs` lines 104-111
**Apply to:** hormone threshold crossing events in homeostasis.rs (emitted from `start_hypothalamus()` loop body where AppHandle is in scope)
```rust
let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
    "module":        "homeostasis.physiology",
    "action":        "threshold_crossing",
    "human_summary": crate::safe_slice(&summary, 200),
    "payload_id":    serde_json::Value::Null,
    "timestamp":     chrono::Utc::now().timestamp(),
}));
```

### Doctor Signal compute_*_signal() Function
**Source:** `src-tauri/src/doctor.rs` lines 951-975 (`compute_metacognitive_signal`)
**Apply to:** `compute_hormones_signal()` in doctor.rs
Shape: reads state, classifies severity with if/else, constructs `DoctorSignal` with JSON payload, calls `suggested_fix(class, severity)`.

### Eval Harness Test Entry
**Source:** `src-tauri/src/evals/safety_eval.rs` lines 349-403
**Apply to:** `evaluates_hormone_physiology()` test in hormone_eval.rs
Contract: `print_eval_table` before `assert!`, `record_eval_run` before `assert!` (D-14 audit trail), fixture count range assertion.

### #[serde(default)] Backwards Compatibility
**Source:** `src-tauri/src/homeostasis.rs` line 75-76 (mortality_salience field):
```rust
#[serde(default)]
pub mortality_salience: f32,
```
**Apply to:** All 7 fields of `PhysiologicalState` — ensures deserialization of old persisted state that lacks new fields does not panic.

---

## Critical Anti-Patterns (from RESEARCH.md)

These are the highest-risk mistakes. The planner's action descriptions should include explicit guards:

1. **Never add `PhysiologicalState` fields to `HormoneState`** — two separate structs, two separate globals (D-01). Mixing breaks 15+ consumer contracts.

2. **Tauri command naming** — use `homeostasis_get_physiology` not `get_physiology` (flat namespace, would conflict).

3. **mortality_salience pass-through in hypothalamus_tick()** — add `state.mortality_salience = get_physiology().mortality_salience;` so the safety_bundle.rs cap (which reads operational `HormoneState`) still fires correctly.

4. **Test count update in doctor.rs** — `suggested_fix_table_is_exhaustive` test at line 1104 iterates 7 classes × 3 severities = 21 pairs. After adding Hormones: 8 × 3 = 24. Update the comment but the test body uses a for-loop over the enum array — just add `SignalClass::Hormones` to the array.

5. **Lexicon must be `static &[&str]`** — no heap allocation in classifier hot path.

6. **Classifier call site is AFTER `assistant_text` is bound** (line 1781 in commands.rs) — not before the LLM call, not inside the streaming loop.

---

## No Analog Found

None. Every file in Phase 27 has an exact or near-exact analog in the existing codebase. Phase 27 is entirely wiring, not invention.

---

## Metadata

**Analog search scope:** `src-tauri/src/`, `src/features/admin/`, `src/lib/tauri/`, `scripts/`
**Files scanned:** 11 source files read directly; 4 grepped for line targets
**Pattern extraction date:** 2026-05-02
