// src/features/knowledge/ConversationInsights.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-06 (KNOW-08: db_list_conversations + semantic_search
// for cross-conversation themes).
// @see .planning/REQUIREMENTS.md §KNOW-08

import { GlassPanel } from '@/design-system/primitives';
import './knowledge.css';

export function ConversationInsights() {
  return (
    <GlassPanel tier={1} className="knowledge-surface">
      <div className="knowledge-placeholder" data-testid="conversation-insights-placeholder">
        <h2>Conversation Insights</h2>
        <p className="knowledge-placeholder-hint">Ships in Plan 05-06.</p>
      </div>
    </GlassPanel>
  );
}
