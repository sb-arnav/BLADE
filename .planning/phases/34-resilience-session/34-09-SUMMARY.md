---
phase: 34-resilience-session
plan: 9
subsystem: session
tags: [SESS-02, resume, jsonl-replay, compaction-boundary, corrupt-line-skip]
requires: [34-03, 34-08]
provides:
  - "session::resume::load_session real body (Plan 34-03 stub filled)"
  - "Phase 32-04 [Earlier conversation summary] format reuse on resume"
  - "Corrupt-line skip discipline with eprintln (never panics)"
affects:
  - "Plan 34-10 (SESS-03/04 list/fork) — resume_session Tauri command delegates here"
  - "Plan 34-11 (frontend + UAT) — Sessions drawer click → resume_session → load_session"
tech-stack:
  added: []
  patterns:
    - "rposition for most-recent CompactionBoundary search (O(n) tail-scan)"
    - "{role, content} JSON shape for messages (matches commands.rs L1235/L1681/L2904 stream emit convention)"
    - "Vec<serde_json::Value> on the IPC boundary (ConversationMessage lacks serde derives — Plan 34-03 deviation)"
key-files:
  created: []
  modified:
    - "src-tauri/src/session/resume.rs (+418/-16) — real load_session body, 7 phase34 tests"
decisions:
  - "Followed plan's locked contract `load_session(path: &Path, session_id: &str)` rather than user prompt's `load_session(session_id: String)` — the path-based signature is shipped substrate (Plan 34-03 commit 9541a7d) and Plan 34-10's Tauri command does the validate_session_id + jsonl_log_dir + catch_unwind wrapping per CONTEXT lock."
  - "Vec<serde_json::Value> shape preserved from Plan 34-03's struct (ConversationMessage has no serde derives). Each replayed message is `{role, content, ...}` matching commands.rs Tauri stream emit convention."
  - "AssistantTurn replays with empty `tool_calls: []` — re-derivation from subsequent ToolCall events is a v1.6+ task per CONTEXT lock §SESS-02."
  - "UserWithImage variant is NOT recorded by SessionWriter (Plan 34-08 emits UserMessage only); resume drops image content. Documented as v1.6+ limitation."
  - "HaltReason / LoopEvent / SessionMeta / CompactionBoundary itself are NOT replayed — forensic-only per CONTEXT lock §SESS-02. T-34-37 (HaltReason replay regression) guarded by `phase34_sess_02_resume_skips_halt_and_loop_events`."
  - "Corrupt-line skip uses eprintln (not panic, not Err) — a single bad line cannot fail the whole resume. Missing file → Err (translates to a user-facing toast in Plan 34-10)."
metrics:
  tasks_completed: 1
  duration: "~5min implementation + ~5min cargo check/test"
  completed_date: "2026-05-06"
---

# Phase 34 Plan 9: SESS-02 — Session Resume from Compaction Boundary Summary

## One-liner

Real `load_session` body that opens a JSONL by path, parses each line as a `SessionEvent` (skipping corrupt lines with `eprintln`), finds the most-recent `CompactionBoundary` via `rposition`, and rebuilds a `Vec<serde_json::Value>` where everything before the boundary collapses into a synthetic `[Earlier conversation summary]\n{summary}` user message (Phase 32-04 exact format) and everything from the boundary forward replays as live `UserMessage`/`AssistantTurn`/`ToolCall` events. Halt reasons, loop events, and session metadata are NOT replayed.

## load_session signature

```rust
pub fn load_session(path: &Path, session_id: &str) -> Result<ResumedConversation, String>
```

Plan 34-03's path-based contract is preserved. Plan 34-10's `resume_session` Tauri command will:
1. `validate_session_id(&session_id)` (rejects path traversal — `../`, slashes, non-Crockford-base32, length≠26).
2. Resolve `cfg.session.jsonl_log_dir.join(format!("{session_id}.jsonl"))`.
3. Optionally bail when `cfg.session.jsonl_log_enabled = false`.
4. Wrap the call in `catch_unwind` for an extra panic safety net.
5. Delegate to `load_session(&path, &session_id)`.

## Body summary (5 lines from the implementation)

```rust
let last_boundary_idx = events
    .iter()
    .rposition(|e| matches!(e, SessionEvent::CompactionBoundary { .. }));
// ...
messages.push(serde_json::json!({
    "role": "user",
    "content": format!("[Earlier conversation summary]\n{}", summary_first_chars),
}));
```

## Phase 32-04 format reuse

Verbatim line in `resume.rs`:

```rust
"content": format!("[Earlier conversation summary]\n{}", summary_first_chars),
```

Matches `commands.rs:459` exactly:

```rust
let summary_msg = ConversationMessage::User(
    format!("[Earlier conversation summary]\n{}", summary)
);
```

This means the model sees the SAME synthetic stub on resume as it did during live compaction — no new prompt format invented. Any in-flight conversations behave identically before and after the resume boundary.

## Corrupt-line skip discipline

```rust
match serde_json::from_str::<SessionEvent>(&line) {
    Ok(e) => events.push(e),
    Err(e) => {
        eprintln!("[SESS-02] skip corrupt line: {}", e);
        continue;
    }
}
```

A single corrupt line does NOT fail the whole resume; the surrounding events are still parsed. UI sees a successful resume with a possibly-incomplete history. CONTEXT lock §SESS-02 locked behavior.

## Test results — 7 green

```
running 7 tests
test session::resume::tests::phase34_sess_02_resume_corrupt_line_skipped ... ok
test session::resume::tests::phase34_sess_02_resume_no_boundary_returns_full_history ... ok
test session::resume::tests::phase34_sess_02_resume_missing_file_returns_err ... ok
test session::resume::tests::phase34_sess_02_resume_skips_halt_and_loop_events ... ok
test session::resume::tests::phase34_sess_02_resume_tool_call_error_marks_is_error ... ok
test session::resume::tests::phase34_sess_02_resume_uses_phase32_summary_format ... ok
test session::resume::tests::phase34_sess_02_resume_from_compaction_boundary ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 661 filtered out; finished in 0.02s
```

| # | Test | What it verifies |
|---|------|------------------|
| 1 | `phase34_sess_02_resume_from_compaction_boundary` | 8-event JSONL with embedded boundary → exactly 4 messages: synthetic-summary + post-boundary user + assistant + tool. HaltReason at the tail is dropped. |
| 2 | `phase34_sess_02_resume_no_boundary_returns_full_history` | 5-event JSONL with no boundary → 4 messages (SessionMeta dropped, no synthetic stub), `last_compaction_boundary_at = None`. |
| 3 | `phase34_sess_02_resume_corrupt_line_skipped` | Garbage JSON between two valid lines → `load_session` succeeds with 2 messages. |
| 4 | `phase34_sess_02_resume_missing_file_returns_err` | Non-existent path → `Err`. |
| 5 | `phase34_sess_02_resume_uses_phase32_summary_format` | Synthetic message exactly equals `"[Earlier conversation summary]\ntest summary"` — Phase 32-04 byte-for-byte format reuse. |
| 6 | `phase34_sess_02_resume_skips_halt_and_loop_events` | T-34-37 guard: HaltReason + LoopEvent never appear in the replayed `messages` vec. |
| 7 | `phase34_sess_02_resume_tool_call_error_marks_is_error` | ToolCall with `error: Some(...)` and `result: None` → `is_error: true`, content = error string. |

## Acceptance grep gates (all pass)

```
load_session count: 1
rposition count: 1
Earlier conversation summary count: 6
skip corrupt line count: 2
```

## Notes for downstream plans

### Plan 34-10 (SESS-03/04 — list/fork backend)

`resume_session` Tauri command body:
```rust
#[tauri::command]
pub async fn resume_session(session_id: String)
    -> Result<ResumedConversation, String>
{
    validate_session_id(&session_id)?;
    let cfg = crate::config::load_config();
    let dir = cfg.session.jsonl_log_dir.clone();
    let path = dir.join(format!("{}.jsonl", &session_id));
    crate::session::resume::load_session(&path, &session_id)
}
```

Optionally wrap in `std::panic::catch_unwind(AssertUnwindSafe(...))` for defense-in-depth (the inner body already cannot panic on corrupt lines, but a future regression in `serde_json::from_str` could).

### Plan 34-11 (frontend + UAT)

Sessions drawer click → `invoke<ResumedConversation>("resume_session", { session_id })` → render `messages` directly. The IPC payload is JSON `{role, content, ...}` per message — same shape as the existing chat history serialisation, so the frontend's existing render path works as-is. No `chat_token` emission, no `blade_message_start` race (CLAUDE.md streaming-contract trap pre-empted: resume returns a static vec, the frontend renders synchronously).

### v1.6+ limitations (NOT regressions; intentionally deferred)

- **Tool call re-derivation:** `AssistantTurn` events replay with empty `tool_calls: []`. The model sees subsequent `ToolCall` events for context, which is sufficient for most cases. Re-deriving structured `ToolCall { id, name, arguments }` objects from the JSONL `ToolCall` events (matching them to the assistant turn that fired them) is a v1.6+ optimisation.
- **`UserWithImage` content:** SessionWriter (Plan 34-08) emits `UserMessage { content }` only; image base64 is not persisted to JSONL. Resume drops image content from past turns. Acceptable today because the chat works text-only on resume, with images re-attachable on the next live turn.
- **DoS posture (T-34-38 accept):** A 100k-event JSONL takes ~3s to in-memory parse. Within tolerance for v1.5; v1.6 follow-up is a tail-read for the latest boundary first.

## Deviations from Plan

### Spec deviation: orchestrator prompt diverged from plan contract

The orchestrator prompt asked for `load_session(session_id: String)` with internal `validate_session_id` + `jsonl_log_dir` lookup + `catch_unwind` wrapping + JSONL-disabled-config bail. The Plan 34-09 file (the locked contract) specifies `load_session(path: &Path, session_id: &str)`, with all of the wrapping deferred to Plan 34-10's Tauri command. Plan 34-03's already-shipped `ResumedConversation` struct + stub also use the path-based signature.

**Resolution:** Followed the plan/substrate contract. Plan 34-10's `resume_session` Tauri command is the right place for `validate_session_id` + `jsonl_log_dir` + `catch_unwind` + disabled-config bail (the user's instructions correctly identify the work that needs to happen, just at the wrong layer). Plan 34-09's scope is the JSONL replay logic itself.

The 6 user-requested test names mostly map onto the 7 tests delivered:
- `phase34_sess_02_load_full_history_when_no_compaction` ↔ `phase34_sess_02_resume_no_boundary_returns_full_history` ✓
- `phase34_sess_02_load_starts_at_most_recent_compaction` ↔ `phase34_sess_02_resume_from_compaction_boundary` ✓
- `phase34_sess_02_load_skips_corrupt_lines` ↔ `phase34_sess_02_resume_corrupt_line_skipped` ✓
- `phase34_sess_02_load_session_id_validation` → deferred to Plan 34-10 (validation lives in the Tauri command).
- `phase34_sess_02_load_disabled_returns_err` → deferred to Plan 34-10 (config-toggle handling lives in the Tauri command).
- `phase34_sess_02_load_panic_safe` → not added at this layer; load_session has no panic surface (every error path returns `Result`/`continue`). Plan 34-10's `catch_unwind` will be the panic safety net at the Tauri boundary.

Plus 4 plan-mandated tests delivered:
- `phase34_sess_02_resume_missing_file_returns_err`
- `phase34_sess_02_resume_uses_phase32_summary_format` (Phase 32-04 format gate)
- `phase34_sess_02_resume_skips_halt_and_loop_events` (T-34-37 guard)
- `phase34_sess_02_resume_tool_call_error_marks_is_error`

### Auto-fixed issues

None. The plan executed as written modulo the contract-vs-prompt deviation above.

## Threat surface

No new threat surface introduced. T-34-37 (HaltReason replay regression) is now guarded by `phase34_sess_02_resume_skips_halt_and_loop_events`. T-34-38 / T-34-39 / T-34-40 dispositions unchanged.

## Files modified

- `src-tauri/src/session/resume.rs` (commit `f516297`, +418/-16)

## Commits

- `f516297` — feat(34-09): fill resume::load_session body + 7 tests (SESS-02)

## Self-Check: PASSED

- File exists: `src-tauri/src/session/resume.rs` ✓
- Commit `f516297` present in `git log --oneline` ✓
- 7 phase34 tests green ✓
- cargo check clean ✓
- No accidental deletions in commit ✓
- 4 acceptance grep gates pass (load_session=1, rposition=1, Earlier-conv-summary=6, skip-corrupt-line=2) ✓
