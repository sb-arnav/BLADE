// tests/e2e/dashboard-paint.spec.ts — Phase 3 SC-5 falsifier (D-91 / D-77).
//
// SC-5: Dashboard first paint ≤ 200ms on metal; ≤ 400ms headless (D-77 doubles
// the budget for CI overhead per research). The measurement is the delta
// between two performance marks:
//   - 'boot'            — set in src/windows/main/main.tsx BEFORE React mounts
//   - 'dashboard-paint' — set in RightNowHero.tsx AFTER setState commits
// so the measure covers CSS parse → React root mount → ConfigContext resolve
// → MainShell gate → Dashboard lazy load → perception fetch → state commit.
//
// This spec:
//   1. Stubs perception_get_latest + homeostasis_get to return synthetic
//      payloads immediately (we don't want backend IPC latency polluting
//      the measure — that's a Phase 4+ concern).
//   2. Boots as a returning user (onboarded=true, persona_done=true) so the
//      gate goes straight to 'complete' and mounts the dashboard.
//   3. Waits for the 'dashboard-paint' mark to exist on window.performance.
//   4. Computes (dashboard-paint.startTime - boot.startTime) and asserts
//      it's under 400ms.
//
// @see src/features/dashboard/RightNowHero.tsx (mark site)
// @see src/windows/main/main.tsx (boot mark site)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-77, §D-91
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §13

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
/** D-77: metal budget is 200ms; headless CI is allotted 2× = 400ms. */
const HEADLESS_BUDGET_MS = 400;

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

    // Synthetic PerceptionState — minimal fields required by RightNowHero.
    const syntheticPerception = {
      active_app: 'Test App',
      active_title: 'spec harness',
      user_state: 'focused',
      ram_used_gb: 4.2,
      disk_free_gb: 120.0,
      top_cpu_process: 'node',
      visible_errors: [] as string[],
      // Any other PerceptionState fields we don't render are omitted — the
      // frontend reads them as `undefined`, which is fine per D-74.
    };

    // Synthetic HormoneState for AmbientStrip's first-paint homeostasisGet call.
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
        // Return perception synchronously — no artificial delay, so the
        // measure captures the true React + style commit path only.
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

test.describe('Phase 3 SC-5 — Dashboard first paint budget (D-77)', () => {
  test('performance.measure(boot → dashboard-paint) exists and is within headless budget', async ({ page }) => {
    await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Returning-user gate boots straight to dashboard (DEFAULT_ROUTE_ID).
    await expect(page.locator('[data-route-id="dashboard"]').first()).toBeVisible();

    // Wait for RightNowHero's post-setState performance.mark('dashboard-paint')
    // to land. The hero reports this AFTER its perception fetch + setState
    // commit, so the mark is the true first-paint moment for SC-5.
    await page.waitForFunction(
      () => performance.getEntriesByName('dashboard-paint').length > 0,
      undefined,
      { timeout: 5_000 },
    );

    // Assert BOTH marks are present before we do any timing math.
    const marks = await page.evaluate(() => {
      const boot = performance.getEntriesByName('boot')[0];
      const paint = performance.getEntriesByName('dashboard-paint')[0];
      return {
        bootStart: boot ? boot.startTime : null,
        paintStart: paint ? paint.startTime : null,
      };
    });
    expect(marks.bootStart).not.toBeNull();
    expect(marks.paintStart).not.toBeNull();

    const deltaMs = (marks.paintStart ?? 0) - (marks.bootStart ?? 0);
    // eslint-disable-next-line no-console
    console.log(`[dashboard-paint] boot → dashboard-paint: ${deltaMs.toFixed(1)}ms (headless budget ${HEADLESS_BUDGET_MS}ms, metal 200ms)`);

    // Non-negative sanity — paint mark must be AFTER boot mark.
    expect(deltaMs).toBeGreaterThanOrEqual(0);
    // SC-5 headless budget.
    expect(deltaMs).toBeLessThanOrEqual(HEADLESS_BUDGET_MS);
  });
});
