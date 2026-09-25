import { readFile, rename, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';

/**
 * How long to wait for the worker to install and claim the page.
 *
 * Installing precaches the whole shell — fifty-odd URLs and about half a megabyte over the
 * wire. Generous, because the failure this guards against is a worker that never activates
 * at all, and that fails at the timeout whatever the timeout is.
 */
const CONTROLLED = 30_000;

/** Resolve once a service worker is controlling this document. */
async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: CONTROLLED,
  });
}

/**
 * A full match completes with the network switched off.
 *
 * The simulation, the bots, the physics and the scoring all run on the player's device.
 * That is what makes the site nearly free to host, and it removes a round trip from every
 * input — better for the player, not a compromise. A static check can prove no gameplay
 * module *imports* a network client; only this can prove none of them needs one.
 */
test.describe('with the network cut', () => {
  test('a match against the bot plays through with every request blocked', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).waitFor();

    // Everything is loaded. From here nothing may reach the network at all.
    const blocked: string[] = [];
    await page.route('**/*', (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });

    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    // Play it out: the bot must think, move, and the score must be kept, all locally.
    const box = await page.locator('canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const scale = Math.min(box.width / 900, box.height / 900);
    const originX = box.x + (box.width - 900 * scale) / 2;
    const originY = box.y + (box.height - 900 * scale) / 2;
    const cell = (col: number, row: number) => ({
      x: originX + (120 + (col + 0.5) * 220) * scale,
      y: originY + (120 + (row + 0.5) * 220) * scale,
    });

    for (const [col, row] of [
      [0, 2],
      [1, 2],
      [2, 2],
    ] as const) {
      const at = cell(col, row);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(700);
    }

    // The HUD is driven by the local simulation, so it running at all proves the match
    // did too.
    await expect(page.getByRole('group', { name: 'Score' })).toBeVisible();

    // Two kinds of request are excluded, each for a stated reason.
    //
    // Fonts are cosmetic: they fail to a fallback face and no move depends on one
    // arriving. That the site reaches a third party for them at all is a real problem,
    // filed on #187 rather than waved through here.
    //
    // Router prefetches — `?_rsc=` payloads and the route chunks under `_next/static/` —
    // are the shell speculatively warming navigation for links on the page. They are not
    // gameplay: they happen whether or not a match is running, and on a static host they
    // are files a CDN already holds. The links inside the match overlay set
    // `prefetch={false}` precisely because of this test, so a live match does not
    // download another game's code for a link the player may never take; the site header
    // is still on screen and its links do prefetch, which is reasonable for navigation
    // chrome and is why the exclusion stays. WebKit schedules all of it differently from
    // Chromium, which is why this only ever failed in CI.
    //
    // The Google Fonts exclusion that used to sit here is gone. The typefaces were made
    // self-hosted (`apps/web/src/styles/fonts/*.woff2`) by #2469, so nothing should reach
    // those domains any more - and while the exclusion remained, this test would not have
    // noticed a `fonts.googleapis.com` link coming back. An exemption written for a
    // dependency that no longer exists is not neutral: it is a hole in the one guard that
    // would have caught the dependency returning.
    //
    // **The two remaining exclusions now filter nothing, and they are kept anyway.** Measured
    // by deleting them and running the suite: with the service worker installed this list is
    // empty on all four projects, because the worker answers a prefetch out of its cache and
    // the request never reaches the network layer `route` sits on. They are not dead the way
    // the fonts one was, though — that named a dependency that had gone, while these name a
    // behaviour that is merely being intercepted. A browser with service workers off, or an
    // insecure context, still prefetches, and this assertion would then be about the router
    // rather than about gameplay.
    //
    // One consequence is worth stating rather than leaving for somebody to discover: the
    // worker makes this test *weaker*. A gameplay module that fetched something would now be
    // answered by the worker — a 504 from its own cache-miss path — instead of showing up
    // here as a blocked URL. What replaces it is static: `check-zero-cost.mjs` now scans
    // `apps/web/src` and `.tsx` files as well, and `apps/web/public/sw.js` is the single
    // exempted file, held to three properties that say it may only ever answer a request the
    // page already made.
    const gameplayRequests = blocked.filter(
      (url) => !/[?&]_rsc=/.test(url) && !/\/_next\/static\//.test(url),
    );
    expect(gameplayRequests, 'a match must need nothing from the network').toEqual([]);
  });

  test('the whole shell survives a blocked network without a blank screen', async ({ page }) => {
    await page.goto('/play/air-hockey/');
    await page.getByRole('button', { name: 'Play together here' }).waitFor();
    await page.route('**/*', (route) => route.abort());
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Score' })).toBeVisible();
  });
});

/**
 * The case the product claim is actually about.
 *
 * The two tests above block the network *after* the page has loaded, which proves a match
 * needs nothing from us — real, and not what "works with no connection at all" says. Close
 * the tab, lose the signal, come back: until the service worker landed, that was a browser
 * error page, and every document making that claim was wrong about it.
 *
 * ## Why the network is cut with `setOffline` and not with `route(...).abort()`
 *
 * Because aborting routes does not cut the network any more, and finding that out is the
 * reason this comment is long.
 *
 * `page.route` intercepts at the page's network layer. A service worker's own `fetch()` is
 * not made by the page, so it sails straight past — the first version of the test below
 * blocked every route, navigated to a game that had never been opened, and got the game,
 * fully rendered, off the live server. It would have passed the offline assertions on a
 * machine with a working connection and failed on a train, which is the exact inversion of
 * what this file is for.
 *
 * `setOffline` is browser-level network emulation, so it applies to the worker as well.
 * Playwright implements it on Chromium and Firefox and not on WebKit, which is why these
 * are Chromium-only and say so out loud. WebKit is not covered here and that is a real gap,
 * named in `docs/pwa.md` rather than papered over: the two tests at the top of this file do
 * still run on every engine, so what is unverified on WebKit is specifically the *cold*
 * start, not offline play.
 */
/**
 * The worker itself, on every engine.
 *
 * The cold-start tests below are Chromium-only for a Playwright reason, not a product one,
 * and leaving it there would say nothing at all about iOS Safari — half this audience, and
 * the engine where a service worker is most likely to behave differently. This is the part
 * that can be checked everywhere: it registers, it installs, it takes control of the page,
 * and its precache actually contains the shell rather than being an empty cache with the
 * right name.
 */
test('the service worker installs, claims the page and precaches the shell', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: CONTROLLED,
  });

  const state = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('duelbox-shell-'));
    const shell = names[0] === undefined ? null : await caches.open(names[0]);
    return {
      names,
      home: shell === null ? false : (await shell.match('/')) !== undefined,
      offlinePage: shell === null ? false : (await shell.match('/offline/')) !== undefined,
      entries: shell === null ? 0 : (await shell.keys()).length,
    };
  });

  // Exactly one, named for this build's revision. Two would mean `activate` is not cleaning
  // up, which is how a device ends up holding three copies of the site.
  expect(state.names).toHaveLength(1);
  expect(state.home, 'the home page is precached').toBe(true);
  expect(state.offlinePage, 'the offline fallback is itself available offline').toBe(true);
  expect(state.entries).toBeGreaterThan(20);
});

/**
 * #194: a new deploy is offered, not imposed — and the Reload actually reloads.
 *
 * A cached shell that never updates is a site nobody can fix, so this is the half of the
 * service worker that has to work even more than the caching does. What it exercises is the
 * whole chain across two files: the browser finds different bytes, the new worker installs
 * and **waits** rather than swapping the chunks under a running match, the client script
 * hears `updatefound`, the person is asked, the button posts `SKIP_WAITING`, the worker
 * takes over, and `controllerchange` reloads the page onto the new build.
 *
 * ## How a second deploy is manufactured, and why it is safe next to other workers
 *
 * The trigger for an update is a byte difference in `sw.js` — nothing else. Playwright's
 * `context.route` does intercept the *registration* fetch but not the browser's later update
 * check (measured: one routed request, and `update()` went straight to the origin), so the
 * only way to produce a second version is to change the file the preview server is serving.
 *
 * That directory is shared with every other worker in the run, so the change is made
 * deliberately inert: a trailing comment. The revision is untouched, so the new worker's
 * cache names are identical, `activate` deletes nothing, and a page that registers in the
 * window between the write and the restore gets a worker that behaves exactly like the one
 * it would have got. The write is a rename, so nobody can read half a file. And it runs on
 * the `chromium` project alone — `mobile` is Chromium too, and two of these at once would be
 * two tests editing one file.
 */
test.describe('when a new version is deployed', () => {
  const worker = 'apps/web/out/sw.js';

  test('the page offers a reload, and taking it lands on the new worker', async ({ page }) => {
    // In the body rather than on the group: the condition is the *project*, and `mobile` is
    // Chromium too, so a `browserName` guard would let two of these edit one file at once.
    test.skip(
      test.info().project.name !== 'chromium',
      'mutates the served build, so exactly one project may run it',
    );

    const original = await readFile(worker, 'utf8');
    try {
      await page.goto('/');
      await controlled(page);

      // A deploy: different bytes, same behaviour. See the note above on why it is a comment.
      await writeFile(`${worker}.tmp`, `${original}\n// a new deploy\n`);
      await rename(`${worker}.tmp`, worker);
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });

      const prompt = page.getByRole('status').filter({ hasText: 'A new version of DuelBox' });
      await expect(prompt).toBeVisible({ timeout: 20_000 });

      // Waiting, not active: a match in progress is never swapped out from under itself.
      const waiting = await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null,
      );
      expect(waiting).toBe('installed');

      // A mark on this document, so "the page reloaded" is something observed rather than
      // inferred. Waiting on the URL proves nothing here — it does not change — and asserting
      // only that the prompt went away passed happily against a worker that ignores
      // `SKIP_WAITING` entirely, which is how this assertion came to be written this way.
      await page.evaluate(() => {
        (window as unknown as Record<string, boolean>).__beforeReload = true;
      });
      await page.getByRole('button', { name: 'Reload' }).click();
      await page.waitForFunction(
        () => (window as unknown as Record<string, boolean>).__beforeReload === undefined,
        undefined,
        { timeout: CONTROLLED },
      );

      // The reload landed on a page the new worker controls, and nothing is left waiting.
      await controlled(page);
      await expect(prompt).toBeHidden();
      const stillWaiting = await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null,
      );
      expect(stillWaiting, 'nothing is left waiting once the update has been taken').toBeNull();
    } finally {
      await writeFile(worker, original);
    }
  });
});

test.describe('with the network gone before the page even opens', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Playwright implements setOffline on Chromium and Firefox only, and a route-abort does ' +
      "not reach a service worker's own fetch — see the note above",
  );

  /**
   * A first visit, exactly as a player would have it.
   *
   * The worker registers on `load`, precaches the shell and claims the page. This document
   * and the game's chunk were both fetched before it was controlling, so they are cached the
   * way a real second visit and a real first match cache them — by being asked for again.
   */
  async function playedOnce(page: Page, slug: string) {
    await page.goto(`/play/${slug}/`);
    await controlled(page);
    await page.reload();
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await expect(page.locator('canvas')).toBeVisible();
  }

  test('a game already played opens cold with no network and plays out', async ({
    context,
    page,
  }) => {
    await playedOnce(page, 'tic-tac-toe');

    await context.setOffline(true);
    // A new document and an empty heap: this is a browser that was closed and reopened, not
    // a tab that lost its connection.
    const cold = await context.newPage();
    await cold.goto('/play/tic-tac-toe/');

    // Nothing here asserts the offline *indicator*, and the reason is worth writing down so
    // the next person does not spend the same twenty minutes on it: Chromium's offline
    // emulation does not make `navigator.onLine` false in a page created after it was
    // switched on — it stays `true`, and the indicator reads exactly that flag. A real
    // browser with no connection reports `false`. The indicator is covered by the catalogue
    // test below, which goes offline while a page is open and so gets the `offline` event.
    await cold.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await expect(cold.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const box = await cold.locator('canvas').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const scale = Math.min(box.width / 900, box.height / 900);
    const originX = box.x + (box.width - 900 * scale) / 2;
    const originY = box.y + (box.height - 900 * scale) / 2;
    for (const [col, row] of [
      [0, 2],
      [1, 2],
      [2, 2],
    ] as const) {
      await cold.mouse.click(
        originX + (120 + (col + 0.5) * 220) * scale,
        originY + (120 + (row + 0.5) * 220) * scale,
      );
      await cold.waitForTimeout(700);
    }
    await expect(cold.getByRole('group', { name: 'Score' })).toBeVisible();

    await cold.close();
    await context.setOffline(false);
  });

  /**
   * #2445, measured rather than asserted, and measured with the connection *up*.
   *
   * "It still works offline" and "it asks for nothing" are different claims, and only the
   * second one is what that issue is about. So this one leaves the network available and
   * checks where every response came from: `fromServiceWorker()` is false for anything that
   * actually went out. The only thing allowed out is the browser's own check for a new copy
   * of the worker, which it makes on navigation, which is the entire freshness mechanism,
   * and which no page waits on.
   */
  test('the second play of a game costs no network request at all', async ({ context, page }) => {
    await playedOnce(page, 'tic-tac-toe');

    const second = await context.newPage();
    const fromNetwork: string[] = [];
    second.on('response', (response) => {
      if (response.fromServiceWorker()) return;
      if (response.url().endsWith('/sw.js')) return;
      fromNetwork.push(response.url());
    });

    await second.goto('/play/tic-tac-toe/');
    await second.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await expect(second.locator('canvas')).toBeVisible();

    expect(fromNetwork, 'the second play of a game must ask the network for nothing').toEqual([]);
    await second.close();
  });

  test('a game never opened says so, rather than showing a browser error', async ({
    context,
    page,
  }) => {
    await page.goto('/');
    await controlled(page);

    await context.setOffline(true);
    const cold = await context.newPage();
    // Nothing has ever opened this one, so its page and its chunk are genuinely not here.
    await cold.goto('/play/sudoku/');
    await expect(cold.getByRole('heading', { name: 'Not saved to this device' })).toBeVisible();
    await cold.close();
    await context.setOffline(false);
  });

  test('the catalogue says which games are on this device, in words', async ({ context, page }) => {
    await playedOnce(page, 'tic-tac-toe');
    await page.goto('/games/');
    await context.setOffline(true);
    try {
      await expect(page.locator('html[data-net="offline"]')).toBeAttached();
      await expect(page.getByRole('status').filter({ hasText: /Offline/ })).toBeVisible();
      // The game that is here is marked as here. Rule 7: it is a word, not a shade. A played
      // game now appears twice — once in the recently-played rail and once in the grid — and
      // both carry the same annotation, so the first is enough to prove it is marked here.
      await expect(
        page.locator('a[href="/play/tic-tac-toe/"][data-offline-ready="1"]').first(),
      ).toBeAttached();
      // And one that has never been opened is marked as not here, rather than left blank.
      await expect(page.locator('a[href="/play/sudoku/"][data-offline-ready="0"]')).toBeAttached();
      // Navigation chrome is outside #main and is never annotated.
      await expect(page.locator('header a[data-offline-ready]')).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});
