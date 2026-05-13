---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: Hunt + Forge + OAuth Depth
status: in_progress
stopped_at: null
last_updated: "2026-05-13"
last_activity: 2026-05-13
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 12
  completed_plans: 0
  percent: 0
---

# STATE -- BLADE (v2.1 -- Hunt + Forge + OAuth Depth)

**Project:** BLADE -- Desktop JARVIS
**Current milestone:** v2.1 -- Hunt + Forge + OAuth Depth (polish + completion pass on v2.0)
**Prior shipped:** v2.0 (2026-05-13), v1.6 (2026-05-13), v1.5 (2026-05-08), v1.4 (2026-05-03), v1.3 (2026-05-02), v1.2 (2026-04-30), v1.1 (2026-04-27), v1.0 (2026-04-19)
**Next milestone:** v2.2 = either agent-native audit recs #2-10 (strategic architectural reframe) OR operator-dogfood-driven scope after v2.0/v2.1 external launch. TBD per operator preference.
**Current Focus:** v2.1 closes v2.0 rough edges per the carry-forward list. Deliberately defers items that need operator-dogfood signal (decision_gate threshold tuning, VISION-held trio) and items that are full architectural reframes (agent-native audit recs #2-10).

## Current Position

Phase 49 — Hunt Advanced + Cost Surfacing (NEXT — HUNT-05-ADV, HUNT-06-ADV, HUNT-COST-CHAT)
Phase 50 — OAuth Coverage (OAUTH-SLACK-FULL, OAUTH-GITHUB-FULL, OAUTH-TESTS)
Phase 51 — Forge Multi-Gap Robustness (FORGE-GAP-ARXIV/RSS/PYPI, FORGE-PROMPT-TUNING, FORGE-PRECHECK-REFINE)
Phase 52 — Close (CLOSE-01..04)

Last activity: 2026-05-13 — v2.0 closed; v2.1 scaffold landed immediately after. Continuing autonomous run pattern per V2-AUTONOMOUS-HANDOFF.md §4 (operator authorized "continue with the next milestone same way").

Progress: [░░░░░░░░░░] 0% (0/4 phases complete; scaffold landed)

```
49 [ ] Hunt Advanced + Cost Surfacing       (NEXT)
50 [ ] OAuth Coverage                       (Slack + GitHub full)
51 [ ] Forge Multi-Gap Robustness           (arXiv + RSS + PyPI gaps)
52 [ ] Close
```

## Project Reference

See: `.planning/PROJECT.md`

**Core value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.
**Current focus:** Polish + completion pass before external launch. Operator-dogfood items + architectural reframes deferred to v2.2+.

## Performance Metrics (v2.0 close baseline)

| Metric | Value |
|--------|-------|
| Verify gates | 37/38 green (OEVAL-01c v1.4 carry-forward) |
| Forge e2e tests | 5/5 pass |
| OAuth Gmail integration tests | 3/3 pass |
| TypeScript status | tsc --noEmit clean |
| Rust status | cargo check clean |

## Accumulated Context

From v2.0 close:
- Install pipeline + agentic hunt onboarding + one forge wire end-to-end
- Hunt: pre_scan + LLM-driven hunt + sandboxed tools + synthesis to ~/.blade/who-you-are.md
- Forge: HackerNews gap fires visibly with 5 chat-line emissions; 5/5 e2e tests pass; pre_check_existing_tools in place
- OAuth: Gmail full + 3/3 mock-server tests; Slack + GitHub stubs for v2.1
- README rewritten with install command + manual download subsection

For v2.1 work:
- HUNT-05-ADV: answer-driven probing chain (basic sharp-question + answer → BLADE probes for matches based on the answer)
- HUNT-06-ADV: contradiction-detection (cluster findings thematically; surface conflicts as specific question)
- HUNT-COST-CHAT: live cost surfacing for hunt + forge
- OAuth Slack + GitHub: full implementations matching Gmail's shape
- Forge multi-gap: arXiv + RSS + PyPI fixtures + integration tests + prompt tuning + pre-check refinement

## Risk Register (v2.1)

See `.planning/ROADMAP.md` Risk Register section.

## Notes

- Wake conditions unchanged per V2-AUTONOMOUS-HANDOFF.md §7
- Static gates green = close bar per §1; runtime UAT operator-owned
- OEVAL-01c v1.4 carry-forward persists from v1.5/v1.6/v2.0
- git tags v1.6, v2.0 created locally last session. Push will batch at v2.1 close (operator confirmation).

---

*Last updated: 2026-05-13 — v2.1 scaffold landed.*
