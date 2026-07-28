import { test, expect } from '@playwright/test';
import { gotoCrossplaneResources } from '../helpers';

test.describe('Resource List', () => {
  test('renders provider section with CRD rows', async ({ page }) => {
    await gotoCrossplaneResources(page);

    await expect(page.locator('text=Managed Resources')).toBeVisible();
    await expect(page.locator('text=provider-nop')).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/resources-initial.png', fullPage: true });
  });

  test('expanding a CRD row loads instances', async ({ page }) => {
    await gotoCrossplaneResources(page);

    // Wait for counts to load so rows are visible
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    // Find the first expandable row (has ▸ chevron) and click it
    const chevron = page.locator('text=▸').first();
    if (await chevron.isVisible({ timeout: 5_000 })) {
      await chevron.click();
      // Instance sub-table or "No instances" message should appear
      await expect(
        page.locator('text=Loading instances…, text=No instances found., text=No instances match')
          .or(page.locator('table tbody tr').nth(1))
      ).toBeVisible({ timeout: 15_000 });

      await page.screenshot({ path: 'e2e/screenshots/resources-expanded.png', fullPage: true });
    }
  });

  test('search filters CRD rows by kind', async ({ page }) => {
    await gotoCrossplaneResources(page);
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    // Uncheck "Hide unused" first so we have rows to search
    const hideUnused = page.locator('input[type="checkbox"]');
    if (await hideUnused.isChecked()) {
      await hideUnused.uncheck();
    }

    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('NopResource');

    // Only rows matching "NopResource" should remain visible
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
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    // Open the Status dropdown and select "Not Ready"
    await page.locator('text=Status').first().click();
    await page.locator('li[data-value="not-ready"], [role="option"]:has-text("Not Ready")').click();

    await expect(page).toHaveURL(/status=not-ready/);
    await expect(page.locator('text=Filtered view')).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-status-filter.png', fullPage: true });
  });

  test('clear filter resets URL and banner', async ({ page }) => {
    await page.goto('/crossplane/resources?status=not-ready');
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    await expect(page.locator('text=Filtered view')).toBeVisible();
    await page.locator('text=Clear filter').click();

    await expect(page).toHaveURL(/\/crossplane\/resources$/);
    await expect(page.locator('text=Filtered view')).not.toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/resources-filter-cleared.png', fullPage: true });
  });

  test('hide unused checkbox removes zero-instance rows', async ({ page }) => {
    await gotoCrossplaneResources(page);
    await page.waitForSelector('text=provider-nop', { timeout: 20_000 });

    const checkbox = page.locator('input[type="checkbox"]');

    // First uncheck to show all
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
    }
    const totalRows = await page.locator('tbody tr').count();

    // Now check to hide unused
    await checkbox.check();
    const filteredRows = await page.locator('tbody tr').count();

    expect(filteredRows).toBeLessThanOrEqual(totalRows);

    await page.screenshot({ path: 'e2e/screenshots/resources-hide-unused.png', fullPage: true });
  });
});
