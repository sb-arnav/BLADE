# BLADE — Apple Design Research

Research done Apr 17 2026 to re-ground the BLADE frontend rebuild in Apple-caliber quality without looking like another AI wrapper.

## Files

- **[hig/brief.md](hig/brief.md)** — Apple HIG fundamentals + Liquid Glass + Apple Intelligence + Dynamic Island/menu bar extras/Control Center/Stage Manager/visionOS translation. Opinionated.
- **[pro-apps/brief.md](pro-apps/brief.md)** — Apple pro-app teardowns (Logic, FCP, Xcode, Music, Notes, Activity Monitor) + Raycast + Linear, with full implementation specs (color hex, spring values, type ramp).
- **[DESIGN_TOKENS.md](DESIGN_TOKENS.md)** — Ship-ready CSS + TS: color tokens, type ramp, motion presets, radii, materials per OS, the popover-shadow recipe, AI shimmer, focus ring, icon system. Paste-and-go once the new frontend lands.
- **[fonts/](fonts/)** — SF Pro (204M), SF Mono (1.6M), SF Compact (166M), New York serif (5.3M) DMGs downloaded from `devimages-cdn.apple.com`. Mount on macOS to install locally. BLADE does not bundle these — CSS references them via `-apple-system` so they only render where the user already has them.

## Final decisions (where the two research threads disagreed)

| Conflict | Decision | Why |
|---|---|---|
| Icon library | **Lucide** at `strokeWidth={1.75}` | Measured geometric match to SF Symbols regular at 17pt; Phosphor's weight axis is more variation than BLADE needs. |
| AI generation shimmer | **Bounded 3-color `oklch` edge glow, amplitude-reactive, 2.4s loop** (HIG brief) | Agent 2's full 6-color purple-pink-blue keyframe is too close to every ChatGPT wrapper. BLADE stays disciplined. |
| Hive cluster layout | **Logic Pro channel-strip grid**, not radial | Radial reads as hackathon. Channel strips are Apple-native density. |
| Chat window | **Xcode four-zone** (nav / document / inspector / hive drawer) | Matches the depth of BLADE's 791 commands; a single-column chat undersells the product. |
| Liquid Glass emulation on Linux | **Solid `#141416` + 1px hairline, no fake glass** | WebKitGTK breaks SVG displacement; a bad fake is worse than honest flat. |
| Fonts | **System stack, no Google CDN**. JetBrains Mono bundled for mono consistency. | `-apple-system` / `Segoe UI Variable` native on macOS/Windows; only ship what we need. |

## The 10 rules (BLADE design constitution)

1. **No purple gradients used decoratively.** Iridescent only on active AI generation.
2. **No chat bubbles.** Conversation is a document (Notes/Journal pattern).
3. **No custom loaders.** 2px indeterminate bar in the toolbar, or 16px system spinner.
4. **No centered "How can I help?" hero.** QuickAsk is a pill; main window opens to last state.
5. **No drop shadows on pane edges.** Elevation = 1px hairline + vibrancy. Shadow only for popovers.
6. **Typography: 400/500/600/700 only, negative tracking at 22px+.** `-0.015em` at 22px, `-0.022em` at 28px.
7. **Icons: Lucide at `strokeWidth={1.75}`, 1em size.** No mixed icon sets. No emoji as UI chrome.
8. **Three theme variables only: `base`, `accent`, `contrast`.** All tokens derive via LCH ramps (Linear's system).
9. **Density is a first-class setting (compact 24 / regular 28 / spacious 32).** Default regular on macOS, compact on Windows.
10. **Snappy is the house spring: `{ duration: 0.25, bounce: 0.15 }`.** Smooth for overlay reveals only.

## What this enables

Every BLADE surface — HUD bar, QuickAsk, chat, hive, body/dashboard, ghost overlay, settings — can now be specced against this constitution in minutes. The next step is information architecture (sitemap, nav shape) for the main window, then screen-by-screen design starting with QuickAsk or HUD.
