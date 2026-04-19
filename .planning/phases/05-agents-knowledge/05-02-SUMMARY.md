---
phase: 05-agents-knowledge
plan: 02
subsystem: agents-knowledge-wrappers
tags: [tauri-wrappers, cluster-scaffold, placeholders]
requires:
  - Phase 1 invokeTyped base + ESLint no-raw-tauri rule
  - Phase 1 RouteDefinition contract + feature-index pattern
  - Phase 1 design tokens (--s-*, --r-md, --line, --t-*)
  - Phase 1 GlassPanel primitive
provides:
  - src/lib/tauri/agents.ts — 33 typed wrappers for Agents cluster Rust commands
  - src/lib/tauri/knowledge.ts — 61 typed wrappers for Knowledge cluster Rust commands
  - src/features/agents/{index.tsx, types.ts, agents.css, 9 placeholders}
  - src/features/knowledge/{index.tsx, types.ts, knowledge.css, 9 placeholders}
  - 4 new status-color CSS custom properties (--status-idle/running/success/error)
  - src/lib/tauri/index.ts barrel re-exports (agents + knowledge namespaces)
affects:
  - Plans 05-03..06 import from these wrappers + replace per-route placeholder bodies
tech-stack:
  added: []
  patterns:
    - per-cluster wrapper module (D-118)
    - single-writer rewrite of feature index.tsx (D-122)
    - minimal-placeholder per-route files (D-131)
    - shared cluster CSS under @layer features (D-132)
key-files:
  created:
    - src/lib/tauri/agents.ts
    - src/lib/tauri/knowledge.ts
    - src/features/agents/types.ts
    - src/features/knowledge/types.ts
    - src/features/agents/agents.css
    - src/features/knowledge/knowledge.css
    - src/features/agents/AgentDashboard.tsx
    - src/features/agents/AgentDetail.tsx
    - src/features/agents/AgentFactory.tsx
    - src/features/agents/AgentTeam.tsx
    - src/features/agents/AgentTimeline.tsx
    - src/features/agents/BackgroundAgents.tsx
    - src/features/agents/TaskAgents.tsx
    - src/features/agents/SwarmView.tsx
    - src/features/agents/AgentPixelWorld.tsx
    - src/features/knowledge/KnowledgeBase.tsx
    - src/features/knowledge/KnowledgeGraph.tsx
    - src/features/knowledge/MemoryPalace.tsx
    - src/features/knowledge/ScreenTimeline.tsx
    - src/features/knowledge/RewindTimeline.tsx
    - src/features/knowledge/LiveNotes.tsx
    - src/features/knowledge/DailyLog.tsx
    - src/features/knowledge/ConversationInsights.tsx
    - src/features/knowledge/CodebaseExplorer.tsx
  modified:
    - src/features/agents/index.tsx (Phase 1 stubs → 9 lazy imports)
    - src/features/knowledge/index.tsx (Phase 1 stubs → 9 lazy imports)
    - src/styles/tokens.css (+4 --status-* tokens)
    - src/lib/tauri/index.ts (+2 namespace re-exports)
decisions:
  - D-118 per-cluster wrapper modules (agents.ts + knowledge.ts) — ships as two
    disjoint files so agents-wave plans and knowledge-wave plans never share
    files_modified.
  - D-119 no new Rust commands — every wrapper maps to a pre-existing
    #[tauri::command] registered in src-tauri/src/lib.rs.
  - D-122 single-writer invariant honored — Plan 05-02 is the only plan that
    edits the two cluster index.tsx files in Phase 5.
  - D-127 typed return shapes mirror Rust serde verbatim (snake_case on wire).
    UnifiedSearchResult uses Rust `rename_all="camelCase"` so JS surfaces
    camelCase there — documented inline in the wrapper JSDoc.
  - D-132 cluster CSS file under @layer features so Plans 05-03..06 can append
    rules without colliding with Plan 05-02's base classes.
metrics:
  duration: ~45 minutes
  completed: 2026-04-18
---

# Phase 5 Plan 02: agents.ts + knowledge.ts Wrappers + Feature Scaffolding Summary

One-liner: Two typed Tauri wrapper modules (33 + 61 commands, 94 total), two
rewritten cluster index.tsx files, 18 placeholder route components, two shared
CSS bases, and 4 status color tokens — all the plumbing Plans 05-03..06 need so
they can ship their route bodies in parallel with zero import-path surprises.

## Overview

Plan 05-02 executed as three atomic tasks, each committed individually:

1. **agents.ts + types barrel** (commit `237ee30`) — 33 camelCase wrappers
   across `agent_commands.rs`, `background_agent.rs`, `swarm_commands.rs`,
   `agent_factory.rs`, and `managed_agents.rs`.
2. **knowledge.ts + types barrel** (commit `cdb9388`) — 61 camelCase wrappers
   across `db_commands.rs` (knowledge + templates), `embeddings.rs`,
   `knowledge_graph.rs`, `memory_palace.rs`, `typed_memory.rs`,
   `screen_timeline_commands.rs`, `document_intelligence.rs`, and `memory.rs`.
3. **Feature index rewrites + 18 placeholders + CSS bases + status tokens +
   barrel** (commit `f282f87`) — Phase 1 `ComingSoonSkeleton` stubs replaced
   with real lazy imports of minimal placeholder components that Plans
   05-03..06 will fill in without touching the cluster index.tsx files.

Total: ~1,470 net new lines across 27 files (2 modified wrappers, 2 modified
index files, 2 modified support files, 23 new files). Zero Rust changes.

## Wrapper Inventory (D-119 audit trail)

### Agents cluster — 33 wrappers → src/lib/tauri/agents.ts

| Rust module             | Commands | Wrapper functions |
|-------------------------|----------|-------------------|
| `agent_commands.rs`     | 8        | `agentCreate`, `agentCreateDesktop`, `agentList`, `agentGet`, `agentPause`, `agentResume`, `agentCancel`, `agentRespondDesktopAction` |
| `background_agent.rs`   | 9        | `agentSpawn`, `agentListBackground`, `agentGetBackground`, `agentCancelBackground`, `agentDetectAvailable`, `agentGetOutput`, `getActiveAgents`, `agentAutoSpawn`, `agentSpawnCodex` |
| `swarm_commands.rs`     | 10       | `swarmCreate`, `swarmList`, `swarmGet`, `swarmPause`, `swarmResume`, `swarmCancel`, `swarmWriteScratchpad`, `swarmWriteScratchpadEntry`, `swarmReadScratchpad`, `swarmGetProgress` |
| `agent_factory.rs`      | 5        | `factoryCreateAgent`, `factoryDeployAgent`, `factoryListAgents`, `factoryPauseAgent`, `factoryDeleteAgent` |
| `managed_agents.rs`     | 1        | `runManagedAgent` |

All 33 match the Rust `generate_handler!` registrations at `src-tauri/src/lib.rs:690, 723-730, 879-887, 937-946, 1389-1393`.

### Knowledge cluster — 61 wrappers → src/lib/tauri/knowledge.ts

| Rust module                       | Commands | Wrapper functions |
|-----------------------------------|----------|-------------------|
| `db_commands.rs` (knowledge)      | 9        | `dbListKnowledge`, `dbGetKnowledge`, `dbAddKnowledge`, `dbUpdateKnowledge`, `dbDeleteKnowledge`, `dbSearchKnowledge`, `dbKnowledgeByTag`, `dbKnowledgeTags`, `dbKnowledgeStats` |
| `db_commands.rs` (templates)      | 4        | `dbListTemplates`, `dbAddTemplate`, `dbDeleteTemplate`, `dbIncrementTemplateUsage` |
| `embeddings.rs`                   | 3        | `embedAndStore`, `semanticSearch`, `vectorStoreSize` |
| `knowledge_graph.rs`              | 8        | `graphAddNode`, `graphSearchNodes`, `graphTraverse`, `graphFindPath`, `graphExtractFromText`, `graphAnswer`, `graphGetStats`, `graphDeleteNode` |
| `memory_palace.rs`                | 6        | `memorySearch`, `memoryGetRecent`, `memoryRecall`, `memoryAddManual`, `memoryDelete`, `memoryConsolidateNow` |
| `typed_memory.rs`                 | 5        | `memoryStoreTyped`, `memoryRecallCategory`, `memoryGetAllTyped`, `memoryDeleteTyped`, `memoryGenerateUserSummary` |
| `screen_timeline_commands.rs`     | 14       | `timelineSearchCmd`, `timelineBrowseCmd`, `timelineGetScreenshot`, `timelineGetThumbnail`, `timelineGetConfig`, `timelineSetConfig`, `timelineGetStatsCmd`, `timelineCleanup`, `timelineSearchEverything`, `timelineGetAudio`, `timelineMeetingSummary`, `timelineGetActionItems`, `timelineSetAudioCapture`, `timelineDetectMeeting` |
| `document_intelligence.rs`        | 8        | `docIngest`, `docSearch`, `docGet`, `docList`, `docDelete`, `docAnswerQuestion`, `docCrossSynthesis`, `docGenerateStudyNotes` |
| `memory.rs`                       | 4        | `getMemoryLog`, `getMemoryBlocks`, `setMemoryBlock`, `runWeeklyMemoryConsolidation` |

All 61 match the Rust `generate_handler!` registrations at `src-tauri/src/lib.rs:624-644, 765-768, 791-793, 923-936, 982-993, 1115-1122, 1146-1153`.

The knowledge count (61) exceeds the plan's nominal ~52 because the D-119
inventory undercounted `db_commands.rs` template commands (13 db_* rather than
9) and `screen_timeline_commands.rs` (14 timeline_*, which the plan correctly
anticipated). Both sides match the lib.rs registrations exactly.

## Rust Signature Corrections (during read-through)

While reading the Rust sources, several discrepancies from the plan's draft
wrapper signatures were discovered and corrected. Each correction is inline in
the wrapper JSDoc. Downstream plans must use the real signatures below.

| Command                        | Plan draft                                    | Rust reality                                          |
|--------------------------------|-----------------------------------------------|-------------------------------------------------------|
| `agent_create`                 | `{agent_type, task_description, priority}`    | Single `goal: String` → returns `String` (agent id)   |
| `agent_create_desktop`         | `{task_description, tools}`                   | `{goal, max_steps?, execution_mode?}` → `String`      |
| `agent_get`                    | `Option<Agent>`                               | `Result<Agent, String>` (not Option — errors on miss) |
| `agent_spawn`                  | `{agentKind, task, workingDir}`               | `{agent_type, task, cwd}` — returns `String` (id)     |
| `agent_auto_spawn`             | `task`                                        | `{task, project_dir}` → `String`                      |
| `agent_spawn_codex`            | `task`                                        | `{task, project_dir}` → `String`                      |
| `agent_respond_desktop_action` | `{action_id, response: 'approve' | 'deny'}`   | `{agent_id, approved: bool}`                          |
| `factory_create_agent`         | `{name, role, description}`                   | `description: String` → `AgentBlueprint` (synthesised)|
| `factory_deploy_agent`         | `id`                                          | `blueprint: AgentBlueprint` → `String`                |
| `run_managed_agent`            | `{kind, task}`                                | 10-arg signature (run_id, prompt, tools, mcp_servers?, permission_mode, max_turns, session_id?, working_directory?, subagents?) |
| `swarm_create`                 | `{goal, max_steps}`                           | `goal: String` only                                   |
| `swarm_write_scratchpad_entry` | `{swarm_id, key, value, appendedBy?}`         | `{swarm_id, key, value, source_task}` (all required)  |
| `db_list_knowledge`            | `(limit?)`                                    | no args — returns all; client-side slice              |
| `db_get_knowledge`             | `Option<KnowledgeRow>`                        | `Result<KnowledgeRow, String>` (errors on miss)       |
| `db_add_knowledge` / `_update` | `{...fields}`                                 | `{entry: KnowledgeRow}` (full row payload)            |
| `db_add_template`              | `{...fields}`                                 | `{template: serde_json::Value}` → `{ id }`            |
| `semantic_search`              | `{query, limit}`                              | `{query, top_k?}` — arg is `top_k`, not `limit`       |
| `memory_add_manual`            | `{title, content, ...}`                       | `{title, summary, episode_type, importance}`          |
| `memory_store_typed`           | `{category, content, confidence?}`            | `{category, content, source?, confidence?}`           |
| `graph_add_node`               | `{id, label, concept?, tags?}`                | `{id, concept, node_type, description, sources, importance}` |
| `doc_ingest`                   | `{path, title}`                               | `{file_path}` only                                    |
| `doc_generate_study_notes`     | `docId`                                       | `{doc_id: String}` — Rust returns raw `String`, not JSON |
| `timeline_meeting_summary`     | `{meeting_id}`                                | `meeting_id: String` → `MeetingSummary` struct        |
| `UnifiedSearchResult` struct   | snake_case on wire                            | `rename_all = "camelCase"` → resultType, sourceId      |

Downstream plans import the wrapper; signature drift is resolved at the
wrapper boundary so per-route files can use camelCase args without thinking
about the Rust conventions.

## Placeholder Files (18 per-route components)

Each placeholder renders a `GlassPanel tier={1}` wrapper with a route label
and a `"Ships in Plan 05-NN"` hint. Every placeholder has a unique
`data-testid` (e.g. `agent-dashboard-placeholder`, `knowledge-base-placeholder`)
so the Plan 05-07 Playwright cluster-routes spec can detect whether a route
body has shipped (absence of the placeholder hint = real body landed).

### Agents (9 placeholders)

| File                          | Route id              | Fills in |
|-------------------------------|-----------------------|----------|
| `AgentDashboard.tsx`          | `agents`              | 05-03    |
| `AgentDetail.tsx`             | `agent-detail`        | 05-03    |
| `AgentTeam.tsx`               | `agent-team`          | 05-03    |
| `BackgroundAgents.tsx`        | `background-agents`   | 05-03    |
| `AgentFactory.tsx`            | `agent-factory`       | 05-04    |
| `AgentTimeline.tsx`           | `agent-timeline`      | 05-04    |
| `TaskAgents.tsx`              | `task-agents`         | 05-04    |
| `SwarmView.tsx`               | `swarm-view`          | 05-04    |
| `AgentPixelWorld.tsx`         | `agent-pixel-world`   | 05-04    |

### Knowledge (9 placeholders)

| File                          | Route id                 | Fills in |
|-------------------------------|--------------------------|----------|
| `KnowledgeBase.tsx`           | `knowledge-base`         | 05-05    |
| `KnowledgeGraph.tsx`          | `knowledge-graph`        | 05-05    |
| `ScreenTimeline.tsx`          | `screen-timeline`        | 05-05    |
| `RewindTimeline.tsx`          | `rewind-timeline`        | 05-05    |
| `MemoryPalace.tsx`            | `memory-palace`          | 05-06    |
| `LiveNotes.tsx`               | `live-notes`             | 05-06    |
| `DailyLog.tsx`                | `daily-log`              | 05-06    |
| `ConversationInsights.tsx`    | `conversation-insights`  | 05-06    |
| `CodebaseExplorer.tsx`        | `codebase-explorer`      | 05-06    |

## Single-Writer Invariant (D-122) Preserved

The only feature index files touched in this plan:

- `src/features/agents/index.tsx` — rewritten once from Phase 1 skeleton to 9 lazy imports.
- `src/features/knowledge/index.tsx` — rewritten once from Phase 1 skeleton to 9 lazy imports.

No other cluster's index.tsx was touched (life, identity, dev, admin, body,
hive all untouched). Plans 05-03..06 will add per-route file bodies without
editing either index.

## CSS + Token Changes

- `src/features/agents/agents.css` and `src/features/knowledge/knowledge.css`
  created with a minimal shared base: `.{agents,knowledge}-surface`
  (cluster root padding + scroll), `.{agents,knowledge}-placeholder` +
  `-hint` (placeholder layout), and `.agent-card` / `.knowledge-card`
  (rgba bg + `var(--line)` border per D-70, status-color left-border for
  agent-card).
- `src/styles/tokens.css` gained 4 status-color CSS custom properties:
  `--status-idle`, `--status-running`, `--status-success`, `--status-error`.
  These drive agent-card `[data-status]` modifiers today and will drive Plan
  05-04's SwarmDAG node fills.
- Note: the plan draft referenced `--sp-*` and `--radius-card` tokens; the
  actual codebase uses `--s-*` spacing tokens (with `--sp-*` as a Tailwind
  utility bridge only in `src/styles/index.css`) and `--r-md` for the card
  radius. The CSS was written against the real token names so downstream
  plans inherit a correct baseline.

## Barrel Export Update

`src/lib/tauri/index.ts` now re-exports both new modules as namespaces:

```ts
export * as agents from './agents';
export * as knowledge from './knowledge';
```

Downstream plans may either import directly (`import { agentList } from
'@/lib/tauri/agents'`) or namespaced (`import { agents } from '@/lib/tauri';
agents.agentList()`). Both paths resolve to the same module.

## Verification

- `npx tsc --noEmit` — passes (clean).
- `npm run verify:all` — 9/9 green:
  - `verify:entries`, `verify:no-raw-tauri`, `verify:migration-ledger`,
    `verify:emit-policy`, `verify:contrast`, `verify:chat-rgba`,
    `verify:ghost-no-cursor`, `verify:orb-rgba`, `verify:hud-chip-count`.
- `bash scripts/verify-no-raw-tauri.sh` — OK (no raw `@tauri-apps/api/core`
  imports outside `src/lib/tauri/`).
- Route count in migration-ledger unchanged (9 agents + 9 knowledge = 18).
- Zero Rust files modified (D-119 + D-123).

## Deviations from Plan

### Auto-fixed corrections

**1. [Rule 1 — Bug] Rust signatures differed from plan drafts**

- **Found during:** Tasks 1 and 2 read-through of Rust sources.
- **Issue:** The plan's draft TypeScript signatures disagreed with the actual
  Rust `#[tauri::command]` signatures for ~20+ commands (see corrections
  table above).
- **Fix:** Each wrapper uses the real Rust signature verbatim; JSDoc calls
  out every correction inline so Plans 05-03..06 use the correct argument
  shape.
- **Files modified:** `src/lib/tauri/agents.ts`, `src/lib/tauri/knowledge.ts`
- **Commits:** `237ee30`, `cdb9388`

**2. [Rule 1 — Bug] CSS token names in the plan draft did not exist**

- **Found during:** Task 3 CSS creation.
- **Issue:** Plan draft referenced `--sp-4`, `--radius-card`, etc. The real
  codebase uses `--s-4`, `--r-md`; `--sp-*` is only a Tailwind utility
  bridge in `src/styles/index.css`, not a CSS custom property.
- **Fix:** Used the real token names in `agents.css` and `knowledge.css`.
- **Files modified:** `src/features/agents/agents.css`,
  `src/features/knowledge/knowledge.css`
- **Commit:** `f282f87`

**3. [Rule 2 — Completeness] Knowledge wrapper count higher than plan nominal**

- **Found during:** Task 2.
- **Issue:** Plan target was ~52 wrappers; the Rust registrations list 61.
  The plan's D-119 inventory undercounted templates (listed 4, real is 4 in
  the knowledge cluster but there are 13 total `db_*` knowledge+template
  commands) and timeline (listed 14, which is correct).
- **Fix:** Shipped all 61 wrappers so no downstream plan needs a command we
  missed. Tally in the `provides.exports` frontmatter of the plan is now
  superseded by the real wrapper file contents.
- **Files modified:** `src/lib/tauri/knowledge.ts`
- **Commit:** `cdb9388`

No Rule 4 architectural decisions required; no authentication gates
encountered (pure frontend + type-only work).

## Threat Flags

No new security surface introduced — plan 05-02 is scaffolding only.

## Self-Check: PASSED

- FOUND: `src/lib/tauri/agents.ts` (33 wrappers, 35 invokeTyped call sites, 46 @see citations)
- FOUND: `src/lib/tauri/knowledge.ts` (61 wrappers, 63 invokeTyped call sites, 79 @see citations)
- FOUND: `src/features/agents/types.ts`
- FOUND: `src/features/knowledge/types.ts`
- FOUND: `src/features/agents/{AgentDashboard,AgentDetail,AgentFactory,AgentTeam,AgentTimeline,BackgroundAgents,TaskAgents,SwarmView,AgentPixelWorld}.tsx` (9 placeholders)
- FOUND: `src/features/knowledge/{KnowledgeBase,KnowledgeGraph,MemoryPalace,ScreenTimeline,RewindTimeline,LiveNotes,DailyLog,ConversationInsights,CodebaseExplorer}.tsx` (9 placeholders)
- FOUND: `src/features/agents/agents.css`
- FOUND: `src/features/knowledge/knowledge.css`
- FOUND: `--status-running` token in `src/styles/tokens.css`
- FOUND: `agents` + `knowledge` namespace re-exports in `src/lib/tauri/index.ts`
- FOUND: commit `237ee30` (agents wrappers)
- FOUND: commit `cdb9388` (knowledge wrappers)
- FOUND: commit `f282f87` (index rewrites + placeholders + CSS + tokens + barrel)
- `npx tsc --noEmit`: clean
- `npm run verify:all`: 9/9 green
