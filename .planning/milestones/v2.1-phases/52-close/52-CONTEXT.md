# Phase 52 — v2.1 Close

**Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Status:** Pending (gated on Phases 49, 50, 51)
**Requirements:** CLOSE-01..04
**Goal:** v2.1 milestone closed cleanly. CHANGELOG, audit, archive, tag.

## Tasks

### CLOSE-01 — CHANGELOG v2.1 entry

- New `## [2.1.0] -- <date>` section at top of `CHANGELOG.md`
- Cite all REQ-IDs (HUNT-05-ADV, HUNT-06-ADV, HUNT-COST-CHAT, OAUTH-SLACK-FULL, OAUTH-GITHUB-FULL, OAUTH-TESTS, FORGE-GAP-ARXIV, FORGE-GAP-RSS, FORGE-GAP-PYPI, FORGE-PROMPT-TUNING, FORGE-PRECHECK-REFINE, CLOSE-01..04)
- Cite commit SHAs from Phases 49, 50, 51

### CLOSE-02 — Milestone audit

- `.planning/milestones/v2.1-MILESTONE-AUDIT.md` written
- 3-source cross-reference: ROADMAP success criteria ↔ REQUIREMENTS.md ↔ git log
- Tech_debt array: OEVAL-01c carry-forward, any operator-deferred items
- Verdict: PASS / TECH_DEBT / FAIL per `/gsd-audit-milestone` rubric

### CLOSE-03 — Phase archive

- `mv .planning/phases/49-hunt-advanced .planning/milestones/v2.1-phases/`
- `mv .planning/phases/50-oauth-coverage .planning/milestones/v2.1-phases/`
- `mv .planning/phases/51-forge-multi-gap .planning/milestones/v2.1-phases/`
- `mv .planning/phases/52-close .planning/milestones/v2.1-phases/`
- Snapshot ROADMAP.md + REQUIREMENTS.md to `.planning/milestones/v2.1-*.md`
- cargo check + tsc --noEmit + verify:all all exit 0 to floor

### CLOSE-04 — README + MILESTONES + tag

- README updates if user-visible — likely minor since v2.1 is polish/completion
- MILESTONES.md: v2.1 entry as ✅ Shipped
- git tag `v2.1` locally (push left to operator confirmation per v2.0 pattern)

## Success criteria

- [ ] CHANGELOG.md v2.1 entry shipped
- [ ] `.planning/milestones/v2.1-MILESTONE-AUDIT.md` written
- [ ] All 4 v2.1 phase folders archived
- [ ] cargo + tsc + verify:all to floor
- [ ] git tag v2.1
- [ ] STATE.md updated

## After this phase

v2.1 = polish + completion. Next:
- v2.2 could be agent-native audit recs #2-10 (the strategic reframe) if operator wants the architectural project
- Or v2.2 = operator-dogfood-driven scope after v2.0/v2.1 ships externally and produces engagement data
- Held-for-v2.0-evaluation trio (Body Map / mortality-salience / Ghost Mode) still pending operator-dogfood signal
