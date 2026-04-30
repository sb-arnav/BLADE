---
phase: 16
slug: eval-scaffolding-expansion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth: `16-RESEARCH.md` § 11 (Validation Architecture).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test --lib` (rustc 1.85+, default test harness) |
| **Config file** | `src-tauri/Cargo.toml` (no separate test config) |
| **Quick run command** | `cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1` |
| **Full suite command** | `bash scripts/verify-eval.sh` (wraps quick run + table-presence assertion) |
| **Estimated runtime** | ~30–60s (cold fastembed load dominates; warm runs ~5–10s) |

**Mandatory flag:** `--test-threads=1`. Cargo test parallelism races on `BLADE_CONFIG_DIR` and the Tokio LocalSet used by `tts.rs` / `whisper_local.rs` static state. See `16-RESEARCH.md` §10 R1.

---

## Sampling Rate

- **After every task commit:** Run the per-module `cargo test --lib evals::<module> -- --nocapture --test-threads=1` (~5–30s).
- **After every plan wave:** Run `bash scripts/verify-eval.sh` (full eval suite, ~30–60s including fastembed cold path).
- **Before `/gsd-verify-work`:** `npm run verify:all` green — the full 30+ gate chain plus the new `verify:eval`.
- **Max feedback latency:** 60s.

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Status |
|--------|----------|-----------|-------------------|-------------|
| EVAL-01 | Shared harness compiles + used by ≥2 eval modules | unit (compile) | `cd src-tauri && cargo test --lib evals::harness --no-run` | Wave 0 NEW: `evals/mod.rs`, `evals/harness.rs` |
| EVAL-02 | KG round-trip: ≥3 nodes, ≥3 edges, no orphans, idempotent merge | unit | `cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture` | Wave 0 NEW: `evals/kg_integrity_eval.rs` |
| EVAL-03 (synth) | Synthetic 8/8 floor preserved + 3 adversarial fixtures surfaced (gate-relaxed) | unit | `cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture` | EXTRACTED from `embeddings.rs:510-728` |
| EVAL-03 (real) | 7-query fastembed floor MRR ≥ 0.6 / top3 ≥ 80% preserved | unit | `cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture` | EXTRACTED from `embeddings.rs:748-946` |
| EVAL-04 | typed_memory 7-category recall returns expected sets | unit | `cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture` | Wave 0 NEW: `evals/typed_memory_eval.rs` |
| EVAL-05 | `detect_missing_tool` classifies 7 stderr/cmd cases incl. false-positive | unit | `cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture` | Wave 0 NEW: `evals/capability_gap_eval.rs` |
| EVAL-06 | Each module emits `┌──` scored-table delimiter | smoke | `bash scripts/verify-eval.sh` (greps stdout for U+250C U+2500 U+2500) | Wave 0 NEW: `scripts/verify-eval.sh` |
| EVAL-07 | `verify:eval` present in `verify:all`, count 30→31 | smoke (CI) | `npm run verify:all` | MOD: `package.json` |
| EVAL-08 | `tests/evals/DEFERRED.md` ≥3 structured entries | manual-only | `test -f tests/evals/DEFERRED.md && [ $(grep -c '^## ' tests/evals/DEFERRED.md) -ge 3 ]` | Wave 0 NEW: `tests/evals/DEFERRED.md` |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Note on count:** REQUIREMENTS.md states "27 → 28+" but the live `verify:all` chain in `package.json` is **30** today (27 was the count at v1.1 close; 3 gates were added during v1.1 polish). Phase 16 takes it to **31**. Both numbers are documented to avoid verification-time confusion.

---

## Wave 0 Requirements

- [ ] `src-tauri/src/evals/mod.rs` — module tree root (covers EVAL-01)
- [ ] `src-tauri/src/evals/harness.rs` — shared helpers: fixture builders, RR/MRR, scored-table printer (covers EVAL-01)
- [ ] `src-tauri/src/evals/hybrid_search_eval.rs` — extracted from `embeddings.rs` + 3 adversarial cases (covers EVAL-03 synth)
- [ ] `src-tauri/src/evals/real_embedding_eval.rs` — extracted from `embeddings.rs` (covers EVAL-03 real)
- [ ] `src-tauri/src/evals/kg_integrity_eval.rs` — new (covers EVAL-02)
- [ ] `src-tauri/src/evals/typed_memory_eval.rs` — new (covers EVAL-04)
- [ ] `src-tauri/src/evals/capability_gap_eval.rs` — new (covers EVAL-05)
- [ ] `scripts/verify-eval.sh` — new bash wrapper modeled on `scripts/verify-chat-rgba.sh` (covers EVAL-06 grep + EVAL-07 chain entry)
- [ ] `tests/evals/DEFERRED.md` — new doc (covers EVAL-08)
- [ ] `src-tauri/src/lib.rs` — add `#[cfg(test)] mod evals;` (registration)
- [ ] `src-tauri/src/embeddings.rs` — DELETE lines 496–946 (existing inline eval modules) AFTER content has been moved; leave production code 1–489 untouched
- [ ] `package.json` — add `verify:eval` script + chain into `verify:all`

Framework install: **none** — `cargo test` is built into the Rust toolchain BLADE already requires.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DEFERRED.md rationale quality | EVAL-08 | Subjective: each entry needs a meaningful rationale + budget estimate + promotion trigger, not boilerplate | Read each `## ` section; confirm each has a Rationale, Budget, and Promotion Trigger paragraph (≥3 sentences total); no "TBD" placeholders |
| Adversarial fixture realism | EVAL-03 | Authoring-quality check — fixtures must be BLADE-shaped, not generic | Inspect `evals/hybrid_search_eval.rs` adversarial section: long-content fixture is a realistic capability-gap log shape; unicode fixture mixes CJK + emoji as plausible IM content; near-duplicate fixture differs in exactly one token |

---

## Validation Sign-Off

- [ ] All 8 EVAL requirements have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive plans without automated verify (5 eval modules ⇒ each plan has its own `cargo test --lib evals::<module>` gate)
- [ ] Wave 0 covers all NEW + EXTRACTED file paths above
- [ ] No watch-mode flags — `cargo test --lib evals` is one-shot
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 commits land

**Approval:** pending (planner consumes this; checker enforces it)
