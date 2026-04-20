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

import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button, Card, Input, Pill } from '@/design-system/primitives';
import { PROVIDERS } from '@/features/onboarding/providers';
import {
  getAllProviderKeys,
  storeProviderKey,
  switchProvider,
  testProvider,
  TauriError,
} from '@/lib/tauri';
import { useToast } from '@/lib/context';
import { useConfig } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import type { ProviderKeyList } from '@/types/provider';

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

export function ProvidersPane() {
  const { show } = useToast();
  const { reload } = useConfig();
  // Phase 11 Plan 11-05 — consume routeHint?.needs for deep-link focus.
  const { routeHint } = useRouterCtx();
  const pasteFormWrapRef = useRef<HTMLDivElement>(null);
  const [keys, setKeys] = useState<ProviderKeyList | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, 'test' | 'save' | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = () => {
    getAllProviderKeys()
      .then((k) => { setKeys(k); setLoadError(null); })
      .catch((e) => setLoadError(errMessage(e)));
  };

  useEffect(() => {
    refresh();
  }, []);

  // Phase 11 Plan 11-05 — deep-link scroll-focus. When ProvidersPane is opened
  // via openRoute('settings-providers', { needs: <cap> }), scroll the paste
  // form wrapper into view and focus its descendant textarea (aria-label
  // "Provider config paste input"). 2×rAF waits for the pane layout to settle
  // (UI-SPEC §Surface C accessibility). Gracefully no-ops when the textarea
  // doesn't exist yet (Plan 11-03 adds ProviderPasteForm to this pane in a
  // parallel wave; the effect becomes active once that lands).
  useEffect(() => {
    if (!routeHint?.needs) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = pasteFormWrapRef.current;
        if (!target) return;
        const prefersReducedMotion =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        target.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'center',
        });
        const ta = target.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Provider config paste input"]',
        );
        ta?.focus();
      });
    });
  }, [routeHint]);

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

  return (
    <div className="settings-section">
      <h2>Providers</h2>
      <p>Configure your API keys. Keys are stored in your OS keyring — BLADE only sees them at invoke time.</p>

      {/* Phase 11 Plan 11-05 — sr-only live-region announcement for deep-link
          arrival. Screen readers hear "Paste your provider config to add
          {capability} support." when routeHint.needs is set. */}
      {routeHint?.needs && (
        <div className="sr-only" role="status" aria-live="polite">
          Paste your provider config to add {routeHint.needs} support.
        </div>
      )}

      {/* Phase 11 Plan 11-05 — div-wrap ref for ProviderPasteForm focus. Plan
          11-03 (wave-1 sibling) mounts the full <ProviderPasteForm/> inside
          this wrapper and replaces the minimal textarea stub below. The stub
          exists so the deep-link focus path has a valid target both before
          and after 11-03 lands; aria-label matches the committed contract
          "Provider config paste input" (UI-SPEC §Surface A + §Surface B). */}
      <div ref={pasteFormWrapRef} data-testid="provider-paste-form-wrap">
        <textarea
          aria-label="Provider config paste input"
          className="provider-paste-stub"
          placeholder="Paste cURL, JSON, or Python SDK config…"
          rows={3}
          style={{
            width: '100%',
            padding: 'var(--s-3)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--t-border)',
            borderRadius: 'var(--radius-2)',
            color: 'var(--t-1)',
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            resize: 'vertical',
            marginBottom: 'var(--s-4)',
          }}
        />
      </div>

      <div className="settings-grid">
        {PROVIDERS.map((p) => {
          const stored = keys.providers.find((x) => x.provider === p.id);
          const hasKey = stored?.has_key ?? false;
          const isActive = stored?.is_active ?? false;
          const pendingValue = pending[p.id] ?? '';
          const currentBusy = busy[p.id];

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
    </div>
  );
}
