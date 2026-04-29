---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Phases
status: "Plan 16-05 (typed-memory recall + cross-category isolation eval) shipped; fourth harness consumer live (7 categories + isolation gate); only 16-06 (capability-gap) remains in Wave 2"
last_updated: "2026-04-29T21:25:00Z"
progress:
  total_phases: 11
  completed_phases: 10
  total_plans: 71
  completed_plans: 70
  percent: 99
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 16 (Eval Scaffolding Expansion) — Wave 1 complete + Wave 2 in progress (5/7 plans)
**Status:** Plan 16-05 (typed-memory recall eval) shipped; fourth harness consumer live (7 categories round-trip + cross-category isolation regression gate, 8/8 rows pass, MRR 1.000); only 16-06 (capability-gap) remains in Wave 2

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

**Last session:** 2026-04-29T21:25:00Z (Plan 16-05 — typed-memory recall eval — shipped; fourth harness consumer live)
**Next action:** Execute the last Wave 2 plan — 16-06 (capability_gap_eval). Independent, imports `super::harness::*` from the harness shipped in Wave 1. Plan 16-07 (deletion of original `embeddings.rs:496-946` — both synthetic + real mods) waits for 16-06 to finish; once it ships, Wave 2 closes and Wave 3 can pick up the gate-closer.

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

*State updated: 2026-04-29T20:29Z — Plan 16-03 shipped (1 task / 1 commit / 1 file modified). `evals/real_embedding_eval.rs` populated (Wave 1 stub → 277 lines): 8-fact BLADE-shaped corpus + 7 natural-language scenarios moved verbatim from `embeddings.rs:730-946`, helpers swapped to `super::harness::*`. Floor preserved: 7/7 top-1, MRR 1.000 (matches 2026-04-28 baseline `9c5674a`). One Rule-3 deviation logged (inline 6-line `cosine_similarity` in smoke test rather than widening `embeddings::cosine_similarity` to `pub` — keeps `embeddings.rs` line count invariant at 946 for Plan 16-07's deletion arithmetic). EVAL-03 already marked complete by 16-02; this plan covers the real-fastembed half of the gate. Original `mod memory_recall_real_embedding` block at `embeddings.rs:730-946` left in place — Plan 16-07 deletes it. Wave 2 progress: 2/5 plans (16-02 + 16-03 done; 16-04, 16-05, 16-06 remain).*

*State updated: 2026-04-29T21:05Z — Plan 16-04 shipped (1 task / 1 commit / 1 file modified). `evals/kg_integrity_eval.rs` populated (Wave 1 stub → 284 lines): 5 fixture nodes (blade, tauri, rust, arnav, jarvis demo) inserted via `add_node`, 5 edges via `add_edge` (depends_on / related_to / part_of), 5 integrity dimensions asserted (round-trip / edge-endpoints-resolve / orphan-zero / idempotent-merge / edge-upsert-no-dup). All 5 dimensions pass; MRR 1.000. File-header documents the `consolidate_kg` REQ-vs-real resolution: the named function does not exist; REQ wording satisfied by `add_node`'s built-in idempotent-merge path (`knowledge_graph.rs:221-248`) — no re-export added. Test command: `cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` exits 0 with `┌── Knowledge graph integrity eval` table emitted. EVAL-02 marked complete in REQUIREMENTS.md. Wave 2 progress: 3/5 plans (16-02 + 16-03 + 16-04 done; 16-05, 16-06 remain).*

*State updated: 2026-04-29T21:25Z — Plan 16-05 shipped (1 task / 1 commit / 1 file modified). `evals/typed_memory_eval.rs` populated (Wave 1 stub 1 LOC → 206 LOC): 7 fixtures, one per `MemoryCategory` variant (Fact / Preference / Decision / Relationship / Skill / Goal / Routine), each round-tripped through `store_typed_memory` → `recall_by_category(cat, 10)` with strict `len() == 1` + content-substring + category-tag checks. Eighth assertion is the cross-category isolation regression gate: `recall_by_category(Fact)` excludes Preference content AND every returned row tags as `"fact"` — catches a future SQL edit dropping the `WHERE category = ?1` clause at `typed_memory.rs:282`. All 8 rows pass; MRR 1.000. Test command: `cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0 with `┌── Typed memory category recall eval` table emitted. EVAL-04 marked complete in REQUIREMENTS.md. Wave 2 progress: 4/5 plans (16-02 + 16-03 + 16-04 + 16-05 done; 16-06 capability-gap remains). Per-task commit `01d9ee1`.*
