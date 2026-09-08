import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CATALOGUE } from '../apps/web/src/data/catalogue.generated';
import { CATEGORY_HUBS } from '../apps/web/src/lib/categories';
import {
  CATEGORIES_SECTION,
  FEATURED_COUNT,
  FEATURED_SECTION,
  LANDING_SECTIONS,
  WAYS_TO_PLAY,
} from '../apps/web/src/lib/landing';

/**
 * The site with scripting switched off (#103).
 *
 * ## Why this is a real test and not a formality
 *
 * A static export is most of the way here by construction, and "most of the way" is exactly
 * the state that ships a defect: a `'use client'` component is server-rendered at build time
 * too, so the markup it produces is in the HTML and looks right in view-source. What is
 * missing is only the part that would have made it *do* something — an effect that fills in
 * the real state, a handler that answers a press. Nothing about that is visible in a diff or
 * in a screenshot, so the only way to know is to open the pages with script off and look,
 * which is what this does.
 *
 * `javaScriptEnabled` is a **context** option, so it is set for this file with `test.use`
 * rather than by adding a project. A project would run every other spec in the suite a fifth
 * time to learn nothing; a context switches it off for exactly the tests that want it off.
 *
 * ## One engine
 *
 * `playwright.config.ts` lists this file in `CONTENT_ONLY`, on the same reading as
 * `smoke.spec.ts` and `category-hubs.spec.ts`: what it asserts is what the build *contains*
 * and where its links go. Nothing here touches a pointer, a key, the canvas or the page
 * lifecycle, and a page with no script running is the case where engines have the least left
 * to disagree about — a `<a href>` navigates in all of them or the web is broken.
 *
 * ## What this deliberately does not paper over
 *
 * Two things on the site genuinely need a script, and neither is accommodated by weakening
 * an assertion here.
 *
 * - **The play route.** A game is a canvas driven by a fixed-timestep loop; there is no
 *   version of it that works without script and there should not be. What it did was worse
 *   than not working: the lobby rendered "Loading …" and never stopped, so the one page every
 *   card on the site links to told a JavaScript-off visitor to wait for something that was
 *   never coming, with the footer hidden and only the header to leave by. The `<noscript>` in
 *   `app/play/[slug]/page.tsx` now says a game needs JavaScript and links back to the
 *   catalogue and the guide, and the last test in this file holds it there. It is in the
 *   route's server component rather than in `PlaySurface`, so it is markup in the exported
 *   HTML rather than a chunk — which is not the same as free: it rides in this route's
 *   payload, and `next/link` speculates that payload for all 108 cards, so the block costs
 *   22.4 KB of `speculatedBytes` in `size-budget.json` — 207 gzipped bytes a payload,
 *   measured by taking it back out of each one. Measured rather than assumed, after this
 *   file's first version of this sentence said it cost nothing.
 * - **The header's two buttons.** "Surprise me" needs `Math.random` and the router, and the
 *   mute needs storage; both are inert with script off. They are chrome rather than content,
 *   they sit outside `main`, and the landing page itself contains no control of any kind
 *   that is not a link — which is the property asserted below, and the one that would break
 *   first if somebody put a client component into a section.
 */

test.use({ javaScriptEnabled: false });

/** Every internal destination on a page, read out of the DOM the browser actually built. */
async function internalLinks(page: Page, within: string): Promise<string[]> {
  const hrefs = await page
    .locator(`${within} a[href]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  return hrefs.filter((href) => href.startsWith('/'));
}

test.describe('with JavaScript disabled', () => {
  /**
   * The guard on the guard, and it is not ceremony.
   *
   * Every assertion in this file is worthless if the flag above is not doing anything, and a
   * suite that quietly runs with script *on* would pass all of it. `CatalogBrowser` stamps
   * `data-ready` on its root from an effect once it has read the address and the stores —
   * `axe.spec.ts` waits for that attribute for the opposite reason — so its absence is the
   * browser's own evidence that no effect has run.
   */
  test('is really running no script, which is what makes the rest of this file mean anything', async ({
    page,
  }) => {
    await page.goto('/games/');
    await expect(page.getByRole('heading', { name: 'All games' })).toBeVisible();
    await expect(
      page.locator('[data-ready]'),
      'an effect ran, so this file is testing a page with JavaScript on',
    ).toHaveCount(0);
  });

  test('the landing page renders every section it says it has, in order', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      `${String(CATALOGUE.length)} games`,
    );

    // Every h2 on the page, in document order, against the module that declares them. An
    // equality rather than a set of `toBeVisible` calls, because the order is a claim the
    // page makes — show the games, then explain, then offer the way in — and a section
    // dropped or moved is the failure this is for.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(
      LANDING_SECTIONS.map((section) => section.heading),
    );

    for (const way of WAYS_TO_PLAY) {
      await expect(page.getByRole('heading', { level: 3, name: way.title })).toBeVisible();
    }
  });

  /**
   * The first of #103's two acceptance lines, taken literally: "full content and navigation
   * present in view-source".
   *
   * **The second one is not measured anywhere, and this is the note saying so rather than
   * the file quietly covering half an issue.** #103 also asks for "Lighthouse SEO score 100
   * with JS disabled", and nothing in this repository runs Lighthouse — the only other
   * mention of the word is #184, "Add Lighthouse CI against preview deployments", which is
   * open and unbuilt. So the second line is not met, not failed, and not measurable today,
   * and #103 should be closed saying that rather than as fully met. What this file covers in
   * its place is the property that score would mostly be reporting: every section's prose in
   * the served bytes, every link resolving, and the catalogue reachable with no script at
   * all. That is the substance; the number is the proxy, and the proxy is the part that is
   * missing.
   *
   * The prose is checked against the served bytes rather than against the rendered page,
   * because that is what a crawler is given and it is the check that cannot be satisfied by
   * a script filling something in afterwards. The strings come from `lib/landing.ts`, so a
   * reworded paragraph does not make this stale — a *dropped* one fails it.
   */
  test('carries the whole of its copy in the HTML the origin serves', async ({ page }) => {
    const response = await page.request.get('/');
    expect(response.status()).toBe(200);
    const html = await response.text();

    for (const section of LANDING_SECTIONS) {
      expect(html, `${section.id}: its heading is not in the served HTML`).toContain(
        section.heading,
      );
      for (const paragraph of section.paragraphs) {
        expect(
          html,
          `${section.id}: "${paragraph.slice(0, 40)}…" is not in the served HTML`,
        ).toContain(paragraph);
      }
    }
    for (const way of WAYS_TO_PLAY) {
      expect(html, `way ${way.badge}: its title is not in the served HTML`).toContain(way.title);
      expect(html, `way ${way.badge}: its body is not in the served HTML`).toContain(way.body);
    }
  });

  test('offers nothing on the landing page that a script has to make work', async ({ page }) => {
    await page.goto('/');
    // Not "there are no buttons anywhere": the header has two and they are chrome. Inside
    // `main`, on the page every visitor lands on, every control is a link — which is what
    // makes the whole page work with no script rather than most of it.
    await expect(
      page.locator('main button, main input, main select, main [role="button"]'),
      'a control on the landing page that needs a script to do anything',
    ).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();
  });

  test('every link on the landing page goes to a page that exists', async ({ page }) => {
    await page.goto('/');
    const hrefs = await internalLinks(page, 'main');
    // The hero's two, the catalogue link beside the grid, twelve cards, eighteen hubs and
    // the two at the foot. A floor rather than the exact number, so adding a card does not
    // fail a test about dead links.
    expect(hrefs.length, 'the landing page has links to check').toBeGreaterThan(30);

    const dead: string[] = [];
    for (const href of [...new Set(hrefs)]) {
      const response = await page.request.get(href);
      if (response.status() >= 400) dead.push(`${href} → ${String(response.status())}`);
    }
    expect(dead, `dead links on the landing page:\n${dead.join('\n')}`).toEqual([]);
  });

  test('puts all eighteen category hubs one link from the landing page', async ({ page }) => {
    await page.goto('/');
    // The footer carries the six largest on every page and a game page links its own, which
    // left the other twelve reachable only by opening a game in them first. This is the
    // page a crawler and a first-time visitor both arrive at, so the whole shelf is here.
    const region = page.getByRole('region', { name: CATEGORIES_SECTION.heading });
    await expect(region.getByRole('link')).toHaveCount(CATEGORY_HUBS.length);
    for (const hub of CATEGORY_HUBS) {
      await expect(
        region.locator(`a[href="/games/category/${hub.slug}/"]`),
        `the ${hub.category} hub is not linked from the landing page`,
      ).toHaveCount(1);
    }
  });

  test('shows a dozen games, and the way to the rest', async ({ page }) => {
    await page.goto('/');
    const region = page.getByRole('region', { name: FEATURED_SECTION.heading });
    // The twelve cards plus the "See all" link that shares the section with them.
    await expect(region.getByRole('link')).toHaveCount(FEATURED_COUNT + 1);
    await expect(
      region.getByRole('link', { name: new RegExp(`See all ${String(CATALOGUE.length)}`) }),
    ).toBeVisible();
  });

  test('gets a visitor from the landing page to the catalogue and every game in it', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start playing' }).click();
    await expect(page).toHaveURL(/\/games\/?$/);
    await expect(page.getByRole('heading', { name: 'All games' })).toBeVisible();

    // The catalogue's controls are a client component and its cards are not: the server
    // renders every one of them and hands them to the browser as finished elements, so with
    // no script the search, the chips and the stars do nothing and the whole catalogue is
    // still there to be read and followed. That split is the reason this passes.
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(CATALOGUE.length);
  });

  test('gets a visitor from the landing page into a category and on to a game', async ({
    page,
  }) => {
    await page.goto('/');
    const hub = CATEGORY_HUBS[0];
    expect(hub, 'there are category hubs to visit').toBeDefined();
    if (hub === undefined) return;

    await page.locator(`main a[href="/games/category/${hub.slug}/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/games/category/${hub.slug}/$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(hub.title);
    await expect(page.getByText(hub.blurb.slice(0, 60))).toBeVisible();

    const games = CATALOGUE.filter((game) => game.category === hub.category);
    const first = games[0];
    expect(first, `${hub.category} has games`).toBeDefined();
    if (first === undefined) return;
    await page
      .getByRole('region', { name: `${hub.category} games` })
      .getByRole('link')
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/(play|games)/${first.slug}/$`));
    await expect(page).toHaveTitle(new RegExp(first.name));
  });

  /**
   * The 108 pages the whole discovery strategy rests on, read the way a search engine and
   * the person who followed its result both read them: no script, and arrived at directly.
   */
  test("a game's own page is complete without a script", async ({ page }) => {
    const game = CATALOGUE.find((entry) => entry.slug === 'tic-tac-toe');
    expect(game, 'tic-tac-toe is in the catalogue').toBeDefined();
    if (game === undefined) return;

    await page.goto(`/games/${game.slug}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(game.name);
    // The rule is the page's own meta description and the sentence a search result shows.
    await expect(page.getByText(game.rule.slice(0, 50))).toBeVisible();
    await expect(page.locator(`a[href="/play/${game.slug}/"]`)).toBeVisible();
    await expect(page.getByText('On a keyboard')).toBeVisible();
    // Its category hub, which is how the twelve hubs the footer does not carry are reached
    // from a game page.
    await expect(page.getByRole('main').locator('a[href^="/games/category/"]')).not.toHaveCount(0);
  });

  /**
   * The settings page, which is the one shell route whose whole content is read from storage.
   *
   * With no script that read never happens, so what the exported HTML says is what a visitor
   * here is told — and it said "The near seat has won 0, the far seat 0, and 0 ended level."
   * to a pair fifty matches in. `components/GameRecord.tsx` had already made the argument
   * one route over, in the same batch: a zero is a claim, and a component that has not read
   * anything is not entitled to make it. This holds the dash, because the sentence is prose
   * and prose is exactly what gets tidied back into a zero by somebody who has not read the
   * paragraph above it.
   *
   * The counts in the list above this sentence are the same shape and still read zero. That
   * is recorded here rather than fixed: they are a different question from the one this
   * batch's review found, and every byte of the change is on the shell budget.
   */
  test('claims no head-to-head record on the settings page until it has read one', async ({
    page,
  }) => {
    await page.goto('/settings/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('p', { hasText: /The near seat has won/ })).toHaveText(
      'The near seat has won –, the far seat –, and – ended level.',
    );
  });

  test('navigates from the header and the footer of a page a visitor lands on', async ({
    page,
  }) => {
    await page.goto('/');
    for (const href of await internalLinks(page, 'header')) {
      expect((await page.request.get(href)).status(), `${href} is dead`).toBeLessThan(400);
    }
    const hubs = page.getByRole('navigation', { name: 'Game categories' });
    await expect(hubs.getByRole('link')).toHaveCount(6);
    await hubs.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/games\/category\/[a-z0-9-]+\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  /**
   * The one page that needs a script, and what it now says instead of "Loading".
   *
   * A canvas driven by a fixed-timestep loop cannot work without script and nothing here
   * pretends otherwise. What this asserts is the part that was a defect rather than a
   * physical limit: the page used to render `PlaySurface`'s "Loading …" panel and nothing
   * else — a page telling a visitor to wait for something that could never arrive, on the
   * destination every card on the site links to, with the footer hidden and the header the
   * only way out. The `<noscript>` in `app/play/[slug]/page.tsx` says what is true and offers
   * the two routes back. It is server-rendered markup, which costs no JavaScript budget and
   * is not therefore free: `size-budget.json`'s `speculatedBytes` records what it costs in
   * the route payloads a catalogue browse fetches.
   *
   * The `<noscript>` element is the whole reason the assertions below mean anything: a
   * browser with scripting enabled does not build its children as DOM at all, so this content
   * exists only in the case this file is testing.
   */
  test('says a game needs a script, and offers the way back', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Play Tic Tac Toe');

    await expect(page.getByRole('heading', { name: 'A game needs JavaScript' })).toBeVisible();
    const out = page.getByRole('main').locator('a[href$="/games/"], a[href$="/how-to-play/"]');
    await expect(out, 'the noscript panel offers no way back into the site').toHaveCount(2);
    for (const href of await internalLinks(page, 'main')) {
      expect((await page.request.get(href)).status(), `${href} is dead`).toBeLessThan(400);
    }
  });
});
