# Requirements: BLADE Skin Rebuild (V1)

**Defined:** 2026-04-17
**Core Value:** Every surface the user touches is coherent, Liquid-Glass-native, and wired end-to-end. No orphan screens, no dead buttons, no stringly-typed invokes that silently fail.

## v1 Requirements

All 18 surface clusters ship in V1 per PROJECT.md Active scope and SUMMARY.md §MVP Scope Conflict Resolution. Each cluster is routable with no 404s; low-priority sub-views may ship as skeleton states, enforced by the Polish pass.

### Foundation (FOUND)

- [ ] **FOUND-01**: Design tokens defined in `src/styles/tokens.css` covering glass tiers (with opacity floor ≥0.55), blur caps (20/12/8px), radii, spacing, motion curves, typography, and accent palette — ported from `docs/design/shared.css` + `proto.css` + `orb.css`
- [ ] **FOUND-02**: 8 self-built primitives exported from `src/design-system/` — `Button`, `Card`, `GlassPanel`, `Input`, `Pill`, `Badge`, `GlassSpinner`, `Dialog` — every component uses only design tokens
- [ ] **FOUND-03**: Typed Tauri wrapper base `src/lib/tauri/_base.ts` exporting `invokeTyped<T>()` with `TauriError` normalization; raw `invoke()` banned in components
- [ ] **FOUND-04**: Typed wrapper files per backend module cluster in `src/lib/tauri/*.ts` — each wrapper cites Rust `file:function_name` in JSDoc, uses snake_case arg keys to match Rust params
- [ ] **FOUND-05**: Event registry `src/lib/events/index.ts` exports `BLADE_EVENTS` constants and payload types for all 29+ subscribed events; raw `listen()` banned outside this file
- [ ] **FOUND-06**: `useTauriEvent(name, handler)` hook handles subscription lifecycle, cleanup, and handler-in-ref pattern; used by every component that subscribes to Tauri events
- [ ] **FOUND-07**: Custom route registry in `src/lib/router.ts` replaces the 59-variant discriminated union; each feature exports `RouteDefinition[]` from its `index.ts`, aggregated at `src/windows/main/router.ts`
- [ ] **FOUND-08**: Adding a new route in an existing cluster costs exactly 1 file (feature component) + 1 registry entry (in the cluster's index) — no `App.tsx` edit required
- [ ] **FOUND-09**: `usePrefs()` hook reads a single `blade_prefs_v1` localStorage blob once on mount; replaces the 252 scattered localStorage sites in current code
- [ ] **FOUND-10**: `ConfigContext` provider exposes BLADE config from `get_config`; single source of truth for config reads across main window
- [ ] **FOUND-11**: Migration ledger at `.planning/migration-ledger.md` tracks every route in `src.bak/` → new component path → destination phase; no old route is removed before its new component ships and cross-route references update

### Windows (WIN)

- [ ] **WIN-01**: `index.html` (Main window) exists, loads `src/windows/main/main.tsx`, boots in <300ms dev
- [ ] **WIN-02**: `quickask.html` (QuickAsk window) exists, loads `src/windows/quickask/main.tsx`, transparent, decorationless, always-on-top, 500×72
- [ ] **WIN-03**: `overlay.html` (Voice Orb / overlay window) exists, loads `src/windows/overlay/main.tsx`; Rust window creation at `lib.rs:349` no longer crashes
- [ ] **WIN-04**: `hud.html` (HUD bar window) exists, loads `src/windows/hud/main.tsx`; Rust creation at `overlay_manager.rs:76` no longer crashes
- [ ] **WIN-05**: `ghost_overlay.html` (Ghost Mode window) exists, loads `src/windows/ghost/main.tsx`; Rust creation at `ghost_mode.rs:472` no longer crashes
- [ ] **WIN-06**: `vite.config.ts` declares all 5 entries; CI validates that every Vite input has a matching HTML file on disk
- [ ] **WIN-07**: Main window uses `window-vibrancy` on macOS for NSVisualEffectView chrome; CSS `backdrop-filter` handles in-webview glass panels
- [ ] **WIN-08**: Ghost overlay window created with `.content_protected(true)` at build time (not post-show); no cursor CSS on any ghost element
- [ ] **WIN-09**: All 5 windows present in prod build output (`dist/`); CI asserts presence

### Onboarding (ONBD)

- [ ] **ONBD-01**: First-launch detection — if `get_onboarding_status()` returns false, onboarding route mounts before any other surface
- [ ] **ONBD-02**: Provider picker screen — cards for Anthropic (pre-selected), OpenAI, Groq, Gemini, OpenRouter, Ollama with Free/Fast/Local badges
- [ ] **ONBD-03**: API key entry screen — smart paste detection, live test against provider, verified state visualization, error recovery
- [ ] **ONBD-04**: Deep scan screen — progress stream from `deep_scan_*` commands, 12 scanner indicators, "enter BLADE" CTA on completion
- [ ] **ONBD-05**: Onboarding calls `complete_onboarding(answers)` on finish; main shell mounts after completion
- [ ] **ONBD-06**: User can re-enter onboarding from Settings (re-init flow) without losing existing config

### Main Shell (SHELL)

- [ ] **SHELL-01**: Custom title bar (`decorations: false` window) with drag region, traffic lights on macOS, minimize/close on Windows/Linux
- [ ] **SHELL-02**: Left nav rail (62px wide per design tokens) with icon buttons for top-level routes; active route highlighted; hover reveals labels
- [ ] **SHELL-03**: Command Palette opens on `⌘K` / `Ctrl+K`, fuzzy-searches all routes and slash commands, keyboard-navigable, Esc closes
- [ ] **SHELL-04**: Toast/notification system via `ToastContext` — success, info, warning, error variants with Liquid Glass treatment, auto-dismiss, manual dismiss
- [ ] **SHELL-05**: NotificationCenter surfaces proactive cards, evolution suggestions, capability-gap alerts; accessible from nav
- [ ] **SHELL-06**: Global overlays — `CatchupOverlay`, `GlowOverlay`, `NudgeOverlay`, `AutoShowOverlay`, `AmbientStrip` — wired to their respective Tauri events via `useTauriEvent`
- [ ] **SHELL-07**: `App.tsx` (or equivalent shell component) stays under 300 lines; responsibilities delegated to composed hooks and components

### Dashboard (DASH)

- [ ] **DASH-01**: Dashboard is the default route when onboarding is complete
- [ ] **DASH-02**: Right Now hero card — prominent, displays current user focus from `perception_fusion`; one clear signal about what BLADE thinks is happening
- [ ] **DASH-03**: Hive signals card — streaming feed of organ/tentacle events (emails seen, PRs updated, meetings detected); click opens detail in corresponding cluster
- [ ] **DASH-04**: Calendar strip — today's events via integration_bridge (Google Calendar); shows current and next event
- [ ] **DASH-05**: Integrations grid — connection status pills for each enabled integration (Gmail, Slack, GitHub, Calendar, etc.); click opens settings
- [ ] **DASH-06**: Ambient strip — subtle bottom bar showing hormone state, god-mode tier, body status; wires to the new `hormone_update` backend event
- [ ] **DASH-07**: Floating chat FAB (bottom-right) opens the chat side panel without leaving dashboard context
- [ ] **DASH-08**: Dashboard first paint ≤200ms on integrated GPU; max 3 simultaneous backdrop-filter elements enforced

### Chat (CHAT)

- [ ] **CHAT-01**: Chat side panel slides in over dashboard, 400px wide, Liquid Glass tier-2 treatment, Esc dismisses, `⌘/` toggles
- [ ] **CHAT-02**: Input bar accepts text, voice (push-to-talk), file drop, image drop, slash commands (`/screenshot`, `/voice`, `/memory`, etc.)
- [ ] **CHAT-03**: User messages stream via `send_message_stream`; tokens render via `blade_stream_chunk` events; "compacting…" indicator shows when `blade_token_ratio > 0.65`
- [ ] **CHAT-04**: Assistant reasoning displays as collapsible "thinking" section when `blade_thinking_chunk` events arrive
- [ ] **CHAT-05**: Tool calls render inline with status pill (pending/running/complete/error) and result preview; approval-required tools block on `ToolApprovalDialog`
- [ ] **CHAT-06**: `ToolApprovalDialog` "Approve" button disabled for 500ms after appearing; buttons never appear under the cursor unchanged
- [ ] **CHAT-07**: History drawer lists past conversations from `history_save_conversation`/`history_list_*` commands; click restores
- [ ] **CHAT-08**: "New conversation" button clears state without blocking on stream completion
- [ ] **CHAT-09**: Chat streaming does not cause App-level re-renders; message list scrolls to bottom on new token without layout thrash
- [ ] **CHAT-10**: Chat message bubbles use rgba solid fills, NOT backdrop-filter (preserves GPU budget)

### QuickAsk (QUICK)

- [ ] **QUICK-01**: QuickAsk window toggles on global shortcut `Alt+Space` (default, configurable); shows/hides instantly
- [ ] **QUICK-02**: Text mode — input pill, streamed answer, grouped results (web / memory / tools), keyboard-first dismissal
- [ ] **QUICK-03**: Voice mode toggle (`Ctrl+Shift+B`) — orb hero, live transcript, submit on silence or Enter
- [ ] **QUICK-04**: QuickAsk submission calls `invoke("quickask_submit", …)` → Rust pipelines through chat system → emits `blade_quickask_bridged { conversation_id }` → main window reacts
- [ ] **QUICK-05**: Main window's history drawer contains the QuickAsk conversation after bridge fires (verified by test)
- [ ] **QUICK-06**: QuickAsk pins results to clipboard on "copy" affordance; history persists via `blade_quickask_history_v1` prefs
- [ ] **QUICK-07**: QuickAsk window has its own React tree; shares no direct state with Main — communication is only via backend events

### Voice Orb (ORB)

- [ ] **ORB-01**: Voice Orb is the overlay window (`overlay.html`), transparent, decorationless, always-on-top, centered on active monitor
- [ ] **ORB-02**: Four phase states visualized — Idle, Listening, Thinking, Speaking; state transitions driven by `voice_conversation_*` events
- [ ] **ORB-03**: Orb animation uses OpenClaw math verbatim — `1 + (level * 0.12)` listening scale, `1 + 0.06 * sin(t * 6Hz)` speaking, 0.28 ring stagger, 0.45/0.55 EMA
- [ ] **ORB-04**: Thinking phase — arc1 trim(0.08, 0.26) at +42°/s @ 0.88 opacity; arc2 trim(0.62, 0.86) at −35°/s @ 0.70 opacity
- [ ] **ORB-05**: Render loop is `requestAnimationFrame` at 60fps setting CSS custom properties; audio level sampling runs on a separate 12fps (83ms) loop
- [ ] **ORB-06**: Wake word "Hey BLADE" triggers Listening state via `wake_word_detected` event
- [ ] **ORB-07**: Click-to-cancel (ends current voice turn); double-click to open QuickAsk text; drag to reposition (position persists via plugin-window-state)
- [ ] **ORB-08**: Orb maintains 60fps on target hardware (MacBook Air M1 / integrated Intel GPU)

### Ghost Mode (GHOST)

- [ ] **GHOST-01**: Ghost overlay window created with `.content_protected(true)` at creation; never visible in screen-share on macOS (except Zoom — document in Settings tooltip) or Windows
- [ ] **GHOST-02**: Meeting detection from `audio_timeline.rs` VAD + `meeting_detected` events activates ghost mode
- [ ] **GHOST-03**: Ghost card format — `<h3>` ≤6 words, 1–2 bullets ≤15 words each, max 60 chars/line, no markdown renderer
- [ ] **GHOST-04**: Confidence gate — ghost fires only when decision-gate confidence ≥50%
- [ ] **GHOST-05**: Detection window — last 10–15 words of transcript (not full context)
- [ ] **GHOST-06**: No cursor CSS on any ghost element (`cursor: default` only); click-through disabled; Esc hides
- [ ] **GHOST-07**: Linux fallback — if content protection unsupported, show explicit warning before activation, require re-confirm
- [ ] **GHOST-08**: Ghost-toggle event wires to `ghost_toggle_card` backend event; user can dismiss with `ghost_meeting_ended`

### HUD Bar (HUD)

- [ ] **HUD-01**: HUD bar window (`hud.html`), small always-on-top strip (positioned near menu bar on macOS, system tray on Windows)
- [ ] **HUD-02**: Displays live state — current god-mode tier, hormone dominant state, orb mini-indicator, CPU/memory health
- [ ] **HUD-03**: Click opens Main window; right-click opens mini menu (settings, focus mode, quit)
- [ ] **HUD-04**: HUD subscribes to `blade_status`, `hormone_update`, `world_state_updated` events
- [ ] **HUD-05**: HUD toggle can be disabled via Settings → Ambient → HUD bar

### Settings (SET)

- [ ] **SET-01**: Settings route with left tab rail — General, Providers, Integrations, Voice, Ghost, Ambient, Autonomy, Shortcuts, Advanced, About
- [ ] **SET-02**: Providers tab — key vault per provider, smart paste, test button, live verified state, routing grid with fallback chains
- [ ] **SET-03**: Integrations tab — enable/disable per integration (Gmail/Slack/GitHub/Calendar/Linear/Discord/Spotify/Home Assistant), OAuth flows, MCP server management
- [ ] **SET-04**: Voice tab — wake-word on/off, TTS voice pick, push-to-talk binding, voice conversation mode toggle
- [ ] **SET-05**: Ghost tab — content-protection explainer, Zoom caveat tooltip, confidence threshold slider, auto-activate on meeting toggle
- [ ] **SET-06**: Ambient tab — god-mode tier (Normal/Intermediate/Extreme), ambient strip toggle, HUD bar toggle, proactive engine on/off
- [ ] **SET-07**: Autonomy tab — decision gate thresholds, auto-reply toggle, approval preferences per tool category
- [ ] **SET-08**: Shortcuts tab — list all global + in-app shortcuts with rebind affordance; CJK IME warning if `Ctrl+Space` selected
- [ ] **SET-09**: Advanced tab — debug toggles, config export/import, factory reset, re-run onboarding
- [ ] **SET-10**: About tab — version, update status, credits, links to `GITHUB.com/sb-arnav/blade`, latest release

### Agents Cluster (AGENT)

- [ ] **AGENT-01**: AgentDashboard route — overview of all running/idle agents with status pills, spawn counts, last activity
- [ ] **AGENT-02**: AgentDetail route — per-agent timeline via `blade_agent_event` events, current task, history
- [ ] **AGENT-03**: AgentFactory route — create custom agents, configure tools/model/prompt, save to persona library
- [ ] **AGENT-04**: AgentTeamPanel — view+edit agent teams (swarm plans), role assignments
- [ ] **AGENT-05**: AgentTimeline — cross-agent chronological view of actions
- [ ] **AGENT-06**: BackgroundAgentsPanel — Claude Code / Aider / Goose workers, spawn/cancel
- [ ] **AGENT-07**: TaskAgentView — in-flight task agents with tool traces
- [ ] **AGENT-08**: SwarmView — DAG-based parallel plan visualization, wave timing, step drill-in
- [ ] **AGENT-09**: AgentPixelWorld / AgentVerification — surfaces retained from existing code, restyled
- [ ] **AGENT-10**: Agents cluster wires `swarm_*`, `agents_*` commands via `src/lib/tauri/agents.ts`

### Knowledge Cluster (KNOW)

- [ ] **KNOW-01**: KnowledgeBase route — search across memory, entities, conversations; result groups; preview pane
- [ ] **KNOW-02**: KnowledgeGraphView — entity-relationship graph from `knowledge_graph.rs`; clickable nodes
- [ ] **KNOW-03**: Memory Palace view — typed memory by category (Fact/Preference/Decision/Skill/Goal/Routine/Relationship)
- [ ] **KNOW-04**: ScreenTimeline — scrubber over 30s-interval screenshots, semantic search box, date filter
- [ ] **KNOW-05**: RewindTimeline — time-machine view over recent activity with context summaries
- [ ] **KNOW-06**: LiveNotes — in-session note surface; auto-capture meeting highlights
- [ ] **KNOW-07**: DailyLogPanel — daily journal from Journal Organ output; editable
- [ ] **KNOW-08**: ConversationInsightsPanel — cross-conversation analytics, recurring themes, sentiment shifts
- [ ] **KNOW-09**: CodebaseExplorer — indexed repos from GitHub Organ; architecture summary, hot paths
- [ ] **KNOW-10**: Knowledge cluster wires `memory_*`, `kg_*`, `screen_*`, `embeddings_*`, `temporal_*` commands

### Life OS Cluster (LIFE)

- [ ] **LIFE-01**: HealthView — screen-time trends, break reminders, posture/hydration nudges from `health_guardian.rs`
- [ ] **LIFE-02**: FinanceView — spending overview, subscriptions list, CSV import affordance
- [ ] **LIFE-03**: GoalView — short/medium/long-term goals, progress indicators, linked projects
- [ ] **LIFE-04**: HabitView — habit grid, streak counters, today's habits
- [ ] **LIFE-05**: MeetingView — upcoming and past meetings, transcripts, post-meeting summaries
- [ ] **LIFE-06**: SocialGraphView — people graph with recent-interaction edges, response priority indicators
- [ ] **LIFE-07**: PredictionView — BLADE's forward-looking predictions with confidence; user can confirm/disconfirm
- [ ] **LIFE-08**: EmotionalIntelligenceView — mood signals, stress indicators, well-being trend
- [ ] **LIFE-09**: AccountabilityView — user-set commitments, check-in cadence, success rate
- [ ] **LIFE-10**: Life OS cluster wires `financial_*`, `health_*`, `goal_*`, `habit_*`, `streak_*`, `people_graph_*` commands

### Identity Cluster (IDEN)

- [ ] **IDEN-01**: SoulView — consolidated identity view (identity.md + voice.md + personality.md + preferences.md)
- [ ] **IDEN-02**: PersonaView / PersonaPage — big-5 traits, communication style, decision-making preferences
- [ ] **IDEN-03**: CharacterBible — trait evolution log (from character.rs feedback), key behaviors
- [ ] **IDEN-04**: NegotiationView — active negotiations, debate engine controls
- [ ] **IDEN-05**: ReasoningView — reasoning trace display, causal chain visualization
- [ ] **IDEN-06**: ContextEngineView — current context blocks (Letta-style virtual context)
- [ ] **IDEN-07**: SidecarView — external import/export of personality mirror
- [ ] **IDEN-08**: EmotionalIntelligenceView integrates with Identity cluster for cross-links
- [ ] **IDEN-09**: Identity cluster wires `persona_*`, `character_*`, `personality_mirror_*`, `typed_memory_*`, `reasoning_*`, `negotiation_*` commands

### Dev Tools Cluster (DEV)

- [ ] **DEV-01**: Terminal surface — embedded terminal that routes through `native_tools.rs` bash tool
- [ ] **DEV-02**: FileBrowser — tree view of project roots, file preview, open-in-editor affordance
- [ ] **DEV-03**: GitPanel — current repo status, recent commits, blade-assisted commit drafting
- [ ] **DEV-04**: Canvas — freeform canvas for diagrams, mermaid rendering
- [ ] **DEV-05**: WorkflowBuilder — visual automation builder
- [ ] **DEV-06**: WebAutomation — CDP browser agent control, goal entry, live screen
- [ ] **DEV-07**: EmailAssistant — draft reply surface, style mirror, send affordance
- [ ] **DEV-08**: DocumentGenerator — structured document creation from templates
- [ ] **DEV-09**: CodeSandboxView — inline code execution results
- [ ] **DEV-10**: ComputerUsePanel — keyboard/mouse automation UI
- [ ] **DEV-11**: Dev Tools cluster wires `browser_*`, `computer_use_*`, `system_control_*`, `native_tools_*` commands

### Admin Cluster (ADMIN)

- [ ] **ADMIN-01**: Analytics — usage metrics, token consumption, per-provider cost breakdown
- [ ] **ADMIN-02**: CapabilityReports — gap detection summary, evolution suggestions, skill pack view
- [ ] **ADMIN-03**: DecisionLog — decision-gate history with act/ask/queue/ignore outcomes, thumbs-up/down feedback
- [ ] **ADMIN-04**: SecurityDashboard — security monitor output (network, phishing, breach, sensitive files)
- [ ] **ADMIN-05**: TemporalPanel — activity recall, standup, detected patterns
- [ ] **ADMIN-06**: Diagnostics — module health, background task status, error log
- [ ] **ADMIN-07**: IntegrationStatus — connection health, OAuth expiry, rate-limit state
- [ ] **ADMIN-08**: McpSettings — MCP server catalog, health, quality ranking
- [ ] **ADMIN-09**: ModelComparison — model routing decisions explained, A/B evaluation surface
- [ ] **ADMIN-10**: KeyVault surface — per-provider keys with masked display, test affordance, rotate flow

### Body Visualization (BODY)

- [ ] **BODY-01**: BodyMap route — interactive visualization of 12 body systems from `body_registry.rs`
- [ ] **BODY-02**: BodySystemDetail — per-system drill-in (cardiovascular, urinary, reproductive, joints, supervisor, etc.)
- [ ] **BODY-03**: Hormone bus dashboard — live hormone state (10 hormones) with current dominant signal; uses new `hormone_update` event
- [ ] **BODY-04**: Organ registry view — list of all organs, their current task, last-reported status
- [ ] **BODY-05**: DNA surface — structured view of `identity.md`, `voice.md`, `personality.md`, `goals.md`, `preferences.md`, people/teams/companies files; editable
- [ ] **BODY-06**: World-model surface — `infrastructure.md`, `codebases/*.md`, `services.md`, `integrations.md` viewer
- [ ] **BODY-07**: Body cluster wires `body_*`, `cardiovascular_*`, `urinary_*`, `reproductive_*`, `joints_*`, `supervisor_*`, `homeostasis_*` commands

### Hive Mesh (HIVE)

- [ ] **HIVE-01**: Hive landing — overview of all 10 tentacles (github, slack, email, calendar, discord, linear, cloud, log, terminal, filesystem) with autonomy indicators
- [ ] **HIVE-02**: Per-tentacle drill-in — tentacle-specific surfaces showing current task, autonomy level, recent decisions
- [ ] **HIVE-03**: Autonomy controls — per-tentacle slider from "ask always" through "act on high confidence" to "full autonomy"
- [ ] **HIVE-04**: Decision approval queue — pending approvals from all tentacles, batch-approve, per-decision drill-in
- [ ] **HIVE-05**: `hive_*` commands wired via `src/lib/tauri/hive.ts`; per-tentacle commands wired via corresponding module wrappers
- [ ] **HIVE-06**: AI Delegate review surface — listens to `ai_delegate_*` events, shows act/ask/queue/ignore outcomes, allows feedback

### Polish Pass (POL)

- [ ] **POL-01**: Motion audit — every transition uses design-token durations and eases; no ad-hoc CSS `transition` values
- [ ] **POL-02**: Keyboard shortcuts — every route has documented primary shortcuts; `⌘?` opens shortcut help
- [ ] **POL-03**: Accessibility — WCAG AA 4.5:1 contrast enforced on all text over glass; focus traps in dialogs; tab-order verified
- [ ] **POL-04**: Empty states — every data-driven view ships an empty state with clear CTA
- [ ] **POL-05**: Error boundaries — every top-level route wrapped; errors show recovery affordance (retry / reset / report)
- [ ] **POL-06**: Loading skeletons — every async surface shows a Liquid Glass skeleton, not a spinner
- [ ] **POL-07**: Cross-route consistency — visual audit across all 59 routes verifying same primitives, spacing, glass tiers
- [ ] **POL-08**: Prod build verification — all 5 windows open, all 59 routes mount without errors, no orphan screens
- [ ] **POL-09**: Performance budget — dashboard first paint ≤200ms on integrated GPU; orb 60fps; chat stream without re-render storm
- [ ] **POL-10**: Contrast test — 4.5:1 WCAG AA verified on 5 representative wallpapers (light, dark, colorful, high-contrast, photographic)

### Backend Wiring Gaps (WIRE)

Backend-side requirements that must be fulfilled during the Skin rebuild per PROJECT.md ("backend is mutable for wiring gaps only"):

- [ ] **WIRE-01**: `quickask_submit` command in `commands.rs` — pipelines QuickAsk input through chat system, emits `blade_quickask_bridged { conversation_id }` to main window
- [ ] **WIRE-02**: `hormone_update` event emitted from `homeostasis.rs` on each cycle with current state; consumed by Dashboard ambient strip + Body hormone dashboard
- [ ] **WIRE-03**: `blade_message_start` event emitted at beginning of each streaming response; consumed by Chat for state machine
- [ ] **WIRE-04**: `blade_thinking_chunk` event emitted during Claude 3.5+ extended thinking; consumed by Chat collapsible thinking section
- [ ] **WIRE-05**: `blade_agent_event` event emitted per swarm step with `{ step_id, tool_name, status, result_preview }`; consumed by AgentDetail timeline
- [ ] **WIRE-06**: `blade_token_ratio` event emitted when token count / context window > 0.65; consumed by Chat "compacting…" indicator
- [ ] **WIRE-07**: VAD implementation in `audio_timeline.rs` using Pluely config (sensitivity_rms=0.012, peak_threshold=0.035, silence_chunks=45, min_speech_chunks=7, pre_speech_chunks=12, 0.27s pre-roll); consumed by Ghost Mode + Voice Orb
- [ ] **WIRE-08**: `emit_all` audit — classify every `emit_all` call in Rust codebase as single-window or cross-window; single-window cases refactored to `emit_to(label, …)` to prevent cross-window event contamination

## v2 Requirements

Deferred beyond this milestone. Tracked but not in current roadmap.

### Light theme / theming
- **THEME-01**: Light theme support — deferred; V1 is single dark Liquid Glass treatment

### Mobile / web port
- **MOBILE-01**: Mobile version — deferred; V1 is desktop-only Tauri

### Additional provider integrations
- **PROV-V2-01**: Local model auto-discovery (Ollama registry scan)
- **PROV-V2-02**: Per-model routing optimizer UI (auto-tune based on telemetry)

### Advanced observability
- **OBS-V2-01**: Built-in trace viewer for agent runs
- **OBS-V2-02**: Memory growth / hot-path profiler surface

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| shadcn/ui or Radix primitives | DOM constraints fight Liquid Glass; 8 self-built primitives suffice (D-01, STACK.md:441-446) |
| Framer Motion or Motion One | CSS-only motion is sufficient per PROJECT.md; 31KB gzip cost unwarranted (D-02) |
| TauRPC / tauri-typegen | Requires backend rewrite or fails on BLADE macros; hand-written wrappers chosen (D-03) |
| Zustand / Redux / Jotai | No second cross-route state today; YAGNI (D-04) |
| React Router / Wouter | Tauri has no URL needs; History API conflicts; custom registry works (D-05) |
| Light theme / accent picker in V1 | One authentic Liquid Glass aesthetic beats multiple mediocre ones (D-15) |
| Backend rewrites beyond wiring gaps | Body is already built; this is Skin, not Body expansion |
| New net tentacle / organ capabilities | Scope-bound to surfacing existing backend, not expanding it |
| Mobile or web version | Product is desktop-only Tauri by design |
| tauri-plugin-liquid-glass | Private macOS API, App Store risk; `window-vibrancy` is the official path |
| Auto-motion on idle surfaces | Feels intrusive; anti-feature flagged in FEATURES.md |
| Nuclear delete without granular control | Anti-feature; every destructive action needs per-item confirmation |
| OS-level notification spam | Anti-feature; notifications route through in-app NotificationCenter + ambient strip only |
| Raw internal naming in user-facing UI | Anti-feature; backend modules never surface by their Rust names |

## Traceability

Populated by `/gsd-roadmapper` during roadmap creation. Each v1 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 through FOUND-11 | Phase 1 — Foundation | Pending |
| WIN-01 through WIN-09 | Phase 1 — Foundation | Pending |
| WIRE-08 | Phase 1 — Foundation | Pending |
| ONBD-01 through ONBD-06 | Phase 2 — Onboarding + Main Shell | Pending |
| SHELL-01 through SHELL-07 | Phase 2 — Onboarding + Main Shell | Pending |
| DASH-01 through DASH-08 | Phase 3 — Dashboard + Chat + Settings | Pending |
| CHAT-01 through CHAT-10 | Phase 3 — Dashboard + Chat + Settings | Pending |
| SET-01 through SET-10 | Phase 3 — Dashboard + Chat + Settings | Pending |
| WIRE-01 through WIRE-06 | Phase 3 — Dashboard + Chat + Settings | Pending |
| QUICK-01 through QUICK-07 | Phase 4 — Overlay Windows | Pending |
| ORB-01 through ORB-08 | Phase 4 — Overlay Windows | Pending |
| GHOST-01 through GHOST-08 | Phase 4 — Overlay Windows | Pending |
| HUD-01 through HUD-05 | Phase 4 — Overlay Windows | Pending |
| WIRE-07 | Phase 4 — Overlay Windows | Pending |
| AGENT-01 through AGENT-10 | Phase 5 — Agents + Knowledge | Pending |
| KNOW-01 through KNOW-10 | Phase 5 — Agents + Knowledge | Pending |
| LIFE-01 through LIFE-10 | Phase 6 — Life OS + Identity | Pending |
| IDEN-01 through IDEN-09 | Phase 6 — Life OS + Identity | Pending |
| DEV-01 through DEV-11 | Phase 7 — Dev Tools + Admin | Pending |
| ADMIN-01 through ADMIN-10 | Phase 7 — Dev Tools + Admin | Pending |
| BODY-01 through BODY-07 | Phase 8 — Body Visualization + Hive Mesh | Pending |
| HIVE-01 through HIVE-06 | Phase 8 — Body Visualization + Hive Mesh | Pending |
| POL-01 through POL-10 | Phase 9 — Polish Pass | Pending |

**Coverage:**
- v1 requirements: **156 total** across 21 categories
- Mapped to phases: **156/156** ✓
- Unmapped: 0 ✓ (roadmap complete 2026-04-17)

---
*Requirements defined: 2026-04-17*
*Last updated: 2026-04-17 after initial definition*
