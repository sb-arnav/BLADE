---
phase: 02-onboarding-shell
plan: 05
subsystem: ui/shell
tags: [react, router, command-palette, navrail, keyboard-shortcuts, fuzzy-search, prefs, dialog-primitive]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Dialog primitive (native <dialog>) from Plan 01-04; usePrefs single-blob + debounce from Plan 01-05; ROUTE_MAP / ALL_ROUTES / PALETTE_COMMANDS from Plan 01-07; design tokens (--title-height, --nav-width, --t-1/2/3, --g-fill, --g-fill-strong, --g-edge-lo, --g-edge-mid, --g-shadow-sm, --r-md, --r-sm, --r-pill, --line, --dur-fast, --ease-smooth, --a-cool, --font-body, --font-mono)"
  - plan: 02-01
    provides: "Prefs extension — `palette.recent` key (JSON-encoded string[]) declared in src/hooks/usePrefs.ts (D-57)"
  - plan: 02-03
    provides: "src/design-system/shell/shell.css with .titlebar rules + src/design-system/shell/index.ts barrel; explicit hand-off of the @import into src/styles/index.css to this plan"
provides:
  - "useRouter hook + RouterProvider + useRouterCtx — in-memory router with back/forward stacks + prefs-backed lastRoute (SHELL-06, SHELL-07, D-52)"
  - "useGlobalShortcuts({openPalette}) — single window.keydown listener binding ⌘K / ⌘1 / ⌘/ / ⌘, / ⌘[ / ⌘] plus any RouteDefinition.shortcut (D-62)"
  - "CommandPalette — derived from PALETTE_COMMANDS (SC-3: no App.tsx edit to add a route), fuzzy-filtered, arrow-navigable, recent-surface via prefs (SHELL-03, D-57, D-58)"
  - "NavRail — 3 core icons + 1 icon per non-core section, active state driven by routeId; Onboarding hidden via paletteHidden filter (SHELL-02, D-55, D-56)"
  - "NavIcon component + inline SVG icon map keyed by routeId and Section"
  - "fuzzyScore(cmd, query) helper — regex-free (T-02-05-04), O(label.length) per call"
  - "shell.css extended with .navrail / .navrail-btn / .navrail-tip / .palette / .palette-input / .palette-row* rules"
  - "src/styles/index.css now @imports shell.css — closes the Plan 02-03 hand-off"
affects:
  - "02-06 MainShell — mounts <RouterProvider>, <NavRail/>, <CommandPalette/>, and calls useGlobalShortcuts({openPalette}) to wire the shortcut surface; owns the palette `open` state."
  - "future feature plans — any RouteDefinition added to a feature/index.tsx automatically appears in the palette (via PALETTE_COMMANDS) and (for non-core first-in-section routes) the NavRail; `shortcut` on the RouteDefinition auto-binds via useGlobalShortcuts without touching shell code"

# Tech tracking
tech-stack:
  added: []  # Pure composition on Phase 1 + Plan 02-01/02-03 substrate — no new deps
  patterns:
    - "React Context + hook colocation — RouterProvider, useRouterCtx, and the `useRouter` convenience alias all live in a single file so consumers see one import surface"
    - ".ts-without-JSX via createElement — useRouter.ts keeps its .ts extension (matching plan frontmatter) by constructing the Provider with React.createElement instead of JSX; keeps the file diffable as a hook module rather than a component module"
    - "Derived navigation surfaces — both CommandPalette and NavRail import PALETTE_COMMANDS directly; there is no static list to drift. paletteHidden is the single filter governing both (D-56 one-rule-two-surfaces)"
    - "Section-first icon selection in NavRail — first RouteDefinition encountered per non-core section wins the rail slot; Map preserves iteration order, so the feature-index iteration order in src/windows/main/router.ts is the display order"
    - "JSON-encoded array in prefs blob (palette.recent) — escape hatch for storing a string[] without widening the Prefs index signature; try/catch JSON.parse wraps T-02-05-01; slice(0, MAX_RECENT) bounds growth"
    - "Lazy useState initializer for initial route — prefs['app.lastRoute'] ?? prefs['app.defaultRoute'] ?? DEFAULT_ROUTE_ID evaluated once at mount (D-52 session-scoped)"
    - "Editable-target guard in global shortcut handler — only ⌘K fires inside INPUT/TEXTAREA/contentEditable; every other shortcut bails out (T-02-05-05 mitigation)"
    - "Regex-free fuzzy scoring — re-typed (not imported) from src.bak per D-17; plain .includes() + single-pass char walk; no ReDoS surface"
    - "CSS-only palette lift via `dialog.glass:has(.palette)` — re-uses Phase 1 dialog positioning but shifts palette to 25vh so it feels like a command palette, not a centered modal"

key-files:
  created:
    - "src/windows/main/useRouter.ts (119 lines) — RouterProvider + useRouterCtx + useRouter alias; lazy initial-route resolution; back/forward via ref stacks; unknown route id logged + ignored (T-02-05-02); setPref('app.lastRoute') on every transition"
    - "src/windows/main/useGlobalShortcuts.ts (103 lines) — window.keydown listener for ⌘K / ⌘1 / ⌘/ / ⌘, / ⌘[ / ⌘]; shortcutMatches() parses 'Mod+Shift+K' format; iterates ALL_ROUTES for custom shortcuts; isEditableTarget guard"
    - "src/design-system/shell/fuzzy.ts (45 lines) — fuzzyScore(cmd, q) exact/char-order/description ladder"
    - "src/design-system/shell/CommandPalette.tsx (135 lines) — Dialog-wrapped palette reading PALETTE_COMMANDS; useMemo-derived items; Arrow/Enter/Esc keyboard flow; recent-id writes on choose; readRecentIds/writeRecentIds helpers try/catch wrapped"
    - "src/design-system/shell/NavRail.tsx (73 lines) — derived left rail with CORE_ORDER constant + per-section map; NavBtn sub-component with tooltip + active pill"
    - "src/design-system/shell/navrail-icons.tsx (100 lines) — ICONS record (routeId → ReactNode) + NavIcon wrapper; route-id → section → generic-dot fallback"
  modified:
    - "src/design-system/shell/index.ts — barrel now exports TitleBar + NavRail + CommandPalette + NavIcon (append-only per D-51)"
    - "src/design-system/shell/shell.css — appended .navrail + .navrail-btn (+ :hover / .active / .active::before / :focus-visible) + .navrail-tip + .nav-icon + .navrail-logo + .navrail-divider + .palette + .palette-input + .palette-list + .palette-row + .palette-row-label/-desc/-kbd + .palette-empty + dialog.glass:has(.palette) positioning override. Every value references var(--x) from Phase 1 tokens — no hardcoded hex outside the one deliberate logo gradient (consistent with TitleBar's system-native exception)."
    - "src/styles/index.css — added `@import '../design-system/shell/shell.css';` after primitives.css + toast.css, before tailwindcss. Closes the Plan 02-03 hand-off — `.titlebar` (Plan 02-03), `.navrail`, and `.palette` rules now load in every window that imports styles/index.css."

key-decisions:
  - "useRouter.ts kept as .ts (not .tsx) to match plan frontmatter — Provider constructed with createElement() so the module reads as a hook, not a component. Alternative (rename to .tsx) was considered; rejected because tooling diffs cleaner when hook files stay .ts and consumer imports use the alias (extension invisible)."
  - "Editable-target guard allows ⌘K through but blocks every other Mod+* key. Rationale: palette needs to open even while the user is mid-type in a form; every other shortcut (⌘1 dashboard / ⌘/ chat / ⌘, settings) would hijack plausible text-editing behaviours inside inputs."
  - "readRecentIds applies a second filter (`typeof x === 'string'`) after `Array.isArray(v)` — defence against a prefs blob that was hand-edited to contain a non-string array element. Narrower than the plan template but cheap and safe."
  - "navrail-icons typed with `ReactNode` instead of `JSX.Element` — React 19's JSX namespace plumbing is stricter; ReactNode is unambiguously re-exported from `react` and future-proofs against React 20 if the namespace ever relocates."
  - "CORE_ORDER is `['dashboard', 'chat', 'settings'] as const` (not derived) — deliberate: the visual order of the three core icons is a design decision, not a data-driven one. Adding a fourth core route is a later-plan policy call; Phase 2 locks to three."
  - ".palette-row-kbd uses `--r-sm` (not the `--r-sm, 6px` fallback that appears in the plan template) — Phase 1 tokens.css always defines --r-sm, and a double-fallback in the CSS would hide a tokens.css regression."

requirements-completed: [SHELL-02, SHELL-03, SHELL-06, SHELL-07]

# Metrics
duration: ~20min
completed: 2026-04-18
---

# Phase 2 Plan 05: CommandPalette + NavRail + useRouter + useGlobalShortcuts + shell.css @import Summary

**Navigation substrate — derived ⌘K palette reading PALETTE_COMMANDS (SC-3 enforced), derived NavRail, in-memory back/forward router, single keydown hook binding ⌘K / ⌘1 / ⌘/ / ⌘, / ⌘[ / ⌘]; closes the Plan 02-03 shell.css @import hand-off. SHELL-02, SHELL-03, SHELL-06, SHELL-07 all closed.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-04-18
- **Tasks:** 2/2
- **Files created:** 6 (useRouter.ts, useGlobalShortcuts.ts, fuzzy.ts, CommandPalette.tsx, NavRail.tsx, navrail-icons.tsx)
- **Files modified:** 3 (shell/index.ts, shell.css, styles/index.css)

## Accomplishments

### Task 1 — Router + shortcuts + fuzzy helper (commit `96f2b65`)

- `useRouter` ships as `RouterProvider` + `useRouterCtx` + a `useRouter` alias from a single file. Initial route resolution runs once in a lazy `useState` initializer (`prefs['app.lastRoute'] ?? prefs['app.defaultRoute'] ?? DEFAULT_ROUTE_ID`), and every transition persists via `setPref('app.lastRoute', id)` (debounced by usePrefs; 250ms). Back/forward history is session-scoped per D-52 — two ref-backed stacks; unknown route ids are logged and ignored (T-02-05-02 mitigation).
- `useGlobalShortcuts({openPalette})` binds one `window.keydown` listener. `⌘K` fires even inside inputs (palette open); every other `Mod+*` key bails on editable targets (`isEditableTarget` walks `INPUT` / `TEXTAREA` / `contentEditable` — T-02-05-05). `RouteDefinition.shortcut` strings (`'Mod+1'`, `'Mod+Shift+G'`, etc.) auto-bind via `shortcutMatches()` — no per-route registration surface (D-62). `ALL_ROUTES` is iterated in registration order so a custom shortcut defined on a core route takes precedence over the hard-coded `Mod+1`/`Mod+/`/`Mod+,` fallbacks if the route declares one.
- `fuzzyScore(cmd, q)` is re-typed from `src.bak/components/CommandPalette.tsx:48-79` per D-17 (reference only, not imported). Three-tier score ladder: exact label substring (100+), char-order fuzzy on label (50-70), description substring (20), no match (-1). Pure function, zero regex, O(label.length) — callable on all 82 `PALETTE_COMMANDS` per keystroke without blowing the frame budget (T-02-05-03 context).

### Task 2 — CommandPalette + NavRail + shell.css @import (commit `830801b`)

- `CommandPalette` imports `PALETTE_COMMANDS` directly — **adding a RouteDefinition anywhere in `src/features/*/index.tsx` automatically surfaces in the palette, no App.tsx / CommandPalette edit required**. SC-3 acceptance is mechanical.
- Empty-query flow: `palette.recent` (JSON-encoded `string[]` in prefs, capped at 5 entries) surfaces at the top, the rest sorts alphabetically. Non-empty-query flow: fuzzy-score every command, drop `s < 0`, sort descending. ArrowUp / ArrowDown / Enter / Esc are wired through `onKeyDown` and the `<Dialog>` primitive's native `<dialog>` cancel event (D-58). Recent-id writes are atomic — `readRecentIds(prior)` → dedupe → `slice(0, MAX_RECENT)` → `setPref('palette.recent', JSON.stringify(...))`.
- `NavRail` derives from `PALETTE_COMMANDS`: `CORE_ORDER` maps the three user-facing core routes in deliberate visual order, then a single-pass loop populates `perSection: Map<Section, RouteDefinition>` with the first non-core route per section — Map iteration preserves insertion order so the section order matches `src/windows/main/router.ts`'s feature-index concat order (D-40). Active state: exact `routeId === r.id` for core, or `routeId.startsWith(section + '-')` for section-first icons (so `settings-providers` highlights the Settings cluster).
- `navrail-icons.tsx` ships 11 inline SVG glyphs (3 core + 8 sections) with a `routeId → section → generic dot` fallback chain — the rail can't render blank even if a future feature forgets to register an icon.
- `shell.css` extended: `.navrail` (sticky 62px column under TitleBar) + `.navrail-logo` + `.navrail-divider` + `.navrail-btn` (hover / active / active::before sidebar pill / `:focus-visible` ring) + `.navrail-tip` (hover tooltip) + `.nav-icon`; `.palette` (640px-max flex column) + `.palette-input` + `.palette-list` + `.palette-row` (+ `:hover` / `.selected` / `-label` / `-desc` / `-kbd`) + `.palette-empty`; and a `dialog.glass:has(.palette)` positioning override that lifts the palette to 25vh for command-palette feel. Every rule references `var(--x)` from `tokens.css`/`layout.css`/`motion.css` — no hardcoded hex outside the deliberate logo gradient.
- `src/styles/index.css` now loads `@import '../design-system/shell/shell.css';` (line 21) after `primitives.css` + `toast.css`, before `tailwindcss`. The Plan 02-03 hand-off is now closed — `.titlebar` (Plan 02-03), `.navrail`, and `.palette` rules all load on main-window boot.

### Plan 02-06 hand-off note

Plan 02-06 (MainShell) is the first surface that mounts these:

```tsx
// Plan 02-06 will compose:
<ConfigProvider>
  <ToastProvider>
    <RouterProvider>
      <TitleBar/>
      <NavRail/>
      {/* route outlet + <Suspense> wrapping ROUTE_MAP.get(routeId)?.component */}
      <GlobalOverlays/>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </RouterProvider>
  </ToastProvider>
</ConfigProvider>
```

and call `useGlobalShortcuts({ openPalette: () => setPaletteOpen(true) })` inside the RouterProvider subtree. Every export shipped here is already typed and ready to import.

## Task Commits

1. **Task 1:** `feat(02-05): useRouter + RouterProvider + useGlobalShortcuts + fuzzy helper` — `96f2b65`
2. **Task 2:** `feat(02-05): CommandPalette + NavRail + shell.css @import` — `830801b`

## Deviations from Plan

### None (structural) — plan executed exactly as written for every user-visible behaviour.

Minor hardening differences from the plan template (each a deliberate tightening, not a scope change):

- **[Rule 3 — Blocking]** `useRouter.ts` kept as `.ts` per plan frontmatter, but Provider is built with `createElement` instead of JSX (a `.ts` file cannot contain JSX with `tsconfig "jsx": "react-jsx"`). Consumer imports are via `@/windows/main/useRouter` — extension invisible. The plan's inline JSX snippet would have failed `npx tsc --noEmit`.
- **[Rule 2 — Hardening]** `readRecentIds` layers a `typeof x === 'string'` filter on top of the plan's `Array.isArray(v)` check. Defence against a hand-edited prefs blob storing non-string elements. Zero runtime cost when the blob is well-formed.
- **[Rule 2 — Hardening]** `navrail-icons.tsx` types `ICONS` as `Record<string, ReactNode>` rather than `Record<string, JSX.Element>` — `ReactNode` is the unambiguously re-exported type from `react` and doesn't depend on the `JSX` namespace global (which relocated in React 19). Same runtime behaviour.
- **[Rule 2 — Hardening]** `.palette-row-kbd kbd` and `.navrail-tip` use `var(--r-sm)` without the plan's double-fallback `var(--r-sm, 8px)` / `var(--r-sm, 6px)`. Phase 1 `tokens.css` always defines `--r-sm: 10px`; the double-fallback would mask a tokens.css regression.
- **[Rule 2 — Hardening]** `.navrail-btn:focus-visible` outline added (not in plan) — matches the TitleBar traffic-light focus ring (`var(--a-cool)`) so keyboard users see the active rail button. T-02-03-05 parity.

## Threat-model outcomes

| Threat ID  | Category        | Disposition | Status | Evidence                                                                                                                                   |
| ---------- | --------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| T-02-05-01 | Tampering       | mitigate    | closed | `readRecentIds` wraps `JSON.parse` in try/catch + `Array.isArray` + `typeof === 'string'` filter; writes always `slice(0, MAX_RECENT)`     |
| T-02-05-02 | Tampering       | mitigate    | closed | `useRouter.openRoute` rejects unknown ids via `ROUTE_MAP.has(id)` check, logs `[useRouter] unknown route id` via `console.warn`            |
| T-02-05-03 | DoS             | mitigate    | closed | `CommandPalette.items` derivation behind `useMemo([query, prefs])`; inner loop is O(PALETTE_COMMANDS.length) ≈ 82, well inside 16ms budget  |
| T-02-05-04 | Tampering       | accept      | n/a    | `fuzzyScore` uses `.includes()` + single-pass char walk — no regex, no ReDoS surface                                                        |
| T-02-05-05 | Elevation       | mitigate    | closed | `isEditableTarget` guard in `useGlobalShortcuts`; only ⌘K fires in editable targets, every other shortcut bails                            |
| T-02-05-06 | Spoofing        | accept      | n/a    | CommandPalette mounted once by MainShell (Plan 02-06) in the main window only; overlay / quickask / hud / ghost don't ship a palette       |
| T-02-05-07 | Tampering       | accept      | n/a    | OS-level shortcuts take precedence when Cmd/Ctrl is held; Tauri doesn't intercept OS hotkeys                                                |
| T-02-05-08 | Info Disclosure | mitigate    | closed | CommandPalette reads `PALETTE_COMMANDS` which is pre-filtered (`ALL_ROUTES.filter(r => !r.paletteHidden)`); no runtime bypass surface       |

## Verification results

- `npx tsc --noEmit` — EXIT=0, empty log
- `npm run verify:all` — 5/5 green:
  - `verify-entries` — 5 HTML entries resolved
  - `verify-no-raw-tauri` — no raw `@tauri-apps/api/core|event` imports outside allowed paths
  - `verify-migration-ledger` — 82 ledger rows, 5 referenced ids tracked
  - `verify-emit-policy` — 58 broadcast emits match allowlist
  - `audit-contrast` — all strict pairs ≥ 4.5:1
- `grep -n "PALETTE_COMMANDS" src/design-system/shell/` — 11 hits across CommandPalette.tsx (5) and NavRail.tsx (3) — confirmed both derive from live source
- `grep -rn "@tauri-apps/api/(core|event)" src/design-system/shell/ src/windows/main/useRouter.ts src/windows/main/useGlobalShortcuts.ts` — **zero** matches (no raw Tauri API usage introduced by this plan)
- `grep "shell.css" src/styles/index.css` — one match on line 21 (the new `@import`)
- `git log --oneline` — `96f2b65` (task 1) + `830801b` (task 2) present

## Known Stubs

None — every exported surface is fully wired:

- `useRouter` has real back/forward/openRoute semantics and persists to prefs
- `useGlobalShortcuts` binds a live `keydown` listener
- `CommandPalette` renders a real route list, navigates on Enter, dismisses on Esc/choose
- `NavRail` renders real icons driven by `PALETTE_COMMANDS`
- `shell.css` rules all reference defined Phase 1 tokens
- `src/styles/index.css` @import is live

The components are not yet *mounted* — Plan 02-06 (MainShell) is the first surface that mounts them. That's explicit sequencing per D-51, not a stub.

## Self-Check: PASSED

**Files created (all present):**
- `src/windows/main/useRouter.ts` — FOUND
- `src/windows/main/useGlobalShortcuts.ts` — FOUND
- `src/design-system/shell/fuzzy.ts` — FOUND
- `src/design-system/shell/CommandPalette.tsx` — FOUND
- `src/design-system/shell/NavRail.tsx` — FOUND
- `src/design-system/shell/navrail-icons.tsx` — FOUND

**Files modified (all present + correct):**
- `src/design-system/shell/index.ts` — exports `TitleBar`, `NavRail`, `CommandPalette`, `NavIcon`
- `src/design-system/shell/shell.css` — `.navrail` / `.navrail-btn` / `.palette` / `.palette-row` / `.palette-row-kbd` all present
- `src/styles/index.css` — `@import '../design-system/shell/shell.css';` present on line 21

**Commits present:**
- `96f2b65` — FOUND (`git log --oneline` → match)
- `830801b` — FOUND (`git log --oneline` → match)
