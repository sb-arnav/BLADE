---
phase: 18-jarvis-ptt-cross-app
plan: 07
subsystem: tentacles
tags: [tentacles, rust, http, mcp, slack, github, reqwest, outbound]

# Dependency graph
requires:
  - phase: 18-jarvis-ptt-cross-app
    plan: 03
    provides: "slack_outbound + github_outbound skeletons (Tauri commands, return shapes, observe-only gate)"
  - phase: 18-jarvis-ptt-cross-app
    plan: 02
    provides: "assert_observe_only_allowed 2-arg signature; WriteScope RAII guard; per-tentacle WRITE_UNLOCKS map"
provides:
  - "slack_outbound::slack_outbound_post_message body — MCP-first dispatch + HTTP fallback + D-10 hard-fail"
  - "github_outbound::github_outbound_create_pr_comment body — gh_post POST /issues/{n}/comments"
  - "github_outbound::github_outbound_create_issue body — gh_post POST /issues"
  - "Local replication of github_deep.rs gh_post pattern (locked header set: Bearer + Accept + API-Version + UA)"
  - "Slack response parser shared between MCP + HTTP branches (parse_slack_response)"
  - "14 unit tests across both files (parse routing, URL shapes, payload shapes, hard-fail formats)"
affects:
  - "18-09 (jarvis_dispatch_action will call these via Tauri invoke)"
  - "18-10 (commands.rs integration — chat-driven dispatch)"
  - "18-12 (cold-install demo target — slack_outbound is the primary demo path)"
  - "18-14 (Linear/Calendar concrete wiring will follow this exact pattern)"

# Tech tracking
tech-stack:
  added: []  # No new deps — reqwest + serde_json already in tree (used by github_deep.rs)
  patterns:
    - "MCP-first dispatch: probe BladeConfig.mcp_servers; if registered, try qualified candidates via SharedMcpManager; fall through to HTTP only when no MCP path is available"
    - "Locked GitHub header set replicated locally to avoid github_deep coupling: Bearer + application/vnd.github+json + X-GitHub-Api-Version 2022-11-28 + User-Agent BLADE-Hive/1.0"
    - "D-10 hard-fail format: '[<module>] Connect via Integrations tab → <Service>' — verbatim string match in tests guards against future paraphrase"
    - "Real MCP failures (non-Unknown-tool errors) propagate without silent HTTP fallback — preserves operator visibility into MCP-side failures"

key-files:
  created: []
  modified:
    - "src-tauri/src/tentacles/slack_outbound.rs (29 → 231 lines; +203 net)"
    - "src-tauri/src/tentacles/github_outbound.rs (63 → 215 lines; +168 net)"

key-decisions:
  - "Slack MCP candidates tried in order: 'mcp__slack_chat.postMessage' (dot-form, JS-client convention) then 'mcp__slack_chat_post_message' (underscore-form, official tool spec). RESEARCH § slack_outbound flagged runtime-validate; we try both and use the first the manager accepts."
  - "MCP discriminator: call_tool returning 'Unknown tool: ...' Err means try the next candidate; any other Err means a real MCP failure that surfaces to the caller (no silent HTTP fallback). This preserves operator visibility into MCP-side regressions."
  - "github_outbound replicates gh_post locally rather than importing from github_deep.rs — avoids module coupling so a refactor of github_deep cannot regress this path. The verbatim header set is the contract."
  - "30s reqwest timeout on github gh_client — prevents network failures from hanging the dispatch loop. Slack HTTP path uses default Client (Slack's own server-side timeout is short)."
  - "PR-comment endpoint uses /issues/{n}/comments not /pulls/{n}/comments — GitHub treats PRs as issues for the comment surface; /pulls/{n}/comments is for review-thread comments which is a different feature."

patterns-established:
  - "Outbound tentacle dispatch tier order: Tier 1 MCP (when registered), Tier 2 HTTP (when token), Tier 3 hard-fail (D-10 format). gmail_outbound (Plan 18-08) and Linear/Calendar (Plan 18-14) follow the same shape."
  - "safe_slice on every user-content/error-message string before logging or echoing to error returns (CLAUDE.md non-ASCII rule honored)."
  - "Test composition for outbound tentacles without mockito/wiremock: pure unit tests on parse functions + URL/payload format strings + smoke tests on helper non-panic. Real HTTP/MCP integration deferred to Plan 18-12 cold-install demo (operator-machine UAT)."
  - "Module-prefixed error strings: every Err starts with '[slack_outbound]' or '[github_outbound]' so the dispatcher (Plan 18-09) can attribute failures by module without parsing free-text."

requirements-completed:
  - JARVIS-04

# Metrics
duration: 41min
completed: 2026-04-30
---

# Phase 18 Plan 07: Slack + GitHub Outbound Bodies Summary

**MCP-first Slack post_message + HTTP-fallback dispatch landed; github_outbound gh_post replicated locally for PR comment + issue create; D-10 hard-fail format locked across 3 paths; 14 tests green; cargo check clean.**

## Performance

- **Duration:** ~41 min
- **Started:** 2026-04-30T16:54Z
- **Completed:** 2026-04-30T17:35Z
- **Tasks:** 2
- **Files modified:** 2 (slack_outbound.rs, github_outbound.rs)

## Accomplishments

- **slack_outbound dispatch hierarchy:** MCP path probes BladeConfig.mcp_servers, then tries `mcp__slack_chat.postMessage` and `mcp__slack_chat_post_message` candidates via SharedMcpManager; HTTP fallback POSTs to `https://slack.com/api/chat.postMessage` with Bearer auth. Hard-fail (D-10) when neither MCP nor token: `"[slack_outbound] Connect via Integrations tab → Slack (no creds found in keyring or MCP server registered)."`
- **github_outbound endpoint mapping:**
  - PR comment → `POST https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments` with `{"body": ...}`
  - Issue create → `POST https://api.github.com/repos/{owner}/{repo}/issues` with `{"title", "body"}`
  - Locked header set: `Authorization: Bearer {token}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: BLADE-Hive/1.0`
  - Hard-fail (D-10): `"[github_outbound] Connect via Integrations tab → GitHub (no PAT in keyring)."`
- **Shared parse helper for Slack:** `parse_slack_response` works on both MCP-wrapped text content AND raw HTTP JSON; surfaces `ok: false` Slack errors as `Err` with the API error code.
- **14 tests green:** 7 in slack_outbound (hard-fail format, token smoke, mcp-registered smoke, parse extracts ts+channel, fallback channel, surfaces ok:false API error, garbage JSON) + 7 in github_outbound (hard-fail format, pr-comment URL shape, issue URL shape, token smoke, client-builder smoke, pr-comment payload shape, issue payload shape).

## Task Commits

Each task was committed atomically:

1. **Task 1: slack_outbound MCP-first body + HTTP fallback + 7 tests** — `3e71f7f` (feat)
2. **Task 2: github_outbound bodies (PR comment + issue create) + 7 tests** — `7825e70` (feat)

**Plan metadata:** _(committed as final docs commit alongside SUMMARY+STATE+ROADMAP)_

## Files Created/Modified

- `src-tauri/src/tentacles/slack_outbound.rs` — 231 lines. Filled the Wave 0 skeleton with MCP-first dispatch + HTTP fallback + parse_slack_response shared helper + 7 unit tests.
- `src-tauri/src/tentacles/github_outbound.rs` — 215 lines. Filled the Wave 0 skeleton with locally-replicated gh_post pattern + 2 Tauri commands (PR comment, issue create) + 7 unit tests.

## Decisions Made

- **Slack MCP candidate order: dot-form first, underscore-form second.** `mcp__slack_chat.postMessage` matches JS-style client conventions (more common in published Slack MCP servers); the underscore variant matches the official tool spec. Trying both lets BLADE work against either.
- **MCP discrimination: only `"Unknown tool: ..."` Err falls through.** Any other `Err` from `manager.call_tool` propagates as the outer `Err`. Rationale: if the user's MCP server returns a real failure (auth expired, rate-limited, etc.), silently retrying via HTTP would mask the issue. Operator visibility wins over silent recovery.
- **github_outbound replicates gh_post locally instead of importing from github_deep.rs.** github_deep.rs's helpers are `fn`-private; making them `pub(crate)` would tie outbound to the deep-tentacle's evolution. Replicating the verbatim 4-header set is cheap (10 lines) and breaks the coupling permanently.
- **30s reqwest timeout on github only; default for slack.** Slack's API is fast and Slack's SDK clients all use default timeouts. GitHub occasionally hangs on rate-limited responses (RESEARCH § github_outbound Watch Out); the 30s ceiling prevents the dispatch loop from blocking indefinitely.
- **PR-comment endpoint: `/issues/{n}/comments` not `/pulls/{n}/comments`.** PRs are issues under GitHub's data model; the `/pulls/` endpoint targets review-thread comments (different feature). The plan's `<behavior>` block locked this — verified against github_deep.rs:375.

## Deviations from Plan

None — plan executed exactly as written. All grep-based acceptance criteria met; all behavior contracts honored; D-10 hard-fail strings locked verbatim; observe-only gating preserved at top of each Tauri command; safe_slice applied on every error-message body.

The plan's pseudo-code referenced `crate::mcp::manager()` directly; the real API uses `SharedMcpManager` state acquired through `integration_bridge::get_app_handle()`, then locked via `tokio::sync::Mutex`. The slack_deep.rs:34 idiom is the canonical pattern and was followed verbatim — this is not a deviation, just the live API surface (the plan was written from a slightly stylized signature).

## Issues Encountered

None. Cargo check completes in 11m30s on cold cache (typical for src-tauri); cargo test in 10m08s. Both clean of new warnings. Pre-existing dead-code warnings on `EgoOutcome` / `RETRY_COUNT` / `reset_retry_for_turn` / `emit_jarvis_intercept` / `handle_refusal` / `consent_check` are consumed by Plan 18-10 (commands.rs integration) — out of scope for this plan.

## User Setup Required

None. The Tauri commands are wired in `lib.rs:1357-1359` from Plan 18-03. End-to-end UAT (real Slack post + real GitHub PR comment) will land in Plan 18-12 cold-install demo with operator-provided Slack bot token / GitHub PAT.

## Next Phase Readiness

- **Plan 18-08 (gmail_outbound body)** — same plan-shape (MCP-first or token-fallback), with Gmail-specific OAuth wrinkle: `users.messages.send` requires base64url-encoded MIME message in the body. Gmail OAuth flow is meaningfully different from Slack/GitHub PAT, which is why it was split into its own plan.
- **Plan 18-09 (jarvis_dispatch_action body)** — will invoke these three commands via `tauri::AppHandle::run` (or direct call) once intent classification + consent gate land. The module-prefixed error strings (`[slack_outbound]` / `[github_outbound]`) let the dispatcher attribute failures by module without free-text parsing.
- **Open:** Real HTTP/MCP integration tests deferred to Plan 18-12 (operator UAT). If wiremock is added to dev-deps later, the deferred tests are listed in module comments for both files.

## Threat Flags

None. The threat surface for this plan was fully covered by the plan's `<threat_model>` (T-18-CARRY-19/20/21/22). No new endpoints, auth paths, or trust-boundary surfaces were introduced beyond the planned outbound writes.

## Self-Check: PASSED

- File `src-tauri/src/tentacles/slack_outbound.rs` exists (231 lines).
- File `src-tauri/src/tentacles/github_outbound.rs` exists (215 lines).
- Commit `3e71f7f` exists (Task 1).
- Commit `7825e70` exists (Task 2).
- `cargo check` exits 0 (warnings only on dead-code symbols consumed by Plan 18-10; none introduced by this plan).
- `cargo test --lib slack_outbound` 7/7 passed.
- `cargo test --lib github_outbound` 7/7 passed.
- Plan-level grep checks all green:
  - `Connect via Integrations tab` → 6 (slack) + 5 (github) ≥ 3 ✅
  - `assert_observe_only_allowed` → 2 (slack) + 3 (github) = 5 ≥ 3 ✅
  - `min_lines` slack 231 ≥ 120 ✅; github 215 ≥ 130 ✅

---
*Phase: 18-jarvis-ptt-cross-app*
*Completed: 2026-04-30*
