import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the real static build.
 *
 * These run against `apps/web/out` served as plain files — the same artefact a static
 * host would serve — so a passing run is evidence the deployed site works, not just that
 * the dev server does.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  /**
   * Four browser projects run at once, two of them real WebKit. On a machine that is also
   * doing something else the default thirty seconds is enough to lose a handful of tests
   * to nothing worse than a slow paint — three runs during a build lost one, one and five
   * tests, each waiting on a button that a clean run finds in under a second. Sixty
   * seconds keeps a genuinely broken page failing while a busy one does not.
   */
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Two people sharing one phone is the primary case, so it is tested, not assumed.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // A notched phone in both orientations. The insets differ between them — portrait
    // puts the cutout on the top edge, landscape on one side — so a layout that clears
    // the notch in one can still bury a control in the other.
    { name: 'notched-portrait', use: { ...devices['iPhone 14 Pro'] } },
    {
      name: 'notched-landscape',
      use: { ...devices['iPhone 14 Pro landscape'] },
    },
  ],
  webServer: {
    command: 'npx serve apps/web/out -l 4173 --no-clipboard',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
