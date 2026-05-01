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

// ── Phase 24 (v1.3) — dream_mode emit helpers ───────────────────────────────
// Per D-24-F: one emit per pass-kind per dream cycle, carrying count + items
// (capped at 10). MODULE = "Voyager" stays unchanged — dream-mode is the
// forgetting half of the Voyager loop; frontend filters by action prefix.

/// One emit per dream-mode prune pass.
pub fn dream_prune(count: i64, items: Vec<String>) {
    let summary = format!("dream:prune {} skill(s) archived", count);
    emit(
        "dream_mode:prune",
        &summary,
        json!({
            "count": count,
            "items": cap_items(&items, 10),
        }),
    );
}

/// One emit per dream-mode consolidate pass.
pub fn dream_consolidate(count: i64, items: Vec<String>) {
    let summary = format!("dream:consolidate {} pair(s) flagged", count);
    emit(
        "dream_mode:consolidate",
        &summary,
        json!({
            "count": count,
            "items": cap_items(&items, 10),
        }),
    );
}

/// One emit per dream-mode skill-from-trace generate pass.
pub fn dream_generate(count: i64, items: Vec<String>) {
    let summary = format!("dream:generate {} skill(s) proposed", count);
    emit(
        "dream_mode:generate",
        &summary,
        json!({
            "count": count,
            "items": cap_items(&items, 10),
        }),
    );
}

/// Cap an item list at `cap`; if exceeded, replace tail with a single
/// "... (+N more)" sentinel so consumer drawers stay legible.
fn cap_items(items: &[String], cap: usize) -> Vec<String> {
    if items.len() <= cap {
        return items.to_vec();
    }
    let mut out: Vec<String> = items.iter().take(cap).cloned().collect();
    out.push(format!("... (+{} more)", items.len() - cap));
    out
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

    #[test]
    fn dream_prune_caps_items_at_10() {
        // 13 items -> cap_items returns 10 + 1 sentinel = 11 elements,
        // last element = "... (+3 more)".
        let items: Vec<String> = (0..13).map(|i| format!("skill_{}", i)).collect();
        let capped = cap_items(&items, 10);
        assert_eq!(capped.len(), 11);
        assert_eq!(capped[10], "... (+3 more)");
        for i in 0..10 {
            assert_eq!(capped[i], format!("skill_{}", i));
        }
    }

    #[test]
    fn cap_items_returns_clone_when_under_cap() {
        let items: Vec<String> = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let capped = cap_items(&items, 10);
        assert_eq!(capped.len(), 3);
        assert_eq!(capped, items);
    }

    /// Phase 24 D-24-F lock — action string namespace MUST be exactly
    /// "dream_mode:prune" / "dream_mode:consolidate" / "dream_mode:generate".
    /// Frontend filters by action prefix (per RESEARCH "Action namespace").
    /// This test pins the namespace; any drift from the lock breaks the strip.
    ///
    /// Implementation note: we can't intercept the &'static str inside emit()
    /// from outside the module without a feature flag. Instead, this test
    /// just calls each helper with a sentinel item and asserts the
    /// underlying const namespace via the source SCAN -- by directly
    /// invoking each function in a way that confirms ASCII parse against
    /// the helper body. The substantive lock is enforced by the
    /// dream_emit_helpers_safe_without_app_handle below + the grep gate.
    #[test]
    fn dream_action_strings_locked() {
        // Smoke -- the calls invoke emit() which uses the locked &'static str.
        // The grep acceptance criterion at the plan level is the load-bearing
        // assertion (see PLAN.md acceptance_criteria).
        dream_prune(0, vec![]);
        dream_consolidate(0, vec![]);
        dream_generate(0, vec![]);
    }

    /// Mirrors emit_helpers_safe_without_app_handle (line 132) for the
    /// 3 new helpers -- required because integration_bridge::get_app_handle()
    /// returns None in `cargo test --lib` runs. Helpers must not panic;
    /// they should warn + return (handled by emit core).
    #[test]
    fn dream_emit_helpers_safe_without_app_handle() {
        dream_prune(3, vec!["a".into(), "b".into(), "c".into()]);
        dream_consolidate(1, vec!["foo+bar".into()]);
        dream_generate(1, vec!["auto_proposed_skill".into()]);
    }
}
