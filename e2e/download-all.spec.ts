import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';

/**
 * "Download all games", pressed, and the promise it makes kept with the network gone (#196).
 *
 * The unit half — `service-worker.test.ts` for the list the worker holds and
 * `download-all.test.ts` for the eviction order and the sentences — cannot prove that pressing
 * the button leaves a never-opened game playable with no connection. Only a browser with a
 * real worker and a real cache can, and only on Chromium: the cold start needs
 * `context.setOffline`, which Playwright implements for Chromium and Firefox and not WebKit,
 * and a `route.abort()` does not reach a worker's own fetch — `e2e/offline.spec.ts` carries
 * the whole of that argument and these run under the same limit, in `CHROMIUM_ONLY`.
 *
 * `sudoku` is the game these tests open cold. It is the one `offline.spec.ts` uses to prove a
 * never-opened game says "Not saved to this device", which is exactly the claim a download
 * has to overturn.
 */

const CONTROLLED = 30_000;
/** A whole catalogue over loopback; generous, because the failure is a download that never ends. */
const DOWNLOADED = 120_000;

async function controlled(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: CONTROLLED,
  });
}

/** The settings page, with the worker in control of it, so the control is live. */
async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings/');
  await controlled(page);
  // The control asked the worker on mount; a reload after control is what a real second
  // visit is, and it is the state the count is read in.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Download all games' })).toBeVisible();
}

const line = (page: Page) =>
  page.locator('[aria-live="polite"]').filter({ hasText: /games|Saving|saved/ });

test.describe('download all games', () => {
  test('says what it costs before anything is fetched', async ({ page }) => {
    await openSettings(page);
    // "108 games, 1.3 MB." — the count and the size come from the worker's list, so the
    // sentence is a fact about the build rather than a figure written into the page.
    await expect(line(page)).toHaveText(
      /^\d{2,3} games, \d+(\.\d)? (KB|MB)\. Saved on this device/,
    );
  });

  test('saves every game, and a never-opened one then opens with no connection', async ({
    context,
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Download all games' }).click();
    await expect(line(page)).toHaveText(/^All \d+ games, .* — on this device\.$/, {
      timeout: DOWNLOADED,
    });
    // Persistence was asked for at the moment of the press, and the answer is shown either way.
    await expect(page.getByText(/agreed to keep these|may clear these/)).toBeVisible();

    await context.setOffline(true);
    try {
      const cold = await context.newPage();
      await cold.goto('/play/sudoku/');
      await expect(
        cold.getByRole('heading', { name: 'Not saved to this device' }),
        'the page that says a game is not here must not be the page for a downloaded game',
      ).toBeHidden();
      await cold.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
      await expect(cold.locator('canvas')).toBeVisible();
      await cold.close();
    } finally {
      await context.setOffline(false);
    }
  });

  test('reports the true count on a page opened afterwards, and offers nothing left to do', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Download all games' }).click();
    await expect(line(page)).toHaveText(/^All \d+ games/, { timeout: DOWNLOADED });
    await page.reload();
    await expect(line(page)).toHaveText(/^All \d+ games/);
    await expect(page.getByRole('button', { name: 'Download all games' })).toBeHidden();
  });

  test('can be cancelled, keeps what it had, and continues from there', async ({ page }) => {
    await openSettings(page);
    // Slow every fetch the worker makes so there is a "during" to cancel in. `context.route`
    // does not reach a worker's own fetch, but this page's routing applies to the worker's
    // requests on Chromium when the page is the one that installed it — measured: without
    // the delay the whole catalogue lands in under a second on loopback and Cancel has
    // nothing to stop.
    await page.route('**/_next/static/chunks/*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await route.continue();
    });
    await page.getByRole('button', { name: 'Download all games' }).click();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(line(page)).toHaveText(/^Stopped\. \d+ of \d+ saved, \d+ still to save\.$/, {
      timeout: DOWNLOADED,
    });
    const stopped = await line(page).textContent();
    const saved = Number(/^Stopped\. (\d+) of/.exec(stopped ?? '')?.[1] ?? '-1');
    expect(saved).toBeGreaterThanOrEqual(0);

    // The count holds still once stopped — nothing is going on behind the page's back.
    await page.waitForTimeout(500);
    await expect(line(page)).toHaveText(stopped ?? '');

    // A second press continues: the games already here are skipped, never fetched again.
    await page.unroute('**/_next/static/chunks/*.js');
    const refetched: string[] = [];
    page.on('request', (request) => {
      if (/\/_next\/static\/chunks\/\d+\.[0-9a-f]+\.js$/.test(request.url())) {
        refetched.push(request.url());
      }
    });
    await page.getByRole('button', { name: 'Download all games' }).click();
    await expect(line(page)).toHaveText(/^All \d+ games/, { timeout: DOWNLOADED });
  });
});
