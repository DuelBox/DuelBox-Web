import { expect, test, type Page } from '@playwright/test';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';

/**
 * One person, one seat, a score to beat (#1750).
 *
 * Six games declared `solo` and nothing in the shell could start one, so their pages
 * advertised a mode their lobby did not have. This is the mode, from the outside: the button
 * exists only where the manifest asked for it, the scoreboard has one seat on it, the far
 * seat is never named, and a finished run leaves a best behind that the next visit shows.
 *
 * The run that finishes is Solitaire's, and it finishes by being left alone: a solo player who
 * lets the turn clock run out has let go of the deal, and with one player one pass ends it.
 * Twenty-odd seconds is the price of a real ending rather than a synthesised one, and
 * `record.spec.ts` already pays twenty-five for a bot match on the same argument.
 */

const SOLO_GAME = '/play/solitaire/';
const TWO_SEAT_GAME = '/play/chess/';

async function startSolo(page: Page, path = SOLO_GAME) {
  await page.goto(path);
  await page.getByRole('button', { name: 'Play solo' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

test.describe('a solo run', () => {
  test('is offered only where the manifest asked for it', async ({ page }) => {
    await page.goto(SOLO_GAME);
    await expect(page.getByRole('button', { name: 'Play solo' })).toBeVisible();
    await page.goto(TWO_SEAT_GAME);
    await expect(page.getByRole('button', { name: 'Play solo' })).toBeHidden();
    // And never as a tournament: a line-up needs two seats, whatever the game declares.
    await page.goto(SOLO_GAME);
    await expect(page.getByRole('button', { name: /Tournament/ })).toHaveCount(2);
  });

  test('seats one player, upright, and names nobody opposite', async ({ page }) => {
    await startSolo(page);
    const score = page.getByRole('group', { name: 'Score' });
    await expect(score).toBeVisible();
    await expect(score.locator('[data-seat="p1"]')).toBeVisible();
    await expect(score.locator('[data-seat="p2"]')).toHaveCount(0);
    await expect(score).toContainText('solo');
    await expect(score).not.toContainText(SEAT_CHARACTERS.p2);
    // Single-seat presentation: the far copy of the scoreboard is not drawn either, so the
    // page has exactly one thing called Score and it is the right way up.
    await expect(page.getByRole('group', { name: 'Score' })).toHaveCount(1);
  });

  test('ends on its own terms with a score, not a winner, and remembers the best', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await startSolo(page);
    // Left alone: the turn clock runs out, the player has let go, and one pass ends a solo
    // deal. The result names no seat.
    const result = page.getByRole('button', { name: 'Go again' });
    await expect(result).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/^Score \d+$/)).toBeVisible();
    await expect(page.getByText('A new best on this device.')).toBeVisible();
    await expect(page.getByText(/wins|A draw/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rematch/ })).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem('duelbox:best-scores'));
    expect(stored).toContain('"solitaire"');

    // The next run is measured against it: the same score again is not a new best.
    await result.click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Go again' })).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText(/^Best on this device: \d+\.$/)).toBeVisible();
  });
});
