// tests/e2e/life-os-health-view.spec.ts — Phase 6 SC-1 falsifier (LIFE-01).
//
// Asserts HealthView renders a real snapshot from mocked life-os commands —
// the ROADMAP Phase 6 SC-1 literal gate: "Navigating to any Life OS route
// produces a rendered surface; streak counters read from streak_* commands."
// Validates:
//   - Plan 06-03's HealthView.tsx 5-stat grid (sleep / activity / mood /
//     energy / sleep-quality) + streak chip.
//   - Plan 06-02's healthGetToday / healthGetStats / healthGetInsights /
//     healthStreakInfo / streakGetStats / healthGetScan wrappers.
//
// Flow:
//   1. Mount /dev-health-view (Plan 06-07 Task 1 passthrough).
//   2. Shim returns canned rows matching Rust wire shapes.
//   3. Assert health-view-root mounts + 5 health-stat cards + streak chip.
//
// Falsifier: if any stat card is dropped, if the streak chip stops reading
// from streak_* commands, or if HealthView regresses to a 404 placeholder,
// one of the assertions fails.
//
// @see src/features/life-os/HealthView.tsx (data-testid="health-view-root")
// @see src/features/dev/HealthViewDev.tsx
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

    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(today.getUTCDate()).padStart(2, '0');
    const todayIso = `${yyyy}-${mm}-${dd}`;

    // Matches HealthLog (src/lib/tauri/life_os.ts → src-tauri/src/health_tracker.rs).
    const mockHealthLog = {
      id: 'mock-log-1',
      date: todayIso,
      sleep_hours: 7.5,
      sleep_quality: 8,
      energy_level: 7,
      mood: 8,
      exercise_minutes: 45,
      exercise_type: 'running',
      water_glasses: 6,
      notes: 'mock',
      created_at: Math.floor(Date.now() / 1000),
    };

    // Matches HealthStats.
    const mockHealthStats = {
      avg_sleep: 7.2,
      avg_energy: 6.8,
      avg_mood: 7.1,
      exercise_days: 4,
      total_exercise_minutes: 180,
      sleep_debt: 0.6,
      best_day_pattern: 'tuesdays',
      period_days: 7,
    };

    // Matches HealthInsight.
    const mockHealthInsights = [
      {
        insight_type: 'sleep',
        title: 'Mock insight A',
        description: 'You slept well last week.',
        recommendation: 'Keep it up.',
        urgency: 'low',
      },
      {
        insight_type: 'exercise',
        title: 'Mock insight B',
        description: 'Activity consistent.',
        recommendation: 'Add a long session.',
        urgency: 'medium',
      },
    ];

    // health_streak_info returns a free-form serde_json::Value. HealthView
    // reads `current_streak | streak | days` — provide current_streak.
    const mockHealthStreakInfo = { current_streak: 5, longest: 12 };

    // StreakStats (total active days used by the chip).
    const mockStreakStats = {
      current_streak: 5,
      longest_streak: 12,
      total_active_days: 120,
      total_conversations: 42,
      total_messages: 310,
      tools_used_count: 18,
      facts_known: 57,
    };

    // ProjectHealth.
    const mockProjectHealth = {
      project: 'blade',
      issues: [],
      scanned_at: Math.floor(Date.now() / 1000) - 3600,
      files_scanned: 120,
      summary: 'mock project scan',
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
        case 'get_config':                    return { ...baseConfig };
        case 'get_onboarding_status':         return true;
        case 'health_get_today':              return mockHealthLog;
        case 'health_get_stats':              return mockHealthStats;
        case 'health_get_insights':           return mockHealthInsights;
        case 'health_streak_info':            return mockHealthStreakInfo;
        case 'streak_get_stats':              return mockStreakStats;
        case 'health_get_scan':               return mockProjectHealth;
        case 'health_scan_now':               return mockProjectHealth;
        case 'health_update_today':           return null;
        case 'health_correlate_productivity': return 'Mock correlation: no significant trend detected.';
        case 'emit_route_request':            return null;
        default:                              return null;
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

test.describe('Phase 6 SC-1 — HealthView snapshot + streak (LIFE-01)', () => {
  test('HealthView mounts with 5 stat cards + streak chip from streak_* commands', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-health-view isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-health-view' });
    await expect(page.locator('[data-testid="health-view-root"]')).toBeVisible({
      timeout: 5000,
    });

    // 5 stat cards render (SC-1 explicit falsifier: sleep/activity/mood/energy/sleep-quality).
    await expect(page.locator('[data-testid="health-stat"]')).toHaveCount(5, {
      timeout: 5000,
    });

    // Streak chip visible — data sourced from streak_get_stats + health_streak_info
    // (SC-1 "streak counters read from streak_* commands").
    await expect(page.locator('[data-testid="health-streak-chip"]')).toBeVisible({
      timeout: 3000,
    });
  });
});
