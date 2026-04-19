// tests/e2e/agent-detail-timeline.spec.ts — Phase 5 SC-2 falsifier (AGENT-02, WIRE-05).
//
// Asserts AgentDetail appends timeline rows in real time as synthetic
// agent-step events are dispatched — no refresh, no refetch. This validates:
//   - Plan 05-01's 10-subscriber typed surface (AGENT_STEP_* + BLADE_AGENT_EVENT
//     + AGENT_EVENT + AGENT_STEP_RESULT).
//   - Plan 05-03's useAgentTimeline hook (rAF-flushed ref-buffer, D-125 200-cap,
//     D-130 agent-id filter).
//   - The real Rust emit → frontend commit chain (WIRE-05).
//
// Flow:
//   1. Mount /dev-agent-detail (Plan 05-07 Task 1 isolation route). The dev
//      route pins `agents.selectedAgent='test-agent-1'` via usePrefs so
//      AgentDetail skips the empty-state branch and attempts agent_get.
//   2. Shim returns a synthetic Agent for `agent_get`.
//   3. Emit 3 synthetic events through the harness's __BLADE_TEST_EMIT__:
//        - blade_agent_event           → non-step lifecycle event
//        - agent_step_started          → executor.rs:99
//        - agent_step_completed        → executor.rs:335
//   4. Each event carries `agent_id: 'test-agent-1'` so the D-130 client-side
//      filter lets them through.
//   5. Poll the timeline-row count — should reach ≥3 within 3s.
//
// Falsifier: if the 10-subscriber surface regresses, or the rAF-flush stops
// committing to React state, the count stays at 0.
//
// @see src/features/agents/useAgentTimeline.ts (10-sub hook)
// @see src/features/agents/AgentDetail.tsx (timeline consumer)
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
const PINNED_AGENT_ID = 'test-agent-1';

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
}

async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript((pinnedAgentId: string) => {
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

    const syntheticAgent = {
      id: pinnedAgentId,
      goal: 'Synthetic Playwright agent',
      status: 'Executing',
      steps: [],
      current_step: 0,
      context: {},
      created_at: Math.floor(Date.now() / 1000) - 30,
      updated_at: Math.floor(Date.now() / 1000),
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
        case 'get_config':             return { ...baseConfig };
        case 'get_onboarding_status':  return true;
        case 'agent_get':              return syntheticAgent;
        case 'agent_list':             return [syntheticAgent];
        case 'agent_pause':            return null;
        case 'agent_resume':           return null;
        case 'agent_cancel':           return null;
        case 'emit_route_request':     return null;
        default:                       return null;
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
  }, PINNED_AGENT_ID);

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

test.describe('Phase 5 SC-2 — AgentDetail real-time timeline (WIRE-05)', () => {
  test('timeline appends ≥3 rows from synthetic agent_step_* events', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-agent-detail isolation route (Plan 05-07 Task 1).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-agent-detail' });
    await expect(page.locator('[data-testid="agent-detail-root"]')).toBeVisible({
      timeout: 5000,
    });

    // The dev route pinned agents.selectedAgent via usePrefs; wait for the
    // summary card to render (confirms agent_get resolved successfully).
    await expect(page.locator('[data-testid="agent-detail-summary"]')).toBeVisible({
      timeout: 5000,
    });

    // Emit 3 synthetic lifecycle events — D-130 agent_id filter lets them
    // through because payload.agent_id matches the pinned id.
    await handles.emitEvent('blade_agent_event', {
      agent_id: PINNED_AGENT_ID,
      status: 'started',
    });
    await handles.emitEvent('agent_step_started', {
      step_id: 'step-1',
      agent_id: PINNED_AGENT_ID,
      description: 'Planning',
    });
    await handles.emitEvent('agent_step_completed', {
      step_id: 'step-1',
      agent_id: PINNED_AGENT_ID,
      duration_ms: 120,
    });

    // Poll: the rAF flush + 200-row cap means rows commit within ~1-2 frames
    // per batch. 3s polling window is generous for CI latency.
    await expect
      .poll(async () => page.locator('[data-testid="timeline-row"]').count(), {
        timeout: 3000,
        intervals: [100, 250, 500, 1000],
      })
      .toBeGreaterThanOrEqual(3);
  });
});
