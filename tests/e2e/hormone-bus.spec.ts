// tests/e2e/hormone-bus.spec.ts — Phase 8 SC-2 falsifier (BODY-03).
//
// Asserts HormoneBus renders all 10 hormone rows from mocked homeostasis_get,
// displays a dominant-hormone chip, renders the 24-bar circadian grid, and
// updates live when a HORMONE_UPDATE event fires — the ROADMAP Phase 8 SC-2
// literal gate: "hormone dashboard displays all 10 hormone values and updates
// in real time when hormone_update events arrive from homeostasis.rs
// (WIRE-02 flowing into this surface)."
//
// Validates:
//   - Plan 08-03's HormoneBus.tsx 10 hormone-row-* meters + hormone-dominant chip.
//   - Plan 03-02's homeostasisGet / homeostasisGetCircadian wrappers.
//   - Phase 3 HORMONE_UPDATE event subscription (useTauriEvent).
//   - 24-bar circadian-grid layout (D-203).
//
// Flow:
//   1. Mount /dev-hormone-bus (Plan 08-05 Task 3 passthrough).
//   2. Shim returns MOCK_HORMONE_STATE (all 10 fields) + MOCK_CIRCADIAN (24).
//   3. Assert hormone-bus-root mounts + 10 hormone-row-* + hormone-dominant
//      visible + 24 circadian bars.
//   4. Emit hormone_update with arousal bumped to 0.95; assert the
//      hormone-row-arousal value chip updates to "0.95".
//
// Falsifier: if any hormone row is dropped, if the dominant chip stops
// reading from homeostasisGet, if the circadian grid regresses below 24
// bars, or if HORMONE_UPDATE stops driving live updates, an assertion fails.
//
// @see src/features/body/HormoneBus.tsx (data-testid="hormone-bus-root")
// @see src/features/dev/HormoneBusDev.tsx
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 1
// Note: HormoneBus isn't isolated via a dev route (reuses existing
// /hormone-bus cluster route via blade_route_request route_id="hormone-bus").

import { test, expect, type Page } from '@playwright/test';
import { MOCK_HORMONE_STATE, MOCK_CIRCADIAN } from './_fixtures/hive-status';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript(
    ({ state: initialState, circadian }) => {
      type AnyFn = (...args: unknown[]) => unknown;
      interface Listener { eventId: number; event: string; callback: AnyFn }

      const shim = {
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

      function emit(event: string, payload: unknown): void {
        for (const l of shim.listeners.values()) {
          if (l.event !== event) continue;
          try { l.callback({ event, id: l.eventId, payload }); }
          catch (e) { console.error('[test-shim] listener threw', e); }
        }
      }
      (window as unknown as { __BLADE_TEST_EMIT__: typeof emit }).__BLADE_TEST_EMIT__ = emit;

      async function handleInvoke(cmd: string, args: Record<string, unknown> | undefined): Promise<unknown> {
        if (cmd === 'plugin:event|listen') {
          const a = (args ?? {}) as { event?: string; handler?: number };
          const handlerId = typeof a.handler === 'number' ? a.handler : -1;
          const cb = shim.callbacks.get(handlerId);
          if (!cb || typeof a.event !== 'string') {
            throw new Error(`plugin:event|listen: missing callback or event (handler=${handlerId}, event=${String(a.event)})`);
          }
          const eventId = shim.nextEventId++;
          shim.listeners.set(eventId, { eventId, event: a.event, callback: cb });
          return eventId;
        }
        if (cmd === 'plugin:event|unlisten') {
          const a = (args ?? {}) as { eventId?: number };
          if (typeof a.eventId === 'number') shim.listeners.delete(a.eventId);
          return null;
        }
        switch (cmd) {
          case 'get_config':                    return { ...baseConfig };
          case 'get_onboarding_status':         return true;
          case 'homeostasis_get':               return initialState;
          case 'homeostasis_get_circadian':     return circadian;
          case 'homeostasis_get_directive':     return {
            model_tier: 'balanced',
            poll_rate: 1.0,
            allow_expensive_ops: true,
            autonomous: false,
            reason: 'mock directive',
          };
          case 'homeostasis_relearn_circadian': return circadian;
          case 'emit_route_request':            return null;
          default:                              return null;
        }
      }

      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown> | undefined) => handleInvoke(cmd, args),
        transformCallback: (callback: AnyFn, _once?: boolean): number => {
          const id = shim.nextCallbackId++;
          shim.callbacks.set(id, callback);
          return id;
        },
        unregisterCallback: (id: number): void => { shim.callbacks.delete(id); },
        convertFileSrc: (p: string): string => p,
      };
    },
    { state: MOCK_HORMONE_STATE, circadian: MOCK_CIRCADIAN },
  );

  return {
    emitEvent: (event, payload) =>
      page.evaluate(
        ([e, p]) => {
          const w = window as unknown as {
            __BLADE_TEST_EMIT__?: (event: string, payload: unknown) => void;
          };
          w.__BLADE_TEST_EMIT__?.(e as string, p);
        },
        [event, payload] as [string, unknown],
      ),
  };
}

test.describe('Phase 8 SC-2 — HormoneBus renders 10 hormones + live HORMONE_UPDATE (BODY-03)', () => {
  test('HormoneBus mounts with 10 rows + dominant chip + 24-bar circadian + live update', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Route into /hormone-bus via blade_route_request — the real cluster route
    // (Plan 08-03) has the full implementation; no dev passthrough needed.
    await handles.emitEvent('blade_route_request', { route_id: 'hormone-bus' });
    await expect(page.locator('[data-testid="hormone-bus-root"]')).toBeVisible({ timeout: 5000 });

    // 10 hormone meters render (SC-2 explicit falsifier).
    await expect(page.locator('[data-testid^="hormone-row-"]')).toHaveCount(10, { timeout: 5000 });

    // Dominant chip visible.
    await expect(page.locator('[data-testid="hormone-dominant"]')).toBeVisible({ timeout: 5000 });

    // 24-bar circadian grid.
    const circadianGrid = page.locator('[data-testid="circadian-grid"]');
    await expect(circadianGrid).toBeVisible({ timeout: 5000 });
    await expect(circadianGrid.locator('.circadian-bar')).toHaveCount(24, { timeout: 5000 });

    // Live update: emit hormone_update with arousal bumped — the arousal row
    // value chip must re-render with the new value (SC-2 "updates in real time").
    await handles.emitEvent('hormone_update', {
      ...MOCK_HORMONE_STATE,
      arousal: 0.95,
      last_updated: Date.now(),
    });

    const arousalRow = page.locator('[data-testid="hormone-row-arousal"]');
    await expect(arousalRow.locator('.hormone-value')).toHaveText('0.95', { timeout: 5000 });
  });
});
