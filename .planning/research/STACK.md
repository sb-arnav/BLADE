# Stack Research — BLADE Skin Rebuild

**Domain:** macOS Liquid Glass desktop AI frontend (Tauri 2 + React 19)
**Researched:** 2026-04-17
**Confidence:** HIGH on most decisions — verified against live Tauri 2 docs, official React docs, and primary GitHub sources. LOW confidence items are flagged inline.

---

## Recommended Stack

### Core Technologies (already in-repo — no changes)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 19.2.5 | UI tree | Concurrent features, `use()`, ViewTransition (canary) |
| TypeScript | 5.9.3 | Type safety | Full strict mode; discriminated-union router requires it |
| Vite | 7.3.2 | Build + dev server | Multi-entry support for 5 window HTML files; manualChunks for route splitting |
| Tauri | 2.10.1 | Desktop shell | WebviewWindowBuilder, effects(), transparent(), content_protected() |
| Tailwind | v4.2.1 | Utility styling | CSS-first `@theme` = design tokens auto-exposed as CSS vars + utilities |

### New Dependencies to Add

| Library | Version | Purpose | Confidence | Install |
|---------|---------|---------|-----------|---------|
| `window-vibrancy` (Rust crate) | 0.7.1 | NSVisualEffectView vibrancy on macOS; `apply_liquid_glass` on macOS 26+ | HIGH | `cargo add window-vibrancy` |
| `tauri-plugin-liquid-glass` (Rust crate) | 0.1 | Native NSGlassEffectView on macOS 26 (Tahoe); falls back to NSVisualEffectView | MEDIUM (private API risk — see Pitfalls) | `cargo add tauri-plugin-liquid-glass` |
| `@tauri-apps/plugin-window-state` | 2.4.1 | Persist window positions/sizes across restarts | HIGH | `npm install @tauri-apps/plugin-window-state` |
| `tauri-plugin-window-state` (Rust crate) | 2.4.1 | Rust side of above | HIGH | `cargo add tauri-plugin-window-state` |

### Dependencies to Deliberately NOT Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Framer Motion / Motion One | Runtime JS cost, contradicts CSS-only motion mandate in PROJECT.md | CSS `@keyframes` + `transition` + `animation` — already proven in `orb.css` |
| shadcn/ui | Ships with Radix primitives + opinionated Tailwind that fights Liquid Glass tokens; copy-paste model still imports Radix dependency tree | Self-built Liquid Glass primitive library (6–8 components) |
| Radix UI (headless) | Accessibility logic is correct but each primitive ships 2–5 KB gzip; BLADE's design is so custom that Radix's DOM structure constrains layout | Custom primitives with native `<dialog>`, `<details>`, `aria-*` attributes |
| React Router / Wouter | App is a single shell with a discriminated-union state machine; a URL router adds parse overhead and history API conflicts with Tauri | Custom typed router (keep and extract from App.tsx) |
| Zustand / Jotai / Redux | Second cross-route state hasn't emerged; YAGNI confirmed by live audit | `useChat()` hook + event lift-to-App.tsx pattern |
| TauRPC | Requires replacing `#[tauri::command]` with `#[taurpc::procedure]` across 764 handlers — a backend rewrite, which is explicitly out of scope | Hand-written typed wrapper layer in `src/lib/blade.ts` (see Typed Wrapper section) |
| tauri-typegen | Generates TypeScript from Rust AST scan — useful for greenfield, but struggles with BLADE's macro-heavy `execute_batch!` patterns; last major release 0.4.0, still maturing | Same hand-written wrapper approach |
| `@tanstack/react-virtual` (new version) | Already in repo at 3.13.23 — keep for any long lists (conversation history, timeline) | Keep existing version |

---

## Area 1 — Liquid Glass Implementation

### Background: What "Liquid Glass" Is (Evidence-Based)

Apple introduced the Liquid Glass design language at WWDC 2025 for iOS/macOS 26 (Tahoe). It has three compositional layers:
- **Highlight** — specular light casting, reactive to motion
- **Shadow** — depth separation from background
- **Illumination** — flexible material fill

On the native side (macOS 26+), this is `NSGlassEffectView`. On older macOS, `NSVisualEffectView` with HudWindow/Sidebar/etc. materials. In a Tauri webview, we approximate with CSS + optionally invoke native vibrancy for the window chrome.

### Critical Known Issue: `transparent: true` + `backdrop-filter` in Tauri Webview

**This is a real, documented, unresolved bug.** Multiple GitHub issues (tauri-apps/tauri #12804, #12437, #10064, #6876) confirm that when a Tauri window has `transparent: true`, the CSS `backdrop-filter: blur()` either:
1. Does not blur what is behind the webview (the OS wallpaper/other apps)
2. Behaves inconsistently between dev and production bundle builds (macOS #13415)
3. Only blurs content within the same webview DOM

**Implication:** `backdrop-filter` in the webview cannot see through the window boundary to the wallpaper. It blurs other DOM elements layered beneath the element — which means the *wallpaper simulation* in `shared.css` (the rich gradient `.wallpaper` element) is the correct approach. The `.wallpaper` pseudo-element lives in DOM, so `.glass` elements stacked on top of it get real blur.

**Strategy: Two-track Glass**

| Surface | Glass method | Why |
|---------|-------------|-----|
| Window chrome (macOS) | `window-vibrancy` Rust crate — `apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(10.0))` | Native vibrancy sees through to actual wallpaper/desktop |
| In-webview panels, cards, nav rail | CSS `backdrop-filter: blur(32px) saturate(180%) brightness(1.05)` over the `.wallpaper` DOM element | Blurs the in-DOM gradient; authentic Liquid Glass look |
| macOS 26+ (optional enhancement) | `tauri-plugin-liquid-glass` — `apply_liquid_glass` with fallback | Uses private NSGlassEffectView; production risk (see Pitfalls) |

### Liquid Glass CSS Implementation Checklist

This is the exact property set required. Source: `docs/design/shared.css` (design prototype, verified as target) + CSS-Tricks Liquid Glass analysis + kube.io refraction implementation.

#### Base Glass Layer
```css
.glass {
  /* 1. Fill — gradient fade top-to-bottom simulates thickness */
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.13) 0%,
    rgba(255, 255, 255, 0.06) 45%,
    rgba(255, 255, 255, 0.04) 100%
  );

  /* 2. Blur + saturation boost — the core vibrancy effect */
  backdrop-filter: blur(32px) saturate(180%) brightness(1.05);
  -webkit-backdrop-filter: blur(32px) saturate(180%) brightness(1.05);

  /* 3. Isolation — required so stacked glass elements don't accumulate blur */
  isolation: isolate;
}
```

#### Border / Edge
```css
  /* 4. Single-pixel border at --g-edge-mid opacity (0.14) — refractive rim */
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--r-lg); /* 26px for panels, 18px for cards */
```

#### Inset Rim (the "glass edge" sell)
```css
  /* 5. Inset box-shadow: bright top/left, dim bottom/right — mimics light hitting glass edge */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),   /* bright top rim */
    inset 0 -1px 0 rgba(255, 255, 255, 0.04),  /* dim bottom rim */
    inset 1px 0 0 rgba(255, 255, 255, 0.12),   /* left highlight */
    inset -1px 0 0 rgba(255, 255, 255, 0.03),  /* right shadow */
    0 20px 50px rgba(0, 0, 0, 0.32);           /* drop shadow on wallpaper */
```

#### Specular Highlight (::before pseudo)
```css
.glass::before {
  /* 6. Specular — diagonal sheen from top-left corner */
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(130% 80% at 0% 0%, rgba(255, 255, 255, 0.14) 0%, transparent 45%),
    radial-gradient(90% 60% at 100% 100%, rgba(0, 0, 0, 0.10) 0%, transparent 55%);
  pointer-events: none;
  z-index: 0;
}
.glass > * { position: relative; z-index: 1; }
```

#### Refraction Simulation (advanced, Chromium-only)
```css
/* 7. SVG-filter refraction — only supported in Chromium (Chrome, WebView2, Tauri macOS + Windows) */
/* feDisplacementMap approach per kube.io */
.glass-refract {
  backdrop-filter: url(#liquidGlassFilterId) blur(20px) saturate(160%);
  -webkit-backdrop-filter: url(#liquidGlassFilterId) blur(20px) saturate(160%);
}
```
```xml
<!-- Inline SVG filter in index.html — rendered once, referenced by CSS -->
<svg style="position:absolute;width:0;height:0">
  <filter id="liquidGlassFilterId">
    <feImage href="/assets/displacement-map.png" x="0" y="0"
             width="1920" height="1080" result="displacement_map" />
    <feDisplacementMap in="SourceGraphic" in2="displacement_map"
                       scale="12" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>
```
**Confidence: MEDIUM** — Chromium-only today; verify against Tauri's WebView2 (Windows) and WKWebView (macOS) before shipping. Skip for Linux build.

#### Tier System (match design prototype)
```
glass.flat   — blur(20px) saturate(160%)  — nav items, minor surfaces
glass        — blur(32px) saturate(180%)  — standard panels, cards
glass.heavy  — blur(48px) saturate(200%)  — modals, command palette, foreground sheets
glass.pill   — border-radius: 999px       — QuickAsk, HUD bar, ambient strip
```

#### Windows / Linux Fallback
```css
/* Fallback when backdrop-filter unavailable or the wallpaper gradient isn't in DOM */
@supports not (backdrop-filter: blur(1px)) {
  .glass {
    background: rgba(20, 10, 40, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
}
```
On Windows/Linux the `.wallpaper` gradient element still provides a usable background. `backdrop-filter` works in WebView2 (Windows) when the OS compositing isn't fighting transparency. Linux Wayland compositors vary — treat as best-effort.

#### macOS NSVisualEffectView (Rust side)
```rust
// In lib.rs or window setup, after creating the window:
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

// Main window — Sidebar material, prominent vibrancy
apply_vibrancy(&main_window, NSVisualEffectMaterial::Sidebar, None, Some(18.0))
    .expect("vibrancy apply failed");

// QuickAsk pill — HudWindow material, lighter
apply_vibrancy(&quickask_window, NSVisualEffectMaterial::HudWindow, None, Some(999.0))
    .expect("vibrancy apply failed");

// Overlay / HUD — UnderPageBackground
apply_vibrancy(&hud_window, NSVisualEffectMaterial::UnderPageBackground, None, None)
    .expect("vibrancy apply failed");
```
**Requirement:** `transparent: true` and `macOSPrivateApi: true` must be set in `tauri.conf.json`. Both are already set for the main window; add to the three missing window HTML entries.

---

## Area 2 — Multi-Window Tauri 2 Topology

### Window Registry (5 windows)

| Label | File | Rust creation | Config |
|-------|------|---------------|--------|
| `main` | `index.html` | `tauri.conf.json` windows array | `decorations: false`, `transparent: true`, already working |
| `quickask` | `quickask.html` | `lib.rs:1275-1293` (existing) | 500×72, `always_on_top: true`, `transparent: true`, `decorations: false`, hidden by default |
| `overlay` | `overlay.html` | `lib.rs:349-366` (existing, broken) | fullscreen, `always_on_top: true`, `transparent: true`, `skip_taskbar: true` |
| `hud` | `hud.html` | `overlay_manager.rs:76` (existing, broken) | thin bar, `always_on_top: true`, `transparent: true` |
| `ghost_overlay` | `ghost_overlay.html` | `ghost_mode.rs:472` (existing, broken) | fullscreen, `content_protected: true`, `always_on_top: true`, `transparent: true` |

### WebviewWindowBuilder — Canonical Pattern

All three missing windows need HTML files + Rust builder calls. The Rust builder API (verified against `docs.rs/tauri/2.10.2/tauri/webview/struct.WebviewWindowBuilder`):

```rust
use tauri::{Manager, WebviewWindowBuilder, WebviewUrl};

// Overlay window (frameless, fullscreen, always-on-top)
let overlay = WebviewWindowBuilder::new(
    &app,
    "overlay",
    WebviewUrl::App("overlay.html".into()),
)
.title("BLADE Overlay")
.fullscreen(true)
.transparent(true)
.decorations(false)
.always_on_top(true)
.skip_taskbar(true)
.shadow(false)
.build()?;

// HUD bar (persistent bottom strip)
let hud = WebviewWindowBuilder::new(
    &app,
    "hud",
    WebviewUrl::App("hud.html".into()),
)
.title("BLADE HUD")
.inner_size(1920.0, 72.0)
.position(0.0, 1008.0)     // bottom of 1080p screen
.transparent(true)
.decorations(false)
.always_on_top(true)
.skip_taskbar(true)
.visible_on_all_workspaces(true)
.build()?;

// Ghost overlay (content-protected meeting mode)
let ghost = WebviewWindowBuilder::new(
    &app,
    "ghost_overlay",
    WebviewUrl::App("ghost_overlay.html".into()),
)
.title("BLADE Ghost")
.fullscreen(true)
.transparent(true)
.decorations(false)
.always_on_top(true)
.content_protected(true)  // prevents screenshot capture
.skip_taskbar(true)
.build()?;
```

**Source:** `docs.rs/tauri/2.10.2` — `transparent()`, `always_on_top()`, `decorations()`, `content_protected()`, `visible_on_all_workspaces()`, `shadow()` all confirmed present. `content_protected()` maps directly to the Rust side of what `ghost_mode.rs:472` already does.

### Window-State Plugin

Use `@tauri-apps/plugin-window-state` for the main window only. Do not apply it to overlay/HUD/ghost — their positions are computed at runtime. Registration:

```rust
// lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    ...
```

**Known issue:** the plugin crashes on macOS when saving state for `decorations: false` windows during close — apply only to the main window, which has saved size/position needs. Version 2.4.1 (released 2025-10-27) is latest; monitor for the fullscreen-exit regression (#3215).

### Inter-Window State Sync

Windows are separate webviews with no shared memory. The event system is the only bridge.

**Pattern (emit/listen with loop guard):**

```typescript
// In any window — broadcast a config change:
import { emit } from '@tauri-apps/api/event';
await emit('blade:config-update', { key: 'godmode_tier', value: 2 });

// In other windows — receive it:
import { listen } from '@tauri-apps/api/event';
let _processing = false;
const unlisten = await listen<{ key: string; value: unknown }>(
  'blade:config-update',
  (event) => {
    if (_processing) return;
    _processing = true;
    applyRemoteConfigPatch(event.payload);
    _processing = false;
  }
);
// cleanup on unmount:
return () => unlisten();
```

**Important:** Tauri events are JSON-serialized, one-way, and not designed for high throughput. Use for lifecycle events and config patches only, not streaming data. For high-frequency data (voice amplitude, orb phase updates), use Rust-to-webview events (`app_handle.emit("orb_phase", ...)`) targeted at a specific window label.

**QuickAsk → Main bridge** (currently undocumented): QuickAsk should submit via `invoke("send_message_stream", ...)` and then `emit("blade:quickask-submitted", { conversationId })` to the main window so it can navigate to chat and attach to the ongoing stream.

### Global Shortcuts

Already wired via `tauri_plugin_global_shortcut` in `lib.rs`. Pattern for showing/hiding overlay windows:

```rust
// In the shortcut handler callback:
if let Some(window) = app.get_webview_window("overlay") {
    if window.is_visible().unwrap_or(false) {
        window.hide().unwrap();
    } else {
        window.show().unwrap();
        window.set_focus().unwrap();
    }
}
```

No JavaScript needed for toggling — Rust owns window visibility. The JS side only needs to listen for the window becoming visible/hidden to update its own UI state if needed.

---

## Area 3 — App.tsx Decomposition (1,300 → < 300 lines)

### Route Registry Pattern

The current App.tsx has 3-location edit cost per route (union type, lazy import, fullPageRoutes entry). Target: 1 file per view + auto-discovery via a route registry object.

**Route registry file** (`src/router/routes.tsx`):

```typescript
// src/router/routes.tsx
import { lazy } from 'react';

export type Route =
  | 'dashboard' | 'chat' | 'settings' | 'knowledge'
  // ... all 59 variants as string literals
  ;

export interface RouteDefinition {
  component: React.LazyExoticComponent<React.ComponentType<RouteProps>>;
  palette?: { label: string; section: string };
}

export interface RouteProps {
  onBack: () => void;
  // common props all views receive
}

export const ROUTES: Record<Route, RouteDefinition> = {
  dashboard: {
    component: lazy(() => import('../components/Dashboard').then(m => ({ default: m.Dashboard }))),
    palette: { label: 'Dashboard', section: 'Navigation' },
  },
  chat: {
    component: lazy(() => import('../components/ChatPanel').then(m => ({ default: m.ChatPanel }))),
    palette: { label: 'Chat', section: 'Navigation' },
  },
  // ... 57 more entries — one per view file
};
```

**App.tsx becomes** (< 300 lines):

```typescript
// src/App.tsx
import { useState, useCallback, Suspense } from 'react';
import { ROUTES, Route } from './router/routes';
import { Shell } from './components/Shell';
import { CommandPalette } from './components/CommandPalette';
import { ToastProvider } from './components/Toast';
import { useTauriEvents } from './hooks/useTauriEvents';
import { useChat } from './hooks/useChat';
import { useConfig } from './hooks/useConfig';

export function App() {
  const [route, setRoute] = useState<Route>('dashboard');
  const { config } = useConfig();
  const chat = useChat();

  const openRoute = useCallback((r: Route) => setRoute(r), []);

  // All 43 event listeners extracted into one hook
  useTauriEvents({ openRoute, chat });

  const { component: View } = ROUTES[route] ?? ROUTES.dashboard;

  return (
    <ToastProvider>
      <Shell route={route} onNavigate={openRoute} config={config}>
        <Suspense fallback={<GlassSpinner />}>
          <View onBack={() => openRoute('dashboard')} />
        </Suspense>
      </Shell>
      <CommandPalette onNavigate={openRoute} />
    </ToastProvider>
  );
}
```

**Adding a new route: 1 file + 1 registry entry** — the union type is widened in `routes.tsx`, the component is a new file, no App.tsx edits needed.

### useTauriEvents Hook

Extract all 43 `listen()` calls from App.tsx into a single hook:

```typescript
// src/hooks/useTauriEvents.ts
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export function useTauriEvents({ openRoute, chat }: TauriEventsOptions) {
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    const reg = async () => {
      unlisteners.push(
        await listen('blade_catchup', () => { /* ... */ }),
        await listen('capability_gap_detected', () => openRoute('reports')),
        await listen('evolution_suggestion', () => openRoute('dashboard')),
        // ... all 43 events
      );
    };

    reg();
    return () => unlisteners.forEach(fn => fn());
  }, []); // stable deps only
}
```

This eliminates the scattered cleanup-inconsistency memory-leak risk identified in the frontend architecture doc.

---

## Area 4 — Primitive Library (Self-Built)

### Decision: Self-built, not shadcn/ui

**Reasoning:**
- shadcn/ui is built on Radix primitives. Each Radix primitive (Dropdown, Dialog, etc.) has structural DOM constraints that fight the Liquid Glass layout — e.g. Radix's Portal pattern and focus trap implementation conflict with Tauri's window management.
- shadcn's default Tailwind tokens (slate, zinc palettes) override the Liquid Glass token namespace unless carefully scoped.
- BLADE's design is 8 components wide. Building them takes 2-4 hours; importing shadcn takes longer to override than to build.

**Build list (Foundation phase):**

| Component | Accessibility need | Notes |
|-----------|------------------|-------|
| `GlassPanel` | `role="region"` | Base glass surface, tiers via `variant` prop |
| `Button` | `role="button"`, keyboard focus | 4 variants: primary, secondary, ghost, icon |
| `Pill` | `role="status"` or interactive | Always-on-top window chrome element |
| `Badge` | `role="status"` | Status chips, living dots |
| `Input` | native `<input>` + label | Glass input style |
| `GlassSpinner` | `role="status"`, `aria-busy` | Loading state during lazy chunk load |
| `Dialog` | native `<dialog>` element | Use `dialog.showModal()` — no Radix needed; browser handles focus trap |
| `Toast` | `role="alert"`, `aria-live` | Already exists as `ToastContext`; refactor to match design system |

Use native HTML elements everywhere possible (`<dialog>`, `<details>`, `<input>`, `aria-*`) — zero dependency cost, full accessibility.

---

## Area 5 — Typed Tauri Wrapper Strategy

### Decision: Hand-written wrapper layer in `src/lib/blade.ts`

**Why not codegen:**
- TauRPC requires replacing `#[tauri::command]` with `#[taurpc::procedure]` — a backend rewrite that violates scope constraints.
- tauri-typegen (0.4.0) scans Rust AST and struggles with BLADE's `execute_batch!` macro patterns; also generates command names only, not argument types.
- Both tools are < 1 year old and not battle-tested against a 764-command codebase.

**Why hand-written works:**
- The frontend currently calls ~171 unique commands. That's the real scope.
- Each wrapper is ~3 lines + a JSDoc comment citing the Rust file:line.
- Type safety is enforced by TypeScript at the wrapper boundary.
- One PR per cluster (chat, memory, agents, etc.) is reviewable.

### Pattern

```typescript
// src/lib/blade.ts
import { invoke } from '@tauri-apps/api/core';

// ─── Config ──────────────────────────────────────────────────
/** config.rs:load_config — returns full BladeConfig */
export const getConfig = () => invoke<BladeConfig>('get_config');

/** config.rs:save_config — partial patch, returns void */
export const saveConfig = (patch: Partial<BladeConfig>) =>
  invoke<void>('save_config', { config: patch });

// ─── Chat ─────────────────────────────────────────────────────
/** commands.rs:send_message_stream — starts streaming, events follow via listen() */
export const sendMessageStream = (messages: ChatMessage[], opts?: StreamOptions) =>
  invoke<void>('send_message_stream', { messages, ...opts });

/** commands.rs:cancel_chat */
export const cancelChat = () => invoke<void>('cancel_chat');

// ─── Screen ───────────────────────────────────────────────────
/** godmode.rs:capture_screen — returns base64 PNG or null */
export const captureScreen = () => invoke<string | null>('capture_screen');

// ─── Memory ───────────────────────────────────────────────────
/** memory.rs:memory_search — BM25+vector hybrid search */
export const memorySearch = (query: string, limit?: number) =>
  invoke<MemoryEntry[]>('memory_search', { query, limit: limit ?? 20 });
```

**Convention:**
- Function name is camelCase TypeScript; the string argument to `invoke()` is the exact Rust `#[tauri::command]` name (snake_case).
- JSDoc `/** file.rs:function_name — description */` cites the Rust source.
- Return type `T` is defined in `src/lib/types.ts` (one file for all shared types).
- Components import from `src/lib/blade.ts`, never call `invoke()` directly.

**Rollout strategy:** Start with Foundation phase commands (config, onboarding). Add wrappers per cluster as each cluster is rebuilt. By end of Skin rebuild, wrapper coverage matches frontend coverage (~171 commands).

**Commands beyond current frontend coverage (~593):** Add wrappers only when a new UI surface is built for them. Do not speculatively wrap commands.

### Error handling convention

```typescript
// In components — standard pattern:
const [error, setError] = useState<string | null>(null);

try {
  const result = await blade.getConfig();
  setConfig(result);
} catch (e) {
  setError(typeof e === 'string' ? e : 'Unknown error');
}
```

Tauri returns errors as strings from Rust `Result<T, String>` — `typeof e === 'string'` is the correct check (not `instanceof Error`).

---

## Area 6 — Motion System

### Decision: CSS-only, no motion library

**Reasoning from evidence:**
- `docs/design/orb.css` proves the entire 4-phase orb animation is achievable in pure CSS keyframes (idle breath, listening rings, thinking arcs, speaking pulse).
- View Transitions API (`<ViewTransition>`) is React canary-only as of April 2026 — not stable, API may change.
- Framer Motion adds ~31KB gzip; Tauri webviews pay that cost for every window.
- PROJECT.md explicitly prohibits motion libraries.

### CSS-only Motion Checklist

**Token system** (port from `docs/design/shared.css` + `proto.css` into `src/styles/motion.css`):

```css
:root {
  /* Easing — matches Apple HIG spring curves */
  --ease-spring:  cubic-bezier(0.22, 1, 0.36, 1);    /* entry, lift */
  --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);      /* exit */
  --ease-smooth:  cubic-bezier(0.4, 0, 0.2, 1);       /* default */

  /* Duration */
  --dur-snap:   80ms;    /* instant feedback (button press) */
  --dur-fast:  150ms;    /* hover state, chip highlight */
  --dur-base:  200ms;    /* panel transitions, nav item */
  --dur-enter: 280ms;    /* panel slide-in */
  --dur-slow:  400ms;    /* route change, orb phase shift */
  --dur-float:  6200ms; /* idle breath cycle */
}
```

**Panel slide-in (route change):**

```css
@keyframes slide-in-from-right {
  from { transform: translateX(24px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

.route-enter {
  animation: slide-in-from-right var(--dur-enter) var(--ease-spring) both;
}
```

Apply `route-enter` class on mount in each view component via a `useLayoutEffect` that adds/removes the class. No JS timing math needed.

**Orb animation:** already fully specified in `docs/design/orb.css`. Port directly to `src/styles/orb.css`. Use `data-phase` attribute on the container to switch animation sets. Switch phases by setting `orbEl.dataset.phase = 'listening'` — no React re-render needed for animation changes.

**60fps budget enforcement:**
- Animate only `transform` and `opacity` — these run on the GPU compositor thread.
- Set `will-change: transform` only on the orb core and ring elements (long-lived animations). Remove it from all other elements.
- `backdrop-filter` is expensive on Linux — provide `@media (prefers-reduced-motion)` fallback that drops blur.
- Use `isolation: isolate` on every `.glass` container to contain stacking contexts and prevent blur accumulation.

**View Transitions API — future-compatible approach:**

React `<ViewTransition>` is canary-only. Do NOT use it now. When it stabilizes (React 20 or stable backport), it can wrap the route switch:

```typescript
// Future upgrade path — do not implement now:
import { unstable_ViewTransition as ViewTransition } from 'react';
// Apply CSS route-enter class meanwhile — VTA can adopt same keyframes.
```

The CSS `@keyframes` defined now will be compatible with future VTA adoption — name the animations the same, VTA will invoke them via `::view-transition-new(.route-enter)`.

---

## Area 7 — Tailwind v4 Token Architecture

### CSS-first `@theme` (v4 pattern)

Tailwind v4 exposes tokens as CSS variables automatically when declared in `@theme`. Port `docs/design/shared.css` tokens into `src/styles/tokens.css`:

```css
@import "tailwindcss";

@theme {
  /* Glass fills */
  --color-g-fill-weak:   rgba(255, 255, 255, 0.04);
  --color-g-fill:        rgba(255, 255, 255, 0.07);
  --color-g-fill-strong: rgba(255, 255, 255, 0.11);
  --color-g-fill-heavy:  rgba(255, 255, 255, 0.16);

  /* Text */
  --color-t-1: rgba(255, 255, 255, 0.97);
  --color-t-2: rgba(255, 255, 255, 0.72);
  --color-t-3: rgba(255, 255, 255, 0.50);
  --color-t-4: rgba(255, 255, 255, 0.32);

  /* Radii */
  --radius-xs:   8px;
  --radius-sm:  12px;
  --radius-md:  18px;
  --radius-lg:  26px;
  --radius-xl:  34px;
  --radius-pill: 999px;

  /* Spacing */
  --spacing-1:  4px;  --spacing-2:  8px;  --spacing-3: 12px;
  --spacing-4: 16px;  --spacing-5: 20px;  --spacing-6: 24px;
  --spacing-8: 32px;  --spacing-10: 40px;

  /* Typography */
  --font-display: 'Syne', system-ui;
  --font-body:    'Bricolage Grotesque', system-ui;
  --font-mono:    'JetBrains Mono', ui-monospace;
}
```

In components: use Tailwind utilities (`text-t-2`, `rounded-lg`, `bg-g-fill-strong`) when a utility exists. Use `var(--color-t-2)` in inline styles for dynamic/computed values. Do not hardcode rgba values in components — always reference tokens.

---

## Installation

```bash
# Tauri plugins (Rust side — add to Cargo.toml)
cargo add window-vibrancy
cargo add tauri-plugin-window-state --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'

# JS side
npm install @tauri-apps/plugin-window-state

# Optional — macOS 26+ native Liquid Glass (evaluate risk first):
# cargo add tauri-plugin-liquid-glass
# npm install tauri-plugin-liquid-glass-api
```

No other new npm dependencies are warranted for this rebuild.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Primitive library | Self-built 8 components | shadcn/ui | Radix DOM structure fights glass layout; token namespace conflict |
| Primitive library | Self-built | Radix UI headless alone | Same structural constraints; adds 10–15 KB gzip for components we'd heavily override |
| Motion | CSS-only | Framer Motion | 31 KB gzip; contradicts project mandate; orb.css proves CSS is sufficient |
| Motion | CSS-only | Motion One | Same objection, smaller size but still runtime |
| Motion | CSS-only | React `<ViewTransition>` | Canary-only as of April 2026; API not stable |
| Typed IPC | Hand-written wrappers | TauRPC | Backend rewrite required — out of scope |
| Typed IPC | Hand-written wrappers | tauri-typegen | Rust AST scanner; immature; BLADE macro patterns cause failures |
| State | useChat hook + lift-to-App | Zustand | No second cross-route state today; YAGNI |
| Routing | Custom discriminated-union registry | React Router | No URL needs; History API conflicts with Tauri; adds parse overhead |
| Native glass | window-vibrancy | tauri-plugin-liquid-glass | Private API risk for App Store; window-vibrancy is official Tauri ecosystem |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `window-vibrancy 0.7.1` | `tauri 2.x`, macOS 10.10+ | `macOSPrivateApi: true` required in tauri.conf.json |
| `tauri-plugin-window-state 2.4.1` | `tauri 2.x` | Apply to main window only; known issue with fullscreen exit |
| `@tauri-apps/plugin-window-state 2.4.1` | `@tauri-apps/api 2.x` | Same version as Rust crate |
| `tauri-plugin-liquid-glass 0.1` | `tauri 2.0+`, macOS 26+ | Private API; fallback to NSVisualEffectView on older macOS |
| `react 19.2.5` | `<ViewTransition>` | ViewTransition is canary-only — do NOT use in stable build |
| `tailwindcss 4.2.1` | `@theme` directive | v4 `@theme` replaces `tailwind.config.js` for token definition |

---

## Sources

- `docs.rs/tauri/2.10.2/tauri/webview/struct.WebviewWindowBuilder` — builder method signatures confirmed (HIGH)
- `github.com/tauri-apps/window-vibrancy` releases v0.7.1 — `apply_liquid_glass`, NSVisualEffectMaterial options (HIGH)
- `github.com/hkandala/tauri-plugin-liquid-glass` — private API risk, macOS 26+ requirement, fallback pattern (MEDIUM)
- `github.com/tauri-apps/tauri` issues #12804, #12437, #10064, #6876 — backdrop-filter + transparent window bug (HIGH — confirmed active)
- `v2.tauri.app/plugin/window-state/` — plugin-window-state setup, version 2.4.1 (HIGH)
- `react.dev/reference/react/ViewTransition` — canary-only status confirmed April 2026 (HIGH)
- `kube.io/blog/liquid-glass-css-svg/` — feDisplacementMap refraction pattern, Chromium-only (MEDIUM)
- `css-tricks.com/getting-clarity-on-apples-liquid-glass/` — three-layer composition model (MEDIUM)
- `tailwindcss.com/docs/theme` — v4 @theme directive (HIGH)
- `gethopp.app/blog/tauri-window-state-sync` — emit/listen inter-window sync pattern (MEDIUM)
- `docs/design/shared.css`, `proto.css`, `orb.css` — live design prototype, verified as directional source of truth (HIGH)
- `docs/architecture/2026-04-17-blade-frontend-architecture.md` — live frontend state audit (HIGH)

---

*Stack research for: BLADE Skin Rebuild (macOS Liquid Glass React frontend)*
*Researched: 2026-04-17*
