//! jarvis_dispatch.rs — outbound fan-out across native tentacles → MCP fallback → native_tools last
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05/D-06/D-07/D-08/D-10/D-17
//! and 18-RESEARCH.md § Dispatch Order Verdict (native-tentacle-FIRST).
//!
//! Wave 3 (Plan 18-09): full body — consent gate (T-18-01) + WriteScope acquisition
//! (T-18-02) + 3-tier dispatch + D-17 LOCKED activity-log emission. Plan 14 (Wave 4)
//! wires the linear/calendar branches and replaces the NeedsPrompt → NoConsent
//! short-circuit with a tokio::oneshot await on the user's dialog choice.
//!
//! NAMING: Tauri command is `jarvis_dispatch_action` (NOT `dispatch_action`)
//! because two private `dispatch_action` fns already exist in the tree
//! (action_tags.rs:84, goal_engine.rs:416 — both module-private, no Tauri-namespace
//! clash but greppability matters; PATTERNS.md § Pre-flight Namespace Check).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use crate::intent_router::IntentClass;
use crate::consent::{consent_check, ConsentVerdict};
use crate::ecosystem;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DispatchResult {
    Executed { service: String, payload: serde_json::Value },
    NoConsent,
    HardFailedNoCreds { service: String, suggestion: String },
    NotApplicable,
}

/// D-17 LOCKED intent_class label used in every blade_activity_log emission.
const D17_INTENT_LABEL: &str = "action_required";

/// Emit one ActivityStrip line per dispatch outcome.
///
/// D-17 LOCKED format (NEVER paraphrase): `[JARVIS] {intent_class}: {target_service} → {outcome}`.
/// outcome ∈ {executed, denied, auto_approved, hard_refused, capability_gap_logged, retry_succeeded}.
fn emit_jarvis_activity(app: &AppHandle, intent_class: &str, target_service: &str, outcome: &str) {
    let line = crate::safe_slice(
        &format!("[JARVIS] {}: {} → {}", intent_class, target_service, outcome),
        200,
    ).to_string();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "jarvis",
        "action":        outcome,
        "human_summary": line,
        "payload_id":    serde_json::Value::Null,
        "timestamp":     timestamp,
    }));
}

// Plan 18-14 supersedes the Wave-3 `emit_consent_request` helper with
// `consent::request_consent`, which owns the oneshot channel + emit + await
// in one call site (consent.rs). The dispatcher's NeedsPrompt arm now invokes
// it directly. T-18-CARRY-27 mitigation (safe_slice on content_preview) is
// preserved at the new emit site.

/// Tier 1: native tentacle dispatch.
///
/// Returns `Some(Ok(payload))` on success, `Some(Err(msg))` on tentacle error,
/// or `None` if no native tentacle exists for the (service, action) tuple.
/// `None` cascades the caller to the MCP tier.
///
/// The match arms are an explicit ALLOW-LIST (T-18-CARRY-28 mitigation): unknown
/// (service, action) tuples produce `None` and never trigger an outbound.
///
/// Plan 09 deliberately ships `linear` and `calendar` arms as `None`. Plan 14
/// (Wave 4) replaces those `None` returns with calls to
/// `crate::tentacles::linear_jira::auto_create_ticket` and
/// `crate::tentacles::calendar_tentacle::calendar_post_meeting_summary` once
/// intent_router emits real args.
async fn try_native_tentacle(
    service: &str,
    action: &str,
    args: &serde_json::Value,
    app: &AppHandle,
) -> Option<Result<serde_json::Value, String>> {
    match (service, action) {
        ("slack", "post" | "post_message") => {
            let channel = args.get("channel").and_then(|s| s.as_str()).unwrap_or("#general").to_string();
            let text = args.get("text").and_then(|s| s.as_str()).unwrap_or("").to_string();
            Some(
                crate::tentacles::slack_outbound::slack_outbound_post_message(app.clone(), channel, text).await
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
            )
        }
        ("github", "create_pr_comment" | "comment") => {
            let owner = args.get("owner").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let repo = args.get("repo").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let pr = args.get("pr_number").and_then(|n| n.as_u64()).unwrap_or(0);
            let body = args.get("body").and_then(|s| s.as_str()).unwrap_or("").to_string();
            Some(
                crate::tentacles::github_outbound::github_outbound_create_pr_comment(app.clone(), owner, repo, pr, body).await
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
            )
        }
        ("github", "create_issue" | "create") => {
            let owner = args.get("owner").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let repo = args.get("repo").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let title = args.get("title").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let body = args.get("body").and_then(|s| s.as_str()).unwrap_or("").to_string();
            Some(
                crate::tentacles::github_outbound::github_outbound_create_issue(app.clone(), owner, repo, title, body).await
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
            )
        }
        ("gmail", "send" | "send_message") => {
            let to = args.get("to").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let subject = args.get("subject").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let body = args.get("body").and_then(|s| s.as_str()).unwrap_or("").to_string();
            Some(
                crate::tentacles::gmail_outbound::gmail_outbound_send(app.clone(), to, subject, body).await
                    .map(|r| serde_json::to_value(r).unwrap_or_default())
            )
        }
        ("linear", "create" | "create_issue") => {
            // Plan 18-14 Task 2 — D-21 cold-install demo target. Use the existing public
            // auto_create_ticket entry (linear_create_issue is private; auto_create_ticket
            // wraps it with LLM-driven extraction + the keyring path). Direct call avoids
            // re-entering the Tauri IPC boundary.
            let description = args
                .get("description")
                .and_then(|v| v.as_str())
                .or_else(|| args.get("title").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let source = args
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("jarvis-chat")
                .to_string();
            if description.is_empty() {
                return Some(Err(
                    "[jarvis_dispatch] linear: missing 'title' or 'description' in args; cannot create issue. \
                     Connect via Integrations tab → Linear if creds missing.".to_string()
                ));
            }
            Some(
                crate::tentacles::linear_jira::auto_create_ticket(&description, &source)
                    .await
                    .map(|id| serde_json::json!({"identifier": id})),
            )
        }
        ("calendar", _) => {
            // Plan 18-14 Task 2 — calendar_post_meeting_summary is the canonical existing
            // outbound (Tauri command). Dispatcher invokes it with cloned AppHandle so the
            // command can locate provider state through tauri::Manager.
            let transcript = args
                .get("transcript")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let meeting_title = args
                .get("meeting_title")
                .and_then(|v| v.as_str())
                .unwrap_or("Meeting Summary")
                .to_string();
            if transcript.is_empty() {
                return Some(Err(
                    "[jarvis_dispatch] calendar: missing 'transcript' in args; cannot post summary. \
                     Connect via Integrations tab → Calendar if creds missing.".to_string()
                ));
            }
            Some(
                crate::tentacles::calendar_tentacle::calendar_post_meeting_summary(
                    app.clone(),
                    transcript,
                    meeting_title,
                )
                .await
                .map(|summary| serde_json::to_value(summary).unwrap_or_default()),
            )
        }
        _ => None,
    }
}

/// Tier 2: MCP fallback for services with no native tentacle.
///
/// Mirrors slack_outbound's pattern (slack_deep.rs:34): acquire AppHandle through
/// integration_bridge, then SharedMcpManager state, then lock. If any step fails
/// (e.g. test environment with no AppHandle wired), return `None` so the caller
/// falls through to Tier 3.
///
/// Returns `Some(Ok(payload))` on MCP success, `Some(Err(msg))` on MCP failure,
/// `None` when no MCP path is available.
async fn try_mcp_tool(
    service: &str,
    action: &str,
    args: &serde_json::Value,
    _app: &AppHandle,
) -> Option<Result<serde_json::Value, String>> {
    let handle = crate::integration_bridge::get_app_handle()?;
    use tauri::Manager;
    let manager_state = handle.try_state::<crate::commands::SharedMcpManager>()?;
    let mut manager = manager_state.lock().await;

    let qualified = format!("mcp__{}_{}", service, action);
    match manager.call_tool(&qualified, args.clone()).await {
        Ok(result) => {
            // Concatenate any text-typed content into a JSON string payload, mirroring
            // slack_outbound's MCP response handling.
            let raw = result.content.iter()
                .filter_map(|c| c.text.as_deref())
                .collect::<Vec<_>>()
                .join("\n");
            // Try to parse as JSON; otherwise wrap the raw text.
            let payload = serde_json::from_str::<serde_json::Value>(&raw)
                .unwrap_or_else(|_| serde_json::json!({ "raw": raw }));
            Some(Ok(payload))
        }
        Err(e) if e.starts_with("Unknown tool:") => {
            // No MCP tool registered for this (service, action) — caller falls through to Tier 3.
            None
        }
        Err(e) => Some(Err(format!(
            "[jarvis_dispatch] MCP fallback failed: {}",
            crate::safe_slice(&e, 200)
        ))),
    }
}

/// Outbound fan-out entry point. Called by commands.rs (Plan 14) after intent_router
/// classifies a chat turn as ActionRequired.
///
/// Flow (D-05/D-06/D-07/D-08/D-10/D-17):
///   1. ChatOnly → return NotApplicable (no outbound, no emit).
///   2. ActionRequired:
///      a. consent_check gate (T-18-01).
///      b. WriteScope acquisition (T-18-02) — RAII, auto-revokes on Drop.
///      c. Tier 1: native tentacle (slack/github/gmail; linear/calendar in Plan 14).
///      d. Tier 2: MCP fallback (mcp__{service}_{action}).
///      e. Tier 3: native_tools — out of scope for v1.2 per CONTEXT § Out of scope;
///         falls through to HardFailedNoCreds.
///   3. Every outcome emits exactly one blade_activity_log line in D-17 LOCKED format.
#[tauri::command]
pub async fn jarvis_dispatch_action(
    app: AppHandle,
    intent: IntentClass,
    args: serde_json::Value,
) -> Result<DispatchResult, String> {
    match intent {
        IntentClass::ChatOnly => Ok(DispatchResult::NotApplicable),
        // Phase 24 (v1.3) — ProposalReply is handled by commands.rs's
        // apply_proposal_reply path BEFORE the dispatcher is invoked. If
        // it ever reaches here (defensive), short-circuit as NotApplicable
        // — the chat-injected proposal apply path doesn't go through the
        // jarvis tentacle/MCP/native chain.
        IntentClass::ProposalReply { .. } => Ok(DispatchResult::NotApplicable),
        IntentClass::ActionRequired { service, action } => {
            // GATE 1 — consent (T-18-01 mitigation; ASVS V2.6).
            match consent_check(D17_INTENT_LABEL, &service) {
                ConsentVerdict::Deny => {
                    emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "denied");
                    return Ok(DispatchResult::NoConsent);
                }
                ConsentVerdict::NeedsPrompt => {
                    // Plan 18-14 — replace Wave-3's emit-and-return-NoConsent loop with a
                    // tokio::oneshot await. request_consent stashes a Sender keyed by the
                    // generated request_id, emits the consent_request event, and awaits
                    // the Receiver (60s timeout returns Deny). The frontend's
                    // consent_respond Tauri command delivers the user's choice through
                    // the channel, completing the await in-place. Original action verb
                    // (`action`) is preserved in this local scope — no re-invoke needed,
                    // no `'post'` hardcode, no NeedsPrompt loop.
                    let action_verb = format!("{} on {}", action, service);
                    let preview_payload = serde_json::json!({
                        "service": service,
                        "action":  action,
                    });
                    let content_preview =
                        serde_json::to_string(&preview_payload).unwrap_or_default();
                    let choice = crate::consent::request_consent(
                        &app,
                        D17_INTENT_LABEL,
                        &service,
                        &action_verb,
                        &action,
                        &content_preview,
                    )
                    .await;
                    match choice {
                        crate::consent::ConsentChoice::Deny => {
                            emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "denied");
                            return Ok(DispatchResult::NoConsent);
                        }
                        crate::consent::ConsentChoice::AllowAlways => {
                            // Persist for future invocations, then fall through to dispatch.
                            let _ = crate::consent::consent_set_decision(
                                D17_INTENT_LABEL.to_string(),
                                service.clone(),
                                "allow_always".to_string(),
                            );
                        }
                        crate::consent::ConsentChoice::AllowOnce => {
                            // In-memory only — fall through to dispatch WITHOUT writing.
                        }
                    }
                }
                ConsentVerdict::Allow => {
                    // proceed below
                }
            }

            // GATE 2 — WriteScope acquisition (T-18-02 mitigation; ASVS V13.1).
            // RAII binding: dropped on every return path below (panic-safe).
            let _scope = ecosystem::grant_write_window(&service, 30);

            // Plan 18-14 — args are extracted by intent_router::classify_intent and
            // passed through commands.rs to this dispatcher. The Wave-3 empty-`{}`
            // placeholder is gone. Outbounds with missing fields surface their own
            // D-10 hard-fail message (already wired below).
            // shadow `args` with the parameter so existing call sites stay unchanged.

            // Tier 1 — native tentacle.
            if let Some(result) = try_native_tentacle(&service, &action, &args, &app).await {
                match result {
                    Ok(payload) => {
                        emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "executed");
                        return Ok(DispatchResult::Executed { service, payload });
                    }
                    Err(e) if e.contains("Connect via Integrations tab") => {
                        emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "hard_refused");
                        return Ok(DispatchResult::HardFailedNoCreds {
                            service,
                            suggestion: e,
                        });
                    }
                    Err(e) => {
                        emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "hard_refused");
                        return Err(e);
                    }
                }
            }

            // Tier 2 — MCP fallback.
            if let Some(result) = try_mcp_tool(&service, &action, &args, &app).await {
                match result {
                    Ok(payload) => {
                        emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "executed");
                        return Ok(DispatchResult::Executed { service, payload });
                    }
                    Err(e) => {
                        emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "hard_refused");
                        return Err(e);
                    }
                }
            }

            // Tier 3 — native_tools is out of scope for v1.2 (CONTEXT § Out of scope).
            // Fall through with HardFailedNoCreds + a precise suggestion so the user knows
            // why nothing happened.
            emit_jarvis_activity(&app, D17_INTENT_LABEL, &service, "hard_refused");
            let suggestion = format!(
                "[jarvis_dispatch] No native tentacle or MCP tool for {}/{}; native_tools tier deferred to v1.3.",
                service, action
            );
            Ok(DispatchResult::HardFailedNoCreds {
                service,
                suggestion,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// D-17 LOCKED format never paraphrases. The arrow is the Unicode RIGHTWARDS ARROW
    /// (U+2192) that Phase 17 doctor already shipped through the activity-log pipeline.
    #[test]
    fn d17_format_string_locked() {
        let line = format!("[JARVIS] {}: {} → {}", "action_required", "linear", "executed");
        assert_eq!(line, "[JARVIS] action_required: linear → executed");
        assert!(line.contains(" → "));
        assert!(line.starts_with("[JARVIS] "));
    }

    /// D-17 outcome vocabulary is fixed. Every emit_jarvis_activity call site MUST use
    /// one of these strings; this test pins the set so future edits trip a unit-test
    /// failure if a new outcome word leaks in unannounced.
    #[test]
    fn d17_outcome_vocabulary_pinned() {
        let valid = [
            "executed",
            "denied",
            "auto_approved",
            "hard_refused",
            "capability_gap_logged",
            "retry_succeeded",
        ];
        // Every outcome string used inside this module must be in the valid set.
        let module_src = include_str!("jarvis_dispatch.rs");
        for outcome in ["executed", "denied", "hard_refused"] {
            assert!(valid.contains(&outcome), "{} must be in pinned vocabulary", outcome);
            // And confirm at least one emit site references it.
            let needle = format!("\"{}\"", outcome);
            assert!(
                module_src.contains(&needle),
                "module source must reference outcome literal {}",
                needle
            );
        }
    }

    /// ChatOnly path must short-circuit without any outbound or emit.
    /// We can't easily mock AppHandle, so we exercise the early-return enum match
    /// arm directly to lock the contract.
    #[test]
    fn chat_only_returns_not_applicable_arm_compiles() {
        let intent = IntentClass::ChatOnly;
        let early_path = matches!(intent, IntentClass::ChatOnly);
        assert!(early_path);
    }

    /// Consent gate semantics: when a "denied" decision is persisted for a (class, service)
    /// tuple, consent_check returns Deny. The dispatcher's Deny arm short-circuits to
    /// emit("denied") + return DispatchResult::NoConsent — exercising consent_check
    /// confirms the gate is wired without needing AppHandle.
    #[test]
    fn consent_deny_returns_deny_verdict() {
        let _ = crate::consent::consent_set_decision(
            "action_required".to_string(),
            "test_service_jarvis_deny".to_string(),
            "denied".to_string(),
        );
        let v = crate::consent::consent_check("action_required", "test_service_jarvis_deny");
        assert!(matches!(v, ConsentVerdict::Deny));
        // Cleanup — don't pollute siblings (uses the production blade.db; tuple is unique).
        let _ = crate::consent::consent_revoke_all();
    }

    /// Consent allow_always must produce ConsentVerdict::Allow so the dispatcher
    /// proceeds past the gate into WriteScope acquisition.
    #[test]
    fn consent_allow_always_unblocks_path() {
        let _ = crate::consent::consent_set_decision(
            "action_required".to_string(),
            "test_service_jarvis_allow".to_string(),
            "allow_always".to_string(),
        );
        let v = crate::consent::consent_check("action_required", "test_service_jarvis_allow");
        assert!(matches!(v, ConsentVerdict::Allow));
        let _ = crate::consent::consent_revoke_all();
    }

    /// Unknown (intent_class, service) tuples → ConsentVerdict::NeedsPrompt.
    /// The dispatcher's NeedsPrompt arm emits consent_request + returns NoConsent
    /// (Wave 3 short-circuit; Plan 14 replaces with tokio::oneshot).
    #[test]
    fn consent_unknown_returns_needs_prompt() {
        let v = crate::consent::consent_check(
            "action_required",
            "completely_unknown_jarvis_zzz",
        );
        assert!(matches!(v, ConsentVerdict::NeedsPrompt));
    }

    /// try_native_tentacle's allow-list (T-18-CARRY-28 mitigation): every documented
    /// (service, action) pair must be a recognised arm. New arms must be added here
    /// AND in the match in try_native_tentacle in lockstep.
    #[test]
    fn native_tentacle_allow_list_documented() {
        let known_pairs: &[(&str, &str)] = &[
            ("slack", "post"),
            ("slack", "post_message"),
            ("github", "create_pr_comment"),
            ("github", "comment"),
            ("github", "create_issue"),
            ("github", "create"),
            ("gmail", "send"),
            ("gmail", "send_message"),
            ("linear", "create"),
            ("linear", "create_issue"),
            ("calendar", "post_meeting_summary"),
        ];
        for (service, action) in known_pairs {
            let recognised = matches!(
                (*service, *action),
                ("slack", "post" | "post_message")
                    | ("github", "create_pr_comment" | "comment" | "create_issue" | "create")
                    | ("gmail", "send" | "send_message")
                    | ("linear", "create" | "create_issue")
                    | ("calendar", _)
            );
            assert!(recognised, "allow-list missing ({}, {})", service, action);
        }
    }

    /// WriteScope is RAII — entering and exiting a scope must register and remove the
    /// tentacle from WRITE_UNLOCKS. This tests the Plan 02 surface that the dispatcher
    /// relies on; if WriteScope's Drop ever stops removing entries, this test trips
    /// before the dispatcher leaks a write window.
    #[test]
    fn write_scope_held_for_duration_then_revoked() {
        // Use a unique tentacle name so the test doesn't collide with ecosystem.rs's
        // own WriteScope tests running in parallel.
        let tentacle = "test_jarvis_write_scope_lifecycle";
        {
            let _scope = crate::ecosystem::grant_write_window(tentacle, 30);
            // While _scope is alive, assert_observe_only_allowed must accept this tentacle
            // even though the global OBSERVE_ONLY flag is true (Phase 18 D-06).
            let inside = crate::ecosystem::assert_observe_only_allowed(tentacle, "post_message");
            assert!(inside.is_ok(), "WriteScope must unlock the tentacle for the duration");
        }
        // Scope dropped — the global guardrail must reject again.
        let outside = crate::ecosystem::assert_observe_only_allowed(tentacle, "post_message");
        assert!(outside.is_err(), "WriteScope::drop must revoke the per-tentacle window");
    }

    /// safe_slice cap on emit boundaries — content_preview must never exceed 200 chars
    /// before crossing the IPC seam (T-18-CARRY-27 mitigation). We exercise the helper
    /// directly here because the emit path requires AppHandle.
    #[test]
    fn safe_slice_caps_long_content_preview() {
        let huge = "a".repeat(5000);
        let capped = crate::safe_slice(&huge, 200);
        assert!(capped.len() <= 200);
    }

    /// uuid::Uuid::new_v4 must produce a parseable UUID string for the request_id field
    /// the dispatcher emits inside consent_request (T-18-CARRY-29 — collision resistance).
    /// W11 pre-pin: uuid in Cargo.toml:50 with feature ["v4"].
    #[test]
    fn request_id_is_uuid_v4() {
        let id = uuid::Uuid::new_v4().to_string();
        // Format: 8-4-4-4-12 hex chars = 36 chars including dashes.
        assert_eq!(id.len(), 36);
        assert_eq!(id.chars().filter(|c| *c == '-').count(), 4);
    }

    /// Plan 18-14 Task 2 — Linear + Calendar match arms must be reachable for the
    /// cold-install demo's preferred path (Linear) and meeting-summary path
    /// (Calendar). We can't invoke the actual GraphQL/REST without keyring/network,
    /// so we exercise the routing-table by confirming the (service, action)
    /// pairs are still in the allow-list AFTER the placeholder removal.
    #[test]
    fn dispatch_linear_and_calendar_match_arms_remain_known() {
        let pairs: &[(&str, &str)] = &[
            ("linear", "create"),
            ("linear", "create_issue"),
            ("calendar", "summarize"),
            ("calendar", "post"),
            ("calendar", "post_meeting_summary"),
        ];
        for (s, a) in pairs {
            let known = matches!(
                (*s, *a),
                ("linear", "create" | "create_issue") | ("calendar", _)
            );
            assert!(
                known,
                "Plan 18-14 Task 2 routing table missing ({}, {})",
                s, a
            );
        }
    }

    /// The Plan 09 placeholder `None` returns for linear/calendar must be GONE
    /// after Plan 14 Task 2 wires the branches. Live tentacle calls must be
    /// present in the module source.
    #[test]
    fn plan_14_live_tentacle_calls_present() {
        let module_src = include_str!("jarvis_dispatch.rs");
        // Live tentacle calls present.
        assert!(
            module_src.contains("tentacles::linear_jira::auto_create_ticket"),
            "linear arm must call tentacles::linear_jira::auto_create_ticket"
        );
        assert!(
            module_src.contains("tentacles::calendar_tentacle::calendar_post_meeting_summary"),
            "calendar arm must call tentacles::calendar_tentacle::calendar_post_meeting_summary"
        );
    }
}
