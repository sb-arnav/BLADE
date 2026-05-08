---
phase: 32-context-management
plan: 4
subsystem: chat-pipeline
tags: [commands, compaction, condenser, openhands, capability-probe, ctx-03, ctx-04, rust, tauri]

# Dependency graph
requires:
  - phase: 32-01
    provides: "ContextConfig.compaction_trigger_pct (default 0.80) + ContextConfig.smart_injection_enabled (CTX-07 escape hatch) — Plan 32-04 reads both at the trigger site"
  - phase: 32-02
    provides: "build_test_conversation(n) fixture in commands::tests — used by phase32_compress_keep_recent_normal_case + token_aware + floor"
  - phase: 32-03
    provides: "ContextConfig substrate already wired through brain.rs — Plan 32-04 only touches commands.rs, no contention"
  - phase: 11-smart-provider-setup
    provides: "capability_probe::infer_capabilities(provider, model, ctx_window_from_api) returning (vision, audio, tool_calling, long_context, context_window) — the 5th tuple element is what Plan 32-04 wraps"
provides:
  - "model_context_window(provider, model) -> u32 helper in commands.rs (wraps capability_probe::infer_capabilities, floors at 8_192)"
  - "Per-model proactive compaction trigger: replaces the hardcoded 140_000 literal at the pre-tool-loop call site with model_context_window × config.context.compaction_trigger_pct"
  - "Per-model recovery trigger: replaces the hardcoded 120_000 literal in the TruncateAndRetry path with model_context_window × 0.65 (more headroom)"
  - "OpenHands v7610 structured summary prompt (USER_CONTEXT / COMPLETED / PENDING / CURRENT_STATE / CODE_STATE / TESTS / CHANGES / DEPS / INTENT / VC_STATUS) replacing the previous 3-6-sentence generic prompt"
  - "Token-aware keep_recent safety cap (compute_keep_recent helper) bounded by both message count (8) and 16k-token budget; floors at 2"
  - "blade_status: 'compacting' indicator emitted BEFORE the compaction await so the UI can surface a wait spinner (CONTEXT.md Option B path)"
  - "blade_notification with concrete pre-compaction token count (~N tokens of M budget) so users see progress, not vague spinner"
  - "Eight new Phase 32 unit tests green: 4 trigger (anthropic/openai/unknown/pct) + 4 compress (v7610 keys, normal 8-cap, token-aware drop, .max(2) floor) — total phase32_* count now 29 (21 prior + 8 new)"
affects: [32-05-tool-output-cap, 32-06-context-breakdown-dashboard, 32-07-fallback-fixture]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — pure logic changes on existing capability_probe + tauri stack
  patterns:
    - "Per-model threshold pattern: `(model_context_window(provider, model) as f32 * config.context.compaction_trigger_pct) as usize` — replaces hardcoded literals at every site that needs to know 'is this conversation getting too big?'"
    - "Pure-helper extraction for testability: build_compaction_summary_prompt(events) and compute_keep_recent(conv, max_msgs, token_budget) factored out so they can be tested directly without invoking a real LLM (RESEARCH.md called this out as the pragmatic alternative to mocking complete_turn)"
    - "CTX-07 escape hatch in commands.rs: when smart_injection_enabled = false, fall through to the legacy 140_000/120_000 literals as the safety net — so a user reporting a regression can flip back to pre-Phase-32 behavior without a rebuild"
    - "blade_status emit BEFORE the await pattern: app.emit('blade_status', 'compacting') fires synchronously, then the .await blocks; on return, app.emit('blade_status', 'processing') restores. UI sees 'compacting…' for the full duration of the cheap-model summary call without any tokio::spawn complexity (Option B per RESEARCH.md §CTX-04)"
    - "let _ = app.emit(...) wrapper: emit may fail in non-Tauri contexts (unit tests); wrapping with let _ = makes failures non-fatal"

key-files:
  created: []
  modified:
    - "src-tauri/src/commands.rs (+model_context_window helper, +compute_keep_recent helper, +build_compaction_summary_prompt helper, replaced 140k/120k literals with model-aware formulas, OpenHands v7610 prompt body, token-aware keep_recent wiring inside compress_conversation_smart, blade_status compacting emits at both trigger sites, 8 new unit tests)"

key-decisions:
  - "Synchronous compaction + status event (RESEARCH.md Option B). CONTEXT.md offered Option A (tokio::spawn for non-blocking compaction) as the preferred ideal. Option B chosen because (a) RESEARCH.md §CTX-04 explicitly green-lights it, (b) Option A requires Arc<Mutex<Vec<ConversationMessage>>> wrapping which is high-risk for THIS phase, (c) the indicator-before-await pattern surfaces the wait to the user without lying. Plan 33 (LOOP) is the natural home for true async migration. Decision recorded verbatim in this SUMMARY for future maintainers."
  - "Floor at 8_192 inside model_context_window. infer_capabilities falls back to CapabilityDefaults::all_false(8_192) for unknown providers, but the explicit floor inside model_context_window makes the contract grep-discoverable and protects against any future capability_probe change that might lower the default."
  - "Recovery path uses 0.65 (not config.context.compaction_trigger_pct again). The pre-loop trigger is 0.80; if compaction at 80% wasn't enough and the LLM still rejected for context length, the retry needs MORE headroom — so 0.65 is intentionally lower. Hardcoded for clarity (not a config knob) since this is an error-recovery path, not a tunable trigger."
  - "let smart = config.context.smart_injection_enabled inside the BLOCK that calls compress_conversation_smart, not at the function top. Keeps the toggle scope local; if a future plan adds a per-call override it can shadow `smart` without affecting the rest of send_message_stream_inline."
  - "blade_notification message includes the actual pre-compaction token count + the trigger budget so users see concrete numbers ('Compacting earlier conversation (~152340 tokens of 160000 budget)') rather than a vague spinner. Useful debug surface for Phase 37 EVAL when users report 'why did this take so long?'."
  - "Test naming kept under the phase32_compaction_trigger_* / phase32_compress_* prefixes so `cargo test --lib phase32` continues to be the canonical Phase 32 filter (29 phase32_ tests total now)."
  - "compute_keep_recent kept as pub(crate) — visible to commands::tests (same module) but not leaked across the lib boundary. build_compaction_summary_prompt also pub(crate). Mirrors the pattern Plan 32-02 established for build_test_conversation."

patterns-established:
  - "Pattern 1: Per-model threshold wrapper. model_context_window(provider, model) is the canonical call any future Phase 32+ code uses to ask 'how big is this model's context window?'. No more hardcoded literals scattered across commands.rs."
  - "Pattern 2: Pure-helper extraction for testable LLM-pipeline code. compress_conversation_smart was previously a single async fn that required mocking complete_turn to test. Now build_compaction_summary_prompt + compute_keep_recent are pure / sync / unit-testable; the async wrapper is a thin orchestration layer. Plan 32-05 (tool output cap) should follow the same pattern."
  - "Pattern 3: blade_status emit-before-await for any synchronous-but-slow operation. Surface the wait, then do the work. UX gets clarity, code stays simple. Plan 32-07 will mirror this for any operation it adds to the chat path."

requirements-completed: [CTX-03, CTX-04]

# Metrics
duration: ~172 min
completed: 2026-05-04
---

# Phase 32 Plan 32-04: Proactive Compaction Trigger Summary

**The 140k/120k literals in commands.rs are dead — every model now hits compaction at exactly 80% of its real context window, the cheap-summary call uses OpenHands' v7610 structured prompt, a 50k-token tool result in the recent-8 can't defeat compaction, and the UI gets a `blade_status: "compacting"` indicator before the await so users see the wait instead of a frozen interface.**

## Performance

- **Duration:** ~172 min wall-clock total (heavy on cargo recompile: 4m 20s first cargo check, 32s test compile delta, 1m 33s post-Task-2 test compile, 4m 51s final cargo check). Pure-edit time was ~25 min; the rest was waiting on the compiler.
- **Started:** 2026-05-03T22:09:42Z
- **Completed:** 2026-05-04T01:01:35Z
- **Tasks:** 2/2 complete (both type="auto" tdd="true")
- **Files modified:** 1 (`src-tauri/src/commands.rs`)
- **Tests added:** 8 unit tests, all green
- **LOC delta:** +259 / -20 = +239 net inside commands.rs

## Accomplishments

### Task 1 — Per-model trigger + blade_status indicator (commit `e2f220e`)

- **`model_context_window(provider, model) -> u32` helper landed.** Thin wrapper around `capability_probe::infer_capabilities(provider, model, None)` that returns just the 5th tuple element (context_window). Floors at 8_192 to guarantee a non-zero trigger for unknown provider/model pairs.
- **140k literal at the pre-tool-loop site replaced.** The trigger is now `(model_context_window(provider, model) as f32 * config.context.compaction_trigger_pct) as usize`. With the default 0.80 trigger pct:
  - Anthropic Sonnet 4 (200k) → 160_000 (was 70% of capacity, now 80%)
  - OpenAI GPT-4o (128k) → 102_400 (was 109% / NEVER fired, now 80%)
  - Groq Llama-3.3-70b (131k) → 104_857 (was 107% / NEVER fired, now 80%)
  - Gemini 2.5 Pro (2.097M) → 1_677_721 (was 6.7% / fired comically early, now 80%)
- **120k literal in the TruncateAndRetry recovery path replaced** with `model_context_window × 0.65`. Recovery path is the "already too big, the LLM rejected, retry with more headroom" branch — 65% (vs 80% trigger) gives the retry breathing room.
- **CTX-07 escape hatch honored.** When `smart_injection_enabled = false`, both sites fall through to the legacy 140k / 120k literals — bit-for-bit pre-Phase-32 behavior. Users reporting regressions can flip back without a rebuild.
- **`blade_status: "compacting"` emit landed at BOTH sites.** Before the `compress_conversation_smart().await` at the pre-tool-loop site (with a `blade_notification` that includes the actual pre-compaction token count and the budget). Also emitted in the TruncateAndRetry recovery branch. After the await returns, `blade_status: "processing"` restores the indicator.
- **Four `phase32_compaction_trigger_*` unit tests green:**
  - `phase32_compaction_trigger_anthropic_200k` — verifies 200k+ ctx for Claude Sonnet 4 + 80% = 160k+
  - `phase32_compaction_trigger_openai_128k` — verifies 100-200k ctx for gpt-4o + 80% trigger > 80k
  - `phase32_compaction_trigger_unknown_model_safe_default` — verifies floor ≥ 8192 for unknown providers
  - `phase32_compaction_trigger_pct_respects_config` — verifies linear scaling: 80%-65% = 15% delta of ctx_window

### Task 2 — OpenHands v7610 prompt + token-aware keep_recent (commit `319128e`)

- **`build_compaction_summary_prompt(events: &[String]) -> String` extracted as `pub(crate)`.** Contains the verbatim OpenHands PR #7610 structured prompt — USER_CONTEXT / COMPLETED / PENDING / CURRENT_STATE / CODE_STATE / TESTS / CHANGES / DEPS / INTENT / VC_STATUS sections. Replaces the previous "summarize in 3-6 sentences" generic prompt.
- **`compute_keep_recent(conversation, max_messages, token_budget) -> usize` extracted as `pub(crate)`.** Bounds the recent-suffix by BOTH message count AND token budget. Floors at 2 so the most-recent exchange is always preserved. System messages are not "recent" (counted as 0 tokens). UserWithImage adds +250 tokens for the image payload.
- **`compress_conversation_smart` body wired to both helpers.** `keep_recent = compute_keep_recent(conversation, 8, KEEP_RECENT_TOKEN_BUDGET)` replaces the old `let keep_recent = 8usize`. `summary_prompt = build_compaction_summary_prompt(&to_compress)` replaces the inline format!. Existing CTX-07 fallback (`truncate_to_budget` on cheap-model summary failure) preserved verbatim — Plan 32-07 wraps it in panic-resistance, this plan doesn't change it.
- **Four `phase32_compress_*` unit tests green:**
  - `phase32_compress_summary_prompt_includes_v7610_keys` — verifies USER_CONTEXT / COMPLETED / PENDING / CURRENT_STATE / CODE_STATE all present + events interpolated
  - `phase32_compress_keep_recent_normal_case` — 20-turn conversation, 8-message cap fires before 16k-token budget
  - `phase32_compress_keep_recent_token_aware` — 7 normal + 1 huge 100k-char tool message, the huge message alone (~25k tokens) exceeds 16k budget so keep_recent bottoms at .max(2) floor
  - `phase32_compress_keep_recent_floor` — tiny conversation, floor of 2 enforced

## `infer_capabilities` Signature Confirmed

Per RESEARCH.md note that the signature might differ from the simple 2-arg form — verified at `src-tauri/src/capability_probe.rs:177-181`:

```rust
pub fn infer_capabilities(
    provider: &str,
    model: &str,
    ctx_window_from_api: Option<u32>,
) -> (bool, bool, bool, bool, u32);
```

Plan 32-04's `model_context_window` calls with `ctx_window_from_api: None` — the live-API override is reserved for Plan 11-03 wiring (not this phase's concern).

## Trigger Values Computed for the Four Major Providers (default 0.80)

| Provider | Model                       | Context Window | Trigger (×0.80) | Pre-Phase-32 status |
| -------- | --------------------------- | -------------- | --------------- | ------------------- |
| anthropic | claude-sonnet-4            | 200_000        | 160_000         | 70% — too eager     |
| anthropic | claude-haiku-4-5           | 200_000        | 160_000         | 70% — too eager     |
| openai    | gpt-4o                     | 128_000        | 102_400         | 109% — NEVER fired  |
| openai    | gpt-4o-mini                | 128_000        | 102_400         | 109% — NEVER fired  |
| openai    | gpt-5                      | 400_000        | 320_000         | 35% — too eager     |
| groq      | llama-3.3-70b-versatile    | 131_072        | 104_857         | 107% — NEVER fired  |
| openrouter | claude (default match)    | 200_000        | 160_000         | 70% — too eager     |
| openrouter | :free (default match)     | 8_192          | 6_553           | 1709% — NEVER fired |
| gemini    | gemini-2.5-pro             | 2_097_152      | 1_677_721       | 6.7% — way too early |
| gemini    | gemini-2.0-flash           | 1_048_576      | 838_860         | 13.4% — way too early |
| custom    | (any) / unknown            | 8_192          | 6_553           | (varied)            |

The 140_000 literal was wrong for every model except 175k-context Anthropic legacy; this plan fixes all of them.

## Async vs Sync Decision (RESEARCH.md Option B)

**Synchronous compaction + status event chosen** (Option B per RESEARCH.md §CTX-04 explicit green-light + CONTEXT.md "either option satisfies the lock").

Rationale (recorded for future maintainers):

1. **Option A risk:** wrapping `conversation: Vec<ConversationMessage>` in `Arc<Mutex<>>` would touch every call site in `send_message_stream_inline` (line 779-2400 — heavy refactor). High blast radius for a phase whose strict-dependency-root status means "don't break the chat path".
2. **Option B sufficiency:** `let _ = app.emit("blade_status", "compacting");` BEFORE the `.await` surfaces the wait synchronously. The cheap-model summary call typically returns in 2-5s. UX cost: a brief "compacting…" spinner. Worse than Option A but functionally non-breaking.
3. **Migration path:** Plan 33 (LOOP) restructures the iteration loop and is the natural home for true async compaction. CONTEXT.md explicitly defers Option A migration to that phase.

The status event fires at BOTH compaction call sites:
- Pre-tool-loop trigger (commands.rs:1500–1540 region)
- TruncateAndRetry recovery path (commands.rs:1577–1592 region)

After `.await` returns, `blade_status: "processing"` restores so subsequent stream events show the right indicator.

## Plan 32-07 Flag-On

The existing `truncate_to_budget` fallback at commands.rs:264 (inside `compress_conversation_smart`) is already the core CTX-07 backstop for compaction — when the cheap-model summary call returns Err, the function silently calls `truncate_to_budget(conversation, max_tokens)` and returns. This plan PRESERVES that path verbatim — no change to the fallback shape.

What Plan 32-07 ADDS on top:
- A panic-resistance wrapper (`std::panic::catch_unwind` or equivalent) around the entire compress_conversation_smart call, so even a panic inside the body falls through to the truncation path.
- A regression test that injects a panic via `CTX_SCORE_OVERRIDE` (the Plan 32-02 substrate) and asserts chat survives.
- The runtime UAT (dev binary, screenshots, end-to-end "trigger compaction → confirm UI shows indicator → conversation continues" round-trip per CONTEXT.md §Testing & Verification step 5).

## Acceptance Grep Verification

```
$ grep -c "fn model_context_window" src-tauri/src/commands.rs            → 1
$ grep -c "compaction_trigger_pct"   src-tauri/src/commands.rs            → 3
$ grep -c "infer_capabilities"        src-tauri/src/commands.rs            → 2
$ grep -c "140_000"                   src-tauri/src/commands.rs            → 1   (legacy fallback path only)
$ grep -c "120_000"                   src-tauri/src/commands.rs            → 1   (legacy fallback path only)
$ grep -ic '"compacting"|blade_status.*compacting' src-tauri/src/commands.rs → 2
$ grep -c "fn build_compaction_summary_prompt" src-tauri/src/commands.rs → 1
$ grep -c "fn compute_keep_recent"      src-tauri/src/commands.rs            → 1
$ grep -c "USER_CONTEXT\|COMPLETED\|PENDING\|CURRENT_STATE\|CODE_STATE" src-tauri/src/commands.rs → 7
$ grep -c "KEEP_RECENT_TOKEN_BUDGET"   src-tauri/src/commands.rs            → 3
```

All criteria met. The remaining `140_000` / `120_000` lines are the `if !smart` legacy branches (CTX-07 escape hatch) — exactly as the orchestrator's constraints allowed.

## Test Results

```
$ cargo test --lib phase32 → 29 passed, 0 failed (21 from 32-01/32-02/32-03 + 8 new from 32-04)

  brain::tests::phase32_breakdown_clears_each_call          ok
  brain::tests::phase32_breakdown_records_per_section       ok
  brain::tests::phase32_breakdown_simple_query_omits_vision ok
  brain::tests::phase32_context_breakdown_default           ok
  brain::tests::phase32_context_breakdown_serializes        ok
  brain::tests::phase32_score_hearing_high                  ok
  brain::tests::phase32_score_identity_high                 ok
  brain::tests::phase32_score_identity_low                  ok
  brain::tests::phase32_score_override_can_panic_safely     ok
  brain::tests::phase32_score_override_default_passthrough  ok
  brain::tests::phase32_score_override_returns_fixed_value  ok
  brain::tests::phase32_score_unknown_type_returns_zero     ok
  brain::tests::phase32_score_vision_high                   ok
  brain::tests::phase32_score_vision_low                    ok
  brain::tests::phase32_section_gate_always_keep_core_present  ok
  brain::tests::phase32_section_gate_simple_query           ok
  commands::tests::phase32_build_test_conversation_shape    ok
  commands::tests::phase32_build_test_conversation_token_aware ok
  commands::tests::phase32_compaction_trigger_anthropic_200k  ok  (NEW)
  commands::tests::phase32_compaction_trigger_openai_128k     ok  (NEW)
  commands::tests::phase32_compaction_trigger_pct_respects_config ok  (NEW)
  commands::tests::phase32_compaction_trigger_unknown_model_safe_default ok  (NEW)
  commands::tests::phase32_compress_keep_recent_floor       ok  (NEW)
  commands::tests::phase32_compress_keep_recent_normal_case ok  (NEW)
  commands::tests::phase32_compress_keep_recent_token_aware ok  (NEW)
  commands::tests::phase32_compress_summary_prompt_includes_v7610_keys ok  (NEW)
  config::tests::phase32_context_config_default_values      ok
  config::tests::phase32_context_config_missing_in_disk_uses_defaults ok
  config::tests::phase32_context_config_round_trip          ok

test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured
```

`cargo check` exits 0 (3 pre-existing warnings unchanged: `ToolCallTrace.timestamp_ms`, `process_reports_for_test`, `enable_dormancy_stub`).

## Task Commits

Each task committed atomically with conventional-commit messaging.

1. **Task 1: per-model trigger + blade_status compacting** — `e2f220e` (feat)
2. **Task 2: OpenHands v7610 prompt + token-aware keep_recent** — `319128e` (feat)

(STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction. This summary is the final docs commit's content.)

## Files Created/Modified

- `src-tauri/src/commands.rs` — three new helpers (`model_context_window`, `compute_keep_recent`, `build_compaction_summary_prompt`); two literal call sites replaced (140k pre-loop trigger, 120k recovery trigger); compress_conversation_smart body rewired to use the new helpers; `blade_status: "compacting"` emit at both sites; eight new `phase32_*` unit tests appended to existing `mod tests`.

## Decisions Made

(Documented in `key-decisions:` frontmatter above. Headlines:)

- Synchronous compaction + status event (Option B) — chosen over Option A (`tokio::spawn`) because state-ownership refactor is high-risk for a strict-dependency-root phase. Option A migration deferred to Phase 33 (LOOP).
- 0.65 hardcoded for the recovery path (not a config knob) — error-recovery is not a tunable trigger.
- Helpers as `pub(crate)` — visible to commands::tests, not leaked across the lib boundary.
- `let _ = app.emit(...)` wrapping — emit may fail in non-Tauri contexts (unit tests); wrapping makes failures non-fatal.
- 140k / 120k literals kept as the `if !smart` branch — orchestrator's constraint loosens the plan's "0 literals" to "≤1 (legacy fallback path acceptable)". The CTX-07 escape hatch is the documented fallback contract.

## Deviations from Plan

**One minor deviation (Rule 3 — auto-fix blocking):**

**1. [Rule 3 - Constraint adaptation] Kept 140k/120k literals as the `if !smart` legacy fallback branch**
- **Found during:** Task 1 implementation (orchestrator's constraints take precedence over plan's strict acceptance criteria).
- **Issue:** The plan's `<acceptance_criteria>` says `grep -c "140_000" → 0` and `grep -c "120_000" → 0` (literals fully removed). The orchestrator's `<critical_constraints>` and `<acceptance_criteria_recap>` allow `≤1 (the legacy fallback path; you may keep it as the `if !smart` branch)`.
- **Fix:** Implemented the model-aware threshold inside an `if smart { ... } else { 140_000 }` (and `else { 120_000 }` for the recovery path). When the user toggles `smart_injection_enabled = false`, the legacy literals fire — exactly the CTX-07 escape hatch contract that 32-CONTEXT.md specifies.
- **Files modified:** `src-tauri/src/commands.rs` (the two call sites only).
- **Verification:** Grep counts down to 1 each (legacy branch only); all 29 phase32 tests pass; cargo check clean.
- **Committed in:** `e2f220e` (Task 1 commit).

This isn't behavioral deviation from the plan's INTENT — the plan's `<critical_constraints>` (above the action body) explicitly says "if disabled, skip the new 80% trigger and use the legacy 140k literal as the safety net". The acceptance criteria undercount the trade-off; the orchestrator caught it in the recap.

**2. [Rule 1 - Test naming] Test names use `phase32_compress_*` prefix instead of plan's `phase32_compress_keeps_endpoints` / `falls_back_when_summary_call_fails`**
- **Found during:** Task 2 test draft.
- **Issue:** The plan's `<behavior>` block lists 4 tests including `phase32_compress_keeps_endpoints` and `phase32_compress_falls_back_when_summary_call_fails`. The plan's `<action>` Step C explicitly says "the 'fallback to truncate_to_budget when summary call fails' test belongs in Plan 32-07 — DO NOT duplicate here" and recommends extracting `compute_keep_recent` to test pure logic without network calls.
- **Fix:** Followed Step C's pragmatic alternative — extracted helpers, tested them directly. Test names: `phase32_compress_summary_prompt_includes_v7610_keys`, `phase32_compress_keep_recent_normal_case`, `phase32_compress_keep_recent_token_aware`, `phase32_compress_keep_recent_floor`. Names match the spirit of the plan's `<behavior>` block while staying inside the pure-helper testing surface that Step C blessed.
- **Files modified:** `src-tauri/src/commands.rs` (test bodies only).
- **Verification:** All 4 tests pass; the 5 v7610 keys (USER_CONTEXT / COMPLETED / PENDING / CURRENT_STATE / CODE_STATE) all asserted; both keep_recent edge cases (8-message cap + 16k-token cap + .max(2) floor) covered.
- **Committed in:** `319128e` (Task 2 commit).

This is a test-naming alignment, not a behavioral deviation — the plan's `<action>` Step C explicitly authorized this approach.

---

**Total deviations:** 2 (both minor — constraint adaptation + test naming alignment, both authorized by the plan/orchestrator)
**Impact on plan:** Zero scope creep. Production behavior exactly as planned. CTX-07 escape hatch contract preserved (the deviation strengthens it).

## Issues Encountered

- **Cargo recompile latency.** Three full cycles dominated wall-clock: first cargo check 4m 20s, Task 1 test compile delta 32s (warm), Task 2 test compile 1m 33s (warm-after-helper-additions), final cargo check 4m 51s. CLAUDE.md's "batch first, check at end" guidance was honored — only one cargo invocation per gate.
- **No regressions from Wave 0/1 tests.** All 21 prior phase32_* tests still green; 4 new trigger tests + 4 new compress tests all green (29 total).
- **Cargo test --lib (full) status:** not re-run as part of this plan since the Plan 32-03 SUMMARY notes the same 17 pre-existing flakes (db / dream_mode / evals / router / safety_bundle / skills / phase24_e2e_tests) that are unrelated to this plan's surface (commands.rs compaction trigger + summary prompt). Plan 32-07's UAT is the natural place to validate end-to-end on the running binary.

## User Setup Required

None — pure Rust logic changes inside `commands.rs`. Defaults: `smart_injection_enabled = true`, `compaction_trigger_pct = 0.80` (already wired by Plan 32-01). Existing user `~/.blade/config.json` files migrate transparently — `#[serde(default)]` on the `context` field plus per-sub-field defaults mean a config without a `"context"` key still loads with the new defaults.

## Next Phase Readiness

**Wave 2 plans can now mount on this trigger:**

- **Plan 32-05 (tool output cap)** — independent surface in `commands.rs` (cap_tool_output helper at native + MCP branches). Does NOT depend on this plan; can proceed in parallel.
- **Plan 32-06 (DoctorPane dashboard)** — exposes `ContextBreakdown` via the `get_context_breakdown` Tauri command. Reads `model_context_window` (Plan 32-04's helper) for the percent_used calculation. Direct dependency.
- **Plan 32-07 (fallback fixture + runtime UAT)** — DIRECTLY consumes this plan. Will:
  - Wrap `compress_conversation_smart` in panic-resistance (catch_unwind around the cheap-model call)
  - Add a regression test that injects a panic via `CTX_SCORE_OVERRIDE` and asserts chat survives
  - Run the runtime UAT (dev binary, screenshots, "trigger compaction → confirm UI shows the indicator → conversation continues" — CONTEXT.md §Testing & Verification step 5)
  - Validate the `blade_status: "compacting"` emit actually surfaces in the UI when the trigger fires (UAT round-trip on the running binary, not just unit tests)

**No blockers.** STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction.

## Threat Flags

None — no new network, auth, file-access, or schema surface introduced. The threat register entries (`T-32-08` DoS via zero trigger, `T-32-09` DoS via pathological recent message, `T-32-10` cheap-model summary content disclosure) are addressed by the `model_context_window` floor at 8_192, the `compute_keep_recent` 16k token budget, and the pre-existing `cheap_model_for_provider` routing (no new disclosure).

## Self-Check: PASSED

Verified post-summary:

- File `src-tauri/src/commands.rs` exists and contains:
  - `pub fn model_context_window` (FOUND, count = 1)
  - `pub(crate) fn compute_keep_recent` (FOUND, count = 1)
  - `pub(crate) fn build_compaction_summary_prompt` (FOUND, count = 1)
  - `compaction_trigger_pct` (FOUND, count = 3)
  - `KEEP_RECENT_TOKEN_BUDGET` (FOUND, count = 3)
  - `USER_CONTEXT` etc. v7610 keys (FOUND, count = 7)
  - `"compacting"` blade_status emit (FOUND, count = 2)
  - 140_000 / 120_000 (FOUND, count = 1 each — legacy fallback paths only)
- Commit `e2f220e` exists in `git log` (FOUND, "feat(32-04): per-model compaction trigger + blade_status compacting indicator (CTX-04)")
- Commit `319128e` exists in `git log` (FOUND, "feat(32-04): OpenHands v7610 summary prompt + token-aware keep_recent (CTX-03)")
- All 29 phase32_* tests green (`cargo test --lib phase32` → 29 passed, 0 failed)
- `cargo check` exits 0 (3 pre-existing warnings unchanged)
- No file deletions in either task commit
- STATE.md and ROADMAP.md NOT modified by this executor (orchestrator's responsibility)

---
*Phase: 32-context-management*
*Completed: 2026-05-04*
