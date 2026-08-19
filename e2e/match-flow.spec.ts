import { expect, test } from '@playwright/test';

/**
 * The shared match flow, exercised in a real browser against the built static files.
 *
 * The state machine is unit-tested exhaustively; what these cover is the wiring — that
 * the countdown really gates play, that Escape really reaches the shell rather than the
 * game, and that the HUD is readable to a screen reader rather than only to an eye.
 */
test.describe('the match flow', () => {
  test('counts in before the board is live, then hands over to play', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    // The count is announced assertively: both players are waiting on this number.
    const countdown = page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ });
    await expect(countdown).toBeVisible();

    // And it goes away on its own, without anyone touching anything.
    await expect(countdown).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('shows both seats and their scores in one shared HUD', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    const hud = page.getByRole('group', { name: 'Score' });
    await expect(hud).toBeVisible();
    // Named and counted in text, not only drawn: colour is never the only signal.
    await expect(hud).toContainText('Pip');
    await expect(hud).toContainText('Player two');
    await expect(hud.getByText('Pip has 0 points')).toBeAttached();
  });

  test('pauses on Escape and resumes with a fresh count-in', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    // Let the opening countdown finish so the pause is a pause, not a countdown skip.
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
    await page.waitForTimeout(3500);

    await page.keyboard.press('Escape');
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await expect(paused).toContainText('The board is exactly where you left it.');

    await paused.getByRole('button', { name: 'Resume' }).click();
    await expect(paused).toBeHidden();
    // Resuming re-counts rather than dropping straight back into a moving board.
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeVisible();
  });

  test('pauses from the HUD button too, for a player with no keyboard', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await page.getByRole('button', { name: 'Pause the match' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  });

  test('quitting a paused match returns to the mode choice', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await page.getByRole('button', { name: 'Pause the match' }).click();
    await page.getByRole('button', { name: 'Quit match' }).click();
    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
  });

  test('the pause menu is reachable and operable from the keyboard alone', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await page.keyboard.press('Escape');
    // Resume takes focus when the dialog opens, so a keyboard player is never stranded.
    await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
  });
});
