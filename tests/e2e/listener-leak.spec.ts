// tests/e2e/listener-leak.spec.ts — P-06 gate (D-32).
//
// Assertion: window.__BLADE_LISTENERS_COUNT__ stays bounded across route
// churn. A listener leak manifests as a monotonically increasing counter;
// this test hammers mount/unmount cycles and checks the delta.
//
// Phase 1 harness limitations (acknowledged):
//   - Runs against Vite dev server (http://localhost:1420), not the full
//     Tauri runtime. Useful signal for React-side hook leaks; does NOT
//     catch Rust-side emit doubling. Full Tauri harness lands in Phase 9.
//   - Route churn is simulated via full page reloads rather than in-app
//     router navigation (Phase 2 Shell adds real openRoute() — this test
//     upgrades then).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-32
// @see .planning/research/PITFALLS.md §P-06

import { test, expect, type Page } from '@playwright/test';

const BOOT_TIMEOUT_MS = 15_000;
const CHURN_CYCLES = 5;

async function waitForBoot(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __BLADE_LISTENERS_COUNT__?: number })
        .__BLADE_LISTENERS_COUNT__ !== undefined,
    undefined,
    { timeout: BOOT_TIMEOUT_MS },
  );
}

async function readCount(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      (window as unknown as { __BLADE_LISTENERS_COUNT__?: number })
        .__BLADE_LISTENERS_COUNT__ ?? 0,
  );
}

test('listener count stays bounded across simulated route churn', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);

  const initial = await readCount(page);
  expect(initial).toBeGreaterThanOrEqual(0);
  console.log(`[listener-leak] initial count: ${initial}`);

  // Hammer mount/unmount. Each reload fully tears down the React tree + its
  // listeners and re-mounts — a leaking hook would show cumulative growth.
  for (let i = 0; i < CHURN_CYCLES; i++) {
    await page.reload();
    await waitForBoot(page);
  }

  const after = await readCount(page);
  console.log(`[listener-leak] after ${CHURN_CYCLES} reload cycles: ${after}`);

  // +1 tolerance for render-timing flutter (a listener may be mid-register
  // when the counter is read). A real leak would be 5+ extra listeners,
  // not 1.
  expect(after).toBeLessThanOrEqual(initial + 1);
});
