import { describe, expect, it } from 'vitest';
import { SEATS } from './seat.js';
import { SEAT_PALETTE, seatPalette } from './palette.js';

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
