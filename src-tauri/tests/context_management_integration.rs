//! Phase 32 integration test harness.
//!
//! Plans 32-03..07 fill these in. This file lands in Wave 1 (Plan 32-02) so the
//! cargo test runner has a registered integration target from the start;
//! follow-up plans only ADD test fns, never edit this preamble.
//!
//! Crate name observed in `src-tauri/Cargo.toml`:
//!   [package].name = "blade"     (binary)
//!   [lib].name     = "blade_lib" (library — what integration tests import)
//!
//! So `use blade_lib::...` (not `use blade::...`).
//!
//! Each test must:
//! - Run in <1s wall clock (use the synthetic ConversationMessage fixture, no
//!   real LLM calls).
//! - Reset any test-overrides (e.g. `CTX_SCORE_OVERRIDE` from `brain.rs`) before
//!   the test returns. Note: `brain` is currently a private module on the lib
//!   crate, so seam access from this integration target requires the brain
//!   module to be made `pub mod brain` (or via a re-export) in a follow-up
//!   plan. Today, override-driven integration tests live as `#[cfg(test)]
//!   mod tests` blocks INSIDE `src-tauri/src/brain.rs` (where `super::*` works).
//! - Use the public crate API only — `super::*` does NOT exist in integration
//!   targets. Imports must come from the public surface of `blade_lib`.

use blade_lib::config::ContextConfig;

#[test]
fn phase32_integration_placeholder() {
    // Plans 32-03..07 add real cases. This stub exists so `cargo test --test
    // context_management_integration` registers the target file from Wave 1.
    //
    // Touching `ContextConfig::default()` here is a free smoke check that the
    // public type round-trips through the integration boundary; if a future
    // plan accidentally removes the pub re-export the failure surfaces here.
    let cfg = ContextConfig::default();
    assert!(
        cfg.smart_injection_enabled,
        "default ContextConfig must have smart_injection_enabled = true (CTX-07 escape hatch on by default)"
    );
    assert!(
        (cfg.relevance_gate - 0.2).abs() < 1e-6,
        "default relevance_gate must be 0.2, got {}",
        cfg.relevance_gate
    );
    assert!(
        (cfg.compaction_trigger_pct - 0.80).abs() < 1e-6,
        "default compaction_trigger_pct must be 0.80, got {}",
        cfg.compaction_trigger_pct
    );
    assert_eq!(
        cfg.tool_output_cap_tokens, 4000,
        "default tool_output_cap_tokens must be 4000, got {}",
        cfg.tool_output_cap_tokens
    );
}
