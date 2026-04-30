---
phase: 18-jarvis-ptt-cross-app
plan: 01
subsystem: scaffolding
tags: [tauri, rust, module-registration, scaffolding, jarvis, chat-first, type-contracts]

# Dependency graph
requires:
  - phase: 17-doctor-module
    provides: "Module-registration 3-step pattern (mod + generate_handler!) at lib.rs:80,1341-1343 — Phase 18 mirrors verbatim"
provides:
  - "Locked type contracts: EgoVerdict + EgoOutcome + IntentClass + DispatchResult + ConsentVerdict (snake_case wire form)"
  - "4 module skeleton files (ego.rs, intent_router.rs, jarvis_dispatch.rs, consent.rs) compiling clean"
  - "6 Tauri commands registered + verified clash-free (ego_intercept, intent_router_classify, jarvis_dispatch_action, consent_get_decision, consent_set_decision, consent_revoke_all)"
  - "CONSENT_SCHEMA SQLite table definition (ready for Plan 10 round-trip)"
  - "REFUSAL_PATTERNS OnceLock slot + RETRY_COUNT atomic (ready for Plan 08)"
affects: [18-02, 18-03, 18-04, 18-05, 18-06, 18-08, 18-09, 18-10, 18-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "snake_case serde wire form on enum tag — TS literal unions (Plan 06) mirror exactly"
    - "Tauri command rename for greppability (jarvis_dispatch_action, NOT dispatch_action) when private fns of same name exist"
    - "OnceLock<Vec<(Regex, &'static str)>> for static regex tables (refusal patterns)"
    - "AtomicU32 + reset_*_for_turn() pattern for per-chat-turn counters (retry cap)"

key-files:
  created:
    - "src-tauri/src/ego.rs (89 lines — EgoVerdict + EgoOutcome enums, REFUSAL_PATTERNS slot, RETRY_COUNT atomic, intercept_assistant_output + handle_refusal skeletons, ego_intercept Tauri command, 2 stub tests)"
    - "src-tauri/src/intent_router.rs (39 lines — IntentClass enum, classify_intent skeleton, intent_router_classify Tauri command, 1 stub test)"
    - "src-tauri/src/jarvis_dispatch.rs (43 lines — DispatchResult enum, jarvis_dispatch_action Tauri command skeleton, 1 stub test, IntentClass cross-module import)"
    - "src-tauri/src/consent.rs (75 lines — ConsentVerdict internal enum, CONSENT_SCHEMA constant, 3 Tauri command skeletons, consent_check internal helper, 2 stub tests)"
  modified:
    - "src-tauri/src/lib.rs (+11 lines — 4 mod declarations after doctor at line 80, 6 generate_handler entries after Phase 17 doctor block)"

key-decisions:
  - "Tauri command renamed from dispatch_action → jarvis_dispatch_action for greppability (PATTERNS § Pre-flight Namespace Check verified zero Tauri-namespace clash, but 2 private dispatch_action fns exist in action_tags.rs:84 + goal_engine.rs:416)"
  - "ConsentVerdict is internal-only (NOT serialized, NOT a Tauri command return type) — only the 3 consent_* commands exposed via IPC; consent_check is module-internal and consumed by jarvis_dispatch in Plan 14"
  - "All locked enums use #[serde(tag = \"kind\", rename_all = \"snake_case\")] — TS literal unions (Plan 06) match exactly: pass | refusal | capability_gap | retried | auto_installed | hard_refused | chat_only | action_required | executed | no_consent | hard_failed_no_creds | not_applicable"

patterns-established:
  - "Phase 18 module placement: clustered alphabetically with Phase 17 doctor (lib.rs:80-84) — keeps diagnostic + chat modules in one neighborhood"
  - "Wave-0 scaffolding: write enum + function skeleton + #[cfg(test)] mod tests with 1-2 trivial assertions (matches!() pattern for skeleton verification); real test cases land in body waves with comment-pinned coverage list"
  - "Cross-module type sharing: jarvis_dispatch.rs imports IntentClass via use crate::intent_router::IntentClass — verifies cross-module type contract works after lib.rs registration"

requirements-completed: [JARVIS-03, JARVIS-04, JARVIS-05, JARVIS-06, JARVIS-08, JARVIS-11]
# Note: REQ completion is partial — Plan 01 lands the type-contract scaffolding for these REQs;
# bodies (and full REQ closure) land in Plans 08 (ego/JARVIS-06,JARVIS-08), 09 (intent/JARVIS-03),
# 10 (consent/JARVIS-05), 14 (dispatch/JARVIS-04), and 17 (frontend/JARVIS-11).
# Marked complete here per plan frontmatter directive.

# Metrics
duration: 14min
completed: 2026-04-30
---

# Phase 18 Plan 01: JARVIS Chat-First Scaffolding Summary

**4 new Rust modules (ego, intent_router, jarvis_dispatch, consent) with locked snake_case type contracts + 6 Tauri commands registered clash-free, ready for Wave 1+ body fills**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-30T13:50Z (plan-stage handoff)
- **Completed:** 2026-04-30T14:04Z
- **Tasks:** 3 (all committed atomically)
- **Files created:** 4
- **Files modified:** 1 (lib.rs)
- **Net insertions:** +258 lines (4 new files + 11 lib.rs lines)

## Accomplishments

- Locked 5 enum type contracts (EgoVerdict, EgoOutcome, IntentClass, DispatchResult, ConsentVerdict) with snake_case wire form — Plan 06 TS literal unions will mirror exactly, no payload mismatches possible
- 4 module skeleton files compile clean with only expected dead_code warnings (bodies land in Plans 08/09/10/14)
- 6 Tauri commands registered in lib.rs `generate_handler!` clash-free per PATTERNS § Pre-flight Namespace Check (zero `ego_*` / `intent_*` / `jarvis_*` / `consent_*` clashes confirmed)
- 6 stub tests pass: `cargo test --lib ego::tests` (2/2), `intent_router::tests` (1/1), `jarvis_dispatch::tests` (1/1), `consent::tests` (2/2)
- 6-place config rule did NOT fire — zero `BladeConfig` fields added (per CONTEXT D-04 chat-first frame, this plan is scaffolding only)
- Renamed `dispatch_action` → `jarvis_dispatch_action` for greppability (two private `dispatch_action` fns exist in action_tags.rs:84 + goal_engine.rs:416; rename keeps Phase 18's outbound surface unambiguous in code search)

## Task Commits

Each task was committed atomically (no Co-Authored-By per CLAUDE.md):

1. **Task 1: Create ego.rs + intent_router.rs skeletons with locked type contracts** — `ba3410e` (feat)
2. **Task 2: Create jarvis_dispatch.rs + consent.rs skeletons with locked type contracts** — `085e084` (feat)
3. **Task 3: Register 4 modules in lib.rs (3-step rule) + 6 generate_handler entries** — `8e50592` (feat)

**Plan metadata commit:** _pending — final commit closes SUMMARY + STATE + ROADMAP_

## Locked Type Signatures (mirror in Plan 06 TS bindings)

```rust
// ego.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EgoVerdict {
    Pass,
    Refusal { pattern: String, reason: String },
    CapabilityGap { capability: String, suggestion: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EgoOutcome {
    Retried { new_response: String },
    AutoInstalled { capability: String, then_retried: String },
    HardRefused { final_response: String, logged_gap: bool },
}

// intent_router.rs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
}

// jarvis_dispatch.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DispatchResult {
    Executed { service: String, payload: serde_json::Value },
    NoConsent,
    HardFailedNoCreds { service: String, suggestion: String },
    NotApplicable,
}

// consent.rs (internal-only — NOT serialized, NOT a Tauri command return type)
#[derive(Debug, Clone, PartialEq)]
pub enum ConsentVerdict {
    Allow,
    Deny,
    NeedsPrompt,
}
```

## Tauri Commands Registered (6, all clash-free)

| Command                        | Module           | Body Plan |
| ------------------------------ | ---------------- | --------- |
| `ego_intercept`                | ego              | Plan 08   |
| `intent_router_classify`       | intent_router    | Plan 09   |
| `jarvis_dispatch_action`       | jarvis_dispatch  | Plan 14   |
| `consent_get_decision`         | consent          | Plan 10   |
| `consent_set_decision`         | consent          | Plan 10   |
| `consent_revoke_all`           | consent          | Plan 10   |

## Test Stubs Added

| Module          | Tests | Purpose                                                                    |
| --------------- | ----- | -------------------------------------------------------------------------- |
| ego             | 2     | `skeleton_compiles` (Pass placeholder), `reset_retry_works` (atomic reset) |
| intent_router   | 1     | `skeleton_returns_chat_only` (async tokio test, ChatOnly placeholder)      |
| jarvis_dispatch | 1     | `skeleton_returns_not_applicable` (async tokio test placeholder)           |
| consent         | 2     | `skeleton_returns_needs_prompt`, `schema_string_present`                   |

Real test cases for each module pinned in source-code comments (planner-locked test plans for Plans 08/09/10/14).

## Confirmation: 6-Place Config Rule Did NOT Fire

Per CONTEXT D-04 chat-first frame, **zero `BladeConfig` fields were added in this plan.** The 6-place rule (`DiskConfig` struct + `DiskConfig::default()` + `BladeConfig` struct + `BladeConfig::default()` + `load_config()` + `save_config()`) is N/A here. All 4 new modules use file-scoped statics (REFUSAL_PATTERNS, RETRY_COUNT, CONSENT_SCHEMA) for runtime state — none of which are user-configurable surface in Phase 18.

## Files Created/Modified

- **`src-tauri/src/ego.rs`** (created) — Refusal detector + capability_gap classifier + retry orchestrator skeleton (D-11..D-15)
- **`src-tauri/src/intent_router.rs`** (created) — IntentClass classification skeleton (D-03, D-04)
- **`src-tauri/src/jarvis_dispatch.rs`** (created) — Outbound fan-out skeleton (D-05)
- **`src-tauri/src/consent.rs`** (created) — Per-action consent decisions skeleton with SQLite schema (D-08, D-09, D-10)
- **`src-tauri/src/lib.rs`** (modified) — 4 mod declarations + 6 generate_handler entries

## Decisions Made

- **Tauri command name `jarvis_dispatch_action`** (not `dispatch_action`) — verified clash-free at the Tauri namespace, but the rename improves greppability since 2 private `dispatch_action` fns exist in action_tags.rs:84 and goal_engine.rs:416. Plan 14 will reference this command by its full name in frontend bindings.
- **`ConsentVerdict` stays internal-only** — only `consent_check` (internal) consumes it. The 3 Tauri commands return primitives (`Option<String>`, `Result<(), String>`) so the internal enum doesn't need serde derives. Plan 10 will use `consent_check` from `jarvis_dispatch::jarvis_dispatch_action` (Plan 14) before invoking outbound — internal call path, no IPC crossing.
- **`CONSENT_SCHEMA` lives in `consent.rs` as a `const &str`** — not a separate migration file. Plan 10 will run `CREATE TABLE IF NOT EXISTS consent_decisions` once via the standard `evolution.rs:1115` blade.db pattern (rusqlite::Connection::open, execute_batch).
- **Module placement is alphabetical with Phase 17 doctor** — `mod consent; mod doctor; mod ego; mod intent_router; mod jarvis_dispatch;` cluster at lib.rs:80-84. Keeps diagnostic + chat-first modules in one neighborhood for future readers.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<action>` blocks for Tasks 1 and 2 contained the verbatim file content (locked by orchestrator under D-11..D-15 type contracts). All three tasks executed mechanically: Write tool for new files, Edit tool for lib.rs, no creative interpretation needed. Zero auto-fixes (Rule 1/2/3) triggered. No checkpoints (Rule 4). No CLAUDE.md violations.

**Total deviations:** 0
**Impact on plan:** None. Pure scaffolding plan; locked type contracts copied verbatim per orchestrator's interface-first ordering.

## Issues Encountered

- **`cargo test --lib` does not accept multiple TESTNAME arguments** — initial run with `cargo test --lib ego intent_router jarvis_dispatch consent` failed with `unexpected argument 'intent_router' found`. Resolved by running 4 separate test invocations (`cargo test --lib ego::tests`, etc.). Each module's tests pass independently. Not a code issue, just CLI ergonomics.

## Verification Evidence

```
$ grep -nE "^mod (ego|intent_router|jarvis_dispatch|consent);" src-tauri/src/lib.rs
81:mod consent;          // Phase 18 — per-action consent decisions (D-08)
82:mod ego;              // Phase 18 — refusal detector + retry orchestrator (D-11)
83:mod intent_router;    // Phase 18 — IntentClass classification (D-03)
84:mod jarvis_dispatch;  // Phase 18 — outbound fan-out (D-05)

$ grep -nE "(ego::ego_intercept|intent_router::intent_router_classify|jarvis_dispatch::jarvis_dispatch_action|consent::consent_)" src-tauri/src/lib.rs
1349:            ego::ego_intercept,
1350:            intent_router::intent_router_classify,
1351:            jarvis_dispatch::jarvis_dispatch_action,
1352:            consent::consent_get_decision,
1353:            consent::consent_set_decision,
1354:            consent::consent_revoke_all,

$ cd src-tauri && cargo check
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1m 43s
    (only 6 expected dead_code warnings — bodies land in Plans 08/09/10/14)

$ cargo test --lib ego::tests       — 2/2 pass
$ cargo test --lib intent_router::tests — 1/1 pass
$ cargo test --lib jarvis_dispatch::tests — 1/1 pass
$ cargo test --lib consent::tests   — 2/2 pass

$ grep -RIn "fn intent_classify|fn ego_intercept|fn consent_get|fn consent_set|fn jarvis_dispatch_action|fn intent_router_classify|fn consent_revoke" src-tauri/src/
src-tauri/src/ego.rs:65:pub fn ego_intercept(transcript: String) -> EgoVerdict {
src-tauri/src/intent_router.rs:24:pub async fn intent_router_classify(message: String) -> IntentClass {
src-tauri/src/jarvis_dispatch.rs:30:pub async fn jarvis_dispatch_action(
src-tauri/src/consent.rs:29:pub fn consent_get_decision(_intent_class: String, _target_service: String) -> Option<String> {
src-tauri/src/consent.rs:36:pub fn consent_set_decision(
src-tauri/src/consent.rs:46:pub fn consent_revoke_all() -> Result<(), String> {
(zero clashes — only the new file definitions)
```

## Open Items (Wave 1+ work)

| Item                                       | Lands in Plan |
| ------------------------------------------ | ------------- |
| REFUSAL_PATTERNS body (≥9 regex patterns)  | Plan 08       |
| handle_refusal retry loop + auto_install   | Plan 08       |
| classify_intent heuristic + LLM-fallback   | Plan 09       |
| consent SQLite round-trip (get/set/revoke) | Plan 10       |
| jarvis_dispatch fan-out body               | Plan 14       |
| Frontend TS literal unions + JarvisPill    | Plan 06, 17   |

## Threat Surface Carry-Forward

Per plan threat_model: T-18-CARRY-01 (Tampering: Tauri IPC → Rust commands) flagged for `mitigate` — Wave 0 skeletons accept any string but return `NotApplicable`/`None` placeholders, so no untrusted execution paths exist yet. Plan 14 lands input validation. T-18-CARRY-02 (Information Disclosure on EgoVerdict::CapabilityGap.suggestion) accepted — developer-authored catalog strings, not user input.

No new threat surface introduced (per § Threat Flags scan): all 4 new modules are pure type-contract files; no network endpoints, no auth paths, no file access, no schema changes outside CONSENT_SCHEMA (which is a CREATE TABLE IF NOT EXISTS deferred to Plan 10's body).

## Self-Check: PASSED

- [x] `src-tauri/src/ego.rs` exists (89 lines)
- [x] `src-tauri/src/intent_router.rs` exists (39 lines)
- [x] `src-tauri/src/jarvis_dispatch.rs` exists (43 lines)
- [x] `src-tauri/src/consent.rs` exists (75 lines)
- [x] `src-tauri/src/lib.rs` modified (4 mod + 6 handler entries)
- [x] Commit ba3410e exists in git log (Task 1)
- [x] Commit 085e084 exists in git log (Task 2)
- [x] Commit 8e50592 exists in git log (Task 3)
- [x] All 6 stub tests pass
- [x] cargo check clean (no compile errors; 6 dead_code warnings expected — bodies in later plans)

## Next Phase Readiness

- Wave 1+ plans (08, 09, 10, 14) can implement against locked type contracts without exploring the codebase
- Plan 06 (TS literal unions) has the verbatim wire-form spec to mirror
- 6-place config rule did NOT fire; downstream plans add their own config fields if needed (none currently scoped)
- Phase 18 module cluster established at lib.rs:80-84; Wave 1+ Tauri commands added near lines 1349-1354
- Foundation ready for Wave 1 (intent classification + refusal detection bodies)

---
*Phase: 18-jarvis-ptt-cross-app*
*Plan: 01 (Wave 0 — type-contract scaffolding)*
*Completed: 2026-04-30*
