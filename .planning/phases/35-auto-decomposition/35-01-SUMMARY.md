---
phase: 35-auto-decomposition
plan: 1
subsystem: config
tags: [config, six-place-rule, substrate, decomposition]
dependency_graph:
  requires:
    - "Phase 34 Plan 34-01 ResilienceConfig + SessionConfig sub-structs (most-recent gold-standard pattern)"
    - "Phase 33 Plan 33-01 LoopConfig sub-struct (adjacent pattern)"
    - "Phase 32 Plan 32-01 ContextConfig sub-struct (adjacent pattern)"
  provides:
    - "BladeConfig.decomposition: DecompositionConfig — 5 DECOMP-01..05 runtime knobs"
    - "Substrate for Plan 35-02 (LoopState.is_subagent + LoopHaltReason::DecompositionComplete + decomposition/ module scaffold), 35-03..11 (DECOMP-01..05 implementations + frontend)"
  affects:
    - "DiskConfig: gains 1 field (decomposition); legacy configs without this key load with defaults via #[serde(default)]"
    - "save_config / load_config: 1 new field copy each (decomposition)"
    - "reward_weights_round_trip test: existing DiskConfig literal extended with decomposition: cfg.decomposition.clone() to preserve compile"
tech_stack:
  added: []
  patterns:
    - "Six-place config rule (CLAUDE.md) — applied ONCE (6 wire-up sites total)"
    - "#[serde(default)] on every new field for backward-compat with legacy configs"
    - "default_* free functions paired with impl Default — mirror ResilienceConfig + SessionConfig + LoopConfig + ContextConfig"
key_files:
  created: []
  modified:
    - "src-tauri/src/config.rs (+86 lines: 1 sub-struct + 5 default fns + 1 impl Default + 6 wire-up sites + 3 tests + 1 reward_weights test fix)"
decisions:
  - "DecompositionConfig declared as adjacent block immediately after SessionConfig::default impl, mirroring the Phase 34-01 placement"
  - "All defaults match 35-CONTEXT.md §Module Boundaries verbatim (auto_decompose_enabled=true, min_steps_to_decompose=5, max_parallel_subagents=3, subagent_isolation=true, subagent_summary_max_tokens=800)"
  - "Six-place rule honored — DiskConfig field, DiskConfig::default body, BladeConfig field, BladeConfig::default body, load_config copy, save_config copy"
  - "Field ordering in DiskConfig + BladeConfig: appended after `session: SessionConfig` to preserve historical Phase order (32 → 33 → 34 → 35)"
  - "auto_decompose_enabled = true by default — phases 32/33/34 ship their escape hatches OFF-by-default-conservative-but-currently-true; aligns with the v1.1 lesson posture (smart path on, fallback path silent)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-06"
---

# Phase 35 Plan 35-01: DecompositionConfig Substrate Summary

Add the typed `DecompositionConfig` sub-struct to `BladeConfig` with the
canonical six-place wire-up rule. The struct carries the 5 runtime knobs for
DECOMP-01..05: `auto_decompose_enabled` (CTX-07-style escape hatch),
`min_steps_to_decompose` (DECOMP-01 trigger threshold), `max_parallel_subagents`
(DECOMP-02 rate limiter), `subagent_isolation` (DECOMP-02 debug toggle), and
`subagent_summary_max_tokens` (DECOMP-03 distillation cap). No behavior change —
this is the pure type substrate every other Phase 35 plan mounts on.

## Six-Place Wire-Up Confirmed

Per the plan's acceptance criteria — all 9 grep counts pass on the post-commit
working tree:

| Grep                                                                                                          | Count |
| ------------------------------------------------------------------------------------------------------------- | ----- |
| `pub struct DecompositionConfig`                                                                              | 1     |
| `decomposition: DecompositionConfig` (4 of: DiskConfig field, DiskConfig::default, BladeConfig field, BladeConfig::default) | 4     |
| `decomposition: disk.decomposition` (load_config)                                                             | 1     |
| `decomposition: config.decomposition.clone()` (save_config)                                                   | 1     |
| `fn default_auto_decompose_enabled`                                                                           | 1     |
| `fn default_min_steps_to_decompose`                                                                           | 1     |
| `fn default_max_parallel_subagents`                                                                           | 1     |
| `fn default_subagent_isolation`                                                                               | 1     |
| `fn default_subagent_summary_max_tokens`                                                                      | 1     |

The six-place rule is honored — 6 places × 1 sub-struct = 6 wire-up sites total.
Substantively identical to the Phase 34-01 ResilienceConfig pattern, applied
once.

## Tests — 3 New, All Green

| Test                                          | Asserts                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `phase35_decomposition_default_values`        | All 5 DECOMP default values match 35-CONTEXT.md §Module Boundaries     |
| `phase35_decomposition_config_round_trip`     | Non-default DecompositionConfig survives serde via DiskConfig          |
| `phase35_decomposition_missing_uses_defaults` | Legacy config.json without `decomposition` key loads with defaults     |

```
running 4 tests
test config::tests::phase35_decomposition_default_values ... ok
test decomposition::executor::tests::phase35_decomposition_error_serde_roundtrip ... ok
test config::tests::phase35_decomposition_missing_uses_defaults ... ok
test config::tests::phase35_decomposition_config_round_trip ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 697 filtered out
```

(The fourth test in the matched set — `phase35_decomposition_error_serde_roundtrip` —
is not part of 35-01 scope; it lives in `decomposition::executor::tests` and was
landed by Plan 35-02's parallel scaffold work. Listed here because it shares the
`phase35_decomposition` substring filter; 35-01 owns only the three
`config::tests::phase35_decomposition_*` rows.)

`cargo check` clean (warnings only — all pre-existing or from Plan 35-02's
not-yet-wired-up scaffold of `decomposition/{mod,planner,executor,summary}.rs`;
none introduced by 35-01).

## Test-Mod Visibility

The existing `mod tests { ... }` block already had `use super::*;` (verified
indirectly by the working phase34_resilience/session_config tests in the same
module). DecompositionConfig + DiskConfig + BladeConfig +
DecompositionConfig::default were all reachable from the new tests without any
additional imports — same posture as Phase 34-01.

## Interactions with Adjacent Wire-Ups

ContextConfig (Phase 32-01), LoopConfig (Phase 33-01), ResilienceConfig (Phase
34-01), SessionConfig (Phase 34-01) live as adjacent blocks immediately above
the new DecompositionConfig declaration. The five sub-structs are independent —
nothing in 35-01 reads or writes the prior four. The DiskConfig::default and
BladeConfig::default Self literals now carry five sub-struct initializers each
(`context`, `r#loop`, `resilience`, `session`, `decomposition`); the load_config
and save_config copies carry the same five pairs.

One incidental fix landed in the existing `reward_weights_round_trip` test: it
hand-builds a complete `DiskConfig { ... }` literal for serde round-trip
coverage, so adding one required field to DiskConfig forced the literal to gain
`decomposition: cfg.decomposition.clone()` or fail to compile (E0063). The fix
is mechanical and preserves the test's original purpose. Same pattern Phase
34-01 hit when adding `resilience` + `session`.

## Coexistence with Plan 35-02 (parallel wave)

Plan 35-02 (LoopState `is_subagent` flag + `LoopHaltReason::DecompositionComplete`
variant + `decomposition/{mod,planner,executor,summary}.rs` module scaffold) ran
in parallel in the same working tree. The two plans had **zero file overlap** —
35-01 owns only `src-tauri/src/config.rs`; 35-02 owns `lib.rs`, `loop_engine.rs`,
and the new `decomposition/` directory. Both commits landed cleanly without
either plan needing to wait or rebase.

The `decomposition::executor::DecompositionError` type and friends in 35-02's
scaffold do not yet read `BladeConfig.decomposition` — they will be wired in
Plans 35-04 (DECOMP-01 trigger) and 35-05 (DECOMP-02 dispatch). 35-01's job
ends at the type substrate.

## Deviations

### [Rule 3 — Blocking issue auto-fix] Existing `reward_weights_round_trip` test required `decomposition` field

**Found during:** Task 1 verify step (`cargo test --lib phase35_decomposition`).

**Issue:** Existing test `reward_weights_round_trip` (config.rs:1860) hand-builds
a complete `DiskConfig { ... }` literal. Adding the new required `decomposition`
field to DiskConfig caused E0063 ("missing field `decomposition` in initializer
of `config::DiskConfig`") on the test's literal.

**Fix:** Append `decomposition: cfg.decomposition.clone(),` to the literal at
line 1933 (immediately after `session: cfg.session.clone(),`), mirroring the
shape Phase 34-01 used when adding `resilience` + `session` to the same literal.

**Files modified:** `src-tauri/src/config.rs` (single-line addition inside the
existing test, no semantic change to the test's purpose).

**Commit:** `8959f69` (rolled into the GREEN commit alongside the substrate +
6-place wiring + 3 phase35 tests).

## Self-Check: PASSED

- [x] `pub struct DecompositionConfig` exists in `/home/arnav/blade/src-tauri/src/config.rs` (1 hit)
- [x] All 9 grep acceptance counts match the plan spec (verified post-commit)
- [x] All 3 phase35_decomposition_* tests pass: `cargo test --lib phase35_decomposition` exit 0, 3 passed / 0 failed (plus 1 from 35-02's scaffold also green)
- [x] `cargo check` exit 0 with no errors (warnings only, all pre-existing or from parallel 35-02 scaffold)
- [x] Commits `0c90cde` (RED — failing tests) and `8959f69` (GREEN — substrate + wiring + reward_weights fix) on master
- [x] No new top-level Rust modules created in 35-01 (decomposition/ arrives in Plan 35-02 — landed parallel)
- [x] No behavior change — `config.decomposition` is read by zero call sites in this plan (35-04 + 35-05 will wire the read paths)
- [x] No accidental file deletions (verified `git diff --diff-filter=D --name-only HEAD~1 HEAD` empty)
- [x] Six-place rule satisfied (verified by 6 grep counts: 4 fields + 1 load_config + 1 save_config)

## Plan Links

- This plan: `/home/arnav/blade/.planning/phases/35-auto-decomposition/35-01-PLAN.md`
- Pattern reference (gold standard, most-recent): `/home/arnav/blade/.planning/phases/34-resilience-session/34-01-PLAN.md` (ResilienceConfig + SessionConfig — 12-place wire-up, applied twice)
- Pattern reference: `/home/arnav/blade/.planning/phases/33-agentic-loop/33-01-PLAN.md` (LoopConfig — six-place applied once)
- Pattern reference: `/home/arnav/blade/.planning/phases/32-context-management/32-01-PLAN.md` (ContextConfig — six-place applied once)
- Phase context: `/home/arnav/blade/.planning/phases/35-auto-decomposition/35-CONTEXT.md` §Module Boundaries (locked field list + defaults)
- Phase research: `/home/arnav/blade/.planning/phases/35-auto-decomposition/35-RESEARCH.md` §Implementation Sketches/DecompositionConfig (verbatim struct declaration + six-place wire-up enumeration)

### Downstream plans that consume this substrate

- Plan 35-02 — LoopState `is_subagent` + LoopHaltReason::DecompositionComplete + decomposition/ module scaffold (parallel, landed alongside 35-01)
- Plan 35-03 — DECOMP-01 step counter heuristic (`count_independent_steps_grouped`) + role selection
- Plan 35-04 — DECOMP-01 run_loop pre-iteration trigger (reads `config.decomposition.auto_decompose_enabled` + `min_steps_to_decompose`)
- Plan 35-05 — DECOMP-02 `execute_decomposed_task` body + `spawn_isolated_subagent` (reads `config.decomposition.max_parallel_subagents` + `subagent_isolation`)
- Plan 35-06 — DECOMP-03 `distill_subagent_summary` body (reads `config.decomposition.subagent_summary_max_tokens`)
- Plan 35-07 — DECOMP-02 sub-agent dispatch wiring + LoopHaltReason::DecompositionComplete match arm + full-pipeline integration test
- Plan 35-08 — DECOMP-04 `merge_fork_back` Tauri command + MergeResult + JSONL append helpers
- Plan 35-09 — DECOMP-05 BladeLoopEventPayload subagent variants + mergeForkBack typed wrapper
- Plan 35-10 — DECOMP-04 SessionsView Merge-back UI + DECOMP-05 ActivityStrip subagent chips
- Plan 35-11 — Phase-wide closure with panic-injection regression + checkpoint:human-verify 15-step UAT
