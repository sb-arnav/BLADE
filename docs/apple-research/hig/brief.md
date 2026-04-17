# BLADE Design Brief: Apple HIG × Liquid Glass for a Tauri Always-On Agent

*Prepared by HI, for the BLADE design team. April 2026.*

BLADE is not an iOS app. You cannot call `.regularMaterial` on Windows, and Linux doesn't know what an NSVisualEffectView is. But the rigor of Apple's system is worth stealing even when the surface isn't. This brief tells you what to lift verbatim, what to translate, and — critically — what to *not* fake, because a bad fake of Liquid Glass is worse than an honest flat UI.

## 1. HIG fundamentals that actually apply to BLADE

Apple's modern macOS layout is built on an **8pt macro grid with a 4pt micro grid** for fine-tuning icons, symbols, and text metrics. Every padding, stack spacing, and component height in BLADE must snap to this. A QuickAsk overlay 480pt wide is fine; 472pt is not. The standard macOS window uses 20pt edge insets, 16pt between grouped controls, 8pt between label and field. Toolbars run 28pt (compact) or 38pt (regular). Use those numbers — shipping an off-grid HUD is the single most "Electron-y" thing you can do.

Apple's Dynamic Type ramp (LargeTitle 34, Title1 28, Title2 22, Title3 20, Headline 17 semibold, Body 17 regular, Callout 16, Subheadline 15, Footnote 13, Caption1 12, Caption2 11) is not a font-size list — it's a **semantic promise**: "Body" means reading content, "Headline" means "this row is scannable." BLADE should expose these as CSS tokens (`--text-body`, `--text-headline`) not pixel values. SF Pro becomes a variable font above 17pt and transitions from Text to Display optical sizing between 17 and 28pt; this is why naive web replicas look slightly wrong at heading sizes — they don't swap optical axis. ([Apple Fonts](https://developer.apple.com/fonts/), [WWDC20 10175 — Details of UI typography](https://developer.apple.com/videos/play/wwdc2020/10175/))

Tracking values matter more than weight: SF Pro Text at 17pt uses roughly **-0.43 tracking**, SF Pro Display at 28pt uses **-0.8**, and 34pt LargeTitle goes to about **-0.9**. Apple ships the full tracking table in [Apple Design Resources](https://developer.apple.com/design/resources/) — load it once, codify it in Tailwind's `letterSpacing` map, and never guess again.

**Sidebars** in modern macOS (post-Tahoe) use Liquid Glass and refract content behind them rather than sitting on a solid fill. **Toolbars** collapse on scroll. **Focus rings** are the user's chosen accent color (defaulting to System Blue `#007AFF` light / `#0A84FF` dark), approximately **3–4pt wide with a 2pt offset** from the focused element ([TPGi focus style reference](https://www.tpgi.com/native-or-custom-a-guide-to-recognizing-focus-styles/), [512 Pixels on Big Sur accent](https://512pixels.net/2020/11/big-sur-accent-highlight-colors/)).

## 2. Liquid Glass — what it actually is, and where CSS dies

Apple's June 2025 announcement describes Liquid Glass as a translucent material that "reflects and refracts its surroundings," with color "informed by surrounding content," reacting to motion with "specular highlights," and making controls "concentric with the rounded corners of modern hardware and app windows." ([Apple Newsroom, June 9 2025](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)) There are two published variants — **Clear** (maximum transparency, used when content underneath is decorative) and **Regular/Tinted** (used when content needs legibility support). macOS Tahoe exposes a user toggle between them ([Wikipedia Liquid Glass](https://en.wikipedia.org/wiki/Liquid_Glass), [liquid-glass.org deep dive](https://www.liquid-glass.org/)).

The rendering requires Apple Silicon-class GPU work: real-time Gaussian blur, shader-based displacement/refraction, and specular response to device motion. Craig Federighi explicitly cited this as why Apple silicon is required.

**Where CSS fails — do not pretend otherwise.** The best current web implementations (kube.io, specy.app, nikdelvin/liquid-glass on GitHub) use `feDisplacementMap` SVG filters + `backdrop-filter`. Three hard limits:

1. **`backdrop-filter` + SVG displacement only composite correctly in Chromium.** Tauri uses the system webview — WebKitGTK on Linux, WebView2 (Chromium) on Windows, WKWebView on macOS. Your refraction will look correct on Windows, broken on Linux, and partially correct on macOS.
2. **`backdrop-filter` only sees content within the element's own bounds.** Apple's Liquid Glass refracts pixels *past* the element's edge. You literally cannot replicate this in CSS without WebGL.
3. **SVG displacement has no super-sampling** — it aliases into a pixelated mess at edges. Blur softens it, but you will never match Apple's clean lensing.

**The rule for BLADE:** Use Liquid Glass-*informed* material only on macOS, via `window.setEffect('hudWindow')` or `'sidebar'` through Tauri's window vibrancy plugin (backed by NSVisualEffectView). On Windows, use Mica (`DWM_SYSTEMBACKDROP_TYPE::MICA`) which Tauri v2 supports. On Linux, **ship a solid-fill dark surface at `#141416` with a 1px inner stroke at `rgba(255,255,255,0.06)`** and do not attempt fake glass. A perfect flat surface is canon; a broken refraction is a tell. Never attempt to emulate specular highlights — moving light that isn't physically motivated looks like a screensaver.

Keep `backdrop-filter: blur(24px) saturate(180%)` as the one CSS effect you do use for overlays (QuickAsk, Ghost). It degrades to a translucent fill where unsupported and never tries to fake refraction.

## 3. Apple Intelligence visual language — the anti-shimmer playbook

Apple Intelligence deliberately avoids the purple-gradient shimmer that every AI wrapper reaches for. Its three visual motifs:

- **Siri "sidewall" glow.** When Siri activates, the device bezel bends inward (a physical-metaphor squish) and an iridescent, voice-reactive glow runs the inside perimeter of the screen. It is screen-*edge*, not screen-center. It is multi-hue (pink/purple/orange/blue rotating), but soft and bounded to the bezel. It reacts to **voice amplitude**, not time.
- **Writing Tools.** A utilitarian popover with options (Proofread, Rewrite, Summarize, Key Points, Table, List). No shimmer. Results appear in the document, not in a chat balloon.
- **Image Playground / Genmoji.** Results-forward UI. The generated thing is the UI.

**Translation for BLADE:** The HUD bar, when BLADE is "thinking," should exhibit a **bounded, voice- or activity-reactive edge glow on the HUD itself, not the whole screen**. Use a 1–2pt gradient stroke that travels the perimeter of the HUD, driven by actual mic amplitude / token arrival rate. Cycle through `oklch(0.78 0.15 310)` → `oklch(0.80 0.14 25)` → `oklch(0.82 0.14 200)` over 2.4s, not a fixed linear gradient. Ease: `cubic-bezier(0.4, 0.0, 0.2, 1)` (Material/Apple shared curve). **Zero sparkles. No rainbow.** If you can't render specular, don't.

## 4. Dynamic Island, menu bar extras, Control Center, Stage Manager

These are Apple's own persistent/ambient surfaces — the direct analogs to BLADE.

**Menu bar extras** ([Bjango](https://bjango.com/articles/designingmenubarextras/)): working area is strictly 22pt tall (24pt including menu bar chrome post-Big Sur). A circular icon feels right at **16×16pt** inside that. Use **template images** (monochrome + alpha), never full color, so macOS tints them to match menu bar state. No padding unless needed for vertical centering. Disabled state = 35% opacity. Apple's HIG also recommends: click opens a **menu**, not a popover, unless you need rich content. BLADE's menu bar extra should render the mic level as an SF-Symbols-style bars icon, opening into a popover only when the user explicitly wants the full HUD.

**Dynamic Island**: expanded height is capped at **160pt** per Apple's Live Activities documentation. The design lesson for BLADE's HUD bar is: **compact → expanded → detailed** with morphing corners, not a modal. Use a spring animation with `response: 0.35, dampingFraction: 0.86` — the interactive-spring feel.

**Control Center modules** are 2×2 grid units with consistent glyph placement. The rule: modules surface *state + one gesture*. BLADE's Homeostasis / Immune / Brain tentacles should each be a Control-Center-like tile — current state glyph, a single tap action, a long-press for detail. Never eight buttons per tile.

**Stage Manager** teaches one thing: **off-screen is okay**. A persistent app can hibernate visually. BLADE's HUD should fade to 35% alpha after 4s idle and restore to 100% on hover, Ctrl+Space, or wake word.

## 5. visionOS lessons that port to 2D

visionOS hover effects are run **outside your app's process** for privacy — the lesson is that hover is state the system owns, not a JS mousemove you spy on. For BLADE, that means: hover states must be CSS `:hover`, not mouse-tracked glows that follow the cursor. Apple's spatial materials also establish that **depth is expressed through material thickness + shadow, never a parallax gimmick**. BLADE's hive cluster should use three z-layers (base, raised, floating) with Apple's shadow ramp (0 1 2 rgba/0.04, 0 4 12 rgba/0.08, 0 16 40 rgba/0.12) — not perspective transforms.

Glanceability: a visionOS glyph must be readable at 2m. Translate: every BLADE HUD icon must be legible at 50% scale. Test by scaling the HUD to 12px tall. If a glyph dies, redraw it.

## 6. What Apple explicitly says NOT to do

Relevant to BLADE, in rank order of how often wrapper apps violate them:

1. **No splash screens.** "A launch screen isn't an onboarding experience or a splash screen, and it isn't an opportunity for artistic expression."
2. **No app logo inside the app.** The menu bar tells the user which app they're in.
3. **No custom spinners.** Use the system progress indicator or an indeterminate line.
4. **No "How can I help?" hero.** Apple Intelligence never centers itself. Writing Tools appears *inline*.
5. **No purple-gradient AI shimmer.** Apple Intelligence uses edge glow, bounded and voice-reactive — not centered sparkles.
6. **No ✨ in UI chrome.** SF Symbols has `sparkles`; Apple uses it sparingly on *results*, never on input affordances.
7. **No rounded chat bubbles as primary UI.** Writing Tools replaces text in-place.
8. **No custom scroll deceleration.** Respect the OS. Natural-scrolling uses a specific exponential decay; overriding feels cheap.
9. **No ambiguous tap targets.** 44×44pt minimum on touch, 28×28pt minimum on pointer.
10. **No decorative icons inside lists.** Only functional glyphs.
11. **No permanently-visible scrollbars on macOS** unless the user has "Always" set in system prefs.
12. **No color as only state signal.** Pair with glyph or weight.

## 7. Concrete BLADE translation

**Type system.** `font-family: ui-sans-serif, -apple-system, "SF Pro Text", "SF Pro Display", "Inter var", system-ui, sans-serif;` for UI; `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace` for code. Load **Inter Display 4.0 (variable)** as the cross-platform fallback because its metrics track SF Pro closely; do not ship Google Fonts' static Inter — it desyncs at Display sizes. Weight ramp: 400 body, 500 emphasis, 590 (Inter's semibold-equivalent) headline, 680 title. Tracking map from Apple's tracking table, keyed per size.

**Color system.** Ship semantic tokens, not raw hex. Dark-mode defaults: `--label: rgba(255,255,255,0.92)`, `--label-secondary: rgba(235,235,245,0.60)`, `--label-tertiary: rgba(235,235,245,0.30)`, `--label-quaternary: rgba(235,235,245,0.16)`. Fills: `--fill-primary: rgba(120,120,128,0.36)`, secondary `0.32`, tertiary `0.24`, quaternary `0.18`. Background ramp: `--bg: #000000`, `--bg-secondary: #1C1C1E`, `--bg-tertiary: #2C2C2E`, `--bg-grouped: #000000`. Separator: `rgba(84,84,88,0.65)`. **Never use raw hex in component code** — semantic token or nothing.

**Motion.** Three springs, named:
- `spring.quick`: `response: 0.28, damping: 0.82` — toggles, hovers.
- `spring.standard`: `response: 0.55, damping: 0.825` — Apple's `.spring` default — panel reveals, state changes.
- `spring.interactive`: `response: 0.15, damping: 0.86` — drag follow, HUD morph.

Reveal `240ms` out, `180ms` in. Dismiss is always faster than reveal. Never animate longer than `400ms` on an always-on surface — it becomes noise.

**Materials.** macOS: `hudWindow` (Tauri vibrancy) on HUD bar, `sidebar` on hive cluster, `popover` on QuickAsk. Windows: Mica on main, Acrylic on overlays. Linux: `rgba(20,20,22,0.92)` solid + 1px inner `rgba(255,255,255,0.06)`. Never mix material and solid in one component.

**Icons.** SF Symbols is macOS-only and Apple's licensing prohibits using the glyphs in non-Apple UI. **Use Phosphor Icons** across BLADE. Reasoning: Phosphor ships thin/light/regular/bold/duotone weights that map to SF Symbols' Ultralight→Black ramp, Lucide only ships stroke. On macOS specifically, *swap in native SF Symbols for system-owned surfaces only* (menu bar extra, Dock tile) to feel native; keep the in-app icons Phosphor for cross-platform parity.

**Corner radii.** Concentric rule: `r_inner = r_outer − padding`. Ladder: 4 (tag), 8 (input), 12 (button), 16 (card), 20 (panel), 28 (window). Always match the window chrome — a 16pt card inside a 28pt window with 12pt padding is correct; a 12pt card inside a 28pt window with 8pt padding is correct. Measure it.

**Focus ring.** System Blue accent `#0A84FF` (dark) / `#007AFF` (light), **3pt width, 2pt offset**, `border-radius` inherits `+2pt` from the element to stay concentric. Animate in `120ms`, out `80ms`. Never remove; only restyle.

Ship this brief and you won't be mistaken for another AI wrapper. Ship it sloppily and you will.
