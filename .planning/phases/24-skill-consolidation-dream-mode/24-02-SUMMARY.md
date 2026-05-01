---
phase: 24-skill-consolidation-dream-mode
plan: 02
subsystem: skills
tags: [skills, dream_mode, voyager, activitystrip, rust, phase-24, dream-06, dream-05]

# Dependency graph
requires:
  - phase: 22-voyager-loop-closure
    provides: voyager_log fixed-emit-points contract; emit() core; MODULE = "Voyager" label
  - phase: 24-skill-consolidation-dream-mode (Plan 24-01)
    provides: Wave 1 plumbing precedent (forged_tools_invocations + turn_traces tables); record_tool_use wiring
provides:
  - voyager_log::dream_prune(count, items) emit helper with locked "dream_mode:prune" action namespace
  - voyager_log::dream_consolidate(count, items) emit helper with locked "dream_mode:consolidate" action namespace
  - voyager_log::dream_generate(count, items) emit helper with locked "dream_mode:generate" action namespace
  - voyager_log::cap_items(items, cap) private utility — caps wire payload at 11 elements (10 + "... (+N more)" sentinel)
  - dream_mode::last_activity_ts() -> i64 cross-module accessor for the LAST_ACTIVITY AtomicI64 (Pitfall 6 30s idle gate substrate)
affects: [24-03, 24-04, 24-05, 24-06, 24-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling emit-helper registration parallel to voyager_log::skill_used — same emit() core, same JSON payload shape, same safe-without-AppHandle test posture"
    - "Atomic-static read accessor (pub fn ... -> i64) preferred over pub(crate) static promotion — single read seam mirrors the DREAMING/is_dreaming encapsulation"
    - "cap_items overflow sentinel ('... (+N more)') as the canonical UI-payload cap pattern for dream-mode emits"

key-files:
  created: []
  modified:
    - src-tauri/src/voyager_log.rs
    - src-tauri/src/dream_mode.rs

key-decisions:
  - "MODULE = \"Voyager\" constant preserved verbatim per D-24-F lock — dream-mode is the forgetting half of the Voyager loop, not a separate ActivityStrip module label. Frontend filters by action prefix (dream_mode:*) within the same Voyager bucket."
  - "LAST_ACTIVITY exposure via pub fn last_activity_ts() accessor (NOT pub(crate) static promotion) — matches the existing pub fn is_dreaming() / static DREAMING shape verbatim. Single read seam keeps the atomic encapsulated."
  - "Three new dream_* helpers each take (count: i64, items: Vec<String>) — same shape per D-24-F (one emit per pass-kind per cycle, count + items capped at 10). Caller never influences the &'static str action namespace (T-24-02-04 mitigation)."
  - "cap_items is private (no pub) — tests access via use super::*. The cap is hardcoded at 10 at every call site (consistent with D-24-F's items capped at 10 wire-payload contract)."

patterns-established:
  - "Pattern: Phase 24 dream_mode emit helpers — three sibling helpers in voyager_log (dream_prune, dream_consolidate, dream_generate) parallel the Phase 22 voyager loop's 4 fixed kinds. Same module namespace; different action prefix. Frontend renders both under [Voyager] strip rows."
  - "Pattern: Atomic-static cross-module read seam — pub fn <name>_ts() -> i64 returning .load(Ordering::Relaxed) is the canonical accessor shape for module-private AtomicI64 statics that need cross-module read access."
  - "Pattern: cap_items + sentinel overflow — Vec<String> emit payloads whose length is unbounded at the producer use cap_items(&v, N) to cap to N + 1 elements with a '... (+M more)' sentinel as the (N+1)th element. UI consumers parse by checking elem == '... (+...)' suffix or trusting the count field."

requirements-completed: [DREAM-06]

# Metrics
duration: ~37 min
completed: 2026-05-01
---

# Phase 24 Plan 02: Wave 1 ActivityStrip Emit Helpers + LAST_ACTIVITY Accessor Summary

**Three new dream_* emit helpers (one per pass-kind per cycle, count + items capped at 10) and a cross-module last_activity_ts() accessor unblock Wave 2's three dream tasks (DREAM-01/02/03) and Wave 3's proactive_engine 30s idle drain gate (Pitfall 6 mitigation). MODULE = "Voyager" constant preserved verbatim per D-24-F; the LAST_ACTIVITY AtomicI64 stays module-private behind a single read seam.**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-05-01T18:36:55Z (PLAN_START_TIME)
- **Completed:** 2026-05-01T19:14Z (approximate)
- **Tasks:** 2 (both autonomous, both with TDD)
- **Files modified:** 2
- **Tests added:** 5 (4 in voyager_log::tests, 1 in dream_mode::tests)
- **Commits:** 2 atomic + 1 docs (final)

## Accomplishments

- **D-24-F locked end-to-end at the emit layer.** Three sibling helpers `dream_prune` / `dream_consolidate` / `dream_generate` ship in `voyager_log.rs`. Each carries `(count: i64, items: Vec<String>)`. Each emits exactly once via the unchanged emit() core. Each uses a hard-coded `&'static str` action: `"dream_mode:prune"`, `"dream_mode:consolidate"`, `"dream_mode:generate"`. MODULE = "Voyager" constant unchanged.
- **cap_items utility caps wire payload at 11 elements.** `cap_items(&items, 10)` returns `items.to_vec()` when under cap, otherwise `items.iter().take(10).cloned().collect()` + `"... (+N more)"` sentinel. UI drawers stay legible regardless of dream-cycle volume.
- **Cross-module LAST_ACTIVITY read seam landed.** `pub fn last_activity_ts() -> i64` in `dream_mode.rs` mirrors the `pub fn is_dreaming()` shape verbatim. The static `LAST_ACTIVITY: AtomicI64` remains module-private. Wave 3 `proactive_engine` can now apply the 30s idle gate before draining `~/.blade/skills/.pending/` chat-injected prompts (Pitfall 6).
- **5 new tests green.** `dream_prune_caps_items_at_10` + `cap_items_returns_clone_when_under_cap` + `dream_action_strings_locked` + `dream_emit_helpers_safe_without_app_handle` + `last_activity_ts_reads_static`. `cargo test --lib voyager_log::tests` reports 7 passed (3 existing + 4 new). `cargo test --lib dream_mode::tests::last_activity_ts_reads_static` exits 0. `cargo check --lib` clean (only the 5 expected "is never used" warnings on the new helpers — Wave 2/3 wires them — and the pre-existing `timestamp_ms` warning carried forward from Plan 24-01).

## Task Commits

Each task was committed atomically:

1. **Task 1: voyager_log.rs — 3 dream_* emit helpers + cap_items + 4 tests** — `db10e09` (feat)
2. **Task 2: dream_mode.rs — pub fn last_activity_ts() accessor + 1 test** — `6a18952` (feat)

**Plan metadata:** [pending — final commit at end]

## Files Created/Modified

- `src-tauri/src/voyager_log.rs` — appended 3 new `pub fn dream_*` emit helpers + private `fn cap_items` between `skill_used` and `#[cfg(test)] mod tests`; appended 4 new tests inside `mod tests`. MODULE constant + emit() core + 4 existing helpers (gap_detected / skill_written / skill_registered / skill_used) untouched. Net +109 lines.
- `src-tauri/src/dream_mode.rs` — appended `pub fn last_activity_ts() -> i64` immediately after `pub fn is_dreaming()`; appended new `#[cfg(test)] mod tests` block at file end with `last_activity_ts_reads_static` test. The static `LAST_ACTIVITY: AtomicI64` declaration at line 14 untouched. Net +23 lines.

## Decisions Made

- **MODULE label preserved (D-24-F lock).** The first instinct was to add a sibling `MODULE_DREAM` constant for `dream_mode:*` actions. Rejected — D-24-F explicitly notes "dream-mode is the forgetting half of the Voyager loop; frontend filters by action prefix." Adding a new module label would make ActivityStrip render `[DreamMode]` rows, fragmenting the Voyager bucket and breaking the 4-fixed-emit-points contract from Phase 22. The current shape — one MODULE constant, action prefix discriminates — is the right substrate.
- **Accessor over pub(crate) static.** The plan's `<interfaces>` block explicitly locked the choice ("matching the existing `pub fn is_dreaming()` shape at line 27 — keeps the static module-private which is consistent with DREAMING's encapsulation"). Implemented verbatim. Rejected: marking `static LAST_ACTIVITY` as `pub(crate)` would have been one fewer line of code but would have leaked the atomic implementation detail to consumers — they'd need `use std::sync::atomic::Ordering; LAST_ACTIVITY.load(Ordering::Relaxed)` everywhere, instead of just `dream_mode::last_activity_ts()`.
- **cap_items is private.** No `pub fn cap_items` exposure. The 10-cap is a D-24-F invariant baked into the three dream_* helpers; external callers should not be able to vary it. Tests access via `use super::*` which is the canonical Rust same-module test pattern.
- **Test name overlap with grep gate.** The plan's acceptance criterion `grep -c "fn dream_prune\|fn dream_consolidate\|fn dream_generate" returns 3` actually returns 4 because the test function `fn dream_prune_caps_items_at_10` matches the regex (it contains the substring `fn dream_prune`). This is a benign plan-grep-vs-plan-test-name overlap — the substantive truth is **3 helpers exist at file scope** (lines 124, 137, 150 — all `pub fn`). The 4th match is a private test function inside `mod tests`. Spirit of the gate (3 dream_* helpers) is fully met. Documented here so the deviation is visible to Phase 24 close auditing.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Plan-Grep Acceptance-Criteria Mismatch (Documented, Not Auto-Fixed)

**1. [Plan-spec note] Task 1 grep returns 4, not 3**
- **Found during:** Task 1 acceptance check
- **Issue:** Plan acceptance criterion `grep -c "fn dream_prune\|fn dream_consolidate\|fn dream_generate" src-tauri/src/voyager_log.rs returns 3` actually returns 4. The 4th hit is the test function `fn dream_prune_caps_items_at_10` (line 203) whose name (deliberately specified by the plan) contains the substring `fn dream_prune`.
- **Fix:** None applied. The plan also explicitly says under `<verification>`: "the count of new tests by name is 4" — confirming the test name was the plan's intent. The substantive gate (three pub fn helpers at file scope) is met: lines 124/137/150 are all `pub fn`, the 4th match is private `fn` inside `mod tests`. Renaming the test would be a deviation FROM the plan. Documented here for downstream auditors.
- **Files modified:** none
- **Commit:** n/a

## Threat Surface Scan

Per the plan's `<threat_model>` block, the Phase 24-02 trust boundaries are:

| Boundary | Disposition | Mitigation in this plan |
|----------|-------------|-------------------------|
| voyager_log dream_* helpers -> ActivityStrip channel (T-24-02-01) | accept | First-party skill names; `safe_slice(human_summary, 200)` truncation in emit() core; no PII risk |
| items.len() unbounded vec on a degenerate dream cycle (T-24-02-02) | mitigate | `cap_items(&items, 10)` caps at 11 elements; D-24-B caps upstream emitter at 1 merge + 1 generate per cycle |
| "... (+N more)" sentinel confused with a real skill name (T-24-02-03) | accept | Pure UI string; agentskills.io sanitize_name forbids whitespace + parens; sentinel is unambiguous |
| Caller passes the wrong action string (T-24-02-04) | mitigate | All 3 helpers use hard-coded `&'static str` literals; caller cannot influence; grep gate locks the namespace |

No new threat surface introduced beyond the threat register.

## Acceptance Criteria

- [x] `cargo test --lib voyager_log::tests` reports 7 passed (3 existing + 4 new), 0 failed
- [x] `cargo test --lib dream_mode::tests::last_activity_ts_reads_static` exits 0
- [x] `grep -q '"dream_mode:prune"' src-tauri/src/voyager_log.rs` exits 0
- [x] `grep -q '"dream_mode:consolidate"' src-tauri/src/voyager_log.rs` exits 0
- [x] `grep -q '"dream_mode:generate"' src-tauri/src/voyager_log.rs` exits 0
- [x] `grep -q 'fn cap_items' src-tauri/src/voyager_log.rs` exits 0
- [x] `grep -q 'pub const MODULE: &str = "Voyager"' src-tauri/src/voyager_log.rs` exits 0 (D-24-F locked)
- [x] `grep -q 'pub fn last_activity_ts() -> i64' src-tauri/src/dream_mode.rs` exits 0
- [x] `grep -c '^pub static LAST_ACTIVITY\|^pub(crate) static LAST_ACTIVITY' src-tauri/src/dream_mode.rs` returns 0 (static stays private)
- [x] `cargo check --lib` returns 0 errors (only expected "is never used" warnings on the new helpers + carry-forward `timestamp_ms` warning)

## Issues Encountered

- **`cargo test` cold-build cost.** First `cargo test --lib voyager_log::tests` invocation rebuilt incrementally for ~10 minutes (after the source addition triggered re-compilation of dependent modules). Subsequent invocations 0.01s. `cargo test --lib dream_mode::tests::last_activity_ts_reads_static` cold-build was another ~10 min on top of that because `dream_mode.rs` is a deep-import module. Plan timing was dominated by these two compiles, not the actual edits. This matches Phase 23's incremental-rebuild experience and is unrelated to this plan's scope.
- **5 new "is never used" warnings.** As expected — Wave 2 plans 24-03 / 24-04 will wire the 3 dream_* helpers into the new dream-mode tasks; Wave 3 plan 24-07 will wire `last_activity_ts()` into proactive_engine. The warnings are the canary that the substrate is in place but not yet consumed. Out of scope for this plan; in scope for plans 24-03..07.

## Wave 2/3 Unblocking

- **Wave 2 (DREAM-01 / 02 / 03 dream tasks)** can now call `voyager_log::dream_prune(count, items)`, `voyager_log::dream_consolidate(count, items)`, `voyager_log::dream_generate(count, items)` as their one-emit-per-pass-kind contract. Plan 24-03 (DREAM-01 prune pass) imports these directly.
- **Wave 3 (Plan 24-07 proactive_engine drain)** can now read `dream_mode::last_activity_ts()` to apply the 30s idle gate (Pitfall 6 mitigation) before reading `~/.blade/skills/.pending/` and routing the chat-injected prompts through decision_gate.

## Self-Check: PASSED

Verified before final commit:

- File `src-tauri/src/voyager_log.rs` contains all 3 `pub fn dream_*` helpers + `fn cap_items` + 4 new tests — confirmed via grep + Read tool
- File `src-tauri/src/dream_mode.rs` contains `pub fn last_activity_ts() -> i64` + new `#[cfg(test)] mod tests` block — confirmed via grep + Read tool
- Commit `db10e09` exists in `git log --oneline` — confirmed (Task 1)
- Commit `6a18952` exists in `git log --oneline` — confirmed (Task 2)
- `cargo check --lib` returns 0 errors, only expected warnings — confirmed
