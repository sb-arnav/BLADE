// src/features/knowledge/DailyLog.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-06 (KNOW-07: memory_search + db_list_knowledge
// filtered by date).
// @see .planning/REQUIREMENTS.md §KNOW-07

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function DailyLog() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="daily-log-placeholder">
        <h2>Daily Log</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-06.</p>
      </div>
    </GlassPanel>
  );
}
