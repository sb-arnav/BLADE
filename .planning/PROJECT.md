# BLADE — Desktop JARVIS

## What This Is

BLADE is a desktop AI that lives on your machine — 204+ Rust modules (brain, organs, tentacles, DNA, nervous and immune systems) plus a Liquid-Glass-native React skin across 5 windows and 50+ routes. **v1.0** shipped the substrate. **v1.1** wired it. **v1.2** added chat → consent → cross-app action. **v1.3** shipped self-extending tools (Voyager pattern). **v1.4** shipped the organism layer (hormones, vitality, active inference, safety bundle). **v1.5** fixes the actual brain — the agentic loop that ties all 204 modules together is currently a naive 12-iteration for-loop. v1.5 replaces it with genuine intelligence: selective context, progressive compaction, verification, self-correction, and auto-decomposition, ported from the best open-source agents.

## Core Value

**BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.** Paste a key, smart scan reads 8 source classes, observer tentacles auto-enable behind a runtime guardrail, every backend capability is reachable, the activity-log strip surfaces every action. v1.2 added chat → consent → cross-app write. v1.3 added self-extending tools (Voyager pattern — two installs diverge over time). v1.4 added the organism layer (hormones modulate behavior, vitality creates stakes, active inference drives adaptation). v1.5 adds the missing piece: the agentic loop itself — selective context, progressive compaction, mid-loop verification, stuck detection, and auto-decomposition into parallel sub-agents. The brain that drives 204 modules needs to actually think.

## Current State

**Shipped:** v1.0 (Skin Rebuild substrate, 2026-04-19) + v1.1 (Functionality, Wiring, Accessibility, 2026-04-24, closed 2026-04-27) + v1.2 (Acting Layer with Brain Foundation, 2026-04-29, closed 2026-04-30) + v1.3 (Self-extending Agent Substrate, closed 2026-05-02).

- 204+ Rust modules; 770+ Tauri commands; 73+ event emitters
- 33 verify gates green; 435 tests; tsc --noEmit clean; cargo check clean
- v1.3 spine: Skill system (Voyager-pattern tool generation), reward module, ecosystem discovery, consent/approval, session handoff, dream mode
- v1.4 Phase 25 complete: Metacognitive Controller — confidence-delta detection, secondary verifier routing, initiative phrasing, gap log → evolution.rs, DoctorPane metacognitive signal (7 signal sources)
- Strategic anchor 2026-04-30: chat-first pivot — "one chat capable of doing anything"; UI-polish UAT deferred for UI-only phases; chat-capability + tool reliability prioritized

**Audit:** v1.2 closed at status `tech_debt` matching v1.1 pattern — all functional code complete; deferred items: Phase 19 wholesale (12 UAT-XX), JARVIS-01/02 voice resurrection, JARVIS-12 cold-install demo (operator API-key constraint), D-04 Step 2 LLM intent fallback, fast-streaming branch ego accumulator. All carry-forward into v1.3 with explicit deferral docs.

## Requirements

### Validated (shipped)

<!-- v1.0 Skin Rebuild substrate -->

- ✓ Backend: 178+ Rust modules, 764 `#[tauri::command]`s, 73 event emitters — v1.0
- ✓ Backend: 10 tentacles, 4 heads, 10 hormones, 12 body systems, body_registry — v1.0
- ✓ All 5 windows boot (main / quickask / overlay / hud / ghost_overlay) — v1.0
- ✓ Design tokens: glass tiers, blur caps, radii, motion curves locked — v1.0
- ✓ 9 primitives self-built (Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton) — v1.0
- ✓ Typed Tauri wrapper base (`invokeTyped<T>`) + `useTauriEvent` hook + `BLADE_EVENTS` registry — v1.0
- ✓ Custom router + 50+ routes + `usePrefs` + `ConfigContext` — v1.0
- ✓ Chat pipeline: streaming, tool calls, 29 `blade_*` events — v1.0
- ✓ Voice Orb (4 phase states, OpenClaw math), QuickAsk, Ghost Mode (content-protected), HUD bar — v1.0
- ✓ 18 verify gates green at v1.0 — v1.0

<!-- v1.1 Functionality, Wiring, Accessibility -->

- ✓ AUDIT — full WIRING-AUDIT classifying every Rust module + route + config field with NOT-WIRED backlog feeding Phase 14 — v1.1
- ✓ PROV — paste-anything provider setup (cURL/JSON/Python), capability probe persistence, 3-tier capability-aware router resolution, 8 capability-gap consumer surfaces with deep-link CTAs — v1.1 (VERIFIED PASSED)
- ✓ SCAN — lead-following deep scan across 8 source classes; structured editable profile with round-trip persistence (SCAN-13 cold-install baseline operator-owned) — v1.1
- ✓ ECOSYS — 6 observer-class tentacle probes (repo-watcher, Slack, deploy-monitor, PR-watcher, session bridge, calendar) with runtime OBSERVE_ONLY guardrail; per-tentacle rationale + one-click disable — v1.1
- ✓ WIRE2 — every NOT-WIRED gap closed or documented v1.2 deferral (97 deferred-with-rationale); 3 ComingSoonCards on Dashboard replaced with live bindings; verify:feature-reachability gate — v1.1
- ✓ A11Y2 — keyboard nav + aria-labels + focus traps + reduced-motion gates; verify:a11y-pass-2 gate — v1.1 (5-wallpaper contrast UAT operator-owned)
- ✓ LOG — persistent ActivityStrip + ActivityDrawer + 500-entry localStorage ring buffer; emit_activity_with_id signature wired into 6 ecosystem observer loops — v1.1 (LOG-04 time-range filter advisory; runtime UAT operator-owned)
- ✓ DENSITY — spacing-ladder gate (0 violations across 39 CSS files); 18-file empty-state copy rewrite; 4-tier top-bar hierarchy with 1280/1100 responsive guardrails; RightNowHero with 4 live-signal chips — v1.1 (5-wallpaper + cold-install + 50-route UAT operator-owned)

### Validated (v1.3 — Self-extending Agent Substrate, closed 2026-05-02 at Phase 24)

- ✓ SKILLS — agentskills.io SKILL.md format (YAML+MD), progressive disclosure, workspace→user→bundled resolution, validator + 3 bundled exemplars — v1.3 Phase 21 (65 tests)
- ✓ VOYAGER — evolution.rs → autoskills.rs → tool_forge.rs end-to-end, verify:voyager-loop gate, deterministic fixture (youtube_transcript) — v1.3 Phase 22 (21 tests)
- ✓ REWARD — RLVR-style composite reward (0.5·skill_success + 0.3·eval_gate + 0.1·acceptance + 0.1·completion), 3 OOD eval modules (adversarial/ambiguous/capability-gap), DoctorPane RewardTrend row, verify:eval extended to 8 modules — v1.3 Phase 23 (45 tests)
- ✓ DREAM — dream_mode.rs skill consolidation (prune >90d, consolidate redundant, generate from traces), .pending/ proposal queue, chat-injected operator confirmation, skill_validator CLI — v1.3 Phase 24 (435 tests total at close)

### Validated (v1.4 — Cognitive Architecture, closed 2026-05-03 at Phase 31)

- ✓ META — Metacognitive controller v0: confidence-delta detection, verifier routing, gap surfacing, gap log → evolution.rs, DoctorPane metacognitive signal (7 signal sources) — v1.4 Phase 25
- ✓ SAFETY — Safety bundle: danger-triple detection, mortality-salience cap, steering-toward-calm bias, eval-gate vitality drain, anti-attachment guardrails — v1.4 Phase 26
- ✓ HORMONE — Hormone physiology + emotion classifier: 7 hormones with decay/gain, text→valence/arousal→hormone with α=0.05 smoothing, behavioral modulation (cortisol→terse, dopamine→exploration, etc.) — v1.4 Phase 27
- ✓ INFERENCE — Active inference loop: tentacle predictions, prediction error → hormone bus → behavior, calendar+Slack demo loop, prediction-error-weighted memory replay — v1.4 Phase 28
- ✓ VITALITY — Vitality engine: 0.0–1.0 scalar with 5 behavioral bands, SDT replenishment, drain from failures/isolation/tedium, dormancy at 0.0 — v1.4 Phase 29
- ✓ EVAL — Organism eval suite: vitality dynamics, hormone-driven behavior, persona stability under stress, 13/13 organism eval fixtures, verify:organism gate — v1.4 Phase 30
- ✓ CLOSE — README rewrite, CHANGELOG, v1.4 milestone audit, phase archive — v1.4 Phase 31 (37 verify gates, 435+ tests, zero debt)

### Current Milestone: v1.5 — Intelligence Layer

**Goal:** Transform BLADE's naive 12-iteration tool loop into a genuine agentic intelligence. Selective context injection, progressive compaction, mid-loop verification, self-correction, stuck detection, auto-decomposition into sub-agents, and battle-tested patterns ported from the best open-source agents (Claude Code, Aider, OpenHands, Goose). The organism layer exists — now the brain that drives it needs to actually think.

**Target features (phases 32–38):**

- [ ] **CTX** *(Phase 32)* — Selective context injection + progressive compaction. Gate ALL brain.rs context by query relevance (not just items 9-16). Implement condenser pattern: keep first ~8k tokens (system + task) + last ~8k (recent work), LLM-summarize the middle. Replace reactive 140k hard truncation. Thalamus becomes the real gatekeeper.
- [ ] **LOOP** *(Phase 33)* — Agentic loop rewrite. Mid-loop verification ("are we progressing toward the goal?") every 3 tool calls. Structured error feedback (tool failures return reasons + suggested alternatives, not just error strings). Plan adaptation: if step N fails, re-plan from current state instead of retrying. Max-output-token escalation on truncation.
- [ ] **STUCK** *(Phase 34)* — Stuck detection + cost awareness. 5 semantic patterns checked every iteration: repeated action/observation pairs, monologue spirals, context-window thrashing, no-progress loops, cost runaway. Circuit-breaker: after N consecutive same-type failures, escalate to user instead of looping. Token cost tracking per conversation.
- [ ] **DECOMP** *(Phase 35)* — Auto-decomposition. Wire swarm into the main chat loop. When brain_planner detects 5+ independent steps, auto-spawn sub-agents with isolated context windows. Only summary returns to parent conversation. Conversation forking for sub-tasks. "This task would be faster in parallel" → automatic.
- [ ] **REPO** *(Phase 36)* — Context intelligence. Aider-style tree-sitter + PageRank repo map for code tasks (extend knowledge_graph.rs with symbol dependency graph). Goose-style canonical_models.json capability registry for multi-provider routing (formalize router.rs). @context-anchor explicit injection (@screen, @file, @memory:topic) alongside ambient context.
- [ ] **EVAL** *(Phase 37)* — Intelligence eval suite. Agentic loop benchmarks: multi-step task completion rate, context efficiency (tokens used vs task complexity), stuck-detection accuracy, decomposition quality, plan adaptation success rate. Compare before/after on same task set. verify:intelligence gate.
- [ ] **CLOSE** *(Phase 38)* — Close. README update with architecture citations (Claude Code arxiv 2604.14228, Aider repo map, OpenHands condenser, Goose capability registry, mini-SWE-agent simplicity proof). CHANGELOG. v1.5 milestone audit. Phase archive.

**Explicitly deferred to v1.6+:**
- Organism surfacing (hormones/vitality/metacognition visible in chat UI) — backend works, needs UI surface; v1.6
- JARVIS-01/02 voice resurrection — UX feature, not intelligence; v1.6
- Persona shaping via curated SFT data (Layer 7) — v1.6
- Immune / behavioral-drift cross-cutting layer — v1.6
- Federation Pattern A + selection mechanisms — v1.6
- Profile isolation work/personal split — v1.6
- Phase 19 UAT close (23 carry-overs) — v1.6
- Browser-harness Q1 decision — pull as dependency arises
- D-04 Step 2 LLM intent fallback, fast-streaming ego accumulator refactor — pull if loop rewrite surfaces them
- Go/NoGo decision gating (basal ganglia) — v2+ research bet
- DMN-style background processing — v2+ research bet
- NREM/REM dual-phase dream-mode redesign — v2+ research bet
- V-JEPA 2 world model integration — v3+
- TTT continual learning — v2+

**Research inputs:**
- arxiv 2604.14228 (Claude Code architecture) — 5-layer compaction, sub-agent isolation, TAOR loop, failure-returns-reasons
- Aider repo map (aider-chat/aider) — tree-sitter + PageRank for context selection
- OpenHands condenser (OpenHands/OpenHands) — keep-edges-summarize-middle, stuck detection, event-stream-as-truth
- Goose capability registry (block/goose) — canonical_models.json, Rust agent core, MCP-first
- mini-SWE-agent (SWE-agent/mini-swe-agent) — 100 lines, 74% SWE-bench; proof that loop simplicity > module count
- Screenpipe (mediar-ai/screenpipe) — optimized local capture pipeline, MIT
- Competitive landscape audit 2026-05-03: no shipped product combines local-first + memory + desktop control + ambient perception + voice + autonomy + self-extending. Closest: Claude Cowork (cloud-only), Screenpipe (passive-only). BLADE is alone in the full stack.

### Out of Scope

Unchanged across v1.0 + v1.1 + v1.2:

- shadcn/Radix, Framer Motion, Zustand, React Router (D-01..D-05 stack decisions hold)
- Light theme / accent picker (deferred indefinitely)
- Mobile/web port (desktop-only by design)
- Backend rewrite beyond wiring gaps (M-01 anchor)
- Multi-instance / business SDK (v2+ adjacent direction)
- Hyprland compositor integration (v2+ adjacent direction)
- Heads + Big Agent (v2+ — needs multiple acting tentacles per head to be useful)

New for v1.3 (substrate-anchored exclusions):

- Vitality / mortality / hormone bus organism layer **without the safety bundle** — steelman Arg 4 + Arg 10 verdict: net-safety-negative without it; ship the bundle in v1.4 or skip permanently
- Memorial-AI / Be-Right-Back / persistent-attachment product modes — `scifi-mined-design-ideas.md` calls this the textbook harm; not shipping
- Roleplaying as therapist or replacing human mental-health resources — crisis-detection escalation surfaces hotline / human-resource options instead (per anthropomorphism 2025–2026 literature liability findings)
- Federation Pattern C (shared weight deltas) — per cumulative-culture research, only Pattern A + selection mechanisms in v1.4; Pattern C requires CVPR 2025 model-poisoning defenses + reputation system mature enough for sybil resistance
- Skill-execution without sandboxing — Skills v2 must execute first-run scripts behind explicit user confirmation; arbitrary code from federation skills cannot bypass this

## Context

- v1.0–v1.4 shipped. 204+ Rust modules, 770+ Tauri commands, 37 verify gates green, 435+ tests, tsc --noEmit clean, cargo check clean.
- v1.4 Cognitive Architecture complete: metacognition, safety bundle, hormones, active inference, vitality, organism eval (13/13 fixtures, MRR 1.000). Zero debt at close.
- The bottleneck is now the agentic loop itself. 204 modules of smart infrastructure wrapped around a naive 12-iteration for-loop. Context bloated (everything injected every turn), no verification, no stuck detection, no auto-decomposition, no plan adaptation. This is why BLADE doesn't feel like AI.
- Competitive landscape (audited 2026-05-03): no product combines local-first + memory + desktop control + ambient perception + voice + autonomy + self-extending + organism. Closest: Claude Cowork (cloud-only), Screenpipe (passive). Rewind/Limitless dead, Humane/Rabbit dead. BLADE is alone in the full stack — but the loop quality lags dedicated tools like Claude Code, Aider, OpenHands.
- Cold-install dev environment: WSL2 on Windows 11. Mac smoke operator-owned per HANDOFF-TO-MAC.md.
- Activity log remains load-bearing — every cross-module action emits to it.

## Constraints

- **Tech stack:** unchanged. React 19 + TypeScript + Vite 7 + Tauri 2.10 + Tailwind v4. No runtime CSS-in-JS, no motion lib, no state lib beyond React primitives.
- **Observe-only guardrail (v1.1 hard rule):** auto-enabled tentacles are read-only via `OBSERVE_ONLY: AtomicBool`. Acting paths require explicit user consent.
- **Activity log remains load-bearing.** Every cross-module action must continue to emit.
- **Performance budgets:** Dashboard first paint ≤200ms, Voice Orb 60fps, max 3 backdrop-filter per viewport, blur caps 20/12/8px.
- **Verify gates extend, not replace.** v1.5 adds to the 37-gate chain; regressions in any existing gate fail the phase.
- **Loop changes must not break existing chat.** The agentic loop rewrite (v1.5) must keep the current simple chat path working — selective context and compaction are additive, not replacements. If the smart path fails, fall back to the current naive loop.
- **Port, don't reinvent.** Where battle-tested open-source patterns exist (Aider repo map, OpenHands condenser, Goose capability registry), adapt them rather than building from scratch. MIT/Apache only.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1.0 D-01 Self-built 9 primitives, no shadcn/Radix | Liquid-Glass aesthetic + bundle size | ✓ Held through v1.1 |
| v1.0 D-02 CSS-only motion, no Framer Motion | Bundle + reduced-motion compliance | ✓ Held |
| v1.0 D-03 Hand-written Tauri wrappers in `src/lib/tauri/` | Type safety + audit-clean IPC | ✓ Held; v1.1 added 4 new wrapper clusters (voice/privacy/intelligence/system) |
| v1.0 D-04 useChat + ConfigContext, no Zustand | React primitives sufficient | ✓ Held |
| v1.0 D-05 Custom route registry, no React Router | Custom route hint + ⌘K palette parity | ✓ Held; v1.1 extended openRoute(id, hint?) + routeHint sidecar |
| v1.0 D-07 Max 3 backdrop-filter per viewport; blur caps 20/12/8px | Integrated-GPU performance | ✓ Held |
| v1.0 D-09 Ghost Mode `.content_protected(true)` at creation | Screen-share hostile-window leak prevention | ✓ Held |
| v1.0 D-13 useTauriEvent hook is the only permitted event subscription pattern | Lifecycle correctness | ✓ Held; v1.1 ActivityStrip uses it for BLADE_EVENTS.ACTIVITY_LOG |
| v1.0 D-14 emit_to(window_label, ...) for single-window; emit_all for cross-window only | Avoid event leak | ✓ Held |
| v1.0 D-56 Onboarding preserves 6 hardcoded provider IDs alongside paste flow | Discoverability for new users | ✓ Held in Phase 11 |
| v1.0 D-57 Settings Provider pane shares the same paste flow component | Single source of truth | ✓ Held |
| v1.1 M-01 Wiring + smart defaults + a11y, NOT a new-feature milestone | Tester pass exposed unwired substrate; features compound the problem | ✓ Held; v1.1 added zero net-new tentacle classes |
| v1.1 M-02 6-phase shape locked from /gsd-explore | Prevent drift during requirements/roadmap pass | ✓ Held — no shape revisions during execution |
| v1.1 M-03 Ecosystem observe-only via runtime check | Acting tentacles on cold install violate trust | ✓ Held; OBSERVE_ONLY: AtomicBool enforces |
| v1.1 M-04 JARVIS push-to-talk deferred to v1.2+ | v1.1 builds the wiring JARVIS consumes | ✓ Held; v1.2 candidate |
| v1.1 M-06 Capability-aware routing in Phase 11; Phase 12 consumes it | Sequencing flows naturally | ✓ Held; soft dep resolved at integration point |
| v1.1 M-07 Activity log strip in Phase 14 (wiring), not Phase 15 (density) | Tester's #1 UX grievance ("no trust") is wiring, not polish | ✓ Held |
| v1.1 close: accept tech_debt (operator UAT items) and proceed | Same convention as v1.0 Mac-smoke close-out | ✓ Logged 2026-04-27 |
| v1.2 close: accept tech_debt (Phase 19 deferral + JARVIS-12 demo + Doctor pane UAT) and proceed | Chat-first pivot 2026-04-30 + operator API-key constraint; matches v1.0/v1.1 pattern | ✓ Logged 2026-04-30 |
| v1.3 M-08: lead with Voyager loop (executable skill code), not Skills-v2-as-end-in-itself | Hermes/OpenClaw ship procedural skill memory; executable code is the substrate-level differentiator (Wang et al, NeurIPS 2023) | ✓ Locked 2026-04-30 |
| v1.3 M-09: organism layer (vitality/hormones/mortality) deferred to v1.4+ with safety bundle | Steelman Arg 4 + Arg 10: shipping organism without (mortality_salience cap + danger-triple detection + steering-toward-calm bias + eval-gate vitality drain) is net-safety-negative | ✓ Locked 2026-04-30 |
| v1.3 M-10: RLVR-style verifiable composite reward shipped at agent layer | open-questions Q1: BLADE doesn't need to wait for foundation-level continual learning (Sholto's prediction); skill_success + eval_gate + acceptance + completion is verifiable today | ✓ Locked 2026-04-30 |
| v1.3 M-11: Skills format = agentskills.io SKILL.md (YAML+MD), not BLADE-specific JSON | Lose ecosystem interop forever for zero gain; Claude Code / OpenAI Codex / OpenClaw / clawhub all comply with the open standard | ✓ Locked 2026-04-30 |
| v1.3 M-12: Phase numbering continues globally — v1.3 starts at Phase 21 | Same convention as v1.1 → v1.2 (M-05 held) | ✓ Locked 2026-04-30 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

*Last updated: 2026-05-03 — v1.5 milestone scoped via /gsd-new-milestone. v1.4 Cognitive Architecture closed clean (7 phases, 37 gates, zero debt). v1.5 Intelligence Layer: fix the agentic loop (selective context, compaction, verification, stuck detection, auto-decomposition) + port proven patterns (Aider repo map, OpenHands condenser, Goose capability registry). Competitive audit confirmed BLADE is alone in the full-stack desktop agent space — but loop quality lags dedicated tools.*
