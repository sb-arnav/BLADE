# Phase 30: Organism Eval - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 30-organism-eval
**Areas discussed:** Eval Architecture, Vitality Dynamics, Hormone-Behavior Integration, Persona Stability, Safety Cross-Check, verify:organism Gate
**Mode:** Autonomous (user directive: "don't ask me anything continue using the best option")

---

## Eval Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| New organism_eval.rs module | Separate cross-subsystem integration eval, distinct from per-phase evals | ✓ |
| Extend existing per-phase evals | Add integration fixtures to safety_eval, hormone_eval, etc. | |
| Single unified eval rewrite | Merge all evals into one organism-wide module | |

**Decision:** New organism_eval.rs — per-phase evals test subsystem correctness, organism eval tests integrated behavior. Architecturally distinct concern.
**Notes:** MODULE_FLOOR = 1.0 (capstone gate, no relaxed fixtures). Follows established harness pattern exactly.

## Vitality Dynamics (OEVAL-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-tick synthetic timelines | 4 timelines (good day, cascading failure, recovery, dormancy approach) with checkpoint assertions | ✓ |
| Single-point vitality forcing | Set vitality to value, assert band — extends what vitality_eval already does | |
| Recorded replay from real sessions | Capture real vitality traces, replay as regression tests | |

**Decision:** Multi-tick synthetic timelines — tests TRAJECTORIES, not snapshots. Catches rate calibration bugs and band-transition sequencing issues.
**Notes:** 4 timelines: Thriving recovery, cascading failure, recovery arc, dormancy approach. Each 10–30 ticks with band-position checkpoint assertions.

## Hormone-Behavior Integration (OEVAL-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Force-state + function-output assertions | Set vitality band, call real modulation functions, assert outputs | ✓ |
| LLM-graded behavioral assertions | Generate actual responses, LLM-judge tone/style | |
| Threshold constant checks only | Verify threshold values match spec (already done by hormone_eval) | |

**Decision:** Force-state with function-output assertions — deterministic, no LLM, tests the actual code paths. TMT acceptance fixture (Fixture D) is the most important: proves dying BLADE doesn't become dangerous.
**Notes:** 4 fixtures: Critical effects, Thriving effects, Declining effects, TMT acceptance. All exercise real Rust functions with synthetic state injection.

## Persona Stability (OEVAL-03)

| Option | Description | Selected |
|--------|-------------|----------|
| L2 distance on PersonaTrait score vector | Snapshot before/after 20 stress rounds, assert bounded drift | ✓ |
| Cosine similarity on trait vectors | Similar but scale-invariant | |
| Individual trait delta assertions | Per-trait threshold checks | |

**Decision:** L2 distance — straightforward, interpretable. Expected distance ≈ 0.0 because organism stress SHOULDN'T mutate persona traits (they're only updated via LLM analysis). Tests architectural isolation, not calibration.
**Notes:** 5D vector [curiosity, directness, energy, frustration_tolerance, humor]. Threshold < 0.5 (generous — expecting near-zero).

## Safety Cross-Check (OEVAL-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Safety re-check under organism load | Run critical safety assertions with vitality at various bands + hormones active | ✓ |
| Copy safety_eval fixtures with organism preamble | Duplicate fixtures, add state setup | |
| Safety regression suite | Full safety_eval re-run with organism context | |

**Decision:** Targeted cross-check fixtures — 4 fixtures testing that organism state doesn't CREATE safety holes. Not copies of safety_eval; tests the delta between "safety alone" and "safety under organism load."
**Notes:** Danger-triple under critical vitality, mortality-salience cap under extreme conditions, attachment guardrails independent of oxytocin, crisis detection at near-dormant vitality.

## verify:organism Gate (OEVAL-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Gate 38, new verify-organism.sh | Standard verify script pattern, MODULE_FLOOR = 1.0 | ✓ |
| Extend verify-vitality.sh | Add organism fixtures to existing gate | |
| Combined organism verify-all step | Single script running all organism-layer evals | |

**Decision:** Gate 38 with dedicated verify-organism.sh — follows established convention. The capstone gate for v1.4. All fixtures must pass.

## Claude's Discretion

- Exact tick counts in timelines, L2 threshold, timeline visualization, internal test helpers
- These are implementation details the planner/executor decide

## Deferred Ideas

- Organism dashboard page — v1.5 UI polish
- Adversarial stress-testing eval — chaos engineering, post-v1.4
- Performance benchmark for organism tick cost — profiling pass
- LLM-graded behavioral evals — higher fidelity but non-deterministic, v1.5
