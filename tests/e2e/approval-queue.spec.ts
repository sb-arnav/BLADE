// tests/e2e/approval-queue.spec.ts — Phase 8 SC-4 falsifier (HIVE-04).
//
// Asserts ApprovalQueue renders pending decisions from mocked hive_get_status
// (≥ 1 approval-row-* from MOCK_HIVE_STATUS.recent_decisions) and clicking
// an Approve button invokes hive_approve_decision + dismisses the row — the
// ROADMAP Phase 8 SC-4 literal gate: "The decision approval queue displays
// pending approvals from all tentacles; a user can approve or reject an
// individual decision; the action is confirmed by BLADE's response."
//
// Validates:
//   - Plan 08-04's ApprovalQueue.tsx approval-row-* rendering from recent_decisions.
//   - Plan 08-02's hiveGetStatus / hiveApproveDecision wrappers.
//   - Per-row Approve button fires hive_approve_decision + optimistic dismissal.
//
// Flow:
//   1. Mount /dev-approval-queue (Plan 08-05 Task 3 passthrough).
//   2. Shim returns MOCK_HIVE_STATUS with 3 recent_decisions (Reply/Escalate/Act).
//   3. Assert approval-queue-root + ≥ 1 approval-row-* rendered.
//   4. Click approve-0 — shim records the invoke; assert total approval-row
//      count decreases OR the specific row is dismissed (optimistic update).
//
// Falsifier: if ApprovalQueue drops the rows, if Approve stops calling
// hive_approve_decision, or if the dismiss is not wired, an assertion fails.
//
// Deferrals (D-205): backend reject is client-side-only; this spec does not
// assert reject semantics.
//
// @see src/features/hive/ApprovalQueue.tsx (data-testid="approval-queue-root")
// @see src/features/dev/ApprovalQueueDev.tsx
// @see .planning/phases/08-body-hive/08-05-PLAN.md Task 1

import { test, expect, type Page } from '@playwright/test';
import { MOCK_HIVE_STATUS } from './_fixtures/hive-status';

const BOOT_TIMEOUT_MS = 15_000;

interface ShimHandles {
  emitEvent: (event: string, payload: unknown) => Promise<void>;
  approvedCount: () => Promise<number>;
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
        approvedCount: 0,
      };

      // Expose the approve counter for the spec to assert against.
      (window as unknown as { __BLADE_APPROVED_COUNT__: () => number }).__BLADE_APPROVED_COUNT__ =
        () => shim.approvedCount;

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
          case 'get_config':            return { ...baseConfig };
          case 'get_onboarding_status': return true;
          case 'hive_get_status':       return hiveStatus;
          case 'hive_approve_decision':
            shim.approvedCount += 1;
            return null;
          case 'emit_route_request':    return null;
          default:                      return null;
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
    approvedCount: () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __BLADE_APPROVED_COUNT__?: () => number;
        };
        return w.__BLADE_APPROVED_COUNT__?.() ?? 0;
      }),
  };
}

test.describe('Phase 8 SC-4 — ApprovalQueue renders rows + Approve fires hive_approve_decision (HIVE-04)', () => {
  test('ApprovalQueue mounts with rows + approve-0 click invokes hive_approve_decision', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-approval-queue isolation route (Plan 08-05 Task 3 passthrough).
    await handles.emitEvent('blade_route_request', { route_id: 'dev-approval-queue' });
    await expect(page.locator('[data-testid="approval-queue-root"]')).toBeVisible({ timeout: 5000 });

    // SC-4 explicit falsifier: ≥ 1 approval-row rendered from recent_decisions.
    const rows = page.locator('[data-testid^="approval-row-"]');
    await expect.poll(
      async () => await rows.count(),
      { timeout: 5000, intervals: [100, 250, 500, 1000] },
    ).toBeGreaterThanOrEqual(1);

    const initialCount = await rows.count();

    // Click the first Approve button. The row should be dismissed
    // (optimistic update) AND hive_approve_decision must have been invoked.
    await page.locator('[data-testid="approve-0"]').click();

    // hive_approve_decision fired at least once.
    await expect
      .poll(async () => await handles.approvedCount(), {
        timeout: 5000,
        intervals: [100, 250, 500, 1000],
      })
      .toBeGreaterThanOrEqual(1);

    // Row-0 dismissed → total visible approval-row count decreased
    // (or refreshed list shrinks). Either satisfies the SC-4 confirmation gate.
    await expect
      .poll(async () => await rows.count(), {
        timeout: 5000,
        intervals: [100, 250, 500, 1000],
      })
      .toBeLessThan(initialCount);
  });
});
