---
phase: 17
slug: doctor-module
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Bootstrapped from the `## Validation Architecture` section of `17-RESEARCH.md`. Refines the planner's per-task verification map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | Cargo test (built-in); `--test-threads=1` per BLADE harness convention |
| **Framework (TS)** | `npx tsc --noEmit` for type checks; no UI test framework — runtime UAT covers UI |
| **Eval gate** | `bash scripts/verify-eval.sh` (Phase 16 — unchanged in Phase 17) |
| **Runtime UAT** | `/blade-uat` slash command (CLAUDE.md Verification Protocol) — MANDATORY for any UI surface |
| **Quick run command** | `cd src-tauri && cargo test --lib doctor -- --nocapture --test-threads=1 && npx tsc --noEmit` |
| **Full suite command** | `npm run verify:all && bash scripts/verify-eval.sh` (then `/blade-uat`) |
| **Estimated runtime** | ~30s static gates; `/blade-uat` runtime UAT ~5 min manual |

---

## Sampling Rate

- **After every task commit:** `cd src-tauri && cargo test --lib doctor -- --nocapture --test-threads=1`
- **After every plan wave:** `npm run verify:all && cd src-tauri && cargo test --lib -- --test-threads=1`
- **Before `/gsd-verify-work`:** Full suite green AND `/blade-uat` checklist complete with screenshots saved + read back per CLAUDE.md Verification Protocol
- **Max feedback latency:** ~30s for unit; ~5 min for full static + UAT

---

## Per-Task Verification Map

> Populated by the planner during plan generation. Each task in every PLAN.md MUST list either an `<automated>` verify command (mapped here) or a `runtime UAT` step from `17-UI-SPEC.md § 17`. No 3 consecutive tasks without automated verification (Nyquist sampling continuity).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _populated_by_planner_ | — | — | — | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Tests / fixtures that MUST exist before Wave 1 implementation. Each is a Wave 0 task in PLAN.md:

- [ ] `src-tauri/src/doctor.rs` — module file + `mod tests { }` block with stubbed unit tests for severity classifiers
- [ ] `src-tauri/src/evals/harness.rs::tests::record_eval_run_appends_jsonl` — unit test for the new public function (uses tempdir + `BLADE_EVAL_HISTORY_PATH` env override per Pitfall 4)
- [ ] `tests/evals/.gitkeep` — keeps the directory tracked (history.jsonl is gitignored)
- [ ] `src/lib/events/index.ts` — `DOCTOR_EVENT: 'doctor_event'` constant added to BLADE_EVENTS frozen registry
- [ ] `src/lib/events/payloads.ts` — `DoctorEventPayload` interface
- [ ] `src/features/admin/admin-rich-c.css` — partial for severity stripe + drawer styling (canonical tokens only — no ghost tokens)
- [ ] `src/lib/tauri/admin.ts` — `doctorRunFullCheck`, `doctorGetRecent`, `doctorGetSignal` wrappers (pattern from `supervisorGetHealth`)

Wave 0 closes when each item is committed and the module compiles green.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Doctor sub-tab is reachable from Diagnostics route | DOCTOR-07 | UI navigation requires running app | `/blade-uat` step 1 — open Diagnostics → click "Doctor" tab pill → screenshot to `docs/testing ss/diagnostics-doctor-1280x800.png` |
| Tab pref persists across reload | DOCTOR-07 | Storage round-trip needs running app | `/blade-uat` step 2 — switch to Doctor → refresh → confirm Doctor still active |
| Severity stripe color matches signal severity | DOCTOR-08 | Color rendering needs DOM | `npm run verify:contrast` (static) + `/blade-uat` screenshot read-back (visual) |
| Drill-down drawer opens on row click | DOCTOR-09 | Click handler + Dialog mount need running app | `/blade-uat` step 3 — click each row → confirm drawer opens centered → confirm payload + suggested_fix render → Esc closes → focus restores |
| ActivityStrip emission on Doctor regression | D-21 / M-07 | Cross-component Tauri event flow needs running app + multi-window | `/blade-uat` step 4 — force a Red signal (env-var fixture) → confirm `[Doctor] {class} → red: {summary}` appears in ActivityStrip |
| Doctor pane responsive at 1280×800 + 1100×700 | UI-SPEC § 17 | Layout-only, needs running app | `/blade-uat` capture both breakpoints to `docs/testing ss/` (literal space in path) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependency reference
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (file_exists ❌)
- [ ] No watch-mode flags in commands
- [ ] Feedback latency < 30s (unit), < 5 min (full + UAT)
- [ ] `nyquist_compliant: true` set in frontmatter once planner populates the verification map
- [ ] `/blade-uat` checklist complete + screenshots saved + read back per CLAUDE.md Verification Protocol

**Approval:** pending (planner populates per-task map; UAT signs off at phase close)
