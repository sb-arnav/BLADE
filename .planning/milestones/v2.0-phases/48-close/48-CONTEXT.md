# Phase 48 — v2.0 Close

**Milestone:** v2.0 — Setup-as-Conversation + Forge Demo
**Status:** Pending (gated on Phases 45, 46, 47)
**Requirements:** CLOSE-01..04
**Goal:** v2.0 milestone closed cleanly. CHANGELOG, audit, phase archive, README rewrite, git tag v2.0.

## Tasks

### CLOSE-01 — CHANGELOG v2.0 entry

- Top of `CHANGELOG.md`: new `## [2.0.0] -- <date>` section
- Cite all 20 REQ-IDs (INSTALL-01..07, HUNT-01..10, FORGE-01..03, CLOSE-01..04)
- Cite commit SHAs from Phases 45, 46, 47
- Note verify gate count: should remain ≥36/38 (OEVAL-01c v1.4 carry-forward documented)
- Note v2.0 = first end-user-shippable release per VISION's 4-primitive shape

### CLOSE-02 — Milestone audit

- `.planning/milestones/v2.0-MILESTONE-AUDIT.md` written
- 3-source cross-reference: VISION cut list (which v2.0 outcomes hit) ↔ REQUIREMENTS.md ↔ git log
- Cross-reference to `.planning/v2.0-onboarding-spec.md` falsification conditions — note which falsified, which haven't been tested yet
- Phase coverage table: each phase, status, plans complete, gates green
- Tech_debt array: OEVAL-01c carry-forward; any operator-deferred UAT; INSTALL-07 CDN-upload follow-up if not provisioned
- Executive verdict: PASS / TECH_DEBT / FAIL per `/gsd-audit-milestone` rubric

### CLOSE-03 — Phase archive

- `mv .planning/phases/45-install-pipeline .planning/milestones/v2.0-phases/`
- `mv .planning/phases/46-agentic-hunt-onboarding .planning/milestones/v2.0-phases/`
- `mv .planning/phases/47-forge-wire .planning/milestones/v2.0-phases/`
- `mv .planning/phases/48-close .planning/milestones/v2.0-phases/` (after audit signed off)
- Verify `cargo check` + `tsc --noEmit` + `npm run verify:all` all exit 0 to floor
- Snapshot ROADMAP.md + REQUIREMENTS.md to `.planning/milestones/v2.0-ROADMAP.md` + `.planning/milestones/v2.0-REQUIREMENTS.md`

### CLOSE-04 — README + MILESTONES + tag

- README rewrite:
  - Install command at the top (`curl|sh` for macOS+Linux, `iwr|iex` for Windows)
  - Agentic hunt onboarding section (replace any remaining "Smart Provider Setup" / "Smart Deep Scan" / "Onboarding Modal" framing)
  - Forge demo section with the gap chosen in Phase 47 + 30-second video link if hosted
- MILESTONES.md: change v2.0 entry status from `🔄 Active` to `✅ Shipped` with close date
- git tag `v2.0` pushed
- git push (push commits + tags to origin) — per V2-AUTONOMOUS-HANDOFF.md §8 step 4

## Success criteria

- [ ] CHANGELOG.md v2.0 entry shipped
- [ ] `.planning/milestones/v2.0-MILESTONE-AUDIT.md` written with PASS or TECH_DEBT verdict
- [ ] All 4 v2.0 phase folders archived
- [ ] README rewrite shipped (install command up top, hunt + forge documented)
- [ ] MILESTONES.md v2.0 entry shows ✅ Shipped
- [ ] git tag v2.0 pushed
- [ ] `verify:all` ≥36/38
- [ ] cargo check clean
- [ ] tsc --noEmit clean
- [ ] STATE.md updated showing v2.0 closed

## After this phase

v2.0 release shipped. End-users can install BLADE with one command, go through hunt onboarding, and witness the forge primitive fire on a real capability gap. The Twitter-video moment per VISION:40 is recordable.

v2.1+ scope (deferred):
- INSTALL-07 CDN provisioning if not done in Phase 45
- agent-native audit recs #2-10 (slash commands, crud_tools! macro, build-time codegen)
- Held-for-v2.0-evaluation trio (Body Map / mortality-salience / Ghost Mode) — evaluation outcome documented in v2.0 audit
- Multi-gap forge robustness
- decision_gate per-source pulse threshold tuning based on operator dogfood feedback
