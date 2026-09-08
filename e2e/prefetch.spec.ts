import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
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
 * ## The other half of #185, and what the first test below now asserts
 *
 * The other half is not wasting bytes on links nobody presses, and the first version of
 * this file got it exactly backwards. It prohibited one thing — that no *game chunk* is
 * fetched, which is true and worth keeping — and then required, as its liveness control,
 * that at least fifty-four route payloads *were* fetched. Nothing anywhere bounded what
 * those payloads cost. They are not JavaScript, so `scripts/check-size.mjs` walked straight
 * past them, and a browse of the catalogue fetches all 108: **more than twice the 182 KB
 * ADR 0001 budgets for a whole first session**, spent before anybody has pressed anything.
 * Raising the per-route payload, or adding `prefetch` to another hundred links, would have
 * left this file, `pnpm build` and `check-size` all green — and one of those two did
 * happen while this test was being written. A payload weighed under four kilobytes when
 * the paragraph above was first drafted and weighs 4.6 KB now, because the root layout
 * gained two before-paint inline scripts and every payload carries the whole layout tree.
 * Nothing failed. `speculatedBytes` in `size-budget.json` carries that measurement, and
 * this test is the half of it that watches a real router rather than the export.
 *
 * So the first test weighs them. The total is held against `speculatedBytes` in
 * `size-budget.json`, beside the JavaScript numbers, and `check-size.mjs` holds the same
 * figure against the built export — one number, measured from the two ends it can be
 * measured from. `seen.size` stays exactly what it was labelled: evidence that the scroll
 * walked, so a browse that silently moved nothing cannot report a cheap catalogue.
 *
 * **Neither of #185's acceptance criteria is met, and a byte budget is not one of them.**
 * "Time from tapping play to first frame drops measurably" is not measured anywhere in this
 * repository. "Nothing prefetches under save-data" has no implementation at all: nothing in
 * `apps/web` reads `navigator.connection`, and `next/link` in the app router carries no
 * save-data bail-out of its own — the only one in `next/dist` is the pages router's. The
 * issue should be closed saying so. What this file does is stop the number growing while
 * that is decided, and the decision is a real one: `prefetch={false}` on `GameCard`'s
 * `Link` — the idiom this repository already uses in `MatchOverlay` and `TournamentTrack` —
 * takes the viewport prefetch away and, in Next 15, hover and touch-start prefetching with
 * it, so it trades a first-visit download for a wait on every press.
 *
 * **Chromium alone**, because what these tests count is network scheduling, which is the
 * one thing `offline.spec.ts` records as differing between engines. That argument now lives
 * in `playwright.config.ts` with the other per-spec ones, where it belongs: standing down
 * from inside the test bodies cost nine browser contexts a run, built by the fixture and
 * discarded a line later.
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
 * The same routes, with what each payload weighs on the wire.
 *
 * Gzipped here rather than read from `content-length`, and the reason is that both ends of
 * this measurement have to agree: `serve` may or may not compress, a CDN certainly will, and
 * `scripts/check-size.mjs` weighs the same files gzipped at level 9. The body Playwright
 * hands over is the decoded one either way, so compressing it here is the one arrangement
 * that gives the same number as the build-time guard.
 */
function weighPrefetchedRoutes(page: Page): { path: string; weight: Promise<number> }[] {
  const speculated: { path: string; weight: Promise<number> }[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.searchParams.has('_rsc')) return;
    const path = url.pathname.replace(/index\.txt$/, '');
    const weight = response
      .body()
      .then((body) => gzipSync(body, { level: 9 }).length)
      // A payload whose body cannot be read is a payload this cannot weigh, and a silent
      // zero would be a guard that gets cheaper the more it fails to measure.
      .catch((reason: unknown) => {
        throw new Error(`could not weigh the payload for ${path}: ${String(reason)}`);
      });
    speculated.push({ path, weight });
  });
  return speculated;
}

/**
 * What a browse of the catalogue is allowed to speculate, in gzipped bytes.
 *
 * From `size-budget.json` rather than written here, so that the number a build fails over
 * and the number a browser is held to are one number.
 *
 * The path is taken from the config file Playwright loaded, not from `process.cwd()`, which
 * is wherever the command was typed. `rootDir` is the *test* directory — `e2e/` — which the
 * first version of this used and which failed the run with `ENOENT … e2e/size-budget.json`;
 * the fallback keeps that shape rather than inventing a second answer.
 */
function speculatedBudget(): number {
  const config = test.info().config;
  const root =
    config.configFile === undefined ? join(config.rootDir, '..') : dirname(config.configFile);
  const path = join(root, 'size-budget.json');
  const budget: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const bytes =
    typeof budget === 'object' && budget !== null
      ? (budget as Record<string, unknown>)['speculatedBytes']
      : undefined;
  expect(typeof bytes, 'size-budget.json has no speculatedBytes to hold this to').toBe('number');
  return bytes as number;
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

test.describe('what a catalogue card costs to press', () => {
  test('browsing the whole catalogue costs no game code and a stated number of bytes', async ({
    page,
  }) => {
    const scripts = recordScripts(page);
    const speculated = weighPrefetchedRoutes(page);
    await openCatalogue(page);
    await browseToTheEnd(page);
    await page.waitForLoadState('networkidle');

    // That the walk walked. Every card has to have passed under the router's eye for the
    // verdicts below to mean anything, and the count of routes it speculated on is the only
    // evidence of that from out here — a scroll that silently moved nothing would otherwise
    // report a clean grid having looked at two screens of it. It is a control and nothing
    // else: what it says is that this browse happened, never that the browse was worth its
    // bytes, and reading it as an endorsement is how the byte assertion below came to be
    // missing for a whole batch.
    const played = speculated.filter((fetched) => fetched.path.startsWith('/play/'));
    const seen = new Set(played.map((fetched) => fetched.path));
    expect(seen.size, 'the scroll did not reach most of the grid').toBeGreaterThan(
      CATALOGUE.length / 2,
    );

    // The play routes only, because they are the set that scales with the catalogue: one
    // per card, 108 of them today, against the handful the header and footer link. It is
    // also exactly what `scripts/check-size.mjs` weighs in the export, so a disagreement
    // between the two is a real difference between what is built and what is fetched.
    const total = (await Promise.all(played.map((fetched) => fetched.weight))).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    const budget = speculatedBudget();
    expect(
      total,
      `browsing the catalogue speculated ${String(total)} gzipped bytes of route payloads` +
        ` in ${String(played.length)} fetches of ${String(seen.size)} routes, against the` +
        ` ${String(budget)} in size-budget.json. Nobody pressed anything to earn them, and` +
        ' more fetches than routes means the router is asking twice.',
    ).toBeLessThanOrEqual(budget);

    expect(
      scripts.filter((path) => GAME_CHUNK.test(path)),
      'a game chunk was downloaded for a visitor who has not chosen a game',
    ).toEqual([]);
  });

  test('a card that has never been on screen has not been prefetched', async ({ page }) => {
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
