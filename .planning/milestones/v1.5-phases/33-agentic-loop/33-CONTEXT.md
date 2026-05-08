# Phase 33: Agentic Loop — Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Source:** Synthesised directly from ROADMAP.md, REQUIREMENTS.md, PROJECT.md, CLAUDE.md, and codebase grounding (autonomous decisions per Arnav's instruction; no interactive discuss-phase)

<domain>
## Phase Boundary

**What this phase delivers:**
The naive `for iteration in 0..12 { ... }` tool loop in `commands.rs` (line 1621) becomes a structured `loop_engine::run_loop` driver. The loop verifies progress every 3 tool calls via a cheap-model probe, consumes structured `ToolError` failures (not bare strings) so the model can reason about alternatives, drives plan adaptation through the model when a step fails, auto-retries with doubled `max_tokens` on truncation, runs the ego intercept on the fast-streaming path that today silently skips it, and respects a configurable iteration cap (default 25, was hardcoded 12) plus a per-conversation cost guard. ActivityStrip surfaces verification firings, plan adaptations, and halts. Every smart path falls back to the legacy 12-iteration behavior when `loop.smart_loop_enabled = false`.

**What this phase does NOT touch:**
- Phase 32 selective injection / compaction / tool-output cap (already shipped — Phase 33 only consumes their output)
- Stuck detection (RES-01) — that is Phase 34's job; cost guard here is the simpler "did we exceed the dollar cap" check, not pattern-based stuck detection
- Circuit breaker after N consecutive failures (RES-02) — Phase 34
- Token-count UI / cost cap warnings at 80% (RES-03/04) — Phase 34
- Session persistence (SESS-01..04) — Phase 34
- Migrating every existing tool from `Result<T, String>` to `Result<T, ToolError>` — Phase 33 lands the type + a back-compat shim so the loop sees `ToolError` even from legacy tools; full per-tool migration is v1.6+ work
- Auto-decomposition / sub-agents (DECOMP-01..05) — Phase 35
- Repo map / capability registry / @context-anchor (INTEL-01..03) — Phase 36
- Any UI work beyond ActivityStrip chips for loop events (chat-first pivot — UI debt remains paused)

**Why this is the spine of v1.5:**
Phase 32 made the prompt sane. Phase 33 makes the loop sane. Until LOOP-01..06 land, every downstream phase (RES, DECOMP, INTEL) is wiring features onto a 12-iteration blind retry. Phase 34's stuck detection has nothing meaningful to detect if the loop already gives up at 12. Phase 35's auto-decomposition can't isolate sub-agent loops if the parent loop has no structure. LOOP-01..06 are the structural foundation; everything after this phase plugs into the engine this phase builds.

</domain>

<decisions>
## Implementation Decisions

### Iteration Limit & Cost Guard (LOOP-06)

- **Locked: New `BladeConfig.loop` sub-struct with `max_iterations: u32 = 25` and `cost_guard_dollars: f32 = 5.0`.** Mirrors Phase 32's `ContextConfig` layout in `config.rs`. Six-place rule applies to every field per CLAUDE.md (DiskConfig struct, DiskConfig::default, BladeConfig struct, BladeConfig::default, load_config, save_config). Do not skip a place — Phase 32-01 review found two missed spots and they had to be patched separately.
- **Locked: The hardcoded `for iteration in 0..12` at `commands.rs:1621` becomes `for iteration in 0..config.r#loop.max_iterations`.** `loop` is a Rust keyword — use the raw identifier `r#loop` for the field name in struct definitions and access sites.
- **Locked: Cost guard tracks cumulative `tokens_in × price_in + tokens_out × price_out` for the entire conversation lifetime, not just the current turn.** Provider price tables already exist (used by trace logging); reuse those — do not duplicate.
- **Locked: When cumulative cost exceeds `cost_guard_dollars`, the loop halts with `LoopHaltReason::CostExceeded { spent_usd, cap_usd }`.** The halt is structured (not a string error), surfaced to the user via `chat_error` event with a clear "loop halted: cost cap reached" message + the dollar figures, and emits a `blade_loop_event` for ActivityStrip.
- **Locked: Cost guard is a single global cap.** No per-trust-tier escalation in this phase (deferred). One `cost_guard_dollars` value, full stop.
- **Claude's discretion:** Whether to round-down or round-half-even on token-to-dollar arithmetic. Either is fine — pick one and document.

### Mid-Loop Verification (LOOP-01)

- **Locked: Every 3 iterations (configurable via `loop.verification_every_n: u32 = 3`), route a verification probe to `cheap_model_for_provider`.** That helper already exists from Phase 32-04 — reuse it, do not invent a parallel cheap-model selector.
- **Locked: The verification prompt is fixed and hardcoded** (single source of truth, not a config knob): "Given the original goal `{goal}` and the last 3 tool actions `{actions}`, is the loop progressing toward the goal? Reply with exactly one word: YES, NO, or REPLAN, followed by a one-sentence reason." Parse the first word case-insensitively.
- **Locked: `goal` = the most recent user message text** (truncated via `safe_slice` to 1500 chars). `actions` = a compact JSON array of `{tool, input_summary, output_summary}` for the last 3 tool calls; each summary is `safe_slice`-capped to 300 chars.
- **Locked: Three verdicts, three behaviors.**
  - `YES` → continue the loop normally.
  - `NO` → emit a `blade_loop_event` `{kind: "verification_failed"}` and inject a synthetic system message into the conversation: "Internal check: the last 3 tool calls do not appear to be making progress. Reconsider the approach." Then continue. The model sees the nudge on the next turn.
  - `REPLAN` → emit `{kind: "replanning"}`, inject "Internal check: re-plan from current state. Do not retry the failing step verbatim." Then continue. The model drives re-planning via the prompt, not via a separate planner call (see plan-adaptation lock).
- **Locked: Verification fires inside the smart path only.** When `loop.smart_loop_enabled = false`, the probe is skipped — the loop runs as the legacy 12-iteration blind drive.
- **Locked: A failed verification call (network error, parse error, panic) does NOT halt the loop.** Catch the failure, log a structured trace, continue without injecting a nudge. Mirrors CTX-07's silent fallback discipline.
- **Claude's discretion:** Whether to include the verification turn in cost tracking. Recommend yes (it's real spend) but if the cheap model is free-tier, exclude.

### Structured Tool Errors (LOOP-02)

- **Locked: New Rust struct in the new `loop_engine.rs` module:**
  ```rust
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct ToolError {
      pub attempted: String,                  // tool name + brief input description
      pub failure_reason: String,             // raw error or interpreted reason
      pub suggested_alternatives: Vec<String>, // human-readable next-step hints
  }
  ```
- **Locked: Back-compat shim in `native_tools.rs`.** A helper `wrap_legacy_error(tool_name, err) -> ToolError` produces `ToolError { attempted: tool_name, failure_reason: err, suggested_alternatives: vec![] }`. Every native tool that today returns `Err(String)` flows through this shim at the boundary where the result enters the loop. NO blanket migration of all 37+ native tools in this phase.
- **Locked: When the model is shown a tool failure, it sees the structured fields, not the raw struct.** Format injected into the conversation as a tool result message:
  ```
  Tool failed.
  Attempted: <attempted>
  Reason: <failure_reason>
  Suggested alternatives:
    - <alt 1>
    - <alt 2>
  ```
  If `suggested_alternatives` is empty (legacy shim), omit the "Suggested alternatives" block entirely (no empty bullets).
- **Locked: The first round of "real" alternatives lives in the loop_engine's `enrich_alternatives` helper.** A small static map of tool name → likely alternatives (e.g. `read_file` → `["check the path", "use bash 'ls -la <dir>' to confirm existence"]`). Phase 33 ships ~10 entries covering the most common tool failures. Comprehensive coverage = follow-up work.
- **Locked: ToolError is not exposed to the frontend in this phase.** It's a Rust-side conversation-formatting concern. ActivityStrip chips show a generic "tool failed" event, not the full struct.
- **Claude's discretion:** Whether `failure_reason` is a String or a typed enum. Recommend String for v1 (gradient migration); enum is a follow-up.

### Plan Adaptation (LOOP-03)

- **Locked: When a tool returns `ToolError`, the next iteration's prompt context includes the structured failure (LOOP-02 format above).** The model decides — retry, alternative tool, replan. No separate "planner" subroutine is invoked.
- **Locked: The `brain_planner::reject_plan` call already exists at `commands.rs:1684` for the truncate-retry-failed branch.** Wire it into the loop_engine: when a `ToolError` is the third consecutive failure of the same tool name (not the same input — same tool name, signalling the model is thrashing on one tool), call `reject_plan` to invalidate any cached plan, then inject the same "re-plan from current state" nudge as LOOP-01's REPLAN verdict.
- **Locked: Two consecutive plan adaptations must be observable in a multi-step task** (success criterion 3). Implement counters in `LoopState`: `replans_this_run: u32`. Emit each transition via `blade_loop_event {kind: "replanning", count: N}` so the UAT can read ActivityStrip chips and confirm.
- **Locked: NO automated planner that runs without the model in the loop.** The "re-plan" is always model-driven via prompt context. A standalone re-planner is v1.6+ work and explicitly deferred.
- **Claude's discretion:** Whether to also emit a `blade_thinking_chunk` summarising the reason for the replan, so the user sees rationale in the streaming UI. Optional.

### Max-Output-Token Escalation (LOOP-04)

- **Locked: Detect truncation via two signals.** Either trips the retry:
  1. Provider response indicates `stop_reason: "length"` (or equivalent — `finish_reason: "length"` for OpenAI-compatible).
  2. The last completed text chunk does not end with sentence-final punctuation (`.`, `!`, `?`, `:`, `"`, `)`, code-fence end) — a heuristic catch for providers that don't surface stop_reason cleanly.
- **Locked: On detection, retry the SAME turn with `max_tokens × 2`, capped at the provider's documented maximum** (Anthropic 8192 default, 64000 for Sonnet 4 with header; OpenAI o1 has its own table). Use the existing provider metadata in `providers/mod.rs` — do not invent a new max-tokens registry.
- **Locked: Each turn allows at most 1 escalation.** If the doubled-token retry also truncates, accept the truncation, log the event, and move on. No infinite escalation loop.
- **Locked: Track in `LoopState.token_escalations: u32`.** Surface via `blade_loop_event {kind: "token_escalated", new_max: N}`. Increment for every retry, not every turn.
- **Locked: Escalation respects the cost guard.** A doubled-token retry that would push cumulative cost over the cap does NOT fire — accept the truncation.
- **Claude's discretion:** Whether to include the truncated content + a "continue from here" hint in the retry prompt vs. starting the same turn fresh. Recommend retry-fresh — simpler, avoids prompt-format edge cases. The model has the same context as the original call.

### Ego Intercept on Fast Path (LOOP-05)

- **Locked: The fast-streaming branch at `commands.rs:1441–1577` currently emits tokens via `providers::stream_text` / `fallback_chain_complete_with_override` without invoking `ego::intercept_assistant_output` or building a system prompt with identity context.** This is the documented "Phase 18 KNOWN GAP" comment at `commands.rs:1442–1451`. Phase 33 closes the gap.
- **Locked: Even on the fast path, build an identity-supplement-only system prompt and pass it to the provider.** Reuse the always-keep core that Phase 32-03 codified (identity tone, persona name, current date/time, active tool list — the "small core remains unconditional" lock from Phase 32-CONTEXT). The full character_bible / safety / hormones gates remain slow-path only.
- **Locked: New helper `brain::build_fast_path_supplement(config, last_user_text) -> String`** in `brain.rs`. This is a thin wrapper that calls into `build_system_prompt_inner` with a flag/parameter that returns ONLY the always-keep core. Do not duplicate identity-assembly logic.
- **Locked: The helper output is injected into the `conversation` Vec as a system message before the streaming call.** Provider streaming functions already accept system messages via `ConversationMessage::System` (or equivalent — confirm in providers/mod.rs).
- **Locked: Fast path cost is acceptable.** The supplement is small (~1k tokens worst case) and runs once per turn. No regression risk on the latency budget that the fast path exists to preserve.
- **Locked: When `loop.smart_loop_enabled = false`, fast path skips the supplement** — preserves legacy behavior. CTX-07 fallback discipline applies here too.
- **Claude's discretion:** Whether to also invoke `ego::intercept_assistant_output` at fast-path stream completion (running it on the fully-streamed text once `chat_done` fires). Recommend yes for parity with the slow path; if it adds latency on the user-perceived turn boundary, defer to slow path only.

### ActivityStrip Integration

- **Locked: Loop emits `blade_loop_event` Tauri events for four kinds:**
  - `verification_fired` — every 3 iterations when LOOP-01 probe runs (with `verdict: YES|NO|REPLAN`)
  - `replanning` — when LOOP-03 plan adaptation triggers
  - `token_escalated` — when LOOP-04 doubles max_tokens
  - `halted` — when the loop stops on cost cap or iteration cap (with `reason: "cost_exceeded" | "iteration_cap"`)
- **Locked: Frontend `ActivityStrip.tsx` subscribes to `blade_loop_event` and renders chips.** Reuse existing chip rendering — no bespoke component design. Map kinds to short labels: "verifying", "replanning", "token bump", "halted: cost cap".
- **Locked: Typed wrapper in `src/lib/tauri/events.ts`.** Export `BladeLoopEvent` type with discriminated union over `kind`. Register the listener in ActivityStrip via the existing Phase 32 event hookup pattern.
- **Locked: Chips persist for ~3 seconds, then fade.** Use the existing toast-fade timing in ActivityStrip — do not introduce a new timer system.
- **Claude's discretion:** Whether ActivityStrip shows a one-line history (last 5 loop events) or just the most recent. Recommend most-recent only for chat-first pivot minimalism.

### Backward Compatibility (Smart Loop Toggle)

- **Locked: New config flag `loop.smart_loop_enabled: bool` (default `true`).** When false:
  - Iteration cap reverts to literal 12 (legacy behavior)
  - Mid-loop verification skipped
  - Plan adaptation skipped (legacy `reject_plan` on truncate-retry stays, that's pre-existing)
  - Token escalation skipped
  - Ego intercept on fast path skipped (legacy "KNOWN GAP" reinstated)
  - Cost guard skipped
  - Structured ToolError still wraps legacy errors (the shim is non-optional infrastructure)
- **Locked: This mirrors Phase 32's `context.smart_injection_enabled` escape hatch.** Same lesson: smart path must never be the only path. v1.1 retraction taught us a smart path with no off-switch can hide regressions until UAT, by which point the milestone is already closed.
- **Locked: Tests must cover both paths.** Unit tests run with the toggle on and off, asserting behavioral parity with the legacy 12-iteration loop when off.
- **Claude's discretion:** Whether to also gate the ToolError wrapping behind the toggle. Recommend NO — the wrapper produces the same `String` representation when shown to the model in shim-mode (no alternatives), so legacy behavior is preserved without an extra branch.

### Module Boundaries

- **Locked: New top-level Rust module `src-tauri/src/loop_engine.rs`** owns:
  - `LoopState` struct (current iteration count, cumulative cost, replans_this_run, token_escalations, last_3_actions ring buffer)
  - `LoopHaltReason` enum (`CostExceeded { spent_usd, cap_usd }`, `IterationCap`, `Cancelled`, `ProviderFatal { error }`)
  - `ToolError` struct (LOOP-02)
  - `run_loop` driver function — replaces the `for iteration in 0..12 { ... }` body in commands.rs
  - `verify_progress` helper (LOOP-01)
  - `enrich_alternatives` helper (LOOP-02)
  - `detect_truncation` + `escalate_max_tokens` helpers (LOOP-04)
- **Locked: `commands.rs` keeps the OUTER orchestration** (config load, conversation prep, fast-path branch, post-loop cleanup) and calls into `loop_engine::run_loop` for the iteration body. Don't move the entire `send_message_stream_inline` into the new module — keep the boundary minimal.
- **Locked: Module registration per CLAUDE.md.** `mod loop_engine;` in `lib.rs`. No new Tauri commands needed (events emit through the existing `app.emit` channel; no commands invoked from frontend).
- **Locked: `native_tools.rs` adds the `wrap_legacy_error` shim only.** No other changes; do not migrate every tool.
- **Locked: Frontend additions live in two files only.** `src/features/activity-strip/ActivityStrip.tsx` (subscribe + render chips) and `src/lib/tauri/events.ts` (typed wrapper). No new components, no new routes.
- **Locked: Six-place config rule applies** to every new field in `LoopConfig`. See CLAUDE.md.
- **Locked: `safe_slice` is mandatory** for any new string-slice operation on user/conversation/tool content (LOOP-01 prompt construction is the obvious risk site).

### Testing & Verification

- **Locked: Each LOOP-01..06 needs at least one unit test.** Use the same naming pattern as Phase 32 tests: `phase33_loop_01_verification_fires_every_3rd`, `phase33_loop_02_tool_error_struct`, `phase33_loop_03_replans_observed`, `phase33_loop_04_truncation_retry_doubles_tokens`, `phase33_loop_05_fast_path_supplement`, `phase33_loop_06_iteration_cap_and_cost_guard`.
- **Locked: Test seam pattern.** Mirror Phase 32's `CTX_SCORE_OVERRIDE` — introduce `LOOP_OVERRIDE` env var for tests that need to inject a fake cheap-model verdict (`LOOP_OVERRIDE=YES|NO|REPLAN`) without making real provider calls. Document the seam in plan 33-NN.
- **Locked: Smart-loop-disabled regression test required.** A unit test sets `loop.smart_loop_enabled = false` and asserts the loop runs exactly 12 iterations max with no verification/escalation/cost-guard side effects.
- **Locked: NO new verify gate.** verify:intelligence is Phase 37's responsibility. Phase 33 keeps the existing 37 gates green and adds unit tests only.
- **Locked: Runtime UAT REQUIRED per CLAUDE.md Verification Protocol.** This phase has UI work (ActivityStrip chips). The final task in plan 33-NN must be `checkpoint:human-verify`. UAT script:
  1. Open dev binary (`npm run tauri dev`)
  2. Send a multi-step task that requires 5+ tool calls (e.g. "find all Rust files modified in the last week, summarise changes, and write the summary to a file") — assert verification chip fires at iteration 3 and 6
  3. Force a tool failure (e.g. `read_file` with a path that doesn't exist, then a follow-up read with another bad path) — assert "replanning" chip appears
  4. Trigger a long response (ask the model to write a 2000-word essay) — assert "token bump" chip if truncation hits
  5. Set `cost_guard_dollars` to a low value (e.g. 0.01) and run a query — assert "halted: cost cap" chip and graceful chat_error
  6. Toggle `loop.smart_loop_enabled = false` — assert the loop runs the legacy 12-iteration path with no chips
  7. Screenshot ActivityStrip at 1280×800 + 1100×700, save under `docs/testing ss/` (literal space)
  8. Read back screenshots via the Read tool and cite a one-line observation per breakpoint
- **Locked: tsc --noEmit + cargo check must remain clean.** No regressions in the 37 verify gates.

### Claude's Discretion (catch-all)

- File-level layout inside `loop_engine.rs` — split into submodules if it gets large, or keep monolithic. Phase 32 left commands.rs and brain.rs monolithic and that worked; default to monolithic here too.
- Exact `verification_every_n` default — 3 is locked but if observed token reduction at 5 is significantly better with comparable progress detection, that's a tunable knob.
- Whether the verification probe shares conversation state with the main loop or runs against a separate minimal context (recommend separate minimal — verification is about goal vs actions, not full chat history)
- Whether to include `blade_thinking_chunk` rationale lines for verification verdicts (optional polish; skip if it muddies the streaming UX)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 33 row (lines 108-120) + 6 success criteria + LOOP-01..06 sequencing
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — LOOP-01..06 verbatim (lines 22-27)
- `/home/arnav/blade/.planning/STATE.md` — v1.5 milestone state, key decisions table
- `/home/arnav/blade/.planning/PROJECT.md` — Project core value (read for tone)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (six-place config, safe_slice, Tauri command namespace, verification protocol, what-not-to-do list)
- `/home/arnav/CLAUDE.md` — workspace defaults (Tauri 2 + React + Tailwind v4)

### Phase 32 Predecessor (read for inherited patterns)
- `/home/arnav/blade/.planning/phases/32-context-management/32-CONTEXT.md` — gold-standard CONTEXT structure; LOOP_OVERRIDE test seam mirrors `CTX_SCORE_OVERRIDE`
- `/home/arnav/blade/.planning/phases/32-context-management/32-07-PLAN.md` — fallback discipline pattern (`catch_unwind` wrappers, panic-injection regression tests). Phase 33 inherits this discipline.
- `src-tauri/src/config.rs` — `ContextConfig` six-place wire-up exemplar; copy that shape for `LoopConfig`.

### Code Anchors (must read to plan accurately)
- `src-tauri/src/commands.rs` — `send_message_stream_inline` (line 1370 onward), fast-path branch (lines 1441–1577), tool loop (`for iteration in 0..12` at line 1621), `classify_api_error` + `TruncateAndRetry` (line 274), existing `brain_planner::reject_plan` call (line 1684). The 12-iteration loop is THE thing this phase replaces.
- `src-tauri/src/brain.rs` — `build_system_prompt_inner` (line 456), Phase 32-03's always-keep-core enforcement around lines 929–1152. LOOP-05's `build_fast_path_supplement` reuses this structure.
- `src-tauri/src/providers/mod.rs` — `complete_turn`, `stream_text`, `fallback_chain_complete_with_override`, `cheap_model_for_provider` (added in Phase 32-04), provider max-tokens metadata used by LOOP-04 escalation cap.
- `src-tauri/src/native_tools.rs` — entry point for `wrap_legacy_error` shim; the 37+ tool definitions live here.
- `src-tauri/src/lib.rs` — `mod` registrations + `generate_handler!` (no new commands needed but module registration for `loop_engine` is required).
- `src-tauri/src/brain_planner.rs` — existing `reject_plan` called at commands.rs:1684. LOOP-03 wires this into the structured replan path.
- `src/features/activity-strip/ActivityStrip.tsx` — existing chip surface; phase 33 extends it with loop event subscriptions.
- `src/lib/tauri/events.ts` — typed event wrappers; phase 33 adds `BladeLoopEvent`.

### Research Citations (locked in v1.5 milestone)
- mini-SWE-agent — used in Phase 33 (this phase). Mid-loop verification + plan adaptation patterns drawn from its agent loop architecture.
- Claude Code architecture (arxiv 2604.14228) — agent loop primitives; structured tool errors mirror the pattern.
- OpenHands condenser — Phase 32 territory, NOT this phase (read for context only).
- Aider repo map — Phase 36, NOT this phase.
- Goose capability registry — Phase 36, NOT this phase.

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — BLADE memory index (chat-first pivot, UAT rule, ghost CSS tokens, streaming contract). LOOP-05's fast-path fix is the same surface as the streaming-contract memory entry.
- `docs/testing ss/` (path has a literal space) — UAT screenshot storage

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete code patterns to reuse (not invent):**
- Iteration loop refactor at `commands.rs:1621`:
  ```rust
  // BEFORE
  for iteration in 0..12 {
      // ... 200 lines of inline tool-loop logic ...
  }
  // AFTER
  let halt = loop_engine::run_loop(
      &mut conversation,
      &mut config,
      &tools,
      &app,
      &last_user_text,
  ).await;
  match halt {
      Ok(()) => { /* normal completion */ }
      Err(LoopHaltReason::CostExceeded { spent_usd, cap_usd }) => { /* emit halted event + chat_error */ }
      Err(LoopHaltReason::IterationCap) => { /* emit halted event */ }
      Err(LoopHaltReason::Cancelled) => { /* emit chat_cancelled */ }
      Err(LoopHaltReason::ProviderFatal { error }) => { /* surface */ }
  }
  ```
- `cheap_model_for_provider(provider) -> &str` already exists from Phase 32-04. Re-use it for LOOP-01's verification probe.
- `safe_slice(text, max_chars)` from `lib.rs` is mandatory for the verification prompt's `goal` and `actions` truncation.
- `emit_stream_event(&app, "blade_loop_event", json!({...}))` follows the same pattern as `blade_status` / `blade_notification` already in commands.rs.
- Six-place config wire-up — copy the diff Phase 32-01 used for `ContextConfig` and adapt every line for `LoopConfig`. Don't try to remember the six places from memory.

**Concrete config additions (six-place rule applies to each):**
```rust
pub struct LoopConfig {
    pub smart_loop_enabled: bool,        // default true; CTX-07-style escape hatch
    pub max_iterations: u32,             // default 25 (was hardcoded 12)
    pub cost_guard_dollars: f32,         // default 5.0
    pub verification_every_n: u32,       // default 3
}
```
Add `r#loop: LoopConfig` (Rust keyword conflict — use raw identifier) field to `BladeConfig` and `DiskConfig`. Default impl, load_config, save_config — six places per CLAUDE.md.

**Concrete LoopState shape:**
```rust
pub struct LoopState {
    pub iteration: u32,
    pub cumulative_cost_usd: f32,
    pub replans_this_run: u32,
    pub token_escalations: u32,
    pub last_3_actions: VecDeque<ActionRecord>,  // ring buffer for verification probe
    pub consecutive_same_tool_failures: HashMap<String, u32>,  // for LOOP-03 replan trigger
}

pub struct ActionRecord {
    pub tool: String,
    pub input_summary: String,   // safe_slice'd to 300 chars
    pub output_summary: String,  // safe_slice'd to 300 chars
    pub is_error: bool,
}
```

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't run `cargo check` after every edit — batch first, check at end (1-2 min per check).
- Don't add Co-Authored-By lines to commits.
- Don't use `&text[..n]` on user content — use `safe_slice`.
- Don't create a Tauri command name that already exists in another module — Tauri's macro namespace is FLAT.
- Don't claim the phase is "done" because static gates pass — runtime UAT per CLAUDE.md is mandatory; v1.1 retracted on this exact failure.
- Don't migrate all 37+ native tools to `Result<T, ToolError>` in this phase — the shim makes that an incremental, opt-in migration.

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 33 scope:

- **Per-tool migration to `Result<T, ToolError>`** — Phase 33 lands the type + shim only. Every native tool's signature change is a v1.6+ chore tracked separately. The shim makes legacy tools indistinguishable to the loop, so migration can happen one tool at a time post-v1.5.
- **Automated re-planning without the model in the loop** — current scope: model-driven via prompt context (LOOP-03 lock). A standalone planner subroutine that runs without the LLM is a v1.6+ idea.
- **Per-tool cost tracking** — current scope: per-conversation rollup against a single global cap. Per-tool attribution is a Phase 34 RES-03 concern.
- **Cost-guard tier escalation by user trust level** — current scope: single global cap. Trust-tier escalation requires a trust model that doesn't exist yet.
- **Stuck detection (5 semantic patterns)** — RES-01, Phase 34. Phase 33's cost guard is the simpler "did we exceed dollars" check, not pattern-based stuck detection.
- **Circuit breaker after N consecutive same-type failures** — RES-02, Phase 34. Phase 33's "third same-tool failure triggers replan" is the seed of the idea but not the full circuit breaker.
- **Token-count UI / cost cap warnings at 80%** — RES-03/04, Phase 34. Phase 33 only halts at 100%; warnings are next phase.
- **Session persistence (JSONL log, resume from compaction boundary)** — SESS-01..04, Phase 34.
- **Auto-decomposition of 5+ independent steps** — DECOMP-01..05, Phase 35.
- **Repo map / capability registry / @context-anchor** — INTEL-01..03, Phase 36.
- **Verification probe parallelism** — running the LOOP-01 probe in parallel with the main loop iteration (so verification doesn't add serial latency) is a v1.6+ optimisation. Phase 33 runs it serially every 3 iterations.
- **Provider fallback inside the loop_engine** — current scope: provider fallback stays in `commands.rs`'s existing `classify_api_error` flow. RES-05 (Phase 34) tightens this; Phase 33 does not.
- **Chaos testing of the smart-loop fallback path** — recommended if cheap, not blocking.
- **Comprehensive `enrich_alternatives` map** — Phase 33 ships ~10 entries for common tools. Filling out the full 37+ tool coverage is incremental.

</deferred>

---

*Phase: 33-agentic-loop*
*Context gathered: 2026-05-05 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / PROJECT.md / CLAUDE.md / Phase 32 predecessor / live codebase grounding at commands.rs:1370-1700 + brain.rs + config.rs + providers/mod.rs.*
