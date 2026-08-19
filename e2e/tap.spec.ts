import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A tap must place a mark.
 *
 * The most basic interaction in the product, and it had no coverage at all: the suite
 * asserted a game *renders*, never that it can be *played*. Underneath, `actionPressed`
 * was derived by sampling whether a pointer was down at step time, so a tap whose press
 * and release both landed inside one frame — which on a touchscreen is most of them —
 * was invisible, and the pointer position was withheld on exactly the step the press was
 * reported. Only a deliberate ~150ms hold registered.
 */

/** Tic Tac Toe's logical board: 900x900, cells spanning 120..780. */
const LOGICAL = 900;
/** Bottom-centre cell, inside p1's half and well clear of the seat midline. */
const TARGET = { x: 450, y: 670 };

/**
 * Map a logical point to a screen point.
 *
 * The engine letterboxes the logical area inside the canvas element, so a fraction of
 * the element is not a fraction of the board — on a tall phone the two differ by more
 * than a cell, which is enough to aim at nothing at all.
 */
async function logicalToScreen(page: Page, point: { x: number; y: number }) {
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('no canvas');
  const scale = Math.min(box.width / LOGICAL, box.height / LOGICAL);
  const originX = box.x + (box.width - LOGICAL * scale) / 2;
  const originY = box.y + (box.height - LOGICAL * scale) / 2;
  return { x: originX + point.x * scale, y: originY + point.y * scale };
}

async function startAndAim(page: Page) {
  await page.goto('/play/tic-tac-toe/');
  await page.getByRole('button', { name: 'Play together here' }).click();
  // Input is refused until the count-in finishes.
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
  return logicalToScreen(page, TARGET);
}

const turnPassed = (page: Page) =>
  expect(page.getByRole('group', { name: 'Score' })).toContainText(
    'Player two has 0 points, and it is their turn',
  );

test.describe('placing a mark', () => {
  test('a quick click places a mark and passes the turn', async ({ page }) => {
    const at = await startAndAim(page);
    await page.mouse.click(at.x, at.y);
    await turnPassed(page);
  });

  test('a touchscreen tap places a mark and passes the turn', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch input needs a touch-enabled context');
    const at = await startAndAim(page);
    await page.touchscreen.tap(at.x, at.y);
    await turnPassed(page);
  });

  test('a deliberate hold still works, as it always did', async ({ page }) => {
    const at = await startAndAim(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await turnPassed(page);
  });

  test('the whole board is on screen, so every cell can be reached', async ({ page }) => {
    // A board that overflows its viewport is unplayable however well input works: in
    // landscape a square game was 686px tall inside a 343px viewport, most of it below
    // the fold, and taps aimed at the lower cells landed outside the page entirely.
    await startAndAim(page);
    const box = await page.locator('canvas').boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) return;
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  });
});
