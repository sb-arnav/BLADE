---
phase: 29
slug: vitality-engine
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-03
---

# Phase 29 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust) + vitest (TypeScript) |
| **Config file** | `src-tauri/Cargo.toml` / `vitest.config.ts` |
| **Quick run command** | `cd src-tauri && cargo test --lib evals::vitality_eval -- --nocapture --test-threads=1` |
| **Full suite command** | `bash scripts/verify-vitality.sh` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib evals::vitality_eval -- --nocapture --test-threads=1`
- **After every plan wave:** Run `bash scripts/verify-vitality.sh`
- **Before `/gsd-verify-work`:** Full suite must be green + `npx tsc --noEmit` clean
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-00-01 | 00 | 0 | VITA-01..06 | -- | N/A | unit (stubs) | `cargo test --lib evals::vitality_eval -- --test-threads=1` | Plan 00 creates | pending |
| 29-01-01 | 01 | 1 | VITA-01 | T-29-01 | f32 clamped, NaN guarded | unit | `cargo test --lib evals::vitality_eval -- --test-threads=1` | Yes (from W0) | pending |
| 29-01-02 | 01 | 1 | VITA-02,03 | T-29-02 | All inputs validated | unit | `cargo test --lib evals::vitality_eval -- --test-threads=1` | Yes (from W0) | pending |
| 29-02-01 | 02 | 2 | VITA-01 | T-29-07 | Band notes use first-person | unit | `cargo test --lib evals::vitality_eval -- --test-threads=1` | Yes (from W0) | pending |
| 29-02-02 | 02 | 2 | VITA-04 | T-29-04 | DORMANCY_STUB guards exit | unit | `cargo test --lib evals::vitality_eval -- --test-threads=1` | Yes (from W0) | pending |
| 29-03-01 | 03 | 2 | VITA-05 | T-29-11 | TS union matches Rust enum | tsc | `npx tsc --noEmit` | N/A (type check) | pending |
| 29-04-01 | 04 | 3 | VITA-05 | T-29-12 | No user data in tooltip | tsc | `npx tsc --noEmit` | N/A (type check) | pending |
| 29-04-02 | 04 | 3 | VITA-04 | T-29-18 | Reincarnation msg hardcoded | tsc | `npx tsc --noEmit` | N/A (type check) | pending |
| 29-05-01 | 05 | 3 | VITA-01..06 | T-29-14,15 | DORMANCY_STUB + test-threads=1 | unit | `cargo test --lib evals::vitality_eval -- --test-threads=1` | Yes (from W0) | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `src-tauri/src/vitality_engine.rs` -- skeleton module with VitalityState, VitalityBand, DORMANCY_STUB, pub API stubs (Plan 00 Task 1)
- [x] `src-tauri/src/evals/vitality_eval.rs` -- 6 fixture stubs registered in evals/mod.rs (Plan 00 Task 2)
- [x] `scripts/verify-vitality.sh` -- Gate 37 script (Plan 00 Task 2)
- [x] `src-tauri/src/evals/mod.rs` -- `mod vitality_eval` registration (Plan 00 Task 2)

*Wave 0 creates test scaffolding before Wave 1 implementation begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DoctorPane Vitality row renders | VITA-05 | Requires running UI | Open DoctorPane, verify Vitality row shows scalar + band + trend |
| Chat header vitality indicator | VITA-05 | Requires running UI | Check chat header for vitality badge with correct band color |
| Band transitions observable in conversation | VITA-01 | Requires LLM responses | Compare responses at different vitality levels for personality dampening |
| Reincarnation system message | VITA-04 / D-23 | Requires UI | Trigger dormancy stub, relaunch, verify system message appears in chat |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (awaiting execution)
