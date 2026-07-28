import { test, expect } from '@playwright/test';
import { gotoCrossplaneResources } from '../helpers';

const CLUSTER = 'main';

test.describe('Resource List', () => {
  test('renders provider section with CRD rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    await expect(page.locator('text=Managed Resources')).toBeVisible();
    await expect(page.locator('text=provider-nop').first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/resources-initial.png', fullPage: true });
  });

  test('expanding a CRD row loads instances', async ({ page }) => {
    await gotoCrossplaneResources(page);

    const checkbox = page.getByRole('checkbox', { name: /hide unused/i });
    if (await checkbox.isChecked({ timeout: 5_000 }).catch(() => false)) {
      await checkbox.uncheck();
      await page.waitForTimeout(300);
    }

    const chevron = page.locator('text=▸').first();
    if (await chevron.isVisible({ timeout: 5_000 })) {
      await chevron.click();
      await expect(
        page.locator('text=Loading instances…')
          .or(page.locator('text=No instances found.'))
          .or(page.locator('table tbody tr').nth(1))
      ).toBeVisible({ timeout: 15_000 });

      await page.screenshot({ path: 'e2e/screenshots/resources-expanded.png', fullPage: true });
    }
  });

  test('status filter shows filtered view banner', async ({ page }) => {
    await gotoCrossplaneResources(page);
    await page.goto(`/c/${CLUSTER}/crossplane/resources?status=not-ready`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    await expect(page).toHaveURL(/status=not-ready/);
    await expect(page.locator('text=Filtered view')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-status-filter.png', fullPage: true });
  });

  test('clear filter resets URL and banner', async ({ page }) => {
    await gotoCrossplaneResources(page);
    await page.goto(`/c/${CLUSTER}/crossplane/resources?status=not-ready`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    await page.locator('text=Clear filter').click();

    await expect(page).toHaveURL(/\/crossplane\/resources$/);
    await expect(page.locator('text=Filtered view')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-filter-cleared.png', fullPage: true });
  });
});
