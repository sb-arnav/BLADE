---
phase: 11
slug: smart-provider-setup
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-20
source_decisions: D-51..D-58 (locked in 11-CONTEXT.md)
consumed_by: [gsd-ui-checker, gsd-planner, gsd-executor, gsd-ui-auditor]
---

# Phase 11 — Smart Provider Setup — UI Design Contract

> Visual and interaction contract for Phase 11. Formalises locked decisions
> D-51..D-58 from `11-CONTEXT.md` into design-system-level detail (tokens,
> spacing, typography, motion, accessibility) that planners and executors
> consume verbatim.
>
> **No new tokens are introduced.** Every rule below resolves to an existing
> var(--*) from `src/styles/tokens.css`, an existing primitive from
> `src/design-system/primitives/`, or a documented composition of the two.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (self-built primitives — D-01 locked in v1.0) |
| Preset | not applicable |
| Component library | none (no shadcn / no Radix — enforced by `verify:no-raw-tauri` sibling gate) |
| Primitives available | Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, EmptyState, ListSkeleton, ComingSoonSkeleton, ErrorBoundary (12 total) |
| Icon strategy | Inline SVG via `navrail-icons.tsx` pattern (20px stroke, `currentColor`). No icon library dependency. |
| Font families | Syne (display), Bricolage Grotesque (body), Fraunces (serif), JetBrains Mono (mono) — self-hosted WOFF2 per D-24 |
| Glass tiers | `glass-1` (20px blur — surface), `glass-2` (12px — overlay), `glass-3` (8px — badge/chip). Blur caps structural, never prop-overridable. |
| Max backdrop-filter layers per viewport | 3 (D-07). Phase 11's new surfaces (CapabilityGap card + paste-form panel + provider row pills) must budget within this. |

---

## Screens & Flows

Phase 11 introduces or modifies **four UI surfaces**. Every other surface stays untouched.

### Surface A — Onboarding "Paste any config" card (D-56)

**Route:** `onboarding` step 1 (`ProviderPicker.tsx`)
**Change:** ADD a single full-width card beneath the existing 6-card grid. Do NOT remove the 6 cards. Do NOT change their layout.

**Layout contract (ASCII — executor consumes verbatim):**

```
┌──────────────────────────────────────────────────────────────┐
│ Pick a provider.                                             │
│ Choose who powers BLADE's chat. You can switch anytime from  │
│ Settings.                                                    │
│                                                              │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│ │ Anthropic   │ │ OpenAI      │ │ OpenRouter  │             │
│ └─────────────┘ └─────────────┘ └─────────────┘             │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│ │ Gemini      │ │ Groq        │ │ Ollama      │             │
│ └─────────────┘ └─────────────┘ └─────────────┘             │
│                                                              │
│         ─────────────── or ───────────────                   │  ← divider
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ◈  Paste any config                                      │ │  ← paste card
│ │    cURL, JSON config, or Python SDK snippet. We'll       │ │
│ │    detect the provider and probe for capabilities.       │ │
│ │                                                          │ │
│ │    ┌──────────────────────────────────────────────────┐  │ │
│ │    │ curl https://api.openai.com/v1/chat/...          │  │ │  ← textarea (mono)
│ │    │                                                  │  │ │
│ │    │                                                  │  │ │
│ │    └──────────────────────────────────────────────────┘  │ │
│ │                                                          │ │
│ │    [ Detect & probe ]   (secondary link: Paste examples) │ │
│ │                                                          │ │
│ │    [ probe status / error / capability pills render here ]│ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                                         [ Continue → ]       │
└──────────────────────────────────────────────────────────────┘
```

**Divider:** horizontal rule styled as `1px solid var(--line)` flanked by centered `.t-small` label "or". Sits at spacing `--s-8` (32px) above and below the paste card. See Surface B for identical component.

**Paste card container:**
- Component: `<Card tier={1} padding="lg" />`  → `glass-1` + 32px internal padding
- Width: full grid width (`grid-column: 1 / -1` inside `.providers`)
- Margin-top: `--s-6` (24px) relative to the divider line
- Icon: `◈` diamond glyph rendered as inline SVG sized 24×24, color `var(--t-1)`

**Textarea:**
- Rendered as `<textarea class="input mono" />` (reuses `.input` + `.mono` classes in `primitives.css`)
- `rows={6}` initial, `resize: vertical` capped `min-height: 120px` / `max-height: 320px`
- Font family: `var(--font-mono)` (JetBrains Mono) — cURL/JSON/Python readability
- Font size: 13px / line-height 1.5
- Placeholder: `'Paste a cURL, JSON config, or Python SDK snippet…'` at `var(--t-3)` (50% white)
- `spellCheck={false}`, `autoCorrect="off"`, `autoCapitalize="off"`, `data-1p-ignore="true"` (password managers ignore)

**"Detect & probe" button:**
- `<Button variant="primary" size="md" />` — pill shape, primary deep-purple-on-white fill
- Copy: `Detect & probe` (locked — see Copywriting contract)
- Disabled when: textarea empty OR probe in flight
- Loading state: replace label with `<GlassSpinner size={16} />` + `Probing…` text
- Success ⇒ capability pill strip renders inline below the button (no navigation)
- Failure ⇒ inline error panel renders below the button (see Error states)

**Secondary link:** right-aligned next to the Detect button, `.t-small` sized, `var(--t-2)` color. Copy: `See examples`. Opens a disclosure expanding three sample snippets (cURL / JSON / Python) the user can click to copy.

**Advance path:** after a successful probe, the paste card's "Detect & probe" button becomes `Continue with this provider →` (locked copy). Clicking transitions the onboarding state machine exactly as the 6-card flow does — `setProvider(detectedId, detectedModel) → setStep('apikey')` — but pre-populates the apikey step with the pasted key.

### Surface B — Settings → Providers pane (D-56 + D-57)

**Route:** `settings-providers` (existing — `ProvidersPane.tsx`)
**Changes:** two in-place extensions — (1) paste card at the top, (2) fallback-order drag list below the provider grid. The 6 existing provider cards remain unchanged structurally but each row gains a **capability pill strip** and a **Re-probe** icon button (D-52).

**Pane layout (top to bottom):**

```
┌──────────────────────────────────────────────────────────────┐
│ Providers                                                    │  ← h2 (t-h2)
│ Configure your API keys. Keys are stored in your OS          │  ← .t-body, t-2
│ keyring — BLADE only sees them at invoke time.               │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ◈  Paste any config  (same card as Surface A)            │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │ Anthropic       │ │ OpenAI          │ │ OpenRouter      │ │
│ │ Key stored ●●●● │ │ No key          │ │ Key stored ●●●● │ │
│ │ [✓ vision]      │ │                 │ │ [✓ vision]      │ │  ← capability strip
│ │ [✗ audio]       │ │                 │ │ [✓ audio]       │ │
│ │ [✓ tools]       │ │                 │ │ [✓ tools]       │ │
│ │ [✓ 200k ctx]    │ │                 │ │ [✓ 128k ctx]    │ │
│ │ [ key input ]   │ │ [ key input ]   │ │ [ key input ]   │ │
│ │ [Test] [Save]   │ │ [Test] [Save]   │ │ [Test] [Save]   │ │
│ │ [↻ Re-probe]    │ │                 │ │ [↻ Re-probe]    │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │ Gemini / Groq / Ollama … (same row shape)                │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│                                                              │
│ ───────────── Fallback order ─────────────                   │  ← section divider
│ If the primary provider errors, BLADE retries through this   │  ← .t-small, t-2
│ chain. Drag to reorder. Capability-gated tasks only retry    │
│ through providers with that capability.                      │
│                                                              │
│ [≡] Anthropic • claude-sonnet-4                              │  ← drag row
│ [≡] OpenRouter • gpt-4o                                      │
│ [≡] Groq • llama-3.3-70b                                     │
│                                                              │
│ ☐ Use all providers with keys      (toggle auto-populates)   │
└──────────────────────────────────────────────────────────────┘
```

**Capability pill strip (per-row, D-52):**
- Lives inside the existing `<Card>` for each provider, between the "Key stored" Pill and the key input
- Rendered as 4 inline `<Pill>` primitives separated by `var(--s-1)` (4px) gaps
- Horizontal wrap allowed if row narrows below 240px
- Pill composition (locked order):
  - `[✓ vision]` or `[✗ vision]`
  - `[✓ audio]`  or `[✗ audio]`
  - `[✓ tools]`  or `[✗ tools]`
  - `[✓ {N}k ctx]` where N = `context_window / 1000` rounded, e.g. `128k`, `200k`, `1m`
- Empty state (no probe yet): render 4 neutral pills `[— vision] [— audio] [— tools] [— ctx ?]` in `var(--t-3)` — communicates "not probed".
- When no key is stored: hide the strip entirely (can't probe without a key).

**Re-probe icon button (D-52):**
- `<Button variant="icon" size="sm" />` rendered inline-end of the capability strip
- Icon: 16px circular arrow (`↻`) — inline SVG, `currentColor`
- `aria-label="Re-probe {provider-name} capabilities"`
- Disabled while a probe is in flight for that row; shows `<GlassSpinner size={12} />` inside the icon slot
- Successful re-probe ⇒ capability strip updates without full row re-render (React state diff)

**Fallback order section (D-57):**
- Section heading: `<h3 class="t-h3">` with copy `Fallback order`
- Divider above: `1px solid var(--line)` spanning full pane width at `--s-8` top margin
- Helper text: `.t-small` at `var(--t-2)`; copy locked — see Copywriting contract
- Drag list container: `<GlassPanel tier={2} />` with 12px internal padding, 8px gap between rows
- Drag row: `<Card tier={2} padding="sm">` containing:
  - Drag handle `≡` icon (16px, `cursor: grab` → `grabbing` while dragging, `var(--t-3)` idle / `var(--t-1)` hover)
  - Provider name + model in `.t-small` — e.g. `Anthropic • claude-sonnet-4` (middot separator = `•` U+2022 at `var(--t-3)`)
  - Remove `×` button on hover, right-aligned, `<Button variant="icon" size="sm">`
- Drag behavior: native HTML5 drag-and-drop (`draggable={true}` + `onDragOver` / `onDrop` handlers); no library dependency (matches D-01)
- While dragging: source row opacity `0.4`, drop-target row shows a 2px top border `var(--a-cool)` as the insertion indicator
- Reduced-motion: disable any translate/scale on drop; row snaps to its new index instantly
- "Use all providers with keys" toggle: standard checkbox at the bottom of the section. When on, auto-populates the list from keys-present providers alphabetically; disabling does NOT clear the list (user's manual order persists).

### Surface C — `<CapabilityGap />` empty-state component (D-54)

**Usage:** rendered by consumer surfaces when `useCapability(cap).hasCapability === false`. Replaces what would otherwise be a blank dashboard card or a broken-looking view.

**Component spec:**

```
┌──────────────────────────────────────────────┐
│                                              │
│                  ┌──────┐                    │
│                  │  📷  │         ← 48×48 icon (--s-12)
│                  └──────┘                    │
│                                              │
│       Needs a vision-capable model           │  ← headline (t-h3)
│                                              │
│   This view analyzes what's on screen.       │  ← body (t-body, t-2)
│   Add a provider like Anthropic, OpenAI,     │
│   or Gemini that can read images.            │
│                                              │
│       [ Add a provider ]                     │  ← primary CTA
│       Learn which models support vision ↗    │  ← secondary link
│                                              │
└──────────────────────────────────────────────┘
```

- Container: `<EmptyState />` primitive (already ships `role="status"`, GlassPanel tier 1, centered layout, max-width 420px, padding `--s-8`). Phase 11 uses it as-is with an `icon` prop, `label` (headline), `description` (body), `actionLabel`, `onAction`. Secondary link renders below the action as a plain anchor.
- **Icon per capability (48px inline SVG, color `var(--t-1)`):**
  - `vision` → camera (viewfinder square)
  - `audio` → microphone
  - `long_context` → clock with elongated minute hand (or scroll glyph)
  - `tools` → wrench
- **CTA click:** navigates to `settings-providers?needs={capability}` via `openRoute('settings-providers', { needs: capability })`. The Settings pane reads the query parameter and scrolls the paste card into view with `scrollIntoView({ behavior: reduced-motion ? 'auto' : 'smooth', block: 'center' })`, then focuses the paste textarea. See Accessibility § for focus-management detail.
- **Secondary link:** external anchor (rel="noreferrer"), arrow glyph `↗` (U+2197). Opens in OS default browser via `openUrl()` (matches existing `Get an API key →` pattern in ProvidersPane).
- **Consumer registry:** `CAPABILITY_SURFACES.ts` (D-54 — 9 entries across 4 capabilities). When rendering `<CapabilityGap />`, consumers may pass an optional `surfaceLabel` prop (e.g. "Screen Timeline") which appears as a `.t-small` eyebrow above the headline — aids users returning from Settings to orient.

### Surface D — Paste-form probe result display (D-51 + D-52)

Shared between Surface A and Surface B paste cards. Renders **below** the "Detect & probe" button, same card container.

**State machine (4 states):**

| State | Trigger | Visual |
|-------|---------|--------|
| `idle` | Component mount, textarea empty or pre-probe | Empty area — no rendering below the button |
| `parsing` | Click Detect & probe | `<GlassSpinner size={16} />` + `.t-small` "Detecting provider…" — 200ms minimum even if parse is instant (debounce feel) |
| `parse-error` | `parse_provider_paste` returns `Err` | `.onb-error` panel — see Error states |
| `probing` | Parse succeeded, probe in flight | Provider badge + `<GlassSpinner size={16} />` + `.t-small` "Probing {provider} capabilities…" |
| `probe-success` | Probe returned capability record | Provider badge + capability pill strip + `Continue with this provider →` advance button |
| `probe-error` | Probe returned `Err` (401 / 404 / etc.) | `.onb-error` with specific error copy — see Error states table |

**Provider badge (parsed-config summary):**
- Rendered as a stacked block inside a `glass-2` container:
  - Line 1: `<Pill tone="pro" dot>{provider-name}</Pill>` + model name in `.t-mono`
  - Line 2: `base_url` in `.t-mono` `.t-3` at 12px (truncated with ellipsis if >60 chars, full URL in `title` attribute)
  - Line 3: "Key detected: ••••••••{last4}" in `.t-small .t-2`
- Margin-top: `--s-3` (12px) below the button row

---

## Spacing Scale

BLADE's existing 4-point scale from `tokens.css` applies. Phase 11 uses these seven tokens — **no new spacing** introduced.

| Token | Value | Phase 11 usage |
|-------|-------|----------------|
| `--s-1` | 4px  | Capability-pill gap inside strip |
| `--s-2` | 8px  | Pill internal gap (icon-to-text inside a chip) |
| `--s-3` | 12px | Card-internal vertical rhythm; paste-card textarea-to-button gap |
| `--s-4` | 16px | Default element spacing; capability-strip margin-top |
| `--s-5` | 20px | EmptyState icon-to-label (existing primitive value) |
| `--s-6` | 24px | Section padding inside paste card; paste card margin-top from divider |
| `--s-8` | 32px | Fallback-order section margin-top; EmptyState outer padding |

**Exceptions (locked):**
- Onboarding paste card margin-top from the "or" divider: `--s-6` (24px) — tighter than the 6-card grid margin-top (34px) to communicate "alternative, not third step".
- Capability pill strip on narrow viewports (<240px): falls back to 2-column flex-wrap at 2px row gap (half of `--s-1`) — this is the ONLY sub-4px value in the spec and is justified by WCAG 1.4.10 reflow compliance.

---

## Typography

Phase 11 uses existing utility classes from `src/styles/typography.css` verbatim. **No new type scale rules.**

| Role | Class | Size | Weight | Line Height | Phase 11 usage |
|------|-------|------|--------|-------------|----------------|
| Display | `.t-h1` | 44px | 700 | 1.1 | Onboarding "Pick a provider." (unchanged) |
| Section heading | `.t-h2` | 28px | 700 | 1.15 | Settings pane "Providers" heading (unchanged) |
| Sub-heading | `.t-h3` | 18px | 600 | 1.3 | CapabilityGap headline, Fallback-order heading, paste card heading |
| Body | `.t-body` | 15px | 400 | 1.55 | CapabilityGap description, paste card description, helper text above a major control |
| Small | `.t-small` | 13px | 400 | 1.5 | Helper text under inputs, pill labels, inline status, fallback-order helper |
| Mono | `.t-mono` | 13px | 400 | default | Paste textarea content, base_url / model-name rendering, masked key display |

**Capability pill internal typography:**
- `.chip` class in `primitives.css` sets `font-size: 12px; font-weight: 500; color: var(--t-2)` — used as-is
- Capability pills override tone per state (see Color §) but never override size or weight

**Paste-card textarea typography:**
- `.input.mono` composition: `var(--font-mono)`, `14px`, `letter-spacing: 0` — matches existing `Input mono={true}` behaviour
- Phase 11 slightly shrinks to `13px` for multi-line readability inside a 6-row textarea (see exception in `onboarding.css` — this matches the existing `.t-mono` utility; NOT a new size)

---

## Color

60/30/10 mapped against BLADE's Liquid Glass palette (D-22). **No new colors.**

| Role | Value | Phase 11 usage |
|------|-------|----------------|
| Dominant (60%) — surface | Transparent wallpaper behind `glass-1` (20px blur) | Onboarding panel, Settings pane scroll container, CapabilityGap backdrop |
| Secondary (30%) — fills | `var(--g-fill)` (4% white) / `var(--g-fill-strong)` (11% white) | Provider cards, paste card, fallback-order rows |
| Accent (10%) — purposeful only | `var(--a-cool)` (light blue #c8e0ff) for primary CTAs + focus rings; `var(--a-ok)` (mint #8affc7) for capability ✓ state | See list below |
| Destructive | `rgba(248, 113, 113, 0.3)` border + `rgba(254, 202, 202, 0.98)` text (existing `.onb-error`) | Paste parse errors, probe 401/404 errors |

**Accent reserved for (locked list — executor does not extend):**
- Primary CTA button fill (`.btn.primary` — inherited, unchanged)
- Focus-visible outline: `outline: 2px solid var(--a-cool); outline-offset: 2px;` (inherited from `.btn:focus-visible`; Phase 11 applies this to textarea + drag handles + re-probe button)
- Capability ✓ pill text color: `var(--a-ok)`
- Capability context-window pill (≥100k): `var(--a-cool)` text (long-context signal)
- Drop-target insertion indicator while dragging: `var(--a-cool)` top border 2px
- "Active" provider Pill (existing `tone="pro"` pattern, unchanged)

**Capability pill tone rules (locked):**

| Pill content | Text color | Border color | Background |
|--------------|-----------|--------------|------------|
| `[✓ vision]` | `var(--a-ok)` | `rgba(138,255,199,0.3)` | `var(--g-fill)` |
| `[✗ vision]` | `var(--t-3)` (50% white) | `var(--g-edge-lo)` (4% white) | `var(--g-fill-weak)` |
| `[— vision]` (not probed) | `var(--t-3)` | `var(--g-edge-lo)` | `var(--g-fill-weak)` |
| `[✓ 128k ctx]` (standard) | `var(--a-ok)` | `rgba(138,255,199,0.3)` | `var(--g-fill)` |
| `[✓ 200k ctx]` / `[✓ 1m ctx]` (long-context) | `var(--a-cool)` | `rgba(200,224,255,0.3)` | `var(--g-fill)` |
| Pending (re-probe in flight) | `var(--t-2)` | `var(--g-edge-mid)` | `var(--g-fill)` with inline GlassSpinner |

**Destructive confirmation colors:** N/A for Phase 11. There is ONE destructive action — "Remove from fallback chain" — which does NOT require a Dialog confirm (it's reversible by re-adding). Removal row shows a 200ms strikethrough flash then collapses. Full destructive pattern (Dialog + red button) deferred to phases that need it.

**Contrast compliance:**
- WCAG AA floor is WHITE-on-GLASS ≥ 4.5:1. Existing `audit-contrast.mjs` gate (Phase 9 Plan 09) verifies this against 5 representative wallpapers with `--t-3 = rgba(255,255,255,0.50)` as the floor. Phase 11 inherits the gate — NO new color value below opacity 0.50 is introduced.
- Capability ✓ pill on `var(--g-fill)` (4% white): `#8affc7` at 100% opacity passes AA against bright wallpapers because the pill border reinforces the boundary. Verified in Phase 9 for the existing `.chip.free` rule (same color).

---

## Motion

Phase 11 uses existing motion tokens from `src/styles/motion.css` verbatim. **No new keyframes; one reuse of the existing `list-entrance` animation.**

| Interaction | Token | Curve | Duration | Notes |
|-------------|-------|-------|----------|-------|
| Paste card entrance on mount | `list-entrance` class | `--ease-spring` | `--dur-enter` (280ms) | Reuses `motion-entrance.css`; translateY 4px → 0 |
| Capability pill appearance after probe | `list-entrance` per pill, staggered 40ms | `--ease-spring` | 280ms | 4 pills × 40ms = 160ms total stagger — within D-07 perception budget |
| Button hover lift | existing `.btn:hover` | `--ease-smooth` | `--dur-base` (200ms) | translateY(-1px) + shadow boost — unchanged |
| Textarea focus | `.input:focus` border-color | `--ease-smooth` | `--dur-fast` (150ms) | `border-color: var(--g-edge-hi)` — unchanged |
| Drag row pickup | Custom | `--ease-out` | `--dur-fast` | Opacity 1 → 0.4 + scale 1.00 → 0.98; drop returns to 1.00 over 200ms |
| Probe pending → success pill transition | Cross-fade via opacity + key change | `--ease-smooth` | `--dur-base` (200ms) | No scale/translate — trust signal demands calm |
| Error panel appearance | `list-entrance` | `--ease-spring` | `--dur-enter` | Same curve as Phase 9 `.onb-error` convention |

**No custom shake / flash / bounce.** The `4ab464c` tester-pass posture mandates calm error surfaces — a single still panel, no attention-grabbing motion. This diverges from common design-system defaults deliberately.

**prefers-reduced-motion:** already handled globally in `motion.css` — every duration token collapses to `0.01ms` under the media query. Phase 11 surfaces inherit this automatically. Drag-row pickup has an explicit override to `opacity: 0.4; scale: 1;` (no scale animation) under reduced-motion.

---

## Accessibility

Phase 11 ships four new or modified surfaces; each must pass the inherited a11y invariants plus the explicit rules below.

### Keyboard flow (locked sequence)

**Surface A — Onboarding paste card:**
1. User tabs past the 6-provider radiogroup.
2. Next tab stop: paste textarea (`aria-label="Provider config paste input"`).
3. Next: "Detect & probe" button.
4. Next: "See examples" disclosure link.
5. On probe success: focus programmatically advances to the "Continue with this provider →" button (the same button that was "Detect & probe" before — now relabeled).
6. Escape inside textarea: does NOT clear the textarea (prevents data loss). Escape outside the textarea on the card: returns focus to the 6-provider grid.

**Surface B — Settings Providers pane:**
1. Tab order: paste card textarea → paste card button → 6 provider cards in DOM order → fallback-order drag list → "Use all providers with keys" toggle.
2. Inside each provider card: key input → Test button → Save button → Re-probe icon button (when key stored).
3. Fallback-order drag list: each row is focusable with `role="listitem"` inside a `role="list"` container. Keyboard-drag via Space/Enter to pickup, Arrow Up/Down to move, Space/Enter to drop. `aria-grabbed` state toggles accordingly. Visual drop indicator mirrors mouse-drag behavior.

**Surface C — CapabilityGap:**
1. When the component mounts (capability missing on a route the user navigated to), focus moves to the "Add a provider" CTA on first render ONLY if the user arrived via keyboard navigation (detected via `document.activeElement` at mount being a `<a>` or `<button>`). Otherwise the component renders without stealing focus.
2. "Add a provider" click: route transitions to `settings-providers?needs={cap}`. On the settings pane, focus moves to the paste textarea after `scrollIntoView` completes (use `requestAnimationFrame` chained 2× to ensure layout settles). Announce via `aria-live="polite"` region (new — see ARIA section): `"Paste your provider config to add {capability} support."`
3. Secondary link: native `<a target="_blank" rel="noreferrer">` with `openUrl` preventing new tabs in Tauri. Focus returns to the CTA button after external-browser open (native OS focus behavior).

### ARIA semantics

| Element | Role / ARIA |
|---------|-------------|
| Paste textarea | `<textarea aria-label="Provider config paste input" aria-describedby="paste-helper-text">` |
| Detect & probe button | No role override; native button. `aria-busy="true"` during probe. |
| Provider badge (post-parse) | `<div role="status" aria-label="Detected provider: {name} {model}">` |
| Capability pill strip | `<ul role="list" aria-label="{provider} capabilities">` with each pill as `<li><span class="chip">`. Pills themselves are NOT focusable. |
| Re-probe icon button | `aria-label="Re-probe {provider-name} capabilities"` (no visible text) |
| CapabilityGap container | `role="status"` (inherited from `<EmptyState />`) |
| Fallback-order drag list | `role="list"` with `aria-label="Provider fallback order, drag to reorder"` |
| Drag row | `role="listitem"` + `aria-grabbed={isDragging}` + `tabIndex={0}` |
| Live region for probe status | `<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">` — global one mounted inside the pane; content updates to "Probing…", "Probe succeeded — {cap}", "Probe failed — {error}" |

### Focus ring

Inherited from `.btn:focus-visible`: `outline: 2px solid var(--a-cool); outline-offset: 2px;`. Phase 11 extends to:
- `.input:focus-visible` (textarea focus) — adds matching 2px `var(--a-cool)` outline via `:focus-visible` pseudo-class (avoids replacing the existing `.input:focus` border-color-only transition, which is design-primary)
- Drag handle `:focus-visible` — 2px `var(--a-cool)` outline with 4px offset (handle is small, needs more breathing room)
- `<EmptyState />` CTA: already inherits from `.btn:focus-visible`

### Screen-reader announcements (new)

A single polite live region mounted inside `ProvidersPane` and inside the onboarding paste card container. Updates:

| Event | Announcement |
|-------|--------------|
| Parse success | `"Detected {provider} provider."` |
| Parse failure | `"Could not detect provider. {error message}"` |
| Probe starts | `"Probing {provider} capabilities."` |
| Probe succeeds | `"Probe complete. {capability-list-as-words}."` — e.g. "Probe complete. Supports vision, tools. 128,000 token context." |
| Probe fails | `"Probe failed. {reason}."` — reason taken from Error states table |
| Re-probe starts / ends | Same as above, prefixed with `"Re-probe "`  |
| Fallback row moved (keyboard) | `"Moved {provider} to position {N} of {total}."` |

### Reduced motion

- All entrance animations collapse to `0.01ms` via the global duration overrides
- Drag pickup does NOT scale (keeps opacity change only)
- Capability pill stagger becomes simultaneous (still 4 pills, all appear at once)
- Cross-fade on probe-state transition becomes instant swap (still uses React key re-render)

---

## Component Spec per Primitive Used

Phase 11 uses **only existing primitives** from `src/design-system/primitives/`. No new primitives. One extension (`Button variant="icon"` already exists; `size="sm"` on icon not previously used — verified in `primitives.css` that `.btn.icon` + `.btn.sm` compose cleanly: padding becomes `8px 8px`, 32×32px footprint).

| Primitive | Variants used in Phase 11 | New composition? |
|-----------|---------------------------|------------------|
| `<Button>` | `primary` (Detect & probe, Add a provider, Save & switch) · `secondary` (Test) · `ghost` (See examples disclosure toggle) · `icon` (Re-probe, drag handle remove) | No — all in existing variant union |
| `<Input>` | Default (key entry) · `mono` (paste textarea) | Reuses `mono` prop; no changes |
| `<Pill>` | `default` (capability neutral) · `free` (capability ✓) · `pro` (long-context ✓, active provider) · `new` (probe pending) · with `dot` modifier (active state indicator) | No |
| `<Badge>` | Not used in Phase 11 | — |
| `<Card>` | `tier={1} padding="lg"` (paste card, CapabilityGap container) · `tier={1} padding="md"` (provider row — unchanged) · `tier={2} padding="sm"` (fallback-order drag row) | No |
| `<GlassPanel>` | `tier={2}` (fallback list container) | No |
| `<GlassSpinner>` | `size={16}` (inline next to button label) · `size={12}` (inside icon button) | No |
| `<EmptyState>` | Wrapped by CapabilityGap — passes `label`, `description`, `actionLabel`, `onAction`, `icon`, `testId="capability-gap-{cap}"` | No |
| `<Dialog>` | Not used in Phase 11 (no modal confirmation required — see Color § Destructive) | — |
| `<ListSkeleton>` | Not used in Phase 11 | — |
| `<ErrorBoundary>` | Wraps each consumer of `<CapabilityGap>` (inherited from route-level boundaries) | — |

**New components introduced (Phase 11-specific, live in `src/features/providers/`):**

| Component | Purpose | Composition |
|-----------|---------|-------------|
| `<ProviderPasteForm />` | Shared paste card for onboarding + Settings | `Card` + `Input mono` + `Button primary` + `GlassSpinner` + state machine |
| `<CapabilityPillStrip />` | Renders the 4-pill strip given a `ProviderCapabilityRecord` | 4× `<Pill>` with tone derived from record + `<Button variant="icon">` for re-probe |
| `<CapabilityGap />` | Empty-state for capability-missing routes | `<EmptyState />` + `useCapability()` hook + `openRoute()` |
| `<FallbackOrderList />` | Drag list for fallback chain | `<GlassPanel tier={2}>` + `<Card tier={2} padding="sm">` rows + HTML5 DnD + checkbox toggle |

Each new component is a **composition**, not a new primitive. They live in feature-space per D-35 (co-located CSS if any).

---

## Copywriting Contract

Verbatim copy — executor uses exactly these strings. Planner must cite this section when wiring UI text. Deviations require re-opening this spec.

### Primary CTAs

| Element | Copy |
|---------|------|
| Paste card heading | `Paste any config` |
| Paste card subhead | `cURL, JSON config, or Python SDK snippet. We'll detect the provider and probe for capabilities.` |
| Paste textarea placeholder | `Paste a cURL, JSON config, or Python SDK snippet…` |
| Detect button (idle) | `Detect & probe` |
| Detect button (pending) | `Probing…` |
| Detect button (post-success) | `Continue with this provider →` |
| Re-probe icon aria-label | `Re-probe {provider} capabilities` |
| Examples disclosure link | `See examples` |
| Fallback-order heading | `Fallback order` |
| Fallback-order helper | `If the primary provider errors, BLADE retries through this chain. Drag to reorder. Capability-gated tasks only retry through providers with that capability.` |
| Auto-populate toggle | `Use all providers with keys` |

### CapabilityGap copy (locked — D-54)

| Capability | Headline | Body | CTA | Secondary |
|-----------|----------|------|-----|-----------|
| `vision` | `Needs a vision-capable model` | `This view analyzes what's on screen. Add a provider like Anthropic, OpenAI, or Gemini that can read images.` | `Add a provider` | `Learn which models support vision ↗` |
| `audio` | `Needs an audio-capable model` | `This view transcribes or generates speech. Add a provider that supports audio (OpenAI gpt-4o-audio, ElevenLabs, Cartesia).` | `Add a provider` | `Learn which models support audio ↗` |
| `long_context` | `Needs a long-context model` | `This input is too long for the current provider's context window. Add a provider with 100k+ context (Claude, Gemini 1.5, GPT-4-turbo).` | `Add a provider` | `Learn which models support long context ↗` |
| `tools` | `Needs a tool-calling model` | `This feature uses tools to take actions. Add a provider that supports function calling (Claude, GPT-4, Gemini, most Llama 3.3+).` | `Add a provider` | `Learn which models support tools ↗` |

### Empty states

| Surface | Heading | Body |
|---------|---------|------|
| Fallback-order list, no keys stored | `No providers configured yet` | `Save a provider key above and it'll show up here. BLADE uses the order to retry on transient errors.` |
| Fallback-order list, 1 provider only | (implicit — row just shows alone) | `.t-small` footer note: `Add more providers to enable fallback.` |
| Provider row, key stored but probe never ran (cold migration) | (no heading — inline note) | `.t-small` next to strip: `Click ↻ to probe capabilities.` |

### Error states

| Error | Where | Copy |
|-------|-------|------|
| Parse failed, unknown format | `.onb-error` panel | `Could not detect provider from that input. Supported: cURL command, JSON config object, or Python SDK snippet. Your input started with: "{first-40-chars}…"` |
| Parse succeeded but no API key found | `.onb-error` panel | `We found the provider and model but no API key in your snippet. Paste a full cURL or add the key manually below.` |
| Probe: 401 invalid key | `.onb-error` panel | `That key didn't authenticate. Double-check you copied the full key (no spaces, no quotes).` |
| Probe: 404 model not found | `.onb-error` panel | `Provider accepted the key but the model "{model}" isn't available on your account. Pick a different model or check your provider's dashboard.` |
| Probe: 429 rate-limited | `.onb-ok` panel (yes — 429 means the key works!) | `Key works — rate limited during probe. Capabilities inferred from provider defaults.` |
| Probe: 5xx provider down | `.onb-error` panel | `{Provider} is having issues. Key looks valid but we couldn't complete the probe. Try Re-probe in a few minutes.` |
| Probe: network error | `.onb-error` panel | `Couldn't reach {provider}. Check your internet connection and try again.` |
| Router: no capable provider found | In-chat banner via `blade_routing_capability_missing` event | `This task needs a {capability}-capable model, but none of your providers support it. [Add a {capability}-capable provider →]` — the bracketed text is a button that opens CapabilityGap-style navigation. |

### Destructive confirmations

Phase 11 has **no destructive actions requiring confirmation**. Removal from fallback chain is reversible (re-add). Clearing a stored API key IS destructive but already lives in the existing ProvidersPane flow (Phase 3) — Phase 11 does not modify it.

---

## Empty, Error, Loading States

Consolidated reference table for the checker and auditor. Every state above is covered by one of these patterns.

| State | Pattern | Copy source |
|-------|---------|-------------|
| Paste card, pre-interaction | Textarea + CTA only — no below-button rendering | N/A |
| Paste card, parsing | `<GlassSpinner size={16} />` + "Detecting provider…" | `Detecting provider…` |
| Paste card, parse-success | Provider badge block (see Surface D) | — |
| Paste card, probing | Provider badge + `<GlassSpinner size={16} />` + "Probing capabilities…" | `Probing {provider} capabilities…` |
| Paste card, probe-success | Provider badge + capability pill strip + advance button | — |
| Paste card, parse-error | `.onb-error` panel | See Error states table |
| Paste card, probe-error | `.onb-error` panel (or `.onb-ok` for 429) | See Error states table |
| Provider row, key-missing | Existing `<Pill tone="new">No key</Pill>` pattern | `No key` |
| Provider row, key-stored, unprobed | Existing key-stored pill + `.t-small` "Click ↻ to probe capabilities." above strip | `Click ↻ to probe capabilities.` |
| Provider row, key-stored, probing | Capability strip replaced with single `[Probing…]` pill + GlassSpinner | `Probing…` |
| Provider row, capabilities probed | 4-pill strip rendered | — |
| CapabilityGap surface | `<EmptyState />` + icon + headline + body + CTA | See CapabilityGap copy table |
| Fallback-order list, 0 providers | `<EmptyState />` with label + body | See Empty states table |

---

## Cross-Surface Consistency Invariants

The checker verifies these invariants across the 4 surfaces. They are FALSIFIABLE — if any fails, Phase 11 has regressed.

1. **Paste card identity:** The paste card in Onboarding (Surface A) and in Settings (Surface B) render from the SAME component (`<ProviderPasteForm />`). Visual + copy + state-machine behavior is IDENTICAL. Only the outer container framing (onboarding panel vs settings pane scroll) differs.
2. **Capability pill strip identity:** The `<CapabilityPillStrip />` used inside Settings provider rows (Surface B) and used as an inline element in the Paste card probe-success state (Surface A + B) is THE SAME component — same markup, same tone rules, same order (vision → audio → tools → ctx). Drift between the two is a PHASE 11 REGRESSION.
3. **Icon-button sizing:** All icon-only buttons in Phase 11 (Re-probe, drag-row remove) use `<Button variant="icon" size="sm" />` → 32×32px. None hardcode dimensions.
4. **Focus ring color + geometry:** Every new focusable element shows a 2px `var(--a-cool)` outline at 2px offset (or 4px offset for small icon buttons). No custom focus styling.
5. **Error panel:** Every error surface in Phase 11 uses the existing `.onb-error` class from `onboarding.css`. Settings pane imports it transitively via the paste-card component. No bespoke error styling.
6. **Spinner:** Every pending state uses `<GlassSpinner />` — no custom CSS spinner keyframes. Sizes: 16 for inline-with-text, 12 for inside icon buttons. No other sizes.
7. **Reduced-motion:** All four surfaces must render correctly with `prefers-reduced-motion: reduce` — no layout shift relative to the animated version, only the transitions are suppressed.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none (D-01 locks no shadcn) | not applicable |
| Third-party | none | not applicable |

Phase 11 introduces ZERO external component dependencies. All new UI composes existing primitives. This eliminates the registry vetting gate entirely.

---

## Verification Targets (for gsd-ui-checker)

The checker validates against six dimensions. Phase 11 mappings:

| Dimension | How to verify | Pass criteria |
|-----------|---------------|---------------|
| 1 Copywriting | Grep new components for hardcoded strings; diff against Copywriting Contract § | 100% of user-facing strings in this phase match the table verbatim |
| 2 Visuals | Screenshot 4 surfaces; compare against ASCII mockups + ensure blur cap ≤3 layers per viewport | No viewport shows >3 backdrop-filter layers; every surface uses ≥1 existing primitive |
| 3 Color | Run existing `audit-contrast.mjs` gate with Phase 11 surfaces added to the manifest | AA 4.5:1 across all 5 representative wallpapers |
| 4 Typography | Grep new files for `font-size:` hardcodes | 0 raw px font-sizes; only `.t-*` utility classes |
| 5 Spacing | Grep new files for hardcoded `px` in padding/margin | 0 hardcoded values; only `var(--s-*)` tokens or `padding` prop on Card |
| 6 Registry safety | Diff package.json for new deps; inspect imports in `src/features/providers/` | 0 new dependencies; all imports resolve to `@/design-system/primitives` or local feature files |

**Phase-11-specific gate (planner will add):** `scripts/verify-providers-ui.mjs` — asserts `CAPABILITY_SURFACES` has ≥2 entries per capability, all 4 `<CapabilityGap capability="*" />` instantiations are type-safe, and no bespoke `.onb-error`-equivalent class names exist outside the approved list.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

## Source References

- `.planning/phases/11-smart-provider-setup/11-CONTEXT.md` — D-51..D-58 locked
- `.planning/REQUIREMENTS.md` §PROV-01..09 — functional scope
- `.planning/ROADMAP.md` §"Phase 11 Smart Provider Setup" — 5 success criteria
- `src/styles/tokens.css` — spacing, color, radius, font token source of truth
- `src/styles/typography.css` — `.t-h1`/`.t-h2`/`.t-h3`/`.t-body`/`.t-small`/`.t-mono` utility classes
- `src/styles/glass.css` — glass-1/2/3 tier classes (blur caps)
- `src/styles/motion.css` — easings + durations (including reduced-motion override)
- `src/styles/motion-entrance.css` — `.list-entrance` reused for paste card + pill strip entrance
- `src/design-system/primitives/primitives.css` — `.btn` / `.input` / `.chip` / `.badge` / `dialog.glass`
- `src/design-system/primitives/index.ts` — primitive barrel (12 exports)
- `src/features/onboarding/ProviderPicker.tsx` — preserved 6-card layout
- `src/features/onboarding/providers.ts` — `PROVIDERS` registry (unchanged)
- `src/features/onboarding/onboarding.css` — `.onb-error` / `.onb-ok` / `.onb-footer` / `.providers` grid
- `src/features/settings/panes/ProvidersPane.tsx` — existing Settings pane (extended in place)
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` §Route Catalog — capability-gap surface candidates (screen-timeline, quickask, web-automation, voice-orb, meeting-ghost)

---

*UI-SPEC drafted: 2026-04-20 — auto mode, formalising D-51..D-58 from `11-CONTEXT.md`. Zero new tokens, zero new primitives, zero new dependencies.*
