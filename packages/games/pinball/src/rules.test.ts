import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { Segment, SeatId } from '@duelbox/engine';
import type { Ball, BotDifficulty, FlipperSide } from './rules.js';
import {
  BALL_RADIUS,
  BOT_AIM_OFFSET,
  BOT_FIRE_LEAD,
  BOT_PROFILES,
  BUMPERS,
  BUMPER_GAIN,
  CENTRE_X,
  CENTRE_Y,
  FLIPPER_COUNT,
  FLIPPER_LENGTH,
  FLIPPER_PIVOT_DX,
  FLIPPER_PIVOT_INSET,
  FLIPPER_RADIUS,
  FLIPPER_REST_ANGLE,
  FLIPPER_RESTITUTION,
  FLIPPER_RISE_SECONDS,
  FLIPPER_FALL_SECONDS,
  FLIPPER_SWING,
  GOAL_HALF_WIDTH,
  MAX_BALL_SPEED,
  MIN_BALL_SPEED,
  MIN_VERTICAL_FRACTION,
  SERVE_OFFSET_X,
  SERVE_OFFSET_Y,
  SERVE_SPEED,
  SERVE_SPREAD,
  SHOULDER_RISE,
  SUBSTEPS,
  TABLE,
  WALLS,
  ballLost,
  ballSpeed,
  botAimLine,
  botFlipperSide,
  clamp,
  clampBallSpeed,
  collideBallBumper,
  collideBallFlipper,
  collideBallWall,
  createBall,
  createBotMemory,
  enforceVertical,
  flipperAngle,
  flipperIndex,
  flipperPhaseRate,
  flipperPivotX,
  flipperPivotY,
  flipperSeatOf,
  flipperSegment,
  flipperSideOf,
  flipperTipX,
  flipperTipY,
  foldIntoBand,
  goalScored,
  launchServe,
  nextFlipperPhase,
  opponentOf,
  otherSide,
  placeServe,
  seatSide,
  serveSpotX,
  serveSpotY,
  stepBall,
  wantsFlipper,
} from './rules.js';

/**
 * The rules of Pinball Duel, tested as pure functions.
 *
 * Two habits run through this file and both were learned the hard way elsewhere in the
 * collection. **Decisions are compared to the bit and measurements to a stated tolerance**:
 * the seats mirror about the centre of the table rather than about zero, so `w - (a + b)`
 * and `(w - a) - b` are not the same double, and a mirrored contact lands within about
 * 1e-9 of its partner rather than exactly on it. And **every loop is bounded** — an
 * unbounded `while` in a test does not fail the suite, it hangs it.
 */

const SEATS: readonly SeatId[] = ['p1', 'p2'];
const SIDES: readonly FlipperSide[] = ['left', 'right'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
const STEP = 1 / 60;
/** Mirroring about the centre of the table costs about this much in the last bits. */
const MIRROR_TOLERANCE = 1e-8;

function ball(x: number, y: number, vx: number, vy: number): Ball {
  return { x, y, vx, vy };
}

function mirrorBall(source: Ball): Ball {
  return {
    x: TABLE.width - source.x,
    y: TABLE.height - source.y,
    vx: -source.vx,
    vy: -source.vy,
  };
}

function mirrorSegment(source: Segment): Segment {
  return {
    x1: TABLE.width - source.x1,
    y1: TABLE.height - source.y1,
    x2: TABLE.width - source.x2,
    y2: TABLE.height - source.y2,
  };
}

/** How far a ball is from its partner's mirror image. Zero would be exact. */
function mirrorGap(a: Ball, b: Ball): number {
  const image = mirrorBall(b);
  return Math.max(
    Math.abs(a.x - image.x),
    Math.abs(a.y - image.y),
    Math.abs(a.vx - image.vx),
    Math.abs(a.vy - image.vy),
  );
}

function segmentKey(seg: Segment): string {
  // Endpoint order is not part of a wall, so a key must not depend on it.
  const a = `${seg.x1.toFixed(6)},${seg.y1.toFixed(6)}`;
  const b = `${seg.x2.toFixed(6)},${seg.y2.toFixed(6)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

describe('the table', () => {
  it('is portrait, so two people can share one phone held upright', () => {
    expect(TABLE.height).toBeGreaterThan(TABLE.width);
  });

  it('puts its centre where both halves meet', () => {
    expect(CENTRE_X).toBe(TABLE.width / 2);
    expect(CENTRE_Y).toBe(TABLE.height / 2);
  });

  it('is its own picture upside down, wall for wall', () => {
    const keys = new Set(WALLS.map(segmentKey));
    expect(keys.size).toBe(WALLS.length);
    for (const wall of WALLS) {
      expect(keys.has(segmentKey(mirrorSegment(wall))), segmentKey(wall)).toBe(true);
    }
  });

  it('is its own picture upside down, bumper for bumper', () => {
    for (const bumper of BUMPERS) {
      const image = BUMPERS.find(
        (candidate) =>
          Math.abs(candidate.x - (TABLE.width - bumper.x)) < 1e-9 &&
          Math.abs(candidate.y - (TABLE.height - bumper.y)) < 1e-9,
      );
      expect(image, `${String(bumper.x)},${String(bumper.y)} has no partner`).toBeDefined();
      expect(image?.radius).toBe(bumper.radius);
    }
  });

  it('keeps every bumper clear of every other bumper by more than a ball', () => {
    for (let i = 0; i < BUMPERS.length; i += 1) {
      for (let j = i + 1; j < BUMPERS.length; j += 1) {
        const a = BUMPERS[i]!;
        const b = BUMPERS[j]!;
        const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
        expect(gap, `bumpers ${String(i)} and ${String(j)}`).toBeGreaterThan(BALL_RADIUS * 2);
      }
    }
  });

  it('keeps every bumper clear of the rails and of both mouths', () => {
    for (const bumper of BUMPERS) {
      expect(bumper.x - bumper.radius).toBeGreaterThan(BALL_RADIUS);
      expect(TABLE.width - bumper.x - bumper.radius).toBeGreaterThan(BALL_RADIUS);
      expect(bumper.y - bumper.radius).toBeGreaterThan(FLIPPER_PIVOT_INSET);
      expect(TABLE.height - bumper.y - bumper.radius).toBeGreaterThan(FLIPPER_PIVOT_INSET);
    }
  });

  it('keeps both serve spots clear of every bumper', () => {
    for (const seat of SEATS) {
      for (const bumper of BUMPERS) {
        const gap =
          Math.hypot(serveSpotX(seat) - bumper.x, serveSpotY(seat) - bumper.y) - bumper.radius;
        expect(gap, `serve at ${seat}`).toBeGreaterThan(BALL_RADIUS);
      }
    }
  });

  it('runs both shoulders steeper than 45 degrees, which is what makes a goal possible', () => {
    // The bug this file exists to keep out. A shoulder whose horizontal run exceeds its drop
    // reflects a ball travelling down the table straight back up it, so it repels the ball
    // from the end it is supposed to feed. The first build of this table had exactly that
    // shape and paid for it in goals and in stalemate re-serves; see SHOULDER_RISE.
    const drop = SHOULDER_RISE - FLIPPER_PIVOT_INSET;
    const run = CENTRE_X - GOAL_HALF_WIDTH;
    expect(drop).toBeGreaterThan(run);
  });

  it('turns a ball falling straight down a shoulder further down the table', () => {
    const shoulder: Segment = {
      x1: 0,
      y1: TABLE.height - SHOULDER_RISE,
      x2: CENTRE_X - GOAL_HALF_WIDTH,
      y2: TABLE.height - FLIPPER_PIVOT_INSET,
    };
    // Placed hard against the wall so the contact resolves on this step.
    const t = 0.5;
    const onWall = {
      x: shoulder.x1 + (shoulder.x2 - shoulder.x1) * t,
      y: shoulder.y1 + (shoulder.y2 - shoulder.y1) * t,
    };
    const subject = ball(onWall.x + 4, onWall.y + 4, 0, 600);
    expect(collideBallWall(subject, shoulder)).toBe(true);
    expect(subject.vy, 'still travelling towards the mouth').toBeGreaterThan(0);
    expect(subject.vx, 'and pushed in towards the middle').toBeGreaterThan(0);
  });

  it('names a mouth wide enough to aim at and narrow enough to defend', () => {
    const mouth = GOAL_HALF_WIDTH * 2;
    expect(mouth / TABLE.width).toBeGreaterThan(0.5);
    expect(mouth / TABLE.width).toBeLessThan(0.75);
  });
});

describe('the flippers', () => {
  it('index four of them, two a seat, and round-trip the index', () => {
    expect(FLIPPER_COUNT).toBe(4);
    const seen = new Set<number>();
    for (const seat of SEATS) {
      for (const side of SIDES) {
        const index = flipperIndex(seat, side);
        seen.add(index);
        expect(flipperSeatOf(index)).toBe(seat);
        expect(flipperSideOf(index)).toBe(side);
      }
    }
    expect(seen.size).toBe(FLIPPER_COUNT);
  });

  it('swaps sides under otherSide and seats under opponentOf', () => {
    expect(otherSide('left')).toBe('right');
    expect(otherSide('right')).toBe('left');
    expect(opponentOf('p1')).toBe('p2');
    expect(opponentOf('p2')).toBe('p1');
  });

  it('stands its pivots on the two goal posts', () => {
    expect(flipperPivotX('left')).toBe(CENTRE_X - FLIPPER_PIVOT_DX);
    expect(flipperPivotX('right')).toBe(CENTRE_X + FLIPPER_PIVOT_DX);
    expect(FLIPPER_PIVOT_DX).toBe(GOAL_HALF_WIDTH);
    expect(flipperPivotY('p1')).toBe(TABLE.height - FLIPPER_PIVOT_INSET);
    expect(flipperPivotY('p2')).toBe(FLIPPER_PIVOT_INSET);
  });

  it('mirrors every pivot onto the other seat and the other side', () => {
    for (const seat of SEATS) {
      for (const side of SIDES) {
        const other = seat === 'p1' ? 'p2' : 'p1';
        expect(flipperPivotX(otherSide(side))).toBeCloseTo(TABLE.width - flipperPivotX(side), 9);
        expect(flipperPivotY(other)).toBeCloseTo(TABLE.height - flipperPivotY(seat), 9);
      }
    }
  });

  it('mirrors every tip onto the other seat and the other side, at every phase', () => {
    for (let step = 0; step <= 10; step += 1) {
      const phase = step / 10;
      for (const side of SIDES) {
        expect(flipperTipX(otherSide(side), phase)).toBeCloseTo(
          TABLE.width - flipperTipX(side, phase),
          8,
        );
      }
      expect(flipperTipY('p2', phase)).toBeCloseTo(TABLE.height - flipperTipY('p1', phase), 8);
    }
  });

  it('seals a resting flipper against its own baseline', () => {
    // A ball needs BALL_RADIUS + FLIPPER_RADIUS of clearance to pass. Less than that under a
    // resting tip means the only way through a resting pair is the gap between the tips.
    for (const seat of SEATS) {
      const tipY = flipperTipY(seat, 0);
      const gap = seat === 'p1' ? TABLE.height - tipY : tipY;
      expect(gap, seat).toBeLessThan(BALL_RADIUS + FLIPPER_RADIUS);
      expect(gap, `${seat} tip must not be through its own baseline`).toBeGreaterThan(0);
    }
  });

  it('reaches past the middle of the mouth when it is raised', () => {
    const reach = flipperTipX('left', 1) + BALL_RADIUS + FLIPPER_RADIUS;
    expect(reach, 'a raised left flipper must cover the centre line').toBeGreaterThan(CENTRE_X);
    const otherReach = flipperTipX('right', 1) - BALL_RADIUS - FLIPPER_RADIUS;
    expect(otherReach).toBeLessThan(CENTRE_X);
  });

  it('leaves a gap between the resting tips that a ball can pass through', () => {
    const clear = flipperTipX('right', 0) - flipperTipX('left', 0) - FLIPPER_RADIUS * 2;
    expect(clear, 'a resting pair must leave a real drain').toBeGreaterThan(BALL_RADIUS * 2);
    expect(clear).toBeLessThan(GOAL_HALF_WIDTH * 2);
  });

  it('travels from rest to raised and back over its declared angles', () => {
    expect(flipperAngle(0)).toBeCloseTo(FLIPPER_REST_ANGLE, 12);
    expect(flipperAngle(1)).toBeCloseTo(FLIPPER_REST_ANGLE - FLIPPER_SWING, 12);
    expect(flipperAngle(0.5)).toBeCloseTo(FLIPPER_REST_ANGLE - FLIPPER_SWING / 2, 12);
  });

  it('writes its line into a segment without allocating a new one', () => {
    const out: Segment = { x1: 0, y1: 0, x2: 0, y2: 0 };
    const returned = flipperSegment('p1', 'left', 0.3, out);
    expect(returned).toBe(out);
    expect(out.x1).toBe(flipperPivotX('left'));
    expect(out.y1).toBe(flipperPivotY('p1'));
    expect(out.x2).toBe(flipperTipX('left', 0.3));
    expect(out.y2).toBe(flipperTipY('p1', 0.3));
  });

  it('rises in FLIPPER_RISE_SECONDS and falls in FLIPPER_FALL_SECONDS', () => {
    let phase = 0;
    const riseSteps = Math.ceil(FLIPPER_RISE_SECONDS / STEP);
    for (let i = 0; i < riseSteps; i += 1) phase = nextFlipperPhase(phase, true, STEP);
    expect(phase).toBe(1);
    let down = 1;
    const fallSteps = Math.ceil(FLIPPER_FALL_SECONDS / STEP);
    for (let i = 0; i < fallSteps; i += 1) down = nextFlipperPhase(down, false, STEP);
    expect(down).toBe(0);
    expect(FLIPPER_FALL_SECONDS).toBeGreaterThan(FLIPPER_RISE_SECONDS);
  });

  it('never leaves the phase outside its travel', () => {
    for (const up of [true, false]) {
      let phase = up ? 0 : 1;
      for (let i = 0; i < 200; i += 1) {
        phase = nextFlipperPhase(phase, up, STEP);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reports the rate it actually travelled at, not the rate it was asked for', () => {
    // A flipper already at the top has stopped. If a contact read the nominal rate there, a
    // parked flipper would launch a ball as hard as a swinging one.
    expect(flipperPhaseRate(1, nextFlipperPhase(1, true, STEP), STEP)).toBe(0);
    expect(flipperPhaseRate(0, nextFlipperPhase(0, false, STEP), STEP)).toBe(0);
    const rising = flipperPhaseRate(0, nextFlipperPhase(0, true, STEP), STEP);
    expect(rising).toBeCloseTo(1 / FLIPPER_RISE_SECONDS, 9);
    const falling = flipperPhaseRate(1, nextFlipperPhase(1, false, STEP), STEP);
    expect(falling).toBeCloseTo(-1 / FLIPPER_FALL_SECONDS, 9);
    expect(flipperPhaseRate(0.5, 0.5, 0)).toBe(0);
  });

  it('reaches the same phase in four substeps as in one whole step', () => {
    let quartered = 0.2;
    for (let i = 0; i < SUBSTEPS; i += 1) {
      quartered = nextFlipperPhase(quartered, true, STEP / SUBSTEPS);
    }
    expect(quartered).toBeCloseTo(nextFlipperPhase(0.2, true, STEP), 12);
  });
});

describe('clamp and foldIntoBand', () => {
  it('clamps to the closed range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 0)).toBe(0);
  });

  it('folds a straight line back and forth between two rails', () => {
    expect(foldIntoBand(5, 0, 10)).toBe(5);
    expect(foldIntoBand(12, 0, 10)).toBe(8);
    expect(foldIntoBand(-3, 0, 10)).toBe(3);
    expect(foldIntoBand(20, 0, 10)).toBe(0);
    expect(foldIntoBand(25, 0, 10)).toBe(5);
    expect(foldIntoBand(-25, 0, 10)).toBe(5);
  });

  it('never leaves the band, over a wide sweep', () => {
    for (let i = -400; i <= 400; i += 7) {
      const folded = foldIntoBand(i, 10, 90);
      expect(folded).toBeGreaterThanOrEqual(10);
      expect(folded).toBeLessThanOrEqual(90);
    }
  });

  it('answers a degenerate band with its single point', () => {
    expect(foldIntoBand(37, 5, 5)).toBe(5);
    expect(foldIntoBand(37, 9, 3)).toBe(9);
  });
});

describe('the ball', () => {
  it('starts in the middle of the table, at rest', () => {
    const subject = createBall();
    expect(subject.x).toBe(CENTRE_X);
    expect(subject.y).toBe(CENTRE_Y);
    expect(ballSpeed(subject)).toBe(0);
  });

  it('travels at a constant velocity, exactly', () => {
    const subject = ball(100, 100, 300, -240);
    stepBall(subject, 0.5);
    expect(subject.x).toBe(250);
    expect(subject.y).toBe(-20);
    expect(subject.vx).toBe(300);
    expect(subject.vy).toBe(-240);
  });

  it('lands in the same place whether the step is chopped up or not', () => {
    // No drag and no gravity, so the position integral is exact however the step is divided.
    // This is what lets 60 Hz, 90 Hz and 144 Hz step the identical match.
    const whole = ball(37, 211, 411, -277);
    const chopped = ball(37, 211, 411, -277);
    stepBall(whole, STEP);
    for (let i = 0; i < 8; i += 1) stepBall(chopped, STEP / 8);
    expect(chopped.x).toBeCloseTo(whole.x, 9);
    expect(chopped.y).toBeCloseTo(whole.y, 9);
  });

  it('holds its speed inside the declared bounds', () => {
    const fast = ball(0, 0, MAX_BALL_SPEED * 3, 0);
    clampBallSpeed(fast);
    expect(ballSpeed(fast)).toBeCloseTo(MAX_BALL_SPEED, 6);
    const slow = ball(0, 0, 1, 0);
    clampBallSpeed(slow);
    expect(ballSpeed(slow)).toBeCloseTo(MIN_BALL_SPEED, 6);
    const fine = ball(0, 0, 0, (MIN_BALL_SPEED + MAX_BALL_SPEED) / 2);
    const before = ballSpeed(fine);
    clampBallSpeed(fine);
    expect(ballSpeed(fine)).toBe(before);
  });

  it('leaves a still ball still, so a serve is not launched by the floor', () => {
    const parked = ball(CENTRE_X, CENTRE_Y, 0, 0);
    clampBallSpeed(parked);
    expect(parked.vx).toBe(0);
    expect(parked.vy).toBe(0);
  });

  it('keeps its direction when its speed is clamped', () => {
    const subject = ball(0, 0, 3000, 4000);
    clampBallSpeed(subject);
    expect(subject.vy / subject.vx).toBeCloseTo(4 / 3, 9);
  });

  it('cannot cross a contact distance inside one substep at full speed', () => {
    // The reason MAX_BALL_SPEED and SUBSTEPS are the numbers they are: nothing may pass
    // through a flipper or a wall between two discrete tests.
    const travel = (MAX_BALL_SPEED * STEP) / SUBSTEPS;
    expect(travel).toBeLessThan(BALL_RADIUS + FLIPPER_RADIUS);
  });

  it('cannot be met head-on by a flipper tip faster than a contact distance a substep', () => {
    const tipSpeed = (FLIPPER_SWING / FLIPPER_RISE_SECONDS) * FLIPPER_LENGTH;
    const closing = ((tipSpeed + MAX_BALL_SPEED) * STEP) / SUBSTEPS;
    expect(closing).toBeLessThan(BALL_RADIUS + FLIPPER_RADIUS);
  });
});

describe('enforceVertical', () => {
  it('leaves a ball that is already travelling up or down alone', () => {
    const subject = ball(0, 0, 100, 600);
    enforceVertical(subject);
    expect(subject.vx).toBe(100);
    expect(subject.vy).toBe(600);
  });

  it('floors the vertical part of a ball sent flat across the table', () => {
    const subject = ball(0, 0, 600, 1);
    const before = ballSpeed(subject);
    enforceVertical(subject);
    expect(Math.abs(subject.vy)).toBeCloseTo(before * MIN_VERTICAL_FRACTION, 6);
    expect(ballSpeed(subject)).toBeCloseTo(before, 6);
    expect(subject.vx).toBeGreaterThan(0);
  });

  it('keeps the side the ball was already going', () => {
    const left = ball(0, 0, -600, 0);
    enforceVertical(left);
    expect(left.vx).toBeLessThan(0);
    const right = ball(0, 0, 600, 0);
    enforceVertical(right);
    expect(right.vx).toBeGreaterThan(0);
  });

  it('leaves a still ball still', () => {
    const subject = ball(0, 0, 0, 0);
    enforceVertical(subject);
    expect(subject.vx).toBe(0);
    expect(subject.vy).toBe(0);
  });

  it('commutes with the half turn, exactly, even on the halfway line', () => {
    // The tie-break is the sign of the horizontal travel rather than which half of the table
    // the ball is in, because a ball exactly on the halfway line is its own mirror image and
    // a rule read off its position could not negate.
    const cases: Ball[] = [
      ball(120, CENTRE_Y, 700, 0),
      ball(120, CENTRE_Y, -700, 0),
      ball(400, 300, 500, 3),
      ball(400, 300, -500, -3),
    ];
    for (const source of cases) {
      const straight = { ...source };
      const mirrored = mirrorBall(source);
      enforceVertical(straight);
      enforceVertical(mirrored);
      expect(mirrorGap(straight, mirrored)).toBe(0);
    }
  });
});

describe('a wall', () => {
  const rail: Segment = { x1: 0, y1: 0, x2: 0, y2: TABLE.height };

  it('reports no contact when the ball is nowhere near it', () => {
    const subject = ball(300, 400, -500, 0);
    expect(collideBallWall(subject, rail)).toBe(false);
    expect(subject.vx).toBe(-500);
  });

  it('is a mirror: it takes nothing and adds nothing', () => {
    const subject = ball(BALL_RADIUS - 3, 400, -500, 120);
    const before = ballSpeed(subject);
    expect(collideBallWall(subject, rail)).toBe(true);
    expect(subject.vx).toBeCloseTo(500, 6);
    expect(subject.vy).toBeCloseTo(120, 6);
    expect(ballSpeed(subject)).toBeCloseTo(before, 6);
  });

  it('pushes the ball out to exactly touching', () => {
    const subject = ball(BALL_RADIUS - 6, 400, -500, 0);
    collideBallWall(subject, rail);
    expect(subject.x).toBeCloseTo(BALL_RADIUS, 9);
  });

  it('does not turn a ball that is already leaving', () => {
    const subject = ball(BALL_RADIUS - 3, 400, 500, 0);
    expect(collideBallWall(subject, rail)).toBe(true);
    expect(subject.vx).toBe(500);
  });

  it('holds the ball inside the table over a long random flight', () => {
    const rng = new Rng(4242);
    const subject = ball(CENTRE_X, CENTRE_Y, 500, 400);
    for (let step = 0; step < 20000; step += 1) {
      stepBall(subject, STEP / SUBSTEPS);
      for (const wall of WALLS) collideBallWall(subject, wall);
      clampBallSpeed(subject);
      if (goalScored(subject) !== 'none') {
        // Through a mouth is the one way out, and it is a goal rather than an escape.
        placeServe(subject, 'p1');
        launchServe(subject, 'p1', (rng.float() * 2 - 1) * SERVE_SPREAD);
        continue;
      }
      expect(ballLost(subject), `escaped at step ${String(step)}`).toBe(false);
    }
  });

  it('turns a mirrored ball into the mirror of the turn, within tolerance', () => {
    for (const wall of WALLS) {
      const t = 0.37;
      const px = wall.x1 + (wall.x2 - wall.x1) * t;
      const py = wall.y1 + (wall.y2 - wall.y1) * t;
      for (const [vx, vy] of [
        [400, 300],
        [-520, 180],
        [90, -640],
      ] as const) {
        const straight = ball(px + 3, py + 3, vx, vy);
        const mirrored = mirrorBall(straight);
        const hitA = collideBallWall(straight, wall);
        const hitB = collideBallWall(mirrored, mirrorSegment(wall));
        // The decision is compared to the bit; the numbers to a tolerance.
        expect(hitB).toBe(hitA);
        if (!hitA) continue;
        expect(mirrorGap(straight, mirrored)).toBeLessThan(MIRROR_TOLERANCE);
      }
    }
  });
});

describe('a bumper', () => {
  const bumper = BUMPERS[0]!;

  it('reports no contact when the ball is nowhere near it', () => {
    const subject = ball(bumper.x, bumper.y - bumper.radius - BALL_RADIUS - 40, 0, 100);
    expect(collideBallBumper(subject, bumper)).toBe(false);
  });

  it('sends the ball back faster than it arrived', () => {
    const subject = ball(bumper.x, bumper.y - bumper.radius - BALL_RADIUS + 2, 0, 400);
    expect(collideBallBumper(subject, bumper)).toBe(true);
    expect(subject.vy).toBeLessThan(0);
    expect(ballSpeed(subject)).toBeCloseTo(400 * BUMPER_GAIN, 4);
  });

  it('never sends the ball out past the ceiling', () => {
    const subject = ball(bumper.x, bumper.y - bumper.radius - BALL_RADIUS + 2, 0, MAX_BALL_SPEED);
    collideBallBumper(subject, bumper);
    expect(ballSpeed(subject)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-6);
  });

  it('never leaves the ball travelling flat across the table', () => {
    const subject = ball(bumper.x - bumper.radius - BALL_RADIUS + 2, bumper.y, 500, 0);
    collideBallBumper(subject, bumper);
    const speed = ballSpeed(subject);
    expect(Math.abs(subject.vy)).toBeGreaterThanOrEqual(speed * MIN_VERTICAL_FRACTION - 1e-6);
  });

  it('pushes the ball out to exactly touching', () => {
    const subject = ball(bumper.x, bumper.y - bumper.radius, 0, 500);
    collideBallBumper(subject, bumper);
    const gap = Math.hypot(subject.x - bumper.x, subject.y - bumper.y);
    expect(gap).toBeCloseTo(bumper.radius + BALL_RADIUS, 6);
  });

  it('turns a mirrored ball into the mirror of the turn, within tolerance', () => {
    for (const source of BUMPERS) {
      const image = BUMPERS.find(
        (candidate) =>
          Math.abs(candidate.x - (TABLE.width - source.x)) < 1e-9 &&
          Math.abs(candidate.y - (TABLE.height - source.y)) < 1e-9,
      )!;
      const straight = ball(source.x + 5, source.y - source.radius - BALL_RADIUS + 3, 60, 480);
      const mirrored = mirrorBall(straight);
      expect(collideBallBumper(mirrored, image)).toBe(collideBallBumper(straight, source));
      expect(mirrorGap(straight, mirrored)).toBeLessThan(MIRROR_TOLERANCE);
    }
  });
});

describe('a flipper', () => {
  /**
   * The flipper's outward face — the side that looks up the table, away from the mouth it
   * guards. Computed from the flipper's own direction rather than assumed to be straight up:
   * a resting flipper on this table is steeper than 45 degrees, so "the face" and "above it"
   * are not the same direction at all.
   */
  function faceNormal(seat: SeatId, side: FlipperSide, phase: number) {
    const angle = flipperAngle(phase);
    const dirX = (side === 'left' ? 1 : -1) * Math.cos(angle);
    const dirY = (seat === 'p1' ? 1 : -1) * Math.sin(angle);
    let nx = dirY;
    let ny = -dirX;
    const outward = seat === 'p1' ? -1 : 1;
    if (ny * outward < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { dirX, dirY, nx, ny };
  }

  /** A ball resting on that face at `along` units from the pivot, moving into it. */
  function onFace(
    seat: SeatId,
    side: FlipperSide,
    phase: number,
    along: number,
    speed = 420,
  ): Ball {
    const { dirX, dirY, nx, ny } = faceNormal(seat, side, phase);
    const reach = BALL_RADIUS + FLIPPER_RADIUS - 3;
    return ball(
      flipperPivotX(side) + dirX * along + nx * reach,
      flipperPivotY(seat) + dirY * along + ny * reach,
      -nx * speed,
      -ny * speed,
    );
  }

  it('reports no contact when the ball is nowhere near it', () => {
    const subject = ball(CENTRE_X, CENTRE_Y, 0, 400);
    expect(collideBallFlipper(subject, 'p1', 'left', 0, 0)).toBe(false);
  });

  it('reports no contact past the end of its length', () => {
    const beyond = onFace('p1', 'left', 0, FLIPPER_LENGTH + (BALL_RADIUS + FLIPPER_RADIUS) * 2);
    expect(collideBallFlipper(beyond, 'p1', 'left', 0, 0)).toBe(false);
  });

  it('pushes the ball out to exactly touching', () => {
    const subject = onFace('p1', 'left', 0, FLIPPER_LENGTH / 2);
    collideBallFlipper(subject, 'p1', 'left', 0, 0);
    const angle = flipperAngle(0);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const relX = subject.x - flipperPivotX('left');
    const relY = subject.y - flipperPivotY('p1');
    const along = clamp(relX * dirX + relY * dirY, 0, FLIPPER_LENGTH);
    const gap = Math.hypot(relX - dirX * along, relY - dirY * along);
    expect(gap).toBeCloseTo(BALL_RADIUS + FLIPPER_RADIUS, 6);
  });

  it('kills a ball it is not moving, which is what a flipper left up is for', () => {
    const subject = onFace('p1', 'left', 1, FLIPPER_LENGTH / 2);
    const before = ballSpeed(subject);
    expect(collideBallFlipper(subject, 'p1', 'left', 1, 0)).toBe(true);
    expect(ballSpeed(subject)).toBeCloseTo(before * FLIPPER_RESTITUTION, 6);
    expect(subject.vy, 'and still sends it back up the table').toBeLessThan(0);
  });

  it('fires a ball it catches mid-swing far harder than one it does not', () => {
    const rate = 1 / FLIPPER_RISE_SECONDS;
    const still = onFace('p1', 'left', 0.5, FLIPPER_LENGTH * 0.8);
    const swung = onFace('p1', 'left', 0.5, FLIPPER_LENGTH * 0.8);
    collideBallFlipper(still, 'p1', 'left', 0.5, 0);
    collideBallFlipper(swung, 'p1', 'left', 0.5, rate);
    expect(ballSpeed(swung)).toBeGreaterThan(ballSpeed(still) * 2);
  });

  it('fires a tip hit harder than a hit by the pivot', () => {
    const rate = 1 / FLIPPER_RISE_SECONDS;
    const nearPivot = onFace('p1', 'left', 0.5, FLIPPER_LENGTH * 0.2);
    const nearTip = onFace('p1', 'left', 0.5, FLIPPER_LENGTH * 0.9);
    collideBallFlipper(nearPivot, 'p1', 'left', 0.5, rate);
    collideBallFlipper(nearTip, 'p1', 'left', 0.5, rate);
    expect(ballSpeed(nearTip)).toBeGreaterThan(ballSpeed(nearPivot));
  });

  it('does not turn a ball that is already leaving', () => {
    const subject = onFace('p1', 'left', 0, FLIPPER_LENGTH / 2);
    subject.vx = -subject.vx;
    subject.vy = -subject.vy;
    const before = { ...subject };
    expect(collideBallFlipper(subject, 'p1', 'left', 0, 0)).toBe(true);
    expect(subject.vx).toBe(before.vx);
    expect(subject.vy).toBe(before.vy);
  });

  it('gives a ball less back on the way down than on the way up', () => {
    // A flipper on its way down is moving away from the ball rather than into it, so a flip
    // that has already peaked returns far less than one caught rising. Getting the moment
    // wrong is not merely wasted, it is worse than leaving the flipper alone.
    const rising = onFace('p1', 'left', 0.5, FLIPPER_LENGTH * 0.8);
    const falling = onFace('p1', 'left', 0.5, FLIPPER_LENGTH * 0.8);
    collideBallFlipper(rising, 'p1', 'left', 0.5, 1 / FLIPPER_RISE_SECONDS);
    collideBallFlipper(falling, 'p1', 'left', 0.5, -1 / FLIPPER_FALL_SECONDS);
    expect(ballSpeed(falling)).toBeLessThan(ballSpeed(rising) / 3);
  });

  it('resolves a ball sitting exactly on the line without dividing by zero', () => {
    const angle = flipperAngle(0.4);
    const along = FLIPPER_LENGTH / 2;
    const subject = ball(
      flipperPivotX('left') + Math.cos(angle) * along,
      flipperPivotY('p1') + Math.sin(angle) * along,
      0,
      300,
    );
    expect(collideBallFlipper(subject, 'p1', 'left', 0.4, 0)).toBe(true);
    expect(Number.isFinite(subject.x)).toBe(true);
    expect(Number.isFinite(subject.y)).toBe(true);
    expect(Number.isFinite(subject.vx)).toBe(true);
  });

  it('turns a mirrored ball into the mirror of the turn, within tolerance', () => {
    const rate = 1 / FLIPPER_RISE_SECONDS;
    for (const side of SIDES) {
      for (const phase of [0, 0.35, 0.7, 1]) {
        for (const along of [FLIPPER_LENGTH * 0.25, FLIPPER_LENGTH * 0.75]) {
          const straight = onFace('p1', side, phase, along);
          const mirrored = mirrorBall(straight);
          const hitA = collideBallFlipper(straight, 'p1', side, phase, rate);
          const hitB = collideBallFlipper(mirrored, 'p2', otherSide(side), phase, rate);
          expect(hitB).toBe(hitA);
          expect(mirrorGap(straight, mirrored)).toBeLessThan(MIRROR_TOLERANCE);
        }
      }
    }
  });
});

describe('a goal', () => {
  it('is only awarded once the ball is past the baseline entirely', () => {
    expect(goalScored(ball(CENTRE_X, TABLE.height, 0, 500))).toBe('none');
    expect(goalScored(ball(CENTRE_X, TABLE.height + BALL_RADIUS, 0, 500))).toBe('none');
    expect(goalScored(ball(CENTRE_X, TABLE.height + BALL_RADIUS + 0.5, 0, 500))).toBe('p2');
    expect(goalScored(ball(CENTRE_X, 0, 0, -500))).toBe('none');
    expect(goalScored(ball(CENTRE_X, -BALL_RADIUS, 0, -500))).toBe('none');
    expect(goalScored(ball(CENTRE_X, -BALL_RADIUS - 0.5, 0, -500))).toBe('p1');
  });

  it('names the seat that scored, never the one whose mouth was crossed', () => {
    // p1 defends the bottom, so a ball out of the bottom is p2's goal. Every caller wants
    // the scorer, and the alternative is an inversion bug waiting to happen.
    expect(goalScored(ball(CENTRE_X, TABLE.height * 2, 0, 500))).toBe('p2');
    expect(goalScored(ball(CENTRE_X, -TABLE.height, 0, -500))).toBe('p1');
  });

  it('is not awarded anywhere inside the table', () => {
    for (let y = 0; y <= TABLE.height; y += 40) {
      expect(goalScored(ball(CENTRE_X, y, 0, 0))).toBe('none');
    }
  });

  it('mirrors: the mirror of p1 scoring is p2 scoring', () => {
    const out = ball(CENTRE_X - 40, TABLE.height + BALL_RADIUS + 5, 0, 500);
    expect(goalScored(out)).toBe('p2');
    expect(goalScored(mirrorBall(out))).toBe('p1');
  });
});

describe('a lost ball', () => {
  it('is not reported anywhere on the table', () => {
    expect(ballLost(ball(CENTRE_X, CENTRE_Y, 0, 0))).toBe(false);
    expect(ballLost(ball(0, 0, 0, 0))).toBe(false);
    expect(ballLost(ball(TABLE.width, TABLE.height, 0, 0))).toBe(false);
  });

  it('is reported far outside it, and for a position that has stopped being a number', () => {
    expect(ballLost(ball(-TABLE.width * 2, CENTRE_Y, 0, 0))).toBe(true);
    expect(ballLost(ball(TABLE.width * 4, CENTRE_Y, 0, 0))).toBe(true);
    expect(ballLost(ball(CENTRE_X, -TABLE.height * 2, 0, 0))).toBe(true);
    expect(ballLost(ball(CENTRE_X, TABLE.height * 4, 0, 0))).toBe(true);
    expect(ballLost(ball(Number.NaN, CENTRE_Y, 0, 0))).toBe(true);
    expect(ballLost(ball(CENTRE_X, Number.POSITIVE_INFINITY, 0, 0))).toBe(true);
  });
});

describe('the serve', () => {
  it('parks the ball on a spot that is the other spot turned half a turn', () => {
    expect(serveSpotX('p1')).toBe(CENTRE_X - SERVE_OFFSET_X);
    expect(serveSpotY('p1')).toBe(CENTRE_Y - SERVE_OFFSET_Y);
    expect(serveSpotX('p2')).toBe(TABLE.width - serveSpotX('p1'));
    expect(serveSpotY('p2')).toBe(TABLE.height - serveSpotY('p1'));
  });

  it('places the ball at rest', () => {
    const subject = ball(1, 2, 300, 400);
    placeServe(subject, 'p2');
    expect(subject.x).toBe(serveSpotX('p2'));
    expect(subject.y).toBe(serveSpotY('p2'));
    expect(subject.vx).toBe(0);
    expect(subject.vy).toBe(0);
  });

  it('sends the ball at the seat it names, at the serve speed', () => {
    for (const seat of SEATS) {
      for (const angle of [-SERVE_SPREAD, 0, SERVE_SPREAD]) {
        const subject = createBall();
        placeServe(subject, seat);
        launchServe(subject, seat, angle);
        expect(ballSpeed(subject)).toBeCloseTo(SERVE_SPEED, 6);
        if (seat === 'p1') expect(subject.vy).toBeGreaterThan(0);
        else expect(subject.vy).toBeLessThan(0);
      }
    }
  });

  it('is the same serve seen from the two ends, to the bit', () => {
    for (const angle of [-0.4, -0.1, 0, 0.25, SERVE_SPREAD]) {
      const atP1 = createBall();
      placeServe(atP1, 'p1');
      launchServe(atP1, 'p1', angle);
      const atP2 = createBall();
      placeServe(atP2, 'p2');
      launchServe(atP2, 'p2', angle);
      expect(atP2.vx).toBe(-atP1.vx);
      expect(atP2.vy).toBe(-atP1.vy);
      expect(atP2.x).toBe(TABLE.width - atP1.x);
      expect(atP2.y).toBe(TABLE.height - atP1.y);
    }
  });

  it('never serves so flat that the ball cannot reach an end', () => {
    for (const angle of [-SERVE_SPREAD, SERVE_SPREAD]) {
      const subject = createBall();
      launchServe(subject, 'p1', angle);
      expect(Math.abs(subject.vy)).toBeGreaterThan(ballSpeed(subject) * MIN_VERTICAL_FRACTION);
    }
  });
});

describe('what a seat is asking its flippers for', () => {
  // The near seat is not rotated, so for it seat space and screen space are the same thing
  // and these read exactly as they did before the seat's frame entered the question.
  const NEAR = false;
  const FAR = true;

  it('reads a key as a direction', () => {
    expect(wantsFlipper('left', -1, null, NEAR)).toBe(true);
    expect(wantsFlipper('right', -1, null, NEAR)).toBe(false);
    expect(wantsFlipper('right', 1, null, NEAR)).toBe(true);
    expect(wantsFlipper('left', 1, null, NEAR)).toBe(false);
  });

  it('reads a finger as a place', () => {
    expect(wantsFlipper('left', 0, 10, NEAR)).toBe(true);
    expect(wantsFlipper('right', 0, 10, NEAR)).toBe(false);
    expect(wantsFlipper('right', 0, TABLE.width - 10, NEAR)).toBe(true);
    expect(wantsFlipper('left', 0, TABLE.width - 10, NEAR)).toBe(false);
  });

  it('gives a finger exactly on the centre line to the presser own right flipper', () => {
    expect(wantsFlipper('right', 0, CENTRE_X, NEAR)).toBe(true);
    expect(wantsFlipper('left', 0, CENTRE_X, NEAR)).toBe(false);
    // The far seat's own right is the screen's left, and the tie-break goes with the hand
    // rather than with the screen, so it mirrors like everything else on this table.
    expect(wantsFlipper('left', 0, CENTRE_X, FAR)).toBe(true);
    expect(wantsFlipper('right', 0, CENTRE_X, FAR)).toBe(false);
  });

  it('raises nothing when nobody is asking', () => {
    expect(wantsFlipper('left', 0, null, NEAR)).toBe(false);
    expect(wantsFlipper('right', 0, null, NEAR)).toBe(false);
    expect(wantsFlipper('left', 0, null, FAR)).toBe(false);
    expect(wantsFlipper('right', 0, null, FAR)).toBe(false);
  });

  it('ORs the two sources rather than switching between them', () => {
    // A key and a finger are one intent, so there is no mode: either raises the flipper.
    expect(wantsFlipper('left', -1, TABLE.width - 10, NEAR)).toBe(true);
    expect(wantsFlipper('right', -1, TABLE.width - 10, NEAR)).toBe(true);
    expect(wantsFlipper('left', 1, 10, NEAR)).toBe(true);
    expect(wantsFlipper('right', 1, 10, NEAR)).toBe(true);
  });

  it('raises neither flipper when both keys are held, equally for both instruments', () => {
    // The engine sums the two direction keys into one axis, so A and D together read as
    // zero. A seat reports one pointer position however many fingers are down, so a thumb
    // cannot raise two either. Being the same limit on both is what keeps it fair.
    expect(wantsFlipper('left', 0, null, NEAR)).toBe(false);
    expect(wantsFlipper('right', 0, null, NEAR)).toBe(false);
  });

  it('gives the far seat left key the flipper on its left, which is the screen right one', () => {
    // The whole of issue #2476: the table never turns, so the far seat reads it upside down
    // and the flipper under its left hand is the one drawn on the right of the screen.
    expect(wantsFlipper('right', -1, null, FAR)).toBe(true);
    expect(wantsFlipper('left', -1, null, FAR)).toBe(false);
    expect(wantsFlipper('left', 1, null, FAR)).toBe(true);
    expect(wantsFlipper('right', 1, null, FAR)).toBe(false);
  });

  it('leaves a finger exactly where it landed, for the far seat as much as the near one', () => {
    // The counterpart, and the reason only one instrument moved: a place mirrors along with
    // the flipper it is reaching for, so the two mirrors cancel and a tap on the left of the
    // glass raises the flipper on the left of the glass whichever end is asking.
    for (const rotated of [NEAR, FAR]) {
      expect(wantsFlipper('left', 0, 10, rotated)).toBe(true);
      expect(wantsFlipper('right', 0, 10, rotated)).toBe(false);
      expect(wantsFlipper('right', 0, TABLE.width - 10, rotated)).toBe(true);
      expect(wantsFlipper('left', 0, TABLE.width - 10, rotated)).toBe(false);
    }
  });
});

/**
 * The symmetry the two seats owe each other, asserted as a property rather than as examples.
 *
 * The examples above say what one gesture does at one seat, and an example cannot catch a
 * seat-mirroring defect: the old code passed a whole file of them while the far seat's keys
 * were reversed, because every example was written from the screen's point of view and the
 * screen is exactly the frame that was wrong.
 *
 * So this drives **the same gesture, expressed in the pressing seat's own frame**, through
 * every seat and both orientations, and requires the same answer every time — named as an
 * index into that seat's own pair of flippers, so "the same answer" means the same hand and
 * not the same side of the device. Two seats playing identically must play the same game.
 */
describe('the same gesture, played at either seat', () => {
  interface Gesture {
    /** A direction key, already in the pressing seat's frame; 0 for no key. */
    readonly moveX: number;
    /** Where the finger is on the glass **in the seat's own frame**, or null for none. */
    readonly seatPointerX: number | null;
  }

  /** Every key state crossed with every interesting place a finger can be, including none. */
  function gestures(): readonly Gesture[] {
    const keys = [-1, -0.6, 0, 0.6, 1];
    const places: readonly (number | null)[] = [
      null,
      0,
      10,
      CENTRE_X - 1,
      CENTRE_X,
      CENTRE_X + 1,
      TABLE.width - 10,
      TABLE.width,
    ];
    const out: Gesture[] = [];
    for (const moveX of keys) {
      for (const seatPointerX of places) out.push({ moveX, seatPointerX });
    }
    return out;
  }

  /**
   * Which of a seat's flippers one seat-space gesture raises, as indices into that seat's own
   * pair: 0 for the flipper under its left hand, 1 for the one under its right.
   *
   * The gesture is converted to what the device would actually report — a place mirrors for a
   * seat reading the table upside down, a key does not — and the answer is converted back
   * through the flat index the match really keys its phases by, so this exercises
   * `flipperIndex` rather than talking about it.
   */
  function raised(seat: SeatId, rotated: boolean, gesture: Gesture): readonly number[] {
    const devicePointerX =
      gesture.seatPointerX !== null && rotated
        ? TABLE.width - gesture.seatPointerX
        : gesture.seatPointerX;
    const out: number[] = [];
    for (const side of SIDES) {
      if (!wantsFlipper(side, gesture.moveX, devicePointerX, rotated)) continue;
      const index = flipperIndex(seat, side);
      expect(flipperSeatOf(index)).toBe(seat);
      out.push(seatSide(flipperSideOf(index), rotated) === 'left' ? 0 : 1);
    }
    // Sorted, because the loop above walks the screen's two sides and the far seat meets them
    // in the other order. Which hands a gesture asks for is the answer; the order the two
    // slots happen to be visited in is not, and comparing it would fail the mirror on nothing.
    return out.sort((a, b) => a - b);
  }

  it('raises the flipper under the same hand, at either seat and either orientation', () => {
    for (const gesture of gestures()) {
      const reference = raised('p1', false, gesture);
      for (const seat of SEATS) {
        for (const rotated of [false, true]) {
          expect(
            raised(seat, rotated, gesture),
            `${seat}${rotated ? ' rotated' : ''}: key ${gesture.moveX}, finger ${String(
              gesture.seatPointerX,
            )}`,
          ).toEqual(reference);
        }
      }
    }
  });

  it('has teeth: the two seats do not agree about the screen, only about the hand', () => {
    // Without this the property above could be satisfied by a function that ignores the seat
    // entirely. The two seats must disagree in screen space exactly when one of them is
    // reading the table upside down, and the keys are where that disagreement shows.
    const near = SIDES.filter((side) => wantsFlipper(side, -1, null, false));
    const far = SIDES.filter((side) => wantsFlipper(side, -1, null, true));
    expect(near).toEqual(['left']);
    expect(far).toEqual(['right']);
  });

  it('answers one instrument with exactly one flipper, at either orientation', () => {
    // One hand, one flipper. Both instruments at once may ask for both — they are OR-ed, and
    // that is tested above — but a gesture made with one of them selects exactly one flipper
    // whenever it says anything at all, and the seat's frame must not change how many.
    for (const gesture of gestures()) {
      const keyOnly = gesture.seatPointerX === null;
      const pointerOnly = gesture.moveX === 0;
      if (!keyOnly && !pointerOnly) continue;
      const idle = keyOnly && pointerOnly;
      for (const rotated of [false, true]) {
        expect(raised('p1', rotated, gesture)).toHaveLength(idle ? 0 : 1);
      }
    }
  });
});

describe('the bot', () => {
  function freshRng(): Rng {
    return new Rng(20260824);
  }

  it('leaves both flippers down when the ball is going the other way', () => {
    for (const seat of SEATS) {
      const away = seat === 'p1' ? -600 : 600;
      const memory = createBotMemory();
      const chosen = botFlipperSide(
        ball(CENTRE_X, CENTRE_Y, 0, away),
        seat,
        'hard',
        memory,
        freshRng(),
      );
      expect(chosen).toBe('none');
    }
  });

  it('aims at the middle of the band its own flippers sweep', () => {
    for (const seat of SEATS) {
      const line = botAimLine(seat);
      const nearest = Math.min(flipperTipY(seat, 0), flipperTipY(seat, 1));
      const furthest = Math.max(flipperTipY(seat, 0), flipperTipY(seat, 1));
      expect(line).toBeGreaterThanOrEqual(Math.min(nearest, flipperPivotY(seat)));
      expect(line).toBeLessThanOrEqual(Math.max(furthest, flipperPivotY(seat)));
    }
    expect(BOT_AIM_OFFSET).toBeGreaterThan(0);
    expect(BOT_AIM_OFFSET).toBeLessThan(FLIPPER_PIVOT_INSET);
  });

  /**
   * A ball placed so that the bot's own **stale** reading says it arrives in `stale` seconds.
   *
   * That is the quantity the bot compares against its lead, and it is not the true time to
   * arrival: the reading is `reactionSeconds` old, so the true time is `stale` minus the
   * reaction. Every tier therefore starts its swing that many seconds after the moment its
   * reading called for, which is the whole of what a reaction time means here.
   */
  function staleAt(
    seat: SeatId,
    tier: BotDifficulty,
    stale: number,
    x: number,
    speed: number,
  ): Ball {
    const vy = seat === 'p1' ? speed : -speed;
    const line = botAimLine(seat);
    return ball(x, line + vy * BOT_PROFILES[tier].reactionSeconds - vy * stale, 0, vy);
  }

  it('holds its fire until its own reading says one flipper rise is left', () => {
    const rng = freshRng();
    const farOff = staleAt('p1', 'hard', BOT_FIRE_LEAD + 0.6, CENTRE_X, 600);
    expect(botFlipperSide(farOff, 'p1', 'hard', createBotMemory(), rng)).toBe('none');
    const close = staleAt('p1', 'hard', 0.02, CENTRE_X, 600);
    expect(botFlipperSide(close, 'p1', 'hard', createBotMemory(), rng)).not.toBe('none');
  });

  it('picks the flipper on the side the ball is arriving on', () => {
    for (const seat of SEATS) {
      const left = botFlipperSide(
        staleAt(seat, 'hard', 0.02, 140, 700),
        seat,
        'hard',
        createBotMemory(),
        freshRng(),
      );
      const right = botFlipperSide(
        staleAt(seat, 'hard', 0.02, TABLE.width - 140, 700),
        seat,
        'hard',
        createBotMemory(),
        freshRng(),
      );
      expect(left, seat).toBe('left');
      expect(right, seat).toBe('right');
    }
  });

  it('picks the mirrored flipper for the mirrored ball', () => {
    const source = staleAt('p1', 'hard', 0.02, 180, 700);
    source.vx = 40;
    const straight = botFlipperSide(source, 'p1', 'hard', createBotMemory(), freshRng());
    const mirrored = botFlipperSide(
      mirrorBall(source),
      'p2',
      'hard',
      createBotMemory(),
      freshRng(),
    );
    expect(straight).not.toBe('none');
    expect(mirrored).toBe(otherSide(straight as FlipperSide));
  });

  it('starts its swing later the weaker the tier is, and never earlier', () => {
    // Measured by playing the approach out rather than read off the constants: a ball is
    // walked down the table one step at a time and the step each tier first calls for a
    // flipper on is recorded. Lower is earlier.
    const speed = 620;
    const firstStep: Record<string, number> = {};
    for (const tier of TIERS) {
      const subject = ball(CENTRE_X - 90, 120, 0, speed);
      const memory = createBotMemory();
      const rng = new Rng(5150);
      let at = -1;
      for (let step = 0; step < 200 && at < 0; step += 1) {
        if (botFlipperSide(subject, 'p1', tier, memory, rng) !== 'none') at = step;
        stepBall(subject, STEP);
      }
      expect(at, `${tier} never flipped at all`).toBeGreaterThan(0);
      firstStep[tier] = at;
    }
    expect(firstStep.hard!).toBeLessThan(firstStep.normal!);
    expect(firstStep.normal!).toBeLessThan(firstStep.easy!);
  });

  it('draws exactly two samples every step, whatever it decides', () => {
    // The stream must advance at one rate however the match goes, or two matches from one
    // seed would diverge on nothing but how often a bot happened to be busy.
    for (const tier of TIERS) {
      const busy = new Rng(77);
      const idle = new Rng(77);
      const memoryA = createBotMemory();
      const memoryB = createBotMemory();
      for (let i = 0; i < 50; i += 1) {
        botFlipperSide(ball(CENTRE_X, CENTRE_Y, 0, 600), 'p1', tier, memoryA, busy);
        botFlipperSide(ball(CENTRE_X, CENTRE_Y, 0, -600), 'p1', tier, memoryB, idle);
      }
      expect(busy.save()).toEqual(idle.save());
    }
  });

  it('holds its noise for the whole of one approach', () => {
    const memory = createBotMemory();
    const rng = freshRng();
    const approaching = ball(CENTRE_X, CENTRE_Y, 0, 600);
    botFlipperSide(approaching, 'p1', 'easy', memory, rng);
    const first = { noise: memory.noise, drift: memory.drift };
    for (let i = 0; i < 20; i += 1) botFlipperSide(approaching, 'p1', 'easy', memory, rng);
    expect(memory.noise).toBe(first.noise);
    expect(memory.drift).toBe(first.drift);
    // A new approach draws again.
    botFlipperSide(ball(CENTRE_X, CENTRE_Y, 0, -600), 'p1', 'easy', memory, rng);
    botFlipperSide(approaching, 'p1', 'easy', memory, rng);
    expect(memory.approaching).toBe(true);
  });

  it('acts on where the ball was, never on where it will be', () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].reactionSeconds).toBeGreaterThan(0);
    }
  });

  it('orders its three tiers by every axis it has', () => {
    expect(BOT_PROFILES.easy.reactionSeconds).toBeGreaterThan(BOT_PROFILES.normal.reactionSeconds);
    expect(BOT_PROFILES.normal.reactionSeconds).toBeGreaterThan(BOT_PROFILES.hard.reactionSeconds);
    expect(BOT_PROFILES.easy.timingError).toBeGreaterThan(BOT_PROFILES.normal.timingError);
    expect(BOT_PROFILES.normal.timingError).toBeGreaterThan(BOT_PROFILES.hard.timingError);
    expect(BOT_PROFILES.easy.aimError).toBeGreaterThan(BOT_PROFILES.normal.aimError);
    expect(BOT_PROFILES.normal.aimError).toBeGreaterThan(BOT_PROFILES.hard.aimError);
  });

  it('is given no way to move a flipper faster than a person can', () => {
    // Difficulty is reaction delay and noise, and nothing else: there is one rise rate and
    // one fall rate on this table and every driver of a flipper goes through them.
    const profileKeys = Object.keys(BOT_PROFILES.hard).sort();
    expect(profileKeys).toEqual(['aimError', 'reactionSeconds', 'timingError']);
  });

  it('picks the wrong side more often the weaker the tier is', () => {
    // Measured rather than read off the constants: the noise has to reach the decision, and
    // the only way to know it does is to count the decisions.
    const speed = 640;
    const wrong: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
    const fired: Record<string, number> = { easy: 0, normal: 0, hard: 0 };
    for (const tier of TIERS) {
      const rng = new Rng(9091);
      for (let trial = 0; trial < 300; trial += 1) {
        // Every ball in this sweep arrives left of the centre line by 20 to 68 units, so
        // 'right' is a mistake and nothing else is. Near enough the middle that all three
        // tiers can get it wrong, or the test would only be measuring where it aimed.
        const subject = ball(232 + (trial % 7) * 8, 140, 0, speed);
        const memory = createBotMemory();
        let chosen: FlipperSide | 'none' = 'none';
        for (let step = 0; step < 200 && chosen === 'none'; step += 1) {
          chosen = botFlipperSide(subject, 'p1', tier, memory, rng);
          stepBall(subject, STEP);
        }
        if (chosen === 'none') continue;
        fired[tier] = (fired[tier] ?? 0) + 1;
        if (chosen === 'right') wrong[tier] = (wrong[tier] ?? 0) + 1;
      }
    }
    for (const tier of TIERS) expect(fired[tier], `${tier} never flipped`).toBeGreaterThan(200);
    expect(wrong.easy!).toBeGreaterThan(wrong.normal!);
    expect(wrong.normal!).toBeGreaterThan(wrong.hard!);
    expect(wrong.hard!, 'even the sharpest tier is not perfect').toBeGreaterThan(0);
  });
});
