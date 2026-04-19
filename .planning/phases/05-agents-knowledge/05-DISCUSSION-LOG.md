# Phase 5 — Discussion Log (AUTO MODE — no interactive session)

**Invocation:** `/gsd-plan-phase 5 --auto --chain`
**Date:** 2026-04-19
**Mode:** Planner picks defensible defaults to maintain phase velocity. All defaults are logged here, and every new decision also lands in `05-CONTEXT.md` as `D-118..D-138`.

Prior locked decisions `D-01..D-117` (Phase 1–4 CONTEXT files) are treated as non-negotiable constraints. This log captures only the NEW choices the planner made for Phase 5.

---

## Source inputs consulted

- `.planning/ROADMAP.md` Phase 5 §Requirements (AGENT-01..10 + KNOW-01..10) + §Success Criteria 1–5
- `.planning/STATE.md` — Phase 1..4 substrate inventory, blockers, WIRE table (WIRE-05 ← Phase 5 consumer)
- `.planning/RECOVERY_LOG.md` §4.6 agent events table (10 LIVE events); §4 event catalog
- `.planning/phases/01-foundation/01-CONTEXT.md` — locked D-01..D-45
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — locked D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — locked D-64..D-92 (esp. D-68 rAF flush, D-70 rgba bubbles, D-67 useChat context)
- `.planning/phases/04-overlay-windows/04-CONTEXT.md` — locked D-93..D-117 (esp. D-116 ChatProvider hoisted at MainShell)
- `.planning/phases/03-dashboard-chat-settings/03-PATTERNS.md` + `04-PATTERNS.md` — wrapper recipe, useTauriEvent recipe, Playwright harness evolution
- `src/features/agents/index.tsx` + `src/features/knowledge/index.tsx` — current Phase 1 stubs (9+9, NOT 10+10 per ROADMAP)
- `src/lib/events/index.ts` + `src/lib/events/payloads.ts` — Phase 1..4 event surface
- `src/lib/tauri/*.ts` — 9 existing wrapper files
- `src-tauri/src/lib.rs` — 40+ agent + knowledge command registrations (`generate_handler![]` lines 608-1260)
- `src-tauri/src/agents/executor.rs` — 7 `agent_step_*` emit sites (99, 178, 240, 265, 313, 335, 349)
- `src-tauri/src/swarm_commands.rs` — 10 `#[tauri::command]`s at lines 470..617
- `src-tauri/src/background_agent.rs`, `agent_commands.rs`, `managed_agents.rs`, `agent_factory.rs` — ~30 more agent commands
- `src-tauri/src/knowledge_graph.rs`, `memory_palace.rs`, `typed_memory.rs`, `embeddings.rs`, `screen_timeline_commands.rs`, `document_intelligence.rs`, `db_commands.rs`, `memory.rs` — ~50 knowledge commands
- `src.bak/components/{Agent*,Knowledge*,Swarm*,Document*,...}.tsx` — READ-ONLY layout reference per D-17; no imports

---

## Decision points + planner choices

### DP-1: How many plans + what wave structure?

**Options considered:**
- (a) 1 monolithic plan per cluster (2 plans). Rejected — exceeds 3-task per-plan discipline; each cluster has 9 routes = >>3 tasks.
- (b) 1 plan per route (18 plans). Rejected — over-fragmentation; wrapper + route are coupled; excessive orchestration overhead.
- (c) 7 plans: 1 event-registry + 1 wrappers + 4 UI (agents A/B + knowledge A/B) + 1 Playwright/verify (CHOSEN).
- (d) 6 plans (merge event-registry into wrappers). Rejected — event registry touches different `files_modified` than wrappers; keeping separate gives a clean wave-1 parallel slot and cleaner Playwright surface.

**Choice:** 7 plans across 4 waves (D-121). Wave 1 = 05-01 + 05-02 in parallel (no file overlap). Wave 2 = 05-03 + 05-04 + 05-05 + 05-06 in parallel (all 4 route-ship plans disjoint file sets). Wave 3 = 05-07 (Playwright + Mac smoke).

**Trade-off accepted:** 4-wide wave 2 is the largest concurrent fan-out since Phase 1's 3-wide wave 1. Coordination cost = one more files_modified audit pass in gate 3. Worth it — cluster parallelism is the Phase 5 point.

---

### DP-2: Rust plan — yes or no?

**Options:**
- (a) Dedicate Plan 05-00 to Rust for WIRE-05 final wiring. Rejected — Phase 3 already emitted all 7 `agent_step_*` events verbatim (executor.rs lines 99/178/240/265/313/335/349). Phase 5 consumes those. Zero net Rust changes.
- (b) Leave Rust alone, add a DEFENSIVE verify script. Chosen. Plan 05-07 ships `scripts/verify-phase5-rust-surface.sh` that greps `lib.rs` for all 40+ commands in the D-119 inventory and fails if any is missing. Plus `cargo check` stays as the Mac-operator check (M-20).

**Choice:** No Rust plan (D-123). One verify script in Plan 05-07.

**Trade-off accepted:** If a Phase 5 UI plan discovers a genuinely-missing Rust command mid-execution, it gets a `ComingSoonSkeleton phase={next}` + SUMMARY-noted gap instead of inline Rust work. This mirrors Phase 4's D-99 pattern (slash commands deferred) and D-119's no-expansion discipline.

---

### DP-3: Honour ROADMAP 10+10 vs ship 9+9?

The ROADMAP lists AGENT-01..10 + KNOW-01..10. The current `src/features/agents/index.tsx` + `knowledge/index.tsx` have 9 stubs each. Options:

- (a) Add a 10th route to each cluster to match ROADMAP. Rejected — the 10th route has no source justification (Phase 1 team chose 9 for each cluster when allocating 59/82 routes). Adding a route = scope expansion without source artifact backing. Per D-17, src.bak isn't canonical.
- (b) Ship 9+9 (the shipped stubs) + surface the orphan in Plan 05-07 SUMMARY. Chosen. Retrospective + STATE.md note gets written at phase close.

**Choice:** 9+9 route coverage (D-120 + D-133 migration ledger). Orphan requirement IDs `AGENT-10` and `KNOW-10` flagged in Plan 05-07 SUMMARY for decision outside Phase 5.

**Trade-off accepted:** Phase 5 closes 18/20 ROADMAP Phase 5 requirements instead of 20/20. This is an honest ledger; closing with fake stubs for 2 unplanned routes would violate D-119 (no Rust) + D-120 (only ship what the source supports).

---

### DP-4: KnowledgeBase SC-4 "web / memory / tools" group labelling

The literal ROADMAP SC-4 says results are "labelled (web / memory / tools)." Observations:
- There is no `web_search` Rust command registered in Phase 5.
- There is no `tools_search` Rust command — "tools" could map to native_tools output but that's not a search surface.
- Available grouped sources: `db_search_knowledge` (Knowledge entries), `memory_search` / `semantic_search` (Memory blocks + vectors), `timeline_search_cmd` (screen timeline — "what BLADE saw").

**Options:**
- (a) Stub "web" + "tools" source groups with zero results. Rejected — ships a fake UI; violates PROJECT.md "no orphan screens, no dead buttons."
- (b) Invent new Rust commands (web search + tools search). Rejected per D-119 — would cost a new Rust plan + ambiguous scope.
- (c) Pragmatic reinterpretation: 3 groups are Knowledge / Memory / Timeline (the ACTUAL available searches), document the divergence (CHOSEN).

**Choice:** D-138. Plan 05-05 ships 3-group labelling; Plan 05-07 SUMMARY documents the divergence + adds SC-4 acknowledgement language in the retrospective.

**Trade-off accepted:** Literal SC-4 word "web / tools" not met; meaning-SC-4 (multi-source grouped search) met. This is the same "pragmatic SC interpretation" pattern Phase 4 D-99 (slash commands deferred) + Phase 3 D-50 (use existing commands) used. Documented divergence is better than inventing fake infrastructure.

---

### DP-5: SwarmView DAG rendering approach

**Options:**
- (a) Force-directed graph (d3-force or similar). Rejected — new dep, D-02 "CSS-only motion" spirit, perf unknowns on integrated GPU.
- (b) Grid-layout with CSS grid + SVG connection lines (CHOSEN). Deterministic, no external libs, D-07-friendly (no backdrop-filter in DAG itself), readable to ~20 nodes.
- (c) External iframe to a dagre-wasm library. Rejected — embeds rendering outside React tree, breaks Playwright spec assertion on `[data-status]` attributes.

**Choice:** (b) (D-124). Columns per topological layer, SVG paths for edges, node cards are glass tier-2 panels.

---

### DP-6: AgentDetail real-time event discipline

**Options:**
- (a) One multiplexed listener branching on event name. Rejected — `useTauriEvent` hook is keyed on `[name]`; no such API.
- (b) 10 parallel `useTauriEvent` subscriptions with a shared ref-backed event buffer + rAF flush (CHOSEN). D-68 pattern verbatim.
- (c) Plain state push per event. Rejected — 10 events firing during a swarm run exceeds 16ms frame budget.

**Choice:** (b) (D-125 + D-129 + D-135). One subscription per event name, each handler pushes to a shared ref buffer, single rAF loop flushes to committed timeline state.

---

### DP-7: Cluster-scoped wrapper vs. single giant wrapper

**Options:**
- (a) One `src/lib/tauri/phase5.ts` for all commands. Rejected — violates ROADMAP "each cluster wires its own lib/tauri module" wording.
- (b) Two files — `agents.ts` + `knowledge.ts` (CHOSEN). Each cluster plan imports from its own wrapper. Zero cross-cluster coupling.

**Choice:** (b) (D-118). Plan 05-02 ships both; Plan 05-03/05-04 import only from `agents.ts`; Plan 05-05/05-06 import only from `knowledge.ts`.

---

### DP-8: KnowledgeGraph layout when force-directed is ruled out

Same constraint as DP-5. Options:
- (a) Concentric circles by hash → polar coordinates (CHOSEN). `hash(id) → (r, θ)` deterministic.
- (b) Grid by concept tag. Rejected — clusters nodes visually but occludes cross-tag edges.
- (c) Disk sunburst (concept tag → wedge). Rejected — edges become arcs; edge overlap worse than (a).

**Choice:** (a) (D-137). If node count > 200, cluster by concept tag with uncollapse affordance.

---

### DP-9: AgentPixelWorld interpretation

src.bak had `AgentPixelWorld.tsx`. Name hints at a playful 2D/sprite surface. ROADMAP says only "Pixel World" label. Options:
- (a) 2D sprite strip with pixel-art avatars. Rejected for Phase 5 — pixel art assets don't exist, motion needs Phase 9 polish pass.
- (b) 9-cell emoji grid, one per agent role, hormone-tinted border (CHOSEN). Ships a recognizable surface without art debt.

**Choice:** (b) (D-138 Claude's Discretion section). Phase 9 can swap to real sprites.

---

### DP-10: Memory Palace tab organization

typed_memory.rs defines 7 categories (Fact/Preference/Decision/Skill/Goal/Routine/Relationship). Options:
- (a) Single list, category-pill filter. Rejected — categories are primary navigation in this view.
- (b) 7 tabs (CHOSEN), one per category, each tab shows `memory_recall_category(category)` results.

**Choice:** (b) (D-138 Claude's Discretion section).

---

## Source audit summary

- **GOAL:** Each surface routable; live event subscriptions; DAG renders; search results grouped. Addressed by D-118..D-138 + Plan 05-01..05-07.
- **REQ:** AGENT-01..09 + KNOW-01..09 mapped to plans. 2 orphans (AGENT-10 + KNOW-10) flagged (DP-3).
- **RESEARCH:** No Phase 5 research artifact (no `.planning/research/` folder path). ROADMAP + RECOVERY_LOG + prior-phase CONTEXT files are the research surface.
- **CONTEXT:** Phase 1..4 CONTEXT files' D-01..D-117 respected verbatim. No D-XX conflicts found.

Every item either mapped to a plan, explicitly deferred (see `05-CONTEXT.md <deferred>`), or flagged as orphan for phase-close retrospective. No silent omissions.

---

## Orphan Requirements flagged

- **AGENT-10** — no 10th agents route in Phase 1 substrate; source (`src/features/agents/index.tsx`) has 9. Decision pending outside Phase 5.
- **KNOW-10** — no 10th knowledge route in Phase 1 substrate; same. Decision pending outside Phase 5.

These are captured in Plan 05-07's SUMMARY template + must be raised at phase-close retrospective.

---

## Plan count final tally

- **Plan 05-01** — wave 1, TS pure (event registry + payload types). Autonomous.
- **Plan 05-02** — wave 1, TS pure (2 wrapper files + 2 index.tsx rewrites + types.ts × 2). Autonomous.
- **Plan 05-03** — wave 2, agents rich subset A (4 routes). Autonomous.
- **Plan 05-04** — wave 2, agents rich subset B (5 routes). Autonomous.
- **Plan 05-05** — wave 2, knowledge rich subset A (4 routes). Autonomous.
- **Plan 05-06** — wave 2, knowledge rich subset B (5 routes). Autonomous.
- **Plan 05-07** — wave 3, Playwright specs + verify scripts + Mac operator smoke (M-14..M-20). **Non-autonomous** (operator checkpoint).

**Total:** 7 plans × 4 waves. ~50% context per plan target maintained.
