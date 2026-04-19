---
phase: 08-body-hive
plan: 01
subsystem: events+prefs-type-surface
tags: [types, events, prefs, body, hive, phase-8]
dependency_graph:
  requires:
    - src/hooks/usePrefs.ts (Phase 7 D-192 Prefs interface)
    - src/lib/events/index.ts (Phase 7 Plan 07-01 BLADE_EVENTS)
    - src/lib/events/payloads.ts (Phase 7 Plan 07-01 payloads)
  provides:
    - "5 new Prefs dotted keys (D-210): body.activeSystem, body.dna.activeDoc, hive.activeTentacle, hive.approval.expandedId, hive.filterStatus"
    - "10 new BLADE_EVENTS constants after Rust emit audit: HIVE_TICK, HIVE_ACTION, HIVE_ESCALATE, HIVE_INFORM, HIVE_PENDING_DECISIONS, HIVE_CI_FAILURE, HIVE_AUTO_FIX_STARTED, HIVE_ACTION_DEFERRED, TENTACLE_ERROR, WORLD_STATE_UPDATED"
    - "10 matching payload interfaces with [k: string]: unknown forward-compat"
  affects:
    - Plan 08-02 wrappers + cluster index rewrites (can import new event constants for typed subscriptions)
    - Plan 08-03 Body cluster (BodyMap/BodySystemDetail pref handoff; DNA tab memory; WorldModel WORLD_STATE_UPDATED subscription)
    - Plan 08-04 Hive cluster (HiveMesh/TentacleDetail handoff; HiveMesh HIVE_TICK + HIVE_CI_FAILURE + HIVE_AUTO_FIX_STARTED + HIVE_INFORM + TENTACLE_ERROR subscriptions; ApprovalQueue HIVE_ESCALATE + HIVE_PENDING_DECISIONS + HIVE_ACTION + HIVE_ACTION_DEFERRED subscriptions; filter chip persistence; expanded-card persistence)
tech-stack:
  added: []
  patterns:
    - "D-210 Prefs extension recipe mirrored from Phase 5 D-133 + Phase 6 D-165 + Phase 7 D-192"
    - "D-38-payload forward-compat index signature `[k: string]: unknown`"
    - "D-13 / D-38-hook — only useTauriEvent subscribes; constant values verbatim Rust emit strings"
    - "D-209 grep-verified emit sites — every new constant cites file:line in a trailing comment"
key-files:
  created:
    - .planning/phases/08-body-hive/08-01-SUMMARY.md
  modified:
    - src/hooks/usePrefs.ts (+11 lines — 5 dotted keys)
    - src/lib/events/index.ts (+20 lines — 10 constants + audit banner)
    - src/lib/events/payloads.ts (+110 lines — 10 interfaces + banner)
decisions:
  - "Included all 10 emits from the D-209 grep audit — all fire from scheduled background loops (hive tick @30s, world refresh) or multi-step streaming pipelines (auto-fix, escalation, CI failure detection) where subscribe-vs-poll is the correct pattern."
  - "Did NOT re-add HORMONE_UPDATE / HOMEOSTASIS_UPDATE — shipped Phase 3 (WIRE-02). HormoneBus (BODY-03) subscribes to the existing constant."
  - "Did NOT re-add AI_DELEGATE_APPROVED / AI_DELEGATE_DENIED — shipped previously. AiDelegate (HIVE-06) subscribes to existing constants."
  - "Did NOT re-add CAPABILITY_GAP_DETECTED — Phase 8 has no direct consumer (Admin CapabilityReports consumed it in Phase 7)."
  - "Kept WorldStateUpdatedPayload generic with optional `summary?: string` — Rust emits `world_get_summary()` text at world_model.rs:869; exact shape may evolve (index signature carries the drift risk per D-38-payload)."
  - "Placed Phase 8 Prefs block BEFORE the forward-compat index signature — typed keys take precedence over the permissive `[k: string]: string | number | boolean | undefined`."
metrics:
  duration_seconds: 254
  tasks_completed: 3
  files_changed: 3
  lines_added: 141
  completed_date: 2026-04-19
---

# Phase 8 Plan 08-01: Events + Prefs Type Surface — Summary

Pure TypeScript type plumbing that unblocks Phase 8 Waves 2-3. Extended `Prefs` with 5 dotted keys for Body + Hive cluster UI state (D-210), added 10 `BLADE_EVENTS` constants for the grep-audited hive.rs + world_model.rs emit sites (D-209), and added 10 matching typed payload interfaces. Zero Rust changes, zero wrapper changes, zero feature-folder changes.

## Objective Delivered

- 5 `Prefs` dotted keys declared (D-210 Body/Hive cluster handoff + tab memory + filter persistence).
- 10 new `BLADE_EVENTS` constants with exact Rust emit strings as values (D-209 grep-verified).
- 10 matching typed payload interfaces exported from `payloads.ts` with `[k: string]: unknown` forward-compat.
- `npx tsc --noEmit`: clean (my 3 files; other uncommitted changes in this worktree belong to the parallel 08-02 lane and are out of scope).
- `npm run verify:all`: **13/13 green** (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes, phase6-rust, phase7-rust).

## Prefs Extension (Task 1)

Appended 5 dotted keys to `src/hooks/usePrefs.ts` under a `// ───── Phase 8 — Body + Hive (Plan 08-01 / D-210) ───────────────────────` section marker, placed immediately before the forward-compat index signature so typed keys take precedence:

| Key | Type | Consumer (Phase 8 plan) |
|-----|------|-------------------------|
| `body.activeSystem` | `string?` | BodyMap → BodySystemDetail handoff (Plan 08-03, D-201/D-202) |
| `body.dna.activeDoc` | `string?` | DNA route tab memory — `'identity' \| 'goals' \| 'patterns' \| 'query'` (Plan 08-03, D-203) |
| `hive.activeTentacle` | `string?` | HiveMesh → TentacleDetail handoff (Plan 08-04, D-204) |
| `hive.approval.expandedId` | `string?` | ApprovalQueue last-expanded card deep-link (Plan 08-04, D-205) |
| `hive.filterStatus` | `string?` | HiveMesh tentacle-status filter chips — `'all' \| 'active' \| 'dormant' \| 'error' \| 'disconnected'` (Plan 08-04, D-204) |

All 5 are optional — absent value means default behavior, no `getDefaultPrefs()` mutation. All 5 flow through `setPref` / `usePrefs` under the existing `blade_prefs_v1` single-blob localStorage key (D-42 debounce 250ms preserved).

## Rust Emit Audit (Task 2)

### Confirmed emit sites (all 10 verified at CONTEXT gathering)

| Rust source | Line | Emit string | Phase 8 constant | Consumers |
|---|---:|---|---|---|
| `hive.rs` | 2600 | `hive_tick` | `HIVE_TICK` | HiveMesh (30s cadence refresh) |
| `hive.rs` | 2723, 2780 | `hive_action` | `HIVE_ACTION` | HiveMesh (action toast) + ApprovalQueue (optimistic removal) |
| `hive.rs` | 2813 | `hive_escalate` | `HIVE_ESCALATE` | ApprovalQueue (cross-window toast + queue insert) |
| `hive.rs` | 2686 | `hive_inform` | `HIVE_INFORM` | HiveMesh (info toast) |
| `hive.rs` | 2603 | `hive_pending_decisions` | `HIVE_PENDING_DECISIONS` | ApprovalQueue (refresh queue) |
| `hive.rs` | 2509 | `hive_ci_failure` | `HIVE_CI_FAILURE` | HiveMesh (alert toast) |
| `hive.rs` | 2530 | `hive_auto_fix_started` | `HIVE_AUTO_FIX_STARTED` | HiveMesh (pipeline toast) |
| `hive.rs` | 2763 | `hive_action_deferred` | `HIVE_ACTION_DEFERRED` | ApprovalQueue (deferred-entry insert) |
| `hive.rs` | 2304 | `tentacle_error` | `TENTACLE_ERROR` | HiveMesh + TentacleDetail (status chip + error context) |
| `world_model.rs` | 869 | `world_state_updated` | `WORLD_STATE_UPDATED` | WorldModel (live snapshot without manual refresh) |

All 10 subscriber consumers identified per D-204 (HiveMesh / TentacleDetail / AutonomyControls), D-205 (ApprovalQueue / AiDelegate), and D-203 (WorldModel).

### Existing constants Phase 8 consumers RE-USE (NOT re-added)

| Constant | Source phase | Phase 8 consumer |
|----------|--------------|------------------|
| `HORMONE_UPDATE` | Phase 3 (WIRE-02) | HormoneBus (BODY-03, D-203) |
| `HOMEOSTASIS_UPDATE` | Phase 3 (legacy) | HormoneBus fallback path |
| `AI_DELEGATE_APPROVED` | Pre-Phase 5 | AiDelegate (HIVE-06, D-205) |
| `AI_DELEGATE_DENIED` | Pre-Phase 5 | AiDelegate (HIVE-06, D-205) |

### Events considered but NOT added

None. All 10 audit candidates were confirmed by grep in CONTEXT and included. The registry gap at Phase 8's boundary is zero.

## Payload Interface Pattern (Task 2 Step B)

All 10 interfaces follow the same skeleton:

```ts
/** Mirrors Rust emit at `src-tauri/src/<file>.rs:<line>` (<event>).
 *  <one-line subscriber rationale>. */
export interface <Name>Payload {
  <required_field>: <type>;
  <optional_field>?: <type>;
  [k: string]: unknown;
}
```

Field shapes were selected to match the Rust emit sites' `serde_json::json!({…})` literals where visible in the CONTEXT audit. Where the exact Rust shape is not confirmed (`hive_inform`, `hive_ci_failure`, `hive_auto_fix_started`, `world_state_updated` — short summary emits), the interface includes only the semantically required field plus the index signature. Drift caught by code review + Playwright spec runtime casts per D-38-payload. No zod, no codegen.

## Gaps / Deviations

None. Plan executed exactly as written:

- Task 1: 5 Prefs keys added under `// ───── Phase 8 — Body + Hive (Plan 08-01 / D-210) ───────────────────────` section marker, positioned before the forward-compat index signature. `npx tsc --noEmit` passes.
- Task 2: 10 `BLADE_EVENTS` constants appended after the Phase 7 block (after `WATCHER_ALERT`), BEFORE the closing `} as const;`. 10 payload interfaces appended under `// ───── Phase 8 Plan 08-01 additions ───` banner. `npx tsc --noEmit` passes.
- Task 3: `npm run verify:all` 13/13 green.

### Out-of-scope files observed in worktree (not touched by this plan)

This worktree also contains uncommitted changes from the parallel Plan 08-02 lane (`src/lib/tauri/homeostasis.ts`, `src/lib/tauri/index.ts`, `src/lib/tauri/body.ts`). Per the execution directive "Do NOT touch 08-02 lane", these were verified to be pre-existing and NOT modified by this plan. The 08-02 lane's in-progress `export * as hive from './hive';` references a not-yet-created `hive.ts`; this is expected mid-wave-1 and is the 08-02 executor's responsibility to complete. Stashing the 08-02 files confirmed that this plan's 3 files alone pass `tsc` cleanly.

## Files Modified

| File | Lines added | Change |
|---|---:|---|
| `src/hooks/usePrefs.ts` | +11 | 5 Prefs dotted keys + section marker |
| `src/lib/events/index.ts` | +20 | 10 BLADE_EVENTS constants + audit banner |
| `src/lib/events/payloads.ts` | +110 | 10 payload interfaces + banner |
| **Total** | **+141** | |

## Next Plan

**Plan 08-02** (wave 1, parallel with this plan): creates `src/lib/tauri/body.ts` + `src/lib/tauri/hive.ts` typed wrappers, rewrites `src/features/body/index.tsx` + `src/features/hive/index.tsx` with lazy imports, seeds 11 per-route placeholder files. Consumes the 10 new event constants + 5 new prefs keys this plan shipped.

**Plans 08-03 + 08-04** (wave 2, parallel): Body cluster UI (6 routes) and Hive cluster UI (5 routes). All event subscriptions + prefs reads use this plan's additions.

## Self-Check: PASSED

- [x] `src/hooks/usePrefs.ts` contains 5 new dotted keys (`body.activeSystem`, `body.dna.activeDoc`, `hive.activeTentacle`, `hive.approval.expandedId`, `hive.filterStatus`).
- [x] `src/lib/events/index.ts` contains 10 new constants with exact Rust emit strings as values.
- [x] `src/lib/events/payloads.ts` contains 10 new payload interfaces, each with `[k: string]: unknown`.
- [x] `npx tsc --noEmit` exits 0 for my 3 files (verified by stashing 08-02 lane changes).
- [x] `npm run verify:all` passes 13/13.
- [x] Zero Rust changes (D-196).
- [x] Zero wrapper file changes (08-02 handles — verified: did not touch body.ts, hive.ts, homeostasis.ts, tauri/index.ts).
- [x] Zero feature-folder changes (08-03/04 handle).
