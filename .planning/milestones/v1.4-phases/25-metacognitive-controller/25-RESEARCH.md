# Phase 25: Metacognitive Controller - Research

**Researched:** 2026-05-02
**Domain:** Rust metacognition module + reasoning pipeline integration + SQLite gap log + DoctorPane extension
**Confidence:** HIGH

---

## Summary

Phase 25 wires BLADE's existing reasoning scaffolding into a proper metacognitive feedback loop: confidence-delta tracking across reasoning steps, automatic secondary verifier routing when confidence drops >0.3 in a single step, proactive gap-surfacing as initiative phrasing rather than hallucination, and a persistent gap log that feeds back into evolution.rs. A new DoctorPane signal row makes the internal state visible.

All the raw ingredients already exist in the codebase. `reasoning_engine.rs` already computes `confidence: f32` on every `ReasoningStep` and has a `critiques`/`revised` cycle. `metacognition.rs` has `CognitiveState` and a `solution_memory` table. `evolution.rs` has `evolution_log_capability_gap`. `doctor.rs` has a clean `SignalClass` enum + `DoctorSignal` type ready for extension. The work is: (1) plumb confidence-delta detection into `reasoning_engine.rs`, (2) add a secondary verifier call when delta > 0.3, (3) add a `metacognitive_gap_log` SQLite table and write to it on low-confidence exits, (4) teach the surface layer to emit initiative phrasing instead of silent refusal, (5) add a `SignalClass::Metacognitive` arm to doctor.rs and update DoctorPane.

**Primary recommendation:** Extend `metacognition.rs` as the central state holder (new `MetacognitiveState` struct + `MetacognitiveSession` ring buffer). Wire `reasoning_engine.rs` to report confidence-deltas back to it. Add the verifier call inside `reasoning_engine.rs::analyze_step` when delta triggers. Gap log goes to a new SQLite table in the existing `blade.db`. Doctor gets one new signal arm.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Confidence-delta detection | Rust / metacognition.rs | reasoning_engine.rs (source of deltas) | Per-step confidence values live in reasoning_engine; metacognition.rs aggregates them into session state |
| Secondary verifier call routing | Rust / reasoning_engine.rs | providers/mod.rs (complete_turn) | Verifier is an extra LLM call that must happen before `chat_done`; must stay inside the turn pipeline |
| Gap surfacing as initiative | Rust / commands.rs tool-loop + reasoning path | brain.rs system prompt | Final surface to user; needs to happen at the reply-emission point, not a background task |
| Gap log persistence | Rust / metacognition.rs | db.rs (SQLite helpers) | Follows existing pattern: module owns table creation + writes; db.rs for shared CRUD |
| evolution.rs feed | Rust / evolution.rs (existing) | metacognition.rs (trigger) | `evolution_log_capability_gap` already exists; metacognition.rs calls it when logging a gap |
| DoctorPane signal row | Rust / doctor.rs (SignalClass enum) | Frontend / DoctorPane.tsx | Signal classification in Rust; row rendering in existing DoctorPane pattern |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| META-01 | BLADE tracks confidence-delta between reasoning steps and flags drops >0.3 as uncertainty markers | `reasoning_engine::ReasoningStep.confidence: f32` already exists; need to compare consecutive step confidences and record when delta > 0.3 |
| META-02 | Low-confidence responses route to a secondary verifier check before surfacing to user | Secondary verifier = extra `complete_turn` call; integration point is inside `reasoning_engine::reason_through` after final synthesis or inside `send_message_stream` tool-loop before emitting final content |
| META-03 | BLADE surfaces capability gaps as initiative ("I'm not confident about X — want me to observe first?") instead of hallucinating or silently refusing | Extend `ego.rs` intercept path OR add a post-synthesis check in `reason_through`; emit phrasing before `chat_done` |
| META-04 | Gap log persists to SQLite and feeds evolution.rs for Voyager-loop skill generation from identified gaps | New `metacognitive_gap_log` table in blade.db; call `evolution::evolution_log_capability_gap` on insert |
| META-05 | Metacognitive state (confidence, uncertainty count, gap count) visible in DoctorPane as a signal row | Add `SignalClass::Metacognitive` to doctor.rs enum; add display name and row order in DoctorPane.tsx |
</phase_requirements>

---

## Standard Stack

### Core (all already in Cargo.toml)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| rusqlite | existing | SQLite gap log table | Same pattern used by reasoning_engine, self_critique, metacognition |
| serde / serde_json | existing | Struct serialization for gap log + doctor signal payload | Used everywhere |
| chrono | existing | Timestamps for gap log rows | Used in every module |
| tauri::Emitter | existing | doctor_event + blade_activity_log emissions | M-07 contract |
| providers::complete_turn | existing | Secondary verifier LLM call | All LLM calls route through this function |

No new dependencies needed. [VERIFIED: codebase grep]

---

## Architecture Patterns

### System Architecture Diagram

```
send_message_stream (commands.rs)
  └── reasoning_engine::reason_through()
       ├── for each step: analyze_step() → ReasoningStep { confidence: f32 }
       │    └── [NEW] confidence_delta_check()
       │         └── if delta > 0.3 → flag UncertaintyMarker, record to MetacognitiveState
       ├── [NEW] secondary_verifier_call() when any step is flagged
       │    └── providers::complete_turn() cheap model, verifier prompt
       │    └── if verifier confirms low confidence → build initiative response
       └── synthesize_answer() → (answer, total_confidence)
            └── [NEW] post-synthesis metacognition check
                 ├── if total_confidence < 0.5 → emit initiative phrasing instead of answer
                 ├── log gap to metacognitive_gap_log
                 └── evolution::evolution_log_capability_gap()

metacognition.rs (central state holder)
  ├── MetacognitiveState { confidence: f32, uncertainty_count: u32, gap_count: u32 }
  ├── SESSION ring buffer (last 50 turns)
  ├── log_gap(topic, request) → SQLite insert + evolution feed
  └── get_doctor_signal() → DoctorSignal { class: Metacognitive, payload: {...} }

doctor.rs
  ├── SignalClass::Metacognitive (new arm)
  ├── compute_metacognitive_signal() → calls metacognition::get_doctor_signal()
  └── doctor_run_full_check() — extend tokio::join! with new source

DoctorPane.tsx
  ├── DISPLAY_NAME: add 'metacognitive': 'Metacognitive'
  └── ROW_ORDER: append 'metacognitive' at tail (least volatile)
```

### Recommended Project Structure (additions only)

```
src-tauri/src/
├── metacognition.rs         # EXTEND: add MetacognitiveState, MetacognitiveSession,
│                            #         log_gap(), get_doctor_signal(), secondary verifier hook
└── doctor.rs                # EXTEND: SignalClass::Metacognitive + suggested_fix arm
                             #         + compute_metacognitive_signal() + join! extension

src/features/admin/
└── DoctorPane.tsx           # EXTEND: DISPLAY_NAME + ROW_ORDER additions

(no new files needed)
```

### Pattern 1: Confidence-Delta Detection in reasoning_engine.rs

**What:** Compare confidence of consecutive `ReasoningStep` objects. If any step drops > 0.3 from the previous, flag it as an uncertainty marker and record to `MetacognitiveState`.

**When to use:** Inside `reason_through()`, after each `analyze_step()` call, before the final synthesis.

```rust
// Source: codebase — reasoning_engine.rs::reason_through() extension point
// After each step completes:
let delta = prior_confidence - step.confidence; // positive = confidence dropped
if delta > 0.3 {
    crate::metacognition::record_uncertainty_marker(&step.thought, delta);
}
prior_confidence = step.confidence;
```

**Key constraint:** `prior_confidence` initializes to the previous step's confidence, not to 1.0. The first step has no delta to compute (no prior). [VERIFIED: reasoning_engine.rs analysis]

### Pattern 2: Secondary Verifier Call

**What:** When a step is flagged (or total_confidence < 0.5 post-synthesis), make a second LLM call with a verifier prompt asking "Is this answer reliable?" The verifier returns a JSON object with `verified: bool` and `concern: String`. If `verified: false`, build the initiative phrasing instead of the normal answer.

**When to use:** After `synthesize_answer()` returns in `reason_through()`, OR after the final iteration of the tool-loop in `send_message_stream` when `total_confidence < 0.5`.

```rust
// Source: ASSUMED — design pattern consistent with decision_gate.rs::llm_classify
async fn secondary_verifier_call(
    question: &str,
    answer: &str,
    concerns: &[String],
) -> (bool, String) {
    let config = crate::config::load_config();
    let cheap = crate::config::cheap_model_for_provider(&config.provider, &config.model);
    let system = "You are a strict answer verifier. Return JSON only: \
                  {\"verified\": true/false, \"concern\": \"one sentence if not verified\"}";
    let user_msg = format!(
        "Question: {}\nProposed answer: {}\nConcerns raised during reasoning: {}",
        question, answer, concerns.join("; ")
    );
    // ... complete_turn call, parse JSON
    // Returns (verified, concern_text)
}
```

**Integration point:** The verifier call uses `cheap_model_for_provider` to avoid adding latency on frontier models. Budget: 1 extra LLM call per flagged response. [ASSUMED: latency acceptable; no measurement done in this session]

### Pattern 3: Initiative Phrasing

**What:** When confidence is too low to surface the answer, substitute the answer with the canonical initiative phrase from META-03.

**When to use:** After secondary verifier returns `verified: false`, OR when `reason_through` total_confidence < threshold and no verifier was attempted (fallback).

```rust
// Source: ASSUMED — design consistent with ego.rs::handle_refusal initiative pattern
fn build_initiative_response(topic: &str) -> String {
    format!(
        "I'm not confident about {} — want me to observe first?",
        topic
    )
}
```

**Note:** The exact wording in the success criteria is verbatim: "I'm not confident about X — want me to observe first?" — preserve this phrasing. [VERIFIED: ROADMAP.md success criteria §2]

### Pattern 4: Gap Log Table (metacognitive_gap_log)

**What:** New SQLite table in blade.db. Created by `metacognition.rs::ensure_gap_log_table()` following the same `execute_batch` pattern used in `reasoning_engine.rs::ensure_tables()` and `self_critique.rs::ensure_tables()`.

```sql
-- Source: consistent with existing reasoning_traces + self_critiques schema patterns
CREATE TABLE IF NOT EXISTS metacognitive_gap_log (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,          -- what BLADE was uncertain about
    user_request TEXT NOT NULL,   -- the triggering user message
    confidence REAL NOT NULL,     -- final confidence at time of gap detection
    uncertainty_count INTEGER DEFAULT 1, -- how many step-delta flags fired
    initiative_shown INTEGER DEFAULT 0,  -- 1 if we showed the "want me to observe?" message
    created_at INTEGER NOT NULL,
    fed_to_evolution INTEGER DEFAULT 0   -- 1 after evolution_log_capability_gap called
);
```

[VERIFIED: schema pattern from self_critique.rs, reasoning_engine.rs, metacognition.rs solution_memory table]

### Pattern 5: MetacognitiveState — Global Ring Buffer

**What:** A static `OnceLock<Mutex<MetacognitiveState>>` in `metacognition.rs`. Tracks current session confidence, cumulative uncertainty_count, and gap_count. Updated after every reasoning session. Persisted to SQLite so it survives restarts. Readable via Tauri command for DoctorPane.

```rust
// Source: consistent with homeostasis.rs::HormoneState pattern
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MetacognitiveState {
    pub confidence: f32,          // last resolved turn confidence (0.0–1.0)
    pub uncertainty_count: u32,   // cumulative delta>0.3 flags since session start
    pub gap_count: u32,           // cumulative gaps logged to SQLite
    pub last_updated: i64,
}

static META_STATE: OnceLock<Mutex<MetacognitiveState>> = OnceLock::new();
```

[VERIFIED: homeostasis.rs pattern — identical OnceLock<Mutex<...>> structure]

### Pattern 6: DoctorPane Extension (TypeScript)

**What:** Add `metacognitive` to `SignalClass`, `DISPLAY_NAME`, and `ROW_ORDER` in `DoctorPane.tsx` following the Phase 23 precedent (RewardTrend appended at tail).

```typescript
// Source: DoctorPane.tsx — Phase 23 pattern for appending a new signal at tail
// In DISPLAY_NAME:
metacognitive: 'Metacognitive'

// In ROW_ORDER (append at tail, least volatile):
const ROW_ORDER: SignalClass[] = [
  'eval_scores', 'capability_gaps', 'tentacle_health',
  'config_drift', 'auto_update', 'reward_trend', 'metacognitive',
];
```

[VERIFIED: DoctorPane.tsx lines 40-58 — Phase 23 added reward_trend at tail; same pattern applies]

### Anti-Patterns to Avoid

- **Blocking chat_done on slow verifier:** The secondary verifier call adds one LLM round-trip. This MUST use the cheap model (`cheap_model_for_provider`), not the frontier model. Do NOT gate `chat_done` behind an expensive model call — this violates the streaming latency contract. [ASSUMED: cheap model latency < 3s is acceptable]
- **Spawning gap log as tokio::spawn:** Gap log must complete before initiative phrasing is emitted; don't fire-and-forget it. After the SQLite write succeeds, *then* decide whether to show initiative phrasing. The evolution feed CAN be spawned in background.
- **Using &text[..n] on topic string:** As with all user content — use `crate::safe_slice(topic, 120)` when slicing for the gap log. [VERIFIED: CLAUDE.md rule]
- **Duplicate #[tauri::command] name:** Any new command in metacognition.rs must not duplicate names already in lib.rs. `metacognition_assess` is already registered; any new command (e.g. `metacognition_get_state`) must be a fresh name. [VERIFIED: lib.rs line 1376]
- **Forgetting the 6-place config rule:** If any config field is added to BladeConfig for the metacognition confidence threshold, ALL 6 places must be updated. Most likely this phase does NOT need a config field — the 0.3 delta threshold can be a `const`. [VERIFIED: CLAUDE.md]
- **Empty `match` arm in `suggested_fix`:** The `doctor.rs::suggested_fix` function has an exhaustive match on `(SignalClass, Severity)`. Adding `SignalClass::Metacognitive` without adding all three severity arms will cause a compile error. All three arms (Green/Amber/Red) must be added together. [VERIFIED: doctor.rs lines 92-141]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM call for verifier | Custom HTTP client | `providers::complete_turn` | All LLM calls route through this; provider fallback, error classification, cardiovascular tracking all built in |
| Confidence threshold config | BladeConfig field | `const CONFIDENCE_DELTA_THRESHOLD: f32 = 0.3` | The spec locks the threshold at 0.3; a const is sufficient and avoids the 6-place config tax |
| Gap detection | New detection module | Extend existing `metacognition.rs` | Module already has `assess_cognitive_state`, `solution_memory` — adding gap log is additive, not a new abstraction |
| Activity strip emission | Custom event | `blade_activity_log` emit following doctor.rs pattern | M-07 contract defines the format; deviation breaks ActivityStrip rendering |
| Capability gap feed | Direct DB insert into evolution table | `crate::evolution::evolution_log_capability_gap(capability, user_request)` | This function already exists and writes to the timeline; calling it is the contract |

---

## Runtime State Inventory

This is a greenfield feature addition (not a rename/refactor). No runtime state inventory is needed. The only stored data is the new `metacognitive_gap_log` table which will be created fresh by `ensure_gap_log_table()` on first call.

---

## Common Pitfalls

### Pitfall 1: Verifier fires on EVERY response, not just flagged ones

**What goes wrong:** Planner wires the secondary verifier call unconditionally after every `reason_through` call, adding 1–2s latency to every chat response.

**Why it happens:** The META-02 requirement says "low-confidence responses route to a secondary verifier" — but "low-confidence" must be defined precisely as: a `ReasoningStep` with delta > 0.3 was detected (META-01 flag), or `total_confidence < 0.5`.

**How to avoid:** Gate the verifier call behind a boolean `any_uncertainty_flag` accumulated during the step loop. Only call verifier when the flag is true.

**Warning signs:** If dev-mode test shows verifier being called for simple one-step answers, the gate is missing.

### Pitfall 2: reasoning_engine path vs tool-loop path

**What goes wrong:** Phase only wires metacognition into `reason_through` but the tool-loop path in `send_message_stream` (iteration 0..12) never hits `reason_through`. A user asking a direct question that bypasses the reasoning engine gets no metacognitive coverage.

**Why it happens:** `is_reasoning_query()` in commands.rs gates whether `reason_through` is called. Most messages skip it and go straight to the tool-loop.

**How to avoid:** For META-02 and META-03, the tool-loop final-response path also needs a lightweight confidence check. The existing `metacognition::assess_cognitive_state()` already runs at system-prompt-build time (brain.rs injection); after the tool-loop final response, re-run `assess_cognitive_state(last_user_text)` and if `confidence < 0.5`, substitute the initiative response and log a gap. This is lighter than running a full verifier LLM call in the tool-loop.

**Warning signs:** Success criterion §1 says "a response with a reasoning step that drops confidence" — the reasoning engine IS the primary target. The tool-loop coverage can be a lightweight fallback.

### Pitfall 3: doctor.rs exhaustive match compile error

**What goes wrong:** `SignalClass::Metacognitive` is added to the enum but `suggested_fix()` and/or `emit_activity_for_doctor()` don't cover it, causing a compile error.

**Why it happens:** Both functions have exhaustive `match` on `SignalClass`. Adding a new variant without adding all arms fails `cargo check`.

**How to avoid:** Search for every `match signal.class` and `match (class, severity)` in doctor.rs before shipping. There are at least 3 match sites: `suggested_fix()`, `emit_activity_for_doctor()`, and possibly `compute_*` dispatch logic.

**Warning signs:** `cargo check` will catch this immediately.

### Pitfall 4: DoctorPane.tsx TypeScript union mismatch

**What goes wrong:** `SignalClass` in TypeScript (`src/lib/tauri/admin.ts` or similar) is a string union type. Adding the Rust variant without updating the TS type causes "Object literal may only specify known properties" errors.

**Why it happens:** The TS type is defined separately from the Rust enum. Phase 23 (RewardTrend) set the precedent — both Rust and TS must be updated together.

**How to avoid:** Find the TS definition of `SignalClass` (likely in `src/lib/tauri/admin.ts`) and add `'metacognitive'` to the union. Also update `DISPLAY_NAME` and `ROW_ORDER` in `DoctorPane.tsx`.

**Warning signs:** `npx tsc --noEmit` will catch this.

### Pitfall 5: evolution_log_capability_gap is fire-and-forget vs blocking

**What goes wrong:** The gap is logged to SQLite but `evolution_log_capability_gap` is not called, so the Voyager loop never sees the gap. Or it's called with an empty `capability` string.

**Why it happens:** `evolution_log_capability_gap(capability, user_request)` expects the capability noun (what BLADE couldn't do), not the full user message. The `topic` extracted during gap detection must be the specific capability gap, not the whole query.

**How to avoid:** Extract a capability noun from the low-confidence response context (e.g., from the `uncertainty_reason` field of `CognitiveState`, or from the step's `thought` content). Map it to a short capability string before calling `evolution_log_capability_gap`.

**Warning signs:** Evolution logs showing `capability: ""` or `capability: "answer this question"`.

### Pitfall 6: MetacognitiveState not persisted across restarts

**What goes wrong:** `gap_count` and `uncertainty_count` reset to 0 on every restart, making the DoctorPane signal always Green after restart.

**Why it happens:** If `MetacognitiveState` is only held in memory (OnceLock) without persistence, it loses state on process exit.

**How to avoid:** Persist `MetacognitiveState` to a SQLite row in blade.db on each update (e.g., a `metacognitive_state` row in the `settings` table, JSON-encoded — same pattern as `decision_gate_thresholds` in decision_gate.rs). Load on init.

**Warning signs:** DoctorPane always shows Green immediately after restarting BLADE.

---

## Code Examples

### gap_log insert following existing patterns

```rust
// Source: metacognition.rs solution_memory pattern + db.rs report_capability_gap pattern
pub fn log_gap(topic: &str, user_request: &str, confidence: f32, uncertainty_count: u32) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let id = format!("meta-gap-{}", chrono::Utc::now().timestamp_millis());
        let now = chrono::Utc::now().timestamp();
        let _ = conn.execute(
            "INSERT INTO metacognitive_gap_log
             (id, topic, user_request, confidence, uncertainty_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                id,
                crate::safe_slice(topic, 120),
                crate::safe_slice(user_request, 300),
                confidence as f64,
                uncertainty_count as i64,
                now,
            ],
        );
        // Feed to evolution Voyager loop
        let _ = crate::evolution::evolution_log_capability_gap(
            topic.to_string(),
            user_request.to_string(),
        );
        // Update in-memory state
        if let Ok(mut state) = META_STATE.get_or_init(|| Mutex::new(MetacognitiveState::default())).lock() {
            state.gap_count += 1;
            state.confidence = confidence;
            state.last_updated = now;
        }
    }
}
```

### Doctor signal computation

```rust
// Source: doctor.rs::compute_reward_signal pattern (Phase 23)
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

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static confidence in `assess_cognitive_state` (one-shot before response) | Dynamic confidence tracking across reasoning steps with delta detection | Phase 25 | Enables per-step uncertainty detection, not just pre-response heuristic |
| "I can't do X" refusal → ego.rs intercept + retry | "I'm not confident about X — want me to observe first?" initiative phrasing | Phase 25 | Proactive surfacing before hallucination, not reactive interception |
| Gap detection via `reports.rs` pattern-match on response text | Metacognitive gap log from internal confidence state | Phase 25 | Catches low-confidence gaps that don't produce a refusal-patterned response |

**Deprecated/outdated:**
- `metacognition::assess_cognitive_state()` as the sole confidence signal: it runs once before the response. Phase 25 keeps this but adds step-level tracking alongside it.

---

## Environment Availability

Step 2.6 SKIPPED (no external dependencies — all libraries already in Cargo.toml; SQLite via rusqlite already present). [VERIFIED: Cargo.toml — rusqlite, serde, chrono, tauri all present]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[cfg(test)]` + existing eval harness |
| Config file | none — standard `cargo test` |
| Quick run command | `cd src-tauri && cargo test metacognition` |
| Full suite command | `npm run verify:all` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| META-01 | Confidence delta >0.3 between steps is flagged | unit | `cargo test metacognition::test_confidence_delta_flag` | ❌ Wave 0 |
| META-02 | Flagged response routes to secondary verifier | unit (mock provider) | `cargo test metacognition::test_verifier_routing` | ❌ Wave 0 |
| META-03 | Initiative phrasing emitted instead of hallucinated answer | unit | `cargo test metacognition::test_initiative_phrasing` | ❌ Wave 0 |
| META-04 | Gap log row inserted + evolution_log_capability_gap called | unit | `cargo test metacognition::test_gap_log_insert` | ❌ Wave 0 |
| META-05 | DoctorPane signal row reflects confidence/uncertainty/gap | unit | `cargo test doctor::test_metacognitive_signal` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo test metacognition -- --nocapture`
- **Per wave merge:** `cd src-tauri && cargo check && npx tsc --noEmit`
- **Phase gate:** `npm run verify:all` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/src/metacognition.rs` — add unit tests for `record_uncertainty_marker`, `log_gap`, `get_state` covering META-01..04
- [ ] `src-tauri/src/doctor.rs` — add unit test for `compute_metacognitive_signal` covering META-05
- [ ] Test isolation: `metacognitive_gap_log` table must be created in a temp DB in tests (use `BLADE_TEST_DB` env pattern if one exists, or create an in-memory `:memory:` SQLite connection in test helpers)

*(No new test framework needed — existing `#[cfg(test)]` pattern covers all requirements)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `crate::safe_slice` on all user content before SQLite insert |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via topic/user_request in gap log | Tampering | rusqlite parameterized queries (`params![]`) — same pattern used in all existing DB writes |
| Prompt injection via initiative phrasing | Spoofing | Fixed format string — topic is truncated by `safe_slice` before being embedded in the initiative phrase |
| Verifier LLM call leaking user content to unintended provider | Information Disclosure | `verifier_call` must use the same provider/API key as the primary call, not a hardcoded provider |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Secondary verifier using cheap model adds < 3s latency (acceptable for low-confidence paths) | Standard Stack, Pattern 2 | If latency is unacceptable, verifier must be made async-fire-and-forget, which means initiative phrasing can't be shown synchronously — changes META-02 design |
| A2 | `doctor_run_full_check` is called periodically (not just on demand) so MetacognitiveState values will be fresh when DoctorPane renders | Validation Architecture | If check is only on demand, gap_count may lag; still correct at time of manual check |
| A3 | The 0.3 confidence delta threshold matches the spec exactly; no tuning needed for Phase 25 | Pattern 1 | Wrong threshold produces too many or too few verifier calls; success criterion §1 is explicit so threshold is locked |

---

## Open Questions

1. **Tool-loop path coverage for META-02**
   - What we know: `reason_through` is gated by `is_reasoning_query()` — most chat messages skip it. META-02 says "low-confidence responses route to a secondary verifier" — this implies ALL responses, not just reasoning-engine responses.
   - What's unclear: Should the tool-loop (12 iterations in commands.rs) also have a verifier call? Or is the scope limited to the `reason_through` path?
   - Recommendation: Scope to `reason_through` path for Phase 25 (primary success criterion §1 references "reasoning step"). Add a lightweight `assess_cognitive_state` fallback in the tool-loop. Document this in the plan as a "Lite coverage" note.

2. **DoctorPane TypeScript SignalClass definition location**
   - What we know: `DoctorPane.tsx` imports `SignalClass` from `@/lib/tauri/admin`. The file was not read in this research session.
   - What's unclear: Exact file path and whether `SignalClass` is a TypeScript union type or a Zod schema.
   - Recommendation: Planner should read `src/lib/tauri/admin.ts` before writing the DoctorPane task.

3. **doctor_run_full_check invocation frequency**
   - What we know: The function exists and is called from DoctorPane via button press. Whether it's polled automatically is not verified.
   - What's unclear: Whether gap_count in DoctorSignal payload will be stale unless user manually triggers a check.
   - Recommendation: Not a blocker for Phase 25 — manual check still satisfies success criterion §4.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `src-tauri/src/metacognition.rs` — existing `CognitiveState`, `assess_cognitive_state`, `solution_memory` table, `get_solution_injection` — all verified by direct read
- Codebase: `src-tauri/src/reasoning_engine.rs` — `ReasoningStep.confidence: f32`, `critique_step`, `revise_step`, `synthesize_answer` — verified
- Codebase: `src-tauri/src/doctor.rs` — `SignalClass` enum, `DoctorSignal` struct, `suggested_fix` exhaustive match, `compute_reward_signal` pattern — verified
- Codebase: `src/features/admin/DoctorPane.tsx` — `DISPLAY_NAME`, `ROW_ORDER`, Phase 23 RewardTrend append pattern — verified
- Codebase: `src-tauri/src/evolution.rs::evolution_log_capability_gap` — function signature and behavior — verified
- Codebase: `src-tauri/src/homeostasis.rs` — `OnceLock<Mutex<HormoneState>>` pattern for persistent global state — verified
- Codebase: `src-tauri/src/decision_gate.rs` — `llm_classify` pattern for cheap secondary LLM calls — verified
- Codebase: `src-tauri/src/commands.rs` — integration points (reasoning path + tool-loop), `emit_stream_event`, `metacognition::remember_solution` call sites — verified
- Codebase: `.planning/REQUIREMENTS.md` — META-01..05 exact spec — verified
- Codebase: `.planning/ROADMAP.md` — Phase 25 success criteria verbatim — verified

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — confirms `decision_gate.rs` has single confidence scalar as substrate for Phase 25; confirmed pre-existing modules list

### Tertiary (LOW confidence)
- A1, A2, A3 in Assumptions Log — design decisions not verified against runtime measurement

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all libraries are already in use; no new deps needed
- Architecture: HIGH — all integration points identified and verified against actual source files
- Pitfalls: HIGH — derived from direct code analysis of exact modules in scope
- Test patterns: MEDIUM — test file locations inferred from cargo test conventions; no existing metacognition tests found to verify against

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (stable internal API; no external dependencies)
