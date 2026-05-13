//! Phase 46 — HUNT-10 — OAuth scaffolds.
//! Phase 50 — OAUTH-COVERAGE — Slack + GitHub promoted from stubs to full impls.
//!
//! Per `.planning/V2-AUTONOMOUS-HANDOFF.md` §1: BLADE is a product, not a tool
//! for Arnav. Real "click Allow on Google's screen" happens on each end-user's
//! first run on their machine. Build-time correctness is the URL/token logic
//! against a localhost mock OAuth server; we do NOT authenticate against real
//! Arnav-account services.
//!
//! Scope:
//!   - `gmail` (v2.0 PRIMARY) — full impl + integration test against mock server.
//!     Surface returns `Result<OAuthToken, String>` for backward compatibility
//!     with v2.0 callers.
//!   - `slack`, `github` (v2.1) — full impl, integration-tested. Returns
//!     `Result<OAuthToken, OAuthError>` for richer error context (rate limit,
//!     provider-specific error code, not-supported flows).
//!
//! Public contract per provider:
//!   - `fn build_auth_url(cfg, state, redirect_uri, ...) -> String`
//!   - `async fn exchange_code_for_token(cfg, code, redirect_uri, ...) -> Result<OAuthToken, _>`
//!   - `async fn refresh_token(cfg, refresh_token) -> Result<OAuthToken, _>`
//!
//! `OAuthToken` is the canonical shared shape so call-sites don't care which
//! provider returned it. Provider-specific extras (Slack team_id, authed_user,
//! GitHub device-code flow) are exposed via provider-typed return values.

pub mod gmail;
pub mod slack;
pub mod github;

use serde::{Deserialize, Serialize};
use std::fmt;

/// Canonical OAuth token shape across providers. Each provider's adapter maps
/// its raw JSON response into this struct.
///
/// `expires_at_unix` is normalized — Google returns `expires_in` (seconds from
/// now) and we add the wall-clock to get an absolute timestamp; that makes the
/// token storable + comparable across sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    /// The bearer token to send as `Authorization: Bearer <access_token>`.
    pub access_token: String,
    /// Refresh token. Empty string when not present (some providers only
    /// return refresh on the first authorization).
    pub refresh_token: String,
    /// Absolute UNIX seconds when `access_token` expires. 0 when unknown.
    pub expires_at_unix: u64,
    /// Granted scopes (space-separated), as returned by the provider.
    pub scope: String,
    /// Token type — typically "Bearer".
    pub token_type: String,
}

impl OAuthToken {
    /// Returns true if the token has expired or is within 60s of expiring.
    /// Callers should refresh before this returns true.
    pub fn is_near_expiry(&self, now_unix: u64) -> bool {
        if self.expires_at_unix == 0 { return false; }
        self.expires_at_unix <= now_unix + 60
    }
}

/// OAuth client configuration. Held per provider; passed into the auth-URL
/// builder + token-exchange functions so tests can override the auth/token
/// endpoint URLs to point at a localhost mock server.
#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    /// Auth-URL host base (e.g. `https://accounts.google.com/o/oauth2/v2/auth`).
    /// Tests inject `http://127.0.0.1:<port>/auth`.
    pub auth_url: String,
    /// Token-endpoint URL. Tests inject `http://127.0.0.1:<port>/token`.
    pub token_url: String,
    /// Space-separated (Google, GitHub) or comma-separated (Slack) scope list.
    /// Provider-specific.
    pub scope: String,
}

/// Phase 50 — typed OAuth error surface used by Slack + GitHub adapters.
/// Gmail (v2.0) still returns `String` for backward compatibility; new
/// provider adapters use this richer form so callers can pattern-match on
/// "provider said X" vs "transport failed" vs "this flow isn't supported".
#[derive(Debug, Clone)]
pub enum OAuthError {
    /// Network / transport failure (DNS, TCP, TLS, timeout).
    Transport(String),
    /// Provider returned an HTTP non-2xx OR a `{ ok: false, error: "..." }` envelope.
    /// The string is the provider's reported error code (e.g. Slack `invalid_code`,
    /// GitHub `bad_verification_code`).
    ProviderError(String),
    /// Response body failed to parse as JSON / didn't match expected shape.
    Parse(String),
    /// This flow isn't supported by the provider (e.g. Slack OAuth v2 doesn't
    /// issue refresh tokens). Caller must take a different path (re-auth, etc.).
    NotSupported(String),
    /// Device-flow specific: user hasn't approved yet, poll again after `interval`.
    AuthorizationPending,
    /// Device-flow specific: server asked us to back off — increase poll interval.
    SlowDown,
}

impl fmt::Display for OAuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OAuthError::Transport(e) => write!(f, "oauth transport: {}", e),
            OAuthError::ProviderError(e) => write!(f, "oauth provider error: {}", e),
            OAuthError::Parse(e) => write!(f, "oauth parse: {}", e),
            OAuthError::NotSupported(e) => write!(f, "oauth not supported: {}", e),
            OAuthError::AuthorizationPending => write!(f, "oauth authorization_pending"),
            OAuthError::SlowDown => write!(f, "oauth slow_down"),
        }
    }
}

impl std::error::Error for OAuthError {}

impl From<OAuthError> for String {
    fn from(e: OAuthError) -> String {
        e.to_string()
    }
}
