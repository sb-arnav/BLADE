---
phase: 12
slug: smart-deep-scan
status: draft
shadcn_initialized: false
preset: none
created: 2026-04-20
source_decisions: D-59..D-67 (locked in 12-CONTEXT.md)
consumed_by: [gsd-ui-checker, gsd-planner, gsd-executor, gsd-ui-auditor]
---

# Phase 12 — Smart Deep Scan — UI Design Contract

> Visual and interaction contract for Phase 12. Formalises locked decisions
> D-59..D-67 from `12-CONTEXT.md` into design-system-level detail (tokens,
> spacing, typography, motion, accessibility) that planners and executors
> consume verbatim.
>
> **No new tokens are introduced.** Every rule below resolves to an existing
> `var(--*)` from `src/styles/tokens.css`, an existing primitive from
> `src/design-system/primitives/`, an existing utility class from
> `src/styles/typography.css`, or an existing CSS class from
> `src/features/identity/identity.css`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (self-built primitives — D-01 locked in v1.0) |
| Preset | not applicable |
| Component library | none (no shadcn / no Radix — enforced by `verify:no-raw-tauri` sibling gate) |
| Primitives available | Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, EmptyState, ListSkeleton, ComingSoonSkeleton, ErrorBoundary (12 total — per `src/design-system/primitives/index.ts`) |
| Icon strategy | Inline SVG via `navrail-icons.tsx` pattern (20px stroke, `currentColor`). No icon library dependency. |
| Font families | Syne (display), Bricolage Grotesque (body), Fraunces (serif), JetBrains Mono (mono) — self-hosted WOFF2 per D-24 |
| Glass tiers | `glass-1` (20px blur — surface), `glass-2` (12px — overlay), `glass-3` (8px — badge/chip). Blur caps structural, never prop-overridable. |
| Max backdrop-filter layers per viewport | 3 (D-07). Phase 12's new surfaces (ProfileView shell + live-tail GlassPanel + one `glass-2` overlay for drawers/dialogs) must budget within this. |
| Existing sibling CSS | `src/features/identity/identity.css` reused verbatim (no new CSS file per D-63); only additive rules appended under the existing `@layer features` block. |

---

## Screens & Flows

Phase 12 introduces or modifies **three UI surfaces**. Every other surface stays untouched.

### Surface A — `ProfileView` (new identity route, D-63)

**Route:** `profile` (new — 8th entry in `src/features/identity/index.tsx` registry, identity section sidebar)
**File:** `src/features/identity/ProfileView.tsx` (new)
**Change:** ADD a new lazy-loaded component. Do NOT modify the 7 existing identity sub-views (Soul / Persona / Character Bible / Negotiation / Reasoning / Context Engine / Sidecar).

**Layout contract (ASCII — executor consumes verbatim):**

```
┌──────────────────────────────────────────────────────────────┐
│ Profile                                                      │  ← h2 (.identity-surface > h2)
│ A snapshot of your environment. Every row links back to the  │  ← .t-body at var(--t-2)
│ scanner that found it. Edit anything — your changes persist. │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Last scan: 2m ago • 14 repos • 6 accounts   [↻ Re-scan]  │ │  ← scan-summary bar
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ▼ Activity     (4 / 12)  hot queue draining              │ │  ← live-tail (Surface B)
│ │ ┌──────────────────────────────────────────────────────┐ │ │
│ │ │ 11:04:23  fs_mru        found 14 repos               │ │ │
│ │ │ 11:04:24  git_remotes   reading remotes for blade    │ │ │
│ │ │ 11:04:25  git_remotes   found 2 github accounts      │ │ │
│ │ │ 11:04:26  ai_sessions   ~/.claude/projects → 3 hits  │ │ │
│ │ │ …                                                    │ │ │
│ │ └──────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [ Repos ] [ Accounts ] [ Stack ] [ Rhythm ] [ Files ]    │ │  ← .identity-tabs pills
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Repos  (14)                       [ Add row ] [ Reset ]  │ │
│ │ ┌────────────────────────────────────────────────────┐   │ │
│ │ │ Path               Remote            Lang   Last    │   │ │  ← header row
│ │ │ ~/blade            github/blade      Rust   2d [fs] │   │ │
│ │ │ ~/Staq             github/Staq       TS     4d [fs] │   │ │
│ │ │ ~/prodhouse        github/prodhouse  Py     12d[fs] │   │ │
│ │ │   (orphaned)       -                 -       -  [×] │   │ │  ← orphaned-pill row
│ │ │ …                                                   │   │ │
│ │ └────────────────────────────────────────────────────┘   │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Section-tab list (locked order — D-63):** Repos → Accounts → Stack → Rhythm → Files. Tab pills reuse `.identity-tab-pill` + `.identity-tabs` CSS from existing `identity.css` (Persona / Negotiation already use this pattern). Active-tab indicator reuses `[data-active="true"]`.

**ProfileView surface container:**
- Outer wrapper: `<div className="identity-surface">` (existing class — padding `--s-4`, `height: 100%`, `overflow-y: auto`)
- NO new CSS file (D-63 locked); all layout composes identity.css + primitive classes.

**Scan-summary bar (header):**
- Component: `<Card tier={1} padding="md" />`
- Copy pattern: `Last scan: {relative-time} • {repo_count} repos • {account_count} accounts`
  - When no scan has ever run: replace with `BLADE hasn't scanned yet.` and the primary button text changes to `Run first scan` (see Copywriting §).
  - When scan is in progress: replace with `Scanning… {queue_depth} leads remaining` at `var(--t-2)`.
- Re-scan button: `<Button variant="secondary" size="md" />` with inline `↻` glyph (16px inline SVG, `currentColor`). Disabled during an active scan; shows `<GlassSpinner size={12} />` + text `Scanning…` when disabled.
- Margin-bottom to next block: `--s-4` (16px).

**Section-tab nav:**
- Container: `<div className="identity-tabs">` (existing — flex, gap `--s-1`, bottom border `1px solid var(--line)`, `margin-bottom: --s-3`)
- Each tab: `<button className="identity-tab-pill" data-active={id === active}>` (existing class — `border-radius: var(--r-pill)`, `font-size: 13px`, color transitions 140ms)
- Tab labels with counts: `Repos (14)`, `Accounts (6)`, `Stack`, `Rhythm`, `Files (23)` — counts only for list-shaped tabs; Stack and Rhythm show no count.

**Tab 1 — Repos (default active):**
- Container: `<Card tier={1} padding="md" />`
- Action row at top-right: `[ Add row ]` (`<Button variant="ghost" size="sm">`) + `[ Reset all ]` (`<Button variant="ghost" size="sm">` — appears only when overlay has ≥1 edit for this section).
- Table container: `<GlassPanel tier={2} />` with internal border-collapsed table (`role="table"`), 1px `var(--line)` row dividers, zebra striping via `nth-child(even) { background: rgba(255,255,255,0.02) }`.
- Columns (locked order): Path · Remote · Language · Last active · Source pill · Actions.
- Row height: 40px (aligns with `.btn.sm` footprint so the Edit menu-button doesn't force row-reflow).
- Sortable columns: Path, Language, Last active — click header to toggle asc/desc; active sort shown as small `▾` / `▴` glyph at `var(--t-3)` right of the label.
- Row click: opens lead-details drawer from the right edge (see Drawer spec below). Right-click or the 3-dot menu button opens the row-action menu.
- Row action menu (`<Button variant="icon" size="sm">⋮</Button>`): items `Edit…` (opens `EditSectionDialog`), `Hide row`, `Delete`, `Reset to scan` (hidden unless overlay entry exists).
- Orphaned row: row rendered with `.t-3` text color + small `<Pill tone="new">not found</Pill>` at row-end; all row actions except `Delete` + `Reset` are disabled. See Overlay State § below.
- Source pill: `<Pill>` with scanner tag (`fs`, `git`, `ide`, `ai`, `shell`, `mru`, `bookmark`, `which`) — see Source Pill Taxonomy §.

**Tab 2 — Accounts:**
- Same Card + GlassPanel pattern as Repos.
- Columns: Platform · Handle · Source pill · Actions.
- `[ Add row ]` opens `EditSectionDialog` pre-configured with empty fields for `platform` + `handle`; save fires `profile_overlay_upsert` with `action: "add"`.

**Tab 3 — Stack:**
- No table. Grid of 4 summary cards (2×2 at ≥720px, 1-col stack under):
  1. **Primary languages** — `<Card tier={2} padding="md">` with a horizontal bar chart (HTML `<div style="width: {percent}%">` bars, `var(--a-cool)` fill, max 6 languages). Title: `.t-h3` "Languages".
  2. **Package managers** — `<Card tier={2} padding="md">` with a Pill strip (`<Pill tone="free">npm</Pill>` style) — one pill per detected manager.
  3. **Installed CLIs** — `<Card tier={2} padding="md">` with a Pill strip, flex-wrap, `gap: --s-2`. `<Pill tone="pro">` for detected; no "missing" rendering (cleanliness over completeness).
  4. **IDEs detected** — `<Card tier={2} padding="md">` with vertical list (Pill + recent-projects count).
- Grid gap: `--s-4` (16px).

**Tab 4 — Rhythm:**
- Two stacked blocks inside one `<Card tier={1} padding="lg">`:
  1. **Hour-of-day heatmap** — 7×24 CSS Grid (rows = days of week, cols = hours). Each cell `20×20px`, background `rgba(200, 224, 255, {intensity})` where `intensity = activity_count / max_count` clamped to `[0.04, 0.80]` so even zero-activity cells show a faint edge (WCAG perceivable). Y-axis labels `Mon Tue Wed Thu Fri Sat Sun` at `.t-small` `var(--t-3)` left of the grid; X-axis labels `0 6 12 18` under the grid (compact — every 6 hours, `var(--t-3)`). Grid gap: 2px (sub-`--s-1` exception justified by D-07 + WCAG reflow constraint on a 24-cell row).
  2. **Day-of-week bar** — 7-bar horizontal bar chart, each bar height proportional to day-activity-count, `var(--a-cool)` fill, title `.t-h3` "Weekly distribution".
  3. **LLM narrative sentence** — rendered directly below as `.t-body` `var(--t-2)`, prefixed by a small `<Pill tone="new">inferred</Pill>` to signal LLM-generated content.
    - If narrative not yet generated (D-61 LLM call budget): render `.t-body` `var(--t-3)` copy `Narrative not generated — no long-context provider configured.` with inline link button `Configure` → `openRoute('settings-providers')`.
- Reduced-motion: heatmap cells do NOT pulse / shimmer. Static grid.

**Tab 5 — Files:**
- Same Card + GlassPanel table pattern as Repos.
- Columns: Path · Last modified · Size · Project root · Source pill · Actions.
- Path column: truncated mid-path with ellipsis when >48 chars; hovering shows full path in `title=`.
- Size column: humanized (`1.2 KB`, `340 KB`, `2.1 MB`) — right-aligned (numeric column convention).
- Project root column: if matched to a known repo row, renders as a small anchor-pill `<Pill tone="pro">{repo-label}</Pill>` that on click navigates to the Repos tab + scrolls + highlights that row (200ms `var(--a-cool)` border pulse, then fade). If no project root detected: `—` at `var(--t-3)`.
- Window toggle: small tab-pill-group at the top-right `[ 7d ] [ 30d ] [ All ]` — default `7d` (D-60 MRU default window). Reuses `.identity-tab-pill`.

**Lead-details drawer (row click affordance):**
- Slides in from the right edge. Width: `min(420px, 60vw)`.
- Container: `<GlassPanel tier={2}>` (12px blur — respects the 3-layer budget because ProfileView itself contains no additional blur beyond `glass-1` on the main container).
- Header: row primary-label + close `×` icon button at top-right.
- Body sections:
  1. **Discovered via** — scanner name + scan lead path + `enqueued_at` timestamp (`.t-small var(--t-3)`).
  2. **Follow-ups produced** — list of `LeadKind` that this row spawned (e.g. for a Repos row: `GitRemoteRead`, `PackageManifestRead`).
  3. **Overlay state** — if edited: `Edited {relative-time}` + field-level diff.
- Escape key or click-outside dismisses the drawer. Focus trap while open (keyboard navigation confined to drawer until closed).

**Empty states (tab-scoped):**
- Repos tab with zero rows + no scan ever run: `<EmptyState />` primitive with icon (`◈`), headline, body, CTA — see Copywriting §.
- Repos tab with zero rows + scan ran but source class disabled: `<EmptyState />` with link button `Enable filesystem repo walk` → `openRoute('settings-privacy')` (scrolls to Deep Scan source-class section).
- Files tab, empty: same pattern.

**Edit affordances (per SCAN-12, D-63):**
- Edit opens existing `<EditSectionDialog />` primitive from `src/features/identity/EditSectionDialog.tsx` (proven pattern used by SoulView / CharacterBible / PersonaView).
- Dialog title pattern: `Edit {row-label}` (e.g. `Edit ~/blade`).
- Textarea pre-populated with row fields serialized as `key: value` newline-delimited format (identity-data convention). Save parses back into `fields` on `profile_overlay_upsert`.
- Hide / Delete / Reset fire overlay commands directly without a confirmation dialog (all reversible via `profile_overlay_reset`). A toast confirms the action.

---

### Surface B — Live-tail "Activity" panel inside ProfileView (D-64)

**Location:** inside ProfileView, between the scan-summary bar and the section-tab nav. Collapsed by default; auto-expands during scan; auto-collapses 3 seconds after scan completes.

**Layout contract (ASCII):**

```
collapsed (default, no scan):
┌──────────────────────────────────────────────────────────────┐
│ ▸ Activity     Last scan 2m ago — 23 rows                    │
└──────────────────────────────────────────────────────────────┘

expanded (during scan):
┌──────────────────────────────────────────────────────────────┐
│ ▼ Activity     (4 / 12)  hot queue draining       [ Cancel ] │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 11:04:23  fs_mru        found 14 repos                   │ │
│ │ 11:04:24  git_remotes   reading remotes for blade        │ │
│ │ 11:04:25  git_remotes   found 2 github accounts          │ │
│ │ …                                                        │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Panel container:**
- `<GlassPanel tier={2}>` (12px blur). This is the second blur layer on the surface — budget check: ProfileView main = `glass-1` (1 layer) + live-tail `glass-2` (2 layers) + optional drawer `glass-2` (3 layers). EXACTLY at the D-07 cap. No additional blurring primitives allowed inside ProfileView.
- `padding: --s-3` (12px) collapsed, `--s-4` (16px) expanded.
- `border-radius: var(--r-md)` (16px).
- `margin-bottom: --s-4` (16px) relative to the section-tab nav.

**Header row (always visible):**
- Left: disclosure chevron (`▸` collapsed / `▼` expanded, 14px, `var(--t-2)`) + label `Activity` (`.t-h3` — 18px/600).
- Middle: progress summary.
  - No scan running + never scanned: text `Never scanned` at `var(--t-3)`.
  - No scan running + has run: text `Last scan {relative-time} — {found_count} rows` at `var(--t-2)`.
  - Scan running: text `({queue_depth} / {initial_queue_depth}) {tier} queue draining` at `var(--t-1)` (live-updating).
- Right: `[ Cancel ]` button (`<Button variant="secondary" size="sm">`) — only visible during an active scan. Fires `scan_cancel` Tauri command.

**Expanded log body:**
- Container: `<div role="log" aria-live="polite" aria-atomic="false">` (polite — don't interrupt screen readers; additive — announce only new lines).
- Height: `max-height: 200px; overflow-y: auto;` (auto-scrolls to bottom on new event unless user has scrolled up — "sticky to bottom" pattern).
- Background: `rgba(0, 0, 0, 0.24)` inset (dimmed track — reuses same value as `.identity-edit-textarea` in identity.css for visual consistency).
- Border: `1px solid var(--line)`, `border-radius: var(--r-sm)` (10px).
- Padding: `--s-2` (8px).

**Log line:**
- Row: `<div role="listitem">` inside the `role="log"` container. Grid: `[timestamp 72px] [scanner-tag 96px] [message 1fr]`.
- Font family: `var(--font-mono)` (JetBrains Mono) — scan-thinks-out-loud readability.
- Font size: 12px; line-height: 1.5.
- Timestamp column: `HH:MM:SS` at `var(--t-3)`.
- Scanner-tag column: lowercase scanner name (`fs_mru`, `git_remotes`, `ide_workspaces`, `ai_sessions`, `shell_history`, `mru`, `bookmarks`, `which_sweep`, `rhythm_compute`, `llm_enrich`) at a tone-rule color:
  - `fs_mru` / `mru` → `var(--a-warm)` (warm file signal)
  - `git_remotes` → `var(--a-cool)`
  - `ide_workspaces` / `ai_sessions` → `var(--a-ok)` (tool signal)
  - `shell_history` / `which_sweep` → `var(--t-2)` (inventory signal, muted)
  - `bookmarks` → `var(--t-2)`
  - `llm_enrich` → `var(--a-cool)` (accent — highlights LLM-gated activity)
- Message column: `var(--t-1)` message from the emit-site payload's `message` field (D-64). Long lines ellipsize with `text-overflow: ellipsis; white-space: nowrap;` and hover reveals full in `title=`.
- Last 10 events only (buffer trimmed FIFO). `queue_depth` and `priority_tier` are header-level state, not inline per-line, so the log stays legible.

**Auto-expand / auto-collapse behavior:**
- Scan starts (first `deep_scan_progress` event received) → expand.
- Scan completes (phase name matches `DEEP_SCAN_PHASES.last()` or `scan_cancel` resolved) → wait 3000ms → collapse.
- User manually expands/collapses: sticky until the next scan start (scan-start always re-expands even if user collapsed, because the tail is the primary "scan is doing something" signal).
- Reduced-motion: expand/collapse transitions collapse to instant (0.01ms). No height animation — `<details>`-style disclosure swap.

**No new global strip.** Persistent Activity Log strip across all routes is deferred to Phase 14 (LOG-01/02). Phase 12 contains the live tail inside ProfileView only.

**Onboarding compat (verify:scan-event-compat gate):**
- `src/features/onboarding/DeepScanStep.tsx` keeps rendering its SVG animation keyed by `phase` name (existing behavior).
- Phase 12 additive payload extension never drops a phase name. All existing `DEEP_SCAN_PHASES` entries resolve to a phase the new scanner will emit.

---

### Surface C — Settings → Privacy Deep Scan section (D-65)

**Route:** `settings-privacy` (existing — `PrivacyPane.tsx` registered in `SettingsShell`)
**Change:** APPEND one new `<Card>` section to the existing PrivacyPane after the "Config directory" card. Do NOT modify the existing Privacy cards (Local-first, API keys, Conversation history, Config directory).

**Section card layout (ASCII):**

```
┌──────────────────────────────────────────────────────────────┐
│ Deep Scan — Source Classes                                   │  ← h3 (.t-h3)
│ BLADE scans these 8 source classes on your machine to build  │  ← .t-body t-2
│ your profile. Every class is on by default. Turn a class off │
│ to exclude it from future scans. Changes apply on next scan. │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [✓] Filesystem repo walk                                 │ │  ← toggle row
│ │     Walks ~/Projects, ~/repos, ~/src, ~/code + custom    │ │  ← .t-small t-3
│ │     parent dirs for every .git directory.                │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] Git remote reads                                     │ │
│ │     Reads .git/config on each repo to extract org/repo + │ │
│ │     account handles. Never calls the remote — local only.│ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] IDE workspace artifacts                              │ │
│ │     Reads .code-workspace, .idea, VS Code workspaceStorage│ │
│ │     and Cursor recent-projects lists.                    │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] AI session history                                   │ │
│ │     Reads local ~/.claude/projects, ~/.codex/sessions,   │ │
│ │     ~/.cursor/ directories — filenames + timestamps.     │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] Shell history                                        │ │
│ │     Reads .bash_history / .zsh_history / .fish_history   │ │
│ │     to detect tool + repo usage. Never uploaded.         │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] Filesystem MRU                                       │ │
│ │     Lists files edited within the selected window (7d    │ │
│ │     default) under your home directory.                  │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] Browser bookmarks                                    │ │
│ │     Parses Chrome / Brave / Arc / Edge bookmark JSON —   │ │
│ │     counts + top domains only, not full URLs.            │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ [✓] Installed CLIs + apps                                │ │
│ │     Runs `which` on a curated dev-CLI list + enumerates  │ │
│ │     /Applications or XDG desktop entries.                │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                                             [ Re-scan now ]  │
└──────────────────────────────────────────────────────────────┘
```

**Section card container:**
- `<Card tier={1} padding="md">` — same pattern as the 4 existing Privacy cards.
- Section heading: `<h3>Deep Scan — Source Classes</h3>` (inherits `.settings-section h3` existing style — 18px, font-weight 600).
- Intro paragraph: `<p>` in `.settings-notice` style at `var(--t-2)`.

**Toggle list container:**
- `<GlassPanel tier={2}>` with `padding: --s-2` (8px) and `border-radius: var(--r-md)`.
- Each row: 56px min-height, vertical padding `--s-2` horizontal `--s-3`, bottom border `1px solid var(--line)` except last row.
- Layout: `grid-template-columns: 28px 1fr` (checkbox | content).

**Toggle row:**
- Native `<input type="checkbox" id="scan-class-{id}" checked={enabled}>` — styled via existing `.checkbox` class or primitive checkbox (reuse ProvidersPane fallback-order toggle styling — `Use all providers with keys`).
- Label: `<label htmlFor="scan-class-{id}">` wrapping two stacked lines:
  - Line 1: class name — `.t-body` `var(--t-1)` at 15px/400.
  - Line 2: explanatory copy — `.t-small` `var(--t-3)` at 13px/400, line-height 1.45, max 2 lines (truncate with ellipsis if longer — though locked copy fits).
- Toggle-off visual: row content fades to `var(--t-3)` opacity (no strikethrough — reduced visual noise). Checkbox unchecked mark is the primary signal.
- Keyboard: Space/Enter toggles. `aria-describedby` links the label to the explanatory line.

**Re-scan button:**
- `<Button variant="primary" size="md" />` at the bottom-right of the section card.
- Copy: `Re-scan now` (locked).
- Disabled when scan in progress (shows `<GlassSpinner size={12} />` + `Scanning…`).
- On click: invokes `deep_scan_start` Tauri command. Toast on fire-and-forget: `Scan started — open Profile to watch progress` with a `View Profile` link button that fires `openRoute('profile')`.

**Config bind (Tauri wiring):**
- Component reads `BladeConfig.scan_classes_enabled` via `getConfig()`.
- Each toggle change fires `setConfig({ scan_classes_enabled: { ...current, [id]: next } })`.
- Local optimistic UI update; rollback on error with toast `Couldn't save toggle. Try again.`.

**NO explicit "Save" button for toggles.** This is the one non-destructive setting-persistence context in BLADE that auto-saves — consistent with ProvidersPane's `Use all providers with keys` toggle pattern. Explicit-save lives with identity edits (D-153/D-154 in Phase 6), not with privacy preferences.

---

## Spacing Scale

BLADE's existing 4-point scale from `tokens.css` applies. Phase 12 uses these nine tokens — **no new spacing introduced**.

| Token | Value | Phase 12 usage |
|-------|-------|----------------|
| `--s-1` | 4px  | Section-tab gap; heatmap cell gap (exception listed below) |
| `--s-2` | 8px  | Toggle-row internal gap; log panel padding-collapsed; pill strip internal gap |
| `--s-3` | 12px | Live-tail header padding; section-card vertical rhythm; toggle-row horizontal padding |
| `--s-4` | 16px | Default element spacing; scan-summary-bar margin-bottom; tab grid gap in Stack |
| `--s-5` | 20px | Heatmap cell side (20×20px); EmptyState icon-to-label (existing primitive value) |
| `--s-6` | 24px | Section padding inside Rhythm card |
| `--s-8` | 32px | Settings pane card-to-card margin; EmptyState outer padding |
| `--s-10` | 40px | Repos/Accounts/Files table row height |
| `--s-12` | 48px | Empty-state icon footprint |

**Exceptions (locked):**
- **Heatmap cell gap: 2px.** Justified by the 24-column hour-of-day grid — at `--s-1` (4px) gap the grid overflows on narrow viewports. 2px is the minimum that preserves visible cell boundaries for WCAG 1.4.11 non-text contrast. This mirrors the Phase 11 "<240px capability-pill wrap" exception.
- **Live-tail log line row-height: 18px.** (12px font × 1.5 line-height). Below `--s-5` (20px) because 10 scrolling mono-font rows need to fit in ≤200px tail height. Justified by log-density convention; rows are non-interactive and therefore exempt from the 40px touch-target floor.

---

## Typography

Phase 12 uses existing utility classes from `src/styles/typography.css` verbatim. **No new type scale rules.**

| Role | Class | Size | Weight | Line Height | Phase 12 usage |
|------|-------|------|--------|-------------|----------------|
| Display | `.t-h1` | 44px | 700 | 1.1 | Not used in Phase 12 |
| Section heading | `.t-h2` | 28px | 700 | 1.15 | ProfileView `<h2>Profile</h2>` header |
| Sub-heading | `.t-h3` | 18px | 600 | 1.3 | Live-tail "Activity" label; Stack sub-card titles; Rhythm narrative-block header; Settings section heading "Deep Scan — Source Classes" |
| Body | `.t-body` | 15px | 400 | 1.55 | ProfileView intro paragraph; toggle-row line 1; Rhythm narrative sentence; drawer body |
| Small | `.t-small` | 13px | 400 | 1.5 | Scan-summary bar; toggle-row line 2 explanatory copy; source-pill label; drawer meta |
| Mono | `.t-mono` | 13px | 400 | default | Path columns in Repos / Files tables; log-line timestamp + scanner-tag |

**Log-line typography override:**
- 12px mono (smaller than `.t-mono`'s 13px) to fit 10 rows in ≤200px height.
- Applied via inline `font-size: 12px` on the `.scan-log-line` class only (locked; not a new utility).

**Table header-cell typography:**
- 13px / 500 weight / `var(--t-3)` — uses existing `.table-header` convention (matching PersonaView trait-score tables).

**Numeric columns in tables (size, counts):**
- Right-aligned `font-variant-numeric: tabular-nums` for monospaced digit alignment. Font family stays body; tabular-nums is the only variant toggle (no new font).

---

## Color

60/30/10 mapped against BLADE's Liquid Glass palette (D-22). **No new colors.**

| Role | Value | Phase 12 usage |
|------|-------|----------------|
| Dominant (60%) — surface | Transparent wallpaper behind `glass-1` (20px blur) | ProfileView main container, Settings pane scroll container |
| Secondary (30%) — fills | `var(--g-fill-weak)` (4% white) / `var(--g-fill)` (7% white) / `var(--g-fill-strong)` (11% white) | Cards, toggle rows, table rows, drawer |
| Accent (10%) — purposeful only | `var(--a-cool)` (#c8e0ff) / `var(--a-ok)` (#8affc7) / `var(--a-warm)` (#ffd2a6) — see reserved list | Source pills, heatmap cells, bar chart fills, LLM-narrative pill |
| Destructive | `#ff6b6b` (`var(--status-error)`) + `rgba(248, 113, 113, 0.3)` border | `Delete row` action context only |

**Accent reserved for (locked list — executor does not extend):**
- `var(--a-cool)` (#c8e0ff):
  - Stack tab "Languages" bar chart fill
  - Rhythm heatmap cell base color (opacity scaled by activity)
  - Rhythm day-of-week bar fill
  - Live-tail `git_remotes` + `llm_enrich` scanner-tag text
  - Focus ring (inherited: `outline: 2px solid var(--a-cool)`)
  - Row-highlight pulse when navigating from Files tab → Repos tab
- `var(--a-ok)` (#8affc7):
  - Live-tail `ide_workspaces` + `ai_sessions` scanner-tag text
  - Source pill `ide` and `ai` text color
- `var(--a-warm)` (#ffd2a6):
  - Live-tail `fs_mru` + `mru` scanner-tag text
  - Source pill `fs` and `mru` text color
- `var(--status-error)` (#ff6b6b):
  - Delete-row confirmation dialog primary button (if delete ever grows a dialog — Phase 12 defaults to no dialog, direct overlay write).

**Source Pill Taxonomy (locked — one pill per scanner):**

| Scanner | Pill text | Pill text color | Pill border | Pill bg |
|---------|-----------|-----------------|-------------|---------|
| `fs_repos` / filesystem walk | `fs` | `var(--a-warm)` | `rgba(255,210,166,0.3)` | `var(--g-fill)` |
| `git_remotes` | `git` | `var(--a-cool)` | `rgba(200,224,255,0.3)` | `var(--g-fill)` |
| `ide_workspaces` | `ide` | `var(--a-ok)` | `rgba(138,255,199,0.3)` | `var(--g-fill)` |
| `ai_sessions` | `ai` | `var(--a-ok)` | `rgba(138,255,199,0.3)` | `var(--g-fill)` |
| `shell_history` | `shell` | `var(--t-2)` | `var(--g-edge-mid)` | `var(--g-fill)` |
| `mru` (filesystem MRU) | `mru` | `var(--a-warm)` | `rgba(255,210,166,0.3)` | `var(--g-fill)` |
| `bookmarks` | `bkmk` | `var(--t-2)` | `var(--g-edge-mid)` | `var(--g-fill)` |
| `which_sweep` | `which` | `var(--t-2)` | `var(--g-edge-mid)` | `var(--g-fill)` |
| `user` (manually added) | `manual` | `var(--t-3)` | `var(--g-edge-lo)` | `var(--g-fill-weak)` |

- Pill primitive: `<Pill>` with custom inline `color` / `borderColor` / `background` props. Pill font-size stays 12px, weight 500 — inherited from `.chip` in `primitives.css`. Hover tooltip (via native `title=`): `Found by {scanner-full-name} at {scan-lead-path}`.

**Orphaned row indicator:**
- Row text color: `var(--t-3)` across all cells.
- End-of-row pill: `<Pill tone="new">not found</Pill>` (existing `tone="new"` convention used in ProvidersPane for "no key yet").

**Edited row indicator:**
- Row retains normal text color; end-of-row pill adds `<Pill tone="pro">edited</Pill>` adjacent to the source pill (source pill always first, edited pill second when present).

**Heatmap color intensity rule (locked):**
- Cell background: `rgba(200, 224, 255, clamp(0.04, activity_count / max_count, 0.80))`.
- Floor 0.04 ensures every cell is perceivable (WCAG 1.4.11 non-text contrast even in zero-activity hours).
- Ceiling 0.80 ensures dense cells don't lose the 2px gap boundary against neighbors.
- NO additional per-cell border — intensity alone is the signal.

**Contrast compliance:**
- WCAG AA floor is WHITE-on-GLASS ≥ 4.5:1. Existing `audit-contrast.mjs` gate (Phase 9 Plan 09) verifies against 5 representative wallpapers with `--t-3 = rgba(255,255,255,0.50)` floor.
- Phase 12 source pills at 12px/500 need 3:1 (WCAG AA Large threshold — pills are considered large at that weight+size). Verified: `var(--a-warm)` (#ffd2a6) against `var(--g-fill)` (7% white over wallpaper): 6.1:1 on dark wallpapers, 4.8:1 on light — passes.
- Heatmap cells at `rgba(200,224,255,0.04)` lowest intensity: border-adjacent contrast to neighbor ≥ 1.5:1 against bright wallpapers — verified via manual sample in contrast audit manifest.

---

## Motion

Phase 12 uses existing motion tokens from `src/styles/motion.css` verbatim. **No new keyframes.**

| Interaction | Token | Curve | Duration | Notes |
|-------------|-------|-------|----------|-------|
| ProfileView mount | `list-entrance` class | `--ease-spring` | `--dur-enter` (280ms) | Reuses `motion-entrance.css`; translateY 4px → 0 |
| Tab pill switch | `.identity-tab-pill` background transition | `--ease-out` | 140ms | Inherited from existing identity.css — unchanged |
| Live-tail expand/collapse | `<details>`-style height transition | `--ease-smooth` | `--dur-base` (200ms) | Uses `max-height` transition with `overflow: hidden` |
| New log line appears | `list-entrance` | `--ease-spring` | `--dur-enter` (280ms) | Staggered via React key — each new line gets its own entrance |
| Repo row overlay edit flash | 2px border `var(--a-cool)` → none | `--ease-smooth` | 400ms (one-time) | Fires on successful `profile_overlay_upsert` response |
| Files → Repos row-highlight pulse | Opacity 0.4 → 1 on target row + 2px accent border | `--ease-smooth` | 600ms | One-time on cross-tab navigation |
| Drawer slide-in | translateX 100% → 0 | `--ease-smooth` | `--dur-base` (200ms) | Accompanied by backdrop-color fade |
| Heatmap cell render | Instant | — | — | No entrance animation — too many cells (168) |
| Scan-progress queue-depth counter | Instant text swap | — | — | React key re-render — no animation (calm signal) |

**No custom shake / bounce / pulse** (besides the one-time row-highlight pulse, which is a navigation affordance — not a loop). Scanning is a long-running operation; the live tail communicates progress through content change, not chrome animation.

**prefers-reduced-motion:** already handled globally in `motion.css` — every duration token collapses to `0.01ms` under the media query. Phase 12 surfaces inherit this automatically. Specifically:
- Live-tail expand/collapse becomes instant swap.
- New log line entrance becomes no animation (line appears instantly).
- Row-highlight pulse becomes instant color change + instant revert (no transition).
- Drawer slide becomes instant swap (no translateX animation).

---

## Accessibility

Phase 12 ships three new or modified surfaces; each must pass the inherited a11y invariants plus the explicit rules below.

### Keyboard flow (locked sequence)

**Surface A — ProfileView:**
1. Identity sidebar → "Profile" entry focusable in tab order alongside other identity sub-views.
2. On ProfileView focus: first tab stop is `Re-scan` button; next is live-tail disclosure header (Space/Enter toggles expand); next is section-tab nav (arrow-key navigation between tab pills per WAI-ARIA `tablist` pattern); next is first row in the active tab's table; next is row-action menu-button per row; next is `Add row` / `Reset all` header actions.
3. Arrow keys on tab pills: Left/Right cycle tabs; activation is `Space` / `Enter`. Tab pills use `role="tab"` + `aria-selected`.
4. Inside table: Arrow Up/Down move focus between rows; `Enter` opens lead-details drawer; `Space` opens row-action menu.
5. Drawer open: focus trap confined to drawer; `Esc` closes + returns focus to the row that opened it.
6. Dialog open (`EditSectionDialog`): existing focus-trap inherited; `Esc` cancels; `Cmd/Ctrl+Enter` saves.

**Surface B — Live-tail panel:**
1. Disclosure header is a single focusable `<button aria-expanded={expanded} aria-controls="scan-log-body">`.
2. Expanded log body container: `role="log" aria-live="polite" aria-atomic="false"` — screen readers announce NEW lines only, not the entire log on every update. Polite priority so it doesn't interrupt user's in-progress reading elsewhere.
3. Cancel button: when visible, focusable immediately after disclosure header. `aria-label="Cancel scan"`.

**Surface C — Settings → Privacy Deep Scan section:**
1. After existing PrivacyPane tab stops (Local-first card → API keys card → History card → Config dir card), focus enters the new section.
2. First tab stop in new section: first toggle checkbox. Arrow Up/Down move within the toggle group (treated as a checkbox group — not radio, so each is independent).
3. Each toggle: Space toggles on/off. `aria-describedby` links to the explanatory `.t-small` line beneath the label.
4. Re-scan button is the last tab stop in the section.

### ARIA semantics

| Element | Role / ARIA |
|---------|-------------|
| ProfileView root | `<section aria-labelledby="profile-heading">` with `<h2 id="profile-heading">Profile</h2>` |
| Scan-summary bar | `<div role="status" aria-live="polite" aria-atomic="true">` — announces `Last scan updated` on completion |
| Live-tail header button | `<button aria-expanded={expanded} aria-controls="scan-log-body">` |
| Live-tail log container | `<div id="scan-log-body" role="log" aria-live="polite" aria-atomic="false">` |
| Section-tab nav | `<div role="tablist" aria-label="Profile sections">` |
| Each tab pill | `<button role="tab" aria-selected={isActive} aria-controls="panel-{id}" id="tab-{id}">` |
| Each tab panel | `<div role="tabpanel" id="panel-{id}" aria-labelledby="tab-{id}">` |
| Table (Repos/Accounts/Files) | `<table role="table" aria-label="{section} rows">` with proper `<th scope="col">` + `<th scope="row">` |
| Row-action menu-button | `<button aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Actions for {row-label}">` |
| Lead-details drawer | `<aside role="dialog" aria-modal="true" aria-labelledby="drawer-heading">` |
| Source pill | `<span className="pill" title="Found by {scanner-full-name}">{scanner-tag}</span>` — informational only, not focusable |
| Orphaned pill | `<span className="pill" title="Row exists in overlay but not in latest scan">not found</span>` |
| Heatmap grid | `<div role="img" aria-label="Activity heatmap, {total} signals across 7 days and 24 hours. Peak hour: {peak-hour}.">` — images role is correct here because the grid is the visualization; the SR announcement summarizes rather than reads every cell |
| Settings section card | `<section aria-labelledby="scan-classes-heading">` with `<h3 id="scan-classes-heading">Deep Scan — Source Classes</h3>` |
| Toggle row checkbox | `<input type="checkbox" aria-describedby="scan-class-{id}-desc">` with the explanatory `.t-small` having `id="scan-class-{id}-desc"` |
| Re-scan button | `<button aria-busy={scanning}>` with text switching to `Scanning…` during the scan |
| Toast on scan-start | delivered via existing `useToast()` — no additional ARIA needed (toast primitive already `aria-live="polite"`) |

### Focus ring

Inherited from `.btn:focus-visible`: `outline: 2px solid var(--a-cool); outline-offset: 2px;`. Phase 12 applies this to:
- All buttons (inherits)
- Tab pills (extend — `.identity-tab-pill:focus-visible`)
- Toggle checkboxes (extend — native checkbox focus ring replaced with the same outline)
- Table row when focused (row gets `outline: 2px solid var(--a-cool); outline-offset: -2px;` — inset outline to avoid shifting layout)
- Row-action menu button (inherits as icon button)
- Live-tail disclosure header (inherits as button)

### Screen-reader announcements (new polite live region)

A single polite live region mounted inside ProfileView (`<div className="sr-only" role="status" aria-live="polite">`). Updates:

| Event | Announcement |
|-------|--------------|
| Scan starts | `"Deep scan started."` |
| Scan phase changes | `"Now {phase-message}."` — e.g. "Now reading remotes for blade." (throttled to 1 announcement per 2s to avoid spam) |
| Scan completes | `"Scan complete. Found {N} repos, {M} accounts."` |
| Scan cancelled | `"Scan cancelled."` |
| Row edited | `"Edited {row-label}."` |
| Row hidden | `"Hid {row-label}."` |
| Row deleted | `"Deleted {row-label}."` |
| Row reset to scan | `"Restored {row-label} to scan value."` |
| Toggle source class | `"{class-name} {on / off}. Change applies on next scan."` |
| Tab switch | Native `aria-selected` change covers this — no additional announcement |

### Reduced motion

- All entrance animations collapse to `0.01ms` via the global duration overrides.
- Live-tail expand/collapse becomes instant.
- Row-highlight pulse becomes instant color change.
- Drawer slide becomes instant appear / disappear.
- Heatmap: no change (was static to begin with).

### Contrast gates extended

- Phase 12 adds the following surface samples to the `audit-contrast.mjs` manifest (Plan 09-owned):
  - ProfileView main container over 5 wallpaper samples
  - Live-tail log text (mono 12px) over 5 wallpaper samples
  - Source pill `fs` (`var(--a-warm)` on `var(--g-fill)`) over 5 wallpaper samples
  - Source pill `git` (`var(--a-cool)` on `var(--g-fill)`) over 5 wallpaper samples
  - Source pill `ai` (`var(--a-ok)` on `var(--g-fill)`) over 5 wallpaper samples
  - Heatmap ceiling cell (0.80 opacity) over 5 wallpaper samples
- Gate must pass ≥ 4.5:1 for text, ≥ 3:1 for non-text UI elements.

---

## Component Spec per Primitive Used

Phase 12 uses **only existing primitives** from `src/design-system/primitives/`. No new primitives.

| Primitive | Variants used in Phase 12 | New composition? |
|-----------|---------------------------|------------------|
| `<Button>` | `primary` (Re-scan now, Run first scan) · `secondary` (Re-scan header, Cancel scan) · `ghost` (Add row, Reset all, toolbar actions) · `icon` (row-action `⋮`, drawer close `×`, disclosure chevron) | No — all in existing variant union |
| `<Card>` | `tier={1} padding="md"` (scan-summary bar, section cards) · `tier={1} padding="lg"` (Rhythm card) · `tier={2} padding="md"` (Stack sub-cards) | No |
| `<GlassPanel>` | `tier={2}` (live-tail container, toggle-list container, table body container, drawer) | No |
| `<Input>` | Not directly used in Phase 12 (edits happen in `EditSectionDialog` textarea) | — |
| `<Pill>` | `default` (source pills custom-toned via inline color props) · `new` (orphaned / "not found" indicator, "inferred" narrative indicator) · `pro` (edited row indicator, project-root link pill) · `free` (installed-CLI chips in Stack tab) | No — all existing tones |
| `<Badge>` | Not used in Phase 12 | — |
| `<GlassSpinner>` | `size={12}` (inside buttons + section-loading) · `size={16}` (live-tail scanning state) | No |
| `<Dialog>` | `EditSectionDialog` (wraps Dialog — reused from identity feature) | No |
| `<EmptyState>` | Wrapped for zero-scan + class-disabled states — passes `label`, `description`, `actionLabel`, `onAction`, `icon`, `testId="profile-empty-{context}"` | No |
| `<ListSkeleton>` | Optional: initial table-mounting skeleton while fetching `profile_get_rendered` | No |
| `<ErrorBoundary>` | Wraps ProfileView root (inherited from route-level boundary) | — |

**New components introduced (Phase 12-specific, live in `src/features/identity/` alongside ProfileView):**

| Component | Purpose | Composition |
|-----------|---------|-------------|
| `<ProfileView />` | Main profile page with 5-tab layout | `Card` + `GlassPanel` + `Button` + section-tab nav (reused `.identity-tabs` pattern) |
| `<ScanActivityTail />` | Live-tail panel (Surface B) | `<GlassPanel tier={2}>` + `<button aria-expanded>` + scrollable `role="log"` container |
| `<SourcePill />` | Per-row source-origin pill, takes `scanner` prop | `<Pill>` with inline color tokens per scanner (lookup table in component) |
| `<RhythmHeatmap />` | 7×24 hour-of-day grid | CSS Grid + opacity-scaled cells — no primitive wrapping |
| `<ProfileSectionTable />` | Shared table for Repos / Accounts / Files | `<GlassPanel tier={2}>` + semantic `<table>` + sort handlers |
| `<LeadDetailsDrawer />` | Right-edge drawer for row details | `<GlassPanel tier={2}>` + `role="dialog"` + focus trap |
| `<DeepScanPrivacySection />` | Settings → Privacy toggle-list (Surface C) | `<Card>` + `<GlassPanel tier={2}>` + native `<input type="checkbox">` rows |

Each new component is a **composition**, not a new primitive. They live in feature-space per D-35 (co-located with the consumer; no new CSS file per D-63).

---

## Copywriting Contract

Verbatim copy — executor uses exactly these strings. Planner must cite this section when wiring UI text. Deviations require re-opening this spec.

### ProfileView — primary copy

| Element | Copy |
|---------|------|
| Page heading | `Profile` |
| Page subhead | `A snapshot of your environment. Every row links back to the scanner that found it. Edit anything — your changes persist.` |
| Scan-summary, never-scanned | `BLADE hasn't scanned yet.` |
| Scan-summary, scanned | `Last scan: {relative-time} • {repo_count} repos • {account_count} accounts` |
| Scan-summary, running | `Scanning… {queue_depth} leads remaining` |
| Re-scan header button (never-scanned) | `Run first scan` |
| Re-scan header button (scanned) | `Re-scan` |
| Re-scan header button (running) | `Scanning…` |
| Section tab labels | `Repos` / `Accounts` / `Stack` / `Rhythm` / `Files` |
| Row-action menu: Edit | `Edit…` |
| Row-action menu: Hide | `Hide row` |
| Row-action menu: Delete | `Delete` |
| Row-action menu: Reset | `Reset to scan` |
| Add-row button | `Add row` |
| Reset-all-in-section button | `Reset section` |
| Orphaned-row pill | `not found` |
| Edited-row pill | `edited` |
| Source pill tooltip | `Found by {scanner-full-name} at {scan-lead-path}` |
| Stack tab: Languages card | `Languages` |
| Stack tab: Package managers card | `Package managers` |
| Stack tab: Installed CLIs card | `Installed CLIs` |
| Stack tab: IDEs card | `IDEs` |
| Rhythm tab: heatmap heading | `Activity by hour` |
| Rhythm tab: day-bar heading | `Weekly distribution` |
| Rhythm tab: narrative missing | `Narrative not generated — no long-context provider configured.` |
| Rhythm tab: narrative CTA | `Configure` |
| Files tab: window toggle | `7d` / `30d` / `All` |
| Drawer heading pattern | `{row-primary-label}` |
| Drawer section 1 heading | `Discovered via` |
| Drawer section 2 heading | `Follow-ups produced` |
| Drawer section 3 heading (if edited) | `Overlay state` |

### Live-tail "Activity" panel

| Element | Copy |
|---------|------|
| Collapsed header label | `Activity` |
| Collapsed summary, never-scanned | `Never scanned` |
| Collapsed summary, after scan | `Last scan {relative-time} — {found_count} rows` |
| Expanded summary, running | `({queue_depth} / {initial_queue_depth}) {tier} queue draining` |
| Cancel button | `Cancel` |
| Log line format | `{HH:MM:SS}  {scanner-tag}  {message}` (mono, single line; `message` field comes from scanner emit-site) |

### Settings → Privacy Deep Scan section

| Element | Copy |
|---------|------|
| Section heading | `Deep Scan — Source Classes` |
| Section intro | `BLADE scans these 8 source classes on your machine to build your profile. Every class is on by default. Turn a class off to exclude it from future scans. Changes apply on next scan.` |
| Toggle 1 label | `Filesystem repo walk` |
| Toggle 1 description | `Walks ~/Projects, ~/repos, ~/src, ~/code + custom parent dirs for every .git directory.` |
| Toggle 2 label | `Git remote reads` |
| Toggle 2 description | `Reads .git/config on each repo to extract org/repo + account handles. Never calls the remote — local only.` |
| Toggle 3 label | `IDE workspace artifacts` |
| Toggle 3 description | `Reads .code-workspace, .idea, VS Code workspaceStorage and Cursor recent-projects lists.` |
| Toggle 4 label | `AI session history` |
| Toggle 4 description | `Reads local ~/.claude/projects, ~/.codex/sessions, ~/.cursor/ directories — filenames + timestamps.` |
| Toggle 5 label | `Shell history` |
| Toggle 5 description | `Reads .bash_history / .zsh_history / .fish_history to detect tool + repo usage. Never uploaded.` |
| Toggle 6 label | `Filesystem MRU` |
| Toggle 6 description | `Lists files edited within the selected window (7d default) under your home directory.` |
| Toggle 7 label | `Browser bookmarks` |
| Toggle 7 description | `Parses Chrome / Brave / Arc / Edge bookmark JSON — counts + top domains only, not full URLs.` |
| Toggle 8 label | `Installed CLIs + apps` |
| Toggle 8 description | `Runs \`which\` on a curated dev-CLI list + enumerates /Applications or XDG desktop entries.` |
| Re-scan button | `Re-scan now` |
| Re-scan toast title | `Scan started` |
| Re-scan toast message | `Open Profile to watch progress.` |
| Re-scan toast action | `View Profile` |

### Empty states

| Surface | Heading | Body | CTA |
|---------|---------|------|-----|
| Repos tab, never scanned | `No profile yet` | `Run your first scan to see the repos, accounts, stack, rhythm, and files BLADE found on your machine.` | `Run first scan` |
| Repos tab, source class disabled | `Filesystem repo walk is off` | `Enable it in Privacy settings to see repos here.` | `Open Privacy settings` |
| Accounts tab, zero accounts | `No accounts detected` | `Git remotes and SSH keys usually surface at least one account. Check that the Git remote source class is enabled.` | `Open Privacy settings` |
| Stack tab, zero inventory | `Nothing installed detected` | `Run a scan with the Installed CLIs class enabled to see your dev toolkit.` | `Re-scan now` |
| Rhythm tab, zero signals | `No rhythm signals yet` | `Rhythm needs shell history or AI session timestamps. Enable those source classes and re-scan.` | `Open Privacy settings` |
| Files tab, zero MRU | `No recent files` | `Expand the window or enable the Filesystem MRU source class.` | `Re-scan now` |

### Error states

| Error | Where | Copy |
|-------|-------|------|
| `deep_scan_start` invoke fails | Toast (type: error) | `Couldn't start scan. {error-message}` |
| `profile_get_rendered` invoke fails on mount | Inline `<EmptyState />` with error icon | `Couldn't load profile. {error-message} [Retry]` |
| `profile_overlay_upsert` fails | Toast (type: error) + revert optimistic UI | `Couldn't save edit. {error-message}` |
| `profile_overlay_reset` fails | Toast (type: error) | `Couldn't reset row. {error-message}` |
| `scan_cancel` fails (rare) | Toast (type: warning) | `Scan didn't cancel cleanly — it'll stop at the next lead boundary.` |
| `scan_classes_enabled` toggle save fails | Toast + revert checkbox | `Couldn't save toggle. Try again.` |
| Toggle disabled all 8 classes + Re-scan | Inline warning above Re-scan button | `All source classes are off. Enable at least one to scan.` |
| Scan produces zero rows (all enabled, nothing found) | Live-tail final message | `Scan complete — no signals found. Try widening scan parent dirs in Privacy settings.` |

### Destructive confirmations

Phase 12 has **no destructive actions requiring a modal dialog confirmation**. Rationale:
- Delete row is reversible (re-scan brings it back unless re-hidden; the underlying data is in `scan_results.json` and `profile_overlay.json` both on disk, neither touched externally).
- Hide row is reversible (overlay entry + Reset to scan restores it).
- Toggle off a source class is reversible (toggle back on + re-scan).

The only action that crosses into "confirm first" territory is a hypothetical future "Reset entire profile overlay" bulk action — deferred to the phase that actually needs it. Phase 12 does not ship a bulk-reset dialog.

---

## Empty, Error, Loading States

Consolidated reference table for the checker and auditor. Every state above is covered by one of these patterns.

| State | Pattern | Copy source |
|-------|---------|-------------|
| ProfileView mounting (profile fetch in flight) | `<ListSkeleton />` over the active tab's table region | — |
| Scan never run, landing on ProfileView | `<EmptyState />` with icon + headline + body + Run first scan CTA | See Empty states table |
| Scan running, live-tail visible | Live-tail expanded + tables rendering partial results (each new row slides in via `list-entrance`) | — |
| Scan complete, all populated | Live-tail collapsed to "Last scan 2m ago — N rows"; tables render with rows | — |
| Source class disabled, empty tab | `<EmptyState />` with "Open Privacy settings" CTA | See Empty states table |
| Row orphaned (overlay, no scan match) | Row rendered `var(--t-3)` + `<Pill tone="new">not found</Pill>` | `not found` |
| Row edited (overlay field override) | Row rendered normal + `<Pill tone="pro">edited</Pill>` after source pill | `edited` |
| Row deleted (overlay action) | Row NOT rendered (filtered out) | — |
| Live-tail, no events yet (pre-scan) | Collapsed, body not rendered | — |
| Live-tail, overflow (>10 lines) | FIFO trim — oldest drops as newest enters | — |
| Settings → Privacy toggle saving | Optimistic UI update + spinner on checkbox temporarily | — |
| Settings → Privacy save fail | Revert checkbox + toast | See Error states |
| Scan in progress (button states) | Re-scan buttons disabled + `<GlassSpinner size={12} />` + `Scanning…` label | — |
| Scan cancelled mid-flight | Toast `Scan cancelled` + live-tail final line `cancel: scan halted at lead boundary` | — |
| LLM narrative missing (Rhythm tab) | `.t-body var(--t-3)` copy + inline `Configure` link button | See Copywriting |

---

## Cross-Surface Consistency Invariants

The checker verifies these invariants across the 3 surfaces. They are FALSIFIABLE — if any fails, Phase 12 has regressed.

1. **Source pill identity:** Every row in every table (Repos / Accounts / Stack sub-tables / Rhythm / Files) that has a scan origin shows a `<SourcePill scanner={origin}>`. Source pill markup + color tokens + tooltip pattern IDENTICAL across all tabs. Drift between tabs is a PHASE 12 REGRESSION.
2. **Scanner-tag color consistency:** The color rule for a given scanner is the SAME in the live-tail log-line scanner-tag column and in the source pill for rows it produced. `fs_mru` in the log is `var(--a-warm)`; `fs` source pill on a Repos row is `var(--a-warm)`. No divergence.
3. **Tab-pill visual identity:** Section-tab pills in ProfileView use the EXACT `.identity-tab-pill` / `.identity-tabs` / `[data-active="true"]` CSS from existing identity.css. No overrides. No bespoke tab styling.
4. **EditSectionDialog reuse:** Per-row edit flow invokes the existing `<EditSectionDialog />` from `src/features/identity/EditSectionDialog.tsx`. No new edit modal primitive in Phase 12.
5. **Empty-state identity:** Every empty surface uses `<EmptyState />` primitive. No bespoke "nothing here" components.
6. **Spinner:** Every pending state uses `<GlassSpinner />` — no custom CSS spinner keyframes. Sizes: 12 for inside buttons, 16 for inline-with-text in live-tail. No other sizes.
7. **Icon-button sizing:** All icon-only buttons in Phase 12 (row-action `⋮`, drawer close `×`, disclosure chevron) use `<Button variant="icon" size="sm" />` → 32×32px. None hardcode dimensions.
8. **Focus ring color + geometry:** Every new focusable element shows a 2px `var(--a-cool)` outline at 2px offset (or -2px inset for table rows). No custom focus styling.
9. **Error panel:** Every error surface in Phase 12 uses `useToast()` toasts for transient errors and `<EmptyState />` with error framing for mount-blocking errors. No bespoke error-panel class.
10. **Reduced-motion:** All three surfaces must render correctly with `prefers-reduced-motion: reduce` — no layout shift relative to the animated version, only the transitions are suppressed.
11. **Blur budget:** Any ProfileView viewport with the drawer open contains EXACTLY 3 backdrop-filter layers (`glass-1` main + `glass-2` live-tail + `glass-2` drawer). Any viewport without the drawer is ≤2. Zero Phase 12 surface may introduce a 4th blur.
12. **No new CSS file (D-63):** Additive rules only, appended under `@layer features` in `src/features/identity/identity.css`. Checker greps for new `.css` files under `src/features/identity/` added in Phase 12 and fails on any match.

---

## Overlay State Rendering Rules (locked)

These rules govern how `scan_results.json` + `profile_overlay.json` compose into a rendered row for UI purposes. Executor implements verbatim; checker asserts.

```
for each row in scan_results.rows:
  overlay_entry = overlay.rows[row.row_id]
  if overlay_entry?.action == "delete": skip (do not render)
  if overlay_entry?.action == "hide":   skip (do not render)
  if overlay_entry?.action == "edit":   render row with overlay fields applied + edited pill
  else:                                 render row as-is (source pill only)

for each custom row in overlay where action == "add":
  render row with source pill = "manual" (gray)

for each overlay entry whose row_id does NOT exist in scan_results:
  if action == "edit" or "hide" or "delete": render as orphaned row (gray + "not found" pill)
    (exception: "delete" orphaned = do not render — row is gone from both, entry is vestigial)
  if action == "add":                         render normally with manual source pill
```

**Edit precedence (locked):** overlay edit fields ALWAYS win over scan fields for the same row. No "smart merge" heuristic. The user's edit is the source of truth for any field they touched.

**Orphaned row actions:**
- Visible in Repos/Accounts/Files tables with `var(--t-3)` text + `not found` pill.
- Row-action menu restricted to: `Delete` (remove from overlay) + `Reset to scan` (no-op — row doesn't exist in scan).
- Drawer on click: body section 1 (`Discovered via`) renders `No longer found in latest scan — this row is preserved from your manual edits.`.

---

## Event Payload Contract (UI-relevant subset of D-64)

The Live-tail panel consumes `deep_scan_progress` events. Phase 12 ships the additive payload extension:

```ts
type DeepScanProgressPayload = {
  // Existing (Phase 1):
  phase: string;                    // coarse phase name (e.g. "fs_repos")
  found: number;                    // running row count
  // New in Phase 12 (optional — old consumers ignore):
  lead_kind?: LeadKind;             // e.g. "GitRemoteRead"
  lead_seed?: string;               // why this lead ran, e.g. "fs_mru:~/blade"
  priority_tier?: "hot" | "warm" | "cold";
  queue_depth?: number;             // leads still in queue
  elapsed_ms?: number;              // since scan started
  message?: string;                 // human-readable e.g. "reading remotes for blade"
};
```

**UI rendering rules (locked):**
- `message` field is the primary display in the log line (third column). If absent, fall back to `{phase}: +{delta-found} rows` template.
- `priority_tier` populates the live-tail header progress text (`hot queue draining`).
- `queue_depth` populates the header counter (`4 / 12`). `initial_queue_depth` is captured from the first event's `queue_depth` value.
- `lead_kind` is not rendered directly (it's coarser than `message` for user-facing purposes). Used for analytics / debugging if needed.
- `elapsed_ms` → live-tail footer (when expanded): `Elapsed: {humanized-duration}` at `.t-small var(--t-3)`.

**Onboarding compat (`verify:scan-event-compat`):**
- Every name in `DEEP_SCAN_PHASES` (from `src/features/onboarding/deepScanPhases.ts`) resolves to a phase the new scanner will emit. New phase names may be added (additive); no existing names dropped.
- `DeepScanStep.tsx` keyed-SVG fallback handles unknown `phase` names with a generic tick — safe default.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none (D-01 locks no shadcn) | not applicable |
| Third-party | none | not applicable |

Phase 12 introduces ZERO external component dependencies. All new UI composes existing primitives + existing identity.css classes. This eliminates the registry vetting gate entirely.

**No new npm dependencies.** HTML5 drag-and-drop is not needed in Phase 12 (no reorderable lists). Heatmap uses CSS Grid — no charting library. Bar chart uses `<div>` widths — no charting library.

---

## Verification Targets (for gsd-ui-checker)

The checker validates against six dimensions. Phase 12 mappings:

| Dimension | How to verify | Pass criteria |
|-----------|---------------|---------------|
| 1 Copywriting | Grep new components for hardcoded strings; diff against Copywriting Contract § | 100% of user-facing strings in this phase match the table verbatim |
| 2 Visuals | Screenshot 3 surfaces (ProfileView / live-tail expanded / Settings Privacy section); compare against ASCII mockups + ensure blur cap ≤3 layers per viewport | No viewport shows >3 backdrop-filter layers; every surface uses ≥1 existing primitive |
| 3 Color | Run existing `audit-contrast.mjs` gate with Phase 12 surfaces added to the manifest (see Accessibility §) | AA 4.5:1 text, 3:1 non-text across all 5 representative wallpapers |
| 4 Typography | Grep new files for `font-size:` hardcodes (except explicit 12px log-line exception) | 0 raw px font-sizes except documented exceptions; only `.t-*` utility classes |
| 5 Spacing | Grep new files for hardcoded `px` in padding/margin (except heatmap 2px + log-line 18px exceptions) | 0 hardcoded values except documented exceptions; only `var(--s-*)` tokens or `padding` prop on Card |
| 6 Registry safety | Diff `package.json` for new deps; inspect imports in `src/features/identity/ProfileView.tsx` + new components | 0 new dependencies; all imports resolve to `@/design-system/primitives`, `@/features/identity/EditSectionDialog`, or local feature files |

**Phase-12-specific gates (planner will add):**
- `scripts/verify-scan-no-egress.mjs` — greps `src-tauri/src/deep_scan/**` for network primitives; fail on any `reqwest::` / `isahc::` / `http::` / `ureq::` / `TcpStream` / `UdpSocket`. (Extends `verify:all`.)
- `scripts/verify-scan-no-write.mjs` — greps `src-tauri/src/deep_scan/**` for write operations outside `~/.blade/identity/`; fail on any path escape. (Extends `verify:all`.)
- `scripts/verify-scan-event-compat.mjs` — asserts every name in `src/features/onboarding/deepScanPhases.ts DEEP_SCAN_PHASES` resolves to a phase the new scanner emits; fail on dropped names. (Extends `verify:all`.)
- `scripts/verify-profile-ui.mjs` (this phase) — asserts:
  - `ProfileView` imports ONLY from `@/design-system/primitives`, `@/features/identity/EditSectionDialog`, `@/lib/tauri`, `@/lib/context`, `@/windows/main/useRouter`, `./types`.
  - `SourcePill` color token lookup table covers all 8 scanner classes + `manual`.
  - `identity.css` contains no rules introduced that break the `.identity-tab-pill` / `.identity-surface` existing selectors.
  - `PrivacyPane.tsx` has EXACTLY one `<DeepScanPrivacySection />` import and zero duplicate section headings.

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

- `.planning/phases/12-smart-deep-scan/12-CONTEXT.md` — D-59..D-67 locked decisions
- `.planning/REQUIREMENTS.md` §SCAN-01..13 — functional scope
- `.planning/ROADMAP.md` §"Phase 12 Smart Deep Scan" (lines 113–131) — 5 success criteria
- `.planning/phases/11-smart-provider-setup/11-UI-SPEC.md` — precedent pattern (Phase 11 mirrors)
- `src/styles/tokens.css` — spacing, color, radius, font token source of truth
- `src/styles/typography.css` — `.t-h1`/`.t-h2`/`.t-h3`/`.t-body`/`.t-small`/`.t-mono` utility classes
- `src/styles/glass.css` — glass-1/2/3 tier classes (blur caps)
- `src/styles/motion.css` — easings + durations (including reduced-motion override)
- `src/styles/motion-entrance.css` — `.list-entrance` reused for row entrance + log-line entrance
- `src/design-system/primitives/primitives.css` — `.btn` / `.input` / `.chip` / `.badge` / `dialog.glass`
- `src/design-system/primitives/index.ts` — primitive barrel (12 exports; Phase 12 uses 9)
- `src/features/identity/identity.css` — `.identity-surface` / `.identity-tabs` / `.identity-tab-pill` / `.identity-card` (reused verbatim)
- `src/features/identity/index.tsx` — 7-entry route registry; D-63 adds 8th entry
- `src/features/identity/EditSectionDialog.tsx` — reused for per-row edit flow
- `src/features/settings/panes/PrivacyPane.tsx` — existing pane; Phase 12 appends one `<DeepScanPrivacySection />`
- `src/features/settings/SettingsShell.tsx` — `settings-privacy` route already registered
- `src/features/onboarding/deepScanPhases.ts` — hardcoded phase names; D-64 compat gate covers this
- `src/features/onboarding/DeepScanStep.tsx` — SVG animation keyed by phase name; stays compatible via additive payload
- `src/lib/events/index.ts` — `BLADE_EVENTS.DEEP_SCAN_PROGRESS` event name (unchanged)
- `src/lib/events/payloads.ts` — `DeepScanProgressPayload` shape (extended additively per D-64)
- `src/types/provider.ts` — `DeepScanResults` permissive type (extended additively)
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` §"Tester-Pass Evidence Map" symptom #2 — falsifiable close-target anchor
- `.planning/PROJECT.md` §Validated — 9 self-built primitives (Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton); §Constraints — blur cap + no-shadcn + observe-only
- `/home/arnav/blade/CLAUDE.md` §Critical Architecture Rules — Frontend 3-place route rule + event-listener pattern

---

*UI-SPEC drafted: 2026-04-20 — auto mode, formalising D-59..D-67 from `12-CONTEXT.md`. Zero new tokens, zero new primitives, zero new dependencies, zero new CSS files.*
