//! Voyager loop instrumentation — ActivityStrip emit helpers.
//!
//! Phase 22 Plan 22-02 (v1.3) — wires the M-07 contract through the existing
//! Voyager-shaped flow (immune_system → tool_forge → brain).
//!
//! 4 actions per closed loop iteration, in order:
//!
//!   1. `gap_detected`    — immune_system entry, when chat refusal /
//!                          capability gap fires
//!   2. `skill_written`   — tool_forge::forge_tool after script fs::write
//!                          succeeds (the on-disk artifact exists)
//!   3. `skill_registered`— tool_forge::forge_tool after DB insert + the
//!                          optional SKILL.md export (skill is now resolvable
//!                          via brain.rs:1043 + Catalog::resolve)
//!   4. `skill_used`      — tool_forge::record_tool_use, when a forged tool
//!                          is actually invoked
//!
//! All 4 emit through `app.emit_to("main", "blade_activity_log", ...)` —
//! same shape as `doctor.rs:emit_activity_for_doctor`. AppHandle is fetched
//! via `integration_bridge::get_app_handle()` so tool_forge's public API
//! signature doesn't need to grow an `&AppHandle` parameter.

use serde_json::json;
use tauri::Emitter;

/// Module label used in ActivityStrip rows. Renders as `[Voyager]` in the
/// strip line.
pub const MODULE: &str = "Voyager";

/// Emit a Voyager-loop event to the ActivityStrip.
///
/// `action` is one of `gap_detected`, `skill_written`, `skill_registered`,
/// `skill_used`. `human_summary` is the strip-line copy (truncated to 200
/// chars via `crate::safe_slice` per M-07 convention). `payload` carries
/// per-action JSON (capability + skill name + tool id etc) for the drawer.
///
/// Silent on error: ActivityStrip is observational; a failed emit must not
/// break the Voyager loop. Logged at warn level.
pub fn emit(action: &'static str, human_summary: &str, payload: serde_json::Value) {
    let app = match crate::integration_bridge::get_app_handle() {
        Some(h) => h,
        None => {
            log::warn!(
                "[voyager_log] no app handle for {action}: {}",
                crate::safe_slice(human_summary, 100)
            );
            return;
        }
    };
    if let Err(e) = app.emit_to(
        "main",
        "blade_activity_log",
        json!({
            "module":        MODULE,
            "action":        action,
            "human_summary": crate::safe_slice(human_summary, 200),
            "payload_id":    serde_json::Value::Null,
            "payload":       payload,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    ) {
        log::warn!("[voyager_log] emit_to main failed for {action}: {e}");
    }
}

/// Convenience: gap detected.
pub fn gap_detected(capability: &str, user_request: &str) {
    let summary = format!("gap_detected: {}", crate::safe_slice(capability, 80));
    emit(
        "gap_detected",
        &summary,
        json!({
            "capability":   capability,
            "user_request": crate::safe_slice(user_request, 200),
        }),
    );
}

/// Convenience: skill_written (script artifact on disk).
pub fn skill_written(skill_name: &str, script_path: &str) {
    let summary = format!("skill_written: {}", crate::safe_slice(skill_name, 80));
    emit(
        "skill_written",
        &summary,
        json!({
            "skill_name":  skill_name,
            "script_path": script_path,
        }),
    );
}

/// Convenience: skill_registered (resolvable in runtime tool surface).
pub fn skill_registered(skill_name: &str, tool_id: &str, skill_md_path: Option<&str>) {
    let summary = format!("skill_registered: {}", crate::safe_slice(skill_name, 80));
    emit(
        "skill_registered",
        &summary,
        json!({
            "skill_name":    skill_name,
            "tool_id":       tool_id,
            "skill_md_path": skill_md_path,
        }),
    );
}

/// Convenience: skill_used (forged tool invoked from chat).
pub fn skill_used(skill_name: &str) {
    let summary = format!("skill_used: {}", crate::safe_slice(skill_name, 80));
    emit(
        "skill_used",
        &summary,
        json!({
            "skill_name": skill_name,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_label_constant() {
        assert_eq!(MODULE, "Voyager");
    }

    /// All emit helpers must be safe to call with no AppHandle registered —
    /// they should log a warning and return cleanly. This is the test-time
    /// invariant since the integration_bridge AppHandle isn't initialized
    /// in `cargo test --lib` runs.
    #[test]
    fn emit_helpers_safe_without_app_handle() {
        // Must not panic in any test context.
        gap_detected("youtube_transcript", "summarize this video: <url>");
        skill_written("youtube-transcript-fetch", "/tmp/yt.py");
        skill_registered("youtube-transcript-fetch", "test-id", Some("/tmp/skills/yt/SKILL.md"));
        skill_used("youtube-transcript-fetch");
    }

    #[test]
    fn long_summary_safe_sliced() {
        let long: String = "a".repeat(500);
        // Should not panic on >200-char input
        emit("gap_detected", &long, serde_json::json!({}));
    }
}
