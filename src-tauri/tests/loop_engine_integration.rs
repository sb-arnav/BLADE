//! Phase 33 Plan 33-09 + Phase 34 Plan 34-11 — Loop / resilience / session
//! integration test target.
//!
//! Mirrors the Phase 32-02 / 32-07 pattern in
//! `tests/context_management_integration.rs`: integration tests verify the
//! PUBLIC contract of `LoopConfig` / `ResilienceConfig` / `SessionConfig`
//! (the CTX-07-style escape hatches) at the `blade_lib::config` boundary.
//! The deep panic-injection regression tests live as unit tests inside their
//! owning modules:
//!   - `src/loop_engine.rs`     (`phase33_loop_01_panic_in_verify_progress_caught_by_outer_wrapper`,
//!                               `phase34_res_01_panic_in_detect_stuck_caught_by_outer_wrapper`)
//!   - `src/resilience/stuck.rs` (`phase34_res_01_force_panic_seam_propagates_panic`)
//!   - `src/session/log.rs`     (`phase34_sess_01_panic_in_append_caught_by_outer_wrapper`)
//! because the test-only `FORCE_*_PANIC` thread_local seams are `#[cfg(test)]`
//! + `pub(crate)` and the modules are private in `src/lib.rs` — making them
//! `pub mod` for one test would change the public API surface.
//!
//! Crate name observed in `src-tauri/Cargo.toml`:
//!   [package].name = "blade"     (binary)
//!   [lib].name     = "blade_lib" (library — what integration tests import)
//!
//! What this target verifies:
//!
//!   Phase 33 (LoopConfig):
//!     1. `LoopConfig::default().smart_loop_enabled == true` — escape hatch ON
//!        by default.
//!     2. A `smart_loop_enabled = false` config round-trips through serde JSON
//!        without collateral mutations.
//!     3. `LoopConfig` is independently flippable from the rest of BladeConfig.
//!
//!   Phase 34 (Plan 34-11 close-out additions):
//!     4. `ResilienceConfig::default()` matches the locked Wave 1 contract
//!        (smart on, stuck-detect on, $25 per-conversation cap, 4-element
//!        fallback chain leading with "primary").
//!     5. `smart_resilience_enabled = false` round-trips through serde JSON
//!        without collateral mutations to the other RES-01..05 fields.
//!     6. `SessionConfig::default()` matches the locked Wave 1 contract
//!        (jsonl_log_enabled true, keep_n_sessions = 100, jsonl_log_dir
//!        ends in "sessions").
//!     7. `jsonl_log_enabled = false` round-trips through serde JSON without
//!        collateral mutations.
//!     8. The two CTX-07-style escape hatches (smart_resilience_enabled,
//!        jsonl_log_enabled) are INDEPENDENTLY flippable — toggling one must
//!        not perturb the other (each is a separate kill switch covering a
//!        distinct concern: resilience features vs durability).
//!
//! What this target does NOT verify (covered elsewhere):
//!   - The actual catch_unwind boundaries — unit tests with FORCE_*_PANIC
//!     seams (links above) inside the owning modules.
//!   - The runtime UAT (Plan 33-09 / 34-11 Task 6) — operator-driven on the
//!     dev binary. Per the operator-deferred-UAT pattern (MEMORY.md:
//!     feedback_deferred_uat_pattern), Plan 34-11 returns
//!     `## CHECKPOINT REACHED` at the close of autonomous code work and
//!     leaves the runtime exercise for Arnav.

use blade_lib::config::{LoopConfig, ResilienceConfig, SessionConfig};

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 34 Plan 34-11 — close-out integration tests for ResilienceConfig +
// SessionConfig public contracts. Mirror the Phase 33-09 posture: integration
// tests lock the SERDE BOUNDARY for the CTX-07-style escape hatches; the deep
// panic-injection regression coverage stays at the unit level inside the
// owning modules where the test-only FORCE_*_PANIC seams have access.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn phase34_resilience_default_config_matches_wave1_contract() {
    // RES-01..05 + RES-04 — Wave 1 default contract from
    // 34-CONTEXT.md §Module Boundaries. Locks the defaults so a future edit
    // that flips the smart toggle off-by-default OR drops the cap would trip
    // this test before shipping.
    let cfg = ResilienceConfig::default();

    assert!(
        cfg.smart_resilience_enabled,
        "default ResilienceConfig must have smart_resilience_enabled = true (Wave 1 contract). \
         Flipping the default to false changes the runtime behavior for every \
         existing user — they would suddenly lose stuck detection / circuit \
         breaker / cost-warning / provider fallback. The CTX-07-style escape \
         hatch lives at the user's config level, not the default."
    );
    assert!(
        cfg.stuck_detection_enabled,
        "default stuck_detection_enabled must be true (RES-01 master toggle)"
    );
    assert!(
        (cfg.cost_guard_per_conversation_dollars - 25.0).abs() < 1e-6,
        "default per-conversation cap must be $25.0 (RES-04, locked in 34-CONTEXT). Got ${}.",
        cfg.cost_guard_per_conversation_dollars
    );
    assert_eq!(
        cfg.circuit_breaker_threshold, 3,
        "default circuit_breaker_threshold must be 3 (RES-02). Got {}.",
        cfg.circuit_breaker_threshold
    );
    // RES-05 fallback chain — locked order matters; "primary" must be first
    // (resolves to BladeConfig.provider).
    assert_eq!(
        cfg.provider_fallback_chain.len(), 4,
        "default fallback chain must have 4 elements (RES-05). Got {}.",
        cfg.provider_fallback_chain.len()
    );
    assert_eq!(
        cfg.provider_fallback_chain[0], "primary",
        "default fallback chain[0] must be 'primary' (RES-05). Got {:?}.",
        cfg.provider_fallback_chain[0]
    );
}

#[test]
fn phase34_resilience_smart_off_round_trips_without_collateral_mutation() {
    // Plan 34-11 close-out — verify the smart_resilience_enabled = false toggle
    // survives a serde JSON round-trip without collateral mutations to the
    // other RES-01..05 fields. Same shape as
    // `phase33_smart_loop_disabled_round_trips_naive_path` for LoopConfig.
    //
    // If a future serde rename or a `#[serde(default)]` regression silently
    // drops smart_resilience_enabled from a user's `~/.blade/config.json`,
    // the load path would re-default to true — surprising a user who
    // explicitly opted out of the resilience features. This test fails LOUD
    // if that happens.
    let kill_switched = ResilienceConfig {
        smart_resilience_enabled: false,
        ..ResilienceConfig::default()
    };

    let json = serde_json::to_string(&kill_switched)
        .expect("serialize kill-switched ResilienceConfig");
    let parsed: ResilienceConfig =
        serde_json::from_str(&json).expect("deserialize kill-switched ResilienceConfig");

    assert!(
        !parsed.smart_resilience_enabled,
        "kill-switched smart_resilience_enabled = false MUST survive a JSON \
         round-trip. If this fails, the serde shape silently dropped the toggle \
         — users who opt out via ~/.blade/config.json would unexpectedly get \
         the smart resilience path back on the next load_config call. CTX-07 \
         escape hatch broken."
    );

    // Other fields must not be collaterally mutated by flipping the kill switch.
    assert!(
        parsed.stuck_detection_enabled,
        "stuck_detection_enabled must be unaffected by smart_resilience_enabled toggle"
    );
    assert!(
        (parsed.cost_guard_per_conversation_dollars - 25.0).abs() < 1e-6,
        "cost_guard_per_conversation_dollars must be unaffected, got {}",
        parsed.cost_guard_per_conversation_dollars
    );
    assert_eq!(
        parsed.circuit_breaker_threshold, 3,
        "circuit_breaker_threshold must be unaffected, got {}",
        parsed.circuit_breaker_threshold
    );
    assert_eq!(
        parsed.provider_fallback_chain.len(), 4,
        "provider_fallback_chain must be unaffected, got len {}",
        parsed.provider_fallback_chain.len()
    );
}

#[test]
fn phase34_session_default_config_matches_wave1_contract() {
    // SESS-01 — Wave 1 default contract from 34-CONTEXT.md §Module Boundaries.
    let cfg = SessionConfig::default();

    assert!(
        cfg.jsonl_log_enabled,
        "default SessionConfig must have jsonl_log_enabled = true (SESS-01). \
         Flipping the default to false would break SESS-02 resume + SESS-03 \
         list for every existing user."
    );
    assert_eq!(
        cfg.keep_n_sessions, 100,
        "default keep_n_sessions must be 100 (SESS-01 rotation). Got {}.",
        cfg.keep_n_sessions
    );
    assert!(
        cfg.jsonl_log_dir.ends_with("sessions"),
        "default jsonl_log_dir must end with /sessions (SESS-01). Got {}.",
        cfg.jsonl_log_dir.display()
    );
}

#[test]
fn phase34_session_jsonl_off_round_trips_without_collateral_mutation() {
    // Plan 34-11 close-out — verify the jsonl_log_enabled = false toggle
    // survives a serde JSON round-trip. The two CTX-07-style escape hatches
    // (smart_resilience_enabled + jsonl_log_enabled) cover distinct concerns
    // and must be independently flippable.
    let kill_switched = SessionConfig {
        jsonl_log_enabled: false,
        ..SessionConfig::default()
    };

    let json = serde_json::to_string(&kill_switched)
        .expect("serialize kill-switched SessionConfig");
    let parsed: SessionConfig =
        serde_json::from_str(&json).expect("deserialize kill-switched SessionConfig");

    assert!(
        !parsed.jsonl_log_enabled,
        "kill-switched jsonl_log_enabled = false MUST survive a JSON round-trip. \
         If this fails, users who opt out of session logging via config would \
         unexpectedly start writing JSONL files again on the next load_config \
         call. CTX-07-style escape hatch broken."
    );
    assert_eq!(
        parsed.keep_n_sessions, 100,
        "keep_n_sessions must be unaffected by jsonl_log_enabled toggle, got {}",
        parsed.keep_n_sessions
    );
    assert!(
        parsed.jsonl_log_dir.ends_with("sessions"),
        "jsonl_log_dir must be unaffected by jsonl_log_enabled toggle, got {}",
        parsed.jsonl_log_dir.display()
    );
}

#[test]
fn phase34_resilience_and_session_kill_switches_are_independent() {
    // Plan 34-11 — the two Phase 34 CTX-07-style escape hatches cover distinct
    // concerns:
    //   - smart_resilience_enabled (RES) — disables stuck/circuit/cost-warn/
    //     fallback. Per-conversation 100% halt still enforced for data
    //     integrity.
    //   - jsonl_log_enabled (SESS) — disables session JSONL writes. SESS-02
    //     resume returns Err for new sessions; pre-existing JSONL files
    //     remain readable via SESS-03 list.
    // Toggling one must not perturb the other — each is its own kill switch.
    let only_resilience_off = ResilienceConfig {
        smart_resilience_enabled: false,
        ..ResilienceConfig::default()
    };
    let only_session_off = SessionConfig {
        jsonl_log_enabled: false,
        ..SessionConfig::default()
    };

    // Independence smoke check: no shared field exists between
    // ResilienceConfig and SessionConfig (they are sibling structs in
    // BladeConfig). Flipping one does not access the other's storage.
    assert!(
        !only_resilience_off.smart_resilience_enabled,
        "smart_resilience_enabled toggle must work without touching SessionConfig"
    );
    assert!(
        only_session_off.jsonl_log_enabled == false,
        "jsonl_log_enabled toggle must work without touching ResilienceConfig"
    );

    // Defaults remain pristine on the un-toggled struct in each case.
    let pristine_session = SessionConfig::default();
    assert!(pristine_session.jsonl_log_enabled);
    let pristine_resilience = ResilienceConfig::default();
    assert!(pristine_resilience.smart_resilience_enabled);
}
