---
phase: 23-verifiable-reward-ood-eval
phase_number: 23
milestone: v1.3
status: shipped
shipped_date: 2026-05-01
plans_total: 9
plans_shipped: 9
requirements_total: 7  # REWARD-01..07
requirements_shipped: 7
verify_gate_count: 33  # unchanged (gate extension, not new gate)
---

# Phase 23 — Verifiable Reward + OOD Eval — PHASE CLOSE

**Status:** ✅ shipped (substrate + UI lockstep; UAT-deferred per chat-first pivot)
**Closed:** 2026-05-01
**Duration:** ~1 working day across 9 plans / 4 waves

---

## Thesis verification

**Phase 23 ships RLVR-style composite reward at agent layer per M-10.** Voyager-loop's `skill_success` contributes the 0.5-weight signal; Phase 16/17's eval gate contributes 0.3; the v1.3-stub `acceptance` + `completion` contribute 0.0 / 0.1; OOD failure gate fail-safes reward to 0 on >15% per-OOD-module drop (post-bootstrap); Doctor pane surfaces the trend with severity per D-23-04. The substrate is observable (ActivityStrip emit per M-07), audit-trailed (per-turn JSONL rows + raw_components pre-penalty preserved + ood_modules per-record audit field), and reaches user surface via the existing M-07 ActivityStrip channel and the 6th DoctorPane row.

**One sentence:** RLVR-style verifiable composite reward shipped at the BLADE agent layer — composable, gateable, doctored, and OOD-stressed — without waiting on Anthropic foundation-level continual learning.

---

## Plan-by-plan ship table

| Plan | Title | Wave | Tests added | Commits | Files touched |
|------|-------|------|-------------|---------|---------------|
| 23-01 | Composite reward substrate | 1 | 11 (5 config + 6 reward) | `44a48ef`, `e6771cd`, `27d997b` | `config.rs`, `reward.rs` (NEW), `lib.rs`, `.gitignore` |
| 23-02 | Penalty layer + commands.rs hook | 2 | 9 (Wave-2 reward) | `f52e45f`, `ba1b459` | `reward.rs` (+517 LOC), `commands.rs` (+25 LOC across 3 sites) |
| 23-03 | OOD adversarial_eval | 2 | 17 fixtures (1 `#[test]`) | `c256771` | `evals/adversarial_eval.rs` (NEW; 320 LOC) |
| 23-04 | OOD ambiguous_intent_eval | 2 | 18 fixtures (1 `#[test]`) | `8fa3d82` | `evals/ambiguous_intent_eval.rs` (NEW; 361 LOC) |
| 23-05 | OOD capability_gap_stress_eval | 2 | 17 fixtures (1 `#[test]`) | `8ca8e62` | `evals/capability_gap_stress_eval.rs` (NEW; 389 LOC) |
| 23-06 | OOD module mod-registration | 2 | — | `5e105f7` | `evals/mod.rs` (+3 lines) |
| 23-07 | Doctor RewardTrend signal | 3 | 7 (Doctor reward_signal) | `38459ef`, `8f25bab` | `doctor.rs` (+434 / -3) |
| 23-08 | REWARD-06 OOD-floor gate + DoctorPane row | 3 | 7 (Wave-3 reward) | `c20cef8`, `563ba95`, `7c02725` | `reward.rs` (+579 LOC), `payloads.ts`, `admin.ts`, `DoctorPane.tsx` |
| 23-09 | verify-eval.sh `EXPECTED=5→8` + phase close | 4 | — | `86841ab`, plus this commit | `scripts/verify-eval.sh`, `REQUIREMENTS.md`, `STATE.md`, `23-PHASE-CLOSE.md` (NEW) |

**Totals:**
- 9 plans / 9 shipped (100%)
- ~16 task-level commits + 9 plan-summary commits = ~25 commits in the phase
- ~52 reportable test entries in `cargo test --lib reward + doctor + evals`:
  - 33 reward+config+doctor reward_signal tests (`cargo test --lib reward`)
  - 12 evals tests (3 OOD + 5 existing modules; some modules have multiple `#[test]`s)
  - 7 of those are the new doctor RewardTrend tests (Plan 23-07)
- ~52 OOD eval fixtures across the 3 new modules (17 + 18 + 17)
- ~3,573 lines added / 7 lines deleted across `src-tauri/src/`, `src/`, `scripts/`, `.gitignore`
- 1 new Rust file (`reward.rs`, 1793 LOC including tests)
- 3 new OOD eval modules (320 + 361 + 389 = 1070 LOC)
- 4 modified TS files (`payloads.ts`, `admin.ts`, `DoctorPane.tsx`, plus existing test fixtures untouched)
- 1 modified shell gate (`scripts/verify-eval.sh` `EXPECTED` constant + comment expansion)

---

## Verify gate delta

| State | Gate count | Notes |
|-------|------------|-------|
| v1.2 close (Phase 20) | 31 | Pre-v1.3 baseline |
| Phase 21 (Skills v2) | 32 | Added `verify:skill-format` |
| Phase 22 (Voyager loop) | 33 | Added `verify:voyager-loop` |
| **Phase 23 (this phase)** | **33** | **`verify:eval` extended (`EXPECTED=5→8`); chain count UNCHANGED** |

Per RESEARCH §"Verify Gate Wiring" lock: Phase 23 is a gate **extension**, not a new-gate addition. The `verify:all` chain still references the same 32 npm sub-scripts as pre-Phase-23 (operator narrative count = 33 when including the implicit `tsc --noEmit` + `cargo check` companions). The `verify:eval` floor tightened from "≥5 EVAL-06 tables" to "≥8 EVAL-06 tables" — any future regression where one of the 3 OOD modules forgets to call `harness::print_eval_table` is now caught by the gate.

**Load-bearing gate (Phase 23 deliverable):** `bash scripts/verify-eval.sh` exits 0 with stdout containing 8 `┌── ` table headers and the success line `[verify-eval] OK — 8/8 scored tables emitted, all floors green`. Verified at Plan 23-09 close.

---

## Locked-decision compliance recap

| Decision | Description | Compliance |
|----------|-------------|-----------|
| **D-23-01** | Acceptance signal stub returns 1.0; `BladeConfig.reward_weights.acceptance` defaults to 0.0 (silenced via weight, not formula change) | ✅ Plan 23-01 (`44a48ef`) locked default `{0.5, 0.3, 0.0, 0.1}`; Plan 23-02 (`f52e45f`) `acceptance_signal()` stub returns 1.0; `compose()` formula text in REQUIREMENTS.md REWARD-01 preserved verbatim (`0.1·acceptance` retained — re-weight rule documented in CONTEXT). |
| **D-23-02** | Penalties detected via tool-call-trace inspection + per-turn write log, in-process and deterministic; 3 paths: `skill_success ×0.7` / `eval_gate ×0.7` / `completion ×0.0` | ✅ Plan 23-02 (`f52e45f`) `penalty_skill_no_tests` + `touches_eval_module` + `is_noop_call` all wired; commands.rs Site 2 (line 2173) records every tool call into `TurnAccumulator`; no `git diff` dependency; no filesystem watcher. |
| **D-23-03** | OOD eval bootstrap window = first 7 days; gate suppressed-but-logged during warmup (`bootstrap_window: true` audit field on `reward_history.jsonl` rows). Gate activates automatically on next turn after 7 days of history. | ✅ Plan 23-08 (`c20cef8`) `is_in_bootstrap_window(history, now)` returns true when oldest reward record < 7 days; `ood_gate_zero` recorded mirrors COMPUTED gate (audit invariant) but `reward = 0.0` only applied post-bootstrap. ActivityStrip emit `reward:ood_gate_zero` fires post-bootstrap only — pre-bootstrap is LOG-but-not-emit per the dual-layer rule. Tests `bootstrap_window_suppresses_gate` + `is_in_bootstrap_window_returns_true_on_empty` + `is_in_bootstrap_window_returns_false_after_7_days` green. |
| **D-23-04** | New `SignalClass::RewardTrend` 6th variant; severity ladder `drop_pct >0.20→Red, >0.10→Amber, else Green`; `today.is_empty() \|\| prior.is_empty() → Green` with `bootstrap_window: true` (D-16 missing-history convention); REWARD-04's drop_pct severity is SEPARATE from REWARD-06's per-OOD-module >15% gate | ✅ Plan 23-07 (`38459ef`/`8f25bab`) variant placement at end of enum (lowest-volatile last); 3 suggested_fix arms verbatim per D-23-04 lock; `compute_reward_signal()` body honors severity ladder + bootstrap convention; `suggested_fix_strings_match_ui_spec_verbatim` test extended with `(RewardTrend, Red)` drift sentinel. |

All 4 phase-locked decisions implemented verbatim with no scope creep.

---

## Requirements coverage

| REQ-ID | Status | Citation |
|--------|--------|----------|
| REWARD-01 | ✅ shipped | Plan 23-01 (`44a48ef`) + Plan 23-02 (`f52e45f`/`ba1b459`); test `composite_matches_hand_calc` green |
| REWARD-02 | ✅ shipped | Plan 23-02 (`f52e45f` `compute_components` no-cross-contamination contract) |
| REWARD-03 | ✅ shipped | Plan 23-02 (`f52e45f` 3 D-23-02 penalty detectors); `penalty_skill_no_tests` / `penalty_eval_gate_touched` / `penalty_completion_noop` green |
| REWARD-04 | ✅ shipped | Plans 23-01 (`e6771cd`) + 23-02 (`ba1b459`) + 23-07 (`38459ef`/`8f25bab`); 6 doctor reward_signal tests green |
| REWARD-05 | ✅ shipped | Plans 23-03 (`c256771`) + 23-04 (`8fa3d82`) + 23-05 (`8ca8e62`) + 23-06 (`5e105f7`) + 23-09 (`86841ab`); 8 EVAL-06 tables emitted; `verify-eval.sh` exits 0 |
| REWARD-06 | ✅ shipped | Plan 23-08 (`c20cef8`); `ood_gate_zeros_reward_on_15pct_drop` + `bootstrap_window_suppresses_gate` + `ood_baseline_drop_below_15pct_keeps_reward` green |
| REWARD-07 | ✅ shipped | Plan 23-07 (`38459ef`/`8f25bab`) + Plan 23-08 (`563ba95`/`7c02725`); 42/42 doctor::tests green; `npx tsc --noEmit` clean |

7 / 7 REWARD requirements shipped. REQUIREMENTS.md traceability table flipped end-to-end at Plan 23-09 close.

---

## UAT status

**DoctorPane 6th `Reward Trend` row UAT-deferred** per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`, 2026-04-30). Operator-blessed pattern: UI-only-phase UAT deferred when the change is a 1-row-on-a-non-chat-route addition where static render is acceptable. The substrate gate for Phase 23 is:
- `cargo test --lib reward -- --test-threads=1` reports 33 passed (Plans 23-01/02/07/08)
- `cargo test --lib doctor::tests -- --test-threads=1` reports 42 passed (Plan 23-07)
- `cargo test --lib evals -- --test-threads=1` reports 12 passed with 8 EVAL-06 tables (Plan 23-06)
- `bash scripts/verify-eval.sh` exits 0 with `8/8 scored tables emitted` (Plan 23-09)
- `npx tsc --noEmit` exits 0 (Plan 23-08 + 23-09)

No `npm run tauri dev` smoke + screenshot pulled into Phase 23. This carries forward to v1.3 milestone close (Phase 27) as `uat_gaps`, matching the Phase 17 / Phase 22 close pattern. UAT for the DoctorPane row is the operator's call when convenient (visual change is a single row at the bottom of an existing 5-row pattern; rendering follows the locked DoctorRow component).

---

## Carry-forward / known issues

| Item | Source | Disposition |
|------|--------|-------------|
| `router::tests::select_provider_tier2_task_routing` failing | Plan 23-02 audit | Pre-existing carry-forward (reproduced against pre-Phase-23 commits); out of scope per executor scope-boundary rule. Logged here for v1.3 close audit. |
| `deep_scan::scanners::fs_repos::tests::test_walks_maxdepth_six` failing | Plan 23-02 audit | Pre-existing carry-forward; same disposition |
| `deep_scan::scanners::fs_repos::tests::test_ignore_list` failing | Plan 23-02 audit | Pre-existing carry-forward; same disposition |
| `deep_scan::scanners::fs_repos::tests::test_returns_followup_leads` failing | Plan 23-02 audit | Pre-existing carry-forward; same disposition |
| DoctorPane 6th row runtime UAT | Plan 23-08 close | UAT-deferred per chat-first pivot; carries to v1.3 milestone close |
| `record_reward` PIPE_BUF size guard | Plan 23-08 deviation | Logged as deferred-but-considered; record size ~600 B + 3-element penalties + 3-element ood_modules stays well under 4 KB atomicity threshold |
| Pre-existing `reward.rs:231-232 ToolCallTrace.is_error / .timestamp_ms` warning | Plan 23-07 close | Out of scope per executor scope-boundary; would need a Plan 23-02 retrospective edit; logged for awareness |

No new deferred items introduced by Phase 23 beyond the Phase 23 CONTEXT.md `<deferred>` block (regenerate UI / live OOD fixture refresh / LLM-seeded fixture generation / OOD eval expansion / RL training loop / reward decomposition in chat / per-component independence audit). Those flow forward via CONTEXT.md itself.

---

## Patterns established (for v1.4+ phases to inherit)

1. **Locked-signature stub + Wave-3 body extension.** Plan 23-02's `compute_and_persist_turn_reward(&app, acc)` signature was locked at Wave 2 with an OOD-gate stub body. Plan 23-08 replaced the stub body without re-touching the commands.rs hook — proving the discipline of locking the public surface early so dependent waves can extend internals without surface churn.
2. **Test-mode emit capture via `#[cfg(test)] OnceLock<Mutex<Vec<String>>>`.** Both Plan 23-07 and Plan 23-08 used this pattern to assert ActivityStrip emit row presence without enabling the `tauri::test` feature flag. Avoids architectural Cargo.toml change for unit-test ergonomics.
3. **Direct-aggregator `#[tokio::test]` substitute for `tauri::test::mock_app()`.** Plan 23-07 + 23-08 demonstrated the substitution pattern when `tauri::test` feature is not enabled. Same property tested (6-signal aggregator returns 6 items) without feature-flag pull.
4. **Bootstrap-window suppression: COMPUTE+LOG without applying side effect during warmup.** Plan 23-08's REWARD-06 gate is computed unconditionally and recorded in the audit field, but reward is only zeroed and ActivityStrip-emit fires post-bootstrap. Pre-bootstrap is LOG-but-not-emit. This dual-layer pattern keeps the audit trail honest while preventing false-positive user-visible gates during warmup.
5. **TS lockstep contract: `payloads.ts` (wire) + `admin.ts` (consumer type) MUST land together; `Record<SignalClass, ...>` in DoctorPane.tsx is the structural gate.** Plan 23-08 confirmed the structural enforcement gate works as designed — pre-Task-3 tsc snapshot showed exactly 2 missing-property errors at `DoctorPane.tsx:40` (DISPLAY_NAME) and `:124` (rowRefs); Task 3 closed both atomically.
6. **Canonical OOD eval module shape.** Plan 23-03 established and Plans 23-04 / 23-05 verbatim-mirrored the OOD module shape (module docstring + assumption block + MODULE_NAME/MODULE_FLOOR consts + outcome enum + Fixture struct + fixtures() corpus + classify_*() pattern matcher + single `#[test]` calling `print_eval_table → summarize → record_eval_run → assert!` in that order). Three concrete instances now lock the shape; v1.4+ OOD evals should mirror.
7. **Deliberate-fail buffer fixtures.** All 3 OOD modules embed 2 deliberate-fail fixtures whose expected outcome IS the dangerous default (Failed / SilentMisroute / Hallucinated). These document classifier limitations and provide regression headroom for the MODULE_FLOOR gate without lying about what the matcher actually catches. Pattern set linear-time, no regex, no ReDoS surface.

---

## Next phase pointer

**Phase 24 — dream_mode skill consolidation (DREAM-01..06).** The continual-forgetting half of the Voyager loop. Skills not used → archived; redundant skills consolidated; new skills generated from successful traces. Substrate dependencies all satisfied:
- Phase 21 (Skills v2 SKILL.md format) ships the on-disk surface dream_mode prunes/consolidates
- Phase 22 (Voyager loop) ships `forge_tool` + `tool_forge` + `voyager_log` ActivityStrip emit channel
- Phase 23 (this phase) ships the reward signal that downstream dream_mode passes can read for "skill quality" weighting (optional v1.4+ extension; not load-bearing for v1.3 DREAM scope)

Phase 24 CONTEXT gather is the next session's work. No blockers. STATE.md flipped to "Phase 24 (dream_mode skill consolidation) — pending context".

---

*Phase: 23-verifiable-reward-ood-eval*
*Closed: 2026-05-01*
*Plans: 9 / 9 shipped*
*Requirements: REWARD-01..07 / 7 of 7 shipped*
*Verify chain: 33 (unchanged; verify:eval extended `EXPECTED=5→8`)*
