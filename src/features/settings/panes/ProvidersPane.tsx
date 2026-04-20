// src/features/settings/panes/ProvidersPane.tsx — SET-01 (D-81).
//
// Reuses the PROVIDERS registry from src/features/onboarding/providers.ts
// verbatim (D-81 — no duplication). 6 cards, each with:
//   • Provider name + tagline
//   • Key-stored pill OR "No key" warning
//   • Masked key input
//   • Test connection button → testProvider()
//   • Save & switch button → storeProviderKey + switchProvider
//
// Failure path: TauriError caught, message surfaced via toast (rustMessage).
// Pending key cleared from component state immediately after successful save
// (T-03-06-02 mitigation — no localStorage persistence).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-81
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §10
// @see src-tauri/src/commands.rs:2025 test_provider
// @see src-tauri/src/config.rs:636 store_provider_key
// @see src-tauri/src/config.rs:645 switch_provider

import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button, Card, Input, Pill } from '@/design-system/primitives';
import { PROVIDERS } from '@/features/onboarding/providers';
import {
  getAllProviderKeys,
  probeProviderCapabilities,
  saveConfigField,
  storeProviderKey,
  switchProvider,
  testProvider,
  TauriError,
} from '@/lib/tauri';
import { useToast } from '@/lib/context';
import { useConfig } from '@/lib/context';
import type {
  ProviderCapabilityRecord,
  ProviderKeyList,
} from '@/types/provider';
// Phase 11 D-57: three additions — paste form at top, per-row capability
// pill strip + re-probe button, fallback-order drag list at bottom. The
// existing per-card Test/Save flow remains unchanged.
import {
  CapabilityPillStrip,
  FallbackOrderList,
  ProviderPasteForm,
} from '@/features/providers';

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

export function ProvidersPane() {
  const { show } = useToast();
  const { config, reload } = useConfig();
  const [keys, setKeys] = useState<ProviderKeyList | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, 'test' | 'save' | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  // Phase 11 D-52 — per-row re-probe busy state. null = idle, provider id
  // = probe currently in flight for that row.
  const [reprobing, setReprobing] = useState<string | null>(null);
  // Phase 11 D-57 — toggle controlled here so the consumer owns the
  // auto-populate logic (FallbackOrderList is presentational).
  const [useAllProviders, setUseAllProviders] = useState<boolean>(false);

  // BladeConfig carries provider_capabilities + fallback_providers as
  // optional fields (typed via the permissive index signature on
  // src/types/config.ts). Narrow to the expected shapes here.
  const providerCapabilities =
    (config.provider_capabilities as
      | Record<string, ProviderCapabilityRecord>
      | undefined) ?? {};
  const fallbackProviders =
    (config.fallback_providers as string[] | undefined) ?? [];

  const refresh = () => {
    getAllProviderKeys()
      .then((k) => { setKeys(k); setLoadError(null); })
      .catch((e) => setLoadError(errMessage(e)));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleTest = async (providerId: string, defaultModel: string) => {
    const apiKey = pending[providerId] ?? '';
    if (!apiKey) {
      show({ type: 'error', title: 'Enter a key first' });
      return;
    }
    setBusy((b) => ({ ...b, [providerId]: 'test' }));
    try {
      const r = await testProvider({ provider: providerId, apiKey, model: defaultModel });
      show({ type: 'success', title: 'Provider OK', message: r });
    } catch (e) {
      show({ type: 'error', title: 'Test failed', message: errMessage(e) });
    } finally {
      setBusy((b) => ({ ...b, [providerId]: null }));
    }
  };

  const handleSave = async (providerId: string, defaultModel: string) => {
    const apiKey = pending[providerId] ?? '';
    if (!apiKey) {
      show({ type: 'error', title: 'Enter a key first' });
      return;
    }
    setBusy((b) => ({ ...b, [providerId]: 'save' }));
    try {
      await storeProviderKey(providerId, apiKey);
      await switchProvider(providerId, defaultModel);
      // Clear pending BEFORE toast — T-03-06-02 mitigation (no key sitting in
      // component state after save).
      setPending((s) => ({ ...s, [providerId]: '' }));
      refresh();
      await reload();
      show({ type: 'success', title: 'Saved', message: `${providerId} key stored and active.` });
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: errMessage(e) });
    } finally {
      setBusy((b) => ({ ...b, [providerId]: null }));
    }
  };

  if (loadError) {
    return (
      <div className="settings-section">
        <h2>Providers</h2>
        <div className="settings-notice warn">Failed to load providers: {loadError}</div>
      </div>
    );
  }

  if (!keys) {
    return (
      <div className="settings-section">
        <h2>Providers</h2>
        <p>Loading…</p>
      </div>
    );
  }

  /**
   * Phase 11 D-52 — re-probe a provider's capabilities. The Rust command
   * `probe_provider_capabilities` accepts `api_key: Option<String>` (Plan
   * 11-02 Task 3) — when we OMIT the `apiKey` field here, Rust falls back
   * to `config::get_provider_key(provider)` which reads the OS keyring.
   * This keeps the key off the TS boundary for re-probe flows (T-11-32
   * threat register entry). Do NOT pass an empty string for apiKey —
   * Rust treats empty as invalid and errors out.
   */
  const handleReprobe = async (providerId: string) => {
    setReprobing(providerId);
    try {
      const existing = providerCapabilities[providerId];
      const model = existing?.model ?? '';
      const record = await probeProviderCapabilities({
        provider: providerId,
        model,
        // apiKey intentionally omitted — Rust reads from keyring.
      });
      const merged = { ...providerCapabilities, [providerId]: record };
      await saveConfigField('provider_capabilities', JSON.stringify(merged));
      await reload();
      show({ type: 'success', title: 'Re-probe complete', message: `${providerId} capabilities updated.` });
    } catch (e) {
      show({ type: 'error', title: 'Re-probe failed', message: errMessage(e) });
    } finally {
      setReprobing(null);
    }
  };

  /** Phase 11 D-57 — persist new fallback order. */
  const handleFallbackChange = async (newOrder: string[]) => {
    try {
      await saveConfigField('fallback_providers', JSON.stringify(newOrder));
      await reload();
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: errMessage(e) });
    }
  };

  /** Phase 11 D-57 — "Use all providers with keys" toggle. When flipped
   *  on, auto-populates the fallback list with every provider that has a
   *  stored key, alphabetically. Turning it off does NOT clear the list —
   *  user's manual order persists per UI-SPEC Surface B. */
  const handleToggleUseAll = async (checked: boolean) => {
    setUseAllProviders(checked);
    if (checked) {
      const withKeys = keys.providers
        .filter((p) => p.has_key)
        .map((p) => p.provider)
        .sort();
      await handleFallbackChange(withKeys);
    }
  };

  return (
    <div className="settings-section">
      <h2>Providers</h2>
      <p>Configure your API keys. Keys are stored in your OS keyring — BLADE only sees them at invoke time.</p>

      {/* Phase 11 D-56 — paste card at the top of the pane. Plan 11-05
          Task 2 will wrap this mount in a ref'd div so routeHint.needs
          can scroll + focus the textarea. This plan leaves the form as a
          bare JSX child for a clean div-wrap target. */}
      <ProviderPasteForm
        onSuccess={async (parsed) => {
          if (
            parsed.api_key &&
            parsed.provider_guess !== 'custom'
          ) {
            try {
              await storeProviderKey(parsed.provider_guess, parsed.api_key);
              refresh();
              await reload();
              show({
                type: 'success',
                title: 'Saved',
                message: `${parsed.provider_guess} key stored from paste.`,
              });
            } catch (e) {
              show({ type: 'error', title: 'Save failed', message: errMessage(e) });
            }
          }
        }}
      />

      <div className="settings-grid">
        {PROVIDERS.map((p) => {
          const stored = keys.providers.find((x) => x.provider === p.id);
          const hasKey = stored?.has_key ?? false;
          const isActive = stored?.is_active ?? false;
          const pendingValue = pending[p.id] ?? '';
          const currentBusy = busy[p.id];
          const record = providerCapabilities[p.id] ?? null;

          return (
            <Card key={p.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <h3 style={{ marginBottom: 0 }}>{p.name}</h3>
                {isActive ? <Pill tone="pro" dot>Active</Pill> : null}
              </div>
              <p className="provider-tagline">{p.tagline}</p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                {hasKey ? (
                  <Pill tone="free">Key stored: {stored?.masked || '****'}</Pill>
                ) : p.needsKey ? (
                  <Pill tone="new">No key</Pill>
                ) : (
                  <Pill>No key needed (local)</Pill>
                )}
              </div>

              {/* Phase 11 D-52 — capability pill strip + re-probe button.
                  Only renders when a key is stored (can't probe without one). */}
              {hasKey ? (
                <div style={{ marginBottom: 'var(--s-3)' }}>
                  <CapabilityPillStrip
                    provider={p.id}
                    record={record}
                    onReprobe={() => handleReprobe(p.id)}
                    busy={reprobing === p.id}
                  />
                  {!record ? (
                    <p className="t-small" style={{ color: 'var(--t-3)', marginTop: 'var(--s-1)' }}>
                      Click ↻ to probe capabilities.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <Input
                type="password"
                value={pendingValue}
                onChange={(e) => setPending((s) => ({ ...s, [p.id]: e.target.value }))}
                placeholder={p.keyPlaceholder}
                disabled={!p.needsKey || currentBusy != null}
                autoComplete="off"
                spellCheck={false}
              />

              {p.needsKey && p.keyUrl ? (
                <p className="provider-tagline" style={{ marginTop: 4 }}>
                  <a
                    href={p.keyUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      openUrl(p.keyUrl).catch(() => {});
                    }}
                    className="settings-link"
                  >
                    Get an API key →
                  </a>
                </p>
              ) : null}

              <div className="settings-actions">
                <Button
                  variant="secondary"
                  disabled={!p.needsKey || !pendingValue || currentBusy != null}
                  onClick={() => handleTest(p.id, p.defaultModel)}
                >
                  {currentBusy === 'test' ? 'Testing…' : 'Test'}
                </Button>
                <Button
                  variant="primary"
                  disabled={!p.needsKey || !pendingValue || currentBusy != null}
                  onClick={() => handleSave(p.id, p.defaultModel)}
                >
                  {currentBusy === 'save' ? 'Saving…' : 'Save & switch'}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Phase 11 D-57 — fallback-order drag list. Reorder persists to
          config.fallback_providers via saveConfigField. The "Use all
          providers with keys" toggle is controlled here; flipping it on
          auto-populates with every provider that has a stored key. */}
      <FallbackOrderList
        providers={fallbackProviders}
        capabilityRecords={providerCapabilities}
        onChange={handleFallbackChange}
        useAll={useAllProviders}
        onToggleUseAll={handleToggleUseAll}
      />
    </div>
  );
}
