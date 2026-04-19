// src/features/agents/AgentTeam.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-03 (AGENT-04: agent_list grouped by role).
// @see .planning/REQUIREMENTS.md §AGENT-04

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function AgentTeam() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="agent-team-placeholder">
        <h2>Agent Team</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-03.</p>
      </div>
    </GlassPanel>
  );
}
