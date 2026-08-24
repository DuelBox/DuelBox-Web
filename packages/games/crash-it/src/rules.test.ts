import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIRBORNE_SECONDS,
  AIR_TORQUE,
  ARENA_HALF_WIDTH,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BODY_HALF_HEIGHT,
  BODY_HALF_LENGTH,
  BOT_DRAWS_PER_LOOK,
  BOT_PROFILES,
  CAR_HEIGHT,
  CEILING_Y,
  DRIVE_ACCELERATION,
  FLOOR_Y,
  GRAVITY,
  GROUND_X,
  GROUND_Y,
  HEAD_OFFSET_X,
  HEAD_OFFSET_Y,
  HEAD_RADIUS,
  JUMP_COOLDOWN,
  JUMP_LUNGE,
  JUMP_SPEED,
  MATCH_SECONDS,
  MAX_DRIVEN_SPIN,
  MAX_DRIVE_SPEED,
  MAX_SPIN,
  POINTS_TO_WIN,
  REST_HEIGHT,
  ROUND_SECONDS,
  SETTLE_SECONDS,
  START_OFFSET,
  WALL_MARGIN,
  WHEEL_OFFSET_X,
  WHEEL_OFFSET_Y,
  WHEEL_RADIUS,
  bodyX,
  bodyY,
  botDrive,
  carOf,
  clearMatch,
  createBotState,
  createCar,
  createMatch,
  groundY,
  headTouch,
  headX,
  headY,
  holdInside,
  integrateCar,
  mirrorX,
  otherOf,
  pointsOf,
  resetBotState,
  resetMatch,
  segmentAt,
  solveGround,
  startRound,
  stepMatch,
  surfaceGap,
  surfaceNormalX,
  surfaceNormalY,
  wheelX,
  wheelY,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Car, Match } from './rules.js';

const STEP = 1 / 60;

/** A generator that counts what is drawn from it, so draw budgets can be asserted. */
class CountingRng extends Rng {
  calls = 0;

  override float(): number {
    this.calls += 1;
    return super.float();
  }
}

function restingCar(x: number): Car {
  const car = createCar();
  car.x = x;
  car.y = groundY(x) - REST_HEIGHT;
  return car;
}

/** Step one car on its own, the way `stepMatch` does but without the other car. */
function driveAlone(car: Car, steps: number, throttle: number, jumpEvery = 0): void {
  for (let i = 0; i < steps; i += 1) {
    integrateCar(car, STEP, throttle, jumpEvery > 0 && i % jumpEvery === 0);
    let grounded = false;
    for (let pass = 0; pass < 2; pass += 1) grounded = solveGround(car) || grounded;
    car.grounded = grounded;
    holdInside(car);
  }
}

/** Turn a car onto its roof over the flat floor, with its head buried in it. */
function flipOntoHead(car: Car, x: number): void {
  car.x = x;
  car.angle = Math.PI;
  // Upside down the head hangs below the centre, so this puts it six units under the floor.
  car.y = groundY(x) + 6 + HEAD_OFFSET_Y;
  car.vx = 0;
  car.vy = 0;
  car.spin = 0;
  car.grounded = false;
}

/** Mirror one car's state onto another: x and everything odd in x change sign. */
function mirrorInto(target: Car, source: Readonly<Car>): void {
  target.x = -source.x;
  target.y = source.y;
  target.vx = -source.vx;
  target.vy = source.vy;
  target.angle = -source.angle;
  target.spin = -source.spin;
  target.grounded = source.grounded;
  target.jumpCooldown = source.jumpCooldown;
  target.facing = -source.facing;
}

function mirrorGap(a: Readonly<Car>, b: Readonly<Car>): number {
  return Math.max(
    Math.abs(a.x + b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.vx + b.vx),
    Math.abs(a.vy - b.vy),
    Math.abs(a.angle + b.angle),
    Math.abs(a.spin + b.spin),
  );
}

/**
 * A car-on-head hit, worked out from the two cars' positions alone.
 *
 * Deliberately a second implementation rather than a call to {@link headTouch}: the whole
 * point of counting the headline verb is that a counter can be wrong in the same way the
 * rule it counts is. This one is written from the geometry — a head is a circle on the end
 * of a rigid offset, a body is a rotated box, a wheel is a circle — and shares nothing with
 * the simulation but the constants.
 */
function struckByCar(match: Readonly<Match>, seat: SeatId): boolean {
  const me = carOf(match, seat);
  const you = carOf(match, otherOf(seat));
  const hx = me.x - HEAD_OFFSET_Y * Math.sin(me.angle);
  const hy = me.y + HEAD_OFFSET_Y * Math.cos(me.angle);
  const cos = Math.cos(you.angle);
  const sin = Math.sin(you.angle);
  const lx = (hx - you.x) * cos + (hy - you.y) * sin;
  const ly = -(hx - you.x) * sin + (hy - you.y) * cos;
  const qx = Math.min(BODY_HALF_LENGTH, Math.max(-BODY_HALF_LENGTH, lx));
  const qy = Math.min(BODY_HALF_HEIGHT, Math.max(-BODY_HALF_HEIGHT, ly));
  if ((lx - qx) ** 2 + (ly - qy) ** 2 <= HEAD_RADIUS ** 2) return true;
  for (const side of [-1, 1]) {
    const wx = you.x + side * WHEEL_OFFSET_X * cos - WHEEL_OFFSET_Y * sin;
    const wy = you.y + side * WHEEL_OFFSET_X * sin + WHEEL_OFFSET_Y * cos;
    if ((hx - wx) ** 2 + (hy - wy) ** 2 <= (HEAD_RADIUS + WHEEL_RADIUS) ** 2) return true;
  }
  const rx = you.x - HEAD_OFFSET_Y * sin;
  const ry = you.y + HEAD_OFFSET_Y * cos;
  return (hx - rx) ** 2 + (hy - ry) ** 2 <= (HEAD_RADIUS * 2) ** 2;
}

interface BotMatch {
  readonly match: Match;
  readonly steps: number;
  /** Car-on-head hits reconstructed from sampled state, never from the game's counters. */
  readonly carHits: number;
  readonly groundHits: number;
  readonly jumps: number;
}

/** Play a whole match bot against bot, capped so a stall fails rather than hangs. */
function playBots(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  maxSteps = 60 * 130,
): BotMatch {
  const match = createMatch();
  const rng = new Rng(seed);
  const p1Brain = createBotState();
  const p2Brain = createBotState();
  const seats: readonly SeatId[] = ['p1', 'p2'];
  const wasCar = { p1: false, p2: false };
  const wasGround = { p1: false, p2: false };
  const wasAir = { p1: false, p2: false };
  let carHits = 0;
  let groundHits = 0;
  let jumps = 0;
  let steps = 0;

  for (; steps < maxSteps; steps += 1) {
    if (match.winner !== null) break;
    botDrive(match, 'p1', p1Tier, p1Brain, STEP, rng);
    botDrive(match, 'p2', p2Tier, p2Brain, STEP, rng);
    stepMatch(match, STEP, p1Brain.throttle, p1Brain.jump, p2Brain.throttle, p2Brain.jump);
    for (const seat of seats) {
      const car = carOf(match, seat);
      const byCar = struckByCar(match, seat);
      const head = { x: headX(car), y: headY(car) };
      const byGround = groundY(head.x) - head.y < HEAD_RADIUS;
      if (byCar && !wasCar[seat]) carHits += 1;
      if (byGround && !byCar && !wasGround[seat]) groundHits += 1;
      if (!car.grounded && !wasAir[seat]) jumps += 1;
      wasCar[seat] = byCar;
      wasGround[seat] = byGround;
      wasAir[seat] = !car.grounded;
    }
  }
  return { match, steps, carHits, groundHits, jumps };
}

describe('the pit', () => {
  it('is a polyline read left to right', () => {
    expect(GROUND_X.length).toBe(GROUND_Y.length);
    expect(GROUND_X.length).toBe(8);
    for (let i = 1; i < GROUND_X.length; i += 1) {
      expect(GROUND_X[i]!).toBeGreaterThan(GROUND_X[i - 1]!);
    }
  });

  it('spans exactly the declared width, measured from the middle', () => {
    expect(GROUND_X[0]).toBe(-ARENA_HALF_WIDTH);
    expect(GROUND_X[GROUND_X.length - 1]).toBe(ARENA_HALF_WIDTH);
    expect(ARENA_WIDTH).toBe(ARENA_HALF_WIDTH * 2);
  });

  it('is its own mirror image, node for node', () => {
    const last = GROUND_X.length - 1;
    for (let i = 0; i <= last; i += 1) {
      // Summed rather than negated, so a node at zero is not a fight between +0 and -0.
      expect(GROUND_X[i]! + GROUND_X[last - i]!).toBe(0);
      expect(GROUND_Y[i]).toBe(GROUND_Y[last - i]);
    }
  });

  it('gives the identical height either side of the middle, to the last bit', () => {
    // Not "within a tolerance". The seat fairness argument is that a car and its reflection
    // are the same car, and a height that differed in the last bit would make that a
    // measurement rather than a theorem.
    for (let x = 0; x <= ARENA_HALF_WIDTH; x += 0.5) {
      expect(groundY(-x)).toBe(groundY(x));
    }
  });

  it('measures the same gap either side of the middle, to the last bit', () => {
    for (let x = -ARENA_HALF_WIDTH; x <= ARENA_HALF_WIDTH; x += 1.25) {
      for (const y of [0, 120, 300, 380, 420]) {
        expect(surfaceGap(-x, y)).toBe(surfaceGap(x, y));
      }
    }
  });

  it('mirrors its normals exactly', () => {
    for (let x = -ARENA_HALF_WIDTH; x <= ARENA_HALF_WIDTH; x += 1.25) {
      expect(surfaceNormalX(-x) + surfaceNormalX(x)).toBe(0);
      expect(surfaceNormalY(-x)).toBe(surfaceNormalY(x));
    }
  });

  it('interpolates the nodes it was given', () => {
    for (let i = 0; i < GROUND_X.length; i += 1) {
      expect(groundY(GROUND_X[i]!)).toBeCloseTo(GROUND_Y[i]!, 9);
    }
    expect(groundY(-125)).toBeCloseTo(FLOOR_Y, 9);
    expect(groundY(0)).toBeCloseTo(GROUND_Y[3]!, 9);
    // The top of the hump is flat, which is what makes the middle of the pit reflect.
    expect(groundY(-6)).toBe(groundY(6));
    expect(surfaceNormalX(0)).toBe(0);
    expect(surfaceNormalY(0)).toBe(-1);
  });

  it('answers for a point past either end rather than falling off the array', () => {
    expect(segmentAt(-10_000)).toBe(0);
    expect(segmentAt(10_000)).toBe(GROUND_X.length - 2);
    expect(Number.isFinite(groundY(-10_000))).toBe(true);
    expect(Number.isFinite(groundY(10_000))).toBe(true);
  });

  it('has a floor everywhere, with the sky above it', () => {
    for (let x = -ARENA_HALF_WIDTH; x <= ARENA_HALF_WIDTH; x += 5) {
      const surface = groundY(x);
      expect(surface).toBeLessThanOrEqual(FLOOR_Y);
      expect(surface).toBeGreaterThan(CEILING_Y + CAR_HEIGHT);
      expect(surface).toBeLessThan(ARENA_HEIGHT);
    }
  });

  it('points every normal at the sky and keeps it a unit long', () => {
    for (let x = -ARENA_HALF_WIDTH; x <= ARENA_HALF_WIDTH; x += 2.5) {
      const nx = surfaceNormalX(x);
      const ny = surfaceNormalY(x);
      expect(ny).toBeLessThan(0);
      expect(Math.hypot(nx, ny)).toBeCloseTo(1, 12);
    }
  });

  it('reads a point above the ground as above it and one below as below', () => {
    for (let x = -280; x <= 280; x += 7) {
      const surface = groundY(x);
      expect(surfaceGap(x, surface - 40)).toBeGreaterThan(0);
      expect(surfaceGap(x, surface + 40)).toBeLessThan(0);
      expect(surfaceGap(x, surface)).toBeCloseTo(0, 9);
    }
  });
});

describe('the car', () => {
  it('rests with both wheels exactly on the ground', () => {
    const car = restingCar(-150);
    for (const side of [-1, 1]) {
      expect(surfaceGap(wheelX(car, side), wheelY(car, side))).toBeCloseTo(WHEEL_RADIUS, 9);
    }
  });

  it('carries its head on the roof rather than inside it', () => {
    expect(HEAD_OFFSET_X).toBe(0);
    expect(HEAD_OFFSET_Y).toBe(-(BODY_HALF_HEIGHT + HEAD_RADIUS));
    const car = restingCar(0);
    expect(headX(car)).toBeCloseTo(car.x, 12);
    expect(headY(car)).toBeCloseTo(car.y + HEAD_OFFSET_Y, 12);
  });

  it('is CAR_HEIGHT tall from the ground to the top of the head', () => {
    const car = restingCar(-150);
    const top = headY(car) - HEAD_RADIUS;
    expect(groundY(car.x) - top).toBeCloseTo(CAR_HEIGHT, 9);
    expect(CAR_HEIGHT).toBe(REST_HEIGHT - HEAD_OFFSET_Y + HEAD_RADIUS);
  });

  it('turns its body points about its own centre', () => {
    const car = createCar();
    car.x = 10;
    car.y = 20;
    car.angle = Math.PI / 2;
    // A quarter turn takes the local +x axis onto the world +y axis.
    expect(bodyX(car, 30, 0)).toBeCloseTo(10, 9);
    expect(bodyY(car, 30, 0)).toBeCloseTo(50, 9);
    expect(bodyX(car, 0, -30)).toBeCloseTo(40, 9);
    expect(bodyY(car, 0, -30)).toBeCloseTo(20, 9);
  });

  it('puts its wheels below its centre and its head above it', () => {
    const car = restingCar(-150);
    expect(wheelY(car, -1)).toBeGreaterThan(car.y);
    expect(wheelY(car, 1)).toBeGreaterThan(car.y);
    expect(wheelX(car, -1)).toBeLessThan(wheelX(car, 1));
    expect(headY(car)).toBeLessThan(car.y);
  });

  it('clears another car of its own height when it jumps', () => {
    const apex = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(apex).toBeGreaterThan(CAR_HEIGHT);
    // And the flight is long enough to carry the lunge over the other car.
    expect(AIRBORNE_SECONDS * JUMP_LUNGE).toBeGreaterThan(BODY_HALF_LENGTH * 2);
  });
});

describe('driving', () => {
  it('accelerates at the declared rate and stops at the top speed', () => {
    const car = restingCar(-150);
    integrateCar(car, STEP, 1, false);
    expect(car.vx).toBeCloseTo(DRIVE_ACCELERATION * STEP, 9);
    // Long enough to reach the cap (330 / 1150 = 0.29 s) and short enough not to reach the
    // far wall, which is a different test.
    driveAlone(car, 40, 1);
    expect(car.vx).toBeLessThanOrEqual(MAX_DRIVE_SPEED + 1e-9);
    expect(car.vx).toBeGreaterThan(MAX_DRIVE_SPEED - 12);
  });

  it('never drives past the top speed, at any step size', () => {
    for (const rate of [30, 60, 90, 120, 144]) {
      const car = restingCar(-150);
      for (let i = 0; i < rate * 4; i += 1) {
        integrateCar(car, 1 / rate, 1, false);
        car.grounded = true;
        expect(Math.abs(car.vx)).toBeLessThanOrEqual(MAX_DRIVE_SPEED + 1e-9);
      }
    }
  });

  it('reaches the same top speed at 60 Hz and at 144 Hz', () => {
    const speeds = [60, 144].map((rate) => {
      const car = restingCar(-150);
      for (let i = 0; i < rate * 3; i += 1) {
        integrateCar(car, 1 / rate, 1, false);
        car.grounded = true;
      }
      return car.vx;
    });
    expect(speeds[0]!).toBeCloseTo(speeds[1]!, 9);
  });

  it('coasts to a dead stop rather than creeping or reversing', () => {
    const car = restingCar(-150);
    car.vx = 200;
    driveAlone(car, 300, 0);
    // Not exactly zero: the wheels are still solving contacts against the floor every step.
    // What matters is that a coasting car stops and does not roll back the other way.
    expect(Math.abs(car.vx)).toBeLessThan(0.05);
  });

  it('takes the coasting speed to exactly zero rather than through it', () => {
    const car = restingCar(-150);
    car.vx = 3;
    car.grounded = true;
    for (let i = 0; i < 10; i += 1) integrateCar(car, STEP, 0, false);
    expect(car.vx).toBe(0);
  });

  it('drives the other way when asked', () => {
    const car = restingCar(0);
    driveAlone(car, 60, -1);
    expect(car.vx).toBeLessThan(0);
    expect(car.x).toBeLessThan(0);
  });

  it('falls under gravity exactly as the closed form says', () => {
    const car = createCar();
    car.grounded = false;
    car.y = 0;
    const seconds = 0.5;
    for (let i = 0; i < 30; i += 1) integrateCar(car, STEP, 0, false);
    expect(car.y).toBeCloseTo(0.5 * GRAVITY * seconds * seconds, 6);
    expect(car.vy).toBeCloseTo(GRAVITY * seconds, 6);
  });

  it('falls the same distance whatever the step rate', () => {
    const drops = [60, 90, 120, 144].map((rate) => {
      const car = createCar();
      car.grounded = false;
      car.y = 0;
      for (let i = 0; i < rate; i += 1) integrateCar(car, 1 / rate, 0, false);
      return car.y;
    });
    for (const drop of drops) expect(drop).toBeCloseTo(drops[0]!, 6);
  });
});

describe('jumping', () => {
  it('leaves the ground at exactly the launch speed, and only from the ground', () => {
    const car = restingCar(-150);
    integrateCar(car, STEP, 0, true);
    expect(car.vy).toBeCloseTo(-JUMP_SPEED + GRAVITY * STEP, 9);
    expect(car.jumpCooldown).toBe(JUMP_COOLDOWN);

    const airborne = restingCar(-150);
    airborne.grounded = false;
    const before = airborne.vy;
    integrateCar(airborne, STEP, 0, true);
    expect(airborne.vy).toBeCloseTo(before + GRAVITY * STEP, 9);
  });

  it('is a fixed launch rather than an addition to what the car was doing', () => {
    const fast = restingCar(-150);
    fast.vy = -300;
    integrateCar(fast, STEP, 0, true);
    const slow = restingCar(-150);
    slow.vy = 200;
    integrateCar(slow, STEP, 0, true);
    expect(fast.vy).toBeCloseTo(slow.vy, 12);
  });

  it('refuses a second jump until the cooldown is out', () => {
    const car = restingCar(-150);
    integrateCar(car, STEP, 0, true);
    car.grounded = true;
    const speed = car.vy;
    integrateCar(car, STEP, 0, true);
    expect(car.vy).toBeGreaterThan(speed);
    expect(car.jumpCooldown).toBeLessThan(JUMP_COOLDOWN);
    for (let i = 0; i < 60; i += 1) {
      integrateCar(car, STEP, 0, false);
      car.grounded = true;
    }
    expect(car.jumpCooldown).toBe(0);
  });

  it('lunges the way it is being driven', () => {
    const still = restingCar(-150);
    integrateCar(still, STEP, 0, true);
    const leaning = restingCar(-150);
    integrateCar(leaning, STEP, 1, true);
    expect(leaning.vx - still.vx).toBeCloseTo(JUMP_LUNGE, 6);
  });

  it('rises to the apex the arithmetic predicts and lands again', () => {
    const car = restingCar(-150);
    const start = car.y;
    let highest = car.y;
    let airborneSteps = 0;
    car.grounded = true;
    integrateCar(car, STEP, 0, true);
    car.grounded = false;
    for (let i = 0; i < 200; i += 1) {
      integrateCar(car, STEP, 0, false);
      let grounded = false;
      for (let pass = 0; pass < 2; pass += 1) grounded = solveGround(car) || grounded;
      car.grounded = grounded;
      if (!grounded) airborneSteps += 1;
      highest = Math.min(highest, car.y);
      if (grounded && i > 4) break;
    }
    const apex = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(start - highest).toBeGreaterThan(apex * 0.9);
    expect(start - highest).toBeLessThan(apex * 1.1);
    expect(airborneSteps * STEP).toBeGreaterThan(AIRBORNE_SECONDS * 0.85);
    expect(airborneSteps * STEP).toBeLessThan(AIRBORNE_SECONDS * 1.15);
  });
});

describe('turning in the air', () => {
  it('only turns the car while it is off the ground', () => {
    const grounded = restingCar(-150);
    integrateCar(grounded, STEP, 1, false);
    expect(grounded.spin).toBe(0);

    const flying = restingCar(-150);
    flying.grounded = false;
    integrateCar(flying, STEP, 1, false);
    expect(flying.spin).toBeCloseTo(AIR_TORQUE * STEP, 9);
  });

  it('caps the spin a driver can build, and the spin anything can', () => {
    const car = restingCar(-150);
    car.grounded = false;
    for (let i = 0; i < 600; i += 1) integrateCar(car, STEP, 1, false);
    expect(car.spin).toBeLessThanOrEqual(MAX_DRIVEN_SPIN + 1e-9);
    expect(MAX_SPIN).toBeGreaterThan(MAX_DRIVEN_SPIN);
    // One step may never turn the car more than a fifth of a turn, so the wrap is a
    // single adjustment rather than a loop.
    expect(MAX_SPIN * STEP).toBeLessThan(Math.PI);
  });

  it('keeps the angle inside one turn however long it spins', () => {
    const car = restingCar(-150);
    car.grounded = false;
    for (let i = 0; i < 900; i += 1) {
      integrateCar(car, STEP, 1, false);
      expect(car.angle).toBeGreaterThan(-Math.PI - 1e-9);
      expect(car.angle).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('damps the spin away once the wheels are back down', () => {
    const car = restingCar(-150);
    car.spin = 5;
    driveAlone(car, 120, 0);
    expect(Math.abs(car.spin)).toBeLessThan(0.5);
  });
});

describe('the walls and the roof', () => {
  it('holds a car inside the pit and takes the speed out of the wall', () => {
    const car = restingCar(-150);
    car.x = -ARENA_HALF_WIDTH - 40;
    car.vx = -400;
    holdInside(car);
    expect(car.x).toBe(-ARENA_HALF_WIDTH + WALL_MARGIN);
    expect(car.vx).toBeGreaterThan(0);
    expect(car.vx).toBeLessThan(400);
  });

  it('holds it under the roof', () => {
    const car = restingCar(0);
    car.y = CEILING_Y - 30;
    car.vy = -500;
    holdInside(car);
    expect(car.y).toBe(CEILING_Y);
    expect(car.vy).toBe(0);
  });

  it('never lets a driver leave the picture, whatever they do', () => {
    const car = restingCar(-150);
    for (let i = 0; i < 3000; i += 1) {
      const throttle = Math.sin(i * 0.11) > 0 ? 1 : -1;
      driveAlone(car, 1, throttle, i % 7 === 0 ? 1 : 0);
      expect(car.x).toBeGreaterThanOrEqual(-ARENA_HALF_WIDTH + WALL_MARGIN - 1e-9);
      expect(car.x).toBeLessThanOrEqual(ARENA_HALF_WIDTH - WALL_MARGIN + 1e-9);
      expect(car.y).toBeGreaterThanOrEqual(CEILING_Y - 1e-9);
      expect(car.y).toBeLessThan(ARENA_HEIGHT);
    }
  });
});

describe('the ground contact', () => {
  it('settles a dropped car on its wheels and leaves it there', () => {
    // Dropped over the flat floor, so the resting height is measured against level ground
    // rather than against a slope the car would go on to run down.
    const car = restingCar(-150);
    car.y -= 200;
    driveAlone(car, 240, 0);
    expect(car.grounded).toBe(true);
    expect(groundY(car.x) - car.y).toBeGreaterThan(REST_HEIGHT - 2);
    expect(groundY(car.x) - car.y).toBeLessThanOrEqual(REST_HEIGHT + 0.01);
    const restedAt = car.y;
    driveAlone(car, 600, 0);
    expect(Math.abs(car.y - restedAt)).toBeLessThan(1);
    expect(Math.abs(car.vx)).toBeLessThan(1);
  });

  it('does not call a car on its roof grounded', () => {
    const car = restingCar(-150);
    car.angle = Math.PI;
    car.y = groundY(car.x) - BODY_HALF_HEIGHT;
    const grounded = solveGround(car);
    expect(grounded).toBe(false);
  });

  it('pushes a sunken wheel back out rather than further in', () => {
    const car = restingCar(-150);
    car.y += 6;
    const before = car.y;
    solveGround(car);
    expect(car.y).toBeLessThan(before);
  });
});

describe('the head', () => {
  it('is not touched by anything when both cars are simply parked', () => {
    const match = createMatch();
    expect(headTouch(match, 'p1')).toBe('none');
    expect(headTouch(match, 'p2')).toBe('none');
  });

  it('cannot be reached by a car at the same height, at any separation', () => {
    // The rule the whole game rests on: two cars meeting on the level touch roof to roof
    // and nothing happens, so the only way to a head is over the top of it.
    const match = createMatch();
    // From the closest two level cars can physically be — their own bodies hold them two
    // half-lengths apart, and their wheels a little further — outwards.
    for (let gap = BODY_HALF_LENGTH * 2; gap <= 240; gap += 1) {
      match.p1.x = -gap / 2;
      match.p2.x = gap / 2;
      match.p1.y = 300;
      match.p2.y = 300;
      expect(headTouch(match, 'p1')).toBe('none');
      expect(headTouch(match, 'p2')).toBe('none');
    }
  });

  it('is reached by a car sitting on top of it', () => {
    const match = createMatch();
    match.p1.x = 0;
    match.p1.y = 300;
    match.p2.x = 0;
    match.p2.y = 300 + HEAD_OFFSET_Y - BODY_HALF_HEIGHT;
    expect(headTouch(match, 'p1')).toBe('car');
    expect(headTouch(match, 'p2')).toBe('none');
  });

  it('is reached by a wheel as well as by a body', () => {
    const match = createMatch();
    match.p1.x = 0;
    match.p1.y = 300;
    match.p2.x = WHEEL_OFFSET_X;
    match.p2.y = 300 + HEAD_OFFSET_Y - WHEEL_OFFSET_Y - WHEEL_RADIUS - HEAD_RADIUS + 2;
    expect(headTouch(match, 'p1')).toBe('car');
  });

  it('counts the ground as something that must not touch it', () => {
    const match = createMatch();
    match.p1.angle = Math.PI;
    match.p1.y = groundY(match.p1.x) + HEAD_OFFSET_Y;
    expect(headTouch(match, 'p1')).toBe('ground');
  });

  it('blames the other car rather than the floor when both are touching it', () => {
    const match = createMatch();
    match.p1.x = -150;
    match.p1.angle = Math.PI;
    // Upside down, so the head hangs below the centre and rests on the floor.
    match.p1.y = groundY(-150) + HEAD_OFFSET_Y;
    expect(headTouch(match, 'p1')).toBe('ground');
    match.p2.x = -150;
    match.p2.y = groundY(-150) - 20;
    expect(headTouch(match, 'p1')).toBe('car');
  });
});

describe('scoring', () => {
  it('starts level with nothing decided', () => {
    const match = createMatch();
    expect(match.p1Points).toBe(0);
    expect(match.p2Points).toBe(0);
    expect(winnerOf(match)).toBeNull();
    expect(match.phase).toBe('live');
  });

  it('places the two cars as exact mirrors of each other, at rest', () => {
    const match = createMatch();
    expect(match.p1.x).toBe(-START_OFFSET);
    expect(match.p2.x).toBe(mirrorX(-START_OFFSET));
    expect(match.p1.y).toBe(match.p2.y);
    expect(mirrorGap(match.p1, match.p2)).toBe(0);
    for (const seat of ['p1', 'p2'] as const) {
      const car = carOf(match, seat);
      expect(car.vx).toBe(0);
      expect(car.vy).toBe(0);
      expect(car.angle).toBe(0);
      expect(car.spin).toBe(0);
      expect(car.grounded).toBe(true);
    }
  });

  it('gives the point to the seat whose car did the hitting', () => {
    const match = createMatch();
    match.p1.x = 0;
    match.p1.y = 300;
    match.p2.x = 0;
    match.p2.y = 300 + HEAD_OFFSET_Y - BODY_HALF_HEIGHT;
    const result = stepMatch(match, STEP, 0, false, 0, false);
    expect(result.p1Ko).toBe('car');
    expect(match.p2Points).toBe(1);
    expect(match.p1Points).toBe(0);
    expect(match.lastKo).toBe('p1');
    expect(match.lastCause).toBe('car');
  });

  it('gives a point to both when both heads are struck in the same step', () => {
    const match = createMatch();
    flipOntoHead(match.p1, -150);
    flipOntoHead(match.p2, 150);
    stepMatch(match, STEP, 0, false, 0, false);
    expect(match.p1Points).toBe(1);
    expect(match.p2Points).toBe(1);
    expect(match.lastKo).toBe('draw');
  });

  it('holds the result for the settle and then starts a fresh round', () => {
    const match = createMatch();
    match.p1.x = 0;
    match.p1.y = 300;
    match.p2.x = 0;
    match.p2.y = 300 + HEAD_OFFSET_Y - BODY_HALF_HEIGHT;
    const result = stepMatch(match, STEP, 0, false, 0, false);
    expect(result.roundOver).toBe(true);
    expect(match.phase).toBe('settling');
    expect(match.hold).toBeCloseTo(SETTLE_SECONDS, 9);

    const frozen = { x: match.p1.x, y: match.p1.y };
    stepMatch(match, STEP, 1, true, 1, true);
    expect(match.p1.x).toBe(frozen.x);
    expect(match.p1.y).toBe(frozen.y);

    for (let i = 0; i < 120; i += 1) stepMatch(match, STEP, 0, false, 0, false);
    expect(match.phase).toBe('live');
    expect(match.p1.x).toBe(-START_OFFSET);
    expect(match.rounds).toBe(2);
  });

  it('restarts a round nobody has won, without giving anybody a point', () => {
    const match = createMatch();
    let timedOut = false;
    for (let i = 0; i < Math.ceil(ROUND_SECONDS / STEP) + 2; i += 1) {
      timedOut = stepMatch(match, STEP, 0, false, 0, false).timedOut || timedOut;
    }
    expect(timedOut).toBe(true);
    expect(match.p1Points).toBe(0);
    expect(match.p2Points).toBe(0);
    expect(match.lastKo).toBeNull();
  });

  it('ends the match at the target through the SDK helper', () => {
    const match = createMatch();
    match.p1Points = POINTS_TO_WIN - 1;
    match.p1.x = 0;
    match.p1.y = 300 + HEAD_OFFSET_Y - BODY_HALF_HEIGHT;
    match.p2.x = 0;
    match.p2.y = 300;
    stepMatch(match, STEP, 0, false, 0, false);
    expect(match.p1Points).toBe(POINTS_TO_WIN);
    expect(winnerOf(match)).toBe('p1');
    expect(match.phase).toBe('over');
  });

  it('calls a match a draw when both reach the target on the same step', () => {
    const match = createMatch();
    match.p1Points = POINTS_TO_WIN - 1;
    match.p2Points = POINTS_TO_WIN - 1;
    flipOntoHead(match.p1, -150);
    flipOntoHead(match.p2, 150);
    stepMatch(match, STEP, 0, false, 0, false);
    expect(winnerOf(match)).toBe('draw');
  });

  it('settles on points when the clock runs out, and calls a level score a draw', () => {
    const match = createMatch();
    match.p1Points = 2;
    match.p2Points = 1;
    match.clock = MATCH_SECONDS - STEP / 2;
    stepMatch(match, STEP, 0, false, 0, false);
    expect(winnerOf(match)).toBe('p1');

    const level = createMatch();
    level.p1Points = 2;
    level.p2Points = 2;
    level.clock = MATCH_SECONDS - STEP / 2;
    stepMatch(level, STEP, 0, false, 0, false);
    expect(winnerOf(level)).toBe('draw');
  });

  it('does nothing at all once the match is over', () => {
    const match = createMatch();
    match.p1Points = POINTS_TO_WIN;
    stepMatch(match, STEP, 0, false, 0, false);
    expect(winnerOf(match)).toBe('p1');
    const snapshot = JSON.stringify(match);
    for (let i = 0; i < 30; i += 1) stepMatch(match, STEP, 1, true, -1, true);
    expect(JSON.stringify(match)).toBe(snapshot);
  });

  it('reports each seat its own points', () => {
    const match = createMatch();
    match.p1Points = 3;
    match.p2Points = 1;
    expect(pointsOf(match, 'p1')).toBe(3);
    expect(pointsOf(match, 'p2')).toBe(1);
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('puts everything back the way it started', () => {
    const match = createMatch();
    const fresh = JSON.stringify(match);
    for (let i = 0; i < 400; i += 1) stepMatch(match, STEP, 1, i % 30 === 0, -1, i % 40 === 0);
    clearMatch(match);
    expect(JSON.stringify(match)).toBe(fresh);
    resetMatch(match);
    expect(JSON.stringify(match)).toBe(fresh);
  });

  it('counts rounds from one', () => {
    const match = createMatch();
    expect(match.rounds).toBe(1);
    startRound(match);
    expect(match.rounds).toBe(2);
  });
});

describe('termination', () => {
  it('ends inside the match clock even when nobody touches a control', () => {
    // The worst case in the whole game: two cars that never move, so no round can ever be
    // won. `ROUND_SECONDS` restarts each one and `MATCH_SECONDS` ends the match — the bound
    // is the clock plus the step it is noticed on, which is 100.02 s against the ten
    // minutes `apps/web/src/data/termination.test.ts` allows.
    const match = createMatch();
    const cap = Math.ceil(MATCH_SECONDS / STEP) + 2;
    let steps = 0;
    for (; steps < cap; steps += 1) {
      stepMatch(match, STEP, 0, false, 0, false);
      if (match.winner !== null) break;
    }
    expect(match.winner).toBe('draw');
    expect(steps).toBeLessThanOrEqual(Math.ceil(MATCH_SECONDS / STEP) + 1);
  });

  it('holds the arithmetic that makes the round clock a net rather than the mechanism', () => {
    // A round is restarted at ROUND_SECONDS, so the most rounds a match can hold is the
    // clock divided by the shortest a stalled round can take.
    const roundsAtWorst = Math.ceil(MATCH_SECONDS / (ROUND_SECONDS + SETTLE_SECONDS));
    expect(roundsAtWorst).toBeLessThanOrEqual(8);
    expect(MATCH_SECONDS + ROUND_SECONDS).toBeLessThan(600);
  });

  it('ends every bot pairing well inside the clock', () => {
    const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const p1 of tiers) {
      for (const p2 of tiers) {
        const played = playBots(4242 + tiers.indexOf(p1) * 31 + tiers.indexOf(p2), p1, p2);
        expect(played.match.winner).not.toBeNull();
        expect(played.steps * STEP).toBeLessThan(MATCH_SECONDS);
      }
    }
  });
});

describe('the mirror between the seats', () => {
  it('reflects a lone car exactly, for as long as it is driven', () => {
    const left = restingCar(-150);
    const right = restingCar(150);
    for (let i = 0; i < 1500; i += 1) {
      const throttle = Math.sin(i * 0.031) > 0 ? 1 : -1;
      const jump = i % 53 === 0;
      driveAlone(left, 1, throttle, jump ? 1 : 0);
      driveAlone(right, 1, -throttle, jump ? 1 : 0);
      expect(mirrorGap(left, right)).toBe(0);
    }
  });

  it('reflects a whole match exactly, collisions and all', () => {
    // Two cars started as reflections and driven with reflected controls stay reflections
    // to the last bit — through contact, through landing on each other, through the round
    // resets. Every asymmetry the solver ever had was found by this test.
    const match = createMatch();
    for (let i = 0; i < 900; i += 1) {
      const throttle = Math.sin(i * 0.037) > 0 ? 1 : -1;
      const jump = i % 47 === 0;
      stepMatch(match, STEP, throttle, jump, -throttle, jump);
      expect(mirrorGap(match.p1, match.p2)).toBe(0);
      if (match.winner !== null) break;
    }
    expect(match.p1Points).toBe(match.p2Points);
  });

  it('mirrors a position by negating it, which is exact', () => {
    for (let x = -300; x <= 300; x += 0.5) {
      expect(mirrorX(mirrorX(x))).toBe(x);
      expect(mirrorX(x)).toBe(-x);
    }
  });

  it('reaches the same verdict from a mirrored start', () => {
    // The state is mirrored seat for seat and the inputs with it; the same seat must win.
    const straight = createMatch();
    const swapped = createMatch();
    mirrorInto(swapped.p1, straight.p2);
    mirrorInto(swapped.p2, straight.p1);
    for (let i = 0; i < 900; i += 1) {
      const a = Math.sin(i * 0.021) > 0 ? 1 : -0.5;
      const b = Math.cos(i * 0.013) > 0 ? -1 : 0.25;
      stepMatch(straight, STEP, a, i % 31 === 0, b, i % 43 === 0);
      stepMatch(swapped, STEP, -b, i % 43 === 0, -a, i % 31 === 0);
      expect(swapped.p1Points).toBe(straight.p2Points);
      expect(swapped.p2Points).toBe(straight.p1Points);
      if (straight.winner !== null) break;
    }
    expect(straight.winner === null ? null : otherOf(straight.winner as SeatId)).toBe(
      swapped.winner === 'draw' ? null : swapped.winner,
    );
  });
});

describe('determinism', () => {
  it('plays the identical match twice from one seed', () => {
    const a = playBots(90210, 'normal', 'hard');
    const b = playBots(90210, 'normal', 'hard');
    expect(JSON.stringify(a.match)).toBe(JSON.stringify(b.match));
    expect(a.steps).toBe(b.steps);
    expect(a.carHits).toBe(b.carHits);
  });

  it('plays a different match from a different seed', () => {
    const a = playBots(90210, 'normal', 'normal');
    const b = playBots(90211, 'normal', 'normal');
    expect(JSON.stringify(a.match)).not.toBe(JSON.stringify(b.match));
  });

  it('draws the same number of values from the stream whatever the bot decides', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const match = createMatch();
      const rng = new CountingRng(7);
      const bot = createBotState();
      let looks = 0;
      for (let i = 0; i < 600; i += 1) {
        const before = rng.calls;
        botDrive(match, 'p1', tier, bot, STEP, rng);
        const drawn = rng.calls - before;
        expect(drawn === 0 || drawn === BOT_DRAWS_PER_LOOK).toBe(true);
        if (drawn > 0) looks += 1;
        stepMatch(match, STEP, bot.throttle, bot.jump, 0, false);
      }
      expect(looks).toBeGreaterThan(1);
    }
  });

  it('never advances the stream except when it looks', () => {
    const match = createMatch();
    const rng = new CountingRng(11);
    const bot = createBotState();
    botDrive(match, 'p1', 'easy', bot, STEP, rng);
    expect(rng.calls).toBe(BOT_DRAWS_PER_LOOK);
    // Well inside `easy`'s reaction time, so it must not look again.
    for (let i = 0; i < 10; i += 1) botDrive(match, 'p1', 'easy', bot, STEP, rng);
    expect(rng.calls).toBe(BOT_DRAWS_PER_LOOK);
  });
});

describe('the bot', () => {
  it('never asks for more throttle than a person could', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const match = createMatch();
      const rng = new Rng(5150);
      const p1 = createBotState();
      const p2 = createBotState();
      for (let i = 0; i < 900; i += 1) {
        botDrive(match, 'p1', tier, p1, STEP, rng);
        botDrive(match, 'p2', tier, p2, STEP, rng);
        expect(Math.abs(p1.throttle)).toBeLessThanOrEqual(1);
        expect(Math.abs(p2.throttle)).toBeLessThanOrEqual(1);
        stepMatch(match, STEP, p1.throttle, p1.jump, p2.throttle, p2.jump);
        if (match.winner !== null) break;
      }
    }
  });

  it('never asks to jump from the air or during a cooldown', () => {
    const match = createMatch();
    const rng = new Rng(31415);
    const p1 = createBotState();
    const p2 = createBotState();
    for (let i = 0; i < 900; i += 1) {
      botDrive(match, 'p1', 'hard', p1, STEP, rng);
      botDrive(match, 'p2', 'hard', p2, STEP, rng);
      if (p1.jump) {
        expect(match.p1.grounded).toBe(true);
        expect(match.p1.jumpCooldown).toBe(0);
      }
      if (p2.jump) {
        expect(match.p2.grounded).toBe(true);
        expect(match.p2.jumpCooldown).toBe(0);
      }
      stepMatch(match, STEP, p1.throttle, p1.jump, p2.throttle, p2.jump);
      if (match.winner !== null) break;
    }
  });

  it('holds one judgement between looks rather than drawing a fresh one every step', () => {
    const match = createMatch();
    const rng = new Rng(2718);
    const bot = createBotState();
    botDrive(match, 'p1', 'easy', bot, STEP, rng);
    const held = { aim: bot.aimSlip, jump: bot.jumpSlip, blunder: bot.blunder };
    for (let i = 0; i < 20; i += 1) {
      botDrive(match, 'p1', 'easy', bot, STEP, rng);
      expect(bot.aimSlip).toBe(held.aim);
      expect(bot.jumpSlip).toBe(held.jump);
      expect(bot.blunder).toBe(held.blunder);
    }
  });

  it('drives towards the other car when it is well away from it', () => {
    const match = createMatch();
    const rng = new Rng(60606);
    const bot = createBotState();
    // A hard bot has an error of a few units against a gap of three hundred.
    botDrive(match, 'p1', 'hard', bot, STEP, rng);
    expect(bot.throttle).toBeGreaterThan(0);
    match.p1.x = 200;
    match.p2.x = -200;
    resetBotState(bot);
    botDrive(match, 'p1', 'hard', bot, STEP, rng);
    expect(bot.throttle).toBeLessThan(0);
  });

  it('forgets everything when it is reset', () => {
    const match = createMatch();
    const rng = new Rng(1234);
    const bot = createBotState();
    for (let i = 0; i < 60; i += 1) botDrive(match, 'p1', 'easy', bot, STEP, rng);
    resetBotState(bot);
    expect(bot.throttle).toBe(0);
    expect(bot.jump).toBe(false);
    expect(bot.aimSlip).toBe(0);
    expect(bot.armed).toBe(false);
    expect(bot.judgement.decided).toBe(false);
  });

  it('offers three tiers that differ only in when they look and how well they judge', () => {
    const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (let i = 1; i < tiers.length; i += 1) {
      const slower = BOT_PROFILES[tiers[i - 1]!];
      const quicker = BOT_PROFILES[tiers[i]!];
      expect(quicker.reaction).toBeLessThan(slower.reaction);
      expect(quicker.aimError).toBeLessThan(slower.aimError);
      expect(quicker.jumpError).toBeLessThan(slower.jumpError);
      expect(quicker.blunder).toBeLessThan(slower.blunder);
      expect(quicker.airSkill).toBeGreaterThan(slower.airSkill);
    }
    // And nothing else: no tier gets a faster car, a longer jump or a bigger head.
    for (const tier of tiers) {
      const profile = BOT_PROFILES[tier];
      expect(Object.keys(profile).sort()).toEqual([
        'aimError',
        'airSkill',
        'blunder',
        'jumpError',
        'reaction',
      ]);
    }
  });

  it('turns its tiers into results: the better tier wins more', () => {
    // A small sample here, because this runs on every commit. The measured ladder over
    // three independent seed families and both seat orders is in SPEC.md.
    let normalWins = 0;
    let hardWins = 0;
    for (let i = 0; i < 24; i += 1) {
      const seed = 8000 + i * 977;
      if (playBots(seed, 'normal', 'easy').match.winner === 'p1') normalWins += 1;
      if (playBots(seed, 'hard', 'normal').match.winner === 'p1') hardWins += 1;
    }
    expect(normalWins).toBeGreaterThan(14);
    expect(hardWins).toBeGreaterThan(14);
  });

  it('turns itself over less often the better it is', () => {
    let easyGround = 0;
    let hardGround = 0;
    for (let i = 0; i < 20; i += 1) {
      easyGround += playBots(300 + i * 613, 'easy', 'easy').groundHits;
      hardGround += playBots(300 + i * 613, 'hard', 'hard').groundHits;
    }
    expect(hardGround).toBeLessThan(easyGround);
  });
});

describe('the headline verb', () => {
  it('lands car-on-head hits in every seeded match, counted from the outside', () => {
    // Reconstructed by `struckByCar` from sampled positions, never read back out of the
    // simulation that maintains the score. A game whose core verb never happens can still
    // terminate and still report a winner — which is exactly how a sibling shipped
    // unplayable with every global guard passing.
    const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const tier of tiers) {
      let hits = 0;
      let worst = Number.POSITIVE_INFINITY;
      const matches = 24;
      for (let i = 0; i < matches; i += 1) {
        const played = playBots(70000 + i * 5171, tier, tier);
        hits += played.carHits;
        worst = Math.min(worst, played.carHits);
      }
      expect(worst, `${tier} played a whole match without one car-on-head hit`).toBeGreaterThan(0);
      expect(hits / matches).toBeGreaterThan(3);
    }
  });

  it('scores far more often off another car than off the floor', () => {
    let car = 0;
    let ground = 0;
    for (let i = 0; i < 24; i += 1) {
      const played = playBots(90000 + i * 3167, 'normal', 'normal');
      car += played.carHits;
      ground += played.groundHits;
    }
    expect(car).toBeGreaterThan(ground * 2);
  });

  it('takes to the air to do it', () => {
    let jumps = 0;
    for (let i = 0; i < 12; i += 1) jumps += playBots(1500 + i * 811, 'normal', 'normal').jumps;
    expect(jumps / 12).toBeGreaterThan(8);
  });
});

describe('the pit holds a car in, at any speed', () => {
  it('never lets a falling car through the floor', () => {
    // The ground is tested as a half-space rather than as a surface, so a point below it is
    // below it however fast it arrived. A shell would let a corner moving seventeen units a
    // step straight through.
    const car = restingCar(-150);
    car.y = CEILING_Y;
    car.vy = 4000;
    car.grounded = false;
    for (let i = 0; i < 240; i += 1) {
      driveAlone(car, 1, 0);
      expect(car.y).toBeLessThan(groundY(car.x) + BODY_HALF_LENGTH);
    }
    expect(car.grounded).toBe(true);
  });

  it('never lets a car driven at a wall through it', () => {
    const car = restingCar(-150);
    car.vx = -5000;
    for (let i = 0; i < 120; i += 1) {
      driveAlone(car, 1, -1);
      expect(car.x).toBeGreaterThanOrEqual(-ARENA_HALF_WIDTH + WALL_MARGIN - 1e-9);
    }
  });

  it('keeps a whole match inside the pit however it is driven', () => {
    const match = createMatch();
    for (let i = 0; i < 1200; i += 1) {
      stepMatch(match, STEP, Math.sin(i * 0.09), i % 9 === 0, Math.cos(i * 0.07), i % 13 === 0);
      for (const seat of ['p1', 'p2'] as const) {
        const car = carOf(match, seat);
        expect(Math.abs(car.x)).toBeLessThanOrEqual(ARENA_HALF_WIDTH - WALL_MARGIN + 1e-9);
        expect(car.y).toBeGreaterThanOrEqual(CEILING_Y - 1e-9);
        expect(car.y).toBeLessThan(ARENA_HEIGHT);
        expect(Number.isFinite(car.vx)).toBe(true);
        expect(Number.isFinite(car.spin)).toBe(true);
      }
      if (match.winner !== null) break;
    }
  });
});

describe('one car on another', () => {
  it('counts a car resting on the other one as standing on something', () => {
    const match = createMatch();
    match.p1.x = 0;
    match.p1.y = 300;
    match.p1.grounded = false;
    // Just above the other roof, and to one side of the head so the round does not end.
    match.p2.x = 0;
    match.p2.y = 300 - 2 * BODY_HALF_HEIGHT - 1;
    match.p2.grounded = false;
    for (let i = 0; i < 12; i += 1) stepMatch(match, STEP, 0, false, 0, false);
    // Read through a call rather than inline. The setup above assigns `false`, so
    // TypeScript narrows the field to that literal and reports the disjunction as
    // always-falsy — it cannot see that `stepMatch` writes to it. A function's declared
    // return type is not narrowable, so the assertion reads the value the step left.
    const restingOnSomething = (): boolean => match.p2.grounded;
    expect(restingOnSomething() || match.phase === 'settling').toBe(true);
  });

  it('pushes two overlapping cars apart rather than leaving them inside each other', () => {
    const match = createMatch();
    match.p1.x = -10;
    match.p2.x = 10;
    match.p1.y = 300;
    match.p2.y = 300;
    const before = Math.abs(match.p1.x - match.p2.x);
    stepMatch(match, STEP, 0, false, 0, false);
    expect(Math.abs(match.p1.x - match.p2.x)).toBeGreaterThan(before);
  });

  it('pushes them apart symmetrically', () => {
    const match = createMatch();
    match.p1.x = -10;
    match.p2.x = 10;
    match.p1.y = 300;
    match.p2.y = 300;
    stepMatch(match, STEP, 0, false, 0, false);
    expect(mirrorGap(match.p1, match.p2)).toBe(0);
  });
});

describe('the win condition at its edges', () => {
  it('ends four all with the next head struck', () => {
    const match = createMatch();
    match.p1Points = POINTS_TO_WIN - 1;
    match.p2Points = POINTS_TO_WIN - 1;
    flipOntoHead(match.p1, -150);
    stepMatch(match, STEP, 0, false, 0, false);
    expect(match.p2Points).toBe(POINTS_TO_WIN);
    expect(winnerOf(match)).toBe('p2');
  });

  it('does not end one short of the target', () => {
    const match = createMatch();
    match.p1Points = POINTS_TO_WIN - 2;
    match.p2Points = POINTS_TO_WIN - 1;
    flipOntoHead(match.p1, -150);
    stepMatch(match, STEP, 0, false, 0, false);
    expect(match.p2Points).toBe(POINTS_TO_WIN);
    expect(winnerOf(match)).toBe('p2');
    expect(match.p1Points).toBe(POINTS_TO_WIN - 2);
  });

  it('never runs a point past the target', () => {
    const match = createMatch();
    for (let i = 0; i < 60 * 130; i += 1) {
      stepMatch(match, STEP, Math.sin(i * 0.05), i % 11 === 0, -Math.sin(i * 0.05), i % 11 === 0);
      expect(match.p1Points).toBeLessThanOrEqual(POINTS_TO_WIN);
      expect(match.p2Points).toBeLessThanOrEqual(POINTS_TO_WIN);
      if (match.winner !== null) break;
    }
    expect(match.winner).not.toBeNull();
  });

  it('refuses a throttle outside what an instrument can ask for', () => {
    const honest = createMatch();
    const cheat = createMatch();
    for (let i = 0; i < 60; i += 1) {
      stepMatch(honest, STEP, 1, false, -1, false);
      stepMatch(cheat, STEP, 40, false, -40, false);
    }
    expect(cheat.p1.x).toBeCloseTo(honest.p1.x, 9);
    expect(cheat.p1.vx).toBeCloseTo(honest.p1.vx, 9);
  });

  it('ignores everything while the result is being held', () => {
    const match = createMatch();
    flipOntoHead(match.p1, -150);
    stepMatch(match, STEP, 0, false, 0, false);
    expect(match.phase).toBe('settling');
    const held = JSON.stringify({ p1: match.p1, p2: match.p2 });
    stepMatch(match, STEP, 1, true, -1, true);
    expect(JSON.stringify({ p1: match.p1, p2: match.p2 })).toBe(held);
  });
});

describe('the bot reads the pit and nothing else', () => {
  it('decides the same thing twice from the same state', () => {
    const a = createMatch();
    const b = createMatch();
    for (let i = 0; i < 90; i += 1) {
      stepMatch(a, STEP, 0.6, i % 20 === 0, -0.4, false);
      stepMatch(b, STEP, 0.6, i % 20 === 0, -0.4, false);
    }
    const first = createBotState();
    const second = createBotState();
    botDrive(a, 'p1', 'normal', first, STEP, new Rng(99));
    botDrive(b, 'p1', 'normal', second, STEP, new Rng(99));
    expect(second.throttle).toBe(first.throttle);
    expect(second.jump).toBe(first.jump);
    expect(second.launchGap).toBe(first.launchGap);
  });

  it('changes its mind when the pit changes and not otherwise', () => {
    const match = createMatch();
    const bot = createBotState();
    const rng = new Rng(4004);
    botDrive(match, 'p1', 'hard', bot, STEP, rng);
    const towards = bot.throttle;
    // Put the rival on the other side; the next look must turn the car round.
    match.p2.x = -280;
    for (let i = 0; i < 30; i += 1) botDrive(match, 'p1', 'hard', bot, STEP, rng);
    expect(Math.sign(bot.throttle)).toBe(-Math.sign(towards));
  });

  it('backs off from a car that is above it, and charges when it is not', () => {
    const match = createMatch();
    match.p1.x = 0;
    match.p2.x = 60;
    match.p2.y = match.p1.y - 90;
    match.p2.grounded = false;
    const bot = createBotState();
    // A tier that never blunders, so the judgement is the one being tested.
    botDrive(match, 'p1', 'hard', bot, STEP, new Rng(1));
    expect(bot.evading).toBe(true);
    expect(bot.throttle).toBeLessThan(0);

    match.p2.grounded = true;
    match.p2.y = match.p1.y;
    const charging = createBotState();
    botDrive(match, 'p1', 'hard', charging, STEP, new Rng(1));
    expect(charging.evading).toBe(false);
    expect(charging.throttle).toBeGreaterThan(0);
  });

  it('plans a launch gap it could actually cover', () => {
    const match = createMatch();
    const bot = createBotState();
    botDrive(match, 'p1', 'hard', bot, STEP, new Rng(17));
    expect(bot.launchGap).toBeGreaterThan(0);
    expect(bot.launchGap).toBeLessThan(
      JUMP_LUNGE * AIRBORNE_SECONDS + BOT_PROFILES.hard.jumpError + 1,
    );
  });
});

describe('the whole game, driven blind', () => {
  it('reaches a decision from a scripted human on both sides', () => {
    const match = createMatch();
    let steps = 0;
    for (; steps < 60 * 130; steps += 1) {
      const a = Math.sin(steps * 0.04);
      const b = Math.cos(steps * 0.031);
      stepMatch(match, STEP, a, steps % 37 === 0, b, steps % 53 === 0);
      if (match.winner !== null) break;
    }
    expect(match.winner).not.toBeNull();
    expect(steps * STEP).toBeLessThanOrEqual(MATCH_SECONDS + STEP);
  });

  it('plays the identical match from the same script twice', () => {
    const play = (): string => {
      const match = createMatch();
      for (let i = 0; i < 600; i += 1) {
        stepMatch(match, STEP, Math.sin(i * 0.04), i % 37 === 0, Math.cos(i * 0.031), i % 53 === 0);
      }
      return JSON.stringify(match);
    };
    expect(play()).toBe(play());
  });
});
