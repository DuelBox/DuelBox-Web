import { expect, test } from '@playwright/test';

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
    await page.getByRole('button', { name: 'Play against Bo' }).waitFor();

    // Everything is loaded. From here nothing may reach the network at all.
    const blocked: string[] = [];
    await page.route('**/*', (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });

    await page.getByRole('button', { name: 'Play against Bo' }).click();
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
    const gameplayRequests = blocked.filter(
      (url) =>
        !/fonts\.(gstatic|googleapis)\.com/.test(url) &&
        !/[?&]_rsc=/.test(url) &&
        !/\/_next\/static\//.test(url),
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
