import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A match survives being resized, rotated, and folded.
 *
 * This is not a hypothetical. Mobile browser chrome slides in and out on scroll, a phone
 * gets turned mid-rally, a foldable opens, and a laptop window gets dragged to another
 * monitor. Any of those changing the *simulation* rather than only its presentation would
 * mean a player loses a match to a gesture they did not think of as an input.
 *
 * The property being asserted is that the game is not rebuilt and its state does not
 * move. `cross-viewport.test.ts` proves the simulation is viewport-independent at a fixed
 * size; this proves the *transition* between sizes is too.
 */

/** Counts how many times the host attaches its canvas listener. One mount, one count. */
const COUNT_MOUNTS = `
  window.__mounts = 0;
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'pointerdown' && this instanceof HTMLCanvasElement) window.__mounts++;
    return add.call(this, type, ...rest);
  };
`;

const mounts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mounts: number }).__mounts);

/** The whole visible match state, as a screen reader would read it. */
const hudText = (page: Page) => page.getByRole('group', { name: 'Score' }).innerText();

async function startMatch(page: Page): Promise<void> {
  await page.goto('/play/tic-tac-toe/');
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

test.describe('resizing mid-match', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(COUNT_MOUNTS);
  });

  test('does not rebuild the game', async ({ page }) => {
    // A rebuild would restart the match, which is the failure this guards against: the
    // player would see the board reset because they turned their phone.
    await startMatch(page);
    const before = await mounts(page);

    for (const size of [
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
    }

    expect(await mounts(page), 'the game was rebuilt by a resize').toBe(before);
  });

  test('preserves the score and whose turn it is through a rotation', async ({ page }) => {
    await startMatch(page);
    await page.setViewportSize({ width: 400, height: 800 });
    await page.waitForTimeout(200);
    const before = await hudText(page);

    // Portrait to landscape and back — the transition a phone makes most often.
    await page.setViewportSize({ width: 800, height: 400 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 400, height: 800 });
    await page.waitForTimeout(300);

    expect(await hudText(page)).toBe(before);
  });

  test('keeps the board on screen at every size it passes through', async ({ page }) => {
    await startMatch(page);
    for (const size of [
      { width: 320, height: 568 },
      { width: 393, height: 852 },
      { width: 852, height: 393 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
      { width: 2560, height: 1440 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      const box = await page.locator('canvas').boundingBox();
      expect(box, `no canvas at ${size.width}x${size.height}`).not.toBeNull();
      if (!box) continue;
      const where = `${size.width}x${size.height}`;
      expect(box.y, where).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height, where).toBeLessThanOrEqual(size.height + 1);
      expect(box.x + box.width, where).toBeLessThanOrEqual(size.width + 1);
      expect(box.width, `${where}: board collapsed`).toBeGreaterThan(40);
      expect(box.height, `${where}: board collapsed`).toBeGreaterThan(40);
    }
  });

  test('never scrolls the page sideways at any size', async ({ page }) => {
    await startMatch(page);
    for (const width of [320, 375, 414, 640, 768, 1024, 1440, 2560, 3840]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${String(width)}px`).toBeLessThanOrEqual(0);
    }
  });

  test('survives a fold: a very narrow viewport and back', async ({ page }) => {
    // A folding phone can reach widths no phone ever had. The board must not vanish and
    // the match must not restart.
    await startMatch(page);
    const before = await mounts(page);
    await page.setViewportSize({ width: 280, height: 653 });
    await page.waitForTimeout(250);
    const narrow = await page.locator('canvas').boundingBox();
    expect(narrow?.width ?? 0).toBeGreaterThan(20);

    await page.setViewportSize({ width: 717, height: 512 });
    await page.waitForTimeout(250);
    expect(await mounts(page), 'unfolding rebuilt the game').toBe(before);
  });
});
