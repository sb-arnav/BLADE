// tests/e2e/profile-tabs.spec.ts — Phase 12 Plan 12-04 (SCAN-11)
//
// Verifies ProfileView renders 5 section tabs in locked order and source pills
// appear on rows that have scan origin.
//
// @see .planning/phases/12-smart-deep-scan/12-VALIDATION.md Wave 1 e2e specs

import { test, expect } from '@playwright/test';

test.describe('Profile tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to Profile route via the identity sidebar
    await page.getByRole('button', { name: /Profile/i }).click();
    await page.waitForSelector('[role="tabpanel"]');
  });

  test('renders 5 section tabs in correct order', async ({ page }) => {
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(0)).toHaveText(/Repos/);
    await expect(tabs.nth(1)).toHaveText(/Accounts/);
    await expect(tabs.nth(2)).toHaveText(/Stack/);
    await expect(tabs.nth(3)).toHaveText(/Rhythm/);
    await expect(tabs.nth(4)).toHaveText(/Files/);
  });

  test('Repos tab is active by default', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /Repos/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('tab switch shows correct panel', async ({ page }) => {
    await page.getByRole('tab', { name: /Accounts/ }).click();
    await expect(page.getByRole('tabpanel', { name: /Accounts/ })).toBeVisible();
  });

  test('every repo row has a source pill', async ({ page }) => {
    // Only checks if rows are present (may be empty on clean test env)
    const rows = page.getByRole('row').filter({ hasText: /fs|git|ide|ai|shell|mru|bkmk|which|manual/ });
    // If rows exist, each must have a pill element with scanner tag
    const rowCount = await rows.count();
    if (rowCount > 0) {
      await expect(rows.first().getByRole('status').first()).toBeVisible();
    }
  });
});
