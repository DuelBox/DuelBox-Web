import { expect, test, type Page } from '@playwright/test';

/**
 * The reduced-motion preference, in a real engine (#175).
 *
 * `apps/web/src/styles/motion.test.ts` reads the stylesheets and proves no timed
 * declaration escapes the duration tokens. That is the stronger guard of the two and it
 * is entirely static — which is also its limit: it can prove the lever is wired to
 * everything and cannot prove the lever moves. Only a browser that has actually been told
 * the preference can do that, because the value under test is computed by the cascade
 * from a media query no file can evaluate on its own.
 *
 * So this is deliberately narrow. It asserts the tokens collapse when the preference is
 * set, that they do not when it is not — a test that passed both ways would be measuring
 * nothing — and that the pages still work with motion off, which is the half of the
 * acceptance criterion about information never being lost.
 *
 * `page.emulateMedia` rather than the `reducedMotion` test option: the option is a
 * browser-context fixture and this repository's `tsconfig.lint.json` typechecks the specs
 * against a resolution of `@playwright/test` that does not carry it, so the option is a
 * type error where the method is not. The method also scopes the preference to the page
 * under test rather than the whole project, which is what lets both halves of the
 * comparison live in one file.
 */

/** The three tokens `tokens.css` collapses, read from the root where they are defined. */
async function durations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['--db-duration-fast', '--db-duration', '--db-duration-slow'].map((name) =>
      style.getPropertyValue(name).trim(),
    );
  });
}

test.describe('with reduced motion asked for', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('collapses every duration token the shell animates with', async ({ page }) => {
    await page.goto('/games/');
    expect(await durations(page)).toEqual(['1ms', '1ms', '1ms']);
  });

  test('leaves the catalogue readable and usable', async ({ page }) => {
    // Motion off must not cost information: the controls are still there, the grid still
    // filters, and the count is still announced.
    await page.goto('/games/');
    await expect(page.locator('[data-ready]')).toBeAttached();
    await page.getByRole('searchbox', { name: 'Search games' }).fill('chess');
    await expect(page.locator('a[href="/play/chess/"]')).toBeVisible();
    await expect(page.locator('p[aria-live="polite"]')).toContainText('game');
  });

  test('still plays a game', async ({ page }) => {
    // The board's half-turn is one of the things a reduced-motion player gives up, and
    // giving it up must not cost them the match: the game still starts and still draws.
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.locator('canvas')).toBeVisible();
  });
});

test.describe('without it', () => {
  test('keeps the durations it animates with, so the test above means something', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/games/');
    const values = await durations(page);
    expect(values).not.toEqual(['1ms', '1ms', '1ms']);
    for (const value of values) expect(value).not.toBe('');
  });
});
