import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The head-to-head record (#160, #162) and the names beside it (#161), in a real browser.
 *
 * The store is unit-tested in `apps/web/src/lib/head-to-head.test.ts`, including the rule
 * that one call is one match. What a browser can show that a unit test cannot is the
 * wiring: that a match played to its end really reaches the store, that it is still there
 * after a reload, that a second match adds one rather than two — the double count is the
 * defect this whole path is shaped to avoid — and that the settings page can read it back
 * and empty it.
 *
 * Crash It, hard, one round, is how this suite already drives a match to completion:
 * `bot-difficulty.spec.ts` measures a hard bot settling the round in about eight seconds
 * and gives it twenty-five, so a match here costs the same and nobody has to touch a
 * control to reach the result screen.
 */
const GAME = '/play/crash-it/';

/**
 * Two matches in one test is 50 seconds of authorised waiting, and the suite's ceiling is
 * 60 (`playwright.config.ts`). The two waits are not independent: `packages/engine/src/loop.ts`
 * caps the loop at five steps a frame and drops the rest, so a loaded runner — two workers,
 * four projects, two of them real WebKit — stretches the wall clock of both matches at once,
 * and the run then dies on a timeout with no assertion message rather than failing usefully.
 * Raised for the same reason `lifecycle.spec.ts` raises its own, and to more than the sum of
 * the waits the file authorises.
 */
test.describe.configure({ timeout: 120_000 });

/** Plays one match to its end, leaving the result screen on the page. */
async function playToTheEnd(page: Page): Promise<void> {
  await page.goto(GAME);
  await page.getByRole('radio', { name: /Hard/ }).check();
  await page.getByRole('radio', { name: '1 round' }).check();
  await page.getByRole('button', { name: /Play against/ }).click();
  await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 25_000 });
}

/** The record line, as the number of matches it accounts for. */
async function matchesOnScreen(page: Page): Promise<number> {
  const line = page.getByText(/^All time in /);
  await expect(line).toBeVisible();
  const text = await line.innerText();
  // Only the part after the colon, so a game whose name held a digit could not be counted
  // as a win. Every number in it is a count of matches — wins, wins, and draws — so their
  // sum is how many matches the record accounts for.
  const tail = text.slice(text.indexOf(':') + 1);
  return [...tail.matchAll(/\d+/g)].reduce((sum, match) => sum + Number(match[0]), 0);
}

test.describe('the head-to-head record', () => {
  test('outlives the tab that made it, and counts each match once', async ({ page }) => {
    await playToTheEnd(page);
    expect(await matchesOnScreen(page), 'one finished match is one on the record').toBe(1);

    // The match was against the bot, so it belongs on the bot's map and not on the record
    // the two seats keep of each other. Ten losses to the hard bot used to come back on the
    // next friend match's result screen as ten wins for the person in the far seat.
    const record = await page.evaluate(() =>
      globalThis.localStorage.getItem('duelbox:head-to-head'),
    );
    expect(JSON.parse(record ?? 'null')).toMatchObject({
      games: {},
      bots: { 'crash-it': { p1: 0, p2: 1, draws: 0 } },
    });

    // A reload is the whole point: the tally used to live in React state and die here.
    await page.reload();
    await playToTheEnd(page);
    expect(
      await matchesOnScreen(page),
      'the second match adds one to the first, rather than starting again or counting twice',
    ).toBe(2);
  });

  test('is shown on the settings page, and can be cleared from there', async ({ page }) => {
    await playToTheEnd(page);

    await page.goto('/settings/');
    const matches = page.locator('dl div', { hasText: 'Matches recorded' }).locator('dd');
    await expect(matches).toHaveText('1');
    // And the game itself is listed, which is the per-game half of it (#162). The slug is
    // what the page has to work with, turned back into words: the catalogue's display
    // names are deliberately not in the settings page's bundle.
    await expect(page.getByText('crash it', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Clear the record' }).click();
    await expect(matches).toHaveText('0');
    await expect(page.getByRole('status')).toContainText('cleared');

    // Cleared from storage, not merely from the page.
    await page.reload();
    await expect(page.locator('dl div', { hasText: 'Matches recorded' }).locator('dd')).toHaveText(
      '0',
    );
  });
});

test.describe('the names the two of you choose', () => {
  test('replace the seat name on the scoreboard, and are kept', async ({ page }) => {
    await page.goto('/settings/');
    await page.getByLabel('Name for the near seat').fill('Ada');
    await page.reload();
    await expect(page.getByLabel('Name for the near seat')).toHaveValue('Ada');

    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('group', { name: 'Score' })).toContainText('Ada');

    // Cleared back to the seat's own name by emptying the field, rather than by an
    // undo somewhere else.
    await page.goto('/settings/');
    await page.getByLabel('Name for the near seat').fill('');
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('group', { name: 'Score' })).not.toContainText('Ada');
  });
});
