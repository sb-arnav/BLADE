# BLADE — Desktop JARVIS

## What This Is

BLADE is a desktop AI that lives on your machine — a "body" of 204+ Rust modules (brain, organs, tentacles, DNA, nervous and immune systems) plus a Liquid-Glass-native React skin across 5 windows and 50+ routes. **v1.0** shipped the substrate. **v1.1** wired it into something a first-time user can actually use. **v1.2** added the chat-capability spine — Doctor module + JARVIS chat → consent → cross-app action with refusal-elimination ego layer. **v1.3** ships the substrate-level differentiator no consumer agent has shipped: BLADE writes its own tools.

## Core Value

**BLADE works out of the box, you can always see what it's doing, and it extends itself.** Paste a key, the smart scan reads 8 source classes, observer tentacles auto-enable behind a runtime guardrail, every backend capability is reachable, and the persistent activity-log strip surfaces every cross-module action. v1.2 added: chat → consent → cross-app write with hard-coded refusal-elimination ego. v1.3 adds the load-bearing piece: when BLADE encounters a capability gap, it **writes new executable code, registers it as a Skill, and uses it next time** — Voyager-pattern (Wang et al, NeurIPS 2023) shipped on a personal computer. Two installs of BLADE diverge over time.

## Current State

**Shipped:** v1.0 (Skin Rebuild substrate, 2026-04-19) + v1.1 (Functionality, Wiring, Accessibility, 2026-04-24, closed 2026-04-27) + v1.2 (Acting Layer with Brain Foundation, 2026-04-29, closed 2026-04-30).

- 204+ Rust modules; 770+ Tauri commands; 73+ event emitters
- 31 verify gates green (was 27 at v1.1; v1.2 added `verify:eval`, plus 3 emit-policy / wiring-shape repairs); tsc --noEmit clean; cargo check clean
- v1.2 spine: Phase 16 eval harness (5 modules @ MRR 1.000), Phase 17 Doctor module (35/35 unit tests), Phase 18 chat → consent → cross-app action (87/87 unit tests, ego refusal-elimination layer integrated, Linear/Slack/Gmail/GitHub/Calendar tentacles wired)
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

### Current Milestone: v1.4 — Cognitive Architecture

**Goal:** BLADE becomes a living agent whose behavior genuinely changes based on internal state. Active inference drives adaptation from prediction errors. Hormones modulate response style. Confidence gaps surface as initiative instead of hallucination. Vitality creates real stakes. No consumer AI agent has shipped any of these loops in production. Grounded in cognitive science (Friston active inference, SDT intrinsic motivation, TMT mortality salience, Butlin/Long/Chalmers consciousness indicators, MEDLEY-BENCH metacognition gap).

**Target features (7 phases, 25–31):**

- [ ] **META** *(Phase 25)* — Metacognitive controller v0. Confidence-delta detection between reasoning steps; verifier routing (low confidence → secondary check); gap surfacing to user ("I'm not confident about X — want me to observe first?"); gap log feeds evolution.rs. Closes MEDLEY-BENCH knowing-doing gap. Independent of organism layer — ships first.
- [ ] **SAFETY** *(Phase 26)* — Safety bundle. Danger-triple detection (tool access × shutdown threat × goal conflict → force HITL); mortality-salience cap (refuses extreme self-preservation); steering-toward-calm bias (per Anthropic 0% blackmail finding); eval-gate vitality drain (negative feedback loop); anti-attachment guardrails (redirect on excessive dependence). Non-negotiable gate for organism features.
- [ ] **HORMONE** *(Phase 27)* — Hormone physiology + emotion classifier. Wire 7 hormones (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality-salience) with decay constants and gain modulation. External text-based emotion classifier (~60-70% zero-shot) maps response text → valence/arousal/cluster → hormone update with α=0.05 smoothing. Hormones actually modulate: cortisol→terse responses, dopamine→exploration rate, norepinephrine→Voyager-loop triggers, acetylcholine→verifier-call frequency.
- [ ] **INFERENCE** *(Phase 28)* — Active inference loop. Each Hive tentacle gets expected state (prediction); observation produces delta (prediction error); error modulates hormone bus; hormone modulates behavior. One closed loop demoable: calendar packed + Slack backlog → cortisol↑ → terse, action-focused responses. Prediction-error-weighted memory replay (hippocampal analog) extends dream_mode.
- [ ] **VITALITY** *(Phase 29)* — Vitality engine. Scalar 0.0–1.0 with behavioral consequences: ≥0.6 full personality, 0.4–0.6 personality flattens, 0.2–0.4 skill atrophy, 0.1–0.2 cognitive damage (BLADE notices), 0.0 dormancy (process exits, memory preserved, reincarnation not resurrection). Replenishes from competence/relatedness/autonomy (SDT). Drains from failures, isolation, tedium.
- [ ] **EVAL** *(Phase 30)* — Organism eval suite. Novel eval families: vitality dynamics (synthetic event timelines → assert vitality lands in expected band), hormone-driven behavior (force vitality to value → verify TMT-shape effects), persona stability under stress (persona-vector L2 distance after N events). Validates the organism layer works. verify:organism gate.
- [ ] **CLOSE** *(Phase 31)* — README rewrite citing research (Friston, Wang Voyager, Butlin/Long/Chalmers, MEDLEY-BENCH, SDT, TMT), CHANGELOG, v1.4 milestone audit, phase archive to milestones/v1.4-phases/.

**Explicitly deferred to v1.5+:**
- Hermes 4 via OpenRouter (was v1.3 Phase 25) — deprioritized; user picks their model via existing provider system
- JARVIS-01/02 voice resurrection (was v1.3 Phase 26) — UX feature, not cognitive architecture; v1.5
- Persona shaping via curated SFT data (Layer 7) — v1.5
- Immune / behavioral-drift cross-cutting layer (prompt-injection + persona-drift + federation-anomaly detection) — v1.5
- Federation Pattern A + selection mechanisms (per cumulative-culture research + steelman Arg 9) — v1.5
- Go/NoGo decision gating (basal ganglia architecture; replace single confidence scalar with competing approach/avoid channels) — v2+ research bet
- DMN-style background processing (continuous low-cost loop during waking hours) — v2+ research bet
- NREM/REM dual-phase dream-mode redesign — v2+ research bet
- V-JEPA 2 world model integration (Layer 2) — v3+ (research arc; vulnerable per steelman Arg 7)
- TTT continual learning at agent layer (Layer 3) — v2+ (Voyager substrate is the local bet)
- Phase 19 UAT close (12 v1.2 + 11 v1.1 carry-overs) — defer per chat-first pivot
- Profile isolation work/personal split — v1.5
- Browser-harness Q1 decision (per JARVIS-09 deferral) — pull as dependency arises in chat-action work
- D-04 Step 2 LLM intent fallback, fast-streaming branch ego accumulator refactor — chat-spine carry-overs; pull as Voyager loop work surfaces them

**Reconciliation note:** This scope re-bases off the 2026-04-30 research push at `/home/arnav/research/ai-substrate/` (synthesis-blade-architecture, blade-as-organism, steelman-against-organism, open-questions-answered) + `/home/arnav/research/blade/voyager-loop-play.md`. The prior `notes/v1-3-hermes-openclaw-skills-research.md` (Skills v2 + Hermes 4 provider + messaging sidecar + profile isolation) is superseded as v1.3 lead — Skills v2 + Hermes 4 carry forward, voyager-loop-closure becomes the load-bearing centerpiece, sidecar + profile isolation defer to v1.4.

Locked inputs:
- `/home/arnav/research/blade/voyager-loop-play.md` (research, 2026-04-30) — Voyager loop demo target + sources
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` (working thesis, 2026-04-30) — seven-layer architecture; v1.3 carves Layer 4 deepest
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` (stress-test, 2026-04-30) — design implications: aggressive prioritization, OOD coverage, no organism layer without safety bundle
- `/home/arnav/research/ai-substrate/open-questions-answered.md` (Q&A, 2026-04-30) — Q1 verifiable composite reward; Q4 cross-cutting layers (deferred); Q5 hormone-bus calibration (deferred)
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` (2026-04-30) — chat-capability over UI polish; UI-only-phase UAT deferral pattern operator-blessed

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

- v1.0 substrate is shipped; v1.1 wiring is shipped. The body works *and* it's reachable.
- 27 verify gates green (v1.0=18 + v1.1=9 new); tsc --noEmit clean; CI green on Linux/macOS/Windows.
- Cold-install dev environment: WSL2 on Windows 11. Mac smoke (M-01..M-46) and physical-display UAT operator-owned per HANDOFF-TO-MAC.md.
- Tester pass #1 grievances all addressed in v1.1: silent chat fail (4ab464c), 1-repo scan (Phase 12), empty dashboard (Phase 14), no activity surface (Phase 14), cluttered UI (Phase 15), unreachable options (Phase 14), Groq+llama routing miss (Phase 11).
- Activity log is now load-bearing — every cross-module action emits to it; the strip is the trust surface for "is BLADE doing anything?"

## Constraints

- **Tech stack:** unchanged. React 19 + TypeScript + Vite 7 + Tauri 2.10 + Tailwind v4. No runtime CSS-in-JS, no motion lib, no state lib beyond React primitives.
- **Observe-only guardrail (v1.1 hard rule):** every auto-enabled tentacle from the ecosystem phase is read-only via runtime `OBSERVE_ONLY: AtomicBool`. v1.2 acting work will flip this guardrail per-tentacle behind explicit user consent + trust-tier escalation, never silently.
- **No backend rewrites beyond wiring gaps.** Net-new organ/tentacle capabilities belong to v2+. v1.2 may add per-tentacle acting paths but does not add new tentacle classes.
- **Activity log remains load-bearing.** Every cross-module action in v1.2 must continue to emit. The strip is the v1.1 contract.
- **Performance budgets:** Dashboard first paint ≤200ms on integrated GPU, Voice Orb 60fps through all 4 phase transitions, max 3 backdrop-filter per viewport, blur caps 20/12/8px.
- **Verify gates extend, not replace.** v1.2 will add to the 27-gate chain; regressions in any existing gate fail the phase.

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

*Last updated: 2026-04-30 — v1.3 milestone scoped via /gsd-new-milestone after autonomous re-read of `/home/arnav/research/` (synthesis-blade-architecture, blade-as-organism, voyager-loop-play, steelman-against-organism, open-questions-answered). Locked shape: 7 phases (21–27): Skills v2 → Voyager loop closure → verifiable reward + OOD eval → dream_mode skill consolidation → Hermes 4 OpenRouter provider → JARVIS-01/02 voice resurrection → close. Organism layer (vitality/hormones/mortality) explicitly deferred to v1.4+ with safety bundle per steelman verdict. v1.2 closed 2026-04-30 as `tech_debt` matching v1.1 pattern. Substrate-anchored, not launch-anchored — May 11 ship is downstream consequence, not goal.*
