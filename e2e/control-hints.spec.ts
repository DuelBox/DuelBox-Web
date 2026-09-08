import { expect, test, type Page } from '@playwright/test';

/**
 * "Which half of the screen is mine?", answered once per game per device (#137).
 *
 * `apps/web/src/lib/control-hints.ts` has held the once-per-game memory for as long as it has
 * existed, with its own test file, and **nothing imported it** — the same shape as
 * `key-bindings.ts` before #2550. What was missing was the hint itself and the signal that
 * fades it.
 *
 * The last two tests are the ones a unit test cannot reach: that a hint layer over a
 * full-bleed board does not swallow a press, and that a seat's hint goes when *that* seat
 * plays rather than when either does.
 */

/** A real-time game where both seats move at once, so each can be driven on its own. */
const GAME = 'mini-soccer';

async function startAFreshMatch(page: Page, game = GAME) {
  await page.goto(`/play/${game}/`);
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

const hint = (page: Page, seat: 'p1' | 'p2') => page.locator(`[data-hint-seat="${seat}"]`);

test.describe('the first-play hints', () => {
  test('name both halves on a game this device has never opened', async ({ page }) => {
    await startAFreshMatch(page);
    await expect(hint(page, 'p1')).toBeVisible();
    await expect(hint(page, 'p2')).toBeVisible();
    // Words, not colour: the pair must be told apart in greyscale (rule 7).
    await expect(hint(page, 'p1')).toContainText(/plays this half/i);
  });

  test('turn the far seat’s hint to face the person reading it', async ({ page }) => {
    await startAFreshMatch(page);
    // The same half turn the scoreboard takes. `matrix(-1, 0, 0, -1, …)` is 180°.
    const transform = await hint(page, 'p2').evaluate((el) => getComputedStyle(el).transform);
    expect(transform).toMatch(/^matrix\(-1, 0, 0, -1/);
    await expect(hint(page, 'p1')).toHaveCSS('transform', 'none');
  });

  test('let a press through to the board underneath', async ({ page }) => {
    // The acceptance criterion, and the only version of it that survives a board with no
    // corner that is not interactive.
    await startAFreshMatch(page);
    for (const seat of ['p1', 'p2'] as const) {
      await expect(hint(page, seat)).toHaveCSS('pointer-events', 'none');
    }
  });

  test('fade the seat that has played and leave the seat that has not', async ({ page }) => {
    await startAFreshMatch(page);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyS');

    await expect(hint(page, 'p1')).toHaveCSS('opacity', '0');
    await expect(hint(page, 'p2')).toHaveCSS('opacity', '1');

    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    await expect(hint(page, 'p2')).toHaveCSS('opacity', '0');
  });

  test('are gone the next time this device opens the same game', async ({ page }) => {
    await startAFreshMatch(page);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyS');

    await startAFreshMatch(page);
    await expect(hint(page, 'p1')).toBeHidden();
    await expect(hint(page, 'p2')).toBeHidden();
  });

  test('come back when the settings page asks for them', async ({ page }) => {
    await startAFreshMatch(page);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyS');

    await page.goto('/settings/');
    await page.getByRole('button', { name: 'Show the hints again' }).click();

    await startAFreshMatch(page);
    await expect(hint(page, 'p1')).toBeVisible();
  });
});
