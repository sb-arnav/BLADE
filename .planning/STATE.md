---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Phases
status: planning
last_updated: "2026-04-30T14:30:00.000Z"
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 92
  completed_plans: 80
  percent: 87
---

# STATE — BLADE (v1.2)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.2 — Acting Layer with Brain Foundation (5 phases, 16–20)
**Last shipped milestone:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27)
**Current Focus:** Phase 18 in progress (chat-first reinterpretation per CONTEXT D-01..D-21). Plan 18-01 + 18-02 ✅ shipped (Wave 0 scaffolding: 4 module skeletons + ecosystem WriteScope + CapabilityKind discriminator). Next: 18-03 (3 outbound tentacle skeletons) → continuing Wave 0.
**Status:** Phase 18 Plan 02 of 14 complete (Wave 0 progressing). Plan 02 extended ecosystem.rs with WRITE_UNLOCKS + WriteScope (RAII, 30s caller-supplied TTL, M-03 OBSERVE_ONLY preserved verbatim) + 2-arg assert_observe_only_allowed signature; extended self_upgrade.rs with CapabilityKind { Runtime | Integration } discriminator (#[serde(default)] back-compat) + 5 Integration catalog entries (slack/github/gmail/calendar/linear outbound) + auto_install Integration short-circuit. +6 unit tests all green; cargo check clean; doctor 35-test reader unaffected (verified via --test-threads=1). Phase 17 prior status preserved: code complete, runtime UAT deferred per operator chat-first pivot.

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

**Last session:** 2026-04-30T14:30Z (Plan 18-02 ✅ shipped — Wave 0 ecosystem.rs WriteScope + self_upgrade.rs CapabilityKind; 2 task commits 91d2d48 + e48b9ec / +323 net insertions / +6 unit tests all green / cargo check clean / doctor 35-test reader unaffected). Per-tentacle write-window guardrail: WRITE_UNLOCKS: OnceLock<Mutex<HashMap<String, Instant>>> + WriteScope RAII Drop guard with caller-supplied 30s TTL coexisting with global OBSERVE_ONLY (M-03 preserved verbatim, line 17 unchanged). assert_observe_only_allowed signature changed from 1-arg to 2-arg (tentacle, action) atomically (only the existing test caller required updating). CapabilityKind { Runtime | Integration } enum with #[serde(rename_all="snake_case")] + Default=Runtime impl; CapabilityGap struct extended with kind + integration_path fields, both #[serde(default)] for back-compat with Phase 17 reader. 16 existing Runtime catalog entries got explicit kind/integration_path fields (BLADE struct-literal convention); 5 new Integration entries (slack_outbound, github_outbound, gmail_outbound, calendar_write, linear_outbound) added. auto_install short-circuits on Integration kind before shell-out (defense-in-depth: install_cmd also empty). One pre-existing doctor parallel-run flake surfaced (BLADE_CONFIG_DIR env-var leak between tests) — not from this plan; verified all 35 doctor tests green with --test-threads=1.
**Next action:** `/gsd-execute-plan 18-03` — Wave 0: 3 outbound tentacle skeletons (slack_outbound, github_outbound, gmail_outbound). Then Plan 04 (BLADE_EVENTS + payloads.ts) → 13 (deferral doc) → Wave 1 body fills (05/06) → Wave 2 (07/08) → Wave 3 (09 dispatch) → Wave 4 (10/11/14 wiring) → Wave 5 (12 verification + cold-install demo).

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
