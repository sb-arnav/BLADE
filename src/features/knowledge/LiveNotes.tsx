// src/features/knowledge/LiveNotes.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-06 (KNOW-06: db_list_knowledge + memory_add_manual
// for inline note capture).
// @see .planning/REQUIREMENTS.md §KNOW-06

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function LiveNotes() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="live-notes-placeholder">
        <h2>Live Notes</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-06.</p>
      </div>
    </GlassPanel>
  );
}
