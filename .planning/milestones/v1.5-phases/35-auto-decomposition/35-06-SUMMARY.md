---
phase: 35-auto-decomposition
plan: 6
subsystem: agentic-loop / decomposition / sub-agent summary distillation
tags:
  - decomposition
  - DECOMP-03
  - summary
  - cheap-model
  - heuristic-fallback
  - catch_unwind
  - phase-35
dependency-graph:
  requires:
    - "Plan 35-01 — DecompositionConfig.subagent_summary_max_tokens (default 800)"
    - "Plan 35-02 — SubagentSummary struct + DECOMP_FORCE_DISTILL_PANIC seam (stub preserved verbatim)"
    - "Phase 34 SESS-02 — session::resume::load_session (Plan 34-09 filled body)"
    - "Phase 34 SESS-01 — SessionEvent enum (AssistantTurn + HaltReason + tokens_in/tokens_out)"
    - "Phase 32-04 — config::cheap_model_for_provider (compaction's cheap-model path; reused verbatim)"
    - "Phase 33-04 — providers::complete_simple one-shot helper"
    - "providers::price_per_million (Phase 34 cost-guard path; per-provider $/M token table)"
    - "agents::AgentRole.as_str() (Phase 35-02 already wired)"
    - "lib::safe_slice (non-ASCII safe truncation)"
  provides:
    - "distill_subagent_summary body — full implementation, no longer a stub"
    - "5 helper functions (distill_inner, serialize_messages_for_prompt, estimate_tokens_and_cost, indicates_failure, heuristic_fallback, last_assistant_turn_excerpt) → 6 helpers total"
    - "async catch_unwind boundary via futures::FutureExt — never propagates a panic"
    - "Heuristic 200-char fallback path for distillation failures (cheap-model error / parse error / panic / empty response)"
    - "Token + cost estimation by re-parsing AssistantTurn events from sub-agent JSONL"
  affects:
    - "src-tauri/src/decomposition/summary.rs (body filled; struct + seam preserved)"
tech-stack:
  added: []
  patterns:
    - "Phase 32-04 cheap-model dispatch (cheap_model_for_provider + complete_simple) reused verbatim for sub-agent summary distillation"
    - "Phase 34 catch_unwind discipline: AssertUnwindSafe(async block).catch_unwind().await — never propagate panics"
    - "Phase 32 CTX-07 fallback pattern (silent degrade on summary failure; never crash the parent chat)"
    - "Phase 34 SESS-02 ResumedConversation consumption (read .messages as Vec<serde_json::Value> with role/content keys)"
    - "Output safe_slice'd to subagent_summary_max_tokens × 4 chars (rough token→char ratio); input cap at × 8 chars (room for prompt overhead)"
key-files:
  created: []
  modified:
    - src-tauri/src/decomposition/summary.rs
decisions:
  - "ResumedConversation.messages is Vec<serde_json::Value>, not Vec<ConversationMessage>. The plan's example used the latter, which would not compile. Adapted serialize_messages_for_prompt to read role/content from JSON values (Phase 34 SESS-02's canonical {role, content, tool_name, tool_calls, is_error} shape). [Rule 1 — Bug: would not compile against live API.]"
  - "Empty cheap-model response is treated as a distillation failure (returns Err inside distill_inner, the outer catch_unwind converts to heuristic fallback). Some providers return empty strings on rate-limit edge cases; the heuristic is a safer default than a blank summary inserted into the parent's context. [Rule 2 — Auto-add: empty-response is a correctness gap the plan implied via the third test name.]"
  - "indicates_failure reads the JSONL HaltReason variant's reason field (String) — values matched against CostExceeded / Stuck / CircuitOpen / ProviderFatal / Cancelled. These mirror Phase 33 LoopHaltReason variants serialized by the SESS-01 writer. Absent halt or 'Done'/'DecompositionComplete' halts → success=true."
  - "8 tests written (vs. 6 in original prompt + 5 in plan acceptance criteria): added phase35_decomp_03_serialize_messages_handles_json_shape and phase35_decomp_03_serialize_messages_respects_cap because the JSON-value shape adapter is new code that didn't exist in Plan 35-02 stub. The empty-response path is exercised via a guard test (whitespace detection) — a full end-to-end empty-response test would require mocking the provider HTTP layer, deferred to integration tests in Plan 35-11."
  - "tokens_used + cost_usd derived by re-parsing AssistantTurn events from the JSONL on disk. ResumedConversation strips token counts during replay (it only emits {role, content} JSON), so the second pass over the same file is unavoidable for accurate cost rollup. Phase 35-07 may wire real-time counts via a different path; the v1 estimator is correct."
  - "step_index defaulted to 0 in the returned SubagentSummary — the caller (Plan 35-05 spawn_isolated_subagent / Plan 35-08 merge_fork_back) overwrites with the actual StepGroup index before injecting into the parent's conversation."
metrics:
  duration: ~38 minutes
  completed: 2026-05-06
---

# Phase 35 Plan 35-06: distill_subagent_summary body + cheap-model dispatch + heuristic fallback Summary

DECOMP-03 distillation closed: `distill_subagent_summary` now reads sub-agent JSONL via Phase 34 SESS-02's `load_session`, runs a cheap-model summary pass via `complete_simple` with the cheap model selected by `cheap_model_for_provider` (same Phase 32-04 path compaction uses), caps the output via `safe_slice` at `subagent_summary_max_tokens × 4` chars, and returns a `SubagentSummary` with `success` / `tokens_used` / `cost_usd` populated. On any panic OR distillation error (load_session fail, cheap-model fail, empty response), an `async catch_unwind` boundary falls through to a heuristic 200-char excerpt from the last `AssistantTurn` event in the sub-agent's JSONL — or the placeholder `[sub-agent halted before any assistant output]` when no assistant output exists. The distillation function never propagates a panic to the caller. 8 unit tests green; cargo check exits 0.

## What Shipped

### Task 1: distill_subagent_summary body filled

**File modified:** `src-tauri/src/decomposition/summary.rs`

**6 helper functions added below the public API:**

| Function | Signature | Role |
|---|---|---|
| `distill_inner` | `async fn(session_id: &str, role: AgentRole, config: &BladeConfig) -> Result<SubagentSummary, String>` | Real body. Triggers `DECOMP_FORCE_DISTILL_PANIC` seam, calls `load_session`, builds prompt, runs `complete_simple`, caps output, returns success/tokens/cost. |
| `serialize_messages_for_prompt` | `fn(&[serde_json::Value], usize) -> String` | Converts Phase 34 SESS-02's `Vec<serde_json::Value>` (`{role, content, tool_name?, ...}`) into role-prefixed lines, capped at `max_chars`. Handles user/assistant/system/tool roles. |
| `estimate_tokens_and_cost` | `fn(&Path, &str, &str, &str) -> (u32, f32)` | Re-parses sub-agent's JSONL for `AssistantTurn { tokens_in, tokens_out, .. }`, sums via `saturating_add`, multiplies by `providers::price_per_million(provider, model)` / 1M. |
| `indicates_failure` | `fn(&Path) -> bool` | Reads sub-agent's JSONL `HaltReason.reason`; returns true for `CostExceeded` \| `Stuck` \| `CircuitOpen` \| `ProviderFatal` \| `Cancelled`. |
| `heuristic_fallback` | `fn(&str, &str, &BladeConfig) -> SubagentSummary` | 200-char excerpt from last AssistantTurn or placeholder. `success=false`, `tokens=0`, `cost=0.0`. |
| `last_assistant_turn_excerpt` | `fn(&Path) -> Option<String>` | Re-parses JSONL for last `AssistantTurn.content`. |

**Public API (unchanged signature, body filled):**

```rust
pub async fn distill_subagent_summary(
    subagent_session_id: &str,
    role: AgentRole,
    config: &BladeConfig,
) -> Result<SubagentSummary, String>
```

**Body structure (catch_unwind ladder):**

```text
distill_subagent_summary
  └─ AssertUnwindSafe(async { distill_inner(...) }).catch_unwind().await
       ├─ Ok(Ok(summary))  → return Ok(summary)
       ├─ Ok(Err(e))       → log::warn; return Ok(heuristic_fallback)   ← cheap-model fail / empty response / load_session fail
       └─ Err(panic)       → log::warn; return Ok(heuristic_fallback)   ← DECOMP_FORCE_DISTILL_PANIC + any future panic regression
```

**Cheap-model integration (Phase 32-04 path reused):**

- Cheap model selected via `crate::config::cheap_model_for_provider(&config.provider, &config.model)` — same helper compaction uses (`config.rs:1650`). Anthropic → `claude-haiku-4-5-20251001`; OpenAI → `gpt-4o-mini`; Gemini → `gemini-2.0-flash`; Groq → `llama-3.1-8b-instant`; OpenRouter / Ollama → user's configured model.
- Cheap model invoked via `crate::providers::complete_simple(provider, api_key, cheap_model, prompt)` (`providers/mod.rs:467` — Phase 33 LOOP-01 verification probe path).
- Prompt format matches CONTEXT lock §DECOMP-03 verbatim:

```text
You are summarizing a sub-agent's work. The agent's role was {role}. Below is the agent's full conversation. Produce ONE paragraph (≤ {max_tokens} tokens) that captures: (1) the outcome — did the agent succeed or fail; (2) key facts found / files touched / decisions made; (3) any next-step recommendations for the parent agent. Do NOT include filler or preamble.

{conversation_text}
```

- `conversation_text` capped at `subagent_summary_max_tokens × 8` chars (default 800 × 8 = 6,400 — leaves room for prompt overhead in cheap-model 8k+ context windows).
- Output capped at `subagent_summary_max_tokens × 4` chars via `safe_slice` (default 800 × 4 = 3,200 — legitimate paragraph summaries fit; 100KB-of-garbage T-35-22 attacks get clipped).

**async catch_unwind discipline:** `futures::FutureExt` already in Cargo.toml (37: `futures = "0.3"`). The `AssertUnwindSafe(async { ... }).catch_unwind().await` pattern matches Plan 35-05 executor.rs's posture (the parallel-wave plan we deliberately don't touch).

**DECOMP_FORCE_DISTILL_PANIC seam preserved verbatim** from Plan 35-02 stub — declaration at module level, check inside `distill_inner` (so the catch_unwind wrapper catches it). No production overhead (`#[cfg(test)]` only).

### Tests (8 green)

| Test | What it guards |
|---|---|
| `phase35_subagent_summary_serde_roundtrip` | SubagentSummary IPC shape stable across serde |
| `phase35_decomp_force_distill_panic_seam_declared` | Seam compiles and round-trips a bool |
| `phase35_decomp_03_missing_jsonl_uses_heuristic_fallback` | load_session error → catch_unwind → heuristic; `success=false`, non-empty text, tokens=0, cost=0.0 |
| `phase35_decomp_03_force_panic_falls_back_to_heuristic` | DECOMP_FORCE_DISTILL_PANIC=true → catch_unwind catches → heuristic. **T-35-21 mitigation guard** (catch_unwind regression alarm). |
| `phase35_decomp_03_safe_slice_caps_at_max_tokens_x4` | Default 800 → 3,200 char cap; safe_slice math correct for 50-token cap |
| `phase35_decomp_03_serialize_messages_handles_json_shape` | Phase 34 SESS-02 JSON shape parsed correctly (user/assistant/tool roles) |
| `phase35_decomp_03_serialize_messages_respects_cap` | max_chars cap excludes oversized messages |
| `phase35_decomp_03_distill_falls_back_on_empty_response_simulated` | Whitespace-detection guard for the empty-response → Err → heuristic path |

```bash
cd /home/arnav/blade/src-tauri && cargo test --lib decomposition::summary::tests
# 8 passed; 0 failed; 0 ignored
```

### Acceptance grep gates (all green)

```bash
$ grep -c "fn distill_inner\|fn serialize_messages_for_prompt\|fn estimate_tokens_and_cost\|fn indicates_failure\|fn heuristic_fallback\|fn last_assistant_turn_excerpt" src/decomposition/summary.rs
6                              # target 6 ✓
$ grep -c "DECOMP_FORCE_DISTILL_PANIC" src/decomposition/summary.rs
9                              # target ≥3 ✓
$ grep -c "load_session\|cheap_model_for_provider\|complete_simple" src/decomposition/summary.rs
10                             # target ≥3 ✓
$ grep -c "safe_slice" src/decomposition/summary.rs
7                              # target ≥2 ✓
$ grep -c "catch_unwind" src/decomposition/summary.rs
10                             # target ≥1 ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] ResumedConversation.messages is `Vec<serde_json::Value>`, not `Vec<ConversationMessage>`**

- **Found during:** Task 1 implementation (cargo check would have failed if I'd typed the plan's example verbatim).
- **Issue:** Plan's example `serialize_messages_for_prompt` accepts `&[crate::providers::ConversationMessage]` and pattern-matches on `ConversationMessage::User(t)` / `Assistant(t)` / `System(t)` variants. The live `session::resume::load_session` (Phase 34 Plan 34-09 filled body) returns `ResumedConversation { messages: Vec<serde_json::Value>, .. }` because `ConversationMessage` does not derive `Serialize`/`Deserialize` and cannot cross the Tauri IPC boundary. Verified at `src/session/resume.rs:32`.
- **Fix:** Rewrote `serialize_messages_for_prompt` to accept `&[serde_json::Value]`, read `role` and `content` keys (Phase 34 SESS-02's canonical shape), branch on user/assistant/system/tool. Tool messages additionally surface the `tool_name` key. Mirrors the message shape emitted by `load_session` at lines 95–139 of `resume.rs`.
- **Files modified:** `src-tauri/src/decomposition/summary.rs`
- **Commit:** `c66e8ea`

**2. [Rule 2 — Auto-add] Empty cheap-model response → distillation error → heuristic fallback**

- **Found during:** Task 1 implementation (the prompt named a test `phase35_decomp_03_distill_falls_back_on_empty_response`, but Plan 35-06's behavior block didn't define it).
- **Issue:** Some providers (Groq rate-limit, OpenRouter free-tier degraded mode) occasionally return empty strings instead of erroring. Without a guard, the cheap-model branch would silently inject an empty paragraph into the parent's conversation. This violates the "never inject blank summary" intent of the heuristic fallback.
- **Fix:** After `complete_simple` returns Ok, check `response.trim().is_empty()`. If empty, return `Err("cheap-model returned empty response")` from `distill_inner` — the outer `catch_unwind` ladder converts this to the same heuristic fallback path used for cheap-model failures.
- **Files modified:** `src-tauri/src/decomposition/summary.rs`
- **Commit:** `c66e8ea`

### Auth gates encountered

None — this plan is fully offline (no provider calls during tests).

### Architectural decisions deferred

None.

## Threat Surface

T-35-21 (Tampering — catch_unwind regression) mitigation verified: `phase35_decomp_03_force_panic_falls_back_to_heuristic` would fail loudly if a future commit removed the `AssertUnwindSafe(...).catch_unwind().await` wrapper. T-35-22 (DoS — 100KB cheap-model response) mitigation verified: `safe_slice` cap at `subagent_summary_max_tokens × 4` clips garbage; default 3,200 chars accommodates legitimate summaries.

## Hand-off to Wave 4

- **Plan 35-05** (parallel — executor.rs) calls into `distill_subagent_summary` from `spawn_isolated_subagent` after the sub-agent halts. Plan 35-05 owns step_index assignment.
- **Plan 35-07** (next-wave — run_subagent_to_halt real wiring) replaces the executor.rs stub call with a full sub-agent dispatch loop; the distillation API surface here is stable.
- **Plan 35-08** (merge_fork_back) also calls `distill_subagent_summary` for parent-conversation re-injection; the SubagentSummary shape (success/tokens/cost/summary_text) is the contract Plan 35-08 consumes.
- **Plan 35-11** closes the phase with end-to-end UAT including a real cheap-model dispatch — the empty-response path will get exercised via integration there.

## Self-Check: PASSED

- `src-tauri/src/decomposition/summary.rs` exists and compiles ✓ (cargo check exit 0, 3m 48s; cargo test --lib exit 0, 8 tests green)
- Commit `c66e8ea` present in git log ✓
- 6 helper functions declared (grep count 6 = target 6) ✓
- DECOMP_FORCE_DISTILL_PANIC seam preserved verbatim from Plan 35-02 ✓
- No accidental file deletions (`git diff --diff-filter=D HEAD~1 HEAD` empty) ✓
- 188 pre-existing unstaged deletions in `.planning/phases/00..` left untouched (per execution constraint) ✓
