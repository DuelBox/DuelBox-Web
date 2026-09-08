import { expect, test, type Page } from '@playwright/test';

/**
 * The rotate suggestion, and the two things it must never do (#136).
 *
 * 71 of the 108 games declare an orientation their box is designed for, and every one of them
 * is playable held the other way — it letterboxes. So the prompt is an offer, and the
 * acceptance criteria are about restraint rather than about the offer: it appears only for a
 * game that declared something, it is dismissible, and **it never blocks play**.
 *
 * The last one is the test that matters, and it is a browser question rather than a unit one:
 * a chip over a board that fills its box would swallow presses aimed at the game, and no
 * amount of choosing a corner fixes that on a full-bleed surface.
 */

/** Portrait boxes; `air-hockey` is one of the four landscape ones; `chess` declares `any`. */
const PORTRAIT_GAME = 'road-dodge';
const ANY_GAME = 'chess';

/**
 * Starts a match and returns as soon as the lobby is gone.
 *
 * Deliberately **not** waiting for the countdown to finish. The prompt is up for every live
 * phase, countdown included, so waiting for the count to run out adds a dependency on how
 * fast a CI runner loads a game chunk and nothing else — which is exactly what it cost: two
 * shards timed out at ten seconds on a spec that passes in under one locally.
 */
async function play(page: Page, game: string) {
  await page.goto(`/play/${game}/`);
  const start = page.getByRole('button', { name: 'Play together here' });
  await start.click();
  await expect(start).toBeHidden();
}

const prompt = (page: Page) => page.getByText(/Turn the device (upright|sideways)/i);

test.describe('the rotate suggestion', () => {
  test('offers to be turned when the device is the way the game did not ask for', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await play(page, PORTRAIT_GAME);
    await expect(prompt(page)).toContainText(/upright/i);
  });

  test('says nothing when the device is already the way the game asked for', async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 });
    await play(page, PORTRAIT_GAME);
    await expect(prompt(page)).toBeHidden();
  });

  test('says nothing at all to a game with no preference', async ({ page }) => {
    // The assertion that stops this being "show it always": `chess` declares `any`, so no
    // orientation is the wrong one for it.
    await page.setViewportSize({ width: 900, height: 500 });
    await play(page, ANY_GAME);
    await expect(prompt(page)).toBeHidden();
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(prompt(page)).toBeHidden();
  });

  test('goes when it is dismissed, and stays gone', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await play(page, PORTRAIT_GAME);
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(prompt(page)).toBeHidden();
  });

  test('lets a press through to the board it sits over', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    await play(page, PORTRAIT_GAME);
    // The layer, not the button: the button is the one thing that takes a press.
    const layer = page
      .locator('p')
      .filter({ hasText: /Turn the device/i })
      .locator('..');
    await expect(layer).toHaveCSS('pointer-events', 'none');
    await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCSS('pointer-events', 'auto');
  });

  test('does not pause the match it is offering about', async ({ page }) => {
    // The whole of "never blocks play": the board is still running underneath it.
    await page.setViewportSize({ width: 900, height: 500 });
    await play(page, PORTRAIT_GAME);
    await expect(prompt(page)).toBeVisible();
    // A pause would put the pause panel up; the match phase is what this is really asking.
    await expect(page.getByRole('button', { name: /Resume/i })).toBeHidden();
  });
});
