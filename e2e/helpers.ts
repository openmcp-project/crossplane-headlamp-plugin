import type { Page } from '@playwright/test';

const HEADLAMP_TOKEN = process.env.HEADLAMP_TOKEN ?? '';
const CLUSTER = 'main';

async function authenticate(page: Page) {
  const authHeader = page.locator('h1:has-text("Authentication")');
  const hasAuthPage = await authHeader
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!hasAuthPage) return;

  await page.locator('#token').fill(HEADLAMP_TOKEN);
  await Promise.all([
    page.waitForNavigation({ timeout: 20_000 }).catch(() => {}),
    page.click('button:has-text("Authenticate")'),
  ]);
}

export async function gotoCrossplaneOverview(page: Page) {
  await page.goto(`/c/${CLUSTER}/crossplane/overview`, { waitUntil: 'domcontentloaded' });
  await authenticate(page);
  // Wait for provider card to fully render — deepest content confirming full load
  await page.waitForSelector('text=provider-nop', { timeout: 40_000 }).catch(() => {});
}

export async function gotoCrossplaneResources(page: Page) {
  await page.goto(`/c/${CLUSTER}/crossplane/resources`, { waitUntil: 'domcontentloaded' });
  await authenticate(page);
  await page.waitForSelector('text=provider-nop', { timeout: 40_000 }).catch(() => {});
}
