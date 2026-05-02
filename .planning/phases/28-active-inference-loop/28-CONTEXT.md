# Phase 28: Active Inference Loop - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire Friston-inspired active inference into BLADE's Hive mesh. Each tentacle maintains a prediction of expected state; observations produce prediction errors; errors modulate the hormone bus (Phase 27); hormones modulate behavior — closing the loop. One end-to-end demo loop is reproducible: calendar packed + Slack backlog → cortisol rises → responses become terse and action-focused. Prediction-error-weighted memory replay extends dream_mode's consolidation cycle (hippocampal analog). Tentacle predictions learn from repeated observations.

</domain>

<decisions>
## Implementation Decisions

### Prediction State Architecture (AINF-01)
- **D-01:** New `active_inference.rs` module — active inference is a conceptually separate concern from the Hive mesh (hive.rs) and the hormone bus (homeostasis.rs). It reads from both, maintains its own state, and writes prediction errors to the hormone bus. Does NOT extend the `Tentacle` struct in hive.rs — that struct is already data-heavy and the 15+ consumers don't need prediction fields.
- **D-02:** `TentaclePrediction` struct per tentacle type, stored as named numeric signals (HashMap<String, f32>). Calendar: `{event_count, free_slots, meeting_hours}`. Slack: `{unread_count, mention_count, backlog_size}`. GitHub: `{open_prs, review_requests, ci_failures}`. Each signal has an expected value and a confidence weight (how stable the prediction is).
- **D-03:** Global `OnceLock<Mutex<HashMap<String, TentaclePrediction>>>` keyed by tentacle platform ID. Same pattern as `HORMONES` in homeostasis.rs and `HIVE` in hive.rs. Loaded from SQLite on init, saved after each tick.

### Prediction Error Calculation (AINF-02)
- **D-04:** Per-tentacle-type normalization functions in `active_inference.rs`. Each function takes (expected_signals, observed_signals) → normalized error in [0.0, 1.0]. The normalization accounts for natural variance per signal type — calendar event count fluctuates more than GitHub CI state. Error = weighted mean of per-signal |expected - observed| / range, where range is the historical max-min for that signal.
- **D-05:** Observed state extracted from `TentacleReport` payloads after each `hive_tick()` poll. Each tentacle already returns structured JSON in report.details — the extraction functions parse tentacle-type-specific fields from these payloads. No new data collection, just new interpretation of existing reports.

### Error → Hormone Mapping (AINF-03)
- **D-06:** New `update_physiology_from_prediction_errors()` function in homeostasis.rs, alongside the existing `update_physiology_from_classifier()`. Both pathways feed the same PhysiologicalState. Prediction errors are a SECOND input channel — additive with the emotion classifier, not replacing it. Uses the same α=0.05 smoothing for consistency.
- **D-07:** Mapping rules — sustained high aggregate error (>0.6 across 3+ tentacles for 2+ ticks): cortisol + norepinephrine rise. Low aggregate error (<0.2 sustained): serotonin rises. Novel high error on a single tentacle (spike, not sustained): norepinephrine rises specifically (novelty signal → Voyager exploration trigger). Error normalization per tick before feeding hormones prevents a single noisy tentacle from dominating.
- **D-08:** Aggregate prediction error computed as weighted mean across all active tentacles, where weights reflect tentacle reliability (tentacles in Error/Dormant status contribute 0 weight). This aggregate value is also what DoctorPane displays.

### Demo Loop (AINF-04)
- **D-09:** Hook into `hive_tick()` — after all tentacle reports are collected and routed to Heads, run the prediction error computation pass. The cycle is: poll → collect reports → route to Heads → compute prediction errors → update hormone bus → (hormone effects manifest on next user interaction). This adds ~1ms of computation per tick — negligible.
- **D-10:** Demo loop fixture: inject synthetic TentacleReport payloads for calendar (8 events, 0 free slots, 6 hours meetings) and Slack (15 unread, 5 mentions, 20 backlog). Assert: cortisol > baseline (0.3) after 3 ticks. Assert: brain.rs system prompt contains terse/action-focused modulation text. This is a deterministic integration test — no LLM needed.
- **D-11:** The demo loop proves the full chain: external signal → tentacle report → prediction error → hormone modulation → behavioral change. It does NOT require live API connections — the fixture uses synthetic reports. Real tentacles produce the same report format, so the demo generalizes.

### Hippocampal Memory Replay (AINF-05)
- **D-12:** New `task_prediction_replay()` function added to dream_mode.rs as a fourth task in the dream session, alongside prune/consolidate/generate. Ordering: prune → consolidate → prediction_replay → generate (replay informs what traces to generate skills from).
- **D-13:** Queries the prediction error log (SQLite) for events with error > threshold (0.5). Sorts by error magnitude descending. Replays the top-N through memory.rs for consolidation — high-error events are the ones worth learning from (this is the hippocampal insight: prediction errors drive memory formation). Emits `dream_mode:replay` to activity log with count and top items.
- **D-14:** Replay means: re-extract facts/patterns from the high-error context using typed_memory's extraction pipeline. The goal is to turn prediction failures into durable memory so BLADE's future predictions improve. Not a literal "replay" of the experience — a consolidation pass weighted by surprise.

### Prediction Learning (AINF-06)
- **D-15:** Exponential moving average on expected state values. After computing prediction error, update expected state: `expected = expected * (1 - α) + observed * α`. Per-tentacle-type learning rates: calendar α=0.1 (schedules change week-to-week), Slack α=0.08 (messaging patterns shift), GitHub α=0.05 (PR patterns more stable). Confidence weight increases as the EMA stabilizes (variance of recent errors decreases).
- **D-16:** Learning happens at the end of each prediction error computation (inside hive_tick hook). Updated predictions persisted to SQLite immediately — no batching. Cross-session persistence means BLADE's predictions improve over days of use.
- **D-17:** Cold start: expected state initialized to global defaults (calendar: 3 events, 2 free slots, 2 hours meetings; etc.). After first observation, EMA kicks in. After ~10 observations (at 30s tick = ~5 minutes), predictions reflect the actual user's patterns. Cold start is by design short-lived.

### DoctorPane Signal
- **D-18:** New `SignalClass::ActiveInference` in doctor.rs, following the Phase 25 (Metacognitive) and Phase 27 (Hormones) pattern. Shows: aggregate prediction error (current), tentacle with highest error, number of tentacles being tracked, and whether demo loop conditions are active (high calendar + high Slack → cortisol elevated). Compact single-row format.

### Persistence
- **D-19:** Two new SQLite tables in db.rs:
  - `tentacle_predictions` — per-tentacle expected state (platform, signal_name, expected_value, confidence, updated_at). This is the live prediction state.
  - `prediction_error_log` — historical errors (platform, aggregate_error, top_signal, timestamp). Capped at 1000 rows with FIFO pruning. Used by dream_mode replay and trend analysis.

### Claude's Discretion
- Exact numeric defaults for cold-start expected states per tentacle type
- Signal extraction functions per tentacle report format (parsing report.details JSON)
- Error threshold for hippocampal replay (suggested 0.5, tune based on distribution)
- Top-N count for dream replay (suggested 10 per session)
- Exact per-signal normalization ranges (historical max-min, or fixed ranges)
- DoctorPane row formatting and which signals are most useful to surface
- Whether to emit `hive_prediction_error` event to frontend or only store in SQLite (ActivityStrip event on threshold crossings recommended)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — AINF-01 through AINF-06 requirement definitions
- `.planning/ROADMAP.md` §Phase 28 — Success criteria (4 testable assertions), depends-on, risk register

### Research
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` — Seven-layer architecture; active inference is the core of Layer 5 (Homeostasis + Inference)
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q5 — Hormone bus calibration, α=0.05 smoothing, "tracking not steering" boundary
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` §Arg 4, §Arg 10 — Safety-first organism features; prediction errors must not drive unsafe behavior

### Prior Phase Context (MUST read — direct dependencies)
- `.planning/phases/27-hormone-physiology/27-CONTEXT.md` — D-01: Two-layer hormone architecture (physiological + operational + pituitary blend). D-04/D-05/D-06/D-07: Behavioral modulation effects that active inference errors feed into. D-02: Emotion classifier architecture (parallel input channel to prediction errors).
- `.planning/phases/26-safety-bundle/26-CONTEXT.md` — D-07/D-08: Mortality-salience cap is behavioral, not scalar — prediction errors can freely modulate mortality_salience physiologically. D-09: Calm-vector steering reads mortality_salience.

### Existing Code (primary files Phase 28 extends)
- `src-tauri/src/hive.rs` — `hive_tick()` at line 2231: the tick cycle where prediction error computation hooks in. `Tentacle` struct, `TentacleReport` struct, `poll_tentacle()` — prediction errors derive from these reports.
- `src-tauri/src/homeostasis.rs` — `PhysiologicalState` struct (7 hormones), `update_physiology_from_classifier()`, `apply_physiology_decay()`, `hypothalamus_tick()`. Phase 28 adds `update_physiology_from_prediction_errors()` as a second input channel.
- `src-tauri/src/dream_mode.rs` — `run_dream_session()`, `task_memory_consolidation()`. Phase 28 adds `task_prediction_replay()` as a fourth dream task.
- `src-tauri/src/doctor.rs` — `SignalClass` enum, DoctorPane pattern. Add `SignalClass::ActiveInference`.
- `src-tauri/src/db.rs` — Migration pattern for new tables. Add `tentacle_predictions` and `prediction_error_log`.
- `src-tauri/src/brain.rs` — Cortisol modulation already wired by Phase 27. Active inference drives cortisol via prediction errors → the behavioral effect is already in place.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `homeostasis.rs` PhysiologicalState + update_physiology_from_classifier(): direct analog for prediction error input — same smoothing, same target struct
- `hive.rs` TentacleReport.details (serde_json::Value): already contains structured platform-specific data — extraction functions parse these
- `dream_mode.rs` task pipeline (prune → consolidate → generate): prediction replay slots in naturally as task 3
- `doctor.rs` SignalClass + compute pattern: Phase 25 and 27 established the pattern, Phase 28 follows it
- `db.rs` migration helpers: same pattern for new tables

### Established Patterns
- Global OnceLock<Mutex<T>> for module state (hive.rs, homeostasis.rs, metacognition.rs) — active_inference.rs follows this
- Background tick integration: hive_tick runs every 30s, hypothalamus_tick every 60s — prediction errors computed in hive_tick, hormones updated on the same cycle
- Activity event emission via emit_activity_with_id — prediction error threshold crossings emit events
- SQLite persistence with load_from_db/save_to_db pattern — predictions follow this

### Integration Points
- `hive.rs::hive_tick()` — hook prediction error computation after report collection
- `homeostasis.rs` — new update function for prediction errors alongside classifier
- `dream_mode.rs::run_dream_session()` — add prediction replay task
- `doctor.rs` — new SignalClass variant
- `lib.rs` — register active_inference module + commands in generate_handler![]
- `brain.rs` — no changes needed, cortisol modulation already wired by Phase 27

</code_context>

<specifics>
## Specific Ideas

- The demo loop is THE proof point — everything else is infrastructure for it. The fixture test must be dead simple: inject two synthetic reports, run 3 ticks, assert cortisol went up, assert response style changed. If the demo doesn't work, nothing else matters.
- Prediction errors are the MISSING link between perception (Hive sees the world) and affect (hormones change behavior). Phase 27 wired emotion classifier → hormones. Phase 28 wires world-state-mismatch → hormones. Together they create an agent that responds to both its own output AND external reality.
- The hippocampal replay is the deepest piece — it means BLADE literally learns from surprise during sleep. High prediction errors become memories, memories become better predictions, better predictions reduce future errors. This is the self-improving loop that makes active inference more than a party trick.
- Cold start is intentionally aggressive (5 minutes to personalized predictions) because the demo needs to be impressive on first use, not after a week of training.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 28-active-inference-loop*
*Context gathered: 2026-05-02*
