---
phase: 18
plan: 12
task: 1  # Static gates only — Task 2 (cold-install demo) is operator-driven
status: green
created: 2026-04-30
captured_by: executor (Plan 18-12 Task 1)
---

# Plan 18-12 Task 1 — Static Gate Evidence Snapshot

> Captured 2026-04-30T20:20:41Z → 2026-04-30T20:22:49Z (128s wall).
>
> **Scope:** Task 1 only. Task 2 = `checkpoint:human-verify gate="blocking"` cold-install demo, operator-driven (typing chat command, clicking ConsentDialog, capturing screenshot). Plan 18-12 is **NOT** complete after this snapshot — it requires the operator handoff (Task 2) before SUMMARY.md is written and STATE.md marks Phase 18 complete.
>
> **Why this file exists:** Per BLADE Verification Protocol (CLAUDE.md), static gates ≠ done. This snapshot proves the static contract held the moment Wave 5 entered, so the cold-install demo is exercising a known-good build (not chasing a regression introduced after Plan 18-14).

---

## Static Gates Run

| # | Gate | Command | Exit | Notes |
|---|------|---------|------|-------|
| 1 | cargo check | `cd src-tauri && cargo check` | 0 | 1 warning (pre-existing `consent_check_at` testability seam — Plan 14 carry-forward, documented in 18-14-SUMMARY.md). No new warnings. |
| 2 | cargo test (Phase 18 modules) | `cargo test --lib {ego,intent_router,jarvis_dispatch,consent,slack_outbound,github_outbound,gmail_outbound} -- --test-threads=1` | 0 | 87 tests across 7 modules (see breakdown below); 0 failed; 0 ignored. |
| 3 | cargo test (Phase 17 doctor regression) | `cargo test --lib doctor -- --test-threads=1` | 0 | 35/35 green. No regression from Phase 18 landings. |
| 3b | cargo test (Phase 16 evals regression) | `cargo test --lib evals -- --test-threads=1` | 0 | 9/9 green. No regression. |
| 4 | tsc --noEmit | `npx tsc --noEmit` | 0 | Clean. |
| 5 | verify:all (full chain) | `npm run verify:all` | 0 | All 31 sub-gates green. Highlights captured below. |
| 6 | verify:eval (Phase 16 chain entry, also part of verify:all) | `bash scripts/verify-eval.sh` | 0 | 5/5 scored eval tables emitted; gate floors held (top-3 ≥ 80%, MRR ≥ 0.6); 1 unrelaxed adversarial drop captured but does not breach asserted floors. |

All 6 gates exit 0. **No regressions from Plan 18-14 baseline.**

---

## Phase 18 Module Test Breakdown (Gate 2)

| Module | Tests Passed | Notes |
|--------|--------------|-------|
| `ego` | 18/18 | 9 refusal patterns + 2 `but/however`-can negatives + capability-gap precedence + retry cap + reset_retry + safe_slice + skeleton_compiles + hard_refuse_format_locked. |
| `intent_router` | 16/16 | Verb × service heuristic for all 5 services (slack, github, gmail-via-email-alias, calendar, linear) + capitalization invariant + heuristic_short_circuits_fast + 6 args extraction tests + 2 negatives (no-verb, no-service). |
| `jarvis_dispatch` | 12/12 | Consent gate (allow_always / denied / unknown) + WriteScope held-then-revoked + D-17 format string locked + D-17 outcome vocabulary pinned + Plan 14 live tentacle calls present + safe_slice content preview cap + uuid v4 request_id + dispatch match-arm coverage. |
| `consent` | 15/15 (Gate 2 filter shows 18 lines including 3 jarvis_dispatch substring matches) | open_db_at + schema + persist+retrieve + revoke_all + invalid_decision rejected (allow_once / arbitrary string) + consent_check_at reads allow_always / denied / needs_prompt + consent_respond completes pending request with allow_once / allow_always / denied + consent_respond rejects invalid choice + consent_respond returns Err for unknown request_id. |
| `slack_outbound` | 7/7 | D-10 hard-fail format + parse_slack_response (extract ts/channel + fallback + API error + garbage JSON) + slack_token_helper_does_not_panic + slack_mcp_registered_smoke. |
| `github_outbound` | 7/7 | D-10 hard-fail format + pr_comment URL + issue URL + github_token_helper_does_not_panic + gh_client_builds_with_timeout + pr_comment_payload_shape + issue_payload_shape. |
| `gmail_outbound` | 12/12 | base64url no padding/unsafe chars + RFC 2822 headers + unicode subject/body + parse_gmail_response (id+thread / snake_case / API error string / API error object / garbage JSON) + token_expiry_message_routes_to_reconnect + D-10 hard-fail format + gmail_mcp_registered_smoke + gmail_token_helper_does_not_panic. |

**Total Phase 18 module tests: 87/87 green.**

---

## verify:all Sub-Gate Highlights (Gate 5)

Full chain: 31 sub-gates. The scope explicitly called out 4 to verify:

| Sub-gate | Status | Evidence |
|----------|--------|----------|
| `verify:emit-policy` | ✅ | `[verify-emit-policy] OK — all 60 broadcast emits match cross-window allowlist`. Phase 18 added `jarvis_intercept` (Plan 04 / Plan 06) and `consent_request` (Plan 04 / Plan 14) using `app.emit_to("main", …)` (single-window pattern, NOT broadcast) — neither needed an allowlist entry. The 60-emit count is unchanged from Plan 18-11 baseline. |
| `verify:wiring-audit-shape` | ✅ | `204 .rs files match modules.length`; `88 feature-cluster routes match routes.length`; `53 BladeConfig pub fields represented in config[]`; `99 not-wired rows have file:line entry points`; `1 dead row has callers[]+imports[]+safe_to_delete:boolean`. Phase 18 Wave 0 (Plan 18-04) added 7 new module entries (intent_router, ego, jarvis_dispatch, consent, slack_outbound, github_outbound, gmail_outbound) — the audit's modules count rose to 204 and the shape check still passes. |
| `verify:no-raw-tauri` | ✅ | `[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths`. Phase 18 Plan 11 wired MessageList + ChatPanel via `useTauriEvent` (D-13 lock — only permitted listen surface). Raw `listen()` import grep returns 0. |
| `verify:tokens-consistency` | ✅ | `[verify-tokens-consistency] OK — scanned 247 .css/.tsx files; all padding/margin/gap/font-size on ladder.` Plan 11 added 128 lines to chat.css using ONLY canonical tokens (`--s-N`/`--r-N`/`--t-N`/`--g-fill*`/`--g-edge-*`/`--font-*`/`--a-hot`). The v1.1 ghost-token retraction (210 refs across 9 files) is NOT repeated in Phase 18. |

Other 27 sub-gates also green (verify:entries, verify:migration-ledger, verify:contrast, verify:chat-rgba, verify:ghost-no-cursor, verify:orb-rgba, verify:hud-chip-count, verify:phase5-rust, verify:feature-cluster-routes, verify:phase6-rust, verify:phase7-rust, verify:phase8-rust, verify:aria-icon-buttons, verify:motion-tokens, verify:css-token-names, verify:empty-state-coverage, verify:providers-capability, verify:scan-no-egress, verify:scan-no-write, verify:scan-event-compat, verify:ecosystem-guardrail, verify:feature-reachability, verify:a11y-pass-2, verify:spacing-ladder, verify:empty-states-copy, verify:eval).

**Chain count = 31 (Phase 16 added verify:eval as the 31st; Phase 18 did not add any new chain entries — confirmed against `package.json` line 41).**

---

## Ghost-Token Audit on Plan 18-11 Files

```
grep -E "\-\-jarvis\-|\-\-consent\-" \
  src/features/chat/chat.css \
  src/features/chat/JarvisPill.tsx \
  src/features/chat/ConsentDialog.tsx
# → 0 matches
```

**0 ghost tokens.** Plan 18-11 used canonical tokens only.

---

## Q1 Closure Verification

```
grep -nE "Status:" .planning/research/questions.md
# → 20:- **Status:** closed
```

`Status: closed` × 1 (line 20, markdown-bolded form). `Status: open` × 0. JARVIS-09 requirement satisfied (Plan 18-10 commit `a1ff743`).

---

## Regression Sweep (Gates 3 + 3b)

- Phase 17 doctor: 35/35 green (eval_signal_green/red, prior_severity_map, severity/signal_class enum serialization, suggested_fix verbatim/exhaustive, tentacle_classify amber/red/green at all stale-windows, transition_gate emits/no-emits across all severity transitions).
- Phase 16 evals: 9/9 green (capability_gap_eval, harness::record_eval_run_appends_jsonl, hybrid_search_eval × 3 including evaluates_synthetic_hybrid_recall, kg_integrity_eval, real_embedding_eval × 2 including embedder_produces_sane_vectors, typed_memory_eval).

**No regression from Phase 18 landings.**

---

## What This File Does NOT Cover (Operator Handoff for Task 2)

Task 2 of Plan 18-12 is a `checkpoint:human-verify gate="blocking"` and was deliberately NOT executed by this agent. It requires the operator to:

1. **Pre-check creds.** Confirm Linear PAT in keyring (preferred — guaranteed-creds path). Alternative: Slack MCP installed.
2. **Run dev server.** `npm run tauri dev`.
3. **Trigger demo.** Open chat, type `create a Linear issue: test JARVIS demo from Phase 18`, press Enter.
4. **Observe.** ConsentDialog opens within ~3s with 3 buttons (Allow once default-focus + Allow always + Deny). Click "Allow once" or "Allow always".
5. **Confirm cross-app write.** Open Linear → confirm issue exists with the title "test JARVIS demo from Phase 18".
6. **Capture screenshot.** Save BLADE chat surface + ActivityStrip showing `[JARVIS] action_required: linear → executed` (and/or Linear issue page) to `docs/testing ss/jarvis-cold-install-demo.png` (literal-space directory).
7. **Read-back citation.** Use the Read tool on the saved PNG; cite a one-line observation in the verification log.
8. **Update 18-VERIFICATION.md.** Set frontmatter `status: verified`; populate the "Cold-Install Demo Status" section with target chosen + cross-app write evidence + screenshot path + read-back observation.
9. **Reply with "verified"** plus the demo target + 1-2 line cross-app-write description + screenshot path + one-line read-back observation.

**Until step 9 lands, Plan 18-12 is incomplete and Phase 18 is NOT closed in STATE.md.**

---

## Plan 18-12 Status After This Snapshot

- Task 1 (static gates): ✅ green — this file is the evidence
- Task 2 (cold-install demo): ⏸ pending operator handoff
- 18-VERIFICATION.md: NOT created (deferred to Task 2 — the file requires the cold-install demo evidence to be meaningful)
- 18-12-SUMMARY.md: NOT created
- STATE.md `progress.completed_phases`: still 12 (will become 13 only after Task 2)
- ROADMAP.md Phase 18: still in-progress
