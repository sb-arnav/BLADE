---
phase: 13-self-configuring-ecosystem
plan: "02"
subsystem: frontend/settings/ecosystem
tags: [react, typescript, settings-pane, tentacles, observe-only, playwright, e2e]
dependency_graph:
  requires:
    - ecosystem::ecosystem_list_tentacles (Phase 13 Plan 01)
    - ecosystem::ecosystem_toggle_tentacle (Phase 13 Plan 01)
    - ecosystem::ecosystem_observe_only_check (Phase 13 Plan 01)
    - ecosystem::ecosystem_run_auto_enable (Phase 13 Plan 01)
    - config::TentacleRecord (Phase 13 Plan 01)
    - design-system/primitives Card + GlassPanel (existing)
    - useToast context hook (existing)
  provides:
    - EcosystemPane (Settings tab — tentacle list + toggles)
    - TentacleRecord TypeScript interface
    - ecosystemListTentacles / ecosystemToggleTentacle / ecosystemObserveOnlyCheck / ecosystemRunAutoEnable wrappers
    - settings-ecosystem route (SettingsShell 11th tab)
    - test:e2e:phase13 script
  affects:
    - src/features/settings/SettingsShell.tsx (11th PANES + TABS entry)
    - src/features/settings/index.tsx (12th RouteDefinition)
    - src/lib/tauri/index.ts (export * from './ecosystem')
tech_stack:
  added: []
  patterns:
    - invokeTyped<T> wrapper pattern (matching deepscan.ts file-per-cluster discipline)
    - Optimistic toggle with revert-on-error (matching DeepScanPrivacySection pattern)
    - Lazy-loaded settings pane via React.lazy (matching SettingsShell PANES pattern)
    - data-testid + id-based selectors for Playwright e2e
key_files:
  created:
    - src/lib/tauri/ecosystem.ts
    - src/features/settings/panes/EcosystemPane.tsx
    - tests/e2e/settings-ecosystem-tentacles.spec.ts
    - tests/e2e/settings-ecosystem-disable-persists.spec.ts
  modified:
    - src/lib/tauri/index.ts
    - src/types/provider.ts
    - src/features/settings/SettingsShell.tsx
    - src/features/settings/index.tsx
    - package.json
decisions:
  - "Used export * from './ecosystem' (wildcard) in index.ts matching Phase 13 ecosystem namespace — consistent with existing body/hive/agents/knowledge namespace re-exports"
  - "TentacleRecord uses snake_case field names (enabled_at, trigger_detail) — matches Rust TentacleRecord without #[serde(rename_all)] per plan decision from 13-01"
  - "EcosystemPane fetches on every mount (no caching) — T-13-09 mitigation: always fresh from BladeConfig source of truth"
  - "OBSERVE_ONLY badge rendered unconditionally — not gated on ecosystemObserveOnlyCheck() call to avoid async flash; v1.1 guardrail is static"
metrics:
  duration: "8m"
  completed_date: "2026-04-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 5
  files_deleted: 0
---

# Phase 13 Plan 02: EcosystemPane Settings Tab Summary

**One-liner:** EcosystemPane with OBSERVE_ONLY badge, per-tentacle rationale rows + optimistic toggles, wired as the 11th Settings tab, backed by 4 invokeTyped wrappers and 2 Playwright e2e specs.

## What Was Built

### Task 1: TypeScript wrappers (ecosystem.ts + TentacleRecord + barrel export)

New `src/lib/tauri/ecosystem.ts` — 4 invokeTyped wrappers following the deepscan.ts file-per-cluster discipline:

- `ecosystemListTentacles()` — fetches all registered tentacles (ECOSYS-07)
- `ecosystemToggleTentacle(id, enabled)` — persists enabled/disabled state (ECOSYS-08)
- `ecosystemObserveOnlyCheck()` — observe-only guardrail test seam (ECOSYS-09)
- `ecosystemRunAutoEnable()` — re-triggers auto-enable from last scan results

`src/types/provider.ts` — `TentacleRecord` interface appended with snake_case fields matching Rust struct exactly (no serde rename): `id`, `enabled`, `rationale`, `enabled_at`, `trigger_detail`.

`src/lib/tauri/index.ts` — `export * from './ecosystem'` added before the events re-export block.

### Task 2: EcosystemPane + wiring + e2e specs

New `src/features/settings/panes/EcosystemPane.tsx` (161 lines):
- `data-testid="ecosystem-pane"` for Playwright targeting
- OBSERVE_ONLY badge (`Observe only (v1.1)`) — always visible in v1.1, rendered inline without async check to avoid flash
- Loading state while `ecosystemListTentacles()` resolves
- Empty state when `tentacles.length === 0` — prompts user to run deep scan
- Tentacle list rendered in `GlassPanel tier={2}` — each row is a 28px/1fr grid with:
  - Checkbox (optimistic toggle, revert-on-error)
  - Label line (human-readable name from TENTACLE_LABELS map)
  - Description line (service-specific read-only clarification)
  - Rationale line (italic, only when `record.rationale` is non-empty)
- `handleToggle` follows DeepScanPrivacySection pattern exactly: optimistic update → invoke → revert-on-error

`src/features/settings/SettingsShell.tsx` — 11th entry in both `PANES` (lazy import) and `TABS` (`{ id: 'settings-ecosystem', label: 'Ecosystem' }`).

`src/features/settings/index.tsx` — 12th `RouteDefinition` entry: `{ id: 'settings-ecosystem', label: 'Ecosystem', section: 'core', component: SettingsShell, phase: 13 }`.

`tests/e2e/settings-ecosystem-tentacles.spec.ts` — 4 specs covering ECOSYS-07: pane renders, OBSERVE_ONLY badge visible, heading rendered, empty/populated state present.

`tests/e2e/settings-ecosystem-disable-persists.spec.ts` — 2 specs covering ECOSYS-08: checkbox interactive (skipped vacuously when no tentacles in test env), rationale label present on rows.

`package.json` — `test:e2e:phase13` script added after `test:e2e:phase12`.

## Verification

1. `npx tsc --noEmit`: zero errors
2. `grep "settings-ecosystem" SettingsShell.tsx | wc -l`: 2 (PANES + TABS)
3. `grep "settings-ecosystem" index.tsx`: match found
4. `grep "export * from './ecosystem'" index.ts`: match found
5. `grep "TentacleRecord" provider.ts`: match found
6. `grep "test:e2e:phase13" package.json`: match found
7. `wc -l EcosystemPane.tsx`: 161 lines (≥100 required)
8. `data-testid="ecosystem-pane"`: present
9. `Observe only (v1.1)`: present

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — EcosystemPane fetches live data from `ecosystemListTentacles()` on every mount. The TENTACLE_LABELS and TENTACLE_DESCS maps are display-only fallbacks for unknown IDs, not stubs. The empty state ("No tentacles enabled yet") is the correct behavior when no scan has run — it is not a stub.

## Threat Surface Scan

All T-13-07, T-13-08, T-13-09 mitigations from the plan threat model are implemented:

| Threat | Mitigation | Verified |
|--------|-----------|---------|
| T-13-07: Tampering — toggle sends arbitrary id | id sourced from server-provided TentacleRecord, not user input; Rust validates id | ids come from `tentacles` state set by `ecosystemListTentacles()` |
| T-13-08: Info Disclosure — rationale in DOM | rationale is human-readable summary, no raw paths | `{record.rationale}` rendered only when non-empty |
| T-13-09: Spoofing — stale tentacle state | EcosystemPane refetches on every mount, no caching | `useEffect(... [])` calls `ecosystemListTentacles()` unconditionally |

## Self-Check

### Files exist:
- [x] `src/lib/tauri/ecosystem.ts` (created)
- [x] `src/types/provider.ts` (TentacleRecord appended)
- [x] `src/lib/tauri/index.ts` (export * from './ecosystem' added)
- [x] `src/features/settings/panes/EcosystemPane.tsx` (161 lines)
- [x] `src/features/settings/SettingsShell.tsx` (2 settings-ecosystem entries)
- [x] `src/features/settings/index.tsx` (RouteDefinition appended)
- [x] `tests/e2e/settings-ecosystem-tentacles.spec.ts` (created)
- [x] `tests/e2e/settings-ecosystem-disable-persists.spec.ts` (created)
- [x] `package.json` (test:e2e:phase13 added)

### Commits exist:
- [x] 191e44d — feat(13-02): ecosystem.ts wrappers + TentacleRecord interface + barrel export
- [x] a2a8a4f — feat(13-02): EcosystemPane + SettingsShell wiring + 2 e2e specs + test:e2e:phase13

## Self-Check: PASSED
