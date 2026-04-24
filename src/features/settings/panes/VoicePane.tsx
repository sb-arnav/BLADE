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
import { setConfig, saveConfigField } from '@/lib/tauri';
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

const WHISPER_MODELS = [
  { value: 'tiny.en',  label: 'tiny.en  (fastest, lowest accuracy)' },
  { value: 'base.en',  label: 'base.en  (balanced)' },
  { value: 'small.en', label: 'small.en (most accurate, slowest)' },
];

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

export function VoicePane() {
  const { config, reload } = useConfig();
  const { show } = useToast();

  const [voiceMode, setVoiceMode] = useState<string>(asString(config.voice_mode, 'off'));
  const [ttsVoice, setTtsVoice] = useState<string>(asString(config.tts_voice, 'system'));
  const [voiceShortcut, setVoiceShortcut] = useState<string>(asString(config.voice_shortcut));
  const [quickAskShortcut, setQuickAskShortcut] = useState<string>(asString(config.quick_ask_shortcut));
  const [saving, setSaving] = useState(false);

  // Phase 14 Plan 14-02 — new saveConfigField-backed state
  const [ttsSpeed, setTtsSpeed] = useState<number>(asNumber(config.tts_speed, 1.0));
  const [useLocalWhisper, setUseLocalWhisper] = useState<boolean>(Boolean(config.use_local_whisper));
  const [whisperModel, setWhisperModel] = useState<string>(asString(config.whisper_model, 'tiny.en'));
  const [wakeWordEnabled, setWakeWordEnabled] = useState<boolean>(Boolean(config.wake_word_enabled));
  const [wakeWordPhrase, setWakeWordPhrase] = useState<string>(asString(config.wake_word_phrase, 'hey blade'));
  const [wakeWordSensitivity, setWakeWordSensitivity] = useState<number>(asNumber(config.wake_word_sensitivity, 3));
  const [savingField, setSavingField] = useState<string | null>(null);

  const saveField = async (field: string, value: string | number | boolean) => {
    setSavingField(field);
    try {
      await saveConfigField(field, String(value));
      await reload();
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSavingField(null);
    }
  };

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

      {/* Voice Output — Phase 14 Plan 14-02 (WIRE2-01) */}
      <Card>
        <h3>Voice Output</h3>

        <div className="settings-field">
          <label htmlFor="tts-speed" className="settings-field-label">
            TTS Speed <span style={{ color: 'var(--t-3)', fontWeight: 400 }}>({ttsSpeed.toFixed(1)}x)</span>
          </label>
          <input
            id="tts-speed"
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={ttsSpeed}
            aria-label="TTS playback speed"
            aria-valuemin={0.5}
            aria-valuemax={2.0}
            aria-valuenow={ttsSpeed}
            disabled={savingField === 'tts_speed'}
            onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
            onMouseUp={(e) => saveField('tts_speed', parseFloat((e.target as HTMLInputElement).value))}
            onKeyUp={() => saveField('tts_speed', ttsSpeed)}
            style={{ width: '100%', accentColor: 'var(--a-cool)' }}
          />
        </div>

        <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
          <label
            htmlFor="use-local-whisper"
            className="settings-field-label"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}
          >
            <input
              id="use-local-whisper"
              type="checkbox"
              checked={useLocalWhisper}
              aria-label="Use local Whisper for transcription"
              disabled={savingField === 'use_local_whisper'}
              onChange={(e) => {
                setUseLocalWhisper(e.target.checked);
                saveField('use_local_whisper', e.target.checked);
              }}
              style={{ width: 16, height: 16, accentColor: 'var(--a-cool)', cursor: 'pointer' }}
            />
            Use local Whisper
          </label>
          <p className="settings-notice" style={{ marginTop: 'var(--s-1)' }}>
            Requires a rebuild with the <code>local-whisper</code> feature flag. See repo README.
          </p>
        </div>

        {useLocalWhisper && (
          <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
            <label htmlFor="whisper-model" className="settings-field-label">Whisper model</label>
            <select
              id="whisper-model"
              value={whisperModel}
              aria-label="Local Whisper model size"
              disabled={savingField === 'whisper_model'}
              onChange={(e) => {
                setWhisperModel(e.target.value);
                saveField('whisper_model', e.target.value);
              }}
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {/* Wake Word — Phase 14 Plan 14-02 (WIRE2-01) */}
      <Card>
        <h3>Wake Word</h3>

        <div className="settings-field">
          <label
            htmlFor="wake-word-enabled"
            className="settings-field-label"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}
          >
            <input
              id="wake-word-enabled"
              type="checkbox"
              checked={wakeWordEnabled}
              aria-label="Enable wake word detection"
              disabled={savingField === 'wake_word_enabled'}
              onChange={(e) => {
                setWakeWordEnabled(e.target.checked);
                saveField('wake_word_enabled', e.target.checked);
              }}
              style={{ width: 16, height: 16, accentColor: 'var(--a-cool)', cursor: 'pointer' }}
            />
            Enable wake word
          </label>
        </div>

        {wakeWordEnabled && (
          <>
            <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
              <label htmlFor="wake-word-phrase" className="settings-field-label">Wake word phrase</label>
              <Input
                id="wake-word-phrase"
                value={wakeWordPhrase}
                placeholder="hey blade"
                aria-label="Wake word phrase"
                disabled={savingField === 'wake_word_phrase'}
                onChange={(e) => setWakeWordPhrase(e.target.value)}
                onBlur={() => saveField('wake_word_phrase', wakeWordPhrase)}
              />
            </div>

            <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
              <label htmlFor="wake-word-sensitivity" className="settings-field-label">
                Sensitivity <span style={{ color: 'var(--t-3)', fontWeight: 400 }}>(level {wakeWordSensitivity})</span>
              </label>
              <input
                id="wake-word-sensitivity"
                type="range"
                min={1}
                max={5}
                step={1}
                value={wakeWordSensitivity}
                aria-label="Wake word detection sensitivity (1 = low, 5 = high)"
                aria-valuemin={1}
                aria-valuemax={5}
                aria-valuenow={wakeWordSensitivity}
                disabled={savingField === 'wake_word_sensitivity'}
                onChange={(e) => setWakeWordSensitivity(parseInt(e.target.value, 10))}
                onMouseUp={(e) => saveField('wake_word_sensitivity', parseInt((e.target as HTMLInputElement).value, 10))}
                onKeyUp={() => saveField('wake_word_sensitivity', wakeWordSensitivity)}
                style={{ width: '100%', accentColor: 'var(--a-cool)' }}
              />
            </div>
          </>
        )}

        {!wakeWordEnabled && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--s-2)' }}>
            <Pill tone="default">Wake word disabled</Pill>
          </div>
        )}
      </Card>

      <div className="settings-actions">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          Save voice settings
        </Button>
      </div>
    </div>
  );
}
