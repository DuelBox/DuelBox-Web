import type { Page } from '@playwright/test';

/**
 * Where each seat's body currently is, read off the canvas.
 *
 * The engine binds W A S D to one seat and the arrow keys to the other, strictly
 * disjointly, and several manifests used to tell players otherwise. Asserting that is
 * only worth anything if the test can see *which* body moved — a check that a canvas
 * exists passes with the whole input system deleted, which is what the king-of-the-yard
 * test here used to do.
 *
 * Seat bodies are the only large blocks of saturated seat colour on any play surface, so
 * a centroid of near-matching pixels locates one well enough to say it moved.
 */
export interface SeatCentroids {
  readonly p1: { x: number; y: number; count: number } | null;
  readonly p2: { x: number; y: number; count: number } | null;
}

export async function seatCentroids(page: Page): Promise<SeatCentroids> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { p1: null, p2: null };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { p1: null, p2: null };
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;

    const targets = {
      p1: [0xff, 0x5a, 0x4e],
      p2: [0x21, 0xb0, 0xe8],
    } as const;
    const sums = {
      p1: { x: 0, y: 0, count: 0 },
      p2: { x: 0, y: 0, count: 0 },
    };

    // A generous tolerance: anti-aliasing and any overlay tint shift a body's pixels a
    // little, and no other element on these surfaces is near either hue.
    const TOLERANCE = 60;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a < 200) continue;
        for (const seat of ['p1', 'p2'] as const) {
          const [tr, tg, tb] = targets[seat];
          if (
            Math.abs(r - tr) < TOLERANCE &&
            Math.abs(g - tg) < TOLERANCE &&
            Math.abs(b - tb) < TOLERANCE
          ) {
            sums[seat].x += x;
            sums[seat].y += y;
            sums[seat].count += 1;
          }
        }
      }
    }

    const centre = (seat: 'p1' | 'p2'): { x: number; y: number; count: number } | null =>
      sums[seat].count === 0
        ? null
        : {
            x: sums[seat].x / sums[seat].count,
            y: sums[seat].y / sums[seat].count,
            count: sums[seat].count,
          };

    return { p1: centre('p1'), p2: centre('p2') };
  });
}
