import { expect, test } from '@playwright/test';
import { PLAYABLE } from '../apps/web/src/data/registry';
import {
  NARROWEST,
  applyInsets,
  horizontalOverflow,
  insetsFor,
  outsideSafeArea,
} from './responsive';

/**
 * Every playable game's lobby, at the narrowest class, both ways up (#1891).
 *
 * Checking 107 games by hand at eight viewports is 856 manual checks, which is why the
 * responsive state of the collection has only ever been known one game at a time. This is
 * the automatic half of the answer; `scripts/responsive-matrix.mjs` is the other half, and
 * the two measure the same properties through the same helpers in `./responsive.ts` so a
 * nightly failure reproduces exactly under `pnpm responsive <slug>`.
 *
 * ## The lobby, and no match started
 *
 * Deliberate, and it is what keeps this job inside a quarter of an hour. The lobby is the
 * layout that actually differs per game — the title, the rules line, the options panel a
 * game declares, the mode buttons — while a running match is the shell's own furniture
 * around a canvas that is letterboxed by rule, so it is the same layout 107 times over.
 * `resize.spec.ts` and `safe-area.spec.ts` already hold the running match on every push, and
 * the per-game command photographs one when somebody is looking at one game. Starting 107
 * matches here would cost the countdown 107 times to re-measure the shell, and the sweep
 * would stop fitting in the nightly window it was written for.
 *
 * ## Why the narrowest class, and why both orientations in one test
 *
 * 320px is the floor the definition of done names, and a layout that fails anywhere fails
 * there first — everything wider has more room for the same content. Both orientations in
 * one test rather than two: the expensive part of a Playwright test is the browser context,
 * and turning a viewport is a method call.
 *
 * ## What it does not do
 *
 * It is not a screenshot comparison. Diffs on a pull request come from the committed
 * baselines in `e2e/visual.spec.ts` (#227) for the shell, and from the matrix a game's own
 * issue attaches; a second picture-comparison system would be a second set of baselines to
 * keep, for the same five screens. `docs/responsive.md` says how the two fit together.
 */
test.skip(
  () => process.env.DUELBOX_RESPONSIVE_SWEEP !== '1',
  'the responsive sweep runs nightly; set DUELBOX_RESPONSIVE_SWEEP=1 to run it here',
);

test.describe('every lobby at 320px', () => {
  for (const slug of PLAYABLE) {
    test(`${slug} fits the narrowest phone both ways up`, async ({ page }) => {
      await page.goto(`/play/${slug}/`);

      for (const cell of NARROWEST) {
        await page.setViewportSize({ width: cell.width, height: cell.height });
        const inset = insetsFor(cell.width, cell.height);
        // The tokens the layout is built on, given a real phone's values — Playwright
        // resolves `env(safe-area-inset-*)` to zero even on a notched profile, so what is
        // under test is whether the layout honours the tokens. `./responsive.ts` carries
        // the argument, and a physical device is still owed on #1885.
        await applyInsets(page, inset);

        const where = `${slug} at ${String(cell.width)}x${String(cell.height)}`;
        expect(await horizontalOverflow(page), `${where} scrolls sideways`).toBeLessThanOrEqual(0);
        expect(await outsideSafeArea(page, inset), `${where}: controls off screen`).toEqual([]);
      }
    });
  }
});
