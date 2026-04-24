// tests/e2e/phase15/top-bar-hierarchy.spec.ts — Phase 15 Plan 15-02 (DENSITY-04)
//
// Verifies the 4-tier visual hierarchy encoded in TitleBar + ActivityStrip
// holds at 1280px viewport:
//   tier 1 — traffic lights + BLADE brand (primary)
//   tier 2 — status pill + activity summary (secondary)
//   tier 3 — ⌘K hint (tertiary, disposable ≤ 1100px)
//
// Spec shape modeled on tests/e2e/phase14/dashboard-live-data.spec.ts.
// Uses the __blade_open_route window hatch (D-54, plan 14-02/11-05 pattern).

import { test, expect } from '@playwright/test';

// Exact viewport required by success criterion 5 (no overstuff at 1280px).
test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Top bar — 4-tier visual hierarchy (DENSITY-04)', () => {
  test('tier-1 markers (traffic + title) present in DOM', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('.titlebar').first()).toBeVisible({ timeout: 5000 });
    const tier1Count = await page.locator('[data-hierarchy-tier="1"]').count();
    expect(tier1Count).toBeGreaterThanOrEqual(2);
  });

  test('tier-2 status pill is visible', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('.titlebar').first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('.titlebar-status[data-hierarchy-tier="2"]').first(),
    ).toBeVisible();
  });

  test('tier-3 ⌘K hint visible at 1280px (above 1100px breakpoint)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('.titlebar').first()).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('.titlebar-hint[data-hierarchy-tier="3"]').first(),
    ).toBeVisible();
  });

  test('activity strip sits directly below TitleBar (adjacency within 2px)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('.titlebar').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.activity-strip').first()).toBeVisible({ timeout: 5000 });

    const titlebarBox = await page.locator('.titlebar').first().boundingBox();
    const stripBox = await page.locator('.activity-strip').first().boundingBox();
    expect(titlebarBox).not.toBeNull();
    expect(stripBox).not.toBeNull();
    if (titlebarBox && stripBox) {
      const titlebarBottom = titlebarBox.y + titlebarBox.height;
      // Strip top should be at-or-very-near titlebar bottom (within 2px tolerance).
      expect(stripBox.y).toBeLessThanOrEqual(titlebarBottom + 2);
      expect(stripBox.y).toBeGreaterThanOrEqual(titlebarBottom - 2);
    }
  });

  test('no horizontal overflow at 1280px viewport', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('.titlebar').first()).toBeVisible({ timeout: 5000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflow).toBe(true);
  });

  test('brand font-weight ≥ 600; status pill font-weight ≤ 500 (tier separation)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__blade_open_route?.('dashboard'));
    await expect(page.locator('.titlebar').first()).toBeVisible({ timeout: 5000 });

    const brandWeight = await page
      .locator('.titlebar-brand')
      .first()
      .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
    const statusWeight = await page
      .locator('.titlebar-status')
      .first()
      .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));

    expect(brandWeight).toBeGreaterThanOrEqual(600);
    expect(statusWeight).toBeLessThanOrEqual(500);
  });
});
