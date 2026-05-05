---
phase: 33
slug: agentic-loop
date: 2026-05-05
status: ready-for-planning
researcher: gsd-phase-researcher (inline)
confidence: HIGH
sources:
  primary:
    - mini_swe_agent: https://github.com/SWE-agent/mini-swe-agent (verifier + plan-adaptation pattern)
    - claude_code_arxiv: https://arxiv.org/abs/2604.14228 (agent loop primitives, structured tool errors)
    - openhands_replanner: https://docs.openhands.dev/sdk/agents/replanning (mid-loop verifier prompt structure)
    - aider_auto_retry: https://aider.chat/docs/troubleshooting/edit-errors.html (truncation retry pattern)
    - anthropic_max_tokens: https://docs.anthropic.com/en/docs/about-claude/models (Claude Sonnet 4 max_output: 8192 default, 64000 with extended-output beta header)
    - openai_finish_reason: https://platform.openai.com/docs/api-reference/chat/object#chat/object-choices (finish_reason: "length")
  code:
    - src-tauri/src/commands.rs (3310 lines; tool loop at 1621, fast-path at 1441-1577, brain_planner::reject_plan at 1684, model_context_window helper at 164)
    - src-tauri/src/brain.rs (build_system_prompt_inner at 714; ContextBreakdown + Phase 32-03 always-keep core; CTX-07 panic-injection regression at 2784-2880)
    - src-tauri/src/brain_planner.rs (reject_plan at 284, confirm_plan at 270, hash_request)
    - src-tauri/src/config.rs (ContextConfig at 263; cheap_model_for_provider at 1237; six-place pattern documented at 254)
    - src-tauri/src/providers/mod.rs (ConversationMessage enum at 141 — has System variant; complete_turn, stream_text, fallback_chain_complete_with_override; provider price tables for trace logging)
    - src-tauri/src/providers/anthropic.rs (max_tokens 4096/8192 at lines 26, 192, 271)
    - src-tauri/src/providers/openai.rs (max_tokens 4096 at lines 43, 228)
    - src-tauri/src/native_tools.rs (37+ tool definitions; entry point for wrap_legacy_error shim)
    - src-tauri/src/capability_probe.rs (PROVIDER_CAPABILITIES; context_window field used by Phase 32 trigger)
    - src/features/activity-log/ActivityStrip.tsx (50 lines; thin strip; uses useActivityLog hook)
    - src/lib/events/payloads.ts (typed event payload interfaces; BladeStatusPayload at 37, BladeNotificationPayload at 45)
inputs:
  - .planning/phases/33-agentic-loop/33-CONTEXT.md (LOCKED — 10 implementation decisions across LOOP-01..06)
  - .planning/REQUIREMENTS.md (LOOP-01..06 verbatim, lines 22-27)
  - .planning/ROADMAP.md (lines 108-120 — Phase 33 row + 6 success criteria)
  - .planning/STATE.md (v1.5 milestone state)
  - .planning/phases/32-context-management/32-CONTEXT.md (gold-standard CONTEXT structure)
  - .planning/phases/32-context-management/32-RESEARCH.md (gold-standard RESEARCH structure)
  - .planning/phases/32-context-management/32-07-PLAN.md (CTX-07 fallback discipline pattern; catch_unwind wrappers + panic-injection regression test)
  - CLAUDE.md (six-place rule, safe_slice, Tauri command namespace, verification protocol, what-not-to-do list)
---

# Phase 33: Agentic Loop — Research

**Audience:** the planner. The 33-CONTEXT.md document locks 10 implementation decisions; this doc supplies HOW (concrete code anchors, citation-backed patterns, validation surfaces, landmines) — not WHAT.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOOP-01 | Mid-loop verification every 3 tool calls | §Findings/LOOP-01 — cheap_model_for_provider already exists (config.rs:1237); verification prompt is hardcoded per CONTEXT lock; verdict parsing is single-word case-insensitive |
| LOOP-02 | Structured tool error feedback | §Findings/LOOP-02 — new ToolError struct in loop_engine.rs; `wrap_legacy_error` shim in native_tools.rs; ~10-entry static enrich_alternatives map |
| LOOP-03 | Plan adaptation on failure | §Findings/LOOP-03 — `brain_planner::reject_plan` (brain_planner.rs:284) already wired at commands.rs:1684; LoopState.consecutive_same_tool_failures HashMap drives the 3-failure trigger |
| LOOP-04 | Max-output-token escalation on truncation | §Findings/LOOP-04 — detect via stop_reason=="length" + sentence-final-punctuation heuristic; cap at 8192 (Anthropic default) / 64000 (with header) / OpenAI provider tables; one escalation per turn |
| LOOP-05 | Ego intercept on fast path | §Findings/LOOP-05 — Phase 18 KNOWN GAP at commands.rs:1441-1451; `brain::build_fast_path_supplement` is a thin wrapper around `build_system_prompt_inner`'s always-keep core (Phase 32-03 codified) |
| LOOP-06 | Iteration cap (default 25) + cost guard | §Findings/LOOP-06 — replace literal `0..12` at commands.rs:1621 with `0..config.r#loop.max_iterations`; cost guard reuses provider price tables from trace logging; halt with structured `LoopHaltReason::CostExceeded` |

---

## Project Constraints (from CLAUDE.md)

These are LOAD-BEARING. The planner MUST verify task plans honor each:

1. **Six-place config rule** — every new `BladeConfig` field needs ALL 6 sites updated: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`. The new `LoopConfig` has 4 fields × 6 places each — Phase 32-01 review found two missed spots and they had to be patched separately. Don't try to remember from memory; **copy the diff Phase 32-01 used for `ContextConfig` and adapt every line**.
2. **`safe_slice` mandatory** — never use `&text[..n]` on user/conversation/tool content. Defined at `lib.rs`. LOOP-01's verification prompt construction is the obvious risk site (`goal` truncated to 1500 chars, `actions` summaries truncated to 300 chars).
3. **Don't run `cargo check` after every edit** — batch edits, check at end. Each `cargo check` is 1-2 min.
4. **Tauri command name uniqueness** — the `#[tauri::command]` macro namespace is FLAT across all modules. Phase 33 adds NO new Tauri commands (CONTEXT lock) — events emit through `app.emit`. This collision risk is zero, but `mod loop_engine;` registration in `lib.rs` is required.
5. **`use tauri::Manager;`** required when calling `app.state()` or `app.emit()` — easy to miss, gives a cryptic compile error. The new `loop_engine::run_loop` will need it.
6. **No Co-Authored-By in commits.**
7. **Verification Protocol (v1.1 lesson)** — static gates (cargo check / tsc) are NOT sufficient. Must run dev server, screenshot affected surface, exercise round-trip, read screenshot back, check 1280×800 + 1100×700. Phase 33 adds ActivityStrip chips → UAT is mandatory and the final plan MUST end on `checkpoint:human-verify`.
8. **Streaming contract** — every Rust streaming branch must emit `blade_message_start` before `chat_token`. The fast path already emits this at commands.rs:1463 (the v1.1 retraction was caused by this exact omission). LOOP-05's supplement injection happens BEFORE the streaming call — no risk to message_start ordering.
9. **Don't migrate all 37+ native tools to `Result<T, ToolError>`** in this phase — the shim makes that incremental. CONTEXT lock; planner must enforce.
10. **Rust keyword `loop`** — use raw identifier `r#loop` for the field name in struct definitions and access sites. CONTEXT lock; trivial to typo.

---

## Executive Summary

1. **The 12-iteration loop refactor is mostly mechanical.** `commands.rs:1621` is a single `for iteration in 0..12 { ... }` with ~200 inline lines (tool execution, error recovery, brain_planner reject_plan, message extraction). Lift that body into `loop_engine::run_loop(...)` taking `&mut conversation`, `&mut config`, `&tools`, `&app`, `&last_user_text`. The OUTER `send_message_stream_inline` keeps fast-path branch + post-loop cleanup. Phase 32 left commands.rs and brain.rs monolithic — this phase keeps that posture and adds **one** new monolithic module: `src-tauri/src/loop_engine.rs`. CONTEXT lock §Module Boundaries.

2. **LOOP-01 verification is a sub-100-line helper.** `verify_progress(provider, model, goal, last_3_actions) -> Verdict` builds the hardcoded prompt (CONTEXT lock §Mid-Loop Verification), calls `providers::complete_simple` (or whichever providers fn returns plain text without tool wiring) using `cheap_model_for_provider(provider, model)`. Parse the first word case-insensitively. Wrap the whole call in `catch_unwind` per CTX-07 fallback discipline — a panic in the verification probe MUST NOT halt the main loop (CONTEXT lock).

3. **LOOP-02 is two structs and a shim, not a migration.** `ToolError { attempted, failure_reason, suggested_alternatives }` lives in `loop_engine.rs`. `native_tools::wrap_legacy_error(tool_name, err) -> ToolError` produces an empty-alternatives shim. `loop_engine::enrich_alternatives(tool_name) -> Vec<String>` is a small static `match` with ~10 entries (`read_file → ["check the path", "use bash 'ls -la <dir>'"]`, `bash → ["check shell syntax", "verify command exists"]`, `web_search → ["try a different query", "narrow the time window"]`, etc.). No tool signatures change.

4. **LOOP-03 has zero new prompts.** When a `ToolError` is the third consecutive failure of the same tool (CONTEXT lock — same name, not same input), call `brain_planner::reject_plan(&last_user_text)` (already at brain_planner.rs:284) and inject the existing "Internal check: re-plan from current state. Do not retry the failing step verbatim." nudge as a system message in the conversation. The model handles re-planning via prompt context — there is NO standalone planner subroutine.

5. **LOOP-04 is detect-then-retry, single shot.** Truncation detection has two signals (CONTEXT lock §LOOP-04): `stop_reason == "length"` (Anthropic) / `finish_reason == "length"` (OpenAI-compatible) OR last completed text chunk doesn't end with sentence-final punctuation (`.!?:")` or code-fence end). On detection, retry the SAME turn with `max_tokens × 2` capped at provider max (Anthropic 8192 default; 64000 only with `anthropic-beta: output-128k-2025-02-19` header — Phase 33 sticks to 8192 default to avoid header juggling; OpenAI's `max_tokens` cap is per-model, look up in the provider metadata used by trace logging). One escalation per turn. Cost-guard-respecting (CONTEXT lock).

6. **LOOP-05 closes a documented gap.** Comment at `commands.rs:1442-1451` literally says "Phase 18 — KNOWN GAP (Pitfall 3 / Plan 18-10): the fast-streaming branch emits tokens directly via providers::stream_text without server-side accumulation. ego::intercept_assistant_output requires the FULL transcript and runs in the tool-loop branch only." Phase 33 closes it via `brain::build_fast_path_supplement(config, last_user_text) -> String` — a thin wrapper that calls `build_system_prompt_inner` with a flag returning ONLY the always-keep core (Phase 32-03 codified). Inject as `ConversationMessage::System(...)` (variant exists; providers/mod.rs:141, 174) before the streaming call. Optional: invoke `ego::intercept_assistant_output` at fast-path stream completion in `chat_done` handler — CONTEXT lock allows discretion on this; recommend yes for parity.

7. **LOOP-06 cost guard is one running f32 + one comparison.** The provider price tables already exist (used by trace logging — `trace::TraceSpan` records token counts per call). `LoopState.cumulative_cost_usd: f32` accumulates `(tokens_in × price_in + tokens_out × price_out) / 1_000_000` per turn. Compare against `config.r#loop.cost_guard_dollars` at the top of each iteration; on exceed, return `Err(LoopHaltReason::CostExceeded { spent_usd, cap_usd })`. Iteration cap is the trivial `for iteration in 0..config.r#loop.max_iterations` swap.

8. **CTX-07 fallback discipline applies to every smart-loop branch.** Phase 32-07 landed `catch_unwind` wrappers around the smart-path call sites with a panic-injection regression test (commit bb5d6ce). Phase 33 inherits this pattern — every new helper that runs only when `loop.smart_loop_enabled = true` MUST be wrapped at the call site such that a panic gracefully degrades to legacy 12-iteration behavior. Plan 33-09 (the final plan) ports this exact pattern to the loop engine.

9. **LOOP_OVERRIDE test seam is mandatory.** Phase 32 introduced `CTX_SCORE_OVERRIDE` (env var that bypasses real scoring during tests). LOOP-01's verification probe needs the same: `LOOP_OVERRIDE=YES|NO|REPLAN` short-circuits the cheap-model call and returns the verdict directly. CONTEXT lock §Testing & Verification. Without the seam, unit tests can't deterministically exercise verdict branches.

10. **Smart-loop-disabled regression test is mandatory.** A unit test sets `loop.smart_loop_enabled = false` and asserts the loop runs exactly 12 iterations max with no verification/escalation/cost-guard side effects. Mirrors Phase 32-01's `ContextConfig` round-trip test pattern. Without this, "behavioral parity with legacy" is unverified — and v1.1's lesson is that unverified parity claims become retracted milestones.

---

## Existing Code (anchors the planner cites by file:line)

### `src-tauri/src/commands.rs` — what gets refactored

**Tool loop body (the thing this phase replaces):**
- L1619-L1822: `let mut last_tool_signature = String::new(); let mut repeat_count = 0u8; for iteration in 0..12 { ... }` — the entire iteration body (turn execution, error recovery via `classify_api_error`, `TruncateAndRetry`, `SwitchModelAndRetry`, `RateLimitRetry`, `OverloadedRetry`, `Fatal` branches, `brain_planner::reject_plan` call at L1684, conversation push at L1823).
- L1828-L1899: post-loop content assembly (ego intercept at L1848, action_tags extract at L1864, chat_token streaming at L1884-1893, chat_done at L1899). This stays in commands.rs.

**Fast-path branch (Phase 18 KNOWN GAP, LOOP-05 target):**
- L1441-L1577: the `if tools.is_empty() || (only_native_tools && is_conversational && is_short_conversation)` branch.
- L1442-L1451: the comment that documents the gap verbatim.
- L1463: existing `emit_stream_event(&app, "blade_message_start", ...)` — Phase 3 WIRE-03 contract; LOOP-05 must NOT regress this.
- L1467: `std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id)` — env handoff for `blade_thinking_chunk` tagging in anthropic.rs; LOOP-05 must preserve this.
- L1488: `providers::fallback_chain_complete_with_override(...)` — the streaming call site. LOOP-05 injects supplement BEFORE this call.

**Phase 32 anchors (LOOP-06 cost-guard reuses):**
- L164: `pub fn model_context_window(provider, model) -> u32` — falls back to 8192 for unknown pairs.
- L1581-L1617: proactive compaction block — already honors `config.context.smart_injection_enabled` toggle. LOOP-06 mirrors this exact toggle pattern for `config.r#loop.smart_loop_enabled`.

**Truncate-and-retry (LOOP-04 reference but NOT what LOOP-04 is):**
- L1648-L1688: `ErrorRecovery::TruncateAndRetry` is the CONTEXT-OVERFLOW retry (compress + retry), not the OUTPUT-TRUNCATION retry. LOOP-04 is a distinct, additional retry path triggered by `stop_reason == "length"`, fired AFTER `complete_turn` returns Ok but before pushing to conversation.

### `src-tauri/src/brain_planner.rs` — already wired

- L284: `pub fn reject_plan(request: &str)` — already called from commands.rs:1684 in the truncate-retry-failed branch. LOOP-03 wires it into the new third-consecutive-same-tool-failure trigger inside loop_engine.

### `src-tauri/src/brain.rs` — LOOP-05 supplement source

- L714: `fn build_system_prompt_inner(...)` — the central prompt assembler. Phase 32-03 codified the "always-keep core" (identity tone + persona + current date + active tool list — small core unconditional even when smart_injection is on). LOOP-05's `build_fast_path_supplement` is a thin wrapper that invokes this with a flag returning ONLY that core.
- L2784-L2880: CTX-07 panic-injection regression test pattern — fixture override that forces `score_context_relevance` to panic and asserts `build_system_prompt_inner` still produces non-empty output. LOOP-09 mirrors this exact shape for the verification probe.

### `src-tauri/src/config.rs` — ContextConfig is the gold standard

- L240-L298: ContextConfig declaration block + `default_*` helpers + `impl Default`. **Copy this block verbatim and adapt for LoopConfig.** Don't redesign — the pattern is locked and review-tested.
- L426: `context: ContextConfig` field in DiskConfig.
- L507: `context: ContextConfig::default()` in DiskConfig::default.
- L654: `pub context: ContextConfig` field in BladeConfig.
- L721: `context: ContextConfig::default()` in BladeConfig::default.
- L1237: `pub fn cheap_model_for_provider(provider: &str, user_model: &str) -> String` — LOOP-01 reuses this verbatim.
- L1556-L1627: ContextConfig test block (`phase32_context_config_default_values`, `phase32_context_config_round_trip`, `phase32_context_config_missing_in_disk_uses_defaults`). LoopConfig tests mirror this naming and structure.

### `src-tauri/src/providers/mod.rs` — provider plumbing

- L141: `pub enum ConversationMessage` — has `System(String)`, `User(String)`, `UserWithImage`, `Assistant { content, tool_calls }`, `Tool { tool_name, content, is_error }` variants. LOOP-05 supplement injects `ConversationMessage::System(supplement)`. LOOP-03 nudge injects same.
- L351: `ConversationMessage::System(system.to_string()), ConversationMessage::User(message.to_string())` — pattern for building a minimal verification probe call.
- L633, L689: existing `cheap_model_for_provider` call sites (in fallback chains) — confirms the helper is already battle-tested.

### `src-tauri/src/native_tools.rs` — shim entry point

- The 37+ tool dispatch table lives here. Plan 33-02 adds `pub fn wrap_legacy_error(tool_name: &str, err: String) -> ToolError` as the boundary helper. NO existing tool signature changes in this phase.

### `src-tauri/src/lib.rs` — module registration

- `mod` registrations cluster (search for `mod commands;`). Add `mod loop_engine;` near the alphabetical neighbors.
- `generate_handler!` macro — Phase 33 adds NO Tauri commands; this list is unchanged.

### Frontend anchors

- `src/features/activity-log/ActivityStrip.tsx` (50 lines) — thin strip; uses `useActivityLog` hook; clicking opens drawer. Plan 33-08 extends the `useActivityLog` source (or its sibling, depending on hook architecture) to listen for `blade_loop_event` and push to the log. The ActivityStrip itself doesn't need redesign — it auto-renders the latest log entry.
- `src/lib/events/payloads.ts` (forward-declared interfaces; `BladeStatusPayload`, `BladeNotificationPayload`) — Plan 33-08 adds `BladeLoopEventPayload` discriminated union over `kind`.
- `src/lib/tauri/index.ts:122` — events convenience re-export anchor; if the project uses a typed `listen<T>(event)` wrapper there, it's where the new event subscribes from.

---

## External Research

### mini-SWE-agent — verifier + plan-adaptation

The agent loop wraps each step in a "verifier" call: after N actions, the verifier inspects (goal, observations) and emits one of `{progress, stuck, replan}`. Phase 33's LOOP-01 mirrors this shape exactly — fixed prompt, three-verdict parse, every-N cadence. The mini-SWE-agent verifier prompt is broadly similar to the CONTEXT-locked prompt: `"Given the original goal {G} and the last K actions {A}, is the loop progressing? Reply with one word: YES, NO, or REPLAN, followed by a brief reason."`

The lesson from mini-SWE-agent's design: **the verifier should be cheap** (small model) and **non-blocking** (a verifier failure must not halt the main loop). Both are CONTEXT-locked for Phase 33 (cheap_model_for_provider; catch_unwind around the verification call).

### Claude Code (arxiv 2604.14228) — structured tool errors

Claude Code's tool layer represents failures as structured objects (not bare strings) so the model can reason about retries: `{tool, error_kind, suggestion}`. Phase 33's `ToolError` mirrors this shape (CONTEXT lock §LOOP-02). The arxiv paper notes the model's retry behavior improves measurably when the failure object includes `suggested_alternatives` even when those suggestions are trivial — the model treats them as hints rather than as ground truth, but they meaningfully steer the next tool selection.

The lesson: ship the alternatives field even with shallow content. Phase 33 ships ~10 enrich_alternatives entries; the type can carry richer suggestions later.

### OpenHands replanner

OpenHands' "replanner" pattern: when a plan step fails, the agent injects a synthetic system message that rejects the current plan and demands a fresh approach from the current state. NO standalone planner runs. Phase 33's LOOP-03 mirrors this exactly — the model drives re-planning via prompt context. CONTEXT lock §LOOP-03 is explicit: "NO automated planner that runs without the model in the loop. The 're-plan' is always model-driven via prompt context."

### Aider auto-retry on truncation

Aider's edit format detects truncation by checking if the final code-fence is closed; on detected truncation, it re-issues the request with a higher token budget. Phase 33's LOOP-04 generalises this: stop_reason == "length" is the strong signal; the punctuation-end heuristic is the weak signal for providers that don't surface stop_reason cleanly. Both gate one retry per turn (CONTEXT lock).

### Anthropic / OpenAI max_tokens registry

- **Anthropic:** Claude Sonnet 4 default `max_tokens` ceiling is 8192 in the standard API; the extended-output beta header (`anthropic-beta: output-128k-2025-02-19`) raises it to 64000. The current code at `providers/anthropic.rs:26, 192` hardcodes `4096`, and at L271 builds `max_tokens = (budget_tokens + 4096).max(8192)` for thinking mode. LOOP-04 plumbs a doubled value through the existing call sites; the cap stays at 8192 (no header juggling for Phase 33).
- **OpenAI:** `max_tokens` is per-model (gpt-4o = 16384, gpt-4o-mini = 16384, gpt-3.5 = 4096). The current code at `providers/openai.rs:43, 228` hardcodes `4096`. LOOP-04 reads the existing provider metadata used by trace logging to determine the cap.
- **The simpler approach for Phase 33:** carry a `max_output_tokens` knob on the request struct passed to `complete_turn` (or thread an explicit `Option<u32>` parameter), default-derived from the provider's per-model table. LOOP-04 sets it to `original × 2` capped at the table value. **Do not invent a new max-tokens registry** — reuse the metadata already used by trace logging.

### Provider price tables for cost guard

Per CONTEXT lock §LOOP-06: "Provider price tables already exist (used by trace logging); reuse those — do not duplicate." `trace::TraceSpan` records token counts per call (commands.rs:1470, 1499, 1630, 1644). The price table lookup is `(provider, model) -> (price_in_per_1m, price_out_per_1m)`. Phase 33's `LoopState.cumulative_cost_usd: f32` is `prev_cost + (tokens_in × price_in + tokens_out × price_out) / 1_000_000` per turn. Round-half-even on the arithmetic is fine; CONTEXT lock §LOOP-06 leaves rounding to Claude's discretion.

---

## Implementation Sketches

### LoopConfig (Plan 33-01)

```rust
// src-tauri/src/config.rs — adjacent to ContextConfig (around L300)

/// Phase 33 Agentic Loop — runtime knobs for mid-loop verification, plan
/// adaptation, max-token escalation, fast-path ego intercept, iteration cap,
/// and cost guard. Default values match the LOOP-01..06 locked decisions in
/// 33-CONTEXT.md.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LoopConfig {
    /// CTX-07-style escape hatch. true = smart loop enabled (verification,
    /// plan adaptation, token escalation, cost guard, fast-path supplement).
    /// false = legacy 12-iteration blind loop with no smart features.
    #[serde(default = "default_smart_loop_enabled")]
    pub smart_loop_enabled: bool,
    /// Hard cap on tool-loop iterations. Default 25 (was hardcoded 12).
    /// When smart_loop_enabled=false, the loop reverts to literal 12.
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Per-conversation cumulative spend cap in USD. When exceeded, the loop
    /// halts with LoopHaltReason::CostExceeded. Default 5.0.
    #[serde(default = "default_cost_guard_dollars")]
    pub cost_guard_dollars: f32,
    /// Verification probe cadence — fires every N iterations. Default 3.
    #[serde(default = "default_verification_every_n")]
    pub verification_every_n: u32,
}

fn default_smart_loop_enabled() -> bool { true }
fn default_max_iterations() -> u32 { 25 }
fn default_cost_guard_dollars() -> f32 { 5.0 }
fn default_verification_every_n() -> u32 { 3 }

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            smart_loop_enabled: default_smart_loop_enabled(),
            max_iterations: default_max_iterations(),
            cost_guard_dollars: default_cost_guard_dollars(),
            verification_every_n: default_verification_every_n(),
        }
    }
}

// Six-place wire-up: same diff Phase 32-01 used for `context: ContextConfig`,
// substituting `r#loop: LoopConfig` (raw identifier — `loop` is a Rust keyword).
//
//   1. DiskConfig field:        #[serde(default)] r#loop: LoopConfig,
//   2. DiskConfig::default:     r#loop: LoopConfig::default(),
//   3. BladeConfig field:       #[serde(default)] pub r#loop: LoopConfig,
//   4. BladeConfig::default:    r#loop: LoopConfig::default(),
//   5. load_config:             r#loop: disk.r#loop,
//   6. save_config:             r#loop: config.r#loop.clone(),
```

### LoopState + LoopHaltReason + ToolError (Plan 33-02)

```rust
// src-tauri/src/loop_engine.rs (NEW MODULE)

use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, Default)]
pub struct LoopState {
    pub iteration: u32,
    pub cumulative_cost_usd: f32,
    pub replans_this_run: u32,
    pub token_escalations: u32,
    /// Ring buffer for LOOP-01 verification probe context.
    pub last_3_actions: VecDeque<ActionRecord>,
    /// LOOP-03 trigger — third consecutive failure of the same tool name.
    pub consecutive_same_tool_failures: HashMap<String, u32>,
}

#[derive(Debug, Clone)]
pub struct ActionRecord {
    pub tool: String,
    pub input_summary: String,   // safe_slice'd to 300 chars
    pub output_summary: String,  // safe_slice'd to 300 chars
    pub is_error: bool,
}

#[derive(Debug, Clone)]
pub enum LoopHaltReason {
    CostExceeded { spent_usd: f32, cap_usd: f32 },
    IterationCap,
    Cancelled,
    ProviderFatal { error: String },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolError {
    pub attempted: String,
    pub failure_reason: String,
    pub suggested_alternatives: Vec<String>,
}

impl ToolError {
    /// Renders as a tool-result message for injection into the conversation.
    /// If suggested_alternatives is empty (legacy shim), the "Suggested
    /// alternatives" block is omitted entirely (no empty bullets).
    pub fn render_for_model(&self) -> String {
        let mut out = format!(
            "Tool failed.\nAttempted: {}\nReason: {}",
            self.attempted, self.failure_reason
        );
        if !self.suggested_alternatives.is_empty() {
            out.push_str("\nSuggested alternatives:");
            for alt in &self.suggested_alternatives {
                out.push_str(&format!("\n  - {}", alt));
            }
        }
        out
    }
}

/// Static map of tool name → likely alternatives. ~10 entries covering the
/// most common tool failures. Phase 33 ships an MVP set; comprehensive
/// coverage is incremental follow-up work (CONTEXT lock §LOOP-02).
pub fn enrich_alternatives(tool_name: &str) -> Vec<String> {
    match tool_name {
        "read_file" => vec![
            "Verify the path exists with `ls -la <dir>`".to_string(),
            "Check for typos in the file name".to_string(),
        ],
        "bash" => vec![
            "Verify the command exists in PATH".to_string(),
            "Check for unmatched quotes or shell metacharacters".to_string(),
        ],
        "web_search" => vec![
            "Try a narrower or broader query".to_string(),
            "Specify a time window with `after:<date>`".to_string(),
        ],
        // ... ~7 more entries covering write_file, list_dir, grep,
        //     fetch_url, run_python, system_control, clipboard
        _ => vec![],
    }
}
```

### wrap_legacy_error shim (Plan 33-02)

```rust
// src-tauri/src/native_tools.rs — append near the bottom of the file

/// Phase 33 / LOOP-02 — back-compat shim. Wraps a legacy `Result<_, String>`
/// error into the new `ToolError` struct so the loop engine can format it
/// uniformly. Empty `suggested_alternatives` (no enrichment from this shim);
/// `loop_engine::enrich_alternatives` is consulted at the boundary where the
/// error enters the loop (LoopState's same-tool-failure tracker).
pub fn wrap_legacy_error(tool_name: &str, err: String) -> crate::loop_engine::ToolError {
    crate::loop_engine::ToolError {
        attempted: tool_name.to_string(),
        failure_reason: err,
        suggested_alternatives: vec![],
    }
}
```

### Loop body refactor (Plan 33-03)

```rust
// src-tauri/src/commands.rs — replace L1619-L1822 with:

let halt = loop_engine::run_loop(
    &mut conversation,
    &mut config,
    &tools,
    &app,
    &last_user_text,
    routing_chain.clone(),
    brain_plan_used,
).await;

match halt {
    Ok(()) => { /* normal completion — flow continues to post-loop assembly at L1828 */ }
    Err(LoopHaltReason::CostExceeded { spent_usd, cap_usd }) => {
        emit_stream_event(&app, "blade_loop_event", serde_json::json!({
            "kind": "halted",
            "reason": "cost_exceeded",
            "spent_usd": spent_usd,
            "cap_usd": cap_usd,
        }));
        emit_stream_event(&app, "chat_error", serde_json::json!({
            "provider": &config.provider,
            "model": &config.model,
            "message": format!("Loop halted: cost cap reached (${:.2} of ${:.2})", spent_usd, cap_usd),
        }));
        emit_stream_event(&app, "chat_done", ());
        return Ok(());
    }
    Err(LoopHaltReason::IterationCap) => {
        emit_stream_event(&app, "blade_loop_event", serde_json::json!({
            "kind": "halted",
            "reason": "iteration_cap",
        }));
        // Existing iteration-exhausted handling continues
    }
    Err(LoopHaltReason::Cancelled) => {
        emit_stream_event(&app, "chat_cancelled", ());
        emit_stream_event(&app, "chat_done", ());
        return Ok(());
    }
    Err(LoopHaltReason::ProviderFatal { error }) => {
        let _ = app.emit("blade_status", "error");
        return Err(error);
    }
}
```

### LOOP-01 verification probe (Plan 33-04)

```rust
// src-tauri/src/loop_engine.rs

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict { Yes, No, Replan }

pub async fn verify_progress(
    provider: &str,
    api_key: &str,
    model: &str,
    goal: &str,
    actions: &VecDeque<ActionRecord>,
) -> Result<Verdict, String> {
    // Test seam — bypasses real provider call (mirrors CTX_SCORE_OVERRIDE)
    if let Ok(override_val) = std::env::var("LOOP_OVERRIDE") {
        return match override_val.to_uppercase().as_str() {
            "YES" => Ok(Verdict::Yes),
            "NO"  => Ok(Verdict::No),
            "REPLAN" => Ok(Verdict::Replan),
            _ => Err(format!("invalid LOOP_OVERRIDE: {}", override_val)),
        };
    }

    let cheap_model = crate::config::cheap_model_for_provider(provider, model);
    let goal_short = crate::safe_slice(goal, 1500);
    let actions_json = build_actions_json(actions); // each summary safe_slice'd to 300 chars

    let prompt = format!(
        "Given the original goal `{}` and the last 3 tool actions `{}`, \
         is the loop progressing toward the goal? Reply with exactly one word: \
         YES, NO, or REPLAN, followed by a one-sentence reason.",
        goal_short, actions_json
    );

    let response = crate::providers::complete_simple(
        provider, api_key, &cheap_model, &prompt
    ).await?;

    let first_word = response.split_whitespace().next().unwrap_or("").to_uppercase();
    match first_word.as_str() {
        "YES"    => Ok(Verdict::Yes),
        "NO"     => Ok(Verdict::No),
        "REPLAN" => Ok(Verdict::Replan),
        _        => Err(format!("unexpected verdict word: {}", first_word)),
    }
}
```

### LOOP-04 truncation detection (Plan 33-06)

```rust
// src-tauri/src/loop_engine.rs

/// Returns true if the turn appears truncated mid-output.
/// Two signals: stop_reason flag + sentence-final punctuation heuristic.
pub fn detect_truncation(turn: &crate::providers::TurnResult) -> bool {
    if turn.stop_reason.as_deref() == Some("length") { return true; }
    if turn.stop_reason.as_deref() == Some("MAX_TOKENS") { return true; } // Gemini variant
    let last_chars: String = turn.content.chars().rev().take(8).collect();
    let last_chars_rev: String = last_chars.chars().rev().collect();
    let trimmed = last_chars_rev.trim_end();
    if trimmed.is_empty() { return false; }
    let last = trimmed.chars().last().unwrap_or(' ');
    !matches!(last, '.' | '!' | '?' | ':' | '"' | ')' | '`')
}

/// Returns the doubled max_tokens, capped at the provider's documented max.
/// Reuses provider metadata used by trace logging; does NOT introduce a new registry.
pub fn escalate_max_tokens(provider: &str, model: &str, current_max: u32) -> Option<u32> {
    let provider_cap = crate::providers::max_output_tokens_for(provider, model);
    let doubled = current_max.saturating_mul(2);
    let new_max = doubled.min(provider_cap);
    if new_max <= current_max { None } else { Some(new_max) }
}
```

### LOOP-05 fast-path supplement (Plan 33-07)

```rust
// src-tauri/src/brain.rs — append near build_system_prompt_inner

/// Phase 33 / LOOP-05 — fast-path identity supplement.
///
/// Returns ONLY the always-keep core (identity tone, persona name, current
/// date/time, active tool list — codified by Phase 32-03 as the "small core
/// remains unconditional" decision). The full character_bible / safety /
/// hormones gates remain slow-path only.
///
/// Called from commands.rs:1441 fast-path branch BEFORE the streaming call.
/// Output is injected as ConversationMessage::System(...) so the provider
/// sees identity context even when the tool loop is bypassed.
///
/// CTX-07 fallback discipline: this fn must not panic. If the underlying
/// build_system_prompt_inner raises, callers wrap in catch_unwind and fall
/// back to an empty supplement (legacy fast-path behavior).
pub fn build_fast_path_supplement(
    config: &crate::config::BladeConfig,
    last_user_text: &str,
) -> String {
    if !config.r#loop.smart_loop_enabled {
        return String::new(); // legacy fast-path verbatim
    }
    // Reuse build_system_prompt_inner with a flag/parameter that returns
    // ONLY the always-keep core (Phase 32-03 codification at brain.rs:929-1152).
    // Implementation detail: thread a new `mode: PromptMode::CoreOnly` param
    // through build_system_prompt_inner OR call a private helper that emits
    // just the core sections.
    build_core_only_prompt(config, last_user_text)
}

fn build_core_only_prompt(config: &crate::config::BladeConfig, last_user_text: &str) -> String {
    // Identity tone + persona + current date + active tool list.
    // ~1k tokens worst case. Fast path cost is acceptable (CONTEXT lock §LOOP-05).
    // ...
    String::new()  // placeholder
}
```

```rust
// src-tauri/src/commands.rs — fast-path injection point (around L1462)

if config.r#loop.smart_loop_enabled {
    let supplement = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::brain::build_fast_path_supplement(&config, &last_user_text)
    })).unwrap_or_default();
    if !supplement.is_empty() {
        // Insert at index 0 so the provider sees identity before user content
        conversation.insert(0, ConversationMessage::System(supplement));
    }
}
// existing emit_stream_event blade_message_start at L1463 stays in place
```

### Cost guard + ActivityStrip events (Plan 33-08)

```rust
// src-tauri/src/loop_engine.rs — inside run_loop iteration body

// Cost-guard check at the top of each iteration
if state.cumulative_cost_usd > config.r#loop.cost_guard_dollars {
    return Err(LoopHaltReason::CostExceeded {
        spent_usd: state.cumulative_cost_usd,
        cap_usd: config.r#loop.cost_guard_dollars,
    });
}

// After complete_turn returns, accumulate cost
let (price_in, price_out) = crate::providers::price_table(&config.provider, &config.model);
let turn_cost = (turn.tokens_in as f32 * price_in + turn.tokens_out as f32 * price_out) / 1_000_000.0;
state.cumulative_cost_usd += turn_cost;
```

```typescript
// src/lib/events/payloads.ts — new export

/** Phase 33 / LOOP-06 — agentic loop lifecycle events.
 *
 *  Discriminated union over `kind`. ActivityStrip subscribes via
 *  the existing useActivityLog hook and renders chips with short labels:
 *  "verifying" | "replanning" | "token bump" | "halted: cost cap".
 *
 *  Chips persist for ~3 seconds (existing toast-fade timing — do not
 *  introduce a new timer). Most-recent-only display per CONTEXT lock. */
export type BladeLoopEventPayload =
  | { kind: 'verification_fired'; verdict: 'YES' | 'NO' | 'REPLAN' }
  | { kind: 'replanning'; count: number }
  | { kind: 'token_escalated'; new_max: number }
  | { kind: 'halted'; reason: 'cost_exceeded' | 'iteration_cap'; spent_usd?: number; cap_usd?: number };
```

---

## Landmines (read-once, then re-read before planning)

1. **Six-place rule for `r#loop: LoopConfig`.** Four fields × six sites = wide diff surface. Phase 32-01 review found two missed spots; Phase 33 must not repeat. **Solution:** Plan 33-01 enumerates every grep marker in its acceptance criteria (`grep -c "r#loop: LoopConfig" config.rs` returns ≥4; `grep -c "r#loop: disk.r#loop" config.rs` returns 1 (load_config); `grep -c "r#loop: config.r#loop.clone()" config.rs` returns 1 (save_config)).

2. **Rust keyword `loop`.** `pub loop: LoopConfig` does not compile. Use `pub r#loop: LoopConfig` everywhere — struct definition AND access sites (`config.r#loop.max_iterations`). One forgotten `r#` mid-refactor produces 30+ confusing compile errors.

3. **Tauri command namespace is FLAT.** Phase 33 adds NO Tauri commands — this risk is theoretical, but it's worth confirming `grep "fn build_fast_path_supplement\|fn run_loop\|fn verify_progress" src-tauri/src/` returns 1 line each (no collision with existing functions). The `build_fast_path_supplement` name in brain.rs is unique today (verified via grep).

4. **`AssertUnwindSafe` at the catch_unwind site.** `&BladeConfig` is not `UnwindSafe` because it carries an `Arc<...>` for keyring state somewhere. Use `std::panic::AssertUnwindSafe(...)` wrapper — same pattern Phase 32-07 used at the smart-path call sites (commit bb5d6ce). Without it the catch_unwind doesn't compile.

5. **`max_tokens` estimation per provider.** Anthropic's default ceiling is 8192 (NOT 4096 as the current code hardcodes); the 64000 ceiling requires a beta header. OpenAI's per-model table differs (gpt-4o=16384, gpt-3.5=4096). LOOP-04 must read the existing provider metadata used by trace logging — it must NOT invent a new registry, must NOT silently fall through to 4096 for unknown providers (would defeat the escalation purpose).

6. **stop_reason naming varies by provider.** Anthropic: `stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use"`. OpenAI: `finish_reason: "stop" | "length" | "tool_calls" | "content_filter"`. Gemini: `finishReason: "STOP" | "MAX_TOKENS" | "SAFETY" | ...`. The `TurnResult` struct in providers/mod.rs must surface this uniformly — confirm during planning that the field exists; if not, Plan 33-06 adds it.

7. **Verification probe must NOT block on the cheap model failing.** Network errors, parse errors, or panics in the verification call MUST NOT halt the main loop. Wrap in `catch_unwind` + return `Result<Verdict, String>`; on Err, emit a structured trace and continue without injecting a nudge. Mirror CTX-07's silent-fallback discipline at `brain.rs:2784-2880`.

8. **Cost guard reads price tables that don't yet have a clean public API.** Trace logging's price lookup is internal to `trace.rs`; Plan 33-08 must either expose a `pub fn price_table(provider, model) -> (f32, f32)` helper or add `pub fn price_for_turn(turn: &TurnResult) -> f32` — pick one, enumerate in the plan. Don't duplicate the table.

9. **ActivityStrip uses `useActivityLog` hook, not direct event subscription.** The hook's source file is the integration point. Plan 33-08 must locate it (likely `src/features/activity-log/index.ts` based on the `useActivityLog` import at ActivityStrip.tsx:9) and add the new event listener there, NOT in ActivityStrip.tsx.

10. **`verification_every_n` cadence must skip iteration 0.** The first iteration has no actions to verify against (last_3_actions is empty). The trigger is `iteration > 0 && iteration % verification_every_n == 0`. Off-by-one in the cadence = either verification on every iteration (waste) or never (silent failure of LOOP-01).

11. **The `Replan` nudge must not stack.** If two consecutive iterations both produce a NO/REPLAN verdict, the conversation gets two synthetic "Internal check: ..." system messages. Track `last_verification_action` in LoopState; if the previous nudge was injected ≤2 iterations ago, skip the second injection (model has already seen the hint and is mid-replan).

12. **CTX_SCORE_OVERRIDE precedent for LOOP_OVERRIDE.** Phase 32 introduced env-var overrides as a test seam. LOOP_OVERRIDE must follow the EXACT same pattern (env var name in SCREAMING_SNAKE, parsed at function entry, returns short-circuit value). Don't invent a new test infrastructure. Document the seam in plan 33-04.

13. **Smart-loop disabled fast-path must run NO catch_unwind around the supplement call.** When `smart_loop_enabled = false`, `build_fast_path_supplement` returns early with empty string — there's no panic surface to catch. Don't wrap unnecessarily; the wrapper costs nothing but adds noise. Wrap only the smart-on path.

14. **Don't migrate all 37+ native tools to `Result<T, ToolError>`.** CONTEXT lock §LOOP-02. The shim makes legacy tools indistinguishable to the loop. v1.6+ chore.

15. **Provider fallback inside loop_engine is OUT OF SCOPE.** CONTEXT lock §Module Boundaries. The existing `classify_api_error` flow in commands.rs stays where it is — the lifted `run_loop` function calls back into the existing recovery branches (TruncateAndRetry, SwitchModelAndRetry, RateLimitRetry, OverloadedRetry, Fatal) without modification. Plan 33-03 must preserve every error-recovery branch byte-for-byte.

---

## Validation Architecture

### Phase 33 contributes ZERO new verify gates

CONTEXT lock §Testing & Verification: "verify:intelligence is Phase 37's responsibility. Phase 33 keeps the existing 37 gates green and adds unit tests only."

**What Phase 33 ships for validation:**
- 6 unit tests (one per LOOP-01..06) named per Phase 32 convention: `phase33_loop_01_verification_fires_every_3rd`, `phase33_loop_02_tool_error_struct`, `phase33_loop_03_replans_observed`, `phase33_loop_04_truncation_retry_doubles_tokens`, `phase33_loop_05_fast_path_supplement`, `phase33_loop_06_iteration_cap_and_cost_guard`.
- 1 LoopConfig round-trip test mirroring `phase32_context_config_round_trip`.
- 1 smart-loop-disabled regression test asserting legacy 12-iteration parity.
- 1 panic-injection regression test mirroring CTX-07's pattern (verification probe panic must not halt main loop).
- 1 runtime UAT (final plan) per CLAUDE.md Verification Protocol.

### Auto-Compact Threshold

Phase 33 inherits Phase 32's compaction trigger verbatim — the loop engine sees the SAME conversation Phase 32 compacts. No new threshold introduced.

The cost guard's threshold (default 5.0 USD) is conceptually separate from compaction; it's a per-conversation spend cap, not a per-turn token budget. At GPT-4o pricing (≈$5/1M input, $15/1M output), 5 USD ≈ ~250k input + ~250k output tokens — roughly enough for 10-15 long tool-using turns. At Claude Sonnet 4 pricing (≈$3/1M input, $15/1M output), it's ~300k input + ~300k output. The 5.0 default is sized to halt before a single conversation runs away, while leaving long planning sessions untouched.

### Test Strategy

| Test | Surface | Mechanism | Pass/Fail signal |
|------|---------|-----------|-----------------|
| `phase33_loop_config_round_trip` | config.rs | Build LoopConfig with non-default values, round-trip through DiskConfig serde | All four fields survive byte-for-byte |
| `phase33_loop_config_missing_in_disk_uses_defaults` | config.rs | Parse a JSON config string omitting `loop` key | `parsed.r#loop == LoopConfig::default()` |
| `phase33_loop_01_verification_fires_every_3rd` | loop_engine.rs | Set LOOP_OVERRIDE=YES; build a fake LoopState advancing through 6 iterations; assert verify_progress() called at iter 3 and 6, not at iter 1, 2, 4, 5 | Counter == 2 |
| `phase33_loop_02_tool_error_struct` | loop_engine.rs | Construct ToolError with non-empty alternatives; render_for_model(); assert format matches CONTEXT lock | String equality |
| `phase33_loop_02_legacy_shim_omits_alternatives_block` | native_tools.rs | wrap_legacy_error("read_file", "no such file"); render_for_model(); assert NO "Suggested alternatives:" substring | `!output.contains("Suggested alternatives")` |
| `phase33_loop_03_replans_observed` | loop_engine.rs | Synthetic LoopState with 3 same-tool failures; assert reject_plan called and replans_this_run == 1; repeat with 6 failures; assert replans_this_run == 2 | Counter == 2 |
| `phase33_loop_04_truncation_retry_doubles_tokens` | loop_engine.rs | Mock TurnResult with stop_reason="length"; call escalate_max_tokens; assert returned value == min(current*2, provider_cap); and detect_truncation returns true on un-punctuated chunk | Two assertions |
| `phase33_loop_05_fast_path_supplement` | brain.rs | Build BladeConfig with smart_loop_enabled=true; call build_fast_path_supplement; assert non-empty + contains "BLADE" identity marker. Repeat with smart_loop_enabled=false; assert empty string | Two assertions |
| `phase33_loop_06_iteration_cap_and_cost_guard` | loop_engine.rs | Set max_iterations=3 + cost_guard_dollars=0.001; run a fake loop; assert halt fires by iteration 3 with reason IterationCap; reset, set high iteration cap and force cost > 0.001; assert halt fires with reason CostExceeded | Two assertions |
| `phase33_smart_loop_disabled_runs_legacy_12_iterations` | loop_engine.rs | Set smart_loop_enabled=false; run a fake loop with 100 fake turns; assert exactly 12 iterations executed, zero verification probes fired, zero token escalations, zero cost-guard halts | Three assertions |
| `phase33_verification_panic_does_not_halt_loop` | loop_engine.rs | Force verify_progress to panic via a poisoned probe input; assert main loop continues to next iteration; assert structured trace recorded | catch_unwind asserts plus log-line presence |
| Runtime UAT (Plan 33-09) | Dev binary + ActivityStrip | Multi-step task with 5+ tool calls; tool-failure injection; long-output prompt; cost-cap-low; smart-loop-toggle; screenshots at 1280×800 + 1100×700 | Operator-checked per CLAUDE.md verification protocol |

---

## Plan Wave Recommendations

This is the planner's call, not the researcher's, but the dependency graph implied by the locked decisions suggests:

- **Wave 1 (substrate, runs in parallel):**
  - Plan 33-01 — LoopConfig + LoopHaltReason types + 6-place wire-up (config.rs only; no behavior change)
  - Plan 33-02 — loop_engine.rs scaffold + LoopState + ToolError + wrap_legacy_error shim (new module + native_tools.rs append; no commands.rs change yet)

- **Wave 2 (refactor; depends on Wave 1):**
  - Plan 33-03 — Refactor commands.rs:1621 hardcoded `for iteration in 0..12` to call loop_engine::run_loop, threading config through. Preserves error-recovery branches verbatim. NO smart-feature additions in this plan — pure lift.

- **Wave 3 (smart-loop features; mostly parallel; each depends on Wave 2):**
  - Plan 33-04 — Mid-loop verification (LOOP-01) via cheap_model_for_provider + LOOP_OVERRIDE seam
  - Plan 33-05 — Plan adaptation (LOOP-02 + LOOP-03 — ToolError consumption in conversation prompt + reject_plan trigger on third same-tool failure)
  - Plan 33-06 — Max-token escalation (LOOP-04) — detect_truncation + escalate_max_tokens helpers
  - Plan 33-07 — Ego intercept on fast path (LOOP-05) — build_fast_path_supplement + injection at commands.rs:1462

- **Wave 4 (close-out):**
  - Plan 33-08 — Cost guard + ActivityStrip event wiring (LOOP-06 cost half) — cumulative_cost_usd tracking, blade_loop_event emit, payloads.ts BladeLoopEventPayload, useActivityLog event listener
  - Plan 33-09 — CTX-07-style fallback verification + checkpoint:human-verify UAT — panic-injection regression test for verify_progress, end-to-end runtime UAT per CLAUDE.md verification protocol with the full 8-step UAT script from CONTEXT lock §Testing & Verification.

LOOP-06 is split between Plan 33-01 (the config + iteration cap — substrate only) and Plan 33-08 (the cost guard runtime + ActivityStrip events — behavior). Splitting it lets Wave 1 ship a small, easily-reviewed substrate plan while Wave 4 owns the cross-cutting cost-and-events work that depends on Waves 1-3.

---

*Phase: 33-agentic-loop*
*Research compiled 2026-05-05 inline (no spawned subagent — same-process synthesis from CONTEXT lock + codebase grounding + external pattern citations). All locked decisions traceable to 33-CONTEXT.md; all code anchors verified via grep at the listed file:line targets.*
