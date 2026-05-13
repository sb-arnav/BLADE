# Phase 50 — OAuth Coverage

**Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Status:** Pending
**Requirements:** OAUTH-SLACK-FULL, OAUTH-GITHUB-FULL, OAUTH-TESTS
**Goal:** Promote Slack + GitHub OAuth stubs to full implementations matching Gmail's shape from v2.0.

## Reference: v2.0 Gmail OAuth implementation

`src-tauri/src/oauth/gmail.rs` is the reference shape. It exposes:
- `build_auth_url(state: &str) -> String` — assembles the Google OAuth consent URL with the right scopes, redirect URI, response_type=code.
- `exchange_code_for_token(code: &str, code_verifier: Option<&str>) -> Result<Token, OAuthError>` — POST to token endpoint with the authorization code.
- `refresh_token(refresh_token: &str) -> Result<Token, OAuthError>` — POST to refresh endpoint.
- Preserves caller refresh_token when the provider omits one in the response.

Test reference at `src-tauri/tests/oauth_gmail_integration.rs` — 3 tests against localhost mock TCP server.

## Approach

### OAUTH-SLACK-FULL

In `src-tauri/src/oauth/slack.rs`:
- Remove the stub. Add full implementation matching Gmail's shape.
- Endpoints: auth URL = `https://slack.com/oauth/v2/authorize`, token = `https://slack.com/api/oauth.v2.access`.
- Scopes (for BLADE's read+write needs): `chat:write` + `channels:read` + `users:read` + `groups:read` + `im:read` + `mpim:read`. Default scope set documented in the function.
- Slack returns tokens in a non-RFC envelope: `{ "ok": true, "access_token": "...", "team": {...}, "authed_user": {...} }`. Parse accordingly.
- No refresh tokens for Slack standard OAuth v2 — surface this in `refresh_token()` as `Err(OAuthError::NotSupported("Slack OAuth v2 doesn't issue refresh tokens — re-auth required"))`.

### OAUTH-GITHUB-FULL

In `src-tauri/src/oauth/github.rs`:
- Remove the stub. Full implementation.
- Endpoints: auth URL = `https://github.com/login/oauth/authorize`, token = `https://github.com/login/oauth/access_token`.
- Scopes: `repo` (read-only via `read:repo` scope if we want minimal; standard `repo` includes write too — pick read-only) + `user:email` + `gist`. Document scope tradeoffs.
- Headers: `Accept: application/json` on token exchange to get JSON instead of URL-encoded.
- Device-code fallback for headless installs: implement `start_device_flow() -> DeviceCodeResponse` + `poll_device_flow(device_code, interval) -> Result<Token, OAuthError>`. Surface to caller as separate fn for the headless path.

### OAUTH-TESTS

Two new integration test files matching `oauth_gmail_integration.rs` shape:

`src-tauri/tests/oauth_slack_integration.rs` — 3 tests:
1. `auth_url_shape` — verify URL contains client_id, redirect_uri, scope (comma-separated for Slack), state, response_type
2. `code_exchange_parses_token` — mock localhost server returns Slack-shape envelope; verify token extracted
3. `slack_no_refresh_token_surfaces_error` — verify `refresh_token` returns `Err(NotSupported)`

`src-tauri/tests/oauth_github_integration.rs` — 3 tests:
1. `auth_url_shape` — verify URL contains correct scopes (space-separated for GitHub), state
2. `code_exchange_with_accept_header_returns_json` — mock localhost server expects Accept: application/json
3. `device_flow_polling` — mock device-code start + poll (returns slow_down once, then approves)

Use `mockito` or `wiremock` (whichever Gmail tests used) for the mock TCP servers.

## Risks

1. **Slack scope changes** — Slack OAuth scope inventory evolves. Lock to the current public list as of 2026-05-13.
2. **GitHub device-flow polling** — the spec requires honoring the `interval` value the server returns. Don't poll faster than that.
3. **Mock server port collisions** — Gmail tests already use a port. Slack + GitHub tests need different ports (or `serial_test::serial` to force serialization).

## Success criteria

- [ ] `src-tauri/src/oauth/slack.rs` full impl (no `TODO(v2.1)` stubs)
- [ ] `src-tauri/src/oauth/github.rs` full impl (no `TODO(v2.1)` stubs)
- [ ] `src-tauri/tests/oauth_slack_integration.rs` — 3 tests pass
- [ ] `src-tauri/tests/oauth_github_integration.rs` — 3 tests pass
- [ ] No real-account auth at build time per V2-AUTONOMOUS-HANDOFF.md §1
- [ ] cargo check + tsc clean; verify:all ≥36/38
