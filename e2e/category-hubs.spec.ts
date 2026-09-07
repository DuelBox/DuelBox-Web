import { expect, test } from '@playwright/test';
import { CATALOGUE } from '../apps/web/src/data/catalogue.generated';
import { CATEGORY_HUBS, categorySlug } from '../apps/web/src/lib/categories';

/**
 * The category hubs against the real static build (#200).
 *
 * What is worth checking here is the part the unit tests cannot see: that eighteen pages
 * were actually exported, that each one carries its own prose and its own canonical URL in
 * the served HTML, and that a crawler arriving on any page of the site can reach one. The
 * copy itself, the slugs and the sitemap entries are checked in `lib/categories.test.ts` and
 * `app/sitemap.test.ts`, on the data, where a failure names the category.
 *
 * The hub under test is read from `CATEGORY_HUBS` rather than spelled out, so a category
 * renamed in the catalogue does not leave this asserting a page that no longer exists.
 */
const HUB = CATEGORY_HUBS[0];
if (HUB === undefined) throw new Error('no category hubs');

const GAMES = CATALOGUE.filter((game) => game.category === HUB.category);

test.describe('a category hub', () => {
  test('renders its own heading, its own prose and every game in the category', async ({
    page,
  }) => {
    await page.goto(`/games/category/${HUB.slug}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HUB.title);
    // The blurb is the whole reason the page exists rather than being a filtered catalogue,
    // so it has to be in the HTML, not assembled by a script that never runs for a crawler.
    await expect(page.getByText(HUB.blurb.slice(0, 60).trim())).toBeVisible();

    const grid = page.getByRole('region', { name: `${HUB.category} games` });
    await expect(grid.getByRole('link')).toHaveCount(GAMES.length);

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', new RegExp(`/games/category/${HUB.slug}/$`));
  });

  /**
   * Every one of the eighteen, not only the six the footer carries.
   *
   * The footer links the six largest and the game page's own heading links the rest, and
   * that heading used to render only when the category had *other* games in it — so Rhythm,
   * Stealth, Deduction and Racing & Trails, one game each, had hubs that were exported,
   * sitemapped and reachable from no page on the site. Walking one game page per category
   * against the built HTML is the check that would have caught it: the unit test in
   * `lib/categories.test.ts` can only read the source, and a link is a thing a page either
   * has or does not.
   */
  test('has a way in from a page of one of its own games', async ({ page }) => {
    // Eighteen static pages in one test. Each is a fetch and a parse rather than a match,
    // but the ceiling is the suite's sixty seconds and this is the one test that spends it
    // on breadth.
    test.setTimeout(120_000);
    for (const hub of CATEGORY_HUBS) {
      const game = CATALOGUE.find((entry) => entry.category === hub.category);
      expect(game, `${hub.category} has no games`).toBeDefined();
      await page.goto(`/games/${game?.slug ?? ''}/`);
      // Inside `main`, not anywhere on the page: the footer carries the six largest hubs on
      // every page in the site, so an unscoped locator would find those six however broken
      // the heading was, and pass for exactly the twelve it cannot speak for.
      await expect(
        page.getByRole('main').locator(`a[href="/games/category/${hub.slug}/"]`),
        `${game?.name ?? ''} does not link the ${hub.category} hub`,
      ).toHaveCount(1);
      expect(hub.slug, 'the hub address is derived from the category').toBe(
        categorySlug(hub.category),
      );
    }
  });

  test('is not invented for an address nobody wrote a page for', async ({ page }) => {
    const response = await page.request.get('/games/category/not-a-category/');
    expect(response.status()).toBe(404);
  });

  test('is reachable from the footer of an unrelated page', async ({ page }) => {
    await page.goto('/how-to-play/');
    const hubs = page.getByRole('navigation', { name: 'Game categories' });
    await expect(hubs.getByRole('link')).toHaveCount(6);
    await hubs.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/games\/category\/[a-z0-9-]+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
