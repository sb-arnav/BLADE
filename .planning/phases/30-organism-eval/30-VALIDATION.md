---
phase: 30
slug: organism-eval
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-03
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust built-in) |
| **Config file** | src-tauri/Cargo.toml |
| **Quick run command** | `cd src-tauri && cargo test --lib evals::organism_eval -- --nocapture --test-threads=1` |
| **Full suite command** | `cd src-tauri && cargo test --lib evals::organism_eval --quiet -- --nocapture --test-threads=1` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib evals::organism_eval -- --nocapture --test-threads=1`
- **After every plan wave:** Run full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green + `scripts/verify-organism.sh` gate green
- **Max feedback latency:** 60 seconds (cargo test compilation + run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-00-01 | 00 | 0 | OEVAL-01..04 | — | N/A (test seam) | unit | `cargo test --lib evals::organism_eval` | ❌ W0 | ⬜ pending |
| 30-01-01 | 01 | 1 | OEVAL-01 | — | Vitality trajectories in expected bands | integration | `cargo test --lib evals::organism_eval::evaluates_organism` | ❌ W0 | ⬜ pending |
| 30-01-02 | 01 | 1 | OEVAL-02 | — | Behavioral modulation matches band | integration | `cargo test --lib evals::organism_eval::evaluates_organism` | ❌ W0 | ⬜ pending |
| 30-01-03 | 01 | 1 | OEVAL-03 | — | Persona L2 distance < 0.5 | integration | `cargo test --lib evals::organism_eval::evaluates_organism` | ❌ W0 | ⬜ pending |
| 30-01-04 | 01 | 1 | OEVAL-04 | — | Safety invariants hold under organism load | integration | `cargo test --lib evals::organism_eval::evaluates_organism` | ❌ W0 | ⬜ pending |
| 30-02-01 | 02 | 2 | OEVAL-05 | — | Gate 38 green, verify:all passes | gate | `scripts/verify-organism.sh` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/homeostasis.rs` — add `set_physiology_for_test()` test seam (missing, confirmed by research)
- [ ] `src-tauri/src/evals/organism_eval.rs` — scaffold module with fixture struct + harness imports
- [ ] `src-tauri/src/evals/mod.rs` — register `#[cfg(test)] mod organism_eval;`

*Existing eval infrastructure (harness.rs) covers all other requirements.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
