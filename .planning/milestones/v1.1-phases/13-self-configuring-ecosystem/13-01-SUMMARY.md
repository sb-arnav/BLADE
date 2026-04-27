---
phase: 13-self-configuring-ecosystem
plan: "01"
subsystem: backend/ecosystem
tags: [rust, ecosystem, observer-tentacles, observe-only-guardrail, config, deep-scan-hook]
dependency_graph:
  requires:
    - deep_scan::leads::DeepScanResults (Phase 12 Plan 12-01)
    - deep_scan::leads::RepoRow (Phase 12 Plan 12-01)
    - config::BladeConfig (existing)
    - config::save_config / load_config (existing)
  provides:
    - ecosystem::auto_enable_from_scan
    - ecosystem::assert_observe_only_allowed
    - ecosystem::OBSERVE_ONLY (static AtomicBool guardrail)
    - ecosystem::ecosystem_list_tentacles (Tauri command)
    - ecosystem::ecosystem_toggle_tentacle (Tauri command)
    - ecosystem::ecosystem_observe_only_check (Tauri command)
    - ecosystem::ecosystem_run_auto_enable (Tauri command)
    - config::TentacleRecord struct
    - config::BladeConfig::ecosystem_tentacles
    - config::BladeConfig::ecosystem_observe_only
  affects:
    - src-tauri/src/config.rs (TentacleRecord + 6-place extension)
    - src-tauri/src/deep_scan/mod.rs (auto_enable_from_scan spawn after save_results)
    - src-tauri/src/lib.rs (mod ecosystem + 4 commands in generate_handler![])
tech_stack:
  added: []
  patterns:
    - AtomicBool OBSERVE_ONLY guardrail (central write-path gate, never cleared in v1.1)
    - Per-loop static RUNNING AtomicBool idempotency (from integration_bridge.rs pattern)
    - 6-place config pattern for TentacleRecord + ecosystem_observe_only
    - Signal probe pattern: each probe returns (bool, String) rationale tuple
    - Non-blocking tauri::async_runtime::spawn for ecosystem hook in deep_scan
key_files:
  created:
    - src-tauri/src/ecosystem.rs
  modified:
    - src-tauri/src/config.rs
    - src-tauri/src/deep_scan/mod.rs
    - src-tauri/src/lib.rs
decisions:
  - "Used load_results_pub() (not private load_results()) in ecosystem_run_auto_enable — private function is only accessible inside deep_scan module"
  - "Probes run as plain sync fns inside async auto_enable_from_scan — avoids spawning 6 additional tasks for simple filesystem/env checks; probe latency is negligible"
  - "test_vercel_probe_no_auth test uses conditional assertion instead of assert!(!triggered) — the test machine might legitimately have Vercel installed; the test verifies rationale consistency instead"
  - "OBSERVE_ONLY guardrail initialized as static AtomicBool::new(true) — never cleared in v1.1; v1.2 work removes this restriction per-tentacle via Settings-side enablement"
metrics:
  duration: "5m"
  completed_date: "2026-04-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
  files_deleted: 0
---

# Phase 13 Plan 01: ecosystem.rs — Observe-Only Tentacle Orchestrator Summary

**One-liner:** TentacleRecord 6-place config extension + ecosystem.rs with OBSERVE_ONLY AtomicBool guardrail, 6 signal probes (repo/slack/vercel/gh/ai-session/calendar), auto_enable_from_scan orchestrator with user-disable protection, 6 observer loop stubs with per-loop RUNNING guards, and 4 Tauri commands wired into deep_scan hook.

## What Was Built

### Task 1: TentacleRecord + 6-place config extension

Added `TentacleRecord` struct to `src-tauri/src/config.rs` with fields for `id`, `enabled`, `rationale`, `enabled_at` (0 = never registered), and `trigger_detail`. Applied the 6-place config pattern to two new fields:

- `ecosystem_tentacles: Vec<TentacleRecord>` — persists tentacle lifecycle state across restarts
- `ecosystem_observe_only: bool` — defaults to `true`; persisted but never flipped to false in v1.1

All 6 places updated: DiskConfig struct (place 1), DiskConfig::default() (place 2), BladeConfig struct (place 3), BladeConfig::default() (place 4), load_config() (place 5), save_config() (place 6). All fields use `#[serde(default)]` for backward compat with existing config.json files.

### Task 2: ecosystem.rs — full module

New `src-tauri/src/ecosystem.rs` (499 LOC):

**Guardrail:** `static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true)` — initialized true, never cleared in v1.1. `assert_observe_only_allowed(action)` returns `Err` with message containing "OBSERVE_ONLY" at any write-path entry.

**6 signal probes** (each returns `(bool, String)` rationale tuple):
1. `probe_repos` — `repo_rows.len() + git_repos.len() > 0`
2. `probe_slack` — `~/.slack/` | `~/.config/slack/` | `SLACK_TOKEN` env
3. `probe_vercel` — `which vercel` success + `~/.config/vercel/auth.json` exists
4. `probe_github_cli` — `which gh` success + `hosts.yml` contains oauth_token/github.com (WSL fallback: `gh auth status`)
5. `probe_ai_sessions` — ai_tools contains "claude"/"cursor" OR `~/.claude/projects` | `~/.cursor` exists
6. `probe_calendar` — `~/.config/gcloud/application_default_credentials.json` | `GOOGLE_APPLICATION_CREDENTIALS` env (macOS: `~/Library/Calendars`)

**auto_enable_from_scan orchestrator:**
- Gates on `cfg.onboarded` — skips if user hasn't completed onboarding
- Runs all 6 probes against provided `DeepScanResults`
- Idempotency: existing tentacle with same id has rationale refreshed, not re-pushed
- User-disable protection (ECOSYS-08): `enabled_at > 0 && !enabled` → skip silently
- On first registration: push TentacleRecord, spawn observer loop

**6 observer loop stubs** — each has its own `static RUNNING: AtomicBool`, checks `RUNNING.swap(true, SeqCst)` at entry, polls every 300s, re-reads config to check enabled state, emits `blade_activity_log` event via `emit_activity()` (uses `safe_slice(summary, 200)` per T-13-06).

**4 Tauri commands:** `ecosystem_list_tentacles`, `ecosystem_toggle_tentacle`, `ecosystem_observe_only_check`, `ecosystem_run_auto_enable`

**7 unit tests:** guardrail Err, repo probe triggered, repo probe empty, slack env, AI session claude dir, Vercel no-auth consistency, guardrail-never-cleared.

**lib.rs:** `mod ecosystem;` added after `mod agent_factory;`. 4 commands added to `generate_handler![]`.

**deep_scan/mod.rs:** Non-blocking `tauri::async_runtime::spawn` inserted after the `last_deep_scan` config update block, before the knowledge graph seed — spawns `crate::ecosystem::auto_enable_from_scan`.

## Verification

- `cargo check --lib`: zero errors
- `ecosystem_tentacles` in config.rs: 9 occurrences (≥6 required)
- `ecosystem_observe_only` in config.rs: 9 occurrences (≥6 required)
- `mod ecosystem;` in lib.rs: match found at line 157
- 4 ecosystem commands in lib.rs: confirmed
- `ecosystem::auto_enable_from_scan` in deep_scan/mod.rs: confirmed
- `static RUNNING` in ecosystem.rs: 6 (one per observer loop)
- `OBSERVE_ONLY.load` in ecosystem.rs: 3 occurrences (≥2 required)
- Line count: 499 (≥350 required)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used load_results_pub() instead of private load_results()**
- **Found during:** Task 2 implementation
- **Issue:** The plan's `ecosystem_run_auto_enable` command references `crate::deep_scan::load_results()`, but that function is private (no `pub`) in deep_scan/mod.rs. Only `load_results_pub()` is exported.
- **Fix:** Used `crate::deep_scan::load_results_pub()` in `ecosystem_run_auto_enable` — same function, correct visibility.
- **Files modified:** `src-tauri/src/ecosystem.rs`
- **Commit:** e79bf52

## Known Stubs

The 6 observer loop bodies emit a placeholder `blade_activity_log` event on every 300s tick. They do not yet perform real work (git poll, Slack API, Vercel webhook, GitHub API, Claude session, Calendar API). These are intentional stubs — Wave 2 (Plans 13-02/13-03) wires actual observation logic into each loop. The stubs correctly:
- Guard entry with `RUNNING.swap(true, SeqCst)`
- Re-read config to check `enabled` state before each tick
- Emit activity log events (trust surface for "BLADE is doing…")

## Threat Surface Scan

All STRIDE mitigations from the plan's `<threat_model>` are implemented:

| Threat | Mitigation | Verified |
|--------|-----------|---------|
| T-13-01: EoP write paths | `OBSERVE_ONLY` central check; `assert_observe_only_allowed()` | `grep -c "OBSERVE_ONLY" ecosystem.rs` = 11 |
| T-13-02: EoP re-enable user-disabled | `enabled_at > 0 && !enabled` guard in auto_enable_from_scan | Present at line ~175 |
| T-13-03: Info disclosure hosts.yml/auth.json | Content read into local variable; only `.contains()` used; never logged/emitted | Confirmed in probe_github_cli, probe_vercel |
| T-13-04: Tampering subprocess injection | All `Command::arg()` calls use string literals only | Confirmed in probe_vercel, probe_github_cli |
| T-13-05: DoS observer loop spawn | Per-loop `static RUNNING: AtomicBool`; `swap(true, SeqCst)` early return | 6 guards present |
| T-13-06: Tampering activity log overflow | `crate::safe_slice(summary, 200)` in emit_activity | Confirmed at emit_activity fn |

## Self-Check

### Files exist:
- [x] `src-tauri/src/ecosystem.rs` (499 lines)
- [x] `src-tauri/src/config.rs` (modified — TentacleRecord + 6-place extension)
- [x] `src-tauri/src/lib.rs` (modified — mod ecosystem + 4 commands)
- [x] `src-tauri/src/deep_scan/mod.rs` (modified — auto_enable_from_scan spawn)

### Commits exist:
- [x] 63562e6 — feat(13-01): TentacleRecord struct + ecosystem_tentacles/observe_only 6-place config extension
- [x] e79bf52 — feat(13-01): ecosystem.rs — 6 probes, OBSERVE_ONLY guardrail, auto_enable orchestrator, 6 observer stubs, 4 Tauri commands, 7 unit tests

## Self-Check: PASSED
