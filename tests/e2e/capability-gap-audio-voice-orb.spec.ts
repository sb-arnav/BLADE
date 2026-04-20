// tests/e2e/capability-gap-audio-voice-orb.spec.ts
// Phase 11 Plan 11-05 (PROV-08).
//
// Asserts VoiceOrbView renders <CapabilityGap capability="audio"> when
// no audio-capable model is configured. Uses __BLADE_TEST_OPEN_ROUTE to
// navigate to 'voice-orb'.

import { test, expect } from '@playwright/test';
import { installCapabilityGapShim, incapableRecord } from './_capability-gap-shim';

const BOOT_TIMEOUT_MS = 15_000;

test.describe('CapabilityGap — audio on VoiceOrbView', () => {
  test('renders CapabilityGap when no audio-capable model is configured', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'anthropic:claude-sonnet-4': {
          ...incapableRecord('anthropic', 'claude-sonnet-4-20250514'),
          vision: true,
          tool_calling: true,
          // audio: false (default from incapableRecord)
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('voice-orb');
    });

    const gap = page.locator('[data-testid="capability-gap-audio"]');
    await expect(gap).toBeVisible();
    await expect(gap).toContainText('Needs an audio-capable model');
    await expect(gap).toContainText('Voice Orb TTS');

    const cta = gap.getByRole('button', { name: 'Add a provider' });
    await expect(cta).toBeVisible();
    await cta.click();

    await expect(page.locator('.settings-pane h2', { hasText: /^Providers$/ })).toBeVisible();
    const textarea = page.locator('textarea[aria-label="Provider config paste input"]');
    await expect(textarea).toBeFocused({ timeout: 3000 });
  });

  test('does NOT render CapabilityGap when audio capability is present', async ({ page }) => {
    await installCapabilityGapShim(page, {
      providerCapabilities: {
        'openai:gpt-4o-audio': {
          ...incapableRecord('openai', 'gpt-4o-audio'),
          audio: true,
          tool_calling: true,
        },
      },
    });

    await page.goto('/?e2e=1');
    await page.waitForSelector('[data-gate-status="complete"]', { timeout: BOOT_TIMEOUT_MS });

    await page.evaluate(() => {
      (window as unknown as { __BLADE_TEST_OPEN_ROUTE?: (id: string) => void })
        .__BLADE_TEST_OPEN_ROUTE?.('voice-orb');
    });

    const gap = page.locator('[data-testid="capability-gap-audio"]');
    await expect(gap).toHaveCount(0);
  });
});
