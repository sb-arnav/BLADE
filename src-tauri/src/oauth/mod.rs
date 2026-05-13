//! Phase 46 — HUNT-10 — OAuth scaffolds.
//!
//! Per `.planning/V2-AUTONOMOUS-HANDOFF.md` §1: BLADE is a product, not a tool
//! for Arnav. Real "click Allow on Google's screen" happens on each end-user's
//! first run on their machine. Build-time correctness is the URL/token logic
//! against a localhost mock OAuth server; we do NOT authenticate against real
//! Arnav-account services.
//!
//! Scope for v2.0:
//!   - `gmail` (PRIMARY) — full impl + integration test against mock server.
//!   - `slack`, `github` (STUBS) — URL builders only. Full token-exchange
//!      bodies land in v2.1.
//!
//! Public contract per provider:
//!   - `fn build_auth_url(state: &str, redirect_uri: &str) -> String`
//!   - `async fn exchange_code_for_token(code, redirect_uri, ...) -> Result<Token>`
//!   - `async fn refresh_token(refresh_token, ...) -> Result<Token>` (gmail only for v2.0)
//!
//! `Token` is the canonical shared shape so call-sites don't care which provider
//! returned it.

pub mod gmail;
pub mod slack;
pub mod github;

use serde::{Deserialize, Serialize};

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
    /// Space-separated scope list. Provider-specific.
    pub scope: String,
}
