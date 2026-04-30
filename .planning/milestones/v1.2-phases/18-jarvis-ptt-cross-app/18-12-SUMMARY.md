---
phase: 18-jarvis-ptt-cross-app
plan: 12
status: complete
runtime_demo: deferred
deferred_by: operator
deferred_on: 2026-04-30
deferred_rationale: operator lacks the API keys (Linear/Slack/Gmail) needed to drive the cold-install demo
---

# Plan 18-12 — Phase 18 Verification (Static-Gate-Only Close)

**Plan status:** complete with explicit operator deferral of the cold-install runtime demo.

## What landed

**Task 1 — static gates: GREEN.**
- `cargo check` clean (1 pre-existing `consent_check_at` testability-seam warning — not a regression)
- 87/87 Phase 18 unit tests passing (ego 18, intent_router 16, jarvis_dispatch 12, consent 15, slack_outbound 7, github_outbound 7, gmail_outbound 12)
- 35/35 doctor::tests + 9/9 evals tests still green (Phase 16 + Phase 17 invariants preserved — zero regression)
- `npx tsc --noEmit` clean
- `npm run verify:all` 31/31 sub-gates green (verify:emit-policy + verify:wiring-audit-shape + verify:no-raw-tauri + verify:tokens-consistency all pass — Phase 17 gate-miss lessons preempted in Wave 0 by Plan 18-04)
- `bash scripts/verify-eval.sh` 5/5 floors green

Snapshot: `.planning/phases/18-jarvis-ptt-cross-app/18-12-STATIC-GATES.md` (commit `657a268`)

**Task 2 — cold-install demo: DEFERRED.**

Operator decision on 2026-04-30: lacks the API keys (Linear PAT / Slack OAuth / Gmail OAuth / GitHub PAT) required to drive the JARVIS-12 e2e cold-install demo end-to-end. Without creds in keyring, the dispatcher falls through to `HardFailedNoCreds` per D-10 — which is the documented behavior, but it doesn't exercise the success path.

This is a documented operator-blessed deviation from the JARVIS-12 success criterion. The chat → consent → real outbound write loop is **architecturally complete** (43/43 cross-module unit tests prove the contract: intent classification → args extraction → consent gate → tokio::oneshot → 3-tier dispatch → ActivityStrip emission), but the end-to-end real-world write is not exercised in this run.

Risk position: same as Phase 17 — accept that runtime regressions in the integration glue (Tauri arg marshalling, frontend event wiring, async lifetime issues across the oneshot channel) could ship undetected. The unit-test coverage mitigates the most likely failure modes (logic / type errors / regex bugs / consent persistence).

**Task 3 — VERIFICATION.md: SKIPPED.** No standalone verification doc; this SUMMARY + per-plan SUMMARY chain (18-01..18-11 + 18-13 + 18-14) + static-gate snapshot provide the audit trail.

## Phase 18 close

| REQ | Status | Evidence |
|-----|--------|----------|
| JARVIS-01 (PTT global hotkey) | DEFERRED to v1.3 | `18-DEFERRAL.md` per CONTEXT D-01 |
| JARVIS-02 (Whisper STT) | DEFERRED to v1.3 | `18-DEFERRAL.md` per CONTEXT D-01 |
| JARVIS-03 (intent classification) | code complete | intent_router::classify_intent — heuristic-first; D-04 Step 2 LLM-fallback DEFERRED to v1.3 (path B) |
| JARVIS-04 (cross-app dispatch) | code complete | jarvis_dispatch::dispatch + 3 outbound tentacles + Linear/Calendar wired |
| JARVIS-05 (per-action consent) | code complete | consent.rs SQLite + tokio::oneshot in Plan 18-14 Task 3 |
| JARVIS-06 (ego refusal regex) | code complete | ego.rs ships 9 patterns + disjunction post-check |
| JARVIS-07 (capability_gap → auto_install) | code complete | ego::handle_refusal calls self_upgrade::auto_install |
| JARVIS-08 (retry cap = 1 per turn) | code complete | RETRY_COUNT atomic + reset_retry_for_turn at function entry |
| JARVIS-09 (browser-harness Q1 closed) | code complete | research/questions.md Q1 RESOLVED with verdict "always require explicit consent" |
| JARVIS-10 (ActivityStrip emission) | code complete | D-17 format `[JARVIS] {intent}: {service} → {outcome}` in dispatcher |
| JARVIS-11 (inline JARVIS pill) | code complete | JarvisPill.tsx + MessageList integration via useTauriEvent |
| JARVIS-12 (cold-install demo) | DEFERRED runtime | Architecturally complete; e2e demo deferred per operator API-key constraint |

**Closure decision:** Phase 18 marked complete in STATE.md and ROADMAP.md. JARVIS module ships as code-complete; runtime cold-install demo is a deferred item on the v1.2 ledger alongside Phase 17's deferred UI-polish UAT.

---

*Phase 18 closed 2026-04-30 with explicit operator deferral of cold-install demo (operator lacks API keys for end-to-end exercise). The chat-first pivot continues — focus moves to Phase 19/20 or v1.2 milestone close.*
