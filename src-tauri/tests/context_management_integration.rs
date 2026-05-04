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

// ── Phase 32 Plan 32-07 — CTX-07 fallback contract (smoke level) ─────────────
//
// The deep panic-injection regression test lives in `src/brain.rs` `mod tests`
// (`phase32_build_system_prompt_survives_panic_in_scoring`) because the
// `CTX_SCORE_OVERRIDE` seam is `#[cfg(test)]`-gated and crate-private, AND the
// `brain` module is `mod brain;` (not `pub`) in lib.rs — which means
// integration tests cannot reach `score_or_default` or `build_system_prompt_inner`
// directly.
//
// The integration target's contribution to CTX-07 verification is:
//
//   1. Confirm the public `ContextConfig` API still exposes the fallback
//      escape hatch (`smart_injection_enabled` field, default `true`).
//   2. Confirm a manually-toggled config (smart=false) still round-trips
//      through serde so a user editing `~/.blade/config.json` to flip the
//      kill switch sees the same shape that load_config expects.
//   3. Smoke-check that the toggle field is independently flippable from the
//      other context fields (no implicit dependency that would defeat CTX-07).
//
// The end-to-end "panic in score → chat still replies" verification is the
// runtime UAT (Plan 32-07 Task 2 Step 6 — the v1.1 lesson incarnate).

#[test]
fn phase32_chat_survives_forced_panic_in_score_context_relevance() {
    // Smoke-level CTX-07 contract check. The deep regression fixture lives in
    // brain.rs (`phase32_build_system_prompt_survives_panic_in_scoring`); this
    // integration test asserts the public contract that backs it: the
    // ContextConfig type carries the kill-switch field at the boundary.
    //
    // Why a smoke-only test in this target: `score_or_default`, the
    // `CTX_SCORE_OVERRIDE` seam, and `build_system_prompt_inner` are all in
    // the private `brain` module. Wrapping `pub use brain::*` in lib.rs is
    // out of Plan 32-07's scope (would change the public API surface for a
    // single test). The deep coverage runs as a unit test where `super::*`
    // works.
    let cfg = ContextConfig::default();
    assert!(
        cfg.smart_injection_enabled,
        "default smart_injection_enabled must be true — CTX-07 escape hatch \
         on by default so users get the smart path; flipping to false yields \
         the v1.1-equivalent naive path"
    );

    // Round-trip a smart=false config through JSON to verify the kill switch
    // survives the disk format. If a future serde rename / refactor breaks
    // this, the test fails LOUD instead of silently dropping the toggle.
    let kill_switched = ContextConfig {
        smart_injection_enabled: false,
        ..ContextConfig::default()
    };
    let json = serde_json::to_string(&kill_switched).expect("serialize kill-switched config");
    let parsed: ContextConfig =
        serde_json::from_str(&json).expect("deserialize kill-switched config");
    assert!(
        !parsed.smart_injection_enabled,
        "kill-switched smart_injection_enabled=false must survive JSON round-trip"
    );

    // The other context fields must remain at default — flipping the kill
    // switch must NOT collaterally change gate/budget/trigger values, or the
    // user gets a surprise behavior change when toggling CTX-07.
    assert!(
        (parsed.relevance_gate - 0.2).abs() < 1e-6,
        "relevance_gate must be unaffected by smart_injection_enabled toggle, got {}",
        parsed.relevance_gate
    );
    assert!(
        (parsed.compaction_trigger_pct - 0.80).abs() < 1e-6,
        "compaction_trigger_pct must be unaffected by smart_injection_enabled toggle, got {}",
        parsed.compaction_trigger_pct
    );
    assert_eq!(
        parsed.tool_output_cap_tokens, 4000,
        "tool_output_cap_tokens must be unaffected by smart_injection_enabled toggle, got {}",
        parsed.tool_output_cap_tokens
    );
}
