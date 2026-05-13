//! Phase 50 — OAUTH-TESTS — GitHub OAuth integration tests against localhost mock server.
//!
//! Per V2-AUTONOMOUS-HANDOFF.md §1: BLADE is a product. We do NOT authenticate
//! against real GitHub at build time. This test exercises the JSON-Accept
//! header path, the code-exchange round-trip, and the RFC 8628 device-code
//! polling flow (slow_down → success) against a mock HTTP server bound to
//! 127.0.0.1 on an OS-assigned port.
//!
//! Matches the shape of `oauth_gmail_integration.rs` with a sequenced-response
//! variant for the device-flow test (each accept pops the next canned reply).
//!
//! Covered:
//!   1. auth URL shape — space-separated scopes (GitHub-specific), state,
//!      allow_signup.
//!   2. code exchange — confirms Accept: application/json header is sent AND
//!      parses the JSON response into the canonical OAuthToken.
//!   3. device-flow polling — first poll returns slow_down (interval bumps);
//!      second poll returns the access token; verify polling exits successfully.

use blade_lib::oauth::github;
use blade_lib::oauth::OAuthConfig;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// Mock server variant that serves a deterministic sequence of canned
/// responses — one per accepted connection. After the sequence is exhausted
/// it returns an HTTP 500 (helps catch over-polling regressions).
struct SeqMockServer {
    url: String,
    captured: Arc<Mutex<Vec<String>>>,
    // Kept as a field so the routes Arc lives as long as the server; the
    // spawned accept loop holds its own clone for actual reads.
    #[allow(dead_code)]
    routes: Arc<Mutex<std::collections::HashMap<String, Vec<&'static str>>>>,
}

impl SeqMockServer {
    async fn start(routes: Vec<(&'static str, Vec<&'static str>)>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind 0");
        let addr = listener.local_addr().expect("local_addr");
        let url = format!("http://{}", addr);
        let captured = Arc::new(Mutex::new(Vec::<String>::new()));
        let route_map: std::collections::HashMap<String, Vec<&'static str>> =
            routes.into_iter().map(|(p, r)| (p.to_string(), r)).collect();
        let routes = Arc::new(Mutex::new(route_map));
        let captured_for_task = captured.clone();
        let routes_for_task = routes.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else { break };
                let captured_clone = captured_for_task.clone();
                let routes_clone = routes_for_task.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = match stream.read(&mut buf).await {
                        Ok(n) => n,
                        Err(_) => return,
                    };
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    captured_clone.lock().await.push(req.clone());

                    // Parse the request line to find the path.
                    let first_line = req.lines().next().unwrap_or("");
                    let path = first_line.split_whitespace().nth(1).unwrap_or("");

                    let body = {
                        let mut routes = routes_clone.lock().await;
                        match routes.get_mut(path) {
                            Some(queue) if !queue.is_empty() => Some(queue.remove(0)),
                            _ => None,
                        }
                    };

                    let resp = match body {
                        Some(b) => format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            b.len(),
                            b
                        ),
                        None => "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                    };

                    let _ = stream.write_all(resp.as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });

        Self { url, captured, routes }
    }

    async fn captured(&self) -> Vec<String> {
        self.captured.lock().await.clone()
    }
}

fn mock_cfg(server_url: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: "integration-test-gh-client".into(),
        client_secret: "integration-test-gh-secret".into(),
        auth_url: format!("{}/auth", server_url),
        token_url: format!("{}/token", server_url),
        scope: github::DEFAULT_SCOPE.to_string(),
    }
}

#[tokio::test]
async fn github_auth_url_shape() {
    let cfg = mock_cfg("http://127.0.0.1:9999");
    let url = github::build_auth_url(&cfg, "test_state_gh", "http://127.0.0.1:9999/cb");

    assert!(url.starts_with("http://127.0.0.1:9999/auth?"), "url: {}", url);
    assert!(url.contains("client_id=integration-test-gh-client"), "url: {}", url);
    assert!(url.contains("redirect_uri="), "url: {}", url);
    assert!(url.contains("state=test_state_gh"), "url: {}", url);
    assert!(url.contains("allow_signup=true"), "url: {}", url);

    // GitHub scopes are space-separated — `%20` between values, `:` → `%3A`.
    // Default scope set: "repo user:email gist"
    assert!(url.contains("scope=repo%20user%3Aemail%20gist"), "url: {}", url);
}

#[tokio::test]
async fn github_code_exchange_with_accept_header() {
    let canned = r#"{"access_token":"gho_test_xyz","scope":"repo,user:email,gist","token_type":"bearer"}"#;
    let server = SeqMockServer::start(vec![("/token", vec![canned])]).await;
    let cfg = mock_cfg(&server.url);

    let tok = github::exchange_code_for_token(&cfg, "gh-test-code", "http://127.0.0.1:9999/cb")
        .await
        .expect("github exchange ok");

    assert_eq!(tok.access_token, "gho_test_xyz");
    assert_eq!(tok.scope, "repo,user:email,gist");
    assert_eq!(tok.token_type, "bearer");
    // No expires_in for classic OAuth apps without rotation.
    assert_eq!(tok.expires_at_unix, 0);
    assert_eq!(tok.refresh_token, "");

    // Verify the mock server received Accept: application/json + form body params.
    let reqs = server.captured().await;
    assert_eq!(reqs.len(), 1, "expected exactly one POST");
    let body = &reqs[0];
    assert!(body.contains("POST /token"), "got: {}", body);
    assert!(
        body.to_lowercase().contains("accept: application/json"),
        "Accept header missing — GitHub will return URL-encoded body without it. got: {}",
        body
    );
    assert!(body.contains("code=gh-test-code"), "got: {}", body);
    assert!(body.contains("client_id=integration-test-gh-client"), "got: {}", body);
    assert!(body.contains("client_secret=integration-test-gh-secret"), "got: {}", body);
}

#[tokio::test]
async fn github_device_flow_polling() {
    // Sequenced responses:
    //   /device/code → device-code start (1 hit)
    //   /token       → 1st: slow_down, 2nd: access_token
    let start_resp = r#"{"device_code":"DEV_CODE_ABC","user_code":"WXYZ-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":1}"#;
    let slow_down = r#"{"error":"slow_down"}"#;
    let success = r#"{"access_token":"gho_device_xyz","scope":"repo","token_type":"bearer"}"#;

    let server = SeqMockServer::start(vec![
        ("/device/code", vec![start_resp]),
        ("/token", vec![slow_down, success]),
    ]).await;
    let cfg = mock_cfg(&server.url);
    let device_code_url = format!("{}/device/code", server.url);

    // 1. Start device flow.
    let start = github::start_device_flow(&cfg, &device_code_url, &["repo"])
        .await
        .expect("device-code start ok");
    assert_eq!(start.device_code, "DEV_CODE_ABC");
    assert_eq!(start.user_code, "WXYZ-1234");
    assert_eq!(start.verification_uri, "https://github.com/login/device");
    assert_eq!(start.interval, 1);

    // 2. Poll. First response = slow_down (bumps interval), second = success.
    let t0 = std::time::Instant::now();
    let tok = github::poll_device_flow(&cfg, &start.device_code, start.interval, 10)
        .await
        .expect("device-flow poll ok");
    let elapsed = t0.elapsed();

    assert_eq!(tok.access_token, "gho_device_xyz");
    assert_eq!(tok.scope, "repo");
    assert_eq!(tok.token_type, "bearer");

    // Polling waited at least the interval each time:
    //   - First poll: 1s sleep, then slow_down received → interval bumps to 6s
    //   - Second poll: 6s sleep, then success.
    // Total elapsed should be ≥ 1+6 = 7s. Allow generous slack for CI.
    assert!(
        elapsed.as_secs() >= 6,
        "expected ≥6s elapsed (1s + bumped 6s), got {:?}",
        elapsed
    );

    // Verify both poll requests included the device-code grant_type.
    let reqs = server.captured().await;
    // 1 device-code start + 2 polls = 3 captures.
    assert_eq!(reqs.len(), 3, "expected 3 captures, got {}: {:?}", reqs.len(), reqs);
    let poll_reqs: Vec<&String> = reqs.iter().filter(|r| r.contains("POST /token")).collect();
    assert_eq!(poll_reqs.len(), 2, "expected 2 token polls");
    for r in &poll_reqs {
        assert!(
            r.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code")
                || r.contains("grant_type=urn:ietf:params:oauth:grant-type:device_code"),
            "device-code grant_type missing in poll request: {}",
            r
        );
        assert!(r.contains("device_code=DEV_CODE_ABC"), "got: {}", r);
    }
}
