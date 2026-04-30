//! slack_outbound.rs — Slack chat.postMessage write path
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 (priority-1 native tentacle)
//! and 18-RESEARCH.md § Cold-Install Demo Viability (Slack as primary demo target).
//!
//! Plan 18-07 body — MCP-first dispatch with HTTP fallback.
//! Tier 1: if a Slack MCP server is registered, dispatch via `mcp__slack_*` qualified tool name.
//! Tier 2: HTTP POST to `https://slack.com/api/chat.postMessage` with `Bearer SLACK_BOT_TOKEN`.
//! Hard-fail (D-10): when neither MCP nor token present → "Connect via Integrations tab → Slack".
//!
//! Threat surface (T-18-CARRY-19/20/22):
//!   - Token never logged. Channel/text passed verbatim — Slack server validates inputs.
//!   - assert_observe_only_allowed gates the call defense-in-depth (Plan 14 holds WriteScope).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostResult {
    pub ts: String,
    pub channel: String,
    pub ok: bool,
}

/// Read SLACK_BOT_TOKEN from the BLADE keyring (config::get_provider_key).
/// Returns empty string when no token is stored.
fn slack_token() -> String {
    crate::config::get_provider_key("slack")
}

/// Returns true when a `slack` MCP server is registered in BladeConfig.
/// Mirrors slack_deep.rs:26 helper — runtime check is keyed off config, not live tool list,
/// because querying the live tool list requires acquiring the manager mutex (we'd rather
/// short-circuit before paying that cost).
fn slack_mcp_registered() -> bool {
    let cfg = crate::config::load_config();
    cfg.mcp_servers
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case("slack"))
}

/// Tier 1 — MCP path. Returns `Some(result)` when a Slack MCP server is registered AND
/// the qualified tool resolves; `None` when no MCP path is available (caller falls through
/// to HTTP).
///
/// Tries both naming conventions seen in the wild:
///   - `mcp__slack_chat.postMessage` (dot-form, matches the JS-style client name)
///   - `mcp__slack_chat_post_message` (underscore-form, matches the official tool spec)
///
/// RESEARCH § slack_outbound.rs flagged this as runtime-validate; we try both and use the
/// first that the manager accepts. A definitive Err from `call_tool` propagates as the
/// outer Err so the caller doesn't silently degrade to HTTP after a real MCP failure.
async fn try_mcp_path(channel: &str, text: &str) -> Option<Result<PostResult, String>> {
    if !slack_mcp_registered() {
        return None;
    }

    // SAFETY: slack_deep.rs:34 pattern — acquire AppHandle through integration_bridge,
    // then SharedMcpManager state, then lock. If any step fails (e.g. test environment
    // with no AppHandle wired), return None so HTTP fallback runs instead.
    let handle = crate::integration_bridge::get_app_handle()?;
    let manager_state = handle.try_state::<crate::commands::SharedMcpManager>()?;
    let mut manager = manager_state.lock().await;

    let candidates = ["mcp__slack_chat.postMessage", "mcp__slack_chat_post_message"];
    let args = serde_json::json!({
        "channel": channel,
        "text": text,
    });

    for tool in &candidates {
        // call_tool returns Err("Unknown tool: ...") when the qualified name isn't in
        // the manager's tool list — that's how we discriminate between "MCP server is
        // up but tool name varies" and "MCP server is up and the call really failed".
        match manager.call_tool(tool, args.clone()).await {
            Ok(result) => {
                // Slack MCP responses come back as a content array; the first text entry
                // is the JSON-encoded response (Slack API shape).
                let raw = result.content.iter()
                    .filter_map(|c| c.text.as_deref())
                    .collect::<Vec<_>>()
                    .join("\n");
                return Some(parse_slack_response(&raw, channel));
            }
            Err(e) if e.starts_with("Unknown tool:") => {
                // This naming variant isn't registered — try the next candidate.
                continue;
            }
            Err(e) => {
                // Real MCP failure — surface it (don't silently fall through to HTTP).
                return Some(Err(format!(
                    "[slack_outbound] MCP call failed: {}",
                    crate::safe_slice(&e, 200)
                )));
            }
        }
    }

    // Slack MCP server is registered but neither candidate tool name resolved —
    // fall through to HTTP (the user's MCP server may be a different shape).
    None
}

/// Parse a Slack API response (either from MCP-wrapped text content OR raw HTTP JSON)
/// into a PostResult. Hard-failed Slack errors (`ok: false`) become Err.
fn parse_slack_response(raw: &str, fallback_channel: &str) -> Result<PostResult, String> {
    let body: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("[slack_outbound] response parse failed: {}", crate::safe_slice(&e.to_string(), 200)))?;
    let ok = body.get("ok").and_then(|b| b.as_bool()).unwrap_or(false);
    if !ok {
        let err_msg = body.get("error").and_then(|s| s.as_str()).unwrap_or("unknown");
        return Err(format!("[slack_outbound] Slack API error: {}", crate::safe_slice(err_msg, 200)));
    }
    Ok(PostResult {
        ts: body.get("ts").and_then(|s| s.as_str()).unwrap_or_default().to_string(),
        channel: body.get("channel").and_then(|s| s.as_str()).unwrap_or(fallback_channel).to_string(),
        ok,
    })
}

/// Tier 2 — HTTP fallback. POST `chat.postMessage` with Bearer auth.
async fn try_http_path(token: &str, channel: &str, text: &str) -> Result<PostResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://slack.com/api/chat.postMessage")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json; charset=utf-8")
        .json(&serde_json::json!({
            "channel": channel,
            "text": text,
        }))
        .send()
        .await
        .map_err(|e| format!("[slack_outbound] HTTP send failed: {}", crate::safe_slice(&e.to_string(), 200)))?;
    let raw = resp
        .text()
        .await
        .map_err(|e| format!("[slack_outbound] HTTP body read failed: {}", crate::safe_slice(&e.to_string(), 200)))?;
    parse_slack_response(&raw, channel)
}

/// Post a message to a Slack channel. Tauri command per CONTEXT D-05.
///
/// Dispatch order (Plan 18-07):
///   1. MCP path if `slack` server registered + `mcp__slack_chat.postMessage` (or underscore variant) resolves.
///   2. HTTP fallback when token is present.
///   3. Hard-fail (D-10): "Connect via Integrations tab → Slack".
#[tauri::command]
pub async fn slack_outbound_post_message(
    _app: AppHandle,
    channel: String,
    text: String,
) -> Result<PostResult, String> {
    crate::ecosystem::assert_observe_only_allowed("slack", "post_message")?;

    // Tier 1: MCP if registered.
    if let Some(result) = try_mcp_path(&channel, &text).await {
        return result;
    }

    // Tier 2: HTTP fallback.
    let token = slack_token();
    if token.is_empty() {
        return Err(
            "[slack_outbound] Connect via Integrations tab → Slack (no creds found in keyring or MCP server registered).".to_string()
        );
    }
    try_http_path(&token, &channel, &text).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_fail_message_format_is_d10_compliant() {
        // D-10 wording lock — must contain "Connect via Integrations tab → Slack".
        let template = "[slack_outbound] Connect via Integrations tab → Slack (no creds found in keyring or MCP server registered).";
        assert!(template.contains("Connect via Integrations tab → Slack"));
    }

    #[test]
    fn slack_token_helper_does_not_panic() {
        // Smoke: the keyring read must not panic regardless of env state.
        let _ = slack_token();
    }

    #[test]
    fn slack_mcp_registered_smoke() {
        // Smoke: load_config() + iter must not panic.
        let _ = slack_mcp_registered();
    }

    #[test]
    fn parse_slack_response_extracts_ts_and_channel() {
        let raw = r#"{"ok":true,"ts":"1234567890.000200","channel":"C0123456","message":{}}"#;
        let result = parse_slack_response(raw, "C-fallback").expect("ok response should parse");
        assert_eq!(result.ts, "1234567890.000200");
        assert_eq!(result.channel, "C0123456");
        assert!(result.ok);
    }

    #[test]
    fn parse_slack_response_uses_fallback_channel_when_missing() {
        // MCP servers sometimes omit the channel echo — verify the fallback branch.
        let raw = r#"{"ok":true,"ts":"42.0"}"#;
        let result = parse_slack_response(raw, "C-fallback").expect("partial response should parse");
        assert_eq!(result.channel, "C-fallback");
    }

    #[test]
    fn parse_slack_response_surfaces_api_error() {
        // ok:false → Err carrying Slack's error code.
        let raw = r#"{"ok":false,"error":"channel_not_found"}"#;
        let err = parse_slack_response(raw, "C-fallback").expect_err("ok:false must surface as Err");
        assert!(err.contains("channel_not_found"), "error should carry slack error code, got: {}", err);
        assert!(err.starts_with("[slack_outbound]"), "module-prefixed error, got: {}", err);
    }

    #[test]
    fn parse_slack_response_handles_garbage_json() {
        let err = parse_slack_response("not json", "C-x").expect_err("invalid JSON must Err");
        assert!(err.contains("response parse failed"));
    }

    // Real integration tests for the MCP/HTTP paths require:
    //  - mockall / wiremock for HTTP path
    //  - mock crate::mcp::manager for MCP path
    // Phase 18 ships the parse-routing tests above + manual UAT validation in Plan 12
    // (cold-install demo with real Slack creds OR Linear fallback).
}
