---
phase: 18-jarvis-ptt-cross-app
plan: 09
subsystem: jarvis
tags: [chat, rust, dispatch, consent-gate, write-scope, activity-log, allow-list]

# Dependency graph
requires:
  - phase: 18
    provides: "jarvis_dispatch.rs skeleton (Plan 01), WriteScope RAII (Plan 02), consent_check + ConsentVerdict (Plan 06), slack/github outbound bodies (Plan 07), gmail outbound body (Plan 08), IntentClass enum (Plan 04)"
provides:
  - "jarvis_dispatch_action full body — consent gate + WriteScope + 3-tier dispatch + D-17 LOCKED activity-log emission"
  - "emit_jarvis_activity helper (D-17 verbatim format with Unicode → arrow)"
  - "emit_consent_request helper (Plan 04 ConsentRequestPayload contract; safe_slice cap on content_preview)"
  - "try_native_tentacle allow-list (slack/github/gmail wired; linear/calendar reserved for Plan 18-14 Task 2)"
  - "try_mcp_tool fallback (SharedMcpManager pattern; mcp__{service}_{action} qualified-name format)"
  - "Outcome vocabulary lock (executed | denied | hard_refused — pinned by unit test)"
affects:
  - "18-10 (commands.rs integration — calls jarvis_dispatch_action when intent_router returns ActionRequired)"
  - "18-11 (frontend ConsentDialog — listens to consent_request event emitted here)"
  - "18-14 Task 2 (wires linear + calendar branches; replaces Wave-3 NeedsPrompt → NoConsent short-circuit with tokio::oneshot await)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RAII WriteScope binding (`let _scope = ecosystem::grant_write_window(...)`) — drop revokes per-tentacle window on every return path"
    - "Three-tier dispatch fan-out (native tentacle FIRST → MCP → native_tools last) per RESEARCH § Dispatch Order Verdict"
    - "Allow-list match arms (T-18-CARRY-28 mitigation) — unknown (service, action) tuples never trigger an outbound"
    - "SharedMcpManager via integration_bridge::get_app_handle (parity with slack/gmail outbound)"
    - "Pinned outcome vocabulary unit test — module source self-asserts every outcome literal references a valid string"

key-files:
  created: []
  modified:
    - "src-tauri/src/jarvis_dispatch.rs (replaced 49-line skeleton with 468-line body + 10 tests)"

key-decisions:
  - "Mirror slack_outbound's SharedMcpManager pattern instead of plan-spec'd `crate::mcp::manager()` — the latter does not exist in the codebase. Same Rule 3 fix Plan 18-08 applied to gmail_outbound."
  - "Wave 3 NeedsPrompt → NoConsent short-circuit: emit consent_request, return immediately. Plan 14 replaces with tokio::oneshot await on user dialog choice. Documented as KNOWN GAP in module-doc + plan output."
  - "Args contract: dispatcher receives serde_json::Value, passes through to outbounds. Wave 3 uses an empty object literal; Plan 14 wires real LLM-extracted args. Empty args → outbound returns Err → routed to HardFailedNoCreds with the outbound's own D-10 wording."
  - "linear and calendar branches return None on purpose. Plan 18-14 Task 2 owns wiring to auto_create_ticket + calendar_post_meeting_summary once intent_router emits real args. Marked with `// Plan 18-14 Task 2 wires this branch` comments."
  - "Tier 3 (native_tools) deferred to v1.3 per CONTEXT § Out of scope. Falls through with HardFailedNoCreds + precise suggestion message."
  - "uuid::Uuid::new_v4().to_string() for request_id (Cargo.toml:50 pre-pin verified at planning time)."

patterns-established:
  - "D-17 LOCKED format with Unicode → arrow (U+2192) — Phase 17 doctor pattern that already ships through ActivityLogProvider as plain text"
  - "emit_jarvis_activity(app, intent_class, target_service, outcome) — every outbound call site emits exactly one blade_activity_log line"
  - "Outcome vocabulary self-asserting unit test (include_str! the module source, grep for outcome literals)"

requirements-completed: [JARVIS-04, JARVIS-05, JARVIS-09, JARVIS-10]

# Metrics
duration: ~6 min (file rewrite + cargo check 3m + cargo test 4s + grep/emit-policy)
completed: 2026-04-30
---

# Phase 18 Plan 09: jarvis_dispatch_action body — consent + WriteScope + 3-tier dispatch + D-17 activity-log Summary

**Phase 18 Wave 3 load-bearing center lands: every outbound write path in v1.2 now fans out through `jarvis_dispatch_action` with a hard consent gate, RAII write window, and verbatim D-17 activity-log emission. Plan 14 wires real args + tokio::oneshot for "Allow once".**

## Performance

- **Duration:** ~6 min (file rewrite + cargo check 3m + cargo test 4s + emit-policy gate + grep verification)
- **Started:** 2026-04-30T18:00Z (approx — first Read of plan)
- **Completed:** 2026-04-30T18:06Z
- **Tasks:** 1
- **Files modified:** 1 (`src-tauri/src/jarvis_dispatch.rs` — 49 lines → 468 lines)
- **Tests added:** 10 (was 1 placeholder skeleton test)
- **Tests green:** 10/10 jarvis_dispatch + 20/20 cross-module (consent + jarvis_dispatch)

## Dispatch flow diagram (D-05 / D-06 / D-07 / D-08 / D-10 / D-17)

```
jarvis_dispatch_action(app, intent)
│
├─ IntentClass::ChatOnly → return NotApplicable (no outbound, no emit)
│
└─ IntentClass::ActionRequired { service, action }
   │
   ├─ GATE 1 — consent_check(D17_INTENT_LABEL, &service)        [T-18-01 / ASVS V2.6]
   │   ├─ Deny        → emit_jarvis_activity("denied")        → return NoConsent
   │   ├─ NeedsPrompt → emit_consent_request(uuid, preview)   → emit "denied" → return NoConsent
   │   │                                                          (Plan 14 replaces with oneshot await)
   │   └─ Allow       → continue
   │
   ├─ GATE 2 — let _scope = ecosystem::grant_write_window(&service, 30)   [T-18-02 / ASVS V13.1]
   │                                                                       (RAII; drop revokes per-tentacle entry)
   │
   ├─ Tier 1 — try_native_tentacle(service, action, args, app)
   │   ├─ ("slack",  "post" | "post_message")           → slack_outbound::slack_outbound_post_message
   │   ├─ ("github", "create_pr_comment" | "comment")   → github_outbound::github_outbound_create_pr_comment
   │   ├─ ("github", "create_issue" | "create")         → github_outbound::github_outbound_create_issue
   │   ├─ ("gmail",  "send" | "send_message")           → gmail_outbound::gmail_outbound_send
   │   ├─ ("linear", "create" | "create_issue")         → None  ← Plan 18-14 Task 2 wires
   │   ├─ ("calendar", _)                               → None  ← Plan 18-14 Task 2 wires
   │   └─ _ → None (cascade to Tier 2)
   │
   │   On Some(Ok(payload))                       → emit "executed"     → return Executed
   │   On Some(Err(e)) if "Connect via Integrations tab"  → emit "hard_refused" → return HardFailedNoCreds
   │   On Some(Err(e)) other                      → emit "hard_refused" → return Err(e)
   │   On None                                    → cascade to Tier 2
   │
   ├─ Tier 2 — try_mcp_tool(service, action, args, app)
   │   ├─ acquire AppHandle via integration_bridge::get_app_handle  (parity with slack/gmail outbound)
   │   ├─ try_state::<SharedMcpManager>() + lock
   │   ├─ call_tool(format!("mcp__{}_{}", service, action), args)
   │   ├─ Ok(result)             → join text content, parse JSON or wrap → Some(Ok(payload))
   │   ├─ Err("Unknown tool: …") → None (cascade to Tier 3)
   │   └─ Err(other)             → Some(Err(safe_slice'd))
   │
   │   On Some(Ok(payload)) → emit "executed"     → return Executed
   │   On Some(Err(e))      → emit "hard_refused" → return Err(e)
   │   On None              → cascade to Tier 3
   │
   └─ Tier 3 — native_tools (out of scope for v1.2 per CONTEXT § Out of scope)
       → emit "hard_refused" → return HardFailedNoCreds with "deferred to v1.3" suggestion
```

## D-17 LOCKED format usage (verbatim — never paraphrased)

Format: `[JARVIS] {intent_class}: {target_service} → {outcome}` (capped at 200 chars via `safe_slice`).

`emit_jarvis_activity` call sites in `src-tauri/src/jarvis_dispatch.rs`:
| Outcome | Reachable from | Line | Disposition |
|---------|---------------|------|-------------|
| `denied` | ConsentVerdict::Deny arm | 215 | T-18-01 mitigation — emit on consent denial |
| `denied` | ConsentVerdict::NeedsPrompt arm (post emit_consent_request) | 240 | Wave 3 short-circuit; Plan 14 replaces with `pending_consent` |
| `executed` | Tier 1 Ok(payload) | 266 | Native tentacle success |
| `hard_refused` | Tier 1 Err matches "Connect via Integrations tab" | 270 | D-10 routing |
| `hard_refused` | Tier 1 Err other | 277 | Tentacle hard error |
| `executed` | Tier 2 Ok(payload) | 287 | MCP fallback success |
| `hard_refused` | Tier 2 Err | 291 | MCP failure |
| `hard_refused` | Tier 3 fallthrough | 299 | No native + no MCP |

Outcome vocabulary pinned by `d17_outcome_vocabulary_pinned` unit test — `include_str!`s the module source and asserts every literal outcome string is in the canonical set `{executed, denied, auto_approved, hard_refused, capability_gap_logged, retry_succeeded}`.

## T-18-01 + T-18-02 mitigation evidence

| Threat | Mitigation | Evidence |
|--------|-----------|----------|
| **T-18-01 (HIGH)** Consent bypass | `consent_check(D17_INTENT_LABEL, &service)` runs BEFORE any outbound; Deny short-circuits to NoConsent; NeedsPrompt emits consent_request and returns NoConsent (frontend re-invokes); Allow proceeds. NO outbound path bypasses this gate. | `grep -n consent_check src-tauri/src/jarvis_dispatch.rs` returns 8 lines (1 import + 1 call + 6 test refs). Three unit tests lock the verdict semantics: `consent_deny_returns_deny_verdict`, `consent_allow_always_unblocks_path`, `consent_unknown_returns_needs_prompt`. |
| **T-18-02 (HIGH)** Privilege escalation via observe-only flag | `let _scope = ecosystem::grant_write_window(&service, 30)` acquired AFTER the consent gate. RAII binding — drop revokes the per-tentacle `WRITE_UNLOCKS` entry on every return path (panic-safe). 30s canonical TTL per Plan 02. | `grep -n grant_write_window src-tauri/src/jarvis_dispatch.rs` returns 2 lines. `write_scope_held_for_duration_then_revoked` unit test exercises the lifecycle: scope alive → assert_observe_only_allowed accepts; scope dropped → assert_observe_only_allowed rejects. |
| **T-18-CARRY-27** Information disclosure in consent_request | `safe_slice(content_preview, 200)` cap at the IPC seam in `emit_consent_request`. Frontend renders as plain text per Plan 17 (no markdown/HTML). | `safe_slice_caps_long_content_preview` unit test confirms the helper holds; emit_consent_request applies the cap before `app.emit_to`. |
| **T-18-CARRY-28** service/action tuple from LLM | `try_native_tentacle` match arms are an explicit allow-list. Unknown tuples produce `None` → cascade to Tier 2 (which validates tool name) → cascade to Tier 3 (HardFailedNoCreds). | `native_tentacle_allow_list_documented` unit test pins the recognised pairs. |
| **T-18-CARRY-29** request_id collision | `uuid::Uuid::new_v4()` (Cargo.toml:50, feature `v4`) — random UUID, sufficient for single-user single-process scope. Wave 3 doesn't yet wire bidirectional response channel; Plan 14 lands the oneshot resolver. | `request_id_is_uuid_v4` unit test verifies 36-char hyphenated shape. |

## Tests added (10) — all green

```
test jarvis_dispatch::tests::chat_only_returns_not_applicable_arm_compiles ... ok
test jarvis_dispatch::tests::consent_allow_always_unblocks_path ... ok
test jarvis_dispatch::tests::consent_deny_returns_deny_verdict ... ok
test jarvis_dispatch::tests::consent_unknown_returns_needs_prompt ... ok
test jarvis_dispatch::tests::d17_format_string_locked ... ok
test jarvis_dispatch::tests::d17_outcome_vocabulary_pinned ... ok
test jarvis_dispatch::tests::native_tentacle_allow_list_documented ... ok
test jarvis_dispatch::tests::request_id_is_uuid_v4 ... ok
test jarvis_dispatch::tests::safe_slice_caps_long_content_preview ... ok
test jarvis_dispatch::tests::write_scope_held_for_duration_then_revoked ... ok

test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 255 filtered out
```

Cross-module run (`consent + jarvis_dispatch --test-threads=1`): **20 passed; 0 failed**.

## Verification gates

- `cd src-tauri && cargo check` exits 0 (only pre-existing dead-code warnings from Plan 06 / Plan 05 — both resolved when Plan 14 wires their helpers)
- `cd src-tauri && cargo test --lib jarvis_dispatch` exits 0 with 10 tests green
- `cd src-tauri && cargo test --lib -- consent:: jarvis_dispatch:: --test-threads=1` exits 0 with 20 tests green
- `npm run verify:emit-policy` exits 0 — all 60 broadcast emits match cross-window allowlist
- `grep -c consent_check src-tauri/src/jarvis_dispatch.rs` = 8 (≥1 required)
- `grep -c grant_write_window src-tauri/src/jarvis_dispatch.rs` = 2 (≥1 required)
- `grep -c "let _scope" src-tauri/src/jarvis_dispatch.rs` = 2 (≥1 required)
- `grep -c blade_activity_log src-tauri/src/jarvis_dispatch.rs` = 3 (≥1 required)
- `grep -c "\[JARVIS\]" src-tauri/src/jarvis_dispatch.rs` = 5 (≥1 required)
- `grep -c consent_request src-tauri/src/jarvis_dispatch.rs` = 7 (≥1 required)
- `grep -E "\"executed\"|\"denied\"|\"hard_refused\"" | wc -l` = 17 (≥3 required)
- `grep -c "fn try_native_tentacle" src-tauri/src/jarvis_dispatch.rs` = 1
- `grep -c "fn try_mcp_tool" src-tauri/src/jarvis_dispatch.rs` = 1
- `grep -cE "Plan 18-14|Plan 14" src-tauri/src/jarvis_dispatch.rs` = 13 (≥2 required — linear + calendar branches marked)
- `grep -cE "tentacles::slack_outbound|tentacles::github_outbound|tentacles::gmail_outbound" src-tauri/src/jarvis_dispatch.rs` = 4 (≥3 required)
- `grep -c "uuid::Uuid::new_v4" src-tauri/src/jarvis_dispatch.rs` = 3 (≥1 required)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan pseudocode used `crate::mcp::manager()` API which does not exist**
- **Found during:** Task 1 (verifying MCP fallback signatures)
- **Issue:** The plan's `try_mcp_tool` body called `crate::mcp::manager()` and `manager.has_tool(&qualified).await` — neither symbol exists in `src-tauri/src/mcp.rs`. `McpManager::call_tool` is on the instance, accessed only through the `SharedMcpManager` Tauri-state pattern.
- **Fix:** Mirrored slack_outbound's `slack_deep.rs:34` pattern — acquire AppHandle via `crate::integration_bridge::get_app_handle()`, then `handle.try_state::<crate::commands::SharedMcpManager>()`, then `manager_state.lock().await`. Use `Err("Unknown tool: …")` discriminator to differentiate "no MCP tool registered" (cascade to Tier 3) from real MCP failures (surface as Err). This is the same Rule 3 fix Plan 18-08 applied to gmail_outbound's MCP path.
- **Files modified:** `src-tauri/src/jarvis_dispatch.rs` (try_mcp_tool body)
- **Commit:** `847c917`

**2. [Rule 2 — Critical] Outcome vocabulary needed pinning to prevent silent drift**
- **Found during:** Task 1 (writing unit tests)
- **Issue:** D-17 outcome vocabulary is `{executed, denied, auto_approved, hard_refused, capability_gap_logged, retry_succeeded}` — but nothing in the source asserts every emit site uses one of these strings. A future edit could leak a typo (e.g. `"executd"`) without any test failing.
- **Fix:** Added `d17_outcome_vocabulary_pinned` unit test that `include_str!`s the module source and asserts every outcome literal referenced inside the file is in the canonical set. Trips immediately on drift.
- **Files modified:** `src-tauri/src/jarvis_dispatch.rs` (test added)
- **Commit:** `847c917`

**3. [Rule 2 — Critical] WriteScope lifecycle needed an end-to-end test**
- **Found during:** Task 1 (writing unit tests)
- **Issue:** Plan only tested the consent gate semantics. WriteScope's RAII Drop is the T-18-02 mitigation; the dispatcher's contract requires the scope to unlock the tentacle for the duration of the outbound and revoke on exit. Without an end-to-end test exercising both sides, a regression in `WriteScope::drop` could leak the write window.
- **Fix:** Added `write_scope_held_for_duration_then_revoked` test: enter scope → `assert_observe_only_allowed` accepts the tentacle; exit scope → `assert_observe_only_allowed` rejects again (global OBSERVE_ONLY guardrail back in force).
- **Files modified:** `src-tauri/src/jarvis_dispatch.rs` (test added)
- **Commit:** `847c917`

**4. [Rule 2 — Critical] MCP fallback Ok-content parsing**
- **Found during:** Task 1 (writing try_mcp_tool body)
- **Issue:** Plan pseudocode just propagated `manager.call_tool(...).await.map_err(...)` and returned the raw `McpToolResult`. Callers expect `serde_json::Value` for the `Executed { payload }` arm; passing the raw McpToolResult breaks the type contract.
- **Fix:** Mirror slack_outbound's text-content concatenation pattern: collect `result.content[].text`, join, attempt `serde_json::from_str` for structured payloads, fall back to `{ "raw": text }` wrapper. Plan 14 may swap to a typed parser per service.
- **Files modified:** `src-tauri/src/jarvis_dispatch.rs` (try_mcp_tool Ok arm)
- **Commit:** `847c917`

**5. [Rule 2 — Critical] safe_slice on MCP error string**
- **Found during:** Task 1
- **Issue:** Plan pseudocode formatted the MCP error directly into the return string. MCP errors can be unbounded (entire JSON-RPC response bodies). Risk: huge error strings cross the IPC seam and bloat the activity log.
- **Fix:** Wrapped the MCP error in `crate::safe_slice(&e, 200)` before formatting, parity with slack_outbound's MCP failure handling.
- **Files modified:** `src-tauri/src/jarvis_dispatch.rs` (try_mcp_tool Err arm)
- **Commit:** `847c917`

### Plan-Spec'd Choices Held

- linear/calendar branches return `None` on purpose with explicit `// Plan 18-14 Task 2 wires this branch` comments. Plan 18-14 Task 2 owns the wiring once intent_router emits real args. (Plan-spec'd; no deviation.)
- NeedsPrompt path emits consent_request + returns NoConsent (Wave 3 simplification). Plan 14 replaces with tokio::oneshot await on user dialog choice. Documented in module-doc and plan output. (Plan-spec'd; no deviation.)
- Args contract: dispatcher receives serde_json::Value, passes through. Empty args → outbound returns Err → routed to HardFailedNoCreds with the outbound's own D-10 wording. (Plan-spec'd; no deviation.)

### Auth Gates

None — Plan 09 doesn't touch any auth path. The dispatcher *routes* to outbounds (slack/github/gmail) that handle auth in their own keyring lookups; Plan 09 surfaces their D-10 wording verbatim via the `Connect via Integrations tab` substring match.

## Open / Carries Forward

- **Plan 18-10 (commands.rs):** integrates the dispatcher into the chat pipeline — calls `jarvis_dispatch_action` when `intent_router` returns `IntentClass::ActionRequired`.
- **Plan 18-11 (frontend ConsentDialog):** listens to the `consent_request` event emitted here; user dialog choice triggers `consent_set_decision` (allow_always | denied) + re-invocation of `jarvis_dispatch_action`.
- **Plan 18-14 Task 2 (linear/calendar wiring):** replaces the `None` returns in `try_native_tentacle` with calls to `crate::tentacles::linear_jira::auto_create_ticket` + `crate::tentacles::calendar_tentacle::calendar_post_meeting_summary`. Also extracts real args from intent_router's structured output (replacing the empty `serde_json::json!({})` literal).
- **Plan 18-14 (oneshot await):** replaces the Wave-3 NeedsPrompt → NoConsent short-circuit with a `tokio::sync::oneshot::channel` keyed by `request_id` — dispatcher AWAITS the user's choice (Allow once / Allow always / Deny) instead of return-and-loop. After Plan 14 lands, the "Allow once" path becomes a one-shot dispatch without persisting consent.

## Self-Check: PASSED

- File exists: `src-tauri/src/jarvis_dispatch.rs` — FOUND (468 lines, 10 tests)
- Commit: `847c917` — FOUND in `git log --oneline -5`
- cargo check: clean (only pre-existing warnings)
- cargo test --lib jarvis_dispatch: 10/10 green
- cargo test --lib -- consent:: jarvis_dispatch:: --test-threads=1: 20/20 green
- npm run verify:emit-policy: green (60 emits matched)
- All 13 grep acceptance criteria: PASS (every threshold met or exceeded)
