// src/features/settings/panes/AppearancePane.tsx — SET-06 (D-86).
//
// Minimal per D-15: no light theme, no accent picker. Static readout + one
// destructive "Reset preferences" action (behind confirmation Dialog).
//
// The "prefs" blob (blade_prefs_v1) is a pure-frontend localStorage key (D-12)
// — this does NOT touch any Rust config. `usePrefs().resetPrefs()` wipes the
// blob.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-86, §D-15
// @see src/hooks/usePrefs.ts resetPrefs

import { useState } from 'react';
import { Button, Card, Dialog, Pill } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';

const TYPOGRAPHY = [
  { role: 'Display',    font: 'Syne',           size: 'var(--fs-display)'  },
  { role: 'Headings',   font: 'Bricolage Grotesque', size: 'var(--fs-h1)' },
  { role: 'Body',       font: 'Fraunces',        size: 'var(--fs-body)'    },
  { role: 'Code',       font: 'JetBrains Mono',  size: 'var(--fs-code)'    },
];

export function AppearancePane() {
  const { resetPrefs } = usePrefs();
  const { show } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = () => {
    setResetting(true);
    try {
      resetPrefs();
      setConfirmOpen(false);
      show({
        type: 'success',
        title: 'Preferences reset',
        message: 'Route state, palette recents, and toggles cleared.',
      });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="settings-section">
      <h2>Appearance</h2>
      <p>
        BLADE runs a single coherent dark theme. Per D-15 accent pickers and
        theme switchers are permanently out of scope — the Liquid Glass look is
        the product.
      </p>

      <Card>
        <h3>Theme</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Pill>Liquid Glass · Dark</Pill>
        </div>
        <p className="settings-notice">Locked per D-15. No light theme, no accent picker.</p>
      </Card>

      <Card>
        <h3>Typography</h3>
        <dl className="settings-readout">
          {TYPOGRAPHY.map((row) => (
            <div key={row.role} style={{ display: 'contents' }}>
              <dt>{row.role}</dt>
              <dd>
                {row.font} <span style={{ color: 'var(--t-3)' }}>· {row.size}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="settings-notice" style={{ marginTop: 12 }}>
          4 self-hosted WOFF2 fonts (D-24). Size tokens drive every heading/body
          rule in <code>tokens.css</code>.
        </p>
      </Card>

      <Card>
        <h3>Preferences</h3>
        <p>
          Resets the local <code>blade_prefs_v1</code> blob — last visited route,
          palette recents, and any chat/ghost toggles. Does not touch provider
          keys, config, or history.
        </p>
        <div className="settings-actions left">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={resetting}
          >
            Reset preferences
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        ariaLabel="Confirm reset preferences"
      >
        <h3>Reset preferences?</h3>
        <p>
          Wipes <code>blade_prefs_v1</code> from localStorage. Next launch starts on the
          default route; palette recents clear.
        </p>
        <div className="settings-dialog-actions">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(false)}
            disabled={resetting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleReset}
            disabled={resetting}
          >
            Reset
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
