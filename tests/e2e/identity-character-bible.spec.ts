// tests/e2e/identity-character-bible.spec.ts — Phase 6 SC-4 pragmatic falsifier (IDEN-03).
//
// Asserts CharacterBible renders consolidated bible content from the
// get_character_bible Rust command AND the D-155 honest deferral card
// (trait-log-deferred) is visible — the ROADMAP Phase 6 SC-4 pragmatic gate:
// the literal "trait evolution log" reader would require a new Rust reader
// command, which D-140 forbids in Phase 6; instead the deferral card cites
// the gap openly. Validates:
//   - Plan 06-05's CharacterBible.tsx consolidated text block.
//   - Plan 06-05's honest deferral card (D-155).
//   - Plan 06-02's getCharacterBible wrapper.
//
// Flow:
//   1. Mount /dev-character-bible (Plan 06-07 Task 1 passthrough).
//   2. Shim returns a canned CharacterBible (flat {identity, preferences,
//      projects, skills, contacts, notes, last_updated}).
//   3. Assert character-bible-root mounts + character-bible-content has
//      non-empty text + trait-log-deferred card is visible.
//
// Falsifier: if CharacterBible regresses to a 404, if the consolidated block
// empties, or if the deferral card disappears (faking a log view), one of
// the assertions fails.
//
// @see src/features/identity/CharacterBible.tsx (data-testid="character-bible-root")
// @see src/features/dev/CharacterBibleDev.tsx
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

    // Matches CharacterBible (src/lib/tauri/identity.ts).
    const mockCharacterBible = {
      identity: 'Mock user is a builder focused on autonomous tooling.',
      preferences: 'Prefers direct communication, Tailwind, Rust.',
      projects: 'BLADE desktop agent, Staq workspace.',
      skills: 'Rust, TypeScript, product design.',
      contacts: 'Key collaborators: mock-collaborator-a, mock-collaborator-b.',
      notes: 'Mock bible notes for the Playwright SC-4 pragmatic falsifier.',
      last_updated: new Date().toISOString(),
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
        case 'get_config':                              return { ...baseConfig };
        case 'get_onboarding_status':                   return true;
        case 'get_character_bible':                     return mockCharacterBible;
        case 'consolidate_character':                   return 'Mock consolidation complete';
        case 'consolidate_reactions_to_preferences':    return 0;
        case 'update_character_section':                return null;
        case 'emit_route_request':                      return null;
        default:                                        return null;
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

test.describe('Phase 6 SC-4 pragmatic — CharacterBible content + honest log deferral (IDEN-03)', () => {
  test('CharacterBible renders consolidated bible + trait-log-deferred card', async ({ page }) => {
    const handles = await installShim(page);
    await page.goto('/');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Mount the dev-character-bible isolation route.
    await handles.emitEvent('blade_route_request', { route_id: 'dev-character-bible' });
    await expect(page.locator('[data-testid="character-bible-root"]')).toBeVisible({
      timeout: 5000,
    });

    // Consolidated bible content has non-empty text (SC-3 / SC-4 surface proof).
    const bibleContent = page.locator('[data-testid="character-bible-content"]');
    await expect(bibleContent).toBeVisible({ timeout: 5000 });
    const text = await bibleContent.textContent();
    expect((text ?? '').trim().length).toBeGreaterThan(0);

    // D-155 honest deferral card visible (SC-4 pragmatic closure).
    await expect(page.locator('[data-testid="trait-log-deferred"]')).toBeVisible({
      timeout: 3000,
    });
  });
});
