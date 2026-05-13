//! Phase 46 — HUNT-10 — GitHub OAuth (STUB).
//!
//! URL builder only for v2.0 per V2-AUTONOMOUS-HANDOFF.md §1. Full token
//! exchange lands in v2.1 when the first GitHub-driven hunt or first-task
//! use case appears.
//!
//! GitHub OAuth notes (preserved for v2.1 implementer):
//!   - Auth URL:  https://github.com/login/oauth/authorize
//!   - Token URL: https://github.com/login/oauth/access_token (needs `Accept: application/json`)
//!   - Response: `access_token`, `scope`, `token_type`. NO expires_in by default
//!     for classic OAuth apps; expiring tokens are opt-in per-app setting.
//!   - GitHub Apps (different OAuth flow) return refresh_token + expires_in.

use super::OAuthConfig;

pub const DEFAULT_AUTH_URL: &str = "https://github.com/login/oauth/authorize";
pub const DEFAULT_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
pub const DEFAULT_SCOPE: &str = "repo read:user user:email";

pub fn default_config(client_id: &str, client_secret: &str) -> OAuthConfig {
    OAuthConfig {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        auth_url: DEFAULT_AUTH_URL.to_string(),
        token_url: DEFAULT_TOKEN_URL.to_string(),
        scope: DEFAULT_SCOPE.to_string(),
    }
}

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

// TODO(v2.1): exchange_code_for_token. GitHub requires
// `Accept: application/json` header to receive JSON (defaults to form-encoded
// response otherwise — a frequent first-implementer trap).

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
        // Scopes URL-encoded — spaces become %20.
        assert!(url.contains("scope=repo%20read%3Auser%20user%3Aemail"));
        assert!(url.contains("allow_signup=true"));
    }
}
