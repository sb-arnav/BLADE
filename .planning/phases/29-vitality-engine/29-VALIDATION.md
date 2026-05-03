---
phase: 29
slug: vitality-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-03
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust) + vitest (TypeScript) |
| **Config file** | `src-tauri/Cargo.toml` / `vitest.config.ts` |
| **Quick run command** | `cd src-tauri && cargo test vitality --lib` |
| **Full suite command** | `cd src-tauri && cargo test vitality` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test vitality --lib`
- **After every plan wave:** Run `cd src-tauri && cargo test vitality`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | VITA-01 | — | N/A | unit | `cargo test vitality_band` | ❌ W0 | ⬜ pending |
| 29-01-02 | 01 | 1 | VITA-02 | — | N/A | unit | `cargo test sdt_replenishment` | ❌ W0 | ⬜ pending |
| 29-01-03 | 01 | 1 | VITA-03 | — | N/A | unit | `cargo test drain` | ❌ W0 | ⬜ pending |
| 29-02-01 | 02 | 2 | VITA-04 | — | Dormancy preserves state, no data loss | unit | `cargo test dormancy` | ❌ W0 | ⬜ pending |
| 29-02-02 | 02 | 2 | VITA-04 | — | Reincarnation loads preserved identity | unit | `cargo test reincarnation` | ❌ W0 | ⬜ pending |
| 29-03-01 | 03 | 2 | VITA-01 | — | Band effects gate behaviors safely | unit | `cargo test band_effects` | ❌ W0 | ⬜ pending |
| 29-04-01 | 04 | 3 | VITA-05 | — | N/A | manual | Browser DoctorPane check | — | ⬜ pending |
| 29-05-01 | 05 | 3 | VITA-06 | — | N/A | unit | `cargo test vitality_eval` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/vitality_engine.rs` — module with VitalityState, VitalityBand, DORMANCY_STUB
- [ ] `src-tauri/src/vitality_eval.rs` — deterministic fixture tests for bands, drain, replenishment, hysteresis, dormancy stub

*Existing infrastructure covers test framework — cargo test already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DoctorPane Vitality row renders | VITA-05 | Requires running UI | Open DoctorPane, verify Vitality row shows scalar + band + trend |
| Chat header vitality indicator | VITA-05 | Requires running UI | Check chat header for vitality badge with correct band color |
| Band transitions observable in conversation | VITA-01 | Requires LLM responses | Compare responses at different vitality levels for personality dampening |
| Reincarnation system message | VITA-04 | Requires UI | Trigger dormancy stub, relaunch, verify system message appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
