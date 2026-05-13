# Phase 50 — OAuth Coverage — SUMMARY

**Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Status:** Complete
**Date:** 2026-05-13

## What shipped per REQ-ID

### OAUTH-SLACK-FULL — `a6642bd`

Slack OAuth v2 promoted from URL-builder stub to full implementation.

- `build_auth_url(cfg, state, redirect_uri, user_scope) -> String` — adds
  `response_type=code` (was missing in stub) so the URL matches Gmail's shape.
  Comma-separated bot scopes (Slack-specific), optional `user_scope` param.
- `exchange_code_for_token(cfg, code, redirect_uri) -> Result<OAuthToken, OAuthError>`
  — POSTs form-encoded params to `oauth.v2.access`, parses Slack's `{ok, ...}`
  envelope. `ok=false` routes to `OAuthError::ProviderError(error_code)`.
- `refresh_token(cfg, _) -> Result<OAuthToken, OAuthError>` — returns
  `OAuthError::NotSupported` (Slack OAuth v2 doesn't issue refresh tokens
  for standard installs; token-rotation is opt-in v2.2+ territory).
- Default bot scopes locked to 2026-05-13 public scope inventory:
  `chat:write,channels:read,users:read,groups:read,im:read,mpim:read`.

### OAUTH-GITHUB-FULL — `f8f462b`

GitHub OAuth promoted from URL-builder stub to full implementation
including RFC 8628 device-code flow for headless installs.

- `build_auth_url(cfg, state, redirect_uri) -> String` — space-separated
  scopes, `allow_signup=true`.
- `exchange_code_for_token(cfg, code, redirect_uri) -> Result<OAuthToken, OAuthError>`
  — sends `Accept: application/json` so GitHub returns JSON instead of
  URL-encoded body (the classic first-implementer trap).
- `refresh_token(cfg, refresh_token) -> Result<OAuthToken, OAuthError>` —
  returns `NotSupported` when caller has empty refresh_token (classic OAuth
  apps without rotation). When present, runs the refresh and preserves the
  caller's token if the server omits a new one (matches Gmail behavior).
- `start_device_flow(cfg, device_code_url, scopes)` → `DeviceCodeResponse`
  with `user_code` + `verification_uri` (display to user) + `device_code`.
- `poll_device_flow(cfg, device_code, interval, max_polls)` — sleeps
  `interval` before each request, handles `authorization_pending` (continue),
  `slow_down` (bump interval by 5s per RFC 8628), `max_polls` caps the loop.
- Default scopes: `repo user:email gist`. Tradeoff documented in-code:
  switch `repo` → `public_repo` if the install should be read-only on
  private repos.

### OAUTH-TESTS — `9563457`

7 new integration tests, all against localhost mock TCP servers
(hand-rolled — matches the Gmail-test pattern, no new test crate deps).

`src-tauri/tests/oauth_slack_integration.rs` (4 tests):
1. `slack_auth_url_shape` — comma-separated bot scopes, state, response_type=code.
2. `slack_code_exchange_parses_token` — `{ok: true, access_token, team, authed_user}`
   envelope parses; token mapped correctly.
3. `slack_ok_false_surfaces_provider_error` — bonus test: HTTP 200 with
   `{ok: false, error: "invalid_code"}` maps to `ProviderError(code)`.
4. `slack_no_refresh_token_surfaces_error` — refresh returns `NotSupported`.

`src-tauri/tests/oauth_github_integration.rs` (3 tests):
1. `github_auth_url_shape` — space-separated scopes `repo user:email gist`,
   `allow_signup=true`, state.
2. `github_code_exchange_with_accept_header` — asserts the `Accept: application/json`
   header was on the wire AND the JSON response parses.
3. `github_device_flow_polling` — sequenced mock: device-code start →
   token endpoint returns `slow_down` on poll 1 (interval bumps from 1s
   to 6s) → success on poll 2. Asserts elapsed ≥6s and the RFC 8628
   `urn:ietf:params:oauth:grant-type:device_code` grant_type is used.

The sequenced-response variant (`SeqMockServer`) is in
`oauth_github_integration.rs` for the device-flow test; standard
single-response `MockServer` (per Gmail's pattern) suffices for the rest.

## Files touched

- `src-tauri/src/oauth/mod.rs` — added `OAuthError` enum (Transport/ProviderError/
  Parse/NotSupported/AuthorizationPending/SlowDown) with Display + Error impls.
- `src-tauri/src/oauth/slack.rs` — full impl (replaced stub).
- `src-tauri/src/oauth/github.rs` — full impl + device-code flow (replaced stub).
- `src-tauri/tests/oauth_slack_integration.rs` — new (4 tests).
- `src-tauri/tests/oauth_github_integration.rs` — new (3 tests).
- `.planning/phases/50-oauth-coverage/50-SUMMARY.md` — this file.

## Test counts

| Provider | File | Tests | Status |
|---|---|---|---|
| Gmail (v2.0 regression) | `oauth_gmail_integration.rs` | 3 | green |
| Slack | `oauth_slack_integration.rs` | 4 | green |
| GitHub | `oauth_github_integration.rs` | 3 | green |
| **Total OAuth integration** | | **10** | **green** |

Plus the existing per-module `#[cfg(test)]` unit tests in each provider
file (auth-URL shape sanity).

## Static gates

- `cargo check` — clean (3 pre-existing warnings unrelated to phase 50:
  `post_briefing`, `log_briefing`, `parse_owner_repo` dead-code).
- `npx tsc --noEmit` — clean (phase 50 is Rust-only).
- 10/10 OAuth integration tests pass.

## Commit SHAs

| Commit | SHA | Description |
|---|---|---|
| 1 | `a6642bd` | OAUTH-SLACK-FULL — full Slack OAuth v2 implementation |
| 2 | `f8f462b` | OAUTH-GITHUB-FULL — full GitHub OAuth + device-code flow |
| 3 | `9563457` | OAUTH-TESTS — slack + github integration tests |
| 4 | (this) | docs(50) SUMMARY |

## Notable deviations

**Error-type asymmetry across providers.** Gmail (v2.0, shipped) returns
`Result<OAuthToken, String>`; the new Slack + GitHub adapters return
`Result<OAuthToken, OAuthError>` with a typed error enum
(`ProviderError`/`NotSupported`/`Transport`/`Parse`/`AuthorizationPending`/`SlowDown`).
Strict callers-are-interchangeable would require migrating Gmail to the
typed error too — deferred to a follow-up because:
1. Gmail already has callers (`tentacles/gmail_outbound.rs`) that consume
   `String` errors.
2. `OAuthError: Display + Into<String>` so the typed variants degrade
   gracefully to the same caller surface where needed.
3. The richer error model on Slack + GitHub buys real ergonomics (the
   device-flow polling logic *needs* `slow_down` / `authorization_pending`
   variants — flattening them to `String` would lose the contract).

Migration plan: when Gmail adds a refresh-failure path that callers want
to match on, promote Gmail to `OAuthError` at the same time.

**Bonus Slack test.** Added `slack_ok_false_surfaces_provider_error` (4
instead of 3) because Slack's `{ok: false}` HTTP-200 envelope is the
single most surprising thing about its OAuth and deserves an explicit
regression guard.

## Carry-forward

- **OEVAL-01c carry-forward.** Per V2-AUTONOMOUS-HANDOFF.md, `verify:all`
  may report ≤2 carry-forwards from prior phases. Phase 50 doesn't change
  the runtime UI surface — no UAT needed beyond the test grid above.
- **Slack token rotation (v2.2 candidate).** If a user opts into Slack's
  token-rotation workspace setting, Slack DOES issue refresh tokens with
  expiring access tokens. Wiring that path means replacing
  `NotSupported` with a real refresh implementation guarded by the
  caller's stored refresh_token. Out of scope here.
- **Slack user-scope grant.** Current Slack impl supports `user_scope`
  in the auth URL but only surfaces the bot access_token on exchange.
  When the first BLADE feature needs the `xoxp-` user token (e.g.
  search:read on user's behalf), parse `authed_user.access_token` from
  the envelope into a separate return value.
- **Gmail error-type migration.** See "Notable deviations" above.
- **Pre-existing dead-code warnings** in `discord.rs`, `obsidian.rs`,
  `hive.rs` — not phase 50 surface area, leave as-is.
