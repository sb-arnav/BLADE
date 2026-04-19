// src/features/knowledge/types.ts
// Cluster-local barrel — re-exports Tauri wrapper types + knowledge-cluster UI-only types.
// D-128: per-cluster types module lets per-route files import a single barrel rather
// than the wrapper file directly.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-128, §D-138

export type {
  KnowledgeEntry,
  KnowledgeTemplate,
  SemanticHit,
  GraphNode,
  GraphEdge,
  SubGraph,
  GraphStats,
  MemoryCategory,
  TypedMemory,
  MemoryEpisode,
  MemoryRecall,
  TimelineEntry,
  TimelineConfig,
  TimelineStats,
  UnifiedSearchResult,
  AudioTimelineEntry,
  MeetingSummary,
  DocumentEntry,
  DocQA,
  MemoryBlocks,
} from '@/lib/tauri/knowledge';

// ── Cluster-local UI types (not on the wire) ────────────────────────────────

/**
 * Search result grouping labels per D-138 pragmatic reinterpretation of
 * ROADMAP SC-4 "web / memory / tools" → Knowledge / Memory / Timeline.
 */
export type KnowledgeGroupSource = 'knowledge' | 'memory' | 'timeline';

export interface KnowledgeSearchGroup {
  source: KnowledgeGroupSource;
  label: string;
  results: Array<{ id: string; title: string; preview: string; score?: number }>;
}

/** Tab selection for MemoryPalace 7-category layout (Claude's Discretion — D-CD §Phase 5). */
export type MemoryPalaceTab =
  | 'fact'
  | 'preference'
  | 'decision'
  | 'relationship'
  | 'skill'
  | 'goal'
  | 'routine';
