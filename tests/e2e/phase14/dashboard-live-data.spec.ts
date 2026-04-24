// tests/e2e/phase14/dashboard-live-data.spec.ts — Phase 14 Plan 14-03 (WIRE2-02, WIRE2-03)
//
// Verifies that the dashboard renders live data cards and no longer shows
// ComingSoonCard placeholder text from the original Phase 3 implementation.
// Uses the __blade_open_route window hatch (D-54, plan 14-02/11-05 pattern).

import { test, expect } from '@playwright/test';

test.describe('Dashboard — live data cards (WIRE2-02, WIRE2-03)', () => {
  test('dashboard renders without ComingSoonCard placeholder text', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    // Wait for the dashboard surface to appear
    await expect(page.locator('[data-dashboard-surface]')).toBeVisible({ timeout: 5000 });
    // None of the original ComingSoonCard placeholder descriptions should be present
    await expect(page.locator('text=Tentacle reports + autonomy queue')).toHaveCount(0);
    await expect(page.locator('text=Connected services + status')).toHaveCount(0);
    await expect(page.locator('text=Today\'s events + reminders')).toHaveCount(0);
  });

  test('dashboard hive signals card is visible with heading', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('[data-dashboard-surface]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Hive Signals')).toBeVisible({ timeout: 5000 });
  });

  test('dashboard integrations card is visible with heading', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('[data-dashboard-surface]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Integrations')).toBeVisible({ timeout: 5000 });
  });
});
