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
 *
 * `category-hubs.spec.ts` qualifies on the same reading as `smoke.spec.ts`: it asks a hub
 * for its heading, its prose, its canonical URL, the number of cards in its grid, a footer
 * link, and — one game page per category — whether anything on the site links the hub at
 * all. It never touches a pointer, a key or the canvas. Listing it here is what
 * keeps eighteen static pages from costing the verify job nine repeat test-runs — the
 * budget CLAUDE.md records as already having been overspent once.
 *
 * `record.spec.ts` deliberately is NOT here, and it is the useful contrast: it plays a
 * match to its end, so it exercises the canvas, the loop and the page lifecycle, which is
 * exactly the code that differs between engines.
 */
const CONTENT_ONLY = ['**/smoke.spec.ts', '**/category-hubs.spec.ts'];

/**
 * The axe-core scan, on Chromium alone, on the same argument as `CONTENT_ONLY` above.
 *
 * axe reads the accessibility tree and the computed styles. An accessible name, a heading
 * order, a landmark and a contrast ratio are properties of the document rather than of how
 * an engine paints it, so a second engine re-confirms a verdict rather than testing one —
 * and a scan is a far more expensive test-run than a content check, because it injects and
 * runs axe on every page it visits. Anything that genuinely differs between engines is
 * already covered by specs that run on all four.
 *
 * If a rule ever fires on one engine and not another, this is the list to take it out of.
 */
const CHROMIUM_ONLY = ['**/axe.spec.ts'];

/**
 * Specs that set their own viewport and therefore want one project *per engine*, not four.
 *
 * `touch-targets.spec.ts` measures every control at 320px, which it sets for itself — so on
 * the two Chromium projects it would measure the same engine at the same width twice, and on
 * the two WebKit ones likewise. What it does need is both engines, because a range slider, a
 * file chooser and a search field are drawn by the browser rather than by the stylesheet, and
 * the settings page has all three. So it keeps `chromium` and `notched-portrait` and stands
 * down on the other two.
 */
const ONE_PER_ENGINE = ['**/touch-targets.spec.ts'];

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
     * it on four projects was 27 of the suite's 300 test-runs re-confirming the same HTML,
     * and the category hubs would have added nine more of the same.
     */
    // Two people sharing one phone is the primary case, so it is tested, not assumed.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testIgnore: [...CONTENT_ONLY, ...CHROMIUM_ONLY, ...ONE_PER_ENGINE],
    },
    // A notched phone in both orientations. The insets differ between them — portrait
    // puts the cutout on the top edge, landscape on one side — so a layout that clears
    // the notch in one can still bury a control in the other.
    {
      name: 'notched-portrait',
      use: { ...devices['iPhone 14 Pro'] },
      testIgnore: [...CONTENT_ONLY, ...CHROMIUM_ONLY],
    },
    {
      name: 'notched-landscape',
      use: { ...devices['iPhone 14 Pro landscape'] },
      testIgnore: [...CONTENT_ONLY, ...CHROMIUM_ONLY, ...ONE_PER_ENGINE],
    },
    // A third engine, nightly only. See the note above the export.
    ...(ALL_ENGINES
      ? [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
            testIgnore: [...CONTENT_ONLY, ...CHROMIUM_ONLY, ...ONE_PER_ENGINE],
          },
        ]
      : []),
  ],
  webServer: {
    command: 'npx serve apps/web/out -l 4173 --no-clipboard',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
