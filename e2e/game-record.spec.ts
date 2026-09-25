import { expect, test, type Page } from '@playwright/test';
import { HEAD_TO_HEAD_KEY } from '../apps/web/src/lib/head-to-head';
import { SEAT_CHARACTERS } from '../apps/web/src/lib/seats';

/**
 * Where a player actually sees the record (#160, #162).
 *
 * `record.spec.ts` covers the other half of the same store — that a match played to its end
 * reaches storage, once, and survives the tab. This one is about the two surfaces that read
 * it back: a game's own page, which is #162's action item and had nothing on it at all, and
 * the overall figure `readRecord` has summed on every read since #160 and never shown.
 *
 * No match is played here, and that is deliberate. What is under test is a document being
 * turned into markup, so the record is written the way `lib/head-to-head.ts` writes it and
 * the page is asked what it made of it — which takes a second rather than the fifty seconds
 * of authorised waiting two real matches cost `record.spec.ts`. The counting rule those
 * seconds buy is already bought.
 */

const GAME = 'tic-tac-toe';

/** A game this device has never finished a match at, for the test that they are kept apart. */
const OTHER = 'air-hockey';

/**
 * Written as the store writes it, and asymmetric on purpose.
 *
 * Six numbers, no two the same where a mix-up could hide: a page that read the bot's map as
 * the friend one, or seat two's wins as seat one's, gets a different sentence rather than the
 * same one twice. The bot's nine matches are the ones the overall record has to leave out.
 */
const SEEDED = JSON.stringify({
  version: 1,
  games: { [GAME]: { p1: 3, p2: 1, draws: 2 } },
  bots: { [GAME]: { p1: 4, p2: 5, draws: 0 } },
});

/** The settings page's one overall figure (#160). */
function overall(page: Page) {
  return page.locator('p', { hasText: /The near seat has won/ });
}

/** The value beside one of the game page's row labels. */
function row(page: Page, label: string) {
  return page.locator('dl div', { hasText: label }).locator('dd');
}

async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]: readonly [string, string]) => {
      globalThis.localStorage.setItem(key, value);
    },
    [HEAD_TO_HEAD_KEY, SEEDED] as const,
  );
}

test.describe("a game's own record", () => {
  test('reads back the two kinds of match, kept apart', async ({ page }) => {
    await seed(page);
    await page.goto(`/games/${GAME}/`);

    // The two seats. Named, so neither number can be read as the other's.
    await expect(row(page, 'Between the two of you')).toHaveText(
      `${SEAT_CHARACTERS.p1} 3, ${SEAT_CHARACTERS.p2} 1, 2 drawn`,
    );
    // And the bot's, which is a different map under the same slug. Ten losses to the hard
    // bot coming back as ten wins for the person in the far seat is the defect the store was
    // split to prevent, and this is that split as a player sees it.
    await expect(row(page, 'Against the bot')).toHaveText(
      `${SEAT_CHARACTERS.p1} 4, the bot 5, 0 drawn`,
    );
  });

  test('belongs to the game it is on', async ({ page }) => {
    await seed(page);
    await page.goto(`/games/${OTHER}/`);
    await expect(row(page, 'Between the two of you')).toHaveText(
      `${SEAT_CHARACTERS.p1} 0, ${SEAT_CHARACTERS.p2} 0, 0 drawn`,
    );
  });
});

/**
 * The state the page is exported in, which is the state every visitor paints first.
 *
 * Scripting off is how to hold still what is otherwise one frame long. Two things are being
 * pinned. The rows and their labels are in the served HTML, so the read that lands a frame
 * later changes digits and never adds structure — that is the whole of the promise that the
 * record does not shift the page when it arrives. And each count is a dash rather than a
 * zero, because at that point nothing has been read and a zero would be a claim: "you two
 * have never finished this one" is a different statement from "this has not been looked up",
 * and a visitor with no scripting at all only ever gets the second one.
 */
test.describe('before the record has been read', () => {
  test.use({ javaScriptEnabled: false });

  test('says so rather than showing a zero', async ({ page }) => {
    await page.goto(`/games/${GAME}/`);
    await expect(row(page, 'Between the two of you')).toHaveText(
      `${SEAT_CHARACTERS.p1} –, ${SEAT_CHARACTERS.p2} –, – drawn`,
    );
    await expect(row(page, 'Against the bot')).toHaveText(
      `${SEAT_CHARACTERS.p1} –, the bot –, – drawn`,
    );
  });
});

test.describe('the overall record on the settings page', () => {
  test('adds the games up and leaves the bot out', async ({ page }) => {
    await seed(page);
    await page.goto('/settings/');

    // 3 + 1 + 2 between the two seats. The bot's nine are not in it: a bot's wins belong to
    // nobody, so they are nobody's to be ahead by.
    await expect(overall(page)).toHaveText(
      'The near seat has won 3, the far seat 1, and 2 ended level.',
    );

    // And the contrast that makes the sentence above worth stating: "Matches recorded" is
    // the other question — how much has been played on this device at all — and it does
    // count the bot's nine. Fifteen against six is the two facts refusing to be one number.
    await expect(page.locator('dl div', { hasText: 'Matches recorded' }).locator('dd')).toHaveText(
      '15',
    );
  });

  test('goes back to nothing when the record is cleared', async ({ page }) => {
    await seed(page);
    await page.goto('/settings/');
    await page.getByRole('button', { name: 'Clear the record', exact: true }).click();
    await page
      .getByRole('button', { name: 'Press again to clear the record', exact: true })
      .click();
    await expect(overall(page)).toHaveText(
      'The near seat has won 0, the far seat 0, and 0 ended level.',
    );
  });
});
