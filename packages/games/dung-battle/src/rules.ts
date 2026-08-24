import { set } from '@duelbox/engine';
import type { Rng, SeatId, Vec2 } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Dung Battle, as pure rules.
 *
 * One heavy ball in an open pit. Both beetles want it in their OWN base, and the two bases
 * are at opposite ends — so the two players want the same object moved in opposite
 * directions, and there is nothing to defend but the ball itself. Four ladybugs circle the
 * ball at arm's length and flip any beetle they touch onto its back, which is the whole of
 * "don't get too close to ladybugs": the ball is inside their ring, and getting to it means
 * crossing the ring.
 *
 * No rendering, no wall clock, no DOM. The game, the bots and the measurement harness all
 * drive this file, so what the harness counts is what a player feels.
 *
 * ## The coordinates are centred on the middle of the pit, and that is load-bearing
 *
 * Every position here is in logical units on `[-ARENA_HALF, ARENA_HALF]` in both axes,
 * **not** on `[0, 800]`. The render layer adds {@link ARENA_HALF} to each axis and is the
 * only place the box's corner is ever named.
 *
 * The reason is exactness. The two seats are mirror images of each other through the middle
 * of the pit, and mirroring about a *corner* — `x -> 800 - x` — is not an exact operation in
 * binary floating point: two states that ought to be reflections of one another drift apart
 * in the last bits and a bare comparison then hands a round to whichever side of the board
 * the rounding fell on. Beach Ball and Spin War both paid for that and both settled for a
 * tolerance. Mirroring about **zero** is a sign flip, which IEEE-754 does exactly, so here
 * the reflection survives every step: `rules.test.ts` mirrors a whole match — deliveries,
 * scoring and all — and asserts equality **to the bit**, not to six places. (The one caveat
 * is the sign of zero, which a mirror does flip and which `===` correctly calls equal.)
 */

/** Half the pit, so the pit is 800 x 800 logical units and the middle is (0, 0). */
export const ARENA_HALF = 400;

/**
 * The beetle, the ball, and the bug.
 *
 * Sized against each other rather than copied from a sibling. The beetle is deliberately the
 * *smallest* of the three: it has to cross a ring of four ladybugs to reach the ball, and
 * four bugs on a ring of radius 175 leave gaps a 68-unit beetle has to time rather than
 * barge through. The ball is the biggest thing in the pit because it is the thing both
 * players are looking at, and because a ball smaller than a beetle disappears under one.
 */
export const BEETLE_RADIUS = 34;
export const BALL_RADIUS = 40;
export const LADYBUG_RADIUS = 22;

/** Contact distances, named because three different rules test them. */
export const BEETLE_BALL_TOUCH = BEETLE_RADIUS + BALL_RADIUS;
export const BEETLE_BUG_TOUCH = BEETLE_RADIUS + LADYBUG_RADIUS;

/**
 * A base: a disc centred on the middle of a seat's own wall. p1's is at `(0, +ARENA_HALF)`,
 * which is the bottom of the device and therefore the near seat's end.
 *
 * 150 is chosen from what it leaves reachable rather than from how it looks. A ball can
 * never get nearer a wall than its own radius, so the delivery window is the chord of the
 * base circle at 40 units in: `2 * sqrt(150^2 - 40^2)` = **289 units wide**, or 36 per cent
 * of that wall. Wide enough to hit under pressure, narrow enough that a shove aimed roughly
 * at the right end does not score by itself. The ball has to travel `400 - 150` = 250 units
 * from the middle of the pit to reach it.
 */
export const BASE_RADIUS = 150;

/** Where each seat's base sits. x is always 0; only the sign of y differs. */
export function baseYOf(seat: SeatId): number {
  return seat === 'p1' ? ARENA_HALF : -ARENA_HALF;
}

/**
 * How fast a beetle runs, in logical units a second.
 *
 * 300 crosses the pit in 2.7 seconds and covers the 250 units from the middle to the lip of
 * a base in 0.83, so a clean breakaway is quick but not instant. It is a
 * *kinematic* speed: a beetle has no momentum of its own and stops the instant you let go,
 * which is what makes threading a gap between two ladybugs a matter of timing rather than of
 * braking distance.
 */
export const BEETLE_SPEED = 300;

/**
 * How quickly a loose ball gives up, as a decay RATE in 1/s.
 *
 * Velocity is multiplied by `e^(-BALL_DRAG * dt)` and the position uses the matching
 * analytic integral, so two steps of `h` and one step of `2h` land on identical numbers.
 * A forward-Euler `x += v * dt` after a decay overshoots that integral, which would both
 * make a 144 Hz laptop play a different match from a 60 Hz phone and put the bot's own
 * distance arithmetic out of step with the pit it is aiming in.
 *
 * At 1.6, a ball leaving a beetle at 345 units/s rolls `345 / 1.6` = **216 units** and stops.
 * That is a quarter of the pit for one shove: enough that a good push is worth making, short
 * enough that the ball has to be shepherded rather than hit once and watched.
 */
export const BALL_DRAG = 1.6;

/**
 * How much faster than the beetle the ball leaves a shove.
 *
 * Above one, or the ball would never separate from the beetle pushing it and the two would
 * travel locked together — which reads as carrying, and this game does not have carrying.
 * At 1.15 a full-speed shove sends the ball off at 345 against the beetle's 300, so it draws
 * ahead, slows below 300 within a tenth of a second, and gets caught and shoved again. The
 * dribble a player actually performs is that cycle, not a hold.
 */
export const PUSH_RATIO = 1.15;

/**
 * How much of a beetle's *sideways* motion the ball takes on while they are touching.
 *
 * The shell has grip, so a beetle that walks across the ball rolls it rather than sliding
 * off it — and that is the move that breaks a deadlock. Two beetles pressing the ball from
 * opposite sides cancel each other exactly: the shoves are equal and opposite, the ball
 * stops dead, and neither can win by pressing harder. Without grip that position is stable,
 * and it was — bot matches piled up in the middle of the pit and a quarter of them expired
 * on the clock at level scores. With it, the way out of a squeeze is to walk *across* the
 * ball and roll it out sideways, which is both a technique a player can learn and the reason
 * the middle of the pit is never a safe place to stand.
 *
 * 0.55 rather than 1: the ball slips as well as rolls, so a sideways walk steers it without
 * carrying it, and there is still no way to hold it.
 */
export const GRIP = 0.55;

/**
 * Ceiling on the ball's speed, applied to the velocity a step STARTS with.
 *
 * Both beetles can shove in the same step and the two contributions add, so without a cap
 * the ball could leave a double shove at twice the shove speed. 700 units/s is 11.7 units in
 * one 60 Hz step against a contact distance of 74, so no shove can carry the ball through a
 * beetle between two discrete tests.
 */
export const MAX_BALL_SPEED = 700;

/** How much of its speed the ball keeps off a wall. Low: this is a pit floor, not a table. */
export const WALL_BOUNCE = 0.45;

/**
 * Share of an overlap the ball gives up when a beetle is standing in it.
 *
 * The remainder pushes the beetle back, which is what stops a beetle walking through the
 * ball, and what makes two beetles pressing from opposite sides a genuine squeeze rather
 * than a race between two position writes.
 */
export const BALL_SHARE = 0.62;

/**
 * The ladybugs.
 *
 * They circle the ball at {@link SHY_RADIUS}, at a limited turn rate, and that single rule is
 * the whole behaviour. It puts the danger where the game is without putting it *on* the ball:
 * the ring travels with the ball, so wherever play settles is ringed within a second or two,
 * and a ball that is shoved hard leaves its escort behind for as long as it is rolling.
 *
 * 165 units/s is 55 per cent of a beetle, so a beetle can always outrun one — being chased is
 * never hopeless — and 1.15 rad/s gives a turning circle of `165 / 1.15` = **143 units**, so
 * a bug cannot hold the ring exactly and drifts across it, which is what stops the ring being
 * a fence with fixed gates.
 *
 * Four of them, in two mirror pairs — and the count turns out to be a **weak** lever rather
 * than a balance knob: two, four and six measured 3.4, 3.8 and 3.7 deliveries a match and
 * ladders within a few points of each other. Four is chosen because it is an even number (the
 * pairs) and because it reads on screen as a ring rather than as a crowd.
 */
export const LADYBUG_COUNT = 4;
export const LADYBUG_SPEED = 165;
export const LADYBUG_TURN = 1.15;

/**
 * Seconds a beetle spends on its back, and how hard it is skidded away.
 *
 * 1.2 seconds costs 360 units of running, which is further than the ball has to travel from
 * the middle of the pit to a base — so one mistimed crossing is one delivery you do not
 * contest. The skid exists so a bug cannot park on top of a flipped beetle and flip it again
 * the instant it rights itself: 260 units/s against a decay of 5/s carries it 52 units, from
 * the 56 it was caught at to about 108, clear of the bug that caught it.
 *
 * Measured: a beetle spends between a fifth and a third of a match on its back, depending on
 * how well it is played.
 */
export const STUN_SECONDS = 1.2;
export const KNOCKBACK_SPEED = 260;
export const KNOCKBACK_DRAG = 5;

/** Deliveries that win a match, and the clock that ends it whatever the score. */
export const TARGET_DELIVERIES = 3;
export const MATCH_SECONDS = 60;

/**
 * The pause after a delivery and before the first move, counted in STEPS.
 *
 * Delays are counted in steps rather than seconds so that a residue of a sixtieth cannot
 * leave a pause one frame longer than it was asked for — the shape that made Basketball's
 * half-second freeze take 31 frames. The step count is derived from the seconds the design
 * wants and the step size in hand ({@link stepsFor}), so a 120 Hz simulation pauses for the
 * same fraction of a second rather than for half as long.
 */
export const HOLD_SECONDS = 0.35;
export const KICKOFF_SECONDS = 0.5;

/**
 * How long a delivered ball is left sitting in the base before the next kick-off.
 *
 * It is left **where it landed**, and that is not decoration. A ball snatched back to the
 * middle on the same step it scored is a point that appears on the HUD without anything
 * visible having happened, and it is also unobservable from outside the game: the only
 * evidence a delivery took place would be the counter that claims it did. Leaving the ball
 * in the base for two-thirds of a second means a player sees the delivery and a harness can
 * reconstruct it from sampled positions, without asking the game whether it happened — which
 * is exactly how the delivery counts in SPEC.md were taken.
 */
export const CELEBRATE_SECONDS = 0.65;

/**
 * Where each beetle stands at a kick-off: on its own side, facing the ball.
 *
 * 250 rather than anything nearer, so that a beetle on its mark is **outside the ring** —
 * the bugs hold {@link SHY_RADIUS} = 175 around a ball that starts in the middle, and they
 * flip at 56, so anything inside 231 begins the round already in danger. At 205 both beetles
 * were, which is symmetric and therefore fair and still the wrong way to start a round: a
 * match nobody plays was flipping both of them fourteen times over.
 */
export const START_OFFSET = 250;

/** How far out the bugs are dealt: past 250 + 56, so none is dealt onto a beetle's mark. */
export const LADYBUG_RING_MIN = 310;
export const LADYBUG_RING_MAX = 375;

/** The win condition, declared once so no comparison is ever written by hand. */
export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_DELIVERIES };

/** A whole number of steps for a delay expressed in seconds. Never less than one. */
export function stepsFor(seconds: number, fixedDeltaSeconds: number): number {
  if (!(fixedDeltaSeconds > 0)) return 1;
  const steps = Math.round(seconds / fixedDeltaSeconds);
  return steps < 1 ? 1 : steps;
}

export interface Beetle {
  x: number;
  y: number;
  /**
   * The velocity the beetle actually realised over the last step — displacement over dt,
   * *after* the walls have had their say.
   *
   * Taken from the realised displacement rather than from the intent, so a beetle pressed
   * into a wall is not credited with a shove it never made.
   */
  vx: number;
  vy: number;
  /** Skid velocity while it is on its back. Zero at every other time. */
  kx: number;
  ky: number;
  /** Steps left on its back. Zero means it is on its feet. */
  stun: number;
  /** Unit heading it last moved in. Presentation only: no rule reads it. */
  faceX: number;
  faceY: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Ladybug {
  x: number;
  y: number;
  /** Unit heading. Kept normalised every step so a thousand turns cannot lengthen it. */
  hx: number;
  hy: number;
}

export type Phase = 'kickoff' | 'live' | 'celebrate' | 'over';

export interface Game {
  readonly p1: Beetle;
  readonly p2: Beetle;
  readonly ball: Ball;
  /**
   * The bugs, in **mirror pairs**: bug `2i + 1` is bug `2i` reflected through the middle of
   * the pit, heading included. See {@link placeLadybugs} for why.
   */
  readonly bugs: Ladybug[];
  readonly score: { p1: number; p2: number };
  phase: Phase;
  /** Seconds left in the match. Ticks in every phase, including the pauses. */
  clock: number;
  /** Steps left of the kick-off pause. */
  hold: number;
  /**
   * Seconds of pause asked for but not yet sized, or zero.
   *
   * A pause is counted in steps, and only `step` knows how long a step is — `init` is
   * handed no step size at all. So a kick-off records the seconds it wants and the first
   * step of the pause turns them into a whole number of steps. Without it the opening pause
   * would be the one delay in the game whose length depended on the loop's rate, which is
   * exactly the class of thing a fixed timestep exists to rule out.
   */
  pending: number;
  /** Who delivered last. Presentation only. */
  scorer: SeatId | null;
  winner: SeatId | 'draw' | null;
}

export function beetleOf(game: Readonly<Game>, seat: SeatId): Beetle {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function scoreOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.score.p1 : game.score.p2;
}

function makeBeetle(): Beetle {
  return { x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, stun: 0, faceX: 0, faceY: 1 };
}

/** Allocates. Setup only. */
export function createGame(rng: Rng): Game {
  const bugs: Ladybug[] = [];
  for (let i = 0; i < LADYBUG_COUNT; i += 1) bugs.push({ x: 0, y: 0, hx: 1, hy: 0 });
  const game: Game = {
    p1: makeBeetle(),
    p2: makeBeetle(),
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    bugs,
    score: { p1: 0, p2: 0 },
    phase: 'kickoff',
    clock: MATCH_SECONDS,
    hold: 0,
    pending: KICKOFF_SECONDS,
    scorer: null,
    winner: null,
  };
  resetGame(game, rng);
  return game;
}

/** A fresh match: score, clock, bugs and marks. */
export function resetGame(game: Game, rng: Rng): void {
  game.score.p1 = 0;
  game.score.p2 = 0;
  game.clock = MATCH_SECONDS;
  game.scorer = null;
  game.winner = null;
  placeLadybugs(game, rng);
  kickOff(game, KICKOFF_SECONDS);
}

/**
 * Deal the ladybugs, in mirror pairs.
 *
 * Two draws a pair — an angle and a radius — and the second bug of each pair is the first
 * reflected through the middle of the pit, heading included. That is what lets the game
 * answer "was one player's pit kinder?" before anybody moves: the whole board at kick-off is
 * **invariant** under a half-turn plus a seat swap, so the two seats are looking at the same
 * arrangement from opposite ends. It stays that way for the rest of the match too, because
 * reflection commutes with everything a bug does — homing on a reflected ball, turning at a
 * capped rate, bouncing off a wall of a pit that is itself symmetric.
 *
 * The bugs start tangentially, which sets them looping rather than diving straight in.
 */
export function placeLadybugs(game: Game, rng: Rng): void {
  for (let pair = 0; pair * 2 < game.bugs.length; pair += 1) {
    const angle = rng.float() * Math.PI * 2;
    const radius = LADYBUG_RING_MIN + rng.float() * (LADYBUG_RING_MAX - LADYBUG_RING_MIN);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    // Tangential, so a bug arrives at the ball on a curve instead of head-on.
    const hx = -Math.sin(angle);
    const hy = Math.cos(angle);
    const first = game.bugs[pair * 2];
    if (first !== undefined) {
      first.x = x;
      first.y = y;
      first.hx = hx;
      first.hy = hy;
    }
    const second = game.bugs[pair * 2 + 1];
    if (second !== undefined) {
      second.x = -x;
      second.y = -y;
      second.hx = -hx;
      second.hy = -hy;
    }
  }
}

/** Ball in the middle, beetles on their marks, everybody on their feet. */
export function kickOff(game: Game, seconds: number = HOLD_SECONDS): void {
  game.ball.x = 0;
  game.ball.y = 0;
  game.ball.vx = 0;
  game.ball.vy = 0;
  placeBeetle(game.p1, 0, START_OFFSET, 0, -1);
  placeBeetle(game.p2, 0, -START_OFFSET, 0, 1);
  game.phase = 'kickoff';
  game.hold = 0;
  game.pending = seconds;
}

function placeBeetle(beetle: Beetle, x: number, y: number, faceX: number, faceY: number): void {
  beetle.x = x;
  beetle.y = y;
  beetle.vx = 0;
  beetle.vy = 0;
  beetle.kx = 0;
  beetle.ky = 0;
  beetle.stun = 0;
  beetle.faceX = faceX;
  beetle.faceY = faceY;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Move one beetle for one step, driven towards `(driveX, driveY)`.
 *
 * The drive is a direction, not a speed: anything longer than the unit circle is rescaled,
 * so a diagonal is no quicker than a straight line and a gently-held analogue source keeps
 * its gentleness. A beetle on its back ignores the drive entirely and coasts on its skid,
 * which decays analytically for the same reason the ball's does.
 */
export function driveBeetle(
  beetle: Beetle,
  driveX: number,
  driveY: number,
  fixedDeltaSeconds: number,
): void {
  const fromX = beetle.x;
  const fromY = beetle.y;

  if (beetle.stun > 0) {
    beetle.stun -= 1;
    const decay = Math.exp(-KNOCKBACK_DRAG * fixedDeltaSeconds);
    const travel = (1 - decay) / KNOCKBACK_DRAG;
    beetle.x += beetle.kx * travel;
    beetle.y += beetle.ky * travel;
    beetle.kx *= decay;
    beetle.ky *= decay;
  } else {
    beetle.kx = 0;
    beetle.ky = 0;
    let dirX = driveX;
    let dirY = driveY;
    const lengthSq = dirX * dirX + dirY * dirY;
    if (lengthSq > 1) {
      const inv = 1 / Math.sqrt(lengthSq);
      dirX *= inv;
      dirY *= inv;
    }
    beetle.x += dirX * BEETLE_SPEED * fixedDeltaSeconds;
    beetle.y += dirY * BEETLE_SPEED * fixedDeltaSeconds;
    if (lengthSq > 0) {
      const inv = 1 / Math.sqrt(lengthSq);
      beetle.faceX = driveX * inv;
      beetle.faceY = driveY * inv;
    }
  }

  const limit = ARENA_HALF - BEETLE_RADIUS;
  beetle.x = clamp(beetle.x, -limit, limit);
  beetle.y = clamp(beetle.y, -limit, limit);

  if (fixedDeltaSeconds > 0) {
    beetle.vx = (beetle.x - fromX) / fixedDeltaSeconds;
    beetle.vy = (beetle.y - fromY) / fixedDeltaSeconds;
  } else {
    beetle.vx = 0;
    beetle.vy = 0;
  }
}

/**
 * The velocity one beetle's contact adds to the ball, written into `out`.
 *
 * A velocity **target**, never a repeated shove. A shove applied on every overlapping step
 * is applied sixty times a second for as long as the pair stay touching, which is both sixty
 * times its own size and a different game at a different step rate; a target stops applying
 * the moment the ball is already leaving that fast. This is the one place in the file where
 * that distinction is easy to get wrong, and Spin War got it wrong first.
 *
 * Reads only the state passed in, so both beetles' contributions can be computed from the
 * same pre-contact state and then added. That is what makes a two-sided squeeze independent
 * of which seat is looked at first.
 */
export function pushDelta(beetle: Readonly<Beetle>, ball: Readonly<Ball>, out: Vec2): Vec2 {
  const dx = ball.x - beetle.x;
  const dy = ball.y - beetle.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= BEETLE_BALL_TOUCH) return set(out, 0, 0);

  let nx: number;
  let ny: number;
  if (distance > 0) {
    nx = dx / distance;
    ny = dy / distance;
  } else {
    // Dead centre of the ball, which separation makes practically unreachable. Shove along
    // the way the beetle is travelling; a beetle that is not travelling shoves nothing.
    const speed = Math.hypot(beetle.vx, beetle.vy);
    if (speed === 0) return set(out, 0, 0);
    nx = beetle.vx / speed;
    ny = beetle.vy / speed;
  }

  const approach = beetle.vx * nx + beetle.vy * ny;
  // Retreating: the shell is not touching the ball in any way it can act through.
  if (approach < 0) return set(out, 0, 0);

  let deltaX = 0;
  let deltaY = 0;

  // The shove, along the line between the two centres.
  const target = approach * PUSH_RATIO;
  const along = ball.vx * nx + ball.vy * ny;
  if (along < target) {
    const gain = target - along;
    deltaX += nx * gain;
    deltaY += ny * gain;
  }

  // The grip, across it. Also a target rather than a shove, and it only ever adds motion the
  // way the beetle is sliding — a shell cannot pull a ball backwards.
  const tangentX = -ny;
  const tangentY = nx;
  const slide = (beetle.vx * tangentX + beetle.vy * tangentY) * GRIP;
  const across = ball.vx * tangentX + ball.vy * tangentY;
  if ((slide > 0 && across < slide) || (slide < 0 && across > slide)) {
    const gain = slide - across;
    deltaX += tangentX * gain;
    deltaY += tangentY * gain;
  }

  return set(out, deltaX, deltaY);
}

const pushA: Vec2 = { x: 0, y: 0 };
const pushB: Vec2 = { x: 0, y: 0 };

/** Both shoves, computed from one pre-contact state and applied together. */
export function pushBall(game: Game): void {
  pushDelta(game.p1, game.ball, pushA);
  pushDelta(game.p2, game.ball, pushB);
  const ball = game.ball;
  ball.vx += pushA.x + pushB.x;
  ball.vy += pushA.y + pushB.y;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > MAX_BALL_SPEED) {
    const trim = MAX_BALL_SPEED / speed;
    ball.vx *= trim;
    ball.vy *= trim;
  }
}

/** Roll the ball for one step, and bounce it off the pit wall. */
export function stepBall(ball: Ball, fixedDeltaSeconds: number): void {
  const decay = Math.exp(-BALL_DRAG * fixedDeltaSeconds);
  const travel = (1 - decay) / BALL_DRAG;
  ball.x += ball.vx * travel;
  ball.y += ball.vy * travel;
  ball.vx *= decay;
  ball.vy *= decay;

  const limit = ARENA_HALF - BALL_RADIUS;
  if (ball.x < -limit) {
    ball.x = -limit;
    ball.vx = -ball.vx * WALL_BOUNCE;
  } else if (ball.x > limit) {
    ball.x = limit;
    ball.vx = -ball.vx * WALL_BOUNCE;
  }
  if (ball.y < -limit) {
    ball.y = -limit;
    ball.vy = -ball.vy * WALL_BOUNCE;
  } else if (ball.y > limit) {
    ball.y = limit;
    ball.vy = -ball.vy * WALL_BOUNCE;
  }
}

/**
 * Steer one ladybug at a point and move it, turning no faster than {@link LADYBUG_TURN}.
 *
 * All vector arithmetic: no `atan2` anywhere, because `atan2` of a reflected pair is not the
 * reflection of `atan2` — it is that value minus pi, which is not representable — and the
 * bit-exact mirror property would go with it.
 */
export function steerLadybug(
  bug: Ladybug,
  towardX: number,
  towardY: number,
  fixedDeltaSeconds: number,
): void {
  const dx = towardX - bug.x;
  const dy = towardY - bug.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 0) {
    const wantX = dx / distance;
    const wantY = dy / distance;
    const facing = clamp(bug.hx * wantX + bug.hy * wantY, -1, 1);
    const side = bug.hx * wantY - bug.hy * wantX;
    const most = LADYBUG_TURN * fixedDeltaSeconds;
    const wanted = Math.acos(facing);
    const turn = (wanted < most ? wanted : most) * (side < 0 ? -1 : 1);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const hx = bug.hx * cos - bug.hy * sin;
    const hy = bug.hx * sin + bug.hy * cos;
    const length = Math.hypot(hx, hy);
    if (length > 0) {
      bug.hx = hx / length;
      bug.hy = hy / length;
    }
  }

  bug.x += bug.hx * LADYBUG_SPEED * fixedDeltaSeconds;
  bug.y += bug.hy * LADYBUG_SPEED * fixedDeltaSeconds;

  const limit = ARENA_HALF - LADYBUG_RADIUS;
  if (bug.x < -limit) {
    bug.x = -limit;
    bug.hx = -bug.hx;
  } else if (bug.x > limit) {
    bug.x = limit;
    bug.hx = -bug.hx;
  }
  if (bug.y < -limit) {
    bug.y = -limit;
    bug.hy = -bug.hy;
  } else if (bug.y > limit) {
    bug.y = limit;
    bug.hy = -bug.hy;
  }
}

/**
 * How far out the bugs ring the ball.
 *
 * The number that decides what the hazard *is*. At 175 against a flip distance of 56, the
 * pocket around the ball is clear to a radius of 119 — and a beetle touching the ball stands
 * 74 out, so **the ball itself is a safe place to be** and the ring is what you have to get
 * through to reach it. That is the shape the observed rule describes: the danger is in
 * approaching, not in playing.
 *
 * The first version had no ring at all — the bugs homed straight at the ball, so the danger
 * sat exactly on top of the thing both players had to touch and being flipped was a coin
 * toss rather than a mistake. The ring did not make care *pay* — swept as a bot knob,
 * caution measures flat either way, and the numbers are under {@link BotProfile} — but it is
 * the difference between a hazard a player can read and one that simply happens to them.
 */
export const SHY_RADIUS = 175;

/** Every bug steers at the nearest point of the ring, so the ring follows the ball. */
export function stepLadybugs(game: Game, fixedDeltaSeconds: number): void {
  for (const bug of game.bugs) {
    const dx = bug.x - game.ball.x;
    const dy = bug.y - game.ball.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) {
      steerLadybug(bug, game.ball.x, game.ball.y, fixedDeltaSeconds);
      continue;
    }
    steerLadybug(
      bug,
      game.ball.x + (dx / distance) * SHY_RADIUS,
      game.ball.y + (dy / distance) * SHY_RADIUS,
      fixedDeltaSeconds,
    );
  }
}

/**
 * Undo every overlap, sharing each one out and applying the lot together.
 *
 * Accumulated first and applied second, rather than resolved pair by pair, because a ball
 * squeezed between two beetles is resolved twice in one step: pair-at-a-time, the second
 * correction is computed from a position the first has already moved, and the ball ends up
 * offset towards whichever seat was looked at last. That is a seat bias made of nothing but
 * evaluation order, and it is invisible until somebody measures win rates.
 */
export function separate(game: Game): void {
  let ballDX = 0;
  let ballDY = 0;
  let p1DX = 0;
  let p1DY = 0;
  let p2DX = 0;
  let p2DY = 0;

  const ball = game.ball;
  for (const seat of SEATS) {
    const beetle = beetleOf(game, seat);
    const dx = ball.x - beetle.x;
    const dy = ball.y - beetle.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0 || distance >= BEETLE_BALL_TOUCH) continue;
    const depth = BEETLE_BALL_TOUCH - distance;
    const nx = dx / distance;
    const ny = dy / distance;
    ballDX += nx * depth * BALL_SHARE;
    ballDY += ny * depth * BALL_SHARE;
    const back = depth * (1 - BALL_SHARE);
    if (seat === 'p1') {
      p1DX -= nx * back;
      p1DY -= ny * back;
    } else {
      p2DX -= nx * back;
      p2DY -= ny * back;
    }
  }

  const dx = game.p2.x - game.p1.x;
  const dy = game.p2.y - game.p1.y;
  const gap = Math.hypot(dx, dy);
  const touch = BEETLE_RADIUS * 2;
  if (gap > 0 && gap < touch) {
    const depth = (touch - gap) / 2;
    const nx = dx / gap;
    const ny = dy / gap;
    p2DX += nx * depth;
    p2DY += ny * depth;
    p1DX -= nx * depth;
    p1DY -= ny * depth;
  }

  const ballLimit = ARENA_HALF - BALL_RADIUS;
  ball.x = clamp(ball.x + ballDX, -ballLimit, ballLimit);
  ball.y = clamp(ball.y + ballDY, -ballLimit, ballLimit);
  const beetleLimit = ARENA_HALF - BEETLE_RADIUS;
  game.p1.x = clamp(game.p1.x + p1DX, -beetleLimit, beetleLimit);
  game.p1.y = clamp(game.p1.y + p1DY, -beetleLimit, beetleLimit);
  game.p2.x = clamp(game.p2.x + p2DX, -beetleLimit, beetleLimit);
  game.p2.y = clamp(game.p2.y + p2DY, -beetleLimit, beetleLimit);
}

export const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * Flip any beetle a ladybug has caught, and skid it clear.
 *
 * A beetle already on its back cannot be caught again, which is not a mercy rule so much as
 * the alternative to an infinite one: a bug sitting on a flipped beetle would otherwise
 * re-flip it on every single step and the beetle would never get up. The skid is what
 * carries it out of the bug's reach so that the next flip has to be earned.
 *
 * Both seats are tested against the same bugs before either is written, so the order the
 * seats are checked in cannot matter.
 */
export function flipCaught(game: Game, fixedDeltaSeconds: number): void {
  for (const seat of SEATS) {
    const beetle = beetleOf(game, seat);
    if (beetle.stun > 0) continue;
    for (const bug of game.bugs) {
      const dx = beetle.x - bug.x;
      const dy = beetle.y - bug.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= BEETLE_BUG_TOUCH) continue;
      beetle.stun = stepsFor(STUN_SECONDS, fixedDeltaSeconds);
      let nx = bug.hx;
      let ny = bug.hy;
      if (distance > 0) {
        nx = dx / distance;
        ny = dy / distance;
      }
      beetle.kx = nx * KNOCKBACK_SPEED;
      beetle.ky = ny * KNOCKBACK_SPEED;
      break;
    }
  }
}

/**
 * Which seat's base the ball is sitting in, or null.
 *
 * Compared as squared distances, so the test is exact arithmetic on the two coordinates and
 * the reflected board gives the reflected answer to the bit. A ball exactly on the ring
 * counts as delivered: one rule, no epsilon, and the ring is drawn at exactly this radius so
 * the line the player sees is the line the rule tests.
 *
 * Note that it says nothing about *who put it there*. A beetle that shoves the ball past its
 * own goal and into the far base has delivered it for the other seat, which is a real way to
 * lose a point and a real reason to be careful with a loose shove near the wrong end.
 */
export function deliveryIn(ball: Readonly<Ball>): SeatId | null {
  const reach = BASE_RADIUS * BASE_RADIUS;
  const x = ball.x * ball.x;
  const toP1 = ball.y - ARENA_HALF;
  if (x + toP1 * toP1 <= reach) return 'p1';
  const toP2 = ball.y + ARENA_HALF;
  if (x + toP2 * toP2 <= reach) return 'p2';
  return null;
}

/**
 * One fixed step of the whole pit.
 *
 * Both seats' drives are passed in and read before either beetle moves, so neither can ever
 * act on the other's post-step position. Returns the seat that took a delivery this step, or
 * null — the caller uses it for the celebration and nothing else, because the score has
 * already been written here.
 */
export function step(
  game: Game,
  fixedDeltaSeconds: number,
  p1DriveX: number,
  p1DriveY: number,
  p2DriveX: number,
  p2DriveY: number,
): SeatId | null {
  if (game.phase === 'over') return null;

  // The clock runs in every phase, pauses included, so the match's ceiling is exactly
  // MATCH_SECONDS and no amount of scoring can extend it.
  game.clock -= fixedDeltaSeconds;
  if (game.clock < 0) game.clock = 0;

  if (game.phase === 'kickoff' || game.phase === 'celebrate') {
    if (game.pending > 0) {
      game.hold = stepsFor(game.pending, fixedDeltaSeconds);
      game.pending = 0;
    }
    // The bugs keep hunting through a pause — they are not part of the ceremony — but a
    // beetle standing still cannot be flipped before it is allowed to move again.
    stepLadybugs(game, fixedDeltaSeconds);
    game.hold -= 1;
    if (game.hold <= 0) {
      // A celebration that runs into the whistle is not tidied up: `settle` below is about
      // to end the match either way, and the last frame should show the ball in the base
      // rather than a kick-off nobody plays.
      if (game.phase !== 'celebrate') game.phase = 'live';
      else if (game.clock > 0) kickOff(game, HOLD_SECONDS);
    }
    settle(game);
    return null;
  }

  driveBeetle(game.p1, p1DriveX, p1DriveY, fixedDeltaSeconds);
  driveBeetle(game.p2, p2DriveX, p2DriveY, fixedDeltaSeconds);
  pushBall(game);
  stepBall(game.ball, fixedDeltaSeconds);
  stepLadybugs(game, fixedDeltaSeconds);
  separate(game);
  flipCaught(game, fixedDeltaSeconds);

  const delivered = deliveryIn(game.ball);
  if (delivered !== null) {
    if (delivered === 'p1') game.score.p1 += 1;
    else game.score.p2 += 1;
    game.scorer = delivered;
    game.ball.vx = 0;
    game.ball.vy = 0;
    game.phase = 'celebrate';
    game.hold = 0;
    game.pending = CELEBRATE_SECONDS;
  }

  settle(game);
  return delivered;
}

/** Ask the shared helper, every step, and never compare two numbers by hand. */
function settle(game: Game): void {
  game.winner = resolve(WIN_CONDITION, game.score, { timeExpired: game.clock <= 0 });
  if (game.winner !== null) game.phase = 'over';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between decisions. Between them the bot holds the direction it chose. */
  readonly reaction: number;
  /** Radians of noise on the direction it settles on. */
  readonly wander: number;
  /**
   * How completely it gets **behind** the ball before shoving, in [0, 1].
   *
   * The skill the game is actually about, and the only one that is about the goal rather
   * than about hands. A beetle shoves the ball directly away from itself, so where you stand
   * when you arrive decides where the ball goes: at 1 the bot walks the long way round to the
   * far side of the ball from its own base and shoves it home; at 0 it charges the ball from
   * wherever it happens to be, which as often as not sends the ball to the opponent's end. It
   * scales the swing round the ball as well as the standoff, because those are the same
   * skill — a player who knows where to stand also knows not to walk through the ball to get
   * there.
   */
  readonly behind: number;
}

/**
 * Two knobs that are **not** here, and the measurements that took them out.
 *
 * Both read like difficulty and neither was. Every figure below is 200 to 300 matches a row,
 * both seat orders, against the `normal` of the day — necessarily, since the knobs were taken
 * out afterwards and cannot be swept against the profile that shipped. The noise at that
 * sample is about five points.
 *
 * **Caution — how wide a berth to give a ladybug.** 0 / 0.5 / 1.45 measured 52 / 50 / 53 per
 * cent, and it stayed flat through three different pit configurations, including one with the
 * flip lasting half again as long. It buys what it says it buys — the most careful setting is
 * flipped 5.1 times a match against the least careful one's 6.4 — and that is worth nothing,
 * because the bugs escort the ball and the ball is where the game is. There is no route to
 * the contest that avoids them, so care is a tax rate rather than a skill. The bot still
 * swerves, at one fixed berth for every tier; it just is not pretending that is a tier.
 *
 * **Lead — how far ahead of a rolling ball to aim.** 0 / 0.4 / 1.0 measured 49 / 50 / 29 per
 * cent: nothing at all until it was enough to be a handicap. The version before it used
 * `position + velocity * t`, which for a ball under drag aims 45 per cent past where the ball
 * can reach, and *that* one cost the top tier the ladder outright — `hard` lost to `normal` 2
 * matches to 38. Fixing the arithmetic to the analytic integral the simulation actually uses
 * made it harmless. It never made it useful, so the bot aims at the ball.
 */

/**
 * Three tiers, and every one of the five knobs is reaction, accuracy or judgement.
 *
 * None of them is information: all three tiers read the same two beetles, the same ball and
 * the same four bugs a player is looking at, and drive with the identical speed and the
 * identical shove (CLAUDE.md rule 6). `easy` is not short-sighted, it is clumsy — it charges
 * the ball rather than getting behind it, walks into ladybugs, and reconsiders a third of a
 * second after everybody else.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.3, wander: 0.45, behind: 0.75 },
  normal: { reaction: 0.15, wander: 0.2, behind: 0.88 },
  hard: { reaction: 0.05, wander: 0.06, behind: 1 },
});

/** How far out the bot walks round the ball, as a multiple of the contact distance. */
export const ORBIT = 1.1;
/**
 * How far round the ball a bot aims in one decision, in radians. About 52 degrees.
 *
 * It aims at a **point on the circle it wants to walk round**, a step ahead of where it is
 * standing, rather than at a tangential direction. Aimed as a direction — the first version —
 * a bot orbits at whatever radius it happens to be at and never closes: traced, two `hard`
 * bots circled the ball at 250 units for a match at a time and touched it on 5 per cent of
 * steps. A waypoint on the circle converges, because every decision moves the target closer
 * to the shoulder and closer to the ball at once.
 */
export const SWING_STEP = 0.9;
/**
 * How far past the ball a lined-up bot drives, in units.
 *
 * **A bot that aims at the point it wants to stand on stops when it gets there.** The first
 * version did exactly that: its target was the standoff point behind the ball, so the better
 * a tier was at reaching that point, the more completely it parked on it and the less it
 * shoved. Swept, `behind` peaked at 0.5 — where the "standoff" happened to land *inside* the
 * ball and the bot therefore kept driving — and fell to 8 per cent of decided matches at 1.0.
 * Getting behind the ball and shoving through it are two different targets and the bot needs
 * both.
 */
export const PUSH_THROUGH = 45;
/** How nearly behind the ball counts as behind it, for a bot at full skill. cos(53 degrees). */
export const ALIGN_COS = 0.6;
/** Seconds ahead a bot reads a ladybug's straight line. A person does this by eye. */
export const AVOID_LEAD = 0.45;
/** Units of clearance the bot wants beyond the contact distance. The same for every tier. */
export const AVOID_MARGIN = 60;
/**
 * How far a threatened bot swerves, as a multiple of its aim.
 *
 * **The swerve is sideways, and the first version was not.** Written as a repulsion — a
 * push directly away from the bug, added to the aim — it did not steer the bot round the
 * hazard, it steered the bot away from the *ball*: the bugs ring the ball, so the region
 * a cautious bot was avoiding is precisely the region the game is played in. At a berth of
 * 194 units against bugs looping the ball at 143, the most careful tier could not approach
 * the ball at all, and the ladder came out **inverted** — `easy` beat `hard` 30 matches to 9
 * and `normal` beat it 36 to 4, purely because the clumsy tier was the only one still
 * willing to touch the ball.
 *
 * Perpendicular to the aim, it is the thing a person actually does: you do not retreat from
 * a ladybug in your way, you go round it. At 1.5 the deflection tops out near 56 degrees, so
 * a swerve can bend a run and can never reverse it.
 */
export const AVOID_WEIGHT = 1.5;
/** A bug behind the beetle is not in its way. cos(96 degrees), so "roughly ahead". */
export const AHEAD_COS = -0.1;
/**
 * The most the swerve may add, however many bugs are crowding.
 *
 * Four bugs all ring the ball, so near the ball they are all threatening at once and
 * their swerves add up. Uncapped, the sum swamped the aim and the most careful tier simply
 * orbited: measured over twelve matches, `hard` against itself touched the ball on **3 per
 * cent of steps** and left it within 89 units of the middle of the pit all match. Capped, a
 * crowd deflects a run by the same 50 degrees one bug does, and the bot still arrives.
 */
export const SWERVE_CAP = 1.2;

export interface BotState {
  /** Seconds until the next decision. */
  cooldown: number;
  /** The direction it settled on, held until then. */
  aimX: number;
  aimY: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, aimX: 0, aimY: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.aimX = 0;
  state.aimY = 0;
}

/**
 * Values a bot draws per decision. Always exactly this many, on every path.
 *
 * Constant because a bot that drew a different number of values depending on what it saw
 * would shift its own stream from one match to the next for reasons that have nothing to do
 * with the seed. Each seat draws from its **own** generator (see `game.ts`), which is the
 * half of the lesson that is easy to miss: with one shared stream, whichever seat is polled
 * first takes the earlier value every single time, and that alone is worth a point or so of
 * win rate to the seat that draws second.
 */
export const BOT_DRAWS_PER_DECISION = 2;

/**
 * The direction a bot wants to run, written into `out` as a unit vector or zero.
 *
 * Everything it reads is on the screen the player is looking at: two beetles, one ball, four
 * bugs, all of them moving in straight lines at constant speeds. Leading a moving target and
 * reading where a bug will be in half a second are both arithmetic anybody does by eye, which
 * is what makes rule 6 easy to keep here — there is no information to withhold, only
 * accuracy to withdraw.
 */
export function botInput(
  out: Vec2,
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): Vec2 {
  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) return set(out, state.aimX, state.aimY);

  // Both draws happen before any branch on what it sees, so the count is constant.
  const pace = rng.float();
  const wobble = rng.float();
  state.cooldown = profile.reaction * (0.7 + pace * 0.6);

  const self = beetleOf(game, seat);
  const ball = game.ball;
  const baseY = baseYOf(seat);

  // The push line runs from my own base out through the ball; the far end of it is where I
  // have to stand for a shove to send the ball home. It aims at where the ball *is*, not
  // ahead of it — see the note under BotProfile for the matches that say so.
  const ballX = ball.x;
  const ballY = ball.y;
  let outX = ballX;
  let outY = ballY - baseY;
  const outLength = Math.hypot(outX, outY);
  if (outLength > 0) {
    outX /= outLength;
    outY /= outLength;
  } else {
    outX = 0;
    outY = seat === 'p1' ? -1 : 1;
  }

  // Where I stand relative to the ball decides which of the two jobs I am doing.
  const sideX = self.x - ballX;
  const sideY = self.y - ballY;
  const sideLength = Math.hypot(sideX, sideY);
  const sx = sideLength > 0 ? sideX / sideLength : outX;
  const sy = sideLength > 0 ? sideY / sideLength : outY;
  // A clumsy tier thinks it is behind the ball wherever it is standing, and shoves from
  // there; a sharp one holds out for the real thing. One knob, both halves of the same
  // misjudgement.
  const threshold = ALIGN_COS * profile.behind - (1 - profile.behind);
  const lined = sx * outX + sy * outY >= threshold;

  let targetX: number;
  let targetY: number;
  if (lined) {
    // Behind it: drive at a point past the ball on the way to my own base, so the shove
    // carries on for as long as I keep the stick down.
    targetX = ballX - outX * PUSH_THROUGH;
    targetY = ballY - outY * PUSH_THROUGH;
  } else {
    // Not behind it: walk round the ball towards the shoulder, aiming at a point on the
    // circle rather than at a direction round it. At zero skill that point collapses onto the
    // ball itself, which is a charge from whatever angle the bot happens to arrive at.
    const swing = Math.min(Math.acos(clamp(sx * outX + sy * outY, -1, 1)), SWING_STEP);
    const turn = sx * outY - sy * outX < 0 ? -swing : swing;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const stepX = sx * cos - sy * sin;
    const stepY = sx * sin + sy * cos;
    const orbit = BEETLE_BALL_TOUCH * ORBIT * profile.behind;
    targetX = ballX + stepX * orbit;
    targetY = ballY + stepY * orbit;
  }

  let aimX = targetX - self.x;
  let aimY = targetY - self.y;
  const aimLength = Math.hypot(aimX, aimY);
  if (aimLength > 0) {
    aimX /= aimLength;
    aimY /= aimLength;

    // And go round the bugs, read half a second ahead rather than where they stand.
    // Sideways, never backwards: see AVOID_WEIGHT for what the backwards version did to the
    // ladder. The aim is a unit vector here, so the swerve is measured against it directly.
    const room = BEETLE_BUG_TOUCH + AVOID_MARGIN;
    let swerveX = 0;
    let swerveY = 0;
    for (const bug of game.bugs) {
      const bx = bug.x + bug.hx * LADYBUG_SPEED * AVOID_LEAD - self.x;
      const by = bug.y + bug.hy * LADYBUG_SPEED * AVOID_LEAD - self.y;
      const distance = Math.hypot(bx, by);
      if (distance <= 0 || distance >= room) continue;
      // A bug behind me is not in my way.
      if ((bx * aimX + by * aimY) / distance < AHEAD_COS) continue;
      // Step to whichever side of my run it is not on.
      const turn = bx * -aimY + by * aimX < 0 ? 1 : -1;
      const urgency = (room - distance) / room;
      swerveX += -aimY * turn * urgency;
      swerveY += aimX * turn * urgency;
    }
    // Capped, so four bugs crowding deflect a run no further than one does.
    const reach = Math.hypot(swerveX, swerveY);
    const scale = reach * AVOID_WEIGHT > SWERVE_CAP ? SWERVE_CAP / reach : AVOID_WEIGHT;
    aimX += swerveX * scale;
    aimY += swerveY * scale;
  }

  // Nobody runs at exactly the angle they meant to, and how far off is the difficulty. It is
  // also what separates two identical bots in a pit that is symmetric to the bit: without it
  // they would mirror each other for the whole match and every mirror pairing would be a draw.
  const angle = (wobble * 2 - 1) * profile.wander;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turnedX = aimX * cos - aimY * sin;
  const turnedY = aimX * sin + aimY * cos;
  const length = Math.hypot(turnedX, turnedY);
  if (length > 0) {
    state.aimX = turnedX / length;
    state.aimY = turnedY / length;
  } else {
    state.aimX = 0;
    state.aimY = 0;
  }
  return set(out, state.aimX, state.aimY);
}
