import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the graph on the dev page (`npm run dev:web`), never in Obsidian.
 * `@playwright/test` is pinned to 1.56.1, whose Chromium (build 1194) is preinstalled in the
 * Claude Code cloud image; elsewhere run `npx playwright install chromium` once.
 *
 * Screenshot comparisons are tagged @visual: their baselines depend on the machine's fonts and
 * renderer, so CI runs everything else (`--grep-invert @visual`).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
