# Architecture Research — BLADE Skin Rebuild

**Domain:** Tauri 2 desktop app — multi-window React frontend over 178-module Rust backend
**Researched:** 2026-04-17
**Confidence:** HIGH — based on verified live source (docs/architecture/ pair docs, lib.rs, App.tsx, 2,416 hook calls, 234 raw invokes)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  src/windows/main/         (index.html → main.tsx → <Main/>)        │
│  Custom union router, 59 routes, feature cluster layout             │
│  Shell: TitleBar, Nav, CommandPalette, NotificationCenter,          │
│         ToastStack, GlobalOverlays                                   │
├──────────────────┬──────────────────┬──────────────────────────────┤
│ src/windows/     │ src/windows/     │ src/windows/                  │
│ quickask/        │ voice-orb/       │ ghost/                        │
│ <QuickAsk/>      │ <VoiceOrb/>      │ <GhostOverlay/>               │
│ 500×72 pill      │ fullscreen orb   │ content-protected meeting     │
├──────────────────┴──────────────────┴──────────────────────────────┤
│  src/windows/hud/          (hud.html → hud.tsx → <HudBar/>)         │
│  Persistent live-state strip, always-on-top                         │
├─────────────────────────────────────────────────────────────────────┤
│  IPC boundary  ──  src/lib/tauri/  (typed wrappers, 764 commands)   │
│  Events: 73 emit sites → src/lib/events/ → useTauriEvent() hooks    │
├─────────────────────────────────────────────────────────────────────┤
│  Rust backend: 178 modules, body_registry.rs, generate_handler![]   │
│  commands.rs / brain.rs / organs / tentacles / DNA / hormone bus    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Proposed `src/` Directory Layout

Every top-level directory has a single, non-overlapping purpose. Nothing lives in two places.

```
src/
├── windows/                    # One subfolder per Tauri window. Self-contained.
│   ├── main/                   # Main window (index.html)
│   │   ├── main.tsx            # Bootstrap: ReactDOM.createRoot → <MainApp/>
│   │   ├── MainApp.tsx         # Shell: TitleBar + Nav + RouteView + GlobalOverlays
│   │   ├── router.ts           # Route registry — imports + merges all feature route maps
│   │   ├── CommandPalette.tsx  # ⌘K palette, reads from registry
│   │   ├── GlobalOverlays.tsx  # CatchupOverlay, GlowOverlay, NudgeOverlay, AmbientStrip
│   │   ├── TitleBar.tsx        # Decorationless drag region + window controls
│   │   └── Nav.tsx             # Icon sidebar, driven by route registry sections
│   ├── quickask/               # QuickAsk window (quickask.html)
│   │   ├── quickask.tsx        # Bootstrap
│   │   └── QuickAskApp.tsx     # Pill input, voice toggle, result list
│   ├── voice-orb/              # Voice Orb overlay (overlay.html)
│   │   ├── overlay.tsx         # Bootstrap
│   │   └── VoiceOrbApp.tsx     # 4-phase orb (Idle/Listen/Think/Speak)
│   ├── hud/                    # HUD bar (hud.html)
│   │   ├── hud.tsx             # Bootstrap
│   │   └── HudApp.tsx          # Live-state ambient strip
│   └── ghost/                  # Ghost overlay (ghost_overlay.html)
│       ├── ghost_overlay.tsx   # Bootstrap
│       └── GhostApp.tsx        # Meeting whisper + content-protected cards
│
├── features/                   # Feature clusters. Each owns its routes, hooks, types.
│   ├── chat/
│   │   ├── index.ts            # Route definition export: { path, component, label, section, icon }
│   │   ├── ChatView.tsx        # Data-owning view (fetches, manages streaming state)
│   │   ├── MessageList.tsx     # Presentational
│   │   ├── InputBar.tsx        # Presentational + local state
│   │   ├── ToolCallCard.tsx    # Presentational
│   │   ├── ApprovalDialog.tsx  # Presentational modal
│   │   ├── useChat.ts          # All chat state: messages, streaming, tool loop
│   │   └── types.ts            # Message, ToolCall, ChatConfig
│   ├── dashboard/
│   │   ├── index.ts            # Route definition
│   │   ├── DashboardView.tsx   # Data owner
│   │   ├── RightNowHero.tsx    # Presentational
│   │   ├── HiveSignals.tsx     # Presentational
│   │   ├── CalendarStrip.tsx   # Presentational
│   │   └── useRightNow.ts      # Perception state + organ status
│   ├── settings/
│   │   ├── index.ts
│   │   ├── SettingsView.tsx
│   │   ├── ProviderTab.tsx
│   │   ├── KeyVaultTab.tsx
│   │   ├── McpTab.tsx
│   │   └── useConfig.ts        # BladeConfig load/save (lifted to App-level via context)
│   ├── agents/
│   │   ├── index.ts            # Registers: agents, bg-agents, swarm, agent-detail routes
│   │   ├── AgentDashboardView.tsx
│   │   ├── AgentDetailView.tsx
│   │   ├── SwarmView.tsx
│   │   └── useAgents.ts
│   ├── knowledge/
│   │   ├── index.ts            # Registers: knowledge, graph, screen-timeline, rewind routes
│   │   ├── KnowledgeBaseView.tsx
│   │   ├── KnowledgeGraphView.tsx
│   │   ├── ScreenTimelineView.tsx
│   │   └── useKnowledge.ts
│   ├── life-os/
│   │   ├── index.ts            # health, finance, goals, habits, meetings, social-graph, predictions
│   │   ├── HealthView.tsx
│   │   ├── FinanceView.tsx
│   │   ├── GoalView.tsx
│   │   ├── HabitView.tsx
│   │   └── MeetingView.tsx
│   ├── identity/
│   │   ├── index.ts            # soul, persona, character, negotiation, reasoning, context-engine
│   │   ├── SoulView.tsx
│   │   ├── PersonaView.tsx
│   │   └── CharacterBible.tsx
│   ├── dev-tools/
│   │   ├── index.ts            # terminal, files, git, canvas, workflows, web-automation, email, docs
│   │   ├── TerminalView.tsx
│   │   ├── FileBrowserView.tsx
│   │   └── GitPanelView.tsx
│   ├── admin/
│   │   ├── index.ts            # analytics, reports, decision-log, security, diagnostics, mcp-settings
│   │   ├── AnalyticsView.tsx
│   │   ├── SecurityDashboardView.tsx
│   │   └── DiagnosticsView.tsx
│   ├── body/
│   │   ├── index.ts            # body-map, organ-registry, hormone-bus, hive-mesh, tentacles
│   │   ├── BodyMapView.tsx
│   │   ├── OrganRegistryView.tsx
│   │   └── HiveMeshView.tsx
│   └── onboarding/
│       ├── index.ts            # Not a standard route — gated by onboarding_status
│       ├── OnboardingFlow.tsx  # 3-screen wizard: provider / key / deep-scan
│       ├── ProviderPick.tsx    # Screen 1
│       ├── ApiKeyEntry.tsx     # Screen 2
│       └── DeepScanReady.tsx   # Screen 3
│
├── design-system/              # Liquid Glass primitive library. No raw Tailwind for visual tokens.
│   ├── index.ts                # Re-exports everything (the only import callers need)
│   ├── tokens.css              # CSS custom properties: glass tiers, radii, motion, type
│   ├── primitives/
│   │   ├── Button.tsx          # variant: primary | ghost | destructive | icon
│   │   ├── Card.tsx            # GlassPanel with elevation prop (tier 1/2/3)
│   │   ├── GlassPanel.tsx      # Raw glass surface (backdrop-filter + specular highlight)
│   │   ├── Input.tsx           # Text input with glass border
│   │   ├── Pill.tsx            # Status / label chip
│   │   ├── Badge.tsx           # Numeric counter
│   │   ├── Orb.tsx             # Animated orb (phase prop: idle/listen/think/speak)
│   │   ├── Avatar.tsx          # Rounded image with fallback initials
│   │   ├── Spinner.tsx         # Loading indicator
│   │   ├── Tooltip.tsx         # Floating label
│   │   ├── Popover.tsx         # Floating panel (Floating UI or CSS anchor-based)
│   │   └── Dialog.tsx          # Modal with backdrop
│   └── patterns/
│       ├── EmptyState.tsx      # Zero-data placeholder (icon + message + CTA)
│       ├── ErrorBoundary.tsx   # Per-route error capture
│       ├── LoadingSkeleton.tsx # Shimmer placeholder matching target layout
│       └── SectionHeader.tsx  # Standardized feature section header
│
├── shared/                     # Shared non-primitive, non-feature components.
│   ├── ActivityFeed.tsx        # Used by dashboard + chat
│   ├── DataTable.tsx           # Generic sortable table
│   ├── ChartRenderer.tsx       # Thin wrapper over a charting lib
│   ├── MarkdownRenderer.tsx    # Streaming markdown with code blocks
│   ├── SearchBox.tsx           # Unified search input
│   ├── ToolApprovalDialog.tsx  # Reused by chat + agent runs
│   └── ToastStack.tsx          # Renders toast queue from ToastContext
│
├── lib/                        # Infrastructure: Tauri wrappers, event bus, stores.
│   ├── tauri/                  # Typed Tauri command wrappers, organized by Rust module
│   │   ├── index.ts            # Re-exports all sub-modules
│   │   ├── chat.ts             # send_message_stream, cancel_chat, get_history (commands.rs)
│   │   ├── config.ts           # get_config, save_config, get_onboarding_status (config.rs)
│   │   ├── memory.ts           # memory_*, typed_memory_*, embeddings_* (memory.rs)
│   │   ├── screen.ts           # capture_screen, screen_timeline_*, godmode_* (screen_timeline.rs)
│   │   ├── audio.ts            # audio_timeline_*, voice_*, tts_* (audio_timeline.rs)
│   │   ├── agents.ts           # swarm_*, background_agent_*, agent_factory_* (swarm.rs)
│   │   ├── knowledge.ts        # knowledge_graph_*, db_search_* (knowledge_graph.rs)
│   │   ├── hive.ts             # hive_*, tentacle_* (hive.rs, tentacles.rs)
│   │   ├── system.ts           # system_control_*, computer_use_* (system_control.rs)
│   │   ├── perception.ts       # perception_fusion_*, decision_gate_* (perception_fusion.rs)
│   │   ├── body.ts             # body_get_map, body_get_system, body_registry (body_registry.rs)
│   │   ├── mcp.ts              # mcp_*, integration_bridge_* (mcp.rs)
│   │   ├── security.ts         # security_monitor_* (security_monitor.rs)
│   │   ├── finance.ts          # financial_brain_* (financial_brain.rs)
│   │   └── _base.ts            # invokeTyped<T>(), error normalizer, retry logic
│   ├── events/                 # Event type definitions and subscription helpers
│   │   ├── index.ts            # useTauriEvent hook + event-name constants
│   │   ├── chat-events.ts      # ChatToken, ChatDone, ChatAck, ChatRouting payload types
│   │   ├── blade-events.ts     # BladeStatus, BladeReflex, ProactiveCard, GhostToggle types
│   │   ├── perception-events.ts # PerceptionUpdate, WorldStateUpdated payload types
│   │   └── system-events.ts   # ServiceCrashed, AutoFix, SkillLearned payload types
│   └── context/                # React Contexts that cross route boundaries
│       ├── ToastContext.tsx     # Toast queue (already exists — formalize here)
│       ├── ConfigContext.tsx    # BladeConfig, loaded once in MainApp, read-only child access
│       └── WindowBridgeContext.tsx # Inter-window messaging primitives
│
├── hooks/                      # Shared hooks used by >1 feature.
│   ├── useTauriEvent.ts        # Canonical event subscription (see §7)
│   ├── useKeyboard.ts          # Global keyboard shortcut registration
│   └── useWindowBridge.ts     # QuickAsk → Main cross-window messaging (see §3)
│
├── types/                      # Global TypeScript types mirroring Rust structs.
│   ├── blade-config.ts         # BladeConfig (mirrors config.rs)
│   ├── messages.ts             # ConversationMessage, ToolCall, ToolResult
│   ├── perception.ts           # PerceptionState, UserState, ContextTag
│   └── body.ts                 # BodySystem, OrganStatus, HormoneState
│
└── styles/                     # Global CSS only. No component-level CSS files.
    ├── tokens.css              # Canonical design tokens (imported by design-system)
    ├── reset.css               # Minimal reset + base typography
    └── fonts.css               # Font-face declarations (self-hosted or CDN)
```

### Structure Rationale

- **`windows/`** — each window is a self-contained app entry. Window bootstrap files (`*.tsx`) and window-level shells live here. No shared state bleeds across windows except through the `WindowBridge` (see §3).
- **`features/`** — feature-first, not layer-first. A feature folder owns its views, hooks, and local types. The test for "does this belong in a feature?" is: "Would deleting this feature mean deleting all these files?" If yes, they belong together.
- **`design-system/`** — the only place that emits Liquid Glass primitives. Import from `design-system/` or you're writing raw Tailwind — which is prohibited for visual tokens.
- **`shared/`** — components used by 2+ features that are NOT design primitives (ActivityFeed, DataTable, etc.). Primitives → `design-system/`. Feature-only → `features/<name>/`. Everything else → `shared/`.
- **`lib/tauri/`** — typed wrappers, one file per Rust module. Never call `invoke()` directly outside `lib/tauri/`. Every exported function cites the Rust file:line in a JSDoc comment.
- **`lib/events/`** — typed payload definitions + the `useTauriEvent` hook. Prevents string literals for event names.
- **`lib/context/`** — React Contexts that MainApp provides. ConfigContext and ToastContext live here; feature-local Contexts stay inside their feature folder.

---

## 2. Route Registry Pattern

**The problem today:** adding a route requires 3 edits in App.tsx (type union, lazy import, fullPageRoutes entry). With 59 routes this is fragile and will drift.

**The solution: feature-self-registration via a route definition object.**

### Route Definition Contract

Every feature folder exports a route map from its `index.ts`:

```typescript
// src/features/chat/index.ts
import { lazy } from "react";
import type { RouteDefinition } from "@/lib/router";

const ChatView = lazy(() => import("./ChatView").then(m => ({ default: m.ChatView })));

export const routes: RouteDefinition[] = [
  {
    path: "chat",
    component: ChatView,
    label: "Chat",
    section: "core",          // controls nav grouping
    icon: "bubble",           // maps to design-system Icon
    palette: true,            // include in ⌘K command palette
    paletteKeyword: ["chat", "message", "ask"],
  },
];
```

```typescript
// src/lib/router.ts  (the shape — no runtime magic)
export type Section = "core" | "work" | "knowledge" | "life" | "admin" | "body";

export interface RouteDefinition {
  path: string;              // e.g. "chat", "screen-timeline"
  component: React.LazyExoticComponent<React.ComponentType<RouteProps>>;
  label: string;
  section: Section;
  icon: string;
  palette?: boolean;
  paletteKeyword?: string[];
  hiddenFromNav?: boolean;   // true for sub-routes like "agent-detail"
}

export interface RouteProps {
  onBack: () => void;        // standard prop every route component receives
}
```

### Router Aggregator

```typescript
// src/windows/main/router.ts
import { routes as chatRoutes } from "@/features/chat";
import { routes as dashboardRoutes } from "@/features/dashboard";
import { routes as settingsRoutes } from "@/features/settings";
import { routes as agentRoutes } from "@/features/agents";
import { routes as knowledgeRoutes } from "@/features/knowledge";
import { routes as lifeOsRoutes } from "@/features/life-os";
import { routes as identityRoutes } from "@/features/identity";
import { routes as devToolsRoutes } from "@/features/dev-tools";
import { routes as adminRoutes } from "@/features/admin";
import { routes as bodyRoutes } from "@/features/body";

export const ALL_ROUTES: RouteDefinition[] = [
  ...dashboardRoutes,
  ...chatRoutes,
  ...settingsRoutes,
  ...agentRoutes,
  ...knowledgeRoutes,
  ...lifeOsRoutes,
  ...identityRoutes,
  ...devToolsRoutes,
  ...adminRoutes,
  ...bodyRoutes,
];

// Derived maps — computed once at module load, not inside components
export const ROUTE_MAP = new Map(ALL_ROUTES.map(r => [r.path, r]));
export const PALETTE_COMMANDS = ALL_ROUTES.filter(r => r.palette !== false);
export const NAV_SECTIONS = groupBy(ALL_ROUTES.filter(r => !r.hiddenFromNav), r => r.section);
```

### MainApp Usage

```typescript
// src/windows/main/MainApp.tsx
import { ALL_ROUTES, ROUTE_MAP } from "./router";

export function MainApp() {
  const [route, setRoute] = useState<string>("dashboard");
  const open = useCallback((path: string) => setRoute(path), []);

  const def = ROUTE_MAP.get(route);
  const View = def?.component ?? ROUTE_MAP.get("dashboard")!.component;

  return (
    <ConfigProvider>
      <ToastProvider>
        <TitleBar />
        <Nav routes={ALL_ROUTES} current={route} onNavigate={open} />
        <Suspense fallback={<LoadingSkeleton />}>
          <View onBack={() => open("dashboard")} />
        </Suspense>
        <CommandPalette commands={PALETTE_COMMANDS} onSelect={r => open(r.path)} />
        <GlobalOverlays />
      </ToastProvider>
    </ConfigProvider>
  );
}
```

**Adding a new route = 1 file change:** add the route definition to the feature's `index.ts`. The aggregator import is explicit (not glob-based), so it's one import line added to `router.ts` when a new feature cluster is introduced — not per-route.

**Why not Vite glob import (`import.meta.glob`)?** Glob imports lose type safety and make tree-shaking harder. The explicit aggregator pattern is 10 lines and fully typed.

---

## 3. Window Topology and Inter-Window Messaging

### 5-Window Map

| Window | HTML file | Label | Size | Decor | Always-on-top | Purpose |
|--------|-----------|-------|------|-------|----------------|---------|
| Main | `index.html` | `main` | user-controlled | yes | no | Core shell — all 59 routes |
| QuickAsk | `quickask.html` | `quickask` | 500×72 | no | yes | Fast query pill |
| Voice Orb | `overlay.html` | `overlay` | fullscreen | no | yes | 4-phase orb overlay |
| HUD | `hud.html` | `hud` | ~full-width strip | no | yes | Ambient live-state bar |
| Ghost | `ghost_overlay.html` | `ghost_overlay` | fullscreen | no | yes | Meeting stealth |

Each window is a separate webview with its own React tree. **They share no JavaScript memory.** The only communication channel is Tauri's IPC event bus.

### Inter-Window Contract

**Layer 1 — Rust emits to specific window:** The backend already uses `app.emit_to("main", "event_name", payload)`. The frontend does not need to do window-to-window communication through Rust; most triggers are backend-initiated.

**Layer 2 — Window-to-window via backend invoke:** When QuickAsk needs to push a message into the Main conversation:

```
QuickAsk webview
    ↓  invoke("quickask_submit", { text, context, bridge_to_main: true })
Rust commands.rs:quickask_submit
    ↓  runs the same send_message_stream pipeline
    ↓  app.emit_to("main", "blade_quickask_bridged", { conversation_id })
Main webview
    ↓  useTauriEvent("blade_quickask_bridged", ...) opens chat route with that conversation
```

This is the **only correct pattern** for QuickAsk → Main. Do not use `@tauri-apps/api/window` `emit` from QuickAsk to Main — it bypasses the backend and loses the message in Rust's chat history.

**Layer 3 — WindowBridge hook:** For non-backend-mediated signals (e.g., QuickAsk telling Main "I'm closing, focus yourself"):

```typescript
// src/hooks/useWindowBridge.ts
import { emit, listen } from "@tauri-apps/api/event";

type BridgeEvent =
  | { type: "quickask:closed" }
  | { type: "quickask:bridged"; conversationId: string }
  | { type: "ghost:activated" }
  | { type: "ghost:deactivated" }
  | { type: "hud:refresh" };

export function useSendBridge() {
  return useCallback((to: string, evt: BridgeEvent) => {
    // Tauri event emitted to specific window label
    emit(`bridge:${to}`, evt);
  }, []);
}

export function useReceiveBridge<T extends BridgeEvent>(
  type: T["type"],
  handler: (evt: T) => void,
) {
  useTauriEvent(`bridge:main`, (payload: BridgeEvent) => {
    if (payload.type === type) handler(payload as T);
  });
}
```

**Defined bridge event contracts (complete list for V1):**

| Event | Emitter | Receiver | Payload |
|-------|---------|----------|---------|
| `blade_quickask_bridged` | Rust (commands.rs) | Main | `{ conversation_id: string }` |
| `bridge:main` `quickask:closed` | QuickAsk | Main | — |
| `bridge:main` `ghost:activated` | Rust (ghost_mode.rs) via emit | Main | — |
| `bridge:main` `ghost:deactivated` | Rust | Main | — |
| `bridge:hud` `hud:refresh` | Main | HUD | — |

No ad-hoc `emit("window", ...)` calls outside this contract. New inter-window signals → add a row to this table + add the type to `BridgeEvent`.

---

## 4. Typed Tauri Wrapper Layer

### Organization Principle: one file per Rust module cluster

164 Rust module files map to ~14 wrapper files. Grouping by feature domain (not alphabetically) means a developer working on memory features opens `lib/tauri/memory.ts` and sees everything.

### Base Layer

```typescript
// src/lib/tauri/_base.ts
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export class TauriError extends Error {
  constructor(
    public command: string,
    public rustError: string,
  ) {
    super(`[${command}] ${rustError}`);
  }
}

export async function invokeTyped<TReturn, TArgs extends Record<string, unknown> = Record<string, never>>(
  command: string,
  args?: TArgs,
): Promise<TReturn> {
  try {
    return await tauriInvoke<TReturn>(command, args);
  } catch (e) {
    throw new TauriError(command, typeof e === "string" ? e : String(e));
  }
}
```

### Example: Chat Wrapper

```typescript
// src/lib/tauri/chat.ts
// Rust source: src-tauri/src/commands.rs

import { invokeTyped } from "./_base";
import type { ConversationMessage } from "@/types/messages";

/** commands.rs:send_message_stream */
export function sendMessage(messages: ConversationMessage[], provider?: string): Promise<void> {
  return invokeTyped("send_message_stream", { messages, provider: provider ?? null });
}

/** commands.rs:cancel_chat */
export function cancelChat(): Promise<void> {
  return invokeTyped("cancel_chat");
}

/** history.rs:history_save_conversation */
export function saveConversation(id: string, messages: ConversationMessage[]): Promise<void> {
  return invokeTyped("history_save_conversation", { conversationId: id, messages });
}

/** history.rs:history_list_conversations */
export function listConversations(): Promise<{ id: string; title: string; updated_at: string }[]> {
  return invokeTyped("history_list_conversations");
}
```

### Wrapper Coverage Strategy

Phase 1 (Foundation): wrap the 8 commands already in `src/lib/tauri.ts` + all commands used in `App.tsx` global listeners.
Phase 2 onward: as each feature is built, its engineer wraps the commands that feature needs. No speculative wrapping.

**Rule:** if you need a command that's not in `lib/tauri/`, add it to the right module file before calling it. Do not add raw `invoke()` calls in component code. PR review rejects raw invokes outside `lib/tauri/`.

### Event Layer

```typescript
// src/lib/events/index.ts
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { useEffect } from "react";

// Canonical event name registry — no magic strings anywhere else
export const BLADE_EVENTS = {
  CHAT_TOKEN:        "chat_token",
  CHAT_DONE:         "chat_done",
  CHAT_THINKING:     "chat_thinking",
  CHAT_ACK:          "chat_ack",
  BLADE_STATUS:      "blade_status",
  BLADE_REFLEX:      "blade_reflex",
  PROACTIVE_CARD:    "proactive_card",
  PROACTIVE_NUDGE:   "proactive_nudge",
  GHOST_TOGGLE:      "ghost_toggle_card",
  PERCEPTION_UPDATE: "world_state_updated",
  SKILL_LEARNED:     "skill_learned",
  // ... all 73 event names
} as const;

export type BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS];

// The canonical hook (see §7 for full spec)
export function useTauriEvent<T>(
  name: BladeEventName | string,
  handler: EventCallback<T>,
): void {
  useEffect(() => {
    const unlisten = listen<T>(name, handler);
    return () => { unlisten.then(fn => fn()); };
  }, [name]); // handler intentionally omitted — callers must memoize if needed
}
```

---

## 5. State Layer Without a Store

### Decision Tree: where does state live?

```
Does this state cross windows?
  YES → backend is the source of truth; use invoke/event; no React state for it
  NO  → stays in React
        |
        Is it only used in one route?
          YES → local useState in the view component
          NO  →
              Is it shared across 2-3 routes in the same feature cluster?
                YES → lift to feature-level hook (e.g. useChat), passed via props
                NO  → lift to React Context in lib/context/
                      |
                      Is it needed in all windows (not just main)?
                        YES → it belongs in the backend, not React
```

### Rules

1. **App-level state in MainApp.tsx:** only `route` (current route string) and `isOnboarded` (one-time gate). Nothing else.

2. **ConfigContext:** BladeConfig is loaded once when MainApp mounts via `lib/tauri/config.ts:getConfig()`. Provided via `ConfigContext`. All components that need a config value call `useConfig()`. Config writes go through `lib/tauri/config.ts:saveConfig()` — never cached locally.

   ```typescript
   // src/lib/context/ConfigContext.tsx
   const ConfigContext = createContext<{ config: BladeConfig; reload: () => void } | null>(null);

   export function ConfigProvider({ children }: { children: React.ReactNode }) {
     const [config, setConfig] = useState<BladeConfig | null>(null);
     useEffect(() => { getConfig().then(setConfig); }, []);
     useTauriEvent(BLADE_EVENTS.CONFIG_UPDATED, () => getConfig().then(setConfig));
     if (!config) return <LoadingSkeleton />;
     return <ConfigContext.Provider value={{ config, reload: () => getConfig().then(setConfig) }}>{children}</ConfigContext.Provider>;
   }

   export const useConfig = () => useContext(ConfigContext)!;
   ```

3. **ToastContext:** Toast queue only. No other state piggybacked here.

4. **Feature hooks:** `useChat()`, `useAgents()`, `useKnowledge()` — each manages state for one feature cluster. These are passed down as props within their feature, not provided via Context.

5. **Cross-feature state (future):** if a second piece of state beyond config/toast needs to cross route boundaries (e.g. a notification count driving the nav badge), introduce a new named Context in `lib/context/` with an explicit decision log entry. Do not reach for Zustand until there are 3+ such pieces of cross-route state.

6. **localStorage:** keyed as `blade_<feature>_<key>_v<N>`. Bump version suffix when shape changes. Only for UI preferences (sidebar collapse, panel widths). Never for data that the backend owns.

---

## 6. Design System Boundary

### The Rule

> **No raw Tailwind class for a visual token.** Visual tokens are: colors, glass tiers, radii, shadows, motion timing, type sizes, spacing rhythm. Everything defined in `styles/tokens.css` is a token.

**Allowed in feature/shared components:**
```typescript
// Layout classes (not visual tokens) — OK
<div className="flex flex-col gap-2 p-4">

// Consuming a design-system primitive — OK
<Button variant="primary" onClick={submit}>Send</Button>

// Using a CSS var for a token — OK when no primitive exists yet
<div style={{ background: "var(--glass-2-bg)", borderRadius: "var(--r-card)" }}>
```

**Prohibited in feature/shared components:**
```typescript
// Raw color literal — REJECTED
<div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl">

// Raw motion timing — REJECTED
<div className="transition-all duration-300 ease-out">

// Instead: use a design-system primitive that bakes these in
<GlassPanel tier={2}>
```

### Preventing Drift

1. **ESLint rule (custom):** flag any Tailwind class matching `bg-white/`, `bg-black/`, `backdrop-blur-*`, `border-white/`, `rounded-*`, `duration-*`, `ease-*` when used outside `src/design-system/`. This is a warning in dev, error in CI.

2. **Design system components are the only place glass material is defined.** If a feature needs a new material treatment, it adds a new primitive to `design-system/` — it does not inline it.

3. **Token changes go through `styles/tokens.css` only.** No Tailwind config extension for colors or spacing. Tailwind is used for layout utilities; visual values come from CSS variables.

4. **Review gate:** any component outside `design-system/` that references `backdrop-filter` or `background: rgba(...)` is a design system boundary violation and fails review.

---

## 7. Event Subscription Hook

### Current Problem

43 inline `useEffect` + `listen` blocks with inconsistent cleanup. Some return `unlisten.then(fn => fn())`, some do `const cleanup = await unlisten; return () => cleanup();` (wrong — returns a Promise from useEffect), some don't clean up at all.

### Canonical Pattern

```typescript
// src/hooks/useTauriEvent.ts
import { useEffect, useRef } from "react";
import { listen, type EventCallback, type Event } from "@tauri-apps/api/event";

/**
 * Subscribe to a Tauri backend event with automatic cleanup on unmount.
 *
 * Rules:
 * - handler is captured at registration time. If you need a fresh closure each render,
 *   wrap the function body in useCallback at the call site.
 * - name must be a constant from BLADE_EVENTS; never pass a string literal.
 * - Do not use this inside a condition or nested function — it's a hook.
 *
 * @param name   Event name from BLADE_EVENTS registry
 * @param handler Called on each event emission; receives typed payload
 */
export function useTauriEvent<T>(
  name: string,
  handler: EventCallback<T>,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler; // always up to date without re-subscribing

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<T>(name, (event: Event<T>) => {
      if (!cancelled) handlerRef.current(event);
    }).then(fn => {
      if (cancelled) { fn(); } // already unmounted — unlisten immediately
      else { unlistenFn = fn; }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [name]); // only re-subscribe if event name changes
}
```

### Migration Rule

Any existing `useEffect(() => { const unlisten = listen(...); return () => { unlisten.then(fn => fn()); }; }, [])` is replaced with `useTauriEvent(BLADE_EVENTS.EVENT_NAME, handler)`. After migration, no `listen()` call may exist outside `useTauriEvent` or the `lib/events/index.ts` registration helper.

### Streaming Events (Chat)

Chat streaming is a sequence of many `chat_token` events followed by `chat_done`. The `useChat` hook subscribes once at feature mount and accumulates tokens into a ref-backed buffer, flushed to state at 16ms intervals. Do not create a new event subscription per chat message.

---

## 8. Phase-Wise Build Order

### Dependency Graph

```
Foundation (design-system + lib/tauri + window shells + useTauriEvent)
    ↓
Onboarding (gates entry to all other features; must ship before user can see anything)
    ↓
Main shell (TitleBar + Nav + CommandPalette + ToastContext + ConfigContext)
    ↓ (both depend on Main shell)
Dashboard ←──── Chat (side-panel over Dashboard; can ship in same phase)
    ↓
Settings (needs Config, reads from ConfigContext; can start in parallel with Dashboard)
    ↓
QuickAsk window (depends on lib/tauri/chat being complete; bridge event needs Main)
Voice Orb window (depends on lib/tauri/audio + overlay.html existing)
Ghost window (depends on lib/tauri/system + ghost_overlay.html)
HUD window (depends on lib/tauri/perception being wired)
    ↓
Feature clusters — any order after window layer is stable:
    Agents cluster (depends on lib/tauri/agents)
    Knowledge cluster (depends on lib/tauri/knowledge, lib/tauri/memory)
    Life OS cluster (depends on lib/tauri/finance, health, social)
    Identity cluster (depends on lib/tauri/persona_engine, soul)
    Dev Tools cluster (depends on lib/tauri/system, files, browser)
    Admin cluster (depends on lib/tauri/security, analytics, mcp)
    Body visualization (depends on lib/tauri/body — new wrappers)
    Hive Mesh (depends on lib/tauri/hive, tentacles)
    ↓
Polish pass (requires all routes to exist; motion audit, empty states, error bounds)
```

### Phase-to-Phase Dependencies (explicit)

| Phase | Depends On | Reason |
|-------|-----------|--------|
| Onboarding | Foundation | Needs design-system primitives, tauri/config, HTML entries |
| Main shell | Foundation | Needs RouteDefinition contract, ConfigContext, ToastContext |
| Dashboard | Main shell | Lives inside the route shell; needs Nav, TitleBar |
| Chat | Main shell + lib/tauri/chat | ChatView is a route; streaming needs typed wrapper |
| Settings | Main shell + lib/tauri/config | Config writes flow through ConfigContext |
| QuickAsk window | lib/tauri/chat + Main shell | Bridge event must have a receiver in Main |
| Voice Orb | Foundation + lib/tauri/audio | Standalone window; needs overlay.html |
| Ghost | Foundation + lib/tauri/system | Standalone window; needs ghost_overlay.html + content protection |
| HUD | Foundation + lib/tauri/perception | Standalone window; needs hud.html |
| All feature clusters | Main shell + their respective lib/tauri/* | Route registration via feature index.ts |
| Body visualization | Main shell + lib/tauri/body | New wrappers needed (body_get_map etc.) |
| Polish | All clusters | Can't audit motion/empty states until routes exist |

### What Must Come First (non-negotiable)

1. `styles/tokens.css` — all components depend on token CSS vars
2. `design-system/primitives/` — every view uses these
3. `lib/tauri/_base.ts` + `lib/events/index.ts` — all wrappers depend on these
4. `lib/tauri/config.ts` + `ConfigContext` — Onboarding and Settings both need it
5. Three missing HTML files (`overlay.html`, `hud.html`, `ghost_overlay.html`) — Rust crashes without them

---

## 9. Data Flow and Component Boundaries

### Boundary Rules

**Data-owning views** (live in `features/<name>/`):
- Named `*View.tsx` (e.g. `ChatView.tsx`, `DashboardView.tsx`)
- Call `lib/tauri/*` hooks/functions to fetch or mutate
- Manage loading, error, and empty states
- Pass data down to presentational components via props
- Subscribe to relevant events via `useTauriEvent`

**Presentational components** (live in `features/<name>/` or `shared/`):
- Receive all data as props — no `invoke()`, no `useTauriEvent`
- Own only ephemeral UI state: hover, focus, open/closed, animation phase
- Composed from `design-system/` primitives
- Fully testable without a Tauri runtime

### Worked Example — ChatView

```typescript
// src/features/chat/ChatView.tsx  (DATA OWNER)
export function ChatView({ onBack }: RouteProps) {
  const { messages, send, cancel, isStreaming, activeTool } = useChat(); // all state here
  return (
    <div>
      <MessageList messages={messages} activeTool={activeTool} />  {/* presentational */}
      <InputBar onSend={send} onCancel={cancel} disabled={isStreaming} />  {/* presentational */}
      {activeTool && <ToolApprovalDialog tool={activeTool} onApprove={...} onReject={...} />}
    </div>
  );
}

// src/features/chat/MessageList.tsx  (PRESENTATIONAL)
interface Props { messages: ConversationMessage[]; activeTool: ToolCall | null; }
export function MessageList({ messages, activeTool }: Props) {
  // No invoke, no listen. Pure render.
  return <div>{messages.map(m => <MessageBubble key={m.id} message={m} />)}</div>;
}
```

### Worked Example — DashboardView

```typescript
// src/features/dashboard/DashboardView.tsx  (DATA OWNER)
export function DashboardView({ onBack }: RouteProps) {
  const [perceptionState, setPerceptionState] = useState<PerceptionState | null>(null);
  const [organStatus, setOrganStatus] = useState<OrganStatus[]>([]);

  useEffect(() => {
    getPerceptionState().then(setPerceptionState);  // lib/tauri/perception.ts
    getOrganStatuses().then(setOrganStatus);        // lib/tauri/body.ts
  }, []);

  useTauriEvent(BLADE_EVENTS.PERCEPTION_UPDATE, e => setPerceptionState(e.payload));

  return (
    <div>
      <RightNowHero perception={perceptionState} />   {/* presentational */}
      <HiveSignals organs={organStatus} />            {/* presentational */}
    </div>
  );
}
```

---

## 10. Build-Order DAG

```
[tokens.css]──────────────────────────────────────────┐
      ↓                                               │
[design-system/primitives]                            │
      ↓                                               │
[lib/tauri/_base]──[lib/tauri/config]──[ConfigContext]│
      ↓                                               │
[lib/events/index + useTauriEvent]                    │
      ↓                                               ↓
[HTML entry files × 5]────────────────────────────────┘
      ↓
[Onboarding flow]───────────────────────────────────────────────────┐
      ↓                                                             │
[Main shell: MainApp + router + TitleBar + Nav + CommandPalette]    │
      ↓                              ↓                             │
[Dashboard + Chat]────────    [Settings + QuickAsk bridge]          │
      ↓                              ↓                             │
[Voice Orb window]         [Ghost window] [HUD window]              │
      ↓─────────────────────────────────────────────────────────────┘
[Feature clusters: Agents | Knowledge | Life OS | Identity | DevTools | Admin | Body | Hive]
      ↓
[Polish: motion audit + keyboard + a11y + empty states + error bounds]
```

**Critical path:** tokens.css → design-system → lib/tauri/_base → lib/events → HTML entries → Onboarding → Main shell → Dashboard + Chat. Everything else branches from Main shell.

---

## Architectural Patterns

### Pattern 1: Feature Self-Registration

**What:** Each feature exports `routes: RouteDefinition[]` from its `index.ts`. The aggregator (`windows/main/router.ts`) imports and merges all arrays. No per-route edits to App.tsx.

**When to use:** Always. Every route must have a definition object.

**Trade-offs:** Requires one import line added to `router.ts` when a new feature *cluster* is introduced (not per route). This is acceptable: cluster additions are rare; route additions within a cluster are free.

### Pattern 2: Tauri Module Wrappers

**What:** Every backend command is wrapped in a typed function in `lib/tauri/<module>.ts`. The function name mirrors the backend purpose (not the Rust snake_case command name). JSDoc cites Rust file:line.

**When to use:** Before any `invoke()` call. Never call `invoke()` directly in component code.

**Trade-offs:** Wrapper files need to be maintained when Rust command signatures change. This is a feature: the wrapper file is the single place to update, instead of hunting across 79 component files.

### Pattern 3: useTauriEvent Hook

**What:** Canonical `useEffect + listen + cleanup` pattern. `handler` is stored in a ref so it can update without re-subscribing.

**When to use:** Every Tauri event subscription in the frontend.

**Trade-offs:** Handler staleness is invisible at the call site. Callers must know that the handler captures closure variables by ref. Document this in the hook's JSDoc.

### Pattern 4: Window-Scoped React Trees

**What:** Each of the 5 windows has its own `ReactDOM.createRoot` and its own Context providers. They share no JavaScript state.

**When to use:** Already enforced by Tauri's multi-window architecture.

**Trade-offs:** Inter-window state must go through the backend or the `WindowBridge` event layer. No React state can cross windows.

---

## Anti-Patterns

### Anti-Pattern 1: Raw `invoke()` in Component Code

**What people do:** `const config = await invoke<BladeConfig>("get_config");` inside a component.
**Why it's wrong:** Typo → silent runtime failure. Rust refactor → grep hunt across 79 files. No retry, no error normalization.
**Do this instead:** `import { getConfig } from "@/lib/tauri/config"; const config = await getConfig();`

### Anti-Pattern 2: String Literals for Event Names

**What people do:** `listen("blade_status", handler)`
**Why it's wrong:** Typo → handler never fires. Rust rename → grep hunt.
**Do this instead:** `useTauriEvent(BLADE_EVENTS.BLADE_STATUS, handler)`

### Anti-Pattern 3: State in the Wrong Layer

**What people do:** Store conversation messages in `localStorage` because "it's simpler than invoking."
**Why it's wrong:** Backend history (history.rs) becomes out of sync. Messages lost on crash. No search.
**Do this instead:** Backend owns conversation persistence. Frontend calls `listConversations()` and `loadConversation(id)` from `lib/tauri/chat.ts`.

### Anti-Pattern 4: Routing Logic in a Route Component

**What people do:** Inside `AgentDetailView`, call `invoke("open_swarm")` and then navigate to "swarm" by manipulating a prop callback.
**Why it's wrong:** Cross-feature navigation logic scattered across view files; impossible to audit.
**Do this instead:** Navigation is `onBack()` or a named `openRoute` callback passed from MainApp. A route component never knows what route it's navigating to — it signals intent up and lets the shell resolve it.

### Anti-Pattern 5: Visual Tokens Inlined in Feature Components

**What people do:** `className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl"`
**Why it's wrong:** Design changes require touching every file that inlined the pattern. Visual drift across surfaces.
**Do this instead:** `<GlassPanel tier={2}>` or `style={{ background: "var(--glass-2-bg)" }}` for the rare case a primitive doesn't exist yet.

---

## Integration Points

### Rust Backend Boundary

| Frontend Module | Rust Module | Communication |
|-----------------|-------------|---------------|
| `lib/tauri/chat.ts` | `commands.rs`, `history.rs` | invoke + `chat_token`/`chat_done` events |
| `lib/tauri/config.ts` | `config.rs` | invoke (get/save) + `config_updated` event |
| `lib/tauri/memory.ts` | `memory.rs`, `typed_memory.rs`, `embeddings.rs` | invoke |
| `lib/tauri/screen.ts` | `screen_timeline.rs`, `godmode.rs` | invoke + `screenshot_taken` event |
| `lib/tauri/agents.ts` | `swarm.rs`, `background_agent.rs`, `agent_factory.rs` | invoke + `agent_progress` events |
| `lib/tauri/body.ts` | `body_registry.rs`, `organ.rs`, `homeostasis.rs` | invoke (mostly read-only) |
| `lib/tauri/hive.ts` | `hive.rs`, `tentacles.rs` | invoke + `hive_signal` events |
| `lib/tauri/perception.ts` | `perception_fusion.rs`, `decision_gate.rs` | invoke + `world_state_updated` event |

### Window-to-Window Boundary

All via the `WindowBridge` contract defined in §3. No ad-hoc `emit()` calls.

### Design System Boundary

`design-system/` exports → feature components import. No reverse direction (design system never imports from features).

---

## Sources

- Live codebase analysis: `docs/architecture/2026-04-17-blade-frontend-architecture.md` (verified 2026-04-17)
- Backend organ map: `docs/architecture/2026-04-16-blade-body-architecture-design.md`
- Module registry: `src-tauri/src/lib.rs` (178 mod declarations, generate_handler![])
- Current frontend patterns: `src/App.tsx` (1,300+ lines), `src/lib/tauri.ts`, `src/hooks/useChat.ts`
- Project scope: `.planning/PROJECT.md`

---

*Architecture research for: BLADE Skin Rebuild — React frontend organization*
*Researched: 2026-04-17*
