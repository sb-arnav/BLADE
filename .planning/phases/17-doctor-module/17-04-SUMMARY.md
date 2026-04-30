---
phase: 17-doctor-module
plan: 04
subsystem: diagnostics
tags: [doctor, signal-sources, tentacle-health, config-drift, suggested-fix, ui-spec-verbatim, phase-17]

# Dependency graph
requires:
  - phase: 17-doctor-module
    provides: "Plan 17-02 (DoctorSignal struct + SignalClass/Severity enums + suggested_fix table skeleton with TODO stubs + 3 stubbed Tauri commands + integration_bridge::get_per_service_last_poll accessor); Plan 17-03 (compute_eval_signal + compute_capgap_signal + compute_autoupdate_signal landed in same wave)"
provides:
  - "compute_tentacle_signal: synchronous DOCTOR-04 source aggregating supervisor::supervisor_get_health() (6 BLADE services) + integration_bridge::get_per_service_last_poll() (MCP tentacles, disabled filtered) into worst-of severity rollup per CONTEXT D-07"
  - "classify_tentacle(now_secs, last_heartbeat, status) -> Severity: testable inner helper covering all D-07 branches (status overrides + age thresholds at 1h/24h)"
  - "compute_drift_signal: synchronous DOCTOR-05 source combining migration-ledger Node child-process probe + scan-profile age (deep_scan::load_results_pub) per CONTEXT D-08"
  - "classify_drift(ledger_drift, profile_age_days) -> Severity: testable inner helper; None profile_age treated as stale per Recommendation A5"
  - "check_migration_ledger() -> (bool, String): graceful Node child-process spawn (Command::new — no shell-out) returning (drift, note) with exit-code 0/1/other → clean/drift/no-drift fallback"
  - "scan_profile_age_days() -> Option<i64>: filesystem read of scan_results.json::scanned_at (ms) → days-since; None on missing file"
  - "Verbatim UI-SPEC § 15 strings replacing all 15 (class × severity) suggested_fix stubs — D-18 lock honored, no paraphrase"
  - "11 new unit tests: 5 classify_tentacle branches + 6 classify_drift branches + 1 verbatim-string lock test"
  - "Total doctor::tests count: 29 (was 17 from prior plans + 11 new + 1 prior-plan suggested_fix test still passing)"
affects: ["17-05 (doctor_run_full_check orchestrator + tokio::join! over all 5 sources + transition detection + doctor_event emission)", "17-06 (DoctorPane.tsx frontend — drawer renders verbatim suggested-fix copy already locked in this plan)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worst-of severity rollup pattern: max_by_key over Severity::{Green=0, Amber=1, Red=2} for aggregating per-observer verdicts into a single signal-class verdict"
    - "Two-source observer aggregation: supervisor (6 BLADE services with explicit status enum) + integration_bridge MCP (last_poll only — implicit liveness via poll freshness). Disabled MCP integrations filtered before classification."
    - "Inner classifier helper pattern reused from Plan 17-03 (classify_autoupdate) — classify_tentacle and classify_drift accept synthetic primitives so unit tests run without supervisor/integration_bridge/Node child-process state"
    - "Graceful-degradation Command::new spawn: Node missing / script error / exit code != 0/1 → (false, note) so doctor signal stays Green with diagnostic note in payload (no panic, no error propagation)"
    - "Path construction from CARGO_MANIFEST_DIR (compile-time constant) + relative path constants — no user input reaches Command args, no shell-out, no injection surface (ASVS V12.3)"
    - "Verbatim string-equality lock test: assert_eq! full-string match catches drift if anyone edits the suggested_fix table; UI-SPEC § 15 is the source-of-truth (D-18)"
    - "#[allow(dead_code)] on classify_tentacle / compute_tentacle_signal / classify_drift / check_migration_ledger / scan_profile_age_days / compute_drift_signal — all exercised by tests but not yet wired into doctor_run_full_check (Plan 17-05 owns that wiring)"

key-files:
  created: []
  modified:
    - "src-tauri/src/doctor.rs (+302 net insertions: 1 classifier helper + 1 source body for tentacle, 3 helpers + 1 source body + 1 classifier helper for drift, 15-arm verbatim suggested_fix replacement, 12 new unit tests)"

key-decisions:
  - "MCP-tentacle status mapping: integration_bridge has no per-service status enum, only last_poll (i64 unix secs). Mapped last_poll == 0 to 'unknown' (never polled — Amber per D-07) and any non-zero to 'running' (poller is the implicit liveness probe). This preserves D-07 semantics while honoring the integration_bridge data shape."
  - "Disabled MCP integrations filtered out BEFORE classification (filter on enabled == true). Rationale: a user-disabled Gmail integration is not a tentacle the user expects to be live; surfacing 'dead' Amber/Red on it would be noise. Supervisor services have no enable/disable toggle so they always classify."
  - "compute_tentacle_signal returns Green on empty observer set (no supervised services + no MCP integrations) rather than Amber. Matches the eval-signal Green-on-empty-history convention from Plan 17-03 — fresh install with nothing observable yet should not surface a regression."
  - "check_migration_ledger spawns `node` directly via Command::new (NOT bash -c, NOT sh -c). The script path is built from CARGO_MANIFEST_DIR (compile-time) so even if the path string contained shell metacharacters, no shell would interpret them. Confirms threat model T-17-01 (command injection) → mitigated."
  - "Node-missing graceful fallback: Command spawn fails → returns (false, 'could not run node: ...'). Drift is reported Green with diagnostic note in payload. User's actual ledger drift goes undetected, but Doctor surface stays alive — documented behavior, not silent failure."
  - "scan_profile_age_days returns None on missing file (instead of erroring or defaulting to 0). classify_drift then treats None as stale per Recommendation A5 — fresh install with no Deep scan = onboarding-incomplete = drift signal. This is intentional surface for Doctor to nudge users to complete onboarding."
  - "All 15 suggested_fix strings copied character-for-character from UI-SPEC § 15. Three strings cross 100 chars but Rust accepts long literals without continuation. Backtick-style code references are stored as plain text per UI-SPEC § 15 'Format conventions' note (markdown rendering is a future polish phase)."
  - "Red Auto-Update string is the '(Reserved — Auto-Update has no Red tier per D-09 ...)' sentinel verbatim from UI-SPEC § 15. The match arm is exhaustive (15/15) so cargo check passes, but if classify_autoupdate ever returns Red the rendered string self-documents the bug."
  - "Verbatim lock test asserts full-string equality on 3 canonical entries (EvalScores Red, AutoUpdate Green, CapabilityGaps Red) + a substring assertion on the Auto-Update Red sentinel. If any future agent paraphrases a string, the test fails immediately — D-18 lock has CI teeth."

patterns-established:
  - "Wave-2 internal serialization: Plan 17-03 + Plan 17-04 both write doctor.rs (same file, different function-scoped regions). Sequential by frontmatter (depends_on: [02, 03]) — Plan 17-03 lands first, Plan 17-04 strictly ADDS new functions + REPLACES the suggested_fix body. No collision because Plan 17-04 does not modify any Plan 17-03 function."
  - "Doctor signal source convention now complete (5/5): all signal-source functions follow `fn compute_{class}_signal() -> Result<DoctorSignal, String>` synchronous signature, return early Green on empty/missing input, delegate severity to a testable classify_{class} helper. Plan 17-05's orchestrator wraps each in tokio::spawn_blocking + tokio::join!."
  - "D-18 verbatim lock pattern: copy text from UI-SPEC verbatim, store as &'static str in a match table, lock with full-string-equality test. Pattern is reusable for any future copy-locked surface (announcement banners, error messages, etc.)."

requirements-completed: [DOCTOR-04, DOCTOR-05]

# Metrics
duration: ~30min execution + ~14min compile cycles (3 cargo test + 1 cargo check passes)
completed: 2026-04-30
---

# Phase 17 Plan 04: TentacleHealth + ConfigDrift Sources + Verbatim D-18 Strings Summary

Plan 17-04 closes Wave 2 of the Doctor module by adding the two remaining signal sources (`compute_tentacle_signal` and `compute_drift_signal`) and replacing the 15 suggested_fix stub strings with verbatim copy from UI-SPEC § 15. After Plan 17-04 closes, all 5 signal sources exist in `doctor.rs`; only Plan 17-05's orchestrator wiring + transition detection + `doctor_event` emission remains before the Doctor backend is feature-complete.

## What Shipped

### Task 1: TentacleHealth signal source (DOCTOR-04, D-07) — commit `6ccfdfd`

`classify_tentacle(now_secs, last_heartbeat, status) -> Severity` — testable severity helper:
- Red iff `status == "dead"` OR `(now - last_heartbeat) >= 24h`
- Amber iff `status == "restarting"` OR `status == "unknown"` OR `(now - last_heartbeat) >= 1h`
- Green otherwise

`compute_tentacle_signal() -> Result<DoctorSignal, String>` — aggregates two observer surfaces:
- **Supervisor-registered tentacles** via `crate::supervisor::supervisor_get_health()` returning `Vec<ServiceHealth>` for the 6 BLADE services (perception, screen_timeline, godmode, learning_engine, homeostasis, hive). Each service exposes `name`, `status: String`, `last_heartbeat: i64` (unix secs), `crash_count: u32`.
- **MCP integrations** via `crate::integration_bridge::get_per_service_last_poll()` returning `Vec<(String, i64, bool)>` (service, last_poll_unix_secs, enabled). Disabled integrations filtered before classification.

Worst-of severity rollup (Red > Amber > Green). Empty observer set → Green. Payload includes `total_tentacles`, `supervised_count`, `mcp_count`, plus a per-tentacle list with severity tag (lowercase string matching D-04 wire form) and full details.

5 unit tests proving every D-07 branch (fresh-running=Green, 1h-stale=Amber, restarting-status=Amber, 24h-dead=Red, dead-status=Red).

### Task 2: ConfigDrift signal source (DOCTOR-05, D-08) — commit `33ddf46`

`classify_drift(ledger_drift, profile_age_days) -> Severity` — testable severity helper, with `None` profile_age treated as stale (Recommendation A5: missing scan profile = onboarding incomplete = drift signal):
- Red iff `ledger_drift` AND `profile_stale`
- Amber iff `ledger_drift` XOR `profile_stale`
- Green iff neither

`check_migration_ledger() -> (bool, String)` — spawns `node scripts/verify-migration-ledger.mjs` via `Command::new("node")` (NOT shell-out), returning `(drift, note)`:
- exit 0 → `(false, "ledger clean")`
- exit 1 → `(true, "ledger drift detected")`
- anything else / spawn error → `(false, note)` graceful fallback

Path constructed from `CARGO_MANIFEST_DIR` (compile-time) — no user input on `Command` args, no injection surface (T-17-01 mitigated).

`scan_profile_age_days() -> Option<i64>` — reads `crate::deep_scan::load_results_pub()` and divides `(now_ms - scanned_at) / 86_400_000`. None on missing file.

`compute_drift_signal() -> Result<DoctorSignal, String>` — combines both probes; defers severity to `classify_drift`. Payload includes `ledger_drift`, `ledger_note`, `profile_age_days`, `profile_stale`.

6 unit tests proving every D-08 verdict (clean+fresh=Green, drift-only=Amber, stale-only=Amber, missing-only=Amber, both=Red, drift+missing=Red).

### Task 3: Verbatim suggested_fix strings (D-18 / UI-SPEC § 15) — commit `b81c080`

All 15 (class × severity) match arms in `pub(crate) fn suggested_fix(...)` now carry the canonical handwritten copy from `.planning/phases/17-doctor-module/17-UI-SPEC.md § 15`. Strings are character-for-character verbatim — no paraphrase, no abbreviation. Three notable entries:

- **EvalScores × Red:** `"An eval module breached its asserted floor (top-3 below 80% or MRR below 0.6). Run bash scripts/verify-eval.sh to identify which module and inspect tests/evals/history.jsonl for the drop point."`
- **AutoUpdate × Green:** `"tauri-plugin-updater is wired and initialized. BLADE will check for updates on launch."`
- **AutoUpdate × Red (sentinel):** `"(Reserved — Auto-Update has no Red tier per D-09; if this string ever renders it indicates a bug in doctor.rs severity classification.)"`

New test `suggested_fix_strings_match_ui_spec_verbatim` asserts full string equality on 3 canonical entries + substring on the Auto-Update Red sentinel. Plan 02's `suggested_fix_table_is_exhaustive` test still passes (it iterates all 15 pairs and asserts non-empty).

## Signal-Source Function Inventory (post-04)

After Plan 17-04 closes, `doctor.rs` has all 5 signal sources Plan 17-05's orchestrator will call in parallel via `tokio::join!`:

| Function                       | REQ        | Plan landed | Severity rule (CONTEXT) |
|--------------------------------|------------|-------------|--------------------------|
| `compute_eval_signal`          | DOCTOR-02  | 17-03       | D-05 (floor breach / 10% drop) |
| `compute_capgap_signal`        | DOCTOR-03  | 17-03       | D-06 (≥3 in 7d / ≥1 in 24h) |
| `compute_autoupdate_signal`    | DOCTOR-10  | 17-03       | D-09 (Cargo.toml + lib.rs anchors) |
| `compute_tentacle_signal`      | DOCTOR-04  | **17-04**   | D-07 (≥24h dead / ≥1h stale) |
| `compute_drift_signal`         | DOCTOR-05  | **17-04**   | D-08 (ledger drift + scan age) |

All 5 share the same signature `fn name() -> Result<DoctorSignal, String>` — synchronous, bounded I/O, ready for `tokio::spawn_blocking` wrapping.

## Classify Helper Inventory (Plan 17-05 may call directly in tests)

| Helper                                                              | Inputs                                                | Plan |
|---------------------------------------------------------------------|-------------------------------------------------------|------|
| `classify_autoupdate(cargo_toml: &str, lib_rs: &str) -> Severity`   | File contents (substring grep)                        | 17-03 |
| `classify_tentacle(now_secs, last_heartbeat, status) -> Severity`   | unix secs + status string                             | 17-04 |
| `classify_drift(ledger_drift, profile_age_days) -> Severity`        | bool + Option<i64>                                    | 17-04 |

(`compute_eval_signal` + `compute_capgap_signal` classify inline — their inputs are already test-fixture-ready via env-overridden filesystem / DB paths.)

## Wave-2 Internal Serialization

Plan 17-03 + Plan 17-04 both write to `doctor.rs` in Wave 2 (frontmatter `depends_on: [02, 03]` for 17-04). Sequential by design — Plan 17-03 lands first, Plan 17-04 strictly ADDS new functions and REPLACES the suggested_fix body. No collision because:

- Plan 17-04 added 6 new functions (`classify_tentacle`, `compute_tentacle_signal`, `classify_drift`, `check_migration_ledger`, `scan_profile_age_days`, `compute_drift_signal`) — all unique names.
- The only Plan 17-03 surface Plan 17-04 modified is the `suggested_fix` function body (replaced TODO stubs with verbatim strings). Plan 17-03 never wrote that body — it was Plan 17-02's stub. Replacement is non-conflicting.
- `#[cfg(test)] mod tests` block: Plan 17-03 added 13 tests; Plan 17-04 added 12. Both coexist by design.

Final `doctor::tests` count: 29 tests, all green.

## Verification Evidence

**cargo test --lib doctor::tests -- --test-threads=1** (29/29 passing):
```
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 150 filtered out; finished in 0.22s
```

**cargo check** (clean, no warnings, no errors): exit 0 in 4m 27s.

**Acceptance criteria checks:**
- `grep -c "TODO Plan 17-04" src-tauri/src/doctor.rs` → 0 (all stubs replaced)
- `grep -E "fn compute_(eval|capgap|autoupdate|tentacle|drift)_signal" src-tauri/src/doctor.rs | wc -l` → 5
- All 11 verbatim-grep checks for canonical UI-SPEC § 15 strings pass
- All 5 tentacle classifier branch tests pass
- All 6 drift classifier branch tests pass
- Verbatim lock test passes

## Threat Model Compliance

T-17-01 (command injection on `Command::new("node").arg(&script)`) — **mitigated** as planned. Spawn uses `Command::new("node")`, not `bash -c` / `sh -c`. Path argument is built from `env!("CARGO_MANIFEST_DIR")` (compile-time constant) joined with relative path constants — zero user input on `Command` args. ASVS V12.3 satisfied.

T-17-02 (information disclosure on tentacle/drift payload) — **accepted** per plan disposition. Service names are static enum-like strings ("perception", "gmail", etc.); paths in error notes are local — same disclosure surface as Plan 17-03's autoupdate signal.

T-17-04 (resource exhaustion on Node child process) — **accepted** per plan disposition. Single short-lived spawn per `doctor_run_full_check` invocation; Doctor is user-invoked, not auto-fired.

## Deviations from Plan

**None. Plan executed exactly as written.**

The plan's "Watch out" notes about Plan 17-03 already having landed proved correct (frontmatter dependency was respected — Plans 17-03 + 17-04 are both committed in sequential order). Both signal sources, all helper functions, all test counts, and all 15 verbatim strings shipped to spec.

## Self-Check: PASSED

**Created files (none — Plan 17-04 modifies only doctor.rs).**

**Modified files:**
- `/home/arnav/blade/src-tauri/src/doctor.rs` — FOUND

**Commits:**
- `6ccfdfd` — feat(17-04): add compute_tentacle_signal + classify_tentacle helper — FOUND in `git log`
- `33ddf46` — feat(17-04): add compute_drift_signal + classify_drift helper — FOUND in `git log`
- `b81c080` — feat(17-04): replace suggested_fix stubs with verbatim UI-SPEC § 15 strings — FOUND in `git log`

All 3 task commits exist in `git log --oneline -5`; cargo check + 29/29 doctor tests green confirm runtime claims.
