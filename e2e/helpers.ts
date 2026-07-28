import type { Page } from '@playwright/test';

const HEADLAMP_TOKEN = process.env.HEADLAMP_TOKEN ?? '';
// In-cluster Headlamp names the cluster "main"
const CLUSTER = 'main';

/** Authenticate against Headlamp by filling in the token form if it appears. */
async function authenticate(page: Page) {
  // Take a debug screenshot so we can see what Headlamp renders
  await page.screenshot({ path: 'e2e/screenshots/debug-before-auth.png', fullPage: true }).catch(() => {});

  const authHeader = page.locator('h1:has-text("Authentication")');
  const hasAuthPage = await authHeader
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  await page.screenshot({ path: `e2e/screenshots/debug-auth-detected-${hasAuthPage}.png`, fullPage: true }).catch(() => {});

  if (!hasAuthPage) return;

  await page.locator('#token').fill(HEADLAMP_TOKEN);
  await Promise.all([
    page.waitForNavigation({ timeout: 15_000 }).catch(() => {}),
    page.click('button:has-text("Authenticate")'),
  ]);

  // Screenshot after auth
  await page.screenshot({ path: 'e2e/screenshots/debug-after-auth.png', fullPage: true }).catch(() => {});
}

/** Navigate to the Crossplane overview page, authenticating if needed. */
export async function gotoCrossplaneOverview(page: Page) {
  await page.goto(`/c/${CLUSTER}/crossplane/overview`, { waitUntil: 'domcontentloaded' });
  await authenticate(page);
  await page.waitForSelector('text=Loading Crossplane…', { state: 'detached', timeout: 30_000 }).catch(() => {});
}

/** Navigate to the Crossplane resources page, authenticating if needed. */
export async function gotoCrossplaneResources(page: Page) {
  await page.goto(`/c/${CLUSTER}/crossplane/resources`, { waitUntil: 'domcontentloaded' });
  await authenticate(page);
  await page.waitForSelector('text=Loading providers…', { state: 'detached', timeout: 30_000 }).catch(() => {});
}
