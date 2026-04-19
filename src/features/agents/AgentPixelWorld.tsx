// src/features/agents/AgentPixelWorld.tsx — Phase 5 Plan 05-02 placeholder.
// Real body ships in Plan 05-04 (AGENT-09: 9-emoji role grid with hormone tints).
// @see .planning/REQUIREMENTS.md §AGENT-09

import { GlassPanel } from '@/design-system/primitives';
import './agents.css';

export function AgentPixelWorld() {
  return (
    <GlassPanel tier={1} className="agents-surface">
      <div className="agents-placeholder" data-testid="agent-pixel-world-placeholder">
        <h2>Pixel World</h2>
        <p className="agents-placeholder-hint">Ships in Plan 05-04.</p>
      </div>
    </GlassPanel>
  );
}
