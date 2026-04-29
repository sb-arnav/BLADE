# BLADE — Desktop JARVIS

## What This Is

BLADE is a desktop AI that lives on your machine — a "body" of 178+ Rust modules (brain, organs, tentacles, DNA, nervous and immune systems) plus a Liquid-Glass-native React skin across 5 windows and 50+ routes. **v1.0** shipped the substrate. **v1.1** wired it into something a first-time user can actually use: paste-anything provider setup, lead-following deep scan, self-configuring observer-class ecosystem, end-to-end wiring + a11y, and the persistent activity-log trust surface. v1.2 starts the trust-earned acting layer.

## Core Value

**BLADE works out of the box, and you can always see what it's doing.** A first-time user pastes a key (or a cURL/JSON/Python snippet), the smart deep scan reads 8 source classes intelligently, observer-class tentacles auto-enable behind a runtime guardrail, every backend capability is reachable from UI or has a documented v1.2 deferral, and the persistent activity-log strip surfaces every cross-module action with click-to-drawer reasoning.

## Current State

**Shipped:** v1.0 (Skin Rebuild substrate, 2026-04-19) + v1.1 (Functionality, Wiring, Accessibility, 2026-04-24, closed 2026-04-27).

- 178+ Rust modules; 764+ Tauri commands; 73+ event emitters
- 27 verify gates green; tsc --noEmit clean; 5 windows boot; design tokens locked
- Phase 11 capability-aware routing operational; Phase 12 smart scan operational; Phase 13 observer ecosystem operational behind `OBSERVE_ONLY: AtomicBool` runtime guardrail; Phase 14 activity-log strip mounted; Phase 15 density + spacing-ladder + empty-state copy + top-bar hierarchy passed

**Audit:** v1.1 closed at status `tech_debt` — no functional blockers; 11 operator-owned UAT items (cold-install screenshots, runtime persistence checks, 5-wallpaper contrast, keyboard-nav, 50-route ⌘K sweep) tracked in STATE.md `## Deferred Items` per the v1.0 Mac-smoke convention.

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

### Current Milestone: v1.2 — Acting Layer with Brain Foundation

**Goal:** BLADE can act, and we can measure whether it acts well. Ship the JARVIS demo moment v1.1 wired everything for, on top of an eval foundation + doctor surface so the acting layer is honest, not theatrical. Close the v1.1 operator UAT debt.

**Target features (5 phases, 16–20):**

- [ ] **EVAL** — `tests/evals/` harness extending the 2026-04-28 memory recall baseline. Knowledge-graph integrity, BM25 regression, typed_memory category recall, evolution capability-gap detection. Floors enforced by `verify:all` (count moves 27 → 28+).
- [ ] **DOCTOR** — central diagnostic `doctor.rs`. Aggregates eval scores + capability-gap log + tentacle health + config drift + pulse signals. Severity-tiered Diagnostics-tab pane with per-signal drill-down.
- [ ] **JARVIS** — push-to-talk → natural-language command → cross-app action flow. Ego refusal-elimination layer folded in as a post-processor (catches "I can't" and routes to `evolution_log_capability_gap` + `auto_install`). Browser-harness Q1 decision absorbed into Phase 18 plan, not a separate research phase.
- [ ] **OPERATOR-UAT** — close the 11 carry-over UAT items from v1.1 (`STATE.md ## Deferred Items` + `milestones/v1.1-MILESTONE-AUDIT.md`). Plus reconcile `HANDOFF-TO-MAC.md` deletion intent.
- [ ] **POLISH** — verify-gate consolidation, cargo/TS clean, v1.2 changelog entry, v1.2 milestone audit doc parallel to `v1.1-MILESTONE-AUDIT.md`.

**Explicitly deferred to v1.3+:** ACT (per-tentacle outbound first-class surface beyond JARVIS-mediated subset), Skills MVP (ELIZA / Obsidian / GSD as user-installable runtime skills), Tool-replacer (Hermes / OpenClaw / Cowork), WIRE3 (97 deferred backend modules — backlog work isn't milestone-shaped, pick individual items as acting-tentacle dependencies arise), Android control / camera access / OS customization, persona / user-clone / humor maturity pass.

**Reconciliation note:** This scope merges PROJECT.md's prior v1.1-close anchor candidates (JARVIS / ACT / BROWSER / UAT / WIRE3) with the maturity audit's "eval before flashy" insight from `v1-2-self-improvement-maturity.md`. The earlier brain-audit-only draft of `notes/v1-2-milestone-shape.md` was superseded after PROJECT.md and STATE.md were re-read end-to-end (the original draft was authored from notes alone, missing M-01's "v1.2 acting work" anchor).

Locked input: `.planning/notes/v1-2-milestone-shape.md` (status: locked, 2026-04-29).

### Out of Scope

Unchanged across v1.0 + v1.1:

- shadcn/Radix, Framer Motion, Zustand, React Router (D-01..D-05 stack decisions hold)
- Light theme / accent picker (deferred indefinitely)
- Mobile/web port (desktop-only by design)
- Backend rewrite beyond wiring gaps (M-01 anchor: v1.1 was wiring, not new features; v1.2 acting work obeys the same anchor)
- Multi-instance / business SDK (v2+ adjacent direction)
- Hyprland compositor integration (v2+ adjacent direction)
- Heads + Big Agent (v2+ — needs multiple acting tentacles per head to be useful)

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

*Last updated: 2026-04-29 — v1.2 milestone scoped via /gsd-new-milestone. Locked shape: `.planning/notes/v1-2-milestone-shape.md`. 5 phases (16–20): Eval → Doctor → JARVIS+Ego → Operator-UAT → Polish. 10–12 day target.*
