---
phase: 27
slug: hormone-physiology
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-02
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust) + vitest (TypeScript) |
| **Config file** | `src-tauri/Cargo.toml` / `vitest.config.ts` |
| **Quick run command** | `cd src-tauri && cargo test --lib` |
| **Full suite command** | `cd src-tauri && cargo test --lib && cd .. && npx tsc --noEmit` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib`
- **After every plan wave:** Run `cd src-tauri && cargo test --lib && cd .. && npx tsc --noEmit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-01-01 | 01 | 1 | HORM-01 | T-27-01 / — | Hormone values clamped 0.0-1.0 | unit | `cargo test physiological` | ❌ W0 | ⬜ pending |
| 27-01-02 | 01 | 1 | HORM-02 | — | Decay converges to floor, not below | unit | `cargo test decay` | ❌ W0 | ⬜ pending |
| 27-02-01 | 02 | 1 | HORM-03 | — | Classifier emits valid clusters | unit | `cargo test emotion_class` | ❌ W0 | ⬜ pending |
| 27-03-01 | 03 | 2 | HORM-04 | — | Cortisol modulation injects terse directive | unit | `cargo test cortisol_mod` | ❌ W0 | ⬜ pending |
| 27-03-02 | 03 | 2 | HORM-05 | — | Dopamine gates exploration rate | unit | `cargo test dopamine_mod` | ❌ W0 | ⬜ pending |
| 27-04-01 | 04 | 3 | HORM-08 | — | Hormones survive restart | integration | `cargo test persist` | ❌ W0 | ⬜ pending |
| 27-05-01 | 05 | 3 | HORM-09 | — | DoctorPane renders hormone row | manual | N/A | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for HORM-01 through HORM-08 in `src-tauri/src/` test modules
- [ ] Existing cargo test infrastructure covers all phase requirements

*Existing infrastructure covers all phase requirements — no new framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DoctorPane hormone row visible | HORM-09 | UI rendering requires running app | Open Doctor, verify Hormones signal class appears with 7 values |
| ActivityStrip hormone events | HORM-03 | Event emission visible in running UI | Trigger high-stress exchange, verify ActivityStrip shows hormone event |
| Cortisol → terse response style | HORM-04 | Requires LLM response evaluation | Pin cortisol high, send message, compare response tone to baseline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
