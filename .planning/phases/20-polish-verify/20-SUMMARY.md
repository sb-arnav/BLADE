---
phase: 20-polish-verify
status: complete
shipped: 2026-04-30
---

# Phase 20 — Polish + Verify Pass — SUMMARY

**Status:** complete · 6/6 POLISH-XX requirements satisfied.

## Outcome

| REQ | Evidence |
|-----|----------|
| POLISH-01 — `npm run verify:all` exit 0 | 31/31 sub-gates green (verify:emit-policy + verify:wiring-audit-shape + verify:tokens-consistency + verify:no-raw-tauri + verify:eval all pass) |
| POLISH-02 — `cargo check` clean | exit 0; 1 pre-existing `consent_check_at` testability-seam warning (Plan 18-14 carry-forward, not a regression) |
| POLISH-03 — `npx tsc --noEmit` clean | exit 0 |
| POLISH-04 — v1.2 CHANGELOG entry | `CHANGELOG.md` `### Added (v1.2 — Acting Layer with Brain Foundation)` block at top of `[Unreleased]` — mirrors v1.1 structure (Added / Deferred / Deleted), 89 commits since 2026-04-29 documented |
| POLISH-05 — milestone audit doc | `.planning/milestones/v1.2-MILESTONE-AUDIT.md` mirrors v1.1 audit pattern (3-source coverage table + tech_debt log + chat-first pivot annotation) |
| POLISH-06 — phase dirs archived | `.planning/phases/{16,17,18,19}-*` moved to `.planning/milestones/v1.2-phases/`. Phase 20 stays in active phases dir until milestone close commit lands. ROADMAP.md + REQUIREMENTS.md mirrored to `.planning/milestones/v1.2-{ROADMAP,REQUIREMENTS}.md` per v1.1 archive convention |

## Phase 20 was a docs-only phase

No new code surfaces. All work is verification confirmation + documentation:
- Verified static gates green via `cargo check` + `npx tsc --noEmit` + `npm run verify:all` + `bash scripts/verify-eval.sh` (all four exit 0).
- Wrote v1.2 CHANGELOG entry summarizing 4 phases (16/17/18 shipped + 19 deferred + this Phase 20).
- Wrote v1.2 milestone audit mirroring v1.1's `tech_debt` closure pattern with chat-first pivot annotation as load-bearing v1.3 context.
- Moved phase 16/17/18/19 directories to milestone archive.

## Closure

v1.2 ships with the same `tech_debt` status as v1.1 — all functional code complete; deferred-to-operator UAT items carry forward to v1.3 with explicit documented rationale. The chat-first pivot recorded 2026-04-30 is the dominant context for v1.3 phase planning.

**Next milestone:** v1.3 — chat-capability deepening + Phase 19 UAT close + voice resurrection + browser-harness adoption decision.
