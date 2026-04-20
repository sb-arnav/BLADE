// tests/e2e/profile-live-tail.spec.ts — Phase 12 Plan 12-04 (SCAN-10)
//
// Verifies ScanActivityTail panel ARIA structure: collapsed by default,
// Cancel button hidden when no scan running, log body has correct role
// when expanded.
//
// @see .planning/phases/12-smart-deep-scan/12-VALIDATION.md Wave 1 e2e specs

import { test, expect } from '@playwright/test';

test.describe('Profile live-tail panel', () => {
  test('tail collapses when no scan is running', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Profile/i }).click();
    await page.waitForSelector('[aria-controls="scan-log-body"]');
    // Default collapsed state
    const header = page.locator('[aria-controls="scan-log-body"]');
    await expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  test('Cancel button is not visible when no scan running', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Profile/i }).click();
    const cancelBtn = page.getByRole('button', { name: /Cancel scan/ });
    await expect(cancelBtn).not.toBeVisible();
  });

  test('log body has correct ARIA role when expanded', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Profile/i }).click();
    // Manually expand
    await page.locator('[aria-controls="scan-log-body"]').click();
    const logBody = page.locator('#scan-log-body');
    await expect(logBody).toHaveAttribute('role', 'log');
    await expect(logBody).toHaveAttribute('aria-live', 'polite');
  });
});
