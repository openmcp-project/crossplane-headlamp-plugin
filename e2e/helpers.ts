// provider-nop ships CRDs and creates NopResource instances that cycle
// through Ready/Synced conditions — perfect for CI without cloud creds.
// https://github.com/crossplane-contrib/provider-nop

import type { Page } from '@playwright/test';

export const HEADLAMP_URL = process.env.HEADLAMP_URL ?? 'http://localhost:4466';

/** Wait for the Headlamp SPA shell to finish loading. */
export async function waitForHeadlamp(page: Page) {
  await page.goto('/');
  await page.waitForSelector('[data-testid="sidebar"], nav, #app', { timeout: 30_000 });
}

/** Navigate to the Crossplane overview page. */
export async function gotoCrossplaneOverview(page: Page) {
  await page.goto('/crossplane/overview');
  // Wait until loading spinner is gone
  await page.waitForSelector('text=Loading Crossplane…', { state: 'detached', timeout: 30_000 }).catch(() => {});
}

/** Navigate to the Crossplane resources page. */
export async function gotoCrossplaneResources(page: Page) {
  await page.goto('/crossplane/resources');
  await page.waitForSelector('text=Loading providers…', { state: 'detached', timeout: 30_000 }).catch(() => {});
}
