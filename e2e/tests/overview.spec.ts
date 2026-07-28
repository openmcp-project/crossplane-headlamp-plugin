import { test, expect } from '@playwright/test';
import { gotoCrossplaneOverview } from '../helpers';

test.describe('Crossplane Overview', () => {
  test('renders provider cards with health conditions', async ({ page }) => {
    await gotoCrossplaneOverview(page);

    // At least one provider card should be visible (provider-nop is installed in CI)
    await expect(page.locator('text=provider-nop')).toBeVisible({ timeout: 20_000 });

    // Condition chips should be present
    await expect(page.locator('text=Ready').first()).toBeVisible();
    await expect(page.locator('text=Healthy').first()).toBeVisible();
    await expect(page.locator('text=Installed').first()).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/overview.png', fullPage: true });
  });

  test('shows donut charts for managed resources', async ({ page }) => {
    await gotoCrossplaneOverview(page);

    // Managed Resources section heading
    await expect(page.locator('text=Managed Resources')).toBeVisible();

    // The SVG donut charts should be in the DOM
    const donuts = page.locator('svg circle');
    await expect(donuts.first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/overview-donuts.png', fullPage: true });
  });

  test('donut slice click navigates to resources with status filter', async ({ page }) => {
    await gotoCrossplaneOverview(page);

    // Wait for MR data to load (spinner gone)
    await page.waitForSelector('text=Loading resources…', { state: 'detached', timeout: 30_000 }).catch(() => {});

    // Click the "Not Ready" legend item if any not-ready resources exist
    const notReadyLink = page.locator('text=Not Ready').first();
    if (await notReadyLink.isVisible()) {
      await notReadyLink.click();
      await expect(page).toHaveURL(/status=not-ready/, { timeout: 5_000 });
      await page.screenshot({ path: 'e2e/screenshots/overview-filter-not-ready.png', fullPage: true });
    }
  });

  test('shows info alert when Crossplane is not installed', async ({ page }) => {
    // This test is only meaningful against a cluster without Crossplane.
    // Skip automatically when provider-nop is present.
    await gotoCrossplaneOverview(page);
    const alert = page.locator('text=Crossplane is not installed');
    const providerCard = page.locator('text=provider-nop');

    const hasProvider = await providerCard.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasProvider) {
      await expect(alert).toBeVisible();
    } else {
      test.skip(); // Crossplane is installed — skip this test
    }
  });
});
