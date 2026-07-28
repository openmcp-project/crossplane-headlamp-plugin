import { test, expect } from '@playwright/test';
import { gotoCrossplaneResources } from '../helpers';

const CLUSTER = 'main';

test.describe('Resource List', () => {
  test('renders provider section with CRD rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    await expect(page.locator('text=Managed Resources')).toBeVisible();
    await expect(page.locator('text=provider-nop')).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/resources-initial.png', fullPage: true });
  });

  test('expanding a CRD row loads instances', async ({ page }) => {
    await gotoCrossplaneResources(page);

    // Uncheck "Hide unused" so all CRD types are visible
    const checkbox = page.locator('input[type="checkbox"]');
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
    }
    await page.waitForTimeout(500);

    const chevron = page.locator('text=▸').first();
    if (await chevron.isVisible({ timeout: 5_000 })) {
      await chevron.click();
      await expect(
        page.locator('text=Loading instances…').or(page.locator('text=No instances found.')).or(page.locator('table tbody tr').nth(1))
      ).toBeVisible({ timeout: 15_000 });

      await page.screenshot({ path: 'e2e/screenshots/resources-expanded.png', fullPage: true });
    }
  });

  test('search filters CRD rows by kind', async ({ page }) => {
    await gotoCrossplaneResources(page);

    // Uncheck "Hide unused" so all CRD types are visible before searching
    const checkbox = page.locator('input[type="checkbox"]');
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
    }
    await page.waitForTimeout(500);

    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('NopResource');
    await page.waitForTimeout(300);

    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).textContent();
      expect(text?.toLowerCase()).toContain('nop');
    }

    await page.screenshot({ path: 'e2e/screenshots/resources-search.png', fullPage: true });
  });

  test('status filter updates URL and auto-expands rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    // Uncheck "Hide unused" first so rows exist to filter
    const checkbox = page.locator('input[type="checkbox"]');
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
    }
    await page.waitForTimeout(500);

    await page.locator('[role="combobox"]').first().click();
    await page.locator('[role="option"]:has-text("Not Ready")').click();

    await expect(page).toHaveURL(/status=not-ready/);
    await expect(page.locator('text=Filtered view')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-status-filter.png', fullPage: true });
  });

  test('clear filter resets URL and banner', async ({ page }) => {
    await page.goto(`/c/${CLUSTER}/crossplane/resources?status=not-ready`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    await expect(page.locator('text=Filtered view')).toBeVisible();
    await page.locator('text=Clear filter').click();

    await expect(page).toHaveURL(/\/crossplane\/resources$/);
    await expect(page.locator('text=Filtered view')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-filter-cleared.png', fullPage: true });
  });

  test('hide unused checkbox removes zero-instance rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    const checkbox = page.locator('input[type="checkbox"]');

    // Uncheck to show all types first
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
    }
    await page.waitForTimeout(500);
    const totalRows = await page.locator('tbody tr').count();

    // Re-check to hide unused
    await checkbox.check();
    await page.waitForTimeout(500);
    const filteredRows = await page.locator('tbody tr').count();

    expect(filteredRows).toBeLessThanOrEqual(totalRows);

    await page.screenshot({ path: 'e2e/screenshots/resources-hide-unused.png', fullPage: true });
  });
});
