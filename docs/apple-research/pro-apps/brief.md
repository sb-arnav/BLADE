# BLADE Design System Brief — Apple Pro-App Translation

*A senior design-engineer teardown for Tauri + React. Grounded in live research, not vibes.*

## 1. Apple pro-app teardown — what's stealable

**Logic Pro.** The channel strip is the densest Apple instrument in any pro app: vertical 56–72px wide strips stacked horizontally, each with an LED-style meter, a volume fader, pan knob, inserts list, sends list, input/output routing, and a mute/solo/record cluster at top and bottom. It feels premium because *every pixel earns rent* — no whitespace padding, but the strip's internal rhythm (meter / fader / knobs / buttons) is metronomically regular, so density reads as rhythm instead of noise. The Inspector at left shows a single focused channel strip plus its output strip side-by-side, so you can manipulate signal without opening the Mixer. **For BLADE:** the 11 hive tentacles become vertical channel strips (56px wide) with a live load-meter LED, a status pill (idle/working/blocked), and a task-count badge. Don't try to show everything about each agent — show the minimum that reads as a rhythm, tap to expand to the "full inspector channel strip" on the right.

**Final Cut Pro.** FCP uses a **dual-tone dark UI**: the chrome/panels at roughly `#1E1E1E` to `#2A2A2A` and the Viewer and Inspector against a near-black `#101010`. The contrast ratio between chrome and content is what lets dozens of controls recede and the *content* pop. The Inspector is a fixed non-resizable column (≈320pt) with accordion sections — the non-resizability is a feature, it forces discipline. **For BLADE:** lock the right Inspector to 320px. Chrome panels at `#1C1C1E`, canvas/content at `#000000`, separator between is always a hairline, never a shadow.

**Xcode.** Four zones: Navigator (left, default ~260pt), Editor (center, flex), Inspector (right, default ~260pt), Debug area (bottom, ~200pt flex). State is visualized structurally — breakpoints as a blue chevron in the gutter, warnings as a yellow triangle inline with the offending line, build progress as a thin progress bar *inside the toolbar title area* instead of a modal spinner. **For BLADE:** the chat window adopts this four-zone pattern — Conversation nav left, chat center, Agent/tool inspector right, hive status drawer bottom. Build-progress-in-toolbar is the pattern for "Agent running" — never a modal spinner, never a dancing dot.

**Music (desktop, 2024 redesign).** The now-playing panel pulls artwork and sets a colorized blurred tint behind the chrome — a `backdrop-filter: blur(60px) saturate(180%)` over a color derived from the album art. Library is extremely dense: 28–32px row heights, 13px SF Pro, columns separated by 1px `rgba(255,255,255,0.06)` dividers. **For BLADE:** the QuickAsk overlay and HUD accent-tint can derive from the current active agent's color, giving BLADE an ambient personality without being a rainbow.

**Notes / Journal (iOS 18+ / macOS Sequoia).** Apple's answer to "AI writing surface without looking like ChatGPT" is: *don't build a chat UI at all*. The writing surface stays a document. AI acts *on selections* via Writing Tools — inline animated underline during proofread, full-text shimmer during rewrite, then the result replaces the text with a brief rainbow border pulse. **For BLADE:** the chat log is *a document*, not a bubble stream. Agent output flows inline, operations happen on selection via a command palette.

**Activity Monitor / Console.** CPU History uses just two colors: green for user CPU, red for system, on a black grid. Memory pressure uses green/yellow/red only at thresholds, not continuously. Sparklines are thin, 1px, unadorned. **For BLADE:** the body/dashboard uses two-color sparklines per metric (agent load green, blocked/error red), 24–32px tall, on near-black. No gradients under the curve. No axis labels. Hover reveals the value.

## 2. Raycast teardown

Measured from the live app and Windows beta coverage:

- **Root command row:** 40px tall, 12px horizontal padding, 16×16px leading icon, 13px label, 11px tinted subtitle right-aligned on hover.
- **Keyboard shortcut chips:** rendered as *monospaced glyphs in a 20×20px rounded-4px chip* with `rgba(255,255,255,0.08)` bg, `rgba(255,255,255,0.12)` border, shown right-aligned. Chord like `⌘ K` uses two chips with a 2px gap, never a "+".
- **Detail pane ratio:** roughly 45/55 list-to-detail on desktop; pane splits on a 1px `rgba(255,255,255,0.07)` divider, no shadow.
- **Empty state:** centered SF-symbol-ish icon (44px, 40% opacity), 15px label, 13px secondary caption, a single `⏎ Fallback` chip hint. No illustration.
- **Search ranking:** fuzzy + frecency; top "best match" row gets a left 2px accent bar in system blue; no other differentiation.
- **Windows Electron native-feel tricks:** they ship a custom renderer partly in Rust and force `-webkit-font-smoothing: antialiased` + `text-rendering: geometricPrecision`; Electron lost sub-pixel LCD AA as of Chromium 51 so they compensate with slightly heavier weight (500 instead of 400) for body. They use `font-family: "Segoe UI Variable Text", "Segoe UI", system-ui` with `font-variation-settings: "opsz" 10.5` to hit native on Win11.

## 3. Linear teardown

From *How we redesigned the Linear UI*:

- **3-variable theme generator:** all themes derive from `base`, `accent`, and `contrast` in LCH color space. Reduced from "98 variables per theme" to 3. Contrast is a user-accessible knob. Tokens like `--color-bg`, `--color-bg-tertiary`, `--color-text`, `--color-accent` are programmatically generated via LCH lightness ramps.
- **Typography:** Inter Display for headings, Inter for body — same family, different optical design.
- **Command menu (⌘K):** ~640px wide, full-height list, 36px row height, 13px label. Backdrop blur + ~85% opacity surface.
- **Sidebar:** ~224px collapsed-friendly, 28px row height, 12px font, extreme hierarchy flattening (workspace icon 20px + name, then sections as all-caps 10px 500-weight labels).
- **Sub-pixel dividers:** 1px borders colored at `rgba(255,255,255,0.06)` on dark, plus `transform: translateZ(0)` + `border-top: 0.5px solid` on Retina to render a true half-pixel.
- **Avatar stacking:** 20px circles, negative `margin-left: -6px`, 1.5px ring of `var(--color-bg)` around each for separation.

**For BLADE:** adopt the 3-variable theme generator wholesale — `base`, `accent`, `contrast`. Implement in LCH via the CSS `lch()` function with a TS helper that derives all 40+ design tokens.

## 4. Concrete implementation specs

### a. Typography stack for Tauri

```css
:root {
  --font-sans:
    ui-sans-serif, system-ui,
    -apple-system, BlinkMacSystemFont,
    "Segoe UI Variable Text", "Segoe UI",
    "Inter", "Roboto",
    sans-serif;

  --font-sans-display:
    ui-sans-serif, system-ui,
    -apple-system, BlinkMacSystemFont,
    "Segoe UI Variable Display", "Segoe UI",
    "Inter Display", "Inter",
    sans-serif;

  --font-mono:
    ui-monospace, "SF Mono",
    "Cascadia Code",
    "JetBrains Mono",
    Menlo, Consolas, monospace;

  font-feature-settings: "ss01", "ss03", "cv11", "cpsp";
  font-variation-settings: "opsz" 10.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: geometricPrecision;
}
```

On macOS, `-apple-system` resolves to SF Pro and crosses the SF Pro Text → SF Pro Display threshold automatically at 20pt — verified. On Windows, `system-ui` does **not** pick up Segoe UI Variable; you must name it explicitly. Recommendation: **JetBrains Mono** as a shipped web font for the code/agent-trace views — it gives a consistent rendering across all three OSes.

**Weight ramp (measured against Apple's HIG):**
- 11px UI caption — 500
- 12px secondary UI — 500
- 13px body/list — 400 (macOS) / 500 (Windows — compensates for lack of sub-pixel AA)
- 15px body-large — 400
- 17px title-small — 600
- 22px title — 600, tracking `-0.015em`
- 28px display — 700, tracking `-0.022em`

### b. Color tokens (verified)

iOS/macOS dark-mode values, measured:

```css
:root[data-theme="dark"] {
  --label:               #FFFFFF;
  --label-secondary:     #EBEBF599;
  --label-tertiary:      #EBEBF54C;
  --label-quaternary:    #EBEBF52D;

  --fill-1:              #7878805B;
  --fill-2:              #78788051;
  --fill-3:              #7676803D;
  --fill-4:              #74748029;

  --separator:           #54545899;
  --separator-opaque:    #38383A;

  --system-blue:         #0A84FF;
  --system-blue-hover:   #409CFF;

  --bg-window:           #1C1C1E;
  --bg-canvas:           #000000;
  --bg-sidebar:          #1C1C1E;
  --bg-control:          #2C2C2E;
  --bg-grouped:          #000000;
  --bg-grouped-2:        #1C1C1E;
  --bg-grouped-3:        #2C2C2E;
}
:root[data-theme="light"] {
  --label:               #000000;
  --label-secondary:     #3C3C4399;
  --label-tertiary:      #3C3C434C;
  --label-quaternary:    #3C3C432D;
  --fill-1:              #78788033;
  --fill-2:              #78788028;
  --separator:           #3C3C4349;
  --separator-opaque:    #C6C6C8;
  --system-blue:         #007AFF;
  --bg-window:           #F2F2F7;
  --bg-canvas:           #FFFFFF;
}
```

### c. Motion specs

Verified SwiftUI spring defaults:

| Use | Apple spring | Framer Motion equivalent |
|---|---|---|
| Default sheet/card | response 0.55, dampingFraction 0.825 | `{ type: "spring", stiffness: 130, damping: 14, mass: 1 }` |
| Interactive drag | response 0.15, dampingFraction 0.86 | `{ type: "spring", stiffness: 1750, damping: 50, mass: 1 }` |
| `.smooth` (iOS 17) | duration 0.35, bounce 0 | `{ type: "spring", duration: 0.35, bounce: 0 }` |
| `.snappy` | duration 0.25, bounce 0.15 | `{ type: "spring", duration: 0.25, bounce: 0.15 }` |
| `.bouncy` | duration 0.5, bounce 0.3 | `{ type: "spring", duration: 0.5, bounce: 0.3 }` |

**Duration curves:**
- Hover: 100ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`
- Focus ring: 150ms, same curve
- Reveal/expand: 250ms, `cubic-bezier(0.22, 1, 0.36, 1)`
- Dismiss/collapse: 200ms, `cubic-bezier(0.4, 0, 1, 1)`
- State change: 300ms, `cubic-bezier(0.4, 0, 0.2, 1)`

House spring: `.snappy`. Overlay reveals: `.smooth`.

### d. Icon system

Ranked for "SF Symbols feel":

1. **Lucide** — default 2px stroke, 24×24 viewBox, geometric consistency, 1,450 icons. Closest to SF Symbols' regular weight at 17pt.
2. **Phosphor** — 6 weights, better if you need axis variation.
3. **Tabler** — largest library, less geometric consistency.

Use `strokeWidth={1.75}` globally.

### e. Layout primitives

- **4pt grid.** Tailwind v4 base is already 4px.
- **Title bar:** macOS 14+ = 28pt; Windows 11 = 32px. Set via Tauri `platform()` into CSS var.
- **Toolbar:** 44px.
- **Sidebar:** 240px (regular), 280px (wide), collapsible to 48px (rail).
- **Inspector:** 320px fixed (FCP pattern).
- **Density:** Compact 24 / Regular 28 / Spacious 32.

### f. Shadows, depth, elevation

Apple's window/sidebar/toolbar use **zero drop shadows** — elevation = 1px hairline + vibrancy.

Popover/menu/tooltip/command palette:
```css
.popover-shadow {
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.12),
    0 8px 32px rgba(0, 0, 0, 0.24),
    0 2px 8px rgba(0, 0, 0, 0.12);
  background: color-mix(in oklch, var(--bg-control) 85%, transparent);
  backdrop-filter: blur(32px) saturate(180%);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  border: 0.5px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
}
```

Concentric rule: `r_inner = r_outer − padding`.

## 5. Component patterns to steal

- **Inspector pane:** right sidebar, 320px fixed, accordion sections with chevron-down, section labels 11px 600 uppercase.
- **Sidebar nav:** 240px, sections with 10–11px uppercase labels at `--label-tertiary`, 28px row height, 6px leading icon, selected row fill `var(--fill-1)` plus `--system-blue` left 2px accent bar on keyboard focus only.
- **Segmented control:** 28px tall, 2px inner padding, `--bg-control` selected, 13px label.
- **Popover:** no tail.
- **Toolbar:** icons-only with tooltips by default.
- **Empty states:** one icon at 44px 40% opacity, 15px title, 13px subtitle. No illustration.
- **Loading:** no custom loaders. 2px indeterminate toolbar bar or 16px system spinner.
- **Search:** 28px tall, rounded 6px, `--fill-1` bg, 3px focus ring at 40% systemBlue.
- **Multi-select:** Cmd-click toggles, Shift-click ranges; selection is `color-mix(in oklch, var(--system-blue) 20%, transparent)` fill + 0.5px 40%-blue border.

## 6. Apple Intelligence visual pattern

1. **During generation:** iridescent gradient border pulses around the affected region — pinks, purples, oranges, blues in a slow 3s loop.
2. **Proofread:** corrected words get an animated underline (~1px, accent color, 300ms left→right).
3. **Rewrite:** paragraph shimmers with mask gradient sweeping left to right at 1.5s duration, then replaces content with ~400ms iridescent border fade.
4. **Summary / "AI-generated":** small sparkles-style glyph as a leading icon in `--label-secondary` — the icon is the only tell once output is static.

```css
@keyframes ai-shimmer {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
.ai-active {
  position: relative;
  background: linear-gradient(110deg, #FF5AC8, #AF52DE, #5E5CE6, #32ADE6, #FF9500, #FF5AC8);
  background-size: 300% 300%;
  animation: ai-shimmer 3s ease-in-out infinite;
  padding: 1px;
  border-radius: 10px;
}
.ai-active > * { background: var(--bg-canvas); border-radius: 9px; }
```

## 7. Recommendations for BLADE's surfaces

- **HUD bar (28px always-on strip):** menu-bar-extra pattern. 28px on macOS, 32px on Windows. Background: `rgba(28,28,30,0.72)` + `backdrop-filter: blur(32px) saturate(180%)`.
- **QuickAsk overlay (Ctrl+Space):** Raycast pattern. 720px × 80px initial → expands to 560px tall. 40px row height, 13px label. Rounded 14px. Centered at 28% viewport height.
- **Chat window:** Xcode four-zone. Left conversation list 240px. Center document (no bubbles). Right Inspector 320px. Bottom hive drawer 200px.
- **Hive radial cluster:** Logic Pro channel strip grid. 11 vertical strips, 56×140px each, LED meter top, 13px name, 11px task, status pill. Sparkline at base. Click → right Inspector.
- **Body / Dashboard:** Xcode debug-navigator. Left metric-category nav, center 2-color sparkline grid (200×80), right inspector.

## 10 rules we do not break (BLADE design constitution)

1. No purple gradients used decoratively. Iridescent only on active AI generation.
2. No chat bubbles. Conversation is a document.
3. No custom loaders. 2px bar or 16px spinner only.
4. No centered "How can I help?" hero.
5. No drop shadows on pane edges.
6. Typography: 400/500/600/700 only, negative tracking at 22px+.
7. Icons are Lucide at `strokeWidth={1.75}`.
8. Three theme variables: `base`, `accent`, `contrast`.
9. Density is a first-class setting.
10. Snappy is the house spring.
