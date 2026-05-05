---
phase: 32-context-management
reviewed: 2026-05-05T00:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - src-tauri/src/config.rs
  - src-tauri/src/brain.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src-tauri/tests/context_management_integration.rs
  - src/features/admin/DoctorPane.tsx
  - src/lib/tauri/admin.ts
findings:
  blocker: 0
  high: 1
  medium: 2
  low: 2
  total: 5
status: issues_found
---

# Phase 32 (Context Management) — Code Review

**Reviewed:** 2026-05-05
**Depth:** deep
**Commit range:** `b7b6ece..HEAD` (20 commits, 7 plans, 4 waves)
**Status:** issues_found — 1 high, 2 medium, 2 low. No blockers; chat correctness is intact.

## Summary

Phase 32 lands a panic-resistant context pipeline (`score_or_default`) plus
proactive compaction, per-tool-output cap, and a DoctorPane budget panel. The
CTX-07 v1.1 invariant — "smart path must never crash dumb path" — is correctly
held by `score_or_default` (panic + non-finite both degrade to safe_default=1.0)
and the `catch_unwind` wrapper around `cap_tool_output` in commands.rs.
Six-place config rule is correctly applied for `ContextConfig`. Tauri command
namespace has no collisions. `safe_slice` is used at every multi-byte slicing
site touched by Phase 32.

The findings below are all correctness/contract gaps that do **not** break
chat. The most material one is a thread_local mismatch between writer and
reader threads on the breakdown panel.

---

## High

### H-01: `LAST_BREAKDOWN` thread_local cannot reach `get_context_breakdown` reader

**File:** `src-tauri/src/brain.rs:272-275`, `src-tauri/src/brain.rs:373-376`
**Issue:**

`LAST_BREAKDOWN` is a `thread_local!` populated by `record_section` calls inside
`build_system_prompt_inner`. That function runs synchronously inside the
`send_message_stream` async task, on whichever Tokio worker first polls the
chat future. `get_context_breakdown` is a **separate** Tauri command, invoked
from the frontend via `invoke('get_context_breakdown')`, which Tauri 2's
default multi-thread runtime executes on a different worker. The reader thread
sees its own (empty) thread_local — never the writer's.

In practice the DoctorPane ContextBudgetSection will display the
"No prompt built this session yet" zero-state on most reads, or stale data
from a coincidentally-same-thread previous read. The CTX-06 panel is largely
non-functional.

The code-level comment at `brain.rs:262-265` already flags this risk:
> "If a future async hop crosses worker threads, switch to
> `once_cell::Lazy<Mutex<>>` per RESEARCH.md landmine #4."

The async hop is already crossed today — `get_context_breakdown` is itself a
separate task, not a continuation of the chat task.

**Fix:** Move `LAST_BREAKDOWN` from `thread_local!` to a process-global:

```rust
use once_cell::sync::Lazy;
use std::sync::Mutex;
static LAST_BREAKDOWN: Lazy<Mutex<Vec<(String, usize)>>> =
    Lazy::new(|| Mutex::new(Vec::new()));
```

Update `clear_section_accumulator`, `record_section`, and
`read_section_breakdown` to lock the mutex. Contention is negligible — chat
turn rate is ~human-typing, breakdown reads are 1/turn. CTX-07 spirit holds:
the global is panic-safe (a `PoisonError` is recoverable; treat as empty).

**Why this is high (not blocker):** Chat is unaffected. The panel renders a
zero-state instead of bogus data, so no user data integrity risk. CTX-06 was
the entire purpose of the panel; the feature ships dead-on-arrival until
the storage primitive is fixed.

---

## Medium

### M-01: CTX-07 escape hatch (`smart_injection_enabled = false`) is partial

**File:** `src-tauri/src/brain.rs:1322-1352, 1364, 1400, 1420, 1443, 1458, 1477`
**Issue:**

Sections 0–8 (character_bible, safety, hormones, identity_extension, vision,
hearing) honor the kill switch via `let allow_X = !smart || ... > gate;`
(brain.rs:784, 821, 842, 871, 995, 1044). Sections 9–16 do **not** check
`!smart`:

- `integrations`/`schedule` (L1322 — uses `integration_score > 0.3` test, no `!smart` short-circuit)
- `code` (L1364 — `score_or_default(...) > gate`, no `!smart`)
- `git` (L1400)
- `security` (L1420 — `> 0.5` literal)
- `health` (L1443 — `> 0.3` literal)
- `world_model` / `system` (L1458)
- `financial` (L1477)

When a user toggles `context.smart_injection_enabled = false` in
`config.json` to recover the pre-Phase-32 "inject everything" behavior, only
half the sections respond. The other half stay smart-gated.

The test comment at brain.rs:2864-2895 already acknowledges the !smart toggle
is unverified at the unit level. The runtime is the only authority.

**Fix:** Either prepend `!smart || ` to each gate condition in sections 9–16,
or extract a helper `fn allow_section(smart: bool, query: &str, ctype: &str, gate: f32) -> bool`
and route every gate through it.

**Why medium (not high):** The panic-fallback path through `score_or_default`
DOES work for every gate (1.0 > any gate ⇒ inject), so the v1.1 "smart breaks
dumb" invariant is preserved. The escape hatch is a manual tool most users
never reach for. Plan 32-07 Task 2 (UAT) is operator-deferred, so the toggle
behavior would surface there anyway. Recommend tracking as a v1.2 follow-up
rather than re-running Plan 32-03.

### M-02: `world_chars` recorded into both `world_model` and `system` labels

**File:** `src-tauri/src/brain.rs:1465-1466`
**Issue:**

```rust
record_section("world_model", world_chars);
record_section("system", world_chars);
```

`build_breakdown_snapshot` (brain.rs:327-332) sums per-label entries into
`total_chars`, so the same `world_chars` value contributes twice to the total.
The DoctorPane will display:

- "world_model" row at N tokens
- "system" row at N tokens (identical value)
- Inflated `total_tokens` and `percent_used`
- Per-section `% of total` denominators are wrong

This is independent of H-01 — once H-01 is fixed and the panel actually
renders real numbers, M-02 will make every total-budget % off by exactly the
world_chars contribution.

**Fix:** Drop one of the two `record_section` calls. The label set documented
at brain.rs:208-211 lists both, so pick the one that matches the
documentation contract (recommendation: keep `system`, drop `world_model`,
since the type used in the gate is `score_or_default(..., "system", ...)`).

---

## Low

### L-01: `cap_tool_output` chars vs. `estimate_tokens` bytes divergence

**File:** `src-tauri/src/commands.rs:142-153, 3115`
**Issue:**

`estimate_tokens` (commands.rs:142) uses `s.len() / 4` (byte count). 
`cap_tool_output` (commands.rs:3115) uses `content.chars().count() / 4` (char
count). For ASCII these match; for multi-byte content (emoji-heavy bash
output, non-Latin filenames in errors) they diverge — `cap_tool_output`'s
estimate is smaller, so it under-caps relative to what the conversation
budget actually accounts for.

Both are heuristics, divergence is bounded by max-char-width (4 bytes for
UTF-8). For a 4000-token (~16KB) cap, worst case is the cap fires at ~64KB
of bytes instead of 16KB — 4× over budget on a pure-emoji output. Pathological
but not crash-y.

**Fix:** Pick one estimator and use it in both places. Recommendation: switch
`cap_tool_output:3115` to `content.len() / 4` to match `estimate_tokens`.
Tail computation at L3137-3144 still needs `.chars().count()` for char-safe
slicing but the budget comparison should be byte-based for consistency.

### L-02: `storage_id` collisions on rapid same-millisecond cap events

**File:** `src-tauri/src/commands.rs:3152`
**Issue:**

`format!("tool_out_{}", chrono::Utc::now().timestamp_millis())` is unique only
to the millisecond. A tool loop that produces two oversized outputs in the
same ms (entirely possible for cached file reads) gets duplicate
`storage_id`s. Today the IDs are log/test markers only — Phase 33+ "reach back
to original" feature would need actual uniqueness.

**Fix:** Append a process-monotonic counter or use a UUID:
```rust
use std::sync::atomic::{AtomicU64, Ordering};
static CAP_COUNTER: AtomicU64 = AtomicU64::new(0);
let id = format!("tool_out_{}_{}",
    chrono::Utc::now().timestamp_millis(),
    CAP_COUNTER.fetch_add(1, Ordering::Relaxed));
```

---

## Notes (verified clean — no findings)

- **Six-place config rule:** `ContextConfig` correctly lands in DiskConfig
  (`config.rs:426`), DiskConfig::default (L507), BladeConfig (L654),
  BladeConfig::default (L721), load_config (L882), save_config (L950).
- **Tauri namespace:** `get_context_breakdown` is registered exactly once
  (`lib.rs:685`) and defined exactly once (`brain.rs:373`). No collisions.
  Other new helpers (`model_context_window`, `cap_tool_output`,
  `compute_keep_recent`, `build_compaction_summary_prompt`,
  `build_breakdown_snapshot`, `score_or_default`) are non-`#[tauri::command]`
  and don't enter the flat namespace.
- **`catch_unwind` + `AssertUnwindSafe`:** `score_or_default`
  (`brain.rs:551-572`) correctly omits `AssertUnwindSafe` (closure captures
  only `&str`, which is `UnwindSafe`). `cap_tool_output` call site at
  `commands.rs:2542-2544` correctly uses `AssertUnwindSafe` because `content`
  comes from a mutable `String` binding in scope.
- **`safe_slice` discipline:** Every Phase 32-introduced slicing site uses
  `crate::safe_slice` — verified at `commands.rs:307, 310, 313` (compaction
  prompt), `commands.rs:3131` (cap_tool_output head), `brain.rs:1342, 1064`
  (schedule + hearing). Tail slicing in `cap_tool_output` (L3137-3144) uses
  `char_indices().nth()` for char-safe boundaries.
- **Numeric overflow in compaction trigger:** `(model_context_window(...) as
  f32 * compaction_trigger_pct) as usize` (`commands.rs:1588-1589, 1661`) is
  safe — context windows ≤ 2M fit exactly in f32 mantissa, and `as usize`
  saturates on overflow. A misconfigured `compaction_trigger_pct = 0.0`
  would force compaction every turn but doesn't loop (compress_conversation_smart
  has its own bounds checks at commands.rs:289, 298).
- **`compute_keep_recent` floor:** `count.max(2)` guarantees the most-recent
  exchange survives even when one tool output exceeds the 16k token budget
  by itself.
- **Frontend:** `ContextBudgetSection` correctly soft-fails on backend errors
  (DoctorPane.tsx:135-137) — CTX-07 spirit. The two `<ContextBudgetSection />`
  call sites (L338, L438) are mutually exclusive (error vs. happy render).

---

_Reviewed: 2026-05-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
