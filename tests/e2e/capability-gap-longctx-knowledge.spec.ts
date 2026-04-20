// tests/e2e/capability-gap-longctx-knowledge.spec.ts
// Phase 11 Plan 11-05 (PROV-08).
//
// Asserts KnowledgeBase renders <CapabilityGap capability="long_context">
// as an inline banner (above the search bar) when no long-context-capable
// model is configured. Uses __BLADE_TEST_OPEN_ROUTE to navigate to the
// 'knowledge-full-repo' alias route (Plan 11-05 Task 2 registered it).

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — long_context on KnowledgeBase', () => {
  test('renders CapabilityGap banner when no long-context model is configured', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'groq:llama-3.3-70b-versatile': {
          ...incapableRecord('groq', 'llama-3.3-70b-versatile'),
          tool_calling: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('knowledge-full-repo');
    });

    const gap = page.locator('[data-testid="capability-gap-long_context"]');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('Needs a long-context model');
    await expect(gap).toContainText('Full-repo indexing');

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
          vision: true,
          tool_calling: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('knowledge-full-repo');
    });

    const gap = page.locator('[data-testid="capability-gap-long_context"]');
    await expect(gap).toHaveCount(0);
  });
});
