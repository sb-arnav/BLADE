# Phase 40 — Always-On → On-Demand — SUMMARY

**Status:** Closed at static-gates-green. Runtime UAT operator-owned per
V2-AUTONOMOUS-HANDOFF §1.

**Date:** 2026-05-13

**Milestone:** v1.6 — Narrowing Pass

## What changed

Three perception loops flipped from default-on to default-off. The
on-demand command surface is preserved so LLM tool-use can still
invoke each path when chat needs it.

### REDUCE-02 — Total Recall (commit `bcb1cd1`)

- Removed the unconditional `screen_timeline::start_timeline_capture_loop(app)`
  call from the Tauri `setup` closure in `src-tauri/src/lib.rs` (was at the
  line right after `godmode::start_god_mode(...)`).
- `start_timeline_capture_loop` itself is **preserved** as the on-demand
  path — it stays callable, still gated by `config.screen_timeline_enabled`
  (already default `false` in both `DiskConfig::default()` and
  `BladeConfig::default()`).
- All 13 `screen_timeline_commands::*` Tauri commands (`timeline_search_cmd`,
  `timeline_browse_cmd`, `timeline_get_screenshot`, `timeline_get_thumbnail`,
  `timeline_get_config`, `timeline_set_config`, `timeline_get_stats_cmd`,
  `timeline_cleanup`, `timeline_search_everything`, `timeline_get_audio`,
  `timeline_meeting_summary`, `timeline_get_action_items`,
  `timeline_set_audio_capture`, `timeline_detect_meeting`) remain
  registered in `generate_handler![]`.

### REDUCE-03 — Audio Timeline (commit `285a2c1`)

- Removed the unconditional `audio_timeline::start_audio_timeline_capture(app)`
  call from the Tauri `setup` closure in `src-tauri/src/lib.rs`.
- `start_audio_timeline_capture` itself is **preserved** as the on-demand
  path, still gated by `config.audio_capture_enabled` (already default
  `false` in both `DiskConfig::default()` and `BladeConfig::default()`).
- `wake_word::start_wake_word_listener(app)` stays at startup — it is the
  on-demand voice entry point, not a perception loop.
- All audio timeline Tauri commands callable via `screen_timeline_commands::*`
  bridges (`timeline_get_audio`, `timeline_meeting_summary`,
  `timeline_set_audio_capture`, `timeline_detect_meeting`,
  `timeline_get_action_items`) remain registered.

### REDUCE-04 — Tentacle passive observation default-off (commit `6868d39`)

- Renamed `default_true_ambient() -> true` to `default_false_ambient() -> false`
  in `src-tauri/src/config.rs`. This function is the `#[serde(default = ...)]`
  for the three observer-class watcher flags shipped in B1 (v1.5.1).
- Flipped the literal `true` values to `false` in both `DiskConfig::default()`
  and `BladeConfig::default()` for:
  - `notification_listener_enabled` (OS-notification poller, every 30s)
  - `terminal_watch_enabled` (shell-history watcher tentacle)
  - `filesystem_watch_enabled` (Downloads dir watcher tentacle)
- The startup gates inside `notification_listener_start`,
  `start_terminal_watcher`, and `start_filesystem_watcher` (added in B1 /
  v1.5.1) already short-circuit when the flag is `false`. They now no-op
  at fresh-install startup, but remain callable as the on-demand path.
- `ecosystem_observe_only: true` (runtime guardrail per v1.1 M-03) is
  **untouched** — it is a runtime check, not a default this phase targets.
- `ecosystem_tentacles: vec![]` (per-tentacle records for repo-watcher,
  slack-monitor, deploy-monitor, pr-watcher, session-bridge,
  calendar-monitor) is **untouched** — auto-population was removed earlier
  in v1.6 (commit `aa789f7` cut deep_scan + ecosystem auto-enable). The
  per-record `enabled` field already defaults to whatever the user sets
  when manually registering a tentacle.
- `integration_polling_enabled` (Phase 4 MCP poller) was already `false`
  by default. No change.
- `hive_enabled` (HIVE distributed agent mesh) was already `false` by
  default. No change.

## Files touched

| File | Change | LOC delta |
|------|--------|-----------|
| `src-tauri/src/lib.rs` | 2 unconditional startup calls removed (`start_timeline_capture_loop`, `start_audio_timeline_capture`); replaced with explanatory comments | +14, -2 (net +12) |
| `src-tauri/src/config.rs` | Renamed `default_true_ambient` → `default_false_ambient`; flipped 3 `serde(default)` attribute references in DiskConfig + 3 in BladeConfig; flipped 6 literal `true` → `false` in the two `Default` impls | +28, -18 (net +10) |

Total LOC delta: **+22 lines** across 2 files (net — most of the additions
are inline comments documenting the on-demand intent and the
`screen_timeline_commands::*` preservation contract).

## Static gates result

- **`cd src-tauri && cargo check`** — PASS (exit 0). 1 pre-existing
  `dead_code` warning for `parse_owner_repo` in `hive.rs` unrelated to
  Phase 40. Total build time: 5m 34s.
- **`npx tsc --noEmit`** — PASS (clean, no output).
- **`npm run verify:all`** — Halts on `verify:feature-cluster-routes`
  with 4 missing-file errors (`FinanceView.tsx`, `SidecarView.tsx`,
  `WorkflowBuilder.tsx`, `SecurityDashboard.tsx`). This is **pre-existing
  carry-forward** from earlier v1.6 deletion commits (`aa789f7`,
  `568b236`, `2686761`, `c0bf13f`, `7083d14`) that cut `financial_brain`,
  `workflow_builder`, `security_monitor`, and related views per the
  VISION:186 cut list. Verified: the 4 files were already missing at
  HEAD~3 (before Phase 40 commits landed). Not a Phase 40 regression.
  The 11 verify gates that ran before the halt all passed
  (`verify:entries`, `verify:no-raw-tauri`, `verify:migration-ledger`,
  `verify:emit-policy`, `verify:contrast`, `verify:chat-rgba`,
  `verify:ghost-no-cursor`, `verify:orb-rgba`, `verify:hud-chip-count`,
  `verify:phase5-rust`).

The pre-existing `verify:feature-cluster-routes` failure is the
documented v1.6 carry-forward acceptable per V2-AUTONOMOUS-HANDOFF.md
§1 ("Static gates green is the close bar"; carry-forwards documented in
milestone audit per v1.1 / v1.2 / v1.5 precedent). The verify-script
itself needs an update to drop the deleted-view assertions — that work
belongs in v1.6's milestone-close audit, not Phase 40.

## Commit SHAs

| SHA | Subject |
|------|---------|
| `bcb1cd1` | `feat(40): REDUCE-02 — total recall background loop default-off` |
| `285a2c1` | `feat(40): REDUCE-03 — audio timeline always-on transcription default-off` |
| `6868d39` | `feat(40): REDUCE-04 — tentacle passive observation default-off` |

## Success criteria (from 40-CONTEXT.md)

- [x] `screen_timeline.rs` background capture loop no longer starts at app launch
- [x] `capture_screen_now` / `timeline_search_cmd` / `timeline_browse_cmd` etc. remain callable
- [x] `audio_timeline.rs` always-on transcription no longer starts at app launch
- [x] Audio on-demand capture/transcription command remains callable
  (`start_audio_timeline_capture` preserved; `audio_capture_enabled` flag still toggles it)
- [x] All observer-class tentacles default to `enabled: false`
- [ ] `verify:all` ≥36/38 — **deferred to v1.6 milestone-close audit**
  (the verify-script asserts on already-deleted views from earlier v1.6
  cuts; needs script update, not Phase 40 code change)
- [x] cargo check clean
- [x] tsc --noEmit clean
- [ ] Chat smoke test — operator-owned per V2-AUTONOMOUS-HANDOFF §1

## Deviations from plan

None on the code path. The plan called for "verify:all ≥36/38" but the
chain short-circuits on the pre-existing feature-cluster-routes failure
that was inherited from earlier v1.6 deletion commits. Per
V2-AUTONOMOUS-HANDOFF.md §1, this closes at static-gates-green
(cargo + tsc) with the verify-script gap documented as carry-forward
for the v1.6 milestone-close audit.

## Open issues / regressions noticed

1. **`scripts/verify-feature-cluster-routes.sh` is stale.** It asserts
   on `FinanceView.tsx`, `SidecarView.tsx`, `WorkflowBuilder.tsx`, and
   `SecurityDashboard.tsx` — all of which were deleted by earlier v1.6
   cut commits. The verify-script needs the corresponding assertions
   removed before `verify:all` can pass clean. **Action item for v1.6
   milestone-close audit** (not Phase 40 scope).

2. **No runtime UAT.** Per V2-AUTONOMOUS-HANDOFF.md §1, runtime UAT
   (`npm run tauri dev`, screenshot capture, round-trip exercise) is
   operator-owned and happens on the operator's machine after the
   autonomous session ends.
