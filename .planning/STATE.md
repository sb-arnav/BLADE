---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Setup-as-Conversation + Forge Demo
status: in_progress
stopped_at: null
last_updated: "2026-05-13"
last_activity: 2026-05-13
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 20
  completed_plans: 0
  percent: 0
---

# STATE -- BLADE (v2.0 -- Setup-as-Conversation + Forge Demo)

**Project:** BLADE -- Desktop JARVIS
**Current milestone:** v2.0 -- Setup-as-Conversation + Forge Demo
**Prior shipped:** v1.6 (2026-05-13), v1.5 (2026-05-08), v1.4 (2026-05-03), v1.3 (2026-05-02), v1.2 (2026-04-30), v1.1 (2026-04-27), v1.0 (2026-04-19)
**Current Focus:** v2.0 = 3 outcomes only per V2-AUTONOMOUS-HANDOFF.md §0: (1) install pipeline, (2) agentic hunt onboarding (replaces Steps wholesale), (3) one forge wire end-to-end (the Twitter-video moment per VISION:40). Scaffolded 2026-05-13 immediately after v1.6 close.
**Status:** v2.0 scaffold landed. Phase 45 (install pipeline) is next. Per V2-AUTONOMOUS-HANDOFF.md §4 Step 1, executing via the autonomous chain. Static-gates-green is the close bar per §1.

## Current Position

Phase 45 — Install Pipeline (NEXT — INSTALL-01..07)
Phase 46 — Agentic Hunt Onboarding (HUNT-01..10; rips Steps.tsx + ApiKeyEntry + DeepScanReview + PersonaCheck)
Phase 47 — One Forge Wire (FORGE-01..03; Twitter-video moment per VISION:40)
Phase 48 — Close (CLOSE-01..04)

Last activity: 2026-05-13 — v1.6 closed at `3bbbc89`, tagged v1.6 locally. v2.0 scaffold landed: REQUIREMENTS.md, ROADMAP.md, 4 phase CONTEXT.md files written. Next: dispatch Phase 45.

Progress: [░░░░░░░░░░] 0% (0/4 phases complete; scaffold landed)

```
45 [ ] Install Pipeline                    (NEXT)
46 [ ] Agentic Hunt Onboarding             (rips Steps wholesale)
47 [ ] One Forge Wire                      (Twitter-video moment)
48 [ ] Close
```

## Project Reference

See: `.planning/PROJECT.md`

**Core value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.
**Current focus:** Ship setup-as-conversation primitive + the forge demo. End-user shippable.

## Performance Metrics (v1.6 close baseline)

| Metric | Value |
|--------|-------|
| Verify gates | 37/38 green (OEVAL-01c v1.4 carry-forward) |
| Tests | 435+ baseline + 1 known failure (organism_eval::evaluates_organism) |
| Rust modules | 219 (post-v1.6 cuts) |
| Frontend routes | 84 (post-v1.6 cuts) |
| TypeScript status | tsc --noEmit clean |
| Rust status | cargo check clean |

## Accumulated Context

From v1.6 close:
- 7 verticals out; 6 always-on/agent paths converged
- `decision_gate` now mediates pulse-thought emission
- Background agent system delegates to user-installed CLIs only
- All on-demand command paths preserved for LLM tool-use
- 7 verify scripts aligned to deletion reality + wiring-audit JSON filtered to live state

For v2.0 (per V2-AUTONOMOUS-HANDOFF.md §0 + `.planning/v2.0-onboarding-spec.md` + `.planning/decisions.md` 2026-05-13):
- Install pipeline: curl|sh, iwr|iex, WSL detection (delegates Windows→WSL Claude Code paths to Phase 46's hunt), arch detection, upgrade-vs-fresh
- Agentic hunt: pre-scan (≤2s) → message #1 with "feels illegal but legal" register → LLM-driven hunt narrated live → synthesis to ~/.blade/who-you-are.md → onboarding closes by BLADE acting on a real task
- OAuth flows built + mock-server integration tested (per handoff §1: real auth happens per-user on their machine, not at build time)
- Forge: pick one real gap → wire chat-line emissions → end-to-end against real LLM
- Steps.tsx + ApiKeyEntry + DeepScanReview + PersonaCheck cut as part of Phase 46 (deferred from v1.6 per handoff §0 item 7)

## Risk Register (v2.0)

See `.planning/ROADMAP.md` Risk Register section.

## Notes

- **Wake conditions** unchanged per V2-AUTONOMOUS-HANDOFF.md §7: GSD verifier BLOCKED twice on same phase after one self-fix; verify gates regress below 36/38 and code-fixer fails; authority gap.
- **Static gates green is the close bar** per §1. Runtime UAT operator-owned.
- **OEVAL-01c v1.4 carry-forward** persists from v1.5/v1.6. Above the ≥36/38 floor.
- v1.6 tagged locally as `v1.6`. v2.0 will be tagged as `v2.0` at Phase 48 close. git push happens at v2.0 close per handoff §8 step 4.

---

*Last updated: 2026-05-13 — v2.0 scaffold landed; Phase 45 dispatch next.*
