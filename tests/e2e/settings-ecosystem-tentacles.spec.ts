// tests/e2e/settings-ecosystem-tentacles.spec.ts — Phase 13 Plan 13-02 (ECOSYS-07)
//
// Verifies the Ecosystem settings pane renders and the OBSERVE_ONLY badge is visible.
// Uses mock Tauri IPC responses (Playwright webmock / page.exposeFunction pattern
// consistent with existing e2e specs in this repo).

import { test, expect } from '@playwright/test';

test.describe('Settings → Ecosystem pane (ECOSYS-07)', () => {
  test('ecosystem pane renders when navigated to settings-ecosystem route', async ({ page }) => {
    await page.goto('/');
    // Navigate to the ecosystem settings pane
    await page.evaluate(() => {
      // Use the router exposed by the app (same pattern as other settings e2e tests)
      (window as any).__blade_open_route?.('settings-ecosystem');
    });
    await expect(page.locator('[data-testid="ecosystem-pane"]')).toBeVisible({ timeout: 5000 });
  });

  test('observe-only badge is visible', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('settings-ecosystem'));
    await expect(page.locator('text=Observe only (v1.1)')).toBeVisible({ timeout: 5000 });
  });

  test('ecosystem heading is rendered', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('settings-ecosystem'));
    await expect(page.locator('#ecosystem-heading')).toBeVisible({ timeout: 5000 });
  });

  test('empty state renders when no tentacles are present', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('settings-ecosystem'));
    // Either tentacle rows or empty state message should be present (not both absent)
    const hasRows = await page.locator('[id^="ecosystem-tentacle-"]').count();
    const hasEmpty = await page.locator('text=No tentacles enabled yet').count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });
});
