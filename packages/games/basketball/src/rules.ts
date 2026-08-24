import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';

/**
 * Basketball, as pure rules.
 *
 * One fenced street court seen from above, one hoop standing on the halfway line, and one
 * ball. Whoever's half the ball is lying in shoots at that hoop: a needle sweeps for the
 * line, a second needle runs out for the range, and the ball is in the air. It cannot be
 * touched while it is up — that is the observed rule, and here it is simply true, because
 * nothing but the floor is simulated. What happens *after* it comes down is the game.
 *
 * ## Three decisions carry the whole game
 *
 * **One hoop, on the centre line.** Two hoops at the two ends is what a real court has and
 * it is the wrong shape for this device. Rule 9 says neither player may see more of the
 * play area than the other, and a turn-based board here turns half a turn to face whoever
 * is shooting — so the geometry has to be *its own mirror image*. A hoop at the exact
 * centre is; two hoops at the ends are only if you also swap which one each seat is
 * aiming at, and then a miss that runs deep into the opponent's half hands them a shot
 * from the far side of the court, which rewards missing. Measured on the two-hoop layout,
 * the seat that bricked hardest won most. One hoop removes the whole class. **[ours]**
 *
 * **A short miss comes back; a long one does not.** The rim is a real object here, not a
 * radius test: a ball whose centre lands within {@link MOUTH_RADIUS} drops through, one
 * between that and {@link CLANG_RADIUS} hits the ring and is thrown straight back out
 * along the line from the hoop to where it struck. Land short of the hoop and that line
 * points at the shooter, so the ball rebounds into their own half and they shoot again.
 * Land long and it points away, into the other half, and the possession is over. That one
 * asymmetry is the whole of the game's advice — *shade it short* — and it costs no rule
 * text at all, because it falls out of where the ball hit. **[ours]**
 *
 * **Possession alternates; the rebound is the only thing that extends it.** Fourteen
 * possessions, seven each, and a hard cap of {@link SHOTS_PER_POSSESSION} shots inside
 * one. That is what makes the match end — see `advance` — and it is also what keeps the
 * two seats symmetric: neither can be starved of the ball by an opponent on a run. A
 * change of possession always puts the ball back at the top of the key, so a bad shot can
 * never be used to leave the opponent somewhere awkward.
 *
 * No rendering, no timing, no DOM. The rules draw no random numbers at all — only the
 * bots do.
 */

export const COURT_WIDTH = 700;
export const COURT_HEIGHT = 1000;
export const CENTRE_X = COURT_WIDTH / 2;
export const CENTRE_Y = COURT_HEIGHT / 2;

/** The fence. A ball never leaves the court; it bounces off, so there is no out of bounds. */
export const COURT_MARGIN = 40;
export const BALL_RADIUS = 13;
export const MIN_X = COURT_MARGIN + BALL_RADIUS;
export const MAX_X = COURT_WIDTH - COURT_MARGIN - BALL_RADIUS;
export const MIN_Y = COURT_MARGIN + BALL_RADIUS;
export const MAX_Y = COURT_HEIGHT - COURT_MARGIN - BALL_RADIUS;

export const HOOP_X = CENTRE_X;
export const HOOP_Y = CENTRE_Y;

/**
 * The ring, and the ball that has to fit through it.
 *
 * {@link MOUTH_RADIUS} — the ring less the ball — is what a shot is judged against, and it
 * is the single number that decides where the whole difficulty ladder lives. The quantity
 * that matters is **how many seconds of press error the mouth is worth**: the mouth
 * divided by how fast a needle moves the landing point. Everything below is fitted to put
 * that figure at 0.080 s on both needles at a typical shot, which is 4.8 frames at 60 Hz.
 *
 * Four frames is the floor. Below it the needle's own lattice is coarser than the target
 * and whether a shot goes in stops being a decision — Cup Pong records the same trap and
 * the same arithmetic. A ring twice a real one's size relative to the court is the price,
 * and it is worth paying: shrinking it back would move the tiers into a 1.3x band that no
 * amount of bot tuning could spread out again.
 */
export const RIM_RADIUS = 56;
export const MOUTH_RADIUS = RIM_RADIUS - BALL_RADIUS;
/** Outside the mouth but still touching the ring: a clang, thrown back out radially. */
export const CLANG_RADIUS = RIM_RADIUS + BALL_RADIUS;
/**
 * Dead centre — nothing but net, and worth an extra point.
 *
 * The score's fine resolution. Two seats of the same standard land on the same number of
 * baskets often, so counting a clean drop apart from one that goes in off the ring is what
 * keeps the match from ending level; it is also the second gradient the aim needle is
 * playing for, rather than a pass/fail.
 */
export const SWISH_RADIUS = 20;

export const POINTS_BASKET = 2;
export const POINTS_SWISH = 3;

/**
 * The take-back line: a rebound inside it has to be carried back out before it counts.
 *
 * A street-court rule, and here it does real work. Without it a ball trickling to a stop
 * under the ring would be a free basket, and the whole possession would be worth playing
 * for that rather than for the shot. Carried back *along its own line* rather than to one
 * fixed spot, so the angle a rebound came off at survives into the next shot.
 */
export const ARC_RADIUS = 300;

/**
 * The aim needle: how far it sweeps either side of the line to the hoop, and how fast.
 *
 * Measured from the line to the hoop rather than from the court, so a press dead on the
 * middle of the sweep is a shot dead at the ring from wherever the ball is lying. The
 * sweep covers about a fifth of a turn, which at the top of the key is 90 units either
 * side of the ring — twice the mouth, so both ends of the gauge are a genuine miss.
 */
export const AIM_SWEEP = 0.3;
export const AIM_RATE = 1.35;

/**
 * The range gauge, in logical units of carry, and how fast the needle crosses it.
 *
 * Absolute rather than a fraction of the distance to the hoop, and that is deliberate: it
 * makes a long shot genuinely harder than a short one, because a fixed error in *seconds*
 * is a fixed error in units of carry either way, while the same error on the aim needle
 * opens out with distance. A gauge scaled to the shot would have made every position on
 * the court the same shot.
 */
export const MIN_RANGE = 180;
export const MAX_RANGE = 700;
export const POWER_RATE = 1.03;

/** Flight: a constant plus the carry, so a long shot hangs longer. Units a second. */
export const FLIGHT_BASE = 0.22;
export const BALL_SPEED = 1300;

/**
 * The roll after a miss, as constant deceleration.
 *
 * Constant rather than a decay per step: a per-step multiplier steps differently at 60 and
 * at 120 Hz, and the whole match would drift apart across two devices. The distance is
 * known up front, so `step` walks a closed-form arc length rather than integrating — exact
 * at any timestep, which is what lets the same roll end in the same place at 60 Hz and at
 * 120 Hz rather than drifting apart by a frame's worth of velocity each bounce.
 */
export const ROLL_DECEL = 520;
/** How far a ball thrown off the ring travels. Enough to clear the ring and the arc. */
export const CLANG_ROLL_BASE = 200;
export const CLANG_ROLL_FACTOR = 0.2;
/** A ball that missed the ring entirely keeps most of its pace. */
export const BRICK_ROLL_FACTOR = 0.45;

/**
 * How long the needles are frozen at the start of a shot.
 *
 * **Longer than the shell's 0.36 s board flip, deliberately.** The shell refuses human
 * input while the court is turning, and a bot does not go through the shell — so without a
 * freeze in the *simulation*, where the two are the same, a bot would get a third of a
 * second of free needle every shot. It cannot live in `game.ts` either: `seatView` reports
 * no rotation at all in single-seat play, so the same match would step differently on a
 * phone playing remotely and on one passed across a table.
 */
export const READY_SECONDS = 0.5;

/** Seconds the ball is left where it stopped before the court turns. */
export const SETTLE_SECONDS = 0.45;

/**
 * Slack on a countdown, so a rounding error cannot buy a whole extra frame of it.
 *
 * `hold` is walked down a step at a time, and thirty subtractions of a sixtieth leave it at
 * 1.04e-16 *above* a step rather than exactly on one. Compared with `>` alone that reads as
 * "a step still to run", so the half-second freeze took thirty-one frames and handed the
 * sweep a whole frame of the last one — the needle was never once readable at the end of its
 * gauge, which is the position the bot's own arithmetic assumes it starts from. A nanosecond
 * of simulated time is eight orders of magnitude above the error and eight below a frame, so
 * it can only ever close that gap.
 */
const CLOCK_EPSILON = 1e-9;

/** Whether a countdown of `hold` still has a whole step left to run. */
function stillHolding(hold: number, dt: number): boolean {
  return hold > dt + CLOCK_EPSILON;
}

/**
 * Possessions in a match, and the termination guarantee.
 *
 * Strictly alternating and even, so both seats get exactly seven, whatever either of them
 * does with theirs. With the shot cap below this bounds a match at forty-two shots and
 * makes it impossible for a seat on a run to starve the other of the ball.
 */
export const POSSESSIONS = 14;

/**
 * Shots one possession may contain. The shot clock, and the other half of termination.
 *
 * Three rather than one, because the rebound is the point of the game; three rather than
 * unlimited, because a seat that keeps grabbing its own miss would otherwise never have to
 * hand the ball over and the match would have no upper bound at all.
 */
export const SHOTS_PER_POSSESSION = 3;

export type Phase = 'ready' | 'aiming' | 'charging' | 'flying' | 'rolling' | 'settling' | 'over';

/** What a shot did. `swish` and `basket` score; `rim` and `brick` do not. */
export type Outcome = 'swish' | 'basket' | 'rim' | 'brick';

export interface Point {
  x: number;
  y: number;
}

export interface Court {
  readonly ball: Point;
  phase: Phase;
  shooter: SeatId;
  possession: number;
  shotsThisPossession: number;
  /** Seconds left in the ready freeze or the settle, whichever phase is running. */
  hold: number;
  /** Where the aim needle is, in radians either side of the line to the hoop. */
  aim: number;
  aimRising: boolean;
  /** Where the range needle is, in 0..1 of the gauge. */
  power: number;
  powerRising: boolean;
  /** The line kept by the first press, once `phase` is past `aiming`. */
  lockedAim: number;
  /** The carry kept by the second press. Held for the replay marker and for tests. */
  lockedPower: number;
  fromX: number;
  fromY: number;
  /** Where the shot would come down with no fence in the way; folded on arrival. */
  freeToX: number;
  freeToY: number;
  flight: number;
  flightTime: number;
  rollFromX: number;
  rollFromY: number;
  rollDirX: number;
  rollDirY: number;
  rollDistance: number;
  rollSpeed: number;
  rollDuration: number;
  roll: number;
  p1Points: number;
  p2Points: number;
  p1Baskets: number;
  p2Baskets: number;
  p1Swishes: number;
  p2Swishes: number;
  p1Shots: number;
  p2Shots: number;
  lastOutcome: Outcome;
  lastPoints: number;
  winner: SeatId | 'draw' | null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Which way a seat's own half lies from the centre line: p1 below it, p2 above. */
export function halfSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

/** Who shoots in a possession. Alternates, starting with seat one. */
export function shooterOf(possession: number): SeatId {
  return possession % 2 === 1 ? 'p1' : 'p2';
}

/**
 * Whose half a point lies in.
 *
 * A ball resting exactly on the line is a held ball and goes to whoever was *not*
 * shooting, which is the one answer that survives the half-turn: mirroring the court swaps
 * the seats and leaves the line where it was, so both seats meet the same rule.
 */
export function halfOf(y: number, shooter: SeatId): SeatId {
  if (y > CENTRE_Y) return 'p1';
  if (y < CENTRE_Y) return 'p2';
  return otherOf(shooter);
}

/** The spot a fresh possession starts from: the top of that seat's own key. */
export function topOfKeyY(seat: SeatId): number {
  return CENTRE_Y + halfSign(seat) * ARC_RADIUS;
}

export function distanceToHoop(x: number, y: number): number {
  return Math.hypot(x - HOOP_X, y - HOOP_Y);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Reflect a coordinate back inside the fence as many times as it takes.
 *
 * The unfolding trick: bouncing between two walls is a triangle wave of the straight-line
 * position, so a whole flight or roll with any number of bounces in it is one closed-form
 * expression rather than a collision loop. Exact at any timestep, which is what lets a
 * roll be evaluated at a time rather than accumulated.
 */
export function foldInto(value: number, low: number, high: number): number {
  const span = high - low;
  if (span <= 0) return low;
  const period = span * 2;
  let offset = (value - low) % period;
  if (offset < 0) offset += period;
  return offset <= span ? low + offset : high - (offset - span);
}

/** Which way the same path is travelling once it has folded: +1 for even bounces, -1 for odd. */
export function foldDirection(value: number, low: number, high: number): number {
  const span = high - low;
  if (span <= 0) return 1;
  const period = span * 2;
  let offset = (value - low) % period;
  if (offset < 0) offset += period;
  return offset <= span ? 1 : -1;
}

/**
 * The unit direction a shot leaves on, for a given line.
 *
 * Built by rotating the unit vector *to the hoop*, never from an angle measured against
 * the court, so the same needle reading is the same shot from anywhere on the floor — and
 * so a mirrored court gives an exactly negated direction, with no `atan2` in between to
 * round the two apart. Writes into `out`; the bot calls it once a shot.
 */
export function shotDirection(out: Point, fromX: number, fromY: number, aim: number): Point {
  const dx = HOOP_X - fromX;
  const dy = HOOP_Y - fromY;
  const distance = Math.hypot(dx, dy);
  const unitX = distance > 1e-9 ? dx / distance : 0;
  const unitY = distance > 1e-9 ? dy / distance : 1;
  const cos = Math.cos(aim);
  const sin = Math.sin(aim);
  out.x = unitX * cos - unitY * sin;
  out.y = unitX * sin + unitY * cos;
  return out;
}

export function rangeOf(power: number): number {
  return MIN_RANGE + clamp(power, 0, 1) * (MAX_RANGE - MIN_RANGE);
}

/** The carry a shot from `distance` away needs, as a fraction of the gauge. */
export function powerFor(distance: number): number {
  return clamp((distance - MIN_RANGE) / (MAX_RANGE - MIN_RANGE), 0, 1);
}

const direction: Point = { x: 0, y: 0 };

/**
 * Where a shot at `aim` and `power` from a point comes down, fence bounces included.
 *
 * The exact thing the simulation will do, so the render can draw the landing marker as the
 * place the ball will actually be rather than as a bar whose number a player would have to
 * translate. Writes into `out`.
 */
export function landingOf(
  out: Point,
  fromX: number,
  fromY: number,
  aim: number,
  power: number,
): Point {
  shotDirection(direction, fromX, fromY, aim);
  const range = rangeOf(power);
  out.x = foldInto(fromX + direction.x * range, MIN_X, MAX_X);
  out.y = foldInto(fromY + direction.y * range, MIN_Y, MAX_Y);
  return out;
}

/** How a landing that far from the ring is judged. */
export function outcomeFor(gap: number): Outcome {
  if (gap <= SWISH_RADIUS) return 'swish';
  if (gap <= MOUTH_RADIUS) return 'basket';
  if (gap <= CLANG_RADIUS) return 'rim';
  return 'brick';
}

export function scored(outcome: Outcome): boolean {
  return outcome === 'swish' || outcome === 'basket';
}

export function pointsFor(outcome: Outcome): number {
  if (outcome === 'swish') return POINTS_SWISH;
  if (outcome === 'basket') return POINTS_BASKET;
  return 0;
}

export function createCourt(): Court {
  const court: Court = {
    ball: { x: HOOP_X, y: topOfKeyY('p1') },
    phase: 'ready',
    shooter: 'p1',
    possession: 1,
    shotsThisPossession: 0,
    hold: READY_SECONDS,
    aim: -AIM_SWEEP,
    aimRising: true,
    power: 0,
    powerRising: true,
    lockedAim: 0,
    lockedPower: 0,
    fromX: HOOP_X,
    fromY: topOfKeyY('p1'),
    freeToX: HOOP_X,
    freeToY: topOfKeyY('p1'),
    flight: 0,
    flightTime: 1,
    rollFromX: HOOP_X,
    rollFromY: topOfKeyY('p1'),
    rollDirX: 0,
    rollDirY: -1,
    rollDistance: 0,
    rollSpeed: 0,
    rollDuration: 0,
    roll: 0,
    p1Points: 0,
    p2Points: 0,
    p1Baskets: 0,
    p2Baskets: 0,
    p1Swishes: 0,
    p2Swishes: 0,
    p1Shots: 0,
    p2Shots: 0,
    lastOutcome: 'brick',
    lastPoints: 0,
    winner: null,
  };
  return court;
}

export function resetCourt(court: Court): void {
  court.possession = 1;
  court.shooter = shooterOf(1);
  court.shotsThisPossession = 0;
  court.p1Points = 0;
  court.p2Points = 0;
  court.p1Baskets = 0;
  court.p2Baskets = 0;
  court.p1Swishes = 0;
  court.p2Swishes = 0;
  court.p1Shots = 0;
  court.p2Shots = 0;
  court.lastOutcome = 'brick';
  court.lastPoints = 0;
  court.winner = null;
  court.ball.x = HOOP_X;
  court.ball.y = topOfKeyY(court.shooter);
  beginShot(court);
}

export function pointsOf(court: Readonly<Court>, seat: SeatId): number {
  return seat === 'p1' ? court.p1Points : court.p2Points;
}

export function basketsOf(court: Readonly<Court>, seat: SeatId): number {
  return seat === 'p1' ? court.p1Baskets : court.p2Baskets;
}

export function swishesOf(court: Readonly<Court>, seat: SeatId): number {
  return seat === 'p1' ? court.p1Swishes : court.p2Swishes;
}

export function shotsOf(court: Readonly<Court>, seat: SeatId): number {
  return seat === 'p1' ? court.p1Shots : court.p2Shots;
}

/**
 * Start a shot, with both needles parked and neither moving.
 *
 * The aim needle parks at one end of its sweep rather than in the middle: parked at zero
 * it would already be pointing at the ring on the step the freeze lifts, and an instant
 * press would be a free perfect line.
 */
function beginShot(court: Court): void {
  court.phase = 'ready';
  court.hold = READY_SECONDS;
  court.aim = -AIM_SWEEP;
  court.aimRising = true;
  court.power = 0;
  court.powerRising = true;
  court.lockedAim = 0;
  court.lockedPower = 0;
  court.flight = 0;
  court.roll = 0;
}

/**
 * Accept a press from the seat whose shot it is.
 *
 * The first keeps the line, the second keeps the carry and releases the ball. Returns
 * whether the press did anything, so a caller need not re-derive the phase.
 */
export function press(court: Court, seat: SeatId): boolean {
  if (seat !== court.shooter) return false;
  if (court.phase === 'aiming') {
    court.lockedAim = court.aim;
    court.phase = 'charging';
    return true;
  }
  if (court.phase === 'charging') {
    launch(court);
    return true;
  }
  return false;
}

function launch(court: Court): void {
  const seat = court.shooter;
  court.lockedPower = court.power;
  shotDirection(direction, court.ball.x, court.ball.y, court.lockedAim);
  const range = rangeOf(court.power);
  court.fromX = court.ball.x;
  court.fromY = court.ball.y;
  court.freeToX = court.fromX + direction.x * range;
  court.freeToY = court.fromY + direction.y * range;
  court.rollDirX = direction.x;
  court.rollDirY = direction.y;
  court.flight = 0;
  court.flightTime = FLIGHT_BASE + range / BALL_SPEED;
  court.phase = 'flying';
  court.shotsThisPossession += 1;
  if (seat === 'p1') court.p1Shots += 1;
  else court.p2Shots += 1;
}

export interface StepResult {
  /** Set on the step the ball came down. */
  readonly landed: boolean;
  readonly outcome: Outcome;
  readonly points: number;
  /** True on the step the ball came to rest. */
  readonly settled: boolean;
  /** True on the step the ball changed hands. */
  readonly handedOver: boolean;
}

const result = {
  landed: false,
  outcome: 'brick' as Outcome,
  points: 0,
  settled: false,
  handedOver: false,
};

/** How far through its flight the ball is, in [0, 1]. Presentation reads this; rules do not. */
export function flightProgress(court: Readonly<Court>): number {
  if (court.phase !== 'flying') return 0;
  return clamp(court.flight / court.flightTime, 0, 1);
}

/**
 * One fixed step. Allocates nothing; the result record is reused.
 *
 * **A phase takes only the part of the step it needs and hands the rest to the next one.**
 * That is what makes the simulation the same at 60, 90 and 120 Hz: consuming the whole step
 * whichever phase was running would end the ready freeze a fraction later on a slow device
 * than on a fast one, and the needle a player is reading when input reopens would be in a
 * different place on the two. Every boundary here lands where the clock says rather than on
 * the frame edge that happened to notice it, so the needles, the flight and the roll are all
 * closed forms of elapsed time. Only a *press* is quantised to a frame, and that is a
 * property of hands rather than of the simulation.
 */
export function step(court: Court, fixedDeltaSeconds: number): StepResult {
  result.landed = false;
  result.outcome = court.lastOutcome;
  result.points = 0;
  result.settled = false;
  result.handedOver = false;
  let remaining = fixedDeltaSeconds;
  // Bounded: a step crosses at most a handful of boundaries, and a phase that consumed
  // nothing must not be asked again for ever.
  for (let crossings = 0; crossings < 6; crossings += 1) {
    remaining -= advancePhase(court, remaining);
    if (remaining <= 0) break;
  }
  return result;
}

function flightPosition(court: Court): void {
  const travelled = clamp(court.flight / court.flightTime, 0, 1);
  court.ball.x = foldInto(court.fromX + (court.freeToX - court.fromX) * travelled, MIN_X, MAX_X);
  court.ball.y = foldInto(court.fromY + (court.freeToY - court.fromY) * travelled, MIN_Y, MAX_Y);
}

function rollPosition(court: Court): void {
  const elapsed = Math.min(court.roll, court.rollDuration);
  const travelled =
    court.roll >= court.rollDuration
      ? court.rollDistance
      : court.rollSpeed * elapsed - (ROLL_DECEL * elapsed * elapsed) / 2;
  court.ball.x = foldInto(court.rollFromX + court.rollDirX * travelled, MIN_X, MAX_X);
  court.ball.y = foldInto(court.rollFromY + court.rollDirY * travelled, MIN_Y, MAX_Y);
}

/** Run the current phase for at most `dt`, and report how much of it was actually used. */
function advancePhase(court: Court, dt: number): number {
  if (court.phase === 'over') return dt;

  if (court.phase === 'ready') {
    if (stillHolding(court.hold, dt)) {
      court.hold -= dt;
      return dt;
    }
    const used = court.hold;
    court.hold = 0;
    court.phase = 'aiming';
    return used;
  }

  if (court.phase === 'aiming') {
    const travel = (court.aimRising ? 1 : -1) * AIM_RATE * dt;
    court.aim = clamp(court.aim + travel, -AIM_SWEEP, AIM_SWEEP);
    if (court.aim >= AIM_SWEEP) court.aimRising = false;
    else if (court.aim <= -AIM_SWEEP) court.aimRising = true;
    return dt;
  }

  if (court.phase === 'charging') {
    const travel = (court.powerRising ? 1 : -1) * POWER_RATE * dt;
    court.power = clamp(court.power + travel, 0, 1);
    if (court.power >= 1) court.powerRising = false;
    else if (court.power <= 0) court.powerRising = true;
    return dt;
  }

  if (court.phase === 'flying') {
    const left = court.flightTime - court.flight;
    if (left > dt) {
      court.flight += dt;
      flightPosition(court);
      return dt;
    }
    court.flight = court.flightTime;
    flightPosition(court);
    // Returns whether the ball is already at rest: a make stops dead in the net, a miss
    // rolls. Read back rather than asked of `court.phase`, which the compiler has narrowed
    // to `'flying'` by this line and cannot see `resolveLanding` change.
    if (resolveLanding(court)) result.settled = true;
    result.landed = true;
    result.outcome = court.lastOutcome;
    result.points = court.lastPoints;
    return Math.max(0, left);
  }

  if (court.phase === 'rolling') {
    const left = court.rollDuration - court.roll;
    if (left > dt) {
      court.roll += dt;
      rollPosition(court);
      return dt;
    }
    court.roll = court.rollDuration;
    rollPosition(court);
    court.phase = 'settling';
    court.hold = SETTLE_SECONDS;
    result.settled = true;
    return Math.max(0, left);
  }

  if (stillHolding(court.hold, dt)) {
    court.hold -= dt;
    return dt;
  }
  court.hold = 0;
  if (advance(court)) result.handedOver = true;
  // **The one boundary that rounds up to a whole frame instead of handing its remainder on.**
  //
  // A flight and a roll last however long the arithmetic says, so a shot ends part way
  // through a step and everything after it inherits that fraction. Carried into the next
  // shot, the freeze would then lift part way through a step too, and the sweep a player is
  // reading would sit at a different offset against the frames on every shot — the same
  // press timing would be a different shot each time. Worse, the offset a seat inherited
  // came from *whoever shot last*, so a bot's play became a function of how its opponent had
  // been shooting, which is exactly the coupling `createBotRngs` exists to remove.
  //
  // Ending the settle on a frame edge costs at most one frame of a pause nobody is playing
  // during, and buys every shot in the match an identical needle. The remainder is dropped
  // only *between* shots: inside one, the freeze, the flight and the roll all still hand
  // their unused time on, which is what keeps them identical at 60 Hz and at 120 Hz.
  return dt;
}

/**
 * Judge the landing, and set the ball rolling if it missed.
 *
 * The ring is a real object: inside the mouth the ball goes through, and between the mouth
 * and the ring's outside it is thrown back out along the line from the hoop to the point
 * it struck. Nothing here is random — two players who take the same shot get the same
 * rebound, which is what makes "shade it short" a skill rather than a hope.
 */
function resolveLanding(court: Court): boolean {
  const gap = distanceToHoop(court.ball.x, court.ball.y);
  const outcome = outcomeFor(gap);
  court.lastOutcome = outcome;
  court.lastPoints = pointsFor(outcome);

  if (scored(outcome)) {
    if (court.shooter === 'p1') {
      court.p1Points += court.lastPoints;
      court.p1Baskets += 1;
      if (outcome === 'swish') court.p1Swishes += 1;
    } else {
      court.p2Points += court.lastPoints;
      court.p2Baskets += 1;
      if (outcome === 'swish') court.p2Swishes += 1;
    }
    court.ball.x = HOOP_X;
    court.ball.y = HOOP_Y;
    court.phase = 'settling';
    court.hold = SETTLE_SECONDS;
    return true;
  }

  const range = rangeOf(court.lockedPower);
  if (outcome === 'rim') {
    // Straight back out along the line from the ring to the strike. Short of the hoop that
    // line points at the shooter; long, it points away. That is the whole of the advice.
    const awayX = court.ball.x - HOOP_X;
    const awayY = court.ball.y - HOOP_Y;
    const length = Math.hypot(awayX, awayY);
    court.rollDirX = length > 1e-9 ? awayX / length : 0;
    court.rollDirY = length > 1e-9 ? awayY / length : 1;
    court.rollDistance = CLANG_ROLL_BASE + CLANG_ROLL_FACTOR * range;
  } else {
    // A ball that missed the ring never touched it, so it keeps the line it was on —
    // including whichever way round the fence has already turned it.
    court.rollDirX *= foldDirection(court.freeToX, MIN_X, MAX_X);
    court.rollDirY *= foldDirection(court.freeToY, MIN_Y, MAX_Y);
    court.rollDistance = BRICK_ROLL_FACTOR * range;
  }
  court.rollFromX = court.ball.x;
  court.rollFromY = court.ball.y;
  court.rollDuration = Math.sqrt((2 * court.rollDistance) / ROLL_DECEL);
  court.rollSpeed = ROLL_DECEL * court.rollDuration;
  court.roll = 0;
  court.phase = 'rolling';
  return false;
}

/**
 * Where the ball is taken from for the next shot, given where it stopped.
 *
 * Inside the take-back line it is carried straight back out along its own line, so a
 * rebound keeps the angle it came off the ring at; outside it, it is played where it lies.
 * Pure, and separate from `advance` so a test can ask the question without running a match.
 */
export function takeBack(out: Point, restX: number, restY: number): Point {
  const dx = restX - HOOP_X;
  const dy = restY - HOOP_Y;
  const distance = Math.hypot(dx, dy);
  if (distance >= ARC_RADIUS) {
    out.x = restX;
    out.y = restY;
    return out;
  }
  if (distance <= 1e-9) {
    out.x = HOOP_X;
    out.y = HOOP_Y + ARC_RADIUS;
    return out;
  }
  out.x = HOOP_X + (dx / distance) * ARC_RADIUS;
  out.y = HOOP_Y + (dy / distance) * ARC_RADIUS;
  return out;
}

/**
 * Whether the shooter keeps the ball.
 *
 * Three ways to lose it, and all three are visible on the floor: it went in, it stopped in
 * the other half, or the shot clock is out. Anything else is an offensive rebound.
 */
export function retainsPossession(court: Readonly<Court>): boolean {
  if (scored(court.lastOutcome)) return false;
  if (court.shotsThisPossession >= SHOTS_PER_POSSESSION) return false;
  return halfOf(court.ball.y, court.shooter) === court.shooter;
}

const spot: Point = { x: 0, y: 0 };

/** Hand the ball on, or set up the put-back. Returns whether the possession changed. */
function advance(court: Court): boolean {
  if (retainsPossession(court)) {
    takeBack(spot, court.ball.x, court.ball.y);
    court.ball.x = spot.x;
    court.ball.y = spot.y;
    beginShot(court);
    return false;
  }
  if (court.possession >= POSSESSIONS) {
    finish(court);
    return false;
  }
  court.possession += 1;
  court.shooter = shooterOf(court.possession);
  court.shotsThisPossession = 0;
  // A change of possession always restarts at the top of the key. Leaving the ball where
  // it stopped would let a seat aim a *miss* to strand the other one somewhere awkward,
  // which is a game that pays for bad shooting.
  court.ball.x = HOOP_X;
  court.ball.y = topOfKeyY(court.shooter);
  beginShot(court);
  return true;
}

/**
 * Points first, clean makes second.
 *
 * Both resolved through the SDK's `resolve` rather than by hand, so "highest when the
 * possessions run out" means here exactly what it means everywhere else and a level match
 * is a draw by the same definition. The second call is the tiebreak: two seats can reach
 * the same total with different shooting — three ordinary baskets and two swishes are both
 * six — and a swish is the thing the aim needle is actually being asked for.
 */
function finish(court: Court): void {
  court.phase = 'over';
  const byPoints = resolve(
    { kind: 'highest-when-time-expires' },
    { p1: court.p1Points, p2: court.p2Points },
    { timeExpired: true },
  );
  if (byPoints !== 'draw') {
    court.winner = byPoints;
    return;
  }
  court.winner = resolve(
    { kind: 'highest-when-time-expires' },
    { p1: court.p1Swishes, p2: court.p2Swishes },
    { timeExpired: true },
  );
}

export function winnerOf(court: Readonly<Court>): SeatId | 'draw' | null {
  return court.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the moment it meant to press it actually presses, in seconds. */
  readonly timing: number;
  /** How often one of the two presses is an outright fumble. */
  readonly blunder: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * That is the whole of the skill this game asks for, so it is the whole of what the tiers
 * differ in, and the numbers are seconds of human error rather than anything abstract: a
 * third of a second, a fifth, an eighth. The mouth is worth 0.080 s of press error at a
 * shot from the top of the key, so a tier's error runs from 1.6x that window to 3.7x it —
 * which is what puts the three of them at roughly a fifth, two fifths and seven tenths of
 * shots made. Every value is several frames wide, so rule 6 holds by construction: none of
 * these can stop a needle more finely than a person can, and none of them is told anything
 * that is not drawn on the floor.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.3, blunder: 0.16 },
  normal: { timing: 0.2, blunder: 0.08 },
  hard: { timing: 0.13, blunder: 0.03 },
});

/** How much larger a fumbled press's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 5;

export type BotStage = 'plan' | 'line' | 'range';

export interface BotState {
  /**
   * The line it wants, in radians, and the carry it wants, as a fraction of the gauge.
   *
   * Two fields and not one, because the two are quantities in different units and a single
   * shared `want` is exactly how a range needle comes to be stopped at the line's answer —
   * 0.07 radians read as 0.07 of the range gauge is a shot 480 units short of the ring.
   * `stage` is the other half of that guard.
   */
  wantAim: number;
  wantPower: number;
  /** Seconds of error committed to for each press, drawn separately: two presses, two hands. */
  aimOffset: number;
  powerOffset: number;
  /** Seconds of sweep left before the press it has already committed to. */
  lineTimer: number;
  rangeTimer: number;
  stage: BotStage;
}

export function createBotState(): BotState {
  return {
    wantAim: 0,
    wantPower: 0,
    aimOffset: 0,
    powerOffset: 0,
    lineTimer: 0,
    rangeTimer: 0,
    stage: 'plan',
  };
}

export function resetBotState(state: BotState): void {
  state.wantAim = 0;
  state.wantPower = 0;
  state.aimOffset = 0;
  state.powerOffset = 0;
  state.lineTimer = 0;
  state.rangeTimer = 0;
  state.stage = 'plan';
}

/**
 * One generator per seat, both drawn from the match's own before anything else touches it.
 *
 * A single shared stream is unbiased here only for reasons that are true of this game and
 * of nothing in general: only the seat shooting draws anything, and a shot costs exactly
 * {@link BOT_DRAWS_PER_SHOT} values. But possessions here can run to three shots or to one
 * depending on how the ball bounced, so the two seats do *not* sit on fixed residues of one
 * stream the way Cup Pong's do — seat two's draws would depend on how well seat one had
 * been shooting, and its play would become a function of its opponent's. A generator each
 * removes the coupling outright rather than relying on an accident of the turn order.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/**
 * Values a bot draws per shot. Always exactly this many, drawn before anything branches.
 *
 * A conditional draw count — one extra value only when there is a fumble — makes a seat's
 * stream depend on its own choices, and then on its opponent's through the shot count. Six
 * every time, fumble or not, keeps a seat's shots identical whoever it is playing.
 */
export const BOT_DRAWS_PER_SHOT = 6;

/**
 * Choose the shot, once, at the start of it.
 *
 * It wants the middle of the ring, always: there is one hoop and no choice of target, so
 * the only question is how well the two needles are stopped. Everything it reads — where
 * the ball is lying and where the ring is — is drawn on the floor in front of both players.
 */
export function planShot(
  court: Readonly<Court>,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const aimRollA = rng.float();
  const aimRollB = rng.float();
  const powerRollA = rng.float();
  const powerRollB = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  state.wantAim = 0;
  state.wantPower = powerFor(distanceToHoop(court.ball.x, court.ball.y));
  // Two draws a needle, summed: the press error is triangular rather than flat, so most
  // presses land near the mark and a bad one is rare. Flat, the ladder has almost nowhere
  // to stand — a flat error either fits inside the mouth or it does not, with nothing in
  // between. It is also the better picture of a person: mostly close, occasionally nowhere.
  state.aimOffset = (aimRollA + aimRollB - 1) * profile.timing;
  state.powerOffset = (powerRollA + powerRollB - 1) * profile.timing;
  if (blunderRoll < profile.blunder) {
    // One roll decides both which press is fumbled and by how much — the low bit picks the
    // needle, the rest the size — so a fumble costs the same one draw as no fumble at all.
    const slip = (((blunderSize * 2) % 1) * 2 - 1) * profile.timing * BLUNDER_SCALE;
    if (blunderSize < 0.5) state.aimOffset += slip;
    else state.powerOffset += slip;
  }
  // Both needles start from a known end of their own gauge, so the moment a needle will be
  // at a wanted value is arithmetic rather than a search — and committing to a *moment*
  // rather than to a position is what stops the bot deadlocking. See `driveBot`.
  state.lineTimer = (state.wantAim + AIM_SWEEP) / AIM_RATE + state.aimOffset;
  state.stage = 'line';
}

/**
 * Run a bot for one step: plan if it has not, then press when the moment it chose arrives.
 *
 * **It counts down to a moment; it does not watch for a position.** Watching for a position
 * is the obvious way to write this and it hangs: the error is added in whichever direction
 * the needle happens to be going, so an error larger than the gauge is out of reach *both*
 * ways — the needle turns round at the end of its sweep and the wanted value turns round
 * with it, and the two never meet. A countdown cannot fail to expire, which is what makes
 * the termination guarantee a fact rather than a hope; it is also the more honest model,
 * since a person commits to a moment and pressing late enough that the needle has turned
 * round is a real way to miss.
 */
export function driveBot(
  court: Court,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (court.shooter !== seat) return false;

  if (court.phase === 'aiming' && state.stage === 'plan') {
    planShot(court, difficulty, state, rng);
  }

  if (court.phase === 'aiming' && state.stage === 'line') {
    if (state.lineTimer > fixedDeltaSeconds / 2) {
      state.lineTimer -= fixedDeltaSeconds;
      return false;
    }
    // The range needle takes its first step in the same step this press is taken, so its
    // clock starts one step ahead of the line's.
    state.rangeTimer = state.wantPower / POWER_RATE + state.powerOffset - fixedDeltaSeconds;
    // Cleared on the press. `wantAim` is radians and `rangeTimer` above divides a gauge
    // fraction by a gauge rate; leaving the line's answer standing in a field the range
    // press reads is how the second needle ends up stopped at the first one's number.
    state.wantAim = 0;
    state.aimOffset = 0;
    state.lineTimer = 0;
    state.stage = 'range';
    return press(court, seat);
  }

  if (court.phase === 'charging' && state.stage === 'range') {
    if (state.rangeTimer > fixedDeltaSeconds / 2) {
      state.rangeTimer -= fixedDeltaSeconds;
      return false;
    }
    state.wantPower = 0;
    state.powerOffset = 0;
    state.rangeTimer = 0;
    state.stage = 'plan';
    return press(court, seat);
  }

  return false;
}
