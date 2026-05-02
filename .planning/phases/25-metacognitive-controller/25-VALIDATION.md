---
phase: 25
slug: metacognitive-controller
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-02
---

# Phase 25 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `#[cfg(test)]` + cargo test |
| **Config file** | src-tauri/Cargo.toml |
| **Quick run command** | `cd src-tauri && cargo test --lib metacogniti` |
| **Full suite command** | `cd src-tauri && cargo test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib metacogniti`
- **After every plan wave:** Run `cd src-tauri && cargo test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-T0 | 01 | 1 | META-01..05 | -- | N/A | unit | `cargo test --lib metacogniti` | Wave 0 creates | pending |
| 25-01-T1 | 01 | 1 | META-01,04 | T-25-01,02 | Parameterized queries + safe_slice | unit | `cargo test --lib metacogniti` | Wave 0 creates | pending |
| 25-01-T2 | 01 | 1 | META-04 | T-25-03 | Aggregate counts only via IPC | unit | `cargo test --lib metacogniti` | Wave 0 creates | pending |
| 25-02-T1 | 02 | 2 | META-01,02,03 | T-25-04,05,06 | Verifier gated behind flag | unit | `cargo test --lib metacogniti` | Wave 0 creates | pending |
| 25-02-T2 | 02 | 2 | META-04 | T-25-07 | Gap log only, no response substitution | unit | `cargo test --lib metacogniti` | Wave 0 creates | pending |
| 25-03-T1 | 03 | 2 | META-05 | T-25-08 | Aggregate counts only | unit | `cargo test doctor` | Wave 0 creates | pending |
| 25-03-T2 | 03 | 2 | META-05 | T-25-09 | Read-only display | integration | `npx tsc --noEmit` | N/A (type check) | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `src-tauri/src/metacognition.rs` -- test stubs for META-01 through META-04 (test_confidence_delta_flag, test_verifier_routing, test_initiative_phrasing, test_gap_log_insert, test_metacognitive_state_default) created by Plan 01 Task 0
- [x] `src-tauri/src/doctor.rs` -- commented test_metacognitive_signal stub created by Plan 01 Task 0, uncommented by Plan 03 Task 1

*Wave 0 is addressed in Plan 01 Task 0 (first task executed in the phase).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DoctorPane metacognitive signal row | META-05 | UI rendering verification | Run app, open DoctorPane, verify metacognitive row shows confidence/uncertainty/gap counts |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** revision 1 -- Nyquist compliance addressed
