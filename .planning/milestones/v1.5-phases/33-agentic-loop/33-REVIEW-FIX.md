---
phase: 33-agentic-loop
fixed_at: 2026-05-06T00:00:00Z
review_path: .planning/phases/33-agentic-loop/33-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 33 — Code Review Fix Report

**Fixed at:** 2026-05-06
**Source review:** `.planning/phases/33-agentic-loop/33-REVIEW.md`
**Iteration:** 1
**Scope:** BLOCKERS + HIGHs only (per operator directive). MEDIUMs and LOWs deferred to v1.6.

**Summary:**
- Findings in scope: 5 (BL-01, BL-02, HI-01, HI-02, HI-03)
- Fixed: 5
- Skipped: 0
- Tests added: 7
- Tests passing: 78 unit (`cargo test --lib phase33`) + 3 integration (`cargo test --test loop_engine_integration`)

## Fixed Issues

### BL-01: `verification_every_n = 0` crashes the chat task with integer-modulo panic

**Files modified:** `src-tauri/src/config.rs`, `src-tauri/src/loop_engine.rs`
**Commit:** `3546bc0`
**Applied fix:**
- Added `LoopConfig::validate()` method (mirrors the `RewardWeights::validate()` pattern at config.rs:219). Rejects `verification_every_n == 0`, `max_iterations == 0`, and `cost_guard_dollars < 0.0` with clear error strings identifying the offending field.
- Wired `validate()` into `save_config()` as the first executable statement after `reward_weights.validate()`. Hard-rejects corrupt knobs before any keychain write.
- Added defense-in-depth zero-guard at the firing site (loop_engine.rs:537): the `if config.r#loop.smart_loop_enabled && iteration > 0 && config.r#loop.verification_every_n > 0 && (iteration as u32) % verification_every_n == 0` short-circuits before the modulo even if some path bypasses validate (in-memory tests, future deserialize paths).

**Tests added:**
- `phase33_loop_06_verification_every_n_zero_does_not_panic` — walks 6 iterations with `verification_every_n=0` and confirms the gate short-circuits without panic.
- `phase33_loop_06_validate_rejects_zero_n` — exercises validate() against zero `verification_every_n`, zero `max_iterations`, negative `cost_guard_dollars`, and confirms the default config validates cleanly.

---

### BL-02: LOOP-05 fast-path supplement strips slow-path system prompt on Anthropic + Gemini

**Files modified:** `src-tauri/src/commands.rs`
**Commit:** `7b55fe3`
**Applied fix:**
- Replaced `conversation.insert(0, ConversationMessage::System(supplement))` with a merge-into-existing-System(0) pattern. When `conversation[0]` is already a `System(existing)`, the supplement is concatenated as `format!("{}\n\n---\n\n{}", supplement, existing)` (supplement first for identity grounding, delimiter, then the rich slow-path prompt). When no System is at index 0 (rare defensive fallback), the legacy insert path runs.
- Result: Anthropic + Gemini's `find_map()` extraction in build_body now sees BOTH pieces of system content in a single message, no more silent drop. Wire shape is now identical across all five providers regardless of how each one extracts System messages.

**Tests added:**
- `phase33_loop_05_supplement_does_not_displace_existing_system_prompt` — builds a conversation starting with a System message, runs the merge logic, and asserts: (a) `conversation[0]` is still System; (b) the merged content contains BOTH the slow-path prompt AND the supplement; (c) length did not grow (no insert+displace); (d) exactly one System message exists (find_map invariant).
- `phase33_loop_05_supplement_inserts_when_no_existing_system` — sister test for the defensive fallback: when no prior System exists, the supplement is inserted at index 0 with length growth.

---

### HI-01: Hardcoded `current_max_tokens = 4096` mis-estimates Gemini/Groq/Ollama

**Files modified:** `src-tauri/src/providers/mod.rs`, `src-tauri/src/loop_engine.rs`
**Commit:** `ac5c403`
**Applied fix:**
- Added `pub fn default_max_tokens_for(provider: &str, _model: &str) -> u32` to `providers/mod.rs`. Returns the actual baseline each provider would use:
  - `anthropic` / `openai`: 4096 (body-literal default in build_body)
  - `groq` / `gemini` / `ollama` / `openrouter`: 8192 (server-side default; build_body omits the field)
  - unknown: 4096 (conservative)
- Replaced the hardcoded `let current_max_tokens: u32 = 4096;` at loop_engine.rs:883 with `let current_max_tokens: u32 = crate::providers::default_max_tokens_for(&config.provider, &config.model);`.
- `escalate_max_tokens(provider, model, default)` now correctly returns `None` for Groq/Gemini (where default == cap), eliminating the false-positive cost-burning escalation on those providers.

**Tests added:**
- `phase33_loop_04_default_max_tokens_per_provider` — locks the per-provider table values and asserts the load-bearing invariant: `escalate_max_tokens(provider, model, default_max_tokens_for(provider, model)) == None` for Groq + Gemini, and `Some(8192)` for Anthropic + OpenAI gpt-4o (where real headroom exists).

---

### HI-02: Truncation-retry cost accounting under-counts the original truncated turn

**Files modified:** `src-tauri/src/loop_engine.rs`
**Commit:** `1e951a3` (combined with HI-03 — same retry block)
**Status:** fixed: requires human verification
**Applied fix:**
- Introduced `let mut original_cost_already_tracked: bool = false;` at the top of the truncation block (right after `let mut turn = turn;`).
- INSIDE the `if let Some(new_max) = new_max_opt` arm, BEFORE the retry call, accumulate the original turn's cost via `price_per_million(provider, model)` and set `original_cost_already_tracked = true`. This ensures the original API call is recorded whether the retry succeeds, fails, or panics.
- On retry-success (`Ok(Ok(retry_turn))`), `turn = retry_turn` and the flag is CLEARED (the retry's tokens have not yet been tracked, so the post-block accumulator should run on them).
- On retry-fail (`Ok(Err(_))`) and retry-panic (`Err(_panic)`), the flag stays `true` — `turn` still holds the original whose cost was already accumulated.
- The post-block accumulator is gated on `&& !original_cost_already_tracked`: skips on retry-fail / retry-panic to avoid double-counting; runs on retry-success and on the no-truncation path.

**Why "requires human verification":** This finding involves cost-accounting LOGIC, not just structure. The flag-based gating in the post-block accumulator is a real semantic invariant — operator should manually confirm the cumulative arithmetic on each path (no-truncation, retry-success, retry-fail, retry-panic) matches the intended billing model before relying on the cost guard.

**Tests added:**
- `phase33_loop_04_truncation_retry_does_not_undercount_cost` — exercises the retry-success arithmetic: original cost + retry cost = total cumulative. Asserts the original cost alone is non-trivial (>$0.05 on Sonnet 4 4096-out, the under-count threshold pre-fix).
- `phase33_loop_04_truncation_retry_does_not_overcount_on_retry_fail` — exercises the flag-based gating: after retry-fail, total cumulative equals exactly the original cost (no double-count from the post-block accumulator).

---

### HI-03: Truncation `.await` retry has no panic shield

**Files modified:** `src-tauri/src/loop_engine.rs`
**Commit:** `1e951a3` (combined with HI-02 — same retry block)
**Applied fix:**
- Wrapped the retry call in `futures::FutureExt::catch_unwind` exactly mirroring the verifier pattern at lines 556-565:
  ```rust
  use futures::FutureExt;
  let retry = std::panic::AssertUnwindSafe(
      providers::complete_turn_with_max_tokens(/* ... */),
  ).catch_unwind().await;
  match retry {
      Ok(Ok(retry_turn)) => { turn = retry_turn; original_cost_already_tracked = false; }
      Ok(Err(_e))        => { /* keep original; flag stays true */ }
      Err(_panic)        => { log::warn!("..."); /* keep original; flag stays true */ }
  }
  ```
- A panic in any provider's response parser during the retry now collapses gracefully to the dumb path (keep original truncated turn, continue iteration). CTX-07 smart-path → naive-path discipline restored.
- Updated the doc comment block at lines 868-882 to reflect the new dual catch_unwind layout (synchronous decision + async retry).

**Tests added:**
- `phase33_loop_04_truncation_retry_panic_safe` — mirrors the production wrapper (AssertUnwindSafe + catch_unwind + await) against a future that panics synchronously. Asserts the wrapper returns `Err(panic)` instead of crashing the test thread.

---

## Skipped Issues

None — all in-scope findings were fixed.

## Deferred to v1.6

Per operator directive, all MEDIUM and LOW findings are deferred:

- **ME-01:** Cost guard silently bypassed when provider doesn't report usage AND price is zero (Ollama / misconfigured gateways). Recommended fallback: when `tokens_in == tokens_out == 0` AND provider != "ollama", log structured warning + token-estimate fallback.
- **ME-02:** Replan counter under-reports when verification REPLAN suppresses same-tool replan. Recommended: increment `replans_this_run` in the LOOP-01 REPLAN arm too, OR document the chip semantics.
- **ME-03:** `consecutive_same_tool_failures` HashMap iteration order is non-deterministic when the single-key invariant is violated. Recommended: replace with explicit `Option<(String, u32)>` slot.
- **LO-01:** Truncation punctuation heuristic misses common non-truncated endings (`]`, `}`, `*`, `>`, digits, non-Latin sentence-finals). Recommended: extend the set or gate the heuristic on `stop_reason.is_none()` AND output length close to `max_tokens`.
- **LO-02:** `chars().last()` on `trim_end()` is O(n) per turn — minor allocation pressure. Acceptable as-is.

## Hard Constraints Honored

- [x] Atomic commits per fix; `git add <specific path>` only — 188 pre-existing unstaged deletions in repo NOT swept in.
- [x] No `Co-Authored-By` line on any commit.
- [x] Each commit message follows `fix(33-NN-FIX): [BL-01|BL-02|HI-01|HI-02|HI-03] [one-line summary]` (HI-02 + HI-03 combined into one commit because both fixes touch the same retry-block region and HI-02's flag-based gating depends on awareness of HI-03's panic-shield layout — splitting them would have required contortions).
- [x] No `cargo check` between every edit — batched, final check + test runs at end.
- [x] No `safe_slice` violations introduced (no new user-content slicing in any fix).
- [x] No `AskUserQuestion` calls — operator's autonomy directive honored.
- [x] STATE.md and ROADMAP.md NOT modified.
- [x] `cargo test --lib phase33` green: 78 / 78 passing.
- [x] `cargo test --test loop_engine_integration` green: 3 / 3 passing.

## Commits Made

| Finding | Commit | Files |
|---------|--------|-------|
| BL-01 | `3546bc0` | `src-tauri/src/config.rs`, `src-tauri/src/loop_engine.rs` |
| BL-02 | `7b55fe3` | `src-tauri/src/commands.rs` |
| HI-01 | `ac5c403` | `src-tauri/src/providers/mod.rs`, `src-tauri/src/loop_engine.rs` |
| HI-02 + HI-03 | `1e951a3` | `src-tauri/src/loop_engine.rs` |

---

_Fixed: 2026-05-06_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
