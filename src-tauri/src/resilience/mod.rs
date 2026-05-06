// src-tauri/src/resilience/mod.rs
//
// Phase 34 — Resilience module. Houses RES-01 stuck detection (`stuck.rs`)
// and RES-05 provider fallback (`fallback.rs`). RES-02 (circuit breaker)
// reuses commands::record_error / is_circuit_broken — no submodule needed.
// RES-03 + RES-04 (cost tracking + warn-at-80%) live on LoopState in
// loop_engine.rs — no submodule needed.
//
// Plan 34-03 ships the EMPTY scaffolding. Plan 34-04 fills stuck.rs.
// Plan 34-07 fills fallback.rs.

pub mod stuck;
pub mod fallback;
