// src/features/knowledge/KnowledgeBase.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-05 (KNOW-01: db_search_knowledge + semantic_search +
// timeline_search_cmd grouped per D-138).
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-138
// @see .planning/REQUIREMENTS.md §KNOW-01

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function KnowledgeBase() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="knowledge-base-placeholder">
        <h2>Knowledge Base</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-05.</p>
      </div>
    </GlassPanel>
  );
}
