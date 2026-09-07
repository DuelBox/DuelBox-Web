import { expect, test } from '@playwright/test';
import { DISABLED_GAMES } from '../apps/web/src/lib/flags';

/**
 * A game switched off by the kill switch (#208) is missing from the artefact, not merely
 * unlinked in it.
 *
 * The unit guard in `apps/web/src/lib/flags.test.ts` proves the registry answers correctly
 * with a switch set. What it cannot prove is the step after that — that `PLAYABLE` deciding
 * `generateStaticParams` really means no `out/play/<slug>/index.html` was written — because
 * that is a property of the export rather than of the module. This asks the built site.
 *
 * It is driven from `DISABLED_GAMES` rather than from a slug written here, so it says the
 * truth about whatever this build was compiled with instead of about a game somebody chose
 * on the day. That leaves it with nothing to iterate in a healthy build, which is why the
 * first test exists: it runs every one of the same checks against a game that is *not*
 * switched off and expects the opposite answer, so a build that shipped no play routes at
 * all — or a `serve` that answers 404 to everything — fails here rather than passing an
 * empty loop and reporting a kill switch that works.
 *
 * Content only: it asks what the export contains and what the pages link to, and never
 * touches a pointer, a key or the canvas. It is in `CONTENT_ONLY` in `playwright.config.ts`
 * for the reason `smoke.spec.ts` is there, and that file carries the argument.
 */

/** A game this build plays, whatever else it is compiled to refuse. */
const CONTROL = 'tic-tac-toe';

test.describe('the per-game kill switch', () => {
  test('leaves a game it is not set for reachable, so the checks below can fail', async ({
    page,
  }) => {
    const play = await page.request.get(`/play/${CONTROL}/`);
    expect(play.status(), `/play/${CONTROL}/ is the route a kill switch removes`).toBe(200);

    const gamePage = await page.request.get(`/games/${CONTROL}/`);
    expect(gamePage.status()).toBe(200);
    expect(await gamePage.text()).toContain(`href="/play/${CONTROL}/"`);

    const catalogue = await page.request.get('/games/');
    expect(await catalogue.text()).toContain(`href="/play/${CONTROL}/"`);

    const sitemap = await page.request.get('/sitemap.xml');
    expect(await sitemap.text()).toContain(`/play/${CONTROL}/`);
  });

  for (const off of DISABLED_GAMES) {
    test(`${off.slug} has no play route, no play link and no sitemap entry`, async ({ page }) => {
      const play = await page.request.get(`/play/${off.slug}/`);
      expect(play.status(), `${off.slug} is switched off and still has a play route`).toBe(404);

      const catalogue = await page.request.get('/games/');
      expect(await catalogue.text()).not.toContain(`href="/play/${off.slug}/"`);

      const sitemap = await page.request.get('/sitemap.xml');
      expect(await sitemap.text()).not.toContain(`/play/${off.slug}/`);
    });

    test(`${off.slug} keeps its own page, and that page is honest about it`, async ({ page }) => {
      // The page stays deliberately: a switched-off game is one this site has and cannot
      // offer today, and 404 says the opposite of that to a reader and to a crawler.
      const response = await page.request.get(`/games/${off.slug}/`);
      expect(response.status()).toBe(200);

      await page.goto(`/games/${off.slug}/`);
      await expect(page.getByText(/switched off at the moment/i)).toBeVisible();
      // The wrong honest answer: this game was built and played, so the note the catalogue
      // shows for a game with no build behind it would be a different untruth.
      await expect(page.getByText(/still being built/i)).toHaveCount(0);
      await expect(page.locator(`a[href="/play/${off.slug}/"]`)).toHaveCount(0);
    });
  }
});
