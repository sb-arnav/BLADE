---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: Hunt + Forge + OAuth Depth
status: complete
stopped_at: null
last_updated: "2026-05-13"
last_activity: 2026-05-13
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# STATE -- BLADE (v2.1 -- Hunt + Forge + OAuth Depth closed; v2.2 TBD)

**Project:** BLADE -- Desktop JARVIS
**Current milestone:** v2.1 -- Hunt + Forge + OAuth Depth ✅ Shipped 2026-05-13 (tech_debt — OEVAL-01c v1.4 carry-forward; v2.2+ follow-ups documented)
**Prior shipped:** v2.0 (2026-05-13), v1.6 (2026-05-13), v1.5 (2026-05-08), v1.4 (2026-05-03), v1.3 (2026-05-02), v1.2 (2026-04-30), v1.1 (2026-04-27), v1.0 (2026-04-19)
**Next milestone:** v2.2 = TBD. Three candidates per v2.1-MILESTONE-AUDIT.md "Next" section: (1) agent-native audit recs #2-10 architectural reframe; (2) operator-dogfood-driven scope after external launch; (3) hybrid. Operator picks at next session.
**Current Focus:** v2.1 closed. Polish + completion pass on v2.0 shipped. 13 commits across v2.1. Hunt onboarding + forge fixture catalog + OAuth coverage all advanced.

## Current Position

Phase 49 — Hunt Advanced + Cost Surfacing ✅ Shipped (HUNT-05-ADV, HUNT-06-ADV, HUNT-COST-CHAT)
Phase 50 — OAuth Coverage ✅ Shipped (OAUTH-SLACK-FULL, OAUTH-GITHUB-FULL, OAUTH-TESTS)
Phase 51 — Forge Multi-Gap Robustness ✅ Shipped (FORGE-GAP-ARXIV/RSS/PYPI, FORGE-PROMPT-TUNING, FORGE-PRECHECK-REFINE)
Phase 52 — Close ✅ Shipped (CLOSE-01..04)

Last activity: 2026-05-13 — v2.1 closed per V2-AUTONOMOUS-HANDOFF.md §4 autonomous pattern. Continuation authorized by operator ("continue with the next milestone same way if np"). Authority chain held throughout — no §7 wake conditions hit.

Progress: [██████████] 100% (4/4 phases complete)

```
49 [x] Hunt Advanced + Cost Surfacing       (SHIPPED 2026-05-13; 15 new tests; 4 new chat-line kinds)
50 [x] OAuth Coverage                       (SHIPPED 2026-05-13; 10/10 integration tests)
51 [x] Forge Multi-Gap Robustness           (SHIPPED 2026-05-13; 5 fixtures total; 8/8 e2e tests)
52 [x] Close                                (SHIPPED 2026-05-13)
```

## Performance Metrics (v2.1 close)

| Metric | Value |
|--------|-------|
| Verify gates | 37/38 green (OEVAL-01c v1.4 carry-forward) |
| Onboarding tests | 45/45 pass |
| Forge e2e tests | 8/8 pass (HN + arXiv + RSS + PyPI baseline) |
| OAuth integration tests | 10/10 pass (3 Gmail + 4 Slack + 3 GitHub) |
| TypeScript status | tsc --noEmit clean |
| Rust status | cargo check clean (3 pre-existing dead_code warnings) |

## Accumulated Context

From v2.1 close:
- Hunt onboarding handles fresh-machine + contradictory-signals cases. Sharp-question + answer-driven probing chain with `hunt_seed_search` sandboxed tool. Thematic contradiction-detection via second LLM pass on `cheapest_model`. Live cost surfacing with $3.00 default budget, 50% soft, 100% hard.
- 4 new chat-line kinds: `hunt_question`, `cost`, `cost_warning`, `cost_block`. Frontend `Hunt.tsx` renders them.
- OAuth: Slack full impl (no-refresh-token → NotSupported); GitHub full impl with device-code flow. Asymmetry: Slack + GitHub return typed `OAuthError`; Gmail still String (migration deferred to v2.2).
- Forge: 5 fixtures (HN + arXiv + RSS + PyPI + v1.3 youtube_transcript). `PreCheckOutcome` enum routes McpCatalogedNotInstalled → fire forge per user autonomy preference. Prompt tuned with explicit language anchors + library hints.
- 13 commits across v2.1.

For v2.2 candidate work:
- **Agent-native audit recs #2-10**: slash commands chat empty-state, `crud_tools!` macro, build-time codegen from `invoke()` registry, context injection fixes, prompts/dir migration. Per `compound-engineering:agent-native-architecture` skill.
- **Decision_gate per-source pulse threshold tuning** — wait for operator-dogfood signal
- **VISION-held-for-v2.0-evaluation trio** (Body Map / mortality-salience / Ghost Mode) — wait for operator-dogfood
- **Gmail OAuth error-type migration** to `OAuthError` (parity)
- **CDN bucket provisioning + shellcheck CI + Windows ARM64 binaries** — release-CI infrastructure
- **5th holdout forge gap** verification
- **Tauri-runtime emit assertions** for chat-lines (deferred since Phase 47)

## Risk Register (carry-forward to v2.2+)

- OEVAL-01c v1.4 organism-eval drift — persists
- v2.0 forge demo external interest unknown — falsification per decisions.md 2026-05-12 awaits external testing
- Pulse-thought near-silent until threshold-learning tunes — operator-dogfood signal

## Notes

- v2.1 closed at static-gates-green per V2-AUTONOMOUS-HANDOFF.md §1
- No §7 wake conditions hit during the autonomous run
- Authority chain held: VISION → V2-AUTONOMOUS-HANDOFF → v2.0-MILESTONE-AUDIT carry-forward → v2.1-REQUIREMENTS → execution
- git tags v1.6, v2.0, v2.1 all created locally. Push left for operator confirmation at session end.
- External launch readiness: v2.0 + v2.1 together = end-user-shippable substrate with polish. Real-host runtime UAT operator-owned.

---

*Last updated: 2026-05-13 — v2.1 milestone closed; autonomous run continuation complete.*
