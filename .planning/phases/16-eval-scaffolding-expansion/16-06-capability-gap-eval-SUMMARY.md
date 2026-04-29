---
phase: 16-eval-scaffolding-expansion
plan: 06
subsystem: evals
tags: [eval, capability-gap, classifier, false-positive-regression, EVAL-05, wave-2-close]
dependency_graph:
  requires:
    - "16-01-harness (super::harness — print_eval_table, EvalRow)"
    - "self_upgrade.rs (detect_missing_tool / capability_catalog / CapabilityGap — live function path; REQ wording said `evolution::`)"
  provides:
    - "src-tauri/src/evals/capability_gap_eval.rs — fifth Wave 2 harness consumer"
    - "EVAL-05 regression gate (4 positive + 1 false-positive + 2 negative)"
    - "Strict-matcher regression gate at `self_upgrade.rs:272-285` (catches future loosenings that re-enable spurious-install bug)"
  affects:
    - "Phase 16 Wave 2 closes (5/5 plans shipped — only Wave 3 16-07 remains)"
    - ".planning/REQUIREMENTS.md (EVAL-05 checkbox flipped)"
    - ".planning/ROADMAP.md (16-06 line marked shipped)"
    - ".planning/STATE.md (Wave 2 progress + status)"
tech-stack:
  added: []
  patterns:
    - "table-driven classifier test (rr=1.0/0.0 boolean integrity; matches kg_integrity_eval / typed_memory_eval convention)"
    - "Option<CapabilityGap> tri-state assertion: Some+match | Some+mismatch | None"
    - "case-insensitive suggestion-substring assertion (`gap.suggestion.to_lowercase().contains(needle.to_lowercase())`)"
    - "false-positive case as named regression gate row, not relaxed"
    - "pre-flight catalog-key existence check (clear error vs. confusing top1=✗)"
key-files:
  created: []
  modified:
    - "src-tauri/src/evals/capability_gap_eval.rs (Wave 1 stub 1 LOC → 206 LOC)"
    - ".planning/REQUIREMENTS.md (EVAL-05 box checked)"
decisions:
  - "Imported from `crate::self_upgrade::` (the live path) NOT `crate::evolution::` (the REQ wording). RESEARCH §5 verified `evolution.rs` has zero re-exports of `detect_missing_tool` — adding one for cosmetic alignment with REQ text would be production-touching dead code. The file header doc-comment explicitly documents the resolution so a future maintainer reading from the REQ line doesn't go hunting in the wrong module."
  - "Catalog key for ripgrep is `\"ripgrep\"` (not `\"rg\"`). The eval's ripgrep command starts with `ripgrep` so the first-token match hits. Using `rg ...` here would (correctly) miss because `rg` is not a catalog key — that miss would be a real-world miss too."
  - "False-positive case is the regression gate, not relaxed. The plan's threat register flags T-16-06-01: a future loosening of `detect_missing_tool` (e.g. dropping the catalog-key check, restoring the old stderr-scan loose match) would re-enable the spurious-install bug fixed at `self_upgrade.rs:272-285`. The `false_positive_cargo_mentions_fd` row catches it; do NOT mark the row relaxed even though it's a one-bit signal."
  - "Pre-flight catalog-key existence assertion. Before iterating cases, the test asserts `catalog.contains_key(\"jq\" / \"ripgrep\" / \"node\" / \"ffmpeg\")`. If a future edit renames any of these, the eval surfaces a clear `capability_catalog missing key 'X'` error instead of a confusing top1=✗ row. Cheaper to debug at `assert!()` than at the box-drawing table."
  - "No `temp_blade_env()` call — `detect_missing_tool` is pure `(stderr, command) → Option<gap>`. This is the only Phase 16 eval that doesn't touch SQLite. Still keeps `--test-threads=1` for consistency with the verify-eval gate that runs the suite serial."
  - "Boolean integrity asserts use rr=1.0 on pass / 0.0 on fail. Keeps the EVAL-06 box-drawing format uniform across boolean (kg_integrity / typed_memory / capability_gap) and ranked-metric (hybrid_search / real_embedding) evals."
metrics:
  duration: "~5m (cargo build 3m 15s + 10.6s incremental + 0.31s test runtime)"
  completed_date: "2026-04-29"
  tasks: 1
  commits: 1
---

# Phase 16 Plan 06: Capability-Gap Classifier Eval Summary

Fifth and final Wave 2 eval added to the Phase 16 harness fleet — closes Wave 2 alongside `hybrid_search_eval` (synthetic 4-dim), `real_embedding_eval` (real fastembed), `kg_integrity_eval` (5 integrity dimensions), and `typed_memory_eval` (7-category recall + isolation). 7 stderr/command pairs feed into `self_upgrade::detect_missing_tool`: 4 positive Linux/Windows/macOS shell-not-found phrasings, 1 false-positive regression gate (`cargo build` stderr that mentions `fd-build.log` — must return `None`), and 2 negative cases (unknown tool, no not-found phrase). All 7 rows pass; MRR 1.000. EVAL-05 satisfied.

---

## What was built

**File replaced:** `src-tauri/src/evals/capability_gap_eval.rs` (Wave 1 stub 1 LOC → 206 LOC).

**Eval shape:**
- 7 `GapCase` rows — each with `(label, stderr, command, expected_suggestion_contains: Option<&str>)`:
  - `linux_apt_jq` → stderr `"/bin/sh: 1: jq: not found"` + command `jq '.foo' data.json` → expect `Some(suggestion~=jq)`
  - `linux_bash_ripgrep` → stderr `"bash: ripgrep: command not found"` + command `ripgrep 'pattern' src/` → expect `Some(suggestion~=ripgrep)`
  - `windows_cmd_node` → stderr `"'node' is not recognized as an internal or external command,\noperable program or batch file."` + command `node script.js` → expect `Some(suggestion~=node)`
  - `macos_zsh_ffmpeg` → stderr `"zsh: command not found: ffmpeg"` + command `ffmpeg -i input.mp4 out.webm` → expect `Some(suggestion~=ffmpeg)`
  - `false_positive_cargo_mentions_fd` → stderr `"error: failed to read file `/tmp/fd-build.log`: No such file or directory"` + command `cargo build` → expect `None` (the regression gate)
  - `negative_unknown_tool` → stderr `"/bin/sh: foobarbaz-cli: not found"` + command `foobarbaz-cli arg` → expect `None` (not in catalog)
  - `negative_no_not_found` → stderr `"Error: invalid argument"` + command `jq '.foo' data.json` → expect `None` (no not-found phrase)
- `case_passes()` helper resolves the 4 `(expected, observed)` quadrants:
  - `Some(needle), Some(gap)` → pass iff suggestion contains needle (case-insensitive); table shows the live suggestion
  - `Some(_), None`           → fail; table shows `<None>`
  - `None, Some(gap)`         → fail; table shows `UNEXPECTED Some("...")`
  - `None, None`              → pass; table shows `<None>`
- Pre-flight assert: `capability_catalog().contains_key(...)` for the 4 keys the eval depends on (`jq`, `ripgrep`, `node`, `ffmpeg`) — surfaces clear error if a future edit renames any.
- Per-row assert pass after the table prints, so a failed eval still emits the full diagnostic table before tripping the assert (matches sibling-eval convention).

**Helpers consumed from harness:** `print_eval_table(title, &rows)` (leads with `┌──` — EVAL-06 grep gate) + `EvalRow` struct (uniform metric carrier).

**Helpers consumed from self_upgrade:**
- `detect_missing_tool(stderr, command) -> Option<CapabilityGap>` — the SUT, at `self_upgrade.rs:260`
- `capability_catalog() -> HashMap<&'static str, CapabilityGap>` — pre-flight key check, at `self_upgrade.rs:110`
- `CapabilityGap` struct — for suggestion-text matching

**No `temp_blade_env()` call.** `detect_missing_tool` is pure — no SQLite, no env state, no I/O. This is the only Phase 16 eval that runs without the harness temp-dir helper.

---

## Run

```bash
cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1
```

**Live output:**

```text
running 1 test
test evals::capability_gap_eval::evaluates_capability_gap_detection ...
┌── Capability gap detection eval ──
│ linux_apt_jq                     top1=✓ top3=✓ rr=1.00 → top3=["Install jq for JSON processing"] (want=Some(suggestion~=jq))
│ linux_bash_ripgrep               top1=✓ top3=✓ rr=1.00 → top3=["Install ripgrep for fast file search"] (want=Some(suggestion~=ripgrep))
│ windows_cmd_node                 top1=✓ top3=✓ rr=1.00 → top3=["Install Node.js"] (want=Some(suggestion~=node))
│ macos_zsh_ffmpeg                 top1=✓ top3=✓ rr=1.00 → top3=["Install FFmpeg for media processing"] (want=Some(suggestion~=ffmpeg))
│ false_positive_cargo_mentions_fd top1=✓ top3=✓ rr=1.00 → top3=["<None>"] (want=None)
│ negative_unknown_tool            top1=✓ top3=✓ rr=1.00 → top3=["<None>"] (want=None)
│ negative_no_not_found            top1=✓ top3=✓ rr=1.00 → top3=["<None>"] (want=None)
├─────────────────────────────────────────────────────────
│ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────

ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 153 filtered out; finished in 0.31s
```

`cargo` exits 0; stdout shows `┌── Capability gap detection eval ──` (EVAL-06 contract); 4 positive cases return `Some(gap)` with the right suggestion (case-insensitive); the false-positive regression case returns `None`; both negative cases return `None`.

---

## REQ-vs-real path resolution (RESEARCH §5)

REQUIREMENTS.md EVAL-05 names `evolution::detect_missing_tool`. The live function is at `self_upgrade::detect_missing_tool` (verified at `self_upgrade.rs:260`). `evolution.rs` only exposes the related `evolution_log_capability_gap` (line 1115); there are zero re-exports between the two modules. Per RESEARCH §5 the eval imports the real path; **no re-export added** — adding one for cosmetic alignment with REQ text would be production-touching dead code. The file header doc-comment documents the resolution so a future maintainer reading the REQ doesn't go hunting in the wrong module.

REQUIREMENTS.md is a planning artifact, not a contract; the descriptive-but-wrong wording is acceptable as long as the resolution is documented at the eval entry point.

---

## Catalog key count

CLAUDE.md mentions "10+ tools" loosely; the live `capability_catalog()` returns **16 keys**: `node`, `python3`, `rust`, `docker`, `git`, `ffmpeg`, `claude`, `aider`, `jq`, `ripgrep`, `fd`, `bat`, `go`, `htop`, `tmux` (+ catalog growth surface). The eval uses 4 of them (`jq`, `ripgrep`, `node`, `ffmpeg`) for positive cases. The discrepancy between CLAUDE.md's "10" and the live "16" is a documentation drift, not a regression — flagged here per RESEARCH §7. (No fix required: CLAUDE.md is operating advice, the catalog is source-of-truth.)

---

## Decisions Made

- **Use `crate::self_upgrade::` not `crate::evolution::`.** Avoids adding production-touching re-exports for cosmetic REQ alignment. Documented in the file header.
- **Catalog key `"ripgrep"` not `"rg"`** for the ripgrep command's first token. The detector's first-whitespace-token rule requires the literal catalog key.
- **False-positive case is the regression gate, not relaxed.** Kept in the asserted floor so a future loosening of the strict matcher trips the eval.
- **Pre-flight catalog-key existence asserts.** Surfaces clear error if a future edit renames a key — better than a confusing top1=✗ table row.
- **No `temp_blade_env()`.** `detect_missing_tool` is pure; only Phase 16 eval that runs without harness temp env.
- **`--test-threads=1` retained** for consistency with the verify-eval gate that pins it for the suite.
- **Boolean integrity asserts (rr=1.0/0.0).** Matches sibling-eval convention; keeps EVAL-06 table format uniform.

---

## Deviations from Plan

None — plan executed exactly as written. The fallback logic in the plan's Step 4 (handling `linux_bash_ripgrep` if catalog key was `"rg"` instead of `"ripgrep"`) was not needed because the live catalog key is `"ripgrep"` — the plan-written fixture used the right key from the start. Equivalent behaviour: command `ripgrep 'pattern' src/` first-token = `ripgrep` ∈ catalog → match.

The plan's recovery branches for `windows_cmd_node` and false-positive divergence likewise didn't trigger.

---

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `evals/capability_gap_eval.rs` populated, ≥ 180 LOC | OK (206 LOC) |
| 2 | `use super::harness::*` import | OK |
| 3 | `use crate::self_upgrade::*` import (NOT `evolution::`) | OK |
| 4 | `fn evaluates_capability_gap_detection` present | OK |
| 5 | File header documents `evolution::` → `self_upgrade::` resolution | OK |
| 6 | All 7 case labels present | OK (linux_apt_jq, linux_bash_ripgrep, windows_cmd_node, macos_zsh_ffmpeg, false_positive_cargo_mentions_fd, negative_unknown_tool, negative_no_not_found) |
| 7 | No `todo!()` markers | OK |
| 8 | `cargo test --lib evals::capability_gap_eval --no-run --test-threads=1` exits 0 | OK |
| 9 | `cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1` exits 0 | OK |
| 10 | Stdout shows `┌── Capability gap detection eval ──` | OK |
| 11 | Stdout shows `MRR: 1.000` | OK |
| 12 | EVAL-05 marked `[x]` in REQUIREMENTS.md | OK |

---

## Wave 2 close

Plan 16-06 is the last Wave 2 plan. With this commit, Wave 2 is fully shipped:

| Plan | Status | EVAL-ID | Cargo test | Floor |
|------|--------|---------|------------|-------|
| 16-02 hybrid_search_eval | shipped | EVAL-03 (synth) | green | 8/8 + 3 adversarial |
| 16-03 real_embedding_eval | shipped | EVAL-03 (real) | green | 7/7 MRR 1.000 |
| 16-04 kg_integrity_eval | shipped | EVAL-02 | green | 5/5 dimensions |
| 16-05 typed_memory_eval | shipped | EVAL-04 | green | 8/8 (7 cats + isolation) MRR 1.000 |
| 16-06 capability_gap_eval | **shipped** | **EVAL-05** | **green** | **7/7 MRR 1.000** |

Wave 3 (Plan 16-07: verify-eval gate + DEFERRED.md + package.json + delete `embeddings.rs:496-946`) is now unblocked. EVAL-06 (scored-table format), EVAL-07 (`verify:eval` gate in `verify:all`), EVAL-08 (`tests/evals/DEFERRED.md`) all converge on Plan 16-07.

---

## Threat coverage

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-16-06-01 (Tampering — future loosening of `detect_missing_tool` re-enables spurious-install bug) | mitigate | **Mitigated** by `false_positive_cargo_mentions_fd` row in the asserted floor. Loosening the matcher (e.g. dropping the first-token catalog check, restoring the old stderr-scan behaviour) flips this row to top1=✗ and trips the per-row `assert!`. |
| T-16-06-02 (Elevation — `auto_install` triggered by synthetic gap) | accept (out of scope) | This eval does NOT call `auto_install`. The detector is pure. RESEARCH §"Out of Scope" defers `auto_install` quality eval to a later phase. |

Severity rollup: all LOW. Pure-function classification, no state mutation, no I/O.

---

## Self-Check: PASSED

- File `src-tauri/src/evals/capability_gap_eval.rs`: FOUND (206 LOC)
- Commit `d9a4d8e`: FOUND (`feat(16-06): populate capability_gap_eval — 7 cases including false-positive regression`)
- REQUIREMENTS.md EVAL-05: marked `[x]` with completion note
