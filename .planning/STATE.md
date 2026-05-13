---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: Narrowing Pass
status: complete
stopped_at: null
last_updated: "2026-05-13"
last_activity: 2026-05-13
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 13
  completed_plans: 13
  percent: 100
---

# STATE -- BLADE (v1.6 -- Narrowing Pass closed; v2.0 next)

**Project:** BLADE -- Desktop JARVIS
**Current milestone:** v1.6 -- Narrowing Pass ✅ Shipped 2026-05-13 (tech_debt — OEVAL-01c v1.4 carry-forward from v1.5)
**Prior shipped:** v1.5 (2026-05-08), v1.4 (2026-05-03), v1.3 (2026-05-02), v1.2 (2026-04-30), v1.1 (2026-04-27), v1.0 (2026-04-19)
**Next milestone:** v2.0 — Setup-as-Conversation + Forge Demo (operator runs `/gsd-new-milestone v2.0` to scaffold; per V2-AUTONOMOUS-HANDOFF.md §0 the autonomous chain may continue inline).
**Status:** v1.6 closed. CHANGELOG entry shipped; `milestones/v1.6-MILESTONE-AUDIT.md` shipped with PASS-with-tech_debt verdict; Phases 39-44 archived to `milestones/v1.6-phases/`. README narrowed-scope update landed; MILESTONES.md v1.6 entry marked Shipped. Authority chain: VISION.md (locked 2026-05-10) → V2-AUTONOMOUS-HANDOFF.md → executed without redirect.

## Current Position

Phase 39 — Vertical Deletions ✅ Shipped (7 commits retroactively wrapped)
Phase 40 — Always-On → On-Demand ✅ Shipped (REDUCE-02, REDUCE-03, REDUCE-04)
Phase 41 — Persona Auto-Extraction Removal ✅ Shipped (REDUCE-01)
Phase 42 — Background Agent Delegation ✅ Shipped (REDUCE-05)
Phase 43 — Pulse Reduction ✅ Shipped (REDUCE-06)
Phase 44 — Close ✅ Shipped (CLOSE-01..04)

Last activity: 2026-05-13 — v1.6 milestone closed per V2-AUTONOMOUS-HANDOFF.md §4 Step 1-3 + §0 close criteria. ~17,700 LOC removed from BLADE substrate. `pulse.rs` 1085→487 LOC. `decision_gate::evaluate` now gates proactive pulse emission. Background agent system delegates to user-installed CLIs only. Persona auto-extraction confirmed retired. Three perception loops flipped from default-on to default-off; on-demand paths preserved for LLM tool-use.

Progress: [██████████] 100% (6/6 phases complete)

```
39 [x] Vertical Deletions              (SHIPPED 2026-05-12/13)
40 [x] Always-On → On-Demand           (SHIPPED 2026-05-13)
41 [x] Persona Auto-Extraction Removal (SHIPPED 2026-05-13)
42 [x] Background Agent Delegation     (SHIPPED 2026-05-13)
43 [x] Pulse Reduction                 (SHIPPED 2026-05-13)
44 [x] Close                           (SHIPPED 2026-05-13)
```

## Project Reference

See: `.planning/PROJECT.md`

**Core value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.
**Current focus:** v1.6 closed. v2.0 next — Setup-as-Conversation + Forge Demo (install pipeline + agentic hunt + one forge wire).

## Performance Metrics (v1.6 close)

| Metric | Value |
|--------|-------|
| Verify gates | 37/38 green (OEVAL-01c v1.4 carry-forward documented) |
| Tests | 435+ baseline + 1 known failure (organism_eval::evaluates_organism) |
| Rust modules | 219 (was 241 — net 22 cut by Phase 39) |
| Frontend routes | 84 (was 89 — net 5 cut by Phase 39) |
| Pulse module LOC | 487 (was 1085 — net 598 cut by Phase 43) |
| TypeScript status | tsc --noEmit clean |
| Rust status | cargo check clean (3 dead_code warnings, pre-existing or out-of-scope) |
| v1.5 intelligence eval | 26/26 fixtures, MRR 1.000 |

## Accumulated Context

From v1.6 close:
- 7 verticals out: Financial Brain, Health Guardian, Security Fortress, Pentest Mode, Workflow Builder, deeplearn, Deep Scan
- Always-on perception loops flipped to default-off: Total Recall, Audio Timeline, observer-class tentacles
- Background agent system narrowed: BLADE delegates to user-installed Claude Code / Aider / Goose / Codex CLI / Continue.dev. Arbitrary script-spawn path cut.
- Pulse narrowed: daily-summary engine + morning-briefing engine cut. Cron primitive retained. Pulse-thought emission routed through `decision_gate::evaluate`.
- Persona auto-extraction from filenames + shell history confirmed retired (co-deleted with deep_scan in Phase 39). Chat-history-driven extraction path stays.
- 7 verify scripts updated to match deletion reality; wiring-audit JSON filtered to live state.

Held for v2.0:
- Steps.tsx → ApiKeyEntry → DeepScanReview → PersonaCheck onboarding flow → v2.0 Phase 1 (hunt onboarding replaces wholesale)
- Agent-native audit recs #2-10 → v2.0 phase shape (per decisions.md 2026-05-13)
- Body Map / Organ Registry / Pixel World / Tentacle Detail panes → v2.0 evaluation
- Mortality-salience implementation → v2.0 evaluation
- Ghost Mode invisible meeting overlay → v2.0 evaluation
- Frontend chat-line for `agent_auto_spawned` event → v2.0 forge demo phase
- Per-source `decision_gate` threshold for `"pulse"` tuning → v2.0 dogfood signal

For v2.0 (per V2-AUTONOMOUS-HANDOFF.md §0):
- Install pipeline (INSTALL-01..07): curl|sh + iwr|iex + WSL detection + upgrade-vs-fresh + xattr fix + fallback host
- Agentic hunt onboarding (HUNT-01..10): per .planning/v2.0-onboarding-spec.md Acts 1-7
- One forge wire (FORGE-01..03): the Twitter-video moment per VISION:40

## Risk Register (carry-forward for v2.0)

- OEVAL-01c v1.4 organism-eval drift — persists; document in v2.0 close audit too
- pulse-thought confidence (0.7) vs decision_gate per-source threshold (default 0.9) — current state is near-silent pulse stream; threshold-learning will tune over time. Revisit during v2.0 dogfood.

## Notes

- v1.6 closed at static-gates-green per V2-AUTONOMOUS-HANDOFF.md §1 (runtime UAT operator-owned, not phase-blocking)
- No wake conditions hit during the autonomous run (per §7)
- Authority chain held throughout: VISION.md → V2-AUTONOMOUS-HANDOFF.md → REQUIREMENTS.md → execution
- Wake conditions for v2.0 same as v1.6: GSD verifier BLOCKED twice on same phase after one self-fix; verify gates regress below 36/38 and code-fixer fails; authority gap

---

*Last updated: 2026-05-13 — v1.6 milestone closed.*
