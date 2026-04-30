---
phase: 17-doctor-module
plan: 07
status: complete
runtime_uat: deferred
deferred_by: operator
deferred_on: 2026-04-30
deferred_rationale: chat-first pivot — UI surface is not load-bearing for v1.2 direction
---

# Plan 17-07 — Phase 17 Verification (Static-Gate-Only Close)

**Plan status:** complete with explicit operator deferral of runtime UAT.

## What landed

**Task 1 — static gates: GREEN.**
- `cargo check` clean (0 warnings, 0 errors)
- `cargo test --lib doctor::tests` 35/35 passing
- `cargo test --lib evals` 9/9 passing (Phase 16 invariant preserved)
- `npx tsc --noEmit` clean
- `npm run verify:all` — all 30+ sub-gates green (verify:emit-policy, verify:wiring-audit-shape, verify:tokens-consistency, verify:css-token-names, verify:no-raw-tauri, verify:eval, verify:contrast, etc.)
- `bash scripts/verify-eval.sh` 5/5 floors green

Two infra repairs surfaced + landed during gate run:
- `verify-emit-policy.mjs` — added `doctor.rs:doctor_event` to CROSS_WINDOW_ALLOWLIST (Plan 17-05 omission); patched script to strip `//` and `/* … */` comments before regex scan (eliminates pre-existing false-positive class)
- `10-WIRING-AUDIT.json` — registered `doctor.rs` (Plan 17-02 omission); now 197/197 `.rs` files match `modules.length`

Snapshot: `.planning/phases/17-doctor-module/17-07-STATIC-GATES.md`

**Task 2 — runtime UAT: DEFERRED.**

Operator decision on 2026-04-30: Phase 17's UI is not load-bearing for v1.2's direction. The strategic frame shifted from "ship a beautiful Doctor pane" to "chat surface that can actually do anything." Doctor remains in the codebase as a diagnostic surface — it works, it compiles, the backend tests cover the severity logic — but the runtime UAT (16-box UI-SPEC § 17 checklist + 4 screenshots + read-back) is intentionally not run.

This is a documented deviation from CLAUDE.md Verification Protocol. The protocol's purpose is to catch silent UI regressions like the v1.1 retraction. The deferral is explicit and operator-recorded; if Doctor surfaces a bug in the wild, it's a known accept-the-risk position.

**Task 3 — VERIFICATION.md: SKIPPED.** No standalone verification doc needed since UAT didn't run. This SUMMARY plus the static-gate snapshot + per-plan SUMMARY chain (17-01..17-06) provide the audit trail.

## Phase 17 close

| REQ | Status | Evidence |
|-----|--------|----------|
| DOCTOR-01 (3 commands) | code complete | doctor.rs:771/827/842; lib.rs registered |
| DOCTOR-02 (eval-history source) | code complete | compute_eval_signal + record_eval_run wired into 5 modules |
| DOCTOR-03 (capability gap aggregation) | code complete | compute_capgap_signal queries activity_timeline |
| DOCTOR-04 (tentacle health) | code complete | compute_tentacle_signal reads supervisor + integration_bridge |
| DOCTOR-05 (config drift) | code complete | compute_drift_signal calls verify-migration-ledger + scan-profile age |
| DOCTOR-06 (doctor_event) | code complete | transition gate emits on warn-tier transitions only (D-20) |
| DOCTOR-07 (Diagnostics sub-tab) | code complete | DoctorPane.tsx + 5 surgical Diagnostics.tsx edits |
| DOCTOR-08 (severity hierarchy) | code complete | data-severity stripe via canonical tokens (zero ghost tokens) |
| DOCTOR-09 (drill-down drawer) | code complete | Dialog primitive opens with payload + suggested_fix |
| DOCTOR-10 (auto-update presence) | code complete | compute_autoupdate_signal greps Cargo.toml + lib.rs |

| ROADMAP success criterion | Status |
|----|--|
| 1. 3 Tauri commands callable end-to-end | static-verified (cargo check + tsc + admin.ts wrappers compile) |
| 2. Doctor pane renders ≥5 distinct signal classes | code complete; runtime not exercised |
| 3. Artificially failing eval lights doctor red | severity logic unit-tested; full e2e flow not exercised |
| 4. doctor_event Tauri event emitted on regression | transition-gate unit-tested (6 tests); emit site code-correct |
| 5. Auto-update presence check folded in as amber if not wired | compute_autoupdate_signal unit-tested; returns Green on stock build (Cargo.toml line 25 + lib.rs line 555 both present) |

**Closure decision:** Phase 17 marked complete in STATE.md and ROADMAP.md. Doctor module ships as code-complete; runtime UAT is a deferred item on the v1.2 ledger.

---

*Phase 17 closed 2026-04-30 with explicit operator deferral of runtime UAT in favor of v1.2 pivot to chat-capability work.*
