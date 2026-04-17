# BLADE — Skin Rebuild (V1)

## What This Is

BLADE is a desktop AI that lives on your machine — a "body" with 178 Rust modules (brain, organs, tentacles, DNA, nervous and immune systems) already built and working. This project is the **Skin rebuild**: a nuke-and-rebuild of the React frontend so every user-facing surface — 59 routes, 5 windows, onboarding, settings — gets a coherent, authentic macOS Liquid Glass treatment and is fully wired to the backend that already exists.

The backend is the body. The skin is what the user touches. V1 means every surface the user can reach is polished, wired, and reviewable.

## Core Value

**Every surface the user touches is coherent, Liquid-Glass-native, and wired end-to-end.** If a route exists in the app, it must feel like part of one living product. No orphan screens, no dead buttons, no stringly-typed invokes that silently fail.

## Requirements

### Validated

<!-- Backend capabilities already shipped; the Skin rebuild consumes them. -->

- ✓ Backend: 178 Rust modules, 764 `#[tauri::command]`s, 73 event emitters — existing
- ✓ Backend: 10 tentacles, 4 heads, 10 hormones, 12 body systems, body_registry — existing
- ✓ Chat pipeline: streaming, tool calls, 29 blade_* events — existing (to be re-wired)
- ✓ QuickAsk window, Main window — working today
- ✓ Design tokens: glass tiers, radii, motion curves in `src/index.css` — existing basis
- ✓ Onboarding backend: `get_onboarding_status`, `complete_onboarding`, deep_scan_* — existing
- ✓ Design references: 11 high-fidelity prototype screens in `docs/design/` — directional

### Active

<!-- V1 scope. Hypotheses until shipped. -->

- [ ] **Foundation** — design system primitives (Button, Card, Pill, Badge, GlassPanel, Orb, etc.), typed Tauri wrapper replacing all 234 raw invokes, shell skeleton, 5 window HTML entries
- [ ] **Onboarding** — 3 screens (provider pick / API key / deep scan ready), wired to onboarding backend
- [ ] **Main shell** — title bar, nav, command palette (⌘K), notification center, toast system, global overlays (catchup, glow, nudge, ambient strip)
- [ ] **Dashboard** — Right Now hero, Hive signals, Calendar, Integrations, Ambient strip
- [ ] **Chat** — side-panel over dashboard, streaming reply, tool calls inline, history drawer, file/image/voice inputs, approval dialogs
- [ ] **QuickAsk** — text mode + voice mode, live transcript, grouped results, bridge to main conversation
- [ ] **Voice Orb** — overlay window, 4 phase states (Idle / Listening / Thinking / Speaking), wake-word integration
- [ ] **Ghost Mode** — overlay window, meeting whisper, content protection, Cluely-format cards
- [ ] **Settings** — provider, key vault, routing, fallback, plus subtabs for every subsystem
- [ ] **HUD bar** — persistent live-state bar window (ambient strip twin)
- [ ] **Agents cluster** — AgentDashboard, AgentDetail, AgentFactory, AgentTeamPanel, AgentTimeline, BackgroundAgentsPanel, TaskAgentView, SwarmView
- [ ] **Knowledge cluster** — KnowledgeBase, KnowledgeGraphView, Memory Palace, ScreenTimeline, RewindTimeline, LiveNotes, DailyLogPanel, ConversationInsightsPanel
- [ ] **Life OS cluster** — HealthView, FinanceView, GoalView, HabitView, MeetingView, SocialGraphView, PredictionView, EmotionalIntelligenceView, AccountabilityView
- [ ] **Identity cluster** — SoulView, PersonaView/Page, CharacterBible, NegotiationView, ReasoningView, ContextEngineView, SidecarView
- [ ] **Dev tools cluster** — Terminal, FileBrowser, GitPanel, Canvas, WorkflowBuilder, WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, CodebaseExplorer, ComputerUsePanel
- [ ] **Admin cluster** — Analytics, CapabilityReports, DecisionLog, SecurityDashboard, TemporalPanel, Diagnostics, IntegrationStatus, McpSettings, ModelComparison, KeyVault
- [ ] **Body visualization** — surfaces for the body_registry / hormone bus / body systems / tentacle drill-in (backend exposes them; no UI today)
- [ ] **Hive mesh** — per-tentacle drill-in, autonomy controls, decision approval queue
- [ ] **Polish pass** — motion audit, keyboard shortcuts, accessibility, empty states, error boundaries, loading skeletons, cross-route consistency check

### Out of Scope

- **Light theme / accent picker** — single Liquid Glass dark treatment; `AccentPicker.tsx` will be removed. *Why: one authentic aesthetic beats several mediocre ones; matches prototype direction.*
- **React Router / routing library** — custom discriminated-union router kept, moved out of App.tsx. *Why: works, no reason to add a dependency.*
- **Zustand / Redux / Jotai** — keep `useChat` hook, no global store until a second cross-route state emerges. *Why: YAGNI — only chat is currently cross-route.*
- **Backend rewrite** — backend is mutable for wiring gaps only, not scope expansion. *Why: the body works; this project is the skin.*
- **Mobile / web port** — desktop-only Tauri. *Why: the whole product premise is local-first desktop.*
- **Framer Motion / motion library** — CSS-only motion with design tokens. *Why: the prototype is CSS-driven; adding a runtime dep is unwarranted.*
- **Per-tentacle new backend commands** — scope limited to wiring gaps surfaced during frontend work; net-new organ capabilities are a separate milestone. *Why: one thing at a time.*

## Context

- **Starting state.** `src/` backed up to `src.bak/` (5.2M mirror) before any edits. The current frontend is 1,300-line App.tsx monolith, 59 routes, 234 raw invokes, ~22% backend coverage, only 2 of 5 windows functional. Three windows (overlay, hud, ghost_overlay) reference HTML entries that don't exist — Rust crashes when it tries to open them.
- **Backend is complete and documented.** See `docs/architecture/2026-04-16-blade-body-architecture-design.md` and `docs/architecture/2026-04-17-blade-frontend-architecture.md`. `body_registry.rs` enumerates every subsystem. 593 backend commands currently have no frontend pathway.
- **Prototypes are directional, not authoritative.** `docs/design/` holds 11 HTML + PNG prototypes (onboarding ×3, dashboard, dashboard+chat, voice orb + states, ghost overlay, quickask ×2, settings). They define the visual language and key flows. Everything else I design to the same principles.
- **Liquid Glass as the system.** macOS-native Liquid Glass is the target aesthetic across all 5 windows — one material, one type scale, one grid, one motion curve. Research phase will codify the web-implementation pattern (backdrop-filter, specular highlights, refraction, depth stack, vibrancy).
- **Phased, reviewable.** You (Arnav) review each phase before the next begins. Research → Requirements → Roadmap happens once upfront; execution is phase-by-phase with approvals.
- **Backup discipline.** `src.bak/` is read-only reference. If any recovered pattern helps, we copy it forward and cite it; we do not import from it.

## Constraints

- **Tech stack:** React 19 + TypeScript + Vite 7 + Tauri 2.10 + Tailwind v4. No runtime CSS-in-JS, no motion lib, no state lib beyond React primitives — CSS/variables/useState suffice.
- **Build system:** `npm run tauri dev` for dev, `npm run tauri build` for prod. CI validates via `npx tsc --noEmit` + `cargo check`. No unit-test gate today.
- **Performance:** Main window sits on top of user's wallpaper; blur/backdrop-filter cost is real. Budget: dashboard first paint under 200ms, orb at 60fps during all 4 phase transitions.
- **Window chrome:** 4 of 5 windows are `decorations: false` + `transparent: true`. Main window already has this set. `macOSPrivateApi: true` already set for vibrancy.
- **Backend coupling:** `invoke()` uses snake_case Rust names, React convention is camelCase — typed wrapper must preserve Rust names exactly. Every new wrapper cites the Rust `file:line`.
- **Route addition cost:** today 3 edits in App.tsx. After Foundation phase, adding a route should be 1 file + auto-discovery.
- **Content protection:** Ghost overlay requires `set_content_protection` on the Rust side; already exists (`ghost_mode.rs:472`). We just need the HTML entry and React shell.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Nuke `src/` and rebuild; backup at `src.bak/` | Previous incremental approach wasn't converging; clean slate removes dead imports, broken overlays, visual drift | — Pending |
| Keep all 48 non-prototype routes, redesign them | Backend capability without UI is hidden capability; user explicitly wants every visible surface styled | — Pending |
| Liquid Glass (macOS-native) as single aesthetic, no light theme | Prototype direction + one authentic treatment beats several mediocre ones | — Pending |
| CSS-only motion; no Framer Motion | Prototype motion is CSS; adding runtime dep unwarranted | — Pending |
| Design tokens ported from `docs/design/shared.css` + `proto.css` + `orb.css` into `src/styles/` | Prototype CSS is closer to target than current `src/index.css` tokens | — Pending |
| Typed Tauri wrapper mandatory — no raw `invoke()` in components | 234 current raw sites = 234 refactor traps; typed wrapper cited against `body_registry.rs` | — Pending |
| Phase boundaries = review gates; parallel within a phase | Matches user's review cadence; independent plans can ship simultaneously | — Pending |
| `useChat` hook preserved conceptually but rewritten | Only cross-route state today; works; no need for global store yet | — Pending |
| Backend changes allowed but scoped to wiring gaps | Body works; this is the Skin — expansion belongs to a separate milestone | — Pending |

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
*Last updated: 2026-04-17 after initialization*
