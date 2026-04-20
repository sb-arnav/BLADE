---
phase: 12-smart-deep-scan
plan: "03"
subsystem: backend/deep_scan + frontend/tauri
tags: [rust, typescript, profile-overlay, tauri-commands]
dependency_graph:
  requires:
    - deep_scan::LeadQueue (Plan 12-01)
    - deep_scan::scanners (Plan 12-02)
  provides:
    - deep_scan::profile::profile_get_rendered
    - deep_scan::profile::profile_overlay_upsert
    - deep_scan::profile::profile_overlay_reset
    - deep_scan::profile::scan_cancel
    - src/lib/tauri/deepscan.profileGetRendered
    - src/types/provider.ProfileView
    - src/types/provider.RenderedRow
key_files:
  created:
    - src-tauri/src/deep_scan/profile.rs
    - (types appended to src/types/provider.ts)
  modified:
    - src-tauri/src/deep_scan/mod.rs (pub mod profile;)
    - src-tauri/src/lib.rs (4 commands in generate_handler![])
    - src/lib/tauri/deepscan.ts (4 profile wrappers appended)
    - src/lib/tauri/index.ts (4 barrel re-exports added)
    - src/types/provider.ts (OverlayAction, RenderedRow, ProfileView, RhythmSignal, LlmEnrichments appended)
metrics:
  completed_date: "2026-04-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 4
---

# Phase 12 Plan 03: Profile Overlay Backend + TypeScript Wrappers

**One-liner:** Two-file persistence split (scan_results.json + profile_overlay.json) with atomic writes, overlay merge logic (edit/hide/delete/add), 4 Tauri commands, and TypeScript wrappers barrel-exported — Plan 12-04's ProfileView can call all profile commands immediately.

## What Was Built

### Task 1: profile.rs — overlay persistence + merge logic + 4 Tauri commands

- **profile.rs** (654 lines): `OverlayEntry`, `OverlayAction`, `ProfileOverlay`, `RenderedRow`, `ProfileView` structs. `save_overlay`/`load_overlay` helpers with atomic write (temp + rename). `merge_scan_with_overlay` implements D-62 render algorithm: overlay fields win, hide/delete rows suppressed, orphaned overlay rows flagged. `OVERLAY_LOCK: tokio::sync::Mutex<()>` serializes concurrent writes. All 4 Tauri commands (`profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`, `scan_cancel`). 7 unit tests cover round-trip, orphan preservation, edit-wins, hide/delete filters, add appends, atomic write safety.
- `mod.rs`: `pub mod profile;` added.
- `lib.rs`: 4 commands registered in `generate_handler![]`.

### Task 2: TypeScript wrappers + provider types

- `src/types/provider.ts`: `OverlayAction`, `RhythmSignal`, `LlmEnrichments`, `RenderedRow`, `ProfileView` interfaces appended.
- `src/lib/tauri/deepscan.ts`: `profileGetRendered`, `profileOverlayUpsert`, `profileOverlayReset`, `scanCancel` wrappers with correct two-generic `invokeTyped<R, A>` pattern.
- `src/lib/tauri/index.ts`: All 4 new functions barrel-exported.
- `npx tsc --noEmit`: zero errors.

## Verification

- `cargo check`: zero errors (WSL link-gap for system libs is pre-existing, not introduced here)
- `npx tsc --noEmit`: clean
- 4 profile commands present in `lib.rs` `generate_handler![]`
- 4 TypeScript functions barrel-exported from `src/lib/tauri/index.ts`
- Atomic write: temp + rename pattern in `save_overlay`
- Concurrent write safety: `OVERLAY_LOCK` in all write paths

## Self-Check

### Files exist:
- [x] `src-tauri/src/deep_scan/profile.rs` (654 lines)
- [x] `src-tauri/src/deep_scan/mod.rs` declares `pub mod profile;`
- [x] `src-tauri/src/lib.rs` contains `profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`, `scan_cancel`
- [x] `src/lib/tauri/deepscan.ts` exports all 4 profile functions
- [x] `src/lib/tauri/index.ts` re-exports all 4 profile functions
- [x] `src/types/provider.ts` contains `ProfileView`, `RenderedRow`, `OverlayAction`

### Commits:
- [x] 71623c3 — feat(12-03): profile overlay backend — persistence, merge logic, 4 Tauri commands
- [x] 7b70480 — feat(12-03): TypeScript profile overlay wrappers + provider types

## Self-Check: PASSED
