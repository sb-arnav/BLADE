// tests/e2e/capability-gap-longctx-chat.spec.ts
// Phase 11 Plan 11-05 (PROV-08, Option B).
//
// Asserts ChatView renders <CapabilityGap capability="long_context"> as a
// banner above the ChatPanel when (a) no long-context-capable model is
// configured AND (b) the conversation ratio exceeds 0.65. Synthesizes a
// large message payload via localStorage + BLADE_TOKEN_RATIO event
// simulation... simpler: we rely on the estimator path which reads
// `messages.length * avg_chars`. Without a conversation, the banner is
// absent — so we use tokenRatio priority path via direct invoke mock.
//
// For simplicity this spec asserts the ABSENCE of the banner when the
// capability IS present, and the presence when absent + long message.
// (Long-ctx is a conditional banner, not a full-surface replacement.)
//
// Navigation uses __BLADE_TEST_OPEN_ROUTE.

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — long_context on ChatView', () => {
  test('renders CapabilityGap banner when no long-context model + ratio exceeds threshold', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        // Tiny context window + no long_context flag — tokenRatio estimate
        // will exceed threshold quickly.
        'groq:llama-3.3-70b-versatile': {
          ...incapableRecord('groq', 'llama-3.3-70b-versatile'),
          context_window: 100,
          tool_calling: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Navigate to chat first.
    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('chat');
    });

    // Inject a synthesized long user turn into chat state by typing + sending.
    // The InputBar submits via sendMessageStream which we've mocked to no-op;
    // messagesRef will capture the user turn and the estimator will spike.
    const input = page.locator('textarea').first();
    await input.waitFor({ timeout: 3000 });
    // 600 chars / 4 / 100 = 1.5 ratio → banner shows.
    const longText = 'x'.repeat(600);
    await input.fill(longText);
    await input.press('Control+Enter').catch(async () => {
      // Fallback: submit via the button.
      await page.getByRole('button', { name: /send/i }).first().click();
    });

    const gap = page.locator('[data-testid="capability-gap-long_context"]');
    await expect(gap).toBeVisible({ timeout: 5000 });
    await expect(gap).toContainText('Needs a long-context model');
    await expect(gap).toContainText('Chat with long input');

    const cta = gap.getByRole('button', { name: 'Add a provider' });
    await cta.click();

    await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();
    const textarea = page.locator('textarea[aria-label="Provider config paste input"]');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  test('does NOT render CapabilityGap when long-context capability is present', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'anthropic:claude-sonnet-4': {
          ...incapableRecord('anthropic', 'claude-sonnet-4-20250514'),
          context_window: 200_000,
          long_context: true,
          tool_calling: true,
          vision: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('chat');
    });

    const gap = page.locator('[data-testid="capability-gap-long_context"]');
    await expect(gap).toHaveCount(0);
  });
});
