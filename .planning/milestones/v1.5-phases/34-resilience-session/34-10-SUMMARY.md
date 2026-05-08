---
phase: 34-resilience-session
plan: 10
subsystem: session
tags: [SESS-02, SESS-03, SESS-04, list-sessions, fork-session, resume-session, generate-handler-registration]
requires: [34-03, 34-08, 34-09]
provides:
  - "session::list::list_sessions real body (Plan 34-03 stub filled)"
  - "session::list::resume_session Tauri wrapper (validate + delegate to load_session)"
  - "session::list::fork_session real body — two-pass copy + clamp + grandchild rejection"
  - "lib.rs::generate_handler! registers all 4 session commands (Plan 34-06 already added get_conversation_cost)"
  - "read_meta(path) helper for SessionMeta extraction from JSONL"
affects:
  - "Plan 34-11 (frontend + ActivityStrip + UAT) — SessionsView calls list_sessions, resume button calls resume_session, fork picker calls fork_session, cost meter polls get_conversation_cost"
tech-stack:
  added: []
  patterns:
    - "catch_unwind wrappers at every Tauri-command entry (Phase 31 / 34 panic-safety discipline)"
    - "Two-pass JSONL copy for fork (pass 1 counts ordinals + detects grandchild; pass 2 writes new SessionMeta + copies up to clamped cap)"
    - "Forward-read full JSONL for metadata extraction (CONTEXT lock §SESS-03; v1.6+ optimisation reads first/last N events only)"
    - "validate_session_id at every command entry (defense-in-depth path-traversal block)"
    - "safe_slice(content, 120) for first_message_excerpt — never panics on emoji / CJK"
key-files:
  created: []
  modified:
    - "src-tauri/src/session/list.rs (+~770 lines net) — list_sessions body + read_meta helper + resume_session wrapper + fork_session two-pass body + 11 new tests"
    - "src-tauri/src/lib.rs (+9/-2) — list_sessions + resume_session + fork_session registered in generate_handler!"
decisions:
  - "Followed plan's two-pass fork strategy (pass 1 counts + detects grandchild; pass 2 writes new SessionMeta + selectively copies). Single-pass alternative was considered but rejected — the explicit count gives the user the truth in SessionMeta.fork_at_index when they request past-end."
  - "Other event types (CompactionBoundary, ToolCall, HaltReason, LoopEvent) pass through up to the message cap, then break — once we stop the message stream we stop the whole copy to avoid orphan tool-results that belong to messages NOT in the fork."
  - "resume_session checks BladeConfig.session.jsonl_log_enabled and returns Err with a clear message when disabled. Mirrors the plan's interface comment ('Optionally bail when cfg.session.jsonl_log_enabled = false')."
  - "Both resume_session and fork_session wrap their bodies in std::panic::catch_unwind(AssertUnwindSafe(...)) for defense-in-depth (the inner code paths already return Err on every failure mode, but a future regression should not crash the chat host)."
  - "list_sessions also wraps its body in catch_unwind for the same reason."
  - "Tauri command name uniqueness verified before registration: grep -rn 'fn list_sessions\\b|fn resume_session\\b|fn fork_session\\b|fn get_conversation_cost\\b' /home/arnav/blade/src-tauri/src/ returns ONLY hits inside session/list.rs. The runtimes::runtime_list_sessions / runtimes::runtime_resume_session commands are different names (different module + 'runtime_' prefix) — zero conflict."
metrics:
  tasks_completed: 3
  duration: "~25min implementation + ~12min cargo check/test cycles"
  completed_date: "2026-05-06"
---

# Phase 34 Plan 10: SESS-03 list_sessions + SESS-04 fork_session + Tauri command registration

## One-liner

Filled `list_sessions` (walk `jsonl_log_dir`, parse each `*.jsonl`'s metadata via `read_meta`, sort desc by `started_at_ms`), `resume_session` (validate + delegate to `load_session` with disabled-config bail and `catch_unwind`), and `fork_session` (two-pass copy: count + grandchild-detect, then write fresh `SessionMeta` and copy ordinals up to clamped index). Registered all 3 commands plus `get_conversation_cost` (already added by Plan 34-06) in `lib.rs::generate_handler!`. 11 new unit tests green; the full `phase34` `session::list` suite has 17 tests passing.

## list_sessions body summary (5-line slice)

```rust
let mut metas: Vec<SessionMeta> = Vec::new();
// ... walk dir, validate filenames, parse via read_meta ...
metas.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
Ok(metas)
```

Walks `BladeConfig.session.jsonl_log_dir`, filters `*.jsonl` files (`archive/` is a directory and is filtered out implicitly via `path.is_file()`), validates each filename's stem via `validate_session_id` (defense-in-depth — rejects any stray non-ULID files), parses metadata via `read_meta`, returns `SessionMeta` entries sorted desc by `started_at_ms`. Wrapped in `catch_unwind`.

## read_meta helper signature

```rust
fn read_meta(path: &std::path::Path) -> std::io::Result<Option<SessionMeta>>
```

- Returns `Ok(Some(SessionMeta))` when a `SessionEvent::SessionMeta` line is found.
- Returns `Ok(None)` when no `SessionMeta` is found (corrupted file).
- Returns `Err(io::Error)` on file open failure.

Walks JSONL line-by-line, populating:
- `id`, `parent`, `started_at_ms` from the `SessionMeta` event.
- `first_message_excerpt = safe_slice(content, 120)` from the first `UserMessage`.
- `message_count` += 1 for each `UserMessage` and `AssistantTurn`.
- `approximate_tokens` += `tokens_in + tokens_out` for each `AssistantTurn`.
- `halt_reason` from the LAST `HaltReason` event.

Corrupt lines are skipped silently (`serde_json::from_str` failure → continue).

## fork_session two-pass logic

**Pass 1** (count + detect):
- Open parent JSONL.
- For each line, push to `all_lines: Vec<String>` AND parse as `SessionEvent`.
- Count `UserMessage + AssistantTurn` ordinals into `total_messages`.
- If parent's `SessionMeta.parent.is_some()` → set `parent_is_fork = true`.

After pass 1:
- If `parent_is_fork` → return `Err("cannot fork a session that is itself a fork — one-level deep only (v1.6+ may relax this)")`.
- Compute `fork_at_clamped = fork_at_message_index.min(total_messages)`.

**Pass 2** (write):
- Generate fresh ULID via `ulid::Ulid::new().to_string()`.
- Open new file `{jsonl_log_dir}/{new_id}.jsonl`.
- Write a fresh `SessionEvent::SessionMeta { id: new_id, parent: Some(parent_id), fork_at_index: Some(fork_at_clamped), started_at_ms: now_ms() }` as the FIRST line.
- Walk `all_lines`:
  - `SessionMeta` events from the parent → skipped (we wrote our own).
  - `UserMessage` / `AssistantTurn` → copied if `copied_messages < fork_at_clamped`; once the cap is reached, `break` (stop copying entirely so orphan tool-results don't leak into the child).
  - `CompactionBoundary` / `ToolCall` / `HaltReason` / `LoopEvent` → pass through unconditionally up to the cap (they belong to already-copied messages — forensic continuity per CONTEXT lock §SESS-04).

Returns the new ULID.

## Grandchild rejection error message (verbatim)

```
cannot fork a session that is itself a fork — one-level deep only (v1.6+ may relax this)
```

The test `phase34_sess_04_fork_session_rejects_grandchild` asserts the error contains either `"one-level deep"` or `"itself a fork"`.

## Test results — 11 new + 6 pre-existing = 17 green

```
running 17 tests
test session::list::tests::phase34_get_conversation_cost_rejects_invalid_id ... ok
test session::list::tests::phase34_resume_session_validates_session_id ... ok
test session::list::tests::phase34_get_conversation_cost_reads_last_cost_update ... ok
test session::list::tests::phase34_get_conversation_cost_missing_session_returns_zero ... ok
test session::list::tests::phase34_resume_session_disabled_returns_err ... ok
test session::list::tests::phase34_sess_03_list_sessions_empty_dir ... ok
test session::list::tests::phase34_sess_03_list_sessions_populates_first_message_excerpt ... ok
test session::list::tests::phase34_sess_03_list_sessions_returns_sorted_by_started_at_desc ... ok
test session::list::tests::phase34_sess_03_list_sessions_skips_archive_subdir ... ok
test session::list::tests::phase34_sess_03_list_sessions_skips_corrupt_files ... ok
test session::list::tests::phase34_sess_04_fork_session_validates_parent_id ... ok
test session::list::tests::phase34_session_meta_serde_roundtrip ... ok
test session::list::tests::phase34_validate_session_id_accepts_ulid ... ok
test session::list::tests::phase34_validate_session_id_rejects_traversal ... ok
test session::list::tests::phase34_sess_04_fork_session_clamps_index_to_message_count ... ok
test session::list::tests::phase34_sess_04_fork_session_creates_new_file_with_parent ... ok
test session::list::tests::phase34_sess_04_fork_session_rejects_grandchild ... ok

test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 661 filtered out; finished in 0.19s
```

| # | Test | What it verifies |
|---|------|------------------|
| 1 | `phase34_sess_03_list_sessions_returns_sorted_by_started_at_desc` | 3 sessions written; list returns desc order; first_message_excerpt + message_count + approximate_tokens + halt_reason populated correctly |
| 2 | `phase34_sess_03_list_sessions_skips_corrupt_files` | 1 valid + 1 corrupt (no SessionMeta) → only valid one returned |
| 3 | `phase34_sess_03_list_sessions_populates_first_message_excerpt` | 500-char content → excerpt is exactly 120 chars (safe_slice); excerpt is the FIRST UserMessage, not the second |
| 4 | `phase34_sess_03_list_sessions_skips_archive_subdir` | 1 live + 1 in archive/ → only live appears |
| 5 | `phase34_sess_03_list_sessions_empty_dir` | empty dir → Ok(empty vec) |
| 6 | `phase34_sess_04_fork_session_creates_new_file_with_parent` | 5-msg parent, fork at 3 → child has SessionMeta + 3 messages (4 lines), parent + fork_at_index=3 set |
| 7 | `phase34_sess_04_fork_session_clamps_index_to_message_count` | 2-msg parent, fork at 999 → SessionMeta.fork_at_index = 2 (clamped) |
| 8 | `phase34_sess_04_fork_session_rejects_grandchild` | parent.parent = Some(...) → Err containing "one-level deep" or "itself a fork" |
| 9 | `phase34_sess_04_fork_session_validates_parent_id` | `fork_session("../../etc/passwd", 0)` → Err |
| 10 | `phase34_resume_session_validates_session_id` | `resume_session("../../etc/passwd")` → Err |
| 11 | `phase34_resume_session_disabled_returns_err` | `jsonl_log_enabled=false` config.json → Err containing "disabled" or "nothing to resume" |

(Pre-existing in the same module: `phase34_session_meta_serde_roundtrip`, `phase34_validate_session_id_accepts_ulid`, `phase34_validate_session_id_rejects_traversal`, `phase34_get_conversation_cost_reads_last_cost_update`, `phase34_get_conversation_cost_missing_session_returns_zero`, `phase34_get_conversation_cost_rejects_invalid_id`.)

## generate_handler! registration (4 lines added by Plan 34-10)

`get_conversation_cost` was already registered by Plan 34-06 (commit `063171f`); Plan 34-10 added the comment block clarification + 3 new lines:

```rust
            // Phase 34 / Plan 34-06 (RES-03) — chat-input cost-meter chip
            // reads conversation-lifetime spend on session load. Live ticks
            // come via the blade_loop_event { kind: "cost_update" } stream
            // emitted by run_loop each iteration. Frontend wiring lands in
            // Plan 34-11.
            session::list::get_conversation_cost,
            // Phase 34 / Plan 34-10 (SESS-02 + SESS-03 + SESS-04) — session
            // persistence Tauri commands. Plan 34-03 declared the stubs;
            // Plan 34-10 filled the bodies + registers them here. Plan 34-11
            // wires the SessionsView frontend (resume button + fork picker
            // + cost meter polling get_conversation_cost on session load).
            session::list::list_sessions,
            session::list::resume_session,
            session::list::fork_session,
```

## Tauri command uniqueness check (verbatim grep output)

```
$ grep -rn "fn list_sessions\b\|fn resume_session\b\|fn fork_session\b\|fn get_conversation_cost\b" /home/arnav/blade/src-tauri/src/
/home/arnav/blade/src-tauri/src/session/list.rs:48:pub async fn list_sessions() -> Result<Vec<SessionMeta>, String> {
/home/arnav/blade/src-tauri/src/session/list.rs:198:pub async fn resume_session(
/home/arnav/blade/src-tauri/src/session/list.rs:241:pub async fn fork_session(
/home/arnav/blade/src-tauri/src/session/list.rs:398:pub async fn get_conversation_cost(
```

ZERO collisions outside `session/list.rs`. The `runtimes::runtime_list_sessions` and `runtimes::runtime_resume_session` commands at `lib.rs:745` and `lib.rs:750` are DIFFERENT names (with the `runtime_` prefix) — Tauri's flat-namespace command registration sees them as distinct.

## cargo check + test results

```
$ cargo check --lib 2>&1 | tail -3
warning: `blade` (lib) generated 9 warnings (run `cargo fix --lib -p blade` to apply 2 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 32s
```

```
$ cargo test --lib -- session::list::tests::phase34 2>&1 | tail -3
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 661 filtered out; finished in 0.19s
```

## Notes for Plan 34-11 (frontend + ActivityStrip + UAT close)

- **SessionsView list rendering:** `await invoke<SessionMeta[]>("list_sessions")` returns the sorted-desc-by-`started_at_ms` array. Each row should display: `first_message_excerpt` (already safe-slice-truncated to 120 chars), `message_count`, `approximate_tokens`, `halt_reason` (badge if Some), and a parent indicator if `parent` is Some.
- **Resume button:** `await invoke<ResumedConversation>("resume_session", { sessionId })`. The IPC payload is `{ session_id, messages: Vec<{role, content, ...}>, last_compaction_boundary_at }`. The frontend should render `messages` synchronously into the chat area — no `chat_token` stream involved on resume (CLAUDE.md streaming-contract trap pre-empted by Plan 34-09's design).
- **Fork picker:** `await invoke<string>("fork_session", { parentId, forkAtMessageIndex })`. Returns the new session_id (ULID string). Note: `forkAtMessageIndex` counts UserMessage + AssistantTurn ordinals only (not ToolCall / CompactionBoundary). Forking does NOT auto-resume — surface a "Resume now?" CTA after the new ID returns.
- **Grandchild UI guard:** the backend rejects forking-a-fork with the error message above. Frontend should hide the fork button when the loaded session's `meta.parent.is_some()` to give a smoother UX, but the backend Err is the safety net.
- **Cost meter:** `await invoke<{spent_usd, cap_usd, percent}>("get_conversation_cost", { sessionId })` once on session load; thereafter subscribe to the `blade_loop_event { kind: "cost_update" }` stream for live ticks.
- **UAT scope:** Plan 34-11 is the FIRST runtime-UAT plan in Phase 34. Per CLAUDE.md Verification Protocol, Plan 34-11 must run `npm run tauri dev`, exercise list/resume/fork/cost-meter end-to-end, and screenshot the SessionsView at 1280×800 + 1100×700.

## Link to final plan

- **Plan 34-11** (`/home/arnav/blade/.planning/phases/34-resilience-session/34-11-PLAN.md`) — frontend SessionsView + ActivityStrip + Phase 34 UAT close.

## Deviations from Plan

### Auto-fixed issues

None outside scope. The plan executed as written. One minor adjustment for test correctness:

**[Rule 1 - Bug] `phase34_resume_session_disabled_returns_err` test config.json must include required top-level fields**

- **Found during:** Task 2 (writing the resume_session disabled test)
- **Issue:** The plan's interface comment suggested the test set `jsonl_log_enabled=false`, but `DiskConfig` in `config.rs` does NOT have `#[serde(default)]` on `provider`, `model`, or `onboarded`. A bare `{"session":{"jsonl_log_enabled":false}}` would fail to deserialize, fall through to the corrupt-config recovery branch, and use `DiskConfig::default()` (which has `jsonl_log_enabled=true`) — making the test silently no-op.
- **Fix:** Wrote the full minimal valid JSON: `{"provider":"","model":"","onboarded":false,"session":{"jsonl_log_enabled":false}}`. Documented inline as a comment so future plans know this trap.
- **Files modified:** `src-tauri/src/session/list.rs` (test only)
- **Commit:** `eab4d83` (Task 2)

### Test count vs plan

The plan's `must_haves.truths` enumerated 4 specific test names; the operator's prompt enumerated 10. Plan 34-10 delivered all 10 from the prompt + 1 additional (`phase34_sess_03_list_sessions_empty_dir`) = 11 new tests. Plus 6 pre-existing tests in the same module → 17 total passing.

## Threat surface

No new threat surface introduced. The plan's threat register entries (T-34-41 through T-34-45) all retain their `accept` dispositions:

- **T-34-41 (Spoofing — different user's session_id):** `validate_session_id` blocks path traversal at every command entry; OS-level fs perms cover cross-user.
- **T-34-42 (DoS — large parent JSONL fork):** Two-pass read O(file size); rotation cap (`keep_n_sessions=100`) bounds worst-case.
- **T-34-43 (Tampering — manually edited parent.parent=null bypasses grandchild check):** User can already edit their own JSONL files; check is best-effort. v1.6+ may add hash-chain.
- **T-34-44 (Information disclosure — message_count + first_message_excerpt):** User asking for own session list. No cross-user exposure.
- **T-34-45 (DoS — adversarial 10M-line JSONL slows list_sessions):** Rotation caps live sessions at 100; v1.6+ optimisation reads first/last N events only.

All commands wrapped in `catch_unwind` for panic safety net beyond the existing `Result`-typed error paths.

## Files modified

- `src-tauri/src/session/list.rs` — list_sessions body + read_meta helper (Task 1, commit `e06c690`); resume_session wrapper + fork_session two-pass body + 6 tests (Task 2, commit `eab4d83`)
- `src-tauri/src/lib.rs` — generate_handler! registration of 3 commands (Task 3, commit `7f885f7`)

## Commits

- `e06c690` — feat(34-10): fill list_sessions body + read_meta helper (SESS-03)
- `eab4d83` — feat(34-10): fill resume_session + fork_session bodies (SESS-02/SESS-04)
- `7f885f7` — feat(34-10): register list_sessions + resume_session + fork_session in generate_handler! (SESS-02/SESS-03/SESS-04)

## Self-Check: PASSED

- File exists: `src-tauri/src/session/list.rs` ✓
- File exists: `src-tauri/src/lib.rs` ✓
- Commit `e06c690` present in `git log --oneline` ✓
- Commit `eab4d83` present in `git log --oneline` ✓
- Commit `7f885f7` present in `git log --oneline` ✓
- 11 new phase34 tests green (5 SESS-03 + 4 SESS-04 + 2 resume) ✓
- cargo check clean ✓
- 4 Tauri commands registered in generate_handler! (1 from Plan 34-06 + 3 from Plan 34-10) ✓
- `grep -c "fn read_meta"` → 1 ✓
- `grep -c "metas.sort_by"` → 1 ✓
- Tauri command name uniqueness verified — only hits inside session/list.rs ✓
- No accidental file deletions in commits ✓
