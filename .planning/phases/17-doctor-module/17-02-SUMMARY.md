---
phase: 17-doctor-module
plan: 02
subsystem: rust-backend
tags: [rust-module, tauri-commands, doctor, diagnostic-aggregator, signal-class, severity, wave-0]

# Dependency graph
requires:
  - phase: 17-doctor-module
    provides: "Plan 17-01 — record_eval_run + history_jsonl_path public in src-tauri/src/evals/harness.rs"
provides:
  - "doctor.rs skeleton — SignalClass + Severity enums + DoctorSignal struct"
  - "3 stubbed Tauri commands: doctor_run_full_check, doctor_get_recent, doctor_get_signal"
  - "Exhaustive 15-arm suggested_fix() match table (Plan 17-04 replaces strings only)"
  - "PRIOR_SEVERITY + LAST_RUN OnceLock<Mutex<...>> caches (Plan 17-04 wires transition detection)"
  - "integration_bridge::get_per_service_last_poll() accessor for DOCTOR-04 tentacle health"
affects:
  - 17-doctor-module (Plans 17-03, 17-04, 17-05, 17-06, 17-07 consume this skeleton)

# Tech tracking
tech-stack:
  added: []  # Zero new deps; uses existing serde, tauri, tokio, chrono
  patterns:
    - "Source-self-classifies: each signal class returns DoctorSignal{class, severity, payload, last_changed_at, suggested_fix} (D-02)"
    - "OnceLock<Mutex<HashMap<K,V>>> lazy-init pattern for module-local state (analog: supervisor.rs HEALTH_MAP)"
    - "snake_case Rust enum → JS literal-union wire-form contract (CONTEXT D-03 + Plan 17-05)"
    - "Exhaustive match on (class × severity) so Plan 17-04 replaces strings without restructuring control flow"

key-files:
  created:
    - "src-tauri/src/doctor.rs (225 lines — enums + struct + 3 stubs + 15-arm match + 5 unit tests)"
  modified:
    - "src-tauri/src/lib.rs (add `mod doctor;` adjacent to `mod supervisor;`; register 3 doctor commands in generate_handler!)"
    - "src-tauri/src/integration_bridge.rs (add `pub fn get_per_service_last_poll() -> Vec<(String, i64, bool)>`)"

key-decisions:
  - "Use #[allow(dead_code)] on PRIOR_SEVERITY + prior_severity_map (Plan 17-04 scaffolding) instead of `#![allow(dead_code)]` at module-top — keeps the surface tight, requires Plan 17-04 to remove one-line allow when it consumes the symbol"
  - "doctor_get_signal returns Option<DoctorSignal> (not DoctorSignal as D-19 reads literally) — handles cache-miss soundly without surfacing a Tauri error to the frontend; Plan 17-06's TS wrapper returns Promise<DoctorSignal | null>"
  - "Eager-import Emitter via #[allow(unused_imports)] in Plan 17-02 — keeps Plan 17-04's diff a pure additive insert when it wires app.emit('doctor_event', ...)"
  - "Insert mod doctor; BEFORE mod supervisor; (alphabetical: d < s; topical: diagnostic siblings adjacent)"
  - "Insert 3 generate_handler! entries BEFORE supervisor::supervisor_get_health for the same topical-grouping rationale"

patterns-established:
  - "DoctorSignal contract — locked struct shape that Plans 17-03 / 17-04 / 17-05 / 17-06 cite (NOT re-decide) for their signal sources, severity classification, event payload, and TS wrapper types"
  - "15-arm exhaustive match table convention — Plan 17-04 replaces only the string literals, not the match structure; this isolates copy iteration from logic iteration"

requirements-completed: [DOCTOR-01, DOCTOR-04]

# Metrics
duration: 22min
completed: 2026-04-30
---

# Phase 17 Plan 17-02: Doctor Module Skeleton Summary

**doctor.rs skeleton with SignalClass + Severity + DoctorSignal types, 3 stubbed Tauri commands (doctor_run_full_check / doctor_get_recent / doctor_get_signal), exhaustive 15-arm suggested_fix match, and integration_bridge get_per_service_last_poll accessor — Wave 0 backend contract that Plans 17-03 / 17-04 / 17-05 / 17-06 fill in.**

## Performance

- **Duration:** 22 min (3 tasks + verification + summary)
- **Started:** 2026-04-30T09:06:28Z
- **Completed:** 2026-04-30T09:29:11Z
- **Tasks:** 3 / 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **Locked DoctorSignal contract** — `class: SignalClass | severity: Severity | payload: serde_json::Value | last_changed_at: i64 | suggested_fix: String` is now the authoritative type. Plans 17-03 / 17-04 / 17-05 / 17-06 cite this struct rather than re-deriving its shape.
- **3 Tauri commands surface (DOCTOR-01)** — `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal` are registered in `generate_handler!` and callable from the frontend (Plan 17-06 will wire `invokeTyped` wrappers). Stub bodies return 5 placeholder Green signals so the UI can be exercised end-to-end before Plan 17-04 lands real signal sources.
- **Wire-form lock** — `SignalClass` serializes as `snake_case` (`eval_scores`, `auto_update`, …) and `Severity` as `lowercase` (`green`, `amber`, `red`). The TS literal union in Plan 17-05's `DoctorEventPayload` and the UI's `data-severity="…"` attribute depend on these wire forms exactly.
- **Exhaustive 15-arm match table** — `suggested_fix(class, severity)` covers all 5 × 3 (class × severity) combinations with placeholder strings. Plan 17-04 replaces the strings only; the control-flow structure is locked.
- **DOCTOR-04 source ready** — `integration_bridge::get_per_service_last_poll() -> Vec<(String, i64, bool)>` returns `(service_name, last_poll_unix_secs, enabled)` for each MCP tentacle (gmail / calendar / slack / github), reading the existing `IntegrationConfig` storage without mutation.
- **5 unit tests pass** — wire-form serialization (snake_case + lowercase), cache-miss `None` handling, exhaustive match coverage, and `PRIOR_SEVERITY` lazy-init smoke. All run with `--test-threads=1` per harness convention.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src-tauri/src/doctor.rs skeleton** — `0c1099c` (feat)
2. **Task 2: Register doctor module in lib.rs (mod + 3 generate_handler entries)** — `4cc9ec0` (feat)
3. **Task 3: Add get_per_service_last_poll accessor to integration_bridge.rs** — `1dcfb8b` (feat)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified

- `src-tauri/src/doctor.rs` (CREATED, 225 lines) — Module skeleton: `SignalClass` (5 variants) + `Severity` (3 variants) + `DoctorSignal` struct + `PRIOR_SEVERITY` + `LAST_RUN` caches + `suggested_fix` 15-arm match + 3 stubbed Tauri commands (`doctor_run_full_check` / `doctor_get_recent` / `doctor_get_signal`) + 5 `#[cfg(test)]` unit tests.
- `src-tauri/src/lib.rs` (MODIFIED, +4 lines) — `mod doctor;` declared adjacent to `mod supervisor;`; 3 entries registered in `tauri::generate_handler!` adjacent to `supervisor::supervisor_get_health`.
- `src-tauri/src/integration_bridge.rs` (MODIFIED, +14 lines) — `pub fn get_per_service_last_poll() -> Vec<(String, i64, bool)>` returns per-tentacle `(service, last_poll, enabled)` from existing `get_configs()`. Zero `IntegrationConfig` field mutations; no new `#[tauri::command]`.

## Locked Contract — Read This Before Plans 17-03 / 17-04 / 17-05 / 17-06

```rust
// src-tauri/src/doctor.rs

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Green,
    Amber,
    Red,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorSignal {
    pub class: SignalClass,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub last_changed_at: i64,    // unix milliseconds
    pub suggested_fix: String,
}
```

**Tauri command signatures (registered in `lib.rs::generate_handler!`):**
- `doctor_run_full_check(_app: AppHandle) -> Result<Vec<DoctorSignal>, String>` (async; Plan 17-04 fills body — currently returns 5 placeholder Green stubs)
- `doctor_get_recent(class: Option<SignalClass>) -> Vec<DoctorSignal>` (sync; reads `LAST_RUN` cache with optional class filter)
- `doctor_get_signal(class: SignalClass) -> Option<DoctorSignal>` (sync; returns `None` on cache miss — TS wrapper maps to `Promise<DoctorSignal | null>`)

**Suggested-fix table:** `pub(crate) fn suggested_fix(class: SignalClass, severity: Severity) -> &'static str` — exhaustive 15-arm match, Plan 17-04 replaces the placeholder `"TODO Plan 17-04: ..."` strings with the verbatim copy from UI-SPEC § 15.

**Integration-bridge accessor:** `integration_bridge::get_per_service_last_poll() -> Vec<(String, i64, bool)>` — reads `(cfg.service.clone(), cfg.last_poll, cfg.enabled)` from existing `IntegrationConfig` via the internal `get_configs()` accessor. `last_poll` is unix seconds (matches the `now_secs()` convention in `integration_bridge.rs:59-64`).

## Decisions Made

- **doctor_get_signal returns `Option<DoctorSignal>`** rather than the bare `DoctorSignal` that CONTEXT D-19 reads literally — this handles cache-miss soundly without raising a Tauri-level error. Plan 17-06's frontend wrapper maps to `Promise<DoctorSignal | null>`. Behavior preserved on both ends.
- **Eager `#[allow(unused_imports)] use tauri::{AppHandle, Emitter};`** — keeps Plan 17-04's diff a pure additive insert when it wires `app.emit("doctor_event", ...)`. Avoids re-touching the import block.
- **`#[allow(dead_code)]` on `PRIOR_SEVERITY` + `prior_severity_map`** rather than `#![allow(dead_code)]` at the file top — scoped suppression keeps the surface tight. Plan 17-04 will remove the allow attributes when it consumes the cache for transition detection.
- **`#[allow(dead_code)]` on `get_per_service_last_poll`** — same rationale; the accessor is consumed by Plan 17-04's `compute_tentacle_signal` source. Documented inline.
- **Module placement:** `mod doctor;` inserted BEFORE `mod supervisor;` (alphabetical d < s; topical: diagnostic siblings adjacent). 3 generate_handler! entries inserted BEFORE `supervisor::supervisor_get_health` for the same rationale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] Silence dead_code warnings on Plan 17-04 scaffolding**
- **Found during:** Task 2 (after wiring `mod doctor;` in lib.rs, cargo check produced 2 dead-code warnings on `PRIOR_SEVERITY` + `prior_severity_map` because the symbols are scaffolded for Plan 17-04's transition detector but not used yet)
- **Issue:** Plan must_haves require *"the new module compiles without unused-warnings escalation"*. Plan 17-04 needs the cache scaffolded (per CONTEXT D-20), so deleting the symbols isn't an option.
- **Fix:** Added `#[allow(dead_code)]` on the static + helper fn with inline comments pointing at Plan 17-04 as the consumer. Same approach used downstream for `get_per_service_last_poll` in Task 3 for the same reason.
- **Files modified:** src-tauri/src/doctor.rs (folded into Task 2 commit since the warning was first observed when lib.rs wired the module into the build graph), src-tauri/src/integration_bridge.rs
- **Verification:** `cargo check` final output: zero warnings, zero errors.
- **Committed in:** `4cc9ec0` (folded into Task 2) + `1dcfb8b` (Task 3)

---

**Total deviations:** 1 auto-fixed (1 missing critical: dead_code suppression on intentional scaffolding)
**Impact on plan:** No scope creep. The auto-fix preserves Plan 17-04's scaffolding (PRIOR_SEVERITY cache + per-service accessor) while satisfying the cargo-clean requirement. Removed by Plan 17-04 when it consumes the symbols.

## Issues Encountered

None — all 3 tasks executed first-try. The 2 dead-code warnings were anticipated by the plan's Watch-out section (no `#![allow(dead_code)]` at module top, scoped suppression preferred).

## User Setup Required

None — no external service configuration required. This is pure Rust backend scaffolding.

## Next Phase Readiness

**Wave 0 backend complete.** Plans 17-03 / 17-04 / 17-05 / 17-06 / 17-07 can now proceed:

- **Plan 17-03 (DOCTOR-02 + DOCTOR-03 signal sources)** — has `DoctorSignal` struct + `Severity` enum to populate; reads `harness::history_jsonl_path()` from Plan 17-01.
- **Plan 17-04 (DOCTOR-04..06 + suggested-fix strings + transition detection)** — replaces 15 match arms with verbatim UI-SPEC § 15 strings; consumes `PRIOR_SEVERITY` cache for D-20 transition emission; consumes `integration_bridge::get_per_service_last_poll` for D-07 tentacle staleness; removes the `#[allow(dead_code)]` annotations on consumed symbols.
- **Plan 17-05 (DOCTOR_EVENT registration + DoctorEventPayload TS interface)** — TS literal union mirrors `SignalClass` + `Severity` snake_case / lowercase wire forms locked in this plan.
- **Plan 17-06 (DoctorPane.tsx + invokeTyped wrappers)** — `doctorRunFullCheck()`, `doctorGetRecent()`, `doctorGetSignal()` map to the 3 commands surfaced here; `doctorGetSignal` returns `Promise<DoctorSignal | null>` per the cache-miss contract.

**Verification status (per CLAUDE.md Verification Protocol):** This is pure backend scaffolding (no UI surface). `/blade-uat` does NOT fire — runtime UAT applies to UI changes. Static gates are sufficient: `cargo check` green, `cargo test --lib doctor::tests` 5/5 pass.

## Self-Check: PASSED

- ✅ `src-tauri/src/doctor.rs` exists (225 lines >= 120 required)
- ✅ `mod doctor;` present in lib.rs at line 80
- ✅ 3 doctor commands registered in `generate_handler!` (lines 1341-1343)
- ✅ `pub fn get_per_service_last_poll` present in integration_bridge.rs at line 398
- ✅ Commit `0c1099c` (Task 1) found in git log
- ✅ Commit `4cc9ec0` (Task 2) found in git log
- ✅ Commit `1dcfb8b` (Task 3) found in git log
- ✅ `cargo check`: zero errors, zero warnings
- ✅ `cargo test --lib doctor::tests -- --test-threads=1`: 5/5 pass
- ✅ Zero `doctor_*` namespace clashes (only doctor.rs definitions)
- ✅ `IntegrationConfig` struct unmodified (0 field-line +/- additions)
- ✅ Zero new `#[tauri::command]` in integration_bridge.rs

---
*Phase: 17-doctor-module*
*Completed: 2026-04-30*
