import { expect, test, type Page } from '@playwright/test';
import { CATALOGUE } from '../apps/web/src/data/catalogue.generated';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';

/**
 * What pressing a catalogue card actually costs (#185).
 *
 * #185 asks for route and chunk prefetching on intent, on the reading that a game starts
 * faster when the bytes behind the link are already in the browser. Measured against this
 * build, most of that is already happening and none of it is ours. `next/link` prefetches
 * the route payload for every card within 200px of the viewport, and the flight payload it
 * fetches names the play route's client chunks, so React loads those with it. By the time
 * a visitor has decided which card to press, the whole play route — the match flow, the
 * engine and the audio, 39 KB gzipped — is already there.
 *
 * What is left is a single file: the game's own chunk, behind the dynamic import in
 * `data/registry.ts`, which nothing asks for until `PlaySurface` mounts and calls
 * `loadGame`. So the property worth pinning is not whether we prefetch — the framework
 * decides that — but what the arrangement buys the player, which is a number: **pressing a
 * card downloads exactly one script, and it is that game's code.**
 *
 * Both sides of that number are load-bearing, and the reason to assert a count rather than
 * a list of chunk names is that either side breaking is a real defect. If the route
 * prefetch ever stops — a `prefetch={false}` added for byte reasons, a framework change, a
 * card that stops being a `Link` — the count goes up by four and a press pays for the
 * engine at the moment somebody is waiting on it. If code splitting collapses and a game
 * is folded into a shared chunk, the count goes to zero, which is rule 11 failing in the
 * one place `check-size.mjs` cannot see: it weighs the emitted chunks, and never asks who
 * fetches them or when.
 *
 * The other half of #185 — not wasting bytes on links nobody presses — is the first test
 * below, and it is the one worth having. Browsing the whole catalogue must not download a
 * line of any game's code: 108 speculative game chunks are about 480 KB gzipped spent on a
 * visitor who plays one of them, which is more than twice what ADR 0001 budgets for a
 * whole first session.
 *
 * **Chromium alone, and said here rather than in `playwright.config.ts`.** What these
 * tests count is network scheduling, which is the one thing `offline.spec.ts` records as
 * differing between engines — "WebKit schedules all of it differently from Chromium, which
 * is why this only ever failed in CI". A count that means one thing on Chromium and
 * another on WebKit is not a guard on either. The skip is in this file because the lists in
 * `playwright.config.ts` carry that file's own argument about what runs where; if this spec
 * earns a place in `CHROMIUM_ONLY`, the skip below should go at the same time.
 */

/**
 * A game's own chunk, as webpack names one: a numeric id, a content hash, nothing else.
 * The shared chunks a route loads eagerly are `<id>-<hash>.js`, with a dash, and a route's
 * own chunk lives under `chunks/app/`, so neither can be mistaken for a game.
 */
const GAME_CHUNK = /^\/_next\/static\/chunks\/\d+\.[0-9a-f]+\.js$/;

/** Every script the page asks for, in order, as paths. */
function recordScripts(page: Page): string[] {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });
  return scripts;
}

/** Every route the router speculatively fetched a payload for, as the path it belongs to. */
function recordPrefetchedRoutes(page: Page): string[] {
  const routes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.searchParams.has('_rsc')) routes.push(url.pathname.replace(/index\.txt$/, ''));
  });
  return routes;
}

/**
 * The catalogue, loaded and then left alone until the router has finished speculating.
 *
 * `data-ready` says the page has read the address and the stores; the idle wait after it is
 * the part these tests turn on, because router prefetching is scheduled off the critical
 * path and a count taken before it settles is a count of nothing.
 */
async function openCatalogue(page: Page): Promise<void> {
  await page.goto('/games/');
  await expect(page.locator('[data-ready]')).toBeAttached();
  await page.waitForLoadState('networkidle');
}

/**
 * Down the whole grid, a screen at a time, the way somebody looking for a game goes.
 *
 * A screen at a time rather than one jump to the bottom, and this is not a nicety: a
 * single `scrollTo(0, scrollHeight)` moves the viewport past 100 cards without any of them
 * ever being on screen, and the router's observer prefetches 12 more rather than 108. The
 * first version of the test below did exactly that, and would have reported that browsing
 * the catalogue downloads no game code having browsed two screens of it.
 */
async function browseToTheEnd(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
    }
  });
}

/** The `href` of one card, as a string, so a missing attribute fails here and not later. */
async function hrefOf(page: Page, which: 'first' | 'last'): Promise<string> {
  const cards = page.locator('a[href^="/play/"]');
  const href = await (which === 'first' ? cards.first() : cards.last()).getAttribute('href');
  expect(href, `the catalogue has no ${which} playable card`).not.toBeNull();
  return href ?? '';
}

/**
 * Stand down on every project but `chromium`.
 *
 * By project rather than by engine: `mobile` is a Pixel 7, which is Chromium as well, and
 * running there would re-confirm this verdict at a second viewport rather than test it.
 * Called from inside each test because a `test.skip` predicate must destructure the
 * fixtures object, and this one needs none of them.
 */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'counts network scheduling; see the header');
}

test.describe('what a catalogue card costs to press', () => {
  test('browsing the whole catalogue downloads no game code at all', async ({ page }) => {
    chromiumOnly();
    const scripts = recordScripts(page);
    const routes = recordPrefetchedRoutes(page);
    await openCatalogue(page);
    await browseToTheEnd(page);
    await page.waitForLoadState('networkidle');

    // That the walk walked. Every card has to have passed under the router's eye for the
    // verdict below to mean anything, and the count of routes it speculated on is the only
    // evidence of that from out here — a scroll that silently moved nothing would otherwise
    // report a clean grid having looked at two screens of it.
    const seen = new Set(routes.filter((path) => path.startsWith('/play/')));
    expect(seen.size, 'the scroll did not reach most of the grid').toBeGreaterThan(
      CATALOGUE.length / 2,
    );

    expect(
      scripts.filter((path) => GAME_CHUNK.test(path)),
      'a game chunk was downloaded for a visitor who has not chosen a game',
    ).toEqual([]);
  });

  test('a card that has never been on screen has not been prefetched', async ({ page }) => {
    chromiumOnly();
    const routes = recordPrefetchedRoutes(page);
    await openCatalogue(page);

    const first = await hrefOf(page, 'first');
    const last = await hrefOf(page, 'last');
    expect(first, 'the grid is one card long, so nothing in it is off screen').not.toBe(last);

    // Asserted in both directions on purpose. Without the first half this passes on a page
    // that prefetches nothing at all, which is the shape of guard CLAUDE.md keeps a tally
    // of: one that cannot fail because the thing it measures never happens.
    expect(routes, 'the card under the visitor was not prefetched, so nothing was').toContain(
      first,
    );
    expect(routes, 'the router prefetched a card nobody has scrolled to').not.toContain(last);
  });

  test('pressing a card downloads one script, and it is that game', async ({ page }) => {
    chromiumOnly();
    const scripts = recordScripts(page);
    await openCatalogue(page);

    const before = scripts.length;
    await page.locator('a[href^="/play/"]').first().click();
    // The lobby's mode buttons are drawn from the game's own manifest, so waiting for one
    // waits for the chunk to have arrived and run rather than for a fixed moment.
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).waitFor();

    const fetched = scripts.slice(before);
    expect(
      fetched,
      'the play route was not already in the browser, so the press paid for it',
    ).toHaveLength(1);
    expect(
      fetched.filter((path) => GAME_CHUNK.test(path)),
      'the one script a press pays for is not a game chunk',
    ).toHaveLength(1);
  });
});
