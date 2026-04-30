---
phase: 18-jarvis-ptt-cross-app
plan: 08
subsystem: tentacles
tags: [tentacles, rust, gmail, oauth, mcp, base64url, rfc2822]

# Dependency graph
requires:
  - phase: 18
    provides: "gmail_outbound skeleton (Plan 03), assert_observe_only_allowed gate (Plan 02), WriteScope RAII (ecosystem.rs)"
provides:
  - "gmail_outbound::send full body — MCP-first dispatch + Gmail API HTTP fallback"
  - "RFC2822 → base64url URL_SAFE_NO_PAD encoding for users.messages.send raw field"
  - "401 → Reconnect Gmail routing (token-expiry handling without silent retry)"
  - "D-10 hard-fail wording lock for Gmail (no creds + no MCP)"
affects: ["18-09 (calendar_outbound — same OAuth/MCP-first pattern)", "18-14 (dispatcher routes service:gmail here)", "18-12 (cold-install demo — Gmail listed but Linear/Slack preferred for OAuth fragility)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP-first → HTTP-fallback → hard-fail dispatch (mirrors slack_outbound)"
    - "base64url URL_SAFE_NO_PAD encoding for Gmail API raw field"
    - "RFC2822 message construction with CRLF separators + From: me Gmail-special token"
    - "401 explicit reconnect routing (defer OAuth refresh to v1.3)"

key-files:
  created: []
  modified:
    - "src-tauri/src/tentacles/gmail_outbound.rs (replaced 41-line skeleton with 384-line body + 12 tests)"

key-decisions:
  - "Use base64 0.22 URL_SAFE_NO_PAD engine (already in Cargo.toml; URL_SAFE_NO_PAD was not yet used but the crate supports it natively)"
  - "Mirror slack_outbound dispatch pattern (SharedMcpManager via AppHandle) instead of plan-spec'd `mcp::manager()` — the latter does not exist in the codebase"
  - "Three MCP candidate qualified names: mcp__gmail_send_message, mcp__gmail_messages.send, mcp__gmail_send (runtime-validate per RESEARCH § Watch Out)"
  - "Defer OAuth refresh-token rotation to v1.3 — 401 responses route the user to Integrations tab"
  - "parse_gmail_response handles both error envelope shapes: { error: \"string\" } (MCP wrappers) and { error: { message: \"...\" } } (Gmail REST)"

patterns-established:
  - "Tentacle outbound dispatch shape (slack/github/gmail share the same 3-tier flow): assert gate → try MCP → try HTTP → D-10 hard-fail"
  - "base64url URL_SAFE_NO_PAD usage in BLADE — first introduction; future tentacles needing URL-safe encoding can follow this import"
  - "Gmail API auto-replaces \"From: me\" — no impersonation surface (T-18-CARRY-24 mitigation)"

requirements-completed: [JARVIS-04]

# Metrics
duration: ~14 min (file rewrite + cargo check 3m + cargo test 8m)
completed: 2026-04-30
---

# Phase 18 Plan 08: gmail_outbound — users.messages.send + base64url MIME Summary

**Gmail send write path lands with MCP-first dispatch, Gmail API HTTP fallback, RFC2822 message base64url-encoded via URL_SAFE_NO_PAD, and 401 → Reconnect Gmail routing.**

## Performance

- **Duration:** ~14 min (most of which was cargo check 3m + cargo test 8m on a cold target dir)
- **Started:** 2026-04-30T17:38Z (approx — first Read of plan)
- **Completed:** 2026-04-30T17:53Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- gmail_outbound.rs Plan 03 skeleton (41 lines, 1 placeholder test) replaced with production body (384 lines, 12 unit tests)
- Three-tier dispatch hierarchy implemented: MCP candidates → Gmail REST `users.messages.send` HTTP → D-10 hard-fail
- RFC2822 message construction with `From: me`, To, Subject, Content-Type headers and CRLF body separator; encoded via `base64::engine::general_purpose::URL_SAFE_NO_PAD`
- 401 routing locks the wording "Gmail token expired — Reconnect Gmail via Integrations tab" (OAuth refresh deferred to v1.3 per RESEARCH § Watch Out)
- D-10 hard-fail wording lock: "Connect via Integrations tab → Gmail (no OAuth token in keyring or MCP server registered)"
- `assert_observe_only_allowed("gmail", "send_message")` gate at top (defense-in-depth; Plan 14 holds the actual WriteScope)

## Dispatch Hierarchy

```
gmail_outbound_send(to, subject, body)
├─ assert_observe_only_allowed("gmail", "send_message")?   // gate
├─ try_mcp_path                                              // Tier 1
│   ├─ gmail_mcp_registered() — short-circuit on no-server
│   ├─ AppHandle → SharedMcpManager → lock
│   └─ candidates: mcp__gmail_send_message,
│                  mcp__gmail_messages.send,
│                  mcp__gmail_send
├─ gmail_token() — read keyring("gmail")
├─ if token.is_empty() → D-10 hard-fail
└─ try_http_path                                             // Tier 2
    ├─ build_raw_message → RFC2822 → URL_SAFE_NO_PAD.encode
    ├─ POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
    │   Authorization: Bearer {oauth_access_token}
    │   Content-Type: application/json
    │   body: { "raw": "<base64url>" }
    └─ status == 401 → "Reconnect Gmail via Integrations tab"
       status != 2xx → "{status} from Gmail: {error.message}"
       status == 2xx → SendResult { id, thread_id }
```

## RFC2822 Format

```
From: me\r\nTo: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{body}
```

- `From: me` — Gmail special token; the API auto-replaces with the authenticated user's email (T-18-CARRY-24 mitigation, cannot impersonate other users)
- CRLF line endings per RFC2822
- Blank `\r\n\r\n` separates headers from body (verified by test `rfc2822_format_includes_required_headers`)

## base64url Encoding

- Engine: `base64::engine::general_purpose::URL_SAFE_NO_PAD`
- Crate: `base64 = "0.22"` (already in Cargo.toml)
- Test `base64url_no_padding_or_unsafe_chars` asserts no `=`, no `+`, no `/` in encoded output (Gmail API rejects standard-base64 input with 400)
- Unicode round-trip verified by `build_raw_message_handles_unicode_subject_and_body` (Café meeting + emoji body)

## Wording Locks

| Path | Message |
|------|---------|
| D-10 hard-fail | `[gmail_outbound] Connect via Integrations tab → Gmail (no OAuth token in keyring or MCP server registered).` |
| 401 token expired | `[gmail_outbound] Gmail token expired — Reconnect Gmail via Integrations tab.` |
| Other HTTP error | `[gmail_outbound] {status} from Gmail: {error.message}` |
| MCP failure | `[gmail_outbound] MCP call failed: {safe_slice(err, 200)}` |

## Tests (12 green)

| # | Test | What it verifies |
|---|------|------------------|
| 1 | `hard_fail_message_format_d10_compliant` | D-10 wording lock contains exact "Connect via Integrations tab → Gmail" |
| 2 | `token_expiry_message_routes_to_reconnect` | 401 path message contains "Reconnect Gmail via Integrations tab" |
| 3 | `rfc2822_format_includes_required_headers` | base64url decodes to RFC2822 with all 4 headers + CRLF separator + body |
| 4 | `base64url_no_padding_or_unsafe_chars` | Encoded output has no `=`, `+`, or `/` chars |
| 5 | `gmail_token_helper_does_not_panic` | Keyring read smoke |
| 6 | `gmail_mcp_registered_smoke` | load_config + iter smoke |
| 7 | `parse_gmail_response_extracts_id_and_thread_id` | Happy path: { id, threadId } parses correctly |
| 8 | `parse_gmail_response_accepts_snake_case_thread_id` | MCP wrappers using thread_id (snake_case) parse correctly |
| 9 | `parse_gmail_response_surfaces_api_error_string` | { error: "..." } envelope → Err |
| 10 | `parse_gmail_response_surfaces_api_error_object` | Gmail REST { error: { message } } envelope → Err |
| 11 | `parse_gmail_response_handles_garbage_json` | Invalid JSON → Err with "response parse failed" |
| 12 | `build_raw_message_handles_unicode_subject_and_body` | Café meeting + emoji body round-trips through base64url |

`cargo test --lib gmail_outbound -- --nocapture` → 12 passed; 0 failed; 0 ignored

## Task Commits

1. **Task 1: gmail_outbound full body + 12 tests** — `717cbc0` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src-tauri/src/tentacles/gmail_outbound.rs` — replaced Plan 03 skeleton (41 lines, 1 placeholder test) with full body + 12 unit tests (384 lines)

## Decisions Made

1. **Mirrored slack_outbound's MCP dispatch shape (SharedMcpManager via AppHandle), not the plan's spec'd `crate::mcp::manager().has_tool()` API.** The plan's pseudocode referenced helpers that don't exist in this codebase — `mcp.rs` exposes `McpManager::call_tool` (instance method on a `SharedMcpManager = Arc<Mutex<McpManager>>`), not a standalone `manager()` global with a `has_tool` method. The slack_outbound pattern is the proven, in-tree way to call MCP tools from a tentacle.
2. **Three MCP candidate names instead of two.** Added `mcp__gmail_send` as a third terse variant alongside the two from the plan, since RESEARCH § gmail_outbound.rs flagged the qualified-name convention as runtime-validate and a third common shape costs nothing.
3. **parse_gmail_response handles both error envelope shapes.** MCP wrappers tend to emit `{ error: "string" }`; Gmail REST emits `{ error: { code, message } }`. Single helper handles both via `or_else` chain.
4. **Defer-then-route on token expiry.** Per RESEARCH and Plan must-haves, 401 does NOT silently call a refresh-token endpoint — it surfaces a Reconnect Gmail message. OAuth refresh is v1.3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Replaced plan's `crate::mcp::manager()` API with the in-tree `SharedMcpManager` pattern**
- **Found during:** Task 1 (initial implementation)
- **Issue:** The plan's `<action>` block references `crate::mcp::manager().has_tool(tool).await` and a standalone `manager.call_tool(tool, args)`. Neither exists. `mcp.rs` exposes `McpManager::call_tool` as an instance method on the manager, accessed via the Tauri-state-injected `SharedMcpManager = Arc<Mutex<McpManager>>`. There is no global `manager()` function and no `has_tool` method.
- **Fix:** Used the slack_outbound.rs pattern verbatim — `crate::integration_bridge::get_app_handle()` → `handle.try_state::<crate::commands::SharedMcpManager>()` → `.lock().await` → `manager.call_tool(qualified_name, args).await`. Tool-name resolution is discriminated by `Err(e) if e.starts_with("Unknown tool:")` (continue to next candidate) vs other Err (surface real failure). Tool-server registration check via `gmail_mcp_registered()` short-circuits before paying the lock cost.
- **Files modified:** `src-tauri/src/tentacles/gmail_outbound.rs`
- **Verification:** `cargo check` clean; 12/12 tests pass; integration with `SharedMcpManager` matches the proven slack/github pattern.
- **Committed in:** `717cbc0`

**2. [Rule 2 — Missing critical] Added `parse_gmail_response` helper covering MCP-string + REST-object error envelopes**
- **Found during:** Task 1 (action-block code review against slack_outbound analog)
- **Issue:** The plan's action-block code passed `result.get("id")` directly on the MCP response without surfacing error envelopes — meaning a Gmail MCP wrapper that returns `{"error": "invalid_grant"}` would silently produce `SendResult { id: "", thread_id: "" }`. That's a correctness flaw: the user would see "sent" with empty ids when nothing actually sent.
- **Fix:** Extracted a `parse_gmail_response` helper used by BOTH the MCP path and (by intent) the HTTP path's success branch. It detects `{ error: "..." }` (string) and `{ error: { message: "..." } }` (Gmail REST) and surfaces them as `Err`. Two new tests cover both shapes.
- **Files modified:** `src-tauri/src/tentacles/gmail_outbound.rs`
- **Verification:** Tests `parse_gmail_response_surfaces_api_error_string` and `parse_gmail_response_surfaces_api_error_object` both green.
- **Committed in:** `717cbc0`

**3. [Rule 2 — Missing critical] Wrapped MCP error message in `safe_slice(&e, 200)`**
- **Found during:** Task 1 (CLAUDE.md non-ASCII safety review)
- **Issue:** Plan's action-block surfaced raw `format!("[gmail_outbound] MCP call failed: {e}")` — if the underlying MCP error contains non-ASCII content longer than expected, downstream loggers/UI could choke. CLAUDE.md mandates `safe_slice` on user-content surfaces.
- **Fix:** All error-message construction routes through `crate::safe_slice(&e, 200)` (matches slack_outbound + github_outbound).
- **Files modified:** `src-tauri/src/tentacles/gmail_outbound.rs`
- **Verification:** `cargo check` clean; matches established pattern across sibling tentacles.
- **Committed in:** `717cbc0`

**4. [Rule 2 — Missing critical] Surfaced HTTP non-2xx (non-401) errors with status + Gmail's error.message**
- **Found during:** Task 1 (response-handling review)
- **Issue:** Plan's HTTP path only special-cased 401. Other non-2xx (400 from bad encoding, 403 from missing scope, 429 rate-limit) would still produce a `SendResult` from the success branch reading `id`/`threadId` off an error envelope — same silent-success flaw as Deviation 2.
- **Fix:** After the 401 short-circuit, check `!status.is_success()` and surface `[gmail_outbound] {status} from Gmail: {error.message}` (mirrors github_outbound's pattern).
- **Files modified:** `src-tauri/src/tentacles/gmail_outbound.rs`
- **Verification:** Code review against github_outbound's `gh_post`; same pattern.
- **Committed in:** `717cbc0`

**5. [Rule 2 — Hardening] Added 8 extra tests beyond the plan's 4-test minimum**
- **Found during:** Task 1 (test design)
- **Issue:** Plan's minimum was 4 tests. The slack/github outbound siblings ship 7-8 tests each — covering parse-routing, error envelopes, helper smoke. Maintaining test parity makes the three outbound files a coherent triad for future maintainers.
- **Fix:** Added 8 more tests (gmail_token smoke, gmail_mcp_registered smoke, parse extracts id/thread_id, parse accepts snake_case, parse surfaces error string, parse surfaces error object, parse handles garbage JSON, unicode round-trip) for a total of 12.
- **Files modified:** `src-tauri/src/tentacles/gmail_outbound.rs`
- **Verification:** All 12 tests pass.
- **Committed in:** `717cbc0`

---

**Total deviations:** 5 auto-fixed (1 Rule 3 blocking, 4 Rule 2 critical hardening)
**Impact on plan:** All deviations were corrections to the plan's pseudocode (which referenced non-existent APIs and had silent-success flaws on error envelopes). The final shape matches the slack/github outbound pattern verbatim — same 3-tier dispatch, same error-handling discipline, same test density. No scope creep.

## Issues Encountered

- None. cargo check + cargo test both clean on first attempt after the deviation fixes were folded into the implementation upfront (i.e., I didn't ship the plan's broken-as-written pseudocode and then fix it; I wrote the corrected version directly).

## Threat Flags

None — all surfaces in this plan are covered by `<threat_model>` T-18-CARRY-23/24/25/26.

## Verification

| Check | Result |
|-------|--------|
| `cd src-tauri && cargo check` | clean (3m02s, 8 pre-existing warnings in ego.rs/consent.rs — unrelated) |
| `cd src-tauri && cargo test --lib gmail_outbound -- --nocapture` | 12 passed; 0 failed (0.05s test runtime, 7m56s build) |
| `grep "users.messages.send\|gmail_token\|base64"` | 21 hits (≥3 required) |
| `grep "WriteScope::new\|assert_observe_only_allowed"` | 2 hits (≥1 required) |
| `grep "Integrations tab"` | 12 hits (≥2 required: D-10 + 401 paths both lock) |
| `grep "URL_SAFE_NO_PAD"` | present |
| `grep "fn build_raw_message"` | present |
| `grep "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"` | present |
| `grep "Reconnect Gmail via Integrations tab"` | present |
| `grep "Connect via Integrations tab → Gmail"` | present |
| `grep "as_u16() == 401"` | present |
| `npx tsc --noEmit` | clean |

## Next Phase Readiness

- gmail_outbound complete; Plan 18-14 (dispatcher) can now route `service: "gmail"` ActionRequired intents here
- Cold-install demo (Plan 18-12/16) still prefers Linear or Slack as the demo target — Gmail OAuth setup makes the demo fragile (D-10 hard-fail → user has to set up OAuth before clicking through)
- Wave 2 outbound tentacles status: slack ✅ (07), github ✅ (07), gmail ✅ (08) — calendar_outbound (Plan 09) is the next outbound to land
- v1.3 carry-over: OAuth refresh-token rotation for Gmail (currently 401 → Reconnect; v1.3 adds silent refresh)

## Self-Check: PASSED

- File `src-tauri/src/tentacles/gmail_outbound.rs` exists and contains the new body (verified by Edit/Write success + cargo test passing 12 tests)
- Commit `717cbc0` exists in `git log` (verified by `git commit` exit 0 + branch advance to `master 717cbc0`)
- All acceptance-criteria greps satisfied (counts above)
- All 12 tests green
- cargo check clean
- TypeScript clean

---
*Phase: 18-jarvis-ptt-cross-app*
*Completed: 2026-04-30*
