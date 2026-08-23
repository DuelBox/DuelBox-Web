import type { Rng, SeatId } from '@duelbox/engine';
import {
  commit,
  createJudgement,
  misjudgement,
  resetJudgement,
  shouldDecide,
} from '@duelbox/game-sdk';
import type { Judgement } from '@duelbox/game-sdk';

/**
 * Wrestle, as pure rules: two stiff-bodied wrestlers on a mat, the wind over it, and the
 * one thing that loses a round — putting your head on the floor.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the fairness harness all
 * drive this same file, so what a test measures is what a player feels.
 *
 * ## The coordinate system, and why it is signed
 *
 * `x` is measured **from the middle of the mat**, positive towards p2's corner, and `y`
 * is the height of the foot **above the mat**, positive upwards. Both are logical units;
 * nothing here is a pixel and only the renderer knows where the middle of a screen is.
 *
 * Signed rather than screen-shaped on purpose. Mirroring the world left-to-right is then
 * exactly `x -> -x`, which IEEE arithmetic performs without losing a bit — so a mirrored
 * bout can be asserted to step *identically*, not merely closely. Written as
 * `width - x` it would not: floating-point addition is not associative, and the mirror
 * of a sum would drift from the sum of the mirror in the last place. That single choice
 * is what makes the seat-symmetry test in `rules.test.ts` an equality rather than a
 * tolerance, and a seat advantage is exactly the bug a tolerance hides.
 *
 * ## The body
 *
 * A wrestler is a rigid rod of length {@link BODY_LENGTH} standing on one foot: the foot
 * carries the position, `angle` carries the tilt from upright, and the head is the far
 * end. It is not a ragdoll — a ragdoll settles into poses that are neither standing nor
 * fallen, which is precisely the state a match must never reach.
 */

export type Stance = 'grounded' | 'airborne' | 'toppling' | 'fallen';

export interface Wrestler {
  /** Foot position along the mat, from its middle. Positive is towards p2's corner. */
  x: number;
  /** Height of the foot above the mat. Zero while standing, never negative. */
  y: number;
  vx: number;
  /** Positive is upwards, so gravity subtracts. */
  vy: number;
  /** Tilt from upright in radians. Positive leans towards +x. */
  angle: number;
  spin: number;
  stance: Stance;
  /** Which way a toppling wrestler is going over: -1, 0 or +1. */
  topple: number;
  /** Seconds before this wrestler may jump again. */
  jumpCooldown: number;
  /** Radian-seconds of lean carried on the mat. The round's steadiness tie-break. */
  wobble: number;
}

export interface Bout {
  readonly p1: Wrestler;
  readonly p2: Wrestler;
}

/** What one seat is asking for this step. A direction and an edge, never a speed. */
export interface Drive {
  /** Lean, in [-1, 1]. Negative leans towards -x. */
  lean: number;
  /** True on the step the seat asked to jump, not while it holds the key. */
  jump: boolean;
}

/**
 * The wind, as the players see it.
 *
 * `strength` is blowing now and is drawn across the sky; `upcoming` is the next gust and
 * is **zero until it has been telegraphed**, which is the same instant the arrow for it
 * appears on screen. The bot is handed this and nothing else, so it cannot know about a
 * gust before the person opposite can (CLAUDE.md rule 6).
 */
export interface Wind {
  /** Horizontal acceleration in logical units per second squared. Positive blows to +x. */
  strength: number;
  /** The gust that is coming, once telegraphed; zero otherwise. A gust may itself be calm. */
  upcoming: number;
  /**
   * Share of the warning still to run, in (0, 1], or zero when nothing is telegraphed.
   *
   * A fraction rather than seconds so that the arrow's countdown is the same shape on
   * every device and nothing here has to know the step rate.
   */
  warning: number;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/* ------------------------------------------------------------------ the play area */

export const ARENA_WIDTH = 900;
export const ARENA_HEIGHT = 520;
/** Screen x of the middle of the mat: the only place simulation x and screen x meet. */
export const ARENA_HALF = ARENA_WIDTH / 2;
/** Screen y of the mat surface, i.e. of simulation height zero. */
export const MAT_Y = 430;

/** How far from the middle the ropes stand. A foot never passes this. */
export const ROPE_HALF = 354;

/** Where each seat's foot starts, either side of the middle. */
export const START_X = 150;

export const BODY_LENGTH = 130;
/** Collision radius of each of the three discs strung along a body. */
export const BODY_RADIUS = 34;

/* ------------------------------------------------------------------------ physics */

export const GRAVITY = 1500;
export const JUMP_SPEED = 560;
/** Sideways kick a lean adds to a leap. A jump is aimed, not merely upwards. */
export const JUMP_LATERAL = 210;
/**
 * Rotation a lean adds to a leap.
 *
 * Small. It was five times this at first and every committed leap was a self-knockout: a
 * full lean spun the body more than a radian over three quarters of a second of airtime,
 * so the wrestler landed past {@link LAND_ANGLE} and toppled without anyone touching it.
 * Measured, the bot that attacked most fell twice as often as the one that attacked least,
 * which inverted the whole difficulty ladder.
 */
export const JUMP_SPIN = 0.4;
export const JUMP_COOLDOWN = 0.3;

/**
 * Balance, as a damped spring about upright.
 *
 * A wrestler on their feet is *trying* to stand: the spring is that effort, not a law of
 * physics, and it is why holding a lean key cannot tip you over on its own. Past
 * {@link TIP_ANGLE} the effort is abandoned and {@link TOPPLE_TORQUE} takes over.
 *
 * Deliberately underdamped and deliberately linear. Linear because a constant-coefficient
 * second-order equation has an exact closed-form solution, so two steps of `h` and one of
 * `2h` land on the same numbers and a 144 Hz laptop plays the same match as a 60 Hz
 * phone. `sin(angle)` would be the honest pendulum and would make the answer depend on
 * the step size.
 */
export const SPRING = 7;
export const DAMPING = 2.3;
/** Damped natural frequency. Kept as a constant so the tilt solver never recomputes it. */
export const TILT_OMEGA = Math.sqrt(SPRING - (DAMPING * DAMPING) / 4);

/** Torque a full lean applies. `LEAN_TORQUE / SPRING` is the tilt it settles at. */
export const LEAN_TORQUE = 3.5;
/** Sideways acceleration a full lean applies while a foot is on the mat. */
export const LEAN_PUSH = 260;
/** Friction as a decay RATE in 1/s, with the matching analytic integral. */
export const MAT_FRICTION = 3.4;

/**
 * Turning in the air, as a torque and a decay rate.
 *
 * A wrestler off the mat has no spring holding it upright, but it is not helpless: leaning
 * turns it, so a leap can be straightened out before it lands and a spin taken from a
 * shove can be fought. This is the skill the whole game rests on — without it a leap is a
 * coin toss, and a coin toss cannot be played better by a better player.
 */
export const AIR_TORQUE = 2.4;
export const AIR_DAMP = 1.2;

/** Strongest gust the seed may draw, as a horizontal acceleration. */
export const WIND_MAX = 380;
/**
 * Share of the wind a planted foot feels.
 *
 * Small on purpose: the wind is a *jumping* hazard. A wrestler in the air takes all of
 * it, which is what "watch the wind" means — a leap timed into a gust overshoots.
 */
export const WIND_GROUND_SHARE = 0.3;
/** Torque per unit of wind on the upper body. At {@link WIND_MAX} it leans you 0.25 rad. */
export const WIND_TORQUE = 0.0046;

/**
 * Past this tilt a wrestler has lost their feet and is going over.
 *
 * Chosen above the worst tilt the controls can reach on their own: a full lean into the
 * strongest gust settles at 0.75 rad and overshoots to about 0.92, so a player can flirt
 * with falling but cannot be killed by a key they are holding. Everything past it comes
 * from a collision or a bad landing.
 */
export const TIP_ANGLE = 1;
/** Tilt a landing can be stuck at. Steeper than this and the wrestler lands toppling. */
export const LAND_ANGLE = 0.9;
/**
 * Constant torque on a toppling wrestler, which is what guarantees a round can end.
 *
 * A body past {@link TIP_ANGLE} is driven monotonically towards head-down and no input
 * touches it, so it reaches the floor within `sqrt(2 * (PI/2 - TIP_ANGLE) / TOPPLE)` —
 * about a third of a second — however the two seats behave.
 */
export const TOPPLE_TORQUE = 11;

/** Elasticity of a wrestler-on-wrestler shove. */
export const RESTITUTION = 0.85;
/** How much of a horizontal speed the ropes give back. */
export const ROPE_BOUNCE = 0.35;
/** Share of the horizontal speed and the spin that survives a landing. */
export const LANDING_SLIDE = 0.55;
export const LANDING_SPIN = 0.6;
/** Upward speed a shove has to impart before it counts as taking a wrestler off its feet. */
export const LIFT_SPEED = 90;

/** A rod of unit mass pivoting about its foot: 1 / (m L^2 / 3). */
export const INV_INERTIA = 3 / (BODY_LENGTH * BODY_LENGTH);

/**
 * Ceilings, applied to the state a step STARTS with.
 *
 * One step at the simulation rate must move a body less than the pair's contact distance,
 * or a hard shove would pass straight through the opponent between two discrete tests.
 * The spin cap also keeps {@link wrapAngle} to a single turn's correction.
 */
export const MAX_SPEED = 1400;
export const MAX_SPIN = 14;

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------------- rounds */

/** Rounds won that take the match. */
export const ROUNDS_TO_WIN = 3;
/**
 * Rounds after which the match is settled however it stands.
 *
 * The outer termination guarantee, and the reason two motionless seats cannot hang a
 * match: every round ends on a fall or on its own clock, and there are only ever five of
 * them. See SPEC.md.
 */
export const MAX_ROUNDS = 5;

/* --------------------------------------------------------------------------- wind */

/** Gusts drawn per round. Enough of them to outlast the longest round the clock allows. */
export const GUSTS_PER_ROUND = 14;
/**
 * How long a gust holds.
 *
 * Short enough that a typical round sees two of them and they blow opposite ways, which
 * is what keeps a single round from being one long push in one seat's favour; long enough
 * to be read and leapt against rather than merely suffered.
 */
export const GUST_SECONDS = 3.2;
/** How long before a gust arrives its arrow appears. The bot may not read it sooner. */
export const TELEGRAPH_SECONDS = 1;

/* ------------------------------------------------------------------------- scratch */

/**
 * Contact points, three to a body, as `[x, y, x, y, x, y]` from foot to head.
 *
 * Module scope so a step allocates nothing. `update()` is synchronous and never
 * re-entrant, so one pair of buffers serves every instance.
 */
const pointsA = [0, 0, 0, 0, 0, 0];
const pointsB = [0, 0, 0, 0, 0, 0];
/** Distance of each contact point from the foot, matching the buffers above. */
const OFFSETS = [0, BODY_LENGTH / 2, BODY_LENGTH];

/**
 * The order the nine candidate pairs are examined in, as flat `[i, j]` couples.
 *
 * **Diagonals first, and improvement is strict.** In a mirrored bout the distance from
 * A's i-th disc to B's j-th equals the distance from A's j-th to B's i-th exactly, so an
 * off-diagonal winner would be a coin-flip between two tied pairs and would break the
 * symmetry. Testing `i === j` first hands every such tie to the pair that keeps it.
 */
const PAIR_ORDER = [0, 0, 1, 1, 2, 2, 0, 1, 1, 0, 0, 2, 2, 0, 1, 2, 2, 1];

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** Symmetric about zero, so mirroring a clamped value is the clamp of the mirror. */
function clampSymmetric(value: number, limit: number): number {
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

/**
 * Fold an angle back into one turn.
 *
 * Written as a rounded subtraction rather than a loop so that the mirror of a wrapped
 * angle is the wrap of the mirror: `Math.round` is odd everywhere except at a half, and
 * a half turn is a pose whose head height is the same either way.
 */
export function wrapAngle(angle: number): number {
  return angle - TAU * Math.round(angle / TAU);
}

/* ---------------------------------------------------------------------- the bodies */

/** Allocates, so setup only. */
export function createWrestler(x: number): Wrestler {
  return {
    x,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    stance: 'grounded',
    topple: 0,
    jumpCooldown: 0,
    wobble: 0,
  };
}

/** Allocates, so setup only. */
export function createBout(): Bout {
  return { p1: createWrestler(-START_X), p2: createWrestler(START_X) };
}

/** Allocates, so setup only. */
export function createDrive(): Drive {
  return { lean: 0, jump: false };
}

/** Allocates, so setup only. */
export function createWind(): Wind {
  return { strength: 0, upcoming: 0, warning: 0 };
}

export function wrestlerOf(bout: Bout, seat: SeatId): Wrestler {
  return seat === 'p1' ? bout.p1 : bout.p2;
}

/**
 * Stand both seats up facing each other, exactly mirrored about the middle of the mat.
 *
 * Every field of one is the mirror of the other, which is the whole of the game's
 * starting fairness: there is no draw, no offset and no jitter that could favour a seat.
 */
export function resetBout(bout: Bout): void {
  standUp(bout.p1, -START_X);
  standUp(bout.p2, START_X);
}

function standUp(w: Wrestler, x: number): void {
  w.x = x;
  w.y = 0;
  w.vx = 0;
  w.vy = 0;
  w.angle = 0;
  w.spin = 0;
  w.stance = 'grounded';
  w.topple = 0;
  w.jumpCooldown = 0;
  w.wobble = 0;
}

/** Height of the head above the mat. Negative means it has gone through the floor. */
export function headHeight(w: Readonly<Wrestler>): number {
  return w.y + Math.cos(w.angle) * BODY_LENGTH;
}

/** Screen x of the head, for the renderer only. */
export function headX(w: Readonly<Wrestler>): number {
  return w.x + Math.sin(w.angle) * BODY_LENGTH;
}

/**
 * **The fall predicate.** A wrestler has fallen the moment its head reaches the mat.
 *
 * One inequality on one continuous quantity, decidable in every pose without exception:
 * standing, mid-leap, mid-flip or sliding on its back. There is no "neither up nor down"
 * pose to get stuck in, because the question is not "is it standing" — it is "is the head
 * on the floor", and a head is always somewhere.
 *
 * While a foot is planted this reduces to `|angle| >= PI / 2`, which is the line a player
 * can see: the moment the body passes horizontal. In the air a head-first landing trips
 * it before the feet ever arrive, which is exactly the punishment for a bad leap.
 */
export function hasFallen(w: Readonly<Wrestler>): boolean {
  return headHeight(w) <= 0;
}

/* --------------------------------------------------------------------- integration */

/**
 * Advance the tilt by `dt` under a constant torque, exactly.
 *
 * The closed-form solution of `angle'' = -SPRING * angle - DAMPING * angle' + torque`,
 * not a stepped approximation of it, so splitting a step in two changes nothing.
 */
export function integrateTilt(w: Wrestler, torque: number, dt: number): void {
  const rest = torque / SPRING;
  const offset = w.angle - rest;
  const rate = w.spin;
  const half = DAMPING / 2;
  const fade = Math.exp(-half * dt);
  const cos = Math.cos(TILT_OMEGA * dt);
  const sin = Math.sin(TILT_OMEGA * dt);
  const b = (rate + half * offset) / TILT_OMEGA;
  w.angle = rest + fade * (offset * cos + b * sin);
  w.spin = fade * (rate * cos - (TILT_OMEGA * offset + half * b) * sin);
}

/**
 * Slide a planted foot along the mat by `dt`, exactly.
 *
 * `v' = accel - MAT_FRICTION * v`, solved over the whole step with the matching integral
 * for the position — the same treatment Sumo Push gives its friction, and for the same
 * reason.
 */
function slide(w: Wrestler, accel: number, dt: number): void {
  const fade = Math.exp(-MAT_FRICTION * dt);
  const terminal = accel / MAT_FRICTION;
  const travel = (1 - fade) / MAT_FRICTION;
  w.x += terminal * dt + (w.vx - terminal) * travel;
  w.vx = terminal + (w.vx - terminal) * fade;
}

/** Launch a grounded wrestler. The lean aims it and spins it; the height is fixed. */
export function launch(w: Wrestler, lean: number): void {
  w.stance = 'airborne';
  w.vy = JUMP_SPEED;
  w.vx += lean * JUMP_LATERAL;
  w.spin += lean * JUMP_SPIN;
  w.jumpCooldown = JUMP_COOLDOWN;
}

/** Put a falling wrestler back on its feet, or on its way over if it came in too steep. */
function land(w: Wrestler): void {
  w.y = 0;
  w.vy = 0;
  w.vx *= LANDING_SLIDE;
  w.spin *= LANDING_SPIN;
  w.jumpCooldown = JUMP_COOLDOWN;
  if (Math.abs(w.angle) > LAND_ANGLE) {
    w.stance = 'toppling';
    w.topple = Math.sign(w.angle);
  } else {
    w.stance = 'grounded';
  }
}

function holdInsideRopes(w: Wrestler): void {
  if (w.x > ROPE_HALF) {
    w.x = ROPE_HALF;
    if (w.vx > 0) w.vx = -w.vx * ROPE_BOUNCE;
  } else if (w.x < -ROPE_HALF) {
    w.x = -ROPE_HALF;
    if (w.vx < 0) w.vx = -w.vx * ROPE_BOUNCE;
  }
}

/**
 * Free flight: constant accelerations, integrated exactly. Two steps of h equal one 2h.
 *
 * The rotation is the same first-order solution the mat's friction uses — `spin' = torque
 * - AIR_DAMP * spin` solved over the whole step, with the matching integral for the angle
 * — so turning in the air is as frame-rate independent as everything else.
 */
function ballistic(w: Wrestler, aim: number, wind: number, dt: number): void {
  w.x += w.vx * dt + 0.5 * wind * dt * dt;
  w.vx += wind * dt;
  w.y += w.vy * dt - 0.5 * GRAVITY * dt * dt;
  w.vy -= GRAVITY * dt;

  const fade = Math.exp(-AIR_DAMP * dt);
  const terminal = (aim * AIR_TORQUE) / AIR_DAMP;
  const travel = (1 - fade) / AIR_DAMP;
  w.angle += terminal * dt + (w.spin - terminal) * travel;
  w.spin = terminal + (w.spin - terminal) * fade;
}

/**
 * Advance one wrestler by `dt` under its own stance.
 *
 * `lean` is a direction in [-1, 1] and `jump` an edge, so a held key is one leap rather
 * than sixty. Neither seat may be given anything the other cannot ask for: both go
 * through here with the same constants.
 */
export function stepWrestler(
  w: Wrestler,
  lean: number,
  jump: boolean,
  wind: number,
  dt: number,
): void {
  if (w.stance === 'fallen') return;

  const aim = clamp(lean, -1, 1);
  if (w.jumpCooldown > 0) {
    w.jumpCooldown -= dt;
    if (w.jumpCooldown < 0) w.jumpCooldown = 0;
  }

  w.vx = clampSymmetric(w.vx, MAX_SPEED);
  w.vy = clampSymmetric(w.vy, MAX_SPEED);
  w.spin = clampSymmetric(w.spin, MAX_SPIN);

  if (w.stance === 'airborne') {
    ballistic(w, aim, wind, dt);
  } else if (w.stance === 'toppling') {
    // No input reaches a toppling wrestler: past the tipping point you are going down,
    // and that is what bounds how long a round can last.
    slide(w, wind * WIND_GROUND_SHARE, dt);
    const torque = TOPPLE_TORQUE * w.topple + wind * WIND_TORQUE;
    w.angle += w.spin * dt + 0.5 * torque * dt * dt;
    w.spin += torque * dt;
  } else if (jump && w.jumpCooldown <= 0) {
    // The leap leaves the mat on the step it is asked for, so a jump answers a key
    // immediately rather than a frame later.
    launch(w, aim);
    ballistic(w, aim, wind, dt);
  } else {
    slide(w, wind * WIND_GROUND_SHARE + aim * LEAN_PUSH, dt);
    integrateTilt(w, aim * LEAN_TORQUE + wind * WIND_TORQUE, dt);
  }

  holdInsideRopes(w);
}

/**
 * Apply what the step's motion and any contact have left: the mat, the tipping point and
 * the fall.
 *
 * Run after collision rather than inside the integrator, because a shove can lift a
 * planted wrestler off the mat and that has to be noticed before the next step treats it
 * as standing.
 */
export function settle(w: Wrestler, dt: number): void {
  if (w.stance === 'fallen') return;

  if (w.stance === 'grounded' || w.stance === 'toppling') {
    if (w.y > 0 && w.vy > LIFT_SPEED) {
      // Shoved clean off its feet: it is a projectile now, and it lands as one. Both
      // halves are needed — a graze that nudges a foot a unit off the mat must not
      // count as a leap, or a pair leaning on each other would flicker in and out of
      // the air and neither could ever jump.
      w.stance = 'airborne';
    } else {
      w.y = 0;
      if (w.vy < 0) w.vy = 0;
    }
  }
  if (w.stance === 'airborne' && w.y <= 0) land(w);

  w.angle = wrapAngle(w.angle);

  if (w.stance === 'grounded' && Math.abs(w.angle) >= TIP_ANGLE) {
    w.stance = 'toppling';
    w.topple = Math.sign(w.angle);
  }

  if (hasFallen(w)) {
    w.stance = 'fallen';
    return;
  }
  // Only time on the mat counts towards steadiness: a leap is meant to be risky, not
  // scored as a wobble.
  if (w.stance !== 'airborne') w.wobble += Math.abs(w.angle) * dt;
}

/* ----------------------------------------------------------------------- collision */

function fillPoints(out: number[], w: Readonly<Wrestler>): void {
  const sin = Math.sin(w.angle);
  const cos = Math.cos(w.angle);
  for (let i = 0; i < 3; i += 1) {
    const s = OFFSETS[i] ?? 0;
    out[i * 2] = w.x + sin * s;
    out[i * 2 + 1] = w.y + cos * s;
  }
}

/**
 * Push whichever pair of discs is deepest apart, and report whether they touched.
 *
 * One contact a step rather than nine. A pile of simultaneous impulses on a rod pivoting
 * about its foot is where a body physics game starts to buzz, and a single deepest
 * contact both reads correctly — the part of you that is most buried is the part that
 * gets shoved — and cannot fight itself.
 *
 * The impulse is shared into a linear part and a spin, which is the whole game: a shove
 * low on the body moves an opponent, a shove high on it turns them over.
 */
export function resolveContact(a: Wrestler, b: Wrestler): boolean {
  if (a.stance === 'fallen' || b.stance === 'fallen') return false;
  fillPoints(pointsA, a);
  fillPoints(pointsB, b);

  const reach = BODY_RADIUS * 2;
  let bestDepth = 0;
  let bestI = -1;
  let bestJ = -1;
  let bestNx = 0;
  let bestNy = 0;
  for (let p = 0; p < PAIR_ORDER.length; p += 2) {
    const i = PAIR_ORDER[p] ?? 0;
    const j = PAIR_ORDER[p + 1] ?? 0;
    const dx = (pointsA[i * 2] ?? 0) - (pointsB[j * 2] ?? 0);
    const dy = (pointsA[i * 2 + 1] ?? 0) - (pointsB[j * 2 + 1] ?? 0);
    const distSq = dx * dx + dy * dy;
    if (distSq >= reach * reach) continue;
    const dist = Math.sqrt(distSq);
    const depth = reach - dist;
    if (depth <= bestDepth) continue;
    bestDepth = depth;
    bestI = i;
    bestJ = j;
    // Two discs exactly on top of each other have no normal; push them apart sideways,
    // away from the middle, which is the only direction that is not arbitrary here.
    if (dist === 0) {
      bestNx = a.x <= b.x ? -1 : 1;
      bestNy = 0;
    } else {
      bestNx = dx / dist;
      bestNy = dy / dist;
    }
  }
  if (bestI < 0) return false;

  const sA = OFFSETS[bestI] ?? 0;
  const sB = OFFSETS[bestJ] ?? 0;
  // Tangent of each contact point about its own foot: d(point) / d(angle).
  const tAx = Math.cos(a.angle) * sA;
  const tAy = -Math.sin(a.angle) * sA;
  const tBx = Math.cos(b.angle) * sB;
  const tBy = -Math.sin(b.angle) * sB;

  const share = bestDepth / 2;
  a.x += bestNx * share;
  a.y += bestNy * share;
  b.x -= bestNx * share;
  b.y -= bestNy * share;

  const relX = a.vx + a.spin * tAx - (b.vx + b.spin * tBx);
  const relY = a.vy + a.spin * tAy - (b.vy + b.spin * tBy);
  const closing = relX * bestNx + relY * bestNy;
  // Already separating: an impulse here would drag them back together.
  if (closing >= 0) return true;

  const armA = bestNx * tAx + bestNy * tAy;
  const armB = bestNx * tBx + bestNy * tBy;
  const effective = 2 + (armA * armA + armB * armB) * INV_INERTIA;
  const j = (-(1 + RESTITUTION) * closing) / effective;
  const jx = j * bestNx;
  const jy = j * bestNy;

  a.vx += jx;
  a.vy += jy;
  a.spin += (jx * tAx + jy * tAy) * INV_INERTIA;
  b.vx -= jx;
  b.vy -= jy;
  b.spin -= (jx * tBx + jy * tBy) * INV_INERTIA;
  return true;
}

/**
 * One step of a whole bout: both bodies, their contact, and what that leaves behind.
 *
 * Both seats are read before either moves and the contact is resolved once for the pair,
 * so neither seat ever acts on the other's post-step position and neither is shoved
 * twice.
 */
export function stepBout(
  bout: Bout,
  p1: Readonly<Drive>,
  p2: Readonly<Drive>,
  wind: number,
  dt: number,
): void {
  stepWrestler(bout.p1, p1.lean, p1.jump, wind, dt);
  stepWrestler(bout.p2, p2.lean, p2.jump, wind, dt);
  resolveContact(bout.p1, bout.p2);
  settle(bout.p1, dt);
  settle(bout.p2, dt);
}

/* --------------------------------------------------------------------------- wind */

/**
 * Draw a round's gusts from the seeded stream, in place.
 *
 * **Direction alternates, gust by gust, and which way a round starts alternates too.**
 * `phase` is the round number plus a coin the match drew once, so consecutive rounds face
 * opposite winds and no seat is the one the wind starts behind in every match ever
 * played. Only the strengths are random.
 *
 * This is not a decoration. Measured with the wind blowing the same way at the start of
 * every round, two `hard` bots — identical code, mirrored start — went **41% / 59%** to
 * the seat the first gust blew towards over four hundred matches, because most rounds end
 * inside a gust or two and a hard bot allows for the wind when it aims. Alternating both
 * ways took the same measurement to 50/50. A wind schedule is exactly the sort of thing
 * that looks fair and is not.
 */
export function drawWindSchedule(out: number[], phase: number, rng: Rng): void {
  for (let i = 0; i < GUSTS_PER_ROUND; i += 1) {
    // Non-negative before the modulo, so a phase is a phase whichever way it is counted.
    const towardsP2 = (((phase + i) % 2) + 2) % 2 === 0;
    const strength = rng.float() * WIND_MAX;
    out[i] = towardsP2 ? strength : -strength;
  }
}

/**
 * Read the schedule at `step`, writing what the players can see into `wind`.
 *
 * `upcoming` stays zero until the gust is within {@link TELEGRAPH_SECONDS}, because that
 * is when its arrow is drawn. Both the renderer and the bot read this one struct, so they
 * cannot disagree about what has been announced.
 */
export function readWind(
  wind: Wind,
  schedule: readonly number[],
  step: number,
  gustSteps: number,
  telegraphSteps: number,
): void {
  const raw = Math.floor(step / gustSteps);
  const index = raw < 0 ? 0 : raw >= GUSTS_PER_ROUND ? GUSTS_PER_ROUND - 1 : raw;
  wind.strength = schedule[index] ?? 0;
  const remaining = (index + 1) * gustSteps - step;
  if (index + 1 < GUSTS_PER_ROUND && remaining <= telegraphSteps && telegraphSteps > 0) {
    wind.upcoming = schedule[index + 1] ?? 0;
    wind.warning = remaining / telegraphSteps;
  } else {
    wind.upcoming = 0;
    wind.warning = 0;
  }
}

/* ---------------------------------------------------------------------- the rounds */

export type RoundOutcome = 'live' | 'p1' | 'p2' | 'both' | 'nobody';

/**
 * Who takes the round, given what the bodies are doing and whether the clock has run out.
 *
 * Both heads down in the same step scores for **both** seats, exactly as a double
 * ring-out does in Sumo Push: a genuinely simultaneous fall must not be handed to
 * whichever body the loop happened to test first.
 *
 * On the clock the round goes to whoever carried the **least lean while on the mat** —
 * the steadier wrestler — which is a number both players watch fill up all round. Level
 * to the last bit and nobody scores, which is the only answer that cannot favour a seat.
 */
export function judgeRound(bout: Bout, timeUp: boolean): RoundOutcome {
  const p1Down = bout.p1.stance === 'fallen';
  const p2Down = bout.p2.stance === 'fallen';
  if (p1Down && p2Down) return 'both';
  if (p2Down) return 'p1';
  if (p1Down) return 'p2';
  if (!timeUp) return 'live';
  if (bout.p1.wobble < bout.p2.wobble) return 'p1';
  if (bout.p2.wobble < bout.p1.wobble) return 'p2';
  return 'nobody';
}

/* ----------------------------------------------------------------------- the bot */

interface BotProfile {
  /**
   * Seconds of stale information the bot acts on.
   *
   * It reads the mat as it was this long ago — never as it will be, and never sooner than
   * the person opposite could have looked. Lag inside a rate-damped correction is
   * destabilising, so a longer one is worse at standing up as well as worse at aiming.
   */
  readonly lag: number;
  /** Radians of lean it commits to wrongly, held until it looks again. */
  readonly leanError: number;
}

/** How long a bot acts on one misjudgement before drawing another. Shared by every tier. */
const ERROR_HOLD = 0.25;

/**
 * How every bot stands up, attacks and picks its moment. Identical on all three tiers.
 *
 * **Everything that is not reaction, error or reading the wind lives here rather than in
 * a tier**, and that was learned the hard way. The first draft varied five more levers —
 * how hard the bot counter-leans, how far ahead it reads its own tilt, the tilt it breaks
 * off an attack at, the range it commits a leap from — and every one of them turned out
 * to be *style* rather than skill, so the ladder came out crooked and then inverted.
 * Measured, sixty matches a pairing:
 *
 * | what varied | `hard` beats `normal` |
 * |---|---|
 * | leap range 200 vs 240 | 98% — and 19% once the ranges were levelled |
 * | counter-lean 1.0 vs 0.7 | 7%, because a full correction overshoots and falls over |
 * | tilt-foresight 0.30 vs 0.16 | 17%, because seeing a wobble sooner only made it hide |
 *
 * A difficulty lever must point at doing the *same* thing better. A bot that breaks off
 * an attack earlier, or corrects harder, is a different opponent, not a stronger one — and
 * the two hardest tiers were losing to the middle one on exactly that confusion.
 */
const BALANCE_P = 1.1;
const BALANCE_D = 0.75;
/**
 * Tilt a bot is happy at, and how far ahead it reads its own spin.
 *
 * {@link SAFE_TILT} sits **above** the tilt a full attacking lean settles at, which is
 * `LEAN_TORQUE / SPRING`. Set below it, a bot's own attack read as a wobble: it leaned in,
 * panicked at its own lean, stood up, leaned in again, and never once committed to a
 * shove. That was the whole reason the hardest tier was losing to the noisiest one.
 */
const SAFE_TILT = 0.55;
const TILT_FORESIGHT = 0.22;
/** How near the opponent has to be before a bot commits to a leap, in logical units. */
const JUMP_RANGE = 230;
/** Share of its attention a bot has to have spare before it will leave the mat. */
const LEAP_COMPOSURE = 0.35;
/** How long a leap hangs in the air, which is what the wind gets to work on. */
const AIRTIME = (2 * JUMP_SPEED) / GRAVITY;
/** How near a leap has to be predicted to land for a bot to commit to it. */
const LANDING_TOLERANCE = 90;

/**
 * Difficulty is reaction delay, aim error, and how much of the wind is allowed for.
 * Nothing else.
 *
 * Every tier reads the same two bodies and the same wind struct a player reads, leans
 * with the same {@link LEAN_TORQUE}, leaps with the same {@link JUMP_SPEED}, corrects a
 * wobble with the same controller, breaks off at the same tilt and commits from the same
 * range. What separates them is how long they act on a stale reading, how wrong that
 * reading is, and whether they can see the gust coming at all.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ lag: 0.34, leanError: 0.85 }),
  normal: Object.freeze({ lag: 0.15, leanError: 0.32 }),
  hard: Object.freeze({ lag: 0.05, leanError: 0.06 }),
});

/**
 * What a bot is holding on to between decisions.
 *
 * The timing is the SDK's {@link Judgement} rather than a counter of our own, and the
 * lean is **held** between decisions. Re-drawing the error every step averages it to zero
 * and makes every tier play the same — the mistake this repository has now made in three
 * separate games, which is why the helper exists.
 */
export interface BotState {
  readonly judgement: Judgement;
  lean: number;
  jump: boolean;
}

export function createBotState(): BotState {
  return { judgement: createJudgement(), lean: 0, jump: false };
}

export function resetBotState(bot: BotState): void {
  resetJudgement(bot.judgement);
  bot.lean = 0;
  bot.jump = false;
}

/**
 * How far a bot's aim carries before it simply leans as hard as it can.
 *
 * Short, because leaning into an opponent **is** the shove: an aim that eased off as the
 * gap closed took the lean away at exactly the moment it was worth something. What is
 * left of the term is the part that matters — a wind that would carry the bot past its
 * opponent flips the sign, and that is the whole of what reading the wind buys.
 */
const APPROACH_REACH = 45;

/**
 * Decide what one bot seat asks for this step, into `out`.
 *
 * It reads its own body, the opponent's body and the wind struct — all of it drawn on the
 * screen the person opposite is looking at, and `wind.upcoming` is zero until the arrow
 * for it appears. There is no lookahead into the schedule and no access to the seed.
 *
 * `roll` is one seeded draw per decision, taken by the caller on every path so that a
 * replay stays in step with the generator whichever branch the bot takes.
 */
export function botDrive(
  out: Drive,
  bot: BotState,
  self: Readonly<Wrestler>,
  other: Readonly<Wrestler>,
  wind: Readonly<Wind>,
  difficulty: BotDifficulty,
  dt: number,
  roll: number,
): Drive {
  const profile = BOT_PROFILES[difficulty];

  // The misjudgement is drawn on a cadence and **held**, on every tier alike. Re-drawing
  // it each step averages it to zero and makes the tiers identical — the mistake this
  // repository has made in three separate games, which is why the helper exists.
  if (shouldDecide(bot.judgement, dt)) {
    commit(bot.judgement, misjudgement(roll, profile.leanError), ERROR_HOLD);
  }
  const bias = bot.judgement.value;

  // Its own balance it feels directly, as a person does. What it is late about is the
  // OPPONENT — which is the half of the picture a person actually has to watch.
  const correction = clamp(-(BALANCE_P * self.angle + BALANCE_D * self.spin), -1, 1);
  const heading = self.angle + self.spin * TILT_FORESIGHT;
  const urgency = clamp((Math.abs(heading) - SAFE_TILT) / (TIP_ANGLE - SAFE_TILT), 0, 1);

  const seenOther = other.x - other.vx * profile.lag;
  const gap = seenOther - self.x;
  const towards = clamp(gap / APPROACH_REACH, -1, 1);

  // Off the mat there is only one job: land on your feet. Nobody wrestles in mid-air.
  const flying = self.stance === 'airborne';
  bot.lean = clamp(
    (flying ? correction : correction * urgency + towards * (1 - urgency)) + bias,
    -1,
    1,
  );

  // A gust the arrow has not appeared for does not exist as far as a bot is concerned,
  // enforced here rather than trusted of the caller: rule 6 is too easy to lose to a
  // future edit of the producer, and this is the only line that has to hold it.
  const announced = wind.warning > 0 ? wind.upcoming : 0;
  // Where a leap made now would come down: its own lateral kick plus what the wind will
  // do to it over the flight. Every tier reads the wind the same way — it is the game's
  // whole subject, not a difficulty setting — and every tier reads it off the same struct
  // the arrow is drawn from.
  const carry = 0.5 * (wind.strength + announced) * AIRTIME * AIRTIME;
  const landing = Math.sign(gap) * JUMP_LATERAL * AIRTIME + carry;
  bot.jump =
    !flying &&
    self.stance === 'grounded' &&
    urgency < LEAP_COMPOSURE &&
    Math.abs(gap) < JUMP_RANGE &&
    Math.abs(landing - gap) < LANDING_TOLERANCE;

  out.lean = bot.lean;
  // The jump is an edge for a bot exactly as it is for a hand: the game only launches a
  // grounded wrestler off its cooldown, so a held intent is one leap, not sixty.
  out.jump = bot.jump;
  return out;
}
