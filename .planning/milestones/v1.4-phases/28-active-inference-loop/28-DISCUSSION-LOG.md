# Phase 28: Active Inference Loop - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 28-active-inference-loop
**Areas discussed:** Prediction State Architecture, Error Calculation, Error→Hormone Mapping, Demo Loop, Hippocampal Replay, Prediction Learning, DoctorPane Signal, Persistence
**Mode:** Auto-select (user requested autonomous decision-making)

---

## Prediction State Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Tentacle struct | Add prediction fields to existing hive.rs Tentacle struct | |
| New active_inference.rs module | Separate module with own state, reads from hive + writes to homeostasis | ✓ |
| SQLite-only (no in-memory state) | Store predictions only in DB, query on each tick | |

**User's choice:** New active_inference.rs module
**Notes:** Hive.rs Tentacle struct is already data-heavy with 15+ consumers. Active inference is conceptually separate — it interprets reports, not collects them. Follows the pattern of metacognition.rs (separate from brain.rs) and safety_bundle.rs (separate from decision_gate.rs).

---

## Error Calculation & Normalization

| Option | Description | Selected |
|--------|-------------|----------|
| Single global error function | One normalization for all tentacles | |
| Per-tentacle-type normalization | Each tentacle type defines its own signals and normalization | ✓ |
| LLM-based error assessment | Use LLM to evaluate "how surprising" a report is | |

**User's choice:** Per-tentacle-type normalization
**Notes:** Each tentacle produces structurally different data. Calendar events vs Slack messages vs GitHub PRs need different normalization. Rule-based functions are testable, deterministic, and cost-free. LLM assessment rejected — too expensive per tick (30s cycle), and the point of active inference is computational efficiency.

---

## Error → Hormone Mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Replace emotion classifier | Prediction errors replace the Phase 27 classifier | |
| Second input channel (additive) | Both classifier and prediction errors feed the same hormone bus | ✓ |
| Separate hormone layer for inference | New hormone scalars specific to active inference | |

**User's choice:** Second additive input channel
**Notes:** Emotion classifier tracks BLADE's output quality; prediction errors track world-state mismatch. Both are valid hormone inputs — they measure different things. Additive with same α=0.05 means neither channel dominates. A separate layer would fragment the hormone bus.

---

## Demo Loop Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone demo command | Separate command that forces the demo state | |
| Hook into hive_tick cycle | Compute prediction errors as part of normal tick, test with synthetic reports | ✓ |
| Separate demo tick loop | Parallel loop for inference, independent of hive_tick | |

**User's choice:** Hook into hive_tick
**Notes:** The demo must prove the REAL pipeline works, not a separate demo path. Synthetic reports use the same format as real tentacle output — the test proves the actual production code. Adding ~1ms per tick is negligible.

---

## Hippocampal Memory Replay

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing consolidation | Add error weighting to task_memory_consolidation() | |
| New dream task (task_prediction_replay) | Fourth task in dream session, after consolidate before generate | ✓ |
| Continuous replay (not dream-only) | Replay high-error memories during normal operation | |

**User's choice:** New dream task
**Notes:** Dream mode is explicitly for consolidation — prediction replay fits naturally. Running during normal operation wastes resources and competes with real-time processing. Ordering prune → consolidate → replay → generate ensures replay informs skill generation.

---

## Prediction Learning

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed expected states | Never update predictions — purely reactive | |
| Exponential moving average | EMA with per-tentacle learning rates | ✓ |
| Bayesian updating | Full posterior distribution per signal | |

**User's choice:** Exponential moving average
**Notes:** EMA is the right complexity level — simple, proven, tunable per tentacle type. Bayesian updating is mathematically elegant but overkill for 3-5 signals per tentacle. Fixed states would mean no learning (AINF-06 requires learning). Per-tentacle rates (calendar α=0.1 fast, GitHub α=0.05 slow) match real-world variance.

---

## DoctorPane Signal

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Hormones signal | Add inference data to Phase 27's hormone row | |
| New SignalClass::ActiveInference | Dedicated row following Phase 25/27 pattern | ✓ |
| No DoctorPane integration | Only backend, no UI surface | |

**User's choice:** New SignalClass::ActiveInference
**Notes:** Active inference is a distinct concept from hormone levels — it deserves its own signal row. Cramming it into the hormone row would overload that display. The pattern from Phase 25 (metacognition) and Phase 27 (hormones) is well-established.

---

## Claude's Discretion

- Exact numeric defaults for cold-start expected states
- Signal extraction functions per tentacle report format
- Error threshold for hippocampal replay
- Top-N count for dream replay
- Per-signal normalization ranges
- DoctorPane row formatting
- Event emission strategy for prediction error threshold crossings

## Deferred Ideas

None — all decisions stay within phase scope.
