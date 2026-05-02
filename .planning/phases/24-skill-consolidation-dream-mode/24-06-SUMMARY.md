---
phase: 24-skill-consolidation-dream-mode
plan: 06
subsystem: skills
tags: [cli, skill_validator, subcommands, dream-04, phase-24, rust]

# Dependency graph
requires:
  - phase: 21-skills-v2-agentskills
    provides: skill_validator binary (Plan 21-04 commit 2aaef13) + verify:skill-format chain (Plan 21-07 — scripts/verify-skill-format.sh)
  - phase: 24-skill-consolidation-dream-mode (Plan 24-03)
    provides: SkillRef + list_skills_snapshot() aggregator + SessionHandoff.skills_snapshot field + per-session archive at <config_dir>/sessions/<id>.json
provides:
  - skill_validator CLI extended with subcommand dispatcher (validate / list)
  - run_validate / run_list / run_list_diff as pub fn for unit testing
  - list emits 4-bucket text (forged / bundled / user / archived) via list_skills_snapshot
  - list --json emits structured 4-bucket JSON in fixed iteration order
  - list --diff <session_id> reads <config_dir>/sessions/<id>.json and emits 3-bucket diff (added / archived / consolidated)
  - blade_lib::config + blade_lib::session_handoff visibility bumped to pub mod (non-breaking — only new consumer is the bin in same crate)
affects: [24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-rolled subcommand dispatcher — args.get(1) match on subcommand keyword + back-compat alias arm that falls through to legacy run_validate when args[1] is anything other than 'validate' / 'list' / '-h' / '--help'. No clap dep."
    - "pub fn handler exposure — run_validate / run_list / run_list_diff exposed as pub fn so the #[cfg(test)] mod tests can drive them programmatically without spawning subprocesses, while main() keeps a thin dispatch shell."
    - "Visibility bump for cross-bin reach — `mod config` and `mod session_handoff` promoted to `pub mod` in lib.rs so the skill_validator bin (a separate crate target) can reach `blade_lib::config::blade_config_dir()` and `blade_lib::session_handoff::SessionHandoff` without re-exporting symbols at lib root."

key-files:
  created: []
  modified:
    - src-tauri/src/bin/skill_validator.rs (full rewrite — 470 line insertions, 28 deletions; subcommand dispatcher + run_list + run_list_diff + 3 CLI integration tests; preserves all existing run_validate logic verbatim under a pub fn wrapper)
    - src-tauri/src/lib.rs (2 visibility bumps — `mod config` → `pub mod config`, `mod session_handoff` → `pub mod session_handoff`; non-breaking; comments cite Phase 24 plan justification inline)

key-decisions:
  - "Back-compat dispatch widened from 'positional path only' to 'any args[1] not matching subcommand keywords falls through to run_validate'. The plan's <action> block specified `Some(p) if !p.starts_with(\"--\") => run_validate(&args[1..])` (positional only) but Plan 21-07's verify-skill-format.sh invokes `skill_validator --recursive <root>` (flag-first form). Tested empirically: with the strict-positional dispatch, the verify chain failed with `[verify:skill-format] FAIL: 1 skill(s) failed validation (out of 0)`. Widening to `Some(_) => run_validate(&args[1..])` (catch-all non-keyword) restored the chain to green (3 bundled skills validated). This is a Rule 1 deviation (back-compat invariant violation in the plan's verbatim dispatch) — the substantive truth (back-compat preserved) is met."
  - "Visibility bump applied to `mod config` AND `mod session_handoff` in lib.rs. The plan's <action> block hinted at this as a non-breaking add but only called out blade_config_dir explicitly; the actual compile failure surfaced both. Bumped both with inline comments citing Phase 24 plan."
  - "Test posture: 3 tests assert via the public Rust surface (snapshot Vec<SkillRef> equality + parsed JSON value tree + run_list/run_list_diff exit-code assertions) rather than capturing stdout. Verbatim per the plan's <action> note: 'Stdout capture in cargo test is fragile across platforms; we re-derive the buckets here to assert correctness.' Same posture as Plan 24-03's loader/session_handoff tests."
  - "The plan's verbatim test bodies were preserved 1:1, including the inline `assert!(current_names.contains(\"foo_bar_merged\") && !prior_names.contains(\"foo_bar_merged\"))` in list_diff_categorizes — the diff buckets are derived from the same set-difference logic that run_list_diff itself uses, so the test exercises the diff invariants without parsing CLI stdout."
  - "No clap dep added (Cargo.toml unchanged). Verified via `grep -q 'clap' src-tauri/Cargo.toml` returning non-zero. Hand-rolled args parsing pattern from 24-PATTERNS.md §'Cargo binary subcommand pattern' followed verbatim — args iterator, while-let-Some(arg) loop, match on arg.as_str() including the `--diff` two-arg pull via `iter.next()`."

patterns-established:
  - "Pattern: Subcommand dispatcher with back-compat catch-all — when extending an existing CLI binary that already has callers depending on a flat positional invocation, the dispatch arm for back-compat must be a CATCH-ALL on non-keyword args[1] (`Some(_) => legacy_handler(&args[1..])`), not a positional-only arm (`Some(p) if !p.starts_with(\"--\")`). Otherwise legacy `--flag <path>` invocations break. The verify:skill-format.sh script which calls `skill_validator --recursive <root>` is the canary that exposed this."
  - "Pattern: Cross-bin module visibility — when a binary in `src/bin/` needs to reach internal lib modules, bump those modules from `mod` to `pub mod` in `lib.rs` rather than re-exporting individual symbols at lib root. Single line change, comment-anchored to the consuming plan, non-breaking for internal callers."

requirements-completed: [DREAM-04]

# Metrics
duration: ~232 min (dominated by 1 cargo build cold-build at ~8m + 1 cargo test rebuild at ~40s + verify chain rebuild + intermittent IO)
completed: 2026-05-02
---

# Phase 24 Plan 06: skill_validator list / list --diff / list --json Subcommands Summary

**DREAM-04 success criterion locked end-to-end. `skill_validator list --diff <session_id>` now reads `<config_dir>/sessions/<id>.json` (Plan 24-03 archive) + walks the live `list_skills_snapshot()` (Plan 24-03 aggregator) + emits a 3-bucket diff (added / archived / consolidated). The Plan 21-07 `verify:skill-format` chain stays green — back-compat preserved.**

## Performance

- **Duration:** ~232 min (started 2026-05-01T22:06:01Z; completed 2026-05-02T01:58:25Z)
- **Tasks:** 1 (autonomous; per the plan's single-task structure)
- **Files modified:** 2 (`src-tauri/src/bin/skill_validator.rs` + `src-tauri/src/lib.rs`)
- **Tests added:** 3 CLI integration tests in `#[cfg(test)] mod tests`
- **Commits:** 1 atomic Task 1 + 1 docs (this summary commit)

## Accomplishments

- **DREAM-04 CLI surface landed.** `skill_validator list` emits the 4-bucket text view; `--json` emits structured JSON in fixed iteration order (`forged → bundled → user → archived`); `--diff <session_id>` reads the prior snapshot and emits the 3-bucket diff. The substrate from Plan 24-03 (SkillRef + list_skills_snapshot + SessionHandoff.skills_snapshot + per-session archive) is now consumed end-to-end.
- **Subcommand dispatcher with back-compat catch-all.** Positional `skill_validator <path>` AND legacy flag-prefixed forms (`--recursive <root>`, `--json <path>`) both fall through to `run_validate` so Plan 21-07's `scripts/verify-skill-format.sh` chain keeps validating bundled + workspace skills. Validated empirically — see Decisions below.
- **3 CLI integration tests green.** `list_subcommand_text_format`, `list_subcommand_json_format`, `list_diff_categorizes` all pass via `cargo test --bin skill_validator -- --test-threads=1` (`3 passed; 0 failed; finished in 0.11s`). Tests exercise the public Rust surface (Vec<SkillRef> equality + serde_json parse + run_list/run_list_diff exit codes) rather than stdout capture, matching Plan 24-03's posture.
- **No new dependency.** Cargo.toml unchanged. `clap` stays absent. Hand-rolled args parsing per 24-PATTERNS.md §"Cargo binary subcommand pattern" — single args iterator + match on arg.as_str() + iter.next() pull for the `--diff` two-arg form.
- **Non-breaking visibility bump.** `mod config` → `pub mod config` and `mod session_handoff` → `pub mod session_handoff` in `lib.rs`. Both modules were already accessed by other in-crate callers via `crate::config::*` / `crate::session_handoff::*`; the bump only affects external (bin) reach. Inline comments cite Phase 24 plan justification.
- **`cargo build --lib` clean post-plan.** 2 warnings, both carry-forward (`dream_mode::last_activity_ts` awaits Plan 24-07 wiring + long-standing `reward.rs:236 timestamp_ms`). No NEW warnings introduced by this plan.
- **Plan 21-07 `verify:skill-format` chain green post-plan.** `bash scripts/verify-skill-format.sh` reports `OK: 3 skill(s) validated` (3 bundled exemplars: troubleshoot-cargo-build / git-status-summary / format-clipboard-as-markdown). Back-compat invariant proven.

## Task Commits

1. **Task 1 — skill_validator subcommand dispatcher + list / list --diff / list --json + 3 CLI integration tests** — `260a5f6` (feat)

## Files Created/Modified

- **`src-tauri/src/bin/skill_validator.rs`** — full rewrite of the dispatch shell + new run_list / run_list_diff handlers + #[cfg(test)] mod tests. Net +470 / -28 lines. The existing run_validate body (validate single dir + --recursive walk + --json emit + emit_human + emit_json + finding_json + json_string helpers) is preserved verbatim under a pub fn wrapper. Header doc comment updated to enumerate all 5 invocation forms (validate / validate --recursive / positional alias / list / list --diff).
- **`src-tauri/src/lib.rs`** — 2 single-token edits: `mod config;` → `pub mod config;` (line 57) and `mod session_handoff;` → `pub mod session_handoff;` (line 20). Each bump comment-anchored to "Phase 24 v1.3 — pub for skill_validator bin" so future readers can trace the visibility decision back to this plan.

## Decisions Made

- **Back-compat dispatch widened from positional-only to catch-all non-keyword.** The plan's <action> block specified `Some(p) if !p.starts_with("--") => run_validate(&args[1..])` which restricts the back-compat alias to positional path-first invocations (e.g. `skill_validator /path/to/skill`). Empirically that broke Plan 21-07's `scripts/verify-skill-format.sh` which calls `skill_validator --recursive <root>` (flag-first). The first cargo build + verify run revealed `[verify:skill-format] FAIL: 1 skill(s) failed validation (out of 0)` because `--recursive` hit `usage_error()` instead of `run_validate`. Widened to `Some(_) => run_validate(&args[1..])` (any non-keyword args[1] falls through). Re-ran the chain — `OK: 3 skill(s) validated`. This is a Rule 1 deviation (the plan's verbatim dispatch broke a load-bearing invariant the plan itself locked). Substantive truth — back-compat preserved — is met.
- **Visibility bump on `mod session_handoff` AND `mod config`.** The plan's <action> hint mentioned `blade_config_dir` only; the actual compile failure E0603 surfaced both `blade_lib::config` and `blade_lib::session_handoff` as private. Single-token bump on each in `lib.rs`. Non-breaking — internal callers use `crate::config::*` / `crate::session_handoff::*` which are unaffected by `pub mod` vs `mod` for in-crate reach.
- **Test exit-code comparison via `format!("{:?}", exit)` rather than direct equality.** `std::process::ExitCode` doesn't implement `PartialEq` so direct `assert_eq!(exit, ExitCode::SUCCESS)` won't compile. The verbatim test body uses `format!("{:?}", exit)` Debug-string comparison which works on both ExitCode::SUCCESS (Debug = "ExitCode(unix_exit_status(0))" or platform equivalent) and the failure variants. Same posture for both list_subcommand tests and list_diff_categorizes.
- **No new dependency added.** Verified via `grep -q 'clap' src-tauri/Cargo.toml` returning non-zero. The dispatch is hand-rolled — single Vec<String>::collect() of args, match on args.get(1).map(|s| s.as_str()), and within each handler an args iterator with while-let-Some(arg) + match on arg.as_str(). The `--diff` two-arg form pulls the next arg via `iter.next()` and validates with a clean `eprintln! + ExitCode::from(2)` on missing.
- **Test data seeding via direct rusqlite + serde_json — no production helpers used.** The 3 tests seed forged_tools rows via raw `CREATE TABLE IF NOT EXISTS` + `INSERT` (not `tool_forge::register_forged_tool`) to avoid pulling the LLM-fixture path into the test. SKILL.md skills are seeded via raw `fs::write` of literal frontmatter strings. Same posture as Plan 24-03's loader tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Back-compat alias too narrow — verify:skill-format chain broken**
- **Found during:** Task 1 verification (running `bash scripts/verify-skill-format.sh` after the initial build)
- **Issue:** The plan's verbatim dispatch arm `Some(p) if !p.starts_with("--") => run_validate(&args[1..])` rejected `skill_validator --recursive <root>` (which Plan 21-07's verify chain invokes) because `--recursive` starts with `--`. The chain failed with `[verify:skill-format] FAIL: 1 skill(s) failed validation (out of 0)`.
- **Fix:** Widened the arm to `Some(_) => run_validate(&args[1..])` (any non-keyword args[1] falls through). Subcommand keywords (`validate` / `list` / `-h` / `--help`) are matched first, so legitimate subcommand routing isn't affected.
- **Files modified:** `src-tauri/src/bin/skill_validator.rs` (single match arm)
- **Commit:** Folded into Task 1 commit `260a5f6`

**2. [Rule 3 - Blocking] `mod session_handoff` was private — bin couldn't reach SessionHandoff**
- **Found during:** Task 1 first build
- **Issue:** The plan's <action> hint mentioned bumping `blade_config_dir` to `pub` if needed; the actual E0603 compile error surfaced both `mod config` and `mod session_handoff` as private. The bin requires both.
- **Fix:** Bumped both modules from `mod` to `pub mod` in `lib.rs` with inline comments citing Phase 24 plan justification. Non-breaking — internal `crate::*` callers unaffected.
- **Files modified:** `src-tauri/src/lib.rs` (2 single-token edits)
- **Commit:** Folded into Task 1 commit `260a5f6`

## Threat Surface Scan

Per the plan's `<threat_model>` block, the Phase 24-06 trust boundaries are:

| Boundary | Disposition | Mitigation in this plan |
|----------|-------------|-------------------------|
| skill_validator stdin args → CLI dispatcher (T-24-06-01) | mitigate | session_id is interpolated into a fixed `<config_dir>/sessions/{}.json` template — the `.json` suffix ensures the read target is always inside `<config_dir>/sessions/`. fs::read_to_string fails cleanly on non-existent; serde_json fails cleanly on non-JSON. No code execution surface. |
| skill_validator → <config_dir>/sessions/<id>.json (T-24-06-02) | accept | Reading operator's own session manifest is the entire point of the command. |
| skill_validator → forged_tools SQLite (T-24-06-03) | accept | Read-only via list_skills_snapshot → tool_forge::get_forged_tools (no INSERT/UPDATE/DELETE). |
| Hand-edited sessions/<id>.json injects fake skills_snapshot entries (T-24-06-04) | accept | Diff is observational; nothing acts on diff output without further operator input (Plan 24-07 apply path requires chat reply). |

No new threat surface introduced beyond the threat register. The visibility bump on `mod config` + `mod session_handoff` does NOT widen the external API surface — `blade_lib` exposes `staticlib` + `cdylib` + `rlib` per Cargo.toml, and the modules' public functions (`blade_config_dir()`, `SessionHandoff`) were already reachable inside the crate. Only the bin (a separate target in the same crate) gains read access.

## Acceptance Criteria

- [x] `cd src-tauri && cargo build --bin skill_validator` exits 0 (8m 8s cold-build; 2 warnings carry-forward)
- [x] `cd src-tauri && cargo test --bin skill_validator -- --test-threads=1` reports `3 passed; 0 failed; finished in 0.11s`
  - `tests::list_subcommand_text_format ... ok`
  - `tests::list_subcommand_json_format ... ok`
  - `tests::list_diff_categorizes ... ok`
- [x] `grep -q 'pub fn run_list' src-tauri/src/bin/skill_validator.rs` exits 0
- [x] `grep -q 'pub fn run_validate' src-tauri/src/bin/skill_validator.rs` exits 0
- [x] `grep -q 'pub fn run_list_diff' src-tauri/src/bin/skill_validator.rs` exits 0
- [x] `grep -q '"validate"' src-tauri/src/bin/skill_validator.rs` exits 0 (subcommand match)
- [x] `grep -q '"list"' src-tauri/src/bin/skill_validator.rs` exits 0
- [x] `grep -q '"--diff"' src-tauri/src/bin/skill_validator.rs` exits 0
- [x] `grep -q 'list_skills_snapshot' src-tauri/src/bin/skill_validator.rs` exits 0
- [x] Positional alias preserved — `Some(_) => run_validate(&args[1..])` catch-all dispatches anything non-keyword to validate
- [x] Plan 21-07 `verify:skill-format` chain green: `bash scripts/verify-skill-format.sh` reports `OK: 3 skill(s) validated`
- [x] No clap dep added — `grep -q 'clap' src-tauri/Cargo.toml` returns non-zero (`OK: clap absent`)
- [x] `cargo build --lib` clean — 2 warnings carry-forward, 0 errors

## Plan Output Verification

Per the plan's `<output>` block, this SUMMARY records:

(a) **Confirmation that positional `skill_validator <path>` still works (back-compat invariant).** Verified via `bash scripts/verify-skill-format.sh` returning `OK: 3 skill(s) validated`. The script invokes both `skill_validator --recursive <root>` (which my widened dispatch routes to run_validate) and `skill_validator <dir>` (positional — also routes to run_validate). Both forms exit 0 on valid skills.

(b) **The 3 test names verbatim:**
- `list_subcommand_text_format`
- `list_subcommand_json_format`
- `list_diff_categorizes`

(c) **Confirmation that `verify:skill-format` chain still passes.** `bash scripts/verify-skill-format.sh` exit 0 with `[verify:skill-format] OK: 3 skill(s) validated` (3 bundled exemplars). Back-compat invariant holds end-to-end.

## Issues Encountered

- **`cargo build --bin skill_validator` cold-build cost (~8m 8s).** First build after the file rewrite + lib.rs edit triggered a full rebuild. Same posture as Plan 24-02 / 24-03 / 24-04 / 24-05 — out of scope; cargo incremental cache cost dominated by upstream lib compilation, not the bin itself.
- **Plan-spec back-compat dispatch was too narrow.** Documented above as Rule 1 deviation. The plan's `<action>` block locked a positional-only catch-all (`Some(p) if !p.starts_with("--")`) that broke `--recursive` legacy invocations. Widened to non-keyword catch-all to preserve Plan 21-07 chain. The fix is mechanically minimal (single match arm guard removed) and substantively safer (every non-subcommand arg routes to validate, matching the original Plan 21-04 binary's behavior).
- **No deletions in commit.** `git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty for the Task 1 commit. Pre/post-commit deletion checks both green.

## Wave 3 Continuation Readiness

**Plan 24-07 (next plan in Wave 3) unblocked at 2 seams:**

1. **Operator-facing diff surface ready.** Once Plan 24-07's apply path lands chat-injected merge prompts (D-24-B), the operator can run `skill_validator list --diff <prev_session_id>` from terminal to audit which forged_tools were archived this dream cycle vs. consolidated vs. newly proposed. Diff buckets are deterministic — same prior + current snapshot pair always produces the same output.

2. **No new test infra needed for Plan 24-07.** The 3 CLI tests in this plan exercise the canonical seam (`run_list` / `run_list_diff` as `pub fn`); Plan 24-07's apply path (commands.rs side) tests the chat-injection + decision_gate routing, which is orthogonal to this CLI surface.

**DREAM-04 marked complete in REQUIREMENTS by this plan** (frontmatter `requirements: [DREAM-04]`). The CLI body is the load-bearing surface; the substrate (snapshot + archive) was Plan 24-03 scope.

---
*Phase: 24-skill-consolidation-dream-mode*
*Completed: 2026-05-02*

## Self-Check: PASSED

Verified before final commit:

- File `src-tauri/src/bin/skill_validator.rs` contains `pub fn run_validate` + `pub fn run_list` + `pub fn run_list_diff` + `"validate"` + `"list"` + `"--diff"` + `list_skills_snapshot` — confirmed via grep
- File `src-tauri/src/lib.rs` contains `pub mod config` + `pub mod session_handoff` — confirmed via grep
- Commit `260a5f6` exists in `git log --oneline` — confirmed (Task 1)
- `cargo build --bin skill_validator` exits 0 (2 carry-forward warnings, 0 errors) — confirmed
- `cargo test --bin skill_validator -- --test-threads=1` reports `3 passed; 0 failed; finished in 0.11s` — confirmed
- `cargo build --lib` exits 0 (2 carry-forward warnings, 0 errors) — confirmed
- `bash scripts/verify-skill-format.sh` reports `OK: 3 skill(s) validated` (Plan 21-07 back-compat invariant) — confirmed
- `grep -q 'clap' src-tauri/Cargo.toml` returns non-zero (no new dep added) — confirmed
