# Roadmap — BLADE

**Current Milestone:** v1.2 — Acting Layer with Brain Foundation
**Created:** 2026-04-29 | **Source:** `.planning/notes/v1-2-milestone-shape.md` (locked)
**Phases:** 16–20 (continues global numbering per M-05; v1.1 ended at Phase 15)
**Total target:** 10–12 days

---

## Milestones

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ Shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ Shipped (tech_debt) | 10–15 | 2026-04-27 |
| **v1.2** | **Acting Layer with Brain Foundation** | 🚧 **Active** | **16–20** | — |

---

## v1.2 Phases

| # | Phase | Goal | Requirements | Success Criteria | Days |
|---|---|---|---|---|---|
| 16 ✅ | **Eval Scaffolding Expansion** *(shipped 2026-04-29)* | Real eval harness in `tests/evals/` with floors enforced by `verify:all`. | EVAL-01..08 (8/8 REQs) | 4/4 SCs green: 5 eval modules @ MRR 1.000, verify:eval in chain (count 30→31), all `┌──` tables emit, DEFERRED.md w/ 4 v1.3 entries | 2 |
| 17 | **Doctor Module** | Central diagnostic aggregating eval scores + capability-gap log + tentacle health + drift signals. | DOCTOR-01..10 (10 REQs) | Doctor pane renders ≥5 signal classes; failing eval lights red end-to-end; auto-update presence reported | 2 |
| 18 | **JARVIS Push-to-Talk → Cross-App** | Demo moment v1.1 wired everything for; ego refusal-elimination folded in. | JARVIS-01..12 (12 REQs) | Cold install + consent → PTT → real cross-app action executed; ego intercepts refusal + retries once max | 4 |
| 19 | **Operator UAT Close** | 11 v1.1 carry-overs + HANDOFF-TO-MAC.md reconcile. | UAT-01..12 (12 REQs) | All 11 carry-overs evidenced (or re-deferred with rationale); v1.1 milestone-audit can re-run as `complete` | 2 |
| 20 | **Polish + Verify Pass** | Mop-up + changelog + audit doc. | POLISH-01..06 (6 REQs) | verify:all green; cargo check + tsc clean; v1.2 CHANGELOG entry; v1.2 audit doc | 1 |

**Total:** 5 phases, 48 requirements, 10–12 day target.

---

## Sequencing

```
   Phase 16 (eval scaffolding)
       │
       ▼
   Phase 17 (doctor)         ← consumes 16's eval signals
       │
       ▼
   Phase 18 (JARVIS + ego)   ← independent; benefits from doctor
       │
       ▼
   Phase 19 (operator UAT)   ← can run parallel to 18 if operator available
       │
       ▼
   Phase 20 (polish + verify)
```

**Parallelizable:** Phase 19 can run alongside Phase 18 if the operator is available — UAT items are evidence-collection, not code-blocked. Default sequencing is serial for predictable phase tracking.

---

## Phase Details

### Phase 16 — Eval Scaffolding Expansion

**Goal:** Extend the `memory_recall_real_embedding` baseline (commit `9c5674a`, 2026-04-28) into a full `tests/evals/` harness with floors enforced by `verify:all`.

**Requirements:** EVAL-01..08

**Plans:** 7 plans (Wave 1: harness scaffold; Wave 2: 5 parallel eval modules; Wave 3: gate-closer + cleanup)

Plans:
- [x] `16-01-harness-PLAN.md` — Wave 1: scaffold `evals/` module tree + shared harness (helpers, scored-table printer, temp-env). Covers EVAL-01. ✅ Shipped 2026-04-29 (commit `e6a0b02`).
- [x] `16-02-hybrid-search-eval-PLAN.md` — Wave 2: extract synthetic 4-dim eval from `embeddings.rs:510-728` + add 3 adversarial fixtures (long content, unicode, near-duplicate). Covers EVAL-03 (synth). ✅ Shipped 2026-04-29 (commit `bbdd0f6`); asserted 8/8 floor (top-3 100%, MRR 1.000) preserved.
- [x] `16-03-real-embedding-eval-PLAN.md` — Wave 2: extract real-fastembed eval from `embeddings.rs:748-946`. Covers EVAL-03 (real). ✅ Shipped 2026-04-29 (commit `c3005ed`); 7/7 top-1, MRR 1.000 (matches 2026-04-28 baseline).
- [x] `16-04-kg-integrity-eval-PLAN.md` — Wave 2: NEW knowledge-graph round-trip + orphan-zero + idempotent-merge eval. Covers EVAL-02. ✅ Shipped 2026-04-29 (commit `1a764d3`); 5/5 dimensions pass (round-trip / endpoints-resolve / orphan-zero / idempotent-merge / edge-upsert), MRR 1.000.
- [x] `16-05-typed-memory-eval-PLAN.md` — Wave 2: NEW 7-category typed-memory recall + cross-category isolation eval. Covers EVAL-04. ✅ Shipped 2026-04-29; 7/7 categories round-trip (Fact / Preference / Decision / Relationship / Skill / Goal / Routine) + cross-category isolation gate (`WHERE category` regression catcher), MRR 1.000.
- [x] `16-06-capability-gap-eval-PLAN.md` — Wave 2: NEW `detect_missing_tool` classifier eval (4 positive + 1 false-positive regression + 2 negative). Covers EVAL-05. ✅ Shipped 2026-04-29 (commit `d9a4d8e`); 7/7 cases pass (jq / ripgrep / node / ffmpeg + false-positive cargo-mentions-fd + 2 negative), MRR 1.000. Wave 2 closes.
- [x] `16-07-verify-eval-gate-PLAN.md` — Wave 3: ship `scripts/verify-eval.sh` + `tests/evals/DEFERRED.md` + `package.json` chain entry; delete `embeddings.rs:496-946`. Covers EVAL-06, EVAL-07, EVAL-08. ✅ Shipped 2026-04-29 (commits `e17f8ca` + `bf3311d` + `bcb7c57` + `438740f`); verify:all chain count 30 → 31; embeddings.rs shrunk 946 → 495 lines (-451). Phase 16 complete.

**Success criteria:**
1. `cargo test --lib evals` runs ≥4 eval modules with all green
2. `verify:eval` gate present in `verify:all` chain (count moves from 27 to 28+)
3. Each eval module prints scored stdout table in the existing format
4. `tests/evals/DEFERRED.md` documents LLM-API-dependent evals as v1.3 candidates

**Dependencies:** None — foundation phase.
**Blocks:** Phases 17, 20.

---

### Phase 17 — Doctor Module

**Goal:** New `doctor.rs` module + Diagnostics-tab Doctor pane aggregating signals from Phase 16 evals + existing `evolution.rs::evolution_log_capability_gap` + `pulse.rs` + `temporal_intel.rs` + tentacle health + config drift.

**Requirements:** DOCTOR-01..10

**Success criteria:**
1. 3 Tauri commands callable end-to-end (`doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`)
2. Doctor pane renders ≥5 distinct signal classes on fresh install
3. Artificially failing eval (Phase 16) lights up doctor surface red
4. `doctor_event` Tauri event emitted on regression
5. Auto-update presence check folded in as amber signal if `tauri-plugin-updater` not wired

**Plans:** 7 plans across 5 waves (Wave 0: harness scaffold + module skeleton; Waves 1–3: 5 signal sources + orchestrator; Wave 4: frontend pane; Wave 5: verification).

Plans:
- [x] `17-01-PLAN.md` — Wave 0: `harness::record_eval_run` + `tests/evals/.gitkeep` + `.gitignore`. Covers DOCTOR-02. **Shipped 2026-04-30** (commits `3e1e617`, `4174eef`).
- [x] `17-02-PLAN.md` — Wave 0: `doctor.rs` skeleton + 3 stubbed Tauri commands + `mod doctor;` registration + `integration_bridge::get_per_service_last_poll` accessor. Covers DOCTOR-01, DOCTOR-04. **Shipped 2026-04-30** (commits `0c1099c`, `4cc9ec0`, `1dcfb8b`).
- [x] `17-03-PLAN.md` — Wave 1: 3 signal sources (`compute_eval_signal`, `compute_capgap_signal`, `compute_autoupdate_signal`) + wire `harness::record_eval_run` into all 5 Phase 16 eval modules. Covers DOCTOR-02, DOCTOR-03, DOCTOR-10. **Shipped 2026-04-30** (commits `d416c4c`, `6e93fb0`, `1227c39`).
- [ ] `17-04-PLAN.md` — Wave 2: 2 signal sources (`compute_tentacle_signal`, `compute_drift_signal`) + verbatim UI-SPEC § 15 suggested-fix strings (D-18 lock). Covers DOCTOR-04, DOCTOR-05.
- [ ] `17-05-PLAN.md` — Wave 3: orchestrator body for `doctor_run_full_check` (tokio::join! + transition gate + emit_doctor_event + emit_activity_for_doctor) + `BLADE_EVENTS.DOCTOR_EVENT` + `DoctorEventPayload` TS interface. Covers DOCTOR-01, DOCTOR-06.
- [ ] `17-06-PLAN.md` — Wave 4: 3 type-safe Tauri wrappers + `admin-rich-c.css` (canonical tokens only) + `DoctorPane.tsx` + 5 surgical edits to `Diagnostics.tsx` (7th tab). Covers DOCTOR-01, DOCTOR-07, DOCTOR-08, DOCTOR-09.
- [ ] `17-07-PLAN.md` — Wave 5: verification — 7 static gates + `/blade-uat` 16-box checklist + 4 screenshots saved + Read back + `17-VERIFICATION.md`. Covers all DOCTOR-01..10.

**Dependencies:** Phase 16 (eval signals).
**Blocks:** Phase 20.

---

### Phase 18 — JARVIS Push-to-Talk → Cross-App Action

**Goal:** Ship the demo moment v1.1 wired everything for. Push-to-talk → natural-language command → cross-app action. Ego refusal-elimination layer folds in as post-processor.

**Requirements:** JARVIS-01..12

**Success criteria:**
1. Cold install + 1 user consent → PTT activated → real cross-app action executes (Slack post, GitHub PR comment, etc.)
2. Synthetic refusal in chat triggers ego intercept; either capability install or hard_refuse with logged reason
3. Ego retry cap holds (no infinite loops on persistent refusal)
4. Browser-harness Q1 closed in `research/questions.md` with verdict
5. Every JARVIS action emits to ActivityStrip (M-07 contract)

**Dependencies:** Phase 17 (doctor surfaces capability gaps that ego routes to).
**Blocks:** Phase 20.

---

### Phase 19 — Operator UAT Close

**Goal:** Close the 11 v1.1 carry-over UAT items (per `STATE.md ## Deferred Items` and `milestones/v1.1-MILESTONE-AUDIT.md`). Reconcile `HANDOFF-TO-MAC.md` deletion intent.

**Requirements:** UAT-01..12

**Success criteria:**
1. All 11 carry-overs have either green check + evidence file in `docs/testing ss/`, or re-deferred status with explicit rationale
2. v1.1 milestone-audit can re-run and emerge as status `complete` (currently `tech_debt`)
3. `HANDOFF-TO-MAC.md` reconciled (restored or formal "deleted intentionally" note)

**Dependencies:** Operator availability (real Windows machine with display) — can run parallel to Phase 18.
**Blocks:** Phase 20.

---

### Phase 20 — Polish + Verify Pass

**Goal:** Final mop-up. Verify-gate consolidation, cargo/TS clean, v1.2 changelog entry, v1.2 milestone audit doc.

**Requirements:** POLISH-01..06

**Success criteria:**
1. `npm run verify:all` green with all consolidated gates
2. `cargo check --no-default-features` clean (or CI-green if WSL env limit persists)
3. `npx tsc --noEmit` clean
4. v1.2 CHANGELOG.md entry follows v1.1 structure
5. `milestones/v1.2-MILESTONE-AUDIT.md` mirrors v1.1 audit pattern
6. Phase dirs 16–20 archived to `milestones/v1.2-phases/` on milestone close

**Dependencies:** Phases 16, 17, 18, 19 all complete.
**Blocks:** v1.2 milestone close.

---

## Coverage Validation

48 requirements (EVAL × 8 + DOCTOR × 10 + JARVIS × 12 + UAT × 12 + POLISH × 6) → 5 phases. **100% mapped, zero unassigned.** See `REQUIREMENTS.md ## Traceability` for the inverse mapping (REQ-ID → phase).

---

## Locked Decisions Carried Forward

From STATE.md (v1.1 close), still in force for v1.2 planning:

- **M-01** v1.2 acting work obeys the same anchor (no new features for new-features' sake) — held; JARVIS lands on top of v1.1 wiring, not as parallel substrate
- **M-03** Observe-only guardrail flips per-tentacle behind explicit user consent + trust escalation, never silently — JARVIS-05 enforces
- **M-05** Phase numbering continues globally — v1.2 = phases 16–20
- **M-07** Activity log is load-bearing — JARVIS-10 + DOCTOR-06 emit to ActivityStrip
- **D-01..D-45 + D-56/D-57** v1.0 stack decisions remain locked (no shadcn/Radix, no Framer Motion, no Zustand, no React Router, etc.)

---

## Earlier Milestones (archived)

### v1.1 — Functionality, Wiring, Accessibility (Phases 10–15)
✅ Shipped 2026-04-24, closed 2026-04-27. 6 phases, 29 plans, 27 verify gates green. See `milestones/v1.1-ROADMAP.md` for full detail.

### v1.0 — Skin Rebuild substrate (Phases 0–9)
✅ Shipped 2026-04-19. 10 phases, ~165 commits, 18 verify gates green. Phase dirs at `.planning/phases/0[0-9]-*` (never formally archived). See git history before commit `6a78538` for v1.0 REQUIREMENTS.

---

## Next Action

Phase 16 ✅ shipped 2026-04-29. Next:

`/gsd-discuss-phase 17` — gather context + clarify approach for Phase 17 (Doctor Module).

Or skip discussion: `/gsd-plan-phase 17` — plan directly.

---

*Roadmap created 2026-04-29 from locked shape `notes/v1-2-milestone-shape.md`. Updated by `/gsd-plan-phase` and `/gsd-transition` as phases progress. Phase 16 closed 2026-04-29 (7 plans, 19 commits, verify:all 31/31, MRR 1.000 across all eval modules).*
