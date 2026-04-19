// src/features/admin/McpSettings.tsx — placeholder shipped by Plan 07-02.
// Real body ships in Plan 07-06.
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §4 (Dialog-gated remove)
import { GlassPanel } from '@/design-system/primitives';
import './admin.css';

export function McpSettings() {
  return (
    <GlassPanel tier={1} className="admin-surface">
      <div className="admin-placeholder" data-testid="mcp-settings-placeholder">
        <h2>MCP Servers</h2>
        <p className="admin-placeholder-hint">Ships in Plan 07-06.</p>
      </div>
    </GlassPanel>
  );
}
