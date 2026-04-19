// tests/e2e/error-boundary-recovery.spec.ts — Phase 9 Plan 09-06 (POL-03 / SC-3).
//
// Direct falsifier for ROADMAP Phase 9 SC-3:
//   "Every top-level route is wrapped in an error boundary; a simulated error
//    shows a recovery affordance (retry / reset / report), never an unhandled
//    crash."
//
// Simulation approach:
//   - WorldModel.tsx mounts and calls worldGetState() → invoke('world_get_state').
//   - The returning-user shim normally swallows unknown invokes (returns null).
//   - We override: the shim throws a SIMULATED_CRASH Error for `world_get_state`
//     so the component's setState error path (or the Promise rejection) surfaces
//     into React's render tree.
//
// What the spec asserts:
//   1. Navigate to /#/world-model via blade_route_request (Plan 02-06 route plumb).
//   2. The top-level <ErrorBoundary resetKey={route.id}> (wrapped in MainShell
//      RouteSlot by Plan 09-02 Task 3) catches any render error.
//   3. role="alert" with aria-label "Route error — recovery affordances below"
//      becomes visible — matches /Route error/i accessible-name regex.
//   4. Click "Back to dashboard" → handleHome sets window.location.hash = '#/dashboard'
//      → router navigates; resetKey prop changes → ErrorBoundary clears state
//      → alert is hidden.
//
// NOTE on simulation fidelity:
//   WorldModel.tsx `load()` catches the invoke rejection and calls setError()
//   rather than re-throwing — so the error flows through state, not the error
//   boundary. To trigger the boundary the test uses a synchronous render-time
//   crash path: __BLADE_FORCE_CRASH__ global flag that the shim sets to true,
//   and an inline check inside WorldModel would be required. Since we cannot
//   modify product code from this spec, we instead force a boundary catch by
//   throwing inside a useTauriEvent subscription — the shim's listen callback
//   throws which bubbles up through the effect handler.
//
//   Simpler path that works with existing code: we navigate to world-model,
//   then synchronously throw from a listener dispatch to provoke a render-
//   phase error in the boundary. Actual implementation below uses a dedicated
//   shim flag.
//
// @see src/design-system/primitives/ErrorBoundary.tsx  (role=alert; aria-label)
// @see src/windows/main/MainShell.tsx                   (RouteSlot wrap)
// @see src/features/body/WorldModel.tsx                 (world_get_state caller)
// @see .planning/phases/09-polish/09-PATTERNS.md §10

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  armCrash: () => Promise<void>;
  emitEvent: (event: string, payload: unknown) => Promise<void>;
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
      crashArmed: false,
    };

    (window as unknown as { __BLADE_ARM_CRASH__: () => void }).__BLADE_ARM_CRASH__ = () => {
      state.crashArmed = true;
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
      // ── SIMULATED_CRASH for WorldModel's world_get_state call.
      // Once crashArmed is true, ANY call to world_get_state throws. Returning
      // a rejected Promise would flow through .catch() into setError() without
      // triggering the boundary; throwing synchronously from inside an async
      // path still rejects the returned promise. To force a render-phase crash
      // we return a Proxy whose property access throws — when WorldModel reads
      // state.active_window (etc.) in its render, it synchronously throws
      // inside React render → boundary catches. (WorldModel.tsx line ~53
      // setState(await worldGetState()) flow: the resolved value flows into
      // React state; property access on THAT value inside render raises.)
      if (cmd === 'world_get_state') {
        if (state.crashArmed) {
          // Return a Proxy object that throws on any property read — forces a
          // render-phase synchronous exception inside WorldModel's render.
          return new Proxy(
            {},
            {
              get(_t, prop) {
                throw new Error(`SIMULATED_CRASH accessing ${String(prop)}`);
              },
            },
          );
        }
        return {
          ts: Math.floor(Date.now() / 1000),
          workspace_cwd: '/tmp',
          active_window: null,
          net_activity: null,
          system_load: null,
          git: [],
          processes: [],
          ports: [],
          file_changes: [],
          todos: [],
        };
      }
      switch (cmd) {
        case 'get_config':            return { ...baseConfig };
        case 'get_onboarding_status': return true;
        case 'emit_route_request':    return null;
        default:                      return null;
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
    armCrash: () =>
      page.evaluate(() => {
        const w = window as unknown as { __BLADE_ARM_CRASH__?: () => void };
        w.__BLADE_ARM_CRASH__?.();
      }),
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

test.describe('Phase 9 SC-3 — ErrorBoundary recovery panel on simulated route crash', () => {
  test('world_get_state crash surfaces Route error alert; Back-to-dashboard clears it', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Arm the crash before mounting WorldModel. ANY subsequent world_get_state
    // invoke returns a throwing Proxy → WorldModel render synchronously throws
    // → ErrorBoundary catches it.
    await handles.armCrash();

    // Route to /#/world-model via the blade_route_request event (matches
    // Plan 02-06 palette nav path).
    await handles.emitEvent('blade_route_request', { route_id: 'world-model' });

    // The ErrorBoundary panel renders role="alert" with aria-label
    // "Route error — recovery affordances below".
    const alert = page.getByRole('alert', { name: /Route error/i });
    await expect(alert).toBeVisible({ timeout: 10_000 });

    // Click Back-to-dashboard — handleHome sets window.location.hash = '#/dashboard'
    // which changes the active route; resetKey prop on the next boundary mount
    // differs so state clears. Assert the alert vanishes.
    await page.getByRole('button', { name: /Back to dashboard/i }).click();
    await expect(alert).toBeHidden({ timeout: 5_000 });
  });
});
