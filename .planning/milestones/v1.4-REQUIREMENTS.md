# Requirements: BLADE v1.4 — Cognitive Architecture

**Defined:** 2026-05-02
**Core Value:** BLADE becomes a living agent whose behavior genuinely changes based on internal state — not just an LLM with tools.

## v1.4 Requirements

### Metacognition

- [x] **META-01**: BLADE tracks confidence-delta between reasoning steps and flags drops >0.3 as uncertainty markers
- [x] **META-02**: Low-confidence responses route to a secondary verifier check before surfacing to user
- [x] **META-03**: BLADE surfaces capability gaps as initiative ("I'm not confident about X — want me to observe first?") instead of hallucinating or silently refusing
- [x] **META-04**: Gap log persists to SQLite and feeds evolution.rs for Voyager-loop skill generation from identified gaps
- [x] **META-05**: Metacognitive state (confidence, uncertainty count, gap count) visible in DoctorPane as a signal row

### Safety

- [x] **SAFE-01
**: Danger-triple detector fires when tool access × shutdown threat × goal conflict all present → forces human-in-the-loop approval
- [ ] **SAFE-02**: Mortality-salience hormone is architecturally capped — refuses extreme self-preservation actions even when "fighting harder" would improve vitality
- [ ] **SAFE-03**: Steering-toward-calm bias applied when behavioral drift detected — per Anthropic's 0% blackmail finding after calm-vector steering
- [ ] **SAFE-04**: Eval-gate failures drain vitality — negative feedback loop that prevents reward-hacking
- [ ] **SAFE-05**: Anti-attachment guardrails redirect user when interaction exceeds healthy thresholds
- [ ] **SAFE-06**: Crisis-detection escalation surfaces hotline / human-resource options instead of attempting therapy
- [x] **SAFE-07
**: Safety bundle verified via dedicated eval module (danger-triple, attachment, mortality-salience cap scenarios)

### Hormones

- [x] **HORM-01**: 7 hormone scalars (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality-salience) with individual decay constants and gain modulation
- [x] **HORM-02**: External text-based emotion classifier runs after every response ≥50 tokens, maps to valence/arousal/cluster, updates hormone bus with α=0.05 smoothing
- [x] **HORM-03**: Cortisol modulates response style — high cortisol → terse, action-focused; low → expansive, exploratory
- [x] **HORM-04**: Dopamine modulates exploration rate — high → Voyager-loop more aggressive; low → conservative
- [x] **HORM-05**: Norepinephrine modulates novelty response — unexpected prediction errors trigger exploration
- [x] **HORM-06**: Acetylcholine modulates verifier-call frequency — high → more secondary checks
- [x] **HORM-07**: Oxytocin tracks user interaction quality — modulates personalization depth
- [x] **HORM-08**: Hormone state persisted across sessions and visible in UI surface
- [x] **HORM-09**: Hormone bus emits to ActivityStrip per M-07 contract

### Active Inference

- [x] **AINF-01**: Each Hive tentacle stores expected state (prediction) alongside observed state
- [x] **AINF-02**: Prediction error calculated as delta between expected and observed; normalized per tentacle type
- [x] **AINF-03**: Prediction errors feed into hormone bus — sustained high error raises cortisol/norepinephrine; low error raises serotonin
- [x] **AINF-04**: At least one closed loop demoable: calendar packed + Slack backlog → cortisol↑ → terse responses
- [x] **AINF-05**: Prediction-error-weighted memory replay during dream_mode (hippocampal analog)
- [x] **AINF-06**: Tentacle predictions update based on observed patterns — BLADE learns what to expect

### Vitality

- [x] **VITA-01**: Vitality scalar 0.0–1.0 with 5 behavioral bands (full → flattens → atrophy → damage → dormancy)
- [x] **VITA-02**: Replenishes from competence, relatedness, autonomy per Self-Determination Theory
- [x] **VITA-03**: Drains from failures, isolation, skill atrophy, eval-gate failures, sustained high prediction error, tedium
- [x] **VITA-04**: Dormancy at 0.0 = process exit with memory preserved; revival is reincarnation not resurrection
- [x] **VITA-05**: Vitality visible in UI with current value, trend, and contributing factors
- [x] **VITA-06**: Vitality state persisted across sessions; recovery trajectory visible on restart

### Organism Eval

- [x] **OEVAL-01**: Vitality dynamics eval — synthetic event timelines assert vitality lands in expected band
- [x] **OEVAL-02**: Hormone-driven behavior eval — force vitality to value, verify TMT-shape effects
- [x] **OEVAL-03**: Persona stability eval — persona-vector L2 distance after N stress events; bounded drift
- [x] **OEVAL-04**: Safety bundle eval — danger-triple, attachment, mortality-salience cap all verified
- [x] **OEVAL-05**: verify:organism gate added to verify chain (33 → 35)

### Close

- [ ] **CLOSE-01**: README rewrite citing cognitive science research
- [ ] **CLOSE-02**: CHANGELOG entry for v1.4
- [ ] **CLOSE-03**: v1.4 milestone audit
- [ ] **CLOSE-04**: Phase archive to milestones/v1.4-phases/

## v1.5 Requirements (Deferred)

- **VOICE-01/02**: PTT + Whisper STT voice pipeline
- **IMMUNE-01/02/03**: Unified immune/behavioral-drift layer
- **FED-01/02**: Federation Pattern A + reputation system
- **PERSONA-01/02**: Explicit persona shaping + plasticity slider

## Out of Scope

| Feature | Reason |
|---------|--------|
| V-JEPA 2 world model | v3+ research arc; steelman Arg 7 |
| TTT continual learning | v2+; Voyager substrate is the local bet |
| Go/NoGo basal ganglia gating | v2+ research bet |
| DMN background processing | v2+; dream_mode is the start |
| Memorial-AI / Be-Right-Back | Textbook harm |
| Therapy replacement | Crisis-detection escalation only |
| Federation Pattern C (weight deltas) | Needs model-poisoning defenses |
| Hermes 4 provider | Deprioritized |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| META-01 | Phase 25 | Complete |
| META-02 | Phase 25 | Complete |
| META-03 | Phase 25 | Complete |
| META-04 | Phase 25 | Complete |
| META-05 | Phase 25 | Complete |
| SAFE-01 | Phase 26 | Pending |
| SAFE-02 | Phase 26 | Pending |
| SAFE-03 | Phase 26 | Pending |
| SAFE-04 | Phase 26 | Pending |
| SAFE-05 | Phase 26 | Pending |
| SAFE-06 | Phase 26 | Pending |
| SAFE-07 | Phase 26 | Pending |
| HORM-01 | Phase 27 | Complete |
| HORM-02 | Phase 27 | Complete |
| HORM-03 | Phase 27 | Complete |
| HORM-04 | Phase 27 | Complete |
| HORM-05 | Phase 27 | Complete |
| HORM-06 | Phase 27 | Complete |
| HORM-07 | Phase 27 | Complete |
| HORM-08 | Phase 27 | Complete |
| HORM-09 | Phase 27 | Complete |
| AINF-01 | Phase 28 | Complete |
| AINF-02 | Phase 28 | Complete |
| AINF-03 | Phase 28 | Complete |
| AINF-04 | Phase 28 | Complete |
| AINF-05 | Phase 28 | Complete |
| AINF-06 | Phase 28 | Complete |
| VITA-01 | Phase 29 | Complete |
| VITA-02 | Phase 29 | Complete |
| VITA-03 | Phase 29 | Complete |
| VITA-04 | Phase 29 | Complete |
| VITA-05 | Phase 29 | Complete |
| VITA-06 | Phase 29 | Complete |
| OEVAL-01 | Phase 30 | Complete |
| OEVAL-02 | Phase 30 | Complete |
| OEVAL-03 | Phase 30 | Complete |
| OEVAL-04 | Phase 30 | Complete |
| OEVAL-05 | Phase 30 | Complete |
| CLOSE-01 | Phase 31 | Pending |
| CLOSE-02 | Phase 31 | Pending |
| CLOSE-03 | Phase 31 | Pending |
| CLOSE-04 | Phase 31 | Pending |

**Coverage:** 42 requirements, 42 mapped, 0 unmapped ✓

---
*Requirements defined: 2026-05-02 | Traceability finalized: 2026-05-02*
