import { expect, test } from '@playwright/test';

/**
 * The pre-match choices, in a real browser: how hard the bot tries, and how long a match is.
 *
 * Both were built and shipped switched off (#2485). Every game implements three tiers and
 * `bot-parity.test.ts` proves per game that the tier reaches the simulation — but the shell
 * hardcoded `normal`, so `easy` and `hard` were reachable only from tests. The SDK
 * implements best-of and `match.test.ts` covers it — but the shell hardcoded one round, so
 * `round-over` was unreachable, and with it the round pips, the "Next round" screen and the
 * opening-seat rotation of #2466.
 *
 * Which is why the important test here is not that a radio can be clicked. It is that a
 * **hard bot plays a visibly harder match than an easy one** — the assertion that fails if
 * the control is wired to nothing, which is the state the product was already in.
 */

/** A bot game whose tiers are far enough apart to be timed in a browser. See below. */
const GAME = '/play/crash-it/';

const countdown = /^[0-9]$|^Go$/;

test.describe('choosing how hard the bot plays', () => {
  test('offers three tiers, on normal, wherever there is a bot to play', async ({ page }) => {
    await page.goto(GAME);
    await expect(page.getByRole('radio', { name: /Easy/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Normal/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /Hard/ })).not.toBeChecked();

    // Named in words and counted in pips, so which tier is chosen survives greyscale and
    // a player who cannot separate the tint from the paper (CLAUDE.md rule 7).
    const group = page.getByRole('group', { name: /skill/i });
    await expect(group).toContainText('Easy');
    await expect(group).toContainText('Normal');
    await expect(group).toContainText('Hard');
  });

  test('offers it on the solo puzzles too, because they carry a bot as well', async ({ page }) => {
    /**
     * The control is conditional on the manifest offering `bot`, and today every playable
     * manifest does — including the seven the catalogue lists as solo puzzles, which each
     * declare `friend` and `bot` besides, deliberately: "a solo-only manifest is a game
     * page nobody can start". So there is no page in the product where the tier is hidden,
     * and this asserts the condition as it actually resolves rather than pretending
     * otherwise. A future solo-only game is what the condition is there for.
     */
    await page.goto('/play/sudoku/');
    await expect(page.getByRole('radio', { name: /Normal/ })).toBeChecked();
    await expect(page.getByRole('group', { name: /Match length/i })).toBeVisible();
  });

  test('is operable from the keyboard, and big enough for a thumb', async ({ page }) => {
    await page.goto(GAME);
    const easy = page.getByRole('radio', { name: /Easy/ });
    const hard = page.getByRole('radio', { name: /Hard/ });

    // Arrow keys move within a radio group, which is the whole reason these are radios
    // rather than a row of buttons that merely looks like one.
    await easy.press('ArrowRight');
    await expect(page.getByRole('radio', { name: /Normal/ })).toBeChecked();
    await page.getByRole('radio', { name: /Normal/ }).press('ArrowRight');
    await expect(hard).toBeChecked();

    // The target is the whole option, not the 19px dot inside it.
    const target = page.getByText('Hard', { exact: true });
    const box = await target.locator('..').boundingBox();
    expect(
      box?.height ?? 0,
      'a tier is at least one --db-touch-target tall',
    ).toBeGreaterThanOrEqual(48);
  });

  test('remembers the tier for this game, across a reload', async ({ page }) => {
    await page.goto(GAME);
    await page.getByRole('radio', { name: /Hard/ }).check();
    await page.reload();
    await expect(page.getByRole('radio', { name: /Hard/ })).toBeChecked();

    // Per game, like the mode: a hard bot at darts says nothing about a hard bot at chess.
    await page.goto('/play/tic-tac-toe/');
    await expect(page.getByRole('radio', { name: /Normal/ })).toBeChecked();
  });

  /**
   * The assertion that would have caught the defect.
   *
   * Crash It is used because its tiers are far apart and its matches are short. Measured
   * over the seed the first match of a page load always uses, with nobody touching the
   * human seat: **hard decides the round in 7.8 s and easy in 30.4 s**, and the nearest
   * neighbouring seeds put hard at 8–10 s and easy at 17–41 s. The margins below sit in
   * the gap, and the two runs differ in nothing but the tier — same game, same page load
   * sequence, same seed, no input in either.
   */
  test('a hard bot settles the round while an easy one is still trying', async ({ page }) => {
    await page.goto(GAME);
    await page.getByRole('radio', { name: /Easy/ }).check();
    await page.getByRole('button', { name: /Play against/ }).click();
    await expect(page.getByRole('status').filter({ hasText: countdown })).toBeHidden({
      timeout: 10_000,
    });
    await page.waitForTimeout(12_000);
    await expect(
      page.getByRole('button', { name: 'Next round' }),
      'an easy bot has not won a round twelve seconds in',
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pause the match' })).toBeVisible();

    await page.goto(GAME);
    await page.getByRole('radio', { name: /Hard/ }).check();
    await page.getByRole('button', { name: /Play against/ }).click();
    await expect(
      page.getByRole('button', { name: 'Next round' }),
      'and a hard bot has — same game, same seed, nothing changed but the tier',
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('the length of a match', () => {
  test('reaches a round result and plays on, which one round never could', async ({ page }) => {
    await page.goto(GAME);
    await page.getByRole('radio', { name: /Hard/ }).check();
    await expect(page.getByRole('radio', { name: 'Best of 3' })).toBeChecked();
    await page.getByRole('button', { name: /Play against/ }).click();

    // `round-over`: the phase no player could reach while the shell asked for one round.
    const nextRound = page.getByRole('button', { name: 'Next round' });
    await expect(nextRound).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText(/first to 2 takes it/)).toBeVisible();

    await nextRound.click();
    // And round two is a real round: it counts in, and the HUD says which one it is.
    await expect(page.getByRole('status').filter({ hasText: countdown })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Score' })).toContainText('Round 2 of 3');
  });

  test('a single round still ends the match outright', async ({ page }) => {
    await page.goto(GAME);
    await page.getByRole('radio', { name: /Hard/ }).check();
    await page.getByRole('radio', { name: '1 round' }).check();
    await page.getByRole('button', { name: /Play against/ }).click();

    await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: 'Next round' })).toHaveCount(0);
  });

  test('remembers the length across a reload, like every other choice', async ({ page }) => {
    await page.goto(GAME);
    await page.getByRole('radio', { name: 'Best of 5' }).check();
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Best of 5' })).toBeChecked();
  });
});
