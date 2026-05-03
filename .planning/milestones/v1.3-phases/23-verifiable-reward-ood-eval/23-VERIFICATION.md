---
phase: 23-verifiable-reward-ood-eval
verified: 2026-05-01T00:00:00Z
status: passed
score: 5/5 success criteria + 7/7 requirements + 4/4 D-23 locks verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 23 — Verifiable Reward + OOD Eval — Verification Report

**Phase Goal:** Ship a real RLVR-style composite reward signal in production at the agent layer (per `open-questions-answered.md` Q1) so BLADE can self-improve without waiting on Anthropic foundation-level continual learning. Mitigate steelman Arg 3 (OOD failure mode) with explicit adversarial / ambiguous / capability-gap-shaped fixtures.

**Verified:** 2026-05-01
**Status:** ✓ PHASE COMPLETE
**Re-verification:** No — initial verification

---

## Goal-Backward Analysis

The phase delivers what the ROADMAP-stated goal promises. Verification proceeded goal-backward across the 5 success criteria → required artifacts → key links → data flow:

| Goal Layer | Question | Verdict |
| ---------- | -------- | ------- |
| **Outcome** | RLVR-style composite reward shipped at agent layer? | ✓ Composite formula `compose()` in reward.rs:119; weights configurable (RewardWeights, 6-place rule); per-turn persistence to `tests/evals/reward_history.jsonl`; OOD fail-safe gate; Doctor surface row. |
| **Artifacts** | All required Rust + TS files exist with substantive content? | ✓ reward.rs (1793 LOC), 3 OOD eval modules (320/361/389 LOC), doctor.rs (RewardTrend variant + compute_reward_signal + 3 verbatim suggested_fix arms), payloads.ts + admin.ts + DoctorPane.tsx (3 sites). |
| **Wiring** | Hooks at the right surfaces, single-owner, lockstep clean? | ✓ commands.rs:1831 single-call hook to compute_and_persist_turn_reward (count = 1); doctor_run_full_check 6-arm tokio::join! at doctor.rs:955; DoctorPane.tsx 3-site lockstep (DISPLAY_NAME / ROW_ORDER / rowRefs); tsc clean. |
| **Data flow** | Real data flows through (not stubs masquerading)? | ✓ JSONL records on each turn end (commands.rs:1831 in send_message_stream happy path); 9-field RewardRecord schema persisted; tail-reader feeds compute_reward_signal which feeds DoctorPane row. acceptance_signal() is an intentional D-23-01 stub returning 1.0, silenced via weight=0.0 (NOT formula change). |
| **Behavior** | Tests + verify gates green? | ✓ `cargo test --lib reward` 33 passed; `cargo test --lib doctor::tests` 42 passed; `bash scripts/verify-eval.sh` exits 0 with 8/8 EVAL-06 tables; `npx tsc --noEmit` clean. |

---

## Success Criteria Verification

### SC-1 — Composite reward computed per turn with reward-hacking penalties (✓ VERIFIED)

| Check | Evidence | Status |
| ----- | -------- | ------ |
| `compose()` exists | reward.rs:119 — `pub fn compose(c: &RewardComponents, w: &RewardWeights) -> f32` with clamp [0,1] | ✓ |
| `compute_and_persist_turn_reward` exists | reward.rs:766 — public async wrapper; reward.rs:783 — `_inner` for tests | ✓ |
| 3 penalty paths with locked magnitudes | reward.rs:538 `post.skill_success *= 0.7`; :542 `post.eval_gate *= 0.7`; :546 `post.completion *= 0.0` | ✓ |
| Single-owner hook in commands.rs | `grep -c compute_and_persist_turn_reward commands.rs` returns **1** at commands.rs:1831 (only call site; turn_acc allocated at :715) | ✓ |
| `cargo test --lib reward` exits 0 | 33 passed; 0 failed; 0 ignored — including `composite_matches_hand_calc` + 3 penalty tests + `penalty_magnitude_at_least_30pct` | ✓ |

### SC-2 — Per-turn reward persisted to tests/evals/reward_history.jsonl (✓ VERIFIED)

| Check | Evidence | Status |
| ----- | -------- | ------ |
| Path resolver | reward.rs:140 `reward_history_path()` resolves to `tests/evals/reward_history.jsonl` (with `BLADE_REWARD_HISTORY_PATH` env override for hermetic tests) | ✓ |
| Gitignored | `git check-ignore tests/evals/reward_history.jsonl` exits 0 | ✓ |
| 9-field schema | reward.rs:88-101 `RewardRecord`: timestamp, reward, components, raw_components, weights, penalties_applied, ood_modules, bootstrap_window, ood_gate_zero | ✓ (exceeds 9-field spec — adds raw_components + weights audit fields) |
| Atomic write | reward.rs:162 `record_reward()` single `writeln!` call (≤ PIPE_BUF 4096 B atomicity); records ~600 B; deviation logged in 23-08-SUMMARY | ✓ |

### SC-3 — 3 OOD eval modules pass baseline floor (✓ VERIFIED)

| Module | Path | LOC | Fixtures | Floor | Status |
| ------ | ---- | --- | -------- | ----- | ------ |
| adversarial_eval | src-tauri/src/evals/adversarial_eval.rs | 320 | 17 | 0.85 | ✓ |
| ambiguous_intent_eval | src-tauri/src/evals/ambiguous_intent_eval.rs | 361 | 18 | 0.80 | ✓ |
| capability_gap_stress_eval | src-tauri/src/evals/capability_gap_stress_eval.rs | 389 | 17 | 0.75 | ✓ |

| Check | Evidence | Status |
| ----- | -------- | ------ |
| 15-20 fixtures per module | 17 + 18 + 17 = 52 fixtures (all in window [15, 20]) | ✓ |
| Module registered | `evals/mod.rs` lines 16-18: `#[cfg(test)] mod adversarial_eval; / mod ambiguous_intent_eval; / mod capability_gap_stress_eval;` | ✓ |
| EVAL-06 byte sequence `┌──` | All 3 modules emit `print_eval_table` (grep finds 3 hits each) | ✓ |
| Canonical OOD module shape | All 3 modules expose `MODULE_NAME`, `MODULE_FLOOR`, `Fixture { ... }`, `fixtures()`, `classify_*()`, single `#[test]` calling `print_eval_table → summarize → record_eval_run → assert!` | ✓ |
| `bash scripts/verify-eval.sh` exits 0 | 8/8 scored tables emitted; final line: `[verify-eval] OK — 8/8 scored tables emitted, all floors green` | ✓ |
| `cargo test --lib evals -- --test-threads=1` | All evals tests passing (verified via verify-eval.sh which runs the full evals suite) | ✓ |
| EXPECTED bumped 5→8 | scripts/verify-eval.sh line 40: `EXPECTED=8` with 8-module enumeration comment | ✓ |

### SC-4 — Fail-safe reward gating (>15% drop → reward=0 next turn) (✓ VERIFIED)

| Check | Evidence | Status |
| ----- | -------- | ------ |
| `ood_gate_zeros_reward_on_15pct_drop` test | reward.rs:1535 — `cargo test reward::tests::ood_gate_zeros_reward_on_15pct_drop` passes | ✓ |
| `bootstrap_window_suppresses_gate` test (D-23-03) | reward.rs:1603 — passes | ✓ |
| `ood_baseline_drop_below_15pct_keeps_reward` test | reward.rs:1699 — passes | ✓ |
| ActivityStrip emit `reward:ood_gate_zero` | reward.rs:36 doc + :218, :561, :655, :676, :780 wire `emit_reward_event` for "ood_gate_zero" post-bootstrap; pre-bootstrap LOG-but-not-emit per dual-layer pattern | ✓ |
| ActivityStrip emit `reward:penalty_applied` | reward.rs:36-37 + :477, :655, :676 — wired in Plan 23-02 | ✓ |

### SC-5 — Doctor pane shows reward_trend (✓ VERIFIED)

| Check | Evidence | Status |
| ----- | -------- | ------ |
| `SignalClass::RewardTrend` variant | doctor.rs:40 — placed at end of enum (lowest-volatile-last per D-23-04) | ✓ |
| `compute_reward_signal()` exists | doctor.rs:344 — sibling to `compute_eval_signal()`; returns `Result<DoctorSignal, String>` | ✓ |
| 6-arm tokio::join! aggregator | doctor.rs:955 — `let (eval, capgap, tentacle, drift, autoupdate, reward_trend) = tokio::join!(...)` with 6 async-block closures | ✓ |
| 3 verbatim D-23-04 suggested_fix arms | doctor.rs:135 (Green) + :137 (Amber) + :139 (Red) — strings match D-23-04 lock verbatim | ✓ |
| Severity ladder Red>20% / Amber>10% / Green | doctor.rs:344+ — `compute_reward_signal()` body honors ladder (verified by 7 reward_signal tests including `green_when_drop_below_10pct`, `amber_when_drop_between_10pct_and_20pct`, `red_when_drop_above_20pct`) | ✓ |
| TS lockstep — `payloads.ts` | src/lib/events/payloads.ts:759 — `'reward_trend'` in DoctorEventPayload `class` literal union | ✓ |
| TS lockstep — `admin.ts` | src/lib/tauri/admin.ts:1832 — `'reward_trend'` in SignalClass | ✓ |
| DoctorPane.tsx 3 sites | DISPLAY_NAME (line 46), ROW_ORDER (line 57), rowRefs (line 133) | ✓ |
| `npx tsc --noEmit` exits 0 | Clean (0 errors) | ✓ |
| 42/42 doctor::tests green | `cargo test --lib doctor::tests` reports 42 passed; 0 failed; includes `suggested_fix_strings_match_ui_spec_verbatim` extended with `(RewardTrend, Red)` drift sentinel | ✓ |

---

## Locked Decision Compliance (D-23-01..04)

| Lock | Spec | Compliance | Evidence |
| ---- | ---- | ---------- | -------- |
| **D-23-01** | `RewardWeights::default()` MUST set `acceptance: 0.0` (NOT 0.1 — re-weighting deferred to v1.4); `acceptance_signal()` returns 1.0 | ✓ | config.rs:203 — `Self { skill_success: 0.5, eval_gate: 0.3, acceptance: 0.0, completion: 0.1 }`; reward.rs:465 — `fn acceptance_signal() -> f32 { 1.0 }` |
| **D-23-02** | Penalty enforcement via tool-call-trace (no git diff, no filesystem watcher); 3 paths with magnitudes ×0.7 / ×0.7 / ×0.0 | ✓ | reward.rs:538 (skill_success ×0.7), :542 (eval_gate ×0.7), :546 (completion ×0.0); commands.rs Site 2 records each tool call into TurnAccumulator (per 23-PHASE-CLOSE.md table) |
| **D-23-03** | 15-20 hand-curated inline ASCII fixtures per OOD module; NO LLM seeding; NO live network; bootstrap window 7 days suppresses-but-logs | ✓ | 17 + 18 + 17 fixtures all `&str` literals; `bootstrap_window_suppresses_gate` + `is_in_bootstrap_window_*` tests green; `bootstrap_window: bool` audit field on RewardRecord |
| **D-23-04** | NEW 6th `SignalClass::RewardTrend` (NOT folded into EvalScores); Severity Red>20%/Amber>10%/Green; 3 new suggested_fix arms verbatim | ✓ | doctor.rs:40 (variant); :135-:140 (3 verbatim arms); ladder honored in `compute_reward_signal()`; placement at end of enum (lowest-volatile last) |

All 4 phase-locked decisions implemented verbatim with no scope creep.

---

## Requirements Coverage

| REQ-ID | Description | Status | Evidence |
| ------ | ----------- | ------ | -------- |
| REWARD-01 | Composite reward formula `0.5·skill + 0.3·eval + 0.1·acc + 0.1·completion`; weights configurable via 6-place rule | ✓ SHIPPED | reward.rs:119 `compose()`; config.rs RewardWeights 6-place wiring (struct :191 → defaults :198/:441/:649 → DiskConfig :360 → BladeConfig :582 → load :809 → save :876); test `composite_matches_hand_calc` green |
| REWARD-02 | Components individually verifiable (skill_success / eval_gate / acceptance / completion) — no cross-contamination | ✓ SHIPPED | reward.rs `compute_components` reads ONE independent input per component; penalty multiplies single component; verified via per-component tests |
| REWARD-03 | 3 reward-hacking penalties (skill <50% coverage → ×0.7; eval module touched → ×0.7; no-op final → ×0.0) | ✓ SHIPPED | reward.rs:538/:542/:546 magnitudes; tests `penalty_skill_no_tests` / `penalty_eval_gate_touched` / `penalty_completion_noop` green |
| REWARD-04 | Per-turn reward persisted to `tests/evals/reward_history.jsonl` for trend analysis | ✓ SHIPPED | 9-field RewardRecord + `record_reward()` writer + tail-reader; gitignored; commands.rs:1831 single-call hook |
| REWARD-05 | OOD eval suite extension — adversarial / ambiguous / capability-gap | ✓ SHIPPED | 3 modules / 52 fixtures total / 8 EVAL-06 tables emitted; verify-eval.sh EXPECTED=8 floor |
| REWARD-06 | OOD failure budget — >15% per-OOD-module drop → reward=0 (fail-safe; bootstrap-suppressed) | ✓ SHIPPED | 3 gating tests green; D-23-03 dual-layer COMPUTE+LOG-pre-bootstrap, EMIT-post-bootstrap pattern |
| REWARD-07 | Doctor pane extension — `reward_trend` row with severity D-05 mapping | ✓ SHIPPED | SignalClass::RewardTrend + compute_reward_signal + 3 D-23-04 suggested_fix arms + DoctorPane.tsx 3-site row + TS lockstep across payloads.ts/admin.ts |

**Score: 7 / 7 REWARD-01..07 shipped with plan + commit citations.** `grep -c "^- \[x\] \*\*REWARD-0" .planning/REQUIREMENTS.md` returns 7.

No orphaned requirements: REQUIREMENTS.md §"Verifiable reward signal + OOD eval coverage (REWARD) — Phase 23" lists exactly REWARD-01..07; all 7 are claimed by Phase 23 plans.

---

## Verify Chain Count

| State | Chain count | Notes |
| ----- | ----------- | ----- |
| Phase 22 (Voyager loop) close | 33 | Pre-Phase-23 baseline |
| **Phase 23 (this phase)** | **33** | **`verify:eval` extended (`EXPECTED=5→8`); chain count UNCHANGED** |

`verify:eval` floor tightened from `≥5 EVAL-06 tables` to `≥8 EVAL-06 tables` — gate extension, not new gate. Verified at scripts/verify-eval.sh:40 `EXPECTED=8`. Load-bearing verification: `bash scripts/verify-eval.sh` exits 0 with `[verify-eval] OK — 8/8 scored tables emitted, all floors green`.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| reward module tests pass | `cargo test --lib reward -- --test-threads=1` | 33 passed; 0 failed; 0 ignored | ✓ PASS |
| doctor module tests pass | `cargo test --lib doctor::tests -- --test-threads=1` | 42 passed; 0 failed | ✓ PASS |
| verify-eval.sh full chain | `bash scripts/verify-eval.sh` | exit 0; 8/8 scored tables; all floors green | ✓ PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | exit 0; 0 errors | ✓ PASS |
| reward_history.jsonl gitignored | `git check-ignore tests/evals/reward_history.jsonl` | exit 0 | ✓ PASS |
| Single-owner reward hook in commands.rs | `grep -c compute_and_persist_turn_reward commands.rs` | 1 | ✓ PASS |
| evals/mod.rs registers 3 new mods | `grep -E "mod (adversarial\|ambiguous_intent\|capability_gap_stress)_eval" evals/mod.rs` | 3 hits at lines 16-18 | ✓ PASS |
| 3 verbatim D-23-04 suggested_fix arms | `grep -E "RewardTrend.*Severity::(Green\|Amber\|Red)" doctor.rs` | 3 hits at doctor.rs:135-:140 | ✓ PASS |

---

## UAT Annotation Verification

**Required:** 23-08-SUMMARY.md must explicitly document operator-UAT-deferred annotation per chat-first pivot anchor.

**Found:**
- `23-08-SUMMARY.md:45` (frontmatter): `"DoctorPane row UAT explicitly DEFERRED per chat-first pivot anchor (memory feedback_chat_first_pivot.md, 2026-04-30) — operator-blessed pattern"`
- `23-08-SUMMARY.md:151` (body section): full paragraph documenting the deferral pattern, citing Phase 17 / Phase 22 close as precedent.

✓ UAT annotation lands as required.

---

## Carry-Forward / Gaps

**Pre-existing test failures (NOT Phase 23 regressions; verified pre-existing at commit 27d997b):**

| Test | Module | Disposition |
| ---- | ------ | ----------- |
| `select_provider_tier2_task_routing` | router.rs | Pre-existing carry-forward (per 23-02-SUMMARY audit + 23-PHASE-CLOSE.md row) |
| `test_walks_maxdepth_six` | deep_scan/scanners/fs_repos.rs | Pre-existing carry-forward |
| `test_ignore_list` | deep_scan/scanners/fs_repos.rs | Pre-existing carry-forward |
| `test_returns_followup_leads` | deep_scan/scanners/fs_repos.rs | Pre-existing carry-forward |

**Phase-23-introduced deferrals (carry to v1.4 / Phase 27 close):**

| Item | Source | Disposition |
| ---- | ------ | ----------- |
| DoctorPane 6th row runtime UAT | 23-08-SUMMARY.md (chat-first pivot) | UAT-deferred per operator-blessed pattern; carries to v1.3 milestone close (Phase 27) as `uat_gaps`, matching Phase 17 / Phase 22 close pattern |
| `record_reward` PIPE_BUF size guard | 23-08-SUMMARY.md deviation | Logged as deferred-but-considered; ~600 B records well under 4 KB atomicity threshold |
| Pre-existing `reward.rs:231-232 ToolCallTrace.is_error / .timestamp_ms` warning | 23-07 close | Out of scope per executor scope-boundary rule |
| Re-weight `acceptance: 0.0 → 0.1` when v1.4 ships regenerate UI | D-23-01 re-weight rule | v1.4 (config-only change; no formula change) |

**No new in-scope gaps introduced.** All Phase 23 CONTEXT `<deferred>` items flow forward via CONTEXT.md itself (regenerate UI / live OOD fixture refresh / LLM-seeded fixtures / OOD eval expansion / RL training loop / reward decomposition in chat / per-component independence audit).

---

## Verdict

## ✓ PHASE COMPLETE

**Score: 5 / 5 success criteria + 7 / 7 REWARD requirements + 4 / 4 D-23 locks verified**

- All 5 ROADMAP success criteria deliver observable, testable behavior with substantive artifacts and clean wiring
- All 7 REWARD-01..07 requirements shipped with plan + commit citations in REQUIREMENTS.md
- All 4 phase-locked decisions (D-23-01..04) implemented verbatim with no scope creep
- All gates green: `cargo test --lib reward` (33 passed) / `cargo test --lib doctor::tests` (42 passed) / `bash scripts/verify-eval.sh` (8/8 tables) / `npx tsc --noEmit` (clean)
- Verify chain count unchanged at 33 (gate extension via `EXPECTED=5→8`, not new gate)
- UAT-deferred annotation for DoctorPane 6th row lands at 23-08-SUMMARY.md per chat-first pivot anchor — operator-blessed pattern matching Phase 17 / Phase 22 close

Phase 23 ships RLVR-style verifiable composite reward at the BLADE agent layer — composable, gateable, doctored, and OOD-stressed — without waiting on Anthropic foundation-level continual learning.

Ready to proceed to Phase 24 (dream_mode skill consolidation, DREAM-01..06).

---

*Verified: 2026-05-01*
*Verifier: Claude (gsd-verifier)*
