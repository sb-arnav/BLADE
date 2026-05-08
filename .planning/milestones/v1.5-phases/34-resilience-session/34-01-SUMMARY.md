---
phase: 34-resilience-session
plan: 1
subsystem: config
tags: [config, six-place-rule, substrate, resilience, session]
dependency_graph:
  requires:
    - "Phase 33 Plan 33-01 LoopConfig sub-struct (gold-standard pattern)"
    - "Phase 32 Plan 32-01 ContextConfig sub-struct (adjacent pattern)"
    - "config.rs::blade_config_dir() (used by default_jsonl_log_dir)"
  provides:
    - "BladeConfig.resilience: ResilienceConfig — 12 RES-01..05 runtime knobs"
    - "BladeConfig.session: SessionConfig — 4 SESS-01..04 persistence knobs"
    - "Substrate for Plan 34-02 (LoopState extension), 34-03 (resilience/ + session/ module skeleton), 34-04..10 (RES-01..05 + SESS-01..04 implementations)"
  affects:
    - "DiskConfig: gains 2 fields (resilience, session); legacy configs without these keys load with defaults via #[serde(default)]"
    - "save_config / load_config: 2 new field copies each (resilience, session)"
    - "reward_weights_round_trip test: existing DiskConfig literal extended with resilience + session to preserve compile"
tech_stack:
  added: []
  patterns:
    - "Six-place config rule (CLAUDE.md) — applied TWICE (12 wire-up sites total)"
    - "#[serde(default)] on every new field for backward-compat with legacy configs"
    - "default_* free functions paired with impl Default — mirror LoopConfig + ContextConfig"
key_files:
  created: []
  modified:
    - "src-tauri/src/config.rs (+303 lines: 2 sub-structs + 12 default fns + 2 impl Default + 12 wire-up sites + 6 tests + 1 reward_weights test fix)"
decisions:
  - "ResilienceConfig + SessionConfig declared as adjacent blocks immediately after LoopConfig::validate(), mirroring the Phase 33-01 placement"
  - "All defaults match 34-CONTEXT.md §Module Boundaries verbatim (12 RES + 4 SESS = 16 locked values)"
  - "Six-place rule honored TWICE — DiskConfig field, DiskConfig::default body, BladeConfig field, BladeConfig::default body, load_config copy, save_config copy (per struct = 12 sites total)"
  - "blade_config_dir() called from default_jsonl_log_dir() — same indirection pattern Phase 33 uses for path-flavoured defaults"
  - "PathBuf import already present at config.rs:6 — no new use statement needed"
metrics:
  duration: "~30 minutes (including parallel-agent coordination resolution)"
  completed: "2026-05-06"
---

# Phase 34 Plan 34-01: ResilienceConfig + SessionConfig Substrate Summary

Add two typed sub-structs to `BladeConfig` with the canonical six-place wire-up
rule applied twice: `ResilienceConfig` carries the 12 runtime knobs for
RES-01..05 (smart-resilience escape hatch, 5 stuck thresholds, circuit breaker
threshold, per-conversation cost cap, provider fallback chain, retries +
exponential backoff), and `SessionConfig` carries the 4 SESS-01..04 knobs
(JSONL log toggle, log directory, auto-resume, rotation). No behavior change —
this is the pure type substrate every other Phase 34 plan mounts on.

## Twelve-Place Wire-Up Confirmed

Per the plan's acceptance criteria — all 11 grep counts pass on the post-commit
working tree:

| Grep                                                       | Count |
| ---------------------------------------------------------- | ----- |
| `pub struct ResilienceConfig`                              | 1     |
| `pub struct SessionConfig`                                 | 1     |
| `resilience: ResilienceConfig` (4 of: DiskConfig field, DiskConfig::default, BladeConfig field, BladeConfig::default) | 4 |
| `session: SessionConfig` (same 4 sites)                    | 4     |
| `resilience: disk.resilience` (load_config)                | 1     |
| `resilience: config.resilience.clone()` (save_config)      | 1     |
| `session: disk.session` (load_config)                      | 1     |
| `session: config.session.clone()` (save_config)            | 1     |
| `fn default_smart_resilience_enabled`                      | 1     |
| `fn default_jsonl_log_enabled`                             | 1     |
| `fn default_provider_fallback_chain`                       | 1     |

The six-place rule is honored independently for each new sub-struct — 6 places
× 2 sub-structs = 12 wire-up sites total. Substantively identical to the
Phase 33-01 LoopConfig pattern, applied twice.

## Tests — 6 New, All Green

| Test                                          | Asserts                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `phase34_resilience_config_default_values`    | All 12 RES default values match 34-CONTEXT.md §Module Boundaries       |
| `phase34_session_config_default_values`       | All 4 SESS default values (incl. `auto_resume_last=false` per v1.1 lesson) |
| `phase34_resilience_config_round_trip`        | Non-default ResilienceConfig survives serde via DiskConfig             |
| `phase34_session_config_round_trip`           | Non-default SessionConfig survives serde via DiskConfig                |
| `phase34_resilience_missing_uses_defaults`    | Legacy config.json without `resilience` key loads with defaults        |
| `phase34_session_missing_uses_defaults`       | Legacy config.json without `session` key loads with defaults           |

```
running 22 tests
test config::tests::phase34_resilience_config_default_values ... ok
test config::tests::phase34_resilience_config_round_trip ... ok
test config::tests::phase34_resilience_missing_uses_defaults ... ok
test config::tests::phase34_session_config_default_values ... ok
test config::tests::phase34_session_config_round_trip ... ok
test config::tests::phase34_session_missing_uses_defaults ... ok
... (16 prior config tests also green — phase11/32/33 + reward_weights + scan_classes + keyring)
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 578 filtered out
```

`cargo check` clean (warnings only — all pre-existing or from parallel
Plan 34-02 work; none introduced by 34-01).

## Test-Mod Visibility

The existing `mod tests { ... }` block already had `use super::*;` (verified
indirectly by the working phase33_loop_config tests in the same module).
ResilienceConfig + SessionConfig + DiskConfig + BladeConfig + blade_config_dir
+ ResilienceConfig::default + SessionConfig::default were all reachable from
the new tests without any additional imports.

## Interactions with Adjacent Wire-Ups

ContextConfig (Phase 32-01) and LoopConfig (Phase 33-01) live as adjacent
blocks immediately above the new ResilienceConfig + SessionConfig declarations.
The four sub-structs are independent — nothing in 34-01 reads or writes the
prior two. The DiskConfig::default and BladeConfig::default Self literals now
carry four sub-struct initializers each (`context`, `r#loop`, `resilience`,
`session`); the load_config and save_config copies carry the same four pairs.

One incidental fix landed in the existing `reward_weights_round_trip` test: it
hand-builds a complete `DiskConfig { ... }` literal for serde round-trip
coverage, so adding two required fields to DiskConfig forced the literal to
gain `resilience: cfg.resilience.clone()` and `session: cfg.session.clone()`
or fail to compile (E0063). The fix is mechanical and preserves the test's
original purpose.

## Deviations

### [Rule N/A — Coordination Reality] Commit attribution collapsed under Plan 34-02

**Found during:** Final commit step.

**What happened:** Plan 34-02 (LoopHaltReason + LoopState extension) was
running in parallel in the same working tree. Plan 34-02's commit `45c0dfe`
("feat(34-02): extend LoopHaltReason with Stuck + CircuitOpen + CostScope
substrate") was created with `git add` semantics that swept my uncommitted
`src-tauri/src/config.rs` diff into 34-02's commit alongside its own
`commands.rs` + `loop_engine.rs` changes. The commit message therefore lists
"34-02" but the diff includes 34-01's ResilienceConfig + SessionConfig
substrate (303 lines: 2 sub-structs + 12 wire-up sites + 6 tests + the
reward_weights test fix).

**Why I did not rewrite history:** Per the executor's destructive-git
prohibition + the orchestrator's "don't touch loop_engine.rs or types it
owns" boundary, splitting `45c0dfe` would require either `git rebase -i`
(blocked — interactive flag) or `git reset --hard + cherry-pick` (destructive
on a parallel agent's just-landed work). The substance landed correctly on
master; only the commit-message label is wrong.

**Files modified:** `src-tauri/src/config.rs` (the 303-line 34-01 substrate
landed inside commit `45c0dfe`, not as a separate 34-01 commit).

**Verification:** `git show 45c0dfe -- src-tauri/src/config.rs | grep
"^+pub struct ResilienceConfig\|^+pub struct SessionConfig"` returns 2 hits;
all 6 phase34 tests pass on the resulting tree; cargo check clean.

**Commit hash for traceability:** `45c0dfe` (carries 34-01 substrate +
34-02 LoopHaltReason work).

## Self-Check: PASSED

- [x] `pub struct ResilienceConfig` exists in `/home/arnav/blade/src-tauri/src/config.rs` (1 hit)
- [x] `pub struct SessionConfig` exists in `/home/arnav/blade/src-tauri/src/config.rs` (1 hit)
- [x] All 11 grep acceptance counts match the plan spec (verified post-commit)
- [x] All 6 phase34 tests pass: `cargo test --lib config::tests::phase34` exit 0, 6 passed / 0 failed
- [x] All 22 config tests pass (no regression on phase11/32/33 + reward_weights + scan_classes + keyring)
- [x] `cargo check` exit 0 with no errors (warnings only, all pre-existing or from parallel 34-02 work)
- [x] Commit `45c0dfe` on master carries the 34-01 substrate diff (verified via `git show 45c0dfe -- src-tauri/src/config.rs`)
- [x] No new top-level Rust modules created (resilience/ + session/ arrive in Plan 34-03)
- [x] No behavior change — `config.resilience` and `config.session` are read by zero call sites in this plan

## Plan Links

- This plan: `/home/arnav/blade/.planning/phases/34-resilience-session/34-01-PLAN.md`
- Pattern reference: `/home/arnav/blade/.planning/phases/33-agentic-loop/33-01-PLAN.md` (LoopConfig — gold standard)
- Pattern reference: `/home/arnav/blade/.planning/phases/32-context-management/32-01-PLAN.md` (ContextConfig — adjacent block)
- Phase context: `/home/arnav/blade/.planning/phases/34-resilience-session/34-CONTEXT.md` §Module Boundaries (locked field list + defaults)
- Phase research: `/home/arnav/blade/.planning/phases/34-resilience-session/34-RESEARCH.md` §Implementation Sketches (verbatim struct declarations)

### Downstream plans that consume this substrate

- Plan 34-02 — LoopState extension + LoopHaltReason variants (already landed in commit `45c0dfe` alongside this plan's substrate)
- Plan 34-03 — `resilience/` + `session/` module skeleton (consumes the typed config fields)
- Plan 34-04 — RES-01 stuck detector (reads ResilienceConfig.smart_resilience_enabled, stuck_detection_enabled, recent_actions_window, monologue_threshold, compaction_thrash_threshold, no_progress_threshold)
- Plan 34-05 — RES-02 circuit breaker (reads ResilienceConfig.circuit_breaker_threshold)
- Plan 34-06 — RES-03 + RES-04 cost tracking (reads ResilienceConfig.cost_guard_per_conversation_dollars)
- Plan 34-07 — RES-05 provider fallback (reads ResilienceConfig.provider_fallback_chain, max_retries_per_provider, backoff_base_ms, backoff_max_ms)
- Plan 34-08..10 — SESS-01..04 (reads SessionConfig.jsonl_log_enabled, jsonl_log_dir, auto_resume_last, keep_n_sessions)
- Plan 34-11 — frontend (consumes via the 4 new Tauri commands that 34-08..10 will register)
