// src/features/dev/KnowledgeBaseDev.tsx — DEV-only isolation route for KnowledgeBase.
//
// Phase 5 Plan 05-07 Task 1. Mounts <KnowledgeBase/> in the main-window route
// tree so Playwright can assert the D-138 grouped-search surface (SC-3 + SC-4
// falsifier — "3 labelled result groups: Knowledge / Memory / Timeline") with
// no live SQLite + vector store + screen timeline.
//
// The Playwright shim (tests/e2e/knowledge-base-search.spec.ts) intercepts
// `db_list_knowledge` / `db_search_knowledge` / `semantic_search` /
// `timeline_search_cmd` invokes and returns canned rows matching the Rust
// wire shapes (KnowledgeEntry / SemanticHit / TimelineEntry — see
// src/lib/tauri/knowledge.ts for the interface declarations). The dev route
// body is a passthrough; all mocking lives in the test shim.
//
// @see tests/e2e/knowledge-base-search.spec.ts
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 1
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-138

import { KnowledgeBase } from '@/features/knowledge/KnowledgeBase';

export function KnowledgeBaseDev() {
  return <KnowledgeBase />;
}
