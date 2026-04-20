// tests/e2e/capability-gap-tools-swarm.spec.ts
// Phase 11 Plan 11-05 (PROV-08).
//
// Asserts SwarmView renders <CapabilityGap capability="tools"> when no
// tool-calling model is configured. Uses __BLADE_TEST_OPEN_ROUTE to
// navigate to the 'agents-swarm' alias route (Plan 11-05 Task 2).

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — tools on SwarmView', () => {
  test('renders CapabilityGap when no tool-calling model is configured', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        // An audio-only placeholder: no tool_calling.
        'elevenlabs:tts-v1': {
          ...incapableRecord('elevenlabs', 'tts-v1'),
          audio: true,
          // tool_calling: false
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('agents-swarm');
    });

    const gap = page.locator('[data-testid="capability-gap-tools"]');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('Needs a tool-calling model');
    await expect(gap).toContainText('Multi-agent swarm');

    const cta = gap.getByRole('button', { name: 'Add a provider' });
    await cta.click();

    await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();
    const textarea = page.locator('textarea[aria-label="Provider config paste input"]');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  test('does NOT render CapabilityGap when tools capability is present', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'anthropic:claude-sonnet-4': {
          ...incapableRecord('anthropic', 'claude-sonnet-4-20250514'),
          tool_calling: true,
          vision: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('agents-swarm');
    });

    const gap = page.locator('[data-testid="capability-gap-tools"]');
    await expect(gap).toHaveCount(0);
  });
});
