import { expect, test, type Page } from '@playwright/test';
import { seatCentroids } from './seat-pixels.js';

/** Draw the same CSS-sized bodies at the resolutions the adaptive quality ladder uses. */
async function paintSeats(page: Page, dpr: number, nearY = 40): Promise<void> {
  await page.locator('canvas').evaluate(
    (canvas: HTMLCanvasElement, { dpr, nearY }) => {
      canvas.width = 320 * dpr;
      canvas.height = 240 * dpr;
      const context = canvas.getContext('2d')!;
      context.scale(dpr, dpr);
      context.fillStyle = '#ff5a4e';
      context.fillRect(40, nearY, 40, 40);
      context.fillStyle = '#21b0e8';
      context.fillRect(220, 140, 40, 40);
    },
    { dpr, nearY },
  );
}

test.describe('the seat pixel probe', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent('<canvas style="width: 320px; height: 240px"></canvas>');
  });

  test('keeps stationary seats fixed when the backing resolution changes', async ({ page }) => {
    await paintSeats(page, 2);
    const start = await seatCentroids(page);
    for (const dpr of [1.5, 1]) {
      await paintSeats(page, dpr);
      const after = await seatCentroids(page);
      for (const seat of ['p1', 'p2'] as const) {
        expect(start[seat], `${seat} starts on the canvas`).not.toBeNull();
        expect(after[seat], `${seat} survives the resolution change`).not.toBeNull();
        expect(Math.abs(after[seat]!.x - start[seat]!.x)).toBeLessThan(1);
        expect(Math.abs(after[seat]!.y - start[seat]!.y)).toBeLessThan(1);
      }
    }
  });

  test('still measures a moving seat when quality changes in the same span', async ({ page }) => {
    await paintSeats(page, 2);
    const start = await seatCentroids(page);
    await paintSeats(page, 1.5, 64);
    const after = await seatCentroids(page);
    expect(start.p1).not.toBeNull();
    expect(start.p2).not.toBeNull();
    expect(after.p1).not.toBeNull();
    expect(after.p2).not.toBeNull();
    expect(Math.abs(after.p1!.y - start.p1!.y - 24), 'near seat moved 24 CSS pixels').toBeLessThan(
      1,
    );
    expect(Math.abs(after.p2!.y - start.p2!.y), 'far seat stayed put').toBeLessThan(1);
  });
});
