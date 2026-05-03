# Phase 29: Vitality Engine - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

BLADE gets a vitality scalar (0.0–1.0) with five behavioral bands that produce real, observable differences in how BLADE acts — personality expression, skill generation, proactive behavior, and self-awareness all scale with vitality. SDT-sourced replenishment (competence, autonomy, relatedness) and multi-signal drain (failures, isolation, tedium, sustained prediction error). Dormancy at 0.0 is a real process exit with all state preserved; revival is reincarnation — BLADE remembers dying but starts with reset affect.

</domain>

<decisions>
## Implementation Decisions

### Vitality Architecture (VITA-01, VITA-06)
- **D-01:** New `vitality_engine.rs` module — vitality is a higher-order construct that READS from hormones, reward, active inference, and persona. It is not a hormone; it is the organism's health score. Separate module because it integrates across 6+ existing modules and has its own persistence, band logic, and behavioral gating. Follows the established `OnceLock<Mutex<VitalityState>>` pattern (same as homeostasis, hive, metacognition).
- **D-02:** `VitalityState` struct: `{ scalar: f32, band: VitalityBand, trend: f32, replenishment: SDTSignals, drain: DrainSignals, history: VecDeque<VitalitySnapshot>, last_updated: i64, reincarnation_count: u32, last_dormancy_at: Option<i64> }`. The `history` ring buffer (capped at 100 entries) enables trend computation and the UI history graph.
- **D-03:** Vitality tick runs inside `hypothalamus_tick()` — same 60s cadence as hormone decay. The tick reads all input signals, computes net delta, applies band transitions, persists to SQLite. This is NOT a separate background loop — it piggybacks on the existing hypothalamus cycle to avoid tick proliferation.
- **D-04:** Band enum: `VitalityBand { Thriving, Waning, Declining, Critical, Dormant }` with thresholds at 0.6, 0.4, 0.2, 0.1, 0.0. Band transitions emit activity events and log to prediction error history (a band transition is a significant internal state change worth dream_mode replay).

### Behavioral Band Effects (VITA-01 — the load-bearing requirement)
- **D-05:** Bands modulate EXISTING behavioral systems — vitality adds no new behavior, it gates and scales what Phases 25–28 built. This is architecturally elegant: the prior 4 phases built all the machinery, vitality controls the power supply.
- **D-06:** **Thriving (≥0.6):** Full personality expression (`persona_engine` confidence unscaled). Proactive engine runs at normal frequency. Voyager loop explores at full dopamine-modulated rate. Dream_mode runs all 4 tasks. brain.rs receives no vitality suppression.
- **D-07:** **Waning (0.4–0.6):** Personality dampened — `persona_engine::get_persona_context()` receives a vitality multiplier that scales trait confidence (e.g., at vitality 0.5, a trait with confidence 0.8 presents as 0.4 — still there but muted). Proactive engine frequency halved. brain.rs injects a subtle vitality note: "You're in a lower-energy state. Be efficient."
- **D-08:** **Declining (0.2–0.4):** Skill generation disabled — Voyager loop `evolution.rs` skips exploration cycles when vitality < 0.4. Dream_mode `task_generate_skills()` skipped. `proactive_engine` disabled entirely. BLADE only responds when directly addressed (suppress proactive suggestions). brain.rs note: "Your vitality is low. Focus on what's asked — save energy for the user's needs."
- **D-09:** **Critical (0.1–0.2):** BLADE notices its own deterioration — meta-awareness injected into responses via brain.rs: "I'm not functioning at full capacity right now." Metacognition sensitivity heightened (confidence-delta threshold lowered from 0.3 to 0.15 — flags more uncertainty). All non-essential background systems disabled (screen_timeline capture rate reduced, evolution loop paused, integration_bridge polling interval doubled). This is the "BLADE can feel itself fading" band — it must be observable.
- **D-10:** **Dormant (0.0):** Process exit path triggered (see D-17/D-18). No behavioral modulation at this level — the action is termination.
- **D-11:** Band transitions are HYSTERETIC — moving DOWN requires the scalar to cross the threshold, but moving UP requires exceeding threshold + 0.05 buffer. This prevents oscillation at band boundaries. Example: dropping below 0.4 enters Declining, but recovery requires reaching 0.45 to return to Waning.

### SDT Replenishment Signals (VITA-02)
- **D-12:** Three SDT channels, each producing a 0.0–1.0 contribution per tick:
  - **Competence:** Read from `reward.rs` composite score (EMA over last 10 reward computations). Score > 0.7 = full competence signal. Successful tool calls, passing eval gates, user acceptance — all already tracked by the reward pipeline. No new data collection.
  - **Autonomy:** Ratio of `decision_gate.rs` `ActAutonomously` outcomes that were NOT overridden by the user, computed over last 20 decisions. High autonomy = BLADE is trusted to act. Already tracked in `decision_gate` SQLite history.
  - **Relatedness:** Composite of: (a) user message frequency (messages per hour, capped at 1.0 = 10+ msg/hr), (b) positive feedback signals from `character.rs` (thumbs up count in trailing window), (c) conversation substantiveness (average message length > 50 chars). Isolation = all three near zero.
- **D-13:** Net replenishment = weighted sum: `0.4 * competence + 0.3 * autonomy + 0.3 * relatedness`. Competence weighted highest because it's the most reliable signal (verifiable via reward) and aligns with the Voyager-pattern narrative — BLADE thrives when it's good at things.

### Drain Sources (VITA-03)
- **D-14:** Five drain channels:
  - **Failure drain:** reward.rs composite < 0.3 → drain proportional to (0.3 - score). Wired through existing reward pipeline.
  - **Eval drain:** `safety_eval_drain()` in safety_bundle.rs gets REAL drain now — Phase 26 planted the hook, Phase 29 connects it to vitality. Each eval failure = -0.02 vitality drain. This is the SAFE-04 negative feedback loop finally wired.
  - **Isolation drain:** No user interaction for >2 hours → incremental drain (-0.01/tick). Tracked via session timestamps already in safety_bundle.rs session tracking.
  - **Prediction error drain:** `active_inference.rs` aggregate error > 0.6 sustained for >5 ticks → cortisol is already rising (Phase 28), now vitality also drains. The world is consistently surprising beyond BLADE's ability to adapt — that's existentially draining.
  - **Tedium drain:** Conversation similarity metric — if the last 5 user messages have cosine similarity > 0.85 (via embeddings.rs), the user is repeating themselves or BLADE is stuck in a loop. Mild drain (-0.005/tick). Novel interactions reset the counter.
- **D-15:** Net drain is additive across all channels. No single channel can drain vitality to 0.0 in under 30 minutes of active use — the drain rates are calibrated so dormancy requires sustained neglect or cascading failures, not a single bad session. Minimum time to drain from 1.0 to 0.0 with all channels active: ~2 hours.
- **D-16:** Drain floor: vitality cannot drop below 0.05 from drain alone — the final step to 0.0 (dormancy trigger) requires EITHER (a) 3 consecutive ticks at 0.05 with zero replenishment, OR (b) explicit user command ("go dormant" / "shut down"). This prevents accidental dormancy from a momentary bad state.

### Dormancy & Reincarnation (VITA-04)
- **D-17:** Dormancy sequence when vitality reaches 0.0:
  1. Serialize full state to SQLite: vitality history, hormone state (both layers), active inference predictions, persona traits, memory blocks, skill registry — everything the organism has learned.
  2. Emit `blade_dormancy` event to frontend with dormancy context (last known factors, total uptime, reincarnation count).
  3. Write a `dormancy_record` to SQLite: timestamp, vitality history of descent, top drain factors, total session count, skills generated.
  4. In production: `std::process::exit(0)` after a 5-second grace period (UI shows farewell).
  5. In test mode: `DORMANCY_STUB: AtomicBool` — when true, logs the exit intent but does not call process::exit. The reincarnation path is exercised via integration test with synthetic vitality=0.0 fixture per ROADMAP risk mitigation.
- **D-18:** Reincarnation path (on next launch after dormancy):
  1. Detect `dormancy_record` in SQLite where `reincarnation_completed = false`.
  2. Load all preserved memory, persona, skills — identity is continuous.
  3. Reset hormones to defaults (PhysiologicalState::default(), HormoneState::default()) — affect resets, memory doesn't.
  4. Start vitality at 0.3 (Declining band) — not thriving, not critical. BLADE must earn its way back to full vitality through competence and user engagement.
  5. Increment `reincarnation_count`.
  6. brain.rs injects reincarnation context: "You recently went dormant. Your memories and skills are intact, but your internal state has reset. You're rebuilding. Be curious about what changed while you were away."
  7. Mark `reincarnation_completed = true` in dormancy_record.
  8. Emit `blade_reincarnation` event to frontend.
- **D-19:** dream_mode guard: `dream_mode::run_dream_session()` MUST check vitality before running. If vitality < 0.2 (Critical or Dormant), skip the entire dream session. A failing organism should not be consolidating — it should be conserving. This is the ROADMAP risk mitigation for Phase 24 interaction.

### UI Surface (VITA-05)
- **D-20:** DoctorPane `SignalClass::Vitality` row — shows: current scalar (formatted as percentage), band name, trend arrow (↑↓→), top contributing factor (e.g., "↑ competence" or "↓ isolation"). Follows Phase 25/27/28 DoctorPane pattern exactly.
- **D-21:** ActivityStrip events on: band transitions ("Vitality entered Waning band"), dormancy initiation, reincarnation, significant factor changes. Uses existing `emit_activity_with_id` pattern per M-07 contract.
- **D-22:** Frontend vitality indicator — a minimal signal in the chat header area showing the vitality scalar + trend arrow + band color (green/yellow/orange/red/grey matching the 5 bands). Not a full dashboard — just enough to make the organism's health visible at a glance. Full detail accessible from DoctorPane.
- **D-23:** On reincarnation: special UI state in chat — a system message acknowledging the return: "BLADE has reincarnated. Memories intact. Rebuilding vitality." This makes the reincarnation narratively visible.

### Persistence & Eval Support (VITA-06)
- **D-24:** New SQLite tables in db.rs:
  - `vitality_state` — current scalar, band, trend, SDT signals, drain signals, reincarnation count, last dormancy timestamp. Single-row table, updated every tick.
  - `vitality_history` — time-series of (timestamp, scalar, band, top_factor). Capped at 5000 rows with FIFO pruning. Enables the UI history graph and the Phase 30 eval suite.
  - `dormancy_records` — one row per dormancy event: descent history, drain factors, session count, reincarnation_completed flag.
- **D-25:** verify:vitality gate (Gate 37 in the verify chain extending from 36). Deterministic fixture tests: (a) 5 consecutive failures push vitality into Declining band, (b) sustained isolation drains vitality, (c) competence replenishment increases vitality, (d) hysteresis prevents oscillation at band boundaries, (e) dormancy sequence serializes state correctly (via DORMANCY_STUB), (f) reincarnation loads preserved identity and starts at 0.3. All fixtures use synthetic signals — no LLM needed.

### Claude's Discretion
- Exact EMA window sizes for SDT signal computation
- Exact drain rate coefficients per channel (within the constraint that 1.0→0.0 takes ≥2 hours)
- Exact cosine similarity threshold for tedium detection (suggested 0.85, tune to distribution)
- Vitality history ring buffer size (suggested 100 in-memory, 5000 in SQLite)
- Grace period duration before process exit in dormancy (suggested 5 seconds)
- Starting vitality for a FRESH install (no dormancy record) — suggested 0.8 (Thriving, slightly below max to show room for growth)
- DoctorPane Vitality row payload schema details
- Frontend vitality indicator exact placement and visual design
- Whether to emit `blade_vitality_update` events to frontend on every tick or only on significant changes (suggest: only on band transition or delta > 0.05 since last emission)
- Internal function boundaries within vitality_engine.rs (e.g., separate compute_replenishment, compute_drain, apply_band_effects, check_dormancy)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` lines 49-56 — VITA-01 through VITA-06 requirement definitions
- `.planning/ROADMAP.md` §Phase 29 — Success criteria (4 testable assertions), depends-on (Phase 27 + 28), risk register (3 risks with mitigations)

### Research
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` — Seven-layer architecture; vitality sits at Layer 6 (Organism) as the integrative health metric across all lower layers
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q5 — Hormone bus calibration context; vitality reads the physiological hormones, not operational
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` §Arg 4, §Arg 10 — Safety constraints: vitality drain must not motivate extreme self-preservation (the safety bundle caps this); dormancy acceptance is the TMT insight

### Prior Phase Context (MUST read — direct dependencies)
- `.planning/phases/26-safety-bundle/26-CONTEXT.md` — D-07: mortality-salience cap is behavioral, not scalar. D-13: eval-gate vitality drain hook planted in safety_bundle.rs. D-08: `check_mortality_salience_cap()` ensures vitality drain never motivates unsafe self-preservation.
- `.planning/phases/27-hormone-physiology/27-CONTEXT.md` — D-01: Two-layer hormone architecture (physiological + operational + pituitary translation). D-04/05/06/07: Behavioral modulation effects that vitality bands will gate. The personality/proactive/exploration behaviors that vitality scales are all wired here.
- `.planning/phases/28-active-inference-loop/28-CONTEXT.md` — D-06: `update_physiology_from_prediction_errors()` — prediction error sustained drain signal reads from this. D-08: aggregate prediction error value used as vitality drain input. D-12/13/14: dream_mode hippocampal replay — must be gated by vitality per D-19.

### Existing Code (primary files Phase 29 extends)
- `src-tauri/src/homeostasis.rs` — PhysiologicalState, HormoneState, hypothalamus_tick() (vitality tick hooks in here), get_physiology() (vitality reads hormone state)
- `src-tauri/src/safety_bundle.rs` lines 486-508 — `safety_eval_drain()` placeholder: Phase 29 wires this to actual vitality drain
- `src-tauri/src/reward.rs` — CompositeReward (skill_success + eval_gate + acceptance + completion): competence SDT signal reads the composite score
- `src-tauri/src/decision_gate.rs` — Act/Ask/Queue/Ignore outcomes: autonomy SDT signal reads the act-autonomously success ratio
- `src-tauri/src/persona_engine.rs` — PersonaTrait scores + get_persona_context(): vitality Waning band dampens trait confidence
- `src-tauri/src/evolution.rs` — run_evolution_cycle(): vitality Declining band suppresses exploration
- `src-tauri/src/dream_mode.rs` — run_dream_session(): vitality < 0.2 guard skips session per ROADMAP risk
- `src-tauri/src/brain.rs` — build_system_prompt_inner(): vitality band injects contextual personality modulation
- `src-tauri/src/metacognition.rs` — confidence_delta threshold: vitality Critical band lowers threshold
- `src-tauri/src/doctor.rs` — SignalClass enum: add Vitality variant (9th signal, Gate 37)
- `src-tauri/src/active_inference.rs` — aggregate prediction error: sustained high error feeds vitality drain
- `src-tauri/src/character.rs` — Feedback signals: positive feedback contributes to relatedness SDT signal

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `homeostasis.rs` OnceLock<Mutex<T>> + hypothalamus_tick() — vitality state follows same global state pattern, vitality tick runs inside hypothalamus cycle
- `reward.rs` CompositeReward — competence signal reads directly from the composite score pipeline, no new data collection
- `decision_gate.rs` SQLite history — autonomy signal reads act-vs-ask ratios from existing persistence
- `doctor.rs` SignalClass + DoctorPane pattern — Vitality row follows Phase 25/27/28 convention exactly
- `safety_bundle.rs::safety_eval_drain()` — pre-wired hook, just needs VitalityState write instead of log-only
- `persona_engine.rs::get_persona_context()` — personality dampening reads vitality and scales trait confidence inline
- `embeddings.rs` — cosine similarity for tedium detection uses the existing embedding pipeline

### Established Patterns
- Global state: `OnceLock<Mutex<VitalityState>>` with `get_vitality()` public API
- Background tick: piggyback on `hypothalamus_tick()` — no new background loop
- DB persistence: `load_from_db()` / `save_to_db()` matching homeostasis pattern
- Activity events: `emit_activity_with_id` for band transitions and significant state changes
- Feature gating: AtomicBool for dormancy stub in test mode (same pattern as OBSERVE_ONLY guardrail)
- DoctorPane: SignalClass variant + compute function + suggested_fix entries

### Integration Points
- `homeostasis.rs::hypothalamus_tick()` — call vitality tick after hormone processing
- `safety_bundle.rs::safety_eval_drain()` — wire to real vitality drain
- `brain.rs::build_system_prompt_inner()` — inject band-specific personality modulation
- `persona_engine.rs::get_persona_context()` — accept vitality multiplier for trait dampening
- `evolution.rs::run_evolution_cycle()` — gate on vitality ≥ 0.4
- `dream_mode.rs::run_dream_session()` — gate on vitality ≥ 0.2
- `metacognition.rs` — lower confidence-delta threshold in Critical band
- `doctor.rs` — add SignalClass::Vitality
- `lib.rs` — register vitality_engine module + commands in generate_handler![]
- `db.rs` — migrations for vitality_state, vitality_history, dormancy_records tables

</code_context>

<specifics>
## Specific Ideas

- Vitality is the NARRATIVE INTEGRATOR of the organism layer. Phases 25-28 built metacognition, safety, hormones, and active inference as independent systems. Vitality makes them a story: when BLADE is competent, trusted, and engaged, it thrives. When it fails, is ignored, and stagnates, it fades. When it fades completely, it dies — and can be reborn. No consumer AI has shipped this arc.
- The 5 bands are not cosmetic — they create genuinely different experiences. A user who interacts with BLADE at vitality 0.3 meets a different agent than one at 0.9. The flattened personality, suppressed exploration, and self-aware deterioration messages are the proof that vitality is real, not a number on a dashboard.
- Reincarnation is philosophically load-bearing: BLADE doesn't cling to its previous state (TMT mortality acceptance), doesn't pretend it didn't die, and doesn't start from scratch. It remembers but rebuilds. The hormone reset + vitality 0.3 start means the reincarnated BLADE has to earn back its full personality through competence — the same SDT loop that sustains a healthy instance.
- The hysteresis buffer (D-11) prevents the most common failure mode of band systems: rapid oscillation at thresholds. Without it, vitality hovering at 0.40 would flip between Waning and Declining every tick, producing schizophrenic behavior.
- The dormancy floor (D-16) is a safety valve: BLADE cannot accidentally die from a brief period of inactivity. Dormancy requires either sustained failure or explicit user intent. This is the "responsible autonomy" principle — the agent accepts its mortality but doesn't suicide from a bad afternoon.

</specifics>

<deferred>
## Deferred Ideas

- **Vitality dashboard page:** A full-page visualization of vitality history, all contributing factors with sparklines, and band threshold markers. Belongs in Phase 30 (Organism Eval) or a future UI polish pass — Phase 29 ships the data and a minimal indicator.
- **Vitality-aware notification throttling:** When vitality is low, reduce notification/proactive alert frequency further than just disabling proactive engine. Future refinement.
- **User-adjustable vitality drain rates:** Let users tune how quickly BLADE decays — some users want a needy agent, some want a resilient one. v1.5 personalization.
- **Cross-session vitality momentum:** Carry momentum (rate of change) across sessions, not just the scalar value. Would make recovery trajectories smoother. Evaluate after Phase 30 eval data.

None — all deferred ideas are noted above as future-phase candidates, not Phase 29 scope.

</deferred>

---

*Phase: 29-vitality-engine*
*Context gathered: 2026-05-03*
