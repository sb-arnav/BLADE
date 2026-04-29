---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Acting Layer with Brain Foundation
current_phase: 16
status: in_progress
last_updated: "2026-04-29T20:20:02Z"
last_activity: 2026-04-29 -- Plan 16-02 (synthetic hybrid-search eval) shipped; Wave 2 progressing 1/5; asserted 8/8 floor preserved
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 7
  completed_plans: 2
  percent: 28
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 16 (Eval Scaffolding Expansion) — Wave 1 complete + Wave 2 in progress (2/7 plans)
**Status:** Plan 16-02 (synthetic hybrid-search eval) shipped; harness consumer #1 live; remaining Wave 2 plans (16-03, 16-04, 16-05, 16-06) still parallel-ready

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

**Last session:** 2026-04-29T20:20:02Z (Plan 16-02 — synthetic hybrid-search eval — shipped; harness consumer #1 live)
**Next action:** Execute remaining Wave 2 plans — 16-03 (real_embedding_eval), 16-04 (kg_integrity_eval), 16-05 (typed_memory_eval), 16-06 (capability_gap_eval). All 4 are independent and can run in parallel; each imports `super::harness::*` from the harness shipped in Wave 1. Plan 16-07 (deletion of original `embeddings.rs:510-728`) waits for Wave 2 to finish.

**Context cliff notes:**

- v1.0 + v1.1 both shipped; substrate is reachable + observable + capability-aware
- 27 verify gates green; tsc clean
- v1.2 = 5 phases (16=Eval, 17=Doctor, 18=JARVIS+Ego, 19=Operator-UAT, 20=Polish)
- v1.2 acting work flips the per-tentacle observe-only guardrail with explicit consent + trust-tier escalation, never silently
- Activity log strip is the v1.1 contract every v1.2 cross-module action must honor
- Memory recall pipeline verified healthy 2026-04-28 (7/7 top-1, MRR 1.000) — eval pattern established

---

*State updated: 2026-04-29 — Plan 16-01 shipped (3 tasks / 3 commits / 7 files created / 1 file modified). Harness, EvalRow/EvalSummary, RR/MRR helpers, EVAL-06 box-drawing printer, temp_blade_env all live in `src-tauri/src/evals/harness.rs`. EVAL-01 marked complete in REQUIREMENTS.md. Wave 2 unblocked.*

*State updated: 2026-04-29T20:20Z — Plan 16-02 shipped (1 task / 1 commit / 1 file modified). `evals/hybrid_search_eval.rs` populated with 8 baseline + 3 adversarial fixtures (long content / unicode CJK+emoji / near-duplicate Tuesday-Wednesday). Asserted floor 8/8 holds (top-3 100%, MRR 1.000). EVAL-03 marked complete in REQUIREMENTS.md. Original `mod memory_recall_eval` block at `embeddings.rs:510-728` left in place — Plan 16-07 deletes it after Wave 2 finishes. Wave 2 progress: 1/5 plans (16-02 done; 16-03, 16-04, 16-05, 16-06 remain).*
