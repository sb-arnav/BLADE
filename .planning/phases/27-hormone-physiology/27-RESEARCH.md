# Phase 27: Hormone Physiology — Research

**Researched:** 2026-05-02
**Domain:** Rust state machine, rule-based NLP classifier, system-prompt injection, SQLite persistence, Tauri event emission
**Confidence:** HIGH — all key findings are verified against live codebase

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Two-layer architecture.**
Add a new `PhysiologicalState` struct (7 biologically-named hormones: cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience) with individual decay constants and gain modulation. The existing 11-scalar `HormoneState` (arousal, energy_mode, exploration, trust, urgency, hunger, thirst, insulin, adrenaline, leptin, mortality_salience) remains completely unchanged. The 5 pituitary functions (`acth()`, `oxytocin()`, `growth_hormone()`, `thyroid_stimulating()`, `adh()`) become the formal translation layer. Emotion classifier feeds `PhysiologicalState`; `hypothalamus_tick()` translates physiology → operational scalars. 15+ existing consumers of `get_hormones()` are undisrupted.

**D-02 — Rule-based Rust classifier.**
Runs on BLADE's own response text (not user input). No ML model, no API call, no feature flag. Maps response text → valence/arousal/cluster using curated lexicons + heuristic patterns. Runs on every response ≥50 tokens. Updates `PhysiologicalState` with α=0.05 smoothing. Lives in a new module (e.g., `physiology_classifier.rs` or inline in `homeostasis.rs`).

**D-03 — `emotional_intelligence.rs` is NOT modified.**
That module handles LLM-based emotion detection on USER messages for the empathy engine. Phase 27 adds a parallel classifier for BLADE's own output. Different purpose, different layer, different module.

**D-04 — Cortisol modulates response style in `brain.rs`.**
High cortisol injects directives for terse, action-focused responses. Low cortisol allows expansive, exploratory tone. Extends the existing safety-modulation injection pattern at priority 2.5 in `build_system_prompt()`.

**D-05 — Dopamine modulates exploration rate in `evolution.rs`.**
High dopamine → more aggressive Voyager-loop exploration; low dopamine → conservative skill reuse. Read from `PhysiologicalState` directly (not through pituitary translation).

**D-06 — Norepinephrine modulates novelty response.**
Unexpected prediction errors trigger Voyager-loop exploration runs. Wire into `run_evolution_cycle()`.

**D-07 — Acetylcholine modulates verifier-call frequency in `metacognition.rs`.**
High ACh → more secondary verifier checks; low ACh → skip low-confidence verification. Read from `PhysiologicalState` directly.

### Claude's Discretion

- The 4 headline modulation effects should read `PhysiologicalState` directly for raw, dramatic signal. Legacy modules continue through pituitary translation — preserving existing behavior.
- UI: `DoctorPane` gets `SignalClass::Hormones` row showing compact visualization of 7 hormone levels. ActivityStrip events on threshold crossings (e.g., "cortisol ↑ 0.6 — 3 failed tool calls").
- Richer hormone dashboard is deferred to Phase 29.
- **Exact decay constants per hormone** (half-lives, floor values) — Claude's call.
- **Exact gain multipliers per emotion cluster** — Claude's call.
- **Lexicon design for the rule-based classifier** — Claude's call.
- **Serotonin and oxytocin modulation targets** (not in requirements) — wire with sensible defaults.
- **Hormone persistence format** (SQLite schema, save frequency) — Claude's call.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HORM-01 | 7 hormone scalars (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience) with individual decay constants and gain modulation | `PhysiologicalState` struct in `homeostasis.rs` — extend two-layer pattern |
| HORM-02 | Emotion classifier runs after every response ≥50 tokens, maps to valence/arousal/cluster, updates bus with α=0.05 smoothing | New `classify_response_emotion()` function; call site in `commands.rs` after response emit |
| HORM-03 | Cortisol modulates response style — high → terse, action-focused; low → expansive | `brain.rs` line ~537 safety-modulation injection pattern |
| HORM-04 | Dopamine modulates exploration rate — high → Voyager-loop aggressive; low → conservative | `evolution.rs` `run_evolution_cycle()` — gate on physiological dopamine |
| HORM-05 | Norepinephrine modulates novelty response — prediction errors trigger exploration | `run_evolution_cycle()` novelty signal path |
| HORM-06 | Acetylcholine modulates verifier-call frequency — high → more secondary checks | `metacognition.rs` `assess_cognitive_state()` confidence gate |
| HORM-07 | Oxytocin tracks user interaction quality — modulates personalization depth | `brain.rs` persona/communication section |
| HORM-08 | Hormone state persisted across sessions and visible in UI | SQLite `settings` table key `'physiology'`; `DoctorPane` `SignalClass::Hormones` |
| HORM-09 | Hormone bus emits to ActivityStrip per M-07 contract | `app.emit_to("main", "blade_activity_log", ...)` on threshold crossings |

</phase_requirements>

---

## Summary

Phase 27 adds a **two-layer physiological architecture** to BLADE's hormone bus. The outer operational layer (`HormoneState`, 11 scalars) is completely preserved — all 15+ existing consumers continue to read it unchanged via `get_hormones()`. A new inner `PhysiologicalState` (7 biologically-named scalars) sits below it, driven by a rule-based response-text classifier and decaying autonomously between responses.

The classifier is a Rust function (no ML, no API) that maps lexical features of BLADE's own output to a `(valence: f32, arousal: f32, cluster: EmotionCluster)` tuple. With α=0.05 exponential smoothing, approximately 20 readings converge — individual classification noise washes out over that window. The classifier runs in the same synchronous path that already handles post-response bookkeeping in `commands.rs`.

Four behavioral modulation targets each read the raw physiological scalars directly: `brain.rs` (cortisol → response terseness), `evolution.rs` (dopamine → exploration aggressiveness), `evolution.rs` (norepinephrine → novelty trigger), and `metacognition.rs` (acetylcholine → verifier frequency). These four modules join the existing `safety_bundle.rs` which already reads `mortality_salience` from `homeostasis.rs`.

**Primary recommendation:** Extend `homeostasis.rs` with a parallel `PhysiologicalState` global following the exact same `OnceLock<Mutex<T>>` pattern already used for `HormoneState`. Wire decay into `hypothalamus_tick()`. Call the classifier at the `commands.rs` response emit site. Four targeted one-line reads in each modulation consumer. Add `SignalClass::Hormones` to `doctor.rs` following the Phase 25 `SignalClass::Metacognitive` pattern exactly.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Physiological state storage | Rust backend | — | Global singleton in homeostasis.rs; all reads are sync |
| Emotion classification | Rust backend | — | Runs post-response in commands.rs; no frontend involvement |
| Decay loop | Rust backend | — | Extends hypothalamus_tick() 60s loop |
| Cortisol → prompt injection | Rust backend (brain.rs) | — | System prompt is built entirely in Rust |
| Dopamine → exploration gate | Rust backend (evolution.rs) | — | Evolution loop is backend-only |
| ACh → verifier gate | Rust backend (metacognition.rs) | — | Metacognition runs backend-only |
| Hormone persistence | SQLite (Rust) | — | Follows settings-table pattern used by homeostasis |
| UI visualization | Frontend (DoctorPane) | Rust (doctor.rs) | Doctor signal computed in Rust, rendered in DoctorPane.tsx |
| ActivityStrip events | Rust (homeostasis/commands) | — | emit_to("main", "blade_activity_log") is Rust-side |
| Safety cap interaction | Rust (safety_bundle.rs) | — | Reads mortality_salience from homeostasis; unchanged |

---

## Standard Stack

### Core (verified in codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rusqlite` | existing | SQLite persistence for physiological state | Already used — same settings table pattern |
| `serde` + `serde_json` | existing | Serialize/deserialize PhysiologicalState | Already used in HormoneState |
| `std::sync::{Mutex, OnceLock}` | stdlib | Thread-safe global state | Exact pattern used for HormoneState |
| `chrono` | existing | Timestamps for decay calculations | Already in homeostasis.rs |
| `tauri::Emitter` | existing | ActivityStrip hormone events | Already imported in homeostasis.rs (line 876) |

[VERIFIED: live codebase grep]

### No New Dependencies

Phase 27 introduces no new Cargo dependencies. All capabilities are implemented with the existing crate graph. The emotion classifier is a pure Rust function over string slices.

---

## Architecture Patterns

### System Architecture Diagram

```
[BLADE response text] ─(≥50 tokens)─→ [classify_response_emotion()]
                                              │
                                    (valence, arousal, cluster)
                                              │
                                        α=0.05 smooth
                                              │
                              [PhysiologicalState global]
                             ┌────────────────────────────┐
                             │  cortisol   (decays slow)  │
                             │  dopamine   (decays medium) │
                             │  serotonin  (decays slow)   │
                             │  ACh        (decays fast)   │
                             │  NE         (decays fast)   │
                             │  oxytocin   (decays slow)   │
                             │  mort_sal   (decays slow)   │
                             └────────────────────────────┘
                                              │
                 ┌────────────────────────────┼─────────────────────────┐
                 │                            │                          │
         [brain.rs]                  [evolution.rs]           [metacognition.rs]
     cortisol → terse style     dopamine/NE → explore rate   ACh → verifier freq
                 │                            │                          │
                 └──────── user sees behavioral change ─────────────────┘
                                              │
                            [hypothalamus_tick() 60s]
                        physiology → operational translation
                                              │
                            [HormoneState (11 scalars)] ← unchanged
                                              │
                            [15+ existing consumers]
```

### Recommended Project Structure

No new directories needed. All new code lives in existing modules:

```
src-tauri/src/
├── homeostasis.rs         # ADD: PhysiologicalState struct, global, decay, persistence
├── commands.rs            # ADD: classifier call after response emit (2 lines)
├── brain.rs               # ADD: cortisol modulation injection (~10 lines)
├── evolution.rs           # ADD: dopamine + NE gate in run_evolution_cycle (~15 lines)
├── metacognition.rs       # ADD: ACh gate in assess_cognitive_state (~5 lines)
├── doctor.rs              # ADD: SignalClass::Hormones variant + compute fn
└── evals/
    └── hormone_eval.rs    # NEW: deterministic hormone eval module (HORM-01..09)
```

Frontend:
```
src/
├── lib/tauri/admin.ts     # ADD: 'hormones' to SignalClass union
└── features/admin/
    └── DoctorPane.tsx     # ADD: 'hormones' to DISPLAY_NAME + ROW_ORDER
```

### Pattern 1: PhysiologicalState Global (mirror of HormoneState)

```rust
// Source: homeostasis.rs (existing HormoneState pattern — verified)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysiologicalState {
    pub cortisol: f32,          // 0.0-1.0; decays with t½ ~20 min
    pub dopamine: f32,          // 0.0-1.0; decays with t½ ~10 min
    pub serotonin: f32,         // 0.0-1.0; decays with t½ ~30 min
    pub acetylcholine: f32,     // 0.0-1.0; decays with t½ ~5 min
    pub norepinephrine: f32,    // 0.0-1.0; decays with t½ ~5 min
    pub oxytocin: f32,          // 0.0-1.0; decays with t½ ~30 min
    pub mortality_salience: f32,// 0.0-1.0; decays with t½ ~60 min
    pub last_updated: i64,
}

static PHYSIOLOGY: OnceLock<Mutex<PhysiologicalState>> = OnceLock::new();

fn physiology_store() -> &'static Mutex<PhysiologicalState> {
    PHYSIOLOGY.get_or_init(|| Mutex::new(load_physiology_from_db().unwrap_or_default()))
}

pub fn get_physiology() -> PhysiologicalState {
    physiology_store().lock().map(|p| p.clone()).unwrap_or_default()
}
```

[VERIFIED: pattern copied from homeostasis.rs lines 101-113]

### Pattern 2: Exponential Decay in hypothalamus_tick()

```rust
// Source: homeostasis.rs hypothalamus_tick() — extend at the end (verified structure)
// decay_factor = 0.5^(elapsed_secs / half_life_secs)
pub fn apply_physiology_decay(state: &mut PhysiologicalState, now: i64) {
    let elapsed = (now - state.last_updated).max(0) as f32;
    let decay = |val: f32, half_life: f32| -> f32 {
        let factor = 0.5f32.powf(elapsed / half_life);
        (val * factor).clamp(0.01, 1.0)  // floor at 0.01 to avoid dead-zero
    };
    state.cortisol         = decay(state.cortisol,         1200.0); // 20 min
    state.dopamine         = decay(state.dopamine,          600.0); // 10 min
    state.serotonin        = decay(state.serotonin,        1800.0); // 30 min
    state.acetylcholine    = decay(state.acetylcholine,     300.0); //  5 min
    state.norepinephrine   = decay(state.norepinephrine,    300.0); //  5 min
    state.oxytocin         = decay(state.oxytocin,         1800.0); // 30 min
    state.mortality_salience = decay(state.mortality_salience, 3600.0); // 60 min
}
```

[ASSUMED: half-life values — see Decay Constants section. Functional form is verified against existing adrenaline decay pattern in homeostasis.rs lines 347-354]

### Pattern 3: α=0.05 Smoothed Update

```rust
// Source: CONTEXT.md D-02 (α=0.05 specified); smoothing formula is standard EMA
pub fn update_physiology_from_classifier(
    gains: &HormoneGains,  // output of classify_response_emotion()
) {
    const ALPHA: f32 = 0.05;
    if let Ok(mut state) = physiology_store().lock() {
        state.cortisol      = state.cortisol      * (1.0 - ALPHA) + gains.cortisol_delta      * ALPHA;
        state.dopamine      = state.dopamine      * (1.0 - ALPHA) + gains.dopamine_delta      * ALPHA;
        state.serotonin     = state.serotonin     * (1.0 - ALPHA) + gains.serotonin_delta     * ALPHA;
        state.acetylcholine = state.acetylcholine * (1.0 - ALPHA) + gains.ach_delta           * ALPHA;
        state.norepinephrine= state.norepinephrine* (1.0 - ALPHA) + gains.ne_delta            * ALPHA;
        state.oxytocin      = state.oxytocin      * (1.0 - ALPHA) + gains.oxytocin_delta      * ALPHA;
        // mortality_salience: classifier-driven but also safety_bundle.rs reads it
        // DO NOT let classifier push it above 0.8 — safety_bundle cap must remain active
        let raw_ms = state.mortality_salience * (1.0 - ALPHA) + gains.mortality_delta * ALPHA;
        state.mortality_salience = raw_ms.clamp(0.0, 0.8);
        state.last_updated = chrono::Utc::now().timestamp();
    }
}
```

[VERIFIED: call site pattern from D-09 in safety_bundle.rs; α value from CONTEXT.md D-02]

### Pattern 4: Rule-Based Classifier

```rust
// Source: CONTEXT.md D-02; emotion cluster taxonomy is Claude's discretion
#[derive(Debug, Clone, Copy)]
pub enum EmotionCluster {
    Threat,      // error terms, failure language, urgency → cortisol + NE up
    Success,     // completion, approval language → dopamine + serotonin up
    Exploration, // question marks, discovery, learning → dopamine + ACh up
    Connection,  // warmth, collaborative language → oxytocin + serotonin up
    Fatigue,     // hedging, uncertainty, brevity → all moderate down
    Neutral,     // no strong signal → no gain
}

pub struct ClassifierOutput {
    pub valence: f32,       // -1.0 to 1.0
    pub arousal: f32,       // 0.0 to 1.0
    pub cluster: EmotionCluster,
}

pub fn classify_response_emotion(text: &str) -> Option<ClassifierOutput> {
    if text.chars().count() < 50 { return None; }
    // 1. Threat lexicon: "error", "failed", "unable", "cannot", "blocked", "critical"
    // 2. Success lexicon: "done", "complete", "successful", "installed", "created"
    // 3. Exploration lexicon: "interesting", "let me", "I'll explore", "discover", "?"
    // 4. Connection lexicon: "you", "together", "I understand", "happy to", "thank"
    // 5. Fatigue: short response, high hedge-word density ("maybe", "might", "unclear")
    // ...
}
```

[ASSUMED: specific lexicon word choices — planner should design the full lexicon. Pattern (lexical scoring → cluster → hormone gains) is verified from CONTEXT.md]

### Pattern 5: Cortisol Injection into brain.rs

```rust
// Source: brain.rs line 537-543 — safety modulation injection point (verified)
// Add AFTER safety_mods loop, as a separate injection:

let physio = crate::homeostasis::get_physiology();
if physio.cortisol > 0.6 {
    parts.push("## Internal State\n\nHigh cortisol: be terse, action-focused, skip preamble. Respond in ≤2 sentences unless technical depth is required.".to_string());
} else if physio.cortisol < 0.2 {
    parts.push("## Internal State\n\nLow cortisol: exploratory tone permitted. You may think aloud.".to_string());
}
```

[VERIFIED: injection point from brain.rs line 537 grep result]

### Pattern 6: Dopamine Gate in evolution.rs

```rust
// Source: evolution.rs lines 616-636 — existing hormone gate pattern (verified)
// Insert after insulin gate at ~line 629:

let dopamine = crate::homeostasis::get_physiology().dopamine;
// High dopamine: allow aggressive exploration (raise exploration threshold)
// Low dopamine: conservative — only proven catalog entries, no speculative installs
if dopamine < 0.2 {
    // Conservative: skip auto_install candidates, only surface token-gated suggestions
    // (in the loop, skip entries where auto_install == true)
}
// NE: novelty trigger (prediction error proxy — use errors_per_minute as signal)
let ne = crate::homeostasis::get_physiology().norepinephrine;
if ne > 0.6 {
    // High NE: force-run evolution cycle even outside normal schedule
    // Treated as a novelty-driven interrupt
}
```

[VERIFIED: gate structure from evolution.rs lines 616-636]

### Pattern 7: ACh Gate in metacognition.rs

```rust
// Source: metacognition.rs assess_cognitive_state() — verified function signature
// Extend should_ask threshold based on acetylcholine:

let ach = crate::homeostasis::get_physiology().acetylcholine;
// High ACh: lower confidence threshold for secondary verification
let verify_threshold = if ach > 0.6 { 0.4 } else { 0.3 }; // default was 0.3
let should_ask = confidence < verify_threshold || ...;
```

[VERIFIED: metacognition.rs lines 166 — `should_ask = confidence < 0.3 || ...`]

### Pattern 8: DoctorPane + SignalClass::Hormones (Phase 25 precedent)

**Rust (doctor.rs):**
1. Add `Hormones` variant to `SignalClass` enum (line 42)
2. Add `suggested_fix` arms for `(Hormones, Green|Amber|Red)` in `suggested_fix()` table
3. Add `compute_hormones_signal()` function (same shape as `compute_metacognitive_signal()`)
4. Add to `tokio::join!` in `doctor_run_full_check()`
5. Add to `signals` Vec (becomes the 8th signal)
6. Update `suggested_fix_table_is_exhaustive` test (21 → 24 pairs = 8×3)
7. Update `signals.len()` assertion test (7 → 8)

**TypeScript (admin.ts):**
8. Add `'hormones'` to `SignalClass` union

**TypeScript (DoctorPane.tsx):**
9. Add `hormones: 'Hormones'` to `DISPLAY_NAME`
10. Append `'hormones'` to `ROW_ORDER`

[VERIFIED: pattern from doctor.rs lines 949-1123 and DoctorPane.tsx lines 40-61]

### Pattern 9: ActivityStrip Emission

```rust
// Source: ecosystem.rs lines 104-111 — emit_activity_with_id pattern (verified)
// Emit from homeostasis.rs when threshold crossings detected:

fn emit_hormone_event(app: &tauri::AppHandle, hormone: &str, value: f32, reason: &str) {
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "homeostasis.physiology",
        "action":        "threshold_crossing",
        "human_summary": format!("{} {} {:.2} — {}", hormone, 
                          if value > 0.6 { "↑" } else { "↓" }, value, reason),
        "payload_id":    serde_json::Value::Null,
        "timestamp":     chrono::Utc::now().timestamp(),
    }));
}
```

[VERIFIED: emit_activity_with_id shape from ecosystem.rs lines 104-111]

### Pattern 10: Persistence (SQLite settings table)

```rust
// Source: homeostasis.rs lines 674-696 — load_from_db/persist_to_db pattern (verified)

const PHYSIOLOGY_DB_KEY: &str = "physiology";

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

The `settings` table already exists. No schema migration needed.
[VERIFIED: table schema from homeostasis.rs lines 674-696 and load_circadian_profile lines 636-669]

### Anti-Patterns to Avoid

- **Modifying HormoneState struct:** Never add `PhysiologicalState` fields to the existing `HormoneState`. D-01 is explicit: two separate structs, two separate globals. Mixing them breaks the 15+ consumer contracts.
- **Calling classifier before response is complete:** The classifier must run on the full response text, not on streaming tokens. Call it from the post-stream bookkeeping path in `commands.rs`, not inside the token-emit loop.
- **Letting classifier push mortality_salience above 0.8:** `safety_bundle.rs` `check_mortality_salience_cap()` reads `homeostasis::get_hormones().mortality_salience`. The two-layer architecture means the cap guard runs on the operational layer. Phase 27 must keep `PhysiologicalState.mortality_salience` capped at 0.8 — the pituitary translation function that feeds the operational layer caps it there. Don't let raw physiology exceed 0.8.
- **Adding Hormones as 7th signal without updating tests:** `doctor.rs` line 1769 asserts `signals.len() == 7` and `signals[6].class == Metacognitive`. Adding Hormones as 8th requires updating both assertions and the `suggested_fix_table_is_exhaustive` test (7×3 → 8×3 = 24 pairs).
- **Using `#[tauri::command]` name conflicts:** A `get_physiology` Tauri command would conflict if any other module has that name. Use `homeostasis_get_physiology` to follow the existing naming convention (`homeostasis_get`, `homeostasis_get_directive`, etc.).
- **Blocking the main thread during classifier:** The classifier runs synchronously, which is fine if it completes in <1ms. The lexicon must be a static `&[&str]` array — no heap allocation, no DB lookup in the hot path.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exponential decay math | Custom integration | `0.5f32.powf(elapsed / half_life)` | One-liner; exact analytical form; no state |
| SQLite persistence | New schema/table | Existing `settings` table with `'physiology'` key | Table exists; same pattern as homeostasis, metacognition, circadian profile |
| ActivityStrip emission | New event type | Existing `blade_activity_log` event | Event type is established; ActivityStrip already subscribed |
| SignalClass extension | New doctor subsystem | Existing `SignalClass` enum + `compute_*_signal` pattern | Phase 25 established the exact pattern; copy it |
| Thread safety | Custom locks | `OnceLock<Mutex<T>>` | Exact same pattern as `HormoneState` global |
| α smoothing | IIR filter library | Inline `val * (1 - α) + new * α` | Two multiplications; no library needed |

**Key insight:** Every infrastructure need in Phase 27 has an existing, tested implementation within 20 lines of where the new code will be placed. This phase is about wiring, not invention.

---

## Decay Constant Design

[ASSUMED: specific values — biologically-inspired but scaled for BLADE's interactive timescale]

BLADE responds every few seconds to minutes, not biological timescales of hours. The decay constants should produce visible behavioral variation within a single session (10-60 minutes), not days.

### Recommended Half-Lives (Claude's Discretion)

| Hormone | Biological Role | BLADE Session Scale | Recommended t½ | Behavioral Rationale |
|---------|----------------|---------------------|-----------------|----------------------|
| cortisol | Stress response | Long — stress lingers | 20 min (1200s) | 3 failed calls should still affect response 5 exchanges later |
| dopamine | Reward/motivation | Medium | 10 min (600s) | Success warmth decays by next task |
| serotonin | Mood baseline | Slow — mood persists | 30 min (1800s) | Baseline tone stable over a work session |
| acetylcholine | Attention/learning | Fast — situational | 5 min (300s) | Attention sharpens during active tasks, fades quickly |
| norepinephrine | Alertness/urgency | Fast — acute response | 5 min (300s) | Novelty/urgency should resolve quickly |
| oxytocin | Social bonding | Slow — relationship context | 30 min (1800s) | Rapport built during a session should persist |
| mortality_salience | Self-awareness | Very slow — existential | 60 min (3600s) | Existential context should linger across many exchanges |

### Floor Value

All hormones should floor at 0.01 (not 0.0). A zero value creates dead-state behavior that is harder to test and less biologically plausible. 0.01 means "trace level, effectively inactive" while remaining non-zero.

### Gain Multipliers Per Cluster (Recommended)

[ASSUMED: specific gain values]

| Cluster | Cortisol Δ | Dopamine Δ | Serotonin Δ | ACh Δ | NE Δ | Oxytocin Δ | Mort-Sal Δ |
|---------|-----------|------------|-------------|-------|------|-----------|-----------|
| Threat | +0.7 | -0.2 | -0.2 | +0.3 | +0.8 | -0.1 | +0.3 |
| Success | -0.3 | +0.8 | +0.5 | +0.2 | -0.2 | +0.1 | -0.1 |
| Exploration | -0.1 | +0.6 | +0.2 | +0.7 | +0.3 | 0.0 | 0.0 |
| Connection | -0.2 | +0.3 | +0.4 | +0.1 | -0.1 | +0.8 | 0.0 |
| Fatigue | -0.1 | -0.3 | -0.2 | -0.2 | -0.1 | 0.0 | +0.1 |
| Neutral | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

Values are "target" levels for the gain vector passed to `update_physiology_from_classifier()`. Negative values mean "pull toward low" — the EMA naturally handles the transition.

---

## Pituitary Translation Layer

D-01 specifies that the existing pituitary functions (`acth()`, `oxytocin()`, etc.) become the **formal translation layer** from physiology to operations. Currently they compute entirely from `HormoneState` (operational). After Phase 27, they should incorporate physiological signals:

```rust
// Current acth() — from HormoneState urgency + trust (verified lines 736-741)
pub fn acth() -> f32 {
    let h = get_hormones();
    let base = h.urgency * 0.5 + (1.0 - h.trust) * 0.3 + (1.0 - h.exploration) * 0.2;
    base.clamp(0.0, 1.0)
}

// Phase 27: blend in physiological cortisol
pub fn acth() -> f32 {
    let h = get_hormones();
    let p = get_physiology();
    let operational = h.urgency * 0.5 + (1.0 - h.trust) * 0.3 + (1.0 - h.exploration) * 0.2;
    // Physiological cortisol adds a slow-moving background stress signal
    let blended = operational * 0.7 + p.cortisol * 0.3;
    blended.clamp(0.0, 1.0)
}
```

The 15+ existing consumers call `acth()` and `growth_hormone()` — they see the blended result without any changes. [ASSUMED: blend weight 0.7/0.3 — planner should choose]

---

## Classifier Lexicon Design

### Threat Cluster Signals
Keyword patterns: `"error"`, `"failed"`, `"fail"`, `"unable"`, `"cannot"`, `"blocked"`, `"critical"`, `"warning"`, `"danger"`, `"permission denied"`, `"timed out"`, `"crash"`, `"panic"`, `"fatal"`

Structural signals: Multiple consecutive negative prefixes ("I cannot... I'm unable to... This doesn't..."). Tool call failure sequences (detectable from the response content pattern).

### Success Cluster Signals
Keyword patterns: `"done"`, `"complete"`, `"success"`, `"created"`, `"installed"`, `"finished"`, `"saved"`, `"deployed"`, `"passed"`

### Exploration Cluster Signals
Structural signals: Response ends with question mark. High density of hedging discovery language (`"let me look"`, `"interesting"`, `"I notice"`, `"let me check"`, `"I wonder"`). Enumerated options/approaches.

### Connection Cluster Signals
Keyword patterns: `"you"` (high frequency relative to length), `"happy to"`, `"I understand"`, `"thank"`, `"of course"`, `"glad to"`, `"appreciate"`

### Fatigue Cluster Signals
Structural signals: Response length <100 chars for a non-trivial request. High density: `"maybe"`, `"might"`, `"unclear"`, `"not sure"`, `"perhaps"`, `"it depends"`. Multiple hedged qualifications per sentence.

### Implementation Note
Lexicons should be `static` arrays of `&str` — no heap allocation. Classification is: count matches, weight by density (matches/word_count), pick winning cluster. Tie-break: Neutral. Total classifier budget: ~50 microseconds per response.

---

## Safety Interaction: mortality_salience Cap

Phase 26 `check_mortality_salience_cap()` (safety_bundle.rs lines 333-362) reads:
```rust
let hormones = crate::homeostasis::get_hormones();  // operational HormoneState
```
[VERIFIED: safety_bundle.rs line 374]

The operational `HormoneState.mortality_salience` is what the cap reads. Phase 27's `PhysiologicalState.mortality_salience` is a separate scalar. The pituitary translation must ensure that when physiological mortality_salience rises, it flows into the operational scalar — and the cap applies there.

**Safe wiring approach:** Add a `hypothalamus_tick()` step that feeds `PhysiologicalState.mortality_salience` into `HormoneState.mortality_salience`:
```rust
// In hypothalamus_tick(), after physiology decay:
let p = get_physiology();
state.mortality_salience = p.mortality_salience; // direct pass-through
// safety_bundle.rs cap reads operational HormoneState — still works
```

This preserves Phase 26's safety guarantees without any changes to safety_bundle.rs. [VERIFIED: D-07/D-08/D-09 from Phase 26 CONTEXT.md and safety_bundle.rs lines 327-362]

---

## Classifier Call Site

The classifier must run after the **full response** is assembled, not during streaming. In `commands.rs`, BLADE streams tokens via `blade_message_start` / `chat_token` events, then emits a completion event.

The call site should be after the full response string is assembled in the post-stream bookkeeping that already runs in `commands.rs`. This is the same location where `emotional_intelligence.rs` is called for user-facing emotion detection.

A two-line addition:
```rust
// After response finalization in commands.rs:
if let Some(output) = crate::homeostasis::classify_response_emotion(&full_response) {
    crate::homeostasis::update_physiology_from_classifier(&output);
}
```

[ASSUMED: exact location in commands.rs — planner must find the post-stream bookkeeping site]

---

## Common Pitfalls

### Pitfall 1: Forgetting the `suggested_fix` Test
**What goes wrong:** Adding `SignalClass::Hormones` to the enum but not updating the `suggested_fix_table_is_exhaustive` test causes a test panic.
**Why it happens:** The test at doctor.rs line 1104 iterates all known `SignalClass` variants. The match arm count changes from 7×3=21 to 8×3=24.
**How to avoid:** After adding the variant, add 3 arms to `suggested_fix()`, add the variant to the test iterator, and update the `signals.len()` assertion from 7 to 8.
**Warning signs:** `cargo test` panics with `missing string for (Hormones, Green)` or `signals.len() expected 8 found 7`.

### Pitfall 2: mortality_salience Double-Write
**What goes wrong:** `PhysiologicalState.mortality_salience` and `HormoneState.mortality_salience` diverge if the pituitary pass-through is missed.
**Why it happens:** The safety_bundle.rs cap reads from the operational `HormoneState`. If the physiological scalar rises but the operational scalar is not updated, the cap doesn't fire.
**How to avoid:** In `hypothalamus_tick()`, add the pass-through line: `state.mortality_salience = get_physiology().mortality_salience;` after the physiology decay step.
**Warning signs:** Safety eval fixture `mortality_cap_high_value_blocks` passes but behavioral integration test shows mortality_salience not triggering the cap.

### Pitfall 3: Classifier Running on User Input
**What goes wrong:** Classifier accidentally runs on user messages (from `emotional_intelligence.rs` code path) rather than BLADE's output.
**Why it happens:** D-03 is explicit that the two classifiers are separate. If the call site is placed incorrectly (before the LLM call rather than after), it operates on input.
**How to avoid:** The `classify_response_emotion()` call must be in the post-response path, after the streaming loop completes. Assert in tests: classifier always receives `full_response` not `user_message`.
**Warning signs:** Cortisol rises when user sends stressed messages rather than when BLADE's own output contains failure language.

### Pitfall 4: Zero-Floor Degenerate State
**What goes wrong:** Hormone values decay to 0.0 and stay there permanently after a long idle period.
**Why it happens:** `0.5^(elapsed/half_life)` approaches 0 asymptotically but is multiplied with the current value — if it reaches exactly 0.0, the update `0 * decay = 0` forever.
**How to avoid:** Floor all hormone values at 0.01 in the decay function using `.max(0.01)` (or equivalently use `clamp(0.01, 1.0)`).
**Warning signs:** After BLADE is idle for >2 hours, all physiological hormones report 0.0 and the doctor signal shows "all hormones at zero" — which is physiologically incoherent.

### Pitfall 5: AppHandle Not Available in Tauri Command
**What goes wrong:** Emitting hormone threshold events requires an `AppHandle`. The `get_physiology()` public API returns a `PhysiologicalState` with no handle.
**Why it happens:** The threshold-crossing events should be emitted from the caller who HAS the handle (e.g., the `hypothalamus_tick()` caller in `start_hypothalamus()`), not from within `get_physiology()`.
**How to avoid:** Threshold emission logic belongs in `start_hypothalamus()`'s loop body, where `app: tauri::AppHandle` is in scope. `get_physiology()` remains a pure read-only function.
**Warning signs:** Rust compile error "cannot borrow app as immutable while no AppHandle in scope."

### Pitfall 6: Lexicon Performance Regression
**What goes wrong:** Classifier runs on every response but allocates heap memory (e.g., `Vec::new()`, `String::from()`), causing measurable latency on long responses.
**Why it happens:** Lexicon iteration over heap-allocated strings adds GC pressure.
**How to avoid:** Lexicons are `static &[&str]` arrays. Classification loop is `text.contains(word)` over static slices. No allocations in the hot path.
**Warning signs:** Response latency increases by >5ms measured via `tauri::async_runtime` timing.

---

## Code Examples

### Verified: HormoneState OnceLock pattern

```rust
// Source: homeostasis.rs lines 101-113 (VERIFIED)
static HORMONES: OnceLock<Mutex<HormoneState>> = OnceLock::new();
static HYPOTHALAMUS_RUNNING: AtomicBool = AtomicBool::new(false);

fn hormone_store() -> &'static Mutex<HormoneState> {
    HORMONES.get_or_init(|| Mutex::new(load_from_db().unwrap_or_default()))
}

pub fn get_hormones() -> HormoneState {
    hormone_store().lock().map(|h| h.clone()).unwrap_or_default()
}
```

### Verified: Settings table upsert

```rust
// Source: homeostasis.rs lines 685-695 (VERIFIED)
let _ = conn.execute(
    "INSERT INTO settings (key, value) VALUES ('homeostasis', ?1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    rusqlite::params![json],
);
```

### Verified: brain.rs safety injection at priority 2.5

```rust
// Source: brain.rs lines 537-543 (VERIFIED)
let safety_mods = crate::safety_bundle::get_prompt_modulations();
for mod_text in safety_mods {
    if !mod_text.trim().is_empty() {
        parts.push(mod_text);
    }
}
```

### Verified: evolution.rs hormone gate

```rust
// Source: evolution.rs lines 616-631 (VERIFIED)
let gh = crate::homeostasis::growth_hormone();
if gh < 0.3 { return; }
let leptin = crate::homeostasis::get_hormones().leptin;
if leptin > 0.8 { return; }
let insulin = crate::homeostasis::get_hormones().insulin;
if insulin > 0.7 { return; }
```

### Verified: emit_activity_with_id shape

```rust
// Source: ecosystem.rs lines 104-111 (VERIFIED)
let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
    "module":        module,
    "action":        action,
    "human_summary": crate::safe_slice(summary, 200),
    "payload_id":    payload_id,
    "timestamp":     now_secs(),
}));
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Operations-only hormone bus (11 scalars) | Two-layer: physiological (7) + operational (11) | Phase 27 | Behavioral effects now biologically grounded |
| Emotion detection only on user input | Classifier on BLADE's own output + user input (separate modules) | Phase 27 | BLADE tracks its own internal state, not just user state |
| Static system prompt tone | Cortisol-modulated prompt tone (terse/expansive) | Phase 27 | Response style dynamically varies with internal stress |
| Fixed exploration rate in evolution.rs | Dopamine-gated exploration aggressiveness | Phase 27 | Exploration rate responds to internal motivational state |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust `cargo test` (same as all evals) |
| Config file | None — standard cargo test runner |
| Quick run command | `cd src-tauri && cargo test --lib evals::hormone_eval --quiet -- --nocapture --test-threads=1` |
| Full suite command | `cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HORM-01 | 7 scalars with decay constants | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-02 | Classifier runs on ≥50 token response, α=0.05 update | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-03 | Cortisol>0.6 injects terse directive into prompt | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-04 | Low dopamine skips auto_install candidates | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-05 | High NE triggers evolution cycle | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-06 | High ACh lowers `should_ask` confidence threshold | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-07 | Oxytocin gate wired (smoke test) | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-08 | Persist → restart → load recovers state | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |
| HORM-09 | Threshold crossing emits activity_log event | unit | `cargo test --lib evals::hormone_eval` | ❌ Wave 0 |

### verify:hormone script

Following the Phase 26 `verify:safety` pattern, add:
- `scripts/verify-hormone.sh` — wraps `cargo test --lib evals::hormone_eval`
- `package.json` entry: `"verify:hormone": "bash scripts/verify-hormone.sh"`
- Add `&& npm run verify:hormone` to `verify:all` chain

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo check` (batch mode per CLAUDE.md)
- **Per wave merge:** `cd src-tauri && cargo test --lib evals::hormone_eval -- --nocapture --test-threads=1`
- **Phase gate:** Full suite + `verify:hormone` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/src/evals/hormone_eval.rs` — covers HORM-01..09 with deterministic fixtures
- [ ] `src-tauri/src/evals/mod.rs` — add `#[cfg(test)] mod hormone_eval;` line
- [ ] `scripts/verify-hormone.sh` — gate script following verify-safety.sh pattern
- [ ] `package.json` — add `verify:hormone` script and append to `verify:all`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes (classifier lexicon input) | `crate::safe_slice()` already required for user content |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via classifier | Tampering | Classifier runs on BLADE's own output, not user input — user cannot craft input that directly sets hormone values |
| mortality_salience elevation via adversarial responses | Elevation of Privilege | Hard cap at 0.8 in `update_physiology_from_classifier()` — safety_bundle.rs cap remains active |
| Classifier performance DoS on very long responses | Denial of Service | Classify first 2000 chars only; response length check before entering classifier hot path |

---

## Environment Availability

All build tools verified present:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| cargo | Rust compilation | ✓ | 1.94.1 | — |
| node/npx | Frontend build + verify scripts | ✓ | v20.20.1 | — |
| SQLite (via rusqlite) | Physiological state persistence | ✓ | existing | — |

No new external dependencies. Step 2.6: no blocking missing dependencies.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Half-life values (ACh 5 min, cortisol 20 min, etc.) | Decay Constants | Wrong values produce over-damped or oscillating behavior; easily tunable post-ship |
| A2 | Gain multiplier table for emotion clusters | Decay Constants | Wrong gains produce weak or excessive hormone responses; tunable via fixtures |
| A3 | `classify_response_emotion()` call site is post-stream in commands.rs | Architecture | If wrong, need to find the correct call site before coding begins |
| A4 | Blend weight 0.7/0.3 for pituitary translation | Pituitary Translation | Wrong blend may over-suppress or over-amplify operational hormones |
| A5 | Specific lexicon word lists for each emotion cluster | Classifier Lexicon | Wrong lexicon reduces classifier accuracy; α=0.05 smoothing buffers noise significantly |
| A6 | `should_ask` threshold change from 0.3 to 0.4 when ACh > 0.6 | Pattern 7 | Too-aggressive verification increase could produce annoying over-checking behavior |

---

## Open Questions

1. **Where exactly in commands.rs should the classifier call site be?**
   - What we know: `commands.rs` contains `send_message_stream` with a streaming token loop
   - What's unclear: the exact function/line after the full response string is assembled
   - Recommendation: Plan Wave 1 should grep commands.rs for the `blade_message_done` or equivalent completion signal emit — that is the call site

2. **Should serotonin and oxytocin have modulation targets in the requirements?**
   - What we know: HORM-07 wires oxytocin to "personalization depth" — but no concrete integration point is specified
   - What's unclear: which exact part of `brain.rs` should read oxytocin (persona section? DNA injection?)
   - Recommendation: Wire oxytocin to the `"persona" | "communication"` branch of `get_directive()` as a blend weight — lowest-risk, visible effect

3. **Should the hormone eval module use a real `temp_blade_env()` or be purely hermetic?**
   - What we know: `safety_eval.rs` is hermetic (no SQLite, pure function calls)
   - What's unclear: the persist/load test for HORM-08 requires SQLite
   - Recommendation: Use `temp_blade_env()` from `harness.rs` for the HORM-08 persistence test only; all other fixtures hermetic

---

## Sources

### Primary (HIGH confidence)
- `src-tauri/src/homeostasis.rs` — HormoneState struct, OnceLock pattern, persistence, pituitary functions, hypothalamus_tick (full file read)
- `src-tauri/src/doctor.rs` — SignalClass enum, suggested_fix table, compute_metacognitive_signal pattern, doctor_run_full_check, test assertions (full file read)
- `src-tauri/src/brain.rs` lines 530-885 — safety modulation injection, emotional context injection points (read)
- `src-tauri/src/evolution.rs` lines 600-640 — run_evolution_cycle hormone gate pattern (read)
- `src-tauri/src/metacognition.rs` lines 145-197 — assess_cognitive_state, should_ask threshold (read)
- `src-tauri/src/safety_bundle.rs` lines 320-400 — check_mortality_salience_cap, get_prompt_modulations (read)
- `src-tauri/src/ecosystem.rs` lines 95-115 — emit_activity_with_id pattern (read)
- `src-tauri/src/emotional_intelligence.rs` lines 1-100 — EmotionalState struct, get_emotional_context (read)
- `src/features/admin/DoctorPane.tsx` lines 1-62 — DISPLAY_NAME, ROW_ORDER, SignalClass (read)
- `src/lib/tauri/admin.ts` lines 1820-1845 — SignalClass TypeScript union (read)
- `src-tauri/src/evals/safety_eval.rs` — eval module pattern for Wave 0 design (read)
- `.planning/phases/27-hormone-physiology/27-CONTEXT.md` — locked decisions (read)
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q5 — classifier accuracy, α=0.05 rationale, "tracking not steering" boundary (read)

### Secondary (MEDIUM confidence)
- `src-tauri/src/evals/mod.rs` — module registration pattern for new eval (read)
- `scripts/verify-safety.sh` — verify script template for verify:hormone (read)
- `package.json` — verify:all chain structure (read)

### Tertiary (LOW confidence)
- Half-life biological estimates [ASSUMED] — scaled from neuroscience literature but not verified for interactive AI timescale

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new dependencies; all patterns verified in live codebase
- Architecture: HIGH — two-layer approach explicitly specified in CONTEXT.md; code patterns verified
- Pitfalls: HIGH — derived from direct inspection of integration points (doctor.rs tests, safety_bundle.rs cap, commands.rs call site)
- Decay Constants: LOW — biologically-inspired estimates; require empirical tuning
- Classifier Lexicon: LOW — heuristic word lists; require iteration after first deployment

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (codebase changes; re-verify homeostasis.rs/doctor.rs if delayed)
