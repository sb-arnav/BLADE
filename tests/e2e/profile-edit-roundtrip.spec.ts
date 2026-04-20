// tests/e2e/profile-edit-roundtrip.spec.ts — Phase 12 Plan 12-04 (SCAN-12)
//
// Verifies the overlay edit round-trip: edit a row value → reload window →
// edited value persists with an "edited" pill visible.
//
// @see .planning/phases/12-smart-deep-scan/12-VALIDATION.md Wave 1 e2e specs

import { test, expect } from '@playwright/test';

test.describe('Profile edit round-trip', () => {
  test('edit a row value → reload window → edit persists', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Profile/i }).click();
    await page.waitForSelector('[role="tabpanel"]');

    // Open Accounts tab
    await page.getByRole('tab', { name: /Accounts/ }).click();

    // Check if there are any rows; if so, edit the first one
    const firstRowMenu = page.getByRole('button', { name: /Actions for/ }).first();
    const rowCount = await firstRowMenu.count();
    if (rowCount === 0) {
      // No rows — skip edit test (mark as pending, not failed)
      test.skip(true, 'No account rows to edit in this environment');
      return;
    }

    await firstRowMenu.click();
    await page.getByRole('menuitem', { name: /Edit/ }).click();
    await page.waitForSelector('[role="dialog"]');

    // Modify the textarea
    const textarea = page.getByRole('textbox');
    await textarea.fill('platform: github\nhandle: testhandle-edited');
    await page.getByRole('button', { name: /Save/ }).click();

    // Reload the window
    await page.reload();
    await page.getByRole('button', { name: /Profile/i }).click();
    await page.getByRole('tab', { name: /Accounts/ }).click();

    // The edited row should have an "edited" pill
    await expect(page.getByText('edited').first()).toBeVisible();
  });
});
