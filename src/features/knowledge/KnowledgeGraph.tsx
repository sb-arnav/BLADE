// src/features/knowledge/KnowledgeGraph.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-05 (KNOW-02: graph_search_nodes + graph_get_stats +
// deterministic layout per D-137).
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-137
// @see .planning/REQUIREMENTS.md §KNOW-02

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function KnowledgeGraph() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="knowledge-graph-placeholder">
        <h2>Knowledge Graph</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-05.</p>
      </div>
    </GlassPanel>
  );
}
