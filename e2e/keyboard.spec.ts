import { expect, test } from '@playwright/test';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';
import { seatCentroids } from './seat-pixels.js';

/**
 * The keyboard as a first-class control.
 *
 * Two people sharing a laptop have one keyboard and no touchscreen, so the keyboard is
 * the whole desktop experience of a two-player site rather than a fallback.
 */
test.describe('the keyboard', () => {
  // These used to assert the literal words "Space or Enter to place your mark", which is
  // how the manifest read — and that reading was false. The keyboard halves are fixed to
  // seats and nothing remaps them, so "or" told the second player to press keys that do
  // nothing on their opponent's turn. What matters is that the page tells each player
  // which keys are theirs, so that is what is asserted now.
  test('shows both players their controls before the match', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await expect(page.getByText('Controls')).toBeVisible();
    // The shell already shows a per-seat <kbd> legend; the game's own line must agree
    // with it rather than contradict it, which is what "or" used to do.
    await expect(page.getByText(/Player one W A S D then Space, player two arrows/)).toBeVisible();
  });

  test('shows them again from the pause menu, without quitting', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await page.getByRole('button', { name: 'Pause the match' }).click();
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused.getByText(/player one/i)).toBeVisible();
    await expect(paused.getByText(/player two/i)).toBeVisible();
  });

  test("seat two's action key plays rather than activating a button", async ({ page }) => {
    // Enter is seat two's action. With focus left on the pause button it activated the
    // button instead — pressing your own action key opened the pause menu, which made
    // seat two unplayable on a keyboard. Seat one's Space escaped only because the host
    // suppresses its default to stop the page scrolling, which is luck, not design.
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
  });

  test('the board holds focus while a match is live', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(tag).toBe('CANVAS');
  });

  /**
   * The pause menu is the product's only modal, and it is raised mid-match on a device two
   * people are sharing. It declares `aria-modal="true"` — assistive technology is told the
   * rest of the page does not exist — so Tab must not be able to walk out of it into a page
   * that has just been declared inert.
   */
  test('Tab cannot walk out of the pause menu', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Pause the match' }).click();
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();

    // More presses than there are stops, in both directions: a trap that only survives one
    // lap is not a trap, and Shift+Tab off the first control is the way out that gets
    // forgotten.
    const stops = await paused.locator('a[href], button:not([disabled])').count();
    expect(stops, 'the panel has controls to cycle through').toBeGreaterThan(1);

    const inDialog = () =>
      page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const active = document.activeElement;
        return dialog !== null && active !== null && dialog.contains(active);
      });

    for (let press = 1; press <= stops + 3; press += 1) {
      await page.keyboard.press('Tab');
      expect(await inDialog(), `Tab ${String(press)} left the panel`).toBe(true);
    }
    for (let press = 1; press <= stops + 3; press += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await inDialog(), `Shift+Tab ${String(press)} left the panel`).toBe(true);
    }
  });

  /**
   * Closing the menu used to drop focus on `<body>`, which loses a keyboard player their
   * place entirely.
   *
   * Resuming hands it back to the board rather than to the pause button that opened it,
   * and deliberately: the HUD stops rendering that button the moment the match pauses, so
   * there is no such node to return to, and a live match belongs to the board anyway —
   * which is where the host puts focus on every return to play.
   */
  test('closing the pause menu hands focus back to the board', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Pause the match' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'none'))
      .toBe('CANVAS');
    // And the pause button is back where a player left it.
    await expect(page.getByRole('button', { name: 'Pause the match' })).toBeVisible();
  });

  test('quitting from the pause menu hands focus to the lobby, never to the body', async ({
    page,
  }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Pause the match' }).click();
    await page.getByRole('button', { name: 'Quit match' }).click();

    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
    // A control of the lobby that replaced the match, rather than the body. Which control
    // is deliberately not asserted: the lobby grew a set of options while this was being
    // written, and "focus is somewhere a keyboard can carry on from" is the property that
    // matters, not which of them happens to come first.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return 'none';
          const inMain = active.closest('main') !== null;
          return `${active.tagName}|${inMain ? 'in-main' : 'elsewhere'}`;
        }),
      )
      .toMatch(/^(BUTTON|INPUT|A|CANVAS)\|in-main$/);
  });

  test('Escape still reaches the pause menu, and is never swallowed', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  });
});

test.describe('both players can see which keys are theirs', () => {
  /**
   * "W A S D or the arrow keys" tells a player what the game accepts, not what is theirs.
   * Two strangers sitting down at one laptop need the second thing far more than the
   * first — and the answer has to be available *during* a match, not only before it.
   */
  test('the lobby names each seat and its keys', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    const controls = page.getByText('Controls').locator('..');
    await expect(controls).toContainText(SEAT_CHARACTERS.p1);
    await expect(controls).toContainText(SEAT_CHARACTERS.p2);
    await expect(controls).toContainText('W A S D');
    await expect(controls).toContainText('Space');
    await expect(controls).toContainText('Enter');
  });

  test('the pause menu names them again, mid-match', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await page.keyboard.press('Escape');
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await expect(paused, 'a player who has forgotten their keys can find them').toContainText(
      'W A S D',
    );
    await expect(paused).toContainText(SEAT_CHARACTERS.p1);
    await expect(paused).toContainText(SEAT_CHARACTERS.p2);
  });

  test('the two halves register at the same time', async ({ page }) => {
    // The acceptance criterion: both players holding a direction and pressing their own
    // action key, with nothing dropped. Three physical keyboards is a human's job; that
    // the software path handles it is this test's.
    await page.goto('/play/king-of-the-yard/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const start = await seatCentroids(page);
    expect(start.p1, 'seat one is on the yard to begin with').not.toBeNull();
    expect(start.p2, 'seat two is on the yard to begin with').not.toBeNull();

    // Both seats hold a direction at once, and deliberately opposite ones. Holding the
    // same direction would let a build where both seats secretly read one key half still
    // look right: both bodies would move, just together.
    const HELD = ['KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft'];
    for (const key of HELD) await page.keyboard.down(key);
    await page.waitForTimeout(700);
    for (const key of HELD) await page.keyboard.up(key);

    // "Both crabs moved" used to be asserted as "a canvas exists", which passes with the
    // whole input system deleted. Read where the two bodies actually are instead.
    const after = await seatCentroids(page);
    expect(
      (after.p1?.y ?? 0) - (start.p1?.y ?? 0),
      'S took seat one down the yard',
    ).toBeGreaterThan(6);
    expect(
      (after.p2?.y ?? 0) - (start.p2?.y ?? 0),
      'the up arrow took seat two the other way in the same span',
    ).toBeLessThan(-6);
    // Escape still reaches the pause menu after all that.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  });
});
