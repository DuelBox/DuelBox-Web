import { expect, test } from '@playwright/test';
import { seatCentroids } from './seat-pixels.js';

/**
 * The two keyboard halves belong to two different people.
 *
 * `DEFAULT_BINDINGS` binds W A S D to p1 and the arrow keys to p2, and validates that the
 * two never share a code — one player must not be able to drive the other. Five manifests
 * nonetheless advertised "W A S D **or** the arrow keys", which tells the second player to
 * press keys that move their opponent. A unit test now refuses that phrasing; this one
 * checks the behaviour it describes actually holds in a browser, on a game where both
 * seats move at once and contest the same object.
 */
test.describe('the two keyboard halves', () => {
  test('each drive their own seat and not the other', async ({ page }) => {
    await page.goto('/play/mini-soccer/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const start = await seatCentroids(page);
    expect(start.p1, 'p1 is on the pitch to begin with').not.toBeNull();
    expect(start.p2, 'p2 is on the pitch to begin with').not.toBeNull();

    // Seat one alone, moving down the pitch.
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyS');
    const afterWasd = await seatCentroids(page);

    const p1Moved = Math.abs((afterWasd.p1?.y ?? 0) - (start.p1?.y ?? 0));
    const p2Moved = Math.abs((afterWasd.p2?.y ?? 0) - (start.p2?.y ?? 0));
    expect(p1Moved, 'S moved seat one').toBeGreaterThan(8);
    expect(p2Moved, 'S left seat two exactly where it was').toBeLessThan(2);

    // Seat two alone, the other way, so a shared-state bug cannot look like a pass.
    const before = await seatCentroids(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowUp');
    const afterArrows = await seatCentroids(page);

    expect(
      Math.abs((afterArrows.p2?.y ?? 0) - (before.p2?.y ?? 0)),
      'the up arrow moved seat two',
    ).toBeGreaterThan(8);
    expect(
      Math.abs((afterArrows.p1?.y ?? 0) - (before.p1?.y ?? 0)),
      'the up arrow left seat one alone',
    ).toBeLessThan(2);
  });

  test('both halves are heard in the same frame', async ({ page }) => {
    // Two people really do press at the same time. Nothing may be dropped.
    await page.goto('/play/mini-soccer/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const start = await seatCentroids(page);
    for (const key of ['KeyS', 'ArrowUp']) await page.keyboard.down(key);
    await page.waitForTimeout(700);
    for (const key of ['KeyS', 'ArrowUp']) await page.keyboard.up(key);
    const after = await seatCentroids(page);

    // Signed, and in opposite directions: if both seats were secretly reading one set of
    // keys they would both travel the same way, and an absolute distance would not notice.
    expect(
      (after.p1?.y ?? 0) - (start.p1?.y ?? 0),
      'S sent seat one down the pitch while seat two was also holding a key',
    ).toBeGreaterThan(8);
    expect(
      (after.p2?.y ?? 0) - (start.p2?.y ?? 0),
      'the up arrow sent seat two the other way at the same moment',
    ).toBeLessThan(-8);
  });
});
