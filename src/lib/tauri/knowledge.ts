// src/lib/tauri/knowledge.ts
//
// Typed wrappers for the Knowledge cluster — one per registered Rust #[tauri::command]
// across db_commands.rs (knowledge + templates), embeddings.rs, knowledge_graph.rs,
// memory_palace.rs, typed_memory.rs, screen_timeline_commands.rs,
// document_intelligence.rs, and memory.rs (D-119 inventory).
//
// D-118: per-cluster wrapper module lives HERE (knowledge cluster only).
// D-119: zero Rust expansion in Phase 5 — every command below is already registered
//        in src-tauri/src/lib.rs generate_handler!.
// D-126: camelCase JS API, snake_case at invoke boundary. No raw invoke.
// D-38:  @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-127: return types mirror Rust #[derive(Serialize)] shape verbatim — snake_case fields
//        preserved to match the wire payload.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-118..D-128
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §1
// @see src-tauri/src/lib.rs:624-644,765-768,791-793,923-936,982-993,1115-1122,1146-1153

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim (snake_case preserved).
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/db.rs:35 KnowledgeRow */
export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  /** JSON-encoded `string[]`; callers parse on the frontend. */
  tags: string;
  source: string;
  conversation_id?: string | null;
  created_at: number;
  updated_at: number;
  [k: string]: unknown;
}

/** Rust ships templates as `serde_json::Value` — we surface a best-effort typed shape. */
export interface KnowledgeTemplate {
  id: string;
  name: string;
  content: string;
  variables?: string;
  category?: string;
  icon?: string;
  created_at?: number;
  updated_at?: number;
  usage_count?: number;
  is_builtin?: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/embeddings.rs:59 SearchResult */
export interface SemanticHit {
  text: string;
  score: number;
  source_type: string;
  source_id: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/knowledge_graph.rs:22 KnowledgeNode */
export interface GraphNode {
  id: string;
  concept: string;
  node_type: string;
  description: string;
  sources: string[];
  importance: number;
  created_at: number;
  last_updated: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/knowledge_graph.rs:34 KnowledgeEdge */
export interface GraphEdge {
  from_id: string;
  to_id: string;
  relation: string;
  strength: number;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/knowledge_graph.rs:51 SubGraph */
export interface SubGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  root_concept: string;
  [k: string]: unknown;
}

/** Free-form stats payload — Rust returns `serde_json::Value`. */
export interface GraphStats {
  [k: string]: unknown;
}

/**
 * Memory category values as serialized on the Rust wire — typed_memory.rs
 * writes the lowercase variant string via `MemoryCategory::as_str()`.
 * @see src-tauri/src/typed_memory.rs:35 MemoryCategory
 */
export type MemoryCategory =
  | 'fact'
  | 'preference'
  | 'decision'
  | 'relationship'
  | 'skill'
  | 'goal'
  | 'routine';

/** @see src-tauri/src/typed_memory.rs:75 TypedMemory */
export interface TypedMemory {
  id: string;
  category: string; // MemoryCategory value (see MemoryCategory type)
  content: string;
  confidence: number;
  source: string;
  created_at: number;
  last_accessed: number;
  access_count: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/memory_palace.rs:20 MemoryEpisode */
export interface MemoryEpisode {
  id: string;
  title: string;
  summary: string;
  full_context: string;
  tags: string[];
  episode_type: string;
  importance: number;
  emotional_valence: string;
  people: string[];
  projects: string[];
  recall_count: number;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/memory_palace.rs:37 MemoryRecall */
export interface MemoryRecall {
  episodes: MemoryEpisode[];
  associations: string[];
  synthesis: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/screen_timeline.rs:28 ScreenTimelineEntry */
export interface TimelineEntry {
  id: number;
  timestamp: number;
  screenshot_path: string;
  thumbnail_path: string;
  window_title: string;
  app_name: string;
  description: string;
  fingerprint: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/screen_timeline.rs:40 TimelineConfig */
export interface TimelineConfig {
  enabled: boolean;
  capture_interval_secs: number;
  retention_days: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/screen_timeline.rs:47 TimelineStats */
export interface TimelineStats {
  total_entries: number;
  disk_bytes: number;
  oldest_timestamp?: number | null;
  newest_timestamp?: number | null;
  [k: string]: unknown;
}

/**
 * @see src-tauri/src/audio_timeline.rs:67 UnifiedSearchResult
 * Note: Rust uses `#[serde(rename_all = "camelCase")]` on this struct, so
 * `result_type` ships as `resultType` / `source_id` as `sourceId` on the wire.
 */
export interface UnifiedSearchResult {
  resultType: string;
  content: string;
  timestamp: number;
  relevance: number;
  sourceId: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/audio_timeline.rs:28 AudioTimelineEntry */
export interface AudioTimelineEntry {
  id: number;
  timestamp: number;
  duration_secs: number;
  transcript: string;
  source: string;
  action_items: string[];
  decisions: string[];
  mentions: string[];
  topics: string[];
  sentiment: string;
  meeting_id: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/audio_timeline.rs:52 MeetingSummary */
export interface MeetingSummary {
  meeting_id: string;
  title: string;
  start_timestamp: number;
  end_timestamp: number;
  participants: string[];
  summary: string;
  action_items: string[];
  decisions: string[];
  sentiment: string;
  duration_minutes: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/document_intelligence.rs:15 Document */
export interface DocumentEntry {
  id: string;
  title: string;
  file_path: string;
  doc_type: string;
  content: string;
  summary: string;
  key_points: string[];
  topics: string[];
  word_count: number;
  added_at: number;
  last_accessed: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/document_intelligence.rs:38 DocQA */
export interface DocQA {
  question: string;
  answer: string;
  doc_ids_used: string[];
  confidence: number;
  relevant_quotes: string[];
  [k: string]: unknown;
}

/** Rust returns `serde_json::Value` for memory blocks — free-form object. */
export interface MemoryBlocks {
  human?: string;
  persona?: string;
  conversation?: string;
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// db_commands.rs — knowledge entries (9 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/db_commands.rs:111 db_list_knowledge
 * Rust signature: `db_list_knowledge(state) -> Result<Vec<KnowledgeRow>, String>`.
 * Note: Rust takes NO `limit` parameter — returns all knowledge rows; callers slice on the client.
 */
export function dbListKnowledge(): Promise<KnowledgeEntry[]> {
  return invokeTyped<KnowledgeEntry[]>('db_list_knowledge', {});
}

/**
 * @see src-tauri/src/db_commands.rs:119 db_get_knowledge
 * Rust signature: `db_get_knowledge(state, id: String) -> Result<KnowledgeRow, String>` (not Option).
 */
export function dbGetKnowledge(id: string): Promise<KnowledgeEntry> {
  return invokeTyped<KnowledgeEntry, { id: string }>('db_get_knowledge', { id });
}

/**
 * @see src-tauri/src/db_commands.rs:132 db_add_knowledge
 * Rust signature: `db_add_knowledge(state, entry: KnowledgeRow) -> Result<KnowledgeRow, String>`.
 */
export function dbAddKnowledge(entry: KnowledgeEntry): Promise<KnowledgeEntry> {
  return invokeTyped<KnowledgeEntry, { entry: KnowledgeEntry }>('db_add_knowledge', { entry });
}

/**
 * @see src-tauri/src/db_commands.rs:142 db_update_knowledge
 * Rust signature: `db_update_knowledge(state, entry: KnowledgeRow) -> Result<(), String>`.
 */
export function dbUpdateKnowledge(entry: KnowledgeEntry): Promise<void> {
  return invokeTyped<void, { entry: KnowledgeEntry }>('db_update_knowledge', { entry });
}

/** @see src-tauri/src/db_commands.rs:151 db_delete_knowledge */
export function dbDeleteKnowledge(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('db_delete_knowledge', { id });
}

/**
 * @see src-tauri/src/db_commands.rs:157 db_search_knowledge
 * Rust signature: `db_search_knowledge(state, query: String) -> Result<Vec<KnowledgeRow>, String>`.
 */
export function dbSearchKnowledge(query: string): Promise<KnowledgeEntry[]> {
  return invokeTyped<KnowledgeEntry[], { query: string }>('db_search_knowledge', { query });
}

/** @see src-tauri/src/db_commands.rs:166 db_knowledge_by_tag */
export function dbKnowledgeByTag(tag: string): Promise<KnowledgeEntry[]> {
  return invokeTyped<KnowledgeEntry[], { tag: string }>('db_knowledge_by_tag', { tag });
}

/**
 * @see src-tauri/src/db_commands.rs:180 db_knowledge_tags
 * Returns `Vec<serde_json::Value>` — each element has { tag: string; count: number } shape.
 */
export function dbKnowledgeTags(): Promise<Array<{ tag: string; count: number; [k: string]: unknown }>> {
  return invokeTyped<Array<{ tag: string; count: number; [k: string]: unknown }>>(
    'db_knowledge_tags',
    {},
  );
}

/**
 * @see src-tauri/src/db_commands.rs:209 db_knowledge_stats
 * Returns free-form JSON — entry count, tag histograms, source counts.
 */
export function dbKnowledgeStats(): Promise<Record<string, unknown>> {
  return invokeTyped<Record<string, unknown>>('db_knowledge_stats', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// db_commands.rs — template catalog (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/db_commands.rs:356 db_list_templates */
export function dbListTemplates(): Promise<KnowledgeTemplate[]> {
  return invokeTyped<KnowledgeTemplate[]>('db_list_templates', {});
}

/**
 * @see src-tauri/src/db_commands.rs:385 db_add_template
 * Rust signature: `db_add_template(state, template: serde_json::Value) -> Result<serde_json::Value, String>`.
 * Returns `{ id: string }` on success.
 */
export function dbAddTemplate(template: KnowledgeTemplate): Promise<{ id: string; [k: string]: unknown }> {
  return invokeTyped<{ id: string; [k: string]: unknown }, { template: KnowledgeTemplate }>(
    'db_add_template',
    { template },
  );
}

/** @see src-tauri/src/db_commands.rs:410 db_delete_template */
export function dbDeleteTemplate(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('db_delete_template', { id });
}

/** @see src-tauri/src/db_commands.rs:421 db_increment_template_usage */
export function dbIncrementTemplateUsage(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('db_increment_template_usage', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// embeddings.rs — vector store (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/embeddings.rs:444 embed_and_store
 * Rust signature: `embed_and_store(store, text: String, metadata: serde_json::Value) -> Result<(), String>`.
 */
export function embedAndStore(args: { text: string; metadata: Record<string, unknown> }): Promise<void> {
  return invokeTyped<void, { text: string; metadata: Record<string, unknown> }>(
    'embed_and_store',
    { text: args.text, metadata: args.metadata },
  );
}

/**
 * @see src-tauri/src/embeddings.rs:472 semantic_search
 * Rust signature: `semantic_search(store, query: String, top_k: Option<usize>) -> Result<Vec<SearchResult>, String>`.
 * Note: Rust parameter is `top_k`, not `limit`.
 */
export function semanticSearch(args: { query: string; topK?: number }): Promise<SemanticHit[]> {
  return invokeTyped<SemanticHit[], { query: string; top_k?: number }>('semantic_search', {
    query: args.query,
    top_k: args.topK,
  });
}

/** @see src-tauri/src/embeddings.rs:488 vector_store_size */
export function vectorStoreSize(): Promise<number> {
  return invokeTyped<number>('vector_store_size', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// knowledge_graph.rs — 8 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/knowledge_graph.rs:856 graph_add_node
 * Rust signature: `graph_add_node(id, concept, node_type, description, sources, importance: f32) -> Result<String, String>`.
 */
export function graphAddNode(args: {
  id: string;
  concept: string;
  nodeType: string;
  description: string;
  sources: string[];
  importance: number;
}): Promise<string> {
  return invokeTyped<
    string,
    { id: string; concept: string; node_type: string; description: string; sources: string[]; importance: number }
  >('graph_add_node', {
    id: args.id,
    concept: args.concept,
    node_type: args.nodeType,
    description: args.description,
    sources: args.sources,
    importance: args.importance,
  });
}

/** @see src-tauri/src/knowledge_graph.rs:879 graph_search_nodes */
export function graphSearchNodes(query: string): Promise<GraphNode[]> {
  return invokeTyped<GraphNode[], { query: string }>('graph_search_nodes', { query });
}

/**
 * @see src-tauri/src/knowledge_graph.rs:884 graph_traverse
 * Rust signature: `graph_traverse(concept, depth: usize, relation_filter: Option<String>) -> SubGraph`.
 */
export function graphTraverse(args: {
  concept: string;
  depth: number;
  relationFilter?: string;
}): Promise<SubGraph> {
  return invokeTyped<SubGraph, { concept: string; depth: number; relation_filter?: string }>(
    'graph_traverse',
    { concept: args.concept, depth: args.depth, relation_filter: args.relationFilter },
  );
}

/**
 * @see src-tauri/src/knowledge_graph.rs:893 graph_find_path
 * Rust signature: `graph_find_path(from_concept: String, to_concept: String) -> Vec<KnowledgeNode>`.
 */
export function graphFindPath(args: { fromConcept: string; toConcept: string }): Promise<GraphNode[]> {
  return invokeTyped<GraphNode[], { from_concept: string; to_concept: string }>(
    'graph_find_path',
    { from_concept: args.fromConcept, to_concept: args.toConcept },
  );
}

/** @see src-tauri/src/knowledge_graph.rs:898 graph_extract_from_text */
export function graphExtractFromText(text: string): Promise<GraphNode[]> {
  return invokeTyped<GraphNode[], { text: string }>('graph_extract_from_text', { text });
}

/** @see src-tauri/src/knowledge_graph.rs:903 graph_answer */
export function graphAnswer(question: string): Promise<string> {
  return invokeTyped<string, { question: string }>('graph_answer', { question });
}

/** @see src-tauri/src/knowledge_graph.rs:908 graph_get_stats */
export function graphGetStats(): Promise<GraphStats> {
  return invokeTyped<GraphStats>('graph_get_stats', {});
}

/** @see src-tauri/src/knowledge_graph.rs:913 graph_delete_node */
export function graphDeleteNode(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('graph_delete_node', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// memory_palace.rs — 6 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/memory_palace.rs:791 memory_search
 * Rust signature: `memory_search(query: String, limit: Option<usize>) -> Vec<MemoryEpisode>`.
 */
export function memorySearch(args: { query: string; limit?: number }): Promise<MemoryEpisode[]> {
  return invokeTyped<MemoryEpisode[], { query: string; limit?: number }>('memory_search', {
    query: args.query,
    limit: args.limit,
  });
}

/**
 * @see src-tauri/src/memory_palace.rs:796 memory_get_recent
 * Rust signature: `memory_get_recent(days: Option<u32>, limit: Option<usize>) -> Vec<MemoryEpisode>`.
 */
export function memoryGetRecent(args?: { days?: number; limit?: number }): Promise<MemoryEpisode[]> {
  return invokeTyped<MemoryEpisode[], { days?: number; limit?: number }>('memory_get_recent', {
    days: args?.days,
    limit: args?.limit,
  });
}

/** @see src-tauri/src/memory_palace.rs:801 memory_recall */
export function memoryRecall(query: string): Promise<MemoryRecall> {
  return invokeTyped<MemoryRecall, { query: string }>('memory_recall', { query });
}

/**
 * @see src-tauri/src/memory_palace.rs:806 memory_add_manual
 * Rust signature: `memory_add_manual(title, summary, episode_type, importance: i32) -> Result<String, String>`.
 */
export function memoryAddManual(args: {
  title: string;
  summary: string;
  episodeType: string;
  importance: number;
}): Promise<string> {
  return invokeTyped<
    string,
    { title: string; summary: string; episode_type: string; importance: number }
  >('memory_add_manual', {
    title: args.title,
    summary: args.summary,
    episode_type: args.episodeType,
    importance: args.importance,
  });
}

/** @see src-tauri/src/memory_palace.rs:840 memory_delete */
export function memoryDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('memory_delete', { id });
}

/**
 * @see src-tauri/src/memory_palace.rs:857 memory_consolidate_now
 * Rust signature: `memory_consolidate_now(conversation: String) -> Result<Option<String>, String>`.
 * Returns the newly-consolidated episode title, or null if nothing was extracted.
 */
export function memoryConsolidateNow(conversation: string): Promise<string | null> {
  return invokeTyped<string | null, { conversation: string }>('memory_consolidate_now', {
    conversation,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// typed_memory.rs — 5 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/typed_memory.rs:544 memory_store_typed
 * Rust signature: `memory_store_typed(category, content, source: Option<String>, confidence: Option<f64>) -> Result<String, String>`.
 */
export function memoryStoreTyped(args: {
  category: string;
  content: string;
  source?: string;
  confidence?: number;
}): Promise<string> {
  return invokeTyped<
    string,
    { category: string; content: string; source?: string; confidence?: number }
  >('memory_store_typed', {
    category: args.category,
    content: args.content,
    source: args.source,
    confidence: args.confidence,
  });
}

/**
 * @see src-tauri/src/typed_memory.rs:557 memory_recall_category
 * Rust signature: `memory_recall_category(category: String, limit: Option<usize>) -> Vec<TypedMemory>`.
 */
export function memoryRecallCategory(args: {
  category: string;
  limit?: number;
}): Promise<TypedMemory[]> {
  return invokeTyped<TypedMemory[], { category: string; limit?: number }>(
    'memory_recall_category',
    { category: args.category, limit: args.limit },
  );
}

/** @see src-tauri/src/typed_memory.rs:567 memory_get_all_typed */
export function memoryGetAllTyped(): Promise<TypedMemory[]> {
  return invokeTyped<TypedMemory[]>('memory_get_all_typed', {});
}

/** @see src-tauri/src/typed_memory.rs:573 memory_delete_typed */
export function memoryDeleteTyped(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('memory_delete_typed', { id });
}

/** @see src-tauri/src/typed_memory.rs:579 memory_generate_user_summary */
export function memoryGenerateUserSummary(): Promise<string> {
  return invokeTyped<string>('memory_generate_user_summary', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// screen_timeline_commands.rs — 14 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/screen_timeline_commands.rs:14 timeline_search_cmd
 * Rust signature: `timeline_search_cmd(store, query: String, limit: Option<usize>) -> Result<Vec<ScreenTimelineEntry>, String>`.
 */
export function timelineSearchCmd(args: { query: string; limit?: number }): Promise<TimelineEntry[]> {
  return invokeTyped<TimelineEntry[], { query: string; limit?: number }>('timeline_search_cmd', {
    query: args.query,
    limit: args.limit,
  });
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:25 timeline_browse_cmd
 * Rust signature: `timeline_browse_cmd(date: Option<String>, offset: Option<usize>, limit: Option<usize>) -> Vec<ScreenTimelineEntry>`.
 */
export function timelineBrowseCmd(args?: {
  date?: string;
  offset?: number;
  limit?: number;
}): Promise<TimelineEntry[]> {
  return invokeTyped<TimelineEntry[], { date?: string; offset?: number; limit?: number }>(
    'timeline_browse_cmd',
    { date: args?.date, offset: args?.offset, limit: args?.limit },
  );
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:35 timeline_get_screenshot
 * Returns a base64-encoded JPEG payload for the screenshot file bytes.
 */
export function timelineGetScreenshot(id: number): Promise<string> {
  return invokeTyped<string, { id: number }>('timeline_get_screenshot', { id });
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:44 timeline_get_thumbnail
 * Returns a base64-encoded JPEG payload for the thumbnail bytes (falls back to screenshot).
 */
export function timelineGetThumbnail(id: number): Promise<string> {
  return invokeTyped<string, { id: number }>('timeline_get_thumbnail', { id });
}

/** @see src-tauri/src/screen_timeline_commands.rs:58 timeline_get_config */
export function timelineGetConfig(): Promise<TimelineConfig> {
  return invokeTyped<TimelineConfig>('timeline_get_config', {});
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:69 timeline_set_config
 * Rust signature: `timeline_set_config(app, enabled: Option<bool>, capture_interval_secs: Option<u32>, retention_days: Option<u32>) -> Result<TimelineConfig, String>`.
 */
export function timelineSetConfig(args: {
  enabled?: boolean;
  captureIntervalSecs?: number;
  retentionDays?: number;
}): Promise<TimelineConfig> {
  return invokeTyped<
    TimelineConfig,
    { enabled?: boolean; capture_interval_secs?: number; retention_days?: number }
  >('timeline_set_config', {
    enabled: args.enabled,
    capture_interval_secs: args.captureIntervalSecs,
    retention_days: args.retentionDays,
  });
}

/** @see src-tauri/src/screen_timeline_commands.rs:99 timeline_get_stats_cmd */
export function timelineGetStatsCmd(): Promise<TimelineStats> {
  return invokeTyped<TimelineStats>('timeline_get_stats_cmd', {});
}

/** @see src-tauri/src/screen_timeline_commands.rs:105 timeline_cleanup */
export function timelineCleanup(): Promise<void> {
  return invokeTyped<void>('timeline_cleanup', {});
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:118 timeline_search_everything
 * Rust signature: `timeline_search_everything(store, query: String, limit: Option<usize>) -> Result<Vec<UnifiedSearchResult>, String>`.
 */
export function timelineSearchEverything(args: {
  query: string;
  limit?: number;
}): Promise<UnifiedSearchResult[]> {
  return invokeTyped<UnifiedSearchResult[], { query: string; limit?: number }>(
    'timeline_search_everything',
    { query: args.query, limit: args.limit },
  );
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:134 timeline_get_audio
 * Rust signature: `timeline_get_audio(store, query: Option<String>, from_ts: Option<i64>, to_ts: Option<i64>, offset: Option<usize>, limit: Option<usize>) -> Result<Vec<AudioTimelineEntry>, String>`.
 */
export function timelineGetAudio(args?: {
  query?: string;
  fromTs?: number;
  toTs?: number;
  offset?: number;
  limit?: number;
}): Promise<AudioTimelineEntry[]> {
  return invokeTyped<
    AudioTimelineEntry[],
    { query?: string; from_ts?: number; to_ts?: number; offset?: number; limit?: number }
  >('timeline_get_audio', {
    query: args?.query,
    from_ts: args?.fromTs,
    to_ts: args?.toTs,
    offset: args?.offset,
    limit: args?.limit,
  });
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:153 timeline_meeting_summary
 * Rust signature: `timeline_meeting_summary(meeting_id: String) -> Result<MeetingSummary, String>`.
 */
export function timelineMeetingSummary(meetingId: string): Promise<MeetingSummary> {
  return invokeTyped<MeetingSummary, { meeting_id: string }>('timeline_meeting_summary', {
    meeting_id: meetingId,
  });
}

/**
 * @see src-tauri/src/screen_timeline_commands.rs:161 timeline_get_action_items
 * Returns `Vec<serde_json::Value>` — free-form action-item entries.
 */
export function timelineGetActionItems(limit?: number): Promise<Record<string, unknown>[]> {
  return invokeTyped<Record<string, unknown>[], { limit?: number }>(
    'timeline_get_action_items',
    { limit },
  );
}

/** @see src-tauri/src/screen_timeline_commands.rs:167 timeline_set_audio_capture */
export function timelineSetAudioCapture(enabled: boolean): Promise<void> {
  return invokeTyped<void, { enabled: boolean }>('timeline_set_audio_capture', { enabled });
}

/** @see src-tauri/src/screen_timeline_commands.rs:182 timeline_detect_meeting */
export function timelineDetectMeeting(): Promise<boolean> {
  return invokeTyped<boolean>('timeline_detect_meeting', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// document_intelligence.rs — 8 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/document_intelligence.rs:790 doc_ingest
 * Rust signature: `doc_ingest(file_path: String) -> Result<Document, String>`.
 */
export function docIngest(filePath: string): Promise<DocumentEntry> {
  return invokeTyped<DocumentEntry, { file_path: string }>('doc_ingest', { file_path: filePath });
}

/** @see src-tauri/src/document_intelligence.rs:795 doc_search */
export function docSearch(query: string): Promise<DocumentEntry[]> {
  return invokeTyped<DocumentEntry[], { query: string }>('doc_search', { query });
}

/**
 * @see src-tauri/src/document_intelligence.rs:801 doc_get
 * Returns `Option<Document>`.
 */
export function docGet(id: string): Promise<DocumentEntry | null> {
  return invokeTyped<DocumentEntry | null, { id: string }>('doc_get', { id });
}

/**
 * @see src-tauri/src/document_intelligence.rs:815 doc_list
 * Rust signature: `doc_list(limit: Option<usize>) -> Vec<Document>`.
 */
export function docList(limit?: number): Promise<DocumentEntry[]> {
  return invokeTyped<DocumentEntry[], { limit?: number }>('doc_list', { limit });
}

/** @see src-tauri/src/document_intelligence.rs:821 doc_delete */
export function docDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('doc_delete', { id });
}

/**
 * @see src-tauri/src/document_intelligence.rs:827 doc_answer_question
 * Rust signature: `doc_answer_question(question: String, doc_ids: Option<Vec<String>>) -> Result<DocQA, String>`.
 */
export function docAnswerQuestion(args: {
  question: string;
  docIds?: string[];
}): Promise<DocQA> {
  return invokeTyped<DocQA, { question: string; doc_ids?: string[] }>('doc_answer_question', {
    question: args.question,
    doc_ids: args.docIds,
  });
}

/**
 * @see src-tauri/src/document_intelligence.rs:835 doc_cross_synthesis
 * Returns a raw synthesised-answer string across all documents.
 */
export function docCrossSynthesis(question: string): Promise<string> {
  return invokeTyped<string, { question: string }>('doc_cross_synthesis', { question });
}

/** @see src-tauri/src/document_intelligence.rs:840 doc_generate_study_notes */
export function docGenerateStudyNotes(docId: string): Promise<string> {
  return invokeTyped<string, { doc_id: string }>('doc_generate_study_notes', { doc_id: docId });
}

// ═══════════════════════════════════════════════════════════════════════════
// memory.rs — 4 commands (memory log + core memory blocks)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/memory.rs:576 get_memory_log
 * Returns up to the last 30 memory-log lines as parsed JSON entries.
 */
export function getMemoryLog(): Promise<Record<string, unknown>[]> {
  return invokeTyped<Record<string, unknown>[]>('get_memory_log', {});
}

/**
 * @see src-tauri/src/memory.rs:787 get_memory_blocks
 * Returns `{ human, persona, conversation }` block contents.
 */
export function getMemoryBlocks(): Promise<MemoryBlocks> {
  return invokeTyped<MemoryBlocks>('get_memory_blocks', {});
}

/**
 * @see src-tauri/src/memory.rs:798 set_memory_block
 * Rust signature: `set_memory_block(block: String, content: String) -> Result<(), String>`.
 * `block` must be one of "human" | "persona" | "conversation".
 */
export function setMemoryBlock(args: {
  block: 'human' | 'persona' | 'conversation';
  content: string;
}): Promise<void> {
  return invokeTyped<void, { block: string; content: string }>('set_memory_block', {
    block: args.block,
    content: args.content,
  });
}

/** @see src-tauri/src/memory.rs:781 run_weekly_memory_consolidation */
export function runWeeklyMemoryConsolidation(): Promise<string> {
  return invokeTyped<string>('run_weekly_memory_consolidation', {});
}
