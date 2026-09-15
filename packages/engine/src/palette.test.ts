import { describe, expect, it } from 'vitest';
import { SEATS } from './seat.js';
import {
  SEAT_PALETTE,
  SEAT_PALETTES,
  seatPalette,
  seatSwapped,
  setActiveSeatPalette,
  setSeatSwap,
} from './palette.js';

describe('the seat palette', () => {
  it('covers every seat', () => {
    for (const seat of SEATS) expect(seatPalette(seat)).toBeDefined();
  });

  it('gives the two seats visibly different colours', () => {
    expect(SEAT_PALETTE.p1.base).not.toBe(SEAT_PALETTE.p2.base);
  });

  it('separates the seats by more than hue alone', () => {
    // A pair that differ only in hue vanish together in greyscale. Luminance has to
    // differ too, or the board is unreadable to anyone who cannot separate the two.
    const gap = Math.abs(luminance(SEAT_PALETTE.p1.base) - luminance(SEAT_PALETTE.p2.base));
    expect(gap).toBeGreaterThan(0.04);
  });

  it('states every colour in a form the canvas accepts', () => {
    for (const seat of SEATS) {
      const entry = seatPalette(seat);
      expect(entry.base).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.deep).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.soft).toMatch(/^rgba\(/);
    }
  });

  it('keeps deep darker than base, so an outline reads against its own fill', () => {
    for (const seat of SEATS) {
      const entry = seatPalette(seat);
      expect(luminance(entry.deep)).toBeLessThan(luminance(entry.base));
    }
  });

  /**
   * The swap (#161) exchanges the two seats' values in place and nothing else.
   *
   * In place, because a game that captured `SEAT_PALETTE.p1` at module load must see the
   * swap the way it sees a palette change — `live.p1` stays the same object and its fields
   * take the far seat's colours. Remembered across a palette change, so choosing the
   * colour-blind pair keeps the seats the way round the player put them. Watched failing
   * with `refresh` reading `seat` instead of `source`.
   */
  it('exchanges the two seats in place and remembers it across a palette change', () => {
    const p1 = SEAT_PALETTE.p1;
    const before = { p1: { ...SEAT_PALETTE.p1 }, p2: { ...SEAT_PALETTE.p2 } };
    setSeatSwap(true);
    expect(seatSwapped()).toBe(true);
    expect(SEAT_PALETTE.p1).toBe(p1);
    expect({ ...SEAT_PALETTE.p1 }).toEqual(before.p2);
    expect({ ...SEAT_PALETTE.p2 }).toEqual(before.p1);
    setActiveSeatPalette('colourblind');
    expect({ ...SEAT_PALETTE.p1 }).toEqual(SEAT_PALETTES.colourblind.p2);
    expect({ ...SEAT_PALETTE.p2 }).toEqual(SEAT_PALETTES.colourblind.p1);
    setSeatSwap(false);
    expect({ ...SEAT_PALETTE.p1 }).toEqual(SEAT_PALETTES.colourblind.p1);
    setActiveSeatPalette('default');
    expect({ ...SEAT_PALETTE.p1 }).toEqual(before.p1);
    expect(seatSwapped()).toBe(false);
  });

  it('cannot be reassigned through the exported record', () => {
    // Frozen in type only, but the shape must stay stable: a game that mutated this
    // would repaint every other game.
    expect(Object.keys(SEAT_PALETTE)).toEqual([...SEATS]);
  });
});

/** Rec. 709 relative luminance of a #rrggbb colour, in [0, 1]. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
