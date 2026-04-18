---
phase: 01-foundation
plan: 02
subsystem: design-system
tags: [tokens, glass, typography, tailwind-v4, fonts, woff2]
requires: [01-01]           # nuked src + wired @/* alias + vite entries
provides: [01-04, 01-05, 01-06, 01-07, 01-08, 01-09]   # every downstream primitive pulls from these tokens
affects: [all subsequent plans in Phase 1+]
tech_added:
  - "Self-hosted WOFF2 fonts (Syne, Bricolage Grotesque, Fraunces, JetBrains Mono)"
  - "Tailwind v4 @theme bridge pattern (CSS vars source of truth, utilities via var())"
patterns:
  - "D-22 split-by-concern CSS under src/styles/"
  - "D-23 Tailwind @theme references :root vars, not duplicate values"
  - "D-24 self-hosted fonts — no runtime CDN calls"
key_files_created:
  - src/styles/tokens.css
  - src/styles/glass.css
  - src/styles/motion.css
  - src/styles/layout.css
  - src/styles/typography.css
  - src/styles/index.css
  - src/assets/fonts/syne-400.woff2
  - src/assets/fonts/syne-700.woff2
  - src/assets/fonts/bricolage-400.woff2
  - src/assets/fonts/bricolage-600.woff2
  - src/assets/fonts/fraunces-400.woff2
  - src/assets/fonts/fraunces-600.woff2
  - src/assets/fonts/jetbrains-400.woff2
  - src/assets/fonts/jetbrains-600.woff2
  - src/assets/fonts/SOURCES.md
key_files_modified:
  - src/windows/main/main.tsx
  - src/windows/quickask/main.tsx
  - src/windows/overlay/main.tsx
  - src/windows/hud/main.tsx
  - src/windows/ghost/main.tsx
decisions:
  - "D-07 enforced: blur caps 20/12/8 baked into glass.css — no 32 anywhere"
  - "RECOVERY_LOG §B.12 enforced: radii use proto.css (HIG) values — --r-sm:10, --r-md:16, --r-lg:20, --r-xl:28, --r-2xl:40"
  - "D-23 bridge lives in index.css @theme block; motion tokens stay in :root only (cubic-bezier not @theme-modelable)"
  - "D-24 self-host: fonts fetched at build time, committed as WOFF2 binaries, served from /src/assets/fonts/ at runtime"
metrics:
  duration_minutes: 22
  tasks_completed: 3
  commits: 3
  files_created: 15
  files_modified: 5
  completed_date: 2026-04-18
---

# Phase 1 Plan 02: Design Tokens + Self-Hosted Fonts + Typography — Summary

Liquid Glass design substrate is live. 6 CSS files under `src/styles/` codify every color, radius, spacing, motion, font-family, and layout token BLADE will use through Phase 9. 8 WOFF2 font binaries are self-hosted under `src/assets/fonts/` with zero runtime CDN dependency. All 5 window bootstraps now import `@/styles/index.css` — tokens reach main / quickask / overlay / hud / ghost without per-window duplication.

## Scope delivered (FOUND-01)

### 6 CSS files under `src/styles/`

| File | Purpose | Key invariants |
| --- | --- | --- |
| `tokens.css` | colors, radii, spacing, fonts, text opacities | Radii use proto.css / HIG values (§B.12). `--t-3 >= 0.50` (P-08 opacity floor). |
| `glass.css` | `.glass` + `.glass-1/2/3` tier classes | Blur capped at **20 / 12 / 8** per tier (D-07). Never 32. `@supports not (backdrop-filter)` fallback to solid panel. |
| `motion.css` | easings, durations, orb constants, `@keyframes spin` | `--ease-spring = cubic-bezier(0.22, 1, 0.36, 1)`. Phase 4 orb constants (`--orb-rms-alpha: 0.55`, `--orb-throttle: 83`) declared up front — no retrofit. |
| `layout.css` | nav / chat / title-bar widths | `--nav-width: 76px`, `--chat-width: 420px`, `--title-height: 40px`. |
| `typography.css` | 8 `@font-face` blocks + type scale | Every face is `font-display: swap` (no FOIT / P-01 stall). Scale classes `.t-h1 / h2 / h3 / body / small / mono`. |
| `index.css` | barrel + Tailwind v4 `@theme` bridge | 5 sibling `@import`s before `@import 'tailwindcss'`; `@theme` references `var(--x)` so CSS vars remain source of truth (D-23). |

### 8 self-hosted WOFF2 binaries

| File | Size | Family / weight |
| --- | --- | --- |
| `syne-400.woff2` | 13 264 B | Syne 400 (display) |
| `syne-700.woff2` | 14 072 B | Syne 700 (display) |
| `bricolage-400.woff2` | 22 364 B | Bricolage Grotesque 400 (body) |
| `bricolage-600.woff2` | 22 456 B | Bricolage Grotesque 600 (body) |
| `fraunces-400.woff2` | 17 968 B | Fraunces 400 (serif) |
| `fraunces-600.woff2` | 18 096 B | Fraunces 600 (serif) |
| `jetbrains-400.woff2` | 21 168 B | JetBrains Mono 400 (mono) |
| `jetbrains-600.woff2` | 21 860 B | JetBrains Mono 600 (mono) |

Every file >=10 KB (W1 invariant met, no 0-byte placeholder shipped). Every weight-pair byte-distinct under `cmp -s` (W2 invariant met — no duplicate-URL regression).

`src/assets/fonts/SOURCES.md` records per-file pinned version + origin URL + SIL OFL 1.1 license attestation.

### 5 bootstraps wired

All of `src/windows/{main,quickask,overlay,hud,ghost}/main.tsx` now carry `import '@/styles/index.css'` at the top. In `main/main.tsx` this import sits ABOVE `performance.mark('boot')` (D-29 — the mark measures React bootstrap cost, not CSS parse). The main bootstrap's placeholder `<div>` was also updated to `className="t-body"` as a smoke-test that the typography class reaches the DOM once Vite's CSS pipeline runs.

## Commits

| Commit | Message |
| --- | --- |
| `978662c` | `feat(01-02): design tokens + glass/motion/layout CSS (D-22 split, blur caps 20/12/8)` |
| `628583b` | `feat(01-02): self-host 8 WOFF2 fonts + typography.css (D-24)` |
| `4585a8b` | `feat(01-02): wire @/styles/index.css into all 5 window bootstraps` |

## Verification

All checks from the plan's `<verification>` block passed on the last commit:

- **Files present** — all 6 CSS files exist at the expected paths.
- **Blur caps** — `grep -n "blur(" src/styles/glass.css` shows only `blur(20px) / blur(12px) / blur(8px)` plus a single `blur(1px)` inside the `@supports not` feature-detection probe (not rendered). Zero `blur(32px)` occurrences.
- **Fonts self-hosted** — 8 `.woff2` files present, all >=10 KB, W2-distinct.
- **Tailwind `@theme`** — present in `index.css` with `var(--x)` bridge pattern.
- **No CDN imports** — `grep -r "fonts.googleapis\|fonts.gstatic" src/styles/` returns nothing.
- **Bootstrap wiring** — all 5 windows carry `import '@/styles/index.css'` in their first 3 lines.
- **TypeScript** — `npx tsc --noEmit` exits 0 (zero errors, zero new diagnostics).

## Deviations

### Deviation 1 (Rule 3 — blocked infrastructure, substituted equivalent): font download channel

The plan specified a direct-download recipe using the Google Fonts CSS2 API (`fonts.googleapis.com/css2?...`) to resolve per-weight WOFF2 URLs, then `curl` from `fonts.gstatic.com`. Both hosts were **unreachable from this build sandbox** — TCP connects, but the TLS handshake times out at 30+ seconds on every attempt (connectivity restriction, not a BLADE issue).

The plan also mandated "if network fails, FAIL LOUDLY — do NOT write placeholders." That rule was honored: no 0-byte files were written.

Instead, substituted the `@fontsource/<family>` packages on npm (version-pinned: `@fontsource/syne@5.2.7`, `@fontsource/bricolage-grotesque@5.2.10`, `@fontsource/fraunces@5.2.9`, `@fontsource/jetbrains-mono@5.2.8`) via their jsdelivr mirror (`cdn.jsdelivr.net` is reachable from this sandbox). Fontsource is the self-hosting channel actively blessed by the Google Fonts team; each package ships the byte-equivalent Latin-subset WOFF2 binaries that `fonts.gstatic.com` serves, under the same SIL OFL 1.1 license.

**Why this satisfies D-24:** the decision's intent was "no runtime call to a Google CDN + faster cold start." Since the files are committed to the repo and served from `/src/assets/fonts/*` at runtime, there is still zero runtime network dependency regardless of which build-time channel produced the bytes. Grep CI remains green: `fonts.googleapis.com` and `fonts.gstatic.com` appear nowhere in `src/`.

**Reproducibility:** exact URLs pinned in `src/assets/fonts/SOURCES.md`. If a future CI environment can reach `fonts.gstatic.com`, the binaries can be re-pulled from the original Google URLs and will produce byte-equivalent Latin-subset files.

### No other deviations.

No Rule 1 bug fixes, no Rule 2 missing functionality, no Rule 4 architectural asks. Plan executed as written with one infrastructure substitution.

## Handoff notes

- **Plan 04 (GlassPanel primitive)** must enforce the blur cap at the React prop level — i.e. no `blur` prop, just a `tier: 1 | 2 | 3` that selects `.glass-1 / glass-2 / glass-3`. The CSS tier classes are the only legitimate interface to backdrop-filter.
- **Plan 09 (WCAG audit)** will parse `tokens.css` (text opacities) + `glass.css` (tier fills) and run `audit-contrast.mjs`. The opacity floor is already baked as `--t-3: rgba(255,255,255,0.50)`.
- **Phase 4 (VoiceOrb)** can consume `--orb-rms-alpha` and `--orb-throttle` directly from `motion.css` — no retrofit needed.
- **Vite asset resolution:** `typography.css` references fonts as `/src/assets/fonts/<name>.woff2`. In dev this resolves against the Vite dev-server root; in prod Vite hashes and rewrites the path during build. The bootstraps pull `@/styles/index.css` through the `@/*` alias wired by Plan 01-01.

## Known Stubs

None. Every token has a concrete value; every CSS file is production-grade. The main bootstrap's `<div className="t-body">` placeholder is the Plan-01-01-established bootstrap scaffold — it lands routing in Plan 07 but that's tracked as the router plan's scope, not a stub of this plan's design-system surface.

## Threat Flags

None. This plan doesn't add network endpoints, auth paths, or file-access patterns. The only trust boundary it touches (font CDN download) is a one-time build-time event; binaries committed to the repo mean zero runtime network surface. The plan's `<threat_model>` disposition for T-02-02 (info disclosure via CDN beacon) is fully mitigated — no `fonts.googleapis.com` or `fonts.gstatic.com` URLs exist in any shipped source file.

## Self-Check: PASSED

- `src/styles/tokens.css` — FOUND
- `src/styles/glass.css` — FOUND
- `src/styles/motion.css` — FOUND
- `src/styles/layout.css` — FOUND
- `src/styles/typography.css` — FOUND
- `src/styles/index.css` — FOUND
- `src/assets/fonts/syne-400.woff2` — FOUND (13264 B)
- `src/assets/fonts/syne-700.woff2` — FOUND (14072 B)
- `src/assets/fonts/bricolage-400.woff2` — FOUND (22364 B)
- `src/assets/fonts/bricolage-600.woff2` — FOUND (22456 B)
- `src/assets/fonts/fraunces-400.woff2` — FOUND (17968 B)
- `src/assets/fonts/fraunces-600.woff2` — FOUND (18096 B)
- `src/assets/fonts/jetbrains-400.woff2` — FOUND (21168 B)
- `src/assets/fonts/jetbrains-600.woff2` — FOUND (21860 B)
- `src/assets/fonts/SOURCES.md` — FOUND
- Commit `978662c` — FOUND
- Commit `628583b` — FOUND
- Commit `4585a8b` — FOUND
