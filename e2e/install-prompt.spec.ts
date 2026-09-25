import { expect, test, type Page } from '@playwright/test';

/**
 * The install offer arrives after a finished match and at no other time (#195).
 *
 * Playwright cannot make Chromium fire a real `beforeinstallprompt` — installability is
 * decided by heuristics about engagement and a manifest served over HTTPS — so the event is
 * dispatched by hand, with the two members the page reads: `prompt()`, which resolves and
 * records that it was called, and `userChoice`, which answers with whatever the test chose.
 * That is the same object the browser hands over; only the trigger is synthetic.
 *
 * Chromium only (`CHROMIUM_ONLY` in `playwright.config.ts`): WebKit never fires the event,
 * and on WebKit the whole feature is correctly a no-op.
 */

const GAME = '/play/crash-it/';

/** Arms a fake install event to fire `delay` ms after load, and records what the page did. */
async function armInstallEvent(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  await page.addInitScript((choice: string) => {
    const w = window as unknown as { dbPrompted: number };
    w.dbPrompted = 0;
    window.addEventListener('load', () => {
      setTimeout(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        };
        event.prompt = () => {
          w.dbPrompted += 1;
          return Promise.resolve();
        };
        event.userChoice = Promise.resolve({ outcome: choice });
        window.dispatchEvent(event);
      }, 50);
    });
  }, outcome);
}

const offer = (page: Page) => page.getByRole('button', { name: 'Add it' });

async function playToTheEnd(page: Page): Promise<void> {
  await page.goto(GAME);
  await page.getByRole('radio', { name: /Hard/ }).check();
  await page.getByRole('radio', { name: '1 round' }).check();
  await page.getByRole('button', { name: /Play against/ }).click();
  await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 25_000 });
}

test.describe('the install offer', () => {
  test('is not made on arrival, however early the browser offers', async ({ page }) => {
    await armInstallEvent(page);
    await page.goto('/');
    // Long enough for the synthetic event to have fired and been captured.
    await page.waitForTimeout(400);
    await expect(offer(page)).toBeHidden();
    await page.goto(GAME);
    await page.waitForTimeout(400);
    await expect(offer(page), 'nor on the lobby, before anybody has played').toBeHidden();
  });

  test('is made once a match has been played to its end, and pressing it prompts', async ({
    page,
  }) => {
    await armInstallEvent(page, 'accepted');
    await playToTheEnd(page);
    await expect(offer(page)).toBeVisible();
    await offer(page).click();
    await expect(offer(page)).toBeHidden();
    expect(
      await page.evaluate(() => (window as unknown as { dbPrompted: number }).dbPrompted),
    ).toBe(1);
    // Accepted is remembered: another finished match does not ask again.
    await playToTheEnd(page);
    await expect(offer(page)).toBeHidden();
  });

  test('"Not now" is honoured across a reload and another finished match', async ({ page }) => {
    await armInstallEvent(page);
    await playToTheEnd(page);
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(offer(page)).toBeHidden();
    await playToTheEnd(page);
    await expect(offer(page), 'asked again on the same day').toBeHidden();
    const remembered = await page.evaluate(() => localStorage.getItem('duelbox:install'));
    expect(remembered).toContain('"dismissedAt"');
  });

  test('stays out of a live match, whatever the browser offers mid-play', async ({ page }) => {
    await armInstallEvent(page);
    await playToTheEnd(page);
    await expect(offer(page)).toBeVisible();
    await page.getByRole('button', { name: /Rematch/i }).click();
    // `html[data-match='live'] .db-net-bar { display: none }` — the same rule that keeps the
    // offline bar out of a running match keeps this one out.
    await expect(offer(page)).toBeHidden();
  });
});
