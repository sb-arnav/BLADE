//! Phase 50 — OAUTH-TESTS — Slack OAuth integration tests against localhost mock server.
//!
//! Per V2-AUTONOMOUS-HANDOFF.md §1: BLADE is a product. We do NOT authenticate
//! against real Slack at build time. This test exercises Slack's token-exchange
//! envelope (`{ok: bool, ...}`) and the not-supported-refresh path against a
//! mock HTTP server bound to 127.0.0.1 on an OS-assigned port.
//!
//! Matches the shape of `oauth_gmail_integration.rs` — same hand-rolled mock
//! server pattern so we don't pull in `wiremock`/`mockito` during a hot phase.
//!
//! Covered:
//!   1. auth URL shape — comma-separated scopes (Slack-specific), state,
//!      response_type=code.
//!   2. code exchange — `{ok: true, access_token, team, authed_user}` envelope
//!      parses into the canonical OAuthToken.
//!   3. refresh_token — surfaces `OAuthError::NotSupported` (Slack OAuth v2
//!      doesn't issue refresh tokens).

use blade_lib::oauth::slack;
use blade_lib::oauth::{OAuthConfig, OAuthError};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

struct MockServer {
    url: String,
    captured: Arc<Mutex<Vec<String>>>,
}

impl MockServer {
    async fn start(canned: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind 0");
        let addr = listener.local_addr().expect("local_addr");
        let url = format!("http://{}", addr);
        let captured = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured_for_task = captured.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else { break };
                let captured_clone = captured_for_task.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = match stream.read(&mut buf).await {
                        Ok(n) => n,
                        Err(_) => return,
                    };
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    captured_clone.lock().await.push(req);

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        canned.len(),
                        canned
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        Self { url, captured }
    }

    async fn captured(&self) -> Vec<String> {
        self.captured.lock().await.clone()
    }
}

fn mock_cfg(server_url: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: "integration-test-slack-client".into(),
        client_secret: "integration-test-slack-secret".into(),
        auth_url: format!("{}/auth", server_url),
        token_url: format!("{}/token", server_url),
        scope: slack::DEFAULT_BOT_SCOPE.to_string(),
    }
}

#[tokio::test]
async fn slack_auth_url_shape() {
    let cfg = mock_cfg("http://127.0.0.1:9999");
    let url = slack::build_auth_url(&cfg, "test_state", "http://127.0.0.1:9999/cb", "");

    assert!(url.starts_with("http://127.0.0.1:9999/auth?"), "url: {}", url);
    assert!(url.contains("client_id=integration-test-slack-client"), "url: {}", url);
    assert!(url.contains("redirect_uri="), "url: {}", url);
    assert!(url.contains("response_type=code"), "url: {}", url);
    assert!(url.contains("state=test_state"), "url: {}", url);

    // Slack scopes are comma-separated — confirm via URL-encoded `%2C`.
    // Default scope set: chat:write,channels:read,users:read,groups:read,im:read,mpim:read
    assert!(url.contains("chat%3Awrite"), "url: {}", url);
    assert!(url.contains("channels%3Aread"), "url: {}", url);
    assert!(url.contains("users%3Aread"), "url: {}", url);
    assert!(url.contains("groups%3Aread"), "url: {}", url);
    assert!(url.contains("im%3Aread"), "url: {}", url);
    assert!(url.contains("mpim%3Aread"), "url: {}", url);
    // Comma separator — `,` URL-encoded is `%2C`.
    assert!(url.contains("%2C"), "expected comma-separated scopes, url: {}", url);

    // user_scope omitted when blank.
    assert!(!url.contains("user_scope="), "url: {}", url);
}

#[tokio::test]
async fn slack_code_exchange_parses_token() {
    // Slack envelope: ok=true, access_token, team, authed_user.
    let canned = r#"{"ok":true,"access_token":"xoxb-test-token-abc","scope":"chat:write,channels:read","token_type":"bot","bot_user_id":"U_BOT","app_id":"A_APP","team":{"id":"T123","name":"Test Workspace"},"authed_user":{"id":"U456","scope":"","access_token":"","token_type":""}}"#;
    let server = MockServer::start(canned).await;
    let cfg = mock_cfg(&server.url);

    let tok = slack::exchange_code_for_token(&cfg, "slack-test-code", "http://127.0.0.1:9999/cb")
        .await
        .expect("slack exchange ok");

    assert_eq!(tok.access_token, "xoxb-test-token-abc");
    assert_eq!(tok.refresh_token, "", "Slack OAuth v2 has no refresh token");
    assert_eq!(tok.scope, "chat:write,channels:read");
    assert_eq!(tok.token_type, "bot");
    // No expires_in for standard installs — should be 0.
    assert_eq!(tok.expires_at_unix, 0);

    // Mock server saw the POST with the canonical params.
    let reqs = server.captured().await;
    assert_eq!(reqs.len(), 1, "expected exactly one POST");
    let body = &reqs[0];
    assert!(body.contains("POST /token"), "got: {}", body);
    assert!(body.contains("code=slack-test-code"), "got: {}", body);
    assert!(body.contains("client_id=integration-test-slack-client"), "got: {}", body);
    assert!(body.contains("client_secret=integration-test-slack-secret"), "got: {}", body);
}

#[tokio::test]
async fn slack_ok_false_surfaces_provider_error() {
    // Slack returns HTTP 200 with `{ok: false, error: "invalid_code"}` on bad auth.
    let canned = r#"{"ok":false,"error":"invalid_code"}"#;
    let server = MockServer::start(canned).await;
    let cfg = mock_cfg(&server.url);

    let err = slack::exchange_code_for_token(&cfg, "bogus", "http://127.0.0.1:9999/cb")
        .await
        .expect_err("expected ProviderError on ok=false");

    match err {
        OAuthError::ProviderError(code) => assert_eq!(code, "invalid_code"),
        other => panic!("expected ProviderError, got {:?}", other),
    }
}

#[tokio::test]
async fn slack_no_refresh_token_surfaces_error() {
    let cfg = mock_cfg("http://127.0.0.1:9999"); // not contacted — returns immediately
    let err = slack::refresh_token(&cfg, "any-rt")
        .await
        .expect_err("expected NotSupported");

    match err {
        OAuthError::NotSupported(msg) => {
            assert!(msg.contains("Slack"), "msg: {}", msg);
            assert!(msg.contains("refresh"), "msg: {}", msg);
        }
        other => panic!("expected NotSupported, got {:?}", other),
    }
}
