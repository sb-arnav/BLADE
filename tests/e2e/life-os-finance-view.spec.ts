// tests/e2e/life-os-finance-view.spec.ts — Phase 6 SC-2 falsifier (LIFE-02).
//
// Asserts FinanceView renders KPIs loaded via financial_* commands + the CSV
// import affordance is present — the ROADMAP Phase 6 SC-2 literal gate:
// "FinanceView displays a spending overview loaded via financial_* commands;
// CSV import affordance is present." Validates:
//   - Plan 06-03's FinanceView.tsx 4 KPI row + transactions + CSV button.
//   - Plan 06-02's financeGetSnapshot / financeGetTransactions /
//     financeGetGoals / financeDetectSubscriptions /
//     financeGenerateInsights / financeImportCsv wrappers.
//
// Flow:
//   1. Mount /dev-finance-view (Plan 06-07 Task 1 passthrough).
//   2. Shim returns canned rows matching Rust wire shapes.
//   3. Assert finance-view-root mounts + 4 finance-kpi cards +
//      finance-import-csv button present.
//
// Falsifier: if any KPI is dropped, if the CSV import button is removed, or
// if FinanceView regresses to a 404 placeholder, one of the assertions fails.
//
// @see src/features/life-os/FinanceView.tsx (data-testid="finance-view-root")
// @see src/features/dev/FinanceViewDev.tsx
// @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 2

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
    const todayIso = (() => {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    })();
    const monthIso = todayIso.slice(0, 7);

    // Matches FinancialSnapshot (Rust: month / income / expenses /
    // savings_rate / top_categories / vs_last_month).
    const mockSnapshot = {
      month: monthIso,
      income: 9000,
      expenses: 6500,
      savings_rate: 0.28,
      top_categories: [['groceries', 450], ['rent', 2000]],
      vs_last_month: { expenses: -120 },
    };

    // Matches FinanceTransaction.
    const mockTransactions = [
      {
        id: 'tx-1',
        amount: -45.23,
        category: 'groceries',
        description: 'Mock grocery run',
        date: todayIso,
        tags: [],
        created_at: now - 3600,
      },
      {
        id: 'tx-2',
        amount: 4500,
        category: 'income',
        description: 'Mock payday',
        date: todayIso,
        tags: [],
        created_at: now - 7200,
      },
    ];

    // Matches FinancialGoal.
    const mockGoals = [
      {
        id: 'goal-1',
        name: 'Mock emergency fund',
        target_amount: 10000,
        current_amount: 4500,
        deadline: '2026-12-31',
        monthly_required: 600,
      },
    ];

    // finance_detect_subscriptions returns Array<Record<string, unknown>>.
    const mockSubscriptions = [
      {
        merchant: 'Mock SaaS',
        amount: 14.99,
        cadence: 'monthly',
        monthly_cost: 14.99,
        last_charge: todayIso,
      },
    ];

    // Matches FinancialInsight.
    const mockInsights = [
      {
        insight_type: 'spending',
        title: 'Mock insight 1',
        description: 'Mock description.',
        action_items: ['Mock action'],
        urgency: 'low',
      },
      {
        insight_type: 'savings',
        title: 'Mock insight 2',
        description: 'Mock description 2.',
        action_items: [],
        urgency: 'medium',
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
        case 'get_config':                   return { ...baseConfig };
        case 'get_onboarding_status':        return true;
        case 'finance_get_snapshot':         return mockSnapshot;
        case 'finance_get_transactions':     return mockTransactions;
        case 'finance_get_goals':            return mockGoals;
        case 'finance_detect_subscriptions': return mockSubscriptions;
        case 'finance_generate_insights':    return mockInsights;
        case 'finance_import_csv':           return 42;
        case 'finance_auto_categorize':      return 'groceries';
        case 'emit_route_request':           return null;
        default:                             return null;
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

test.describe('Phase 6 SC-2 — FinanceView KPIs + CSV import (LIFE-02)', () => {
  test('FinanceView mounts with 4 KPI cards + CSV import affordance', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-finance-view isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-finance-view' });
    await expect(page.locator('[data-testid="finance-view-root"]')).toBeVisible({
      timeout: 5000,
    });

    // 4 KPI cards render (SC-2 explicit falsifier: balance/spending/savings/subscriptions).
    await expect(page.locator('[data-testid="finance-kpi"]')).toHaveCount(4, {
      timeout: 5000,
    });

    // CSV import button is present (SC-2 "CSV import affordance is present").
    await expect(page.locator('[data-testid="finance-import-csv"]')).toBeVisible({
      timeout: 3000,
    });
  });
});
