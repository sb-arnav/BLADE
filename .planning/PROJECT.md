# BLADE — Desktop JARVIS

## What This Is

BLADE is a desktop AI that lives on your machine — a "body" of 178+ Rust modules (brain, organs, tentacles, DNA, nervous and immune systems) plus a Liquid-Glass-native React skin across 5 windows and 59 routes. V1 shipped the substrate: backend is functional, frontend is rebuilt on coherent tokens, all 10 phases landed (`npm run verify:all` 18/18 green). **v1.1** turns that substrate into something that actually works for a first-time user — wiring backends that exist but aren't surfaced, replacing dumb defaults (12-scanner sweep, 6 hardcoded provider cards) with capability-aware smart defaults, closing the accessibility + activity-surface gaps the tester pass exposed.

## Core Value

**BLADE works out of the box.** A first-time user pastes a key (or a cURL snippet), the deep scan surfaces their actual environment, observer-class tentacles auto-enable based on what was found, every backend capability is reachable from UI, and the user can always see what BLADE is doing. No dead UI. No invisible features. No empty dashboard.

## Requirements

### Validated

<!-- Shipped in v1.0 — the Skin Rebuild milestone. Consumed by v1.1. -->

- ✓ Backend: 178+ Rust modules, 764 `#[tauri::command]`s, 73 event emitters
- ✓ Backend: 10 tentacles, 4 heads, 10 hormones, 12 body systems, body_registry
- ✓ All 5 windows boot (main / quickask / overlay / hud / ghost_overlay) — no Rust panics
- ✓ Design tokens: glass tiers, blur caps, radii, motion curves locked in `src/styles/`
- ✓ 9 primitives self-built (Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton)
- ✓ Typed Tauri wrapper base (`invokeTyped<T>`) + `useTauriEvent` hook + `BLADE_EVENTS` registry
- ✓ Custom router + 82 route stubs + `usePrefs` + `ConfigContext`
- ✓ Chat pipeline: streaming, tool calls, 29 `blade_*` events
- ✓ Voice Orb (4 phase states, OpenClaw math), QuickAsk, Ghost Mode (content-protected), HUD bar
- ✓ 18 verify gates green: entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count + 9 playwright specs
- ✓ 156 V1 requirements across 21 categories mapped + shipped (FOUND, WIN, WIRE-01..08, ONBD, SHELL, DASH, CHAT, SET, QUICK, ORB, GHOST, HUD, AGENT, KNOW, LIFE, IDEN, DEV, ADMIN, BODY, HIVE, POL)

## Current Milestone: v1.1 — Functionality, Wiring, Accessibility

**Goal:** Make BLADE actually work as the thing it already is — wire every backend capability to UI, replace dumb defaults with smart ones, and make the surface reachable + trustworthy.

**Anchor:** v1.1 is NOT a new-feature milestone. The substrate exists; tester pass surfaced that most of it is unwired, unreachable, or backed by defaults that make the surface feel empty (chat silently fails, deep scan finds 1 repo, dashboard pages empty, cluttered UI, unreachable options, no activity surface, non-capability-aware routing).

**Target features:**
- **Inventory & Wiring Audit** — classify every Rust module + every route (ACTIVE / WIRED-NOT-USED / NOT-WIRED / DEAD); output becomes the plan input for the wiring pass
- **Smart Provider Setup** — paste cURL/JSON/Python → auto-extract provider+model+key; validate key on save (probe capabilities); capability-aware routing with per-capability fallback prompts; "plug in better key" empty-states
- **Smart Deep Scan** — replace 12-scanner sweep with a lead-following scanner (filesystem walk, git remotes, IDE workspaces, AI session history, shell history, MRU, bookmarks, installed CLIs); builds its own todo list; streams results to activity log; structured editable profile output
- **Self-Configuring Ecosystem (observe-only)** — scan results silently activate observer-class tentacles (repo watcher, Slack monitor, deploy monitor, PR watcher, session bridge, calendar monitor); hard rule: observe-only in v1.1, every auto-enabled tentacle listed in Settings with rationale + one-click disable
- **Wiring & Accessibility Pass** — close every NOT-WIRED gap from audit, fix or remove WIRED-NOT-USED dead UI, A11y sweep on new surfaces, persistent Activity Log strip ("BLADE is doing…" with click-to-drawer reasoning)
- **Density + Polish** — spacing ladder audit, card gaps, background-image dominance fix, top-bar hierarchy pass, empty-state copy rewrite

**Planning source of truth:** `.planning/notes/v1-1-milestone-shape.md` (locked 2026-04-20). Deviations from the 6-phase shape require explicit sign-off.

**v2+ vision (deferred):** `.planning/notes/v2-vision-tentacles.md`. Out of scope for v1.1: acting tentacles (reply/post/deploy), JARVIS push-to-talk demo, browser harness deep work, heads + big agent, business SDK, Hyprland integration.

### Active

<!-- v1.1 scope. Requirement IDs defined in REQUIREMENTS.md; rolled up here by category. -->

- [ ] **AUDIT** — wiring audit artifact covering every Rust module + route with classification
- [ ] **PROV** — smart provider setup: custom config paste, key validation, capability-aware routing, upgrade-prompt empty-states
- [ ] **SCAN** — lead-following deep scan: 8 source classes, streaming, editable structured profile
- [ ] **ECOSYS** — self-configuring observer tentacles: auto-enable from scan, Settings rationale + one-click disable, strict observe-only guardrail
- [ ] **WIRE2** — wire every NOT-WIRED backend to UI; remove/fix every WIRED-NOT-USED dead UI
- [ ] **A11Y2** — a11y pass 2 (keyboard, focus, contrast, SR labels, dialog traps, reduced-motion) on every surface added in v1.1
- [ ] **LOG** — activity log strip: "BLADE is doing…" surface, click → drawer with payload + reasoning, event-per-cross-module-action
- [ ] **DENSITY** — spacing/density/hierarchy/copy polish across all 50+ routes

### Out of Scope

Unchanged from v1.0 plus additional v1.1 exclusions:

- **Acting tentacles in v1.1** — observe-only is the rule. Anything that replies, posts, deploys, or modifies external state requires explicit per-tentacle enablement and ships in v1.2+. *Why: trust is earned; a first cold-install must not surprise the user with an outbound action.*
- **JARVIS push-to-talk demo moment** — deferred to v1.2+. *Why: v1.1 builds the wiring a JARVIS demo would consume; adding it here dilutes the "make it work" anchor.*
- **Browser harness deep integration** — research question Q1 (`browser-use/browser-harness`) stays open in `research/questions.md` until v1.2 scoping. *Why: load-bearing for JARVIS, not for v1.1's wiring pass.*
- **Head models + Big Agent** — v2+ vision. *Why: needs multiple tentacles to be useful; heads are the v2 milestone unit.*
- **Multi-instance / business SDK / Hyprland / Linux power-user niche** — adjacent directions logged in `v2-vision-tentacles.md`. *Why: destination, not route.*
- All v1.0 Out of Scope entries (shadcn, Framer Motion, Zustand, React Router, light theme, backend rewrites beyond wiring gaps, mobile/web port, etc.) remain out of scope.

## Context

- **V1 substrate is shipped.** 10 phases, ~165 commits, 64 plans, `npm run verify:all` 18/18 green, `npx tsc --noEmit` clean. Mac smoke checkpoints (M-01..M-46) tracking separately — do not gate v1.1 start.
- **Tester pass grounding.** v1.1 scope is evidence-backed: tester's 6 concrete breakages (silent chat failure, 1-repo scan, empty dashboard, no activity surface, cluttered UI, unreachable options, Groq+llama routing miss) are the source material for the 6 phases.
- **The body works.** v1.1 does not rewrite backend beyond wiring gaps. Every backend capability listed under Validated is callable today; the issue is UI reachability and smart defaults, not the engine.
- **Tester commits already landed.** `580175f docs(explore): lock v1.1 milestone shape`, `90d72aa docs(explore): capture v2+ tentacles vision + browser-harness question`, `4ab464c fix(tester-pass-1): silence log spam, stop self_upgrade loop, surface chat errors` — Phase 0 audit can assume these.
- **Phase numbering.** v1.0 occupied phases 0..9. v1.1 continues at phase 10 and runs to phase 15 (6 phases). The locked shape's internal "Phase 0..5" names map 1:1 to global phases 10..15.

## Constraints

- **Tech stack:** unchanged. React 19 + TypeScript + Vite 7 + Tauri 2.10 + Tailwind v4. No runtime CSS-in-JS, no motion lib, no state lib beyond React primitives.
- **Observe-only guardrail** (v1.1 hard rule): every auto-enabled tentacle from the ecosystem phase is read-only. Any outbound action (reply, post, push, deploy, modify external state) requires explicit Settings-side enablement even when credentials are present.
- **No backend rewrites beyond wiring gaps.** v1.1 may add capabilities that close audit gaps (new commands for a NOT-WIRED module, new events for an activity log surface), but net-new organ/tentacle capabilities belong to v2+.
- **Activity log is load-bearing.** Every cross-module action in v1.1 must emit an event consumed by the log. This is the trust surface for "is BLADE doing anything?"
- **Performance budgets** from V1 remain: dashboard first paint ≤200ms on integrated GPU, Voice Orb 60fps through all 4 phase transitions, max 3 backdrop-filter per viewport, blur caps 20/12/8px.
- **Verify gates extend, not replace.** v1.1 adds a11y-pass-2 + feature-reachability scripts to the existing 18 gates. Regressions in existing gates fail the phase.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1.1 = wiring + smart defaults + a11y, NOT a new-feature milestone | Tester pass exposed the substrate is unwired, not underbuilt; adding features would compound the problem | — Locked 2026-04-20 |
| 6-phase shape locked from /gsd-explore; /gsd-new-milestone may flesh out but not revise | Prevents drift when requirements/roadmap pass re-surfaces prior debates | — Locked 2026-04-20 |
| Ecosystem phase is observe-only in v1.1 | Auto-enabling acting tentacles on cold install violates trust; acting capability is a separate earned-trust milestone | — Locked 2026-04-20 |
| JARVIS push-to-talk moment deferred to v1.2+ | JARVIS consumes v1.1's wiring; shipping it in v1.1 would dilute the "make it work" anchor | — Locked 2026-04-20 |
| Phase numbering continues from v1.0 (v1.1 = phases 10..15) | Preserves global phase history; archived phases 0..9 keep their paths | — Locked 2026-04-20 |
| Capability-aware routing lives in Phase 11 (Smart Provider Setup) | Phase 12 (Smart Deep Scan) uses Phase 11's capabilities for lead-following; sequencing flows naturally | — Locked 2026-04-20 |
| Activity log strip is load-bearing, not polish | Tester's "background terminal noise, no trust" is the #1 UX grievance; belongs in Phase 14 (wiring + a11y), not Phase 15 (density) | — Locked 2026-04-20 |
| `v2-vision-tentacles.md` captured verbatim, separately | Destination in view while planning the route; prevents roadmap re-argument against vision | — Locked 2026-04-20 |
| v1.0 decisions D-01..D-45 remain in force | v1.1 does not re-litigate V1 architecture choices | — Inherited |

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
*Last updated: 2026-04-20 — v1.1 milestone initialized (goals, constraints, 6-phase shape locked from /gsd-explore)*
