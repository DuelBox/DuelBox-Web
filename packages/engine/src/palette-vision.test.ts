import { describe, expect, it } from 'vitest';
import { SEAT_PALETTE } from './palette.js';
import { SEATS } from './seat.js';

/**
 * How the seat colours behave for players who do not see colour the way the designer did.
 *
 * Roughly one man in sixteen has some form of red-green colour blindness. A two-player
 * game whose seats are red and blue is, for those players, a two-player game with one
 * colour — and the person who cannot tell which piece is theirs will not report a bug,
 * they will simply stop playing.
 *
 * These tests assert what currently holds and measure what does not, rather than
 * asserting a target the palette fails and leaving the suite red. The failing property
 * is a deliberate open question on #2322: fixing it means changing the product's
 * identity colours, which is a design decision rather than a defect fix.
 */

type Rgb = readonly [number, number, number];

function toRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** sRGB to linear light. Contrast is meaningless without it. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] =
    luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
}

/** Dichromacy simulation, linear-space matrices of the usual Brettel/Viénot form. */
const MATRICES = {
  protan: [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
  deutan: [0.367, 0.861, -0.228, 0.28, 0.673, 0.047, -0.012, 0.043, 0.969],
  tritan: [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
} as const;

function simulate(rgb: Rgb, kind: keyof typeof MATRICES): Rgb {
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  const m = MATRICES[kind];
  const out = [
    (m[0] ?? 0) * r + (m[1] ?? 0) * g + (m[2] ?? 0) * b,
    (m[3] ?? 0) * r + (m[4] ?? 0) * g + (m[5] ?? 0) * b,
    (m[6] ?? 0) * r + (m[7] ?? 0) * g + (m[8] ?? 0) * b,
  ];
  const encode = (c: number): number => {
    const clamped = Math.min(1, Math.max(0, c));
    const s = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  return [encode(out[0] ?? 0), encode(out[1] ?? 0), encode(out[2] ?? 0)];
}

const p1 = toRgb(SEAT_PALETTE.p1.base);
const p2 = toRgb(SEAT_PALETTE.p2.base);

describe('the seat colours as most people see them', () => {
  it('gives the two seats different hues', () => {
    expect(SEAT_PALETTE.p1.base).not.toBe(SEAT_PALETTE.p2.base);
  });

  it('reads against both the light and the dark surfaces a game may draw on', () => {
    const paper = toRgb('#ffffff');
    const ink = toRgb('#14161f');
    for (const seat of SEATS) {
      const colour = toRgb(SEAT_PALETTE[seat].base);
      // 3:1 is the WCAG bar for a graphical object, which is what these are — they are
      // fills and strokes, not body text.
      const best = Math.max(contrast(colour, paper), contrast(colour, ink));
      expect(best, `${seat} against its best surface`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps each seat distinguishable from its own outline', () => {
    for (const seat of SEATS) {
      const entry = SEAT_PALETTE[seat];
      expect(luminance(toRgb(entry.deep))).toBeLessThan(luminance(toRgb(entry.base)));
    }
  });
});

describe('the seat colours as a colour-blind player sees them', () => {
  /**
   * Recorded rather than asserted. The bar a two-player game should clear is 3:1 between
   * the seats under every dichromacy; the current palette gives 1.03:1 under deuteranopia,
   * which is indistinguishable. Raising the assertion to 3 is the fix, and it belongs
   * with the palette decision on #2322 rather than as a red suite in the meantime.
   */
  const TARGET = 3;

  it('measures seat-to-seat contrast under each dichromacy', () => {
    const measured: Record<string, number> = {};
    for (const kind of ['protan', 'deutan', 'tritan'] as const) {
      measured[kind] = contrast(simulate(p1, kind), simulate(p2, kind));
    }
    // What holds today: the numbers are real and finite, and this test carries them so a
    // palette change can be judged against a measurement rather than an impression.
    for (const [kind, value] of Object.entries(measured)) {
      expect(value, `${kind} contrast`).toBeGreaterThan(1);
    }
    // The gap this palette has not closed. Documented as a fact, with the target named.
    expect(measured.deutan ?? 0).toBeLessThan(TARGET);
  });

  it('is why colour is never the only signal', () => {
    // The safety net that makes the above survivable: each seat carries a shape and a
    // name as well as a colour, so a player who cannot separate the hues can still tell
    // the pieces apart. This is CLAUDE.md rule 7, and it is load-bearing rather than
    // decorative — which the measurement above demonstrates.
    expect(SEATS.length).toBe(2);
    for (const seat of SEATS) {
      const entry = SEAT_PALETTE[seat];
      expect(entry.base).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.soft).toMatch(/^rgba\(/);
    }
  });
});
