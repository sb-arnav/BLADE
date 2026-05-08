---
phase: 37-intelligence-eval
plan: 2
subsystem: evals/intelligence-eval-scaffold + loop_engine ScriptedProvider seam
tags: [evals, intelligence, scripted-provider, test-seam, eval-06, cfg-test]
status: complete
dependency_graph:
  requires:
    - "Phase 33-04 LOOP_OVERRIDE seam pattern (env-var precedent at loop_engine.rs:556)"
    - "Phase 33-09 FORCE_VERIFY_PANIC seam pattern (loop_engine.rs:605-609 — same file, same #[cfg(test)] block style)"
    - "Phase 34-04 RES_FORCE_STUCK seam pattern (resilience/stuck.rs:70 — Cell because Copy; the EVAL seam mirrors the shape but uses RefCell because Box<dyn Fn> is not Copy)"
    - "Phase 36-03 INTEL_FORCE_PAGERANK_RESULT seam pattern (intelligence/pagerank.rs:46 — Cell + Option<Vec> via .take())"
    - "Phase 30-02 organism_eval.rs structural template (MODULE_NAME + MODULE_FLOOR + Fixture struct + to_row + fixtures() + driver test)"
    - "Phase 16 evals/harness.rs print_eval_table contract (EVAL-06 box-drawing format, U+250C delimiter)"
  provides:
    - "loop_engine::EVAL_FORCE_PROVIDER thread_local (#[cfg(test)] only, RefCell<Option<Box<dyn Fn(...)>>>)"
    - "loop_engine::maybe_force_provider helper (#[cfg(test)] only)"
    - "loop_engine.rs dispatch-site short-circuit at the providers::complete_turn call (test branch checks seam, production branch unchanged)"
    - "evals::intelligence_eval::run_intelligence_eval_driver test (empty fixtures + EVAL-06 table emit)"
    - "evals::intelligence_eval::tests::phase37_eval_scaffold_emits_empty_table smoke test"
    - "evals::intelligence_eval::ScriptedProvider + ScriptedResponse + ScriptedToolCall (#[cfg(test)] state-shape for Plan 37-03)"
    - "evals::intelligence_eval::setup_scripted_provider + teardown_scripted_provider stubs (Plan 37-03 fills the body)"
  affects:
    - "loop_engine.rs:611-648 (new seam block under #[cfg(test)])"
    - "loop_engine.rs:1340-1370 (dispatch site replaced with cfg-branched block)"
    - "evals/mod.rs (line 24: +1 #[cfg(test)] mod entry)"
tech_stack:
  used:
    - "std::cell::RefCell (chosen over Cell because Box<dyn Fn> is not Copy)"
    - "std::sync::Mutex (ScriptedProvider cursor — Plan 37-03 will use across-thread access via the EVAL_FORCE_PROVIDER closure)"
    - "Tauri test profile cfg(test) — same gating as FORCE_VERIFY_PANIC at loop_engine.rs:605"
  patterns:
    - "thread_local RefCell<Option<Box<dyn Fn>>> test seam (first BLADE application — prior seams used Cell because their stored types were Copy)"
    - "Dispatch-site cfg branch: test path checks seam first, prod path (cfg(not(test))) unchanged — verified via cargo check --release exits 0 with 19 pre-existing warnings only"
    - "Empty-fixtures driver test with floor-guard (`if !rows.is_empty()`) — lets the scaffold ship + emit the table without false-fail before Plans 37-03..37-06 populate the registry"
key_files:
  created:
    - "src-tauri/src/evals/intelligence_eval.rs (209 LOC)"
    - ".planning/phases/37-intelligence-eval/deferred-items.md (out-of-scope log)"
  modified:
    - "src-tauri/src/loop_engine.rs (+39 LOC seam block, +21 LOC dispatch-site cfg branches, -9 LOC original dispatch lines = +51 net)"
    - "src-tauri/src/evals/mod.rs (+1 LOC)"
decisions:
  - "Seam stores Box<dyn Fn(&[ConversationMessage], &[ToolDefinition]) -> Result<AssistantTurn, String>>; Cell can't hold non-Copy types so RefCell is required (this is the type adaptation noted in plan §interfaces lock)."
  - "Dispatch-site short-circuit uses an explicit `if let Some(forced) = ... { forced } else { real_call.await }` block inside `#[cfg(test)]`, with a parallel `#[cfg(not(test))] { real_call.await }` block — production builds compile to ONLY the second block. Verified by cargo check --release green."
  - "Adapter from plan: providers::complete_turn returns `Result<AssistantTurn, String>` (providers/mod.rs:160 + 227), NOT the placeholder `TurnResult` name in 37-CONTEXT.md. Seam closure signature uses AssistantTurn directly. ScriptedResponse keeps `truncated: bool` for ergonomic Plan 37-03 fixture authoring; the closure body Plan 37-03 writes will map `truncated -> stop_reason: Some(\"length\")`."
  - "Adapter from plan: ToolDefinition lives at `crate::providers::ToolDefinition` (providers/mod.rs:123), NOT `crate::native_tools::ToolDefinition`. The seam closure type signature uses the providers path. Confirmed via `grep -rn 'pub struct ToolDefinition' src-tauri/src/` returning exactly one hit."
  - "Adapter from plan: harness::print_eval_table signature is `(title: &str, rows: &[EvalRow])` — 2 args, not 4. The plan's pseudocode passed `(title, rows, &sum, MODULE_FLOOR)` but harness.rs:135 takes only the first two. Title carries the floor for stdout visibility: `\"intelligence eval (floor=1.00)\"`. Plans 37-03..37-06 must use the same 2-arg shape."
  - "EVAL_FORCE_PROVIDER block placed at loop_engine.rs:611 (immediately after FORCE_VERIFY_PANIC at line 605-609) for visual proximity to the existing #[cfg(test)] thread_local block. Both seams use the same loop_engine.rs file — easy to find for future plan readers."
  - "ScriptedProvider declared at file level (under #[cfg(test)] outside the inner `mod tests`), not nested inside `mod tests`. CONTEXT lock §intelligence_eval.rs preferred file-level for visibility to Plan 37-03's fixture helpers."
  - "All ScriptedProvider/Response/ToolCall fields + helper functions carry `#[allow(dead_code)]` because Plan 37-02 ships only the state-shape — Plans 37-03..37-06 instantiate them. Without the allow, cargo would warn on every unused field. Removed in Plan 37-03 once activated."
  - "OEVAL-01c (organism eval timeline recovery arc) failed in the regression run; LOGGED TO deferred-items.md as out-of-scope (Plan 37-02 touched zero organism code). Last-touch on organism_eval.rs was Phase 30-02 commit 8e79367 — pre-dates Phase 37 entirely. Per SCOPE BOUNDARY rule, NOT auto-fixed."
metrics:
  duration_minutes: 22
  tasks_completed: 4
  files_modified: 3
  files_created: 1
  commits: 1
  tests_added: 2
  tests_pass: "2/2"
  cargo_check_errors: 0
  cargo_check_release_errors: 0
completed_date: "2026-05-08"
requirements_addressed: [EVAL-01]
---

# Phase 37 Plan 37-02: intelligence_eval Scaffold + EVAL_FORCE_PROVIDER Seam Summary

**One-liner:** Lands the Phase 37 eval scaffolding — a `#[cfg(test)]` `EVAL_FORCE_PROVIDER` thread-local seam in `loop_engine.rs` (mirrors `RES_FORCE_STUCK` shape but uses `RefCell` because the stored `Box<dyn Fn>` is not `Copy`) plus the empty `evals/intelligence_eval.rs` module shell with the EVAL-06 box-drawing driver test, smoke test, and `ScriptedProvider/Response/ToolCall` state-shape declarations that Plan 37-03 will instantiate.

## Tests Added (all green)

```
running 2 tests
test evals::intelligence_eval::run_intelligence_eval_driver ...
┌── intelligence eval (floor=1.00) ──
├─────────────────────────────────────────────────────────
│ top-1: 0/0 (0%)  top-3: 0/0 (0%)  MRR: 0.000
└─────────────────────────────────────────────────────────

ok
test evals::intelligence_eval::tests::phase37_eval_scaffold_emits_empty_table ...
┌── intelligence eval (floor=1.00) ──
├─────────────────────────────────────────────────────────
│ top-1: 0/0 (0%)  top-3: 0/0 (0%)  MRR: 0.000
└─────────────────────────────────────────────────────────

ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 810 filtered out
```

Both tests emit the U+250C box-drawing header — the exact delimiter that `scripts/verify-intelligence.sh` (Plan 37-07) will grep on the cargo-test stdout. With empty fixtures the rollup line shows `top-1: 0/0 (0%)` — Plans 37-03..37-06 will populate `fixtures()` to push these counts up.

## Exact line numbers (for Plan 37-03 reference)

| Anchor | File | Line | What |
|--------|------|------|------|
| EVAL_FORCE_PROVIDER decl | loop_engine.rs | 629 | `pub static EVAL_FORCE_PROVIDER: std::cell::RefCell<...>` |
| maybe_force_provider helper | loop_engine.rs | 642 | `fn maybe_force_provider(msgs, tools) -> Option<Result<AssistantTurn, String>>` |
| Seam block opening | loop_engine.rs | 611 | `// ── Phase 37 / EVAL-01 — Test-only ScriptedProvider seam ──` |
| Dispatch-site short-circuit | loop_engine.rs | 1347 | `if let Some(forced) = maybe_force_provider(conversation, tools) { forced }` |
| Production-branch dispatch | loop_engine.rs | 1363 | `providers::complete_turn(...)` inside `#[cfg(not(test))]` block |
| evals/mod.rs registration | evals/mod.rs | 24 | `#[cfg(test)] mod intelligence_eval;        // Phase 37 / EVAL-01..05` |

The dispatch site was at line 1304 pre-edit (per plan); after inserting the 39-LOC seam block at line 611-648, all later line numbers shift by +39, so the dispatch is now at line 1340-1370 (was 1304-1312). The seam check `maybe_force_provider(...)` is at line 1347 inside the cfg(test) branch.

## Type adaptations from plan (3 documented)

The plan's CONTEXT and pseudocode used three placeholder names that needed correction against the actual codebase:

1. **`TurnResult` → `AssistantTurn`** — `providers::complete_turn` returns `Result<AssistantTurn, String>` (providers/mod.rs:160 defines `pub struct AssistantTurn { content, tool_calls, stop_reason, tokens_in, tokens_out }`). The plan's `TurnResult { content, tool_calls, truncated }` shape doesn't exist; `AssistantTurn` carries `stop_reason: Option<String>` instead. Seam closure signature corrected. ScriptedResponse keeps the ergonomic `truncated: bool` field — Plan 37-03's closure body will map `truncated → stop_reason: Some("length"|"stop")`.
2. **`crate::native_tools::ToolDefinition` → `crate::providers::ToolDefinition`** — verified via `grep -rn 'pub struct ToolDefinition' src-tauri/src/` returning exactly one hit at `providers/mod.rs:123`. There is no `native_tools::ToolDefinition`. Seam closure uses the providers path.
3. **`print_eval_table(title, rows, &sum, floor)` → `print_eval_table(title, rows)`** — harness.rs:135 takes 2 args. The plan's 4-arg call would not compile. Title format `"intelligence eval (floor=1.00)"` carries the floor visibly in the captured stdout. Plans 37-03..37-06 should use the 2-arg shape verbatim.

All three adaptations preserve the plan's Phase 37 contract (seam exists, scaffold compiles, driver emits the EVAL-06 table). None change the seam's gating, the floor value, or the verify-intelligence.sh grep target.

## Production-path-unchanged confirmation

```
$ cd src-tauri && cargo check --release
    Finished `release` profile [optimized] target(s) in 6m 29s
```

0 errors, 19 pre-existing warnings (same set as `cargo check` debug — unchanged by Plan 37-02). The seam block is entirely `#[cfg(test)]`-gated:
- `EVAL_FORCE_PROVIDER` thread_local: `#[cfg(test)] thread_local! { ... }`
- `maybe_force_provider` helper: `#[cfg(test)] fn maybe_force_provider(...)`
- Dispatch-site test branch: inside `#[cfg(test)] { ... }` block
- Dispatch-site prod branch: inside `#[cfg(not(test))] { ... }` block

Production binary contains zero references to `EVAL_FORCE_PROVIDER`, `maybe_force_provider`, or the test branch — the cfg(not(test)) block compiles to the same `providers::complete_turn(&config.provider, ...).await` it did before Plan 37-02.

## evals/mod.rs entries

Pre-37-02: 14 entries (line 10 `harness` through line 23 `organism_eval`).
Post-37-02: 15 entries (line 24 `intelligence_eval` appended). Comment-trail format matches: `// Phase 37 / EVAL-01..05`.

## intelligence_eval.rs file layout (209 LOC)

| Banner | Lines | Contents |
|--------|-------|----------|
| Module doc-comment | 1-19 | Phase 37 banner, MODULE_FLOOR rationale, run command, EVAL-01..04 outline |
| Module constants | 20-23 | MODULE_NAME, MODULE_FLOOR |
| Fixture harness | 25-46 | IntelligenceFixture struct + to_row helper (5-arg incl requirement) |
| Fixture registry | 48-63 | Empty fixtures() with commented hooks for Plans 37-03..37-06 |
| Driver test | 65-92 | run_intelligence_eval_driver (empty-rows path with floor guard) |
| ScriptedProvider state-shape | 94-148 | ScriptedToolCall + ScriptedResponse + ScriptedProvider + impl |
| setup/teardown helpers | 150-184 | setup_scripted_provider stub + teardown_scripted_provider |
| Smoke test mod | 186-209 | phase37_eval_scaffold_emits_empty_table |

## ScriptedProvider state shape (Plan 37-03 entry point)

```rust
#[cfg(test)]
pub(crate) struct ScriptedProvider {
    pub script: Vec<ScriptedResponse>,
    pub cursor: std::sync::Mutex<usize>,
}

impl ScriptedProvider {
    pub fn new(script: &'static [ScriptedResponse]) -> Self { ... }
    pub fn next_response(&self) -> Result<ScriptedResponse, String> { ... }
}
```

`Mutex<usize>` cursor is the explicit choice over `Cell<usize>` because Plan 37-03's installed closure may be called from `tokio::async_runtime::spawn` contexts inside `run_loop_inner`. `--test-threads=1` is mandatory anyway (per CONTEXT lock §verify-intelligence.sh Gate) so contention is not a concern, but the `Mutex` makes the closure `Send + Sync` which `Box<dyn Fn>` requires for thread_local closure storage. `Result<...>` from `next_response` lets EVAL-01 fixtures distinguish "script exhausted unexpectedly" (test bug) from a deliberate end-of-script case.

## Deviations from Plan

**Three plan-text adaptations**, all Rule 3 (auto-fix blocking issue against the actual codebase, no permission needed). Documented above:

1. **[Rule 3 — Type adapter]** TurnResult → AssistantTurn (plan placeholder vs. actual upstream).
2. **[Rule 3 — Path adapter]** crate::native_tools::ToolDefinition → crate::providers::ToolDefinition (plan typo vs. actual file).
3. **[Rule 3 — Signature adapter]** print_eval_table 4-arg → 2-arg (plan pseudocode used a non-existent overload; actual harness signature is 2-arg).

**Out-of-scope discovery (NOT fixed):**

- `evals::organism_eval::evaluates_organism` fails with `OEVAL-01c: timeline recovery arc` below floor (pass rate 0.923 < 1.000). This is unrelated to Plan 37-02 — organism eval has zero import of `loop_engine` or `EVAL_FORCE_PROVIDER`, and `organism_eval.rs` was last touched in commit `8e79367` (Phase 30-02). Logged to `.planning/phases/37-intelligence-eval/deferred-items.md`. Per SCOPE BOUNDARY rule, NOT auto-fixed.

Otherwise plan executed exactly as written.

## Auth Gates

None. No auth surfaces touched. The seam is test-only and operates entirely in-process.

## Threat Surface Scan

Reviewed against Plan 37-02 STRIDE register (T-37-10..T-37-12):

- **T-37-10** (EVAL_FORCE_PROVIDER closure leaks into production builds) — mitigated. `cargo check --release` produces 0 errors and the seam block is entirely `#[cfg(test)]`. Plans 37-03..37-06 inherit the same gating discipline.
- **T-37-11** (stale state across tests) — mitigated. `teardown_scripted_provider` helper sets the RefCell back to `None`. CONTEXT lock §Mock Provider locks `--test-threads=1` so no parallel test sees a half-installed closure. Plan 37-03's fixtures must call teardown in a defer-style block.
- **T-37-12** (wrong import path causes Plan 37-02 cargo check fail) — mitigated. Verified via `grep -rn 'pub struct ToolDefinition' src-tauri/src/` returning exactly one hit at providers/mod.rs:123. Closure signature uses the verified path.

No new threat surfaces beyond the plan's enumeration. No flags added.

## Commits

| Hash | Message |
|------|---------|
| `06538e4` | feat(37-02): intelligence_eval scaffold + ScriptedProvider + EVAL_FORCE_PROVIDER seam |

1 atomic commit; `git add` enumerated each path explicitly (`src-tauri/src/loop_engine.rs`, `src-tauri/src/evals/intelligence_eval.rs`, `src-tauri/src/evals/mod.rs`). The pre-existing uncommitted `src-tauri/src/config.rs` mods (Phase 37-01 leftover) and the `eval-runs/` untracked dir were deliberately NOT staged — out of scope for 37-02.

## Next-Wave Plans Unblocked

This plan's seam + scaffold unblocks all four Phase 37 fixture-fill plans:

- **Plan 37-03** (EVAL-01 — multi-step task completion) — instantiates `ScriptedProvider`, fills the body of `setup_scripted_provider` to install a closure into `EVAL_FORCE_PROVIDER`, drives `loop_engine::run_loop` against canned tool sequences. Will use the file-level `ScriptedProvider` declaration directly (no nested `mod tests` import).
- **Plan 37-04** (EVAL-02 — context efficiency) — appends `fixtures_eval_02_context_efficiency()` to `fixtures()`. Inspects `LAST_BREAKDOWN` from `brain.rs` directly; doesn't need the ScriptedProvider seam.
- **Plan 37-05** (EVAL-03 — stuck detection) — appends `fixtures_eval_03_stuck_detection()`. Calls `resilience::stuck::detect_stuck` directly. Aggregate-accuracy assertion at the end of `run_intelligence_eval_driver` will gate on `stuck_detection_min_accuracy` (default 0.80, from Plan 37-01 EvalConfig).
- **Plan 37-06** (EVAL-04 — compaction fidelity) — appends `fixtures_eval_04_compaction_fidelity()`. Uses mocked summaries.
- **Plan 37-07** — `scripts/verify-intelligence.sh` gate. Greps cargo-test stdout for the U+250C delimiter; both 37-02 tests already emit it, so the gate will pass even before the fixtures populate.

Once Plans 37-03..37-06 land, the `if !rows.is_empty()` floor guard in `run_intelligence_eval_driver` becomes unconditional and `MODULE_FLOOR=1.0` enforces capstone discipline.

## Self-Check: PASSED

Verified before writing this section:

- `[ -f src-tauri/src/evals/intelligence_eval.rs ]` → FOUND (209 LOC)
- `grep -c "EVAL_FORCE_PROVIDER" src-tauri/src/loop_engine.rs` → 3 (decl + helper-internal access + decl-doc-comment cross-refs)
- `grep -c "maybe_force_provider" src-tauri/src/loop_engine.rs` → 2 (definition + dispatch-site call)
- `grep -c "mod intelligence_eval" src-tauri/src/evals/mod.rs` → 1
- `grep -c "MODULE_FLOOR: f32 = 1.0" src-tauri/src/evals/intelligence_eval.rs` → 1
- `grep -c "struct IntelligenceFixture\|struct ScriptedProvider\|struct ScriptedResponse\|struct ScriptedToolCall" src-tauri/src/evals/intelligence_eval.rs` → 4 (all four structs)
- `grep -c "fn run_intelligence_eval_driver\|fn phase37_eval_scaffold_emits_empty_table" src-tauri/src/evals/intelligence_eval.rs` → 2 (both tests declared)
- Commit `06538e4` → FOUND in `git log --oneline -3`
- `cargo check` → 0 errors (19 pre-existing warnings)
- `cargo check --release` → 0 errors (19 pre-existing warnings; production unchanged)
- `cargo test --lib evals::intelligence_eval -- --nocapture --test-threads=1` → 2 passed, 0 failed
- Both tests emit U+250C delimiter (visible in captured stdout above)
