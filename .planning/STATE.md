---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Phases
status: planning
last_updated: "2026-04-30T15:30:00.000Z"
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 92
  completed_plans: 82
  percent: 89
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 18 in progress (chat-first reinterpretation per CONTEXT D-01..D-21). Plans 18-01 + 18-02 + 18-03 + 18-04 ✅ shipped (Wave 0 scaffolding: 4 module skeletons + ecosystem WriteScope + CapabilityKind discriminator + 3 outbound tentacle skeletons + frontend event surface + 10-WIRING-AUDIT.json preempt). Next: 18-05 (intent_router IntentClass body — heuristic-first + LLM-fallback classifier per D-03/D-04). Wave 0 nearly complete; Wave 1 begins with Plans 18-05/18-06 (intent_router + consent bodies).
**Status:** Phase 18 Plan 04 of 14 complete (Wave 0 progressing). Plan 04 added BLADE_EVENTS.JARVIS_INTERCEPT + CONSENT_REQUEST constants (matching Phase 17 DOCTOR_EVENT precedent) + JarvisInterceptPayload + ConsentRequestPayload TS interfaces with snake_case wire form locked at the field level (intent_class / target_service / action_verb / content_preview / request_id) for the future Rust `#[serde(rename_all="snake_case")]` emit sites at ego.rs (Plan 18-08) and jarvis_dispatch.rs (Plan 18-14). Also preempted 10-WIRING-AUDIT.json with 7 new module entries (4 core: ego/intent_router/jarvis_dispatch/consent + 3 outbound tentacles: slack/github/gmail) using doctor.rs Phase 17 patch as verbatim template — modules.length 197 → 204 matching live .rs count, classification=ACTIVE, command names in `<module>::<command>` form per CommandName regex, invoked_from=null (no frontend consumer yet). Phase 17 Wave-5 gate-miss pattern preempted at Wave 0 per 18-RESEARCH Pitfall 6. tsc clean; verify-wiring-audit-shape all 5 checks OK; verify-emit-policy 60 broadcasts unchanged (no allowlist entry needed — emit_to("main", ...) single-window strategy).

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

**Last session:** 2026-04-30T15:30Z (Plan 18-04 ✅ shipped — Wave 0 frontend event surface + 10-WIRING-AUDIT.json preempt; 2 task commits ea34fbe + 708856b / +197 net insertions). BLADE_EVENTS gained JARVIS_INTERCEPT='jarvis_intercept' + CONSENT_REQUEST='consent_request' constants under Phase 18 banners (matching Phase 17 DOCTOR_EVENT precedent verbatim with 5-line section comments) AFTER DOCTOR_EVENT and BEFORE the closing `} as const;`. payloads.ts gained JarvisInterceptPayload (intent_class, action: 'intercepting'|'installing'|'retrying'|'hard_refused', capability?, reason?) + ConsentRequestPayload (intent_class, target_service, action_verb, content_preview, request_id) interfaces — snake_case wire form locked at field level matching future Rust `#[serde(rename_all="snake_case")]` (ghost-snake_case landmine from Phase 17 PATTERNS.md preempted). 10-WIRING-AUDIT.json gained 7 new entries (4 core: ego.rs/intent_router.rs/jarvis_dispatch.rs/consent.rs + 3 outbound tentacles: tentacles/slack_outbound.rs/github_outbound.rs/gmail_outbound.rs) using doctor.rs Phase 17 patch as verbatim template — modules.length 197→204 matches live .rs count (excluding evals/), classification=ACTIVE, command names in `<module>::<command>` form per CommandName regex, registered file:line points at command body declaration, invoked_from=null (no frontend consumer yet — Plan 17 will flip), internal_callers=[], reachable_paths populated. tsc --noEmit clean; verify-wiring-audit-shape all 5 checks OK (modules 204 ✓ / routes 88 ✓ / config 53 ✓ / not-wired 99 ✓ / dead 1 ✓); verify-emit-policy 60 broadcasts unchanged (no allowlist entry needed — emit_to("main", ...) single-window strategy follows doctor.rs precedent). Phase 17 entries (DOCTOR_EVENT, ACTIVITY_LOG, doctor.rs audit row) UNCHANGED.
**Next action:** `/gsd-execute-plan 18-05` — Wave 1 begins: intent_router IntentClass body (heuristic-first regex/keyword classifier + LLM-fallback haiku-class for ambiguous messages, returning ChatOnly | ActionRequired { service, action } | CapabilityGap per D-03/D-04). Plan 06 (consent body) parallel candidate. Then Plan 13 (deferral doc) → Wave 2 (07/08 ego body — uses BLADE_EVENTS.JARVIS_INTERCEPT + JarvisInterceptPayload locked here) → Wave 3 (09 dispatch — uses BLADE_EVENTS.CONSENT_REQUEST + ConsentRequestPayload locked here) → Wave 4 (10/11/14 wiring incl. outbound tentacle bodies in Plans 11/12/13) → Wave 5 (12 verification + JARVIS-12 cold-install demo).

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
