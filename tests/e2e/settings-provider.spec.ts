// tests/e2e/settings-provider.spec.ts — Phase 3 SC-4 falsifier (D-91 / D-81).
//
// SC-4: Settings saves a provider key; persists after restart; routing grid
// reflects updated config. This spec validates the ProvidersPane round trip:
//
//   1. Navigate to /settings/providers (via ⌘K palette or direct route).
//   2. Mock test_provider → 'OK'; mock store_provider_key → null; mock
//      switch_provider → stub BladeConfig; mock get_all_provider_keys to be
//      REFLECTIVE — first call returns empty list; after store_provider_key
//      is invoked, subsequent calls return the Groq card with
//      has_key=true + is_active=true + masked='gsk_***1234'.
//   3. Find the Groq card (the 5th card, filtered by text 'Groq'); fill
//      the password input with 'gsk_test_1234'; click 'Save & switch'.
//   4. Assert store_provider_key was invoked with {provider:'groq', …}.
//   5. Assert the card updates to show 'Key stored: gsk_***1234'.
//   6. Reload the page; assert the masked key persists (the reflective
//      mock keeps serving the stored shape → simulates backend persistence).
//
// @see src/features/settings/panes/ProvidersPane.tsx
// @see src-tauri/src/config.rs:636 (store_provider_key)
// @see src-tauri/src/config.rs:645 (switch_provider)
// @see src-tauri/src/commands.rs:2025 (test_provider)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-81, §D-91
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §14

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface InvokeLogEntry { cmd: string; args: unknown }

interface ShimHandles {
  getInvokeCalls: () => Promise<InvokeLogEntry[]>;
}

/**
 * Reflective get_all_provider_keys — mutates on successful store_provider_key
 * so the pane's refresh() after save surfaces the stored state.
 */
async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript(() => {
    type AnyFn = (...args: unknown[]) => unknown;
    interface Listener { eventId: number; event: string; callback: AnyFn }

    const state = {
      nextCallbackId: 1,
      nextEventId: 1,
      callbacks: new Map<number, AnyFn>(),
      listeners: new Map<number, Listener>(),
    };

    (window as unknown as { __TAURI_INVOKE_CALLS__: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__ = [];

    // Mutable keyring mock — store_provider_key writes here; subsequent
    // get_all_provider_keys reads reflect the update. Initial: no keys.
    const keyring: {
      providers: Array<{ provider: string; has_key: boolean; masked: string; is_active: boolean }>;
      active_provider: string;
    } = {
      providers: [],
      active_provider: '',
    };

    // localStorage-backed persistence simulation so reload shows the key.
    try {
      const saved = localStorage.getItem('__BLADE_TEST_KEYRING__');
      if (saved) {
        const parsed = JSON.parse(saved);
        keyring.providers = parsed.providers ?? [];
        keyring.active_provider = parsed.active_provider ?? '';
      }
    } catch { /* noop */ }

    function persistKeyring() {
      try { localStorage.setItem('__BLADE_TEST_KEYRING__', JSON.stringify(keyring)); }
      catch { /* noop */ }
    }

    const baseConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      onboarded: true,
      persona_onboarding_complete: true,
      last_deep_scan: Math.floor(Date.now() / 1000),
      god_mode_tier: 'normal',
      voice_mode: 'off',
      tts_voice: 'system',
      wake_word_enabled: false,
    };

    function mask(key: string): string {
      if (key.length < 8) return '****';
      return `${key.slice(0, 4)}***${key.slice(-4)}`;
    }

    async function handleInvoke(cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
      if (!cmd.startsWith('plugin:event|')) {
        (window as unknown as { __TAURI_INVOKE_CALLS__: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__.push({ cmd, args });
      }
      if (cmd === 'plugin:event|listen') {
        const a = (args ?? {}) as { event?: string; handler?: number };
        const handlerId = typeof a.handler === 'number' ? a.handler : -1;
        const cb = state.callbacks.get(handlerId);
        if (!cb || typeof a.event !== 'string') {
          throw new Error(`plugin:event|listen: missing callback or event`);
        }
        const eventId = state.nextEventId++;
        state.listeners.set(eventId, { eventId, event: a.event, callback: cb });
        return eventId;
      }
      if (cmd === 'plugin:event|unlisten') {
        const a = (args ?? {}) as { eventId?: number };
        if (typeof a.eventId === 'number') state.listeners.delete(a.eventId);
        return null;
      }
      switch (cmd) {
        case 'get_config':              return { ...baseConfig };
        case 'get_onboarding_status':   return true;
        case 'get_all_provider_keys':   return { ...keyring };
        case 'test_provider':           return 'Connection OK — groq';
        case 'store_provider_key': {
          const a = (args ?? {}) as { provider?: string; apiKey?: string; api_key?: string };
          const provider = a.provider ?? '';
          const key = a.apiKey ?? a.api_key ?? '';
          if (provider && key) {
            const idx = keyring.providers.findIndex((p) => p.provider === provider);
            const row = { provider, has_key: true, masked: mask(key), is_active: false };
            if (idx >= 0) keyring.providers[idx] = row;
            else keyring.providers.push(row);
            persistKeyring();
          }
          return null;
        }
        case 'switch_provider': {
          const a = (args ?? {}) as { provider?: string; model?: string };
          const provider = a.provider ?? '';
          const model = a.model ?? '';
          keyring.providers = keyring.providers.map((p) => ({ ...p, is_active: p.provider === provider }));
          keyring.active_provider = provider && model ? `${provider} / ${model}` : '';
          persistKeyring();
          return { ...baseConfig, provider, model };
        }
        default:                        return null;
      }
    }

    (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown> | undefined) => handleInvoke(cmd, args),
      transformCallback: (callback: AnyFn, _once?: boolean): number => {
        const id = state.nextCallbackId++;
        state.callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number): void => { state.callbacks.delete(id); },
      convertFileSrc: (p: string): string => p,
    };
  });

  return {
    getInvokeCalls: () =>
      page.evaluate(
        () => (window as unknown as { __TAURI_INVOKE_CALLS__?: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__ ?? [],
      ),
  };
}

async function navigateToProviders(page: Page): Promise<void> {
  // NavRail click → settings (parent route); SettingsShell defaults to
  // Providers pane. Then click the Providers tab explicitly to ensure
  // routeId matches exactly (avoids the 'settings' → 'settings-providers'
  // ambiguity).
  await page.locator('.navrail button[data-route-id="settings"]').click();
  await expect(page.locator('[data-route-id="settings"]').first()).toBeVisible();
  await page.locator('.settings-tab', { hasText: /^Providers$/ }).click();
  // Heading is the section-level 'Providers' h2 inside the pane.
  await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();
}

test.describe('Phase 3 SC-4 — ProvidersPane save round-trip (D-81)', () => {
  test.beforeEach(async ({ context }) => {
    // Fresh keyring per test — the reflective mock persists to localStorage
    // so reload cases are authentic, but each test scenario should start clean.
    await context.clearCookies();
  });

  test('enter key → Test → Save & switch → card shows masked key → reload persists', async ({ page }) => {
    const handles = await installShim(page);
    // Ensure a clean slate — installShim reads from localStorage if present.
    await page.addInitScript(() => { try { localStorage.removeItem('__BLADE_TEST_KEYRING__'); } catch { /* noop */ } });
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await navigateToProviders(page);

    // Scope selectors to the Groq card. ProvidersPane renders each provider
    // in a Card primitive (renders as .glass.glass-1 — see
    // src/design-system/primitives/Card.tsx → GlassPanel). We locate by the
    // direct glass-1 parent containing the Groq h3.
    const groqCard = page.locator('.glass.glass-1', { has: page.getByRole('heading', { name: /^Groq$/ }) });
    await expect(groqCard).toBeVisible();

    // Initial state — 'No key' pill visible.
    await expect(groqCard.getByText(/^No key$/i)).toBeVisible();

    // Fill the masked input (type=password).
    const apiKeyInput = groqCard.locator('input[type="password"]');
    await apiKeyInput.fill('gsk_test_1234');

    // Click Test → toast 'Provider OK' (assert by invoke log, not toast
    // text — toast may dismiss before we assert otherwise).
    await groqCard.getByRole('button', { name: /^Test$/ }).click();
    await expect.poll(
      async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'test_provider'),
      { timeout: 3000 },
    ).toBeTruthy();

    // Click Save & switch.
    await groqCard.getByRole('button', { name: /save & switch/i }).click();

    // Assert store_provider_key was invoked with provider='groq' and a non-empty key.
    await expect.poll(
      async () => {
        const calls = await handles.getInvokeCalls();
        return calls.find((c) => c.cmd === 'store_provider_key');
      },
      { timeout: 3000 },
    ).toBeTruthy();
    const storeCall = (await handles.getInvokeCalls()).find((c) => c.cmd === 'store_provider_key')!;
    const storeArgs = storeCall.args as Record<string, unknown>;
    expect(storeArgs.provider).toBe('groq');
    const storedKey = (storeArgs.apiKey as string | undefined) ?? (storeArgs.api_key as string | undefined);
    expect(storedKey).toBe('gsk_test_1234');

    // switch_provider also invoked with groq + default model.
    await expect.poll(
      async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'switch_provider'),
      { timeout: 3000 },
    ).toBeTruthy();
    const switchCall = (await handles.getInvokeCalls()).find((c) => c.cmd === 'switch_provider')!;
    const switchArgs = switchCall.args as Record<string, unknown>;
    expect(switchArgs.provider).toBe('groq');

    // After refresh() in the pane, the card should show the masked key pill.
    // Mock masks 'gsk_test_1234' → 'gsk_***1234'.
    await expect(groqCard.getByText(/Key stored:\s*gsk_\*\*\*1234/i)).toBeVisible();
    await expect(groqCard.getByText(/^Active$/)).toBeVisible();

    // ── Restart simulation: reload the page. The reflective mock restores
    // the keyring from localStorage so the card shows the stored state
    // verbatim after reload (simulates keyring persistence across restart).
    await page.reload();
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });
    await navigateToProviders(page);

    const groqCardAfterReload = page.locator('.glass.glass-1', { has: page.getByRole('heading', { name: /^Groq$/ }) });
    await expect(groqCardAfterReload.getByText(/Key stored:\s*gsk_\*\*\*1234/i)).toBeVisible();
  });
});
