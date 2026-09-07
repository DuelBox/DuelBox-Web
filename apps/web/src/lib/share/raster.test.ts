import { describe, expect, it } from 'vitest';
import { CHIPS, CHIP_ART, FIELDS, FIELD_ART, MARKS, MARK_ART } from '../tiles';
import { flattenPath, maskFor, shapePolygons } from './raster';
import type { Mask, Transform } from './raster';

/**
 * The rasteriser's own guard.
 *
 * Nothing else in this repository can tell a correct card from a subtly wrong one — the
 * output is a picture, the build does not look at it, and a mark drawn with a hole in it
 * still produces a valid PNG of the right size. So the properties that would be invisible
 * are asserted here as arithmetic: an area is an area whether or not anybody renders it.
 */

const UNIT: Transform = { scale: 1, dx: 0, dy: 0 };

function coverage(mask: Mask): number {
  let total = 0;
  for (const value of mask.data) total += value;
  return total;
}

function at(mask: Mask, x: number, y: number): number {
  return mask.data[y * mask.width + x] ?? 0;
}

describe('coverage', () => {
  it('measures a rectangle exactly', () => {
    const mask = maskFor(
      [
        [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 8 },
          { x: 2, y: 8 },
        ],
      ],
      10,
      10,
    );
    expect(coverage(mask)).toBeCloseTo(36, 5);
    expect(at(mask, 5, 5)).toBe(1);
    expect(at(mask, 0, 0)).toBe(0);
  });

  /**
   * A half-covered pixel has to read as half, or every edge on every card is a staircase.
   * The rectangle below covers exactly the left half of column 1.
   */
  it('measures a part-covered pixel', () => {
    const mask = maskFor(
      [
        [
          { x: 1, y: 0 },
          { x: 1.5, y: 0 },
          { x: 1.5, y: 4 },
          { x: 1, y: 4 },
        ],
      ],
      4,
      4,
    );
    expect(at(mask, 1, 2)).toBeCloseTo(0.5, 5);
  });

  it('measures a disc to within a percent of pi r squared', () => {
    const mask = maskFor(shapePolygons({ kind: 'circle', cx: 16, cy: 16, r: 10 }, UNIT), 32, 32);
    expect(coverage(mask)).toBeCloseTo(Math.PI * 100, -0.5);
  });

  /**
   * Sabotage: gave the inner circle of a ring the same winding direction as the outer one.
   *
   *   AssertionError: expected 1 to be +0 // Object.is equality
   *
   * The ring filled solid — `target` and `coin` and `ball` and `stones` would all have lost
   * their holes, on a hundred and eight cards, and every one of them would still have been
   * a valid PNG of the right size.
   */
  it('leaves a ring hollow', () => {
    const mask = maskFor(
      shapePolygons({ kind: 'ring', cx: 16, cy: 16, r: 10, weight: 4 }, UNIT),
      32,
      32,
    );
    expect(at(mask, 16, 16)).toBe(0);
    expect(at(mask, 16, 6)).toBe(1);
    expect(coverage(mask)).toBeCloseTo(Math.PI * (12 * 12 - 8 * 8), -0.5);
  });
});

describe('strokes', () => {
  /**
   * Sabotage: reversed the winding of the discs that make the joins and caps.
   *
   *   AssertionError: expected +0 to be 1 // Object.is equality
   *
   * With the non-zero rule, a piece wound the wrong way subtracts instead of adding, so
   * every corner of every stroked mark would have been punched out by its own round join —
   * a bite taken out of the `chevron`, the `wave`, the `swirl`. This is the property the
   * whole stroke implementation rests on.
   */
  it('fuses the pieces of a stroked corner', () => {
    const mask = maskFor(
      shapePolygons({ kind: 'stroke', d: 'M8 24L24 8L40 24', weight: 8 }, UNIT),
      48,
      48,
    );
    // Inside the join, where the disc overlaps exactly one of the two segments — the place
    // a reversed piece cancels rather than fusing. Points further in are covered by both
    // segments as well and survive a reversal, which is why they are not the ones asserted.
    expect(at(mask, 22, 8)).toBe(1);
    expect(at(mask, 26, 8)).toBe(1);
    // The same overlap at an end cap.
    expect(at(mask, 9, 24)).toBe(1);
    // And the middle of each arm, so a fill has not simply swallowed the whole shape.
    expect(at(mask, 16, 16)).toBe(1);
    expect(at(mask, 24, 30)).toBe(0);
    expect(at(mask, 4, 4)).toBe(0);
  });

  it('rounds the ends rather than squaring them', () => {
    const mask = maskFor(
      shapePolygons({ kind: 'stroke', d: 'M10 16h20', weight: 8 }, UNIT),
      40,
      32,
    );
    // A round cap reaches half a stroke past the end point along the axis and leaves the
    // corner a butt cap would have filled.
    expect(at(mask, 7, 16)).toBe(1);
    expect(at(mask, 6, 12)).toBe(0);
  });
});

describe('paths', () => {
  it('reads relative and absolute commands the same way', () => {
    const absolute = flattenPath('M10 10L20 10L20 20Z', 1);
    const relative = flattenPath('m10 10l10 0l0 10z', 1);
    expect(relative[0]?.points).toEqual(absolute[0]?.points);
    expect(absolute[0]?.closed).toBe(true);
  });

  it('knows an open run from a closed one', () => {
    expect(flattenPath('M0 0h10', 1)[0]?.closed).toBe(false);
    expect(flattenPath('M0 0h10v10z', 1)[0]?.closed).toBe(true);
  });

  it('treats extra pairs after a move as lines', () => {
    const [path] = flattenPath('M0 0 10 0 10 10', 1);
    expect(path?.points.length).toBe(3);
  });

  /** The `swirl` mark is three of these, and its radii only just span its endpoints. */
  it('draws an arc that ends where it was told to', () => {
    const [path] = flattenPath('M10 20a10 10 0 0 1 20 0', 1);
    const last = path?.points.at(-1);
    expect(last?.x).toBeCloseTo(30, 6);
    expect(last?.y).toBeCloseTo(20, 6);
  });

  it('reflects the control point of a smooth quadratic', () => {
    const [path] = flattenPath('M0 10q5-10 10 0t10 0', 1);
    const last = path?.points.at(-1);
    expect(last?.x).toBeCloseTo(20, 6);
    expect(last?.y).toBeCloseTo(10, 6);
  });

  it('refuses a command it cannot draw', () => {
    expect(() => flattenPath('M0 0S10 10 20 20', 1)).toThrow(/unsupported path command/);
  });
});

/**
 * Every glyph in the vocabulary draws something.
 *
 * This is the assertion that would catch a mark added to `tiles.ts` with a path command
 * this file cannot parse — which would otherwise show up as one blank tile among a hundred
 * and eight, in a picture nobody on this side of a shared link ever looks at.
 */
describe('the tile vocabulary', () => {
  const scaled: Transform = { scale: 4, dx: 0, dy: 0 };

  it.each(MARKS)('draws the %s mark', (mark) => {
    const mask = maskFor(
      MARK_ART[mark].flatMap((shape) => shapePolygons(shape, scaled)),
      256,
      256,
    );
    expect(coverage(mask)).toBeGreaterThan(100);
  });

  it.each(FIELDS.filter((field) => field !== 'plain'))('draws the %s field', (field) => {
    const mask = maskFor(
      FIELD_ART[field].flatMap((shape) => shapePolygons(shape, scaled)),
      256,
      256,
    );
    expect(coverage(mask)).toBeGreaterThan(100);
  });

  it.each(CHIPS)('draws the %s chip', (chip) => {
    const mask = maskFor(
      CHIP_ART[chip].flatMap((shape) => shapePolygons(shape, scaled)),
      256,
      256,
    );
    expect(coverage(mask)).toBeGreaterThan(100);
  });

  /** `plain` is the absence of a texture, and drawing anything for it would be a bug. */
  it('draws nothing for the plain field', () => {
    expect(FIELD_ART.plain).toEqual([]);
  });
});
