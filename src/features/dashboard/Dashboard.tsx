// src/features/dashboard/Dashboard.tsx — composed dashboard surface (D-76).
//
// Layout per D-76 12-column grid:
//   Row 1: RightNowHero (col-span 8) + reserved column (col-span 4, empty
//          for now — Phase 5+ will fill with hero secondary actions)
//   Row 2: AmbientStrip (col-span 12, full width)
//   Row 3: 3× ComingSoonCard (col-span 4 each — Hive / Calendar / Integrations)
//
// NOT wrapped in GlassPanel — the MainShell's .main-shell-route slot already
// lives inside the shell glass. Adding another wrapping glass layer here
// would breach D-07 (3-blur cap per viewport: NavRail + TitleBar + shell
// glass = 3 already). Dashboard is a plain div; children GlassPanels in
// ComingSoonCard don't add blur to the dashboard region itself — they're
// inside glass-nested and handled by the existing `.glass` fallback rules.
//
// All spacing + grid math lives in dashboard.css using layout.css tokens —
// zero hardcoded px widths (plan must-have truth).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-76

import { RightNowHero } from './RightNowHero';
import { AmbientStrip } from './AmbientStrip';
import { TentacleSignalsCard } from './TentacleSignalsCard';
import { CalendarCard } from './CalendarCard';
import { IntegrationsCard } from './IntegrationsCard';

export function Dashboard() {
  return (
    <div className="dashboard" data-dashboard-surface>
      <div className="dashboard-grid">
        <div className="dash-hero-slot">
          <RightNowHero />
        </div>
        <div className="dash-reserved-slot" aria-hidden="true" />
        <div className="ambient-strip-slot">
          <AmbientStrip />
        </div>
        <TentacleSignalsCard />
        <CalendarCard />
        <IntegrationsCard />
      </div>
    </div>
  );
}
