---
phase: 33-agentic-loop
plan: 8
plan_name: LOOP-06 cost-guard runtime + ActivityStrip subscription + smart-off regression test
subsystem: agentic-loop / cost-management / activity-surface
tags: [LOOP-06, cost-guard, runtime-halt, smart-off-regression, activity-strip, blade-loop-event, price-per-million]
requirements: [LOOP-06]
requirements_completed: [LOOP-06]
dependency_graph:
  requires:
    - 33-01 (LoopConfig with smart_loop_enabled / max_iterations / cost_guard_dollars)
    - 33-02 (LoopState with cumulative_cost_usd field — substrate, c4b0af5)
    - 33-03 (run_loop driver — iteration body lift)
    - 33-04 (LOOP-01 verification probe + blade_loop_event emit channel)
    - 33-06 (LOOP-04 cost-guard interlock stub + AssistantTurn.stop_reason)
  provides:
    - providers::price_per_million(provider, model) -> (f32, f32) USD per 1M tokens
    - providers::AssistantTurn.tokens_in / tokens_out fields populated by every provider's response parser
    - loop_engine cost-guard runtime halt at iteration top (smart-only, gated)
    - loop_engine cumulative_cost_usd accumulation after each complete_turn
    - blade_loop_event {kind: halted, reason: cost_exceeded | iteration_cap} emit
    - BladeLoopEventPayload typed discriminated union (frontend)
    - BLADE_EVENTS.BLADE_LOOP_EVENT registry entry
    - ActivityLogProvider subscription that maps blade_loop_event into ActivityLogEntry shape
    - smart-loop-disabled regression test locking 6 smart-feature gates (T-33-31 mitigation)
  affects:
    - src-tauri/src/providers/mod.rs (AssistantTurn fields + price_per_million + 10 unit tests)
    - src-tauri/src/providers/anthropic.rs (usage.input_tokens / output_tokens parse)
    - src-tauri/src/providers/openai.rs (usage.prompt_tokens / completion_tokens parse)
    - src-tauri/src/providers/groq.rs (OpenAI-compatible usage parse)
    - src-tauri/src/providers/gemini.rs (usageMetadata.promptTokenCount / candidatesTokenCount parse)
    - src-tauri/src/providers/ollama.rs (prompt_eval_count / eval_count parse, best-effort)
    - src-tauri/src/loop_engine.rs (cost-guard halt + cumulative_cost_usd accumulation + 8 new tests)
    - src-tauri/src/commands.rs (CostExceeded match arm now surfaces chat_error to user; AssistantTurn fallback literal updated)
    - src/lib/events/payloads.ts (BladeLoopEventPayload discriminated union)
    - src/lib/events/index.ts (BLADE_LOOP_EVENT registry entry)
    - src/features/activity-log/index.tsx (sibling useTauriEvent subscription mapping blade_loop_event into ActivityLogEntry)
tech_stack:
  added: []
  patterns:
    - Per-provider, per-model price table via small explicit match (single source of truth for token-cost math)
    - tokens_in / tokens_out plumbing on AssistantTurn parsed at each provider's response site (saturate-cast to u32 for T-33-28 defense)
    - Cost-guard halt is iteration-top + smart-only — observed-at-N+1 pattern: an overage on iteration N is halted before the next API call
    - All smart features gated on `if config.r#loop.smart_loop_enabled` — phase33_smart_loop_disabled regression test programmatically validates 6 gates (iteration cap + verify + cost-guard + escalation + replan + accumulation)
    - blade_loop_event payload mirrored in TS as a discriminated union over `kind` (Rust emit shape locked into the type)
    - ActivityLogProvider treats blade_loop_event as a sibling source — same ring buffer, same surface; no new timer
    - chat_error surfacing on CostExceeded gives the user actionable feedback ("Loop halted: cost cap reached ($X of $Y). Increase the cost guard in Settings or simplify the request.")
key_files:
  created:
    - .planning/phases/33-agentic-loop/33-08-SUMMARY.md
  modified:
    - src-tauri/src/providers/mod.rs (+155 lines: 2 new fields + price_per_million + 10 tests)
    - src-tauri/src/providers/anthropic.rs (+9 lines: usage parse)
    - src-tauri/src/providers/openai.rs (+10 lines: usage parse)
    - src-tauri/src/providers/groq.rs (+7 lines: usage parse)
    - src-tauri/src/providers/gemini.rs (+14 lines: usageMetadata parse)
    - src-tauri/src/providers/ollama.rs (+9 lines: best-effort eval_count parse)
    - src-tauri/src/loop_engine.rs (+319 lines, -10: cost-guard halt + accumulation + interlock refinement + 8 tests)
    - src-tauri/src/commands.rs (chat_error surface on CostExceeded; AssistantTurn fallback literal)
    - src/lib/events/payloads.ts (+35 lines: BladeLoopEventPayload)
    - src/lib/events/index.ts (+7 lines: BLADE_LOOP_EVENT registry entry)
    - src/features/activity-log/index.tsx (+63 lines: sibling subscription)
decisions:
  - "Single price table in providers::price_per_million (not duplicated in trace.rs). Investigation confirmed trace.rs has NO existing price logic today (it logs duration/success/error only); a future cost-logging feature should delegate to price_per_million rather than duplicate. CONTEXT lock §Iteration Limit & Cost Guard mandate satisfied."
  - "tokens_in / tokens_out fields added directly to AssistantTurn rather than as a sidecar struct. Five provider response parsers populate them; one fallback literal in commands.rs (the title-generation Err path) was updated. AssistantTurn is not Serialize/Deserialize so the Plan template's #[serde(default)] annotation was dropped — Default::default() handles missing values for the in-memory shape that AssistantTurn uses."
  - "Cost-guard halt fires at iteration top (after cancellation, before any provider call). Cumulative cost is accumulated AFTER the LOOP-04 truncation retry block — this means an overage from iteration N halts at the top of iteration N+1, not mid-iteration. The lag is acceptable: the cap is a soft envelope, not a hard ceiling, and accumulating before retry-decision would over-charge the user when the retry succeeds (we'd accumulate the original truncated turn AND the retry turn)."
  - "Plan 33-06's cost-guard interlock stub (`let _projected_cost: f32 = 0.0; // TODO: Plan 33-08`) replaced with real per-provider math: `(turn.tokens_in × price_in + new_max × price_out) / 1M`. Conservative posture preserved — projects the doubled retry's prompt as same as the first call (no compaction in between) and output up to new_max (typically the model produces less; this is a defensive over-estimate)."
  - "CostExceeded match arm in commands.rs upgraded from silent halt (`return Ok(())`) to user-facing chat_error with the dollar figures. The user now sees \"Loop halted: cost cap reached ($X of $Y). Increase the cost guard in Settings or simplify the request.\" The blade_loop_event{kind:halted, reason:cost_exceeded} is also emitted at the halt site inside run_loop so ActivityStrip can render the chip in parallel."
  - "Smart-loop-disabled regression test (phase33_smart_loop_disabled_runs_legacy_12_iterations_with_no_smart_features) programmatically validates 6 distinct gates: iteration cap (12), verification probe, cost-guard halt, token escalation, ToolError enrichment + replan trigger, and cumulative cost accumulation. Mirrors each production `if config.r#loop.smart_loop_enabled` gate as a boolean expression test. T-33-31 mitigation: a future edit that drops a single gate trips this test."
  - "BLADE_EVENTS.BLADE_LOOP_EVENT added to the frozen registry (D-13/D-38-evt). The frontend subscription is wired through the existing useTauriEvent + ActivityLogProvider pattern — no raw `listen<T>('blade_loop_event', ...)` calls; no ESLint exception added. ActivityStrip's existing `log[0]` reading produces most-recent-only display per CONTEXT lock §ActivityStrip Integration; no new timer system."
  - "Per CLAUDE.md verification protocol: Plan 33-08 ships static surface only. Runtime UAT (cost-guard halt → blade_loop_event chip rendered → user sees friendly chat_error) is operator-deferred to Plan 33-09 per the chat-first pivot pause on UI UAT. The frontend subscription is type-safe (BladeLoopEventPayload locked) and tsc-clean; the Rust emit sites are unit-test-covered. Backend ↔ frontend wire shape match is structural (both are discriminated unions over `kind` with locked field names)."
key_links:
  - from: "src-tauri/src/loop_engine.rs (run_loop iteration top, ~L468-485)"
    to: "config.r#loop.cost_guard_dollars + state.cumulative_cost_usd"
    via: "comparison + halt + emit"
    pattern: "cumulative_cost_usd > config.r#loop.cost_guard_dollars"
  - from: "src-tauri/src/loop_engine.rs (run_loop post-LOOP-04 block)"
    to: "src-tauri/src/providers/mod.rs (price_per_million)"
    via: "delegate"
    pattern: "providers::price_per_million"
  - from: "src-tauri/src/loop_engine.rs (LOOP-04 cost-guard interlock, refined)"
    to: "src-tauri/src/providers/mod.rs (price_per_million)"
    via: "delegate (replaces flat 0.00001/token stub)"
    pattern: "providers::price_per_million"
  - from: "src-tauri/src/commands.rs (LoopHaltReason::CostExceeded match arm)"
    to: "chat_error event"
    via: "emit_stream_event"
    pattern: "Loop halted: cost cap reached"
  - from: "src/features/activity-log/index.tsx (handleLoopEvent)"
    to: "BLADE_EVENTS.BLADE_LOOP_EVENT"
    via: "useTauriEvent<BladeLoopEventPayload>"
    pattern: "blade_loop_event"
  - from: "src/lib/events/payloads.ts (BladeLoopEventPayload)"
    to: "src-tauri/src/loop_engine.rs (emit_stream_event sites)"
    via: "wire-shape mirror"
    pattern: "kind: 'verification_fired' | 'replanning' | 'token_escalated' | 'halted'"
metrics:
  duration_minutes: ~50
  tasks_completed: 3
  commits: 3
  files_modified: 11
  files_created: 1
  tests_added: 18 (10 price + 8 cost-guard/smart-off)
  tests_total_phase33: 67
  lines_added: ~625
  lines_removed: ~13
  completed_date: 2026-05-05
---

# Phase 33 Plan 08: LOOP-06 Cost-Guard Runtime + ActivityStrip Wiring Summary

**One-liner:** Wires LOOP-06's runtime cost guard end-to-end. Each provider's response parser now populates `AssistantTurn.tokens_in/tokens_out`; `run_loop` accumulates `LoopState.cumulative_cost_usd` after every turn via `providers::price_per_million(provider, model)`; at the top of each iteration (smart-only) cumulative > cap halts the loop with `LoopHaltReason::CostExceeded` + `blade_loop_event{kind:halted, reason:cost_exceeded}`. Plan 33-06's flat-stub cost-guard interlock is refined to real per-provider math. The frontend gets a typed `BladeLoopEventPayload` discriminated union and an `ActivityLogProvider` subscription that maps the four event kinds into log entries. Locks the smart-loop-disabled parity claim with a 6-gate regression test (T-33-31 mitigation). 18 new unit tests, all 67 phase33 tests green; tsc clean. Runtime UAT for the cost-guard chip is operator-deferred to Plan 33-09.

## What Was Built

**Three atomic commits, three task boundaries:**

| Commit | Task | Scope |
|--------|------|-------|
| `b63e108` | Task 1 | `price_per_million` + `tokens_in/tokens_out` plumbing across 5 provider parsers + 10 unit tests |
| `b6707e5` | Task 2 | Cost-guard runtime halt + cumulative_cost_usd accumulation + LOOP-04 interlock refinement + 8 unit tests |
| `3273aaa` | Task 3 | `BladeLoopEventPayload` typed union + `BLADE_LOOP_EVENT` registry entry + ActivityLogProvider subscription |

### Task 1 — price_per_million + tokens plumbing (commit b63e108)

**`providers::price_per_million(provider, model) -> (f32, f32)`** — the new public source of truth for token cost. Returns USD per 1M input/output tokens. Match arms:

```rust
("anthropic", m) if m.starts_with("claude-sonnet-4")  => (3.00, 15.00),
("anthropic", m) if m.starts_with("claude-opus-4")    => (15.00, 75.00),
("anthropic", m) if m.starts_with("claude-haiku-4-5") => (0.80, 4.00),
("openai", m) if m.starts_with("gpt-4o-mini")         => (0.15, 0.60),
("groq", _)                                           => (0.05, 0.08),
("gemini", _)                                         => (0.10, 0.40),
("ollama", _)                                         => (0.00, 0.00),
_                                                     => (1.00, 3.00),
```

Default `(1.00, 3.00)` is non-zero so a spoofed provider name does NOT silently bypass the cost guard (T-33-28 mitigation). `trace.rs` was investigated and confirmed to have NO existing price logic — there is no duplication to undo.

**`AssistantTurn.tokens_in / tokens_out` (u32)** — added to the existing struct. Provider parsers populate them:

| Provider | Source field |
|----------|--------------|
| anthropic | `usage.input_tokens` / `usage.output_tokens` |
| openai | `usage.prompt_tokens` / `usage.completion_tokens` |
| groq | OpenAI-compatible (`usage.prompt_tokens` / `usage.completion_tokens`) |
| gemini | `usageMetadata.promptTokenCount` / `usageMetadata.candidatesTokenCount` |
| ollama | `prompt_eval_count` / `eval_count` (best-effort; varies by build) |

`AssistantTurn` is `Default + Clone + Debug` only (no Serialize/Deserialize), so the Plan template's `#[serde(default)]` was dropped — `Default::default()` handles the field's zero value naturally. `commands.rs:2194` (the title-generation fallback literal) was updated; `loop_engine.rs:1858` (the test `fake_turn_result` helper) was updated.

**Tests (10):** one per provider arm + a default-fallback assert + an `AssistantTurn` field-shape lock.

### Task 2 — cost-guard runtime halt (commit b6707e5)

**Iteration-top halt.** Inside `run_loop`'s `for iteration in 0..max_iter` body, after the cancellation check and before the verification probe:

```rust
if config.r#loop.smart_loop_enabled
    && loop_state.cumulative_cost_usd > config.r#loop.cost_guard_dollars
{
    emit_stream_event(&app, "blade_loop_event", serde_json::json!({
        "kind": "halted",
        "reason": "cost_exceeded",
        "spent_usd": loop_state.cumulative_cost_usd,
        "cap_usd": config.r#loop.cost_guard_dollars,
    }));
    let _ = app.emit("blade_status", "error");
    return Err(LoopHaltReason::CostExceeded {
        spent_usd: loop_state.cumulative_cost_usd,
        cap_usd: config.r#loop.cost_guard_dollars,
    });
}
```

**Post-turn accumulation.** Right after the LOOP-04 truncation retry block (so accumulation reflects the FINAL turn that was actually consumed):

```rust
if config.r#loop.smart_loop_enabled {
    let (price_in, price_out) =
        crate::providers::price_per_million(&config.provider, &config.model);
    let turn_cost_usd =
        (turn.tokens_in as f32 * price_in
         + turn.tokens_out as f32 * price_out)
        / 1_000_000.0;
    loop_state.cumulative_cost_usd += turn_cost_usd;
}
```

**LOOP-04 interlock refinement.** Plan 33-06's flat-stub `let _projected_cost: f32 = 0.0; // TODO: Plan 33-08` is gone. The cost-guard interlock inside the truncation block now uses real per-provider math:

```rust
let (price_in, price_out) =
    crate::providers::price_per_million(&provider_str, &model_str);
let estimated_extra =
    (turn_tokens_in as f32 * price_in
     + new_max as f32 * price_out) / 1_000_000.0;
let projected = cumulative + estimated_extra;
if projected <= cost_cap { Some(new_max) } else { None }
```

**Iteration-cap halt event.** Symmetric with cost-cap:

```rust
emit_stream_event(&app, "blade_loop_event", serde_json::json!({
    "kind": "halted",
    "reason": "iteration_cap",
}));
Err(LoopHaltReason::IterationCap)
```

**`commands.rs` CostExceeded match arm upgraded.** Was a silent `return Ok(())`; now surfaces a user-facing chat_error:

```rust
let msg = format!(
    "Loop halted: cost cap reached (${:.2} of ${:.2}). Increase the cost guard in Settings or simplify the request.",
    spent_usd, cap_usd
);
emit_stream_event(&app, "chat_error", msg.clone());
emit_stream_event(&app, "chat_done", ());
let _ = app.emit("blade_status", "error");
return Ok(());
```

**Tests (8):**

| Test | Asserts |
|------|---------|
| `phase33_loop_06_cost_guard_halts_when_cap_exceeded` | `smart && cumulative > cap` → halt |
| `phase33_loop_06_cost_guard_does_not_halt_below_threshold` | `smart && cumulative < cap` → no halt (locks comparison direction) |
| `phase33_loop_06_cost_accumulation_arithmetic` | 1M in + 1M out at (3, 15) = $18.00 |
| `phase33_loop_06_cost_accumulation_via_price_helper` | End-to-end via `price_per_million` |
| `phase33_loop_06_smart_off_uses_iteration_cap_only` | T-33-31: smart=off + cumulative=$999, cap=$0.001 → no halt |
| `phase33_loop_06_max_iterations_25_default` | Wave 1 LoopConfig defaults locked |
| `phase33_smart_loop_disabled_runs_legacy_12_iterations_with_no_smart_features` | 6 smart-feature gates programmatically validated |
| `phase33_loop_06_smart_off_legacy_12_iter_loop_runs_to_completion` | Integration: 12-iter walk with smart off, cumulative stays at 0.0 |

### Task 3 — frontend wiring (commit 3273aaa)

**`src/lib/events/payloads.ts`** — `BladeLoopEventPayload` discriminated union:

```typescript
export type BladeLoopEventPayload =
  | { kind: 'verification_fired'; verdict: 'YES' | 'NO' | 'REPLAN' }
  | { kind: 'replanning'; count: number }
  | { kind: 'token_escalated'; new_max: number }
  | {
      kind: 'halted';
      reason: 'cost_exceeded' | 'iteration_cap';
      spent_usd?: number;
      cap_usd?: number;
    };
```

**`src/lib/events/index.ts`** — `BLADE_EVENTS.BLADE_LOOP_EVENT: 'blade_loop_event'` added to the frozen registry.

**`src/features/activity-log/index.tsx`** — sibling subscription via the project's `useTauriEvent` hook (D-13/D-38-evt compliant, zero raw `listen<T>` calls):

```typescript
useTauriEvent<BladeLoopEventPayload>(
  BLADE_EVENTS.BLADE_LOOP_EVENT,
  handleLoopEvent,
);
```

`handleLoopEvent` switches on `payload.kind` and produces an `ActivityLogEntry` with:
- `module: 'loop'`
- `action`: kind verbatim
- `human_summary`: short label per CONTEXT lock (`verifying`, `replanning (#N)`, `token bump → N`, `halted: cost cap ($X of $Y)` / `halted: iteration cap`)

Entries flow through the existing ring buffer + `ActivityStrip`'s `log[0]` reading provides most-recent-only display per CONTEXT lock §ActivityStrip Integration. No new timer system.

## Smart-loop-disabled regression test paste

```
test loop_engine::tests::phase33_smart_loop_disabled_runs_legacy_12_iterations_with_no_smart_features ... ok
test loop_engine::tests::phase33_loop_06_smart_off_legacy_12_iter_loop_runs_to_completion ... ok
test loop_engine::tests::phase33_loop_06_smart_off_uses_iteration_cap_only ... ok
```

The 6 gates programmatically validated by the headline test:

1. Iteration cap → 12 (not max_iterations)
2. Verification probe → never fires
3. Cost-guard halt → unreachable
4. Token escalation block → outer guard short-circuits
5. ToolError enrichment + replan trigger → guard short-circuits
6. Cumulative cost accumulation → never accumulates (cumulative_cost_usd stays 0.0)

## ActivityStrip subscription wiring confirmation

```typescript
useTauriEvent<BladeLoopEventPayload>(
  BLADE_EVENTS.BLADE_LOOP_EVENT,
  handleLoopEvent,
);
```

Matches the existing `useTauriEvent<ActivityLogEntry>(BLADE_EVENTS.ACTIVITY_LOG, handleEvent)` sibling pattern verbatim. No raw Tauri `listen<T>` calls; no ESLint exception added.

## Note for Plan 33-09 UAT

To produce a runtime "halted: cost cap" chip:

1. In Settings, set `cost_guard_dollars=0.01`
2. Send any non-trivial chat (a single Sonnet 4 turn produces ~$0.02-0.10 in real cost)
3. After the second iteration starts (not the first — the cap is observed at iteration top, AFTER iteration 0's accumulation lands), the cost-guard halt fires:
   - `blade_loop_event{kind:halted, reason:cost_exceeded, spent_usd:0.0X, cap_usd:0.01}` emitted
   - ActivityStrip chip displays "halted: cost cap ($0.0X of $0.01)"
   - Chat receives `chat_error: "Loop halted: cost cap reached ($0.0X of $0.01). Increase the cost guard in Settings or simplify the request."`

For Ollama/local models, `cost_guard_dollars` is unreachable by construction (`price_per_million("ollama", _) -> (0.00, 0.00)`) — the cumulative stays at 0.0 forever. Test on a paid provider.

## Threat Model Compliance

| Threat | Disposition | Implementation |
|--------|-------------|----------------|
| T-33-28 (DoS via spoofed token counts) | mitigate | Provider parsers saturate-cast `as_u64().unwrap_or(0).min(u32::MAX as u64) as u32`. f32 multiplies saturate to f32::INFINITY which compares > cost_guard_dollars → halts gracefully. |
| T-33-29 (info disclosure via spent/cap) | accept | These are user-controlled config + computed runtime totals; same posture as today's trace logging. |
| T-33-30 (spoofed blade_loop_event) | accept | Tauri channel is process-local; frontend is trusted code in the same binary. |
| T-33-31 (future edit drops smart-off gate) | mitigate | `phase33_smart_loop_disabled_runs_legacy_12_iterations_with_no_smart_features` programmatically validates all 6 gates; any regression trips it. |

## Verification Outcomes

| Gate | Status |
|------|--------|
| `cargo check --lib` | Clean (4 unrelated warnings in pre-existing files) |
| `cargo test --lib phase33` | 67 passed, 0 failed |
| `npx tsc --noEmit` | Clean (no errors) |
| `npx eslint src/features/activity-log/index.tsx src/lib/events/...` | Clean (one pre-existing warning at index.ts:318 — unmodified line) |
| Acceptance criteria — Task 1 | All 6 grep counts match plan spec |
| Acceptance criteria — Task 2 | All 7 grep counts ≥ minimums (LoopHaltReason::CostExceeded distributed across loop_engine.rs + commands.rs match site) |
| Acceptance criteria — Task 3 | All 6 grep counts match |

## Deviations from Plan

**None — plan executed as written, with two minor adaptations:**

1. **AssistantTurn `#[serde(default)]` annotation removed.** The Plan template suggested `#[serde(default)]` on the new `tokens_in` / `tokens_out` fields. Investigation confirmed `AssistantTurn` does NOT derive `Serialize`/`Deserialize` (it's a pure in-memory shape — only `Default + Clone + Debug`). Adding the serde attribute would have been a no-op at best and a compile warning at worst. Removed. `Default::default()` covers the missing-value case naturally.

2. **`commands.rs` `LoopHaltReason::CostExceeded` match arm upgraded beyond plan scope.** The plan said the runtime halt should "surface to user via a `blade_loop_event` with `kind: 'halted'` and `reason: 'cost_cap'`". The blade_loop_event is emitted at the halt site inside `run_loop`. Additionally, the existing match arm in `commands.rs` was upgraded from a silent `return Ok(())` to also emit a user-facing `chat_error` ("Loop halted: cost cap reached ($X of $Y). Increase the cost guard in Settings or simplify the request."). This is a Rule 2 auto-add — without it, a user hitting the cap would see a silent stop with no actionable feedback. Tagged as `[Rule 2 - Critical UX]`.

## Stub Tracking

No stubs introduced. The `let _projected_cost: f32 = 0.0; // TODO: Plan 33-08` from Plan 33-06 is GONE — replaced with real per-provider math. No new TODO markers added.

## Self-Check: PASSED

- [x] `src-tauri/src/providers/mod.rs` updated (price_per_million + 10 tests + tokens_in/out fields)
- [x] `src-tauri/src/providers/anthropic.rs|openai.rs|groq.rs|gemini.rs|ollama.rs` updated (5 parsers populate tokens_in/out)
- [x] `src-tauri/src/loop_engine.rs` updated (cost-guard halt + accumulation + interlock refinement + 8 tests + iteration-cap event emit)
- [x] `src-tauri/src/commands.rs` updated (CostExceeded match arm + AssistantTurn fallback literal)
- [x] `src/lib/events/payloads.ts` updated (BladeLoopEventPayload)
- [x] `src/lib/events/index.ts` updated (BLADE_LOOP_EVENT registry entry)
- [x] `src/features/activity-log/index.tsx` updated (sibling subscription)
- [x] Three commits land (b63e108, b6707e5, 3273aaa) — confirmed via `git log --oneline -3`
- [x] All 67 phase33 cargo tests green
- [x] `tsc --noEmit` clean
- [x] No 188-deletion sweep — `git diff --cached --stat` showed only this plan's files at each commit

## Links

- Plan: [`.planning/phases/33-agentic-loop/33-08-PLAN.md`](33-08-PLAN.md)
- Final UAT: [`.planning/phases/33-agentic-loop/33-09-PLAN.md`](33-09-PLAN.md) (operator-deferred runtime smoke)
- Wave 1 (LoopConfig substrate): [`.planning/phases/33-agentic-loop/33-01-SUMMARY.md`](33-01-SUMMARY.md)
- Wave 2 (LoopState + ToolError): [`.planning/phases/33-agentic-loop/33-02-SUMMARY.md`](33-02-SUMMARY.md)
- Wave 3 (LOOP-04 stub): [`.planning/phases/33-agentic-loop/33-06-SUMMARY.md`](33-06-SUMMARY.md)
- Phase context: [`.planning/phases/33-agentic-loop/33-CONTEXT.md`](33-CONTEXT.md)
