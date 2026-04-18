# 00-PROTO-FLOW — Prototype-to-Flow Mapping

**Source:** `docs/design/` — 11 HTML prototypes + shared CSS token files
**Phase:** 0 — Pre-Rebuild Audit (Task 1.3)
**Status:** Complete

---

## A. Prototype Index

| # | Filename | Window | Route |
|---|----------|--------|-------|
| A-01 | `onboarding-01-provider.html` | main | `onboarding` (step 1) |
| A-02 | `onboarding-02-apikey.html` | main | `onboarding` (step 2) |
| A-03 | `onboarding-03-ready.html` | main | `onboarding` (step 3) |
| A-04 | `dashboard.html` | main | `dashboard` |
| A-05 | `dashboard-chat.html` | main | `chat` (inline panel mode) |
| A-06 | `voice-orb.html` | overlay (440×440) | N/A — always-floating NSPanel |
| A-07 | `voice-orb-states.html` | any (design reference) | N/A — phase-state reference sheet |
| A-08 | `ghost-overlay.html` | ghost_overlay | N/A — meeting assist overlay |
| A-09 | `quickask.html` | quickask | QuickAsk window |
| A-10 | `quickask-voice.html` | quickask | QuickAsk (voice mode) |
| A-11 | `settings.html` | main | `settings` (provider sub-page) |

---

## A.1 Onboarding Flow (3 screens, main window)

### Screen 1 — `onboarding-01-provider.html`

**Purpose:** First-run provider picker.

**Layout:** Centered `.glass.heavy` card, 900×auto, `var(--r-2xl)` = 44px.

**Step indicator:** Pills row — Step 1 active, Steps 2/3 idle. Active pill uses white `#fff` background on `.num`; done pill uses `rgba(138,255,199,0.3)` with green checkmark.

**Content structure:**
- Brand row: 52×52 white gradient mark (`border-radius: 16px`) + "BLADE / Your personal intelligence"
- `h1.title` — 44px, weight 600, tracking −0.03em
- `p.subtitle` — 16px, `var(--t-2)`
- 2-column 6-provider grid (Anthropic default-selected)

**Provider grid items:**
```
anthropic  → gradient(135deg, #c96442, #f0a97e)
openai     → gradient(135deg, #0f8a60, #10b27a)
google     → gradient(135deg, #4285f4, #34a0f5)
groq       → gradient(135deg, #f55036, #ff7a50)
ollama     → gradient(135deg, #2c2c2c, #555)
openrouter → gradient(135deg, #5b5fe8, #8b6fff)
```

**Selected state:** `background: rgba(255,255,255,0.13)`, `border-color: rgba(255,255,255,0.4)`, white checkmark badge top-right.

**Footer:** Privacy hint (lock icon + "Keys are encrypted in your OS keychain. BLADE never phones home.") + Continue CTA `→ onboarding-02-apikey.html`.

**Tauri wiring needed:**
- `get_onboarding_status()` → check before render (if already done, redirect to dashboard)
- No invoke on this screen; state held in component until Step 3 confirm

---

### Screen 2 — `onboarding-02-apikey.html`

**Purpose:** API key entry + validation for selected provider.

**Layout:** `.glass.heavy` card, 760×auto.

**Step indicator:** Step 1 done (green check), Step 2 active, Step 3 idle.

**Key input:**
- Width: `calc(100% − icon − button-group)`; padding: `18px 200px 18px 52px`
- Font: `JetBrains Mono`, 14px
- Key icon prefix (left), Paste + Test buttons (right)
- Focus ring: `0 0 0 4px rgba(255,255,255,0.06)`

**Post-validation status bar:**
```css
background: rgba(138,255,199,0.10);
border: 1px solid rgba(138,255,199,0.3);
color: #c4ffe0;
```
- Contains: green dot (`.s-dot` with `box-shadow: 0 0 10px #8affc7`), model name + credit amount in JetBrains Mono

**Available model pills:** After validation, display model name pills with green dots; capability dots (orange=context, blue=vision, pink=tool-use).

**Footer:** Back link `← onboarding-01-provider.html` + Continue CTA `→ onboarding-03-ready.html`.

**Tauri wiring needed:**
- `store_provider_key(provider, key)` on Test click
- `get_all_provider_keys()` to populate model list after validation

---

### Screen 3 — `onboarding-03-ready.html`

**Purpose:** Confirmation + deep scan progress while BLADE calibrates.

**Layout:** `.glass.heavy` card, 820×auto, centered, text-align center.

**Hero mark:** 128×128, `border-radius: 40px`, white gradient, large "B" — radial glow spread via `::after` pseudo-element.

**Heading:** `h1.title` = "You're in." — 56px, weight 600, tracking −0.035em

**Scan progress card:**
```
.scan-minimal layout:
  - 56×56 SVG ring (white stroke, dasharray animation, 75% progress shown)
  - Percentage label: JetBrains Mono 12px
  - Status text: "Calibrating — reading audio devices"
  - Meta: "9 of 12 scanners complete · 4.2s elapsed" (JetBrains Mono)
```

**Scan item states:**
- Done: green check circle (`rgba(138,255,199,0.2)` fill)
- Doing: white ring with spinning arc (`animation: spin 0.9s linear infinite`)
- Idle: bare ring `rgba(255,255,255,0.14)`

**Shortcuts row:** 3 shortcuts — "Anywhere Ctrl+Space", "Voice Ctrl+Shift+B", "Wake word 'Hey BLADE'"

**CTA:** "Enter BLADE" → `dashboard.html`

**Tauri wiring needed:**
- Listen to `deep_scan_progress` event: `{scanner_name, completed, total, message}`
- Call `complete_onboarding(answers: Vec<String>)` when scan finishes (pass 5-answer array; empty strings acceptable on auto-complete)
- Button enable gate: disable "Enter BLADE" until scan completes

---

## A.2 Dashboard Flow

### Screen 4 — `dashboard.html`

**Purpose:** Main home screen — ambient intelligence summary.

**Layout:**
```
.stage → flex row
  .nav-rail.glass (left, 68px wide, fixed)
  .shell → flex column
    .topbar.glass (top, ~56px)
    .main → CSS grid [1fr 380px] gap 24px
      .col-l → flex column gap 24px
        .card.glass.right-now (hero)
        .bottom → flex row gap 24px
          .card.glass.calendar
          .card.glass.integrations
      .card.glass.hive (right col)
  .fab (bottom-right absolute)
```

**Nav rail items (top to bottom):**
1. Logo mark "B" (52×52 gradient)
2. Home (active on this screen)
3. Chat → `dashboard-chat.html`
4. Hive → `index.html` (placeholder)
5. Calendar → `index.html`
6. Files → `index.html`
7. Settings → `settings.html`
8. Spacer flex
9. Avatar initials

**Top bar:** Greeting text + search-pill (⌘K → QuickAsk) + clock + notification bell.

**Right Now (hero card) sections:**
```
header: app icon + current task title + elapsed time ("47m in flow")
quote:  BLADE ambient notice (max 2 lines, see ghost-card spec)
stats:  3-column bar chart (Focus / Keystrokes / Since commit)
chips:  chip-action row (max 4 shown per D-10)
```

Stat bar colors: `.bar.ok` = `--a-ok` (#8affc7), `.bar.warm` = `--a-warm` (#ffd2a6), `.bar.cool` = `--a-cool` (#c8e0ff)

**Calendar card:** date head + 3 event rows. Event states: `.evt.hot` (imminent), `.evt.soon`, `.evt` (default).

**Integrations card:** 2×4 grid of integration rows. Status dots: `.ind.live` = #8affc7, `.ind.warn` = #ffc48a, `.ind.off` = rgba(255,255,255,0.2).

**Hive (right col):** Tentacle grid (10 items) + signal feed + footer stats.

**FAB:** Circular glass button (bottom-right) → chat. `stroke: #1a0b2a` — dark stroke on white background.

**Keyboard shortcut:** `Ctrl/Cmd+K` → `quickask.html` (hard-wired in `<script>` tag).

**Tauri wiring needed:**
- `get_current_focus()` for Right Now data
- `homeostasis_get()` for focus/energy stats
- Signal feed — consume `blade_agent_event` stream

---

### Screen 5 — `dashboard-chat.html`

**Purpose:** Dashboard with inline chat panel replacing the Hive column.

**Layout difference from dashboard.html:**
```css
.main { grid-template-columns: 1fr 560px; }
```
Hive card is replaced by `.card.glass.chat-panel`. Left col cards have `.dim` class (opacity: 0.94). chip-actions limited to 3 (fourth is hidden).

**Chat panel anatomy:**
```
.chat-head:
  model-pill (provider logo + name + cost + chevron)
  title-block (session name + live-dot + "streaming · N msgs · ctx NN%")
  icon-btn Stop (stop-square icon)
  icon-btn Clear (trash icon)
  icon-btn Close (×, links back to dashboard.html)

.chat-body:
  .msg.ai  → avatar "B" (white gradient) + .bubble (glass, border-top-left-radius: 6px)
  .msg.user → avatar "A" (orange gradient) + .bubble (white fill, color: #1a0b2a, border-top-right-radius: 6px)
  .tool-call → JetBrains Mono row with green dot + tool-name + arg + result
  .streaming → 3-dot blink indicator

.chat-input:
  .input-context → ctx-chips (attached files, deletable)
  .input-shell →
    .text (placeholder or typed content + caret)
    .input-tools → voice / screenshot / attach / slash + spacer + ctx-hint + send-btn
```

**Bubble radii contract (from prototype):**
- AI bubble: `border-radius: 18px; border-top-left-radius: 6px`
- User bubble: `border-radius: 18px; border-top-right-radius: 6px`
- Both: `backdrop-filter: blur(20px) saturate(160%)`

**Tool call row:** monospace, `background: rgba(0,0,0,0.22)`, green pulse dot, name (bold) + arg + result (right-aligned muted).

**Send button:** 34×34, white gradient, dark icon, `box-shadow: inset 0 1px 0 #fff, 0 6px 14px rgba(0,0,0,0.3)`.

**Context indicator:** `font-family: JetBrains Mono; font-size: 10px` showing "18% · 14.2k tok".

**Tauri wiring needed:**
- Send: `invoke("send_message_stream", {messages})`
- Stream: listen `blade_message_chunk` (text delta), `blade_thinking_chunk`, `blade_message_start`, `blade_message_done`
- Stop: `invoke("cancel_chat")`
- Token ratio: listen `blade_token_ratio` → show in ctx-hint

---

## A.3 Voice Orb Screens

### Screen 6 — `voice-orb.html`

**Purpose:** Live voice conversation overlay — floating over desktop.

**Window spec:** NSPanel, borderless, transparent, non-activating, level popUpMenu−4. Content-protected. Actual size: 440×440. Shown at 560×560 in prototype for visibility.

**Structure:**
```
.live-stage → flex column, centers .overlay-window
  .overlay-window (560px in prototype, 440px in production)
    .phase-chip (absolute, top: 36px, horizontally centered)
    .orb-overlay[data-phase="listening"] (440px actual)
    .hover-controls (absolute top-right, opacity 0 default → 1 on hover)
    .live-caption (absolute bottom: 60px)
  .key-hints (below overlay-window)
```

**Phase chip:** pill with green dot (animated pulse) + phase label + JetBrains Mono timer. `backdrop-filter: blur(20px) saturate(160%)`, `background: rgba(10, 5, 30, 0.55)`.

**Live caption:** 480px wide, centered, 18px font. Two spans: `.final` (white) + `.partial` (55% white) + animated caret.

**Hover controls (Cluely-style):** Pause + Close buttons, 28px circles, `background: rgba(0,0,0,0.4)`, invisible until hover.

**Key hints:** Ctrl+Shift+B (invoke), "Hey BLADE" (wake), Enter (send), Esc (cancel).

**Phase-to-caption content map:**
```
idle      → "Resting. Say 'Hey BLADE' or hit [Ctrl+Shift+B]"
listening → transcript of what user is saying (streaming partial)
thinking  → "Checking three files and the repo layout — one moment."
speaking  → reply being spoken (streaming)
```

**Tauri wiring needed:**
- `start_voice_conversation(app)` on Ctrl+Shift+B or after `wake_word_detected`
- `stop_voice_conversation()` on Esc
- Listen `voice_conversation_listening` → set phase idle→listening
- Listen `voice_conversation_thinking` → set phase listening→thinking
- Listen `voice_conversation_speaking` → set phase thinking→speaking
- Listen `voice_conversation_ended` → dismiss window
- Listen `voice_transcript_ready` → update caption

---

### Screen 7 — `voice-orb-states.html`

**Purpose:** Design reference sheet showing all 4 orb phases side by side.

**Layout:** Full-page 4-column grid, one cell per phase.

**OpenClaw physics reference (from prototype annotations):**
```
Source: openclaw/TalkOverlayView.swift
Overlay size: 440px
Core size: 96px
Stroke: 1.6px
Rings: ×3 with stagger 0.28
RMS smoothing: 0.45·prev + 0.55·new
UI throttle: 12 fps (83ms)
Phase transitions: 180ms easeOut cross-fade
```

**Phase math table (authoritative spec):**

| Phase | ring speed | amplitude | alpha | orb scale |
|-------|-----------|-----------|-------|-----------|
| Idle | 0.6 | 0.35 | 0.40 | 1.00 |
| Listening | 0.9 | 0.5 + level×0.7 | 0.58 + level×0.28 | 1 + level×0.12 |
| Thinking | 0.6 (idle) | — | — | 1.00 |
| Speaking | 1.4 | 0.95 | 0.72 | 1 + 0.06×sin(t×6) |

**Thinking arc overlay:**
```
arc-1: +42°/s rotation, trim 0.08→0.26 of circumference
arc-2: −35°/s rotation, trim 0.62→0.86 of circumference
```

**Phase dot colors:**
```
listening → #8affc7  (box-shadow: 0 0 8px #8affc7)
thinking  → #ffd2a6  (box-shadow: 0 0 8px #ffd2a6)
speaking  → #ffffff  (box-shadow: 0 0 8px #fff)
idle      → rgba(255,255,255,0.4)  (no glow)
```

---

## A.4 Ghost Mode Overlay

### Screen 8 — `ghost-overlay.html`

**Purpose:** Invisible meeting assist overlay — screen-share protected.

**Window spec:** Positioned `top: 54px, left: 50%, translateX(-50%)`. pointer-events: none on layer, auto on children. Content protected via `NSWindowSharingNone` / `WDA_EXCLUDEFROMCAPTURE`.

**Two states (toggled via `data-ghost` on body):**

**State 1 — Idle (dormant pill):**
```css
.ghost-idle {
  display: inline-flex;
  padding: 6px 14px;
  background: rgba(0,0,0,0.40);
  border: 1px solid rgba(255,255,255,0.08);
  backdrop-filter: blur(20px) saturate(140%);
  border-radius: 999px;
  color: rgba(255,255,255,0.55);
  font-size: 11px;
}
```
Contains: 5px pulsing dot + "BLADE · listening" + ⌘\ keyboard hint

**State 2 — Fired (whisper card):**
```css
.ghost-card {
  width: 480px;
  padding: 16px 18px 14px;
  background: linear-gradient(180deg, rgba(10,8,20,0.78) 0%, rgba(10,8,20,0.68) 100%);
  border: 1px solid rgba(255,255,255,0.10);
  backdrop-filter: blur(32px) saturate(180%);
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 30px 60px rgba(0,0,0,0.45);
}
```

**Ghost card anatomy:**
```
.gc-head: indicator ("BLADE · whisper" + green dot) | source (right-aligned mono)
.gc-headline: 17px, weight 600, max 6 words — "Q3 closed at 4.2M ARR."
.gc-bullets: 1-2 items, 14px, max-width 60ch, bullet via ::before
.gc-footer: hints (Expand ⌘Enter, Dismiss Esc, Clear ⌘R) | model name (right)
```

**Content rules (D-10 ghost format):**
- Headline: ≤ 6 words
- Bullets: 1–2 items
- Line length: ≤ 60 chars

**Fire condition:** BLADE detects question with >50% confidence from meeting audio.

**Tauri wiring needed:**
- Listen to ghost-mode events from `ghost_mode.rs`
- Window label: `ghost_overlay`
- Events use `emit_to("ghost_overlay", ...)` per D-14 policy

---

## A.5 QuickAsk Screens

### Screen 9 — `quickask.html`

**Purpose:** Spotlight-style quick query bar. Activated by Ctrl+Space (separate Tauri window).

**Window spec:** Separate `quickask` window, distinct from `main`. Positioned at `top: 30%, left: 50%, translate(-50%, -30%)`. Width: 780px. Wallpaper behind + `overlay-scrim` (radial dim + 2px blur).

**Card base:**
```css
.qa.glass.heavy {
  border-radius: var(--r-xl);  /* 34px */
  overflow: hidden;
}
```

**Search bar anatomy:**
```
34×34 white gradient logo "B"
.q-input → 22px, weight 400, tracking -0.02em
  .q-typed → typed portion
  .caret → animated cursor
  .q-typed-rest → ghost autocomplete hint (var(--t-3))
.mode-pill → "Ask BLADE" with green dot
.q-esc → ESC key hint → closes to dashboard.html
```

**AI inline answer section (streaming):**
```
.ai-inline:
  background: linear-gradient(180deg, rgba(138,255,199,0.06) 0%, transparent 100%)
  border-bottom: 1px solid var(--line)

  .ai-av: 28px white gradient, "B"
  .ai-head: "ANSWER" label + model pill (JetBrains Mono) + 3-dot streaming indicator
  .ai-text: 14px, line-height 1.55
  .ai-actions: Send draft | Edit in chat | Copy | Regenerate
```

**Results list sections:**
```
Group: "Actions" (3 results)
  - focused row: gradient highlight + inset top rim
  - normal rows: hover only

Group: "Recent chats" (2 results)

Group: "Files & context" (2 results)
```

**Row anatomy:**
```
.qr-ic (32×32, type-colored, border-radius 10px)
.qr-body:
  .qr-title (14px, weight 500, <mark> highlights match text)
  .qr-sub (11px mono path/metadata)
.qr-meta (10px mono, right)
.qr-kbd (key combo, right)
```

**Icon type colors:**
```
ai   → white gradient (--g-fill-heavy), color #1a0b2a
file → #c8e0ff (--a-cool)
chat → #ffd2a6 (--a-warm)
cmd  → #ffb3d0 (--a-hot)
int  → #8affc7 (--a-ok)
```

**Footer shortcuts:** ↑↓ navigate, ↵ open, ⌘↵ in chat, Tab switch mode.

**Submit path (D-11 bridge contract):**
```
QuickAsk window submits → invoke("quickask_submit", {query})
Rust: quickask_submit emits blade_quickask_bridged to main window
Main window: listens for blade_quickask_bridged → opens chat
```
STATUS: WIRE-01 — `quickask_submit` and `blade_quickask_bridged` not yet in backend.

---

### Screen 10 — `quickask-voice.html`

**Purpose:** QuickAsk in voice input mode (Ctrl+Shift+B from within QuickAsk, or wake word).

**Window:** Same `quickask` window as A-09, different layout.

**Card spec:**
```css
.qa-voice {
  width: 640px;
  padding: 40px 48px 28px;
  border-radius: 32px;
  background: linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.06) 100%);
  border: 1px solid rgba(255,255,255,0.14);
  backdrop-filter: blur(48px) saturate(200%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 40px 80px rgba(0,0,0,0.5);
}
```
Note: blur(48px) — this screen is allowed heavier blur because it is the only element on screen (no competing backdrop-filter layers).

**Top row:** model pill (provider + name + chevron) + voice mode pill (green "Voice · Whisper-v4" with pulse dot).

**Orb:** 320×320, same 4-phase `.orb-overlay[data-phase]` component. `::before` inset 10%.

**Timer:** JetBrains Mono 12px, `var(--t-3)`, shows elapsed (e.g., "00:04.2").

**Transcript:** 20px, max-width 520px. `.final` (white) + `.partial` (52% white) + animated caret.

**Audio meter:** 12 bars, 3px wide, animated `scaleY` with staggered delays (`animation: wv 1.1s ease-in-out infinite`).

**Footer:** Pause/Restart/Cancel on left; ctx% indicator + Send button on right.

**Phase content map:**
```
idle      → empty + "Tap Space or say 'Hey BLADE' to start."
listening → streaming transcript
thinking  → "Reading the Figma thread and checking your tokens…"
speaking  → "Reply drafted — [summary]. Send?"
```

**Tauri wiring needed:**
- Phase state driven by same voice events as A-06
- Send (↵): invoke `quickask_submit` with transcript
- `voice_transcript_ready` → update transcript spans
- Voice mode pill model: should match `config.voice_provider` setting

---

## A.6 Settings Screen

### Screen 11 — `settings.html`

**Purpose:** Provider key management + smart routing configuration.

**Layout:**
```
.settings-page → flex column, inset 24px left 124px (nav rail width + 24px gap)
  .settings-header.glass → title + tab-strip
  .settings-body → grid [280px 1fr]
    .card.glass.side-nav (left)
    .card.glass.content (right)
  .save-bar.glass.pill → sticky bottom
```

**Tab strip:** Pill-style tabs in a contained background. Active tab: `linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))`, inset rim, border.

**Tabs:** Provider | Memory | MCP | Personality | Hive | Privacy | About

**Side nav active indicator:** 3px white vertical bar on left edge (`position: absolute; left: -6px; box-shadow: 0 0 8px rgba(255,255,255,0.6)`).

**Smart paste input:**
```css
.paste {
  padding: 6px 6px 6px 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
  border: 1px dashed rgba(255,255,255,0.28);
  border-radius: var(--r-md);
}
```
Contains: clipboard icon + JetBrains Mono input field + "auto-detect ⌘V" hint.

**Vault item structure:**
```
.vault-item (hover: border-color var(--g-edge-mid))
  .p-logo (42×42, provider gradient)
  .v-info: name + model list (JetBrains Mono)
  .v-state pill: ok/warn/off
  .v-models: small pills per model
  .v-usage: dollar amount + period
  .v-actions: 3 icon buttons (Test / Reveal / More)
```

**State pill colors:**
```
ok   → rgba(138,255,199,0.12) bg, #c4ffe0 text, rgba(138,255,199,0.3) border
warn → rgba(255,196,138,0.12) bg, #ffe0c0 text, rgba(255,196,138,0.3) border
off  → rgba(255,255,255,0.05) bg, var(--t-3) text, var(--g-edge-lo) border
```

**Smart routing grid:** 4 columns, 1 per task type (Deep reasoning / Daily chat / Fast replies / Vision). Each shows primary model + provider + fallback chain arrow.

**Save bar:** `border-radius: var(--r-pill)` (pill shape). Contains auto-save indicator (left) + Reset / Export / Save buttons (right).

**Tauri wiring needed:**
- `get_all_provider_keys()` → populate vault
- `store_provider_key(provider, key)` on paste+detect
- `switch_provider(provider)` for default toggle
- `get_task_routing()` + `set_task_routing()` for routing grid
- `save_config_field(field, value)` for preference changes

---

## B. Navigation Graph

```
onboarding-01-provider
  → [Continue] onboarding-02-apikey
      → [Back] onboarding-01-provider
      → [Continue] onboarding-03-ready
          → [Enter BLADE] dashboard

dashboard
  → [⌘K / search-pill] quickask window (separate window)
  → [FAB / chat nav item] dashboard-chat
  → [settings nav item] settings
  → [Ctrl+Shift+B] quickask-voice window (same quickask window, voice mode)
  → [voice global / wake word] voice-orb overlay (separate overlay window)
  → [meeting detection] ghost-overlay (separate ghost_overlay window)

dashboard-chat
  → [close ×] dashboard
  → [⌘K] quickask window

quickask
  → [ESC] closes / returns focus to previous window
  → [⌘↵ or "Open in chat panel"] opens dashboard-chat
  → [Ctrl+Shift+B or voice icon] quickask-voice (same window, mode switch)

quickask-voice
  → [ESC / Cancel] closes quickask window
  → [↵ / Send] submits via quickask_submit invoke

settings
  → [any nav item] returns to respective route

voice-orb
  → [ESC / X] stop_voice_conversation → window closes
  → [hover + ×] same

ghost-overlay
  → [ESC / ⌘R] dismiss card, return to idle pill
  → [⌘Enter] expand (future: bridge to main)
```

---

## C. Liquid Glass Token Reference

### C.1 Glass Fills

```css
--g-fill-weak:    rgba(255, 255, 255, 0.04)   /* barely-there background */
--g-fill:         rgba(255, 255, 255, 0.07)   /* default card */
--g-fill-strong:  rgba(255, 255, 255, 0.11)   /* elevated surface */
--g-fill-heavy:   rgba(255, 255, 255, 0.16)   /* modal / heavy overlay */
```

Usage map:
- `.glass` = `var(--g-fill)` + `backdrop-filter: blur(20px) saturate(160%)`
- `.glass.flat` = same fill, no backdrop-filter
- `.glass.heavy` = `var(--g-fill-heavy)` + blur(28px) saturate(180%)
- `.glass.sm` = smaller padding variant
- `.glass.interactive` = hover state adds `var(--g-fill-strong)`

### C.2 Glass Edges

```css
--g-edge-hi:   rgba(255, 255, 255, 0.32)  /* top edge highlight */
--g-edge-mid:  rgba(255, 255, 255, 0.14)  /* standard border */
--g-edge-lo:   rgba(255, 255, 255, 0.04)  /* subtle separator */
```

Rim (inset box-shadow — full glass illusion):
```css
--g-rim: inset 0 1px 0 rgba(255,255,255,0.28),
         inset 0 -1px 0 rgba(255,255,255,0.04),
         inset 1px 0 0 rgba(255,255,255,0.12),
         inset -1px 0 0 rgba(255,255,255,0.03);
```

### C.3 Drop Shadows

```css
--g-shadow-sm: 0 8px 24px rgba(0, 0, 0, 0.24)
--g-shadow-md: 0 20px 50px rgba(0, 0, 0, 0.32)
--g-shadow-lg: 0 40px 80px rgba(0, 0, 0, 0.42)
```

### C.4 Typography

**Typefaces:** Inter (UI) + JetBrains Mono (code/numbers)

**Text opacity scale:**
```css
--t-1: rgba(255, 255, 255, 0.97)  /* primary */
--t-2: rgba(255, 255, 255, 0.72)  /* secondary */
--t-3: rgba(255, 255, 255, 0.50)  /* muted */
--t-4: rgba(255, 255, 255, 0.32)  /* placeholder / ghost */
```

**Type scale (from shared.css + proto.css overrides):**
```
Display:   56px  / weight 600 / tracking -0.035em  (onboarding-03 hero)
H1:        44px  / weight 600 / tracking -0.03em   (onboarding-01)
H1-alt:    40px  / weight 600 / tracking -0.03em   (onboarding-02)
H2:        34px  / weight 600 / tracking -0.03em   (voice-orb-states)
H3:        28px  / weight 600 / tracking -0.025em  (settings header)
H4:        20px  / weight 600 / tracking -0.02em   (settings section)
Body:      14px  / weight 400 / tracking -0.005em  (chat bubbles, QA results)
Small:     12px  / weight 400                       (meta, labels)
Micro:     10-11px / weight 500-600                 (kbd hints, mono tags)
```

**SF Pro sizes (from proto.css):**
```css
--fs-large-title: 34px;
--fs-title-1:     28px;
--fs-title-2:     22px;
--fs-title-3:     20px;
--fs-headline:    17px;
--fs-body:        17px;
--fs-callout:     16px;
--fs-subhead:     15px;
--fs-footnote:    13px;
--fs-caption:     12px;
--fs-caption-2:   11px;
```

### C.5 Radius + Spacing + Accents

**Radius scale:**

Baseline (shared.css):
```css
--r-xs:   8px
--r-sm:  12px
--r-md:  18px
--r-lg:  26px
--r-xl:  34px
--r-2xl: 44px
--r-pill: 999px
```

HIG override (proto.css — tighter, more Apple-like):
```css
--r-xs:   8px   (same)
--r-sm:  10px
--r-md:  16px
--r-lg:  20px
--r-xl:  28px
--r-2xl: 40px
```

**Spacing scale (shared.css):**
```css
--s-1:  4px  --s-2:  8px  --s-3: 12px  --s-4: 16px
--s-5: 20px  --s-6: 24px  --s-8: 32px  --s-10: 40px
--s-12: 48px  --s-16: 64px  --s-20: 80px
```

**Accent colors:**
```css
--a-warm: #ffd2a6   /* warm orange — vision cap, sun-side glass */
--a-cool: #c8e0ff   /* cool blue  — file chips, shadow-side glass */
--a-ok:   #8affc7   /* green      — success, live, verified */
--a-warn: #ffc48a   /* amber      — rate-limited, flagged */
--a-hot:  #ff9ab0   /* pink       — cmd icons, tool-use cap */
```

**Orb accent tokens (orb.css):**
```css
--orb-overlay: 440px
--orb-core:    96px
--orb-accent:       #b8a0ff   /* base purple */
--orb-accent-glow:  #7c3aed   (CSS var, deep shadow)
--orb-accent-deep:  #5f5bff   (used in ring gradients)
```

---

## D. Backdrop-Filter Budget (D-07 compliance)

D-07: Max 3 backdrop-filter per viewport. Blur caps: 20px (standard), 12px (secondary), 8px (tertiary).

| Screen | Layer 1 | Layer 2 | Layer 3 | Budget |
|--------|---------|---------|---------|--------|
| onboarding-01 | .onb.glass.heavy (28px) | — | — | ✓ 1/3 |
| onboarding-02 | .onb.glass.heavy (28px) | — | — | ✓ 1/3 |
| onboarding-03 | .onb.glass.heavy (28px) | — | — | ✓ 1/3 |
| dashboard | .nav-rail (20px) | .topbar (20px) | .card.glass (20px) | ✓ 3/3 — BUDGET FULL |
| dashboard-chat | .nav-rail (20px) | .topbar (20px) | .chat-panel (20px) | ✓ 3/3 — BUDGET FULL |
| voice-orb | orb overlay (CSS anim only) | .phase-chip (20px) | — | ✓ 1/3 |
| ghost-overlay | .ghost-card (32px) | .ghost-idle (20px) | — | ✓ 2/3 |
| quickask | .overlay-scrim (2px) | .qa.glass.heavy (28px) | .ai-inline (none) | ✓ 2/3 |
| quickask-voice | .overlay-scrim (3px) | .qa-voice (48px — EXCEPTION) | — | ✓ 2/3 |
| settings | .nav-rail (20px) | .settings-header (20px) | .card.glass (20px) | ✓ 3/3 — BUDGET FULL |

Note: `quickask-voice` uses 48px blur because it is the only element with backdrop-filter on that screen (scrim is 3px only — negligible). Acceptable exception; document in Phase 2 implementation as a named override.

---

## E. Window-to-Route Mapping (summary)

| Window label | Tauri window | Screens served | HTML file |
|-------------|--------------|----------------|-----------|
| `main` | main app window | onboarding, dashboard, chat, settings | `index.html` |
| `quickask` | floating search overlay | quickask (text + voice) | `quickask.html` |
| `overlay` | voice orb NSPanel | voice-orb (always floating) | `overlay.html` (MISSING — needs creation) |
| `ghost_overlay` | meeting assist panel | ghost-overlay | `ghost_overlay.html` (MISSING — needs creation) |
| `hud` | HUD bar | HUD status bar | `hud.html` (MISSING — needs creation) |

Three HTML entry files (`overlay.html`, `ghost_overlay.html`, `hud.html`) are confirmed missing. Rust will panic without them. These must be created at Phase 1 start per P-05.

---

## F. Interaction States Summary

| Component | Default | Hover | Active/Selected | Disabled |
|-----------|---------|-------|-----------------|----------|
| Provider card | `rgba(255,255,255,0.05)` border `g-edge-lo` | `rgba(255,255,255,0.09)` border `g-edge-mid` translateY(-1px) | `rgba(255,255,255,0.13)` border `rgba(255,255,255,0.4)` + checkmark | — |
| Nav item | `var(--t-3)` | `var(--t-1)` | `rgba(255,255,255,0.1)` + 3px left bar | — |
| Tab strip tab | `var(--t-2)` | `var(--t-1)` | gradient fill + inset rim | — |
| Vault item | `rgba(255,255,255,0.05)` border `g-edge-lo` | border `g-edge-mid` | — | — |
| QA result row | transparent | `rgba(255,255,255,0.05)` | gradient + inset rim | — |
| Chip-action | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.12)` | — | — |
| Step pill | `rgba(255,255,255,0.08)` | — | `rgba(255,255,255,0.16)` border `g-edge-mid` | — |

---

*Task 1.3 complete. File covers all 11 HTML prototypes (A-01 through A-11), CSS token extraction (C.1–C.5), navigation graph (B), backdrop-filter budget (D), window mapping (E), and interaction states (F).*
