// tests/e2e/perf-dashboard-fp.spec.ts — Phase 9 Plan 09-05 (D-223, POL-05).
//
// Dashboard first paint budget (loose CI target ≤ 250ms). The tight 200ms P-01
// target lives in Mac-smoke M-41 — headless CI carries ~50ms of Playwright +
// webServer overhead that muddies the number, so we budget +25% here and let
// metal hardware close the loop.
//
// Approach:
//   1. Install the returning-user Tauri shim (same pattern as dashboard-paint
//      spec) so ConfigContext resolves immediately, no IPC wait.
//   2. Navigate to / — the default route resolves to DEFAULT_ROUTE_ID
//      ('dashboard').
//   3. Read performance.getEntriesByType('paint') → find first-contentful-paint.
//      Assert startTime < 250ms (loose CI budget; Mac-smoke M-41 validates 200ms).
//
// @see .planning/phases/09-polish/09-CONTEXT.md §D-223
// @see tests/e2e/dashboard-paint.spec.ts (Phase 3 tight-budget reference)

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
/** D-223 loose CI budget — metal target is 200ms (Mac-smoke M-41). */
const HEADLESS_FP_BUDGET_MS = 250;

async function installShim(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type AnyFn = (...args: unknown[]) => unknown;
    interface Listener { eventId: number; event: string; callback: AnyFn }

    const state = {
      nextCallbackId: 1,
      nextEventId: 1,
      callbacks: new Map<number, AnyFn>(),
      listeners: new Map<number, Listener>(),
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
    };

    const syntheticPerception = {
      active_app: 'Test App',
      active_title: 'perf-fp harness',
      user_state: 'focused',
      ram_used_gb: 4.2,
      disk_free_gb: 120.0,
      top_cpu_process: 'node',
      visible_errors: [] as string[],
    };

    const syntheticHormones = {
      arousal: 0.3,
      energy_mode: 0.5,
      exploration: 0.4,
      trust: 0.6,
      urgency: 0.2,
      hunger: 0.3,
      thirst: 0.3,
      insulin: 0.4,
      adrenaline: 0.2,
      leptin: 0.5,
      last_updated: Date.now(),
    };

    async function handleInvoke(cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
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
        case 'perception_get_latest':   return syntheticPerception;
        case 'perception_update':       return syntheticPerception;
        case 'homeostasis_get':         return syntheticHormones;
        default:                         return null;
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
}

test.describe('Phase 9 POL-05 — Dashboard first paint CI budget (D-223)', () => {
  test('paint.first-contentful-paint < 250ms (loose CI; Mac-smoke M-41 enforces 200ms)', async ({ page }) => {
    await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Wait for first-contentful-paint to land before reading the entries.
    await page.waitForFunction(
      () => performance.getEntriesByType('paint').some((e) => e.name === 'first-contentful-paint'),
      undefined,
      { timeout: 5_000 },
    );

    const fp = await page.evaluate(() => {
      const entries = performance.getEntriesByType('paint');
      const fcp = entries.find((e) => e.name === 'first-contentful-paint');
      return fcp ? fcp.startTime : null;
    });

    // eslint-disable-next-line no-console
    console.log(`[perf-dashboard-fp] first-contentful-paint: ${fp?.toFixed(1) ?? 'null'}ms (budget ${HEADLESS_FP_BUDGET_MS}ms)`);

    expect(fp).not.toBeNull();
    expect(fp!).toBeGreaterThanOrEqual(0);
    expect(fp!).toBeLessThan(HEADLESS_FP_BUDGET_MS);
  });
});
