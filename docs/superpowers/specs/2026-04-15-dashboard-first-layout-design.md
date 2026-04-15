# BLADE Dashboard-First Layout — Design Spec
Date: 2026-04-15

## Overview

Rebuild BLADE's layout so the dashboard is the app shell. Chat becomes a right-side panel. Navigation becomes a narrow icon rail. The approach follows Option A (dashboard as shell) to avoid the black-screen re-mount bug class entirely.

---

## Architecture

### Routing change
- `useState<Route>("chat")` → `useState<Route>("dashboard")` in `App.tsx`
- Chat is no longer a full-page route when accessed from the dashboard — it renders as a panel inside the dashboard component
- All other full-page routes (Terminal, Git, Canvas, etc.) continue to work as-is; back button returns to dashboard

### Shell layout
```
[TitleBar 34px fixed]
[Nav rail 62px fixed left] | [Dashboard main — fills remaining space]
                              [Chat panel 400px — slides in from right, overlaps main]
                              [History drawer 250px — slides in from left over nav]
```

---

## Component Plan

### New/modified components

**`Dashboard.tsx`** (rewrite) — the app shell
- Owns `chatOpen` and `histOpen` state
- Renders the two-section grid (live top, today bottom)
- Conditionally renders `ChatPanel` and `HistoryDrawer` as overlaid panels
- Accepts `onNavigate(route)` to push full-page routes up to App.tsx

**`NavRail.tsx`** (new, extracted from Sidebar.tsx)
- 62px fixed, icon-only
- Active indicator: 3px left-edge accent pill + indigo background on button
- Glass tooltip on hover (no system tooltips)
- Items: Dashboard, Conversations (opens HistoryDrawer), Terminal, Git, Hive, Ghost Mode, Settings
- No collapse/expand — always 62px

**`ChatPanel.tsx`** (new)
- Fixed right, 400px wide
- Spring slide animation: `cubic-bezier(0.32, 0.72, 0, 1)`
- Renders full `ChatWindow` contents inside (messages, input bar)
- Close button collapses back
- Main area shrinks via `margin-right: 400px` transition (same spring curve)
- Chat state persists — no unmount on close

**`HistoryDrawer.tsx`** (new)
- Fixed left (starts at x=62px, nav rail edge)
- 250px wide, spring slide
- Lists conversations from history with active highlight
- Clicking a conversation loads it into the chat panel (opens panel if closed)

---

## Visual Design

### Typography
- **Font**: `Bricolage Grotesque` (Google Fonts, variable weight 300–700) for all UI text
- **Mono**: `JetBrains Mono` for paths, timestamps, code, elapsed times
- Install via `index.css` `@import` from Google Fonts CDN

### Background
- User's desktop wallpaper as the actual background (via Tauri `invoke("get_wallpaper_path")` → CSS `background-image`)
- Dark scrim overlay `rgba(0,0,0,0.38)` above wallpaper for readability
- Fallback: deep indigo gradient mesh if wallpaper unavailable
- Wallpaper refreshes on app focus (in case user changed it)

### Glass material (applied to all panels)
```css
background: rgba(255,255,255,0.07);
backdrop-filter: blur(44px) saturate(1.6) brightness(0.88);
border: 1px solid rgba(255,255,255,0.13);
border-radius: 20px;
box-shadow:
  inset 0 1px 0 rgba(255,255,255,0.18),
  0 24px 60px rgba(0,0,0,0.35);
```

### Color tokens (additions to tailwind.config.js)
- `--accent: #818cf8` (indigo-400, slightly lighter than current)
- `--green: #4ade80`
- `--amber: #fbbf24`
- `--red: #f87171`
- `--blue: #60a5fa`
- `--text-2: rgba(255,255,255,0.55)`
- `--text-3: rgba(255,255,255,0.28)`

---

## Dashboard Layout

### Top section (47% height) — Live Intelligence
Three-column asymmetric grid: `1.7fr 1fr 0.75fr`

**God Mode card (left, hero)**
- Header: "GOD MODE · PERCEPTION" label + "Extreme" badge
- Hero display: huge current app name (44px Bricolage 800), file path in mono blue, user state pill
- Footer bar: 4 inline stats — Agents, Memories, Mic status, Today's spend

**Agents card (middle)**
- 3 running agents, each with: name, elapsed time, task description, progress bar
- Progress bars animate (shimmer effect)
- Header badge: "N running" chip

**Integrations card (right)**
- 2×2 tile grid: Email, Slack, GitHub, Calendar
- Each tile: service name, big number/status, subtitle
- Number color-coded: amber = pending, green = OK, accent = count

### Bottom section (53% height) — Today
Two-column grid: `1.05fr 1.3fr`

**Calendar card (left)**
- Connected timeline: vertical line on left with dot connectors
- Next event: animated accent dot + accent-colored time + "in N min" badge
- Subsequent events: muted dots
- 3 events shown

**Right column (stacked)**
- *Action Queue card*: 3 items with colored left-edge accent (3px bar), title, subtitle, CTA button
  - Colors: amber = urgent reply, accent = approval needed, green = accept/confirm
- *Stats strip*: flat 4-column grid — Chats, Spend, Memories, Screen time
  - Each: label, big number (Bricolage 700), delta with color

---

## Wallpaper Integration (Rust)

Add `get_wallpaper_path` Tauri command to `commands.rs`:

**Windows**: Read registry key `HKCU\Control Panel\Desktop\WallPaper`
**macOS**: Read `~/Library/Preferences/com.apple.desktop.plist`
**Linux**: `gsettings get org.gnome.desktop.background picture-uri`

Returns the absolute file path as a string. Frontend converts to a Tauri asset URL via `convertFileSrc()`.

---

## Animations

- **Card load**: staggered `translateY(14px) → 0` + `scale(0.97) → 1`, delays 0–260ms, `cubic-bezier(0.22,1,0.36,1)`
- **Chat panel slide**: `translateX(100%) → 0`, `cubic-bezier(0.32,0.72,0,1)`, 460ms
- **History drawer slide**: same spring curve, 430ms
- **Main area reflow**: `margin-right` transitions with same spring curve when chat opens/closes
- **Agent progress bars**: opacity shimmer 2.2s infinite
- **Live dot**: scale + opacity pulse 2s infinite
- **No bounce, no elastic** — Apple spring feel, not game-y

---

## What Does NOT Change

- All existing full-page routes stay exactly as-is
- `ChatWindow.tsx` internals unchanged — `ChatPanel.tsx` wraps it
- `useChat`, `useTTS`, all chat hooks untouched
- Existing theme system (`blade-*` tokens) stays; new tokens added alongside
- `StatusBar.tsx` stays at bottom

---

## Out of Scope (this sprint)

- Always-listening agent display (item #2 in HIVE_PLAN.md)
- Liquid glass UI system-wide (item #3) — this spec establishes the pattern, full rollout is separate
- Hive tentacle integrations (real Slack/email/GitHub data) — cards show mock data for now
- Wallpaper on macOS/Linux — Windows only first
