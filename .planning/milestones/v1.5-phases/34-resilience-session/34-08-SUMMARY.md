---
phase: 34-resilience-session
plan: 8
subsystem: session-jsonl-log
tags: [resilience, SESS-01, jsonl, ulid, flock, catch_unwind, rotation, session-writer, emit_with_jsonl, forensics]
dependency_graph:
  requires:
    - "Phase 34 Plan 34-01 (SessionConfig with jsonl_log_enabled bool default true, jsonl_log_dir PathBuf default blade_config_dir().join(\"sessions\"), auto_resume_last bool default false, keep_n_sessions u32 default 100)"
    - "Phase 34 Plan 34-02 (Cargo.toml ulid=1 + fs2=0.4 + sha2=0.10 deps)"
    - "Phase 34 Plan 34-03 (session/log.rs scaffold: SessionEvent 7-variant enum + ToolCallSnippet + SessionWriter struct stub + SESS_FORCE_APPEND_PANIC test seam declaration; session/mod.rs exports log + resume + list)"
    - "Phase 33 Plan 33-09 (FORCE_VERIFY_PANIC seam pattern that SESS_FORCE_APPEND_PANIC mirrors)"
    - "Phase 34 Plan 34-04 (catch_unwind + AssertUnwindSafe wrapper pattern around detect_stuck — Plan 34-08 mirrors verbatim around the append closure)"
    - "Phase 34 Plan 34-06 (cost_update blade_loop_event emit at iteration end — refactored to emit_with_jsonl helper)"
    - "loop_engine::run_loop signature (existing 14-param) widens to 15 params with &SessionWriter as the new last positional"
    - "commands::send_message_stream_inline (existing) entry point — SessionWriter constructed at L1024 area, threaded through run_loop, terminal HaltReason emit at L1825 area"
  provides:
    - "session::log::SessionWriter::new(jsonl_log_dir: &Path, enabled: bool) -> std::io::Result<(Self, String)> — generates real Crockford-base32 ULID via ulid::Ulid::new().to_string(); creates dir; runs rotation BEFORE creating new file; returns (writer, session_id) tuple"
    - "session::log::SessionWriter::append(&self, event: &SessionEvent) — wraps the entire I/O closure in catch_unwind(AssertUnwindSafe(...)) so panics in serde_json::to_string, OpenOptions::open, fs2::lock_exclusive, write_all, or unlock cannot crash chat. catch_unwind catches panics; the match arms log to eprintln! and return; live chat path is preserved (CTX-07 discipline)"
    - "session::log::SessionWriter::no_op() -> Self — error-recovery handle used by commands::send_message_stream_inline when SessionWriter::new returns Err. enabled=false; all method calls are silent no-ops"
    - "session::log::now_ms() -> u64 pub(crate) — wall-clock UNIX millis used by every event emitter for timestamp_ms; degrades to 0 if SystemTime is before UNIX_EPOCH"
    - "session::log::rotate_old_sessions(dir: &Path, keep_n: usize) -> std::io::Result<()> pub(crate) — when count(*.jsonl) > keep_n, moves oldest by ULID lex sort to {dir}/archive/. MOVE not delete (CONTEXT lock §SESS-01). Idempotent under threshold; archive/ NOT created when count <= keep_n"
    - "commands::emit_with_jsonl(app, writer, kind, payload) pub(crate) — drop-in helper that emits blade_loop_event AND records a matching LoopEvent JSONL line. Reduced 7 duplicated emit-and-log call sites in loop_engine.rs to single-line invocations"
    - "loop_engine::run_loop signature widened — 15th param session_writer: &crate::session::log::SessionWriter; passed by reference so SessionWriter ownership stays in commands.rs"
    - "loop_engine::LoopHaltReason gains #[derive(serde::Serialize)] — was Debug+Clone only; HaltReason JSONL payload now round-trips full structured halt info (cost figures, stuck pattern, attempts_summary)"
    - "5 message-flow boundaries wired: UserMessage (commands.rs after sanitize_input), AssistantTurn (loop_engine.rs after every complete_turn Ok before conversation.push), ToolCall (loop_engine.rs at canonical post-dispatch happy-path push site), CompactionBoundary (commands.rs after compress_conversation_smart Ok with pre/post len change check), HaltReason (commands.rs after run_loop returns — fires on Ok(()) AND Err(...))"
  affects:
    - "src-tauri/src/session/log.rs (+473 / -37 — Plan 34-08 Step A: SessionWriter stubs replaced; rotate_old_sessions added; now_ms helper; SessionWriter::no_op constructor; 12 session::log::tests::phase34_* tests covering happy path + panic-injection + jsonl-disabled regression + rotation + ULID parse + dir auto-create + SessionMeta-first ordering + idempotent under-threshold rotation)"
    - "src-tauri/src/commands.rs (+152 — Plan 34-08 Step B: emit_with_jsonl helper after emit_stream_event; SessionWriter construction + SessionMeta first-line emit at send_message_stream_inline entry; UserMessage emit after sanitize_input; CompactionBoundary emit after compress_conversation_smart with pre/post len change check; HaltReason terminal emit after run_loop returns; &session_writer threaded into run_loop call site)"
    - "src-tauri/src/loop_engine.rs (+236 / -57 — Plan 34-08 Step C: run_loop signature widened with session_writer parameter; LoopHaltReason gains #[derive(serde::Serialize)]; AssistantTurn JSONL emit before conversation.push at L1538 area; ToolCall JSONL emit at canonical happy-path push site at L2434 area; 7 blade_loop_event sites refactored to emit_with_jsonl helper)"
tech_stack:
  added:
    - "fs2::FileExt (existing crate, new caller for lock_exclusive / unlock around append)"
    - "ulid::Ulid (existing crate, new caller for fresh session ID generation per turn)"
    - "std::panic::catch_unwind + AssertUnwindSafe wrapping the SessionWriter::append I/O closure"
  patterns:
    - "catch_unwind around the entire write closure — append's serde_json::to_string + OpenOptions::open + fs2::lock_exclusive + write_all + unlock all run inside std::panic::catch_unwind(AssertUnwindSafe(|| ...)). Panics propagate as Err(_) from catch_unwind; the match arm logs to eprintln! and returns. Mirrors Phase 33-09's verify_progress wrapper and Plan 34-04's detect_stuck wrapper. Chat-continues posture is the v1.1 lesson incarnate: forensic logging must NEVER crash the live UI."
    - "flock(LOCK_EX) advisory lock around append — fs2::FileExt::lock_exclusive maps to flock(2) on Unix and LockFileEx on Windows. Belt-and-suspenders against future multi-window scenarios; for the single-window mid-Phase-34 case, O_APPEND alone provides atomic positioning but the lock makes write_all serialisation explicit. Lock released on file handle drop even if explicit unlock fails."
    - "ULID-prefixed JSONL filenames — Ulid::new().to_string() yields a 26-char Crockford-base32 ID whose first 10 chars are timestamp-ordered. Sorting *.jsonl filenames lex-ascendingly yields oldest-first ordering for free; rotation reads std::fs::read_dir, sorts, takes the oldest (count - keep_n), renames each to {dir}/archive/{name}. std::fs::rename is atomic on same-FS; archive/ is a sibling so guaranteed same-FS."
    - "Move-not-delete rotation — CONTEXT lock §SESS-01 spec. rotate_old_sessions calls std::fs::rename, not std::fs::remove. archive/ is auto-created by std::fs::create_dir_all (idempotent). Idempotent under threshold: if count <= keep_n, returns Ok(()) without creating archive/, so the directory is empty until the first rotation actually fires."
    - "Lazy rotation at SessionWriter::new — rotation runs INSIDE SessionWriter::new BEFORE the new file path is constructed, so the new file is never at risk of being archived on creation. config.session.keep_n_sessions is read via crate::config::load_config() at construction time; falls back to 100 if load_config panics (defence-in-depth catch_unwind)."
    - "Disabled writer skips dir creation — when enabled=false (CTX-07 escape hatch), SessionWriter::new returns immediately with a no-op writer (path = empty PathBuf, enabled=false). No std::fs::create_dir_all call; no rotation; the ULID is still generated for forensic continuity (consumers that toggle logging on later get a valid ID)."
    - "SessionWriter::no_op() helper — error-recovery handle for commands.rs. When SessionWriter::new returns Err (FS permission denied, ENOSPC), commands.rs falls back to SessionWriter::no_op() so the live chat path is unaffected. Every method on the no-op writer is a silent no-op; safe to call anywhere; produces no I/O and no output."
    - "Per-turn SessionWriter (NOT per-conversation) — Plan 34-08 constructs SessionWriter once at the send_message_stream_inline entry; the JSONL filename is keyed on session_id which is a fresh ULID per turn. Plan 34-11 widens the Tauri command surface to accept Option<String> session_id from the frontend so resumed conversations reuse the existing JSONL. The pub(crate) path + enabled fields on SessionWriter let Plan 34-09 (resume) construct a writer pointing at an existing JSONL via direct field assignment."
    - "emit_with_jsonl helper for paired UI + JSONL emits — refactored 7 blade_loop_event call sites in loop_engine.rs to a single-line crate::commands::emit_with_jsonl(&app, session_writer, kind, payload). The helper builds the live event by merging {kind: kind} into the payload object via serde_json::Value::as_object_mut + insert; records the forensic LoopEvent JSONL line via session_writer.append. SessionWriter::append's catch_unwind boundary keeps the JSONL path panic-safe so a failure there never disturbs the live blade_loop_event emit above."
    - "AssistantTurn safe_slice content cap at 4000 chars — JSONL line size bound. Full assistant content stays in the conversation array (which SESS-02 also replays), so the JSONL captures a forensic excerpt rather than the full text. ToolCallSnippet args_excerpt cap is 200 chars (per CONTEXT lock recommendation); full args are recorded as separate ToolCall events further down at the dispatch site so the JSONL retains complete fidelity for SESS-02 replay."
    - "Pre/post len comparison for CompactionBoundary — compress_conversation_smart is a no-op below the trigger; recording a CompactionBoundary on every call would create false-positive boundaries in JSONL. Plan 34-08 captures conversation.len() before the call and only emits the JSONL boundary when len() differs after, so the boundary is recorded iff compaction actually fired. summary_first_chars is extracted from the synthetic User message starting with `[Earlier conversation summary]` (Phase 32-04 contract)."
    - "HaltReason emits on Ok(()) AND Err(...) paths — terminal halt event fires for every run_loop outcome, not just halts. reason='ok' for Ok(()) lets SESS-02 detect a gracefully-completed conversation vs. a mid-flight crash. The Err path encodes the LoopHaltReason variant via serde_json::to_value (LoopHaltReason now derives Serialize) so cost figures, stuck pattern, attempts_summary all round-trip into JSONL."
key_files:
  created: []
  modified:
    - "src-tauri/src/session/log.rs (+473 / -37 — SessionWriter::new + append real bodies; rotate_old_sessions; now_ms; SessionWriter::no_op; 12 phase34_* tests)"
    - "src-tauri/src/commands.rs (+152 — emit_with_jsonl helper; SessionWriter::new + SessionMeta first-line + UserMessage + CompactionBoundary + HaltReason emits; &session_writer passed to run_loop)"
    - "src-tauri/src/loop_engine.rs (+236 / -57 — run_loop signature widened; LoopHaltReason gains Serialize derive; AssistantTurn + ToolCall JSONL emits; 7 blade_loop_event sites refactored to emit_with_jsonl)"
decisions:
  - "Per-turn SessionWriter (not per-conversation persistent). The plan body suggested constructing SessionWriter once at send_message_stream_inline entry per turn; the alternative would be threading a per-conversation handle from chat lifecycle in lib.rs. For Plan 34-08, per-turn is correct because: (a) the Tauri command surface is per-turn (one send_message_stream call per user message); (b) Plan 34-11 will widen the surface to accept session_id: Option<String> from the frontend so resumed conversations reuse the existing JSONL; (c) the path is constant within a session_id so multiple turns appending to the same file is the same write pattern as a multi-turn writer. The pub(crate) path + enabled fields on SessionWriter (kept from Plan 34-03) let Plan 34-09 (resume) construct a writer pointing at an existing JSONL via direct field assignment without a SessionWriter::reopen public constructor."
  - "Defence-in-depth catch_unwind around config::load_config() inside SessionWriter::new. The plan body did `let cfg = crate::config::load_config()` directly; load_config can panic on poisoned Mutex / corrupt config file / keyring unavailable. SessionWriter::new is part of the chat hot path (constructed once per turn); a panic here would propagate up through send_message_stream_inline. Wrapped the load_config call in std::panic::catch_unwind and fall back to keep_n=100 (the documented default) if it panics. The append-path catch_unwind is the primary chat-continues posture; the new-path catch_unwind is belt-and-suspenders for the rotation surface."
  - "SessionWriter constructed even on Err path. The plan body's error-recovery branch returns early with SessionWriter::no_op() and an empty session_id. Kept it but added an explicit early-return guard `if !session_id.is_empty()` around the SessionMeta first-line emit so we don't write a SessionMeta with id=\"\" when the writer is in fallback mode. The no_op writer's append is a silent no-op anyway, but the explicit guard keeps the JSONL contract clean (every JSONL has a non-empty id in line 1)."
  - "AssistantTurn fires for both tool-call and empty-tool-call branches. The plan body's example showed the emit only after each successful complete_turn, but didn't distinguish between the tool-loop iteration and the final empty-tool-calls branch. Both paths route through the same `conversation.push(ConversationMessage::Assistant {...})` site in run_loop, so I placed the AssistantTurn emit immediately BEFORE that push — fires uniformly for every assistant turn the model produces, regardless of whether the iteration body continues with tool calls or terminates."
  - "ToolCall emit at the canonical happy-path push site. There are 5 conversation.push(ConversationMessage::Tool {...}) sites in run_loop (schema-validation reject, blocked-by-policy, denied-by-user, retry-failed, canonical happy-path). Per the existing turn_acc.record_tool_call comment block: 'this is the canonical post-dispatch happy-path push (line 2156); the 4 earlier push sites in this loop body are error/short-circuit branches that already continue past this point.' Followed the same discipline — recorded the ToolCall JSONL emit ONLY at the canonical site, mirroring turn_acc.record_tool_call's placement. Error/short-circuit paths flow through is_error=true content into the canonical site on the NEXT iteration via the conversation.push there. The plan's `args` field gets the raw tool_call.arguments JSON (no redaction at this layer; Phase 35+ may tighten); `result` is Some on Ok, None on Err; `error` is None on Ok, Some on Err — symmetric and never both."
  - "Pre/post len check for CompactionBoundary emit. The plan body said to record CompactionBoundary `after compress_conversation_smart returns`. compress_conversation_smart is a no-op below the trigger threshold, so an unconditional emit creates false-positive boundaries in JSONL. Captured `let pre_compact_len = conversation.len()` before the call and gated the emit on `if conversation.len() != pre_compact_len`. Boundaries now record iff compaction actually fired. summary_first_chars is extracted from the conversation array's `[Earlier conversation summary]` synthetic User message (Phase 32-04 contract); falls back to empty string if not present (defensive — should never happen if compaction fired)."
  - "LoopHaltReason gains Serialize derive (not manual encode). The plan body's HaltReason emit example used `serde_json::to_value(e).unwrap_or(serde_json::Value::Null)`. LoopHaltReason was Debug+Clone only — to_value on a non-Serialize value returns Err, and the unwrap_or would silently drop the structured halt info. Added `#[derive(serde::Serialize)]` to the enum (alongside the existing Debug+Clone). Now to_value succeeds on every variant; full payload (cost figures, stuck pattern, attempts_summary, error_kind) round-trips into JSONL. CostScope (already Serialize from Plan 34-02) and AttemptRecord (already Serialize from Plan 34-05) compose cleanly."
  - "HaltReason fires on Ok(()) too (reason='ok'). The plan body's example showed the emit only on Err. Extended to fire on both branches so SESS-02 resume can detect a gracefully-completed conversation (terminal HaltReason with reason='ok') vs. a mid-flight crash (no terminal HaltReason in JSONL). The Ok payload is `{}` — no extra info needed. This pattern matches the existing send_message_stream emit contract where chat_done fires on every completion path."
  - "emit_with_jsonl merges payload object via as_object_mut. The plan body sketched `let mut full = json!({\"kind\": kind}); if let Some(obj) = payload.as_object() { for (k,v) in obj { full[k] = v.clone(); } }` — direct indexing on serde_json::Value via [] panics if the underlying repr isn't an object. Used as_object_mut + insert instead; safer if a future caller passes a non-object payload (the kind field is still set). 7 call sites in loop_engine.rs all pass json!({...}) literals so the as_object_mut path always succeeds; the safer pattern is no-cost defence-in-depth."
  - "Did NOT widen the Tauri command surface in Plan 34-08. The plan body's optional Step H suggested adding `session_id: Option<String>` to the send_message_stream Tauri command. Deferred to Plan 34-11 per the depends_on graph (frontend wiring belongs in 34-11). Plan 34-08 lands the SessionWriter substrate + 5 emit sites + emit_with_jsonl helper; Plan 34-09 fills load_session reading what 34-08 wrote; Plan 34-10 ships list/fork; Plan 34-11 wires the frontend including the session_id parameter pass-through. Non-invasive substrate landing per the Phase 33-07 / 34-07 precedent."
metrics:
  duration: "~30 minutes wall (2 commits; long compile times due to large crate — cargo check 3m49s + cargo test 6m46s)"
  completed: "2026-05-06"
  task_count: 2
  file_count: 3
---

# Phase 34 Plan 34-08: SESS-01 Append-Only JSONL Session Log Summary

Plan 34-08 fills the Plan 34-03 stubs in `session/log.rs` with real bodies and
wires the resulting `SessionWriter` through the 5 message-flow boundaries in
`commands::send_message_stream_inline` and `loop_engine::run_loop`. Three
deliverables:

1. **`SessionWriter::new` real body** — generates a Crockford-base32 ULID via
   `ulid::Ulid::new().to_string()`, creates `jsonl_log_dir` if missing, runs
   `rotate_old_sessions` BEFORE creating the new JSONL file (so the new file
   is never at risk of being archived on creation). Returns
   `(writer, session_id)` tuple. When `enabled=false` (CTX-07 escape hatch),
   returns immediately with a no-op writer; no directory created; no rotation
   run; the ULID is still generated for forensic continuity.

2. **`SessionWriter::append` real body** — wraps the entire I/O closure in
   `std::panic::catch_unwind(AssertUnwindSafe(|| ...))` so panics in
   `serde_json::to_string` / `OpenOptions::open` / `fs2::lock_exclusive` /
   `write_all` / `unlock` cannot crash the live chat (CTX-07 fallback
   discipline; mirrors Phase 33-09 / Plan 34-04). Inside the closure:
   serializes the event to JSONL, opens the path with
   `OpenOptions::create+append`, takes `fs2::FileExt::lock_exclusive`,
   writes the line + `\n`, releases the lock. The
   `SESS_FORCE_APPEND_PANIC` test seam (Plan 34-03 declaration) is checked
   at the top of the catch_unwind closure — when set, panics deliberately,
   which catch_unwind catches.

3. **5 message-flow emit sites + emit_with_jsonl helper** — wires the
   `SessionWriter` through the conversation orchestration so every event
   the model produces is recorded for SESS-02 replay:
   - `UserMessage` — `commands.rs` after `sanitize_input` (so JSONL records
     what the model actually saw, not the raw inbound payload)
   - `AssistantTurn` — `loop_engine.rs` after each `complete_turn Ok` before
     `conversation.push` (turn fields readable; safe_slice content to 4000)
   - `ToolCall` — `loop_engine.rs` at the canonical post-dispatch happy-path
     push site (mirrors `turn_acc.record_tool_call` placement; result/error
     symmetric never-both)
   - `CompactionBoundary` — `commands.rs` after `compress_conversation_smart`
     ONLY when pre/post lengths differ (avoids false-positive boundaries
     when the trigger isn't reached)
   - `HaltReason` — `commands.rs` after `run_loop` returns; fires on
     `Ok(())` (reason='ok') AND `Err(...)` so SESS-02 can detect graceful
     completion vs. mid-flight crash

   Plus `emit_with_jsonl` helper in `commands.rs` that pairs every existing
   `blade_loop_event` emit with a JSONL `LoopEvent` line — refactored 7 call
   sites in `loop_engine.rs` (stuck_detected, halted×3, cost_warning,
   verification_fired×3, token_escalated, replanning, cost_update) to
   single-line invocations.

## SessionWriter::new + append signatures

```rust
pub fn new(jsonl_log_dir: &Path, enabled: bool)
    -> std::io::Result<(Self, String)>;

pub fn append(&self, event: &SessionEvent);

pub fn no_op() -> Self;
```

`new` generates the ULID, creates the dir, runs rotation, returns
`(writer, session_id)`. `append` is the catch_unwind-wrapped flock-protected
atomic write. `no_op` is the error-recovery handle used by `commands.rs`
when `new` returns `Err` (FS permission, ENOSPC).

## Tests

12 tests under `session::log::tests::phase34*`, all green:

| Test | Coverage |
|------|----------|
| `phase34_sess_01_writer_new_creates_dir` | `jsonl_log_dir` auto-created if missing |
| `phase34_sess_01_session_id_is_real_ulid` | Returned id parses via `Ulid::from_string` |
| `phase34_sess_01_jsonl_roundtrip` | All 7 SessionEvent variants write → read back → assert structural equality |
| `phase34_sess_01_panic_in_append_caught_by_outer_wrapper` | `SESS_FORCE_APPEND_PANIC=true` does NOT propagate; chat-continues posture holds |
| `phase34_jsonl_log_disabled_no_files_written` | `enabled=false` → no `*.jsonl` files in dir; CTX-07 escape hatch |
| `phase34_sess_01_rotation_moves_oldest_to_archive` | 105 fake JSONL → rotate(100) → 100 remain in dir + 5 in archive/ |
| `phase34_sess_01_rotation_idempotent_under_threshold` | 50 files → rotate(100) → no-op; archive/ NOT created |
| `phase34_sess_01_session_writer_writes_session_meta_first` | `SessionMeta.id` matches `new()`'s returned `session_id` |
| `phase34_session_event_serde_roundtrip_user_message` | UserMessage serialises with `kind="UserMessage"` (Plan 34-03) |
| `phase34_session_event_serde_roundtrip_compaction_boundary` | CompactionBoundary serialises with `kept_message_count` (Plan 34-03) |
| `phase34_session_event_all_seven_variants_serialize` | All 7 variants serialise without panic (Plan 34-03) |
| `phase34_session_writer_stub_construct` | Disabled writer constructs cleanly with 26-char ULID id (Plan 34-03 backwards-compat) |

## 5 message-flow emit sites

| Boundary | File:Line area | Variant | Notes |
|----------|----------------|---------|-------|
| User message received | `commands.rs:1141` (after `sanitize_input`) | `SessionEvent::UserMessage` | `id="user-{ms}"`; `content` is sanitized (post-injection-strip) |
| Assistant turn complete | `loop_engine.rs:1538` (before `conversation.push`) | `SessionEvent::AssistantTurn` | `content` safe_slice'd to 4000; `tool_calls` excerpted to 200/each |
| Tool call dispatched | `loop_engine.rs:2434` (canonical post-dispatch push) | `SessionEvent::ToolCall` | `args` is full JSON; `result` Some on Ok / None on Err; `error` mirror |
| Compaction boundary | `commands.rs:1779` (after `compress_conversation_smart`) | `SessionEvent::CompactionBoundary` | Only fires when pre/post `conversation.len()` differ |
| Halt reason set | `commands.rs:1825` (after `run_loop` returns) | `SessionEvent::HaltReason` | Fires on Ok(()) (reason='ok') AND Err(...) (full Serialize payload) |

## ≥5 LoopEvent sites refactored to emit_with_jsonl

| Kind | File:Line area | Pre-Plan-34-08 | Post-Plan-34-08 |
|------|----------------|----------------|-----------------|
| `stuck_detected` | `loop_engine.rs:592` | `emit_stream_event(&app, "blade_loop_event", json!({"kind": "stuck_detected", "pattern": p}))` | `emit_with_jsonl(&app, session_writer, "stuck_detected", json!({"pattern": p}))` |
| `halted (stuck)` | `loop_engine.rs:603` | `emit_stream_event` with `kind: "halted", reason: format!("stuck:...")` | `emit_with_jsonl` with `kind="halted"`, `reason` in payload |
| `halted (PerConversation cost)` | `loop_engine.rs:649` | per-conversation cost_exceeded halt | `emit_with_jsonl` with full cost figures |
| `cost_warning (80%)` | `loop_engine.rs:679` | per-conversation 80% latch warn | `emit_with_jsonl` |
| `halted (PerLoop cost)` | `loop_engine.rs:705` | per-loop cost_exceeded halt | `emit_with_jsonl` |
| `verification_fired (YES/NO/REPLAN)` | `loop_engine.rs:768/783/801` | three verdict emit sites | three `emit_with_jsonl` calls |
| `token_escalated` | `loop_engine.rs:1224` | LOOP-04 truncation retry | `emit_with_jsonl` with `new_max` |
| `cost_update` | `loop_engine.rs:1422` | every-iteration live tick | `emit_with_jsonl` with spent/cap/percent |
| `replanning` | `loop_engine.rs:2354` | LOOP-03 reject_plan trigger | `emit_with_jsonl` |
| `halted (iteration_cap)` | `loop_engine.rs:2412` | run_loop fall-through | `emit_with_jsonl` |

## run_loop signature change

Before:
```rust
pub async fn run_loop(
    app: tauri::AppHandle,
    state: SharedMcpManager,
    approvals: ApprovalMap,
    vector_store: crate::embeddings::SharedVectorStore,
    config: &mut crate::config::BladeConfig,
    conversation: &mut Vec<ConversationMessage>,
    tools: &[crate::providers::ToolDefinition],
    last_user_text: &str,
    brain_plan_used: bool,
    meta_low_confidence: bool,
    meta_pre_check: &crate::metacognition::CognitiveState,
    input_message_count: usize,
    turn_acc: crate::reward::TurnAccumulator,
    current_message_id: &mut Option<String>,
) -> Result<(), LoopHaltReason>;
```

After (Plan 34-08 added the `session_writer` parameter):
```rust
pub async fn run_loop(
    app: tauri::AppHandle,
    state: SharedMcpManager,
    approvals: ApprovalMap,
    vector_store: crate::embeddings::SharedVectorStore,
    config: &mut crate::config::BladeConfig,
    conversation: &mut Vec<ConversationMessage>,
    tools: &[crate::providers::ToolDefinition],
    last_user_text: &str,
    brain_plan_used: bool,
    meta_low_confidence: bool,
    meta_pre_check: &crate::metacognition::CognitiveState,
    input_message_count: usize,
    turn_acc: crate::reward::TurnAccumulator,
    current_message_id: &mut Option<String>,
    // Plan 34-08 (SESS-01)
    session_writer: &crate::session::log::SessionWriter,
) -> Result<(), LoopHaltReason>;
```

Single caller (`commands::send_message_stream_inline`) passes `&session_writer`
constructed at function entry. No other call sites need updating.

## catch_unwind boundary

`session/log.rs:172-204`:
```rust
pub fn append(&self, event: &SessionEvent) {
    if !self.enabled { return; }
    let path = self.path.clone();
    let event_clone = event.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        #[cfg(test)]
        SESS_FORCE_APPEND_PANIC.with(|p| {
            if p.get() {
                panic!("test-only induced panic in SessionWriter::append (Plan 34-08 regression)");
            }
        });
        let line = serde_json::to_string(&event_clone).map_err(/* ... */)?;
        let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
        f.lock_exclusive()?;
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        let _ = f.unlock();
        Ok::<(), std::io::Error>(())
    }));
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => eprintln!("[SESS-01] append io error at {}: {}", self.path.display(), e),
        Err(_panic) => eprintln!("[SESS-01] append panicked at {}; chat continues", self.path.display()),
    }
}
```

The boundary catches three failure modes:
1. **Serialization panic** (e.g., a future SessionEvent variant containing
   non-Serialize data) → `Err(_panic)` arm, eprintln, chat continues.
2. **I/O error** (ENOSPC, EACCES, EROFS) → `Ok(Err(e))` arm, eprintln, chat continues.
3. **Lock acquisition failure** (rare; flock returning EWOULDBLOCK with
   non-blocking flag, or LockFileEx errors on Windows) → `Ok(Err(e))` arm.

In every case, the live UI emit (`emit_stream_event(... blade_loop_event ...)`)
that runs BEFORE `session_writer.append(...)` inside `emit_with_jsonl` is
unaffected. The chat-continues posture is the v1.1 lesson incarnate.

## Rotation policy demo

`phase34_sess_01_rotation_moves_oldest_to_archive` writes 105 fake JSONL files
with 26-char sortable names mimicking ULID lex ordering, runs
`rotate_old_sessions(&dir, 100)`, then asserts:
- `dir` contains exactly 100 `*.jsonl` files (the 100 most-recent by lex sort)
- `dir/archive/` contains exactly 5 `*.jsonl` files (the 5 oldest)
- `archive/` was created by rotation (didn't exist before)

`phase34_sess_01_rotation_idempotent_under_threshold` writes 50 files, runs
`rotate_old_sessions(&dir, 100)`, asserts:
- `dir/archive/` does NOT exist (no files moved → archive/ never created)
- `dir` still contains all 50 files

Both tests pass; rotation is correct and idempotent.

## jsonl-log-disabled regression

`phase34_jsonl_log_disabled_no_files_written` calls
`SessionWriter::new(&dir, false)` then `writer.append(...)` and asserts
zero `*.jsonl` files exist in the directory afterward. The disabled writer:
- Does NOT call `std::fs::create_dir_all`
- Does NOT run rotation
- `append` returns immediately on the `if !self.enabled` early-return

CTX-07 escape hatch verified: forensic logging respects the user toggle.

## Auth gates

None during execution. All reads/writes are local FS; no provider auth needed.

## Note for Plan 34-09 (SESS-02 resume)

`load_session(session_id)` reads the JSONL at
`{config.session.jsonl_log_dir}/{session_id}.jsonl` line-by-line and
reconstructs the `Vec<ConversationMessage>` from `UserMessage` +
`AssistantTurn` + `ToolCall` + `CompactionBoundary` events. The
`HaltReason` line at EOF (always present per Plan 34-08's terminal emit on
both Ok and Err paths) lets `load_session` report the resume status:
- `reason="ok"` → conversation completed gracefully; resume picks up after
  the last assistant turn.
- Any other reason → conversation halted mid-flight; resume should surface
  a "resumed from halt: X" banner via the chat UI.

`LoopEvent` lines are read for forensics (chat UI may render the timeline)
but NOT replayed (per CONTEXT lock §SESS-01).

`SessionWriter`'s `pub(crate) path + enabled` fields let Plan 34-09 construct
a writer pointing at the existing JSONL via direct field assignment — no
public `SessionWriter::reopen` constructor needed. Plan 34-09's integration
test should round-trip a Plan 34-08 write → SESS-02 load cycle to confirm
the readback matches.

## Note for Plan 34-11 (frontend + UAT)

The `send_message_stream` Tauri command surface is unchanged in Plan 34-08
(non-invasive substrate landing). Plan 34-11 widens it to accept
`session_id: Option<String>` from the frontend:
- `None` → backend generates a fresh ULID (Plan 34-08 path; today's behavior)
- `Some(id)` → backend reuses the existing JSONL via direct field assignment
  on `SessionWriter`

Frontend changes deferred to Plan 34-11. Plan 34-08 lands the backend
substrate for Plan 34-09's resume + Plan 34-10's list/fork.

## Threat Flags

None. Plan 34-08 records UserMessage / AssistantTurn / ToolCall content into
JSONL on local disk. The threat surface (per CONTEXT lock §SESS-01 T-34-32
through T-34-36) is fully captured in the plan's `<threat_model>` block; no
new surface introduced beyond what was disclosed.

## Self-Check: PASSED

Verified:
- `src-tauri/src/session/log.rs` exists at HEAD with new bodies (commit `81aec33`)
- `src-tauri/src/commands.rs` exists at HEAD with SessionWriter wiring (commit `76a4b3b`)
- `src-tauri/src/loop_engine.rs` exists at HEAD with run_loop signature widening + AssistantTurn + ToolCall + 7 emit_with_jsonl refactors (commit `76a4b3b`)
- `git log --oneline | grep -E '34-08|81aec33|76a4b3b'` shows both commits
- `cargo check` clean (0 errors; only pre-existing warnings)
- `cargo test --lib phase34` → 76 passed; 0 failed
- `cargo test --lib phase33` → 78 passed; 0 failed (no regression)
- `cargo test --lib session::log::tests` → 12 passed; 0 failed

## Links to Next Plans

- **Plan 34-09 (SESS-02 resume)** — `session::resume::load_session` reads the
  JSONL written by Plan 34-08's SessionWriter. Round-trip integration test
  in 34-09 should write → load and assert structural equality of the
  reconstructed `Vec<ConversationMessage>`. The terminal `HaltReason` line
  drives the resume banner.
- **Plan 34-10 (SESS-03/04 list + fork)** — `list_sessions` reads only the
  first JSONL line (SessionMeta) of each `*.jsonl` for the sessions panel.
  `fork_session(parent_id, fork_at_message_index)` writes a new SessionMeta
  with `parent: Some(parent_id)` and `fork_at_index` populated.
- **Plan 34-11 (frontend + UAT)** — widens `send_message_stream` Tauri
  command to accept `session_id: Option<String>`; ships SessionsPanel +
  resume CTA + cost-meter chip subscribing to `cost_update` LoopEvent
  (which Plan 34-08 now records into JSONL alongside the live blade_loop_event).
