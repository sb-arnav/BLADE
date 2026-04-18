---
phase: 01-foundation
plan: 09
subsystem: gate-infrastructure
status: PARTIAL
tags: [verify-scripts, eslint-rule, dev-surfaces, playwright, ci-wiring, checkpoint-pending]
requirements_completed: []  # Not finalised — held until WCAG checkpoint closes
requires:
  - 01-02  # styles/tokens.css + glass.css (audit-contrast parses these)
  - 01-04  # primitives barrel (Primitives showcase imports)
  - 01-05  # typed Tauri wrappers (WrapperSmoke calls)
  - 01-06  # event hook + BLADE_EVENTS (Diagnostics subscribes)
  - 01-07  # dev routes + feature-index pattern (replacing placeholders)
  - 01-08  # migration-ledger seed + WIRE-08 refactor (verify-ledger + verify-emit-policy gate against these)
provides:
  - CI-enforced Phase 1 invariants (6 verify scripts, ESLint rule, bash backstop)
  - 3 DEV-only dev surfaces (Primitives, WrapperSmoke, Diagnostics)
  - Playwright listener-leak harness (first harness in repo)
  - .github/workflows/build.yml with verify:all + lint + html-entries wired
affects:
  - .github/workflows/build.yml
  - scripts/*.mjs + scripts/*.sh
  - package.json (scripts + devDependencies)
  - src/features/dev/* (index.tsx placeholders → real components)
tech-stack:
  added: ["@playwright/test@1.58.2", "eslint@9.18.0"]
  patterns:
    - "CI-enforced invariants over reviewer-required gates (Arnav directive)"
    - "ESLint flat config + project-local plugin (blade/no-raw-tauri)"
    - "Fs-scan verify scripts written as Node ESM (.mjs) runnable via npm run verify:*"
    - "Playwright with reuseExistingServer for zero-friction local runs"
key-files:
  created:
    - scripts/verify-entries.mjs
    - scripts/verify-html-entries.mjs
    - scripts/verify-no-raw-tauri.sh
    - scripts/verify-migration-ledger.mjs
    - scripts/verify-emit-policy.mjs
    - scripts/audit-contrast.mjs
    - eslint-rules/no-raw-tauri.js
    - eslint.config.js
    - src/features/dev/Primitives.tsx
    - src/features/dev/WrapperSmoke.tsx
    - src/features/dev/Diagnostics.tsx
    - playwright.config.ts
    - tests/e2e/listener-leak.spec.ts
  modified:
    - package.json  # scripts + devDependencies
    - src/features/dev/index.tsx  # placeholders → real lazy imports
    - .github/workflows/build.yml  # verify:all + lint + html-entries steps
decisions:
  - "Task 4 (WCAG manual screenshot checkpoint) DEFERRED to operator — not executed here by design; orchestrator will run it separately"
  - "Playwright e2e intentionally NOT wired into CI in Phase 1 (deferred to Phase 9 Polish — needs xvfb-run)"
  - "verify-emit-policy allowlist embeds 24 cross-window event/file pairs transcribed from 00-EMIT-AUDIT.md; line numbers excluded so the allowlist survives code churn"
  - "audit-contrast splits pairs into STRICT (t-1/t-2 × 3 tiers, must be ≥4.5:1) and INFO (t-3 × 3 tiers, decorative — reports but does not fail)"
metrics:
  duration_min: 8
  tasks_completed: 6
  checkpoint_deferred: 1
  completed_date: 2026-04-18
---

# Phase 1 Plan 09: Gate Infrastructure — Provisional Summary (AUTOMATED TASKS COMPLETE)

**One-liner:** Shipped every CI-enforced Phase 1 gate (6 verify scripts + ESLint rule + bash backstop + CI wiring) and the 3 DEV dev surfaces + Playwright listener-leak harness; the WCAG 5-wallpaper eyeball checkpoint (Task 4) is reserved for operator execution outside this executor run.

## What Shipped (Tasks 1-6)

### Task 1 — 6 verify scripts

| Script | Gate | Purpose | Pass status |
|---|---|---|---|
| `scripts/verify-entries.mjs` | P-05 / D-31 | Parses `vite.config.ts` rollupOptions.input, asserts all 5 HTML files on disk | PASS (5 entries present) |
| `scripts/verify-html-entries.mjs` | WIN-09 | Post-build — asserts `index/quickask/overlay/hud/ghost_overlay.html` in `dist/` | Not yet run (requires `npm run build`) |
| `scripts/verify-no-raw-tauri.sh` | D-34 backstop | Bash grep for raw `@tauri-apps/api/core`/`event` imports outside allowed paths | PASS (0 violations) |
| `scripts/verify-migration-ledger.mjs` | P-03 / D-27 | Parses `.planning/migration-ledger.md`, greps `src/` for orphan route-id references | PASS (82 ledger rows, 1 referenced id all tracked) |
| `scripts/verify-emit-policy.mjs` | D-45-regress | Greps `src-tauri/src/` for broadcast emits, cross-refs 24-entry allowlist from 00-EMIT-AUDIT.md | PASS (58 broadcast emits all allowlisted) |
| `scripts/audit-contrast.mjs` | P-08 automated | Parses tokens.css, composites glass rgba over dark wallpaper, computes WCAG 2.1 ratios | PASS (strict pairs all ≥ 7.42:1; min was t-2/glass-3) |

Commit: `1c1c0fe`.

### Task 2 — package.json

Added scripts: `verify:entries`, `verify:html-entries`, `verify:no-raw-tauri`, `verify:migration-ledger`, `verify:emit-policy`, `verify:contrast`, `verify:all` (orchestrator), `lint`, `test:e2e`.
Added devDependencies: `@playwright/test@^1.58.2`, `eslint@^9.18.0`.

Commit: `1ab65dc`.

### Task 3 — ESLint rule + flat config

- `eslint-rules/no-raw-tauri.js`: ESLint 9 AST rule forbidding raw `invoke` / `listen` imports outside `src/lib/tauri/` and `src/lib/events/`.
- `eslint.config.js`: flat config loading rule as `blade/no-raw-tauri` with `src/**/*.{ts,tsx}` scope; ignores `dist/`, `tests/`, `scripts/`, `src-tauri/`, etc.
- Windows path normalisation + ESLint 9 `context.filename` accessor (with legacy fallback).

Commit: `435bf12`.

### Task 4 — 3 DEV-only dev surfaces

- `src/features/dev/Primitives.tsx` (D-21): every primitive × variant × size × state on glass. Sections: Button (6 variants/sizes + disabled), GlassPanel tiers 1/2/3, Input (default/mono/disabled), Pill (4 tones + dot), Badge (4 tones), Spinner (3 sizes), Dialog primitive, t-1..t-4 text hierarchy. This is the P-08 WCAG eyeball surface.
- `src/features/dev/WrapperSmoke.tsx` (D-30, P-04 gate): table of 6 Phase-1 wrappers. Run All executes the 3 read-only ones (getConfig, getOnboardingStatus, cancelChat); 3 mutating rows (saveConfig, completeOnboarding, sendMessageStream) are listed but not auto-run (T-09-04 mitigation).
- `src/features/dev/Diagnostics.tsx`: `window.__BLADE_LISTENERS_COUNT__` counter, performance marks table with manual measure button, blade_status event subscription via `useTauriEvent`, build metadata (mode/DEV/PROD/VITE_GIT_HASH).
- `src/features/dev/index.tsx`: ComingSoonSkeleton placeholders replaced with `lazy()` imports of the 3 real components; routes remain `paletteHidden: true`, DEV-gated upstream at `src/windows/main/router.ts`.

Commit: `3d25080`.

### Task 5 — Playwright listener-leak harness

- `playwright.config.ts`: targets `http://localhost:1420`, `reuseExistingServer: true`, single worker, `retain-on-failure` trace.
- `tests/e2e/listener-leak.spec.ts` (P-06, D-32): reloads the main window 5 times, asserts `window.__BLADE_LISTENERS_COUNT__` grows by ≤ 1 (tolerance for render-timing flutter). Upgrades to real `openRoute()` navigation in Phase 2 when the Shell lands.

Commit: `28ad2ab`.

### Task 6 — CI wiring

`.github/workflows/build.yml` gains 4 new steps between `npm ci` and the existing Rust jobs:
1. `Phase 1 verify:all` — runs 5 runtime verify scripts (~3s)
2. `ESLint (blade/no-raw-tauri rule)` — `npm run lint`
3. `Migration-ledger idempotency` — re-seed + `git diff --exit-code .planning/migration-ledger.md`
4. After `npm run build`: `Verify all 5 HTML files present in dist/ (WIN-09)` — runs `verify:html-entries`

Existing Ubuntu apt deps block preserved verbatim (libsecret, libxdo, libspa, libclang). Playwright e2e deferred to Phase 9 Polish (documented inline).

Commit: `8861860`.

## What Is Held for Checkpoint (Task 4)

The plan's Task 4 is a `checkpoint:human-verify` with 6 operator-side verifications. All 6 are blocked on manual action and were intentionally NOT run by this executor:

1. **`npm run tauri dev`** — operator must launch and confirm all 5 windows come up without Rust panic
2. **P-01 first-paint measurement** — operator opens DevTools on main window, reads `[perf] boot-to-first-paint: XXXms`, confirms ≤ 200ms
3. **P-08 WCAG 5-wallpaper eyeball** — operator screenshots `/primitives` over the 5 wallpapers, saves to `.planning/phases/01-foundation/wcag-screenshots/`, eyeballs legibility
4. **Playwright sanity** — operator runs `npm install` (to pick up `@playwright/test` + `eslint`) then `npm run test:e2e` and confirms it passes
5. **`npm run tauri build`** — operator runs a production build, then `npm run verify:html-entries` against `dist/`
6. **Full `npm run verify:all`** — already green in this executor run, but operator re-runs as final sanity

**This executor run cannot do any of these** — `npm run tauri dev` and `tauri build` require audio/display/full environment, screenshots require the operator's real desktop, and Playwright requires `@playwright/test` be `npm install`ed first. That's the whole point of the checkpoint — the orchestrator will present it to the operator separately.

## Operator Prerequisites (before running checkpoint)

```bash
cd /home/arnav/blade
npm install          # picks up @playwright/test + eslint freshly added
npx playwright install chromium  # Playwright needs a browser (one-off)
```

Then follow Task 4 in `01-09-PLAN.md` for the 6 verification steps.

## Verification Snapshot (recorded in this run)

```bash
# All 5 runtime verify scripts PASS
$ npm run verify:all 2>&1 | grep -E '(OK —|FAIL)'
[verify-entries] OK — 5 entries present on disk
[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths
[verify-migration-ledger] OK — 1 referenced ids all tracked (of 82 ledger rows)
[verify-emit-policy] OK — all 58 broadcast emits match cross-window allowlist
[audit-contrast] OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline

# Contrast ratios on dark-wallpaper baseline (#0a0a1d)
t-1 on glass-1: 15.94:1    t-2 on glass-1: 9.24:1
t-1 on glass-2: 14.17:1    t-2 on glass-2: 8.47:1
t-1 on glass-3: 12.12:1    t-2 on glass-3: 7.42:1  ← lowest strict pair
t-3 on glass-1: 5.14:1     t-3 on glass-2: 4.87:1    t-3 on glass-3: 4.45:1  (informational)

# TypeScript clean
$ npx tsc --noEmit
(no output — 0 errors)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical coverage] Expanded emit-policy allowlist beyond the plan's embedded 23 rows**

- **Found during:** Task 1, while running `verify-emit-policy.mjs` locally.
- **Issue:** The allowlist embedded in the plan body listed ~23 entries, but `src-tauri/src/` contains cross-window broadcast emits at sites that ARE classified `cross-window` in `00-EMIT-AUDIT.md` but weren't in the plan's embedded set: `habit_engine.rs:blade_habit_reminder`, `health.rs:proactive_nudge`, `health_tracker.rs:health_alert`, `hive.rs:hive_status_updated`.
- **Fix:** Transcribed all `cross-window` classifications from `00-EMIT-AUDIT.md` into `CROSS_WINDOW_ALLOWLIST` (24 entries covering every `app.emit(`/`emit_all(` call currently in `src-tauri/src/`).
- **Result:** `[verify-emit-policy] OK — all 58 broadcast emits match cross-window allowlist`. Script is now a true regression gate — no false-positive failures on legitimate cross-window emits, no false-negative passes on new broadcast leakage.
- **File:** `scripts/verify-emit-policy.mjs` lines 29-80
- **Commit:** `1c1c0fe`

**2. [Rule 3 — Blocking issue] Playwright install timing**

- **Issue:** `@playwright/test` is not yet in `node_modules` (user directive: update `package.json` but don't run `npm install`). This would break a naive `npx tsc --noEmit tests/**/*.ts` but tsconfig's `include: ["src"]` excludes tests from the main typecheck, so no breakage surfaced.
- **Fix:** None needed in executor; documented as operator prerequisite in this SUMMARY.
- **No commit — documented only.**

### Out-of-scope deferrals (noted, not fixed)

- **Stray Windows-copy Zone.Identifier file:** `docs/architecture/2026-04-16-blade-body-architecture-design.md:Zone.Identifier` appears in `git status` as untracked. This is a WSL/Windows explorer artifact unrelated to Plan 09. Leaving alone — should go into `.gitignore` in a future cleanup (not Phase 1 scope).

## TDD Gate Compliance

Plan type is `execute` (not `tdd`). No RED/GREEN gate requirement. Tests were added (listener-leak.spec.ts) but are integration/E2E, not TDD-style unit tests — appropriate for the P-06 gate surface.

## Threat Flags

None — no new security-relevant surface introduced. `scripts/verify-no-raw-tauri.sh` reads `/tmp/raw-invoke.log` + `/tmp/raw-listen.log` via a securely-created `mktemp` path with a trap-based cleanup; no user-controlled input reaches these paths.

## Phase 1 Completion Status

Plan 09's AUTOMATION-layer success criteria all satisfied. Remaining work:

- [ ] Task 4 checkpoint (human-verify) — 6 operator-run verifications including P-08 5-wallpaper eyeball + P-01 first-paint measurement + tauri dev/build + Playwright sanity
- [ ] Recording the `boot-to-first-paint` ms number in the checkpoint response
- [ ] 5 PNG screenshots at `.planning/phases/01-foundation/wcag-screenshots/`

Once the checkpoint closes with "approved" + first-paint number, Phase 1 (21 requirements + 7 gates) is complete and Phase 2 (Onboarding + Shell) is unblocked.

## Self-Check: PASSED

Files (all 13 created artifacts exist):
- FOUND: scripts/verify-entries.mjs, verify-html-entries.mjs, verify-no-raw-tauri.sh, verify-migration-ledger.mjs, verify-emit-policy.mjs, audit-contrast.mjs
- FOUND: eslint-rules/no-raw-tauri.js, eslint.config.js
- FOUND: src/features/dev/Primitives.tsx, WrapperSmoke.tsx, Diagnostics.tsx
- FOUND: playwright.config.ts, tests/e2e/listener-leak.spec.ts
- FOUND (modified): package.json, src/features/dev/index.tsx, .github/workflows/build.yml

Commits (6 recorded, all verified via `git log --oneline -6`):
- FOUND: 1c1c0fe feat(01-09): 6 verify scripts
- FOUND: 1ab65dc feat(01-09): package.json verify:all + test:e2e + lint
- FOUND: 435bf12 feat(01-09): no-raw-tauri ESLint rule + flat config
- FOUND: 3d25080 feat(01-09): 3 DEV-only surfaces
- FOUND: 28ad2ab feat(01-09): Playwright listener-leak spec
- FOUND: 8861860 ci(01-09): wire npm run verify:all into build workflow
