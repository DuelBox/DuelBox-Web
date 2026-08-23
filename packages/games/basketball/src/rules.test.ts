import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ARC_RADIUS,
  AIM_RATE,
  AIM_SWEEP,
  BALL_RADIUS,
  BLUNDER_SCALE,
  BOT_DRAWS_PER_SHOT,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  CLANG_RADIUS,
  COURT_HEIGHT,
  COURT_WIDTH,
  HOOP_X,
  HOOP_Y,
  MAX_RANGE,
  MAX_X,
  MAX_Y,
  MIN_RANGE,
  MIN_X,
  MIN_Y,
  MOUTH_RADIUS,
  POINTS_BASKET,
  POINTS_SWISH,
  POSSESSIONS,
  POWER_RATE,
  READY_SECONDS,
  RIM_RADIUS,
  ROLL_DECEL,
  SETTLE_SECONDS,
  SHOTS_PER_POSSESSION,
  SWISH_RADIUS,
  createBotRngs,
  createBotState,
  createCourt,
  distanceToHoop,
  driveBot,
  flightProgress,
  foldDirection,
  foldInto,
  halfOf,
  halfSign,
  landingOf,
  otherOf,
  outcomeFor,
  pointsFor,
  powerFor,
  press,
  rangeOf,
  resetBotState,
  resetCourt,
  retainsPossession,
  scored,
  shooterOf,
  shotDirection,
  step,
  takeBack,
  topOfKeyY,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Court, Point } from './rules.js';

const STEP = 1 / 60;

const scratch: Point = { x: 0, y: 0 };

/** Put a court in the aiming phase with the needle where a test wants it. */
function aiming(court: Court): void {
  court.phase = 'aiming';
  court.hold = 0;
}

/** Take one shot with an exact line and carry, skipping the needles entirely. */
function shoot(court: Court, aim: number, power: number): void {
  aiming(court);
  court.aim = aim;
  press(court, court.shooter);
  court.power = power;
  press(court, court.shooter);
}

/** The carry that would drop the ball on the middle of the ring from where it lies. */
function perfectPower(court: Court): number {
  return powerFor(distanceToHoop(court.ball.x, court.ball.y));
}

function stepUntil(court: Court, done: (c: Court) => boolean, limit = 20000): number {
  let steps = 0;
  while (steps < limit && !done(court)) {
    step(court, STEP);
    steps += 1;
  }
  return steps;
}

/** Run one shot to the moment the ball has come to rest and been judged. */
function settle(court: Court): void {
  stepUntil(court, (c) => c.phase === 'settling');
}

/** Run one shot all the way through the hand-over that follows it. */
function throughHandover(court: Court): void {
  const possession = court.possession;
  const shots = court.p1Shots + court.p2Shots;
  stepUntil(
    court,
    (c) =>
      c.phase === 'over' ||
      c.possession !== possession ||
      (c.phase === 'ready' && c.p1Shots + c.p2Shots > shots),
  );
}

function botTiers(): BotDifficulty[] {
  return ['easy', 'normal', 'hard'];
}

/** Play a whole match with a bot in both seats. Returns the steps it took. */
function playBots(seed: number, p1: BotDifficulty, p2: BotDifficulty, court = createCourt()) {
  resetCourt(court);
  const rngs = createBotRngs(new Rng(seed));
  const states = { p1: createBotState(), p2: createBotState() };
  const tiers = { p1, p2 };
  let steps = 0;
  const limit = 60 * 600;
  while (steps < limit && court.winner === null) {
    const seat = court.shooter;
    driveBot(court, seat, tiers[seat], states[seat], rngs[seat], STEP);
    step(court, STEP);
    steps += 1;
  }
  return { court, steps };
}

/**
 * The same court seen from the other side of the device.
 *
 * A half-turn about the centre, which is what the shell does between turns — so anything
 * that is fair has to come out the same on both. Used by the seat-symmetry tests.
 */
function mirrored(court: Court): Court {
  const other = createCourt();
  other.ball.x = COURT_WIDTH - court.ball.x;
  other.ball.y = COURT_HEIGHT - court.ball.y;
  other.shooter = otherOf(court.shooter);
  other.possession = court.possession + 1;
  other.phase = court.phase;
  other.hold = court.hold;
  return other;
}

describe('the floor', () => {
  it('is its own mirror image, which is what lets the court turn half way round', () => {
    expect(MIN_X + MAX_X).toBe(COURT_WIDTH);
    expect(MIN_Y + MAX_Y).toBe(COURT_HEIGHT);
    expect(HOOP_X).toBe(CENTRE_X);
    expect(HOOP_Y).toBe(CENTRE_Y);
  });

  it('gives the two seats mirrored keys', () => {
    expect(topOfKeyY('p1') - CENTRE_Y).toBe(CENTRE_Y - topOfKeyY('p2'));
    expect(halfSign('p1')).toBe(-halfSign('p2'));
  });

  it('keeps the whole take-back arc inside the fence', () => {
    expect(CENTRE_Y - ARC_RADIUS).toBeGreaterThan(MIN_Y);
    expect(CENTRE_X - ARC_RADIUS).toBeGreaterThan(0);
  });

  it('sizes the mouth as the ring less the ball, which is what a shot is judged against', () => {
    expect(MOUTH_RADIUS).toBe(RIM_RADIUS - BALL_RADIUS);
    expect(CLANG_RADIUS).toBe(RIM_RADIUS + BALL_RADIUS);
    expect(SWISH_RADIUS).toBeLessThan(MOUTH_RADIUS);
  });

  it('can reach every legal shot with the range gauge, and no shot needs the very end', () => {
    // The furthest a ball can be taken from is a back corner of a seat's own half.
    const furthest = Math.hypot(MAX_X - HOOP_X, MAX_Y - HOOP_Y);
    expect(furthest).toBeLessThan(MAX_RANGE);
    expect(ARC_RADIUS).toBeGreaterThan(MIN_RANGE);
  });

  it('freezes the needles for longer than the shell takes to turn the court', () => {
    // The flip is 0.36 s. A shorter freeze would hand a bot, which does not go through the
    // shell, a third of a second of needle a person could not have.
    expect(READY_SECONDS).toBeGreaterThan(0.36);
  });
});

describe('the fence', () => {
  it('leaves a point that never reached a wall alone', () => {
    expect(foldInto(300, 0, 1000)).toBe(300);
    expect(foldDirection(300, 0, 1000)).toBe(1);
  });

  it('reflects a point that went past a wall', () => {
    expect(foldInto(1100, 0, 1000)).toBe(900);
    expect(foldInto(-100, 0, 1000)).toBe(100);
    expect(foldDirection(1100, 0, 1000)).toBe(-1);
    expect(foldDirection(-100, 0, 1000)).toBe(-1);
  });

  it('reflects again when a path crosses twice, and gets its direction back', () => {
    expect(foldInto(2100, 0, 1000)).toBe(100);
    expect(foldDirection(2100, 0, 1000)).toBe(1);
  });

  it('lands exactly on a wall without turning round', () => {
    expect(foldInto(1000, 0, 1000)).toBe(1000);
    expect(foldDirection(1000, 0, 1000)).toBe(1);
  });

  it('is idempotent, so folding a folded point changes nothing', () => {
    for (const value of [-2400, -37, 0, 12, 999, 1000, 4300]) {
      const once = foldInto(value, 0, 1000);
      expect(foldInto(once, 0, 1000)).toBeCloseTo(once, 9);
    }
  });

  it('never returns a point outside the walls, however far the path went', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i += 1) {
      const value = (rng.float() - 0.5) * 20000;
      const folded = foldInto(value, MIN_X, MAX_X);
      expect(folded).toBeGreaterThanOrEqual(MIN_X);
      expect(folded).toBeLessThanOrEqual(MAX_X);
    }
  });

  it('collapses safely if it is ever handed a span with nothing in it', () => {
    expect(foldInto(50, 100, 100)).toBe(100);
    expect(foldDirection(50, 100, 100)).toBe(1);
  });
});

describe('whose half the ball is in', () => {
  it('gives the lower half to seat one and the upper to seat two', () => {
    expect(halfOf(CENTRE_Y + 1, 'p1')).toBe('p1');
    expect(halfOf(CENTRE_Y - 1, 'p1')).toBe('p2');
    expect(halfOf(MAX_Y, 'p2')).toBe('p1');
    expect(halfOf(MIN_Y, 'p2')).toBe('p2');
  });

  it('gives a ball that stopped on the line to whoever was not shooting', () => {
    // A held ball, and the only answer that survives the half-turn: mirroring swaps the
    // seats and leaves the line where it is.
    expect(halfOf(CENTRE_Y, 'p1')).toBe('p2');
    expect(halfOf(CENTRE_Y, 'p2')).toBe('p1');
  });
});

describe('the line a shot leaves on', () => {
  it('points straight at the ring when the needle is stopped in the middle', () => {
    shotDirection(scratch, HOOP_X, topOfKeyY('p1'), 0);
    expect(scratch.x).toBeCloseTo(0, 9);
    expect(scratch.y).toBeCloseTo(-1, 9);
  });

  it('is a unit vector at every reading of the needle', () => {
    for (const aim of [-AIM_SWEEP, -0.1, 0, 0.17, AIM_SWEEP]) {
      shotDirection(scratch, 200, 800, aim);
      expect(Math.hypot(scratch.x, scratch.y)).toBeCloseTo(1, 9);
    }
  });

  it('turns one way for a positive reading and the other for a negative one', () => {
    shotDirection(scratch, HOOP_X, topOfKeyY('p1'), AIM_SWEEP);
    const right = scratch.x;
    shotDirection(scratch, HOOP_X, topOfKeyY('p1'), -AIM_SWEEP);
    expect(Math.sign(right)).toBe(-Math.sign(scratch.x));
  });

  it('is measured from the ring rather than from the court, so every spot is the same shot', () => {
    // Two very different places on the floor, the same needle reading, both aimed at the
    // ring. Without this a shot from the corner would need a different press.
    for (const spot of [
      { x: 120, y: 900 },
      { x: 620, y: 620 },
    ]) {
      shotDirection(scratch, spot.x, spot.y, 0);
      const distance = distanceToHoop(spot.x, spot.y);
      expect(spot.x + scratch.x * distance).toBeCloseTo(HOOP_X, 6);
      expect(spot.y + scratch.y * distance).toBeCloseTo(HOOP_Y, 6);
    }
  });

  it('negates exactly under the half-turn, so the two seats face the same shot', () => {
    const aim = 0.13;
    shotDirection(scratch, 220, 760, aim);
    const nearX = scratch.x;
    const nearY = scratch.y;
    shotDirection(scratch, COURT_WIDTH - 220, COURT_HEIGHT - 760, aim);
    expect(scratch.x).toBe(-nearX);
    expect(scratch.y).toBe(-nearY);
  });

  it('does not divide by nothing if the ball is ever asked for from the ring itself', () => {
    shotDirection(scratch, HOOP_X, HOOP_Y, 0);
    expect(Number.isFinite(scratch.x)).toBe(true);
    expect(Math.hypot(scratch.x, scratch.y)).toBeCloseTo(1, 9);
  });
});

describe('the range gauge', () => {
  it('reads back the carry it was asked for', () => {
    for (const distance of [MIN_RANGE, 300, 480, MAX_RANGE]) {
      expect(rangeOf(powerFor(distance))).toBeCloseTo(distance, 6);
    }
  });

  it('clamps a shot nobody could ask for to the ends of the gauge', () => {
    expect(powerFor(0)).toBe(0);
    expect(powerFor(MAX_RANGE + 5000)).toBe(1);
    expect(rangeOf(-3)).toBe(MIN_RANGE);
    expect(rangeOf(9)).toBe(MAX_RANGE);
  });

  it('is absolute rather than scaled to the shot, so a long one is genuinely harder', () => {
    // A fixed error in seconds is a fixed error in units of carry from anywhere, while the
    // same error on the aim needle opens out with distance. That is the whole difference.
    const near = powerFor(ARC_RADIUS);
    const far = powerFor(ARC_RADIUS + 200);
    expect(far - near).toBeCloseTo(200 / (MAX_RANGE - MIN_RANGE), 9);
  });
});

describe('where a shot comes down', () => {
  it('drops on the ring when the line and the carry are both right', () => {
    const court = createCourt();
    landingOf(scratch, court.ball.x, court.ball.y, 0, perfectPower(court));
    expect(distanceToHoop(scratch.x, scratch.y)).toBeCloseTo(0, 6);
  });

  it('never comes down outside the fence, however hard it was thrown', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 400; i += 1) {
      const x = MIN_X + rng.float() * (MAX_X - MIN_X);
      const y = MIN_Y + rng.float() * (MAX_Y - MIN_Y);
      landingOf(scratch, x, y, (rng.float() * 2 - 1) * AIM_SWEEP, rng.float());
      expect(scratch.x).toBeGreaterThanOrEqual(MIN_X);
      expect(scratch.x).toBeLessThanOrEqual(MAX_X);
      expect(scratch.y).toBeGreaterThanOrEqual(MIN_Y);
      expect(scratch.y).toBeLessThanOrEqual(MAX_Y);
    }
  });

  it('bounces off the fence rather than leaving the court', () => {
    // From a corner rebound with everything the gauge has: the ball goes past the ring,
    // hits the side fence and comes back, and the landing is exactly the reflected point.
    const fromX = 640;
    const fromY = 640;
    shotDirection(scratch, fromX, fromY, 0);
    const freeX = fromX + scratch.x * MAX_RANGE;
    const freeY = fromY + scratch.y * MAX_RANGE;
    expect(freeX).toBeLessThan(MIN_X);
    landingOf(scratch, fromX, fromY, 0, 1);
    expect(scratch.x).toBeCloseTo(MIN_X + (MIN_X - freeX), 6);
    expect(scratch.y).toBeCloseTo(foldInto(freeY, MIN_Y, MAX_Y), 6);
  });
});

describe('judging a landing', () => {
  it('calls the middle of the ring a swish and pays three', () => {
    expect(outcomeFor(0)).toBe('swish');
    expect(outcomeFor(SWISH_RADIUS)).toBe('swish');
    expect(pointsFor('swish')).toBe(POINTS_SWISH);
    expect(scored('swish')).toBe(true);
  });

  it('calls anything else through the mouth a basket and pays two', () => {
    expect(outcomeFor(SWISH_RADIUS + 0.001)).toBe('basket');
    expect(outcomeFor(MOUTH_RADIUS)).toBe('basket');
    expect(pointsFor('basket')).toBe(POINTS_BASKET);
    expect(scored('basket')).toBe(true);
  });

  it('calls a ball that touched the ring a clang, and pays nothing', () => {
    expect(outcomeFor(MOUTH_RADIUS + 0.001)).toBe('rim');
    expect(outcomeFor(CLANG_RADIUS)).toBe('rim');
    expect(pointsFor('rim')).toBe(0);
    expect(scored('rim')).toBe(false);
  });

  it('calls a ball that missed the ring entirely a brick', () => {
    expect(outcomeFor(CLANG_RADIUS + 0.001)).toBe('brick');
    expect(outcomeFor(900)).toBe('brick');
    expect(pointsFor('brick')).toBe(0);
    expect(scored('brick')).toBe(false);
  });
});

describe('a fresh court', () => {
  it('starts level with no winner', () => {
    const court = createCourt();
    expect(court.p1Points).toBe(0);
    expect(court.p2Points).toBe(0);
    expect(winnerOf(court)).toBeNull();
  });

  it('starts with seat one on the ball, at the top of their own key', () => {
    const court = createCourt();
    expect(court.shooter).toBe('p1');
    expect(court.possession).toBe(1);
    expect(court.ball.x).toBe(HOOP_X);
    expect(court.ball.y).toBe(topOfKeyY('p1'));
    expect(distanceToHoop(court.ball.x, court.ball.y)).toBeCloseTo(ARC_RADIUS, 9);
  });

  it('alternates the ball, so both seats get the same number of possessions', () => {
    expect(shooterOf(1)).toBe('p1');
    expect(shooterOf(2)).toBe('p2');
    expect(shooterOf(POSSESSIONS)).toBe('p2');
    expect(POSSESSIONS % 2).toBe(0);
    let p1 = 0;
    for (let i = 1; i <= POSSESSIONS; i += 1) if (shooterOf(i) === 'p1') p1 += 1;
    expect(p1).toBe(POSSESSIONS / 2);
  });

  it('is put back to the start by a reset, however far a match had gone', () => {
    const { court } = playBots(3, 'hard', 'easy');
    expect(court.winner).not.toBeNull();
    resetCourt(court);
    expect(court.winner).toBeNull();
    expect(court.possession).toBe(1);
    expect(court.shooter).toBe('p1');
    expect(court.p1Points + court.p2Points).toBe(0);
    expect(court.p1Shots + court.p2Shots).toBe(0);
    expect(court.phase).toBe('ready');
  });
});

describe('the two presses', () => {
  it('refuses a press from the seat that is not shooting', () => {
    const court = createCourt();
    aiming(court);
    expect(press(court, 'p2')).toBe(false);
    expect(court.phase).toBe('aiming');
  });

  it('refuses a press while the needles are still frozen', () => {
    const court = createCourt();
    expect(court.phase).toBe('ready');
    expect(press(court, 'p1')).toBe(false);
    expect(court.phase).toBe('ready');
  });

  it('lifts the freeze after the ready seconds, to within the frame that notices', () => {
    const court = createCourt();
    const steps = stepUntil(court, (c) => c.phase === 'aiming');
    expect(steps * STEP).toBeGreaterThanOrEqual(READY_SECONDS - STEP);
    expect(steps * STEP).toBeLessThanOrEqual(READY_SECONDS + STEP);
  });

  it('keeps the line on the first press and the carry on the second', () => {
    const court = createCourt();
    aiming(court);
    court.aim = 0.11;
    expect(press(court, 'p1')).toBe(true);
    expect(court.phase).toBe('charging');
    expect(court.lockedAim).toBe(0.11);
    court.power = 0.4;
    expect(press(court, 'p1')).toBe(true);
    expect(court.phase).toBe('flying');
    expect(court.lockedPower).toBe(0.4);
  });

  it('does nothing at all once the ball has left the hand', () => {
    const court = createCourt();
    shoot(court, 0, perfectPower(court));
    expect(court.phase).toBe('flying');
    expect(press(court, 'p1')).toBe(false);
    expect(press(court, 'p2')).toBe(false);
  });

  it('sweeps the aim needle across its gauge and turns it round at both ends', () => {
    const court = createCourt();
    stepUntil(court, (c) => c.phase === 'aiming');
    expect(court.aim).toBeCloseTo(-AIM_SWEEP, 6);
    const crossing = Math.ceil(((2 * AIM_SWEEP) / AIM_RATE) * 60);
    for (let i = 0; i < crossing; i += 1) step(court, STEP);
    expect(court.aim).toBeCloseTo(AIM_SWEEP, 6);
    expect(court.aimRising).toBe(false);
    for (let i = 0; i < crossing; i += 1) step(court, STEP);
    expect(court.aim).toBeCloseTo(-AIM_SWEEP, 6);
    expect(court.aimRising).toBe(true);
  });

  it('sweeps the range needle across its gauge and turns it round at both ends', () => {
    const court = createCourt();
    aiming(court);
    press(court, 'p1');
    expect(court.power).toBe(0);
    const crossing = Math.ceil((1 / POWER_RATE) * 60);
    for (let i = 0; i < crossing; i += 1) step(court, STEP);
    expect(court.power).toBeCloseTo(1, 6);
    expect(court.powerRising).toBe(false);
    for (let i = 0; i < crossing; i += 1) step(court, STEP);
    expect(court.power).toBeCloseTo(0, 6);
    expect(court.powerRising).toBe(true);
  });

  it('parks the aim needle at one end of the sweep rather than on the ring', () => {
    // Parked in the middle it would already be pointing at the ring on the step the freeze
    // lifts, and an instant press would be a free perfect line.
    const court = createCourt();
    expect(court.aim).toBe(-AIM_SWEEP);
    expect(Math.abs(court.aim)).toBe(AIM_SWEEP);
  });
});

describe('a shot in the air', () => {
  it('stays inside the fence on every step of its flight', () => {
    const court = createCourt();
    shoot(court, AIM_SWEEP, 1);
    while (court.phase === 'flying') {
      step(court, STEP);
      expect(court.ball.x).toBeGreaterThanOrEqual(MIN_X);
      expect(court.ball.x).toBeLessThanOrEqual(MAX_X);
      expect(court.ball.y).toBeGreaterThanOrEqual(MIN_Y);
      expect(court.ball.y).toBeLessThanOrEqual(MAX_Y);
    }
  });

  it('reports how far through the flight it is, and nothing at all when it is not flying', () => {
    const court = createCourt();
    expect(flightProgress(court)).toBe(0);
    shoot(court, 0, perfectPower(court));
    step(court, STEP);
    expect(flightProgress(court)).toBeGreaterThan(0);
    expect(flightProgress(court)).toBeLessThan(1);
    settle(court);
    expect(flightProgress(court)).toBe(0);
  });

  it('comes down where the closed form said it would', () => {
    const court = createCourt();
    landingOf(scratch, court.ball.x, court.ball.y, 0.08, 0.55);
    const wantX = scratch.x;
    const wantY = scratch.y;
    shoot(court, 0.08, 0.55);
    // Sampled on the step the ball comes down rather than the step after it. The step that
    // ends the flight hands its unused part to the roll, so a frame later the ball is
    // already a fraction of a step off the spot it landed on — which is correct, and is not
    // what the closed form is a claim about. Whole frames up to the last, then exactly the
    // flight that is left, so the roll gets nothing.
    stepUntil(court, (c) => c.flightTime - c.flight <= STEP);
    step(court, court.flightTime - court.flight);
    expect(court.phase).toBe('rolling');
    expect(court.roll).toBe(0);
    expect(court.ball.x).toBeCloseTo(wantX, 6);
    expect(court.ball.y).toBeCloseTo(wantY, 6);
  });

  it('takes longer to come down the further it was thrown', () => {
    const near = createCourt();
    shoot(near, 0, 0);
    const far = createCourt();
    shoot(far, 0, 1);
    expect(far.flightTime).toBeGreaterThan(near.flightTime);
  });
});

describe('a shot that goes in', () => {
  it('scores, and counts a basket for the seat that took it', () => {
    const court = createCourt();
    shoot(court, 0, perfectPower(court));
    settle(court);
    expect(court.lastOutcome).toBe('swish');
    expect(court.p1Points).toBe(POINTS_SWISH);
    expect(court.p1Baskets).toBe(1);
    expect(court.p1Swishes).toBe(1);
    expect(court.p2Points).toBe(0);
  });

  it('pays two for one that goes in off the ring rather than through the middle', () => {
    const court = createCourt();
    // Short by more than the clean-drop circle but still inside the mouth.
    const short = (SWISH_RADIUS + MOUTH_RADIUS) / 2;
    shoot(court, 0, powerFor(ARC_RADIUS - short));
    settle(court);
    expect(court.lastOutcome).toBe('basket');
    expect(court.p1Points).toBe(POINTS_BASKET);
    expect(court.p1Swishes).toBe(0);
  });

  it('ends the possession, whatever the shot clock said', () => {
    const court = createCourt();
    shoot(court, 0, perfectPower(court));
    settle(court);
    expect(retainsPossession(court)).toBe(false);
    throughHandover(court);
    expect(court.shooter).toBe('p2');
    expect(court.possession).toBe(2);
  });

  it('hands the ball to the other seat at the top of their own key', () => {
    const court = createCourt();
    shoot(court, 0, perfectPower(court));
    throughHandover(court);
    expect(court.ball.x).toBe(HOOP_X);
    expect(court.ball.y).toBe(topOfKeyY('p2'));
  });
});

describe('a shot that misses', () => {
  it('rebounds into the shooter own half when it was short off the ring', () => {
    const court = createCourt();
    // Land on the near side of the ring, inside the ring's own width: a clang.
    shoot(court, 0, powerFor(ARC_RADIUS - (MOUTH_RADIUS + CLANG_RADIUS) / 2));
    settle(court);
    expect(court.lastOutcome).toBe('rim');
    expect(halfOf(court.ball.y, 'p1')).toBe('p1');
    expect(retainsPossession(court)).toBe(true);
  });

  it('rebounds away when it was long off the ring, and the possession is over', () => {
    const court = createCourt();
    shoot(court, 0, powerFor(ARC_RADIUS + (MOUTH_RADIUS + CLANG_RADIUS) / 2));
    settle(court);
    expect(court.lastOutcome).toBe('rim');
    expect(halfOf(court.ball.y, 'p1')).toBe('p2');
    expect(retainsPossession(court)).toBe(false);
  });

  it('keeps rolling on the line it was on when it never touched the ring', () => {
    const court = createCourt();
    shoot(court, 0, 0);
    stepUntil(court, (c) => c.phase === 'rolling');
    const startY = court.ball.y;
    settle(court);
    expect(court.lastOutcome).toBe('brick');
    // Thrown up the court, so it keeps going up the court.
    expect(court.ball.y).toBeLessThan(startY);
  });

  it('stays inside the fence on every step of the roll', () => {
    const court = createCourt();
    shoot(court, AIM_SWEEP, 1);
    stepUntil(court, (c) => c.phase === 'rolling' || c.phase === 'settling');
    while (court.phase === 'rolling') {
      step(court, STEP);
      expect(court.ball.x).toBeGreaterThanOrEqual(MIN_X);
      expect(court.ball.x).toBeLessThanOrEqual(MAX_X);
      expect(court.ball.y).toBeGreaterThanOrEqual(MIN_Y);
      expect(court.ball.y).toBeLessThanOrEqual(MAX_Y);
    }
  });

  it('always comes to a stop, from any shot on the gauge', () => {
    const rng = new Rng(23);
    for (let i = 0; i < 120; i += 1) {
      const court = createCourt();
      shoot(court, (rng.float() * 2 - 1) * AIM_SWEEP, rng.float());
      const steps = stepUntil(court, (c) => c.phase === 'settling', 2000);
      expect(steps).toBeLessThan(2000);
      expect(court.phase).toBe('settling');
    }
  });

  it('holds the ball where it stopped for the settle, then hands it on', () => {
    const court = createCourt();
    shoot(court, 0, 1);
    settle(court);
    const restY = court.ball.y;
    for (let i = 0; i < Math.floor(SETTLE_SECONDS * 60) - 1; i += 1) step(court, STEP);
    expect(court.ball.y).toBe(restY);
    expect(court.phase).toBe('settling');
  });
});

describe('the take-back line', () => {
  it('carries a rebound that stopped under the ring back out along its own line', () => {
    takeBack(scratch, HOOP_X + 60, HOOP_Y + 80);
    expect(distanceToHoop(scratch.x, scratch.y)).toBeCloseTo(ARC_RADIUS, 6);
    // Same bearing: 3-4-5, so the angle survives the walk out.
    expect((scratch.x - HOOP_X) / (scratch.y - HOOP_Y)).toBeCloseTo(60 / 80, 9);
  });

  it('leaves a rebound that stopped outside the arc where it lies', () => {
    takeBack(scratch, HOOP_X + 10, HOOP_Y + ARC_RADIUS + 40);
    expect(scratch.x).toBe(HOOP_X + 10);
    expect(scratch.y).toBe(HOOP_Y + ARC_RADIUS + 40);
  });

  it('has an answer for a ball that stopped in the ring itself', () => {
    takeBack(scratch, HOOP_X, HOOP_Y);
    expect(distanceToHoop(scratch.x, scratch.y)).toBeCloseTo(ARC_RADIUS, 6);
  });

  it('is applied to a rebound the shooter kept, so no put-back is a gimme', () => {
    const court = createCourt();
    // Barely outside the mouth on the near side, so the ring throws it back a short way.
    shoot(court, 0, powerFor(ARC_RADIUS - (MOUTH_RADIUS + 1)));
    settle(court);
    expect(court.lastOutcome).toBe('rim');
    expect(distanceToHoop(court.ball.x, court.ball.y)).toBeLessThan(ARC_RADIUS);
    expect(retainsPossession(court)).toBe(true);
    throughHandover(court);
    expect(court.shooter).toBe('p1');
    expect(distanceToHoop(court.ball.x, court.ball.y)).toBeGreaterThanOrEqual(ARC_RADIUS - 1e-6);
  });

  it('never leaves a put-back closer than a fresh possession would be', () => {
    // Every shot in the game is taken from the arc or beyond it, whoever is shooting and
    // however the rebound fell, so no seat can work its way under the ring.
    const rng = new Rng(61);
    for (let i = 0; i < 60; i += 1) {
      const court = createCourt();
      let guard = 0;
      while (court.winner === null && guard < 400) {
        expect(distanceToHoop(court.ball.x, court.ball.y)).toBeGreaterThanOrEqual(
          ARC_RADIUS - 1e-6,
        );
        shoot(court, (rng.float() * 2 - 1) * AIM_SWEEP, rng.float());
        throughHandover(court);
        guard += 1;
      }
    }
  });
});

describe('the shot clock', () => {
  it('counts the shots taken inside one possession', () => {
    const court = createCourt();
    expect(court.shotsThisPossession).toBe(0);
    shoot(court, 0, 0.5);
    expect(court.shotsThisPossession).toBe(1);
  });

  it('hands the ball over after its last shot even when the rebound came back', () => {
    const court = createCourt();
    const keeper = powerFor(ARC_RADIUS - (MOUTH_RADIUS + CLANG_RADIUS) / 2);
    for (let i = 0; i < SHOTS_PER_POSSESSION; i += 1) {
      expect(court.shooter).toBe('p1');
      shoot(court, 0, keeper);
      throughHandover(court);
    }
    expect(court.shotsThisPossession).toBe(0);
    expect(court.shooter).toBe('p2');
    expect(court.p1Shots).toBe(SHOTS_PER_POSSESSION);
  });

  it('resets for the seat taking over', () => {
    const court = createCourt();
    shoot(court, 0, 1);
    throughHandover(court);
    expect(court.shooter).toBe('p2');
    expect(court.shotsThisPossession).toBe(0);
  });
});

describe('the end of a match', () => {
  it('runs exactly the possessions it advertises', () => {
    const { court } = playBots(41, 'normal', 'normal');
    expect(court.possession).toBe(POSSESSIONS);
    expect(court.phase).toBe('over');
  });

  it('gives the match to the higher score', () => {
    const court = createCourt();
    court.possession = POSSESSIONS;
    court.shooter = 'p2';
    court.p1Points = 8;
    court.p2Points = 6;
    shoot(court, 0, 0);
    stepUntil(court, (c) => c.phase === 'over');
    expect(winnerOf(court)).toBe('p1');
  });

  it('breaks a level score on clean makes', () => {
    const court = createCourt();
    court.possession = POSSESSIONS;
    court.shooter = 'p2';
    court.p1Points = 6;
    court.p2Points = 6;
    court.p1Swishes = 0;
    court.p2Swishes = 2;
    shoot(court, 0, 0);
    stepUntil(court, (c) => c.phase === 'over');
    expect(winnerOf(court)).toBe('p2');
  });

  it('is a draw when neither the score nor the clean makes separate them', () => {
    const court = createCourt();
    court.possession = POSSESSIONS;
    court.shooter = 'p2';
    court.p1Points = 4;
    court.p2Points = 4;
    court.p1Swishes = 1;
    court.p2Swishes = 1;
    shoot(court, 0, 0);
    stepUntil(court, (c) => c.phase === 'over');
    expect(winnerOf(court)).toBe('draw');
  });

  it('stops stepping once it is over', () => {
    const { court } = playBots(19, 'easy', 'easy');
    const points = court.p1Points + court.p2Points;
    const ballX = court.ball.x;
    for (let i = 0; i < 600; i += 1) step(court, STEP);
    expect(court.p1Points + court.p2Points).toBe(points);
    expect(court.ball.x).toBe(ballX);
  });

  it('is reached by two of the weakest bots well inside the guard budget', () => {
    // The guard allows ten simulated minutes. The weakest pairing is the slowest, because
    // a blundered press runs the needle round again before it fires.
    let worst = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const { court, steps } = playBots(9000 + seed * 13, 'easy', 'easy');
      expect(court.winner).not.toBeNull();
      worst = Math.max(worst, steps);
    }
    expect(worst).toBeLessThan(60 * 120);
  });
});

describe('the same match twice', () => {
  it('plays out identically from the same seed', () => {
    const a = playBots(2026, 'normal', 'hard');
    const b = playBots(2026, 'normal', 'hard');
    expect(b.steps).toBe(a.steps);
    expect(b.court.p1Points).toBe(a.court.p1Points);
    expect(b.court.p2Points).toBe(a.court.p2Points);
    expect(b.court.ball.x).toBe(a.court.ball.x);
    expect(b.court.ball.y).toBe(a.court.ball.y);
  });

  it('plays out differently from a different seed', () => {
    const a = playBots(1, 'normal', 'normal');
    const b = playBots(2, 'normal', 'normal');
    expect(`${a.court.p1Points}:${a.court.p2Points}:${a.steps}`).not.toBe(
      `${b.court.p1Points}:${b.court.p2Points}:${b.steps}`,
    );
  });

  it('draws no random numbers of its own, so two people play a fixed game', () => {
    // Nothing in the rules is random: only the bots draw. A seat's shots are a function of
    // its presses and nothing else, which is what makes "shade it short" advice.
    const a = createCourt();
    const b = createCourt();
    shoot(a, 0.07, 0.42);
    shoot(b, 0.07, 0.42);
    settle(a);
    settle(b);
    expect(b.ball.x).toBe(a.ball.x);
    expect(b.ball.y).toBe(a.ball.y);
    expect(b.lastOutcome).toBe(a.lastOutcome);
  });
});

describe('the frame rate', () => {
  it('rolls to the same place at 60 Hz and at 120 Hz', () => {
    // The roll is a closed form of elapsed time rather than an accumulated velocity, so a
    // finer timestep lands on the same arc length rather than drifting away from it.
    const roll = (rate: number): Point => {
      const court = createCourt();
      court.phase = 'rolling';
      court.rollFromX = 220;
      court.rollFromY = 700;
      court.rollDirX = 0.6;
      court.rollDirY = -0.8;
      court.rollDistance = 260;
      court.rollDuration = Math.sqrt((2 * 260) / ROLL_DECEL);
      court.rollSpeed = ROLL_DECEL * court.rollDuration;
      court.roll = 0;
      for (let i = 0; i < rate / 4; i += 1) step(court, 1 / rate);
      return { x: court.ball.x, y: court.ball.y };
    };
    const slow = roll(60);
    const fast = roll(120);
    expect(fast.x).toBeCloseTo(slow.x, 6);
    expect(fast.y).toBeCloseTo(slow.y, 6);
  });

  it('flies to the same place at 60 Hz and at 120 Hz', () => {
    const fly = (rate: number): Point => {
      const court = createCourt();
      shoot(court, 0.1, 0.6);
      for (let i = 0; i < rate / 5; i += 1) step(court, 1 / rate);
      return { x: court.ball.x, y: court.ball.y };
    };
    const slow = fly(60);
    const fast = fly(120);
    expect(fast.x).toBeCloseTo(slow.x, 4);
    expect(fast.y).toBeCloseTo(slow.y, 4);
  });

  it('sweeps both needles to the same reading at 60 Hz and at 120 Hz', () => {
    const sweep = (rate: number): number => {
      const court = createCourt();
      for (let i = 0; i < rate; i += 1) step(court, 1 / rate);
      return court.aim;
    };
    expect(sweep(120)).toBeCloseTo(sweep(60), 6);
  });
});

describe('the bot', () => {
  it('draws exactly the same number of values whatever it decides', () => {
    for (const tier of botTiers()) {
      const counts = new Set<number>();
      for (let seed = 0; seed < 30; seed += 1) {
        const rng = new Rng(seed);
        const probe = new Rng(seed);
        const court = createCourt();
        const state = createBotState();
        aiming(court);
        driveBot(court, 'p1', tier, state, rng, STEP);
        let drawn = 0;
        while (probe.next() !== rng.next() && drawn < 40) drawn += 1;
        counts.add(drawn);
      }
      // Every seed advanced the generator by the same amount: nothing it chose changed the
      // draw count, which is what keeps a seat's shots independent of its opponent's.
      expect(counts.size).toBe(1);
    }
  });

  it('advances its generator by the documented number of draws a shot', () => {
    const rng = new Rng(5);
    const probe = new Rng(5);
    const court = createCourt();
    aiming(court);
    driveBot(court, 'p1', 'normal', createBotState(), rng, STEP);
    for (let i = 0; i < BOT_DRAWS_PER_SHOT; i += 1) probe.next();
    expect(rng.next()).toBe(probe.next());
  });

  it('wants the carry that would drop the ball on the ring', () => {
    const court = createCourt();
    court.ball.x = 240;
    court.ball.y = 820;
    aiming(court);
    const state = createBotState();
    driveBot(court, 'p1', 'hard', state, new Rng(4), STEP);
    expect(state.wantPower).toBeCloseTo(powerFor(distanceToHoop(240, 820)), 9);
  });

  it('never presses for a seat that is not shooting', () => {
    const court = createCourt();
    aiming(court);
    const state = createBotState();
    expect(driveBot(court, 'p2', 'hard', state, new Rng(1), STEP)).toBe(false);
    expect(court.phase).toBe('aiming');
  });

  it('never presses while the needles are frozen', () => {
    const court = createCourt();
    const state = createBotState();
    for (let i = 0; i < Math.floor(READY_SECONDS * 60) - 1; i += 1) {
      expect(driveBot(court, 'p1', 'hard', state, new Rng(2), STEP)).toBe(false);
      step(court, STEP);
    }
    expect(court.phase).toBe('ready');
  });

  it('always gets both presses away, from any tier and any seed', () => {
    // It counts down to a moment rather than watching for a position: watching for a
    // position hangs, because an error larger than the gauge is out of reach both ways.
    for (const tier of botTiers()) {
      for (let seed = 0; seed < 60; seed += 1) {
        const court = createCourt();
        const state = createBotState();
        const rng = new Rng(seed * 31 + 1);
        let steps = 0;
        while (court.phase !== 'flying' && steps < 2000) {
          driveBot(court, 'p1', tier, state, rng, STEP);
          step(court, STEP);
          steps += 1;
        }
        expect(court.phase).toBe('flying');
      }
    }
  });

  it('is reset to a clean slate, so a torn-down match leaves nothing behind', () => {
    const court = createCourt();
    aiming(court);
    const state = createBotState();
    driveBot(court, 'p1', 'easy', state, new Rng(8), STEP);
    resetBotState(state);
    expect(state.stage).toBe('plan');
    expect(state.wantPower).toBe(0);
    expect(state.lineTimer).toBe(0);
    expect(state.rangeTimer).toBe(0);
  });

  it('gives each seat its own generator, drawn before anything else touches the match', () => {
    const source = new Rng(77);
    const rngs = createBotRngs(source);
    expect(rngs.p1.next()).not.toBe(rngs.p2.next());
    const again = createBotRngs(new Rng(77));
    expect(again.p1.next()).toBe(new Rng(new Rng(77).next() | 0).next());
  });

  it('plays a seat identically whoever it is playing against', () => {
    // The point of a generator each: seat two's shots must not become a function of how
    // well seat one has been shooting, which a shared stream makes them here because a
    // possession is one shot or three depending on the rebound.
    const against = (opponent: BotDifficulty): string => {
      const { court } = playBots(4242, opponent, 'normal');
      return `${court.p2Shots}:${court.p2Baskets}:${court.p2Swishes}`;
    };
    expect(against('hard')).toBe(against('easy'));
  });
});

describe('the three tiers', () => {
  it('are ordered by how accurately they hit the moment they meant to', () => {
    expect(BOT_PROFILES.easy.timing).toBeGreaterThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeGreaterThan(BOT_PROFILES.hard.timing);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
  });

  it('are all wider than a frame, so none of them out-times a person', () => {
    // Rule 6: a bot may not stop a needle more finely than a human hand can.
    for (const tier of botTiers()) {
      expect(BOT_PROFILES[tier].timing).toBeGreaterThan(2 * STEP);
    }
    expect(BLUNDER_SCALE).toBeGreaterThan(1);
  });

  it('make shots at rates that are genuinely different', () => {
    const rate = (tier: BotDifficulty): number => {
      let shots = 0;
      let baskets = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const { court } = playBots(300000 + seed * 97, tier, tier);
        shots += court.p1Shots + court.p2Shots;
        baskets += court.p1Baskets + court.p2Baskets;
      }
      return baskets / shots;
    };
    const easy = rate('easy');
    const normal = rate('normal');
    const hard = rate('hard');
    expect(easy).toBeLessThan(normal - 0.1);
    expect(normal).toBeLessThan(hard - 0.1);
    expect(easy).toBeGreaterThan(0.05);
    expect(hard).toBeLessThan(0.95);
  });

  it('are ordered by who wins, and by a wide margin', () => {
    const wins = (a: BotDifficulty, b: BotDifficulty): number => {
      let stronger = 0;
      let decided = 0;
      for (let seed = 0; seed < 120; seed += 1) {
        const { court } = playBots(700000 + seed * 53, a, b);
        if (court.winner === 'draw' || court.winner === null) continue;
        decided += 1;
        if (court.winner === 'p2') stronger += 1;
      }
      return stronger / decided;
    };
    expect(wins('easy', 'hard')).toBeGreaterThan(0.9);
    expect(wins('easy', 'normal')).toBeGreaterThan(0.7);
    expect(wins('normal', 'hard')).toBeGreaterThan(0.7);
  });

  it('do not favour a seat when both seats play the same tier', () => {
    for (const tier of botTiers()) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        const { court } = playBots(50000 + seed * 41, tier, tier);
        if (court.winner === 'draw' || court.winner === null) continue;
        decided += 1;
        if (court.winner === 'p1') p1 += 1;
      }
      expect(decided).toBeGreaterThan(120);
      expect(Math.abs(p1 / decided - 0.5)).toBeLessThan(0.12);
    }
  });
});

describe('the two seats', () => {
  it('face the same shot from mirrored places on the floor', () => {
    const near = createCourt();
    near.ball.x = 260;
    near.ball.y = 790;
    const far = mirrored(near);
    expect(far.shooter).toBe('p2');

    shoot(near, 0.09, 0.55);
    shoot(far, 0.09, 0.55);
    settle(near);
    settle(far);

    expect(far.lastOutcome).toBe(near.lastOutcome);
    expect(far.lastPoints).toBe(near.lastPoints);
    expect(far.ball.x).toBeCloseTo(COURT_WIDTH - near.ball.x, 6);
    expect(far.ball.y).toBeCloseTo(COURT_HEIGHT - near.ball.y, 6);
  });

  it('keep or lose a rebound on the same rule, mirrored', () => {
    const keeper = powerFor(ARC_RADIUS - (MOUTH_RADIUS + CLANG_RADIUS) / 2);
    const loser = powerFor(ARC_RADIUS + (MOUTH_RADIUS + CLANG_RADIUS) / 2);
    for (const power of [keeper, loser]) {
      const near = createCourt();
      const far = mirrored(near);
      shoot(near, 0, power);
      shoot(far, 0, power);
      settle(near);
      settle(far);
      expect(retainsPossession(far)).toBe(retainsPossession(near));
    }
  });

  it('score the same shot the same way from either end', () => {
    const near = createCourt();
    const far = mirrored(near);
    shoot(near, 0, perfectPower(near));
    shoot(far, 0, perfectPower(far));
    settle(near);
    settle(far);
    expect(near.p1Points).toBe(far.p2Points);
    expect(near.p1Swishes).toBe(far.p2Swishes);
  });

  it('shoot from mirrored spots for a whole match', () => {
    // A bot in seat two on the same generator must produce the mirror of seat one's match,
    // because nothing in the rules distinguishes the two ends.
    const rng = () => new Rng(1234);
    const play = (seat: SeatId): string => {
      const court = createCourt();
      court.shooter = seat;
      court.possession = seat === 'p1' ? 1 : 2;
      court.ball.y = topOfKeyY(seat);
      const state = createBotState();
      const generator = rng();
      const marks: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        driveBot(court, seat, 'normal', state, generator, STEP);
        step(court, STEP);
        if (court.phase === 'settling') {
          marks.push(`${court.lastOutcome}:${court.lastPoints}`);
          court.phase = 'ready';
          court.hold = 0;
          court.ball.x = HOOP_X;
          court.ball.y = topOfKeyY(seat);
          resetBotState(state);
        }
        if (court.phase === 'ready') {
          court.hold = 0;
        }
      }
      return marks.join('|');
    };
    expect(play('p2')).toBe(play('p1'));
  });
});
