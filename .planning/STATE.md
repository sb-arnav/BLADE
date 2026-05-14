---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: VISION-Close + Goose-Integrate + Launch-Ready
status: in_progress
stopped_at: null
last_updated: "2026-05-14"
last_activity: 2026-05-14
progress:
  total_phases: 9
  completed_phases: 0
  total_plans: 41
  completed_plans: 0
  percent: 0
---

# STATE -- BLADE (v2.2 -- VISION-Close + Goose-Integrate + Launch-Ready -- in progress)

**Project:** BLADE -- Desktop JARVIS
**Current milestone:** v2.2 -- VISION-Close + Goose-Integrate + Launch-Ready (scoped 2026-05-14, executing autonomously per V2-AUTONOMOUS-HANDOFF §4)
**Prior shipped:** v2.1 (2026-05-13), v2.0 (2026-05-13), v1.6 (2026-05-13), v1.5 (2026-05-08), v1.4 (2026-05-03), v1.3 (2026-05-02), v1.2 (2026-04-30), v1.1 (2026-04-27), v1.0 (2026-04-19)
**Next milestone:** v2.3 = TBD per operator-dogfood signal post-launch.
**Current Focus:** v2.2 scope locked 2026-05-14 after 5-agent parallel research swarm (ecosystem scan + Goose internals audit + memory architecture 2026 + BLADE internal audit vs VISION primitives + launch playbook). Executing 9 phases per V2-AUTONOMOUS-HANDOFF §4 pattern.

## Current Position

Phase 53 — Presence Narrative in Chat (PRESENCE-NARRATE) → about to dispatch
Phase 54 — Goose Provider Trait Adoption (GOOSE-PROVIDER) → queued (independent, can parallel)
Phase 55 — Goose SQLite Session Schema (GOOSE-SESSION) → queued (depends on 54)
Phase 56 — TELOS in Hunt Output (HUNT-TELOS) → queued (depends on 55)
Phase 57 — Skills as Markdown Directory (SKILLS-MD) → queued (independent)
Phase 58 — Embeddings Simplification (MEMORY-SIMPLIFY) → queued (independent)
Phase 59 — Held-Trio Reorganize (TRIO-REORG) → queued (depends on 53)
Phase 60 — Launch Demo Prep (LAUNCH-PREP) → queued (depends on 53 + 56 + 57)
Phase 61 — Close (CLOSE) → queued (depends on all)

Last activity: 2026-05-14 — v2.2 scope locked per V2-AUTONOMOUS-HANDOFF.md §4 autonomous pattern. Continuation authorized by operator ("Improve this system I gave you use gsd or whatever - go run autonomously"). Authority chain: VISION → V2-AUTONOMOUS-HANDOFF → v2.1-MILESTONE-AUDIT carry-forward → v2.2-REQUIREMENTS.

Progress: [          ] 0% (0/9 phases complete)

```
53 [ ] PRESENCE-NARRATE         (presence observable in chat — fifth-primitive load-bearing)
54 [ ] GOOSE-PROVIDER           (adopt Provider trait + canonical_models.json — 1,700 models)
55 [ ] GOOSE-SESSION            (adopt SQLite session schema — continuity foundation)
56 [ ] HUNT-TELOS               (setup-as-conversation produces optimization target)
57 [ ] SKILLS-MD                (~/.blade/skills/ directory + OpenClaw pattern + 5 seed skills)
58 [ ] MEMORY-SIMPLIFY          (kill embeddings.rs vector layer, BM25 + KG)
59 [ ] TRIO-REORG               (Body Map / mortality-salience / Ghost Mode → /dev-tools pane)
60 [ ] LAUNCH-PREP              (forge demo script + README + HN post + Miessler DM + Twitter)
61 [ ] CLOSE                    (CHANGELOG + audit + archive + tag v2.2)
```

## Research substrate (2026-05-14)

5 parallel research agents synthesized outputs:

- **Ecosystem scan**: BLADE's lane (standalone Tauri + Rust + multi-provider + agentic forge + presence) is open. Goose, Cline, OpenClaw, Open Interpreter converge on developer-execution; no one has BLADE's exact wedge. OpenFlux (210 stars) is the only Tauri-shape competitor and is a proof-of-concept.
- **Goose internals**: 100% Rust, Apache 2.0. Stealable pieces with clear effort estimates — Provider trait + canonical_models.json (week 1), SQLite SessionManager (week 1), Recipes YAML engine (week 2-3, deferred). MCP client mid-migration to `rmcp`; wait.
- **Memory architecture 2026**: At BLADE's personal scale (~100k facts, 7 typed categories, 1M-context models), BM25 + KG is competitive with hybrid. PAI v5 proved this in production. Zep's own paper supports it. Vector retrieval doesn't earn its weight at personal scale.
- **BLADE internal audit**: All 5 primitives have substrate code. Sharpest single gap — presence layer is complete internally but produces zero user-facing signal. Held-trio (Body Map / mortality-salience / Ghost Mode) still in code, never evaluated. Agent-to-agent intro missing. "Second time destroys it" memory depends on architecture that's fragile per VISION 136 — defer.
- **Launch playbook**: Twitter video + Show HN Mon/Tue 10-11am ET + 48h-ahead Miessler DM. README first line 8 words or fewer + literal install command above feature list. Demo: 75s unedited, real terminal, voice narration, no music.

## Accumulated Context

From v2.2 scope-lock:
- BLADE's defensible lane at the wedge is open — no funded competitor combines all 5 primitives in a standalone Tauri binary.
- Goose is rippable (Apache 2 Rust) for provider + session foundations; their MCP client is mid-migration so wait there.
- Embeddings vector layer is dead weight at personal scale — kill it, BM25 + KG covers retrieval.
- Presence is the load-bearing differentiation gap — substrate complete, user-facing narrative missing.
- Launch artifacts assemble in one phase; recording/posting is operator-owned.

For v2.3 follow-up:
- "Second time destroys it" memory rewrite — needs operator-dogfood signal
- Recipes YAML engine (Goose minijinja pattern) — defer behind presence + provider foundations
- Cline-style per-step approval gate — operator-dogfood verifies whether non-developer trust friction warrants it
- Context-gated privacy questions per VISION §44 — wait for trust primitive
- Held-trio full evaluation — needs real engagement data from launch
- CDN provisioning + Windows ARM64 + shellcheck CI — release-CI infrastructure separate concern
- Gmail OAuth error-type migration — v2.1 carry-forward, parity item

## Risk Register (carry-forward to v2.2 + beyond)

- OEVAL-01c v1.4 organism-eval drift — persists (carried from v1.4 through v2.1)
- v2.0 forge demo external interest unknown — falsification per decisions.md 2026-05-12 awaits external testing (v2.2 prepares the launch artifacts to test it)
- Memory architecture fragility (VISION 136) — defers "second time destroys it" to v2.3+

## Notes

- v2.2 scope-locked 2026-05-14 post-research-swarm per V2-AUTONOMOUS-HANDOFF.md §4
- Operator authorization: "Improve this system I gave you use gsd or whatever - go run autonomously"
- No §7 wake conditions expected; scope is locked and phases match dispatch pattern that worked in v1.6/v2.0/v2.1
- Authority chain: VISION → V2-AUTONOMOUS-HANDOFF → v2.1-MILESTONE-AUDIT carry-forward → v2.2-REQUIREMENTS → execution
- git tag v2.2 will be created at Close phase; push left for operator confirmation at session end per pattern

---

*Last updated: 2026-05-14 — v2.2 scope locked, executing autonomously.*
