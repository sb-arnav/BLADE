// tests/e2e/settings-providers-pane.spec.ts — Phase 11 Plan 11-03 (D-52 + D-57).
//
// Proves the Settings → Providers pane:
//   1. ProviderPasteForm is rendered at the top (heading "Paste any config").
//   2. Anthropic provider row renders a 4-pill capability strip after the
//      backend returns a ProviderCapabilityRecord for it.
//   3. Clicking the Re-probe icon button invokes probe_provider_capabilities
//      WITHOUT an api_key argument (Plan 11-02 api_key: Option<String>
//      keyring-fallback contract; T-11-32 mitigation).
//   4. Re-probe aria-label is exactly "Re-probe anthropic capabilities".
//
// Navigation uses the window.__BLADE_TEST_OPEN_ROUTE test-only hatch (Plan
// 11-05 Task 1 — gated on import.meta.env.DEV + ?e2e=1). No fallback to
// clicking nav links; the hatch is the committed path.
//
// @see src/features/providers/CapabilityPillStrip.tsx
// @see src/features/settings/panes/ProvidersPane.tsx
// @see src-tauri/src/capability_probe.rs
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md Surface B
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §20

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface InvokeLogEntry { cmd: string; args: unknown }

interface ShimHandles {
  getInvokeCalls: () => Promise<InvokeLogEntry[]>;
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

    // Reflective config — saveConfigField mutates `provider_capabilities`
    // so the re-probe assertion can read back the updated record.
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
      fallback_providers: ['anthropic'] as string[],
      provider_capabilities: {
        anthropic: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          context_window: 200000,
          vision: true,
          audio: false,
          tool_calling: true,
          long_context: true,
          last_probed: new Date().toISOString(),
          probe_status: 'Active',
        },
      } as Record<string, unknown>,
    };

    const keyring = {
      providers: [
        { provider: 'anthropic', has_key: true, masked: 'sk-a***1234', is_active: true },
      ],
      active_provider: 'anthropic / claude-sonnet-4-20250514',
    };

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
          return { ...baseConfig };
        case 'get_onboarding_status':
          return true;
        case 'get_all_provider_keys':
          return { ...keyring };
        case 'probe_provider_capabilities':
          // Second-call returns an UPDATED record (context window bumped) so
          // the UI can observe the change.
          return {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            context_window: 500000,
            vision: true,
            audio: true,
            tool_calling: true,
            long_context: true,
            last_probed: new Date().toISOString(),
            probe_status: 'Active',
          };
        case 'save_config_field': {
          const a = (args ?? {}) as { key?: string; value?: string };
          if (a.key === 'provider_capabilities' && typeof a.value === 'string') {
            try {
              baseConfig.provider_capabilities = JSON.parse(a.value);
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
  };
}

/** Navigate via the test-only hatch window.__BLADE_TEST_OPEN_ROUTE that
 *  Plan 11-05 Task 1 attaches inside useRouter (dev-mode + ?e2e=1 only). */
async function openSettingsProviders(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fn = (window as unknown as {
      __BLADE_TEST_OPEN_ROUTE?: (id: string) => void;
    }).__BLADE_TEST_OPEN_ROUTE;
    if (typeof fn === 'function') fn('settings-providers');
  });
}

test.describe('Phase 11 D-52 — Settings pane capability pill strip + Re-probe', () => {
  test('pill strip renders for anthropic → re-probe invoked without api_key → record updated', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await openSettingsProviders(page);

    // 1. ProviderPasteForm rendered at the top — heading verbatim.
    await expect(page.getByRole('heading', { name: 'Paste any config' })).toBeVisible();

    // 2. Anthropic row shows a 4-pill capability strip (role=list with
    //    aria-label "anthropic capabilities").
    const strip = page.locator('ul[aria-label="anthropic capabilities"]');
    await expect(strip).toBeVisible();

    // 3. 4 capability <li> + 1 re-probe <li> = 5 children.
    await expect(strip.locator('> li')).toHaveCount(5);

    // 4. Re-probe button has the exact locked aria-label.
    const reprobe = page.getByRole('button', { name: 'Re-probe anthropic capabilities' });
    await expect(reprobe).toBeVisible();

    await reprobe.click();

    // 5. probe_provider_capabilities was invoked …
    await expect.poll(
      async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'probe_provider_capabilities'),
      { timeout: 3000 },
    ).toBeTruthy();

    // 6. … AND the invoke payload did NOT include an api_key (Plan 11-02
    //    keyring-fallback contract). Omitting the key means the TS arg
    //    object literally has no `api_key` (or `apiKey`) property; the
    //    shim logs the args verbatim.
    const probeCall = (await handles.getInvokeCalls()).find((c) => c.cmd === 'probe_provider_capabilities')!;
    const probeArgs = (probeCall.args ?? {}) as Record<string, unknown>;
    expect(probeArgs.api_key).toBeUndefined();
    expect(probeArgs.apiKey).toBeUndefined();
    expect(probeArgs.provider).toBe('anthropic');

    // 7. save_config_field called to persist the updated capabilities.
    await expect.poll(
      async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'save_config_field'),
      { timeout: 3000 },
    ).toBeTruthy();
    const saveCall = (await handles.getInvokeCalls()).find((c) => c.cmd === 'save_config_field')!;
    const saveArgs = (saveCall.args ?? {}) as Record<string, unknown>;
    expect(saveArgs.key).toBe('provider_capabilities');
  });
});
