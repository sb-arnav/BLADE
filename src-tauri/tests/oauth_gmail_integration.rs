//! Phase 46 — HUNT-10 — Gmail OAuth integration test against localhost mock server.
//!
//! Per V2-AUTONOMOUS-HANDOFF.md §1: BLADE is a product. We do NOT authenticate
//! against real Google services at build time. This test exercises the full
//! token-exchange + refresh contract against a mock HTTP server bound to
//! 127.0.0.1 on an OS-assigned port.
//!
//! The mock server is hand-rolled (single tokio task, single-shot response)
//! rather than `wiremock` / `mockito` so we don't add new crate dependencies
//! during a hot phase. The test surface is small enough to do without one.
//!
//! Covered:
//!   1. Auth URL shape (build_auth_url) — defends required Google OAuth params.
//!   2. exchange_code_for_token — POSTs form-encoded body, parses JSON response,
//!      normalizes expires_in → expires_at_unix.
//!   3. refresh_token — preserves the caller's refresh_token when the server
//!      omits it (Google's actual behavior on refresh responses).

use blade_lib::oauth::gmail;
use blade_lib::oauth::OAuthConfig;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// Per-test mock server. Spawns a tokio task listening on 127.0.0.1:0,
/// returns the bound URL ("http://127.0.0.1:<port>") + a handle that records
/// every request body received so the test can assert on them.
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
        client_id: "integration-test-client".into(),
        client_secret: "integration-test-secret".into(),
        auth_url: format!("{}/auth", server_url),
        token_url: format!("{}/token", server_url),
        scope: gmail::DEFAULT_SCOPE.to_string(),
    }
}

#[tokio::test]
async fn build_auth_url_shape_matches_google_spec() {
    let cfg = mock_cfg("http://127.0.0.1:9999");
    let url = gmail::build_auth_url(&cfg, "rand-state-xyz", "http://127.0.0.1:9999/cb");
    assert!(url.starts_with("http://127.0.0.1:9999/auth?"));
    assert!(url.contains("client_id=integration-test-client"));
    assert!(url.contains("response_type=code"));
    assert!(url.contains("access_type=offline"));
    assert!(url.contains("prompt=consent"));
    assert!(url.contains("state=rand-state-xyz"));
    assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcb"));
}

#[tokio::test]
async fn exchange_code_for_token_normalizes_response() {
    let canned = r#"{"access_token":"at-abc","expires_in":3600,"refresh_token":"rt-xyz","scope":"gmail.readonly","token_type":"Bearer"}"#;
    let server = MockServer::start(canned).await;
    let cfg = mock_cfg(&server.url);

    let now = gmail::now_unix();
    let tok = gmail::exchange_code_for_token(&cfg, "test-code-123", "http://127.0.0.1:9999/cb")
        .await
        .expect("exchange ok");

    assert_eq!(tok.access_token, "at-abc");
    assert_eq!(tok.refresh_token, "rt-xyz");
    assert_eq!(tok.token_type, "Bearer");
    assert_eq!(tok.scope, "gmail.readonly");
    // expires_at_unix ≈ now + 3600 (allow 5s test scheduling slack)
    assert!(tok.expires_at_unix >= now + 3595);
    assert!(tok.expires_at_unix <= now + 3605);

    // Mock server saw the POST with the canonical params.
    let reqs = server.captured().await;
    assert_eq!(reqs.len(), 1, "expected exactly one POST");
    let body = &reqs[0];
    assert!(body.contains("POST /token"), "got: {}", body);
    assert!(body.contains("grant_type=authorization_code"), "got: {}", body);
    assert!(body.contains("code=test-code-123"), "got: {}", body);
    assert!(body.contains("client_id=integration-test-client"), "got: {}", body);
    assert!(body.contains("client_secret=integration-test-secret"), "got: {}", body);
}

#[tokio::test]
async fn refresh_token_preserves_refresh_when_omitted() {
    // Google's actual behavior: refresh response omits refresh_token. Our
    // adapter must re-stamp the caller's stored value into the returned token.
    let canned = r#"{"access_token":"at-new-after-refresh","expires_in":3600,"scope":"gmail.readonly","token_type":"Bearer"}"#;
    let server = MockServer::start(canned).await;
    let cfg = mock_cfg(&server.url);

    let tok = gmail::refresh_token(&cfg, "rt-original-stored-locally")
        .await
        .expect("refresh ok");

    assert_eq!(tok.access_token, "at-new-after-refresh");
    assert_eq!(
        tok.refresh_token, "rt-original-stored-locally",
        "refresh_token must be preserved across refresh (Google omits it)"
    );

    let reqs = server.captured().await;
    assert_eq!(reqs.len(), 1);
    assert!(reqs[0].contains("grant_type=refresh_token"));
    assert!(reqs[0].contains("refresh_token=rt-original-stored-locally"));
}
