# Phase 29: Vitality Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 29-vitality-engine
**Areas discussed:** Vitality Architecture, Band Transition Mechanics, SDT Replenishment, Drain Sources, Dormancy & Reincarnation, UI Surface
**Mode:** Autonomous (user directed: "don't ask me questions — continue yourself with the most logical option and don't be average remember the great vision")

---

## Vitality Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Extend homeostasis.rs | Add vitality as another hormone scalar in the existing PhysiologicalState | |
| New vitality_engine.rs module | Separate module that reads from hormones, reward, inference, persona — higher-order construct | ✓ |
| Extend reward.rs | Treat vitality as a meta-reward signal alongside composite reward | |

**Choice:** New module — vitality is not a hormone, it's an organism health score that integrates across 6+ existing modules. Architectural clarity and separation of concerns.
**Rationale:** homeostasis.rs is already dual-layered (PhysiologicalState + HormoneState). Adding a third concern would muddy the module. Vitality reads FROM hormones but is not one.

---

## Band Transition Mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| UI-only bands | Bands change dashboard color but no behavioral difference | |
| System prompt only | Bands inject different personality prompts, no system gating | |
| Full behavioral gating | Bands modulate existing systems: persona, proactive engine, Voyager, dream_mode, metacognition | ✓ |

**Choice:** Full behavioral gating across 5 existing systems.
**Rationale:** The ROADMAP success criteria SC-1 says "each band transition is observable without code inspection." UI-only or prompt-only wouldn't meet this — you need to actually see BLADE behave differently. Modulating existing systems (not adding new ones) is architecturally elegant because Phases 25-28 built all the behavioral machinery.
**Notes:** Hysteresis buffer (+0.05 to move UP) prevents oscillation at band boundaries.

---

## SDT Replenishment Signals

| Option | Description | Selected |
|--------|-------------|----------|
| Single composite input | One replenishment signal from overall system health | |
| Three SDT channels | Competence (reward), Autonomy (decision gate), Relatedness (user engagement) — mapped to concrete codebase events | ✓ |
| Five-channel model | SDT + curiosity + mastery as separate signals | |

**Choice:** Three SDT channels with 0.4/0.3/0.3 weighting.
**Rationale:** SDT (Self-Determination Theory) specifies exactly three innate psychological needs. Adding more dilutes the theoretical grounding. Each maps cleanly to an existing data source (reward.rs, decision_gate.rs, character.rs).

---

## Drain Sources

| Option | Description | Selected |
|--------|-------------|----------|
| Simple failure-only drain | Only tool/eval failures drain vitality | |
| Five-channel drain | Failures + eval drain + isolation + prediction error + tedium | ✓ |
| Hormone-derived drain | Derive all drain from hormone state (e.g., sustained high cortisol = drain) | |

**Choice:** Five independent drain channels with additive accumulation.
**Rationale:** Each channel represents a different failure mode of the organism: technical failure, safety regression, social deprivation, environmental confusion, and cognitive stagnation. The requirement (VITA-03) explicitly lists failures, isolation, skill atrophy, eval-gate failures, prediction error, and tedium — this maps them all.
**Notes:** Calibrated so 1.0→0.0 takes ≥2 hours minimum. Dormancy floor at 0.05 prevents accidental death.

---

## Dormancy & Reincarnation

| Option | Description | Selected |
|--------|-------------|----------|
| Fake dormancy (hidden state) | Set a "dormant" flag, keep process alive but unresponsive | |
| Real process exit | std::process::exit(0) with full state serialization + DORMANCY_STUB for tests | ✓ |
| Gradual shutdown | Multi-minute wind-down with systems shutting off one by one | |

**Choice:** Real process exit with test-mode stub.
**Rationale:** The ROADMAP says "dormancy at 0.0 exits the process" — not "pretends to exit." The risk mitigation (stub exit path in test mode, real exit only in production binary) is already specified in the risk register. Reincarnation starts at 0.3 with hormone reset + preserved memory/persona/skills — continuous identity, fresh affect.
**Notes:** Dormancy floor (D-16) ensures this can't happen accidentally. 5-second grace period for UI farewell.

---

## UI Surface

| Option | Description | Selected |
|--------|-------------|----------|
| DoctorPane only | Vitality visible only in the diagnostic pane | |
| DoctorPane + chat header indicator | Minimal always-visible signal + full diagnostic | ✓ |
| Full vitality dashboard page | Dedicated route with history graph, factor breakdown, band visualization | |

**Choice:** DoctorPane row + chat header indicator. Full dashboard deferred.
**Rationale:** Phase 29 is about the ENGINE, not the dashboard. The minimal indicator (scalar + trend + band color) gives enough visibility to satisfy VITA-05. The detailed visualization can arrive with Phase 30 (Organism Eval) when there's eval data to show alongside.

---

## Claude's Discretion

- Exact EMA window sizes, drain rate coefficients, cosine similarity thresholds
- Ring buffer sizes, grace period duration, fresh install starting vitality
- DoctorPane payload schema, frontend indicator placement/design
- Event emission frequency (suggest: only on band transition or significant delta)
- Internal function boundaries within vitality_engine.rs

## Deferred Ideas

- Vitality dashboard page — Phase 30 or UI polish pass
- Vitality-aware notification throttling — future refinement
- User-adjustable drain rates — v1.5 personalization
- Cross-session vitality momentum — evaluate after Phase 30 eval data
