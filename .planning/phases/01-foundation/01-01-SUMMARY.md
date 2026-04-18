---
phase: 01-foundation
plan: 01
status: complete
completed: 2026-04-18
---

# Plan 01-01 — Nuke + HTML Entries + Window Bootstraps

## What Built

Wave-1 lead plan: stripped the legacy `src/` monolith, seeded the 5-window Tauri surface, and wired the `@/*` path alias so every downstream plan can import cleanly.

## Tasks Completed

| Task | Commit | Outcome |
|------|--------|---------|
| 0 — Pre-nuke checkpoint | n/a | Operator confirmed: clean `git status -- src/`, `src.bak/` 297 files, branch=master |
| 1 — Nuke + scaffold | `<commit-task1>` | `rm -rf src/` executed; `src/windows/{main,quickask,overlay,hud,ghost}/` created; tsconfig `paths.@/*` + `baseUrl: "."` active |
| 2 — 5 HTML entries | `f384f78` | index/quickask/overlay/hud/ghost_overlay written with D-43 minimal template (dark-bg inline style, root-relative script src) |
| 3 — 5 bootstrap tsx | `<commit-task3>` | All 5 `src/windows/<name>/main.tsx` files created; main has `performance.mark('boot')` per D-29/P-01; ghost has no cursor CSS per D-09; `npx tsc --noEmit` passes clean |

## Key Files

### Created
- `index.html` — Main window entry → `/src/windows/main/main.tsx`
- `quickask.html` — QuickAsk entry → `/src/windows/quickask/main.tsx`
- `overlay.html` — Voice Orb overlay entry (stops `lib.rs:349` panic)
- `hud.html` — HUD bar entry (stops `overlay_manager.rs:76` panic)
- `ghost_overlay.html` — Ghost Mode entry (stops `ghost_mode.rs:472` panic)
- `src/windows/main/main.tsx` — `performance.mark('boot')` + React.StrictMode placeholder
- `src/windows/quickask/main.tsx` — minimal createRoot placeholder
- `src/windows/overlay/main.tsx` — minimal createRoot placeholder
- `src/windows/hud/main.tsx` — minimal createRoot placeholder
- `src/windows/ghost/main.tsx` — minimal createRoot placeholder (no cursor CSS; D-09)

### Modified
- `tsconfig.json` — added `baseUrl: "."` and `paths: { "@/*": ["./src/*"] }`

### Removed
- Entire legacy `src/` tree (components/, hooks/, lib/, data/, utils/, App.tsx, main.tsx, hud.tsx, overlay.tsx, quickask.tsx, ghost_overlay.tsx, styles/tokens.css, types*.ts, index.css, vite-env.d.ts) — per D-26. `src.bak/` untouched as the migration-ledger reference for Plan 08.

## Gate Progress

- **P-05 gate** (HTML entries present): partially satisfied — all 5 files exist with root-relative script srcs. Full P-05 pass lands once Wave 2 primitives + Wave 3 router render real content and `npm run tauri dev` boots all 5 windows without panic.
- **P-01 gate** (performance.mark in main): satisfied at source — measurement lands when Plan 07 renders the dashboard.

## Deviations

- Task 1 dropped the `git mv src src.bak.phase0` safeguard from CONTEXT prose because `src.bak/` already exists (STATE.md §Active Todos). Straight `rm -rf src/` matches the plan's action block verbatim.
- Task 3 removed unused `React` import from quickask/overlay/hud/ghost bootstraps — with `jsx: react-jsx` the runtime transform handles JSX without an explicit import, and `noUnusedLocals: true` flags it as an error. Only `main/main.tsx` keeps the import (it uses `React.StrictMode` directly).

## Self-Check: PASSED

- [x] `rm -rf src/` confirmed via `test ! -d src/components`
- [x] 5 HTML files at repo root; grep confirms each references the correct `/src/windows/<name>/main.tsx`
- [x] 5 bootstrap tsx files in place; grep confirms `createRoot` in all 5 and `performance.mark('boot')` in main
- [x] `src.bak/` untouched (297 files)
- [x] tsconfig has `"@/*"` + `"baseUrl": "."`
- [x] `npx tsc --noEmit` exit 0

## Unlocks

- Plan 01-02 can now write `src/styles/*.css` into the fresh tree
- Plan 01-03 can now write `src/lib/tauri/_base.ts` + `src/types/*.ts` into the fresh tree
- Rust no longer panics on overlay/hud/ghost window creation (once webview loads these HTML files)
