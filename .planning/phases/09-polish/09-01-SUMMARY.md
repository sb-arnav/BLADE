---
phase: 09-polish
plan: 01
subsystem: rust-backfill
tags: [hive, dna, character, wrappers, phase8-deferrals]
requires:
  - Phase 8 commands (hive_approve_decision, dna_get_identity, existing feedback log patterns)
provides:
  - hive::hive_reject_decision command
  - dna::dna_set_identity command
  - character::delegate_feedback command
  - hiveRejectDecision + delegateFeedback + dnaSetIdentity typed wrappers
  - ApprovalQueue Reject button wired to backend
  - DNA Identity Save wired to backend
  - AiDelegate Feedback persisted to audit log
affects:
  - src-tauri/src/hive.rs
  - src-tauri/src/dna.rs
  - src-tauri/src/character.rs
  - src-tauri/src/lib.rs
  - src/lib/tauri/hive.ts
  - src/lib/tauri/body.ts
  - src/features/hive/ApprovalQueue.tsx
  - src/features/hive/AiDelegate.tsx
  - src/features/body/DNA.tsx
  - scripts/verify-phase8-rust-surface.sh
tech-stack:
  added: []
  patterns:
    - "JSONL append-only audit log (character.rs delegate_feedback.jsonl)"
    - "write_blade_file for identity persist (creates parent dir, 0o600 on Unix)"
    - "Drop-on-floor reject semantics (remove + discard Decision — no dispatch)"
    - "Optimistic UI removal + event-driven reconciliation for reject"
key-files:
  created: []
  modified:
    - src-tauri/src/hive.rs
    - src-tauri/src/dna.rs
    - src-tauri/src/character.rs
    - src-tauri/src/lib.rs
    - src/lib/tauri/hive.ts
    - src/lib/tauri/body.ts
    - src/features/hive/ApprovalQueue.tsx
    - src/features/hive/AiDelegate.tsx
    - src/features/body/DNA.tsx
    - scripts/verify-phase8-rust-surface.sh
decisions:
  - "Reject drops Decision on floor — no approved_queue push, no execute path (threat T-09-01-06 mitigated by absence)"
  - "delegate_feedback chose JSONL audit log over DB table — append-only, no schema migration, trivial to tail for debugging"
  - "dna_set_identity writes to persona.md (matches dna_get_identity read path) via existing write_blade_file helper — no new IO code"
  - "AiDelegate decision_id fallback chain (payload.decision_id → payload.id → tool+timestamp) — ring buffer payloads today don't carry a stable id; fallback gives feedback a best-effort correlation key"
  - "Cargo check deferred to Mac (D-65 inheritance) — sandbox lacks libclang/LLVM for whisper-rs-sys; operator verifies on Mac via M-44"
metrics:
  duration: "~20 min"
  completed: "2026-04-18"
  tasks: 4
  commits: 5
  rust_loc_added: ~65
  ts_loc_added: ~80
---

# Phase 9 Plan 09-01: Rust Command Backfill Summary

Closed 3 documented Phase 8 deferrals (D-203 DNA write, D-205 Reject, D-205 Feedback) with surgical backend + wrapper + frontend additions. ~65 lines Rust + ~80 lines TypeScript across 10 files.

## What Shipped

### 3 new Rust commands (all registered in `src-tauri/src/lib.rs` `generate_handler!`)

1. **`hive::hive_reject_decision(head_id, decision_index) -> Result<(), String>`** — `src-tauri/src/hive.rs:3342`. Mirrors `hive_approve_decision` bounds-check + `hive_lock()` mutex pattern; removes pending decision from head queue without pushing to `approved_queue` and without dispatching the action. Drop-on-floor semantics.

2. **`dna::dna_set_identity(content) -> Result<(), String>`** — `src-tauri/src/dna.rs:505`. Writes content to `persona.md` under `blade_config_dir()` via existing `write_blade_file` helper (creates parent dir if missing, sets `0o600` on Unix). Fixed filename — no path-traversal vector.

3. **`character::delegate_feedback(decision_id, was_correct, note) -> Result<(), String>`** — `src-tauri/src/character.rs:588`. Appends a `DelegateFeedbackEntry { decision_id, was_correct, note, timestamp }` JSON line to `delegate_feedback.jsonl` under blade config dir. Opens file with `OpenOptions::new().create(true).append(true)`.

### 3 new typed wrappers

- `src/lib/tauri/hive.ts` — `hiveRejectDecision({ headId, decisionIndex })`, `delegateFeedback({ decisionId, wasCorrect, note? })`.
- `src/lib/tauri/body.ts` — `dnaSetIdentity({ content })`.
- All include JSDoc `@see` Rust file cites; all route through `invokeTyped` with snake_case invoke-boundary payloads (D-38).

### 3 frontend rewires

- **`src/features/hive/ApprovalQueue.tsx`** — `dismiss` handler replaced with async `reject` calling `hiveRejectDecision`. Button label Dismiss→Reject, testid `dismiss-N`→`reject-N`. Busy gating via existing `busyRow` state. Optimistic local removal remains for zero-latency UI; `HIVE_PENDING_DECISIONS` event reconciles with backend truth.
- **`src/features/hive/AiDelegate.tsx`** — Feedback Dialog Save now awaits `delegateFeedback(decisionId, wasCorrect, note)`. Added `feedbackBusy` state; Save disabled during RPC; Dialog stays open on error so operator can retry; `decisionId` uses a 3-step fallback chain (`payload.decision_id` → `payload.id` → `${toolName}-${at}`). Prefs ring buffer retained as session-scope echo only.
- **`src/features/body/DNA.tsx`** — Identity tab Save button now calls `dnaSetIdentity({ content: draft })`. Removed clipboard-propose fallback, removed the GlassPanel deferral card, removed "direct write deferred to Phase 9" language. Button state: Save / "Saving…" with disabled gating. Textarea + Cancel disabled during save.

### `scripts/verify-phase8-rust-surface.sh`

Extended to check the 3 new commands; success message now reads `OK — all 40 body+hive Rust commands registered ... (37 Phase 8 + 3 Plan 09-01)`.

## Commits

| Task | Hash      | Message                                                                      |
| ---- | --------- | ---------------------------------------------------------------------------- |
| 1    | `8cd1018` | feat(09-01): add 3 Rust commands — hive_reject_decision, dna_set_identity, delegate_feedback |
| 2    | `3e13414` | feat(09-01): add typed wrappers — hiveRejectDecision, delegateFeedback, dnaSetIdentity |
| 3    | `11bf7ca` | feat(09-01): rewire ApprovalQueue Reject + AiDelegate Feedback to real backend |
| 4    | `d57a3bf` | feat(09-01): rewire DNA Identity Save to dnaSetIdentity backend              |
| 5    | `d2b2c28` | chore(09-01): extend verify-phase8-rust-surface.sh for 3 new commands (37→40) |

## Verification Performed in Sandbox

- `npx tsc --noEmit` exits 0 after each frontend edit (Task 2, 3, 4).
- `bash scripts/verify-phase8-rust-surface.sh` passes with new 40-command baseline.
- `npm run verify:all` passes (11 verify scripts — entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5/6/7/8-rust, feature-cluster-routes).
- Command-name collision grep clean: `grep -rn "fn hive_reject_decision\|fn dna_set_identity\|fn delegate_feedback" src-tauri/src/` returns only the new definitions (no duplicates across modules — Tauri's flat `#[tauri::command]` namespace is safe).
- Residual "deferred to Phase 9" / "backend ... not yet wired" language: 0 matches in ApprovalQueue.tsx, AiDelegate.tsx, DNA.tsx.

## Deferred to Mac (D-65 inheritance)

### `cargo check` exit status

**Reason:** The sandbox environment lacks `libclang` / LLVM, which `whisper-rs-sys` transitively requires even when `local-whisper` is off by default (CLAUDE.md note: "whisper-rs requires LLVM/libclang — it's behind `local-whisper` feature flag. Default build doesn't need it" — but `cargo check` still probes dependency trees).

**Operator action on Mac:**

```bash
cd src-tauri && cargo check
```

Expected: exit 0. The three new functions use only patterns already present in the codebase:
- `hive_reject_decision` — mirrors `hive_approve_decision` lock/bounds-check/remove (already compiles at `hive.rs:3330`).
- `dna_set_identity` — calls `crate::config::write_blade_file` (already used 9+ times elsewhere).
- `delegate_feedback` — uses `chrono::Utc::now().to_rfc3339()`, `serde_json::to_string`, `std::fs::OpenOptions`, `writeln!` — all already used in the file (character.rs) or sibling modules.

No new imports were needed beyond a function-local `use std::io::Write` for `writeln!`. No struct-field additions to `DiskConfig` / `BladeConfig` (6-place rule not triggered). No new `mod` declarations.

### `npm run tauri dev` functional verification

Operator runs the app on Mac and:
1. Triggers a hive pending decision (either via live tentacles or a stubbed `HIVE_PENDING_DECISIONS` event), navigates to `/approval-queue`, clicks **Reject** on a row — expects success toast + row disappears. Verifies backend: `head.pending_decisions` length decreased by 1; no entry added to `approved_queue`.
2. Navigates to `/dna`, Identity tab, clicks **Edit**, modifies the text, clicks **Save** — expects success toast + textarea returns to display mode. Verifies `~/Library/Application Support/BLADE/persona.md` (or equivalent `blade_config_dir()` path) contains the new content; file mode `0o600`.
3. Triggers an AI_DELEGATE_APPROVED event, navigates to `/ai-delegate`, clicks **Feedback** on the latest entry, toggles "correct" + types a note, clicks **Save** — expects success toast + dialog closes. Verifies `delegate_feedback.jsonl` in blade config dir has a new line with `{decision_id, was_correct, note, timestamp}`.

## Deviations from Plan

**None.** The plan executed exactly as written. One minor structural choice: Task 1 plan language said "If character.rs has no extensible log helper, write a new JSON line to a `delegate_feedback.jsonl` file at the character.rs data root" — I chose the JSONL fallback (no existing structured feedback-log helper in character.rs; `brain_upsert_preference` is a DB path, not an audit log). This is the documented fallback, not a deviation.

## Threat Model Compliance

All 4 `mitigate` dispositions from the plan's threat register are satisfied:

- **T-09-01-01 (Tampering — decision_index):** bounds-check via `decision_index >= head.pending_decisions.len()` returns typed error (hive.rs:3353).
- **T-09-01-02 (Tampering — head_id):** `heads.get_mut(&head_id).ok_or_else(|| format!("Unknown head: {}", head_id))` (hive.rs:3348-3351).
- **T-09-01-06 (Elevation of privilege — reject bypass):** function body verified — only `head.pending_decisions.remove(index)` + discard; NO `approved_queue.push`, NO `.execute()`, NO action dispatch. Drop on floor semantics.

The 3 `accept` dispositions (T-09-01-03 path traversal, T-09-01-04 DoS-by-size, T-09-01-05 note injection) remain accepted — no mitigation added per plan guidance.

## Known Stubs

None. Every user-visible action (Reject, Save identity, Save feedback) now has a real backend path.

## Self-Check: PASSED

Verified via filesystem + git:

- `src-tauri/src/hive.rs` contains `pub fn hive_reject_decision` at line 3342 — FOUND.
- `src-tauri/src/dna.rs` contains `pub fn dna_set_identity` at line 505 — FOUND.
- `src-tauri/src/character.rs` contains `pub async fn delegate_feedback` at line 588 — FOUND.
- `src-tauri/src/lib.rs` contains `hive::hive_reject_decision,` `dna::dna_set_identity,` `character::delegate_feedback,` — FOUND.
- `src/lib/tauri/hive.ts` exports `hiveRejectDecision` + `delegateFeedback` — FOUND.
- `src/lib/tauri/body.ts` exports `dnaSetIdentity` — FOUND.
- `src/features/hive/ApprovalQueue.tsx` imports + calls `hiveRejectDecision` — FOUND.
- `src/features/hive/AiDelegate.tsx` imports + calls `delegateFeedback` — FOUND.
- `src/features/body/DNA.tsx` imports + calls `dnaSetIdentity` — FOUND.
- All 5 commits present: `8cd1018`, `3e13414`, `11bf7ca`, `d57a3bf`, `d2b2c28` — FOUND.
- `npm run verify:all` — PASS.
