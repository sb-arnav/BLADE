---
phase: 34-resilience-session
reviewed: 2026-05-06T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src-tauri/src/config.rs
  - src-tauri/src/loop_engine.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/resilience/mod.rs
  - src-tauri/src/resilience/stuck.rs
  - src-tauri/src/resilience/fallback.rs
  - src-tauri/src/session/mod.rs
  - src-tauri/src/session/log.rs
  - src-tauri/src/session/resume.rs
  - src-tauri/src/session/list.rs
  - src-tauri/src/providers/mod.rs
  - src/lib/events/payloads.ts
  - src/features/sessions/SessionsView.tsx
findings:
  blocker: 2
  high: 3
  medium: 4
  low: 2
  total: 11
status: issues_found
---

# Phase 34: Code Review Report — Resilience + Session Persistence

**Reviewed:** 2026-05-06
**Depth:** deep (cross-file: config wire-up, run_loop ↔ SessionWriter ↔ commands, payloads.ts ↔ Rust emit sites, resume hand-off ↔ SessionsView)
**Status:** issues_found

## Summary

Phase 34 ships substantial scaffolding (ResilienceConfig + SessionConfig 6-place wire-up, SessionWriter with flock + catch_unwind discipline, 5-pattern stuck detector, two-tier cost guard, provider-fallback chain with backoff, JSONL replay) and the static gates pass. However, two BLOCKER bugs would have shipped DOA and three HIGH-severity issues compromise the feature's nominal scope:

1. **The "per-conversation" cost cap and the JSONL session are actually per-`send_message_stream` call** — every user message creates a fresh `LoopState` (zeros `conversation_cumulative_cost_usd`) and a fresh `SessionWriter` with a brand-new ULID. The CONTEXT lock §Backward Compatibility data-integrity guarantee ("Per-conversation cost cap still enforced at 100%") collapses to "per-single-turn" — the lifetime cap is unreachable in practice, and forking / resuming after the very first user turn loses the running total.
2. **Resume is a no-op visually** — `SessionsView.handleResume` calls `resumeSession()` and then `openRoute('chat')`, but the returned `ResumedConversation.messages` is discarded and the next `send_message_stream` opens a brand-new `session_id`. The user clicks Resume, sees the Chat surface load, and finds an empty conversation — exactly the v1.1 retract-class regression the verification protocol was written to prevent.

Static-gate-clean does not equal runtime-clean. Plan 34-11 Task 6 was operator-deferred, and these two bugs would have surfaced in the first 30 seconds of UAT.

## BLOCKER Issues

### BL-01: "Per-conversation" scope is actually per-message-stream — cost guard, cost-meter, 80% latch, stuck state, and SessionWriter all reset every user turn

**Files:**
- `src-tauri/src/loop_engine.rs:561` (`let mut loop_state = LoopState::default();`)
- `src-tauri/src/commands.rs:1043-1054` (fresh `SessionWriter::new` on every `send_message_stream`)
- `src-tauri/src/loop_engine.rs:65-110` (`LoopState` carries `conversation_cumulative_cost_usd`, `cost_warning_80_emitted`, `consecutive_no_tool_turns`, `compactions_this_run`, `last_progress_iteration`, `recent_actions`, …)

**Issue:** Every call to `send_message_stream_inline` constructs a fresh `LoopState::default()` inside `run_loop` and a fresh `SessionWriter` (with a NEW ULID). Consequences:

1. `conversation_cumulative_cost_usd` resets to 0.0 at the start of every user message. The 100% halt at `loop_engine.rs:656` and the 80% warn at `:679` therefore measure spend within the **current single user turn**, not the conversation lifetime. A 4-turn conversation that spends $20 / $20 / $20 / $20 total $80 against a $25 cap will never trip — each turn looks at $20 < $25 in isolation.
2. Plan 34-06-SUMMARY claims "Plan 34-08's SessionWriter persists conversation_cumulative_cost_usd across reload via the cost_update LoopEvent emitted at iteration end — reopened sessions restore the running total." There is **no code** that reads back `cost_update` events to seed `LoopState.conversation_cumulative_cost_usd` on send_message_stream entry. The seed path does not exist.
3. The 80% warn latch (`cost_warning_80_emitted`) resets per turn → users may see the warning fire repeatedly on consecutive expensive turns.
4. RES-01 stuck-detection state (`consecutive_no_tool_turns`, `compactions_this_run`, `last_progress_iteration`, `recent_actions`) ALL reset per turn — a 5-turn monologue across 5 messages would never trip MonologueSpiral because each `LoopState` sees only the current turn's tool-call activity.
5. The CONTEXT lock §Backward Compatibility absolute guarantee ("Per-conversation cost cap still enforced at 100% — data integrity > smart features") is mis-stated by implementation: the data-integrity halt is per-send_message_stream-call, not per-conversation.

**Fix:** Either (a) thread `conversation_cumulative_cost_usd` and the latch through a Tauri-state struct keyed by session_id and reload from the JSONL on `send_message_stream` entry; or (b) re-scope the docs/UI to call this "per-turn cost cap" and rename the config field. Option (a) is the documented intent. Concrete sketch:

```rust
// In send_message_stream_inline, BEFORE run_loop:
let prior_spent = if !session_id.is_empty() {
    crate::session::list::get_conversation_cost(session_id.clone())
        .await
        .ok()
        .and_then(|v| v.get("spent_usd").and_then(|s| s.as_f64()))
        .unwrap_or(0.0) as f32
} else { 0.0 };

let halt = run_loop(/* ... */, prior_spent, /* ... */).await;
// Inside run_loop:
//   loop_state.conversation_cumulative_cost_usd = prior_spent;
//   loop_state.cost_warning_80_emitted = prior_spent > 0.8 * cap;
```

Additionally: rebuild SessionWriter with the **existing** session_id when the frontend supplies one (instead of always `Ulid::new()`), and skip the SessionMeta append when resuming.

---

### BL-02: SessionsView "Resume" button is a visual no-op — returned messages are discarded; next chat starts a fresh session

**Files:**
- `src/features/sessions/SessionsView.tsx:57-80` (`handleResume`)
- `src-tauri/src/commands.rs:1043-1064` (`SessionWriter::new` always generates a fresh `Ulid::new()`; `session_id` is not threaded from a frontend-supplied resume target)

**Issue:** `handleResume` invokes `resumeSession(id)` then immediately `openRoute('chat')` — the returned `ResumedConversation.messages` is dropped. The chat surface re-renders empty; the user types a new message; `send_message_stream_inline` runs `SessionWriter::new(...)` which generates a brand-new ULID. The "resumed" conversation is never actually loaded into the React state, and the new turn is logged to a fresh JSONL with no `parent` linkage.

The component comment acknowledges this (lines 62-71: "the resume hand-off here is best-effort + navigation. A v1.6 follow-up wires the rebuilt messages directly into ChatProvider state via an exposed `setHistory` action"). But the surface is shipped today as if Resume works. Operator UAT will hit this in the first click.

**Fix:** Either (a) wire `ChatProvider.setHistory(messages)` and pass the `session_id` through `send` so the next stream re-attaches; or (b) disable / hide the Resume button with a "v1.6" badge until the hand-off lands. Option (a) requires:

```typescript
// ChatProvider exposes setHistory(messages: ChatMessage[]) and setActiveSessionId(id)
const { setHistory, setActiveSessionId } = useChatCtx();
const r = await resumeSession(id);
setHistory(r.messages.map(/* narrow to ChatMessage */));
setActiveSessionId(r.session_id);
openRoute('chat');
```

And on the Rust side: `send_message_stream` must accept an optional `session_id: Option<String>` arg, and `SessionWriter::new` must reuse it when present (skipping the ULID-gen + SessionMeta append).

## HIGH Issues

### HI-01: BladeLoopEventPayload TS↔Rust drift on `halted.reason` — circuit-breaker and stuck halts degrade silently to "halted: iteration cap" in the activity log

**Files:**
- `src/lib/events/payloads.ts:884-891` (`reason: 'cost_exceeded' | 'iteration_cap'`)
- `src-tauri/src/commands.rs:2031-2036` (emits `halted` with `reason: "circuit_breaker"`)
- `src-tauri/src/loop_engine.rs:615` (emits `halted` with `reason: format!("stuck:{}", &pattern_str)`)
- `src/features/activity-log/index.tsx:158-163` (switch falls through to `'halted: iteration cap'` for any non-`cost_exceeded` reason)

**Issue:** Rust emits four `halted.reason` values: `"cost_exceeded"`, `"iteration_cap"`, `"circuit_breaker"`, and `"stuck:{pattern}"`. The TS union only declares two. The activity-log switch in `handleLoopEvent` therefore labels circuit and stuck halts as "halted: iteration cap" — wrong text in the operator-visible chip. Same TS file says "Drift detection is human code-review (D-38-payload, T-06-05 accept)" — this review is the catch.

**Fix:** Widen the TS union AND switch:

```typescript
| {
    kind: 'halted';
    reason: 'cost_exceeded' | 'iteration_cap' | 'circuit_breaker' | string;
    error_kind?: string;
    attempts?: number;
    spent_usd?: number;
    cap_usd?: number;
    scope?: 'PerLoop' | 'PerConversation';
  }
```

And in `activity-log/index.tsx`, branch on `payload.reason.startsWith('stuck:')` and `=== 'circuit_breaker'` for distinct chip text.

---

### HI-02: Provider-fallback chain ignores user's configured `config.model` — silently upgrades every fallback to `default_model_for(provider)`

**Files:**
- `src-tauri/src/resilience/fallback.rs:83` (smart-off path: `let model = providers::default_model_for(provider);`)
- `src-tauri/src/resilience/fallback.rs:125` (smart-on path: same)
- `src-tauri/src/providers/mod.rs:362-372` (`default_model_for` returns hardcoded constants)

**Issue:** When chain element resolves to `config.provider` (the `"primary"` literal), the function still calls `default_model_for(provider)` instead of `config.model`. A user on `provider="anthropic"` + `model="claude-3-5-haiku-20241022"` who hits a rate limit will retry on `claude-sonnet-4-20250514` — silently upgrading to a 5×–10× more expensive model AND violating the user's explicit choice. CLAUDE.md memory rule "Don't hardcode model names for OpenRouter — user picks their model" applies more broadly: hardcoding the fallback model for the **primary** chain element is a regression vs. Phase 33's `try_free_model_fallback` which used `config.provider` + `config.model` directly when re-attempting on the primary.

**Fix:** Resolve "primary" as `(config.provider, config.model)` rather than `(config.provider, default_model_for(config.provider))`:

```rust
let (provider, model): (&str, &str) = if chain_elem == "primary" {
    (config.provider.as_str(), config.model.as_str())
} else {
    (chain_elem.as_str(), providers::default_model_for(chain_elem.as_str()))
};
```

The smart-off path (`fallback.rs:81-110`) needs the same fix.

---

### HI-03: `recent_actions_window` config field is dead code — runtime edits are silently ignored

**Files:**
- `src-tauri/src/config.rs:449-450` (`recent_actions_window: u32` field, default 6)
- `src-tauri/src/loop_engine.rs:51` (`pub const RECENT_ACTIONS_CAPACITY: usize = 6;` hardcoded)
- `src-tauri/src/loop_engine.rs:117` (`while self.recent_actions.len() > RECENT_ACTIONS_CAPACITY`)
- `src-tauri/src/loop_engine.rs:46-50` (doc comment claims "Plan 34-04 reads the config and resizes if needed; the const here is the compile-time floor" — Plan 34-04 did not wire this)

**Issue:** Users / operators who set `resilience.recent_actions_window = 12` to widen the window for a long-form research session see no effect — `record_action` truncates to the hardcoded 6. The config docs and the SUMMARY both advertise tunability that does not exist.

**Fix:** Either (a) read `config.resilience.recent_actions_window` at the call sites (commands.rs / loop_engine.rs) and pass to `LoopState::record_action` or convert to a runtime cap; or (b) remove the config field. Option (a) is the documented intent:

```rust
pub fn record_action(&mut self, record: ActionRecord, capacity: usize) {
    self.recent_actions.push_back(record);
    while self.recent_actions.len() > capacity { self.recent_actions.pop_front(); }
}
// caller: loop_state.record_action(ar, config.resilience.recent_actions_window as usize);
```

Note the const can stay as a defensive floor (used by `RES_FORCE_PANIC_IN_DETECTOR` test paths or future deserialize hardening).

## MEDIUM Issues

### MD-01: `clear_error_history` wipes ALL kinds on success — kind-specific recovery semantics unimplementable

**File:** `src-tauri/src/commands.rs:223-227`

**Issue:** Per `loop_engine.rs:1535`, every successful complete_turn calls `clear_error_history()` (gated on smart_resilience_enabled). This wipes all 5 error kinds (rate_limit, overloaded, server, timeout, fatal) at once. Consequence: a conversation that has accumulated 2× rate_limit failures and is about to trip the circuit at the 3rd will instead reset to 0 on any success — even an `overloaded` recovery clears the rate_limit ledger. The forensic trail of "what kinds of errors are we seeing" disappears each time **any** call succeeds. This may be the intended posture (the comment at L218-222 explicitly notes "lingering rate_limit count would prevent recovery"), but kind-specific reset is not impossible — just reset the matching `kind` only.

**Fix:** If kind-specific reset is desired:

```rust
pub(crate) fn clear_error_history_kind(kind: &str) {
    if let Ok(mut h) = error_history().lock() {
        h.retain(|(k, _, _, _, _)| k != kind);
    }
}
```

Then the loop_engine reset call passes the kind that just succeeded (need to thread provider error_kind back through). If global-reset is intentional, the doc comment should be promoted out of the implementation note into the CONTEXT lock and the `clear_error_history` site needs an explicit "reset all kinds on any success" rationale.

---

### MD-02: `load_session` synthesises tool messages without `tool_call_id` — replayed conversations cannot be fed back to LLM providers

**File:** `src-tauri/src/session/resume.rs:123-139`

**Issue:** ToolCall events are replayed as `{role: "tool", tool_name, content, is_error}` with no `tool_call_id`. The Rust-side canonical shape (`ConversationMessage::Tool` at `providers/mod.rs:152-157`) requires `tool_call_id: String` (Anthropic, OpenAI, Groq all reject tool result messages whose `tool_use_id` / `tool_call_id` doesn't reference an assistant tool_call). On top of that, replayed AssistantTurns have `tool_calls: []` (line 120 — the comment acknowledges "tool_calls re-derivation is v1.6+ work"). So the resumed conversation has dangling tool messages whose anchors are stripped.

In v1.5's BL-02-bypassed state, the resumed messages are never actually fed back to the LLM (Resume is a no-op). When BL-02 lands, this becomes the next failure: Anthropic's API will reject the resumed conversation with `400: tool_use_id 'X' was not found`.

**Fix:** Either (a) record `tool_call_id` in `SessionEvent::ToolCall` and re-emit it on resume; or (b) accept that resumed conversations cannot include tool messages and drop the `SessionEvent::ToolCall` arm from the replay (synthesize as a User message describing what happened, preserving the model's view of progress). Option (a) is the correct fix:

```rust
ToolCall {
    name: String,
    args: serde_json::Value,
    result: Option<String>,
    error: Option<String>,
    tool_call_id: String,    // NEW — populated at the dispatch site
    timestamp_ms: u64,
}
```

Plus mirror in AssistantTurn so its tool_calls re-derive on resume.

---

### MD-03: `fork_session` first-pass detects grandchild via "any SessionMeta with parent.is_some()" — multi-meta corrupted parents cause false rejects

**File:** `src-tauri/src/session/list.rs:275-296`

**Issue:** The first-pass loop walks every event and sets `parent_is_fork = true` if any `SessionMeta` event has `parent.is_some()`. SessionWriter only emits SessionMeta as the FIRST line, but a corrupted file with two SessionMeta events (one stub from a recovery path, one real) will incorrectly trigger the grandchild reject if either has a parent. More concerning: the loop never breaks early — even if the first SessionMeta line proves the parent is NOT a fork, the loop still processes every event before reaching the rejection decision. Defense-in-depth says "first SessionMeta wins":

**Fix:**

```rust
let mut found_first_meta = false;
// ... in the loop:
SessionEvent::SessionMeta { parent, .. } => {
    if !found_first_meta {
        if parent.is_some() { parent_is_fork = true; }
        found_first_meta = true;
    }
}
```

---

### MD-04: `compute_backoff_ms` jitter is not seeded per-process — `rand::random` is fine, but `unwrap_or(0)` on system clock paths is silently lossy

**File:** `src-tauri/src/resilience/fallback.rs:191-198` and `src-tauri/src/session/log.rs:218-223`

**Issue:** `now_ms()` returns 0 when `SystemTime::now() < UNIX_EPOCH` (impossible on healthy systems but possible under clock skew, NTP step, container init race). A timestamp of 0 in the JSONL means SESS-03's `list_sessions` sort-by-`started_at_ms` collapses every clock-broken session to the bottom, and `read_meta` cannot tell them apart. Not a security issue but a forensic hole.

**Fix:** Surface the clock failure to log::warn:

```rust
pub(crate) fn now_ms() -> u64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as u64,
        Err(e) => {
            log::warn!("[SESS-01] system clock before epoch: {}", e);
            0
        }
    }
}
```

Same treatment for `commands::circuit_attempts_summary`'s `unwrap_or(0)` at `commands.rs:204`.

## LOW Issues

### LO-01: `SessionWriter::append` opens + locks + closes the file on every call — high-frequency emit (cost_update every iteration) burns FD churn

**File:** `src-tauri/src/session/log.rs:185-198`

**Issue:** Every `append` calls `OpenOptions::open + lock_exclusive + write_all + unlock` (4 syscalls + close on drop). For a 25-iteration tool loop, that's ~100 file open+lock cycles for a single user turn (cost_update + AssistantTurn + ToolCall × multiple per iter). Functionally correct (the kernel handles this) but wasteful and increases the chance of an unrelated EMFILE or ENFILE on systems with low fd ceilings.

**Fix:** Cache the `File` handle inside `SessionWriter` (hold it open for the writer's lifetime). The `enabled = false` no-op writer skips construction. Lock at append time only:

```rust
pub struct SessionWriter {
    pub(crate) path: PathBuf,
    pub(crate) enabled: bool,
    pub(crate) file: Option<std::sync::Mutex<std::fs::File>>,
}
```

Out-of-scope for v1.5 if performance is acceptable — flag as a v1.6 cleanup.

---

### LO-02: `validate_session_id` regex is case-sensitive — Crockford base32 lower-case input is rejected even though ULIDs round-trip case-insensitive

**File:** `src-tauri/src/session/list.rs:454-461`

**Issue:** The regex `^[0-9A-HJKMNP-TV-Z]{26}$` rejects any lowercase characters. Per Crockford base32 spec, lower-case characters are valid (the alphabet is case-insensitive on decode). A frontend that lowercases the session_id before passing through (browser-history-style ID normalisation) would hit a 400 response. `Ulid::from_string` accepts both cases.

**Fix:** Either uppercase before regex match, or widen the character class:

```rust
let re = regex::Regex::new(r"^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$").unwrap();
```

The uppercase-normalize approach is cleaner if the rest of the code path expects upper-case ULIDs (which `Ulid::new().to_string()` always produces).

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
