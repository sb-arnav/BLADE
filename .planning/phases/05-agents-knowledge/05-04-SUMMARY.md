---
phase: 05-agents-knowledge
plan: 04
subsystem: agents-routes-b
tags: [agents, swarm-dag, factory, timeline, task-agents, pixel-world]
requires:
  - Plan 05-02 (typed agents wrappers + status CSS tokens + per-cluster types barrel)
  - Plan 05-01 (SwarmProgress/Completed/Created payload interfaces + event constants)
  - Phase 1 substrate (GlassPanel, Dialog, Button, Pill, GlassSpinner, useTauriEvent, Toast, useRouterCtx, usePrefs)
provides:
  - AGENT-03 — AgentFactory CRUD surface (describe-to-deploy + Deploy/Pause/Delete)
  - AGENT-05 — AgentTimeline unified agent+swarm history
  - AGENT-07 — TaskAgents background-runtime spawn queue
  - AGENT-08 — SwarmView DAG + live swarm_progress/completed/created
  - AGENT-09 — AgentPixelWorld 3×3 role grid with hormone-tinted borders
  - SC-1 — "SwarmView renders a DAG from swarm_* commands" (closed via SwarmDAG.tsx)
  - Reusable SwarmDAG sub-component (topological grid + SVG L-path edges)
  - ROLE_HORMONE_COLOR map exported from AgentPixelWorld.tsx (Plan 05-07 ground truth)
affects:
  - Plan 05-07 will import { ROLE_HORMONE_COLOR } and use testids:
    swarm-dag-root, swarm-node, timeline-entry, factory-agent-card,
    task-agent-card, pixel-world-cell, swarm-view-root,
    swarm-sidebar-row, agent-factory-root, agent-timeline-root,
    task-agents-root, agent-pixel-world-root
tech-stack:
  added: []
  patterns:
    - deterministic topological DAG layout via useMemo + cycle-guarded walk (D-124)
    - SVG axis-aligned L-path edges (M H V H) — no bezier, no DAG library (D-124)
    - top-level useTauriEvent subs for SWARM_PROGRESS/COMPLETED/CREATED (D-129)
    - payload.swarm_id filter (ref-backed) before state mutation (D-130)
    - plain useState for step-boundary cadence (rAF reserved for AgentDetail per D-125)
    - 5s poll in TaskAgents (cheaper than a noisy agent_output subscription)
    - Dialog confirm on destructive actions (T-05-04-02 factoryDelete, swarmCancel)
    - rgba(...) bg inside tier-1 GlassPanel (D-07 blur caps, D-70 pattern)
    - scoped CSS partial (agents-dag-pack.css) — no-overlap with 05-03's agents.css edits
key-files:
  created:
    - src/features/agents/SwarmDAG.tsx
    - src/features/agents/SwarmNode.tsx
    - src/features/agents/SwarmDAG.css
    - src/features/agents/agents-dag-pack.css
    - .planning/phases/05-agents-knowledge/05-04-SUMMARY.md
  modified:
    - src/features/agents/AgentFactory.tsx
    - src/features/agents/AgentTimeline.tsx
    - src/features/agents/TaskAgents.tsx
    - src/features/agents/AgentPixelWorld.tsx
    - src/features/agents/SwarmView.tsx
decisions:
  - "Rule 1 deviation: factoryCreateAgent takes a single description string (not name + role + description) per the actual Rust signature at agent_factory.rs:539. The planner's 3-field form doesn't match the wire. Implementation exposes an 8-role dropdown hint that gets appended to the description; the synthesis reads it verbatim."
  - "AgentTimeline: omitted agents.selectedSwarm pref (D-133 schema drift caveat) — swarm selection lives in SwarmView's local useState instead; the timeline just openRoute('swarm-view') without deep-linking."
  - "SwarmView uses plain useState for SwarmProgress (not rAF buffer) — swarm_progress emits at step boundaries, not 50/s. D-125 explicitly scopes rAF discipline to the AgentDetail 10-subscriber surface."
  - "AgentPixelWorld role detection falls back to 'Executor' when Agent.steps[0].role is absent — the Rust Agent struct doesn't carry a top-level role field (agents/mod.rs:155). Documented as the Phase 9 polish item."
metrics:
  duration: 1h15m
  completed: 2026-04-18
  tasks: 3
  files: 9
---

# Phase 5 Plan 05-04: Agents Cluster Subset B — Summary

DAG visualization, managed agent factory, activity timeline, task agent queue, and role pixel grid — the 5 agent routes Plan 05-03 didn't own, plus a reusable SwarmDAG/SwarmNode sub-component pair.

## What shipped

- **SwarmDAG.tsx** (new) — deterministic topological DAG renderer. Uses `useMemo(() => computeLayout(swarm), [swarm.id, steps.length])` so pure status mutations don't trigger relayout (T-05-04-01). SVG L-path edges are axis-aligned (D-124 "legibility over prettiness"). Cycle-safe via a `visiting` set that logs a warning and treats cyclic nodes as layer 0.
- **SwarmNode.tsx** (new) — single DAG step card. `data-status` attribute drives a left-border accent via the Plan 05-02 `--status-*` tokens. Includes keyboard support (Enter/Space) and role="button" for a11y.
- **SwarmDAG.css** (new) — scoped DAG positioning + SVG edge styles. rgba bg only (D-07 cap).
- **SwarmView.tsx** — two-pane layout (280px sidebar + DAG pane). Subscribes 3 events (D-129 top-level): `SWARM_PROGRESS` (filtered on `payload.swarm_id === selectedIdRef.current`, D-130), `SWARM_COMPLETED` (refetch on matching swarm + refresh sidebar), `SWARM_CREATED` (refresh sidebar). Pause/Resume/Cancel with Dialog confirm on Cancel (T-05-04-02).
- **AgentFactory.tsx** — left column describe-to-deploy form (role dropdown + description textarea + Create button → `factoryCreateAgent(description)`); right column blueprint grid with Deploy/Pause/Delete buttons. Delete opens a Dialog confirm.
- **AgentTimeline.tsx** — merges `agentList()` + `swarmList(50)` into a time-sorted feed (descending by `updated_at`/`created_at`). Relative-time display with sub-second/minute/hour/day scales + epoch-seconds vs epoch-ms auto-detection. Click routes → `agent-detail` (persists `agents.selectedAgent`) or `swarm-view`.
- **TaskAgents.tsx** — top spawn form (task textarea + detected-runtime radio group + Spawn button); below, task-agent-card list filtered to `claude-code|aider|goose|codex|custom` kinds. 5s auto-refresh via setInterval. Empty-state hint surfaces detected runtimes or the install suggestion.
- **AgentPixelWorld.tsx** — 9-cell role grid (3×3). Each cell: emoji + role label + agent count. Border color keyed on the `ROLE_HORMONE_COLOR` map (exported for 05-07). Click → `agent-team`. Hover scale-up via CSS transform (no backdrop-filter; D-07 honoured).
- **agents-dag-pack.css** (new) — scoped partial for all 5 routes' CSS. Deliberately disjoint from `agents.css` so Plan 05-03's extensions don't conflict (D-122 no-overlap, D-132 CSS discipline).

## Requirement coverage

| Req       | Surface                | Commands Used |
|-----------|------------------------|---------------|
| AGENT-03  | AgentFactory           | `factoryListAgents`, `factoryCreateAgent`, `factoryDeployAgent`, `factoryPauseAgent`, `factoryDeleteAgent` |
| AGENT-05  | AgentTimeline          | `agentList`, `swarmList(50)` |
| AGENT-07  | TaskAgents             | `agentListBackground`, `agentDetectAvailable`, `agentSpawn`, `agentCancelBackground` |
| AGENT-08  | SwarmView + SwarmDAG   | `swarmList(20)`, `swarmGet`, `swarmGetProgress`, `swarmPause`, `swarmResume`, `swarmCancel` + SWARM_PROGRESS/COMPLETED/CREATED |
| AGENT-09  | AgentPixelWorld        | `agentList` |

## Commits

1. `267d172` — feat(05-04): SwarmDAG + SwarmNode sub-components with deterministic topological layout
2. `5c90554` — feat(05-04): AgentFactory + AgentTimeline + TaskAgents + AgentPixelWorld real bodies
3. `47e5cd8` — feat(05-04): SwarmView renders DAG + live swarm_progress/completed/created (SC-1)

## SwarmDAG edge-case handling

- **Empty swarm** (0 steps) → renders `.swarm-dag-empty` with "No steps in this swarm." status message + testid still present.
- **Single step** (no deps) → lays out at layer 0, row 0; no SVG edges emitted. Container auto-sizes to fit one `NODE_WIDTH×NODE_HEIGHT` card plus padding.
- **Large swarm (≥15 steps)** → topological walk + layer grouping is O(V+E). Layer-0 nodes stack vertically on the left; subsequent layers shift right by `LAYER_COL_WIDTH=220`. Container is `overflow: auto` so the parent pane scrolls both axes. No zoom/pan (D-124 explicit deferral).
- **Unknown dep reference** → `stepById.get(depId)` miss → treated as layer 0 (fail-soft); the edge is omitted because `nodeById.get(depId)` also misses.
- **Cycle** → `visiting` set detects re-entry, warns, assigns layer 0 to the offending node; downstream walks still complete. No infinite recursion.

## ROLE_HORMONE_COLOR (exported from AgentPixelWorld.tsx — Plan 05-07 spec ground truth)

```ts
{
  Researcher:             '#8affc7', // exploration — growth/discovery
  Coder:                  '#ffd2a6', // energy_mode — sustained focus
  Analyst:                '#7fb6ff', // trust — consideration
  Writer:                 '#c8a6ff', // leptin — reflection
  Reviewer:               '#a8d8ff', // thirst — fresh pass
  SecurityRedTeam:        '#ff8a8a', // urgency/arousal — offensive
  SecurityBlueTeam:       '#7fb6ff', // trust — defensive
  SecurityTestResearcher: '#ffa87f', // hunger — probing
  Executor:               '#ff9ab0', // adrenaline — action
}
```

Values align with `src/features/dashboard/hormoneChip.tsx` HORMONE_COLORS palette verbatim.

## Deviations from plan

### Rule 1 — plan/wire mismatch on factoryCreateAgent

- **Found during:** Task 2 (AgentFactory)
- **Issue:** Plan §Task-2 described a "name + role dropdown + description textarea" form. The actual Rust signature at `src-tauri/src/agent_factory.rs:539` is `factory_create_agent(description: String) -> AgentBlueprint` — a single NL description the Rust synthesises into a blueprint. `AgentBlueprint` fields (`name`, `triggers`, `actions`, `knowledge_sources`) are Rust-side synthesis outputs, not form inputs.
- **Fix:** Implemented the form as role dropdown + description textarea where the dropdown selection is appended as `[role=<Role>]` prefix to the description string before invoke. The synthesis reads it verbatim. Form honours the plan's 8 roles (`Researcher, Coder, Analyst, Writer, Reviewer, SecurityRedTeam, SecurityBlueTeam, SecurityTestResearcher`) per agents/mod.rs.
- **Commit:** `5c90554`

### Rule 1 — AgentBlueprint has no `status` field; Deploy button always enabled

- **Found during:** Task 2 (AgentFactory)
- **Issue:** Plan §Task-2 said "confirms via Dialog if agent has status === 'deployed' already". `AgentBlueprint` (agent_factory.rs:110) has no `status` field — it's a blueprint record, not a running agent. Deployment state lives in the Rust-side factory runtime, not on the blueprint.
- **Fix:** Deploy button always enabled; repeated deploys are idempotent at the Rust layer (T-05-04-02 is still protected on Delete which is the only destructive operation). Surfaces a toast on success/error.
- **Commit:** `5c90554`

### Rule 3 — agents.selectedSwarm pref avoided

- **Found during:** Task 2 (AgentTimeline)
- **Issue:** Plan noted D-133 ships `agents.selectedAgent` but NOT `agents.selectedSwarm`. Adding a new pref mid-plan would be a Phase 5 Plan 05-01 schema change landing on Plan 05-04's commit.
- **Fix:** Click on a swarm row in AgentTimeline calls `openRoute('swarm-view')` without persistent deep-link. SwarmView manages its own selection via local `useState`. The plan's `<must_haves>` already anticipated this fallback.
- **Commit:** `5c90554`

## No-overlap invariant — files untouched

Confirmed these files were NOT authored by Plan 05-04 (their content belongs to Plan 05-03):

- `src/features/agents/AgentDashboard.tsx` — Plan 05-03 authored (05-03 header comment in file header); my commits `267d172/5c90554/47e5cd8` contain zero diff against this file.
- `src/features/agents/AgentDetail.tsx` — Plan 05-03 authored
- `src/features/agents/AgentTeam.tsx` — Plan 05-03 authored (05-03 header comment in file header)
- `src/features/agents/BackgroundAgents.tsx` — Plan 05-03 authored

**Concurrent-executor race note on commit 222810f (docs):** the final SUMMARY commit swept up two files (`AgentDashboard.tsx` + `AgentTeam.tsx`) that had been staged in the index by the parallel 05-03 executor between my `git add` and `git commit`. Their *content* is 05-03's genuine authored work (unchanged header comments + 05-03 decisions in the bodies); only the *commit attribution* ended up inside Plan 05-04's docs commit. Plan 05-03 still authored the bytes. No content from Plan 05-04 touches those files.
- `src/features/agents/agents.css` — Plan 05-02 shipped base; Plan 05-03 may extend
- `src/features/agents/index.tsx` — Plan 05-02 single-writer (D-122)
- `src/features/agents/types.ts` — Plan 05-02 single-writer
- `src/features/knowledge/**` — Plans 05-05 / 05-06 own
- `src/lib/tauri/agents.ts` — Plan 05-02 single-writer
- `src/lib/events/index.ts` + `payloads.ts` — Plan 05-01 single-writer
- `.planning/STATE.md` / `.planning/ROADMAP.md` — orchestrator updates only

## Verification

- `npx tsc --noEmit` → 0 errors (checked at HEAD `47e5cd8` in isolation; in-flight parallel work from 05-03 observed intermittent errors during execution but resolved before SUMMARY).
- `npm run verify:all` → 9/9 green (`verify:entries`, `verify:no-raw-tauri`, `verify:migration-ledger`, `verify:emit-policy`, `verify:contrast`, `verify:chat-rgba`, `verify:ghost-no-cursor`, `verify:orb-rgba`, `verify:hud-chip-count`).
- ESLint `no-raw-tauri` → passed (see verify:no-raw-tauri — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths).
- All 5 routes render without 404 (index.tsx single-writer from Plan 05-02 preserved).
- SwarmView explicitly satisfies SC-1 — SwarmDAG.tsx is the DAG renderer; the testid `swarm-dag-root` is the Playwright hook for Plan 05-07.

## Known Stubs

None. All 5 routes wire live data on mount.

## Self-Check: PASSED

- SwarmDAG.tsx FOUND
- SwarmNode.tsx FOUND
- SwarmDAG.css FOUND
- agents-dag-pack.css FOUND
- AgentFactory.tsx modified + placeholder text removed
- AgentTimeline.tsx modified + placeholder text removed
- TaskAgents.tsx modified + placeholder text removed
- AgentPixelWorld.tsx modified + placeholder text removed
- SwarmView.tsx modified + placeholder text removed
- Commits 267d172, 5c90554, 47e5cd8 all present in git log
- 0 tsc errors at HEAD
- 9/9 verify:all green
