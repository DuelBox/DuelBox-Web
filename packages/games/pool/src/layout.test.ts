import { describe, expect, it } from 'vitest';
import { NO_INSETS, fitViewport, vec2, viewportToLogical } from '@duelbox/engine';
import type { LogicalSize, SafeAreaInsets } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  CUSHION,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  cueBall,
  createGame,
  onTable,
} from './rules.js';
import {
  CUE_SPAN,
  CUE_STROKE_MARGIN,
  FOUL_ROW,
  FOUL_SIZE,
  GUIDE_STROKE_MARGIN,
  MIN_PULL_SPAN,
  PULL_DEADZONE,
  PULL_FOR_FULL_POWER,
  STATUS_ROW,
  STATUS_SIZE,
  STRIP_TOP,
  cueLength,
  cueTip,
  guideLength,
  powerForPull,
  pullSpan,
  roomAlong,
  rowCentre,
} from './layout.js';

/**
 * Pool at every screen size and in both orientations (#1965).
 *
 * The first action item of that issue — "render from the game's fixed logical resolution,
 * scaled to fit and letterboxed, never lay out from pixel values" — is true of this game by
 * construction and could not be otherwise: `manifest.logical` is a fixed 1000 x 640, the
 * host fits it with `fitViewport` and letterboxes the remainder, `Canvas2DRenderer` clips
 * the frame to it, and there is not one device API anywhere under `packages/games/pool/src`.
 * The tests below therefore spend almost nothing on that and everything on the two things
 * that were *not* free: what the game draws outside its own box, and a control whose reach
 * depended on how much screen happened to lie beyond the canvas.
 *
 * Everything here is a pure function of the logical size, which is what makes it testable in
 * node with no DOM at all. Where a screen size appears it is a *viewport* handed to the
 * engine's own `fitViewport`, never a number this game knows about.
 */

const LOGICAL: LogicalSize = manifest.logical;

/** The rectangle a resting ball's centre can occupy — `onTable`, as bounds. */
const BALL_MIN_X = CUSHION + BALL_RADIUS;
const BALL_MAX_X = TABLE_WIDTH - CUSHION - BALL_RADIUS;
const BALL_MIN_Y = CUSHION + BALL_RADIUS;
const BALL_MAX_Y = TABLE_HEIGHT - CUSHION - BALL_RADIUS;

/** Every legal resting place for the cue ball, on a grid dense enough to reach the rails. */
function* restingPlaces(): Generator<readonly [number, number]> {
  for (let x = BALL_MIN_X; x <= BALL_MAX_X; x += 50) {
    for (let y = BALL_MIN_Y; y <= BALL_MAX_Y; y += 42) {
      yield [x, y];
    }
  }
}

/** Thirty-two shot directions, so the rail-on cases are hit head-on and obliquely. */
function* directions(): Generator<readonly [number, number]> {
  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2;
    yield [Math.cos(angle), Math.sin(angle)];
  }
}

function inside(x: number, y: number, slack = 1e-9): boolean {
  return x >= -slack && x <= LOGICAL.width + slack && y >= -slack && y <= LOGICAL.height + slack;
}

describe('the status strip stays inside the logical box', () => {
  /**
   * The bug this replaces, stated as a number.
   *
   * The foul message was drawn at `TABLE_HEIGHT + 80`, which is 640 — the bottom edge of the
   * box exactly. `Renderer.text` takes `y` as the centre of the line, so half of every foul
   * message was outside the box, where `beginFrame`'s clip removed it, at every screen size.
   */
  it('would have clipped the old foul row, and does not clip the new one', () => {
    const oldCentre = TABLE_HEIGHT + 80;
    expect(oldCentre + FOUL_SIZE / 2, 'the old placement ran past the bottom edge').toBeGreaterThan(
      LOGICAL.height,
    );

    const centre = rowCentre(LOGICAL, FOUL_ROW, FOUL_SIZE);
    expect(centre - FOUL_SIZE / 2).toBeGreaterThanOrEqual(STRIP_TOP);
    expect(centre + FOUL_SIZE / 2).toBeLessThanOrEqual(LOGICAL.height);
  });

  it('holds a row inside the strip whatever fraction it is asked for', () => {
    // A clamp rather than a corrected constant, so the next arithmetic slip cannot put a row
    // back outside. Asked for the very bottom of the strip, it comes back moved in.
    for (const fraction of [-1, 0, 0.25, 0.5, 0.99, 1, 4]) {
      for (const size of [10, 22, 30, 44]) {
        const centre = rowCentre(LOGICAL, fraction, size);
        expect(
          centre - size / 2,
          `row ${String(fraction)} at ${String(size)}`,
        ).toBeGreaterThanOrEqual(STRIP_TOP);
        expect(centre + size / 2, `row ${String(fraction)} at ${String(size)}`).toBeLessThanOrEqual(
          LOGICAL.height,
        );
      }
    }
  });

  it('keeps the status line above the foul line', () => {
    // Order is the whole reason there are two rows, and a fraction typed the wrong way round
    // would silently overlap them.
    expect(rowCentre(LOGICAL, STATUS_ROW, STATUS_SIZE) + STATUS_SIZE / 2).toBeLessThanOrEqual(
      rowCentre(LOGICAL, FOUL_ROW, FOUL_SIZE) - FOUL_SIZE / 2,
    );
  });

  it('answers rather than divides when the strip is too shallow for the line', () => {
    // A box with no room under the table at all. Nobody should declare one; it should not
    // produce a NaN if somebody does.
    const shallow: LogicalSize = { width: TABLE_WIDTH, height: TABLE_HEIGHT + 4 };
    const centre = rowCentre(shallow, FOUL_ROW, FOUL_SIZE);
    expect(Number.isFinite(centre)).toBe(true);
    expect(centre).toBe(TABLE_HEIGHT + 2);
  });
});

describe('the room behind a ball', () => {
  it('measures to the edge of the box along the direction asked for', () => {
    expect(roomAlong(100, 200, 1, 0, LOGICAL)).toBeCloseTo(900, 9);
    expect(roomAlong(100, 200, -1, 0, LOGICAL)).toBeCloseTo(100, 9);
    expect(roomAlong(100, 200, 0, 1, LOGICAL)).toBeCloseTo(440, 9);
    expect(roomAlong(100, 200, 0, -1, LOGICAL)).toBeCloseTo(200, 9);
  });

  it('takes the nearer of the two edges on a diagonal', () => {
    const root = Math.SQRT1_2;
    // Up and to the left from (100, 200): the top edge is 200 away, the left edge 100, so
    // the left edge is what stops it.
    expect(roomAlong(100, 200, -root, -root, LOGICAL)).toBeCloseTo(100 / root, 9);
  });

  it('lands the far end on the boundary, whatever the direction', () => {
    // Offenders collected and asserted once rather than a bare expect per iteration: six and
    // a half thousand assertions cost seconds of the suite's budget and say less when one of
    // them fails than a list naming the position and the direction does.
    const offenders: string[] = [];
    for (const [x, y] of restingPlaces()) {
      for (const [dx, dy] of directions()) {
        const room = roomAlong(x, y, dx, dy, LOGICAL);
        const where = `${String(x)},${String(y)} along ${dx.toFixed(2)},${dy.toFixed(2)}`;
        if (!inside(x + dx * room, y + dy * room, 1e-6)) offenders.push(`${where} ran out`);
        // And it is the *far* end: a hair further is outside.
        if (inside(x + dx * (room + 0.01), y + dy * (room + 0.01), 0)) {
          offenders.push(`${where} stopped short`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('returns nothing for a degenerate or impossible direction', () => {
    expect(roomAlong(100, 200, 0, 0, LOGICAL)).toBe(0);
    expect(roomAlong(100, 200, Number.NaN, 1, LOGICAL)).toBe(0);
    // Already outside the box: there is no room, rather than a negative amount of it.
    expect(roomAlong(-10, 200, -1, 0, LOGICAL)).toBe(0);
  });
});

describe('the pull is bounded by the play area, not by the screen', () => {
  /**
   * The defect, stated as a number before the property that fixes it.
   *
   * A resting ball is at least `CUSHION + BALL_RADIUS` = 49 units from the edge of the box,
   * and the flat 260-unit draw the power scale used to assume does not fit in 49 units. So
   * the finger had to go somewhere that was not on the canvas: into the letterbox bar if the
   * screen had one, and off the glass entirely if it did not.
   */
  it('could not have offered a full draw from a ball on the cushion', () => {
    const room = roomAlong(BALL_MIN_X, BALL_MIN_Y, -1, 0, LOGICAL);
    expect(room).toBeCloseTo(BALL_MIN_X, 9);
    expect(room, 'the old flat draw did not fit behind a ball on the rail').toBeLessThan(
      PULL_FOR_FULL_POWER,
    );
  });

  it('offers full power from every legal ball position in every direction', () => {
    let tightest = Number.POSITIVE_INFINITY;
    const offenders: string[] = [];
    for (const [x, y] of restingPlaces()) {
      expect(onTable(x, y), `${String(x)},${String(y)} is a legal resting place`).toBe(true);
      for (const [dx, dy] of directions()) {
        // To shoot along (dx, dy) the finger pulls the other way.
        const room = roomAlong(x, y, -dx, -dy, LOGICAL);
        const span = pullSpan(room);
        const where = `${String(x)},${String(y)} shooting ${dx.toFixed(2)},${dy.toFixed(2)}`;
        // The finger that means full power is on the canvas, not beyond it.
        if (span > room + 1e-9) offenders.push(`${where}: draw ${span.toFixed(1)} > room`);
        if (!inside(x - dx * span, y - dy * span, 1e-6)) offenders.push(`${where}: off the box`);
        if (powerForPull(span, room) !== 1) offenders.push(`${where}: full draw is not full`);
        // And there is a real range between "not a shot" and "as hard as it goes".
        if (span <= PULL_DEADZONE) offenders.push(`${where}: draw collapsed to the deadzone`);
        if (span < tightest) tightest = span;
      }
    }
    expect(offenders).toEqual([]);
    // The tightest draw on the table is a ball on a side cushion played straight off it: 49
    // units, of which the first 18 are the deadzone. Recorded so that a change which
    // squeezes it further has to come past this line.
    expect(tightest).toBeCloseTo(BALL_MIN_X, 6);
  });

  it('never lets the power scale collapse, even for a ball sitting in a pocket', () => {
    // A potted cue ball keeps its position and can be within a couple of units of the top
    // edge. `strike` refuses to fire one, but the aim is still read while the table settles.
    expect(pullSpan(2)).toBe(MIN_PULL_SPAN);
    expect(pullSpan(0)).toBe(MIN_PULL_SPAN);
    expect(pullSpan(Number.NaN)).toBe(MIN_PULL_SPAN);
    expect(powerForPull(1, 0)).toBeCloseTo(1 / MIN_PULL_SPAN, 9);
  });

  it('caps the draw on open table so a full pull is still a gesture, not a journey', () => {
    expect(pullSpan(900)).toBe(PULL_FOR_FULL_POWER);
    expect(powerForPull(PULL_FOR_FULL_POWER / 2, 900)).toBeCloseTo(0.5, 9);
  });

  it('saturates at the edge of the box, so a screen with bars to drag into buys nothing', () => {
    // The fairness property, and it comes from the span alone. A finger at the edge of the
    // play area is already full power, so the letterbox bars a 4K desktop has and a phone
    // does not are worth exactly nothing — which is why the pointer is deliberately not
    // clamped in `game.ts`, and why the clamp that once was there guarded nothing.
    const room = roomAlong(BALL_MIN_X, 300, -1, 0, LOGICAL);
    expect(powerForPull(room, room), 'the edge of the box is a full shot').toBe(1);
    expect(powerForPull(room * 20, room), 'and twenty times further is the same shot').toBe(1);
  });
});

describe('nothing the aim draws leaves the box', () => {
  /**
   * A stroked line is wider than the line, and the corners are where it shows.
   *
   * The end of a 7-unit stroke is a rectangle three and a half units either side of the
   * centre line, so a cue butt sitting exactly on the boundary on a diagonal puts a corner
   * about two and a half units past it. Both checks below measure the *corners*, which is
   * why `roomAlong` takes a margin at all.
   */
  function strokeCornersInside(
    x: number,
    y: number,
    dx: number,
    dy: number,
    from: number,
    to: number,
    lineWidth: number,
  ): boolean {
    const half = lineWidth / 2;
    for (const along of [from, to]) {
      const px = x + dx * along;
      const py = y + dy * along;
      // The normal to the line, which is where a stroke's width goes.
      if (!inside(px - dy * half, py + dx * half, 1e-6)) return false;
      if (!inside(px + dy * half, py - dx * half, 1e-6)) return false;
    }
    return true;
  }

  it('stops the guide line at the cushion rather than past it', () => {
    const offenders: string[] = [];
    for (const [x, y] of restingPlaces()) {
      for (const [dx, dy] of directions()) {
        const room = roomAlong(x, y, dx, dy, LOGICAL, GUIDE_STROKE_MARGIN);
        for (const power of [0, 0.5, 1]) {
          const length = guideLength(room, power);
          if (length > room + 1e-9 || !strokeCornersInside(x, y, dx, dy, 0, length, 3)) {
            offenders.push(`${String(x)},${String(y)} at power ${String(power)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the whole cue on the table at every power and every position', () => {
    const offenders: string[] = [];
    for (const [x, y] of restingPlaces()) {
      for (const [dx, dy] of directions()) {
        const room = roomAlong(x, y, -dx, -dy, LOGICAL, CUE_STROKE_MARGIN);
        const length = cueLength(room);
        for (const power of [0, 0.25, 0.75, 1]) {
          const tip = cueTip(room, power);
          const butt = tip + length;
          const where = `${String(x)},${String(y)} at power ${String(power)}`;
          if (!(tip > 0)) offenders.push(`${where}: the tip is through the ball`);
          if (butt > room + 1e-9 || !strokeCornersInside(x, y, -dx, -dy, tip, butt, 7)) {
            offenders.push(`${where}: the butt is off the table`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('draws the cue further back for a harder shot, wherever the ball is', () => {
    for (const room of [49, 120, CUE_SPAN, 900]) {
      expect(cueTip(room, 1)).toBeGreaterThan(cueTip(room, 0));
    }
  });

  it('shows a ball in the middle of the table the cue this game has always drawn', () => {
    // The old cue sat 34 to 154 units behind the ball and was 150 long. Close enough that a
    // player does not see a change on open table, which is where they spend most of a frame.
    expect(cueTip(CUE_SPAN, 0)).toBeCloseTo(21, 6);
    expect(cueTip(CUE_SPAN, 1)).toBeCloseTo(135, 6);
    expect(cueLength(CUE_SPAN)).toBeCloseTo(165, 6);
  });
});

/**
 * The responsive check, run against the engine's own letterbox rather than a model of it.
 *
 * The classes are the ones `docs/responsive.md` names — compact, phone, tablet, laptop, wide
 * — plus 4K, each at the width the class begins at and a plausible height, and each run in
 * both orientations. What is asserted is what the letterbox promises and what CLAUDE.md rule
 * 9 requires: the whole logical box is visible, in its own aspect, inside the viewport, with
 * the surplus as bars. Board sizes this produces, for the record and computed from these
 * very numbers: 320x205 at compact portrait, 500x320 at compact landscape, 640x410 at
 * tablet portrait, 1406x900 at wide landscape and 3375x2160 at 4K landscape.
 */
describe('every named device class, in both orientations', () => {
  const CLASSES = [
    { name: 'compact', width: 320, height: 568 },
    { name: 'phone', width: 480, height: 800 },
    { name: 'tablet', width: 640, height: 960 },
    { name: 'laptop', width: 768, height: 1024 },
    { name: 'wide', width: 900, height: 1440 },
    { name: '4K', width: 2160, height: 3840 },
  ] as const;

  function check(label: string, width: number, height: number, insets: SafeAreaInsets): void {
    const view = fitViewport(LOGICAL, width, height, insets);
    expect(view.scale, `${label} collapsed`).toBeGreaterThan(0);

    const availableWidth = width - insets.left - insets.right;
    const availableHeight = height - insets.top - insets.bottom;

    // It fits, so the page has nothing to scroll sideways to reach.
    expect(view.width, `${label} overflowed sideways`).toBeLessThanOrEqual(availableWidth + 1e-9);
    expect(view.height, `${label} overflowed downwards`).toBeLessThanOrEqual(
      availableHeight + 1e-9,
    );

    // It is not stretched: one aspect, both axes, always.
    expect(view.width / view.height).toBeCloseTo(LOGICAL.width / LOGICAL.height, 9);

    // It is inside the safe rectangle, which is what "clear of the notch" means once the
    // insets are handed to the fit. (The host passes NO_INSETS on purpose and lets the
    // shell's padding do it — docs/responsive.md — so this is the property, not the path.)
    expect(view.offsetX, `${label} started left of the safe area`).toBeGreaterThanOrEqual(
      insets.left - 1e-9,
    );
    expect(view.offsetY, `${label} started above the safe area`).toBeGreaterThanOrEqual(
      insets.top - 1e-9,
    );

    // And nothing is cropped: the four corners of the drawn area are the four corners of the
    // logical box. Rule 9 — a bigger screen gets bars, never more of the table.
    const corner = vec2();
    viewportToLogical(corner, view.offsetX, view.offsetY, view);
    expect(corner.x).toBeCloseTo(0, 6);
    expect(corner.y).toBeCloseTo(0, 6);
    viewportToLogical(corner, view.offsetX + view.width, view.offsetY + view.height, view);
    expect(corner.x).toBeCloseTo(LOGICAL.width, 6);
    expect(corner.y).toBeCloseTo(LOGICAL.height, 6);
  }

  for (const device of CLASSES) {
    it(`fits and letterboxes at ${device.name}, portrait and landscape`, () => {
      check(`${device.name} portrait`, device.width, device.height, NO_INSETS);
      check(`${device.name} landscape`, device.height, device.width, NO_INSETS);
    });
  }

  it('stays inside a real cutout in both orientations', () => {
    // The insets an iPhone actually reports, as `e2e/safe-area.spec.ts` sets them out: the
    // cutout is on the short edges, so portrait insets top and bottom and landscape insets
    // left and right. A generous number on all four sides at once describes no phone.
    check('notched portrait', 393, 852, { top: 59, right: 0, bottom: 34, left: 0 });
    check('notched landscape', 852, 393, { top: 0, right: 59, bottom: 21, left: 59 });
  });

  it('declares the orientation its own box is', () => {
    // `shouldPromptRotate` in apps/web compares `manifest.orientation` against the viewport's
    // shape and shows a non-blocking "turn the device" hint when they disagree. A box that
    // did not match its own declaration would aim that prompt at the wrong orientation, and
    // nothing between here and there would notice. Same rule as `orientationOf`: wider than
    // tall is landscape, and a square is portrait.
    const shape = LOGICAL.width > LOGICAL.height ? 'landscape' : 'portrait';
    expect(manifest.orientation).toBe(shape);
  });

  it('simulates a table that fits the box it declares', () => {
    // The other half of the same consistency: the table and its status strip are what the
    // box is sized for, so a change to either has to be a change to both.
    expect(LOGICAL.width).toBe(TABLE_WIDTH);
    expect(LOGICAL.height).toBeGreaterThan(TABLE_HEIGHT);
    expect(STRIP_TOP).toBe(TABLE_HEIGHT);
  });

  it('starts the cue ball somewhere both the box and the table agree about', () => {
    const start = cueBall(createGame());
    expect(onTable(start.x, start.y)).toBe(true);
    expect(inside(start.x, start.y)).toBe(true);
  });
});
