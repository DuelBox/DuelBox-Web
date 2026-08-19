import { describe, it, expect } from 'vitest';
import {
  NO_INSETS,
  clampDevicePixelRatio,
  fitViewport,
  isInsideLogical,
  logicalToViewport,
  negotiateSharedLogical,
  viewportToLogical,
} from './viewport.js';

const SQUARE = { width: 600, height: 600 };
const WIDE = { width: 400, height: 300 };

describe('fitViewport', () => {
  it('letterboxes a square logical box left and right on a wide screen', () => {
    const view = fitViewport(SQUARE, 1000, 600);

    expect(view.scale).toBe(1);
    expect(view.width).toBe(600);
    expect(view.height).toBe(600);
    expect(view.offsetX).toBe(200);
    expect(view.offsetY).toBe(0);

    const leftBar = view.offsetX;
    const rightBar = 1000 - (view.offsetX + view.width);
    expect(leftBar).toBe(rightBar);
  });

  it('letterboxes a square logical box top and bottom on a tall screen', () => {
    const view = fitViewport(SQUARE, 600, 1000);

    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(200);

    const topBar = view.offsetY;
    const bottomBar = 1000 - (view.offsetY + view.height);
    expect(topBar).toBe(bottomBar);
  });

  it('fills the screen with no offsets when the aspect matches exactly', () => {
    const view = fitViewport({ width: 800, height: 600 }, 1600, 1200);

    expect(view.scale).toBe(2);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
    expect(view.width).toBe(1600);
    expect(view.height).toBe(1200);
  });

  it('never shows more of the world on a wider screen', () => {
    const narrow = fitViewport(SQUARE, 600, 600);
    const wide = fitViewport(SQUARE, 4000, 600);

    expect(wide.logicalWidth).toBe(narrow.logicalWidth);
    expect(wide.logicalHeight).toBe(narrow.logicalHeight);
    expect(wide.scale).toBe(narrow.scale);
    // The extra 3400px is bar, not field of view.
    expect(wide.width).toBe(narrow.width);
  });

  it('shrinks and re-centres inside the safe area', () => {
    const insets = { top: 10, right: 50, bottom: 30, left: 150 };
    const view = fitViewport({ width: 200, height: 100 }, 800, 400, insets);

    // Available area is 600 x 360; the 2:1 box is width-bound.
    expect(view.scale).toBe(3);
    expect(view.width).toBe(600);
    expect(view.height).toBe(300);
    expect(view.offsetX).toBe(150);
    expect(view.offsetY).toBe(40);

    // Equal margins measured from the safe-area edges, not the screen edges.
    expect(view.offsetX - insets.left).toBe(800 - insets.right - (view.offsetX + view.width));
    expect(view.offsetY - insets.top).toBe(400 - insets.bottom - (view.offsetY + view.height));
  });

  it('defaults to no insets', () => {
    const implicit = fitViewport(SQUARE, 1000, 600);
    const explicit = fitViewport(SQUARE, 1000, 600, NO_INSETS);
    expect(implicit).toEqual(explicit);
    expect(NO_INSETS).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('returns scale 0 and zero size for a collapsed window instead of throwing', () => {
    const collapsed = fitViewport(SQUARE, 0, 0);
    expect(collapsed.scale).toBe(0);
    expect(collapsed.width).toBe(0);
    expect(collapsed.height).toBe(0);
    expect(collapsed.logicalWidth).toBe(600);
    expect(collapsed.logicalHeight).toBe(600);

    const zeroHeight = fitViewport(SQUARE, 800, 0);
    expect(zeroHeight.scale).toBe(0);

    const overInset = fitViewport(SQUARE, 300, 200, { top: 0, right: 200, bottom: 0, left: 200 });
    expect(overInset.scale).toBe(0);
    expect(overInset.width).toBe(0);

    const negativeScreen = fitViewport(SQUARE, -100, -100);
    expect(negativeScreen.scale).toBe(0);
  });

  it('throws RangeError for a logical dimension that is not positive and finite', () => {
    expect(() => fitViewport({ width: 0, height: 600 }, 800, 600)).toThrow(RangeError);
    expect(() => fitViewport({ width: 600, height: 0 }, 800, 600)).toThrow(RangeError);
    expect(() => fitViewport({ width: -600, height: 600 }, 800, 600)).toThrow(RangeError);
    expect(() => fitViewport({ width: Number.NaN, height: 600 }, 800, 600)).toThrow(RangeError);
    expect(() => fitViewport({ width: 600, height: Number.POSITIVE_INFINITY }, 800, 600)).toThrow(
      RangeError,
    );
  });
});

describe('viewportToLogical / logicalToViewport', () => {
  // scale 2, offsetX 400, offsetY 0.
  const view = fitViewport(WIDE, 1600, 600);

  it('round-trips exactly at the corners and the centre', () => {
    const points: readonly (readonly [number, number])[] = [
      [0, 0],
      [400, 0],
      [0, 300],
      [400, 300],
      [200, 150],
    ];
    const screenPoint = { x: 0, y: 0 };
    const back = { x: 0, y: 0 };

    for (const point of points) {
      const [lx, ly] = point;
      logicalToViewport(screenPoint, lx, ly, view);
      viewportToLogical(back, screenPoint.x, screenPoint.y, view);
      expect(back.x).toBe(lx);
      expect(back.y).toBe(ly);
    }
  });

  it('round-trips exactly from screen space, including inside a safe area', () => {
    // Height-bound at scale 2, offsets 420 / 40: every value below is exact in binary.
    const inset = fitViewport(WIDE, 1600, 700, { top: 40, right: 60, bottom: 60, left: 100 });
    expect(inset.scale).toBe(2);
    expect(inset.offsetX).toBe(420);
    expect(inset.offsetY).toBe(40);

    const logical = { x: 0, y: 0 };
    const screenPoint = { x: 0, y: 0 };

    for (let sx = 0; sx <= 1600; sx += 100) {
      for (let sy = 0; sy <= 700; sy += 100) {
        viewportToLogical(logical, sx, sy, inset);
        logicalToViewport(screenPoint, logical.x, logical.y, inset);
        expect(screenPoint.x).toBe(sx);
        expect(screenPoint.y).toBe(sy);
      }
    }
  });

  it('maps the logical origin to the top-left of the drawn area', () => {
    const out = { x: 0, y: 0 };
    logicalToViewport(out, 0, 0, view);
    expect(out.x).toBe(view.offsetX);
    expect(out.y).toBe(view.offsetY);

    logicalToViewport(out, view.logicalWidth, view.logicalHeight, view);
    expect(out.x).toBe(view.offsetX + view.width);
    expect(out.y).toBe(view.offsetY + view.height);
  });

  it('maps letterbox pixels to logical coordinates outside the arena', () => {
    const out = { x: 0, y: 0 };
    viewportToLogical(out, 0, 300, view);
    expect(out.x).toBeLessThan(0);
    expect(isInsideLogical(out.x, out.y, WIDE)).toBe(false);
  });

  it('writes (0, 0) when the viewport is collapsed', () => {
    const collapsed = fitViewport(WIDE, 0, 0);
    const out = { x: 123, y: 456 };
    viewportToLogical(out, 500, 500, collapsed);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('writes into the out parameter and returns it without allocating', () => {
    const out = Object.seal({ x: 0, y: 0 });

    for (let i = 0; i < 64; i++) {
      expect(viewportToLogical(out, i, i, view)).toBe(out);
      expect(logicalToViewport(out, i, i, view)).toBe(out);
    }
    expect(Object.keys(out)).toEqual(['x', 'y']);
  });

  it('assigns x and y exactly once per call', () => {
    let xValue = 0;
    let yValue = 0;
    let xWrites = 0;
    let yWrites = 0;
    const probe = {
      get x(): number {
        return xValue;
      },
      set x(value: number) {
        xWrites++;
        xValue = value;
      },
      get y(): number {
        return yValue;
      },
      set y(value: number) {
        yWrites++;
        yValue = value;
      },
    };

    logicalToViewport(probe, 100, 50, view);
    expect(xWrites).toBe(1);
    expect(yWrites).toBe(1);
    expect(probe.x).toBe(600);
    expect(probe.y).toBe(100);

    viewportToLogical(probe, probe.x, probe.y, view);
    expect(xWrites).toBe(2);
    expect(yWrites).toBe(2);
    expect(probe.x).toBe(100);
    expect(probe.y).toBe(50);
  });
});

describe('isInsideLogical', () => {
  it('accepts interior points and the bounds themselves', () => {
    expect(isInsideLogical(200, 150, WIDE)).toBe(true);
    expect(isInsideLogical(0, 0, WIDE)).toBe(true);
    expect(isInsideLogical(400, 300, WIDE)).toBe(true);
  });

  it('rejects points beyond any edge', () => {
    expect(isInsideLogical(-0.001, 150, WIDE)).toBe(false);
    expect(isInsideLogical(400.001, 150, WIDE)).toBe(false);
    expect(isInsideLogical(200, -1, WIDE)).toBe(false);
    expect(isInsideLogical(200, 301, WIDE)).toBe(false);
    expect(isInsideLogical(Number.NaN, 150, WIDE)).toBe(false);
  });
});

describe('clampDevicePixelRatio', () => {
  it('clamps to [1, 2] by default', () => {
    expect(clampDevicePixelRatio(0.5)).toBe(1);
    expect(clampDevicePixelRatio(1)).toBe(1);
    expect(clampDevicePixelRatio(1.5)).toBe(1.5);
    expect(clampDevicePixelRatio(2)).toBe(2);
    expect(clampDevicePixelRatio(3)).toBe(2);
  });

  it('returns 1 for a non-finite or non-positive ratio', () => {
    expect(clampDevicePixelRatio(Number.NaN)).toBe(1);
    expect(clampDevicePixelRatio(-1)).toBe(1);
    expect(clampDevicePixelRatio(0)).toBe(1);
    expect(clampDevicePixelRatio(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampDevicePixelRatio(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it('honours an explicit ceiling and ignores a nonsensical one', () => {
    expect(clampDevicePixelRatio(3, 3)).toBe(3);
    expect(clampDevicePixelRatio(4, 3)).toBe(3);
    expect(clampDevicePixelRatio(3, 0.5)).toBe(1);
    expect(clampDevicePixelRatio(3, Number.NaN)).toBe(1);
  });
});

describe('negotiateSharedLogical', () => {
  const pairs: readonly (readonly [
    { width: number; height: number },
    { width: number; height: number },
  ])[] = [
    [
      { width: 800, height: 600 },
      { width: 1000, height: 500 },
    ],
    [
      { width: 800, height: 600 },
      { width: 1600, height: 600 },
    ],
    [
      { width: 360, height: 800 },
      { width: 1280, height: 720 },
    ],
    [
      { width: 1024, height: 768 },
      { width: 300, height: 900 },
    ],
    [
      { width: 500, height: 500 },
      { width: 500, height: 500 },
    ],
  ];

  it('returns a box no larger than either input', () => {
    for (const pair of pairs) {
      const [a, b] = pair;
      const shared = negotiateSharedLogical(a, b);
      expect(shared.width).toBeLessThanOrEqual(a.width);
      expect(shared.height).toBeLessThanOrEqual(a.height);
      expect(shared.width).toBeLessThanOrEqual(b.width);
      expect(shared.height).toBeLessThanOrEqual(b.height);
      expect(shared.width).toBeGreaterThan(0);
      expect(shared.height).toBeGreaterThan(0);
    }
  });

  it("preserves a's aspect ratio", () => {
    for (const pair of pairs) {
      const [a, b] = pair;
      const shared = negotiateSharedLogical(a, b);
      expect(shared.width / shared.height).toBeCloseTo(a.width / a.height, 10);
    }
  });

  it('is idempotent, and returns a unchanged when both inputs are equal', () => {
    const a = { width: 800, height: 600 };
    expect(negotiateSharedLogical(a, { width: 800, height: 600 })).toEqual(a);

    for (const pair of pairs) {
      const [first, second] = pair;
      const once = negotiateSharedLogical(first, second);
      const twice = negotiateSharedLogical(once, second);
      expect(twice.width).toBeCloseTo(once.width, 10);
      expect(twice.height).toBeCloseTo(once.height, 10);
    }
  });

  it("touches the limiting device's edge when b is shorter", () => {
    const shared = negotiateSharedLogical(
      { width: 800, height: 600 },
      { width: 1000, height: 500 },
    );
    expect(shared.height).toBe(500);
    expect(shared.width).toBeCloseTo(2000 / 3, 10);
  });

  it('gives the wider screen no extra field of view', () => {
    const phone = { width: 360, height: 800 };
    const laptop = { width: 1440, height: 900 };
    const shared = negotiateSharedLogical(phone, laptop);
    // The laptop is larger in both dimensions, so the phone's box is the shared one.
    expect(shared).toEqual(phone);
  });

  it('throws RangeError on a non-positive or non-finite dimension', () => {
    expect(() =>
      negotiateSharedLogical({ width: 0, height: 600 }, { width: 800, height: 600 }),
    ).toThrow(RangeError);
    expect(() =>
      negotiateSharedLogical({ width: 800, height: 600 }, { width: 800, height: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      negotiateSharedLogical({ width: 800, height: Number.NaN }, { width: 800, height: 600 }),
    ).toThrow(RangeError);
  });
});
