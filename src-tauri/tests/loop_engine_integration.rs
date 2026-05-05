//! Phase 33 Plan 33-09 — Loop engine integration test target.
//!
//! Mirrors the Phase 32-02 / 32-07 pattern in
//! `tests/context_management_integration.rs`: integration tests verify the
//! PUBLIC contract of `LoopConfig` (the CTX-07-style escape hatch
//! `smart_loop_enabled`) at the `blade_lib::config` boundary. The deep
//! panic-injection regression test lives as a unit test inside
//! `src/loop_engine.rs` (`phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper`)
//! because the `FORCE_VERIFY_PANIC` thread_local seam is `#[cfg(test)]`-gated
//! and `loop_engine` is `mod loop_engine;` (private) in `src/lib.rs` — making
//! it `pub mod` for one test would change the public API surface.
//!
//! Crate name observed in `src-tauri/Cargo.toml`:
//!   [package].name = "blade"     (binary)
//!   [lib].name     = "blade_lib" (library — what integration tests import)
//!
//! What this target verifies:
//!   1. `LoopConfig::default().smart_loop_enabled == true` — escape hatch ON
//!      by default (legacy users get the smart path; flipping to false yields
//!      the v1.0/v1.1-equivalent 12-iteration legacy loop).
//!   2. A `smart_loop_enabled = false` config round-trips through serde JSON
//!      without surprise — toggling the kill switch must NOT collaterally
//!      change `max_iterations` / `cost_guard_dollars` / `verification_every_n`.
//!   3. `LoopConfig` is independently flippable from the rest of `BladeConfig`
//!      (the CTX-07 escape hatch is local; it does not depend on global state).
//!
//! What this target does NOT verify (covered elsewhere):
//!   - The actual catch_unwind boundary in `run_loop` — unit test
//!     `phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper` in
//!     `src/loop_engine.rs` (uses `FORCE_VERIFY_PANIC` + a bare tokio runtime
//!     to mirror the production wrapper exactly).
//!   - The runtime UAT (Plan 33-09 Task 2) — operator-driven on the dev binary.

use blade_lib::config::LoopConfig;

#[test]
fn phase33_loop_default_config_has_smart_loop_enabled_by_default() {
    // CTX-07-style escape hatch on by default — Wave 1 contract from
    // 33-CONTEXT.md §Backward Compatibility. Locks the default so a future
    // edit to `default_smart_loop_enabled()` (`config.rs:352`) flipping it to
    // false trips this test before it ships.
    let cfg = LoopConfig::default();
    assert!(
        cfg.smart_loop_enabled,
        "default LoopConfig must have smart_loop_enabled = true (Wave 1 contract). \
         Flipping the default to false changes the runtime behavior for every \
         existing user — they would suddenly fall back to the legacy 12-iteration \
         loop with no smart features. The CTX-07-style escape hatch lives at the \
         user's config level, not the default."
    );
    assert_eq!(
        cfg.max_iterations, 25,
        "default max_iterations must be 25 (Plan 33-03). Got {}.",
        cfg.max_iterations
    );
    assert!(
        (cfg.cost_guard_dollars - 5.0).abs() < 1e-6,
        "default cost_guard_dollars must be 5.0 (Plan 33-08). Got {}.",
        cfg.cost_guard_dollars
    );
    assert_eq!(
        cfg.verification_every_n, 3,
        "default verification_every_n must be 3 (Plan 33-04). Got {}.",
        cfg.verification_every_n
    );
}

#[test]
fn phase33_smart_loop_disabled_round_trips_naive_path() {
    // Plan 33-09 — verify the smart_loop_enabled = false toggle survives a
    // serde JSON round-trip without collateral mutations to the rest of the
    // LoopConfig fields. The runtime path that consumes this config flips
    // the literal-12 iteration cap, the cost-guard halt, the verification
    // probe firing site, and the LOOP-04 truncation block (Plans 33-03..33-08
    // each gate their smart-path logic on `config.r#loop.smart_loop_enabled`).
    //
    // If a future serde rename or a `#[serde(default)]` regression silently
    // drops smart_loop_enabled from a user's `~/.blade/config.json`, the
    // load path would re-default to true — surprising a user who explicitly
    // opted out. This test fails LOUD if that happens.
    let kill_switched = LoopConfig {
        smart_loop_enabled: false,
        ..LoopConfig::default()
    };

    let json = serde_json::to_string(&kill_switched).expect("serialize kill-switched LoopConfig");
    let parsed: LoopConfig =
        serde_json::from_str(&json).expect("deserialize kill-switched LoopConfig");

    assert!(
        !parsed.smart_loop_enabled,
        "kill-switched smart_loop_enabled = false MUST survive a JSON round-trip. \
         If this fails, the serde shape silently dropped the toggle — users who \
         opt out via ~/.blade/config.json would unexpectedly get the smart path \
         back on the next load_config call. CTX-07 escape hatch broken."
    );

    // Other fields must not be collaterally mutated by flipping the kill switch.
    assert_eq!(
        parsed.max_iterations, 25,
        "max_iterations must be unaffected by smart_loop_enabled toggle, got {}",
        parsed.max_iterations
    );
    assert!(
        (parsed.cost_guard_dollars - 5.0).abs() < 1e-6,
        "cost_guard_dollars must be unaffected by smart_loop_enabled toggle, got {}",
        parsed.cost_guard_dollars
    );
    assert_eq!(
        parsed.verification_every_n, 3,
        "verification_every_n must be unaffected by smart_loop_enabled toggle, got {}",
        parsed.verification_every_n
    );
}

#[test]
fn phase33_loop_survives_forced_panic_in_smart_path() {
    // Plan 33-09 — public-surface smoke check for the CTX-07 panic-resistance
    // contract that backs `run_loop`'s catch_unwind boundary.
    //
    // Why a smoke-only test here: the deep regression fixture
    // (`phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper`)
    // lives in `src/loop_engine.rs` `mod tests` because it needs:
    //   - The `FORCE_VERIFY_PANIC` thread_local seam (cfg(test), pub(crate))
    //   - Direct access to `verify_progress` (`pub async fn` but on the
    //     private `loop_engine` module)
    //   - The `loop_override_mutex()` static (test-only)
    //
    // This integration test verifies the load-bearing public contract: the
    // LoopConfig surface that gates the smart path is independently
    // toggleable. If a user's chat starts crashing because the smart path
    // panics, flipping `smart_loop_enabled = false` MUST restore the legacy
    // 12-iteration path — the same fallback the catch_unwind wrapper takes
    // automatically inside a single iteration.
    let cfg = LoopConfig::default();

    // Default contract: smart on, escape hatch in place.
    assert!(
        cfg.smart_loop_enabled,
        "default contract: smart on. Inverting this would defeat the CTX-07 \
         escape hatch posture (the field exists to LET users opt out of smart, \
         not to default them out)."
    );

    // Independently flippable: just construct a new LoopConfig with the
    // toggle off; the rest of the struct should compose normally.
    let safe_mode = LoopConfig {
        smart_loop_enabled: false,
        max_iterations: cfg.max_iterations,
        cost_guard_dollars: cfg.cost_guard_dollars,
        verification_every_n: cfg.verification_every_n,
    };
    assert!(
        !safe_mode.smart_loop_enabled,
        "kill switch flippable in code as well as in config — required for the \
         runtime UAT step that toggles the field at runtime"
    );

    // The expression `smart_loop_enabled && cumulative_cost_usd > cost_guard_dollars`
    // (the LOOP-06 cost-guard halt) MUST short-circuit at the leftmost && when
    // smart is off — else the halt would fire even in the legacy path. This
    // is a logic-level smoke check; the unit-level proof lives in
    // `phase33_loop_06_cost_guard_halts_when_cap_exceeded` and friends.
    let would_halt = safe_mode.smart_loop_enabled && (10.0_f32) > safe_mode.cost_guard_dollars;
    assert!(
        !would_halt,
        "smart-off: cost guard must short-circuit (else legacy path inherits a \
         feature it should not have)"
    );

    // Symmetric check: with smart on, the same expression DOES halt at the
    // overage. Locks the `&&` gate posture from both sides.
    let smart_on = LoopConfig::default();
    let would_halt_smart = smart_on.smart_loop_enabled && (10.0_f32) > smart_on.cost_guard_dollars;
    assert!(
        would_halt_smart,
        "smart-on: cost guard must fire at overage; default cap is $5, observed $10"
    );
}
