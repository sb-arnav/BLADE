// src/features/knowledge/CodebaseExplorer.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-06 (KNOW-09: doc_list + doc_search + semantic_search
// for codebase exploration).
// @see .planning/REQUIREMENTS.md §KNOW-09

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function CodebaseExplorer() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="codebase-explorer-placeholder">
        <h2>Codebase Explorer</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-06.</p>
      </div>
    </GlassPanel>
  );
}
