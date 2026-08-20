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

test.describe('reaching the whole board', () => {
  /**
   * A turn-based board belongs to whoever is to move — all of it.
   *
   * The seat zones exist so that two people playing *at once* each own their own touches.
   * Applied to a turn-based board they were actively harmful: the board rotates to face
   * whoever has the move, so its far side sits in the other seat's zone, and every tap
   * aimed there was attributed to a player whose turn it was not and dropped. In Tic Tac
   * Toe the far row of cells could not be reached by touch at all, and ten shared-board
   * games had the same hole.
   *
   * It hid because the test above deliberately aims at a point "well clear of the seat
   * midline" — that is, only where it already worked.
   */
  const SHARED_BOARD_GAMES = [
    { slug: 'tic-tac-toe', logical: 900, point: { x: 200, y: 200 } },
    { slug: 'color-wars', logical: 900, point: { x: 210, y: 210 } },
    // Reversi only accepts a move that flips something, so this is one of its four
    // opening moves — the one that sits in the far half.
    { slug: 'reversi', logical: 900, point: { x: 405, y: 315 } },
    { slug: 'dots-and-boxes', logical: 900, point: { x: 300, y: 200 } },
  ];

  for (const { slug, logical, point } of SHARED_BOARD_GAMES) {
    test(`${slug} accepts a tap in the far half of the device`, async ({ page }) => {
      await page.goto(`/play/${slug}/`);
      await page.getByRole('button', { name: 'Play together here' }).click();
      await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
        timeout: 10_000,
      });

      const box = await page.locator('canvas').boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('no canvas');
      const scale = Math.min(box.width / logical, box.height / logical);
      const originX = box.x + (box.width - logical * scale) / 2;
      const originY = box.y + (box.height - logical * scale) / 2;
      const target = { x: originX + point.x * scale, y: originY + point.y * scale };

      // The point really is in the far half of the *device*, which is what makes the tap
      // meaningful — otherwise this test would pass on the broken build too.
      expect(target.y, 'the target must sit above the seat midline').toBeLessThan(
        box.y + box.height / 2,
      );

      const hud = page.getByRole('group', { name: 'Score' });
      // Before the tap it is p1's turn. Asserting only "somebody's turn" was the first
      // version of this and it passed on the broken build too, because that sentence is
      // already on the page — the same vacuous-assertion trap this file exists to record.
      // Score-agnostic, because not every game starts level — Reversi opens two apiece.
      await expect(hud).toContainText(/Pip has \d+ points?, and it is their turn/);

      await page.mouse.click(target.x, target.y);

      // The turn passing to the *other* seat is the proof the tap was accepted.
      await expect(hud).toContainText(/Player two has \d+ points?, and it is their turn/);
    });
  }

  test('a real-time shared board still divides its touches by seat', async ({ page }) => {
    // The other half of the rule: Whack a Mole is a shared board too, but both seats
    // swing at it at once, so it needs its zones exactly as much as Tic Tac Toe needed
    // to lose them. A game with no turns must keep them.
    await page.goto('/play/whack-a-mole/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    // No turn indicator at all is the observable difference, and it is what the host
    // keys the decision on.
    await expect(page.getByRole('group', { name: 'Score' })).not.toContainText(
      'and it is their turn',
    );
  });
});

test.describe('a quick tap, in every game that takes one', () => {
  /**
   * Most touchscreen taps put their press and their release on the same simulation step.
   *
   * A game that arms on the press and waits for a *later* step to see the release
   * therefore does nothing at all unless the player holds on long enough to straddle two
   * steps. Tic Tac Toe was fixed for this once; Drop Four still had it, and shipped with
   * it, because the tap test only ever covered Tic Tac Toe.
   *
   * Each entry names a point where a single tap is a complete move for the first player.
   */
  const ONE_TAP_GAMES = [
    { slug: 'tic-tac-toe', logical: 900, point: { x: 450, y: 670 } },
    { slug: 'four-in-a-row', logical: 900, point: { x: 450, y: 620 } },
    { slug: 'color-wars', logical: 900, point: { x: 450, y: 450 } },
    { slug: 'pop-it', logical: 900, point: { x: 450, y: 450 } },
    { slug: 'reversi', logical: 900, point: { x: 405, y: 315 } },
    { slug: 'dots-and-boxes', logical: 900, point: { x: 300, y: 200 } },
  ];

  for (const { slug, logical, point } of ONE_TAP_GAMES) {
    test(`${slug} moves on a quick tap, not only on a hold`, async ({ page }) => {
      await page.goto(`/play/${slug}/`);
      await page.getByRole('button', { name: 'Play together here' }).click();
      await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
        timeout: 10_000,
      });

      const box = await page.locator('canvas').boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('no canvas');
      const scale = Math.min(box.width / logical, box.height / logical);
      const originX = box.x + (box.width - logical * scale) / 2;
      const originY = box.y + (box.height - logical * scale) / 2;

      // A click, not a hold: Playwright presses and releases with no wait between.
      await page.mouse.click(originX + point.x * scale, originY + point.y * scale);
      await expect(page.getByRole('group', { name: 'Score' })).toContainText(
        /Player two has \d+ points?, and it is their turn/,
        { timeout: 3000 },
      );
    });
  }
});

test.describe('aiming still works through the precision envelope', () => {
  /**
   * Pointer positions are rounded onto a shared lattice so no input family can aim finer
   * than another. It has to level the two aiming games without flattening them — a
   * deliberate drag must still land a throw.
   */
  const AIMING_GAMES = [
    { slug: 'darts', logical: { w: 700, h: 1000 } },
    { slug: 'cornhole', logical: { w: 900, h: 900 } },
  ];

  for (const { slug, logical } of AIMING_GAMES) {
    test(`${slug} takes a deliberate aim and throw`, async ({ page }) => {
      await page.goto(`/play/${slug}/`);
      await page.getByRole('button', { name: 'Play together here' }).click();
      await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
        timeout: 10_000,
      });

      const hud = page.getByRole('group', { name: 'Score' });
      const before = await hud.innerText();

      const box = await page.locator('canvas').boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('no canvas');
      const scale = Math.min(box.width / logical.w, box.height / logical.h);
      const originX = box.x + (box.width - logical.w * scale) / 2;
      const originY = box.y + (box.height - logical.h * scale) / 2;

      // Down, drag, up — with dwell at each end, as a real hand has.
      await page.mouse.move(originX + logical.w * 0.5 * scale, originY + logical.h * 0.72 * scale);
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.move(
        originX + logical.w * 0.54 * scale,
        originY + logical.h * 0.86 * scale,
        { steps: 14 },
      );
      await page.waitForTimeout(200);
      await page.mouse.up();

      // Something happened: either the score moved or the turn did.
      await expect(async () => {
        expect(await hud.innerText()).not.toBe(before);
      }).toPass({ timeout: 4000 });
    });
  }
});

test.describe('the browser own gestures', () => {
  /**
   * Pull-to-refresh throws away a match, and it does not need the canvas to do it.
   *
   * The canvas declares `overscroll-behavior: contain`, but that only covers a gesture
   * that *starts on the canvas*. A match letterboxes, so on a phone there is page either
   * side of the board — a swipe down starting there reaches the document, and
   * `touch-action` on the canvas cannot help because the finger never touched it.
   */
  test('a live match refuses pull-to-refresh; the rest of the site does not', async ({ page }) => {
    await page.goto('/games/');
    const catalogue = await page.evaluate(
      () => getComputedStyle(document.documentElement).overscrollBehaviorY,
    );
    expect(catalogue, 'the catalogue keeps its ordinary gestures').not.toBe('none');

    await page.goto('/play/tic-tac-toe/');
    const lobby = await page.evaluate(
      () => getComputedStyle(document.documentElement).overscrollBehaviorY,
    );
    expect(lobby, 'a lobby can still be refreshed the ordinary way').not.toBe('none');

    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    const live = await page.evaluate(
      () => getComputedStyle(document.documentElement).overscrollBehaviorY,
    );
    expect(live, 'a running match refuses it').toBe('none');
  });

  test('the canvas refuses scroll, zoom and selection', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    const style = await page.locator('canvas').evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        touchAction: computed.touchAction,
        // Safari reports this only under the prefix, which is also the only spelling it
        // honours — hence both in the stylesheet, and both read here. The type says
        // `userSelect` is always a string; WebKit disagrees at runtime, so read both and
        // accept either rather than trusting the declaration.
        userSelect: computed.getPropertyValue('user-select'),
        webkitUserSelect: computed.getPropertyValue('-webkit-user-select'),
        overscroll: computed.overscrollBehaviorY,
      };
    });
    expect(style.touchAction, 'no scroll, pan or double-tap zoom').toBe('none');
    expect(
      style.userSelect === 'none' || style.webkitUserSelect === 'none',
      `a drag does not select the page (user-select ${style.userSelect || 'unset'}, prefixed ${style.webkitUserSelect || 'unset'})`,
    ).toBe(true);
    expect(style.overscroll).not.toBe('auto');
  });
});
