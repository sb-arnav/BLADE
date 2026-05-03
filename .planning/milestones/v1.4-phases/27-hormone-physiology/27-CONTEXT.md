# Phase 27: Hormone Physiology - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire 7 hormone scalars (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality-salience) with real decay constants and gain modulation. Add an emotion classifier that updates hormones from response text. Wire behavioral modulation effects so internal state actually changes what BLADE does: cortisol→terse responses, dopamine→exploration rate, norepinephrine→Voyager triggers, acetylcholine→verifier frequency. Persist across sessions and surface in UI.

</domain>

<decisions>
## Implementation Decisions

### Hormone Bus Architecture
- **D-01:** Two-layer architecture. Add a new physiological layer with 7 biologically-named hormones (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience) each with individual decay constants and gain modulation. The existing 11 operational scalars (arousal, energy_mode, exploration, trust, urgency, hunger, thirst, insulin, adrenaline, leptin, mortality_salience) remain unchanged. The pituitary functions already in homeostasis.rs (`acth()`, `oxytocin()`, `growth_hormone()`, `thyroid_stimulating()`, `adh()`) become the formal translation layer between physiology and operations. Emotion classifier feeds the physiological layer; hypothalamus_tick translates physiology → operational scalars. 15+ existing module consumers are undisrupted.

### Emotion Classifier
- **D-02:** Rule-based Rust classifier running on BLADE's own response text. No external ML model, no API cost, no feature flag. Maps response text → valence/arousal/cluster using curated lexicons and heuristic patterns. Runs on every response ≥50 tokens. Updates physiological hormones with α=0.05 smoothing — the smoothing compensates for individual classification noise over ~20 readings. BLADE's own response text has predictable structure, making lexicon-based classification substantially more accurate than on arbitrary text.
- **D-03:** `emotional_intelligence.rs` remains unchanged — it handles LLM-based emotion detection on USER messages for the empathy engine. Different purpose, different layer. The new classifier operates on BLADE's output, emotional_intelligence operates on user input.

### Behavioral Modulation
- **D-04:** Cortisol modulates response style via system prompt modulation in `brain.rs`. High cortisol injects directives for terse, action-focused responses. Low cortisol allows expansive, exploratory tone. brain.rs already builds the system prompt dynamically and reads emotional context — this extends the same pattern.
- **D-05:** Dopamine modulates exploration rate in `evolution.rs` / `autoskills.rs`. High dopamine → more aggressive Voyager-loop exploration; low dopamine → conservative skill reuse.
- **D-06:** Norepinephrine modulates novelty response — unexpected prediction errors trigger Voyager-loop exploration runs.
- **D-07:** Acetylcholine modulates verifier-call frequency in `metacognition.rs`. High ACh → more secondary verifier checks; low ACh → skip low-confidence verification.

### Claude's Discretion
- The 4 headline modulation effects (cortisol→brain.rs, dopamine→evolution.rs, NE→Voyager, ACh→metacognition.rs) should read physiological hormones directly for raw, dramatic signal. Legacy modules continue through pituitary translation functions — preserving existing behavior while giving headline features the full dynamic range.
- UI surface: DoctorPane `SignalClass::Hormones` row showing compact visualization of 7 hormone levels, plus ActivityStrip events on threshold crossings (e.g., "cortisol ↑ 0.6 — 3 failed tool calls"). Follows the Phase 25 metacognition signal pattern.
- A richer hormone dashboard is out of scope for Phase 27 — can arrive with Phase 29 (Vitality Engine) when there's a fuller organism story to visualize.
- Exact decay constants per hormone (half-lives, floor values)
- Exact gain multipliers per emotion cluster
- Lexicon design for the rule-based classifier
- Serotonin and oxytocin modulation targets (not specified in requirements — wire them with sensible defaults)
- Hormone persistence format (SQLite schema, save frequency)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` lines 30-37 — HORM-01 through HORM-09 requirement definitions
- `.planning/ROADMAP.md` §Phase 27 — Success criteria (4 testable assertions), depends-on, UI hint

### Research
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q5 — Hormone bus calibration: external text-based classifier, ~60-70% zero-shot accuracy, α=0.05 smoothing, "tracking not steering" boundary
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q2 — Eval families for hormone-driven behavior (force vitality → verify TMT-shape effects)
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` §Arg 4, §Arg 10 — Design implications for safety-first organism features

### Prior Phase Context
- `.planning/phases/26-safety-bundle/26-CONTEXT.md` — D-07: mortality_salience fluctuates freely (Phase 27 needs dynamic range), cap is behavioral. D-08: `check_mortality_salience_cap()` in safety_bundle.rs. D-09: calm-vector steering reads mortality_salience.

### Existing Code
- `src-tauri/src/homeostasis.rs` — Current 11-scalar HormoneState, pituitary functions (acth, oxytocin, growth_hormone, thyroid_stimulating, adh), get_directive(), hypothalamus_tick(). THIS IS THE PRIMARY FILE Phase 27 extends.
- `src-tauri/src/emotional_intelligence.rs` — EmotionalState (primary_emotion, valence, arousal, confidence), DB persistence, brain.rs integration. Phase 27 adds a parallel classifier, does NOT modify this module.
- `src-tauri/src/brain.rs` line ~881 — Existing emotional context injection point. Cortisol modulation extends this.
- `src-tauri/src/safety_bundle.rs` lines 327-360 — `check_mortality_salience_cap()` reads mortality_salience from homeostasis. Must continue working with the new two-layer architecture.
- `src-tauri/src/doctor.rs` lines 34-55 — SignalClass enum for DoctorPane. Add SignalClass::Hormones.
- `src-tauri/src/metacognition.rs` — Verifier routing. ACh modulation extends trigger frequency.
- `src-tauri/src/evolution.rs` — Voyager loop. Dopamine modulation extends exploration aggressiveness.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `homeostasis.rs` pituitary functions (`acth()`, `oxytocin()`, etc) — already bridge bio names to operational scalars; formalize as the translation layer
- `emotional_intelligence.rs` EmotionalState struct — reuse valence/arousal/cluster shape for the new classifier output
- `doctor.rs` SignalClass + DoctorPane pattern — add SignalClass::Hormones following the same compute-function + display-config pattern from Phase 25
- `ecosystem.rs` `emit_activity_with_id()` — emit hormone events to ActivityStrip

### Established Patterns
- Hormone state: global `OnceLock<Mutex<HormoneState>>` with `get_hormones()` public API — new physiological layer should follow same pattern
- Background tick: `hypothalamus_tick()` runs every 60s — extend with decay processing for physiological hormones
- DB persistence: `load_from_db()` / `save_to_db()` in homeostasis.rs — extend for physiological state
- Feature gating: `#[serde(default)]` for new fields ensures backwards compatibility

### Integration Points
- `brain.rs` system prompt builder — cortisol modulation injects here
- `evolution.rs` Voyager loop — dopamine modulation reads here
- `metacognition.rs` verifier routing — ACh modulation reads here
- `safety_bundle.rs` mortality-salience cap — must keep working with new architecture
- 15+ modules calling `get_hormones()`, `energy_mode()`, `exploration()`, etc — must remain stable

</code_context>

<specifics>
## Specific Ideas

- The two-layer architecture means Phase 28 (Active Inference Loop) can write prediction errors directly into the physiological layer, and the effects cascade through the pituitary to operational behavior — the architecture is designed to support the Phase 28 demo loop
- Research specifies "tracking not steering" — the emotion classifier tracks what BLADE is doing, it does not push the model into emotional states. The engineering must preserve this boundary.
- α=0.05 smoothing means ~20 readings to converge — individual misclassifications wash out. This makes a simpler classifier viable.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 27-hormone-physiology*
*Context gathered: 2026-05-02*
