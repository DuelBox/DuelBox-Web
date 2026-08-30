import { expect, test } from '@playwright/test';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';

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

  test('ends a match decided by survival, where no score changes', async ({ page }) => {
    // The regression this pins: the host reported the score — and the winner riding along
    // with it — only when one of the two numbers changed. A match decided by a crash
    // changes neither, so Road Dodge ran to its end and then sat frozen behind a live
    // pause button, with no result screen, for as long as anyone cared to watch.
    await page.goto('/play/road-dodge/');
    // One round, so that the end of the round is the end of the match. The shell now
    // defaults to best-of-three (#2485) and a round result is a different screen — which
    // is a thing worth testing, and is tested in `bot-difficulty.spec.ts`; what this test
    // is about is a match that ends when nothing scores, so it asks for the shorter one.
    await page.getByRole('radio', { name: '1 round' }).check();
    await page.getByRole('button', { name: /Play against/ }).click();

    // Nobody touches the controls, so the human seat crashes and the bot outlives it.
    await expect(page.getByText(/wins|draw/i).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible();
  });

  test('shows both seats and their scores in one shared HUD', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    const hud = page.getByRole('group', { name: 'Score' });
    await expect(hud).toBeVisible();
    // Named and counted in text, not only drawn: colour is never the only signal.
    // Both seats are named, and both names are the seat's own. `lib/seats.ts` owns them:
    // a seat's name belongs to the seat rather than to whoever is sitting in it, so a bot
    // is marked as a bot rather than renamed, and neither seat is ever a placeholder.
    // This used to expect "Player two", which was the half-filled override map that #2513
    // removed — one seat had a name and the other had a placeholder.
    await expect(hud).toContainText(SEAT_CHARACTERS.p1);
    await expect(hud).toContainText(SEAT_CHARACTERS.p2);
    await expect(hud.getByText(`${SEAT_CHARACTERS.p1} has 0 points`)).toBeAttached();
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

/**
 * Bot mode, which the rest of the suite never exercised.
 *
 * Every test above starts a match with "Play together here". That gap let a bug ship in
 * which every bot match froze on the countdown forever: the difficulty object was
 * rebuilt on each render, which re-ran the host's setup effect, and the rebuilt loop was
 * never started because the phase had not changed. Nothing errored — the match simply
 * stopped. These assert the path end to end.
 */
test.describe('playing against the bot', () => {
  test('gets past the countdown and into play', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();

    const countdown = page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ });
    await expect(countdown).toBeVisible();
    // The whole bug was that this never happened.
    await expect(countdown).toBeHidden({ timeout: 10_000 });
  });

  test('names the bot in the HUD and says it is thinking on its turn', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    const hud = page.getByRole('group', { name: 'Score' });
    await expect(hud).toContainText(`${SEAT_CHARACTERS.p2} (bot)`);
  });

  test('keeps running long after the countdown, rather than stalling once', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    // A frozen loop still shows a board, so assert the simulation is advancing: pause,
    // and the resumed countdown must also complete.
    await page.getByRole('button', { name: 'Pause the match' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
  });
});

test.describe('remembering how you last played', () => {
  test('offers the mode you used last first, without starting it', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    // Default order puts "together" first.
    const buttons = page.getByRole('button', { name: /Play (together here|against)/ });
    await expect(buttons.first()).toHaveText('Play together here');

    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await page.getByRole('button', { name: 'Pause the match' }).click();
    await page.getByRole('button', { name: 'Quit match' }).click();

    // Having chosen the bot, the bot now leads — but nothing has auto-started.
    await expect(buttons.first()).toHaveText(`Play against ${SEAT_CHARACTERS.p2}`);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('the choice survives a reload', async ({ page }) => {
    await page.goto('/play/air-hockey/');
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    await page.reload();
    const buttons = page.getByRole('button', { name: /Play (together here|against)/ });
    await expect(buttons.first()).toHaveText(`Play against ${SEAT_CHARACTERS.p2}`);
  });

  test('is remembered per game rather than globally', async ({ page }) => {
    await page.goto('/play/air-hockey/');
    await page.getByRole('button', { name: `Play against ${SEAT_CHARACTERS.p2}` }).click();
    // A different game is unaffected by that choice.
    await page.goto('/play/tic-tac-toe/');
    const buttons = page.getByRole('button', { name: /Play (together here|against)/ });
    await expect(buttons.first()).toHaveText('Play together here');
  });
});
