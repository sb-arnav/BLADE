---
phase: 32
slug: context-management
date: 2026-05-03
status: ready-for-planning
researcher: gsd-phase-researcher
confidence: HIGH
sources:
  primary:
    - openhands_docs: https://docs.openhands.dev/sdk/arch/condenser
    - openhands_blog: https://openhands.dev/blog/openhands-context-condensensation-for-more-efficient-ai-agents
    - openhands_pr_7610: https://github.com/All-Hands-AI/OpenHands/pull/7610/files
    - openhands_pr_6597: https://github.com/All-Hands-AI/OpenHands/pull/6597
    - claude_code_arxiv: https://arxiv.org/abs/2604.14228
    - claude_code_bash_truncation: https://github.com/anthropics/claude-code/issues/19901
    - claude_compaction_docs: https://platform.claude.com/docs/en/build-with-claude/compaction
    - tiktoken_rs: https://github.com/zurawiki/tiktoken-rs
    - anthropic_token_count_api: https://platform.claude.com/docs/en/build-with-claude/token-counting
  code:
    - src-tauri/src/brain.rs (1901 lines)
    - src-tauri/src/commands.rs (3310 lines)
    - src-tauri/src/config.rs (1480 lines)
    - src-tauri/src/capability_probe.rs (313 lines)
    - src-tauri/src/lib.rs:180 (safe_slice)
    - src/features/admin/DoctorPane.tsx (318 lines)
inputs:
  - .planning/phases/32-context-management/32-CONTEXT.md (LOCKED decisions)
  - .planning/REQUIREMENTS.md (CTX-01..07)
  - .planning/ROADMAP.md (Risk Register entries 1, 2)
  - .planning/STATE.md (v1.5 key decisions)
  - CLAUDE.md (six-place rule, safe_slice, Verification Protocol)
---

# Phase 32: Context Management — Research

**Audience:** the planner. Decisions are mostly locked in CONTEXT.md; this doc supplies HOW (concrete patterns, citations, validation surfaces) — not WHAT.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-01 | Brain.rs gates ALL context sections by query relevance | §Findings/CTX-01 — section gating extension to sections 0–8; reuse existing `score_context_relevance` + `thalamus_threshold` |
| CTX-02 | Thalamus relevance scoring extends to sections 0-8 | §Findings/CTX-02 — same code path as CTX-01, applied to identity / vision / hearing / memory call sites |
| CTX-03 | Condenser: keep first ~8k + last ~8k + LLM-summarize middle | §Findings/CTX-03 — OpenHands `LLMSummarizingCondenser` pattern; existing `compress_conversation_smart` already implements this shape, change trigger only |
| CTX-04 | Compaction fires proactively at ~80% capacity, not 140k | §Findings/CTX-04 — read `context_window` from `capability_probe::PROVIDER_CAPABILITIES`; multiply by 0.80; replace literal 140_000 |
| CTX-05 | Tool outputs capped at ~4k tokens with summary | §Findings/CTX-05 — Claude Code `applyToolResultBudget` pattern; head + tail + truncation marker; reuse storage_id concept |
| CTX-06 | Context budget dashboard in DoctorPane | §Findings/CTX-06 — record per-section token counts in `build_system_prompt_inner`, expose via new Tauri command, render under existing DoctorPane drawer pattern |
| CTX-07 | Fallback guarantee — never crash chat | §Findings/CTX-07 — feature flag + try/catch wrappers + chaos test; mirrors v1.1 lesson (MEMORY.md `feedback_uat_evidence`) |

---

## Project Constraints (from CLAUDE.md)

These are LOAD-BEARING. The planner MUST verify task plans honor each:

1. **Six-place config rule** — every new `BladeConfig` field needs ALL 6 sites updated: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`. (config.rs:241–880).
2. **`safe_slice` mandatory** — never use `&text[..n]` on user/conversation/tool content. Defined at `lib.rs:180`. Phase 32 introduces new string-slicing in tool-output cap and condenser → both MUST use `safe_slice`.
3. **Don't run `cargo check` after every edit** — batch edits, check at end. Each `cargo check` is 1–2 min.
4. **Tauri command name uniqueness** — the `#[tauri::command]` macro namespace is FLAT across all modules. New command `get_context_breakdown` must not collide.
5. **`use tauri::Manager;`** required when calling `app.state()` or `app.emit()` — easy to miss, gives a cryptic compile error.
6. **No Co-Authored-By in commits.**
7. **Verification Protocol** — static gates (cargo check / tsc) are NOT sufficient. Must run dev server, screenshot affected surface, exercise round-trip, read screenshot back, check 1280×800 + 1100×700. The v1.1 lesson: `27 gates green` + chat broken = unshipped milestone.
8. **Streaming contract** — every Rust streaming branch must emit `blade_message_start` before `chat_token` (MEMORY.md `project_chat_streaming_contract`). Phase 32 doesn't touch streaming directly but the breakdown emission must not interfere.

---

## Executive Summary

1. **CTX-03/04 is a 5-line change, not a rewrite.** The condenser body (`compress_conversation_smart`) already implements OpenHands' keep-first/keep-last/summarize-middle shape. Trigger is the only defect. Replace `140_000` literal at `commands.rs:1488` with `(model_context_window * 0.80) as usize`, where `model_context_window` is fetched from `capability_probe::PROVIDER_CAPABILITIES`. The summary prompt should be upgraded to OpenHands' v7610 structured prompt (USER_CONTEXT / COMPLETED / PENDING / CURRENT_STATE / CODE_STATE) — same body, smarter prompt.

2. **CTX-01/02 is mechanical.** Sections 0–8 in `build_system_prompt_inner` (lines 495–828) are unconditionally pushed today. The pattern `if !user_query.is_empty() && score_context_relevance(user_query, "X") > gate { ... }` already exists at lines 929, 958, 991, 1005, 1034, 1049, 1128, 1152 for sections 9+. Phase 32 extends this same pattern to the heavy parts of sections 0–8 (full character bible, full OCR, full hormones, full memory recall). A small core (BLADE.md identity, runtime supplement, active tool list) stays unconditional to preserve coherence on simple queries.

3. **CTX-05 needs a new helper, not a new module.** Today, `format_tool_result` (commands.rs:2889) hard-truncates at 12k chars with no summary, no head/tail split, no token-aware logic. The fix is one new function in `commands.rs` (or a small `tool_output_cap.rs` if it grows): `cap_tool_output(text: &str, budget_tokens: usize) -> (String, Option<StorageId>)`. Centralised. Called from BOTH the native-tool branch (line 2237) and the MCP branch (line 2247). Format follows the locked spec: head ~3k tokens + tail ~500 tokens + summary line `[truncated from N tokens; M omitted; storage_id <id>]`.

4. **CTX-06 is a 5-touch change.** A `thread_local` accumulator in `brain.rs` records `(section_label, char_count)` tuples during prompt assembly. New Tauri command `get_context_breakdown` returns the latest snapshot. DoctorPane gets a new collapsible row "Context Budget" reusing the existing `DoctorRow`/Dialog pattern. No bespoke design system work.

5. **CTX-07 is the most important and the cheapest.** Three guards: (a) `BladeConfig.context.smart_injection_enabled` feature flag wraps the entire selective-injection block — flag off = today's behavior verbatim; (b) `compress_conversation_smart` already returns silently on summary-call failure (commands.rs:248) — extend that pattern to wrap the new tool-cap call too; (c) a regression fixture that injects `score_context_relevance` panic via test-only override and asserts chat returns a reply. The v1.1 lesson — `27 gates green` + broken chat — is exactly the failure mode CTX-07 prevents.

6. **Token estimation: keep `chars / 4`, but bound the error.** The current `estimate_tokens` (commands.rs:142) uses `chars / 4`. Worst case for non-English / emoji-heavy text: ~37% under-count (Galileo, 2025). This is acceptable for a TRIGGER (hitting 80% is approximate anyway — overshoot to 75% is fine, undershoot to 90% is also fine because compaction is async per Risk Register entry 2). Upgrading to `tiktoken-rs` for the breakdown DISPLAY is a stretch goal: tiktoken-rs uses cl100k_base which is OpenAI-only and Anthropic counts differ — the official `messages.countTokens` requires an API call (latency cost on every turn). **Recommend: keep `chars/4` for triggers, document the 37% worst-case in the breakdown panel as "estimate", defer accurate counting to v1.6.**

---

## Source-by-Source Findings

### CTX-01 — Brain.rs gates ALL context sections by query relevance

**Prior art:**
- **Claude Code (arxiv 2604.14228)** does NOT do query-based pruning. It uses **directory-aware lazy-loading**: nested CLAUDE.md files load only when the agent reads those directories. *"Preventing unused instructions from consuming context"* — but this is path-scoped, not query-scoped. **BLADE's selective injection is a more aggressive design** (CITED: WebFetch arxiv 2604.14228).
- **OpenHands** uses condensation but does not query-prune the system prompt (CITED: docs.openhands.dev/sdk/arch/condenser).
- **The novelty BLADE ships:** semantic gating of hormones / vision / memory blocks per query. There is no public reference implementation of this shape — closest analog is RAG retrieval cutoffs, but those operate on documents, not system-prompt assembly.

**Inside BLADE:** `score_context_relevance(query, context_type) -> f32` at `brain.rs:218` already returns 0.0–1.0 with keyword sets per context type (`code`, `schedule`, `financial`, `health`, `security`, `smart_home`, `memory`, `people`, `system`, `research`). Scoring formula: high-keyword hit = 0.6 base + 0.1/extra hit, medium = 0.35 base, low = 0.2.

The `thalamus_threshold(current_prompt_chars)` function at `brain.rs:326` already implements progressive tightening: 0.2 → 0.3 → 0.5 → 0.7 as the prompt grows past 8k / 40k / 100k chars.

**The gap:** sections 0–8 (lines 495–828 in `build_system_prompt_inner`) bypass the gate entirely. Specifically:
- **Section 0 (static_core, line 495)** — BLADE.md + identity supplement: must stay unconditional (CONTEXT.md locked decision).
- **Section 1 (memory_core, line 506)** — L0 critical facts + character bible: heavy. Currently always pushed. CTX-02 wants this gated unless query asks for memory or is sufficiently complex.
- **Section 2 (role, line 532)** — active specialist role injection. Stays unconditional (small, identity-coherent).
- **Section 2.5/2.6 (safety + cortisol/oxytocin, line 538/546)** — hormone modulation. Currently always pushed. Should be gated to high cortisol or query-relevant cases.
- **Section 3 (identity_extension, line 558)** — deep scan + user model + personality mirror + virtual contexts + prefrontal + learned prefs. Heavy. Should be gated.
- **Section 7 (vision, line 652)** — `crate::perception_fusion::get_latest()` injects OCR + active app + visible errors. Heavy (300-char OCR slice). Should be gated unless query asks about screen / vision / or visible errors are present.
- **Section 7.1 (hearing, line 685)** — meeting transcripts. Already conditional on `detect_meeting_in_progress()`, but additional query gating would help when meeting is happening but the user asks something unrelated.
- **Section 8 (memory_recall, line 713)** — already gated by `if !user_query.is_empty() && !hive_is_active`. Good. But the inside fires unconditionally for typed_memory + knowledge_graph + memory_palace + causal + smart_recall — could refine per-sub-section relevance.

**Implementation pattern (existing, repeat for sections 0–8):**

```rust
let gate = thalamus_threshold(current_prompt_chars);
if !user_query.is_empty() && score_context_relevance(user_query, "memory") > gate {
    // inject character bible / typed memory / etc
}
```

**Confidence: HIGH** — pattern is in production at 8 call sites already (sections 9+).

### CTX-02 — Thalamus relevance scoring extends to sections 0-8

CTX-02 is the implementation of CTX-01. Same code path. The "thalamus" is the metaphor in the existing code (`thalamus_threshold`). Phase 32 extends the gating reach; nothing new is invented at the scoring layer.

**Score-type gaps to extend.** The current `score_context_relevance` keyword sets cover 10 context types. Sections 0–8 introduce three new types that don't exist yet:
- `"identity"` — gates character bible. Keywords: "you", "your", "who are you", "remember me", "what do you know about me".
- `"vision"` — gates OCR/active app injection. Keywords: "screen", "see", "looking", "visible", "this", "what's on", "showing".
- `"hearing"` — gates meeting transcripts. Keywords: "meeting", "conversation", "they said", "what was discussed".

**Recommendation:** add three new branches to the `match context_type` block at `brain.rs:222`. This is a 30-line additive change.

**Confidence: HIGH.**

### CTX-03 — Condenser: keep first ~8k + last ~8k + LLM-summarize middle

**Prior art (the locked port target):**

OpenHands' `LLMSummarizingCondenser` config (CITED: docs.openhands.dev/sdk/arch/condenser):
- `max_size`: event count threshold (default 120)
- `keep_first`: events to preserve verbatim from the start (default 4)
- `keep_last`: implicit — after condensation, view targets `max_size // 2` events (default 60 total)
- Extends `RollingCondenser` base class for trigger management

**The summarization prompt (CITED: PR #7610, OpenHands repo):**

```
You are maintaining a context-aware state summary for an interactive agent.
You will be given a list of events corresponding to actions taken by the agent,
and the most recent previous summary if one exists. Track:

USER_CONTEXT: (Preserve essential user requirements, problem descriptions, and clarifications in concise form)
COMPLETED: (Tasks completed so far, with brief results)
PENDING: (Tasks that still need to be done)
CURRENT_STATE: (Current variables, data structures, or relevant state)

For code-specific tasks, also include:
CODE_STATE: {File paths, function signatures, data structures}
TESTS: {Failing cases, error messages, outputs}
CHANGES: {Code edits, variable updates}
DEPS: {Dependencies, imports, external calls}
INTENT: {Why changes were made, acceptance criteria}
VC_STATUS: {Repository state, current branch, PR status, commit history}

PRIORITIZE:
1. Adapt tracking format to match the actual task type
2. Capture key user requirements and goals
3. Distinguish between completed and pending tasks
4. Keep all sections concise and relevant

SKIP: Tracking irrelevant details for the current task type
```

**Inside BLADE:** `compress_conversation_smart` at `commands.rs:179` already implements the shape:
- `keep_recent = 8` (line 191) — corresponds to `keep_last`
- Skips System messages from the compressed range (line 192)
- Builds `to_compress: Vec<String>` from messages between system_count and (len - 8) (lines 211–224)
- Calls `cheap_model_for_provider` → `complete_turn` for the summary (lines 239–245)
- Falls back to `truncate_to_budget` on failure (lines 248, 197, 207, 227)
- Replaces compressed range with `[Earlier conversation summary]\n{summary}` user message (line 256)

**Current summary prompt (commands.rs:231–236):**
```
Summarize this earlier conversation in 3-6 sentences. Preserve: key decisions made,
code written or changed, errors encountered and resolved, facts established.
Be dense and specific — this replaces the full history.
```

This is functionally similar to OpenHands but less structured. **Recommend: replace this prompt with the OpenHands v7610 prompt above.** Better structure → better recall fidelity (Phase 37 EVAL-04 measures this).

**Notable BLADE-specific concern: `keep_recent = 8 messages` is message-counted, not token-counted.** A pathological case: 8 messages where each contains a 50k-token bash output = 400k tokens preserved verbatim, defeating compaction. **Recommend: add a token-aware safety cap** — keep up to 8 messages OR 16k tokens whichever comes first. CONTEXT.md flags this as discretionary.

**Confidence: HIGH** for the body shape (we already have it). MEDIUM for the prompt upgrade impact (Phase 37 will measure).

### CTX-04 — Compaction fires proactively at ~80% capacity

**Prior art:**
- **Claude Code uses a 95% threshold** by default; this is hardcoded and widely complained about (CITED: anthropics/claude-code issues #11819, #15719, #28728, #43989). VS Code extension reportedly fires at ~75%. There is heavy user demand for configurability.
- **OpenHands fires at message count** (`max_size`), not percentage. Less precise.
- **80% is a defensible default** — leaves 20% of headroom for the next reply + tools. Aligns with VS Code Claude Code at 75% and far better than the 95% default everyone complains about.

**Inside BLADE:** the literal `140_000` at `commands.rs:1488` is wrong for any non-200k model:
- Anthropic Sonnet 4 / Haiku 4.5 → 200_000 → 80% = 160_000 (currently triggers at 70%, too early)
- OpenAI GPT-4o → 128_000 → 80% = 102_400 (currently triggers at 109%, NEVER fires until LLM rejects)
- Gemini 2.5 Pro → 2_097_152 → 80% = 1_677_721 (currently triggers at 6.7%, comically early)
- Groq Llama-3.3-70b → 131_072 → 80% = 104_857 (currently triggers at 107%, NEVER fires)

**Implementation:**

```rust
// New: lookup from capability_probe::PROVIDER_CAPABILITIES (already exists)
fn model_context_window(provider: &str, model: &str) -> u32 {
    let (_, _, _, _, ctx) = crate::capability_probe::infer_capabilities(provider, model);
    ctx
}

// Replace commands.rs:1488 literal with:
let trigger = (model_context_window(&config.provider, &config.model) as f32
                * config.context.compaction_trigger_pct) as usize;
compress_conversation_smart(&mut conversation, trigger, ...).await;
```

`capability_probe::infer_capabilities` already exists (`capability_probe.rs:170`) and returns `(vision, audio, tool_calling, long_context, context_window)`. Phase 32 adds a thin `model_context_window` helper or just inlines the call.

**Async/non-blocking (Risk Register entry 2):** today `compress_conversation_smart` is awaited synchronously inline. CONTEXT.md locks "compaction is async and non-blocking" — meaning emit a `blade_status: "compacting"` event and (option A) spawn `tokio::async_runtime::spawn` so the next reply can use the previous (uncompacted) state, OR (option B) keep it synchronous but emit the status so UI shows "compacting…" and accept the latency.

**Recommend option A** — Risk Register entry 2 explicitly says "fire compaction async; user sees 'compacting...' indicator; never blocks the reply path". Spawn pattern from CLAUDE.md: `tauri::async_runtime::spawn(async move { ... })`. Conversation state will need to be wrapped in `Arc<Mutex<>>` if it's not already, or use the channel pattern.

**Caveat:** Phase 32 is the strict dependency root. If async compaction is too risky (race with next user message), ship synchronous at first and revisit in Phase 33 — but emit the indicator in BOTH cases.

**Confidence: HIGH** for the trigger computation. MEDIUM for async wiring — depends on conversation state ownership inside `send_message_stream_inline`.

### CTX-05 — Tool outputs capped at ~4k tokens with summary

**Prior art:**
- **Claude Code Bash tool: 30,000 character cap with middle-truncation** — preserves beginning + end (CITED: anthropics/claude-code issue #19901). Configurable via `BASH_MAX_OUTPUT_LENGTH` env var. This is the locked reference design.
- **Claude Code's `applyToolResultBudget`** (CITED: WebFetch arxiv 2604.14228) — runs in the 5-layer compaction pipeline as Layer 1 ("Budget Reduction"). Replaces oversized outputs with content references. Exempt tools retain full output. The TOOL_CALL_END event carries the FULL untruncated tool output; the LLM receives the truncated version.
- **OpenClaw / Pi**: 50KB / 2K-line cap on `read` tool, 30KB on `shell`, 20KB on `grep` (CITED: WebSearch — strongdm/attractor coding-agent-loop-spec.md, openclaw issues).
- **The "head + tail" structure is universal** across modern agents.

**Inside BLADE today (the gap):**
- `format_tool_result` at `commands.rs:2889` uses `MAX_TOOL_RESULT_CHARS = 12_000` (line 336). Format: `text[..12000] + "\n\n[tool output truncated after 12000 characters]"`. **No tail preservation. No token awareness. No storage_id.**
- This is a regression vs. what BLADE wants: a 50k bash output that crashes compilation at the end of the file would have its error message dropped, since it's the "tail" that's omitted.

**Implementation pattern:**

```rust
// In commands.rs (or new tool_output_cap.rs if it grows):

const TOOL_OUTPUT_HEAD_RATIO: f32 = 0.875;  // ~3500/4000
const TOOL_OUTPUT_TAIL_RATIO: f32 = 0.125;  // ~500/4000

pub struct ToolOutputCap {
    pub content: String,          // The truncated content for the conversation
    pub storage_id: Option<String>, // Set if truncation happened; None otherwise
    pub original_tokens: usize,
}

pub fn cap_tool_output(text: &str, budget_tokens: usize) -> ToolOutputCap {
    let tokens = text.len() / 4; // chars/4 heuristic — matches estimate_tokens
    if tokens <= budget_tokens {
        return ToolOutputCap { content: text.to_string(), storage_id: None, original_tokens: tokens };
    }

    let budget_chars = budget_tokens * 4;
    let head_chars = (budget_chars as f32 * TOOL_OUTPUT_HEAD_RATIO) as usize;
    let tail_chars = (budget_chars as f32 * TOOL_OUTPUT_TAIL_RATIO) as usize;

    // CLAUDE.md: NEVER use &text[..n] — always safe_slice
    let head = crate::safe_slice(text, head_chars);
    let tail_start = text.char_indices().rev().nth(tail_chars).map(|(i, _)| i).unwrap_or(0);
    let tail = &text[tail_start..];

    let storage_id = format!("tool_out_{}", chrono::Utc::now().timestamp_millis());

    // Persist the original — discretionary impl (CONTEXT.md). Recommend SQLite table:
    // CREATE TABLE tool_output_archive (storage_id TEXT PRIMARY KEY, full_content TEXT, created_at INTEGER)
    let _ = persist_tool_archive(&storage_id, text);

    let omitted = tokens.saturating_sub(budget_tokens);
    let content = format!(
        "{}\n\n[truncated from {} tokens; {} omitted in middle; original available via storage_id {}]\n\n{}",
        head, tokens, omitted, storage_id, tail
    );

    ToolOutputCap { content, storage_id: Some(storage_id), original_tokens: tokens }
}
```

**Call sites — centralise the cap.** Phase 32 must hit BOTH branches:
- `commands.rs:2237` — native tools branch (`crate::native_tools::execute(...)`)
- `commands.rs:2247` — MCP branch (`format_tool_result(&r)`)
- `commands.rs:2429` — synthetic stub for unresolved tool calls (probably exempt — short string)
- `commands.rs:2108, 2195, 2213` — error-path pushes (probably exempt — short error messages, but worth a sanity check on length)

**Recommendation:** introduce `cap_tool_output` and call it on the `content` variable in both 2237 and 2247 BEFORE the `conversation.push(ConversationMessage::Tool { content, ... })` at line 2387. Keep `MAX_TOOL_RESULT_CHARS = 12_000` as a hard upper-bound safety net inside `format_tool_result` — this is the existing layer; cap_tool_output runs ON TOP of it for the per-message budget enforcement.

**Image / binary handling (CONTEXT.md discretionary):** `ConversationMessage::UserWithImage` already adds 1000 to char count for images (commands.rs:147). Tool outputs that contain image content should not run through the char-truncation logic — pass through as-is, treat the image payload as a single "[image]" placeholder for token accounting. Need to inspect `McpToolResult.content` for non-text variants before applying the cap.

**Confidence: HIGH** for the head-tail-summary pattern (universal). MEDIUM for the storage persistence (CONTEXT.md says reach-back is Phase 33+ — recommend a minimal SQLite table here so Phase 33 has something to read).

### CTX-06 — Context budget dashboard in DoctorPane

**Prior art:** none directly applicable. This is a BLADE debug-surface feature, not a port.

**Implementation sketch:**

1. **Per-section recording in brain.rs.** Use a `thread_local!` accumulator that `build_system_prompt_inner` writes to as it pushes each section:

```rust
thread_local! {
    static LAST_BREAKDOWN: std::cell::RefCell<Vec<(String, usize)>>
        = std::cell::RefCell::new(Vec::new());
}

fn record_section(label: &str, chars: usize) {
    LAST_BREAKDOWN.with(|b| b.borrow_mut().push((label.to_string(), chars)));
}
```

`build_system_prompt_inner` clears the accumulator at entry and calls `record_section("identity", parts.last().unwrap().len())` after each significant `parts.push(...)`. Convert chars to tokens at read time (`chars / 4`).

**Caveat:** `thread_local` won't survive across async hops if `build_system_prompt_inner` is called from a different runtime thread than the one reading. Verify by inspecting where the read command runs — if it crosses threads, switch to `Arc<Mutex<Vec<(String, usize)>>>` global. The breakdown is read AFTER the prompt is built within the same `send_message_stream_inline` call, so single-thread should hold — but verify in implementation.

2. **Tauri command** (in brain.rs or a new `context_breakdown.rs`):

```rust
#[derive(serde::Serialize)]
pub struct ContextBreakdown {
    pub sections: Vec<(String, usize)>, // (label, tokens)
    pub total_tokens: usize,
    pub model_context_window: u32,
    pub percent_used: f32,
    pub captured_at: i64,
}

#[tauri::command]
pub fn get_context_breakdown(app: tauri::AppHandle) -> Result<ContextBreakdown, String> {
    let cfg = crate::config::load_config();
    let ctx_window = crate::capability_probe::infer_capabilities(&cfg.provider, &cfg.model).4;
    let sections = LAST_BREAKDOWN.with(|b| b.borrow().clone());
    let total: usize = sections.iter().map(|(_, c)| c / 4).sum();
    Ok(ContextBreakdown {
        sections: sections.into_iter().map(|(l, c)| (l, c / 4)).collect(),
        total_tokens: total,
        model_context_window: ctx_window,
        percent_used: total as f32 / ctx_window as f32 * 100.0,
        captured_at: chrono::Utc::now().timestamp(),
    })
}
```

Register in `lib.rs:607` `generate_handler![]`.

3. **DoctorPane extension.** Adopt the existing `DoctorRow` + `Dialog` pattern (DoctorPane.tsx:94–125). Add a new SignalClass entry `"context_budget"` to `DISPLAY_NAME` and `ROW_ORDER`. Wire to a separate `lib/tauri/admin.ts` export `getContextBreakdown(): Promise<ContextBreakdown>` that wraps `invoke<ContextBreakdown>("get_context_breakdown")`. Refresh on `chat_done` event listener (NOT polling — see CONTEXT.md "preferred").

4. **CONTEXT.md says no UI design polish.** Ship a monospace table of `(section, tokens, %)` rows inside the existing Dialog drawer. No bespoke visualization.

**Confidence: HIGH** — pattern is well-established by the existing 10 doctor signal classes.

### CTX-07 — Fallback guarantee — never crash chat

**Prior art:** none directly applicable. This is the v1.1 lesson encoded in code.

**Three guards (all required):**

**Guard 1: feature flag wrapper.** `BladeConfig.context.smart_injection_enabled` (default `true`). At each new gate site in brain.rs sections 0–8:

```rust
// CTX-07 escape hatch — flag off = unconditional naive injection
let smart = config.context.smart_injection_enabled;
if smart && !user_query.is_empty() && score_context_relevance(...) > gate {
    parts.push(heavy_section);
} else if !smart {
    parts.push(heavy_section); // naive path = always inject
}
```

**Guard 2: panic-resistant scoring.** Wrap `score_context_relevance` in `std::panic::catch_unwind` at the call sites where it's newly introduced (or once at the top of `build_system_prompt_inner`). If it panics, score = 1.0 (inject everything = naive path). Log via `trace::log_trace`.

**Guard 3: Async compaction error swallowing.** `compress_conversation_smart` already returns silently on summary-call failure (commands.rs:248). Mirror this for `cap_tool_output`: if `cap_tool_output` panics or errors, fall back to `format_tool_result`'s 12k char hard truncation (the existing path). The user never sees a banner — only `trace::log_trace` records it.

**Regression test fixture (CTX-07 LOCKED):**

```rust
#[cfg(test)]
mod ctx07_regression {
    /// Inject a panic in score_context_relevance via test override and
    /// verify build_system_prompt_inner returns a non-empty prompt.
    #[test]
    fn smart_injection_panic_falls_back_to_naive() {
        // ... set CTX_SCORE_OVERRIDE to a closure that panics
        let prompt = brain::build_system_prompt_inner(&[], "what time is it?", None,
            &ModelTier::Frontier, "anthropic", "claude-sonnet-4", 1);
        assert!(!prompt.is_empty(), "fallback to naive path failed");
        assert!(prompt.contains("BLADE"), "identity must survive fallback");
    }
}
```

This requires a `#[cfg(test)]` override seam in `score_context_relevance` similar to the existing `TEST_KEYRING_OVERRIDES` pattern at `config.rs:89–105`.

**Chaos test (CONTEXT.md discretionary — recommend if cheap):** `BladeConfig.context.chaos_fail_rate: f32` — if > 0.0, randomly fail compaction every Nth call. Useful for catching latent bugs but not blocking.

**Confidence: HIGH** — pattern follows v1.1 lesson + existing test override seam at config.rs:89.

---

## Validation Architecture

> Required for Phase 37 (EVAL) to assert. The properties below are the measurable surfaces — not the only ones, but the minimum viable.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust) + `npm test` (TypeScript via Vitest) |
| Config file | `src-tauri/Cargo.toml` (Rust workspace), `vitest.config.ts` (frontend) |
| Quick run command | `cargo test --lib --package blade -- --nocapture context::` (Rust units only) |
| Full suite command | `cd src-tauri && cargo test && cd .. && npm test && npm run verify:all` |

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| CTX-01 | Section 0–8 gating extends `score_context_relevance` reach | unit | `cargo test --lib brain::tests::ctx01_simple_query_skips_heavy_sections` | ❌ Wave 0 |
| CTX-02 | Three new context types (identity/vision/hearing) score correctly | unit | `cargo test --lib brain::tests::ctx02_keyword_sets_score_above_gate` | ❌ Wave 0 |
| CTX-03 | Condenser preserves first 8k + last 8k; replaces middle with summary | integration | `cargo test --lib commands::tests::ctx03_compress_keeps_endpoints` | ❌ Wave 0 |
| CTX-04 | Trigger fires at 0.80 × model context window, not literal 140k | unit | `cargo test --lib commands::tests::ctx04_trigger_threshold_per_provider` | ❌ Wave 0 |
| CTX-05 | 50k token tool output capped to 4k with head + tail + storage_id | unit | `cargo test --lib commands::tests::ctx05_cap_tool_output_head_tail` | ❌ Wave 0 |
| CTX-06 | `get_context_breakdown` returns per-section tokens + total ≤ ctx_window | unit | `cargo test --lib brain::tests::ctx06_breakdown_reports_per_section` | ❌ Wave 0 |
| CTX-07 | Panic in `score_context_relevance` does not break chat reply | unit | `cargo test --lib brain::tests::ctx07_panic_in_scoring_falls_back` | ❌ Wave 0 |

### Measurable Properties (the minimum surface)

These are the assertions Phase 37 EVAL will run. Each is one-sentence and binary.

**Selective injection (CTX-01, CTX-02):**
- `assert: for query "what time is it?", section "character_bible" tokens contributed = 0` (with default gate 0.2)
- `assert: for query "fix this Rust error", section "character_bible" tokens contributed > 0 OR section "code" tokens contributed > 0`
- `assert: for any query, sections [BLADE.md identity, identity_supplement] tokens > 0` (small core stays unconditional)
- `assert: for query "what time is it?", total system-prompt tokens < 8_000` (down from current ~30k baseline)

**Compaction (CTX-03, CTX-04):**
- `assert: when conversation token count > 0.80 × model_context_window, compaction was attempted` (i.e. `compress_conversation_smart` ran)
- `assert: after compaction, message[1..system_count+1] is a User message starting with "[Earlier conversation summary]"`
- `assert: messages preserved at start = system_count messages (verbatim)`
- `assert: messages preserved at end ≥ keep_recent (default 8)` OR `≥ 16k tokens worth, whichever is fewer`
- `assert: trigger value for provider=anthropic, model=claude-sonnet-4 is 160_000` (200k × 0.80)
- `assert: trigger value for provider=openai, model=gpt-4o is 102_400`

**Tool cap (CTX-05):**
- `assert: cap_tool_output("x".repeat(50_000), 4000).original_tokens ≈ 12_500`
- `assert: cap_tool_output(...).content.starts_with(head) && content.ends_with(tail)` (head + tail preserved)
- `assert: cap_tool_output(...).content.contains("storage_id")` (marker present)
- `assert: cap_tool_output("short", 4000).storage_id == None` (no cap when under budget)
- `assert: cap_tool_output(non_ascii_emoji, 4000) does not panic` (safe_slice usage)

**Breakdown (CTX-06):**
- `assert: get_context_breakdown().sections.len() ≥ 5` after a real prompt build
- `assert: get_context_breakdown().total_tokens == sum(s.tokens for s in sections)` (consistency)
- `assert: get_context_breakdown().percent_used ≤ 100.0`
- `assert: DoctorPane renders the breakdown row when get_context_breakdown succeeds` (RTL test)

**Fallback (CTX-07):**
- `assert: with smart_injection_enabled=false, prompt structure matches pre-Phase-32 baseline byte-for-byte`
- `assert: with score_context_relevance forced to panic via #[cfg(test)] override, build_system_prompt_inner still returns non-empty string starting with BLADE.md`
- `assert: with cheap-model summary call mocked to fail, compress_conversation_smart returns and conversation is non-empty`

### Sampling Rate

- **Per task commit:** `cargo test --lib brain:: commands::tests::ctx0` (the 7 unit tests above)
- **Per wave merge:** full Rust + TS test suite + `npm run verify:all` (existing 37-gate chain)
- **Phase gate:** all 7 unit tests green + 37 existing gates green + UAT screenshot evidence (CONTEXT.md verification list, see CLAUDE.md Verification Protocol)

### Wave 0 Gaps

All seven test files do not yet exist. Wave 0 must create:

- [ ] `src-tauri/src/brain.rs` — extend existing `#[cfg(test)] mod tests` with `ctx01_*`, `ctx02_*`, `ctx06_*`, `ctx07_*` tests
- [ ] `src-tauri/src/commands.rs` — extend existing `#[cfg(test)] mod tests` (if any) or add module with `ctx03_*`, `ctx04_*`, `ctx05_*` tests
- [ ] Test override seam: add `#[cfg(test)] thread_local! { CTX_SCORE_OVERRIDE: ... }` in brain.rs mirroring config.rs:89–105
- [ ] UAT script — capture per CONTEXT.md §Testing & Verification list (7 manual steps, screenshots in `docs/testing ss/`)

---

## Implementation Sketch

> Concrete-ish but not a plan. The planner sequences these.

### File-by-file changes

**`src-tauri/src/config.rs`** (six-place rule applies to each new field):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextConfig {
    #[serde(default = "default_smart_injection_enabled")]
    pub smart_injection_enabled: bool,
    #[serde(default = "default_relevance_gate")]
    pub relevance_gate: f32,
    #[serde(default = "default_compaction_trigger_pct")]
    pub compaction_trigger_pct: f32,
    #[serde(default = "default_tool_output_cap_tokens")]
    pub tool_output_cap_tokens: usize,
}

fn default_smart_injection_enabled() -> bool { true }
fn default_relevance_gate() -> f32 { 0.2 }
fn default_compaction_trigger_pct() -> f32 { 0.80 }
fn default_tool_output_cap_tokens() -> usize { 4000 }

impl Default for ContextConfig { /* matches above */ }
```

Add `context: ContextConfig` field to BOTH `DiskConfig` (line 242) AND `BladeConfig` (line 449), with defaults populated in BOTH `Default` impls (lines 386, 593) AND copied in BOTH `load_config` (line 754) AND `save_config` (line 822). Six places. Roundtrip test mandatory (mirror `phase11_fields_round_trip` at config.rs:1203).

**`src-tauri/src/brain.rs`:**
- Extend `score_context_relevance` keyword sets (line 222) with three new types: `"identity"`, `"vision"`, `"hearing"`.
- Add `record_section` thread_local accumulator + `clear_section_accumulator()` (called at top of `build_system_prompt_inner`).
- Wrap heavy sections 0–8 (lines 506, 532–556, 558–610, 652–711, 713–828) with the `if smart && score_context_relevance(...) > gate` guard. Always-keep core: BLADE.md (line 499), identity_supplement (line 504), role (line 532), MCP tool list (line 1092).
- Add `get_context_breakdown` Tauri command (or in a new `context_breakdown.rs`, but per CONTEXT.md prefer extending existing).

**`src-tauri/src/commands.rs`:**
- Replace literal `140_000` at line 1488 with `(model_context_window(&config.provider, &config.model) as f32 * config.context.compaction_trigger_pct) as usize`.
- Replace literal `120_000` at line 1533 (the truncate-and-retry recovery) with the same formula at a more aggressive percentage (~0.65) to give headroom for the retry.
- Add `cap_tool_output` helper. Call from BOTH the native branch (after line 2237) AND the MCP branch (after line 2247) — wrap the assignment so `content` is the capped version.
- Upgrade `compress_conversation_smart` summary prompt at line 231 to OpenHands v7610 prompt (above).
- Add `keep_recent_token_cap = 16_000` safety check at line 191 — if any of the last 8 messages exceeds this, force token-aware drop instead of message-count drop.
- Async wiring (option A from CTX-04): wrap the line 1486 call in `tokio::task::spawn` with `Arc<Mutex<Vec<ConversationMessage>>>` if conversation isn't already shared, OR keep synchronous and emit `blade_status: "compacting"` immediately before + `blade_status: "processing"` after. **Decision deferred to planner — option A is the locked CONTEXT.md path but option B is acceptable if state ownership is too entangled.**

**`src-tauri/src/lib.rs`:**
- Register `get_context_breakdown` in the `generate_handler![]` block (line 607).
- Verify no name collision against other Tauri commands.

**`src/lib/tauri/admin.ts`:** add `getContextBreakdown(): Promise<ContextBreakdown>` wrapper around `invoke`.

**`src/features/admin/DoctorPane.tsx`:**
- Add `'context_budget'` to `SignalClass` union (in `lib/tauri/admin.ts` types).
- Add `'context_budget': 'Context Budget'` to `DISPLAY_NAME` (line 40).
- Append `'context_budget'` to `ROW_ORDER` (line 56).
- Add a fetch of `getContextBreakdown` on mount + on `chat_done` event listener (existing pattern: line 174 `handleEvent`).
- Render breakdown in the existing `Dialog` drawer body (line 274) as a monospace table.

### Ordering

1. **Wave 0 (test scaffolding):** add `ContextConfig` six-place + roundtrip test. Add three new context types to `score_context_relevance`. Add the seven `ctx0*` test stubs (failing). Add the test-override seam.
2. **Wave 1 (CTX-01/02):** add the gating guards to brain.rs sections 0–8. CTX-07 feature flag wraps each guard. Tests `ctx01_*`, `ctx02_*`, `ctx07_*` pass.
3. **Wave 2 (CTX-04 trigger):** swap the 140k literal for `model_context_window × pct`. Test `ctx04_*` passes.
4. **Wave 3 (CTX-03 prompt + token-aware keep_recent):** upgrade summary prompt + add safety cap. Test `ctx03_*` passes.
5. **Wave 4 (CTX-05 tool cap):** add `cap_tool_output` + wire both call sites. Test `ctx05_*` passes.
6. **Wave 5 (CTX-06 breakdown):** add `record_section` + `get_context_breakdown` + DoctorPane row. Test `ctx06_*` passes.
7. **Wave 6 (UAT):** dev server + 7 manual steps from CONTEXT.md + screenshots at 1280×800 + 1100×700.

---

## Landmines / Risks

| # | Risk | Cite | Mitigation |
|---|------|------|------------|
| 1 | **v1.1 lesson — chat-rendering regression on smart-path enable.** Smart selective injection sometimes drops a section the model needs to coherently reply, producing empty replies / 40 API calls / no UI feedback. | MEMORY.md `project_v11_close_failed_uat`; ROADMAP.md Risk Register entry 1 | CTX-07 feature flag (default ON, but flippable); regression fixture with panic in scoring; UAT round-trip on the actual binary; dev server screenshot evidence per CLAUDE.md Verification Protocol. Don't ship until UAT round-trip works. |
| 2 | **Compaction adds latency to every cycle (LLM call inside chat path).** | ROADMAP.md Risk Register entry 2 | Async compaction (option A) + `blade_status: "compacting"` event + on-failure fall through to existing `truncate_to_budget`. Already implemented at commands.rs:248 — preserve this. |
| 3 | **`140_000` literal change breaks shorter-context models.** GPT-4o-mini at 128k currently triggers compaction at 109% (i.e. never). Switching to 102k may suddenly fire compaction often. Tests must cover this. | This research §CTX-04 | Per-provider unit test asserting trigger == ctx_window × 0.80. Track Phase 37 EVAL-02 (context efficiency) — Phase 32 must IMPROVE this metric, not regress it. |
| 4 | **`thread_local!` for breakdown crosses async boundary** if `build_system_prompt_inner` is awaited and the read command runs on a different worker thread. | This research §CTX-06 | Verify single-threaded read in implementation; if not, switch to `Arc<Mutex<>>` global (small cost). Add a smoke test that reads breakdown immediately after `send_message_stream_inline` returns. |
| 5 | **Tauri command name collision.** `get_context_breakdown` is unique today, but the macro namespace is FLAT. | CLAUDE.md "Don't add `#[tauri::command]` with a name that exists in another module" | Grep before adding: `grep -rn "fn get_context_breakdown" src-tauri/src/ \| wc -l` must return 0. Lock this in CI as a regex check. |
| 6 | **Six-place config rule misses one.** Adding `ContextConfig` requires 6 sites. If any one is missed, `cargo check` may pass but config will fail to load on a real user's existing config.json. | CLAUDE.md six-place rule | Mandatory roundtrip test (`config_roundtrip_includes_context`) — this is THE discipline lever. The existing `phase11_fields_round_trip` test (config.rs:1203) is the canonical pattern. |
| 7 | **`score_context_relevance` keyword sets become stale** as users adopt new vocabulary. A user asking "open the SVG in Inkscape" doesn't hit any current keyword set. | This research §CTX-01 | Discretionary: in the breakdown panel, log queries that scored 0 across all context types — useful signal for future keyword tuning. Park as v1.6 work. |
| 8 | **`tiktoken-rs` is OpenAI-only.** Anthropic + Gemini token counts will be off (worst case ~5–10% under-count for Claude). | WebSearch: Anthropic uses proprietary tokenizer; no open-source port | Keep `chars / 4` for triggers (acceptable for 80% threshold). Document as "estimate" in DoctorPane. Defer accurate counting to v1.6. |
| 9 | **`format_tool_result` already truncates at 12k chars.** If `cap_tool_output` runs AFTER `format_tool_result`, the 12k cap silently runs first and `cap_tool_output` sees a max of 12k chars (≈ 3k tokens), never crossing the 4k token budget — making CTX-05 a no-op. | This research §CTX-05 | Either bypass `format_tool_result` truncation (raise its cap to e.g. 200k chars and rely on `cap_tool_output` instead), OR call `cap_tool_output` BEFORE `format_tool_result` runs. Choose one. The planner must decide. |
| 10 | **Async compaction race.** If compaction runs in a `tokio::spawn` task and the user sends another message before it completes, the next turn sees the un-compacted state and may also overflow. | This research §CTX-04 | Track an `AtomicBool COMPACTING` flag — if set, the next turn skips re-triggering compaction (already in flight). When the spawned task completes, it swaps the conversation atomically. CONTEXT.md says "if next reply lands before compaction returns, use previous (uncompacted) conversation" — that's the locked behavior; the next-turn-skips-trigger flag implements it. |

---

## Out of Scope

> Confirming what is NOT in Phase 32 vs. Phase 33/34/35/36. The planner MUST resist scope creep on each.

| Concern | Phase | Why not Phase 32 |
|---------|-------|------------------|
| Mid-loop verification ("are we progressing?") | Phase 33 (LOOP-01) | Loop quality is the next phase. CTX is the substrate. |
| Plan adaptation when step N fails | Phase 33 (LOOP-03) | Same. Phase 32 leaves the 12-iteration for-loop alone. |
| Iteration limit raised from 12 to 25 + cost guard | Phase 33 (LOOP-06) | Same. |
| Stuck detection (5 semantic patterns) | Phase 34 (RES-01) | Resilience layer. |
| Circuit breaker after N failures | Phase 34 (RES-02) | Same. |
| Token cost tracking + cost guard | Phase 34 (RES-03, RES-04) | Cost is orthogonal to context. |
| Append-only JSONL session log + session resume | Phase 34 (SESS-01..04) | Persistence layer. |
| Auto-decomposition / sub-agents with isolated contexts | Phase 35 (DECOMP-01..05) | Sub-agent isolation requires Phase 34 session storage first. |
| Tree-sitter symbol graph + PageRank repo map | Phase 36 (INTEL-01..03) | The "smart" context that lives ABOVE Phase 32's selective injection. |
| `canonical_models.json` capability registry | Phase 36 (INTEL-04, INTEL-05) | Phase 32 reuses the existing `capability_probe` static matrix; formalisation is later. |
| `@context-anchor` chat syntax (`@screen`, `@file:path`, `@memory:topic`) | Phase 36 (INTEL-06) | User-explicit context injection layer. |
| Embeddings-based relevance scoring (replace keyword) | v1.6+ | CONTEXT.md deferred — bolt-on if cheap, defer otherwise. |
| Persistent reach-back tool for tool-output archive | Phase 33+ | Phase 32 stores the truncated original; reach-back is a tool, which is a loop-level concern. |
| DoctorPane visual polish | Indefinite (chat-first pivot) | UI debt deferred until chat is solid. |
| Chaos test (random compaction failures) | v1.6+ unless cheap | CONTEXT.md discretionary. |

---

## Sources

### Primary (HIGH confidence)
- [OpenHands Condenser Docs](https://docs.openhands.dev/sdk/arch/condenser) — `LLMSummarizingCondenser` config (max_size, keep_first), trigger semantics
- [OpenHands PR #7610 (csmith49)](https://github.com/All-Hands-AI/OpenHands/pull/7610) — verbatim `SUMMARY_PROMPT` text
- [OpenHands PR #6597 (csmith49)](https://github.com/All-Hands-AI/OpenHands/pull/6597) — RollingCondenser integration, prompt evolution from 0% → 40%
- [Dive into Claude Code (arXiv 2604.14228)](https://arxiv.org/abs/2604.14228) — five-layer compaction pipeline (Budget Reduction → Snip → Microcompact → Context Collapse → Auto-compact); directory-aware lazy CLAUDE.md loading
- [Claude Code Bash output truncation docs (Anthropic)](https://docs.claude.com/en/docs/agents-and-tools/tool-use/bash-tool) — 30k char default + middle-truncation + `BASH_MAX_OUTPUT_LENGTH` env var
- [Anthropic token counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting) — `messages.countTokens` is the only accurate Claude tokenizer; no open-source port

### Code Anchors (read by the planner)
- `/home/arnav/blade/src-tauri/src/brain.rs:218` — `score_context_relevance` definition
- `/home/arnav/blade/src-tauri/src/brain.rs:326` — `thalamus_threshold` definition
- `/home/arnav/blade/src-tauri/src/brain.rs:456` — `build_system_prompt_inner` (the function this phase modifies)
- `/home/arnav/blade/src-tauri/src/brain.rs:929,958,991,1005,1034,1049,1128,1152` — existing gate call sites (template for sections 0–8)
- `/home/arnav/blade/src-tauri/src/commands.rs:179` — `compress_conversation_smart`
- `/home/arnav/blade/src-tauri/src/commands.rs:1488` — `140_000` literal (the trigger to fix)
- `/home/arnav/blade/src-tauri/src/commands.rs:2237,2247` — tool result conversion sites
- `/home/arnav/blade/src-tauri/src/commands.rs:2889` — `format_tool_result` (the existing 12k truncation)
- `/home/arnav/blade/src-tauri/src/config.rs:241–880` — the six-place pattern in action
- `/home/arnav/blade/src-tauri/src/config.rs:1203` — canonical roundtrip test pattern
- `/home/arnav/blade/src-tauri/src/capability_probe.rs:170` — `infer_capabilities` returns context_window
- `/home/arnav/blade/src-tauri/src/lib.rs:180` — `safe_slice` definition
- `/home/arnav/blade/src/features/admin/DoctorPane.tsx:94–125,267–315` — the row + drawer pattern to extend

### Secondary (MEDIUM confidence — verified with primary sources)
- [GitHub: anthropics/claude-code issues 11819, 15719, 28728, 43989](https://github.com/anthropics/claude-code/issues/11819) — auto-compact threshold complaints; widespread 95% default; 80% chosen by VS Code extension
- [Galileo: Tiktoken in production](https://galileo.ai/blog/tiktoken-guide-production-ai) — char/4 heuristic 37% under-count on emoji/non-English; tiktoken-rs accuracy comparison
- [Tracing Claude Code's LLM Traffic (George Sung, Medium)](https://medium.com/@georgesung/tracing-claude-codes-llm-traffic-agentic-loop-sub-agents-tool-use-prompts-7796941806f5) — agentic loop structure
- [Context management in agent harnesses (Arize AI)](https://arize.com/blog/context-management-in-agent-harnesses/) — head/tail/storage_id is a universal pattern across modern agent frameworks
- [strongdm/attractor coding-agent-loop-spec.md](https://github.com/strongdm/attractor/blob/main/coding-agent-loop-spec.md) — read_file 50k, shell 30k, grep 20k caps confirmed across Pi/OpenClaw lineage

### Tertiary (LOW confidence — single source, treat as suggestion)
- [tiktoken-rs (zurawiki)](https://github.com/zurawiki/tiktoken-rs) — v0.11.0 (April 2026), `cargo add tiktoken-rs`. Singleton pattern recommended. Embedded BPE files unverified — assumed bundled. Not used in Phase 32 plan; documented for v1.6 consideration.

---

## Metadata

**Confidence breakdown:**
- Standard stack (no new libs needed): HIGH — Phase 32 reuses existing Rust deps.
- Architecture (extension pattern): HIGH — pattern proven at 8 existing call sites.
- Pitfalls: HIGH — landmines #1 + #6 + #9 are observed bugs in the codebase or other agents, not speculative.
- OpenHands prompt port: MEDIUM — prompt text verified verbatim from PR #7610, but Phase 37 EVAL-04 will measure recall fidelity.
- `tiktoken-rs` recommendation: LOW — out of scope for Phase 32 anyway; documented for v1.6.

**Research date:** 2026-05-03
**Valid until:** 2026-06-02 (30 days; OpenHands and Claude Code both move fast — re-verify auto-compact threshold and condenser API if Phase 32 slips past June)

---

## RESEARCH COMPLETE

Phase: 32 — Context Management
Confidence: HIGH

### Key Findings (top of funnel for the planner)

1. CTX-03/04 is a 5-line change inside `commands.rs:1488` — replace the `140_000` literal with `model_context_window × config.context.compaction_trigger_pct`. The condenser body is fine.
2. CTX-01/02 is a mechanical extension of an existing pattern (`if score > gate { inject }`) to sections 0–8 of `build_system_prompt_inner`, plus three new keyword sets (`identity`, `vision`, `hearing`).
3. CTX-05 needs ONE new helper — `cap_tool_output` — wired to BOTH the native and MCP tool branches in `commands.rs`. Decision required: bypass or run alongside the existing 12k `format_tool_result` truncation (landmine #9).
4. CTX-06 is a thread_local accumulator + a Tauri command + a DoctorPane row reusing existing `DoctorRow`/`Dialog` patterns. No bespoke design.
5. CTX-07 is THE most important guard. Three layers: feature flag, panic-resistant scoring, fallback on summary failure (already partially implemented at `commands.rs:248`). Plus a regression fixture that injects panic and asserts chat survives.

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard stack | HIGH | Reuses existing Rust deps; no new crates required for Phase 32 |
| Architecture | HIGH | All five features extend existing patterns (gate, condenser body, six-place config, doctor row, fallback) |
| Pitfalls | HIGH | Landmines #1, #6, #9, #10 are concrete and code-anchored |
| Validation surface | HIGH | 7 unit tests + 7 UAT steps from CONTEXT.md, all measurable |
| Async wiring detail | MEDIUM | Conversation state ownership inside `send_message_stream_inline` not fully traced — planner may need to choose option A vs B for CTX-04 async |
| Tool-cap ordering vs `format_tool_result` | MEDIUM | Decision required; not blocking for research, blocking for plan |

### Open Questions for the Planner

1. **CTX-04 async wiring (option A vs B).** Wrap compression in `tokio::task::spawn` (option A, CONTEXT.md locked) or keep synchronous + emit status (option B, simpler)? Depends on how `conversation: Vec<ConversationMessage>` is owned across the `send_message_stream_inline` call — if it's already in an Arc/Mutex, option A is straightforward; if not, option B is the lower-risk path. Inspect during Wave 2.

2. **CTX-05 ordering vs `format_tool_result`.** `format_tool_result` already truncates at 12k chars. Either raise that cap and rely on `cap_tool_output` for the per-message budget, OR call `cap_tool_output` BEFORE `format_tool_result`. The planner picks one. Recommend: raise `format_tool_result`'s cap to ~200k chars (covers most pathological outputs) and let `cap_tool_output` enforce the actual 4k-token budget.

3. **CTX-06 thread_local vs global.** If `build_system_prompt_inner` is awaited across worker threads, `thread_local` will not survive. Smoke-test in implementation; switch to `Arc<Mutex<>>` global if needed.

### Ready for Planning

Research complete. The planner can now create `32-01-PLAN.md` ... `32-N-PLAN.md` with full grounding in:
- the 7 CTX requirements,
- the 5 file-by-file change set,
- the 6-wave ordering,
- the 7 unit tests + 7 UAT steps that gate phase close,
- the 10 documented landmines.
