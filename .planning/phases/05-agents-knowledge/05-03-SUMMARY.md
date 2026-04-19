---
phase: 05-agents-knowledge
plan: 03
subsystem: agents-routes-a
tags: [agents, agent-dashboard, agent-detail, agent-team, background-agents, timeline, rAF, WIRE-05]
requires:
  - Plan 05-01 (6 agent step event constants + 6 typed payload interfaces + 5 Phase 5 Prefs keys)
  - Plan 05-02 (33 typed agents wrappers + placeholders + agents.css base + status tokens)
  - Phase 1 substrate (GlassPanel, Dialog, Button, Pill, GlassSpinner, Input, Badge, useTauriEvent, Toast, useRouterCtx, usePrefs)
provides:
  - AGENT-01 — AgentDashboard with 4-segment status filter + grouped running/idle/complete/failed sections
  - AGENT-02 — AgentDetail real-time event timeline (WIRE-05 consumer, 10-subscriber surface)
  - AGENT-04 — AgentTeam role-grouped agents list (8 canonical roles + Other bucket)
  - AGENT-06 — BackgroundAgents two-pane layout with spawn form + event-streamed output log
  - Reusable useAgentTimeline hook (ref-buffer + rAF-flush, 200-row cap, agent-id filter)
  - agents-dashboard.css scoped partial (filter pills, group headings, background layout, timeline rows)
affects:
  - Plan 05-07 can import testids: agent-dashboard-root, agent-dashboard-card,
    agent-team-root, agent-team-card, agent-team-role-section,
    background-agents-root, background-agents-list, background-agents-detail,
    background-agents-output, background-agents-card, background-agents-spawn,
    agent-detail-root, agent-detail-summary, agent-detail-timeline, timeline-row
  - useAgentTimeline.ts exports { useAgentTimeline } as the canonical 10-subscriber surface
    for any future cross-agent timeline consumer (Plan 05-04 AgentTimeline already uses a
    different pattern — plain useState — per D-125's explicit scope to this plan)
tech-stack:
  added: []
  patterns:
    - ref-buffer + rAF-flush for 10-event high-frequency subscriber (Pattern §2, D-68 reuse)
    - 200-row client-side timeline cap (D-125 — prevents memory growth under floods)
    - client-side agent-id filter via payload.agent_id ?? payload.id (D-130 loose-shape guard)
    - event-driven primary + 2s poll fallback for background-agent output streaming
    - dotted-key pref deep-link (agents.selectedAgent) feeds AgentDetail from dashboard/team
    - scoped CSS partial (agents-dashboard.css) under @layer features — no collision with 05-04's agents-dag-pack.css
    - Dialog-confirmed destructive actions (Cancel) in AgentDetail + BackgroundAgents
    - sticky-bottom auto-scroll discipline with user-scroll-up release (classic chat pattern)
key-files:
  created:
    - src/features/agents/useAgentTimeline.ts
    - src/features/agents/agents-dashboard.css
    - .planning/phases/05-agents-knowledge/05-03-SUMMARY.md
  modified:
    - src/features/agents/AgentDashboard.tsx
    - src/features/agents/AgentDetail.tsx
    - src/features/agents/AgentTeam.tsx
    - src/features/agents/BackgroundAgents.tsx
decisions:
  - "AgentDashboard merges foreground (agentList) + background (getActiveAgents) agents
    client-side and dedupes by id. Foreground wins when both surfaces report. Cleanly
    honours D-119 (no new Rust) while giving the user a single unified list."
  - "AgentTeam uses the first-step tool_name as the role proxy (Agent.steps[0].tool_name)
    since the Rust Agent struct has no top-level role field (agents/mod.rs:155). Unknown
    roles fall into an 'Other' bucket — agents are never dropped silently. 8 canonical
    roles hardcoded with descriptions: Researcher / Coder / Analyst / Writer / Reviewer /
    SecurityTestResearcher / SecurityRedTeam / SecurityBlueTeam. Plan 05-07 can key test
    assertions off KNOWN_ROLES export order."
  - "BackgroundAgents output stream is event-driven (AGENT_OUTPUT subscription, D-129)
    PLUS a 2s setInterval fallback while the agent is in a live status. The poll is
    silent on error (no toast churn) and only pushes state when the payload changes.
    This 'belt and braces' layer protects against missed events (T-05-03-01 defensive
    depth beyond the mitigation the hook already provides)."
  - "Agent status comparison in BackgroundAgents uses `String(selected.status)` coercion
    so the Rust wire can emit either 'Running' or the authoritative 'Executing' without
    tsc false positives (the typed union is 'Executing' per src/lib/tauri/agents.ts:30).
    Documented inline so the next reader doesn't 'fix' the cast."
  - "AgentDetail loads agent metadata via agentGet() on mount + selection change.
    Timeline.clear() is called immediately when selectedId changes (resetting seq
    counter + buffer + committed rows) so switching agents produces a clean surface."
  - "Auto-scroll-to-bottom uses a ref-backed stickToBottom flag + scroll listener —
    when user scrolls up (> 12px from bottom) the flag flips to false; scrolling back
    to the bottom re-arms it. Classic chat auto-scroll discipline (D-68 family)."
  - "Row expand-on-click uses a Set<number> of seq values in component state.
    prettyJson() gracefully falls back to the raw string when parse fails (some
    payloads are non-JSON strings like 'agent_ack' on legacy paths)."
metrics:
  duration: "~45 min (plus ~15 min resolving commit-attribution race)"
  commits: 2 (direct)
  completed: 2026-04-19
---

# Phase 5 Plan 05-03: Agents Cluster Subset A — Summary

**One-liner:** AgentDashboard + AgentDetail + AgentTeam + BackgroundAgents shipped as four real glass-native surfaces backed by Plan 05-02 wrappers + Plan 05-01 typed events, wired through a reusable rAF-flush `useAgentTimeline` hook that consolidates 10 Rust agent-lifecycle emit sites into a capped, filtered, 60fps-under-burst event timeline.

## Routes Flipped From Placeholder → Real

| Route id              | Requirement | Placeholder from | Now ships                                     |
| --------------------- | ----------- | ---------------- | --------------------------------------------- |
| `agents`              | AGENT-01    | Plan 05-02       | AgentDashboard — 4-filter + grouped sections  |
| `agent-detail`        | AGENT-02    | Plan 05-02       | AgentDetail — 10-sub rAF timeline + actions   |
| `agent-team`          | AGENT-04    | Plan 05-02       | AgentTeam — role-grouped list (8 + Other)     |
| `background-agents`   | AGENT-06    | Plan 05-02       | BackgroundAgents — two-pane + output stream   |

Every `Ships in Plan 05-03.` placeholder hint is gone from the 4 lane files (grep-verified). ROADMAP SC-1 closed for these 4 of 9 agent routes; Plan 05-04 closed the other 5 in parallel.

## useAgentTimeline Hook

`src/features/agents/useAgentTimeline.ts` (171 lines) is the WIRE-05 core. Contract:

- **10 `useTauriEvent` subscribers** (D-129 — one per event name):
  - `BLADE_AGENT_EVENT` (executor.rs multi-site)
  - `AGENT_STEP_STARTED` (executor.rs:99)
  - `AGENT_STEP_RESULT` (executor.rs:178)
  - `AGENT_STEP_RETRYING` (executor.rs:177)
  - `AGENT_STEP_TOOL_FALLBACK` (executor.rs:243)
  - `AGENT_STEP_PROVIDER_FALLBACK` (executor.rs:267)
  - `AGENT_STEP_PARTIAL` (executor.rs:314)
  - `AGENT_STEP_COMPLETED` (executor.rs:335)
  - `AGENT_STEP_FAILED` (executor.rs:349)
  - `AGENT_EVENT` (agent_commands.rs:426,463,512,546,560,589,602)
- **Ref-buffer + rAF-flush** (D-68 reuse): incoming events accumulate in a `useRef<TimelineRow[]>` buffer; a single `requestAnimationFrame` callback per frame commits the batch to `useState<TimelineRow[]>`. Keeps React's render cadence at one paint per frame even under a 50 event/s synthetic burst.
- **200-row cap (D-125)**: after append, the committed array is sliced from the tail when it exceeds 200 entries. Prevents unbounded memory growth under sustained emit.
- **Client-side agent-id filter (D-130)**: if `currentAgentId` is non-empty, events are dropped unless `payload.agent_id === currentAgentId` (falls back to `payload.id` per the loose-shape D-38-payload guard). Pass `null` to consume cross-agent events (AgentTimeline lane; unused by this plan).
- **`clear()` callback**: resets committed rows + buffer + seq counter atomically. AgentDetail invokes it whenever the selected-agent id changes.
- **useEffect cleanup cancels pending rAF** (T-05-03-04 mitigation, D-68 discipline).

## AgentTeam Role Palette (Ground Truth for Plan 05-07)

`AgentTeam.tsx` hardcodes the 8-role palette + descriptions, emitted in the stable order below for Plan 05-07 Playwright spec assertions:

| Role                     | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| Researcher               | Web + memory search specialist — gathers evidence for downstream agents. |
| Coder                    | Writes code, runs builds, and iterates until verification passes.        |
| Analyst                  | Reasons over datasets, metrics, and logs to surface patterns.            |
| Writer                   | Drafts prose, summaries, and user-facing copy from a briefing.           |
| Reviewer                 | Cross-checks a peer agent's output against goals + constraints.          |
| SecurityTestResearcher   | Enumerates attack surface + known CVEs.                                  |
| SecurityRedTeam          | Simulates adversary behaviour against BLADE's own posture.               |
| SecurityBlueTeam         | Hardens defences in response to red-team findings.                       |
| Other                    | Agents whose role is not in the canonical Phase 5 list.                  |

The `ROLE_ORDER` + `KNOWN_ROLES` + `ROLE_DESCRIPTIONS` exports are module-private today; Plan 05-07 may lift them as needed for fixture comparison.

## CSS Added to Cluster (Delta from Plan 05-02 Base)

`src/features/agents/agents-dashboard.css` (433 lines) adds NEW classes — no replacement of `agents.css` base rules. All rules live under `@layer features` for deterministic specificity.

### Dashboard / Team shared
- `.agents-filter-row`, `.agents-filter-pill` (+`[data-active='true']`)
- `.agents-header-row`, `.agents-header-title`, `.agents-header-meta`
- `.agents-available-chip-row`
- `.agents-group`, `.agents-group-heading`
- `.agents-card-grid` (auto-fill minmax(280px, 1fr))
- `.agent-card-task`, `.agent-card-meta`, `.agent-card-role`, `.agent-card-actions`
- `.agents-empty-state`, `.agents-loading-wrap`, `.agents-error-pill`
- `.agents-role-description` (AgentTeam role prose)

### BackgroundAgents
- `.agents-background-layout` (40%/60% two-pane grid)
- `.agents-background-left`, `.agents-background-right`
- `.agents-background-spawn` + `select` styling
- `.agent-card[data-selected='true']`, `.agent-card[data-selectable='true']`
- `.agents-output-block` (monospace pre-wrap, max-height viewport-relative)
- `.agents-detail-header`, `.agents-detail-actions`
- `.agents-confirm-dialog` (+ `h3`, `p`, `-actions`)

### AgentDetail
- `.agent-detail-layout` (320px / 1fr)
- `.agent-detail-summary`, `.agent-detail-summary-card`, `.agent-detail-summary-task`
- `.agent-detail-timeline`, `.agent-detail-timeline-header`, `-title`, `-count`, `-empty`
- `.agent-timeline-row` (+`[data-expanded='true']`, `-ts`, `-event`, `-preview`)
- `.agent-timeline-row[data-event='agent_step_failed' | 'agent_step_completed' | 'agent_step_retrying' | 'agent_step_tool_fallback' | 'agent_step_provider_fallback']` tint modifiers
- `.agent-detail-empty` + `h2`

**D-07 / D-70 discipline:** zero `backdrop-filter` declarations in the new CSS — every inner surface uses `rgba()` backgrounds so the GlassPanel tier-1 parent is the sole blur layer.

## Rust Wrapper Signature Surprises (cross-check with Plan 05-02 SUMMARY)

None newly discovered. Plan 05-02 already normalised every signature drift at the wrapper boundary; AgentDashboard / AgentTeam / BackgroundAgents use:

- `agentList()` — zero-arg, returns `Agent[]`
- `agentGet(id)` — returns `Agent` (errors if missing; not Option)
- `agentPause / agentResume / agentCancel(id)` — void returns
- `agentListBackground() / getActiveAgents()` — zero-arg arrays
- `agentGetOutput(id)` — returns the full accumulated stdout string
- `agentCancelBackground(id)` — void return
- `agentDetectAvailable()` — returns `string[]` of detected runtimes
- `agentSpawn({agentType, task, cwd?})` — camelCase wrapper → snake_case at invoke boundary

One observation surfaced during implementation: `BackgroundAgent.status` is typed as `AgentStatus` which does NOT include `'Running'` (Rust uses `Executing` per agents/mod.rs:172). The Rust background-runtime may still emit `'Running'` on some legacy paths; the code uses `String(status)` coercion before comparison so both strings trigger the `isRunning` branch for the 2s output poll. This is documented inline in BackgroundAgents.tsx rather than widening the wrapper type (which would ripple typechecks through 05-04's AgentTimeline).

## Files NOT Touched (Scope Discipline)

- `src/features/agents/index.tsx` — Plan 05-02 single-writer (D-122).
- `src/features/agents/types.ts` — Plan 05-02 single-writer.
- `src/features/agents/agents.css` — Plan 05-02 base; extended via a sibling partial (agents-dashboard.css) per the plan's Task 2 guidance, NOT in-place rewrite.
- `src/features/agents/{AgentFactory,AgentTimeline,TaskAgents,SwarmView,AgentPixelWorld,SwarmDAG,SwarmNode}.tsx` — Plan 05-04 lane.
- `src/features/agents/{agents-dag-pack.css,SwarmDAG.css}` — Plan 05-04 lane.
- `src/features/knowledge/**` — Plans 05-05 + 05-06 lanes.
- `src-tauri/**` — zero Rust edits (D-119 + D-123).
- `.planning/STATE.md` + `.planning/ROADMAP.md` + `.planning/REQUIREMENTS.md` — orchestrator's job, not this plan.

## Commits

| Commit    | Subject                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------- |
| `2668417` | `feat(05-03): useAgentTimeline hook — 10-sub rAF-flush timeline (D-125, D-129, D-130)`            |
| `c91e61c` | `feat(05-03): AgentDetail real-time timeline surface (AGENT-02, WIRE-05 consumer)`                |

Three other 05-03-authored files (`AgentDashboard.tsx`, `AgentTeam.tsx`, `BackgroundAgents.tsx`) + the new `agents-dashboard.css` ended up attributed to parallel plans' commits due to the **concurrent-executor race on the staging index** documented in `21501dc` (05-04) and `4070783` (05-05). The byte content is 05-03's authored work verbatim — only the git log message attribution drifted. Net outcome: all 05-03 functional work is on master, discoverable via `git log -- src/features/agents/<file>`:

| File                                         | Actual attribution commit | Content authored by |
| -------------------------------------------- | ------------------------- | ------------------- |
| `src/features/agents/useAgentTimeline.ts`    | `2668417`                 | Plan 05-03 ✓        |
| `src/features/agents/AgentDashboard.tsx`     | `222810f` (docs/05-04)    | Plan 05-03          |
| `src/features/agents/AgentTeam.tsx`          | `222810f` (docs/05-04)    | Plan 05-03          |
| `src/features/agents/BackgroundAgents.tsx`   | `3944030` (docs/05-05)    | Plan 05-03          |
| `src/features/agents/agents-dashboard.css`   | `4070783` (docs/05-05)    | Plan 05-03          |
| `src/features/agents/AgentDetail.tsx`        | `c91e61c`                 | Plan 05-03 ✓        |

Running `git show <commit> -- src/features/agents/<file>` confirms the code matches this plan's `<interfaces>` + `<action>` specs.

## Verification

| Check                                                                        | Result           |
| ---------------------------------------------------------------------------- | ---------------- |
| `npx tsc --noEmit`                                                           | **clean (exit 0)** |
| `npm run verify:all` (9 scripts)                                             | **9/9 GREEN**    |
| `bash scripts/verify-no-raw-tauri.sh`                                        | **OK**           |
| grep agentList / getActiveAgents in AgentDashboard.tsx                       | **present**      |
| grep agentList in AgentTeam.tsx                                              | **present**      |
| grep agentListBackground / agentGetOutput in BackgroundAgents.tsx            | **present**      |
| grep useAgentTimeline + agent-detail-root + timeline-row in AgentDetail.tsx  | **present**      |
| grep `Ships in Plan 05-03` in any lane file                                  | **0 matches (placeholders fully replaced)** |

### verify:all breakdown

1. `verify:entries` — OK
2. `verify:no-raw-tauri` — OK
3. `verify:migration-ledger` — OK
4. `verify:emit-policy` — OK
5. `verify:contrast` — all strict glass pairs ≥ 4.5:1
6. `verify:chat-rgba` — OK (D-70 preserved)
7. `verify:ghost-no-cursor` — OK (D-09 preserved)
8. `verify:orb-rgba` — OK (D-07/D-18/SC-2 preserved)
9. `verify:hud-chip-count` — OK (exactly 4 `hud-chip hud-*`, HUD-02 preserved)

## Deviations from Plan

### Auto-fixed during implementation

**1. [Rule 1 — Bug] BackgroundAgent status comparison TypeScript error**

- **Found during:** Task 2 — typecheck after initial BackgroundAgents.tsx write.
- **Issue:** `selected.status === 'Running'` tripped TS2367 because the typed union `AgentStatus` (src/lib/tauri/agents.ts:30) uses `'Executing'` (not `'Running'`). The Rust wire may still emit `'Running'` on some legacy background-agent paths, so a simple delete of the comparison would mis-classify live agents.
- **Fix:** Cast to `String(...)` before compare — preserves runtime permissiveness, satisfies tsc. Documented inline with a comment citing the wrapper type source.
- **Files modified:** `src/features/agents/BackgroundAgents.tsx`
- **Committed under:** `3944030` (see race note above)

**2. [Rule 3 — Blocking] Task 2 + CSS file staging absorbed by parallel plan commits**

- **Found during:** Commit time — my `git add` of AgentDashboard/Team/Background + agents-dashboard.css raced against other plans' executors running simultaneously.
- **Issue:** Plans 05-04 and 05-05 ran `git add` / `git commit` cycles overlapping mine, sweeping my staged files into their own docs-commit payloads (`222810f`, `3944030`) before I could run `git commit` on a 05-03-attributed commit.
- **Fix:** Documented the race in this summary + accepted the misattribution — the code itself is correct and complete on master. Plans 05-04 and 05-05 added their own race notes (`21501dc`, `4070783`) acknowledging the sweep. No functional work was lost or corrupted; just the commit-message attribution drifted.
- **Root cause:** The parallel-executor harness doesn't serialise access to the git index between concurrent executors. Acceptable for this phase; recommend Phase 5 retrospective add a note about per-executor git worktrees for Phase 6.

**No Rule 4 architectural decisions required; no authentication gates encountered.**

## Threat Flags

No new trust boundaries introduced. All 10 event subscribers were already in the Plan 05-01 scope; all wrappers were already in Plan 05-02. This plan is pure consumer-side UI work.

## Known Stubs

None. Every surface renders live data or a real empty state:

- AgentDashboard empty state prompts user to use `agent_spawn` or `/agent-factory`.
- AgentTeam empty state prompts use of Agent Factory.
- BackgroundAgents empty state lists the detected runtimes (possibly `none`).
- AgentDetail empty state prompts selection from dashboard.
- Every data surface uses real wrapper calls; no hardcoded placeholder payloads.

## Plan 05-04 Files Confirmation

Not touched by this plan:

| File                                              | Owner       |
| ------------------------------------------------- | ----------- |
| `src/features/agents/AgentFactory.tsx`            | Plan 05-04  |
| `src/features/agents/AgentTimeline.tsx`           | Plan 05-04  |
| `src/features/agents/TaskAgents.tsx`              | Plan 05-04  |
| `src/features/agents/SwarmView.tsx`               | Plan 05-04  |
| `src/features/agents/AgentPixelWorld.tsx`         | Plan 05-04  |
| `src/features/agents/SwarmDAG.tsx`                | Plan 05-04  |
| `src/features/agents/SwarmNode.tsx`               | Plan 05-04  |
| `src/features/agents/SwarmDAG.css`                | Plan 05-04  |
| `src/features/agents/agents-dag-pack.css`         | Plan 05-04  |

Plans 05-05 and 05-06 knowledge-cluster files are likewise out of scope and untouched by this plan's lane.

## Self-Check: PASSED

Verified:
- `src/features/agents/useAgentTimeline.ts` — 171 lines, 10 useTauriEvent sites, rAF + 200-cap + agent-id filter.
- `src/features/agents/AgentDashboard.tsx` — 322 lines, uses agentList + getActiveAgents + agentDetectAvailable, 4-filter pill row wired to prefs.
- `src/features/agents/AgentTeam.tsx` — 207 lines, uses agentList + client-side groupBy role, 8 canonical role descriptions.
- `src/features/agents/BackgroundAgents.tsx` — 415 lines, two-pane layout + spawn form + Dialog-confirmed Cancel + 2s poll fallback + AGENT_OUTPUT event stream.
- `src/features/agents/AgentDetail.tsx` — 371 lines, mounts useAgentTimeline hook + agent-detail-root + timeline-row testids present.
- `src/features/agents/agents-dashboard.css` — 433 lines, no backdrop-filter, all token-driven.
- Commit `2668417` — present on master.
- Commit `c91e61c` — present on master.
- `npx tsc --noEmit` — exit 0 (clean).
- `npm run verify:all` — exit 0 with OK from all 9 scripts.

All claimed artifacts exist, all claimed commits exist, all claimed verifications pass.
