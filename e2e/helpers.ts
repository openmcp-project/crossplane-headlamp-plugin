// provider-nop ships CRDs and creates NopResource instances that cycle
// through Ready/Synced conditions — perfect for CI without cloud creds.
// https://github.com/crossplane-contrib/provider-nop

import type { Page } from '@playwright/test';

export const HEADLAMP_URL = process.env.HEADLAMP_URL ?? 'http://localhost:4466';
const HEADLAMP_TOKEN = process.env.HEADLAMP_TOKEN ?? '';

/** Inject the service account token into Headlamp's localStorage so the
 *  browser skips the login screen entirely. Must be called before any
 *  navigation that renders plugin content. */
async function injectToken(page: Page) {
  if (!HEADLAMP_TOKEN) return;
  await page.goto('/');
  await page.evaluate((token) => {
    // Headlamp stores the selected cluster token under this key
    localStorage.setItem('headlamp.token', token);
    // Also set the cluster name Headlamp expects
    localStorage.setItem('headlamp.cluster', 'headlamp-e2e');
  }, HEADLAMP_TOKEN);
}

/** Navigate to the Crossplane overview page. */
export async function gotoCrossplaneOverview(page: Page) {
  await injectToken(page);
  await page.goto('/crossplane/overview');
  await page.waitForSelector('text=Loading Crossplane…', { state: 'detached', timeout: 30_000 }).catch(() => {});
}

/** Navigate to the Crossplane resources page. */
export async function gotoCrossplaneResources(page: Page) {
  await injectToken(page);
  await page.goto('/crossplane/resources');
  await page.waitForSelector('text=Loading providers…', { state: 'detached', timeout: 30_000 }).catch(() => {});
}
