//! Phase 46 — HUNT-10 — Google / Gmail OAuth (PRIMARY).
//!
//! Full implementation: auth URL builder, code-for-token exchange, refresh.
//! Integration tested against a localhost mock server in
//! `tests/oauth_gmail_integration.rs`. No real Google auth at build time.
//!
//! Endpoints (defaults — overridable via `OAuthConfig` for tests):
//!   - Auth URL:   https://accounts.google.com/o/oauth2/v2/auth
//!   - Token URL:  https://oauth2.googleapis.com/token
//!
//! Scopes for the v2.0 Gmail-read use case:
//!   https://www.googleapis.com/auth/gmail.readonly
//!   https://www.googleapis.com/auth/gmail.send
//!   https://www.googleapis.com/auth/userinfo.email
//!
//! Per V2-AUTONOMOUS-HANDOFF.md §1: BLADE is a product. Each user OAuths on
//! their own machine; we never hold Arnav's tokens at build time.

use super::{OAuthConfig, OAuthToken};
use serde::Deserialize;

/// Default Google auth endpoint.
pub const DEFAULT_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
/// Default Google token endpoint.
pub const DEFAULT_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// Default Gmail scopes (space-separated, the format Google expects in
/// the `scope` query param).
pub const DEFAULT_SCOPE: &str =
    "https://www.googleapis.com/auth/gmail.readonly \
     https://www.googleapis.com/auth/gmail.send \
     https://www.googleapis.com/auth/userinfo.email";

/// Production-ready Gmail OAuth config. Tests construct their own with mock URLs.
pub fn default_config(client_id: &str, client_secret: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        auth_url: DEFAULT_AUTH_URL.to_string(),
        token_url: DEFAULT_TOKEN_URL.to_string(),
        scope: DEFAULT_SCOPE.to_string(),
    }
}

/// Build the auth URL the user opens in their browser. After granting consent
/// Google redirects to `redirect_uri` with `?code=<auth_code>&state=<state>`.
///
/// `access_type=offline` + `prompt=consent` together force Google to issue a
/// refresh_token even on subsequent grants — without these, only the first
/// authorization for a (user, client_id) pair yields a refresh token.
pub fn build_auth_url(cfg: &OAuthConfig, state: &str, redirect_uri: &str) -> String {
    let q = vec![
        ("client_id", cfg.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", cfg.scope.as_str()),
        ("state", state),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("include_granted_scopes", "true"),
    ];
    let encoded: Vec<String> = q.iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect();
    format!("{}?{}", cfg.auth_url, encoded.join("&"))
}

/// Exchange an auth code for an access + refresh token.
///
/// Google returns:
///   { access_token, expires_in (seconds), refresh_token, scope, token_type }
/// We normalize to `OAuthToken { expires_at_unix }` so callers can compare
/// against `now_unix()` without re-doing arithmetic.
pub async fn exchange_code_for_token(
    cfg: &OAuthConfig,
    code: &str,
    redirect_uri: &str,
) -> Result<OAuthToken, String> {
    let params = [
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ];
    let resp: GoogleTokenResponse = reqwest::Client::new()
        .post(&cfg.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("gmail token POST: {}", e))?
        .error_for_status()
        .map_err(|e| format!("gmail token HTTP: {}", e))?
        .json()
        .await
        .map_err(|e| format!("gmail token JSON: {}", e))?;
    Ok(resp.normalize(now_unix()))
}

/// Refresh an access token using a stored refresh_token. Note: Google does NOT
/// return a new refresh_token on refresh — preserve the original.
pub async fn refresh_token(
    cfg: &OAuthConfig,
    refresh_token: &str,
) -> Result<OAuthToken, String> {
    let params = [
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    let mut resp: GoogleTokenResponse = reqwest::Client::new()
        .post(&cfg.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("gmail refresh POST: {}", e))?
        .error_for_status()
        .map_err(|e| format!("gmail refresh HTTP: {}", e))?
        .json()
        .await
        .map_err(|e| format!("gmail refresh JSON: {}", e))?;
    // Refresh responses omit refresh_token — re-stamp from the caller's stored value.
    if resp.refresh_token.is_none() || resp.refresh_token.as_deref() == Some("") {
        resp.refresh_token = Some(refresh_token.to_string());
    }
    Ok(resp.normalize(now_unix()))
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    scope: Option<String>,
    token_type: Option<String>,
}

impl GoogleTokenResponse {
    fn normalize(self, now: u64) -> OAuthToken {
        OAuthToken {
            access_token: self.access_token,
            refresh_token: self.refresh_token.unwrap_or_default(),
            expires_at_unix: self.expires_in.map(|s| now + s).unwrap_or(0),
            scope: self.scope.unwrap_or_default(),
            token_type: self.token_type.unwrap_or_else(|| "Bearer".to_string()),
        }
    }
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_contains_required_params() {
        let cfg = default_config("my-client.apps.googleusercontent.com", "secret");
        let url = build_auth_url(&cfg, "state-token-xyz", "http://localhost:8765/callback");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(url.contains("client_id=my-client.apps.googleusercontent.com"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("state=state-token-xyz"));
        assert!(url.contains("access_type=offline"));
        assert!(url.contains("prompt=consent"));
        // The redirect URI must be URL-encoded.
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A8765%2Fcallback"));
        // Scope must be URL-encoded (spaces become %20 via urlencoding).
        assert!(url.contains("gmail.readonly"));
    }

    #[test]
    fn auth_url_uses_injected_endpoint_for_tests() {
        let mut cfg = default_config("cid", "csecret");
        cfg.auth_url = "http://127.0.0.1:9999/mock/auth".into();
        let url = build_auth_url(&cfg, "s", "http://127.0.0.1:9999/cb");
        assert!(url.starts_with("http://127.0.0.1:9999/mock/auth?"));
    }

    #[test]
    fn normalize_computes_absolute_expiry() {
        let raw = GoogleTokenResponse {
            access_token: "at-123".into(),
            expires_in: Some(3600),
            refresh_token: Some("rt-456".into()),
            scope: Some("a b".into()),
            token_type: Some("Bearer".into()),
        };
        let tok = raw.normalize(1_700_000_000);
        assert_eq!(tok.access_token, "at-123");
        assert_eq!(tok.refresh_token, "rt-456");
        assert_eq!(tok.expires_at_unix, 1_700_003_600);
        assert!(!tok.is_near_expiry(1_700_000_000));
        assert!(tok.is_near_expiry(1_700_003_600));
        assert!(tok.is_near_expiry(1_700_003_600 - 30)); // within 60s window
    }

    #[test]
    fn normalize_handles_missing_expires_in() {
        let raw = GoogleTokenResponse {
            access_token: "at-only".into(),
            expires_in: None,
            refresh_token: None,
            scope: None,
            token_type: None,
        };
        let tok = raw.normalize(1_700_000_000);
        assert_eq!(tok.expires_at_unix, 0);
        assert_eq!(tok.token_type, "Bearer");
        assert!(!tok.is_near_expiry(u64::MAX));
    }
}
