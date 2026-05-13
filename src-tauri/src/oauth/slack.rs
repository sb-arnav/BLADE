//! Phase 46 — HUNT-10 — Slack OAuth (URL builder, v2.0 stub).
//! Phase 50 — OAUTH-SLACK-FULL — Full implementation. Matches Gmail's surface
//! (build_auth_url / exchange_code_for_token / refresh_token), returning
//! `Result<OAuthToken, OAuthError>` for the typed-error variants.
//!
//! Endpoints (defaults — overridable via `OAuthConfig` for tests):
//!   - Auth URL:   https://slack.com/oauth/v2/authorize
//!   - Token URL:  https://slack.com/api/oauth.v2.access
//!
//! Slack scope model:
//!   - Bot scopes go in `scope` (comma-separated). User scopes go in
//!     `user_scope` (also comma-separated). v2.1 default is bot-only since
//!     BLADE's first-task surface is "post in channel / read messages on user's
//!     behalf via the bot".
//!
//! Default bot scopes (locked to Slack public scope inventory as of 2026-05-13):
//!   chat:write, channels:read, users:read, groups:read, im:read, mpim:read
//!
//! Response envelope quirk: Slack returns `{ "ok": true|false, ... }`. On
//! `ok=false` the response has shape `{ ok: false, error: "<code>" }` even
//! with HTTP 200, so we MUST parse `ok` before treating the response as a token.
//!
//! Refresh tokens: Slack OAuth v2 does NOT issue refresh tokens for standard
//! installations (token rotation is a separate opt-in feature behind the
//! "token rotation" workspace setting). We surface `NotSupported` rather than
//! silently no-op.

use super::{OAuthConfig, OAuthError, OAuthToken};
use serde::Deserialize;

pub const DEFAULT_AUTH_URL: &str = "https://slack.com/oauth/v2/authorize";
pub const DEFAULT_TOKEN_URL: &str = "https://slack.com/api/oauth.v2.access";
/// Default bot scopes — locked to Slack public scope inventory as of 2026-05-13.
/// Comma-separated per Slack's spec (unlike Google which uses space-separated).
pub const DEFAULT_BOT_SCOPE: &str =
    "chat:write,channels:read,users:read,groups:read,im:read,mpim:read";
/// Default user-scope set. Empty by default — opt-in per integration.
pub const DEFAULT_USER_SCOPE: &str = "";

pub fn default_config(client_id: &str, client_secret: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        auth_url: DEFAULT_AUTH_URL.to_string(),
        token_url: DEFAULT_TOKEN_URL.to_string(),
        scope: DEFAULT_BOT_SCOPE.to_string(),
    }
}

/// Build the Slack auth URL. The user opens this in their browser; Slack
/// redirects to `redirect_uri` with `?code=<auth_code>&state=<state>` after
/// they grant consent on the workspace install screen.
///
/// `user_scope` is Slack-specific. Pass `""` to skip user-token grant
/// (bot-token-only install — the common path for BLADE).
pub fn build_auth_url(
    cfg: &OAuthConfig,
    state: &str,
    redirect_uri: &str,
    user_scope: &str,
) -> String {
    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", cfg.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", cfg.scope.as_str()),
        ("state", state),
    ];
    if !user_scope.is_empty() {
        params.push(("user_scope", user_scope));
    }
    let encoded: Vec<String> = params.iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect();
    format!("{}?{}", cfg.auth_url, encoded.join("&"))
}

/// Exchange an auth code for a Slack token.
///
/// Slack envelope:
/// ```json
/// { "ok": true, "access_token": "xoxb-...", "scope": "...",
///   "token_type": "bot", "bot_user_id": "U...", "app_id": "A...",
///   "team": { "id": "T...", "name": "..." },
///   "authed_user": { "id": "U...", "scope": "...", "access_token": "xoxp-...", "token_type": "user" } }
/// ```
/// On `ok=false`, returns `OAuthError::ProviderError(error_code)`.
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
    // Slack accepts client credentials in either form body or Basic Auth.
    // Form body is simpler + matches Gmail's pattern.
    let body_text = reqwest::Client::new()
        .post(&cfg.token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| OAuthError::Transport(format!("slack token POST: {}", e)))?
        .text()
        .await
        .map_err(|e| OAuthError::Transport(format!("slack token read: {}", e)))?;

    let envelope: SlackTokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| OAuthError::Parse(format!("slack token JSON: {} (body: {})", e, body_text)))?;

    if !envelope.ok {
        let code = envelope.error.unwrap_or_else(|| "unknown_slack_error".to_string());
        return Err(OAuthError::ProviderError(code));
    }

    let access_token = envelope.access_token
        .ok_or_else(|| OAuthError::Parse("slack ok=true but missing access_token".into()))?;

    Ok(OAuthToken {
        access_token,
        // Standard Slack OAuth v2 does NOT return refresh tokens; we leave empty.
        // Token-rotation flow (opt-in) would set this; that's a v2.2+ surface.
        refresh_token: String::new(),
        // Slack standard installs are non-expiring (no expires_in field).
        expires_at_unix: envelope.expires_in
            .map(|s| now_unix().saturating_add(s))
            .unwrap_or(0),
        scope: envelope.scope.unwrap_or_default(),
        token_type: envelope.token_type.unwrap_or_else(|| "bot".to_string()),
    })
}

/// Slack OAuth v2 doesn't issue refresh tokens for standard installs.
/// Surface this explicitly so callers can route to a re-auth flow.
pub async fn refresh_token(
    _cfg: &OAuthConfig,
    _refresh_token: &str,
) -> Result<OAuthToken, OAuthError> {
    Err(OAuthError::NotSupported(
        "Slack OAuth v2 doesn't issue refresh tokens — re-auth required".to_string()
    ))
}

#[derive(Debug, Deserialize)]
struct SlackTokenResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
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
        let cfg = default_config("cid-slack", "secret-slack");
        let url = build_auth_url(&cfg, "s-tok", "http://localhost:8765/slack-cb", "search:read");
        assert!(url.starts_with("https://slack.com/oauth/v2/authorize?"));
        assert!(url.contains("client_id=cid-slack"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("user_scope=search%3Aread"));
        assert!(url.contains("state=s-tok"));
        // Comma-separated bot scopes, URL-encoded (`:` → `%3A`, `,` → `%2C`).
        assert!(url.contains("chat%3Awrite"));
        assert!(url.contains("channels%3Aread"));
    }

    #[test]
    fn auth_url_omits_user_scope_when_empty() {
        let cfg = default_config("cid", "sec");
        let url = build_auth_url(&cfg, "s", "http://localhost:8765/cb", "");
        assert!(!url.contains("user_scope="));
    }
}
