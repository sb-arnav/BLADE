// tests/e2e/capability-gap-vision-screen-timeline.spec.ts
// Phase 11 Plan 11-05 (PROV-07).
//
// Asserts ScreenTimeline renders <CapabilityGap capability="vision"> when
// config.provider_capabilities contains no vision-capable record. Clicks
// the "Add a provider" CTA → routeHint deep-link lands on settings-providers
// with the paste textarea focused.
//
// Navigation uses window.__BLADE_TEST_OPEN_ROUTE (Plan 11-05 Task 1 hatch,
// activated by the ?e2e=1 query param).

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — vision on ScreenTimeline', () => {
  test('renders CapabilityGap when no vision-capable model is configured', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        // Groq only — vision=false, tool_calling=true, long_context=false, audio=false
        'groq:llama-3.3-70b-versatile': {
          ...incapableRecord('groq', 'llama-3.3-70b-versatile'),
          tool_calling: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    // Navigate via the committed test hatch.
    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('screen-timeline');
    });

    const gap = page.locator('[data-testid="capability-gap-vision"]');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('Needs a vision-capable model');
    await expect(gap).toContainText(/This view analyzes what's on screen/);

    // CTA exists and carries the locked label.
    const cta = gap.getByRole('button', { name: 'Add a provider' });
    await expect(cta).toBeVisible();

    // Click → routeHint deep-link arrives at Settings → Providers.
    await cta.click();

    await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();

    // Paste textarea is focused via routeHint effect (div-wrap ref + 2×rAF).
    const textarea = page.locator('textarea[aria-label="Provider config paste input"]');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  test('does NOT render CapabilityGap when vision capability is present', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'anthropic:claude-sonnet-4': {
          ...incapableRecord('anthropic', 'claude-sonnet-4-20250514'),
          vision: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('screen-timeline');
    });

    const gap = page.locator('[data-testid="capability-gap-vision"]');
    await expect(gap).toHaveCount(0);
  });
});
