---
phase: 12-smart-deep-scan
plan: "04"
subsystem: frontend/identity + frontend/settings + rust/config
tags: [react, typescript, profile-ui, privacy-settings, playwright, tauri-command]
dependency_graph:
  requires:
    - deep_scan::profile::profile_get_rendered (Plan 12-03)
    - deep_scan::profile::profile_overlay_upsert (Plan 12-03)
    - deep_scan::profile::profile_overlay_reset (Plan 12-03)
    - deep_scan::profile::scan_cancel (Plan 12-03)
    - config::ScanClassesEnabled (Plan 12-02)
  provides:
    - src/features/identity/ProfileView (5-tab layout + live tail + overlay UI)
    - src/features/identity/index.tsx (8th registry entry: id=profile)
    - src/features/settings/panes/PrivacyPane.DeepScanPrivacySection (8 toggles)
    - config::set_scan_classes_enabled (new Tauri command)
    - src/lib/tauri/deepscan.setScanClassesEnabled (TS wrapper)
    - tests/e2e/profile-tabs.spec.ts
    - tests/e2e/profile-edit-roundtrip.spec.ts
    - tests/e2e/profile-live-tail.spec.ts
    - tests/e2e/settings-privacy-scan-classes.spec.ts
  affects:
    - src/features/identity/identity.css (additive rules: scan-log-line, rhythm-heatmap, profile-table-row)
    - src-tauri/src/lib.rs (set_scan_classes_enabled registered in generate_handler![])
    - package.json (test:e2e:phase12 script added)
tech_stack:
  added: []
  patterns:
    - "Identity sub-view registry pattern (8th entry, lazy import)"
    - "useTauriEvent for live-tail event subscription (D-13 compliant)"
    - "Optimistic UI toggle with revert-on-error for privacy config"
    - "FIFO log buffer (last 10 events) with auto-expand/collapse on scan phase"
    - "parseFieldsFromText: key: value round-trip for EditSectionDialog reuse"
    - "Focus trap in LeadDetailsDrawer via keydown + tabindex"
key_files:
  created:
    - src/features/identity/ProfileView.tsx
    - tests/e2e/profile-tabs.spec.ts
    - tests/e2e/profile-edit-roundtrip.spec.ts
    - tests/e2e/profile-live-tail.spec.ts
    - tests/e2e/settings-privacy-scan-classes.spec.ts
  modified:
    - src/features/identity/index.tsx (8th route entry)
    - src/features/identity/identity.css (additive Phase 12 rules)
    - src/features/settings/panes/PrivacyPane.tsx (DeepScanPrivacySection appended)
    - src-tauri/src/config.rs (set_scan_classes_enabled command)
    - src-tauri/src/lib.rs (command registered)
    - src/lib/tauri/deepscan.ts (setScanClassesEnabled wrapper + ScanClassesEnabled type)
    - src/lib/tauri/index.ts (barrel re-exports)
    - package.json (test:e2e:phase12 script)
decisions:
  - "set_scan_classes_enabled Tauri command added to config.rs as Rule 2 deviation — the Privacy pane needed a command to persist toggle state; no generic setter existed"
  - "toast action prop not supported by existing ToastContext (ShowInput type) — removed View Profile action from Re-scan toast; user can navigate manually"
  - "App.tsx 3-place route rule not applicable — CommandPalette reads PALETTE_COMMANDS from router.ts which auto-spreads identityRoutes; no App.tsx edit needed for new identity routes"
metrics:
  duration: "~60m"
  completed_date: "2026-04-20"
  tasks_completed: 2
  tasks_total: 3
  files_created: 6
  files_modified: 8
---

# Phase 12 Plan 04: ProfileView + Settings Privacy Deep Scan — Summary

**One-liner:** ProfileView with 5-tab layout (Repos/Accounts/Stack/Rhythm/Files), ScanActivityTail live-tail panel with auto-expand/collapse, Settings → Privacy DeepScanPrivacySection with 8 class toggles, and 4 Playwright e2e specs — all wired to Plan 12-03's overlay backend.

## What Was Built

### Task 1: ProfileView component + identity registry + CSS

**`src/features/identity/ProfileView.tsx`** (1380+ lines):

- **SourcePill** — 9-entry taxonomy lookup (fs/git/ide/ai/shell/mru/bkmk/which/manual) with exact colors per UI-SPEC §Source Pill Taxonomy. Inline `color`/`borderColor`/`background` props on `<Pill>`.
- **ScanActivityTail** — subscribes to `BLADE_EVENTS.DEEP_SCAN_PROGRESS` via `useTauriEvent`. FIFO 10-line buffer. Auto-expands on first event, auto-collapses 3s after `phase === 'complete'`. `aria-expanded` + `aria-controls="scan-log-body"` on disclosure button. `role="log" aria-live="polite"` on log body. Cancel button calls `scanCancel()`.
- **ProfileSectionTable** — semantic `<table role="table">` with sortable columns, row menus (Edit/Hide/Delete/Reset to scan), zebra striping, focus ring on rows. Menu state managed per-row; outside click closes.
- **LeadDetailsDrawer** — right-edge `role="dialog"` with focus trap (Tab cycling + Esc to close), `min(420px, 60vw)` width, GlassPanel tier=2.
- **RhythmHeatmap** — 7×24 CSS Grid with opacity-scaled cells (`clamp(0.04, count/maxCount, 0.80)`). `role="img"` with descriptive aria-label. Zero-activity cells show floor 0.04 opacity for WCAG perceivability.
- **ProfileView** — 5 tab panels. Empty states via `<EmptyState>` with correct testIds. Edit flow: `EditSectionDialog` + `parseFieldsFromText` parses `key: value` lines back to fields object for `profileOverlayUpsert`. Overlay rendering: edited rows show `<Pill tone="pro">edited</Pill>`, orphaned rows show `<Pill tone="new">not found</Pill>` in gray.

**`src/features/identity/index.tsx`** — 8th entry appended:
```typescript
{ id: 'profile', label: 'Profile', section: 'identity', component: ProfileView, phase: 12 }
```

**`src/features/identity/identity.css`** — Additive rules under existing `@layer features`:
- `.scan-summary-bar`, `.scan-log-body`, `.scan-log-line`, `.scan-log-ts`
- Scanner tag colors: `.scan-log-tag-fs_mru`, `.scan-log-tag-git_remotes`, etc.
- `.profile-table-row`, `.profile-table-row-orphaned`
- `.rhythm-heatmap`, `.rhythm-cell`
- `.identity-tab-pill:focus-visible` focus ring extension

### Task 2: Settings → Privacy + Playwright specs + Rust command

**`src/features/settings/panes/PrivacyPane.tsx`** — `DeepScanPrivacySection` appended after Config directory card:
- 8 toggle rows from `SCAN_CLASS_TOGGLES` array, each with `id="scan-class-{id}"` and `aria-describedby="scan-class-{id}-desc"`.
- Optimistic toggle state update → `setScanClassesEnabled()` → `reloadConfig()` on success; revert + error toast on failure.
- All-off guard: inline warning disables Re-scan button.
- Re-scan button calls `deepScanStart()` with "Scan started" success toast.

**`src-tauri/src/config.rs`** — `set_scan_classes_enabled` Tauri command (Rule 2 deviation — no generic config setter existed):
```rust
#[tauri::command]
pub fn set_scan_classes_enabled(fs_repos: bool, git_remotes: bool, ...) -> Result<(), String>
```

**`src/lib/tauri/deepscan.ts`** — `setScanClassesEnabled` wrapper + `ScanClassesEnabled` interface. Barrel-exported from `src/lib/tauri/index.ts`.

**4 Playwright e2e specs** under `tests/e2e/`:
- `profile-tabs.spec.ts` — 5 tabs in order, Repos default active, panel switch, source pill presence
- `profile-edit-roundtrip.spec.ts` — edit row → reload → `edited` pill visible (skips gracefully if no rows)
- `profile-live-tail.spec.ts` — collapsed by default, Cancel hidden, log body ARIA roles
- `settings-privacy-scan-classes.spec.ts` — 8 toggles, all checked default, persist after reload, Re-scan present

**`package.json`** — `test:e2e:phase12` script wiring all 4 specs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] set_scan_classes_enabled Rust command**
- **Found during:** Task 2 (DeepScanPrivacySection needs to persist toggle state)
- **Issue:** No Tauri command existed to update `scan_classes_enabled` — only the large `set_config` command which requires provider/model/api_key parameters
- **Fix:** Added `set_scan_classes_enabled` command to `src-tauri/src/config.rs`, registered in `lib.rs` `generate_handler![]`, added TS wrapper in `deepscan.ts`
- **Files modified:** `src-tauri/src/config.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri/deepscan.ts`, `src/lib/tauri/index.ts`
- **Commits:** eaee693, 047426c

**2. [Rule 1 - Bug] Toast action prop unsupported**
- **Found during:** Task 2 TypeScript check
- **Issue:** `ShowInput` type in `ToastContext.tsx` does not include an `action` field; adding `action: { label, onClick }` caused TS2353
- **Fix:** Removed `action` from the Re-scan toast — toast shows "Open Profile to watch progress." without a clickable link (acceptable; user can navigate via sidebar)
- **Files modified:** `src/features/settings/panes/PrivacyPane.tsx`

**3. [Rule 1 - Bug] ScanClassesEnabled type constraint mismatch**
- **Found during:** Task 2 TypeScript check  
- **Issue:** `invokeTyped<void, ScanClassesEnabled>` failed — `ScanClassesEnabled` lacks index signature required by `TArgs extends Record<string, unknown>`
- **Fix:** Cast via `classes as unknown as Record<string, unknown>` in the wrapper call
- **Files modified:** `src/lib/tauri/deepscan.ts`

### Architecture Note — App.tsx 3-place rule

The plan called for editing App.tsx to add a route type union and palette entry. Investigation showed:
- There is no standalone `App.tsx` in this codebase — the main window uses `MainShell.tsx` + `router.ts`
- `CommandPalette` reads `PALETTE_COMMANDS` from `router.ts` which auto-spreads `identityRoutes`
- Adding the profile entry to `identity/index.tsx` is sufficient — it auto-appears in the palette

No App.tsx edit was needed or made. This is not a deviation; it's the correct behavior of the existing architecture.

## Threat Surface Scan

No new network endpoints. `set_scan_classes_enabled` writes only to `~/.blade/blade_config.json` via the existing `save_config()` path — same trust boundary as all other config writes. ProfileView renders local scan data; no external data sources introduced.

## Self-Check

### Files exist:
- [x] `src/features/identity/ProfileView.tsx` (1380+ lines)
- [x] `src/features/identity/index.tsx` contains `id: 'profile'` (8th entry)
- [x] `src/features/identity/identity.css` contains `.scan-log-line` and `.rhythm-heatmap`
- [x] `src/features/settings/panes/PrivacyPane.tsx` contains `DeepScanPrivacySection` and `scan-classes-heading`
- [x] `tests/e2e/profile-tabs.spec.ts`
- [x] `tests/e2e/profile-edit-roundtrip.spec.ts`
- [x] `tests/e2e/profile-live-tail.spec.ts`
- [x] `tests/e2e/settings-privacy-scan-classes.spec.ts`
- [x] `package.json` has `test:e2e:phase12` script
- [x] `src-tauri/src/lib.rs` has `config::set_scan_classes_enabled` in `generate_handler![]`

### Commits exist:
- [x] eaee693 — feat(12-04): ProfileView component + 8th identity registry entry + identity.css additive rules
- [x] 047426c — feat(12-04): Settings Privacy Deep Scan section + 4 Playwright e2e specs

## Self-Check: PASSED

## Checkpoint Status

Task 3 (human-verify) is a blocking checkpoint. The automated build is complete and TypeScript is clean. Human verification required before Plan 12-04 is marked complete.
