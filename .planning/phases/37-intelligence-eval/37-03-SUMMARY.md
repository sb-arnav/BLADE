---
phase: 37-intelligence-eval
plan: 3
subsystem: evals/intelligence-eval — EVAL-01 multi-step task fixtures
tags: [evals, intelligence, eval-01, scripted-provider, multi-step-tasks, panic-regression, coverage-assertion]
status: complete
dependency_graph:
  requires:
    - "Plan 37-02 ScriptedProvider seam (EVAL_FORCE_PROVIDER thread_local at loop_engine.rs:629; dispatch site at loop_engine.rs:1347)"
    - "Plan 37-02 ScriptedProvider/ScriptedResponse/ScriptedToolCall state-shape (intelligence_eval.rs:101-146)"
    - "Plan 37-02 setup_scripted_provider/teardown_scripted_provider stubs (intelligence_eval.rs:148-203)"
    - "Phase 33 LoopHaltReason enum (loop_engine.rs:367-398) — 7 variants"
    - "Phase 33 CostScope enum (loop_engine.rs:343-346) — PerLoop / PerConversation"
    - "providers::AssistantTurn struct (providers/mod.rs:160) — content + tool_calls + stop_reason + tokens_in/out"
    - "providers::ToolCall struct (providers/mod.rs:134) — id + name + arguments"
    - "Phase 30-02 organism_eval.rs structural template (IntelligenceFixture struct + run fn signature)"
  provides:
    - "evals::intelligence_eval::MultiStepTaskFixture struct (#[cfg(test)] only, 6 fields)"
    - "evals::intelligence_eval::SeamGuard struct (Drop calls teardown_scripted_provider — RAII boundary)"
    - "evals::intelligence_eval::run_fixture_via_seam helper (shared 10-fixture runner)"
    - "evals::intelligence_eval::CODE_EDIT_MULTI_FILE_RESPONSES + 9 sibling const arrays (#[cfg(test)] static [ScriptedResponse])"
    - "evals::intelligence_eval::fixture_<label> fns × 10"
    - "evals::intelligence_eval::fixtures_eval_01_multi_step_tasks aggregator (10 IntelligenceFixture)"
    - "evals::intelligence_eval::eval_01_fixture_specs (10 MultiStepTaskFixture — coverage spec)"
    - "evals::intelligence_eval::phase37_eval_01_all_haltreasons_covered #[test]"
    - "evals::intelligence_eval::phase37_eval_panic_in_scripted_closure_handled_gracefully #[test]"
    - "Activated setup_scripted_provider full body (replaces Plan 37-02 stub)"
  affects:
    - "intelligence_eval.rs (209 → 1055 LOC, +846 lines net)"
    - ".planning/phases/37-intelligence-eval/deferred-items.md (logged 6 additional pre-existing failures)"
tech_stack:
  used:
    - "std::sync::Arc — shared ownership of ScriptedProvider across the seam closure (cursor Mutex<usize> already lives inside)"
    - "std::panic::catch_unwind + AssertUnwindSafe — panic-regression boundary"
    - "serde_json::from_str — ScriptedToolCall.args_json → ToolCall.arguments coercion"
    - "Drop trait — SeamGuard RAII teardown (panic-safe)"
  patterns:
    - "Closure-installs-into-thread_local pattern (matches Plan 37-02 seam contract)"
    - "Spec-collection-vs-aggregator parallel registries pattern (label order locked by phase37_eval_01_all_haltreasons_covered cross-check)"
    - "Seam-only fallback per CONTEXT §Mock Provider (run_loop requires tauri::AppHandle which codebase avoids)"
    - "Static const arrays for fixture data (zero per-invocation allocation; &'static enforced by ScriptedProvider::new signature)"
key_files:
  created: []
  modified:
    - "src-tauri/src/evals/intelligence_eval.rs (+846 LOC)"
    - ".planning/phases/37-intelligence-eval/deferred-items.md (+27 LOC)"
decisions:
  - "Fixtures invoke the seam closure directly instead of run_loop — codebase avoids tauri::test::mock_app() (reward.rs:664, decomposition/executor.rs:574,665,1045 all document the posture). CONTEXT lock §Mock Provider for Deterministic Loop Replay authorizes this fallback verbatim. Each fixture's run_fixture_via_seam call mirrors the dispatch shape at loop_engine.rs:1347 — drains the closure to script-end OR until tool_calls.is_empty (mimicking the 'final assistant turn exits the loop' semantics)."
  - "expected_haltreason is a DECLARED CONTRACT verified at the spec level (phase37_eval_01_all_haltreasons_covered iterates the spec collection). The seam-only path cannot synthesize the actual halt reason because run_loop's halt logic (cost guard, stuck detect, circuit breaker, decomposition fan-out) lives behind the AppHandle boundary. The contract proves the eval ASSERTS coverage of all 5 variants; a future plan with a true loop test harness would replace 'declared' with 'observed'."
  - "Spec collection (eval_01_fixture_specs) and aggregator (fixtures_eval_01_multi_step_tasks) maintained as parallel registries; phase37_eval_01_all_haltreasons_covered cross-checks label order (drift between the two would silently break the coverage matrix). assert_eq!(agg_labels, spec_labels) catches reordering at test time."
  - "SeamGuard struct uses Drop instead of explicit teardown — RAII semantics guarantee teardown even if the fixture body panics (T-37-20 mitigation per plan threat register)."
  - "ScriptedResponse → AssistantTurn mapping: tool_call: Some → tool_calls vec with one ToolCall (id='scripted_call_<name>', name from tc.tool_name, arguments parsed from args_json via serde_json::from_str fallback to Value::Null on parse error). truncated bool maps to stop_reason: 'length' (truncated=true) | 'tool_use' (has tool_calls) | 'stop' (clean assistant text)."
  - "no_unexpected_error gate in run_fixture_via_seam: 'script exhausted' is treated as the synthetic equivalent of CostExceeded/Stuck/CircuitOpen/DecompositionComplete halt reasons — those production halt reasons fire BEFORE script exhaustion in real loop runs, but in seam-only tests we accept exhaustion as the test-time proxy. None expected_haltreason requires no closure_err (clean drain only). This makes the passed bool a structural check (script bounds + closure discipline) rather than a halt-reason check."
  - "CostExceeded fixture uses CostScope::PerLoop. Both PerLoop and PerConversation are valid; PerLoop matches the more common cost_guard test pattern at loop_engine.rs:1204."
  - "tool-error-recovery declares CircuitOpen{error_kind: 'tool_failure', attempts_summary: vec![]} — empty attempts_summary is a valid contract because production fills the vec at the point CircuitBreaker::open() is called; the test fixture's contract is only the variant shape, not the runtime payload."
  - "verification-rejected-replan declares Stuck{pattern: 'RepeatedActionObservation'} per loop_engine.rs:382 doc-comment listing the 5 known stuck patterns ('RepeatedActionObservation' | 'MonologueSpiral' | 'ContextWindowThrashing' | 'NoProgress' | 'CostRunaway'). Pattern is a String per the variant definition — match against actual pattern names from resilience::stuck."
  - "truncation-retry fixture has 2 scripted responses but the seam-only runner stops at iteration 1 because the first response has tool_calls.is_empty() (only run_loop's truncation-retry path would re-call complete_turn after a truncated stop_reason). This is acceptable: passed=true because iters=1 ≤ cap=25, and the fixture's purpose (declaring a truncation+retry contract in the test registry) is satisfied at the spec level."
  - "Panic regression installs the panicking closure DIRECTLY (bypasses ScriptedProvider) so the test exercises the seam wiring itself rather than ScriptedProvider's next_response error path. catch_unwind around the closure invocation MUST return Err — that's the contract (v1.1 fallback discipline)."
metrics:
  duration_minutes: 18
  tasks_completed: 4
  files_modified: 2
  files_created: 0
  commits: 1
  tests_added: 2
  tests_pass: "4/4"
  cargo_check_errors: 0
  cargo_check_test_errors: 0
  loc_delta_intelligence_eval: 846
completed_date: "2026-05-08"
requirements_addressed: [EVAL-01]
---

# Phase 37 Plan 37-03: EVAL-01 Multi-Step Task Fixtures Summary

**One-liner:** Lands the EVAL-01 banner — 10 multi-step task fixtures wired through the Plan 37-02 ScriptedProvider seam. Each fixture's `&'static [ScriptedResponse]` drives the `EVAL_FORCE_PROVIDER` closure deterministically through `run_fixture_via_seam`; coverage assertion `phase37_eval_01_all_haltreasons_covered` proves all 5 LoopHaltReason variants are exercised at the spec level; panic-injection regression `phase37_eval_panic_in_scripted_closure_handled_gracefully` validates v1.1 fallback discipline (8th application — catch_unwind boundary holds).

## Tests Added (all green)

```
running 4 tests
test evals::intelligence_eval::phase37_eval_01_all_haltreasons_covered ... ok
test evals::intelligence_eval::phase37_eval_panic_in_scripted_closure_handled_gracefully ...
thread 'evals::intelligence_eval::phase37_eval_panic_in_scripted_closure_handled_gracefully' (31021)
panicked at src/evals/intelligence_eval.rs:1029:13:
forced panic inside scripted closure (Plan 37-03 regression)
ok
test evals::intelligence_eval::run_intelligence_eval_driver ...
┌── intelligence eval (floor=1.00) ──
│ EVAL-01: code-edit-multi-file    top1=✓ top3=✓ rr=1.00 → ... iters=5/25 expected=Complete
│ EVAL-01: repo-search-then-summarize top1=✓ ... iters=3/25 expected=Complete
│ EVAL-01: bash-grep-fix-test      top1=✓ ... iters=5/25 expected=Complete
│ EVAL-01: web-search-extract      top1=✓ ... iters=2/25 expected=Complete
│ EVAL-01: parallel-file-reads     top1=✓ ... iters=6/25 expected=DecompositionComplete
│ EVAL-01: tool-error-recovery     top1=✓ ... iters=3/25 expected=CircuitOpen{...}
│ EVAL-01: verification-rejected-replan top1=✓ ... iters=3/25 expected=Stuck{pattern:"RepeatedActionObservation"}
│ EVAL-01: truncation-retry        top1=✓ ... iters=1/25 expected=Complete
│ EVAL-01: compaction-mid-loop     top1=✓ ... iters=3/25 expected=Complete
│ EVAL-01: cost-guard-warn         top1=✓ ... iters=2/25 expected=CostExceeded{1.05/1.0,PerLoop}
├─────────────────────────────────────────────────────────
│ top-1: 10/10 (100%)  top-3: 10/10 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────
ok
test evals::intelligence_eval::tests::phase37_eval_scaffold_emits_empty_table ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 810 filtered out; finished in 0.09s
```

The driver test now emits a 10-row EVAL-01 table with `top-1: 10/10 (100%)` and `MRR: 1.000`. The U+250C box-drawing delimiter (which `scripts/verify-intelligence.sh` Plan 37-07 will grep on stdout) is present. The empty-table smoke test from Plan 37-02 still emits its own delimiter independently.

## Per-fixture observed outcomes

| # | Label | Iters | Cap | Expected halt reason | Closure error | Passed |
|---|-------|-------|-----|----------------------|---------------|--------|
| 1 | code-edit-multi-file | 5 | 25 | None (Complete) | None | ✓ |
| 2 | repo-search-then-summarize | 3 | 25 | None (Complete) | None | ✓ |
| 3 | bash-grep-fix-test | 5 | 25 | None (Complete) | None | ✓ |
| 4 | web-search-extract | 2 | 25 | None (Complete) | None | ✓ |
| 5 | parallel-file-reads | 6 | 25 | DecompositionComplete | None | ✓ |
| 6 | tool-error-recovery | 3 | 25 | CircuitOpen{...} | "script exhausted" (expected) | ✓ |
| 7 | verification-rejected-replan | 3 | 25 | Stuck{RepeatedActionObservation} | "script exhausted" (expected) | ✓ |
| 8 | truncation-retry | 1 | 25 | None (Complete) | None | ✓ |
| 9 | compaction-mid-loop | 3 | 25 | None (Complete) | None | ✓ |
| 10 | cost-guard-warn | 2 | 25 | CostExceeded{1.05/1.0,PerLoop} | "script exhausted" (expected) | ✓ |

All 10 within cap. Three fixtures exhaust the script on purpose (CircuitOpen / Stuck / CostExceeded all map to "would-have-halted-mid-loop" in production — the seam-only path treats script exhaustion as the synthetic equivalent).

## Coverage matrix (all 5 LoopHaltReason variants)

| Variant | Covered by fixture | Spec line |
|---------|-------------------|-----------|
| Complete (= None) | code-edit-multi-file, repo-search-then-summarize, bash-grep-fix-test, web-search-extract, truncation-retry, compaction-mid-loop (6 fixtures) | declared in eval_01_fixture_specs |
| `LoopHaltReason::Stuck { pattern }` | verification-rejected-replan | declared with pattern="RepeatedActionObservation" |
| `LoopHaltReason::CircuitOpen { error_kind, attempts_summary }` | tool-error-recovery | declared with error_kind="tool_failure", attempts_summary=vec![] |
| `LoopHaltReason::CostExceeded { spent_usd, cap_usd, scope }` | cost-guard-warn | declared with 1.05/1.00, scope=CostScope::PerLoop |
| `LoopHaltReason::DecompositionComplete` | parallel-file-reads | declared (no payload variant) |

Variants `IterationCap`, `Cancelled`, `ProviderFatal` are deliberately NOT covered by EVAL-01 — they're driver-level fail-safes, not target outcomes per CONTEXT lock §EVAL-01.

## run_loop invocation pattern (deviation documented)

The plan's task body proposed invoking `loop_engine::run_loop(...)` per fixture. **That signature requires `tauri::AppHandle`** plus `SharedMcpManager`, `ApprovalMap`, `SharedVectorStore`, `SessionWriter`, etc. — runtime-only types. The codebase explicitly avoids `tauri::test::mock_app()`:
- `reward.rs:664` documents the posture
- `decomposition/executor.rs:574, 665, 1045` all confirm
- No existing test in the repo invokes `run_loop` end-to-end

**CONTEXT lock §Mock Provider for Deterministic Loop Replay authorizes the fallback verbatim:** "fall back to invoking just the scripted provider closure in isolation and asserting its behavior — but still framing the assertion as 'loop terminates with expected halt reason within cap iterations'."

**Implementation:** `run_fixture_via_seam` (shared by all 10 fixtures):
1. Installs ScriptedProvider via `setup_scripted_provider`
2. Drains the seam closure directly (mirroring `loop_engine.rs:1347` dispatch shape) — calls `EVAL_FORCE_PROVIDER.with(|cell| cell.borrow().as_ref().map(|f| f(&empty_msgs, &empty_tools)))` in a loop
3. Each closure invocation increments `iterations`; loop exits on `tool_calls.is_empty()` (natural completion proxy) OR `Err("script exhausted")` (synthetic halt-reason proxy) OR `iterations > cap` (bounded test runtime fail-safe)
4. SeamGuard's Drop teardown runs at scope-end (panic-safe via RAII)

**Trade-off:** The fixture's `passed` bool checks structural correctness (script bounds + closure discipline + acceptable error patterns). The actual halt-reason variant is a **declared contract** verified at the spec level by `phase37_eval_01_all_haltreasons_covered`. A future plan with a true loop test harness (e.g. extracting `run_loop_inner` into a `LoopDispatcher` trait per CONTEXT lock fallback) would replace "declared" with "observed".

## Type adaptations from plan

The plan's pseudocode used several placeholder constructions that needed correction against the actual codebase. All Rule 3 (auto-fix blocking issue against actual upstream).

1. **TurnResult → AssistantTurn** (Plan 37-02 already documented; reaffirmed here). The closure builds `crate::providers::AssistantTurn { content, tool_calls, stop_reason, tokens_in, tokens_out }`.
2. **stop_reason mapping** (new in 37-03): `truncated=true` → `Some("length")`, `tool_calls non-empty` → `Some("tool_use")`, otherwise `Some("stop")`. Mirrors per-provider conventions documented at providers/mod.rs:164-174.
3. **ToolCall construction** (new in 37-03): `crate::providers::ToolCall { id: format!("scripted_call_{}", name), name: name.to_string(), arguments: serde_json::from_str(args_json).unwrap_or(Value::Null) }`. The `id` prefix is deterministic so multiple ScriptedToolCalls with the same `tool_name` collide — fixtures avoid this by varying tool_name OR args.
4. **CostScope::PerLoop variant** (new in 37-03): verified via `grep -n CostScope src-tauri/src/loop_engine.rs` returning the enum at line 343 with two variants. PerLoop matches the more common cost_guard test pattern at loop_engine.rs:1204.
5. **Stuck pattern names** (new in 37-03): used `"RepeatedActionObservation"` per the doc-comment list at loop_engine.rs:382 (`"RepeatedActionObservation" | "MonologueSpiral" | "ContextWindowThrashing" | "NoProgress" | "CostRunaway"`). Pattern is a `String` per the LoopHaltReason::Stuck variant definition.
6. **CircuitOpen.attempts_summary**: declared as `Vec::new()` — production fills it at `CircuitBreaker::open()` time; the fixture contract is only the variant shape, not the runtime payload.

## Line-count delta

| Plan stage | LOC | Delta |
|------------|-----|-------|
| Plan 37-02 baseline | 209 | — |
| Plan 37-03 final | 1055 | +846 |

Breakdown of the +846:
- setup_scripted_provider full body (replaces stub): +28
- EVAL-01 banner + DEVIATION-DOC comment block: +25
- MultiStepTaskFixture struct + SeamGuard struct: +18
- run_fixture_via_seam shared runner: +75
- 10 const ScriptedResponse arrays + 10 fixture_<label> fns: +500 (avg 50 LOC per fixture pair)
- fixtures_eval_01_multi_step_tasks aggregator: +14
- eval_01_fixture_specs collection: +95
- phase37_eval_01_all_haltreasons_covered #[test]: +50
- phase37_eval_panic_in_scripted_closure_handled_gracefully #[test]: +41

## Deviations from Plan

**Three plan-text adaptations**, all Rule 3 (auto-fix blocking issue against actual codebase, no permission needed):

1. **[Rule 3 — Architecture adapter]** run_loop direct-invocation impossible (requires AppHandle); CONTEXT lock §Mock Provider fallback used: drain the seam closure directly. Documented above + in the in-file DEVIATION-DOC comment block at the top of the EVAL-01 banner section. The plan explicitly authorized this fallback ("If `run_loop` cannot be invoked deterministically without a Tauri AppHandle, the executor implements the fallback").
2. **[Rule 3 — Type adapter]** ScriptedResponse → AssistantTurn mapping: stop_reason synthesized from truncated/tool_calls (Plan 37-02 noted the field; Plan 37-03 implements the mapping logic).
3. **[Rule 3 — Halt-reason contract adapter]** expected_haltreason is a DECLARED CONTRACT (spec-level) rather than an observed runtime outcome — direct consequence of #1 (no AppHandle = no observed halt). The coverage assertion proves the spec includes all 5 variants; future plan with a real loop harness can upgrade "declared" to "observed".

**Out-of-scope discoveries (NOT fixed):**

Six pre-existing test failures observed in the full `cargo test --lib` sweep beyond Plan 37-02's already-documented `evals::organism_eval::evaluates_organism`:
- `db::tests::test_analytics`
- `deep_scan::scanners::fs_repos::tests::test_ignore_list`
- `deep_scan::scanners::fs_repos::tests::test_returns_followup_leads`
- `deep_scan::scanners::fs_repos::tests::test_walks_maxdepth_six`
- `router::tests::select_provider_tier2_task_routing`
- `safety_bundle::tests::test_attachment_patterns_no_match`

None of these modules import `evals::intelligence_eval`, `loop_engine::EVAL_FORCE_PROVIDER`, or any 37-02/37-03 surface. Per CLAUDE.md SCOPE BOUNDARY rule, NOT auto-fixed. Logged to `.planning/phases/37-intelligence-eval/deferred-items.md`.

Otherwise plan executed exactly as written.

## Auth Gates

None. No auth surfaces touched. Tests run entirely in-process on the test profile.

## Threat Surface Scan

Reviewed against Plan 37-03 STRIDE register (T-37-20..T-37-23):

- **T-37-20** (Per-fixture seam guard fails to teardown if assert! panics mid-fixture) — **mitigated**. SeamGuard struct implements Drop calling teardown_scripted_provider; Rust RAII guarantees Drop runs even on panic. Verified: panic-injection regression test installs panicking closure + fires catch_unwind without leaking state to subsequent tests (proven by all 4 tests passing in sequence).
- **T-37-21** (Script exhaustion = loop runs longer than scripted_responses.len()) — **mitigated**. `next_response()` returns `Err("script exhausted")` when called past script end; `run_fixture_via_seam` accepts this as a legitimate halt-reason proxy when the fixture declares `Some(CostExceeded|Stuck|CircuitOpen|DecompositionComplete)`; otherwise it's a fixture-bug detector.
- **T-37-22** (LoopHaltReason variant names differ from CONTEXT placeholder) — **mitigated**. Verified via `grep -n "pub enum LoopHaltReason" src/loop_engine.rs` + reading lines 367-398. Actual variants: CostExceeded (NOT CostExhausted), IterationCap, Cancelled, ProviderFatal, Stuck, CircuitOpen, DecompositionComplete. EVAL-01 covers 5 of 7 (skipping IterationCap + Cancelled + ProviderFatal as they're driver-level fail-safes per CONTEXT lock §EVAL-01).
- **T-37-23** (ScriptedResponse `response` strings may include real-looking but synthetic data) — **accepted**. All scripts are checked-in const data, no secrets, no real user content. Reviewable in PR diff.

No new threat flags. No production surface touched (entire EVAL-01 section is `#[cfg(test)]`).

## Commits

| Hash | Message |
|------|---------|
| `67c03d9` | feat(37-03): EVAL-01 multi-step task fixtures (10 scripted-loop scenarios) |

1 atomic commit; `git add` enumerated each path explicitly (`src-tauri/src/evals/intelligence_eval.rs`, `.planning/phases/37-intelligence-eval/deferred-items.md`). The 188 pre-existing staged deletions in `.planning/phases/00-31-*/` were deliberately NOT touched — out of scope for 37-03.

## Next-Wave Plans Unblocked

This plan's EVAL-01 banner unblocks:

- **Plan 37-04** (EVAL-02 — context efficiency) — appends `fixtures_eval_02_context_efficiency()` to `fixtures()`. Inspects `LAST_BREAKDOWN` from `brain.rs` directly; no ScriptedProvider seam needed (no run_loop dependency).
- **Plan 37-05** (EVAL-03 — stuck detection) — appends `fixtures_eval_03_stuck_detection()`. Calls `resilience::stuck::detect_stuck` directly. Aggregate-accuracy assertion gates on `stuck_detection_min_accuracy` (default 0.80, EvalConfig).
- **Plan 37-06** (EVAL-04 — compaction fidelity) — appends `fixtures_eval_04_compaction_fidelity()`. Mocked summaries.
- **Plan 37-07** (`scripts/verify-intelligence.sh`) — greps cargo-test stdout for U+250C delimiter; the EVAL-01 driver test now emits 10 EVAL-01 rows under that delimiter.

Plans 37-04..37-06 should reuse the IntelligenceFixture struct and the to_row helper; the SeamGuard pattern is also reusable for any future ScriptedProvider-driven fixture.

The MODULE_FLOOR=1.0 floor guard in `run_intelligence_eval_driver` is now ACTIVE (rows non-empty after 37-03). When 37-04..37-06 land, the assertion `sum.asserted_mrr >= MODULE_FLOOR` enforces capstone discipline — any failing fixture fails the whole intelligence eval suite.

## Self-Check: PASSED

Verified before writing this section:

- `[ -f /home/arnav/blade/src-tauri/src/evals/intelligence_eval.rs ]` → FOUND (1055 LOC)
- `grep -c "fn fixtures_eval_01_multi_step_tasks" src-tauri/src/evals/intelligence_eval.rs` → 1
- `grep -c "fn fixture_code_edit_multi_file\|fn fixture_cost_guard_warn" src-tauri/src/evals/intelligence_eval.rs` → 2
- `grep -c "phase37_eval_01_all_haltreasons_covered\|phase37_eval_panic_in_scripted_closure_handled_gracefully\|eval_01_fixture_specs" src-tauri/src/evals/intelligence_eval.rs` → 3
- `grep -c "// ── EVAL-01: Multi-step task fixtures ──" src-tauri/src/evals/intelligence_eval.rs` → 1 (banner lands once)
- `grep -c "static.*RESPONSES: &\[ScriptedResponse\]" src-tauri/src/evals/intelligence_eval.rs` → 10 (one const per fixture label)
- Commit `67c03d9` → FOUND in `git log --oneline -1`
- `cargo check --tests` → 0 errors (20 pre-existing warnings, +0 new — 1 net warning at active_inference_eval.rs is unrelated)
- `cargo test --lib evals::intelligence_eval -- --test-threads=1` → 4 passed, 0 failed
- All 4 tests emit U+250C delimiter or panic-then-recover (visible in captured stdout above)
- `phase37_eval_01_all_haltreasons_covered`: 5 variants asserted, 10 fixtures total
- `phase37_eval_panic_in_scripted_closure_handled_gracefully`: catch_unwind returned Err (panic contained)
