import { defineConfig, devices } from '@playwright/test';

process.env.DUELBOX_LATENCY = '1';

/** Development-only #133 lab. Keep one engine active so concurrent runs do not skew it. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'input-latency.spec.ts',
  workers: 1,
  timeout: 120_000,
  retries: 0,
  outputDir: 'test-results/input-latency',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4191', trace: 'retain-on-failure', headless: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command:
      "pnpm -r --filter './packages/**' build && pnpm --filter @duelbox/web dev --hostname 127.0.0.1 --port 4191",
    url: 'http://127.0.0.1:4191',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
