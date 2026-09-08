import { expect, test, type Page } from '@playwright/test';
import { seatCentroids } from './seat-pixels.js';

/**
 * Swapping which seat is which colour (#161): the scoreboard, the board and the shapes.
 *
 * The setting exchanges the two seats' colours everywhere a seat is painted — the HUD's
 * glyphs and pips through `tokens.css`, the board through the engine's live palette — and
 * exchanges nothing else. Three things a unit test cannot hold are held here: that the
 * attribute is on `<html>` before hydration (the head script's job), that the pixels a game
 * draws follow the swap, and that the shapes and the names stay with their seats.
 *
 * `seatCentroids` finds seats by the *brand* hexes — red is "p1", blue is "p2" — so under
 * a swap its answer inverts by construction, and the board test asserts that inversion
 * deliberately rather than teaching the helper about the attribute: the near seat's key
 * moves the blue body, and the red one stays where it was.
 */

const settings = (page: Page) => page.getByRole('switch', { name: 'Swap the seat colours' });

/** The default pair as `getComputedStyle` reports them, from `styles/tokens.css`. */
const RED = 'rgb(255, 90, 78)';
const BLUE = 'rgb(33, 176, 232)';

/** The upright scoreboard's half for one seat: the flipped copy is decorative and has no name. */
const seat = (page: Page, id: 'p1' | 'p2') =>
  page.getByRole('group', { name: 'Score' }).locator(`[data-seat="${id}"]`);

async function swapOn(page: Page): Promise<void> {
  await page.goto('/settings/');
  // A statically exported page is on screen before it is interactive, and a press that lands
  // before the switch has hydrated does nothing at all — `page-transition.spec.ts` has the
  // long form. The press is repeated until the switch answers it, which a press that worked
  // does within a frame; on a loaded runner the first one landed early about once in twenty.
  await expect(async () => {
    await settings(page).click();
    await expect(settings(page)).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function startMiniSoccer(page: Page): Promise<void> {
  await page.goto('/play/mini-soccer/');
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

/** The near seat's HUD glyph: its element (the shape) and its computed fill (the colour). */
async function nearGlyph(page: Page): Promise<{ shape: string; fill: string }> {
  const glyph = seat(page, 'p1').locator('svg > *');
  return {
    shape: await glyph.evaluate((el) => el.tagName.toLowerCase()),
    fill: await glyph.evaluate((el) => getComputedStyle(el).fill),
  };
}

test.describe('swapping the seat colours', () => {
  test('is kept, and is on the document before the page hydrates', async ({ page }) => {
    await swapOn(page);
    await page.goto('/games/');
    // Read straight after navigation: the inline head script stamps it during parse, before
    // any chunk has loaded, so there is no flash of the un-swapped pair to catch.
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-seat-swap'))).toBe(
      true,
    );
    await page.goto('/settings/');
    await expect(settings(page)).toHaveAttribute('aria-checked', 'true');
    await settings(page).click();
    await expect(settings(page)).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-seat-swap'))).toBe(
      false,
    );
  });

  test('recolours the near seat on the scoreboard without changing its shape', async ({ page }) => {
    await startMiniSoccer(page);
    const before = await nearGlyph(page);
    expect(before).toEqual({ shape: 'circle', fill: RED });

    await swapOn(page);
    await startMiniSoccer(page);
    const after = await nearGlyph(page);
    // The circle is still a circle — rule 7's shape signal does not follow the colour.
    expect(after).toEqual({ shape: 'circle', fill: BLUE });
    const far = seat(page, 'p2').locator('svg > *');
    expect(await far.evaluate((el) => el.tagName.toLowerCase())).toBe('rect');
    expect(await far.evaluate((el) => getComputedStyle(el).fill)).toBe(RED);
  });

  test('recolours the board, so the near seat drives the blue body', async ({ page }) => {
    // The control first: un-swapped, the near seat's key moves the red body.
    await startMiniSoccer(page);
    const plain = await seatCentroids(page);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyS');
    const plainAfter = await seatCentroids(page);
    expect(Math.abs((plainAfter.p1?.y ?? 0) - (plain.p1?.y ?? 0)), 'red moved').toBeGreaterThan(8);
    expect(Math.abs((plainAfter.p2?.y ?? 0) - (plain.p2?.y ?? 0)), 'blue stayed').toBeLessThan(2);

    await swapOn(page);
    await startMiniSoccer(page);
    const start = await seatCentroids(page);
    expect(start.p1, 'a red body is on the pitch').not.toBeNull();
    expect(start.p2, 'a blue body is on the pitch').not.toBeNull();
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyS');
    const after = await seatCentroids(page);
    // The helper names colours, not seats: with the pair exchanged, the near seat's own key
    // moves the body it now paints blue, and the red body — the far seat's — stays put.
    expect(Math.abs((after.p2?.y ?? 0) - (start.p2?.y ?? 0)), 'blue moved').toBeGreaterThan(8);
    expect(Math.abs((after.p1?.y ?? 0) - (start.p1?.y ?? 0)), 'red stayed').toBeLessThan(2);
  });

  test('leaves the names where they were', async ({ page }) => {
    await page.goto('/settings/');
    await page.evaluate(() => {
      localStorage.setItem('duelbox:player-names', JSON.stringify({ version: 1, p1: 'Ada' }));
    });
    await swapOn(page);
    await startMiniSoccer(page);
    // A name belongs to a seat, not to a colour: the near seat is still Ada, now in blue.
    await expect(seat(page, 'p1')).toContainText('Ada');
    await expect(seat(page, 'p2')).not.toContainText('Ada');
  });
});
