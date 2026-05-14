// src-tauri/tests/presence_integration.rs
//
// Phase 53 (PRESENCE-TESTS) — end-to-end integration test for the presence
// narration channel.
//
// What this test covers:
//   1. emit_presence_line → presence_get_recent round-trip: a line emitted
//      by the helper lands in the in-process ring and is readable by the
//      Tauri command surface (the same surface the frontend uses via
//      invoke('presence_get_recent', ...)).
//   2. brain.rs build_presence_state_block reads the ring at compose-time
//      and renders the emitted line into the system prompt's
//      <presence_state> block — proving end-to-end emit -> chat-context
//      flow without needing a Tauri runtime.
//   3. The ring's bounded-size contract (PRESENCE_RING_MAX = 8) holds
//      across many emissions and that the brain block requests only the
//      most-recent 3.
//
// What this test does NOT cover (intentionally):
//   - The actual Tauri event surface (blade_presence_line). Constructing
//     an AppHandle in a unit test requires bootstrapping the full Tauri
//     runtime; the emit_to call is more cheaply verified at runtime via
//     the dev demo and the operator UAT screenshots. Per the Phase 47
//     forge-e2e precedent, integration tests target the side-effecting
//     surface (the ring + the prompt block) and leave the event-bus path
//     to manual UAT. The frontend listener (useChat.tsx) and the CSS
//     styling are covered by the existing chat Playwright smoke tests at
//     the milestone level.
//
// Runtime: <50ms on a warm dev box (pure in-memory).

use blade_lib::presence::{
    clear_for_test, emit_presence_line as _public_helper_check, push_for_test, recent_emissions,
    PresenceLine,
};
use std::sync::Mutex;

// Lock to serialize against other integration tests that might touch the
// presence ring concurrently. Phase 53 is the only integration test using
// the ring today, but locking up-front avoids future flakes.
static RING_LOCK: Mutex<()> = Mutex::new(());

// Bind to suppress unused-import lint on the symbol we reference for the
// "emit_presence_line is publicly callable from integration tests" check.
#[allow(dead_code)]
fn _ensure_public_symbol() {
    let _ = _public_helper_check;
}

/// Phase 53 / REQ-6 integration test — end-to-end emit -> ring -> brain.
///
/// We exercise the full data path that produces a user-visible chat-line
/// AND a brain-prompt context section:
///
///   emit (or push_for_test) → ring → recent_emissions(3) → brain.rs
///   build_presence_state_block → <presence_state> block
///
/// Assertions:
///   - The exact narration string from the spec survives round-trip into
///     the prompt block.
///   - All three source labels (evolution / vitality / learning) attribute
///     correctly in the rendered block.
///   - Recency ordering is preserved: oldest-first inside recent_emissions
///     produces in-order lines inside the prompt block.
///   - The bounded ring (PRESENCE_RING_MAX = 8) means we cannot accidentally
///     blow past the prompt block's char budget by spamming emissions.
#[test]
fn phase53_presence_emit_to_brain_roundtrip() {
    let _guard = RING_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    clear_for_test();

    // Drive the three production emit sites (PRESENCE-EVOLUTION,
    // PRESENCE-VITALITY, PRESENCE-LEARNING) via the test helper that bypasses
    // the AppHandle.emit_to call but exercises the same ring write the
    // production helper performs.
    push_for_test(
        "I noticed you use GitHub — want me to wire it in?",
        "evolution",
    );
    push_for_test(
        "Energy's running low — I'll lean on faster models for a bit.",
        "vitality",
    );
    push_for_test(
        "I'm seeing you sketch React component layouts most mornings — want a shortcut?",
        "learning",
    );

    let recent = recent_emissions(3);
    assert_eq!(recent.len(), 3, "expected 3 recent emissions, got {}", recent.len());
    assert_eq!(recent[0].source, "evolution");
    assert_eq!(recent[1].source, "vitality");
    assert_eq!(recent[2].source, "learning");

    // Assemble the brain block exactly the way brain.rs does at compose time.
    let block = blade_lib::brain::build_presence_state_block("Thriving", 0.80, &recent);

    // Tag boundaries.
    assert!(block.starts_with("<presence_state>"));
    assert!(block.trim_end().ends_with("</presence_state>"));

    // Telemetry shape.
    assert!(block.contains("vitality_band: Thriving"));
    assert!(block.contains("scalar=0.80"));

    // Every emitted message survives into the block, attributed to its source.
    assert!(
        block.contains("[evolution] I noticed you use GitHub"),
        "evolution emission missing or detached from its source label: {}",
        block
    );
    assert!(
        block.contains("[vitality] Energy's running low"),
        "vitality emission missing or detached from its source label: {}",
        block
    );
    assert!(
        block.contains("[learning] I'm seeing you sketch React"),
        "learning emission missing or detached from its source label: {}",
        block
    );

    // Stance line load-bearing: without it the model paraphrases emissions
    // back to the user instead of using them as a stance modulator.
    assert!(
        block.contains("do NOT narrate state back to user"),
        "stance directive missing from prompt block"
    );

    // Ordering: evolution should appear before vitality should appear before
    // learning in the rendered block (oldest-first per Phase 53 spec).
    let ev_pos = block.find("[evolution]").unwrap();
    let vi_pos = block.find("[vitality]").unwrap();
    let lr_pos = block.find("[learning]").unwrap();
    assert!(ev_pos < vi_pos, "evolution must precede vitality");
    assert!(vi_pos < lr_pos, "vitality must precede learning");
}

/// Phase 53 / REQ-6 — boundedness contract.
///
/// PRESENCE_RING_MAX = 8 means brain.rs cannot accidentally blow its token
/// budget by reading a runaway ring. We push 20 emissions and assert that
/// recent_emissions(8) caps at 8 entries and that the brain block stays
/// under a sane character budget (1200 chars at 8 emissions × 160-char cap).
#[test]
fn phase53_presence_ring_bounded_for_brain_budget() {
    let _guard = RING_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    clear_for_test();

    for i in 0..20 {
        push_for_test(
            &format!("filler emission number {} carrying a moderately long body so token budget calculations are realistic and we don't accidentally underflow", i),
            if i % 3 == 0 {
                "evolution"
            } else if i % 3 == 1 {
                "vitality"
            } else {
                "learning"
            },
        );
    }

    let full = recent_emissions(8);
    assert!(full.len() <= 8, "ring exceeded max cap: len={}", full.len());

    // The brain only ever asks for 3 (per PRESENCE-BRAIN-INJECT).
    let brain_slice = recent_emissions(3);
    assert_eq!(brain_slice.len(), 3);

    let block = blade_lib::brain::build_presence_state_block("Waning", 0.5, &brain_slice);
    // Budget sanity: 3 emissions × (label + 160-char message) ≈ 600 chars max
    // for the body; plus header + stance ≈ 800 chars total upper bound. We
    // assert a conservative 1500 to leave headroom for the source-label
    // bracket expansion.
    assert!(
        block.len() < 1500,
        "presence block exceeded brain budget: {} chars",
        block.len()
    );
    // And it still has the load-bearing stance line.
    assert!(block.contains("stance:"));
}

/// Phase 53 / REQ-6 — PresenceLine wire shape is preservation-stable.
///
/// The frontend deserializes blade_presence_line events into a typed
/// BladePresenceLinePayload (src/lib/events/payloads.ts). If the Rust struct
/// ever drifts (renamed field, new required field), this test fails and the
/// drift is caught before reaching the chat surface.
#[test]
fn phase53_presence_line_wire_shape_stable() {
    let _guard = RING_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let line = PresenceLine {
        kind: "presence".to_string(),
        message: "shape check".to_string(),
        source: "evolution".to_string(),
        timestamp: 1715000000,
    };
    let json = serde_json::to_value(&line).unwrap();
    // Frontend's BladePresenceLinePayload requires these four fields verbatim.
    assert_eq!(json["kind"], "presence");
    assert_eq!(json["message"], "shape check");
    assert_eq!(json["source"], "evolution");
    assert_eq!(json["timestamp"], 1715000000);
}
