---
phase: 24-skill-consolidation-dream-mode
verified: 2026-05-02T00:00:00Z
status: partial
score: 6/6 must-haves verified (all DREAM-IDs delivered) — partial because 6 REVIEW warnings + 1 test-isolation gap remain unresolved
requirements_satisfied: 6
requirements_total: 6
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "Test isolation under cargo test --lib (parallel default) — Phase 24 tests share BLADE_CONFIG_DIR and .pending/ across test threads, producing 16 parallel-mode failures (master-with-Phase-24) vs 5 carry-forward failures with --test-threads=1"
    status: partial
    reason: "Production code has no regression — the 11 net new failures under parallel mode are all Phase-24-owned tests racing on filesystem state (BLADE_CONFIG_DIR override, ~/.blade/skills/.pending/, ~/.blade/sessions/). Plan 24-01 adopted ENV_LOCK from Phase 22's tool_forge::tests pattern but never extended it across the new modules (skills::pending, skills::lifecycle, dream_mode tests). 24-VALIDATION.md §'Sampling Rate' explicitly documents `cargo test --lib -- --test-threads=1` as the canonical command, so the parallel-mode breakage is acknowledged-but-undocumented as a phase-close artifact."
    artifacts:
      - path: "src-tauri/src/skills/pending.rs"
        issue: "tests use tempfile + BLADE_CONFIG_DIR override but no module-level ENV_LOCK; 4 tests in this module"
      - path: "src-tauri/src/dream_mode.rs"
        issue: "phase24 tests (task_skill_prune_archives_stale + prune_respects_dreaming_atomic + abort_within_one_second) use tempdir + DREAMING atomic but share global state with sibling tests; 3 phase-24 tests"
      - path: "src-tauri/src/commands.rs"
        issue: "phase24_e2e_tests share BLADE_CONFIG_DIR with skills::pending tests; 2 phase-24 tests"
    missing:
      - "Add module-level ENV_LOCK Mutex in skills::pending::tests, skills::lifecycle::tests, and dream_mode::tests (mirror tool_forge::tests pattern) — OR document the --test-threads=1 requirement in CLAUDE.md / phase-close runbook so future phases don't trip the same gap"
      - "Add a CI gate or README note recording that `cargo test --lib` under parallel default IS expected to fail until the lock pattern is uniformly applied across phase 24 modules"
  - truth: "REVIEW.md WR-01: apply_proposal_reply merge path archives sources non-atomically and silently swallows archive_skill errors"
    status: partial
    reason: "On 'yes <id>' for a merge proposal, commands.rs INSERTs the merged tool first, then `let _ = archive_skill(source_a)` and `let _ = archive_skill(source_b)` discard errors. If one rename fails, operator sees 'Sources archived' but the live forged_tools table has source + merged + the un-archived source = D-24-E LOCK violation ('merge replaces both sources'). Self-correcting via next dream cycle re-flagging the merge, but the current-cycle confirmation message is incorrect and a stale row is briefly visible to the operator."
    artifacts:
      - path: "src-tauri/src/commands.rs"
        issue: "Lines 715-722 (per REVIEW): `let _ = ... archive_skill(...)` discards Err on both source archive calls; success message printed unconditionally"
    missing:
      - "Track per-source archive results and surface them in the confirmation message (per REVIEW.md fix snippet) — or document the self-correcting posture explicitly in the operator-facing string"
  - truth: "REVIEW.md WR-02: dream_mode reports timed-out tasks in tasks_completed array — semantics drift between 'attempted' and 'completed'"
    status: partial
    reason: "run_task! macro at dream_mode.rs:580-602 pushes task_name into tasks_completed BEFORE the DREAMING.load checkpoint. A task that timed out at the 120s mark with a user-becoming-active interrupt produces an 'interrupted' session whose tasks_completed array still contains the timed-out task names. Frontend / voyager_log consumers cannot distinguish completed-cleanly from completed-with-timeout."
    artifacts:
      - path: "src-tauri/src/dream_mode.rs"
        issue: "Lines 580-602: tasks_completed.push happens for both Ok and timeout results"
    missing:
      - "Either rename to tasks_attempted, OR split into tasks_completed + tasks_timed_out, OR only push successful results into tasks_completed"
  - truth: "REVIEW.md WR-03: dream_trigger_now races auto-loop on DREAMING atomic — uses unconditional store(false) instead of compare_exchange"
    status: partial
    reason: "dream_trigger_now() flips DREAMING via store(true) then store(false) at the end (line 711) without guarding against a concurrently-running auto-spawn session. The auto-loop's own compare_exchange(false, true) at line 681 is a one-shot guard, but the manual trigger can stomp on its store(false) finalization, leaving the atomic in an inconsistent state if interleaved unfortunately."
    artifacts:
      - path: "src-tauri/src/dream_mode.rs"
        issue: "Lines 704-720: dream_trigger_now uses store, not compare_exchange, despite auto-loop using compare_exchange at line 681"
    missing:
      - "Apply REVIEW fix: use DREAMING.compare_exchange(false, true, SeqCst, Relaxed).is_err() at trigger entry, and matching compare_exchange(true, false, ...) at exit"
  - truth: "REVIEW.md WR-04: archive_skill DB delete is unconditional even when src dir is missing — diverges from docstring 'archives a forged-tool's filesystem dir … then DELETE the forged_tools DB row'"
    status: partial
    reason: "Verified live in src-tauri/src/skills/lifecycle.rs:244-276 — the `if src.exists()` guard at line 260 only gates the rename; the `DELETE FROM forged_tools WHERE name = ?1` at line 269-273 runs unconditionally once the connection opens. For the prune path this is fine (script_path lives elsewhere), but the docstring at lines 240-246 says rename-then-delete which is no longer true. Behavior diverges from doc — risk is low since prune_candidate_selection already filters on last_used; the divergence is the bug."
    artifacts:
      - path: "src-tauri/src/skills/lifecycle.rs"
        issue: "Lines 244-276: docstring promises rename-then-delete; code does conditional-rename then unconditional-delete"
    missing:
      - "Either gate the DB DELETE on rename success (matching docstring), OR update the docstring to reflect the current contract (best-effort rename, unconditional row removal)"
  - truth: "REVIEW.md WR-05: dream_mode interrupt may double-emit dream_mode_end event"
    status: partial
    reason: "When the monitor loop detects user activity (line 661), it sets DREAMING=false and emits dream_mode_end{ reason: 'interrupted', tasks_completed: 0 }. The spawned dream session is still running async and will eventually emit its own dream_mode_end with the actual count. Frontend listeners receive two events for one session. UI consequences depend on listener idempotence."
    artifacts:
      - path: "src-tauri/src/dream_mode.rs"
        issue: "Lines 660-694: monitor-loop interrupt emits dream_mode_end; spawned session also emits at completion"
    missing:
      - "Track interrupt-emit-fired state and skip the spawned session's emit if interrupt-emit already fired (per REVIEW fix); OR have only the spawned task emit and the monitor loop just flips DREAMING"
  - truth: "REVIEW.md WR-06: skill_validator list --diff archived bucket has dead-code filter that masks logic intent"
    status: partial
    reason: "src-tauri/src/bin/skill_validator.rs:329-335 chains two .filter() calls — first includes name if gone-from-current OR present-in-archived_now; second re-filters down to only archived_now membership. First filter's `!current_names.contains` clause is dead code. If the intent was to capture 'consolidated-but-not-archived' (gone-from-current AND not-archived), that intent isn't implemented."
    artifacts:
      - path: "src-tauri/src/bin/skill_validator.rs"
        issue: "Lines 329-335: redundant .filter() chain; second filter dominates the first"
    missing:
      - "Drop the dead first filter, OR restructure to capture the intended Venn diagram and add a unit test pinning the (gone, not archived) edge case"
deferred: []
human_verification:
  - test: "Operator-deferred runtime UAT for chat-injected proactive merge prompt"
    expected: "When the operator is idle ≥1200s and a forged_tools pair has cosine_sim ≥0.85 + identical 5-trace, dream_mode writes a .pending/<id>.json proposal; ≥30s later the proactive_engine drain surfaces a chat-injected prompt 'BLADE: Two forged tools (`<a>` + `<b>`) have ≥0.85 semantic similarity… [yes <id> / no <id> / dismiss <id>]'; operator types `yes <id>`; merged ForgedTool persists to forged_tools, sources archived to .archived/, confirmation message rendered in chat stream WITHOUT model leakage"
    why_human: "Per chat-first pivot anchor (memory feedback_chat_first_pivot.md, 2026-04-30) and CLAUDE.md Verification Protocol — runtime UAT for chat-injected proactive prompts is operator-deferred to the v1.3 milestone close. Substrate-only phase per Plan 24-07 'Next Phase Readiness'. Static gates and unit/integration tests prove the pipeline; the round-trip via Tauri/React surface awaits operator-driven UAT in the dev binary."
  - test: "Operator-deferred runtime UAT for chat-injected proactive skill-from-trace prompt"
    expected: "Same as above but with task_skill_from_trace's proposal (kind='generate'); operator's `yes <id>` writes proposed_skill_md to <user_root>/<sanitized_name>/SKILL.md; subsequent `skill_validator list --diff <prev_session_id>` shows the new skill in the 'added' bucket"
    why_human: "Same posture as above — UAT-deferred per chat-first pivot anchor; the kind='generate' branch in apply_proposal_reply is type-checked but not exercised in commands::phase24_e2e_tests (only the merge branch + dismiss path are exercised end-to-end)"
  - test: "ActivityStrip emits dream_mode:prune / :consolidate / :generate rows during a real dream cycle"
    expected: "After seeding 5+ stale forged_tools and triggering dream_trigger_now() in dev, ActivityStrip surfaces 3 distinct rows under [Voyager] module label with action prefixes dream_mode:* and count + items capped at 10"
    why_human: "Cross-process JSONL row inspection requires a running dev session with the React UI mounted; the unit test voyager_log::tests::dream_emit_helpers_safe_without_app_handle covers the helper-shape invariant but the strip-rendering invariant is operator-deferred"
---

# Phase 24: Skill Consolidation in dream_mode — Verification Report

**Phase Goal:** Close the continual-forgetting half of the Voyager loop. Skills not used → archived (preserved). Redundant skills → consolidated (with operator confirm). Successful traces with no existing skill match → propose new skill (with operator confirm). Skill manifest grows visibly between sessions per `voyager-loop-play.md` §"the piece worth shipping is dream-mode that produces a measurable artifact — skill library growth overnight is screenshotable."

**Verified:** 2026-05-02T00:00:00Z
**Status:** partial (all 6 DREAM-IDs delivered; 6 REVIEW warnings + 1 test-isolation gap unresolved)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (DREAM-IDs)

| #     | Requirement | Truth                                                                                              | Delivering Plan      | Verifying Test                                                                                                                                  | Status     |
| ----- | ----------- | -------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1     | DREAM-01    | 91-day prune pass — stale forged_tools rows move to ~/.blade/skills/.archived/<name>/             | 24-04 + 24-05        | `dream_mode::tests::task_skill_prune_archives_stale` (TBD-02-01) — 2 stale 92-day rows archived; 1 fresh 30-day row remains; commit `4ae828f`   | ✓ VERIFIED |
| 2     | DREAM-02    | Cosine ≥0.85 + identical 5-trace pair flagged for merge with operator confirm                     | 24-04 + 24-05 + 24-07 | `dream_mode.rs::task_skill_consolidate` (lifecycle::cosine_sim + last_5_trace_hashes + deterministic_merge_body) + apply path E2E in `proposal_reply_yes_merge_persists_merged_tool` (24-07) | ✓ VERIFIED |
| 3     | DREAM-03    | ≥3 tool calls without invoking any existing skill → propose new skill (operator confirm)         | 24-04 + 24-05 + 24-07 | `task_skill_from_trace` (lifecycle::recent_unmatched_traces + proposed_name_from_trace) + apply helper kind="generate" branch type-checked       | ✓ VERIFIED (test trail partial — kind="generate" structurally exercised but not e2e in commands::phase24_e2e_tests; live merge-branch e2e covers shared apply path) |
| 4     | DREAM-04    | `skill_validator list / list --diff <session_id>` CLI extension                                   | 24-03 + 24-06        | `bin/skill_validator::tests::list_subcommand_text_format` + `list_subcommand_json_format` + `list_diff_categorizes` (3 tests; commit `260a5f6`) | ✓ VERIFIED |
| 5     | DREAM-05    | Per-step abort SLA ≤1s when DREAMING flips to false                                                | 24-05                | `dream_mode::tests::abort_within_one_second` (≤1000ms SLA boundary) + `prune_respects_dreaming_atomic` (deterministic 3/7 split); commit `4ae828f` | ✓ VERIFIED |
| 6     | DREAM-06    | dream_mode emits to ActivityStrip per M-07 — kind=prune\|consolidate\|generate with count          | 24-02                | `voyager_log::tests::dream_action_strings_locked` + `dream_emit_helpers_safe_without_app_handle` + `dream_prune_caps_items_at_10` + `cap_items_returns_clone_when_under_cap`; commit `db10e09` | ✓ VERIFIED |

**Score:** 6/6 truths verified (all DREAM-IDs delivered with passing test trail under `cargo test --lib -- --test-threads=1`)

### Required Artifacts

| Artifact                                          | Expected                                                          | Status     | Details                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/skills/lifecycle.rs`               | NEW pure-logic substrate (DREAM-01/02/03)                         | ✓ VERIFIED | 402 lines; 11 pub fn (deterministic_merge_body, ensure_unique_name, dedup_lines, union_dedup_by_name, cosine_sim, proposed_name_from_trace, prune_candidate_selection, last_5_trace_hashes, recent_unmatched_traces, forged_name_exists, archive_skill); 8 unit tests |
| `src-tauri/src/skills/pending.rs`                 | NEW .pending/ proposal queue                                      | ✓ VERIFIED | 253 lines; Proposal struct + write_proposal w/ content_hash dedup + auto_dismiss_old (7-day mark + 30-day purge) + full CRUD; 4 unit tests |
| `src-tauri/src/skills/mod.rs`                     | `pub mod lifecycle;` + `pub mod pending;` registration            | ✓ VERIFIED | Lines 39 + 42 confirmed via grep                                                                                 |
| `src-tauri/src/dream_mode.rs`                     | 3 task fns + 3 run_task! invocations + last_activity_ts accessor | ✓ VERIFIED | task_skill_prune (line 266), task_skill_consolidate (line 293), task_skill_from_trace (line 378); run_task! invocations at 619/620/621; last_activity_ts at line 35; 10 DREAMING.load checkpoints |
| `src-tauri/src/voyager_log.rs`                    | 3 dream_* emit helpers + cap_items + locked action strings        | ✓ VERIFIED | dream_prune (124), dream_consolidate (137), dream_generate (150), cap_items (164); MODULE = "Voyager" preserved per D-24-F |
| `src-tauri/src/tool_forge.rs`                     | forged_tools_invocations table + record_tool_use(name, &traces) + open_db_for_lifecycle | ✓ VERIFIED | Pitfall 2 mitigation: single canonical record_tool_use call site in commands.rs (verified `grep -c` = 1); D-24-A backfill UPDATE in ensure_table; transaction-wrapped invocation insert + auto-prune to 100/tool |
| `src-tauri/src/db.rs`                             | turn_traces table + open_db_for_lifecycle + run_migrations pub(crate) | ✓ VERIFIED | CREATE TABLE turn_traces + idx_tt_ts in run_migrations; visibility bump to pub(crate)                            |
| `src-tauri/src/session_handoff.rs`                | skills_snapshot field + per-session archive at <config_dir>/sessions/ + 30-cap mtime sweep | ✓ VERIFIED | skills_snapshot field with #[serde(default)] back-compat; sessions_dir helper; sweep_sessions_to_cap(30); skills_snapshot_default_for_old_json test pins back-compat |
| `src-tauri/src/skills/loader.rs`                  | SkillRef struct + list_skills_snapshot() aggregator               | ✓ VERIFIED | 4-source flat aggregation (forged + bundled + user + archived); deterministic iteration order locked              |
| `src-tauri/src/intent_router.rs`                  | IntentClass::ProposalReply { verb, id } + match_proposal_reply Tier-1 detector | ✓ VERIFIED | OnceLock<regex::Regex> compile-once; Tier-1 ordering before match_heuristic; 4 unit tests (yes/no/dismiss + bare-yes-falls-through) |
| `src-tauri/src/jarvis_dispatch.rs`                | Defensive ProposalReply -> NotApplicable arm                      | ✓ VERIFIED | Line 253 — required for compile-time exhaustive match                                                            |
| `src-tauri/src/proactive_engine.rs`               | should_drain_now (30s idle gate) + drain_pending_proposals       | ✓ VERIFIED | should_drain_now reads dream_mode::last_activity_ts() (clears Plan 24-02 carry-forward warning); drain wired at top of proactive_loop tick |
| `src-tauri/src/commands.rs`                       | apply_proposal_reply + synchronous early-return in send_message_stream_inline BEFORE LLM call | ✓ VERIFIED | Lines 656 + 971-1003; chat-streaming contract preserved (blade_message_start → chat_token → chat_done); operator's "yes <id>" never leaks to LLM provider |
| `src-tauri/src/bin/skill_validator.rs`            | list / list --json / list --diff subcommands; back-compat positional alias | ✓ VERIFIED | Subcommand dispatcher (line 33-34); pub fn run_validate / run_list / run_list_diff; --diff flag handler; verify:skill-format chain still green |
| `src-tauri/src/lib.rs`                            | pub mod config + pub mod session_handoff (visibility bump for bin reach) | ✓ VERIFIED | Both bumps applied per Plan 24-06 commit 260a5f6                                                                  |

### Key Link Verification

| From                                              | To                                            | Via                                                                  | Status   | Details                                                                                              |
| ------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| dream_mode::run_dream_session                     | task_skill_prune / consolidate / from_trace  | run_task! macro x3 (lines 619-621) in locked order                   | ✓ WIRED | Pitfall 5 ordering preserved: prune → consolidate → from_trace; consolidate sees post-prune state    |
| task_skill_consolidate                            | skills::pending::write_proposal              | content_hash dedup + cap-1-merge-per-cycle break                     | ✓ WIRED | D-24-B cap enforced; emit_once-per-task invariant preserved across 4 early-return code paths         |
| commands.rs (chat dispatch)                       | tool_forge::record_tool_use                   | HashSet membership lookup for forged-tool names                      | ✓ WIRED | Pitfall 2 mitigation: single canonical write site (`grep -c` = 1)                                    |
| commands.rs (reward hook)                         | turn_traces row write                         | Direct INSERT inside compute_and_persist_turn_reward path            | ✓ WIRED | DREAM-03 substrate; tool_names JSON array + forged_tool_used (NULL when no forged) + success flag    |
| send_message_stream_inline                        | apply_proposal_reply                          | Synchronous classify_intent + early-return BEFORE LLM call          | ✓ WIRED | Chat-streaming contract: blade_message_start emitted FIRST, then chat_token, then chat_done; LLM never sees `yes <id>` |
| proactive_engine::proactive_loop                  | drain_pending_proposals                       | Wired at top of tick (line 631) BEFORE run_detector! invocations     | ✓ WIRED | should_drain_now reads dream_mode::last_activity_ts() (≥30s idle gate); cooldown-or-no, drain runs once per tick |
| skill_validator::run_list_diff                    | <config_dir>/sessions/<id>.json + list_skills_snapshot() | Two-snapshot diff: prior from disk + current via aggregator         | ✓ WIRED | Set-difference produces (added, archived, consolidated) buckets                                      |
| voyager_log::dream_*                              | ActivityStrip JSONL                           | emit() core + MODULE = "Voyager" + action prefix dream_mode:*       | ✓ WIRED | D-24-F preserved: one emit per pass-kind per cycle; cap_items at 10 + sentinel                        |

### Data-Flow Trace (Level 4)

| Artifact                                          | Data Variable                  | Source                                              | Produces Real Data | Status      |
| ------------------------------------------------- | ------------------------------ | --------------------------------------------------- | ------------------ | ----------- |
| `task_skill_prune` (dream_mode.rs)                | candidates                     | `lifecycle::prune_candidate_selection(now_ts)` SQL: `SELECT … WHERE last_used IS NOT NULL AND ?1 - last_used >= 91*86400` | ✓ Yes — confirmed by `task_skill_prune_archives_stale` test seeding 2 stale (92-day) + 1 fresh (30-day) row, asserting 2 archived | ✓ FLOWING   |
| `task_skill_consolidate` (dream_mode.rs)          | rows + embeddings + last_5    | `tool_forge::get_forged_tools()` + `embeddings::embed_texts(&[String])` (local fastembed) + `lifecycle::last_5_trace_hashes` | ✓ Yes — embed_texts is in-process; trace_hashes table populated by record_tool_use Pitfall 2 wiring | ✓ FLOWING   |
| `task_skill_from_trace` (dream_mode.rs)           | unmatched_traces               | `lifecycle::recent_unmatched_traces(cutoff)` SQL: `SELECT tool_names FROM turn_traces WHERE turn_ts >= ?1 AND forged_tool_used IS NULL AND success = 1 AND json_array_length(tool_names) >= 3` | ✓ Yes — turn_traces populated by Plan 24-01 commands.rs reward-hook write site | ✓ FLOWING   |
| `apply_proposal_reply` (commands.rs)              | prop                           | `pending::read_proposal(id)` from <config_dir>/skills/.pending/<id>.json | ✓ Yes — write_proposal site is task_skill_consolidate / task_skill_from_trace; full lifecycle exercised by commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool | ✓ FLOWING   |
| `drain_pending_proposals` (proactive_engine.rs)   | proposals                      | `pending::read_proposals()` filtered by `!dismissed` | ✓ Yes — drain_pending_filters_dismissed_proposals test verifies; emit-prompt embeds literal proposal_id | ✓ FLOWING   |
| `run_list` (skill_validator)                      | snap                           | `list_skills_snapshot()` flat aggregation across 4 sources | ✓ Yes — list_subcommand_text_format + list_subcommand_json_format tests assert 4-bucket output with seeded forged + bundled rows | ✓ FLOWING   |
| `run_list_diff` (skill_validator)                 | prior + current                | <config_dir>/sessions/<id>.json (Plan 24-03 archive write) + live aggregator | ⚠️ FLOWING — but archived bucket has REVIEW WR-06 dead-code filter masking edge cases | ⚠️ FLOWING with logic gap |

### Behavioral Spot-Checks

| Behavior                                                                                    | Command                                                                              | Result                              | Status |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- | ------ |
| Phase 24-owned tests pass with --test-threads=1                                            | `cargo test --lib -- --test-threads=1 commands::phase24_e2e_tests dream_mode::tests skills::pending::tests skills::lifecycle::tests skills::loader::tests session_handoff::tests intent_router::tests::proposal_reply intent_router::tests::bare_yes_falls_through_to_chat_only proactive_engine::phase24_tests voyager_log::tests tool_forge::tests db::tests::run_migrations_creates_turn_traces` | 57 passed; 0 failed; finished in 3.81s | ✓ PASS |
| cargo build --lib clean                                                                     | `cargo build --lib`                                                                  | 0 errors; 1 carry-forward warning (reward.rs:236 timestamp_ms) | ✓ PASS |
| cargo test --lib --no-run (compile suite)                                                   | `cargo test --lib --no-run`                                                          | 1 carry-forward warning; build green   | ✓ PASS |
| Module registration                                                                         | `grep -n "pub mod lifecycle\|pub mod pending" src-tauri/src/skills/mod.rs`           | Lines 39 + 42                       | ✓ PASS |
| Streaming contract preserved at new chat-injected branch                                    | Read commands.rs:979-1002                                                            | blade_message_start emitted at 989 BEFORE chat_token at 993, chat_done at 997, then early-return at 1001 | ✓ PASS |
| Verify chain (Plan 21-07 substrate) still green                                             | Plan 24-06 SUMMARY records `bash scripts/verify-skill-format.sh` returns OK: 3 skill(s) validated | Confirmed in 24-06 SUMMARY          | ✓ PASS |
| Single canonical record_tool_use call site                                                  | `grep -c "tool_forge::record_tool_use" src-tauri/src/commands.rs`                    | 1                                   | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s)        | Description                                                                                          | Status        | Evidence                                                                                                                                  |
| ----------- | --------------------- | ---------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| DREAM-01    | 24-01, 24-04, 24-05  | 91-day prune pass → ~/.blade/skills/.archived/<name>/                                              | ✓ SATISFIED  | `task_skill_prune_archives_stale` test green; archive_skill side effect end-to-end                                                       |
| DREAM-02    | 24-01, 24-04, 24-05, 24-07 | Cosine ≥0.85 + identical 5-trace pair → merge with operator confirm                                  | ✓ SATISFIED  | task_skill_consolidate + .pending/ + apply_proposal_reply E2E; chat-injected prompt route closed                                        |
| DREAM-03    | 24-01, 24-04, 24-05, 24-07 | ≥3 tool calls without skill match → propose new skill (operator confirm)                            | ✓ SATISFIED (partial e2e — kind="generate" branch type-checked but commands::phase24_e2e_tests only exercises the merge branch end-to-end) | task_skill_from_trace + write_proposal cap-1; structural verification of generate branch in apply_proposal_reply match                  |
| DREAM-04    | 24-03, 24-06         | `skill_validator list / list --diff <session_id>` CLI                                              | ✓ SATISFIED  | 3 CLI integration tests green; Plan 21-07 verify chain still green                                                                       |
| DREAM-05    | 24-05                | Per-step abort SLA ≤1s; pauses on user input                                                       | ✓ SATISFIED  | abort_within_one_second + prune_respects_dreaming_atomic tests green                                                                     |
| DREAM-06    | 24-02                | ActivityStrip emit per pass-kind with count                                                        | ✓ SATISFIED  | dream_prune / dream_consolidate / dream_generate helpers + cap_items + 4 tests                                                          |

**Coverage:** 6/6 (100%). REQUIREMENTS.md inline `[x]` ticks (lines 62-68) all marked shipped. **Note:** the secondary status table at REQUIREMENTS.md line 209 still shows `DREAM-04 | 24 | pending` — this is a documentation lag (Plan 24-06 SUMMARY frontmatter declares `requirements-completed: [DREAM-04]`; the table row should be updated alongside the close commit).

### Anti-Patterns Found

| File                                              | Line       | Pattern                                                                                              | Severity   | Impact                                                                                                                          |
| ------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/commands.rs`                       | 715-722    | WR-01: `let _ = archive_skill(...)` discards error; success message printed unconditionally          | ⚠️ Warning | Operator-visible state lies on partial archive failure (D-24-E LOCK violation in current cycle; self-correcting next cycle)     |
| `src-tauri/src/dream_mode.rs`                     | 580-602    | WR-02: `tasks_completed` array conflates `Ok` and `timeout` results                                  | ⚠️ Warning | Frontend / voyager_log consumers can't distinguish completed-cleanly from completed-with-timeout                                 |
| `src-tauri/src/dream_mode.rs`                     | 704-720    | WR-03: dream_trigger_now uses `store(false)` not `compare_exchange` — races auto-loop                | ⚠️ Warning | DREAMING atomic could end up inconsistent if manual trigger fires during auto-spawn session (rare; no observed corruption)      |
| `src-tauri/src/skills/lifecycle.rs`               | 244-276    | WR-04: archive_skill DB delete unconditional; docstring says rename-then-delete                      | ⚠️ Warning | Docstring drift; operator-visible behavior matches intent for prune path; risk is doc/code divergence catching a future caller |
| `src-tauri/src/dream_mode.rs`                     | 660-694    | WR-05: monitor-loop interrupt + spawned session both emit `dream_mode_end`                           | ⚠️ Warning | Frontend listeners receive two events per session; UI flicker possible if listener not idempotent                               |
| `src-tauri/src/bin/skill_validator.rs`            | 329-335    | WR-06: chained `.filter()` calls; first filter clause is dead code                                   | ⚠️ Warning | Logic intent obscured; (gone, not archived) edge case not covered                                                                |
| `src-tauri/src/skills/pending.rs`                 | 50-59      | IN-01: serde_json::to_string(payload) is non-canonical — different key orders break dedup            | ℹ️ Info    | Today's writers each use a single `json!` literal so stable; latent risk for future writers                                      |
| `src-tauri/src/dream_mode.rs`                     | 60-70      | IN-02: `uuid_v4()` is a homemade DefaultHasher — not RFC4122 + not collision-resistant               | ℹ️ Info    | `uuid` crate already a dep + already used in same file; trivial fix                                                              |
| `src-tauri/src/dream_mode.rs`                     | 431-480    | IN-03: `task_code_health_scan` shells out to `find` + `cat` (CLAUDE.md "What NOT to Do" violation in spirit) | ℹ️ Info    | Pre-existing scope; not Phase 24 scope; cross-platform `find -newer` semantics drift across CI platforms                         |
| `src-tauri/src/commands.rs`                       | 2342-2356  | IN-04: `forged_names` HashSet rebuilt per-tool-call inside chat tool loop                            | ℹ️ Info    | N table scans where 1 would suffice; perf concern for long agentic runs                                                          |
| `src-tauri/src/dream_mode.rs`                     | 251-254    | IN-05: `task_skill_synthesis` returns hardcoded "Reviewed skill patterns" insight                    | ℹ️ Info    | Insight surfaced via `dream_task_complete` doesn't reflect actual count of synthesized skills                                    |
| `src-tauri/src/dream_mode.rs`                     | 705        | IN-06: `dream_trigger_now` skips `background_ai_enabled` check that `run_dream_session` has         | ℹ️ Info    | Manual trigger flips DREAMING then immediately discovers config disabled and unwinds; momentary UI confusion                     |
| `src-tauri/src/intent_router.rs`                  | 108-110    | IN-07: regex has redundant `(?i)` flag (input is already lowercased by classify_intent_class)        | ℹ️ Info    | Defensive but undocumented; minor                                                                                                |
| `src-tauri/src/skills/lifecycle.rs`               | 166-183    | IN-08: `last_5_trace_hashes` callers must gate on `len() == 5`; not pinned in docstring             | ℹ️ Info    | Documented intent (D-24-B); just needs a one-line docstring note                                                                 |
| `src-tauri/src/bin/skill_validator.rs`            | 286-400    | IN-09: `run_list_diff` failure paths (invalid session_id) not covered by unit tests                  | ℹ️ Info    | CLI exit-code contract for invalid session_id not pinned                                                                         |

### Test Isolation Gap (additional, beyond REVIEW.md)

| File / Module                                              | Issue                                                                                                                            | Severity   | Impact                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills::pending::tests`, `skills::lifecycle::tests`, `dream_mode::tests`, `commands::phase24_e2e_tests` | Phase 24 tests share `BLADE_CONFIG_DIR` override + `~/.blade/skills/.pending/` + `~/.blade/sessions/` across test threads — no module-level `ENV_LOCK` Mutex (Phase 22's tool_forge::tests pattern) extended into Phase 24 modules | ⚠️ Warning | `cargo test --lib` (parallel default) reports 16 failures; `cargo test --lib -- --test-threads=1` reports 5 carry-forward failures (pre-existing on stashed master). Net 11 Phase-24-induced parallel-mode failures. Production code has no regression. |

### Human Verification Required

#### 1. Operator-deferred runtime UAT for chat-injected proactive merge prompt

**Test:** When the operator is idle ≥1200s and a forged_tools pair has cosine_sim ≥0.85 + identical 5-trace, dream_mode writes a `.pending/<id>.json` proposal; ≥30s later the proactive_engine drain surfaces a chat-injected prompt; operator types `yes <id>`; merged ForgedTool persists, sources archived, confirmation rendered in chat stream WITHOUT model leakage.
**Expected:** End-to-end loop closes via the React/Tauri surface; ActivityStrip shows `dream_mode:consolidate` + `dream_mode:prune` rows.
**Why human:** Chat-first pivot anchor (memory `feedback_chat_first_pivot.md`, 2026-04-30) and CLAUDE.md Verification Protocol — runtime UAT for chat-injected proactive prompts is operator-deferred to v1.3 milestone close.

#### 2. Operator-deferred runtime UAT for chat-injected proactive skill-from-trace prompt

**Test:** Same as above for `kind="generate"` branch — proposed_skill_md text written under `<user_root>/<sanitized_name>/SKILL.md` after operator's `yes <id>`; subsequent `skill_validator list --diff <prev_session_id>` shows the new skill in the `added` bucket.
**Expected:** SKILL.md emitted with valid YAML frontmatter + body; resolution order honors workspace > user > bundled.
**Why human:** Same UAT-deferred posture; commands::phase24_e2e_tests only exercises the merge branch end-to-end (kind="generate" branch is type-checked but not run-time exercised in the e2e test).

#### 3. ActivityStrip emits dream_mode:* rows during a real dream cycle

**Test:** Seed 5+ stale forged_tools + trigger `dream_trigger_now` in dev; observe ActivityStrip rows.
**Expected:** Three distinct rows under `[Voyager]` module label with `dream_mode:prune` / `dream_mode:consolidate` / `dream_mode:generate` action prefixes; count + items capped at 10 with `... (+N more)` sentinel.
**Why human:** Cross-process JSONL row inspection requires a running dev session with the React UI mounted; the unit test covers helper-shape invariant but not strip-rendering.

### Gaps Summary

**No critical defects.** All 6 DREAM-IDs delivered with passing test trail under `cargo test --lib -- --test-threads=1`; build green; chat-streaming contract preserved at the new chat-injected ProposalReply branch; single-canonical record_tool_use call site (Pitfall 2 mitigation); 6-place config rule N/A (no new config field); module registration green for both `skills::lifecycle` and `skills::pending`.

**Outstanding gaps (1 test-isolation + 6 REVIEW warnings):**

1. **Test isolation under cargo test --lib (parallel default)** — Phase 24 added 4 modules whose tests share `BLADE_CONFIG_DIR`, `.pending/`, and `sessions/` filesystem state. The Phase 22 `ENV_LOCK` pattern wasn't extended; result is 11 net new parallel-mode failures. Production code has no regression. Either extend `ENV_LOCK` uniformly or document `--test-threads=1` as the canonical Phase 24 + downstream command (24-VALIDATION.md does specify it; CLAUDE.md does not). **Phase-close decision: defer to v1.4 with a follow-up note in REQUIREMENTS.md, OR open a Wave-4 cleanup plan within Phase 24 before milestone close.**

2. **REVIEW WR-01..WR-06** — six warnings from 24-REVIEW.md, all triaged below. None block phase close per REVIEW.md `status: issues_found` posture (`The Phase 24 substrate is shippable, but the 6 warnings should be addressed (or explicitly accepted) before milestone close per the BLADE Verification Protocol`).

**REVIEW Warning Triage:**

| ID    | Triage           | Rationale                                                                                                                               |
| ----- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| WR-01 | **defer to v1.4** | Self-correcting via next dream cycle; user-facing message lies briefly but state converges. Fix is mechanically minimal and documented in REVIEW.md. |
| WR-02 | **defer to v1.4** | Naming/semantics concern, not correctness. `tasks_attempted` rename is the safe fix; no behavior change.                                   |
| WR-03 | **address before v1.3 close** | Concurrency hazard with manual trigger surface. Auto-loop already uses compare_exchange; pattern divergence is the bug. Single-line fix.   |
| WR-04 | **address before v1.3 close** | Documented contract diverges from code. Either gate the DELETE OR update the docstring; both are cheap.                                  |
| WR-05 | **defer to v1.4** | Frontend already hardens against double-events on other channels; UI flicker is cosmetic. Track as a frontend listener-idempotency note. |
| WR-06 | **defer to v1.4** | Dead-code filter; `archived_now ⊆ current_names` invariant holds in practice. Test gap is the real action item.                        |

**Test-Isolation Triage:** **defer to v1.4 with documentation update.** 24-VALIDATION.md already locks `--test-threads=1` as the canonical command. Add a CLAUDE.md note + REQUIREMENTS.md follow-up entry; uniform `ENV_LOCK` extension across the 4 affected modules is a Wave-4 cleanup if operator wants stricter isolation.

---

_Verified: 2026-05-02T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Test posture: cargo test --lib -- --test-threads=1 (per 24-VALIDATION.md §"Sampling Rate")_
_Build posture: cargo build --lib clean; 1 carry-forward warning (reward.rs:236 timestamp_ms — Phase 22 baseline)_
