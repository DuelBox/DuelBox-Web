import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the real static build.
 *
 * These run against `apps/web/out` served as plain files — the same artefact a static
 * host would serve — so a passing run is evidence the deployed site works, not just that
 * the dev server does.
 *
 * ## Which engines run, and when
 *
 * **Chromium and WebKit on every push.** WebKit is not optional: iOS Safari diverges on
 * audio unlock, viewport units, `touch-action` and canvas memory, and it is a large share
 * of this audience. Both iPhone projects below are real WebKit, not an emulated viewport.
 *
 * **Firefox nightly only**, behind `DUELBOX_ALL_ENGINES=1`. The decision and the reason:
 * the whole suite passes on Firefox today — 73 of 73, in 46 seconds — so it is not
 * catching anything that the other two miss, and the verify job already takes **14 minutes**
 * against a stated budget of 8. Paying a third engine's install and run time on every push
 * to re-confirm a clean result is the wrong trade; paying it once a night is not.
 *
 * If that changes — if Firefox ever fails something the others pass — this should move to
 * every push, and the nightly run is what will tell us.
 */
const ALL_ENGINES = process.env.DUELBOX_ALL_ENGINES === '1';

/**
 * Specs that assert what the build *contains* rather than how a browser behaves.
 *
 * These run on Chromium alone. Everything else — anything touching pointers, keys, layout,
 * viewport insets, the canvas or the page lifecycle — runs on every engine, because that
 * is where engines differ.
 */
const CONTENT_ONLY = ['**/smoke.spec.ts'];
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
  /**
   * Playwright defaults to a **single worker** on CI, which is why the verify job took
   * fourteen minutes against a stated budget of eight — the suite is almost entirely
   * waiting on a browser, so one worker leaves the runner idle.
   *
   * Two, not more: the tests that remain time-sensitive are ones that wait a fixed moment
   * for an animation to settle, and contention is exactly what makes those flake. Two
   * halves the time at the smallest risk, `retries: 1` absorbs a single flake, and there
   * is room to go higher if the budget still is not met.
   */
  // Spread rather than `workers: undefined`, which `exactOptionalPropertyTypes` refuses.
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * Page content — titles, links, server-rendered HTML, the catalogue.
     *
     * One engine, because none of it can plausibly differ between them: it asserts what
     * the static build contains, not how a browser lays it out or handles a touch. Running
     * it on four projects was 27 of the suite's 300 test-runs re-confirming the same HTML.
     */
    // Two people sharing one phone is the primary case, so it is tested, not assumed.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: CONTENT_ONLY },
    // A notched phone in both orientations. The insets differ between them — portrait
    // puts the cutout on the top edge, landscape on one side — so a layout that clears
    // the notch in one can still bury a control in the other.
    { name: 'notched-portrait', use: { ...devices['iPhone 14 Pro'] }, testIgnore: CONTENT_ONLY },
    {
      name: 'notched-landscape',
      use: { ...devices['iPhone 14 Pro landscape'] },
      testIgnore: CONTENT_ONLY,
    },
    // A third engine, nightly only. See the note above the export.
    ...(ALL_ENGINES
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: CONTENT_ONLY }]
      : []),
  ],
  webServer: {
    command: 'npx serve apps/web/out -l 4173 --no-clipboard',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
