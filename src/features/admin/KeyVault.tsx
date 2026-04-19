// src/features/admin/KeyVault.tsx
//
// Admin cluster — KeyVault route (synthetic ADMIN-11 orphan per D-185). Renders
// get_all_provider_keys() + Store Dialog → store_provider_key. Keys are masked
// to the last 4 characters client-side per D-185 (T-07-06-03 mitigation).
//
// Rust returns a free-form `serde_json::Value` — we defensively normalise
// whatever shape comes back (array of {provider, key, key_masked, has_key}
// OR object map keyed by provider) into a flat list for rendering.
//
// Copy-to-clipboard is intentionally NOT offered: D-185 chose last-4 display
// as the full extent of in-UI key exposure. Operator ergonomics of "Copy"
// was considered but rejected to keep the DOM clean of full-key strings
// (T-07-06-04 tightened).
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-185

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, Input, Pill, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import { getAllProviderKeys, storeProviderKey } from '@/lib/tauri/admin';
import './admin.css';
import './admin-rich-b.css';

interface KeyRow {
  provider: string;
  masked: string;
  hasKey: boolean;
}

function maskKey(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '********';
  if (raw.length <= 8) return '********';
  const last4 = raw.slice(-4);
  return `....${last4}`;
}

function normalise(raw: unknown): KeyRow[] {
  if (!raw) return [];
  const result: KeyRow[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        const provider = String(e.provider ?? e.name ?? '');
        if (!provider) continue;
        let masked: string;
        let hasKey: boolean;
        if (typeof e.key_masked === 'string' && e.key_masked.trim()) {
          masked = e.key_masked;
          hasKey = Boolean(e.has_key ?? true);
        } else if (typeof e.key === 'string') {
          masked = maskKey(e.key);
          hasKey = e.key.length > 0;
        } else {
          masked = '(not set)';
          hasKey = Boolean(e.has_key ?? false);
        }
        result.push({ provider, masked, hasKey });
      }
    }
    return result;
  }

  if (typeof raw === 'object') {
    for (const [provider, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null || value === undefined) {
        result.push({ provider, masked: '(not set)', hasKey: false });
      } else if (typeof value === 'string') {
        result.push({ provider, masked: maskKey(value), hasKey: value.length > 0 });
      } else if (typeof value === 'object') {
        const v = value as Record<string, unknown>;
        const hasKey = Boolean(v.has_key ?? v.present ?? true);
        const masked =
          typeof v.key_masked === 'string'
            ? v.key_masked
            : typeof v.key === 'string'
              ? maskKey(v.key)
              : hasKey
                ? '....????'
                : '(not set)';
        result.push({ provider, masked, hasKey });
      }
    }
  }
  return result;
}

export function KeyVault() {
  const router = useRouterCtx();
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const raw = await getAllProviderKeys();
      setRows(normalise(raw));
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="key-vault-root">
      <div className="key-vault-layout">
        <section className="diagnostics-hero">
          <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
            <h3>Provider keys</h3>
            <div className="admin-inline-row">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setStoreOpen(true)}
                data-testid="key-vault-store-button"
              >
                Store key
              </Button>
              <Button variant="ghost" size="sm" onClick={refresh}>
                Refresh
              </Button>
            </div>
          </div>
          {error && <p className="admin-empty">Error: {error}</p>}
        </section>

        <section className="diagnostics-section">
          <div className="admin-row-list">
            {(rows ?? []).map((r) => (
              <div
                key={r.provider}
                className="key-vault-row"
                data-testid="provider-key-row"
                data-provider={r.provider}
              >
                <div className="key-vault-row-main">
                  <span className="key-vault-row-provider">{r.provider}</span>
                  <span className="key-masked">{r.masked}</span>
                </div>
                <Pill tone={r.hasKey ? 'free' : 'default'}>
                  {r.hasKey ? 'stored' : 'missing'}
                </Pill>
              </div>
            ))}
            {rows && rows.length === 0 && (
              <EmptyState
                label="No API keys stored"
                description="Configure provider keys in Settings → Providers."
                actionLabel="Open settings"
                onAction={() => router.openRoute('settings-providers')}
              />
            )}
          </div>
        </section>

        <div className="key-vault-note">
          Keys are backed by the OS keyring — macOS Keychain / Windows Credential Store / Linux
          libsecret. Only the last 4 characters are shown in the UI; keys are never written to
          disk in plaintext.
        </div>
      </div>

      <StoreKeyDialog open={storeOpen} onClose={() => setStoreOpen(false)} onDone={refresh} />
    </GlassPanel>
  );
}

function StoreKeyDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    if (!provider.trim() || !apiKey.trim()) {
      toast.show({ type: 'warn', title: 'Provider and API key required' });
      return;
    }
    setBusy(true);
    try {
      await storeProviderKey({ provider, apiKey });
      toast.show({ type: 'success', title: 'Key stored', message: provider });
      await props.onDone();
      // Clear the sensitive input before closing the dialog (D-185).
      setApiKey('');
      setProvider('');
      props.onClose();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Store failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [provider, apiKey, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Store provider key">
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Store provider key</h3>
      <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--s-2)' }}>
        The key is written to the OS keyring. The field is masked while typing and cleared
        after save.
      </p>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Provider
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
            placeholder="anthropic, openai, openrouter, groq, …"
          />
        </label>
        <label className="admin-dialog-label">
          API key
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            aria-label="API key"
            autoComplete="off"
            data-testid="key-vault-store-input"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || !provider.trim() || !apiKey.trim()}
        >
          {busy ? 'Storing…' : 'Store'}
        </Button>
      </div>
    </Dialog>
  );
}
