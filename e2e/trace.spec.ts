import { expect, test } from '@playwright/test';

/**
 * The debug overlay exists so a complaint about feel can become a failing test.
 *
 * Somebody who felt the stutter cannot tell you what they pressed, and the frame it happened
 * on is the only thing that matters. This checks the path that turns the one into the other,
 * against the real static build rather than a dev server.
 */
test.describe('the input trace', () => {
  test('is off unless it is asked for', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status', { name: 'Input trace' })).toHaveCount(0);
  });

  test('records what was pressed and hands it over as a replayable trace', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/?trace=1');
    await page.getByRole('button', { name: 'Play together here' }).click();
    const panel = page.getByRole('status', { name: 'Input trace' });
    await expect(panel).toBeVisible();

    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    // Measured before and after, because an empty trace is not empty — it carries the game,
    // the seed, the logical box and the step length, without which it could not be replayed.
    // Asserting it merely says "kB" would pass on a recorder that recorded nothing.
    const kb = async (): Promise<number> =>
      Number(/([0-9.]+) kB/.exec((await panel.textContent()) ?? '')?.[1] ?? '0');
    const before = await kb();

    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('KeyD');
      await page.keyboard.press('Space');
    }
    await expect
      .poll(kb, { message: 'the trace never grew after eight presses' })
      .toBeGreaterThan(before);

    // The Copy button is reachable and says so. Not clicked: `writeText` needs a secure
    // context, this suite runs over plain HTTP, and that is exactly where somebody testing a
    // phone against a laptop will be — which is why the button has a fallback rather than why
    // the test should pretend otherwise.
    await expect(panel.getByRole('button', { name: /Copy trace/ })).toBeEnabled();
  });
});
