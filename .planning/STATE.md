---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Phases
status: verifying
last_updated: "2026-04-30T16:14Z"
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 92
  completed_plans: 85
  percent: 92
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 18 in progress (chat-first reinterpretation per CONTEXT D-01..D-21). Wave 0 ✅ closed (Plans 18-01/02/03/04/13). Wave 1 in flight: Plan 18-05 ✅ shipped (ego.rs body — refusal detector + capability_gap classifier + retry orchestrator). Next: Plan 18-06 (consent.rs body — SQLite consent_decisions CRUD per D-08).
**Status:** Phase 18 Plan 18-05 of 14 complete (Wave 1 begun). Plan 05 filled the Wave 0 ego.rs skeleton with full bodies for `intercept_assistant_output` (9 refusal regex patterns: 5 mandatory D-12 + 3 stretch + 1 capability-gap precursor; disjunction-aware post-check `\bbut\b.+\bcan\b` within 80 chars suppresses false positives per Pitfall 8; CapabilityGap precedes Refusal per D-13), `handle_refusal` (D-14 retry cap = 1 per turn via `RETRY_COUNT.fetch_add` SeqCst with `prev >= 1` gate; CapabilityGap → emit intercepting → `evolution_log_capability_gap` → catalog lookup with key/_outbound/_write fallbacks → Runtime kind via live `self_upgrade::auto_install(&CapabilityGap)` returning InstallResult with `.success` routing OR Integration kind to D-15-locked HardRefused with `gap.integration_path`), and `emit_jarvis_intercept` (single-window `app.emit_to("main", "jarvis_intercept", ...)` per Phase 17 precedent — no allowlist entry needed; reason field bounded via safe_slice(200) per T-18-CARRY-14). 7 occurrences of D-15 locked phrase "I tried, but ..." across handle_refusal branches. 18 unit tests green: 8 pattern matches + disjunction suppress + however-can guard + helpful pass + 2 capability-gap + retry cap atomic + D-15 phrase guard + non-ASCII safe_slice + 2 carried skeleton tests. cargo check clean (warnings only on dead-code symbols consumed by Plan 18-10); verify:emit-policy clean (60 broadcast emits unchanged). 2 task commits (`1259bbb` Task 1 + `b44719a` Task 2); zero deviations beyond plan-allowed adoption of live auto_install signature.

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

**Last session:** 2026-04-30T16:12Z (Plan 18-05 ✅ shipped — Wave 1 ego.rs body; 2 task commits `1259bbb` + `b44719a` / +417 -28 net on `src-tauri/src/ego.rs`). REFUSAL_PATTERNS slot populated with 9 (Regex, label) tuples; Pattern 9 (`need_integration`) listed FIRST per D-13 CapabilityGap precedence; 5 mandatory + 3 stretch refusal patterns; disjunction-aware post-check via `static DISJUNCTION_POSTCHECK: OnceLock<Regex>` initialized to `\bbut\b.+\bcan\b` scanning 80-char lookahead from match.end(); safe_slice fallback for non-ASCII boundary cross. handle_refusal enforces D-14 retry cap = 1 per turn (RETRY_COUNT.fetch_add SeqCst returning previous value; prev >= 1 → HardRefused with retry_cap_exceeded reason); CapabilityGap branch emits intercepting → calls evolution_log_capability_gap (verbatim reuse of evolution.rs:1115) → catalog lookup with 3 key fallbacks (bare/_outbound/_write); Runtime kind routes through live `self_upgrade::auto_install(&CapabilityGap) -> InstallResult` (W2 pre-pin verified at self_upgrade.rs:387) with `.success` boolean check (NOT Result Ok/Err); Integration kind hard-refuses with D-15 locked format including `gap.integration_path`. emit_jarvis_intercept fires `app.emit_to("main", "jarvis_intercept", payload)` at every state transition (intercepting/installing/retrying/hard_refused) — single-window pattern matches blade_activity_log precedent, no allowlist entry needed; reason bounded via safe_slice(200) per T-18-CARRY-14. 7 occurrences of D-15 phrase "I tried, but ..." across all hard-refuse branches. 18 unit tests green (filtered 198): pattern_i_cant + pattern_no_access + pattern_not_able + pattern_cannot_directly + pattern_lack_the + pattern_as_an_ai + pattern_unable_to + pattern_no_capability + no_false_positive_on_but_can + no_false_positive_on_however_can + pass_on_helpful_response + capability_gap_precedes_refusal + capability_gap_extracts_capability_noun + retry_cap_holds + hard_refuse_format_locked + safe_slice_used_on_long_content + skeleton_compiles + reset_retry_works. cargo check clean (warnings on dead-code symbols `EgoOutcome` / `emit_jarvis_intercept` / `handle_refusal` consumed by Plan 18-10 commands.rs integration); npm run verify:emit-policy green (60 broadcast emits unchanged — single-window emit_to is exempt). Zero deviations beyond plan-allowed adoption of live auto_install signature. SUMMARY at `.planning/phases/18-jarvis-ptt-cross-app/18-05-SUMMARY.md`.
**Next action:** `/gsd-execute-plan 18-06` — consent.rs body (Wave 1 parallel candidate per D-08; SQLite consent_decisions table CRUD with allow_always | denied decisions persisted per (intent_class, target_service) tuple; consent_revoke_all command; reuses evolution.rs:1115 blade.db pattern). Then Plan 18-07 (intent_router IntentClass body — heuristic-first regex/keyword classifier + LLM-fallback haiku-class for ambiguous messages, returning ChatOnly | ActionRequired { service, action } | CapabilityGap per D-03/D-04). Wave 2 onward: 18-08/09 outbound tentacle bodies → 18-10 commands.rs integration (wires ego::reset_retry_for_turn at send_message_stream start; ego::intercept_assistant_output before chat_token loop; ego::handle_refusal on verdict ≠ Pass; replaces AutoInstalled.then_retried placeholder with actual LLM retry call result) → 18-11 jarvis_dispatch body → 18-12 cold-install demo + JARVIS-12 UAT screenshot.

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
