// src/features/activity-log/ActivityDrawer.tsx
//
// Phase 14 Plan 14-01 (LOG-03, A11Y2-04).
// Full-payload drawer using native Dialog primitive (browser focus trap).
// Module filter + timestamp display + payload_id chip.

import { useState, useMemo } from 'react';
import { Dialog } from '@/design-system/primitives';
import { useActivityLog } from './index';

interface ActivityDrawerProps {
  open: boolean;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function ActivityDrawer({ open, onClose }: ActivityDrawerProps) {
  const { log, clearLog } = useActivityLog();
  const [moduleFilter, setModuleFilter] = useState('');

  // Collect unique module names for filter dropdown
  const modules = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of log) seen.add(entry.module);
    return Array.from(seen).sort();
  }, [log]);

  const filtered = moduleFilter
    ? log.filter((e) => e.module === moduleFilter)
    : log;

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Activity log">
      <div className="activity-drawer-header">
        <h2 className="activity-drawer-title">Activity Log</h2>
        <div className="activity-drawer-controls">
          <select
            className="activity-drawer-filter"
            aria-label="Filter by module"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            className="activity-drawer-filter"
            onClick={clearLog}
            aria-label="Clear activity log"
          >
            Clear
          </button>
          <button
            className="activity-drawer-filter"
            onClick={onClose}
            aria-label="Close activity log"
          >
            Close
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="activity-drawer-empty">No activity recorded yet</div>
      ) : (
        <ul className="activity-drawer-list" aria-label="Activity entries">
          {filtered.map((entry, i) => (
            <li key={`${entry.timestamp}-${i}`} className="activity-drawer-row">
              <span className="activity-drawer-module-badge">{entry.module}</span>
              <span className="activity-drawer-action">{entry.action}</span>
              <span className="activity-drawer-summary">{entry.human_summary}</span>
              <span className="activity-drawer-timestamp">
                {formatTimestamp(entry.timestamp)}
              </span>
              {entry.payload_id && (
                <span
                  className="activity-drawer-payload-chip"
                  title={entry.payload_id}
                >
                  {entry.payload_id}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
