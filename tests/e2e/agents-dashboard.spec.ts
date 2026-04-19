// tests/e2e/agents-dashboard.spec.ts — Phase 5 SC-1 falsifier (AGENT-01).
//
// Asserts AgentDashboard renders a real surface at /agents — NOT the Phase 1
// ComingSoonSkeleton stub. The route was replaced in Plan 05-02 with a lazy
// import of AgentDashboard.tsx (Plan 05-03 body). This spec exercises the
// live wire by:
//
//   1. Booting as a returning user (__TAURI_INTERNALS__ shim pattern from
//      shell.spec.ts + hud-bar-render.spec.ts).
//   2. Mocking agent_list / get_active_agents / agent_detect_available invokes
//      so the dashboard resolves without a live Rust backend.
//   3. Navigating to /agents via `blade_route_request` (palette not used; the
//      route IS in the palette but we drive via the documented route-request
//      channel to match Phase 4 spec conventions).
//   4. Asserting the placeholder testid is GONE and the real surface mounts.
//
// Falsifier: if Plan 05-02's rewrite regressed to ComingSoonSkeleton, or if
// the Plan 05-03 body shipped a placeholder stub, this spec fails.
//
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2
// @see src/features/agents/AgentDashboard.tsx (data-testid surface)

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
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

    // Two synthetic agents: one Executing (running-bucket), one Completed.
    const mockAgents = [
      {
        id: 'agent-alpha',
        goal: 'Draft design doc',
        status: 'Executing',
        steps: [],
        current_step: 0,
        context: {},
        created_at: Math.floor(Date.now() / 1000) - 60,
        updated_at: Math.floor(Date.now() / 1000),
      },
      {
        id: 'agent-beta',
        goal: 'Summarize research',
        status: 'Completed',
        steps: [],
        current_step: 0,
        context: {},
        created_at: Math.floor(Date.now() / 1000) - 300,
        updated_at: Math.floor(Date.now() / 1000) - 240,
      },
    ];

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
        case 'get_config':                  return { ...baseConfig };
        case 'get_onboarding_status':       return true;
        case 'agent_list':                  return mockAgents;
        case 'agent_list_background':       return [];
        case 'get_active_agents':           return [];
        case 'agent_detect_available':      return ['claude-code'];
        case 'emit_route_request':          return null;
        default:                            return null;
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

test.describe('Phase 5 SC-1 — AgentDashboard renders real surface', () => {
  test('AgentDashboard mounts at /agents; placeholder is gone (AGENT-01)', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Navigate to /agents via the documented route-request channel.
    await handles.emitEvent('blade_route_request', { route_id: 'agents' });

    // The real Plan 05-03 surface mounts — agent-dashboard-root testid present.
    await expect(page.locator('[data-testid="agent-dashboard-root"]')).toBeVisible({
      timeout: 5000,
    });

    // Phase 1 placeholder testid MUST NOT be present — if ComingSoonSkeleton
    // ever reappears on this route, the SC-1 gate fails.
    await expect(page.locator('[data-testid="agent-dashboard-placeholder"]')).toHaveCount(0);

    // At least the filter-pill row renders (Plan 05-03 AgentDashboard surface).
    // The 2 mocked agents land in grouped sections (Executing → running, Completed → complete).
    await expect(page.locator('[data-testid="agent-dashboard-card"]').first()).toBeVisible({
      timeout: 5000,
    });
  });
});
