import { circleCircle, circleObb, createContact } from '@duelbox/engine';
import type { Circle, Contact, Obb, Rng, SeatId } from '@duelbox/engine';
import {
  commit,
  createJudgement,
  misjudgement,
  resetJudgement,
  resolve,
  shouldDecide,
} from '@duelbox/game-sdk';
import type { Judgement, WinCondition } from '@duelbox/game-sdk';

/**
 * Crash It, as pure rules.
 *
 * Two cars in one pit, each with a driver whose head sticks out of the roof. Touch the
 * other head with any part of your car and you score; let anything touch yours and they
 * do. Drive, jump, and turn yourself over in the air — the last of those is the one that
 * can lose you a point on its own, because a car on its roof is a head on the floor.
 *
 * ## One arena, not two
 *
 * Unlike the other three `rt-race` games in the catalogue this is not a window each on a
 * shared track: it is a single pit, and both seats are inside it at once. That makes the
 * fairness question sharper rather than softer, and it is answered the way Robot Arena
 * answers it — by symmetry rather than by tuning. The ground profile satisfies
 * `groundY(x) === groundY(-x)` for every x — to the bit, not to a tolerance — and the two
 * cars start at mirrored places at rest. Whatever one driver can do, the other can do
 * reflected, at the same instant, with the same numbers. `rules.test.ts` mirrors a whole
 * match and asserts every state variable of the two cars stays exactly equal and opposite.
 *
 * The mirror is broken only where it must be — by the seeded stream the two bots share,
 * one draw at a time — because two perfectly mirrored bots would otherwise play the same
 * round for ever. That is Robot Arena's measured lesson, taken rather than rediscovered.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and every duration is
 * seconds of simulation.
 */

/* ------------------------------------------------------------------ the pit */

/**
 * The pit is as wide as the logical box and as deep as one seat's band leaves room for.
 *
 * **Measured from the middle, not from a corner**, so a car at x and its reflection at −x
 * are the same distances written with the opposite sign. That is not tidiness: negation is
 * exact in binary floating point and subtraction from 600 is not, so a pit numbered 0…600
 * makes two mirrored cars differ in the last bits of every wheel position, and the two
 * disagree the first time one of those bits decides whether a contact happened at all.
 * Measured on the 0…600 version: two mirrored cars driven with mirrored controls diverged
 * at step 231 of 900 and ended the run 614 units apart. Centred on zero the same run holds
 * every state variable exactly equal to the last bit, for as long as it is driven.
 */
export const ARENA_HALF_WIDTH = 300;
export const ARENA_WIDTH = ARENA_HALF_WIDTH * 2;
export const ARENA_HEIGHT = 430;

/**
 * The ground, as a polyline read left to right.
 *
 * Mirror-symmetric about zero, which is the whole of the fairness argument: a flat floor
 * with a low hump in the middle to launch off, and both ends curling up into the walls so a
 * car driven into a corner is turned back rather than parked in it. `rules.test.ts` checks
 * the symmetry point by point rather than trusting the table.
 *
 * **The hump has a flat twelve units on top of it and that is not decoration.** A peak is a
 * single point where two faces meet, and a point has to be given to one face or the other —
 * so a car standing exactly on the middle of the pit would read the right-hand slope's
 * normal and its reflection would read the same one, which is the one place in the whole
 * geometry where reflecting a car does not reflect what it is standing on. A flat top is
 * its own mirror image, so there is no such place.
 */
export const GROUND_X: readonly number[] = [-300, -190, -60, -6, 6, 60, 190, 300];
export const GROUND_Y: readonly number[] = [300, 400, 400, 376, 376, 400, 400, 300];

/** The floor either side of the hump, and the one height the cars start on. */
export const FLOOR_Y = 400;

/** A car may not leave the picture: the walls hold its centre, the roof holds its top. */
export const WALL_MARGIN = 26;
export const CEILING_Y = 46;
export const WALL_BOUNCE = 0.4;

/* ------------------------------------------------------------------- the car */

export const BODY_HALF_LENGTH = 34;
export const BODY_HALF_HEIGHT = 16;
export const WHEEL_OFFSET_X = 22;
export const WHEEL_OFFSET_Y = 14;
export const WHEEL_RADIUS = 13;

/**
 * The head, and the one reason it is exactly here.
 *
 * `HEAD_OFFSET_Y` is `-(BODY_HALF_HEIGHT + HEAD_RADIUS)`, so the head sits *on* the roof
 * rather than inside it. That is what makes the observed rule true: two cars meeting on
 * level ground touch roof to roof and nothing happens, so the only way to reach a head is
 * to get above it. A head sunk into the body would have made a flat-out ram score, and the
 * jump — the middle verb of the three the rule names — would have been decoration.
 */
export const HEAD_RADIUS = 12;
export const HEAD_OFFSET_X = 0;
export const HEAD_OFFSET_Y = -(BODY_HALF_HEIGHT + HEAD_RADIUS);

/** Where a resting car's centre sits above the ground under it. */
export const REST_HEIGHT = WHEEL_OFFSET_Y + WHEEL_RADIUS;
/** How tall a resting car is, roof-lamp and all. Half the geometry below is derived from it. */
export const CAR_HEIGHT = REST_HEIGHT - HEAD_OFFSET_Y + HEAD_RADIUS;

/**
 * Mass and moment of inertia, in the units the impulses are written in.
 *
 * The inertia is not the box's own `m (w² + h²) / 12` = 471. Two thirds again as much,
 * because the mass a real car carries at its ends — engine, axles, wheels — is nowhere
 * near evenly spread through the shell, and at 471 a single wheel impulse spun the car
 * hard enough that an ordinary landing threw it onto its roof. It is a tuning number and
 * it is honest about being one.
 */
export const MASS = 1;
export const INERTIA = 750;
const INV_MASS = 1 / MASS;
const INV_INERTIA = 1 / INERTIA;

/* -------------------------------------------------------------- what it does */

export const GRAVITY = 1500;
export const DRIVE_ACCELERATION = 1150;
export const MAX_DRIVE_SPEED = 330;
/** Coasting on the ground. A car with nobody asking anything of it comes to a stop. */
export const ROLL_DECELERATION = 260;

/**
 * A jump is a fixed launch, not an addition to whatever the car was already doing.
 *
 * `vy` is *set*, so the apex is `JUMP_SPEED² / (2 GRAVITY)` = 104.5 units above the launch
 * every single time. A car is `CAR_HEIGHT` = 67 tall, so a jump clears another car's head
 * by 37 units and comes down on the far side of it. An additive impulse would have made
 * the same button worth twice as much off a downslope, which is exactly the sort of thing
 * a player cannot see and therefore cannot learn.
 */
export const JUMP_SPEED = 560;
export const JUMP_COOLDOWN = 0.85;

/**
 * The lunge: a jump also throws the car the way it is being driven.
 *
 * Without it two cars pressed nose to nose could never reach each other's heads at all —
 * both are held apart by their own bodies, both jump straight up, and both come down
 * exactly where they left. The measured version of that is Spin War's: a headline verb
 * that never happens while every guard passes. `AIRBORNE_SECONDS × JUMP_LUNGE` = 112 units
 * of travel, against the 68 units two touching cars are apart, so a jump taken while
 * leaning on the other car lands on top of it.
 */
export const JUMP_LUNGE = 150;
/** Time from launch to landing on level ground: 2 × JUMP_SPEED / GRAVITY. */
export const AIRBORNE_SECONDS = (2 * JUMP_SPEED) / GRAVITY;

/** Turning in the air — the third verb. On the ground the wheels have the last word. */
export const AIR_TORQUE = 16;
export const MAX_DRIVEN_SPIN = 7;
/** Nothing may spin faster than this, whatever hit it. Keeps one step under a fifth of a turn. */
export const MAX_SPIN = 14;
export const AIR_SPIN_DAMPING = 0.6;
export const GROUND_SPIN_DAMPING = 12;

export const GROUND_RESTITUTION = 0.12;
/**
 * Grip, and the one number that had to be split in two.
 *
 * A wheel *rolls*: along the ground it offers almost nothing, which is the whole point of
 * having wheels. The first draft gave every contact point the same 0.85 and the cars could
 * not drive — measured, a car at full throttle crept forward at ten units a second, because
 * the friction impulse at the two wheel patches cancelled the drive force every step. A
 * body corner scraping the floor is the opposite case and keeps the high number, so a car
 * sliding on its roof stops rather than skating.
 */
export const WHEEL_FRICTION = 0.1;
export const BODY_FRICTION = 0.9;
export const CAR_RESTITUTION = 0.35;
export const CAR_FRICTION = 0.4;

/** Penetration left unresolved, so a resting car is not shoved every step. */
const CONTACT_SLOP = 0.35;
const CORRECTION = 0.85;
/** Passes over the contact set per step. Two is enough for a two-wheeled body at rest. */
const SOLVER_ITERATIONS = 2;

/* ------------------------------------------------------------------ the match */

/** Points that take the match. */
export const POINTS_TO_WIN = 5;
/**
 * The whole match, in seconds of simulation, and the only thing termination rests on.
 *
 * Checked on every step in every phase, so the worst case is this number and one step —
 * 100.02 s, a sixth of the ten-minute ceiling `apps/web/src/data/termination.test.ts`
 * allows. `roundSeconds` in the manifest ends nothing; it prints a number on a card.
 */
export const MATCH_SECONDS = 100;
/** A round nobody wins is restarted rather than left to eat the match clock. */
export const ROUND_SECONDS = 15;
export const SETTLE_SECONDS = 0.9;
/** How far either side of the middle the two cars start. */
export const START_OFFSET = 150;

const CONDITION: WinCondition = { kind: 'first-to', target: POINTS_TO_WIN };

export type Phase = 'live' | 'settling' | 'over';

/** What ended a seat's round. `'car'` is the verb the rule is named for. */
export type KoCause = 'none' | 'car' | 'ground';

export interface Car {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians, wrapped to (-π, π]. Zero is upright, and positive turns the nose down. */
  angle: number;
  spin: number;
  /** True while a wheel is resting on something. Only then may it drive or jump. */
  grounded: boolean;
  jumpCooldown: number;
  /** Which way the car is pointing: +1 right, −1 left. Drawn, never simulated. */
  facing: number;
}

export interface Match {
  readonly p1: Car;
  readonly p2: Car;
  phase: Phase;
  /** Seconds of match played, in every phase. The termination guarantee. */
  clock: number;
  /** Seconds this round has run. */
  roundTime: number;
  /** Counts down the settle between rounds. */
  hold: number;
  rounds: number;
  p1Points: number;
  p2Points: number;
  /** Whose head was hit last, `'draw'` when both were, null when the round timed out. */
  lastKo: SeatId | 'draw' | null;
  /** What did it. Read by the renderer to say why a point was given. */
  lastCause: KoCause;
  winner: SeatId | 'draw' | null;
}

export function createCar(): Car {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    grounded: true,
    jumpCooldown: 0,
    facing: 1,
  };
}

export function createMatch(): Match {
  const match: Match = {
    p1: createCar(),
    p2: createCar(),
    phase: 'live',
    clock: 0,
    roundTime: 0,
    hold: 0,
    rounds: 0,
    p1Points: 0,
    p2Points: 0,
    lastKo: null,
    lastCause: 'none',
    winner: null,
  };
  resetMatch(match);
  return match;
}

export function carOf(match: Readonly<Match>, seat: SeatId): Car {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function pointsOf(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1Points : match.p2Points;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Reflect a horizontal position through the middle of the pit. Exact, by construction. */
export function mirrorX(x: number): number {
  return -x;
}

/** Put both cars back where they started: mirrored, upright, and at rest. */
export function startRound(match: Match): void {
  placeCar(match.p1, -START_OFFSET, 1);
  placeCar(match.p2, mirrorX(-START_OFFSET), -1);
  match.phase = 'live';
  match.roundTime = 0;
  match.hold = 0;
  match.rounds += 1;
}

function placeCar(car: Car, x: number, facing: number): void {
  car.x = x;
  car.y = groundY(x) - REST_HEIGHT;
  car.vx = 0;
  car.vy = 0;
  car.angle = 0;
  car.spin = 0;
  car.grounded = true;
  car.jumpCooldown = 0;
  car.facing = facing;
}

export function resetMatch(match: Match): void {
  match.clock = 0;
  match.rounds = 0;
  match.p1Points = 0;
  match.p2Points = 0;
  match.lastKo = null;
  match.lastCause = 'none';
  match.winner = null;
  startRound(match);
  match.rounds = 1;
}

/** Everything back to a fresh match. `destroy()` calls it so nothing survives a teardown. */
export function clearMatch(match: Match): void {
  resetMatch(match);
}

/* ----------------------------------------------------------------- the ground */

const SEGMENTS = GROUND_X.length - 1;
const NORMAL_X: number[] = [];
const NORMAL_Y: number[] = [];
/**
 * Each segment's midpoint and slope, and the reason the *midpoint* is what is stored.
 *
 * A plane can be written from any point on it, and the obvious choice is the segment's left
 * end — but the pit's left-hand segments and its right-hand ones are mirror images whose
 * left ends are *not* mirror images of each other, so the same plane written from two ends
 * gives two answers that differ in the last bits. That is not pedantry: it was measured. A
 * car and its exact reflection, driven with exactly reflected controls, parted company at
 * step 37 of the run and by step 573 were 2.3e-8 apart, purely because their two wheels were
 * measuring the same slope from opposite ends of it.
 *
 * A midpoint is its own mirror image, so `(x − mx) · n` is bit-for-bit the negation of
 * `(−x − (−mx)) · (−n)` and the reflection is exact. `rules.test.ts` asserts it.
 */
const MID_X: number[] = [];
const MID_Y: number[] = [];
const SLOPE: number[] = [];
for (let i = 0; i < SEGMENTS; i += 1) {
  const ax = GROUND_X[i] ?? 0;
  const ay = GROUND_Y[i] ?? 0;
  const bx = GROUND_X[i + 1] ?? 0;
  const by = GROUND_Y[i + 1] ?? 0;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  // (dy, -dx) is the left-hand perpendicular of a left-to-right segment, which in a y-down
  // world is the one pointing at the sky. Every segment runs left to right, so the sign
  // never has to be checked at runtime.
  NORMAL_X.push(dy / length);
  NORMAL_Y.push(-dx / length);
  MID_X.push((ax + bx) / 2);
  MID_Y.push((ay + by) / 2);
  SLOPE.push(dy / dx);
}

/**
 * Which ground segment stands under `x`. Clamped, so a point past either end has one.
 *
 * The left half is answered by reflecting the right half's answer rather than by scanning,
 * because a scan has to give each node to one of the two segments that meet there and any
 * such rule reads differently from the two sides. Reflecting makes a node belong to the
 * segment *away from the middle* whichever side of the middle it is on, which is the same
 * rule for both seats.
 */
export function segmentAt(x: number): number {
  if (x < 0) return SEGMENTS - 1 - segmentAt(-x);
  for (let i = 1; i < SEGMENTS; i += 1) {
    if (x < (GROUND_X[i] ?? 0)) return i - 1;
  }
  return SEGMENTS - 1;
}

/** The height of the ground under `x`. */
export function groundY(x: number): number {
  const i = segmentAt(x);
  return (MID_Y[i] ?? 0) + (x - (MID_X[i] ?? 0)) * (SLOPE[i] ?? 0);
}

/**
 * How far a point stands above the ground plane beneath it, measured along that plane's own
 * normal rather than straight down.
 *
 * Negative below it, which is what lets a contact that has sunk past the surface still be
 * pushed the right way out. Measuring the drop straight down instead would have flipped the
 * escape direction the moment a wheel went deeper than its own radius.
 */
export function surfaceGap(x: number, y: number): number {
  const i = segmentAt(x);
  return (x - (MID_X[i] ?? 0)) * (NORMAL_X[i] ?? 0) + (y - (MID_Y[i] ?? 0)) * (NORMAL_Y[i] ?? 0);
}

export function surfaceNormalX(x: number): number {
  return NORMAL_X[segmentAt(x)] ?? 0;
}

export function surfaceNormalY(x: number): number {
  return NORMAL_Y[segmentAt(x)] ?? -1;
}

/* --------------------------------------------------------------- car geometry */

/** Angles are wrapped every step, so this only ever has one turn to give back. */
export function wrapAngle(angle: number): number {
  if (angle > Math.PI) return angle - Math.PI * 2;
  if (angle <= -Math.PI) return angle + Math.PI * 2;
  return angle;
}

export function bodyX(car: Readonly<Car>, localX: number, localY: number): number {
  return car.x + localX * Math.cos(car.angle) - localY * Math.sin(car.angle);
}

export function bodyY(car: Readonly<Car>, localX: number, localY: number): number {
  return car.y + localX * Math.sin(car.angle) + localY * Math.cos(car.angle);
}

export function headX(car: Readonly<Car>): number {
  return bodyX(car, HEAD_OFFSET_X, HEAD_OFFSET_Y);
}

export function headY(car: Readonly<Car>): number {
  return bodyY(car, HEAD_OFFSET_X, HEAD_OFFSET_Y);
}

export function wheelX(car: Readonly<Car>, side: number): number {
  return bodyX(car, side * WHEEL_OFFSET_X, WHEEL_OFFSET_Y);
}

export function wheelY(car: Readonly<Car>, side: number): number {
  return bodyY(car, side * WHEEL_OFFSET_X, WHEEL_OFFSET_Y);
}

/* ------------------------------------------------------- the collision scratch */

/**
 * Scratch shapes, allocated once and rewritten in place.
 *
 * **Every user sets the radius as well as the position**, and that is not belt and braces.
 * The head test and the contact solver shared two of these, and the head test left a radius
 * of 12 behind in the circle the solver went on to use for a wheel of 13 — so seat two's
 * wheels were a unit smaller than seat one's in every car-to-car collision in the game,
 * which is exactly the sort of quiet unfairness this file's symmetry argument is supposed
 * to make impossible. The mirror test found it in a step, having been unable to explain a
 * divergence of precisely 1.0.
 */
const headCircle: Circle = { x: 0, y: 0, radius: HEAD_RADIUS };
const partCircle: Circle = { x: 0, y: 0, radius: HEAD_RADIUS };
const wheelCircle: Circle = { x: 0, y: 0, radius: WHEEL_RADIUS };
const otherWheel: Circle = { x: 0, y: 0, radius: WHEEL_RADIUS };
const bodyBox: Obb = {
  x: 0,
  y: 0,
  halfWidth: BODY_HALF_LENGTH,
  halfHeight: BODY_HALF_HEIGHT,
  rotation: 0,
};
const otherBox: Obb = {
  x: 0,
  y: 0,
  halfWidth: BODY_HALF_LENGTH,
  halfHeight: BODY_HALF_HEIGHT,
  rotation: 0,
};
const probe: Contact = createContact();
function loadHead(circle: Circle, car: Readonly<Car>): void {
  circle.x = headX(car);
  circle.y = headY(car);
  circle.radius = HEAD_RADIUS;
}

function loadBody(box: Obb, car: Readonly<Car>): void {
  box.x = car.x;
  box.y = car.y;
  box.rotation = car.angle;
}

/* ------------------------------------------------------------- the integration */

/**
 * Advance one car's velocity and position over a step.
 *
 * Both integrations are the exact ones for a constant acceleration — `x += v dt + a dt²/2`
 * and `v += a dt` — rather than the plain forward step, so a trajectory is the same curve
 * at 60 Hz and at 144 Hz instead of drifting apart by an amount that grows with the step.
 * Where a limit binds (top speed, coasting to a stop, the driven spin cap) the
 * acceleration is trimmed so the velocity lands *on* the limit rather than past it, which
 * keeps the same property across the step the limit is reached on.
 */
export function integrateCar(car: Car, dt: number, throttle: number, jump: boolean): void {
  if (jump && car.grounded && car.jumpCooldown <= 0) {
    car.vy = -JUMP_SPEED;
    car.vx += throttle * JUMP_LUNGE;
    car.jumpCooldown = JUMP_COOLDOWN;
    car.grounded = false;
  } else if (car.jumpCooldown > 0) {
    car.jumpCooldown = Math.max(0, car.jumpCooldown - dt);
  }

  let ax = 0;
  if (car.grounded) {
    if (throttle !== 0) {
      const wanted = throttle * DRIVE_ACCELERATION;
      const room = throttle > 0 ? MAX_DRIVE_SPEED - car.vx : -MAX_DRIVE_SPEED - car.vx;
      // Never accelerate away from the cap, and never past it inside one step.
      ax =
        throttle > 0
          ? Math.min(wanted, Math.max(0, room / dt))
          : Math.max(wanted, Math.min(0, room / dt));
    } else if (car.vx !== 0) {
      const drop = Math.sign(car.vx) * -ROLL_DECELERATION;
      ax = Math.abs(drop * dt) > Math.abs(car.vx) ? -car.vx / dt : drop;
    }
  }

  const ay = GRAVITY;
  car.x += car.vx * dt + 0.5 * ax * dt * dt;
  car.y += car.vy * dt + 0.5 * ay * dt * dt;
  car.vx += ax * dt;
  car.vy += ay * dt;

  let spinAcceleration = 0;
  if (!car.grounded && throttle !== 0 && Math.abs(car.spin) < MAX_DRIVEN_SPIN) {
    const wanted = throttle * AIR_TORQUE;
    const room = throttle > 0 ? MAX_DRIVEN_SPIN - car.spin : -MAX_DRIVEN_SPIN - car.spin;
    spinAcceleration =
      throttle > 0
        ? Math.min(wanted, Math.max(0, room / dt))
        : Math.max(wanted, Math.min(0, room / dt));
  }
  const damping = car.grounded ? GROUND_SPIN_DAMPING : AIR_SPIN_DAMPING;
  if (car.spin !== 0) {
    const drop = Math.sign(car.spin) * -damping;
    spinAcceleration += Math.abs(drop * dt) > Math.abs(car.spin) ? -car.spin / dt : drop;
  }
  car.angle = wrapAngle(car.angle + car.spin * dt + 0.5 * spinAcceleration * dt * dt);
  car.spin = clamp(car.spin + spinAcceleration * dt, -MAX_SPIN, MAX_SPIN);

  if (Math.abs(car.vx) > 30) car.facing = car.vx > 0 ? 1 : -1;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/* ------------------------------------------------------------------ the solver */

/**
 * One contact, gathered before anything is solved.
 *
 * They are gathered and then solved together rather than one at a time, and that is a
 * correctness rule rather than a performance one — see {@link solveTouches}.
 */
interface Touch {
  px: number;
  py: number;
  nx: number;
  ny: number;
  depth: number;
  restitution: number;
  friction: number;
}

/** Six ground points a car, and sixteen ways two cars can meet. Never allocated per step. */
const MAX_TOUCHES = 20;
const touches: Touch[] = [];
for (let i = 0; i < MAX_TOUCHES; i += 1) {
  touches.push({ px: 0, py: 0, nx: 0, ny: 0, depth: 0, restitution: 0, friction: 0 });
}
let touchCount = 0;

/** The two bodies as they stood at the start of the pass. See {@link solveTouches}. */
let snapshotAvx = 0;
let snapshotAvy = 0;
let snapshotAspin = 0;
let snapshotBvx = 0;
let snapshotBvy = 0;
let snapshotBspin = 0;
/** What the pass has decided to add, applied only once every contact has been read. */
let deltaAvx = 0;
let deltaAvy = 0;
let deltaAspin = 0;
let deltaBvx = 0;
let deltaBvy = 0;
let deltaBspin = 0;

function addTouch(
  px: number,
  py: number,
  nx: number,
  ny: number,
  depth: number,
  restitution: number,
  friction: number,
): void {
  const touch = touches[touchCount];
  if (touch === undefined) return;
  touch.px = px;
  touch.py = py;
  touch.nx = nx;
  touch.ny = ny;
  touch.depth = depth;
  touch.restitution = restitution;
  touch.friction = friction;
  touchCount += 1;
}

/**
 * Work out one contact's impulse and add its share to the pass.
 *
 * Everything is read from the snapshot rather than from the cars, so no contact can see
 * what another contact in the same pass has already decided.
 */
function accumulate(touch: Readonly<Touch>, a: Car, b: Car | null, share: number): void {
  const arx = touch.px - a.x;
  const ary = touch.py - a.y;
  const brx = b === null ? 0 : touch.px - b.x;
  const bry = b === null ? 0 : touch.py - b.y;
  const nx = touch.nx;
  const ny = touch.ny;

  let relX = snapshotAvx - snapshotAspin * ary;
  let relY = snapshotAvy + snapshotAspin * arx;
  if (b !== null) {
    relX -= snapshotBvx - snapshotBspin * bry;
    relY -= snapshotBvy + snapshotBspin * brx;
  }
  const normalSpeed = relX * nx + relY * ny;
  if (normalSpeed >= 0) return;

  const aCrossN = arx * ny - ary * nx;
  const bCrossN = brx * ny - bry * nx;
  const shared = b === null ? INV_MASS : INV_MASS * 2;
  // **Bracketed so the two turning terms are added to each other first.** Floating point
  // addition commutes but does not associate, and the mirror image of this contact is the
  // same expression with `a` and `b` swapped — so `(shared + A) + B` and `(shared + B) + A`
  // are the two answers a symmetric collision gets, and they differ in the last bit. That
  // bit was worth 18 units a second of vertical speed within a few dozen steps.
  const inverseMassN =
    shared + (INV_INERTIA * aCrossN * aCrossN + (b === null ? 0 : INV_INERTIA * bCrossN * bCrossN));
  const normalImpulse = (-(1 + touch.restitution) * normalSpeed) / inverseMassN;

  const tx = -ny;
  const ty = nx;
  const tangentSpeed = relX * tx + relY * ty;
  const aCrossT = arx * ty - ary * tx;
  const bCrossT = brx * ty - bry * tx;
  const inverseMassT =
    shared + (INV_INERTIA * aCrossT * aCrossT + (b === null ? 0 : INV_INERTIA * bCrossT * bCrossT));
  const limit = touch.friction * normalImpulse;
  const tangentImpulse = clamp(-tangentSpeed / inverseMassT, -limit, limit);

  const pushX = (normalImpulse * nx + tangentImpulse * tx) * share;
  const pushY = (normalImpulse * ny + tangentImpulse * ty) * share;
  const turn = (aCrossN * normalImpulse + aCrossT * tangentImpulse) * share;
  deltaAvx += pushX * INV_MASS;
  deltaAvy += pushY * INV_MASS;
  deltaAspin += INV_INERTIA * turn;
  if (b === null) return;
  const turnB = (bCrossN * normalImpulse + bCrossT * tangentImpulse) * share;
  deltaBvx -= pushX * INV_MASS;
  deltaBvy -= pushY * INV_MASS;
  deltaBspin -= INV_INERTIA * turnB;
}

/**
 * Solve every gathered contact at once, twice, and then push the bodies apart.
 *
 * **The passes are simultaneous rather than sequential, and the whole fairness of the game
 * rests on it.** A sequential solver applies each impulse to the state the last one left,
 * so the *order* of the contacts changes the answer — and a car's two wheels are visited
 * left to right, which under the mirror that separates the two seats is right to left. The
 * two cars were therefore being solved in opposite orders, and the effect was not
 * theoretical: over 60 seeded matches of two `hard` bots, seat one turned itself onto its
 * own head 59 times to seat two's 16, and lost the matches that went with it. Measured
 * afterwards, the pit is exact to the last bit under reflection — `rules.test.ts` mirrors a
 * whole match and asserts every state variable to zero tolerance.
 *
 * Each contact takes an equal share of the correction, which is also what keeps a car
 * resting on two wheels from being thrown twice as hard as one resting on one.
 */
function solveTouches(a: Car, b: Car | null): void {
  if (touchCount === 0) return;
  const share = 1 / touchCount;
  for (let pass = 0; pass < SOLVER_ITERATIONS; pass += 1) {
    snapshotAvx = a.vx;
    snapshotAvy = a.vy;
    snapshotAspin = a.spin;
    snapshotBvx = b === null ? 0 : b.vx;
    snapshotBvy = b === null ? 0 : b.vy;
    snapshotBspin = b === null ? 0 : b.spin;
    deltaAvx = 0;
    deltaAvy = 0;
    deltaAspin = 0;
    deltaBvx = 0;
    deltaBvy = 0;
    deltaBspin = 0;
    for (let i = 0; i < touchCount; i += 1) {
      const touch = touches[i];
      if (touch === undefined) continue;
      accumulate(touch, a, b, share);
    }
    a.vx += deltaAvx;
    a.vy += deltaAvy;
    a.spin = clamp(a.spin + deltaAspin, -MAX_SPIN, MAX_SPIN);
    if (b !== null) {
      b.vx += deltaBvx;
      b.vy += deltaBvy;
      b.spin = clamp(b.spin + deltaBspin, -MAX_SPIN, MAX_SPIN);
    }
  }

  let pushX = 0;
  let pushY = 0;
  for (let i = 0; i < touchCount; i += 1) {
    const touch = touches[i];
    if (touch === undefined) continue;
    const out = Math.max(0, touch.depth - CONTACT_SLOP) * CORRECTION * share;
    pushX += touch.nx * out;
    pushY += touch.ny * out;
  }
  if (b === null) {
    a.x += pushX;
    a.y += pushY;
    return;
  }
  a.x += pushX * 0.5;
  a.y += pushY * 0.5;
  b.x -= pushX * 0.5;
  b.y -= pushY * 0.5;
}

/** The six points of a car that can touch the ground: two wheels, then the four corners. */
const POINT_LOCAL_X: readonly number[] = [
  -WHEEL_OFFSET_X,
  WHEEL_OFFSET_X,
  -BODY_HALF_LENGTH,
  BODY_HALF_LENGTH,
  -BODY_HALF_LENGTH,
  BODY_HALF_LENGTH,
];
const POINT_LOCAL_Y: readonly number[] = [
  WHEEL_OFFSET_Y,
  WHEEL_OFFSET_Y,
  -BODY_HALF_HEIGHT,
  -BODY_HALF_HEIGHT,
  BODY_HALF_HEIGHT,
  BODY_HALF_HEIGHT,
];
const POINT_RADIUS: readonly number[] = [WHEEL_RADIUS, WHEEL_RADIUS, 0, 0, 0, 0];
const POINT_FRICTION: readonly number[] = [
  WHEEL_FRICTION,
  WHEEL_FRICTION,
  BODY_FRICTION,
  BODY_FRICTION,
  BODY_FRICTION,
  BODY_FRICTION,
];

/**
 * Push one car out of the ground and take the speed out of the impact.
 *
 * The wheels are circles and the four body corners are points, so a car that lands nose
 * first digs its corner in and pitches over rather than hovering on its axles. Only a
 * *wheel* contact counts as being on the ground: a car resting on its bumper has nothing to
 * drive with and nothing to jump off, which is the whole risk of turning over.
 */
export function solveGround(car: Car): boolean {
  let grounded = false;
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  touchCount = 0;

  for (let i = 0; i < POINT_LOCAL_X.length; i += 1) {
    const lx = POINT_LOCAL_X[i] ?? 0;
    const ly = POINT_LOCAL_Y[i] ?? 0;
    const radius = POINT_RADIUS[i] ?? 0;
    const px = car.x + lx * cos - ly * sin;
    const py = car.y + lx * sin + ly * cos;
    const depth = radius - surfaceGap(px, py);
    if (depth <= 0) continue;
    if (i < 2) grounded = true;
    const nx = surfaceNormalX(px);
    const ny = surfaceNormalY(px);
    addTouch(
      px - nx * radius,
      py - ny * radius,
      nx,
      ny,
      depth,
      GROUND_RESTITUTION,
      POINT_FRICTION[i] ?? BODY_FRICTION,
    );
  }
  solveTouches(car, null);
  return grounded;
}

/** {@link solveCars} returns these: which of the two cars is standing on the other. */
export const STACK_A = 1;
export const STACK_B = 2;

/**
 * The two cars against each other: wheels against body, wheels against wheels, and body
 * against body.
 *
 * Every contact found is gathered, not just the deepest, because the *set* is symmetric
 * under swapping the two cars while any choice among them would not be — the same reason
 * the impulses are simultaneous.
 */
export function solveCars(a: Car, b: Car): number {
  touchCount = 0;
  loadBody(bodyBox, a);
  loadBody(otherBox, b);
  wheelCircle.radius = WHEEL_RADIUS;
  otherWheel.radius = WHEEL_RADIUS;
  let stacked = 0;

  // **Gathered in mirror-image pairs, adjacently.** Two contacts that are each other's
  // reflection contribute equal horizontal pushes and *opposite* vertical ones, and a pair
  // of opposite floats cancels exactly only when they are added one after the other. Split
  // them across the list — which the obvious left-then-right loop does — and the two cars
  // come out of a symmetric collision a few bits apart. It is the same class of bug as the
  // segment midpoints above, and it was found the same way.
  for (let side = -1; side <= 1; side += 2) {
    wheelCircle.x = wheelX(a, side);
    wheelCircle.y = wheelY(a, side);
    if (circleObb(probe, wheelCircle, otherBox)) stacked |= takeContact(probe, false);
    otherWheel.x = wheelX(b, -side);
    otherWheel.y = wheelY(b, -side);
    // Reported against b's wheel, so the normal has to be turned to point at a.
    if (circleObb(probe, otherWheel, bodyBox)) stacked |= takeContact(probe, true);
  }
  for (let pairing = -1; pairing <= 1; pairing += 2) {
    for (let side = -1; side <= 1; side += 2) {
      wheelCircle.x = wheelX(a, side);
      wheelCircle.y = wheelY(a, side);
      otherWheel.x = wheelX(b, side * pairing);
      otherWheel.y = wheelY(b, side * pairing);
      if (circleCircle(probe, wheelCircle, otherWheel)) {
        // Two wheels of one size meet halfway, and the halfway point is the one that
        // survives the reflection: `circleCircle` reports the point on the *second*
        // circle's rim, which under a swap of the two cars is a point on the first one's.
        // Left as it came, a wheel-against-wheel contact between two exactly mirrored cars
        // handed them a vertical rub out of nowhere.
        probe.pointX = (wheelCircle.x + otherWheel.x) / 2;
        probe.pointY = (wheelCircle.y + otherWheel.y) / 2;
        stacked |= takeContact(probe, false);
      }
    }
  }
  // **Corners against bodies, never body against body.** `obbObb` resolves along the
  // shallowest of the four candidate axes and keeps the earlier one on a tie — and two
  // mirrored cars meeting head-on tie exactly, so it answered along *a*'s axis and gave the
  // pair a vertical impulse that had no reflection in it. Measured: the two cars parted
  // company on that one contact, 18 units a second of vertical speed out of nothing. Four
  // corner points a car against the other's box says the same thing about the same
  // geometry, in mirror-image pairs, out of a primitive that is exact under reflection.
  for (let corner = 0; corner < 4; corner += 1) {
    const lx = (corner & 1) === 0 ? -BODY_HALF_LENGTH : BODY_HALF_LENGTH;
    const ly = corner < 2 ? -BODY_HALF_HEIGHT : BODY_HALF_HEIGHT;
    wheelCircle.x = bodyX(a, lx, ly);
    wheelCircle.y = bodyY(a, lx, ly);
    wheelCircle.radius = 0;
    if (circleObb(probe, wheelCircle, otherBox)) stacked |= takeContact(probe, false);
    otherWheel.x = bodyX(b, -lx, ly);
    otherWheel.y = bodyY(b, -lx, ly);
    otherWheel.radius = 0;
    if (circleObb(probe, otherWheel, bodyBox)) stacked |= takeContact(probe, true);
  }
  wheelCircle.radius = WHEEL_RADIUS;
  otherWheel.radius = WHEEL_RADIUS;
  if (touchCount === 0) return 0;
  solveTouches(a, b);
  // A car sitting on the other one's roof is standing on something, which is the only
  // moment in the game when a jump can be taken off anything but the ground.
  return stacked;
}

function takeContact(contact: Readonly<Contact>, flip: boolean): number {
  const nx = flip ? -contact.normalX : contact.normalX;
  const ny = flip ? -contact.normalY : contact.normalY;
  addTouch(contact.pointX, contact.pointY, nx, ny, contact.depth, CAR_RESTITUTION, CAR_FRICTION);
  // The normal always points from b to a, so it says which of the two is being held up —
  // read from the contact itself rather than by comparing the two heights, which answers
  // the same question in a way that has to pick a seat when the two are exactly level.
  return ny < -0.5 ? STACK_A : ny > 0.5 ? STACK_B : 0;
}

/** Hold a car inside the picture. Rule 9: what one seat cannot see, neither may reach. */
export function holdInside(car: Car): void {
  const limit = ARENA_HALF_WIDTH - WALL_MARGIN;
  if (car.x < -limit) {
    car.x = -limit;
    if (car.vx < 0) car.vx = -car.vx * WALL_BOUNCE;
  } else if (car.x > limit) {
    car.x = limit;
    if (car.vx > 0) car.vx = -car.vx * WALL_BOUNCE;
  }
  if (car.y < CEILING_Y) {
    car.y = CEILING_Y;
    if (car.vy < 0) car.vy = 0;
  }
}

/* --------------------------------------------------------------------- the head */

/**
 * What is touching a seat's head right now.
 *
 * The other car is checked before the ground, so a driver rammed into the floor is
 * credited to the driver who did the ramming rather than to the floor that finished it.
 */
export function headTouch(match: Readonly<Match>, seat: SeatId): KoCause {
  const car = carOf(match, seat);
  const rival = carOf(match, otherOf(seat));
  loadHead(headCircle, car);

  loadBody(otherBox, rival);
  if (circleObb(probe, headCircle, otherBox)) return 'car';
  partCircle.radius = WHEEL_RADIUS;
  for (let side = -1; side <= 1; side += 2) {
    partCircle.x = wheelX(rival, side);
    partCircle.y = wheelY(rival, side);
    if (circleCircle(probe, headCircle, partCircle)) return 'car';
  }
  loadHead(partCircle, rival);
  if (circleCircle(probe, headCircle, partCircle)) return 'car';

  if (surfaceGap(headCircle.x, headCircle.y) < HEAD_RADIUS) return 'ground';
  return 'none';
}

/* --------------------------------------------------------------------- the step */

export interface StepResult {
  readonly p1Ko: KoCause;
  readonly p2Ko: KoCause;
  /** True on the step a round ended, however it ended. */
  readonly roundOver: boolean;
  /** True when the round ended because nobody had scored inside `ROUND_SECONDS`. */
  readonly timedOut: boolean;
}

const stepResult = {
  p1Ko: 'none' as KoCause,
  p2Ko: 'none' as KoCause,
  roundOver: false,
  timedOut: false,
};
const tally = { p1: 0, p2: 0 };
const judgeOptions = { timeExpired: false };

/**
 * One fixed step of a whole match.
 *
 * Both cars are integrated, then both are put back on the ground, then both heads are
 * tested — in that order and never interleaved — so a step in which each car reaches the
 * other's head scores for both of them rather than for whichever seat the loop happened to
 * reach first.
 */
export function stepMatch(
  match: Match,
  dt: number,
  p1Throttle: number,
  p1Jump: boolean,
  p2Throttle: number,
  p2Jump: boolean,
): Readonly<StepResult> {
  stepResult.p1Ko = 'none';
  stepResult.p2Ko = 'none';
  stepResult.roundOver = false;
  stepResult.timedOut = false;
  if (match.winner !== null) return stepResult;

  match.clock += dt;

  if (match.phase === 'settling') {
    match.hold -= dt;
    if (match.hold <= 0) startRound(match);
    return judgeMatch(match);
  }

  match.roundTime += dt;
  integrateCar(match.p1, dt, clamp(p1Throttle, -1, 1), p1Jump);
  integrateCar(match.p2, dt, clamp(p2Throttle, -1, 1), p2Jump);

  let p1Grounded = false;
  let p2Grounded = false;
  for (let pass = 0; pass < SOLVER_ITERATIONS; pass += 1) {
    p1Grounded = solveGround(match.p1) || p1Grounded;
    p2Grounded = solveGround(match.p2) || p2Grounded;
    const stacked = solveCars(match.p1, match.p2);
    if ((stacked & STACK_A) !== 0) p1Grounded = true;
    if ((stacked & STACK_B) !== 0) p2Grounded = true;
  }
  match.p1.grounded = p1Grounded;
  match.p2.grounded = p2Grounded;
  holdInside(match.p1);
  holdInside(match.p2);

  const p1Ko = headTouch(match, 'p1');
  const p2Ko = headTouch(match, 'p2');
  stepResult.p1Ko = p1Ko;
  stepResult.p2Ko = p2Ko;
  if (p1Ko !== 'none' || p2Ko !== 'none') {
    // A head hit scores for the *other* seat, which is the whole of the observed rule.
    if (p1Ko !== 'none') match.p2Points += 1;
    if (p2Ko !== 'none') match.p1Points += 1;
    match.lastKo = p1Ko !== 'none' && p2Ko !== 'none' ? 'draw' : p1Ko !== 'none' ? 'p1' : 'p2';
    match.lastCause = p1Ko !== 'none' ? p1Ko : p2Ko;
    endRound(match);
  } else if (match.roundTime >= ROUND_SECONDS) {
    match.lastKo = null;
    match.lastCause = 'none';
    stepResult.timedOut = true;
    endRound(match);
  }
  return judgeMatch(match);
}

function endRound(match: Match): void {
  match.phase = 'settling';
  match.hold = SETTLE_SECONDS;
  stepResult.roundOver = true;
}

/**
 * Ask the SDK who has won, if anybody has.
 *
 * Points are counted, never clamped — nothing here is pinned to `POINTS_TO_WIN` and then
 * compared against itself — so a step in which both seats reach the target is the genuine
 * dead heat `resolve()` calls it, and every other step is decided on numbers that still
 * carry the difference between the two seats.
 */
function judgeMatch(match: Match): Readonly<StepResult> {
  tally.p1 = match.p1Points;
  tally.p2 = match.p2Points;
  judgeOptions.timeExpired = match.clock >= MATCH_SECONDS;
  const outcome = resolve(CONDITION, tally, judgeOptions);
  if (outcome !== null) {
    match.winner = outcome;
    match.phase = 'over';
  }
  return stepResult;
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

/* ----------------------------------------------------------------------- the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between one look at the pit and the next. */
  readonly reaction: number;
  /** Units of error in where it believes the other car is. Drawn once, then held. */
  readonly aimError: number;
  /** Units of error in where it believes a jump would put it down. */
  readonly jumpError: number;
  /** Chance a whole judgement is thrown away: it charges when it should back off. */
  readonly blunder: number;
  /** How much of the available steering it uses in the air, 0 to 1. */
  readonly airSkill: number;
}

/**
 * Three tiers, none of which knows anything a player watching the same pit does not.
 *
 * Every one of them reads exactly two things: where the two cars are and how fast they are
 * going. Both are on the screen, both seats see the whole pit, and there is nothing else to
 * see — no spawn table, no hidden timer, no lookahead. So rule 6 is kept by there being
 * nothing to keep it from, and the tiers differ only in *when* they look, *how well* they
 * judge, and *how finely* they steer.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.42, aimError: 95, jumpError: 95, blunder: 0.28, airSkill: 0.35 },
  normal: { reaction: 0.2, aimError: 45, jumpError: 45, blunder: 0.12, airSkill: 0.7 },
  hard: { reaction: 0.08, aimError: 14, jumpError: 14, blunder: 0.03, airSkill: 1 },
});

/**
 * Floats drawn from the shared stream per look. Always exactly this many.
 *
 * Both bots draw from the game's one generator, so a seat whose draw count depended on
 * what it decided would shift the *other* seat's stream — a seat bias made of arithmetic.
 * Three, unconditionally, whatever it goes on to do.
 */
export const BOT_DRAWS_PER_LOOK = 3;

/** How near the predicted landing must be to the rival for the bot to commit to a jump. */
export const JUMP_TOLERANCE = 40;
/** Inside this the bot treats an airborne rival above it as something to get out from under. */
export const EVADE_RANGE = 120;
/** How hard the bot leans on the throttle to close a gap: full beyond this many units. */
export const APPROACH_SPAN = 30;
/** The PD gains it rights itself with in the air. */
export const RIGHTING_P = 2.2;
export const RIGHTING_D = 0.55;

export interface BotState {
  readonly judgement: Judgement;
  /** The held error in where the rival is. */
  aimSlip: number;
  /** The held error in the gap it means to launch at. */
  jumpSlip: number;
  /** Whether this judgement is a bad one. */
  blunder: boolean;
  /** What it decided to do at its last look: charge the rival, or get out from under it. */
  evading: boolean;
  /** True while a jump is planned and has not been taken. */
  armed: boolean;
  /** The gap it means to launch at, worked out at the look and then held. */
  launchGap: number;
  /** What it decided this step. Read by the game, and by the tests. */
  throttle: number;
  jump: boolean;
}

export function createBotState(): BotState {
  return {
    judgement: createJudgement(),
    aimSlip: 0,
    jumpSlip: 0,
    blunder: false,
    evading: false,
    armed: false,
    launchGap: 0,
    throttle: 0,
    jump: false,
  };
}

export function resetBotState(state: BotState): void {
  resetJudgement(state.judgement);
  state.aimSlip = 0;
  state.jumpSlip = 0;
  state.blunder = false;
  state.evading = false;
  state.armed = false;
  state.launchGap = 0;
  state.throttle = 0;
  state.jump = false;
}

/**
 * How much road a jump taken now would cover before the car came down again.
 *
 * The arithmetic a person does by eye — I am going that fast, the lunge throws me that
 * far, so I will land about there. The lunge is in it because it is part of what the
 * button does, so the bot is predicting the jump it would actually take.
 */
export function launchGapFor(car: Readonly<Car>, toward: number): number {
  return Math.abs(car.vx + toward * JUMP_LUNGE) * AIRBORNE_SECONDS;
}

/**
 * One bot's decision for this step, written into `state`.
 *
 * **A plan is made at a look and executed by the car's own odometer**, which is how a
 * person plays it: you see the other car coming, you decide where you are going to jump,
 * and then you jump when you get there. So the reaction time is on the *deciding* — which
 * is the part a reaction time is about — while the trigger itself is the gap the driver can
 * see closing in front of them.
 *
 * That distinction is the whole ladder. An earlier draft re-tested the jump condition every
 * single step against live positions, so every tier fired at exactly the right instant and
 * `reaction` bought nothing: measured over 60 seeded matches, `hard` beat `normal` 32-28,
 * which is a coin. With the plan held, a slow bot is still acting on a picture of the pit
 * that has moved on.
 *
 * The judgement is redrawn on the tier's own cadence and then held. A fresh error every
 * step averages to zero and makes every tier identical — the mistake this repository has
 * made three times and the reason `Judgement` exists in the SDK.
 */
export function botDrive(
  match: Readonly<Match>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  dt: number,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const self = carOf(match, seat);
  const rival = carOf(match, otherOf(seat));

  if (shouldDecide(state.judgement, dt)) {
    const aimRoll = rng.float();
    const jumpRoll = rng.float();
    const blunderRoll = rng.float();
    state.aimSlip = misjudgement(aimRoll, profile.aimError);
    state.jumpSlip = misjudgement(jumpRoll, profile.jumpError);
    state.blunder = blunderRoll < profile.blunder;
    commit(state.judgement, state.aimSlip, profile.reaction);

    // Everything below is judged once, here, and then acted on until the next look.
    const gap = rival.x + state.aimSlip - self.x;
    const toward = gap === 0 ? self.facing : Math.sign(gap);
    // Jumping at a car that is already above you loses the car underneath it. Every tier
    // can see that as plainly as a person can; a blunder is the failure to act on it.
    const overhead = !rival.grounded && rival.y < self.y - BODY_HALF_HEIGHT;
    state.evading = overhead && Math.abs(gap) < EVADE_RANGE;
    state.armed = !state.evading;
    state.launchGap = launchGapFor(self, toward) + state.jumpSlip;
    if (state.blunder) {
      state.evading = !state.evading;
      state.armed = false;
    }
  }

  state.jump = false;

  if (!self.grounded) {
    // In the air there is one thing worth doing and it is not landing on your own head.
    const wanted = -(RIGHTING_P * self.angle + RIGHTING_D * self.spin);
    state.throttle = clamp(wanted, -1, 1) * profile.airSkill;
    if (state.blunder) state.throttle = -state.throttle;
    return;
  }

  const gap = rival.x + state.aimSlip - self.x;
  const toward = gap === 0 ? self.facing : Math.sign(gap);
  if (state.evading) {
    state.throttle = -toward;
    return;
  }

  state.throttle = clamp(gap / APPROACH_SPAN, -1, 1);
  if (!state.armed || self.jumpCooldown > 0) return;
  if (Math.abs(rival.x - self.x) <= state.launchGap) {
    state.jump = true;
    state.armed = false;
  }
}
