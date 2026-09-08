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
 * `no-javascript.spec.ts` (#103) qualifies on the same reading and one more of its own. It
 * asks what the served HTML contains and where its links go, with scripting switched off —
 * and a page running no script is the case where two engines have the least left to
 * disagree about, since what remains is a document and its anchors. It switches scripting
 * off with `test.use({ javaScriptEnabled: false })`, which is a **context** option rather
 * than a project: a project would have run every other spec in the suite a fifth time to
 * learn nothing.
 *
 * `record.spec.ts` deliberately is NOT here, and it is the useful contrast: it plays a
 * match to its end, so it exercises the canvas, the loop and the page lifecycle, which is
 * exactly the code that differs between engines.
 *
 * `kill-switch.spec.ts` (#208) is the plainest member of the list. Every assertion in it is
 * a request, a status code or a sentence in the served HTML — whether a switched-off game
 * has a play route at all, whether anything still offers it, and whether its own page says
 * so honestly. There is no pointer, no key, no canvas and no storage in it. It is also
 * mostly empty by design: with nothing switched off it runs one positive control, and four
 * copies of one control is four times nothing.
 */
const CONTENT_ONLY = [
  '**/smoke.spec.ts',
  '**/category-hubs.spec.ts',
  '**/no-javascript.spec.ts',
  '**/kill-switch.spec.ts',
];

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
 * `page-transition.spec.ts` joins it on the same reading. What it asserts is that the page
 * entry animation contains nothing able to hold up a press: it animates opacity, so no box
 * moves and no hit test changes. Opacity has never taken part in hit testing in any engine,
 * so a second one would re-confirm the verdict rather than test it, and the property that
 * could differ between engines — how a fade is painted — is not the property under test.
 *
 * It is also the list that spec *must* be in, which is a stronger reason than the one above
 * — though that reason is parked rather than live today, and the difference matters to
 * anyone reading this to decide where a spec goes. Its layout-shift measurement reads
 * `PerformanceObserver` entries of type `layout-shift`, an API only Chromium implements: on
 * WebKit the observer would never fire, the total would be zero, and the assertion would
 * pass having measured nothing at all. A guard that cannot fail on an engine is worse on
 * that engine than no guard, so it is only run where the number is real. That test is
 * `test.fixme` under #2539, so what runs in the file today asks `getAnimations()` for a
 * play state, which every engine implements; the spec stays here for the day #2539 unparks
 * the measurement, and on the opacity argument above in the meantime.
 *
 * If a rule ever fires on one engine and not another, this is the list to take it out of.
 *
 * `visual.spec.ts` (#227) is here on a stronger version of the same argument, and on one of
 * its own. A screenshot is a picture of one engine at one size: a second project does not
 * re-confirm a verdict, it needs a whole second set of baselines to have a verdict at all.
 * On all four that is four sets of images, four times the bytes in the repository, and four
 * diffs to read on the day somebody moves a padding token — to learn four times over that
 * the token moved. The spec sets its own two viewports, and what it photographs is layout
 * and colour rather than anything an engine decides; where engines really do differ on this
 * shell — insets, pointers, the canvas — specs that run on all four already cover it.
 *
 * `tournament.spec.ts` is here on the first of those arguments rather than the second. What
 * it asserts is a state machine, a `localStorage` document and the markup drawn from them,
 * and none of the three is a thing engines differ about. It does play two bot matches to
 * their end, which *is* engine-sensitive — but that path is already covered on all four
 * projects by `record.spec.ts` and `match-flow.spec.ts`, so a second engine here would pay
 * about seventy seconds of authorised waiting to re-confirm a canvas somebody else has
 * already confirmed. It is the most expensive spec in the suite per run, which is the
 * strongest reason of all to run it once.
 *
 * `game-record.spec.ts` (#160, #162) is here on `tournament.spec.ts`'s reading, and it is
 * the cleaner case of the two because it never plays a match at all. It writes the
 * head-to-head document the way `lib/head-to-head.ts` writes it and asks two pages what
 * they made of it; a stored string, a sum and the markup drawn from them are not things
 * engines disagree about. What it would have been worth keeping on four projects is the
 * shape of the record block on a narrow screen — and that is not this spec's question:
 * `safe-area.spec.ts` already opens a game page on all four and fails if the page scrolls
 * sideways, which is the assertion that would actually catch a row too wide to fit.
 *
 * `prefetch.spec.ts` (#185) counts network scheduling and the bytes it moves, which
 * `offline.spec.ts` records as the one thing that genuinely differs between these engines —
 * "WebKit schedules all of it differently from Chromium, which is why this only ever failed
 * in CI". A count that means one thing on Chromium and another on WebKit is not a guard on
 * either. It stood down from inside its own test bodies until it was listed here, which
 * cost nine browser contexts a run — built by the `page` fixture, then discarded by a
 * runtime `test.skip`, two of them real WebKit — on a job this file has already been split
 * twice to keep inside its budget. The skip and this line were always meant to be one
 * decision, and the spec's header said so; this is that decision.
 */
const CHROMIUM_ONLY = [
  '**/axe.spec.ts',
  '**/page-transition.spec.ts',
  '**/tournament.spec.ts',
  '**/visual.spec.ts',
  '**/game-record.spec.ts',
  '**/prefetch.spec.ts',
  // `share-card.spec.ts` (#164) plays a bot match to its end on every run, which is the
  // most expensive thing a spec can do, to press one button and read back a PNG's
  // dimensions. Dimensions and a decoded PNG do not differ between engines; the canvas
  // rasteriser does, and that is exactly what the card does not claim to hold. Same
  // reading as `tournament.spec.ts`.
  '**/share-card.spec.ts',
  // Headless WebKit's WebGL is software-rendered when it exists at all, and the flag it
  // exercises is off in every build a WebKit user gets (#16).
  '**/renderer-parity.spec.ts',
  // `adaptive-quality.spec.ts` (#190) stubs `navigator.getBattery`, which only Chromium has.
  // On WebKit the gate is never armed in production, so a second engine would be testing the
  // stub rather than the product — and it did: the frames-per-second ratio the spec holds
  // read outside its window on a loaded runner's WebKit twice, for a path no WebKit user runs.
  '**/adaptive-quality.spec.ts',
  // `beforeinstallprompt` is Chromium's; WebKit never fires it and the feature is rightly a
  // no-op there, so a second engine would be four copies of a hidden button (#195).
  '**/install-prompt.spec.ts',
];

/**
 * Specs that set their own viewport and therefore want one project *per engine*, not four.
 *
 * `touch-targets.spec.ts` measures every control at 320px, which it sets for itself — so on
 * the two Chromium projects it would measure the same engine at the same width twice, and on
 * the two WebKit ones likewise. What it does need is both engines, because a range slider, a
 * file chooser and a search field are drawn by the browser rather than by the stylesheet, and
 * the settings page has all three. So it keeps `chromium` and `notched-portrait` and stands
 * down on the other two.
 *
 * `screen-reader.spec.ts` arrives at the same two projects from the other side. Landmarks,
 * accessible names and live regions are properties of the document, so on that count it
 * belongs in `CHROMIUM_ONLY` with the axe scan — but one of the things it pins is not: a
 * fragment link to a `<main>` that cannot hold focus left `document.activeElement` on
 * `<body>`, and Chromium hid that by moving the sequential focus starting point where WebKit
 * was measured not to. A Chromium-only run of that assertion would re-confirm the engine on
 * which the defect never showed. Two projects, then, and not four: the second Chromium and
 * the second WebKit would each be the same verdict a third time.
 */
const ONE_PER_ENGINE = [
  '**/touch-targets.spec.ts',
  '**/screen-reader.spec.ts',
  // `rotate-prompt.spec.ts` (#136) sets a portrait and a landscape viewport of its own, per
  // test, because which way up the device is *is* the thing under test. On a project that has
  // already chosen one, running it again measures the viewport this spec set either way — so
  // four projects would be four copies of two measurements, and the two that matter are one
  // per engine.
  '**/rotate-prompt.spec.ts',
];

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
  /**
   * A screenshot baseline is never written by a run that did not ask for one (#227).
   *
   * Playwright's default is `'missing'`: a comparison with no baseline writes the picture it
   * just took into the source tree, attaches it as the *expected* image, and fails with "…,
   * writing actual." Three things wrong with that here, none of them fatal and all of them
   * avoidable by asking for the behaviour we want. An ordinary `pnpm e2e` on a Mac would
   * leave `-darwin` PNGs behind that nobody asked for. The message reads as though the run
   * had fixed something, when what it did was overwrite the question with the answer. And
   * the attachment labelled "expected" is a picture of the very change under review.
   *
   * With `'none'` a missing baseline is `A snapshot doesn't exist at …`, exit code 1, and
   * nothing on disk. Watched, not assumed: one baseline moved aside, `CI=1`, this config —
   * "1 failed", nothing written, and the retry failed too; the same run with `-u missing`
   * (which is the default's behaviour) — "1 failed" and the file recreated.
   *
   * The hazard worth writing down is the one that is **not** here: a written-then-retried
   * snapshot would pass on the retry and land as flaky, which is a guard that cannot fail.
   * Playwright closes that itself — `handleMissing` returns `shouldNotRetryTest` in that
   * mode — so this setting is about the three things above and not about that. `-u` on the
   * command line still overrides it, which is how a baseline is made and a change accepted.
   */
  updateSnapshots: 'none',
  expect: {
    toHaveScreenshot: {
      /**
       * `-linux` on every file, from a suite that only runs on Linux, so that the one thing
       * a reader has to know about these images is legible in `ls`. `e2e/visual.spec.ts`
       * carries the reasoning and `.gitignore` keeps everybody else's platform out.
       */
      pathTemplate: 'e2e/__screenshots__/{arg}{-projectName}{-platform}{ext}',
      /**
       * Every pixel, exactly, and **not** Playwright's default of `0.2`.
       *
       * That default is a distance in YIQ space, and pixelmatch counts a pixel as different
       * only past `35215 * threshold²` — 1408 at `0.2`, which is a **pure luminance shift of
       * 52 of 255 on every pixel of the page, tolerated**. This was not read off a document;
       * it was watched. `--db-muted` (#6e7488, 4.65:1, the smallest ratio this product lets
       * body text stand on) was swapped for `--db-faint` (#9aa0b4, 2.45:1, the token that
       * must never carry body text) in the built stylesheet, and all five screens passed:
       * the swap is a delta of 978, comfortably inside 1408. The one regression this
       * repository would least like to ship is the one the default cannot see.
       *
       * So: 0. Two shots of one page by one build of one browser on one platform are the
       * same bytes — this suite's own run-to-run stability is the evidence — and a guard
       * that starts exact can be loosened against a real diff. If runner-to-runner variance
       * ever appears, the failure names the pixel count, and the answer is a small
       * `maxDiffPixels`, never a bigger threshold: a pixel budget tolerates a few pixels
       * anywhere, while a threshold tolerates a systematic shift everywhere, which is
       * exactly what was just demonstrated to be invisible.
       */
      threshold: 0,
    },
  },
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
