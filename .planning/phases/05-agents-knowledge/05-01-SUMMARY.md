---
phase: 05-agents-knowledge
plan: 01
subsystem: events + prefs typed surface
tags: [phase-5, agents, knowledge, events, payloads, usePrefs, types-only]
requires:
  - BLADE_EVENTS registry (Phase 1, src/lib/events/index.ts)
  - Existing AgentEventPayload / AgentLifecyclePayload (Phase 1, src/lib/events/payloads.ts)
  - Prefs dotted-key discipline (Phase 1 D-12, src/hooks/usePrefs.ts)
  - useTauriEvent sole-listener surface (D-13)
provides:
  - 6 new agent step event constants on BLADE_EVENTS
  - 6 new typed payload interfaces (agent step + swarm lifecycle + agent output)
  - 5 new Phase 5 Prefs dotted keys (D-133)
affects:
  - src/lib/events/index.ts (+11 lines — 6 new AGENT_STEP_* constants)
  - src/lib/events/payloads.ts (+64 lines — 6 new exported interfaces + banner comment)
  - src/hooks/usePrefs.ts (+11 lines — 5 new Phase 5 dotted keys + section header)
tech-stack:
  added: []
  patterns:
    - "index signature `[k: string]: unknown` on every Rust-emit payload interface (D-38-payload forward-compat)"
    - "dotted-key Prefs extension in the central Prefs interface (D-12)"
    - "JSDoc @see `src-tauri/src/<file>.rs:<line>` citation per interface (Pattern §1)"
key-files:
  created: []
  modified:
    - src/lib/events/index.ts
    - src/lib/events/payloads.ts
    - src/hooks/usePrefs.ts
decisions:
  - D-121 (plan split) honored — plan 05-01 is a pure-TS wave-1 plan; zero Rust, zero wrapper, zero feature-folder overlap
  - D-125 (AgentDetail 10-subscriber surface) unblocked — event constants + typed payloads for every executor.rs emit site now present
  - D-129 (one useTauriEvent per event name) enabled — BladeEventName literal union now covers all 16 agent events
  - D-133 (5 Phase 5 Prefs keys) applied verbatim — agents/knowledge/screenTimeline dotted keys added
  - D-119 / D-123 honored — zero Rust files touched
metrics:
  duration: "~20 min"
  commits: 2
  completed: 2026-04-19
---

# Phase 5 Plan 05-01: Events + Payloads + Prefs Type Surface — Summary

**One-liner:** Extended the event registry and Prefs interface with the 6 agent step event constants, 6 typed payload interfaces, and 5 Phase 5 dotted-key Prefs that unblock AgentDetail (D-125), SwarmView (D-129), BackgroundAgents, AgentDashboard filter, and KnowledgeBase/Graph/ScreenTimeline persistence — all pure TypeScript, zero Rust changes (D-119 + D-123).

## What Was Added

### Event constants — `src/lib/events/index.ts` (6 new)

Appended inside the existing "Agents (LIVE emit; Phase 5 consumers)" section, before the closing `} as const;`. Values match the exact Rust emit strings.

| Constant                       | Value                          | Rust emit site                           |
| ------------------------------ | ------------------------------ | ---------------------------------------- |
| `AGENT_STEP_RETRYING`          | `'agent_step_retrying'`        | `src-tauri/src/agents/executor.rs:177`   |
| `AGENT_STEP_TOOL_FALLBACK`     | `'agent_step_tool_fallback'`   | `src-tauri/src/agents/executor.rs:243`   |
| `AGENT_STEP_PROVIDER_FALLBACK` | `'agent_step_provider_fallback'` | `src-tauri/src/agents/executor.rs:267` |
| `AGENT_STEP_PARTIAL`           | `'agent_step_partial'`         | `src-tauri/src/agents/executor.rs:314`   |
| `AGENT_STEP_COMPLETED`         | `'agent_step_completed'`       | `src-tauri/src/agents/executor.rs:335`   |
| `AGENT_STEP_FAILED`            | `'agent_step_failed'`          | `src-tauri/src/agents/executor.rs:349`   |

`BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS]` picks these up automatically — no separate union edit needed.

### Typed payload interfaces — `src/lib/events/payloads.ts` (6 new)

Appended to the "Agents" section after the existing `AgentEventPayload` + `AgentLifecyclePayload`. Every interface carries `[k: string]: unknown` for forward-compat with Rust shape drift (D-38-payload accepted risk). Each has JSDoc citing the Rust emit location.

| Interface                    | Key fields                                                                 | Rust emit site (for drift review)                  |
| ---------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| `AgentStepStartedPayload`    | `step_id`, `agent_id`, `tool_name?`, `role?`, `input_preview?`             | `src-tauri/src/agents/executor.rs:99`              |
| `AgentStepCompletedPayload`  | `step_id`, `agent_id`, `duration_ms?`, `result_preview?`                   | `src-tauri/src/agents/executor.rs:335`             |
| `SwarmProgressPayload`       | `swarm_id`, `completed_steps`, `total_steps`, `current_step_id?`, `status?` | `src-tauri/src/swarm_commands.rs:452`              |
| `SwarmCreatedPayload`        | `swarm_id`, `total_steps`                                                  | `src-tauri/src/swarm_commands.rs:524`              |
| `SwarmCompletedPayload`      | `swarm_id`, `duration_ms?`, `error?`                                       | `src-tauri/src/swarm_commands.rs:390`              |
| `AgentOutputPayload`         | `id`, `output`                                                             | `src-tauri/src/background_agent.rs:236`            |

### Prefs dotted keys — `src/hooks/usePrefs.ts` (5 new)

Appended inside the `Prefs` interface, gated by a `// ───── Phase 5 (Plan 05-01, D-133) ─────` header, immediately before the forward-compat `[k: string]` signature so TypeScript still widens unknown keys.

| Key                              | Type                                               | Consumer (Phase 5)         |
| -------------------------------- | -------------------------------------------------- | -------------------------- |
| `agents.filterStatus`            | `'all' \| 'running' \| 'idle' \| 'failed'`         | AgentDashboard filter chip |
| `agents.selectedAgent`           | `string`                                           | AgentDetail deep-link      |
| `knowledge.lastTab`              | `string`                                           | KnowledgeBase tab memory   |
| `knowledge.sidebarCollapsed`     | `boolean`                                          | KnowledgeGraph sidebar     |
| `screenTimeline.autoLoadLatest`  | `boolean`                                          | ScreenTimeline preference  |

All five are optional — no default blob change, no migration path needed (D-12 single-blob discipline preserved).

## Files Touched

| File                           | Status   | Net lines | Commit    |
| ------------------------------ | -------- | --------- | --------- |
| `src/lib/events/index.ts`      | modified | +11       | `9076b2c` |
| `src/lib/events/payloads.ts`   | modified | +64       | `d6a3866` |
| `src/hooks/usePrefs.ts`        | modified | +11       | `d6a3866` |

**Total:** 3 files, +86 net lines. Within the plan budget ("~60-90 net new lines").

## Files NOT Touched (scope discipline)

- `src-tauri/**` — zero Rust edits (D-119 + D-123).
- `src/lib/tauri/agents.ts` + `src/lib/tauri/knowledge.ts` — 05-02 lane; not created.
- `src/features/agents/**`, `src/features/knowledge/**` — 05-03..06 lanes.
- `src/features/agents/index.tsx` + `src/features/knowledge/index.tsx` — 05-02 owns the one-time rewrite (D-122 single-writer invariant).
- `src/features/agents/agents.css`, `src/features/knowledge/knowledge.css` — 05-02 creates.
- `.planning/STATE.md` + `.planning/ROADMAP.md` — orchestrator's job, not this plan.

## Verification

| Check                                         | Result      |
| --------------------------------------------- | ----------- |
| `grep -c AGENT_STEP_... src/lib/events/index.ts` | **6** (exact match)  |
| `grep -c ...Payload src/lib/events/payloads.ts`  | **6** (exact match)  |
| `grep -c agents.filter... src/hooks/usePrefs.ts` | **5** (exact match)  |
| `npx tsc --noEmit`                               | **clean** (zero errors)  |
| `npm run verify:all` (9 scripts)                 | **9/9 GREEN**        |

### `verify:all` breakdown (all PASS)

1. `verify:entries` — 5 vite entry HTMLs present.
2. `verify:no-raw-tauri` — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths (wrappers + useTauriEvent).
3. `verify:migration-ledger` — 89 ledger rows loaded, 7 referenced ids tracked.
4. `verify:emit-policy` — 59 broadcast emits match cross-window allowlist.
5. `verify:contrast` — every strict glass pair ≥ 4.5:1 contrast.
6. `verify:chat-rgba` — no `backdrop-filter` inside `src/features/chat` (D-70 preserved).
7. `verify:ghost-no-cursor` — no `cursor` in ghost surfaces (D-09 preserved).
8. `verify:orb-rgba` — no `backdrop-filter` on orb (D-07/D-18/SC-2 preserved).
9. `verify:hud-chip-count` — exactly 4 `hud-chip hud-*` classes (HUD-02 preserved).

## Rust Emit Site Cross-Reference

The 6 new constants map to the Rust file-and-line citations carried inline as `//` comments in `index.ts`. These line numbers came from `.planning/RECOVERY_LOG.md §4.6` (the authoritative agent-events table). If a future Rust refactor shifts the line numbers but keeps the emit strings, only the comment drifts — the runtime wiring is unaffected. Plan 05-07 will add a grep-based verify script over `lib.rs` to fail-fast on any emit-string renames.

## Deviations from Plan

**None — plan executed exactly as written.**

No deviations required. The plan's `<interfaces>` block was a verbatim blueprint; every field name, every payload signature, every prefs key matched what was specified. TypeScript compiled cleanly on first try; verify:all stayed 9/9 green. Zero auto-fixes (Rules 1–3), zero architectural decisions (Rule 4), zero authentication gates.

## Drift Concerns Noted While Reading

None found during the read-first pass. The existing `AgentEventPayload` + `AgentLifecyclePayload` interfaces in `payloads.ts` already use loose-shape index signatures; the 6 new interfaces follow that same discipline consistently. One minor observation:

- The plan's "current BLADE_EVENTS (lines 97-107)" reference held true — actual file lines match. No reordering was needed; the insertion slot was unambiguous.
- `BladeEventName` literal union at line 111 automatically widened to include the 6 new constants without any explicit edit (confirmed by `tsc` passing without touching the type declaration).

## Impact on Wave-2 Plans

Plan 05-02 (wrappers) can now import:
- Payload types for every `useTauriEvent` call AgentDetail will mount.
- No new exports needed — the existing `export type * from './payloads'` in `index.ts` re-exports the 6 new interfaces automatically.

Plans 05-03..06 can reference:
- `BLADE_EVENTS.AGENT_STEP_*` constants by name (10 total now).
- The 6 new payload types for typed `useTauriEvent<T>()` subscriptions.
- 5 Prefs keys via `usePrefs().setPref('agents.filterStatus', ...)` without TS errors.

## TDD Gate Compliance

N/A — plan type is `execute` (not `tdd`). Tasks are type additions with no runtime behavior to test; verification is `tsc --noEmit` + `verify:all` rather than unit tests.

## Known Stubs

None. Every addition is fully wired — payload interfaces are complete shapes, Prefs keys are optional but typed, event constants are strings usable at subscription sites.

## Self-Check: PASSED

Verified:
- `src/lib/events/index.ts` — 6 new constants present (grep count 6).
- `src/lib/events/payloads.ts` — 6 new exported interfaces present (grep count 6).
- `src/hooks/usePrefs.ts` — 5 new dotted keys present (grep count 5).
- Commit `9076b2c` — present in `git log --oneline`.
- Commit `d6a3866` — present in `git log --oneline`.
- `npx tsc --noEmit` — exit 0.
- `npm run verify:all` — exit 0 with "OK" from all 9 scripts.

All claimed artifacts exist, all claimed commits exist, all claimed verifications pass.
