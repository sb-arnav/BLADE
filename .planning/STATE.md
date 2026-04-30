---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Self-extending Agent Substrate
status: in_progress
last_updated: "2026-04-30T22:30:00.000Z"
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# STATE — BLADE (v1.3 in progress)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.3 — Self-extending Agent Substrate (started 2026-04-30; target ship ~2026-05-11)
**Last shipped milestone:** v1.2 — Acting Layer with Brain Foundation (closed 2026-04-30 as `tech_debt`; chat-first pivot recorded mid-milestone)
**Prior shipped:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27 as `tech_debt`); v1.0 — Skin Rebuild substrate (closed 2026-04-19)
**Current Focus:** v1.3 just scoped. Phase 21 (Skills v2 / agentskills.io adoption) is the substrate-prerequisite phase — must land before Phase 22 (Voyager loop closure) can write SKILL.md outputs anywhere coherent. No phase plans written yet; ROADMAP.md + REQUIREMENTS.md are the next artifacts.
**Status:** Milestone scaffolding bootstrap in progress. PROJECT.md updated with v1.3 Current Milestone block + 5 new key decisions (M-08..M-12). REQUIREMENTS.md + ROADMAP.md to be written next. After scaffolding, kick off `/gsd-plan-phase 21` (or `/gsd-discuss-phase 21` if discuss preferred — config has `discuss_mode: discuss`, so workflow auto-routes).

## Current Position

Phase: 21 (Skills v2 / agentskills.io adoption) — not started, awaiting plan
Plan: —
Status: Defining requirements and roadmap
Last activity: 2026-04-30T22:30Z — v1.3 milestone scoped autonomously after operator handoff; Voyager-loop-led shape locked; PROJECT.md updated

---

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-30 at v1.3 milestone start)

**Core value:** BLADE works out of the box, you can always see what it's doing, **and it extends itself.** v1.3 ships the load-bearing piece — Voyager-pattern skill loop in production.

**v1.3 locked scope:** Skills v2 (agentskills.io) → Voyager loop closure → RLVR-style verifiable composite reward + OOD eval → dream_mode skill consolidation → Hermes 4 OpenRouter provider → JARVIS-01/02 voice resurrection → close. Organism layer (vitality/hormones/mortality), metacognitive controller, active-inference loop closure, persona shaping, immune cross-cutting layer, federation, Phase 19 UAT close → all deferred to v1.4 with explicit reasoning per steelman verdict.

**Locked inputs (read end-to-end during scoping):**
- `/home/arnav/research/blade/voyager-loop-play.md` — Voyager loop demo target (Wang et al, NeurIPS 2023) + sources
- `/home/arnav/research/blade/vs-hermes.md` — competitive positioning (Hermes = reactive learning; BLADE = proactive environmental + self-extending)
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` — seven-layer working thesis; v1.3 carves Layer 4 (memory + skills) deepest, defers Layers 0/2/3/5/6/7
- `/home/arnav/research/ai-substrate/blade-as-organism.md` — vitality/hormones/mortality framing (deferred to v1.4 per steelman)
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` — stress-test verdicts driving v1.3 design constraints (Arg 3 OOD coverage, Arg 4 anti-attachment, Arg 6 incremental layers, Arg 7 substrate-vulnerability mitigation)
- `/home/arnav/research/ai-substrate/open-questions-answered.md` — Q1 verifiable composite reward (becomes Phase 23); Q2 organism eval design (deferred); Q3 federation threat model (deferred); Q4 cross-cutting layers (deferred)
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — 2026-04-30 chat-capability over UI polish; load-bearing for v1.3 phase planning

---

## Recent Context

### Shipped milestones

- **v1.0** (2026-04-19) — Skin Rebuild substrate (10 phases, ~165 commits, 18 verify gates green); phase dirs at `.planning/phases/0[0-9]-*` (never formally archived; reference)
- **v1.1** (2026-04-24, closed 2026-04-27) — Functionality, Wiring, Accessibility (6 phases, 29 plans, 27 verify gates green); archived to `milestones/v1.1-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.1-phases/`
- **v1.2** (2026-04-29, closed 2026-04-30) — Acting Layer with Brain Foundation (5 phases scoped, 4 executed + 1 deferred wholesale, 22 plans, 31 verify gates green); archived to `milestones/v1.2-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.2-phases/`. Phase 20 polish dir retained at `.planning/phases/20-polish-verify/` (audit summary only)

### v1.2 Locked Decisions (still in force for v1.3 planning)

- **D-01 chat-first pivot** (2026-04-30) — chat-capability + tool reliability over UI polish; UI-only-phase UAT deferral pattern operator-blessed; v1.3 Voyager-loop-led shape directly extends this anchor (chat that writes its own tools = ultimate chat capability)
- **D-04 Step 2 LLM intent fallback** — deferred to v1.3+ as path B (heuristic-only suffices for v1.2 demo prompts); pull as Phase 22 dependency if Voyager-loop intent classification surfaces ambiguity
- **D-10 hard-fail format** locked — `[<tentacle>] Connect via Integrations tab → <Service> (no creds found in keyring)` — preserved across v1.3 outbound work
- **D-13 useTauriEvent hook only** — only permitted event subscription pattern in frontend
- **D-14 retry cap = 1 per turn** for ego layer; v1.3 must reset_retry_for_turn at function entry
- **D-15 hard-refuse format** locked — `I tried, but ...` + capability + integration_path; preserved across v1.3
- **D-20 browser-harness adoption** — deferred to v1.3 when Phase 18's chat-action spine measures where browser fallback is actually needed (Q1 closed in `research/questions.md`)
- **M-01** Wiring + smart defaults + a11y, NOT new features — held; v1.3 Voyager work is about closing existing substrate loops (evolution.rs/autoskills.rs/tool_forge.rs), not adding new tentacle classes
- **M-03** Observe-only guardrail (`OBSERVE_ONLY: AtomicBool`) — held; v1.3 doesn't flip new tentacles
- **M-05** Phase numbering continues globally — v1.3 starts at Phase 21
- **M-07** Activity log is load-bearing — every cross-module action in v1.3 must continue to emit; Voyager-loop activity (gap detected, skill written, skill registered, skill retrieved) all emit through ActivityStrip per the v1.1 contract

### v1.3 Locked Decisions (new this milestone)

- **M-08** Lead with Voyager loop (executable skill code), not Skills-v2-as-end-in-itself — substrate-level differentiator vs Hermes (procedural patterns) / OpenClaw (tools without skills) / Cursor (no skill library) / Open Interpreter (tool dispatcher only)
- **M-09** Organism layer (vitality/hormones/mortality) deferred to v1.4+ with safety bundle — without (mortality_salience cap + danger-triple detection + steering-toward-calm bias + eval-gate vitality drain) the layer is net-safety-negative per steelman Arg 4 + Arg 10
- **M-10** RLVR-style verifiable composite reward shipped at agent layer (Phase 23) — composite of skill_success/eval_gate/acceptance/completion per open-questions Q1; doesn't need to wait on Anthropic foundation-level continual learning
- **M-11** Skills format = agentskills.io SKILL.md (YAML+MD), not BLADE-specific JSON — ecosystem interop with Claude Code / OpenAI Codex / OpenClaw / clawhub
- **M-12** Phase numbering continues globally; v1.3 starts at Phase 21

### v1.0 Decisions Inherited

D-01..D-45 + D-56/D-57 remain locked. See `PROJECT.md` Key Decisions table.

---

## Deferred Items

Carried into v1.3 from v1.2 close (per `milestones/v1.2-MILESTONE-AUDIT.md`):

| Category | Phase | Item | Status | Notes |
|----------|-------|------|--------|-------|
| uat_gaps | 17 | Doctor pane runtime UI-polish UAT | deferred | UI-SPEC § 17 16-box checklist + 4 screenshots; deferred per chat-first pivot |
| uat_gaps | 18 | JARVIS-12 cold-install e2e demo | deferred | Operator API-key constraint (Linear/Slack/Gmail/GitHub creds); pulls into v1.3 if creds materialize |
| uat_gaps | 19 | UAT-01..12 (full Phase 19) | deferred | 12 v1.2 carry-overs + 11 v1.1 carry-overs all roll forward; revisit at v1.4 milestone-audit time |
| chat_spine | 18 | D-04 Step 2 LLM intent fallback | deferred | Heuristic suffices for v1.2 demo; pull as Phase 22 dependency if Voyager-loop classification needs it |
| chat_spine | 18 | Fast-streaming branch ego accumulator refactor | deferred | commands.rs:1166 fast path emits tokens without server-side accumulation; refactor required for ego on fast path; pull as dependency arises |
| advisory | 18 | Browser-harness Q1 adoption decision | deferred | Q1 closed conditionally per D-20; pull as Phase 22/24 chat-action work surfaces need |
| backlog | 10 | 97 DEFERRED_V1_2 backend modules | catalogued | v1.3 burn-down candidates as Voyager-loop work surfaces dependencies |

Carried forward unchanged from v1.1 deferred items:

| Category | Phase | Item | Status |
|----------|-------|------|--------|
| uat_gaps | 14 | Activity-strip cross-route persistence + drawer focus-restore + localStorage rehydrate-on-restart | partial |
| uat_gaps | 14 | Cold-install Dashboard screenshot | unknown |
| uat_gaps | 15 | RightNowHero cold-install screenshot + 5-wallpaper background-dominance + 1280×720 hierarchy + 50-route ⌘K sweep + spacing-ladder spot-check | unknown |
| advisory | 14 | LOG-04 time-range filter | not implemented |
| advisory | 11 | ROUTING_CAPABILITY_MISSING UI consumer | deferred |

### v1.0 Open Checkpoints (still operator-owned)

- Mac smoke M-01..M-46 — was tracked in `HANDOFF-TO-MAC.md` (formally deleted in v1.2 close per UAT-12; rationale captured in v1.2 CHANGELOG)
- Plan 01-09 WCAG checkpoint — Mac desktop environment
- WIRE-08 full `cargo check` — WSL libspa-sys/libclang env limit; CI green

---

## Blockers

None. v1.2 closed cleanly with documented tech debt; v1.3 scope locked by operator before sleep handoff.

---

## Session Continuity

**Last session:** 2026-04-30T22:30Z (v1.3 milestone scoped autonomously after operator handoff "going to sleep, run autonomously, don't fuckup or stop"). Inputs: `/gsd-new-milestone` invocation; instruction "I have some research at /arnav/research read them like READ them not just the names" → read 6 research docs end-to-end (voyager-loop-play, vs-hermes, synthesis-blade-architecture, blade-as-organism, steelman-against-organism, open-questions-answered) before re-shaping; instruction "idk why the research is stuck with demo and shit, but you have the data now decide and shape what to do and how" → shifted v1.3 framing from launch-anchored to substrate-anchored. Output: 7-phase v1.3 shape (21 Skills v2 → 22 Voyager loop closure → 23 verifiable reward + OOD eval → 24 dream_mode skill consolidation → 25 Hermes 4 provider → 26 voice resurrection → 27 close). Locked by operator: "Lock and proceed (Recommended)" before sleep. PROJECT.md updated with new Current Milestone block + 5 new key decisions (M-08..M-12) + new Out of Scope additions (organism without safety bundle, memorial-AI mode, therapist roleplay, federation Pattern C, unsandboxed skill execution). REQUIREMENTS.md + ROADMAP.md to be written next.

---

## Context cliff notes

- v1.0 + v1.1 + v1.2 all shipped; substrate is reachable, observable, capability-aware, and chat-action-capable
- 31 verify gates green at v1.2 close; v1.3 will add `verify:skill-format` (Phase 21) + `verify:voyager-loop` (Phase 22) + extended `verify:eval` with OOD fixtures (Phase 23) — target 33–34 gates by close
- v1.3 = 7 phases (21=Skills v2, 22=Voyager loop closure, 23=verifiable reward + OOD eval, 24=dream_mode consolidation, 25=Hermes 4 provider, 26=voice resurrection, 27=close)
- The substrate-level claim v1.3 enables: "Two installs of BLADE genuinely diverge over time" — Voyager skill library grows from each user's specific capability gaps; no other consumer agent ships executable-code skill libraries
- May 11 deadline (₹2000 from non-brother source per WORKSPACE.md MONEY_MISSION) is downstream consequence, not goal — substrate ships → README + Polar wiring in Phase 27 takes a day → Show HN follows
- Activity log strip is the v1.1 contract every v1.3 cross-module action must honor (M-07 held)
- Phase 21 substrate (Skills v2 / SKILL.md format) blocks Phase 22 (Voyager loop must write SKILL.md somewhere coherent); 23/24/25/26 can parallelize after 22 lands

---

*State updated: 2026-04-30T22:30Z — v1.3 milestone bootstrap in progress. PROJECT.md updated; STATE.md reset; REQUIREMENTS.md + ROADMAP.md next.*
