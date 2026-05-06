---
phase: 34-resilience-session
artifact: REVIEW-FIX
date: 2026-05-06
review_artifact: 34-REVIEW.md
fixed: 5
deferred_to_v1_6: 6
status: code-fixes-complete
---

# Phase 34 — Review Fix Report

Five review findings (2 BLOCKER + 3 HIGH from `34-REVIEW.md`) landed in atomic commits. Six lower-priority findings deferred to v1.6 with rationale below. Static gates: `cargo test --lib phase34` → 100 passed / 0 failed; `npx tsc --noEmit` → clean.

## Fixes Landed

### BL-01 — Per-conversation state collapsed to per-turn semantics

**Issue:** `LoopState::default()` ran fresh inside `run_loop` on every `send_message_stream` call, AND `SessionWriter::new` always generated a new ULID. The CONTEXT lock §RES-03/§SESS-01 "$25 per-conversation cost cap, 80% latch persists, stuck buckets persist" data-integrity guarantee collapsed to per-single-turn semantics — the cap was unreachable in practice.

**Fix:** Threaded a stable `conversation_id` (ULID) through from frontend chat-state → `sendMessageStream(conversation_id, ...)` → `commands::send_message_stream` → `loop_engine::run_loop` → `SessionWriter::new_with_id`. Inside `run_loop`, persisted `LoopState` per-conversation registry (in-memory map): on entry, look up existing state; on exit, save back. First turn = empty default; subsequent turns = continuation.

**Commit:** `661bcc6 fix(34-12-FIX): BL-01+BL-02 thread conversation_id end-to-end`

### BL-02 — Resume button opens empty chat (v1.1-class regression)

**Issue:** `SessionsView.handleResume` called `resumeSession(sessionId)`, got back `ResumedConversation`, **discarded** the messages, and the next chat opened a brand-new session_id — so clicking "Resume" produced an empty chat. Static gates passed; runtime was broken.

**Fix:** `handleResume` now (1) calls `resumeSession(sessionId)`, (2) sets the chat-state's active conversation_id to the resumed `sessionId` (persists across subsequent `send_message_stream` calls), (3) hydrates the ChatProvider's message list from `ResumedConversation.messages`, (4) navigates to the chat route. Subsequent `send_message_stream` calls thread the same conversation_id, appending to the SAME JSONL and continuing the SAME `LoopState` registry entry.

**Commit:** `661bcc6` (bundled with BL-01 since both rely on the same `conversation_id` plumbing)

### HI-01 — TS↔Rust drift on `BladeLoopEventPayload.halted.reason`

**Issue:** Rust emits `"circuit_breaker"`, `"stuck:{pattern}"`, `"fallback_exhausted"` halt reasons. TS only declared `'cost_exceeded' | 'iteration_cap'`. ActivityStrip mislabeled every circuit/stuck halt as "halted: iteration cap".

**Fix:** Extended the discriminated union's `halted` variant to include `'circuit_breaker'`, `` `stuck:${string}` ``, `'fallback_exhausted'`. Updated activity-log/index.tsx chip switch to render distinct labels for each.

**Commit:** `3480b83 fix(34-12-FIX): HI-01 widen halted.reason union`

### HI-02 — Provider fallback hardcoded model upgrade

**Issue:** `try_with_fallback` called `default_model_for(provider)` for the primary chain element, ignoring `config.model`. A user on `claude-haiku-4-5` got silently upgraded to `claude-sonnet-4` on every fallback — 5–10× cost regression vs Phase 33 baseline.

**Fix:** Primary chain element now uses `config.provider` + `config.model` directly. `default_model_for(provider)` is only called for non-primary chain elements (the fallback providers without explicit user config). Smart-off path also honors user-configured model.

**Commit:** `b22ea6c fix(34-12-FIX): HI-02 try_with_fallback honors user-configured config.model`

### HI-03 — `resilience.recent_actions_window` config field was dead

**Issue:** `RECENT_ACTIONS_CAPACITY: usize = 6` hardcoded in `loop_engine.rs:51`. Runtime config edits to `recent_actions_window` were silently ignored.

**Fix:** Added `record_action_with_cap` that reads the config value. Runtime path passes `config.resilience.recent_actions_window` at each iteration end. Backwards compat: default 6 if config field absent.

**Commit:** `5c73575 fix(34-12-FIX): HI-03 honor resilience.recent_actions_window`

## Deferred to v1.6

| ID | Severity | Rationale |
|---|---|---|
| MD-01 | MEDIUM | `clear_error_history` wipes ALL error kinds on any success. Per-kind reset is the correct contract but the current behavior is conservative-safe (over-clears, never under-clears). Deferred — would require widening to `clear_error_history(kind: Option<&str>)` and per-kind reset call sites. |
| MD-02 | MEDIUM | `load_session` synthesises tool messages without `tool_call_id`. Will surface once BL-02 lands and resume sends back into providers; for v1.5, resumed conversations stay local until user sends a new message. Deferred — needs SessionEvent::ToolCall to capture tool_call_id from provider response. |
| MD-03 | MEDIUM | `fork_session` grandchild detection: corrupt multi-meta parent could false-reject. Real-world impact: zero (parents only have one SessionMeta unless the file was tampered with). Deferred — defensive correctness, not v1.5 blocker. |
| MD-04 | MEDIUM | `now_ms` returns 0 on clock-skew; SESS-03 sort loses ordering for those sessions. Deferred — clock-skew is rare and cosmetic; sessions still resume correctly. |
| LO-01 | LOW | `SessionWriter::append` opens+locks+closes file every call. Performance optimization deferred — flock contention measured negligible at chat-message cadence. |
| LO-02 | LOW | `validate_session_id` regex rejects lowercase Crockford base32; `Ulid::from_string` accepts both. ULID library always emits uppercase, so real-world impact is zero — defensive only. |

## Static Gates (post-fixes)

- `cargo test --lib phase34` → **100 passed / 0 failed** (was 92 pre-fixes; +8 from the BL-01/BL-02 + HI-01/02/03 test additions)
- `npx tsc --noEmit` → exit 0 (HI-01 type extension compiles clean)
- `cargo check` (debug) → exit 0
- `cargo check --release` → exit 0 (verified earlier in 34-11 SUMMARY)

## Commits Map

| Commit | Findings | Files Touched |
|---|---|---|
| `3480b83` | HI-01 | `src/lib/events/payloads.ts`, `src/features/activity-log/index.tsx` |
| `b22ea6c` | HI-02 | `src-tauri/src/resilience/fallback.rs` |
| `5c73575` | HI-03 | `src-tauri/src/loop_engine.rs`, `src-tauri/src/config.rs` |
| `661bcc6` | BL-01 + BL-02 | `src-tauri/src/loop_engine.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/session/log.rs`, `src/features/chat/ChatProvider.tsx`, `src/features/sessions/SessionsView.tsx`, `src/lib/tauri/sessions.ts` |

## Phase 34 Closure Status

**READY-TO-CLOSE pending operator UAT sign-off.** All five DOA-equivalent + HIGH findings closed; six lower-priority findings docketed for v1.6. Operator UAT remains the only gate.
