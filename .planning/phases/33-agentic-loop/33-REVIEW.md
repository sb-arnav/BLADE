---
phase: 33-agentic-loop
reviewed: 2026-05-05T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - src-tauri/src/loop_engine.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/config.rs
  - src-tauri/src/providers/mod.rs
  - src-tauri/src/providers/anthropic.rs
  - src-tauri/src/providers/openai.rs
  - src-tauri/src/providers/groq.rs
  - src-tauri/src/providers/gemini.rs
  - src-tauri/src/providers/ollama.rs
  - src-tauri/src/native_tools.rs
  - src-tauri/src/brain.rs
  - src-tauri/tests/loop_engine_integration.rs
findings:
  blocker: 2
  high: 3
  medium: 3
  low: 2
  total: 10
status: issues_found
---

# Phase 33 — Code Review Report

**Reviewed:** 2026-05-05
**Depth:** deep (cross-file: provider trait + run_loop + config + fast-path)
**Status:** issues_found

## Summary

Phase 33 ships a clean architectural lift (`commands.rs:1626` → `loop_engine::run_loop`), strong panic discipline ports from Phase 32-07 (`futures::FutureExt::catch_unwind` on the verifier, `std::panic::catch_unwind` on the truncation decision), and a textbook six-place `LoopConfig` wire-up. Tests are dense and mirror Phase 32's seam pattern correctly.

But the smart path has two concrete DOA bugs and three serious correctness gaps. The two BLOCKERs are pre-runtime — both reproduce on the static surface that "27 verify gates green" missed in v1.1, exactly the failure mode the operator briefed against:

1. **`verification_every_n: 0` in config panics the chat task on iter 3** — no validate(), no zero-guard at the firing-site modulo. Default is 3 so the happy path is fine; a typo or future migration crashes the runtime with no fallback.
2. **LOOP-05 fast-path supplement injection silently strips the slow-path system prompt on Anthropic + Gemini** — both providers' `build_body` use `.find_map()` which returns the FIRST System message. The supplement at index 0 displaces the (rich, ~10k-token) slow-path prompt to index 1 where it is dropped. Pre-Phase-33 Anthropic fast path correctly received the full slow-path prompt; Phase 33 makes it WORSE on the single most-used provider.

The HIGHs cover (a) a hardcoded `current_max_tokens=4096` that mis-estimates Gemini/Groq/Ollama (whose actual default is 8192) producing wasted-cost no-op escalations, (b) a cost-guard underflow on the truncation-retry path that ignores the original truncated call's actual API spend, and (c) an absent panic shield around the truncation `.await` retry call which can crash the run_loop task from inside a smart-path branch (CTX-07 discipline broken). Medium and low findings mostly cluster around observability (replan-counter suppression interaction) and minor code-smell.

## Blocker Issues

### BL-01: `verification_every_n = 0` crashes the chat task with integer-modulo panic

**File:** `src-tauri/src/loop_engine.rs:537-540`
**Issue:** The verification firing site evaluates `(iteration as u32) % config.r#loop.verification_every_n == 0` with no zero-guard. Rust's `%` panics on divisor 0. `LoopConfig` has NO `validate()` (compare `RewardWeights::validate()` at `config.rs:219` which is the established pattern). A user editing `~/.blade/config.json` to `{"verification_every_n": 0}` — or any future migration that defaults the field to 0 — will panic the run_loop Tokio task at iter 1 (since `iteration > 0` lets us in). The future is NOT inside any outer `catch_unwind`; the panic kills the task and the chat hangs (no `chat_done`, no `chat_error`). Default is 3 so happy-path is fine but this is a hostile-config DoS surface and a real regression risk for any future config migration.

**Fix:**
```rust
// loop_engine.rs:537 — guard the modulo
let cadence = config.r#loop.verification_every_n.max(1); // 0 = disabled fallback to 1
if config.r#loop.smart_loop_enabled
    && iteration > 0
    && config.r#loop.verification_every_n > 0
    && (iteration as u32) % cadence == 0
{ /* ... */ }
```
Or add `LoopConfig::validate()` mirroring `RewardWeights::validate()` (clamp `verification_every_n >= 1`, `max_iterations >= 1`, `cost_guard_dollars >= 0`) and call it as the first statement of `save_config` (`config.rs:971`).

---

### BL-02: LOOP-05 fast-path supplement strips slow-path system prompt on Anthropic + Gemini

**File:** `src-tauri/src/commands.rs:1487` (insert site) + `src-tauri/src/providers/anthropic.rs:9-12` + `src-tauri/src/providers/gemini.rs:8-13`
**Issue:** `build_conversation(messages, Some(system_prompt))` puts the assembled slow-path system prompt at `conversation[0]`. LOOP-05 then does `conversation.insert(0, ConversationMessage::System(supplement))`, displacing the slow-path prompt to `conversation[1]`. Both Anthropic and Gemini's `build_body` extract the system message via `.find_map()` — they take the FIRST and ignore subsequent `System(_)` entries. Result on Anthropic + Gemini fast path: only the ~1k-token supplement is sent; the rich ~10k-token slow-path prompt (character_bible, persona, smart_ctx, brain_l0_critical_facts, all the slow-path injections built at `commands.rs:1167-1186`) is silently dropped.

This is a regression vs pre-Phase-33: pre-Phase-33 fast-path passed `&conversation` with the slow-path prompt at index 0 and Anthropic happily extracted it. Phase 33 makes Anthropic fast-path identity STRICTLY POORER than v1.4. OpenAI/Groq/OpenRouter behave differently (their `serialize_message` emits System as plain `{"role":"system"}` array entries, so BOTH prompts get sent) — divergent runtime semantics across providers from a single insert site.

This is exactly the failure-mode the v1.1 retraction warned about: static gates pass (test asserts `<= 2k tokens`, `serialize_message` is unit-tested separately), runtime is broken on the production Anthropic path.

**Fix:** Decide intent and align all five providers. If supplement-only is intent (per CONTEXT.md "build an identity-supplement-only system prompt"), don't pass `Some(system_prompt)` to `build_conversation` on the fast path — replace with `None` and inject ONLY the supplement. If supplement-as-prefix is intent, concatenate into a single System message:
```rust
// commands.rs:1476 — concatenate into the existing System(0) instead of insert
if config.r#loop.smart_loop_enabled {
    let supplement = std::panic::catch_unwind(/* ... */).unwrap_or_default();
    if !supplement.is_empty() {
        if let Some(ConversationMessage::System(existing)) = conversation.get_mut(0) {
            *existing = format!("{}\n\n---\n\n{}", supplement, existing);
        } else {
            conversation.insert(0, ConversationMessage::System(supplement));
        }
    }
}
```
Add a regression test that builds the body for both Anthropic and Gemini with two system messages present and asserts the slow-path prompt content is in the outgoing request body.

## High

### HI-01: Hardcoded `current_max_tokens = 4096` mis-estimates Gemini/Groq/Ollama, fires no-op cost-burning escalations

**File:** `src-tauri/src/loop_engine.rs:883`
**Issue:** The truncation block hardcodes `let current_max_tokens: u32 = 4096;`. This matches the literal default in `providers/anthropic.rs:27` and `providers/openai.rs:42`, but **Gemini, Groq, Ollama don't pass a default `max_tokens` at all** — they let the provider use its own default (Gemini: 8192, Groq: 8192). When the punctuation heuristic flags a non-truncated Gemini/Groq response (e.g. an enumerated list ending in a list item without terminal punctuation), `escalate_max_tokens("groq", _, 4096)` returns `Some(8192)` → `complete_turn_with_max_tokens(.., 8192)` retries with the SAME ceiling Groq was already using → identical truncation outcome but at full retry cost. Cost-guard projection at line 912-917 charges the doubled retry as if it were a real escalation.

Worse: the heuristic is provider-agnostic but the right-tail punctuation set (`'.' | '!' | '?' | ':' | '"' | ')' | '`'`) misses common legitimate endings like `]`, `}`, `*`, digits, a closing tag `>`, or any non-Latin script (Chinese full-stop `。`, Japanese `」`, etc.). Combined with the misleading 4096 baseline, false-positive escalations on Gemini/Groq are likely to dominate in practice.

**Fix:** Either (a) thread the provider's actual default through `escalate_max_tokens` (e.g. read it from `max_output_tokens_for / 2` as the "plausible default") and skip escalation when `current >= provider_default`, or (b) gate the punctuation heuristic on providers that DON'T report `stop_reason` reliably (Ollama only) and trust `stop_reason` exclusively for Anthropic/OpenAI/Groq/Gemini/OpenRouter. Recommend (b) — fewer edge cases.

---

### HI-02: Truncation-retry cost accounting under-counts the original truncated turn

**File:** `src-tauri/src/loop_engine.rs:999-1007` (combined with 956-967)
**Issue:** When the truncation gate fires and `retry_turn` is `Ok`, the code does `turn = retry_turn` and the original truncated turn is discarded. The cost-accumulation block at line 999 then accumulates ONLY `turn.tokens_in / turn.tokens_out` from the (replaced) retry. The original truncated call's tokens were paid for at the API but never tracked in `cumulative_cost_usd`. Comment at line 990-998 acknowledges this as a "minor under-count". On a 4096-output truncated call followed by an 8192-output retry on Anthropic Sonnet 4 (`$3/$15` per million), the unaccounted spend is `(prompt × $3 + 4096 × $15) / 1M` ≈ $0.06 per truncation event. For users running a `cost_guard_dollars: 5.0` cap, this is up to 1.2% under-count per truncation hit. Multiply by repeated truncations across a long agentic run and the cost guard fires noticeably late.

The cost-projection inside the catch_unwind (line 912-917) ALREADY computes `turn_tokens_in × price_in + new_max × price_out` correctly — that estimate was used to gate the escalation but never persisted. The fix is mechanical.

**Fix:**
```rust
// loop_engine.rs:956 — track the truncated turn's cost before discarding it
if let Some(new_max) = new_max_opt {
    // ... emit + token_escalations.saturating_add(1) ...
    let original_cost = (turn.tokens_in as f32 * price_in
                       + turn.tokens_out as f32 * price_out) / 1_000_000.0;
    loop_state.cumulative_cost_usd += original_cost;  // <-- account for the discarded call
    let retry = providers::complete_turn_with_max_tokens(/* ... */).await;
    if let Ok(retry_turn) = retry { turn = retry_turn; }
}
```
Then the post-block accumulation at line 999 picks up the retry's cost on top.

---

### HI-03: Truncation `.await` retry has no panic shield — smart-path → main-thread crash

**File:** `src-tauri/src/loop_engine.rs:947-955` + commented contract at 868-876
**Issue:** The comment at line 868-876 explicitly documents that the synchronous decision (detect → escalate → projection) is wrapped in `catch_unwind`, but acknowledges "The async retry call itself is outside the catch_unwind (catch_unwind cannot wrap an .await)". The verifier path uses `futures::FutureExt::catch_unwind` exactly to solve this — see line 556-565 — but the truncation retry does not. If `complete_turn_with_max_tokens` panics (e.g. a regression in a provider's response parser, malformed JSON unwrap, integer overflow in usage parse), the run_loop task crashes mid-iteration with no `LoopHaltReason` and no `chat_error`. The chat appears to hang. CTX-07 discipline says smart-path → naive-path on panic; this branch breaks that.

**Fix:** Mirror the verifier wrap exactly:
```rust
use futures::FutureExt;
let retry = std::panic::AssertUnwindSafe(providers::complete_turn_with_max_tokens(
    &config.provider, &config.api_key, &config.model,
    conversation, tools, config.base_url.as_deref(), new_max,
)).catch_unwind().await;
match retry {
    Ok(Ok(retry_turn)) => turn = retry_turn,
    Ok(Err(_)) | Err(_) => { /* keep original turn */ }
}
```
Add a regression test mirroring `phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper`.

## Medium

### ME-01: Cost guard silently bypassed when provider doesn't report usage AND price is zero

**File:** `src-tauri/src/loop_engine.rs:999-1007` + `src-tauri/src/providers/mod.rs:382` (`("ollama", _) => (0.00, 0.00)`)
**Issue:** Ollama's price tuple is `(0.00, 0.00)`. Combined with the cost-accumulation path's `(tokens_in × price_in + tokens_out × price_out) / 1_000_000.0`, Ollama runs accumulate exactly `0.0` per turn forever. `cost_guard_dollars > 0.0` then never fires. That's intentional for local Ollama — fair. But unknown providers also fall through to `(1.00, 3.00)` instead of `(0,0)` (line 383), preventing free-tier spoofing. The combined posture is mostly OK, but: when ANY provider returns `tokens_in=0` (custom OpenAI-compatible gateways, NIM, Vercel AI Gateway with usage stripped — see comment at `providers/openai.rs:204-206`), the cost guard accumulates `(0 × price_in + 0 × price_out) / 1M = 0` regardless of actual API spend. A misconfigured gateway that strips `usage` becomes a cost-guard-blind chat. 

**Fix:** When `tokens_in = tokens_out = 0` AND `provider != "ollama"`, log a structured warning and fall back to a conservative token-estimate from the conversation length (e.g. `chars / 4`). Or surface a `blade_notification` so the user knows their cost guard is degraded.

---

### ME-02: Replan counter under-reports when verification REPLAN suppresses the same-tool replan

**File:** `src-tauri/src/loop_engine.rs:596-612` and `src-tauri/src/loop_engine.rs:1808-1837`
**Issue:** When verify_progress returns `Verdict::Replan` at iter 3 (LOOP-01 path), the code pushes the locked nudge and sets `last_nudge_iteration = 3`. The kind emitted is `verification_fired { verdict: "REPLAN" }`, NOT `replanning`. Critically, `replans_this_run` is NOT incremented in this branch (it's only incremented in the LOOP-03 same-tool-failure path at line 1818). If the SAME iteration also has a third-same-tool failure, the stacking guard at line 1811-1815 sees `last_nudge_iteration = 3, iteration = 3`, `saturating_sub = 0 <= 2`, suppresses → `replans_this_run` stays at 0 and the `replanning` chip never emits. ActivityStrip shows "verifying (replan)" but no "replanning (#1)" chip even though the pattern matched twice. The success criterion "two consecutive plan adaptations must be observable in a multi-step task" can be undercounted by 50% in the worst case.

**Fix:** Either increment `replans_this_run` in the LOOP-01 REPLAN arm too (it's a real replan signal), or accept the divergence and document the chip semantics so observers know `replans_this_run` is the same-tool-failure path only.

---

### ME-03: `consecutive_same_tool_failures` HashMap iteration order is non-deterministic when invariant is violated

**File:** `src-tauri/src/loop_engine.rs:1791-1795`
**Issue:** The "last failed tool" lookup uses `loop_state.consecutive_same_tool_failures.keys().next().cloned()`. The design comment claims "should only have one key at a time", which holds under the current control flow. But `.keys().next()` on a HashMap is **non-deterministic** if the invariant is ever violated (e.g. by a future edit that forgets to clear, or by a race with a future parallel-tool-call refactor). The error mode is silent: a different "last failed tool" is selected on each iteration, the streak counter behaves weirdly, no panic, no log. Defensive code should use `Option<(String, u32)>` or a single-element `Option<String>` next to the counter rather than a HashMap.

**Fix:** Replace with explicit single-slot state:
```rust
pub struct LoopState {
    /* ... */
    pub last_failed_tool: Option<(String, u32)>,  // (tool_name, consecutive_count)
}
```
Eliminates the `.keys().next()` non-determinism and the `clear()` dance.

## Low

### LO-01: Truncation punctuation heuristic misses common non-truncated endings

**File:** `src-tauri/src/loop_engine.rs:381`
**Issue:** The terminal-punctuation set is `'.' | '!' | '?' | ':' | '"' | ')' | '`'`. Misses `]` (closing bracket — common in JSON / array-style answers), `}` (JSON object), `*` (markdown emphasis end), `>` (HTML/quote), digits (e.g. "the answer is 42"), and ALL non-Latin sentence-finals (Chinese `。`, Japanese `」`, Arabic `؟`). Combined with HI-01 above, false-positive escalations are likely on legitimate code-output, JSON-output, and non-English chats. Not a security or crash issue, just a money-leak.

**Fix:** Extend the set: add `]` `}` `*` `>` digits `0..=9` `。` `」`. Or, more robustly, gate the heuristic on `stop_reason.is_none()` AND output length close to `max_tokens`.

---

### LO-02: `chars().last()` on `trim_end()` is O(n) per turn — minor allocation pressure

**File:** `src-tauri/src/loop_engine.rs:376-381`
**Issue:** `trimmed.chars().last()` walks the entire string from the start to find the last char (Rust strings have no O(1) reverse iter). For a 4096-token response (~16k bytes typical), this is a one-time O(n) walk per turn — fine for correctness. Documented in the comment ("O(n) — fine here because the tail check runs once per turn"). Flagged only because the same string is then NOT used and could be avoided entirely by checking `as_bytes().last()` if guaranteed-ASCII (it's not). Acceptable as-is.

**Fix:** None required. If profiling shows this on a hot path, switch to `chars().rev().next()` (still O(n) for a `&str` since chars don't have constant-time reverse, but more idiomatic).

---

## Notes Out of Scope

- The `cumulative_cost_usd: f32` precision over a long conversation drifts but the $5 default cap stays trippable; `f64` would be cleaner but is not load-bearing.
- `CHAT_CANCEL` is checked only at iteration top — long tool dispatches don't observe cancel mid-flight. Pre-Phase-33 behavior; not introduced by this phase.
- `std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id)` at `loop_engine.rs:1023` is a process-wide global; concurrent chats would race. CHAT_INFLIGHT prevents that today; pre-existing Phase 18 wiring.
- The integration test `phase33_loop_survives_forced_panic_in_smart_path` is misleadingly named (no panic injection — just a config kill-switch toggle); not a bug, just a test-name nit.

---

_Reviewed: 2026-05-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
