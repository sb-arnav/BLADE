# Phase 59 — SUMMARY (TRIO-REORG)

**Status:** Complete
**Closed:** 2026-05-14

## Outcome

VISION §57-64 held Body Map / Organ Registry / Pixel World / Tentacle Detail /
mortality-salience / Ghost Mode for v2.0 evaluation. Neither v2.0 nor v2.1 ran
the evaluation. Phase 59 reorganises the six surfaces into a single
`/dev-tools` route with sub-tabs (TRIO-DEV-PANE), demotes them from the main
nav rail + ⌘K palette top-level (TRIO-DEMOTE-NAV), exposes a fingernail-sized
chat-header vitality glyph (TRIO-VITALITY-EXPOSE), records the decision with
falsification conditions (TRIO-DECISION-LOG), and locks the regression
falsifiers as Playwright e2e tests (TRIO-TESTS).

Per workspace rule `feedback_no_feature_removal`: no feature files deleted,
no Route ids removed — the underlying routes and components stay on disk and
remain reachable via `openRoute()` and the new dev-tools host. The ship-or-kill
verdict is deferred to v2.3+ once external-operator engagement data exists.

## REQ-ID check

- **TRIO-DEV-PANE** — `src/features/dev-tools/DevToolsPane.tsx` created;
  single `dev-tools` route registered as the first entry in
  `src/features/dev-tools/index.tsx`. Six sub-tabs (`body-map`,
  `organ-registry`, `pixel-world`, `tentacle-detail`, `mortality-salience`,
  `ghost-mode`) with `aria-selected` / `aria-controls` wiring and stable
  `data-testid` per tab. Inline `MortalitySalienceMonitor` polls
  `homeostasis_get` every 5s and displays the scalar against the 0.3
  informational threshold (the 0.6 emit-threshold remains the
  homeostasis.rs:814 elevated-awareness line).
- **TRIO-DEMOTE-NAV** — `paletteHidden: true` on `body-map`, `organ-registry`,
  `agent-pixel-world`, `hive-tentacle`, and `meeting-ghost` routes. NavRail
  uses `PALETTE_COMMANDS` (filters paletteHidden) so the first-in-section
  picker now skips these. New "Developer" settings section
  (`src/features/settings/panes/DeveloperPane.tsx` + `settings-developer`
  route) gives a second discoverable handoff. The `dev-tools` route is
  labelled "Open Developer Tools" so the ⌘K fuzzy hits both "open" and
  "developer" / "tools".
- **TRIO-VITALITY-EXPOSE** — `src/features/chat/VitalityBadge.tsx` created;
  subscribes to `BLADE_VITALITY_UPDATE` (vitality_engine.rs band/scalar
  emit) and renders a 1-character glyph mapped per band (⚡ Thriving / 🌀
  Waning / 🌙 Declining / 💤 Critical / 💤 Dormant) with full band-name
  tooltip + `role="status"`. Returns null until first event so fresh installs
  stay silent. Mounted in `ChatPanel.tsx` header beside the existing
  `VitalityIndicator` (scalar + trend arrow) — the two compose; the badge is
  the at-a-glance glyph, the indicator is the readable detail.
- **TRIO-DECISION-LOG** — Entry added to `.planning/decisions.md` (dated
  2026-05-14). Position + Rationale + 3 Falsification conditions + Outcome
  placeholder, matching the existing entries' shape.
- **TRIO-TESTS** — 2 Playwright e2e specs:
  - `tests/e2e/dev-tools-pane.spec.ts` — emits `blade_route_request` →
    `dev-tools`, asserts `dev-tools-pane-root` visible + all 6 tab buttons
    mounted by stable testid.
  - `tests/e2e/chat-vitality-badge.spec.ts` — asserts badge does NOT render
    pre-event, then emits two `blade_vitality_update` events (band=Thriving
    then band=Critical) and asserts `data-band` attribute transitions.
  Both specs pass `npx playwright test --list` parse-check; full runtime
  execution deferred to milestone close per the BLADE Verification Protocol
  (Playwright requires the Vite dev server, exercised at milestone close).

## Commits

| SHA | REQ-ID |
|---|---|
| 526ef87 | feat(59): TRIO-DEV-PANE — single /dev-tools route with 6 tabs |
| 6477222 | feat(59): TRIO-DEMOTE-NAV — held-trio off main nav, reachable via /dev-tools |
| bc3f266 | feat(59): TRIO-VITALITY-EXPOSE — chat-header vitality badge |
| 75d3714 | docs(59): TRIO-DECISION-LOG — record reorganization decision in decisions.md |
| f4670ea | test(59): TRIO-TESTS — 2 frontend tests for DevToolsPane + VitalityBadge |

## Static gates

| Gate | Result |
|---|---|
| `cargo check` (src-tauri) | Clean (24m 39s; only pre-existing warnings) |
| `npx tsc --noEmit` | Clean |
| `bash scripts/verify-feature-cluster-routes.sh` | OK — 66 routes present |
| `node scripts/verify-feature-reachability.mjs` | PASS — 2 wired, 0 missing |
| `node scripts/verify-aria-icon-buttons.mjs` | OK — 195 .tsx files, 0 violations |
| `npx playwright test --list` (new specs) | 2/2 specs parse + enumerate |

Per BLADE CLAUDE.md Verification Protocol: `npm run verify:all` and full
runtime UAT (screenshot the chat header with VitalityBadge live + screenshot
the `/dev-tools` pane with each tab) deferred to milestone close — not run at
phase boundary.

## Files touched

New:
- `src/features/dev-tools/DevToolsPane.tsx`
- `src/features/settings/panes/DeveloperPane.tsx`
- `src/features/chat/VitalityBadge.tsx`
- `tests/e2e/dev-tools-pane.spec.ts`
- `tests/e2e/chat-vitality-badge.spec.ts`
- `.planning/milestones/v2.2-phases/59-trio-reorg/59-SUMMARY.md`

Modified:
- `src/features/dev-tools/index.tsx` (DevToolsPane lazy-import + route
  registration; label "Open Developer Tools" for ⌘K)
- `src/features/body/index.tsx` (paletteHidden on body-map + organ-registry)
- `src/features/agents/index.tsx` (paletteHidden on agent-pixel-world)
- `src/features/hive/index.tsx` (paletteHidden on hive-tentacle)
- `src/features/ghost/index.tsx` (paletteHidden true on meeting-ghost +
  description updated)
- `src/features/settings/SettingsShell.tsx` (settings-developer pane + tab)
- `src/features/settings/index.tsx` (settings-developer route)
- `src/features/chat/ChatPanel.tsx` (VitalityBadge mounted in header)
- `.planning/decisions.md` (2026-05-14 entry appended)

## Routes moved / where to

| Surface | Previous reach | New reach |
|---|---|---|
| Body Map (`body-map`) | NavRail body-section first-pick + ⌘K | `/dev-tools` body-map tab + openRoute() |
| Organ Registry (`organ-registry`) | ⌘K palette | `/dev-tools` organ-registry tab + openRoute() |
| Pixel World (`agent-pixel-world`) | ⌘K palette | `/dev-tools` pixel-world tab + openRoute() |
| Tentacle Detail (`hive-tentacle`) | ⌘K palette | `/dev-tools` tentacle-detail tab + openRoute() |
| Mortality Salience monitor | N/A (read-only sub-view) | `/dev-tools` mortality-salience tab (new component, polls homeostasis_get) |
| Meeting Ghost (`meeting-ghost`) | core-section ⌘K | `/dev-tools` ghost-mode tab + openRoute() |
| **NEW**: Developer Tools (`dev-tools`) | — | NavRail dev-section (first-pick) + ⌘K + Settings → Developer |
| **NEW**: Settings Developer (`settings-developer`) | — | Settings tab list (after Ecosystem) |

The four non-held body routes (body-system-detail / hormone-bus / DNA /
world-model) are unchanged; the four non-held hive routes (hive-mesh /
hive-autonomy / hive-approval-queue / hive-ai-delegate) are unchanged; the
eight non-trio agent routes are unchanged.

## Deviations from the REQ list

1. **Test file path** — REQ asked for
   `src/features/dev-tools/__tests__/DevToolsPane.test.tsx`. BLADE has no
   vitest install (`package.json` test commands are all `playwright test
   tests/e2e/...`). I landed the same falsifiers as Playwright e2e specs at
   `tests/e2e/dev-tools-pane.spec.ts` + `tests/e2e/chat-vitality-badge.spec.ts`.
   Same logical assertions ("/dev-tools mounts + 6 tabs"; "VitalityBadge
   renders + updates when presence event fires"); working test runner. The
   REQ explicitly permits this fallback ("vitest if present, otherwise check
   `package.json` for the existing test runner").

2. **"Presence event" mapping** — REQ-3 mentions both `BLADE_CHAT_LINE` (Phase
   53 with `kind: "presence"`) AND "a backend command if there's a more direct
   vitality-band accessor." The direct accessor exists:
   `BLADE_VITALITY_UPDATE` (vitality_engine.rs's band/scalar event,
   subscribed by the existing `VitalityIndicator`). I subscribed
   `VitalityBadge` to that event — it carries the band string directly, no
   parsing required. The presence-line event path would have required
   filtering by source=='vitality' and inferring band from message text. The
   chosen path is the direct one.

3. **`src/App.tsx` does not exist** — REQ-1 said "New route `dev-tools` in
   `src/App.tsx`. Lazy-loaded via `React.lazy(...)`." BLADE uses a custom
   feature-cluster registry pattern (`src/lib/router.ts` +
   `src/windows/main/router.ts` aggregator). New routes ship as entries in a
   feature `index.tsx` `routes` array; the cluster aggregator picks them up
   automatically. I followed this pattern — `dev-tools` route lives in
   `src/features/dev-tools/index.tsx` with `lazy(() =>
   import('./DevToolsPane'))`. Functionally identical to the REQ; structurally
   correct for the BLADE codebase.

## Sibling-file contamination recovered from

`git status` between commits consistently showed Phase 55 in-flight files
(`src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/sessions.rs`,
`src-tauri/tests/session_manager_integration.rs`, `src/lib/tauri/sessions.ts`)
modified or untracked alongside my work. **Mitigation:** every commit was
staged with explicit `git add <file1> <file2> ...` enumerating only the
Phase 59 files, then verified with `git show --stat HEAD` immediately after
commit. All 5 Phase 59 commits passed verification — no sibling files
contaminated any commit. The phase brief's warning fired in `git status`
output but never in `git show --stat`. No `git reset --soft` recovery
required.

## Surprises (candidates for ~/surprises.md)

1. **`paletteHidden` is a single-flag demote.** I expected to need NavRail
   refactoring + per-section ordering tweaks to demote the trio. But NavRail
   reads `PALETTE_COMMANDS` (which already filters `paletteHidden`) and
   picks the first-in-section route from that filtered list. Flipping
   `paletteHidden: true` on `body-map` + `organ-registry` was sufficient —
   `body-system-detail` automatically inherited the body-section icon slot.
   The CommandPalette uses the same filter. One-line demote per route, zero
   downstream changes.

2. **MainShell is not `src/App.tsx`.** The Phase 59 brief and `v2.2-REQUIREMENTS`
   both name `src/App.tsx` as the routing site. The actual site is
   `src/windows/main/MainShell.tsx` + `src/windows/main/router.ts`. The
   pattern is intentional (D-40 feature-cluster registry, FOUND-08
   1-file-1-entry rule). Future phase briefs should reference the cluster
   pattern, not `App.tsx`.

3. **`tsc --noEmit` doesn't validate `tests/` files.** `tsconfig.json` only
   includes `src`. Playwright has its own ts compile via
   `playwright.config.ts`, but bare `tsc --noEmit` will not catch typos in
   the spec files. `npx playwright test --list` is the parse-time check.

## Next

Phase 59 closes Wave A of v2.2 (53/54/57/58 + 55 in flight + 59 done). With
the held-trio reorganised but reachable, the v2.2 milestone-close audit can
note the v2.0/v2.1 deferred evaluation as "deferred again to post-external-
launch operator engagement data" with explicit falsification conditions
recorded in decisions.md (2026-05-14 entry).

Adjacent v2.2 phases that compose with this work:
- Phase 53 (PRESENCE-NARRATE) — VitalityBadge uses the same band-color
  scheme as the per-source presence narration CSS.
- Phase 60 prep (external launch) — DeveloperPane's "What lives there"
  card gives the operator a single human-readable inventory of the
  held-trio surfaces in case the evaluation gets pulled forward.
