// src/features/settings/panes/VoicePane.tsx — SET-04 (D-84).
//
// Voice settings surface. CRITICAL Rust write-surface constraint:
//
//   voice_mode, tts_voice, voice_shortcut, quick_ask_shortcut are ONLY
//   writable via `set_config` (commands.rs:1944). They are NOT in the
//   `save_config_field` allow-list (config.rs:728-752), so calling
//   `saveConfigField('voice_mode', ...)` throws "Unknown config field".
//
//   wake_word_enabled has NO Rust setter — neither set_config nor
//   save_config_field accept it. Phase 3 displays it READ-ONLY; a toggle
//   command ships in Phase 4.
//
// Pattern: `setConfig({ provider, apiKey: '', model, voiceMode, ttsVoice,
// voiceShortcut, quickAskShortcut })` — provider/model carry the existing
// values untouched, apiKey: '' preserves keyring (commands.rs:1967).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-84, §D-66
// @see src-tauri/src/commands.rs:1944 set_config (voice fields here)
// @see src-tauri/src/config.rs:728 save_config_field (NO voice fields)

import { useState } from 'react';
import { Button, Card, Input, Pill } from '@/design-system/primitives';
import { setConfig } from '@/lib/tauri';
import { useConfig, useToast } from '@/lib/context';

const VOICE_MODES = [
  { value: 'off',             label: 'Off' },
  { value: 'push_to_talk',    label: 'Push-to-talk' },
  { value: 'conversational',  label: 'Always-on conversational' },
];

const TTS_VOICES = [
  { value: 'system',  label: 'System default' },
  { value: 'alloy',   label: 'Alloy (OpenAI)' },
  { value: 'echo',    label: 'Echo (OpenAI)' },
  { value: 'nova',    label: 'Nova (OpenAI)' },
  { value: 'shimmer', label: 'Shimmer (OpenAI)' },
  { value: 'onyx',    label: 'Onyx (OpenAI)' },
];

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function VoicePane() {
  const { config, reload } = useConfig();
  const { show } = useToast();

  const [voiceMode, setVoiceMode] = useState<string>(asString(config.voice_mode, 'off'));
  const [ttsVoice, setTtsVoice] = useState<string>(asString(config.tts_voice, 'system'));
  const [voiceShortcut, setVoiceShortcut] = useState<string>(asString(config.voice_shortcut));
  const [quickAskShortcut, setQuickAskShortcut] = useState<string>(asString(config.quick_ask_shortcut));
  const [saving, setSaving] = useState(false);

  const wakeWordEnabled = Boolean(config.wake_word_enabled);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Voice fields go through set_config, NOT save_config_field. The
      // save_config_field allow-list at config.rs:728-752 does NOT include
      // voice_mode / tts_voice / voice_shortcut / quick_ask_shortcut —
      // calling saveConfigField() for these throws at runtime.
      await setConfig({
        provider: config.provider,
        apiKey: '', // preserves keyring (commands.rs:1967 guard)
        model: config.model,
        voiceMode,
        ttsVoice,
        voiceShortcut: voiceShortcut || undefined,
        quickAskShortcut: quickAskShortcut || undefined,
      });
      await reload();
      show({ type: 'success', title: 'Voice settings saved' });
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h2>Voice</h2>
      <p>Voice capture mode, TTS voice, and shortcut bindings. Live TTS preview ships in Phase 4 (voice orb wiring).</p>

      <Card>
        <h3>Capture & TTS</h3>

        <div className="settings-field">
          <label htmlFor="voice-mode" className="settings-field-label">Voice mode</label>
          <select
            id="voice-mode"
            value={voiceMode}
            onChange={(e) => setVoiceMode(e.target.value)}
            disabled={saving}
          >
            {VOICE_MODES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="settings-field" style={{ marginTop: 12 }}>
          <label htmlFor="tts-voice" className="settings-field-label">TTS voice</label>
          <select
            id="tts-voice"
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            disabled={saving}
          >
            {TTS_VOICES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <h3>Shortcuts</h3>
        <p>Global hotkeys for push-to-talk and Quick Ask (e.g. <code>Cmd+Shift+Space</code>). Takes effect on app restart.</p>

        <div className="settings-field">
          <label htmlFor="voice-shortcut" className="settings-field-label">Voice shortcut</label>
          <Input
            id="voice-shortcut"
            value={voiceShortcut}
            onChange={(e) => setVoiceShortcut(e.target.value)}
            placeholder="Cmd+Shift+V"
            disabled={saving}
          />
        </div>

        <div className="settings-field" style={{ marginTop: 12 }}>
          <label htmlFor="quick-ask-shortcut" className="settings-field-label">Quick Ask shortcut</label>
          <Input
            id="quick-ask-shortcut"
            value={quickAskShortcut}
            onChange={(e) => setQuickAskShortcut(e.target.value)}
            placeholder="Cmd+Shift+Space"
            disabled={saving}
          />
        </div>
      </Card>

      <Card>
        <h3>Wake word</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <Pill tone={wakeWordEnabled ? 'free' : 'default'}>
            Wake word: {wakeWordEnabled ? 'enabled' : 'disabled'}
          </Pill>
        </div>
        <div className="settings-notice">
          Toggle wired in Phase 4 — requires a new Rust setter command
          (<code>set_config</code> and <code>save_config_field</code> do not accept <code>wake_word_enabled</code>).
        </div>
      </Card>

      <div className="settings-actions">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          Save voice settings
        </Button>
      </div>
    </div>
  );
}
