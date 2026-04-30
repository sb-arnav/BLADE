---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Phases
status: planning
last_updated: "2026-04-30T15:38:28.000Z"
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 92
  completed_plans: 83
  percent: 90
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 18 in progress (chat-first reinterpretation per CONTEXT D-01..D-21). Plans 18-01 + 18-02 + 18-03 + 18-04 + 18-13 ✅ shipped (Wave 0 complete: 4 module skeletons + ecosystem WriteScope + CapabilityKind discriminator + 3 outbound tentacle skeletons + frontend event surface + 10-WIRING-AUDIT.json preempt + 18-DEFERRAL.md ledger). Next: 18-05 (intent_router IntentClass body — heuristic-first + LLM-fallback classifier per D-03/D-04). Wave 1 begins with Plans 18-05/18-06 (intent_router + consent bodies).
**Status:** Phase 18 Plan 13 of 14 complete (Wave 0 closed). Plan 13 shipped `18-DEFERRAL.md` (85 lines, single docs commit `0487fd4`) — formal phase-wide deferral ledger covering JARVIS-01 (PTT global hotkey) + JARVIS-02 (Whisper STT) deferred to v1.3 per CONTEXT D-01 operator chat-first pivot. Doc captures: REQ-wording table with REQUIREMENTS.md:48-49 quotes; v1.3 hand-off shape via two pseudo-pipelines (chat-first now / voice-resurrected later) proving dispatcher signature is voice-source-agnostic — `transcript: String` flows from either typed message or whisper_local.rs::transcribe(audio_bytes) with same `intent_router::classify_intent(...)` consumer; 3-row Files-NOT-Wired table (voice_global.rs / whisper_local.rs / voice.rs all verified present in tree at /home/arnav/blade/src-tauri/src/, ready for v1.3); JARVIS-12 chat-first reinterpretation per D-21; cross-reference triple (CONTEXT D-01 + chat-first pivot memory + Plan 12 verification matrix). v1.3 voice resurrection scoped at 1 plan / 1-2 tasks (3 narrow wiring deltas: re-enable PTT register, build with `local-whisper` feature flag, hand transcript to existing classify_intent). Status table reserves trailing row for Plan 14 Task 4 to append the D-04 Step 2 LLM-fallback deferral (path B — heuristic-only suffices for v1.2). All 11 acceptance criteria checks green (DEFERRED ×2, JARVIS-01 ×6, JARVIS-02 ×6, voice_global.rs ×4, transcript: String ×2, v1.3 hand-off ×1, zero-rework ×2, frontmatter status:deferred + deferred_reqs both present, 85 lines ≥ 60 min_lines). No code touched.

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

**Last session:** 2026-04-30T15:38Z (Plan 18-13 ✅ shipped — Wave 0 deferral doc; 1 task commit `0487fd4` / +85 net insertions). 18-DEFERRAL.md created at `.planning/phases/18-jarvis-ptt-cross-app/18-DEFERRAL.md` with frontmatter `status: deferred` + `deferred_reqs: [JARVIS-01, JARVIS-02]` + `target_milestone: v1.3`. Documents JARVIS-01 (PTT global hotkey) + JARVIS-02 (Whisper STT) deferred to v1.3 per CONTEXT D-01 chat-first pivot. v1.3 hand-off shape proven via two pseudo-pipelines: chat-first now (`useChat send → commands.rs send_message_stream → intent_router::classify_intent(message) → jarvis_dispatch::dispatch_action(intent) → outbound write`) vs voice-resurrected later (`PTT hotkey → voice_global.rs captures audio → whisper_local.rs returns transcript: String → intent_router::classify_intent(transcript) → jarvis_dispatch::dispatch_action(intent) UNCHANGED → outbound write UNCHANGED`) — only delta is the 3-step input adapter (re-enable voice_global PTT register / build with local-whisper feature flag / hand transcript to existing classify_intent). 3-row Files-NOT-Wired table verified all 3 voice files present in tree (voice_global.rs / whisper_local.rs behind `local-whisper` feature flag / voice.rs fallback STT path). JARVIS-12 chat-first reinterpretation per D-21 (operator types into chat → consent dialog → real Slack/etc. write → screenshot at `docs/testing ss/jarvis-cold-install-demo.png`). Trailing slot reserved for Plan 14 Task 4 to append D-04 Step 2 LLM-fallback deferral row — 18-DEFERRAL.md is the phase-wide deferral ledger. Plan 12 (verification, Wave 5) will cross-link this file in JARVIS-01/02 rows of the per-REQ status matrix (forward reference is intentional per ROADMAP wave ordering). All 11 acceptance criteria green; zero deviations; no code touched.
**Next action:** `/gsd-execute-plan 18-05` — Wave 1 begins: intent_router IntentClass body (heuristic-first regex/keyword classifier + LLM-fallback haiku-class for ambiguous messages, returning ChatOnly | ActionRequired { service, action } | CapabilityGap per D-03/D-04). Plan 06 (consent body) parallel candidate. Then Wave 2 (07/08 ego body — uses BLADE_EVENTS.JARVIS_INTERCEPT + JarvisInterceptPayload locked at Plan 04) → Wave 3 (09 dispatch — uses BLADE_EVENTS.CONSENT_REQUEST + ConsentRequestPayload locked at Plan 04) → Wave 4 (10/11/14 wiring incl. outbound tentacle bodies in Plans 11/12/13; Plan 14 Task 4 appends D-04 Step 2 LLM-fallback row to 18-DEFERRAL.md) → Wave 5 (12 verification + JARVIS-12 cold-install demo + populates 18-VERIFICATION.md cross-link target).

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
