---
phase: 32-context-management
plan: 5
subsystem: chat-pipeline
tags: [commands, tool-output-cap, cap-tool-output, format-tool-result, ctx-05, rust, tauri]

# Dependency graph
requires:
  - phase: 32-01
    provides: "ContextConfig.tool_output_cap_tokens (default 4000) + ContextConfig.smart_injection_enabled (CTX-07 escape hatch) — Plan 32-05 reads both at the cap site"
  - phase: 32-02
    provides: "build_test_conversation fixture + commands::tests module scaffold — Plan 32-05 appends 7 new unit tests to that mod"
  - phase: 32-04
    provides: "compress_conversation_smart token-aware keep_recent + cheap-summary helpers + commands.rs ergonomic baseline — Plan 32-05 sits independently in the same file"
provides:
  - "pub struct ToolOutputCap { content, storage_id, original_tokens } in commands.rs"
  - "pub fn cap_tool_output(content, budget_tokens) -> ToolOutputCap — head ~75% + truncation marker + tail ~12.5%, universal pattern (Claude Code Bash + OpenHands + OpenClaw)"
  - "MAX_TOOL_RESULT_CHARS raised from 12_000 → 200_000 — format_tool_result is now a SAFETY net for multi-MB pathological outputs only; the 4000-token per-message budget lives in cap_tool_output"
  - "Wiring at the canonical happy-path conversation.push site (commands.rs ~2515) — covers BOTH native and MCP tool branches because both flow through the same (content, is_error) destructure"
  - "log::info!('[CTX-05] tool {} output capped: ~N → ~M tokens (storage_id ...)') — gives Phase 37 EVAL a concrete signal for capped-output frequency"
  - "CTX-07 escape hatch: when smart_injection_enabled = false, content passes through unchanged (legacy 12k → 200k path)"
  - "Seven new phase32_* unit tests green: 5 cap_tool_output + 2 format_tool_result. Total phase32 count now 36 (29 prior + 7 new)."
affects: [32-06-context-breakdown-dashboard, 32-07-fallback-fixture]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — pure logic changes on existing chrono + safe_slice + config substrate
  patterns:
    - "Insertion-site cap pattern: `let content = if smart { cap_tool_output(&content, budget).content } else { content };` immediately before conversation.push. Runs LAST so all enrichment (explain_tool_failure, immune-system rewrites) is included in the cap accounting."
    - "Single canonical insertion point covers both branches: native and MCP tool calls flow into the same `let (mut content, is_error) = ...` destructure, then a single conversation.push at line 2515. The cap-then-push pair is wired once; both branches get the cap automatically."
    - "Safety-net + budget-enforcer separation: format_tool_result keeps a 200k char ceiling (catches multi-MB pathological outputs) while cap_tool_output enforces the real 4k-token budget. Two layers, each doing one job."
    - "head + tail + storage_id marker: the truncation marker text is `[truncated from N tokens; ~M omitted in middle; storage_id tool_out_<ts>]` — grep-discoverable across the codebase ('[truncated from' is the canonical sigil)."
    - "log::info! at the cap site: emits when (and only when) truncation happens. Original token count + capped token count + storage_id all logged. Useful debug signal for Phase 37 EVAL ('how often does cap_tool_output fire?') without spamming logs in the common (under-budget) case."

key-files:
  created: []
  modified:
    - "src-tauri/src/commands.rs (+ ToolOutputCap struct, + cap_tool_output helper, MAX_TOOL_RESULT_CHARS 12_000 → 200_000, + 4-line cap-then-push wiring at line 2515, + log::info!('[CTX-05]') line, + 7 unit tests appended to commands::tests mod)"

key-decisions:
  - "Choice (a) — raise MAX_TOOL_RESULT_CHARS to 200_000 — chosen over choice (b) — call cap_tool_output before format_tool_result. Rationale: choice (a) is a one-line constant change with zero refactor, and lets format_tool_result keep its existing role as a safety net. Choice (b) would require restructuring the (content, is_error) destructure to separate the format step from the truncation step; high blast radius for marginal benefit. Choice (a) is also what RESEARCH.md recommended verbatim ('raise format_tool_result's cap to ~200k chars and let cap_tool_output enforce the actual 4k-token budget')."
  - "Cap wired at line 2515 (the post-dispatch happy-path push), NOT at the four earlier short-circuit pushes (2203 schema-validation error, 2236 risk-blocked, 2323 user-denied, 2341 symbolic-policy-blocked). Those four sites push hardcoded short error strings (≤80 chars each); capping them is a no-op. Centralising on one site keeps the wiring grep-discoverable and the log signal clean."
  - "log::info! (not log::warn or log::debug) — capping is normal operation when bash spits 50k chars; log::warn would be noisy; log::debug would hide the signal from Phase 37 EVAL. log::info is the right level: visible in default config, not alarming."
  - "McpToolResult / McpContent constructed directly in tests (no Default impl needed). Both structs have fully public fields (content_type, text, content, is_error). The make_mcp_result helper in commands::tests builds them inline with the two required fields. RESEARCH.md flagged this as a possible blocker; it wasn't — both types are constructible from outside the mcp module without any pub(crate) helper indirection."
  - "tail computation uses char_indices().nth(skip_chars) — robust against multi-byte UTF-8 (emoji-only inputs hit the non-ASCII safety test). Fallback to empty tail if char_indices boundary computation returns None (defensive; never observed in practice)."
  - "storage_id format: 'tool_out_{millis}'. Uses chrono::Utc::now() (already imported at commands.rs:173 — no new use stmt needed). Phase 33+ reach-back is the natural place to wire this id into a SQLite tool_output_archive table; Phase 32 only generates the id as a marker that truncation occurred."
  - "CTX-07 escape hatch as `if config.context.smart_injection_enabled { ... } else { content }` (let-binding shadowing). Keeps the toggle scope local to the cap-then-push pair; the rest of the tool loop is unaffected by the flag."

patterns-established:
  - "Pattern 1: insertion-site capping. Any future plan adding a new conversation.push site for tool/large-content messages should wire cap_tool_output immediately before the push (not inside the producer). Producers can return arbitrarily large strings; the cap is a uniform boundary."
  - "Pattern 2: safety net + budget enforcer. format_tool_result's 200k ceiling and cap_tool_output's 4k-token budget are two separate layers. The ceiling protects against pathological multi-MB outputs (memory pressure); the budget enforces per-message token economy (LLM context). Future changes to either should preserve the separation."
  - "Pattern 3: '[truncated from' marker as canonical sigil. Anywhere in the codebase that needs to detect 'this content was truncated by Phase 32', grep '\\[truncated from' is the discoverable signal. Don't invent new marker strings."

requirements-completed: [CTX-05]

# Metrics
duration: ~12 min  # Task 1 already implemented (just commit + verify), Task 2 was the actual edit work
completed: 2026-05-04
---

# Phase 32 Plan 32-05: Tool Output Cap Summary

**`cap_tool_output(content, budget_tokens)` is wired at the canonical conversation-insertion site, `MAX_TOOL_RESULT_CHARS` is raised from 12_000 to 200_000 so format_tool_result no longer drops tails before the budget enforcer can see them, and a 50k-char bash output now yields ~14k chars in the conversation (head + marker + tail) instead of 12k chars (head only).**

## Performance

- **Duration:** ~12 min wall-clock for the edits + grep verification. Test/check runs dominated wall time (10m 31s for cargo test, 3m 37s for cargo check — both single invocations per CLAUDE.md "batch first" guidance).
- **Started:** 2026-05-04T01:23:40Z (per orchestrator START_TIME)
- **Completed:** 2026-05-04 (this commit)
- **Tasks:** 2/2 complete (Task 1 was already implemented & uncommitted from a prior session — verified passing, committed; Task 2 was the active edit work)
- **Files modified:** 1 (`src-tauri/src/commands.rs`)
- **Tests added:** 7 unit tests, all green (5 cap_tool_output + 2 format_tool_result)
- **LOC delta:** Task 1 = +179 / Task 2 = +81 / -1 = +259 net inside commands.rs

## Accomplishments

### Task 1 — `cap_tool_output` helper + `ToolOutputCap` struct (commit `719b497`)

- **`pub struct ToolOutputCap { content, storage_id, original_tokens }` landed.** content is the (possibly truncated) string destined for the conversation; storage_id is `Some(tool_out_<millis>)` when truncation occurred, None otherwise; original_tokens is the chars/4 estimate of the untruncated input.
- **`pub fn cap_tool_output(content: &str, budget_tokens: usize) -> ToolOutputCap` landed.** Under-budget passes through unchanged with storage_id=None. Over-budget returns head (~75% of budget chars) + marker + tail (~12.5% of budget chars). All char-based slicing routes through `crate::safe_slice` (head) or `char_indices().nth()` (tail) — no raw `&content[..n]`.
- **Five unit tests appended to `commands::tests`:**
  - `phase32_cap_tool_output_under_budget_passthrough` — 30-char input passes through, storage_id=None, original_tokens<50
  - `phase32_cap_tool_output_over_budget_truncates` — 50k-char input → <20k chars output, contains "[truncated from", storage_id is Some
  - `phase32_cap_tool_output_preserves_head_and_tail` — content with HEAD_MARKER_X at start and TAIL_MARKER_Z at end keeps BOTH after capping (the v1.1 lesson encoded as a regression test)
  - `phase32_cap_tool_output_non_ascii_safe` — 20_000 fire emojis (~80k bytes, ~20k chars) does NOT panic; truncation marker present in output
  - `phase32_cap_tool_output_storage_id_when_truncated` — small input None, big input Some; id starts with "tool_out_"

Task 1's code was already present (from a prior uncommitted session) when this orchestrator picked up the plan. Verified passing (5/5 green) before committing as a discrete atomic commit per the plan's structure.

### Task 2 — Wire cap + raise MAX_TOOL_RESULT_CHARS (commit `20f842f`)

- **`MAX_TOOL_RESULT_CHARS` raised from 12_000 to 200_000.** Old behavior silently truncated bash output tails before the cap could see them — a 50k-char build error ending in the actual error message lost that error. New behavior: format_tool_result is a safety net for multi-MB pathological outputs only. Comment block at the constant explains the new role.
- **Cap wired at the canonical happy-path tool insertion site (commands.rs:2515 region).** The four earlier short-circuit pushes (2203 schema-validation, 2236 risk-blocked, 2323 user-denied, 2341 symbolic-policy-blocked) are exempt because they push hardcoded short error strings ≤80 chars; capping them is a no-op. The single insertion point covers BOTH native and MCP tool branches because both flow through the same `let (mut content, is_error) = ...` destructure before reaching the push.
- **CTX-07 escape hatch.** When `config.context.smart_injection_enabled = false`, the cap is bypassed and content passes through unchanged (legacy path; format_tool_result's new 200k ceiling still applies as the safety net, but no head/tail/marker shape is imposed).
- **`log::info!("[CTX-05] tool '{}' output capped: ~{} → ~{} tokens (storage_id {})")`.** Fires only when truncation happens (not when content fits under budget). Gives Phase 37 EVAL a concrete signal for capped-output frequency without spamming default-config logs.
- **Two new format_tool_result regression tests:**
  - `phase32_format_tool_result_no_longer_truncates_at_12k` — 50_000-char input produces ≥30_000-char output (passes through; cap_tool_output is now the budget enforcer)
  - `phase32_format_tool_result_still_caps_at_safety_ceiling` — 500_000-char input bounded at ≤250_000 chars (200k ceiling + ~80 chars marker)

## Insertion Site Chosen

The cap is wired at exactly one location:

```
commands.rs ~2515 (in send_message_stream_inline's tool loop):

    // … (post-dispatch enrichment: explain_tool_failure, immune system, prefrontal record_step)
    // … (knowledge graph fire-and-forget, turn_acc.record_tool_call, tool_forge.record_tool_use)

    // Phase 32 Plan 32-05 / CTX-05 — cap the tool output at the configured
    // per-message budget BEFORE inserting into the conversation. Cap runs
    // LAST so any upstream enrichment is included in the cap accounting.
    // CTX-07 escape hatch: smart_injection_enabled = false → unchanged.
    let content = if config.context.smart_injection_enabled {
        let _capped = cap_tool_output(&content, config.context.tool_output_cap_tokens);
        if _capped.storage_id.is_some() {
            log::info!(
                "[CTX-05] tool '{}' output capped: ~{} → ~{} tokens (storage_id {})",
                tool_call.name,
                _capped.original_tokens,
                _capped.content.chars().count() / 4,
                _capped.storage_id.as_deref().unwrap_or("?"),
            );
        }
        _capped.content
    } else {
        content
    };

    conversation.push(ConversationMessage::Tool {
        tool_call_id: tool_call.id,
        tool_name: tool_call.name,
        content,
        is_error,
    });
```

This is the SINGLE canonical happy-path push for tool messages. Both native (`crate::native_tools::execute(...)`) and MCP (`format_tool_result(&r)`) branches flow into the same `(mut content, is_error)` destructure earlier, run through enrichment (`explain_tool_failure` for native errors at line 2431, prefrontal/knowledge-graph/turn-accumulator at lines 2447–2491), then arrive at the wire site as a single `content: String`. The cap re-binds `content` (immutably) to the capped version, then the push consumes it.

## format_tool_result Landmine — Resolution Choice

Resolved per **choice (a)** from RESEARCH.md landmine #9: **raise `MAX_TOOL_RESULT_CHARS` from 12_000 → 200_000** and let `cap_tool_output` enforce the real per-message budget at the insertion site.

The alternative (choice (b) — call `cap_tool_output` BEFORE `format_tool_result`) would have required restructuring the `(content, is_error)` destructure to separate the McpToolResult unwrap from the truncation step. Choice (a) is a one-line constant change with zero refactor, and preserves format_tool_result's existing role as a safety net. RESEARCH.md explicitly recommended this option ("raise format_tool_result's cap to ~200k chars and let cap_tool_output enforce the actual 4k-token budget") — followed verbatim.

## McpToolResult Constructibility Outcome

Both `McpToolResult` and `McpContent` (mcp.rs:84–95) have fully public fields and are directly constructible from `commands::tests`. No `pub(crate)` helper inside the mcp module was needed. The test fixture lives inside `commands::tests`:

```rust
fn make_mcp_result(text: &str, is_error: bool) -> crate::mcp::McpToolResult {
    crate::mcp::McpToolResult {
        content: vec![crate::mcp::McpContent {
            content_type: "text".to_string(),
            text: Some(text.to_string()),
        }],
        is_error,
    }
}
```

Both `phase32_format_tool_result_*` tests landed and pass. RESEARCH.md flagged this as a possible blocker; it wasn't.

## Token Cost — Same Input Before vs After

50_000-char "x" repeated string (~12_500 tokens):

| Path                                         | Output chars | Output tokens (chars/4) | Tail preserved? |
| -------------------------------------------- | ------------ | ----------------------- | --------------- |
| Old format_tool_result (12k cap)             | ~12_050      | ~3_012                  | NO — head only  |
| New format_tool_result (200k cap, no further capping) | 50_000     | 12_500                  | YES — full passthrough below 200k |
| New format_tool_result + cap_tool_output (4k budget) | ~14_150* | ~3_537                  | YES — head 12k + marker ~150 + tail 2k |

*Approximation: head_chars = 4000 × 4 × 0.75 = 12_000, tail_chars = 4000 × 4 × 0.125 = 2_000, marker ~150 chars (timestamp-dependent). Verified by `phase32_cap_tool_output_over_budget_truncates` (asserts `result.len() < 20_000`).

The old path lost the entire tail. The new path preserves both ends, identifying truncation explicitly with a marker that names the original token count and the omitted-token count. Critical bash error messages at the END of long outputs are no longer dropped.

## Acceptance Grep Verification

```
$ grep -c "fn cap_tool_output"            src-tauri/src/commands.rs    → 1
$ grep -c "tool_output_cap_tokens"        src-tauri/src/commands.rs    → 2
$ grep -c "\[truncated from"               src-tauri/src/commands.rs    → 3
$ grep -c "MAX_TOOL_RESULT_CHARS: usize = 200_000" src-tauri/src/commands.rs → 1
$ grep -c "MAX_TOOL_RESULT_CHARS: usize = 12_000"  src-tauri/src/commands.rs → 0
$ grep -c "\[CTX-05\] tool"                src-tauri/src/commands.rs    → 1
$ grep -c "pub struct ToolOutputCap"       src-tauri/src/commands.rs    → 1
$ grep -c "cap_tool_output(&content"       src-tauri/src/commands.rs    → 2  (one production + one test reference via the over_budget_truncates closure)
```

All criteria met.

## Test Results

```
$ cd /home/arnav/blade/src-tauri && cargo test --lib phase32 → 36 passed, 0 failed (29 prior + 7 new)

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
  commands::tests::phase32_cap_tool_output_non_ascii_safe   ok  (NEW)
  commands::tests::phase32_cap_tool_output_over_budget_truncates ok  (NEW)
  commands::tests::phase32_cap_tool_output_preserves_head_and_tail ok  (NEW)
  commands::tests::phase32_cap_tool_output_storage_id_when_truncated ok  (NEW)
  commands::tests::phase32_cap_tool_output_under_budget_passthrough ok  (NEW)
  commands::tests::phase32_compaction_trigger_anthropic_200k  ok
  commands::tests::phase32_compaction_trigger_openai_128k     ok
  commands::tests::phase32_compaction_trigger_pct_respects_config ok
  commands::tests::phase32_compaction_trigger_unknown_model_safe_default ok
  commands::tests::phase32_compress_keep_recent_floor       ok
  commands::tests::phase32_compress_keep_recent_normal_case ok
  commands::tests::phase32_compress_keep_recent_token_aware ok
  commands::tests::phase32_compress_summary_prompt_includes_v7610_keys ok
  commands::tests::phase32_format_tool_result_no_longer_truncates_at_12k ok  (NEW)
  commands::tests::phase32_format_tool_result_still_caps_at_safety_ceiling ok  (NEW)
  config::tests::phase32_context_config_default_values      ok
  config::tests::phase32_context_config_missing_in_disk_uses_defaults ok
  config::tests::phase32_context_config_round_trip          ok

test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 464 filtered out; finished in 22.41s
```

`cargo check` exits 0 (3 pre-existing warnings unchanged from Plan 32-04: `ToolCallTrace.timestamp_ms`, `process_reports_for_test`, `enable_dormancy_stub`).

## Task Commits

Each task committed atomically with conventional-commit messaging (single-repo, no Co-Authored-By per CLAUDE.md):

1. **Task 1: cap_tool_output helper + ToolOutputCap struct** — `719b497` (feat)
2. **Task 2: wire cap + raise MAX_TOOL_RESULT_CHARS to 200k** — `20f842f` (feat)

(STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction. This summary is the final docs commit's content.)

## Files Created/Modified

- `src-tauri/src/commands.rs` — new ToolOutputCap struct + cap_tool_output helper (+91 LOC); MAX_TOOL_RESULT_CHARS constant raised from 12_000 to 200_000 with explanatory comment; 4-line cap-then-push wiring at the canonical happy-path tool insertion site (line 2515 region) with CTX-07 escape hatch + log::info! signal; 7 unit tests appended to `commands::tests` (5 cap_tool_output + make_mcp_result helper + 2 format_tool_result regression tests).

## Decisions Made

(Documented in `key-decisions:` frontmatter above. Headlines:)

- Choice (a) — raise MAX_TOOL_RESULT_CHARS to 200_000 — chosen over choice (b) — call cap_tool_output before format_tool_result. One-line constant change, zero refactor, RESEARCH.md verbatim recommendation.
- Cap wired at line 2515 (canonical happy-path push), NOT at the four earlier short-circuit pushes (those push ≤80-char hardcoded errors; capping them is a no-op).
- log::info! (not warn or debug) — capping is normal operation; right level for Phase 37 EVAL signal.
- McpToolResult / McpContent constructed directly in tests with public fields. RESEARCH.md flagged this as a possible blocker; it wasn't.
- CTX-07 escape hatch as `if smart { ... } else { content }` let-binding shadowing — keeps toggle scope local.

## Deviations from Plan

**One observation, no behavioral deviation from plan intent:**

**1. [Observation] Task 1's code was already present (uncommitted) when the orchestrator picked up the plan**
- **Found during:** initial state read at the start of execution. `git status` showed `M src-tauri/src/commands.rs` with +179 LOC matching Task 1's spec verbatim.
- **Issue:** Not a deviation — a prior session implemented Task 1 but didn't commit. The plan's structure (atomic commits per task) requires Task 1 to be a discrete commit.
- **Action:** Verified Task 1's tests pass (5/5 green via `cargo test --lib commands::tests::phase32_cap_tool_output`), then committed as `719b497`. Task 2 was the active edit work.
- **Files modified:** None additional from Task 1's already-staged shape.
- **Verification:** Per-task atomic-commit invariant preserved. Both commits exist in git log.

**2. [Test naming alignment — same pattern as Plan 32-04 deviation #2] format_tool_result regression tests use the names from the plan's `<behavior>` block verbatim**
- **Found during:** Task 2 test draft.
- **Issue:** None — the plan's `<behavior>` and `<action>` Step C both spell out the test names exactly as `phase32_format_tool_result_no_longer_truncates_at_12k` and `phase32_format_tool_result_still_caps_at_safety_ceiling`. This is a non-deviation; recorded for completeness.

**Total deviations:** 0 behavioral. 1 observation about pre-existing uncommitted Task 1 code; resolved by committing it discretely.

**Impact on plan:** Zero scope creep. Production behavior exactly as planned. Plan's atomic-commit-per-task contract preserved.

## Issues Encountered

- **Pre-existing uncommitted Task 1 code.** A previous session had implemented Task 1 (helper + 5 tests) but not committed it. Verified passing, committed atomically. No code changes required.
- **Cargo recompile latency.** `cargo test --lib phase32` took 10m 31s (full rebuild); `cargo check` took 3m 37s (partial after the test run reused intermediates). Both single invocations per CLAUDE.md "batch first, check at end" guidance.
- **No regressions from Wave 0/1/Plan 32-04 tests.** All 29 prior phase32_* tests still green; 7 new tests all green (36 total).

## User Setup Required

None — pure Rust logic changes inside `commands.rs`. Defaults: `tool_output_cap_tokens = 4000`, `smart_injection_enabled = true` (already wired by Plan 32-01). Existing user `~/.blade/config.json` files migrate transparently — `#[serde(default)]` on the `context` field plus per-sub-field defaults mean a config without a `"context"` key still loads with the new defaults.

## Deferred Items (for Plan 32-06 / 32-07 / Phase 33)

- **Storage_id reach-back tool.** Plan 32-05 generates a `tool_out_<millis>` id and includes it in the truncation marker but does NOT persist the original full content anywhere. Plan 33+ (LOOP) is the natural place to wire a SQLite `tool_output_archive` table + a "fetch_full_output(storage_id)" tool the model can call. Phase 32 only needs the marker to indicate truncation occurred.
- **DoctorPane render of capped-output frequency.** Plan 32-06 owns the dashboard; an additional row "tool outputs capped this session: N" could be useful but is not in 32-05's scope. The log::info!('[CTX-05] tool ... capped') line is enough signal for now.
- **Panic-resistance wrapper around cap_tool_output.** Plan 32-07 owns the fallback fixture; the `cap_tool_output` body has no panic surface today (saturating arithmetic, char_indices, safe_slice — all panic-free), but Plan 32-07 may add a `catch_unwind` wrapper as defense-in-depth.
- **Runtime UAT (50k-char bash output → conversation → confirm tail preserved + LLM sees marker).** Plan 32-07 owns the phase-wide UAT; not gating Plan 32-05 close.

## Next Phase Readiness

**Wave 2 + 3 plans can now mount on this cap:**

- **Plan 32-06 (DoctorPane dashboard)** — exposes `ContextBreakdown` via the `get_context_breakdown` Tauri command. Could optionally surface cap-frequency from the log signal but the dashboard is mostly orthogonal to tool-output capping. No direct dependency.
- **Plan 32-07 (fallback fixture + runtime UAT)** — DIRECTLY validates this plan. Will:
  - Run a real 50k-char bash output through the chat pipeline on the dev binary
  - Confirm `[CTX-05] tool ... output capped` log line fires
  - Screenshot the chat showing the head + marker + tail content (UAT round-trip on the running binary, not just unit tests)
  - Verify CTX-07 escape hatch: toggle `smart_injection_enabled = false`, confirm the cap is bypassed and content flows through unchanged (still bounded by the 200k MAX safety net)
  - Phase-wide UAT round-trip per CONTEXT.md §Testing & Verification step 4

**No blockers.** STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction.

## Threat Flags

None — no new network, auth, file-access, or schema surface introduced. The threat register entries (`T-32-11` per-call DoS, `T-32-12` non-ASCII panic, `T-32-13` increased prompt size, `T-32-14` adversarial budget=0) are addressed by the 4000-token default budget, the safe_slice mandate (regression-tested), the 200k safety ceiling, and the saturating arithmetic in `cap_tool_output` (budget=0 → all outputs return marker; chat degraded but functional).

## Self-Check: PASSED

Verified post-summary:

- File `src-tauri/src/commands.rs` exists and contains:
  - `pub fn cap_tool_output` (FOUND, count = 1)
  - `pub struct ToolOutputCap` (FOUND, count = 1)
  - `tool_output_cap_tokens` (FOUND, count = 2)
  - `[truncated from` marker (FOUND, count = 3 — once in cap_tool_output format!, twice in tests)
  - `MAX_TOOL_RESULT_CHARS: usize = 200_000` (FOUND, count = 1)
  - `MAX_TOOL_RESULT_CHARS: usize = 12_000` (NOT FOUND — count = 0; old value removed)
  - `[CTX-05] tool` log line (FOUND, count = 1)
  - `cap_tool_output(&content` (FOUND, count = 2)
- Commit `719b497` exists in `git log` (FOUND, "feat(32-05): add cap_tool_output helper + ToolOutputCap struct (CTX-05)")
- Commit `20f842f` exists in `git log` (FOUND, "feat(32-05): wire cap_tool_output at insertion site + raise MAX_TOOL_RESULT_CHARS to 200k (CTX-05)")
- All 36 phase32_* tests green (`cargo test --lib phase32` → 36 passed, 0 failed)
- `cargo check` exits 0 (3 pre-existing warnings unchanged)
- No file deletions in either task commit
- STATE.md and ROADMAP.md NOT modified by this executor (orchestrator's responsibility)

---
*Phase: 32-context-management*
*Completed: 2026-05-04*
