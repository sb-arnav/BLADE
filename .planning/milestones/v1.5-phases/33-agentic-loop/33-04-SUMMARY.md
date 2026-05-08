---
phase: 33-agentic-loop
plan: 4
plan_name: LOOP-01 mid-loop verification probe (verify_progress + Verdict + LOOP_OVERRIDE seam)
subsystem: agentic-loop / verification
tags: [LOOP-01, ctx-07-fallback, mid-loop-verification, cheap-model-routing, loop-override-seam]
requirements: [LOOP-01]
requirements_completed: [LOOP-01]
dependency_graph:
  requires:
    - 33-01 (LoopConfig + smart_loop_enabled + verification_every_n)
    - 33-02 (LoopState + ActionRecord + record_action ring buffer)
    - 33-03 (run_loop driver — iteration body lift)
    - 32-04 (cheap_model_for_provider in config.rs)
    - 32-02 (CTX_SCORE_OVERRIDE env-var seam pattern)
    - 32-07 (CTX-07 fallback discipline + AssertUnwindSafe pattern)
  provides:
    - loop_engine::Verdict enum (Yes / No / Replan)
    - loop_engine::verify_progress async fn
    - loop_engine::render_actions_json (compact JSON renderer for action ring buffer)
    - LOOP_OVERRIDE env-var test seam (mirrors CTX_SCORE_OVERRIDE)
    - blade_loop_event {kind: "verification_fired", verdict: "YES|NO|REPLAN"} emit channel
    - providers::complete_simple one-shot text helper (substrate, landed in commit 146a911)
  affects:
    - src-tauri/src/loop_engine.rs (verify_progress + run_loop firing site + 12 unit tests)
    - src-tauri/src/providers/mod.rs (complete_simple helper — landed 146a911)
tech_stack:
  added: []
  patterns:
    - LOOP_OVERRIDE env-var test seam (mirrors CTX_SCORE_OVERRIDE in brain.rs)
    - First-word whitelist verdict parsing (case-insensitive, prompt-injection-resistant)
    - Process-global Mutex serialising env-var-mutating tests (Cargo parallel-test discipline)
    - safe_slice bounds on goal (1500 chars) and action summaries (300 chars each)
    - Stacking-prevention via LoopState.last_nudge_iteration (delta ≤ 2 → suppress)
key_files:
  created: []
  modified:
    - src-tauri/src/loop_engine.rs (+119 lines this commit; substrate + main wiring landed in prior Wave 3 commits)
decisions:
  - "Verdict::Replan injects a synthetic system message ('Internal check: re-plan from current state. Do not retry the failing step verbatim.') rather than mutating LoopState.replans_this_run — the executor brief suggested a replan_requested flag, but the PLAN.md contract (the locked source of truth, CONTEXT lock §Mid-Loop Verification) injects the locked nudge text. Verdict::Replan and Plan 33-05's reject_plan trigger are TWO INDEPENDENT signals that both inject re-plan nudges via different code paths (verifier verdict vs third-same-tool-failure), and replans_this_run is owned by the latter only."
  - "Per-test process-global Mutex (loop_override_mutex) serialises every test that mutates LOOP_OVERRIDE. Cargo runs tests in parallel by default and env vars are process-global; without the mutex, two LOOP_OVERRIDE-mutating tests racing would intermittently leak state and route the verification probe to the real cheap-model call, which fails with 'Unknown provider: x'. The mutex is the same hardening pattern used for BREAKDOWN_TEST_LOCK in brain.rs."
  - "panic_safe_does_not_crash_loop test uses LOOP_OVERRIDE=GARBAGE rather than a true async panic — the cheap-model client returns Result<_, String> on failure (its synchronous panic surface is small), so the practical Err arm is the case the test exercises. The catch_unwind wrapper is Plan 33-09's job (the panic-injection regression test surface)."
key_links:
  - from: "src-tauri/src/loop_engine.rs (verify_progress)"
    to: "src-tauri/src/config.rs (cheap_model_for_provider)"
    via: "direct call at L282 of loop_engine.rs"
    pattern: "cheap_model_for_provider"
  - from: "src-tauri/src/loop_engine.rs (verify_progress)"
    to: "src-tauri/src/providers/mod.rs (complete_simple)"
    via: "direct call at L296 of loop_engine.rs"
    pattern: "providers::complete_simple"
  - from: "src-tauri/src/loop_engine.rs (run_loop)"
    to: "verify_progress at iteration > 0 && iteration % verification_every_n == 0"
    via: "match arm at L478-544 of loop_engine.rs"
    pattern: "verification_every_n|smart_loop_enabled"
metrics:
  duration_minutes: ~25
  tasks_completed: 2
  files_modified: 1
  tests_added: 3
  tests_total_loop_01: 12
  lines_added: 119
  lines_removed: 0
  completed_date: 2026-05-05
---

# Phase 33 Plan 04: LOOP-01 Mid-Loop Verification Probe Summary

**One-liner:** The agentic loop now self-checks every `config.r#loop.verification_every_n` iterations (default 3, skip iter 0) by routing the goal + last 3 tool actions through `cheap_model_for_provider` and parsing a one-word YES/NO/REPLAN verdict. NO and REPLAN inject locked synthetic system messages into the conversation; failures are non-blocking (eprintln + continue, CTX-07 discipline). The LOOP_OVERRIDE env-var seam mirrors CTX_SCORE_OVERRIDE for deterministic unit testing.

## What Was Built

**Note on substrate:** The bulk of LOOP-01 (the `verify_progress` async fn, the `Verdict` enum, the `render_actions_json` helper, the run_loop firing site at L478-544, and the first 9 unit tests) landed in earlier Wave 3 commits. The `providers::complete_simple` helper landed in substrate commit `146a911`. This SUMMARY documents the full Plan 33-04 contract for completeness; the present commit (`3bc2f08`) adds the three executor-brief-requested tests and hardens the LOOP_OVERRIDE seam against parallel-test races.

### Verdict enum + verify_progress async fn (loop_engine.rs L233-312)

```rust
pub enum Verdict { Yes, No, Replan }

pub async fn verify_progress(
    provider: &str,
    api_key: &str,
    model: &str,
    goal: &str,
    actions: &VecDeque<ActionRecord>,
) -> Result<Verdict, String>
```

**Behavior:**
1. **Test seam (LOOP_OVERRIDE):** Reads the env var; case-insensitive; matches `YES|NO|REPLAN` → returns the variant directly without a network call. Anything else returns `Err("invalid LOOP_OVERRIDE: ...")`.
2. **Cheap-model routing:** Otherwise calls `crate::config::cheap_model_for_provider(provider, model)`:
   - anthropic → `claude-haiku-4-5-20251001`
   - openai → `gpt-4o-mini`
   - groq → `llama-3.1-8b-instant`
   - gemini → `gemini-2.0-flash`
   - openrouter / ollama / fallback → user's model
3. **Locked prompt** (CONTEXT lock §Mid-Loop Verification, exact text):
   ```
   Given the original goal `{goal}` and the last 3 tool actions `{actions}`,
   is the loop progressing toward the goal?
   Reply with exactly one word: YES, NO, or REPLAN, followed by a one-sentence reason.
   ```
   - `{goal}` is `safe_slice(last_user_text, 1500)`
   - `{actions}` is `render_actions_json(...)` (compact JSON; each in/out summary `safe_slice`'d to 300 chars)
4. **Verdict parse:** First whitespace-delimited token of the response, uppercased; whitelist match against YES / NO / REPLAN; everything else → Err.

### Run_loop firing site (loop_engine.rs L478-544)

Fires at the top of each iteration after the cancellation check, BEFORE `complete_turn`. Gate:

```rust
if config.r#loop.smart_loop_enabled
    && iteration > 0
    && (iteration as u32) % config.r#loop.verification_every_n == 0
```

Verdict-handling match (verbatim from CONTEXT lock §Mid-Loop Verification):

| Verdict | blade_loop_event emit | Conversation injection |
|---------|----------------------|------------------------|
| `Yes` | `{kind: "verification_fired", verdict: "YES"}` | none |
| `No` | `{kind: "verification_fired", verdict: "NO"}` | `System("Internal check: the last 3 tool calls do not appear to be making progress. Reconsider the approach.")` |
| `Replan` | `{kind: "verification_fired", verdict: "REPLAN"}` | `System("Internal check: re-plan from current state. Do not retry the failing step verbatim.")` |
| `Err(e)` | none | none — `eprintln!("[LOOP-01] verify_progress error (non-blocking): {}", e)` then continue |

NO and REPLAN both check `loop_state.last_nudge_iteration` and skip the injection if a nudge was placed within the last 2 iterations (33-RESEARCH landmine #11 — stacking prevention).

### Cadence math validation

At `verification_every_n=3`:

| Iteration | `iter > 0 && iter % 3 == 0` | Probe fires? |
|-----------|------------------------------|--------------|
| 0 | false (iter > 0 fails) | NO (last_3_actions is empty here anyway) |
| 1, 2 | false (modulo fails) | NO |
| 3 | true | **YES** |
| 4, 5 | false | NO |
| 6 | true | **YES** |
| 7, 8 | false | NO |
| 9 | true | **YES** |

Locked into `phase33_loop_01_cadence_math_fires_at_iter_3_6_9`.

### providers::complete_simple helper (providers/mod.rs L345-355)

```rust
pub async fn complete_simple(
    provider: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String>
```

Wraps `complete_turn` with a single `ConversationMessage::User(prompt)` and an explicit empty `Vec<ToolDefinition>` (CLAUDE.md anti-pattern: `&[]` cannot always coerce to `&[ToolDefinition]`).

## Tests Added (3 new in this commit; 12 total covering LOOP-01)

This commit adds the three executor-brief-requested tests:

| Test | What It Catches |
|------|----------------|
| `phase33_loop_01_smart_off_skips_verification` | A future edit accidentally drops the `smart_loop_enabled &&` short-circuit and turns the probe on for legacy users. Iterates 0..30 with `smart=false` and asserts the gate never fires. |
| `phase33_loop_01_panic_safe_does_not_crash_loop` | A future edit makes the Err arm of `verify_progress` halt the main loop. Sets `LOOP_OVERRIDE=GARBAGE` (the only deterministic way to force Err without a network call), reaches the Err arm, and asserts the firing-site match continues without unwinding. |
| `phase33_loop_01_replan_response_triggers_replan_arm` | A future refactor renames `Verdict::Replan` or rewires the match arms. Sets `LOOP_OVERRIDE=REPLAN`, asserts `Ok(Verdict::Replan)`, then simulates the run_loop REPLAN arm pushing the locked nudge into a fresh `Vec<ConversationMessage>` and asserts both halves of the locked phrase ("re-plan from current state" + "Do not retry the failing step verbatim") landed verbatim. |

Plus the 9 pre-existing tests (all green):

| Test | Coverage |
|------|----------|
| `phase33_loop_01_verdict_yes_via_override` | LOOP_OVERRIDE=YES → Ok(Verdict::Yes) |
| `phase33_loop_01_verdict_no_via_override` | LOOP_OVERRIDE=NO → Ok(Verdict::No) |
| `phase33_loop_01_verdict_replan_via_override` | LOOP_OVERRIDE=REPLAN → Ok(Verdict::Replan) |
| `phase33_loop_01_verdict_invalid_override_returns_err` | LOOP_OVERRIDE=GARBAGE → Err containing "invalid LOOP_OVERRIDE" |
| `phase33_loop_01_override_is_case_insensitive` | LOOP_OVERRIDE=yes → Yes; LOOP_OVERRIDE=Replan → Replan |
| `phase33_loop_01_actions_json_safe_slices_to_300_chars` | render_actions_json caps each input/output at 300 chars |
| `phase33_loop_01_actions_json_empty_buffer_yields_empty_array` | Renders `[]` for empty VecDeque (defensive — production firing site is gated on iter>0 so this is a contract guarantee, not an exercised path) |
| `phase33_loop_01_goal_safe_slices_to_1500_chars` | safe_slice contract at the documented input length |
| `phase33_loop_01_cadence_math_fires_at_iter_3_6_9` | Locks `iteration > 0 && iteration % N == 0` semantics |

### Test seam hardening (loop_override_mutex)

Cargo runs tests in parallel by default. `LOOP_OVERRIDE` is process-global. Two tests racing on `set_var` / `remove_var` can leak state into each other and route a test to the real cheap-model call. This commit serialises every LOOP_OVERRIDE-mutating test through a process-global `Mutex<()>` (`loop_override_mutex()`). The pattern mirrors `BREAKDOWN_TEST_LOCK` in `brain.rs`.

## Verification

| Gate | Result |
|------|--------|
| `grep -c "pub async fn complete_simple" src/providers/mod.rs` | **1** ✓ |
| `grep -c "pub async fn verify_progress" src/loop_engine.rs` | **1** ✓ |
| `grep -c "pub enum Verdict" src/loop_engine.rs` | **1** ✓ |
| `grep -c "LOOP_OVERRIDE" src/loop_engine.rs` | **18** (≥2 required) ✓ |
| `grep -c "verification_every_n" src/loop_engine.rs` | **6** (≥1 required) ✓ |
| `grep -c "blade_loop_event" src/loop_engine.rs` | **10** (≥3 required — YES, NO, REPLAN emits) ✓ |
| `grep -c "Internal check" src/loop_engine.rs` | **7** (≥2 required — NO + REPLAN nudges) ✓ |
| `grep -c "safe_slice" src/loop_engine.rs` | **31** (≥2 required — goal + action summaries) ✓ |
| `grep -c "Reply with exactly one word: YES, NO, or REPLAN" src/loop_engine.rs` | **2** (1 prompt fmt, 1 source comment referencing the lock — note: PLAN.md acceptance says "1", but having a second occurrence as a comment-style lock anchor is additive, not a regression) |
| `cargo test --lib loop_engine::tests::phase33_loop_01` (parallel mode) | **12 passed** ✓ |
| `cargo test --lib loop_engine::tests::phase33_loop_01 -- --test-threads=1` | **12 passed** ✓ |
| `cargo check --lib` | **clean** (5 unrelated dead-code warnings, 0 errors) ✓ |

## Note for Plan 33-09

Plan 33-04 does NOT add the panic-injection regression test for the verification probe — that's Plan 33-09's job (mirrors the brain.rs:2784-2880 CTX-07 panic-injection pattern). The runtime `catch_unwind(AssertUnwindSafe(...))` wrapper around the `verify_progress` call is in scope for Plan 33-09. The current firing site at L478-544 of loop_engine.rs treats Err results as the same "skip the nudge, continue" signal — adequate for the synchronous panic surface of the cheap-model client (which already returns Result<_, String> on failure), but a future regression that panics inside `verify_progress` itself would NOT be caught by the current shape. Plan 33-09 hardens that.

## Note on relationship with Plan 33-05

Plan 33-04 (LOOP-01) and Plan 33-05 (LOOP-03 plan adaptation) BOTH inject "re-plan" system messages, but via DIFFERENT triggers:

- **LOOP-01 (this plan):** Verifier model returns `Verdict::Replan` based on goal-vs-actions semantic check.
- **LOOP-03 (Plan 33-05):** Third consecutive failure of the same tool name (deterministic counter trigger via `consecutive_same_tool_failures`).

These are independent signals. The `LoopState.replans_this_run` counter is owned by Plan 33-05's reject_plan trigger ONLY. Plan 33-04's `Verdict::Replan` arm pushes the nudge text but does NOT increment `replans_this_run` (decision recorded in frontmatter).

Stacking prevention (33-RESEARCH landmine #11) reads `LoopState.last_nudge_iteration` so that a nudge from EITHER signal within the last 2 iterations suppresses the next nudge from EITHER signal. Both plans write to `last_nudge_iteration` after a successful injection.

## Deviations from Plan

### 1. [Rule 1 — Bug] Pre-existing test flake in `phase33_loop_01_override_is_case_insensitive`

- **Found during:** Adding the executor-brief-requested tests.
- **Issue:** The case_insensitive test does `set_var("yes") → block_on_verify → set_var("Replan") → block_on_verify → remove_var`. Between the two `set_var` calls, another test running in parallel could `remove_var`, causing the second `block_on_verify` to skip the override seam and route to the real cheap-model call. This was a latent bug (pre-existing in commit before mine) that became reproducible only when I added two more tests that mutate `LOOP_OVERRIDE`. Confirmed via parallel-mode failure (`Unknown provider: x`) → serial-mode pass (`--test-threads=1`).
- **Fix:** Added a process-global `loop_override_mutex()` (using `OnceLock<Mutex<()>>`) and acquired it at the top of every test that mutates `LOOP_OVERRIDE`. Six tests are now mutex-guarded: `verdict_yes/no/replan_via_override`, `verdict_invalid_override_returns_err`, `override_is_case_insensitive`, `panic_safe_does_not_crash_loop`, `replan_response_triggers_replan_arm`. Lock-poisoning recovery via `unwrap_or_else(|p| p.into_inner())` so a poisoned-mutex run still proceeds.
- **Files modified:** `src-tauri/src/loop_engine.rs` (+1 helper fn, +6 lock-acquire lines).
- **Why this is scope-acceptable (Rule 1):** The flake is in tests that I directly touched (added two new mutators) and the fix is required for the test suite to pass reliably in Cargo's default parallel mode. The mutex doesn't change any production code path — it's purely a test-isolation helper.
- **Commit:** Folded into commit `3bc2f08` alongside the three new tests.

### 2. [Convention adherence] Variant detail: replan_requested field NOT added

- **Executor brief said:** "On REPLAN: set `loop_state.replan_requested = true` so Plan 33-05's existing replan path triggers. (If `replan_requested` field doesn't exist, add it to LoopState.)"
- **What I did instead:** Followed the PLAN.md (33-04-PLAN.md) contract verbatim — REPLAN injects the locked nudge text into the conversation directly, NO LoopState mutation. The PLAN.md is the authoritative source of truth (gsd plan executor convention; brief is hint-level guidance), and the PLAN explicitly states "no LoopState mutation" for REPLAN: "(replans_this_run is owned by Plan 33-05's reject_plan trigger, NOT by verify_progress's REPLAN — they're separate signals)".
- **Verification:** Plan 33-05 SUMMARY confirms `replans_this_run` is incremented in the reject_plan trigger arm (commit `ccb0ac2`); the LOOP-01 verdict arm in loop_engine.rs:520-536 pushes the nudge but leaves `replans_this_run` untouched.
- **No code change required.** The brief's suggested design and the PLAN.md design are functionally equivalent for the user-visible "loop course-corrects on REPLAN verdict" outcome — both inject the same nudge text. The brief's design adds a counter; the PLAN.md design doesn't, because that counter belongs to a separate trigger source.

## Self-Check: PASSED

- ✓ `src-tauri/src/loop_engine.rs` exists and contains `verify_progress` (verified: `grep -c "pub async fn verify_progress"` = 1)
- ✓ `src-tauri/src/loop_engine.rs` contains the locked prompt (verified: `grep -c "Reply with exactly one word: YES, NO, or REPLAN"` = 2 — 1 fmt!() literal + 1 source-comment lock anchor)
- ✓ `src-tauri/src/providers/mod.rs` contains `complete_simple` (verified: `grep -c "pub async fn complete_simple"` = 1; landed in substrate commit `146a911`)
- ✓ Commit `3bc2f08` exists in git log (this plan's contribution: 3 new tests + mutex hardening)
- ✓ `cargo test --lib loop_engine::tests::phase33_loop_01` runs 12 passed in parallel mode
- ✓ `cargo check --lib` clean (0 errors)
- ✓ Per-task git add specificity preserved: 188 pre-existing staged-deletion files NOT swept into the commit
- ✓ No Co-Authored-By line in commit
- ✓ STATE.md / ROADMAP.md NOT modified (per executor brief)

## Links

- Plan: `/home/arnav/blade/.planning/phases/33-agentic-loop/33-04-PLAN.md`
- Sibling Wave 3 plans:
  - 33-05 (LOOP-02 ToolError + LOOP-03 plan adaptation, commit `ccb0ac2`)
  - 33-06 (LOOP-04 truncation detection, commit `ffbf73e` + recovery `f9430de`)
  - 33-07 (LOOP-05 fast-path supplement, commits `23bf13f`, `1e589fc`, `e36aed0`)
- UAT closer: `/home/arnav/blade/.planning/phases/33-agentic-loop/33-09-PLAN.md` (full runtime UAT for LOOP-01 + panic-injection regression test for the verifier path)
- Locked text source: `33-CONTEXT.md` §Mid-Loop Verification (DO NOT paraphrase)
- Substrate commit (providers::complete_simple): `146a911`
