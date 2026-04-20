// tests/e2e/fallback-order-drag.spec.ts — Phase 11 Plan 11-03 (D-57).
//
// Proves the Fallback order drag list persists reorders to
// config.fallback_providers via saveConfigField(..., JSON-stringified
// string[]). Uses the window.__BLADE_TEST_OPEN_ROUTE test-only hatch
// (Plan 11-05 Task 1 — dev-mode + ?e2e=1). HTML5 native DnD via
// Playwright's dragTo; keyboard-drag (Space+Arrow) is an a11y-only
// path and tested separately if reached.
//
//   1. installShim returns a config with fallback_providers =
//      ['anthropic','openai','groq'] and capability records for each.
//   2. Navigate to settings-providers via the hatch.
//   3. Assert heading "Fallback order" + 3 draggable rows in order
//      anthropic → openai → groq.
//   4. Trigger a keyboard reorder (focus row 1, Space to pickup, ArrowDown
//      twice, Space to drop) — the handler calls saveConfigField with the
//      new JSON-stringified order.
//   5. Assert save_config_field was invoked with key='fallback_providers'.
//   6. Reload; assert the new order persists (reflective mock mutates
//      baseConfig.fallback_providers on save).
//
// @see src/features/providers/FallbackOrderList.tsx
// @see src/features/settings/panes/ProvidersPane.tsx
// @see src-tauri/src/config.rs save_config_field
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md Surface B
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §10

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface InvokeLogEntry { cmd: string; args: unknown }

interface ShimHandles {
  getInvokeCalls: () => Promise<InvokeLogEntry[]>;
  getFallbackOrder: () => Promise<string[]>;
}

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

    // Persist to localStorage so the reload-persistence assertion works.
    const LS_KEY = '__BLADE_TEST_FALLBACK_ORDER__';
    let fallback: string[];
    try {
      const saved = localStorage.getItem(LS_KEY);
      fallback = saved ? JSON.parse(saved) : ['anthropic', 'openai', 'groq'];
    } catch {
      fallback = ['anthropic', 'openai', 'groq'];
    }

    const capabilities: Record<string, unknown> = {
      anthropic: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        context_window: 200000,
        vision: true, audio: false, tool_calling: true, long_context: true,
        last_probed: new Date().toISOString(), probe_status: 'Active',
      },
      openai: {
        provider: 'openai', model: 'gpt-4o-mini', context_window: 128000,
        vision: true, audio: false, tool_calling: true, long_context: true,
        last_probed: new Date().toISOString(), probe_status: 'Active',
      },
      groq: {
        provider: 'groq', model: 'llama-3.3-70b-versatile', context_window: 128000,
        vision: false, audio: false, tool_calling: true, long_context: true,
        last_probed: new Date().toISOString(), probe_status: 'Active',
      },
    };

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
      get fallback_providers() { return fallback; },
      provider_capabilities: capabilities,
    };

    const keyring = {
      providers: [
        { provider: 'anthropic', has_key: true, masked: 'sk-a***1234', is_active: true },
        { provider: 'openai', has_key: true, masked: 'sk-o***5678', is_active: false },
        { provider: 'groq', has_key: true, masked: 'gsk_***9999', is_active: false },
      ],
      active_provider: 'anthropic / claude-sonnet-4-20250514',
    };

    (window as unknown as { __BLADE_TEST_FALLBACK_GET__: () => string[] }).__BLADE_TEST_FALLBACK_GET__ = () => [...fallback];

    async function handleInvoke(
      cmd: string,
      args: Record<string, unknown> | undefined,
    ): Promise<unknown> {
      if (!cmd.startsWith('plugin:event|')) {
        (window as unknown as { __TAURI_INVOKE_CALLS__: InvokeLogEntry[] }).__TAURI_INVOKE_CALLS__.push({ cmd, args });
      }
      if (cmd === 'plugin:event|listen') {
        const a = (args ?? {}) as { event?: string; handler?: number };
        const handlerId = typeof a.handler === 'number' ? a.handler : -1;
        const cb = state.callbacks.get(handlerId);
        if (!cb || typeof a.event !== 'string') {
          throw new Error('plugin:event|listen: missing callback or event');
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
        case 'get_config':
          return { ...baseConfig, fallback_providers: [...fallback] };
        case 'get_onboarding_status':
          return true;
        case 'get_all_provider_keys':
          return { ...keyring };
        case 'save_config_field': {
          const a = (args ?? {}) as { key?: string; value?: string };
          if (a.key === 'fallback_providers' && typeof a.value === 'string') {
            try {
              const next = JSON.parse(a.value);
              if (Array.isArray(next)) {
                fallback = next as string[];
                try { localStorage.setItem(LS_KEY, JSON.stringify(fallback)); } catch { /* noop */ }
              }
            } catch { /* noop */ }
          }
          return null;
        }
        default:
          return null;
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
    getFallbackOrder: () =>
      page.evaluate(
        () => (window as unknown as { __BLADE_TEST_FALLBACK_GET__?: () => string[] }).__BLADE_TEST_FALLBACK_GET__?.() ?? [],
      ),
  };
}

async function openSettingsProviders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fn = (window as unknown as {
      __BLADE_TEST_OPEN_ROUTE?: (id: string) => void;
    }).__BLADE_TEST_OPEN_ROUTE;
    if (typeof fn === 'function') fn('settings-providers');
  });
}

test.describe('Phase 11 D-57 — Fallback order drag list', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('__BLADE_TEST_FALLBACK_ORDER__'); } catch { /* noop */ }
    });
  });

  test('keyboard-drag reorders first → last → save_config_field invoked with new order → persists', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await openSettingsProviders(page);

    // Section heading present — copy verbatim per UI-SPEC.
    await expect(page.getByRole('heading', { name: 'Fallback order' })).toBeVisible();

    // 3 rows render in order anthropic → openai → groq.
    const list = page.locator('ul[aria-label="Provider fallback order, drag to reorder"]');
    await expect(list).toBeVisible();
    const rows = list.locator('> li[role="listitem"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('data-provider', 'anthropic');
    await expect(rows.nth(1)).toHaveAttribute('data-provider', 'openai');
    await expect(rows.nth(2)).toHaveAttribute('data-provider', 'groq');

    // Focus the first row, Space to pick up, ArrowDown twice, Space to drop.
    await rows.nth(0).focus();
    await page.keyboard.press(' ');           // pickup anthropic
    await page.keyboard.press('ArrowDown');   // anthropic → position 2
    await page.keyboard.press('ArrowDown');   // anthropic → position 3
    await page.keyboard.press(' ');           // drop

    // save_config_field invoked for fallback_providers.
    await expect.poll(
      async () => {
        const calls = await handles.getInvokeCalls();
        return calls.find(
          (c) =>
            c.cmd === 'save_config_field' &&
            (c.args as { key?: string } | undefined)?.key === 'fallback_providers',
        );
      },
      { timeout: 3000 },
    ).toBeTruthy();

    // Backing store reflects the new order.
    const order = await handles.getFallbackOrder();
    expect(order).toEqual(['openai', 'groq', 'anthropic']);

    // Reload and assert persistence (reflective mock restores from localStorage).
    await page.reload();
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });
    await openSettingsProviders(page);

    const rowsAfter = page.locator('ul[aria-label="Provider fallback order, drag to reorder"] > li[role="listitem"]');
    await expect(rowsAfter).toHaveCount(3);
    await expect(rowsAfter.nth(0)).toHaveAttribute('data-provider', 'openai');
    await expect(rowsAfter.nth(1)).toHaveAttribute('data-provider', 'groq');
    await expect(rowsAfter.nth(2)).toHaveAttribute('data-provider', 'anthropic');
  });
});
