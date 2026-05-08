# Phase 37 — Deferred Items (out-of-scope discoveries)

## From Plan 37-02 execution

### `evals::organism_eval::evaluates_organism` — pre-existing failure

**Status:** PRE-EXISTING — unrelated to Plan 37-02 changes.

**Failure mode:**
```
[organism] failed fixtures: ["OEVAL-01c: timeline recovery arc"]
organism: pass rate 0.923 below floor 1.000
```

**Why out of scope:**
- Plan 37-02 touched only `src-tauri/src/loop_engine.rs`, `src-tauri/src/evals/intelligence_eval.rs` (new file), and `src-tauri/src/evals/mod.rs`.
- Organism eval has zero import of `loop_engine` or `EVAL_FORCE_PROVIDER`.
- `fixture_timeline_recovery_arc` exercises `vitality_engine` tick math + brain_reactions seeding — pure SQLite + Vitality state, no provider seam.
- Last touch on `organism_eval.rs` was Phase 30-02 commit `8e79367` (months before Phase 37 was authored). This failure pre-dates 37-02 entirely.
- Re-ran in isolation; deterministic failure, not parallelism-driven.

**Triage owner:** Phase 30 / OEVAL-01 (organism eval). NOT Phase 37.

**Action recommended:** revisit `fixture_timeline_recovery_arc` floor — likely a vitality tick-count drift since 29-05 onboarded the engine. Could be a 1-tick timing tolerance issue in the assertion. Out of scope for Phase 37-02 scaffolding work.
