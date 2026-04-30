# Phase 17 — Plan 17-07 Task 1 — Static Gate Snapshot

**Date:** 2026-04-30
**Status:** All static gates GREEN. Runtime UAT (Task 2) pending operator.

> Per CLAUDE.md Verification Protocol: static gates are necessary but NOT sufficient. Plan 17-07 is NOT complete until the operator runs `/blade-uat`, captures 4 screenshots, and Reads each one back per the BLADE Verification Protocol. This file records only Task 1.

---

## Gates run

| # | Gate | Exit | Result |
|---|------|------|--------|
| 1 | `cd src-tauri && cargo check` | 0 | clean (0 warnings, 0 errors) |
| 2 | `cd src-tauri && cargo test --lib doctor::tests -- --test-threads=1` | 0 | **35/35 passed** (transition gate, severity classifiers, suggested_fix lock, safe_slice cap) |
| 3 | `cd src-tauri && cargo test --lib evals -- --test-threads=1` | 0 | **9/9 passed** — Phase 16 evals invariant preserved (no regression from Plan 17-03 record_eval_run insertions) |
| 4 | `npx tsc --noEmit` | 0 | clean |
| 5 | `npm run verify:all` | 0 | **All 30+ sub-gates green** including `verify:emit-policy`, `verify:wiring-audit-shape`, `verify:tokens-consistency`, `verify:css-token-names`, `verify:no-raw-tauri`, `verify:eval` |
| 6 | `bash scripts/verify-eval.sh` | 0 | 5/5 scored tables, all floors green |

## Sub-gate fixes landed during Task 1

Two regressions surfaced from prior plans, repaired inline:

1. **`verify-emit-policy.mjs`** — Plan 17-05 introduced `app.emit("doctor_event", ...)` (intended cross-window per CONTEXT D-20/D-21/M-07) but did NOT add the corresponding entry to `CROSS_WINDOW_ALLOWLIST`. Repair: added `'doctor.rs:doctor_event'` to the allowlist with a "Phase 17 — main DoctorPane + ActivityStrip subscribers" group comment. Also patched the script to strip `//` line and `/* … */` block comments before regex scan, eliminating a pre-existing false-positive trigger when source files reference emit shapes in documentation.
2. **`10-WIRING-AUDIT.json`** — Plan 17-02 added `src-tauri/src/doctor.rs` but the milestone-archived audit JSON wasn't updated, leaving `modules.length` (196) one short of the live `.rs` count (197). Repair: appended a full audit entry for `doctor.rs` (classification ACTIVE, all 3 commands registered + invoked_from sites, reachable_paths). `verify-wiring-audit-shape.mjs` now passes.

Both fixes were committed under `chore(17-07): …` so Phase 17 stays self-contained.

## What's still required to close Plan 17-07

Task 1 (this file) covers static gates only. Plan 17-07 also defines:

- **Task 2 — runtime UAT (operator-driven, BLOCKING):**
  - `npm run tauri dev` — bring the app up clean
  - Run the `/blade-uat` 16-box checklist (UI-SPEC § 17)
  - Capture 4 screenshots at the required viewports:
    - `docs/testing ss/17-doctor-1280.png` (Doctor pane @ 1280×800)
    - `docs/testing ss/17-doctor-1100.png` (Doctor pane @ 1100×700)
    - `docs/testing ss/17-doctor-drawer-1280.png` (drill-down drawer @ 1280×800)
    - `docs/testing ss/17-doctor-drawer-1100.png` (drill-down drawer @ 1100×700)
  - **Read each screenshot back** with the Read tool — cite a one-line observation per shot per CLAUDE.md "BLADE UAT evidence rule" memory
  - Force a synthetic Red signal (e.g., `BLADE_EVAL_HISTORY_PATH=/tmp/fake-history.jsonl` with a floor-breach record) and verify `[Doctor]` line appears in ActivityStrip — proves end-to-end the `doctor_event` push + ActivityStrip emission flow (ROADMAP SC-3 + D-21 / M-07)
- **Task 3 — write `17-VERIFICATION.md`** — REQ → evidence map covering DOCTOR-01..10 + 5 ROADMAP success criteria; references the captured screenshots; signs off the Phase 17 verification gate.

---

*Operator handoff: when UAT lands, advance Plan 17-07 by writing 17-VERIFICATION.md, committing all four screenshots, then running `/gsd-verifier` (or finalizing manually per workflow). STATE.md should NOT be marked phase-complete until then.*
