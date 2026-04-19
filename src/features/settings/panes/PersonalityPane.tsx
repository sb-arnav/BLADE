// src/features/settings/panes/PersonalityPane.tsx — SET-05 (D-85).
//
// Exposes user_name / work_mode / response_style / blade_email. Saves via
// setConfig (commands.rs:1944 accepts all four). Re-run onboarding button
// calls resetOnboarding() which flips persona_onboarding_complete back to
// false — the next MainShell render observes the gate transitioning to
// `needs_persona` and routes the user back to the persona flow.
//
// Destructive action "Re-run onboarding" is gated by a confirmation Dialog
// (T-03-06-03 mitigation).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-85
// @see src-tauri/src/commands.rs:1944 set_config
// @see src-tauri/src/commands.rs:1989 reset_onboarding

import { useState } from 'react';
import { Button, Card, Dialog, Input } from '@/design-system/primitives';
import { setConfig, resetOnboarding } from '@/lib/tauri';
import { useConfig, useToast } from '@/lib/context';

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

const WORK_MODES = [
  { value: '',                  label: '— Unset —' },
  { value: 'focus',             label: 'Focus (deep work)' },
  { value: 'collaborate',       label: 'Collaborate (meetings, chat)' },
  { value: 'learning',          label: 'Learning' },
  { value: 'create',            label: 'Create (writing, design)' },
  { value: 'admin',             label: 'Admin (email, triage)' },
];

const RESPONSE_STYLES = [
  { value: '',          label: '— Default —' },
  { value: 'concise',   label: 'Concise' },
  { value: 'balanced',  label: 'Balanced' },
  { value: 'detailed',  label: 'Detailed' },
  { value: 'playful',   label: 'Playful' },
];

export function PersonalityPane() {
  const { config, reload } = useConfig();
  const { show } = useToast();

  const [userName, setUserName] = useState<string>(asString(config.user_name));
  const [workMode, setWorkMode] = useState<string>(asString(config.work_mode));
  const [responseStyle, setResponseStyle] = useState<string>(asString(config.response_style));
  const [bladeEmail, setBladeEmail] = useState<string>(asString(config.blade_email));
  const [saving, setSaving] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setConfig({
        provider: config.provider,
        apiKey: '', // preserves keyring (commands.rs:1967 guard)
        model: config.model,
        userName: userName || undefined,
        workMode: workMode || undefined,
        responseStyle: responseStyle || undefined,
        bladeEmail: bladeEmail || undefined,
      });
      await reload();
      show({ type: 'success', title: 'Personality saved' });
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleResetConfirm = async () => {
    setResetting(true);
    try {
      await resetOnboarding();
      await reload();
      setConfirmOpen(false);
      show({
        type: 'success',
        title: 'Onboarding reset',
        message: 'You will be routed back to the persona flow on next shell render.',
      });
    } catch (e) {
      show({ type: 'error', title: 'Reset failed', message: String(e) });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="settings-section">
      <h2>Personality</h2>
      <p>How BLADE addresses you, what work mode it assumes, and how verbose its replies are.</p>

      <Card>
        <h3>Identity</h3>

        <div className="settings-field">
          <label htmlFor="user-name" className="settings-field-label">Your name</label>
          <Input
            id="user-name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Arnav"
            disabled={saving}
          />
        </div>

        <div className="settings-field" style={{ marginTop: 12 }}>
          <label htmlFor="blade-email" className="settings-field-label">Your email (for drafts)</label>
          <Input
            id="blade-email"
            type="email"
            value={bladeEmail}
            onChange={(e) => setBladeEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={saving}
          />
        </div>
      </Card>

      <Card>
        <h3>Mode & style</h3>

        <div className="settings-field">
          <label htmlFor="work-mode" className="settings-field-label">Work mode</label>
          <select
            id="work-mode"
            value={workMode}
            onChange={(e) => setWorkMode(e.target.value)}
            disabled={saving}
          >
            {WORK_MODES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-field" style={{ marginTop: 12 }}>
          <label htmlFor="response-style" className="settings-field-label">Response style</label>
          <select
            id="response-style"
            value={responseStyle}
            onChange={(e) => setResponseStyle(e.target.value)}
            disabled={saving}
          >
            {RESPONSE_STYLES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </Card>

      <div className="settings-actions">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          Save personality
        </Button>
      </div>

      <Card>
        <h3>Re-run persona onboarding</h3>
        <p>Walks you back through the persona questions. Your provider keys and routing are preserved.</p>
        <div className="settings-actions left">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={resetting}
          >
            Re-run onboarding
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        ariaLabel="Confirm re-run onboarding"
      >
        <h3>Re-run onboarding?</h3>
        <p>
          This clears your persona answers. On next shell render BLADE will route
          you back to the persona step. Provider keys and routing are kept.
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
            onClick={handleResetConfirm}
            disabled={resetting}
          >
            {resetting ? 'Resetting…' : 'Re-run'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
