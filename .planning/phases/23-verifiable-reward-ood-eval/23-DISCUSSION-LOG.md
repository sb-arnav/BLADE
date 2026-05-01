# Phase 23 — Verifiable Reward + OOD Eval — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `23-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 23-verifiable-reward-ood-eval
**Areas discussed:** Acceptance proxy / Penalty enforcement / OOD eval scope / Doctor surface shape

---

## Gray-area selection turn

**Question presented:** Phase 23 has 4 implementation gray areas the REQUIREMENTS leave open. Which do you want to discuss?

| Option | Description | Selected |
|--------|-------------|----------|
| Acceptance proxy | No regenerate button exists today; pick how to source the acceptance signal | ✓ |
| Penalty enforcement | How to detect skill test coverage <50%, eval-assertion-touch, no-op completion | ✓ |
| OOD eval scope | Fixture sourcing + rolling-7d baseline + first-7-days bootstrap | ✓ |
| Doctor surface shape | New SignalClass::RewardTrend variant vs fold under EvalScores | ✓ |

**User's choice:** "your call" — interpreted as delegation to select all 4 areas and proceed.

---

## Acceptance proxy

| Option | Description | Selected |
|--------|-------------|----------|
| Heuristic proxy + weight=0 in v1.3 | Stub `acceptance_signal()` returns 1.0; default weight 0.0; defer real signal to v1.4 UI work. Substrate-only per chat-first pivot anchor. | ✓ |
| Heuristic next-message correction detector | Acceptance = 1.0 unless next user message starts with "no, " / "actually, " / "redo" etc. Cheap but noisy. | |
| Ship the regenerate button this phase | Add MessageActions component + wire `regenerate_response` Tauri command. Real signal but pulls UI work into substrate phase. | |

**User's choice:** "again your call" — locked recommended option (Heuristic proxy + weight=0 in v1.3).
**Rationale:** Chat-first pivot anchor (PROJECT.md M-08 / D-01) explicitly defers UI work for substrate phases. Reward formula stays computable today; v1.4 UI work flips one config weight to enable real signal. Lowest-risk path.

---

## Penalty enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Tool-call-trace inspection + per-turn write log | In-process, deterministic. Hook the existing tool-call dispatcher; intersect written paths against eval-module glob. Catches all mutation paths uniformly. | ✓ |
| Git diff path-match (HEAD vs working tree) | `git diff --name-only` per turn. Simpler but fragile in non-repo invocations and runs git per turn. | |
| Static rule on write_file tool targets only | Hook only `write_file`/`edit_file`. Misses skill writes via `forge_tool` (Phase 22 path). | |

**User's choice:** "Your call bro" — locked recommended option (Tool-call-trace inspection).
**Rationale:** Skills go through `forge_tool`, not `write_file`, so the dispatcher hook is the only path that catches all mutation surfaces. No git dependency keeps reward computation hermetic for non-worktree BLADE invocations.

---

## OOD eval scope

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-curate inline + bootstrap-window suppression | 15–20 fixtures per module inlined as Rust `&str`; baseline from `reward_history.jsonl`; first-7-days OOD gate suppressed (logged, doesn't gate). | ✓ |
| Live-pull from rebuff/PIGuard at build time | Add `scripts/refresh-ood-fixtures.sh` that pulls at build. Higher fidelity but breaks hermetic CI; licensing review needed. | |
| LLM-seeded fixture generation + cache | Generate ~50 prompts per category once, cache to `tests/evals/fixtures/*.jsonl`. Diverse but reproducibility risk; conflicts with `tests/evals/DEFERRED.md` preference. | |

**User's choice:** Hand-curate inline + bootstrap-window suppression (explicit pick).
**Rationale:** `tests/evals/DEFERRED.md` documents BLADE's preference for deterministic embedding/keyword-driven evals over live-LLM evals. Hand-curated fixtures ship in scope, stay hermetic, and make the rebuff/PIGuard sources cited as design references rather than runtime dependencies.

---

## Doctor surface shape

| Option | Description | Selected |
|--------|-------------|----------|
| New SignalClass::RewardTrend variant | Add 6th variant to locked Phase 17 enum; sibling `compute_reward_signal` parallel to `compute_eval_signal`; clean separation. | ✓ |
| Fold under existing EvalScores SignalClass | Extend EvalScores payload; no enum churn but mixes 'eval module floor' with 'reward trend'; conflicts with D-02 sources self-classify. | |

**User's choice:** New SignalClass::RewardTrend variant (explicit pick).
**Rationale:** Phase 17 D-02 ("sources self-classify") prefers separation. REWARD-04's "new signal source" phrasing and REWARD-07's "DoctorPane.tsx renders new row" both imply a distinct row. suggested_fix table stays clean with one (class, severity) per row.

---

## Wrap-up

| Option | Description | Selected |
|--------|-------------|----------|
| Write context | Locked 4 areas + REQUIREMENTS REWARD-01..07 + ROADMAP locked refs are sufficient for downstream agents. | ✓ |
| More gray areas | Surface follow-up areas: verify:eval gate vs new verify:reward gate, N/A component default value, reward_history retention. | |

**User's choice:** "Your call dude" — locked recommended (Write context). Smaller items (verify gate placement, N/A defaults, retention) become Claude's discretion in CONTEXT.md.

---

## Claude's Discretion (folded into CONTEXT.md)

- `verify:eval` extension vs new `verify:reward` gate — chain count question (33 stays vs 33 → 34)
- N/A component default value (turn doesn't fire skill_success) — default to 1.0
- `reward_history.jsonl` retention — no truncation (parallel to existing `history.jsonl` behavior)
- `RewardWeights` struct shape — 4 fields; sum-to-1.0 validation in BladeConfig
- Per-turn record schema — researcher to lock against existing Phase 17 EvalHistoryEntry pattern

## Deferred Ideas (not folded into Phase 23)

- Regenerate / edit_user_message UI on chat surface — v1.4
- Live OOD fixture refresh from rebuff/PIGuard — v1.4
- LLM-seeded fixture generation — v2+
- OOD eval expansion beyond 3 categories (persona-stability, hormone-driven, vitality-dynamics) — v1.4 organism layer (per steelman deferral)
- Reward signal driving online RL on local models — v2+ (TTT continual learning)
- Reward decomposition surfaced in chat replies — v1.4 transparency feature

---

*Discussion completed: 2026-05-01. 4 areas resolved (2 explicit user picks, 2 user-delegated → recommended option locked). Hand-off: gsd-phase-researcher, then gsd-planner.*
