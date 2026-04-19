---
phase: 04-overlay-windows
plan: 05
subsystem: overlay-hud
tags: [hud, overlay, tauri, react, wave-2]
dependency-graph:
  requires:
    - 04-01  # Rust WIRE closures: get_primary_safe_area_insets, emit_route_request, overlay_hide_hud, hud_data_updated parallel-emit
    - 01-04  # design-system primitives + tokens
    - 03-05  # HormoneChip component + palette (reused verbatim)
  provides:
    - HudWindow (src/features/hud/HudWindow.tsx) — top-level HUD bar with 5 chips, click + right-click
    - HudMenu  (src/features/hud/HudMenu.tsx)  — right-click popover with 4 items
    - formatCountdown (src/features/hud/formatCountdown.ts) — pure seconds → human-string helper
    - hud.css  (src/features/hud/hud.css)     — bar + chip + menu styles (D-07 blur-cap compliant)
  affects:
    - src/windows/hud/main.tsx (bootstrap replacement — Phase 1 placeholder → HudWindow mount)
tech-stack:
  added: []  # no new deps — reuses existing React + Tauri + Phase 1/3 substrate
  patterns:
    - useTauriEvent subscription for 3 events (HUD_DATA_UPDATED, GODMODE_UPDATE, HORMONE_UPDATE) per D-13
    - invokeTyped-only IPC surface (D-34); PhysicalPosition dynamic-imported from @tauri-apps/api/window (NOT banned by no-raw-tauri)
    - Mount-time safe-area offset via get_primary_safe_area_insets → win.setPosition(PhysicalPosition(0, top)) (D-115)
    - Right-click popover rendered as sibling of .hud-bar; click-outside via window-level mousedown; Escape closes
    - HormoneChip reuse from Dashboard — no new hormone component (D-75 reuse contract)
    - Minimal hormone-chip CSS copied from dashboard.css into hud.css (HUD webview doesn't load dashboard.css)
key-files:
  created:
    - src/features/hud/formatCountdown.ts
    - src/features/hud/HudWindow.tsx
    - src/features/hud/HudMenu.tsx
    - src/features/hud/index.tsx
    - src/features/hud/hud.css
  modified:
    - src/windows/hud/main.tsx  # Phase 1 placeholder div → HudWindow mount + hud.css import
decisions:
  - D-97 (HUD parallel-emit consumer): HUD subscribes hud_data_updated via useTauriEvent on whichever window label it runs under; parallel-emit from Plan 04-01 delivers to both `blade_hud` and `hud` labels so this component is label-agnostic.
  - D-113 (5-chip layout): time | active-app | god-mode tier | dominant hormone | meeting countdown (conditional). Dominant hormone is max of {arousal, exploration, urgency, trust, adrenaline} — the other 5 hormones (hunger/thirst/insulin/leptin/energy_mode) are Dashboard-owned background metrics per context plan.
  - D-114 (click + right-click): primary click toggles main window via toggleMainWindow(); right-click opens HudMenu at cursor with 4 items (Open BLADE / Open Chat / Hide HUD / Settings). Primary click while menu is open closes menu without also popping main (prevents double-fire on right-click→click).
  - D-115 (notch-aware positioning): mount-time get_primary_safe_area_insets call; on insets.top > 0 (macOS heuristic returns 37), the HUD window offsets its top position via getCurrentWebviewWindow().setPosition(PhysicalPosition(0, top)). Non-mac and command-failure both no-op gracefully.
  - D-17 (D-17 READ-ONLY src.bak discipline): formatCountdown and godTierColor values retyped from src.bak/components/HudBar.tsx (lines 48-55 and 57-64); NOT imported. src.bak stays dead.
  - Godmode tier normalization: `e.payload.tier` sometimes arrives as 'Normal' vs 'normal' depending on emit site; normalised to lowercase in the GODMODE_UPDATE handler so godTierColor switch matches.
  - hormone-chip styling: copied minimal subset (5 rules) from dashboard.css into hud.css rather than importing dashboard.css — the HUD webview shouldn't load the full Dashboard CSS (tile/ambient rules it doesn't use). HormoneChip class + CSS var contract is stable per Phase 3 D-75, so a co-located copy is safe.
metrics:
  duration: 7m 1s
  completed: 2026-04-19T12:05:37Z
  tasks: 2
  files_created: 5
  files_modified: 1
---

# Phase 4 Plan 04-05: HUD Bar Summary

Live 30px HUD bar with 5 chips (time, active app, god-mode tier, dominant hormone, meeting countdown), click-to-open-main, right-click 4-item popover, and macOS notch-aware positioning. Replaces Phase 1 `<div>BLADE HUD — Phase 1 bootstrap</div>` placeholder with a working always-on-top status surface.

## What Landed

- **`src/features/hud/formatCountdown.ts`** — Pure helper. `secs → '35s' | '12m' | '1h 5m' | '2h'`. Retyped from src.bak per D-17 (NOT imported).
- **`src/features/hud/HudWindow.tsx`** — Top-level component. 3 useTauriEvent subscriptions (HUD_DATA_UPDATED, GODMODE_UPDATE, HORMONE_UPDATE). Mount-time `get_primary_safe_area_insets` call with PhysicalPosition offset on notched Macs (D-115). Click = `toggleMainWindow()`; right-click = opens HudMenu at cursor.
- **`src/features/hud/HudMenu.tsx`** — Right-click popover. 4 menu items (Open BLADE / Open Chat / Hide HUD / Settings). Click-outside via window-mousedown; Escape closes. All IPC through invokeTyped (no raw tauri/core or /event).
- **`src/features/hud/index.tsx`** — Barrel: `HudWindow`, `HudMenu`, `HudMenuProps`, `formatCountdown`.
- **`src/features/hud/hud.css`** — `.hud-bar` (30px frosted at glass-1 blur(20px)), `.hud-chip`/`.hud-time`/`.hud-app`/`.hud-god`/`.hud-meet` (left-to-right row), `.hud-menu` + `.hud-menu button` (popover), minimal `.hormone-chip*` rules scoped to `.hud-bar` (HUD-sized overrides of Dashboard variant).
- **`src/windows/hud/main.tsx`** — Bootstrap now mounts `<HudWindow/>`; imports `@/styles/index.css` + `@/features/hud/hud.css`.

## Requirements Closed

| ID     | Requirement                                 | How                                                                       |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------- |
| HUD-01 | HUD bar appears on launch                   | `createRoot(#root).render(<HudWindow/>)` in `src/windows/hud/main.tsx`     |
| HUD-02 | Live god-mode tier + hormone dominant chip  | `useTauriEvent(GODMODE_UPDATE)` + `useTauriEvent(HORMONE_UPDATE)` + `HormoneChip` reuse |
| HUD-03 | Click opens main window (toggle_window)     | `onClick` → `toggleMainWindow()` via `src/lib/tauri/window.ts` wrapper     |
| HUD-04 | Right-click mini menu with 4 items          | `onContextMenu` → `<HudMenu/>` popover (Open BLADE / Open Chat / Hide HUD / Settings) |
| HUD-05 | macOS notch-aware positioning (D-115)       | Mount-time `invokeTyped('get_primary_safe_area_insets')` + `PhysicalPosition(0, top)` |

## Success Criteria

- [x] `src/windows/hud/main.tsx` mounts `<HudWindow/>` (replaces Phase 1 placeholder).
- [x] 5 chips: time | app | god-mode tier | dominant hormone | meeting countdown (conditional on `next_meeting_secs != null`).
- [x] `HudData`, `HormoneUpdatePayload`, `GodmodeUpdatePayload` all subscribed via `useTauriEvent` (3 hook calls confirmed by grep).
- [x] Click → `toggleMainWindow()` (wrapper in `src/lib/tauri/window.ts` — shipped by Plan 04-01).
- [x] Right-click → `<HudMenu/>` at cursor position; 4 items wired to `emit_route_request` + `toggle_window` + `overlay_hide_hud`.
- [x] Mount-time `get_primary_safe_area_insets` call; macOS offsets window top via `PhysicalPosition`; non-mac/failure is a silent no-op.
- [x] `HormoneChip` from `@/features/dashboard/hormoneChip` reused verbatim (no new component).
- [x] Zero raw `@tauri-apps/api/core` or `@tauri-apps/api/event` imports (confirmed: `grep -cE "from '@tauri-apps/api/core'|from '@tauri-apps/api/event'"` = 0 across all plan files).
- [x] `npx tsc --noEmit` → 0 errors.
- [x] `npm run verify:all` → 6/6 green (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] HormoneChip styling co-location**
- **Found during:** Task 2 (writing hud.css).
- **Issue:** `HormoneChip` renders `.hormone-chip` / `.hormone-chip-label` / `.hormone-chip-value` classes defined in `src/features/dashboard/dashboard.css`. The HUD webview bootstrap imports `@/styles/index.css` + `@/features/hud/hud.css` but NOT dashboard.css, so without intervention the dominant-hormone chip would render unstyled (raw inline text).
- **Fix:** Copied the minimal 5 rules needed (`.hormone-chip`, `.hormone-chip-label`, `.hormone-chip-value`, `.hormone-chip.is-dominant`, `.hormone-chip.is-dominant .hormone-chip-value`) into `hud.css` under a `.hud-bar .hormone-chip` scope, with HUD-specific size overrides (smaller padding/font to fit the 30px bar).
- **Rationale:** Pulling in the full dashboard.css brings tile/ambient-strip rules the HUD doesn't use. HormoneChip's class + CSS var (`--chip-color`) contract is stable per Phase 3 D-75, so a co-located copy is safe — the chip's render path still reads `--chip-color` from inline style set by the component, so color parity is preserved.
- **Files modified:** `src/features/hud/hud.css` (added 5 hormone-chip rules under `.hud-bar` scope).
- **Commit:** Included in the hud.css write (committed under 8995575 due to parallel-lane staging collision; see deviation 3).

**2. [Rule 2 — Missing correctness guard] Godmode tier case normalisation**
- **Found during:** Task 1 (writing GODMODE_UPDATE handler).
- **Issue:** `GodmodeUpdatePayload.tier` is typed as `'Normal' | 'Intermediate' | 'Extreme' | string` — the Rust emit sites return capitalised forms, while `HudData.god_mode_status` (from `hud_data_updated`) returns lowercase. The `godTierColor()` switch matches lowercase strings only, so a plain `setTier(String(e.payload.tier))` would mis-render capitalised payloads with the fallback white.
- **Fix:** `setTier(String(e.payload.tier ?? 'off').toLowerCase())` — normalises to lowercase before the switch. The displayed chip text remains lowercase ("GM · normal") which matches the prototype aesthetic.
- **Files modified:** `src/features/hud/HudWindow.tsx` (GODMODE_UPDATE handler).
- **Commit:** `7ecde73` (Task 1).

**3. [Rule 3 — Blocking issue] Parallel-lane staging collision (resolved)**
- **Found during:** Task 2 commit prep.
- **Issue:** When staging `src/features/hud/hud.css` and `src/windows/hud/main.tsx` for the Task 2 commit, the git index already contained files from the parallel Voice Orb agent (`src/features/voice-orb/VoiceOrbWindow.tsx`, `src/features/voice-orb/index.tsx`, `src/hooks/usePrefs.ts`, `src/windows/overlay/main.tsx`). I used `git restore --staged` to unstage the non-HUD files. Mid-commit, the Voice Orb agent landed commit `8995575` that swept my uncommitted hud.css + main.tsx into their tree. Observation: the `git restore --staged` + my subsequent `git add` also cleared — the index was empty by the time I tried `git commit`.
- **Fix:** The parallel agent later rebased their work (commit `8995575` was dropped; replaced by `2be457b` + `68e53cd` which contain only voice-orb files). This re-exposed my hud.css as untracked and my main.tsx as modified. I re-staged `git add src/features/hud/hud.css src/windows/hud/main.tsx` and committed cleanly as `010f44e` with full Task 2 attribution.
- **Files affected:** `src/features/hud/hud.css` + `src/windows/hud/main.tsx` — now cleanly attributed under `010f44e`.
- **Commit:** Task 2 landed at `010f44e` with proper `feat(04-05)` attribution.
- **Prevention for future waves:** Wave-2 parallel executors should stage files with explicit `git add <path>` listings only, never `git add -A`, and verify `git diff --cached --name-only` before every commit.

## Auth Gates

None. Plan 04-05 is a pure frontend component landing; no new Rust commands, no new secrets, no new environment variables.

## Testing

- **TypeScript:** `npx tsc --noEmit` → 0 errors.
- **Lint/invariant:** `npm run verify:all` → 6/6 green:
  - `verify:entries` — 5 window entries present on disk.
  - `verify:no-raw-tauri` — no raw `@tauri-apps/api/core` or `@tauri-apps/api/event` imports outside allowed paths.
  - `verify:migration-ledger` — 89 ledger rows; 7 referenced ids tracked.
  - `verify:emit-policy` — 59 broadcast emits match allowlist.
  - `verify:contrast` — WCAG 4.5:1 for all strict glass pairs.
  - `verify:chat-rgba` — D-70 preserved (no backdrop-filter in chat).
- **Manual Playwright (Plan 04-07):** `tests/e2e/hud-bar-render.spec.ts` is the SC-4 falsifier — out of scope for 04-05, owned by 04-07.
- **Mac-session verification (Plan 04-07):** M-09 (notch positioning) and M-10 (right-click → "Open BLADE" focuses main) pending operator smoke on macOS hardware.

## Verification Commands

```bash
# Task 1 grep set
grep -n "formatCountdown\|HudWindow\|HudMenu" src/features/hud/*.ts src/features/hud/*.tsx
grep -cE "useTauriEvent" src/features/hud/HudWindow.tsx              # 6 (3 hook calls + 3 comment mentions)
grep -n "toggleMainWindow\|get_primary_safe_area_insets\|onContextMenu" src/features/hud/HudWindow.tsx
grep -n "HormoneChip" src/features/hud/HudWindow.tsx
grep -cE "from '@tauri-apps/api/core'|from '@tauri-apps/api/event'" src/features/hud/*.tsx src/features/hud/*.ts  # 0

# Task 2 grep set
grep -n "HudWindow\|hud.css\|styles/index.css" src/windows/hud/main.tsx
grep -n 'role="menu"' src/features/hud/HudMenu.tsx                    # role attribute present
grep -n "emit_route_request\|overlay_hide_hud\|toggle_window\|toggleMainWindow" src/features/hud/HudMenu.tsx
grep -n "\.hud-bar\|\.hud-chip\|\.hud-menu" src/features/hud/hud.css  # 8+ matches
grep -cE "from '@tauri-apps/api/core'|from '@tauri-apps/api/event'" src/features/hud/*.tsx src/windows/hud/main.tsx  # 0
```

## Commit Log

| Hash      | Message                                                                     | Files                                                                                |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `7ecde73` | `feat(04-05): HUD formatCountdown + HudWindow + HudMenu + index barrel`     | `formatCountdown.ts`, `HudWindow.tsx`, `HudMenu.tsx`, `index.tsx`                     |
| `010f44e` | `feat(04-05): HUD hud.css + main.tsx bootstrap (replaces Phase 1 placeholder)` | `hud.css` (+167), `src/windows/hud/main.tsx` (Phase 1 placeholder → HudWindow mount) |

## Follow-ups

- **Plan 04-06** (Wave 3): `QuickAskBridge` + `ChatProvider.injectUserMessage` + `BladeRouteRequestPayload` consumer in `useRouter.ts`. HUD right-click's "Open Chat" + "Settings" items currently rely on main's `useRouter` subscribing `BLADE_ROUTE_REQUEST` — Plan 04-06 wires that end of the bridge.
- **Plan 04-07** (Wave 4): Playwright `hud-bar-render.spec.ts` renders `<HudWindow/>` in isolation, emits synthetic `hud_data_updated` + `hormone_update`, asserts chips render + right-click menu appears.
- **Phase 9 polish:** Replace `get_primary_safe_area_insets` macOS heuristic (hardcoded 37px) with real FFI to `NSScreen.safeAreaInsets.top` — notched vs notchless MacBooks currently both receive 37px offset, which is correct for notched but wastes 37px on older Macs.
- **Phase 9 polish:** HUD drag-to-reposition (currently top-fixed).

## Self-Check: PASSED

**Files:**
- FOUND: src/features/hud/formatCountdown.ts
- FOUND: src/features/hud/HudWindow.tsx
- FOUND: src/features/hud/HudMenu.tsx
- FOUND: src/features/hud/index.tsx
- FOUND: src/features/hud/hud.css
- FOUND: src/windows/hud/main.tsx (modified from Phase 1 placeholder to HudWindow mount)

**Commits:**
- FOUND: 7ecde73 (feat(04-05): HUD formatCountdown + HudWindow + HudMenu + index barrel)
- FOUND: 010f44e (feat(04-05): HUD hud.css + main.tsx bootstrap — replaces Phase 1 placeholder)

**Verify:all:** 6/6 green.
**tsc --noEmit:** 0 errors.
