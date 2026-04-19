---
phase: 08-body-hive
plan: 02
subsystem: body-hive-wrapper-surface
tags: [wrappers, types, routes, body, hive, phase-8]
dependency_graph:
  requires:
    - src/lib/tauri/_base.ts (Phase 1 invokeTyped + TauriError)
    - src/lib/tauri/homeostasis.ts (Phase 3 — extended here with 4th wrapper)
    - src/lib/tauri/admin.ts (Phase 7 — cross-cluster supervisor/integration reads per D-196)
    - src/lib/router.ts (Phase 1 RouteDefinition)
    - src/design-system/primitives/GlassPanel.tsx (Phase 1)
    - src-tauri/src/lib.rs (generate_handler! — ~35 Phase 8 commands already registered)
  provides:
    - "src/lib/tauri/body.ts — 22 typed wrappers across 10 Rust modules (body_registry, organ, dna, world_model, cardiovascular, urinary, reproductive, joints) + homeostasis namespace re-export"
    - "src/lib/tauri/hive.ts — 10 typed wrappers (8 hive + 2 ai_delegate) + TentacleStatus / Priority / Decision union types + HiveStatus/TentacleReport/TentacleSummary/AiDelegateInfo interfaces"
    - "src/lib/tauri/homeostasis.ts — 4th wrapper homeostasisRelearnCircadian (D-194 in-situ)"
    - "src/lib/tauri/index.ts — body + hive namespace exports; homeostasisRelearnCircadian added to named-export block"
    - "src/features/body/index.tsx — 6 lazy per-route imports replace Phase 1 stubs (D-199 single-writer)"
    - "src/features/hive/index.tsx — 5 lazy per-route imports replace Phase 1 stubs (D-199)"
    - "11 placeholder route components (6 body + 5 hive) with data-testid=<route-id>-root seeds for Plan 08-05 Playwright specs"
    - "src/features/body/types.ts + src/features/hive/types.ts — cluster-local type barrels + BodySystemName / TentaclePlatform unions (D-208)"
    - "src/features/body/body.css + src/features/hive/hive.css — @layer features-body / features-hive scoped styles (D-210); hormone-meter, circadian-grid, tentacle-grid, status-* classes seeded for Plans 08-03/04"
  affects:
    - Plan 08-03 Body cluster (BodyMap, BodySystemDetail, HormoneBus, OrganRegistry, DNA, WorldModel) — imports wrappers + types from body.ts; fills per-route files without editing index.tsx
    - Plan 08-04 Hive cluster (HiveMesh, TentacleDetail, AutonomyControls, ApprovalQueue, AiDelegate) — imports wrappers + types from hive.ts; fills per-route files without editing index.tsx
    - Plan 08-05 Playwright specs — assert `data-testid="<route-id>-root"` mounts + mocked invokeTyped calls
tech-stack:
  added: []
  patterns:
    - "D-206 typed-wrapper-per-Rust-command recipe mirrored from Phase 5 §1 + Phase 6 §1 + Phase 7 §1"
    - "D-194 cross-cluster re-export (body.ts re-exports `homeostasis` namespace without duplicating wrapper definitions)"
    - "D-195 per-tentacle autonomy read/write via body.ts `organSetAutonomy`/`organGetAutonomy` — no duplication in hive.ts"
    - "D-199 single-writer invariant — Plan 08-02 owns the two cluster index.tsx rewrites; Plans 08-03/04 only fill per-route files"
    - "D-207 payload index signature `[k: string]: unknown` on every interface for forward-compat"
    - "D-208 cluster-local types barrel (re-exports + cluster-only UI unions)"
    - "D-210 @layer features-{cluster} CSS scoping + Phase 5 status tokens reused verbatim"
    - "ESLint no-raw-tauri preserved (invokeTyped is the only permitted surface)"
key-files:
  created:
    - src/lib/tauri/body.ts (443 lines — 22 wrappers + 12 interfaces + homeostasis re-export)
    - src/lib/tauri/hive.ts (254 lines — 10 wrappers + 2 unions + Decision tagged union + 4 interfaces)
    - src/features/body/BodyMap.tsx (BODY-01 placeholder — data-testid="body-map-root")
    - src/features/body/BodySystemDetail.tsx (BODY-02 placeholder — data-testid="body-system-detail-root")
    - src/features/body/HormoneBus.tsx (BODY-03 placeholder — data-testid="hormone-bus-root")
    - src/features/body/OrganRegistry.tsx (BODY-04 placeholder — data-testid="organ-registry-root")
    - src/features/body/DNA.tsx (BODY-05 placeholder — data-testid="dna-root")
    - src/features/body/WorldModel.tsx (BODY-06 placeholder — data-testid="world-model-root")
    - src/features/hive/HiveMesh.tsx (HIVE-01 placeholder — data-testid="hive-mesh-root")
    - src/features/hive/TentacleDetail.tsx (HIVE-02 placeholder — data-testid="hive-tentacle-root")
    - src/features/hive/AutonomyControls.tsx (HIVE-03 placeholder — data-testid="hive-autonomy-root")
    - src/features/hive/ApprovalQueue.tsx (HIVE-04 placeholder — data-testid="approval-queue-root")
    - src/features/hive/AiDelegate.tsx (HIVE-06 placeholder — data-testid="ai-delegate-root")
    - src/features/body/types.ts (cluster type barrel + BodySystemName union)
    - src/features/hive/types.ts (cluster type barrel + TentaclePlatform union)
    - src/features/body/body.css (@layer features-body — placeholder classes + Plan 08-03 seed classes)
    - src/features/hive/hive.css (@layer features-hive — placeholder classes + Plan 08-04 seed classes)
    - .planning/phases/08-body-hive/08-02-SUMMARY.md
  modified:
    - src/lib/tauri/homeostasis.ts (+15 lines — added homeostasisRelearnCircadian; D-194)
    - src/lib/tauri/index.ts (+8 lines — body/hive namespace exports; homeostasisRelearnCircadian in named-export block)
    - src/features/body/index.tsx (rewritten — 6 lazy per-route imports replace Phase 1 skeletons; D-199)
    - src/features/hive/index.tsx (rewritten — 5 lazy per-route imports replace Phase 1 skeletons; D-199)
decisions:
  - "Used actual Rust struct shapes for WorldState field types (ProcessInfo = {name, pid, interesting}; PortInfo = {port, process, protocol}; FileChange = {path, changed_at, change_type}; SystemLoad = {cpu_cores, memory_total_mb, memory_used_mb, disk_free_gb}; TodoItem = {file, line, text}) — 08-PATTERNS.md §1 showed older guesses; grep-audited src-tauri/src/world_model.rs:23-66 for authoritative shapes. D-207 index signature still present on every interface."
  - "reproductiveSpawn signature takes {agentType, task, workingDir?} not {agentType, initialTask?} — Rust command is `reproductive_spawn(agent_type, task, working_dir: Option<String>)` per src-tauri/src/reproductive.rs:222. Pattern file example was off; I matched the Rust truth. The plan frontmatter exports list still matches (method is still named reproductiveSpawn)."
  - "BloodPressure / ImmuneStatus / VitalSigns mirrored from actual Rust structs (cardiovascular.rs:82, urinary.rs:195, cardiovascular.rs:241) not the pattern-file illustrative shapes — the real shapes have more fields (events_per_minute, api_calls_per_minute, total_events, hottest_channels; threats_last_hour, blocked_actions; services_alive, services_dead, brain_working_memory_active). D-207 index signatures kept."
  - "VitalSigns.hormones typed as `unknown` (not importing from @/types/hormones) to keep body.ts free of cross-cluster type deps — Plan 08-03 HormoneBus imports HormoneState directly from @/types/hormones as it always has; BodySystemDetail narrows the unknown when needed."
  - "body.ts uses `export * as homeostasis from './homeostasis'` re-export per D-194 so per-route files can reach homeostasis wrappers via the body namespace OR via the canonical @/lib/tauri/homeostasis path — both resolve to the same module."
  - "hive.ts Decision is a tagged union matching `#[serde(tag = \"type\", content = \"data\")]` exactly — 4 variants (Reply, Escalate, Act, Inform) with their field shapes."
  - "Placeholder components are MINIMAL — each imports GlassPanel + the cluster CSS, renders a panel with data-testid=<route-id>-root + 'Ships in Plan 08-0X' text. No state, no hooks, no subscriptions. Plans 08-03/04 replace the component body wholesale (D-199)."
  - "CSS files front-load classes Plans 08-03/04 will need (hormone-meter, circadian-grid, circadian-bar.current-hour, tentacle-grid, tentacle-card.status-*, autonomy-matrix, decision-details, etc.) so those plans can ship without CSS-edit serialization — placeholder components only need body-map/body-system-detail/etc root classes to apply layout tokens."
metrics:
  duration_seconds: 1020
  tasks_completed: 3
  files_changed: 21
  lines_added: 1321
  lines_removed: 27
  completed_date: 2026-04-18
---

# Phase 8 Plan 08-02: Body + Hive Wrapper Surface + Cluster Rewrites — Summary

Ships the typed Tauri wrapper surface for BOTH Phase 8 clusters plus the
one-time rewrite of both cluster `index.tsx` files from Phase 1
`ComingSoonSkeleton` stubs to lazy imports of 11 per-route component files.
Seeds those 11 components as minimal placeholders so Plans 08-03 / 08-04 can
run in parallel with zero `index.tsx` contention (D-199). Zero Rust changes
(D-196 + D-200).

## Objective Delivered

- `src/lib/tauri/body.ts` — 22 typed wrappers spanning 10 Rust modules with
  JSDoc `@see` cites to each `#[tauri::command]` (D-206); re-exports the
  `homeostasis` namespace for cross-cluster convenience (D-194).
- `src/lib/tauri/hive.ts` — 10 typed wrappers (8 hive + 2 ai_delegate) plus
  `TentacleStatus` / `Priority` string unions and the `Decision` tagged union
  matching `#[serde(tag = "type", content = "data")]`.
- `src/lib/tauri/homeostasis.ts` — extended with `homeostasisRelearnCircadian`
  (the 4th wrapper; D-194 in-situ rather than in body.ts).
- `src/lib/tauri/index.ts` — barrel updated: `export * as body from './body'`,
  `export * as hive from './hive'`, plus `homeostasisRelearnCircadian` named
  export.
- `src/features/body/index.tsx` + `src/features/hive/index.tsx` — rewritten
  with 6 + 5 lazy imports each, preserving Phase 1 route id + label order so
  NavRail ordering doesn't shift.
- 11 per-route placeholder components — each renders `<GlassPanel
  data-testid="<route-id>-root">` with a "Ships in Plan 08-0X" line so Plan
  08-05 Playwright specs can assert mount points today.
- `src/features/body/types.ts` + `src/features/hive/types.ts` — cluster-local
  type barrels re-exporting wrapper types + exposing the `BodySystemName` and
  `TentaclePlatform` union UI types (D-208).
- `src/features/body/body.css` + `src/features/hive/hive.css` —
  `@layer features-body` / `@layer features-hive` scoped stylesheets seeding
  both placeholder classes AND the richer classes Plans 08-03/04 will consume
  (`.hormone-meter`, `.circadian-grid`, `.tentacle-card.status-*`,
  `.autonomy-matrix`, `.decision-details`, etc.) so those plans don't have to
  serialize on CSS edits.
- `npx tsc --noEmit`: clean.
- `npm run verify:all`: **13 / 13 green** (entries, no-raw-tauri,
  migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor,
  orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes, phase6-rust,
  phase7-rust).
- Zero Rust changes — verified by git log (no `src-tauri/` files touched in
  commits f4c3cea / de71b91 / c587cea).

## Task Breakdown

### Task 1 — body.ts + homeostasis.ts extension + barrel update (commit f4c3cea)

Created `src/lib/tauri/body.ts` (443 lines). Wrapper inventory, grouped by
Rust module:

| Rust module               | Commands                                                                                    | Wrappers (camelCase)                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `body_registry.rs` (×3)   | body_get_map / body_get_system / body_get_summary                                           | `bodyGetMap` / `bodyGetSystem` / `bodyGetSummary`                      |
| `organ.rs` (×4)           | organ_get_registry / organ_get_roster / organ_set_autonomy / organ_get_autonomy             | `organGetRegistry` / `organGetRoster` / `organSetAutonomy` / `organGetAutonomy` |
| `dna.rs` (×4)             | dna_get_identity / dna_get_goals / dna_get_patterns / dna_query                             | `dnaGetIdentity` / `dnaGetGoals` / `dnaGetPatterns` / `dnaQuery`       |
| `world_model.rs` (×3)     | world_get_state / world_get_summary / world_refresh                                         | `worldGetState` / `worldGetSummary` / `worldRefresh`                   |
| `cardiovascular.rs` (×3)  | cardio_get_blood_pressure / cardio_get_event_registry / blade_vital_signs                   | `cardioGetBloodPressure` / `cardioGetEventRegistry` / `bladeVitalSigns` |
| `urinary.rs` (×2)         | urinary_flush / immune_get_status                                                           | `urinaryFlush` / `immuneGetStatus`                                     |
| `reproductive.rs` (×2)    | reproductive_get_dna / reproductive_spawn                                                   | `reproductiveGetDna` / `reproductiveSpawn`                             |
| `joints.rs` (×2)          | joints_list_providers / joints_list_stores                                                  | `jointsListProviders` / `jointsListStores`                             |

Hand-typed interfaces: `ModuleMapping`, `OrganCapability`, `OrganStatus`,
`GitRepoState`, `ProcessInfo`, `PortInfo`, `FileChange`, `SystemLoad`,
`TodoItem`, `WorldState`, `BloodPressure`, `EventInfo`, `VitalSigns`,
`ImmuneStatus`, `InheritedDna`. Every interface carries
`[k: string]: unknown` for forward-compat (D-207). Every wrapper has a JSDoc
`@see src-tauri/src/<file>.rs:<line>` cite (39 citations total — comfortably
above the D-206 threshold).

`homeostasis.ts` extended with `homeostasisRelearnCircadian(): Promise<number[]>`
(cites src-tauri/src/homeostasis.rs:862). `index.ts` barrel updated to
re-export the body namespace AND the new homeostasis wrapper from the named
block so `@/lib/tauri` and `@/lib/tauri/homeostasis` both expose it.

### Task 2 — hive.ts + barrel update (commit de71b91)

Created `src/lib/tauri/hive.ts` (254 lines). 10 typed wrappers:

| Rust module           | Commands                                                                                              | Wrappers                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `hive.rs` (×8)        | hive_start / hive_stop / hive_get_status / hive_get_digest / hive_spawn_tentacle / hive_get_reports / hive_approve_decision / hive_set_autonomy | `hiveStart` / `hiveStop` / `hiveGetStatus` / `hiveGetDigest` / `hiveSpawnTentacle` / `hiveGetReports` / `hiveApproveDecision` / `hiveSetAutonomy` |
| `ai_delegate.rs` (×2) | ai_delegate_introduce / ai_delegate_check                                                             | `aiDelegateIntroduce` / `aiDelegateCheck`                              |

Type surface:

- `TentacleStatus = 'Active' | 'Dormant' | 'Error' | 'Disconnected'` — mirrors
  Rust Serialize-as-string enum at hive.rs:46.
- `Priority = 'Critical' | 'High' | 'Normal' | 'Low'` — hive.rs:56.
- `Decision` — tagged union for 4 variants (Reply/Escalate/Act/Inform) matching
  `#[serde(tag = "type", content = "data")]`.
- Interfaces: `TentacleReport`, `TentacleSummary`, `HiveStatus`,
  `AiDelegateInfo` — all with `[k: string]: unknown`.

Barrel updated: `export * as hive from './hive'`.

### Task 3 — index rewrites + 11 placeholders + 2 types + 2 CSS (commit c587cea)

`src/features/body/index.tsx` — rewritten:

```tsx
const BodyMap          = lazy(() => import('./BodyMap').then(m => ({ default: m.BodyMap })));
const BodySystemDetail = lazy(() => import('./BodySystemDetail').then(m => ({ default: m.BodySystemDetail })));
const HormoneBus       = lazy(() => import('./HormoneBus').then(m => ({ default: m.HormoneBus })));
const OrganRegistry    = lazy(() => import('./OrganRegistry').then(m => ({ default: m.OrganRegistry })));
const DNA              = lazy(() => import('./DNA').then(m => ({ default: m.DNA })));
const WorldModel       = lazy(() => import('./WorldModel').then(m => ({ default: m.WorldModel })));
```

Route IDs preserved from Phase 1 (body-map, body-system-detail, hormone-bus,
organ-registry, dna, world-model). Labels verbatim. `section: 'body'`,
`phase: 8` preserved.

`src/features/hive/index.tsx` — analogous rewrite. Route IDs: hive-mesh,
hive-tentacle, hive-autonomy, hive-approval-queue, hive-ai-delegate. Hive-mesh
keeps `description: 'All tentacles overview'`.

11 placeholder components — each ~18 lines, identical shape:

```tsx
import { GlassPanel } from '@/design-system/primitives';
import './body.css';

export function BodyMap() {
  return (
    <GlassPanel className="body-map" data-testid="body-map-root">
      <h2>Body Map</h2>
      <p>Ships in Plan 08-03 (BODY-01).</p>
    </GlassPanel>
  );
}
```

data-testid table (Plans 08-03/04 MUST preserve):

| Component           | data-testid                | Plan    | Requirement |
| ------------------- | -------------------------- | ------- | ----------- |
| BodyMap             | `body-map-root`            | 08-03   | BODY-01     |
| BodySystemDetail    | `body-system-detail-root`  | 08-03   | BODY-02     |
| HormoneBus          | `hormone-bus-root`         | 08-03   | BODY-03     |
| OrganRegistry       | `organ-registry-root`      | 08-03   | BODY-04     |
| DNA                 | `dna-root`                 | 08-03   | BODY-05     |
| WorldModel          | `world-model-root`         | 08-03   | BODY-06     |
| HiveMesh            | `hive-mesh-root`           | 08-04   | HIVE-01     |
| TentacleDetail      | `hive-tentacle-root`       | 08-04   | HIVE-02     |
| AutonomyControls    | `hive-autonomy-root`       | 08-04   | HIVE-03     |
| ApprovalQueue       | `approval-queue-root`      | 08-04   | HIVE-04     |
| AiDelegate          | `ai-delegate-root`         | 08-04   | HIVE-06     |

Types barrels (`src/features/body/types.ts`, `src/features/hive/types.ts`)
re-export wrapper-level types + expose `BodySystemName` (12-member union) and
`TentaclePlatform` (10-member union) for cluster-local type-safe routing
(D-208).

CSS files (`body.css`, `hive.css`) scoped via `@layer features-body` / `@layer
features-hive` (D-210). Seeded classes:

- `body.css`: `.body-map`, `.body-system-card`, `.body-system-detail`,
  `.hormone-bus`, `.hormone-row.accent-{red,green,blue,purple,neutral}`,
  `.hormone-meter`, `.circadian-grid`, `.circadian-bar` +
  `.circadian-bar.current-hour`, `.organ-registry`, `.dna`, `.dna-tabs`,
  `.world-model`.
- `hive.css`: `.hive-mesh`, `.hive-hero`, `.tentacle-grid`, `.tentacle-card.status-{active,dormant,error,disconnected}`,
  `.tentacle-platform`, `.tentacle-status`, `.tentacle-head`, `.tentacle-reports`,
  `.tentacle-detail`, `.autonomy-controls`, `.autonomy-matrix` (with
  `input[type="range"]` sizing), `.approval-queue`, `.decision-type`,
  `.decision-details`, `.decision-actions`, `.ai-delegate`.

All values resolve to Phase 1 tokens (`--glass-*-bg`, `--status-*`,
`--space-*`, `--radius-*`, `--font-mono`, etc). Only one non-token color —
`rgba(239, 68, 68, 0.08)` for the error-state tentacle-card tint (matches
Phase 7 D-183 danger-banner precedent).

## Deviations from Plan

### Auto-fixed Rust shape drift (Rule 1 — Correctness)

**1. [Rule 1 — Bug] WorldState sub-struct shapes differed from 08-PATTERNS.md §1 illustrations.**
- **Found during:** Task 1 body.ts type authoring
- **Issue:** Pattern file showed ProcessInfo as `{pid, name, cpu_percent, memory_mb}`, PortInfo as `{port, service?, local_addr?}`, FileChange as `{path, kind, timestamp}`, SystemLoad as `{cpu_percent, memory_percent, disk_percent}`, TodoItem as `{id, text, priority?}` — but grep-audit of src-tauri/src/world_model.rs:23-66 showed the actual Rust structs are `ProcessInfo = {name, pid, interesting}`, `PortInfo = {port, process, protocol}`, `FileChange = {path, changed_at, change_type}`, `SystemLoad = {cpu_cores, memory_total_mb, memory_used_mb, disk_free_gb}`, `TodoItem = {file, line, text}`.
- **Fix:** Used authoritative Rust shapes in body.ts interfaces (the Rust source is the source of truth per D-207). Kept `[k: string]: unknown` index signature on every interface so Plan 08-03's WorldModel route can widen safely if runtime data exposes extra fields.
- **Files modified:** src/lib/tauri/body.ts
- **Commit:** f4c3cea

**2. [Rule 1 — Bug] reproductive_spawn signature corrected.**
- **Found during:** Task 1 body.ts type authoring
- **Issue:** 08-PATTERNS.md §1 showed `reproductiveSpawn({agentType, initialTask?})`. Actual Rust signature at src-tauri/src/reproductive.rs:222 is `reproductive_spawn(agent_type: String, task: String, working_dir: Option<String>)` — `task` is required (not optional), and there's a third optional `working_dir` param.
- **Fix:** Wrapper takes `{agentType, task, workingDir?}`. Required `task` field enforced at type level; workingDir optional. Serializes as `agent_type` / `task` / `working_dir` at the invoke boundary.
- **Files modified:** src/lib/tauri/body.ts
- **Commit:** f4c3cea

**3. [Rule 1 — Bug] BloodPressure / ImmuneStatus / VitalSigns shapes corrected.**
- **Found during:** Task 1 body.ts type authoring
- **Issue:** 08-PATTERNS.md §1 showed `BloodPressure = {systolic, diastolic}`. Actual Rust struct at cardiovascular.rs:82 is `{events_per_minute, api_calls_per_minute, errors_per_minute, total_events, total_api_calls, hottest_channels}` — a data-flow health metric, not a literal medical blood pressure. Same for ImmuneStatus (actual: `{threats_last_hour, blocked_actions, status}`) and VitalSigns (actual: hormones + blood_pressure + immune + services_alive/dead + brain_working_memory_active).
- **Fix:** Used authoritative Rust shapes. `VitalSigns.hormones` typed as `unknown` to avoid a cross-cluster type dep in body.ts (callers narrow via `@/types/hormones` HormoneState).
- **Files modified:** src/lib/tauri/body.ts
- **Commit:** f4c3cea

None of these are blocking — the wrapper ABI is still the same
`invokeTyped` + snake_case payload; the TypeScript ergonomics now match the
real Rust shape rather than the pattern-file illustration.

### Plan's literal grep verification is advisory, not strict

The plan's Task 2 automated check — `test $(grep -c "invokeTyped" src/lib/tauri/hive.ts) -eq 10` — counts ALL "invokeTyped" occurrences including the `import` statement and a documentation comment on line 14/123, yielding 13 rather than 10. The actual number of wrapper function calls (`return invokeTyped`) is exactly 10, matching the spec. I did not rewrite hive.ts to strip the comment/import just to satisfy the literal grep — the SEMANTIC check (10 wrappers) is satisfied, which is what matters. Plan 08-02's verification `grep -c "invokeTyped"` pattern is imprecise; real verification is the `export function` count + tsc.

### Pre-existing ESLint configuration breakage (NOT caused by this plan)

Running `npm run lint` surfaces 192 parser errors of the form `Parsing error: Unexpected token interface` / `type` / `{` across the codebase (types/iot.ts, types/messages.ts, windows/main/router.ts, lib/tauri/chat.ts, etc.). This is a pre-existing ESLint TypeScript parser configuration issue that affects the entire tree, NOT something introduced by Plan 08-02. The plan's canonical verification is `npx tsc --noEmit` + `npm run verify:all` — both clean. The no-raw-tauri script (also clean) is the ESLint-adjacent gate that actually matters for wrapper discipline.

Logged for Phase 9 polish: pick up the TypeScript ESLint config fix alongside any broader lint hygiene pass.

## Cross-cluster import inventory (D-196 audit trail)

Plans 08-03 / 08-04 are EXPECTED to cross-import between clusters for commands
that live in a different cluster's wrapper:

- `@/lib/tauri/homeostasis` → BODY-03 HormoneBus (consumes all 4 homeostasis wrappers).
- `@/lib/tauri/admin` → BODY-02 BodySystemDetail (reads `supervisorGetHealth` for body-wide vitals; D-196 last bullet).
- `@/lib/tauri/admin` → HIVE-01 HiveMesh (reads `integrationGetState` to cross-reference tentacle vs. MCP-bridge liveness; D-196 last bullet).
- `@/lib/tauri/body` → HIVE-03 AutonomyControls (reads `organGetAutonomy`/`organSetAutonomy` for per-tentacle-per-action sliders; D-195 confirms per-tentacle autonomy lives in `organ.rs`, wrapped in body.ts).

All four cross-imports are allowed + intentional. They don't violate cluster
isolation — wrapper files are shared infrastructure; the prohibition is
against feature-folder-to-feature-folder imports.

## Requirements — Status

| ID      | Description                                                         | Plan 08-02 contribution                                                                       |
| ------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| BODY-01 | BodyMap — 12 body systems                                           | Route registered + placeholder mounts; wrappers `bodyGetMap/Summary` available.               |
| BODY-02 | BodySystemDetail + cardio/urinary/repro/joints drill-ins            | Route + placeholder; wrappers for all 10 underlying commands available.                       |
| BODY-03 | HormoneBus — 10 hormones + circadian                                | Route + placeholder; `homeostasisRelearnCircadian` (4th wrapper) shipped.                     |
| BODY-04 | OrganRegistry + autonomy controls                                   | Route + placeholder; 4 organ wrappers shipped.                                                |
| BODY-05 | DNA — identity/goals/patterns/query                                 | Route + placeholder; 4 dna wrappers shipped.                                                  |
| BODY-06 | WorldModel — git/processes/ports/etc                                | Route + placeholder; 3 world_model wrappers shipped.                                          |
| BODY-07 | Body cluster wrapper coverage                                       | **Satisfied by this plan** — body.ts wraps every cluster command + re-exports homeostasis.   |
| HIVE-01 | HiveMesh — 10 tentacles + autonomy                                  | Route + placeholder; `hiveGetStatus`, `hiveSetAutonomy` shipped.                              |
| HIVE-02 | TentacleDetail + reports/spawn                                      | Route + placeholder; `hiveGetReports`, `hiveSpawnTentacle` + body.ts `organGetAutonomy` avail.|
| HIVE-03 | AutonomyControls — per-tentacle sliders                             | Route + placeholder; body.ts `organSetAutonomy` + hive.ts `hiveSetAutonomy` avail.           |
| HIVE-04 | ApprovalQueue — approve/reject pending                              | Route + placeholder; `hiveApproveDecision` + Decision union avail.                            |
| HIVE-05 | Hive cluster wrapper coverage                                       | **Satisfied by this plan** — hive.ts wraps all 8 hive.rs commands + 2 ai_delegate.rs commands.|
| HIVE-06 | AiDelegate — introduce/check + event history                        | Route + placeholder; `aiDelegateCheck`, `aiDelegateIntroduce` shipped.                        |

All 13 Phase 8 requirements have their substrate wired through this plan.
Plans 08-03 / 08-04 ship the UI bodies; Plan 08-05 ships Playwright specs
asserting the data-testid roots.

## Next Steps

- **Plan 08-03** can run immediately — imports from `@/lib/tauri/body` + `@/lib/tauri/homeostasis` + `@/lib/tauri/admin` (for `supervisorGetHealth`); fills BodyMap.tsx, BodySystemDetail.tsx, HormoneBus.tsx, OrganRegistry.tsx, DNA.tsx, WorldModel.tsx. Zero file conflict with 08-04.
- **Plan 08-04** can run in parallel with 08-03 — imports from `@/lib/tauri/hive` + `@/lib/tauri/body` (for `organSetAutonomy`/`organGetAutonomy`) + `@/lib/tauri/admin` (for `integrationGetState`); fills HiveMesh.tsx, TentacleDetail.tsx, AutonomyControls.tsx, ApprovalQueue.tsx, AiDelegate.tsx. Zero file conflict with 08-03.
- **Plan 08-05** (wave 3, after 08-01..04) — Playwright specs asserting the 11 data-testid roots with mocked invokeTyped; `verify:phase8-rust` regression script; Mac operator checkpoint M-35..M-40.

## Self-Check: PASSED

- **src/lib/tauri/body.ts**: FOUND (443 lines; 22 wrappers verified by `grep -c "return invokeTyped"`)
- **src/lib/tauri/hive.ts**: FOUND (254 lines; 10 wrappers verified)
- **src/lib/tauri/homeostasis.ts**: FOUND (+15 lines; 4th wrapper `homeostasisRelearnCircadian` verified)
- **src/lib/tauri/index.ts**: FOUND (body + hive namespace exports + homeostasisRelearnCircadian named export)
- **src/features/body/index.tsx**: FOUND (6 lazy imports; route order preserved)
- **src/features/hive/index.tsx**: FOUND (5 lazy imports; route order preserved)
- **11 placeholder components**: all FOUND (grep confirmed each data-testid)
- **src/features/body/types.ts + src/features/hive/types.ts**: FOUND
- **src/features/body/body.css + src/features/hive/hive.css**: FOUND (@layer blocks confirmed)
- **Commits**:
  - `f4c3cea`: FOUND — `feat(08-02): add body.ts wrappers (~26 commands across 10 modules)`
  - `de71b91`: FOUND — `feat(08-02): add hive.ts wrappers (8 hive + 2 ai_delegate commands)`
  - `c587cea`: FOUND — `feat(08-02): rewrite body/hive index.tsx + seed 11 placeholders + types + CSS`
- **npx tsc --noEmit**: exit 0
- **npm run verify:all**: 13/13 green
- **Zero Rust changes**: verified — `git diff --name-only f4c3cea^..c587cea -- src-tauri/` returns nothing.
