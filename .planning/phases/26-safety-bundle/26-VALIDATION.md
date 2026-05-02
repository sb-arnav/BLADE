---
phase: 26
slug: safety-bundle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-02
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust eval harness (`evals/harness.rs` + `adversarial_eval.rs` pattern) |
| **Config file** | `src-tauri/src/evals/` directory |
| **Quick run command** | `cd src-tauri && cargo test --lib safety` |
| **Full suite command** | `cd src-tauri && cargo test --lib safety && bash scripts/verify-safety.sh` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib safety`
- **After every plan wave:** Run `cd src-tauri && cargo test --lib safety && bash scripts/verify-safety.sh`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-01 | 01 | 1 | SAFE-01 | T-26-01 | Danger-triple fires HITL when all 3 signals present | unit | `cargo test danger_triple` | ❌ W0 | ⬜ pending |
| 26-01-02 | 01 | 1 | SAFE-02 | T-26-02 | Mortality-salience cap blocks self-preservation actions | unit | `cargo test mortality_cap` | ❌ W0 | ⬜ pending |
| 26-01-03 | 01 | 1 | SAFE-03 | T-26-03 | Calm-vector steering activates on behavioral drift | unit | `cargo test calm_vector` | ❌ W0 | ⬜ pending |
| 26-02-01 | 02 | 1 | SAFE-04 | T-26-04 | Eval failures drain vitality (hook planted) | unit | `cargo test eval_drain` | ❌ W0 | ⬜ pending |
| 26-02-02 | 02 | 1 | SAFE-05 | T-26-05 | Attachment guardrails redirect at threshold | unit | `cargo test attachment` | ❌ W0 | ⬜ pending |
| 26-02-03 | 02 | 1 | SAFE-06 | T-26-06 | Crisis detection escalates to human resources | unit | `cargo test crisis` | ❌ W0 | ⬜ pending |
| 26-03-01 | 03 | 2 | SAFE-07 | — | All 20-30 eval scenarios pass | integration | `bash scripts/verify-safety.sh` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/safety_bundle.rs` — module skeleton with public API stubs
- [ ] `src-tauri/src/evals/safety_eval.rs` — eval fixture file with scenario stubs
- [ ] `scripts/verify-safety.sh` — gate 34 verification script

*Existing test infrastructure (cargo test) covers framework needs — no new framework install required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ConsentDialog renders without AllowAlways for safety overrides | SAFE-01 | UI rendering requires visual check | Trigger danger-triple in dev → verify dialog shows only Approve/Deny |
| Attachment redirect text appears naturally in chat | SAFE-05 | Tone/phrasing quality is subjective | Sustain 4h+ session → confirm redirect feels caring, not robotic |
| Crisis resources display correctly formatted | SAFE-06 | Regional appropriateness check | Trigger crisis detection → verify hotline numbers are correct and formatted |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
