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
