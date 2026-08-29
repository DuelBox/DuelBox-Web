import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Water Game as pure rules: one tank of water, two balls swimming in it, and a basket at
 * each end that is the exact half-turn image of the other.
 *
 * A press gives your ball a shove in whatever direction its pointer happens to be facing at
 * that instant; the pointer turns steadily and never stops. The water bleeds the speed off
 * again. Send your ball out through your own basket and you have a point. First to fifteen.
 *
 * No rendering, no wall clock, no DOM. The game, both bots, the mirror test and the balance
 * harness all drive this one file, so there is exactly one definition of what a goal is.
 *
 * Four structural choices are worth reading before the numbers.
 *
 * 1. **Every ball is stored in its own seat's frame, not in board coordinates.** A seat's
 *    frame has its own basket at `y = -HOOP_Y` and its home at `y = +HOME_Y`; board
 *    coordinates are recovered by multiplying both components by {@link boardSignOf}, which
 *    is `+1` for seat one and `-1` for seat two. Because the tank is centred on the origin
 *    and the two baskets are half-turn images, **the world is identical in both frames**, so
 *    the two seats run byte-for-byte the same arithmetic on byte-for-byte the same
 *    constants. Seat bias cannot be written into this file by accident: the half-turn is an
 *    exact sign flip rather than a subtraction from a board width, and there is no
 *    seat-dependent branch anywhere in the simulation to get wrong. See
 *    `rules.test.ts`, "the board is its own mirror".
 * 2. **The water is integrated analytically, not by `v · dt`.** Speed decays as
 *    `v(t) = v₀ · WATER_DRAG^t`, so a ball covers `(v_before − v_after) / DRAG_RATE` in a
 *    step and those terms telescope: a free swim totals `(v₀ − STOP_SPEED) / DRAG_RATE`
 *    however finely it is sliced. Forward Euler instead overshoots by `dt · DRAG_RATE / 2`
 *    — 0.50% at 60 Hz for this drag — which would make the same shove a different shove on
 *    a 120 Hz phone and would leave the bot's own distance arithmetic permanently that far
 *    out. This is issue #2465 and commit b4af006; Soccer Pool reached the same place first.
 *    {@link reachOf} is therefore *exact* rather than indicative, and the bot uses it.
 * 3. **A press carries no position and no magnitude.** It is one binary event with a
 *    timestamp, which a thumb, a trackpad and a keyboard produce identically. The only
 *    thing a player controls is *when*. See SPEC.md, "Fairness".
 * 4. **The clock lives here.** `manifest.roundSeconds` ends nothing anywhere in this
 *    repository — it is text on a catalogue card. {@link MATCH_SECONDS} is what guarantees
 *    this game can finish, and `resolve` settles a level score on time as a draw.
 */

/* -------------------------------------------------------------------- the tank */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/**
 * The simulation is centred on the origin, and that is load-bearing rather than a taste.
 *
 * The half-turn that carries one seat's view into the other's is `(x, y) ↦ (−x, −y)` here,
 * and negating a float is **exact**. Written in the manifest's 0…600 by 0…1000 box the same
 * map is `(x, y) ↦ (600 − x, 1000 − y)`, and that is *not* exact: `600 − (600 − x)` differs
 * from `x` in the last bits for almost every `x`. Snowball Throw's seat bias and Frozen
 * Beaks' dunk divergence were both that error wearing different clothes — two seats
 * accumulating a coordinate from opposite ends of the board and straddling a threshold. A
 * centred tank removes the possibility rather than testing for it. `game.ts` adds
 * {@link HALF_WIDTH} and {@link HALF_HEIGHT} back on at draw time and nowhere else.
 */
export const HALF_WIDTH = BOARD_WIDTH / 2;
export const HALF_HEIGHT = BOARD_HEIGHT / 2;

/** The water, as half-extents from the centre. Logical units throughout, never pixels. */
export const POOL_HALF_X = 276;
export const POOL_HALF_Y = 476;

export const BALL_RADIUS = 18;

/** How far a ball's centre may travel before the tank wall turns it. */
export const BALL_HALF_X = POOL_HALF_X - BALL_RADIUS;
export const BALL_HALF_Y = POOL_HALF_Y - BALL_RADIUS;

/**
 * Distance from the centre line to a basket's mouth, and half the width of that mouth.
 *
 * In a seat's own frame its basket is always at `y = -HOOP_Y` and the opponent's at
 * `y = +HOOP_Y`, so the set of four posts `(±POST_X, ±HOOP_Y)` is unchanged by the
 * half-turn. Both balls therefore see the identical furniture.
 */
export const HOOP_Y = 380;
export const HOOP_HALF = 108;

/**
 * The posts, and why they stand where they do.
 *
 * A ball whose centre crosses the mouth line inside `±HOOP_HALF` scores, and its own rim
 * then reaches to `HOOP_HALF + BALL_RADIUS = 126`. A post's rim reaches in to
 * `POST_X − POST_RADIUS = 136`. **Ten units of clear water between the two**, deliberately:
 * put the post exactly where the widest scoring ball touches it and "this shot scored" and
 * "this shot hit the post" become the same event, decided in the last bits of a float, from
 * opposite ends of the tank by the two seats. That is precisely the family of bug the
 * mirror test exists to find, and it is cheaper to design out than to detect.
 */
export const POST_X = 149;
export const POST_RADIUS = 13;

/** Where a ball is put after a goal, and where the match starts it. */
export const HOME_Y = 300;

/* ------------------------------------------------------------------- the water */

/**
 * Fraction of a ball's speed that survives one **second** of water.
 *
 * A per-second power rather than a per-step multiplier, so 60 Hz and 240 Hz agree
 * (CLAUDE.md rule 8).
 */
export const WATER_DRAG = 0.55;

/**
 * The exponent behind {@link WATER_DRAG}.
 *
 * A ball shoved at speed `v` swims exactly `(v − STOP_SPEED) / DRAG_RATE` before it stops.
 * That is the analytic integral of the decay rather than an approximation of it, and
 * {@link step} moves a ball by that integral rather than by `v · dt`.
 */
export const DRAG_RATE = -Math.log(WATER_DRAG);

/**
 * Below this a ball is stopped outright, so the tank settles instead of creeping.
 *
 * Part of the distance law rather than a fudge on the end of one: {@link reachOf} and
 * {@link coastDistance} are exact through this same constant, and the step that crosses it
 * coasts the exact remaining distance and stops dead, so where a ball finishes does not
 * depend on which step happened to cross the line.
 */
export const STOP_SPEED = 12;

/** Nothing in the tank may move faster than this, however many shoves it has had. */
export const MAX_SPEED = 640;

/** Speed one press adds, along the pointer. Added to the velocity, never assigned to it. */
export const THRUST_SPEED = 250;

/**
 * Seconds between one press taking effect and the next being allowed.
 *
 * It is what stops the contest becoming a mashing contest, and it does so by arithmetic
 * rather than by refusing input: the pointer turns {@link AIM_RATE} × this = 0.68 rad
 * between two presses, so a player holding the button down as fast as it will fire spreads
 * their shoves evenly round the circle and the sum of them is nearly nothing. Pressing
 * *often* is not a strategy in this game; pressing *when* is the whole of it.
 */
export const THRUST_COOLDOWN = 0.26;

/** How long after a goal before the scorer's ball may be shoved again. */
export const REGROUP_SECONDS = 0.8;

/** The same pause at the start of a match, so nobody's first press lands on step zero. */
export const START_DELAY = 0.6;

/** Radians a second the pointer turns. It never stops and it never reverses. */
export const AIM_RATE = 2.6;

const TAU = Math.PI * 2;

/** Seconds for the pointer to come all the way round. */
export const AIM_PERIOD = TAU / AIM_RATE;

/** Where every ball's pointer starts: straight at its own basket. */
export const INITIAL_AIM = Math.PI * 1.5;

/** Speed kept through a tank wall, a post, and the other ball. */
export const WALL_BOUNCE = 0.82;
export const POST_BOUNCE = 0.7;
export const BALL_BOUNCE = 0.9;

/* ----------------------------------------------------------------- the contest */

/** From the catalogue row: "First to 15 wins." */
export const TARGET_POINTS = 15;

/**
 * The match clock, **ours**, and the thing that guarantees this game can end.
 *
 * Two seats that never find a basket would otherwise sit at nil-all for ever. When it runs
 * out the higher score wins and a level one is a draw, which is what `resolve` does with
 * `timeExpired` for a `first-to` condition. Measured: `hard` against `hard` reaches fifteen
 * with a minute to spare and `easy` against `easy` with half of one — measured over 300
 * `easy` matches the longest ran 150 s, so at 165 the clock is a guarantee rather than a
 * regular ending. See SPEC.md for the whole distribution.
 */
export const MATCH_SECONDS = 165;

export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_POINTS };

/**
 * Scratch for {@link resolve}'s options.
 *
 * Hoisted and reused because the winner is judged on **every** step, and an object literal
 * there would be a fresh allocation sixty times a second — exactly what rule 5 forbids.
 */
const resolveOptions = { timeExpired: false };

/* -------------------------------------------------------------------- the state */

export interface Ball {
  /** Position in this ball's **own** frame. Multiply by {@link boardSignOf} for the board. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where the pointer faces, in radians, in the ball's own frame. Always in [0, 2π). */
  aim: number;
  /** Seconds before the next press may take effect. Zero when the ball is ready. */
  cooldown: number;
  /**
   * Where the ball stood before this step's swim.
   *
   * The goal test is a segment crossing rather than a point test, so a ball that passes
   * clean through the mouth in one step cannot be missed. At 640 units a second a ball
   * covers 10.7 units in a 60 Hz step against a 216-unit mouth, so this is belt and braces
   * — but the braces are free and the belt is what makes 240 Hz behave like 60 Hz.
   */
  prevX: number;
  prevY: number;
}

export interface State {
  readonly p1Ball: Ball;
  readonly p2Ball: Ball;
  /** Scores. Named `p1`/`p2` so the state is a `Tally` the SDK can judge directly. */
  p1: number;
  p2: number;
  /** Seconds of play. The only clock in the game. */
  clock: number;
  winner: Outcome;
  /** Whether that seat scored on the step just taken. Presentation only. */
  p1Scored: boolean;
  p2Scored: boolean;
}

function createBall(): Ball {
  return {
    x: 0,
    y: HOME_Y,
    vx: 0,
    vy: 0,
    aim: INITIAL_AIM,
    cooldown: START_DELAY,
    prevX: 0,
    prevY: HOME_Y,
  };
}

/** Put a ball back on its own spot, at rest, facing its basket. */
export function resetBall(ball: Ball, cooldown: number): void {
  ball.x = 0;
  ball.y = HOME_Y;
  ball.vx = 0;
  ball.vy = 0;
  ball.aim = INITIAL_AIM;
  ball.cooldown = cooldown;
  ball.prevX = 0;
  ball.prevY = HOME_Y;
}

/** A fresh state. Allocates, so call it from init() and never from a step. */
export function createState(): State {
  return {
    p1Ball: createBall(),
    p2Ball: createBall(),
    p1: 0,
    p2: 0,
    clock: 0,
    winner: null,
    p1Scored: false,
    p2Scored: false,
  };
}

export function resetState(state: State): void {
  resetBall(state.p1Ball, START_DELAY);
  resetBall(state.p2Ball, START_DELAY);
  state.p1 = 0;
  state.p2 = 0;
  state.clock = 0;
  state.winner = null;
  state.p1Scored = false;
  state.p2Scored = false;
}

export function ballOf(state: Readonly<State>, seat: SeatId): Ball {
  return seat === 'p1' ? state.p1Ball : state.p2Ball;
}

/**
 * The sign that turns a seat's own frame into board coordinates, and back.
 *
 * `+1` for seat one and `-1` for seat two, and multiplying a float by either is exact — the
 * whole reason the tank is centred. `game.ts` is the only caller.
 */
export function boardSignOf(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

/* -------------------------------------------------------------- the distance law */

/**
 * How far a ball swimming at `speed` gets before the water stops it. Exact.
 *
 * {@link step} integrates the decay analytically, so this is the distance the simulation
 * actually produces, to floating point, at any step rate. `rules.test.ts` swims eleven
 * speeds at four step rates and compares.
 */
export function reachOf(speed: number): number {
  if (speed <= STOP_SPEED) return 0;
  return (speed - STOP_SPEED) / DRAG_RATE;
}

/** How far a ball swimming at `speed` gets in `seconds`, never more than {@link reachOf}. */
export function coastDistance(speed: number, seconds: number): number {
  if (speed <= STOP_SPEED) return 0;
  const next = speed * Math.pow(WATER_DRAG, seconds);
  if (next <= STOP_SPEED) return (speed - STOP_SPEED) / DRAG_RATE;
  return (speed - next) / DRAG_RATE;
}

/** What `speed` has decayed to after `seconds`, zeroed once the water has it. */
export function speedAfter(speed: number, seconds: number): number {
  if (speed <= STOP_SPEED) return 0;
  const next = speed * Math.pow(WATER_DRAG, seconds);
  return next <= STOP_SPEED ? 0 : next;
}

/* ---------------------------------------------------------------- one ball's step */

/**
 * Swim one ball for one step.
 *
 * The travel is `(v_before − v_after) / DRAG_RATE`, which telescopes to
 * `(v₀ − STOP_SPEED) / DRAG_RATE` over a whole free swim however finely it is sliced. The
 * step that crosses the stop line coasts the exact remainder and stops dead there.
 */
function swim(ball: Ball, fixedDeltaSeconds: number): void {
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (speed === 0) return;
  if (speed <= STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
    return;
  }
  const ux = ball.vx / speed;
  const uy = ball.vy / speed;
  const next = speed * Math.pow(WATER_DRAG, fixedDeltaSeconds);
  if (next <= STOP_SPEED) {
    const travel = (speed - STOP_SPEED) / DRAG_RATE;
    ball.x += ux * travel;
    ball.y += uy * travel;
    ball.vx = 0;
    ball.vy = 0;
    return;
  }
  const travel = (speed - next) / DRAG_RATE;
  ball.x += ux * travel;
  ball.y += uy * travel;
  ball.vx = ux * next;
  ball.vy = uy * next;
}

/** Add one shove along the pointer, capped so nothing in the tank exceeds the speed limit. */
export function shove(ball: Ball): void {
  let vx = ball.vx + Math.cos(ball.aim) * THRUST_SPEED;
  let vy = ball.vy + Math.sin(ball.aim) * THRUST_SPEED;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > MAX_SPEED) {
    const scale = MAX_SPEED / speed;
    vx *= scale;
    vy *= scale;
  }
  ball.vx = vx;
  ball.vy = vy;
}

/**
 * Did this ball's swim carry it out through its own basket?
 *
 * Outward only — `y` falling through `-HOOP_Y`. A ball that went round the outside of a post
 * and is coming back down through the mouth from the wrong side has not scored, and without
 * the direction test it would.
 */
export function crossedHoop(ball: Readonly<Ball>): boolean {
  if (!(ball.prevY > -HOOP_Y && ball.y <= -HOOP_Y)) return false;
  const span = ball.prevY - ball.y;
  const along = (ball.prevY + HOOP_Y) / span;
  const crossX = ball.prevX + along * (ball.x - ball.prevX);
  return crossX >= -HOOP_HALF && crossX <= HOOP_HALF;
}

/** Turn a ball at the tank wall. Written as two exact mirror images of one another. */
function bounceWalls(ball: Ball): void {
  if (ball.x < -BALL_HALF_X) {
    ball.x = -BALL_HALF_X + (-BALL_HALF_X - ball.x);
    ball.vx = -ball.vx * WALL_BOUNCE;
  } else if (ball.x > BALL_HALF_X) {
    ball.x = BALL_HALF_X - (ball.x - BALL_HALF_X);
    ball.vx = -ball.vx * WALL_BOUNCE;
  }
  if (ball.y < -BALL_HALF_Y) {
    ball.y = -BALL_HALF_Y + (-BALL_HALF_Y - ball.y);
    ball.vy = -ball.vy * WALL_BOUNCE;
  } else if (ball.y > BALL_HALF_Y) {
    ball.y = BALL_HALF_Y - (ball.y - BALL_HALF_Y);
    ball.vy = -ball.vy * WALL_BOUNCE;
  }
}

/** Push a ball out of one post and take the sting out of the rebound. */
function bouncePost(ball: Ball, postX: number, postY: number): void {
  const reach = BALL_RADIUS + POST_RADIUS;
  const dx = ball.x - postX;
  const dy = ball.y - postY;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq >= reach * reach || distanceSq === 0) return;
  const distance = Math.sqrt(distanceSq);
  const nx = dx / distance;
  const ny = dy / distance;
  ball.x = postX + nx * reach;
  ball.y = postY + ny * reach;
  const along = ball.vx * nx + ball.vy * ny;
  if (along >= 0) return;
  const impulse = -(1 + POST_BOUNCE) * along;
  ball.vx += impulse * nx;
  ball.vy += impulse * ny;
}

/**
 * The four posts, in the ball's own frame, unrolled rather than indexed.
 *
 * The set `(±POST_X, ±HOOP_Y)` is unchanged by the half-turn, so this same sequence of four
 * calls with these same four literal pairs is the whole of what either ball collides with.
 */
function bouncePosts(ball: Ball): void {
  bouncePost(ball, -POST_X, -HOOP_Y);
  bouncePost(ball, POST_X, -HOOP_Y);
  bouncePost(ball, -POST_X, HOOP_Y);
  bouncePost(ball, POST_X, HOOP_Y);
}

/**
 * One ball: pointer, cooldown, shove, swim, goal, walls, posts. Reports whether it scored.
 *
 * The goal is decided on the free-swim segment, before the walls and posts get to move
 * anything. They cannot interfere: a scoring ball's rim reaches 126 from the centre line
 * and the nearest post's reaches in to 136, and the mouth is 96 units clear of the end wall.
 */
function advanceBall(ball: Ball, fixedDeltaSeconds: number, press: boolean): boolean {
  ball.aim += AIM_RATE * fixedDeltaSeconds;
  if (ball.aim >= TAU) ball.aim -= TAU;

  if (ball.cooldown > 0) {
    ball.cooldown -= fixedDeltaSeconds;
    if (ball.cooldown < 0) ball.cooldown = 0;
  }
  if (press && ball.cooldown <= 0) {
    shove(ball);
    ball.cooldown = THRUST_COOLDOWN;
  }

  swim(ball, fixedDeltaSeconds);
  if (crossedHoop(ball)) return true;

  bounceWalls(ball);
  bouncePosts(ball);
  return false;
}

/**
 * The two balls meeting, and the one place in this file that has to leave a seat's own frame.
 *
 * Seat one's own frame *is* the board frame; seat two's is its negation. So the contact
 * normal is computed once in the board frame — and then, because the two frames are
 * opposites, **the identical correction is applied to both balls in their own frames**: an
 * impulse of `−j·n` for seat one is `+j·n` on the board for seat two, which is `−j·n` again
 * once written back. The same holds for the separation push. There is no per-seat branch
 * here and therefore nothing to get the wrong way round, and every quantity it computes —
 * `dx`, `dy`, `j` — is unchanged when the two balls swap places.
 */
function collideBalls(state: State): void {
  const a = state.p1Ball;
  const b = state.p2Ball;
  // Seat two's position on the board, by exact negation.
  const dx = -b.x - a.x;
  const dy = -b.y - a.y;
  const distanceSq = dx * dx + dy * dy;
  const reach = BALL_RADIUS * 2;
  if (distanceSq >= reach * reach || distanceSq === 0) return;
  const distance = Math.sqrt(distanceSq);
  const nx = dx / distance;
  const ny = dy / distance;

  const push = (reach - distance) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x -= nx * push;
  b.y -= ny * push;

  const alongA = a.vx * nx + a.vy * ny;
  const alongB = -b.vx * nx + -b.vy * ny;
  const closing = alongB - alongA;
  if (closing >= 0) return;
  const impulse = (-(1 + BALL_BOUNCE) * closing) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx -= impulse * nx;
  b.vy -= impulse * ny;
}

/**
 * One fixed step of the tank.
 *
 * Both balls are advanced before either is judged, and neither ball's advance can read the
 * other's, so the order the two are written in is not observable. `rules.test.ts` asserts
 * that by stepping a swapped state and comparing.
 */
export function step(
  state: State,
  fixedDeltaSeconds: number,
  p1Press: boolean,
  p2Press: boolean,
): void {
  if (state.winner !== null) return;

  const p1Goal = advanceBall(state.p1Ball, fixedDeltaSeconds, p1Press);
  const p2Goal = advanceBall(state.p2Ball, fixedDeltaSeconds, p2Press);

  state.p1Scored = p1Goal;
  state.p2Scored = p2Goal;
  if (p1Goal) {
    state.p1 += 1;
    resetBall(state.p1Ball, REGROUP_SECONDS);
  }
  if (p2Goal) {
    state.p2 += 1;
    resetBall(state.p2Ball, REGROUP_SECONDS);
  }
  // Only balls still on the board can touch, and a scorer has just been taken off it.
  if (!p1Goal && !p2Goal) collideBalls(state);

  state.clock += fixedDeltaSeconds;
  resolveOptions.timeExpired = state.clock >= MATCH_SECONDS;
  state.winner = resolve(WIN_CONDITION, state, resolveOptions);
}

export function winnerOf(state: Readonly<State>): Outcome {
  return state.winner;
}

/** Seconds of play left, for the bar on the side margins. Never negative. */
export function secondsLeft(state: Readonly<State>): number {
  const left = MATCH_SECONDS - state.clock;
  return left < 0 ? 0 : left;
}

/* ---------------------------------------------------------------------- the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Seconds between a bot's looks at the tank, for every tier alike.
 *
 * **How often a bot looks is not a difficulty axis in this game, and measuring it was the
 * only way to find that out.** Swept alone it has a hump rather than a slope — seconds to
 * put fifteen away solo, everything else left as `hard`:
 *
 * | look every | 0.02 | 0.06 | 0.10 | **0.14** | 0.20 | 0.30 | 0.45 | 0.70 | 1.00 | 1.50 |
 * |---|---|---|---|---|---|---|---|---|---|---|
 * | seconds to fifteen | 106.2 | 77.1 | 72.7 | **72.9** | 69.9 | 80.6 | 103.7 | 104.0 | 111.6 | 121.7 |
 *
 * The right-hand half is a clean slope and would make a ladder. The left-hand half runs
 * **backwards**, and it does so for a reason that is a fact about the game rather than about
 * the bot: a bot that looks every step re-plans faster than {@link THRUST_COOLDOWN} lets it
 * press, so it presses at the first opportunity every time — and a ball shoved every 0.26 s
 * with the pointer 0.68 rad further round each time is being pushed evenly around the circle
 * and goes nowhere. The bot that looks too often turns into a masher, and the geometry
 * punishes mashing exactly as it is meant to.
 *
 * A ladder built on a knob with a hump in it would put its weakest tier on the far side of
 * that hump, where "worse" means "mashes", and its strongest tier on a plateau. So this is a
 * constant, set inside the plateau, and the whole of the difficulty ladder is the two knobs
 * below.
 */
export const LOOK_SECONDS = 0.14;

export interface BotProfile {
  /**
   * Half-width of the triangular press error, in seconds.
   *
   * The whole of the skill this game asks for. A press is a moment and nothing else, so
   * being late or early by a tenth of a second is the entire way to be bad at it.
   * Triangular rather than flat — two draws summed — for the reason Cup Pong measured: a
   * flat error either fits inside the mouth or it does not, and a ladder built on one has
   * almost nowhere to stand.
   */
  readonly pressError: number;
  /**
   * How many moments in the coming turn of the pointer the bot weighs up.
   *
   * The other half of the skill, and the half a person would describe as *reading the water*
   * rather than as timing. Two candidate moments are 1.2 s of pointer apart, which is barely
   * an aim at all; fourteen are 0.17 s apart, which is finer than any tier's press error.
   */
  readonly aimSamples: number;
}

/**
 * Three tiers, and the two knobs that survived being swept. See SPEC.md for all three
 * sweeps, including the one that measured flat and was deleted.
 *
 * No tier is given the other ball's velocity, the other bot's timing, or anything the water
 * has not already shown a player (rule 6). Every number it uses is on the screen.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { pressError: 0.2, aimSamples: 5 },
  normal: { pressError: 0.13, aimSamples: 8 },
  hard: { pressError: 0.06, aimSamples: 14 },
});

/**
 * How long after looking a bot will have pressed, whatever it decides. One turn of the
 * pointer, and the reason this game's bot cannot stall.
 *
 * The bot **counts down to a moment; it does not watch for the pointer to reach an angle** —
 * Cup Pong's lesson, where watching for a position swept for ever on the second seed of the
 * first harness run. A countdown expires on its own. But this bot also re-looks every
 * {@link LOOK_SECONDS}, because a plan made two seconds ago has had a tank wall
 * happen to it, and a re-look recomputes the countdown — so the countdown alone is not
 * enough. Measured, before this was added: a bot whose timing error ran late reset its own
 * deadline before ever reaching it, and 2.1% of `easy`'s presses had to be forced by a
 * safety rail.
 *
 * So arming a press also starts a **deadline**, which only ever decreases and which a re-look
 * may not push out. A re-look can bring a press forward and can move it about inside the
 * window; it cannot postpone it past the turn of the pointer the bot committed to. The press
 * therefore lands within `LOOK_SECONDS + AIM_PERIOD + pressError + REGROUP_SECONDS` of the
 * last one — 3.56 s at the widest tier — and `rules.test.ts` asserts that bound over a long
 * run rather than trusting the arithmetic. {@link REGROUP_SECONDS} rather than
 * {@link THRUST_COOLDOWN} because the longest a shove can be held back is the pause after a
 * goal, and a bot that has just scored is exactly the bot most likely to be waiting on one:
 * the first version of this bound used the cooldown, and 0.02% of `easy`'s presses at once
 * went over it.
 */
export const PRESS_HORIZON_SECONDS = AIM_PERIOD;

/** The bound the paragraph above derives, for the test and for SPEC.md. */
export const PRESS_BOUND_SECONDS =
  LOOK_SECONDS + AIM_PERIOD + BOT_PROFILES.easy.pressError + REGROUP_SECONDS;

export interface BotState {
  /** Seconds until the press this bot is aiming at. A re-look may move this either way. */
  waitSeconds: number;
  /** Seconds until the press happens regardless. Only ever decreases. */
  deadlineSeconds: number;
  /** This press cycle's timing error, drawn once when the press is armed. */
  error: number;
  /** False between a press and the look that arms the next one. */
  armed: boolean;
  /** Counts down to the next look. */
  planSeconds: number;
}

export function createBotState(): BotState {
  return {
    waitSeconds: Number.POSITIVE_INFINITY,
    deadlineSeconds: Number.POSITIVE_INFINITY,
    error: 0,
    armed: false,
    planSeconds: 0,
  };
}

export function resetBotState(bot: BotState): void {
  bot.waitSeconds = Number.POSITIVE_INFINITY;
  bot.deadlineSeconds = Number.POSITIVE_INFINITY;
  bot.error = 0;
  bot.armed = false;
  bot.planSeconds = 0;
}

const DELAY_PENALTY = 400;

/**
 * What shoving `delay` seconds from now would be worth, on the water as it stands.
 *
 * Everything here is the *same* arithmetic the simulation runs, which is the point of
 * issue #2465: {@link coastDistance} and {@link speedAfter} are the closed forms of the
 * telescoping sum {@link swim} accumulates, so the bot's picture of where its ball will be
 * and how fast is not an approximation of the simulation — it is the simulation, evaluated
 * in one go. A bot reasoning about `x += v · dt` against a simulation that decays would be
 * 0.50% out at 60 Hz for this drag, permanently, and no amount of tuning would find it.
 *
 * What it deliberately does *not* model is the tank walls, the posts and the other ball. A
 * person cannot integrate a rebound in their head either, and every one of those errors
 * falls on the two seats alike.
 */
export function shotValue(ball: Readonly<Ball>, delay: number): number {
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  let px = ball.x;
  let py = ball.y;
  let carried = 0;
  let ux = 0;
  let uy = 0;
  if (speed > STOP_SPEED) {
    ux = ball.vx / speed;
    uy = ball.vy / speed;
    const travel = coastDistance(speed, delay);
    px += ux * travel;
    py += uy * travel;
    carried = speedAfter(speed, delay);
  }

  const angle = ball.aim + AIM_RATE * delay;
  const vx = carried * ux + Math.cos(angle) * THRUST_SPEED;
  const vy = carried * uy + Math.sin(angle) * THRUST_SPEED;
  const shot = Math.sqrt(vx * vx + vy * vy);
  if (shot === 0) return -1e9;
  // The direction survives the speed cap; only the reach is shortened by it.
  const nux = vx / shot;
  const nuy = vy / shot;
  const reach = reachOf(shot > MAX_SPEED ? MAX_SPEED : shot);

  // Does the straight line this shove puts the ball on leave through the mouth?
  if (nuy < 0 && py > -HOOP_Y) {
    const along = (py + HOOP_Y) / -nuy;
    if (along <= reach) {
      const crossX = px + nux * along;
      if (crossX >= -HOOP_HALF && crossX <= HOOP_HALF) {
        // Sooner is better, and through the middle is better than off the post.
        return 4000 - delay * DELAY_PENALTY - Math.abs(crossX);
      }
    }
  }

  // Otherwise: end up as close to the basket as the shove can manage. The resting point is
  // clamped into the tank rather than followed round a rebound, which is what a person can
  // see too.
  let endX = px + nux * reach;
  let endY = py + nuy * reach;
  if (endX < -BALL_HALF_X) endX = -BALL_HALF_X;
  else if (endX > BALL_HALF_X) endX = BALL_HALF_X;
  if (endY < -BALL_HALF_Y) endY = -BALL_HALF_Y;
  else if (endY > BALL_HALF_Y) endY = BALL_HALF_Y;
  const gapY = endY + HOOP_Y;
  return -Math.sqrt(endX * endX + gapY * gapY) - delay * DELAY_PENALTY;
}

/**
 * One look at the tank.
 *
 * Exactly two values are drawn, unconditionally and before anything branches, so a bot
 * occupies a fixed window of its own stream per look whatever the water looks like and
 * whatever it decides. Each seat has its own generator as well, so the order the two are
 * polled in is not observable at all. Both guards are asserted in `rules.test.ts`.
 */
export function botPlan(ball: Readonly<Ball>, profile: BotProfile, bot: BotState, rng: Rng): void {
  const first = rng.float();
  const second = rng.float();
  if (!bot.armed) {
    // Triangular on [-pressError, +pressError]: two draws summed. One error for the whole
    // press, drawn from the seeded stream — a fresh error at every look would average away
    // and all three tiers would play the same.
    bot.error = (first + second - 1) * profile.pressError;
    bot.armed = true;
    const slack = bot.error > 0 ? bot.error : 0;
    bot.deadlineSeconds = PRESS_HORIZON_SECONDS + slack;
  }

  const samples = profile.aimSamples;
  const spacing = AIM_PERIOD / samples;
  let bestValue = -Infinity;
  let bestDelay = 0;
  for (let i = 0; i < samples; i += 1) {
    const delay = i * spacing;
    const value = shotValue(ball, delay);
    // A strict `>` keeps the earliest moment on a tie, and the two seats index their
    // samples in the same order in their own frames, so a mirrored tank ties the same way.
    if (value > bestValue) {
      bestValue = value;
      bestDelay = delay;
    }
  }

  const wait = bestDelay + bot.error;
  bot.waitSeconds = wait < 0 ? 0 : wait;
}

/**
 * Drive one bot for one step, and report whether it presses.
 *
 * It counts down to the moment it chose; it does not watch for the pointer to arrive at an
 * angle. A countdown cannot fail to expire, and it is the more honest model anyway — a
 * person commits to a moment, and pressing late enough that the pointer has gone by is a
 * real way to miss.
 */
export function botStep(
  ball: Readonly<Ball>,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  return botStepWith(ball, BOT_PROFILES[difficulty], bot, rng, fixedDeltaSeconds);
}

/**
 * The same, against a profile that is not one of the three shipped tiers.
 *
 * It exists so a knob can be swept **alone** without the sweep re-implementing the bot and
 * measuring its own copy instead. Every number in SPEC.md's sweep tables came through here.
 */
export function botStepWith(
  ball: Readonly<Ball>,
  profile: BotProfile,
  bot: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  bot.planSeconds -= fixedDeltaSeconds;
  if (bot.planSeconds <= 0) {
    botPlan(ball, profile, bot, rng);
    bot.planSeconds = LOOK_SECONDS;
  }

  bot.waitSeconds -= fixedDeltaSeconds;
  bot.deadlineSeconds -= fixedDeltaSeconds;
  // A re-look may bring the press forward or move it about inside the window it committed
  // to. It may not push it out of that window.
  if (bot.waitSeconds > bot.deadlineSeconds) bot.waitSeconds = bot.deadlineSeconds;

  if (bot.waitSeconds > 0) return false;
  if (ball.cooldown > 0) return false;
  bot.waitSeconds = Number.POSITIVE_INFINITY;
  bot.deadlineSeconds = Number.POSITIVE_INFINITY;
  bot.armed = false;
  return true;
}
