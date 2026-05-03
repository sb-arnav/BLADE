---
phase: 24-skill-consolidation-dream-mode
reviewed: 2026-05-01T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src-tauri/src/bin/skill_validator.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/db.rs
  - src-tauri/src/dream_mode.rs
  - src-tauri/src/intent_router.rs
  - src-tauri/src/jarvis_dispatch.rs
  - src-tauri/src/lib.rs
  - src-tauri/src/proactive_engine.rs
  - src-tauri/src/session_handoff.rs
  - src-tauri/src/skills/lifecycle.rs
  - src-tauri/src/skills/loader.rs
  - src-tauri/src/skills/mod.rs
  - src-tauri/src/skills/pending.rs
  - src-tauri/src/tool_forge.rs
  - src-tauri/src/voyager_log.rs
findings:
  critical: 0
  warning: 6
  info: 9
  total: 15
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-05-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 24 wires the "forgetting half" of the Voyager loop: 3 dream-mode tasks (prune / consolidate / from_trace), the `.pending/` operator-confirmation queue, the `IntentClass::ProposalReply` chat-injected apply path, and a `skill_validator list --diff` CLI subcommand. Cross-module surfaces (`open_db_for_lifecycle`, `list_skills_snapshot`, `record_tool_use(name, &turn_tool_names)`, `dream_*` voyager_log helpers) are all properly wired and the 6-place config rule is honored (no config changes needed). The streaming contract is correctly observed at the chat-injected apply site (`blade_message_start` → `chat_token` → `chat_done`).

No critical security or correctness defects. Findings concentrate on:
- Race / atomicity gaps around `DREAMING` state during background tasks (the per-step abort guarantee is robust, but two task-start branches can run after interrupt).
- Resilience around side-effecting paths that swallow errors silently in ways that could leave inconsistent state.
- Several content-hash + dedup logic details where the implementation deviates from the comment-stated invariant.
- Documentation / minor code-quality items.

The Phase 24 substrate is shippable, but the 6 warnings should be addressed (or explicitly accepted) before milestone close per the BLADE Verification Protocol.

## Warnings

### WR-01: `apply_proposal_reply` merge path archives sources non-atomically and loses errors

**File:** `src-tauri/src/commands.rs:715-722`
**Issue:** When applying a "yes" reply on a `merge` proposal, the merged tool is INSERTed first, then both source skills are archived via `let _ = crate::skills::lifecycle::archive_skill(source_a)` (errors discarded). If the second archive fails (e.g., dir locked, I/O error), the merged tool is persisted but one source row remains live in `forged_tools` — the operator sees `foo`, `bar`, AND `foo_merged` after a "successful" reply, which violates the D-24-E LOCK invariant ("merge replaces both sources"). The success message also lies to the operator: `"Sources archived"` is printed regardless of actual archive outcome.

**Fix:**
```rust
// Track per-source results and surface them to the operator.
let arch_a = if !source_a.is_empty() {
    crate::skills::lifecycle::archive_skill(source_a).err()
} else { None };
let arch_b = if !source_b.is_empty() {
    crate::skills::lifecycle::archive_skill(source_b).err()
} else { None };
crate::skills::pending::delete_proposal(id)?;
match (arch_a, arch_b) {
    (None, None) => Ok(format!("Merged `{}` + `{}` -> `{}`. Sources archived.", source_a, source_b, merged.name)),
    (a, b) => Ok(format!(
        "Merged `{}` + `{}` -> `{}`. Source archive results: {} / {}.",
        source_a, source_b, merged.name,
        a.map(|e| format!("a: {e}")).unwrap_or_else(|| "a: ok".into()),
        b.map(|e| format!("b: {e}")).unwrap_or_else(|| "b: ok".into()),
    )),
}
```

### WR-02: Dream-task interrupt check fires AFTER tasks_completed/insights are pushed for a timed-out task

**File:** `src-tauri/src/dream_mode.rs:580-602`
**Issue:** The `run_task!` macro pushes `task_name` and `result` into `tasks_completed` / `insights` BEFORE checking `DREAMING.load`. If a task times out at the 120s mark AND the user becomes active during that same window, the session reports the task as "completed" with insight `"<name> timed out"` but with status `"interrupted"`. The `dream_mode_end` event then claims `tasks_completed = N` but those tasks did not complete — they timed out and the loop bailed. Downstream consumers (the activity strip, voyager_log) cannot distinguish "5 tasks completed cleanly" from "5 task names recorded, last 3 timed out and run was aborted."

**Fix:** Either record only successful (`Ok`) results in `tasks_completed`, or split the array so timeouts go into a separate `timed_out` bucket. Minimum: rename the field to `tasks_attempted`, since "completed" is misleading.

### WR-03: `DREAMING` is checked between tasks but not before initial task spawns from `dream_trigger_now`

**File:** `src-tauri/src/dream_mode.rs:704-720`
**Issue:** `dream_trigger_now` flips DREAMING to `true`, then runs the full session synchronously. There is no abort path if the user starts typing 5 seconds in — the per-task abort checkpoint will fire eventually, but `dream_trigger_now` itself doesn't surface a cancellation seam. Worse: the manual trigger overwrites `DREAMING` to `false` at line 711 unconditionally, even if the auto-loop spawned a parallel session and is still running (the auto-loop's `compare_exchange` at line 681 protects itself, but a manual trigger fired during an auto-session would race the auto-session's atomic store and could leave DREAMING in an inconsistent state if interleaved unfortunately).

**Fix:** Use `compare_exchange` instead of `swap`/`store` in `dream_trigger_now`, mirroring the auto-loop pattern at line 681. Concretely: `if DREAMING.compare_exchange(false, true, SeqCst, Relaxed).is_err() { return Err(...) }` at the start, and the same compare_exchange (true → false) at the end.

### WR-04: `archive_skill` deletes DB row even when filesystem source dir was missing

**File:** `src-tauri/src/skills/lifecycle.rs:260-273`
**Issue:** The `if src.exists()` guard at line 260 silently skips the rename when the source dir is missing — but the DB DELETE at line 269 still executes. The result: a `forged_tools` row exists in the table at start of the call, no on-disk skill dir is present, and after the call the DB row is gone but no archive entry was ever created. This is *probably* fine for the dream prune path (where the row's script_path lives under `~/.blade/tools/`, not the skill dir), but the docstring at line 244-246 says "archives a forged-tool's filesystem dir … then DELETE the forged_tools DB row." The actual behavior diverges from the doc — and a DB delete with no matching FS-side archive removes the only record of the tool.

**Fix:** Either (a) make the DB delete conditional on a successful rename (the docstring's intent), or (b) update the docstring to reflect that the DB delete is unconditional and the FS-rename is best-effort. Since `prune_candidate_selection` already filters on `last_used`, dropping orphan rows by deleting them is reasonable — but the divergence from the doc is the bug.

### WR-05: Dream-mode loop interrupt may double-emit `dream_mode_end`

**File:** `src-tauri/src/dream_mode.rs:660-694`
**Issue:** When the monitor loop detects user activity (line 661), it sets `DREAMING = false` and emits `dream_mode_end{ reason: "interrupted", tasks_completed: 0 }`. But the spawned dream session (line 678-691) is *still running asynchronously* and will eventually emit its own `dream_mode_end` event when it finishes (with `status: "interrupted"`). Frontend listeners for `dream_mode_end` will receive two events for one session — the first with `tasks_completed: 0` and the second with the actual count — and may flicker the UI or double-fire any "session ended" side effects.

**Fix:** Track whether the interrupt-emit has fired (e.g., a session-id-keyed flag) and have the spawned session skip its own emit if it sees the interrupt-emit already happened. Or have only the spawned task emit; the monitor loop just flips DREAMING.

### WR-06: `skill_validator list --diff` archived bucket has redundant filter that masks logic intent

**File:** `src-tauri/src/bin/skill_validator.rs:329-335`
**Issue:** The archived-set computation reads:
```rust
let archived: Vec<String> = prior
    .skills_snapshot.iter()
    .filter(|r| !current_names.contains(&r.name) || archived_now.contains(&r.name))
    .filter(|r| archived_now.contains(&r.name))
    .map(|r| r.name.clone())
    .collect();
```
The first `.filter` includes a name if it's gone from current OR present in archived_now; the second `.filter` then re-filters down to only names in archived_now. The first filter's `!current_names.contains(...)` clause is dead — anything passing the second filter must be in archived_now, which (if archived_now ⊆ current_names) means the first filter's first arm is redundant. If the intent was to also list "prior names that are now gone with no archived footprint" (e.g., consolidated-but-not-archived) — that intent isn't implemented; the second filter discards them.

**Fix:** Either drop the first filter (it's dead code today):
```rust
let archived: Vec<String> = prior.skills_snapshot.iter()
    .filter(|r| archived_now.contains(&r.name))
    .map(|r| r.name.clone())
    .collect();
```
or restructure to reflect the intended Venn diagram. Add a unit test that pins archived-set behavior for the (gone, not archived) edge case.

## Info

### IN-01: `compute_content_hash` uses non-canonical JSON serialization

**File:** `src-tauri/src/skills/pending.rs:50-59`
**Issue:** `serde_json::to_string(payload)` does not produce canonical JSON — key ordering depends on the input value's internal map ordering. If two equivalent proposals are constructed with different key orderings (e.g., one path builds `{"trace": [...], "proposed_skill_md": "..."}` and another builds `{"proposed_skill_md": "...", "trace": [...]}`), they produce different hashes and `write_proposal` will not dedup them. In practice, the two writers (`task_skill_consolidate` and `task_skill_from_trace`) each use a single `serde_json::json!` literal so this is stable today — but a future contributor adding a third writer with different key order would break dedup silently.

**Fix:** Sort keys before hashing, e.g., serialize via `serde_json::to_value(...)` then `to_string(&value)` after walking the value to canonicalize key order — or use `serde_json::Map` with a `BTreeMap` shim.

### IN-02: `uuid_v4()` in `dream_mode.rs` is a homemade hash, not a UUID

**File:** `src-tauri/src/dream_mode.rs:60-70`
**Issue:** The function is named `uuid_v4` but uses `DefaultHasher` over thread id + timestamps to produce a 32-hex-char string. It's not RFC4122 compliant and collisions, while rare, are far more likely than a real v4 (DefaultHasher is not cryptographic). Since `uuid` is already a Cargo dep (version 1, "v4" feature) and used elsewhere in the same file (line 348, 403), this homemade version is unnecessary.

**Fix:**
```rust
fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}
```

### IN-03: `task_code_health_scan` shells out to `find` and `cat` — bypasses BLADE's own tool surface

**File:** `src-tauri/src/dream_mode.rs:431-480`
**Issue:** The dream-mode code-health task uses `crate::native_tools::run_shell` with raw `find` and `cat` invocations. Per CLAUDE.md "What NOT to Do": `Don't use 'grep'/'cat'/'find' in bash — use the Read/Grep/Glob tools`. While that rule is aimed at agent invocations rather than internal Rust code, the same rule applies in spirit (these tools are non-portable across BLADE's three CI platforms — `find -newer .` semantics differ on macOS BSD vs Linux GNU). The hardcoded `cat {}` also has shell-injection potential if a filename contains a space or special char.

**Fix:** Use `std::fs::read_to_string` and `walkdir`/`glob` crates (or extend an existing helper). At minimum, quote the filename: `format!("cat {}", shell_escape::escape(file.into()))`.

### IN-04: `record_tool_use` `forged_names` HashSet rebuilt per tool invocation

**File:** `src-tauri/src/commands.rs:2342-2356`
**Issue:** Inside the chat tool loop, every tool call rebuilds the full `forged_names` set by calling `crate::tool_forge::get_forged_tools()` (which is a full SQLite SELECT on the `forged_tools` table). For a long agentic run with N tool calls, this is N table scans where 1 would suffice (cache once at turn start). For a session with 50 forged tools and 100 tool calls in a turn, that's 5000 row scans for what is essentially a membership test.

**Fix:** Build the set once per turn outside the tool loop:
```rust
let forged_names: HashSet<String> = tool_forge::get_forged_tools()
    .into_iter().map(|t| t.name).collect();
// ... then inside the loop, just consult the cached set.
```
Performance is out of v1 review scope — but this is also a code-clarity issue, not just perf.

### IN-05: `task_skill_synthesis` insights message hardcoded to "Reviewed skill patterns"

**File:** `src-tauri/src/dream_mode.rs:251-254`
**Issue:** The string "Reviewed skill patterns" is returned regardless of whether `maybe_synthesize_skills` actually did anything (synthesized 0, 1, or 5 skills). Insights surfaced to the user via `dream_task_complete` should reflect actual work done.

**Fix:** Have `maybe_synthesize_skills` return a count or summary string, and propagate that into the insight.

### IN-06: `dream_trigger_now` lacks the `background_ai_enabled` check that `run_dream_session` has

**File:** `src-tauri/src/dream_mode.rs:705`
**Issue:** `run_dream_session` early-returns if `!config.background_ai_enabled` (line 559), but `dream_trigger_now` flips `DREAMING` to true BEFORE calling it — so a manual trigger with the config disabled flips DREAMING to true, run_dream_session returns the "skipped" status, then dream_trigger_now flips DREAMING back to false. State never escapes, but a `dream_mode_start` event is emitted with `manual: true` for a session that did nothing. UI would show "BLADE entered dream mode" then "session skipped" within microseconds — confusing.

**Fix:** Move the `background_ai_enabled` check into `dream_trigger_now` itself before any state change or event emit.

### IN-07: `intent_router` proposal_reply regex is case-insensitive but match is on `&lower`

**File:** `src-tauri/src/intent_router.rs:108-110`
**Issue:** The regex `(?i)\b(yes|no|dismiss)\s+([a-f0-9]{4,})\b` already has the `(?i)` inline flag, but the function `match_proposal_reply` is invoked with `lower` (the whole message lowercased). The `(?i)` flag is redundant given the input is already lowercased, AND the `[a-f0-9]` charset means "ABC12345" couldn't match before lowercasing — so the test `proposal_reply_dismiss_uppercase_normalised` (intent_router.rs:535) only passes because `classify_intent_class` lowercases before calling `match_proposal_reply`. Worth a comment explaining why `(?i)` exists when the input is pre-lowered.

**Fix:** Drop the redundant `(?i)` flag, or document why it's defensive (e.g., "in case a future caller skips the lower step").

### IN-08: `last_5_trace_hashes` uses `id DESC LIMIT 5` — silently truncates if a tool has fewer than 5 invocations

**File:** `src-tauri/src/skills/lifecycle.rs:166-183` and consumer `src-tauri/src/dream_mode.rs:336`
**Issue:** The consolidate-pass guard at dream_mode.rs:336 reads `if hashes_a.len() == 5 && hashes_a == hashes_b` — strictly 5. New forged tools with <5 invocations can never be consolidate candidates until they're called 5 times. That's the documented intent (D-24-B), but worth a one-line comment in `last_5_trace_hashes` saying "callers MUST gate on len() == 5; partial vecs are not consolidate-safe."

**Fix:** Add a docstring note. No code change needed.

### IN-09: `skill_validator` `run_list_diff` returns ExitCode::SUCCESS even when session_id parse fails

**File:** `src-tauri/src/bin/skill_validator.rs:286-400`
**Issue:** The function early-returns `ExitCode::from(2)` on read or parse error of the prior session JSON (lines 293, 302), but the test at line 616 (`run_list_diff("test1", false)`) only asserts SUCCESS on the happy path. There is no test for the failure paths. Risk is small but the CLI's contract for an invalid session_id is not pinned.

**Fix:** Add a unit test exercising `run_list_diff("nonexistent_session_id", false)` and asserting non-zero exit.

---

_Reviewed: 2026-05-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
