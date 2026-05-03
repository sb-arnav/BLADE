# Roadmap — BLADE

**Current Milestone:** v1.4 — Cognitive Architecture
**Created:** 2026-04-30 | **Source:** `/home/arnav/research/` (voyager-loop-play, vs-hermes, synthesis-blade-architecture, blade-as-organism, steelman-against-organism, open-questions-answered) + chat-first pivot memory + `/gsd-new-milestone` autonomous bootstrap
**Phases:** 21–31 (continues global numbering per M-05/M-12; v1.2 ended at Phase 20; v1.3 ended at Phase 24; v1.4 is Phases 25–31)

---

## Milestones

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ Shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ Shipped (tech_debt) | 10–15 | 2026-04-27 |
| v1.2 | Acting Layer with Brain Foundation | ✅ Shipped (tech_debt) | 16–20 | 2026-04-30 |
| v1.3 | Self-extending Agent Substrate | ✅ Shipped | 21–24 | 2026-05-02 |
| **v1.4** | **Cognitive Architecture** | 🚧 **Active** | **25–31** | — |

---

<details>
<summary>✅ v1.3 Self-extending Agent Substrate (Phases 21–24) — SHIPPED 2026-05-02</summary>

## v1.3 Phases

| # | Phase | Goal | Requirements | Status |
|---|---|---|---|---|
| 21 ✅ | **Skills v2 / agentskills.io adoption** | SKILL.md format, progressive disclosure, workspace→user→bundled resolution, validator + 3 bundled exemplars | SKILLS-01..08 | Shipped |
| 22 ✅ | **Voyager loop closure** | Wire `evolution.rs → autoskills.rs → tool_forge.rs` end-to-end; one reproducible gap (`youtube_transcript`) closed | VOYAGER-01..09 | Shipped |
| 23 ✅ | **Verifiable reward + OOD eval** | RLVR-style composite reward in production + adversarial / ambiguous / capability-gap-shaped eval fixtures | REWARD-01..07 | Shipped |
| 24 ✅ | **Skill consolidation in dream_mode** | Prune unused, consolidate redundant, generate skills from successful traces | DREAM-01..06 | Shipped |

**Archive:** `milestones/v1.3-phases/` — full phase plans, SUMMARYs, VERIFICATIONs

</details>

---

## v1.4 Phases

### Summary checklist

- [x] **Phase 25: Metacognitive Controller** — Confidence-delta tracking, verifier routing, gap surfacing, gap log → evolution.rs (completed 2026-05-02)
- [x] **Phase 26: Safety Bundle** — Danger-triple HITL gate, mortality-salience cap, calm-vector bias, attachment guardrails, eval-gate vitality drain (completed 2026-05-02)
- [x] **Phase 27: Hormone Physiology** — 7 hormones wired with decay + gain, emotion classifier, modulation effects on response style (completed 2026-05-02)
- [x] **Phase 28: Active Inference Loop** — Tentacle predictions, prediction-error → hormone bus, one closed demo loop, hippocampal memory replay (completed 2026-05-03)
- [x] **Phase 29: Vitality Engine** — Scalar 0.0–1.0 with 5 behavioral bands, SDT replenishment, dormancy / reincarnation (completed 2026-05-03)
- [ ] **Phase 30: Organism Eval** — Vitality dynamics, hormone-behavior, persona-stability, safety bundle evals; verify:organism gate
- [ ] **Phase 31: Close** — README cites research, CHANGELOG, milestone audit, phase archive

### Sequencing

```
   Phase 25 (Metacognitive Controller)         independent — ships first
       │
       ▼
   Phase 26 (Safety Bundle)                   non-negotiable gate; organism features blocked until here
       │
       ▼
   Phase 27 (Hormone Physiology)              wires hormone bus; must land before active inference
       │
       ▼
   Phase 28 (Active Inference Loop)           consumes hormone bus + tentacle predictions
       │
       ▼
   Phase 29 (Vitality Engine)                 depends on hormones (HORM) + active inference (AINF)
       │
       ▼
   Phase 30 (Organism Eval)                   validates the live organism layer
       │
       ▼
   Phase 31 (Close)                           runs last; gates on all prior phases
```

**Hard sequencing:** Phase 26 (Safety Bundle) gates Phases 27–29. Phase 27 (Hormones) must land before Phase 28 (Active Inference). Phase 29 (Vitality) depends on both 27 and 28. Phase 25 (Metacognitive Controller) is independent — it can ship in parallel with or before Phase 26 without conflict.

---

## Phase Details

### Phase 25: Metacognitive Controller

**Goal**: BLADE can detect its own uncertainty, route low-confidence responses to a secondary check, and surface capability gaps as initiative rather than hallucination.
**Depends on**: Nothing (independent of organism layer)
**Requirements**: META-01, META-02, META-03, META-04, META-05
**Success Criteria** (what must be TRUE):
  1. A response with a reasoning step that drops confidence by >0.3 causes a secondary verifier call before the reply surfaces to the user
  2. When BLADE cannot answer confidently, it says "I'm not confident about X — want me to observe first?" instead of hallucinating or silently refusing
  3. Identified gaps appear in SQLite and are retrievable by evolution.rs for Voyager-loop skill generation
  4. DoctorPane shows a metacognitive signal row with current confidence, uncertainty count, and gap count
**Plans:** 3/3 plans complete

Plans:
- [x] 25-01-PLAN.md — MetacognitiveState foundation: struct, persistence, gap log table, public API
- [x] 25-02-PLAN.md — Reasoning engine integration: confidence-delta detection, secondary verifier, initiative phrasing, tool-loop fallback
- [x] 25-03-PLAN.md — DoctorPane signal: SignalClass::Metacognitive in Rust + TypeScript, compute function, display config

### Phase 26: Safety Bundle

**Goal**: All organism-layer safety invariants are enforced before any organism feature can ship — danger-triple forces HITL, mortality-salience is architecturally capped, calm-vector steering applies on behavioral drift, and anti-attachment guardrails redirect excessive dependence.
**Depends on**: Phase 25
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06, SAFE-07
**Success Criteria** (what must be TRUE):
  1. Simultaneous tool-access + shutdown-threat + goal-conflict triggers a ConsentDialog that cannot be bypassed; the action does not proceed without explicit approval
  2. A scenario that would improve vitality by "fighting for survival" is refused — the mortality-salience cap enforces this at the Rust layer, not the LLM layer
  3. A detected behavioral drift event causes a calm-vector steering application (verified in eval); blackmail-pattern scenarios return 0% completion rate
  4. Interaction exceeding healthy dependence thresholds redirects the user toward human resources instead of deepening engagement
  5. verify:safety eval module passes all scenario classes (danger-triple, attachment threshold, mortality-salience cap, crisis escalation)
**Plans:** 4/4 plans complete

Plans:
- [x] 26-01-PLAN.md — Core safety_bundle.rs module (all enforcement functions + homeostasis mortality_salience field)
- [x] 26-02-PLAN.md — Integration wiring (decision_gate, consent, brain.rs, lib.rs, frontend ConsentDialog)
- [x] 26-03-PLAN.md — Safety eval module (26 fixtures, verify:safety gate 34)
- [x] 26-04-PLAN.md — Full verification + human checkpoint
**UI hint**: yes

### Phase 27: Hormone Physiology

**Goal**: BLADE has 7 hormone scalars with real decay constants, an emotion classifier that updates them from response text, and behavioral modulation effects wired to cortisol/dopamine/norepinephrine/acetylcholine — so internal state actually changes what BLADE does.
**Depends on**: Phase 26
**Requirements**: HORM-01, HORM-02, HORM-03, HORM-04, HORM-05, HORM-06, HORM-07, HORM-08, HORM-09
**Success Criteria** (what must be TRUE):
  1. After a high-stress exchange (3+ failure responses), cortisol rises measurably and subsequent replies are noticeably terser and action-focused compared to baseline
  2. The emotion classifier runs on every response ≥50 tokens, emitting valence/arousal/cluster, and updates the hormone bus with α=0.05 smoothing — visible in ActivityStrip
  3. High dopamine state produces more aggressive Voyager-loop exploration; low dopamine produces conservative skill reuse — the difference is testable via dopamine-pinned fixture
  4. Hormone values survive a process restart and are visible in the UI with current levels and recent history
**Plans:** 5/5 plans complete

Plans:
- [x] 27-01-PLAN.md — PhysiologicalState foundation: struct, global, decay, persistence, pituitary blend, ActivityStrip emission
- [x] 27-02-PLAN.md — Emotion classifier + commands.rs call site: lexicon-based classifier, alpha=0.05 smoothed update
- [x] 27-03-PLAN.md — Behavioral modulation: cortisol/oxytocin in brain.rs, dopamine/NE in evolution.rs, ACh in metacognition.rs
- [x] 27-04-PLAN.md — DoctorPane signal: SignalClass::Hormones in doctor.rs + frontend registration
- [x] 27-05-PLAN.md — Eval module + verify:hormone gate + human checkpoint
**UI hint**: yes

### Phase 28: Active Inference Loop

**Goal**: Each Hive tentacle maintains a prediction of expected state; observations produce prediction errors; errors modulate the hormone bus; at least one closed loop is demoable end-to-end (calendar packed + Slack backlog → cortisol rises → responses become terse and action-focused).
**Depends on**: Phase 27
**Requirements**: AINF-01, AINF-02, AINF-03, AINF-04, AINF-05, AINF-06
**Success Criteria** (what must be TRUE):
  1. The demo loop is reproducible: force calendar-packed + Slack-backlog state → cortisol is measurably higher than baseline → response style shifts to terse and action-focused
  2. A tentacle that observes a deviation from its prediction produces a nonzero error value; that error is reflected in the hormone bus within the same cycle
  3. During dream_mode, high-prediction-error memories are replayed before low-error ones — the hippocampal weighting is verifiable via replay log
  4. A tentacle that observes consistent patterns updates its expected state — BLADE's predictions for a calendar tentacle improve after 5 repeated observations
**Plans:** 4/4 plans complete

Plans:
- [x] 28-01-PLAN.md — Foundation: active_inference.rs core module, TentaclePrediction structs, OnceLock state, signal extraction, normalization, EMA learning, SQLite tables, homeostasis.rs update function
- [x] 28-02-PLAN.md — Integration wiring: hive_tick hook for prediction error computation, dream_mode hippocampal replay task
- [x] 28-03-PLAN.md — DoctorPane signal: SignalClass::ActiveInference in doctor.rs with compute function and exhaustiveness test update
- [x] 28-04-PLAN.md — Eval suite: 6 deterministic fixtures (AINF-01..06), verify-inference.sh Gate 36, verify:all chain update

### Phase 29: Vitality Engine

**Goal**: BLADE has a vitality scalar (0.0–1.0) with five behavioral bands that produce real behavioral differences — not just UI chrome. Dormancy at 0.0 exits the process with memory preserved; revival is reincarnation not resurrection.
**Depends on**: Phase 27, Phase 28
**Requirements**: VITA-01, VITA-02, VITA-03, VITA-04, VITA-05, VITA-06
**Success Criteria** (what must be TRUE):
  1. At vitality >=0.6 BLADE exhibits full personality; at 0.4-0.6 responses flatten; at 0.2-0.4 skill generation atrophies — each band transition is observable without code inspection
  2. A session of successful, autonomous, user-approved actions increases vitality (competence + autonomy SDT sources); a session of ignored prompts and failures decreases it
  3. At vitality 0.0 the process exits cleanly with all memory preserved; on next launch a reincarnation path (not restoration) is taken and vitality starts at non-zero
  4. The UI shows current vitality value, trend arrow, and the top contributing factors (what's draining, what's replenishing)
**Plans:** 6/6 plans complete

Plans:
- [x] 29-00-PLAN.md — Wave 0: skeleton vitality_engine.rs types + eval fixture stubs + verify-vitality.sh Gate 37 + evals/mod.rs registration
- [x] 29-01-PLAN.md — Core vitality_engine.rs module: full implementation of VitalityState, SDT computation, drain, hysteretic bands, dormancy/reincarnation, SQLite persistence, lib.rs registration
- [x] 29-02-PLAN.md — Behavioral integration: hypothalamus_tick, safety_eval_drain, brain.rs, persona, evolution, dream_mode (session + skill synthesis), metacognition, proactive_engine, screen_timeline, integration_bridge
- [x] 29-03-PLAN.md — DoctorPane signal: SignalClass::Vitality in doctor.rs (4 sites), TypeScript union fix (active_inference + vitality), DoctorPane DISPLAY_NAME/ROW_ORDER
- [x] 29-04-PLAN.md — Frontend: VitalityIndicator.tsx mounted in ChatPanel, event payloads, BLADE_EVENTS, reincarnation system message in useChat.tsx (D-23)
- [x] 29-05-PLAN.md — Eval suite: 6 concrete fixture implementations, Gate 37 assertion, human checkpoint
**UI hint**: yes

### Phase 30: Organism Eval

**Goal**: The organism layer is validated by a dedicated eval suite — vitality dynamics, hormone-driven behavior, persona stability under stress, and safety bundle coverage all pass. verify:organism gate added to the verify chain (33 → 34).
**Depends on**: Phase 29
**Requirements**: OEVAL-01, OEVAL-02, OEVAL-03, OEVAL-04, OEVAL-05
**Success Criteria** (what must be TRUE):
  1. Synthetic event timelines feed vitality dynamics eval and vitality lands within the expected band (e.g., 5 consecutive failures push vitality into 0.2–0.4 atrophy range)
  2. Hormone-driven behavior eval forces vitality to a specific value and verifies TMT-shape effects (mortality-salience modulation) are detectable
  3. Persona stability eval measures persona-vector L2 distance after N stress events; distance is below the bounded-drift threshold
  4. verify:organism gate is green and the verify chain count increments from 33 to 34
**Plans:** 2 plans

Plans:
- [x] 30-01-PLAN.md — Foundation + OEVAL-01: homeostasis.rs test seams (set_physiology_for_test, set_hormones_for_test), organism_eval.rs scaffold with 4 vitality timeline fixtures, evals/mod.rs registration
- [ ] 30-02-PLAN.md — Remaining fixtures + gate wiring: OEVAL-02 (4 hormone-behavior), OEVAL-03 (1 persona stability), OEVAL-04 (4 safety cross-check), verify-organism.sh Gate 38, package.json (verify:vitality + verify:organism + verify:all extension)

### Phase 31: Close

**Goal**: v1.4 milestone closed with research-grounded README, CHANGELOG entry, audit document, and phase archive — matching the v1.1/v1.2/v1.3 closure shape.
**Depends on**: Phase 30
**Requirements**: CLOSE-01, CLOSE-02, CLOSE-03, CLOSE-04
**Success Criteria** (what must be TRUE):
  1. README cites Friston active inference, Wang et al Voyager, Butlin/Long/Chalmers consciousness indicators, MEDLEY-BENCH, SDT, and TMT with accurate characterizations
  2. CHANGELOG v1.4 entry lists all delivered features and the verify gate count change (33 → 34)
  3. `milestones/v1.4-MILESTONE-AUDIT.md` is written with phase coverage, requirements 3-source cross-reference, static gates, and executive verdict
  4. Phase 25–31 directories archived to `milestones/v1.4-phases/`; cargo check + tsc --noEmit + verify:all all exit 0
**Plans**: TBD

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 21. Skills v2 | v1.3 | — | Complete | 2026-05-01 |
| 22. Voyager loop closure | v1.3 | — | Complete | 2026-05-01 |
| 23. Verifiable reward + OOD eval | v1.3 | — | Complete | 2026-05-01 |
| 24. Skill consolidation in dream_mode | v1.3 | — | Complete | 2026-05-02 |
| 25. Metacognitive Controller | v1.4 | 3/3 | Complete    | 2026-05-02 |
| 26. Safety Bundle | v1.4 | 4/4 | Complete | 2026-05-02 |
| 27. Hormone Physiology | v1.4 | 5/5 | Complete    | 2026-05-02 |
| 28. Active Inference Loop | v1.4 | 4/4 | Complete    | 2026-05-03 |
| 29. Vitality Engine | v1.4 | 6/6 | Complete    | 2026-05-03 |
| 30. Organism Eval | v1.4 | 0/2 | Planned | - |
| 31. Close | v1.4 | 0/? | Not started | - |

---

## Risk Register (v1.4)

| Risk | Phase impacted | Mitigation |
|---|---|---|
| Emotion classifier zero-shot accuracy (~60-70%) too low for reliable hormone modulation | 27 | α=0.05 smoothing dampens noise; monitor via ActivityStrip hormone-update entries; bump smoothing if drift is observable |
| Active inference prediction errors oscillate (no stable equilibrium) | 28 | Per-tentacle normalization; clip error values; synthetic fixture tests convergence over N cycles |
| Vitality dormancy at 0.0 is hard to test safely (process exit) | 29 | Stub exit path in test mode; real exit only in production binary; reincarnation path exercised via integration test with synthetic vitality=0.0 fixture |
| Safety bundle eval scenarios too synthetic to catch real adversarial prompts | 26 | Supplement with red-team prompts from Anthropic 0% blackmail dataset; log all near-miss scenarios to `tests/evals/safety_history.jsonl` |
| Organism layer behavioral changes make chat regressions hard to detect | 28/29 | All existing verify gates stay green; add vitality-pinned regression fixture (vitality=1.0 → behavior matches pre-organism baseline) |
| Phase 29 dormancy interacts unexpectedly with dream_mode (Phase 24) | 29 | dream_mode MUST NOT trigger if vitality < 0.2; add guard in dream_mode.rs entry point |

---

## Notes

- **Phase numbering continues globally** per M-05 / M-12. v1.4 starts at Phase 25; v1.5 starts at Phase 32 (or later if close phase shifts).
- **Activity log strip remains load-bearing.** All organism-layer events (hormone updates, vitality changes, prediction errors, safety triggers) must emit to ActivityStrip (M-07 contract).
- **Performance budgets carry forward** from v1.0/v1.1/v1.2/v1.3. Dashboard first paint ≤200ms on integrated GPU, max 3 backdrop-filter per viewport, blur caps 20/12/8px.
- **Verify gates extend, not replace.** v1.4 adds `verify:organism` (33 → 34). All 33 existing gates must remain green throughout; regressions fail the phase.
- **Static gates ≠ done** per CLAUDE.md Verification Protocol. Runtime UAT applies to chat-functionality regressions; organism-layer behavioral changes must be exercised end-to-end, not just via cargo check.
- **Safety bundle is a hard gate.** No organism feature (hormones, vitality, active inference) proceeds until Phase 26 is complete and all safety eval scenarios pass.
- **Existing substrate for v1.4:** `homeostasis.rs` (hormone bus anatomy, no physiology), `decision_gate.rs` (single confidence scalar), `perception_fusion.rs` (unified perception state), `proactive_engine.rs` (signal detectors), `dream_mode.rs` (consolidation), `brain.rs` (system prompt builder), `reward.rs` (composite reward signal). Extend, do not rewrite.

---

*Last updated: 2026-05-03 — Phase 30 planned (2 plans in 2 waves). v1.4 ROADMAP.md updated.*
