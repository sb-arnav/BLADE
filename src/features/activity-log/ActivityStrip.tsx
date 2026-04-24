// src/features/activity-log/ActivityStrip.tsx
//
// Phase 14 Plan 14-01 (LOG-01).
// Persistent thin strip mounted between TitleBar and main-shell-body.
// Visible on every route without unmounting.
// Clicking opens ActivityDrawer for full payload view.

import { useState } from 'react';
import { useActivityLog } from './index';
import { ActivityDrawer } from './ActivityDrawer';
import './activity-log.css';

export function ActivityStrip() {
  const { log } = useActivityLog();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const latest = log[0];
  const extraCount = log.length - 1;

  return (
    <>
      <div
        className="activity-strip"
        onClick={() => setDrawerOpen(true)}
        role="button"
        tabIndex={0}
        aria-label="Activity log — click to expand"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setDrawerOpen(true);
          }
        }}
      >
        {log.length === 0 ? (
          <span className="activity-strip-empty">BLADE is idle</span>
        ) : (
          <>
            <span className="activity-strip-module">[{latest.module}]</span>
            <span className="activity-strip-entry">{latest.human_summary}</span>
            {extraCount > 0 && (
              <span className="activity-strip-count">+{extraCount} more</span>
            )}
          </>
        )}
      </div>
      <ActivityDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
