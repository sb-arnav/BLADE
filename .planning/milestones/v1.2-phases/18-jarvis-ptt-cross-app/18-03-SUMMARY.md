---
phase: 18
plan: 03
subsystem: jarvis-ptt-cross-app
tags: [scaffolding, tentacles, rust, module-registration]
type: execute
autonomous: true
requirements: [JARVIS-04]
dependency-graph:
  requires:
    - "src-tauri/src/ecosystem.rs::assert_observe_only_allowed (Plan 18-02 2-arg signature)"
    - "src-tauri/src/tentacles/mod.rs (existing 11 tentacle modules)"
  provides:
    - "tentacles::slack_outbound module (PostResult + slack_outbound_post_message Tauri cmd)"
    - "tentacles::github_outbound module (GhCommentResult + GhIssueResult + 2 Tauri cmds)"
    - "tentacles::gmail_outbound module (SendResult + gmail_outbound_send Tauri cmd)"
    - "4 new Tauri commands registered in lib.rs::generate_handler!"
  affects:
    - "Plan 18-09 jarvis_dispatch will route to these by name (skeletons compile-discoverable)"
    - "Plan 18-11 will fill slack_outbound body (MCP-first / HTTP-fallback)"
    - "Plan 18-12 will fill github_outbound bodies (gh_post pattern from github_deep.rs)"
    - "Plan 18-13 will fill gmail_outbound body (MCP detection + Gmail API HTTP send)"
tech-stack:
  added: []
  patterns:
    - "#[tauri::command] async fn ... -> Result<T, String> for outbound write paths"
    - "crate::ecosystem::assert_observe_only_allowed(tentacle, action)? as the first line of every outbound command (Plan 02 surface wired)"
    - "Skeleton-pattern: command body is `Err(\"[<module>] not yet implemented (Wave 0 skeleton)\".to_string())` with `let _ = (args);` parameter sink — bodies in Wave 2"
    - "#[serde(rename_all = \"camelCase\")] on SendResult for snake_case Rust → camelCase JS marshalling (Gmail API convention)"
key-files:
  created:
    - "src-tauri/src/tentacles/slack_outbound.rs (42 lines: PostResult + 1 Tauri cmd + 1 stub test)"
    - "src-tauri/src/tentacles/github_outbound.rs (60 lines: GhCommentResult + GhIssueResult + 2 Tauri cmds + 1 stub test)"
    - "src-tauri/src/tentacles/gmail_outbound.rs (44 lines: SendResult + 1 Tauri cmd + 1 stub test)"
  modified:
    - "src-tauri/src/tentacles/mod.rs (+5 lines: 3 pub mod declarations under Phase 18 banner)"
    - "src-tauri/src/lib.rs (+6 lines: 4 generate_handler! entries under Phase 18 banner)"
decisions:
  - "All 4 Tauri command names verified clash-free against existing src/ via Pre-flight Namespace Check (PATTERNS.md, 2026-04-30): slack_outbound_post_message, github_outbound_create_pr_comment, github_outbound_create_issue, gmail_outbound_send"
  - "Skeletons return `Err(\"...not yet implemented (Wave 0 skeleton)\")` rather than panic or unimplemented!() — Plan 14 dispatcher will exercise these paths during integration tests; explicit Err preserves end-to-end Result flow without crashing the test runner"
  - "Each outbound command calls `crate::ecosystem::assert_observe_only_allowed(tentacle, action)?` as line 1 of the body — proves the Plan 02 2-arg surface is wired correctly even at Wave 0; gating fires before any future body lands, defense-in-depth for T-18-CARRY-08"
  - "Module registration 3-step honored at Wave 0 (file → pub mod → generate_handler!) per CLAUDE.md — preempts the Phase 17 gate-miss pattern where late-registered modules surfaced compile errors at the wrong checkpoint"
  - "GhCommentResult uses `id` (numeric GitHub comment ID); GhIssueResult uses `number` (issue number, not id) — matches the GitHub REST API response shapes Plan 12 will deserialize"
  - "Gmail SendResult uses #[serde(rename_all = \"camelCase\")] — Gmail API returns `threadId` (camelCase); avoids a downstream serde rename on the body in Plan 13"
metrics:
  duration: "~10 min skeleton + 5min check/test cycle (cargo check 5m23s + cargo test 7m55s due to full rebuild after Plan 02 ecosystem changes)"
  completed: "2026-04-30T14:35Z"
  task_count: 2
  test_count_added: 3
  files_created: 3
  files_modified: 2
  commits: ["a6175ca", "7e5b11f"]
---

# Phase 18 Plan 03: Outbound Tentacle Skeletons Summary

**One-liner:** 3 outbound tentacle modules (slack_outbound, github_outbound, gmail_outbound) land as Wave 0 skeletons with locked Tauri command signatures, observe-only gating wired at line 1 of every command, and full module-registration 3-step honored — bodies land in Plans 11/12/13.

## What Shipped

### Task 1 — Outbound tentacle skeleton files (commit `a6175ca`)

**3 new tentacle modules** under `src-tauri/src/tentacles/`:

**`slack_outbound.rs` (42 lines):**
- `pub struct PostResult { ts: String, channel: String, ok: bool }`
- `#[tauri::command] pub async fn slack_outbound_post_message(_app, channel, text) -> Result<PostResult, String>`
- Body: `assert_observe_only_allowed("slack", "post_message")?` → `Err("[slack_outbound] not yet implemented (Wave 0 skeleton)")`
- 1 stub test with comment block enumerating Plan 11 follow-up tests

**`github_outbound.rs` (60 lines):**
- `pub struct GhCommentResult { id: u64, url: String }`
- `pub struct GhIssueResult { number: u64, url: String }`
- `#[tauri::command] pub async fn github_outbound_create_pr_comment(_app, owner, repo, pr_number, body) -> Result<GhCommentResult, String>`
- `#[tauri::command] pub async fn github_outbound_create_issue(_app, owner, repo, title, body) -> Result<GhIssueResult, String>`
- Bodies: `assert_observe_only_allowed("github", action)?` → `Err("[github_outbound] not yet implemented (Wave 0 skeleton)")`
- 1 stub test with comment block enumerating Plan 12 follow-up tests

**`gmail_outbound.rs` (44 lines):**
- `pub struct SendResult { id: String, thread_id: String }` with `#[serde(rename_all = "camelCase")]` (Gmail API returns `threadId`)
- `#[tauri::command] pub async fn gmail_outbound_send(_app, to, subject, body) -> Result<SendResult, String>`
- Body: `assert_observe_only_allowed("gmail", "send_message")?` → `Err("[gmail_outbound] not yet implemented (Wave 0 skeleton)")`
- 1 stub test with comment block enumerating Plan 13 follow-up tests (incl. 401-handling deferral note)

### Task 2 — Module registration 3-step (commit `7e5b11f`)

**`tentacles/mod.rs` (+5 lines):** 3 `pub mod` declarations appended under `// Phase 18 — outbound writers (chat → cross-app action; D-05 priority 1)` banner, after existing `pub mod cloud_costs;`.

**`lib.rs::generate_handler!` (+6 lines):** 4 new Tauri command entries appended after the Plan 01 Phase 18 block (after `consent::consent_revoke_all,`), under `// Phase 18 — outbound tentacles (chat → cross-app action; D-05 priority 1)` banner:
- `tentacles::slack_outbound::slack_outbound_post_message`
- `tentacles::github_outbound::github_outbound_create_pr_comment`
- `tentacles::github_outbound::github_outbound_create_issue`
- `tentacles::gmail_outbound::gmail_outbound_send`

## Verification

- `cd src-tauri && cargo check` → exit 0; only pre-existing dead_code warnings on Plan 01 stubs (consent.rs, ego.rs); no new warnings from outbound tentacle skeletons
- `cd src-tauri && cargo test --lib skeleton_returns_not_implemented -- --nocapture` → 3 passed; 0 failed; 0 ignored
  - `tentacles::github_outbound::tests::skeleton_returns_not_implemented ... ok`
  - `tentacles::slack_outbound::tests::skeleton_returns_not_implemented ... ok`
  - `tentacles::gmail_outbound::tests::skeleton_returns_not_implemented ... ok`
- `grep -c "^pub mod (slack_outbound|github_outbound|gmail_outbound);" src-tauri/src/tentacles/mod.rs` (via `grep -E`) → 3 ✓
- `grep -c "tentacles::(slack_outbound|github_outbound|gmail_outbound)::" src-tauri/src/lib.rs` (via `grep -E`) → 4 ✓
- `grep -c "assert_observe_only_allowed" src-tauri/src/tentacles/{slack,github,gmail}_outbound.rs` → 6 total (4 in command bodies + 2 in test docblock comments) — exceeds plan acceptance criterion of "at least 4 (one per Tauri command)"
- All 4 Tauri command names confirmed clash-free against existing `src/`: `grep -rn "fn slack_outbound_post_message\|fn github_outbound_create_pr_comment\|fn github_outbound_create_issue\|fn gmail_outbound_send" src-tauri/src/` returns only the 4 new definitions

## Threat Model — Mitigation Status

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-18-CARRY-07 (Tampering — namespace clash) | mitigate | ✅ 4 Tauri command names confirmed unique pre-flight; cargo check passes (Tauri's flat-namespace would have errored on a clash) |
| T-18-CARRY-08 (Elevation — outbound bypassing observe-only) | mitigate | ✅ Each tentacle's Wave 0 body calls `assert_observe_only_allowed(tentacle, action)?` at line 1 — even with skeleton bodies, the gate fires; bodies in Plans 11/12/13 inherit this gate position |
| T-18-CARRY-09 (Information Disclosure — skeleton return paths) | accept | ✅ All 4 commands return `Err("...not yet implemented...")` with `let _ = (args);` parameter sink — no data flows out, no provider creds touched |

## Deviations from Plan

None — plan executed exactly as written.

The plan's expected acceptance criteria all passed on first run:
- Files created at expected paths with locked struct names + Tauri command signatures
- `pub mod` declarations appended in append-order convention (matches existing tentacles/mod.rs which is not strictly alphabetical — D-05 banner clusters new modules instead)
- generate_handler! entries appended under Phase 18 banner adjacent to Plan 01's entries
- cargo check + cargo test both green on first invocation

The plan's verification section listed `cargo test --lib slack_outbound github_outbound gmail_outbound` which cargo rejects (only one TESTNAME positional supported). Substituted `cargo test --lib skeleton_returns_not_implemented` which filters to the 3 tentacle stub tests by their shared name. Equivalent coverage; not a deviation in scope.

## Open Items (Wave 2 scope)

- **Plan 18-11** (slack_outbound body): MCP-first via `mcp__slack_chat_post_message` with HTTP fallback to `https://slack.com/api/chat.postMessage`; hard-fail on missing creds (D-10); test the assert_observe_only_allowed gate fires when WriteScope absent.
- **Plan 18-12** (github_outbound body): Reuse `github_deep::github_token()` + `gh_post()` pattern; mock-reqwest tests for both create_pr_comment + create_issue; hard-fail on missing PAT.
- **Plan 18-13** (gmail_outbound body): MCP detection first; Gmail API HTTP fallback via OAuth token; 401-handling routes to "reconnect Gmail" string in result Err (full OAuth refresh cycle deferred to v1.3).
- **Plan 18-14** (jarvis_dispatch wiring): Acquires `WriteScope` via `ecosystem::grant_write_window(tentacle, 30)` before calling these tentacles; routes by `tentacle` field on the dispatch payload.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes introduced. All 4 commands are skeleton-only and return `Err` before any IO.

## Self-Check: PASSED

- File `src-tauri/src/tentacles/slack_outbound.rs`: FOUND ✓
- File `src-tauri/src/tentacles/github_outbound.rs`: FOUND ✓
- File `src-tauri/src/tentacles/gmail_outbound.rs`: FOUND ✓
- File `src-tauri/src/tentacles/mod.rs`: MODIFIED (3 pub mod lines under Phase 18 banner) ✓
- File `src-tauri/src/lib.rs`: MODIFIED (4 generate_handler entries under Phase 18 banner) ✓
- Commit `a6175ca`: FOUND in `git log` ✓
- Commit `7e5b11f`: FOUND in `git log` ✓
- cargo check: exit 0 ✓
- cargo test (3 stub tests): all green ✓
