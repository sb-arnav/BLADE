---
phase: 34-resilience-session
plan: 3
subsystem: resilience-session-scaffold
tags: [resilience, session, scaffold, RES-01, RES-05, SESS-01, SESS-02, SESS-03, SESS-04, tauri-command-stubs]
dependency_graph:
  requires:
    - "Phase 34 Plan 34-01 (ResilienceConfig + SessionConfig — used as parameter types in detect_stuck and SessionWriter::new)"
    - "Phase 34 Plan 34-02 (LoopState + LoopHaltReason::{Stuck, CircuitOpen} + CostScope + AttemptRecord + sha2/ulid/fs2 deps; regex 1 already in Cargo.toml from earlier phase)"
    - "Phase 33 Plan 33-02 (loop_engine.rs scaffold style — gold-standard cargo module scaffold pattern mirrored here)"
    - "Phase 33 Plan 33-09 (FORCE_VERIFY_PANIC test seam pattern — RES_FORCE_STUCK / RES_FORCE_PROVIDER_ERROR / SESS_FORCE_APPEND_PANIC mirror it)"
  provides:
    - "src-tauri/src/resilience/ directory with mod.rs + stuck.rs + fallback.rs (StuckPattern enum + 5 variants, FallbackExhausted struct + Display/Error impls)"
    - "src-tauri/src/session/ directory with mod.rs + log.rs + resume.rs + list.rs (SessionEvent enum + 7 variants, ToolCallSnippet, SessionWriter, ResumedConversation, SessionMeta)"
    - "4 Tauri command stubs (#[tauri::command] but UNREGISTERED in generate_handler!): list_sessions, resume_session, fork_session, get_conversation_cost"
    - "validate_session_id Crockford base32 ULID guard (^[0-9A-HJKMNP-TV-Z]{26}$) — rejects path traversal, non-ASCII, etc."
    - "3 cfg(test)-gated thread_local override seams: RES_FORCE_STUCK, RES_FORCE_PROVIDER_ERROR, SESS_FORCE_APPEND_PANIC"
    - "detect_stuck stub (returns None unless RES_FORCE_STUCK is set) — Plan 34-04 fills body"
    - "try_with_fallback stub (returns Err(FallbackExhausted)) — Plan 34-07 fills body"
    - "SessionWriter::new stub (returns no-op writer + 26-char STUB ID) + SessionWriter::append stub (no-op) — Plan 34-08 fills bodies"
    - "load_session stub (returns Err) — Plan 34-09 fills body"
  affects:
    - "src-tauri/src/lib.rs:173-174 — adds `mod resilience;` and `mod session;` registrations (2 lines)"
    - "Wave 2-5 plans can now `use crate::resilience::stuck::*;` and `use crate::session::log::*;` without module-not-found errors"
    - "generate_handler! macro UNCHANGED — the 4 #[tauri::command] stubs are NOT yet registered (Plan 34-10 will register them once bodies are filled)"
tech_stack:
  added: []
  patterns:
    - "Module-scaffold plan: NEW directories under src-tauri/src/, two top-level mod registrations, all bodies are stubs returning safe defaults (None / Err / empty Vec / no-op) — Wave 2-5 plans replace bodies"
    - "Tauri command name uniqueness verified BEFORE creating stubs (grep across src-tauri/src/ returned 0 hits for all 4 names) per CLAUDE.md flat-namespace rule"
    - "thread_local test seams mirror loop_engine::FORCE_VERIFY_PANIC (Phase 33 Plan 33-09): cfg(test)-gated, const-initialized Cell/RefCell, production builds carry zero overhead"
    - "Const-initialized thread_locals (`const { Cell::new(...) }`) for the 3 test seams — matches the Phase 33 Plan 33-09 style and avoids the `lazy initialization` lint"
    - "ResumedConversation.messages typed as Vec<serde_json::Value> rather than Vec<ConversationMessage> because providers::ConversationMessage doesn't derive Serialize/Deserialize — see deviation log"
    - "validate_session_id uses std::sync::OnceLock<regex::Regex> for one-time regex compilation (no once_cell crate dependency needed)"
key_files:
  created:
    - "src-tauri/src/resilience/mod.rs (13 lines — pub mod stuck; pub mod fallback;)"
    - "src-tauri/src/resilience/stuck.rs (108 lines — StuckPattern + discriminant + detect_stuck + RES_FORCE_STUCK + 4 tests)"
    - "src-tauri/src/resilience/fallback.rs (79 lines — FallbackExhausted + Display/Error + try_with_fallback + RES_FORCE_PROVIDER_ERROR + 1 test)"
    - "src-tauri/src/session/mod.rs (14 lines — pub mod log; pub mod resume; pub mod list;)"
    - "src-tauri/src/session/log.rs (184 lines — SessionEvent (7 variants) + ToolCallSnippet + SessionWriter + SESS_FORCE_APPEND_PANIC + 4 tests)"
    - "src-tauri/src/session/resume.rs (52 lines — ResumedConversation + load_session + 1 test)"
    - "src-tauri/src/session/list.rs (123 lines — SessionMeta + 4 #[tauri::command] stubs + validate_session_id + 4 tests)"
  modified:
    - "src-tauri/src/lib.rs (+2 lines: mod resilience + mod session, appended after mod ecosystem)"
decisions:
  - "Placement of mod resilience/mod session at the END of the mod cluster (after mod ecosystem) rather than alphabetically — the existing cluster is NOT alphabetically sorted (e.g. mod ambient, mod evolution, mod loop_engine all sit out of order); appending matches the project's de-facto ordering of `phase add-ons land at the bottom` (see Phase 22 voyager_log, Phase 23 reward, Phase 26 safety_bundle, Phase 33 loop_engine — all appended in chronological-not-alphabetical order)"
  - "ResumedConversation.messages typed as Vec<serde_json::Value> instead of Vec<ConversationMessage> because providers::ConversationMessage does NOT derive Serialize/Deserialize and the struct crosses the Tauri IPC boundary — Plan 34-09 (load_session body) will convert ConversationMessage → JSON Value at the boundary, mirroring the existing brain.rs convention. Plan doc-comment already described 'JSON on the wire' intent so this is the contract finally being typed correctly. Documented as Rule 3 deviation."
  - "All 4 stub functions and SessionWriter methods carry #[allow(dead_code)] because they are not yet called by any production code path — the warning would otherwise be 14 cargo warnings on a substrate plan, drowning the legitimate signal. Plan 34-04..34-10 will remove the attributes as each body wires into a real call site."
  - "Used `const { Cell::new(None) }` and `const { RefCell::new(None) }` for the 3 test seams (matches loop_engine.rs:402 style) — this is the Rust 1.70+ pattern that avoids the `thread_local with lazy initialization` minor cost on every access"
  - "validate_session_id ships in Plan 34-03 (not deferred to Plan 34-10) because the 4 Tauri command stubs WILL be registered in Plan 34-10 unchanged in signature; declaring the validator now means Plan 34-10 only fills bodies and never has to re-author the regex"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-06"
  task_count: 2
  file_count: 8
---

# Phase 34 Plan 34-03: resilience/ + session/ Module Scaffold Summary

Module-skeleton plan landing the empty `resilience/` and `session/` directories
so every Wave 2-5 plan can `use crate::resilience::stuck::*;` or
`use crate::session::log::*;` without a "module not found" compile error.
8 new files (2 mod.rs + 6 submodule files), 2 top-level mod registrations
in lib.rs, 14 stub bodies (1 enum-with-discriminants, 5 structs with no fields
filled, 4 Tauri command stubs returning safe defaults, 4 functions/methods
with `unimplemented!()`-equivalent stub bodies). 14 tests green. cargo check
clean. NO Tauri commands registered in `generate_handler!` (Plan 34-10 does
that registration AFTER the bodies are filled in Plans 34-08..34-10). The
SessionEvent enum lands here in full (all 7 variants) because multiple
downstream plans need to construct events: Plan 34-08 writes them, Plan 34-09
reads them, Plan 34-10 reads them for SessionMeta extraction.

## Tauri Command Name Uniqueness Check

Per CLAUDE.md mandate (Tauri's `#[tauri::command]` macro namespace is FLAT):

```
$ grep -rn "fn list_sessions\b\|fn resume_session\b\|fn fork_session\b\|fn get_conversation_cost\b" /home/arnav/blade/src-tauri/src/
(no output — 0 hits before this plan)
```

After this plan:

```
src-tauri/src/session/list.rs:37:pub async fn list_sessions() -> Result<Vec<SessionMeta>, String> {
src-tauri/src/session/list.rs:43:pub async fn resume_session(_session_id: String)
src-tauri/src/session/list.rs:51:pub async fn fork_session(_parent_id: String, _fork_at_message_index: u32)
src-tauri/src/session/list.rs:59:pub async fn get_conversation_cost(_session_id: String)
```

All 4 names are introduced for the first time in `session/list.rs`. No collisions.

## SessionEvent — 7 Variants (verbatim)

```rust
#[serde(tag = "kind", content = "data")]
pub enum SessionEvent {
    SessionMeta        { id, parent, fork_at_index, started_at_ms }
    UserMessage        { id, content, timestamp_ms }
    AssistantTurn      { content, tool_calls, stop_reason, tokens_in, tokens_out, timestamp_ms }
    ToolCall           { name, args, result, error, timestamp_ms }
    CompactionBoundary { kept_message_count, summary_first_chars, timestamp_ms }
    HaltReason         { reason, payload, timestamp_ms }
    LoopEvent          { kind, payload, timestamp_ms }
}
```

## StuckPattern — 5 Variants (verbatim)

```rust
pub enum StuckPattern {
    CostRunaway,                  // priority 1 — RES-04 cost cap
    RepeatedActionObservation,    // priority 2 — sha2 hash collision in recent_actions
    ContextWindowThrashing,       // priority 3 — compactions_this_run >= threshold
    MonologueSpiral,              // priority 4 — consecutive_no_tool_turns >= threshold
    NoProgress,                   // priority 5 — last_progress_text_hash unchanged
}
```

## Test Seams (3 declared, all cfg(test)-gated)

| Seam | File | Type | Plan that uses it |
|------|------|------|-------------------|
| `RES_FORCE_STUCK` | resilience/stuck.rs | `Cell<Option<StuckPattern>>` | Plan 34-04 (force detect_stuck verdict) |
| `RES_FORCE_PROVIDER_ERROR` | resilience/fallback.rs | `RefCell<Option<String>>` | Plan 34-07 (deterministic chain exhaustion) |
| `SESS_FORCE_APPEND_PANIC` | session/log.rs | `Cell<bool>` | Plan 34-08 (catch_unwind discipline) |

All 3 use `const { Cell::new(...) }` / `const { RefCell::new(...) }` initialization,
mirroring the loop_engine.rs:402 `FORCE_VERIFY_PANIC` pattern from Phase 33 Plan 33-09.

## generate_handler! UNCHANGED

```
$ git diff master~2..master -- src-tauri/src/lib.rs | grep -E "^\+.*::[a-z_]+,?\s*$"
+mod resilience;       // Phase 34 v1.5 — RES-01 stuck + RES-05 provider fallback (Plan 34-03 scaffold)
+mod session;          // Phase 34 v1.5 — SESS-01 JSONL log + SESS-02 resume + SESS-03/04 list/fork (Plan 34-03 scaffold)
```

Only `mod` lines added. The `tauri::generate_handler![]` macro at lib.rs:608
is byte-for-byte identical to its pre-Plan-34-03 contents. Plan 34-10 will
register the 4 commands once the bodies in Plan 34-08/34-09/34-10 land.

## Tests Green (14 total across 5 module files)

```
running 5 tests  (resilience::*)
test resilience::fallback::tests::phase34_fallback_exhausted_constructs_and_displays ... ok
test resilience::stuck::tests::phase34_detect_stuck_returns_none_in_stub ... ok
test resilience::stuck::tests::phase34_res_force_stuck_seam_overrides_stub ... ok
test resilience::stuck::tests::phase34_stuck_pattern_discriminant ... ok
test resilience::stuck::tests::phase34_stuck_pattern_serde_roundtrip ... ok

running 9 tests  (session::*)
test session::list::tests::phase34_session_meta_serde_roundtrip ... ok
test session::list::tests::phase34_validate_session_id_rejects_traversal ... ok
test session::log::tests::phase34_session_event_serde_roundtrip_compaction_boundary ... ok
test session::log::tests::phase34_session_event_all_seven_variants_serialize ... ok
test session::list::tests::phase34_validate_session_id_accepts_ulid ... ok
test session::log::tests::phase34_session_event_serde_roundtrip_user_message ... ok
test session::log::tests::phase34_session_writer_stub_construct ... ok
test session::resume::tests::phase34_load_session_stub_returns_err ... ok
test session::list::tests::phase34_list_sessions_stub_returns_empty ... ok
```

5/5 resilience + 9/9 session = 14/14 green. Combined with the existing 600
filtered-out tests in the lib, total project test count is 614 and rising.

## Cargo Check Clean

```
$ cd src-tauri && cargo check 2>&1 | tail -3
warning: `blade` (lib) generated 14 warnings (run `cargo fix --lib -p blade` to apply 1 suggestion)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 44s
```

Exit 0. The 14 warnings are mostly:
- 4 `function ... is never used` warnings on the 4 Tauri command stubs (expected per plan; they're not yet registered in `generate_handler!` so the compiler can't see a caller; Plan 34-10 wires them up and the warnings disappear)
- ~10 pre-existing warnings unrelated to Plan 34-03 (active_inference_eval.rs, reward.rs, etc.)

The 4 stubs each carry `#[allow(dead_code)]` for the helper functions/methods
to suppress the warning surface for the SessionWriter stubs and the ResumedConversation
stub function (the `#[tauri::command]` macro's generated wrapper still triggers the
"function is never used" warning since cargo doesn't know Plan 34-10 will register
them — that's the 4 unsuppressible warnings; they're tolerated until Plan 34-10).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Typed ResumedConversation.messages as `Vec<serde_json::Value>` instead of `Vec<ConversationMessage>`**

- **Found during:** Task 2 (cargo test --lib session:: failed with E0277)
- **Issue:** `providers::ConversationMessage` does not derive `Serialize` or `Deserialize`. The plan specified `pub messages: Vec<ConversationMessage>` on `ResumedConversation`, which derives `Serialize + Deserialize` because it crosses the Tauri IPC boundary. Result: 4 compile errors (`the trait bound providers::ConversationMessage: serde::Serialize is not satisfied`).
- **Fix:** Changed the field type to `Vec<serde_json::Value>` (matching the plan's own doc-comment which already said "Vec<ConversationMessage> serialized as plain JSON for Tauri transport; the frontend receives this as a list of {role, content} objects"). The plan's prose already described JSON-on-the-wire intent — the field type is now finally consistent with that intent. Plan 34-09 (load_session body) will convert `ConversationMessage → serde_json::Value` at the boundary, mirroring brain.rs's existing convention.
- **Files modified:** src-tauri/src/session/resume.rs
- **Commit:** 9541a7d
- **Cleanest scaffold-level alternative considered:** add `#[derive(Serialize, Deserialize)]` to `ConversationMessage` in providers/mod.rs. Rejected because (a) it would require also deriving on `ToolCall` (the Assistant variant carries `Vec<ToolCall>`) and potentially other transitively-referenced types, (b) it would change the public surface of a heavily-used type in a substrate plan that is supposed to add new files and not modify existing ones, and (c) the plan's doc-comment already chose JSON-on-the-wire as the contract — the type was just lagging.

**2. [Rule 1 — Code hygiene] Added `#[allow(dead_code)]` to 6 stub items (detect_stuck, try_with_fallback, SessionWriter, SessionWriter::new, SessionWriter::append, load_session, validate_session_id)**

- **Found during:** Task 1 + Task 2 (cargo check warnings on unused items)
- **Issue:** Pre-existing baseline cargo warnings + ~10 new "function is never used" warnings would have masked legitimate signal in a substrate plan with no production callers yet
- **Fix:** Selective `#[allow(dead_code)]` on the items that won't have a caller until Plans 34-04..34-10 — leaving the 4 `#[tauri::command]` stubs without the attribute (they'll generate 4 warnings until Plan 34-10 registers them; that's intentional — the warnings serve as a TODO marker for Plan 34-10)
- **Files modified:** src-tauri/src/resilience/stuck.rs, src-tauri/src/resilience/fallback.rs, src-tauri/src/session/log.rs, src-tauri/src/session/resume.rs, src-tauri/src/session/list.rs
- **Commits:** c7428b7 (resilience), 9541a7d (session)

### Authentication Gates Encountered

None — substrate plan, no network calls, no API keys touched.

## Self-Check: PASSED

| Item | Verification |
|------|-------------|
| 8 new files created | `ls src-tauri/src/{resilience,session}/` shows mod.rs + 3 submodules each |
| `mod resilience` + `mod session` in lib.rs | `grep -c "^mod resilience\|^mod session" src-tauri/src/lib.rs` = 2 |
| SessionEvent has 7 variants with serde tag | `grep -c "^    [A-Z]" src-tauri/src/session/log.rs` matches 7 in the enum block |
| 4 #[tauri::command] in list.rs | `grep -c "#\[tauri::command\]" src-tauri/src/session/list.rs` = 4 |
| generate_handler! UNCHANGED | `git diff c7428b7~2..master -- src-tauri/src/lib.rs` shows ONLY 2 mod lines added |
| All 14 tests green | `cargo test --lib resilience:: && cargo test --lib session::` exits 0 |
| Tauri command names unique | `grep -rn "fn list_sessions\b\|fn resume_session\b\|fn fork_session\b\|fn get_conversation_cost\b"` shows 4 hits, all in session/list.rs |
| Commits exist | `git log --oneline -3` shows c7428b7 + 9541a7d |
| 188 stale staged deletions NOT swept in | `git status --short \| grep -v "^ D"` shows 0 staged files post-commit |

## Commits

| Commit | Task | Files | Lines | Tests |
|--------|------|-------|-------|-------|
| `c7428b7` | Task 1 — resilience/ scaffold | 4 (mod.rs, stuck.rs, fallback.rs, lib.rs) | +201 | +5 |
| `9541a7d` | Task 2 — session/ scaffold | 5 (mod.rs, log.rs, resume.rs, list.rs, lib.rs) | +374 | +9 |

Total: 9 file changes (8 new, 1 modified), +575 lines, +14 tests.

## Next Wave Plans

Plan 34-03 unblocks 7 downstream plans:

| Plan | What it fills |
|------|---------------|
| 34-04 | RES-01 stuck detection bodies (5 detectors + priority aggregator + catch_unwind) — uses `resilience::stuck::detect_stuck` |
| 34-05 | RES-02 circuit breaker (widens commands::ERROR_HISTORY tuple, builds CircuitOpen halt) |
| 34-06 | RES-03+04 cost meter (per-conversation cumulative cost + 80%-warn-latch + 100%-halt + cost_update event) |
| 34-07 | RES-05 try_with_fallback body — uses `resilience::fallback::try_with_fallback` |
| 34-08 | SESS-01 SessionWriter::new + SessionWriter::append bodies (ULID + flock + catch_unwind + rotation) — uses `session::log::SessionWriter` |
| 34-09 | SESS-02 load_session body (most-recent compaction-boundary replay, corrupt-line skip) — uses `session::resume::load_session` |
| 34-10 | SESS-03+04 list_sessions + fork_session + resume_session + get_conversation_cost bodies + 4 generate_handler! registrations |
| 34-11 | Frontend (payloads + sessions.ts + ActivityStrip cost-meter + SessionsView + App.tsx route) + 14-step UAT (phase closure) |

## Status

**EXECUTION COMPLETE** — 2/2 tasks done, 14/14 tests green, cargo check clean, both commits atomic, generate_handler! unchanged, no stale staged deletions swept in.
