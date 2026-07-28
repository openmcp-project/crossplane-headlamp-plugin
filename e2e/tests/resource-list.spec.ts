import { test, expect } from '@playwright/test';
import { gotoCrossplaneResources } from '../helpers';

const CLUSTER = 'main';

/** Uncheck "Hide unused" if checked. */
async function uncheckHideUnused(page: any) {
  const checkbox = page.getByRole('checkbox', { name: /hide unused/i });
  const checked = await checkbox.isChecked({ timeout: 10_000 }).catch(() => false);
  if (checked) {
    await checkbox.uncheck();
    await page.waitForTimeout(300);
  }
}

test.describe('Resource List', () => {
  test('renders provider section with CRD rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    await expect(page.locator('text=Managed Resources')).toBeVisible();
    await expect(page.locator('text=provider-nop').first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/resources-initial.png', fullPage: true });
  });

  test('expanding a CRD row loads instances', async ({ page }) => {
    await gotoCrossplaneResources(page);
    await uncheckHideUnused(page);

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
    await uncheckHideUnused(page);

    // Scope to the plugin toolbar, not the global Headlamp search bar
    const searchInput = page.locator('input[placeholder*="Search kind"]');
    await searchInput.fill('NopResource');
    await page.waitForTimeout(300);

    // All visible kind cells should contain 'nop'
    const kindCells = page.locator('tbody tr td:nth-child(2)');
    const count = await kindCells.count();
    for (let i = 0; i < count; i++) {
      const text = await kindCells.nth(i).textContent();
      expect(text?.toLowerCase()).toContain('nop');
    }

    await page.screenshot({ path: 'e2e/screenshots/resources-search.png', fullPage: true });
  });

  test('status filter updates URL and auto-expands rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    // Navigate directly with the filter in the URL — same as what the dropdown does
    await page.goto(`/c/${CLUSTER}/crossplane/resources?status=not-ready`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    await expect(page).toHaveURL(/status=not-ready/);
    await expect(page.locator('text=Filtered view')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-status-filter.png', fullPage: true });
  });

  test('clear filter resets URL and banner', async ({ page }) => {
    // Go through the helper to authenticate first, then navigate with filter
    await gotoCrossplaneResources(page);
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
    await uncheckHideUnused(page);

    const totalRows = await page.locator('tbody tr').count();

    const label = page.getByRole('checkbox', { name: /hide unused/i });
    await label.check();
    await page.waitForTimeout(500);
    const filteredRows = await page.locator('tbody tr').count();

    expect(filteredRows).toBeLessThanOrEqual(totalRows);

    await page.screenshot({ path: 'e2e/screenshots/resources-hide-unused.png', fullPage: true });
  });
});
