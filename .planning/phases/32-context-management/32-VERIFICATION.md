---
phase: 32-context-management
verified: 2026-05-05T00:00:00Z
status: human_needed
score: 5/5 success criteria verified statically
overrides_applied: 0
mode: goal-backward static analysis
runtime_uat_status: deferred (Plan 32-07 Task 2 = checkpoint:human-verify; operator UAT pending)
human_verification:
  - test: "Send 'what time is it?' to chat; open Diagnostics → Doctor → Context Budget"
    expected: "Heavy sections (character_bible, vision, hearing) show 0 tokens; identity_supplement + role + tools dominate; total << model context window"
    why_human: "30% reduction is a runtime metric requiring populated DBs (character bible, OCR, meeting transcripts); unit tests cannot exercise this — Plan 32-03 SUMMARY explicitly defers to runtime UAT"
  - test: "Send a code query like 'explain this Rust trait' to chat"
    expected: "code section populates; vision/hearing remain 0; schedule remains 0"
    why_human: "Per-section behavior under live data only observable on the running binary"
  - test: "Trigger compaction with a long conversation past 80% of model context window"
    expected: "blade_status: 'compacting' surfaces in UI; blade_notification shows pre-compaction token count; conversation continues post-compaction with [Earlier conversation summary] user message"
    why_human: "blade_status event emit + UI spinner visibility cannot be verified statically; SC-2 inner working requires LLM round-trip"
  - test: "Run a bash command producing 50k characters of output via chat"
    expected: "[CTX-05] log line fires; conversation receives ~14k chars (head + marker + tail); '[truncated from N tokens; ~M omitted in middle; storage_id tool_out_<ts>]' appears"
    why_human: "Live tool dispatch + cap behavior + log inspection require running app"
  - test: "Toggle smart_injection_enabled = false in config; restart; verify chat works identically to pre-Phase-32 (CTX-07 escape hatch)"
    expected: "All gates open; legacy 140k/120k literals fire; tool output cap bypassed; chat replies as before"
    why_human: "Config-flip kill-switch requires actual restart + observation; this is THE v1.1 regression invariant"
  - test: "DoctorPane Context Budget panel cross-viewport at 1280×800 + 1100×700 with screenshots to docs/testing ss/"
    expected: "Monospace token table visible at both widths; sorted desc by tokens; total/window/percent header visible; no overlap with Doctor section"
    why_human: "v1.1 lesson — UI overlap / button-below-fold bugs only surface at specific widths; cross-viewport check is mandatory per BLADE Verification Protocol"
  - test: "npm run verify:all (37 gates remain green)"
    expected: "All 37 gates pass"
    why_human: "Operator confirms before merge"
---

# Phase 32: Context Management Verification Report

**Phase Goal (verbatim from ROADMAP.md):**
> Brain.rs injects only what each query actually needs — a 'what time is it?' never gets OCR + hormones + character bible. The condenser fires proactively at 80% capacity, the middle conversation is LLM-summarized, individual tool outputs are capped, and a context budget is visible in DoctorPane.

**Verified:** 2026-05-05 — initial verification.
**Status:** human_needed — all 5 Success Criteria pass static-analysis verification; Plan 32-07 Task 2 (operator runtime UAT) is the documented gating step per CLAUDE.md Verification Protocol.

## Executive Summary

All 5 ROADMAP Success Criteria have load-bearing code anchors. 44 phase32 unit tests + 2 integration tests pass. The CTX-07 fallback contract is enforced by `score_or_default` (brain.rs:551) wrapping all 19 user-query gate sites + `catch_unwind`+`AssertUnwindSafe` at the `cap_tool_output` call site (commands.rs:2542). Runtime UAT (DoctorPane visibility under live data, 30% reduction magnitude, real compaction trigger, real bash cap, CTX-07 toggle round-trip) is deliberately deferred to Plan 32-07 Task 2 — a `checkpoint:human-verify` with `gate=blocking`. Static analysis cannot close the human items; the goal is achievable but unobserved on the running binary.

## Goal Achievement — Observable Truths (ROADMAP SCs)

| # | Success Criterion | Status | Evidence |
| - | - | - | - |
| 1 | Selective injection: simple→no heavy ctx; code→repo ctx; unrelated→neither | ✓ VERIFIED (static) | brain.rs:752-1075 + score_context_relevance arms (brain.rs:411-470) |
| 2 | At ~80% of budget, compaction fires; LLM-summarized middle (not truncation) | ✓ VERIFIED (static) | commands.rs:1581-1617 (trigger), commands.rs:266-349 (smart compress) |
| 3 | 50k-char tool output capped at ~4k tokens with summary appended | ✓ VERIFIED (static) | commands.rs:3114-3164 (cap_tool_output), commands.rs:2541-2568 (wire) |
| 4 | DoctorPane shows per-section token breakdown | ✓ VERIFIED (static) | brain.rs:322-376 + DoctorPane.tsx:107-209 + lib.rs:685 |
| 5 | Selective inject / compaction errors → chat continues; no crashes | ✓ VERIFIED (static) | brain.rs:551-572 (score_or_default), commands.rs:2542 (catch_unwind) |

**Score:** 5/5 ROADMAP Success Criteria verified statically.

---

## Per-Criterion Detail

### SC-1 ✓ VERIFIED — Selective Injection

- `score_context_relevance(query, type) -> f32` at `brain.rs:395-538` — keyword sets across 13 context types (code, schedule, financial, health, security, smart_home, memory, people, system, research, identity, vision, hearing).
- Query gates wrapping heavy sections at `brain.rs:752-1075`:
  - `let smart = config.context.smart_injection_enabled` (753); `let gate = config.context.relevance_gate` (754)
  - `let allow_X = !smart || user_query.is_empty() || score_or_default(...) > gate` for character_bible (784-786), safety (821), hormones (842-844), identity_extension (871-873), vision (995-997), hearing (1044-1045)
- Always-keep core (push unconditionally + record): blade_md (764), identity_supplement (768), memory_l0 (777), role (816), tools.
- Sections 9+ retain their existing condition gates with thalamus-adaptive threshold at `brain.rs:1361`.

**Tests:** `phase32_score_identity_high/low`, `phase32_score_vision_high/low`, `phase32_score_hearing_high`, `phase32_score_unknown_type_returns_zero`, `phase32_section_gate_simple_query`, `phase32_section_gate_always_keep_core_present`, `phase32_breakdown_simple_query_omits_vision`.

**Static gap:** 30% reduction magnitude is a runtime UAT criterion — unit tests collapse both prompts to always-keep core (no populated DBs). Plan 32-03 SUMMARY relaxed assertion to `simple ≤ code`; magnitude check deferred to Plan 32-07 Task 2.

### SC-2 ✓ VERIFIED — Proactive Compaction at 80%

- **Pre-loop trigger** at `commands.rs:1581-1617`:
  - `let trigger = if smart { (model_context_window(provider, model) as f32 * config.context.compaction_trigger_pct) as usize } else { 140_000 }` (1587-1592)
  - `if pre_tokens > trigger { app.emit("blade_status", "compacting"); blade_notification with pre-token count }` (1594-1606)
  - `compress_conversation_smart(...).await` (1607); `app.emit("blade_status", "processing")` (1616)
- **Recovery trigger** at `commands.rs:1659-1671` — uses 0.65 (more headroom) with 120_000 legacy fallback.
- **`model_context_window(provider, model) -> u32`** at `commands.rs:164-170` — wraps `capability_probe::infer_capabilities`, floors at 8_192.
- **`compress_conversation_smart`** at `commands.rs:266-349`:
  - Token-aware `keep_recent` via `compute_keep_recent(conv, 8, 16_000)` (284); system messages preserved
  - OpenHands v7610 prompt via `build_compaction_summary_prompt(events)` (325) — USER_CONTEXT/COMPLETED/PENDING/CURRENT_STATE/CODE_STATE/TESTS/CHANGES/DEPS/INTENT/VC_STATUS asserted
  - Cheap model (`cheap_model_for_provider`) (328); `complete_turn` LLM call (332-341)
  - Summary inserted as `[Earlier conversation summary]\n{summary}` user message (344-348)
  - **CTX-07 backstop:** `Err(_) => { truncate_to_budget(...); return; }` (336-339)

**Tests:** `phase32_compaction_trigger_anthropic_200k`, `_openai_128k`, `_unknown_model_safe_default`, `_pct_respects_config`, `phase32_compress_summary_prompt_includes_v7610_keys`, `_keep_recent_normal_case`, `_token_aware`, `_floor`.

### SC-3 ✓ VERIFIED — Tool Output Cap

- **`cap_tool_output(content, budget_tokens) -> ToolOutputCap`** at `commands.rs:3114-3164`:
  - Under-budget passthrough (3115-3122)
  - Head: `safe_slice(content, head_chars)` where head = budget_chars × 0.75 (3127, 3131)
  - Tail: `char_indices().nth(skip_chars)` for non-ASCII safety (3137-3149)
  - Marker: `"\n\n[truncated from {N} tokens; ~{M} omitted in middle; storage_id tool_out_{millis}]\n\n"` (3154-3157)
- **`MAX_TOOL_RESULT_CHARS = 200_000`** at `commands.rs:432` — old 12k removed; format_tool_result is now safety net only.
- **Wire site** at `commands.rs:2541-2568` — single canonical happy-path conversation.push:
  - CTX-07 escape hatch: `if config.context.smart_injection_enabled { ... } else { content }` (2541, 2566)
  - Wrapped in `std::panic::catch_unwind(std::panic::AssertUnwindSafe(...))` (2542)
  - `log::info!("[CTX-05] tool '{}' output capped: ~{} → ~{} tokens (storage_id {})")` on truncation (2548-2554)

**Tests:** `phase32_cap_tool_output_under_budget_passthrough`, `_over_budget_truncates`, `_preserves_head_and_tail`, `_non_ascii_safe`, `_storage_id_when_truncated`, `phase32_format_tool_result_no_longer_truncates_at_12k`, `_still_caps_at_safety_ceiling`.

### SC-4 ✓ VERIFIED — DoctorPane Per-Section Token Breakdown

- **Wire type** `pub struct ContextBreakdown` at `brain.rs:216-230` (query_hash, model_context_window, total_tokens, sections HashMap, percent_used, timestamp_ms).
- **Accumulator** `LAST_BREAKDOWN: thread_local<RefCell<Vec<(String, usize)>>>` at `brain.rs:272-275`; helpers `clear_section_accumulator`, `record_section`, `read_section_breakdown` at `brain.rs:279-295`. Called from 35+ sites in `build_system_prompt_inner`.
- **`build_breakdown_snapshot(provider, model)`** at `brain.rs:322-360` — HashMap aggregate by label, chars/4 → tokens, capability_probe ctx_window lookup, NaN/inf-safe `percent_used` (`if ctx_window == 0 { 0.0 } else { ... .min(100.0) }`).
- **Tauri command** `get_context_breakdown() -> Result<ContextBreakdown, String>` at `brain.rs:372-376`.
- **Registration** at `lib.rs:685`: `brain::get_context_breakdown,`.
- **TS wrapper** at `src/lib/tauri/admin.ts:2082-2107` — `export type ContextBreakdown` + `getContextBreakdown()` via `invokeTyped`.
- **UI** at `src/features/admin/DoctorPane.tsx:107-209` — `ContextBudgetSection`:
  - Subscribes via `useTauriEvent(BLADE_EVENTS.CHAT_DONE, () => refresh())` (130-132) — no polling
  - Loading / empty / data-table / error (silent null per CTX-07) states
  - Sorted desc by token count; header `total / model_context_window / percent_used.toFixed(1)%`
  - Mounted in BOTH return paths (line 338 error, line 438 happy) — Doctor failure does NOT hide budget panel

**Tests:** `phase32_get_context_breakdown_after_prompt_build`, `_empty_when_no_prompt_built`, `_percent_used_clamped`, `phase32_breakdown_records_per_section`, `_clears_each_call`, `phase32_context_breakdown_default`, `_serializes`.

### SC-5 ✓ VERIFIED — CTX-07 Fallback Contract

- **`score_or_default(query, type, safe_default) -> f32`** at `brain.rs:551-572` — `catch_unwind(|| score_context_relevance(query, type))`; on `Ok(non_finite)` or `Err(_)` returns `safe_default` with `[CTX-07]` log::warn.
- **All 19 production gate sites** in `build_system_prompt_inner` route through `score_or_default(user_query, ..., 1.0)`. `grep -c "score_context_relevance(user_query"` returns 0 in brain.rs.
- **Cap site catch_unwind** at `commands.rs:2542` — on `Err(_)`: `log::warn!("[CTX-07] cap_tool_output panicked ...")` + falls through to original content (2558-2563).
- **Compaction backstop** at `commands.rs:336-339` (preserved from Plan 32-04).
- **Config kill-switch** `smart_injection_enabled` (config.rs:268-269, default true) — when false, every gate opens (`!smart || ...`) and legacy 140k/120k literals fire.

**Tests:** `phase32_score_or_default_returns_score_normally`, `_returns_safe_default_on_panic`, `_on_nan`, `_on_infinity`, **`phase32_build_system_prompt_survives_panic_in_scoring`** (the v1.1 regression fixture — forces every score to panic, asserts prompt > 100 bytes), `phase32_score_override_can_panic_safely`, integration `phase32_chat_survives_forced_panic_in_score_context_relevance`.

**Static gap:** Runtime CTX-07 toggle round-trip (set false, restart, send chat → identical-shape reply) cannot run in unit tests — Plan 32-07 SUMMARY removed the unit-level toggle test due to BLADE_CONFIG_DIR pollution; the runtime UAT (Task 2 Step 6) is the authoritative verification.

---

## Required Artifacts

| Artifact | Status | Anchors |
| - | - | - |
| `src-tauri/src/config.rs` | ✓ VERIFIED | ContextConfig + 6-place wire at 265-296, 426, 507, 654, 721, 882, 950 |
| `src-tauri/src/brain.rs` | ✓ VERIFIED | ContextBreakdown 216-230; helpers 279-295; build_breakdown 322-360; get_context_breakdown 372-376; score_or_default 551-572; gates 753-1075 |
| `src-tauri/src/commands.rs` | ✓ VERIFIED | model_context_window 164; compute_keep_recent 201; build_compaction_summary_prompt 236; compress 266-349; MAX 432; trigger 1581-1617; recovery 1659-1671; cap site 2541-2568; cap_tool_output 3114-3164 |
| `src-tauri/src/lib.rs` | ✓ VERIFIED | line 685: `brain::get_context_breakdown, // Phase 32 / CTX-06` |
| `src/lib/tauri/admin.ts` | ✓ VERIFIED | lines 2082-2107 (typed wrapper) |
| `src/features/admin/DoctorPane.tsx` | ✓ VERIFIED | ContextBudgetSection 107-209; mounts 338 + 438 |
| `src-tauri/tests/context_management_integration.rs` | ✓ VERIFIED | 2 tests pass (placeholder + CTX-07 boundary smoke) |

## Key Link Verification

| From | To | Via | Status |
| - | - | - | - |
| brain.rs gate sites (19) | score_context_relevance | score_or_default(user_query, type, 1.0) | ✓ WIRED |
| commands.rs:1607 | compress_conversation_smart | direct .await | ✓ WIRED |
| compress_conversation_smart | build_compaction_summary_prompt + complete_turn | line 325, 332 | ✓ WIRED |
| commands.rs:2543 | cap_tool_output | inside catch_unwind closure | ✓ WIRED |
| brain.rs:374 | config::load_config | get_context_breakdown shim | ✓ WIRED |
| brain.rs:341 | capability_probe::infer_capabilities | direct call (3rd arg None) | ✓ WIRED |
| lib.rs generate_handler! | brain::get_context_breakdown | line 685 | ✓ WIRED |
| DoctorPane ContextBudgetSection | get_context_breakdown command | getContextBreakdown wrapper | ✓ WIRED |
| ContextBudgetSection | chat_done event | `useTauriEvent(BLADE_EVENTS.CHAT_DONE, refresh)` | ✓ WIRED |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Real Data | Status |
| - | - | - | - | - |
| ContextBudgetSection | breakdown | invokeTyped get_context_breakdown | YES when LAST_BREAKDOWN populated | ✓ FLOWING |
| ContextBreakdown.sections | aggregated chars/4 | LAST_BREAKDOWN populated by 35+ record_section calls in brain.rs | YES | ✓ FLOWING |
| compress_conversation_smart summary | LLM response | providers::complete_turn (cheap model) | YES — CTX-07 fallback to truncate_to_budget on Err | ✓ FLOWING |
| cap_tool_output content | tool result | native_tools::execute or format_tool_result | YES | ✓ FLOWING |

Empty-accumulator surfaced honestly ("No prompt built this session yet") — not a stub.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| - | - | - | - |
| 44 phase32 unit tests pass | `cargo test --lib phase32` | 44 passed, 0 failed | ✓ PASS |
| Integration test passes | `cargo test --test context_management_integration` | 2 passed, 0 failed | ✓ PASS |
| Runtime end-to-end behaviors | UAT | n/a | ? SKIP — see human_verification |

## Requirements Coverage

| Req | Plan | Description | Status | Evidence |
| - | - | - | - | - |
| CTX-01 | 32-03 | Selective injection — sections 0–8 gated | ✓ SATISFIED | brain.rs:752-1075 |
| CTX-02 | 32-03 | Identity / vision / hearing scoring arms | ✓ SATISFIED | score_context_relevance match arms |
| CTX-03 | 32-04 | Token-aware keep_recent + LLM summary v7610 | ✓ SATISFIED | commands.rs:201-235, 236-261 |
| CTX-04 | 32-04 | Per-model proactive compaction trigger at 80% | ✓ SATISFIED | commands.rs:1581-1617, 1659-1671 |
| CTX-05 | 32-05 | Per-tool-output cap with head + tail + marker | ✓ SATISFIED | commands.rs:3114-3164, 2541-2568 |
| CTX-06 | 32-06 | DoctorPane per-section token breakdown | ✓ SATISFIED | brain.rs:322-376 + DoctorPane.tsx:107-209 |
| CTX-07 | 32-07 | Smart-path fallback to naive on any error | ✓ SATISFIED (static) / ? NEEDS HUMAN (toggle round-trip) | brain.rs:551-572 + commands.rs:2542 + smart_injection_enabled |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| - | - | - | - | - |
| commands.rs | 1591 | Hardcoded `140_000` in CTX-07 fallback branch | ℹ️ Info | Intentional — naive-path safety net per CONTEXT.md |
| commands.rs | 1663 | Hardcoded `120_000` in CTX-07 recovery fallback | ℹ️ Info | Same lock |
| brain.rs | 353 | `query_hash: String::new()` (not populated) | ⚠️ Warn | Documented in code; deferred to Plan 32-07+; does not affect SC-4 |

No blocker anti-patterns. No empty-implementation stubs in production paths. No placeholder/TODO comments in load-bearing logic.

## Human Verification Required

7 items listed in YAML frontmatter `human_verification:` (queries 1-2 = SC-1; query 3 = SC-2; query 4 = SC-3; query 5 = SC-5 toggle; query 6 = SC-4 cross-viewport; query 7 = verify:all). All operator-deferred per Plan 32-07 Task 2 = `checkpoint:human-verify` + CLAUDE.md Verification Protocol.

## Gaps Summary

**No blocking gaps for static-analysis verification.** All 5 ROADMAP Success Criteria have load-bearing code anchors. 44 phase32 unit tests + 2 integration tests pass. CTX-07 fallback contract enforced at wrapper level (score_or_default) and at the cap site (catch_unwind+AssertUnwindSafe).

**Outstanding:** Plan 32-07 Task 2 — operator runtime UAT — is `checkpoint:human-verify` per CLAUDE.md Verification Protocol. Until Arnav exercises the 7-step UAT script and approves with a substantive observation, the phase is **not** closed. This is by design; it is the v1.1 lesson encoded as policy.

**Recommendation:** Status remains `human_needed`. Closing requires:

1. `npm run tauri dev` cleanly starts.
2. Exercise each numbered test in `human_verification:` frontmatter.
3. Save 1280×800 + 1100×700 screenshots to `docs/testing ss/` (literal space).
4. Read at least one screenshot back with the Read tool (CLAUDE.md step 4).
5. Reply "approved" + a one-line observation.

A follow-up agent then appends UAT findings to `32-07-SUMMARY.md` § UAT Findings, and the phase ships.

---

_Verified: 2026-05-05 — goal-backward static analysis (no dev server started, per orchestrator instruction)_
_Verifier: Claude (gsd-verifier, opus 4.7 1M ctx)_
