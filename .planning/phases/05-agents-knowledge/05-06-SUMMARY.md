---
phase: 05-agents-knowledge
plan: 06
subsystem: knowledge-cluster
tags:
  - knowledge
  - typed-memory
  - memory-palace
  - live-notes
  - daily-log
  - conversation-insights
  - codebase-explorer
  - document-intelligence
requires:
  - 05-02 # knowledge.ts wrappers + placeholder seed
  - 05-01 # event registry + Phase 5 Prefs keys (knowledge.lastTab)
provides:
  - KNOW-03 # MemoryPalace 7-tab typed memory surface
  - KNOW-06 # LiveNotes quick-capture
  - KNOW-07 # DailyLog day-grouped log
  - KNOW-08 # ConversationInsights recent + topics
  - KNOW-09 # CodebaseExplorer doc list + search + Q&A
affects:
  - 05-07 # Playwright specs assert data-testid hooks added here
tech-stack:
  added: []           # zero new deps (D-02 / D-119)
  patterns:
    - invokeTyped one-off for db_list_conversations (documented for Phase 6 consolidation)
    - prefs-backed tab memory (knowledge.lastTab)
    - defensive unix-sec vs unix-ms timestamp detection
    - honest Phase 9 deferral card when heuristic underperforms
key-files:
  created:
    - src/features/knowledge/knowledge-rich-b.css
    - .planning/phases/05-agents-knowledge/05-06-SUMMARY.md
  modified:
    - src/features/knowledge/MemoryPalace.tsx
    - src/features/knowledge/LiveNotes.tsx
    - src/features/knowledge/DailyLog.tsx
    - src/features/knowledge/ConversationInsights.tsx
    - src/features/knowledge/CodebaseExplorer.tsx
decisions:
  - "D-138-MP: MemoryPalace 7 tabs ordered (fact, preference, decision, skill, goal, routine, relationship) — order mirrors typed_memory.rs enum declaration verbatim so future Rust-side additions stay consistent."
  - "LN-note: LiveNotes uses memory_add_manual with episode_type='note' + importance=3 (mid). Title auto-derived from first 60 chars of body; full body → summary field. Future wrapper work may split title from body as a form input."
  - "CI-defer: ConversationInsights 'topics this week' uses semantic_search heuristic; when heuristic returns zero usable topics we render an explicit Phase-9 deferral card rather than fake a visualization (D-138 honest deferral pattern)."
  - "CI-oneoff: db_list_conversations invoked via invokeTyped directly inside ConversationInsights — no new history.ts wrapper. Rationale is per plan interfaces §(c); Phase 6 history cluster will consolidate."
metrics:
  duration: "~9m"
  completed: "2026-04-19"
  tasks_total: 2
  tasks_completed: 2
  files_touched: 5
  css_lines_added: 596
---

# Phase 5 Plan 05-06: Knowledge Rich B — Summary

One-liner: 5 knowledge routes wired end-to-end — MemoryPalace (7-tab typed memory), LiveNotes (quick capture), DailyLog (day-grouped episodes), ConversationInsights (recent + topic heuristic), CodebaseExplorer (doc list + search + Q&A) — consuming the Plan 05-02 `knowledge.ts` wrappers and one `invokeTyped` one-off for `db_list_conversations`.

---

## Routes Shipped

All 5 routes in this plan now render real surfaces (no 404, no ComingSoonSkeleton):

| Route                     | File                          | Requirement | Rust commands consumed                                                                          |
| ------------------------- | ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `/memory-palace`          | `MemoryPalace.tsx`            | KNOW-03     | `memory_recall_category`, `memory_store_typed`, `memory_delete_typed`                           |
| `/live-notes`             | `LiveNotes.tsx`               | KNOW-06     | `memory_add_manual`, `memory_get_recent`                                                        |
| `/daily-log`              | `DailyLog.tsx`                | KNOW-07     | `memory_get_recent` (500 rows, client-grouped by calendar day)                                  |
| `/conversation-insights`  | `ConversationInsights.tsx`    | KNOW-08     | `db_list_conversations` (one-off `invokeTyped`), `semantic_search`                              |
| `/codebase-explorer`      | `CodebaseExplorer.tsx`        | KNOW-09     | `doc_list`, `doc_search`, `doc_answer_question`, `doc_ingest`, `doc_delete`                     |

Closes the full SC-3 "navigating to any Knowledge route produces a rendered surface" coverage together with Plan 05-05 (KnowledgeBase / KnowledgeGraph / ScreenTimeline / Documents on 05-05's lane — RewindTimeline remains a placeholder outside both plans' scope).

---

## 7-Category MemoryPalace Tab Ground Truth (for Plan 05-07 spec)

The tab strip renders exactly 7 buttons in the following order — Plan 05-07's Playwright spec should assert `count === 7` and the `data-category` values:

| Order | `data-category` (wire) | UI label       |
| ----- | ---------------------- | -------------- |
| 1     | `fact`                 | Fact           |
| 2     | `preference`           | Preference     |
| 3     | `decision`             | Decision       |
| 4     | `skill`                | Skill          |
| 5     | `goal`                 | Goal           |
| 6     | `routine`              | Routine        |
| 7     | `relationship`         | Relationship   |

The order matches `src-tauri/src/typed_memory.rs:35 MemoryCategory` verbatim. `data-testid="memory-palace-tab"` is on every button; `data-active="true"` tracks the selected tab; selection persists to `prefs.knowledge.lastTab` via `usePrefs` (D-133).

---

## `data-testid` Inventory (for Plan 05-07)

| Component              | Root testid                     | Additional hooks                           |
| ---------------------- | ------------------------------- | ------------------------------------------ |
| MemoryPalace           | `memory-palace-root`            | `memory-palace-tab` + `data-category`      |
| LiveNotes              | `live-notes-root`               | —                                          |
| DailyLog               | `daily-log-root`                | —                                          |
| ConversationInsights   | `conversation-insights-root`    | `conversation-row`                         |
| CodebaseExplorer       | `codebase-explorer-root`        | —                                          |

---

## One-off `invokeTyped` Call Site (Phase 6 Consolidation Target)

ConversationInsights calls `db_list_conversations` directly through `invokeTyped`:

- **File:** `src/features/knowledge/ConversationInsights.tsx`
- **Call:** `invokeTyped<ConversationRow[]>('db_list_conversations', {})`
- **Local type:** `ConversationRow` interface declared inline (mirrors Rust `db.rs:9 ConversationRow` verbatim — `id`, `title`, `created_at`, `updated_at`, `message_count`, `pinned`).
- **Rationale:** `db_list_conversations` belongs to the chat/history cluster, not the knowledge cluster. Adding it to `knowledge.ts` would scope-creep; adding a new `history.ts` wrapper file would expand the lib surface Plan 05-07 verify scripts would need to index. Plan 05-06 interfaces §(c) explicitly chose invokeTyped one-off + Phase 6 consolidation.
- **Phase 6 action:** when the chat/history surfaces re-open, create `src/lib/tauri/history.ts` with `dbListConversations` (+ the neighbour `db_get_conversation`, `db_save_conversation`, `db_delete_conversation`, `db_search_messages`, `db_pin_conversation`, `db_rename_conversation`, `db_conversation_stats`, `history_load_conversation`, `history_list_conversations`, `history_save_conversation`, `history_rename_conversation`, `history_delete_conversation`, `auto_title_conversation` — all already registered per `lib.rs:609-623`). Then migrate ConversationInsights to import from the wrapper.

The ESLint `no-raw-tauri` rule passes because we used `invokeTyped` (the `src/lib/tauri/_base.ts` export), not raw `@tauri-apps/api/core` `invoke`.

---

## Honest Deferral — Weekly Topic Extraction

ConversationInsights' "topics this week" section uses a heuristic: `semanticSearch({ query: 'this week', topK: 20 })` → bucket results by `metadata.topic/tag/category` if present, else by `source_type`. If the heuristic returns zero usable buckets, the pane renders:

> *"Weekly topic extraction coming in Phase 9 polish. The semantic index did not return enough tagged hits to build a reliable topic list yet."*

This is the "honest deferral" pattern (D-138) — we do not fake a visualization. Phase 9 polish is the appropriate home for a real topic-extraction LLM pass over the last 7 days of conversations; Phase 5 does not add Rust for it (D-119).

The "open conversation" click navigates to `/chat` only — the selected-conversation deep-link (`history_load_conversation`) is Phase 6 history-wrapper work, deliberately deferred.

---

## Wrapper Signature Corrections Encountered

While wiring the Phase 5 Plan 05-02 `knowledge.ts` wrappers into components, I noticed the following shape realities that the plan's `<interfaces>` prose abbreviated:

1. **`memoryAddManual` does NOT take `{content, category}`.** It takes `{title, summary, episodeType, importance}` — memory_palace.rs:806. LiveNotes derives the title from the first ~60 chars of the note body; the full body goes to `summary`; `episode_type='note'`; `importance=3`.
2. **`memoryGetRecent` returns `MemoryEpisode[]`, not a generic "MemoryEntry".** Fields used: `id`, `title`, `summary`, `full_context`, `episode_type`, `created_at` (unix seconds per memory_palace.rs). `TypedMemory` is the typed-memory surface (`memory_recall_category`) — different shape (`content`, `confidence`, `category`).
3. **`docSearch(query)` takes ONLY `query`.** No `documentId` or `limit`. Rust signature `doc_search(query: String) -> Vec<Document>` returns a cross-doc match list; CodebaseExplorer renders it client-side and surfaces the selected doc at the top when it appears in the match set.
4. **`docAnswerQuestion` returns `DocQA`** `{question, answer, doc_ids_used, confidence, relevant_quotes}` — not a plain string.
5. **`MemoryCategory` wire values are lowercase.** `typed_memory.rs::MemoryCategory::as_str()` yields `'fact' | 'preference' | 'decision' | 'relationship' | 'skill' | 'goal' | 'routine'` — Capitalized labels are rendered in the UI only; the Rust invoke boundary stays lowercase.
6. **`db_list_conversations` takes NO `limit` arg** — Rust signature is `fn db_list_conversations(state)` only. Callers slice client-side. The plan action prose said `{ limit: 50 }`; I dropped the arg to match Rust reality and slice to `RECENT_LIMIT=20` on the frontend.

These are call-site adaptations only — the wrappers in `src/lib/tauri/knowledge.ts` are correct as shipped by Plan 05-02 against Rust.

---

## Plan 05-05 Files — Untouched Confirmation

Plan 05-05's four files (`KnowledgeBase.tsx`, `KnowledgeGraph.tsx`, `ScreenTimeline.tsx`, `Documents.tsx`), plus their shared helpers (`graphLayout.ts`, `ScreenTimelineList.tsx`), plus their CSS partial — **none of them were modified** by this plan. Verified by `git show --stat b3df9e7 d031513`:

- `b3df9e7` (Task 1): `DailyLog.tsx`, `LiveNotes.tsx`, `MemoryPalace.tsx`, `knowledge-rich-b.css` (new)
- `d031513` (Task 2): `CodebaseExplorer.tsx`, `ConversationInsights.tsx`

Zero overlap with 05-03 (agents A), 05-04 (agents B), 05-05 (knowledge A). Parallel-wave invariant preserved.

---

## CSS Partial — `knowledge-rich-b.css`

Plan 05-02 shipped `knowledge.css` as the shared base. Plan 05-06 creates a scoped partial `knowledge-rich-b.css` (596 lines) for the 5 surfaces in this plan — each route file imports it. All rules live under `@layer features` so the cascade order Plan 05-02 established stays intact. Tokens used are the canonical `--s-N / --t-N / --line / --line-strong / --r-md / --r-pill / --status-running / --font-mono / --ease-out` — no hex colors, no hardcoded pixel spacing outside the 4/8/12/16 scale (D-02 / D-70 compliance).

The plan prose referenced `--sp-N / --radius-card / --radius-pill` tokens; those are Tailwind-bridge aliases defined in `src/styles/index.css` and still work. I used the canonical token names directly to match Plan 05-02's `knowledge.css` style.

**Note:** The plan's Task-2 verify snippet greps for `"codebase-explorer\|conversation-insights"` inside `src/features/knowledge/knowledge.css` — that was a copy-paste error from Plan 05-05's verify line. The plan's own `<files_modified>` + `<action>` blocks authoritatively specify `knowledge-rich-b.css` as the new partial. The selectors ARE present in `knowledge-rich-b.css`.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Rust signature mismatches in plan prose**

- **Found during:** Task 1 (LiveNotes wiring) + Task 2 (CodebaseExplorer wiring)
- **Issue:** Plan prose described `memoryAddManual({content, category})` and `docSearch({query, documentId, limit})` and `db_list_conversations({limit: 50})` — all three are wrong against the actual Rust signatures (shipped in Plan 05-02's wrappers).
- **Fix:** adapted each call site to the actual wrapper signature documented above in §"Wrapper Signature Corrections Encountered".
- **Commits:** `b3df9e7`, `d031513`.

**2. [Rule 1 — Bug] Plan Task-2 verify grep targets the wrong CSS file**

- **Found during:** Task 2 verify step
- **Issue:** Task 2's `<verify>` block runs `grep "codebase-explorer\|conversation-insights" src/features/knowledge/knowledge.css` — but the plan's `<action>` + `<files_modified>` authoritatively say the new partial is `knowledge-rich-b.css`. The grep target is a copy-paste artifact.
- **Fix:** created `knowledge-rich-b.css` per the action block + `files_modified`. Selectors are present in `knowledge-rich-b.css` and every consuming route file imports it. I did not modify `knowledge.css` to avoid collision with Plan 05-05's extensions.
- **Commit:** `b3df9e7`.

No Rule 2 additions, no Rule 3 fixes, no Rule 4 architectural checkpoints.

---

## Auth Gates

None. All surfaces run against local Rust state; no provider/network auth required.

---

## Deferred Issues

1. **`history_load_conversation` deep-link from ConversationInsights → chat** — Phase 6 history-cluster work. For Phase 5, clicking a conversation row opens `/chat` generically; the user has to select the conversation from the chat sidebar.
2. **Weekly topic extraction real implementation** — heuristic-backed UI shipped; honest Phase-9 deferral card renders when heuristic returns zero usable buckets. Real topic extraction is a Phase 9 polish item.
3. **Per-chunk doc search inside a selected document** — Rust `doc_search(query)` returns matched documents, not chunks. The frontend surfaces the selected doc at the top of the match set when it appears. A chunk-scoped search would need a new Rust command (out of Phase 5 scope per D-119).
4. **Title as a distinct field in LiveNotes** — Rust `memory_add_manual` requires `(title, summary, episode_type, importance)`. LiveNotes auto-derives title from the first 60 chars of the note body. A dedicated title input + "expand form" affordance is a Phase 9 polish.
5. **Playwright specs for the 5 new surfaces** — Plan 05-07 adds them. The `data-testid` hooks are in place (memory-palace-root, memory-palace-tab + data-category, live-notes-root, daily-log-root, conversation-insights-root, codebase-explorer-root, conversation-row).

---

## Verification

- `npx tsc --noEmit` — **clean on this plan's 5 files** (zero TS errors in `src/features/knowledge/**`). Note: a pre-existing TS error lives in `src/features/agents/BackgroundAgents.tsx` introduced by Plan 05-03's in-flight work visible in the working tree — out of scope per SCOPE BOUNDARY rule.
- `npm run verify:all` — **9/9 green** (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count).
- `grep -q "memoryRecallCategory\|memoryStoreTyped" MemoryPalace.tsx` — pass.
- `grep -q "memoryAddManual\|memoryGetRecent" LiveNotes.tsx` — pass.
- `grep -q "memoryGetRecent" DailyLog.tsx` — pass.
- `grep -q "db_list_conversations\|invokeTyped" ConversationInsights.tsx` — pass.
- `grep -q "docList\|docSearch\|docAnswerQuestion" CodebaseExplorer.tsx` — pass.
- `! grep -q "Ships in Plan 05-06"` across all 5 files — pass.

---

## Commits

| Task | Commit    | Description                                                      |
| ---- | --------- | ---------------------------------------------------------------- |
| 1    | `b3df9e7` | MemoryPalace + LiveNotes + DailyLog + knowledge-rich-b.css       |
| 2    | `d031513` | ConversationInsights + CodebaseExplorer                          |

---

## Self-Check: PASSED

**Files created (verified exist on disk):**
- `src/features/knowledge/knowledge-rich-b.css` — FOUND
- `.planning/phases/05-agents-knowledge/05-06-SUMMARY.md` — (this file)

**Files modified (verified current content matches committed content):**
- `src/features/knowledge/MemoryPalace.tsx` — FOUND (282 lines body)
- `src/features/knowledge/LiveNotes.tsx` — FOUND (207 lines body)
- `src/features/knowledge/DailyLog.tsx` — FOUND (192 lines body)
- `src/features/knowledge/ConversationInsights.tsx` — FOUND (234 lines body)
- `src/features/knowledge/CodebaseExplorer.tsx` — FOUND (466 lines body)

**Commits (verified in `git log`):**
- `b3df9e7` — FOUND
- `d031513` — FOUND
