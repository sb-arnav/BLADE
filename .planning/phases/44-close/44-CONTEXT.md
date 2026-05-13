# Phase 44 — v1.6 Close

**Milestone:** v1.6 — Narrowing Pass
**Status:** Pending (gated on Phases 40-43)
**Requirements:** CLOSE-01..04
**Goal:** v1.6 milestone closed cleanly. CHANGELOG entry, milestone audit doc, phase archive, README scope-narrowing update, git tag v1.6.

## Tasks

### CLOSE-01 — CHANGELOG v1.6 entry

- Top of `CHANGELOG.md`: new `## v1.6 — Narrowing Pass (2026-05-13)` section
- Cite all 13 requirement IDs (DEL-01..07, REDUCE-01..06, CLOSE-01..04)
- Cite the 7 chore commit SHAs from Phase 39
- Cite Phase 40-43 reduction commits as they land
- Note verify gate count: 38 (held; OEVAL-01c v1.4 carry-forward documented)
- Note the retroactive-scaffold nature of Phase 39

### CLOSE-02 — Milestone audit

- `.planning/milestones/v1.6-MILESTONE-AUDIT.md` written
- 3-source cross-reference: VISION cut list ↔ REQUIREMENTS.md ↔ git log
- Phase coverage table: each phase, status, plans complete, gates green
- Tech_debt array: OEVAL-01c carry-forward; any operator-deferred UAT
- Executive verdict: PASS / TECH_DEBT / FAIL per `/gsd-audit-milestone` rubric

### CLOSE-03 — Phase archive

- `mv .planning/phases/39-vertical-deletions .planning/milestones/v1.6-phases/`
- `mv .planning/phases/40-always-on-to-on-demand .planning/milestones/v1.6-phases/`
- `mv .planning/phases/41-persona-auto-extraction-removal .planning/milestones/v1.6-phases/`
- `mv .planning/phases/42-background-agent-delegation .planning/milestones/v1.6-phases/`
- `mv .planning/phases/43-pulse-reduction .planning/milestones/v1.6-phases/`
- `mv .planning/phases/44-close .planning/milestones/v1.6-phases/` (after audit signed off)
- Verify `cargo check` + `tsc --noEmit` + `npm run verify:all` all exit 0
- Snapshot ROADMAP.md + REQUIREMENTS.md to `.planning/milestones/v1.6-ROADMAP.md` + `.planning/milestones/v1.6-REQUIREMENTS.md`

### CLOSE-04 — README + MILESTONES

- README: remove any claims about Financial Brain / Health Guardian / Security Fortress / Workflow Builder / Pentest as BLADE features (they're cut)
- README: do NOT add v2.0 forward-looking claims here — that's v2.0's job
- MILESTONES.md: change v1.6 entry status from `🔄 Active` to `✅ Shipped` with close date
- Possibly: short blurb at top of MILESTONES describing the narrowing rationale

### Git tag

- `git tag v1.6 && git push --tags` (after all of the above is committed)

## Success criteria

- [ ] CHANGELOG.md v1.6 entry shipped
- [ ] `.planning/milestones/v1.6-MILESTONE-AUDIT.md` written with PASS or TECH_DEBT verdict
- [ ] All 6 phase folders archived to `.planning/milestones/v1.6-phases/`
- [ ] README claims no longer mention cut verticals
- [ ] MILESTONES.md v1.6 entry shows ✅ Shipped
- [ ] git tag v1.6 pushed
- [ ] `verify:all` exits 0
- [ ] cargo check clean
- [ ] tsc --noEmit clean
- [ ] STATE.md updated showing v1.6 closed, next milestone = v2.0

## After this phase

`/gsd-new-milestone v2.0` to scaffold the next milestone (install pipeline + agentic hunt onboarding + one forge wire).
