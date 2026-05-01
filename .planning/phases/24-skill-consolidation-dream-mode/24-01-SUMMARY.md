---
phase: 24-skill-consolidation-dream-mode
plan: 01
subsystem: skills
tags: [skills, dream_mode, voyager, sqlite, tool_forge, rust, phase-24, dream-02, dream-03]

# Dependency graph
requires:
  - phase: 22-voyager-loop-closure
    provides: forged_tools schema; record_tool_use Voyager skill_used emit invariant; voyager_log fixed-emit-points contract
  - phase: 23-verifiable-reward-ood
    provides: TurnAccumulator + ToolCallTrace + commands.rs reward-hook site at line 1831; dispatch-loop record_tool_call site at line 2167
provides:
  - forged_tools_invocations sibling table with idx_fti_tool_id index
  - turn_traces table with idx_tt_ts index
  - record_tool_use(name, &[String]) extended signature with order-sensitive trace_hash + auto-prune to last 100/tool inside one transaction
  - compute_trace_hash function (DefaultHasher; 16 hex chars; sha2-free per RESEARCH A1)
  - Idempotent ensure_table backfill (D-24-A — last_used = created_at where NULL)
  - persist_forged_tool writes last_used = Some(now) at row creation (was None)
  - commands.rs dispatch-loop hook calling record_tool_use when forged tool dispatched (Pitfall 2 mitigation — was unwired)
  - commands.rs reward-hook turn_traces row write (DREAM-03 substrate)
affects: [24-02, 24-03, 24-04, 24-05, 24-06, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "rusqlite transaction wrapping UPDATE + INSERT + DELETE auto-prune for invocation log"
    - "DefaultHasher-based deterministic order-sensitive trace_hash (no new dep)"
    - "Idempotent SQL migration via UPDATE ... WHERE col IS NULL inside CREATE TABLE batch"
    - "Per-turn-side-effect SQL row write at canonical reward-hook site (DREAM-03 substrate)"

key-files:
  created: []
  modified:
    - src-tauri/src/tool_forge.rs
    - src-tauri/src/db.rs
    - src-tauri/src/commands.rs

key-decisions:
  - "D-24-A backfill UPDATE landed inside ensure_table execute_batch (single round-trip + idempotent on second launch — no migration tracking row needed)"
  - "compute_trace_hash uses std::collections::hash_map::DefaultHasher (sha2 not in Cargo.toml per 24-RESEARCH A1; 16-hex-char output, n=100/tool collision risk negligible)"
  - "record_tool_use transaction wraps UPDATE + INSERT + DELETE so concurrent readers can't see half-applied state (Pitfall 3)"
  - "Auto-prune via DELETE NOT IN (... ORDER BY id DESC LIMIT 100) inside same tx — bounded growth"
  - "commands.rs hook only fires when tool_call.name matches a forged_tools row (HashSet membership); native + MCP tools are no-ops (T-24-01-06 mitigation)"
  - "Single canonical tool_forge::record_tool_use call site in commands.rs per CONTEXT.md 'Specific Ideas' lock"
  - "turn_traces write uses canonical rusqlite::Connection::open(blade_config_dir/blade.db) seam already used 4x in commands.rs — no second DB-open pathway introduced"
  - "Migration test uses existing test_db() in-memory + run_migrations posture (mirrors test_migrations_idempotent) rather than init_db + BLADE_CONFIG_DIR env override — same migration body exercised, no env-state leakage"

patterns-established:
  - "Pattern: Phase 24 ensure_*_table helpers — sibling tables for forged_tools side-effect logs land via dedicated ensure_X helpers called from record_tool_use, not from a central migration body. Keeps schema close to its writer."
  - "Pattern: Order-sensitive trace_hash — comma-joined String join + DefaultHasher format!('{:016x}', hasher.finish()) is the canonical hash for skill-trace identity going forward (DREAM-02 + future consolidation work)."
  - "Pattern: Idempotent migration UPDATE inside CREATE TABLE batch — D-24-A's UPDATE WHERE last_used IS NULL is the template for future per-launch backfills that don't justify a migration tracking row."

requirements-completed: [DREAM-01, DREAM-02, DREAM-03]

# Metrics
duration: ~37 min
completed: 2026-05-01
---

# Phase 24 Plan 01: Wave 1 Foundation Plumbing Summary

**Locked the 91-day prune clock at write time, added forged_tools_invocations + turn_traces sibling tables, and wired the previously-unwired record_tool_use into commands.rs — the load-bearing plumbing change Wave 2's three dream tasks depend on.**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-05-01T17:55Z (Phase 24 execution start per STATE.md)
- **Completed:** 2026-05-01T18:31Z
- **Tasks:** 2 (both autonomous, both with TDD)
- **Files modified:** 3
- **Tests added:** 5 (4 in tool_forge::tests, 1 in db::tests)
- **Commits:** 2 atomic + 1 docs (final)

## Accomplishments

- **D-24-A locked end-to-end.** Forged tools created post-Phase-24 land with `last_used = Some(created_at)`. Existing forged_tools rows with NULL last_used are backfilled idempotently inside `ensure_table`. Pitfall 1 grep `last_used: None` returns 0.
- **D-24-B substrate landed.** `forged_tools_invocations` table with `idx_fti_tool_id` index records every forged-tool invocation's order-sensitive trace_hash; auto-pruned to last 100 per tool inside one transaction. DREAM-02's identical-5-trace gate has its input substrate.
- **DREAM-03 substrate landed.** `turn_traces` table records per-turn `tool_names` JSON array + `forged_tool_used` (NULL when no forged tool fired) + `success` flag, written at the canonical `compute_and_persist_turn_reward` hook site.
- **Pitfall 2 fixed (THE load-bearing change).** `tool_forge::record_tool_use` was unwired pre-Phase-24 (zero internal callers). Now called from commands.rs dispatch loop when a forged-tool name dispatches in chat. Single canonical call site per CONTEXT.md "Specific Ideas" lock — `grep -c 'tool_forge::record_tool_use' src-tauri/src/commands.rs = 1`.
- **5 new tests green.** `ensure_table_backfills_null_last_used` + `trace_hash_order_sensitive` + `record_tool_use_writes_invocation_row` + `register_forged_tool_sets_last_used_to_created_at` + `run_migrations_creates_turn_traces`. All 13 tool_forge tests pass; cargo check --lib clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: tool_forge.rs — backfill + invocations table + record_tool_use signature change + 4 tests** — `227d035` (feat)
2. **Task 2: db.rs turn_traces table + commands.rs dispatch hook + reward-hook trace write + 1 test** — `386312a` (feat)

**Plan metadata:** [pending — final commit at end]

## Files Created/Modified

- `src-tauri/src/tool_forge.rs` — ensure_table backfill UPDATE; new ensure_invocations_table; persist_forged_tool last_used = ?10 (was NULL); ForgedTool struct literal `last_used: Some(now)` (was None); record_tool_use(name, &[String]) extended signature with transaction-wrapped UPDATE + INSERT + DELETE auto-prune; new compute_trace_hash function; #[allow(dead_code)] on record_tool_use removed; 4 new unit tests
- `src-tauri/src/db.rs` — run_migrations execute_batch literal extended with `CREATE TABLE turn_traces` + `CREATE INDEX idx_tt_ts`; new test `run_migrations_creates_turn_traces`
- `src-tauri/src/commands.rs` — dispatch loop (after record_tool_call, before conversation.push) hook calling `tool_forge::record_tool_use` when tool_call.name matches a forged_tools row (HashSet membership lookup); reward hook (line 1831) writes one turn_traces row per turn before turn_acc moves into compute_and_persist_turn_reward

## Decisions Made

- **Migration test mirrors existing in-memory pattern.** Plan suggested `init_db + BLADE_CONFIG_DIR` env override but the existing `test_migrations_idempotent` test uses the simpler `test_db()` helper (in-memory `Connection::open_in_memory + run_migrations`). I matched that posture for `run_migrations_creates_turn_traces` — same migration body exercised, no env-state leakage to other tests, no parallel-test races against BLADE_CONFIG_DIR.
- **`ENV_LOCK` reuse.** The 4 new tool_forge tests share the existing module-level `ENV_LOCK: std::sync::Mutex<()>` with the Phase 22 voyager_two_installs_diverge + voyager_end_to_end tests. BLADE_CONFIG_DIR is process-global; without this lock, parallel tests would race the override. Same posture as Phase 22 substrate.
- **Pitfall 1 mitigation grep target.** `last_used: None` count went from 1 (the struct literal at the original line 500) to 0. The remaining `last_used: Option<i64>` in the ForgedTool struct definition is field-type, not a value literal — does not match the grep.
- **Pitfall 2 mitigation grep target.** Single `tool_forge::record_tool_use` call site in commands.rs (the new dispatch-loop hook). The reward-hook turn_traces write uses `forged_names.contains(*n)` for forged_used detection but does NOT re-call record_tool_use — that's the dispatch loop's job (avoids double-counting).
- **`#[allow(dead_code)]` count decreased by exactly 1.** From 3 to 2: file-level (line 10, kept) + forge_if_needed (line 664, kept) + record_tool_use (removed). Acceptance criteria met.

## Deviations from Plan

None — plan executed exactly as written. The migration test posture choice (in-memory `test_db()` vs `init_db + BLADE_CONFIG_DIR`) was pre-emptively considered in the plan's <action> step 4 ("If `init_db` is not the public seam ... use whatever public function returns a connection AFTER running migrations") and the existing `test_db()` helper that calls `run_migrations` directly satisfies the migration-body invariant the plan was actually testing for.

## Pitfall Mitigation Verification (post-conditions Wave 2 depends on)

- **Pitfall 1** — `grep -c "last_used: None" src-tauri/src/tool_forge.rs` = **0** ✓
- **Pitfall 2** — `grep -c "tool_forge::record_tool_use" src-tauri/src/commands.rs` = **1** ✓ (single canonical write site)
- **Pitfall 3** — `record_tool_use` body contains `conn.transaction()` wrapping UPDATE + INSERT + DELETE ✓ (concurrent readers can't see half-applied state)

## Acceptance Grep Manifest (verified in-flight)

```
grep -q "fn ensure_invocations_table" src-tauri/src/tool_forge.rs   -> 0
grep -q "fn compute_trace_hash" src-tauri/src/tool_forge.rs         -> 0
grep -q "pub fn record_tool_use(name: &str, turn_tool_names: &\[String\])" src-tauri/src/tool_forge.rs -> 0
grep -q "UPDATE forged_tools SET last_used = created_at WHERE last_used IS NULL" src-tauri/src/tool_forge.rs -> 0
grep -q "CREATE TABLE IF NOT EXISTS forged_tools_invocations" src-tauri/src/tool_forge.rs -> 0
grep -q "idx_fti_tool_id" src-tauri/src/tool_forge.rs               -> 0
grep -q "CREATE TABLE IF NOT EXISTS turn_traces" src-tauri/src/db.rs -> 0
grep -q "idx_tt_ts" src-tauri/src/db.rs                              -> 0
grep -q "tool_forge::record_tool_use" src-tauri/src/commands.rs      -> 0
grep -q "INSERT INTO turn_traces" src-tauri/src/commands.rs          -> 0
grep -c "tool_forge::record_tool_use" src-tauri/src/commands.rs      -> 1
grep -c "last_used: None" src-tauri/src/tool_forge.rs                -> 0
```

All 12 acceptance greps green.

## Issues Encountered

- **Pre-existing test failure: `db::tests::test_analytics`.** Confirmed pre-existing on bare master (verified via `git stash + cargo test --lib db::tests::test_analytics`). Out of scope per executor scope-boundary rule (not caused by Phase 24 changes; failure asserts `event_type == "message_sent"` but receives `"app_open"` — analytics test code unrelated to turn_traces / forged_tools_invocations / record_tool_use). Logged here for visibility; not fixed.
- **Side-benefit warning auto-clear.** The `is_error` field on `ToolCallTrace` was tagged dead-code pre-Plan-24-01; the new commands.rs reward-hook turn_traces write reads `t.is_error` to compute the success flag, so the warning auto-cleared. Only `timestamp_ms` warning remains (pre-existing, untouched by this plan).

## User Setup Required

None — substrate-only landing, no external service configuration. Substrate phase per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`); runtime UAT for chat-injected proactive prompts is operator-deferred to later Phase 24 plans.

## Next Phase Readiness

**Wave 2 unblocked.** DREAM-02 consolidation pass (Plan 24-02) can now read trace_hash rows from forged_tools_invocations; DREAM-03 skill-from-trace generator (Plan 24-04) can now read tool_names sequences from turn_traces; DREAM-01 prune pass (Plan 24-03) can now safely query `now() - last_used >= 91*86400` knowing all rows have a non-NULL last_used.

**Plan 24-02 entrypoint:** new `task_skill_consolidate(app)` in dream_mode.rs reads `forged_tools_invocations` rows grouped by tool_name + ordered by id DESC LIMIT 5, computes trace_hash equality for similarity-≥0.85 forged-tool pairs, emits chat-injected merge prompt via proactive_engine + writes `.pending/<id>.json` (D-24-B substrate).

**Plan 24-04 entrypoint:** new `task_skill_from_trace(app)` reads `turn_traces` rows from last 24h where `forged_tool_used IS NULL` AND `json_array_length(tool_names) >= 3` AND `success = 1`, dedups by tool_names content hash against `.pending/<id>.json`, emits chat-injected save-as-skill prompt.

**Plan 24-03 entrypoint:** new `task_skill_prune(app)` selects `name, last_used, script_path FROM forged_tools WHERE last_used IS NOT NULL AND now() - last_used >= 91*86400`. Per row: rename `~/.blade/skills/<name>/` to `~/.blade/skills/.archived/<name>/` + DELETE forged_tools row + emit `voyager_log::dream_prune(count, items)`.

---
*Phase: 24-skill-consolidation-dream-mode*
*Completed: 2026-05-01*

## Self-Check: PASSED

- File created: `.planning/phases/24-skill-consolidation-dream-mode/24-01-SUMMARY.md` ✓
- Commit `227d035` exists in `git log` ✓ (Task 1)
- Commit `386312a` exists in `git log` ✓ (Task 2)
- All acceptance greps verified inline before commit ✓
- All 5 new tests pass via `cargo test --lib tool_forge::tests:: db::tests::run_migrations_creates_turn_traces -- --test-threads=1` ✓
- `cargo check --lib` clean (only pre-existing reward.rs:236 timestamp_ms warning) ✓
