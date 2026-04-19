---
phase: 07-dev-tools-admin
plan: 01
subsystem: events+prefs-type-surface
tags: [types, events, prefs, dev-tools, admin, phase-7]
dependency_graph:
  requires:
    - src/hooks/usePrefs.ts (Phase 6 D-165 Prefs interface)
    - src/lib/events/index.ts (Phase 6 Plan 06-01 BLADE_EVENTS)
    - src/lib/events/payloads.ts (Phase 6 Plan 06-01 payloads)
  provides:
    - "5 new Prefs dotted keys (D-192): devTools.activeTab, devTools.terminal.cwd, devTools.fileBrowser.expandedPaths, admin.activeTab, admin.security.expandedAlert"
    - "8 new BLADE_EVENTS constants after Rust audit: BROWSER_AGENT_STEP, BLADE_EVOLVING, BLADE_AUTO_UPGRADED, EVOLUTION_SUGGESTION, BLADE_LEVELED_UP, SERVICE_CRASHED, SERVICE_DEAD, WATCHER_ALERT"
    - "8 matching payload interfaces with [k: string]: unknown forward-compat"
  affects:
    - Plan 07-02 wrappers (can import new event constants for typed invoke/listen)
    - Plan 07-03..06 feature folders (can subscribe via useTauriEvent with typed payloads; persist UI state via usePrefs)
tech-stack:
  added: []
  patterns:
    - "D-192 Prefs extension recipe mirrored from Phase 5 D-133 + Phase 6 D-165"
    - "D-38-payload forward-compat index signature `[k: string]: unknown`"
    - "D-13 / D-38-hook — only useTauriEvent subscribes; constant values verbatim Rust emit strings"
key-files:
  created:
    - .planning/phases/07-dev-tools-admin/07-01-SUMMARY.md
  modified:
    - src/hooks/usePrefs.ts (+11 lines — 5 dotted keys)
    - src/lib/events/index.ts (+26 lines — 8 constants + audit comment)
    - src/lib/events/payloads.ts (+92 lines — 8 interfaces + banner)
decisions:
  - "Included BROWSER_AGENT_STEP (not the speculative BROWSER_AGENT_EVENT in Plan 07-04) — the real Rust emit is browser_agent_step at browser_agent.rs:268,284. Plan 07-04 should reference BROWSER_AGENT_STEP."
  - "Excluded workflow_run_started / workflow_run_completed — not emitted in Rust today. Plan 07-03 falls back to polling per its own `if constant exists` guard."
  - "Excluded integration_status_changed — not emitted in Rust. Plan 07-06 falls back to polling per its own guard."
  - "Excluded blade_workflow_notification (workflow_builder.rs:466) — fires from inside a workflow's `notify` step as a user toast, not a workflow-lifecycle signal. Duplicates blade_toast surface."
  - "Added 5 evolution/immune-system/supervisor/watcher lifecycle events even though plan only named two candidate areas — all 5 are scheduled background emits used by Admin cluster consumers (CapabilityReports, Diagnostics, SecurityDashboard) and fit the 'subscribe vs poll' heuristic."
metrics:
  duration_seconds: 298
  tasks_completed: 2
  files_changed: 3
  lines_added: 129
  completed_date: 2026-04-19
---

# Phase 7 Plan 07-01: Events + Prefs Type Surface — Summary

Pure TypeScript type plumbing that unblocks Phase 7 Waves 2-3. Extended `Prefs` with 5 dotted keys for Dev Tools + Admin UI state (D-192), audited every Phase 7-adjacent Rust module for `emit_to` / `emit_all` sites, and added 8 event constants + matching payload interfaces where consumers benefit from live subscription vs polling. Zero Rust changes, zero wrapper changes, zero feature-folder changes.

## Objective Delivered

- 5 `Prefs` dotted keys declared (guaranteed work per D-192).
- Rust emit audit performed across 11 modules: `workflow_builder`, `browser_agent`, `integration_bridge`, `security_monitor`, `decision_gate`, `evolution`, `immune_system`, `supervisor`, `watcher`, `reports`, `auto_fix`.
- 8 new `BLADE_EVENTS` constants added with exact Rust emit strings as values.
- 8 matching typed payload interfaces exported from `payloads.ts`.
- `npx tsc --noEmit`: clean.
- `npm run verify:all`: 12/12 green (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes, phase6-rust).

## Prefs Extension (Task 1)

Appended 5 dotted keys to `src/hooks/usePrefs.ts` under a `// ───── Phase 7 (Plan 07-01, D-192) ─────` section marker, placed immediately before the forward-compat index signature so typed keys take precedence:

| Key | Type | Consumer (Phase 7 plan) |
|-----|------|-------------------------|
| `devTools.activeTab` | `string?` | WorkflowBuilder / ComputerUse / DocumentGenerator tabs (Plan 07-03..04) |
| `devTools.terminal.cwd` | `string?` | Terminal cwd memory (Plan 07-03 DEV-01) |
| `devTools.fileBrowser.expandedPaths` | `string?` | FileBrowser expanded-folder set, newline-joined per D-12 (Plan 07-03 DEV-02) |
| `admin.activeTab` | `string?` | SecurityDashboard / Diagnostics / CapabilityReports tabs (Plan 07-05..06) |
| `admin.security.expandedAlert` | `string?` | SecurityDashboard deep-link expand (Plan 07-05 ADMIN-05) |

All 5 are optional — absent value means default behavior, no `getDefaultPrefs()` mutation needed. All 5 flow through `setPref` / `usePrefs` under the existing `blade_prefs_v1` single-blob localStorage key (D-42 debounce 250ms preserved).

## Rust Emit Audit (Task 2)

### Audit table — every module grep'd (`rg 'emit_all|emit_to|\.emit\(' <module>.rs`)

| Module | Emits Found (event + line) | Nature | Decision |
|--------|---------------------------|--------|----------|
| `workflow_builder.rs` | `blade_workflow_notification` @466 | Fires from the `notify` node INSIDE a running workflow — user-facing toast, not lifecycle | **REJECT** — duplicates `blade_toast` surface; WorkflowBuilder polls `workflow_list()` after `workflow_run_now` awaits |
| `browser_agent.rs` | `browser_agent_step` @268,284 | Streaming per-step during `browser_agent_loop` | **ACCEPT** — bursty long-running loop; DEV-06 WebAutomation benefits from live trace |
| `integration_bridge.rs` | *(none)* | No emit sites | N/A — Plan 07-06 IntegrationStatus polls on focus + after manual "refresh" click |
| `security_monitor.rs` | *(none)* | No emit sites; `security_overview` is request-response | N/A — Plan 07-05 SecurityDashboard polls on route-focus |
| `decision_gate.rs` | *(none)* | No emit sites; `decision_gate_eval` is pure function | N/A — Plan 07-05 DecisionLog paginates via query |
| `evolution.rs` | `blade_auto_upgraded` @792, `evolution_suggestion` @800,945, `blade_leveled_up` @812 | Scheduled evolution-loop (15-min tick) background emits | **ACCEPT all 3** — scheduled background; CapabilityReports (ADMIN-02) benefits from live feed |
| `immune_system.rs` | `blade_evolving` @31,45,78,85,97 | Multi-step capability-resolution status ticker (searching → installing/forging → forged/failed) | **ACCEPT** — async status stream; CapabilityReports/chat status pill benefits |
| `reports.rs` | `capability_gap_detected` @278 | Emitted inside `report_capability_gap` command | **ALREADY PRESENT** in BLADE_EVENTS line 59 since Phase 1 — no-op |
| `supervisor.rs` | `service_crashed` @144, `service_dead` @156 | Background watchdog; scheduled | **ACCEPT both** — Diagnostics (ADMIN-07) + SecurityDashboard want live status; polling misses transient crashes |
| `watcher.rs` | `watcher_alert` @212 | Background URL-watcher change detection | **ACCEPT** — autonomous monitoring; SecurityDashboard/Reports feed |
| `auto_fix.rs` | `auto_fix_verifying/analyzing/editing/pushing/monitoring/complete/failed` @430..937 | Streaming stages of an ACTIVE user-initiated auto-fix | **REJECT** (out of Phase 7 scope) — DEV-03 GitPanel doesn't consume auto-fix stream; if Phase 8 or 9 surfaces need it, add there |

### Speculative names in Phase 7 downstream plans — reconciled

| Plan-referenced name | Reality (Rust) | Action |
|----------------------|---------------|--------|
| `WORKFLOW_RUN_STARTED` (Plan 07-03:280) | Does NOT exist in Rust | **Not added.** Plan 07-03's `if constant exists` guard triggers poll fallback. |
| `WORKFLOW_RUN_COMPLETED` (Plan 07-03:280) | Does NOT exist in Rust | **Not added.** Plan 07-03's `if constant exists` guard triggers poll fallback. |
| `INTEGRATION_STATUS_CHANGED` (Plan 07-06:291) | Does NOT exist in Rust | **Not added.** Plan 07-06's `if constant exists` guard triggers poll fallback. |
| `BROWSER_AGENT_EVENT` (Plan 07-04:25,157) | Real emit is `browser_agent_step` | **Added as `BROWSER_AGENT_STEP`.** Plan 07-04 should reference `BLADE_EVENTS.BROWSER_AGENT_STEP` (drift note logged below). |
| `DECISION_GATE_EVENT` (Plan 07-01 candidate list) | Does NOT exist in Rust | **Not added.** DecisionLog paginates via query. |
| `SECURITY_ALERT` (Plan 07-01 candidate list) | Does NOT exist in Rust | **Not added.** SecurityDashboard polls. |

### Final tally

- **8 constants added** to `BLADE_EVENTS`:
  - `BROWSER_AGENT_STEP: 'browser_agent_step'`
  - `BLADE_EVOLVING: 'blade_evolving'`
  - `BLADE_AUTO_UPGRADED: 'blade_auto_upgraded'`
  - `EVOLUTION_SUGGESTION: 'evolution_suggestion'`
  - `BLADE_LEVELED_UP: 'blade_leveled_up'`
  - `SERVICE_CRASHED: 'service_crashed'`
  - `SERVICE_DEAD: 'service_dead'`
  - `WATCHER_ALERT: 'watcher_alert'`
- **8 payload interfaces added** to `payloads.ts`: `BrowserAgentStepPayload`, `BladeEvolvingPayload`, `BladeAutoUpgradedPayload`, `EvolutionSuggestionPayload`, `BladeLeveledUpPayload`, `ServiceCrashedPayload`, `ServiceDeadPayload`, `WatcherAlertPayload`. Each carries `[k: string]: unknown` forward-compat per D-38-payload.

## Drift Concerns Found While Reading Existing Types

1. **`CapabilityGapPayload` drift** — payloads.ts line 131 declares `{ user_request: string }`, but the actual Rust emit at `reports.rs:278` is `{ id, category, title, severity }`. This is a **pre-existing** drift from a prior plan (likely Phase 1 Plan 01-06 candidate list). Not fixed in this plan because:
   - 07-01 scope is "add, don't edit" for existing events.
   - Touching it would block Wave 1 on a code-review back-and-forth.
   - Logged here for Plan 07-05 CapabilityReports to reconcile when it adds its subscribe site.

2. **Plan 07-04's speculative `BROWSER_AGENT_EVENT` name** — the plan will need a 1-line edit to reference `BROWSER_AGENT_STEP` instead. Logged as guidance for 07-04 executor (not a deviation from 07-01's own brief).

3. **`workflow_run_started` / `workflow_run_completed` / `integration_status_changed` / `decision_gate_event`** are still consumed speculatively in 07-03/07-06. Those plans already have `if constant exists` guards, so they degrade gracefully to polling. No action required.

## Deviations from Plan

**None materially.** Plan 07-01 allowed a 0-N range of event additions after audit (per `<done>` block line 269: "Either (a) 0-N new event constants added ... OR (b) no additions made"). I landed at N=8, which is within the planned envelope. The plan's illustrative candidate list (workflow_run_*, integration_status_changed, etc.) was explicitly marked speculative ("only if grep confirms"); the audit disconfirmed those and confirmed 8 others worth wiring.

Auto-fixes applied: **none**. Pure type additions, no bugs surfaced.

## Confirmation of Scope Boundaries

- **Zero Rust changes** — verified via `git diff HEAD~2 HEAD -- src-tauri` (no output).
- **Zero wrapper changes** — 07-02 owns `src/lib/tauri/dev_tools.ts` + `admin.ts`; untouched by this plan.
- **Zero feature-folder changes** — 07-03..06 own `src/features/dev-tools/*` + `src/features/admin/*`; untouched.
- **Zero CSS changes** — 07-03..06 own `dev-tools.css` + `admin.css`; do not exist yet and not created here.

## Verification Evidence

```
$ grep -c "devTools.activeTab\|devTools.terminal.cwd\|devTools.fileBrowser.expandedPaths\|admin.activeTab\|admin.security.expandedAlert" src/hooks/usePrefs.ts
5

$ npx tsc --noEmit
(no output — exit 0)

$ npm run verify:all
[verify-entries] OK — 5 entries present on disk
[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths
[verify-migration-ledger] OK — 13 referenced ids all tracked (of 89 ledger rows)
[verify-emit-policy] OK — all 59 broadcast emits match cross-window allowlist
[audit-contrast] OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline
[verify-chat-rgba] OK — no backdrop-filter property in src/features/chat (D-70 preserved)
[verify-ghost-no-cursor] OK — no cursor property in src/features/ghost/** or src/windows/ghost/** (D-09 preserved).
[verify-orb-rgba] OK — no backdrop-filter on orb visual surfaces (D-07/D-18/SC-2 preserved).
[verify-hud-chip-count] OK — `hud-chip hud-*` className count is exactly 4 (HUD-02 preserved).
[verify-phase5-rust-surface] OK — all 75 Phase 5 Rust commands registered in src-tauri/src/lib.rs.
[verify-feature-cluster-routes] OK — all 34 Phase 5+6 routes present; clusters wired via lazy imports.
[verify-phase6-rust-surface] OK — all 157 Phase 6 Rust commands registered in src-tauri/src/lib.rs.
```

12/12 verify:all scripts green.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1    | `a94f944` | `feat(07-01): extend Prefs with 5 Phase 7 dotted keys (D-192)` |
| 2    | `93d3f22` | `feat(07-01): add 8 Phase 7 event constants + payloads after Rust emit audit` |

## Success Criteria

- [x] 5 new Prefs dotted keys declared
- [x] 8 new event constants in BLADE_EVENTS with exact Rust emit strings as values
- [x] 8 new typed payload interfaces exported from payloads.ts
- [x] Zero runtime behavior change (pure type additions)
- [x] Zero Rust file edits
- [x] `npx tsc --noEmit` passes
- [x] `npm run verify:all` passes (12/12)
- [x] Plans 07-02 + 07-03..06 can consume these types without touching 07-01 files

## Self-Check: PASSED

- `src/hooks/usePrefs.ts` modified — verified via `git show 07-01 -- src/hooks/usePrefs.ts` shows 5 new keys.
- `src/lib/events/index.ts` modified — 8 new constants under `Phase 7` section marker.
- `src/lib/events/payloads.ts` modified — 8 new interfaces under `Phase 7 Plan 07-01 additions` banner.
- Commit `a94f944` (Task 1): present in `git log --oneline`.
- Commit `93d3f22` (Task 2): present in `git log --oneline`.
- Summary file: `.planning/phases/07-dev-tools-admin/07-01-SUMMARY.md` (this file) created.
