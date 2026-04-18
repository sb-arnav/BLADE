# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 01-foundation
**Areas discussed:** Primitive API pattern, variant types, primitives showcase, token file structure, Tailwind v4 strategy, font loading, default route, nuke strategy, migration ledger enforcement, migration ledger seeding, P-01 measurement, P-04 wrapper smoke-test, P-05 CI check, P-06 listener leak test, P-08 WCAG verification, raw invoke/listen ban enforcement, repo directory structure, typed wrapper partition, typed wrapper scope, TauriError shape, event naming, RouteDefinition shape, feature index contract, ConfigContext scope, usePrefs blob shape, 5 HTML templates, Vite config, ComingSoonSkeleton, WIRE-08 regression prevention.

**Mode:** Interactive. User opened with "you know better — drive it and ask granularly." 17 questions asked across 5 AskUserQuestion batches. 15 answers accepted Recommended defaults; 1 was a free-text override (Tailwind → "scalable, not a patch" — drove D-23 toward CSS-vars-first); 1 was a non-recommended pick (P-06 → Playwright automation over manual checklist). No area generated follow-up rounds.

---

## Primitive API pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Props-variant (Recommended) | `<Button variant="primary" size="md" />` with typed unions. Simplest, matches prototype CSS classes, Tailwind v4 native, no extra deps. | ✓ |
| Compound components | `<Card><Card.Header/>...</Card>` — more flexibility, more API surface. | |
| CVA-like class-variance util | ~30-line util mapping props → class strings. More power for later. | |

**User's choice:** Props-variant (Recommended). → **D-20.**
**Notes:** No follow-up. Maps cleanly to the 8 self-built primitives in D-01.

---

## Primitive variant strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Strict string unions (Recommended) | `variant: 'primary' \| 'secondary' \| 'ghost'` — compile-time error on typo. | ✓ |
| Open strings with runtime validation | `variant: string` + dev-time warning. More flexible for experiments. | |

**User's choice:** Strict string unions. → **D-20** (embedded).

---

## Primitives showcase

| Option | Description | Selected |
|--------|-------------|----------|
| Dev-only /primitives palette-hidden route (Recommended) | `src/features/dev/Primitives.tsx`, mounted only in dev builds, doubles as P-08 testbed. | ✓ |
| No showcase | Rely on prototype HTML + real pages. | |
| Storybook | Full Storybook setup — a new build pipeline for 8 primitives. | |

**User's choice:** Dev-only route. → **D-21.**

---

## Token file structure

| Option | Description | Selected |
|--------|-------------|----------|
| Split by concern (Recommended) | `tokens.css`, `glass.css`, `motion.css`, `layout.css`; single @import chain. | ✓ |
| Single tokens.css | Everything in one file — matches current src/index.css shape. | |
| Inline in Tailwind @theme only | Tokens live in @theme block; Tailwind owns them. | |

**User's choice:** Split by concern. → **D-22.**

---

## Tailwind v4 integration

| Option | Description | Selected |
|--------|-------------|----------|
| CSS vars are source of truth; Tailwind consumes them via @theme (Recommended) | `:root { --glass-1-bg }` in tokens.css + `@theme { --color-glass-1: var(--glass-1-bg) }`. Motion stays in `:root`. | — |
| Tailwind v4 @theme is source of truth | Tokens live in @theme; Tailwind generates utilities. Motion modeling awkward. | |
| :root only; Tailwind for layout utilities | No @theme bridge; components use var(--x) directly. | |

**User's choice:** Free-text — *"You decide. I need something that is scalable, not some patch or temporary thing."*
**Claude's interpretation:** Option 1 (CSS vars source of truth, Tailwind bridges via @theme). → **D-23.**
**Notes:** User's scalability requirement drove the pick. Same principle applied downstream to file splits (D-22, D-36), explicit imports (D-40), CI-enforced invariants (D-27, D-31..34, D-45).

---

## Font loading

| Option | Description | Selected |
|--------|-------------|----------|
| Self-host WOFF2 in src/assets/fonts/ (Recommended) | Offline-first, faster cold start, zero-telemetry aligned. Cost: ~400KB in binary. | ✓ |
| Keep Google Fonts CDN | Simpler; contradicts zero-telemetry; 100-300ms on boot. | |

**User's choice:** Self-host. → **D-24.**

---

## Default route on boot

| Option | Description | Selected |
|--------|-------------|----------|
| Prefs-driven with const fallback (Recommended) | `prefs.app.defaultRoute ?? 'dashboard'`. Changeable via Settings. | ✓ |
| Static const only | Always `'dashboard'`. Simplest. | |
| Config-driven via BladeConfig (Rust) | Add to BladeConfig (6-place rule). Overkill for UI pref. | |

**User's choice:** Prefs-driven. → **D-25 / D-40-default.**

---

## Nuke strategy (Day 1)

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: nuke + stub 59 routes with ComingSoonSkeleton (Recommended) | `rm -rf src/` → rebuild 5 windows + shell + 59 route stubs. Dev mode usable. No 404s. | ✓ |
| Clean slate | Nuke + build only Foundation + /primitives. Backend pushes hit 404. | |
| Progressive | Keep src/, replace subtree by subtree. Old + new fight. | |

**User's choice:** Hybrid with placeholders. → **D-26 + D-44 (ComingSoonSkeleton).**

---

## Migration ledger enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Both: manual checklist + CI grep (Recommended) | Belt + suspenders. | |
| CI grep only | Script in CI; no PR-blocking human review. | — |
| Manual review only | Human checks in PR. Easy to miss across 59 routes × 10 phases. | |

**User's choice:** Free-text — *"Keep it CI/CD only and make a checklist for that to make sure that nothing gets lost around."*
**Claude's interpretation:** CI script is the enforcer + a checklist doc (embedded in migration-ledger.md header or adjacent). No reviewer-required PR gate. → **D-27.**

---

## Migration ledger seeding

| Option | Description | Selected |
|--------|-------------|----------|
| Seed all 59 rows Day 1 with status=Pending (Recommended) | `scripts/seed-migration-ledger.mjs` writes every row upfront. | ✓ |
| Seed incrementally per phase | Each phase adds its own rows. No single pane of "what's pending". | |

**User's choice:** Seed all 59. → **D-28.**

---

## P-01 first-paint measurement

| Option | Description | Selected |
|--------|-------------|----------|
| performance.mark + log to console (Recommended) | `performance.mark('boot')` in main.tsx, `performance.mark('first-paint')` in Dashboard; compute delta. Reproducible. | ✓ |
| about:tracing one-off | Manual DevTools trace. More accurate, not reproducible. | |
| React Profiler | Measures render time, not paint. Misleading. | |

**User's choice:** performance.mark. → **D-29.**

---

## P-04 typed wrapper smoke-test

| Option | Description | Selected |
|--------|-------------|----------|
| Dev-only /wrapper-smoke route (Recommended) | Iterates Phase 1 wrappers, shows pass/fail table. | ✓ |
| Shell script + Rust log grep | CI-runnable; needs a headless Tauri setup that doesn't exist. | |
| Doc checklist only | Manual verification; weakest. | |

**User's choice:** Dev-only route. → **D-30.**

---

## P-05 Vite-input CI check

| Option | Description | Selected |
|--------|-------------|----------|
| scripts/verify-entries.mjs wired into GH Actions (Recommended) | Standalone Node ESM. Clear failures. Runnable locally. | ✓ |
| Inline in package.json scripts | One-liner. Unreadable when check grows. | |
| Vite plugin | Only runs during Vite builds. Overkill. | |

**User's choice:** Standalone script. → **D-31.**

---

## P-06 listener leak test

| Option | Description | Selected |
|--------|-------------|----------|
| Manual nav checklist + dev counter (Recommended) | Dev instrumentation + printable checklist. Cheap. | |
| Playwright automation | Automated Tauri+Playwright; more rigorous; new tooling. | ✓ |
| Rust-side event counter | Indirect; misses the React side where P-06 fails. | |

**User's choice:** Playwright automation (non-Recommended). → **D-32.**
**Notes:** Bumps Phase 1 scope slightly — adds `@tauri-apps/test` or equivalent harness + a new CI job. Chose rigor over speed. Listener-leak-specific harness will be reused by later phases (it's not throwaway).

---

## P-08 WCAG 4.5:1 verification

| Option | Description | Selected |
|--------|-------------|----------|
| Programmatic token audit + manual 5-wallpaper spot-check (Recommended) | `scripts/audit-contrast.mjs` + screenshot checklist. | ✓ |
| axe-core in dev route | Broader a11y checks; doesn't simulate backdrop-filter over wallpaper. | |
| Manual macOS DigitalColor Meter only | Thorough, not repeatable. | |

**User's choice:** Programmatic + manual hybrid. → **D-33.**

---

## Raw invoke / listen ban enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| ESLint custom rule + CI grep backstop (Recommended) | Editor-time enforcement + pre-commit + CI. | ✓ |
| CI grep only | Catches at merge-time; not editor-time. | |
| Code review only | No automation. Too weak for a rule with 234 existing violations. | |

**User's choice:** ESLint + CI. → **D-34.**

---

## Lower-stakes defaults (Claude-picked; user confirmed without adjustment)

Presented as a single "Accept all / adjust specific categories" question. User selected **Accept all defaults — write CONTEXT.md now**.

Locked defaults:
- Directory structure: `src/{windows,design-system,features,styles,lib,assets}/` (→ D-35)
- Typed wrapper partition: per Rust module cluster; Phase 1 ships `_base + config + chat + events` (→ D-36)
- `TauriError` with discriminated `kind` union (→ D-37)
- Event naming: flat `BLADE_EVENTS` const with snake_case backend names (→ D-38-evt)
- Event payloads: hand-written TS interfaces (→ D-38-payload)
- `useTauriEvent<T>` hook with handler-in-ref pattern (→ D-38-hook)
- `RouteDefinition` shape with `{id, label, section, component, icon?, shortcut?, paletteHidden?, description?, phase?}` (→ D-39)
- Feature index contract: `export routes: RouteDefinition[]`; explicit imports in `windows/main/router.ts` (→ D-40)
- `ConfigContext` main-window only; other windows via `emit_to('config_snapshot', ...)` (→ D-41)
- `usePrefs` dotted namespaced keys; debounced writes (→ D-42)
- 5 HTML templates: minimal, dark-bg default (→ D-43)
- `ComingSoonSkeleton` using GlassPanel + phase number label (→ D-44)
- WIRE-08: `scripts/verify-emit-policy.mjs` + allowlist from `00-EMIT-AUDIT.md` (→ D-45)

---

## Claude's Discretion (explicitly deferred)

- Internal class-name conventions inside primitives (how `variant="primary"` maps to Tailwind class sets).
- ESLint rule implementation details (AST vs regex).
- `.vscode/settings.json` + extensions list to surface the ESLint rule.
- CI log formatting for verify scripts.
- Playwright+Tauri harness dep choice (`@tauri-apps/test` vs `tauri-driver` vs spawned dev binary).

## Deferred Ideas

- Storybook — revisit in Phase 9 if component count explodes.
- Zod payload schemas — revisit in Phase 5+ if payload drift becomes painful.
- Auto-discovery of feature indexes — revisit past ~30 clusters.
- Real Dashboard P-01 retest — Phase 3 work.
- QuickAsk CJK shortcut audit (P-09) — Phase 4.
- Linux Ghost Mode warning (P-16) — Phase 4.

---

*Generated: 2026-04-18 via /gsd-discuss-phase*
