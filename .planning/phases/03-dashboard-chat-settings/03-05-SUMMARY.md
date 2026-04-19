---
phase: 03-dashboard-chat-settings
plan: 05
subsystem: dashboard-ui
tags: [react, tauri, perception, hormones, dashboard, ui, css-grid, performance, dash]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: BLADE_EVENTS catalog + useTauriEvent hook (D-13), GlassPanel + Pill + Card primitives, --s-*/--r-*/--t-* design tokens, layout.css (--nav-width / --title-height / --gap), typography.css (.t-h2 / .t-h3 / .t-body / .t-small / .t-mono), boot perf mark in main.tsx
  - phase: 02-onboarding-shell
    provides: MainShell route slot (.main-shell-route already inside shell glass — this plan does NOT wrap dashboard in another GlassPanel), RouteSlot suspense wrapper, ROUTE_MAP aggregator (re-uses route id 'dashboard' verbatim)
  - phase: 03-dashboard-chat-settings
    provides: 03-01 hormone_update emit live + perception_get_latest/perception_update commands registered; 03-02 perceptionGetLatest/perceptionUpdate wrappers, homeostasisGet wrapper, PerceptionState + HormoneState + HormoneUpdatePayload types
provides:
  - Real Dashboard surface at route 'dashboard' replacing Phase 1 ComingSoonSkeleton stub (DEFAULT_ROUTE_ID landing target)
  - performance.mark('dashboard-paint') instrumentation point for Plan 03-07 dashboard-paint.spec.ts (D-77 / SC-5 falsifier)
  - HormoneChip component (Phase 4 HUD bar reuses verbatim — D-75)
  - 12-column CSS grid layout pattern that downstream feature surfaces can mirror (Phase 5 Hive dashboard, Phase 6 Calendar)
  - Per-hormone color palette (10 keys: arousal/energy_mode/exploration/trust/urgency/hunger/thirst/insulin/adrenaline/leptin) — single source of truth for all hormone visualizations
affects:
  - Plan 03-07 (Playwright specs): dashboard-paint.spec.ts asserts boot → dashboard-paint < 400ms headless using the perf mark this plan ships
  - Phase 4 HUD-01..05: HormoneChip imported from @/features/dashboard/hormoneChip into the HUD bar (no Phase 4 wrapper plan required)
  - Phase 4 D-78 chat-overlay-on-dashboard: Dashboard component will be the dashboard surface kept frozen-mounted under the chat panel
  - Phase 5+ feature dashboards may extract dashboard-grid utility class for cluster-specific 12-col layouts

# Tech tracking
tech-stack:
  added: []  # Zero new dependencies — composes existing primitives + wrappers + hook
  patterns:
    - "perception_fusion consumer recipe: getLatest → fallback to update → setInterval(update, 30s) → cleanup with cancelled flag (T-03-05-02 mitigation)"
    - "HORMONE_UPDATE event handler payload-to-state coercion (HormoneUpdatePayload 10 fields → HormoneState 11 fields by stamping last_updated client-side)"
    - "performance.mark in useEffect post-setState — Plan 03-07 spec then asserts via performance.measure('boot', 'dashboard-paint')"
    - "CSS custom property bridge from JSX (--chip-color inline style) → CSS rule (border-left: var(--chip-color)) keeps palette in TS, structure in CSS"
    - "Component lazy-loaded with side-effect CSS import inside index.tsx so route slot brings styles automatically (P-01 main-bundle hygiene)"
    - "Visual placeholder = subtle opacity reduction (0.72 → 0.92 on hover) — reads as 'not yet' not 'broken'"

key-files:
  created:
    - src/features/dashboard/RightNowHero.tsx       # 156 lines — perception_fusion consumer + 30s poll + dashboard-paint mark
    - src/features/dashboard/AmbientStrip.tsx       # 99 lines — homeostasisGet first-paint + HORMONE_UPDATE subscription
    - src/features/dashboard/hormoneChip.tsx        # 80 lines — 10-hormone color map + visual chip primitive (Phase 4 HUD reuse)
    - src/features/dashboard/Dashboard.tsx          # 56 lines — 12-col grid composition (3 rows: hero, ambient, 3 cards)
    - src/features/dashboard/ComingSoonCard.tsx     # 36 lines — GlassPanel + Pill placeholder card
    - src/features/dashboard/dashboard.css          # 244 lines — grid layout + hero typography + hormone-chip palette + per-state colors
  modified:
    - src/features/dashboard/index.tsx              # Replaced ComingSoonSkeleton stub with lazy-loaded Dashboard; route id 'dashboard' preserved

key-decisions:
  - "AmbientStrip state typed as HormoneState (11 fields) not HormoneUpdatePayload (10 fields) — superset accommodates both initial fetch (homeostasisGet returns full struct) and event coercion (stamp last_updated: Date.now() client-side). Single state shape → simpler render."
  - "HormoneChip in its own file (not nested in AmbientStrip.tsx) — Phase 4 HUD bar imports it verbatim per D-75. Three lines of import save a copy-paste duplication later."
  - "Dashboard NOT wrapped in GlassPanel — MainShell.main-shell-route already sits inside shell glass. Adding another wrapping glass would breach D-07 cap (NavRail + TitleBar + shell = 3 already). Dashboard is plain div, ComingSoonCards inside use GlassPanel because their .glass blur is fallback-styled by the existing primitives.css (no NEW blur layer added by this plan)."
  - "Per-state color (focused/idle/away) uses --a-ok / --a-warn / --t-3 design tokens rather than literal hex — keeps the palette consistent with TitleBar status indicators."
  - "Single-column collapse @media (max-width: 900px) — keeps the dashboard usable in narrow split layouts (Phase 4 chat-on-dashboard scenario will hit this)."
  - "performance.mark fired AFTER setState (inside the .then handler), not before — Playwright assertion measures full perception fetch + React commit path, which is what SC-5 actually constrains."
  - "Visible_errors clamped to 5 in render (T-03-05-05) — backend may surface arbitrary-length OCR error lists; defensive cap prevents DoS via DOM growth."
  - "30s setInterval matches backend perception_fusion cache cadence — IPC is cheap, no need to subscribe to a perception_update event (would re-render uselessly between cache ticks)."

# Metrics
duration: ~6min  # automated-only execution; both tasks landed first-try clean
completed: 2026-04-19
---

# Phase 3 Plan 05: Dashboard Substrate Summary

**Replaces the Phase 1 `ComingSoonSkeleton` stub at `/dashboard` with the real ambient home view: a perception_fusion-driven Right Now hero, a homeostasis-driven Ambient strip with 5 hormone chips, and three phase-labelled placeholder cards (Hive / Calendar / Integrations) in a 12-column grid. Ships the `performance.mark('dashboard-paint')` first-paint instrumentation that Plan 03-07's Playwright spec asserts against (SC-5 falsifier).**

## Performance

- **Duration:** ~6 min (auto-mode, both tasks first-try clean — zero deviations)
- **Started:** 2026-04-19T10:17:57Z
- **Tasks:** 2 (both auto, no checkpoints)
- **Files created:** 6 (5 TSX + 1 CSS)
- **Files modified:** 1 (index.tsx — stub → lazy-loaded Dashboard)
- **Net new lines:** ~671 lines TS/TSX/CSS + JSDoc cites
- **No new dependencies; no Rust touched; no event-catalog changes.**

## Accomplishments

### Task 1 — RightNowHero + AmbientStrip + HormoneChip (commit `9e99070`)

Three components, three concerns, three files:

**`hormoneChip.tsx` (80 lines)** — Pure visual component. Receives `{name, value, dominant?}`, renders a chip with an aria-labelled value clamped to 0..1. The 10-key color palette (`HORMONE_COLORS`) covers all hormones in `HormoneState` so Phase 4 HUD can pass any field through without palette gaps. Color exposed via `--chip-color` CSS custom property so dashboard.css picks it up for the left-border accent and value text-shadow without per-hormone rules. Extracted to its own file per D-75 — Phase 4 HUD bar imports verbatim.

**`AmbientStrip.tsx` (99 lines)** — D-75 hormone consumer. Mounts: (1) `homeostasisGet()` once for first-paint snapshot (the HORMONE_UPDATE event only fires on the 60s tick, so without this mounting at second 0 of a tick gives a 60s empty strip); (2) `useTauriEvent<HormoneUpdatePayload>(BLADE_EVENTS.HORMONE_UPDATE, ...)` for live updates. Coerces the 10-field payload to the 11-field `HormoneState` by stamping `last_updated: Date.now()` client-side — single state type simplifies render. Computes dominant via `Math.max` over 5 high-salience SHOWN_KEYS (arousal / energy_mode / exploration / urgency / trust); secondary 5 hormones live in state for Phase 4 HUD reuse. P-06 `cancelled` flag guards the async fetch race.

**`RightNowHero.tsx` (156 lines)** — D-74/D-77 perception consumer + perf instrumentation. Mount path: `perceptionGetLatest()` → null fallback to `perceptionUpdate()` (forced fresh capture) → setState → `performance.mark('dashboard-paint')`. DEV-only `console.log('[perf] dashboard-first-paint: Xms (budget 200ms)')` measures `boot` → `dashboard-paint` for operator smoke (D-92). 30s setInterval matches backend perception_fusion cache cadence so IPC overhead is bounded. Visible_errors clamped to 5 in render (T-03-05-05). `\u00A0` placeholder for empty `active_title` prevents secondary-row reflow when apps don't expose a window title.

### Task 2 — Dashboard composition + dashboard.css + index.tsx (commit `8a75513`)

**`Dashboard.tsx` (56 lines)** — 12-column CSS grid composition per D-76. Row 1: RightNowHero (col-span 8) + reserved column (col-span 4, empty for now — Phase 5+ may fill with hero secondary actions). Row 2: AmbientStrip (col-span 12). Row 3: 3× ComingSoonCard (col-span 4 each: Hive Phase 5 / Calendar Phase 6 / Integrations Phase 7). NOT wrapped in GlassPanel — MainShell route slot already sits inside shell glass; adding another wrapping glass blows D-07.

**`ComingSoonCard.tsx` (36 lines)** — GlassPanel + Pill primitive composition. Visual: title + "Phase N" pill in a flex-row header + optional one-line description. Subtle opacity (0.72 → 0.92 on hover) signals placeholder vs broken. No imports from other features/* — self-contained.

**`dashboard.css` (244 lines)** — Layout + typography + per-state palette. Zero new blur layers (CI grep gate verified `no-blur-ok`). Uses `--s-*` spacing, `--r-*` radii, `--t-*` text colors, `--a-ok`/`--a-warn`/`--t-3` for state pills, `--chip-color` custom property for hormone chip colors. `@media (max-width: 900px)` collapses to single-column for narrow split layouts (Phase 4 chat-on-dashboard scenario). `color-mix(in srgb, var(--chip-color) 40%, transparent)` for the dominant chip glow — CSS-only, no extra DOM, no blur.

**`index.tsx`** — Stub → real route. Lazy-loads `Dashboard` via `lazy(() => import('./Dashboard').then(m => ({ default: m.Dashboard })))`. Imports `./dashboard.css` as side-effect so Vite bundles styles with the route's lazy chunk. Route id `'dashboard'` preserved (NavRail + ⌘K palette + DEFAULT_ROUTE_ID derive from this).

## Task Commits

| # | Task | Commit | Files Changed |
| - | ---- | ------ | ------------- |
| 1 | RightNowHero + AmbientStrip + HormoneChip | `9e99070` | 3 created (335 insertions) |
| 2 | Dashboard + ComingSoonCard + dashboard.css + index.tsx | `8a75513` | 3 created + 1 modified (427 insertions, 10 deletions) |

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` (dashboard files) | **0 errors** ✓ |
| `npx tsc --noEmit` (workspace total) | 3 pre-existing errors in parallel-wave 03-06 settings panes (disjoint from this plan; not regressions) |
| `npm run verify:entries` | OK — 5 entries on disk ✓ |
| `npm run verify:no-raw-tauri` | OK — no raw `@tauri-apps/api/*` outside allowed paths ✓ |
| `npm run verify:migration-ledger` | OK — 5 referenced ids tracked ✓ |
| `npm run verify:emit-policy` | OK — all 59 broadcast emits match cross-window allowlist ✓ |
| `npm run verify:contrast` | OK — all strict pairs ≥ 4.5:1 ✓ |
| `npm run verify:all` | **5 of 5 gates green** ✓ |
| `grep -nE "backdrop-filter" src/features/dashboard/dashboard.css` | 0 matches (D-07 cap protected) ✓ |
| `grep -nE "id: 'dashboard'" src/features/dashboard/index.tsx` | 1 match (route registry intact) ✓ |
| `grep -nE "perceptionGetLatest\|perceptionUpdate" src/features/dashboard/RightNowHero.tsx` | 4 matches (mount + fallback + poll + import) ✓ |
| `grep -nE "HORMONE_UPDATE\|homeostasisGet" src/features/dashboard/AmbientStrip.tsx` | 5 matches (subscribe + mount + import) ✓ |
| `grep -nE "performance\.mark.*dashboard-paint" src/features/dashboard/RightNowHero.tsx` | 1 match (D-77 / SC-5 instrumentation) ✓ |

### `verify:all` Status: 5 of 5 gates pass

Note: Plan 03-02 SUMMARY flagged `verify:emit-policy` as failing on 2 pre-existing Rust violations. Both are now resolved (likely by a chore commit on master between 03-02 and 03-05 — the gate now reports `OK — all 59 broadcast emits match cross-window allowlist`).

## Decisions Made

1. **AmbientStrip state typed as HormoneState (11 fields), not HormoneUpdatePayload (10 fields).** The superset accommodates both code paths: `homeostasisGet()` returns the full struct, the event payload omits `last_updated`. By coercing the event to add `last_updated: Date.now()` client-side, the component renders against a single state shape. Phase 4 HUD freshness indicators read `last_updated`; the Date.now() stamp is "received at", not authoritative.

2. **HormoneChip in its own file (not nested).** D-75 explicitly says "extract the hormone-chip renderer so Phase 4 HUD bar reuses it verbatim." Extracted with full props interface + JSDoc; HUD imports `import { HormoneChip } from '@/features/dashboard/hormoneChip'` Day 1.

3. **Dashboard NOT wrapped in GlassPanel.** MainShell's `.main-shell-route` already sits inside shell glass. Adding another wrapping glass would breach D-07 (NavRail + TitleBar + shell = 3). Dashboard is a plain `<div>`. ComingSoonCards inside DO use GlassPanel — but those `.glass` blur layers are pre-existing primitives, not new layers added by this plan; the `glass.css` fallback rules handle them. Net new blur layers from dashboard.css: **zero**.

4. **30s setInterval (not event-driven).** No backend `perception_update` event exists for the polling cadence; the loop ticks internally and caches for 30s. A 30s setInterval matches the cadence — calling `perceptionUpdate()` more often would just hit the cache. Hooking into a hypothetical event would either re-render uselessly or wait the full 30s — neither beats the simple interval.

5. **performance.mark fires AFTER setState commits, not before.** Playwright assertion measures `boot → dashboard-paint`. Marking before setState would understate the budget; marking after captures the full perception fetch + React commit path that SC-5 actually constrains.

6. **`color-mix()` for dominant chip glow.** CSS-only, no extra DOM nodes, no blur layers. Browser support is universal in the Tauri WebView2/WebKit/CEF set BLADE targets.

7. **Single-column collapse @ ≤900px.** Phase 4 D-78 deferred chat-overlay-on-dashboard but Phase 9 will revive it; preparing the dashboard for narrow widths now means no Phase 9 grid rewrite. The breakpoint matches the chat panel width (420px from layout.css `--chat-width`) plus nav rail (76px) plus reasonable hero minimum.

## Files Created (6)

```
src/features/dashboard/RightNowHero.tsx     (156 lines)
src/features/dashboard/AmbientStrip.tsx     (99 lines)
src/features/dashboard/hormoneChip.tsx      (80 lines)
src/features/dashboard/Dashboard.tsx        (56 lines)
src/features/dashboard/ComingSoonCard.tsx   (36 lines)
src/features/dashboard/dashboard.css        (244 lines)
```

## Files Modified (1)

```
src/features/dashboard/index.tsx            (Stub ComingSoonSkeleton → lazy-loaded Dashboard; +20 / -10)
```

## Requirements Closed (8 — all DASH-*)

| Req     | Closure |
|---------|---------|
| DASH-01 | RightNowHero consumes perceptionGetLatest + perceptionUpdate (Right Now hero from perception_fusion) |
| DASH-02 | AmbientStrip subscribes HORMONE_UPDATE + first-paint via homeostasisGet (ambient strip reflects homeostasis state) |
| DASH-03 | RightNowHero renders perception_fusion fields (active_app, active_title, user_state, ram_used_gb, disk_free_gb, top_cpu_process, visible_errors) |
| DASH-04 | AmbientStrip renders 5 hormone chips with dominant computed client-side; HormoneChip primitive shipped (Phase 4 HUD reuse) |
| DASH-05 | Dashboard composes RightNowHero + AmbientStrip + 3 ComingSoonCards in 12-column CSS grid (D-76 layout) |
| DASH-06 | ComingSoonCards label phase scope honestly (Hive Phase 5 / Calendar Phase 6 / Integrations Phase 7); no false promises |
| DASH-07 | performance.mark('dashboard-paint') fired post-setState; DEV console log compares to boot mark; Plan 03-07 dashboard-paint.spec.ts asserts <400ms headless |
| DASH-08 | Route id 'dashboard' preserved + DEFAULT_ROUTE_ID landing target works (lazy-loaded Dashboard mounts via existing RouteSlot Suspense) |

## Deviations from Plan

**None — plan executed exactly as written, two tasks both first-try clean.**

The plan's `<verify><automated>` block included `grep -nE "backdrop-filter" src/features/dashboard/dashboard.css && exit 1`. My initial draft of dashboard.css contained the WORD `backdrop-filter` in a documentation comment (explaining what was excluded). The grep gate fired (correctly — it's a literal text check). I removed the literal word from the comment (the meaning is preserved as "no new blur layers"); the grep now returns zero matches. Not a deviation per se — just sharpened the comment language to satisfy the literal CI gate.

## Issues Encountered

- **None.** Both tasks landed first-try with zero errors. The only quirk was the comment-prose-vs-grep tension above, resolved with a one-edit comment rewording.
- Pre-existing TypeScript errors (3 remaining) are all in parallel-wave plan 03-06 (`src/features/settings/SettingsShell.tsx` referencing not-yet-created panes/PrivacyPane, panes/DiagnosticsEntryPane, panes/AboutPane). Disjoint from dashboard work. They will resolve when 03-06 ships those pane files.

## User Setup Required

**None.** Pure frontend; existing wrappers handle all IPC. No env vars, no auth, no infra changes.

## Next Phase Readiness

**Plan 03-07 (Playwright specs) unblocked:**
- `dashboard-paint.spec.ts` can assert `performance.measure('boot', 'dashboard-paint') < 400ms` against the mark this plan ships
- The route id 'dashboard' is the navigation target (`openRoute('dashboard')` in spec setup)
- HormoneChip + per-state color tokens give the spec stable selectors (`role="status"` on hormone chips, `state-focused`/`-idle`/`-away` classes on hero state pill)

**Phase 4 (overlay windows) unblocked:**
- HUD bar (HUD-01..05) imports `import { HormoneChip } from '@/features/dashboard/hormoneChip'` directly — no new wrapper plan, no copy-paste
- HUD bar can subscribe `BLADE_EVENTS.HORMONE_UPDATE` exactly the same way AmbientStrip does (the useTauriEvent + first-paint pattern is now established)

**Phase 4 D-78 (chat-overlay-on-dashboard) unblocked:**
- Dashboard.tsx is a plain `<div className="dashboard">` — keeping it frozen-mounted under a chat overlay is straightforward (no Suspense boundary nesting, no GlassPanel wrap to bypass)
- Single-column @ ≤900px breakpoint already handles narrow widths

**Phase 5 (Hive cluster) unblocked:**
- Hive cluster will fill the row-1 reserved slot or replace the Hive ComingSoonCard. The 12-column grid pattern is reusable: span 4 → span 8 promotes Hive to a hero card without rewriting layout.

**No new blockers introduced.**

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` enumerated (T-03-05-01..07). The implementation honors every mitigation:

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-03-05-01 (info disclosure: clipboard_preview / screen_ocr_text) | accept — local-only; this plan only renders disk/RAM/top_cpu_process/visible_errors fields, not the full OCR text |
| T-03-05-02 (DoS: setInterval leak) | mitigated — `cancelled` flag + `clearInterval` in cleanup |
| T-03-05-03 (tampering: HORMONE_UPDATE field-name drift) | mitigated — HormoneUpdatePayload + HormoneState share the same 10-field shape; field names match Rust struct (snake_case verbatim per D-38) |
| T-03-05-04 (CSS regression: backdrop-filter) | mitigated — CI grep verified zero occurrences in dashboard.css |
| T-03-05-05 (DoS: visible_errors unbounded growth) | mitigated — `state.visible_errors.slice(0, 5)` clamp in render |
| T-03-05-06 (spoofing: forged HORMONE_UPDATE) | accept — only Rust homeostasis.rs emits; cross-window allowlist enforced |
| T-03-05-07 (DoS: multiple performance.mark calls) | accept — `performance.mark` is idempotent for assertion purposes; only first measurement matters for SC-5 |

## Self-Check: PASSED

- File `src/features/dashboard/RightNowHero.tsx` exists — confirmed.
- File `src/features/dashboard/AmbientStrip.tsx` exists — confirmed.
- File `src/features/dashboard/hormoneChip.tsx` exists — confirmed.
- File `src/features/dashboard/Dashboard.tsx` exists — confirmed.
- File `src/features/dashboard/ComingSoonCard.tsx` exists — confirmed.
- File `src/features/dashboard/dashboard.css` exists — confirmed.
- File `src/features/dashboard/index.tsx` modified (stub → lazy-loaded Dashboard) — confirmed.
- Commit `9e99070` exists in git log — confirmed (`feat(03-05): RightNowHero + AmbientStrip + HormoneChip`).
- Commit `8a75513` exists in git log — confirmed (`feat(03-05): Dashboard composition + ComingSoonCard + dashboard.css`).
- `npx tsc --noEmit` returns 0 dashboard errors — confirmed.
- `npm run verify:all` returns OK on all 5 gates — confirmed.
- `grep -nE "backdrop-filter" src/features/dashboard/dashboard.css` returns 0 matches — confirmed.
- `grep -nE "id: 'dashboard'" src/features/dashboard/index.tsx` returns 1 match — confirmed.
- `grep -nE "performance\.mark.*dashboard-paint" src/features/dashboard/RightNowHero.tsx` returns 1 match — confirmed.

---
*Phase: 03-dashboard-chat-settings*
*Plan: 05*
*Completed: 2026-04-19*
