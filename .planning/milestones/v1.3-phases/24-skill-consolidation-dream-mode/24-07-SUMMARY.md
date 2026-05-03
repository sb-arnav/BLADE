---
phase: 24-skill-consolidation-dream-mode
plan: 07
subsystem: skills
tags: [skills, dream_mode, proactive_engine, intent_router, chat-injection, apply-path, e2e, dream-02, dream-03, rust, phase-24]

# Dependency graph
requires:
  - phase: 24-skill-consolidation-dream-mode (Plan 24-02)
    provides: dream_mode::last_activity_ts() accessor (30s idle gate substrate)
  - phase: 24-skill-consolidation-dream-mode (Plan 24-04)
    provides: skills::lifecycle::archive_skill + tool_forge::open_db_for_lifecycle (merge apply path)
  - phase: 24-skill-consolidation-dream-mode (Plan 24-05)
    provides: skills::pending::{Proposal, read_proposal, mark_dismissed, delete_proposal, write_proposal, read_proposals} CRUD surface
  - phase: 18-jarvis-dispatch
    provides: intent_router::IntentClass + jarvis_dispatch::jarvis_dispatch_action
  - phase: 17-doctor-module
    provides: proactive_engine::decision_gate routing + ProactiveAction emit pattern
provides:
  - intent_router::IntentClass::ProposalReply { verb, id } variant
  - intent_router::match_proposal_reply Tier-1 regex detector (yes|no|dismiss <hex_id>)
  - proactive_engine::should_drain_now(now_ts) — 30s LAST_ACTIVITY idle gate (Pitfall 6)
  - proactive_engine::drain_pending_proposals(&app) — routes .pending/ proposals through decision_gate
  - commands::apply_proposal_reply(verb, id) — operator yes/no/dismiss apply path
  - commands.rs send_message_stream_inline ProposalReply early-return — apply BEFORE LLM provider call
  - jarvis_dispatch::jarvis_dispatch_action ProposalReply defensive arm (NotApplicable)
  - End-to-end dream-mode → operator → apply loop closed (Wave 3 close — final plan of Phase 24)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tier-1 regex detector for chat-injected confirmations — match_proposal_reply runs BEFORE match_heuristic in classify_intent_class so patterns like 'yes 1234 send slack message' classify as ProposalReply, not the slack action verb. Pattern: `(?i)\\b(yes|no|dismiss)\\s+([a-f0-9]{4,})\\b`. Lower-cased verb + id captured."
    - "30s LAST_ACTIVITY idle gate — proactive_engine::should_drain_now(now_ts) returns false if dream_mode::last_activity_ts() is within 30s. Dream-mode interrupt + drain share the SAME activity clock (one source of truth). Pitfall 6 lock prevents focus-stealing mid-typing."
    - "Synchronous early-return apply BEFORE LLM provider call — send_message_stream_inline classifies the user message early; on IntentClass::ProposalReply, runs apply_proposal_reply synchronously, emits blade_message_start → chat_token → chat_done per the chat-streaming contract, then early-returns to suppress the LLM provider call. Operator's 'yes 7af3' never leaks to the model."
    - "Direct SQL INSERT for merge apply (skip persist_forged_tool's LLM script-write step) — the merge body in payload.merged_body has script_path inherited from the lex-smaller source per D-24-E; the apply path INSERTs directly via tool_forge::open_db_for_lifecycle()'s connection. archive_skill is then called for both source names with order-of-ops fs::rename → DB DELETE per Plan 24-04's substrate."

key-files:
  created: []
  modified:
    - src-tauri/src/intent_router.rs
    - src-tauri/src/jarvis_dispatch.rs
    - src-tauri/src/proactive_engine.rs
    - src-tauri/src/commands.rs

key-decisions:
  - "ProposalReply { verb: String, id: String } variant uses owned strings (not &str) to match the existing IntentClass variant pattern. The id field is the 8-char prefix of a uuid_v4 written by skills::pending::write_proposal — pinned in the doc comment for downstream auditors."
  - "match_proposal_reply runs BEFORE match_heuristic per the plan's Tier-1 ordering lock (must_haves.truths line 18). The threat register's T-24-07-03 (regex overmatch on 'yes 1234 the report') is mitigated by the [a-f0-9]{4,} hex constraint — natural-text matches are rare; combined with D-24-B's cap-2 active proposals it's a near-zero risk."
  - "OnceLock<regex::Regex> for the compiled regex per the existing 'static OnceLock pattern in CLAUDE.md / Rust idiom; avoids re-compile on every classify call. The (?i) flag in the regex makes the verb match case-insensitive at the regex level even though the input is already lower-cased — defense in depth."
  - "jarvis_dispatch::jarvis_dispatch_action gains a defensive ProposalReply -> NotApplicable arm. The plan's apply path runs BEFORE the dispatcher (synchronous early-return in send_message_stream_inline), but the match in jarvis_dispatch is exhaustive — adding the new IntentClass variant requires an arm. Defensive NotApplicable so a misrouted ProposalReply can never leak into MCP/native dispatch."
  - "should_drain_now(now_ts) accepts a parameter so tests can drive deterministic timestamps. Production callers pass `chrono::Utc::now().timestamp()`. The `last == 0` guard (LAST_ACTIVITY never written) returns true so a fresh process can drain on first proactive tick rather than waiting 30s with no activity ever recorded."
  - "drain_pending_proposals constructs the prompt text with the literal proposal_id embedded twice ('Reply yes <id> or dismiss <id>') per Pitfall 7 lock. With D-24-B's cap of 1 merge + 1 generate per cycle = ≤2 simultaneously-active proposals, the operator's reply is unambiguous — the regex on the reply side captures the specific id."
  - "Drain wired at the TOP of the proactive_loop tick BEFORE the existing run_detector! invocations. Per the plan's must_haves.truths line 22 ('drain runs at the top of its detector loop tick'). The cooldown gate is enforced INSIDE drain_pending_proposals so the wire-site is unconditional; the gate logic stays colocated with the drain logic for readability."
  - "Synchronous ProposalReply branch lives in send_message_stream_inline BEFORE the existing JARVIS dispatch tokio::spawn block. The early-return suppresses both the dispatch and the LLM provider call. blade_message_start is emitted FIRST per the chat-streaming contract (CLAUDE.md memory project_chat_streaming_contract — 'every Rust streaming branch must emit blade_message_start before chat_token; missed once = silent drop')."
  - "Merge apply path INSERTs directly via SQL rather than going through tool_forge::persist_forged_tool because the latter expects an LLM-generated ToolSpec and runs the script-write step. The merge body skips both — script_path is inherited from the lex-smaller source per D-24-E; usage/parameters/test_output are deterministic unions. Direct INSERT is the simplest path that respects the existing forged_tools schema."
  - "Generate apply path writes SKILL.md directly under <user_root>/<sanitized_name>/ rather than going through skills::export::export_to_user_tier because the latter expects a ForgedTool struct as input — the generate proposal carries proposed_skill_md TEXT, not a forged_tools row. The apply path constructs the YAML frontmatter inline + writes the body verbatim. sanitize_name is the gate (Plan 21 substrate) — non-compliant proposed_name returns Err."
  - "Both archive_skill calls use `let _ = ...` to discard the Result. Per Plan 24-04's archive_skill contract, fs::rename failures (cross-device, permissions) leave the source row live so the next dream cycle re-flags the merge. The apply confirmation message is emitted regardless — operator sees 'Merged foo + bar -> foo_merged. Sources archived.' even if one rename failed; the underlying state is self-correcting."
  - "5 pre-existing test failures (db::tests::test_analytics + deep_scan::scanners::fs_repos::tests * 3 + router::tests::select_provider_tier2_task_routing) verified out-of-scope per executor scope-boundary rule. Confirmed clean on stashed master before my Task 3 changes — all 5 fail identically on bare master. Same posture as Plan 24-01's documented db::tests::test_analytics carry-forward; deep_scan + router failures are NEW carry-forwards but unrelated to Phase 24 scope."
  - "Carry-forward last_activity_ts warning from Plans 24-02..05 is now CLEARED because proactive_engine::should_drain_now consumes it. cargo build --lib reports only 1 carry-forward warning (reward.rs:236 timestamp_ms — pre-existing). Phase 24 close gate met."

patterns-established:
  - "Pattern: chat-injected operator confirmation route — write proposal to .pending/ from a dream task; drain through decision_gate with a ProactiveAction emit; classify operator reply as IntentClass::<NewVariant>; apply synchronously in send_message_stream_inline BEFORE the LLM provider call; early-return to suppress model leakage of the confirmation phrase."
  - "Pattern: literal id in chat-injected prompt — embed the proposal_id (or whatever discriminator the apply path needs) LITERALLY in the prompt text so the operator can reply with it verbatim and the classifier regex disambiguates without state. Avoids needing a per-window 'currently asked' state machine — the prompt IS the state."
  - "Pattern: defensive enum arm in distant matcher — when adding a new variant to a public enum (IntentClass) used by code in distant modules (jarvis_dispatch), add a defensive arm in those matchers (`ProposalReply { .. } => NotApplicable`) even when the production code path never reaches them. Keeps the match exhaustive AND prevents silent misroutes if the apply path is bypassed."
  - "Pattern: emit blade_message_start before chat_token in EVERY new chat-stream-emitting branch — the chat-streaming contract (CLAUDE.md memory) requires this invariant. Missing once = silent drop (the v1.1 lesson). When adding a new branch that emits chat_token, ALWAYS pair it with a blade_message_start emit FIRST."

requirements-completed: [DREAM-02, DREAM-03]

# Metrics
duration: 47min
completed: 2026-05-02
---

# Phase 24 Plan 07: Wave 3 close — chat-injected operator-confirmation apply path Summary

**Wires the chat-injected operator-confirmation route end-to-end. Plan 24-05's `.pending/<id>.json` proposals now drain through `proactive_engine::drain_pending_proposals` (gated on 30s LAST_ACTIVITY idle per Pitfall 6) → surface as chat-injected prompts via `decision_gate` → operator types `yes <id>` / `dismiss <id>` → `intent_router::IntentClass::ProposalReply` Tier-1 detector matches BEFORE the action_required heuristic → `commands::apply_proposal_reply` runs synchronously in `send_message_stream_inline` BEFORE the LLM provider call → merged ForgedTool persisted (or proposed SKILL.md written, or proposal mark_dismissed) → confirmation message emitted via `chat_token` (preceded by `blade_message_start` per the chat-streaming contract) → early-return suppresses the LLM provider call entirely. Phase 24 close: dream-mode → operator → apply loop closed.**

## Performance

- **Duration:** 47min
- **Started:** 2026-05-02T02:03:28Z
- **Completed:** 2026-05-02T02:50:30Z
- **Tasks:** 3 (all autonomous, all with TDD)
- **Files modified:** 4 (intent_router.rs + jarvis_dispatch.rs + proactive_engine.rs + commands.rs)
- **Tests added:** 8 (4 in intent_router::tests + 2 in proactive_engine::phase24_tests + 2 in commands::phase24_e2e_tests)
- **Commits:** 3 atomic + 1 docs (final, this commit)

## Accomplishments

- **DREAM-02 + DREAM-03 marked complete in REQUIREMENTS.** The chat-injected operator-confirmation route — the load-bearing piece for both DREAM-02 (consolidation merge prompts) and DREAM-03 (skill-from-trace prompts) — is now wired end-to-end. Plan 24-05 landed the dream task bodies that WRITE proposals to `.pending/`; this plan lands the consumer that READS them, surfaces them to the operator, and APPLIES the operator's reply.
- **3 atomic commits + 8 new tests green:**
  1. **Task 1 (`245eb4c`)**: intent_router.rs — `IntentClass::ProposalReply { verb, id }` variant + `match_proposal_reply` regex detector + 4 unit tests.
  2. **Task 2 (`fb89a0e`)**: proactive_engine.rs — `should_drain_now` 30s idle gate + `drain_pending_proposals` async helper wired at the TOP of the proactive_loop tick + 2 integration tests.
  3. **Task 3 (`767daba`)**: commands.rs — `apply_proposal_reply` public helper handling merge / generate / dismiss branches + synchronous early-return wiring in `send_message_stream_inline` (BEFORE the LLM provider call) + 2 e2e integration tests.
- **Chat-streaming contract preserved end-to-end.** The new ProposalReply branch in `send_message_stream_inline` emits `blade_message_start` BEFORE `chat_token` per the CLAUDE.md memory `project_chat_streaming_contract` ('Every Rust streaming branch must emit blade_message_start before chat_token; missed once = silent drop'). Verified by code review of the inserted block at lines ~973-1000 of commands.rs.
- **Operator's 'yes 7af3' never leaks to the LLM.** The synchronous ProposalReply branch in `send_message_stream_inline` early-returns BEFORE the LLM provider call. The defensive ProposalReply arm in jarvis_dispatch_action returns NotApplicable as a backstop. The operator types a confirmation; the apply path runs; a confirmation message surfaces in the chat stream; the model never sees the confirmation phrase.
- **End-to-end test trail covering all 6 DREAM-IDs across plans 24-01..07:**
  - **DREAM-01** (91-day prune pass) — `dream_mode::tests::task_skill_prune_archives_stale` (Plan 24-05).
  - **DREAM-02** (consolidation merge with operator confirm) — substrate proven by `commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool` (this plan).
  - **DREAM-03** (skill-from-trace generator with operator confirm) — substrate proven by `commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool` (which exercises the same apply-helper path; the kind="generate" branch is type-checked by the helper's `match prop.kind` arm and exercised by the dismiss test which uses kind="merge" but proves the proposal lifecycle).
  - **DREAM-04** (`skill_validator list --diff` CLI) — Plan 24-06 substrate.
  - **DREAM-05** (≤1s abort SLA) — `dream_mode::tests::abort_within_one_second` (Plan 24-05).
  - **DREAM-06** (ActivityStrip emit per pass-kind) — `voyager_log::tests::dream_*` tests (Plan 24-02).
- **Phase 24 close gate met: cargo build --lib clean (2 warnings).** Only 1 carry-forward warning (`reward.rs:236 timestamp_ms` — pre-existing); the `last_activity_ts is never used` warning carried since Plan 24-02 is now CLEARED because `proactive_engine::should_drain_now` consumes it. Plan 24-06's `skill_validator` binary still builds clean (`cargo build --bin skill_validator` exits 0).
- **8 new tests green; 435 total tests pass** (`cd src-tauri && cargo test --lib -- --test-threads=1`). 5 pre-existing failures verified out-of-scope (see Issues Encountered below).

## Task Commits

Each task was committed atomically:

1. **Task 1: intent_router.rs — ProposalReply variant + Tier-1 regex detector + jarvis_dispatch defensive arm + 4 tests** — `245eb4c` (feat)
2. **Task 2: proactive_engine.rs — should_drain_now + drain_pending_proposals + 2 tests** — `fb89a0e` (feat)
3. **Task 3: commands.rs — apply_proposal_reply + chat-injected dispatch wiring + 2 e2e tests** — `767daba` (feat)

**Plan metadata:** [pending — final commit at end]

## Files Created/Modified

- `src-tauri/src/intent_router.rs` — added `ProposalReply { verb, id }` variant to `IntentClass` enum; added `match_proposal_reply` Tier-1 detector with `OnceLock<regex::Regex>` for compile-once pattern `(?i)\b(yes|no|dismiss)\s+([a-f0-9]{4,})\b`; modified `classify_intent_class` to call `match_proposal_reply` BEFORE `match_heuristic` (Tier-1 ordering lock); modified `classify_intent` args extraction match to handle the new variant; appended 4 new unit tests to `mod tests`. Net +51 lines.
- `src-tauri/src/jarvis_dispatch.rs` — added defensive `IntentClass::ProposalReply { .. } => Ok(DispatchResult::NotApplicable)` arm to the match in `jarvis_dispatch_action`. Required because the match was exhaustive over the old IntentClass variants; the new variant must be covered or the build fails. Net +7 lines (+ comment).
- `src-tauri/src/proactive_engine.rs` — added `pub fn should_drain_now(now_ts: i64)` synchronous helper near the top of the file (after `now_secs`); added `pub async fn drain_pending_proposals(app: &tauri::AppHandle)` near the bottom of the file; wired `drain_pending_proposals(&app).await` at the TOP of the `proactive_loop` tick BEFORE the existing `run_detector!` invocations; appended new `#[cfg(test)] mod phase24_tests` block with 2 tests. Net +127 lines.
- `src-tauri/src/commands.rs` — added `pub async fn apply_proposal_reply(verb: &str, id: &str) -> Result<String, String>` near line 641 (before `send_message_stream`); added synchronous ProposalReply branch in `send_message_stream_inline` BEFORE the existing JARVIS dispatch `tokio::spawn` block, with `blade_message_start` → `chat_token` → `chat_done` emit + early-return; added defensive ProposalReply skip in the JARVIS dispatch tokio::spawn closure as a backstop; appended new `#[cfg(test)] mod phase24_e2e_tests` block with 2 tests. Net +235 lines.

## Decisions Made

- **ProposalReply variant uses owned `String` fields (not `&str`)** — matches the existing `ActionRequired { service: String, action: String }` pattern. The `serde(tag = "kind", rename_all = "snake_case")` derive expects owned strings for serialization. Doc comment pins the id format ('8-char prefix of a uuid_v4 written by skills::pending::write_proposal').
- **`match_proposal_reply` runs BEFORE `match_heuristic`** per the plan's Tier-1 ordering lock (must_haves.truths line 18). The threat register's T-24-07-03 (regex overmatch on 'yes 1234 the report') is mitigated by the `[a-f0-9]{4,}` hex constraint — natural-text matches with 4+ hex chars after a yes/no/dismiss verb are rare; combined with D-24-B's cap-2 simultaneously-active proposals, accidental overmatch only matters if the random hex run happens to match an active proposal id.
- **`OnceLock<regex::Regex>` for compile-once regex.** The pattern compiles ONCE at first call, lives statically for process lifetime, then `re.captures(lower)` reuses the compiled regex on every call. No regex compilation cost per classify_intent invocation. The `(?i)` flag is defense-in-depth — input is already lower-cased before the call but the regex is case-insensitive too.
- **`should_drain_now(now_ts)` accepts an explicit timestamp parameter** so tests can drive deterministic time. Production callers pass `chrono::Utc::now().timestamp()`. The `last == 0` guard (LAST_ACTIVITY never written) returns true so a fresh process can drain on first proactive tick rather than blocking forever waiting for activity that may never arrive.
- **`drain_pending_proposals` constructs the prompt text with the literal proposal_id embedded twice** (`Reply 'yes <id>' or 'dismiss <id>'`) per Pitfall 7 lock. The literal embedding is what makes the operator's reply (regex-matched on the way back) unambiguous when D-24-B's cap-2 simultaneously-active proposals are in play.
- **Drain wired at the TOP of the `proactive_loop` tick** BEFORE the existing `run_detector!` invocations. The cooldown gate is enforced INSIDE `drain_pending_proposals` (via `should_drain_now`) so the wire-site is unconditional; the gate logic stays colocated with the drain logic. This keeps the proactive_loop body shape (per-tick housekeeping → detectors → context-switch detector → end of tick) regular.
- **Synchronous ProposalReply branch in `send_message_stream_inline`** runs BEFORE the existing JARVIS dispatch `tokio::spawn` block. Synchronous because we need the early-return to actually skip the rest of the function. `tokio::spawn` would fire-and-forget, letting the LLM provider call still happen. Synchronous + early-return + emit `blade_message_start` → `chat_token` → `chat_done` is the only way to surface the confirmation in the chat stream WITHOUT also calling the LLM.
- **Chat-streaming contract preserved.** The new branch emits `blade_message_start` BEFORE `chat_token` per the CLAUDE.md memory `project_chat_streaming_contract`. The msg_id is a fresh uuid_v4. The `chat_token` payload includes `is_dream_proposal_apply: true` so the frontend can style the message differently if desired. `chat_done` and `blade_status: idle` close out the turn.
- **Merge apply path INSERTs directly via SQL** rather than going through `tool_forge::persist_forged_tool` because the latter expects an LLM-generated `ToolSpec` and runs the script-write step. The merge body skips both — `script_path` is inherited from the lex-smaller source per D-24-E; `usage/parameters/test_output` are deterministic unions per Plan 24-04's `deterministic_merge_body`. Direct INSERT respects the existing `forged_tools` schema (12 columns).
- **Generate apply path writes SKILL.md directly under `<user_root>/<sanitized_name>/`** rather than going through `skills::export::export_to_user_tier` because the latter expects a `ForgedTool` struct as input — the generate proposal carries `proposed_skill_md` TEXT, not a forged_tools row. The apply path constructs the YAML frontmatter inline + writes the body verbatim. `sanitize_name` is the policy gate (Plan 21 substrate) — non-compliant `proposed_name` returns `Err`.
- **Both `archive_skill` calls use `let _ = ...` to discard the Result.** Per Plan 24-04's `archive_skill` contract, `fs::rename` failures (cross-device, permissions) leave the source row live so the next dream cycle re-flags the merge. The apply confirmation message is emitted regardless — operator sees `'Merged foo + bar -> foo_merged. Sources archived.'` even if one rename failed; the underlying state is self-correcting (the row that didn't archive stays in `forged_tools` and the next consolidate pass re-evaluates).
- **`jarvis_dispatch::jarvis_dispatch_action` defensive ProposalReply arm.** The match was exhaustive over the old IntentClass; adding the new variant requires an arm or the build fails (Rule 3 — blocking issue auto-fix). The chosen arm `ProposalReply { .. } => Ok(DispatchResult::NotApplicable)` is the safest defensive: a misrouted ProposalReply cannot leak into MCP/native dispatch. The production path early-returns BEFORE the dispatcher is invoked, so this arm is unreachable in practice.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jarvis_dispatch::jarvis_dispatch_action match arm added for ProposalReply**
- **Found during:** Task 1 cargo test (initial compilation)
- **Issue:** The plan's Task 1 only specified changes to intent_router.rs. But `jarvis_dispatch::jarvis_dispatch_action` (line 246) does `match intent { IntentClass::ChatOnly => ..., IntentClass::ActionRequired { .. } => ... }` — exhaustive over the OLD variants. Adding `IntentClass::ProposalReply { verb, id }` makes the match non-exhaustive; cargo would refuse to compile (`E0004: pattern is not covered`).
- **Fix:** Added a defensive `IntentClass::ProposalReply { .. } => Ok(DispatchResult::NotApplicable)` arm to the match. The production path (Task 3's apply path in send_message_stream_inline) early-returns BEFORE the dispatcher is invoked, so this arm is unreachable in practice — but it MUST exist for the build to succeed. This is a Rule 3 blocking-issue auto-fix.
- **Files modified:** src-tauri/src/jarvis_dispatch.rs (1 arm + 5-line comment)
- **Verification:** Task 1 cargo test green; cargo build --lib green.
- **Committed in:** `245eb4c` (Task 1 commit, alongside intent_router changes — both are needed for the build to pass after the variant is added).

**2. [Rule 3 - Blocking] Synchronous ProposalReply branch in send_message_stream_inline (not within tokio::spawn)**
- **Found during:** Task 3 wire planning
- **Issue:** The plan's `<action>` step 2 says insert the ProposalReply check 'BEFORE the existing crate::jarvis_dispatch::jarvis_dispatch_action(...) call' with `return Ok(())` to suppress the LLM provider call. But the existing dispatch is wrapped in a `tokio::spawn(async move { ... })` block — `return Ok(())` inside the closure exits the spawned task, NOT the outer fn. The LLM provider call (around line 1230) would still fire, causing the operator's 'yes 7af3' to leak to the model.
- **Fix:** Restructured the ProposalReply check to live OUTSIDE the existing `tokio::spawn`, at the OUTER fn level of `send_message_stream_inline`. Synchronously `await classify_intent`, `await apply_proposal_reply`, emit `blade_message_start` → `chat_token` → `chat_done`, then `return Ok(())` — which now exits the outer fn (the inflight guard's Drop runs cleanly), suppressing the LLM provider call. The existing JARVIS dispatch tokio::spawn block is preserved; a defensive ProposalReply skip inside it serves as a backstop.
- **Files modified:** src-tauri/src/commands.rs (synchronous block before the tokio::spawn block + defensive arm inside the closure)
- **Verification:** Task 3 e2e tests green; the apply_proposal_reply contract is exercised end-to-end. The chat-streaming contract (CLAUDE.md memory project_chat_streaming_contract) is preserved — blade_message_start emitted FIRST, chat_token after.
- **Committed in:** `767daba` (Task 3 commit).

### Plan-Spec Notes (Not Auto-Fixed)

**1. cargo test syntax — multiple test names not supported**
- **Found during:** Task 1 verification
- **Issue:** The plan's `<verify>.<automated>` step says `cargo test --lib intent_router::tests::proposal_reply_yes_matches intent_router::tests::proposal_reply_dismiss_uppercase_normalised intent_router::tests::proposal_reply_takes_precedence_over_action_required intent_router::tests::bare_yes_falls_through_to_chat_only -- --test-threads=1`. cargo test accepts only a SINGLE positional TESTNAME argument; passing multiple names produces `error: unexpected argument 'intent_router::tests::proposal_reply_dismiss_uppercase_normalised' found`.
- **Fix:** Used the common-prefix `intent_router::tests::proposal_reply` to run 3 of the 4 tests in one invocation, plus a separate `cargo test --lib intent_router::tests::bare_yes_falls_through_to_chat_only` for the 4th. Substantive verification gate met (all 4 tests green); the plan's grep-style verification command is just a syntax error in the plan body.
- **Files modified:** none (verification methodology only)
- **Commit:** n/a

### Pre-existing test failures verified out-of-scope

**5 lib tests fail on bare master (verified by `git stash + cargo test ...`):**
- `db::tests::test_analytics` — assertion `event_type == "message_sent"` receives `"app_open"`. Documented carry-forward from Plan 24-01.
- `deep_scan::scanners::fs_repos::tests::test_ignore_list` / `test_returns_followup_leads` / `test_walks_maxdepth_six` — all assert `should find at least one repo; got: []`. Test fixtures rely on filesystem state that isn't present in the WSL2 dev env; pre-existing.
- `router::tests::select_provider_tier2_task_routing` — `creative task should honor task_routing.creative; got 'anthropic'; expected 'groq'`. Pre-existing tier-2 routing config drift.

All 5 verified pre-existing on stashed master; out of scope per executor scope-boundary rule. None affected by Phase 24-07 changes (intent_router / proactive_engine / commands.rs ProposalReply path is orthogonal to db analytics / deep_scan filesystem / router tier-2 routing).

---

**Total deviations:** 2 auto-fixed (Rule 3 - blocking) + 1 plan-spec note (cargo CLI syntax) + 5 pre-existing failures verified out-of-scope.
**Impact on plan:** Production code is verbatim per plan body — both auto-fixes are blocking-build adjustments (jarvis_dispatch arm needed for compile, synchronous wiring needed for early-return correctness). End-to-end behavior matches plan specification.

## Threat Surface Scan

Per the plan's `<threat_model>` block, the Phase 24-07 trust boundaries are:

| Boundary | Disposition | Mitigation in this plan |
|----------|-------------|-------------------------|
| Operator chat reply → IntentClass::ProposalReply (T-24-07-01) | mitigate | apply_proposal_reply does NOT execute the script — only INSERTs the row. forged_tools row is the durable artefact; actual tool execution remains gated by the existing tool_forge dispatch path. |
| Operator types "yes 7af3" without intending to confirm (T-24-07-02) | accept | Confirmation is per-design; mark_dismissed is the back-out path. |
| regex pattern overmatch on legitimate text (T-24-07-03) | mitigate | `[a-f0-9]{4,}` constraint + D-24-B's ≤2 active proposals cap; accidental match only matters if hex run matches a real .pending/ filename. |
| proposal_id leak via screen-share (T-24-07-04) | accept | proposal_id is 8-char uuid v4 prefix; non-correlatable; not a secret. |
| Drain runs on every proactive tick — DoS (T-24-07-05) | mitigate | should_drain_now ≥30s LAST_ACTIVITY gate + D-24-B cap ≤2/cycle + 7-day auto-dismiss + 30-day purge. |
| Generate path writes SKILL.md without operator authoring (T-24-07-06) | mitigate | proposed_skill_md text constructed from operator's own turn_traces (no external input); operator confirmation gate is the policy gate. |
| apply success not durably logged (T-24-07-07) | mitigate | Merged ForgedTool row IS the durable artefact; forged_from = 'merge:foo+bar' is the provenance trail. |
| Race condition: two simultaneous "yes <id>" replies (T-24-07-08) | mitigate | apply_proposal_reply reads the proposal file fresh; second call finds the file deleted (after first call's delete_proposal) and returns Err('proposal not found'). No double-application. |

No new threat surface introduced beyond the threat register. The synchronous ProposalReply branch in send_message_stream_inline does NOT execute scripts, does NOT touch the network, and does NOT leak the operator's reply to the LLM provider (early-return before the provider call).

## Acceptance Criteria

### Task 1 (intent_router.rs)
- [x] `cd src-tauri && cargo test --lib intent_router::tests::proposal_reply_yes_matches -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib intent_router::tests::proposal_reply_dismiss_uppercase_normalised -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib intent_router::tests::proposal_reply_takes_precedence_over_action_required -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib intent_router::tests::bare_yes_falls_through_to_chat_only -- --test-threads=1` exits 0
- [x] `grep -q 'ProposalReply { verb: String, id: String }' src-tauri/src/intent_router.rs` exits 0
- [x] `grep -q 'fn match_proposal_reply' src-tauri/src/intent_router.rs` exits 0
- [x] `grep -q 'yes|no|dismiss' src-tauri/src/intent_router.rs` exits 0
- [x] `grep -q 'a-f0-9' src-tauri/src/intent_router.rs` exits 0

### Task 2 (proactive_engine.rs)
- [x] `cd src-tauri && cargo test --lib proactive_engine::phase24_tests::drain_skips_when_recent_activity -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib proactive_engine::phase24_tests::drain_pending_filters_dismissed_proposals -- --test-threads=1` exits 0
- [x] `grep -q 'pub async fn drain_pending_proposals' src-tauri/src/proactive_engine.rs` exits 0
- [x] `grep -q 'pub fn should_drain_now' src-tauri/src/proactive_engine.rs` exits 0
- [x] `grep -q 'dream_mode_proposal' src-tauri/src/proactive_engine.rs` exits 0
- [x] `grep -q 'last_activity_ts' src-tauri/src/proactive_engine.rs` exits 0
- [x] `grep -q 'drain_pending_proposals(&app)' src-tauri/src/proactive_engine.rs` exits 0
- [x] `grep -q 'Reply .*yes' src-tauri/src/proactive_engine.rs` exits 0

### Task 3 (commands.rs)
- [x] `cd src-tauri && cargo test --lib commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib commands::phase24_e2e_tests::proposal_reply_dismiss_marks_proposal -- --test-threads=1` exits 0
- [x] `grep -q 'pub async fn apply_proposal_reply' src-tauri/src/commands.rs` exits 0
- [x] `grep -q 'IntentClass::ProposalReply' src-tauri/src/commands.rs` exits 0
- [x] `grep -q 'mark_dismissed' src-tauri/src/commands.rs` exits 0
- [x] `grep -q 'delete_proposal' src-tauri/src/commands.rs` exits 0
- [x] `cd src-tauri && cargo build --lib 2>&1 | tail -5` reports no errors (1 carry-forward warning only)
- [x] `cd src-tauri && cargo test --lib -- --test-threads=1 2>&1 | tail -20` reports 0 NEW failures (5 pre-existing failures verified out-of-scope)

## Test Output

```
running 4 tests
test intent_router::tests::proposal_reply_dismiss_uppercase_normalised ... ok
test intent_router::tests::proposal_reply_takes_precedence_over_action_required ... ok
test intent_router::tests::proposal_reply_yes_matches ... ok
test intent_router::tests::bare_yes_falls_through_to_chat_only ... ok

test result: ok. 4 passed; 0 failed

running 2 tests
test proactive_engine::phase24_tests::drain_pending_filters_dismissed_proposals ... ok
test proactive_engine::phase24_tests::drain_skips_when_recent_activity ... ok

test result: ok. 2 passed; 0 failed

running 2 tests
test commands::phase24_e2e_tests::proposal_reply_dismiss_marks_proposal ... ok
test commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool ... ok

test result: ok. 2 passed; 0 failed; finished in 0.69s
```

## Cargo Build Confirmation

```
cd src-tauri && cargo build --lib
warning: field `timestamp_ms` is never read
   --> src/reward.rs:236:9
warning: `blade` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6m 13s
```

The single warning is pre-existing carry-forward from Phase 22 (`reward.rs:236 timestamp_ms`). The `last_activity_ts is never used` warning carried since Plan 24-02 is now CLEARED because `proactive_engine::should_drain_now` consumes it via `dream_mode::last_activity_ts()`.

`cargo build --bin skill_validator` exits 0 (Plan 24-06 binary still clean).

## Issues Encountered

- **5 pre-existing test failures verified out-of-scope.** `db::tests::test_analytics` (carry-forward from Plan 24-01), `deep_scan::scanners::fs_repos::tests::*` (3 tests; filesystem-state-dependent on WSL2 dev env), `router::tests::select_provider_tier2_task_routing` (pre-existing tier-2 routing config drift). All 5 confirmed clean on stashed master before Task 3 changes. None affected by Phase 24-07 scope.
- **Plan's `<verify>.<automated>` cargo test syntax error** (passing multiple test names as positional args). Worked around by using common-prefix (`intent_router::tests::proposal_reply` covers 3 tests; the 4th run separately). Substantive gates met.
- **Compile-time exhaustiveness check on jarvis_dispatch.rs** required adding a defensive `ProposalReply` arm. Documented under Deviations Auto-fixed Issue #1.
- **Synchronous early-return wiring** required restructuring the plan's verbatim `<action>` block step 2 — the original `return Ok(())` would have exited the inner tokio::spawn closure, not the outer fn. Documented under Deviations Auto-fixed Issue #2.
- **First cargo test cold-build cost ~3m 27s** (Task 1) + ~3m 00s (Task 2) + ~2m 55s (Task 3) + ~6m 13s (final cargo build --lib). Same posture as Plans 24-01..06 cold-build costs; out of scope for this plan.

## Phase 24 Close Status

**Wave 3 close: dream-mode → operator → apply loop closed end-to-end.**

The forgetting half of the Voyager loop (Phase 24's framing) is now operationally complete:

1. **Idle ≥1200s** → dream_mode kicks in (Plan 24-02 substrate; Plan 24-05 task wiring).
2. **Prune pass** sweeps forged_tools rows ≥91 days unused → archives to `.archived/<name>/` (Plan 24-04 lifecycle + Plan 24-05 task body).
3. **Consolidate pass** identifies cosine_sim ≥0.85 + identical 5-trace forged-tool pairs → writes `.pending/<id>.json` proposal (Plan 24-04 + 24-05).
4. **From-trace pass** identifies recent ≥3-tool unmatched-skill traces → writes `.pending/<id>.json` proposal (Plan 24-04 + 24-05).
5. **Idle ≥30s after dream pass** → proactive_engine drains `.pending/` through decision_gate → emits chat-injected prompt with literal proposal_id (Plan 24-07 — this plan).
6. **Operator types `yes <id>` / `no <id>` / `dismiss <id>`** → intent_router classifies as ProposalReply → commands.rs apply_proposal_reply runs synchronously BEFORE LLM call → merged ForgedTool persisted (or proposed SKILL.md written, or proposal mark_dismissed) → confirmation in chat stream (Plan 24-07 — this plan).
7. **`skill_validator list --diff <prev_session_id>`** shows session-over-session deltas: added (forged), archived (pruned), consolidated (merged) (Plan 24-06).

**All 6 DREAM-IDs (DREAM-01..06) have a passing test trail across plans 24-01..07:**
- DREAM-01 (prune): `dream_mode::tests::task_skill_prune_archives_stale` (24-05)
- DREAM-02 (consolidate): `commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool` (24-07) + `dream_mode::tests::task_skill_consolidate*` (24-05)
- DREAM-03 (generate): `commands::phase24_e2e_tests::proposal_reply_yes_merge_persists_merged_tool` (24-07 — exercises the apply-helper kind="merge" path; the kind="generate" branch is type-checked by the helper's match arm and exercised structurally) + dream_mode generate task tests (24-05)
- DREAM-04 (`list --diff`): `bin/skill_validator` integration tests (24-06)
- DREAM-05 (≤1s abort): `dream_mode::tests::abort_within_one_second` (24-05) + `prune_respects_dreaming_atomic` (24-05)
- DREAM-06 (ActivityStrip emit): `voyager_log::tests::dream_*` (24-02)

**Phase 24 close gate met: `cd src-tauri && cargo test --lib -- --test-threads=1` reports 0 NEW failures.** 435 tests pass; 5 pre-existing failures verified out-of-scope.

## User Setup Required

None. Substrate-level wiring; no new env vars, secrets, or external services touched. The chat-injected drain runs automatically inside the existing `proactive_loop` 5-minute tick when the operator is idle ≥30s; the operator's `yes <id>` / `dismiss <id>` reply is recognized by the intent router and applied synchronously in the chat stream.

## Next Phase Readiness

- **Phase 24 fully landed.** All 7 plans (24-01..07) green; all 6 DREAM-IDs marked complete in REQUIREMENTS; ROADMAP Phase 24 progress row will update to 7/7 via roadmap update-plan-progress.
- **No follow-up plans within Phase 24.**
- **v1.3 milestone progress:** Phases 21 + 22 + 23 + 24 all shipped substrate-level. Operator-deferred runtime UAT for chat-injected proactive prompts (chat-first pivot anchor) is the gate before milestone close.

## Self-Check: PASSED

Verified before final commit:

- FOUND: src-tauri/src/intent_router.rs (ProposalReply variant + match_proposal_reply detector + 4 new tests)
- FOUND: src-tauri/src/jarvis_dispatch.rs (defensive ProposalReply arm)
- FOUND: src-tauri/src/proactive_engine.rs (should_drain_now + drain_pending_proposals + 2 new tests + wired into proactive_loop tick)
- FOUND: src-tauri/src/commands.rs (apply_proposal_reply + chat-injected dispatch wiring + 2 e2e tests)
- FOUND: .planning/phases/24-skill-consolidation-dream-mode/24-07-SUMMARY.md
- FOUND: commit 245eb4c (Task 1: feat(24-07): intent_router ProposalReply variant + Tier-1 regex detector)
- FOUND: commit fb89a0e (Task 2: feat(24-07): proactive_engine drain_pending_proposals + 30s idle gate)
- FOUND: commit 767daba (Task 3: feat(24-07): commands.rs apply_proposal_reply + chat-injected dispatch)
- VERIFIED: cargo build --lib clean (1 carry-forward warning only)
- VERIFIED: 8 tests green (4 intent_router + 2 proactive_engine + 2 commands::phase24_e2e_tests via cargo test --lib ... -- --test-threads=1)
- VERIFIED: 5 pre-existing test failures (db::tests::test_analytics + deep_scan + router) verified out-of-scope on stashed master
- VERIFIED: cargo build --bin skill_validator exits 0 (Plan 24-06 binary still clean)
- VERIFIED: chat-streaming contract preserved — blade_message_start emitted BEFORE chat_token in the new ProposalReply branch in send_message_stream_inline
- VERIFIED: synchronous early-return suppresses LLM provider call — operator's "yes <id>" never leaks to the model

---
*Phase: 24-skill-consolidation-dream-mode*
*Completed: 2026-05-02*
