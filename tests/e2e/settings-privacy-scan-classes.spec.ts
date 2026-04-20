// tests/e2e/settings-privacy-scan-classes.spec.ts — Phase 12 Plan 12-04 (SCAN-13 / D-65)
//
// Verifies Settings → Privacy Deep Scan section has 8 toggles all checked by
// default, that unchecking one persists after reload, and Re-scan button exists.
//
// @see .planning/phases/12-smart-deep-scan/12-VALIDATION.md Wave 1 e2e specs

import { test, expect } from '@playwright/test';

test.describe('Settings → Privacy Deep Scan section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to Settings → Privacy
    await page.getByRole('button', { name: /Settings/i }).click();
    await page.getByRole('button', { name: /Privacy/i }).click();
    await page.waitForSelector('#scan-classes-heading');
  });

  test('shows 8 source class toggles', async ({ page }) => {
    const checkboxes = page.locator('input[id^="scan-class-"]');
    await expect(checkboxes).toHaveCount(8);
  });

  test('all 8 toggles are checked by default', async ({ page }) => {
    const checkboxes = page.locator('input[id^="scan-class-"]');
    for (let i = 0; i < 8; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });

  test('unchecking a toggle persists after reload', async ({ page }) => {
    const firstToggle = page.locator('#scan-class-fs_repos');
    await firstToggle.uncheck();
    await page.reload();
    await page.getByRole('button', { name: /Settings/i }).click();
    await page.getByRole('button', { name: /Privacy/i }).click();
    await page.waitForSelector('#scan-class-fs_repos');
    await expect(page.locator('#scan-class-fs_repos')).not.toBeChecked();
    // Restore default
    await firstToggle.check();
  });

  test('"Re-scan now" button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Re-scan now/i })).toBeVisible();
  });
});
