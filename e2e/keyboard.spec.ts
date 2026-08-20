import { expect, test } from '@playwright/test';

/**
 * The keyboard as a first-class control.
 *
 * Two people sharing a laptop have one keyboard and no touchscreen, so the keyboard is
 * the whole desktop experience of a two-player site rather than a fallback.
 */
test.describe('the keyboard', () => {
  test('shows both players their controls before the match', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await expect(page.getByText('Controls')).toBeVisible();
    await expect(page.getByText(/Space or Enter to place your mark/)).toBeVisible();
  });

  test('shows them again from the pause menu, without quitting', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await page.getByRole('button', { name: 'Pause the match' }).click();
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused.getByText(/Space or Enter to place your mark/)).toBeVisible();
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
    await expect(controls).toContainText('Pip');
    await expect(controls).toContainText('Bo');
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
    await expect(paused).toContainText('Pip');
    await expect(paused).toContainText('Bo');
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

    // Both seats hold a diagonal at once, which is four keys plus two actions.
    for (const key of ['KeyW', 'KeyD', 'ArrowUp', 'ArrowLeft']) await page.keyboard.down(key);
    await page.waitForTimeout(700);
    for (const key of ['KeyW', 'KeyD', 'ArrowUp', 'ArrowLeft']) await page.keyboard.up(key);

    // Both crabs moved, which is only possible if both halves were heard together.
    const moved = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
    expect(moved).toBe(true);
    // Escape still reaches the pause menu after all that.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  });
});
