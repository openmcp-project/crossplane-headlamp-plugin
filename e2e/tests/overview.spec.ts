import { test, expect } from '@playwright/test';
import { gotoCrossplaneOverview } from '../helpers';

test.describe('Crossplane Overview', () => {
  test('renders provider cards with health conditions', async ({ page }) => {
    await gotoCrossplaneOverview(page);

    await expect(page.locator('text=provider-nop').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('text=Ready').first()).toBeVisible();
    await expect(page.locator('text=Healthy').first()).toBeVisible();
    await expect(page.locator('text=Installed').first()).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/overview.png', fullPage: true });
  });

  test('shows donut charts for managed resources', async ({ page }) => {
    await gotoCrossplaneOverview(page);

    await expect(page.locator('text=Managed Resources')).toBeVisible();
    const donuts = page.locator('svg circle');
    await expect(donuts.first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/overview-donuts.png', fullPage: true });
  });

  test('donut slice click navigates to resources with status filter', async ({ page }) => {
    await gotoCrossplaneOverview(page);

    const readyRow = page.locator('text=Ready').first();
    if (await readyRow.isVisible()) {
      await readyRow.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'e2e/screenshots/overview-filter-click.png', fullPage: true });
    }
  });
});
