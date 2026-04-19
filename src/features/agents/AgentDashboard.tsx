// src/features/agents/AgentDashboard.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-03 (AGENT-01: live agent list + filter).
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-120, §D-131
// @see .planning/REQUIREMENTS.md §AGENT-01

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function AgentDashboard() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="agent-dashboard-placeholder">
        <h2>Agents</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-03.</p>
      </div>
    </GlassPanel>
  );
}
