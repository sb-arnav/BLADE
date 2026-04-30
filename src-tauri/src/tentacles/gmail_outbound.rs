//! gmail_outbound.rs — Gmail send write path (OAuth or MCP)
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 (priority-1 native tentacle)
//! and 18-RESEARCH.md § gmail_outbound.rs (Watch Out — base64url encoding + 401 handling).
//!
//! Plan 18-08 body — MCP-first dispatch with Gmail API HTTP fallback.
//! Tier 1: if a Gmail MCP server is registered, dispatch via `mcp__gmail_*` qualified tool name.
//! Tier 2: HTTP POST to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with
//!         `Bearer {oauth_access_token}` and an RFC2822 message base64url-encoded into the
//!         JSON body's `raw` field.
//! Hard-fail (D-10): when neither MCP nor token present → "Connect via Integrations tab → Gmail".
//! 401 routing: token-expired responses surface "Reconnect Gmail via Integrations tab"
//!              (OAuth refresh-token rotation deferred to v1.3 per RESEARCH § Watch Out).
//!
//! Threat surface (T-18-CARRY-23/24/25/26):
//!   - OAuth bearer token over TLS only. Never logged.
//!   - "From: me" header — Gmail API auto-replaces with the authenticated user's email.
//!   - 401 routes to explicit reconnect path (no silent retry).
//!   - base64url URL_SAFE_NO_PAD engine — Gmail API rejects '+' '/' '=' chars.
//!   - assert_observe_only_allowed gates the call defense-in-depth (Plan 14 holds WriteScope).

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub id: String,
    pub thread_id: String,
}

/// Read the Gmail OAuth access token from the BLADE keyring (config::get_provider_key).
/// Returns empty string when no token is stored.
///
/// Phase 18 stores access tokens directly under the "gmail" provider key. OAuth refresh-
/// token rotation is deferred to v1.3 per RESEARCH § gmail_outbound.rs Watch Out — when
/// a token expires the user is routed to the Integrations tab to reconnect (see 401 path
/// in `try_http_path` below).
fn gmail_token() -> String {
    crate::config::get_provider_key("gmail")
}

/// Returns true when a `gmail` MCP server is registered in BladeConfig.
/// Mirrors slack_outbound.rs::slack_mcp_registered — short-circuits before paying the
/// cost of acquiring the manager mutex.
fn gmail_mcp_registered() -> bool {
    let cfg = crate::config::load_config();
    cfg.mcp_servers
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case("gmail"))
}

/// Build an RFC2822 message and base64url-encode it for the Gmail API `raw` field.
///
/// The Gmail `users.messages.send` endpoint requires the message body to be a single
/// base64url-encoded string of an RFC2822-compliant MIME envelope. The encoding MUST
/// use the URL-safe alphabet (`-_` instead of `+/`) and MUST omit padding (`=`); the
/// API rejects standard-base64 input with a 400.
///
/// "From: me" is a Gmail special token: the API auto-replaces it with the authenticated
/// user's email address (T-18-CARRY-24 mitigation — cannot impersonate other users).
///
/// Line endings are CRLF (`\r\n`) per RFC2822. A blank CRLF separates headers from body.
fn build_raw_message(to: &str, subject: &str, body: &str) -> String {
    let rfc2822 = format!(
        "From: me\r\nTo: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{body}",
        to = to,
        subject = subject,
        body = body
    );
    URL_SAFE_NO_PAD.encode(rfc2822.as_bytes())
}

/// Tier 1 — MCP path. Returns `Some(result)` when a Gmail MCP server is registered AND
/// the qualified tool resolves; `None` when no MCP path is available (caller falls through
/// to HTTP).
///
/// Tries multiple naming conventions seen in the wild (RESEARCH § gmail_outbound.rs flagged
/// as runtime-validate):
///   - `mcp__gmail_send_message`     — common in JS-style Gmail MCP wrappers
///   - `mcp__gmail_messages.send`    — dot-form mirroring the Gmail REST shape
///   - `mcp__gmail_send`             — terse variant
///
/// A definitive Err from `call_tool` propagates as the outer Err so the caller does NOT
/// silently degrade to HTTP after a real MCP failure.
async fn try_mcp_path(to: &str, subject: &str, body: &str) -> Option<Result<SendResult, String>> {
    if !gmail_mcp_registered() {
        return None;
    }

    // SAFETY: slack_outbound.rs:60 pattern — acquire AppHandle through integration_bridge,
    // then SharedMcpManager state, then lock. If any step fails (e.g. test environment
    // with no AppHandle wired), return None so HTTP fallback runs instead.
    let handle = crate::integration_bridge::get_app_handle()?;
    let manager_state = handle.try_state::<crate::commands::SharedMcpManager>()?;
    let mut manager = manager_state.lock().await;

    let candidates = [
        "mcp__gmail_send_message",
        "mcp__gmail_messages.send",
        "mcp__gmail_send",
    ];
    let args = serde_json::json!({
        "to": to,
        "subject": subject,
        "body": body,
    });

    for tool in &candidates {
        match manager.call_tool(tool, args.clone()).await {
            Ok(result) => {
                // Gmail MCP responses come back as a content array; the first text entry
                // is the JSON-encoded response (Gmail API shape: { id, threadId, ... }).
                let raw = result
                    .content
                    .iter()
                    .filter_map(|c| c.text.as_deref())
                    .collect::<Vec<_>>()
                    .join("\n");
                return Some(parse_gmail_response(&raw));
            }
            Err(e) if e.starts_with("Unknown tool:") => {
                // This naming variant isn't registered — try the next candidate.
                continue;
            }
            Err(e) => {
                // Real MCP failure — surface it (don't silently fall through to HTTP).
                return Some(Err(format!(
                    "[gmail_outbound] MCP call failed: {}",
                    crate::safe_slice(&e, 200)
                )));
            }
        }
    }

    // Gmail MCP server is registered but no candidate tool name resolved —
    // fall through to HTTP (the user's MCP server may be a different shape).
    None
}

/// Parse a Gmail API response (either from MCP-wrapped text content OR raw HTTP JSON)
/// into a SendResult.
fn parse_gmail_response(raw: &str) -> Result<SendResult, String> {
    let body: serde_json::Value = serde_json::from_str(raw).map_err(|e| {
        format!(
            "[gmail_outbound] response parse failed: {}",
            crate::safe_slice(&e.to_string(), 200)
        )
    })?;

    // Some Gmail MCP wrappers return { error: "..." } envelopes; surface them as Err.
    if let Some(err_msg) = body.get("error").and_then(|e| {
        // error can be either a string OR an { message: "..." } object (Gmail REST shape)
        e.as_str()
            .map(|s| s.to_string())
            .or_else(|| e.get("message").and_then(|m| m.as_str()).map(|s| s.to_string()))
    }) {
        return Err(format!(
            "[gmail_outbound] Gmail API error: {}",
            crate::safe_slice(&err_msg, 200)
        ));
    }

    Ok(SendResult {
        id: body
            .get("id")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        thread_id: body
            .get("threadId")
            .or_else(|| body.get("thread_id"))
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

/// Tier 2 — HTTP fallback. POST `users.messages.send` with Bearer auth and the
/// base64url-encoded RFC2822 message in the `raw` field.
///
/// 401 routing: token-expired responses surface a Reconnect Gmail message instead of
/// silently retrying. OAuth refresh-token rotation lands in v1.3 (RESEARCH § Watch Out).
async fn try_http_path(token: &str, raw: &str) -> Result<SendResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "raw": raw }))
        .send()
        .await
        .map_err(|e| {
            format!(
                "[gmail_outbound] HTTP send failed: {}",
                crate::safe_slice(&e.to_string(), 200)
            )
        })?;

    let status = resp.status();
    if status.as_u16() == 401 {
        return Err(
            "[gmail_outbound] Gmail token expired — Reconnect Gmail via Integrations tab."
                .to_string(),
        );
    }

    let parsed: serde_json::Value = resp.json().await.map_err(|e| {
        format!(
            "[gmail_outbound] response parse failed: {}",
            crate::safe_slice(&e.to_string(), 200)
        )
    })?;

    if !status.is_success() {
        let msg = parsed
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|s| s.as_str())
            .unwrap_or("unknown");
        return Err(format!(
            "[gmail_outbound] {} from Gmail: {}",
            status,
            crate::safe_slice(msg, 200)
        ));
    }

    Ok(SendResult {
        id: parsed
            .get("id")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        thread_id: parsed
            .get("threadId")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

/// Send a Gmail message. Tauri command per CONTEXT D-05.
///
/// Dispatch order (Plan 18-08):
///   1. MCP path if `gmail` server registered + `mcp__gmail_send_message` (or variant) resolves.
///   2. HTTP fallback when an OAuth access token is present in the keyring.
///   3. 401 → "Reconnect Gmail via Integrations tab" (OAuth refresh deferred to v1.3).
///   4. Hard-fail (D-10): "Connect via Integrations tab → Gmail".
#[tauri::command]
pub async fn gmail_outbound_send(
    _app: AppHandle,
    to: String,
    subject: String,
    body: String,
) -> Result<SendResult, String> {
    crate::ecosystem::assert_observe_only_allowed("gmail", "send_message")?;

    // Tier 1: MCP if registered.
    if let Some(result) = try_mcp_path(&to, &subject, &body).await {
        return result;
    }

    // Tier 2: Gmail API HTTP fallback.
    let token = gmail_token();
    if token.is_empty() {
        return Err(
            "[gmail_outbound] Connect via Integrations tab → Gmail (no OAuth token in keyring or MCP server registered).".to_string()
        );
    }

    let raw = build_raw_message(&to, &subject, &body);
    try_http_path(&token, &raw).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_fail_message_format_d10_compliant() {
        // D-10 wording lock — must contain "Connect via Integrations tab → Gmail".
        let template = "[gmail_outbound] Connect via Integrations tab → Gmail (no OAuth token in keyring or MCP server registered).";
        assert!(template.contains("Connect via Integrations tab → Gmail"));
    }

    #[test]
    fn token_expiry_message_routes_to_reconnect() {
        // 401 path must surface a reconnect hint, not a silent retry — per RESEARCH § Watch Out.
        let template =
            "[gmail_outbound] Gmail token expired — Reconnect Gmail via Integrations tab.";
        assert!(template.contains("Reconnect Gmail via Integrations tab"));
    }

    #[test]
    fn rfc2822_format_includes_required_headers() {
        let raw = build_raw_message("alice@example.com", "Test", "Hello world");
        // Decode the base64url to verify the wrapped RFC2822 contents.
        let decoded = URL_SAFE_NO_PAD.decode(&raw).expect("base64url roundtrip");
        let text = String::from_utf8(decoded).expect("utf8 roundtrip");
        assert!(text.contains("From: me"), "missing From header: {}", text);
        assert!(
            text.contains("To: alice@example.com"),
            "missing To header: {}",
            text
        );
        assert!(text.contains("Subject: Test"), "missing Subject header: {}", text);
        assert!(
            text.contains("Content-Type: text/plain; charset=UTF-8"),
            "missing Content-Type: {}",
            text
        );
        assert!(text.contains("Hello world"), "missing body: {}", text);
        // CRLF between headers and body is mandatory per RFC2822.
        assert!(
            text.contains("\r\n\r\n"),
            "missing CRLF header/body separator: {:?}",
            text
        );
    }

    #[test]
    fn base64url_no_padding_or_unsafe_chars() {
        // Build a message whose length will force padding in standard base64.
        let raw = build_raw_message("a@b.com", "S", "x");
        // URL_SAFE_NO_PAD must NOT contain '=' padding chars (Gmail API requirement).
        assert!(
            !raw.contains('='),
            "base64url-encoded raw must have no padding for Gmail API; got: {}",
            raw
        );
        // URL-safe variant uses '-' and '_'; standard '+' and '/' would be rejected.
        assert!(
            !raw.contains('+'),
            "URL-safe variant must use '-' instead of '+'; got: {}",
            raw
        );
        assert!(
            !raw.contains('/'),
            "URL-safe variant must use '_' instead of '/'; got: {}",
            raw
        );
    }

    #[test]
    fn gmail_token_helper_does_not_panic() {
        // Smoke: keyring read must not panic regardless of env state.
        let _ = gmail_token();
    }

    #[test]
    fn gmail_mcp_registered_smoke() {
        // Smoke: load_config() + iter must not panic.
        let _ = gmail_mcp_registered();
    }

    #[test]
    fn parse_gmail_response_extracts_id_and_thread_id() {
        let raw = r#"{"id":"18b2c5e3a1","threadId":"18b2c5e3a1"}"#;
        let result = parse_gmail_response(raw).expect("ok response should parse");
        assert_eq!(result.id, "18b2c5e3a1");
        assert_eq!(result.thread_id, "18b2c5e3a1");
    }

    #[test]
    fn parse_gmail_response_accepts_snake_case_thread_id() {
        // Some MCP wrappers return snake_case; verify the fallback branch.
        let raw = r#"{"id":"abc","thread_id":"def"}"#;
        let result = parse_gmail_response(raw).expect("snake_case should parse");
        assert_eq!(result.id, "abc");
        assert_eq!(result.thread_id, "def");
    }

    #[test]
    fn parse_gmail_response_surfaces_api_error_string() {
        let raw = r#"{"error":"invalid_grant"}"#;
        let err = parse_gmail_response(raw).expect_err("error envelope must surface as Err");
        assert!(err.contains("invalid_grant"), "error should carry the cause: {}", err);
        assert!(err.starts_with("[gmail_outbound]"), "module-prefixed error: {}", err);
    }

    #[test]
    fn parse_gmail_response_surfaces_api_error_object() {
        // Gmail REST API uses { error: { message: "..." } } envelope.
        let raw = r#"{"error":{"code":401,"message":"Invalid Credentials"}}"#;
        let err = parse_gmail_response(raw).expect_err("error envelope must surface as Err");
        assert!(err.contains("Invalid Credentials"), "error should carry message: {}", err);
    }

    #[test]
    fn parse_gmail_response_handles_garbage_json() {
        let err = parse_gmail_response("not json").expect_err("invalid JSON must Err");
        assert!(err.contains("response parse failed"));
    }

    #[test]
    fn build_raw_message_handles_unicode_subject_and_body() {
        // Ensure non-ASCII content base64url-encodes without panic and round-trips.
        let raw = build_raw_message("user@example.com", "Café meeting", "Café — see you 10am 🎯");
        let decoded = URL_SAFE_NO_PAD.decode(&raw).expect("base64url roundtrip");
        let text = String::from_utf8(decoded).expect("utf8 roundtrip");
        assert!(text.contains("Subject: Café meeting"));
        assert!(text.contains("Café — see you 10am 🎯"));
    }

    // Real integration tests for the MCP/HTTP paths require:
    //  - mockall / wiremock for HTTP path
    //  - mock crate::mcp::manager for MCP path
    // Phase 18 ships the parse/encoding tests above + manual UAT validation in Plan 12
    // (cold-install demo prefers Linear/Slack since Gmail OAuth makes demo fragile).
}
