//! Eval harness — Phase 16 (.planning/phases/16-eval-scaffolding-expansion).
//!
//! Resolves with `cargo test --lib evals -- --nocapture --test-threads=1`.
//! Each submodule prints a scored table in the format defined by
//! `harness::print_eval_table` (EVAL-06 contract: lead with `┌──`).
//!
//! See also: `tests/evals/DEFERRED.md` for v1.3 candidates (EVAL-08).
//! See also: `scripts/verify-eval.sh` for the CI gate (EVAL-07).

#[cfg(test)] pub mod harness;
#[cfg(test)] mod hybrid_search_eval;
#[cfg(test)] mod real_embedding_eval;
#[cfg(test)] mod kg_integrity_eval;
#[cfg(test)] mod typed_memory_eval;
#[cfg(test)] mod capability_gap_eval;
#[cfg(test)] mod adversarial_eval;            // Phase 23 / REWARD-05
#[cfg(test)] mod ambiguous_intent_eval;       // Phase 23 / REWARD-05
#[cfg(test)] mod capability_gap_stress_eval;  // Phase 23 / REWARD-05
#[cfg(test)] mod safety_eval;              // Phase 26 / SAFE-07
#[cfg(test)] mod hormone_eval;             // Phase 27 / HORM-01..09
#[cfg(test)] mod active_inference_eval;    // Phase 28 / AINF-01..06
#[cfg(test)] mod vitality_eval;            // Phase 29 / VITA-01..06
#[cfg(test)] mod organism_eval;            // Phase 30 / OEVAL-01..05
#[cfg(test)] mod intelligence_eval;        // Phase 37 / EVAL-01..05
