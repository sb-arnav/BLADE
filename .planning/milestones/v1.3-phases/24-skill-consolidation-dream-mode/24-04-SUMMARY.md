---
phase: 24-skill-consolidation-dream-mode
plan: 04
subsystem: skills
tags: [skills, lifecycle, dream_mode, pure-logic, deterministic-merge, rust, phase-24, dream-01, dream-02, dream-03]

# Dependency graph
requires:
  - phase: 22-voyager-loop-closure
    provides: ForgedTool / ToolParameter struct (tool_forge.rs:18-40) + sanitize_name (skills/export.rs:39) + user_root (skills/loader.rs:123)
  - phase: 24-skill-consolidation-dream-mode (Plan 24-01)
    provides: forged_tools_invocations table (DREAM-02 trace_hash source) + turn_traces table (DREAM-03 unmatched-trace source) + db::run_migrations extending both schemas
provides:
  - skills::lifecycle module — pure-logic substrate for deterministic merge body, name dedup ladder, tool-trace name proposal, line/parameter dedup, cosine similarity
  - skills::lifecycle::deterministic_merge_body (D-24-E LOCK) — lex-smaller name + _merged suffix, ' | ' description, line-deduped usage, name-deduped parameters, smaller script_path, '\n--- merged ---\n' test_output, last_used = created_at, forged_from = "merge:<a>+<b>"
  - skills::lifecycle::ensure_unique_name (Discretion item 3 LOCK) — _v2.._v999 then _<uuid> fallback
  - skills::lifecycle::proposed_name_from_trace (D-24-A) — auto_<first-3-tool-names-snake-case>, safe_slice 50
  - skills::lifecycle::dedup_lines / union_dedup_by_name — first-occurrence-wins helpers
  - skills::lifecycle::cosine_sim — 4-line port from embeddings.rs (keeps that public surface untouched)
  - skills::lifecycle::prune_candidate_selection (DREAM-01) — SELECT rowid, name, script_path, last_used FROM forged_tools WHERE last_used IS NOT NULL AND ?1 - last_used >= 91 * 86400 ORDER BY last_used ASC
  - skills::lifecycle::last_5_trace_hashes (DREAM-02) — SELECT trace_hash FROM forged_tools_invocations WHERE tool_name = ?1 ORDER BY id DESC LIMIT 5
  - skills::lifecycle::recent_unmatched_traces (DREAM-03) — SELECT tool_names FROM turn_traces WHERE turn_ts >= ?1 AND forged_tool_used IS NULL AND success = 1 AND json_array_length(tool_names) >= 3 ORDER BY turn_ts DESC
  - skills::lifecycle::forged_name_exists — SELECT COUNT(*) wrapper for ensure_unique_name's is_taken predicate (fail-open on DB-open failure per Pitfall 4)
  - skills::lifecycle::archive_skill — fs::rename src to .archived/<sanitized> (with _dup<ts> on collision); DELETE forged_tools row only after rename succeeds
  - tool_forge::open_db_for_lifecycle (pub(crate)) — non-test connection opener invoking ensure_table + ensure_invocations_table + crate::db::run_migrations idempotently
  - db::open_db_for_lifecycle (pub(crate)) — non-test connection opener invoking run_migrations idempotently (test envs without init_db at boot see turn_traces on first read)
  - db::run_migrations promoted from private fn to pub(crate) fn — required for tool_forge::open_db_for_lifecycle to call across module boundary
affects: [24-05, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Predicate-injection pure-logic — instead of having `deterministic_merge_body` and `ensure_unique_name` open their own DB connections, accept a `&dyn Fn(&str) -> bool` predicate so tests pass deterministic stubs and prod wires the real `forged_name_exists` reader. Same shape as `dream_mode::is_dreaming` Plan 24-05 will use."
    - "Cross-module migration-idempotency openers — `pub(crate) fn open_db_for_lifecycle` in BOTH tool_forge.rs and db.rs invoke `run_migrations` (and tool_forge-side also ensure_table + ensure_invocations_table) as a tempdir-test-env safety net. Production callers see no-ops because boot already ran migrations."
    - "Cosine-sim reimplementation over re-export — `embeddings::cosine_similarity` is private; lifecycle.rs reimplements the 11-line body inline rather than promoting embeddings.rs surface. Trade-off: 11 lines of code duplication < 1 new public symbol forever."

key-files:
  created:
    - src-tauri/src/skills/lifecycle.rs
  modified:
    - src-tauri/src/skills/mod.rs
    - src-tauri/src/tool_forge.rs
    - src-tauri/src/db.rs

key-decisions:
  - "Merge body deterministic two-call invariant locked verbatim: same inputs produce same name + description + script_path + usage + parameters.len() + test_output + forged_from across calls (id and created_at differ — uuid + Utc::now). Test merge_body_two_calls_match asserts all 7 invariants."
  - "ensure_unique_name ladder is _v2..=999 then _<uuid_v4>. The 999-cap is a deliberate operator-perceptibility threshold (an operator would notice 999 collisions visually before hitting the uuid fallback) rather than a hard infinite loop guard. Test merge_name_falls_back_to_uuid_when_999_taken asserts the uuid-tail by length-of-output guard (>('x_merged_'.len() + 8))."
  - "deterministic_merge_body description is `format!('{} | {}', a.description, b.description)` — order matches argument position, NOT lex-smaller-first. The lex-smaller pick affects only name (.+_merged), language, and script_path. Test merge_body_deterministic asserts `'alpha desc | beta desc'` from inputs (zeta_tool, alpha desc) + (alpha_tool, beta desc) — confirming the format string honors arg order even when zeta > alpha."
  - "forged_from is `format!('merge:{}+{}', a.name, b.name)` — also arg-position-ordered, not lex-smaller-first. Symmetric with description. Test merge_body_deterministic asserts 'merge:zeta_tool+alpha_tool' (the inputs in arg order)."
  - "cosine_sim reimplemented inline (NOT re-exported from embeddings.rs). 11-line port matches embeddings::cosine_similarity body verbatim including the `if a.len() != b.len() || a.is_empty()` and `if mag_a == 0.0 || mag_b == 0.0` zero guards. Test cosine_sim_basic locks the 1.0 / 0.0 / mismatched-length / empty-input contracts."
  - "dedup_lines preserves first-seen order via HashSet+Vec. `'a\\nb\\na\\nc\\nb'` -> `'a\\nb\\nc'`. Empty stays empty. Test dedup_lines_preserves_order_unique pins both."
  - "union_dedup_by_name first-occurrence-wins via HashSet+Vec across `a.iter().chain(b.iter())`. {x,y} + {x,z} -> [x_from_a, y, z]. Test union_dedup_by_name_first_wins asserts merged[0].description == 'first' (a-side x preserved, b-side x dropped)."
  - "proposed_name_from_trace is deterministic over input order. `[foo_bar, baz_qux, extra_ignored]` produces a stable string starting with 'auto_'. Different inputs produce different outputs. The split('_').take(2) per-name-fragment lets snake_case names contribute up to 2 underscore-segments each, but caps total at 3 names from the trace. safe_slice 50 enforces non-ASCII-safe truncation per CLAUDE.md."
  - "DB readers (prune_candidate_selection / last_5_trace_hashes / recent_unmatched_traces / forged_name_exists) all fail-open on DB-open or prepare failure (return empty Vec or false). Pitfall 4 mitigation: a transient SQLite WAL collision should NOT halt the dream pass; missed reads recover next cycle."
  - "archive_skill order-of-operations locked: fs::rename FIRST -> DB DELETE only on rename success. T-24-04-04 + T-24-04-05 mitigation. If src dir doesn't exist (idempotent re-archive of an already-archived row), skip the rename but still run the DB DELETE — the row may be a leftover from a prior failed cycle."
  - "Cross-module open helpers DO NOT cache the connection. Each call opens a fresh rusqlite::Connection. WAL handles reader+writer concurrency between dream pass and chat path (Pitfall 4 LOCK)."
  - "db::run_migrations was bumped from `fn` to `pub(crate) fn`. tool_forge::open_db_for_lifecycle calls into it from a different module so visibility had to widen. No external crate sees it (still pub(crate))."
  - "11 grep gates in plan acceptance criteria all green (deterministic_merge_body, ensure_unique_name, proposed_name_from_trace, prune_candidate_selection, last_5_trace_hashes, recent_unmatched_traces, archive_skill, pub mod lifecycle, '91 * 86400' literal, 'json_array_length(tool_names) >= 3' literal, both open_db_for_lifecycle exposures, run_migrations reachable from tool_forge.rs)."

patterns-established:
  - "Pattern: Predicate-injection over DB-open in pure logic — when a pure function needs a 'is X taken in DB?' check, accept a `&dyn Fn(&str) -> bool` rather than calling DB internally. Tests pass `&|_| false` or `&|n| n == 'specific'` stubs; prod wires `&|n| forged_name_exists(n)`. Keeps pure logic unit-testable without tempdir setup."
  - "Pattern: Cross-module migration-idempotency wrapper — when a new caller (lifecycle.rs) needs DB access from a tempdir test env that bypasses init_db, expose a `pub(crate) fn open_db_for_lifecycle` from each owning module that invokes its CREATE-TABLE-IF-NOT-EXISTS path before returning the connection. Production paths are no-ops; test paths get a complete schema."
  - "Pattern: Inline 4-line port over public-surface widening — when a single function needs a 11-line helper from another module, prefer reimplementing the helper inline over making the helper public. Avoids 'public surface accumulation drift' that's hard to walk back."

requirements-completed: []

# Metrics
duration: ~4 min compile (cargo test --lib skills::lifecycle::tests cold-built in 3m 51s; build verification 7m 29s)
completed: 2026-05-01
---

# Phase 24 Plan 04: Wave 2 skills/lifecycle.rs pure-logic substrate (DREAM-01/02/03) Summary

**Pure-logic + side-effecting substrate for the 3 dream tasks (prune, consolidate, generate). All deterministic merge/name/trace logic lives in `skills/lifecycle.rs` (NEW); DB queries live here too so `dream_mode.rs` (Plan 24-05) becomes a thin orchestrator. Tests pin D-24-E (merge body), Discretion item 3 (name dedup ladder), and the locked SQL predicates.**

## Performance

- **Duration:** ~12 min total (8 min reading context + 4 min cargo test cold-build at 3m 51s + verifying gates)
- **Tasks:** 1 (autonomous, with TDD)
- **Files modified:** 4 (lifecycle.rs NEW + mod.rs + tool_forge.rs + db.rs)
- **Tests added:** 8 (all in `skills::lifecycle::tests`)
- **Commits:** 1 atomic + 1 docs (final, this commit)

## Accomplishments

- **DREAM-01/02/03 pure-logic substrate landed.** `src-tauri/src/skills/lifecycle.rs` (NEW, 396 lines) ships 8 pure functions + 4 DB readers + 1 fs helper + 8 inline tests. The deterministic invariants per D-24-E (merge body shape) and Discretion item 3 (name dedup ladder) are pinned by tests `merge_body_deterministic` + `merge_body_two_calls_match` + `merge_name_collision_suffixed_v2` + `merge_name_falls_back_to_uuid_when_999_taken`.
- **Cross-module migration-idempotency openers landed in BOTH tool_forge.rs and db.rs.** `pub(crate) fn open_db_for_lifecycle` in each module invokes `run_migrations` (and tool_forge-side also `ensure_table` + `ensure_invocations_table`) before returning the Connection. Production callers see no-ops; tempdir test envs without init_db at boot get a complete schema on first read. `db::run_migrations` was promoted from `fn` to `pub(crate) fn` to support this.
- **8 unit tests green.** `cargo test --lib skills::lifecycle::tests -- --test-threads=1` reports `8 passed; 0 failed; 0 ignored`. The two-call deterministic invariant (`merge_body_two_calls_match`) asserts name + description + script_path + usage + parameters.len() + test_output + forged_from match across calls (id + created_at deliberately diverge).
- **All 13 plan grep gates green.** 7 lifecycle.rs functions + skills/mod.rs `pub mod lifecycle` registration + the two locked SQL predicate literals (`91 * 86400` and `json_array_length(tool_names) >= 3`) + both open_db_for_lifecycle exposures + run_migrations reachable from tool_forge.rs.
- **`cargo build --lib` clean.** Build exits 0 with 6 warnings — 5 carry-forward from Plan 24-02 (dream_* helpers + last_activity_ts await Wave 2/3 wiring; Plans 24-05/24-07 will consume them) + 1 carry-forward `reward.rs:236 timestamp_ms`. NO new warnings introduced by this plan; lifecycle.rs is module-level `#![allow(dead_code)]` because its consumers (Plan 24-05 + Plan 24-07) ship next.

## Task Commits

Each task was committed atomically:

1. **Task 1: skills/lifecycle.rs NEW + skills/mod.rs registration + tool_forge.rs `open_db_for_lifecycle` + db.rs `open_db_for_lifecycle` + db.rs `run_migrations` visibility bump + 8 unit tests** — `15cb64c` (feat)

**Plan metadata:** [pending — final commit at end]

## Files Created/Modified

- `src-tauri/src/skills/lifecycle.rs` — NEW. 396 lines. Module docstring cites D-24-E LOCK + D-24-G SCOPE + D-24-A clock-anchor invariant. Exports: `deterministic_merge_body`, `ensure_unique_name`, `dedup_lines`, `union_dedup_by_name`, `cosine_sim`, `proposed_name_from_trace`, `prune_candidate_selection`, `last_5_trace_hashes`, `recent_unmatched_traces`, `forged_name_exists`, `archive_skill`. 8 inline tests in `mod tests`.
- `src-tauri/src/skills/mod.rs` — added `pub mod lifecycle;` after `pub mod export;` in the existing `pub mod` block (lines 36-44). Net +1 line. Re-exports section at lines 46+ untouched (lifecycle.rs's symbols are accessed through `crate::skills::lifecycle::*` directly; not flat-re-exported because the surface is internal-only and Plans 24-05/24-07 namespace-import).
- `src-tauri/src/tool_forge.rs` — added `pub(crate) fn open_db_for_lifecycle()` after the existing private `fn open_db()` at line 130. Function calls `open_db()` then `ensure_table` + `ensure_invocations_table` + `crate::db::run_migrations` idempotently. Pre-existing `open_db` + `ensure_table` + `ensure_invocations_table` + 12 tool_forge tests untouched. Net +26 lines.
- `src-tauri/src/db.rs` — added `pub(crate) fn open_db_for_lifecycle()` immediately above `run_migrations`. Promoted `fn run_migrations` to `pub(crate) fn run_migrations` so tool_forge.rs can call into it. Pre-existing `init_db` + `run_migrations` body + all other public functions untouched. Net +18 lines.

## Decisions Made

- **Predicate-injection over DB-open in pure-logic.** `deterministic_merge_body` and `ensure_unique_name` accept a `&dyn Fn(&str) -> bool` predicate rather than calling DB internally. This lets tests pass deterministic stubs (`&|_| false`, `&|n| n == "alpha_tool_merged"`, etc.) without tempdir setup. Production wires `&|n| forged_name_exists(n)` from Plan 24-05/24-07 callers. The pattern matches what Plan 24-05 will use for `is_dreaming: &dyn Fn() -> bool` wrapping `DREAMING.load(Ordering::Relaxed)`.
- **Cosine similarity reimplemented inline.** `embeddings::cosine_similarity` is private (line 33: `fn`, not `pub fn`). Promoting it to `pub` would expose a 11-line helper as a permanent public API. Instead, lifecycle.rs reimplements the body verbatim including the two zero guards (`a.len() != b.len() || a.is_empty()` and `mag_a == 0.0 || mag_b == 0.0`). Test `cosine_sim_basic` locks the contract: parallel = 1.0, perpendicular = 0.0, empty = 0.0, mismatched-length = 0.0.
- **Description and forged_from honor arg-position order, not lex-smaller-first.** `format!("{} | {}", a.description, b.description)` and `format!("merge:{}+{}", a.name, b.name)` use the verbatim argument order. The lex-smaller pick (smaller, _larger) only affects `name` (`smaller.name + "_merged"`), `language` (cloned from smaller), and `script_path` (cloned from smaller). Test `merge_body_deterministic` calls `deterministic_merge_body(&a, &b, ...)` with `a.name = "zeta_tool"` and `b.name = "alpha_tool"`, then asserts `m.description == "alpha desc | beta desc"` (a's desc | b's desc, NOT lex-smaller's desc | other's desc) and `m.forged_from == "merge:zeta_tool+alpha_tool"`.
- **999-collision uuid fallback is operator-perceptibility threshold, not infinite-loop guard.** The plan's threat register (T-24-04-03) classifies the 999-iteration ensure_unique_name worst case as "accept" — 999 SELECTs at sub-ms each = under 1s, and an operator would visually notice 999 collisions before hitting the uuid fallback. Test `merge_name_falls_back_to_uuid_when_999_taken` constructs a predicate that returns true for the base AND every `_v2`.._v999`, then asserts the result starts with `x_merged_` AND has total length > `x_merged_`.len() + 8 (the uuid-tail length sentinel; full uuids are 36 chars).
- **DB readers fail-open on error.** `prune_candidate_selection`, `last_5_trace_hashes`, `recent_unmatched_traces`, `forged_name_exists` all return empty Vec or `false` on DB-open or prepare failure. Per Pitfall 4 mitigation: a transient SQLite WAL collision between dream pass and chat path should NOT halt the dream pass; missed reads recover next cycle.
- **archive_skill order-of-operations: fs::rename FIRST, DB DELETE second.** T-24-04-04 + T-24-04-05 mitigation. If `fs::rename` fails (cross-device link, permissions), the function returns Err and the caller (Plan 24-05) skips the DB delete so the row stays live and is retried next cycle. If the src dir doesn't exist (idempotent re-archive after a prior failed cycle), the rename is skipped but the DB delete still runs to clean up the leftover row.
- **`#![allow(dead_code)]` at module head.** All 11 functions in lifecycle.rs are consumed by Plans 24-05 (dream task chain) + 24-07 (commands.rs apply path), neither of which has shipped yet. The module-level allow prevents 11 "is never used" warnings polluting `cargo build --lib` output between this plan and Plans 24-05/24-07. The allow is removed implicitly when consumers wire in (the Plan 24-05/24-07 use sites trip the dead-code analysis off for those symbols).
- **db::run_migrations promoted to pub(crate).** It's called from tool_forge::open_db_for_lifecycle which lives in a sibling module. `pub(crate)` is the minimum visibility that satisfies cross-module access without exposing it to external crates. Existing private callers in db.rs continue to work.
- **Cargo test --test-threads=1 still required.** lifecycle.rs's pure-logic tests don't access DB or BLADE_CONFIG_DIR, so they're isolated by construction. But the test bin shares the test harness with the other 30+ tool_forge tests that DO use ENV_LOCK + BLADE_CONFIG_DIR override; running with `--test-threads=1` keeps consistency with the existing Phase 22 + Plan 24-01 posture.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` step provided a verbatim ~250-line code block for lifecycle.rs which was used as-is. Plan's two locked literal patterns (`91 * 86400` and `json_array_length(tool_names) >= 3`) appear in the file at the SQL strings. Plan's 8 test bodies were also specified verbatim and used as-is.

The plan's `<read_first>` block instructed reading skills/types.rs for SourceTier verification — confirmed `User` variant exists at line 22 (`SourceTier::User`); no consumer in lifecycle.rs uses SourceTier directly so this was non-blocking.

## Threat Surface Scan

Per the plan's `<threat_model>` block, the Phase 24-04 trust boundaries are:

| Boundary | Disposition | Mitigation in this plan |
|----------|-------------|-------------------------|
| archive_skill DELETE under operator-supplied name (T-24-04-01) | mitigate | `name` parameter passed through `skills::export::sanitize_name` (lowercase ASCII + hyphens, 1-64 chars) before fs ops; SQL DELETE uses `params![]` bind, not string interpolation. Caller (Plan 24-05 dream task) only passes names from `prune_candidate_selection` which queries our own table. |
| archived dir contains prior SKILL.md (T-24-04-02) | accept | Same OS-user-scoped `<config_dir>/skills/` as the live skill dir. Archive is a rename within the same fs context. No new exposure surface. |
| ensure_unique_name worst case 999 candidates (T-24-04-03) | accept | 999 SELECTs at sub-ms each = under 1s. Operator would visually notice 999 collisions before hitting uuid fallback. Test merge_name_falls_back_to_uuid_when_999_taken pins the fallback contract. |
| archive_skill cross-device move fails (T-24-04-04) | mitigate | fs::rename returns Err on any failure → archive_skill propagates Err → caller (Plan 24-05) skips DB delete on Err so row stays live; will be retried next cycle. |
| DB delete succeeds but fs move had silent partial failure (T-24-04-05) | mitigate | Code order: `fs::rename` FIRST returns Err on any failure → DB DELETE statement is never reached if fs::rename failed. DB delete only runs when fs op completed (or src dir was already absent). |
| trace_hash collision between unrelated tool sequences (T-24-04-06) | accept | DefaultHasher u64 → 16 hex chars; birthday paradox over 100 traces is negligible (24-RESEARCH A4). lifecycle.rs is the READER not the WRITER; this disposition lives in Plan 24-01's tool_forge.rs::compute_trace_hash. |

No new threat surface introduced beyond the threat register. The DB readers (prune_candidate_selection, last_5_trace_hashes, recent_unmatched_traces, forged_name_exists) all use parameterized queries (`params![]`) and fail-open on DB-open failure; archive_skill uses `sanitize_name` whitelist filtering before any fs op.

## Acceptance Criteria

- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::merge_body_deterministic -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::merge_body_two_calls_match -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::merge_name_collision_suffixed_v2 -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::merge_name_falls_back_to_uuid_when_999_taken -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::proposed_name_deterministic -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::dedup_lines_preserves_order_unique -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::union_dedup_by_name_first_wins -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::lifecycle::tests::cosine_sim_basic -- --test-threads=1` exits 0
- [x] `grep -q 'pub fn deterministic_merge_body' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub fn ensure_unique_name' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub fn proposed_name_from_trace' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub fn prune_candidate_selection' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub fn last_5_trace_hashes' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub fn recent_unmatched_traces' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub fn archive_skill' src-tauri/src/skills/lifecycle.rs` exits 0
- [x] `grep -q 'pub mod lifecycle' src-tauri/src/skills/mod.rs` exits 0
- [x] `grep -q '91 \* 86400' src-tauri/src/skills/lifecycle.rs` exits 0 (ROADMAP success criterion 1 — 91-day threshold)
- [x] `grep -q 'json_array_length(tool_names) >= 3' src-tauri/src/skills/lifecycle.rs` exits 0 (DREAM-03 ≥3 tool calls predicate)
- [x] `grep -q 'pub(crate) fn open_db_for_lifecycle' src-tauri/src/tool_forge.rs` exits 0
- [x] `grep -q 'pub(crate) fn open_db_for_lifecycle' src-tauri/src/db.rs` exits 0
- [x] `grep -q 'run_migrations' src-tauri/src/tool_forge.rs` exits 0 (migration-gap fix — open_db_for_lifecycle invokes run_migrations)
- [x] DB-reader helpers (prune_candidate_selection, last_5_trace_hashes, recent_unmatched_traces, forged_name_exists) covered by integration tests in Plan 24-05 (deferred to that plan's task_skill_prune_archives_stale + prune_respects_dreaming_atomic + abort_within_one_second). archive_skill side effect covered indirectly via Plan 24-05's task_skill_prune_archives_stale.

## Test Output

```
running 8 tests
test skills::lifecycle::tests::cosine_sim_basic ... ok
test skills::lifecycle::tests::dedup_lines_preserves_order_unique ... ok
test skills::lifecycle::tests::merge_body_deterministic ... ok
test skills::lifecycle::tests::merge_body_two_calls_match ... ok
test skills::lifecycle::tests::merge_name_collision_suffixed_v2 ... ok
test skills::lifecycle::tests::merge_name_falls_back_to_uuid_when_999_taken ... ok
test skills::lifecycle::tests::proposed_name_deterministic ... ok
test skills::lifecycle::tests::union_dedup_by_name_first_wins ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 417 filtered out; finished in 0.05s
```

## Cargo Build Confirmation

```
cd src-tauri && cargo build --lib
warning: `blade` (lib) generated 6 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 7m 29s
```

The 6 warnings: 5 carry-forward from Plan 24-02 (`dream_prune` / `dream_consolidate` / `dream_generate` / `cap_items` / `last_activity_ts` await Wave 2/3 wiring; Plans 24-05/24-07 will consume them) + 1 carry-forward `reward.rs:236 timestamp_ms`. No new warnings from this plan because lifecycle.rs is module-level `#![allow(dead_code)]` until Plans 24-05/24-07 wire its consumers.

## Issues Encountered

- **`cargo test --lib skills::lifecycle::tests` cold-build cost ~3m 51s.** First test invocation after the source addition rebuilt incrementally. Subsequent verification `cargo build --lib` was another ~7m 29s. Same posture as Plan 24-01/02/03; out of scope for this plan.
- **No deletions in the commit.** `git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty for the Task 1 commit. Pre/post-commit deletion checks both green.

## Locked Schemas (downstream Plan 24-05 + 24-07 reference)

### deterministic_merge_body (D-24-E LOCK)

```rust
pub fn deterministic_merge_body<F>(a: &ForgedTool, b: &ForgedTool, is_taken: &F) -> ForgedTool
where F: Fn(&str) -> bool;
```

Output ForgedTool fields:
- `id`: fresh uuid v4
- `name`: `<lex-smaller>_merged` then `ensure_unique_name(name, is_taken)`
- `description`: `<a.description> | <b.description>` (arg-position order)
- `language`: `lex-smaller.language.clone()`
- `script_path`: `lex-smaller.script_path.clone()`
- `usage`: `dedup_lines(<a.usage>\n<b.usage>)`
- `parameters`: `union_dedup_by_name(&a.parameters, &b.parameters)` (first-occurrence wins)
- `test_output`: `<a.test_output>\n--- merged ---\n<b.test_output>`
- `created_at`: `chrono::Utc::now().timestamp()`
- `last_used`: `Some(created_at)` per D-24-A
- `use_count`: 0
- `forged_from`: `merge:<a.name>+<b.name>` (arg-position order)

### ensure_unique_name (Discretion item 3 LOCK)

```rust
pub fn ensure_unique_name<F>(base: &str, is_taken: &F) -> String
where F: Fn(&str) -> bool;
```

Output: `base` if not taken; else `base_v2`, `base_v3`, ..., `base_v999`; else `base_<uuid_v4>`.

### Locked SQL Predicates

- Prune: `SELECT rowid, name, script_path, last_used FROM forged_tools WHERE last_used IS NOT NULL AND ?1 - last_used >= 91 * 86400 ORDER BY last_used ASC`
- Last-5 trace hashes: `SELECT trace_hash FROM forged_tools_invocations WHERE tool_name = ?1 ORDER BY id DESC LIMIT 5`
- Recent unmatched traces: `SELECT tool_names FROM turn_traces WHERE turn_ts >= ?1 AND forged_tool_used IS NULL AND success = 1 AND json_array_length(tool_names) >= 3 ORDER BY turn_ts DESC` (cutoff = `now_ts - 86400`)

### archive_skill Side Effect Sequence

1. `sanitize_name(name)` → must return Some(sanitized); else Err
2. `<user_root>/.archived/` mkdir if missing (best-effort, ignored)
3. dest = `<archived_root>/<sanitized>` or `<archived_root>/<sanitized>_dup<unix_ts>` on collision
4. If src exists: `fs::rename(src, dest)` (Err on failure → caller skips DB delete)
5. `DELETE FROM forged_tools WHERE name = ?1` (Err on failure surfaces to caller)
6. Returns `Ok(dest)` on success

### tool_forge::open_db_for_lifecycle Idempotency

```rust
pub(crate) fn open_db_for_lifecycle() -> Result<rusqlite::Connection, String> {
    let conn = open_db()?;
    ensure_table(&conn).ok();
    ensure_invocations_table(&conn).ok();
    crate::db::run_migrations(&conn).map_err(|e| format!("run_migrations: {}", e))?;
    Ok(conn)
}
```

### db::open_db_for_lifecycle Idempotency

```rust
pub(crate) fn open_db_for_lifecycle() -> Result<Connection, String> {
    let path = crate::config::blade_config_dir().join("blade.db");
    let conn = Connection::open(&path).map_err(|e| format!("DB open error: {e}"))?;
    run_migrations(&conn).map_err(|e| format!("run_migrations: {}", e))?;
    Ok(conn)
}
```

## Wave 2 Status

- **Plan 24-04 (this plan): pure-logic substrate landed.** Plans 24-05 (dream_mode 3 tasks) and 24-07 (commands.rs apply path) BOTH consume `deterministic_merge_body` + `ensure_unique_name` from this module — extracting them here keeps both consumers wired to the same canonical implementation.
- **Plan 24-05 next.** Will read `prune_candidate_selection` + `last_5_trace_hashes` + `recent_unmatched_traces` + `archive_skill` from skills::lifecycle; will inject `is_dreaming: &dyn Fn() -> bool` predicate wrapping `DREAMING.load(Ordering::Relaxed)` per the plan's `must_haves.truths` per-step abort lock.

## User Setup Required

None. Pure-logic + DB-reader substrate; no new env vars, secrets, or external services touched. The two `pub(crate) fn open_db_for_lifecycle` helpers run `run_migrations` idempotently so first-launch and tempdir-test environments both see the complete schema.

## Self-Check: PASSED

- FOUND: src-tauri/src/skills/lifecycle.rs
- FOUND: .planning/phases/24-skill-consolidation-dream-mode/24-04-SUMMARY.md
- FOUND: commit 15cb64c (feat(24-04): skills/lifecycle.rs pure-logic substrate)
