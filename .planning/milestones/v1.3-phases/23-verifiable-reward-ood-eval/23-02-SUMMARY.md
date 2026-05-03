---
phase: 23
plan: 02
subsystem: reward-substrate
tags: [reward, penalty, turn-accumulator, commands.rs, hook-point, substrate, wave-2]
requires:
  - .planning/phases/23-verifiable-reward-ood-eval/23-CONTEXT.md
  - .planning/phases/23-verifiable-reward-ood-eval/23-RESEARCH.md
  - .planning/phases/23-verifiable-reward-ood-eval/23-PATTERNS.md
  - .planning/phases/23-verifiable-reward-ood-eval/23-01-SUMMARY.md
provides:
  - "src-tauri/src/reward.rs::TurnAccumulator"
  - "src-tauri/src/reward.rs::ToolCallTrace"
  - "src-tauri/src/reward.rs::extract_target_path"
  - "src-tauri/src/reward.rs::touches_eval_module"
  - "src-tauri/src/reward.rs::is_noop_call"
  - "src-tauri/src/reward.rs::penalty_skill_no_tests"
  - "src-tauri/src/reward.rs::compute_components"
  - "src-tauri/src/reward.rs::compute_and_persist_turn_reward (locked signature; OOD gate stub)"
  - "src-tauri/src/reward.rs::emit_penalty_applied (M-07 emit, internal)"
  - "src-tauri/src/commands.rs::send_message_stream_inline hook (3 sites)"
affects:
  - "Plan 23-03..09 — Wave 3 (OOD modules + Doctor extension + verify-eval bump)"
  - "Plan 23-08 — extends compute_and_persist_turn_reward body with REWARD-06 OOD gate (signature locked here, will not change)"
tech-stack:
  added: []
  patterns:
    - "TurnAccumulator wraps tool_calls / skills_used / forge_ok / final_content in Arc<Mutex<_>> (Pitfall 4 future-proofing)"
    - "Locked-signature stub: compute_and_persist_turn_reward(&app, acc) keeps app param even though Wave 2 body fetches AppHandle via integration_bridge::get_app_handle() — Plan 23-08 will not need to re-touch the commands.rs hook"
    - "Inner-body split (compute_and_persist_turn_reward → compute_and_persist_turn_reward_inner) gives hermetic test seam without enabling tauri::test feature"
    - "REWARD-02 no-cross-contamination: each component computed from one independent input; penalties multiply a single component"
    - "Scope-bounded penalty detection: tool-call trace only — no git diff, no filesystem-watcher, no live db reads"
key-files:
  created: []
  modified:
    - "src-tauri/src/reward.rs (+517 LOC: TurnAccumulator + ToolCallTrace + 3 penalty detectors + compute_components + orchestrator + 9 new tests)"
    - "src-tauri/src/commands.rs (+25 LOC across 3 sites: line 715 accumulator construction, line 2173 record_tool_call, line 1831 reward compute call)"
key-decisions:
  - "OOD-floor gate is a no-op stub in Plan 23-02 — bootstrap_window=false and ood_gate_zero=false persisted unconditionally; Plan 23-08 lands the real body without touching the commands.rs hook (locked signature)"
  - "Activity emit uses the voyager_log shape (integration_bridge::get_app_handle → app.emit_to('main', 'blade_activity_log', ...)) — fail-soft when no AppHandle is registered (test context)"
  - "compute_and_persist_turn_reward split into public locked-signature wrapper + private inner body; tests exercise inner body without needing tauri::test"
  - "A2/A6 deviation: synthetic-stub branch at commands.rs:2173+ does NOT lexically exit through the same return Ok(()) at 1821 — it falls through to the summary stream call at line 2229. Reward is therefore computed only on the no-more-tool-calls happy-path branch, NOT on the loop-exhausted-with-stubs branch. Documented under Deviations (Rule 1 — research assumption corrected)"
  - "Soft-clamp on bad weights per A1: load_config().reward_weights.validate() failure → log::warn + RewardWeights::default() fallback (does NOT break the chat loop)"
  - "Test 13 (activity_emit_on_penalty) asserts the penalty-name list returned by compute_components — equivalent to asserting the emit row's penalty-name field; emit helper itself fail-softs on missing AppHandle (mirrors voyager_log::tests posture)"

requirements-completed: [REWARD-02, REWARD-03]

# Metrics
duration: 50m
completed: 2026-05-01
---

# Phase 23 Plan 02: Composite Reward Penalty Layer + commands.rs Hook Summary

**Lands the per-turn TurnAccumulator + 3 D-23-02 penalty paths (skill_success ×0.7 / eval_gate ×0.7 / completion ×0.0) + the singular happy-path commands.rs hook to compute_and_persist_turn_reward — every successful chat turn now generates a 9-field RewardRecord row in tests/evals/reward_history.jsonl.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-01T12:34Z (rough)
- **Completed:** 2026-05-01T13:25Z
- **Tasks:** 2
- **Files modified:** 2 (reward.rs, commands.rs)

## Accomplishments

- TurnAccumulator + ToolCallTrace land with `Arc<Mutex<_>>` future-proofing (Pitfall 4); thread-safety locked by Test 15 (4×50 concurrent record_tool_call → 200 entries, no panics).
- All 3 D-23-02 penalty detectors implemented and unit-tested: skill-no-tests heuristic with `dirs::home_dir()` resolution + `_test.` filename detection; eval-module glob (`src-tauri/src/evals/**/*.rs` OR `tests/evals/**/*.rs`); no-op classifier (`noop`/`wait` builtins, bash echo/sleep/`true`/`:` patterns, empty-result fallthrough).
- `compute_components` returns `(raw, post_penalty, penalty_labels)` in the locked REWARD-02 order — each raw component reads ONE independent input; penalties multiply a single named component; labels persisted in `RewardRecord.penalties_applied`.
- `compute_and_persist_turn_reward(&app, acc)` orchestrator lands with the locked signature; soft-warn-and-clamp on bad weights per A1; OOD gate is a deliberate no-op stub (Plan 23-08 lands the real body without re-touching commands.rs).
- ActivityStrip emit (`reward:penalty_applied`, M-07) wired via the voyager_log shape; fail-soft when no AppHandle is registered (mirrors `voyager_log::tests::emit_helpers_safe_without_app_handle` posture).
- commands.rs hooked at exactly 3 sites — accumulator construction at function entry, record_tool_call inside the dispatch loop, compute_and_persist at the singular happy-path return Ok(()). All grep acceptance criteria pass.

## Task Commits

1. **Task 1: Extend reward.rs with TurnAccumulator + penalty detectors + compute_and_persist_turn_reward** — `f52e45f` (feat)
2. **Task 2: Wire commands.rs send_message_stream_inline to TurnAccumulator + reward compute call** — `ba1b459` (feat)

## Files Created/Modified

- `src-tauri/src/reward.rs` (+517 LOC, total ~917 LOC) — Wave-2 surface layered on Wave-1 substrate. New types: `ToolCallTrace`, `TurnAccumulator`. New functions: `extract_target_path`, `touches_eval_module`, `is_noop_call`, `penalty_skill_no_tests`, `compute_components`, `compute_and_persist_turn_reward` (public locked wrapper) + `compute_and_persist_turn_reward_inner` (private testable body), `emit_penalty_applied`, `acceptance_signal` (D-23-01 stub), `read_eval_history_for_gate` (private). 9 new unit tests (15 total: 6 Wave-1 + 9 Wave-2; +5 config tests in reward.rs sibling = 20 in `cargo test --lib reward`).
- `src-tauri/src/commands.rs` (+25 LOC, 3 surgical insertions):
  - Site 1 — line 715 (post `_inflight` guard): `let turn_acc = crate::reward::TurnAccumulator::new();`
  - Site 2 — line 2173 (immediately before the canonical line-2156-equivalent push site, post-edit drift): `turn_acc.record_tool_call(crate::reward::ToolCallTrace { ... })`
  - Site 3 — line 1831 (immediately before `return Ok(())` at the no-more-tool-calls happy-path branch): `let _ = crate::reward::compute_and_persist_turn_reward(&app, turn_acc).await;`

**Post-edit line numbers** (pre-edit anchors drifted as expected):

| Site | Pre-edit anchor (RESEARCH) | Post-edit line |
|------|----------------------------|----------------|
| 1 — TurnAccumulator::new | "after _inflight guard at ~710" | 715 |
| 2 — record_tool_call | "before 2156 push site" | 2173 (push moved to 2180) |
| 3 — compute_and_persist | "before 1821 return Ok(())" | 1831 (return moved to 1837) |

## Decisions Made

See `key-decisions:` in frontmatter. Top three:

1. **OOD-floor gate is a no-op stub** in Plan 23-02 — `bootstrap_window: false` and `ood_gate_zero: false` are persisted unconditionally. Plan 23-08 lands the real REWARD-06 body. The locked signature `compute_and_persist_turn_reward(&app, acc)` is preserved so Plan 23-08 will not need to re-touch commands.rs.
2. **Inner-body split** — `compute_and_persist_turn_reward_inner(acc) -> RewardRecord` is a private fn the public locked wrapper delegates to. Tests exercise inner without needing `tauri::test::mock_builder()` (which requires enabling the `test` feature on the `tauri` crate; out-of-scope for Plan 02). The locked signature is preserved at the public surface.
3. **A2/A6 lexical-exit confirmed FALSE** — the synthetic-stub branch at commands.rs:2173+ does NOT terminate at the same `return Ok(())` as line 1821; it falls through to the final summary stream call and returns `summary_result` at commands.rs:2229. The plan and RESEARCH had assumed (with `[ASSUMED]` markers) that this path returned through 1821 lexically. It does not. The simpler hook posture (single 1821 site only) is preserved per plan instruction; the loop-exhausted-with-synthetic-stubs branch therefore does NOT emit a reward record — biased toward fewer false-positive RewardRecord rows on degenerate turns. Plan 23-08 can revisit if it needs the broader coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] A2/A6 lexical-exit assumption corrected**

- **Found during:** Task 2 (read of commands.rs:2173+ before patching Site 3)
- **Issue:** Plan 02's `<action>` (Site 3 paragraph) and 23-RESEARCH.md §"Hook Point §Failure Path Behavior" both assert that the synthetic-stub branch at commands.rs:2173+ "exits via the SAME `return Ok(())` at 1821" and instruct verifying lexically. Live read of lines 2160-2230 shows the branch falls through past the synthetic-stub injection block, then either returns `Ok(())` at line 2213 (CHAT_CANCEL path — out of scope per plan), or makes a final `providers::stream_text` summary call and returns `summary_result` at line 2229. Neither path exits through line 1821.
- **Fix:** Followed the plan's explicit fallback ("scope the reward call at the singular `return Ok(())` at 1821") — Site 3 hook lands ONLY at line 1831 (the no-more-tool-calls happy-path branch). The loop-exhausted-with-stubs branch does not generate a reward record this plan; this matches the more conservative hook posture (no false positives on degenerate "couldn't finish" turns). Plan 23-08 can revisit if it needs broader coverage.
- **Files modified:** none beyond the planned Site 3 patch.
- **Verification:** `grep -c "return Ok(())" src-tauri/src/commands.rs` returns 7 (unchanged from pre-edit). `grep -c "compute_and_persist_turn_reward" src-tauri/src/commands.rs` returns exactly 1.
- **Committed in:** `ba1b459` (Task 2).
- **Documented in:** `decisions:` frontmatter line 3, this Deviations section, and a per-paragraph note in the Task 2 commit message body.

**2. [Rule 3 — Blocking] tauri::test::mock_builder is unavailable**

- **Found during:** Task 1 test authoring (Test 7 / `happy_path_persists_record`)
- **Issue:** Plan 02's `<action>` block (item 12) calls for `tauri::test::mock_builder().build()` to construct a fake AppHandle for Test 7. The `tauri::test` module is only available when the `test` feature is enabled on the `tauri` crate; `src-tauri/Cargo.toml:16` reads `tauri = { version = "2", features = ["tray-icon", "image-png", "macos-private-api"] }` (no `test` feature, no `test-helpers`). Adding the feature is non-trivial (CLAUDE.md "Don't add new external crates" applies in spirit; pulling tauri's test feature could pull in additional test-time deps).
- **Fix:** Split `compute_and_persist_turn_reward(&app, acc)` into the public locked-signature wrapper + a private `compute_and_persist_turn_reward_inner(acc) -> RewardRecord` body that does all the real work without an AppHandle parameter. Tests exercise the inner function directly. The locked signature on the public wrapper is preserved (commands.rs hook unchanged from spec).
- **Files modified:** `src-tauri/src/reward.rs` (split into wrapper + inner; ~5 LOC structural change inside the orchestrator paragraph).
- **Verification:** Tests 13 (`activity_emit_on_penalty`) and 14 (`happy_path_persists_record`) call `compute_and_persist_turn_reward_inner` and pass; `grep -q "pub async fn compute_and_persist_turn_reward"` still returns 0 (locked-signature acceptance criterion holds).
- **Committed in:** `f52e45f` (Task 1).

**3. [Rule 1 — Bug] grep -c overcount on Site 1 comment**

- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** First-pass Site 1 comment included the literal phrase "compute_and_persist_turn_reward" inside the explanatory comment. The acceptance criterion `grep -c "compute_and_persist_turn_reward" src-tauri/src/commands.rs` then returned 2 instead of 1.
- **Fix:** Reworded the Site 1 comment to refer to "the reward orchestrator" instead of the literal symbol name. Comment intent is preserved; the criterion now passes.
- **Files modified:** `src-tauri/src/commands.rs` (1-line comment edit).
- **Verification:** `grep -c "compute_and_persist_turn_reward" src-tauri/src/commands.rs` returns exactly 1.
- **Committed in:** `ba1b459` (Task 2).

**4. [Rule 1 — Bug] grep -B1 marker miss on Site 3**

- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** Acceptance criterion `grep -B1 "compute_and_persist_turn_reward" .. | grep -q "REWARD-04"` requires the line IMMEDIATELY before the call to contain "REWARD-04". First-pass Site 3 had a 4-line comment block; only the last comment line was captured by `-B1` and that line did not contain "REWARD-04".
- **Fix:** Restructured the Site 3 comment so a `// Phase 23 / REWARD-04` marker line sits directly above the `let _ = crate::reward::compute_and_persist_turn_reward(...)` call.
- **Files modified:** `src-tauri/src/commands.rs` (1-line comment shuffle).
- **Verification:** `grep -B1 "compute_and_persist_turn_reward" src-tauri/src/commands.rs | grep -q "REWARD-04"` exits 0.
- **Committed in:** `ba1b459` (Task 2).

---

**Total deviations:** 4 auto-fixed (1 Rule-1 research-correction, 1 Rule-3 blocking-feature, 2 Rule-1 grep-fit nits)
**Impact on plan:** All 4 are corrections within the Wave 2 surface — no scope creep into Wave 3 plans, no new crate deps, no signature changes at the public-API boundary, all locked acceptance criteria pass.

## Issues Encountered

- **Pre-existing test failures in unrelated modules.** Full-suite `cargo test --lib -- --test-threads=1` reported 4 failing tests:
  - `deep_scan::scanners::fs_repos::tests::test_walks_maxdepth_six`
  - `deep_scan::scanners::fs_repos::tests::test_ignore_list`
  - `deep_scan::scanners::fs_repos::tests::test_returns_followup_leads`
  - `router::tests::select_provider_tier2_task_routing`

  Verified pre-existing by re-running `router::tests::select_provider_tier2_task_routing` against commit `27d997b` (Wave-1-only state, no Phase 23 Plan 02 changes) — same failure reproduced. Out of scope per the executor's SCOPE BOUNDARY rule (these are not caused by reward.rs / commands.rs Site-2 changes; the failures are in `router.rs` and `deep_scan/scanners/fs_repos.rs`, neither of which Plan 02 touched). Logged here for the next executor / phase-close audit.

- **Working-tree restoration scare.** During failure-attribution diagnosis, `git checkout HEAD~1 -- src-tauri/src/reward.rs` was run to compare states; this momentarily reverted the Task-1 work in the index. Recovered cleanly via `git restore --staged + git checkout HEAD -- src-tauri/src/reward.rs` (Task-1 commit `f52e45f` was already in the log; the restore was filesystem-only). No commits lost; Task-2 work was protected via stash through the diagnosis. Verified post-recovery via `grep -c "pub struct TurnAccumulator" src-tauri/src/reward.rs` returns 1 + reward tests still 20-pass.

## Verification (all green at land time)

| Check | Result |
|-------|--------|
| `cargo test --lib reward -- --test-threads=1` | **20 passed; 0 failed** (5 config + 15 reward [6 Wave-1 + 9 Wave-2]) |
| `cargo check` | clean — 0 errors; 2 warnings (`read_reward_history`, `is_error`/`timestamp_ms` fields — all consumed by Plan 23-08 OOD gate) |
| `grep -c "TurnAccumulator::new" src-tauri/src/commands.rs` | 1 ✓ |
| `grep -c "turn_acc.record_tool_call" src-tauri/src/commands.rs` | 1 ✓ |
| `grep -c "compute_and_persist_turn_reward" src-tauri/src/commands.rs` | 1 ✓ |
| `grep -B1 "compute_and_persist_turn_reward" .. | grep -q "REWARD-04"` | PASS ✓ |
| `grep -q "pub struct TurnAccumulator" src-tauri/src/reward.rs` | OK |
| `grep -q "pub struct ToolCallTrace" src-tauri/src/reward.rs` | OK |
| `grep -q "pub fn touches_eval_module" src-tauri/src/reward.rs` | OK |
| `grep -q "pub fn is_noop_call" src-tauri/src/reward.rs` | OK |
| `grep -q "pub fn penalty_skill_no_tests" src-tauri/src/reward.rs` | OK |
| `grep -q "pub async fn compute_and_persist_turn_reward" src-tauri/src/reward.rs` | OK |
| `grep -q "pub fn compute_components" src-tauri/src/reward.rs` | OK |
| `grep -q "Arc<Mutex" src-tauri/src/reward.rs` | OK (5 hits) |
| `! grep -q "git diff" src-tauri/src/reward.rs` | OK (no git-diff dependency) |
| `grep -c "return Ok(())" src-tauri/src/commands.rs` (lexical exit, before+after) | 7 → 7 (no new returns added) |

## Threat Surface

The plan's `<threat_model>` block enumerates 6 threats (T-23-02-01..06). Disposition in this plan:

- **T-23-02-01** (Tampering — `extract_target_path` parsing LLM-supplied JSON args): **mitigated.** `serde_json::from_str::<Value>` is total; invalid JSON returns `None`. Malicious paths (e.g., traversal) are returned literally; the eval-module glob then fails its `contains("src-tauri/src/evals/")` guard. Tests 8 (`penalty_eval_gate_touched`) covers the positive path; the safe-path counter-case in the same test (writing `src-tauri/src/commands.rs` does NOT trip) covers the negative.
- **T-23-02-02** (Information Disclosure — `result_content` of `ToolCallTrace`): **mitigated.** Site 2 of commands.rs truncates via `crate::safe_slice(&content, 500)` (CLAUDE.md non-ASCII rule honored). Persisted `RewardRecord.penalties_applied` is label strings only (no trace bodies). Schema is locked numeric components + label strings.
- **T-23-02-03** (DoS — `penalty_skill_no_tests` filesystem read on `~/.blade/skills/<name>`): **mitigated.** `read_dir` failures `unwrap_or(false)` — symlink loops or huge dirs return `false` (no penalty); worst-case misclassification favors the user.
- **T-23-02-04** (Tampering — `is_noop_call` keyword bypass via creative bash): **accepted** per plan threat model. Documented as v1.4 calibration candidate.
- **T-23-02-05** (Spoofing — `forge_tool` arg `name` hijack to alternate skill dir): **mitigated.** `penalty_skill_no_tests` reads the named skill dir but performs only test-file existence checks; no execution, no path-traversal effect.
- **T-23-02-06** (Repudiation — `penalties_applied` audit field): **mitigated.** `penalties_applied` is durably persisted in `reward_history.jsonl` per turn. `raw_components` from Plan 23-01 retains pre-penalty values for trace reconstruction.

## Authentication Gates

None encountered — Wave 2 is pure Rust + filesystem; no network, no API keys, no provider calls.

## TDD Gate Compliance

The plan marks Task 1 as `tdd="true"` (Task 2 is `auto`, no test mark). Per Wave-1 precedent (and Phase 22 plans 22-03/22-04/22-06 which set the workspace convention), the per-task plan structure groups RED + GREEN inside a single `<task>`, and the unified `feat(...)` Task 1 commit `f52e45f` includes both the 9 new tests AND the implementation. The TDD discipline was honored at the **behavior-spec** level — every test named in the plan's `<behavior>` block is present and green. Task 2 has no new tests by design (`<behavior>` says "No new tests in this task — runtime evidence will be exercised by Plan 23-08 + 23-09"); cargo check + the 20-test reward+config suite cover the regression surface.

## Self-Check: PASSED

Verification (Read tool used to confirm files exist; git log used to confirm commits):

- `src-tauri/src/reward.rs` — FOUND (modified, 9 new fns + 9 new tests at lines ~200-680 + ~700-920)
- `src-tauri/src/commands.rs` — FOUND (modified, 3 sites at 715 / 1831 / 2173)
- Commit `f52e45f` (Task 1) — FOUND in `git log --oneline -5`
- Commit `ba1b459` (Task 2) — FOUND in `git log --oneline -5`
- `.planning/phases/23-verifiable-reward-ood-eval/23-02-SUMMARY.md` — being created by this Write call
- All grep acceptance criteria (8 from Task 1 + 5 from Task 2) — pass
- All 20 reward+config tests pass

---

*Phase: 23-verifiable-reward-ood-eval*
*Plan: 02 (Wave 2 — penalty + commands hook)*
*Completed: 2026-05-01*
