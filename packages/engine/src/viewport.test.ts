import { describe, it, expect } from 'vitest';
import {
  NO_INSETS,
  clampDevicePixelRatio,
  fitViewport,
  isInsideLogical,
  logicalToViewport,
  negotiateSharedLogical,
  negotiateSharedViewport,
  screenOrientation,
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

describe('screenOrientation', () => {
  it('reads a real screen the way a person holding it would', () => {
    expect(screenOrientation(320, 568)).toBe('portrait');
    expect(screenOrientation(393, 852)).toBe('portrait');
    expect(screenOrientation(768, 1024)).toBe('portrait');
    expect(screenOrientation(844, 390)).toBe('landscape');
    expect(screenOrientation(1440, 900)).toBe('landscape');
    expect(screenOrientation(3440, 1440)).toBe('landscape');
  });

  it('answers null while the screen has no shape, rather than flapping', () => {
    // The frame or two in the middle of a real rotation, and the collapsed window
    // `fitViewport` already answers with scale 0 rather than a throw. A function that had to
    // pick one of two words here would pick a different one each frame, and a rotate hint
    // downstream of it would blink on and off while the device turned.
    expect(screenOrientation(0, 0)).toBeNull();
    expect(screenOrientation(390, 0)).toBeNull();
    expect(screenOrientation(0, 844)).toBeNull();
    expect(screenOrientation(-390, 844)).toBeNull();
    expect(screenOrientation(Number.NaN, 844)).toBeNull();
    expect(screenOrientation(390, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('breaks the square tie towards landscape, and the tie costs no player anything', () => {
    expect(screenOrientation(800, 800)).toBe('landscape');

    // Why the arbitrary tie-break is free: on a square screen a box and that same box turned
    // on its side letterbox to exactly the same drawn area, so whichever way the tie falls,
    // neither player gets a larger board out of it. This is the claim `screenOrientation`'s
    // docstring makes, asserted rather than left standing.
    const upright = fitViewport({ width: 600, height: 1000 }, 800, 800);
    const sideways = fitViewport({ width: 1000, height: 600 }, 800, 800);
    expect(upright.scale).toBe(sideways.scale);
    expect(upright.width * upright.height).toBe(sideways.width * sideways.height);
  });

  it('cannot be used as a device query from inside a game', () => {
    // Rule 10 in the one form it can be checked here. A game is handed a LogicalSize and
    // never a screen size, so the only argument it *has* to pass is its own box — and the
    // answer to that is a constant of the match, identical on a phone and on a laptop, which
    // tells the game nothing whatever about the device it is running on.
    const box = { width: 600, height: 1000 };
    expect(screenOrientation(box.width, box.height)).toBe('portrait');
    expect(screenOrientation(box.width, box.height)).toBe(screenOrientation(600, 1000));
  });
});

/**
 * A match survives being turned over, and the naive way to implement #1886 does not.
 *
 * #1886 asks for two things that pull against each other: "re-layout rather than letterbox
 * where the game supports both", and "never lose match state across an orientation change".
 * Rule 8 leaves exactly one lever for the first — the *logical size* a game is given — and
 * pulling that lever mid-match is what breaks the second, because every position a game holds
 * is expressed in that box. So the design is: the box is chosen once, when the match starts,
 * and a rotation after that changes the letterboxing and nothing else.
 *
 * Asserting only the first half of that would be worth very little: a simulation stepped
 * across a resize is trivially unchanged if nothing in the test ever varies the box, and a
 * test that cannot fail is a test nobody has seen. So the second half is here too — the same
 * simulation, driven across the same rotation with the box re-chosen from the screen — and it
 * is required to *diverge*. That is what makes the first assertion mean something.
 */
describe('a rotation mid-match', () => {
  const PORTRAIT_BOX = { width: 600, height: 1000 };
  /** What a game supporting both orientations would declare as its second box. */
  const LANDSCAPE_BOX = { width: 1000, height: 600 };

  interface Puck {
    x: number;
    y: number;
    vx: number;
    vy: number;
  }

  /**
   * One fixed step of a deterministic simulation that genuinely depends on its box: a puck
   * reflecting off the four walls. Nothing here is a pixel — the arguments are logical units,
   * which is the only thing a game is ever handed.
   */
  function step(puck: Puck, box: { width: number; height: number }): void {
    puck.x += puck.vx;
    puck.y += puck.vy;
    if (puck.x < 0) {
      puck.x = -puck.x;
      puck.vx = -puck.vx;
    } else if (puck.x > box.width) {
      puck.x = 2 * box.width - puck.x;
      puck.vx = -puck.vx;
    }
    if (puck.y < 0) {
      puck.y = -puck.y;
      puck.vy = -puck.vy;
    } else if (puck.y > box.height) {
      puck.y = 2 * box.height - puck.y;
      puck.vy = -puck.vy;
    }
  }

  /** The screens one phone passes through when somebody turns it over mid-rally. */
  const SCREENS: readonly { readonly label: string; readonly w: number; readonly h: number }[] = [
    { label: 'upright', w: 390, h: 844 },
    // Real devices report a zero-height frame part-way through a rotation; the match must not
    // notice it any more than it notices the two orientations either side of it.
    { label: 'mid-turn', w: 390, h: 0 },
    { label: 'sideways', w: 844, h: 390 },
    { label: 'upright again', w: 390, h: 844 },
  ];

  const STEPS_PER_SCREEN = 60;

  /**
   * Steps the puck through every screen in turn, refitting the viewport at each one, and
   * returns the state after every step. `chooseBox` is the whole variable under test: the
   * design freezes the box at match start, and the counterfactual re-derives it from the
   * screen the way "re-layout on rotate" would.
   */
  function play(chooseBox: (w: number, h: number) => { width: number; height: number }): {
    readonly trace: readonly string[];
    readonly boxes: readonly string[];
  } {
    const puck: Puck = { x: 137, y: 251, vx: 23, vy: 41 };
    const trace: string[] = [];
    const boxes: string[] = [];
    for (const screenSize of SCREENS) {
      const box = chooseBox(screenSize.w, screenSize.h);
      const shared = negotiateSharedViewport(
        { logical: box, screenWidth: screenSize.w, screenHeight: screenSize.h, insets: NO_INSETS },
        box,
      );
      boxes.push(`${String(shared.view.logicalWidth)}x${String(shared.view.logicalHeight)}`);
      for (let i = 0; i < STEPS_PER_SCREEN; i += 1) {
        step(puck, shared.logical);
        trace.push(`${puck.x.toFixed(6)},${puck.y.toFixed(6)}`);
      }
    }
    return { trace, boxes };
  }

  /** The design: the box is settled at match start and the screen is never asked again. */
  const frozen = () => PORTRAIT_BOX;

  /** The tempting implementation of "re-layout rather than letterbox", asked every frame. */
  const perScreen = (w: number, h: number) =>
    screenOrientation(w, h) === 'landscape' ? LANDSCAPE_BOX : PORTRAIT_BOX;

  it('preserves the simulation exactly, step for step', () => {
    const rotated = play(frozen);
    // The same match played out on one screen that never moves. Identical, to the digit.
    const still = (() => {
      const puck: Puck = { x: 137, y: 251, vx: 23, vy: 41 };
      const trace: string[] = [];
      for (let i = 0; i < SCREENS.length * STEPS_PER_SCREEN; i += 1) {
        step(puck, PORTRAIT_BOX);
        trace.push(`${puck.x.toFixed(6)},${puck.y.toFixed(6)}`);
      }
      return trace;
    })();
    expect(rotated.trace).toEqual(still);
  });

  it('hands the game the same box on every screen it passes through, collapsed included', () => {
    // The state-preservation guarantee, stated as the property that produces it: the pair the
    // host holds for a match is a fixed box plus a letterboxing of it, and only the second
    // half is allowed to move. A collapsed frame in the middle of the turn keeps the box too.
    const { boxes } = play(frozen);
    expect(boxes).toEqual(['600x1000', '600x1000', '600x1000', '600x1000']);
    expect(screenOrientation(390, 0)).toBeNull();
  });

  it('would lose the match state if the box were re-chosen from the screen', () => {
    // The counterfactual, and the reason the first assertion above is worth writing. Nothing
    // in `play` changed but the one function that picks the box; the puck is in a different
    // place from the first step after the turn onwards, which mid-rally is a match two people
    // just lost to a gesture neither thought of as an input.
    const frozenPlay = play(frozen);
    const rebuilt = play(perScreen);
    expect(rebuilt.boxes).toEqual(['600x1000', '600x1000', '1000x600', '600x1000']);
    expect(rebuilt.trace).not.toEqual(frozenPlay.trace);

    // And precisely where it diverges: everything before the turn matches, and the first step
    // after it does not.
    const beforeTurn = 2 * STEPS_PER_SCREEN;
    expect(rebuilt.trace.slice(0, beforeTurn)).toEqual(frozenPlay.trace.slice(0, beforeTurn));
    expect(rebuilt.trace[beforeTurn]).not.toBe(frozenPlay.trace[beforeTurn]);
  });
});
