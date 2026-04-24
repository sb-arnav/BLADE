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
import { useConfig, useToast } from '@/lib/context';
import { saveConfigField } from '@/lib/tauri';

const GOD_MODE_TIERS = [
  { value: 'normal',       label: 'Normal — passive observation only' },
  { value: 'intermediate', label: 'Intermediate — suggestions + light automation' },
  { value: 'extreme',      label: 'Extreme — full ambient intelligence + autonomous actions' },
];

const TYPOGRAPHY = [
  { role: 'Display',    font: 'Syne',           size: 'var(--fs-display)'  },
  { role: 'Headings',   font: 'Bricolage Grotesque', size: 'var(--fs-h1)' },
  { role: 'Body',       font: 'Fraunces',        size: 'var(--fs-body)'    },
  { role: 'Code',       font: 'JetBrains Mono',  size: 'var(--fs-code)'    },
];

export function AppearancePane() {
  const { resetPrefs } = usePrefs();
  const { config, reload } = useConfig();
  const { show } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Phase 14 Plan 14-02 — God Mode controls
  const [godMode, setGodMode] = useState<boolean>(Boolean(config.god_mode));
  const [godModeTier, setGodModeTier] = useState<string>(
    typeof config.god_mode_tier === 'string' ? config.god_mode_tier : 'normal',
  );
  const [savingField, setSavingField] = useState<string | null>(null);

  const saveField = async (field: string, value: string) => {
    setSavingField(field);
    try {
      await saveConfigField(field, value);
      await reload();
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSavingField(null);
    }
  };

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

      {/* God Mode — Phase 14 Plan 14-02 (WIRE2-04) */}
      <Card>
        <section aria-labelledby="god-mode-heading">
          <h3 id="god-mode-heading">God Mode</h3>

          <div className="settings-field">
            <label
              htmlFor="god-mode-enabled"
              className="settings-field-label"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}
            >
              <input
                id="god-mode-enabled"
                type="checkbox"
                checked={godMode}
                aria-label="Enable ambient intelligence (God Mode)"
                aria-describedby="god-mode-desc"
                disabled={savingField === 'god_mode'}
                onChange={(e) => {
                  setGodMode(e.target.checked);
                  saveField('god_mode', String(e.target.checked));
                }}
                style={{ width: 16, height: 16, accentColor: 'var(--a-cool)', cursor: 'pointer' }}
              />
              Enable ambient intelligence
            </label>
            <p id="god-mode-desc" className="settings-notice" style={{ marginTop: 'var(--s-1)' }}>
              BLADE monitors screen, audio, and clipboard context to provide proactive assistance.
            </p>
          </div>

          {godMode && (
            <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
              <label htmlFor="god-mode-tier" className="settings-field-label">
                Intelligence tier
              </label>
              <select
                id="god-mode-tier"
                value={godModeTier}
                aria-label="God Mode intelligence tier"
                disabled={savingField === 'god_mode_tier'}
                onChange={(e) => {
                  setGodModeTier(e.target.value);
                  saveField('god_mode_tier', e.target.value);
                }}
              >
                {GOD_MODE_TIERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          )}
        </section>
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
