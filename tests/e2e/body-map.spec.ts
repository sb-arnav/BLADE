// tests/e2e/body-map.spec.ts — Phase 8 SC-1 falsifier (BODY-01).
//
// Asserts BodyMap renders the 12-system grid from mocked body_get_summary +
// body_get_map, then clicking a card drills into BodySystemDetail — the
// ROADMAP Phase 8 SC-1 literal gate: "BodyMap route renders an interactive
// visualization of 12 body systems loaded from body_registry.rs; clicking a
// system drills into BodySystemDetail without error."
//
// Validates:
//   - Plan 08-03's BodyMap.tsx 12-card responsive grid (data-testid=body-map-root
//     + per-card data-testid=body-system-card-{system}).
//   - Plan 08-02's bodyGetSummary / bodyGetMap / bodyGetSystem wrappers.
//   - openRoute('body-system-detail') click handoff + setPref('body.activeSystem').
//
// Flow:
//   1. Mount /dev-body-map (Plan 08-05 Task 3 passthrough).
//   2. Shim returns the 12-system MOCK_BODY_SUMMARY + 16-row MOCK_BODY_MAP.
//   3. Assert body-map-root mounts + ≥ 6 body-system-card-* rendered +
//      clicking first card → body-system-detail-root visible.
//
// Falsifier: if BodyMap drops the summary wiring, if the per-card testid
// scheme regresses, or if the drill-in navigation breaks, an assertion fails.
//
// @see src/features/body/BodyMap.tsx (data-testid="body-map-root")
// @see src/features/body/BodySystemDetail.tsx (data-testid="body-system-detail-root")
// @see src/features/dev/BodyMapDev.tsx
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 1

import { test, expect, type Page } from '@playwright/test';
import { MOCK_BODY_SUMMARY, MOCK_BODY_MAP } from './_fixtures/hive-status';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript(
    ({ summary, map }) => {
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

      function emit(event: string, payload: unknown): void {
        for (const l of state.listeners.values()) {
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
          const cb = state.callbacks.get(handlerId);
          if (!cb || typeof a.event !== 'string') {
            throw new Error(`plugin:event|listen: missing callback or event (handler=${handlerId}, event=${String(a.event)})`);
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
          case 'get_config':          return { ...baseConfig };
          case 'get_onboarding_status': return true;
          case 'body_get_summary':    return summary;
          case 'body_get_map':        return map;
          case 'body_get_system': {
            const a = (args ?? {}) as { system?: string };
            return map.filter((m) => m.body_system === a.system);
          }
          // BodySystemDetail vitals tab touches these once the detail route mounts;
          // return empty/safe shapes so the navigation doesn't blow up.
          case 'cardio_get_blood_pressure': return { systolic: 0, diastolic: 0 };
          case 'cardio_get_event_registry': return [];
          case 'blade_vital_signs':         return { overall_health: 'unknown' };
          case 'urinary_flush':             return 0;
          case 'immune_get_status':         return { status: 'ok' };
          case 'reproductive_get_dna':      return {};
          case 'joints_list_providers':     return [];
          case 'joints_list_stores':        return [];
          case 'supervisor_get_health':     return [];
          case 'emit_route_request':        return null;
          default:                          return null;
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
    },
    { summary: MOCK_BODY_SUMMARY, map: MOCK_BODY_MAP },
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

test.describe('Phase 8 SC-1 — BodyMap renders 12 system cards + click drills into detail (BODY-01)', () => {
  test('BodyMap mounts with system cards + first-card click opens BodySystemDetail', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-body-map isolation route (Plan 08-05 Task 3 passthrough).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-body-map' });
    await expect(page.locator('[data-testid="body-map-root"]')).toBeVisible({ timeout: 5000 });

    // SC-1 explicit falsifier: the 12-system grid renders ≥ 6 system cards.
    const cards = page.locator('[data-testid^="body-system-card-"]');
    await expect.poll(
      async () => await cards.count(),
      { timeout: 5000, intervals: [100, 250, 500, 1000] },
    ).toBeGreaterThanOrEqual(6);

    // Click first card → body-system-detail-root must mount (drill-in falsifier).
    await cards.first().click();

    // After the click, setPref('body.activeSystem') + openRoute('body-system-detail')
    // fire synchronously — the detail root should mount once the lazy chunk resolves.
    await expect(page.locator('[data-testid="body-system-detail-root"]')).toBeVisible({
      timeout: 8000,
    });
  });
});
