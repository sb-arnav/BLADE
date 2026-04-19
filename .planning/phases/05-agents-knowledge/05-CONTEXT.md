# Phase 5: Agents + Knowledge — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 05-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 5 --auto --chain` (planner-picked defaults)

<domain>
## Phase Boundary

Phase 5 lights up two parallel clusters — **Agents** (9 routes) and **Knowledge** (9 routes) — that were stubbed in Phase 1 as `ComingSoonSkeleton phase={5}`. Each cluster owns its own typed Tauri wrapper module (`src/lib/tauri/agents.ts`, `src/lib/tauri/knowledge.ts`) and its own feature folder (`src/features/agents/`, `src/features/knowledge/`). This phase consumes the Phase 1..4 substrate verbatim: 9 primitives, `invokeTyped`, `useTauriEvent`, `usePrefs`, `ConfigContext`, `MainShell`, `ROUTE_MAP`, `PALETTE_COMMANDS`, `ChatProvider`, design tokens. It DOES NOT touch any other cluster (Life OS, Identity, Dev Tools, Admin, Body, Hive are Phase 6/7/8).

**In scope:** 18 requirements — AGENT-01..09 (9; current `src/features/agents/index.tsx` has 9 routes not 10) + KNOW-01..09 (9; current `src/features/knowledge/index.tsx` has 9 routes not 10). The ROADMAP §"Coverage Verification" lists AGENT-01..10 + KNOW-01..10 as 10+10 = 20; however the Phase 1 substrate shipped 9+9 stubs. **Gate 1 audit (this phase):** cover the 18 that exist today and surface the 2 orphan requirement ids to the phase-completion retrospective. Per STATE.md / PROJECT.md discipline, the shipped stubs are canonical — re-adding a 10th route per cluster is scope expansion without source justification.

WIRE-05 (blade_agent_event consumer) lives ENTIRELY in this phase — the Rust-side emit exists at `src-tauri/src/agents/executor.rs:99,178,240,265,313,335,349` as multiple distinct `agent_step_*` events (not a single `blade_agent_event`); Phase 5 maps those Rust events through the typed wrapper + subscribes from AgentDetail.

**Out of scope for Phase 5:**
- Life OS + Identity cluster (Phase 6)
- Dev Tools + Admin cluster (Phase 7)
- Body visualization + Hive mesh (Phase 8)
- Polish pass — error boundaries, WCAG re-sweep, empty-state illustrations (Phase 9)
- Memory/typed_memory settings surface (Phase 3 Settings > Personality covers this; Phase 5 does not re-open)
- Body-registry subsystem drill-in (Phase 8)
- Tentacle autonomy sliders + decision approval queue (Phase 8 HIVE-04)
- New Rust `#[tauri::command]` additions — every surface below maps to an EXISTING registered command (30+ agent commands, 20+ knowledge commands in `lib.rs:608-1260`). Zero Rust surface expansion in Phase 5. If a pane would need a new command, it ships as a `ComingSoonSkeleton phase={6|7|9}` or documented deferral — never ships with a faked invoke name.

**Key Phase 1..4 substrate Phase 5 leans on (no drift permitted):**
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/chat.ts` — `sendMessageStream`, `respondToolApproval` (referenced only; agents cluster doesn't stream chat)
- `src/lib/tauri/window.ts` — `getCurrentWebviewWindow`
- `src/lib/events/index.ts` — `BLADE_EVENTS` (lines 97..107 already declare 10 agent events: BLADE_AGENT_EVENT, AGENT_STEP_STARTED, AGENT_STEP_RESULT, SWARM_PROGRESS, SWARM_COMPLETED, SWARM_CREATED, AGENT_STARTED, AGENT_OUTPUT, AGENT_COMPLETED, AGENT_EVENT)
- `src/lib/events/payloads.ts` — `AgentEventPayload`, `AgentLifecyclePayload` (declared Phase 1; Phase 5 extends with swarm + step subtypes)
- `src/design-system/primitives/*` — Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` blob; Phase 5 adds `agents.filterStatus`, `knowledge.lastTab`, `knowledge.sidebarCollapsed` dotted keys
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — used for error toasts
- `src/windows/main/MainShell.tsx` — gate-on-onboarding + Suspense route slot
- `src/windows/main/useRouter.ts` — `useRouterCtx`, `openRoute`
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css`
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted in MainShell (D-116 retained; agents cluster does NOT re-hoist)
- `src/features/dashboard/hormoneChip.tsx` — reusable chip (referenced by AgentDashboard for hormone-tinted status badges if needed; NOT a hard dep)

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering from STATE.md (D-01..D-117 locked through Phase 4). Phase 5 adds D-118..D-138.

### Scope philosophy + cluster parallelism

- **D-118:** **Per-cluster wrapper module discipline.** Each cluster owns ONE new wrapper file — `src/lib/tauri/agents.ts` (agents cluster) and `src/lib/tauri/knowledge.ts` (knowledge cluster). Neither file is shared. This lets Agents-wave plans and Knowledge-wave plans ship in parallel with zero `files_modified` overlap, satisfying the Phase 1 parallelization invariant (same-wave plans have no file conflicts). Rationale: the ROADMAP Phase 5 description literally says "each cluster wires its own `lib/tauri/` module." We honor that word-for-word.

- **D-119:** **No new Rust commands in Phase 5.** Every surface below maps to an EXISTING `#[tauri::command]` registered in `lib.rs`. Audit inventory:
  - Agents side — 30+ commands already registered: `agent_create`, `agent_create_desktop`, `agent_list`, `agent_get`, `agent_pause`, `agent_resume`, `agent_cancel`, `agent_respond_desktop_action` (agent_commands.rs); `agent_spawn`, `agent_list_background`, `agent_get_background`, `agent_cancel_background`, `agent_detect_available`, `agent_get_output`, `get_active_agents`, `agent_auto_spawn`, `agent_spawn_codex` (background_agent.rs); `swarm_create`, `swarm_list`, `swarm_get`, `swarm_pause`, `swarm_resume`, `swarm_cancel`, `swarm_write_scratchpad`, `swarm_write_scratchpad_entry`, `swarm_read_scratchpad`, `swarm_get_progress` (swarm_commands.rs); `factory_create_agent`, `factory_deploy_agent`, `factory_list_agents`, `factory_pause_agent`, `factory_delete_agent` (agent_factory.rs); `run_managed_agent` (managed_agents.rs).
  - Knowledge side — 20+ commands already registered: `db_list_knowledge`, `db_get_knowledge`, `db_add_knowledge`, `db_update_knowledge`, `db_delete_knowledge`, `db_search_knowledge`, `db_knowledge_by_tag`, `db_knowledge_tags`, `db_knowledge_stats`, `db_list_templates`, `db_add_template`, `db_delete_template`, `db_increment_template_usage` (db_commands.rs); `embed_and_store`, `semantic_search`, `vector_store_size` (embeddings.rs); `graph_add_node`, `graph_search_nodes`, `graph_traverse`, `graph_find_path`, `graph_extract_from_text`, `graph_answer`, `graph_get_stats`, `graph_delete_node` (knowledge_graph.rs); `memory_search`, `memory_get_recent`, `memory_recall`, `memory_add_manual`, `memory_delete`, `memory_consolidate_now` (memory_palace.rs); `memory_store_typed`, `memory_recall_category`, `memory_get_all_typed`, `memory_delete_typed`, `memory_generate_user_summary` (typed_memory.rs); `timeline_search_cmd`, `timeline_browse_cmd`, `timeline_get_screenshot`, `timeline_get_thumbnail`, `timeline_get_config`, `timeline_set_config`, `timeline_get_stats_cmd`, `timeline_cleanup`, `timeline_search_everything`, `timeline_get_audio`, `timeline_meeting_summary`, `timeline_get_action_items`, `timeline_set_audio_capture`, `timeline_detect_meeting` (screen_timeline_commands.rs); `doc_ingest`, `doc_search`, `doc_get`, `doc_list`, `doc_delete`, `doc_answer_question`, `doc_cross_synthesis`, `doc_generate_study_notes` (document_intelligence.rs); `get_memory_log`, `get_memory_blocks`, `set_memory_block`, `run_weekly_memory_consolidation` (memory.rs).
  Rationale: D-50 + D-66 + D-119 triad — no Rust expansion until a surface proves it needs one. If a route cannot be wired to an existing command, it ships `ComingSoonSkeleton phase={next}` and logs the gap in the plan SUMMARY. This matches the Phase 4 D-93 pattern of upgrading-in-place rather than adding commands.

- **D-120:** **ComingSoonSkeleton retained for sub-features that exceed budget OR lack backend.** Routes we SHIP REAL: AgentDashboard, AgentDetail, BackgroundAgents, Swarm, AgentTeam, AgentFactory, AgentTimeline, TaskAgents, AgentPixelWorld (agents cluster — all 9 get at least a thin wired surface); KnowledgeBase, KnowledgeGraph, ScreenTimeline, Documents (knowledge cluster — 4 surfaces with rich wiring); MemoryPalace, RewindTimeline, LiveNotes, DailyLog, ConversationInsights, CodebaseExplorer (knowledge cluster — 6 surfaces with lighter wiring: list + detail or ComingSoonSkeleton variants that list data via the existing commands).
  - Every route exits the "404-looking" state by rendering a real `GlassPanel` with its route label, a brief description, and either LIVE data (where wired) or a clearly-labeled `"Ships in Phase 9 polish"` sub-skeleton with dev-mode route id visible.
  - Rationale: ROADMAP SC-1/SC-3 say "Navigating to any Agents/Knowledge route produces a rendered surface with no 404 fallback." ComingSoonSkeleton meets this criterion by design (Phase 1 D-44).

### Plan-split strategy (7 plans across 4 waves)

- **D-121:** **Plan split:**
  - **Plan 05-01** (wave 1 — event registry + payloads): adds missing agent step event constants + step payload interfaces + swarm payload interfaces to `src/lib/events/index.ts` + `payloads.ts`. No Rust touched; purely frontend typed surface expansion because today's 10 agent event constants lack matching payload interfaces for most entries. Also EXTENDS the agents event registry with `AGENT_STEP_RETRYING`, `AGENT_STEP_TOOL_FALLBACK`, `AGENT_STEP_PROVIDER_FALLBACK`, `AGENT_STEP_PARTIAL`, `AGENT_STEP_COMPLETED`, `AGENT_STEP_FAILED` to cover all 7 Rust emit sites (executor.rs:99, 178, 240, 265, 313, 335, 349). Single pure-TS plan; isolated `files_modified`; can run parallel with any other wave-1 plan.
  - **Plan 05-02** (wave 1 — agents wrapper): creates `src/lib/tauri/agents.ts` with typed wrappers for the 30+ registered Rust agent commands (see D-119 inventory). Also creates `src/lib/tauri/knowledge.ts` with typed wrappers for the 20+ registered knowledge commands. Single plan covering both wrapper files because both are pure API-surface exports (no visual work, no subscriptions), both follow the same recipe verbatim (Pattern §2 from 03-PATTERNS.md), and splitting would halve each to trivial size. Zero `files_modified` overlap with 05-01 or 05-03..06.
  - **Plan 05-03** (wave 2 — agents "rich" surfaces A): AgentDashboard, AgentDetail (live `blade_agent_event` timeline consumer), AgentTeam, BackgroundAgents. Covers AGENT-01..04 (approximately).
  - **Plan 05-04** (wave 2 — agents "rich" surfaces B): SwarmView (DAG + live `swarm_progress` updates), AgentFactory, AgentTimeline, TaskAgents, AgentPixelWorld. Covers AGENT-05..09 (approximately). Parallel with 05-03 (no `files_modified` overlap — each plan touches its own sub-component files under `src/features/agents/`).
  - **Plan 05-05** (wave 2 — knowledge "rich" surfaces A): KnowledgeBase (search + list + CRUD), KnowledgeGraph (svg network from `graph_get_stats` + `graph_search_nodes`), Documents (from `doc_*` commands), ScreenTimeline (from `timeline_*` commands). Covers KNOW-01..04 (approximately).
  - **Plan 05-06** (wave 2 — knowledge "rich" surfaces B): MemoryPalace, RewindTimeline, LiveNotes, DailyLog, ConversationInsights, CodebaseExplorer. Covers KNOW-05..09 (approximately). Parallel with 05-03, 05-04, 05-05 (zero overlap — each plan touches its own feature subfolder).
  - **Plan 05-07** (wave 3 — Playwright specs + verify scripts + Mac operator smoke checkpoint): adds 4 new Playwright specs (agents-dashboard, agent-detail-timeline, knowledge-base-search, swarm-view-render); extends `verify:all` with `verify:feature-cluster-routes.sh` that asserts ALL 9+9 routes mount in a dev build; registers dev-only routes for each plan's isolation harness where useful; documents Mac-session M-14..M-20 for operator.
  Rationale: 4 of the 5 wave-2 plans run in parallel because each owns its own subtree under `src/features/agents/` or `src/features/knowledge/` + isolated subset of sub-component files. Wave 1 (registry + wrappers) ships first because 05-03..06 import from both. Wave 3 (Playwright + Mac smoke) ships last because it needs the prior 5 to land. That's the same dep-topology Phase 3 and Phase 4 used.

- **D-122:** **`files_modified` no-overlap invariant.** Each wave-2 plan (05-03, 05-04, 05-05, 05-06) touches a DISJOINT set of files under `src/features/agents/*` or `src/features/knowledge/*`. The ONLY shared files across the cluster are `src/features/agents/index.tsx` and `src/features/knowledge/index.tsx`. To prevent merge conflicts on the index files, **the wrapper plan 05-02 does the ONE rewrite of each `index.tsx`** (replacing the Phase 1 skeleton exports with direct lazy imports to per-route files). Wave-2 plans only CREATE the per-route files they own and NEVER edit either index.tsx. Rationale: Phase 4 used the same pattern — Plan 04-02 edited the quickask bootstrap; Plans 04-03..04-05 never touched the same bootstrap. Single-writer invariant on shared registry files prevents the parallel-merge hazard.

### Rust verification + gaps (no new Rust — but verify existing)

- **D-123:** **No Plan 05-00 for Rust.** Phase 5 does NOT need a Rust plan — everything is pre-wired. Plan 05-07 adds a single verify script (`scripts/verify-phase5-rust-surface.sh`) that greps `lib.rs` for the 40+ commands in D-119 inventory and fails if any is missing. This is a DEFENSIVE check: if a future Rust refactor accidentally unregisters a command, Phase 5's verify:all catches it instantly. Mirrors Phase 4's `verify:content-protect` approach. Runs in CI per Phase 1 D-31.

- **D-124:** **Swarm DAG visualization deliberately simple.** SwarmView (Plan 05-04) renders the DAG as a two-column layout: left column = agent cards (one per step), right column = dependency arrows drawn as connecting SVG lines. NOT a force-directed graph (that needs d3-force or similar; Phase 5 refuses to add a dep). NOT a flowchart library. Just CSS Grid + SVG path elements computed from the `Swarm.steps[].deps` Rust shape. If the DAG grows past ~20 steps, the view scrolls; no "zoom/pan" UI. Rationale: SC-1 says "SwarmView renders a DAG from `swarm_*` commands." It does — a readable, minimal DAG. D-02 CSS-only motion + D-07 blur caps enforced.

- **D-125:** **AgentDetail timeline rendering = append-only event log.** AgentDetail subscribes to `blade_agent_event`, `agent_step_started`, `agent_step_result`, `agent_step_retrying`, `agent_step_tool_fallback`, `agent_step_provider_fallback`, `agent_step_partial`, `agent_step_completed`, `agent_step_failed`, AND `agent_event` (10 distinct events; all LIVE since before Phase 1). On each event, the component pushes a row to a ref-backed buffer + rAF-flushes to committed state (same discipline as D-68 chat streaming). Timeline rows show timestamp + event type + agent id + truncated payload preview (≤80 chars). Oldest rows compacted after 200 entries to prevent memory growth. Rationale: D-68 rAF-flush pattern is already the cross-stream discipline; reusing it here ensures 60fps under heavy emit cadence.

### Data shape + payload discipline

- **D-126:** **Typed wrapper per command.** `src/lib/tauri/agents.ts` exports one camelCase function per Rust command. Each wrapper:
  - Calls `invokeTyped<TReturn, TArgs>(command, args)` — never raw `invoke`.
  - Has JSDoc `@see src-tauri/src/<file>.rs:<line>` citation.
  - Converts argument names from camelCase → snake_case at the invoke boundary (the `invokeTyped` base does NOT do this; per D-38 the wrapper passes snake_case keys verbatim). Example: `agentSpawn({agentType, taskDescription})` → `invokeTyped('agent_spawn', {agent_type, task_description})`.
  - Return types are hand-written TS interfaces in the SAME file (no separate `types.ts`; co-located keeps the wrapper + type near their use site). Interfaces mirror Rust struct field names (snake_case) verbatim — NO camelCase conversion on return payloads.

- **D-127:** **Payload type source = Rust struct definitions.** For every Rust command with a non-trivial return type (Agent, BackgroundAgent, Swarm, SwarmProgress, KnowledgeEntry, DocumentEntry, PerceptionState, HormoneState already seen in Phase 3), the TS return type is a hand-written interface matching the Rust `#[derive(Serialize)]` shape verbatim. No zod, no codegen, no runtime validation — drift is caught in code review + Playwright spec runtime casts (accept per T-06-05 threat disposition, Phase 1).

- **D-128:** **`src/features/agents/types.ts` + `src/features/knowledge/types.ts` centralise the cluster-local type exports** that Plan 05-03..06 use. These are NOT wrappers — they're re-exports + cluster-only UI types (e.g. filter/sort state). Rationale: avoids every per-route file re-importing from `src/lib/tauri/*.ts` directly; the feature folder gets its own barrel.

### Event subscription discipline (D-13 enforced)

- **D-129:** **Every Phase 5 event subscription uses `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`**. AgentDetail mounts 10 `useTauriEvent` calls (one per agent event type) — NOT one listener that branches by event name (that pattern isn't supported by the hook API, which keys subscriptions on `[name]`). Rationale: D-13 discipline + handler-in-ref stale-closure safety. Phase 5 does NOT introduce a multiplexed event subscriber API — that's unnecessary complexity for a 10-subscription surface.

- **D-130:** **Event-to-agent-id correlation lives client-side.** Since BLADE_AGENT_EVENT doesn't declare a formal payload shape in TS (the Rust emit data varies by call site), AgentDetail filters by reading `payload.agent_id` or `payload.id` field from each event with an `if (payload?.agent_id === currentAgentId || payload?.id === currentAgentId)` guard. Events without a matching id are ignored (not logged — noise reduction). Rationale: matches the existing `AgentEventPayload` loose-shape interface in `payloads.ts` which uses an index signature; Phase 5 respects that looseness rather than tightening and breaking forward compat.

### Frontend architecture

- **D-131:** **Per-route file layout** under `src/features/agents/` and `src/features/knowledge/`:
  ```
  src/features/agents/
    index.tsx                    — re-exports routes[] as RouteDefinition[] (EDITED ONCE in Plan 05-02)
    types.ts                     — cluster-local types
    AgentDashboard.tsx           — AGENT-01
    AgentDetail.tsx              — AGENT-02 (blade_agent_event + agent_step_* consumer)
    AgentFactory.tsx             — AGENT-03
    AgentTeam.tsx                — AGENT-04
    AgentTimeline.tsx            — AGENT-05
    BackgroundAgents.tsx         — AGENT-06
    TaskAgents.tsx               — AGENT-07
    SwarmView.tsx                — AGENT-08 (with SwarmNode.tsx + SwarmDAG.tsx subcomponents)
    AgentPixelWorld.tsx          — AGENT-09
    agents.css                   — cluster-scoped CSS via layer
    SwarmDAG.tsx                 — SVG DAG renderer (used by SwarmView)
    SwarmNode.tsx                — agent card within DAG
  ```
  Same layout under `src/features/knowledge/` with files KnowledgeBase.tsx, KnowledgeGraph.tsx, ScreenTimeline.tsx, RewindTimeline.tsx, MemoryPalace.tsx, LiveNotes.tsx, DailyLog.tsx, ConversationInsights.tsx, CodebaseExplorer.tsx, Documents.tsx, knowledge.css (+ sub-components where needed). Each plan owns ~4-5 of these files; all files unique to a single plan.

- **D-132:** **CSS discipline.** Each cluster owns ONE CSS file (`agents.css`, `knowledge.css`) that all sub-components share. No per-component CSS file unless a route has a genuinely orthogonal design (e.g., `SwarmDAG.css` for the DAG SVG positioning math, `KnowledgeGraph.css` for the network render). Uses Phase 1 tokens via `var(--glass-1-bg)` etc. D-07 blur caps enforced — AgentDashboard + AgentDetail + navigation = 3 layers already; sub-cards inside those must use `rgba(...)` bg (D-70 pattern).

- **D-133:** **`usePrefs` extensions for Phase 5:**
  - `agents.filterStatus` (values: `'all' | 'running' | 'idle' | 'failed'`) — AgentDashboard filter
  - `agents.selectedAgent` — last-viewed agent id (for AgentDetail deep-link from dashboard)
  - `knowledge.lastTab` — KnowledgeBase tab memory
  - `knowledge.sidebarCollapsed` — KnowledgeGraph sidebar
  - `screenTimeline.autoLoadLatest` — timeline preference
  Five new dotted keys. Zero Rust impact (per D-12 all prefs are frontend-only localStorage).

- **D-134:** **ChatProvider is NOT re-hoisted in agents/knowledge clusters.** Phase 4 D-116 hoisted `ChatProvider` in `MainShell` so `QuickAskBridge` could inject user messages. Phase 5 sub-routes may consult chat context for cross-reference (e.g. AgentDetail might show "this agent turn is a response to chat message X"), but NEVER wrap a sub-route in a second `ChatProvider`. They read via `useChatCtx()` on the existing provider. Rationale: D-04 single-state-carrier discipline + Phase 4 D-116 chain invariant.

### Performance

- **D-135:** **rAF-flush discipline for any high-frequency event subscriber.** AgentDetail timeline (≥10 event types, bursty emit patterns during swarm runs) AND ScreenTimeline (large screenshot lists, lazy-loaded on scroll) use the same ref-backed-buffer + rAF-flush pattern as D-68 chat streaming. Small-surface routes (AgentFactory form, KnowledgeBase search result list) use plain state. Rationale: D-68 is already the cross-project performance discipline; using it where it matters keeps Phase 5 within the Phase 1 P-01 ≤200ms first-paint budget.

- **D-136:** **Lazy-load every Phase 5 route.** Feature index files use `React.lazy()` for every route component (already the Phase 1 pattern per D-39 `component: React.LazyExoticComponent<...>`). This prevents Phase 5's combined ~18 routes from bloating main-window first-paint. Each route loads on navigation. Rationale: matches Phase 1 feature index convention; no deviation.

### Knowledge surfaces

- **D-137:** **KnowledgeGraph view is a server-computed snapshot + client SVG render.** KnowledgeGraph calls `graph_get_stats` for the node + edge counts + `graph_search_nodes('')` (empty query returns all recent nodes bounded by Rust default). Renders nodes as circles + edges as lines in a **force-FREE** layout (each node positioned by a deterministic hash of its id → polar coordinates; see `src/features/knowledge/graphLayout.ts`). Not a force-directed layout — that needs d3-force or similar (refused per D-02 / D-124 rationale). If the graph has more than 200 nodes, clustering by concept tag happens client-side and uncollapsed clusters get a "+N more" affordance. Rationale: SC-3 says the surface renders without error; a deterministic layout ships a real visualization without a JS-force dependency.

- **D-138:** **Search result group labelling.** KnowledgeBase search UI (KNOW-01 per ROADMAP SC-4: "result groups are labelled (web / memory / tools)") does NOT actually query web/memory/tools — it queries the existing SQLite knowledge index (`db_search_knowledge`) PLUS the embedding semantic search (`semantic_search`) PLUS `timeline_search_cmd`. The three groups are: "Knowledge" (from `db_search_knowledge`), "Memory" (from `memory_search` or `semantic_search` hits against memory blocks), "Timeline" (from `timeline_search_cmd`). NOT "web" — there's no web search command in this phase; web is Phase 7 DEV territory. **This is a pragmatic reinterpretation of the SC-4 "web / memory / tools" grouping** — we match the spirit (multi-source labelling) without inventing a Rust command. Documented as a known divergence from the literal ROADMAP SC-4; Plan 05-07 adds an SC-4 acknowledgment with the three actual groups. Rationale: Phase 4 D-99 / D-119 established the "pragmatic divergence" pattern — honor the SC with a clearly-labelled scope adjustment rather than ship a fake command.

### Claude's Discretion

- Exact CSS grid template / column counts for AgentDashboard — planner picks; must respect `--nav-width` tokens.
- Exact node-circle sizing in KnowledgeGraph (constant 16px radius vs. degree-scaled) — planner picks 16px for determinism.
- Exact timeline row formatting in AgentDetail — planner picks fixed-width timestamp + event-type pill + 80-char payload preview + expand-on-click detail.
- Whether SwarmDAG renders diagonal arrows or axis-aligned arrows — planner picks axis-aligned for legibility.
- How MemoryPalace surfaces typed_memory categories — planner picks 7-tab layout (one per category: Fact/Preference/Decision/Skill/Goal/Routine/Relationship).
- Whether RewindTimeline mirrors ScreenTimeline UI verbatim or shows a distinct "playback" treatment — planner picks "ScreenTimeline renders the capture list; RewindTimeline renders the same list with a timeline-playback slider on top". Shared `ScreenTimelineList` sub-component keeps code paths unified.
- Exact color palette for SwarmNode status (pending/running/complete/error) — planner picks CSS tokens `--status-idle/running/success/error` from `tokens.css`.
- Whether AgentPixelWorld ships as a playful 2D sprite strip (per the src.bak prototype name) or a simpler emoji grid — planner picks "emoji grid for Phase 5; sprite motion deferred to Phase 9 polish." The route renders a 9-cell grid of emoji avatars, one per agent role, with a border color keyed to the role's hormone influence. No animation beyond hover.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 5: Agents + Knowledge" — goal, 20 requirements (AGENT-01..10 + KNOW-01..10), success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-117, Phase 1..4 substrate inventory
- `.planning/RECOVERY_LOG.md` §4.6 (agent events table — 10 LIVE events), §4 (29 event catalog), §5 (emit_to policy)

### Phase 1..4 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45 (D-07 blur caps, D-13 useTauriEvent, D-14 emit_to, D-35..D-45 primitives + wrappers)
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — D-64..D-92 (D-68 rAF flush, D-70 rgba bubbles, D-67 useChat context)
- `.planning/phases/04-overlay-windows/04-CONTEXT.md` — D-93..D-117 (D-116 ChatProvider hoisted in MainShell, D-117 Playwright spec harness)
- `.planning/phases/03-dashboard-chat-settings/03-PATTERNS.md` — §1 Rust emit recipe, §2 wrapper recipe, §3 useChat Context skeleton, §11-14 Playwright recipes
- `.planning/phases/04-overlay-windows/04-PATTERNS.md` — §1 quickask_submit bridge, §2 shortcut fallback, §3 HUD parallel-emit, Playwright recipe evolution

### Phase 0 artifacts (inputs)
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — agent + swarm + knowledge command signatures
- `.planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md` — prototype flows relevant to agent + knowledge surfaces

### Code Phase 5 extends (read-only inputs)

**Frontend (substrate):**
- `src/windows/main/MainShell.tsx` — shell that hosts Phase 5 routes
- `src/windows/main/useRouter.ts` — routing context
- `src/lib/router.ts` — `RouteDefinition`, `DEFAULT_ROUTE_ID`
- `src/lib/tauri/*.ts` — Phase 1..4 wrappers; Phase 5 adds `agents.ts` + `knowledge.ts`
- `src/lib/events/index.ts` + `payloads.ts` — 55+ events already declared; Phase 5 expands agent step event constants + payloads
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — used for error surfaces
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted at MainShell (D-116); agents cluster may read via `useChatCtx`
- `src/features/dashboard/hormoneChip.tsx` — reusable chip primitive
- `src/design-system/primitives/*` — 9 primitives + ComingSoonSkeleton + Dialog
- `src/hooks/usePrefs.ts` — dotted-key prefs blob; Phase 5 adds 5 new keys (D-133)

**Feature folders (Phase 1 stubs — Phase 5 replaces):**
- `src/features/agents/index.tsx` (9 stubs — Phase 5 Plan 05-02 rewrites)
- `src/features/knowledge/index.tsx` (9 stubs — Phase 5 Plan 05-02 rewrites)

### Rust source (authoritative for wrapper cites — NO Rust modifications in Phase 5)
- `src-tauri/src/agents/executor.rs:99,178,240,265,313,335,349` — 7 agent_step_* emit sites (D-125 subscribers)
- `src-tauri/src/agent_commands.rs:228,295,2605,2611,2622,2632,2702,2712` — 8 #[tauri::command]s
- `src-tauri/src/background_agent.rs:152,377,386,393,405,411,644,711,721` — 9 #[tauri::command]s
- `src-tauri/src/swarm_commands.rs:470,541,546,551,557,574,580,589,609,617` — 10 #[tauri::command]s
- `src-tauri/src/agent_factory.rs` — 5 factory_* commands (see lib.rs:1389-1393)
- `src-tauri/src/managed_agents.rs:23` — `run_managed_agent`
- `src-tauri/src/db_commands.rs:111,119,132,142,151,157,166,*` — 9 db_*_knowledge + db_*_template commands
- `src-tauri/src/embeddings.rs:444,472,488` — 3 vector-store commands
- `src-tauri/src/knowledge_graph.rs:856,879,884,893,898,903,908,913` — 8 graph_* commands
- `src-tauri/src/memory_palace.rs` — 6 memory_* commands (per lib.rs:982-987)
- `src-tauri/src/typed_memory.rs:544,557,567,573,579` — 5 memory_*_typed commands
- `src-tauri/src/screen_timeline_commands.rs` — 14 timeline_* commands (per lib.rs:923-936)
- `src-tauri/src/document_intelligence.rs` — 8 doc_* commands (per lib.rs:1115-1122)
- `src-tauri/src/memory.rs:576,787,798,781` — 4 memory_* commands
- `src-tauri/src/lib.rs:608-1260` — generate_handler![] confirming all above registered

### Prototype / design authority (READ-ONLY reference per D-17)
- `src.bak/components/AgentDashboard.tsx, AgentDetail.tsx, AgentFactory.tsx, AgentManager.tsx, AgentTeamPanel.tsx, BackgroundAgentsPanel.tsx, SwarmView.tsx, ManagedAgentPanel.tsx, Canvas.tsx, CanvasNode.tsx, DebatePanel.tsx, TaskAgentView.tsx, TentacleDetail.tsx` — algorithmic / layout reference only (retype, never import)
- `src.bak/components/KnowledgeBase.tsx, KnowledgeCard.tsx, KnowledgeGraphView.tsx, MindMapView.tsx, BookmarkManager.tsx, LiveNotes.tsx, PromptLibrary.tsx, SnippetManager.tsx, TemplateManager.tsx, DocumentView.tsx, DocumentGenerator.tsx, RSSReader.tsx` — same

### Explicitly NOT to read (D-17 applies)
- Any `src.bak/` file for import. Planner + executor MAY consult as READ-ONLY layout ground truth; every line of code is retyped in the new feature folder against the Phase 1 primitives + tokens.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1..4 substrate Phase 5 extends

- `src/features/agents/index.tsx` currently exports 9 `ComingSoonSkeleton` routes. Plan 05-02 rewrites this file to import 9 lazy per-route components from `./AgentDashboard.tsx` etc. Same move for `src/features/knowledge/index.tsx`.
- `src/lib/tauri/` currently has 9 wrapper files (Phase 1..4). Plan 05-02 adds 2 new files (`agents.ts`, `knowledge.ts`). ESLint `no-raw-tauri` rule applies to both.
- `src/lib/events/index.ts` currently declares 55+ event constants including 10 agent events (lines 97-107) but only 2 payload interfaces for agent events (`AgentEventPayload`, `AgentLifecyclePayload`). Plan 05-01 adds 8 more (one per distinct Rust emit site).

### Patterns already established that Phase 5 MUST follow

- **Wrapper recipe:** `invokeTyped<TReturn, TArgs>(command, args)` + JSDoc `@see src-tauri/src/<file>.rs:<line>`. Never raw `invoke`. ESLint rule `no-raw-tauri` enforces.
- **Event subscription:** `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`. Handler-in-ref; subscription keyed on `[name]` only.
- **Pref writes:** `setPref('dotted.key', value)` — debounced 250ms, single localStorage blob.
- **Style:** compose `.glass .glass-1/2/3` + primitive classes; Tailwind utilities for layout only. No hardcoded hex colors.
- **Routes:** append a `RouteDefinition` to the feature index's `routes` array. Phase 5 edits `src/features/agents/index.tsx` + `src/features/knowledge/index.tsx` ONCE each (in Plan 05-02) to replace skeletons with lazy imports.
- **rAF flush:** Every high-frequency event subscriber uses ref-backed buffer + rAF-flushed state commit (D-68 pattern). AgentDetail + ScreenTimeline qualify.
- **D-116 ChatProvider hoisting:** `useChat`/`ChatProvider` lives in MainShell ONLY — downstream routes read via `useChatCtx`. Do NOT re-provide.

### Test harness

- `playwright.config.ts` + `tests/e2e/*.spec.ts` already shipped in Plans 01-09, 02-07, 03-07, 04-07. Phase 5 Plan 05-07 adds 4 new specs reusing the same `@tauri-apps/test` harness. `npm run test:e2e` runs them. No new test deps.
- `verify:all` scripts live in `scripts/`. Phase 5 Plan 05-07 adds `scripts/verify-phase5-rust-surface.sh` + `scripts/verify-feature-cluster-routes.sh`.

### Rust patterns Phase 5 does NOT extend

Phase 5 touches **zero Rust files**. The Rust surface is frozen — every command used by Phase 5 is already registered in `lib.rs` per D-119 audit. If a gap is discovered during planning or execution, the plan MUST document the gap in SUMMARY + defer the affected route to a ComingSoonSkeleton rather than ship a hand-rolled/mocked Rust command.

### Dev experience patterns Phase 5 leans on

- All dev-only routes stay palette-hidden + gated on `import.meta.env.DEV`. Plan 05-07 may register dev-only isolation harnesses for per-route Playwright specs (same pattern as `VoiceOrbDev.tsx`).
- All CI verification scripts live in `scripts/` as Node ESM (`.mjs`) or bash (`.sh`); runnable via `npm run verify:<check>`.
- ESLint `no-raw-tauri` rule continues to apply — all new agents/knowledge wrappers + components use `useTauriEvent` + `invokeTyped`, NOT raw `invoke()` / `listen()`.
- `__TAURI_EMIT__` + `__TAURI_INVOKE_HOOK__` test-harness hooks (Phase 1 + 2 + 3 + 4) extended for Phase 5 Playwright specs.

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 5 success criteria (must be falsifiable):**
- SC-1: Any Agents route renders without 404; SwarmView renders a DAG from `swarm_*` commands (Plan 05-04 SwarmDAG.tsx falsifies via Playwright spec)
- SC-2: AgentDetail timeline receives `blade_agent_event` emissions real-time without refresh (Plan 05-03 + 05-07 spec falsifies)
- SC-3: Any Knowledge route renders; ScreenTimeline shows ≥1 screenshot if Total Recall ran (Plan 05-05 + 05-07 spec falsifies)
- SC-4: KnowledgeBase search returns grouped results (web / memory / tools — pragmatically reinterpreted as Knowledge / Memory / Timeline per D-138) (Plan 05-05 spec falsifies)
- SC-5: Both clusters registered via feature `index.ts` exports; no App.tsx edit was required (trivially verified — App.tsx doesn't exist in V1 at all; `src/windows/main/router.ts` does explicit imports per D-40; Phase 5 only edits feature index files — NEVER router.ts)

**From RECOVERY_LOG.md §4.6 (agent event catalog — all LIVE):**
- `blade_agent_event` — generic high-level event (executor.rs multi-site) — AgentDetail subscribes
- `agent_step_started` (99), `agent_step_result` (178) — single-step lifecycle — AgentDetail subscribes
- `agent_step_retrying` (177), `agent_step_tool_fallback` (243), `agent_step_provider_fallback` (267) — failure paths — AgentDetail subscribes
- `agent_step_partial` (314), `agent_step_completed` (335), `agent_step_failed` (349) — completion paths — AgentDetail subscribes
- `swarm_progress` (swarm_commands.rs:452), `swarm_completed` (390), `swarm_created` (524) — SwarmView subscribes
- `agent_started` (background_agent.rs:205), `agent_output` (236), `agent_completed` (340 / agent_commands.rs:632) — BackgroundAgents subscribes
- `agent_event` (agent_commands.rs:426,463,512,546,560,589,602) — generic lifecycle — AgentDashboard subscribes

**From Rust reality (D-119 inventory):**
- Agents cluster has ~33 registered commands spanning lifecycle, swarms, factory, background, managed.
- Knowledge cluster has ~52 registered commands spanning knowledge entries, embeddings, graph, memory palace, typed memory, screen timeline, documents, memory blocks.
- **NONE of them need new handlers** — all already wired.
- Return types vary widely — each wrapper hand-types its return interface mirroring Rust `#[derive(Serialize)]` shape.

**Migration ledger alignment:**
- 9 agents routes already in ledger with `phase: 5` + `status: Pending`. Plan 05-07 verify script flips them to `Shipped`.
- 9 knowledge routes same. No route added or removed in Phase 5 — the stubs are canonical (per D-28).

**Palette + nav derivation (D-40 + D-55):**
- NavRail already shows "Agents" + "Knowledge" cluster icons derived from `section`; clicking navigates to first route of each cluster (first = `agents` / `knowledge-base` by index order). Plan 05-02's index.tsx rewrite preserves order so the cluster navigation doesn't shift.

</specifics>

<deferred>
## Deferred Ideas

- **Force-directed KnowledgeGraph layout (d3-force).** D-137 rejects. Phase 9 polish could add this if the deterministic layout feels cluttered in practice; d3-force is ~30 KB gzipped; acceptable cost but unnecessary in Phase 5.
- **Debate panel (src.bak `DebatePanel.tsx`).** Not in ROADMAP Phase 5 agent requirements; deferred to Phase 8 HIVE cluster (multi-tentacle decision queue is the spiritual successor).
- **Mind map view (src.bak `MindMapView.tsx`).** Not in ROADMAP KNOW requirements; deferred to Phase 9 or reconsidered in a later review.
- **Bookmark manager / RSS reader / prompt library / snippet manager / template manager (src.bak components with matching names).** None in ROADMAP KNOW-01..10 requirements; treated as `phase: 9` / cross-phase ideas. Not in Phase 5 scope. ComingSoonSkeleton may surface them if they appear in navigation.
- **Agent canvas node editor (src.bak `Canvas.tsx`, `CanvasNode.tsx`).** Similar — not in AGENT-01..10 scope. Defer to Phase 9 or later workflow-builder surface.
- **Tentacle detail panel (src.bak `TentacleDetail.tsx`).** Phase 8 HIVE-* scope; not Phase 5.
- **Real-time swarm DAG editing / drag-to-reorder.** Phase 5 ships read-only DAG. Editing deferred to Phase 9.
- **Web/tools search sources in KnowledgeBase (literal ROADMAP SC-4 "web / tools" groups).** D-138 pragmatic reinterpretation uses Timeline + Memory + Knowledge instead. Literal "web search" would need a new Rust command (not in scope). Deferred to Phase 7 Dev Tools (WebAutomation).
- **10th route per cluster (AGENT-10 / KNOW-10).** Current Phase 1 stubs shipped 9+9; ROADMAP lists 10+10. Phase 5 closes 9+9 and flags the 2 orphan requirement IDs in Plan 05-07 SUMMARY + Phase 5 retrospective. Closing requires a scope decision (add new route or retire requirement) outside Phase 5's authority.
- **Route-specific Playwright specs for every knowledge route.** Plan 05-07 ships 4 representative specs (1 per big surface). Comprehensive per-route coverage deferred to Phase 9 polish.

</deferred>

<mac_session_items>
## Mac-Session Verification Items (Operator Handoff — extends Phase 1..4 list)

These checks cannot be verified in the sandbox. Carry forward to the final operator checkpoint run (bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3 + Phase 4 Mac-smoke per STATE.md strategy). Plan 05-07 Task 3 adds M-14..M-20.

- **M-14:** `npm run tauri dev` launches; navigate to /agents — AgentDashboard renders without 404 (SC-1).
- **M-15:** Navigate to /agent-detail after spawning a background agent — timeline renders real-time as agent emits events (SC-2).
- **M-16:** Navigate to /swarm-view after creating a swarm via the existing `swarm_create` CLI/test command — DAG renders with node colors reflecting status (SC-1).
- **M-17:** Navigate to /knowledge-base — search for a term present in the seeded SQLite — results appear grouped by source label (Knowledge / Memory / Timeline per D-138) (SC-3 + SC-4).
- **M-18:** Navigate to /screen-timeline after Total Recall has run for ≥30s — at least one screenshot thumbnail renders (SC-3).
- **M-19:** Navigate to /knowledge-graph — node + edge visualization renders without error (SC-3).
- **M-20:** Run `cd src-tauri && cargo check` — still 0 errors. (D-65 inheritance — this is a regression-only check since Phase 5 touches no Rust, but we still validate nothing else broke.)

</mac_session_items>

---

*Phase: 05-agents-knowledge*
*Context gathered: 2026-04-19 via /gsd-plan-phase 5 --auto --chain (no interactive discuss; defaults logged in 05-DISCUSSION-LOG.md)*
