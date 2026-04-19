// src/features/settings/panes/ModelsPane.tsx — SET-02 (D-82).
//
// Shows the currently active provider + model. Lets the user switch model
// within the current provider, and toggle the token-efficient flag.
//
// Rust write-surface: switchProvider(provider, model) for the model pick;
// setConfig({...}) for the token-efficient flag. apiKey: '' preserves the
// stored keyring entry (commands.rs:1967 guards empty-string clobber).
//
// Per-provider model dropdown lists are hardcoded here — Phase 7 Admin may
// swap to a live `list_models_for_provider` wrapper (D-82 defers dynamic
// listing; not a Phase 3 SC).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-82
// @see src-tauri/src/config.rs:645 switch_provider
// @see src-tauri/src/commands.rs:1944 set_config

import { useMemo, useState } from 'react';
import { Button, Card, Pill } from '@/design-system/primitives';
import { switchProvider, setConfig } from '@/lib/tauri';
import { useConfig, useToast } from '@/lib/context';
import { PROVIDERS } from '@/features/onboarding/providers';
import type { ProviderId } from '@/types/provider';

/** Per-provider model menus — union of PROVIDERS.defaultModel plus common
 *  alternates. If config.model is outside this list we still show it as the
 *  currently-selected option (see `options` memo below). */
const MODEL_OPTIONS: Record<ProviderId, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-1-20250805',
    'claude-haiku-4-20250514',
  ],
  openai: [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4-turbo',
    'o1-mini',
  ],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'anthropic/claude-sonnet-4',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash-001',
  ],
  gemini: [
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'mixtral-8x7b-32768',
  ],
  ollama: [
    'llama3.2',
    'llama3.1',
    'qwen2.5-coder',
    'mistral',
  ],
};

export function ModelsPane() {
  const { config, reload } = useConfig();
  const { show } = useToast();
  const providerId = config.provider as ProviderId;

  const [pendingModel, setPendingModel] = useState<string>(config.model);
  const [tokenEfficient, setTokenEfficient] = useState<boolean>(
    Boolean(config.token_efficient),
  );
  const [saving, setSaving] = useState(false);

  const providerDef = PROVIDERS.find((p) => p.id === providerId);

  // Ensure the currently-saved model appears in the dropdown even if outside
  // the hardcoded menu — prevents a silent reset on save.
  const options = useMemo(() => {
    const base = MODEL_OPTIONS[providerId] ?? [];
    return base.includes(config.model) ? base : [config.model, ...base];
  }, [providerId, config.model]);

  const handleSaveModel = async () => {
    if (pendingModel === config.model) return;
    setSaving(true);
    try {
      await switchProvider(providerId, pendingModel);
      await reload();
      show({ type: 'success', title: 'Model switched', message: pendingModel });
    } catch (e) {
      show({ type: 'error', title: 'Switch failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTokenEfficient = async (next: boolean) => {
    setTokenEfficient(next);
    setSaving(true);
    try {
      // apiKey: '' preserves keyring per commands.rs:1967.
      await setConfig({
        provider: config.provider,
        apiKey: '',
        model: config.model,
        tokenEfficient: next,
      });
      await reload();
      show({
        type: 'success',
        title: next ? 'Token-efficient enabled' : 'Token-efficient disabled',
      });
    } catch (e) {
      setTokenEfficient(!next); // revert UI
      show({ type: 'error', title: 'Update failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h2>Models</h2>
      <p>Pick which model runs for the active provider. Switch provider entirely from the Providers tab.</p>

      <Card>
        <div className="settings-readout" style={{ marginBottom: '12px' }}>
          <dt>Active provider</dt>
          <dd>
            <Pill>{providerDef?.name ?? providerId}</Pill>
          </dd>
          <dt>Active model</dt>
          <dd>{config.model}</dd>
        </div>

        <div className="settings-field">
          <label htmlFor="models-pane-select" className="settings-field-label">Model</label>
          <select
            id="models-pane-select"
            value={pendingModel}
            onChange={(e) => setPendingModel(e.target.value)}
            disabled={saving}
          >
            {options.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="settings-actions">
          <Button
            variant="primary"
            disabled={saving || pendingModel === config.model}
            onClick={handleSaveModel}
          >
            Save & switch
          </Button>
        </div>
      </Card>

      <Card>
        <h3>Token-efficient mode</h3>
        <p>Compacts system prompts and tool schemas to reduce tokens per turn. May slightly degrade tool-calling reliability on smaller models.</p>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          <input
            type="checkbox"
            checked={tokenEfficient}
            onChange={(e) => handleToggleTokenEfficient(e.target.checked)}
            disabled={saving}
          />
          <span>Enabled</span>
        </label>
      </Card>
    </div>
  );
}
