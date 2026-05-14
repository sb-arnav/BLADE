// src-tauri/src/presence.rs
// Phase 53 (PRESENCE-NARRATE) — BLADE's presence layer narration channel.
//
// VISION line 53: "memory creates continuity; internal state creates liveliness.
// Both matter." Hormones, vitality, active inference, and the Evolution Engine
// are architecturally complete but produced ZERO user-facing signal before this
// phase. This module is the single fan-in for "BLADE feels alive" narration:
// Evolution discovers a capability the user could wire → presence-line. Vitality
// crosses a band threshold → presence-line. Learning Engine spots a cross-session
// pattern → presence-line.
//
// Architecture mirrors the Phase 47 (FORGE-02) `emit_forge_line` precedent at
// `src-tauri/src/tool_forge.rs:139` — a thin helper that wraps a Tauri event
// emit_to("main", ...). The ChatProvider (src/features/chat/useChat.tsx)
// subscribes via the same BLADE_FORGE_LINE channel pattern, but the discriminator
// is `kind: "presence"` so MessageBubble can apply a distinct visual treatment.
//
// In-process buffer: the last 8 emissions are retained in a static ring so the
// brain.rs system prompt builder (PRESENCE-BRAIN-INJECT, REQ-5) can read recent
// emissions when composing the LLM context. The ring is bounded and
// thread-safe; emissions never block on it.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

/// Tauri event name. Mirrors the Phase 47 BLADE_FORGE_LINE pattern — both
/// chat-line kinds (forge + presence) flow on logically the same surface;
/// frontend discriminates by the `kind` field.
pub const BLADE_PRESENCE_LINE: &str = "blade_presence_line";

/// One presence emission as it appears on the wire and in the ring buffer.
/// Kept narrow on purpose — narration text + emit source + timestamp. The
/// frontend renders only `message`; `source` is for diagnostics + the
/// PRESENCE-BRAIN-INJECT prompt section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceLine {
    /// Discriminator for the chat-line stream — always "presence".
    pub kind: String,
    /// Human-readable narration. First-person, short, no trailing period
    /// expected from callers.
    pub message: String,
    /// Which subsystem fired this line. One of:
    ///   "evolution"  — Evolution Engine capability/integration discovery
    ///   "vitality"   — vitality band transition
    ///   "learning"   — cross-session behavioral pattern
    pub source: String,
    /// Unix seconds when the line was emitted.
    pub timestamp: i64,
}

// ── Static ring of the last 8 emissions ──────────────────────────────────────
//
// Bounded so brain.rs system prompt assembly can read recent state without an
// unbounded memory footprint. Reads + writes are lock-guarded; on poisoning we
// fall back to an empty view rather than panicking (the presence layer must
// never abort BLADE's main loops).

const PRESENCE_RING_MAX: usize = 8;

static PRESENCE_RING: OnceLock<Mutex<VecDeque<PresenceLine>>> = OnceLock::new();

fn presence_ring() -> &'static Mutex<VecDeque<PresenceLine>> {
    PRESENCE_RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(PRESENCE_RING_MAX)))
}

fn push_presence(line: PresenceLine) {
    if let Ok(mut ring) = presence_ring().lock() {
        if ring.len() >= PRESENCE_RING_MAX {
            ring.pop_front();
        }
        ring.push_back(line);
    }
}

/// Return the last `n` emissions, oldest-first (capped at PRESENCE_RING_MAX).
/// Consumed by `brain.rs::build_system_prompt_inner` (PRESENCE-BRAIN-INJECT).
pub fn recent_emissions(n: usize) -> Vec<PresenceLine> {
    let n = n.min(PRESENCE_RING_MAX);
    presence_ring()
        .lock()
        .map(|ring| {
            let start = ring.len().saturating_sub(n);
            ring.iter().skip(start).cloned().collect()
        })
        .unwrap_or_default()
}

/// Test-only: clear the ring so unit tests start from a known empty state.
///
/// Marked `#[doc(hidden)]` and intended for tests in this crate + the
/// integration test at `tests/presence_integration.rs` only. Not `cfg(test)`
/// because cargo builds the lib WITHOUT cfg(test) when integration tests
/// link to it -- gating these helpers behind cfg(test) would make
/// `presence_integration.rs` un-buildable.
#[doc(hidden)]
pub fn clear_for_test() {
    if let Ok(mut ring) = presence_ring().lock() {
        ring.clear();
    }
}

/// Test-only: push a presence line directly into the ring without going
/// through the Tauri emit path (which needs an AppHandle).
///
/// Marked `#[doc(hidden)]` rather than `cfg(test)` for the reason above --
/// integration tests need this symbol at non-test build time.
#[doc(hidden)]
pub fn push_for_test(message: &str, source: &str) {
    push_presence(PresenceLine {
        kind: "presence".to_string(),
        message: message.to_string(),
        source: source.to_string(),
        timestamp: chrono::Utc::now().timestamp(),
    });
}

/// Emit a single presence chat-line. Best-effort: a stalled event emit must
/// never abort the caller's loop (mirrors `emit_forge_line` discipline).
///
/// `source` is required so the brain prompt context section can attribute
/// recent emissions; callers should pass a stable literal ("evolution" |
/// "vitality" | "learning").
pub fn emit_presence_line(app: &tauri::AppHandle, message: &str, source: &str) {
    let line = PresenceLine {
        kind: "presence".to_string(),
        message: crate::safe_slice(message, 280).to_string(),
        source: source.to_string(),
        timestamp: chrono::Utc::now().timestamp(),
    };
    push_presence(line.clone());
    let _ = app.emit_to("main", BLADE_PRESENCE_LINE, line);
}

// ── Tauri command for diagnostics / dev pane ────────────────────────────────

/// Expose recent presence emissions to the frontend (DevPane / Doctor / debug).
#[tauri::command]
pub fn presence_get_recent(limit: usize) -> Vec<PresenceLine> {
    recent_emissions(limit.min(PRESENCE_RING_MAX))
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_caps_at_max() {
        clear_for_test();
        for i in 0..(PRESENCE_RING_MAX + 4) {
            push_for_test(&format!("line {}", i), "test");
        }
        let recent = recent_emissions(PRESENCE_RING_MAX + 4);
        // Cannot exceed cap even when we ask for more.
        assert!(recent.len() <= PRESENCE_RING_MAX);
        // Oldest dropped: first line should be "line 4" (we pushed 12, kept last 8).
        assert_eq!(recent.first().map(|l| l.message.as_str()), Some("line 4"));
    }

    #[test]
    fn recent_emissions_returns_oldest_first() {
        clear_for_test();
        push_for_test("first", "evolution");
        push_for_test("second", "vitality");
        push_for_test("third", "learning");
        let recent = recent_emissions(3);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].message, "first");
        assert_eq!(recent[2].message, "third");
        // Source labels preserved.
        assert_eq!(recent[0].source, "evolution");
        assert_eq!(recent[1].source, "vitality");
        assert_eq!(recent[2].source, "learning");
    }

    #[test]
    fn recent_emissions_respects_requested_limit() {
        clear_for_test();
        for i in 0..5 {
            push_for_test(&format!("m{}", i), "test");
        }
        let two = recent_emissions(2);
        assert_eq!(two.len(), 2);
        // Limit returns the most recent two, in oldest-first order.
        assert_eq!(two[0].message, "m3");
        assert_eq!(two[1].message, "m4");
    }

    #[test]
    fn presence_line_kind_is_always_presence() {
        clear_for_test();
        push_for_test("hello", "evolution");
        let recent = recent_emissions(1);
        assert_eq!(recent[0].kind, "presence");
    }
}
