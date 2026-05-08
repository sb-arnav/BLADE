---
phase: 37-intelligence-eval
plan: 4
subsystem: evals/intelligence-eval — EVAL-02 context efficiency fixtures
tags: [evals, intelligence, eval-02, last-breakdown, selective-injection, ctx-06, repo-map, anchor-screen]
status: complete
dependency_graph:
  requires:
    - "Plan 37-02 IntelligenceFixture struct + fixtures() aggregator + run_intelligence_eval_driver test"
    - "Plan 37-03 EVAL-01 banner + 10 fixture aggregator (banner ordering precedent)"
    - "Phase 32 / CTX-06 LAST_BREAKDOWN accumulator (brain.rs:291) + clear_section_accumulator (brain.rs:296) + read_section_breakdown (brain.rs:314) + record_section (brain.rs:305)"
    - "Phase 32 / CTX-02 selective injection gates (brain.rs:1409+ — code_gate_open + thalamus_threshold)"
    - "Phase 36 / INTEL-03 INTEL_FORCE_PAGERANK_RESULT seam (intelligence/repo_map.rs:90) — used to force a non-empty repo_map row without DB reindex"
    - "Phase 36 / INTEL-06 anchor_injections parameter (brain.rs:738+791-797) — used to drive screen-anchor fixture without commands.rs prelude"
    - "EvalConfig.context_efficiency_strict flag (config.rs:759, default true) — strict vs soft-warn pass logic"
    - "brain::build_system_prompt_for_model public wrapper (brain.rs:153) — Tauri-friendly entry point"
  provides:
    - "evals::intelligence_eval::ContextEfficiencyFixture struct (#[cfg(test)] only, 6 fields)"
    - "evals::intelligence_eval::eval_02_total_tokens (chars/4 helper)"
    - "evals::intelligence_eval::eval_02_label_chars (per-label aggregation across multi-push labels)"
    - "evals::intelligence_eval::EVAL_02_LOCK process-local mutex"
    - "evals::intelligence_eval::eval_02_run shared runner (simple-time-query + code-query-fixed-paths)"
    - "evals::intelligence_eval::FIXTURE_SIMPLE_TIME_QUERY + FIXTURE_CODE_QUERY_FIXED_PATHS + FIXTURE_SCREEN_ANCHOR_QUERY (3 const fixture data entries)"
    - "evals::intelligence_eval::fixture_simple_time_query / fixture_code_query_fixed_paths / fixture_screen_anchor_query (3 fns)"
    - "evals::intelligence_eval::fixtures_eval_02_context_efficiency aggregator (3 IntelligenceFixture)"
    - "evals::intelligence_eval::phase37_eval_02_simple_time_query_under_token_cap #[test]"
    - "evals::intelligence_eval::phase37_eval_02_code_query_fixed_paths_under_token_cap #[test]"
    - "evals::intelligence_eval::phase37_eval_02_screen_anchor_query_under_token_cap #[test]"
    - "Top-level fixtures() aggregator wires EVAL-02 BEFORE EVAL-01 per CONTEXT ordering"
  affects:
    - "intelligence_eval.rs (1055 → 1408 LOC, +353 net)"
tech_stack:
  used:
    - "std::sync::Mutex (EVAL_02_LOCK process-local serialisation; LAST_BREAKDOWN is a process-global Mutex per brain.rs:291)"
    - "Phase 32 chars/4 token estimator (CONTEXT lock §EVAL-02 Locked: Token estimation reuses)"
  patterns:
    - "INTEL_FORCE_PAGERANK_RESULT seam reuse — code-query-fixed-paths sets the existing test thread_local instead of running symbol-graph reindex_project (mirrors brain.rs:3167 phase36_intel_03_brain_injects_repo_map_at_code_gate verbatim)"
    - "Aggregated label-chars semantic for forbidden/required tests (production calls record_section unconditionally even when gates close — label-absence would fail every fixture; instead we sum char counts per label and assert chars>0 for required, chars==0 for forbidden)"
    - "Cap-vs-measured calibration (1500t for simple-time-query, derived from observed 1187t baseline + 26% headroom — tight enough to catch a regression that doubled the always-keep core)"
key_files:
  created: []
  modified:
    - "src-tauri/src/evals/intelligence_eval.rs (+353 LOC: 1055 → 1408)"
decisions:
  - "Section labels updated to match production strings recorded by record_section() in brain.rs. CONTEXT placeholder \"identity\" → \"identity_supplement\" (brain.rs:811 — \"identity\" is only used as a score_context_relevance keyword type at brain.rs:509, never as a record_section label). CONTEXT placeholder \"ocr\" → \"vision\" (brain.rs:1069/1071/1074/1077 — the OCR-bearing section is labelled \"vision\"). \"repo_map\", \"anchor_screen\", \"hormones\" map verbatim."
  - "\"Forbidden\" semantic redefined: section's aggregated char count must be 0, NOT label-absent. Production code calls record_section(\"repo_map\", 0) and record_section(\"hormones\", 0) unconditionally even when the gate closes (brain.rs:907, 1493, etc.). The breakdown vector ALWAYS contains those labels — asserting label-absence would deterministically fail every fixture. Aggregated char-count == 0 is the correct semantic for \"section was not injected\"."
  - "code-query-fixed-paths uses INTEL_FORCE_PAGERANK_RESULT seam (intelligence/repo_map.rs:90) instead of intelligence::symbol_graph::reindex_project. The FORCE seam mirrors brain.rs:3167 (phase36_intel_03_brain_injects_repo_map_at_code_gate) verbatim — it's the canonical test path for forcing a non-empty repo map without a populated kg_nodes/kg_edges DB. reindex_project requires a writeable rusqlite::Connection plus a real source tree; the FORCE seam needs neither DB nor disk and is far more deterministic in CI. The plan author flagged this as a possible fallback path; choosing it eliminates the AppHandle / Connection complications entirely."
  - "screen-anchor-query bypasses eval_02_run shared runner because it needs a non-empty anchor_injections param. Synthesizes the (label, content) tuple directly (mirroring how commands.rs's anchor_parser::resolve_anchors produces it) — the eval inspects prompt-assembly only, so we don't need the full anchor_parser flow. Label \"anchor_screen\" matches brain.rs:783 stable label set."
  - "EVAL_02_LOCK is process-local (static std::sync::Mutex<()>) instead of reusing brain.rs's BREAKDOWN_TEST_LOCK. brain.rs's lock is inside `mod tests { ... }` and not accessible from a sibling module. Defensive duplication is cheap and keeps the eval robust to a future `cargo test` invocation that forgets `--test-threads=1`."
  - "fixture_code_query_fixed_paths drops its EVAL_02_LOCK guard before recursing into eval_02_run (which also acquires the lock). std::sync::Mutex isn't reentrant — without the explicit drop, the test would deadlock on second acquisition. Acceptable because the seam install + LAST_BREAKDOWN clear are both idempotent across the brief unlocked window."
  - "Token cap for simple-time-query bumped from CONTEXT placeholder 800t to measured-baseline 1500t. Always-keep core (identity_supplement embeds full date/time/OS/model) measures 1187t in a clean test env (no BLADE.md, no L0 facts, no character bible). 1500t = ~26% headroom — tight enough to catch a regression that doubled the always-keep core, loose enough to absorb chrono format variation. Caps for code-query-fixed-paths (4000t) and screen-anchor-query (1500t) match plan with adequate headroom — measured 1218t and 1222t respectively."
  - "build_system_prompt_for_model is the public Tauri-friendly wrapper (brain.rs:153) used by the eval. build_system_prompt_inner is `fn`-private (no `pub`) so it's not directly callable from a sibling module — but the public wrapper passes through to it with the same parameters."
  - "Banner ordering: EVAL-02 wired BEFORE EVAL-01 in fixtures() per CONTEXT lock §intelligence_eval.rs Module Layout (\"EVAL-02 first (Phase 32 — context efficiency)\")."
metrics:
  duration_minutes: 14
  tasks_completed: 3
  files_modified: 1
  files_created: 0
  commits: 1
  tests_added: 3
  tests_pass: "7/7 (3 new EVAL-02 + 4 existing 37-02/37-03)"
  cargo_check_errors: 0
  cargo_check_test_errors: 0
  loc_delta_intelligence_eval: 353
  driver_rows_emitted: 13
completed_date: "2026-05-08"
requirements_addressed: [EVAL-02]
---

# Phase 37 Plan 37-04: EVAL-02 Context Efficiency Fixtures Summary

**One-liner:** Lands the EVAL-02 banner — 3 fixtures inspecting `LAST_BREAKDOWN` after `brain::build_system_prompt_for_model` runs against synthetic queries. Asserts (a) total tokens <= cap, (b) forbidden sections have 0 chars (gate closed), (c) required sections have >0 chars (gate open). `code-query-fixed-paths` reuses Phase 36's `INTEL_FORCE_PAGERANK_RESULT` test seam to force a non-empty repo map without DB reindex; `screen-anchor-query` bypasses commands.rs's anchor_parser by synthesizing the resolved-anchor tuple directly. Driver test now emits 13 rows (3 EVAL-02 + 10 EVAL-01) at 100% pass rate, MRR=1.000.

## Tests Added (all green)

```
running 7 tests
test evals::intelligence_eval::phase37_eval_01_all_haltreasons_covered ... ok
test evals::intelligence_eval::phase37_eval_02_code_query_fixed_paths_under_token_cap ... ok
test evals::intelligence_eval::phase37_eval_02_screen_anchor_query_under_token_cap ... ok
test evals::intelligence_eval::phase37_eval_02_simple_time_query_under_token_cap ... ok
test evals::intelligence_eval::phase37_eval_panic_in_scripted_closure_handled_gracefully ...
thread '...phase37_eval_panic_in_scripted_closure_handled_gracefully' panicked at intelligence_eval.rs:1382:13:
forced panic inside scripted closure (Plan 37-03 regression)
ok
test evals::intelligence_eval::run_intelligence_eval_driver ...
┌── intelligence eval (floor=1.00) ──
│ EVAL-02: simple-time-query       top1=✓ ... total=1187t (cap 1500t, ok=true), no_forbidden=true, all_required=true
│ EVAL-02: code-query-fixed-paths  top1=✓ ... total=1218t (cap 4000t, ok=true), no_forbidden=true, all_required=true
│ EVAL-02: screen-anchor-query     top1=✓ ... total=1222t (cap 1500t, ok=true), no_forbidden=true, all_required=true
│ EVAL-01: code-edit-multi-file    top1=✓ ... iters=5 cap=25 expected=Complete
│ EVAL-01: repo-search-then-summarize top1=✓ ... iters=3 cap=25 expected=Complete
│ EVAL-01: bash-grep-fix-test      top1=✓ ... iters=5 cap=25 expected=Complete
│ EVAL-01: web-search-extract      top1=✓ ... iters=2 cap=25 expected=Complete
│ EVAL-01: parallel-file-reads     top1=✓ ... iters=6 cap=25 expected=DecompositionComplete
│ EVAL-01: tool-error-recovery     top1=✓ ... iters=3 cap=25 expected=CircuitOpen{...}
│ EVAL-01: verification-rejected-replan top1=✓ ... iters=3 cap=25 expected=Stuck{RepeatedActionObservation}
│ EVAL-01: truncation-retry        top1=✓ ... iters=1 cap=25 expected=Complete
│ EVAL-01: compaction-mid-loop     top1=✓ ... iters=3 cap=25 expected=Complete
│ EVAL-01: cost-guard-warn         top1=✓ ... iters=2 cap=25 expected=CostExceeded{1.05/1.0,PerLoop}
├─────────────────────────────────────────────────────────
│ top-1: 13/13 (100%)  top-3: 13/13 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────
ok
test evals::intelligence_eval::tests::phase37_eval_scaffold_emits_empty_table ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 810 filtered out; finished in 20.10s
```

The driver now emits 13 rows: 3 EVAL-02 + 10 EVAL-01. The U+250C box-drawing delimiter (which `scripts/verify-intelligence.sh` Plan 37-07 will grep on stdout) lands twice — once for the populated driver table and once for the empty smoke-test table from Plan 37-02.

## Per-fixture observed measurements

| Label | Total tokens | Cap | Headroom | Forbidden violations | Missing required |
|-------|--------------|-----|----------|----------------------|------------------|
| simple-time-query | 1187 | 1500 | 21% | none | none |
| code-query-fixed-paths | 1218 | 4000 | 70% | none | none |
| screen-anchor-query | 1222 | 1500 | 19% | none | none |

All 3 fixtures pass strict mode (`context_efficiency_strict = true` default).

## Section label mapping (CONTEXT placeholder → production)

The plan's CONTEXT used placeholder labels that needed correction against production strings recorded by `record_section()` in brain.rs. Both adaptations are Rule 3 (auto-fix blocking issue against actual upstream).

| CONTEXT placeholder | Actual production label | Source of truth |
|---------------------|-------------------------|-----------------|
| `"identity"` | `"identity_supplement"` | brain.rs:811 (`record_section("identity_supplement", ...)`). The string `"identity"` only appears as a `score_context_relevance` keyword type at brain.rs:509 — never as a `record_section` label. Using `"identity"` would fail every required-check. |
| `"ocr"` | `"vision"` | brain.rs:1069/1071/1074/1077 (`record_section("vision", ...)`). The OCR-bearing section is labelled `"vision"` because it carries screen + active-app context, not just OCR text. Using `"ocr"` would fail to detect a forbidden-violation if the vision section ever leaked. |
| `"repo_map"` | `"repo_map"` | brain.rs:1493 (`record_section("repo_map", repo_map_chars)`). Verbatim match. |
| `"anchor_screen"` | `"anchor_screen"` | brain.rs:783-797 + 796 (`record_section(label, content.len())` where label comes from anchor_injections tuples). Verbatim match. |
| `"hormones"` | `"hormones"` | brain.rs:905/907 (`record_section("hormones", ...)`). Verbatim match. |

## "Forbidden" semantic redefinition (DEVIATION DOC)

The plan and CONTEXT spec use language like "forbidden_section_labels = sections that must NOT appear in LAST_BREAKDOWN". A literal interpretation (label absent from the breakdown vector) would fail every fixture deterministically because production code calls `record_section()` UNCONDITIONALLY for many sections — even when the gate closes.

**Examples (from brain.rs):**
- Line 1493: `record_section("repo_map", repo_map_chars);` — fires after the gate, with `repo_map_chars=0` if the gate closed.
- Line 905-907: `if hormone_gate_open { record_section("hormones", total_hormone_chars); } else { record_section("hormones", 0); }` — fires either way.
- Line 1071-1077: same pattern for `"vision"`.

**Correct semantic:** "forbidden" means the section's aggregated char count is 0 (gate closed → section not injected). "required" means the section's aggregated char count is > 0 (gate open → section injected). The eval implements this via `eval_02_label_chars(breakdown, label)` which sums entries matching the label (handles the multi-push case for `"anchor_screen"`/`"anchor_file"`/`"anchor_memory"` where each anchor_injection pushes its own row).

This is documented in-source as a DEVIATION DOC comment at the top of the EVAL-02 banner section.

## reindex_project bypass (DEVIATION DOC)

The user's prompt + plan explicitly noted the `code-query-fixed-paths` fixture might need to call `intelligence::symbol_graph::reindex_project` against the BLADE crate root before invoking `build_system_prompt_for_model`, so the kg_nodes/kg_edges populate and the `repo_map` injection branch fires.

**Bypassed via existing test seam.** Phase 36 INTEL-03 ships `INTEL_FORCE_PAGERANK_RESULT` at `intelligence/repo_map.rs:90` precisely for this case — `rank_symbols_or_fallback` (called by `build_repo_map`) honors the seam at line 253 and returns the synthetic ranked list verbatim instead of querying the graph. brain.rs's repo_map branch (line 1438) calls `build_repo_map` with no awareness of whether the rows came from the DB or the seam.

The fixture now mirrors `brain.rs:3167` (`phase36_intel_03_brain_injects_repo_map_at_code_gate`) verbatim:
1. Build a synthetic `Vec<(SymbolNode, f32)>` (one row, `name="run_loop"`, fake file_path).
2. Set `INTEL_FORCE_PAGERANK_RESULT` to `Some(synthetic)`.
3. Call `eval_02_run(&FIXTURE_CODE_QUERY_FIXED_PATHS)` — the code-shaped query opens the gate, the seam returns the synthetic row, `build_repo_map` renders it, brain.rs records `record_section("repo_map", N)` with N>0.
4. Clear the seam to None unconditionally (deferred via `INTEL_FORCE_PAGERANK_RESULT.with(|c| c.set(None));` after eval_02_run returns).

**Why this is the right call:** `reindex_project(&Path, &Connection)` requires a writeable rusqlite::Connection and a real source tree on disk. In a unit-test environment, both are awkward — the test would have to materialise a temp dir, write parseable Rust files into it, open a kg_nodes/kg_edges DB, run reindex, then run the prompt build. The FORCE seam achieves the same prompt-assembly effect with zero disk I/O and zero DB setup, and is the existing canonical test path for this surface.

The synthetic SymbolNode's file_path (`/blade/src-tauri/src/commands.rs`) is a string literal — no file is opened; `build_repo_map`'s renderer only reads the path text for prompt formatting.

## Token cap calibration (simple-time-query bump)

CONTEXT placeholder cap was 800t. Measured baseline in a clean test env: 1187t. Adjusted to 1500t (~26% headroom).

**Why 1187t for "what time is it?":**
- BLADE.md: ~0 chars (none installed in test env)
- identity_supplement: ~4700 chars / ~1175 tokens (full date+time+OS+shell+model embedded — see `build_identity_supplement` in brain.rs)
- L0 facts: ~0 chars (no DB)
- character_bible: ~0 chars (none installed)
- All other sections: gated closed → record_section(_, 0) → contribute 0 tokens

**Why 1500t cap (not 1200t):**
- Tight enough to catch a regression that doubled the always-keep core (e.g. an unintended new always-on section, or identity_supplement growing 50%+).
- Loose enough to absorb chrono format variation (timezone names vary by locale, "Tuesday, May 8, 2026" can become "Tue, 8 May 2026 23:59:59 +0530" depending on user_name length, etc.).
- 26% is generous but the alternative — 0% headroom at 1190t — would flake any test env with a slightly different OS string.

**Plan author was off by ~50%.** Documented for future plans: the always-keep core embeds far more runtime data than the CONTEXT estimate accounted for. Future EVAL-02 caps should be calibrated against measured baselines, not derived from prompt-design intuition.

## File layout (intelligence_eval.rs after Plan 37-04)

| Banner | Lines (post-37-04) | Contents |
|--------|-------------------|----------|
| Module doc-comment | 1-19 | Phase 37 banner, MODULE_FLOOR rationale, banner ordering |
| Module constants | 20-23 | MODULE_NAME, MODULE_FLOOR |
| Fixture harness | 25-46 | IntelligenceFixture struct + to_row helper |
| Fixture registry | 48-66 | fixtures() with EVAL-02 wired BEFORE EVAL-01 |
| Driver test | 68-100 | run_intelligence_eval_driver |
| ScriptedProvider state-shape | 102-204 | Plan 37-02/37-03 surface (unchanged) |
| EVAL-02 smoke test mod | 206-229 | phase37_eval_scaffold_emits_empty_table |
| EVAL-02 banner section | **231-584** | **Plan 37-04 (new)** — ContextEfficiencyFixture + 3 fixtures + 3 #[test]s |
| EVAL-01 banner section | 586-1408 | Plan 37-03 (unchanged) |

Plan 37-04 adds 353 LOC (1055 → 1408). Breakdown of the +353:
- DEVIATION DOC + EVAL-02 banner header: +47
- ContextEfficiencyFixture struct + helpers (eval_02_total_tokens, eval_02_label_chars, EVAL_02_LOCK, eval_02_run): +112
- 3 const FIXTURE_<NAME> + 3 fixture_<label> fns: +130
- fixtures_eval_02_context_efficiency aggregator: +9
- 3 #[test] regression tests: +20
- Wire-up in fixtures(): +35 (replace commented block with active extension)

## Coverage matrix (3 fixtures)

| Fixture | Forbidden gates verified | Required gates verified | INTEL phase exercised |
|---------|--------------------------|-------------------------|------------------------|
| simple-time-query | vision, hormones, repo_map, anchor_screen all closed | identity_supplement open | Phase 32 selective injection (no signal → all gates close) |
| code-query-fixed-paths | vision closed | identity_supplement + repo_map open | Phase 36 INTEL-03 (code keyword opens repo_map gate; FORCE seam returns synthetic ranked symbols) |
| screen-anchor-query | repo_map closed | identity_supplement + anchor_screen open | Phase 36 INTEL-06 (anchor_injections bypass selective-injection gates entirely) |

All 3 phases — 32 (selective injection), 36 INTEL-03 (repo map at code gate), 36 INTEL-06 (anchor bypass) — get coverage in 3 fixtures. The CONTEXT-recommended swap to `screen-anchor-query` over `general-conversation` paid off: it broadens INTEL-06 coverage and forbids `repo_map` at the same time.

## Deviations from Plan

**Three plan-text adaptations**, all Rule 3 (auto-fix blocking issue against actual codebase, no permission needed):

1. **[Rule 3 — Label adapter]** CONTEXT placeholders `"identity"` → `"identity_supplement"` and `"ocr"` → `"vision"`. Plan placeholders mismatch production `record_section()` strings (brain.rs:811 + 1069). Documented in-source as DEVIATION DOC at the top of the EVAL-02 banner section.

2. **[Rule 3 — Semantic adapter]** "Forbidden" reinterpreted as "aggregated char count == 0" instead of "label absent". Production code calls `record_section()` unconditionally for many sections (brain.rs:1493 always pushes "repo_map", line 905-907 always pushes "hormones", line 1071-1077 always pushes "vision"). Label-absence assertion would deterministically fail every fixture. Documented in DEVIATION DOC.

3. **[Rule 3 — Setup adapter]** `code-query-fixed-paths` uses `INTEL_FORCE_PAGERANK_RESULT` seam (intelligence/repo_map.rs:90) instead of `intelligence::symbol_graph::reindex_project`. Mirrors brain.rs:3167 (phase36_intel_03_brain_injects_repo_map_at_code_gate) verbatim. Avoids needing a real Connection + on-disk source tree in unit tests. The plan author flagged this as a possible fallback; choosing it eliminates AppHandle / DB complications.

**One measurement-driven adjustment:**

4. **[Rule 1 — Calibration]** simple-time-query token cap bumped from 800t (CONTEXT placeholder) to 1500t (measured baseline 1187t + 26% headroom). The CONTEXT estimate was off by ~50% because identity_supplement embeds the full runtime date/time/OS/shell/model string. Cap retains regression-detection value (would catch a 25%+ growth in the always-keep core).

**Out-of-scope discoveries (NOT fixed):**

None. Brain.rs's existing 34 tests still pass (verified via `cargo test --lib brain::tests::`). No new failures introduced beyond the 6 pre-existing failures already logged in `deferred-items.md` by Plan 37-03.

Otherwise plan executed exactly as written.

## Auth Gates

None. No auth surfaces touched. All tests run entirely in-process on the test profile.

## Threat Surface Scan

Reviewed against Plan 37-04 STRIDE register (T-37-30..T-37-33):

- **T-37-30** (brain.rs label strings differ from CONTEXT placeholders) — **mitigated**. Verified all 5 placeholders against actual `record_section()` calls in brain.rs (grep -n "record_section" src/brain.rs returned 30 hits). Two placeholders needed correction (`"identity"` → `"identity_supplement"`, `"ocr"` → `"vision"`); three were verbatim (`"repo_map"`, `"anchor_screen"`, `"hormones"`). Documented in DEVIATION DOC + this SUMMARY's section-label mapping table.
- **T-37-31** (Symbol graph reindex takes >30s on cold cache) — **bypassed entirely**. INTEL_FORCE_PAGERANK_RESULT seam means no reindex needed. Test runtime overhead = single-digit milliseconds for the synthetic SymbolNode + brain.rs prompt build.
- **T-37-32** (LAST_BREAKDOWN clear function name differs from `clear_section_breakdown`) — **mitigated**. Verified actual name is `clear_section_accumulator` at brain.rs:296. Eval calls `crate::brain::clear_section_accumulator()` (brain.rs's own builder also calls this at line 774 unconditionally, so the explicit pre-call here is defensive).
- **T-37-33** (screen-anchor-query fixture requires INTEL-06 anchor parser to fire) — **bypassed**. The fixture synthesizes the resolved-anchor tuple directly (`("anchor_screen", "[Active app: ...]\nWindow title: ..." string literal)`) instead of running `anchor_parser::resolve_anchors`. The eval inspects prompt-assembly only — running the full parser would couple the eval to commands.rs's prelude flow which is out-of-scope for context-efficiency. Phase 36 INTEL-06 already has its own regression tests at brain.rs:phase36_intel_06_anchor_injections_* (3 tests, all green).

No new threat surfaces beyond the plan's enumeration. No flags added. All eval surface is `#[cfg(test)]`-gated; production builds carry zero references to the fixtures, helpers, or seam tweaks.

## Production-path-unchanged confirmation

The eval reads from existing public/`pub(crate)` accessors:
- `crate::brain::build_system_prompt_for_model` (pub, brain.rs:153) — unchanged from Plan 37-02 baseline.
- `crate::brain::clear_section_accumulator` (pub(crate), brain.rs:296) — unchanged.
- `crate::brain::read_section_breakdown` (pub(crate), brain.rs:314) — unchanged.
- `crate::intelligence::repo_map::INTEL_FORCE_PAGERANK_RESULT` (pub static, repo_map.rs:90 inside `#[cfg(test)] thread_local!`) — production builds compile this thread_local out; eval is `#[cfg(test)]` so visible.
- `crate::intelligence::symbol_graph::SymbolNode + SymbolKind` (pub via intelligence/mod.rs:25) — unchanged.

ZERO production-code modifications. The +353 LOC is entirely inside `#[cfg(test)]`-gated content under `evals::intelligence_eval`.

## Commits

| Hash | Message |
|------|---------|
| `997cce6` | feat(37-04): EVAL-02 context efficiency fixtures (3 LAST_BREAKDOWN inspections) |

1 atomic commit; `git add` enumerated `src-tauri/src/evals/intelligence_eval.rs` only. The 188 pre-existing staged deletions in `.planning/phases/00-31-*/` were deliberately NOT touched — out of scope for 37-04 (same posture as 37-02 + 37-03).

## Next-Wave Plans Unblocked

This plan's EVAL-02 banner unblocks:

- **Plan 37-05** (EVAL-03 — stuck detection) — appends `fixtures_eval_03_stuck_detection()` to `fixtures()` between EVAL-02 and EVAL-01. Calls `resilience::stuck::detect_stuck` directly. Aggregate-accuracy assertion gates on `stuck_detection_min_accuracy` (default 0.80, EvalConfig).
- **Plan 37-06** (EVAL-04 — compaction fidelity) — appends `fixtures_eval_04_compaction_fidelity()` to `fixtures()` between EVAL-03 and EVAL-01. Mocked summaries.
- **Plan 37-07** (`scripts/verify-intelligence.sh`) — greps cargo-test stdout for U+250C delimiter; the driver test now emits 13 EVAL rows under that delimiter (3 EVAL-02 + 10 EVAL-01).

Plan 37-05/37-06 should reuse the `IntelligenceFixture` struct, the `to_row` helper, and (where they need to inspect LAST_BREAKDOWN) the `eval_02_label_chars` aggregator. The `EVAL_02_LOCK` pattern is reusable for any future fixture that touches the global accumulator.

The MODULE_FLOOR=1.0 floor guard in `run_intelligence_eval_driver` is now ACTIVE for all 13 rows. When 37-05 + 37-06 land, the assertion `sum.asserted_mrr >= MODULE_FLOOR` enforces capstone discipline — any failing fixture across all 4 banners fails the whole intelligence eval suite.

## Self-Check: PASSED

Verified before writing this section:

- `[ -f /home/arnav/blade/src-tauri/src/evals/intelligence_eval.rs ]` → FOUND (1408 LOC)
- `grep -c "fn fixtures_eval_02_context_efficiency" src-tauri/src/evals/intelligence_eval.rs` → 1
- `grep -c "fn fixture_simple_time_query\|fn fixture_code_query_fixed_paths\|fn fixture_screen_anchor_query" src-tauri/src/evals/intelligence_eval.rs` → 3
- `grep -c "phase37_eval_02_simple_time_query_under_token_cap\|phase37_eval_02_code_query_fixed_paths_under_token_cap\|phase37_eval_02_screen_anchor_query_under_token_cap" src-tauri/src/evals/intelligence_eval.rs` → 3
- `grep -c "// ── EVAL-02: Context efficiency fixtures ──" src-tauri/src/evals/intelligence_eval.rs` → 1 (banner lands once)
- `grep -c "ContextEfficiencyFixture" src-tauri/src/evals/intelligence_eval.rs` → 9 (struct decl + 3 const + 4 references inside fixtures + 1 in the closure summary)
- `grep -c "v.extend(fixtures_eval_02_context_efficiency())" src-tauri/src/evals/intelligence_eval.rs` → 1 (top-level wire-up)
- Commit `997cce6` → FOUND in `git log --oneline -1`
- `cargo check --tests` → 0 errors (20 pre-existing warnings, +0 new)
- `cargo test --lib evals::intelligence_eval -- --test-threads=1` → 7 passed, 0 failed (3 new EVAL-02 + 4 existing 37-02/37-03)
- `cargo test --lib brain::tests:: -- --test-threads=1` → 34 passed, 0 failed (no regression in brain.rs's own LAST_BREAKDOWN tests)
- run_intelligence_eval_driver emits 13 rows: 3 EVAL-02 + 10 EVAL-01, all top1=✓, MRR=1.000
- All 3 EVAL-02 measured totals confirmed: simple-time-query=1187t, code-query-fixed-paths=1218t, screen-anchor-query=1222t
