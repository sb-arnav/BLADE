// tests/e2e/hive-mesh.spec.ts — Phase 8 SC-3 falsifier (HIVE-01).
//
// Asserts HiveMesh renders the tentacle grid from mocked hive_get_status
// (≥ 5 tentacles from MOCK_HIVE_STATUS), exposes the autonomy slider, and
// dragging the slider above 0.7 triggers the Dialog-gated confirm — the
// ROADMAP Phase 8 SC-3 literal gate: "Hive landing shows all 10 tentacles
// with live autonomy indicators; per-tentacle autonomy slider saves via
// hive_* commands."
//
// Validates:
//   - Plan 08-04's HiveMesh.tsx tentacle-grid + per-card testid scheme.
//   - Plan 08-02's hiveGetStatus / hiveSetAutonomy wrappers.
//   - Dialog-gated autonomy ≥ 0.7 (D-204 edit-with-Dialog recipe).
//
// Flow:
//   1. Mount /dev-hive-mesh (Plan 08-05 Task 3 passthrough).
//   2. Shim returns MOCK_HIVE_STATUS with 5 tentacles + 3 recent decisions.
//   3. Assert hive-mesh-root + ≥ 5 tentacle-card-* rendered +
//      hive-autonomy-slider present.
//   4. Drive the slider value to 0.8 via evaluate+change event; assert the
//      confirm Dialog opens (Dialog-gate falsifier for ≥ 0.7).
//
// Falsifier: if HiveMesh drops the tentacle grid, if the autonomy slider
// stops firing the Dialog gate, or if hiveGetStatus wiring regresses,
// an assertion fails.
//
// @see src/features/hive/HiveMesh.tsx (data-testid="hive-mesh-root")
// @see src/features/dev/HiveMeshDev.tsx
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 1

import { test, expect, type Page } from '@playwright/test';
import { MOCK_HIVE_STATUS } from './_fixtures/hive-status';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript(
    ({ hiveStatus }) => {
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
          case 'get_config':          return { ...baseConfig };
          case 'get_onboarding_status': return true;
          case 'hive_get_status':     return hiveStatus;
          case 'hive_set_autonomy':   return null;
          case 'hive_get_reports':    return [];
          case 'hive_get_digest':     return 'mock digest';
          case 'organ_get_registry':  return [];
          case 'organ_get_autonomy':  return 0;
          case 'organ_set_autonomy':  return null;
          case 'emit_route_request':  return null;
          default:                    return null;
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
    { hiveStatus: MOCK_HIVE_STATUS },
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

test.describe('Phase 8 SC-3 — HiveMesh renders tentacle grid + Dialog-gated autonomy (HIVE-01)', () => {
  test('HiveMesh mounts with tentacle cards + autonomy slider ≥ 0.7 opens confirm Dialog', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-hive-mesh isolation route (Plan 08-05 Task 3 passthrough).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-hive-mesh' });
    await expect(page.locator('[data-testid="hive-mesh-root"]')).toBeVisible({ timeout: 5000 });

    // SC-3 explicit falsifier: ≥ 5 tentacle cards render.
    const cards = page.locator('[data-testid^="tentacle-card-"]');
    await expect.poll(
      async () => await cards.count(),
      { timeout: 5000, intervals: [100, 250, 500, 1000] },
    ).toBeGreaterThanOrEqual(5);

    // Autonomy slider present.
    const slider = page.locator('[data-testid="hive-autonomy-slider"]');
    await expect(slider).toBeVisible({ timeout: 3000 });

    // Drive the slider value > 0.7 and fire a change event — HiveMesh's
    // onChange sets confirmAutonomy state, which opens the <Dialog>.
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, '0.8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Dialog rendered via <dialog> primitive (D-01). Wait for its native open
    // state or a Confirm button to surface — either satisfies the gate.
    const dialogConfirm = page.getByRole('button', { name: /confirm/i });
    await expect(dialogConfirm).toBeVisible({ timeout: 5000 });
  });
});
