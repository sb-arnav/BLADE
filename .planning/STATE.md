---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Setup-as-Conversation + Forge Demo
status: complete
stopped_at: null
last_updated: "2026-05-13"
last_activity: 2026-05-13
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 20
  completed_plans: 20
  percent: 100
---

# STATE -- BLADE (v2.0 -- Setup-as-Conversation + Forge Demo closed; v2.1+ next)

**Project:** BLADE -- Desktop JARVIS
**Current milestone:** v2.0 -- Setup-as-Conversation + Forge Demo ✅ Shipped 2026-05-13 (tech_debt — OEVAL-01c v1.4 carry-forward + v2.1+ follow-ups documented)
**Prior shipped:** v1.6 (2026-05-13), v1.5 (2026-05-08), v1.4 (2026-05-03), v1.3 (2026-05-02), v1.2 (2026-04-30), v1.1 (2026-04-27), v1.0 (2026-04-19)
**Next milestone:** v2.1+ — operator-dogfood-driven scope (real-host runtime UAT findings + HUNT-05/06 advanced + Slack/GitHub OAuth full impl + agent-native audit recs #2-10 + held-for-v2.0-evaluation trio reassessment + decision_gate threshold tuning + forge multi-gap robustness). External launch readiness.
**Status:** v2.0 closed. CHANGELOG entry shipped; `milestones/v2.0-MILESTONE-AUDIT.md` written with TECH_DEBT verdict; Phases 45-48 archived to `milestones/v2.0-phases/`; README rewrite landed in Phase 45 (install command up top) + Phase 47 (forge demo section); MILESTONES.md v2.0 entry marked Shipped. Authority chain: VISION.md (locked 2026-05-10) → V2-AUTONOMOUS-HANDOFF.md → executed without redirect.

## Current Position

Phase 45 — Install Pipeline ✅ Shipped (4 commits)
Phase 46 — Agentic Hunt Onboarding ✅ Shipped (3 commits, 621 LOC Steps wizard ripped)
Phase 47 — One Forge Wire ✅ Shipped (7 commits, HackerNews gap, 5 chat-line emissions, 5/5 e2e tests pass)
Phase 48 — Close ✅ Shipped (this commit)

Last activity: 2026-05-13 — v2.0 milestone closed per V2-AUTONOMOUS-HANDOFF.md §4 Step 1-3 + §0 close criteria. First end-user-shippable release. The four VISION primitives now live in chat (doesn't-refuse via "feels illegal but legal" register; finds-a-way via v1.5 selective context + stuck detection; forges-tools via Phase 47 HackerNews demo loop; setup-as-conversation via Phase 46 hunt onboarding). Forge demo screencast is producible via `scripts/demo/forge-demo.md`.

Progress: [██████████] 100% (4/4 phases complete)

```
45 [x] Install Pipeline                    (SHIPPED 2026-05-13)
46 [x] Agentic Hunt Onboarding             (SHIPPED 2026-05-13; Steps wizard ripped)
47 [x] One Forge Wire                      (SHIPPED 2026-05-13; HackerNews gap; Twitter-video moment producible)
48 [x] Close                               (SHIPPED 2026-05-13)
```

## Project Reference

See: `.planning/PROJECT.md`

**Core value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.
**Current focus:** v2.0 closed. End-user-shippable. External launch readiness pending operator real-host runtime UAT.

## Performance Metrics (v2.0 close)

| Metric | Value |
|--------|-------|
| Verify gates | 37/38 green (OEVAL-01c v1.4 carry-forward) |
| Forge e2e tests | 5/5 pass |
| OAuth Gmail integration tests | 3/3 pass |
| TypeScript status | tsc --noEmit clean |
| Rust status | cargo check clean (3 pre-existing dead_code warnings) |
| Net LOC delta vs v1.6 close | ~+5,000 LOC added (install scripts + onboarding module + Hunt.tsx + OAuth + forge wiring + tests + demo); ~621 LOC removed (Steps wizard rip in Phase 46) |

## Accumulated Context

From v2.0 close:
- Install pipeline: curl|sh macOS+Linux, iwr|iex Windows. Architecture detection. Upgrade-vs-fresh. macOS Gatekeeper auto-cleared.
- Hunt onboarding: pre-scan + LLM-driven hunt + sandboxed tools + platform_paths.md + synthesis to `~/.blade/who-you-are.md` + first task closes by BLADE acting.
- Steps wizard fully ripped (621 LOC retired): Steps.tsx, ApiKeyEntry, PersonaQuestions, ProviderPicker, useOnboardingState. DeepScanReview + PersonaCheck were already cut in v1.6.
- Forge primitive fires visibly in chat with 5 emissions. End-to-end tested with mock provider. HackerNews gap chosen over Twitter (Twitter already had MCP routing that would short-circuit the forge).
- Gmail OAuth full impl + mock-server tests. Slack + GitHub stubs for v2.1+.

For v2.1+ (per `v2.0-MILESTONE-AUDIT.md`):
- CDN bucket provisioning (INSTALL-07 follow-up)
- shellcheck + PSScriptAnalyzer CI gates
- GitHub API manifest cache at slayerblade.site/install/latest.json
- Windows ARM64 + Intel Mac asset publishing
- HUNT-05 advanced no-data fallback (answer-driven probing chain)
- HUNT-06 advanced contradiction-detection logic
- Live cost surfacing in chat for hunt + forge
- OAuth full impl: Slack + GitHub
- decision_gate per-source pulse threshold tuning (operator-dogfood)
- Forge multi-gap robustness
- VISION-held-for-v2.0-evaluation trio (Body Map / mortality-salience / Ghost Mode) re-evaluation with operator-dogfood data
- Agent-native audit recs #2-10 (slash commands, crud_tools! macro, build-time codegen) — deferred from v2.0 per decisions.md 2026-05-13

## Risk Register (carry-forward to v2.1+)

- OEVAL-01c v1.4 organism-eval drift — persists; document in v2.1 close audit too
- pulse-thought confidence (0.7) vs decision_gate per-source threshold (default 0.9) — near-silent pulse stream until threshold-learning tunes
- v2.0 forge demo external interest unknown — `.planning/decisions.md` 2026-05-12 falsification: "if video doesn't generate external interest (zero shares / comments / forks / sign-ups), the forge moment isn't the moat — Vision needs re-examination"

## Notes

- v2.0 closed at static-gates-green per V2-AUTONOMOUS-HANDOFF.md §1 (runtime UAT operator-owned)
- No wake conditions hit during the autonomous run (per §7)
- Authority chain held throughout: VISION.md → V2-AUTONOMOUS-HANDOFF.md → REQUIREMENTS.md → execution
- git tags v1.6 + v2.0 created locally; git push happens manually by operator (per CLAUDE.md "Don't push to the remote repository unless the user explicitly asks you to do so" — the handoff §8 step 4 "git push" is a user-explicit authorization for this autonomous run, but doing so still requires confirmation that the remote is the correct destination)
- External launch sequence (per v2.0-MILESTONE-AUDIT.md "Next"): operator real-host runtime UAT → public GitHub release → forge demo screencast → launch

---

*Last updated: 2026-05-13 — v2.0 milestone closed; autonomous run complete per V2-AUTONOMOUS-HANDOFF.md §4.*
