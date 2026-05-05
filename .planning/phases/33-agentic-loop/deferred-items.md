# Phase 33 — Deferred Items

Out-of-scope discoveries surfaced during Phase 33 close-out (Plan 33-09).
Per `<deviation_rules>` SCOPE BOUNDARY: only auto-fix issues DIRECTLY caused
by current task's changes; pre-existing failures in unrelated surfaces are
out of scope.

## v1.4 organism-eval drift (OEVAL-01c)

- **Surface:** `evals::organism_eval::evaluates_organism` — `OEVAL-01c: timeline recovery arc`
- **Failure:** `scalar=0.4032 band=Declining >= 0.45: false` (12/13 pass; one fixture short of the 1.000 floor)
- **Status:** PRE-EXISTING v1.4 debt, identical signature to Phase 32-07 SUMMARY observation (`scalar=0.4032 band=Declining`).
- **Coupling to Phase 33:** ZERO. Failure is in `src-tauri/src/vitality_engine.rs` recovery dynamics + `src-tauri/src/evals/organism_eval.rs` fixture math. Phase 33 touches `loop_engine.rs`, `commands.rs:send_message_stream`, and `brain.rs::build_fast_path_supplement` — none overlap with vitality_engine.
- **Determinism check:** Phase 32-07 SUMMARY confirmed `stash-and-rerun yields identical scalar`. Same scalar (0.4032) reproduces today on the Phase 33-09 working tree, confirming it remains a pure v1.4 surface drift.
- **Recommendation:** Investigate vitality recovery dynamics in v1.6 — STATE.md's "13/13 fixtures, MRR 1.000" claim entering v1.5 was stale at v1.4 close. The 12/13 pass + the floor-to-band hysteresis math may need re-tuning after Phase 27-29 hormone wiring landed.
- **Why not fixed in Phase 33:** Out-of-scope per the deviation rules SCOPE BOUNDARY. Phase 33 is loop / agentic-iteration surface; touching vitality_engine in a Phase 33 close-out plan would risk introducing coupling that wasn't there before.

## Pre-existing verify-emit-policy debt (RESOLVED in Plan 33-09)

- **Surface:** `loop_engine.rs:blade_status` broadcast emits (19 sites) flagged by `scripts/verify-emit-policy.mjs`
- **Cause:** Plan 33-03 lifted the per-iteration loop body from `commands.rs` into `loop_engine.rs` (which is the documented architectural change); the lift carried the original `blade_status` broadcast emits but did NOT add the new file path to the script's `CROSS_WINDOW_ALLOWLIST`. Pre-existing on master across Plans 33-03 through 33-08.
- **Resolution:** Plan 33-09 added `'loop_engine.rs:blade_status'` to the `CROSS_WINDOW_ALLOWLIST` in `scripts/verify-emit-policy.mjs`. Mirrors the existing `'commands.rs:blade_status'` allowlist entry — same audience (main + HUD), same broadcast semantics, same emit shape. The fix lands in the Plan 33-09 commit because it is required for "Phase 33 close-out: 37 verify gates green" — the same posture Phase 32-07 took with the v1.4 ghost-CSS-tokens debt.

## Pre-existing verify-wiring-audit-shape debt (RESOLVED in Plan 33-09)

- **Surface:** `[verify-wiring-audit-shape] FAIL: modules — modules.length (221) !== live .rs count under src-tauri/src/ (222)`
- **Cause:** Plan 33-02 created `src-tauri/src/loop_engine.rs` but never registered it in `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`. Pre-existing on master since Plan 33-02 landed.
- **Resolution:** Plan 33-09 added a `loop_engine.rs` module entry to `10-WIRING-AUDIT.json` (alphabetically positioned between `lib.rs` and `main.rs`). Schema-conformant: `file`, `classification: ACTIVE`, `purpose`, `trigger`, `internal_callers: ["src-tauri/src/commands.rs"]`, `reachable_paths`. Mirrors the Phase 32-07 close-out treatment of similar v1.4 audit gaps (commit 2c3345a).
