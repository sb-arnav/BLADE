// tests/e2e/capability-gap-vision-quickask.spec.ts
// Phase 11 Plan 11-05 (PROV-07).
//
// Asserts QuickAskView renders <CapabilityGap capability="vision"> when
// no vision-capable model is configured. Uses __BLADE_TEST_OPEN_ROUTE to
// navigate to 'quickask' (Plan 11-05 Task 2 registered the route).

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — vision on QuickAskView', () => {
  test('renders CapabilityGap when no vision-capable model is configured', async ({ page }) => {
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
        .__BLADE_TEST_OPEN_ROUTE?.('quickask');
    });

    const gap = page.locator('[data-testid="capability-gap-vision"]');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('Needs a vision-capable model');
    await expect(gap).toContainText('QuickAsk image input');

    const cta = gap.getByRole('button', { name: 'Add a provider' });
    await expect(cta).toBeVisible();
    await cta.click();

    await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();
    const textarea = page.locator('textarea[aria-label="Provider config paste input"]');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  test('does NOT render CapabilityGap when vision capability is present', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'openai:gpt-4o': {
          ...incapableRecord('openai', 'gpt-4o'),
          vision: true,
          tool_calling: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('quickask');
    });

    const gap = page.locator('[data-testid="capability-gap-vision"]');
    await expect(gap).toHaveCount(0);
  });
});
