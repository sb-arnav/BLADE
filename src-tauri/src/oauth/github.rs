//! Phase 46 — HUNT-10 — GitHub OAuth (URL builder, v2.0 stub).
//! Phase 50 — OAUTH-GITHUB-FULL — Full implementation including device-code flow.
//!
//! Matches Gmail's surface (build_auth_url / exchange_code_for_token /
//! refresh_token) plus the headless `start_device_flow` / `poll_device_flow`
//! pair for installs without a browser.
//!
//! Endpoints (defaults — overridable via `OAuthConfig` for tests):
//!   - Auth URL:        https://github.com/login/oauth/authorize
//!   - Token URL:       https://github.com/login/oauth/access_token
//!   - Device-code URL: https://github.com/login/device/code
//!
//! Scope tradeoff:
//!   - `repo`  — full read+write on user repos (incl. private). Required for
//!               BLADE's first-task "open PR / commit on user's behalf" path.
//!   - `public_repo` — read+write only on public repos. Use this in place of
//!               `repo` if your install only needs public-facing actions.
//!   - `user:email` — verified email addresses for identity.
//!   - `gist` — create gists for share-snippet feature.
//!
//! Header quirk: GitHub's token endpoint defaults to a URL-encoded response.
//! We send `Accept: application/json` so the body comes back as JSON,
//! matching every other provider in this module.
//!
//! Refresh tokens: classic OAuth Apps do NOT issue refresh tokens unless the
//! app is configured with token expiration. GitHub Apps + OAuth Apps with
//! expiration enabled DO issue refresh tokens with the new flow. We support
//! both — `refresh_token()` returns `NotSupported` when no refresh_token
//! was originally returned, otherwise it executes the refresh request.

use super::{OAuthConfig, OAuthError, OAuthToken};
use serde::Deserialize;

pub const DEFAULT_AUTH_URL: &str = "https://github.com/login/oauth/authorize";
pub const DEFAULT_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
pub const DEFAULT_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
/// Default scopes: full repo (read+write), verified emails, gist creation.
/// Switch `repo` → `public_repo` if the install should be read-only on private repos.
/// Space-separated per GitHub's spec (unlike Slack which uses comma-separated).
pub const DEFAULT_SCOPE: &str = "repo user:email gist";

pub fn default_config(client_id: &str, client_secret: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        auth_url: DEFAULT_AUTH_URL.to_string(),
        token_url: DEFAULT_TOKEN_URL.to_string(),
        scope: DEFAULT_SCOPE.to_string(),
    }
}

/// Build the GitHub auth URL. The user opens this in their browser; GitHub
/// redirects to `redirect_uri` with `?code=<auth_code>&state=<state>` after
/// they grant consent on the authorization screen.
pub fn build_auth_url(cfg: &OAuthConfig, state: &str, redirect_uri: &str) -> String {
    let q = vec![
        ("client_id", cfg.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("scope", cfg.scope.as_str()),
        ("state", state),
        ("allow_signup", "true"),
    ];
    let encoded: Vec<String> = q.iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect();
    format!("{}?{}", cfg.auth_url, encoded.join("&"))
}

/// Exchange an auth code for a GitHub token.
///
/// GitHub returns either a URL-encoded body OR JSON depending on the `Accept`
/// header. We force JSON with `Accept: application/json` — every other
/// provider returns JSON by default, this normalizes the path.
///
/// Response shape:
/// ```json
/// { "access_token": "gho_...", "scope": "...", "token_type": "bearer",
///   "refresh_token": "...", "expires_in": 28800 }
/// ```
/// `refresh_token` + `expires_in` only present for apps with token expiration.
pub async fn exchange_code_for_token(
    cfg: &OAuthConfig,
    code: &str,
    redirect_uri: &str,
) -> Result<OAuthToken, OAuthError> {
    let params = [
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", redirect_uri),
    ];
    let resp = reqwest::Client::new()
        .post(&cfg.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| OAuthError::Transport(format!("github token POST: {}", e)))?;

    let status = resp.status();
    let body_text = resp.text()
        .await
        .map_err(|e| OAuthError::Transport(format!("github token read: {}", e)))?;

    if !status.is_success() {
        return Err(OAuthError::ProviderError(format!("github HTTP {}: {}", status, body_text)));
    }

    let parsed: GitHubTokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| OAuthError::Parse(format!("github token JSON: {} (body: {})", e, body_text)))?;

    if let Some(err) = parsed.error {
        return Err(OAuthError::ProviderError(err));
    }

    let access_token = parsed.access_token
        .ok_or_else(|| OAuthError::Parse("github response missing access_token".into()))?;

    Ok(OAuthToken {
        access_token,
        refresh_token: parsed.refresh_token.unwrap_or_default(),
        expires_at_unix: parsed.expires_in
            .map(|s| now_unix().saturating_add(s))
            .unwrap_or(0),
        scope: parsed.scope.unwrap_or_default(),
        token_type: parsed.token_type.unwrap_or_else(|| "bearer".to_string()),
    })
}

/// Refresh a GitHub access token. Only works for apps configured with token
/// expiration (GitHub Apps OR OAuth Apps with token rotation enabled). If the
/// caller has an empty refresh_token (classic OAuth app, no expiration), we
/// surface `NotSupported` so they re-auth instead of POSTing garbage.
pub async fn refresh_token(
    cfg: &OAuthConfig,
    refresh_token: &str,
) -> Result<OAuthToken, OAuthError> {
    if refresh_token.is_empty() {
        return Err(OAuthError::NotSupported(
            "GitHub classic OAuth apps without token expiration don't issue refresh tokens — re-auth required".into()
        ));
    }

    let params = [
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    let resp = reqwest::Client::new()
        .post(&cfg.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| OAuthError::Transport(format!("github refresh POST: {}", e)))?;

    let status = resp.status();
    let body_text = resp.text()
        .await
        .map_err(|e| OAuthError::Transport(format!("github refresh read: {}", e)))?;

    if !status.is_success() {
        return Err(OAuthError::ProviderError(format!("github refresh HTTP {}: {}", status, body_text)));
    }

    let parsed: GitHubTokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| OAuthError::Parse(format!("github refresh JSON: {} (body: {})", e, body_text)))?;

    if let Some(err) = parsed.error {
        return Err(OAuthError::ProviderError(err));
    }

    let access_token = parsed.access_token
        .ok_or_else(|| OAuthError::Parse("github refresh missing access_token".into()))?;

    // Preserve caller's refresh_token when server omits it (matches Gmail behavior).
    let returned_refresh = parsed.refresh_token
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| refresh_token.to_string());

    Ok(OAuthToken {
        access_token,
        refresh_token: returned_refresh,
        expires_at_unix: parsed.expires_in
            .map(|s| now_unix().saturating_add(s))
            .unwrap_or(0),
        scope: parsed.scope.unwrap_or_default(),
        token_type: parsed.token_type.unwrap_or_else(|| "bearer".to_string()),
    })
}

// === Device-code flow (Phase 50, headless install path) ===========================

/// Response from `POST /login/device/code`. The user enters `user_code` at
/// `verification_uri` from any browser; meanwhile we poll the token endpoint
/// with `device_code` until they approve.
#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Kick off the device-code flow. Returns the user-facing `user_code` +
/// `verification_uri` (display to user) plus the machine-side `device_code`
/// (use in `poll_device_flow`).
///
/// `scopes` is provider-formatted (space-separated for GitHub). Defaults to
/// `cfg.scope` when callers pass empty.
pub async fn start_device_flow(
    cfg: &OAuthConfig,
    device_code_url: &str,
    scopes: &[&str],
) -> Result<DeviceCodeResponse, OAuthError> {
    let scope_str = if scopes.is_empty() {
        cfg.scope.clone()
    } else {
        scopes.join(" ")
    };
    let params = [
        ("client_id", cfg.client_id.as_str()),
        ("scope", scope_str.as_str()),
    ];
    let resp = reqwest::Client::new()
        .post(device_code_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| OAuthError::Transport(format!("github device-code POST: {}", e)))?;

    let status = resp.status();
    let body_text = resp.text()
        .await
        .map_err(|e| OAuthError::Transport(format!("github device-code read: {}", e)))?;

    if !status.is_success() {
        return Err(OAuthError::ProviderError(format!("github device-code HTTP {}: {}", status, body_text)));
    }

    serde_json::from_str(&body_text)
        .map_err(|e| OAuthError::Parse(format!("github device-code JSON: {} (body: {})", e, body_text)))
}

/// Poll the token endpoint until the user approves (or we exceed retry budget).
/// Honors the server's `slow_down` response by bumping the interval by 5s
/// per RFC 8628.
///
/// `max_polls` caps the loop so we don't poll forever on a stalled approval.
/// Caller should size this against the device-code `expires_in`.
pub async fn poll_device_flow(
    cfg: &OAuthConfig,
    device_code: &str,
    initial_interval_secs: u64,
    max_polls: u32,
) -> Result<OAuthToken, OAuthError> {
    let mut interval = initial_interval_secs.max(1);
    let mut polls = 0u32;
    let client = reqwest::Client::new();

    loop {
        if polls >= max_polls {
            return Err(OAuthError::ProviderError(format!("device-flow exceeded {} polls", max_polls)));
        }
        polls += 1;

        // Wait `interval` seconds BEFORE first poll too — the server says
        // "don't hit me faster than this".
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let params = [
            ("client_id", cfg.client_id.as_str()),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ];
        let resp = client
            .post(&cfg.token_url)
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await
            .map_err(|e| OAuthError::Transport(format!("github device poll POST: {}", e)))?;

        let status = resp.status();
        let body_text = resp.text()
            .await
            .map_err(|e| OAuthError::Transport(format!("github device poll read: {}", e)))?;

        // GitHub returns HTTP 200 with an `error` field for in-progress states
        // (authorization_pending, slow_down), so check the body before status.
        let parsed: GitHubTokenResponse = serde_json::from_str(&body_text)
            .map_err(|e| OAuthError::Parse(format!("github device poll JSON: {} (body: {})", e, body_text)))?;

        if let Some(err) = parsed.error.as_deref() {
            match err {
                "authorization_pending" => continue,
                "slow_down" => {
                    interval = interval.saturating_add(5);
                    continue;
                }
                other => return Err(OAuthError::ProviderError(other.to_string())),
            }
        }

        if !status.is_success() {
            return Err(OAuthError::ProviderError(format!("github device poll HTTP {}: {}", status, body_text)));
        }

        let access_token = parsed.access_token
            .ok_or_else(|| OAuthError::Parse("github device poll: no error and no access_token".into()))?;

        return Ok(OAuthToken {
            access_token,
            refresh_token: parsed.refresh_token.unwrap_or_default(),
            expires_at_unix: parsed.expires_in
                .map(|s| now_unix().saturating_add(s))
                .unwrap_or(0),
            scope: parsed.scope.unwrap_or_default(),
            token_type: parsed.token_type.unwrap_or_else(|| "bearer".to_string()),
        });
    }
}

#[derive(Debug, Deserialize)]
struct GitHubTokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_shape() {
        let cfg = default_config("cid-gh", "sec-gh");
        let url = build_auth_url(&cfg, "state-gh", "http://localhost:8765/gh-cb");
        assert!(url.starts_with("https://github.com/login/oauth/authorize?"));
        assert!(url.contains("client_id=cid-gh"));
        assert!(url.contains("state=state-gh"));
        // Space-separated GitHub scopes — spaces become %20.
        assert!(url.contains("scope=repo%20user%3Aemail%20gist"));
        assert!(url.contains("allow_signup=true"));
    }
}
