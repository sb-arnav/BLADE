# Spacing Ladder — Canonical Source of Truth

Phase 15 density policy. Every padding / margin / gap in layout-position contexts MUST resolve through one of the tokens below OR fall inside the documented Whitelist. This document is the rule config for `scripts/verify-spacing-ladder.mjs`.

Source tokens: `src/styles/tokens.css` lines 72–75. Aliased as `--gap` (= `--s-4`) in `src/styles/layout.css`.

---

## Canonical Scale

Base unit = 4px. All spacing derives from this ladder.

| Token   | Pixels | Typical Use                                        |
| ------- | ------ | -------------------------------------------------- |
| `--s-1` | 4px    | Tight inline pairs (icon + text gap)               |
| `--s-2` | 8px    | List-item gaps, chip internal padding              |
| `--s-3` | 12px   | Card internal vertical rhythm                      |
| `--s-4` | 16px   | Default gap (`--gap`), card padding baseline       |
| `--s-5` | 20px   | Hero padding, section padding                      |
| `--s-6` | 24px   | Dashboard card padding, drawer padding             |
| `--s-8` | 32px   | Empty-state padding, major section gaps            |
| `--s-10`| 40px   | Page top padding                                   |
| `--s-12`| 48px   | Major between-section spacing                      |
| `--s-16`| 64px   | Hero vertical rhythm                               |
| `--s-20`| 80px   | Full-page empty-state vertical breathing room      |

All 11 tokens `--s-1` through `--s-20` are the ONLY allowed values for layout-position padding / margin / gap. Non-linear gaps in the scale (no `--s-7`, `--s-9`, `--s-11`, etc.) are intentional — they force authors to pick an adjacent rung rather than invent a new value.

---

## Allowed Uses

The following CSS properties MUST resolve through the Canonical Scale via `var(--s-N)` (or `var(--gap)`, which aliases `--s-4`) — NOT through hardcoded pixel or rem values:

- `padding`, `padding-top`, `padding-bottom`, `padding-left`, `padding-right` — ALL layout-position contexts
- `margin`, `margin-top`, `margin-bottom`, `margin-left`, `margin-right` — EXCEPT `margin: 0` and `margin: auto` (which are layout primitives, not spacing values)
- `gap`, `row-gap`, `column-gap`
- `grid-gap` (flex / grid shorthand)

Token composition via `calc(var(--s-N) + var(--s-M))` is allowed. Raw `calc()` with literal pixel values is NOT.

---

## Whitelist — Micro-Padding Exceptions

The following hardcoded values are allowed because they are sub-token (< 4px) or pill/chip micro-padding where the token scale is too coarse for correct visual weight. The verify script encodes these literally.

### Always-allowed values (regardless of selector)

- `padding: 0` — explicit zero (intent-signalling)
- `padding: 1px`, `padding: 2px`, `padding: 3px` — sub-token pixel polish
- `padding: 0 0`, `padding: 0 1px`, `padding: 0 2px`, `padding: 0 6px`, `padding: 0 10px`, `padding: 0 12px` — zero-vertical scrollbar / traffic-light corridors

### Chip / pill / badge / status — allowed only on matching selectors

The following combined-axis values are allowed ONLY when the surrounding selector matches `/\.(chip|pill|badge|status|tlight|titlebar-traffic|tlight-|hormone-chip|dash-hero-state|dash-hero-chip|titlebar-status|titlebar-hint|coming-soon-card|voice-orb-window)/`:

- `padding: 2px 6px`
- `padding: 1px 4px`, `padding: 1px 6px`
- `padding: 3px 10px`
- `padding: 4px 10px`, `padding: 4px 12px`
- `padding: 6px 10px`, `padding: 6px 12px`
- `padding: 8px 12px`, `padding: 8px 14px`, `padding: 8px 16px`
- `padding: 10px 12px`, `padding: 10px 14px`
- `padding: 12px 16px`

### Rationale

Chip micro-padding exists because `--s-1` (4px) × `--s-3` (12px) would produce chips that are either too cramped or too wide — the visual weight of a pill is a perception-system concern, not a layout-system one. Restricting these values to `*chip*`, `*pill*`, `*badge*`, `*status*`, `*tlight*` selectors prevents general-purpose layout from leaking off-ladder.

### Scrollbar + traffic-light + native-window exceptions

- `::-webkit-scrollbar*` selectors may use any `0 Npx` or small pixel padding combinations — these are UA-controlled widgets, not layout surfaces
- `.tlight*`, `.titlebar-traffic` — macOS traffic-light placement requires per-pixel alignment
- `.voice-orb-window[data-corner]` — native Tauri overlay corner padding (`padding: 24px` for window-edge placement) is coupled to Tauri's native window geometry, not the spacing scale

---

## Violation Definition

A violation is:

1. A hardcoded px or rem value inside a `padding:`, `padding-{top|bottom|left|right}:`, `margin:` (NOT `margin: 0` / `margin: auto`), `gap:`, `row-gap:`, `column-gap:`, or `grid-gap:` declaration
2. That does NOT match the Whitelist above
3. In a CSS file under `src/features/**/*.css`, `src/design-system/**/*.css`, or `src/styles/**/*.css` (EXCLUDING `tokens.css` and `layout.css` — those files DEFINE the scale)

The gate is layout-position only. Font metrics, `line-height`, `letter-spacing`, `border-width`, `box-shadow` offsets, and `transform` offsets are NOT in scope — those are perception-system concerns and have their own rules.

---

## Scope

`verify:spacing-ladder` walks exactly these directories for `.css` files:

- `src/features/**/*.css`
- `src/design-system/**/*.css`
- `src/styles/**/*.css` — EXCLUDING `tokens.css` and `layout.css` by name

Files outside this scope (e.g., `src/windows/**/*.css`, `node_modules/**`) are NOT scanned. The scope is bounded at roughly 200 files; a full run is ~50ms.

---

## Empty-State Copy Rules

The companion policy for `verify:empty-states-copy`. Phase 15's premise is that bare-negation copy ("No data", "No results") is a trust failure — it tells the user BLADE is broken instead of teaching the user what BLADE will show once it has signal.

### Banned bare phrases

When appearing as the ONLY `<EmptyState label="...">` content (no description, no actionLabel):

- "No data"
- "No results"
- "No recent X" (where X is any word — e.g., "No recent decisions", "No recent events")
- "No X yet" as a bare label with no CTA — e.g., "No goals yet", "No items yet"
- "Nothing yet"
- "Nothing here"

### Acceptable patterns (any ONE is enough to pass)

1. **CTA escape** — the EmptyState has `actionLabel="..."` AND `onAction={...}` on the same element
2. **Description timeline escape** — the EmptyState has `description="..."` AND the description value contains any of: `learning`, `give me`, `still`, `once`, `after`, `when`, `24h`, `48h`, `will appear`, `as BLADE`, `will populate`, `come back`, `start`, `add`, `connect`, `configure`, `enable`
3. **Label timeline escape** — the `label` value itself matches `/learning|give me|still|once|after|when|24h|48h/i`

### Examples

**FAIL:**

```tsx
<EmptyState label="No recent decisions" />
```

Bare negation with no description, no CTA, no timeline phrasing.

**PASS (label + description timeline escape):**

```tsx
<EmptyState
  label="BLADE is still learning"
  description="Give me 24h and this will populate"
/>
```

**PASS (CTA escape):**

```tsx
<EmptyState
  label="No decisions logged"
  actionLabel="Record one"
  onAction={handleRecord}
/>
```

**PASS (label timeline escape):**

```tsx
<EmptyState label="BLADE is still warming up" />
```

The label itself contains "still" — signals learning-in-progress, not broken.

### Scope

`verify:empty-states-copy` walks `src/features/**/*.tsx`. TSX files outside `src/features/` (design-system primitives, windows, tests) are NOT scanned.

---

## Enforcement

Both rules are enforced by CI via:

- `npm run verify:spacing-ladder` — exits 1 on any off-ladder layout padding / margin / gap
- `npm run verify:empty-states-copy` — exits 1 on any bare-negation EmptyState missing CTA / timeline / description

Both scripts are wired into `verify:all` after `verify:a11y-pass-2`. A first-run failure is EXPECTED — the violation count from initial runs defines the backlog that Plans 15-02 through 15-04 close against.
