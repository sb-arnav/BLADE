# Phase 1: Foundation - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Source:** /gsd-discuss-phase (interactive)

<domain>
## Phase Boundary

Phase 1 ships the substrate only — **no feature work**. Exit condition: `npm run tauri dev` + `npm run tauri build` both green, all 5 windows launch without Rust panic, design tokens + 8 primitives + typed wrapper + event hook + route registry + migration ledger live, and P-01..P-06 + P-08 explicitly verified.

**In scope:** 21 requirements (FOUND-01..11, WIN-01..09, WIRE-08) + 6 gate checks (P-01..P-06) + 1 accessibility gate (P-08).

**Out of scope for Phase 1:** Onboarding (Phase 2), Shell (Phase 2), all feature views (Phase 3+). Phase 1 stubs every one of the 59 routes as a `ComingSoonSkeleton phase={N}` so the router is complete and backend pushes (e.g. `capability_gap_detected → openRoute('reports')`) don't land on a 404.

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering from STATE.md (D-01..D-19 already locked in prior phases).

### Primitive API surface (8 primitives)
- **D-20:** Props-variant pattern with strict string unions. Example: `<Button variant="primary" size="md" />` where `variant: 'primary' | 'secondary' | 'ghost'` is a typed literal union. Compile-time error on typo. No CVA, no compound components — the 8 primitives (Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog) don't need that surface yet.
- **D-21:** Primitives showcase lives at a dev-only `/primitives` palette-hidden RouteDefinition, component at `src/features/dev/Primitives.tsx`. Shows every variant × size × state of every primitive on a real glass background. Doubles as the visual testbed for P-08 WCAG contrast manual spot-check. Mounted only in dev builds (`import.meta.env.DEV`).

### Styles + tokens
- **D-22:** Token files split by concern under `src/styles/`:
  - `tokens.css` — root colors, typography, radii, spacing
  - `glass.css` — glass-1/2/3 bg/border/blur/shadow + opacity floor ≥0.55
  - `motion.css` — easings (`--ease-spring`, `--ease-out`, `--ease-smooth`) + durations (`--dur-fast`, `--dur-base`, `--dur-slow`, `--dur-enter`)
  - `layout.css` — `--nav-width`, `--chat-width`, `--title-height`, `--gap`
  - Single `@import` chain from `tokens.css`; all files bundled into the Tailwind pipeline.
- **D-23:** Tailwind v4 strategy — **CSS custom properties are the source of truth; Tailwind bridges via `@theme` using `var(--x)` references.** Motion tokens (cubic-bezier) stay in `:root` only — `@theme` doesn't model them cleanly. Color + radii + spacing tokens get Tailwind utility bridges (`bg-glass-1`, `text-text-strong`, `rounded-card`, `p-sp-4`) via `@theme { --color-glass-1: var(--glass-1-bg); ... }`. Reason: adding a new token = one edit in the source CSS, not two. Scales cleanly for the 3000+ tokens PRIOR_ART.md implies we'll accumulate.
- **D-24:** Fonts self-hosted as WOFF2 under `src/assets/fonts/`. Families: Syne (display), Bricolage Grotesque (body), Fraunces (serif), JetBrains Mono (mono). Offline-first per zero-telemetry promise, faster cold start (no CDN RTT → helps P-01 ≤200ms), removes external request on boot.

### Primitive component library
- **D-35 (location):** `src/design-system/primitives/` — each primitive is its own file + index barrel. Not `src/components/primitives/` (reserved for feature-owned primitive compositions later).

### Typed Tauri wrapper (`src/lib/tauri/`)
- **D-36:** File partition = **one file per Rust module cluster.** Wrappers grow per phase; Phase 1 ships exactly:
  - `_base.ts` — `invokeTyped<T>(command, args)`, `TauriError` class, raw `invoke` re-ban
  - `config.ts` — `getConfig`, `saveConfig`, `getOnboardingStatus`, `completeOnboarding` (needed for ConfigContext boot)
  - `chat.ts` — `sendMessageStream`, `cancelChat` (needed because useChat exists and feeds /wrapper-smoke)
  - `events.ts` — `BLADE_EVENTS` constant + payload types + `useTauriEvent` hook
  - (Other Rust clusters get their own wrapper file in the phase that consumes them — no speculative files.)
- **D-37:** Single `TauriError` class with discriminated `kind: 'not_found' | 'bad_args' | 'rust_error' | 'unknown'` + original `message` + `command` fields. Every wrapper throws `TauriError` on failure; components catch + pattern-match on `.kind`. No per-domain error subclasses.
- **D-38 (naming discipline):** Wrapper function name = camelCase; invoke arg keys = snake_case (cited in JSDoc `@see src-tauri/src/<module>.rs:<fn>`). `invokeTyped` never transforms keys — snake_case is forwarded verbatim to Rust.

### Events
- **D-38-evt:** Event constants live in `src/lib/events/index.ts` as a frozen object: `export const BLADE_EVENTS = { CHAT_TOKEN: 'chat_token', BLADE_QUICKASK_BRIDGED: 'blade_quickask_bridged', ... } as const`. Flat — no nested `BLADE_EVENTS.chat.token`.
- **D-38-payload:** Payload types hand-written TypeScript interfaces in the same file, keyed by event name. No zod, no Rust-side codegen. Phase 1 seeds the 29 events catalogued in `RECOVERY_LOG.md` + the 6 WIRE events (`hormone_update`, `blade_message_start`, `blade_thinking_chunk`, `blade_token_ratio`, `blade_agent_event`, `blade_quickask_bridged`) as forward declarations — even the ones Rust hasn't emitted yet — so the type surface is complete Day 1.
- **D-38-hook:** `useTauriEvent<T>(BLADE_EVENTS.X, handler)` hook handles subscribe/unsubscribe lifecycle with the handler-in-ref pattern (stale-closure-safe). Only permitted event subscription surface per D-13. Raw `listen()` banned outside `src/lib/events/`.

### Route registry + feature index pattern
- **D-39:** `RouteDefinition` shape:
  ```ts
  interface RouteDefinition {
    id: string;              // unique route identifier (kebab-case)
    label: string;           // human-readable; shows in nav + palette
    section: 'core' | 'agents' | 'knowledge' | 'life' | 'identity' | 'dev' | 'admin' | 'body' | 'hive';
    component: React.LazyExoticComponent<React.ComponentType<any>>;
    icon?: React.ComponentType;
    shortcut?: string;        // e.g. 'Mod+K'
    paletteHidden?: boolean;  // true = excluded from ⌘K palette
    description?: string;     // palette subtitle
    phase?: number;           // which phase ships this — drives ComingSoonSkeleton
  }
  ```
- **D-40 (feature index contract):** Each feature cluster at `src/features/<cluster>/` exports `routes: RouteDefinition[]` from its `index.ts`. `src/windows/main/router.ts` explicitly imports every feature's routes and concats — **no auto-discovery**. Explicit imports are grep-able and diffable; no filesystem magic.
- **D-40-default:** Default route resolved as `prefs.app.defaultRoute ?? 'dashboard'`. Static const fallback lives in `src/lib/router.ts`.
- **D-40-palette:** Dev-only routes (`/primitives`, `/wrapper-smoke`, `/diagnostics`) opt into `paletteHidden: true`. Everything else is discoverable in ⌘K by default.

### Config + prefs
- **D-41:** `ConfigContext` lives in main window only. QuickAsk/overlay/HUD/ghost don't need the full BladeConfig; when they need a config snapshot (e.g. QuickAsk needs provider + model selection), they receive it via `emit_to(window_label, 'config_snapshot', payload)` on window create. No shared React Context across webviews — that's not a thing in Tauri multi-window anyway.
- **D-42:** `usePrefs()` hook reads single `blade_prefs_v1` localStorage blob once on mount. Blob shape = flat key-value with **dotted namespaces**:
  ```ts
  interface Prefs {
    'app.defaultRoute'?: string;
    'app.lastRoute'?: string;
    'chat.showTimestamps'?: boolean;
    'chat.inlineToolCalls'?: boolean;
    'ghost.linuxWarningAcknowledged'?: boolean;
    // ... more keys added as surfaces need them
  }
  ```
  Returns `{ prefs, setPref, resetPrefs }`. Writes debounced at 250ms. D-12 discipline: no scattered localStorage — every frontend pref flows through this hook.

### 5 HTML window entries + bootstrap
- **D-43:** HTML template at repo root, one per window:
  - `index.html`, `quickask.html`, `overlay.html`, `hud.html`, `ghost_overlay.html`
  - Minimal body: `<!doctype html><html lang="en"><head>` + `<meta charset="utf-8">` + `<meta name="viewport" content="width=device-width">` + dark-bg default via inline `<style>html,body{background:#000;margin:0}</style>` (prevents white-flash on load before tokens.css hydrates) + `<title>`.
  - Body: `<div id="root"></div><script type="module" src="/src/windows/<name>/main.tsx"></script>`.
  - No inline React, no CSS imports in HTML — everything goes through the bootstrap .tsx file.
- **D-43-vite:** `vite.config.ts` declares all 5 entries under `build.rollupOptions.input`. CI verifies entries-match-files via `scripts/verify-entries.mjs` (D-31).

### Nuke + placeholder strategy
- **D-26:** Day 1 = `rm -rf src/` (src.bak/ already exists, unchanged) → rebuild skeleton:
  1. 5 HTML entries + 5 window bootstraps (`src/windows/<w>/main.tsx`) — WIN-01..05 gate-passable
  2. Design tokens (4 split CSS files) — FOUND-01
  3. 8 primitives + barrel (`src/design-system/primitives/`) — FOUND-02
  4. Typed wrapper base + 4 Phase-1 wrappers (`src/lib/tauri/`) — FOUND-03, 04
  5. Event registry + `useTauriEvent` (`src/lib/events/`) — FOUND-05, 06
  6. Route registry (`src/lib/router.ts`) + main/router.ts — FOUND-07, 08
  7. 59 `RouteDefinition[]` entries across feature index files, each component = `<ComingSoonSkeleton phase={N} />`
  8. `usePrefs` + `ConfigContext` — FOUND-09, 10
  9. Migration ledger seeded — FOUND-11 / P-03
- **D-44:** `ComingSoonSkeleton` component lives at `src/design-system/primitives/ComingSoonSkeleton.tsx`. Uses `GlassPanel` primitive, shows route label + phase number ("Ships in Phase 3") + a subtle placeholder pattern. No buttons, no interactions — pure visual. Dev banner `[Route: /reports · Phase 5]` visible in dev builds only. Backend-pushed routes (`capability_gap_detected → 'reports'`) land here instead of 404.

### Migration ledger (`.planning/migration-ledger.md`)
- **D-28:** Seeded Day 1 with all 59 rows. Seeding script: `scripts/seed-migration-ledger.mjs` walks `src.bak/components/` + reads the App.tsx route union + consults `00-PROTO-FLOW.md` + architecture doc component mapping. Each row: `| old_path | new_component | section | phase | status | cross_refs | notes |`. Initial `status = 'Pending'`. Phases flip to `'Shipped'` when the component lands.
- **D-27:** Enforcement = **CI script + checklist doc, no reviewer-required PR gate.** `scripts/verify-migration-ledger.mjs` runs in CI: parses the ledger, greps `src/` for references to removed route IDs, fails if any orphan exists. A checklist at the top of `migration-ledger.md` documents the invariants (no delete before ship, cross-ref list must be empty when status flips). Reviewer sees the CI failure; no mandatory human sign-off.

### Gate verification (P-01..P-06 + P-08)
- **D-29 (P-01 ≤200ms first paint):** `performance.mark('boot')` at the top of `src/windows/main/main.tsx` before React mounts; `performance.mark('first-paint')` in the Dashboard's first `useEffect`. Compute delta, log to console, assert `delta <= 200ms`. Phase 1's Dashboard is `ComingSoonSkeleton phase={3}` so this measures pure substrate cost — a floor, not a ceiling. Later phases retest the gate with real Dashboard.
- **D-30 (P-04 wrapper smoke-test):** Dev-only `/wrapper-smoke` palette-hidden route at `src/features/dev/WrapperSmoke.tsx`. Iterates every wrapper defined in Phase 1 (`config.ts`, `chat.ts` functions), invokes each with a safe read-only payload, renders a table: `function name | Rust cite | args passed | result | pass/fail`. One click = full smoke test. Grows as later phases add wrappers.
- **D-31 (P-05 Vite-input check):** `scripts/verify-entries.mjs` (Node ESM). Reads `vite.config.ts`, extracts `build.rollupOptions.input` keys, `fs.existsSync` check on each resolved path. Exits non-zero on miss. Wired into `.github/workflows/build.yml` before the Vite build step. Also runnable locally via `npm run verify:entries`.
- **D-32 (P-06 listener leak, Playwright):** Add `@tauri-apps/test` or equivalent Playwright+Tauri harness. Test `tests/e2e/listener-leak.spec.ts`:
  1. Boot dev build headlessly
  2. `openRoute('chat')` → `openRoute('dashboard')` × 5
  3. Emit a test event from Rust (`app.emit_to('main', 'test_event', null)`)
  4. Assert: handler call count == 1 (event fired once, consumed once)
  5. Assert: dev `useTauriEvent` counter (`window.__BLADE_LISTENERS_COUNT__`) == N (stable — no growth across churn)
  Phase 1 brings this harness online for the first time; later phases extend it.
- **D-33 (P-08 WCAG):** Two-pronged. (a) `scripts/audit-contrast.mjs` parses `tokens.css` + `glass.css`, computes WCAG 2.1 contrast ratios for every documented text-on-background pair, fails if any < 4.5:1. (b) Manual Phase 1 checklist: screenshot the `/primitives` route over the 5 test wallpapers, eyeball contrast. Test wallpapers: macOS Sonoma light, Sonoma dark, Sequoia Iridescence, Monterey Hello, a bright custom (user picks). Screenshots stored at `.planning/phases/01-foundation/wcag-screenshots/`.
- **D-34 (invoke/listen ban):** Custom ESLint rule at `eslint-rules/no-raw-tauri.js`. Fails on:
  - `import { invoke } from '@tauri-apps/api/core'` outside `src/lib/tauri/`
  - `import { listen } from '@tauri-apps/api/event'` outside `src/lib/events/`
  Runs in editor + pre-commit hook + CI. `scripts/verify-no-raw-tauri.sh` is the CI backstop (grep-based) in case ESLint is bypassed.

### WIRE-08: `emit_all` classification + regression prevention
- **D-45:** Phase 1 executes the refactors classified single-window in `00-EMIT-AUDIT.md`: every `emit_all` at those sites becomes `emit_to(window_label, ...)`. Cross-window `emit_all` sites stay (allowlist).
- **D-45-regress:** `scripts/verify-emit-policy.mjs` greps `src-tauri/src/` for `emit_all(` and `app.emit(`. Cross-references the allowlist embedded in `00-EMIT-AUDIT.md` (the rows classified cross-window). Fails if any `emit_all` call is not in the allowlist. CI wires it. Prevents regression where a new feature introduces a single-window `emit_all` and bleeds state across windows.

### Claude's Discretion
- Exact class-name / utility conventions inside primitives (e.g. how `<Button variant="primary">` maps to `bg-accent` vs a dedicated `.btn-primary` class). Planner decides; result must be grep-able + tokens-backed.
- ESLint rule implementation details — plain AST check vs regex-based.
- Exact bundle of VS Code `.vscode/settings.json` + `extensions.json` entries that surface the ESLint rule to developers.
- Exact CI log formatting for verify scripts.
- Exact Playwright+Tauri harness dep choice (`@tauri-apps/test` vs `tauri-driver` vs spawning dev binary). Planner picks whichever has a working recipe for Tauri 2.10 on Linux CI.
- Storybook vs showcase route already decided — no discretion here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — core value, requirements, constraints
- `.planning/REQUIREMENTS.md` §FOUND-01..11, §WIN-01..09, §WIRE-08 — the 21 Phase 1 requirements with exact acceptance text
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — goal, depends-on, success criteria 1-7
- `.planning/STATE.md` — current position, locked D-01..D-19 decisions, P-01..P-06 gate summary
- `.planning/RECOVERY_LOG.md` — Phase 0 output; QuickAsk↔Main bridge, voice orb events, event catalog, emit_all classification, prototype flow map, Liquid Glass tokens. **MUST READ**.

### Phase 0 artifacts (inputs to Phase 1)
- `.planning/phases/00-pre-rebuild-audit/00-CONTEXT.md` — Phase 0 decisions incl. D-17 (src.bak is dead reference)
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — Rust command signatures, event names, payload shapes (seeds Phase 1 event registry + wrapper cites)
- `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` — 247-site classification of `emit_all` calls; drives WIRE-08 refactor scope + D-45 regression allowlist
- `.planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md` — 11 prototype screens mapped to user flow contracts; input to migration ledger seeding + ComingSoonSkeleton phase mapping

### Architecture authority
- `docs/architecture/2026-04-17-blade-frontend-architecture.md` — current state + target structure; the "what clearly broken" and "what genuinely still to build" sections drive Phase 1 scope. **MUST READ**.
- `docs/architecture/2026-04-16-blade-body-architecture-design.md` — backend pair doc (context only; Phase 1 is frontend)

### Design authority (visual + flow source of truth)
- `docs/design/shared.css` — glass tier CSS vars + radii + motion + typography to port into `src/styles/`
- `docs/design/proto.css` — prototype-layer composition rules
- `docs/design/orb.css` — orb motion math (not used in Phase 1 — referenced for Phase 4, but tokens.css must accommodate without retrofit)
- `docs/design/*.html` + `.png` — 11 prototypes covering onboarding ×3, dashboard, dashboard-chat, voice-orb + states, ghost-overlay, quickask ×2, settings. Phase 1 doesn't build these surfaces but the design tokens must cover their needs.

### Research (already synthesized)
- `.planning/research/SUMMARY.md` — consolidated summary; Phase 1 "Build-Order Punch List" section is directly actionable. **MUST READ**.
- `.planning/research/STACK.md` — Liquid Glass CSS pattern, Vite multi-entry config, typed wrapper recipe, motion token design
- `.planning/research/ARCHITECTURE.md` — directory layout target, route registry contract, window topology, state rules (§"design system boundary" is canonical for primitives)
- `.planning/research/PITFALLS.md` — P-01..P-08 full detail with exact line cites; Phase 1 gate checks reference these IDs
- `.planning/research/PRIOR_ART.md` — OpenClaw math, Cluely content protection, tuned constants. Phase 1 doesn't implement orbs/ghost but tokens.css must not block those values (e.g. must accommodate `0.12` scale multiplier, `0.06` speaking amplitude without token retrofit in Phase 4)
- `.planning/research/FEATURES.md` — 18 surface clusters; informs the `section` enum of `RouteDefinition`

### Codebase maps
- `.planning/codebase/CONVENTIONS.md` — Rust module registration 3-step rule, 6-place config rule
- `.planning/codebase/ARCHITECTURE.md` — current architecture; audit starting point
- `.planning/codebase/STRUCTURE.md` — directory layout; 159 Rust modules enumerated

### Rust source (authoritative for wrapper cites)
- `src-tauri/src/lib.rs` — `generate_handler![]` at ~line 600+; 764-command inventory
- `src-tauri/src/commands.rs` — `send_message_stream`, `cancel_chat`; chat streaming events
- `src-tauri/src/config.rs` — `BladeConfig`, `get_config`, `save_config`, keyring wiring
- `src-tauri/src/body_registry.rs` — subsystem enumeration (informs `section` values, not used directly in Phase 1)

### Explicitly NOT to read
- `src.bak/` — dead reference per D-17. Do not mine for patterns. Only consulted as read-only ground truth when seeding the migration ledger (what old routes existed + their filenames) via `scripts/seed-migration-ledger.mjs`, which runs once and commits the output.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets (very little — `src/` is being nuked)
- `package.json` existing deps: React 19, Vite 7, Tauri 2.10, Tailwind v4 via `@tailwindcss/postcss`. Phase 1 does NOT change these; adds only: WOFF2 fonts, @tauri-apps/test (or similar), any ESLint ruleset needed for the custom rule.
- `vite.config.ts` — keep the declared 5 entries; Phase 1 ensures all 5 HTML files exist on disk.
- `tsconfig.json` — paths + strict flags. Phase 1 adds `"paths": { "@/*": ["./src/*"] }` so all new code uses `@/` alias.

### Established patterns (from backend, not frontend)
- Tauri commands are snake_case Rust functions registered in `generate_handler![]` macro. Wrappers cite `file:line` in JSDoc — this pattern extends what `src-tauri/src/CLAUDE.md` calls the "module registration 3-step rule".
- Event emissions are `emit_all(name, payload)` or `emit_to(label, name, payload)`. Frontend subscribes via the Tauri `listen` API; `useTauriEvent` hook is the only permitted React-side surface.
- Config has the 6-place rule; frontend ConfigContext reads from `get_config` once; writes go through `save_config`.

### Integration points (Rust → Phase 1 frontend)
- `commands.rs` — `send_message_stream` feeds `chat.ts` wrapper; `blade_stream_chunk`/`blade_stream_done`/`blade_thinking_chunk` drive `BLADE_EVENTS.CHAT_*` keys
- `config.rs` — `get_config`/`save_config`/`get_onboarding_status`/`complete_onboarding` feed `config.ts` wrapper + `ConfigContext`
- `homeostasis.rs` — emits `hormone_update` (per WIRE-02, stubbed in Phase 3); Phase 1 declares the event type + payload shape in `events/index.ts`
- `overlay_manager.rs:76`, `ghost_mode.rs:472`, `lib.rs:349-366` — Rust window creation sites; Phase 1 creates the 3 missing HTML entries so these stop panicking.

### Dev experience patterns Phase 1 establishes
- All dev-only routes (`/primitives`, `/wrapper-smoke`, `/diagnostics`) are palette-hidden + gated on `import.meta.env.DEV`.
- All CI verification scripts live in `scripts/` as Node ESM (`.mjs`); runnable via `npm run verify:<check>`.
- ESLint custom rules live in `eslint-rules/` at repo root; configured in `.eslintrc.cjs` or `eslint.config.js` depending on what the current repo uses.

</code_context>

<specifics>
## Specific Ideas

**From Arnav (direction locked during discussion):**
- *"You know better. Just ask granularly; you can ask as much as you want."* — user delegates implementation-pattern picks to Claude, reserving intervention for places where taste differs. Answered 16+ granular questions without deflection; accepted all "(Recommended)" defaults except chose Playwright+Tauri over manual checklist for P-06 (more rigor) and requested "scalable, not a patch" for Tailwind strategy (drove D-23 toward CSS-vars-first).
- *"Scalable, not some patch or temporary thing."* — applied to Tailwind integration (D-23). Also informs other decisions: file splits (D-22, D-36), explicit imports over auto-discovery (D-40), CI-enforced invariants over manual checks (D-27, D-31, D-32, D-33, D-34, D-45).

**From the prototypes (already directional):**
- Liquid Glass = the one aesthetic. No theme switcher, no accent picker. `AccentPicker.tsx` will NOT be ported from `src.bak/`.
- Dark background default on HTML entries prevents white-flash on load (D-43).
- Glass blur caps 20/12/8 (D-07 from STATE) — tokens.css bakes these as the ceiling; no component can set higher via prop override.

**From PRIOR_ART.md (tuned constants to accommodate, not implement):**
- VoiceOrb math (0.12 scale multiplier, 0.06 speaking amplitude, 6Hz sine, 0.28 ring stagger, 0.45/0.55 EMA, 12fps audio throttle) — token system must not block Phase 4 from implementing these verbatim.
- Ghost Mode format (≤6-word headline, 1-2 bullets, ≤60 chars/line) — typography tokens must accommodate.

</specifics>

<deferred>
## Deferred Ideas

- **Storybook.** Explicitly ruled out in D-21 for Phase 1; could be reconsidered in Phase 9 (Polish Pass) if component count explodes. Not in backlog today.
- **Zod for event payload schemas.** D-38-payload picks hand-written TS. If payload drift becomes painful in Phase 5+ (when cluster work is parallel and contracts matter more), revisit. Adding zod later is a mechanical refactor.
- **Auto-discovery of feature indexes.** D-40 picks explicit imports. If feature count grows past ~30 clusters, revisit. Not in backlog today.
- **Real Dashboard P-01 measurement.** Phase 1's P-01 gate measures with `ComingSoonSkeleton` (a floor). Phase 3 must retest with actual Dashboard + ambient strip + `hormone_update` subscription.
- **CJK IME shortcut audit for QuickAsk.** P-09, not in Phase 1 scope — Phase 4.
- **Linux content-protection warning banner for Ghost Mode.** P-16, not in Phase 1 scope — Phase 4.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-18 via /gsd-discuss-phase*
