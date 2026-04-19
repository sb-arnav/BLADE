// src/features/knowledge/MemoryPalace.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-06 (KNOW-03: 7-tab typed_memory layout via
// memory_search / memory_recall_category / memory_get_all_typed).
// @see .planning/REQUIREMENTS.md §KNOW-03

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function MemoryPalace() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="memory-palace-placeholder">
        <h2>Memory Palace</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-06.</p>
      </div>
    </GlassPanel>
  );
}
