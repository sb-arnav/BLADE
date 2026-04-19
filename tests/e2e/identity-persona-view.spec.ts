// tests/e2e/identity-persona-view.spec.ts — Phase 6 SC-3 + SC-4 approximation (IDEN-02).
//
// Asserts PersonaView renders the 4-tab persona dossier + the Traits tab
// renders at least one persona-trait-card sourced from persona_get_traits —
// the ROADMAP Phase 6 SC-3 surface proof + SC-4 round-trip approximation.
// Validates:
//   - Plan 06-05's PersonaView.tsx 4-tab D-154 layout.
//   - Plan 06-05's TraitCard render path.
//   - Plan 06-02's personaGetTraits / personaGetRelationship / getUserModel /
//     getExpertiseMap / personaEstimateMood / predictNextNeedCmd / peopleList
//     wrappers.
//
// Flow:
//   1. Mount /dev-persona-view (Plan 06-07 Task 1 passthrough).
//   2. Shim returns canned rows matching Rust wire shapes.
//   3. Assert persona-view-root mounts + 4 persona-tab entries (traits,
//      relationship, model, people) + default traits tab renders ≥1
//      persona-trait-card + switching to the "model" tab flips data-active.
//
// Falsifier: if a tab is dropped, if the default tab stops rendering trait
// cards, or if PersonaView regresses to a 404, one of the assertions fails.
//
// @see src/features/identity/PersonaView.tsx (data-testid="persona-view-root")
// @see src/features/dev/PersonaViewDev.tsx
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

    // Matches PersonaTrait (Rust: trait_name / score / confidence / evidence / updated_at).
    const mockTraits = [
      {
        trait_name: 'curiosity',
        score: 0.82,
        confidence: 0.9,
        evidence: ['Mock evidence A', 'Mock evidence B'],
        updated_at: now - 3600,
      },
      {
        trait_name: 'discipline',
        score: 0.71,
        confidence: 0.8,
        evidence: ['Mock evidence C'],
        updated_at: now - 7200,
      },
    ];

    // Matches RelationshipState.
    const mockRelationship = {
      intimacy_score: 0.4,
      trust_score: 0.72,
      shared_context: ['BLADE rebuild'],
      inside_jokes: [],
      growth_moments: ['Mock growth A'],
    };

    // Matches UserModel.
    const mockUserModel = {
      name: 'Mock User',
      role: 'builder',
      primary_languages: ['Rust', 'TypeScript'],
      work_hours: [9, 18],
      energy_pattern: 'morning-peak',
      communication_style: 'direct',
      pet_peeves: ['context-switching'],
      active_projects: ['BLADE'],
      goals: ['Ship Phase 6'],
      relationships: [['Arnav', 'self']],
      expertise: [['rust', 0.8]],
      mood_today: 'focused',
    };

    // Matches ExpertiseEntry tuples.
    const mockExpertiseMap: Array<[string, number]> = [
      ['rust', 0.8],
      ['typescript', 0.9],
      ['design', 0.6],
    ];

    // Matches Person (src/features/life-os/types).
    const mockPeople = [
      {
        id: 'person-1',
        name: 'Mock collaborator',
        relationship: 'colleague',
        communication_style: 'direct',
        platform: 'slack',
        topics: ['BLADE'],
        last_interaction: now - 7200,
        interaction_count: 12,
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
        case 'get_config':              return { ...baseConfig };
        case 'get_onboarding_status':   return true;
        case 'persona_get_traits':      return mockTraits;
        case 'persona_analyze_now':     return mockTraits;
        case 'persona_update_trait':    return null;
        case 'persona_get_relationship':return mockRelationship;
        case 'get_user_model':          return mockUserModel;
        case 'get_expertise_map':       return mockExpertiseMap;
        case 'persona_estimate_mood':   return 'focused';
        case 'predict_next_need_cmd':   return 'You might want to review the daily plan.';
        case 'people_list':             return mockPeople;
        case 'people_suggest_reply_style': return 'Be direct and concise.';
        case 'people_upsert':           return null;
        case 'emit_route_request':      return null;
        default:                        return null;
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

test.describe('Phase 6 SC-3 + SC-4 approximation — PersonaView 4-tab dossier (IDEN-02)', () => {
  test('PersonaView mounts with 4 tabs + default traits tab renders ≥1 trait card', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-persona-view isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-persona-view' });
    await expect(page.locator('[data-testid="persona-view-root"]')).toBeVisible({
      timeout: 5000,
    });

    // 4 tabs render (traits / relationship / model / people per D-154).
    const tabs = page.locator('[data-testid="persona-tab"]');
    await expect(tabs).toHaveCount(4, { timeout: 5000 });

    // Default tab is 'traits' — at least one trait card renders from mocks.
    const traitCards = page.locator('[data-testid="persona-trait-card"]');
    await expect.poll(async () => traitCards.count(), {
      timeout: 5000,
      intervals: [100, 250, 500, 1000],
    }).toBeGreaterThanOrEqual(1);

    // Click the 'model' tab — it flips to data-active="true".
    const modelTab = page.locator('[data-testid="persona-tab"][data-tab="model"]');
    await modelTab.click();
    await expect(modelTab).toHaveAttribute('data-active', 'true', { timeout: 3000 });
  });
});
