import { expect, test, type Page } from '@playwright/test';
import { CATALOGUE, CATEGORIES } from '../apps/web/src/data/catalogue.generated';
import { filterEntries, sortEntries } from '../apps/web/src/lib/catalogue-filter';
import { RECENT_KEY } from '../apps/web/src/lib/recent';

/**
 * The catalogue's controls (#83–#87, #163) against the real static build.
 *
 * Every card and every control is in the served HTML. What these check is the part the
 * HTML cannot carry: that typing narrows the grid and says so to a screen reader, that a
 * chip lands in the address and is still there after a reload and gone after Back, that a
 * star is still lit tomorrow, and that "Surprise me" goes somewhere playable.
 *
 * Expected counts come from the same functions the page uses, over the same catalogue, so
 * a game added to the Board category does not make this stale.
 */

/** The index the page builds for the browser, rebuilt here from the same catalogue. */
const INDEX = CATALOGUE.map((game) => ({
  slug: game.slug,
  name: game.name,
  category: game.category,
  roundSeconds: game.roundSeconds,
  playable: true,
}));

/**
 * The server renders every control before the script that drives them has arrived, and
 * the browser stamps `data-ready` on its root once it has read the address and the stores.
 * A star pressed before that is a press on a page that cannot yet respond, so every test
 * waits for the stamp rather than for luck.
 */
async function openCatalogue(page: Page, path = '/games/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('[data-ready]')).toBeAttached();
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const chip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Categories' }).getByRole('button', { name, exact: true });

/**
 * One game's card, found by where it goes rather than by what it is called.
 *
 * A card's accessible name is every string inside the link, and the "Play" badge sits
 * above the title in the markup — so Chess announces as "Play Chess Board · about 5
 * minutes Two players · vs Bot" and a name-based locator has to encode all of that. The
 * href is the one part of a card that is exactly the game, and `smoke.spec.ts` already
 * addresses cards this way.
 */
const card = (page: Page, slug: string) => page.locator(`a[href="/play/${slug}/"]`);

test.describe('searching the catalogue', () => {
  test('typing narrows the grid and tells a screen reader how many are left', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('searchbox', { name: 'Search games' }).fill('chess');

    const expected = filterEntries(INDEX, { text: 'chess', categories: [] });
    expect(expected.length, 'the search is selective').toBeGreaterThan(0);
    expect(expected.length, 'the search is selective').toBeLessThan(CATALOGUE.length);

    await expect(page.locator('p[aria-live="polite"]')).toHaveText(
      `${String(expected.length)} game${expected.length === 1 ? '' : 's'}`,
    );
    await expect(card(page, 'chess')).toBeVisible();
    await expect(card(page, 'air-hockey')).toHaveCount(0);
    // Typing lands in the address, so the view can be shared.
    await expect(page).toHaveURL(/\?q=chess$/);
  });

  test('a search that finds nothing is not a dead end', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('searchbox', { name: 'Search games' }).fill('zzzzzz');
    await expect(page.locator('p[aria-live="polite"]')).toHaveText('0 games');
    await expect(page.getByText('No games match “zzzzzz”')).toBeVisible();
    // Three games to try instead, each a real card.
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(3);
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.locator('p[aria-live="polite"]')).toHaveText(
      `${String(CATALOGUE.length)} games`,
    );
  });
});

test.describe('filtering by category', () => {
  // Two plain-word categories, so the address can be matched without encoding games.
  const plain = CATEGORIES.filter((category) => /^[A-Za-z]+$/.test(category));
  const first = plain[0];
  const second = plain[1];
  if (first === undefined || second === undefined) throw new Error('fewer than two categories');

  test('a chip lands in the address, survives a reload and is undone by Back', async ({ page }) => {
    await openCatalogue(page);
    await chip(page, first).click();
    await expect(page).toHaveURL(new RegExp(`\\?category=${first}$`));
    await expect(chip(page, first)).toHaveAttribute('aria-pressed', 'true');
    // Only that category's section is left.
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toContainText(first);

    await page.reload();
    await expect(chip(page, first)).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(new RegExp(`\\?category=${first}$`));
    await expect(page.locator('[data-ready]')).toBeAttached();

    await chip(page, second).click();
    await expect(page).toHaveURL(new RegExp(`\\?category=${first},${second}$`));
    await expect(headings).toHaveCount(2);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`\\?category=${first}$`));
    await expect(chip(page, second)).toHaveAttribute('aria-pressed', 'false');
    await expect(chip(page, first)).toHaveAttribute('aria-pressed', 'true');
    await expect(headings).toHaveCount(1);
  });

  test('clear all takes every chip off at once', async ({ page }) => {
    await openCatalogue(page, `/games/?category=${first},${second}`);
    await expect(chip(page, first)).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, second)).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/\/games\/$/);
    await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0);
    await expect(page.locator('p[aria-live="polite"]')).toHaveText(
      `${String(CATALOGUE.length)} games`,
    );
  });
});

test.describe('sorting', () => {
  test('sorting by name flattens the grid and is remembered', async ({ page }) => {
    await openCatalogue(page);
    await page.getByLabel('Sort by').selectOption('name');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    const alphabetical = sortEntries(INDEX, 'name')[0];
    expect(alphabetical, 'the catalogue sorts to something').toBeDefined();
    await expect(page.getByRole('main').getByRole('link').first()).toHaveAttribute(
      'href',
      `/play/${alphabetical?.slug ?? ''}/`,
    );

    await page.reload();
    await expect(page.getByLabel('Sort by')).toHaveValue('name');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  });
});

test.describe('favourites', () => {
  test('a star pins the game to the top and stays lit after a reload', async ({ page }) => {
    await openCatalogue(page);
    await page.getByRole('button', { name: 'Add Chess to favourites', exact: true }).click();

    const favourites = page.locator('section', {
      has: page.getByRole('heading', { name: 'Favourites', level: 2 }),
    });
    await expect(favourites.locator('a[href="/play/chess/"]')).toBeVisible();
    // Lit on the pinned card and on the card in its own category, and named for what
    // pressing it now does.
    await expect(
      page.getByRole('button', { name: 'Remove Chess from favourites', exact: true }),
    ).toHaveCount(2);

    await openCatalogue(page);
    await expect(favourites.locator('a[href="/play/chess/"]')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Remove Chess from favourites', exact: true }),
    ).toHaveCount(2);
  });

  test("the star on a game's own page agrees with the catalogue", async ({ page }) => {
    await page.goto('/games/chess/');
    const star = page.getByRole('button', { name: 'Add Chess to favourites', exact: true });
    await expect(star).toBeVisible();
    await star.click();
    await expect(
      page.getByRole('button', { name: 'Remove Chess from favourites', exact: true }),
    ).toBeVisible();

    await openCatalogue(page);
    await expect(page.getByRole('heading', { name: 'Favourites', level: 2 })).toBeVisible();
  });
});

test.describe('recently played', () => {
  test('lists the last games first and can be cleared', async ({ page }) => {
    await page.goto('/games/');
    // Written the way `lib/recent.ts` writes it; playing two games is what would put it
    // there, and this is the row, not the recorder, under test.
    await page.evaluate(
      ([key, value]: readonly [string, string]) => {
        localStorage.setItem(key, value);
      },
      [RECENT_KEY, JSON.stringify({ version: 1, slugs: ['chess', 'air-hockey'] })] as const,
    );
    await openCatalogue(page);

    const recent = page.locator('section', {
      has: page.getByRole('heading', { name: 'Recently played', level: 2 }),
    });
    await expect(recent.getByRole('link')).toHaveCount(2);
    await expect(recent.getByRole('link').first()).toHaveAttribute('href', '/play/chess/');

    await recent.getByRole('button', { name: 'Clear recently played' }).click();
    await expect(recent).toHaveCount(0);
    await openCatalogue(page);
    await expect(page.getByRole('heading', { name: 'Recently played', level: 2 })).toHaveCount(0);
  });
});

test.describe('surprise me', () => {
  test('lands on a game that can be played', async ({ page }) => {
    await openCatalogue(page);
    // Scoped to the page body: the header may carry a "Surprise me" of its own.
    await page.getByRole('main').getByRole('button', { name: 'Surprise me' }).click();
    await expect(page).toHaveURL(/\/play\/[a-z0-9-]+\/$/);
    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('on the narrowest phone', () => {
  test('the controls are all present and the page does not widen', async ({ page }) => {
    // 320 rather than 360: the definition of done says 320px to 4K.
    await page.setViewportSize({ width: 320, height: 640 });
    await openCatalogue(page);
    await expect(page.getByRole('searchbox', { name: 'Search games' })).toBeVisible();
    await expect(page.getByLabel('Sort by')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Categories' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: 'Surprise me' })).toBeVisible();
    expect(await overflow(page), 'the controls fit without widening the page').toBeLessThanOrEqual(
      0,
    );
  });
});
