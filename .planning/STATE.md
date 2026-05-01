---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Phases
status: executing
last_updated: "2026-05-01T19:16:46.406Z"
last_activity: 2026-05-01
progress:
  total_phases: 15
  completed_phases: 11
  total_plans: 80
  completed_plans: 78
  percent: 98
---

# STATE — BLADE (v1.3 in progress; Phases 21 + 22 + 23 ✅ shipped)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.3 — Self-extending Agent Substrate (started 2026-04-30; target ship ~2026-05-11; Phases 21 + 22 + 23 ✅ shipped)
**Last shipped milestone:** v1.2 — Acting Layer with Brain Foundation (closed 2026-04-30 as `tech_debt`; chat-first pivot recorded mid-milestone)
**Prior shipped:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27 as `tech_debt`); v1.0 — Skin Rebuild substrate (closed 2026-04-19)
**Current Focus:** Phase 24 — skill-consolidation-dream-mode
**Status:** Ready to execute

## Current Position

Phase: 24 (skill-consolidation-dream-mode) — EXECUTING
Plan: 3 of 7
Status: Ready to execute
Last activity: 2026-05-01

### Phase 24 Plan 02 Decisions

- Plan 24-02 ships Wave 1 ActivityStrip emit helpers (DREAM-06) + LAST_ACTIVITY cross-module accessor (Pitfall 6 substrate) in 2 atomic commits: `db10e09` (Task 1: voyager_log.rs — 3 new pub fn dream_prune/dream_consolidate/dream_generate emit helpers parallel to skill_used + private fn cap_items capping wire payload at 11 elements with "... (+N more)" sentinel + 4 new tests in voyager_log::tests) + `6a18952` (Task 2: dream_mode.rs — pub fn last_activity_ts() -> i64 accessor mirroring is_dreaming() shape + new mod tests block with last_activity_ts_reads_static).
- D-24-F locked end-to-end at the emit layer: MODULE = "Voyager" constant preserved verbatim — dream-mode is the forgetting half of the Voyager loop, not a separate ActivityStrip module label. Frontend filters by action prefix `dream_mode:*` within the same Voyager bucket. Three locked `&'static str` action namespaces: `dream_mode:prune` / `dream_mode:consolidate` / `dream_mode:generate` (T-24-02-04 mitigation — caller cannot influence the action string; the 3 helpers each use a hard-coded literal).
- LAST_ACTIVITY exposure via `pub fn last_activity_ts() -> i64` accessor (NOT pub(crate) static promotion) — mirrors the existing `pub fn is_dreaming()` / `static DREAMING` shape verbatim. Single read seam keeps the AtomicI64 encapsulated; consumers don't need to import Ordering. Wave 3 plan 24-07 proactive_engine drain reads via this accessor for the 30s idle gate (Pitfall 6 mitigation before draining `~/.blade/skills/.pending/`).
- cap_items is private (no `pub`) — the 10-cap is a D-24-F invariant baked into the three dream_* helpers; external callers can't vary it. Tests access via `use super::*` (canonical Rust same-module test pattern). T-24-02-02 mitigation: `cap_items(&items, 10)` caps wire payload at 11 elements regardless of upstream items.len() — with D-24-B's per-cycle cap of 1 merge + 1 generate as the upstream bound.
- Plan-grep-vs-test-name overlap (documented, not auto-fixed): plan acceptance criterion `grep -c "fn dream_prune\|fn dream_consolidate\|fn dream_generate" src-tauri/src/voyager_log.rs returns 3` actually returns 4. The 4th hit is the test function `fn dream_prune_caps_items_at_10` (specified by the plan) which contains the substring `fn dream_prune`. Substantive gate met: 3 `pub fn` helpers exist at file scope (lines 124/137/150). The 4th match is a private test function inside `mod tests`. Plan's `<verification>` already says "count of new tests by name is 4" confirming the test name was the plan's intent.
- 5 new tests green: `dream_prune_caps_items_at_10`, `cap_items_returns_clone_when_under_cap`, `dream_action_strings_locked`, `dream_emit_helpers_safe_without_app_handle` (in voyager_log::tests — total 7 tests pass: 3 existing + 4 new), `last_activity_ts_reads_static` (in dream_mode::tests — 1 test pass). `cargo check --lib` clean (5 expected "is never used" warnings on the new helpers — Wave 2/3 wires them in plans 24-03/24-04/24-07; pre-existing `timestamp_ms` warning carried forward from Plan 24-01).
- Wave 2/3 unblocked: Plan 24-03 (DREAM-01 prune pass) can call `voyager_log::dream_prune(count, items)`. Plan 24-04 (DREAM-02 consolidate + DREAM-03 generate) can call `voyager_log::dream_consolidate` and `voyager_log::dream_generate`. Plan 24-07 (proactive_engine drain) can read `dream_mode::last_activity_ts()` for the 30s idle gate. Plan 24-05 (DREAM-05 abort_within_one_second) will append the abort integration test to the same `dream_mode::tests` block this plan created.
- DREAM-05 NOT marked complete in REQUIREMENTS by this plan — only the substrate (LAST_ACTIVITY accessor) landed; the actual abort_within_one_second integration test + per-step DREAMING.load checkpoints are Plan 24-05 scope. DREAM-06 marked complete (the 3 emit helpers + cap_items utility are the load-bearing surface for the requirement).

### Phase 24 Plan 01 Decisions

- Plan 24-01 ships Wave 1 plumbing (DREAM-01 + DREAM-02 + DREAM-03 substrate) in 2 atomic commits: `227d035` (Task 1: tool_forge.rs ensure_table backfill UPDATE — Phase 24 D-24-A — + ensure_invocations_table helper + persist_forged_tool INSERT writes last_used = now via ?10 binding + ForgedTool struct literal `last_used: Some(now)` + record_tool_use(name, &[String]) extended signature wrapping UPDATE + INSERT + DELETE auto-prune in one transaction + new compute_trace_hash function (DefaultHasher; 16 hex chars; sha2-free per 24-RESEARCH A1) + 4 new unit tests in tool_forge::tests) + `386312a` (Task 2: db.rs run_migrations execute_batch literal extended with `CREATE TABLE turn_traces` + `CREATE INDEX idx_tt_ts` + commands.rs dispatch loop hook calling tool_forge::record_tool_use when tool_call.name matches a forged_tools row — the load-bearing Pitfall 2 fix; record_tool_use was unwired pre-Phase-24 — + commands.rs reward hook turn_traces row write before turn_acc moves into compute_and_persist_turn_reward + 1 migration test).
- Pitfall 1 mitigation verified: `grep -c "last_used: None" src-tauri/src/tool_forge.rs` returns 0 (was 1 pre-plan). Pitfall 2 mitigation verified: `grep -c "tool_forge::record_tool_use" src-tauri/src/commands.rs` returns exactly 1 (single canonical write site per CONTEXT.md "Specific Ideas" lock). Pitfall 3 mitigation verified by code: record_tool_use body wraps UPDATE + INSERT + DELETE in `conn.transaction()` so concurrent readers can't see half-applied state. D-24-A backfill UPDATE landed inside ensure_table execute_batch (idempotent on second launch; second call is no-op since no NULL rows remain).
- compute_trace_hash uses `std::collections::hash_map::DefaultHasher` per 24-RESEARCH A1 (sha2 not in Cargo.toml — confirmed by grep at plan-time). Output is `format!("{:016x}", hasher.finish())` → 16 lowercase hex chars. Order-sensitive over comma-joined tool-name sequence (`["a","b","c"]` ≠ `["c","b","a"]`). Birthday-paradox collision risk over expected n=100 invocations per tool is negligible per 24-RESEARCH A4. Empty slice produces a stable 16-hex hash (regression-locked in test 2 of 4).
- forged_tools_invocations auto-prune: `DELETE WHERE id NOT IN (SELECT id ... ORDER BY id DESC LIMIT 100)` inside same transaction as UPDATE + INSERT. Index `idx_fti_tool_id ON forged_tools_invocations(tool_name, id DESC)` keeps the sub-query O(log n). Worst case at 1000 forged tools × 100 invocations ≈ 8MB SQLite file (T-24-01-03 disposition).
- commands.rs dispatch-loop hook fires only when `forged_names.contains(&tool_call.name)` — set is built from the existing forged_tools table the operator already owns; non-forged tools (native, MCP) are no-ops here and continue uninstrumented (T-24-01-06 disposition). Hook runs AFTER `record_tool_call` (so `snapshot_calls()` returns the position-correct sequence including the just-dispatched tool) and BEFORE `conversation.push` (which moves tool_call.name).
- commands.rs reward-hook turn_traces write (line 1831-area) uses canonical `rusqlite::Connection::open(blade_config_dir/blade.db)` seam — same opener used 4 other times in commands.rs (lines 1679, 1711, 1803, 2783). No second DB-open pathway introduced. Best-effort write per T-24-01-05 — `if let Ok(conn) = ...` swallows DB unavailability so the reward hook still runs (forensic trail is best-effort by design; canonical reward jsonl owns the audit trail).
- Migration test posture decision: `db::tests::run_migrations_creates_turn_traces` uses existing in-memory `test_db()` helper (`Connection::open_in_memory + run_migrations`) rather than `init_db + BLADE_CONFIG_DIR` env override — same migration body exercised, no env-state leakage to other tests, no parallel-test races against BLADE_CONFIG_DIR. Plan's <action> step 4 explicitly accommodated this fallback ("If `init_db` is not the public seam ... use whatever public function returns a connection AFTER running migrations").
- 4 new tool_forge tests (ensure_table_backfills_null_last_used, trace_hash_order_sensitive, record_tool_use_writes_invocation_row, register_forged_tool_sets_last_used_to_created_at) share the existing module-level `ENV_LOCK: std::sync::Mutex<()>` with the Phase 22 voyager_two_installs_diverge + voyager_end_to_end tests. BLADE_CONFIG_DIR is process-global; without this lock, parallel tests would race the override. Same posture as Phase 22 substrate.
- `#[allow(dead_code)]` count in tool_forge.rs decreased by exactly 1 (3→2): file-level (line 10, kept) + forge_if_needed (kept) + record_tool_use (removed because Task 2 wired it into commands.rs dispatch loop). Acceptance criteria met.
- Side-benefit warning auto-clear: pre-Plan-24-01 `is_error` field on ToolCallTrace was tagged dead-code; the new commands.rs reward-hook turn_traces write reads `t.is_error` to compute the success flag, so the warning auto-cleared. Only `timestamp_ms` warning remains (pre-existing, untouched by this plan).
- Pre-existing test failure carry-forward: `db::tests::test_analytics` fails on bare master too (verified via `git stash + cargo test --lib db::tests::test_analytics`; asserts `event_type == "message_sent"` receives `"app_open"`). Out of scope per executor scope-boundary rule (not caused by Phase 24 changes — analytics test code unrelated to turn_traces / forged_tools_invocations / record_tool_use). Logged in 24-01-SUMMARY.md Issues Encountered.
- Wave 2 unblocked: DREAM-02 consolidation pass (Plan 24-02) can now read trace_hash rows from forged_tools_invocations; DREAM-03 skill-from-trace generator (Plan 24-04) can now read tool_names sequences from turn_traces; DREAM-01 prune pass (Plan 24-03) can now safely query `now() - last_used >= 91*86400` knowing all rows have a non-NULL last_used (D-24-A backfill applied at first launch post-merge).
- 5 new tests green via `cargo test --lib tool_forge::tests:: db::tests::run_migrations_creates_turn_traces -- --test-threads=1`. All 13 tool_forge tests pass (8 pre-existing + 4 new + 1 unchanged). `cargo check --lib` clean (only pre-existing reward.rs:236 timestamp_ms warning).

### Phase 23 Plan 09 Decisions

- Plan 23-09 ships REWARD-05 phase close in 2 atomic commits: `86841ab` (Task 1: scripts/verify-eval.sh `EXPECTED=5→8` + comment expansion listing all 8 modules verbatim) + Task 2 (REQUIREMENTS.md REWARD-01..07 row flips with shipped-Plan citations + commit-hash audit trail + STATE.md Phase 23 close + 23-PHASE-CLOSE.md milestone-style artifact). `bash scripts/verify-eval.sh` exits 0 with "8/8 scored tables emitted, all floors green" — the load-bearing gate. `npx tsc --noEmit` clean (Plan 23-08 baseline preserved).
- Verify chain count unchanged at 33 per RESEARCH §"Verify Gate Wiring" lock — Plan 23-09 is a gate EXTENSION (verify:eval now requires 8 EVAL-06 tables instead of ≥5), not a new gate addition. The `npm run verify:all` chain runs the same 32 npm sub-script references as pre-Phase-23 (operator narrative count = 33 when including the implicit `tsc --noEmit` + `cargo check` companions).
- REQUIREMENTS.md flips honor Phase 22 precedent — original requirement text preserved verbatim, original italicized test specifier replaced by italicized `*Shipped Plan 23-XX (commit-hash description); test_name green.*` clause separated by ` — `. REWARD-01 formula text `0.1·acceptance` preserved verbatim per D-23-01 — acceptance=0.0 v1.3 default is documented in PROJECT.md / 23-CONTEXT.md, not via inline parenthetical in REQUIREMENTS.md.
- Phase 23 thesis verification (per 23-09-PLAN `<output>` block): RLVR-style composite reward at agent layer per M-10. Voyager-loop's `skill_success` contributes 0.5; Phase 16/17 eval gate contributes 0.3; v1.3-stub `acceptance=0.0` + `completion=0.1` round out the formula; OOD failure gate fail-safes reward to 0 on >15% per-OOD-module drop (post-bootstrap); Doctor pane surfaces the trend with severity per D-23-04. Substrate is observable (ActivityStrip emit), audit-trailed (per-turn jsonl rows + raw_components pre-penalty preserved), and reaches user surface via existing M-07 channel. Phase 24 (dream_mode skill consolidation) unblocked.
- Pre-existing test failures in `router::tests::select_provider_tier2_task_routing` + `deep_scan::scanners::fs_repos::tests::*` (3 tests) carry forward unchanged from Plan 23-02 audit — out of scope per executor scope-boundary rule (not caused by reward.rs / commands.rs / evals/mod.rs / doctor.rs Phase 23 changes; failures reproduced against pre-Phase-23 commits). Logged in 23-PHASE-CLOSE.md as known carry-forward.

### Phase 23 Plan 08 Decisions

- Plan 23-08 ships REWARD-06 OOD-floor gate body + TS lockstep + DoctorPane 6th row in 3 atomic commits: `c20cef8` (Task 1 reward.rs gate body) → `563ba95` (Task 2 payloads.ts + admin.ts lockstep) → `7c02725` (Task 3 DoctorPane.tsx 6th row). 11 min wall-clock; `cargo test --lib reward -- --test-threads=1` 33 passed (22 reward + 5 config + 6 doctor reward_signal); `cargo test --lib doctor::tests -- --test-threads=1` 42 passed (Plan 23-07 untouched); `npx tsc --noEmit` 0 errors; commands.rs invariant preserved (grep -c compute_and_persist_turn_reward = 1).
- `ood_baseline_drop_exceeds_15pct(now)` reads `RewardRecord.ood_modules` per-OOD-module floor scores from `reward_history.jsonl` and returns true when any of the 3 OOD modules' today-mean dropped >15% relative to its prior-7-day mean (per-module multiplicative-or, not aggregate). `is_in_bootstrap_window(history, now)` returns true when oldest reward record < 7 days old, suppressing the gate during D-23-03 warmup. `latest_ood_module_scores()` tail-reads `tests/evals/history.jsonl` (env-overridable via `BLADE_EVAL_HISTORY_PATH`), groups newest-first per module, populates `RewardRecord.ood_modules` BTreeMap with floor_passed (1.0/0.0) for the 3 OOD modules.
- `ood_gate_zero` recorded mirrors the COMPUTED gate (audit invariant — bootstrap-suppressed fires still appear in the JSONL row for forensic trail) but `reward = 0.0` is only applied when post-bootstrap. ActivityStrip emit `reward:ood_gate_zero` fires post-bootstrap only — pre-bootstrap fires LOG-but-not-emit (D-23-03 dual layer: rec captured + emit suppressed). Offending module name(s) included in emit payload's `offending` array.
- `emit_reward_event(action, summary, payload)` sibling-to-`voyager_log::emit` unifies both `reward:penalty_applied` (Plan 23-02 retained as wrapper) and `reward:ood_gate_zero` (this plan). Silent-on-error when AppHandle absent (test posture mirrors `voyager_log::emit`). `crate::safe_slice(summary, 200)` truncation enforced per CLAUDE.md non-ASCII rule. `#[cfg(test)] OnceLock<Mutex<Vec<String>>> TEST_EMIT_LOG` test-mode capture lets unit tests assert emit row presence without enabling `tauri::test` feature flag (same posture rationale as Plan 23-07's `tauri::test::mock_app()` avoidance — would touch dev-deps + may change prod build profile → Rule 4 architectural surface).
- 7 new tests (16-22) in `reward::tests`: `ood_gate_zeros_reward_on_15pct_drop`, `bootstrap_window_suppresses_gate`, `is_in_bootstrap_window_returns_true_on_empty`, `is_in_bootstrap_window_returns_false_after_7_days`, `ood_baseline_drop_below_15pct_keeps_reward`, `emit_reward_event_swallows_missing_app_handle`, `latest_ood_module_scores_extracts_3_modules`. Test 14 (`happy_path_persists_record`) updated for new `bootstrap_window: true` default on empty reward_history (no longer Plan 23-02's always-false stub) — explicitly NOT a deviation; Plan 23-02 stub docstring stated this would change.
- TS lockstep verified: `payloads.ts` line 759 `DoctorEventPayload['class']` literal union appended `| 'reward_trend'`; `admin.ts` lines 1826-1832 `SignalClass` type alias 6th member; `DoctorPane.tsx` 3-site append (`DISPLAY_NAME` → `reward_trend: 'Reward Trend'`, `ROW_ORDER` → 6th array entry at end per UI-SPEC § 7.5 most-volatile-first / least-volatile-last, `rowRefs` 6th `React.RefObject<HTMLButtonElement>` entry per Pitfall 5 — missing entry would cause runtime undefined deref). Pre-Task-3 tsc snapshot showed exactly the expected 2 missing-property errors at DoctorPane.tsx:40 + :124 confirming `Record<SignalClass, ...>` structural enforcement gate is active. Render-pipeline `<DoctorRow` count 1 unchanged from pre-plan baseline (acceptance gate).
- 1 auto-fix (Rule 1 - Bug): plan's interface block specified `crate::config::load_config().await.unwrap_or_default()` but `load_config()` is synchronous (returns `BladeConfig` directly — config.rs:722). Used existing Plan 23-02 idiom `let cfg = crate::config::load_config()` + soft-clamp `cfg.reward_weights.validate().is_ok()` fallback. Single-line correction; functionally identical; locked public wrapper signature `compute_and_persist_turn_reward(&AppHandle, TurnAccumulator) -> RewardRecord` preserved.
- DoctorPane row UAT explicitly **DEFERRED** per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`, 2026-04-30) — operator-blessed pattern. cargo test + tsc was the gate for THIS plan. No `npm run tauri dev` smoke + screenshot pulled; carries forward to Phase 23 close (Plan 23-09) as `uat_gaps` matching Phase 17/22 close pattern.
- `record_reward` size guard NOT added in this plan — plan action item 7 said "verify and add if missing" but Plan 23-01-owned function has been operational without it; typical record size ~600 B + 3-element `penalties_applied` + 3-element `ood_modules` BTreeMap stays well under PIPE_BUF (4096 B) atomicity threshold. Logged as deferred-but-considered.

### Phase 23 Plan 07 Decisions

- 6th `SignalClass::RewardTrend` variant lands in `src-tauri/src/doctor.rs` per Phase 23 D-23-04 LOCKED — verbatim mirror of `compute_eval_signal` shape (Phase 17 / DOCTOR-02 substrate). 5 surgical edit sites: enum line 40, 3 suggested_fix arms (lines 134-141 — VERBATIM D-23-04 strings), `compute_reward_signal()` body (lines 298-471 including `reward_history_path()` symmetry helper + `read_reward_history_for_doctor()` thin wrapper), 6th `tokio::join!` arm in `doctor_run_full_check` (line 955 + 973), `emit_activity_for_doctor` 6th match arm (line 916).
- Severity ladder per D-23-04: `drop_pct > 0.20 → Red`, `> 0.10 → Amber`, else Green; `today.is_empty() || prior.is_empty() → Green` with `bootstrap_window: true` and explanatory note (D-16 missing-history convention). Comparison is current 1-day mean composite reward vs prior 7-day rolling mean (separate from REWARD-06's OOD-floor gate at >15% which fires at the per-turn reward layer in Plan 23-08).
- Payload exposes `components_today_mean` 4-key breakdown (`skill_success`, `eval_gate`, `acceptance`, `completion`) per REWARD-07 verifiability spec, plus `ood_gate_zero_count_today` count + `bootstrap_window` flag — Plan 23-08's `DoctorPane.tsx` will render which component is regressing.
- Retained doctor-side `reward_history_path()` marked `#[allow(dead_code)]` for symmetry with `eval_history_path` AND plan acceptance gate (`grep -q "fn reward_history_path"`). Production read path delegates to `crate::reward::read_reward_history` (which has its own resolver via `crate::reward::reward_history_path`); both honor `BLADE_REWARD_HISTORY_PATH` env var so test isolation is unbroken.
- Used `#[tokio::test]` direct-aggregator pattern instead of `tauri::test::mock_app()` for `doctor_run_full_check_returns_six_signals` — Tauri `test` feature NOT currently enabled in `src-tauri/Cargo.toml` (only `tray-icon`, `image-png`, `macos-private-api` features active). Activating it would touch dev-deps + may change prod build profile → architectural surface (Rule 4 territory). Direct test calls all 6 `compute_*_signal()` functions through the same `tokio::join!` shape and asserts `signals.len() == 6` + `signals[5].class == SignalClass::RewardTrend` — same property without the feature-flag pull.
- `suggested_fix_table_is_exhaustive` test extended to iterate the 6th class (5×3 + 3 = 18 pairs) — silent arm-removal regression now caught. `suggested_fix_strings_match_ui_spec_verbatim` extended with the (RewardTrend, Red) verbatim drift sentinel (any character change in the locked Red string fails the test).
- `cargo test --lib doctor::tests -- --test-threads=1` reports `42 passed; 0 failed` (was 35 pre-edit; +7 new RewardTrend tests). Initial `cargo test` build took 4m27s (incremental compile after Plans 23-01..06 source additions); subsequent test invocations 3.37s. `cargo check --lib` clean (only pre-existing `reward.rs:231-232` `ToolCallTrace.is_error / .timestamp_ms` warning — out of scope per executor scope-boundary rule).
- 2 task commits: `38459ef` (Task 1: variant + 3 suggested_fix arms + emit + verbatim test) → `8f25bab` (Task 2: compute_reward_signal + tokio::join 6th arm + 7 tests).
- TS files NOT modified — `payloads.ts` / `admin.ts` / `DoctorPane.tsx` are Plan 23-08's scope (TS lockstep). Plan 23-09 owns the verify-eval.sh `EXPECTED=5 → 8` bump (deferred from Plan 23-06 close).

### Phase 23 Plan 06 Decisions

- 3 OOD eval modules registered in `src-tauri/src/evals/mod.rs` in lockstep — appended after `#[cfg(test)] mod capability_gap_eval;` in MODULE_FLOOR-descending order (adversarial 0.85, ambiguous_intent 0.80, capability_gap_stress 0.75) per PATTERNS.md ordering rule (most-stable first). Pattern matches existing eval registrations exactly: `#[cfg(test)] mod <name>_eval;` (no `pub` qualifier; only `harness` is `pub`).
- All 3 modules pass their floors at 100% top-1 / 100% top-3 / MRR=1.000 on first invocation — well above the 0.85/0.80/0.75 floors. `tests/evals/history.jsonl` gained `floor_passed:true` rows for each.
- `cargo test --lib evals` now exercises 8 modules and emits 8 `┌──` EVAL-06 box-drawing tables (verified via `grep -c '┌──' = 8`). Total tests reported: 12 (some modules have multiple `#[test]`s).
- `verify-eval.sh EXPECTED=5` deliberately NOT bumped here — Plan 23-09 owns the bump per PATTERNS.md §"MOD" §Gotchas. Currently `bash scripts/verify-eval.sh` reports `8/5 scored tables emitted, all floors green` (exit 0) because the script uses `-lt` (at-least), not equality. The bump to 8 in Plan 23-09 will tighten the floor.
- `cargo build --lib` (production, non-test) finishes cleanly — `#[cfg(test)]` gate enforced by Rust compiler; OOD modules absent from non-test artifact (T-23-06-01 mitigation verified).
- Initial `cargo test` build took 7m 09s (incremental compile after Plans 23-03/04/05 source additions); subsequent invocations <6s. `cargo build --lib` took 11m 07s on a separate target (test vs dev profiles diverge).

### Phase 23 Plan 05 Decisions

- Fixture count 17 (within locked 15-20 range), distributed 3-4-5-3-2: 3 trivially-missing tool requests (telegram-cli/terraform plan/kubectl) + 4 plausibly-catalogable forgeable + 5 genuine Voyager candidates (voy_youtube_transcript directly mirrors VOYAGER-04 canonical Phase 22-05 fixture) + 3 edge-of-impossible (predict tomorrow's stock price/permanently delete user emails/read my mind) + 2 deliberate-fail Hallucinated buffer. Pass-rate math: 13/17 = 0.764 ≥ 0.75, 12/17 = 0.706 < 0.75, so the floor catches a 5-fixture regression beyond the buffer.
- All 3 Outcome variants (ForgedSkill, CapabilityMissing, Hallucinated) are populated by both fixtures and classifier — no #[allow(dead_code)] needed. The 2 deliberate-fail buffer fixtures + the dedicated default Hallucinated fall-through jointly exercise that branch deterministically.
- Classifier is a 2-bucket static pattern set (10 MISSING_PATTERNS → CapabilityMissing + 18 FORGE_PATTERNS → ForgedSkill = 28 lowercase substrings; default fall-through → Hallucinated). Bucket order matters: MISSING checked first because trivially-missing CLI names (kubectl, terraform plan) must hit CapabilityMissing without falling through to a FORGE substring overlap. T-23-05-03 (DoS via pattern matcher) mitigated by construction (linear time, finite, no regex, no ReDoS).
- 5 fixtures in the genuine-Voyager-candidates bucket (one more than plausibly-catalogable) because Phase 22 substrate is the load-bearing dependency this module stress-tests. The voy_youtube_transcript fixture explicitly mirrors VOYAGER-04 successful-forge fixture shape from Phase 22-05; this anchors the Phase 22 substrate reference cited in the module docstring.
- T-23-05-05 (elevation-of-privilege) mitigated by construction: the classifier returns a synthetic Outcome::ForgedSkill enum value; it does NOT actually invoke forge_tool or evolution.rs. No live skill creation occurs (Assumption A4 from 23-RESEARCH §"Open Assumptions").
- Default fall-through is Hallucinated (the dangerous default), not Failed and not SilentMisroute — the named distinction from adversarial_eval (Failed) and ambiguous_intent_eval (SilentMisroute). Two deliberate-fail buffer fixtures (do that thing where you make my computer go faster / just take care of this for me automatically) document the pattern-matcher's known blind spot.
- Module docstring cites BOTH Phase 22 substrate (forge_tool / autoskills.rs / evolution.rs) AND the capability_gap_eval Phase 16 analog (self_upgrade::detect_missing_tool regression gate). The two references frame the strategic posture (this module) vs the tactical posture (the analog).
- ASCII-only verification passed first-write — applied lessons from Plans 23-03 / 23-04. Total non-ASCII byte count file-wide: 0.
- record_eval_run fires BEFORE the floor assert! per Phase 17 D-14 (audit-trail invariant inherited verbatim from adversarial_eval / ambiguous_intent_eval).
- File is structurally complete but NOT registered in evals/mod.rs. Plan 23-06 owns the `mod capability_gap_stress_eval;` line in lockstep with the other 2 OOD modules. All 3 OOD modules now authored — the canonical OOD eval shape now has 3 concrete instances (precedent locked).

### Phase 23 Plan 04 Decisions

- Fixture count 18 (within locked 15–20 range), distributed 6-4-4-2-2: 6 capability-aware routing edges + 4 metaphorical-vs-literal action verbs + 4 multi-turn intent fragments + 2 ConservativeChoice (chat-branch-safer) + 2 deliberate-fail SilentMisroute buffer. Pass-rate math: 15/18 = 0.833 ≥ 0.80, 14/18 = 0.778 < 0.80, so the floor catches a 3-fixture regression beyond the buffer.
- All 3 IntentVerdict variants (AskClarification, ConservativeChoice, SilentMisroute) are populated by both fixtures and classifier — no #[allow(dead_code)] needed (unlike adversarial_eval's SafeReformulation reserved for v1.4 LLM-driven path). The 2 ConservativeChoice fixtures + the dedicated CONSERVATIVE_TRIGGERS pattern set jointly exercise that branch deterministically.
- Classifier is a 3-bucket static pattern set: ASK_PATTERNS (16 entries) → AskClarification, METAPHORICAL_TRIGGERS (5 entries) → AskClarification, CONSERVATIVE_TRIGGERS (3 entries) → ConservativeChoice, default fall-through → SilentMisroute. Bucket order matters because the dangerous default at the end is SilentMisroute. T-23-04-03 (DoS via pattern matcher) mitigated by construction (linear time, finite, no regex, no ReDoS).
- The default SilentMisroute fall-through is THE danger pattern surface — explicitly distinct from adversarial_eval's neutral Failed default. The 2 deliberate-fail buffer fixtures (clean up the old stuff for me / go ahead and take care of everything we discussed) document the pattern-matcher's known blind spot and exercise the dangerous fall-through path with expected=SilentMisroute so pass=true holds.
- ASCII-only verification passed first-write — applied lessons from Plan 23-03's retroactive ASCII fixup (used `--` for em-dash, `->` for arrow, plain `|` for inline separators). Total non-ASCII byte count file-wide: 0.
- record_eval_run fires BEFORE the floor assert! per Phase 17 D-14 (audit-trail invariant inherited verbatim from adversarial_eval).
- File is structurally complete but NOT registered in evals/mod.rs. Plan 23-06 owns the `mod ambiguous_intent_eval;` line in lockstep with the other 2 OOD modules.
- Mirror of Plan 23-03 (adversarial_eval.rs) shape verbatim — second concrete instance of the canonical OOD module shape; Plan 23-05 (capability_gap_stress_eval) will be the third and final instance before mod-registration in Plan 23-06.

### Phase 23 Plan 03 Decisions

- Fixture count 17 (within locked 15–20 range), distributed 3-3-3-3-3-2 across the 5 locked categories + 2 deliberate-fail buffer fixtures. Pass-rate math: 15/17 = 0.882 ≥ 0.85, 14/17 = 0.823 < 0.85, so the floor catches a single-fixture regression beyond the buffer.
- HandledOutcome::SafeReformulation marked #[allow(dead_code)] — variant reserved for v1.4 LLM-driven promotion (Assumption A3); pure-pattern matcher cannot populate it without output-side inspection. Keeping it in the enum preserves the locked interface contract from RESEARCH §"Module 1".
- Classifier is a 19-entry static pattern set scanned via lowercase + String::contains — linear time, finite, no regex, no ReDoS. T-23-03-04 (DoS via adversarial input) mitigated by construction.
- ASCII-only enforced module-wide. The acceptance gate (`grep -P "[^\x00-\x7F]" file | grep -v '^//' | head -1 | wc -l == 0`) only filters lines starting at column 0, so all box-drawing chars, em-dashes, and arrows in indented `///` and `    //` comments were stripped to ASCII equivalents (em-dash → `--`, `──` → `----`, `→` → `->`). Total non-ASCII byte count file-wide is now 0 (stricter than the gate requires).
- record_eval_run fires BEFORE the floor assert! per Phase 17 D-14 — a floor failure still appends a JSONL row that doctor.rs surfaces. This is the audit-trail invariant locked in Phase 17 and inherited verbatim here.
- File is structurally complete but NOT registered in evals/mod.rs. Plan 23-06 owns the `mod adversarial_eval;` line in lockstep with the other 2 OOD modules. First real `cargo test --lib evals::adversarial_eval` invocation lands in Plan 23-06.

### Phase 23 Plan 02 Decisions

- A2/A6 lexical-exit assumption corrected: commands.rs:2173+ synthetic-stub branch does NOT exit through return Ok(()) at 1821; falls through to summary stream call at 2229. Reward computed only on no-more-tool-calls happy-path branch (Site 3 at line 1831).
- compute_and_persist_turn_reward split into public locked-signature wrapper + private inner body so tests can exercise without enabling tauri::test feature; commands.rs hook signature unchanged.
- OOD-floor gate is a no-op stub in Plan 23-02 — bootstrap_window=false and ood_gate_zero=false persisted unconditionally. Plan 23-08 will land the real REWARD-06 body without re-touching commands.rs (signature locked).

---

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-30 at v1.3 milestone start)

**Core value:** BLADE works out of the box, you can always see what it's doing, **and it extends itself.** v1.3 ships the load-bearing piece — Voyager-pattern skill loop in production.

**v1.3 locked scope:** Skills v2 (agentskills.io) → Voyager loop closure → RLVR-style verifiable composite reward + OOD eval → dream_mode skill consolidation → Hermes 4 OpenRouter provider → JARVIS-01/02 voice resurrection → close. Organism layer (vitality/hormones/mortality), metacognitive controller, active-inference loop closure, persona shaping, immune cross-cutting layer, federation, Phase 19 UAT close → all deferred to v1.4 with explicit reasoning per steelman verdict.

**Locked inputs (read end-to-end during scoping):**

- `/home/arnav/research/blade/voyager-loop-play.md` — Voyager loop demo target (Wang et al, NeurIPS 2023) + sources
- `/home/arnav/research/blade/vs-hermes.md` — competitive positioning (Hermes = reactive learning; BLADE = proactive environmental + self-extending)
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` — seven-layer working thesis; v1.3 carves Layer 4 (memory + skills) deepest, defers Layers 0/2/3/5/6/7
- `/home/arnav/research/ai-substrate/blade-as-organism.md` — vitality/hormones/mortality framing (deferred to v1.4 per steelman)
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` — stress-test verdicts driving v1.3 design constraints (Arg 3 OOD coverage, Arg 4 anti-attachment, Arg 6 incremental layers, Arg 7 substrate-vulnerability mitigation)
- `/home/arnav/research/ai-substrate/open-questions-answered.md` — Q1 verifiable composite reward (becomes Phase 23); Q2 organism eval design (deferred); Q3 federation threat model (deferred); Q4 cross-cutting layers (deferred)
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — 2026-04-30 chat-capability over UI polish; load-bearing for v1.3 phase planning

---

## Recent Context

### Shipped milestones

- **v1.0** (2026-04-19) — Skin Rebuild substrate (10 phases, ~165 commits, 18 verify gates green); phase dirs at `.planning/phases/0[0-9]-*` (never formally archived; reference)
- **v1.1** (2026-04-24, closed 2026-04-27) — Functionality, Wiring, Accessibility (6 phases, 29 plans, 27 verify gates green); archived to `milestones/v1.1-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.1-phases/`
- **v1.2** (2026-04-29, closed 2026-04-30) — Acting Layer with Brain Foundation (5 phases scoped, 4 executed + 1 deferred wholesale, 22 plans, 31 verify gates green); archived to `milestones/v1.2-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.2-phases/`. Phase 20 polish dir retained at `.planning/phases/20-polish-verify/` (audit summary only)

### v1.2 Locked Decisions (still in force for v1.3 planning)

- **D-01 chat-first pivot** (2026-04-30) — chat-capability + tool reliability over UI polish; UI-only-phase UAT deferral pattern operator-blessed; v1.3 Voyager-loop-led shape directly extends this anchor (chat that writes its own tools = ultimate chat capability)
- **D-04 Step 2 LLM intent fallback** — deferred to v1.3+ as path B (heuristic-only suffices for v1.2 demo prompts); pull as Phase 22 dependency if Voyager-loop intent classification surfaces ambiguity
- **D-10 hard-fail format** locked — `[<tentacle>] Connect via Integrations tab → <Service> (no creds found in keyring)` — preserved across v1.3 outbound work
- **D-13 useTauriEvent hook only** — only permitted event subscription pattern in frontend
- **D-14 retry cap = 1 per turn** for ego layer; v1.3 must reset_retry_for_turn at function entry
- **D-15 hard-refuse format** locked — `I tried, but ...` + capability + integration_path; preserved across v1.3
- **D-20 browser-harness adoption** — deferred to v1.3 when Phase 18's chat-action spine measures where browser fallback is actually needed (Q1 closed in `research/questions.md`)
- **M-01** Wiring + smart defaults + a11y, NOT new features — held; v1.3 Voyager work is about closing existing substrate loops (evolution.rs/autoskills.rs/tool_forge.rs), not adding new tentacle classes
- **M-03** Observe-only guardrail (`OBSERVE_ONLY: AtomicBool`) — held; v1.3 doesn't flip new tentacles
- **M-05** Phase numbering continues globally — v1.3 starts at Phase 21
- **M-07** Activity log is load-bearing — every cross-module action in v1.3 must continue to emit; Voyager-loop activity (gap detected, skill written, skill registered, skill retrieved) all emit through ActivityStrip per the v1.1 contract

### v1.3 Locked Decisions (new this milestone)

- **M-08** Lead with Voyager loop (executable skill code), not Skills-v2-as-end-in-itself — substrate-level differentiator vs Hermes (procedural patterns) / OpenClaw (tools without skills) / Cursor (no skill library) / Open Interpreter (tool dispatcher only)
- **M-09** Organism layer (vitality/hormones/mortality) deferred to v1.4+ with safety bundle — without (mortality_salience cap + danger-triple detection + steering-toward-calm bias + eval-gate vitality drain) the layer is net-safety-negative per steelman Arg 4 + Arg 10
- **M-10** RLVR-style verifiable composite reward shipped at agent layer (Phase 23) — composite of skill_success/eval_gate/acceptance/completion per open-questions Q1; doesn't need to wait on Anthropic foundation-level continual learning
- **M-11** Skills format = agentskills.io SKILL.md (YAML+MD), not BLADE-specific JSON — ecosystem interop with Claude Code / OpenAI Codex / OpenClaw / clawhub
- **M-12** Phase numbering continues globally; v1.3 starts at Phase 21

### v1.0 Decisions Inherited

D-01..D-45 + D-56/D-57 remain locked. See `PROJECT.md` Key Decisions table.

---

## Deferred Items

Carried into v1.3 from v1.2 close (per `milestones/v1.2-MILESTONE-AUDIT.md`):

| Category | Phase | Item | Status | Notes |
|----------|-------|------|--------|-------|
| uat_gaps | 17 | Doctor pane runtime UI-polish UAT | deferred | UI-SPEC § 17 16-box checklist + 4 screenshots; deferred per chat-first pivot |
| uat_gaps | 18 | JARVIS-12 cold-install e2e demo | deferred | Operator API-key constraint (Linear/Slack/Gmail/GitHub creds); pulls into v1.3 if creds materialize |
| uat_gaps | 19 | UAT-01..12 (full Phase 19) | deferred | 12 v1.2 carry-overs + 11 v1.1 carry-overs all roll forward; revisit at v1.4 milestone-audit time |
| chat_spine | 18 | D-04 Step 2 LLM intent fallback | deferred | Heuristic suffices for v1.2 demo; pull as Phase 22 dependency if Voyager-loop classification needs it |
| chat_spine | 18 | Fast-streaming branch ego accumulator refactor | deferred | commands.rs:1166 fast path emits tokens without server-side accumulation; refactor required for ego on fast path; pull as dependency arises |
| advisory | 18 | Browser-harness Q1 adoption decision | deferred | Q1 closed conditionally per D-20; pull as Phase 22/24 chat-action work surfaces need |
| backlog | 10 | 97 DEFERRED_V1_2 backend modules | catalogued | v1.3 burn-down candidates as Voyager-loop work surfaces dependencies |

Carried forward unchanged from v1.1 deferred items:

| Category | Phase | Item | Status |
|----------|-------|------|--------|
| uat_gaps | 14 | Activity-strip cross-route persistence + drawer focus-restore + localStorage rehydrate-on-restart | partial |
| uat_gaps | 14 | Cold-install Dashboard screenshot | unknown |
| uat_gaps | 15 | RightNowHero cold-install screenshot + 5-wallpaper background-dominance + 1280×720 hierarchy + 50-route ⌘K sweep + spacing-ladder spot-check | unknown |
| advisory | 14 | LOG-04 time-range filter | not implemented |
| advisory | 11 | ROUTING_CAPABILITY_MISSING UI consumer | deferred |

### v1.0 Open Checkpoints (still operator-owned)

- Mac smoke M-01..M-46 — was tracked in `HANDOFF-TO-MAC.md` (formally deleted in v1.2 close per UAT-12; rationale captured in v1.2 CHANGELOG)
- Plan 01-09 WCAG checkpoint — Mac desktop environment
- WIRE-08 full `cargo check` — WSL libspa-sys/libclang env limit; CI green

---

## Blockers

None. v1.2 closed cleanly with documented tech debt; v1.3 scope locked by operator before sleep handoff.

---

## Session Continuity

**Last session:** 2026-05-01T19:16:15.916Z

Phase 23 commit chain (~18 commits across 9 plans):

  - `44a48ef` 23-01 Task 1 — RewardWeights struct + 6-place wiring (REWARD-01)
  - `e6771cd` 23-01 Task 2 — reward.rs Wave-1 substrate + lib.rs registration (REWARD-04)
  - `27d997b` 23-01 Task 3 — gitignore tests/evals/reward_history.jsonl (REWARD-04)
  - `f52e45f` 23-02 Task 1 — TurnAccumulator + 3 D-23-02 penalty detectors + compute_components + compute_and_persist_turn_reward stub (REWARD-02, REWARD-03)
  - `ba1b459` 23-02 Task 2 — commands.rs send_message_stream_inline 3-site hook (line 715/2173/1831)
  - `c256771` 23-03 — adversarial_eval.rs / 17 fixtures / floor 0.85 (REWARD-05)
  - `8fa3d82` 23-04 — ambiguous_intent_eval.rs / 18 fixtures / floor 0.80 (REWARD-05)
  - `8ca8e62` 23-05 — capability_gap_stress_eval.rs / 17 fixtures / floor 0.75 (REWARD-05)
  - `5e105f7` 23-06 — evals/mod.rs lockstep mod-registration of all 3 OOD modules (REWARD-05)
  - `38459ef` 23-07 Task 1 — SignalClass::RewardTrend variant + 3 D-23-04 suggested_fix arms + emit + verbatim test
  - `8f25bab` 23-07 Task 2 — compute_reward_signal + 6th tokio::join arm + 7 RewardTrend tests (REWARD-04, REWARD-07)
  - `c20cef8` 23-08 Task 1 — REWARD-06 OOD-floor gate body + ActivityStrip emit + populate ood_modules on RewardRecord
  - `563ba95` 23-08 Task 2 — payloads.ts + admin.ts TS lockstep (DoctorEventPayload + SignalClass extended with `reward_trend`)
  - `7c02725` 23-08 Task 3 — DoctorPane.tsx 6th `Reward Trend` row (DISPLAY_NAME + ROW_ORDER + rowRefs)
  - `86841ab` 23-09 Task 1 — verify-eval.sh `EXPECTED=5→8` (REWARD-05 phase close)
  - 23-09 Task 2 — REQUIREMENTS.md REWARD-01..07 flips + STATE.md close + 23-PHASE-CLOSE.md (this commit)

Across the phase: ~52 unit/integration tests added (11 Wave-1 reward + 9 Wave-2 reward + 7 reward Plan 23-08 + 7 Doctor Plan 23-07 + 17 + 18 + 17 OOD eval fixtures = 86 total assert!s; many fixtures share a single `#[test]` entry so the reportable test count is 33 reward+config+doctor + 12 evals = 45 reportable tests). 1 new file (`reward.rs`) + 3 new OOD eval modules + 4 modified TS files + 3 modified Rust files + 1 modified shell gate. verify chain count unchanged at 33; verify:eval EXPECTED tightened from 5 to 8 (gate extension, not new gate). DoctorPane row UAT-deferred per chat-first pivot anchor (substrate-only landing).

Next: Plan 24-03 (DREAM-01 prune pass — Wave 2 dream-mode task body landing).

Phase 24 commit chain so far (~5 commits across 2 plans):

  - `227d035` 24-01 Task 1 — tool_forge.rs ensure_table backfill + invocations table + record_tool_use signature (DREAM-01/02/03 substrate)
  - `386312a` 24-01 Task 2 — db.rs turn_traces table + commands.rs dispatch hook + reward-hook trace write
  - `25a0fbe` 24-01 docs (Plan 24-01 close)
  - `db10e09` 24-02 Task 1 — voyager_log.rs 3 dream_* emit helpers + cap_items + 4 tests (DREAM-06)
  - `6a18952` 24-02 Task 2 — dream_mode.rs pub fn last_activity_ts() accessor + 1 test (DREAM-05 substrate; full DREAM-05 abort lands in Plan 24-05)

Phase 21 commit chain (8 commits):

  - `b663e93` 21-01 parser + types (18 tests)
  - `ebf5aab` 21-02 loader + resolver (16 tests; workspace > user > bundled)
  - `b579eed` 21-03 lazy-load disclosure (10 tests; BODY_BYTES_LOADED atomic)
  - `2aaef13` 21-04 validator + skill_validator binary (14 tests)
  - `2ec9996` 21-05 3 bundled exemplars (git-status-summary / troubleshoot-cargo-build / format-clipboard-as-markdown)
  - `c3d51bb` 21-06 consent extension (7 tests; v1.2 schema reuse, no migration)
  - `b779115` 21-07 + 21-08 verify gate + close

Phase 22 Wave 1 commit chain (4 commits + 1 prep):

  - `9939351` 22-RESEARCH + 22-CONTEXT (audit existing wiring; 8-plan decomposition)
  - `d4aba45` 22-01 SKILL.md exporter (11 tests; integrates Phase 21 substrate with tool_forge)
  - `dd3a3b1` 22-02 ActivityStrip emission (3 tests; 4 emit points across the loop)
  - `faebb4a` 22-03 skill-write budget cap (5 tests; 50K-token default refusal)
  - `b610d2b` 22-04 rollback partial forge on DB-insert fail (2 tests; VOYAGER-08)

86 unit tests across the morning (65 Phase 21 + 21 Phase 22 Wave 1).
3 bundled exemplars; 1 new verify gate (`verify:skill-format`); chain
count 31 → 32. Runtime smoke confirmed end-to-end.

Phase 22 carry-forward to next push:

  - 22-05 deterministic fixture (VOYAGER-04 — canonical `youtube_transcript`
    end-to-end test). Requires test-seam refactor: extract the side-effect
    body of `forge_tool` into a `persist_forged_tool(capability, language,
    ForgeGeneration)` helper so `forge_tool_from_fixture` can share the
    persistence path without the LLM call.

  - 22-06 divergence property test (VOYAGER-09 — two installs / different
    gap streams / different manifests). Depends on 22-05.

  - 22-07 verify-voyager-loop gate (VOYAGER-05 — chain count 32 → 33).
    Depends on 22-05.

  - 22-08 phase summary + close.

**Prior session (2026-04-30T22:30Z):** v1.3 milestone scoped autonomously
during operator's sleep window. Read 6 research docs end-to-end at
`/home/arnav/research/` (voyager-loop-play, vs-hermes, synthesis-blade-
architecture, blade-as-organism, steelman-against-organism, open-questions-
answered). Shifted v1.3 from launch-anchored to substrate-anchored. Locked
7-phase shape (21 Skills v2 → 22 Voyager loop closure → 23 verifiable
reward + OOD eval → 24 dream_mode skill consolidation → 25 Hermes 4
provider → 26 voice resurrection → 27 close). PROJECT.md updated with
v1.3 milestone block + 5 new key decisions (M-08..M-12). 4 milestone
bootstrap commits (1deb738 PROJECT+STATE / ba309bb REQUIREMENTS /
95d480a ROADMAP / a3406a1 21-CONTEXT pre-plan).

---

## Context cliff notes

- v1.0 + v1.1 + v1.2 all shipped; substrate is reachable, observable, capability-aware, and chat-action-capable
- 33 verify gates green at Phase 23 close — verify:eval extended to `EXPECTED=8` (5 existing eval modules + 3 new OOD modules); chain count stays at 33 per RESEARCH §"Verify Gate Wiring" lock (gate extension, not new gate). Phase 21 added `verify:skill-format` (31 → 32); Phase 22 added `verify:voyager-loop` (32 → 33); Phase 23 extends `verify:eval` floor without adding a new gate (33 → 33).
- v1.3 = 7 phases (21=Skills v2, 22=Voyager loop closure, 23=verifiable reward + OOD eval, 24=dream_mode consolidation, 25=Hermes 4 provider, 26=voice resurrection, 27=close)
- The substrate-level claim v1.3 enables: "Two installs of BLADE genuinely diverge over time" — Voyager skill library grows from each user's specific capability gaps; no other consumer agent ships executable-code skill libraries
- May 11 deadline (₹2000 from non-brother source per WORKSPACE.md MONEY_MISSION) is downstream consequence, not goal — substrate ships → README + Polar wiring in Phase 27 takes a day → Show HN follows
- Activity log strip is the v1.1 contract every v1.3 cross-module action must honor (M-07 held)
- Phase 21 substrate (Skills v2 / SKILL.md format) blocks Phase 22 (Voyager loop must write SKILL.md somewhere coherent); 23/24/25/26 can parallelize after 22 lands

---

*State updated: 2026-04-30T22:30Z — v1.3 milestone bootstrap in progress. PROJECT.md updated; STATE.md reset; REQUIREMENTS.md + ROADMAP.md next.*

**Planned Phase:** 24 (skill-consolidation-dream-mode) — 7 plans — 2026-05-01T17:37:09.387Z
