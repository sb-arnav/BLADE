// tests/e2e/capability-gap-tools-web-automation.spec.ts
// Phase 11 Plan 11-05 (PROV-08).
//
// Asserts WebAutomation renders <CapabilityGap capability="tools"> when no
// tool-calling model is configured. Uses __BLADE_TEST_OPEN_ROUTE to
// navigate to 'web-automation'.

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — tools on WebAutomation', () => {
  test('renders CapabilityGap when no tool-calling model is configured', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'elevenlabs:tts-v1': {
          ...incapableRecord('elevenlabs', 'tts-v1'),
          audio: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('web-automation');
    });

    const gap = page.locator('[data-testid="capability-gap-tools"]');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('Needs a tool-calling model');
    await expect(gap).toContainText('Web automation');

    const cta = gap.getByRole('button', { name: 'Add a provider' });
    await cta.click();

    await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();
    const textarea = page.locator('textarea[aria-label="Provider config paste input"]');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  test('does NOT render CapabilityGap when tools capability is present', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'openai:gpt-4': {
          ...incapableRecord('openai', 'gpt-4'),
          tool_calling: true,
          vision: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('web-automation');
    });

    const gap = page.locator('[data-testid="capability-gap-tools"]');
    await expect(gap).toHaveCount(0);
  });
});
