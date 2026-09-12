import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * What the metric-matched stand-ins are worth when a face swaps in (#187).
 *
 * `font-display: swap` draws text immediately in whatever the stack reaches, then redraws it
 * in the real face when the file lands. `fonts.css` gives each of the three Latin families a
 * `local()` companion — no file, no request — whose four descriptors bend the device's Arial
 * or Courier New onto the primary's metrics, and `tokens.css` lists each one second in its
 * stack. The header of `fonts.css` carries the numbers, how they were read, and the twenty
 * measurements that chose them; `font-coverage.test.ts` holds everything a browser is not
 * needed for. This is the rest, and it is deliberately two assertions of very different
 * strength, because the two halves of the claim are of very different strength.
 *
 * **The line box is exact.** `ascent-override` and `descent-override` are the primary's own
 * ascent and descent, so a line of the stand-in is the same height as a line of the primary
 * to the pixel. The control beside it is the device face with no descriptors on it, which is
 * what the stack fell through to before this change and which is 5% to 17% away.
 *
 * **The width is a mean, and only a mean.** `size-adjust` is one number: the ratio of the two
 * faces' average advance over the characters this site renders. It makes a long run of the
 * site's own text come out the same length, which is what this asserts and why it asserts it
 * loosely — an individual line is still up to a percent out either way, because no single
 * ratio can match every string.
 *
 * That is not a hedge, it is the finding. A line wraps or it does not, so the movement a
 * visitor actually sees is a threshold on a width the stand-in matches only on average, and
 * the second half of this file measures it directly rather than inferring it: the woff2 files
 * held back, the page left to hydrate and settle in the stand-in, and the document's height
 * read before and after the real faces land. Across the twenty route-and-width pairs in
 * `fonts.css`'s header the stand-ins move 412 px in total against 507 px with them stripped
 * out — better on nine pairs, identical on eight, **worse on three**. Four of those twenty
 * run here: three the stand-ins win and the one they lose worst, so this guard cannot be read
 * as claiming more than the mechanism does.
 *
 * Chromium only. Not for the shift API — this reads `scrollHeight`, which every engine has,
 * and deliberately so, after `layout-shift` was tried first and turned out to be dominated by
 * hydration rather than by the swap. It is here because `local('Arial')` resolves to a
 * different face on every platform, so the *size* of the win is a property of this machine's
 * fonts, and re-measuring it on four projects would be four different numbers for one claim.
 * `playwright.config.ts` lists it with the specs that stand down for reasons of their own.
 *
 * The service worker is blocked throughout: it would answer the font requests itself on a
 * second visit, and what is under test is the first one.
 */

/** The 52 unaccented ASCII letters: a single-line probe with no wrap decision in it. */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

interface Pair {
  readonly primary: string;
  readonly fallback: string;
  /** The first name the fallback's `src` asks the device for. */
  readonly device: string;
  /** The weight the descriptors were measured at, and so the weight to measure back. */
  readonly weight: number;
}

const PAIRS: readonly Pair[] = [
  { primary: 'Fredoka', fallback: 'Fredoka Fallback', device: 'Arial', weight: 600 },
  {
    primary: 'Plus Jakarta Sans',
    fallback: 'Plus Jakarta Sans Fallback',
    device: 'Arial',
    weight: 400,
  },
  {
    primary: 'JetBrains Mono',
    fallback: 'JetBrains Mono Fallback',
    device: 'Courier New',
    weight: 500,
  },
];

test.describe('the metric-matched stand-ins', () => {
  test.use({ serviceWorkers: 'block' });

  test('have the primary’s line box exactly, and its width on average', async ({ page }) => {
    await page.goto('/');

    const report = await page.evaluate(
      async ({ pairs, letters }) => {
        await Promise.all(
          pairs.map(({ primary, weight }) =>
            document.fonts.load(`${String(weight)} 40px "${primary}"`),
          ),
        );
        await document.fonts.ready;

        // The site's own rendered text, which is the corpus `size-adjust` was weighted by.
        // `white-space:pre` so the spaces survive — they are one character in six here, and
        // the two faces disagree about the space more than about any letter.
        const sample = (document.body.innerText || letters).replace(/\s+/g, ' ').slice(0, 3000);

        const box = (stack: string, weight: number, text: string) => {
          const probe = document.createElement('span');
          probe.textContent = text;
          probe.style.cssText =
            'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;' +
            `line-height:normal;font:${String(weight)} 40px ${stack}`;
          document.body.append(probe);
          const rect = probe.getBoundingClientRect();
          const measured = { width: rect.width, height: rect.height };
          probe.remove();
          return measured;
        };

        return pairs.map((pair) => ({
          ...pair,
          loaded: document.fonts.check(`${String(pair.weight)} 40px "${pair.primary}"`),
          // Is the device face installed at all? The name against a generic, and the generic
          // alone — a sans name against `monospace`, since a machine whose monospace default
          // *is* Courier New would make the obvious `"Courier New", monospace` comparison
          // read as "missing". Without this the whole test would pass vacuously on a machine
          // with no Arial, having measured the same system fallback three times over.
          deviceInstalled:
            box(`"${pair.device}", cursive`, pair.weight, letters).width !==
            box('cursive', pair.weight, letters).width,
          primary1: box(`"${pair.primary}"`, pair.weight, letters),
          fallback1: box(`"${pair.fallback}"`, pair.weight, letters),
          device1: box(`"${pair.device}"`, pair.weight, letters),
          primaryText: box(`"${pair.primary}"`, pair.weight, sample).width,
          fallbackText: box(`"${pair.fallback}"`, pair.weight, sample).width,
          deviceText: box(`"${pair.device}"`, pair.weight, sample).width,
          sampleLength: sample.length,
        }));
      },
      { pairs: PAIRS, letters: LETTERS },
    );

    const missing = report.filter((face) => !face.deviceInstalled).map((face) => face.device);
    test.skip(
      missing.length > 0,
      `not installed here, so the stand-in resolves to nothing: ${missing.join(', ')}`,
    );

    const off = (a: number, b: number) => Math.abs(a - b) / b;

    for (const face of report) {
      console.log(
        `${face.primary}: line box ${face.primary1.height} / stand-in ${face.fallback1.height}` +
          ` / ${face.device} ${face.device1.height}; ${String(face.sampleLength)} chars of the` +
          ` site's text ${face.primaryText.toFixed(1)} / ${face.fallbackText.toFixed(1)} /` +
          ` ${face.deviceText.toFixed(1)}`,
      );

      expect(face.loaded, `${face.primary} never loaded, so there is nothing to match`).toBe(true);

      // Exact, because the overrides are the primary's own ascent and descent.
      expect(
        face.fallback1.height,
        `${face.fallback} is not ${face.primary}'s line box`,
      ).toBeCloseTo(face.primary1.height, 1);
      // The control: the same device face without the descriptors is not. The closest of the
      // three is Arial against Fredoka at 5.2% by the metrics in `fonts.css`.
      expect(
        off(face.device1.height, face.primary1.height),
        `${face.device} already has ${face.primary}'s line box — the overrides prove nothing`,
      ).toBeGreaterThan(0.02);

      // And the mean. 2% because that is what one ratio can promise over a run of real text:
      // it carries the punctuation, digits and casing the weighting could only average.
      expect(
        off(face.fallbackText, face.primaryText),
        `${face.fallback} is not ${face.primary}'s width on the site's own text`,
      ).toBeLessThan(0.02);
      // Its control is the pair the ratio is furthest from 100% for. Fredoka and JetBrains
      // Mono are within 1.5% of their device face before any adjustment, so for those two
      // this is a check and not a discrimination, and the line box above is the whole of the
      // difference the descriptors make.
      if (face.primary === 'Plus Jakarta Sans') {
        expect(
          off(face.deviceText, face.primaryText),
          `${face.device} already has ${face.primary}'s width — size-adjust proves nothing`,
        ).toBeGreaterThan(0.02);
      }
    }
  });
});

/**
 * How far the page moves when the real faces land, with the stand-ins and without them.
 */
test.describe('the reflow a font swap costs', () => {
  /**
   * Four of the twenty pairs in `fonts.css`'s header: three where the stand-ins win, and
   * `/` at 320px, which is the one they lose worst. A guard made only of the wins would
   * report a mechanism this repository does not have.
   */
  const CASES = [
    { route: '/how-to-play/', width: 768 },
    { route: '/how-to-play/', width: 390 },
    { route: '/privacy/', width: 390 },
    { route: '/', width: 320 },
  ] as const;

  /** Long enough that the page is hydrated and settled in the stand-in before the swap. */
  const HELD_BACK = 4000;

  const reflowOf = async (
    browser: Browser,
    route: string,
    width: number,
    strip: boolean,
  ): Promise<number> => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width, height: 800 },
    });
    const page: Page = await context.newPage();
    await page.route('**/*.woff2', async (route_) => {
      await new Promise((resolve) => setTimeout(resolve, HELD_BACK));
      await route_.continue();
    });
    if (strip) {
      // The site exactly as it was before #187: the faces still declared, and no stack
      // reaching them. Rewritten in flight so that nothing else about the build differs.
      await page.route('**/*.css', async (route_) => {
        const response = await route_.fetch();
        await route_.fulfill({
          response,
          body: (await response.text()).replace(/"[^"]+ Fallback",/g, ''),
        });
      });
    }
    // Not `load`: Chromium holds the load event for a font requested during parse, so
    // waiting for it here would wait out the delay above and measure nothing at all.
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(HELD_BACK / 2);
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    const before = await height();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.evaluate(
      async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 300))),
    );
    const after = await height();
    await context.close();
    return Math.abs(after - before);
  };

  test('is smaller in total with the stand-ins than without them', async ({ browser }) => {
    test.slow();
    let withStandIns = 0;
    let bare = 0;
    for (const { route, width } of CASES) {
      const a = await reflowOf(browser, route, width, false);
      const b = await reflowOf(browser, route, width, true);
      withStandIns += a;
      bare += b;
      console.log(
        `${route} @${String(width)}: ${String(a)} px with stand-ins, ${String(b)} px without`,
      );
    }

    // The control first. Without the stand-ins the swap really does move these four pages,
    // or this run has measured nothing and the number beside it means nothing either — a
    // page that does not move cannot be made to move less.
    expect(bare, 'the swap moved nothing even without the stand-ins').toBeGreaterThan(60);
    expect(withStandIns, 'the stand-ins did not reduce the reflow').toBeLessThan(bare);
  });
});
