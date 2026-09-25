import { expect, test, type Page } from '@playwright/test';

/**
 * The idle catalogue plays itself after twenty seconds of nothing, and at no other time
 * (#165).
 *
 * Nothing here waits twenty real seconds: Playwright's clock is installed before the page
 * loads and advanced by hand, so the idle timer fires when the test says so and a run costs
 * seconds rather than minutes. The assertions are the acceptance criteria in order — nothing
 * before the wait, a match after it, gone the moment a person moves, and never under
 * save-data, reduced motion or a low battery. The last test is the one that keeps this off
 * the shell: the stage's chunk must not be fetched until the timer has fired.
 *
 * Chromium only (`CHROMIUM_ONLY` in `playwright.config.ts`): `navigator.getBattery` and
 * `navigator.connection` are Chromium's — WebKit has neither and the stubs below would be
 * stubbing nothing — and a bot-versus-bot match is the same simulation on every engine by
 * rule 8, so a second engine would re-run the catalogue's idle timer to learn nothing.
 */

const IDLE = 20_000;

/** The canvas the stage draws into — the one thing that says a match is showing. */
const stage = (page: Page) => page.locator('[data-attract]');

/**
 * Opens the catalogue with time stopped.
 *
 * `clock.install()` fakes the timers but the fake keeps ticking in real time until it is
 * paused, so a nineteen-second advance on top of a two-second page load is twenty-one
 * seconds and the wait is over before the assertion that says it is not. `pauseAt` is what
 * makes "advance by exactly this much" mean exactly that.
 */
async function openCatalogue(page: Page): Promise<void> {
  await page.goto('/games/');
  await expect(page.locator('[data-ready]')).toBeAttached();
  await page.clock.pauseAt(Date.now() + 1_000);
}

/** A battery reading the page will see, on a browser family that reports one. */
async function stubBattery(page: Page, level: number, charging: boolean): Promise<void> {
  await page.addInitScript(
    ([l, c]: [number, boolean]) => {
      Object.defineProperty(navigator, 'getBattery', {
        configurable: true,
        value: () => Promise.resolve({ level: l, charging: c }),
      });
    },
    [level, charging] as [number, boolean],
  );
}

test.describe('the idle catalogue', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test('shows nothing until twenty seconds have passed, then a match', async ({ page }) => {
    await openCatalogue(page);
    await page.clock.runFor(IDLE - 2_000);
    await expect(stage(page)).toHaveCount(0);
    await page.clock.runFor(2_500);
    await expect(stage(page)).toHaveAttribute('data-attract', 'playing', { timeout: 15_000 });
    await expect(page.getByText(/are playing/)).toBeVisible();
    // The caption names the game and links to it; the canvas is decoration, not content.
    await expect(page.getByText(/are playing/).getByRole('link')).toHaveAttribute(
      'href',
      /^\/play\/[a-z0-9-]+\/$/,
    );
    await expect(page.locator('[data-attract] [aria-hidden="true"] canvas')).toHaveCount(1);
  });

  test('stops in the same task as the first movement, before any frame is drawn', async ({
    page,
  }) => {
    await openCatalogue(page);
    await page.clock.runFor(IDLE + 500);
    await expect(stage(page)).toHaveAttribute('data-attract', 'playing', { timeout: 15_000 });

    // The clock is stopped: nothing can advance a frame between the move and the read.
    await page.mouse.move(40, 40);
    const gone = await page.evaluate(() => {
      const box = document.querySelector('[data-attract]')?.parentElement;
      return box === null || box === undefined || box.hidden;
    });
    expect(gone, 'the stage was still showing after the pointer moved').toBe(true);
    await expect(stage(page)).toHaveCount(0);

    // And it waits the full twenty seconds again, from the movement, before coming back.
    await page.clock.runFor(IDLE - 2_000);
    await expect(stage(page)).toHaveCount(0);
  });

  test('stops on a key, a scroll and a touch as it does on a pointer', async ({ page }) => {
    await openCatalogue(page);
    // A dispatched `touchstart` rather than `page.touchscreen`: the desktop project has no
    // touchscreen, and what is under test is the listener, not the emulation.
    for (const wake of [
      () => page.keyboard.press('Shift'),
      () => page.mouse.wheel(0, 10),
      () => page.evaluate(() => window.dispatchEvent(new Event('touchstart'))),
    ]) {
      await page.clock.runFor(IDLE + 500);
      await expect(stage(page)).toHaveAttribute('data-attract', 'playing', { timeout: 15_000 });
      await wake();
      await expect(stage(page)).toHaveCount(0);
    }
  });

  test('never starts when the person has asked for less data', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true },
      });
    });
    await openCatalogue(page);
    await page.clock.runFor(IDLE * 2);
    await expect(stage(page)).toHaveCount(0);
  });

  test('never starts under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCatalogue(page);
    await page.clock.runFor(IDLE * 2);
    await expect(stage(page)).toHaveCount(0);
  });

  test('never starts on a low battery that is not charging, and does on one that is', async ({
    browser,
  }) => {
    for (const [charging, expected] of [
      [false, 0],
      [true, 1],
    ] as const) {
      const page = await browser.newPage();
      await page.clock.install();
      await stubBattery(page, 0.1, charging);
      await openCatalogue(page);
      await page.clock.runFor(IDLE + 500);
      if (expected === 0) {
        // The chunk may arrive and read the battery; the match must not start.
        await page.waitForTimeout(1_500);
        await expect(stage(page)).toHaveCount(0);
      } else {
        await expect(stage(page)).toHaveAttribute('data-attract', 'playing', { timeout: 15_000 });
      }
      await page.close();
    }
  });

  test('fetches the stage only when the timer has fired', async ({ page }) => {
    // The whole of "costs the shell nothing": the game, the engine and the bots are an
    // `import()` behind the timer, and nothing may fetch them before it fires. The stage is
    // recognised by its content rather than by a chunk id — Next prefetches route chunks of
    // its own as the clock advances, and those are not the question.
    const stageChunks: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (!url.endsWith('.js')) return;
      void response
        .text()
        .then((body) => {
          if (body.includes('db-attract')) stageChunks.push(url);
        })
        .catch(() => undefined);
    });
    await openCatalogue(page);
    await page.waitForLoadState('networkidle');
    await page.clock.runFor(IDLE - 2_000);
    await page.waitForTimeout(500);
    expect(stageChunks, 'the stage arrived before the wait was over').toEqual([]);
    await page.clock.runFor(2_500);
    await expect(stage(page)).toHaveAttribute('data-attract', 'playing', { timeout: 15_000 });
    expect(stageChunks.length, 'the stage arrived as a chunk of its own').toBeGreaterThan(0);
  });
});
