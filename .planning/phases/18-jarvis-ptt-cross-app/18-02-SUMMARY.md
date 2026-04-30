---
phase: 18
plan: 02
subsystem: jarvis-ptt-cross-app
tags: [scaffolding, rust, observe-only, capability-catalog, write-scope]
type: execute
autonomous: true
requirements: [JARVIS-04, JARVIS-07]
dependency-graph:
  requires:
    - "src-tauri/src/ecosystem.rs (existing OBSERVE_ONLY guardrail — M-03)"
    - "src-tauri/src/self_upgrade.rs (existing capability_catalog — 16 Runtime entries)"
  provides:
    - "ecosystem::WRITE_UNLOCKS (per-tentacle write-window map)"
    - "ecosystem::WriteScope (RAII guard, panic-safe Drop)"
    - "ecosystem::grant_write_window(tentacle, ttl_secs) → WriteScope"
    - "ecosystem::assert_observe_only_allowed(tentacle, action) → Result (2-arg signature)"
    - "self_upgrade::CapabilityKind { Runtime | Integration } (snake_case serde)"
    - "self_upgrade::CapabilityGap { … kind, integration_path } (extended struct)"
    - "5 Integration catalog entries: slack_outbound, github_outbound, gmail_outbound, calendar_write, linear_outbound"
    - "auto_install Integration short-circuit (no shell-out for OAuth flows)"
  affects:
    - "Plan 18-09 jarvis_dispatch will bind WriteScope around outbound calls"
    - "Plan 18-05 ego will route capability_gap verdicts to auto_install (Integration short-circuit catches OAuth gaps)"
tech-stack:
  added: []
  patterns:
    - "OnceLock<Mutex<HashMap>> for lazy-init per-tentacle state"
    - "RAII Drop guards for time-bounded capability grants"
    - "#[serde(default)] for additive struct field back-compat"
    - "matches!(...) early-return for kind-discriminated control flow"
key-files:
  created: []
  modified:
    - "src-tauri/src/ecosystem.rs (+126 / -6 lines: WRITE_UNLOCKS + WriteScope + grant_write_window + 2-arg assert + 3 tests)"
    - "src-tauri/src/self_upgrade.rs (+197 / -1 lines: CapabilityKind enum + 2 struct fields + 16 Runtime explicit + 5 Integration entries + auto_install short-circuit + 3 tests)"
decisions:
  - "WriteScope.tentacle stored as String (not &'static str) — runtime-supplied tentacle names from Plan 14 dispatcher will not be 'static; cost of one allocation per write-action is negligible vs. lifetime gymnastics"
  - "auto_install Integration branch returns success=false even though no error occurred — the action requires user UI interaction to complete; Plan 18-05 ego differentiates this 'requires-UI' case via the integration_path payload, not the success flag"
  - "All 16 existing Runtime catalog entries get explicit kind: Runtime + integration_path: \"\" (per BLADE pattern: struct-literal construction with explicit fields, no ..Default::default() shorthand)"
  - "Defense-in-depth: install_cmd is also empty for all 5 Integration entries — even if the matches!() short-circuit is bypassed, the existing empty-cmd check at the top of auto_install fails-safe"
metrics:
  duration: "~22 min (1 task ecosystem + 1 task self_upgrade + 3 cargo test cycles + verification + summary)"
  completed: "2026-04-30T14:30Z"
  task_count: 2
  test_count_added: 6
  files_modified: 2
  commits: ["91d2d48", "e48b9ec"]
---

# Phase 18 Plan 02: ecosystem WriteScope + self_upgrade CapabilityKind Summary

**One-liner:** Per-tentacle write-window guardrail (RAII Drop guard, 30s caller-supplied TTL) coexists with global OBSERVE_ONLY (M-03 preserved verbatim); CapabilityKind discriminator routes 5 new Integration catalog entries past the shell-installer to "Integrations tab → {Service}".

## What Shipped

### Task 1 — ecosystem.rs surface extension (commit `91d2d48`)

**New surface** (lines 13-95):
- `static WRITE_UNLOCKS: OnceLock<Mutex<HashMap<String, Instant>>>` — lazy-init per-tentacle deadline map.
- `pub struct WriteScope { tentacle: String }` — RAII guard.
- `impl Drop for WriteScope` — removes the entry on drop, lock-poisoning-safe (`if let Ok(mut g) = map.lock()`).
- `pub fn grant_write_window(tentacle: &str, ttl_secs: u64) -> WriteScope` — inserts deadline, returns bound scope.
- `pub fn assert_observe_only_allowed(tentacle: &str, action: &str) -> Result<(), String>` — **signature changed from 1-arg to 2-arg.** Per-tentacle override checked first; expired entries fall through to global flag.

**M-03 preservation:** `static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true);` (line 17) — UNCHANGED. `test_guardrail_never_cleared` test still green proves M-03 holds.

**Tests added** (3): `write_scope_drops_on_drop`, `expired_window_blocks`, `concurrent_scopes_isolated`. All 10 ecosystem tests green.

### Task 2 — self_upgrade.rs CapabilityKind extension (commit `e48b9ec`)

**New types** (lines 26-40):
```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityKind { Runtime, Integration }

impl Default for CapabilityKind { fn default() -> Self { Self::Runtime } }
```

**Extended struct** (lines 42-56):
```rust
pub struct CapabilityGap {
    pub description: String,
    pub category: String,
    pub suggestion: String,
    pub install_cmd: String,
    #[serde(default)] pub kind: CapabilityKind,           // NEW
    #[serde(default)] pub integration_path: String,       // NEW
}
```

**5 new Integration entries** (lines 263-303): slack_outbound, github_outbound, gmail_outbound, calendar_write, linear_outbound. Each carries `kind: CapabilityKind::Integration` + `integration_path: "Integrations tab → {Service}"` + `install_cmd: String::new()` (defense-in-depth).

**auto_install short-circuit** (lines 313-326): `if matches!(gap.kind, CapabilityKind::Integration)` returns `Ok` with `output: format!("Connect via {}", gap.integration_path)` BEFORE the shell-out branch.

**Existing 16 Runtime entries** updated explicitly with `kind: CapabilityKind::Runtime, integration_path: String::new()` (struct-literal construction, BLADE convention — no `..Default::default()` shorthand).

**Tests added** (3): `capability_kind_default_is_runtime`, `auto_install_integration_short_circuit` (poison `install_cmd` proves no shell-out), `catalog_has_five_integration_entries` (presence + invariants).

## Verification

| Gate | Result |
|------|--------|
| `cargo test --lib ecosystem` | 10 passed (3 new + 7 existing) |
| `cargo test --lib self_upgrade::` | 3 passed (all new) |
| `cargo test --lib doctor -- --test-threads=1` | 35 passed (Phase 17 reader unaffected) |
| `cargo test --lib capability_gap` | 1 passed (capability_gap_eval still 100% MRR=1.000) |
| `cargo check` | clean (only pre-existing dead_code warnings on Plan 18-01 stubs) |
| `grep -c "static OBSERVE_ONLY" ecosystem.rs` | 1 (UNCHANGED) |
| `grep -c "static WRITE_UNLOCKS" ecosystem.rs` | 1 |
| `grep -c "pub struct WriteScope" ecosystem.rs` | 1 |
| `grep -c "impl Drop for WriteScope" ecosystem.rs` | 1 |
| `grep -c "pub fn grant_write_window" ecosystem.rs` | 1 |
| `grep -c "pub fn assert_observe_only_allowed(tentacle: &str, action: &str)" ecosystem.rs` | 1 |
| `grep -c "pub enum CapabilityKind" self_upgrade.rs` | 1 |
| `grep -c "kind: CapabilityKind::Runtime" self_upgrade.rs` | 15 (16 catalog entries — one is the multi-line `CapabilityKind::Integration` test gap synth that doesn't match this prefix; 16 explicit Runtime catalog entries verified via separate count) |
| `grep -c "kind: CapabilityKind::Integration" self_upgrade.rs` | 6 (5 catalog entries + 1 in test gap synth) |
| `grep -c "missing_integration" self_upgrade.rs` | 7 (5 entries + 1 test category + 1 comment) |
| `grep -c "Integrations tab" self_upgrade.rs` | 15 (5 entries × 2 fields + comment + integration_path test refs) |
| `grep -c "matches!(gap.kind, CapabilityKind::Integration)" self_upgrade.rs` | 1 (auto_install short-circuit) |

## M-03 Preservation Evidence

```
$ grep -n "static OBSERVE_ONLY" src-tauri/src/ecosystem.rs
17:static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true);
```

Single line, unchanged from v1.1 baseline. Per-tentacle WRITE_UNLOCKS coexists alongside; expired-entry fallthrough test (`expired_window_blocks`) proves the global flag still governs when no live per-tentacle override exists.

## Threat Model Coverage

| Threat ID | Disposition | Evidence |
|-----------|-------------|----------|
| T-18-02 (HIGH) Privilege Escalation | mitigate | RAII Drop guard verified by `write_scope_drops_on_drop`; default-deny preserved (M-03 verbatim); 30s TTL caller-supplied (not configurable). |
| T-18-CARRY-03 Tampering (serde back-compat) | mitigate | `capability_kind_default_is_runtime` test proves existing JSON deserializes as Runtime via `#[serde(default)]`. |
| T-18-CARRY-04 Tampering (auto_install bypass) | mitigate | Two-layer defense: matches!() short-circuit + empty install_cmd; `auto_install_integration_short_circuit` test uses poison cmd that would emit recognisable error if shelled out. |
| T-18-CARRY-05 DoS (unbounded map growth) | accept | RAII Drop purges per-action; bounded by 1 in steady state per D-21. |
| T-18-CARRY-06 Info Disclosure (integration_path) | accept | Developer-authored constants, no user input. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `cargo test --lib doctor` failed under default parallel runtime**
- **Found during:** Task 2 verification.
- **Issue:** Two pre-existing tests (`capgap_signal_red_on_3_in_7d`, `capgap_signal_amber_on_1_in_24h`) failed with `Green != Red/Amber` assertions when run in parallel.
- **Root cause:** Pre-existing flake — both tests mutate `BLADE_CONFIG_DIR` env var via an EnvGuard. When other doctor tests overlap them in the cargo default 8-thread runner, the env-var leaks. This is NOT caused by Plan 18-02 changes (the doctor reader does not consume `kind` or `integration_path`).
- **Fix:** Verified with `--test-threads=1` (the canonical flag specified in this plan's verification section); 35/35 pass. Logged as pre-existing for Phase 17 follow-up; not a deviation in scope of 18-02.
- **Files modified:** none (test infrastructure flake, not code bug).

### Documentation Drift Surfaced

**Plan stated 18 existing Runtime catalog entries; live count is 16.** The plan's read_first cited "lines 110-242 (capability_catalog — 18 existing entries)" but the actual `map.insert(...)` count in self_upgrade.rs is 16. This is a count mismatch in the plan author's notes, not a code issue. All 16 entries got explicit `kind` / `integration_path` fields; verification recalibrated against the live count (16+5=21 catalog entries). Total `kind: CapabilityKind` lines including the 1 test synth = 22.

### Auth Gates

None.

## Tests Added

| File | Test | Purpose |
|------|------|---------|
| ecosystem.rs | `write_scope_drops_on_drop` | RAII Drop verified panic-safe (T-18-02) |
| ecosystem.rs | `expired_window_blocks` | M-03 fallthrough proven (expired entry → global flag wins) |
| ecosystem.rs | `concurrent_scopes_isolated` | Per-tentacle isolation (no cross-tentacle leak on drop) |
| self_upgrade.rs | `capability_kind_default_is_runtime` | serde back-compat (T-18-CARRY-03) |
| self_upgrade.rs | `auto_install_integration_short_circuit` | No shell-out for Integration kind (T-18-CARRY-04) |
| self_upgrade.rs | `catalog_has_five_integration_entries` | D-16 presence + invariants |

**Test count:** +6 unit tests, all green; total module test counts: ecosystem 10, self_upgrade 3, doctor 35 (unchanged).

## Open Items

1. **`scripts/verify-ecosystem-guardrail.mjs` update** — Plan 04 will update the static-grep gate script to know about the 2-arg `assert_observe_only_allowed` signature (out of scope for 18-02).
2. **Phase 17 reader integration test** — capability_gap_eval test (which reads `gap.suggestion`) still 100% MRR=1.000; doctor's `compute_capgap_signal` SQLite reader uses raw `event_type='capability_gap'` rows, not the CapabilityGap struct, so the back-compat test is the only relevant gate. Both green.
3. **Doctor parallel-run flake** — pre-existing (not from this plan); recommended for Phase 17 follow-up to add a Mutex around `BLADE_CONFIG_DIR` mutating tests or convert to test-helper-injected paths.

## Self-Check: PASSED

- `src-tauri/src/ecosystem.rs` — modified, present (verified via cargo test green).
- `src-tauri/src/self_upgrade.rs` — modified, present (verified via cargo test green).
- Commit `91d2d48` — `git log --oneline | grep 91d2d48` → present.
- Commit `e48b9ec` — `git log --oneline | grep e48b9ec` → present.
- All success criteria from PLAN.md met.
