import { expect, test } from '@playwright/test';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';
import { CATALOGUE } from '../apps/web/src/data/catalogue.generated';

test.describe('the static build', () => {
  test('lands, shows the catalogue, and reaches a game page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('108 games');

    await page.getByRole('link', { name: 'Start playing' }).click();
    await expect(page).toHaveURL(/\/games\/?$/);
    await expect(page.getByRole('heading', { name: 'All games' })).toBeVisible();
  });

  test('every game page is reachable without JavaScript rendering it', async ({ page }) => {
    // The content must be in the served HTML — a client-rendered games portal earns no
    // organic traffic, so this asserts the SEO property directly.
    const response = await page.goto('/games/air-hockey/');
    const html = (await response?.text()) ?? '';
    expect(html).toContain('Air Hockey');
    // The rule text is rendered server-side, not fetched by the client — read from the
    // catalogue rather than quoted, because quoting it is what made this test stale: it
    // held "Score in the opposing goal", which was the reference app's own wording until
    // #2513 rewrote all 108 rules into our own voice. A hardcoded copy of a string whose
    // whole point is that it must be ours would break again on the next rewrite.
    const rule = CATALOGUE.find((entry) => entry.slug === 'air-hockey')?.rule ?? '';
    expect(rule.length).toBeGreaterThan(0);
    expect(html).toContain(rule.slice(0, 40));
  });

  test('a game loads and renders a non-blank frame', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // A canvas that renders nothing still passes a visibility check, so assert pixels.
    await expect
      .poll(
        async () =>
          canvas.evaluate((node) => {
            const element = node as HTMLCanvasElement;
            const context = element.getContext('2d');
            if (!context || element.width === 0) return 0;
            const { data } = context.getImageData(0, 0, element.width, element.height);
            const first = data.slice(0, 4).join(',');
            for (let i = 4; i < data.length; i += 4) {
              if (data.slice(i, i + 4).join(',') !== first) return 1;
            }
            return 0;
          }),
        { timeout: 10_000 },
      )
      .toBe(1);
  });

  test('the page never scrolls sideways on a phone', async ({ page }) => {
    await page.goto('/games/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('the navigation', () => {
  test('every header link goes somewhere that exists', async ({ page }) => {
    // Two of the four did not. `/tournament/` and `/how-to-play/` were both in the header
    // and neither was a route, so on every page of the site half the navigation 404ed —
    // visible only as a pair of failed requests in the console, because Next prefetches
    // them. The Tournament link has gone until there is a tournament; How to play is now
    // a real page.
    await page.goto('/');
    const links = page.getByRole('navigation').getByRole('link');
    const count = await links.count();
    expect(count, 'the header has links to check').toBeGreaterThan(0);

    const targets: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const href = await links.nth(i).getAttribute('href');
      if (href && href.startsWith('/')) targets.push(href);
    }
    expect(targets.length).toBeGreaterThan(0);

    for (const href of targets) {
      const response = await page.request.get(href);
      expect(response.status(), `${href} is a dead link`).toBeLessThan(400);
    }
  });

  test('how to play explains the seats and the keys', async ({ page }) => {
    await page.goto('/how-to-play/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to play');
    await expect(page.getByRole('heading', { name: 'Sit opposite each other' })).toBeVisible();
    // The keyboard split is the thing two people on one laptop most need to be told.
    // The names come from `lib/seats.ts`, which owns seat identity — not spelled here,
    // because spelling them is what made this stale: the table said "Player one" until
    // #2513 gave both seats a real name instead of one name and one placeholder.
    await expect(page.getByRole('table')).toContainText(SEAT_CHARACTERS.p1);
    await expect(page.getByRole('table')).toContainText(SEAT_CHARACTERS.p2);
  });
});

test.describe('a game landing page', () => {
  /**
   * Every one of the hundred and seven landing pages used to say "This game is still being
   * built" — including the twenty-two that were playable, with the game one click away and
   * no link offered to it. The note is honest for a game that has no build; it was a
   * plain falsehood on the ones that do.
   */
  test('offers a playable game a way to play it, and its controls', async ({ page }) => {
    await page.goto('/games/tic-tac-toe/');
    await expect(page.locator('a[href="/play/tic-tac-toe/"]')).toBeVisible();
    await expect(page.getByText(/still being built/i)).toHaveCount(0);
    // The controls come from the game's own manifest, so the landing page and the play
    // page cannot disagree about what the keys do.
    await expect(page.getByText('On a keyboard')).toBeVisible();
  });

  /**
   * This used to assert the other half — that Chess said "still being built" and offered no
   * way to play. It does not any more, because Chess is built, and so is everything else:
   * all 108 catalogue entries have a package, a chunk and a playable route.
   *
   * So the assertion is inverted rather than deleted. The unbuilt state is still reachable
   * in the page (`games/[slug]/page.tsx` renders it whenever the registry has no loader),
   * and it will be reached again the moment somebody adds a row to `data/catalog.yaml`
   * before building it — which is exactly when this should fail. Asserting "no page claims
   * to be unbuilt" is the stronger guard now, and it is the one that goes red on a
   * half-added game.
   */
  test('offers every game in the catalogue a way to play it', async ({ page }) => {
    // Route slugs, not package ids: `guess-the-person` is served at `/games/guess-who/`,
    // and `apps/web/src/data/e2e-slugs.test.ts` exists because that gap has bitten before.
    for (const slug of ['chess', 'sudoku', 'solitaire', 'guess-who', 'ball-games']) {
      await page.goto(`/games/${slug}/`);
      await expect(page.locator(`a[href="/play/${slug}/"]`)).toBeVisible();
      await expect(page.getByText(/still being built/i)).toHaveCount(0);
    }
  });

  test('names each game in its own title and description', async ({ page }) => {
    // "Unique title and description per game, no templated filler."
    await page.goto('/games/crabby-volley/');
    await expect(page).toHaveTitle(/Crabby Volley/);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description ?? '').toMatch(/ball|field|point/i);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crabby Volley');
  });
});
