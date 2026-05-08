---
phase: 37-intelligence-eval
plan: 7
subsystem: intelligence-eval
tags: [verify-gate, intelligence-eval, eval-05, kill-switch, ctx-07-pattern]
requires:
  - "scripts/verify-organism.sh (Phase 30 / OEVAL-01..05 template)"
  - "src-tauri/src/evals/intelligence_eval.rs (26 fixtures from Plans 37-03..37-06)"
  - "Phase 37 CONTEXT lock §verify-intelligence.sh Gate (script body shape)"
provides:
  - "scripts/verify-intelligence.sh (38th verify gate)"
  - "BLADE_INTELLIGENCE_EVAL=false escape hatch (CTX-07 8th application)"
  - "phase37_eval_05_verify_intelligence_short_circuits_when_disabled regression test"
  - "verify:all chain extension 37 -> 38 gates"
affects:
  - "package.json scripts block + verify:all chain"
  - "CI surface (Phase 30 GitHub Actions precedent picks up new gate automatically)"
tech-stack:
  added: []
  patterns:
    - "Phase 30 OEVAL verify-script structural template (set -uo pipefail, cargo test --quiet, U+250C delimiter check, exit-code triage)"
    - "CTX-07 env-var kill-switch pattern at top-of-script (mirrors Phase 36-09 hormone gate posture)"
    - "std::process::Command shell-out from cargo test for end-to-end script contract enforcement"
key-files:
  created:
    - "scripts/verify-intelligence.sh"
  modified:
    - "package.json"
    - "src-tauri/src/evals/intelligence_eval.rs"
decisions:
  - "Script body is verbatim copy of CONTEXT lock §verify-intelligence.sh Gate (no improvisation; deterministic CI surface)"
  - "Skip block placed AFTER set -uo pipefail and BEFORE cargo PATH check (env-var kill-switch is the load-bearing CTX-07 contract)"
  - "Integration test placed in EVAL-05 banner section at end of intelligence_eval.rs (parallel to EVAL-04 panic-injection regression structure)"
  - "Test resolves workspace_root via parent of CARGO_MANIFEST_DIR (src-tauri parent = repo root) — works regardless of cwd at test time"
metrics:
  duration: "~10 minutes (mostly cargo test compile + run time)"
  completed: "2026-05-08"
---

# Phase 37 Plan 7: verify-intelligence.sh (38th Gate) Summary

38th verify gate `scripts/verify-intelligence.sh` mirrors `verify-organism.sh` verbatim with module/log-prefix swaps and the CONTEXT-locked `BLADE_INTELLIGENCE_EVAL=false` escape hatch (8th application of v1.1 lesson); `package.json` `verify:all` chain grows 37 → 38; one integration test locks the skip-path contract.

## What Landed

### scripts/verify-intelligence.sh (50 lines, mode 0755)

- Body shape locked verbatim against CONTEXT §verify-intelligence.sh Gate.
- Module-name swap: `organism` → `intelligence` (4 places).
- Log-prefix swap: `[verify-organism]` → `[verify-intelligence]` (4 places).
- Cargo test target: `evals::organism_eval` → `evals::intelligence_eval`.
- Comment swap: "Phase 30 / OEVAL-01..05" → "Phase 37 / EVAL-01..05"; "MODULE_FLOOR = 1.0" preserved.
- Comment swap: "shares global VITALITY + PHYSIOLOGY state" → "shares EVAL_FORCE_PROVIDER thread_local + LAST_BREAKDOWN process-global + BLADE_CONFIG_DIR env-var state".
- Comment swap: "13 deterministic fixtures" → "26 deterministic fixtures".
- NEW (delta vs verify-organism.sh): `BLADE_INTELLIGENCE_EVAL=false` short-circuit between `set -uo pipefail` and the cargo PATH check. Default treats unset as `"true"`.

### package.json wire-up

- Line 48 (after the existing `"verify:organism"` line): inserted `"verify:intelligence": "bash scripts/verify-intelligence.sh",`.
- Line 49 (`verify:all` chain): appended ` && npm run verify:intelligence` to the END of the chain.
- Verified counts: `grep -o "npm run verify:" package.json | wc -l` → **38** (was 37); `grep -o "&& npm run" package.json | wc -l` → **37** (was 36 — chain links = gates − 1).
- JSON syntax validated via `node -e "JSON.parse(require('fs').readFileSync('package.json'))"` → OK.

### src-tauri/src/evals/intelligence_eval.rs +56 LOC

- Added `// ── EVAL-05: Verify gate regression ──` banner section at end (after EVAL-04 panic-injection regression).
- New `#[test] phase37_eval_05_verify_intelligence_short_circuits_when_disabled`:
  - Resolves `workspace_root = parent(CARGO_MANIFEST_DIR)` (avoids cwd-dependence).
  - Asserts `script_path.exists()` before shelling out.
  - Spawns `bash <script>` with `BLADE_INTELLIGENCE_EVAL=false` in child env, cwd at workspace_root.
  - Asserts `output.status.success()` (exit 0).
  - Asserts `stdout.contains("[verify-intelligence] SKIP")`.

## Verification Evidence

### bash scripts/verify-intelligence.sh (default path)

```
[verify-intelligence] OK -- all intelligence eval scenarios passed
```
Exit code: **0**. EVAL-06 box-drawing table delimiter check satisfied (TABLE_COUNT=2 internally — 2 driver tables emitted by intelligence_eval cargo test output).

### BLADE_INTELLIGENCE_EVAL=false bash scripts/verify-intelligence.sh (skip path)

```
[verify-intelligence] SKIP -- disabled via BLADE_INTELLIGENCE_EVAL=false
```
Exit code: **0**. No cargo invocation; pure env-gate short-circuit.

### npm run verify:intelligence (npm wrapper)

```
> verify:intelligence
> bash scripts/verify-intelligence.sh

[verify-intelligence] OK -- all intelligence eval scenarios passed
```
Exit code: **0**.

### cargo test --lib evals::intelligence_eval (full suite)

```
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 810 filtered out; finished in 10.95s
```
12 tests = 11 prior (10 EVAL-01 fixtures + EVAL-04 panic-injection + driver/coverage assertions across the file) + **1 new EVAL-05 short-circuit test**, all green. Driver still emits 26 rows across the 2 tables (EVAL-01 + EVAL-04) — unchanged.

### EVAL-05 short-circuit test in isolation

```
running 1 test
test evals::intelligence_eval::phase37_eval_05_verify_intelligence_short_circuits_when_disabled ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 821 filtered out; finished in 0.07s
```

### cargo check (src-tauri)

```
warning: `blade` (lib) generated 19 warnings (run `cargo fix --lib -p blade` to apply 8 suggestions)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 12.10s
```
Clean (only pre-existing dead-code warnings unrelated to this plan).

### verify:all chain length count

```
$ grep -o "npm run verify:" package.json | wc -l
38
```

verify:intelligence is the **last** entry in the chain (per CONTEXT lock — append at END). The chain extends from 37 → 38 gates exactly as specified in success criterion #6.

## Out-of-Scope Items (per SCOPE BOUNDARY)

Per Phase 32-07 / 33-09 / 34-11 / 35-11 / 36-09 close-out boundary, the pre-existing OEVAL-01c v1.4 drift in `verify:eval` / `verify:hybrid_search` remains out-of-scope for Plan 37-07. Plan 37-07 did **not** run `npm run verify:all` end-to-end (per plan §Action: "Don't run verify:all here — Task 4 confirms wiring without running the full 38-gate chain"); spot-check via `npm run verify:intelligence` standalone is the load-bearing assertion and is green. Plan 37-08 close-out will inherit the documented OEVAL-01c exception unchanged.

## Deviations from Plan

None — plan executed exactly as written. CONTEXT lock §verify-intelligence.sh Gate body shape preserved verbatim. Test placement (EVAL-05 banner at end-of-file) matches plan's recommendation. No Rule 1/2/3 auto-fixes triggered; no Rule 4 architectural decisions needed.

## Auth Gates

None.

## Known Stubs

None.

## Threat Flags

None — plan only adds a verify gate that shells out to existing cargo test infrastructure; no new network, auth, file-access, or schema surface.

## Commits

- `bb97fb8` — feat(37-07): verify-intelligence.sh (38th gate) + verify:all wire-up

## Next

Plan **37-08** — Phase 37 close-out (operator-runnable benchmark + checkpoint:human-verify). Plan 37-08 will leverage `verify:intelligence` as the deterministic CI lane and complement it with the operator-runnable benchmark surface.

## Self-Check: PASSED

- File `scripts/verify-intelligence.sh` exists and is executable (mode `-rwxr-xr-x`, size 1873 bytes).
- File `package.json` modified — `verify:intelligence` line present + chain extension.
- File `src-tauri/src/evals/intelligence_eval.rs` modified — EVAL-05 banner + test present.
- Commit `bb97fb8` exists in `git log --oneline -5`.
- All 12 intelligence_eval tests green via cargo test (11 prior + 1 new).
- `npm run verify:intelligence` exits 0 standalone.
- `BLADE_INTELLIGENCE_EVAL=false bash scripts/verify-intelligence.sh` exits 0 with SKIP message.
- Chain count = 38 entries (verified via `grep -o "npm run verify:" package.json | wc -l`).
