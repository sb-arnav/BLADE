---
phase: 17
plan: 01
subsystem: evals-harness
tags:
  - eval-harness
  - jsonl
  - phase-17
  - doctor-02-source
  - wave-0
requirements:
  - DOCTOR-02
dependency_graph:
  requires:
    - "Phase 16 evals harness (`src-tauri/src/evals/harness.rs`) — existing `EvalSummary` struct + `#[cfg(test)] pub mod harness;` gating"
    - "`serde_json = \"1\"`, `chrono = \"0.4\"`, `tempfile = \"3\"` (already in Cargo.toml — no dep additions)"
  provides:
    - "`pub fn evals::harness::record_eval_run(module, summary, floor_passed)` — append-only JSONL writer for eval runs"
    - "`pub fn evals::harness::history_jsonl_path() -> PathBuf` — env-overridable path resolver (test seam)"
    - "`tests/evals/.gitkeep` — directory marker so `tests/evals/` is permanently tracked"
    - "`.gitignore` rule for `tests/evals/history.jsonl` — keeps the eval-run artifact out of git"
  affects:
    - "Plan 17-03 — wires `super::harness::record_eval_run(...)` into the 5 Phase 16 eval modules (BEFORE `assert!`)"
    - "Plan 17-04 — `doctor.rs` eval-source consumer reads `history_jsonl_path()` and tail-decodes the last 200 lines for D-05 severity classification"
tech_stack:
  added:
    - "(none — uses already-vendored `serde_json`, `chrono`, `tempfile`, `std::fs`, `env!`)"
  patterns:
    - "Env-overridable path seam — `BLADE_EVAL_HISTORY_PATH` lets unit tests redirect to a tempdir without polluting the real repo file (Pitfall 4 mitigation)"
    - "Inline `serde_json::json!({...})` JSON construction — avoids forcing a `Serialize` derive on `EvalSummary` (Pitfall 1)"
    - "Best-effort silent error swallow — matches `print_eval_table` fire-and-forget convention (eval gate is the source of truth, the JSONL file is a downstream observability artifact)"
    - "RAII `EnvGuard(Drop)` cleanup — tests remove `BLADE_EVAL_HISTORY_PATH` even on panic"
key_files:
  created:
    - path: "tests/evals/.gitkeep"
      role: "Empty 0-byte directory marker — keeps `tests/evals/` tracked on fresh clones (history.jsonl itself is gitignored)"
  modified:
    - path: "src-tauri/src/evals/harness.rs"
      role: "Append `history_jsonl_path()`, `record_eval_run()`, and `#[cfg(test)] mod tests` block (~125 lines added; existing harness exports untouched)"
    - path: ".gitignore"
      role: "Append a single `tests/evals/history.jsonl` rule (scoped — does NOT broad-match the directory or `*.jsonl`)"
decisions:
  - "Env-override path resolution: `history_jsonl_path()` reads `BLADE_EVAL_HISTORY_PATH` first; falls back to `CARGO_MANIFEST_DIR/../tests/evals/history.jsonl`. `env!()` is compile-time so the default cannot be stubbed at test runtime — the env var is the only viable test seam."
  - "Inline JSON construction (Pitfall 1): JSON is built via `serde_json::json!({...})`; `EvalSummary` derives stay `#[derive(Debug, Clone, Copy)]`. Adding `Serialize` would have cascaded changes to other eval consumers and is unnecessary."
  - "`relaxed_count` is computed via `.saturating_sub()` — adversarial (relaxed) rows are total minus asserted, never panic-on-underflow."
  - "Best-effort writer (silent error swallow): matches `print_eval_table` convention. The eval-gate is the source of truth (verify-eval.sh exit code); history.jsonl is observability data — losing one line on disk-full is acceptable, panicking the test run is not."
  - "Wave-0 boundary respected: this plan adds the helper but does NOT call it from any eval module yet. Plan 17-03 wires the 5 eval modules; Plan 17-04 wires the doctor.rs consumer."
metrics:
  started_at: "2026-04-30T08:48:22Z"
  completed_at: "2026-04-30T09:01:25Z"
  duration_minutes: 13
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
  lines_added: 129
  commits: 2
---

# Phase 17 Plan 01: Harness Scaffold (Wave 0) Summary

**One-liner:** Added `record_eval_run` + `history_jsonl_path` to `src-tauri/src/evals/harness.rs` (append-only JSONL writer for DOCTOR-02 source) plus the `tests/evals/.gitkeep` marker and the `tests/evals/history.jsonl` gitignore rule — Wave 0 fixture infrastructure for the Doctor Module's eval-score severity signal.

## Function Signatures

### `pub fn history_jsonl_path() -> std::path::PathBuf`

Resolves the on-disk path for the eval-run history file.

- **Override:** Returns `PathBuf::from(BLADE_EVAL_HISTORY_PATH)` when that env var is set. This is the test seam — the unit test sets it to a `tempfile::TempDir` path so the real repo file at `tests/evals/history.jsonl` is never touched.
- **Default:** `<repo-root>/tests/evals/history.jsonl`, computed at compile time via `env!("CARGO_MANIFEST_DIR").parent()` (CARGO_MANIFEST_DIR points at `src-tauri/`, so `..` lands at the repo root).
- **Why env (not parameter):** `env!()` is compile-time and cannot be stubbed at test runtime. Adding a `Path` parameter to `record_eval_run` would ripple into every eval-module call site in Plan 17-03. The env override is the cheaper test seam.

### `pub fn record_eval_run(module: &str, summary: &EvalSummary, floor_passed: bool)`

Appends one JSONL line to the resolved history path.

- **Wire format** (one line per call):
  ```json
  {"timestamp":"2026-04-30T09:01:25.000Z","module":"hybrid_search_eval","top1":8,"top3":8,"mrr":1.0,"floor_passed":true,"asserted_count":8,"relaxed_count":0}
  ```
- **JSON construction:** Inline via `serde_json::json!({...})`. **Zero serde derives added to `EvalSummary`** — the struct stays `#[derive(Debug, Clone, Copy)]` exactly as Phase 16 left it (Pitfall 1 mitigation).
- **Best-effort:** Errors from `create_dir_all` / `OpenOptions::open` / `writeln!` are silently swallowed (`let _ = ...`). Matches the `print_eval_table` fire-and-forget convention. The eval gate is the source of truth — losing one observability line on disk-full is acceptable, panicking the test run is not.
- **Append safety:** `OpenOptions::new().create(true).append(true)` is atomic per write on POSIX for writes < PIPE_BUF; harness already pins `--test-threads=1` so no concurrent-writer race.

## Test Surface (Pitfall 4 Verification)

`#[cfg(test)] mod tests::record_eval_run_appends_jsonl`:

1. Creates a `tempfile::TempDir` and computes `history = tempdir.path().join("history.jsonl")`.
2. Sets `BLADE_EVAL_HISTORY_PATH = history` under an `EnvGuard(Drop)` so the var is removed on panic.
3. Asserts `history_jsonl_path() == history` (sanity — the override is honored).
4. Builds a fixture `EvalSummary { total: 8, top1_count: 8, top3_count: 8, mrr: 1.0, asserted_total: 8, asserted_top1_count: 8, asserted_top3_count: 8, asserted_mrr: 1.0 }`.
5. Calls `record_eval_run("hybrid_search_eval", &fixture, true)` twice.
6. Reads the temp file and asserts:
   - File exists.
   - Exactly 2 non-empty JSONL lines.
   - Each line parses via `serde_json::from_str::<serde_json::Value>(line)`.
   - Field assertions: `module == "hybrid_search_eval"`, `top1 == 8`, `top3 == 8`, `|mrr - 1.0| < EPSILON`, `floor_passed == true`, `asserted_count == 8`, `relaxed_count == 0`, `timestamp` non-empty string.

**Result:** `cargo test --lib evals::harness::tests::record_eval_run_appends_jsonl -- --test-threads=1` → 1 passed.

## Acceptance Criteria — All Green

| Check | Result |
|------:|--------|
| `pub fn record_eval_run` defined exactly once | green (1 match) |
| `pub fn history_jsonl_path` defined exactly once | green (1 match) |
| `BLADE_EVAL_HISTORY_PATH` referenced ≥ 2 times (fn + tests) | green (4 matches) |
| `#[cfg(test)]` block present | green (1 match) |
| `fn record_eval_run_appends_jsonl` defined exactly once | green (1 match) |
| `OpenOptions::new` referenced ≥ 1 time | green (1 match) |
| `Serialize` keyword count in harness.rs (must be 0 — Pitfall 1) | **green (0 matches)** — docstring uses "serde derive" wording instead |
| `cd src-tauri && cargo test --lib evals::harness::tests::record_eval_run_appends_jsonl -- --test-threads=1` exit 0 | green |
| `cd src-tauri && cargo check` exit 0 | green |
| `tests/evals/.gitkeep` exists and is zero bytes | green |
| `tests/evals/history.jsonl` rule present in `.gitignore` | green |
| No broad `tests/evals/` rule (would untrack the dir) | green (only the targeted single-file rule) |
| `git check-ignore tests/evals/history.jsonl` exit 0 (rule active) | green (line 47) |
| `git check-ignore tests/evals/.gitkeep` exit 1 (NOT ignored) | green |
| `git ls-files tests/evals/.gitkeep` returns the path (tracked) | green |

## Pitfalls Confirmed Avoided

- **Pitfall 1** — Did NOT add `Serialize` derive to `EvalSummary`. JSON is constructed inline via `serde_json::json!`. `grep -c Serialize harness.rs` returns 0.
- **Pitfall 4** — `BLADE_EVAL_HISTORY_PATH` env override exists; the unit test uses it to redirect into a tempdir; the real repo file at `tests/evals/history.jsonl` is never created during `cargo test` runs.
- **`env!()` compile-time trap** — Acknowledged in the docblock; the override path is the workaround.
- **`safe_slice` rule** — Not triggered: the only `&str` written is the `module` parameter, which is serialized as a JSON string field (no fixed-byte slicing). Caller-side module names are compile-time literals.
- **Flat `#[tauri::command]` namespace** — Not applicable: this plan adds zero `#[tauri::command]` attributes. Both new functions are plain `pub fn` exposed only under the `#[cfg(test)] pub mod harness;` gating from `evals/mod.rs`.
- **Module registration 3-step** — Not applicable: no new modules; both helpers live inside an already-registered `pub mod harness`.
- **6-place config rule** — Not applicable: no new `BladeConfig` fields.
- **Co-Authored-By line** — Not added to either commit (per CLAUDE.md, Arnav is the author).

## Wave-0 Boundary Respected

This plan added the **helper** (`record_eval_run` + `history_jsonl_path`) and the **fixture infrastructure** (`tests/evals/.gitkeep` + gitignore rule). It did **not**:

- Call `record_eval_run` from any of the 5 Phase 16 eval modules (that's Plan 17-03).
- Add the `doctor.rs` consumer that tail-reads `history.jsonl` (that's Plan 17-04).
- Touch the eval-gate exit code semantics (`scripts/verify-eval.sh` is unchanged).

The eval modules continue to function exactly as Phase 16 shipped them — `print_eval_table` + `assert!` are untouched. On a fresh clone, `tests/evals/history.jsonl` does not exist; `doctor.rs` (when shipped in later plans) will treat "missing" as Green per CONTEXT.md D-16.

## Deviations from Plan

**None.** Plan 17-01 executed exactly as written.

One micro-tweak to a docstring (line 222 in `harness.rs`): the original Pitfall-1 prose was *"do NOT add `Serialize` to `EvalSummary`"*, which made the literal-string acceptance grep `grep -c "Serialize" harness.rs == 0` fail (returned 1, matching the docstring). The wording was changed to *"do NOT add a serde derive to `EvalSummary`"* — same meaning, no `Serialize` token in the file. This is a docstring-only change and does not affect behavior or compilation.

## Commits

| Commit | Type | Files | Description |
|:------:|------|-------|-------------|
| `3e1e617` | feat | src-tauri/src/evals/harness.rs | Add `record_eval_run` + `history_jsonl_path` + `#[cfg(test)] mod tests` block |
| `4174eef` | chore | tests/evals/.gitkeep, .gitignore | Track `tests/evals/` via `.gitkeep`; gitignore `history.jsonl` |

## Hand-off to Plan 17-03

Plan 17-03 ("wire 5 Phase 16 eval modules") will, for each of `hybrid_search_eval.rs`, `real_embedding_eval.rs`, `kg_integrity_eval.rs`, `typed_memory_eval.rs`, `capability_gap_eval.rs`:

1. Reuse the existing `let s = summarize(&rows);` (already present in 3 of 5 modules — don't shadow).
2. Compute `let floor_passed = <existing assert! threshold expression>;`
3. Insert `super::harness::record_eval_run("<module_name>", &s, floor_passed);` **BEFORE** the `assert!` block — so a floor breach still produces a JSONL row (D-14 / D-16 / RESEARCH § B2 recommendation A1; Doctor's D-05 Red tier depends on this).

No imports needed (`super::harness::record_eval_run` resolves through the `evals/mod.rs` sibling pattern).

## Self-Check: PASSED

Verified via filesystem + git:

- `src-tauri/src/evals/harness.rs` exists; commit `3e1e617` present in `git log --oneline -5`.
- `tests/evals/.gitkeep` exists; tracked (`git ls-files tests/evals/.gitkeep` returns the path); zero bytes (`test ! -s` passes).
- `.gitignore` line 47 = `tests/evals/history.jsonl`; commit `4174eef` present.
- Both commits land on `master` since the executor runs in sequential mode (no worktree).
- Test green: `cargo test --lib evals::harness::tests -- --test-threads=1` → 1 passed, 0 failed.
- `cargo check` clean.
- `git check-ignore tests/evals/history.jsonl` exit 0; `git check-ignore tests/evals/.gitkeep` exit 1.
