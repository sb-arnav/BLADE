// tests/e2e/dev-tools-workflow-builder.spec.ts — Phase 7 DEV-05 falsifier.
//
// Asserts WorkflowBuilder renders a sidebar list + clicking a row reveals
// the detail pane with tabs. Validates:
//   - Plan 07-03's WorkflowBuilder.tsx sidebar + WorkflowDetail tabs.
//   - Plan 07-02's workflowList / workflowGet / workflowGetRuns wrappers.
//
// Flow:
//   1. Mount /dev-workflow-builder (Plan 07-07 Task 1 passthrough).
//   2. Shim returns 2 canned Workflow rows + canned runs + canned detail.
//   3. Assert workflow-builder-root mounts + ≥1 sidebar row + clicking
//      row opens workflow-detail-root + 3 tabs (Steps / Runs / Schedule).
//
// Falsifier: if WorkflowBuilder stops rendering sidebar rows from
// workflow_list, or if WorkflowDetail drops its 3-tab layout, or if the
// route regresses to a placeholder, an assertion fails.
//
// @see src/features/dev-tools/WorkflowBuilder.tsx
// @see src/features/dev-tools/WorkflowDetail.tsx
// @see src/features/dev/WorkflowBuilderDev.tsx
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 2

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

    const now = Math.floor(Date.now() / 1000);

    // Matches Workflow (src/lib/tauri/dev_tools.ts → src-tauri/src/workflow_builder.rs).
    const mockWorkflows = [
      {
        id: 'wf-1',
        name: 'Mock Workflow A',
        description: 'Primary mock workflow for Playwright spec',
        nodes: [],
        enabled: true,
        last_run: now - 1800,
        run_count: 3,
        created_at: now - 86400,
      },
      {
        id: 'wf-2',
        name: 'Mock Workflow B',
        description: 'Secondary mock workflow',
        nodes: [],
        enabled: true,
        last_run: null,
        run_count: 0,
        created_at: now - 43200,
      },
    ];

    // Matches WorkflowRun.
    const mockRuns = [
      {
        workflow_id: 'wf-1',
        run_id: 'run-1',
        started_at: now - 1800,
        ended_at: now - 1795,
        status: 'success',
        node_outputs: {},
        error: null,
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
        case 'get_config':                          return { ...baseConfig };
        case 'get_onboarding_status':               return true;
        case 'workflow_list':                       return mockWorkflows;
        case 'workflow_get':                        return mockWorkflows[0];
        case 'workflow_get_runs':                   return mockRuns;
        case 'workflow_run_now':                    return { run_id: 'run-new' };
        case 'workflow_create':                     return { ...mockWorkflows[0], id: 'wf-new', name: 'New' };
        case 'workflow_generate_from_description':  return { ...mockWorkflows[0], id: '', name: 'Generated' };
        case 'cron_list':                           return [];
        case 'emit_route_request':                  return null;
        default:                                    return null;
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

test.describe('Phase 7 DEV-05 — WorkflowBuilder list + detail + tabs', () => {
  test('WorkflowBuilder mounts + sidebar row click opens detail with 3 tabs', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await handles.emitEvent('blade_route_request', { route_id: 'dev-workflow-builder' });
    await expect(page.locator('[data-testid="workflow-builder-root"]')).toBeVisible({
      timeout: 5000,
    });

    // ≥1 sidebar row from mocked workflow_list.
    await expect.poll(
      async () => await page.locator('[data-testid="workflow-sidebar-row"]').count(),
      { timeout: 5000, intervals: [100, 250, 500, 1000] },
    ).toBeGreaterThanOrEqual(1);

    // Click first sidebar row → detail pane mounts.
    await page.locator('[data-testid="workflow-sidebar-row"]').first().click();
    await expect(page.locator('[data-testid="workflow-detail-root"]')).toBeVisible({
      timeout: 5000,
    });

    // 3 tabs render (Steps / Runs / Schedule per D-176).
    await expect(page.locator('[data-testid="workflow-tab"]')).toHaveCount(3, {
      timeout: 5000,
    });
  });
});
