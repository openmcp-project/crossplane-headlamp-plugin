import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  // Not *.spec.ts: vitest runs under headlamp-plugin's config, which sets no
  // exclude, so its default **/*.spec.ts glob would collect these too.
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.HEADLAMP_URL ?? 'http://localhost:4466',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
