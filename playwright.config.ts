import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks against the deployed site (or E2E_URL), in a phone-sized browser.
 *   npm run e2e
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: process.env.E2E_URL ?? 'https://whnhf2f85z-tech.github.io/mushroom-finder/',
    serviceWorkers: 'allow',
  },
});
