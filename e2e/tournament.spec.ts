import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Tournament mode in a real browser (#156, #157, #158, #159).
 *
 * The machine is unit-tested exhaustively in `apps/web/src/lib/tournament.test.ts` and the
 * store in `tournament-store.test.ts`. What only a browser can show is the wiring, and for
 * this feature the wiring *is* the feature: a tournament spans seven URLs, so every advance
 * through one is a page load, and the acceptance criterion of #157 — progress survives a
 * reload — is a claim about what happens between two pages rather than inside one.
 *
 * ## One engine
 *
 * `playwright.config.ts` lists this in `CHROMIUM_ONLY`, on the same argument the axe scan
 * makes. What is under test is a state machine, a `localStorage` document and the markup
 * drawn from them; none of the three is a thing engines differ about. The parts that do
 * differ — the canvas, the loop, the page lifecycle — are exercised on all four projects by
 * `record.spec.ts` and `match-flow.spec.ts`, which play matches to their end for exactly
 * that reason. Running two full bot matches on four projects to re-confirm one document
 * would cost the verify job more than the whole of `CONTENT_ONLY` saves it.
 */

const TOURNAMENT_KEY = 'duelbox:tournament';

/** The stored document, as JSON text, or null if there is none. */
function storedText(page: Page): Promise<string | null> {
  return page.evaluate((key) => globalThis.localStorage.getItem(key), TOURNAMENT_KEY);
}

/** The line-up in storage. */
async function storedGames(page: Page): Promise<string[]> {
  const parsed = JSON.parse((await storedText(page)) ?? 'null') as { games?: string[] } | null;
  return parsed?.games ?? [];
}

const track = (page: Page) => page.getByRole('group', { name: 'Tournament' });

test.describe('starting a tournament', () => {
  test('draws seven games with no repeat, and keeps them across a reload', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Tournament together' }).click();

    // The track is the whole of #158: where you are, what is done, what is to come.
    await expect(track(page)).toContainText('Game 1 of 7');
    await expect(track(page).getByRole('listitem')).toHaveCount(7);

    // #159's acceptance criterion, read off the document the tournament actually runs on
    // rather than off the marks drawn from it.
    const games = await storedGames(page);
    expect(games, 'seven games are drawn').toHaveLength(7);
    expect(new Set(games).size, 'and no game is drawn twice').toBe(7);
    expect(games[0], 'the first leg is the game it was started from').toBe('tic-tac-toe');

    // The ordinary lobby stands down on the leg the tournament is waiting on: there is one
    // thing to press, and it is the next game.
    await expect(page.getByRole('button', { name: 'Play game 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play together here' })).toHaveCount(0);

    await page.reload();
    await expect(track(page)).toContainText('Game 1 of 7');
    expect(await storedGames(page)).toEqual(games);
  });

  test('offers both ways to play it, and marks the bot in the score line', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    // The reference app's two entry buttons: player against player, player against the bot.
    await page.getByRole('button', { name: /^Tournament against / }).click();
    // A bot in a seat is marked rather than renamed, so the tournament's score line says
    // whose wins these are — `lib/seats.ts` owns that and this asserts it survives the trip
    // through a tournament that chose the opponent before any match started.
    await expect(track(page)).toContainText('(bot)');
  });

  test('gives its controls a thumb-sized target and a name', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Tournament together' }).click();

    const token = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--db-touch-target'),
      ),
    );
    expect(token).toBeGreaterThan(0);
    for (const name of ['Play game 1', 'Leave the tournament']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.height ?? 0, `${name} is at least one touch target tall`).toBeGreaterThanOrEqual(
        token,
      );
    }
  });

  test('can be left in one press, and leaves nothing behind', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Tournament together' }).click();
    await expect(track(page)).toBeVisible();

    await page.getByRole('button', { name: 'Leave the tournament' }).click();
    await expect(track(page)).toHaveCount(0);
    // Gone from storage rather than only from the page, or it would come back on reload.
    expect(await storedText(page)).toBeNull();
    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
  });
});

/**
 * A tournament played to its end.
 *
 * Two legs rather than seven, and the length is the one thing here that is arranged rather
 * than played: a seven-game tournament against a bot is several minutes of authorised
 * waiting, and the suite's ceiling is sixty seconds a test. The store reads a line-up of any
 * length — every rule in the machine works off `games.length` rather than off the constant —
 * so a two-game document is a legitimate tournament and not a test-only mode.
 *
 * Crash It at `hard` is how this suite already drives a match to completion without touching
 * a control: `bot-difficulty.spec.ts` measures the bot settling a round in about eight
 * seconds. Road Dodge is the second leg on the same reading — `match-flow.spec.ts` plays it
 * to its end with nobody at the human seat, and budgets forty-five seconds for it.
 *
 * The two waits are not independent, for the reason `record.spec.ts` gives its own describe
 * a raised ceiling: the loop drops steps under load, so a busy runner stretches both matches
 * at once and the run then dies on a timeout with no assertion message rather than failing
 * usefully.
 */
test.describe('playing a tournament to the end', () => {
  test.describe.configure({ timeout: 150_000 });

  test('advances between games, survives a reload, and finishes', async ({ page }) => {
    await page.goto('/play/crash-it/');
    // Through the app's own control, so the tier that makes the first leg short is stored
    // the way a player would store it.
    await page.getByRole('radio', { name: /Hard/ }).check();
    await page.evaluate(
      ([key, document]) => {
        globalThis.localStorage.setItem(key, document);
      },
      [
        TOURNAMENT_KEY,
        JSON.stringify({
          version: 1,
          games: ['crash-it', 'road-dodge'],
          results: [],
          opponent: 'bot',
        }),
      ] as const,
    );
    await page.reload();

    await expect(track(page)).toContainText('Game 1 of 2');
    await page.getByRole('button', { name: 'Play game 1' }).click();
    await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 25_000 });

    // The leg is reported the moment the match machine settles it, so the track has moved
    // on before anybody presses anything.
    await expect(track(page)).toContainText('Game 2 of 2');
    expect(
      JSON.parse((await storedText(page)) ?? 'null'),
      'one finished leg is one result on the document',
    ).toMatchObject({ version: 1, games: ['crash-it', 'road-dodge'], opponent: 'bot' });
    const afterOne = await page.evaluate(
      (key) =>
        (JSON.parse(globalThis.localStorage.getItem(key) ?? 'null') as { results: string[] })
          .results.length,
      TOURNAMENT_KEY,
    );
    expect(afterOne, 'exactly one leg is recorded').toBe(1);

    // #157's acceptance criterion, in the middle of a tournament rather than at its edges.
    await page.reload();
    await expect(track(page)).toContainText('Game 2 of 2');

    // And the way on is a link to the next game, because the next leg is a different page.
    await page.getByRole('link', { name: 'Go to game 2' }).click();
    await expect(page).toHaveURL(/\/play\/road-dodge\//);
    await expect(track(page)).toContainText('Game 2 of 2');

    await page.getByRole('button', { name: 'Play game 2' }).click();
    await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 45_000 });

    // Both games played, so the tournament is decided one way or the other. Which way is
    // the bot's business — what is asserted is that it ends rather than running on.
    await expect(track(page)).toContainText(/wins the tournament|Tournament drawn/);

    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(track(page)).toHaveCount(0);
    expect(await storedText(page)).toBeNull();
  });
});
