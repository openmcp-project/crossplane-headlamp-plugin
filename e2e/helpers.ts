import type { Page } from '@playwright/test';

const HEADLAMP_TOKEN = process.env.HEADLAMP_TOKEN ?? '';
const CLUSTER = 'main';

/** Authenticate against Headlamp by filling in the token form if it appears. */
async function authenticate(page: Page) {
  const authHeader = page.locator('h1:has-text("Authentication")');
  const hasAuthPage = await authHeader
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (!hasAuthPage) return;

  await page.locator('#token').fill(HEADLAMP_TOKEN);
  await Promise.all([
    page.waitForNavigation({ timeout: 15_000 }).catch(() => {}),
    page.click('button:has-text("Authenticate")'),
  ]);
}

/** Navigate to the Crossplane overview page, authenticating if needed. */
export async function gotoCrossplaneOverview(page: Page) {
  await page.goto(`/c/${CLUSTER}/crossplane/overview`, { waitUntil: 'domcontentloaded' });
  await authenticate(page);
  await page.waitForSelector('text=PROVIDERS', { timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: 'e2e/screenshots/debug-overview-loaded.png', fullPage: true }).catch(() => {});
}

/** Navigate to the Crossplane resources page, authenticating if needed. */
export async function gotoCrossplaneResources(page: Page) {
  await page.goto(`/c/${CLUSTER}/crossplane/resources`, { waitUntil: 'domcontentloaded' });
  await authenticate(page);
  await page.waitForSelector('text=provider-nop', { timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: 'e2e/screenshots/debug-resources-loaded.png', fullPage: true }).catch(() => {});
}
