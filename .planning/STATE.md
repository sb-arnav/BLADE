---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Phases
status: completed
last_updated: "2026-04-30T18:30:00Z"
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 92
  completed_plans: 89
  percent: 97
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 18 in progress (chat-first reinterpretation per CONTEXT D-01..D-21). Wave 0 ✅ closed (Plans 18-01/02/03/04/13). Wave 1 ✅ closed (Plans 18-05 ego.rs + 18-06 intent_router/consent). Wave 2 ✅ closed (Plans 18-07 slack/github outbound bodies + 18-08 gmail outbound body). Wave 3 in progress: Plan 18-09 ✅ shipped (jarvis_dispatch_action full body — consent gate + WriteScope + 3-tier dispatch + D-17 LOCKED activity-log emission; 10 unit tests green). Next: Plan 18-10 (commands.rs integration — wires intent_router + jarvis_dispatch_action into the chat pipeline).
**Status:** Phase 18 Plan 18-09 of 14 complete (Wave 3 progressing). Plan 18-09 replaced the Plan 01 jarvis_dispatch.rs skeleton (49 lines, 1 placeholder test) with full body (468 lines, 10 unit tests). Flow: ChatOnly → NotApplicable; ActionRequired → consent_check gate (T-18-01 / ASVS V2.6 — Deny → emit "denied" → NoConsent; NeedsPrompt → emit consent_request with uuid::Uuid::new_v4 request_id + safe_slice'd content_preview → NoConsent (Wave 3 simplification, Plan 14 replaces with tokio::oneshot await); Allow → continue) → `let _scope = ecosystem::grant_write_window(&service, 30)` RAII binding (T-18-02 / ASVS V13.1 — drop revokes per-tentacle entry on every return path) → Tier 1 try_native_tentacle (allow-list match arms for slack/github/gmail outbounds; linear/calendar return None on purpose with `// Plan 18-14 Task 2 wires this branch` markers) → Tier 2 try_mcp_tool (SharedMcpManager via integration_bridge::get_app_handle pattern, parity with slack_outbound; format!("mcp__{}_{}", service, action); Err("Unknown tool: …") cascades to Tier 3, other errors safe_slice'd) → Tier 3 native_tools deferred to v1.3 → HardFailedNoCreds with precise suggestion. emit_jarvis_activity helper produces verbatim D-17 format `[JARVIS] {intent_class}: {target_service} → {outcome}` (Unicode → arrow U+2192) at every outcome with safe_slice 200-char cap; outcome vocabulary {executed, denied, auto_approved, hard_refused, capability_gap_logged, retry_succeeded} pinned by `d17_outcome_vocabulary_pinned` test (include_str! self-assertion). emit_consent_request helper matches Plan 04 ConsentRequestPayload contract (T-18-CARRY-27 mitigation). 10 unit tests green: D-17 format lock + outcome vocabulary pin + ChatOnly short-circuit + consent Deny/Allow/NeedsPrompt verdict semantics + native tentacle allow-list documentation + WriteScope RAII lifecycle + safe_slice cap + uuid v4 request_id shape; cross-module run (consent + jarvis_dispatch --test-threads=1): 20/20 green. cargo check clean. emit-policy gate green (60 broadcast emits matched). 1 task commit (`847c917` feat); 5 deviations all auto-fixed (1 Rule 3 blocking — plan's `crate::mcp::manager()` API doesn't exist, swapped to SharedMcpManager pattern; 4 Rule 2 critical — outcome vocabulary pin test, WriteScope lifecycle test, MCP fallback Ok-content parsing, safe_slice on MCP error). KNOWN GAPS — Plan 14 closes: NeedsPrompt → tokio::oneshot await; linear/calendar branches → auto_create_ticket + calendar_post_meeting_summary wiring; real LLM-extracted args replacing the empty `serde_json::json!({})` literal.

---

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-27 at v1.1 close)

**Core value:** BLADE works out of the box, and you can always see what it's doing.

**v1.2 locked scope:** Eval foundation + Doctor module + JARVIS (with ego folded in) + Operator UAT close + Polish. ACT (full per-tentacle outbound surface), Skills MVP, tool-replacer, WIRE3 backend burn → v1.3+. Locked input at `notes/v1-2-milestone-shape.md`.

---

## Recent Context

### Shipped milestones

- **v1.0** (2026-04-19) — Skin Rebuild substrate (10 phases, ~165 commits, 18 verify gates green); phase dirs at `.planning/phases/0[0-9]-*` (never formally archived)
- **v1.1** (2026-04-24, closed 2026-04-27) — Functionality, Wiring, Accessibility (6 phases, 29 plans, 27 verify gates green); archived to `milestones/v1.1-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.1-phases/`

### v1.1 Locked Decisions (still in force for v1.2 planning)

- **M-01** Wiring + smart defaults + a11y, NOT new features — held; v1.2 acting work obeys the same anchor
- **M-03** Observe-only guardrail (`OBSERVE_ONLY: AtomicBool`) — v1.2 will flip per-tentacle behind explicit user consent + trust escalation, never silently
- **M-05** Phase numbering continues globally — v1.2 starts at Phase 16
- **M-07** Activity log is load-bearing — every cross-module action in v1.2 must continue to emit

### v1.0 Decisions Inherited

D-01..D-45 + D-56/D-57 remain locked. See `PROJECT.md` Key Decisions table.

### Open research questions for v1.2

- **Q1**: `browser-use/browser-harness` vs current `browser_native.rs` + `browser_agent.rs` — decision deadline before v1.2 JARVIS phase plan (`research/questions.md`)

---

## Deferred Items

Items acknowledged and deferred at v1.1 milestone close on 2026-04-27 (per `milestones/v1.1-MILESTONE-AUDIT.md` status=tech_debt). All follow the v1.0 Mac-smoke convention (operator-owned, tracked separately):

| Category | Phase | Item | Status | Notes |
|----------|-------|------|--------|-------|
| uat_gaps | 14 | 14-HUMAN-UAT.md | partial | 6 pending — activity-strip cross-route persistence, drawer focus-restore, localStorage rehydrate-on-restart, cold-install Dashboard screenshot, keyboard tab-traversal, 5-wallpaper contrast |
| uat_gaps | 15 | 15-05-UAT.md | unknown | 5 visual-UAT items — 5-wallpaper background-dominance, cold-install RightNowHero screenshot, top-bar hierarchy 1280×720, 50-route empty-state ⌘K sweep, spacing-ladder spot-check |
| verification_gaps | 14 | 14-VERIFICATION.md | human_needed | 17/17 must-haves auto-verified; 6 UAT items pending |
| verification_gaps | 15 | 15-VERIFICATION.md | human_needed | 5/5 SC auto-verified; 5 UAT items pending |
| advisory | 14 | LOG-04 time-range filter | not implemented | Only module filter shipped; 500-entry ring buffer naturally caps window |
| advisory | 11 | ROUTING_CAPABILITY_MISSING UI consumer | deferred | Toast/banner subscriber 0 src/; advisory WARN gate surfaces it |
| backlog | 10 | 97 DEFERRED_V1_2 backend modules | catalogued | All carry `deferral_rationale` strings in 10-WIRING-AUDIT.json; v1.2 burn-down candidate |

### v1.0 Open Checkpoints (still operator-owned)

- Mac smoke M-01..M-46 — `HANDOFF-TO-MAC.md`
- Plan 01-09 WCAG checkpoint — Mac desktop environment
- WIRE-08 full `cargo check` — WSL libspa-sys/libclang env limit; CI green

---

## Blockers

None. v1.1 closed cleanly with documented tech debt.

---

## Session Continuity

**Last session:** 2026-04-30T17:36Z (Plan 18-07 ✅ shipped — Wave 2 begun: slack_outbound MCP-first body + github_outbound gh_post bodies. 2 task commits `3e71f7f` (slack) + `7825e70` (github) across `src-tauri/src/tentacles/{slack,github}_outbound.rs`. slack_outbound::slack_outbound_post_message: Tier-1 MCP via `crate::config::load_config().mcp_servers` probe + `SharedMcpManager` lock through `integration_bridge::get_app_handle()` (slack_deep.rs:34 idiom verbatim) — tries `mcp__slack_chat.postMessage` (dot-form, JS convention) then `mcp__slack_chat_post_message` (underscore, official spec); discriminator: `Err("Unknown tool: ...")` falls through, any other Err propagates (preserves operator visibility into MCP failures, no silent HTTP fallback). Tier-2 HTTP POST `https://slack.com/api/chat.postMessage` with `Authorization: Bearer {SLACK_BOT_TOKEN}` from `crate::config::get_provider_key("slack")` keyring. Shared `parse_slack_response` between MCP+HTTP branches surfaces `ok:false` Slack errors as Err with the API error code, uses `safe_slice(200)` on every error string. github_outbound: `github_outbound_create_pr_comment` POST `/repos/{owner}/{repo}/issues/{pr_number}/comments` with `{"body": ...}`; `github_outbound_create_issue` POST `/repos/{owner}/{repo}/issues` with `{"title", "body"}`. gh_post helper replicated locally (verbatim github_deep.rs:185-200 header set: Bearer + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28` + `User-Agent: BLADE-Hive/1.0`) to break module coupling — github_deep refactor cannot regress this path. gh_client uses 30s timeout; PR-comment uses `/issues/{n}/comments` not `/pulls/{n}/comments` (review-thread is different feature). D-10 hard-fail format LOCKED across 3 paths verbatim: `[slack_outbound] Connect via Integrations tab → Slack (no creds found in keyring or MCP server registered).` + `[github_outbound] Connect via Integrations tab → GitHub (no PAT in keyring).` (×2 per github command). 14 unit tests green (7 slack + 7 github): hard_fail_message_format_is_d10_compliant + slack_token_helper_does_not_panic + slack_mcp_registered_smoke + parse_slack_response_extracts_ts_and_channel + parse_slack_response_uses_fallback_channel_when_missing + parse_slack_response_surfaces_api_error + parse_slack_response_handles_garbage_json | hard_fail_message_format_d10_compliant + pr_comment_url_format + issue_url_format + github_token_helper_does_not_panic + gh_client_builds_with_timeout + pr_comment_payload_shape (no `title` field) + issue_payload_shape. cargo check exits 0 (warnings only on pre-existing dead-code symbols `EgoOutcome`/`RETRY_COUNT`/`reset_retry_for_turn`/`emit_jarvis_intercept`/`handle_refusal`/`consent_check` consumed by Plan 18-10; zero new warnings on slack/github_outbound). assert_observe_only_allowed gates preserved at top of all 3 Tauri commands (defense-in-depth; Plan 14 dispatcher holds WriteScope upstream). Module-prefixed error strings (`[slack_outbound]`/`[github_outbound]`) so Plan 18-09 dispatcher can attribute failures by module without free-text parsing. Real HTTP/MCP integration tests deferred to Plan 18-12 cold-install operator UAT (no wiremock in tree). Zero deviations: plan executed exactly as written; pseudo-code's `crate::mcp::manager()` mapped to live `SharedMcpManager`/`get_app_handle()` API per slack_deep.rs canonical idiom — not a deviation, just live API surface. SUMMARY at `.planning/phases/18-jarvis-ptt-cross-app/18-07-SUMMARY.md`. JARVIS-04 requirement closed.

**Prior session:** 2026-04-30T16:48Z (Plan 18-06 ✅ shipped — Wave 1 intent_router heuristic body + consent SQLite CRUD; 2 task commits `d5c68ae` + `5721427` across `src-tauri/src/intent_router.rs`, `src-tauri/src/consent.rs`, `src-tauri/src/lib.rs`. intent_router::classify_intent: tier-1 heuristic (verb × service token, ChatOnly safe-default) — 7 ACTION_VERBS × 6 service tokens (slack/github/gmail+email-alias/calendar/linear); classify_intent_llm hook stubbed (returns None unconditionally) — D-04 Step 2 DEFERRED to v1.3 per Plan 14 path B + 18-DEFERRAL.md. consent.rs: open_db_at(path) testability seam + consent_check_at(db_path, ...) parallel seam pre-pinned for Plan 14 — full CRUD (consent_get_decision/consent_set_decision/consent_revoke_all/consent_list_decisions/consent_check) using composite-PK SQLite consent_decisions table; INSERT OR REPLACE for upsert; DELETE FROM for revoke_all; SELECT * ORDER BY decided_at DESC for list (Settings UI). Decision-value validation gate: only `allow_always` | `denied` are persistable; `allow_once` and arbitrary strings rejected with explicit error per T-18-CARRY-15 (Open Q1 in-memory only). 9 rusqlite::params! sites — SQL-injection-safe per T-18-CARRY-16. consent_list_decisions registered in lib.rs generate_handler! per CLAUDE.md 6-place rule. 20 unit tests green (10 intent_router + 10 consent): chat_only_for_greeting + slack/linear/gmail/github/calendar action_required + capitalization_invariant + heuristic_short_circuits_fast (<50ms) + 2 negatives (no-verb, no-service); schema_string_present + open_db_at_creates_table + set_persists_and_get_retrieves + get_returns_none_for_unknown via consent_check_at + revoke_all_clears + invalid_decision_rejected_at_set_decision + invalid_decision_arbitrary_string_rejected + consent_check_at_reads_allow_always + consent_check_at_reads_denied + consent_check_at_returns_needs_prompt_for_missing_db. cargo check clean (8 warnings, all dead-code on Plan 18-10 consumers). 2 deviations: Rule 1 test reword for github_comment ambiguity (had two verbs `update`+`comment` triggering first-match-wins on iteration order); Rule 2 added consent_list_decisions for D-10 Settings UI revoke flow. SUMMARY at `.planning/phases/18-jarvis-ptt-cross-app/18-06-SUMMARY.md`. REFUSAL_PATTERNS slot populated with 9 (Regex, label) tuples; Pattern 9 (`need_integration`) listed FIRST per D-13 CapabilityGap precedence; 5 mandatory + 3 stretch refusal patterns; disjunction-aware post-check via `static DISJUNCTION_POSTCHECK: OnceLock<Regex>` initialized to `\bbut\b.+\bcan\b` scanning 80-char lookahead from match.end(); safe_slice fallback for non-ASCII boundary cross. handle_refusal enforces D-14 retry cap = 1 per turn (RETRY_COUNT.fetch_add SeqCst returning previous value; prev >= 1 → HardRefused with retry_cap_exceeded reason); CapabilityGap branch emits intercepting → calls evolution_log_capability_gap (verbatim reuse of evolution.rs:1115) → catalog lookup with 3 key fallbacks (bare/_outbound/_write); Runtime kind routes through live `self_upgrade::auto_install(&CapabilityGap) -> InstallResult` (W2 pre-pin verified at self_upgrade.rs:387) with `.success` boolean check (NOT Result Ok/Err); Integration kind hard-refuses with D-15 locked format including `gap.integration_path`. emit_jarvis_intercept fires `app.emit_to("main", "jarvis_intercept", payload)` at every state transition (intercepting/installing/retrying/hard_refused) — single-window pattern matches blade_activity_log precedent, no allowlist entry needed; reason bounded via safe_slice(200) per T-18-CARRY-14. 7 occurrences of D-15 phrase "I tried, but ..." across all hard-refuse branches. 18 unit tests green (filtered 198): pattern_i_cant + pattern_no_access + pattern_not_able + pattern_cannot_directly + pattern_lack_the + pattern_as_an_ai + pattern_unable_to + pattern_no_capability + no_false_positive_on_but_can + no_false_positive_on_however_can + pass_on_helpful_response + capability_gap_precedes_refusal + capability_gap_extracts_capability_noun + retry_cap_holds + hard_refuse_format_locked + safe_slice_used_on_long_content + skeleton_compiles + reset_retry_works. cargo check clean (warnings on dead-code symbols `EgoOutcome` / `emit_jarvis_intercept` / `handle_refusal` consumed by Plan 18-10 commands.rs integration); npm run verify:emit-policy green (60 broadcast emits unchanged — single-window emit_to is exempt). Zero deviations beyond plan-allowed adoption of live auto_install signature. SUMMARY at `.planning/phases/18-jarvis-ptt-cross-app/18-05-SUMMARY.md`.
**Next action:** `/gsd-execute-plan 18-08` — Wave 2 continues: gmail_outbound base64url MIME + Gmail API `users.messages.send` body (Gmail OAuth wrinkle = why split from Plan 18-07). Wave 3: Plan 18-09 jarvis_dispatch_action body (consent gate via consent_check + WriteScope check + 3-tier dispatch + D-17 LOCKED activity-log emission). Wave 4: 18-10 commands.rs integration (wires ego::reset_retry_for_turn at send_message_stream start; ego::intercept_assistant_output before chat_token loop; ego::handle_refusal on verdict ≠ Pass; intent_router::classify_intent at message receipt; jarvis_dispatch dispatch on ActionRequired) → 18-11 frontend (6 typed Tauri wrappers + JarvisPill + ConsentDialog + MessageList/ChatPanel wiring) → 18-14 args extraction + Linear/Calendar concrete wiring + tokio::oneshot consent (request_consent + consent_respond) closing 4 plan-checker BLOCKERS. Wave 5: 18-12 cold-install demo + JARVIS-12 UAT screenshot.

**Context cliff notes:**

- v1.0 + v1.1 both shipped; substrate is reachable + observable + capability-aware
- 31 verify gates green (was 30; Phase 16 added `verify:eval`); tsc clean
- v1.2 = 5 phases (16=Eval ✅, 17=Doctor, 18=JARVIS+Ego, 19=Operator-UAT, 20=Polish)
- v1.2 acting work flips the per-tentacle observe-only guardrail with explicit consent + trust-tier escalation, never silently
- Activity log strip is the v1.1 contract every v1.2 cross-module action must honor
- Phase 16 eval harness lives at `src-tauri/src/evals/{harness, hybrid_search_eval, real_embedding_eval, kg_integrity_eval, typed_memory_eval, capability_gap_eval}.rs` — Phase 17 Doctor consumes these signals (DOCTOR-02)

---

*State updated: 2026-04-29 — **Phase 16 (Eval Scaffolding Expansion) shipped + verified.** 7 plans across 3 waves: Wave 1 = harness scaffold (16-01); Wave 2 = 5 eval modules (16-02 hybrid_search, 16-03 real_embedding, 16-04 kg_integrity, 16-05 typed_memory, 16-06 capability_gap); Wave 3 = gate-closer + cleanup (16-07: scripts/verify-eval.sh, tests/evals/DEFERRED.md, package.json verify:eval chain entry, embeddings.rs:496-946 deletion). Final state: 5 eval modules @ MRR 1.000, asserted floors held (top-3 ≥ 80%, MRR ≥ 0.6), `verify:all` 30→31 green, embeddings.rs 946→495 lines (production code byte-identical), 19 commits with no Co-Authored-By. Two REQ-vs-real path resolutions documented in file headers: EVAL-02 `consolidate_kg` does not exist (`add_node` idempotent-merge path satisfies); EVAL-05 `detect_missing_tool` lives at `self_upgrade::` not `evolution::` (no re-export added). One Rule-3 deviation: `scripts/verify-wiring-audit-shape.mjs` updated to exclude `src-tauri/src/evals/` from production wiring audit (test-only `#[cfg(test)]` modules). VERIFICATION.md PASS 25/25 must-haves, 4/4 ROADMAP SCs, 8/8 EVAL REQs. Phase 17 (Doctor Module) consumes these eval signals (DOCTOR-02).*

**Planned Phase:** 18 (jarvis-ptt-cross-app) — 14 plans — 2026-04-30T13:50:27.514Z
