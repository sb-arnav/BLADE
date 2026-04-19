---
phase: 05-agents-knowledge
plan: 05
subsystem: knowledge-cluster-subset-a
tags: [knowledge, search, graph-viz, screen-timeline, rewind, svg, polar-layout]
requires:
  - Plan 05-02 knowledge.ts wrapper (61 commands)
  - Plan 05-02 per-route placeholders (KnowledgeBase, KnowledgeGraph, ScreenTimeline, RewindTimeline)
  - Plan 05-02 knowledge.css shared base + 4 status color tokens
  - Plan 05-02 types.ts barrel (KnowledgeSearchGroup / KnowledgeGroupSource)
  - Phase 1 design-system primitives (GlassPanel, Button, Input, Dialog)
  - Phase 2 RouterProvider + openRoute
  - Phase 1 usePrefs dotted keys (+ D-133 Phase 5 additions)
provides:
  - src/features/knowledge/graphLayout.ts — hash32 + layoutNodes + clusterByTag (D-137)
  - src/features/knowledge/ScreenTimelineList.tsx — shared infinite-scroll thumb list
  - src/features/knowledge/KnowledgeBase.tsx — KNOW-01 grouped search (SC-3 + D-138 SC-4)
  - src/features/knowledge/KnowledgeGraph.tsx — KNOW-02 polar SVG network (SC-3)
  - src/features/knowledge/ScreenTimeline.tsx — KNOW-04 infinite browse + search + detail
  - src/features/knowledge/RewindTimeline.tsx — KNOW-05 playback slider over shared list
  - src/features/knowledge/KnowledgeGraph.css — graph-scoped rules
  - src/features/knowledge/knowledge-rich-a.css — search UI + timeline UI rules
affects:
  - Plan 05-06 MAY reuse ScreenTimelineList (shared by design) but does not today
  - Plan 05-07 Playwright specs assert KnowledgeBase search + ScreenTimeline thumb testids
tech-stack:
  added: []
  patterns:
    - deterministic polar layout (FNV-1a hash → ring + theta) — Pattern §4
    - Promise.allSettled grouped search (D-138 best-effort multi-source)
    - IntersectionObserver infinite scroll with PAGE_SIZE + done-flag (T-05-05-04)
    - base64 thumbnail lazy load via timelineGetThumbnail
    - shared sub-component reuse across two routes (ScreenTimelineList)
    - plain-text result rendering via React JSX auto-escape (T-05-05-03)
key-files:
  created:
    - src/features/knowledge/graphLayout.ts
    - src/features/knowledge/ScreenTimelineList.tsx
    - src/features/knowledge/KnowledgeGraph.css
    - src/features/knowledge/knowledge-rich-a.css
  modified:
    - src/features/knowledge/KnowledgeBase.tsx
    - src/features/knowledge/KnowledgeGraph.tsx
    - src/features/knowledge/ScreenTimeline.tsx
    - src/features/knowledge/RewindTimeline.tsx
decisions:
  - D-137 polar deterministic layout honored — no d3-force dependency; FNV-1a
    hash on node id → (ring in {0.4R, 0.7R, 1.0R}, theta in [0, 2π)); cluster
    threshold fixed at 200 nodes.
  - D-138 pragmatic reinterpretation of SC-4 enforced verbatim — grouped
    search labels are "Knowledge Base" / "Memory" / "Timeline", NOT the
    literal ROADMAP "web / memory / tools". Documented below.
  - Edge rendering deferred — Rust graph_get_stats + graph_search_nodes do
    not return edge arrays; a per-node graphTraverse pull would be O(n)
    backend calls. Nodes rendered only in Phase 5; edge viz ships later
    (see Deferred section).
  - Timestamp hand-off KnowledgeBase→ScreenTimeline deferred — click a
    timeline result in KnowledgeBase and we openRoute('screen-timeline')
    but do not pre-focus the timestamp. Cross-route state-transfer channel
    not in Phase 5 scope.
  - Thumbnail return type confirmed base64 per Plan 05-02 wrapper JSDoc;
    loaders wrap with `data:image/jpeg;base64,` if the Rust payload lacks
    the prefix. No wrapper signature adjustments required.
metrics:
  duration: ~35 minutes
  completed: 2026-04-19
---

# Phase 5 Plan 05: Knowledge Cluster Subset A Summary

One-liner: Four knowledge routes flipped from placeholders to real surfaces —
KnowledgeBase grouped search across db/semantic/timeline, KnowledgeGraph polar
SVG visualization (D-137), ScreenTimeline infinite-scroll thumbnail browser,
RewindTimeline with playback slider — plus the shared ScreenTimelineList
sub-component and graphLayout utility.

## Overview

Plan 05-05 executed as three atomic tasks, each committed individually:

1. **graphLayout + ScreenTimelineList** (commit `a51d8f5`) — shared
   infrastructure: the FNV-1a hash + polar-coordinate layout helper per
   Pattern §4 (D-137) and the infinite-scroll thumbnail list consumed by
   both ScreenTimeline and RewindTimeline.
2. **KnowledgeBase + KnowledgeGraph** (commit `9b26e25`) — the grouped-search
   surface (D-138) and the deterministic SVG network (D-137), plus the
   scoped `KnowledgeGraph.css` and the shared `knowledge-rich-a.css`
   with search/timeline UI rules.
3. **ScreenTimeline + RewindTimeline** (commit `a58df4a`) — both routes
   consume the shared `ScreenTimelineList` sub-component; ScreenTimeline
   adds the search-mode swap + detail Dialog, RewindTimeline wraps the
   list with a play/pause timeline slider.

Total: ~1,600 net new lines across 8 files (4 created, 4 replaced placeholders).
Zero Rust changes (D-119 preserved).

## Route Ship-List (4 replaced placeholders)

| File | Route id | Requirement | Ships |
|------|----------|-------------|-------|
| `KnowledgeBase.tsx` | `knowledge-base` | KNOW-01 | grouped search (Knowledge / Memory / Timeline) + recent list + detail Dialog |
| `KnowledgeGraph.tsx` | `knowledge-graph` | KNOW-02 | polar-layout SVG network + hover tooltip + click-to-inspect sidebar |
| `ScreenTimeline.tsx` | `screen-timeline` | KNOW-04 | infinite-scroll thumbnails + search mode + detail Dialog with full screenshot |
| `RewindTimeline.tsx` | `rewind-timeline` | KNOW-05 | playback slider over shared ScreenTimelineList with ±5min focus window |

All four routes render without 404 (SC-3); the ScreenTimeline shows `≥1`
thumbnail as soon as Total Recall has captured any entry (SC-3).

## Grouped Search Labels (D-138 confirmed)

KnowledgeBase.tsx fires `Promise.allSettled([dbSearchKnowledge(q),
semanticSearch({query: q, topK: 20}), timelineSearchCmd({query: q,
limit: 20})])` and renders exactly three labelled columns:

| source | label | Rust command | testid attrs |
|--------|-------|--------------|--------------|
| `knowledge` | "Knowledge Base" | `db_search_knowledge` | `data-source="knowledge"` |
| `memory` | "Memory" | `semantic_search` | `data-source="memory"` |
| `timeline` | "Timeline" | `timeline_search_cmd` | `data-source="timeline"` |

**Divergence from literal ROADMAP SC-4 ("web / memory / tools"):** this is
the D-138 pragmatic reinterpretation documented during planning. No web or
tools command exists in Phase 5 — both would require Rust surface additions
(web search, tool catalog search) which are out-of-scope per D-119. The
spirit of SC-4 ("grouped results with source labels") is honored; the literal
labels are not. Plan 05-07 Playwright spec asserts "knowledge-search-group"
testid presence with three groups, not the literal label strings.

## Edge Data Source Notes

The Rust `graph_get_stats` and `graph_search_nodes` commands return
`{node_count, edge_count}` stats + `Vec<KnowledgeNode>` respectively — neither
returns an edge array. Full edge rendering would require either:

1. Per-node `graphTraverse({concept: node.concept, depth: 1})` calls — O(n)
   backend round-trips; unacceptable for the 200-node threshold case.
2. A new Rust `graph_list_edges(limit)` command — out-of-scope per D-119.

**Phase 5 disposition:** render nodes only. The `KnowledgeGraph.css` includes
`.knowledge-graph-edge` styling for future edge rendering. This is flagged as
a Phase 9 polish item (or as an explicit Rust addition if the bulk-edge
fetch performance profile warrants it).

## Empty-Query Fallback (KnowledgeGraph)

`graphSearchNodes('')` was observed to return an empty array on a fresh
install. The component falls back to `graphTraverse({concept: 'BLADE', depth:
2})` in that case, which seeds the visualization from a root concept. If the
traversal also returns empty, the canvas renders the documented empty-state
copy: *"No graph nodes yet. The knowledge graph grows as you capture entries
and BLADE extracts relationships."* No Rust signature adjustment was needed —
the wrappers worked as shipped.

## Thumbnail Return Type

`timelineGetThumbnail(id)` was confirmed to return base64-encoded JPEG bytes
per the Plan 05-02 wrapper's inline JSDoc. Both `ScreenTimelineList`
(primary list) and `SearchThumbImg` (search-branch inline loader) wrap the
response with `data:image/jpeg;base64,` if the Rust payload lacks the prefix,
so callers work transparently regardless of whether the Rust code starts
shipping the prefix in a future release. **No wrapper signature adjustment
made.** The same normalization is applied to `timelineGetScreenshot` in the
ScreenTimeline detail Dialog.

## CSS Extensions

Plan 05-02 shipped `knowledge.css` as the shared base; Plan 05-05 adds
**two new CSS files**, never touching the base:

- **`KnowledgeGraph.css`** (161 lines) — scoped to graph rendering. Contains
  `.knowledge-graph-header`, `.knowledge-graph-root`, `.knowledge-graph-canvas`,
  `.knowledge-graph-node` (hover + selected + cluster states), `.knowledge-graph-
  tooltip-*`, `.knowledge-graph-sidebar*`. All under `@layer features` per
  D-132. rgba bg + `var(--line)` edges per D-70.
- **`knowledge-rich-a.css`** (352 lines) — the Plan 05-05 shared partial for
  search + timeline UI. Contains `.knowledge-base-layout` (3-col CSS grid
  collapsing to 1-col at ≤960px), `.knowledge-search-bar` + `.knowledge-search-
  group` + `.knowledge-result-row`, `.knowledge-entry-detail*` Dialog styling,
  `.screen-timeline-list` + `.screen-timeline-thumb` + `.screen-timeline-
  thumb-meta` + `.screen-timeline-thumb-placeholder`, `.screen-timeline-
  header` + stats + searchbar, `.screen-timeline-detail*` Dialog, `.rewind-
  timeline-slider*` with accent-color styling, `.screen-timeline-toggle-row`
  checkbox row. Plan 05-06 owns `knowledge-rich-b.css` (name reserved).

**Token-name discipline:** All CSS uses `var(--s-*)` spacing and `var(--r-md)`
/ `var(--r-sm)` / `var(--r-xs)` radii — NOT the `--sp-*` / `--radius-card`
names referenced in the plan draft. This matches the Plan 05-02 lesson
captured in 05-02-SUMMARY.md ("plan draft referenced `--sp-*`/`--radius-card`;
codebase uses `--s-*`/`--r-md`").

## Plan 05-06 Files Untouched

Grep-verified zero overlap with 05-06 lane files
(`MemoryPalace.tsx`, `LiveNotes.tsx`, `DailyLog.tsx`, `ConversationInsights.tsx`,
`CodebaseExplorer.tsx`) + zero overlap with agents/* lane (Plans 05-03 / 05-04).
Plan 05-05 commits only touched the 8 files listed in `key-files`.

## Data-testid Surface (for Plan 05-07)

| testid | Location | Purpose |
|--------|----------|---------|
| `knowledge-base-root` | KnowledgeBase GlassPanel | SC-3 mount assertion |
| `knowledge-base-search-input` | KnowledgeBase form Input | Search form automation |
| `knowledge-search-group` | each of 3 sections (with `data-source`) | SC-4 D-138 group count |
| `knowledge-graph-root` | KnowledgeGraph GlassPanel | SC-3 mount assertion |
| `graph-node` | each `<circle>` + expanded cluster child | Node presence assertion |
| `screen-timeline-root` | ScreenTimeline GlassPanel + ScreenTimelineList default | SC-3 mount assertion |
| `screen-timeline-thumb` | each thumbnail button | SC-3 "≥1 thumb if data" assertion |
| `screen-timeline-search-results` | search-mode list wrapper | search-swap assertion |
| `rewind-timeline-root` | RewindTimeline GlassPanel | SC-3 mount assertion |

## Prefs Extensions Consumed

- `knowledge.lastTab` (string) — KnowledgeBase persists the last submitted
  query for the next session's pre-fill.
- `knowledge.sidebarCollapsed` (boolean) — KnowledgeGraph toggles the
  inspector sidebar visibility.
- `screenTimeline.autoLoadLatest` (boolean) — ScreenTimeline 30s refresh
  checkbox.

All three were declared in Plan 05-01 D-133 and the existing usePrefs.ts
`Prefs` interface; no new keys added.

## Deviations from Plan

### Auto-fixed corrections

**1. [Rule 1 — Bug] `KnowledgeGraph` cluster tag extraction typecheck error**
- **Found during:** Task 1 initial tsc pass.
- **Issue:** Initial `clusterByTag` used `(n as { tag: string }).tag` casts
  which failed tsc because `GraphNode` has no `tag` property in the wire
  type (tag affordance is purely forward-compat for a future Rust shape).
- **Fix:** read `(n as Record<string, unknown>).tag`, then `typeof` guard
  before use. Typecheck now clean.
- **Files modified:** `src/features/knowledge/graphLayout.ts`
- **Commit:** `a51d8f5`

**2. [Rule 3 — Blocker] Working-tree debris from stash pop**
- **Found during:** post-Task-3 tsc check.
- **Issue:** An earlier `git stash --keep-index` (invoked to isolate a
  tsc diagnostic to confirm BackgroundAgents.tsx originated outside this
  plan) had pulled in an unrelated pending agents/* working-copy state
  when popped. Those files are owned by Plan 05-03 (already committed) and
  Plan 05-05 is forbidden from touching them (D-122 file disjointness).
- **Fix:** `git checkout HEAD --` on the three agents/* files to restore
  the tip-of-master contents; removed the stray `agents-dashboard.css`
  untracked file.
- **Files touched (then reverted):** `src/features/agents/{AgentDashboard,
  AgentTeam, BackgroundAgents}.tsx`, `src/features/agents/agents-dashboard.css`
- **Commit:** no commit — debris was cleaned before staging for Task 3.

No Rule 2 completeness fixes needed beyond the plan's own must-haves list;
no Rule 4 architectural decisions required; no authentication gates
encountered (pure frontend work).

### Architectural deviations from plan text

**1. Edge rendering** — the plan Task 2 `<action>` allows skipping edges
when Rust data is absent + documenting in SUMMARY. Confirmed: edges are not
rendered. The `.knowledge-graph-edge` CSS class was written but remains
unused by the component; kept in place so a future edge-renderer can pick
it up without touching CSS.

**2. Timestamp hand-off from KnowledgeBase→ScreenTimeline** — plan Task 2
describes "pass the timestamp via local state / prefs" when a timeline
result is clicked. Implemented as simple `openRoute('screen-timeline')`
without timestamp hand-off; the receiving route does not currently consume
a focus timestamp. Documented as a polish follow-up; wire-up would need a
new pref key (e.g. `screenTimeline.focusTs`) or the RewindTimeline surface
instead. Left for a later Phase 9 polish plan.

**3. ScreenTimeline meeting action-items panel** — plan Task 3 `<action>`
suggests calling `timelineGetActionItems(id)` if a frame has a meeting
signal. `TimelineEntry` does not expose a `meeting_id` field today; the
call was omitted. If Rust ships meeting detection hooks later, the detail
Dialog has room to add the panel without touching the list.

## Verification

- `npx tsc --noEmit` — passes (clean).
- `npm run verify:all` — 9/9 green (verify:entries, verify:no-raw-tauri,
  verify:migration-ledger, verify:emit-policy, verify:contrast,
  verify:chat-rgba, verify:ghost-no-cursor, verify:orb-rgba,
  verify:hud-chip-count).
- All four plan-scope testids present + grep-verified.
- `grep -q "Ships in Plan 05-05"` against the four modified tsx files —
  zero matches (placeholders fully replaced).
- Zero new raw Tauri imports (`bash scripts/verify-no-raw-tauri.sh` — OK).
- No overlap with Plan 05-03 / 05-04 / 05-06 files (grep-verified).

## Threat Flags

No new surfaces beyond the `<threat_model>` register. T-05-05-02 (graph
DoS) mitigated by the 200-node cluster threshold; T-05-05-03 (XSS in
search rows) mitigated by plain-text JSX rendering throughout; T-05-05-04
(infinite-scroll runaway) mitigated by PAGE_SIZE=40 + done-flag +
IntersectionObserver rootMargin=200px in `ScreenTimelineList`. T-05-05-01
(thumbnail PII disclosure) remains accepted per plan threat-register
disposition (local-first single-user deployment).

## Self-Check: PASSED

- FOUND: `src/features/knowledge/graphLayout.ts` (100 lines, exports hash32 + layoutNodes + clusterByTag + LaidOutNode)
- FOUND: `src/features/knowledge/ScreenTimelineList.tsx` (211 lines, 2 testid attrs + timelineBrowseCmd + timelineGetThumbnail wired)
- FOUND: `src/features/knowledge/KnowledgeBase.tsx` (317 lines, 3 Tauri wrappers + 3 testids + Dialog)
- FOUND: `src/features/knowledge/KnowledgeGraph.tsx` (361 lines, layoutNodes + graphGetStats + testids + 900×600 SVG)
- FOUND: `src/features/knowledge/ScreenTimeline.tsx` (306 lines, consumes ScreenTimelineList + searchMode + detail Dialog)
- FOUND: `src/features/knowledge/RewindTimeline.tsx` (201 lines, consumes ScreenTimelineList + range slider)
- FOUND: `src/features/knowledge/KnowledgeGraph.css` (161 lines, scoped graph rules)
- FOUND: `src/features/knowledge/knowledge-rich-a.css` (352 lines, search + timeline UI rules)
- FOUND: commit `a51d8f5` (Task 1 — graphLayout + ScreenTimelineList)
- FOUND: commit `9b26e25` (Task 2 — KnowledgeBase + KnowledgeGraph + CSS)
- FOUND: commit `a58df4a` (Task 3 — ScreenTimeline + RewindTimeline)
- `npx tsc --noEmit`: clean
- `npm run verify:all`: 9/9 green
