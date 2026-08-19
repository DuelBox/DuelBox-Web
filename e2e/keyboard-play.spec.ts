import { expect, test } from '@playwright/test';

/**
 * Every game must be completable with the keyboard alone.
 *
 * Two of the seven were pointer-only: a tap named a square or a card directly, so there
 * was nothing for a keyboard to move and no way in at all. Worse, their manifests
 * advertised keyboard controls, so the shell was telling players about a control that
 * did not exist.
 */
test.describe('keyboard-only play', () => {
  const games = [
    { slug: 'tic-tac-toe', name: 'Tic Tac Toe' },
    { slug: 'memory', name: 'Memory Match' },
    { slug: 'four-in-a-row', name: 'Drop Four' },
  ];

  for (const game of games) {
    test(`${game.name} responds to the keyboard with no pointer at all`, async ({ page }) => {
      await page.goto(`/play/${game.slug}/`);
      await page.getByRole('button', { name: 'Play together here' }).press('Enter');
      await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
        timeout: 10_000,
      });

      // Sample the board, drive it with keys only, and require the pixels to change.
      // A game that ignores the keyboard renders the identical frame forever.
      const sample = () =>
        page.locator('canvas').evaluate((node) => {
          const canvas = node as HTMLCanvasElement;
          const context = canvas.getContext('2d');
          if (!context || canvas.width === 0) return '';
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          // Every pixel, not a sparse walk: in landscape the board is only ~144px tall
          // and a sparse sample stepped straight over the cursor, reporting "nothing
          // changed" when the cursor had in fact moved.
          let hash = 0;
          for (let i = 0; i < data.length; i += 4) hash = (hash * 31 + (data[i] ?? 0)) >>> 0;
          return String(hash);
        });

      const before = await sample();
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'Enter', 'Space']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(120);
      }
      await expect.poll(sample, { timeout: 5000 }).not.toBe(before);
    });
  }
});
