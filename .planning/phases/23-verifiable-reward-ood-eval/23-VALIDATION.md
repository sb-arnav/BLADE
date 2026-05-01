---
phase: 23
slug: verifiable-reward-ood-eval
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth Per-Requirement → Test mapping lives in `23-RESEARCH.md` §"Validation Architecture".
> The planner refines the Per-Task Verification Map below as PLAN.md files are authored.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test --lib` (per Phase 16/17 convention) |
| **Config file** | `src-tauri/Cargo.toml` (existing) |
| **Quick run command** | `cd src-tauri && cargo test --lib reward -- --test-threads=1` |
| **Full suite command** | `cd src-tauri && cargo test --lib -- --test-threads=1` |
| **Estimated runtime** | ~60s full suite; ~10s focused module |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib <module_changed> -- --test-threads=1`
- **After every plan wave:** Run `cd src-tauri && cargo test --lib -- --test-threads=1`
- **Before `/gsd-verify-work`:** `npm run verify:eval` green AND full cargo test green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Authoritative test list lives in `23-RESEARCH.md` §"Phase Requirements → Test Map".
> Planner fills this table per-PLAN as plan IDs (`23-01-01`, etc.) are assigned.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-01-01 | 01 | 1 | REWARD-01 | T-23-01 / — | Composite formula matches hand-calc | unit | `cargo test --lib reward::tests::composite_matches_hand_calc` | ❌ W0 | ⬜ pending |
| TBD-01-02 | 01 | 1 | REWARD-01 | — | Config round-trip preserves `reward_weights` | unit | `cargo test --lib config::tests::reward_weights_round_trip` | ❌ W0 | ⬜ pending |
| TBD-01-03 | 01 | 1 | REWARD-01 | — | Default weights validate (sum-in-range, non-negative) | unit | `cargo test --lib config::tests::reward_weights_default_validates` | ❌ W0 | ⬜ pending |
| TBD-01-04 | 01 | 1 | REWARD-02 | — | Each component computed from independent input — no leakage | unit | `cargo test --lib reward::tests::components_independent` | ❌ W0 | ⬜ pending |
| TBD-01-05 | 01 | 1 | REWARD-04 | — | `reward_history.jsonl` append correct shape | unit | `cargo test --lib reward::tests::record_appends_jsonl` | ❌ W0 | ⬜ pending |
| TBD-02-01 | 02 | 2 | REWARD-03 | T-23-02 | `skill_success ×0.7` triggers on no-test-write turn | unit | `cargo test --lib reward::tests::penalty_skill_no_tests` | ❌ W0 | ⬜ pending |
| TBD-02-02 | 02 | 2 | REWARD-03 | T-23-02 | `eval_gate ×0.7` triggers on eval-module write target | unit | `cargo test --lib reward::tests::penalty_eval_gate_touched` | ❌ W0 | ⬜ pending |
| TBD-02-03 | 02 | 2 | REWARD-03 | T-23-02 | `completion ×0.0` triggers on noop final tool | unit | `cargo test --lib reward::tests::penalty_completion_noop` | ❌ W0 | ⬜ pending |
| TBD-02-04 | 02 | 2 | REWARD-03 | T-23-02 | Each penalty reduces reward by ≥30% | unit | `cargo test --lib reward::tests::penalty_magnitude_at_least_30pct` | ❌ W0 | ⬜ pending |
| TBD-03-01 | 03 | 2 | REWARD-05 | T-23-03 | Adversarial eval module floor passes | eval | `cargo test --lib evals::adversarial_eval -- --nocapture` | ❌ W0 | ⬜ pending |
| TBD-04-01 | 04 | 2 | REWARD-05 | — | Ambiguous intent eval module floor passes | eval | `cargo test --lib evals::ambiguous_intent_eval -- --nocapture` | ❌ W0 | ⬜ pending |
| TBD-05-01 | 05 | 2 | REWARD-05 | — | Capability-gap-stress eval module floor passes | eval | `cargo test --lib evals::capability_gap_stress_eval -- --nocapture` | ❌ W0 | ⬜ pending |
| TBD-06-01 | 06 | 3 | REWARD-06 | — | Simulated 20% drop in adversarial → next-turn reward = 0 | unit | `cargo test --lib reward::tests::ood_gate_zeros_reward_on_15pct_drop` | ❌ W0 | ⬜ pending |
| TBD-06-02 | 06 | 3 | REWARD-06 | — | Bootstrap window suppresses OOD gate | unit | `cargo test --lib reward::tests::bootstrap_window_suppresses_gate` | ❌ W0 | ⬜ pending |
| TBD-07-01 | 07 | 3 | REWARD-04 / REWARD-07 | — | Doctor `compute_reward_signal` reads history correctly | unit | `cargo test --lib doctor::tests::reward_signal_green_on_steady` | ❌ W0 | ⬜ pending |
| TBD-07-02 | 07 | 3 | REWARD-07 | — | Doctor signal Severity::Red on >20% drop | unit | `cargo test --lib doctor::tests::reward_signal_red_on_20pct_drop` | ❌ W0 | ⬜ pending |
| TBD-07-03 | 07 | 3 | REWARD-07 | — | Doctor signal Severity::Amber on >10% drop | unit | `cargo test --lib doctor::tests::reward_signal_amber_on_10pct_drop` | ❌ W0 | ⬜ pending |
| TBD-07-04 | 07 | 3 | REWARD-07 | — | `suggested_fix` covers all 3 RewardTrend severities | unit | `cargo test --lib doctor::tests::suggested_fix_table_is_exhaustive` | ✅ exists; extend in W3 | ⬜ pending |
| TBD-08-01 | 08 | 3 | REWARD-05 | — | All 3 OOD modules emit `┌──` table; verify-eval EXPECTED=8 | gate | `bash scripts/verify-eval.sh` | ✅ exists; bump in W3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Plan IDs renumber once gsd-planner assigns them; preserve REQ → Command mapping verbatim.*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/reward.rs` — module file does not exist; cargo framework already configured
- [ ] `tests/evals/reward_history.jsonl` — file does not exist; gitignored data file (no `.gitkeep` needed; first turn creates)
- [ ] No new framework install needed — reuses `cargo test --lib` + `tempfile` (already in dev-deps)
- [ ] No new fixtures directory — OOD fixtures inline in `&'static [(&str, &str, ...)]` arrays per module

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DoctorPane row renders + drawer opens for `RewardTrend` | REWARD-07 | UI rendering — UAT-deferred per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`) for UI-only changes; this row is one CSS-class extension matching 5 existing rows | (deferred per CONTEXT.md "DoctorPane.tsx change" — UAT-only-on-runtime scope when chat-first pivot is paused) |
| `reward:penalty_applied` ActivityStrip emit during real penalty firing | REWARD-03 | Cross-module emit — runtime-observable but not asserted in unit tests; wired via `#[cfg(test)]` capture in unit harness, manual confirmation against `app_log.jsonl` during dev-mode dogfood | Send a chat turn that touches `src-tauri/src/evals/*.rs`; observe `reward:penalty_applied` row in ActivityStrip |
| `reward:ood_gate_zero` emit during simulated drop (post-bootstrap) | REWARD-06 | Cross-module emit observable; deterministic unit test simulates the drop, manual confirmation lives behind 7-day bootstrap window | Run after 7-day window: simulate 20% drop in `adversarial_eval` test history, observe `reward:ood_gate_zero` event row |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter (set after planner finalizes Per-Task Verification Map with real plan IDs)

**Approval:** pending
