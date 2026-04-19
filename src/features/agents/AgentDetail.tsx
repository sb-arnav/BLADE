// src/features/agents/AgentDetail.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-03 (AGENT-02: blade_agent_event + agent_step_* timeline).
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-125
// @see .planning/REQUIREMENTS.md §AGENT-02

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function AgentDetail() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="agent-detail-placeholder">
        <h2>Agent Detail</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-03.</p>
      </div>
    </GlassPanel>
  );
}
