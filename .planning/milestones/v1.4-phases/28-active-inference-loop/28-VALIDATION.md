---
phase: 28
slug: active-inference-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-02
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` + custom eval harness (`evals::harness`) |
| **Config file** | `src-tauri/Cargo.toml` (existing) |
| **Quick run command** | `cd src-tauri && cargo test --lib evals::active_inference_eval --quiet -- --nocapture --test-threads=1` |
| **Full suite command** | `npm run verify:inference` (new script, follows verify-hormone.sh pattern) |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo check` (batched, not after every edit per CLAUDE.md)
- **After every plan wave:** Run `cd src-tauri && cargo test --lib evals::active_inference_eval -- --nocapture --test-threads=1`
- **Before `/gsd-verify-work`:** Full suite must be green (`npm run verify:all` + `npx tsc --noEmit`)
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 28-01-01 | 01 | 1 | AINF-01 | — | N/A | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf01` | ❌ W0 | ⬜ pending |
| 28-01-02 | 01 | 1 | AINF-02 | — | prediction error values clamped to [0.0, 1.0] | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf02` | ❌ W0 | ⬜ pending |
| 28-02-01 | 02 | 1 | AINF-03 | — | N/A | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf03` | ❌ W0 | ⬜ pending |
| 28-03-01 | 03 | 2 | AINF-04 | — | N/A | integration | `cargo test --lib evals::active_inference_eval -- fixture_ainf04` | ❌ W0 | ⬜ pending |
| 28-04-01 | 04 | 2 | AINF-05 | — | N/A | unit (SQLite) | `cargo test --lib evals::active_inference_eval -- fixture_ainf05` | ❌ W0 | ⬜ pending |
| 28-05-01 | 05 | 2 | AINF-06 | — | N/A | unit | `cargo test --lib evals::active_inference_eval -- fixture_ainf06` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/evals/active_inference_eval.rs` — stubs for AINF-01..06 (6 fixtures)
- [ ] `src-tauri/src/evals/mod.rs` — add `pub mod active_inference_eval;` line
- [ ] `src-tauri/src/active_inference.rs` — stub with public API (TentaclePrediction, compute_prediction_errors, get_active_inference_state)
- [ ] `scripts/verify-inference.sh` — Gate 36 script (follows verify-hormone.sh pattern)
- [ ] `package.json` — add `"verify:inference"` and append to `verify:all` chain

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DoctorPane shows ActiveInference signal row | AINF-01/D-18 | Visual verification of UI rendering | Open DoctorPane in dev server, confirm ActiveInference row visible with aggregate error value |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
