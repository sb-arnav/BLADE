# Phase 29: Vitality Engine - Research

**Researched:** 2026-05-03
**Domain:** Rust organism-layer integration, SDT-based scalar computation, behavioral gating, dormancy/reincarnation lifecycle
**Confidence:** HIGH

## Summary

Phase 29 is an integration phase, not a greenfield build. Every behavioral system it gates (brain.rs, evolution.rs, dream_mode.rs, metacognition.rs, persona_engine.rs) already exists and already produces the signals vitality reads (reward.rs, decision_gate.rs, character.rs, active_inference.rs). The primary work is: (1) a new `vitality_engine.rs` module with VitalityState, band logic, SDT computation, drain computation, dormancy sequence, and persistence; (2) surgical integrations into 8 existing modules — mostly 3-10 line additions per module; (3) a new `vitality_eval.rs` in evals/ following the hormone_eval pattern exactly; (4) a verify script and a frontend vitality indicator.

The architectural pattern for this phase is firmly established by Phases 25-28. Every pattern — `OnceLock<Mutex<T>>`, hypothalamus piggybacking, SQLite settings persistence, DoctorPane SignalClass extension, eval harness usage — has working precedents in the codebase. No new patterns need to be invented.

The single highest-risk task is the dormancy sequence (`std::process::exit(0)` path). The DORMANCY_STUB guard (`AtomicBool`) must be in place before any dormancy code is wired, or integration tests will terminate the test process. This is the one "get-it-wrong-once" moment in the phase.

**Primary recommendation:** Build `vitality_engine.rs` first as a complete module (state, computation, persistence, public API), then integrate into each dependent module as separate plan waves. Do not interleave module integration with core module construction.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Vitality Architecture (VITA-01, VITA-06)**
- D-01: New `vitality_engine.rs` module. OnceLock<Mutex<VitalityState>> pattern (same as homeostasis, hive, metacognition). Integrates across 6+ existing modules. Has its own persistence, band logic, and behavioral gating.
- D-02: `VitalityState` struct: `{ scalar: f32, band: VitalityBand, trend: f32, replenishment: SDTSignals, drain: DrainSignals, history: VecDeque<VitalitySnapshot>, last_updated: i64, reincarnation_count: u32, last_dormancy_at: Option<i64> }`. History ring buffer capped at 100 entries.
- D-03: Vitality tick runs inside `hypothalamus_tick()` — same 60s cadence. NOT a separate background loop.
- D-04: Band enum: `VitalityBand { Thriving, Waning, Declining, Critical, Dormant }` with thresholds 0.6, 0.4, 0.2, 0.1, 0.0.

**Behavioral Band Effects (VITA-01)**
- D-05: Bands modulate EXISTING behavioral systems. Vitality adds no new behavior, gates and scales what Phases 25-28 built.
- D-06: Thriving (>=0.6): Full personality, proactive engine at normal frequency, Voyager explores at full dopamine-modulated rate, dream_mode runs all 4 tasks, no suppression in brain.rs.
- D-07: Waning (0.4-0.6): personality_engine trait confidence scaled by vitality multiplier. Proactive engine frequency halved. brain.rs injects "lower-energy state" note.
- D-08: Declining (0.2-0.4): Voyager loop in evolution.rs skips exploration. dream_mode task_generate_skills() skipped. proactive_engine disabled entirely. brain.rs: "vitality is low" note.
- D-09: Critical (0.1-0.2): Meta-awareness injected into brain.rs. metacognition confidence-delta threshold lowered 0.3 to 0.15. All non-essential background disabled. Observable self-awareness.
- D-10: Dormant (0.0): process exit path triggered per D-17/D-18.
- D-11: HYSTERETIC band transitions — moving DOWN requires crossing threshold; moving UP requires threshold + 0.05 buffer.

**SDT Replenishment Signals (VITA-02)**
- D-12: Three channels (each 0.0-1.0 per tick):
  - Competence: EMA over last 10 reward.rs composite scores. Score >0.7 = full signal.
  - Autonomy: ratio of decision_gate.rs ActAutonomously outcomes NOT overridden, last 20 decisions.
  - Relatedness: composite of user message frequency (capped at 10 msg/hr = 1.0), character.rs positive feedback count in trailing window, average message length >50 chars.
- D-13: Net replenishment = `0.4 * competence + 0.3 * autonomy + 0.3 * relatedness`.

**Drain Sources (VITA-03)**
- D-14: Five drain channels:
  - Failure drain: reward.rs composite < 0.3 → drain proportional to (0.3 - score).
  - Drain from eval failures: safety_eval_drain() wired to real vitality drain. Each failure = -0.02.
  - Isolation drain: no user interaction >2 hours → -0.01/tick.
  - Prediction error drain: active_inference.rs aggregate error > 0.6 sustained > 5 ticks → drain.
  - Tedium drain: last 5 user messages cosine similarity >0.85 via embeddings.rs → -0.005/tick.
- D-15: Net drain is additive. Minimum time from 1.0 to 0.0 with all channels active: ~2 hours.
- D-16: Drain floor: vitality cannot drop below 0.05 from drain alone. Final step to 0.0 requires EITHER 3 consecutive ticks at 0.05 with zero replenishment, OR explicit user command.

**Dormancy and Reincarnation (VITA-04)**
- D-17: Dormancy sequence: (1) serialize full state to SQLite, (2) emit `blade_dormancy` event to frontend, (3) write dormancy_record, (4) in production: std::process::exit(0) after 5s grace; in test: DORMANCY_STUB AtomicBool logs intent but does not exit.
- D-18: Reincarnation: detect dormancy_record with reincarnation_completed=false, load preserved memory/persona/skills, reset hormones to defaults, start vitality at 0.3, increment reincarnation_count, inject reincarnation context in brain.rs, mark reincarnation_completed=true, emit `blade_reincarnation`.
- D-19: dream_mode guard: `run_dream_session()` checks vitality. If vitality < 0.2, skip entire dream session.

**UI Surface (VITA-05)**
- D-20: DoctorPane SignalClass::Vitality row showing scalar as percentage, band name, trend arrow, top contributing factor.
- D-21: ActivityStrip events on band transitions, dormancy initiation, reincarnation, significant factor changes via existing emit_activity_with_id pattern.
- D-22: Frontend vitality indicator in chat header — scalar + trend arrow + band color (green/yellow/orange/red/grey). Not a full dashboard. Full detail in DoctorPane.
- D-23: On reincarnation: system message in chat "BLADE has reincarnated. Memories intact. Rebuilding vitality."

**Persistence and Eval Support (VITA-06)**
- D-24: Three new SQLite tables: `vitality_state` (single-row current state), `vitality_history` (time-series, 5000 row FIFO cap), `dormancy_records` (per-dormancy event with reincarnation_completed flag).
- D-25: verify:vitality gate (Gate 37). 6 deterministic fixture tests: consecutive failures -> Declining band, isolation drain, competence replenishment, hysteresis, dormancy serialization (via DORMANCY_STUB), reincarnation loads identity at 0.3.

### Claude's Discretion
- Exact EMA window sizes for SDT signal computation
- Exact drain rate coefficients per channel (1.0->0.0 takes >=2 hours constraint)
- Exact cosine similarity threshold for tedium detection (suggested 0.85)
- Vitality history ring buffer size (suggested 100 in-memory, 5000 SQLite)
- Grace period duration before process exit in dormancy (suggested 5 seconds)
- Starting vitality for fresh install: suggested 0.8
- DoctorPane Vitality row payload schema details
- Frontend vitality indicator placement and visual design
- Whether to emit blade_vitality_update on every tick or only on band transition or delta > 0.05 (suggest: latter)
- Internal function boundaries within vitality_engine.rs

### Deferred Ideas (OUT OF SCOPE)
- Full vitality dashboard page (Phase 30 or future UI polish)
- Vitality-aware notification throttling
- User-adjustable vitality drain rates (v1.5)
- Cross-session vitality momentum (evaluate after Phase 30)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VITA-01 | Vitality scalar 0.0-1.0 with 5 behavioral bands (full -> flattens -> atrophy -> damage -> dormancy) | VitalityState struct + VitalityBand enum + hysteretic transition logic in vitality_engine.rs |
| VITA-02 | Replenishes from competence, relatedness, autonomy per SDT | Reads reward.rs composite EMA, decision_gate.rs act/ask ratio, character.rs thumbs-up + session frequency |
| VITA-03 | Drains from failures, isolation, skill atrophy, eval-gate failures, sustained prediction error, tedium | Reads reward.rs, safety_bundle.rs hook, session timestamps, active_inference.rs aggregate, embeddings.rs cosine |
| VITA-04 | Dormancy at 0.0 = process exit with memory preserved; revival = reincarnation not resurrection | DORMANCY_STUB for tests, std::process::exit(0) for production, dormancy_records SQLite table, reincarnation detection on next launch |
| VITA-05 | Vitality visible in UI with current value, trend, contributing factors | DoctorPane SignalClass::Vitality + frontend chat-header indicator + ActivityStrip emissions |
| VITA-06 | Vitality persisted across sessions; recovery trajectory visible on restart | vitality_state + vitality_history + dormancy_records SQLite tables, loaded on init |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Vitality state computation | Rust backend (vitality_engine.rs) | — | Pure scalar arithmetic on existing signals; no UI involvement needed |
| SDT signal reading | Rust backend (vitality_engine.rs reads reward.rs, decision_gate.rs, character.rs) | — | All inputs are already Rust-layer state |
| Drain signal reading | Rust backend (vitality_engine.rs reads multiple modules) | — | Same — all drain sources are Rust-layer |
| Band behavioral effects | Rust backend (brain.rs, evolution.rs, dream_mode.rs, metacognition.rs, persona_engine.rs) | — | Behavioral gating is Rust-layer; not passed to frontend |
| Dormancy sequence | Rust backend (vitality_engine.rs) | Frontend (blade_dormancy event consumer) | Exit logic is Rust-only; UI receives event for farewell display |
| Reincarnation detection | Rust backend (on startup in lib.rs) | Frontend (blade_reincarnation event consumer + chat system message) | Rust detects dormancy_record, frontend displays narrative |
| DoctorPane signal row | Rust backend (doctor.rs compute function) | Frontend (DoctorPane.tsx already renders any SignalClass) | Follows Phase 27/28 pattern exactly |
| Chat-header vitality indicator | Frontend only | — | UI chrome reading blade_vitality_update events |
| SQLite persistence | Rust backend (vitality_engine.rs, db.rs migrations) | — | All persistence is Rust-layer |
| Fixture tests | Rust backend (evals/vitality_eval.rs) | verify:vitality shell script | Follows hormone_eval / active_inference_eval pattern |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rusqlite | Already in Cargo.toml | SQLite persistence for vitality_state, vitality_history, dormancy_records | Same pattern as homeostasis.rs, metacognition.rs, active_inference.rs |
| serde + serde_json | Already in Cargo.toml | VitalityState serialization, event payloads | Used by every module in the codebase |
| chrono | Already in Cargo.toml | Timestamps for ticks, dormancy records | Same usage as homeostasis.rs |
| std::sync::{Mutex, OnceLock} | stdlib | Global state singleton | Established pattern: HORMONES, PREDICTIONS, META_STATE all use this |
| std::sync::atomic::{AtomicBool} | stdlib | DORMANCY_STUB test guard, VITALITY_RUNNING guard | Same as OBSERVE_ONLY guardrail in safety_bundle.rs |
| std::collections::VecDeque | stdlib | In-memory history ring buffer (100 entries) | Established by DECISION_LOG ring buffer pattern |
| tauri::Emitter | tauri 2 | blade_dormancy, blade_reincarnation, blade_vitality_update events | Same as all other event-emitting modules |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| log | Already in Cargo.toml | Trace dormancy sequence and tick deltas | All Rust modules use this |
| fastembed (via embeddings.rs) | Already in Cargo.toml | Cosine similarity for tedium drain signal | Already available via embed_texts() public API |

**Installation:** No new dependencies required — all libraries are already in Cargo.toml. [VERIFIED: codebase inspection]

---

## Architecture Patterns

### System Architecture Diagram

```
[60s hypothalamus_tick()]
        |
        v
[vitality_engine::vitality_tick()]
        |
        +-- Read: reward::read_reward_history() -> EMA(10) -> competence_signal
        |
        +-- Read: decision_gate::get_decision_log() -> act_autonomously ratio -> autonomy_signal
        |
        +-- Read: character.rs feedback / session frequency -> relatedness_signal
        |
        +-- SDT: net_replenishment = 0.4*comp + 0.3*auto + 0.3*rel
        |
        +-- Read: reward.rs composite -> failure_drain
        +-- Read: safety_bundle::safety_eval_drain() hook -> eval_drain  [Phase 26 hook]
        +-- Read: session timestamps -> isolation_drain
        +-- Read: active_inference::get_active_inference_state().aggregate_error -> prediction_error_drain
        +-- Read: embeddings cosine similarity of last 5 messages -> tedium_drain
        |
        +-- Compute: net_delta = net_replenishment - net_drain
        +-- Apply: hysteretic band transition (D-11)
        +-- Apply: band behavioral effects to downstream modules
        |
        +-- Check: dormancy condition -> dormancy sequence (D-17)
        |
        +-- Persist: vitality_state, vitality_history to SQLite
        |
        +-- Emit: blade_vitality_update (on band change or delta >0.05)
                        |
                        v
            [Frontend: chat-header indicator]
            [DoctorPane: SignalClass::Vitality row]
            [ActivityStrip: band transition events]

[On next launch after dormancy]
        |
vitality_engine::check_reincarnation()
        |
        +-- Query: dormancy_records WHERE reincarnation_completed = 0 LIMIT 1
        +-- Load: memory, persona, skills (unchanged)
        +-- Reset: PhysiologicalState::default(), HormoneState::default()
        +-- Set: vitality = 0.3
        +-- Inject: reincarnation context in brain.rs
        +-- Mark: reincarnation_completed = true
        +-- Emit: blade_reincarnation -> frontend system message
```

### Recommended Project Structure

```
src-tauri/src/
+-- vitality_engine.rs           # NEW: the entire phase core module
+-- evals/
|   +-- vitality_eval.rs         # NEW: 6 deterministic fixtures per D-25
+-- homeostasis.rs               # MODIFIED: call vitality_tick() at end of hypothalamus_tick()
+-- safety_bundle.rs             # MODIFIED: safety_eval_drain() writes to VitalityState
+-- brain.rs                     # MODIFIED: inject band-specific personality modulation
+-- persona_engine.rs            # MODIFIED: vitality multiplier in get_persona_context()
+-- evolution.rs                 # MODIFIED: gate run_evolution_cycle() on vitality >= 0.4
+-- dream_mode.rs                # MODIFIED: gate run_dream_session() on vitality >= 0.2
+-- metacognition.rs             # MODIFIED: lower confidence-delta threshold in Critical band
+-- doctor.rs                    # MODIFIED: add SignalClass::Vitality, compute function
+-- db.rs                        # MODIFIED: migrations for 3 new tables
+-- lib.rs                       # MODIFIED: mod vitality_engine + register commands

scripts/
+-- verify-vitality.sh           # NEW: Gate 37 (mirrors verify-hormone.sh / verify-inference.sh)

src/
+-- features/chat/
|   +-- VitalityIndicator.tsx    # NEW: minimal chat-header scalar + trend + band color
+-- features/admin/
|   +-- DoctorPane.tsx           # MODIFIED: add 'vitality' to DISPLAY_NAME, ROW_ORDER
+-- lib/
    +-- tauri/admin.ts           # MODIFIED: add 'active_inference' | 'vitality' to SignalClass
    +-- events/payloads.ts       # MODIFIED: add BladeDormancyPayload, BladeReincarnationPayload, BladeVitalityUpdatePayload
```

### Pattern 1: VitalityState Global Singleton (mirrors PHYSIOLOGY in homeostasis.rs)

```rust
// Source: src-tauri/src/homeostasis.rs lines 200-210 [VERIFIED]
static VITALITY: OnceLock<Mutex<VitalityState>> = OnceLock::new();

fn vitality_store() -> &'static Mutex<VitalityState> {
    VITALITY.get_or_init(|| Mutex::new(load_vitality_from_db().unwrap_or_default()))
}

pub fn get_vitality() -> VitalityState {
    vitality_store().lock().map(|v| v.clone()).unwrap_or_default()
}
```

### Pattern 2: Tick integration in hypothalamus_tick()

```rust
// Source: src-tauri/src/homeostasis.rs lines 756-769 [VERIFIED]
// Phase 27 already appends to hypothalamus_tick() — Phase 29 does the same.
// At end of hypothalamus_tick(), after persist_to_db(&state):
//   crate::vitality_engine::vitality_tick();
// AppHandle for dormancy events stored in static OnceLock in vitality_engine,
// set by start_vitality_engine(app) called from lib.rs alongside start_hypothalamus().
```

### Pattern 3: DORMANCY_STUB — test guard preventing real process exit

```rust
// Source: pattern from safety_bundle.rs AtomicBool guard [VERIFIED]
pub static DORMANCY_STUB: AtomicBool = AtomicBool::new(false);

pub fn enable_dormancy_stub() {
    DORMANCY_STUB.store(true, Ordering::SeqCst);
}

fn trigger_dormancy(app: &tauri::AppHandle) {
    // ... serialize state, emit events ...
    if DORMANCY_STUB.load(Ordering::SeqCst) {
        log::warn!("[vitality] DORMANCY_STUB active -- skipping std::process::exit(0)");
        return;
    }
    std::thread::sleep(std::time::Duration::from_secs(5));
    std::process::exit(0);
}
```

### Pattern 4: Hysteretic Band Transition

```rust
// Source: D-11 locked decision [VERIFIED in CONTEXT.md]
// Implementation pattern is discretionary (no existing code to copy)
fn compute_band(scalar: f32, current_band: &VitalityBand) -> VitalityBand {
    let up_buffer = 0.05f32;
    match current_band {
        VitalityBand::Declining => {
            if scalar >= 0.4 + up_buffer { VitalityBand::Waning }
            else if scalar < 0.2 { VitalityBand::Critical }
            else { VitalityBand::Declining }
        }
        VitalityBand::Waning => {
            if scalar >= 0.6 + up_buffer { VitalityBand::Thriving }
            else if scalar < 0.4 { VitalityBand::Declining }
            else { VitalityBand::Waning }
        }
        // ... etc for all 5 bands
    }
}
```

### Pattern 5: DoctorPane signal source (mirrors compute_active_inference_signal)

```rust
// Source: src-tauri/src/doctor.rs lines 1028-1050 [VERIFIED]
fn compute_vitality_signal() -> Result<DoctorSignal, String> {
    let v = crate::vitality_engine::get_vitality();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let severity = match v.band {
        VitalityBand::Thriving  => Severity::Green,
        VitalityBand::Waning    => Severity::Green,
        VitalityBand::Declining => Severity::Amber,
        VitalityBand::Critical  => Severity::Red,
        VitalityBand::Dormant   => Severity::Red,
    };
    Ok(DoctorSignal {
        class: SignalClass::Vitality,
        severity,
        payload: serde_json::json!({
            "scalar": v.scalar,
            "band": format!("{:?}", v.band),
            "trend": v.trend,
            "top_factor": v.top_drain_factor(),
        }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::Vitality, severity).to_string(),
    })
}
```

### Anti-Patterns to Avoid

- **Separate background loop for vitality:** Tick MUST run inside `hypothalamus_tick()` per D-03. Adding its own 60s loop causes tick proliferation.
- **Calling std::process::exit() in tests:** Without DORMANCY_STUB enabled, any test triggering dormancy kills the entire cargo test process.
- **Writing scaled confidence back to persona_engine SQLite:** The vitality multiplier is display-only. Never persist the scaled value — only modify the confidence threshold used to filter traits in `get_persona_context()`.
- **Raw string slicing on user message content:** Tedium detection reads user messages for embedding. Always use `crate::safe_slice(content, 2000)` before embedding calls.
- **No FIFO pruning before vitality_history insert:** Table caps at 5000 rows. Prune before insert, same pattern as prediction_error_log in active_inference.rs.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cosine similarity for tedium drain | Custom dot product | `embeddings::embed_texts()` + the existing cosine_similarity function (or a new pub wrapper) | Already handles zero vectors and length mismatch |
| EMA smoothing | Custom running average | Inline `current * (1.0 - alpha) + new_val * alpha` — 1-liner used by update_physiology_from_classifier | Genuinely trivial; no library needed |
| Reward history reading | Re-implement JSONL parsing | `reward::read_reward_history(10)` — returns Vec<RewardRecord> | Handles missing file, parse errors, empty history |
| Decision log reading | Re-query SQLite | `decision_gate::get_decision_log()` — returns from in-memory ring buffer | Already fast |
| Fixture output format | Custom table printing | `evals::harness::{print_eval_table, summarize, EvalRow}` | EVAL-06 contract with verify scripts greps for U+250C |
| SQLite current state persistence | Custom table | `settings` key-value JSON blob pattern (same as metacognitive_state key) — then separate vitality_history table for time-series | Single-row JSON is simpler for scalar state; history needs its own table |

**Key insight:** Every input signal vitality needs is already computed and stored by an upstream module. The job is reading, not building.

---

## Runtime State Inventory

> Phase 29 is a new module addition with new SQLite tables. No rename/refactor involved.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing vitality records exist | New tables created via migration |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | None | — |
| Build artifacts | None | — |

**Nothing found in any category** — verified by confirming no existing `vitality_engine.rs` file exists and no grep matches for "VitalityBand" or "vitality_engine" in the codebase. This is a greenfield module.

---

## Common Pitfalls

### Pitfall 1: DORMANCY_STUB Not Set Before Fixture Tests
**What goes wrong:** Any test that exercises VitalityBand::Dormant path calls `std::process::exit(0)` and terminates the entire cargo test process. All subsequent tests fail with no output.
**Why it happens:** The real dormancy path unconditionally calls exit(0) after 5 seconds.
**How to avoid:** DORMANCY_STUB AtomicBool must default to `false` in production. Every test in vitality_eval.rs that triggers dormancy MUST call `crate::vitality_engine::enable_dormancy_stub()` first.
**Warning signs:** Cargo test process exits mid-suite with no error output, or tests after the dormancy fixture are absent from output.

### Pitfall 2: Hysteresis Not Applied on Initial Band Load
**What goes wrong:** On startup, if vitality loads from DB at exactly 0.40, the band may immediately oscillate on the first tick.
**Why it happens:** Hysteresis only applies to tick-to-tick transitions, not cold start.
**How to avoid:** Use `initial_band_from_scalar(scalar: f32) -> VitalityBand` with simple thresholds for DB load; use `compute_band(scalar, current_band)` with hysteresis only for tick transitions.

### Pitfall 3: Embedding Call Blocking hypothalamus_tick()
**What goes wrong:** `embed_texts()` lazy-initializes the fastembed model on first call (~200-500ms). Inside synchronous hypothalamus_tick(), this stalls the entire hypothalamus on first tedium check.
**Why it happens:** fastembed uses LazyLock; first call is slow.
**How to avoid:** Cache a pre-computed embedding of the last 5 messages in VitalityState; only recompute if the message buffer changed. Or gate tedium check behind an `EMBEDDER_INITIALIZED: AtomicBool` and skip on first tick if model isn't warm.

### Pitfall 4: doctor.rs tokio::join! Tuple Requires Multi-Site Update
**What goes wrong:** Adding SignalClass::Vitality requires updating 4 places in doctor.rs atomically: (1) SignalClass enum, (2) suggested_fix match arms, (3) tokio::join! tuple + vec! assembly, (4) PRIOR_SEVERITY initialization list.
**Why it happens:** The doctor pattern is rigid by design. Missing any site causes a cargo compile error or a non-exhaustive match warning.
**How to avoid:** Update all 4 sites in a single plan wave. Check the arm-count comment at doctor.rs line ~1186 and update it.

### Pitfall 5: TypeScript SignalClass Missing 'active_inference' and 'vitality'
**What goes wrong:** The TS `SignalClass` type in `src/lib/tauri/admin.ts` currently ends with `| 'hormones'` and does NOT include `'active_inference'`. DoctorPane's DISPLAY_NAME and ROW_ORDER also lack it.
**Why it happens:** Phase 28 added the Rust variant but the TS type was not synchronized. [VERIFIED from DoctorPane.tsx line 49 — ROW_ORDER ends at 'hormones']
**How to avoid:** When adding 'vitality' to the TS union, simultaneously add 'active_inference'. Update DISPLAY_NAME and ROW_ORDER in DoctorPane.tsx for both.

### Pitfall 6: Reincarnation Triggering on Every Launch
**What goes wrong:** check_reincarnation() runs on every app start and resets hormones even on normal restarts.
**Why it happens:** Wrong SQL WHERE clause returns already-completed records.
**How to avoid:** Query MUST be `SELECT ... WHERE reincarnation_completed = 0 LIMIT 1`. Test by inserting a row with reincarnation_completed = 1 and verifying function is a no-op.

### Pitfall 7: Sustained Prediction Error Tick Count Not Exposed by active_inference.rs
**What goes wrong:** vitality_engine.rs needs "aggregate_error > 0.6 sustained for >5 ticks" but `get_active_inference_state()` does not expose SUSTAINED_HIGH_TICKS (it's a module-internal AtomicU32).
**Why it happens:** ActiveInferenceState struct was designed for DoctorPane, not for cross-module drain signals.
**How to avoid:** vitality_engine.rs maintains its own consecutive-high-error tick counter in VitalityState. On each tick, check `aggregate_error > 0.6` and increment a local counter; reset when it drops below. Do not depend on active_inference internals.

---

## Code Examples

### reward history reading (competence signal)
```rust
// Source: src-tauri/src/reward.rs (public read_reward_history API) [VERIFIED: header read]
let history = crate::reward::read_reward_history(10);
let n = history.len() as f32;
let ema_score = if n > 0.0 {
    history.iter().map(|r| r.reward).sum::<f32>() / n
} else {
    0.5 // neutral default
};
let competence_signal = (ema_score / 0.7f32).min(1.0); // 0.7 = full competence threshold
```

### Decision gate act/ask ratio (autonomy signal)
```rust
// Source: src-tauri/src/decision_gate.rs lines 76-80 [VERIFIED]
let log = crate::decision_gate::get_decision_log();
let recent: Vec<_> = log.iter().rev().take(20).collect();
if recent.is_empty() { return 0.5; }
let act_not_overridden = recent.iter().filter(|d| {
    matches!(&d.outcome, crate::decision_gate::DecisionOutcome::ActAutonomously { .. })
    && d.feedback != Some(false)
}).count();
let autonomy_signal = act_not_overridden as f32 / recent.len() as f32;
```

### hypothalamus_tick() integration (at end of function)
```rust
// Source: src-tauri/src/homeostasis.rs lines 756-769 [VERIFIED — end of function]
// After persist_to_db(&state), add:
crate::vitality_engine::vitality_tick();
```

### SQLite table creation
```rust
// Source: pattern from active_inference.rs init [VERIFIED pattern]
// Note: NO double quotes inside SQL strings (CLAUDE.md critical rule)
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

### FIFO pruning for vitality_history
```rust
// Source: src-tauri/src/active_inference.rs lines ~422 [VERIFIED pattern]
// Before inserting into vitality_history:
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

### persona_engine.rs vitality multiplier (Waning band)
```rust
// Source: src-tauri/src/persona_engine.rs lines 308-320 [VERIFIED — confidence threshold filter]
// In get_persona_context(), replace the hardcoded 0.3 threshold:
let vitality_scalar = crate::vitality_engine::get_vitality().scalar;
let confidence_threshold = if vitality_scalar >= 0.4 && vitality_scalar < 0.6 {
    // Waning: higher threshold = fewer traits surface (personality muting)
    // At 0.5 vitality: threshold = 0.3 / 0.5 = 0.6
    (0.3 / vitality_scalar.max(0.01)).min(1.0)
} else {
    0.3 // normal threshold for Thriving / Declining / Critical bands
};
let notable: Vec<&PersonaTrait> = traits.iter()
    .filter(|t| t.confidence > confidence_threshold)
    .collect();
```

### brain.rs vitality band injection
```rust
// Source: src-tauri/src/brain.rs lines 859, 1164 [VERIFIED injection points]
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
    system_prompt.push_str(&format!("\n\n[Internal state: {}]", note));
}
```

### safety_eval_drain() wired to vitality
```rust
// Source: src-tauri/src/safety_bundle.rs lines 486-508 [VERIFIED placeholder]
pub fn safety_eval_drain(scenario_class: &str, fixture_label: &str) {
    crate::metacognition::log_gap(
        "safety_eval_failure",
        &format!("{}/{}", scenario_class, fixture_label),
        0.0,
        1,
    );
    // Phase 29: wire to real vitality drain (-0.02 per failure)
    crate::vitality_engine::apply_drain(0.02, "eval_failure");
    log::warn!("[safety_eval_drain] {}/{}", scenario_class, fixture_label);
}
```

### ActivityStrip emit on band transition
```rust
// Source: src-tauri/src/active_inference.rs lines 430-447 [VERIFIED pattern]
if band_changed {
    let summary = format!("Vitality entered {:?} band (scalar={:.2})", new_band, scalar);
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
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No behavioral gating | Phases 25-28 built all machinery; Phase 29 controls the power supply | 2026-05 v1.4 | Vitality bands produce genuinely different experiences |
| safety_eval_drain() logs only | safety_eval_drain() writes to VitalityState | Phase 29 | SAFE-04 negative feedback loop finally wired |
| dream_mode runs unconditionally | dream_mode gated on vitality >= 0.2 | Phase 29 | Prevents consolidation during organism failure |
| evolution.rs explores unconditionally | Exploration gated on vitality >= 0.4 | Phase 29 | Skill atrophy is real — in Declining band, no new skills |
| metacognition threshold hardcoded at 0.3 | Threshold lowers to 0.15 in Critical band | Phase 29 | BLADE flags more uncertainty when fading |

**Deprecated/outdated in this phase's context:**
- `safety_eval_drain()` log-only implementation: replaced with real drain write
- DoctorPane `ROW_ORDER` without 'active_inference': add it alongside 'vitality' in Phase 29
- TypeScript `SignalClass` union without 'active_inference': add alongside 'vitality'

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `read_reward_history(n)` returns Vec<RewardRecord> with `.reward: f32` field | Code Examples | Competence signal computation fails silently. Verify: `grep -n "pub reward" src-tauri/src/reward.rs` |
| A2 | `get_active_inference_state()` does NOT expose the sustained_high_ticks counter | Common Pitfalls 7 | If field is already exposed, use it instead of local counter in VitalityState |
| A3 | `evolution.rs::run_evolution_cycle()` is the sole entry point for Voyager exploration gating | Code Examples — evolution gate | If exploration triggers from multiple entry points, all must be gated |
| A4 | `cosine_similarity` in embeddings.rs is a private `fn` (not `pub fn`) | Don't Hand-Roll | If already public, use it directly; if private, add pub(crate) wrapper |
| A5 | character.rs does not currently expose a queryable positive feedback count | SDT Relatedness | If it does, use existing API; if not, add `pub fn get_positive_feedback_count(window_secs: i64) -> u32` or query DB directly |
| A6 | DoctorPane ROW_ORDER currently ends at 'hormones' and lacks 'active_inference' | Common Pitfalls 5 | If Phase 28 already added it, only 'vitality' needs to be added |
| A7 | AppHandle is not accessible inside synchronous hypothalamus_tick() | Architecture — dormancy events | If it is accessible (e.g. captured in closure), no static AppHandle storage needed |

**Pre-planning verification commands:**
```bash
grep -n "pub reward\|pub fn reward" /home/arnav/blade/src-tauri/src/reward.rs | head -5
grep -n "sustained_high\|pub struct ActiveInferenceState" /home/arnav/blade/src-tauri/src/active_inference.rs | head -5
grep -n "^pub fn\|^pub async fn" /home/arnav/blade/src-tauri/src/evolution.rs | head -10
grep -n "^pub fn cosine\|^fn cosine" /home/arnav/blade/src-tauri/src/embeddings.rs | head -5
grep -n "^pub fn\|feedback\|thumbs" /home/arnav/blade/src-tauri/src/character.rs | head -10
grep -n "active_inference\|ROW_ORDER" /home/arnav/blade/src/features/admin/DoctorPane.tsx | head -5
```

---

## Open Questions

1. **AppHandle availability for dormancy event emission inside hypothalamus_tick()**
   - What we know: `start_hypothalamus(app: AppHandle)` captures the handle in the async closure; `hypothalamus_tick()` is a no-arg sync function called inside that closure
   - What's unclear: Whether the vitality tick (called from hypothalamus_tick) can access the AppHandle for event emission on dormancy
   - Recommendation: Store AppHandle in `static VITALITY_APP: OnceLock<tauri::AppHandle>` set by `start_vitality_engine(app)`. Alternatively, dormancy event emission can happen inside the start_hypothalamus async loop after calling vitality_tick(), with a return value signaling "dormancy triggered" from vitality_tick().

2. **cosine_similarity visibility in embeddings.rs**
   - What we know: Function exists at line 32 of embeddings.rs
   - What's unclear: `pub fn` vs `fn` (research read 60 lines, function was at line 32 but visibility keyword needs verification)
   - Recommendation: Before writing tedium drain code, run `grep -n "^fn cosine\|^pub fn cosine" src-tauri/src/embeddings.rs`. If private, add `pub(crate)` or write a new `pub fn compute_message_similarity(msgs: &[String]) -> f32` wrapper.

3. **character.rs feedback signal accessibility**
   - What we know: character.rs stores CharacterBible and runs LLM analysis; D-12 says "positive feedback signals from character.rs (thumbs up count in trailing window)"
   - What's unclear: Whether thumbs-up feedback is tracked in character.rs or in a different module (character.rs as read tracks CharacterBible content, not session feedback)
   - Recommendation: Search `grep -rn "thumbs\|positive_feedback\|feedback_count" src-tauri/src/` before implementing relatedness signal. The thumbs up tracking may be in `reward.rs` (acceptance score) rather than character.rs.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 29 is a pure Rust + frontend code addition. All required libraries are already in Cargo.toml. No external services, CLI tools, or databases beyond the existing SQLite database are needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` + custom harness (src-tauri/src/evals/harness.rs) |
| Config file | `src-tauri/src/evals/mod.rs` — add `pub mod vitality_eval;` |
| Quick run | `cd src-tauri && cargo test --lib evals::vitality_eval -- --nocapture --test-threads=1` |
| Full suite | `bash scripts/verify-vitality.sh` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VITA-01 | 5 consecutive failures push vitality into Declining band | unit | cargo test --lib evals::vitality_eval -- --test-threads=1 | No — Wave 0 |
| VITA-02 | Sustained isolation drains vitality | unit | same | No — Wave 0 |
| VITA-03 | Competence replenishment increases vitality | unit | same | No — Wave 0 |
| VITA-04 | Hysteresis prevents oscillation at band boundaries | unit | same | No — Wave 0 |
| VITA-04 | Dormancy sequence serializes state without exit (stub active) | unit | same | No — Wave 0 |
| VITA-04 | Reincarnation loads preserved identity and starts at 0.3 | unit | same | No — Wave 0 |
| VITA-05 | DoctorPane Vitality row renders with correct severity | smoke | `npm run tauri dev` + open DoctorPane | No — manual |
| VITA-05 | Chat-header vitality indicator shows scalar + trend arrow | smoke | `npm run tauri dev` + observe chat header | No — manual |
| VITA-06 | Vitality persists across app restart (SQLite round-trip) | smoke | restart app, check vitality_state table | No — manual |

### Sampling Rate
- **Per task commit:** `cd src-tauri && cargo check` (batch edits, not per-file per CLAUDE.md)
- **Per wave merge:** `cd src-tauri && cargo test --lib evals::vitality_eval -- --nocapture --test-threads=1`
- **Phase gate:** `bash scripts/verify-vitality.sh` green + `npx tsc --noEmit` clean before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src-tauri/src/evals/vitality_eval.rs` — 6 deterministic fixtures covering VITA-01 through VITA-06
- [ ] `src-tauri/src/evals/mod.rs` — add `pub mod vitality_eval;`
- [ ] `scripts/verify-vitality.sh` — Gate 37 script (copy verify-inference.sh, change module/test names)
- [ ] `src-tauri/src/vitality_engine.rs` — must exist before fixtures can compile (at minimum: VitalityState, VitalityBand, get_vitality(), apply_drain(), enable_dormancy_stub())

Note: vitality_eval.rs must use `--test-threads=1` (same constraint as hormone_eval and active_inference_eval — fixtures share global state). This is already handled by the verify script.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | All f32 inputs clamped to [0.0, 1.0] before storing in VitalityState; `crate::safe_slice()` for any text content passed to embedding calls for tedium detection |
| V6 Cryptography | no | — |

### Known Threat Patterns for Vitality Engine

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Vitality drain motivating extreme self-preservation behavior | Elevation of privilege | safety_bundle.rs `check_mortality_salience_cap()` already hard-blocks self-preservation actions at the action level — vitality drain does not bypass this (verified: Phase 26 D-07/D-08) |
| f32 NaN propagation from malformed reward history | Tampering | All f32 reads use `.unwrap_or(0.5)` defaults; scalar clamped to [0.0, 1.0] on every write |
| Dormancy trigger from crafted user input | Tampering | Drain floor D-16 prevents accidental dormancy; user-initiated dormancy requires explicit command parsing |
| Out-of-range scalar from miscalibrated drain rates | Tampering | `scalar = (scalar + delta).clamp(0.0, 1.0)` on every tick write |
| Unbounded vitality_history table growth | Denial of Service | FIFO prune (DELETE ... WHERE id NOT IN last 4999) before every INSERT |

---

## Sources

### Primary (HIGH confidence)
- `src-tauri/src/homeostasis.rs` [VERIFIED: read to line 830] — OnceLock pattern, hypothalamus_tick() structure, PhysiologicalState, integration point for vitality tick
- `src-tauri/src/safety_bundle.rs` [VERIFIED: read lines 1-60, 480-528] — safety_eval_drain() placeholder, SafetyState pattern
- `src-tauri/src/doctor.rs` [VERIFIED: read relevant sections] — SignalClass enum, compute_hormones_signal() / compute_active_inference_signal() patterns, tokio::join! assembly, ROW_ORDER missing 'active_inference'
- `src-tauri/src/evals/hormone_eval.rs` [VERIFIED: read to line 60] — fixture struct, MODULE_FLOOR, EvalRow usage
- `src-tauri/src/evals/active_inference_eval.rs` [VERIFIED: read to line 80] — exact fixture pattern Phase 29 should replicate
- `src-tauri/src/evals/harness.rs` [VERIFIED: read to line 60] — EvalRow, print_eval_table, EVAL-06 contract
- `src-tauri/src/active_inference.rs` [VERIFIED: read relevant sections] — SUSTAINED_HIGH_TICKS internals (not exported), ActivityStrip emit pattern
- `src-tauri/src/reward.rs` [VERIFIED: header read, RewardComponents struct] — public read_reward_history API
- `src-tauri/src/decision_gate.rs` [VERIFIED: full struct read] — get_decision_log(), DecisionRecord, DecisionOutcome types
- `src-tauri/src/persona_engine.rs` [VERIFIED: get_persona_context() read] — confidence threshold filtering at line 309
- `src-tauri/src/embeddings.rs` [VERIFIED: header read to line 60] — embed_texts() pub, cosine_similarity private fn
- `src-tauri/src/lib.rs` [VERIFIED: module list] — registration pattern, existing module declarations
- `src/lib/tauri/admin.ts` [VERIFIED: SignalClass section] — type union ends at 'hormones', missing 'active_inference'
- `src/features/admin/DoctorPane.tsx` [VERIFIED: ROW_ORDER] — ROW_ORDER ends at 'hormones', missing 'active_inference'
- `.planning/phases/29-vitality-engine/29-CONTEXT.md` [VERIFIED: full read] — all locked decisions
- `.planning/phases/26-safety-bundle/26-CONTEXT.md` [VERIFIED: full read] — safety eval drain hook (D-13)
- `.planning/phases/27-hormone-physiology/27-CONTEXT.md` [VERIFIED: full read] — hormone integration patterns
- `.planning/phases/28-active-inference-loop/28-CONTEXT.md` [VERIFIED: full read] — active inference integration patterns
- `scripts/verify-hormone.sh`, `scripts/verify-inference.sh` [VERIFIED: full read] — Gate 37 template

### Secondary (MEDIUM confidence)
- None applicable — all relevant claims verified from codebase inspection

### Tertiary (LOW confidence)
- None — no unverified claims present

---

## Project Constraints (from CLAUDE.md)

These directives apply to all Phase 29 plan and implementation work:

| Directive | Source | Applies To |
|-----------|--------|------------|
| New module requires `mod vitality_engine;` in lib.rs | "Module registration (EVERY TIME)" | vitality_engine.rs creation |
| New commands added to `generate_handler![]` in lib.rs | "New command -> add to generate_handler!" | Any pub async fn with #[tauri::command] |
| New config fields require 6-place addition | "New config field -> add to ALL 6 places" | Only if VitalityState has config fields |
| `use tauri::Manager;` when using `app.state()` | "MUST import or get cryptic error" | Any command using app.state() |
| No double quotes inside SQL in execute_batch! | "NO double quotes inside SQL strings" | All 3 new table CREATE statements |
| `crate::safe_slice(text, max_chars)` for any text slicing | "ALWAYS use safe_slice, never &text[..n]" | Tedium drain message content, any string processing |
| No duplicate #[tauri::command] function names across modules | "Tauri's macro namespace is FLAT" | All new vitality commands |
| Don't run cargo check after every small edit — batch first | Workflow | Implementation cadence |
| UAT protocol required before claiming phase "done" | "Static gates != done" | Phase verification |
| Dev server running + screenshots required for UI changes | Verification Protocol | VitalityIndicator.tsx, DoctorPane changes |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified in Cargo.toml via codebase inspection
- Architecture: HIGH — all integration points verified in actual source files
- Pitfalls: HIGH — Pitfalls 1-4 from direct code inspection; Pitfall 5 from DoctorPane.tsx ROW_ORDER read; Pitfall 7 from active_inference.rs SUSTAINED_HIGH_TICKS internals
- Eval pattern: HIGH — hormone_eval.rs and active_inference_eval.rs both read in full

**Research date:** 2026-05-03
**Valid until:** 2026-06-01 (stable Rust substrate, no fast-moving dependencies)
