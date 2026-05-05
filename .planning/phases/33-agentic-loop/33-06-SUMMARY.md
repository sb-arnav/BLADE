---
phase: 33-agentic-loop
plan: 6
plan_name: LOOP-04 truncation detection + max_tokens escalation with cost-guard interlock
subsystem: agentic-loop / output-management
tags: [LOOP-04, truncation-detection, max-tokens-escalation, ctx-07-fallback, cost-guard-interlock, one-shot-retry]
requirements: [LOOP-04]
requirements_completed: [LOOP-04]
dependency_graph:
  requires:
    - 33-01 (LoopConfig + smart_loop_enabled + cost_guard_dollars)
    - 33-02 (LoopState + token_escalations field)
    - 33-03 (run_loop driver — iteration body lift)
    - 32-07 (CTX-07 fallback discipline + AssertUnwindSafe pattern)
  provides:
    - loop_engine::detect_truncation (provider-aware stop_reason + punctuation heuristic)
    - loop_engine::is_truncated_stop_reason (per-provider stop_reason normaliser)
    - loop_engine::escalate_max_tokens (one-shot doubling capped at per-model cap)
    - providers::AssistantTurn.stop_reason field (substrate landed in ffbf73e)
    - providers::max_output_tokens_for(provider, model) -> u32 (substrate landed in ffbf73e)
    - providers::complete_turn_with_max_tokens sibling fn (substrate landed in ffbf73e)
    - blade_loop_event {kind: "token_escalated", new_max: N} emit channel (consumer: Plan 33-08 ActivityStrip)
  affects:
    - src-tauri/src/loop_engine.rs (run_loop truncation gate + 16 unit tests)
    - src-tauri/src/providers/mod.rs (substrate, ffbf73e)
    - src-tauri/src/providers/anthropic.rs (substrate — complete_ext + stop_reason parse, ffbf73e)
    - src-tauri/src/providers/openai.rs (substrate — complete_ext + finish_reason parse, ffbf73e)
    - src-tauri/src/providers/groq.rs (substrate, ffbf73e)
    - src-tauri/src/providers/gemini.rs (substrate, ffbf73e)
tech_stack:
  added: []
  patterns:
    - catch_unwind(AssertUnwindSafe(...)) wrap around the synchronous decision (detect → escalate → cost-project) per CTX-07 / Phase 32-07 discipline
    - One-shot doubling — no inner loop on detect_truncation, structural guarantee against re-escalation
    - Per-provider stop_reason whitelist (anthropic="max_tokens", openai/openrouter/groq="length", gemini case-insensitive "MAX_TOKENS")
    - Punctuation-fallback heuristic for providers that don't surface stop_reason (Ollama, some OpenRouter routes)
    - UTF-8-safe trailing-char check via chars().last() (never byte slicing)
    - Cost-guard interlock stub with explicit TODO marker for Plan 33-08 hand-off
key_files:
  created: []
  modified:
    - src-tauri/src/loop_engine.rs (+293/-55 lines this commit; substrate ffbf73e + recovery f9430de + main wiring 5150b17)
decisions:
  - "Task 1 (substrate, commit ffbf73e) chose Option (b) — sibling fn complete_turn_with_max_tokens — over Option (a) — adding an Option<u32> parameter to complete_turn — to minimize blast radius. Existing complete_turn callers (commands.rs, brain_planner, swarm_planner, etc.) compile unchanged; only loop_engine.rs's truncation-retry path threads an override. The sibling delegates to a private complete_turn_inner that owns the override-aware path; complete_turn passes None, complete_turn_with_max_tokens passes Some(N). Both routes flow through the same per-provider dispatch (anthropic / openai / groq / gemini complete_ext)."
  - "Synchronous decision (detect_truncation + escalate_max_tokens + cost-guard projection) is wrapped in catch_unwind(AssertUnwindSafe(closure)). The async retry call (complete_turn_with_max_tokens) is OUTSIDE the catch_unwind because catch_unwind cannot wrap an .await. AssertUnwindSafe is required because the closure captures &config (BladeConfig carries non-UnwindSafe types — keyring handles, Mutex inner). On any sync-decision panic, the smart-path collapses to the dumb path: original truncated turn flows through unchanged, no retry, no chat crash. v1.1 lesson incarnate."
  - "The truncation block runs ONCE per iteration body — there is NO inner loop around detect_truncation. If the retried turn is also truncated (per stop_reason or punctuation heuristic), it flows through to conversation.push as-is. CONTEXT lock §LOOP-04: 'each turn allows at most 1 escalation.' Test phase33_loop_04_double_truncation_does_not_retry_again locks the structural guarantee via the escalate_max_tokens=None contract at the cap (8192 → None for Sonnet 4)."
  - "current_max_tokens is hardcoded to 4096 at the truncation gate (matches the body-literal default in providers/anthropic.rs:26 + providers/openai.rs:43 prior to substrate ffbf73e). The substrate now reads max_tokens_override from the call site, so a future bump to 8192 default needs to update both the literal and the gate's first-turn assumption."
  - "Cost-guard interlock uses a flat $0.00001/token overestimate as the stub. Plan 33-08 will replace this with a per-provider price table (anthropic Sonnet 4 input/output, OpenAI gpt-4o, etc.) and the projected_cost calculation will tighten. The TODO marker `let _projected_cost: f32 = 0.0; // TODO: Plan 33-08 wires real cost projection` is preserved verbatim inside the catch_unwind closure so 33-08's hand-off is mechanical."
key_links:
  - from: "src-tauri/src/loop_engine.rs (run_loop truncation gate, L753-870)"
    to: "src-tauri/src/loop_engine.rs (detect_truncation + escalate_max_tokens at L344-378)"
    via: "direct call inside catch_unwind closure"
    pattern: "detect_truncation|escalate_max_tokens"
  - from: "src-tauri/src/loop_engine.rs (escalate_max_tokens)"
    to: "src-tauri/src/providers/mod.rs (max_output_tokens_for at L313)"
    via: "provider-cap lookup"
    pattern: "max_output_tokens_for"
  - from: "src-tauri/src/loop_engine.rs (run_loop truncation gate retry)"
    to: "src-tauri/src/providers/mod.rs (complete_turn_with_max_tokens at L235)"
    via: "async retry call site"
    pattern: "complete_turn_with_max_tokens"
metrics:
  duration_minutes: ~30
  tasks_completed: 2
  files_modified: 1
  tests_added: 6
  tests_total_loop_04: 16
  lines_added: 293
  lines_removed: 55
  completed_date: 2026-05-05
---

# Phase 33 Plan 06: LOOP-04 Truncation Detection + Max-Tokens Escalation Summary

**One-liner:** When a provider turn comes back truncated (`stop_reason=="length"` / `"max_tokens"` / "MAX_TOKENS" depending on provider, OR last char is non-terminal punctuation), retry once with `max_tokens` doubled (capped at the per-model ceiling from `providers::max_output_tokens_for`). Cost-guard interlock skips the retry if it would breach `config.r#loop.cost_guard_dollars`. Smart-path is wrapped in `catch_unwind(AssertUnwindSafe(...))` so any decision-side regression collapses to the dumb path instead of crashing chat. ActivityStrip-visible via `blade_loop_event {kind: "token_escalated", new_max: N}`.

## What Was Built

**Note on substrate:** Plan 33-06 landed in three commits across the wave-3 work:

| Commit | Scope |
|--------|-------|
| `ffbf73e` | Task 1 substrate — `AssistantTurn.stop_reason` field, `max_output_tokens_for(provider, model) -> u32` helper, `complete_turn_with_max_tokens` sibling fn, plumbing `max_tokens_override: Option<u32>` through every provider's `complete_ext` (anthropic, openai, groq, gemini). |
| `f9430de` | Task 1 recovery — `commands.rs:2194` literal patched to include `stop_reason: None` (catch-up after the field landed). |
| `5150b17` | Task 2 wiring (this commit) — `detect_truncation` + `escalate_max_tokens` + `is_truncated_stop_reason` helpers, the run_loop truncation gate with `catch_unwind` wrap + cost-guard interlock + ActivityStrip event emit, and 16 unit tests. |

### `max_output_tokens_for` table (substrate — providers/mod.rs L313-331)

| Provider | Model match | Cap |
|----------|-------------|-----|
| anthropic | `claude-sonnet-4*` | 8_192 |
| anthropic | `claude-haiku*` | 8_192 |
| anthropic | (any other model) | 8_192 |
| openai | `gpt-4o-mini*` | 16_384 |
| openai | `gpt-4o*` | 16_384 |
| openai | `o1*` | 32_768 |
| openai | `gpt-3.5*` | 4_096 |
| openai | (any other model) | 4_096 |
| groq | (any model) | 8_192 |
| openrouter | (any model) | 8_192 |
| gemini | (any model) | 8_192 |
| ollama | (any model) | 4_096 |
| **fallback** | unknown provider | 4_096 |

CONTEXT lock §LOOP-04 calls out the Anthropic 64_000 ceiling that requires the `anthropic-beta: output-128k-2025-02-19` header — Phase 33 stays at 8_192 to avoid header juggling. When Phase 34/35 needs the higher cap, the table moves to 64_000 and the header is set conditionally.

### `complete_turn_with_max_tokens` sibling fn (substrate — providers/mod.rs L235-248)

Plan 33-06 chose **Option (b)** (sibling fn) over **Option (a)** (add `Option<u32>` param to `complete_turn`) per the planner's blast-radius analysis. The sibling delegates to a private `complete_turn_inner` that accepts the override; the public `complete_turn` passes `None`, the public `complete_turn_with_max_tokens` passes `Some(N)`. Existing call sites of `complete_turn` (commands.rs main loop, brain_planner, swarm_planner, native_tools fallback paths, etc.) compile unchanged.

```rust
pub async fn complete_turn(
    provider: &str, api_key: &str, model: &str,
    messages: &[ConversationMessage], tools: &[ToolDefinition], base_url: Option<&str>,
) -> Result<AssistantTurn, String> {
    complete_turn_inner(provider, api_key, model, messages, tools, base_url, None).await
}

pub async fn complete_turn_with_max_tokens(
    provider: &str, api_key: &str, model: &str,
    messages: &[ConversationMessage], tools: &[ToolDefinition], base_url: Option<&str>,
    max_tokens_override: u32,
) -> Result<AssistantTurn, String> {
    complete_turn_inner(provider, api_key, model, messages, tools, base_url, Some(max_tokens_override)).await
}
```

The internal `max_tokens_override: Option<u32>` is threaded into every per-provider `complete_ext` (anthropic / openai / groq / gemini); each provider's body-builder uses `max_tokens_override.unwrap_or(<existing default>)` at the JSON-build site. Anthropic's thinking-mode max-tokens path is NOT escalated (Phase 33 doesn't escalate thinking-mode turns).

### `AssistantTurn.stop_reason` (substrate — providers/mod.rs L161-176)

Per-provider stop_reason populated by each provider's response parser:

| Provider | Field | Values |
|----------|-------|--------|
| Anthropic | `stop_reason` | `"end_turn"` \| `"max_tokens"` \| `"stop_sequence"` \| `"tool_use"` |
| OpenAI / OpenRouter / Groq | `choices[0].finish_reason` | `"stop"` \| `"length"` \| `"tool_calls"` \| `"content_filter"` |
| Gemini | `candidates[0].finishReason` | `"STOP"` \| `"MAX_TOKENS"` \| `"SAFETY"` \| … |
| Ollama | `done_reason` (if present) | model-specific; `None` when absent |

`detect_truncation` does the per-provider mapping in `is_truncated_stop_reason`.

### `detect_truncation` (loop_engine.rs L344-355)

```rust
pub fn detect_truncation(provider: &str, turn: &crate::providers::AssistantTurn) -> bool {
    if is_truncated_stop_reason(provider, turn.stop_reason.as_deref()) {
        return true;
    }
    let trimmed = turn.content.trim_end();
    if trimmed.is_empty() { return false; }
    let last = trimmed.chars().last().unwrap_or(' ');
    !matches!(last, '.' | '!' | '?' | ':' | '"' | ')' | '`')
}
```

Two signals (CONTEXT lock §Max-Output-Token Escalation):

1. **Provider stop_reason** — primary signal. `is_truncated_stop_reason` whitelists per provider:
   - `("anthropic", Some("max_tokens"))` → true
   - `("openai", Some("length"))` → true
   - `("openrouter", Some("length"))` → true
   - `("groq", Some("length"))` → true
   - `("gemini", Some(s)) if s.eq_ignore_ascii_case("MAX_TOKENS")` → true
   - everything else → false
2. **Punctuation heuristic** — fallback for providers that don't surface stop_reason cleanly (Ollama, some OpenRouter routes). Last UTF-8 char (`chars().last()`) checked against `. ! ? : " ) `` ` `` `. Anything else → truncated.

UTF-8 safety: never byte-slicing — `chars().last()` returns the final scalar, so non-ASCII content (Chinese, Arabic, emoji) is handled correctly. CLAUDE.md §"Don't use `&text[..n]`".

### `escalate_max_tokens` (loop_engine.rs L373-378)

```rust
pub fn escalate_max_tokens(provider: &str, model: &str, current: u32) -> Option<u32> {
    let cap = crate::providers::max_output_tokens_for(provider, model);
    let doubled = current.saturating_mul(2);
    let new_max = doubled.min(cap);
    if new_max <= current { None } else { Some(new_max) }
}
```

One-shot doubling: `current * 2`, capped at `max_output_tokens_for(provider, model)`. Returns `None` when `current >= cap` — structural guarantee against re-escalation (the production gate is non-recursive; even if a future edit accidentally re-entered the gate, `escalate_max_tokens` would refuse to double again).

### Run_loop truncation gate (loop_engine.rs L753-870)

Sits between `complete_turn`'s assistant response and `conversation.push(Assistant{...})`. Order matters: the truncated turn is NOT yet in `conversation` when the gate runs, so swapping `turn = retry_turn` before the push is the canonical insertion site.

Gate shape:

```rust
let mut turn = turn;
if config.r#loop.smart_loop_enabled {
    let current_max_tokens: u32 = 4096;

    // CTX-07 / Phase 32-07 panic discipline — wrap the synchronous decision.
    // Captures cloned strings + Copy values so the closure is panic-safe.
    let provider_str = config.provider.clone();
    let model_str = config.model.clone();
    let cumulative = loop_state.cumulative_cost_usd;
    let cost_cap = config.r#loop.cost_guard_dollars;
    let turn_ref = &turn;
    let escalate_decision = std::panic::catch_unwind(
        std::panic::AssertUnwindSafe(|| {
            if !detect_truncation(&provider_str, turn_ref) { return None; }
            let new_max = escalate_max_tokens(&provider_str, &model_str, current_max_tokens)?;
            // Cost-guard interlock — Plan 33-08 wires real per-provider price math here.
            let _projected_cost: f32 = 0.0; // TODO: Plan 33-08 wires real cost projection
            let estimated_extra = (new_max as f32 - current_max_tokens as f32) * 0.000_01;
            let projected = cumulative + estimated_extra;
            if projected <= cost_cap { Some(new_max) } else { None }
        }),
    );

    let new_max_opt = match escalate_decision {
        Ok(v) => v,
        Err(_) => {
            log::warn!("[LOOP-04] truncation-decision panicked; falling through to original turn");
            None
        }
    };

    if let Some(new_max) = new_max_opt {
        emit_stream_event(&app, "blade_loop_event", serde_json::json!({
            "kind": "token_escalated", "new_max": new_max,
        }));
        loop_state.token_escalations = loop_state.token_escalations.saturating_add(1);

        let retry = providers::complete_turn_with_max_tokens(
            &config.provider, &config.api_key, &config.model,
            conversation, tools, config.base_url.as_deref(), new_max,
        ).await;
        if let Ok(retry_turn) = retry {
            turn = retry_turn;
        }
        // On retry Err: accept the original truncated turn — no infinite escalation.
    }
}

conversation.push(ConversationMessage::Assistant {
    content: turn.content.clone(),
    tool_calls: turn.tool_calls.clone(),
});
```

Why the `catch_unwind` wraps only the synchronous decision: `catch_unwind` cannot wrap an `.await`; the async retry call (`complete_turn_with_max_tokens`) is outside the wrap, with its own `Result`-based error handling. The wrap protects against future regressions in `detect_truncation` / `escalate_max_tokens` / the cost-math closure (e.g. integer overflow on a future per-provider price-table edit). On any panic, smart-path collapses to dumb-path: original truncated turn flows through unchanged, no retry, no chat crash. v1.1 lesson incarnate.

**Provider stop_reason populated:** The substrate landed `stop_reason` parsing in:
- `providers/anthropic.rs::complete_ext` — reads top-level `stop_reason` field
- `providers/openai.rs::complete_ext` — reads `choices[0].finish_reason` and stores as `stop_reason`
- `providers/groq.rs::complete_ext` — same as openai (compatible API)
- `providers/gemini.rs::complete_ext` — reads `candidates[0].finishReason`
- `providers/openai.rs::complete_ext` (when called via openrouter dispatch in providers/mod.rs L291) — finish_reason flows through unchanged
- `providers/ollama.rs::complete` — best-effort; surfaces `done_reason` when present

## Tests (16 LOOP-04 tests, all green)

```
test loop_engine::tests::phase33_loop_04_cost_guard_interlock_stub_at_cap ... ok
test loop_engine::tests::phase33_loop_04_cost_guard_interlock_stub_under_cap ... ok
test loop_engine::tests::phase33_loop_04_detect_truncation_via_anthropic_max_tokens ... ok
test loop_engine::tests::phase33_loop_04_detect_truncation_via_openai_length ... ok
test loop_engine::tests::phase33_loop_04_detect_truncation_via_punctuation_heuristic ... ok
test loop_engine::tests::phase33_loop_04_double_truncation_does_not_retry_again ... ok
test loop_engine::tests::phase33_loop_04_escalate_caps_at_provider_max ... ok
test loop_engine::tests::phase33_loop_04_escalate_doubles_under_cap ... ok
test loop_engine::tests::phase33_loop_04_escalate_returns_none_when_at_max ... ok
test loop_engine::tests::phase33_loop_04_escalation_caps_at_provider_max ... ok
test loop_engine::tests::phase33_loop_04_no_truncation_on_clean_finish ... ok
test loop_engine::tests::phase33_loop_04_one_shot_escalation_doubles_max_tokens ... ok
test loop_engine::tests::phase33_loop_04_smart_off_skips_escalation ... ok
test loop_engine::tests::phase33_loop_04_truncation_clean_punctuation_not_flagged ... ok
test loop_engine::tests::phase33_loop_04_truncation_detected_by_no_punctuation ... ok
test loop_engine::tests::phase33_loop_04_truncation_detected_by_stop_reason ... ok

test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 541 filtered out; finished in 0.01s
```

Full `cargo test --lib loop_engine::` passes 41/41 (no regressions in earlier-wave tests).

| Test | What it locks |
|------|---------------|
| `phase33_loop_04_truncation_detected_by_stop_reason` | All 5 supported providers + case-insensitive Gemini arm trigger detection. Regression guard if `is_truncated_stop_reason` arms drop. |
| `phase33_loop_04_truncation_detected_by_no_punctuation` | Punctuation-heuristic fallback fires when `stop_reason=None` (Ollama, some OpenRouter routes). Provider-agnostic. |
| `phase33_loop_04_one_shot_escalation_doubles_max_tokens` | `escalate_max_tokens(_, _, 4096) == Some(8192)` for anthropic + openai; `escalate_max_tokens("openai", "gpt-4o-mini", 8192) == Some(16384)`. |
| `phase33_loop_04_smart_off_skips_escalation` | The `if config.r#loop.smart_loop_enabled` gate short-circuits the entire LOOP-04 block when smart is off. v1.1-mistake regression guard. |
| `phase33_loop_04_escalation_caps_at_provider_max` | Doubled value is capped at `max_output_tokens_for` across all 10 (provider, model) cases. |
| `phase33_loop_04_double_truncation_does_not_retry_again` | After one escalation, `escalate_max_tokens(provider, model, cap)` returns None — structural guarantee that even an accidental re-entry can't double a second time. |
| `phase33_loop_04_detect_truncation_via_anthropic_max_tokens` | Anthropic-specific arm. |
| `phase33_loop_04_detect_truncation_via_openai_length` | OpenAI-specific arm. |
| `phase33_loop_04_detect_truncation_via_punctuation_heuristic` | Heuristic core path. |
| `phase33_loop_04_no_truncation_on_clean_finish` | `stop_reason=Some("end_turn")` + content ending in `.` → not truncated. |
| `phase33_loop_04_escalate_doubles_under_cap` | 4096 → Some(8192). |
| `phase33_loop_04_escalate_caps_at_provider_max` | 6000 → Some(8192) (capped). |
| `phase33_loop_04_escalate_returns_none_when_at_max` | At cap → None. |
| `phase33_loop_04_truncation_clean_punctuation_not_flagged` | All 7 sentence-final punctuation chars (`. ! ? : " ) `` ` ``) fail to trigger heuristic. |
| `phase33_loop_04_cost_guard_interlock_stub_under_cap` | Cost-projection arithmetic sign — future Plan 33-08 wiring can't accidentally invert the comparison. |
| `phase33_loop_04_cost_guard_interlock_stub_at_cap` | Saturated cumulative cost skips escalation. |

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| `grep -c "pub fn detect_truncation" loop_engine.rs` returns 1 | 1 |
| `grep -c "pub fn escalate_max_tokens" loop_engine.rs` returns 1 | 1 |
| `grep -c "fn is_truncated_stop_reason" loop_engine.rs` returns 1 | 1 |
| `grep -c '"kind":    "token_escalated"' loop_engine.rs` returns ≥ 1 | 1 |
| `grep -c "token_escalations" loop_engine.rs` returns ≥ 2 | 4 |
| `grep -c "max_output_tokens_for" loop_engine.rs` returns ≥ 1 | 4 |
| `grep -c "pub fn max_output_tokens_for" providers/mod.rs` returns 1 | 1 |
| `grep -c "stop_reason" providers/mod.rs` returns ≥ 1 | (pulse: AssistantTurn field + doc comments) |
| `grep -c "while.*detect_truncation" loop_engine.rs` returns 0 | 0 |
| `grep -c "AssertUnwindSafe" loop_engine.rs` returns ≥ 1 | 6 (LOOP-04 wrap + earlier closures) |
| `cargo check 2>&1 \| grep -c "error\["` returns 0 | 0 |
| All 16 phase33_loop_04 tests green | 16/16 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical robustness] Wrapped synchronous decision in `catch_unwind(AssertUnwindSafe(...))`**
- **Found during:** Task 2 wiring
- **Issue:** Plan PLAN.md Step C used a plain `if config.r#loop.smart_loop_enabled && detect_truncation(...) { ... }` block, but the executor brief (and CLAUDE.md §"Verification Protocol — read this before claiming anything is 'done'") require the smart-path to be panic-safe per the v1.1 lesson. A regression in `detect_truncation` (e.g. a future char-handling edit that panics on a malformed UTF-8 byte sequence) would otherwise take down chat.
- **Fix:** Wrapped the synchronous decision (detect → escalate → cost-project) in `std::panic::catch_unwind(std::panic::AssertUnwindSafe(closure))` mirroring the Phase 32-07 / Plan 33-04 pattern. The async retry call sits OUTSIDE the wrap with its own `Result`-based error handling. On panic: smart-path collapses to dumb-path (original truncated turn flows through), `log::warn!` to logs, no chat crash.
- **Files modified:** `src-tauri/src/loop_engine.rs` (run_loop truncation gate L753-870)
- **Commit:** `5150b17`

**2. [Rule 2 - Test coverage] Added 6 executor-brief-requested tests on top of PLAN.md's 8**
- **Found during:** Task 2 wiring
- **Issue:** PLAN.md Task 2 listed 8 unit tests; the executor brief listed 6 with slightly different names (`phase33_loop_04_truncation_detected_by_stop_reason` vs `phase33_loop_04_detect_truncation_via_anthropic_max_tokens`, `phase33_loop_04_one_shot_escalation_doubles_max_tokens` vs `phase33_loop_04_escalate_doubles_under_cap`, etc.). The brief's names cover the spec-level behaviors with broader case coverage (e.g. `phase33_loop_04_truncation_detected_by_stop_reason` exercises all 5 providers in one go vs PLAN.md's per-provider tests).
- **Fix:** Kept BOTH naming conventions — PLAN.md's 8 narrow tests + the brief's 6 broader tests + 2 cost-guard interlock stubs = 16 total. No test was removed; the broader tests are additive regression guards.
- **Files modified:** `src-tauri/src/loop_engine.rs` (tests module L1814-2128)
- **Commit:** `5150b17`

### Architectural Decisions (Not Deviations)

- Task 1 chose Option (b) (sibling fn `complete_turn_with_max_tokens`) over Option (a) (add `Option<u32>` param to `complete_turn`). PLAN.md explicitly delegated this choice to "execution time" — see decisions[0] above for rationale.
- Cost-guard projection uses a flat $0.00001/token estimate as the stub. PLAN.md's threat register T-33-22 calls out that this is a Plan 33-08 hand-off; the TODO marker is preserved verbatim inside the catch_unwind closure.

## Notes for Downstream Plans

### Plan 33-08 (cost guard) hand-off

The cost-guard interlock currently uses a flat $0.00001/token overestimate. Plan 33-08 should:

1. Replace the line `let _projected_cost: f32 = 0.0; // TODO: Plan 33-08 wires real cost projection` with a real per-provider price calculation: `(prompt_tokens + new_max_tokens) * (price_in + price_out) / 1_000_000`.
2. Wire `loop_state.cumulative_cost_usd` to populate after each `complete_turn` call (the field exists on LoopState already).
3. Subscribe ActivityStrip to the `blade_loop_event {kind: "token_escalated", new_max: N}` channel (the emit landed in this plan; the consumer is 33-08).
4. The token-bump chip should display `new_max` and link to the cost-guard reading from LoopState.

### Plan 33-09 UAT prompt

To force truncation in a UAT, use a long-output prompt with smart_loop_enabled=true:

```
"Write a 2000-word essay on the history of the Roman Empire. Do not summarize."
```

Expected behavior with `config.r#loop.smart_loop_enabled = true`:
- First turn returns ~700-1000 words with `stop_reason=Some("max_tokens")` (Anthropic) or `stop_reason=Some("length")` (OpenAI).
- ActivityStrip shows a "token bump" chip with `new_max=8192`.
- Second turn (the retry) returns the full 2000 words OR a still-long-but-now-clean-finish output.
- `loop_state.token_escalations == 1` for the run.

### Cross-plan link

This plan completes the LOOP-04 contract from CONTEXT lock §Max-Output-Token Escalation. It is consumed by:

- Plan 33-08 (LOOP-06 cost guard) — refines the cost-projection stub and wires the ActivityStrip subscriber for `token_escalated`.
- Plan 33-09 (UAT) — exercises the full LOOP-04 path end-to-end with the long-output UAT prompt above.

## Self-Check: PASSED

- `src-tauri/src/loop_engine.rs` exists with the LOOP-04 helpers + run_loop wiring + 16 unit tests
- `src-tauri/src/providers/mod.rs` exists with `max_output_tokens_for` + `complete_turn_with_max_tokens` + `AssistantTurn.stop_reason`
- Commit `5150b17` exists in `git log` (Task 2 wiring + tests)
- Commit `ffbf73e` exists in `git log` (Task 1 substrate, prior wave)
- Commit `f9430de` exists in `git log` (Task 1 recovery, prior wave)
- All 16 `phase33_loop_04*` tests green
- All 41 `loop_engine::tests::*` tests green (no regressions)
- `cargo check` returns 0 errors
