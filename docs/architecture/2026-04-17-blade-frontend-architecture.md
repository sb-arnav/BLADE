# BLADE Frontend Architecture

**Date:** 2026-04-17
**Status:** Live state + target structure
**Scope:** The React + Vite + Tauri webview half of BLADE — what's in `src/`, what windows exist, how they talk to the Rust backend, and where the real broken edges are.
**Pair doc:** `2026-04-16-blade-body-architecture-design.md` covers the backend (Rust, 178 modules).

> All rows below verified against live source on 2026-04-17. Every claim cites a file path — line numbers are approximate. Where a claim could not be verified, it's flagged "unclear."

---

## Live stats

| Metric | Count |
|---|---|
| Total `.tsx` + `.ts` files under `src/` | 293 |
| Component `.tsx` files in `src/components/` | 159 |
| Hook `.ts` files in `src/hooks/` | 96 |
| Library files in `src/lib/` | 18 |
| Utils files in `src/utils/` | 3 |
| Root HTML entry files | **2** (should be 5 — 3 missing) |
| Vite entries declared in `vite.config.ts` | 5 (main, quickask, overlay, hud, ghost_overlay) |
| Bootstrap `.tsx` files | 5 (matches Vite entries) |
| `invoke(...)` call sites across `src/` | 234 |
| `listen(...)` call sites | 43 |
| `emit(...)` call sites | 4 |
| Unique backend commands reached | ~171 (of 764 registered — **~22% coverage**) |
| Unique backend events subscribed | 29 |
| `localStorage` / `sessionStorage` sites | 252 |
| `useState` + `useEffect` + `useRef` + `useContext` | 2,416 |
| React Context providers | **1** (`ToastContext` in `src/components/Toast.tsx`) |
| State libraries (Zustand / Redux / Jotai / Valtio / Recoil) | **0** — none |
| Routes declared in `App.tsx` | **59** (union type) |

---

## The model — 5 windows, 1 shell, 1 router

BLADE's frontend is a **multi-window** Tauri app (not a single SPA). Each window is a separate webview with its own Vite entry, its own bootstrap `.tsx`, and its own top-level React component. The Rust backend creates the windows on startup or on-demand, pointing each at a specific HTML file.

```
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN WINDOW   (index.html → src/main.tsx → <App/>)                 │
│  1,300-line App.tsx state machine:                                  │
│    • 59-route discriminated union                                   │
│    • 59 lazy-loaded view components under src/components/           │
│    • global overlays: OnboardingFlow, CatchupOverlay, AutoShow,     │
│      GlowOverlay, NudgeOverlay, AmbientStrip, TitleBar,             │
│      CommandPalette (⌘K), NotificationCenter                        │
│    • chat state via useChat() hook                                  │
│    • 43 Tauri event subscribers inline in useEffect blocks          │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  QUICKASK      (quickask.html → src/quickask.tsx → <QuickAsk/>)     │
│  500×72 floating pill, always-on-top, transparent, hidden default   │
│  Toggled by global shortcut (Rust: lib.rs:274, default Ctrl+Space)  │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  OVERLAY       (overlay.html ← MISSING → src/overlay.tsx)           │
│  Fullscreen capture/annotation layer. Created by Rust at            │
│  lib.rs:349-366 — will fail at runtime because HTML doesn't exist.  │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  HUD           (hud.html ← MISSING → src/hud.tsx)                   │
│  Persistent live-state bar. Created by Rust at                      │
│  overlay_manager.rs:76 — will fail at runtime.                      │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│  GHOST OVERLAY (ghost_overlay.html ← MISSING → src/ghost_overlay.tsx│
│  Meeting stealth mode with content protection. Created by Rust at   │
│  ghost_mode.rs:472 — will fail at runtime.                          │
└─────────────────────────────────────────────────────────────────────┘
```

Only the first two windows (Main, QuickAsk) work today. Three windows are **half-restored** — their bootstrap TSX + components exist, the Rust side tries to create them, but the HTML entries are missing. Build will still succeed because Vite only warns; runtime fails when Rust calls `WebviewUrl::App("overlay.html")`.

---

## Layer 0 — Entry points

| Window | HTML | Bootstrap | Top component | Tauri label | Window config | Status |
|---|---|---|---|---|---|---|
| Main | `index.html` | `src/main.tsx` | `App` | `"main"` | regular chrome, sized by window-state plugin | **Working** |
| QuickAsk | `quickask.html` | `src/quickask.tsx` | `QuickAsk` | `"quickask"` | 500×72, transparent, decorationless, always-on-top, hidden (`src-tauri/src/lib.rs:1275-1293`) | **Working** |
| Overlay | _missing_ | `src/overlay.tsx` | `ScreenOverlay` | `"overlay"` | fullscreen, transparent, always-on-top (`src-tauri/src/lib.rs:349-366`) | **Broken** (no HTML) |
| HUD | _missing_ | `src/hud.tsx` | `HudBar` | `"hud"` | declared in overlay manager (`src-tauri/src/overlay_manager.rs:76`) | **Broken** (no HTML) |
| Ghost overlay | _missing_ | `src/ghost_overlay.tsx` | `GhostOverlay` | `"ghost_overlay"` | transparent, content-protect, created on ghost-mode start (`src-tauri/src/ghost_mode.rs:472`) | **Broken** (no HTML) |

**Fix for the three broken ones:** three tiny HTML files that follow the `quickask.html` template. Until that ships, global shortcuts that toggle these windows, and any proactive Rust code that creates them, will either silently fail or throw.

---

## Layer 1 — Routing (inside the main window)

There is no React Router / Wouter. Routing is a **custom discriminated union** with a switch-map.

**Route state** — `src/App.tsx:71`:
```ts
type Route = "chat" | "settings" | "discovery" | … | "task-agents";   // 59 variants
```

**State holder** — `src/App.tsx:211`:
```ts
const [route, setRoute] = useState<Route>("dashboard");
```

**Navigation** — `src/App.tsx:877`:
```ts
const openRoute = useCallback((nextRoute: Route, intent?: { title; note }) => {
  setRoute(nextRoute);
  setWorkspaceIntent(intent ? { route: nextRoute, ...intent } : …);
}, []);
```

**View-mounting table** — `src/App.tsx:1117-1189`:
```ts
const fullPageRoutes: Record<string, React.ReactNode> = {
  analytics:     <Analytics onBack={() => openRoute("dashboard")} />,
  knowledge:     <KnowledgeBase onBack={…} … />,
  /* …59 route→component mappings… */
};
// src/App.tsx:1234
{fullPageRoutes[route] ?? fullPageRoutes["dashboard"]}
```

**Deep-link entry points:**
- **Command Palette (⌘K)** — 59 commands declared at `src/App.tsx:986-1078`, each calls `openRoute(...)` or a direct invoke
- **Slash commands** in `InputBar`: `/terminal`, `/canvas`, `/workflows`, `/swarm`, `/timeline`, `/screenshot`, `/voice`, `/help`, `/memory`, `/research`, `/think`
- **Tray menu** — `src/App.tsx:785` listens to `"open_settings_tab"` event
- **Backend pushes** — e.g. `capability_gap_detected` → `openRoute("reports")` (`src/App.tsx:341`); `evolution_suggestion` → `openRoute("dashboard")` (`src/App.tsx:546`)

**Adding a new route costs 3 edits in `App.tsx`:**
1. Add to the `type Route` union (line 71)
2. Add a `lazy(() => import(...))` declaration (lines 73–142)
3. Add a `fullPageRoutes["new-route"]` entry (lines 1117–1189)

**Fallback:** any unknown route silently resolves to Dashboard (line 1234).

---

## Layer 2 — Component organisation

159 components grouped by feature surface. Not every component below is equally complete — many are pre-rebuild leftovers.

| Feature group | Rough count | Example files | Notes |
|---|---|---|---|
| Chat core | 5 | `ChatWindow.tsx`, `ChatPanel.tsx`, `InputBar.tsx`, `MessageList.tsx` | Main-window chat surface + streaming |
| Global overlays & modals | 8 | `OnboardingModal.tsx`, `CatchupOverlay.tsx`, `AutoShowOverlay.tsx`, `GlowOverlay.tsx`, `NudgeOverlay.tsx`, `CommandPalette.tsx`, `NotificationCenter.tsx` | Wrapped around main content in App.tsx |
| Agents & execution | 15 | `OperatorCenter.tsx`, `AgentDashboard.tsx`, `AgentTeamPanel.tsx`, `AgentDetailPanel.tsx`, `AgentFactory.tsx`, `BackgroundAgentsPanel.tsx`, `TaskAgentView.tsx`, `SwarmView.tsx` | Agent routes: `agents` / `bg-agents` / `swarm` |
| Work workspace | 8 | `Terminal.tsx`, `FileBrowser.tsx`, `GitPanel.tsx`, `Canvas.tsx`, `WorkflowBuilder.tsx`, `WebAutomation.tsx`, `EmailAssistant.tsx`, `DocumentGenerator.tsx` | Dev-tool surfaces |
| Knowledge & memory | 7 | `KnowledgeBase.tsx`, `KnowledgeGraphView.tsx`, `ScreenTimeline.tsx`, `RewindTimeline.tsx`, `LiveNotes.tsx`, `DailyLogPanel.tsx`, `ConversationInsightsPanel.tsx` | Search, graph, timeline |
| Analytics & reports | 5 | `Analytics.tsx`, `CapabilityReports.tsx`, `ModelComparison.tsx`, `DecisionLog.tsx` | Usage + capability gaps |
| Life features | 10 | `HealthView.tsx`, `FinanceView.tsx`, `MeetingView.tsx`, `HabitView.tsx`, `GoalView.tsx`, `SocialGraphView.tsx`, `PredictionView.tsx`, `EmotionalIntelligenceView.tsx` | Personal OS surfaces |
| Settings & config | 10 | `Settings.tsx`, `ThemePicker.tsx`, `SystemPromptPreview.tsx`, `TemplateManager.tsx`, `ShortcutHelp.tsx`, `InitWizard.tsx`, `DeepLearn.tsx`, `McpSettings.tsx`, `IntegrationStatus.tsx` | Config + onboarding + MCP + integrations |
| Autonomy & persona | 10 | `SoulView.tsx`, `PersonaView.tsx`, `PersonaPage.tsx`, `CharacterBible.tsx`, `NegotiationView.tsx`, `ContextEngineView.tsx`, `ReasoningView.tsx`, `SidecarView.tsx`, `AccountabilityView.tsx` | Identity, traits, reasoning |
| Security & monitoring | 5 | `SecurityDashboard.tsx`, `HealthPanel.tsx`, `TemporalPanel.tsx`, `Diagnostics.tsx`, `LogMonitor.tsx` | Audit + diagnostics |
| Floating windows | 4 | `QuickAsk.tsx`, `HudBar.tsx`, `ScreenOverlay.tsx`, `GhostOverlay.tsx` | One per non-main window |
| Smart home & IoT | 1 | `SmartHomePanel.tsx` | Home Assistant + Spotify |
| Specialized workspaces | 15 | `KaliView.tsx`, `CodeSandboxView.tsx`, `WorkflowBuilderView.tsx`, `Dashboard.tsx`, `FocusMode.tsx`, `FocusPage.tsx`, `InsightPage.tsx`, `PersonaPage.tsx`, `SkillPackView.tsx`, `Discovery.tsx`, `Hive.tsx`, `ComputerUsePanel.tsx`, `ContextEngineView.tsx` | Advanced features |
| Shared primitives | ~20 | `ActivityFeed.tsx`, `DataTable.tsx`, `ChartRenderer.tsx`, `Breadcrumb.tsx`, `SearchBox.tsx`, `Toast.tsx`, `ToolApprovalDialog.tsx`, plus inline Button/Card/Pill/Badge/Alert across components | **No dedicated primitive library file** — each component inlines its own Tailwind |

---

## Layer 3 — State management

**There is no global store.** No Zustand, Redux, Jotai, Valtio, Recoil — check `package.json`. The only React Context is `ToastContext` in `src/components/Toast.tsx`.

**Actual state layout:**

| Holder | Mechanism | Scope |
|---|---|---|
| Chat (messages, conversations, tool executions, approvals) | `useChat()` hook — `src/hooks/useChat.ts` | Main-window chat panel |
| UI modals / focus / palette / branch flags | `useState` in `App.tsx` | Main window |
| Config | `useState<BladeConfig>` loaded in `App.tsx:275-298` via `invoke("get_config")` | Main window, singleton |
| Activity feed | `useActivityFeed()` hook | Main window |
| Notifications | `useNotifications()` via React Context (`src/components/NotificationCenter.tsx`) | Global inside main window |
| TTS / voice commands | `useTTS()`, `useVoiceCommands()` | Main window |
| Tauri events | 43 `listen(...)` calls in `useEffect` blocks across components + `App.tsx` | Per-component |
| Persistence | 252 `localStorage` / `sessionStorage` calls for history, onboarding flags, UI prefs | Per-surface |

**Gotchas:**
- QuickAsk runs in a **separate webview** with its own React tree. It has no access to the main window's `useChat()` state. How QuickAsk submissions get routed into the main conversation is **unclear** — likely via `invoke("send_message_stream", …)` creating a new conversation, but the bridge is undocumented.
- Since there's no provider beyond Toast, passing state across routes means lifting it to `App.tsx` and drilling via props. The `useChat()` hook hides this for chat state; everything else is drilled.

---

## Layer 4 — Styling system

**CSS entry** — `src/index.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:…&family=Syne:…&family=JetBrains+Mono:…');
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Tailwind **v4** via `@tailwindcss/postcss` (`package.json:10`). The older `@tailwind` directive syntax is in use — not the v4 `@import "tailwindcss";` form.

**Design tokens** — large `:root { … }` block at the top of `src/index.css` defines:
- **Glass materials (3 tiers)** — `--glass-1-bg`, `--glass-1-border`, `--glass-2-bg`, `--glass-2-blur`, `--glass-2-shadow`, `--glass-3-bg`, `--glass-3-blur`, `--glass-3-border`, `--glass-3-shadow`
- **Radii** — `--r-card: 22px`, `--r-panel: 18px`, `--r-control: 12px`, `--r-pill: 999px`
- **Spacing rhythm** — `--sp-1: 4px` through `--sp-16: 64px`
- **Layout** — `--nav-width: 62px`, `--chat-width: 400px`, `--title-height: 34px`, `--gap: 10px`
- **Motion** — `--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-out`, `--ease-smooth`, `--dur-fast`, `--dur-base`, `--dur-slow`, `--dur-enter`
- **Typography colors** — `--text`, `--text-strong`, `--text-muted`, `--text-dim`, `--text-faint`
- **Accent palette** — `--accent`, `--green`, `--amber`, `--red`, `--blue` each with `-weak` and `-border` variants
- **Type families** — `--font-display: 'Syne'`, `--font-body: 'Bricolage Grotesque'`, `--font-serif: 'Fraunces'`, `--font-mono: 'JetBrains Mono'`
- **Legacy aliases** — `--glass-bg`, `--glass-border`, `--glass-shine`, etc., left for older components

**Approach:** every component uses Tailwind utility classes + occasional `style={{ background: 'var(--glass-2-bg)' }}` for the tokens. No CSS-in-JS, no CSS modules, no styled-components.

**Shared primitive library:** none — `Button`, `Card`, `Pill`, `Badge`, `Alert` are inlined as Tailwind class sets inside each component that needs them. This means visual drift is easy and design changes touch many files.

---

## Layer 5 — Tauri integration

**One wrapper, eight functions** — `src/lib/tauri.ts`:

```ts
// Config
getConfig()              → invoke<BladeConfig>("get_config")
getOnboardingStatus()    → invoke<boolean>("get_onboarding_status")
completeOnboarding(a)    → invoke<void>("complete_onboarding", { answers: a })

// Chat streaming
sendMessageStream(msgs)  → invoke<void>("send_message_stream", { messages: msgs })
cancelChat()             → invoke<void>("cancel_chat")

// Event wrappers
onChatToken / onChatThinking / onChatThinkingDone / onChatDone /
onChatCancelled / onChatAck / onChatRouting / onBladeStatus
```

**Everything else is raw.** 234 `invoke(...)` call sites across ~79 files use stringly-typed command names directly:

```ts
invoke("debug_config")                              // src/App.tsx:277
invoke("capture_screen")                            // src/App.tsx:892, 941
invoke("move_to_monitor", { monitorIndex: 1 })      // src/App.tsx:391
invoke("history_save_conversation", { … })          // src/hooks/useChat.ts:46
invoke("db_search_knowledge", { … })                // src/components/KnowledgeBase.tsx
invoke("hive_start"), invoke("hive_stop")           // …
```

Unique backend commands reached: **171**. Of the backend's 764 `#[tauri::command]`s, that's **~22% coverage**.

Unique backend events subscribed: **29**. Examples:
```
chat_token, chat_done, chat_thinking, chat_thinking_done, chat_routing, chat_ack,
blade_status, blade_catchup, blade_evolving, blade_reflex,
blade_reminder_created, blade_reminder_fired, proactive_card, proactive_nudge,
ghost_toggle_card, ghost_meeting_ended, dream_mode_end, causal_insights,
skill_learned, smart_interrupt, wake_word_detected, screenshot_taken,
world_state_updated, auto_fix_*, service_crashed, sidecar_status_update,
tauri://focus, tts_interrupted, voice_conversation_listening, voice_conversation_speaking
```

**Risks of the raw-invoke pattern:**
1. Typos silently become runtime errors. No compile-time check against the actual backend `generate_handler!` registry.
2. Argument name drift (Rust snake_case vs TS camelCase) is invisible until the command fails.
3. Refactoring a backend command name requires grepping every `.tsx` / `.ts` for the string.
4. No central place to add logging, retries, telemetry.

---

## Per-window status

| Window | Build | Runtime | Notes |
|---|---|---|---|
| Main | ✅ builds | ✅ works | App.tsx is 1,300+ lines — monolithic but functional |
| QuickAsk | ✅ builds | ✅ works | Context bridge to main chat unclear but submissions succeed |
| Overlay | ⚠️ builds (Vite only warns on missing HTML) | ❌ **fails** at runtime when Rust creates window | Need `overlay.html` |
| HUD | ⚠️ builds (warn) | ❌ **fails** | Need `hud.html` |
| Ghost overlay | ⚠️ builds (warn) | ❌ **fails** | Need `ghost_overlay.html` |

Rust window-creation sites that will error out today:
- `src-tauri/src/lib.rs:349-366` — `WebviewUrl::App("overlay.html")`
- `src-tauri/src/overlay_manager.rs:76` — `WebviewUrl::App("hud.html")`
- `src-tauri/src/ghost_mode.rs:472` — `WebviewUrl::App("ghost_overlay.html")`

---

## Backend coverage — what the UI does not reach

The frontend invokes ~171 unique commands. That leaves ~593 backend commands with no UI pathway. Biggest unreached clusters:

| Cluster | Rough command count | Current UI state |
|---|---|---|
| Hive mesh beyond `hive_start` / `hive_stop` / `hive_set_autonomy` / `hive_approve_decision` | ~8+ | `Hive.tsx` component exists but mostly unwired |
| Tentacle-specific commands (per-platform: github/slack/email/calendar/discord/linear/cloud/log/terminal/filesystem) | 50+ | No dedicated per-tentacle UI; Hive.tsx doesn't drill in |
| Memory Palace (`memory_palace_*`) | 5+ | No UI — feature is in Rust only |
| Reasoning Engine (`reasoning_*`) | 10+ | `ReasoningView.tsx` exists; unclear how much is wired |
| Negotiation / debate engine | 10+ | `NegotiationView.tsx` exists; needs audit |
| Body map + bio sub-registries (`body_get_map`, `body_get_system`, `cardiovascular_*`, `urinary_*`, `reproductive_*`, `joints_*`, `supervisor_*`) | 15+ | No UI surface — the entire "body architecture" visualization doesn't exist in the frontend |
| Homeostasis / hormone bus | unclear — commands may not be registered | No UI; hormone state is not visualized |
| AI Delegate review (decision-gate approvals / rejections) | — | Events are listened to (App.tsx:630-648) but no review UI |
| Deep Scan (`deep_scan_*`) detailed results | ~3 | DeepLearn component exists; coverage unclear |
| Evolution + Self-Upgrade + Self-Code | ~15 | Partial — SkillPackView + evolution events |
| Dream Mode controls | ~2 | No UI |
| God Mode tier toggle | 1 | Partially wired via Settings |

---

## What's clearly broken or dead

1. **Three missing HTML entry files** (see Per-window status). Highest-impact fix in the repo.
2. **`invoke("pulse_now" | "pulse_explain" | "pulse_get_last_thought" | "pulse_get_digest")`** are called from App.tsx but did not appear in the audit's extracted unique-command list — probably a grep edge case, not a real gap. Flag: **unclear — requires human review**.
3. **Dead import remnants** — `// import { Sidebar } from "./components/Sidebar";` at `src/App.tsx:33-35` and adjacent commented DashboardGlance.
4. **Context bridge QuickAsk → Main** is not documented; a new dev will re-invent it and likely get it wrong.
5. **43 event listeners** are scattered across components with inconsistent cleanup patterns — some `useEffect` returns use `unlisten.then(fn => fn())`, some don't. Memory-leak risk on long-running sessions.

---

## Conventions a new dev should know on day 1

1. **Routes live in `App.tsx`** — 3-location edit to add one (union type, lazy import, `fullPageRoutes` map).
2. **Tauri wrapper is in `src/lib/tauri.ts`** — but covers only 8 of 171 invoked commands. When you touch a surface, consider moving its invokes into this file with a citation to the Rust source line.
3. **Styling uses Tailwind v4 utilities + CSS variables** from `src/index.css`. Don't hardcode colors or radii — use `var(--accent)`, `var(--r-card)`, etc.
4. **There is no global store.** Lift to App.tsx and drill via props. For chat specifically, use `useChat()`.
5. **Events are inline `useEffect` + `listen`**. Always return a cleanup that calls the unlisten function.
6. **Persistence is `localStorage` keyed with `blade_<feature>_<version>`** (e.g. `blade_quickask_history_v1`). Bump the suffix when the shape changes.
7. **Fonts** — Syne (display), Bricolage Grotesque (body), Fraunces (serif), JetBrains Mono (code). All loaded from Google Fonts CDN.
8. **Window creation is owned by Rust.** The frontend does not call `WebviewWindowBuilder`. If you need a new window, coordinate: (a) add an HTML entry at repo root, (b) add a Vite input, (c) add a `WebviewWindowBuilder::new(app, "<label>", WebviewUrl::App("<name>.html"))` on the Rust side, (d) add a bootstrap `.tsx`.

---

## What's genuinely still to build

1. **Three missing HTML files** — `overlay.html`, `hud.html`, `ghost_overlay.html`. Follow the `quickask.html` template. This unblocks the overlay, HUD, and ghost-mode windows at runtime.
2. **Expand `src/lib/tauri.ts`** from 8 wrappers to a typed surface covering the 171 commands the UI actually calls. Every wrapper should cite the Rust `file:line`. This eliminates the "stringly-typed invoke" class of bugs.
3. **A primitive component library** — `Button`, `Card`, `Pill`, `Badge`, `Alert` as real exports, not copy-pasted Tailwind. Prevents visual drift.
4. **Break up `App.tsx`** (1,300 lines) — at minimum pull the 59-route table, the 59-entry command palette, and the 10+ event listeners into their own files. The monolith is the single largest source of bugs on touch.
5. **Context bridge between QuickAsk and Main** — document (or build) how a QuickAsk submission appears in the main conversation. Today a new dev will guess.
6. **UI surfaces for unreached backend clusters** — Hive per-tentacle drill-in, Memory Palace, AI Delegate review queue, Body-map visualization, Hormone-bus dashboard. Roughly half of backend features have no frontend today.
7. **Consolidate event listeners** — a `useTauriEvent(name, handler)` hook would standardize cleanup and shrink 43 `useEffect` boilerplate blocks.
8. **Consider a real store** — Zustand or Jotai — once a second cross-route piece of state appears. Today only chat is cross-route, so the single `useChat()` hook suffices, but growth in features will force this.

---

## Pairing with the backend doc

- **Backend surfaces the UI should catch up with (from `2026-04-16-blade-body-architecture-design.md`):** DNA queries, hormone state, immune-system capability-gap UI, organ registry view, decision-log with feedback, god-mode tier toggle, dream-mode controls, screen-timeline scrubber, audio-timeline meeting browser, tool-forge management, MCP server catalog, deep-scan results, evolution suggestions.
- **Shape of work:** each of those is a new React view + a set of `lib/tauri.ts` wrappers + a row in the 59-route table. Follow the QuickAsk pattern for overlays; follow the KnowledgeBase pattern for main-window feature views.
