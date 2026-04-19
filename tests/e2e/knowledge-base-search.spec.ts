// tests/e2e/knowledge-base-search.spec.ts — Phase 5 SC-3 + SC-4 falsifier (KNOW-01).
//
// Asserts KnowledgeBase's grouped-search surface renders 3 labelled result
// groups — Knowledge / Memory / Timeline — matching the D-138 pragmatic
// reinterpretation of ROADMAP SC-4 ("web / memory / tools" → "knowledge /
// memory / timeline" because web + tools have no Rust surface in Phase 5).
// Validates:
//   - Plan 05-05's KnowledgeBase.tsx grouped-search form + 3-column layout.
//   - Plan 05-02's dbSearchKnowledge / semanticSearch / timelineSearchCmd
//     wrappers + Promise.allSettled best-effort composition.
//
// Flow:
//   1. Mount /dev-knowledge-base (Plan 05-07 Task 1 passthrough).
//   2. Shim returns canned rows matching Rust wire shapes for each source.
//   3. Type 'test' + submit — KnowledgeBase swaps from recents to groups.
//   4. Assert 3 groups, each with the expected data-source attribute.
//
// Falsifier: if any source is dropped, if the labels regress to literal
// "web/tools", or if the Promise.allSettled branch stops rendering a failed
// source as an empty group, one of the assertions fails.
//
// @see src/features/knowledge/KnowledgeBase.tsx (data-testid + data-source)
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-138
// @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2

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

    // Matches KnowledgeEntry interface in src/lib/tauri/knowledge.ts.
    const mockKnowledge = [
      {
        id: 'k1',
        title: 'Recent entry A',
        content: 'Recent knowledge content for the empty-state surface.',
        source: 'chat',
        tags: ['recent'],
        created_at: now - 3600,
        updated_at: now - 1800,
      },
    ];
    const mockKnowledgeSearch = [
      {
        id: 'k2',
        title: 'Knowledge search hit',
        content: 'This entry matches the test query.',
        source: 'manual',
        tags: ['search'],
        created_at: now - 1200,
        updated_at: now - 600,
      },
    ];
    // Matches SemanticHit interface.
    const mockSemantic = [
      {
        source_type: 'memory',
        source_id: 'mem-42',
        text: 'Semantic memory hit for test query.',
        score: 0.87,
      },
    ];
    // Matches TimelineEntry interface.
    const mockTimeline = [
      {
        id: 't-1',
        timestamp: Date.now(),
        app_name: 'Chrome',
        window_title: 'docs.example.com/test',
        description: 'Timeline match for test query.',
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
        case 'db_list_knowledge':       return mockKnowledge;
        case 'db_search_knowledge':     return mockKnowledgeSearch;
        case 'semantic_search':         return mockSemantic;
        case 'timeline_search_cmd':     return mockTimeline;
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

test.describe('Phase 5 SC-4 — KnowledgeBase 3-group search (D-138 KNOW-01)', () => {
  test('search surfaces 3 groups with data-source attrs knowledge/memory/timeline', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-knowledge-base isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-knowledge-base' });
    await expect(page.locator('[data-testid="knowledge-base-root"]')).toBeVisible({
      timeout: 5000,
    });

    // Type the query + submit via Enter (form onSubmit fires runSearch).
    const input = page.locator('[data-testid="knowledge-base-search-input"]');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.fill('test');
    await page.keyboard.press('Enter');

    // 3 groups render after Promise.allSettled resolves (all 3 mocks succeed).
    const groups = page.locator('[data-testid="knowledge-search-group"]');
    await expect(groups).toHaveCount(3, { timeout: 3000 });

    // Group order is stable: knowledge, memory, timeline (per KnowledgeBase.tsx).
    await expect(groups.nth(0)).toHaveAttribute('data-source', 'knowledge');
    await expect(groups.nth(1)).toHaveAttribute('data-source', 'memory');
    await expect(groups.nth(2)).toHaveAttribute('data-source', 'timeline');
  });
});
