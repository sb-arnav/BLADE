// tests/e2e/onboarding-paste-card.spec.ts — Phase 11 Plan 11-03 (D-56).
//
// Proves the onboarding paste-flow end-to-end:
//   1. Boot the app in dev mode with ?e2e=1 (enables the
//      window.__BLADE_TEST_OPEN_ROUTE hatch installed by Plan 11-05 Task 1
//      on useRouter.ts, gated on import.meta.env).
//   2. Install a Tauri invoke shim that stubs get_config + get_onboarding_status
//      + parse_provider_paste + probe_provider_capabilities.
//   3. Locate the paste textarea (by aria-label "Provider config paste input").
//   4. Fill with the OpenAI cURL Sample C1 from 11-RESEARCH.md corpus.
//   5. Click "Detect & probe".
//   6. Assert parse_provider_paste + probe_provider_capabilities were both
//      invoked (via expect.poll against __TAURI_INVOKE_CALLS__).
//   7. Assert the 6 provider cards remain present (D-56 preservation:
//      role="radio" count === 6).
//
// @see src/features/providers/ProviderPasteForm.tsx
// @see src/features/onboarding/ProviderPicker.tsx
// @see src-tauri/src/provider_paste_parser.rs
// @see src-tauri/src/capability_probe.rs
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md Surface A
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §20

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface InvokeLogEntry { cmd: string; args: unknown }

interface ShimHandles {
  getInvokeCalls: () => Promise<InvokeLogEntry[]>;
}

const OPENAI_CURL_SAMPLE =
  `curl https://api.openai.com/v1/chat/completions \\\n` +
  `  -H "Authorization: Bearer sk-proj-abc123" \\\n` +
  `  -H "Content-Type: application/json" \\\n` +
  `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'`;

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

    const baseConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      onboarded: false,
      persona_onboarding_complete: false,
      last_deep_scan: 0,
      god_mode_tier: 'normal',
      voice_mode: 'off',
      tts_voice: 'system',
      wake_word_enabled: false,
      fallback_providers: [],
      provider_capabilities: {},
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
          return false; // trigger onboarding route
        case 'get_all_provider_keys':
          return { providers: [], active_provider: '' };
        case 'parse_provider_paste':
          return {
            provider_guess: 'openai',
            base_url: 'https://api.openai.com/v1',
            api_key: 'sk-proj-abc123',
            model: 'gpt-4o-mini',
            headers: { Authorization: 'Bearer sk-proj-abc123' },
          };
        case 'probe_provider_capabilities':
          return {
            provider: 'openai',
            model: 'gpt-4o-mini',
            context_window: 128000,
            vision: true,
            audio: false,
            tool_calling: true,
            long_context: true,
            last_probed: new Date().toISOString(),
            probe_status: 'Active',
          };
        case 'store_provider_key':
          return null;
        case 'switch_provider':
          return { ...baseConfig };
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

test.describe('Phase 11 D-56 — Onboarding paste card', () => {
  test('paste cURL → parse_provider_paste + probe_provider_capabilities invoked; 6 cards preserved', async ({ page }) => {
    const handles = await installShim(page);
    // Dev-mode + ?e2e=1 enables the __BLADE_TEST_OPEN_ROUTE hatch
    // (Plan 11-05 Task 1). Onboarding route is the default when
    // get_onboarding_status returns false.
    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // D-56 preservation: the 6 provider radio cards remain visible.
    const radios = page.locator('[role="radio"]');
    await expect(radios).toHaveCount(6);

    // Locate the paste textarea by its aria-label (locked copy).
    const textarea = page.getByLabel('Provider config paste input');
    await expect(textarea).toBeVisible();

    // Fill with the OpenAI cURL sample.
    await textarea.fill(OPENAI_CURL_SAMPLE);

    // Click the primary CTA — copy locked per UI-SPEC.
    await page.getByRole('button', { name: /^Detect & probe$/ }).click();

    // Assert both invokes fired.
    await expect.poll(
      async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'parse_provider_paste'),
      { timeout: 3000 },
    ).toBeTruthy();

    await expect.poll(
      async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'probe_provider_capabilities'),
      { timeout: 3000 },
    ).toBeTruthy();

    // After probe success, the CTA relabels to "Continue with this provider →".
    await expect(page.getByRole('button', { name: /Continue with this provider/ })).toBeVisible();

    // 6 cards STILL present (D-56 preservation post-probe).
    await expect(radios).toHaveCount(6);

    // Assert all 6 provider IDs are still DOM-addressable by their display names.
    for (const name of ['Anthropic', 'OpenAI', 'OpenRouter', 'Gemini', 'Groq', 'Ollama']) {
      await expect(page.getByRole('radio', { name: new RegExp(name, 'i') })).toBeVisible();
    }
  });
});
