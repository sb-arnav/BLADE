// src/features/settings/panes/DeveloperPane.tsx — Phase 59 Plan 59-02 (TRIO-DEMOTE-NAV).
//
// Settings "Developer" section. Surfaces a one-click handoff to the
// /dev-tools route, plus a short list of the v2.0-held trio that's now hosted
// there. This is the second discoverability path the REQ requires (the first
// is the ⌘K palette entry "Open Developer Tools").
//
// Pure static content + one openRoute() call. No new commands, no new state.
//
// @see .planning/milestones/v2.2-REQUIREMENTS.md §Phase 59 TRIO-DEMOTE-NAV
// @see .planning/decisions.md (2026-05-14 — held-trio reorganized into /dev-tools)

import { Card, Button } from '@/design-system/primitives';
import { useRouterCtx } from '@/windows/main/useRouter';

const HELD_TRIO = [
  { name: 'Body Map',           note: '12-system body visualisation root.' },
  { name: 'Organ Registry',     note: 'Per-organ autonomy + status registry.' },
  { name: 'Pixel World',        note: 'Agent role grid (3×3 hormone cells).' },
  { name: 'Tentacle Detail',    note: 'Single-tentacle drill-in + autonomy.' },
  { name: 'Mortality Salience', note: 'TMT-shape behavioural scalar (read-only).' },
  { name: 'Ghost Mode',         note: 'Meeting overlay configuration view.' },
];

export function DeveloperPane() {
  const { openRoute } = useRouterCtx();

  return (
    <div className="settings-section" data-testid="settings-developer-pane">
      <h2>Developer</h2>
      <p>
        Held-for-evaluation surfaces. These features ship as code; the
        external-operator engagement data verdict is pending.
        See <code>.planning/decisions.md</code> (entry 2026-05-14) for the
        reorganisation note.
      </p>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <strong>Developer Tools pane</strong>
            <p style={{ margin: '4px 0 0', color: 'var(--t-3)', fontSize: '0.85rem' }}>
              Single route hosting the six held-trio surfaces under sub-tabs.
            </p>
          </div>
          <div>
            <Button
              variant="primary"
              onClick={() => openRoute('dev-tools')}
              data-testid="settings-developer-open"
            >
              Open Developer Tools
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>What lives there</h3>
        <ul style={{ paddingLeft: '1.2em', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {HELD_TRIO.map((t) => (
            <li key={t.name}>
              <strong>{t.name}</strong>
              <span style={{ color: 'var(--t-3)' }}> — {t.note}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
