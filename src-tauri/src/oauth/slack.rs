//! Phase 46 — HUNT-10 — Slack OAuth (STUB).
//!
//! URL builder + signature only for v2.0 per V2-AUTONOMOUS-HANDOFF.md §1.
//! Full code-for-token exchange + bot/user token separation lands in v2.1
//! when the first Slack-driven hunt or first-task use case appears.
//!
//! Slack OAuth notes (preserved for v2.1 implementer):
//!   - Auth URL:  https://slack.com/oauth/v2/authorize
//!   - Token URL: https://slack.com/api/oauth.v2.access
//!   - Scopes split into `scope` (bot) + `user_scope` (user). v2.1 will need both.
//!   - Response is wrapped in `{ ok: bool, ... }` — must check `ok` before deserializing.

use super::OAuthConfig;

pub const DEFAULT_AUTH_URL: &str = "https://slack.com/oauth/v2/authorize";
pub const DEFAULT_TOKEN_URL: &str = "https://slack.com/api/oauth.v2.access";
pub const DEFAULT_BOT_SCOPE: &str = "chat:write,users:read,channels:read";
pub const DEFAULT_USER_SCOPE: &str = "search:read";

pub fn default_config(client_id: &str, client_secret: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        auth_url: DEFAULT_AUTH_URL.to_string(),
        token_url: DEFAULT_TOKEN_URL.to_string(),
        scope: DEFAULT_BOT_SCOPE.to_string(),
    }
}

/// Build the Slack auth URL. The `user_scope` parameter is Slack-specific —
/// pass an empty string to skip user-token grant.
pub fn build_auth_url(
    cfg: &OAuthConfig,
    state: &str,
    redirect_uri: &str,
    user_scope: &str,
) -> String {
    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", cfg.client_id.as_str()),
        ("redirect_uri", redirect_uri),
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

// TODO(v2.1): exchange_code_for_token + refresh_token. Slack v2 returns
// { ok: bool, access_token, scope, bot_user_id, app_id, team, authed_user, ... }.
// Bot tokens (xoxb-) and user tokens (xoxp-) need separate storage.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_url_shape() {
        let cfg = default_config("cid-slack", "secret-slack");
        let url = build_auth_url(&cfg, "s-tok", "http://localhost:8765/slack-cb", "search:read");
        assert!(url.starts_with("https://slack.com/oauth/v2/authorize?"));
        assert!(url.contains("client_id=cid-slack"));
        assert!(url.contains("scope=chat%3Awrite%2Cusers%3Aread%2Cchannels%3Aread"));
        assert!(url.contains("user_scope=search%3Aread"));
        assert!(url.contains("state=s-tok"));
    }

    #[test]
    fn auth_url_omits_user_scope_when_empty() {
        let cfg = default_config("cid", "sec");
        let url = build_auth_url(&cfg, "s", "http://localhost:8765/cb", "");
        assert!(!url.contains("user_scope="));
    }
}
