---
phase: 35-auto-decomposition
plan: 8
subsystem: agentic-loop / decomposition / fork merge-back IPC + JSONL append helpers
tags:
  - decomposition
  - DECOMP-04
  - merge-fork-back
  - tauri-command
  - SessionEvent
  - LoopEvent
  - UserMessage
  - fs2-advisory-lock
  - catch_unwind
  - phase-35
dependency-graph:
  requires:
    - "Phase 34 SESS-04 — fork_session writes the forked JSONL with SessionMeta.parent + fork_at_index attribution"
    - "Phase 34 SESS-04 — validate_session_id Crockford-base32 regex helper (path-traversal hardening)"
    - "Plan 35-06 — distill_subagent_summary cheap-model body + heuristic catch_unwind fallback (returns SubagentSummary.summary_text)"
    - "Plan 35-01 — DecompositionConfig.subagent_summary_max_tokens (caps the synthetic UserMessage content via safe_slice × 4)"
    - "Phase 34 SESS-01 — fs2 advisory exclusive lock pattern for atomic JSONL appends"
    - "futures crate (FutureExt::catch_unwind for the async distillation boundary — already in Cargo.toml)"
    - "agents::AgentRole::Analyst (CONTEXT lock — branch-merge distillation is structurally analytical)"
  provides:
    - "merge_fork_back(fork_id) Tauri command — folds a fork's distilled summary back into its parent JSONL by appending LoopEvent{kind:fork_merged} + synthetic UserMessage with the bracketed-prefix header"
    - "MergeResult struct (Debug/Clone/Serialize/Deserialize) — IPC return shape consumed by Plan 35-09's mergeForkBack TS wrapper"
    - "read_parent_from_meta(path) helper — walks JSONL, returns first SessionMeta.parent (Some=fork, None=top-level)"
    - "append_events_to_jsonl(path, events) helper — fs2 advisory-locked atomic batch append, never truncates"
    - "Tauri handler registration: session::list::merge_fork_back in lib.rs::generate_handler!"
  affects:
    - "src-tauri/src/session/list.rs (MergeResult struct + merge_fork_back command + 2 helpers + 7 phase35_decomp_04 tests)"
    - "src-tauri/src/lib.rs (single line added to generate_handler! macro)"
tech-stack:
  added: []
  patterns:
    - "Defense-in-depth — validate_session_id is run a SECOND time on the parent_id we read off disk (before joining a path), defending against a hostile user editing the JSONL by hand to inject path-traversal segments"
    - "Layered catch_unwind — sync wrap on read_parent_from_meta + futures::FutureExt::catch_unwind on the async distillation + sync wrap on append_events_to_jsonl. Each panic boundary surfaces as Err with a `[DECOMP-04]` log line; the IPC host process never crashes regardless of which step fails"
    - "fs2 advisory exclusive lock on parent JSONL append — T-35-31 mitigation: serializes merge-back appends against any concurrent SessionWriter::append on the same file (mirror of Phase 34 SESS-01 discipline)"
    - "Append-only merge semantics — the fork's JSONL is preserved on disk; merge-back is a one-way append into the parent. Users can fork-then-merge multiple times (each merge stacks a new event with a fresh ULID per T-35-29 accept disposition)"
    - "Synthetic-message safe_slice cap — content is bounded by `subagent_summary_max_tokens × 4` chars (rough token→char ratio of 4), inheriting the Plan 35-06 cap so distillations cannot bloat the parent's context arbitrarily"
key-files:
  created: []
  modified:
    - src-tauri/src/session/list.rs
    - src-tauri/src/lib.rs
decisions:
  - "AgentRole::Analyst chosen for the distillation call per CONTEXT lock §DECOMP-04 — branch-merge distillation is structurally analytical (vs. the Coder/Researcher/Writer roles which describe step-execution flavor). The distill_subagent_summary helper from Plan 35-06 takes role only as a prompt-shaping signal, so this is a pure prompt-quality decision; fallback heuristic ignores role entirely."
  - "Defense-in-depth validate_session_id call on parent_id — added even though validate_session_id was already called on fork_id at the entry. Reasoning: a hostile user with filesystem access could edit the fork's SessionMeta.parent field directly to a `../../etc/passwd`-shaped string. validate_session_id on the read-back value catches that BEFORE dir.join() builds the parent path. Cost: 1 regex match per merge call. [Rule 2 — auto-add: missing critical security validation against on-disk tampering.]"
  - "8-char fork_id excerpt via safe_slice(&fork_id, 8) instead of `&fork_id[..8]` — fork_id is a 26-char Crockford-base32 ASCII string after validate_session_id, so direct slice would be safe, but the codebase uses safe_slice uniformly per CLAUDE.md (\"ALWAYS use crate::safe_slice, never &text[..n]\"). Cheap enough; consistent."
  - "Layered catch_unwind at every panic-prone boundary instead of a single outer wrapper — the layered approach lets each step (read_meta, distill, append) surface a specific [DECOMP-04] log line with the exact failure mode, rather than the generic 'merge_fork_back panicked' that a single outer wrapper would emit. Easier diagnosis when something goes wrong in production. Mirrors fork_session's discipline (Phase 34 SESS-04)."
  - "Synthetic UserMessage instead of synthetic AssistantTurn — per CONTEXT lock §DECOMP-04: the merged content must be visible to the parent's NEXT turn as conversation history. AssistantTurn would be replayed as an LLM response (wrong role); UserMessage is replayed as user input which is what the parent needs to react to. The bracketed prefix `[Branch merged from fork {id8}…]` matches the synthetic-turn-prefix convention used by loop_engine::synthetic_assistant_turn_from_summary."
  - "fs2 advisory lock chosen over OS-level file locking primitives — the Phase 34 SESS-01 discipline already uses fs2 throughout (SessionWriter::append, rotation), so reuse keeps the lock-acquire/release pattern uniform. Advisory (not mandatory) is fine because all append paths in this codebase respect the lock; no foreign processes write the JSONL files."
metrics:
  duration: ~14 minutes
  completed: 2026-05-06
---

# Phase 35 Plan 35-08: DECOMP-04 merge_fork_back Tauri command + MergeResult struct + JSONL append helpers Summary

DECOMP-04 ships the `merge_fork_back(fork_id)` Tauri command — the explicit-user-action IPC seam that folds a fork's distilled summary back into its parent conversation. The command validates `fork_id` via Phase 34 SESS-04's Crockford-base32 regex, reads parent attribution from the fork's first `SessionMeta` event, runs Plan 35-06's `distill_subagent_summary` with `AgentRole::Analyst` (per CONTEXT lock — branch-merge distillation is structurally analytical), and appends two events atomically to the parent's JSONL via fs2 advisory exclusive lock: a `LoopEvent{kind: "fork_merged", payload:{fork_id, summary_text}, ts}` for forensic continuity + a synthetic `UserMessage{content: "[Branch merged from fork {id8}…] {summary}", ts}` so the parent's next turn sees the merged content as conversation history. The fork's JSONL is preserved on disk (one-way append, not destructive copy), so users can fork-then-merge multiple times. Two helpers (`read_parent_from_meta`, `append_events_to_jsonl`) factor out the JSONL plumbing; both are also reusable by future merge-flavor code in v1.6+. Layered `catch_unwind` at every panic-prone boundary — the IPC host never crashes regardless of which step fails; each failure surfaces as `Err` with a `[DECOMP-04]` log line. Defense-in-depth: `validate_session_id` is run a second time on the `parent_id` we read off disk before joining a path, catching any hostile JSONL-edit injecting traversal segments. Tauri command registered in `lib.rs::generate_handler!`; uniqueness verified (zero collisions across the codebase). 7 unit tests green; cargo check clean.

## What Shipped

### Task 1: Tauri command name uniqueness check

**Action:** Pre-flight grep before any code wrote — `grep -rn "fn merge_fork_back\b" /home/arnav/blade/src-tauri/src/` returned 0 hits, confirming no existing command would collide with the new name. Tauri's macro namespace is FLAT per CLAUDE.md, so this check is load-bearing for any new command.

### Task 2: merge_fork_back command + MergeResult struct + 2 helpers + 7 tests

**File modified:** `src-tauri/src/session/list.rs` (commit `516bb56`)

**MergeResult** (lines 449-456 of `session/list.rs`):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub fork_id: String,
    pub parent_id: String,
    pub summary_text: String,
}
```

**merge_fork_back** (lines 484-606 of `session/list.rs`) — full flow:
1. `validate_session_id(&fork_id)` — Crockford-base32 regex (Phase 34 SESS-04 hardening; threat T-35-28 mitigation).
2. Open `{jsonl_log_dir}/{fork_id}.jsonl`; verify it exists.
3. `catch_unwind` wrap → `read_parent_from_meta(&fork_path)` → either `Some(parent_id)` (fork) or `None` ("session is not a fork — cannot merge back" Err).
4. `validate_session_id(&parent_id)` — defense-in-depth against on-disk tampering.
5. `futures::FutureExt::catch_unwind` wrap → `distill_subagent_summary(&fork_id, AgentRole::Analyst, &cfg).await` → returns `SubagentSummary` (Plan 35-06; cheap-model + heuristic fallback).
6. Build `LoopEvent{kind:"fork_merged", payload:{fork_id, summary_text}, ts:now}` + `UserMessage{id:Ulid::new(), content:"[Branch merged from fork {id8}…] {safe_slice(summary_text, max_chars)}", ts:now}`.
7. `catch_unwind` wrap → `append_events_to_jsonl(&parent_path, &[merge_event, synthetic_user])` — fs2 advisory-locked batch append.
8. Return `MergeResult{fork_id, parent_id, summary_text}`.

Each `catch_unwind` boundary logs a `[DECOMP-04]` line on panic and surfaces `Err` to the frontend; the host process never crashes.

**read_parent_from_meta** (lines 615-633) — synchronous helper, walks the JSONL forward, returns the FIRST `SessionMeta.parent` value:
- `Ok(Some(parent_id))` → file is a fork.
- `Ok(None)` → top-level session OR no `SessionMeta` (corrupted).
- `Err(e)` → I/O error opening the file.

Mirrors `read_meta`'s discipline: corrupt JSONL lines are skipped silently; the first SessionMeta wins.

**append_events_to_jsonl** (lines 642-664) — synchronous helper, uses `fs2::FileExt::lock_exclusive` for atomicity. File opened with `create(true).append(true)` — append-only semantics match `SessionWriter`; never truncates.

### Task 3: lib.rs::generate_handler! registration

**File modified:** `src-tauri/src/lib.rs` (commit `ebfa6c9`)

Single-line addition at line 926, immediately after `session::list::fork_session`:

```rust
session::list::merge_fork_back,
```

`grep -c "merge_fork_back" src-tauri/src/lib.rs` → 1 hit (registered once, no duplicates).
`grep -rn "fn merge_fork_back\b" src-tauri/src/` → 1 hit (only `session/list.rs::merge_fork_back`; no name collisions).

### Test runner output

```bash
$ cargo test --lib session::list::tests::phase35_decomp_04
running 7 tests
test session::list::tests::phase35_decomp_04_append_events_to_jsonl_helper ... ok
test session::list::tests::phase35_decomp_04_merge_result_serde_roundtrip ... ok
test session::list::tests::phase35_decomp_04_merge_validates_session_id ... ok
test session::list::tests::phase35_decomp_04_read_parent_from_meta_helper ... ok
test session::list::tests::phase35_decomp_04_merge_rejects_missing_parent_jsonl ... ok
test session::list::tests::phase35_decomp_04_merge_rejects_non_fork ... ok
test session::list::tests::phase35_decomp_04_merge_rejects_missing_fork_file ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 720 filtered out; finished in 0.07s
```

| Test | What it verifies |
|---|---|
| `phase35_decomp_04_merge_result_serde_roundtrip` | MergeResult survives JSON round-trip; frontend IPC contract sound |
| `phase35_decomp_04_read_parent_from_meta_helper` | Helper returns Some(parent) for fork SessionMeta + None for top-level; first-meta-wins |
| `phase35_decomp_04_append_events_to_jsonl_helper` | Helper extends file (no truncation); events appear in order, one per line |
| `phase35_decomp_04_merge_validates_session_id` | Path-traversal, empty, and non-ULID fork_ids all rejected before any I/O |
| `phase35_decomp_04_merge_rejects_non_fork` | Top-level session (parent: None) rejected with "not a fork" / "cannot merge back" |
| `phase35_decomp_04_merge_rejects_missing_fork_file` | Non-existent fork JSONL rejected with descriptive error |
| `phase35_decomp_04_merge_rejects_missing_parent_jsonl` | Orphan fork (fork JSONL exists, parent JSONL missing) rejected |

### Acceptance criteria

| Criterion | Status |
|---|---|
| `grep -c "pub async fn merge_fork_back" .../session/list.rs` | **1** (target = 1) |
| `grep -c "pub struct MergeResult" .../session/list.rs` | **1** (target = 1) |
| `grep -c "fn read_parent_from_meta\|fn append_events_to_jsonl" .../session/list.rs` | **2** (target = 2) |
| `grep -rn "fn merge_fork_back\b" src-tauri/src/ \| wc -l` | **1** (target = 1, only session/list.rs) |
| `grep -c "merge_fork_back" src-tauri/src/lib.rs` | **1** (target ≥ 1, in generate_handler!) |
| 4+ phase35_decomp_04 tests green | **7/7** (target ≥ 4) |
| cargo check exits 0 | **yes** (2m 22s; 13 pre-existing dead-code warnings unrelated to this plan) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Auto-add] Defense-in-depth validate_session_id on parent_id read off disk**

- **Found during:** Task 2 (writing the merge_fork_back body — read_parent_from_meta returns whatever string the SessionMeta.parent field carries on disk; without re-validation, a hostile JSONL edit could inject `../../etc/passwd` into that field).
- **Issue:** validate_session_id was originally called only on the inbound `fork_id` parameter. The parent_id we extract from the fork's SessionMeta is read off disk and joined into a path (`dir.join(format!("{}.jsonl", &parent_id))`). If the user edited the fork's JSONL by hand to set `parent: Some("../../etc/passwd")`, the join would build a path with traversal segments. The plan's <interfaces> sketch did not include this second validation call; only the inbound fork_id check.
- **Fix:** Added `validate_session_id(&parent_id).map_err(...)` immediately after the read_parent_from_meta call returns the parent_id. Cost is one regex match per merge call.
- **Files modified:** `src-tauri/src/session/list.rs`
- **Commit:** `516bb56`

**2. [Rule 2 — Auto-add] Layered catch_unwind on read_parent_from_meta**

- **Found during:** Task 2 (drafting the panic-safety wrapper — the plan's <interfaces> sketch wrapped only the distill + append paths in catch_unwind, leaving the synchronous read_parent_from_meta call uncovered. A corrupt JSONL line that panics serde_json::from_str would tear the IPC host down).
- **Issue:** read_parent_from_meta does its own corrupt-line skipping (the `if let Ok(...) = serde_json::from_str(...)` guard), which is robust against parse errors. But a panic inside serde could still escape; defense-in-depth says wrap.
- **Fix:** Added `std::panic::catch_unwind(AssertUnwindSafe(|| read_parent_from_meta(&fork_path)))` matching the discipline used on `append_events_to_jsonl`. Three layered panic boundaries now: read_meta (sync), distill (async via FutureExt), append (sync).
- **Files modified:** `src-tauri/src/session/list.rs`
- **Commit:** `516bb56`

**3. [Rule 2 — Auto-add] Three additional unit tests beyond the plan's 4-test floor**

- **Found during:** Task 2 (the plan asked for 4 tests minimum; while writing them, three more obvious failure modes had no coverage — append helper round-trip, missing fork file, missing parent file).
- **Issue:** The plan listed 4 tests (serde_roundtrip, read_parent helper, validates_session_id, rejects_non_fork). Three additional surfaces had no test: (a) append_events_to_jsonl extends without truncation, (b) merge_fork_back returns Err when the fork JSONL is missing, (c) merge_fork_back returns Err when the parent JSONL is missing (orphaned fork). All three are plausible production failure modes worth a regression guard.
- **Fix:** Added `phase35_decomp_04_append_events_to_jsonl_helper` (verifies append discipline + line ordering), `phase35_decomp_04_merge_rejects_missing_fork_file`, and `phase35_decomp_04_merge_rejects_missing_parent_jsonl`. Total 7 tests green.
- **Files modified:** `src-tauri/src/session/list.rs`
- **Commit:** `516bb56`

### Architectural decisions deferred

None — DECOMP-04 is a self-contained IPC seam. Plan 35-09 ships the frontend type wrapper + payload types; Plan 35-10 wires the SessionsView Merge-back UI button.

### Auth gates encountered

None — fully offline. Tests do not exercise the cheap-model distillation path (the four `merge_fork_back`-flavor tests fail before reaching distill, and no end-to-end happy-path test was specified for this plan; that's Plan 35-11 UAT territory). cargo check / cargo test never reached out to a provider.

## Threat Surface

| Threat ID | Disposition | Notes |
|---|---|---|
| T-35-28 (Tampering — frontend invokes merge_fork_back with `../../../etc/passwd` as fork_id) | mitigate | validate_session_id on inbound fork_id rejects via Crockford-base32 regex. Test `phase35_decomp_04_merge_validates_session_id` is the regression guard. |
| T-35-28-bis (Tampering — hostile JSONL edit injects traversal in SessionMeta.parent) | mitigate | Defense-in-depth validate_session_id on the parent_id read off disk. Added in this plan beyond the original threat register entry. |
| T-35-29 (DoS — repeated merges stack synthetic UserMessages in parent JSONL) | accept | Documented (CONTEXT lock §DECOMP-04). Each merge appends a fresh ULID-keyed event; idempotency is a v1.6+ enhancement. |
| T-35-30 (Information disclosure — summary_text contains user content; appended to parent JSONL) | accept | User explicitly initiated the merge; data is already in fork JSONL on the user's filesystem. |
| T-35-31 (Race — concurrent SessionWriter::append on parent JSONL during merge) | mitigate | fs2 advisory exclusive lock_exclusive on the OpenOptions handle in append_events_to_jsonl. Mirrors Phase 34 SESS-01 discipline; no new lock-pattern surface. |
| T-35-32 (DoS — distillation cheap-model returns 100KB) | mitigate | safe_slice cap inherits from Plan 35-06 (subagent_summary_max_tokens × 4 chars; default 800 × 4 = 3200 chars). Synthetic UserMessage content is bounded by the same cap. |

## Hand-off to Wave 4

- **Plan 35-09** (DECOMP-05 BladeLoopEventPayload subagent variants + mergeForkBack TS wrapper) — frontend types for `MergeResult` (mirror this plan's serde shape) + `invoke<MergeResult>('merge_fork_back', { forkId })` typed wrapper in `src/api/sessions.ts`. Plan 35-09 also adds the `fork_merged` BladeLoopEventPayload variant for ActivityStrip rendering.
- **Plan 35-10** (DECOMP-04 SessionsView Merge-back UI + DECOMP-05 ActivityStrip subagent chips with throttling + SubagentProgressBubble) — the SessionsView-side button that calls `mergeForkBack(forkId)` and surfaces `MergeResult.summary_text` in a confirmation toast. Routes through `decision_gate` per CLAUDE.md proactive-engine pattern.
- **Plan 35-11** (Phase-wide closure with panic-injection regression + checkpoint:human-verify 15-step UAT) — runtime UAT exercises the merge-back flow end-to-end against a real LLM: send messages in parent → fork at index 3 → continue in fork → halt → merge_fork_back → verify parent's next turn sees the merged summary as conversation history.

## Self-Check: PASSED

- `src-tauri/src/session/list.rs` exists and compiles ✓ (cargo test green; cargo check exit 0)
- `pub async fn merge_fork_back` declared once (grep -c = 1) ✓
- `pub struct MergeResult` declared once (grep -c = 1) ✓
- `read_parent_from_meta` + `append_events_to_jsonl` helpers declared (grep -c = 2) ✓
- `merge_fork_back` registered in `lib.rs::generate_handler!` (line 926) ✓
- Tauri command name uniqueness — `grep -rn "fn merge_fork_back\b" src-tauri/src/ \| wc -l` = 1 ✓
- 7/7 phase35_decomp_04 tests green ✓
- Commits `516bb56` (impl + tests) + `ebfa6c9` (handler reg) present in git log ✓
- No accidental file deletions in either commit (`git diff --diff-filter=D HEAD~2 HEAD` empty) ✓
- 188 pre-existing unstaged deletions in `.planning/phases/00..` left untouched ✓
- No Co-Authored-By line in any commit ✓
