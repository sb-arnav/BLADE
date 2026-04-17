# BLADE Design Tokens — ship-ready

Single source of truth. Paste the CSS into `src/index.css` when the new frontend lands, wrap tokens in Tailwind v4 `@theme { … }`.

## 1. Color — dark (default) + light

```css
:root, :root[data-theme="dark"] {
  /* labels — text on content */
  --label:               #FFFFFF;
  --label-secondary:     #EBEBF599;   /* .60 */
  --label-tertiary:      #EBEBF54C;   /* .30 */
  --label-quaternary:    #EBEBF52D;   /* .18 */

  /* fills — component backgrounds */
  --fill-1:              #7878805B;   /* .36 */
  --fill-2:              #78788051;   /* .32 */
  --fill-3:              #7676803D;   /* .24 */
  --fill-4:              #74748029;   /* .16 */

  /* hairlines — never a shadow, always a hairline */
  --separator:           #54545899;   /* .60 */
  --separator-opaque:    #38383A;

  /* canvas vs chrome — FCP dual-tone rule */
  --bg-canvas:           #000000;     /* content */
  --bg-window:           #1C1C1E;     /* chrome */
  --bg-sidebar:          #1C1C1E;
  --bg-control:          #2C2C2E;
  --bg-grouped-1:        #000000;
  --bg-grouped-2:        #1C1C1E;
  --bg-grouped-3:        #2C2C2E;

  /* accent — default system blue; user can override */
  --system-blue:         #0A84FF;
  --system-blue-hover:   #409CFF;
  --focus-ring:          rgba(10,132,255,0.40);
}

:root[data-theme="light"] {
  --label:               #000000;
  --label-secondary:     #3C3C4399;
  --label-tertiary:      #3C3C434C;
  --label-quaternary:    #3C3C432D;
  --fill-1:              #78788033;
  --fill-2:              #78788028;
  --fill-3:              #7878801F;
  --fill-4:              #78788014;
  --separator:           #3C3C4349;
  --separator-opaque:    #C6C6C8;
  --bg-canvas:           #FFFFFF;
  --bg-window:           #F2F2F7;
  --bg-sidebar:          #F2F2F7;
  --bg-control:          #FFFFFF;
  --system-blue:         #007AFF;
  --system-blue-hover:   #0060DF;
  --focus-ring:          rgba(0,122,255,0.40);
}
```

**Rule:** no raw hex in components. Always a token.

## 2. Typography stack

```css
:root {
  --font-sans:
    ui-sans-serif, system-ui,
    -apple-system, BlinkMacSystemFont,
    "Segoe UI Variable Text", "Segoe UI",
    "Inter", "Roboto",
    sans-serif;

  --font-display:
    ui-sans-serif, system-ui,
    -apple-system, BlinkMacSystemFont,
    "Segoe UI Variable Display", "Segoe UI",
    "Inter Display", "Inter",
    sans-serif;

  --font-mono:
    ui-monospace, "SF Mono",
    "JetBrains Mono", "Cascadia Code",
    Menlo, Consolas, monospace;

  font-feature-settings: "ss01", "ss03", "cv11", "cpsp";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: geometricPrecision;
}
```

Ship **Inter Variable 4.0** + **Inter Display Variable** + **JetBrains Mono Variable** as local font files (WOFF2) for non-Apple platforms. Do not use Google Fonts CDN.

### Type ramp (semantic → size/weight/tracking)

| Token | px | weight | tracking | use |
|---|---|---|---|---|
| `--text-caption-2` | 11 | 500 | 0 | HUD labels, mono chips |
| `--text-caption-1` | 12 | 500 | 0 | section headers (all-caps) |
| `--text-footnote` | 13 | 400 / 500 Win | -0.005em | list rows, body |
| `--text-callout` | 15 | 400 | -0.008em | body-large, inspector |
| `--text-headline` | 17 | 600 | -0.01em | section titles |
| `--text-title-3` | 20 | 600 | -0.012em | panel titles |
| `--text-title-2` | 22 | 600 | -0.015em | view titles |
| `--text-title-1` | 28 | 700 | -0.022em | display numerics |
| `--text-large-title` | 34 | 700 | -0.03em | onboarding only |

Bump 13px body to **500** on Windows — Chromium lost sub-pixel LCD AA; 500 compensates.

## 3. Motion — Framer Motion presets

```ts
// src/lib/motion.ts
export const spring = {
  quick:       { type: "spring", duration: 0.22, bounce: 0.12 },   // hover, toggle
  snappy:      { type: "spring", duration: 0.25, bounce: 0.15 },   // HOUSE SPRING
  smooth:      { type: "spring", duration: 0.35, bounce: 0 },      // overlay reveal
  standard:    { type: "spring", stiffness: 130, damping: 14 },    // sheet, card
  interactive: { type: "spring", stiffness: 1750, damping: 50 },   // drag follow
} as const;

export const ease = {
  hover:   { duration: 0.10, ease: [0.25, 0.1, 0.25, 1] },
  focus:   { duration: 0.15, ease: [0.25, 0.1, 0.25, 1] },
  reveal:  { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
  dismiss: { duration: 0.20, ease: [0.4, 0, 1, 1] },
  state:   { duration: 0.30, ease: [0.4, 0, 0.2, 1] },
} as const;
```

**Rules:** snappy is the house spring. Dismiss always faster than reveal. Never animate longer than 400ms on an always-on surface.

## 4. Radii — concentric rule

```css
:root {
  --radius-tag:    4px;
  --radius-input:  8px;
  --radius-button: 10px;
  --radius-card:   12px;
  --radius-panel:  16px;
  --radius-window: 20px;
  --radius-hud:    14px;
}
```

**Formula:** `r_inner = r_outer − padding`. If a 12px card has 8px padding, inner elements get 4px.

## 5. Layout

```css
:root {
  --titlebar-h-macos:   28px;
  --titlebar-h-windows: 32px;
  --toolbar-h:          44px;
  --sidebar-w-rail:     48px;
  --sidebar-w:          240px;
  --sidebar-w-wide:     280px;
  --inspector-w:        320px;  /* FCP fixed */
  --hud-h:              28px;   /* 32px on Windows */
  --row-compact:        24px;
  --row-regular:        28px;
  --row-spacious:       32px;
}
```

## 6. Materials — per OS

| Surface | macOS | Windows | Linux |
|---|---|---|---|
| HUD bar | `hudWindow` vibrancy | Mica | `rgba(20,20,22,0.92)` + hairline |
| Sidebar | `sidebar` | Mica | `#1C1C1E` + hairline |
| QuickAsk overlay | `popover` | Acrylic | `backdrop-filter: blur(24px) saturate(180%)` + `rgba(28,28,30,0.72)` |
| Chat window | system-default | system-default | `#000000` canvas + `#1C1C1E` chrome |
| Ghost overlay | transparent + content-protect | transparent + content-protect | transparent + content-protect |

Tauri vibrancy plugin config in `src-tauri/tauri.conf.json` when the new frontend lands.

## 7. Popover shadow — the only shadow recipe

```css
.popover {
  background: color-mix(in oklch, var(--bg-control) 85%, transparent);
  backdrop-filter: blur(32px) saturate(180%);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  border: 0.5px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.12),
    0 8px 32px rgba(0, 0, 0, 0.24),
    0 2px 8px rgba(0, 0, 0, 0.12);
}
```

Pane edges use hairlines, never shadows. Only popovers, context menus, tooltips, command palette get the recipe.

## 8. Focus ring

```css
.focus-ring {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: calc(var(--radius, 8px) + 2px);
  transition: outline 120ms ease-out;
}
.focus-ring:focus-visible { outline-width: 3px; }
.focus-ring:not(:focus-visible) { outline-color: transparent; }
```

## 9. AI-active shimmer — BOUNDED, restricted use

```css
@keyframes ai-shimmer {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
.ai-active {
  position: relative;
  padding: 1px;
  border-radius: calc(var(--radius, 10px) + 1px);
  background: linear-gradient(110deg,
    oklch(0.78 0.15 310),
    oklch(0.80 0.14 25),
    oklch(0.82 0.14 200),
    oklch(0.78 0.15 310)
  );
  background-size: 300% 300%;
  animation: ai-shimmer 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.ai-active > * {
  background: var(--bg-canvas);
  border-radius: var(--radius, 10px);
}
```

**Hard rules:**
- Only on regions actively receiving agent tokens.
- Stops within 120ms of stream end.
- **Never** on static chrome, never on buttons, never on empty states.
- Amplitude-reactive (voice) or token-arrival-reactive (text) — not time-based when possible.

## 10. Icon system

`pnpm add lucide-react`. Global default: `strokeWidth={1.75}`, `size={16}`.

```tsx
import { Command, Search, CircleDot } from "lucide-react";
<Command size={16} strokeWidth={1.75} />
```

**Never mix icon sets. No emoji as UI icons.**

## 11. Theme engine — 3 variables

Inputs: `base` (bg hue/lightness), `accent` (system color), `contrast` (user knob 0–100).

Everything above is derived. Implement with `lch()` / `oklch()` ramps. Token for users: one slider (Contrast), one color picker (Accent), one light/dark toggle (Base).

## 12. Platform detection — Tauri

```ts
import { platform } from "@tauri-apps/plugin-os";
const p = await platform();
document.documentElement.dataset.platform = p; // "macos" | "windows" | "linux"
```

Then CSS gates by `:root[data-platform="windows"] { --titlebar-h: 32px; }` etc.

---

**Non-negotiables** — if you violate these, the whole system collapses:

1. Tokens only in components. No raw hex.
2. Snappy is the house spring.
3. Shadows live only in the popover recipe.
4. AI shimmer is restricted to active generation and nowhere else.
5. `backdrop-filter` is the one CSS glass effect; never fake Liquid Glass refraction.
6. Concentric radii, always.
7. 4px grid, always.
8. Icons: Lucide at 1.75 stroke.
9. 3 theme variables. No special-case overrides.
10. Test every glyph at 50% scale — if it dies, redraw.
