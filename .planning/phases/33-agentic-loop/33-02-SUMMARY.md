---
phase: 33-agentic-loop
plan: 2
subsystem: rust-loop-engine
tags: [substrate, loop-engine, tool-error, enrich-alternatives, native-tools-shim, rust, tauri, loop-02, scaffolding]

# Dependency graph
requires:
  - phase: 33-01
    provides: "LoopConfig (smart_loop_enabled / max_iterations / cost_guard_dollars / verification_every_n) — Plan 33-02 ships LoopState/LoopHaltReason/ToolError that the LoopConfig knobs ultimately drive at runtime in Wave 2/3"
  - phase: 32-07
    provides: "catch_unwind + AssertUnwindSafe fallback discipline — Plans 33-04/33-09 will wrap loop_engine helpers with this same shape"
provides:
  - "src-tauri/src/loop_engine.rs — Phase 33's central scaffolding module: LoopState, LoopHaltReason, ToolError, ActionRecord, enrich_alternatives, render_for_model"
  - "LoopState ring-buffer ActionRecord pattern (push_back + while-len > 3 pop_front) — referenced by Plan 33-04's verification probe context"
  - "ToolError::render_for_model contract: omits 'Suggested alternatives:' block entirely when alternatives are empty (no empty bullets) — Plans 33-05 and 33-09 rely on this"
  - "native_tools::wrap_legacy_error shim (Result<_, String> → ToolError with empty alternatives) — boundary helper for Plans 33-05+ to consume legacy 37+ tool failures uniformly without per-tool migration"
  - "mod loop_engine; registration in lib.rs — Wave 2 plans (33-03+) reference crate::loop_engine::* without re-registering"
  - "10 enrich_alternatives entries covering read_file, write_file, bash, list_dir|ls, grep|search_files, web_search, fetch_url|browser_fetch, run_python, system_control, clipboard|read_clipboard|write_clipboard"
affects: [33-03-loop-body-refactor, 33-04-mid-loop-verification, 33-05-tool-error-wrap-and-replan, 33-06-truncation-escalation, 33-08-cost-guard-and-activitystrip, 33-09-fallback-discipline]

# Tech tracking
tech-stack:
  added: []  # no new crates — all stdlib (HashMap, VecDeque) + existing serde
  patterns:
    - "Top-level monolithic Rust module with #[cfg(test)] mod tests at the bottom — mirrors Phase 32's loop_engine sibling pattern"
    - "Boundary-shim style for back-compat (wrap_legacy_error) — caller code stays dumb, intelligence (enrich_alternatives) lives at the LoopState boundary"
    - "Ring-buffer record_action with while-pop_front eviction — VecDeque semantics over a hand-rolled bounded queue"
    - "render_for_model omits empty sub-blocks rather than emitting empty bullets — locked CONTEXT format, asserted by phase33_tool_error_render_omits_empty_alternatives_block"

key-files:
  created:
    - "src-tauri/src/loop_engine.rs (278 lines — LoopState/LoopHaltReason/ToolError/ActionRecord types + enrich_alternatives helper + 5 unit tests)"
  modified:
    - "src-tauri/src/lib.rs (one line: mod loop_engine; registered after mod learning_engine; — alphabetically adjacent neighbor)"
    - "src-tauri/src/native_tools.rs (47-line append at end-of-file: wrap_legacy_error shim + phase33_loop02_tests::phase33_wrap_legacy_error_produces_empty_alternatives — pure append, zero `-` deletion lines on existing tool code)"

key-decisions:
  - "LoopState fields chosen exactly per CONTEXT lock §Specific Ideas — no creative additions. iteration / cumulative_cost_usd / replans_this_run / token_escalations / last_3_actions (VecDeque<ActionRecord>) / consecutive_same_tool_failures (HashMap<String, u32>)."
  - "ActionRecord fields chosen per RESEARCH §Implementation Sketches — tool / input_summary / output_summary / is_error. Plan 33-04 will safe_slice the input/output summaries to 300 chars at construction time (substrate ships the type; populator owns the slicing)."
  - "ToolError derives PartialEq, Eq for test comparisons + serde Serialize/Deserialize so the same struct can later flow through any provider boundary that needs JSON form (Plan 33-05 may use this)."
  - "LoopState::record_action implemented inline in this plan even though it's strictly only consumed by Plan 33-04 — it's a 5-line helper that defines the ring-buffer eviction semantics, and the test phase33_loop_state_record_action_evicts_oldest locks the contract. Cheaper than re-deriving it next plan."
  - "enrich_alternatives uses a single match expression with multi-pattern arms (`'list_dir' | 'ls'` etc.) for tool-name aliases — covers 10 logical entries across 14 string keys. Unknown tool names hit the `_ => vec![]` arm; the test phase33_enrich_alternatives_known_tools locks this against accidental panics."
  - "wrap_legacy_error placed at end-of-file in native_tools.rs (no #[cfg(test)] mod tests block exists pre-shim, so the test went into a new mod phase33_loop02_tests block). Pure append shape verified — `git diff src-tauri/src/native_tools.rs | grep -E '^-[^-]'` returns 0 lines."
  - "Cross-plan commit bundling: Plan 33-01's config.rs LoopConfig changes were already staged in the working-tree index when Task 2 commit ran, so the commit c4b0af5 carried both 33-01's LoopConfig substrate AND 33-02's wrap_legacy_error shim. This is recorded under Deviations below; it does NOT change the correctness of either plan's contract — both pass their respective acceptance criteria. Plan 33-01 also landed its own SUMMARY/commit (3a6bcf8) with the same config.rs work referenced from its perspective."

requirements-completed: [LOOP-02]

# Metrics
duration: 65 min
completed: 2026-05-05
---

# Phase 33 Plan 33-02: loop_engine.rs Scaffold + ToolError + wrap_legacy_error Shim Summary

**Wave 1 substrate's second half. Phase 33's central scaffolding module (`loop_engine.rs`) now exists with LoopState / LoopHaltReason / ToolError / ActionRecord / enrich_alternatives, the back-compat shim (`native_tools::wrap_legacy_error`) wraps every legacy `Result<_, String>` failure into a structured `ToolError` without per-tool migration, and the `ToolError::render_for_model()` contract is locked: when `suggested_alternatives` is empty, the entire "Suggested alternatives:" block is omitted (no empty bullets — CONTEXT lock §LOOP-02). Six green tests; zero Tauri commands added; zero existing tool signatures touched.**

## Performance

- **Duration:** ~65 min wall-clock (cargo recompile dominates: 6m21s first cargo check, 15m16s first cargo test, 2m41s incremental cargo check, 3m05s test run)
- **Started:** 2026-05-05T14:37:26Z
- **Completed:** 2026-05-05T15:43:25Z
- **Tasks:** 2/2 complete (both type="auto" tdd="true")
- **Files created:** 1 (`src-tauri/src/loop_engine.rs`)
- **Files modified:** 2 (`src-tauri/src/lib.rs`, `src-tauri/src/native_tools.rs`)
- **Tests added:** 6 unit tests, all green (5 in `loop_engine::tests` + 1 in `native_tools::phase33_loop02_tests`)
- **LOC delta:** +278 (loop_engine.rs new) + 1 (lib.rs mod registration) + 47 (native_tools.rs append) = +326 across 3 files

## Accomplishments

- **`src-tauri/src/loop_engine.rs` exists as a top-level Rust module.** 278 lines including header comment, types, helper, and tests. Registered in `lib.rs` via `mod loop_engine;` placed after `mod learning_engine;` (alphabetically adjacent neighbor in the existing cluster). Phase 33 adds NO Tauri commands — confirmed via `grep -c "#[tauri::command]" loop_engine.rs` = 0.
- **LoopState lands with the exact 6-field shape from CONTEXT lock.** `iteration: u32`, `cumulative_cost_usd: f32`, `replans_this_run: u32`, `token_escalations: u32`, `last_3_actions: VecDeque<ActionRecord>`, `consecutive_same_tool_failures: HashMap<String, u32>`. `Default` derived. `record_action` helper implements the ring-buffer eviction (push_back + while-len > 3 pop_front).
- **LoopHaltReason enum lands with 4 structured variants.** `CostExceeded { spent_usd, cap_usd }` / `IterationCap` / `Cancelled` / `ProviderFatal { error }`. Plan 33-03 will pattern-match these in commands.rs to emit the appropriate chat_error / chat_cancelled / blade_loop_event.
- **ToolError struct + render_for_model method.** Three fields (`attempted`, `failure_reason`, `suggested_alternatives: Vec<String>`) with `serde::{Serialize, Deserialize}` + `PartialEq, Eq` derives. `render_for_model()` builds the locked CONTEXT format ("Tool failed.\nAttempted: X\nReason: Y\nSuggested alternatives:\n  - alt1\n  - alt2"). When `suggested_alternatives` is empty, the entire "Suggested alternatives:" sub-block is OMITTED — locked by `phase33_tool_error_render_omits_empty_alternatives_block` (the test asserts `!output.contains("Suggested alternatives")`).
- **enrich_alternatives ships 10 logical entries across 14 string keys.** `read_file`, `write_file`, `bash`, `list_dir|ls`, `grep|search_files`, `web_search`, `fetch_url|browser_fetch`, `run_python`, `system_control`, `clipboard|read_clipboard|write_clipboard`. Unknown tools hit `_ => vec![]` (no panic, no fallback fluff). Locked by `phase33_enrich_alternatives_known_tools` which exercises 3 known tools + 1 unknown.
- **`native_tools::wrap_legacy_error(tool_name, err) -> ToolError` shim added.** End-of-file append in native_tools.rs. Empty `suggested_alternatives` by design — enrichment lives at the LoopState boundary (loop_engine::enrich_alternatives), not at the shim site, so tool code stays dumb. Test `phase33_wrap_legacy_error_produces_empty_alternatives` asserts the contract (`assert!(e.suggested_alternatives.is_empty())`).
- **No existing tool signatures touched.** `git diff src-tauri/src/native_tools.rs | grep -E "^-[^-]"` returns 0 lines on the Task 2 commit. The shim is pure append after the existing `find_project_root` helper.
- **`cargo check` clean.** Final state: 11 warnings (10 pre-existing + 1 new `enrich_alternatives is never used` — expected for substrate plan; Wave 2 wires it). Zero errors.
- **All 6 phase33 plan-02 tests green** plus 3 phase33 plan-01 tests green (config.rs LoopConfig — bundled into Task 2 commit per Deviations below):

```
running 9 tests
test config::tests::phase33_loop_config_default_values                      ... ok
test config::tests::phase33_loop_config_missing_in_disk_uses_defaults       ... ok
test config::tests::phase33_loop_config_round_trip                          ... ok
test loop_engine::tests::phase33_enrich_alternatives_known_tools            ... ok
test loop_engine::tests::phase33_loop_state_default                         ... ok
test loop_engine::tests::phase33_loop_state_record_action_evicts_oldest     ... ok
test loop_engine::tests::phase33_tool_error_render_with_alternatives        ... ok
test loop_engine::tests::phase33_tool_error_render_omits_empty_alternatives_block ... ok
test native_tools::phase33_loop02_tests::phase33_wrap_legacy_error_produces_empty_alternatives ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 508 filtered out; finished in 0.01s
```

## enrich_alternatives Coverage Detail

The locked CONTEXT spec calls for "~10 entries covering common tools." Shipped:

| Tool name (incl. aliases) | # alternatives |
|---|---|
| `read_file` | 2 (verify path with `bash 'ls -la <dir>'`; check typos / case) |
| `write_file` | 2 (parent dir exists with `bash 'mkdir -p <dir>'`; disk space + perms) |
| `bash` | 2 (command in PATH via `command -v`; quote/escape sanity) |
| `list_dir` \| `ls` | 2 (parent path; `ls -la` for permissions) |
| `grep` \| `search_files` | 2 (broaden pattern; verify search root) |
| `web_search` | 2 (narrower/broader query; `after:`/`before:` time window) |
| `fetch_url` \| `browser_fetch` | 2 (auth wall / CAPTCHA check; archive variant) |
| `run_python` | 2 (`python3 --version`; verify imports / install missing) |
| `system_control` | 2 (Accessibility/Automation/Disk Access perms; simpler probe op) |
| `clipboard` \| `read_clipboard` \| `write_clipboard` | 2 (xclip/wl-clipboard daemon; retry on race) |

**Total:** 10 logical entries, 14 string keys (4 alias arms), 20 alternative strings. Tests confirm `read_file`, `bash`, `web_search` non-empty and `nonexistent_tool_xyz` empty.

## Tauri Command Namespace Defensive Checks

```
$ grep -rn "fn run_loop\b" /home/arnav/blade/src-tauri/src/        → 0 lines (no collision; Plan 33-03 will add)
$ grep -rn "fn verify_progress\b" /home/arnav/blade/src-tauri/src/ → 0 lines (no collision; Plan 33-04 will add)
$ grep -rn "#\[tauri::command\]" /home/arnav/blade/src-tauri/src/loop_engine.rs → 0 lines (Phase 33 adds NO Tauri commands; CONTEXT lock §Module Boundaries)
```

The new module's `wrap_legacy_error`, `record_action`, `render_for_model`, and `enrich_alternatives` symbol names were all confirmed unique in the codebase before commit. Plan 33-03's eventual `run_loop` and Plan 33-04's `verify_progress` symbols are also confirmed clear today.

## Test Counts

**Before Plan 33-02 (after Plan 33-01 landed config.rs LoopConfig):**

```
cargo test --lib phase33 → 3 passed (3 config LoopConfig tests from Plan 33-01)
```

**After Plan 33-02:**

```
cargo test --lib phase33 → 9 passed (3 from 33-01 + 5 new loop_engine + 1 new native_tools shim)
```

5 of the 6 new tests live in `loop_engine::tests`; the 6th lives in `native_tools::phase33_loop02_tests` (newly-created `mod phase33_loop02_tests` block since native_tools.rs had no pre-existing test module).

## Acceptance Grep Verification

```
$ test -f /home/arnav/blade/src-tauri/src/loop_engine.rs && echo OK    → OK
$ grep -c "^mod loop_engine" /home/arnav/blade/src-tauri/src/lib.rs    → 1
$ grep -c "pub struct LoopState" /home/arnav/blade/src-tauri/src/loop_engine.rs        → 1
$ grep -c "pub struct ToolError" /home/arnav/blade/src-tauri/src/loop_engine.rs        → 1
$ grep -c "pub struct ActionRecord" /home/arnav/blade/src-tauri/src/loop_engine.rs     → 1
$ grep -c "pub enum LoopHaltReason" /home/arnav/blade/src-tauri/src/loop_engine.rs     → 1
$ grep -c "pub fn enrich_alternatives" /home/arnav/blade/src-tauri/src/loop_engine.rs  → 1
$ grep -c "pub fn render_for_model" /home/arnav/blade/src-tauri/src/loop_engine.rs     → 1
$ grep -c "#\[tauri::command\]" /home/arnav/blade/src-tauri/src/loop_engine.rs         → 0
$ grep -c "pub fn wrap_legacy_error" /home/arnav/blade/src-tauri/src/native_tools.rs   → 1
$ grep -c "crate::loop_engine::ToolError" /home/arnav/blade/src-tauri/src/native_tools.rs → 2
$ grep -c "phase33_wrap_legacy_error" /home/arnav/blade/src-tauri/src/native_tools.rs  → 1
```

All twelve acceptance gates met.

## Task Commits

Each task committed atomically with conventional-commit messaging. No `git add -A` used; specific file paths only. No Co-Authored-By lines (per CLAUDE.md).

1. **Task 1 — loop_engine.rs scaffold + lib.rs registration:** `d69aa81`
   - `feat(33-02): scaffold loop_engine.rs with LoopState/LoopHaltReason/ToolError + enrich_alternatives (LOOP-02 substrate)`
   - 2 files changed, 279 insertions(+) — `src-tauri/src/loop_engine.rs` (new, 278 lines) + `src-tauri/src/lib.rs` (+1 line)
2. **Task 2 — wrap_legacy_error shim (cross-bundled with Plan 33-01's config.rs LoopConfig — see Deviations):** `c4b0af5`
   - `feat(33-02): add wrap_legacy_error shim in native_tools.rs (LOOP-02 back-compat boundary)`
   - 2 files changed, 207 insertions(+) — `src-tauri/src/native_tools.rs` (+47 lines, append-only) + `src-tauri/src/config.rs` (+160 lines, Plan 33-01's LoopConfig substrate that was already staged in the index from a parallel-wave executor)

## Decisions Made

- **Plan executed verbatim with no behavioral deviations.** All locked CONTEXT decisions honored (LoopState 6-field shape, ToolError empty-alternatives-block omission, enrich_alternatives ~10-entry MVP, wrap_legacy_error empty-alternatives by design, no Tauri commands, no per-tool migration).
- **Test naming followed Phase 32 convention:** `phase33_*` prefix so `cargo test --lib phase33` continues to be the canonical Phase 33 test-run filter (3 from 33-01 → 9 after 33-02 → growing through Wave 2/3).
- **Module location:** placed `mod loop_engine;` after `mod learning_engine;` (line 39 in lib.rs) — alphabetically adjacent in the existing mod cluster. The cluster is not strictly alphabetized but `learning_engine` is the closest `l*` neighbor.
- **enrich_alternatives default arm returns `vec![]` not `None`** — the function returns `Vec<String>`, not `Option<Vec<String>>`, so callers never have to unwrap. The test phase33_enrich_alternatives_known_tools asserts the empty-vec contract for unknown tools.

## Deviations from Plan

**1. [Cross-plan commit bundling — not a behavioral deviation]** Plan 33-01's `config.rs` LoopConfig substrate work landed in the same commit as Task 2's `native_tools.rs` shim (`c4b0af5`). Root cause: when Task 2 ran `git add src-tauri/src/native_tools.rs && git commit`, `config.rs` was already in the staged index from a parallel/prior 33-01 executor (`config.rs` was working-tree-modified before Plan 33-02 started; `git status` at the start of Task 1 only showed pre-existing planning-doc deletions, not config.rs as modified — it must have been staged in the index already). Plan 33-01 also separately landed its own SUMMARY commit `3a6bcf8`. Both plans' contracts are met independently:
- Plan 33-01 acceptance: 3 config tests green (`phase33_loop_config_default_values`, `phase33_loop_config_missing_in_disk_uses_defaults`, `phase33_loop_config_round_trip`) — verified.
- Plan 33-02 acceptance: 6 tests green (5 loop_engine + 1 native_tools) — verified.
- The orchestrator brief acknowledges parallel-plan merge handling: "If you both write to lib.rs, that's a merge conflict that the orchestrator handles." Bundling here is the analogous index-state condition for non-conflicting parallel work.

**No correctness deviations.** ToolError shape, render_for_model contract, enrich_alternatives entry count, wrap_legacy_error empty-alternatives semantics, and module-boundary discipline (no Tauri commands, no per-tool migration, no existing tool signature changes) all match the plan verbatim.

## Issues Encountered

- **Cold-cache cargo recompile latency.** First `cargo check` 6m21s; first `cargo test --lib` 15m16s; second `cargo check` 2m41s; second `cargo test --lib` 3m05s. CLAUDE.md's "batch first, check at end" guidance honored — one cargo check + one cargo test per task.
- **Index pre-stage from parallel 33-01.** Detected only AFTER Task 2 commit landed (via `git show --stat HEAD` showing `src-tauri/src/config.rs | 160 +++++++`). Documented under Deviations; no action required (the work is correct, just bundled across plan boundaries).
- **No CLAUDE.md hard-rule violations.** Verified: no `git add -A` (specific paths only); no Co-Authored-By lines; `safe_slice` not needed in this plan (no user-content slicing — that's Plan 33-04's surface); Tauri command namespace clean (zero new commands); `mod loop_engine;` registered in lib.rs.

## User Setup Required

None — pure Rust additions, no external service configuration, no env vars, no keychain entries, no migrations. Substrate-only plan; behavior begins in Wave 2 (Plan 33-03 onward).

## Next Phase Readiness

**Wave 2 (Plan 33-03 — loop body refactor) can mount on this scaffolding immediately:**

- `loop_engine::LoopState::default()` is the construct point for the per-call state struct.
- `loop_engine::LoopHaltReason` is the return type for `pub async fn run_loop(...)` that 33-03 introduces; commands.rs pattern-matches each variant per the sketch in 33-RESEARCH.md §Implementation Sketches.
- `LoopState::record_action` is ready for 33-04's verification-probe context build.
- `loop_engine::enrich_alternatives` is ready for 33-05's same-tool-failure trigger to consult on the 3rd consecutive failure.
- `native_tools::wrap_legacy_error` is ready for 33-05 to call at the boundary where every legacy `Err(String)` enters the loop conversation.
- `loop_engine::ToolError::render_for_model` is the call site 33-05 / 33-09 will inject into the conversation as the tool-failure message body.

**Wave 3 plans (33-06 truncation, 33-07 fast-path supplement, 33-08 cost-guard, 33-09 fallback discipline)** consume the same scaffolding without reopening loop_engine.rs's existing type declarations — they only ADD helpers (detect_truncation, escalate_max_tokens, build_fast_path_supplement, catch_unwind wrappers).

**No blockers.** STATE.md / ROADMAP.md updates are the orchestrator's responsibility (per the executor brief "Do NOT modify STATE.md or ROADMAP.md").

## Self-Check: PASSED

Verified post-summary:

- File `src-tauri/src/loop_engine.rs` exists (FOUND, 278 lines)
- File `src-tauri/src/lib.rs` contains `mod loop_engine;` (FOUND, count = 1)
- File `src-tauri/src/native_tools.rs` contains `pub fn wrap_legacy_error` (FOUND, count = 1)
- All 4 type declarations present in loop_engine.rs (LoopState / LoopHaltReason / ToolError / ActionRecord — counts each = 1)
- `pub fn enrich_alternatives` present (count = 1) with 10 entries (count of `" => vec![` = 10)
- `pub fn render_for_model` present (count = 1)
- `#[tauri::command]` count in loop_engine.rs = 0 (CONTEXT lock §Module Boundaries — Phase 33 adds NO Tauri commands)
- `crate::loop_engine::ToolError` references in native_tools.rs = 2 (function signature + body)
- Commit `d69aa81` exists in `git log` (FOUND, "feat(33-02): scaffold loop_engine.rs ...")
- Commit `c4b0af5` exists in `git log` (FOUND, "feat(33-02): add wrap_legacy_error shim ...")
- `cargo test --lib phase33` shows 9 passed, 0 failed
- `cargo check` exits 0 (warnings only — `enrich_alternatives is never used` is expected for substrate plan)
- No files deleted in either task commit

---
*Phase: 33-agentic-loop*
*Completed: 2026-05-05*
*Links: [33-02-PLAN.md](33-02-PLAN.md) · [33-CONTEXT.md](33-CONTEXT.md) · [33-RESEARCH.md](33-RESEARCH.md) · Plan 33-03 (loop body refactor) is the immediate Wave 2 consumer*
