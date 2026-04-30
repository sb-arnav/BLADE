---
phase: 17
slug: doctor-module
status: draft
created: 2026-04-30
shadcn_initialized: false
preset: none
component_library: BLADE design-system primitives (Tauri 2 + React + Tailwind v4)
dimensions_pending:
  - spacing
  - typography
  - color
  - copy
  - motion
  - accessibility
upstream:
  context: .planning/phases/17-doctor-module/17-CONTEXT.md
  requirements: .planning/REQUIREMENTS.md (DOCTOR-01..10)
  roadmap: .planning/ROADMAP.md (lines 86-100)
canonical_token_files:
  - src/styles/tokens.css
  - src/styles/typography.css
  - src/styles/motion.css
  - src/design-system/primitives/primitives.css
  - src/features/admin/admin.css
  - src/features/admin/admin-rich-b.css
  - src/features/activity-log/activity-log.css
ghost_token_audit: passed (every token referenced in this spec is grep-verified live in the files above as of 2026-04-30)
---

# Phase 17 — Doctor Module UI Design Contract

> Visual + interaction contract for the Doctor sub-tab inside the existing
> `src/features/admin/Diagnostics.tsx`. Consumed by `gsd-planner`, `gsd-executor`,
> `gsd-ui-checker`, and the BLADE `/blade-uat` runtime gate.

---

## 1. Phase Boundary Recap

Phase 17 ships a **Doctor sub-tab** inside the existing Diagnostics route that
aggregates 5 signal classes (EvalScores → CapabilityGaps → TentacleHealth →
ConfigDrift → AutoUpdate) as a list of severity-striped, click-to-expand rows
backed by 3 Tauri commands and 1 Tauri event (`doctor_event`).

The pane is **a debugging surface, not a dashboard** — restraint over
decoration; sparse all-green state; no celebration UI; reuses the live BLADE
admin substrate (admin-tab-pill, admin-row-list, status tokens, `<dialog>`
modal) verbatim where it already exists.

Phase 17 is a **pure CONSUMER** of signals; this UI-SPEC adds zero new visual
substrate beyond what's already shipped — it composes existing classes into a
new layout per CONTEXT.md D-10..D-13.

---

## 2. Anchor Decisions From CONTEXT.md (DO NOT RE-DECIDE)

The following are **locked** by `17-CONTEXT.md` and may not be revisited in
the planner / executor stage:

- **D-10** New "Doctor" sub-tab inside `Diagnostics.tsx` — does not replace
  existing tabs, adds a 7th tab to the existing 6 (`health / traces /
  authority / deep / sysadmin / config`).
- **D-11** List of collapsible rows (one per signal class), severity-color
  left-border stripe. NOT a card grid.
- **D-12** Refresh = (a) auto-pull on mount + (b) manual button + (c) live via
  `listen("doctor_event", ...)`.
- **D-13** Empty / all-green state = sparse summary "All signals green — last
  checked HH:MM:SS." No celebration UI.
- **D-17** Drill-down via centered `<dialog>` modal (BLADE's existing
  primitive — see § 6 for the discrepancy note vs CONTEXT.md "right-side
  drawer" wording).
- **D-18** Suggested-fix copy is handwritten; one string per (class × severity)
  pair; stored in `doctor.rs`. Phase 17 plans **must** use the table in § 15
  verbatim.
- **D-04** Severity enum: `Green | Amber | Red` (exactly 3 tiers per
  DOCTOR-08).
- **Most-volatile-first row order** (CONTEXT.md "Specific Ideas"): EvalScores →
  CapabilityGaps → TentacleHealth → ConfigDrift → AutoUpdate.

This UI-SPEC fills in **only** the visual + interaction layer that CONTEXT.md
delegated as Claude's Discretion: spacing per row, drawer width / motion,
icon, copy strings, badge style, loading + error states, accessibility,
responsive behavior.

---

## 3. Design System Detection

| Property | Value | Source |
|----------|-------|--------|
| Tool | none (no shadcn — D-01..D-45 forbid it) | `components.json` absent; PROJECT.md D-01 |
| Component library | BLADE design-system primitives | `src/design-system/primitives/` |
| Tailwind | v4 only | `src/styles/index.css` `@theme` block |
| Icon library | inline SVG via `NavIcon` registry | `src/design-system/shell/navrail-icons.tsx` |
| Font (display) | Syne 400/700 self-hosted | `src/styles/typography.css` |
| Font (body) | Bricolage Grotesque 400/600 self-hosted | `src/styles/typography.css` |
| Font (mono) | JetBrains Mono 400/600 self-hosted | `src/styles/typography.css` |
| Drawer mechanism | native `<dialog>` modal via `Dialog` primitive | `src/design-system/primitives/Dialog.tsx` |
| Severity-stripe pattern (live) | `border-left: 3px solid var(--status-*)` | `admin.css:49-53` |

No new component library, no new font, no new icon dependency. Phase 17
consumes existing primitives (`Button`, `Dialog`, `GlassPanel`, `GlassSpinner`,
`Pill`, `Badge`, `EmptyState`, `ListSkeleton`).

---

## 4. Tab Affordance — Doctor Sub-Tab Inside Diagnostics

### 4.1 Pattern (matches existing live substrate)

The 7th tab pill drops into the existing `.admin-tabs` strip in
`Diagnostics.tsx:143-168`. **Reuse the live `admin-tab-pill` class verbatim.**
No new CSS — the rendered DOM extends the existing `[id, label]` array by one
entry.

```tsx
// In Diagnostics.tsx — extend the existing tabs tuple:
[
  ['health', 'Health'],
  ['traces', 'Traces'],
  ['authority', 'Authority'],
  ['deep', 'Deep scan'],
  ['sysadmin', 'Sysadmin'],
  ['config', 'Config'],
  ['doctor', 'Doctor'],   // ← new, last (least disruptive to muscle memory)
]
```

### 4.2 Tab persistence

Persists via the existing `prefs['admin.activeTab']` key with `diag:` prefix
(`Diagnostics.tsx:47-65`). New `DiagTab` literal becomes:
`'health' | 'traces' | 'authority' | 'deep' | 'sysadmin' | 'config' | 'doctor'`.

### 4.3 Tab visual contract

Inherits the **exact** existing `.admin-tab-pill` style from `admin.css:79-94`.
No override:

| Property | Value | Token |
|---|---|---|
| Padding | `var(--s-1) var(--s-2)` (4px / 8px) | live |
| Border-radius | `var(--r-pill)` (999px) | live |
| Default background | `rgba(255, 255, 255, 0.04)` | live (literal) |
| Default border | `1px solid var(--line)` | live |
| Default text | `var(--t-2)` | live |
| Active background | `rgba(255, 255, 255, 0.14)` | live (literal) |
| Active border | `rgba(255, 255, 255, 0.22)` | live (literal) |
| Active text | `var(--t-1)` | live |
| Transition | `background 140ms var(--ease-out)` | live |
| Font-size | 13px | live |

### 4.4 Tab label rationale

**Label: "Doctor"** (not "Health" — the existing tab is already "Health" and
maps to `supervisor_get_health()`; "Doctor" is the only unambiguous choice).
Sentence-case per existing tabs ("Deep scan", "Sysadmin").

---

## 5. Row Spec — The 5 Signal Class Rows

### 5.1 Container

A `.doctor-row-list` flex column inside the Doctor pane's `.diagnostics-section`.
Reuses the live `.admin-row-list` flex pattern (`admin-rich-b.css:364`)
verbatim — same gap, same direction.

| Property | Value | Token |
|---|---|---|
| Display | `flex` column | live `.admin-row-list` |
| Gap between rows | `var(--s-1)` (4px) | live |

### 5.2 Row composition (collapsed state)

Each row is a clickable `<button type="button">` with role tied to a virtual
`<dialog>` (see § 6). Layout: `display: grid` with three columns —
`[severity-stripe + name + badge] [meta] [chevron]`.

```
┌─────────────────────────────────────────────────────────────────┐
│ │ Eval Scores      [GREEN]   ·   2 minutes ago            ›    │
└─────────────────────────────────────────────────────────────────┘
```

| Element | Content | Class | Typography token |
|---|---|---|---|
| Severity stripe | 4px solid left border, severity-tinted | `.doctor-row[data-severity="..."]` | `--status-success` / `--a-warm` / `--status-error` / `--status-idle` |
| Signal class name | "Eval Scores", "Capability Gaps", "Tentacle Health", "Config Drift", "Auto-Update" | `.doctor-row-name` | 13px / weight 600 / `var(--t-1)` (matches `.integration-service-card-name` admin-rich-b.css:163) |
| Severity badge | Pill: "GREEN" / "AMBER" / "RED" | `.doctor-row-badge` | uses `Badge` primitive, see § 5.4 |
| Last-changed timestamp | Relative for <24h, else absolute | `.doctor-row-meta` | 11px / mono / `var(--t-3)` (matches `.integration-service-card-meta` admin-rich-b.css:169-173) |
| Expand chevron | `›` (single character) | `.doctor-row-chevron` | 13px / `var(--t-3)` |

### 5.3 Row container CSS

```css
.doctor-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-4);     /* 12px / 16px */
  min-height: 56px;                    /* keyboard-tap target ≥ 44px + breathing room */
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: var(--font-body);
  color: var(--t-1);
  transition: background var(--dur-fast) var(--ease-out);
}

.doctor-row[data-severity="green"]   { border-left: 4px solid var(--status-success); }
.doctor-row[data-severity="amber"]   { border-left: 4px solid var(--a-warm); }
.doctor-row[data-severity="red"]     { border-left: 4px solid var(--status-error); }
.doctor-row[data-severity="unknown"] { border-left: 4px solid var(--status-idle); }
.doctor-row[data-severity="error"]   { border-left: 4px solid var(--t-4); }   /* signal-source failure, see § 7.3 */
```

**Stripe width 4px** (not 3px like `.admin-card`) matches the
`.security-hero[data-status]` precedent in `admin-rich-a.css:628-630` — this
row is the primary visual subject of its own list, not a peripheral chip.

### 5.4 Severity badge

Uses the existing `Badge` primitive (`primitives.css:172-183`). Tone mapping:

| Severity | Badge tone | Token resolution |
|---|---|---|
| Green | `tone="ok"` → `.badge-ok` | `color: var(--a-ok)` (live) |
| Amber | `tone="warn"` → `.badge-warn` | `color: var(--a-warn)` (live) |
| Red | `tone="hot"` → `.badge-hot` | `color: var(--a-hot)` (live) |
| Unknown / pending (loading) | `tone="default"` | `color: var(--t-2)` (live) |

Badge text: ALL CAPS, 10px monospace per `primitives.css:172-180` — matches
the existing badge contract verbatim.

### 5.5 Hover + focus + active states

```css
.doctor-row:hover { background: rgba(255, 255, 255, 0.07); }   /* matches --g-fill */

.doctor-row:focus-visible {
  outline: 2px solid var(--a-warm);
  outline-offset: -2px;
}                /* matches .activity-strip:focus-visible (activity-log.css:36-39) */

.doctor-row[data-expanded="true"] {
  background: rgba(255, 255, 255, 0.11);    /* matches --g-fill-strong */
}
```

### 5.6 Last-changed timestamp formatting

- **<60s** → `"just now"`
- **<60min** → `"N minutes ago"` / `"1 minute ago"`
- **<24h** → `"N hours ago"` / `"1 hour ago"`
- **≥24h** → absolute `HH:MM:SS · YYYY-MM-DD` (24-hour, ISO-style date)

Rationale: `IntegrationStatus.tsx:79-86` already mixes relative+absolute via
`toLocaleString()`; Doctor goes one step further because relative is
load-bearing for "is this signal stale or fresh?"

### 5.7 Expand affordance

Clicking the row opens the drill-down `<dialog>` (§ 6). The chevron `›` is
purely visual; the entire row is the click target. `aria-expanded` is **not**
set on the row because the drawer is a modal, not an inline accordion — see
§ 11 for ARIA contract.

---

## 6. Drawer Spec — Drill-Down Modal

### 6.1 Mechanism: BLADE's existing `<dialog>` modal — NOT a side-sheet

**Discrepancy with CONTEXT.md:** CONTEXT.md D-17 says "right-side drawer
matches BLADE's existing drawer pattern (e.g., ActivityDrawer from v1.1)."
Live audit (`ActivityDrawer.tsx:39-99` + `Dialog.tsx:79-90`) shows
ActivityDrawer renders as a **centered `<dialog>` modal**, not a right-side
sheet. There is no side-sheet primitive in BLADE.

**Phase 17 reuses the live `Dialog` primitive verbatim.** Building a new
right-side sheet substrate is out of scope (would need new primitive +
focus-trap + a11y review + tokens) and re-introduces the v1.1 ghost-token
risk (the v1.3 token-rebind comment in `activity-log.css:6-12` is a recent
scar).

### 6.2 Dialog dimensions (override default)

The default `dialog.glass` is 320–560px wide (`primitives.css:185-191`).
Doctor's drill-down needs more room for formatted JSON payloads. Phase 17
introduces ONE class override `.doctor-drawer` applied to the dialog:

```css
.doctor-drawer.dialog {            /* extends dialog.glass via cascade */
  min-width: min(640px, calc(100vw - var(--s-12)));
  max-width: min(720px, calc(100vw - var(--s-12)));
  max-height: min(80vh, 720px);
  padding: 0;                       /* override --s-8 default — header has its own padding */
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

Rationale for these widths: 640–720px clears the typical pretty-printed JSON
line-width while leaving 32px (`var(--s-8)`) margin from viewport edge at
1280×800 and full-bleed at 1100×700 (the smaller tested viewport per
CLAUDE.md Verification Protocol).

### 6.3 Backdrop + scrim

Inherits `dialog.glass::backdrop` from `primitives.css:192-196` verbatim:
`rgba(0, 0, 0, 0.55)` + `backdrop-filter: blur(8px)`. No override.

### 6.4 Drawer content layout

Three vertical sections — header / body / footer — separated by 1px dividers:

```
┌─ doctor-drawer-header ───────────────────────────────┐
│  Eval Scores                       [RED]      ✕     │
│  last changed 12 minutes ago                          │
├─ doctor-drawer-body (scrollable) ────────────────────┤
│  Suggested fix                                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │ An eval module breached its asserted floor. ... │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Raw payload                                          │
│  ┌─────────────────────────────────────────────────┐ │
│  │ {                                                │ │
│  │   "module": "hybrid_search_eval", ...           │ │
│  │ }                                                │ │
│  └─────────────────────────────────────────────────┘ │
├─ doctor-drawer-footer ───────────────────────────────┤
│  [Re-check this signal]                    [Close]   │
└──────────────────────────────────────────────────────┘
```

### 6.5 Drawer CSS contract

```css
.doctor-drawer-header {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-4) var(--s-4) var(--s-3);    /* matches activity-drawer-header */
  border-bottom: 1px solid var(--line);
}

.doctor-drawer-title {
  font-family: var(--font-body);
  font-size: 15px;
  font-weight: 600;
  color: var(--t-1);
  margin: 0;
}                /* identical to .activity-drawer-title (activity-log.css:89-94) */

.doctor-drawer-meta {
  grid-column: 1;
  grid-row: 2;
  font-size: 11px;
  color: var(--t-3);
  font-family: var(--font-mono);
}

.doctor-drawer-close {
  /* reuse .activity-drawer-filter pattern (activity-log.css:102-111) */
  font-size: 12px;
  color: var(--t-2);
  background: var(--g-fill-weak);
  border: 1px solid var(--g-edge-mid);
  border-radius: var(--r-sm);
  padding: var(--s-1) var(--s-2);
  cursor: pointer;
}

.doctor-drawer-body {
  padding: var(--s-4);
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
}

.doctor-drawer-section-label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--t-3);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 var(--s-1) 0;
}        /* matches .danger-banner uppercase pattern (admin.css:104-105) */

.doctor-drawer-fix-copy {
  /* reuses .temporal-recall-card visual signature (admin-rich-b.css:48-57) */
  padding: var(--s-3);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  color: var(--t-2);
  font-size: 13px;
  line-height: 1.55;
}

.doctor-drawer-payload-pre {
  /* identical to .diagnostics-config-pre (admin-rich-b.css:107-119) */
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--s-2);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--t-2);
  max-height: 320px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin: 0;
}

.doctor-drawer-footer {
  display: flex;
  justify-content: space-between;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-4);
  border-top: 1px solid var(--line);
}
```

### 6.6 Close affordances (all live in `Dialog.tsx`)

- `Esc` key → native `<dialog>` close (browser handles)
- `✕` close button (header right) → `onClose()` prop
- Click on backdrop → handled by browser via `dialog`'s `cancel` event (see
  Phase 14 Plan 14-04 — already wired in `Dialog.tsx`)
- "Close" button in footer → `onClose()` prop

**Focus management on open / close:** inherited from `Dialog.tsx:55-77`
verbatim — captures `prevFocusRef`, focuses first interactive child on open,
restores focus to triggering row on close. Phase 17 must pass the row's
`<button>` ref via `triggerRef` so focus returns to the same row, not to the
tab pill.

---

## 7. States

### 7.1 Empty / all-green state

When all 5 signals report Green and `last_full_check_at != null`:

```
┌─────────────────────────────────────────────────────────────────┐
│ │ All signals green — last checked 14:23:08                    │
└─────────────────────────────────────────────────────────────────┘
```

Single row. Same `.doctor-row` chrome with `data-severity="green"`. No badge.
No chevron. Not clickable (this row has `cursor: default` and no
`focus-visible` ring — it's a status display, not an action).

Class: `.doctor-row.doctor-row--summary`. Override:
```css
.doctor-row.doctor-row--summary {
  cursor: default;
  pointer-events: none;
}
.doctor-row.doctor-row--summary:hover {
  background: rgba(255, 255, 255, 0.04);  /* same as default — no hover lift */
}
```

Below the summary row, render the 5 individual signal rows anyway (each will
be Green) — this gives keyboard users access to drill-down into a Green
signal to see the underlying data. The summary is on top of the list, not in
place of it.

### 7.2 Loading state — `doctor_run_full_check` in flight

**On initial mount (no cached data yet):** render `<ListSkeleton rows={5}
rowHeight={56} />` — the existing primitive (`ListSkeleton.tsx`,
`primitives.css:198-217`). Skeleton row height matches `.doctor-row` min-height.

**On manual refresh (cached data exists):** rows stay rendered with their
prior severity stripes, but:
- Page-level `<Button variant="ghost">` text changes to `"Re-checking…"` and
  `disabled={true}` (matches `Diagnostics.tsx:111-113` `Refreshing…` pattern)
- Each row gains `data-refreshing="true"` attribute (frontend can use this for
  a subtle pulse if Phase 18+ wants it; Phase 17 ships **no** per-row pulse —
  restraint over decoration per CONTEXT.md D-13)
- The page-level button is the single source of "something is happening"
  feedback

### 7.3 Error per signal source

If a signal source's Rust function returns an `Err` (e.g., `tests/evals/history.jsonl`
not readable, capability-gap log corrupted), Doctor still surfaces a row for
that signal class but with:

| Property | Value |
|---|---|
| `data-severity` | `"error"` (the 5th value beyond green/amber/red/unknown) |
| Stripe color | `var(--t-4)` (32% white — neutral, not alarming, distinct from severity colors) |
| Badge | `tone="default"` text `"ERROR"` |
| Meta | `"could not read · 12 seconds ago"` |
| Drawer body | suggested fix shows a generic `"This signal source failed to read its data. See raw payload for the error."` + raw payload contains the `Err` string |

**Why a 4th tier instead of folding into Red?** Red means "the system
detected a problem" (legitimate signal). Error means "the diagnostic itself
broke" — operationally different. Conflating them would have Doctor lying about
state.

### 7.4 Page-level error

If `doctor_run_full_check` itself throws (not just one source — the orchestrator
itself), the pane renders `<EmptyState>` with:

| Slot | Copy |
|---|---|
| `label` | `"Doctor unavailable"` |
| `description` | `"Could not run full check. Tauri command failed: {error}"` |
| `actionLabel` | `"Retry"` |
| `onAction` | re-invoke `doctor_run_full_check` |

Reuses the live `EmptyState` primitive verbatim
(`Diagnostics.tsx:653-658` precedent).

### 7.5 Populated state (mixed severities)

The default state when there are signals at varying severities. Rows render in
**locked order** (D-11 most-volatile-first):

1. Eval Scores
2. Capability Gaps
3. Tentacle Health
4. Config Drift
5. Auto-Update

**Order is independent of severity.** A Red EvalScores does not jump to the
top because EvalScores is already first. Reordering by severity would create
visual instability across refreshes — order is muscle-memory, not priority.

### 7.6 Refresh-in-flight (via `doctor_event` push)

When a `doctor_event` arrives (Tauri push, see DOCTOR-06 / D-20), the affected
row's `data-severity` value updates in place. The transition uses
`var(--dur-fast)` (150ms) and only re-paints the stripe color (no row
position change, no fade-in). See § 11 motion contract.

---

## 8. Color Tokens (every reference verified live)

All tokens below were grep-verified in the listed files on 2026-04-30. **No
ghost tokens.** If a planner / executor needs a color, they MUST pick from
this list.

| Token | Value | Used for | Source file (verified live) |
|---|---|---|---|
| `--status-success` | `#a6ffd2` | Green severity stripe | `tokens.css:60` |
| `--a-warm` | `#ffd2a6` | Amber severity stripe | `tokens.css:50` |
| `--status-error` | `#ff6b6b` | Red severity stripe | `tokens.css:61` |
| `--status-idle` | `rgba(255,255,255,0.30)` | Unknown / pending stripe | `tokens.css:58` |
| `--a-ok` | `#8affc7` | Badge text — Green tone | `tokens.css:51` (used in `.badge-ok` `primitives.css:181`) |
| `--a-hot` | `#ff9ab0` | Badge text — Red tone | `tokens.css:53` (used in `.badge-hot` `primitives.css:183`) |
| `--t-1` | `rgba(255,255,255,0.97)` | Row name, drawer title, primary text | `tokens.css:39` |
| `--t-2` | `rgba(255,255,255,0.72)` | Drawer body copy, secondary text | `tokens.css:40` |
| `--t-3` | `rgba(255,255,255,0.50)` | Meta, timestamp, section labels | `tokens.css:41` |
| `--t-4` | `rgba(255,255,255,0.32)` | Error-tier stripe (neutral, dimmed) | `tokens.css:42` |
| `--line` | `rgba(255,255,255,0.08)` | Row borders, drawer dividers | `tokens.css:45` |
| `--g-fill-weak` | `rgba(255,255,255,0.04)` | Drawer close button bg | `tokens.css:17` |
| `--g-fill` | `rgba(255,255,255,0.07)` | Row hover bg | `tokens.css:18` |
| `--g-fill-strong` | `rgba(255,255,255,0.11)` | Row expanded-state bg | `tokens.css:19` |
| `--g-edge-mid` | `rgba(255,255,255,0.14)` | Drawer close button border | `tokens.css:24` |

Literal `rgba()` values used in inline class definitions in the CSS samples
above (e.g., `rgba(255, 255, 255, 0.04)` in `.doctor-row` background) are
**copies of values that resolve from `--g-fill-weak` / `--line`** — chosen
literal because the matching `.admin-card` / `.integration-service-card`
classes use literals too, not vars. Maintaining the literal pattern keeps
visual diffability with surrounding admin chrome. The accompanying
`background: var(--g-fill-weak)` would render identically; the planner may
choose either at execution time.

### Reserved-for list (60 / 30 / 10 split)

This pane lives inside the existing dark glass admin surface, which already
satisfies the dominant + secondary palette. Doctor's **only accent surface**
is the severity stripe + badge. Accent is reserved for:

- 4px left-border severity stripe per row
- Badge text color (10px monospace pill) per row
- Drawer header severity badge

It is **NOT** used for: hover states, button highlights, focus rings (focus
ring uses `--a-warm` per BLADE's existing `.activity-strip:focus-visible`
pattern, which is intentional — that's the global focus accent).

---

## 9. Spacing Tokens (every reference verified live)

All from `tokens.css:73-75` — BLADE's spacing scale is a 4-multiple ladder.

| Token | Value | Used in Doctor for |
|---|---|---|
| `--s-1` | 4px | Row gap, badge padding, chevron gap |
| `--s-2` | 8px | Drawer close button padding, button gap |
| `--s-3` | 12px | Row vertical padding, drawer header padding-bottom, footer padding |
| `--s-4` | 16px | Row horizontal padding, drawer body padding, drawer header padding-top |
| `--s-8` | 32px | Drawer-to-viewport min margin (640px + 32px = 672px ≤ 1100px ✓) |
| `--s-12` | 48px | Reserved — viewport horizontal margin reserve in drawer max-width math |

Exceptions (literals): `min-height: 56px` on `.doctor-row` is a 4-multiple
(56 = 14 × 4). `2px` for `outline` is the live focus-ring width
(`activity-log.css:37-38`).

---

## 10. Typography Tokens (every reference verified live)

All from `typography.css` and `tokens.css:78-81`.

| Use | Size | Weight | Family | Line-height |
|---|---|---|---|---|
| Doctor pane heading (`<h4 class="diagnostics-section-title">`) | 13px | 600 | `var(--font-body)` (Bricolage) | inherit | `admin-rich-b.css:131-136` (live) |
| Row signal-class name | 13px | 600 | `var(--font-body)` | inherit | matches `.integration-service-card-name` |
| Row meta + timestamp | 11px | 400 | `var(--font-mono)` (JetBrains Mono) | inherit | matches `.integration-service-card-meta` |
| Drawer title (`.doctor-drawer-title`) | 15px | 600 | `var(--font-body)` | inherit | matches `.activity-drawer-title` |
| Drawer section label (uppercase) | 11px | 600 | `var(--font-body)` | inherit (letter-spacing 0.04em) | matches `.danger-banner` uppercase rhythm |
| Drawer suggested-fix copy | 13px | 400 | `var(--font-body)` | 1.55 | matches `.t-body` |
| Drawer raw payload (`<pre>`) | 12px | 400 | `var(--font-mono)` | inherit | matches `.diagnostics-config-pre` |
| Drawer meta (last-changed) | 11px | 400 | `var(--font-mono)` | inherit | matches row meta |
| Severity badge text | 10px | 600 | `var(--font-mono)` | inherit (UPPERCASE) | matches `.badge` `primitives.css:172-180` |

Phase 17 introduces **zero** new font sizes. Every value above already exists
in the BLADE type ladder — see `typography.css:76-83` for the `.t-*` utility
classes and `admin-rich-b.css:131-216` for the live admin-row sizes.

---

## 11. Motion Tokens (every reference verified live)

All from `motion.css:11-27`. Note from `motion.css:5-7`: motion tokens are
NOT in the Tailwind `@theme` block — consume via `var(--ease-*)` /
`var(--dur-*)` directly.

| Token | Value | Used in Doctor for |
|---|---|---|
| `--dur-fast` | 150ms | Row hover bg transition; row severity-stripe color transition on `doctor_event` update |
| `--dur-base` | 200ms | (reserved — not used in Phase 17) |
| `--dur-enter` | 280ms | Drawer open — but: **native `<dialog>` showModal() does not animate by default**, see § 11.1 |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | All transitions |
| `--ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | (reserved) |

### 11.1 Drawer open / close motion

The native `<dialog>` `showModal()` triggers backdrop fade automatically (the
`::backdrop` pseudo can transition). Phase 17 does **not** add a content
slide-in animation because:

1. `<dialog>` is centered (not slide-from-side); a slide animation would lie about its origin
2. v1.1 retraction was partially caused by motion regressions; restraint here is correct
3. `prefers-reduced-motion` already collapses durations to 0.01ms via `motion.css:40-50`

The backdrop blur transition is handled by the browser default + `dialog.glass::backdrop` CSS in `primitives.css:192-196` — no override.

### 11.2 Severity-stripe transition on `doctor_event` update

```css
.doctor-row {
  transition:
    background var(--dur-fast) var(--ease-out),
    border-left-color var(--dur-base) var(--ease-out);
}
```

Subtle, **not flashy** — the stripe color crossfades over 200ms when severity
changes. No flash, no pulse, no scale. CONTEXT.md "Specifics" calls this out:
"never flashy."

### 11.3 Reduced motion

All motion tokens auto-collapse to 0.01ms under `prefers-reduced-motion: reduce`
via `motion.css:40-49`. Phase 17 inherits this without override. The
`.list-skeleton-row` shimmer also auto-disables (`primitives.css:215-217`).

---

## 12. Accessibility Contract

### 12.1 ARIA roles

| Element | Role / attr | Rationale |
|---|---|---|
| `.doctor-row-list` | implicit `<div>` (no role) | Children are buttons, not list items needing role=listbox |
| Each `.doctor-row` | `<button type="button">` | Row IS the action; button-not-listitem because keyboard semantic is "click to open dialog", not "select from a list" |
| `.doctor-row[data-severity]` | `aria-label` includes severity word | "Eval Scores, severity red, last changed 12 minutes ago" — color-blind users get severity in the label, not via stripe alone (DOCTOR-08 + WCAG 1.4.1) |
| Severity badge | `<span role="status">` with text content | Screen readers read "RED" / "GREEN" — color is redundant signal, not the only signal |
| Drawer | inherits `Dialog` primitive (`aria-modal="true"` + browser focus trap) | `Dialog.tsx:79-87` already wires ARIA |
| Drawer raw-payload `<pre>` | `aria-label="Raw payload JSON"` | otherwise screen reader reads JSON character-by-character |
| Page-level "Re-run all checks" `<Button>` | `aria-busy="true"` while in flight | live region updates announce completion |

### 12.2 Keyboard map

| Key | Context | Action |
|---|---|---|
| `Tab` | inside Doctor pane | Walks tab pill → "Re-run all checks" button → row 1 → row 2 → ... → row 5 (in DOM order) |
| `Shift+Tab` | reverse | walks back |
| `Enter` / `Space` | focused row | Opens drawer (button-default semantics) |
| `Esc` | drawer open | Closes drawer (native `<dialog>` behavior) |
| `Tab` | drawer open | Cycles within drawer (browser focus trap) |
| `Enter` | "Close" / "Re-check this signal" buttons in drawer | Activates button |

**No** custom Up/Down arrow row navigation. Reasons: (1) BLADE's other admin
lists use Tab — matching their pattern is more consistent than inventing
arrow nav for one pane; (2) listbox semantics (which justify arrow nav) imply
a single selection model that doesn't fit "click to open modal"; (3)
implementation risk is non-zero and v1.1 retraction makes us conservative
about new keyboard surfaces.

### 12.3 Focus management

- On row click → drawer opens → focus moves to first interactive element
  inside drawer (the close button in header — `Dialog.tsx:64-67` does this
  natively)
- On drawer close → focus restored to the triggering row via `triggerRef`
  prop pattern (see `Dialog.tsx:73-75`)
- Phase 17 must pass the row's `<button>` ref via `Dialog`'s `triggerRef`
  prop — explicit requirement so focus doesn't fall to the tab pill

### 12.4 Color contrast (WCAG)

The `verify:contrast` CI script (per CLAUDE.md "verify:all" chain) runs
against rendered surfaces. All severity tokens chosen above already pass
WCAG AA 4.5:1 against the dark glass admin surface — they're the same tokens
`.security-hero[data-status]` and `.admin-card[data-status]` already use,
which were audited in Plan 09 (`audit-contrast.mjs`, see `tokens.css:38`
comment).

**Verification at completion:** `/blade-uat` will screenshot the Doctor pane
in all 4 severity states and run the contrast script against each. If
contrast fails, planner must rebind to `--a-warm` text-on-bg variant; do not
introduce new tokens.

### 12.5 Screen-reader semantics for severity (color-not-only)

`aria-label` on the row interleaves severity text BEFORE timestamp. Example:

```html
<button
  class="doctor-row"
  data-severity="red"
  aria-label="Eval Scores. Severity red. Last changed 12 minutes ago. Press Enter to view details."
>
```

This satisfies WCAG 1.4.1 Use of Color: severity is conveyed through text
content (badge text + aria-label) AND color, never color alone.

---

## 13. Responsive Contract

CLAUDE.md Verification Protocol mandates 1280×800 + 1100×700.

### 13.1 1280×800 (primary)

- Doctor pane is full-width inside `.diagnostics-layout`. Row min-height 56px, padding 12px / 16px. Drawer 720px max-width centered in viewport — leaves `(1280 − 720) / 2 = 280px` margin per side. ✓
- Tab strip: 7 pills fit on one line. Each pill ~50–80px wide; 7 × 70 + 6 × 4 = 514px. Strip is ~1200px usable. ✓

### 13.2 1100×700 (smaller / mandatory secondary)

- Drawer max-width: `min(720px, 1100 − 48) = 720px`. Margin `(1100 − 720) / 2 = 190px` per side. Still centered. ✓
- Drawer max-height: `min(80vh, 720px) = min(560, 720) = 560px`. Drawer body scrolls within if payload is large. ✓
- Tab strip wraps if needed via existing `.admin-tabs` flex behavior (no
  `flex-wrap` set — tabs may overflow horizontally; this is the existing
  Diagnostics behavior at 1100×700, Phase 17 does not change it. If overflow
  becomes a problem, the fix lives in a separate phase, not Phase 17.)

### 13.3 Below 1100px (out of scope but defensive)

Drawer max-width formula `min(720px, calc(100vw - var(--s-12)))` continues to
work at any width; at <800px the drawer becomes effectively viewport-bleed
minus 48px. No phone breakpoint — BLADE is desktop only.

### 13.4 Responsive behaviors NOT shipped

- Per-row collapse-to-icon (rejected — defeats the point of seeing severity at a glance)
- Drawer→full-screen mobile mode (rejected — BLADE is desktop only)
- Tab dropdown when count > N (rejected — Phase 17 does not modify the existing tab strip behavior)

---

## 14. Copy

### 14.1 Sub-tab label

**"Doctor"** — sentence case, single word, matches existing tab style.
Rationale: "Health" is taken by the existing tab; "Diagnostics" is the parent
route; "Doctor" is unambiguous and matches the Rust module name (`doctor.rs`
per DOCTOR-01).

### 14.2 Page-level copy

| Element | Copy |
|---|---|
| Section heading (`<h4>`) | `"Doctor"` (alone — no descriptor; the page is self-evident inside Diagnostics) |
| Section subheading / description | none — restraint over decoration (D-13) |
| Manual refresh button label | `"Re-run all checks"` |
| Manual refresh button label (in flight) | `"Re-checking…"` |
| Last-checked global meta | `"Last full check {relative-or-absolute}"` placed under section heading right-aligned |
| Empty / all-green summary row | `"All signals green — last checked {HH:MM:SS}"` |
| Skeleton state | (no copy — `<ListSkeleton>` is visual only) |
| Page-level error EmptyState label | `"Doctor unavailable"` |
| Page-level error EmptyState description | `"Could not run full check. Tauri command failed: {error}"` |
| Page-level error retry button | `"Retry"` |

### 14.3 Row copy

| Signal class | Display name |
|---|---|
| `EvalScores` | `"Eval Scores"` |
| `CapabilityGaps` | `"Capability Gaps"` |
| `TentacleHealth` | `"Tentacle Health"` |
| `ConfigDrift` | `"Config Drift"` |
| `AutoUpdate` | `"Auto-Update"` |

Rationale: title-case two-word names, hyphenated for "Auto-Update". Matches
Diagnostics tab labels' rhythm ("Deep scan", "Sysadmin").

### 14.4 Drawer header template

```
{Display name}                           [SEVERITY BADGE]   [✕]
last changed {relative time}
```

Examples:
- `Eval Scores                    [RED]    ✕`
- `last changed 12 minutes ago`

Drawer section labels (uppercase, 11px, 600 weight, letter-spacing 0.04em):
- `"SUGGESTED FIX"`
- `"RAW PAYLOAD"`

Drawer footer button labels:
- `"Re-check this signal"` (left, ghost variant)
- `"Close"` (right, secondary variant)

---

## 15. Suggested-Fix Copy Table — 15 strings (5 classes × 3 severities)

**Locked by D-18: handwritten, not AI-generated.** Planner uses these
verbatim in the `match (class, severity) -> &'static str` table inside
`doctor.rs`. User may revise the strings; agents may not.

### Format conventions
- Sentence case, full sentences (not fragments)
- Action-oriented — first sentence describes the state, second tells the user what to do
- ≤ 200 chars per string (reads in one glance in the drawer)
- Backtick-quote actual file paths and command strings — these render as code in the drawer once a future polish phase wires markdown; until then they're plain text and still readable
- No em-dashes (BLADE drawer rendering uses CSS hyphens: none; em-dashes break the line cleanly but read worse than periods)

### Eval Scores

| Severity | Copy |
|---|---|
| Green | `"All eval modules are passing their asserted floors. Last 5 runs recorded in tests/evals/history.jsonl."` |
| Amber | `"An eval module's score dropped 10% or more from its prior run, but it's still above the asserted floor. Run bash scripts/verify-eval.sh to see which one and re-baseline if the change is intentional."` |
| Red | `"An eval module breached its asserted floor (top-3 below 80% or MRR below 0.6). Run bash scripts/verify-eval.sh to identify which module and inspect tests/evals/history.jsonl for the drop point."` |

### Capability Gaps

| Severity | Copy |
|---|---|
| Green | `"No unresolved capability gaps in the last 24 hours. Catalog is at src-tauri/src/self_upgrade.rs::capability_catalog."` |
| Amber | `"At least one unresolved capability gap was logged in the last 24 hours. Open the payload to see which capability and when."` |
| Red | `"The same capability has been requested 3 or more times in the last 7 days without resolution. This is a strong signal you need to add or re-route a tool. Check evolution.rs::evolution_log_capability_gap output and consider extending capability_catalog."` |

### Tentacle Health

| Severity | Copy |
|---|---|
| Green | `"All tentacle observers are reporting heartbeats within their expected interval."` |
| Amber | `"At least one observer's heartbeat is more than 1 hour stale. Check src-tauri/src/integration_bridge.rs logs for the affected service and confirm credentials are still valid."` |
| Red | `"At least one observer has been silent for over 24 hours and is treated as dead. Inspect supervisor health on the Health tab and restart the affected tentacle from there."` |

### Config Drift

| Severity | Copy |
|---|---|
| Green | `"Migration ledger is in sync and your scan profile is current."` |
| Amber | `"Either the migration ledger is out of sync OR the scan profile is older than 30 days. Run npm run verify:migration-ledger to identify which."` |
| Red | `"Both the migration ledger is out of sync AND the scan profile is older than 30 days. Run npm run verify:migration-ledger and trigger a Deep scan from the Deep scan tab to refresh."` |

### Auto-Update

| Severity | Copy |
|---|---|
| Green | `"tauri-plugin-updater is wired and initialized. BLADE will check for updates on launch."` |
| Amber | `"tauri-plugin-updater is not fully wired. Confirm src-tauri/Cargo.toml lists the dep AND src-tauri/src/lib.rs initializes via tauri_plugin_updater::Builder::new().build()."` |
| Red | `"(Reserved — Auto-Update has no Red tier per D-09; if this string ever renders it indicates a bug in doctor.rs severity classification.)"` |

The Red Auto-Update string is intentionally a "shouldn't happen" sentinel —
per D-09 Auto-Update only flips Green ↔ Amber. Including the string keeps
the `match` table exhaustive and gives a clear breadcrumb if classification
ever miscompiles.

---

## 16. Token Gaps

**None.** Every visual need for Phase 17 was satisfied by an existing live
token from `tokens.css`, `motion.css`, `typography.css`, `primitives.css`,
`admin.css`, `admin-rich-b.css`, or `activity-log.css`.

The closest call was the **error-tier severity stripe** (§ 7.3). I selected
`var(--t-4)` (32% white) over inventing a `--severity-error-stripe` token —
`--t-4` is already in the BLADE contract, reads as "neutral / dimmed", and
visually distinguishes from the 3 chromatic severity tokens. No new token
required.

The `.doctor-row` / `.doctor-drawer-*` classnames in this spec are NEW class
*names* but they are **aliases composing existing tokens** — no new CSS
custom properties are introduced. Planner will add them to a new
`src/features/admin/admin-rich-c.css` partial (per `admin.css:5` extension
rule: "Plans 07-05 and 07-06 EXTEND this file via scoped partial CSS files
(admin-rich-a.css, admin-rich-b.css); never replace.").

---

## 17. Verification List — `/blade-uat` checklist

Phase 17 has UI surface; per CLAUDE.md Verification Protocol the following
runtime checks are mandatory before VERIFICATION.md can claim PASS:

- [ ] Dev server runs cleanly: `npm run tauri dev`, no Rust compile error, no
      runtime panic in first 10s
- [ ] Doctor sub-tab is reachable from Diagnostics route (click "Doctor" pill)
- [ ] All 5 signal-class rows render in correct order (Eval → Gaps → Tentacles →
      Drift → AutoUpdate) on a fresh install
- [ ] Severity stripe color matches `data-severity` attribute (4 stripes
      visible across the 5 rows; AutoUpdate Green confirms the live tauri-plugin-updater
      check fires, not hardcoded)
- [ ] Click each row → drawer opens centered, payload renders as formatted
      JSON, suggested-fix copy matches § 15 verbatim
- [ ] Esc closes drawer; focus returns to triggering row
- [ ] Manual "Re-run all checks" button: button text changes to "Re-checking…"
      while in flight, returns to "Re-run all checks" on completion
- [ ] Artificially fail an eval (per ROADMAP SC-3): EvalScores row flips to
      Red live without page reload (validates `doctor_event` Tauri push +
      frontend `listen()` subscription)
- [ ] Screenshot at **1280×800** saved to `docs/testing ss/17-doctor-1280.png`
      (note literal space in path)
- [ ] Screenshot at **1100×700** saved to `docs/testing ss/17-doctor-1100.png`
- [ ] Screenshot of drawer-open state at 1280×800 saved to `docs/testing ss/17-doctor-drawer-1280.png`
- [ ] Screenshot of drawer-open state at 1100×700 saved to `docs/testing ss/17-doctor-drawer-1100.png`
- [ ] Both screenshots Read back by the agent + cited in
      VERIFICATION.md with a one-line observation each (per CLAUDE.md
      "Screenshot read back" rule)
- [ ] `verify:contrast` script PASS for all 4 severity stripes against the
      Diagnostics surface bg
- [ ] `npx tsc --noEmit` clean (new tab type literal added)
- [ ] `cd src-tauri && cargo check` clean (3 new commands registered, no
      flat-namespace clash)
- [ ] Keyboard walk: Tab from page-level button cycles through all 5 rows in
      DOM order; Enter on focused row opens drawer; Esc closes; focus returns
      to row
- [ ] ActivityStrip emission test: trigger a Red regression → "[Doctor]
      EvalScores → Red: …" line appears in ActivityStrip per D-21 / M-07

---

## Checker Sign-Off (gsd-ui-checker)

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: not applicable (no shadcn / no third-party registry)

**Approval:** pending (gsd-ui-checker run required)

---

*UI-SPEC drafted 2026-04-30. Token audit grep-verified live against the 7
canonical files listed in frontmatter. Zero ghost tokens, zero new fonts,
zero new icon assets, zero new CSS custom properties — every visual decision
composes existing BLADE substrate. The only NEW classnames are
`.doctor-row[data-severity]`, `.doctor-row-name`, `.doctor-row-meta`,
`.doctor-row-chevron`, `.doctor-row--summary`, `.doctor-drawer.dialog`,
`.doctor-drawer-header`, `.doctor-drawer-title`, `.doctor-drawer-meta`,
`.doctor-drawer-close`, `.doctor-drawer-body`, `.doctor-drawer-section-label`,
`.doctor-drawer-fix-copy`, `.doctor-drawer-payload-pre`,
`.doctor-drawer-footer` — all aliases composing existing tokens, to be added
in a new `admin-rich-c.css` partial per the admin.css extension rule.*
